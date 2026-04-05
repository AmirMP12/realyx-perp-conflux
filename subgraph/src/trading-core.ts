import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts";
import {
  PositionOpened,
  PositionClosed,
  PositionLiquidated,
  PositionModified,
  FundingSettled,
  OrderCreated,
  OrderExecuted,
  OrderCancelled,
  MarketUpdated,
} from "./generated/TradingCore/TradingCore";
import {
  getOrCreateProtocol,
  getOrCreateMarket,
  getOrCreateUser,
  orderTypeName,
} from "./helpers";
import { Position, Trade, Order, PositionModification, FundingSnapshot } from "../generated/schema";

export function handlePositionOpened(event: PositionOpened): void {
  let protocol = getOrCreateProtocol(event.address);
  let market = getOrCreateMarket(event.params.market, event.block.timestamp);
  let user = getOrCreateUser(event.params.trader, event.block.timestamp);
  let marketId = event.params.market.toHexString();
  let userId = event.params.trader.toHexString();

  let positionId = event.params.positionId.toString();
  let position = new Position(positionId);
  position.positionId = event.params.positionId;
  position.tokenId = event.params.positionId;
  position.trader = userId;
  position.market = marketId;
  position.isLong = event.params.isLong;
  position.size = event.params.size;
  position.entryPrice = event.params.entryPrice;
  position.liquidationPrice = BigInt.fromI32(0);
  position.stopLossPrice = BigInt.fromI32(0);
  position.takeProfitPrice = BigInt.fromI32(0);
  position.leverage = event.params.leverage;
  position.collateralAmount = BigInt.fromI32(0);
  position.state = "OPEN";
  position.openTimestamp = event.block.timestamp;
  position.lastFundingTime = event.block.timestamp;
  position.createdAt = event.block.timestamp;
  position.updatedAt = event.block.timestamp;
  position.blockNumber = event.block.number;
  position.txHash = event.transaction.hash;
  position.save();

  let tradeId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let trade = new Trade(tradeId);
  trade.position = positionId;
  trade.trader = userId;
  trade.market = marketId;
  trade.type = "OPEN";
  trade.isLong = event.params.isLong;
  trade.size = event.params.size;
  trade.price = event.params.entryPrice;
  trade.realizedPnl = BigInt.fromI32(0);
  trade.fee = BigInt.fromI32(0);
  trade.timestamp = event.block.timestamp;
  trade.blockNumber = event.block.number;
  trade.txHash = event.transaction.hash;
  trade.save();

  user.totalPositions = user.totalPositions + 1;
  user.totalTrades = user.totalTrades.plus(BigInt.fromI32(1));
  user.lastSeenAt = event.block.timestamp;
  user.save();

  protocol.totalPositionsOpened = protocol.totalPositionsOpened.plus(BigInt.fromI32(1));
  protocol.totalTrades = protocol.totalTrades.plus(BigInt.fromI32(1));
  protocol.save();
}

export function handlePositionClosed(event: PositionClosed): void {
  let positionId = event.params.positionId.toString();
  let position = Position.load(positionId);
  if (position === null) return;

  position.state = "CLOSED";
  position.closeTimestamp = event.block.timestamp;
  position.updatedAt = event.block.timestamp;
  position.save();

  let user = getOrCreateUser(Address.fromBytes(Bytes.fromHexString(position.trader)), event.block.timestamp);
  if (user !== null) {
    user.totalRealizedPnl = user.totalRealizedPnl.plus(event.params.realizedPnL);
    user.lastSeenAt = event.block.timestamp;
    user.save();
  }

  let tradeId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let trade = new Trade(tradeId);
  trade.position = positionId;
  trade.trader = position.trader;
  trade.market = position.market;
  trade.type = "CLOSE";
  trade.isLong = position.isLong;
  trade.size = position.size;
  trade.price = event.params.exitPrice;
  trade.realizedPnl = event.params.realizedPnL;
  trade.fee = event.params.closingFee;
  trade.timestamp = event.block.timestamp;
  trade.blockNumber = event.block.number;
  trade.txHash = event.transaction.hash;
  trade.save();

  let protocol = getOrCreateProtocol(event.address);
  let vol = position.size.times(position.entryPrice).div(BigInt.fromString("1000000000000"));
  protocol.totalPositionsClosed = protocol.totalPositionsClosed.plus(BigInt.fromI32(1));
  protocol.totalTrades = protocol.totalTrades.plus(BigInt.fromI32(1));
  protocol.totalVolumeUsd = protocol.totalVolumeUsd.plus(vol);
  protocol.totalFeesUsd = protocol.totalFeesUsd.plus(event.params.closingFee);
  protocol.save();
}

