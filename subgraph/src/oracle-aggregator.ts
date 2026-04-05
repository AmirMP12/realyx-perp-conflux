import { BigInt, Entity, store, Value } from "@graphprotocol/graph-ts";
import {
  PriceUpdated,
  BreakerTriggered,
  BreakerReset,
} from "./generated/OracleAggregator/OracleAggregator";
import { getOrCreateMarket } from "./helpers";
import { PriceSnapshot, BreakerEvent } from "../generated/schema";

export function handlePriceUpdated(event: PriceUpdated): void {
  let market = getOrCreateMarket(event.params.market, event.block.timestamp);
  let marketId = event.params.market.toHexString();
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let snap = new PriceSnapshot(id);
  snap.market = marketId;
  snap.price = event.params.price;
  snap.confidence = event.params.confidence;
  snap.timestamp = event.block.timestamp;
  snap.blockNumber = event.block.number;
  snap.txHash = event.transaction.hash;
  snap.save();
}

export function handleBreakerTriggered(event: BreakerTriggered): void {
  let marketId = event.params.market.toHexString();
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let b = new BreakerEvent(id);
  b.market = marketId;
  b.breakerType = event.params.breakerType;
  b.triggered = true;
  b.threshold = event.params.threshold;
  b.actualValue = event.params.actualValue;
  b.timestamp = event.block.timestamp;
  b.blockNumber = event.block.number;
  b.txHash = event.transaction.hash;
  b.save();
}

export function handleBreakerReset(event: BreakerReset): void {
  let marketId = event.params.market.toHexString();
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let b = new BreakerEvent(id);
  b.market = marketId;
  b.breakerType = event.params.breakerType;
  b.triggered = false;
  b.resetBy = event.params.resetBy;
  b.timestamp = event.block.timestamp;
  b.blockNumber = event.block.number;
  b.txHash = event.transaction.hash;
  b.save();
}
