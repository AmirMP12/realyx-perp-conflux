/** @typedef {import('@vercel/node').VercelRequest} VercelRequest */
/** @typedef {import('@vercel/node').VercelResponse} VercelResponse */

/** @param {VercelRequest} req @param {VercelResponse} res */
module.exports = async function handler(req, res) {
  const { app } = await import("../backend/dist-vercel/app.js");
  return app(req, res);
};

