/* ==========================================================================
   业务服务：活动、报名、候补、审核、核销、账号与统计
   ========================================================================== */

"use strict";

const auth = require("./auth");
const dbm = require("./db");

const CATEGORIES = [
  { id: "club", name: "社团活动", icon: "users-three", tone: "jade" },
  { id: "lecture", name: "学术讲座", icon: "presentation-chart", tone: "blue" },
  { id: "sport", name: "体育竞赛", icon: "basketball", tone: "clay" },
  { id: "volunteer", name: "志愿服务", icon: "heart", tone: "jade" },
  { id: "class", name: "主题班会", icon: "chalkboard", tone: "blue" },
  { id: "show", name: "文艺汇演", icon: "microphone-stage", tone: "clay" }
];

const ROLES = {
  student: { label: "学生", icon: "student" },
  organizer: { label: "活动组织者", icon: "chalkboard" },
  admin: { label: "管理员", icon: "shield-check" }
};

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isValidCategory(id) {
  return CATEGORIES.some((category) => category.id === id);
}

function statusOf(activity) {
  if (activity.review_status === "draft") return "draft";
  if (activity.review_status === "pending") return "pending";
  if (activity.review_status === "rejected") return "rejected";
  const now = Date.now();
  if (now < activity.reg_deadline) return "open";
  if (now < activity.start_at) return "closed";
  if (now <= activity.end_at) return "live";
  return "ended";
}

function canManage(activity, user) {
  return Boolean(user) && (user.role === "admin" || activity.organizer_id === user.id);
}

function canView(activity, user) {
  return activity.review_status === "approved" || (user && canManage(activity, user));
}

function visibleRows(db, user) {
  if (user.role === "admin") {
    return db.prepare("SELECT * FROM activities ORDER BY start_at ASC").all();
  }
  if (user.role === "organizer") {
    return db
      .prepare("SELECT * FROM activities WHERE review_status = 'approved' OR organizer_id = ? ORDER BY start_at ASC")
      .all(user.id);
  }
  return db.prepare("SELECT * FROM activities WHERE review_status = 'approved' ORDER BY start_at ASC").all();
}

function addNotice(db, userId, options) {
  if (!userId) return;
  db.prepare(
    "INSERT INTO notices (id, user_id, type, title, body, activity_id, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0)"
  ).run(
    dbm.newId("n"),
    userId,
    options.type || "system",
    options.title,
    options.body || "",
    options.activityId || "",
    Date.now()
  );
}

function adminIds(db) {
  return db
    .prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'")
    .all()
    .map((row) => row.id);
}

/* --------------------------------------------------------------------------
   活动
   -------------------------------------------------------------------------- */

function hydrate(db, rows) {
  const stats = dbm.statsMap(db, rows);
  return rows.map((row) => dbm.mapActivity(row, stats.get(row.id)));
}

function getActivity(db, user, id) {
  const row = dbm.activityById(db, id);
  if (!row || !canView(row, user)) throw httpError(404, "活动不存在或尚未上架");
  return dbm.mapActivity(row, dbm.registrationStats(db, row.id));
}

function normalizeActivityPayload(payload) {
  const title = String(payload.title || "").trim();
  const categoryId = String(payload.categoryId || "");
  const summary = String(payload.summary || "").trim();
  const description = String(payload.description || "").trim();
  const location = String(payload.location || "").trim();
  const target = String(payload.target || "全校师生").trim() || "全校师生";
  const capacity = Number(payload.capacity);
  const startAt = Number(payload.startAt);
  const endAt = Number(payload.endAt);
  const regDeadline = Number(payload.regDeadline);

  if (!title || title.length > 60) throw httpError(400, "活动名称不能为空，且不超过 60 个字");
  if (!isValidCategory(categoryId)) throw httpError(400, "请选择有效的活动分类");
  if (!summary) throw httpError(400, "请填写一句话简介");
  if (summary.length > 120) throw httpError(400, "一句话简介不超过 120 个字");
  if (!description) throw httpError(400, "请填写活动详情");
  if (!location) throw httpError(400, "请填写活动地点");
  if (!Number.isFinite(capacity) || capacity < 1 || capacity > 999) throw httpError(400, "名额需要在 1 到 999 之间");
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
    throw httpError(400, "活动结束时间需要晚于开始时间");
  }
  if (!Number.isFinite(regDeadline) || regDeadline > startAt) {
    throw httpError(400, "报名截止时间需要早于活动开始时间");
  }

  const agenda = Array.isArray(payload.agenda)
    ? payload.agenda
        .filter((item) => item && String(item.title || "").trim())
        .slice(0, 20)
        .map((item) => ({ time: String(item.time || "09:00").slice(0, 8), title: String(item.title).trim().slice(0, 60) }))
    : [];

  const notice = Array.isArray(payload.notice)
    ? payload.notice.map((line) => String(line).trim()).filter(Boolean).slice(0, 8)
    : [];

  return {
    title,
    categoryId,
    summary,
    description,
    location,
    target,
    capacity: Math.round(capacity),
    startAt: Math.round(startAt),
    endAt: Math.round(endAt),
    regDeadline: Math.round(regDeadline),
    agenda,
    notice,
    coverTone: String(payload.coverTone || "jade").slice(0, 20)
  };
}

