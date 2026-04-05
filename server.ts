import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { app as backendApp } from "./backend/dist/app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(__dirname, "frontend", "dist");

const app = express();
app.use(express.static(staticDir));
app.use((req, res, next) => {
  if (req.path.startsWith("/api") || req.path === "/health") return next();
  res.sendFile(path.join(staticDir, "index.html"));
});
app.use(backendApp);

export default app;
