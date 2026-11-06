/* ==========================================================================
   客户端数据层：与服务端 REST 接口通信，并在内存中维护只读缓存。
   视图层通过 DB 读取缓存（同步），写操作返回 Promise。
   ========================================================================== */

(function (global) {
  "use strict";

  var state = {
    user: null,
    categories: [],
    roles: {},
    activities: [],
    registrations: [],
    notices: [],
    users: [],
    directory: [],
    stats: null,
    serverTime: 0
  };

  var loaded = false;

  function api(path, options) {
    var opts = options || {};
    return fetch(path, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin"
    }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (response.status === 401 && global.location.pathname.indexOf("app.html") !== -1) {
            global.location.replace("login.html?expired=1");
          }
          if (!response.ok) {
            var error = new Error(data.error || "请求失败（" + response.status + "）");
            error.status = response.status;
            error.data = data;
            throw error;
          }
          return data;
        });
    });
  }

  function apply(data) {
    state.user = data.user || null;
    state.categories = data.categories || [];
    state.roles = data.roles || {};
    state.activities = data.activities || [];
    state.registrations = data.registrations || [];
    state.notices = data.notices || [];
    state.users = data.users || [];
    state.directory = data.directory || [];
    state.stats = data.stats || null;
    state.serverTime = data.serverTime || Date.now();
    loaded = true;
    return state;
  }

  function load() {
    return api("/api/bootstrap").then(apply);
  }

  function login(account, password) {
    return api("/api/auth/login", { method: "POST", body: { account: account, password: password } }).then(function (data) {
      return load().then(function () {
        return data.user;
      });
    });
  }

  function logout() {
    return api("/api/auth/logout", { method: "POST" }).then(function () {
      state.user = null;
      loaded = false;
    });
  }

  /* ------------------------------------------------------------------------
     只读查询（同步，供视图渲染使用）
     ------------------------------------------------------------------------ */

  function activities() {
    return state.activities;
  }

  function activityById(id) {
    return (
      state.activities.filter(function (activity) {
        return activity.id === id;
      })[0] || null
    );
  }

  function userById(id) {
    return (
      state.users.filter(function (user) {
        return user.id === id;
      })[0] ||
      state.directory.filter(function (user) {
        return user.id === id;
      })[0] ||
      null
    );
  }

  function categoryById(id) {
    return (
      state.categories.filter(function (category) {
        return category.id === id;
      })[0] || { id: "other", name: "其他", icon: "flag", tone: "jade" }
    );
  }

  function statusOf(activity) {
    if (!activity) return { key: "unknown", label: "未知", tone: "muted" };
    var review = activity.review || { status: "approved" };
    if (review.status === "draft") return { key: "draft", label: "草稿", tone: "muted" };
    if (review.status === "pending") return { key: "pending", label: "待审核", tone: "warn" };
    if (review.status === "rejected") return { key: "rejected", label: "已驳回", tone: "danger" };
    var now = Date.now();
    if (now < activity.regDeadline) return { key: "open", label: "报名中", tone: "accent" };
    if (now < activity.startAt) return { key: "closed", label: "报名截止", tone: "info" };
    if (now <= activity.endAt) return { key: "live", label: "进行中", tone: "accent" };
    return { key: "ended", label: "已结束", tone: "muted" };
  }

  function registrationsOf(activityId) {
    return state.registrations
      .filter(function (registration) {
        return registration.activityId === activityId && registration.status !== "cancelled";
      })
      .sort(function (a, b) {
        return a.createdAt - b.createdAt;
      });
  }

  function confirmedOf(activityId) {
    return registrationsOf(activityId).filter(function (registration) {
      return registration.status === "confirmed" || registration.status === "checked";
    });
  }

  function waitlistOf(activityId) {
    return registrationsOf(activityId).filter(function (registration) {
      return registration.status === "waitlist";
    });
  }

  function checkedOf(activityId) {
    return registrationsOf(activityId).filter(function (registration) {
      return registration.status === "checked";
    });
  }

  function myRegistration(activityId, userId) {
    return (
      state.registrations.filter(function (registration) {
        return registration.activityId === activityId && registration.userId === userId && registration.status !== "cancelled";
      })[0] || null
    );
  }

  function myRegistrations(userId) {
    return state.registrations
      .filter(function (registration) {
        return registration.userId === userId && registration.status !== "cancelled";
      })
      .sort(function (a, b) {
        return b.createdAt - a.createdAt;
      });
  }

  function seats(activity) {
    var stats = activity.stats || { confirmed: 0, waitlist: 0, checked: 0 };
    return {
      confirmed: stats.confirmed,
      waitlist: stats.waitlist,
      checked: stats.checked || 0,
      capacity: activity.capacity,
      left: Math.max(0, activity.capacity - stats.confirmed),
      full: stats.confirmed >= activity.capacity,
      percent: Math.min(100, Math.round((stats.confirmed / Math.max(1, activity.capacity)) * 100))
    };
  }

  function noticesFor(userId) {
    return state.notices
      .filter(function (notice) {
        return notice.userId === userId;
      })
      .sort(function (a, b) {
        return b.createdAt - a.createdAt;
      });
  }

  function unreadCount(userId) {
    return noticesFor(userId).filter(function (notice) {
      return !notice.read;
    }).length;
  }

  function rosterCsv(activityId) {
    var activity = activityById(activityId);
    var rows = [["姓名", "班级", "手机", "状态", "报名时间", "签到时间", "签到码"]];
    registrationsOf(activityId).forEach(function (registration) {
      rows.push([
        registration.name,
        registration.className,
        registration.phone || "",
        registration.status === "checked" ? "已签到" : registration.status === "waitlist" ? "候补" : "已报名",
        timeLabel(registration.createdAt),
        registration.checkedAt ? timeLabel(registration.checkedAt) : "",
        registration.code
      ]);
    });
    return {
      filename: (activity ? activity.title : "报名名单") + " 报名名单.csv",
      content: rows
        .map(function (row) {
          return row
            .map(function (cell) {
              return '"' + String(cell).replace(/"/g, '""') + '"';
            })
            .join(",");
        })
        .join("\r\n")
    };
  }

  function timeLabel(ts) {
    if (!ts) return "未签到";
    var date = new Date(ts);
    var pad = function (n) {
      return n < 10 ? "0" + n : String(n);
    };
    return pad(date.getMonth() + 1) + "月" + pad(date.getDate()) + "日 " + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  /* ------------------------------------------------------------------------
     缓存更新
     ------------------------------------------------------------------------ */

  function replaceActivity(activity) {
    if (!activity) return;
    var index = state.activities.findIndex(function (item) {
      return item.id === activity.id;
    });
    if (index === -1) state.activities.unshift(activity);
    else state.activities[index] = activity;
  }

  function recomputeStats(activityId) {
    var activity = activityById(activityId);
    if (!activity) return;
    var list = registrationsOf(activityId);
    activity.stats = {
      confirmed: list.filter(function (registration) {
        return registration.status === "confirmed" || registration.status === "checked";
      }).length,
      waitlist: list.filter(function (registration) {
        return registration.status === "waitlist";
      }).length,
      checked: list.filter(function (registration) {
        return registration.status === "checked";
      }).length
    };
  }

  function applyRegistration(registration) {
    if (!registration) return;
    var index = state.registrations.findIndex(function (item) {
      return item.id === registration.id;
    });
    if (index === -1) state.registrations.push(registration);
    else state.registrations[index] = registration;
    recomputeStats(registration.activityId);
  }

  /* ------------------------------------------------------------------------
     写操作
     ------------------------------------------------------------------------ */

  function register(activityId, payload) {
    return api("/api/activities/" + activityId + "/registrations", { method: "POST", body: payload || {} }).then(function (result) {
      replaceActivity(result.activity);
      applyRegistration(result.registration);
      return load().then(function () {
        return result;
      });
    });
  }

  function cancel(registrationId) {
    return api("/api/registrations/" + registrationId, { method: "DELETE" }).then(function (result) {
      replaceActivity(result.activity);
      return load().then(function () {
        return result;
      });
    });
  }

  function checkIn(activityId, code) {
    return api("/api/activities/" + activityId + "/checkin", { method: "POST", body: { code: code } });
  }

  function checkInById(registrationId) {
    return api("/api/registrations/" + registrationId + "/checkin", { method: "POST" });
  }

  function undoCheckIn(registrationId) {
    return api("/api/registrations/" + registrationId + "/checkin", { method: "DELETE" });
  }

  function saveActivity(payload) {
    return api("/api/activities", { method: "POST", body: payload }).then(function (activity) {
      if (!payload.submit) {
        return load().then(function () {
          return activity;
        });
      }
      return api("/api/activities/" + activity.id + "/submit", { method: "POST" }).then(function (submitted) {
        return load().then(function () {
          return submitted;
        });
      });
    });
  }

  function submitForReview(activityId) {
    return api("/api/activities/" + activityId + "/submit", { method: "POST" }).then(function (activity) {
      return load().then(function () {
        return activity;
      });
    });
  }

  function deleteActivity(activityId) {
    return api("/api/activities/" + activityId, { method: "DELETE" }).then(function (result) {
      return load().then(function () {
        return result;
      });
    });
  }

  function reviewActivity(activityId, decision, reason) {
    return api("/api/activities/" + activityId + "/review", {
      method: "POST",
      body: { decision: decision, reason: reason || "" }
    }).then(function (activity) {
      return load().then(function () {
        return activity;
      });
    });
  }

  function markRead(noticeId) {
    var notice = state.notices.filter(function (item) {
      return item.id === noticeId;
    })[0];
    if (notice) notice.read = true;
    return api("/api/notices/read", { method: "POST", body: { id: noticeId } }).catch(function () {
      if (notice) notice.read = false;
    });
  }

  function markAllRead() {
    state.notices.forEach(function (notice) {
      notice.read = true;
    });
    return api("/api/notices/read", { method: "POST", body: { all: true } });
  }

  function createUser(payload) {
    return api("/api/users", { method: "POST", body: payload }).then(function (user) {
      return load().then(function () {
        return user;
      });
    });
  }

  function updateUser(userId, patch) {
    return api("/api/users/" + userId, { method: "PATCH", body: patch }).then(function (user) {
      return load().then(function () {
        return user;
      });
    });
  }

  function resetPassword(userId, password) {
    return api("/api/users/" + userId + "/password", { method: "POST", body: { password: password } });
  }

  function changePassword(currentPassword, newPassword) {
    return api("/api/auth/password", { method: "POST", body: { currentPassword: currentPassword, newPassword: newPassword } });
  }

  function refreshStats() {
    return api("/api/stats").then(function (stats) {
      state.stats = stats;
      return stats;
    });
  }

  var DB = {
    api: api,
    init: load,
    load: load,
    login: login,
    logout: logout,
    isLoaded: function () {
      return loaded;
    },
    state: function () {
      return state;
    },
    user: function () {
      return state.user;
    },
    categories: function () {
      return state.categories;
    },
    roles: function () {
      return state.roles;
    },
    users: function () {
      return state.users;
    },
    directory: function () {
      return state.directory;
    },
    activities: activities,
    activityById: activityById,
    userById: userById,
    categoryById: categoryById,
    statusOf: statusOf,
    registrationsOf: registrationsOf,
    confirmedOf: confirmedOf,
    waitlistOf: waitlistOf,
    checkedOf: checkedOf,
    myRegistration: myRegistration,
    myRegistrations: myRegistrations,
    seats: seats,
    noticesFor: noticesFor,
    unreadCount: unreadCount,
    stats: function () {
      return state.stats || { activities: 0, registrations: 0, checked: 0, checkinRate: 0, waitlist: 0, pending: 0, top: [], byCategory: [], byGrade: [], months: [] };
    },
    rosterCsv: rosterCsv,
    timeLabel: timeLabel,
    register: register,
    cancel: cancel,
    checkIn: checkIn,
    checkInById: checkInById,
    undoCheckIn: undoCheckIn,
    saveActivity: saveActivity,
    submitForReview: submitForReview,
    deleteActivity: deleteActivity,
    reviewActivity: reviewActivity,
    markRead: markRead,
    markAllRead: markAllRead,
    createUser: createUser,
    updateUser: updateUser,
    resetPassword: resetPassword,
    changePassword: changePassword,
    refreshStats: refreshStats,
    applyRegistration: applyRegistration,
    replaceActivity: replaceActivity
  };

  global.DB = DB;
})(window);