function saveActivity(db, user, payload) {
  const data = normalizeActivityPayload(payload);
  const now = Date.now();
  const id = payload.id || "";

  if (id) {
    const existing = dbm.activityById(db, id);
    if (!existing) throw httpError(404, "活动不存在");
    if (!canManage(existing, user)) throw httpError(403, "只能修改自己发布的活动");
    if (existing.review_status === "pending") throw httpError(409, "活动正在审核中，暂时无法修改");

    const stats = dbm.registrationStats(db, id);
    if (data.capacity < stats.confirmed) {
      throw httpError(400, `已有 ${stats.confirmed} 人报名，名额不能小于该人数`);
    }

    db.prepare(
      `UPDATE activities SET
         title = ?, category_id = ?, summary = ?, description = ?, location = ?, target = ?,
         capacity = ?, start_at = ?, end_at = ?, reg_deadline = ?, cover_tone = ?,
         agenda_json = ?, notice_json = ?, updated_at = ?,
         review_status = ?, review_at = ?, review_by = ?, review_reason = ?
       WHERE id = ?`
    ).run(
      data.title,
      data.categoryId,
      data.summary,
      data.description,
      data.location,
      data.target,
      data.capacity,
      data.startAt,
      data.endAt,
      data.regDeadline,
      data.coverTone,
      JSON.stringify(data.agenda),
      JSON.stringify(data.notice),
      now,
      "draft",
      0,
      "",
      "",
      id
    );
    return dbm.mapActivity(dbm.activityById(db, id), dbm.registrationStats(db, id));
  }

  const newId = dbm.newId("a");
  db.prepare(
    `INSERT INTO activities (
       id, title, category_id, organizer_id, location, target, capacity,
       start_at, end_at, reg_deadline, created_at, updated_at, cover_tone,
       summary, description, agenda_json, notice_json,
       review_status, review_at, review_by, review_reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, '', '')`
  ).run(
    newId,
    data.title,
    data.categoryId,
    user.id,
    data.location,
    data.target,
    data.capacity,
    data.startAt,
    data.endAt,
    data.regDeadline,
    now,
    now,
    data.coverTone,
    data.summary,
    data.description,
    JSON.stringify(data.agenda),
    JSON.stringify(data.notice)
  );
  return dbm.mapActivity(dbm.activityById(db, newId), { confirmed: 0, waitlist: 0, checked: 0 });
}

function submitActivity(db, user, id) {
  const activity = dbm.activityById(db, id);
  if (!activity) throw httpError(404, "活动不存在");
  if (!canManage(activity, user)) throw httpError(403, "只能提交自己发布的活动");
  if (activity.review_status === "approved" || activity.review_status === "pending") {
    throw httpError(409, "活动已上架或正在审核中");
  }
  if (activity.review_status === "rejected" || activity.review_status === "draft") {
    const stats = dbm.registrationStats(db, id);
    if (stats.confirmed > activity.capacity) throw httpError(400, "名额小于已报名人数，请先调整名额");
  }

  db.prepare("UPDATE activities SET review_status = 'pending', review_at = ?, review_by = '', review_reason = '', updated_at = ? WHERE id = ?").run(
    Date.now(),
    Date.now(),
    id
  );

  adminIds(db).forEach((adminId) => {
    addNotice(db, adminId, {
      type: "review",
      title: "新活动待审核：" + activity.title,
      body: user.name + " 提交了活动审核申请，请在「活动审核」中处理。",
      activityId: id
    });
  });

  return dbm.mapActivity(dbm.activityById(db, id), dbm.registrationStats(db, id));
}

