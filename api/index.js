/** @typedef {import('@vercel/node').VercelRequest} VercelRequest */
/** @typedef {import('@vercel/node').VercelResponse} VercelResponse */

const { app } = require("../backend/dist-vercel/app.js");

/** @param {VercelRequest} req @param {VercelResponse} res */
module.exports = async function handler(req, res) {
  return app(req, res);
};

