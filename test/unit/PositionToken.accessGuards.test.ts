import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Verifies PositionToken access guards: the re-initialization revert, the
 * UPGRADER_ROLE checks on _authorizeUpgrade and cancelPendingImplementation,
 * the upgrade timelock when nothing is staged, the DEFAULT_ADMIN_ROLE checks on
 * the fee, base-URI and whitelist setters, the MINTER_ROLE checks on mint and
 * burn, and the owner-position removal scanning past non-matching entries.
 *
 * Note: the _update reentrancy guard is not exercised here; reaching its
 * revert would require a contrived re-entrant mock that re-enters _update,
 * which the ERC721 transfer flow cannot reach.
 */
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

describe("PositionToken — access guards", () => {
    it("initialize cannot be called twice", async () => {
        const { pt } = await loadFixture(deploy);
        await expect(pt.initialize("X", "Y", "https://z/")).to.be.revertedWithCustomError(
            pt,
            "InvalidInitialization",
        );
    });

    it("a non-UPGRADER caller cannot drive an upgrade", async () => {
        const { pt, alice } = await loadFixture(deploy);
        await expect(
            pt.connect(alice).upgradeToAndCall(alice.address, "0x"),
        ).to.be.revertedWithCustomError(pt, "AccessControlUnauthorizedAccount");
    });

    it("upgrade with nothing staged reverts UpgradeTimelockActive", async () => {
        const { pt } = await loadFixture(deploy);
        // admin holds UPGRADER_ROLE. With no proposal staged, _pendingImpl==0;
        // calling upgradeToAndCall(address(0)) passes the `!= _pendingImpl`
        // mismatch check (0 == 0) and is rejected by the timelock guard since
        // no implementation is pending.
        await expect(
            pt.upgradeToAndCall(ethers.ZeroAddress, "0x"),
        ).to.be.revertedWithCustomError(pt, "UpgradeTimelockActive");
    });

    it("a non-UPGRADER caller cannot cancel a pending implementation", async () => {
        const { pt, alice } = await loadFixture(deploy);
        await expect(pt.connect(alice).cancelPendingImplementation()).to.be.revertedWithCustomError(
            pt,
            "AccessControlUnauthorizedAccount",
        );
    });

    it("a non-admin caller cannot set the transfer fee", async () => {
        const { pt, alice } = await loadFixture(deploy);
        await expect(pt.connect(alice).setTransferFee(0)).to.be.revertedWithCustomError(
            pt,
            "AccessControlUnauthorizedAccount",
        );
    });

    it("a non-admin caller cannot set the fee recipient", async () => {
        const { pt, alice, bob } = await loadFixture(deploy);
        await expect(pt.connect(alice).setFeeRecipient(bob.address)).to.be.revertedWithCustomError(
            pt,
            "AccessControlUnauthorizedAccount",
        );
    });

    it("a non-admin caller cannot propose a fee recipient", async () => {
        const { pt, alice, bob } = await loadFixture(deploy);
        await expect(pt.connect(alice).proposeFeeRecipient(bob.address)).to.be.revertedWithCustomError(
            pt,
            "AccessControlUnauthorizedAccount",
        );
    });

    it("a non-admin caller cannot set the base URI", async () => {
        const { pt, alice } = await loadFixture(deploy);
        await expect(pt.connect(alice).setBaseURI("https://hijack/")).to.be.revertedWithCustomError(
            pt,
            "AccessControlUnauthorizedAccount",
        );
    });

    it("a non-admin caller cannot propose a base URI", async () => {
        const { pt, alice } = await loadFixture(deploy);
        await expect(pt.connect(alice).proposeBaseURI("https://hijack/")).to.be.revertedWithCustomError(
            pt,
            "AccessControlUnauthorizedAccount",
        );
    });

    it("a non-admin caller cannot whitelist a contract", async () => {
        const { pt, alice, bob } = await loadFixture(deploy);
        await expect(pt.connect(alice).setContractWhitelist(bob.address, true)).to.be.revertedWithCustomError(
            pt,
            "AccessControlUnauthorizedAccount",
        );
    });

    it("a non-minter caller cannot call the legacy mint(address,uint256)", async () => {
        const { pt, alice } = await loadFixture(deploy);
        await expect(
            pt.connect(alice)["mint(address,uint256)"](alice.address, 1),
        ).to.be.revertedWithCustomError(pt, "AccessControlUnauthorizedAccount");
    });

    it("a non-minter caller cannot burn", async () => {
        const { pt, alice } = await loadFixture(deploy);
        // admin mints a token, then a non-minter tries to burn it.
        await pt["mint(address,uint256,address,bool)"](alice.address, 1, ethers.ZeroAddress, true);
        await expect(pt.connect(alice).burn(1)).to.be.revertedWithCustomError(
            pt,
            "AccessControlUnauthorizedAccount",
        );
    });

    it("removing a non-first position scans past non-matching entries", async () => {
        const { pt, alice } = await loadFixture(deploy);
        // Three positions for alice -> [1, 2, 3]. Burning token 3 forces the
        // removal loop to compare index 0 (1 != 3) and index 1 (2 != 3) before
        // matching at index 2.
        await pt["mint(address,uint256,address,bool)"](alice.address, 1, ethers.ZeroAddress, true);
        await pt["mint(address,uint256,address,bool)"](alice.address, 2, ethers.ZeroAddress, false);
        await pt["mint(address,uint256,address,bool)"](alice.address, 3, ethers.ZeroAddress, true);
        await pt.burn(3);
        expect(await pt.getPositionsByOwner(alice.address)).to.deep.equal([1n, 2n]);
    });
});