function deleteActivity(db, user, id) {
  const activity = dbm.activityById(db, id);
  if (!activity) throw httpError(404, "活动不存在");
  if (!canManage(activity, user)) throw httpError(403, "只能删除自己发布的活动");
  db.prepare("DELETE FROM activities WHERE id = ?").run(id);
  return { ok: true };
}

function reviewActivity(db, admin, id, decision, reason) {
  const activity = dbm.activityById(db, id);
  if (!activity) throw httpError(404, "活动不存在");
  if (activity.review_status !== "pending") throw httpError(409, "该活动不在待审核状态");

  const approve = decision === "approved";
  if (!approve && String(reason || "").trim().length < 6) {
    throw httpError(400, "请填写至少 6 个字的驳回理由");
  }

  db.prepare(
    "UPDATE activities SET review_status = ?, review_at = ?, review_by = ?, review_reason = ?, updated_at = ? WHERE id = ?"
  ).run(approve ? "approved" : "rejected", Date.now(), admin.id, approve ? "" : String(reason).trim(), Date.now(), id);

  addNotice(db, activity.organizer_id, {
    type: "review",
    title: (approve ? "审核通过：" : "审核未通过：") + activity.title,
    body: approve
      ? "活动已上架，师生现在可以在活动广场中查看并报名。"
      : "驳回理由：" + String(reason).trim(),
    activityId: id
  });

  return dbm.mapActivity(dbm.activityById(db, id), dbm.registrationStats(db, id));
}

/* --------------------------------------------------------------------------
   报名与候补
   -------------------------------------------------------------------------- */

function assertOpen(activity) {
  if (activity.review_status !== "approved") throw httpError(409, "活动尚未上架，暂不能报名");
  const status = statusOf(activity);
  if (status !== "open") {
    throw httpError(409, status === "ended" ? "活动已结束" : "当前不在报名时间内");
  }
}

