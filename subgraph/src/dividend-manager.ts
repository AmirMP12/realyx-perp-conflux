import { DividendDistributed } from "./generated/DividendManager/DividendManager";
import { DividendDistribution } from "../generated/schema";

export function handleDividendDistributed(event: DividendDistributed): void {
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let e = new DividendDistribution(id);
  e.marketId = event.params.marketId;
  e.amountPerShare = event.params.amountPerShare;
  e.newIndex = event.params.newIndex;
  e.timestamp = event.block.timestamp;
  e.blockNumber = event.block.number;
  e.txHash = event.transaction.hash;
  e.save();
}
