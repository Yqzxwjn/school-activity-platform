#!/usr/bin/env node
/* ==========================================================================
   学校活动在线服务平台 V1.0 — 服务端入口
   运行：node server.js（默认 http://localhost:3000）
   ========================================================================== */

"use strict";

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const dbm = require("./server/db");
const auth = require("./server/auth");
const api = require("./server/api");
const httpUtil = require("./server/http");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");

const db = dbm.connect();
if (process.env.SEED !== "false") dbm.ensureSeeded(db);
auth.cleanupSessions(db);
setInterval(() => auth.cleanupSessions(db), 60 * 60 * 1000).unref();

if (!fs.existsSync(path.join(PUBLIC_DIR, "index.html"))) {
  console.error("[startup] 找不到 public/index.html，请确认目录结构完整");
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  res.on("finish", () => {
    if (process.env.LOG !== "off") {
      console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });

  try {
    if (req.url.startsWith("/api/")) {
      await api.handle(req, res, { db });
      return;
    }
    httpUtil.securityHeaders(res);
    httpUtil.serveStatic(PUBLIC_DIR, req, res, req.url);
  } catch (error) {
    console.error("[request]", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "服务器内部错误" }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  学校活动在线服务平台 V1.0");
  console.log("  http://localhost:" + PORT);
  console.log("  数据库：" + (process.env.DB_PATH || path.join(__dirname, "data", "app.db")));
  console.log("");
});

function shutdown() {
  console.log("\n[server] 正在关闭…");
  server.close(() => {
    try {
      db.close();
    } catch (error) {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
