/**
 * OrderBuilder — Construct, sign, and broadcast CreateOrderParams transactions
 * using ethers.js v6. Supports subaccount (delegated) trading.
 */

import { ethers } from "ethers";
import type { OrderParams, SubaccountConfig } from "./types";
import { OrderTypeEnum, TimeInForceEnum } from "./types";

/** Minimal ABI for TradingCore.createOrder */
const TRADING_CORE_ABI = [
  "function createOrder(tuple(uint8 orderType, address market, uint256 sizeDelta, uint256 collateralDelta, uint256 triggerPrice, bool isLong, uint256 maxSlippage, uint256 positionId, uint8 collateralType, address collateralToken, uint8 tif, uint256 stopLossPrice, uint256 takeProfitPrice, uint256 visibleSize, uint256 twapInterval, bool isReduceOnly, address owner) params) external payable returns (uint256)",
];

/** CollateralType enum (mirrors DataTypes.sol) */
const COLLATERAL_TYPE_USDC = 1;

export interface OrderBuilderConfig {
  /** ethers Signer for the wallet that submits the transaction */
  signer: ethers.Signer;
  /** TradingCore contract address */
  tradingCoreAddress: string;
  /** Optional subaccount config for delegated trading */
  subaccount?: SubaccountConfig;
  /** Default max slippage in BPS */
  defaultMaxSlippage?: number;
}

export class OrderBuilder {
  private signer: ethers.Signer;
  private contract: ethers.Contract;
  private subaccount?: SubaccountConfig;
  private defaultMaxSlippage: number;

  constructor(config: OrderBuilderConfig) {
    this.signer = config.signer;
    this.contract = new ethers.Contract(config.tradingCoreAddress, TRADING_CORE_ABI, config.signer);
    this.subaccount = config.subaccount;
    this.defaultMaxSlippage = config.defaultMaxSlippage ?? 50; // 0.5%
  }

  /**
   * Build the CreateOrderParams tuple ready for TradingCore.createOrder.
   *
   * When a subaccount is configured:
   *  - `owner` is set to `subaccount.ownerAddress`
   *  - The signer (bot wallet) pays gas in native CFX
   *  - TradingCore pulls USDC collateral from `owner` via transferFrom
   *
   * When no subaccount:
   *  - `owner` is address(0) (treated as msg.sender by contract)
   */
  buildParams(params: OrderParams): {
    orderType: number;
    market: string;
    sizeDelta: string;
    collateralDelta: string;
    triggerPrice: string;
    isLong: boolean;
    maxSlippage: number;
    positionId: number;
    collateralType: number;
    collateralToken: string;
    tif: number;
    stopLossPrice: string;
    takeProfitPrice: string;
    visibleSize: string;
    twapInterval: number;
    isReduceOnly: boolean;
    owner: string;
  } {
    const orderTypeEnum = OrderTypeEnum[params.orderType];
    if (orderTypeEnum === undefined) {
      throw new Error(`Invalid orderType: ${params.orderType}. Must be one of MARKET_INCREASE, MARKET_DECREASE, LIMIT_INCREASE, LIMIT_DECREASE`);
    }

    const tifEnum = params.tif ? TimeInForceEnum[params.tif] : TimeInForceEnum.GTC;

    const owner = this.subaccount?.ownerAddress ?? ethers.ZeroAddress;

    return {
      orderType: orderTypeEnum,
      market: params.market,
      sizeDelta: params.sizeDelta !== undefined ? params.sizeDelta : "0",
      collateralDelta: params.collateralDelta !== undefined ? params.collateralDelta : "0",
      triggerPrice: params.triggerPrice ?? "0",
      isLong: params.isLong,
      maxSlippage: params.maxSlippage ?? this.defaultMaxSlippage,
      positionId: params.positionId ?? 0,
      collateralType: COLLATERAL_TYPE_USDC,
      collateralToken: ethers.ZeroAddress, // USDC is resolved by collateralType
      tif: tifEnum,
      stopLossPrice: params.stopLossPrice ?? "0",
      takeProfitPrice: params.takeProfitPrice ?? "0",
      visibleSize: params.visibleSize ?? "0",
      twapInterval: params.twapInterval ?? 0,
      isReduceOnly: params.isReduceOnly ?? false,
      owner,
    };
  }

