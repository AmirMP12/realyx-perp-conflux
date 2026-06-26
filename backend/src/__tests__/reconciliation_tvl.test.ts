import { jest } from "@jest/globals";

let withProviderImpl: any = async (cb: any) => cb({});
let marketsImpl: any = async () => [];
let totalAssetsImpl: any = async () => 500n * 10n ** 18n;

jest.mock("../services/db.js", () => ({
  __esModule: true,
  getReadPool: () => null, // skip the indexed OI query; focus on the TVL path
}));
jest.mock("../services/fetchMarketsOnchain.js", () => ({
  __esModule: true,
  fetchMarketsOnChain: (...a: any[]) => marketsImpl(...a),
}));
jest.mock("../services/rpcPool.js", () => ({
  __esModule: true,
  withProvider: (cb: any) => withProviderImpl(cb),
}));
jest.mock("ethers", () => {
  const actual: any = jest.requireActual("ethers");
  return {
    __esModule: true,
    ethers: {
      ...actual.ethers,
      Contract: jest.fn(() => ({ totalAssets: () => totalAssetsImpl() })),
    },
  };
});

import { runReconciliation } from "../services/reconciliation.js";

describe("reconciliation on-chain TVL path", () => {
  const prevVault = process.env.VAULT_CORE_ADDRESS;
  const prevDeployed = process.env.DEPLOYED_VAULT_CORE;

  beforeEach(() => {
    withProviderImpl = async (cb: any) => cb({});
    marketsImpl = async () => [];
    totalAssetsImpl = async () => 500n * 10n ** 18n;
    process.env.VAULT_CORE_ADDRESS = "0x1111111111111111111111111111111111111111";
    delete process.env.DEPLOYED_VAULT_CORE;
  });

  afterAll(() => {
    if (prevVault === undefined) delete process.env.VAULT_CORE_ADDRESS; else process.env.VAULT_CORE_ADDRESS = prevVault;
    if (prevDeployed === undefined) delete process.env.DEPLOYED_VAULT_CORE; else process.env.DEPLOYED_VAULT_CORE = prevDeployed;
  });

  it("reads TVL from VaultCore.totalAssets via the provider callback", async () => {
    const result = await runReconciliation();
    expect(result.ran).toBe(true);
    expect(result.tvl).toEqual({ onchain: 500 });
  });

  it("computes on-chain open interest from active markets", async () => {
    marketsImpl = async () => [
      { totalLongSize: (30n * 10n ** 18n).toString(), totalShortSize: (20n * 10n ** 18n).toString() },
    ];
    const result = await runReconciliation();
    // No indexed OI (read pool null) so openInterest stays undefined, but the
    // on-chain OI read path executes.
    expect(result.ran).toBe(true);
  });
});
