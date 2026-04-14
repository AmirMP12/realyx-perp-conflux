import type { VercelRequest, VercelResponse } from "@vercel/node";

type ExpressLikeApp = (req: VercelRequest, res: VercelResponse) => unknown;

let cachedApp: ExpressLikeApp | null = null;

async function getApp(): Promise<ExpressLikeApp> {
  if (cachedApp) return cachedApp;
  // Load compiled backend output. This avoids CJS->ESM require() crashes
  // in Vercel serverless runtime (ERR_REQUIRE_ESM).
  const mod = (await import("../backend/dist/app.js")) as { app?: ExpressLikeApp };
  if (!mod.app) {
    throw new Error("Backend app export not found in backend/dist/app.js");
  }
  cachedApp = mod.app;
  return cachedApp;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const app = await getApp();
  return app(req, res);
}
