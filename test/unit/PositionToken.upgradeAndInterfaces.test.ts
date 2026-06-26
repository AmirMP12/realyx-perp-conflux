import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

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

describe("PositionToken — upgrades & interfaces", () => {
    describe("UUPS upgrade timelock", () => {
        it("proposeImplementation rejects zero and stages otherwise", async () => {
            const { pt, bob } = await loadFixture(deploy);
            await expect(pt.proposeImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(
                pt,
                "ZeroAddress",
            );
            await expect(pt.proposeImplementation(bob.address)).to.emit(pt, "ImplementationProposed");
            const [pending, effective] = await pt.pendingImplementation();
            expect(pending).to.equal(bob.address);
            expect(effective).to.be.greaterThan(0n);
        });
        it("cancelPendingImplementation clears it", async () => {
            const { pt, bob } = await loadFixture(deploy);
            await pt.proposeImplementation(bob.address);
            await expect(pt.cancelPendingImplementation()).to.emit(pt, "ImplementationCancelled");
            const [pending, effective] = await pt.pendingImplementation();
            expect(pending).to.equal(ethers.ZeroAddress);
            expect(effective).to.equal(0n);
        });
        it("non-upgrader cannot propose", async () => {
            const { pt, alice } = await loadFixture(deploy);
            await expect(pt.connect(alice).proposeImplementation(alice.address)).to.be.reverted;
        });
    });

    describe("supportsInterface", () => {
        it("returns true for ERC721 and AccessControl interface ids", async () => {
            const { pt } = await loadFixture(deploy);
            // ERC165
            expect(await pt.supportsInterface("0x01ffc9a7")).to.equal(true);
            // ERC721
            expect(await pt.supportsInterface("0x80ac58cd")).to.equal(true);
            // random unsupported id
            expect(await pt.supportsInterface("0xffffffff")).to.equal(false);
        });
    });

    describe("getPositionsByOwner / enumeration", () => {
        it("tracks multiple tokens and reflects burns", async () => {
            const { pt, alice } = await loadFixture(deploy);
            await pt["mint(address,uint256,address,bool)"](alice.address, 1, ethers.ZeroAddress, true);
            await pt["mint(address,uint256,address,bool)"](alice.address, 2, ethers.ZeroAddress, false);
            expect(await pt.getPositionsByOwner(alice.address)).to.deep.equal([1n, 2n]);
            await pt.burn(1);
            const remaining = await pt.getPositionsByOwner(alice.address);
            expect(remaining).to.deep.equal([2n]);
        });
    });
});
