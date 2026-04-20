import { expect } from "chai";
import { ethers } from "hardhat";

describe("DividendSettlementLib Branch Wave", function () {
    it("covers zero-manager, empty-marketId, and settle-call paths", async function () {
        const divLib = await (await ethers.getContractFactory("DividendSettlementLib")).deploy();
        const Harness = await ethers.getContractFactory("DividendSettlementHarness", {
            libraries: {
                "contracts/libraries/DividendSettlementLib.sol:DividendSettlementLib": await divLib.getAddress(),
            },
        });
        const harness = await Harness.deploy();
        const Mock = await ethers.getContractFactory("MockDividendManagerForSettlement");
        const mock = await Mock.deploy();

        await harness.setPosition(1000, 1);

        // Branch 1: manager == address(0)
        let res = await harness.settle.staticCall(1, "BTC-USD", 7, ethers.ZeroAddress);
        expect(res[0]).to.equal(0n);
        expect(res[1]).to.equal(7n);

        // Branch 2: marketId empty with non-zero manager
        res = await harness.settle.staticCall(1, "", 9, await mock.getAddress());
        expect(res[0]).to.equal(0n);
        expect(res[1]).to.equal(9n);

        // Branch 3: both checks false -> calls dividend manager
        await mock.configure(-123n, 42n, false);
        res = await harness.settle.staticCall(1, "BTC-USD", 10, await mock.getAddress());
        expect(res[0]).to.equal(-123n);
        expect(res[1]).to.equal(42n);
    });
});
