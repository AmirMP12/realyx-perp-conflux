import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { deployTestEnvironment, getOracleLinkedFactory, getTradingCoreLinkedFactory } from "../helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Security, risk, previews, funding, and UUPS", function () {
    describe("TradingCore rate limits and protocol health", function () {
        let env: Awaited<ReturnType<typeof deployTestEnvironment>>;
        let market: string;
        const feedId = () => ethers.keccak256(ethers.toUtf8Bytes("sec-risk"));

        beforeEach(async function () {
            env = await deployTestEnvironment();
            market = env.alice.address;
            await env.oracle.connect(env.admin).addSupportedMarket(market);
            await env.oracle.connect(env.admin).setPythFeed(market, feedId(), 3600, 0);
            await env.trading.connect(env.admin).setMarket(
                market,
                market,
                100,
                ethers.parseUnits("500000", 18),
                ethers.parseUnits("10000000", 18),
                500,
                1000,
                86400
            );
            await env.trading.connect(env.admin).setMarketId(market, "SEC-RISK");
            await env.marketCalendar.connect(env.admin).setMarketConfig("SEC-RISK", 0, 1439, 0, true);

            await env.usdc.mintTo(env.alice.address, ethers.parseUnits("500000", 6));
            await env.usdc.connect(env.alice).approve(await env.trading.getAddress(), ethers.MaxUint256);
            await env.usdc.mintTo(env.bob.address, ethers.parseUnits("2000000", 6));
            await env.usdc.connect(env.bob).approve(await env.vault.getAddress(), ethers.MaxUint256);
            await env.vault.connect(env.bob).deposit(ethers.parseUnits("500000", 6), env.bob.address);
        });

        async function pythPayload(price: number) {
            const t = (await ethers.provider.getBlock("latest"))!.timestamp;
            const v = BigInt(price) * 10n ** 8n;
            return env.pyth.createPriceFeedUpdateData(feedId(), v, 1n, -8, v, 1n, BigInt(t), BigInt(t - 5));
        }

        it("reverts large increase orders that exceed the configured rate limit window", async function () {
            await env.trading.connect(env.admin).setLimits(0n, 0n, 500n * 10n ** 6n, 3600n, 0n, 60n);
            const size = 1000n * 10n ** 6n;
            const coll = 200n * 10n ** 6n;
            const fee = ethers.parseEther("0.01");
            const px = ethers.parseUnits("3000", 18);

            await env.trading.connect(env.alice).createOrder(0, market, size, coll, px, true, 10000, 0, { value: fee });
            await expect(
                env.trading.connect(env.alice).createOrder(0, market, size, coll, px, true, 10000, 0, { value: fee })
            ).to.be.reverted;
        });

        it("marks protocol unhealthy and blocks new increase orders", async function () {
            const TRADING_CORE_ROLE = await env.trading.TRADING_CORE_ROLE();
            await env.trading.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);

            await env.trading.connect(env.admin).recordFailedRepayment(999n, 200_000n * 10n ** 6n, market, true, 0n);
            await env.trading.connect(env.keeper).updateProtocolHealth();

            const h = await env.trading.getProtocolHealthState();
            expect(h.isHealthy).to.equal(false);

            await expect(
                env.trading
                    .connect(env.alice)
                    .createOrder(
                        0,
                        market,
                        100n * 10n ** 6n,
                        50n * 10n ** 6n,
                        ethers.parseUnits("3000", 18),
                        true,
                        10000,
                        0,
                        { value: ethers.parseEther("0.01") }
                    )
            ).to.be.revertedWithCustomError(env.trading, "ProtocolUnhealthy");
        });

        it("reverts keeper execution of increase orders once protocol is unhealthy", async function () {
            const TRADING_CORE_ROLE = await env.trading.TRADING_CORE_ROLE();
            await env.trading.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);

            await env.trading.connect(env.alice).createOrder(
                0,
                market,
                100n * 10n ** 6n,
                50n * 10n ** 6n,
                ethers.parseUnits("3000", 18),
                true,
                10000,
                0,
                { value: ethers.parseEther("0.01") }
            );

            await env.trading.connect(env.admin).recordFailedRepayment(997n, 200_000n * 10n ** 6n, market, true, 0n);
            await env.trading.connect(env.keeper).updateProtocolHealth();
            expect((await env.trading.getProtocolHealthState()).isHealthy).to.equal(false);

            await expect(env.trading.connect(env.keeper).executeOrder(1n, [])).to.be.revertedWithCustomError(env.trading, "ProtocolUnhealthy");
        });

        it("allows MARKET_DECREASE createOrder while protocol is unhealthy", async function () {
            const TRADING_CORE_ROLE = await env.trading.TRADING_CORE_ROLE();
            await env.trading.connect(env.admin).grantRole(TRADING_CORE_ROLE, env.admin.address);
            await env.trading.connect(env.admin).recordFailedRepayment(998n, 200_000n * 10n ** 6n, market, true, 0n);
            await env.trading.connect(env.keeper).updateProtocolHealth();
            expect((await env.trading.getProtocolHealthState()).isHealthy).to.equal(false);

            const fee = ethers.parseEther("0.01");
            await env.trading.connect(env.alice).createOrder(1, market, 100n * 10n ** 6n, 0n, 0n, true, 0n, 1n, { value: fee });
        });

        it("settles market funding and per-position funding after an interval", async function () {
            const size = 1000n * 10n ** 6n;
            const coll = 200n * 10n ** 6n;
            await env.trading.connect(env.alice).createOrder(0, market, size, coll, ethers.parseUnits("3000", 18), true, 10000, 0, {
                value: ethers.parseEther("0.01"),
            });
            const payload = await pythPayload(3000);
            await env.pyth.updatePriceFeeds([payload], { value: 1n });
            await env.trading.connect(env.keeper).executeOrder(1n, []);

            await ethers.provider.send("evm_increaseTime", [8 * 3600 + 1]);
            await ethers.provider.send("evm_mine", []);

            const payloadFresh = await pythPayload(3000);
            await env.pyth.updatePriceFeeds([payloadFresh], { value: 1n });

            await env.trading.settleFunding(market);
            await env.trading.settlePositionFunding(1n);
        });
    });

    describe("VaultCore preview helpers", function () {
        it("previewDeposit and previewWithdraw match convertToShares / convertToAssets", async function () {
            const env = await deployTestEnvironment();
            await env.usdc.mintTo(env.alice.address, 10_000n * 10n ** 6n);
            await env.usdc.connect(env.alice).approve(await env.vault.getAddress(), ethers.MaxUint256);

            const assets = 1000n * 10n ** 6n;
            expect(await env.vault.previewDeposit(assets)).to.equal(await env.vault.convertToShares(assets));

            await env.vault.connect(env.alice).deposit(assets, env.alice.address);
            const sh = await env.vault.lpBalanceOf(env.alice.address);
            expect(await env.vault.previewWithdraw(sh)).to.equal(await env.vault.convertToAssets(sh));
        });
    });

    describe("TradingCoreViews vs core state", function () {
        it("surfaces protocol health consistent with TradingCore + vault", async function () {
            const env = await deployTestEnvironment();
            const Views = await ethers.getContractFactory("TradingCoreViews");
            const views = await Views.deploy();
            await views.initialize(await env.trading.getAddress(), await env.vault.getAddress(), await env.oracle.getAddress());
            await env.trading.connect(env.admin).setTradingViews(await views.getAddress());

            const v = await views.getProtocolHealth();
            const core = await env.trading.getProtocolHealthState();
            expect(v.isHealthy).to.equal(core.isHealthy);
            expect(v.totalBadDebt).to.equal(core.totalBadDebt);
        });
    });

    describe("UUPS _authorizeUpgrade (admin-only)", function () {
        let admin: SignerWithAddress;
        let alice: SignerWithAddress;
        let treasury: SignerWithAddress;
        let usdc: any;

        beforeEach(async function () {
            [admin, alice, , , treasury] = await ethers.getSigners();
            const MockUSDC = await ethers.getContractFactory("MockUSDC");
            usdc = await MockUSDC.deploy();
        });

        it("upgrades VaultCore through the proxy and rejects non-admin upgrader", async function () {
            const Vault = await ethers.getContractFactory("VaultCore");
            const proxy = await upgrades.deployProxy(Vault, [admin.address, await usdc.getAddress(), treasury.address], {
                kind: "uups",
                initializer: "initialize",
            });
            await upgrades.upgradeProxy(await proxy.getAddress(), Vault);
            const VaultAlice = Vault.connect(alice);
            await expect(upgrades.upgradeProxy(await proxy.getAddress(), VaultAlice, { kind: "uups" })).to.be.reverted;
        });

        it("upgrades OracleAggregator with linked libraries", async function () {
            const MockPyth = await ethers.getContractFactory("MockPyth");
            const pyth = await MockPyth.deploy(3600, 0);
            const OracleFactory = await getOracleLinkedFactory();
            const proxy = await upgrades.deployProxy(OracleFactory, [admin.address, await pyth.getAddress()], {
                kind: "uups",
                initializer: "initialize",
                unsafeAllow: ["external-library-linking"],
            });
            await upgrades.upgradeProxy(await proxy.getAddress(), OracleFactory, {
                unsafeAllow: ["external-library-linking"],
            });
        });

        it("upgrades TradingCore with linked libraries", async function () {
            const CoreFactory = await getTradingCoreLinkedFactory();
            const proxy = await upgrades.deployProxy(
                CoreFactory,
                [admin.address, await usdc.getAddress(), treasury.address],
                {
                    kind: "uups",
                    initializer: "initialize",
                    unsafeAllow: ["external-library-linking"],
                }
            );
            await upgrades.upgradeProxy(await proxy.getAddress(), CoreFactory, { unsafeAllow: ["external-library-linking"] });
            const CoreAlice = CoreFactory.connect(alice);
            await expect(
                upgrades.upgradeProxy(await proxy.getAddress(), CoreAlice, {
                    kind: "uups",
                    unsafeAllow: ["external-library-linking"],
                })
            ).to.be.reverted;
        });
    });
});
