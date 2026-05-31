import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { Deployment } from "./fixture";
import { OrderType, TimeInForce, CollateralType } from "./constants";
import { buildPriceUpdate } from "./pyth";

const EXEC_FEE = ethers.parseEther("0.005"); // matches default minExecutionFee

/**
 * Build a CreateOrderParams struct with sensible defaults. Override any field.
 */
export function orderParams(d: Deployment, over: Partial<any> = {}): any {
    return {
        orderType: OrderType.MARKET_INCREASE,
        market: d.market,
        sizeDelta: 0n,
        collateralDelta: 0n,
        triggerPrice: 0n,
        isLong: true,
        maxSlippage: 0n,
        positionId: 0n,
        collateralType: CollateralType.NONE,
        collateralToken: ethers.ZeroAddress,
        tif: TimeInForce.GTC,
        stopLossPrice: 0n,
        takeProfitPrice: 0n,
        visibleSize: 0n,
        twapInterval: 0n,
        isReduceOnly: false,
        owner: ethers.ZeroAddress,
        ...over,
    };
}

/**
 * Create an order (default market increase) and return its id.
 */
export async function createOrder(
    d: Deployment,
    trader: HardhatEthersSigner,
    over: Partial<any> = {},
    value: bigint = EXEC_FEE,
): Promise<bigint> {
    const params = orderParams(d, over);
    const tx = await d.tradingCore.connect(trader).createOrder(params, { value });
    const rc = await tx.wait();
    // OrderCreated(orderId, account, orderType, market)
    const ev = rc!.logs
        .map((l: any) => {
            try {
                return d.tradingCore.interface.parseLog(l);
            } catch {
                return null;
            }
        })
        .find((p: any) => p && p.name === "OrderCreated");
    return ev ? ev.args[0] : 0n;
}

/**
 * Keeper executes an order with a fresh price update for the configured feed.
 */
export async function executeOrder(
    d: Deployment,
    orderId: bigint,
    priceNormalized1e18?: bigint,
): Promise<void> {
    const updates: string[] = [];
    let fee = 0n;
    if (priceNormalized1e18 !== undefined) {
        const data = await buildPriceUpdate(d.pyth, d.feedId, priceNormalized1e18);
        updates.push(data);
        fee = await d.pyth.getUpdateFee(updates);
    }
    await d.tradingCore.connect(d.keeper).executeOrder(orderId, updates, { value: fee });
}

/**
 * Open a market position end-to-end (create order + keeper execute) and
 * return the resulting positionId.
 *
 * @param sizeUsdc notional size in USDC (6dp)
 * @param collateralUsdc margin in USDC (6dp)
 */
export async function openMarket(
    d: Deployment,
    trader: HardhatEthersSigner,
    args: {
        isLong: boolean;
        sizeUsdc: bigint;
        collateralUsdc: bigint;
        triggerPrice?: bigint;
        maxSlippage?: bigint;
        stopLossPrice?: bigint;
        takeProfitPrice?: bigint;
        execPrice?: bigint; // price to push at execution
    },
): Promise<bigint> {
    const nextId = await d.tradingCore.nextPositionId();
    const orderId = await createOrder(d, trader, {
        orderType: OrderType.MARKET_INCREASE,
        sizeDelta: args.sizeUsdc,
        collateralDelta: args.collateralUsdc,
        triggerPrice: args.triggerPrice ?? 0n,
        isLong: args.isLong,
        maxSlippage: args.maxSlippage ?? 0n,
        stopLossPrice: args.stopLossPrice ?? 0n,
        takeProfitPrice: args.takeProfitPrice ?? 0n,
    });
    await executeOrder(d, orderId, args.execPrice);
    return nextId;
}

/**
 * Close a full position at market.
 */
export async function closeFull(
    d: Deployment,
    trader: HardhatEthersSigner,
    positionId: bigint,
    minReceive: bigint = 0n,
): Promise<any> {
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    return d.tradingCore.connect(trader).closePosition({
        positionId,
        closeSize: 0n, // 0 = full
        minReceive,
        deadline,
    });
}

export { EXEC_FEE };
