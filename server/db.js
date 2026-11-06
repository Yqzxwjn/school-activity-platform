/* ==========================================================================
   学校活动在线服务平台 V1.0 — 数据库层
   使用 Node.js 内置 SQLite（node:sqlite），无需安装数据库服务。
   ========================================================================== */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const auth = require("./auth");

const ROOT = path.join(__dirname, "..");
const DEFAULT_DB = path.join(ROOT, "data", "app.db");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'organizer', 'admin')),
  class_name TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category_id TEXT NOT NULL,
  organizer_id TEXT NOT NULL REFERENCES users(id),
  location TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '全校师生',
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  reg_deadline INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  cover_tone TEXT NOT NULL DEFAULT 'jade',
  summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  agenda_json TEXT NOT NULL DEFAULT '[]',
  notice_json TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (review_status IN ('draft', 'pending', 'approved', 'rejected')),
  review_at INTEGER NOT NULL DEFAULT 0,
  review_by TEXT NOT NULL DEFAULT '',
  review_reason TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_activities_organizer ON activities(organizer_id);
CREATE INDEX IF NOT EXISTS idx_activities_review ON activities(review_status);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  class_name TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'waitlist', 'checked', 'cancelled')),
  code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  checked_at INTEGER,
  UNIQUE (activity_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reg_active
  ON registrations(activity_id, user_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_reg_activity ON registrations(activity_id, created_at);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  activity_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  read_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notices_user ON notices(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/* --------------------------------------------------------------------------
   Connection
   -------------------------------------------------------------------------- */

function connect(dbPath) {
  const file = dbPath || process.env.DB_PATH || DEFAULT_DB;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      /* ignore */
    }
    throw error;
  }
}

/* --------------------------------------------------------------------------
   Mappers: rows to the JSON shape used by the web client
   -------------------------------------------------------------------------- */

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    account: row.account,
    role: row.role,
    className: row.class_name,
    grade: row.grade,
    phone: row.phone,
    title: row.title,
    department: row.department,
    status: row.status,
    createdAt: row.created_at,
    joinedAt: row.created_at
  };
}

function mapActivity(row, stats) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    categoryId: row.category_id,
    organizerId: row.organizer_id,
    location: row.location,
    target: row.target,
    capacity: row.capacity,
    startAt: row.start_at,
    endAt: row.end_at,
    regDeadline: row.reg_deadline,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    coverTone: row.cover_tone,
    summary: row.summary,
    description: row.description,
    agenda: safeJson(row.agenda_json, []),
    notice: safeJson(row.notice_json, []),
    review: {
      status: row.review_status,
      at: row.review_at,
      by: row.review_by,
      reason: row.review_reason
    },
    stats: stats || { confirmed: 0, waitlist: 0, checked: 0 }
  };
}

function mapRegistration(row) {
  if (!row) return null;
  return {
    id: row.id,
    activityId: row.activity_id,
    userId: row.user_id,
    name: row.name,
    className: row.class_name,
    grade: row.grade,
    phone: row.phone,
    note: row.note,
    status: row.status,
    code: row.code,
    createdAt: row.created_at,
    checkedAt: row.checked_at
  };
}

function mapNotice(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    activityId: row.activity_id,
    createdAt: row.created_at,
    read: Boolean(row.read_at)
  };
}

function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallback;
  }
}

/* --------------------------------------------------------------------------
   Query helpers
   -------------------------------------------------------------------------- */

const ACTIVITY_COLUMNS = "*";

function activityRows(db, options) {
  const opts = options || {};
  const clauses = [];
  const params = [];

  if (!opts.includeHidden) {
    clauses.push("(review_status = 'approved' OR organizer_id = ?)");
    params.push(opts.viewerId || "");
  }
  if (opts.organizerId) {
    clauses.push("organizer_id = ?");
    params.push(opts.organizerId);
  }
  if (opts.status) {
    clauses.push("review_status = ?");
    params.push(opts.status);
  }

  const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
  return db.prepare("SELECT " + ACTIVITY_COLUMNS + " FROM activities" + where + " ORDER BY start_at ASC").all(...params);
}

