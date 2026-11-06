/* ==========================================================================
   REST 接口与路由
   ========================================================================== */

"use strict";

const http = require("./http");
const auth = require("./auth");
const dbm = require("./db");
const services = require("./services");

const ROUTES = [
  { method: "GET", path: /^\/api\/health$/, auth: false, handler: () => ({ ok: true, time: Date.now() }) },

  {
    method: "POST",
    path: /^\/api\/auth\/login$/,
    auth: false,
    handler: (ctx) =>
      services.login(ctx.db, ctx.body.account, ctx.body.password, {
        ip: ctx.ip,
        userAgent: ctx.req.headers["user-agent"]
      })
  },
  {
    method: "POST",
    path: /^\/api\/auth\/logout$/,
    auth: false,
    handler: (ctx) => {
      auth.destroySession(ctx.db, ctx.cookies.sid);
      return { ok: true };
    }
  },
  {
    method: "GET",
    path: /^\/api\/auth\/me$/,
    auth: false,
    handler: (ctx) => ({ user: ctx.user ? dbm.mapUser(ctx.user) : null })
  },
  {
    method: "POST",
    path: /^\/api\/auth\/password$/,
    handler: (ctx) => services.changePassword(ctx.db, ctx.user, ctx.body.currentPassword, ctx.body.newPassword)
  },

  { method: "GET", path: /^\/api\/bootstrap$/, handler: (ctx) => services.bootstrap(ctx.db, ctx.user) },
  { method: "GET", path: /^\/api\/activities$/, handler: (ctx) => services.bootstrap(ctx.db, ctx.user).activities },
  {
    method: "GET",
    path: /^\/api\/activities\/([\w-]+)$/,
    handler: (ctx) => services.getActivity(ctx.db, ctx.user, ctx.params[0])
  },
  {
    method: "POST",
    path: /^\/api\/activities$/,
    roles: ["organizer", "admin"],
    handler: (ctx) => services.saveActivity(ctx.db, ctx.user, ctx.body)
  },
  {
    method: "POST",
    path: /^\/api\/activities\/([\w-]+)\/submit$/,
    roles: ["organizer", "admin"],
    handler: (ctx) => services.submitActivity(ctx.db, ctx.user, ctx.params[0])
  },
  {
    method: "DELETE",
    path: /^\/api\/activities\/([\w-]+)$/,
    roles: ["organizer", "admin"],
    handler: (ctx) => services.deleteActivity(ctx.db, ctx.user, ctx.params[0])
  },
  {
    method: "POST",
    path: /^\/api\/activities\/([\w-]+)\/review$/,
    roles: ["admin"],
    handler: (ctx) => services.reviewActivity(ctx.db, ctx.user, ctx.params[0], ctx.body.decision, ctx.body.reason)
  },
  {
    method: "POST",
    path: /^\/api\/activities\/([\w-]+)\/registrations$/,
    handler: (ctx) => services.register(ctx.db, ctx.user, ctx.params[0], ctx.body)
  },
  {
    method: "GET",
    path: /^\/api\/activities\/([\w-]+)\/roster$/,
    roles: ["organizer", "admin"],
    handler: (ctx) => services.roster(ctx.db, ctx.user, ctx.params[0])
  },
  {
    method: "POST",
    path: /^\/api\/activities\/([\w-]+)\/checkin$/,
    roles: ["organizer", "admin"],
    handler: (ctx) => services.checkInByCode(ctx.db, ctx.user, ctx.params[0], ctx.body.code)
  },
  {
    method: "DELETE",
    path: /^\/api\/registrations\/([\w-]+)$/,
    handler: (ctx) => services.cancelRegistration(ctx.db, ctx.user, ctx.params[0])
  },
  {
    method: "POST",
    path: /^\/api\/registrations\/([\w-]+)\/checkin$/,
    roles: ["organizer", "admin"],
    handler: (ctx) => services.checkInById(ctx.db, ctx.user, ctx.params[0])
  },
  {
    method: "DELETE",
    path: /^\/api\/registrations\/([\w-]+)\/checkin$/,
    roles: ["organizer", "admin"],
    handler: (ctx) => services.undoCheckIn(ctx.db, ctx.user, ctx.params[0])
  },

  { method: "GET", path: /^\/api\/notices$/, handler: (ctx) => services.notices(ctx.db, ctx.user) },
  {
    method: "POST",
    path: /^\/api\/notices\/read$/,
    handler: (ctx) =>
      ctx.body.all ? services.markAllNoticesRead(ctx.db, ctx.user) : services.markNoticeRead(ctx.db, ctx.user, ctx.body.id)
  },

  {
    method: "GET",
    path: /^\/api\/users$/,
    roles: ["admin"],
    handler: (ctx) => services.listUsers(ctx.db)
  },
  {
    method: "POST",
    path: /^\/api\/users$/,
    roles: ["admin"],
    handler: (ctx) => services.createUser(ctx.db, ctx.body)
  },
  {
    method: "PATCH",
    path: /^\/api\/users\/([\w-]+)$/,
    roles: ["admin"],
    handler: (ctx) => services.updateUser(ctx.db, ctx.user, ctx.params[0], ctx.body)
  },
  {
    method: "POST",
    path: /^\/api\/users\/([\w-]+)\/password$/,
    roles: ["admin"],
    handler: (ctx) => services.resetPassword(ctx.db, ctx.user, ctx.params[0], ctx.body.password)
  },

  {
    method: "GET",
    path: /^\/api\/stats$/,
    roles: ["admin"],
    handler: (ctx) => services.buildStats(ctx.db)
  }
];

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = req.headers.host;
    return new URL(origin).host === host;
  } catch (error) {
    return false;
  }
}

