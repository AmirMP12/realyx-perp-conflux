import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

describe("PositionToken - NFT logic", function () {
    let positionToken: any;
    let admin: any;
    let alice: any;
    let tradingCoreMock: any;

    beforeEach(async () => {
        [admin, alice, tradingCoreMock] = await ethers.getSigners();

        const PositionTokenFactory = await ethers.getContractFactory("PositionToken");
        positionToken = await upgrades.deployProxy(PositionTokenFactory, ["RWA", "RWAP", ""], { kind: "uups", unsafeAllow: ["constructor"] });

        await positionToken.setTradingCore(tradingCoreMock.address);
    });

    it("should allow TradingCore to mint a new position NFT (canonical mint)", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        await positionToken.connect(tradingCoreMock)["mint(address,uint256,address,bool)"](
            alice.address, 1, dummyMarket, true
        );
        expect(await positionToken.ownerOf(1)).to.equal(alice.address);
        expect(await positionToken.balanceOf(alice.address)).to.equal(1);
    });

    it("should allow TradingCore to burn an existing position NFT", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        await positionToken.connect(tradingCoreMock)["mint(address,uint256,address,bool)"](
            alice.address, 1, dummyMarket, true
        );
        await positionToken.connect(tradingCoreMock).burn(1);
        await expect(positionToken.ownerOf(1))
            .to.be.revertedWithCustomError(positionToken, "ERC721NonexistentToken");
    });

    it("should revert if a non-TradingCore address attempts to mint", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        // The actual error is AccessControlUnauthorizedAccount since mint requires MINTER_ROLE
        await expect(
            positionToken.connect(alice)["mint(address,uint256,address,bool)"](
                alice.address, 2, dummyMarket, true
            )
        ).to.be.reverted;
    });

    it("should revert UseCanonicalMint when calling simplified mint(address,uint256)", async function () {
        await expect(
            positionToken.connect(tradingCoreMock)["mint(address,uint256)"](alice.address, 5)
        ).to.be.revertedWithCustomError(positionToken, "UseCanonicalMint");
    });

    it("should track position direction and market", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        await positionToken.connect(tradingCoreMock)["mint(address,uint256,address,bool)"](
            alice.address, 10, dummyMarket, false
        );
        expect(await positionToken.getPositionMarket(10)).to.equal(dummyMarket);
        expect(await positionToken.getPositionDirection(10)).to.equal(false);
    });
});
