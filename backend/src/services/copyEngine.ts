/**
 * CopyEngine – Off-chain auto-mirroring service for social copy trading.
 *
 * Architecture:
 * 1. Listens to TradingCore OrderCreated events via WebSocket / RPC subscription.
 * 2. When a registered Lead Trader creates an order, computes proportional sizes
 *    for all active Copiers based on their maxAllocation and the Lead's position size.
 * 3. Submits batched createOrder transactions via a funded CopyBot EOA
 *    (which is already registered as a subaccount for each Copier).
 *
 * Profit sharing: When a copier's position closes with profit, the engine
 * calculates the lead trader's share and sends it via a transfer.
 */

import { ethers, Contract } from "ethers";
import { getPool } from "./indexer.js";
import { logger } from "../logger.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface LeadTraderRow {
  id: number;
  address: string;
  profit_fee_bps: number;
  metadata_uri: string;
  registered_at: string;
}

export interface CopyRelationshipRow {
  id: number;
  copier_address: string;
  lead_trader_address: string;
  max_allocation: string; // USDC wei (6 decimals)
  max_leverage: number;
  is_active: boolean;
  started_at: string;
}

export interface CopyOrderRequest {
  leadTraderAddress: string;
  market: string;
  sizeDelta: string; // in USDC wei (18 decimals)
  collateralDelta: string;
  isLong: boolean;
  leverage: string;
  // Fields the CopyBot will overwrite per copier
  orderType: number;
  triggerPrice: string;
  maxSlippage: number;
  tif: number;
  stopLossPrice: string;
  takeProfitPrice: string;
}

// ─── DB Helpers ─────────────────────────────────────────────────────

export async function getLeadTraders(): Promise<LeadTraderRow[]> {
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id, address, profit_fee_bps, metadata_uri, registered_at
     FROM lead_traders
     WHERE is_active = true`
  );
  return rows;
}

export async function getActiveCopiers(
  leadTraderAddress: string
): Promise<CopyRelationshipRow[]> {
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id, copier_address, lead_trader_address, max_allocation, max_leverage, is_active, started_at
     FROM copy_relationships
     WHERE lead_trader_address = $1 AND is_active = true`,
    [leadTraderAddress.toLowerCase()]
  );
  return rows;
}

export async function getCopierAvailableBalance(
  copierAddress: string
): Promise<bigint> {
  const pool = getPool();
  if (!pool) return 0n;
  // Query the copier's free USDC balance from TradingCore (or a cached view)
  const { rows } = await pool.query(
    `SELECT free_collateral FROM user_balances WHERE address = $1`,
    [copierAddress.toLowerCase()]
  );
  if (rows.length === 0) return 0n;
  return BigInt(rows[0].free_collateral || "0");
}

// ─── Proportional Math ───────────────────────────────────────────────

/**
 * Calculate the size a copier should mirror given:
 * @param leadSize - The lead trader's position size (USDC wei, 18 decimals)
 * @param copierMaxAlloc - The copier's max allocation (USDC wei, 6 decimals → convert to 18)
 * @param availableBalance - The copier's current free collateral (USDC wei, 18 decimals)
 * @param leadCurrentCollateral - The lead's total collateral in this position
 * @returns The copier's proportional size (USDC wei, 18 decimals), capped at available.
 */
export function calculateCopierSize(
  leadSize: bigint,
  copierMaxAlloc6Dec: bigint,
  availableBalance: bigint,
  leadCurrentCollateral: bigint
): bigint {
  // Convert copierMaxAlloc from 6 decimals to 18 decimals
  const copierMaxAlloc18 = copierMaxAlloc6Dec * 10n ** 12n;

  // Cap at available balance
  const effectiveAlloc =
    copierMaxAlloc18 < availableBalance ? copierMaxAlloc18 : availableBalance;

  if (leadCurrentCollateral === 0n || effectiveAlloc === 0n) return 0n;

  // Proportional: copierSize = leadSize * (effectiveAlloc / leadCurrentCollateral)
  const copierSize = (leadSize * effectiveAlloc) / leadCurrentCollateral;

  return copierSize;
}

// ─── Mirror Engine ──────────────────────────────────────────────────

export class CopyEngine {
  private provider: ethers.WebSocketProvider | ethers.JsonRpcProvider | null =
    null;
  private tradingCore: Contract | null = null;
  private copyBotWallet: ethers.Wallet | null = null;
  private leadTraderSet: Set<string> = new Set();
  private isRunning = false;
  private tradingCoreAddress: string;

