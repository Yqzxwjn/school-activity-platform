#!/usr/bin/env node
/* ==========================================================================
   初始化 / 重置数据：node server/seed.js
   会清空现有账号、活动与报名，写入演示数据。
   ========================================================================== */

"use strict";

const dbm = require("./db");
const path = require("node:path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "data", "app.db");
const db = dbm.connect(dbPath);

console.log("正在写入初始数据到 " + dbPath);
const result = dbm.seedDatabase(db, { password: process.env.SEED_PASSWORD || "xbh2026" });

console.log("");
console.log("完成：");
console.log("  账号 " + result.users + " 个");
console.log("  活动 " + result.activities + " 场");
console.log("  报名 " + result.registrations + " 条");
console.log("  初始密码：" + (process.env.SEED_PASSWORD || "xbh2026"));
console.log("");
console.log("管理员：陈立行 A2015001");
console.log("组织者：周予安 T2018046 / 邵明远 T2017022 / 林雪见 T2020041");
console.log("学生：林知夏 20240312");
console.log("");
db.close();
