import { jest } from "@jest/globals";

let insertImpl: any = async () => ({ id: "1", orderId: "1" });
let failuresImpl: any = async () => [];

jest.mock("../services/indexer.js", () => ({
  __esModule: true,
  insertKeeperFailure: (...a: any[]) => insertImpl(...a),
  fetchKeeperFailures: (...a: any[]) => failuresImpl(...a),
}));

import express from "express";
import request from "supertest";
import keeperRouter from "../routes/keeper.js";

function buildApp(broadcast?: jest.Mock) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    if (broadcast) req.app.__broadcastKeeperFailure = broadcast;
    next();
  });
  app.use("/keeper", keeperRouter);
  return app;
}

describe("keeper route", () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    insertImpl = async () => ({ id: "1", orderId: "1" });
    failuresImpl = async () => [];
    process.env = { ...OLD, NODE_ENV: "test" };
    delete process.env.KEEPER_WEBHOOK_SECRET;
  });

  afterAll(() => {
    process.env = OLD;
  });

  it("forwards the failure to the WebSocket broadcaster when one is attached", async () => {
    const broadcast = jest.fn();
    const app = buildApp(broadcast);
    const res = await request(app)
      .post("/keeper/failure")
      .send({ orderId: "7", traderAddress: "0xABC", failureReason: "reverted" });
    expect(res.status).toBe(200);
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ orderId: "7" }));
  });

  it("returns 500 when persisting the failure throws", async () => {
    insertImpl = async () => { throw new Error("db down"); };
    const app = buildApp();
    const res = await request(app)
      .post("/keeper/failure")
      .send({ orderId: "7", traderAddress: "0xABC" });
    expect(res.status).toBe(500);
  });

  it("returns failures for a trader", async () => {
    failuresImpl = async () => [{ id: "1", orderId: "9", traderAddress: "0xabc", marketAddress: "0xm", failureReason: "r", selector: "", timestamp: "1" }];
    const app = buildApp();
    const res = await request(app).get("/keeper/failures/0xABC?limit=5");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("returns 500 when fetching failures throws", async () => {
    failuresImpl = async () => { throw new Error("idx down"); };
    const app = buildApp();
    const res = await request(app).get("/keeper/failures/0xABC");
    expect(res.status).toBe(500);
  });

  it("rejects when a secret is set but no Authorization header is sent", async () => {
    process.env.KEEPER_WEBHOOK_SECRET = "s3cret";
    const app = buildApp();
    const res = await request(app)
      .post("/keeper/failure")
      .send({ orderId: "1", traderAddress: "0xABC" });
    expect(res.status).toBe(401);
  });

  it("defaults a missing failureReason to 'Unknown error' in the broadcast", async () => {
    const broadcast = jest.fn();
    const app = buildApp(broadcast);
    const res = await request(app)
      .post("/keeper/failure")
      .send({ orderId: "1", traderAddress: "0xABC" }); // no failureReason
    expect(res.status).toBe(200);
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ failureReason: "Unknown error" }));
  });
});
