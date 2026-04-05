import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";

export class Deposit extends ethereum.Event {
  get params(): DepositEventParams {
    return new DepositEventParams(this);
  }
}
class DepositEventParams {
  constructor(private event: ethereum.Event) {}
  get user(): Address { return this.event.parameters[0].value.toAddress(); }
  get assets(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get shares(): BigInt { return this.event.parameters[2].value.toBigInt(); }
}

export class Withdraw extends ethereum.Event {
  get params(): WithdrawEventParams {
    return new WithdrawEventParams(this);
  }
}
class WithdrawEventParams {
  constructor(private event: ethereum.Event) {}
  get user(): Address { return this.event.parameters[0].value.toAddress(); }
  get assets(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get shares(): BigInt { return this.event.parameters[2].value.toBigInt(); }
}

export class WithdrawalQueued extends ethereum.Event {
  get params(): WithdrawalQueuedEventParams {
    return new WithdrawalQueuedEventParams(this);
  }
}
class WithdrawalQueuedEventParams {
  constructor(private event: ethereum.Event) {}
  get user(): Address { return this.event.parameters[0].value.toAddress(); }
  get shares(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get requestId(): BigInt { return this.event.parameters[2].value.toBigInt(); }
}

export class WithdrawalProcessed extends ethereum.Event {
  get params(): WithdrawalProcessedEventParams {
    return new WithdrawalProcessedEventParams(this);
  }
}
class WithdrawalProcessedEventParams {
  constructor(private event: ethereum.Event) {}
  get requestId(): BigInt { return this.event.parameters[0].value.toBigInt(); }
  get user(): Address { return this.event.parameters[1].value.toAddress(); }
  get assets(): BigInt { return this.event.parameters[2].value.toBigInt(); }
}

export class ExposureUpdated extends ethereum.Event {
  get params(): ExposureUpdatedEventParams {
    return new ExposureUpdatedEventParams(this);
  }
}
class ExposureUpdatedEventParams {
  constructor(private event: ethereum.Event) {}
  get market(): Address { return this.event.parameters[0].value.toAddress(); }
  get longExposure(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get shortExposure(): BigInt { return this.event.parameters[2].value.toBigInt(); }
}

export class InsuranceStaked extends ethereum.Event {
  get params(): InsuranceStakedEventParams {
    return new InsuranceStakedEventParams(this);
  }
}
class InsuranceStakedEventParams {
  constructor(private event: ethereum.Event) {}
  get user(): Address { return this.event.parameters[0].value.toAddress(); }
  get assets(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get shares(): BigInt { return this.event.parameters[2].value.toBigInt(); }
}

export class InsuranceUnstaked extends ethereum.Event {
  get params(): InsuranceUnstakedEventParams {
    return new InsuranceUnstakedEventParams(this);
  }
}
class InsuranceUnstakedEventParams {
  constructor(private event: ethereum.Event) {}
  get user(): Address { return this.event.parameters[0].value.toAddress(); }
  get assets(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get shares(): BigInt { return this.event.parameters[2].value.toBigInt(); }
}

export class BadDebtCovered extends ethereum.Event {
  get params(): BadDebtCoveredEventParams {
    return new BadDebtCoveredEventParams(this);
  }
}
class BadDebtCoveredEventParams {
  constructor(private event: ethereum.Event) {}
  get claimId(): BigInt { return this.event.parameters[0].value.toBigInt(); }
  get amount(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get positionId(): BigInt { return this.event.parameters[2].value.toBigInt(); }
}

export class ClaimSubmitted extends ethereum.Event {
  get params(): ClaimSubmittedEventParams {
    return new ClaimSubmittedEventParams(this);
  }
}
class ClaimSubmittedEventParams {
  constructor(private event: ethereum.Event) {}
  get claimId(): BigInt { return this.event.parameters[0].value.toBigInt(); }
  get amount(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get positionId(): BigInt { return this.event.parameters[2].value.toBigInt(); }
}
