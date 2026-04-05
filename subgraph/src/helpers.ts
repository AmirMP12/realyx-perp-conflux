import { Address, BigInt } from "@graphprotocol/graph-ts";
import { Protocol, Market, User } from "../generated/schema";

const PROTOCOL_ID = "1";
const ZERO = BigInt.fromI32(0);

export function getOrCreateProtocol(tradingCore: Address): Protocol {
  let protocol = Protocol.load(PROTOCOL_ID);
  if (protocol == null) {
    protocol = new Protocol(PROTOCOL_ID);
    protocol.tradingCore = tradingCore;
    protocol.vaultCore = Address.zero();
    protocol.oracleAggregator = Address.zero();
    protocol.positionToken = Address.zero();
    protocol.chainId = 71;
    protocol.totalPositionsOpened = ZERO;
    protocol.totalPositionsClosed = ZERO;
    protocol.totalTrades = ZERO;
    protocol.totalVolumeUsd = ZERO;
    protocol.totalFeesUsd = ZERO;
    protocol.totalLiquidations = ZERO;
    protocol.tvl = ZERO;
    protocol.tvlUpdatedAt = ZERO;
    protocol.save();
  }
  return protocol as Protocol;
}

export function getOrCreateMarket(marketAddress: Address, timestamp: BigInt): Market {
  let id = marketAddress.toHexString();
  let market = Market.load(id);
  if (market == null) {
    market = new Market(id);
    market.marketAddress = marketAddress;
    market.maxLeverage = ZERO;
    market.maxPositionSize = ZERO;
    market.maxTotalExposure = ZERO;
    market.totalLongSize = ZERO;
    market.totalShortSize = ZERO;
    market.totalLongCost = ZERO;
    market.totalShortCost = ZERO;
    market.isActive = true;
    market.isListed = true;
    market.fundingRate = ZERO;
    market.cumulativeFunding = ZERO;
    market.lastFundingTime = ZERO;
    market.longOpenInterest = ZERO;
    market.shortOpenInterest = ZERO;
    market.createdAt = timestamp;
    market.updatedAt = timestamp;
    market.save();
  }
  return market as Market;
}

export function getOrCreateUser(userAddress: Address, timestamp: BigInt): User {
  let id = userAddress.toHexString();
  let user = User.load(id);
  if (user == null) {
    user = new User(id);
    user.address = userAddress;
    user.totalPositions = 0;
    user.totalTrades = ZERO;
    user.totalVolumeUsd = ZERO;
    user.totalRealizedPnl = ZERO;
    user.firstSeenAt = timestamp;
    user.lastSeenAt = timestamp;
    user.save();
  }
  return user as User;
}

export function orderTypeName(orderType: i32): string {
  if (orderType == 0) return "MARKET_INCREASE";
  if (orderType == 1) return "MARKET_DECREASE";
  if (orderType == 2) return "LIMIT_INCREASE";
  if (orderType == 3) return "LIMIT_DECREASE";
  return "UNKNOWN";
}
