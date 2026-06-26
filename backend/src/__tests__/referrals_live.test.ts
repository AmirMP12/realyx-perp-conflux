import { jest } from "@jest/globals";

const fetchReferralEarnedMock = jest.fn<any>();

jest.mock("../routes/sync.js", () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  checkAndSync: jest.fn(),
  runSync: jest.fn(),
}));

jest.mock("../services/indexer.js", () => ({
  __esModule: true,
  fetchReferralEarned: (...a: any[]) => fetchReferralEarnedMock(...a),
  fetchProtocol: jest.fn(),
  getPool: () => null,
}));

// Configurable contract behavior for the referral registry + vault.
let codeOfImpl: any = async () => "MYCODE";
let codeOfHashImpl: any = async () => "0x" + "1".repeat(64);
let refereeCountImpl: any = async () => 5n;
let claimableImpl: any = async () => 1_000_000n; // 1.0 USDC
let queryFilterImpl: any = async () => [];

jest.mock("ethers", () => {
  const actual: any = jest.requireActual("ethers");
  const Contract = jest.fn(() => ({
    codeOf: () => codeOfImpl(),
    codeOf_: () => codeOfHashImpl(),
    refereeCount: () => refereeCountImpl(),
    claimableRebates: () => claimableImpl(),
    filters: { RebateAccrued: () => ({}) },
    queryFilter: () => queryFilterImpl(),
  }));
  return {
    __esModule: true,
    ethers: {
      ...actual.ethers,
      Contract,
      JsonRpcProvider: jest.fn(() => ({
        getBlockNumber: async () => 250_000_000,
      })),
    },
  };
});

import request from "supertest";
import { app } from "../app.js";

const VALID = "0xabcdef0000000000000000000000000000000001";
const REGISTRY = "0x1111111111111111111111111111111111111111";
const VAULT = "0x2222222222222222222222222222222222222222";

describe("Referrals live path", () => {
  const prevReg = process.env.REFERRAL_REGISTRY_ADDRESS;
  const prevDeployedReg = process.env.DEPLOYED_REFERRAL_REGISTRY;
  const prevVault = process.env.VAULT_CORE_ADDRESS;
  const prevDeployedVault = process.env.DEPLOYED_VAULT_CORE;

  beforeEach(() => {
    fetchReferralEarnedMock.mockReset();
    codeOfImpl = async () => "MYCODE";
    codeOfHashImpl = async () => "0x" + "1".repeat(64);
    refereeCountImpl = async () => 5n;
    claimableImpl = async () => 1_000_000n;
    queryFilterImpl = async () => [];
    process.env.REFERRAL_REGISTRY_ADDRESS = REGISTRY;
    process.env.VAULT_CORE_ADDRESS = VAULT;
    delete process.env.DEPLOYED_REFERRAL_REGISTRY;
    delete process.env.DEPLOYED_VAULT_CORE;
  });

  afterAll(() => {
    const restore = (k: string, v?: string) => (v === undefined ? delete (process.env as any)[k] : (process.env[k] = v));
    restore("REFERRAL_REGISTRY_ADDRESS", prevReg);
    restore("DEPLOYED_REFERRAL_REGISTRY", prevDeployedReg);
    restore("VAULT_CORE_ADDRESS", prevVault);
    restore("DEPLOYED_VAULT_CORE", prevDeployedVault);
  });

  it("returns live stats using the indexed cumulative total", async () => {
    fetchReferralEarnedMock.mockResolvedValueOnce("5000000"); // 5.0 USDC indexed
    const res = await request(app).get(`/api/referrals/stats?address=${VALID}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.live).toBe(true);
    expect(res.body.data.code).toBe("MYCODE");
    expect(res.body.data.referees).toBe(5);
    expect(res.body.data.pendingClaim).toBe("1.0");
    expect(res.body.data.totalEarned).toBe("5.0");
  });

  it("falls back to an on-chain log scan when the indexer has no value", async () => {
    fetchReferralEarnedMock.mockResolvedValueOnce(null);
    queryFilterImpl = async () => [
      { args: { amount: 2_000_000n } },
      { args: { amount: 3_000_000n } },
    ];
    const res = await request(app).get(`/api/referrals/stats?address=${VALID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.totalEarned).toBe("5.0");
  });

  it("degrades the chain scan to 0 when queryFilter throws", async () => {
    fetchReferralEarnedMock.mockResolvedValueOnce(null);
    queryFilterImpl = async () => { throw new Error("rpc unsupported"); };
    const res = await request(app).get(`/api/referrals/stats?address=${VALID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.totalEarned).toBe("0.0");
  });

  it("returns zero referees when the owner has no code", async () => {
    codeOfImpl = async () => "";
    fetchReferralEarnedMock.mockResolvedValueOnce("0");
    const res = await request(app).get(`/api/referrals/stats?address=${VALID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.referees).toBe(0);
  });

  it("handles a zero-hash code gracefully", async () => {
    codeOfHashImpl = async () => "0x" + "0".repeat(64);
    fetchReferralEarnedMock.mockResolvedValueOnce("0");
    const res = await request(app).get(`/api/referrals/stats?address=${VALID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.referees).toBe(0);
  });

  it("works without a vault address (pendingClaim/totalEarned stay 0)", async () => {
    delete process.env.VAULT_CORE_ADDRESS;
    const res = await request(app).get(`/api/referrals/stats?address=${VALID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.live).toBe(true);
    expect(res.body.data.pendingClaim).toBe("0");
    expect(res.body.data.totalEarned).toBe("0");
  });

  it("degrades each on-chain read independently when the contract calls reject", async () => {
    codeOfImpl = async () => { throw new Error("rpc"); };
    codeOfHashImpl = async () => { throw new Error("rpc"); };
    refereeCountImpl = async () => { throw new Error("rpc"); };
    claimableImpl = async () => { throw new Error("rpc"); };
    fetchReferralEarnedMock.mockResolvedValueOnce("0");
    const res = await request(app).get(`/api/referrals/stats?address=${VALID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.live).toBe(true);
    expect(res.body.data.code).toBe("");
    expect(res.body.data.referees).toBe(0);
    expect(res.body.data.pendingClaim).toBe("0.0");
  });

  it("returns success:false when an unexpected error escapes", async () => {
    // fetchReferralEarned rejecting (not individually caught) bubbles to the
    // route's outer try/catch.
    fetchReferralEarnedMock.mockRejectedValueOnce(new Error("indexer exploded"));
    const res = await request(app).get(`/api/referrals/stats?address=${VALID}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.data.live).toBe(false);
  });

  it("falls back to the codeOf_ default when the hash lookup rejects (code present)", async () => {
    codeOfImpl = async () => "MYCODE"; // code truthy → enters the referees block
    codeOfHashImpl = async () => { throw new Error("hash rpc"); }; // codeOf_ .catch → ZeroHash
    fetchReferralEarnedMock.mockResolvedValueOnce("0");
    const res = await request(app).get(`/api/referrals/stats?address=${VALID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.referees).toBe(0);
  });

  it("defaults refereeCount to 0 when that call rejects", async () => {
    refereeCountImpl = async () => { throw new Error("count rpc"); };
    fetchReferralEarnedMock.mockResolvedValueOnce("0");
    const res = await request(app).get(`/api/referrals/stats?address=${VALID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.referees).toBe(0);
  });
});
