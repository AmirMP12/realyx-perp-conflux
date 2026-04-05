import { BigInt, ethereum } from "@graphprotocol/graph-ts";

export class DividendDistributed extends ethereum.Event {
  get params(): DividendDistributedEventParams {
    return new DividendDistributedEventParams(this);
  }
}
class DividendDistributedEventParams {
  constructor(private event: ethereum.Event) {}
  get marketId(): string { return this.event.parameters[0].value.toString(); }
  get amountPerShare(): BigInt { return this.event.parameters[1].value.toBigInt(); }
  get newIndex(): BigInt { return this.event.parameters[2].value.toBigInt(); }
  get timestamp(): BigInt { return this.event.parameters[3].value.toBigInt(); }
}