export function handlePositionLiquidated(event: PositionLiquidated): void {
  let positionId = event.params.positionId.toString();
  let position = Position.load(positionId);
  if (position === null) return;

  position.state = "LIQUIDATED";
  position.closeTimestamp = event.block.timestamp;
  position.updatedAt = event.block.timestamp;
  position.save();

  let tradeId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let trade = new Trade(tradeId);
  trade.position = positionId;
  trade.trader = position.trader;
  trade.market = position.market;
  trade.type = "LIQUIDATE";
  trade.isLong = position.isLong;
  trade.size = position.size;
  trade.price = event.params.liquidationPrice;
  trade.realizedPnl = BigInt.fromI32(0);
  trade.fee = event.params.liquidationFee;
  trade.liquidator = event.params.liquidator;
  trade.timestamp = event.block.timestamp;
  trade.blockNumber = event.block.number;
  trade.txHash = event.transaction.hash;
  trade.save();

  let protocol = getOrCreateProtocol(event.address);
  protocol.totalLiquidations = protocol.totalLiquidations.plus(BigInt.fromI32(1));
  protocol.save();
}

export function handlePositionModified(event: PositionModified): void {
  let positionId = event.params.positionId.toString();
  let position = Position.load(positionId);
  if (position === null) return;

  position.size = event.params.newSize;
  position.leverage = event.params.newLeverage;
  position.stopLossPrice = event.params.newStopLoss;
  position.takeProfitPrice = event.params.newTakeProfit;
  position.updatedAt = event.block.timestamp;
  position.save();

  let modId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let mod = new PositionModification(modId);
  mod.position = positionId;
  mod.newSize = event.params.newSize;
  mod.newLeverage = event.params.newLeverage;
  mod.newStopLoss = event.params.newStopLoss;
  mod.newTakeProfit = event.params.newTakeProfit;
  mod.timestamp = event.block.timestamp;
  mod.blockNumber = event.block.number;
  mod.txHash = event.transaction.hash;
  mod.save();
}

export function handleFundingSettled(event: FundingSettled): void {
  let market = getOrCreateMarket(event.params.market, event.block.timestamp);
  let marketId = event.params.market.toHexString();
  market.fundingRate = event.params.fundingRate;
  market.cumulativeFunding = event.params.cumulativeFunding;
  market.lastFundingTime = event.block.timestamp;
  market.updatedAt = event.block.timestamp;
  market.save();

  let snapId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let snap = new FundingSnapshot(snapId);
  snap.market = marketId;
  snap.fundingRate = event.params.fundingRate;
  snap.cumulativeFunding = event.params.cumulativeFunding;
  snap.timestamp = event.block.timestamp;
  snap.blockNumber = event.block.number;
  snap.txHash = event.transaction.hash;
  snap.save();
}

export function handleOrderCreated(event: OrderCreated): void {
  let market = getOrCreateMarket(event.params.market, event.block.timestamp);
  let user = getOrCreateUser(event.params.account, event.block.timestamp);
  let marketId = event.params.market.toHexString();
  let userId = event.params.account.toHexString();

  let orderId = event.params.orderId.toString();
  let order = new Order(orderId);
  order.orderId = event.params.orderId;
  order.account = userId;
  order.market = marketId;
  order.orderType = orderTypeName(event.params.orderType);
  order.sizeDelta = BigInt.fromI32(0);
  order.triggerPrice = BigInt.fromI32(0);
  order.positionId = BigInt.fromI32(0);
  order.isLong = false;
  order.timestamp = event.block.timestamp;
  order.cancelled = false;
  order.blockNumber = event.block.number;
  order.txHash = event.transaction.hash;
  order.save();
}

export function handleOrderExecuted(event: OrderExecuted): void {
  let orderId = event.params.orderId.toString();
  let order = Order.load(orderId);
  if (order === null) return;
  order.executedAt = event.block.timestamp;
  order.executedPositionId = event.params.positionId;
  order.keeper = event.params.keeper;
  order.save();
}

export function handleOrderCancelled(event: OrderCancelled): void {
  let orderId = event.params.orderId.toString();
  let order = Order.load(orderId);
  if (order === null) return;
  order.cancelled = true;
  order.cancelReason = event.params.reason;
  order.save();
}

export function handleMarketUpdated(event: MarketUpdated): void {
  let market = getOrCreateMarket(event.params.market, event.block.timestamp);
  market.maxLeverage = event.params.maxLeverage;
  market.maxPositionSize = event.params.maxPositionSize;
  market.maxTotalExposure = event.params.maxTotalExposure;
  market.updatedAt = event.block.timestamp;
  market.save();
}