function register(db, user, activityId, payload) {
  const activity = dbm.activityById(db, activityId);
  if (!activity) throw httpError(404, "活动不存在");
  assertOpen(activity);

  const body = payload || {};
  const name = String(body.name || user.name).trim();
  const className = String(body.className || user.class_name || "").trim();
  const phone = String(body.phone || user.phone || "").trim();
  const note = String(body.note || "").trim().slice(0, 200);

  if (!name) throw httpError(400, "请填写姓名");
  if (!className) throw httpError(400, "请填写班级");
  if (phone && !/^1[3-9]\d{9}$/.test(phone.replace(/\s/g, ""))) {
    throw httpError(400, "手机号格式不正确");
  }

  return dbm.transaction(db, () => {
    const existing = db
      .prepare("SELECT id FROM registrations WHERE activity_id = ? AND user_id = ? AND status <> 'cancelled'")
      .get(activityId, user.id);
    if (existing) throw httpError(409, "你已经报名过这场活动");

    const stats = dbm.registrationStats(db, activityId);
    const waitlist = stats.confirmed >= activity.capacity;

    let code = "";
    for (let attempt = 0; attempt < 30; attempt += 1) {
      code = String(Math.floor(100000 + Math.random() * 900000));
      const clash = db
        .prepare("SELECT id FROM registrations WHERE activity_id = ? AND code = ?")
        .get(activityId, code);
      if (!clash) break;
      code = "";
    }
    if (!code) throw httpError(500, "签到码生成失败，请重试");

    const id = dbm.newId("r");
    db.prepare(
      `INSERT INTO registrations (id, activity_id, user_id, name, class_name, grade, phone, note, status, code, created_at, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      id,
      activityId,
      user.id,
      name,
      className,
      user.grade || "",
      phone.replace(/\s/g, ""),
      note,
      waitlist ? "waitlist" : "confirmed",
      code,
      Date.now()
    );

    addNotice(db, user.id, {
      type: "signup",
      title: (waitlist ? "已进入候补：" : "报名成功：") + activity.title,
      body: waitlist
        ? "当前名额已满，你在候补队列第 " + (stats.waitlist + 1) + " 位，有人取消时会自动递补。"
        : "签到码 " + code + "，可在「我的报名」中查看。",
      activityId
    });

    if (!waitlist && stats.confirmed + 1 === activity.capacity) {
      addNotice(db, activity.organizer_id, {
        type: "system",
        title: "名额已满：" + activity.title,
        body: "最后一位名额已报满，后续报名将进入候补队列。",
        activityId
      });
    }

    const row = db.prepare("SELECT * FROM registrations WHERE id = ?").get(id);
    return {
      registration: dbm.mapRegistration(row),
      waitlist,
      activity: dbm.mapActivity(dbm.activityById(db, activityId), dbm.registrationStats(db, activityId))
    };
  });
}

function cancelRegistration(db, user, registrationId) {
  const row = db.prepare("SELECT * FROM registrations WHERE id = ?").get(registrationId);
  if (!row) throw httpError(404, "报名记录不存在");
  if (row.status === "cancelled") throw httpError(409, "该报名已取消");

  const activity = dbm.activityById(db, row.activity_id);
  if (!activity) throw httpError(404, "活动不存在");
  const isOwner = row.user_id === user.id;
  if (!isOwner && !canManage(activity, user)) throw httpError(403, "没有权限取消这条报名");
  if (statusOf(activity) === "ended") throw httpError(409, "活动已结束，不能取消报名");

  return dbm.transaction(db, () => {
    const wasConfirmed = row.status === "confirmed" || row.status === "checked";
    db.prepare("UPDATE registrations SET status = 'cancelled', checked_at = NULL WHERE id = ?").run(registrationId);

    let promoted = null;
    if (wasConfirmed) {
      const next = db
        .prepare(
          "SELECT * FROM registrations WHERE activity_id = ? AND status = 'waitlist' ORDER BY created_at ASC LIMIT 1"
        )
        .get(row.activity_id);
      if (next) {
        db.prepare("UPDATE registrations SET status = 'confirmed' WHERE id = ?").run(next.id);
        promoted = dbm.mapRegistration(db.prepare("SELECT * FROM registrations WHERE id = ?").get(next.id));
        addNotice(db, next.user_id, {
          type: "system",
          title: "候补递补成功：" + activity.title,
          body: "前排同学取消报名，你已从候补转入正式名单。签到码 " + next.code + "。",
          activityId: activity.id
        });
      }
    }

    return {
      promoted,
      activity: dbm.mapActivity(dbm.activityById(db, activity.id), dbm.registrationStats(db, activity.id))
    };
  });
}

/* --------------------------------------------------------------------------
   签到核销
   -------------------------------------------------------------------------- */

function checkInByCode(db, user, activityId, rawCode) {
  const activity = dbm.activityById(db, activityId);
  if (!activity) throw httpError(404, "活动不存在");
  if (!canManage(activity, user)) throw httpError(403, "只有活动组织者可以核销");

  const code = String(rawCode || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) throw httpError(400, "签到码为 6 位数字");

  const row = db
    .prepare("SELECT * FROM registrations WHERE activity_id = ? AND code = ? AND status <> 'cancelled'")
    .get(activityId, code);
  if (!row) throw httpError(404, "本场活动中没有匹配的签到码，请确认活动是否选错");
  if (row.status === "checked") {
    throw httpError(409, row.name + " 已于 " + new Date(row.checked_at).toLocaleString("zh-CN") + " 核销，请勿重复操作");
  }
  if (row.status === "waitlist") throw httpError(409, row.name + " 仍在候补队列，未获得正式名额");

  db.prepare("UPDATE registrations SET status = 'checked', checked_at = ? WHERE id = ?").run(Date.now(), row.id);
  return {
    registration: dbm.mapRegistration(db.prepare("SELECT * FROM registrations WHERE id = ?").get(row.id)),
    activity: dbm.mapActivity(dbm.activityById(db, activityId), dbm.registrationStats(db, activityId))
  };
}

function checkInById(db, user, registrationId) {
  const row = db.prepare("SELECT * FROM registrations WHERE id = ?").get(registrationId);
  if (!row) throw httpError(404, "报名记录不存在");
  const activity = dbm.activityById(db, row.activity_id);
  if (!activity || !canManage(activity, user)) throw httpError(403, "只有活动组织者可以核销");
  if (row.status === "checked") throw httpError(409, "该记录已核销");
  if (row.status !== "confirmed") throw httpError(409, "只有正式报名可以通过核销");

  db.prepare("UPDATE registrations SET status = 'checked', checked_at = ? WHERE id = ?").run(Date.now(), row.id);
  return { registration: dbm.mapRegistration(db.prepare("SELECT * FROM registrations WHERE id = ?").get(row.id)) };
}

function undoCheckIn(db, user, registrationId) {
  const row = db.prepare("SELECT * FROM registrations WHERE id = ?").get(registrationId);
  if (!row) throw httpError(404, "报名记录不存在");
  const activity = dbm.activityById(db, row.activity_id);
  if (!activity || !canManage(activity, user)) throw httpError(403, "只有活动组织者可以撤销核销");
  if (row.status !== "checked") throw httpError(409, "该记录不在已核销状态");

  db.prepare("UPDATE registrations SET status = 'confirmed', checked_at = NULL WHERE id = ?").run(registrationId);
  return { registration: dbm.mapRegistration(db.prepare("SELECT * FROM registrations WHERE id = ?").get(row.id)) };
}

function roster(db, user, activityId) {
  const activity = dbm.activityById(db, activityId);
  if (!activity) throw httpError(404, "活动不存在");
  if (!canManage(activity, user)) throw httpError(403, "只有活动组织者与管理员可以查看报名名单");
  const rows = db
    .prepare("SELECT * FROM registrations WHERE activity_id = ? AND status <> 'cancelled' ORDER BY created_at ASC")
    .all(activityId);
  return {
    activity: dbm.mapActivity(activity, dbm.registrationStats(db, activityId)),
    registrations: rows.map(dbm.mapRegistration)
  };
}

/* --------------------------------------------------------------------------
   通知
   -------------------------------------------------------------------------- */

function notices(db, user) {
  return db
    .prepare("SELECT * FROM notices WHERE user_id = ? ORDER BY created_at DESC LIMIT 100")
    .all(user.id)
    .map(dbm.mapNotice);
}

function markNoticeRead(db, user, noticeId) {
  db.prepare("UPDATE notices SET read_at = ? WHERE id = ? AND user_id = ? AND read_at = 0").run(Date.now(), noticeId, user.id);
  return { ok: true };
}

function markAllNoticesRead(db, user) {
  db.prepare("UPDATE notices SET read_at = ? WHERE user_id = ? AND read_at = 0").run(Date.now(), user.id);
  return { ok: true };
}

/* --------------------------------------------------------------------------
   账号
   -------------------------------------------------------------------------- */

function listUsers(db) {
  return db
    .prepare("SELECT * FROM users ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'organizer' THEN 1 ELSE 2 END, name COLLATE NOCASE")
    .all()
    .map(dbm.mapUser);
}

function createUser(db, payload) {
  const name = String(payload.name || "").trim();
  const account = String(payload.account || "").trim();
  const role = String(payload.role || "student");
  const password = String(payload.password || "");
  const className = String(payload.className || "").trim();
  const department = String(payload.department || "").trim();
  const phone = String(payload.phone || "").trim();

  if (!name) throw httpError(400, "请填写姓名");
  if (!/^[A-Za-z0-9_-]{4,24}$/.test(account)) throw httpError(400, "账号需要 4 到 24 位字母或数字");
  if (!ROLES[role]) throw httpError(400, "角色不合法");
  if (password.length < 8) throw httpError(400, "初始密码至少 8 位");
  if (dbm.userByAccount(db, account)) throw httpError(409, "账号已存在");

  const id = dbm.newId("u");
  db.prepare(
    `INSERT INTO users (id, name, account, password_hash, role, class_name, grade, phone, title, department, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
  ).run(
    id,
    name,
    account,
    auth.hashPassword(password),
    role,
    className,
    className.indexOf("高一") === 0 ? "高一" : className.indexOf("高二") === 0 ? "高二" : className.indexOf("高三") === 0 ? "高三" : "",
    phone,
    role === "admin" ? "管理员" : role === "organizer" ? "活动组织者" : "学生",
    department || "未分组",
    Date.now()
  );
  return dbm.mapUser(dbm.userById(db, id));
}

function updateUser(db, admin, id, payload) {
  const user = dbm.userById(db, id);
  if (!user) throw httpError(404, "账号不存在");

  const fields = [];
  const values = [];
  if (payload.name !== undefined) {
    const name = String(payload.name).trim();
    if (!name) throw httpError(400, "姓名不能为空");
    fields.push("name = ?");
    values.push(name);
  }
  if (payload.className !== undefined) {
    fields.push("class_name = ?");
    values.push(String(payload.className).trim());
  }
  if (payload.department !== undefined) {
    fields.push("department = ?");
    values.push(String(payload.department).trim());
  }
  if (payload.phone !== undefined) {
    fields.push("phone = ?");
    values.push(String(payload.phone).trim());
  }
  if (payload.status !== undefined) {
    if (["active", "disabled"].indexOf(payload.status) === -1) throw httpError(400, "状态不合法");
    if (user.id === admin.id && payload.status === "disabled") throw httpError(400, "不能停用当前登录的账号");
    fields.push("status = ?");
    values.push(payload.status);
    if (payload.status === "disabled") auth.destroyUserSessions(db, user.id);
  }
  if (payload.role !== undefined) {
    if (!ROLES[payload.role]) throw httpError(400, "角色不合法");
    if (user.id === admin.id && payload.role !== "admin") throw httpError(400, "不能修改自己的管理员角色");
    fields.push("role = ?");
    values.push(payload.role);
  }

  if (!fields.length) return dbm.mapUser(user);
  values.push(id);
  db.prepare("UPDATE users SET " + fields.join(", ") + " WHERE id = ?").run(...values);
  return dbm.mapUser(dbm.userById(db, id));
}

function resetPassword(db, admin, id, newPassword) {
  const user = dbm.userById(db, id);
  if (!user) throw httpError(404, "账号不存在");
  if (String(newPassword || "").length < 8) throw httpError(400, "新密码至少 8 位");
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(auth.hashPassword(newPassword), id);
  auth.destroyUserSessions(db, id);
  return { ok: true };
}

function changePassword(db, user, currentPassword, newPassword) {
  const row = dbm.userById(db, user.id);
  if (!row) throw httpError(404, "账号不存在");
  if (!auth.verifyPassword(currentPassword, row.password_hash)) throw httpError(400, "当前密码不正确");
  if (String(newPassword || "").length < 8) throw httpError(400, "新密码至少 8 位");
  if (currentPassword === newPassword) throw httpError(400, "新密码不能与当前密码相同");
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(auth.hashPassword(newPassword), user.id);
  return { ok: true };
}

/* --------------------------------------------------------------------------
   统计
   -------------------------------------------------------------------------- */

function monthKey(ts) {
  const date = new Date(ts);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

function buildStats(db) {
  const now = Date.now();
  const approved = db.prepare("SELECT * FROM activities WHERE review_status = 'approved'").all();
  const registrations = db.prepare("SELECT * FROM registrations WHERE status <> 'cancelled'").all();
  const pending = db.prepare("SELECT COUNT(*) AS count FROM activities WHERE review_status = 'pending'").get();
  const students = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'student'").get();

  const checked = registrations.filter((row) => row.status === "checked");
  const waitlist = registrations.filter((row) => row.status === "waitlist");

  const endedIds = new Set(approved.filter((row) => row.end_at < now).map((row) => row.id));
  const endedRegs = registrations.filter((row) => endedIds.has(row.activity_id) && row.status !== "waitlist");
  const endedChecked = endedRegs.filter((row) => row.status === "checked");

  const months = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = 5; i >= 0; i -= 1) {
    const date = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    const key = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
    months.push({
      label: String(date.getMonth() + 1).padStart(2, "0") + "月",
      key,
      value: registrations.filter((row) => monthKey(row.created_at) === key).length
    });
  }

  const byCategory = CATEGORIES.map((category) => {
    const acts = approved.filter((row) => row.category_id === category.id);
    const ids = new Set(acts.map((row) => row.id));
    return {
      id: category.id,
      name: category.name,
      icon: category.icon,
      activities: acts.length,
      registrations: registrations.filter((row) => ids.has(row.activity_id)).length
    };
  }).sort((a, b) => b.registrations - a.registrations);

  const grades = ["高一", "高二", "高三"];
  const byGrade = grades.map((grade) => ({
    name: grade,
    value: registrations.filter((row) => row.grade === grade).length
  }));
  const otherGrade = registrations.filter((row) => grades.indexOf(row.grade) === -1).length;
  if (otherGrade) byGrade.push({ name: "其他", value: otherGrade });

  const top = approved
    .map((activity) => {
      const regs = registrations.filter((row) => row.activity_id === activity.id && row.status !== "waitlist");
      const checkedCount = regs.filter((row) => row.status === "checked").length;
      return {
        id: activity.id,
        title: activity.title,
        registrations: regs.length,
        capacity: activity.capacity,
        checkin: regs.length ? Math.round((checkedCount / regs.length) * 100) : 0,
        ended: activity.end_at < now,
        endAt: activity.end_at
      };
    })
    .sort((a, b) => b.registrations - a.registrations)
    .slice(0, 6);

  return {
    activities: approved.length,
    liveActivities: approved.filter((row) => {
      const status = statusOf(row);
      return status === "open" || status === "live";
    }).length,
    registrations: registrations.length,
    checked: checked.length,
    waitlist: waitlist.length,
    students: Number(students.count || 0),
    pending: Number(pending.count || 0),
    checkinRate: endedRegs.length ? Math.round((endedChecked.length / endedRegs.length) * 100) : 0,
    months: months.map((item) => ({ label: item.label, value: item.value })),
    byCategory,
    byGrade,
    top
  };
}

/* --------------------------------------------------------------------------
   启动数据
   -------------------------------------------------------------------------- */

function bootstrap(db, user) {
  const rows = visibleRows(db, user);
  const activities = hydrate(db, rows);
  const directory = db
    .prepare("SELECT id, name, role, class_name, grade, title, department FROM users WHERE status = 'active'")
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      className: row.class_name,
      grade: row.grade,
      title: row.title,
      department: row.department
    }));

  let registrations = [];
  if (user.role === "admin") {
    registrations = db
      .prepare("SELECT * FROM registrations WHERE status <> 'cancelled' ORDER BY created_at DESC")
      .all()
      .map(dbm.mapRegistration);
  } else if (user.role === "organizer") {
    registrations = db
      .prepare(
        `SELECT r.* FROM registrations r JOIN activities a ON a.id = r.activity_id
         WHERE a.organizer_id = ? AND r.status <> 'cancelled' ORDER BY r.created_at DESC`
      )
      .all(user.id)
      .map(dbm.mapRegistration);
  } else {
    registrations = db
      .prepare("SELECT * FROM registrations WHERE user_id = ? AND status <> 'cancelled' ORDER BY created_at DESC")
      .all(user.id)
      .map(dbm.mapRegistration);
  }

  return {
    user: dbm.mapUser(user),
    categories: CATEGORIES,
    roles: ROLES,
    activities,
    registrations,
    notices: notices(db, user),
    directory,
    users: user.role === "admin" ? listUsers(db) : [],
    stats: user.role === "admin" ? buildStats(db) : null,
    serverTime: Date.now()
  };
}

function login(db, account, password, context) {
  const ip = (context && context.ip) || "unknown";
  if (auth.isBlocked(ip, account)) throw httpError(429, "登录失败次数过多，请 10 分钟后再试");

  const row = dbm.userByAccount(db, String(account || "").trim());
  if (!row || !auth.verifyPassword(password, row.password_hash)) {
    auth.recordFailure(ip, account);
    throw httpError(401, "账号或密码不正确");
  }
  if (row.status === "disabled") throw httpError(403, "账号已被停用，请联系学校管理员");

  auth.clearFailures(ip, account);
  const session = auth.createSession(db, row.id, context && context.userAgent);
  return { token: session.token, expiresAt: session.expiresAt, user: dbm.mapUser(row) };
}

module.exports = {
  CATEGORIES,
  ROLES,
  statusOf,
  bootstrap,
  login,
  getActivity,
  saveActivity,
  submitActivity,
  deleteActivity,
  reviewActivity,
  register,
  cancelRegistration,
  checkInByCode,
  checkInById,
  undoCheckIn,
  roster,
  notices,
  markNoticeRead,
  markAllNoticesRead,
  listUsers,
  createUser,
  updateUser,
  resetPassword,
  changePassword,
  buildStats
};