function registrationStats(db, activityId) {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('confirmed', 'checked') THEN 1 ELSE 0 END) AS confirmed,
         SUM(CASE WHEN status = 'waitlist' THEN 1 ELSE 0 END) AS waitlist,
         SUM(CASE WHEN status = 'checked' THEN 1 ELSE 0 END) AS checked
       FROM registrations WHERE activity_id = ? AND status <> 'cancelled'`
    )
    .get(activityId);
  return {
    confirmed: Number(row.confirmed || 0),
    waitlist: Number(row.waitlist || 0),
    checked: Number(row.checked || 0)
  };
}

function statsMap(db, rows) {
  const map = new Map();
  if (!rows.length) return map;
  const placeholders = rows.map(() => "?").join(",");
  const result = db
    .prepare(
      `SELECT activity_id,
         SUM(CASE WHEN status IN ('confirmed', 'checked') THEN 1 ELSE 0 END) AS confirmed,
         SUM(CASE WHEN status = 'waitlist' THEN 1 ELSE 0 END) AS waitlist,
         SUM(CASE WHEN status = 'checked' THEN 1 ELSE 0 END) AS checked
       FROM registrations
       WHERE status <> 'cancelled' AND activity_id IN (${placeholders})
       GROUP BY activity_id`
    )
    .all(...rows.map((row) => row.id));
  result.forEach((row) => {
    map.set(row.activity_id, {
      confirmed: Number(row.confirmed || 0),
      waitlist: Number(row.waitlist || 0),
      checked: Number(row.checked || 0)
    });
  });
  return map;
}

function activityById(db, id) {
  return db.prepare("SELECT * FROM activities WHERE id = ?").get(id);
}

function userById(db, id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function userByAccount(db, account) {
  return db.prepare("SELECT * FROM users WHERE account = ? COLLATE NOCASE").get(account);
}

function newId(prefix) {
  const random = require("node:crypto").randomBytes(5).toString("hex");
  return prefix + Date.now().toString(36) + random;
}

/* --------------------------------------------------------------------------
   Seed
   -------------------------------------------------------------------------- */

function seedDatabase(db, options) {
  const opts = options || {};
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "seed-data.json"), "utf8"));
  const password = opts.password || process.env.SEED_PASSWORD || "xbh2026";
  const hash = auth.hashPassword(password);
  const insertedUsers = new Map();
  const insertedRegs = new Set();
  let registrationCount = 0;
  let skipped = 0;

  transaction(db, () => {
    db.exec("DELETE FROM notices");
    db.exec("DELETE FROM registrations");
    db.exec("DELETE FROM activities");
    db.exec("DELETE FROM sessions");
    db.exec("DELETE FROM users");

    const insertUser = db.prepare(
      `INSERT INTO users (id, name, account, password_hash, role, class_name, grade, phone, title, department, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    data.users.forEach((user) => {
      const createdAt = user.joinedAt || Date.now();
      insertUser.run(
        user.id,
        user.name,
        user.account,
        hash,
        user.role,
        user.className || "",
        user.grade || "",
        user.phone || "",
        user.title || "",
        user.department || "",
        user.status || "active",
        createdAt
      );
      insertedUsers.set(user.name, user.id);
    });

    const insertActivity = db.prepare(
      `INSERT INTO activities (
         id, title, category_id, organizer_id, location, target, capacity,
         start_at, end_at, reg_deadline, created_at, updated_at, cover_tone,
         summary, description, agenda_json, notice_json,
         review_status, review_at, review_by, review_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    data.activities.forEach((activity) => {
      insertActivity.run(
        activity.id,
        activity.title,
        activity.categoryId,
        activity.organizerId,
        activity.location,
        activity.target,
        activity.capacity,
        activity.startAt,
        activity.endAt,
        activity.regDeadline,
        activity.createdAt,
        activity.updatedAt,
        activity.coverTone || "jade",
        activity.summary || "",
        activity.description || "",
        JSON.stringify(activity.agenda || []),
        JSON.stringify(activity.notice || []),
        activity.review.status,
        activity.review.at || 0,
        activity.review.by || "",
        activity.review.reason || ""
      );
    });

    const insertRegistration = db.prepare(
      `INSERT INTO registrations (
         id, activity_id, user_id, name, class_name, grade, phone, note, status, code, created_at, checked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    data.registrations.forEach((registration) => {
      const userId = registration.userId || insertedUsers.get(registration.name);
      if (!userId) {
        skipped += 1;
        return;
      }
      const key = registration.activityId + "|" + userId;
      if (insertedRegs.has(key)) {
        skipped += 1;
        return;
      }
      insertedRegs.add(key);
      registrationCount += 1;
      insertRegistration.run(
        registration.id,
        registration.activityId,
        userId,
        registration.name,
        registration.className || "",
        registration.grade || "",
        registration.phone || "",
        registration.note || "",
        registration.status,
        registration.code,
        registration.createdAt,
        registration.checkedAt || null
      );
    });

    const insertNotice = db.prepare(
      `INSERT INTO notices (id, user_id, type, title, body, activity_id, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    data.notices.forEach((notice) => {
      if (!insertedUsers.has(data.users.filter((u) => u.id === notice.userId)[0]?.name || "")) {
        return;
      }
      insertNotice.run(
        notice.id,
        notice.userId,
        notice.type,
        notice.title,
        notice.body,
        notice.activityId || "",
        notice.createdAt,
        notice.read ? Date.now() : 0
      );
    });

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("seeded_at", String(Date.now()));
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("seed_version", "1");
  });

  return { users: insertedUsers.size, activities: data.activities.length, registrations: registrationCount, skipped };
}

function ensureSeeded(db) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM users").get();
  if (Number(row.count) === 0) {
    const result = seedDatabase(db);
    console.log(
      `[db] 已初始化演示数据：${result.users} 个账号，${result.activities} 场活动，${result.registrations} 条报名`
    );
    return result;
  }
  return null;
}

module.exports = {
  connect,
  transaction,
  mapUser,
  mapActivity,
  mapRegistration,
  mapNotice,
  activityRows,
  activityById,
  registrationStats,
  statsMap,
  userById,
  userByAccount,
  newId,
  seedDatabase,
  ensureSeeded,
  safeJson
};
