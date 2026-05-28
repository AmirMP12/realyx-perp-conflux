import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Contract, Signer } from "ethers";

describe("CopyRegistry", () => {
  let copyRegistry: Contract;
  let owner: Signer, leadTrader: Signer, copier: Signer, copier2: Signer;
  let ownerAddr: string, leadTraderAddr: string, copierAddr: string, copier2Addr: string;

  const PROFIT_FEE_10 = 1000; // 10%
  const METADATA_URI = "ipfs://QmTest";
  const MAX_ALLOCATION = ethers.parseUnits("1000", 6); // 1000 USDC
  const MAX_LEVERAGE = 30;

  beforeEach(async () => {
    [owner, leadTrader, copier, copier2] = await ethers.getSigners();
    ownerAddr = await owner.getAddress();
    leadTraderAddr = await leadTrader.getAddress();
    copierAddr = await copier.getAddress();
    copier2Addr = await copier2.getAddress();

    const CopyRegistryFactory = await ethers.getContractFactory("CopyRegistry");
    copyRegistry = await upgrades.deployProxy(CopyRegistryFactory, [ownerAddr], {
      initializer: "initialize",
      kind: "uups",
    });
    await copyRegistry.waitForDeployment();
  });

  describe("Deployment", () => {
    it("should set the owner", async () => {
      expect(await copyRegistry.owner()).to.equal(ownerAddr);
    });

    it("should start with nextLeadTraderId = 1", async () => {
      expect(await copyRegistry.nextLeadTraderId()).to.equal(1);
    });
  });

  describe("registerAsLeadTrader", () => {
    it("should register a lead trader and emit event", async () => {
      const tx = await copyRegistry
        .connect(leadTrader)
        .registerAsLeadTrader(PROFIT_FEE_10, METADATA_URI);
      const receipt = await tx.wait();

      // Check ID mapping
      expect(await copyRegistry.addressToLeadTraderId(leadTraderAddr)).to.equal(1);
      expect(await copyRegistry.nextLeadTraderId()).to.equal(2);

      // Check event
      const event = receipt.logs.find(
        (l: any) => (l as any).fragment?.name === "LeadTraderRegistered"
      );
      expect(event).to.exist;

      // Check info
      const info = await copyRegistry.getLeadTraderInfo(leadTraderAddr);
      expect(info.trader).to.equal(leadTraderAddr);
      expect(info.profitFeeBps).to.equal(PROFIT_FEE_10);
      expect(info.metadataURI).to.equal(METADATA_URI);
      expect(info.activeFollowers).to.equal(0);
    });

    it("should revert if already registered", async () => {
      await copyRegistry.connect(leadTrader).registerAsLeadTrader(PROFIT_FEE_10, METADATA_URI);
      await expect(
        copyRegistry.connect(leadTrader).registerAsLeadTrader(PROFIT_FEE_10, METADATA_URI)
      ).to.be.revertedWithCustomError(copyRegistry, "AlreadyRegistered");
    });

    it("should revert if profit fee exceeds max", async () => {
      await expect(
        copyRegistry.connect(leadTrader).registerAsLeadTrader(2500, METADATA_URI)
      ).to.be.revertedWithCustomError(copyRegistry, "ProfitFeeTooHigh");
    });
  });

  describe("updateLeadTrader", () => {
    beforeEach(async () => {
      await copyRegistry.connect(leadTrader).registerAsLeadTrader(PROFIT_FEE_10, METADATA_URI);
    });

    it("should update profit fee and metadata", async () => {
      await copyRegistry.connect(leadTrader).updateLeadTrader(500, "ipfs://updated");
      const info = await copyRegistry.getLeadTraderInfo(leadTraderAddr);
      expect(info.profitFeeBps).to.equal(500);
      expect(info.metadataURI).to.equal("ipfs://updated");
    });

    it("should emit LeadTraderUpdated event", async () => {
      await expect(
        copyRegistry.connect(leadTrader).updateLeadTrader(500, "ipfs://updated")
      ).to.emit(copyRegistry, "LeadTraderUpdated");
    });

    it("should revert if not registered", async () => {
      await expect(
        copyRegistry.connect(copier).updateLeadTrader(500, "ipfs://updated")
      ).to.be.revertedWithCustomError(copyRegistry, "NotRegistered");
    });
  });

  describe("deregisterAsLeadTrader", () => {
    beforeEach(async () => {
      await copyRegistry.connect(leadTrader).registerAsLeadTrader(PROFIT_FEE_10, METADATA_URI);
    });

    it("should deregister and unfollow all copiers", async () => {
      await copyRegistry.connect(copier).followTrader(leadTraderAddr, MAX_ALLOCATION, MAX_LEVERAGE);

      await copyRegistry.connect(leadTrader).deregisterAsLeadTrader();

      // Should revert on info query
      await expect(
        copyRegistry.getLeadTraderInfo(leadTraderAddr)
      ).to.be.revertedWithCustomError(copyRegistry, "NotRegistered");

      // Copier relationship should be deleted
      const rel = await copyRegistry.copyRelationships(copierAddr, leadTraderAddr);
      expect(rel.isActive).to.equal(false);
    });

    it("should revert if not registered", async () => {
      await expect(
        copyRegistry.connect(copier).deregisterAsLeadTrader()
      ).to.be.revertedWithCustomError(copyRegistry, "NotRegistered");
    });
  });

  describe("followTrader", () => {
    beforeEach(async () => {
      await copyRegistry.connect(leadTrader).registerAsLeadTrader(PROFIT_FEE_10, METADATA_URI);
    });

    it("should follow a lead trader and emit event", async () => {
      await expect(
        copyRegistry.connect(copier).followTrader(leadTraderAddr, MAX_ALLOCATION, MAX_LEVERAGE)
      )
        .to.emit(copyRegistry, "FollowedTrader")
        .withArgs(copierAddr, leadTraderAddr, MAX_ALLOCATION, MAX_LEVERAGE);

      const rel = await copyRegistry.copyRelationships(copierAddr, leadTraderAddr);
      expect(rel.isActive).to.equal(true);
      expect(rel.maxAllocation).to.equal(MAX_ALLOCATION);
      expect(rel.maxLeverage).to.equal(MAX_LEVERAGE);

      // Check follower count
      const info = await copyRegistry.getLeadTraderInfo(leadTraderAddr);
      expect(info.activeFollowers).to.equal(1);
    });

    it("should revert if lead trader not registered", async () => {
      await expect(
        copyRegistry.connect(copier).followTrader(copier2Addr, MAX_ALLOCATION, MAX_LEVERAGE)
      ).to.be.revertedWithCustomError(copyRegistry, "NotRegistered");
    });

    it("should revert if already following", async () => {
      await copyRegistry.connect(copier).followTrader(leadTraderAddr, MAX_ALLOCATION, MAX_LEVERAGE);
      await expect(
        copyRegistry.connect(copier).followTrader(leadTraderAddr, MAX_ALLOCATION, MAX_LEVERAGE)
      ).to.be.revertedWithCustomError(copyRegistry, "AlreadyFollowing");
    });

    it("should revert if max leverage is 0 or > 100", async () => {
      await expect(
        copyRegistry.connect(copier).followTrader(leadTraderAddr, MAX_ALLOCATION, 0)
      ).to.be.revertedWithCustomError(copyRegistry, "InvalidMaxLeverage");
      await expect(
        copyRegistry.connect(copier).followTrader(leadTraderAddr, MAX_ALLOCATION, 101)
      ).to.be.revertedWithCustomError(copyRegistry, "InvalidMaxLeverage");
    });
  });

  describe("unfollowTrader", () => {
    beforeEach(async () => {
      await copyRegistry.connect(leadTrader).registerAsLeadTrader(PROFIT_FEE_10, METADATA_URI);
      await copyRegistry.connect(copier).followTrader(leadTraderAddr, MAX_ALLOCATION, MAX_LEVERAGE);
    });

    it("should unfollow and emit event", async () => {
      await expect(copyRegistry.connect(copier).unfollowTrader(leadTraderAddr))
        .to.emit(copyRegistry, "UnfollowedTrader")
        .withArgs(copierAddr, leadTraderAddr);

      const rel = await copyRegistry.copyRelationships(copierAddr, leadTraderAddr);
      expect(rel.isActive).to.equal(false);

      const info = await copyRegistry.getLeadTraderInfo(leadTraderAddr);
      expect(info.activeFollowers).to.equal(0);
    });

    it("should revert if not following", async () => {
      await expect(
        copyRegistry.connect(copier2).unfollowTrader(leadTraderAddr)
      ).to.be.revertedWithCustomError(copyRegistry, "NotFollowing");
    });
  });

  describe("updateCopierConfig", () => {
    beforeEach(async () => {
      await copyRegistry.connect(leadTrader).registerAsLeadTrader(PROFIT_FEE_10, METADATA_URI);
      await copyRegistry.connect(copier).followTrader(leadTraderAddr, MAX_ALLOCATION, MAX_LEVERAGE);
    });

    it("should update copier config and emit event", async () => {
      await expect(
        copyRegistry.connect(copier).updateCopierConfig(leadTraderAddr, ethers.parseUnits("500", 6), 20)
      )
        .to.emit(copyRegistry, "CopierConfigUpdated")
        .withArgs(copierAddr, leadTraderAddr, ethers.parseUnits("500", 6), 20);

      const rel = await copyRegistry.copyRelationships(copierAddr, leadTraderAddr);
      expect(rel.maxAllocation).to.equal(ethers.parseUnits("500", 6));
      expect(rel.maxLeverage).to.equal(20);
    });

    it("should revert if not following", async () => {
      await expect(
        copyRegistry.connect(copier2).updateCopierConfig(leadTraderAddr, MAX_ALLOCATION, 10)
      ).to.be.revertedWithCustomError(copyRegistry, "NotFollowing");
    });
  });

  describe("getCopiersOfLeadTrader", () => {
    beforeEach(async () => {
      await copyRegistry.connect(leadTrader).registerAsLeadTrader(PROFIT_FEE_10, METADATA_URI);
    });

    it("should return all copiers for a lead trader", async () => {
      await copyRegistry.connect(copier).followTrader(leadTraderAddr, MAX_ALLOCATION, MAX_LEVERAGE);
      await copyRegistry.connect(copier2).followTrader(leadTraderAddr, MAX_ALLOCATION, 20);

      const copiers = await copyRegistry.getCopiersOfLeadTrader(leadTraderAddr);
      expect(copiers.length).to.equal(2);
      expect(copiers).to.include(copierAddr);
      expect(copiers).to.include(copier2Addr);
    });

    it("should revert if lead trader not registered", async () => {
      await expect(
        copyRegistry.getCopiersOfLeadTrader(copierAddr)
      ).to.be.revertedWithCustomError(copyRegistry, "NotRegistered");
    });
  });

  describe("getCopierFollowing", () => {
    beforeEach(async () => {
      await copyRegistry.connect(leadTrader).registerAsLeadTrader(PROFIT_FEE_10, METADATA_URI);
    });

    it("should return all lead traders a copier follows", async () => {
      await copyRegistry.connect(copier).followTrader(leadTraderAddr, MAX_ALLOCATION, MAX_LEVERAGE);

      const following = await copyRegistry.getCopierFollowing(copierAddr);
      expect(following.length).to.equal(1);
      expect(following[0]).to.equal(leadTraderAddr);
    });

    it("should return empty array for copier not following anyone", async () => {
      const following = await copyRegistry.getCopierFollowing(copier2Addr);
      expect(following.length).to.equal(0);
    });
  });
});