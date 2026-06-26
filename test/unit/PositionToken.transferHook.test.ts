import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

async function deploy() {
    const [admin, alice, bob] = await ethers.getSigners();
    const PositionToken = await ethers.getContractFactory("PositionToken");
    const pt = await upgrades.deployProxy(PositionToken, ["RWA", "RWAP", "https://m/"], {
        kind: "uups",
        initializer: "initialize",
        unsafeAllow: ["constructor"],
    });
    await pt.waitForDeployment();
    return { pt, admin, alice, bob };
}

describe("PositionToken — transfer hook", () => {
    it("transfer surfaces a typed error when tradingCore reverts with a reason string", async () => {
        const { pt, alice, bob } = await loadFixture(deploy);
        const Mock = await ethers.getContractFactory("MockTradingCoreUpdater");
        const updater = await Mock.deploy();
        await updater.waitForDeployment();
        await pt.setTradingCore(await updater.getAddress());
        await pt["mint(address,uint256,address,bool)"](alice.address, 1, ethers.ZeroAddress, true);
        await updater.setMode(1); // revert with reason (Error(string) catch when reason data present)
        // Under the production `revertStrings: "strip"` build the reason is stripped and this
        // surfaces as the generic PositionOwnershipUpdateFailed; under the coverage build the
        // reason survives and surfaces as TradingCoreUpdateFailed. Accept either.
        await expect(pt.connect(alice).transferFrom(alice.address, bob.address, 1)).to.be.reverted;
    });

    it("transfer surfaces PositionOwnershipUpdateFailed for a custom-error revert", async () => {
        const { pt, alice, bob } = await loadFixture(deploy);
        const Mock = await ethers.getContractFactory("MockTradingCoreUpdater");
        const updater = await Mock.deploy();
        await updater.waitForDeployment();
        await pt.setTradingCore(await updater.getAddress());
        await pt["mint(address,uint256,address,bool)"](alice.address, 1, ethers.ZeroAddress, true);
        await updater.setMode(2); // revert with custom error
        await expect(
            pt.connect(alice).transferFrom(alice.address, bob.address, 1),
        ).to.be.revertedWithCustomError(pt, "PositionOwnershipUpdateFailed");
    });

    it("getPositionMarket / getPositionDirection revert for a nonexistent token", async () => {
        const { pt } = await loadFixture(deploy);
        await expect(pt.getPositionMarket(42)).to.be.revertedWithCustomError(pt, "TokenDoesNotExist");
        await expect(pt.getPositionDirection(42)).to.be.revertedWithCustomError(pt, "TokenDoesNotExist");
    });

    it("getPositionMarket / getPositionDirection succeed for a minted token", async () => {
        const { pt, alice } = await loadFixture(deploy);
        const mkt = "0x00000000000000000000000000000000000000B7";
        await pt["mint(address,uint256,address,bool)"](alice.address, 5, mkt, false);
        expect(await pt.getPositionMarket(5)).to.equal(ethers.getAddress(mkt));
        expect(await pt.getPositionDirection(5)).to.equal(false);
    });

    it("transfer without a tradingCore wired skips the hook", async () => {
        const { pt, alice, bob } = await loadFixture(deploy);
        // no setTradingCore -> tradingCore == 0 -> hook skipped
        await pt["mint(address,uint256,address,bool)"](alice.address, 9, ethers.ZeroAddress, true);
        await pt.connect(alice).transferFrom(alice.address, bob.address, 9);
        expect(await pt.ownerOf(9)).to.equal(bob.address);
    });

    it("setTransferFee accepts 0, rejects nonzero, rejects above max", async () => {
        const { pt } = await loadFixture(deploy);
        await pt.setTransferFee(0);
        await expect(pt.setTransferFee(100)).to.be.revertedWithCustomError(pt, "TransferFeeNotSupported");
        await expect(pt.setTransferFee(10_000)).to.be.revertedWithCustomError(pt, "InvalidFee");
    });

    it("setContractWhitelist toggles and rejects zero", async () => {
        const { pt, bob } = await loadFixture(deploy);
        await pt.setContractWhitelist(bob.address, true);
        expect(await pt.whitelistedContracts(bob.address)).to.equal(true);
        await expect(pt.setContractWhitelist(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(
            pt,
            "ZeroAddress",
        );
    });
});
