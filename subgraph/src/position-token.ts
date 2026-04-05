import { PositionTokenMinted, PositionTokenBurned } from "./generated/PositionToken/PositionToken";
import { getOrCreateMarket } from "./helpers";
import { PositionTokenEvent } from "../generated/schema";

export function handlePositionTokenMinted(event: PositionTokenMinted): void {
  let marketId = event.params.market.toHexString();
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let e = new PositionTokenEvent(id);
  e.tokenId = event.params.tokenId;
  e.to = event.params.to;
  e.market = marketId;
  e.isLong = event.params.isLong;
  e.minted = true;
  e.timestamp = event.block.timestamp;
  e.blockNumber = event.block.number;
  e.txHash = event.transaction.hash;
  e.save();
}

export function handlePositionTokenBurned(event: PositionTokenBurned): void {
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let e = new PositionTokenEvent(id);
  e.tokenId = event.params.tokenId;
  e.to = event.address;
  e.isLong = false; // Default or could be looked up if needed, but schema requires it
  e.minted = false;
  e.timestamp = event.block.timestamp;
  e.blockNumber = event.block.number;
  e.txHash = event.transaction.hash;
  e.save();
}
