import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

/**
 * Regression tests for findings documented in AUDIT_REPORT.md.
 */
describe("Audit findings regression", function () {
    describe("C-01 — insurance share decimal scaling", function () {
        async function deployVaultFixture() {
            const [admin, user, treasury] = await ethers.getSigners();
            const MockUSDC = await ethers.getContractFactory("MockUSDC");
            const usdc = await MockUSDC.deploy();
            const VaultCore = await ethers.getContractFactory("VaultCore");
            const vault = await upgrades.deployProxy(
                VaultCore,
                [admin.address, await usdc.getAddress(), treasury.address],
                { kind: "uups", initializer: "initialize" }
            );
            await vault.waitForDeployment();
            return { admin, user, treasury, usdc, vault };
        }

        it("first insurance stake redeems near the deposited USDC amount", async function () {
            const { user, usdc, vault } = await deployVaultFixture();
            const stakeUsdc = ethers.parseUnits("1000", 6);

            await usdc.mintTo(user.address, stakeUsdc * 2n);
            await usdc.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);

            await vault.connect(user).stakeInsurance(stakeUsdc, user.address);
            const shares = await vault.insBalanceOf(user.address);
            expect(shares).to.be.gt(0);

            await vault.connect(user).requestUnstake();
            await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
            await ethers.provider.send("evm_mine", []);

            const balBefore = await usdc.balanceOf(user.address);
            await vault.connect(user).unstakeInsurance(shares, user.address);
            const received = (await usdc.balanceOf(user.address)) - balBefore;

            expect(received).to.be.closeTo(stakeUsdc, stakeUsdc / 100n);
        });

        it("reverts when first insurance stake is below minInitialInsuranceDeposit", async function () {
            const { user, usdc, vault } = await deployVaultFixture();
            const min = await vault.minInitialInsuranceDeposit();

            await usdc.mintTo(user.address, min);
            await usdc.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);

            await expect(
                vault.connect(user).stakeInsurance(min - 1n, user.address)
            ).to.be.revertedWithCustomError(vault, "MinimumInsuranceDepositRequired");
        });
    });

    describe("M-05 — MarketCalendar.getNextOpenTime", function () {
        it("reverts AllDaysClosed when the last open weekday is closed", async function () {
            const [admin] = await ethers.getSigners();
            const calendar = await (await ethers.getContractFactory("MarketCalendar")).deploy();
            await calendar.initialize(admin.address);
            const marketId = "CLOSED";
            await calendar.setMarketConfig(marketId, 600, 960, 0, false);
            for (const d of [1, 2, 3, 4]) {
                await calendar.setTradingDay(marketId, d, false);
            }
            await expect(calendar.setTradingDay(marketId, 5, false)).to.be.revertedWithCustomError(
                calendar,
                "AllDaysClosed"
            );
        });

        it("reverts NoOpenWindow when every day in range is a holiday", async function () {
            const [admin] = await ethers.getSigners();
            const calendar = await (await ethers.getContractFactory("MarketCalendar")).deploy();
            await calendar.initialize(admin.address);
            const marketId = "HOL";
            await calendar.setMarketConfig(marketId, 600, 960, 0, false);
            const from = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
            for (let day = 0; day < 400; day++) {
                const ts = from + BigInt(day * 86400);
                const d = new Date(Number(ts) * 1000);
                const yyyymmdd = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
                await calendar.setHoliday(marketId, yyyymmdd, true);
            }
            await expect(calendar.getNextOpenTime(marketId, from)).to.be.revertedWithCustomError(
                calendar,
                "NoOpenWindow"
            );
        });
    });
});
