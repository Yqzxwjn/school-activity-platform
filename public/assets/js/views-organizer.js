/* ==========================================================================
   Organizer views: activity management, publish form, roster, check-in
   ========================================================================== */

(function (global) {
  "use strict";

  var DB = global.DB;
  var UI = global.UI;
  var Views = (global.Views = global.Views || {});
  var AppActions = (global.AppActions = global.AppActions || {});

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function toLocalInput(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function defaultStart() {
    var d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(15, 0, 0, 0);
    return d.getTime();
  }

  function ownedActivities() {
    return DB.activities()
      .filter(function (activity) {
        return App.user.role === "admin" || activity.organizerId === App.user.id;
      })
      .sort(function (a, b) {
        return b.updatedAt - a.updatedAt;
      });
  }

  /* ------------------------------------------------------------------------
     Manage list
     ------------------------------------------------------------------------ */

  var manageTabs = [
    { key: "all", label: "全部" },
    { key: "open", label: "报名中" },
    { key: "pending", label: "待审核" },
    { key: "rejected", label: "已驳回" },
    { key: "ended", label: "已结束" }
  ];

  function manageRow(activity) {
    var status = DB.statusOf(activity);
    var seat = DB.seats(activity);
    var category = DB.categoryById(activity.categoryId);
    var canCheckin = status.key !== "pending" && status.key !== "rejected" && status.key !== "draft";
    var canEdit = activity.review.status !== "pending";
    return (
      "<tr>" +
      '<td><div class="stack" style="gap:var(--space-25)">' +
      '<a class="table-title body-5" href="#/activity/' + activity.id + '">' + App.esc(activity.title) + "</a>" +
      '<span class="table-sub caption-5">' + App.icon(category.icon) + " " + category.name + " · " + activity.id.toUpperCase() + "</span>" +
      "</div></td>" +
      "<td>" + UI.statusBadge(activity) + "</td>" +
      '<td><div class="stack" style="gap:var(--space-25)"><span class="caption-2">' + UI.fmtShort(activity.startAt) + " " + UI.fmtTime(activity.startAt) + "</span>" +
      '<span class="table-sub caption-5">' + App.esc(activity.location) + "</span></div></td>" +
      '<td><div class="seat-meter" style="min-width:120px">' + App.seatMarkup(activity) + "</div></td>" +
      '<td class="mono caption-2">' + (seat.waitlist || "0") + "</td>" +
      "<td>" +
      '<div class="cell-actions">' +
      '<a class="btn btn-ghost btn-sm button-sm" href="#/manage/' + activity.id + '/roster">名单</a>' +
      (canCheckin ? '<a class="btn btn-ghost btn-sm button-sm" href="#/checkin?id=' + activity.id + '">核销</a>' : "") +
      (canEdit ? '<a class="btn btn-secondary btn-sm button-sm" href="#/manage/' + activity.id + '/edit">编辑</a>' : "") +
      (activity.review.status === "draft" || activity.review.status === "rejected"
        ? '<button class="btn btn-primary btn-sm button-sm" type="button" data-action="submit-review" data-id="' + activity.id + '">提交审核</button>'
        : "") +
      "</div></td>" +
      "</tr>"
    );
  }

  Views.manage = {
    meta: function () {
      return { title: "我的活动", sub: "共 " + ownedActivities().length + " 场活动" };
    },

    render: function () {
      var list = ownedActivities();
      var totalRegs = 0;
      var pending = 0;
      var open = 0;
      list.forEach(function (activity) {
        totalRegs += DB.confirmedOf(activity.id).length;
        if (activity.review.status === "pending") pending += 1;
        if (DB.statusOf(activity).key === "open") open += 1;
      });

      return (
        '<div class="page-head">' +
        '<div class="page-head-text">' +
        '<span class="section-label caption-4">组织者工作台</span>' +
        '<h2 class="heading-5">发布、名单与核销</h2>' +
        '<p class="caption-2">这里只显示由你发布的活动。' + (App.user.role === "admin" ? "管理员可以看到全校活动。" : "") + "</p>" +
        "</div>" +
        '<div class="page-actions"><a class="btn btn-primary btn-sm button-sm" href="#/manage/new">' + App.icon("plus") + "发布活动</a></div>" +
        "</div>" +
        '<div class="kpi-grid">' +
        '<div class="kpi"><span class="kpi-label caption-4">' + App.icon("calendar-check") + "累计活动</span>" +
        '<span class="kpi-value">' + list.length + "</span></div>" +
        '<div class="kpi"><span class="kpi-label caption-4">' + App.icon("clock") + "正在报名</span>" +
        '<span class="kpi-value">' + open + "</span></div>" +
        '<div class="kpi"><span class="kpi-label caption-4">' + App.icon("users") + "累计报名</span>" +
        '<span class="kpi-value">' + totalRegs + "</span></div>" +
        '<div class="kpi"><span class="kpi-label caption-4">' + App.icon("shield-check") + "待审核</span>" +
        '<span class="kpi-value">' + pending + "</span></div>" +
        "</div>" +
        '<div class="tabs" role="tablist">' +
        manageTabs
          .map(function (tab) {
            return '<button class="tab button-sm" type="button" role="tab" data-mtab="' + tab.key + '" aria-selected="' + (tab.key === "all") + '">' + tab.label + "</button>";
          })
          .join("") +
        "</div>" +
        '<div class="table-wrap"><div class="table-scroll"><table class="data" id="manageTable">' +
        "<thead><tr><th>活动</th><th>状态</th><th>时间与地点</th><th>报名情况</th><th>候补</th><th></th></tr></thead>" +
        '<tbody id="manageBody"></tbody></table></div></div>'
      );
    },

    mount: function (root) {
      var body = root.querySelector("#manageBody");
      var current = "all";

      function apply() {
        var list = ownedActivities().filter(function (activity) {
          if (current === "all") return true;
          return DB.statusOf(activity).key === current;
        });
        if (!list.length) {
          body.innerHTML =
            '<tr><td colspan="6"><div class="empty" style="padding:var(--space-700) var(--space-300)">' +
            '<span class="empty-mark">' + App.icon("calendar-blank") + "</span>" +
            '<p class="title-2">这里还没有活动</p>' +
            '<p class="body-6 muted">发布第一场活动，提交审核通过后就会出现在活动广场。</p>' +
            '<a class="btn btn-primary btn-sm button-sm" href="#/manage/new">发布活动</a>' +
            "</div></td></tr>";
          return;
        }
        body.innerHTML = list.map(manageRow).join("");
      }

      root.querySelectorAll("[data-mtab]").forEach(function (tab) {
        tab.addEventListener("click", function () {
          current = tab.getAttribute("data-mtab");
          root.querySelectorAll("[data-mtab]").forEach(function (other) {
            other.setAttribute("aria-selected", String(other === tab));
          });
          apply();
        });
      });

      apply();
    }
  };

  /* ------------------------------------------------------------------------
     Publish / edit form
     ------------------------------------------------------------------------ */

  function renderAgendaRow(item) {
    return (
      '<div class="agenda-row" data-agenda-row>' +
      '<input class="input mono" type="time" data-agenda-time value="' + App.esc(item.time || "09:00") + '" aria-label="议程时间">' +
      '<input class="input" type="text" data-agenda-title value="' + App.esc(item.title || "") + '" placeholder="如 签到与开场" aria-label="议程内容">' +
      '<button class="icon-btn" type="button" data-action="remove-agenda" aria-label="删除这一行">' + App.icon("trash") + "</button>" +
      "</div>"
    );
  }

  function renderPublishForm(activity) {
    var categories = DB.categories();
    var start = activity ? activity.startAt : defaultStart();
    var end = activity ? activity.endAt : start + 2 * 3600000;
    var deadline = activity ? activity.regDeadline : start - 24 * 3600000;
    var agenda = (activity && activity.agenda) || [
      { time: "15:00", title: "签到与开场" },
      { time: "15:30", title: "活动主体环节" },
      { time: "16:50", title: "总结与合影" }
    ];
    var notices = (activity && activity.notice) || ["请提前十分钟到达活动地点。", "如需取消报名，请在报名截止前操作。"];
    var editing = Boolean(activity);
    var reReview = editing && activity.review.status === "approved";

    return (
      '<div class="page-head">' +
      '<div class="page-head-text">' +
      '<a class="back-link button-sm" href="#/manage">' + App.icon("arrow-left") + "返回我的活动</a>" +
      '<h2 class="heading-5">' + (editing ? "编辑活动" : "发布新活动") + "</h2>" +
      '<p class="caption-2">提交后由德育处审核，通过后自动上架活动广场。</p>' +
      "</div></div>" +
      '<form class="form-layout" id="activityForm" novalidate>' +
      '<div class="form-card">' +
      '<section class="form-section">' +
      '<div class="form-section-head"><h3 class="title-1">基本信息</h3><p class="caption-2 muted">活动广场里展示的名称、分类与简介。</p></div>' +
      '<label class="field"><span class="field-label caption-1">活动名称</span>' +
      '<input class="input" name="title" maxlength="40" value="' + App.esc(activity ? activity.title : "") + '" placeholder="如 秋季运动会志愿者招募" required>' +
      '<span class="field-hint caption-5">建议 8 到 20 个字，包含活动类型与时间特征。</span></label>' +
      '<div class="field"><span class="field-label caption-1">活动分类</span>' +
      '<div class="category-picker" role="group" aria-label="活动分类">' +
      categories
        .map(function (category) {
          var checked = activity ? activity.categoryId === category.id : category.id === "club";
          return (
            '<button class="category-option button-sm" type="button" data-category="' + category.id + '" aria-pressed="' + checked + '">' +
            App.icon(category.icon) + category.name + "</button>"
          );
        })
        .join("") +
      "</div></div>" +
      '<label class="field"><span class="field-label caption-1">一句话简介</span>' +
      '<input class="input" name="summary" maxlength="60" value="' + App.esc(activity ? activity.summary : "") + '" placeholder="用一句话说明活动内容和收获">' +
      '<span class="field-hint caption-5">会显示在活动卡片上，最多 60 个字。</span></label>' +
      '<label class="field"><span class="field-label caption-1">活动详情</span>' +
      '<textarea class="textarea" name="description" rows="5" placeholder="活动背景、流程安排、参与要求等，可分段落填写">' + App.esc(activity ? activity.description : "") + "</textarea></label>" +
      "</section>" +
      '<section class="form-section">' +
      '<div class="form-section-head"><h3 class="title-1">时间与名额</h3><p class="caption-2 muted">报名截止时间需要早于活动开始时间。</p></div>' +
      '<div class="form-grid">' +
      '<label class="field"><span class="field-label caption-1">活动开始</span>' +
      '<input class="input" type="datetime-local" name="startAt" value="' + toLocalInput(start) + '" required></label>' +
      '<label class="field"><span class="field-label caption-1">活动结束</span>' +
      '<input class="input" type="datetime-local" name="endAt" value="' + toLocalInput(end) + '" required></label>' +
      '<label class="field"><span class="field-label caption-1">报名截止</span>' +
      '<input class="input" type="datetime-local" name="regDeadline" value="' + toLocalInput(deadline) + '" required></label>' +
      '<label class="field"><span class="field-label caption-1">名额上限</span>' +
      '<input class="input" type="number" name="capacity" min="1" max="999" value="' + (activity ? activity.capacity : 60) + '" required></label>' +
      '<label class="field"><span class="field-label caption-1">活动地点</span>' +
      '<input class="input" name="location" value="' + App.esc(activity ? activity.location : "") + '" placeholder="如 图书馆报告厅" required></label>' +
      '<label class="field"><span class="field-label caption-1">面向对象</span>' +
      '<input class="input" name="target" value="' + App.esc(activity ? activity.target : "全校师生") + '" placeholder="如 高一、高二学生"></label>' +
      "</div></section>" +
      '<section class="form-section">' +
      '<div class="form-section-head"><h3 class="title-1">议程与须知</h3><p class="caption-2 muted">议程会以时间线展示，须知会作为列表出现在详情页。</p></div>' +
      '<div class="field"><span class="field-label caption-1">当天议程</span>' +
      '<div class="agenda-editor" id="agendaEditor">' + agenda.map(renderAgendaRow).join("") + "</div>" +
      '<button class="btn btn-secondary btn-sm button-sm" type="button" data-action="add-agenda" style="align-self:flex-start">' + App.icon("plus") + "添加一行议程</button></div>" +
      '<label class="field"><span class="field-label caption-1">报名须知</span>' +
      '<textarea class="textarea" name="notice" rows="3" placeholder="每行一条，如：请穿运动鞋，现场发放志愿者马甲。">' + App.esc(notices.join("\n")) + "</textarea>" +
      '<span class="field-hint caption-5">每行一条，最多展示 5 条。</span></label>' +
      "</section>" +
      '<p class="field-error caption-4" id="formError" hidden></p>' +
      '<div class="form-foot">' +
      '<span class="caption-2 muted">' + (editing ? "修改后会重新进入审核队列。" : "保存草稿后可以稍后继续编辑。") + "</span>" +
      '<div class="form-foot-actions">' +
      '<a class="btn btn-ghost btn-sm button-sm" href="#/manage">取消</a>' +
      (reReview
        ? ""
        : '<button class="btn btn-secondary btn-sm button-sm" type="button" data-action="save-activity" data-mode="draft">保存草稿</button>') +
      '<button class="btn btn-primary btn-sm button-sm" type="button" data-action="save-activity" data-mode="submit">' +
      (reReview ? "保存并重新提交" : "提交审核") +
      "</button>" +
      "</div></div>" +
      "</div>" +
      '<aside class="stack" style="gap:var(--space-100)">' +
      '<div class="side-note">' +
      '<h3 class="title-2">发布检查</h3>' +
      '<div class="summary-list" id="publishSummary"></div>' +
      '<div id="conflictNote"></div>' +
      "</div>" +
      '<div class="side-note">' +
      '<h3 class="title-2">审核流程</h3>' +
      '<ol class="caption-2">' +
      "<li>填写活动信息，确认时间与场地没有冲突。</li>" +
      "<li>提交后进入德育处审核队列，通常一个工作日内处理。</li>" +
      "<li>通过后自动上架，师生可在活动广场报名。</li>" +
      "<li>驳回会附上理由，修改后可再次提交。</li>" +
      "</ol></div>" +
      "</aside>" +
      "</form>"
    );
  }

  function bindPublish(root, activity) {
    var form = root.querySelector("#activityForm");
    var categoryId = activity ? activity.categoryId : "club";

    root.querySelectorAll("[data-category]").forEach(function (button) {
      button.addEventListener("click", function () {
        categoryId = button.getAttribute("data-category");
        root.querySelectorAll("[data-category]").forEach(function (other) {
          other.setAttribute("aria-pressed", String(other === button));
        });
        updateSummary();
      });
    });

    function updateSummary() {
      var summary = root.querySelector("#publishSummary");
      var conflict = root.querySelector("#conflictNote");
      var start = new Date(form.startAt.value).getTime();
      var end = new Date(form.endAt.value).getTime();
      var deadline = new Date(form.regDeadline.value).getTime();
      var capacity = Number(form.capacity.value) || 0;
      var category = DB.categoryById(categoryId);

      summary.innerHTML =
        '<div class="summary-row"><span>活动名称</span><b>' + (App.esc(form.title.value) || "未填写") + "</b></div>" +
        '<div class="summary-row"><span>分类</span><b>' + category.name + "</b></div>" +
        '<div class="summary-row"><span>活动时间</span><b>' + (isFinite(start) ? UI.fmtShort(start) + " " + UI.fmtTime(start) : "未填写") + "</b></div>" +
        '<div class="summary-row"><span>名额</span><b>' + (capacity || "未填写") + " 人</b></div>" +
        '<div class="summary-row"><span>报名截止</span><b>' + (isFinite(deadline) ? UI.fmtShort(deadline) + " " + UI.fmtTime(deadline) : "未填写") + "</b></div>";

      var clash = null;
      if (isFinite(start) && isFinite(end) && form.location.value.trim()) {
        clash = DB.activities().filter(function (other) {
          if (activity && other.id === activity.id) return false;
          if (other.review.status !== "approved") return false;
          if (other.location !== form.location.value.trim()) return false;
          return start < other.endAt && end > other.startAt;
        })[0];
      }
      conflict.innerHTML = clash
        ? '<div class="review-note caption-4">' + App.icon("warning-circle") + " 同一场地在该时段已有活动：" + App.esc(clash.title) + "（" + UI.fmtShort(clash.startAt) + " " + UI.fmtTime(clash.startAt) + "）。如需调整，请修改时间或地点。</div>"
        : "";
    }

    ["title", "capacity", "location", "startAt", "endAt", "regDeadline"].forEach(function (name) {
      form[name].addEventListener("input", updateSummary);
      form[name].addEventListener("change", updateSummary);
    });

    form.querySelector("#agendaEditor").addEventListener("click", function (event) {
      var remove = event.target.closest("[data-action='remove-agenda']");
      if (!remove) return;
      var rows = form.querySelectorAll("[data-agenda-row]");
      if (rows.length <= 1) {
        UI.toast("至少保留一行议程，也可以直接清空内容。", { tone: "warn" });
        return;
      }
      remove.closest("[data-agenda-row]").remove();
    });

    root.querySelector("[data-action='add-agenda']").addEventListener("click", function () {
      var editor = form.querySelector("#agendaEditor");
      var wrapper = document.createElement("div");
      wrapper.innerHTML = renderAgendaRow({ time: "16:00", title: "" });
      editor.appendChild(wrapper.firstChild);
      var last = editor.querySelector("[data-agenda-row]:last-child input[data-agenda-title]");
      if (last) last.focus();
    });

    root.querySelectorAll("[data-action='save-activity']").forEach(function (button) {
      button.addEventListener("click", function () {
        saveForm(button.getAttribute("data-mode"));
      });
    });

    function saveForm(mode) {
      var errorEl = root.querySelector("#formError");
      var error = "";
      var start = new Date(form.startAt.value).getTime();
      var end = new Date(form.endAt.value).getTime();
      var deadline = new Date(form.regDeadline.value).getTime();
      var capacity = Number(form.capacity.value);

      if (!form.title.value.trim()) error = "请填写活动名称。";
      else if (!form.summary.value.trim()) error = "请填写一句话简介，它会显示在活动卡片上。";
      else if (!form.description.value.trim()) error = "请填写活动详情，方便师生了解安排。";
      else if (!isFinite(start) || !isFinite(end)) error = "请填写完整的活动开始与结束时间。";
      else if (end <= start) error = "活动结束时间需要晚于开始时间。";
      else if (!isFinite(deadline)) error = "请填写报名截止时间。";
      else if (deadline > start) error = "报名截止时间需要早于活动开始时间。";
      else if (!form.location.value.trim()) error = "请填写活动地点。";
      else if (!capacity || capacity < 1) error = "名额上限需要大于 0。";

      if (error) {
        errorEl.textContent = error;
        errorEl.hidden = false;
        errorEl.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      errorEl.hidden = true;

      var agenda = [];
      form.querySelectorAll("[data-agenda-row]").forEach(function (row) {
        var time = row.querySelector("[data-agenda-time]").value;
        var title = row.querySelector("[data-agenda-title]").value.trim();
        if (title) agenda.push({ time: time || "09:00", title: title });
      });

      DB.saveActivity({
        id: activity ? activity.id : "",
        title: form.title.value.trim(),
        categoryId: categoryId,
        summary: form.summary.value.trim(),
        description: form.description.value.trim(),
        location: form.location.value.trim(),
        target: form.target.value.trim() || "全校师生",
        capacity: capacity,
        startAt: start,
        endAt: end,
        regDeadline: deadline,
        agenda: agenda,
        notice: UI.lines(form.notice.value).slice(0, 5),
        coverTone: DB.categoryById(categoryId).tone,
        submit: mode === "submit"
      })
        .then(function () {
          UI.toast(mode === "submit" ? "已提交审核，结果会通过站内通知告知。" : "活动已保存为草稿。");
          location.hash = "#/manage";
          if (location.hash === "#/manage") App.refresh();
        })
        .catch(function (requestError) {
          errorEl.textContent = requestError.message;
          errorEl.hidden = false;
          errorEl.scrollIntoView({ block: "center", behavior: "smooth" });
        });
    }

    updateSummary();
  }

  Views["manage-new"] = {
    meta: function () {
      return { title: "发布活动", sub: "填写信息后提交德育处审核" };
    },
    render: function () {
      return renderPublishForm(null);
    },
    mount: function (root) {
      bindPublish(root, null);
    }
  };

  Views["manage-edit"] = {
    meta: function (ctx) {
      var activity = DB.activityById(ctx.params.id);
      return { title: "编辑活动", sub: activity ? activity.title : "" };
    },
    render: function (ctx) {
      var activity = DB.activityById(ctx.params.id);
      if (!activity) return '<div class="card">' + UI.empty({ icon: "warning-circle", title: "活动不存在", body: "它可能已被删除。", action: '<a class="btn btn-secondary btn-sm button-sm" href="#/manage">返回我的活动</a>' }) + "</div>";
      if (activity.organizerId !== App.user.id && App.user.role !== "admin") {
        return '<div class="card">' + UI.empty({ icon: "lock", title: "没有编辑权限", body: "只有活动组织者和管理员可以修改这场活动。" }) + "</div>";
      }
      if (activity.review.status === "pending") {
        return '<div class="card">' + UI.empty({ icon: "hourglass", title: "活动正在审核中", body: "审核完成前不能修改，驳回后可以继续编辑。", action: '<a class="btn btn-secondary btn-sm button-sm" href="#/manage">返回我的活动</a>' }) + "</div>";
      }
      return renderPublishForm(activity);
    },
    mount: function (root, ctx) {
      var activity = DB.activityById(ctx.params.id);
      if (activity) bindPublish(root, activity);
    }
  };

  /* ------------------------------------------------------------------------
     Roster
     ------------------------------------------------------------------------ */

  function rosterRow(registration) {
    var statusBadge =
      registration.status === "checked"
        ? '<span class="badge badge-accent">' + App.icon("check-circle") + "已签到</span>"
        : registration.status === "waitlist"
          ? '<span class="badge badge-warn">' + App.icon("hourglass") + "候补</span>"
          : '<span class="badge badge-info">' + App.icon("ticket") + "已报名</span>";
    return (
      "<tr>" +
      '<td><div class="stack" style="gap:var(--space-25)"><span class="table-title body-5">' + App.esc(registration.name) + "</span>" +
      '<span class="table-sub caption-5">' + App.esc(registration.className || "未填写班级") + "</span></div></td>" +
      '<td class="caption-2 mono">' + App.esc(registration.phone || "未填写") + "</td>" +
      "<td>" + statusBadge + "</td>" +
      '<td class="caption-2">' + UI.fmtShort(registration.createdAt) + " " + UI.fmtTime(registration.createdAt) + "</td>" +
      '<td class="caption-2">' + (registration.checkedAt ? UI.fmtShort(registration.checkedAt) + " " + UI.fmtTime(registration.checkedAt) : "未签到") + "</td>" +
      "<td>" +
      '<div class="cell-actions">' +
      (registration.status === "confirmed"
        ? '<button class="btn btn-primary btn-sm button-sm" type="button" data-action="mark-checkin" data-id="' + registration.id + '">核销</button>'
        : "") +
      (registration.status === "checked"
        ? '<button class="btn btn-ghost btn-sm button-sm" type="button" data-action="undo-checkin" data-id="' + registration.id + '">撤销</button>'
        : "") +
      '<button class="btn btn-ghost btn-sm button-sm" type="button" data-action="copy-code" data-code="' + registration.code + '">' + App.icon("copy") + registration.code + "</button>" +
      "</div></td>" +
      "</tr>"
    );
  }

  Views.roster = {
    meta: function (ctx) {
      var activity = DB.activityById(ctx.params.id);
      return { title: activity ? activity.title : "报名名单", sub: "报名名单与签到记录" };
    },

    render: function (ctx) {
      var activity = DB.activityById(ctx.params.id);
      if (!activity) return '<div class="card">' + UI.empty({ icon: "warning-circle", title: "活动不存在", action: '<a class="btn btn-secondary btn-sm button-sm" href="#/manage">返回我的活动</a>' }) + "</div>";
      if (activity.organizerId !== App.user.id && App.user.role !== "admin") {
        return '<div class="card">' + UI.empty({ icon: "lock", title: "没有查看权限", body: "只有活动组织者与管理员可以查看报名名单。" }) + "</div>";
      }

      var seat = DB.seats(activity);
      var checked = DB.checkedOf(activity.id).length;
      var rate = seat.confirmed ? Math.round((checked / seat.confirmed) * 100) : 0;

      return (
        '<div class="page-head">' +
        '<div class="page-head-text">' +
        '<a class="back-link button-sm" href="#/manage">' + App.icon("arrow-left") + "返回我的活动</a>" +
        '<div class="row" style="gap:var(--space-75);flex-wrap:wrap"><h2 class="heading-5">' + App.esc(activity.title) + "</h2>" + UI.statusBadge(activity) + "</div>" +
        '<p class="caption-2">' + UI.fmtRange(activity.startAt, activity.endAt) + " · " + App.esc(activity.location) + "</p>" +
        "</div>" +
        '<div class="page-actions">' +
        '<a class="btn btn-secondary btn-sm button-sm" href="#/checkin?id=' + activity.id + '">' + App.icon("qr-code") + "签到核销</a>" +
        '<button class="btn btn-primary btn-sm button-sm" type="button" data-action="export-roster" data-id="' + activity.id + '">' + App.icon("download-simple") + "导出名单</button>" +
        "</div></div>" +
        '<div class="kpi-grid">' +
        '<div class="kpi"><span class="kpi-label caption-4">名额</span><span class="kpi-value">' + activity.capacity + "</span></div>" +
        '<div class="kpi"><span class="kpi-label caption-4">已报名</span><span class="kpi-value">' + seat.confirmed + "</span></div>" +
        '<div class="kpi"><span class="kpi-label caption-4">已签到</span><span class="kpi-value">' + checked + " <small>人</small></span></div>" +
        '<div class="kpi"><span class="kpi-label caption-4">签到率</span><span class="kpi-value">' + rate + " <small>%</small></span></div>" +
        "</div>" +
        '<div class="table-wrap">' +
        '<div class="table-toolbar">' +
        '<label class="search-field" style="max-width:280px">' + App.icon("magnifying-glass") +
        '<input type="search" id="rosterSearch" placeholder="搜索姓名或班级"></label>' +
        '<div class="filter-chips" role="group" aria-label="报名状态">' +
        '<button class="chip is-active button-sm" type="button" data-rfilter="all">全部</button>' +
        '<button class="chip button-sm" type="button" data-rfilter="confirmed">已报名</button>' +
        '<button class="chip button-sm" type="button" data-rfilter="checked">已签到</button>' +
        '<button class="chip button-sm" type="button" data-rfilter="waitlist">候补</button>' +
        "</div>" +
        '<span class="caption-5 muted" style="margin-left:auto" id="rosterCount"></span>' +
        "</div>" +
        '<div class="table-scroll"><table class="data"><thead><tr><th>姓名 / 班级</th><th>联系方式</th><th>状态</th><th>报名时间</th><th>签到时间</th><th></th></tr></thead>' +
        '<tbody id="rosterBody"></tbody></table></div>' +
        "</div>"
      );
    },

    mount: function (root, ctx) {
      var body = root.querySelector("#rosterBody");
      var countEl = root.querySelector("#rosterCount");
      var search = root.querySelector("#rosterSearch");
      var filter = "all";

      function apply() {
        var query = search.value.trim().toLowerCase();
        var list = DB.registrationsOf(ctx.params.id).filter(function (registration) {
          if (filter !== "all" && registration.status !== filter) return false;
          if (!query) return true;
          return (registration.name + " " + registration.className).toLowerCase().indexOf(query) !== -1;
        });
        countEl.textContent = "显示 " + list.length + " 条记录";
        if (!list.length) {
          body.innerHTML = '<tr><td colspan="6"><div class="empty" style="padding:var(--space-600)">' +
            '<span class="empty-mark">' + App.icon("users") + "</span>" +
            '<p class="title-2">没有匹配的报名记录</p>' +
            '<p class="body-6 muted">换一个关键词或状态再试一次。</p></div></td></tr>';
          return;
        }
        body.innerHTML = list.map(rosterRow).join("");
      }

      search.addEventListener("input", UI.debounce(apply, 150));

      root.querySelectorAll("[data-rfilter]").forEach(function (chip) {
        chip.addEventListener("click", function () {
          filter = chip.getAttribute("data-rfilter");
          root.querySelectorAll("[data-rfilter]").forEach(function (other) {
            other.classList.toggle("is-active", other === chip);
          });
          apply();
        });
      });

      apply();
    }
  };

  /* ------------------------------------------------------------------------
     Check-in
     ------------------------------------------------------------------------ */

  Views.checkin = {
    meta: function (ctx) {
      var activity = ctx.query.id ? DB.activityById(ctx.query.id) : null;
      return { title: "签到核销", sub: activity ? activity.title : "选择一场活动开始核销" };
    },

    render: function (ctx) {
      var activity = ctx.query.id ? DB.activityById(ctx.query.id) : null;
      var own = ownedActivities();

      if (!activity) {
        return (
          '<div class="page-head"><div class="page-head-text">' +
          '<span class="section-label caption-4">现场核销</span>' +
          '<h2 class="heading-5">选择要核销的活动</h2>' +
          '<p class="caption-2">进入后输入师生的 6 位签到码即可完成签到。</p>' +
          "</div></div>" +
          (own.length
            ? '<div class="list-stack">' +
              own
                .map(function (item) {
                  var seat = DB.seats(item);
                  var checked = DB.checkedOf(item.id).length;
                  return (
                    '<a class="reg-card" href="#/checkin?id=' + item.id + '" style="align-items:center">' +
                    '<span class="reg-body">' +
                    '<span class="row" style="gap:var(--space-75);flex-wrap:wrap"><span class="title-3 reg-title">' + App.esc(item.title) + "</span>" + UI.statusBadge(item) + "</span>" +
                    '<span class="reg-meta caption-2"><span class="meta-line">' + App.icon("clock") + "<span>" + UI.fmtRange(item.startAt, item.endAt) + "</span></span>" +
                    '<span class="meta-line">' + App.icon("map-pin") + "<span>" + App.esc(item.location) + "</span></span></span>" +
                    "</span>" +
                    '<span class="reg-side"><span class="caption-2 muted">已签到 ' + checked + " / " + seat.confirmed + "</span>" +
                    '<span class="btn btn-secondary btn-sm button-sm">开始核销' + App.icon("arrow-right") + "</span></span>" +
                    "</a>"
                  );
                })
                .join("") +
              "</div>"
            : '<div class="card">' + UI.empty({ icon: "qr-code", title: "还没有可核销的活动", body: "发布活动并审核通过后，就可以在现场使用签到码核销。", action: '<a class="btn btn-primary btn-sm button-sm" href="#/manage/new">发布活动</a>' }) + "</div>")
        );
      }

      var seat = DB.seats(activity);
      var checkedRegs = DB.checkedOf(activity.id).sort(function (a, b) {
        return b.checkedAt - a.checkedAt;
      });
      var rate = seat.confirmed ? Math.round((checkedRegs.length / seat.confirmed) * 100) : 0;

      return (
        '<div class="page-head"><div class="page-head-text">' +
        '<a class="back-link button-sm" href="#/checkin">' + App.icon("arrow-left") + "换一场活动</a>" +
        '<div class="row" style="gap:var(--space-75);flex-wrap:wrap"><h2 class="heading-5">' + App.esc(activity.title) + "</h2>" + UI.statusBadge(activity) + "</div>" +
        '<p class="caption-2">' + UI.fmtRange(activity.startAt, activity.endAt) + " · " + App.esc(activity.location) + "</p>" +
        "</div>" +
        '<div class="page-actions"><a class="btn btn-secondary btn-sm button-sm" href="#/manage/' + activity.id + '/roster">' + App.icon("users") + "手动核销</a></div>" +
        "</div>" +
        '<div class="checkin-layout">' +
        '<div class="checkin-card">' +
        '<span class="badge badge-muted caption-4">' + App.icon("qr-code") + "签到码核销</span>" +
        '<h3 class="heading-5">输入 6 位签到码</h3>' +
        '<p class="caption-2 muted">签到码可在对方的「我的报名」中查看，输入完成会自动提交。</p>' +
        '<input class="code-input mono" id="checkinCode" inputmode="numeric" maxlength="6" placeholder="000000" aria-label="签到码" autocomplete="off" autofocus>' +
        '<div id="checkinResult" class="checkin-result is-ok" hidden></div>' +
        '<div class="checkin-stats" style="width:100%;max-width:420px">' +
        '<div class="checkin-stat"><b id="statChecked">' + checkedRegs.length + '</b><span class="caption-5">已签到</span></div>' +
        '<div class="checkin-stat"><b id="statConfirmed">' + seat.confirmed + '</b><span class="caption-5">已报名</span></div>' +
        '<div class="checkin-stat"><b id="statRate">' + rate + '%</b><span class="caption-5">签到率</span></div>' +
        "</div>" +
        "</div>" +
        '<div class="stack" style="gap:var(--space-100)">' +
        '<div class="chart-card">' +
        '<div class="chart-head"><div><h3 class="title-2">最近核销</h3><p class="caption-5">按签到时间倒序，最多显示 8 条</p></div></div>' +
        '<div class="feed" id="checkinFeed">' +
        (checkedRegs.length
          ? checkedRegs
              .slice(0, 8)
              .map(function (registration) {
                return (
                  '<div class="feed-item">' +
                  '<span class="avatar">' + App.esc(registration.name.slice(0, 1)) + "</span>" +
                  '<span class="stack"><span class="body-5">' + App.esc(registration.name) + "</span>" +
                  '<span class="caption-5 muted">' + App.esc(registration.className || "") + "</span></span>" +
                  '<span class="feed-time caption-5">' + UI.fmtTime(registration.checkedAt) + "</span>" +
                  "</div>"
                );
              })
              .join("")
          : '<div class="empty" style="padding:var(--space-300) 0"><span class="empty-mark">' + App.icon("clock") + "</span>" +
            '<p class="body-5">还没有人签到</p><p class="caption-2 muted">输入第一位到场师生的签到码开始。</p></div>') +
        "</div>" +
        "</div>" +
        '<div class="chart-card">' +
        '<h3 class="title-2">核销提示</h3>' +
        '<ul class="notice-list">' +
        "<li>" + App.icon("check") + "<span>签到码为 6 位数字，输入最后一位后自动提交。</span></li>" +
        "<li>" + App.icon("check") + "<span>同一条签到码重复输入会被拦下，并显示首次核销时间。</span></li>" +
        "<li>" + App.icon("check") + "<span>候补状态的同学没有正式名额，核销会提示先确认名额。</span></li>" +
        "<li>" + App.icon("check") + "<span>需要为未携带签到码的同学补签时，回到报名名单手动核销。</span></li>" +
        "</ul>" +
        "</div>" +
        "</div>" +
        "</div>"
      );
    },

    mount: function (root, ctx) {
      var input = root.querySelector("#checkinCode");
      if (!input) return;
      var activity = DB.activityById(ctx.query.id);
      var result = root.querySelector("#checkinResult");
      var feed = root.querySelector("#checkinFeed");
      var timer = null;

      function feedMarkup() {
        var list = DB.checkedOf(activity.id).sort(function (a, b) {
          return b.checkedAt - a.checkedAt;
        });
        var seat = DB.seats(activity);
        root.querySelector("#statChecked").textContent = list.length;
        root.querySelector("#statConfirmed").textContent = seat.confirmed;
        root.querySelector("#statRate").textContent = (seat.confirmed ? Math.round((list.length / seat.confirmed) * 100) : 0) + "%";
        return list.length
          ? list
              .slice(0, 8)
              .map(function (registration) {
                return (
                  '<div class="feed-item">' +
                  '<span class="avatar">' + App.esc(registration.name.slice(0, 1)) + "</span>" +
                  '<span class="stack"><span class="body-5">' + App.esc(registration.name) + "</span>" +
                  '<span class="caption-5 muted">' + App.esc(registration.className || "") + "</span></span>" +
                  '<span class="feed-time caption-5">' + UI.fmtTime(registration.checkedAt) + "</span>" +
                  "</div>"
                );
              })
              .join("")
          : '<div class="empty" style="padding:var(--space-300) 0"><span class="empty-mark">' + App.icon("clock") + "</span>" +
            '<p class="body-5">还没有人签到</p><p class="caption-2 muted">输入第一位到场师生的签到码开始。</p></div>';
      }

      function showResult(kind, title, detail) {
        result.hidden = false;
        result.className = "checkin-result " + (kind === "ok" ? "is-ok" : kind === "warn" ? "is-warn" : "is-bad");
        result.innerHTML =
          App.icon(kind === "ok" ? "check-circle" : kind === "warn" ? "warning-circle" : "x") +
          '<span class="checkin-result-body"><strong class="body-5">' + App.esc(title) + "</strong>" +
          (detail ? '<span class="caption-2">' + App.esc(detail) + "</span>" : "") +
          "</span>";
      }

      function submit() {
        var value = input.value.replace(/\D/g, "");
        if (value.length !== 6) return;
        DB.checkIn(activity.id, value)
          .then(function (outcome) {
            DB.applyRegistration(outcome.registration);
            if (outcome.activity) DB.replaceActivity(outcome.activity);
            showResult(
              "ok",
              "核销成功 · " + outcome.registration.name,
              (outcome.registration.className || "") + "，签到时间 " + UI.fmtTime(outcome.registration.checkedAt)
            );
            input.value = "";
            input.classList.remove("is-error");
            feed.innerHTML = feedMarkup();
          })
          .catch(function (error) {
            if (error.status === 409) {
              showResult("warn", "未能核销", error.message);
            } else {
              showResult("bad", "核销失败", error.message);
            }
            input.classList.add("is-error");
            input.select();
          });
      }

      input.addEventListener("input", function () {
        input.value = input.value.replace(/\D/g, "").slice(0, 6);
        input.classList.remove("is-error");
        if (result.hidden === false) result.hidden = true;
        clearTimeout(timer);
        if (input.value.length === 6) {
          timer = setTimeout(submit, 220);
        }
      });

      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          clearTimeout(timer);
          submit();
        }
      });

      input.focus();
    }
  };

  /* ------------------------------------------------------------------------
     Shared organizer actions
     ------------------------------------------------------------------------ */

  AppActions["submit-review"] = function (el) {
    var activity = DB.activityById(el.getAttribute("data-id"));
    if (!activity) return;
    UI.confirm({
      title: "提交审核",
      body: "「" + activity.title + "」将进入德育处审核队列，通过后自动上架。",
      confirmText: "提交审核"
    }).then(function (ok) {
      if (!ok) return;
      DB.submitForReview(activity.id)
        .then(function () {
          UI.toast("已提交审核");
          App.refresh();
        })
        .catch(function (error) {
          UI.toast(error.message, { tone: "warn" });
        });
    });
  };

  AppActions["export-roster"] = function (el) {
    var csv = DB.rosterCsv(el.getAttribute("data-id"));
    UI.download(csv.filename, csv.content);
    UI.toast("名单已导出，可用 Excel 打开");
  };

  AppActions["mark-checkin"] = function (el) {
    DB.checkInById(el.getAttribute("data-id"))
      .then(function (outcome) {
        DB.applyRegistration(outcome.registration);
        UI.toast(outcome.registration.name + " 已核销");
        App.refresh();
      })
      .catch(function (error) {
        UI.toast(error.message, { tone: "warn" });
      });
  };

  AppActions["undo-checkin"] = function (el) {
    DB.undoCheckIn(el.getAttribute("data-id"))
      .then(function (outcome) {
        DB.applyRegistration(outcome.registration);
        UI.toast("已撤销核销，" + outcome.registration.name + " 回到已报名状态");
        App.refresh();
      })
      .catch(function (error) {
        UI.toast(error.message, { tone: "warn" });
      });
  };
})(window);
