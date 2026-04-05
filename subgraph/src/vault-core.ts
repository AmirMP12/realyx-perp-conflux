import { BigInt, Bytes, Address } from "@graphprotocol/graph-ts";
import {
  Deposit,
  Withdraw,
  WithdrawalQueued,
  WithdrawalProcessed,
  ExposureUpdated,
  InsuranceStaked,
  InsuranceUnstaked,
  BadDebtCovered,
  ClaimSubmitted,
} from "./generated/VaultCore/VaultCore";
import { getOrCreateUser } from "./helpers";
import { VaultDeposit, WithdrawalRequest, InsuranceStake, BadDebtClaim } from "../generated/schema";

export function handleDeposit(event: Deposit): void {
  let user = getOrCreateUser(event.params.user, event.block.timestamp);
  let userId = event.params.user.toHexString();
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let dep = new VaultDeposit(id);
  dep.user = userId;
  dep.assets = event.params.assets;
  dep.shares = event.params.shares;
  dep.isDeposit = true;
  dep.timestamp = event.block.timestamp;
  dep.blockNumber = event.block.number;
  dep.txHash = event.transaction.hash;
  dep.save();
}

export function handleWithdraw(event: Withdraw): void {
  let userId = event.params.user.toHexString();
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let w = new VaultDeposit(id);
  w.user = userId;
  w.assets = event.params.assets;
  w.shares = event.params.shares;
  w.isDeposit = false;
  w.timestamp = event.block.timestamp;
  w.blockNumber = event.block.number;
  w.txHash = event.transaction.hash;
  w.save();
}

export function handleWithdrawalQueued(event: WithdrawalQueued): void {
  let userId = event.params.user.toHexString();
  let requestId = event.params.requestId.toString();
  let req = new WithdrawalRequest(requestId);
  req.requestId = event.params.requestId;
  req.user = userId;
  req.shares = event.params.shares;
  req.minAssets = BigInt.fromI32(0);
  req.requestTime = event.block.timestamp;
  req.processed = false;
  req.blockNumber = event.block.number;
  req.txHash = event.transaction.hash;
  req.save();
}

export function handleWithdrawalProcessed(event: WithdrawalProcessed): void {
  let requestId = event.params.requestId.toString();
  let req = WithdrawalRequest.load(requestId);
  if (!req) return;
  req.processed = true;
  req.processedAt = event.block.timestamp;
  req.assetsReceived = event.params.assets;
  req.save();
}

export function handleExposureUpdated(_event: ExposureUpdated): void {}

export function handleInsuranceStaked(event: InsuranceStaked): void {
  let userId = event.params.user.toHexString();
  getOrCreateUser(event.params.user, event.block.timestamp);
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let s = new InsuranceStake(id);
  s.user = userId;
  s.assets = event.params.assets;
  s.shares = event.params.shares;
  s.isStake = true;
  s.timestamp = event.block.timestamp;
  s.blockNumber = event.block.number;
  s.txHash = event.transaction.hash;
  s.save();
}

export function handleInsuranceUnstaked(event: InsuranceUnstaked): void {
  let userId = event.params.user.toHexString();
  getOrCreateUser(event.params.user, event.block.timestamp);
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let s = new InsuranceStake(id);
  s.user = userId;
  s.assets = event.params.assets;
  s.shares = event.params.shares;
  s.isStake = false;
  s.timestamp = event.block.timestamp;
  s.blockNumber = event.block.number;
  s.txHash = event.transaction.hash;
  s.save();
}

export function handleBadDebtCovered(event: BadDebtCovered): void {
  let claimId = event.params.claimId.toString();
  let c = BadDebtClaim.load(claimId);
  if (c) {
    c.coveredAt = event.block.timestamp;
    c.save();
  }
}

export function handleClaimSubmitted(event: ClaimSubmitted): void {
  let claimId = event.params.claimId.toString();
  let c = new BadDebtClaim(claimId);
  c.claimId = event.params.claimId;
  c.positionId = event.params.positionId;
  c.amount = event.params.amount;
  c.submittedAt = event.block.timestamp;
  c.blockNumber = event.block.number;
  c.txHash = event.transaction.hash;
  c.save();
}
