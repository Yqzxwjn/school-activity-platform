/* ==========================================================================
   Administrator views: activity review, user accounts, statistics
   ========================================================================== */

(function (global) {
  "use strict";

  var DB = global.DB;
  var UI = global.UI;
  var Views = (global.Views = global.Views || {});
  var AppActions = (global.AppActions = global.AppActions || {});

  function conflictFor(activity) {
    return (
      DB.activities().filter(function (other) {
        return (
          other.id !== activity.id &&
          other.review.status === "approved" &&
          other.location === activity.location &&
          activity.startAt < other.endAt &&
          activity.endAt > other.startAt
        );
      })[0] || null
    );
  }

  /* ------------------------------------------------------------------------
     Review queue
     ------------------------------------------------------------------------ */

  function reviewCard(activity, mode) {
    var category = DB.categoryById(activity.categoryId);
    var organizer = DB.userById(activity.organizerId) || {};
    var clash = conflictFor(activity);
    var review = activity.review;
    var reviewer = review.by ? DB.userById(review.by) : null;

    return (
      '<article class="review-card">' +
      '<div class="review-main">' +
      '<div class="review-head">' +
      '<span class="badge badge-muted caption-4">' + App.icon(category.icon) + category.name + "</span>" +
      UI.statusBadge(activity) +
      '<span class="caption-5 muted mono">' + activity.id.toUpperCase() + "</span>" +
      "</div>" +
      '<a class="heading-6" href="#/activity/' + activity.id + '">' + App.esc(activity.title) + "</a>" +
      '<p class="body-6 muted">' + App.esc(activity.summary) + "</p>" +
      '<div class="review-meta caption-2">' +
      '<span class="meta-line">' + App.icon("clock") + "<span>" + UI.fmtRange(activity.startAt, activity.endAt) + "</span></span>" +
      '<span class="meta-line">' + App.icon("map-pin") + "<span>" + App.esc(activity.location) + "</span></span>" +
      '<span class="meta-line">' + App.icon("users") + "<span>名额 " + activity.capacity + " 人 · " + App.esc(activity.target) + "</span></span>" +
      '<span class="meta-line">' + App.icon("buildings") + "<span>" + App.esc(organizer.department || "") + " · " + App.esc(organizer.name || "") + "</span></span>" +
      '<span class="meta-line">' + App.icon("hourglass") + "<span>提交于 " + UI.relTime(review.at) + "</span></span>" +
      "</div>" +
      (clash
        ? '<div class="review-note caption-4">' + App.icon("warning-circle") + " 场地冲突：" + App.esc(clash.location) + " 同时段已有「" + App.esc(clash.title) + "」。</div>"
        : "") +
      (mode !== "pending" && review.by
        ? '<div class="review-note' + (review.status === "approved" ? " is-ok" : "") + ' caption-4">' +
          App.icon(review.status === "approved" ? "seal-check" : "info") +
          " " + (review.status === "approved" ? "已通过" : "已驳回") + " · " + App.esc(reviewer ? reviewer.name : "管理员") +
          " · " + UI.fmtDate(review.at) + " " + UI.fmtTime(review.at) +
          (review.reason ? " · 理由：" + App.esc(review.reason) : "") +
          "</div>"
        : "") +
      "</div>" +
      '<div class="review-actions">' +
      (mode === "pending"
        ? '<button class="btn btn-primary btn-sm button-sm" type="button" data-action="review-approve" data-id="' + activity.id + '">' + App.icon("check") + "通过并上架</button>" +
          '<button class="btn btn-secondary btn-sm button-sm" type="button" data-action="review-reject" data-id="' + activity.id + '">' + App.icon("x") + "驳回</button>"
        : '<a class="btn btn-ghost btn-sm button-sm" href="#/activity/' + activity.id + '">查看详情' + App.icon("arrow-right") + "</a>") +
      "</div>" +
      "</article>"
    );
  }

  function reviewList(mode) {
    var list;
    if (mode === "pending") {
      list = DB.activities().filter(function (activity) { return activity.review.status === "pending"; });
    } else if (mode === "approved") {
      list = DB.activities()
        .filter(function (activity) { return activity.review.status === "approved"; })
        .sort(function (a, b) { return b.review.at - a.review.at; })
        .slice(0, 8);
    } else {
      list = DB.activities().filter(function (activity) { return activity.review.status === "rejected"; });
    }
    return list;
  }

  Views.review = {
    meta: function () {
      var pending = reviewList("pending").length;
      return { title: "活动审核", sub: pending ? pending + " 场活动等待审核" : "当前没有待审核活动" };
    },

    render: function () {
      var counts = {
        pending: reviewList("pending").length,
        approved: DB.activities().filter(function (activity) { return activity.review.status === "approved"; }).length,
        rejected: reviewList("rejected").length
      };

      return (
        '<div class="page-head"><div class="page-head-text">' +
        '<span class="section-label caption-4">审核队列</span>' +
        '<h2 class="heading-5">核对时间、场地与名额</h2>' +
        '<p class="caption-2">通过后活动立即上架活动广场，驳回需要填写具体理由，组织者可修改后重新提交。</p>' +
        "</div></div>" +
        '<div class="tabs" role="tablist">' +
        '<button class="tab button-sm" type="button" role="tab" data-rtab="pending" aria-selected="true">待审核 <span class="muted">' + counts.pending + "</span></button>" +
        '<button class="tab button-sm" type="button" role="tab" data-rtab="approved" aria-selected="false">已通过 <span class="muted">' + counts.approved + "</span></button>" +
        '<button class="tab button-sm" type="button" role="tab" data-rtab="rejected" aria-selected="false">已驳回 <span class="muted">' + counts.rejected + "</span></button>" +
        "</div>" +
        '<div class="list-stack" id="reviewList"></div>'
      );
    },

    mount: function (root) {
      var host = root.querySelector("#reviewList");
      var current = "pending";

      function apply() {
        var list = reviewList(current);
        if (!list.length) {
          host.innerHTML = '<div class="card">' + UI.empty({
            icon: current === "pending" ? "seal-check" : "list-checks",
            title: current === "pending" ? "审核队列已清空" : "这里还没有记录",
            body: current === "pending" ? "组织者提交新活动后会出现在这里。" : "通过或驳回的活动会留下审核记录。"
          }) + "</div>";
          return;
        }
        host.innerHTML = list
          .map(function (activity) {
            return reviewCard(activity, current);
          })
          .join("");
      }

      root.querySelectorAll("[data-rtab]").forEach(function (tab) {
        tab.addEventListener("click", function () {
          current = tab.getAttribute("data-rtab");
          root.querySelectorAll("[data-rtab]").forEach(function (other) {
            other.setAttribute("aria-selected", String(other === tab));
          });
          apply();
        });
      });

      apply();
    }
  };

  /* ------------------------------------------------------------------------
     Users
     ------------------------------------------------------------------------ */

  function userRow(user) {
    var disabled = user.status === "disabled";
    var self = user.id === App.user.id;
    return (
      "<tr>" +
      '<td><div class="row" style="gap:var(--space-100)">' +
      '<span class="avatar">' + App.esc(user.name.slice(0, 1)) + "</span>" +
      '<span class="stack" style="gap:var(--space-25)"><span class="table-title body-5">' + App.esc(user.name) + (self ? ' <span class="caption-5 muted">本人</span>' : "") + "</span>" +
      '<span class="table-sub caption-5 mono">' + App.esc(user.account) + "</span></span>" +
      "</div></td>" +
      '<td><span class="badge ' + (user.role === "admin" ? "badge-info" : user.role === "organizer" ? "badge-accent" : "badge-muted") + ' caption-4">' + App.roleLabel(user.role) + "</span></td>" +
      '<td class="caption-2">' + App.esc(user.className || user.department || "未填写") + "</td>" +
      '<td class="caption-2 mono">' + App.esc(user.phone || "未填写") + "</td>" +
      "<td>" + (disabled ? '<span class="badge badge-danger caption-4">已停用</span>' : '<span class="badge badge-accent caption-4">正常</span>') + "</td>" +
      '<td class="caption-2">' + UI.fmtShort(user.joinedAt) + "</td>" +
      '<td><div class="cell-actions">' +
      '<button class="btn btn-ghost btn-sm button-sm" type="button" data-action="open-reset-password" data-id="' + user.id + '">重置密码</button>' +
      '<button class="btn ' + (disabled ? "btn-secondary" : "btn-ghost") + ' btn-sm button-sm" type="button" data-action="toggle-user" data-id="' + user.id + '"' + (self ? " disabled" : "") + ">" +
      (disabled ? "启用" : "停用") +
      "</button></div></td>" +
      "</tr>"
    );
  }

  Views.users = {
    meta: function () {
      var users = DB.users();
      return {
        title: "用户管理",
        sub: users.length + " 个账号 · " + users.filter(function (user) { return user.status === "disabled"; }).length + " 个已停用"
      };
    },

    render: function () {
      var users = DB.users();
      var counts = {
        all: users.length,
        student: users.filter(function (user) { return user.role === "student"; }).length,
        organizer: users.filter(function (user) { return user.role === "organizer"; }).length,
        admin: users.filter(function (user) { return user.role === "admin"; }).length
      };

      return (
        '<div class="page-head"><div class="page-head-text">' +
        '<span class="section-label caption-4">账号目录</span>' +
        '<h2 class="heading-5">学校统一创建的账号</h2>' +
        '<p class="caption-2">学生与教师账号由管理员创建，停用后无法登录，历史报名记录会保留。</p>' +
        "</div>" +
        '<div class="page-actions"><button class="btn btn-primary btn-sm button-sm" type="button" data-action="open-create-user">' +
        App.icon("plus") +
        "新建账号</button></div></div>" +
        '<div class="kpi-grid">' +
        '<div class="kpi"><span class="kpi-label caption-4">' + App.icon("users") + '账号总数</span><span class="kpi-value">' + counts.all + "</span></div>" +
        '<div class="kpi"><span class="kpi-label caption-4">' + App.icon("student") + '学生账号</span><span class="kpi-value">' + counts.student + "</span></div>" +
        '<div class="kpi"><span class="kpi-label caption-4">' + App.icon("chalkboard") + '组织者</span><span class="kpi-value">' + counts.organizer + "</span></div>" +
        '<div class="kpi"><span class="kpi-label caption-4">' + App.icon("shield-check") + '管理员</span><span class="kpi-value">' + counts.admin + "</span></div>" +
        "</div>" +
        '<div class="table-wrap">' +
        '<div class="table-toolbar">' +
        '<label class="search-field" style="max-width:280px">' + App.icon("magnifying-glass") +
        '<input type="search" id="userSearch" placeholder="搜索姓名、账号或班级"></label>' +
        '<div class="filter-chips" role="group" aria-label="角色筛选">' +
        '<button class="chip is-active button-sm" type="button" data-ufilter="all">全部</button>' +
        '<button class="chip button-sm" type="button" data-ufilter="student">学生</button>' +
        '<button class="chip button-sm" type="button" data-ufilter="organizer">组织者</button>' +
        '<button class="chip button-sm" type="button" data-ufilter="admin">管理员</button>' +
        "</div>" +
        '<span class="caption-5 muted" style="margin-left:auto" id="userCount"></span>' +
        "</div>" +
        '<div class="table-scroll"><table class="data"><thead><tr><th>姓名 / 账号</th><th>角色</th><th>班级或部门</th><th>联系方式</th><th>状态</th><th>加入时间</th><th></th></tr></thead>' +
        '<tbody id="userBody"></tbody></table></div>' +
        "</div>"
      );
    },

    mount: function (root) {
      var body = root.querySelector("#userBody");
      var countEl = root.querySelector("#userCount");
      var search = root.querySelector("#userSearch");
      var filter = "all";

      function apply() {
        var query = search.value.trim().toLowerCase();
        var list = DB.users()
          .filter(function (user) {
            if (filter !== "all" && user.role !== filter) return false;
            if (!query) return true;
            return (user.name + " " + user.account + " " + (user.className || "") + " " + (user.department || "")).toLowerCase().indexOf(query) !== -1;
          })
          .sort(function (a, b) {
            var order = { admin: 0, organizer: 1, student: 2 };
            return order[a.role] - order[b.role] || a.name.localeCompare(b.name, "zh-CN");
          });

        countEl.textContent = "共 " + list.length + " 个账号";
        if (!list.length) {
          body.innerHTML = '<tr><td colspan="7"><div class="empty" style="padding:var(--space-600)">' +
            '<span class="empty-mark">' + App.icon("users") + "</span>" +
            '<p class="title-2">没有匹配的账号</p></div></td></tr>';
          return;
        }
        body.innerHTML = list.map(userRow).join("");
      }

      search.addEventListener("input", UI.debounce(apply, 150));

      root.querySelectorAll("[data-ufilter]").forEach(function (chip) {
        chip.addEventListener("click", function () {
          filter = chip.getAttribute("data-ufilter");
          root.querySelectorAll("[data-ufilter]").forEach(function (other) {
            other.classList.toggle("is-active", other === chip);
          });
          apply();
        });
      });

      apply();
    }
  };

  /* ------------------------------------------------------------------------
     Statistics
     ------------------------------------------------------------------------ */

  function statsCsv(stats) {
    var rows = [["指标", "数值"]];
    rows.push(["活动总数", stats.activities]);
    rows.push(["报名人次", stats.registrations]);
    rows.push(["已签到人次", stats.checked]);
    rows.push(["平均签到率", stats.checkinRate + "%"]);
    rows.push(["候补人次", stats.waitlist]);
    rows.push([]);
    rows.push(["月份", "报名人次"]);
    stats.months.forEach(function (month) {
      rows.push([month.label, month.value]);
    });
    rows.push([]);
    rows.push(["分类", "活动数", "报名人次"]);
    stats.byCategory.forEach(function (category) {
      rows.push([category.name, category.activities, category.registrations]);
    });
    rows.push([]);
    rows.push(["年级", "报名人次"]);
    stats.byGrade.forEach(function (grade) {
      rows.push([grade.name, grade.value]);
    });
    return rows
      .map(function (row) {
        return row
          .map(function (cell) {
            return '"' + String(cell === undefined ? "" : cell).replace(/"/g, '""') + '"';
          })
          .join(",");
      })
      .join("\r\n");
  }

  Views.stats = {
    meta: function () {
      return { title: "数据统计", sub: "全校活动、报名与签到情况" };
    },

    render: function () {
      var stats = DB.stats();
      return (
        '<div class="page-head"><div class="page-head-text">' +
        '<span class="section-label caption-4">数据看板</span>' +
        '<h2 class="heading-5">本学期活动运行情况</h2>' +
        '<p class="caption-2">报名数据来自已上架活动，签到率按已结束活动的正式报名计算。</p>' +
        "</div>" +
        '<div class="page-actions"><button class="btn btn-secondary btn-sm button-sm" type="button" data-action="export-stats">' + App.icon("download-simple") + "导出统计</button></div>" +
        "</div>" +
        '<div class="kpi-grid">' +
        '<div class="kpi"><span class="kpi-label caption-4">' + App.icon("calendar-check") + "已上架活动</span>" +
        '<span class="kpi-value">' + stats.activities + ' <small>场</small></span>' +
        '<span class="kpi-delta caption-5">' + App.icon("trend-up") + "其中 " + stats.liveActivities + " 场可参与</span></div>" +
        '<div class="kpi"><span class="kpi-label caption-4">' + App.icon("users") + "报名人次</span>" +
        '<span class="kpi-value">' + stats.registrations + ' <small>人次</small></span>' +
        '<span class="kpi-delta caption-5">候补 ' + stats.waitlist + " 人次</span></div>" +
        '<div class="kpi"><span class="kpi-label caption-4">' + App.icon("check-circle") + "平均签到率</span>" +
        '<span class="kpi-value">' + stats.checkinRate + ' <small>%</small></span>' +
        '<span class="kpi-delta caption-5">已签到 ' + stats.checked + " 人次</span></div>" +
        '<div class="kpi"><span class="kpi-label caption-4">' + App.icon("shield-check") + "待审核</span>" +
        '<span class="kpi-value">' + stats.pending + ' <small>场</small></span>' +
        '<span class="kpi-delta caption-5">' + (stats.pending ? "需要尽快处理" : "队列已清空") + "</span></div>" +
        "</div>" +
        '<div class="chart-grid">' +
        '<section class="chart-card">' +
        '<div class="chart-head"><div><h3 class="title-2">报名趋势</h3><p class="caption-5">近 6 个月报名人次</p></div>' +
        '<span class="badge badge-muted caption-4">按月</span></div>' +
        '<div class="chart-canvas">' + Charts.line(stats.months, { label: "近 6 个月报名人次趋势" }) + "</div>" +
        "</section>" +
        '<section class="chart-card">' +
        '<div class="chart-head"><div><h3 class="title-2">年级分布</h3><p class="caption-5">报名人次的年级归属</p></div></div>' +
        Charts.donut(stats.byGrade, { label: "报名人次年级分布" }) +
        "</section>" +
        "</div>" +
        '<div class="chart-grid">' +
        '<section class="chart-card">' +
        '<div class="chart-head"><div><h3 class="title-2">分类报名对比</h3><p class="caption-5">按活动分类统计报名人次</p></div></div>' +
        Charts.bars(
          stats.byCategory.map(function (category) {
            return { name: category.name, value: category.registrations };
          })
        ) +
        "</section>" +
        '<section class="chart-card">' +
        '<div class="chart-head"><div><h3 class="title-2">热门活动</h3><p class="caption-5">按报名人数排序</p></div></div>' +
        '<div class="rank-list">' +
        stats.top
          .map(function (item, index) {
            return (
              '<div class="rank-item">' +
              '<span class="rank-index">' + (index + 1 < 10 ? "0" + (index + 1) : index + 1) + "</span>" +
              '<div class="rank-body"><span class="rank-title body-5">' + App.esc(item.title) + "</span>" +
              '<span class="rank-meta caption-5"><span>报名 ' + item.registrations + " 人</span><span>" + (item.ended ? "签到率 " + item.checkin + "%" : "尚未开始") + "</span></span></div>" +
              '<a class="btn btn-ghost btn-sm button-sm" href="#/manage/' + item.id + '/roster">名单</a>' +
              "</div>"
            );
          })
          .join("") +
        "</div></section>" +
        "</div>"
      );
    }
  };

  /* ------------------------------------------------------------------------
     Admin actions
     ------------------------------------------------------------------------ */

  AppActions["review-approve"] = function (el) {
    var activity = DB.activityById(el.getAttribute("data-id"));
    if (!activity) return;
    var clash = conflictFor(activity);
    UI.confirm({
      title: "通过审核",
      subtitle: activity.title,
      body: clash
        ? "注意：该场地在此时段已有「" + clash.title + "」，确认仍要通过吗？通过后活动会立即上架。"
        : "通过后活动会立即出现在活动广场，师生可以开始报名。",
      confirmText: "通过并上架"
    }).then(function (ok) {
      if (!ok) return;
      DB.reviewActivity(activity.id, "approved", "")
        .then(function () {
          UI.toast("已通过审核并上架");
          App.refresh();
        })
        .catch(function (error) {
          UI.toast(error.message, { tone: "warn" });
        });
    });
  };

  AppActions["review-reject"] = function (el) {
    var activity = DB.activityById(el.getAttribute("data-id"));
    if (!activity) return;
    UI.sheet({
      title: "驳回活动",
      subtitle: activity.title,
      body:
        '<label class="field"><span class="field-label caption-1">驳回理由</span>' +
        '<textarea class="textarea" id="rejectReason" rows="4" placeholder="请说明需要修改的内容，例如场地冲突、信息不完整、时间安排不合理"></textarea>' +
        '<span class="field-hint caption-5">理由会随通知发送给组织者，便于修改后重新提交。</span></label>' +
        '<p class="field-error caption-4" id="rejectError" hidden></p>',
      actions: [
        { label: "取消", variant: "secondary" },
        {
          label: "确认驳回",
          variant: "danger",
          onClick: function (sheetEl, close) {
            var area = sheetEl.querySelector("#rejectReason");
            var reason = area.value.trim();
            var error = sheetEl.querySelector("#rejectError");
            if (reason.length < 6) {
              error.textContent = "请填写至少 6 个字的驳回理由，方便组织者修改。";
              error.hidden = false;
              area.focus();
              return false;
            }
            DB.reviewActivity(activity.id, "rejected", reason)
              .then(function () {
                close();
                UI.toast("已驳回，理由已发送给组织者");
                App.refresh();
              })
              .catch(function (requestError) {
                error.textContent = requestError.message;
                error.hidden = false;
              });
            return false;
          }
        }
      ]
    });
  };

  AppActions["toggle-user"] = function (el) {
    var user = DB.userById(el.getAttribute("data-id"));
    if (!user) return;
    if (user.id === App.user.id) {
      UI.toast("不能停用当前登录的账号。", { tone: "warn" });
      return;
    }
    var disabling = user.status !== "disabled";
    UI.confirm({
      title: disabling ? "停用账号" : "启用账号",
      body: disabling ? "停用后 " + user.name + " 将无法登录平台，已有报名记录会保留。" : "启用后 " + user.name + " 可以重新登录平台。",
      confirmText: disabling ? "停用" : "启用",
      danger: disabling
    }).then(function (ok) {
      if (!ok) return;
      DB.updateUser(user.id, { status: disabling ? "disabled" : "active" })
        .then(function () {
          UI.toast(user.name + (disabling ? " 的账号已停用" : " 的账号已启用"));
          App.refresh();
        })
        .catch(function (error) {
          UI.toast(error.message, { tone: "warn" });
        });
    });
  };

  AppActions["open-create-user"] = function () {
    UI.sheet({
      title: "新建账号",
      subtitle: "账号创建后即可使用初始密码登录",
      body:
        '<form id="createUserForm" class="stack" style="gap:var(--space-200)" novalidate>' +
        '<div class="form-grid">' +
        '<label class="field"><span class="field-label caption-1">姓名</span><input class="input" name="name" required></label>' +
        '<label class="field"><span class="field-label caption-1">账号</span><input class="input" name="account" placeholder="学号或工号" required></label>' +
        '<label class="field"><span class="field-label caption-1">角色</span>' +
        '<select class="select" name="role"><option value="student">学生</option><option value="organizer">活动组织者</option><option value="admin">管理员</option></select></label>' +
        '<label class="field"><span class="field-label caption-1">班级或部门</span><input class="input" name="className" placeholder="如 高二(3)班 / 校团委"></label>' +
        "</div>" +
        '<label class="field"><span class="field-label caption-1">初始密码</span>' +
        '<input class="input" type="text" name="password" minlength="8" required>' +
        '<span class="field-hint caption-5">至少 8 位，创建后请提醒本人登录后修改。</span></label>' +
        '<p class="field-error caption-4" data-form-error hidden></p>' +
        "</form>",
      actions: [
        { label: "取消", variant: "secondary" },
        {
          label: "创建账号",
          variant: "primary",
          onClick: function (sheetEl, close) {
            var form = sheetEl.querySelector("#createUserForm");
            var errorEl = form.querySelector("[data-form-error]");
            var payload = {
              name: form.name.value.trim(),
              account: form.account.value.trim(),
              role: form.role.value,
              className: form.className.value.trim(),
              password: form.password.value
            };
            DB.createUser(payload)
              .then(function (user) {
                close();
                UI.toast("已创建账号 " + user.name + "（" + user.account + "）");
                App.refresh();
              })
              .catch(function (error) {
                errorEl.textContent = error.message;
                errorEl.hidden = false;
              });
            return false;
          }
        }
      ]
    });
  };

  AppActions["open-reset-password"] = function (el) {
    var user = DB.userById(el.getAttribute("data-id"));
    if (!user) return;
    UI.sheet({
      title: "重置密码",
      subtitle: user.name + " · " + user.account,
      body:
        '<form id="resetPasswordForm" class="stack" style="gap:var(--space-200)" novalidate>' +
        '<label class="field"><span class="field-label caption-1">新密码</span>' +
        '<input class="input" type="text" name="password" minlength="8" required>' +
        '<span class="field-hint caption-5">至少 8 位，重置后该账号的登录状态会失效。</span></label>' +
        '<p class="field-error caption-4" data-form-error hidden></p>' +
        "</form>",
      actions: [
        { label: "取消", variant: "secondary" },
        {
          label: "确认重置",
          variant: "primary",
          onClick: function (sheetEl, close) {
            var form = sheetEl.querySelector("#resetPasswordForm");
            var errorEl = form.querySelector("[data-form-error]");
            DB.resetPassword(user.id, form.password.value)
              .then(function () {
                close();
                UI.toast("已重置 " + user.name + " 的密码");
              })
              .catch(function (error) {
                errorEl.textContent = error.message;
                errorEl.hidden = false;
              });
            return false;
          }
        }
      ]
    });
  };

  AppActions["export-stats"] = function () {
    UI.download("云溪中学 活动统计.csv", statsCsv(DB.stats()));
    UI.toast("统计结果已导出");
  };
})(window);