async function handle(req, res, options) {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const pathname = url.pathname;
  if (pathname.indexOf("/api/") !== 0) return false;

  const db = options.db;
  http.securityHeaders(res);

  if (req.method !== "GET" && !sameOrigin(req)) {
    http.fail(res, 403, "请求来源不合法");
    return true;
  }

  const cookies = http.parseCookies(req);
  const sessionRow = auth.findSession(db, cookies.sid);
  const user = sessionRow && sessionRow.status === "active" ? sessionRow : null;
  if (sessionRow && !user) {
    auth.destroySession(db, cookies.sid);
  }

  for (const route of ROUTES) {
    if (route.method !== req.method) continue;
    const match = route.path.exec(pathname);
    if (!match) continue;

    try {
      if (route.auth !== false && !user) {
        http.fail(res, 401, "请先登录");
        return true;
      }
      if (route.roles && route.roles.indexOf(user.role) === -1) {
        http.fail(res, 403, "当前角色没有这个操作权限");
        return true;
      }

      let body = {};
      if (req.method !== "GET" && req.method !== "HEAD") {
        body = await http.readJson(req, 512 * 1024);
      }

      const result = await route.handler({
        db,
        req,
        res,
        body,
        user,
        cookies,
        params: match.slice(1),
        ip: clientIp(req)
      });

      if (pathname === "/api/auth/login" && result && result.token) {
        http.setCookie(res, "sid", result.token, {
          maxAge: result.expiresAt - Date.now(),
          secure: req.headers["x-forwarded-proto"] === "https"
        });
        http.sendJson(res, 200, { user: result.user });
        return true;
      }
      if (pathname === "/api/auth/logout") {
        http.clearCookie(res, "sid");
      }

      http.sendJson(res, 200, result === undefined ? { ok: true } : result);
      return true;
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error("[api]", req.method, pathname, error);
      http.fail(res, status, error.message || "服务器内部错误");
      return true;
    }
  }

  http.fail(res, 404, "接口不存在");
  return true;
}

module.exports = { handle };
