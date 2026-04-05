import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";

export class PositionTokenMinted extends ethereum.Event {
  get params(): PositionTokenMintedEventParams {
    return new PositionTokenMintedEventParams(this);
  }
}
class PositionTokenMintedEventParams {
  constructor(private event: ethereum.Event) {}
  get to(): Address { return this.event.parameters[0].value.toAddress(); }
  get tokenId(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get market(): Address { return this.event.parameters[2].value.toAddress(); }
  get isLong(): boolean { return this.event.parameters[3].value.toBoolean(); }
}

export class PositionTokenBurned extends ethereum.Event {
  get params(): PositionTokenBurnedEventParams {
    return new PositionTokenBurnedEventParams(this);
  }
}
class PositionTokenBurnedEventParams {
  constructor(private event: ethereum.Event) {}
  get tokenId(): BigInt { return this.event.parameters[0].value.toBigInt(); }
}
