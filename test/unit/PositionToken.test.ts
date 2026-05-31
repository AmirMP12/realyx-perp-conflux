import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { MINTER_ROLE } from "../helpers/constants";

/**
 * PositionToken tested in isolation with a mock TradingCore updater so the
 * transfer hook (`updatePositionOwner`) is exercised independently of the
 * full engine. `tradingCore` here is an EOA acting as MINTER for direct
 * mint/burn coverage; transfer tests use the mock contract.
 */
async function deploy() {
    const [admin, minter, alice, bob] = await ethers.getSigners();
    const PositionToken = await ethers.getContractFactory("PositionToken");
    const pt = await upgrades.deployProxy(
        PositionToken,
        ["RWA Position", "RWAP", "https://meta/"],
        { kind: "uups", initializer: "initialize", unsafeAllow: ["constructor"] },
    );
    await pt.waitForDeployment();
    return { pt, admin, minter, alice, bob };
}

describe("PositionToken", () => {
    describe("initialize", () => {
        it("sets name/symbol/baseURI and grants roles to deployer", async () => {
            const { pt, admin } = await loadFixture(deploy);
            expect(await pt.name()).to.equal("RWA Position");
            expect(await pt.symbol()).to.equal("RWAP");
            expect(await pt.baseTokenURI()).to.equal("https://meta/");
            expect(await pt.hasRole(MINTER_ROLE, admin.address)).to.equal(true);
        });
    });

    describe("setTradingCore", () => {
        it("reverts on zero address", async () => {
            const { pt } = await loadFixture(deploy);
            await expect(pt.setTradingCore(ethers.ZeroAddress)).to.be.revertedWithCustomError(pt, "ZeroAddress");
        });
        it("grants MINTER to the trading core", async () => {
            const { pt, minter } = await loadFixture(deploy);
            await expect(pt.setTradingCore(minter.address)).to.emit(pt, "TradingCoreUpdated");
            expect(await pt.hasRole(MINTER_ROLE, minter.address)).to.equal(true);
            expect(await pt.tradingCore()).to.equal(minter.address);
        });
    });

    describe("mint / burn (canonical)", () => {
        it("legacy mint(address,uint256) reverts UseCanonicalMint", async () => {
            const { pt, admin, alice } = await loadFixture(deploy);
            await expect(pt["mint(address,uint256)"](alice.address, 1)).to.be.revertedWithCustomError(
                pt,
                "UseCanonicalMint",
            );
        });
        it("mints with market + direction metadata", async () => {
            const { pt, admin, alice } = await loadFixture(deploy);
            const market = "0x00000000000000000000000000000000000000B7";
            await expect(pt["mint(address,uint256,address,bool)"](alice.address, 1, market, true)).to.emit(
                pt,
                "PositionTokenMinted",
            );
            expect(await pt.ownerOf(1)).to.equal(alice.address);
            expect(await pt.getPositionMarket(1)).to.equal(ethers.getAddress(market));
            expect(await pt.getPositionDirection(1)).to.equal(true);
            expect(await pt.positionExists(1)).to.equal(true);
            expect(await pt.totalSupply()).to.equal(1n);
            expect(await pt.getPositionsByOwner(alice.address)).to.deep.equal([1n]);
        });
        it("non-minter cannot mint", async () => {
            const { pt, alice } = await loadFixture(deploy);
            await expect(
                pt.connect(alice)["mint(address,uint256,address,bool)"](alice.address, 1, ethers.ZeroAddress, true),
            ).to.be.reverted;
        });
        it("burns a token and updates counters", async () => {
            const { pt, alice } = await loadFixture(deploy);
            await pt["mint(address,uint256,address,bool)"](alice.address, 1, ethers.ZeroAddress, true);
            await expect(pt.burn(1)).to.emit(pt, "PositionTokenBurned");
            expect(await pt.positionExists(1)).to.equal(false);
            expect(await pt.totalBurned()).to.equal(1n);
            expect(await pt.totalSupply()).to.equal(0n);
        });
    });

    describe("tokenURI", () => {
        it("reverts for nonexistent token", async () => {
            const { pt } = await loadFixture(deploy);
            await expect(pt.tokenURI(99)).to.be.revertedWithCustomError(pt, "TokenDoesNotExist");
        });
        it("concatenates baseURI + id", async () => {
            const { pt, alice } = await loadFixture(deploy);
            await pt["mint(address,uint256,address,bool)"](alice.address, 7, ethers.ZeroAddress, true);
            expect(await pt.tokenURI(7)).to.equal("https://meta/7");
        });
    });

    describe("transfer fee config", () => {
        it("setTransferFee reverts above max", async () => {
            const { pt } = await loadFixture(deploy);
            await expect(pt.setTransferFee(501)).to.be.revertedWithCustomError(pt, "InvalidFee");
        });
        it("setTransferFee reverts for nonzero fee (unsupported)", async () => {
            const { pt } = await loadFixture(deploy);
            await expect(pt.setTransferFee(100)).to.be.revertedWithCustomError(pt, "TransferFeeNotSupported");
        });
        it("setTransferFee accepts zero", async () => {
            const { pt } = await loadFixture(deploy);
            await expect(pt.setTransferFee(0)).to.emit(pt, "TransferFeeUpdated");
        });
    });

    describe("fee recipient timelock", () => {
        it("setFeeRecipient reverts without staged proposal", async () => {
            const { pt, bob } = await loadFixture(deploy);
            await expect(pt.setFeeRecipient(bob.address)).to.be.revertedWithCustomError(pt, "PendingMismatch");
        });
        it("propose then apply after 48h", async () => {
            const { pt, bob } = await loadFixture(deploy);
            await expect(pt.proposeFeeRecipient(bob.address)).to.emit(pt, "FeeRecipientProposed");
            await expect(pt.setFeeRecipient(bob.address)).to.be.revertedWithCustomError(pt, "TimelockActive");
            await time.increase(48 * 60 * 60 + 1);
            await expect(pt.setFeeRecipient(bob.address)).to.emit(pt, "FeeRecipientUpdated");
            expect(await pt.feeRecipient()).to.equal(bob.address);
        });
    });

    describe("baseURI timelock", () => {
        it("propose then apply after 48h", async () => {
            const { pt } = await loadFixture(deploy);
            await expect(pt.proposeBaseURI("https://new/")).to.emit(pt, "BaseURIProposed");
            await expect(pt.setBaseURI("https://new/")).to.be.revertedWithCustomError(pt, "TimelockActive");
            await time.increase(48 * 60 * 60 + 1);
            await expect(pt.setBaseURI("https://new/")).to.emit(pt, "BaseURIUpdated");
            expect(await pt.baseTokenURI()).to.equal("https://new/");
        });
        it("setBaseURI reverts when hash mismatches staged value", async () => {
            const { pt } = await loadFixture(deploy);
            await pt.proposeBaseURI("https://new/");
            await time.increase(48 * 60 * 60 + 1);
            await expect(pt.setBaseURI("https://different/")).to.be.revertedWithCustomError(pt, "PendingMismatch");
        });
    });

    describe("contract whitelist", () => {
        it("reverts zero address", async () => {
            const { pt } = await loadFixture(deploy);
            await expect(pt.setContractWhitelist(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(
                pt,
                "ZeroAddress",
            );
        });
        it("whitelists a contract", async () => {
            const { pt, bob } = await loadFixture(deploy);
            await pt.setContractWhitelist(bob.address, true);
            expect(await pt.whitelistedContracts(bob.address)).to.equal(true);
        });
    });

    describe("transfer hook with mock TradingCore", () => {
        it("calls updatePositionOwner on transfer and migrates enumeration", async () => {
            const { pt, alice, bob } = await loadFixture(deploy);
            const MockUpdater = await ethers.getContractFactory("MockTradingCoreUpdater");
            const updater = await MockUpdater.deploy();
            await updater.waitForDeployment();
            await pt.setTradingCore(await updater.getAddress());
            // mint to alice (minter is admin since setTradingCore granted MINTER to updater, admin still has it)
            await pt["mint(address,uint256,address,bool)"](alice.address, 1, ethers.ZeroAddress, true);
            await pt.connect(alice).transferFrom(alice.address, bob.address, 1);
            expect(await pt.ownerOf(1)).to.equal(bob.address);
            expect(await pt.getPositionsByOwner(alice.address)).to.deep.equal([]);
            expect(await pt.getPositionsByOwner(bob.address)).to.deep.equal([1n]);
        });
    });
});