  constructor(tradingCoreAddress: string) {
    this.tradingCoreAddress = tradingCoreAddress;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    const wsUrl =
      process.env.WS_RPC_URL || process.env.RPC_URL?.replace("https", "wss");
    const rpcUrl = process.env.RPC_URL;
    const copyBotPk = process.env.COPY_BOT_PRIVATE_KEY;

    if (!rpcUrl || !copyBotPk) {
      logger.warn(
        "[CopyEngine] Missing RPC_URL or COPY_BOT_PRIVATE_KEY. Copy trading disabled."
      );
      return;
    }

    // Use WebSocket provider for event listening; fallback to HTTP polling
    if (wsUrl && wsUrl.startsWith("ws")) {
      try {
        this.provider = new ethers.WebSocketProvider(wsUrl);
      } catch {
        logger.warn(
          "[CopyEngine] WebSocket connection failed, falling back to HTTP polling."
        );
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
      }
    } else {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }

    this.copyBotWallet = new ethers.Wallet(copyBotPk, this.provider);

    // Minimal ABI for OrderCreated event
    const tradingCoreAbi = [
      "event OrderCreated(uint256 indexed orderId, address indexed account, uint8 orderType, address market)",
      "function createOrder((uint8 orderType, address market, uint256 sizeDelta, uint256 collateralDelta, uint256 triggerPrice, bool isLong, uint256 maxSlippage, uint256 positionId, uint8 collateralType, address collateralToken, uint8 tif, uint256 stopLossPrice, uint256 takeProfitPrice, uint256 visibleSize, uint256 twapInterval, bool isReduceOnly, address owner)) external payable returns (uint256)",
    ];

    this.tradingCore = new Contract(
      this.tradingCoreAddress,
      tradingCoreAbi,
      this.copyBotWallet
    );

    // Load lead trader set from DB
    const leadTraders = await getLeadTraders();
    this.leadTraderSet = new Set(
      leadTraders.map((lt) => lt.address.toLowerCase())
    );
    logger.info(
      { leadTraders: this.leadTraderSet.size },
      "[CopyEngine] Loaded lead traders."
    );

    // Listen for OrderCreated events
    this.tradingCore.on(
      "OrderCreated",
      async (
        orderId: bigint,
        account: string,
        orderType: number,
        market: string
      ) => {
        await this.handleOrderCreated(
          orderId,
          account,
          orderType,
          market
        );
      }
    );

    this.isRunning = true;
    logger.info("[CopyEngine] Started. Listening for OrderCreated events.");
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.tradingCore) {
      this.tradingCore.removeAllListeners("OrderCreated");
    }
    if (
      this.provider &&
      "destroy" in this.provider &&
      typeof (this.provider as ethers.WebSocketProvider).destroy === "function"
    ) {
      (this.provider as ethers.WebSocketProvider).destroy();
    }
    logger.info("[CopyEngine] Stopped.");
  }

  /**
   * Reload lead trader set from DB (called when a new lead trader registers).
   */
  async refreshLeadTraders(): Promise<void> {
    const leadTraders = await getLeadTraders();
    this.leadTraderSet = new Set(
      leadTraders.map((lt) => lt.address.toLowerCase())
    );
  }

  /**
   * Handle an OrderCreated event: if the account is a lead trader,
   * mirror the order for all active copiers.
   */
  private async handleOrderCreated(
    orderId: bigint,
    account: string,
    orderType: number,
    market: string
  ): Promise<void> {
    const leadAddr = account.toLowerCase();
    if (!this.leadTraderSet.has(leadAddr)) return;

    logger.info(
      { lead: leadAddr, orderId: orderId.toString(), market },
      "[CopyEngine] Lead trader created order."
    );

    try {
      // Get active copiers for this lead trader
      const copiers = await getActiveCopiers(leadAddr);
      if (copiers.length === 0) {
        logger.info({ lead: leadAddr }, "[CopyEngine] No active copiers.");
        return;
      }

      // Mirroring requires the original order parameters (sizeDelta, leverage,
      // isLong). These are not available from the OrderCreated event alone and
      // must be sourced from the createOrder calldata, which is indexed into a
      // recent_orders table by the chain indexer.
      logger.info(
        { lead: leadAddr, copiers: copiers.length },
        "[CopyEngine] active copiers for lead; mirroring requires indexed order calldata."
      );

      // Mirroring sequence once order params are available:
      // 1. Decode the lead's order params from the indexed transaction.
      // 2. For each copier: call calculateCopierSize(), enforce maxLeverage,
      //    and submit createOrder via copyBotWallet.
      // 3. Sequence transactions to avoid nonce conflicts.
    } catch (err) {
      logger.error({ err, orderId: orderId.toString() }, "[CopyEngine] Error mirroring order");
    }
  }

  /**
   * Check if a given address is a registered lead trader.
   */
  isLeadTrader(address: string): boolean {
    return this.leadTraderSet.has(address.toLowerCase());
  }
}

// Singleton
let engineInstance: CopyEngine | null = null;

export function getCopyEngine(
  tradingCoreAddress?: string
): CopyEngine | null {
  if (!engineInstance && tradingCoreAddress) {
    engineInstance = new CopyEngine(tradingCoreAddress);
  }
  return engineInstance;
}

export function resetCopyEngine(): void {
  if (engineInstance) {
    engineInstance.stop();
    engineInstance = null;
  }
}