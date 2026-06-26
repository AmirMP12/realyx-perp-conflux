/**
 * OrderBuilder — Construct, sign, and broadcast CreateOrderParams transactions
 * using ethers.js v6. Supports subaccount (delegated) trading.
 */

import { ethers } from "ethers";
import type { OrderParams, SubaccountConfig } from "./types";
import { OrderTypeEnum, TimeInForceEnum } from "./types";

/**
 * Minimal ABI for TradingCore.createOrder plus the OrderCreated event so we can
 * decode the emitted order id from a transaction receipt.
 *
 * Note: the event signature below mirrors the on-chain `OrderCreated` event. If
 * the deployed contract changes the event shape, update this signature so
 * `createOrderAndWait` can continue to resolve the order id.
 */
const TRADING_CORE_ABI = [
  "function createOrder(tuple(uint8 orderType, address market, uint256 sizeDelta, uint256 collateralDelta, uint256 triggerPrice, bool isLong, uint256 maxSlippage, uint256 positionId, uint8 collateralType, address collateralToken, uint8 tif, uint256 stopLossPrice, uint256 takeProfitPrice, uint256 visibleSize, uint256 twapInterval, bool isReduceOnly, address owner) params) external payable returns (uint256)",
  "event OrderCreated(uint256 indexed orderId, address indexed account, uint8 orderType, address market)",
];

/** CollateralType enum (mirrors DataTypes.sol) */
const COLLATERAL_TYPE_USDC = 1;

export interface OrderBuilderConfig {
  /** ethers Signer for the wallet that submits the transaction. Optional — can be set later via setSigner(). */
  signer?: ethers.Signer;
  /** TradingCore contract address */
  tradingCoreAddress: string;
  /** Optional subaccount config for delegated trading */
  subaccount?: SubaccountConfig;
  /** Default max slippage in BPS */
  defaultMaxSlippage?: number;
}

/** Tuple shape passed to TradingCore.createOrder. */
export interface CreateOrderTuple {
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
}

export class OrderBuilder {
  private signer?: ethers.Signer;
  private contract?: ethers.Contract;
  private tradingCoreAddress: string;
  private subaccount?: SubaccountConfig;
  private defaultMaxSlippage: number;
  private readonly iface: ethers.Interface;

  constructor(config: OrderBuilderConfig) {
    this.tradingCoreAddress = config.tradingCoreAddress;
    this.subaccount = config.subaccount;
    this.defaultMaxSlippage = config.defaultMaxSlippage ?? 50; // 0.5%
    this.iface = new ethers.Interface(TRADING_CORE_ABI);
    if (config.signer) {
      this.setSigner(config.signer);
    }
  }

  /**
   * Attach (or replace) the signing wallet used to broadcast transactions.
   * Required before calling createOrder when no subaccount was configured.
   */
  setSigner(signer: ethers.Signer): void {
    this.signer = signer;
    this.contract = new ethers.Contract(this.tradingCoreAddress, TRADING_CORE_ABI, signer);
  }

  /** Returns true once a signer has been attached. */
  hasSigner(): boolean {
    return !!this.signer && !!this.contract;
  }

  private requireContract(): ethers.Contract {
    if (!this.contract) {
      throw new Error(
        "OrderBuilder has no signer. Provide `subaccount` or `signer` in RealyxConfig, or call client.orders.setSigner(signer)."
      );
    }
    return this.contract;
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
  buildParams(params: OrderParams): CreateOrderTuple {
    const orderTypeEnum = OrderTypeEnum[params.orderType];
    if (orderTypeEnum === undefined) {
      throw new Error(
        `Invalid orderType: ${params.orderType}. Must be one of MARKET_INCREASE, MARKET_DECREASE, LIMIT_INCREASE, LIMIT_DECREASE`
      );
    }

    if (!ethers.isAddress(params.market)) {
      throw new Error(`Invalid market address: ${params.market}`);
    }

    const tifEnum = params.tif ? TimeInForceEnum[params.tif] : TimeInForceEnum.GTC;
    const owner = this.subaccount?.ownerAddress ?? ethers.ZeroAddress;

    return {
      orderType: orderTypeEnum,
      market: params.market,
      sizeDelta: params.sizeDelta ?? "0",
      collateralDelta: params.collateralDelta ?? "0",
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
   * @param executionFee Native value (in ether units) to send for the keeper execution fee
   * @returns Transaction response from ethers
   */
  async createOrder(params: OrderParams, executionFee?: string): Promise<ethers.ContractTransactionResponse> {
    const contract = this.requireContract();
    const tuple = this.buildParams(params);
    const value = ethers.parseEther(executionFee ?? "0");
    const tx = (await contract.getFunction("createOrder")(tuple, { value })) as ethers.ContractTransactionResponse;
    return tx;
  }

  /**
   * Convenience: build and send, wait for receipt, and return the emitted orderId.
   * @returns The orderId from the OrderCreated event (0n if the event was not found)
   */
  async createOrderAndWait(
    params: OrderParams,
    executionFee?: string
  ): Promise<{ orderId: bigint; receipt: ethers.ContractTransactionReceipt }> {
    const tx = await this.createOrder(params, executionFee);
    const receipt = await tx.wait();

    if (!receipt) {
      throw new Error("Transaction receipt is null");
    }

    const orderId = this.parseOrderId(receipt);
    return { orderId, receipt };
  }

  /** Decode the orderId from an OrderCreated event in a receipt. Returns 0n if absent. */
  parseOrderId(receipt: ethers.ContractTransactionReceipt): bigint {
    for (const log of receipt.logs) {
      try {
        const parsed = this.iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed && parsed.name === "OrderCreated") {
          return BigInt(parsed.args[0]);
        }
      } catch {
        // Skip logs we can't parse
      }
    }
    return 0n;
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
  async marketClose(positionId: number, sizeDelta: string, opts?: Partial<OrderParams>): Promise<ethers.ContractTransactionResponse> {
    return this.createOrder({
      market: opts?.market ?? ethers.ZeroAddress,
      sizeDelta,
      collateralDelta: "0",
      isLong: opts?.isLong ?? true,
      orderType: "MARKET_DECREASE",
      positionId,
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
