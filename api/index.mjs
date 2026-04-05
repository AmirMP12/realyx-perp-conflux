// Vercel Serverless Function — .mjs extension forces ESM mode
// This avoids conflict with the root tsconfig (commonjs for Hardhat)
import { app } from '../backend/dist/app.js';
export default app;
