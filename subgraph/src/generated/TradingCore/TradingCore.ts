import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";

export class PositionOpened extends ethereum.Event {
  get params(): PositionOpenedEventParams {
    return new PositionOpenedEventParams(this);
  }
}
class PositionOpenedEventParams {
  constructor(private event: ethereum.Event) {}
  get positionId(): BigInt { return this.event.parameters[0].value.toBigInt(); }
  get trader(): Address { return this.event.parameters[1].value.toAddress(); }
  get market(): Address { return this.event.parameters[2].value.toAddress(); }
  get isLong(): boolean { return this.event.parameters[3].value.toBoolean(); }
  get size(): BigInt { return this.event.parameters[4].value.toBigInt(); }
  get leverage(): BigInt { return this.event.parameters[5].value.toBigInt(); }
  get entryPrice(): BigInt { return this.event.parameters[6].value.toBigInt(); }
}

export class PositionClosed extends ethereum.Event {
  get params(): PositionClosedEventParams {
    return new PositionClosedEventParams(this);
  }
}
class PositionClosedEventParams {
  constructor(private event: ethereum.Event) {}
  get positionId(): BigInt { return this.event.parameters[0].value.toBigInt(); }
  get trader(): Address { return this.event.parameters[1].value.toAddress(); }
  get realizedPnL(): BigInt { return this.event.parameters[2].value.toBigInt(); }
  get exitPrice(): BigInt { return this.event.parameters[3].value.toBigInt(); }
  get closingFee(): BigInt { return this.event.parameters[4].value.toBigInt(); }
}

export class PositionLiquidated extends ethereum.Event {
  get params(): PositionLiquidatedEventParams {
    return new PositionLiquidatedEventParams(this);
  }
}
class PositionLiquidatedEventParams {
  constructor(private event: ethereum.Event) {}
  get positionId(): BigInt { return this.event.parameters[0].value.toBigInt(); }
  get liquidator(): Address { return this.event.parameters[1].value.toAddress(); }
  get liquidationPrice(): BigInt { return this.event.parameters[2].value.toBigInt(); }
  get liquidationFee(): BigInt { return this.event.parameters[3].value.toBigInt(); }
}

export class PositionModified extends ethereum.Event {
  get params(): PositionModifiedEventParams {
    return new PositionModifiedEventParams(this);
  }
}
class PositionModifiedEventParams {
  constructor(private event: ethereum.Event) {}
  get positionId(): BigInt { return this.event.parameters[0].value.toBigInt(); }
  get newSize(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get newLeverage(): BigInt { return this.event.parameters[2].value.toBigInt(); }
  get newStopLoss(): BigInt { return this.event.parameters[3].value.toBigInt(); }
  get newTakeProfit(): BigInt { return this.event.parameters[4].value.toBigInt(); }
}

export class FundingSettled extends ethereum.Event {
  get params(): FundingSettledEventParams {
    return new FundingSettledEventParams(this);
  }
}
class FundingSettledEventParams {
  constructor(private event: ethereum.Event) {}
  get market(): Address { return this.event.parameters[0].value.toAddress(); }
  get fundingRate(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get cumulativeFunding(): BigInt { return this.event.parameters[2].value.toBigInt(); }
  get timestamp(): BigInt { return this.event.parameters[3].value.toBigInt(); }
}

export class OrderCreated extends ethereum.Event {
  get params(): OrderCreatedEventParams {
    return new OrderCreatedEventParams(this);
  }
}
class OrderCreatedEventParams {
  constructor(private event: ethereum.Event) {}
  get orderId(): BigInt { return this.event.parameters[0].value.toBigInt(); }
  get account(): Address { return this.event.parameters[1].value.toAddress(); }
  get orderType(): i32 { return this.event.parameters[2].value.toI32(); }
  get market(): Address { return this.event.parameters[3].value.toAddress(); }
}

export class OrderExecuted extends ethereum.Event {
  get params(): OrderExecutedEventParams {
    return new OrderExecutedEventParams(this);
  }
}
class OrderExecutedEventParams {
  constructor(private event: ethereum.Event) {}
  get orderId(): BigInt { return this.event.parameters[0].value.toBigInt(); }
  get positionId(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get keeper(): Address { return this.event.parameters[2].value.toAddress(); }
}

export class OrderCancelled extends ethereum.Event {
  get params(): OrderCancelledEventParams {
    return new OrderCancelledEventParams(this);
  }
}
class OrderCancelledEventParams {
  constructor(private event: ethereum.Event) {}
  get orderId(): BigInt { return this.event.parameters[0].value.toBigInt(); }
  get reason(): string { return this.event.parameters[1].value.toString(); }
}

export class MarketUpdated extends ethereum.Event {
  get params(): MarketUpdatedEventParams {
    return new MarketUpdatedEventParams(this);
  }
}
class MarketUpdatedEventParams {
  constructor(private event: ethereum.Event) {}
  get market(): Address { return this.event.parameters[0].value.toAddress(); }
  get maxLeverage(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get maxPositionSize(): BigInt { return this.event.parameters[2].value.toBigInt(); }
  get maxTotalExposure(): BigInt { return this.event.parameters[3].value.toBigInt(); }
}
