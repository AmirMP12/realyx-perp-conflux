/**
 * Vercel-native Express entry. Serves frontend static + backend API.
 * Build order: backend must be built first (creates backend/dist).
 */
import path from "path";
import express from "express";
import { app as backendApp } from "./backend/dist/app.js";

const staticDir = path.join(process.cwd(), "frontend", "dist");

const app = express();
app.use(express.static(staticDir));
app.use((req, res, next) => {
  if (req.path.startsWith("/api") || req.path === "/health") return next();
  res.sendFile(path.join(staticDir, "index.html"));
});
app.use(backendApp);

export default app;
