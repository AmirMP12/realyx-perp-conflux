/**
 * Reorg-awareness tests for the indexer.
 *
 * Verifies the block-hash checkpointing path in runSync:
 *  - healthy resume: newest stored hash matches the chain → resume at last+1,
 *    no orphan purge of real rows.
 *  - reorg detected: stored hash for the tip no longer matches → walk back to
 *    the common ancestor and rewind to re-ingest from there.
 *  - fallback: no stored hashes → fixed-window rewind (REORG_BUFFER_BLOCKS).
 */

import { jest } from "@jest/globals";
import { ethers } from "ethers";

const mockPool = {
  query: jest.fn().mockResolvedValue({ rows: [] }),
  on: jest.fn(),
  connect: jest.fn(),
};

jest.mock("pg", () => ({
  __esModule: true,
  Pool: jest.fn(() => mockPool),
  default: { Pool: jest.fn(() => mockPool) },
}));

const mockProvider = {
  getBlockNumber: jest.fn().mockResolvedValue(1000),
  getLogs: jest.fn().mockResolvedValue([]),
  getBlock: jest.fn(),
  getNetwork: jest.fn().mockResolvedValue({ chainId: 71 }),
};

jest.mock("ethers", () => {
  const original = jest.requireActual("ethers") as any;
  return {
    ...original,
    ethers: {
      ...original.ethers,
      JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
      Interface: original.ethers.Interface,
      id: original.ethers.id,
    },
    JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
  };
});

const HASH_A = "0x" + "a".repeat(64);
const HASH_B = "0x" + "b".repeat(64);

/** Collect the lower-bound arg of every `DELETE FROM position_events WHERE block_number >= $1`. */
function purgedFloors(): number[] {
  return mockPool.query.mock.calls
    .filter((c: any) => String(c[0]).includes("DELETE FROM position_events WHERE block_number >="))
    .map((c: any) => Number((c[1] as any[])[0]));
}

describe("Indexer reorg-awareness", () => {
  let sync: typeof import("../routes/sync.js");

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.POSTGRES_URL = "postgres://local";
    process.env.TRADING_CORE_ADDRESS = "0x79c81bfc2d07dd18d95488cb4bbd4abc3ec9455c";
    process.env.NODE_ENV = "test";
    process.env.INDEXER_REORG_BUFFER = "64";
    mockProvider.getLogs.mockResolvedValue([]);
    mockProvider.getBlockNumber.mockResolvedValue(1000);
    sync = await import("../routes/sync.js");
  });

  it("healthy resume: newest checkpoint matches → resumes at last+1, no real-row purge", async () => {
    const last = 900;
    // cursor read, then checkpoint read (newest first), then everything else empty.
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block FROM indexer_state")) {
        return Promise.resolve({ rows: [{ last_synced_block: last }] });
      }
      if (sql.includes("FROM block_checkpoints") && sql.includes("ORDER BY block_number DESC")) {
        return Promise.resolve({ rows: [{ block_number: last, block_hash: HASH_A }] });
      }
      return Promise.resolve({ rows: [] });
    });
    // The tip hash still matches the chain → no reorg.
    mockProvider.getBlock.mockResolvedValue({ number: last, hash: HASH_A, timestamp: 1713400000 });

    const result = await sync.runSync();

    expect(result.reorgDepth).toBe(0);
    expect(result.scannedFrom).toBe(last + 1); // resumed exactly after the cursor
    // Purge floor (if any) is at last+1 — i.e. it can only delete rows ABOVE the
    // confirmed-canonical tip, never real historical rows.
    for (const floor of purgedFloors()) expect(floor).toBe(last + 1);
  });

  it("reorg detected: tip hash mismatch → walks back to common ancestor and rewinds", async () => {
    const last = 900;
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block FROM indexer_state")) {
        return Promise.resolve({ rows: [{ last_synced_block: last }] });
      }
      if (sql.includes("FROM block_checkpoints") && sql.includes("ORDER BY block_number DESC")) {
        // newest → oldest: 900 (orphaned), 899 (orphaned), 898 (ancestor)
        return Promise.resolve({
          rows: [
            { block_number: 900, block_hash: HASH_A },
            { block_number: 899, block_hash: HASH_A },
            { block_number: 898, block_hash: HASH_B },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    // 900 & 899 now have different canonical hashes (orphaned); 898 still matches HASH_B.
    mockProvider.getBlock.mockImplementation((bn: number) => {
      if (bn === 898) return Promise.resolve({ number: 898, hash: HASH_B, timestamp: 1713400000 });
      return Promise.resolve({ number: bn, hash: HASH_A.replace("aa", "cc"), timestamp: 1713400000 });
    });

    const result = await sync.runSync();

    expect(result.reorgDepth).toBe(2); // 900 and 899 orphaned
    expect(result.scannedFrom).toBe(899); // common ancestor 898 → resume at 899
    expect(purgedFloors()).toContain(899); // orphaned rows from 899 up are purged
  });

  it("no stored checkpoints → fixed-window fallback rewind", async () => {
    const last = 900;
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT last_synced_block FROM indexer_state")) {
        return Promise.resolve({ rows: [{ last_synced_block: last }] });
      }
      if (sql.includes("FROM block_checkpoints")) {
        return Promise.resolve({ rows: [] }); // nothing stored (pre-upgrade resume)
      }
      return Promise.resolve({ rows: [] });
    });
    mockProvider.getBlock.mockResolvedValue({ number: last, hash: HASH_A, timestamp: 1713400000 });

    const result = await sync.runSync();

    expect(result.reorgDepth).toBe(0);
    // last + 1 - REORG_BUFFER_BLOCKS = 900 + 1 - 64 = 837
    expect(result.scannedFrom).toBe(837);
  });
});
