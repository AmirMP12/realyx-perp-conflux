import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { DISTRIBUTOR_ROLE, TRADING_CORE_ROLE } from "../helpers/constants";

async function deploy() {
    const [admin, distributor, other] = await ethers.getSigners();
    const DividendManager = await ethers.getContractFactory("DividendManager");
    const dm = await upgrades.deployProxy(DividendManager, [admin.address], {
        kind: "uups",
        initializer: "initialize",
    });
    await dm.waitForDeployment();

    const DividendKeeper = await ethers.getContractFactory("DividendKeeper");
    const dk = await upgrades.deployProxy(DividendKeeper, [admin.address, await dm.getAddress()], {
        kind: "uups",
        initializer: "initialize",
    });
    await dk.waitForDeployment();

    // keeper must hold the manager's TRADING_CORE/MANAGER chain to distribute:
    // DividendManager.distributeDividend is MANAGER_ROLE-gated. Grant the keeper MANAGER_ROLE.
    const MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MANAGER_ROLE"));
    await dm.grantRole(MANAGER_ROLE, await dk.getAddress());

    return { dm, dk, admin, distributor, other };
}

const e18 = (n: number) => ethers.parseUnits(n.toString(), 18);

describe("DividendKeeper", () => {
    it("initializes with admin + distributor role and manager wired", async () => {
        const { dk, dm, admin } = await loadFixture(deploy);
        expect(await dk.hasRole(DISTRIBUTOR_ROLE, admin.address)).to.equal(true);
        expect(await dk.dividendManager()).to.equal(await dm.getAddress());
    });

    it("reverts initialize with zero addresses (implementation guard)", async () => {
        const DividendKeeper = await ethers.getContractFactory("DividendKeeper");
        await expect(
            upgrades.deployProxy(DividendKeeper, [ethers.ZeroAddress, ethers.ZeroAddress], {
                kind: "uups",
                initializer: "initialize",
            }),
        ).to.be.reverted;
    });

    it("distributes a dividend through the manager", async () => {
        const { dk, dm } = await loadFixture(deploy);
        await expect(dk.distribute("AAPL", e18(1))).to.emit(dk, "DividendTriggered");
        expect(await dm.getDividendIndex("AAPL")).to.equal(e18(1));
    });

    it("only distributor can distribute", async () => {
        const { dk, other } = await loadFixture(deploy);
        await expect(dk.connect(other).distribute("AAPL", e18(1))).to.be.reverted;
    });

    it("setDividendManager reverts on zero address", async () => {
        const { dk } = await loadFixture(deploy);
        await expect(dk.setDividendManager(ethers.ZeroAddress)).to.be.revertedWithCustomError(dk, "ZeroAddress");
    });

    it("setDividendManager updates and emits", async () => {
        const { dk, distributor } = await loadFixture(deploy);
        const newDm = ethers.Wallet.createRandom().address;
        await expect(dk.setDividendManager(newDm)).to.emit(dk, "DividendManagerUpdated");
        expect(await dk.dividendManager()).to.equal(newDm);
    });
});
