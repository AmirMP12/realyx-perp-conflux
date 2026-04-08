import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { deployTestEnvironment } from "../helpers";

describe("TradingCore - Unit Tests", function () {
    let env: any;
    let admin: SignerWithAddress;
    let operator: SignerWithAddress;
    let market: string;

    beforeEach(async () => {
        env = await deployTestEnvironment();
        admin = env.admin;
        operator = env.alice; // Use alice as operator for testing
        market = admin.address;

        // Grant roles
        const OPERATOR_ROLE = await env.trading.OPERATOR_ROLE();
        await env.trading.connect(admin).grantRole(OPERATOR_ROLE, operator.address);
    });

    describe("Market Configuration", function () {
        it("should set and update market parameters", async function () {
            await env.trading.connect(operator).setMarket(
                market,
                market, // fake feed
                20, // maxLev (raw number <= 100)
                ethers.parseUnits("1000000", 18),
                ethers.parseUnits("10000000", 18),
                500, // mmBps (>= 100)
                1000, // imBps (>= 200, > mmBps)
                7200
            );

            const m = await env.trading.getMarketInfo(market);
            expect(m.isActive).to.be.true;
        });

        it("should unlist a market", async function () {
            await env.trading.connect(operator).setMarket(market, market, 10, 1, 1, 500, 1000, 1);
            await env.trading.connect(operator).unlistMarket(market);
            const m = await env.trading.getMarketInfo(market);
            expect(m.isActive).to.be.false;
        });
    });

    describe("Protocol Limits", function () {
        it("should update global limits", async function () {
            const uvl = ethers.parseUnits("1000000", 6);
            await env.trading.connect(admin).setLimits(uvl, 0, 0, 0, 0, 300);
            expect(await env.trading.userDailyVolumeLimit()).to.equal(uvl);
        });
    });
});
