import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const ADMIN_TIMELOCK = 48 * 60 * 60;

async function deploy() {
    const [admin, alice, bob, carol] = await ethers.getSigners();
    const PositionToken = await ethers.getContractFactory("PositionToken");
    const pt = await upgrades.deployProxy(PositionToken, ["RWA Position", "RWAP", "https://meta/"], {
        kind: "uups",
        initializer: "initialize",
        unsafeAllow: ["constructor"],
    });
    await pt.waitForDeployment();
    return { pt, admin, alice, bob, carol };
}

describe("PositionToken — admin configuration", () => {
    describe("setTradingCore", () => {
        it("reverts on zero address", async () => {
            const { pt } = await loadFixture(deploy);
            await expect(pt.setTradingCore(ethers.ZeroAddress)).to.be.revertedWithCustomError(pt, "ZeroAddress");
        });

        it("wires the trading core, grants MINTER_ROLE and emits", async () => {
            const { pt, bob } = await loadFixture(deploy);
            await expect(pt.setTradingCore(bob.address)).to.emit(pt, "TradingCoreUpdated").withArgs(bob.address);
            expect(await pt.tradingCore()).to.equal(bob.address);
            expect(await pt.hasRole(await pt.MINTER_ROLE(), bob.address)).to.equal(true);
        });

        it("reverts for a non-admin caller", async () => {
            const { pt, alice } = await loadFixture(deploy);
            await expect(pt.connect(alice).setTradingCore(alice.address)).to.be.reverted;
        });
    });

    describe("fee recipient timelock", () => {
        it("proposeFeeRecipient rejects zero and stages otherwise", async () => {
            const { pt, bob } = await loadFixture(deploy);
            await expect(pt.proposeFeeRecipient(ethers.ZeroAddress)).to.be.revertedWithCustomError(pt, "ZeroAddress");
            await expect(pt.proposeFeeRecipient(bob.address)).to.emit(pt, "FeeRecipientProposed");
        });

        it("setFeeRecipient reverts on zero, on mismatch, and while timelocked", async () => {
            const { pt, bob, carol } = await loadFixture(deploy);
            await expect(pt.setFeeRecipient(ethers.ZeroAddress)).to.be.revertedWithCustomError(pt, "ZeroAddress");
            // nothing pending -> mismatch
            await expect(pt.setFeeRecipient(bob.address)).to.be.revertedWithCustomError(pt, "PendingMismatch");
            await pt.proposeFeeRecipient(bob.address);
            // pending is bob, proposing carol mismatches
            await expect(pt.setFeeRecipient(carol.address)).to.be.revertedWithCustomError(pt, "PendingMismatch");
            // correct pending but still inside timelock window
            await expect(pt.setFeeRecipient(bob.address)).to.be.revertedWithCustomError(pt, "TimelockActive");
        });

        it("setFeeRecipient succeeds after the timelock elapses", async () => {
            const { pt, bob } = await loadFixture(deploy);
            await pt.proposeFeeRecipient(bob.address);
            await time.increase(ADMIN_TIMELOCK + 1);
            await expect(pt.setFeeRecipient(bob.address))
                .to.emit(pt, "FeeRecipientUpdated")
                .withArgs(ethers.ZeroAddress, bob.address);
            expect(await pt.feeRecipient()).to.equal(bob.address);
        });
    });

    describe("base URI timelock", () => {
        it("setBaseURI reverts on mismatch and while timelocked, then succeeds", async () => {
            const { pt } = await loadFixture(deploy);
            // nothing proposed -> hash mismatch
            await expect(pt.setBaseURI("https://new/")).to.be.revertedWithCustomError(pt, "PendingMismatch");
            await expect(pt.proposeBaseURI("https://new/")).to.emit(pt, "BaseURIProposed");
            await expect(pt.setBaseURI("https://new/")).to.be.revertedWithCustomError(pt, "TimelockActive");
            await time.increase(ADMIN_TIMELOCK + 1);
            await expect(pt.setBaseURI("https://new/")).to.emit(pt, "BaseURIUpdated").withArgs("https://new/");
            expect(await pt.baseTokenURI()).to.equal("https://new/");
        });
    });

    describe("mint / burn / views", () => {
        it("the legacy mint(address,uint256) always reverts with UseCanonicalMint", async () => {
            const { pt, alice } = await loadFixture(deploy);
            await expect(pt["mint(address,uint256)"](alice.address, 1)).to.be.revertedWithCustomError(
                pt,
                "UseCanonicalMint",
            );
        });

        it("tokenURI reverts for a nonexistent token and returns baseURI+id for a minted one", async () => {
            const { pt, alice } = await loadFixture(deploy);
            await expect(pt.tokenURI(123)).to.be.revertedWithCustomError(pt, "TokenDoesNotExist");
            await pt["mint(address,uint256,address,bool)"](alice.address, 7, ethers.ZeroAddress, true);
            expect(await pt.tokenURI(7)).to.equal("https://meta/7");
        });

        it("burn updates totals, positionExists and totalSupply", async () => {
            const { pt, alice } = await loadFixture(deploy);
            await pt["mint(address,uint256,address,bool)"](alice.address, 3, ethers.ZeroAddress, true);
            expect(await pt.positionExists(3)).to.equal(true);
            expect(await pt.totalSupply()).to.equal(1n);
            await expect(pt.burn(3)).to.emit(pt, "PositionTokenBurned").withArgs(3);
            expect(await pt.positionExists(3)).to.equal(false);
            expect(await pt.totalSupply()).to.equal(0n);
            expect(await pt.totalBurned()).to.equal(1n);
        });

        it("non-minter cannot mint", async () => {
            const { pt, alice } = await loadFixture(deploy);
            await expect(
                pt.connect(alice)["mint(address,uint256,address,bool)"](alice.address, 1, ethers.ZeroAddress, true),
            ).to.be.reverted;
        });
    });
});
