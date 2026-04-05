import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";

export class PriceUpdated extends ethereum.Event {
  get params(): PriceUpdatedEventParams {
    return new PriceUpdatedEventParams(this);
  }
}
class PriceUpdatedEventParams {
  constructor(private event: ethereum.Event) {}
  get market(): Address { return this.event.parameters[0].value.toAddress(); }
  get price(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get confidence(): BigInt { return this.event.parameters[2].value.toBigInt(); }
  get timestamp(): BigInt { return this.event.parameters[3].value.toBigInt(); }
}

export class BreakerTriggered extends ethereum.Event {
  get params(): BreakerTriggeredEventParams {
    return new BreakerTriggeredEventParams(this);
  }
}
class BreakerTriggeredEventParams {
  constructor(private event: ethereum.Event) {}
  get market(): Address { return this.event.parameters[0].value.toAddress(); }
  get breakerType(): i32 { return this.event.parameters[1].value.toI32(); }
  get threshold(): BigInt { return this.event.parameters[2].value.toBigInt(); }
  get actualValue(): BigInt { return this.event.parameters[3].value.toBigInt(); }
}

export class BreakerReset extends ethereum.Event {
  get params(): BreakerResetEventParams {
    return new BreakerResetEventParams(this);
  }
}
class BreakerResetEventParams {
  constructor(private event: ethereum.Event) {}
  get market(): Address { return this.event.parameters[0].value.toAddress(); }
  get breakerType(): i32 { return this.event.parameters[1].value.toI32(); }
  get resetBy(): Address { return this.event.parameters[2].value.toAddress(); }
}
