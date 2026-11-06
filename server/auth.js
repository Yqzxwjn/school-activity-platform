/* ==========================================================================
   认证：密码散列、会话令牌、登录限流
   ========================================================================== */

"use strict";

const crypto = require("node:crypto");

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 7;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, N, r, p, salt, expected] = parts;
    const actual = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
      N: Number(N),
      r: Number(r),
      p: Number(p)
    });
    const expectedBuffer = Buffer.from(expected, "hex");
    if (expectedBuffer.length !== actual.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, actual);
  } catch (error) {
    return false;
  }
}

function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function createSession(db, userId, userAgent) {
  const token = newToken();
  const now = Date.now();
  const expires = now + SESSION_DAYS * 86400000;
  db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    tokenHash(token),
    userId,
    now,
    expires
  );
  if (userAgent) {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      "session_ua_" + tokenHash(token).slice(0, 12),
      String(userAgent).slice(0, 200)
    );
  }
  return { token, expiresAt: expires };
}

function findSession(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.token, s.expires_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(tokenHash(token));
  if (!row) return null;
  if (Number(row.expires_at) <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(tokenHash(token));
    return null;
  }
  return row;
}

function destroySession(db, token) {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token = ?").run(tokenHash(token));
}

function destroyUserSessions(db, userId) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

function cleanupSessions(db) {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}

/* --------------------------------------------------------------------------
   登录失败限流：同一 IP 或账号 10 分钟内最多 8 次失败
   -------------------------------------------------------------------------- */

const failures = new Map();
const WINDOW = 10 * 60 * 1000;
const LIMIT = 8;

function failureKey(ip, account) {
  return String(ip || "unknown") + "|" + String(account || "").toLowerCase();
}

function isBlocked(ip, account) {
  const entry = failures.get(failureKey(ip, account));
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW) {
    failures.delete(failureKey(ip, account));
    return false;
  }
  return entry.count >= LIMIT;
}

function recordFailure(ip, account) {
  const key = failureKey(ip, account);
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW) {
    failures.set(key, { first: Date.now(), count: 1 });
    return;
  }
  entry.count += 1;
}

function clearFailures(ip, account) {
  failures.delete(failureKey(ip, account));
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  findSession,
  destroySession,
  destroyUserSessions,
  cleanupSessions,
  isBlocked,
  recordFailure,
  clearFailures,
  SESSION_DAYS
};
