/* ==========================================================================
   接口集成测试：真实启动服务进程，验证登录、报名、候补、核销、审核与权限
   运行：node --test tests/
   ========================================================================== */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PORT = 3400 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `school-activity-test-${Date.now()}.db`);

let server;

function startServer() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("服务启动超时")), 20000);
    timer.unref();
    server = spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(PORT),
        DB_PATH,
        SEED_PASSWORD: "xbh2026",
        LOG: "off"
      }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    server.stdout.on("data", (chunk) => {
      if (String(chunk).indexOf("http://localhost") !== -1) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
    server.on("error", reject);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.on("exit", () => resolve());
    server.kill("SIGTERM");
    setTimeout(() => {
      try {
        server.kill("SIGKILL");
      } catch (error) {
        /* ignore */
      }
      resolve();
    }, 3000);
  });
}

function client() {
  let cookie = "";
  async function request(method, url, body) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(BASE + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    if (setCookie.length) cookie = setCookie.map((item) => item.split(";")[0]).join("; ");
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
    return { status: response.status, data };
  }
  return {
    get: (url) => request("GET", url),
    post: (url, body) => request("POST", url, body === undefined ? {} : body),
    patch: (url, body) => request("PATCH", url, body === undefined ? {} : body),
    del: (url) => request("DELETE", url),
    login: (account, password) => request("POST", "/api/auth/login", { account, password })
  };
}

test.before(async () => {
  fs.rmSync(DB_PATH, { force: true });
  await startServer();
});

test.after(async () => {
  await stopServer();
  fs.rmSync(DB_PATH, { force: true });
  fs.rmSync(DB_PATH + "-wal", { force: true });
  fs.rmSync(DB_PATH + "-shm", { force: true });
});

test("未登录访问工作台数据返回 401", async () => {
  const guest = client();
  const response = await guest.get("/api/bootstrap");
  assert.equal(response.status, 401);
});

test("密码错误返回 401，正确密码可以登录", async () => {
  const student = client();
  const bad = await student.login("20240312", "not-my-password");
  assert.equal(bad.status, 401);
  assert.match(bad.data.error, /账号或密码/);

  const good = await student.login("20240312", "xbh2026");
  assert.equal(good.status, 200);
  assert.equal(good.data.user.name, "林知夏");
  assert.equal(good.data.user.role, "student");
});

test("学生登录后能看到活动与自己已有的报名", async () => {
  const student = client();
  await student.login("20240312", "xbh2026");
  const response = await student.get("/api/bootstrap");
  assert.equal(response.status, 200);
  assert.ok(response.data.activities.length >= 10);
  assert.equal(response.data.registrations.length, 4);
  assert.ok(response.data.activities.every((activity) => activity.stats && typeof activity.stats.confirmed === "number"));
});

test("学生报名、重复报名被拒绝、取消报名", async () => {
  const student = client();
  await student.login("20240312", "xbh2026");

  const first = await student.post("/api/activities/a3/registrations", {
    name: "林知夏",
    className: "高二(3)班",
    phone: "13800132045"
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.registration.status, "confirmed");
  assert.match(first.data.registration.code, /^\d{6}$/);

  const duplicate = await student.post("/api/activities/a3/registrations", {});
  assert.equal(duplicate.status, 409);

  const cancelled = await student.del(`/api/registrations/${first.data.registration.id}`);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.activity.stats.confirmed, 46);
});

test("名额已满时进入候补，取消后可以退出候补", async () => {
  const student = client();
  await student.login("20240312", "xbh2026");
  const response = await student.post("/api/activities/a17/registrations", {
    name: "林知夏",
    className: "高二(3)班"
  });
  assert.equal(response.status, 200);
  assert.equal(response.data.waitlist, true);
  assert.equal(response.data.registration.status, "waitlist");
  assert.equal(response.data.activity.stats.confirmed, 50);

  const cancelled = await student.del(`/api/registrations/${response.data.registration.id}`);
  assert.equal(cancelled.status, 200);
});

test("学生不能发布活动，也不能查看别人的报名名单", async () => {
  const student = client();
  await student.login("20240312", "xbh2026");
  const forbidden = await student.post("/api/activities", {
    title: "越权活动",
    categoryId: "club",
    summary: "测试",
    description: "测试",
    location: "测试",
    capacity: 10,
    startAt: Date.now() + 86400000,
    endAt: Date.now() + 90000000,
    regDeadline: Date.now() + 80000000
  });
  assert.equal(forbidden.status, 403);

  const roster = await student.get("/api/activities/a1/roster");
  assert.equal(roster.status, 403);
});

test("组织者可以发布、提交审核，管理员通过后上架", async () => {
  const organizer = client();
  await organizer.login("T2018046", "xbh2026");

  const created = await organizer.post("/api/activities", {
    title: "接口测试活动",
    categoryId: "lecture",
    summary: "用于自动化测试的活动",
    description: "由接口测试创建",
    location: "测试教室",
    target: "全校师生",
    capacity: 30,
    startAt: Date.now() + 7 * 86400000,
    endAt: Date.now() + 7 * 86400000 + 7200000,
    regDeadline: Date.now() + 6 * 86400000,
    agenda: [{ time: "15:00", title: "开场" }],
    notice: ["请提前到场"]
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.review.status, "draft");

  const submitted = await organizer.post(`/api/activities/${created.data.id}/submit`);
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.review.status, "pending");

  const admin = client();
  await admin.login("A2015001", "xbh2026");
  const approved = await admin.post(`/api/activities/${created.data.id}/review`, { decision: "approved" });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.review.status, "approved");

  const student = client();
  await student.login("20240312", "xbh2026");
  const detail = await student.get(`/api/activities/${created.data.id}`);
  assert.equal(detail.status, 200);
});

test("组织者核销签到码，重复核销被拒绝", async () => {
  const organizer = client();
  await organizer.login("T2018046", "xbh2026");
  const boot = await organizer.get("/api/bootstrap");
  const registration = boot.data.registrations.filter(
    (item) => item.activityId === "a1" && item.status === "confirmed"
  )[0];
  assert.ok(registration, "需要一个已报名记录");

  const first = await organizer.post("/api/activities/a1/checkin", { code: registration.code });
  assert.equal(first.status, 200);
  assert.equal(first.data.registration.status, "checked");

  const second = await organizer.post("/api/activities/a1/checkin", { code: registration.code });
  assert.equal(second.status, 409);

  const undo = await organizer.del(`/api/registrations/${registration.id}/checkin`);
  assert.equal(undo.status, 200);
  assert.equal(undo.data.registration.status, "confirmed");
});

test("管理员可以新建账号，新账号可以登录", async () => {
  const admin = client();
  await admin.login("A2015001", "xbh2026");
  const created = await admin.post("/api/users", {
    name: "测试学生",
    account: "T2026999",
    role: "student",
    className: "高一(9)班",
    password: "student123"
  });
  assert.equal(created.status, 200);

  const student = client();
  const login = await student.login("T2026999", "student123");
  assert.equal(login.status, 200);
  assert.equal(login.data.user.name, "测试学生");
});

test("管理员统计接口返回完整指标", async () => {
  const admin = client();
  await admin.login("A2015001", "xbh2026");
  const stats = await admin.get("/api/stats");
  assert.equal(stats.status, 200);
  assert.ok(stats.data.activities > 0);
  assert.ok(stats.data.registrations > 0);
  assert.equal(stats.data.months.length, 6);
  assert.ok(Array.isArray(stats.data.byCategory));
  assert.ok(Array.isArray(stats.data.top));
});
