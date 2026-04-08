import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

describe("PositionToken - NFT logic", function () {
    let positionToken: any;
    let admin: any;
    let alice: any;
    let bob: any;
    let tradingCoreMock: any;

    beforeEach(async () => {
        [admin, alice, bob] = await ethers.getSigners();

        const PositionTokenFactory = await ethers.getContractFactory("PositionToken");
        positionToken = await upgrades.deployProxy(PositionTokenFactory, ["RWA", "RWAP", ""], { kind: "uups", unsafeAllow: ["constructor"] });

        const TradingCoreMockFactory = await ethers.getContractFactory("MockTradingCoreUpdater");
        tradingCoreMock = await TradingCoreMockFactory.deploy();
        await positionToken.setTradingCore(await tradingCoreMock.getAddress());
    });

    it("should allow TradingCore to mint a new position NFT (canonical mint)", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        await positionToken.connect(admin)["mint(address,uint256,address,bool)"](
            alice.address, 1, dummyMarket, true
        );
        expect(await positionToken.ownerOf(1)).to.equal(alice.address);
        expect(await positionToken.balanceOf(alice.address)).to.equal(1);
    });

    it("should allow TradingCore to burn an existing position NFT", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        await positionToken.connect(admin)["mint(address,uint256,address,bool)"](
            alice.address, 1, dummyMarket, true
        );
        await positionToken.connect(admin).burn(1);
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
            positionToken.connect(admin)["mint(address,uint256)"](alice.address, 5)
        ).to.be.revertedWithCustomError(positionToken, "UseCanonicalMint");
    });

    it("should track position direction and market", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        await positionToken.connect(admin)["mint(address,uint256,address,bool)"](
            alice.address, 10, dummyMarket, false
        );
        expect(await positionToken.getPositionMarket(10)).to.equal(dummyMarket);
        expect(await positionToken.getPositionDirection(10)).to.equal(false);
    });

    it("covers fee/admin and token existence guard branches", async function () {
        await expect(positionToken.setTradingCore(ethers.ZeroAddress)).to.be.revertedWithCustomError(positionToken, "ZeroAddress");
        await expect(positionToken.setTransferFee(501)).to.be.revertedWithCustomError(positionToken, "InvalidFee");
        await expect(positionToken.setTransferFee(1)).to.be.revertedWithCustomError(positionToken, "TransferFeeNotSupported");
        await positionToken.setTransferFee(0);

        await expect(positionToken.setFeeRecipient(ethers.ZeroAddress)).to.be.revertedWithCustomError(positionToken, "ZeroAddress");
        await positionToken.setFeeRecipient(alice.address);
        await positionToken.setBaseURI("ipfs://position/");
        await expect(positionToken.tokenURI(999)).to.be.revertedWithCustomError(positionToken, "TokenDoesNotExist");
        await expect(positionToken.getPositionMarket(999)).to.be.revertedWithCustomError(positionToken, "TokenDoesNotExist");
        await expect(positionToken.getPositionDirection(999)).to.be.revertedWithCustomError(positionToken, "TokenDoesNotExist");
    });

    it("covers whitelist zero-address and non-minter canonical mint branch", async function () {
        await expect(positionToken.setContractWhitelist(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(
            positionToken,
            "ZeroAddress"
        );
        await expect(
            positionToken.connect(alice)["mint(address,uint256)"](alice.address, 123)
        ).to.be.reverted;
    });

    it("covers contract recipient whitelist branch", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        const coreAddr = await tradingCoreMock.getAddress();
        const receiver = await (await ethers.getContractFactory("MockERC721Receiver")).deploy();
        const receiverAddr = await receiver.getAddress();
        await expect(
            positionToken.connect(admin)["mint(address,uint256,address,bool)"](coreAddr, 88, dummyMarket, true)
        ).to.be.revertedWithCustomError(positionToken, "ContractRecipientNotAllowed");

        await positionToken.setContractWhitelist(receiverAddr, true);
        await positionToken.connect(admin)["mint(address,uint256,address,bool)"](receiverAddr, 88, dummyMarket, true);
        expect(await positionToken.ownerOf(88)).to.equal(receiverAddr);
    });

    it("covers _update tradingCore error branches", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        await positionToken.connect(admin)["mint(address,uint256,address,bool)"](alice.address, 77, dummyMarket, true);

        await tradingCoreMock.setMode(1);
        await expect(positionToken.connect(alice).transferFrom(alice.address, bob.address, 77)).to.be.revertedWithCustomError(
            positionToken,
            "PositionOwnershipUpdateFailed"
        );

        await tradingCoreMock.setMode(2);
        await expect(positionToken.connect(alice).transferFrom(alice.address, bob.address, 77)).to.be.revertedWithCustomError(
            positionToken,
            "PositionOwnershipUpdateFailed"
        );
    });

    it("covers owner position removal scan non-first index", async function () {
        const dummyMarket = ethers.Wallet.createRandom().address;
        await positionToken.connect(admin)["mint(address,uint256,address,bool)"](alice.address, 1001, dummyMarket, true);
        await positionToken.connect(admin)["mint(address,uint256,address,bool)"](alice.address, 1002, dummyMarket, false);
        await positionToken.connect(admin).burn(1002);
        const positions = await positionToken.getPositionsByOwner(alice.address);
        expect(positions).to.deep.equal([1001n]);
    });
});