  /**
   * Build and broadcast a createOrder transaction.
   * @param params Order parameters
   * @param executionFee ETH value to send with the transaction (for keeper execution fee)
   * @returns Transaction response from ethers
   */
  async createOrder(params: OrderParams, executionFee?: string): Promise<ethers.ContractTransactionResponse> {
    const tuple = this.buildParams(params);
    const value = executionFee ?? "0";
    const tx = await (this.contract.getFunction("createOrder") as any)(
      tuple,
      { value: ethers.parseEther(value) }
    ) as ethers.ContractTransactionResponse;
    return tx;
  }

  /**
   * Convenience: build and send, wait for receipt, and return the emitted orderId.
   * @returns The orderId from the OrderCreated event
   */
  async createOrderAndWait(params: OrderParams, executionFee?: string): Promise<{ orderId: bigint; receipt: ethers.ContractTransactionReceipt }> {
    const tx = await this.createOrder(params, executionFee);
    const receipt = await tx.wait();

    if (!receipt) {
      throw new Error("Transaction receipt is null");
    }

    // Parse OrderCreated event to get orderId
    const iface = new ethers.Interface(TRADING_CORE_ABI);
    let orderId = 0n;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed && parsed.name === "OrderCreated") {
          orderId = BigInt(parsed.args[0]);
          break;
        }
      } catch {
        // Skip logs we can't parse
      }
    }

    return { orderId, receipt };
  }

  /**
   * Create a market buy (long) order.
   */
  async marketBuy(market: string, sizeDelta: string, collateralDelta: string, opts?: Partial<OrderParams>): Promise<ethers.ContractTransactionResponse> {
    return this.createOrder({
      market,
      sizeDelta,
      collateralDelta,
      isLong: true,
      orderType: "MARKET_INCREASE",
      ...opts,
    });
  }

  /**
   * Create a market sell (short) order.
   */
  async marketSell(market: string, sizeDelta: string, collateralDelta: string, opts?: Partial<OrderParams>): Promise<ethers.ContractTransactionResponse> {
    return this.createOrder({
      market,
      sizeDelta,
      collateralDelta,
      isLong: false,
      orderType: "MARKET_INCREASE",
      ...opts,
    });
  }

  /**
   * Create a limit buy order.
   */
  async limitBuy(market: string, sizeDelta: string, collateralDelta: string, triggerPrice: string, opts?: Partial<OrderParams>): Promise<ethers.ContractTransactionResponse> {
    return this.createOrder({
      market,
      sizeDelta,
      collateralDelta,
      isLong: true,
      orderType: "LIMIT_INCREASE",
      triggerPrice,
      ...opts,
    });
  }

  /**
   * Create a limit sell order.
   */
  async limitSell(market: string, sizeDelta: string, collateralDelta: string, triggerPrice: string, opts?: Partial<OrderParams>): Promise<ethers.ContractTransactionResponse> {
    return this.createOrder({
      market,
      sizeDelta,
      collateralDelta,
      isLong: false,
      orderType: "LIMIT_INCREASE",
      triggerPrice,
      ...opts,
    });
  }

  /**
   * Create a market decrease/close order for an existing position.
   */
  async marketClose(positionId: number, sizeDelta: string, minReceive?: string, opts?: Partial<OrderParams>): Promise<ethers.ContractTransactionResponse> {
    return this.createOrder({
      market: opts?.market ?? ethers.ZeroAddress,
      sizeDelta,
      collateralDelta: "0",
      isLong: opts?.isLong ?? true,
      orderType: "MARKET_DECREASE",
      positionId,
      maxSlippage: minReceive ? parseInt(minReceive) : undefined,
      ...opts,
    });
  }

  /**
   * Create a reduce-only order (close position at limit price).
   */
  async reduceOnlyLimit(positionId: number, market: string, sizeDelta: string, triggerPrice: string, isLong: boolean, opts?: Partial<OrderParams>): Promise<ethers.ContractTransactionResponse> {
    return this.createOrder({
      market,
      sizeDelta,
      collateralDelta: "0",
      isLong,
      orderType: "LIMIT_DECREASE",
      triggerPrice,
      positionId,
      isReduceOnly: true,
      ...opts,
    });
  }
}