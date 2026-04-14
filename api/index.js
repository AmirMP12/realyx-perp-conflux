/** @typedef {import('@vercel/node').VercelRequest} VercelRequest */
/** @typedef {import('@vercel/node').VercelResponse} VercelResponse */

/** @type {((req: VercelRequest, res: VercelResponse) => unknown) | null} */
let cachedApp = null;

/**
 * Load backend app at runtime via true dynamic import.
 * Using eval() prevents bundlers from rewriting this to require(),
 * which caused ERR_REQUIRE_ESM in Vercel serverless.
 */
async function getApp() {
  if (cachedApp) return cachedApp;
  const dynamicImport = (0, eval)("import");
  const mod = await dynamicImport("../backend/dist/app.js");
  if (!mod || !mod.app) {
    throw new Error("Backend app export not found in backend/dist/app.js");
  }
  cachedApp = mod.app;
  return cachedApp;
}

/** @param {VercelRequest} req @param {VercelResponse} res */
module.exports = async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
};

