/* ==========================================================================
   Participant views: activity square, activity detail, my registrations
   ========================================================================== */

(function (global) {
  "use strict";

  var DB = global.DB;
  var UI = global.UI;
  var Views = (global.Views = global.Views || {});

  var statusOptions = [
    { value: "open", label: "报名中" },
    { value: "all", label: "全部状态" },
    { value: "closed", label: "报名截止" },
    { value: "live", label: "进行中" },
    { value: "ended", label: "已结束" }
  ];

  var sortOptions = [
    { value: "soon", label: "即将开始" },
    { value: "new", label: "最新发布" },
    { value: "hot", label: "报名最多" }
  ];

  function approvedActivities() {
    return DB.activities().filter(function (activity) {
      return activity.review.status === "approved";
    });
  }

  /* ------------------------------------------------------------------------
     Activity square
     ------------------------------------------------------------------------ */

  Views.square = {
    meta: function () {
      var open = approvedActivities().filter(function (activity) {
        return DB.statusOf(activity).key === "open";
      }).length;
      return {
        title: "活动广场",
        sub: open + " 场活动正在报名，共 " + approvedActivities().length + " 场已上架"
      };
    },

    render: function (ctx) {
      var categories = DB.categories();
      return (
        '<div class="toolbar">' +
        '<label class="search-field">' +
        App.icon("magnifying-glass") +
        '<input type="search" id="squareSearch" placeholder="搜索活动名称、地点或主办方" aria-label="搜索活动">' +
        "</label>" +
        '<select class="select toolbar-select" id="statusFilter" aria-label="活动状态">' +
        statusOptions
          .map(function (option) {
            return '<option value="' + option.value + '"' + (option.value === "open" ? " selected" : "") + ">" + option.label + "</option>";
          })
          .join("") +
        "</select>" +
        '<select class="select toolbar-select" id="sortFilter" aria-label="排序方式">' +
        sortOptions
          .map(function (option) {
            return '<option value="' + option.value + '">' + option.label + "</option>";
          })
          .join("") +
        "</select>" +
        "</div>" +
        '<div class="filter-chips" role="group" aria-label="活动分类">' +
        '<button class="chip button-sm" type="button" data-cat="all" aria-pressed="true">全部</button>' +
        categories
          .map(function (category) {
            return (
              '<button class="chip button-sm" type="button" data-cat="' +
              category.id +
              '" aria-pressed="false">' +
              App.icon(category.icon) +
              category.name +
              "</button>"
            );
          })
          .join("") +
        "</div>" +
        '<div class="section-row"><p class="caption-2 muted" id="resultCount"></p>' +
        '<span class="caption-2 muted" id="resultHint"></span></div>' +
        '<div class="activity-grid" id="activityGrid"></div>'
      );
    },

    mount: function (root, ctx) {
      var state = {
        q: ctx.query.q || "",
        cat: ctx.query.cat || "all",
        status: ctx.query.status || "open",
        sort: ctx.query.sort || "soon"
      };
      var grid = root.querySelector("#activityGrid");
      var count = root.querySelector("#resultCount");
      var hint = root.querySelector("#resultHint");
      var search = root.querySelector("#squareSearch");

      if (state.cat !== "all") {
        root.querySelectorAll("[data-cat]").forEach(function (chip) {
          chip.setAttribute("aria-pressed", String(chip.getAttribute("data-cat") === state.cat));
        });
      }
      if (state.status !== "open") root.querySelector("#statusFilter").value = state.status;
      if (state.sort !== "soon") root.querySelector("#sortFilter").value = state.sort;
      search.value = state.q;

      function matches(activity) {
        if (state.cat !== "all" && activity.categoryId !== state.cat) return false;
        if (state.status !== "all" && DB.statusOf(activity).key !== state.status) return false;
        if (state.q) {
          var organizer = DB.userById(activity.organizerId) || {};
          var haystack = (activity.title + " " + activity.location + " " + activity.summary + " " + (organizer.name || "") + " " + (organizer.department || "")).toLowerCase();
          if (haystack.indexOf(state.q.toLowerCase()) === -1) return false;
        }
        return true;
      }

      function apply() {
        var list = approvedActivities().filter(matches);
        if (state.sort === "soon") {
          list.sort(function (a, b) {
            return a.startAt - b.startAt;
          });
        } else if (state.sort === "new") {
          list.sort(function (a, b) {
            return b.createdAt - a.createdAt;
          });
        } else {
          list.sort(function (a, b) {
            return DB.confirmedOf(b.id).length - DB.confirmedOf(a.id).length;
          });
        }

        count.textContent = "共 " + list.length + " 场活动";
        var tight = list.filter(function (activity) {
          return DB.seats(activity).percent >= 85 && DB.statusOf(activity).key === "open";
        }).length;
        hint.textContent = tight ? tight + " 场名额紧张" : "";

        if (!list.length) {
          grid.style.display = "block";
          grid.innerHTML =
            '<div class="card">' +
            UI.empty({
              icon: "magnifying-glass",
              title: "没有符合条件的活动",
              body: "试着换一个分类或状态，也可以清空搜索词重新看看。",
              action: '<button class="btn btn-secondary btn-sm button-sm" type="button" data-reset-filters>重置筛选条件</button>'
            }) +
            "</div>";
          var reset = grid.querySelector("[data-reset-filters]");
          if (reset)
            reset.addEventListener("click", function () {
              state = { q: "", cat: "all", status: "open", sort: "soon" };
              search.value = "";
              root.querySelector("#statusFilter").value = "open";
              root.querySelector("#sortFilter").value = "soon";
              root.querySelectorAll("[data-cat]").forEach(function (chip) {
                chip.setAttribute("aria-pressed", String(chip.getAttribute("data-cat") === "all"));
              });
              apply();
            });
          return;
        }

        grid.style.display = "grid";
        grid.innerHTML = list.map(function (activity) {
          return App.card(activity);
        }).join("");
      }

      search.addEventListener(
        "input",
        UI.debounce(function () {
          state.q = search.value.trim();
          apply();
        }, 160)
      );

      root.querySelector("#statusFilter").addEventListener("change", function (event) {
        state.status = event.target.value;
        apply();
      });

      root.querySelector("#sortFilter").addEventListener("change", function (event) {
        state.sort = event.target.value;
        apply();
      });

      root.querySelectorAll("[data-cat]").forEach(function (chip) {
        chip.addEventListener("click", function () {
          state.cat = chip.getAttribute("data-cat");
          root.querySelectorAll("[data-cat]").forEach(function (other) {
            other.setAttribute("aria-pressed", String(other === chip));
          });
          apply();
        });
      });

      apply();
    }
  };

  /* ------------------------------------------------------------------------
     Activity detail
     ------------------------------------------------------------------------ */

  Views.activity = {
    meta: function (ctx) {
      var activity = DB.activityById(ctx.params.id);
      return { title: activity ? activity.title : "活动详情", sub: activity ? DB.categoryById(activity.categoryId).name : "" };
    },

    render: function (ctx) {
      var activity = DB.activityById(ctx.params.id);
      if (!activity) {
        return '<div class="card">' + UI.empty({ icon: "warning-circle", title: "活动不存在", body: "它可能已被删除，或链接有误。", action: '<a class="btn btn-primary btn-sm button-sm" href="#/square">回到活动广场</a>' }) + "</div>";
      }
      var canSee = activity.review.status === "approved" || activity.organizerId === App.user.id || App.user.role === "admin";
      if (!canSee) {
        return '<div class="card">' + UI.empty({ icon: "lock", title: "活动尚未上架", body: "该活动还在审核中，通过后会出现在活动广场。", action: '<a class="btn btn-secondary btn-sm button-sm" href="#/square">回到活动广场</a>' }) + "</div>";
      }

      var status = DB.statusOf(activity);
      var category = DB.categoryById(activity.categoryId);
      var organizer = DB.userById(activity.organizerId) || {};
      var seat = DB.seats(activity);
      var mine = DB.myRegistration(activity.id, App.user.id);
      var owner = activity.organizerId === App.user.id || App.user.role === "admin";
      var isOpen = status.key === "open";
      var deskCls = seat.percent >= 100 ? "is-full" : seat.percent >= 85 ? "is-warm" : "";

      var right =
        '<aside class="signup-panel" aria-label="报名信息">' +
        '<div class="row" style="justify-content:space-between">' +
        '<span class="caption-4 muted">报名情况</span>' +
        UI.statusBadge(activity) +
        "</div>" +
        '<div class="signup-count"><b>' + seat.confirmed + "</b><span class=\"body-6 muted\">/ " + seat.capacity + " 人已报名</span></div>" +
        '<div class="progress progress-lg"><i class="' + deskCls + '" style="width:' + seat.percent + '%"></i></div>' +
        '<div class="row" style="justify-content:space-between">' +
        '<span class="caption-2 muted">剩余 ' + seat.left + " 个名额</span>" +
        (seat.waitlist ? '<span class="caption-2" style="color:var(--warn)">候补 ' + seat.waitlist + " 人</span>" : "") +
        "</div>" +
        (mine
          ? '<div class="ticket-code-card">' +
            '<span class="caption-4">我的签到码</span>' +
            '<span class="code">' + mine.code.replace(/(\d{3})(\d{3})/, "$1 $2") + "</span>" +
            '<span class="caption-5">' + (mine.status === "checked" ? "已于 " + UI.fmtDate(mine.checkedAt) + " 签到" : mine.status === "waitlist" ? "候补中，递补后会通知你" : "活动现场出示此码核销") + "</span>" +
            "</div>" +
            '<div class="row" style="gap:var(--space-75)">' +
            '<button class="btn btn-secondary btn-sm button-sm" type="button" data-action="copy-code" data-code="' + mine.code + '">' + App.icon("copy") + "复制</button>" +
            '<a class="btn btn-ghost btn-sm button-sm" href="#/mine">我的报名' + App.icon("arrow-right") + "</a>" +
            "</div>"
          : "") +
        (owner
          ? '<a class="btn btn-secondary btn-sm button-sm" href="#/manage/' + activity.id + '/roster">' + App.icon("users") + "查看报名名单</a>"
          : mine
            ? ""
            : isOpen
              ? '<button class="btn btn-primary btn-lg button-md btn-block" type="button" data-action="open-signup" data-id="' + activity.id + '">' +
                (seat.full ? "名额已满，加入候补" : "立即报名") +
                "</button>"
              : '<button class="btn btn-secondary btn-lg button-md btn-block" type="button" disabled>' +
                (status.key === "closed" ? "报名已截止" : status.key === "live" ? "活动进行中" : status.key === "pending" ? "等待审核" : "活动已结束") +
                "</button>") +
        (mine && status.key !== "ended" && mine.status !== "checked"
          ? '<button class="btn btn-ghost btn-sm button-sm" type="button" data-action="cancel-registration" data-id="' + mine.id + '" style="align-self:flex-start;color:var(--muted)">' + App.icon("x") + "取消报名</button>"
          : "") +
        '<hr class="divider">' +
        '<div class="stack" style="gap:var(--space-100)">' +
        '<div class="row" style="justify-content:space-between"><span class="caption-2 muted">报名截止</span><span class="caption-1">' + UI.fmtShort(activity.regDeadline) + " " + UI.fmtTime(activity.regDeadline) + "</span></div>" +
        '<div class="row" style="justify-content:space-between"><span class="caption-2 muted">面向对象</span><span class="caption-1">' + App.esc(activity.target) + "</span></div>" +
        '<div class="row" style="justify-content:space-between"><span class="caption-2 muted">活动编号</span><span class="caption-1 mono">' + activity.id.toUpperCase() + "</span></div>" +
        "</div>" +
        '<button class="btn btn-ghost btn-sm button-sm btn-block" type="button" data-action="share-activity" data-id="' + activity.id + '">' + App.icon("link") + "复制活动链接</button>" +
        "</aside>";

      var body = UI.lines(activity.description)
        .map(function (paragraph) {
          return '<p class="body-3">' + App.esc(paragraph) + "</p>";
        })
        .join("");

      var agenda = (activity.agenda || [])
        .map(function (item) {
          return (
            '<div class="timeline-item">' +
            '<span class="timeline-time caption-2 mono">' + App.esc(item.time) + "</span>" +
            '<span class="timeline-rail"><span class="timeline-dot"></span></span>' +
            '<span class="timeline-text body-5">' + App.esc(item.title) + "</span>" +
            "</div>"
          );
        })
        .join("");

      var notices = (activity.notice || [])
        .map(function (line) {
          return "<li>" + App.icon("check") + "<span>" + App.esc(line) + "</span></li>";
        })
        .join("");

      return (
        '<a class="back-link button-sm" href="#/square">' + App.icon("arrow-left") + "返回活动广场</a>" +
        '<div class="detail-grid">' +
        '<div class="detail-main">' +
        App.cover(activity, { large: true }) +
        '<section class="detail-panel">' +
        '<div class="detail-title-row">' +
        '<span class="badge badge-muted caption-4">' + App.icon(category.icon) + category.name + "</span>" +
        UI.statusBadge(activity) +
        (activity.featured ? '<span class="badge badge-accent caption-4">' + App.icon("star") + "推荐</span>" : "") +
        "</div>" +
        '<h1 class="heading-4">' + App.esc(activity.title) + "</h1>" +
        '<p class="body-3 muted">' + App.esc(activity.summary) + "</p>" +
        '<div class="meta-grid">' +
        '<div class="meta-block">' + App.icon("clock") + '<div class="meta-block-body"><span class="caption-4">活动时间</span><span class="caption-1">' + UI.fmtRange(activity.startAt, activity.endAt) + "</span></div></div>" +
        '<div class="meta-block">' + App.icon("map-pin") + '<div class="meta-block-body"><span class="caption-4">活动地点</span><span class="caption-1">' + App.esc(activity.location) + "</span></div></div>" +
        '<div class="meta-block">' + App.icon("users") + '<div class="meta-block-body"><span class="caption-4">面向对象</span><span class="caption-1">' + App.esc(activity.target) + "</span></div></div>" +
        '<div class="meta-block">' + App.icon("buildings") + '<div class="meta-block-body"><span class="caption-4">主办方</span><span class="caption-1">' + App.esc(organizer.department || "校团委") + " · " + App.esc(organizer.name || "") + "</span></div></div>" +
        "</div>" +
        '<div class="organizer-strip">' +
        '<span class="avatar">' + App.esc((organizer.name || "云").slice(0, 1)) + "</span>" +
        '<span class="stack"><span class="body-5">' + App.esc(organizer.name || "校团委") + "</span>" +
        '<span class="caption-5 muted">' + App.esc(organizer.title || "活动组织者") + " · " + App.esc(organizer.department || "") + "</span></span>" +
        "</div>" +
        "</section>" +
        '<section class="detail-panel"><h2 class="heading-6">活动介绍</h2><div class="body-copy">' + body + "</div></section>" +
        (agenda ? '<section class="detail-panel"><h2 class="heading-6">当天议程</h2><div class="timeline">' + agenda + "</div></section>" : "") +
        (notices ? '<section class="detail-panel"><h2 class="heading-6">报名须知</h2><ul class="notice-list">' + notices + "</ul></section>" : "") +
        "</div>" +
        right +
        "</div>"
      );
    }
  };

  /* ------------------------------------------------------------------------
     My registrations
     ------------------------------------------------------------------------ */

  var mineTabs = [
    { key: "all", label: "全部" },
    { key: "upcoming", label: "待参加" },
    { key: "checked", label: "已签到" },
    { key: "waitlist", label: "候补中" }
  ];

  function registrationRow(registration) {
    var activity = DB.activityById(registration.activityId);
    if (!activity) return "";
    var status = DB.statusOf(activity);
    var badge =
      registration.status === "checked"
        ? '<span class="badge badge-accent">' + App.icon("check-circle") + "已签到</span>"
        : registration.status === "waitlist"
          ? '<span class="badge badge-warn">' + App.icon("hourglass") + "候补中</span>"
          : '<span class="badge badge-info">' + App.icon("ticket") + "已报名</span>";
    var canCancel = registration.status !== "checked" && status.key !== "ended" && status.key !== "live";
    return (
      '<article class="reg-card">' +
      '<div class="reg-main">' +
      '<div class="reg-body">' +
      '<div class="row" style="gap:var(--space-75);flex-wrap:wrap">' +
      '<a class="title-3 reg-title" href="#/activity/' + activity.id + '">' + App.esc(activity.title) + "</a>" +
      badge +
      "</div>" +
      '<div class="reg-meta caption-2">' +
      '<span class="meta-line">' + App.icon("clock") + "<span>" + UI.fmtRange(activity.startAt, activity.endAt) + "</span></span>" +
      '<span class="meta-line">' + App.icon("map-pin") + "<span>" + App.esc(activity.location) + "</span></span>" +
      "</div>" +
      '<div class="reg-meta caption-5">' +
      "<span>报名时间 " + UI.fmtDate(registration.createdAt) + " " + UI.fmtTime(registration.createdAt) + "</span>" +
      (registration.checkedAt ? "<span>签到时间 " + UI.fmtDate(registration.checkedAt) + " " + UI.fmtTime(registration.checkedAt) + "</span>" : "") +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="reg-side">' +
      (registration.status === "waitlist"
        ? '<span class="caption-5 muted">递补后开放签到码</span>'
        : '<button class="code-chip mono button-sm" type="button" data-action="copy-code" data-code="' + registration.code + '" title="复制签到码">' + App.icon("copy") + registration.code.replace(/(\d{3})(\d{3})/, "$1 $2") + "</button>") +
      '<div class="row" style="gap:var(--space-50)">' +
      (canCancel ? '<button class="btn btn-ghost btn-sm button-sm" type="button" data-action="cancel-registration" data-id="' + registration.id + '">取消报名</button>' : "") +
      '<a class="btn btn-secondary btn-sm button-sm" href="#/activity/' + activity.id + '">详情</a>' +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  Views.mine = {
    meta: function () {
      var list = DB.myRegistrations(App.user.id);
      return { title: "我的报名", sub: "共 " + list.length + " 条有效报名记录" };
    },

    render: function () {
      var list = DB.myRegistrations(App.user.id);
      var counts = {
        all: list.length,
        upcoming: list.filter(function (registration) {
          var activity = DB.activityById(registration.activityId);
          return activity && registration.status === "confirmed" && activity.endAt > Date.now();
        }).length,
        checked: list.filter(function (registration) {
          return registration.status === "checked";
        }).length,
        waitlist: list.filter(function (registration) {
          return registration.status === "waitlist";
        }).length
      };

      return (
        '<div class="tabs" role="tablist">' +
        mineTabs
          .map(function (tab) {
            return (
              '<button class="tab button-sm" type="button" role="tab" data-tab="' +
              tab.key +
              '" aria-selected="' + (tab.key === "all") + '">' +
              tab.label +
              ' <span class="muted">' + counts[tab.key] + "</span></button>"
            );
          })
          .join("") +
        "</div>" +
        '<div class="list-stack" id="mineList"></div>'
      );
    },

    mount: function (root) {
      var listHost = root.querySelector("#mineList");
      var current = "all";

      function apply() {
        var list = DB.myRegistrations(App.user.id).filter(function (registration) {
          var activity = DB.activityById(registration.activityId);
          if (!activity) return false;
          if (current === "all") return true;
          if (current === "checked") return registration.status === "checked";
          if (current === "waitlist") return registration.status === "waitlist";
          return registration.status === "confirmed" && activity.endAt > Date.now();
        });

        if (!list.length) {
          listHost.innerHTML =
            '<div class="card">' +
            UI.empty({
              icon: "ticket",
              title: current === "all" ? "还没有报名记录" : "这个分类下暂时没有记录",
              body: "去活动广场挑一场感兴趣的活动，报名后签到码会出现在这里。",
              action: '<a class="btn btn-primary btn-sm button-sm" href="#/square">去活动广场</a>'
            }) +
            "</div>";
          return;
        }
        listHost.innerHTML = list.map(registrationRow).join("");
      }

      root.querySelectorAll("[data-tab]").forEach(function (tab) {
        tab.addEventListener("click", function () {
          current = tab.getAttribute("data-tab");
          root.querySelectorAll("[data-tab]").forEach(function (other) {
            other.setAttribute("aria-selected", String(other === tab));
          });
          apply();
        });
      });

      apply();
    }
  };

  /* ------------------------------------------------------------------------
     Notices
     ------------------------------------------------------------------------ */

  Views.notices = {
    meta: function () {
      return { title: "通知中心", sub: DB.unreadCount(App.user.id) + " 条未读" };
    },

    render: function () {
      var notices = DB.noticesFor(App.user.id);
      if (!notices.length) {
        return '<div class="card">' + UI.empty({ icon: "bell", title: "暂时没有通知", body: "报名成功、候补递补与审核结果都会推送到这里。" }) + "</div>";
      }

      return (
        '<div class="section-row">' +
        '<p class="caption-2 muted">全部通知 ' + notices.length + " 条</p>" +
        '<button class="btn btn-secondary btn-sm button-sm" type="button" data-action="mark-all-read">' + App.icon("check") + "全部标为已读</button>" +
        "</div>" +
        '<div class="list-stack">' +
        notices
          .map(function (notice) {
            var typeIcon = notice.type === "review" ? "shield-check" : notice.type === "reminder" ? "clock" : notice.type === "signup" ? "ticket" : "bell";
            return (
              '<article class="notice-card' + (notice.read ? "" : " is-unread") + '" data-notice="' + notice.id + '">' +
              '<span class="notice-icon">' + App.icon(typeIcon) + "</span>" +
              '<div class="notice-body">' +
              '<div class="row" style="gap:var(--space-75)">' +
              (notice.read ? "" : '<span class="unread-dot"></span>') +
              '<span class="title-3">' + App.esc(notice.title) + "</span>" +
              "</div>" +
              '<p class="body-6">' + App.esc(notice.body) + "</p>" +
              '<div class="notice-meta caption-5">' +
              "<span>" + UI.fmtDate(notice.createdAt) + " " + UI.fmtTime(notice.createdAt) + "</span>" +
              (notice.activityId ? '<a class="role-link" style="margin:0" href="#/activity/' + notice.activityId + '" data-notice-link>查看活动' + App.icon("arrow-right") + "</a>" : "") +
              "</div>" +
              "</div>" +
              "</article>"
            );
          })
          .join("") +
        "</div>"
      );
    },

    mount: function (root) {
      root.querySelectorAll("[data-notice]").forEach(function (card) {
        card.addEventListener("click", function (event) {
          if (event.target.closest("[data-notice-link]")) return;
          var noticeId = card.getAttribute("data-notice");
          if (!card.classList.contains("is-unread")) return;
          DB.markRead(noticeId);
          card.classList.remove("is-unread");
          var dot = card.querySelector(".unread-dot");
          if (dot) dot.remove();
        });
      });
    }
  };
})(window);
