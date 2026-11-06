/* ==========================================================================
   Application shell: session, navigation, router, notifications, account,
   shared components and the global action dispatcher.
   ========================================================================== */

(function (global) {
  "use strict";

  var DB = global.DB;
  var UI = global.UI;

  var App = {
    user: null,
    route: null,
    params: {},
    query: {},
    ctx: {},
    actions: global.AppActions || {}
  };

  /* ------------------------------------------------------------------------
     Navigation
     ------------------------------------------------------------------------ */

  var NAV = [
    {
      label: "参与",
      items: [
        { route: "square", label: "活动广场", icon: "calendar-blank", href: "#/square" },
        { route: "mine", label: "我的报名", icon: "ticket", href: "#/mine" },
        { route: "notices", label: "通知中心", icon: "bell", href: "#/notices" }
      ]
    },
    {
      label: "组织",
      roles: ["organizer", "admin"],
      items: [
        { route: "manage", label: "我的活动", icon: "list-checks", href: "#/manage" },
        { route: "manage-new", label: "发布活动", icon: "plus", href: "#/manage/new" },
        { route: "checkin", label: "签到核销", icon: "qr-code", href: "#/checkin" }
      ]
    },
    {
      label: "管理",
      roles: ["admin"],
      items: [
        { route: "review", label: "活动审核", icon: "shield-check", href: "#/review", badge: "pending" },
        { route: "users", label: "用户管理", icon: "users", href: "#/users" },
        { route: "stats", label: "数据统计", icon: "chart-bar", href: "#/stats" }
      ]
    }
  ];

  var ROUTES = [
    { path: /^\/square$/, name: "square", title: "活动广场", sub: "浏览本校正在报名的活动" },
    { path: /^\/activity\/([\w-]+)$/, name: "activity", title: "活动详情", params: ["id"] },
    { path: /^\/mine$/, name: "mine", title: "我的报名", sub: "签到码与报名状态" },
    { path: /^\/notices$/, name: "notices", title: "通知中心", sub: "报名、审核与活动提醒" },
    {
      path: /^\/manage$/,
      name: "manage",
      title: "我的活动",
      sub: "管理你发布的活动",
      roles: ["organizer", "admin"]
    },
    {
      path: /^\/manage\/new$/,
      name: "manage-new",
      title: "发布活动",
      sub: "填写活动信息并提交审核",
      roles: ["organizer", "admin"]
    },
    {
      path: /^\/manage\/([\w-]+)\/edit$/,
      name: "manage-edit",
      title: "编辑活动",
      sub: "修改后重新提交审核",
      roles: ["organizer", "admin"],
      params: ["id"]
    },
    {
      path: /^\/manage\/([\w-]+)\/roster$/,
      name: "roster",
      title: "报名名单",
      sub: "报名、候补与签到记录",
      roles: ["organizer", "admin"],
      params: ["id"]
    },
    {
      path: /^\/checkin$/,
      name: "checkin",
      title: "签到核销",
      sub: "输入 6 位签到码完成现场核销",
      roles: ["organizer", "admin"]
    },
    {
      path: /^\/review$/,
      name: "review",
      title: "活动审核",
      sub: "审核组织者提交的活动",
      roles: ["admin"]
    },
    {
      path: /^\/users$/,
      name: "users",
      title: "用户管理",
      sub: "账号、角色与启用状态",
      roles: ["admin"]
    },
    {
      path: /^\/stats$/,
      name: "stats",
      title: "数据统计",
      sub: "报名、签到与分布情况",
      roles: ["admin"]
    }
  ];

  var ACTIVE_GROUP = {
    activity: "square",
    "manage-edit": "manage",
    roster: "manage"
  };

  /* ------------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------------ */

  function esc(value) {
    return UI.esc(value);
  }

  function icon(name) {
    return UI.icon(name);
  }

  function canRole(role) {
    if (!App.user) return false;
    return !role || App.user.role === role || (role === "organizer" && App.user.role === "admin");
  }

  function roleLabel(role) {
    return (DB.roles()[role] || {}).label || role;
  }

  function queryFrom(path) {
    var out = {};
    var index = path.indexOf("?");
    if (index === -1) return out;
    new URLSearchParams(path.slice(index + 1)).forEach(function (value, key) {
      out[key] = value;
    });
    return out;
  }

  /* ------------------------------------------------------------------------
     Shared components
     ------------------------------------------------------------------------ */

  function coverMarkup(activity, opts) {
    var options = opts || {};
    var category = DB.categoryById(activity.categoryId);
    var tone = activity.coverTone || category.tone;
    var date = new Date(activity.startAt);
    var big = options.large ? " cover-lg" : "";
    return (
      '<div class="cover cover-' + tone + big + '">' +
      '<span class="cover-mark">' + icon(category.icon) + "</span>" +
      '<span class="cover-cat caption-3">' + esc(category.name) + "</span>" +
      '<span class="cover-date"><b>' + (date.getMonth() + 1) + "月" + date.getDate() + "日</b>" +
      "<span>" + UI.WEEK[date.getDay()] + " " + UI.fmtTime(activity.startAt) + "</span></span>" +
      "</div>"
    );
  }

  function seatMarkup(activity) {
    var seat = DB.seats(activity);
    var cls = seat.percent >= 100 ? "is-full" : seat.percent >= 85 ? "is-warm" : "";
    return (
      '<div class="seat-meter">' +
      '<span class="seat-text caption-5"><b>' +
      seat.confirmed +
      "</b> / " +
      seat.capacity +
      " 人" +
      (seat.waitlist ? " · 候补 " + seat.waitlist : "") +
      "</span>" +
      '<div class="progress"><i class="' +
      cls +
      '" style="width:' +
      seat.percent +
      '%"></i></div>' +
      "</div>"
    );
  }

  function cardAction(activity) {
    var status = DB.statusOf(activity);
    var mine = DB.myRegistration(activity.id, App.user.id);
    if (mine) {
      return (
        '<a class="btn btn-secondary btn-sm button-sm" href="#/mine">' +
        (mine.status === "waitlist" ? "候补中" : mine.status === "checked" ? "已签到" : "已报名") +
        "</a>"
      );
    }
    if (status.key === "open") {
      var seat = DB.seats(activity);
      return (
        '<button class="btn ' +
        (seat.full ? "btn-soft" : "btn-primary") +
        ' btn-sm button-sm" type="button" data-action="open-signup" data-id="' +
        activity.id +
        '">' +
        (seat.full ? "候补" : "报名") +
        "</button>"
      );
    }
    return '<a class="btn btn-ghost btn-sm button-sm" href="#/activity/' + activity.id + '">查看</a>';
  }

  function activityCard(activity) {
    var status = DB.statusOf(activity);
    var category = DB.categoryById(activity.categoryId);
    return (
      '<article class="activity-card">' +
      '<a href="#/activity/' +
      activity.id +
      '" aria-label="' +
      esc(activity.title) +
      '">' +
      coverMarkup(activity) +
      "</a>" +
      '<div class="activity-card-body">' +
      '<div class="activity-card-head">' +
      '<a class="title-2 activity-title" href="#/activity/' +
      activity.id +
      '">' +
      esc(activity.title) +
      "</a>" +
      UI.statusBadge(activity) +
      "</div>" +
      '<p class="body-6 activity-summary">' +
      esc(activity.summary) +
      "</p>" +
      '<div class="activity-meta caption-2">' +
      '<span class="meta-line">' +
      icon("clock") +
      "<span>" +
      UI.fmtRange(activity.startAt, activity.endAt) +
      "</span></span>" +
      '<span class="meta-line">' +
      icon("map-pin") +
      "<span>" +
      esc(activity.location) +
      "</span></span>" +
      '<span class="meta-line">' +
      icon("buildings") +
      "<span>" +
      esc(category.name) +
      " · " +
      esc((DB.userById(activity.organizerId) || {}).department || "校团委") +
      "</span></span>" +
      "</div>" +
      '<div class="activity-foot">' +
      seatMarkup(activity) +
      cardAction(activity) +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  /* ------------------------------------------------------------------------
     Sign-up flow
     ------------------------------------------------------------------------ */

  function openSignup(activity) {
    var seat = DB.seats(activity);
    var wait = seat.full;
    var body =
      '<form id="signupForm" class="stack" style="gap:var(--space-200)" novalidate>' +
      '<div class="card" style="padding:var(--space-100);background:var(--surface-2);border:0">' +
      '<p class="title-4">' +
      esc(activity.title) +
      "</p>" +
      '<p class="caption-2 muted">' +
      UI.fmtRange(activity.startAt, activity.endAt) +
      " · " +
      esc(activity.location) +
      "</p>" +
      "</div>" +
      (wait
        ? '<div class="badge badge-warn caption-4" style="align-self:flex-start">名额已满，提交后进入候补队列</div>'
        : "") +
      '<div class="form-grid">' +
      '<label class="field"><span class="field-label caption-1">姓名</span>' +
      '<input class="input" name="name" value="' +
      esc(App.user.name) +
      '" required autocomplete="name"></label>' +
      '<label class="field"><span class="field-label caption-1">班级</span>' +
      '<input class="input" name="className" value="' +
      esc(App.user.className || "") +
      '" required placeholder="如 高二(3)班"></label>' +
      "</div>" +
      '<label class="field"><span class="field-label caption-1">手机号</span>' +
      '<input class="input" name="phone" value="' +
      esc(App.user.phone || "") +
      '" inputmode="tel" placeholder="用于现场联系，选填"></label>' +
      '<label class="field"><span class="field-label caption-1">备注<span class="muted">（选填）</span></span>' +
      '<textarea class="textarea" name="note" rows="2" style="min-height:64px" placeholder="如时段意向、饮食禁忌、随行人数"></textarea></label>' +
      '<p class="field-error caption-4" data-form-error hidden></p>' +
      "</form>";

    UI.sheet({
      title: wait ? "加入候补" : "确认报名",
      subtitle: wait ? "当前名额已满，有人取消时会自动递补" : "报名后可在「我的报名」查看签到码",
      body: body,
      actions: [
        { label: "取消", variant: "secondary" },
        {
          label: wait ? "加入候补" : "确认报名",
          variant: "primary",
          onClick: function (sheetEl, close) {
            var form = sheetEl.querySelector("#signupForm");
            var data = {
              name: form.name.value.trim(),
              className: form.className.value.trim(),
              phone: form.phone.value.trim(),
              note: form.note.value.trim()
            };
            var errorEl = form.querySelector("[data-form-error]");
            var error = "";
            if (!data.name) error = "请填写姓名。";
            else if (!data.className) error = "请填写班级，便于现场点名。";
            else if (data.phone && !/^1[3-9]\d{9}$/.test(data.phone.replace(/\s/g, "")))
              error = "手机号格式不对，请填写 11 位手机号，或留空。";
            if (error) {
              errorEl.textContent = error;
              errorEl.hidden = false;
              form.querySelector(".input").focus();
              return false;
            }
            var result = null;
            DB.register(activity.id, data)
              .then(function (response) {
                result = response;
                close();
                showTicket(activity, result.registration, result.waitlist);
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
  }

  function showTicket(activity, registration, waitlisted) {
    UI.sheet({
      title: waitlisted ? "已进入候补队列" : "报名成功",
      subtitle: esc(activity.title),
      body:
        '<div class="stack" style="gap:var(--space-200)">' +
        (waitlisted
          ? '<p class="body-3">名额已满，你已进入候补队列。有人取消时系统会按顺序递补并发送站内通知。</p>'
          : '<p class="body-3">请记下签到码，活动现场凭此核销。也可以在「我的报名」中随时查看。</p>') +
        '<div class="ticket-code-card">' +
        '<span class="caption-4">签到码</span>' +
        '<span class="code">' +
        registration.code.replace(/(\d{3})(\d{3})/, "$1 $2") +
        "</span>" +
        '<span class="caption-5">' +
        UI.fmtRange(activity.startAt, activity.endAt) +
        " · " +
        esc(activity.location) +
        "</span>" +
        "</div>" +
        '<div class="row" style="gap:var(--space-75)">' +
        '<button class="btn btn-secondary btn-sm button-sm" type="button" data-action="copy-code" data-code="' +
        registration.code +
        '">' +
        icon("copy") +
        "复制签到码</button>" +
        '<a class="btn btn-ghost btn-sm button-sm" href="#/mine">查看我的报名' +
        icon("arrow-right") +
        "</a>" +
        "</div>" +
        "</div>",
      actions: [{ label: "知道了", variant: "primary" }]
    });
    renderTopbar();
  }

  /* ------------------------------------------------------------------------
     Shell markup
     ------------------------------------------------------------------------ */

  function navMarkup() {
    var pending = DB.stats().pending;
    var groups = NAV.filter(function (group) {
      return !group.roles || group.roles.indexOf(App.user.role) !== -1 || App.user.role === "admin";
    });
    return groups
      .map(function (group) {
        return (
          '<div class="nav-group">' +
          '<span class="nav-group-label caption-3">' +
          group.label +
          "</span>" +
          group.items
            .map(function (item) {
              var badge = item.badge === "pending" && pending ? '<span class="nav-badge">' + pending + "</span>" : "";
              return (
                '<a class="nav-item button-sm" href="' +
                item.href +
                '" data-nav="' +
                item.route +
                '">' +
                icon(item.icon) +
                "<span>" +
                item.label +
                "</span>" +
                badge +
                "</a>"
              );
            })
            .join("") +
          "</div>"
        );
      })
      .join("");
  }

  function sidebarMarkup() {
    return (
      '<aside class="sidebar" id="sidebar" aria-label="平台导航">' +
      '<div class="sidebar-brand">' +
      '<a class="brand-link" href="index.html" aria-label="返回首页">' +
      '<span class="brand-mark" aria-hidden="true">云</span>' +
      '<span class="stack"><span class="brand-name">学校活动平台</span>' +
      '<span class="brand-sub">云溪中学 · V1.0</span></span>' +
      "</a>" +
      '<button class="icon-btn sidebar-close" type="button" data-action="toggle-sidebar" aria-label="关闭导航">' +
      icon("x") +
      "</button>" +
      "</div>" +
      '<div class="sidebar-scroll" id="sidebarNav">' +
      navMarkup() +
      "</div>" +
      '<div class="sidebar-foot">' +
      '<button class="account-btn" type="button" data-action="open-account">' +
      '<span class="avatar">' +
      esc(App.user.name.slice(0, 1)) +
      "</span>" +
      '<span class="account-meta">' +
      '<span class="account-name body-5">' +
      esc(App.user.name) +
      "</span>" +
      '<span class="account-role caption-5">' +
      esc(roleLabel(App.user.role)) +
      " · " +
      esc(App.user.className || App.user.department) +
      "</span>" +
      "</span>" +
      icon("caret-down") +
      "</button>" +
      "</div>" +
      "</aside>"
    );
  }

  function notificationsMarkup() {
    var items = DB.noticesFor(App.user.id).slice(0, 5);
    if (!items.length) {
      return (
        '<div class="popover-body">' +
        UI.empty({ icon: "bell", title: "还没有通知", body: "报名、候补与审核结果会出现在这里。" }) +
        "</div>"
      );
    }
    return (
      '<div class="popover-body">' +
      items
        .map(function (notice) {
          return (
            '<a class="popover-item' +
            (notice.read ? "" : " is-unread") +
            '" href="' +
            (notice.activityId ? "#/activity/" + notice.activityId : "#/notices") +
            '">' +
            icon(notice.type === "review" ? "shield-check" : notice.type === "reminder" ? "clock" : "ticket") +
            '<span class="popover-item-body caption-2">' +
            "<strong>" +
            esc(notice.title) +
            "</strong>" +
            "<span>" +
            esc(notice.body) +
            "</span>" +
            '<span class="caption-5" style="color:var(--muted-2)">' +
            UI.relTime(notice.createdAt) +
            "</span>" +
            "</span></a>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function topbarMarkup() {
    var unread = DB.unreadCount(App.user.id);
    return (
      '<header class="topbar">' +
      '<button class="icon-btn mobile-menu-btn" type="button" data-action="toggle-sidebar" aria-label="打开导航">' +
      '<span class="menu-lines" aria-hidden="true"><span></span><span></span><span></span></span>' +
      "</button>" +
      '<div class="topbar-title"><h1 class="title-2">' +
      esc(App.page.title) +
      "</h1>" +
      (App.page.sub ? '<span class="caption-5">' + esc(App.page.sub) + "</span>" : "") +
      "</div>" +
      '<div class="topbar-actions">' +
      '<div class="topbar-wrap">' +
      '<button class="icon-btn bell-btn" type="button" data-action="toggle-notifications" aria-label="通知" aria-expanded="false">' +
      icon("bell") +
      (unread ? '<span class="bell-dot"></span>' : "") +
      "</button>" +
      '<div class="popover" id="notifPopover" hidden>' +
      '<div class="popover-head"><span class="title-4">通知</span>' +
      '<button class="btn btn-ghost btn-sm button-sm" type="button" data-action="mark-all-read">全部已读</button></div>' +
      notificationsMarkup() +
      '<div class="popover-foot caption-4"><a href="#/notices">查看全部通知</a></div>' +
      "</div>" +
      "</div>" +
      '<button class="icon-btn" type="button" data-action="open-account" aria-label="账号菜单">' +
      '<span class="avatar">' +
      esc(App.user.name.slice(0, 1)) +
      "</span>" +
      "</button>" +
      "</div>" +
      "</header>"
    );
  }

  function renderTopbar() {
    var host = document.getElementById("topbarHost");
    if (host) host.innerHTML = topbarMarkup();
  }

  function updateNav() {
    var active = ACTIVE_GROUP[App.route.name] || App.route.name;
    document.querySelectorAll("[data-nav]").forEach(function (link) {
      link.classList.toggle("is-active", link.getAttribute("data-nav") === active);
    });
  }

  /* ------------------------------------------------------------------------
     Router
     ------------------------------------------------------------------------ */

  function resolve(path) {
    for (var i = 0; i < ROUTES.length; i += 1) {
      var route = ROUTES[i];
      var match = route.path.exec(path);
      if (!match) continue;
      var params = {};
      (route.params || []).forEach(function (key, index) {
        params[key] = match[index + 1];
      });
      return { route: route, params: params };
    }
    return null;
  }

  function render() {
    var raw = (location.hash || "#/square").slice(1);
    var path = raw.split("?")[0] || "/square";
    var resolved = resolve(path);
    if (!App.user) return;
    if (!resolved) {
      App.page = { title: "页面不存在", sub: "" };
      document.getElementById("view").innerHTML =
        '<div class="card">' +
        UI.empty({
          icon: "warning-circle",
          title: "没有找到这个页面",
          body: "链接可能已经失效，回到活动广场继续浏览。",
          action: '<a class="btn btn-primary btn-sm button-sm" href="#/square">回到活动广场</a>'
        }) +
        "</div>";
      renderChrome();
      return;
    }

    if (!canRole(resolved.route.roles ? resolved.route.roles[0] : null)) {
      location.replace("#/square");
      return;
    }

    var ctx = {
      params: resolved.params,
      query: queryFrom(raw),
      user: App.user
    };
    App.route = resolved.route;
    App.params = resolved.params;
    App.query = ctx.query;
    App.ctx = ctx;

    var view = global.Views[resolved.route.name];
    if (!view) {
      App.page = { title: "建设中", sub: "该页面尚未完成" };
      document.getElementById("view").innerHTML = "";
      renderChrome();
      return;
    }

    var meta = typeof view.meta === "function" ? view.meta(ctx) : {};
    App.page = {
      title: meta.title || resolved.route.title,
      sub: meta.sub !== undefined ? meta.sub : resolved.route.sub || ""
    };

    var root = document.getElementById("view");
    root.innerHTML = view.render(ctx);
    renderChrome();
    if (typeof view.mount === "function") view.mount(root, ctx);
    window.scrollTo(0, 0);
    closeSidebar();
  }

  function renderChrome() {
    renderTopbar();
    updateNav();
    document.title = App.page.title + " · 学校活动在线服务平台";
  }

  /* ------------------------------------------------------------------------
     Account sheet
     ------------------------------------------------------------------------ */

  function openAccount() {
    var user = App.user;
    var body =
      '<div class="stack" style="gap:var(--space-200)">' +
      '<div class="row" style="gap:var(--space-100)">' +
      '<span class="avatar avatar-lg">' +
      esc(user.name.slice(0, 1)) +
      "</span>" +
      '<span class="stack" style="gap:var(--space-25)">' +
      '<span class="title-2">' +
      esc(user.name) +
      "</span>" +
      '<span class="caption-2 muted">' +
      esc(roleLabel(user.role)) +
      " · " +
      esc(user.account) +
      "</span></span></div>" +
      '<div class="summary-list">' +
      '<div class="summary-row"><span>班级或部门</span><b>' +
      esc(user.className || user.department || "未填写") +
      "</b></div>" +
      '<div class="summary-row"><span>手机号</span><b>' +
      esc(user.phone || "未填写") +
      "</b></div>" +
      "</div>" +
      '<hr class="divider">' +
      '<button class="btn btn-secondary btn-block button-sm" type="button" data-action="open-password">' +
      icon("lock") +
      "修改密码</button>" +
      '<button class="btn btn-ghost btn-block button-sm" type="button" data-action="logout">' +
      icon("sign-out") +
      "退出登录</button>" +
      "</div>";
    UI.sheet({ title: "我的账号", subtitle: "账号由学校统一创建，如需调整请联系管理员", body: body });
  }

  function openPassword() {
    UI.sheet({
      title: "修改密码",
      subtitle: "修改成功后需要重新登录",
      body:
        '<form id="passwordForm" class="stack" style="gap:var(--space-200)" novalidate>' +
        '<label class="field"><span class="field-label caption-1">当前密码</span>' +
        '<input class="input" type="password" name="current" autocomplete="current-password" required></label>' +
        '<label class="field"><span class="field-label caption-1">新密码</span>' +
        '<input class="input" type="password" name="next" autocomplete="new-password" minlength="8" required>' +
        '<span class="field-hint caption-5">至少 8 位，建议同时包含字母与数字。</span></label>' +
        '<label class="field"><span class="field-label caption-1">确认新密码</span>' +
        '<input class="input" type="password" name="confirm" autocomplete="new-password" required></label>' +
        '<p class="field-error caption-4" data-form-error hidden></p>' +
        "</form>",
      actions: [
        { label: "取消", variant: "secondary" },
        {
          label: "确认修改",
          variant: "primary",
          onClick: function (sheetEl, close) {
            var form = sheetEl.querySelector("#passwordForm");
            var errorEl = form.querySelector("[data-form-error]");
            var current = form.current.value;
            var next = form.next.value;
            var error = "";
            if (!current) error = "请填写当前密码。";
            else if (next.length < 8) error = "新密码至少 8 位。";
            else if (next !== form.confirm.value) error = "两次输入的新密码不一致。";
            if (error) {
              errorEl.textContent = error;
              errorEl.hidden = false;
              return false;
            }
            errorEl.hidden = true;
            DB.changePassword(current, next)
              .then(function () {
                close();
                UI.toast("密码已修改，请用新密码重新登录");
                setTimeout(function () {
                  global.location.replace("login.html");
                }, 900);
              })
              .catch(function (requestError) {
                errorEl.textContent = requestError.message;
                errorEl.hidden = false;
              });
            return false;
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------------------------
     Actions
     ------------------------------------------------------------------------ */

  App.actions["open-account"] = openAccount;
  App.actions["open-signup"] = function (el) {
    var activity = DB.activityById(el.getAttribute("data-id"));
    if (activity) openSignup(activity);
  };

  App.actions["open-password"] = openPassword;

  App.actions["logout"] = function () {
    DB.logout()
      .catch(function () {
        /* 忽略网络错误，仍然回到登录页 */
      })
      .then(function () {
        global.location.replace("login.html");
      });
  };

  App.actions["toggle-sidebar"] = function () {
    var sidebar = document.getElementById("sidebar");
    var open = !sidebar.classList.contains("is-open");
    sidebar.classList.toggle("is-open", open);
    var backdrop = document.querySelector(".drawer-backdrop");
    if (open) {
      backdrop = document.createElement("div");
      backdrop.className = "drawer-backdrop";
      backdrop.addEventListener("click", closeSidebar);
      document.body.appendChild(backdrop);
      requestAnimationFrame(function () {
        backdrop.classList.add("is-in");
      });
    } else {
      closeSidebar();
    }
  };

  function closeSidebar() {
    var sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.remove("is-open");
    var backdrop = document.querySelector(".drawer-backdrop");
    if (backdrop) {
      backdrop.classList.remove("is-in");
      setTimeout(function () {
        backdrop.remove();
      }, 200);
    }
  }

  App.actions["toggle-notifications"] = function (el) {
    var pop = document.getElementById("notifPopover");
    var open = pop.hidden;
    pop.hidden = !open;
    el.setAttribute("aria-expanded", String(open));
    if (open) {
      pop.classList.remove("is-in");
      requestAnimationFrame(function () {
        pop.classList.add("is-in");
      });
    }
  };

  App.actions["mark-all-read"] = function () {
    DB.markAllRead()
      .then(function () {
        App.refresh();
        UI.toast("通知已全部标为已读");
      })
      .catch(function (error) {
        UI.toast(error.message, { tone: "warn" });
      });
  };

  function openNotifications(force) {
    var pop = document.getElementById("notifPopover");
    if (!pop) return;
    if (force) pop.hidden = false;
  }

  App.actions["copy-code"] = function (el) {
    var code = el.getAttribute("data-code");
    UI.copy(code).then(function () {
      UI.toast("签到码 " + code + " 已复制");
    });
  };

  App.actions["cancel-registration"] = function (el) {
    var registrationId = el.getAttribute("data-id");
    var registration = DB.state().registrations.filter(function (item) {
      return item.id === registrationId;
    })[0];
    if (!registration) return;
    var activity = DB.activityById(registration.activityId);
    var isWaitlist = registration.status === "waitlist";
    UI.confirm({
      title: "取消报名",
      subtitle: activity ? activity.title : "",
      body: isWaitlist
        ? "取消后会退出候补队列，之后需要重新报名才能排队。"
        : "取消后名额会按顺序让给候补队列中的同学，重新报名需要重新排队。",
      confirmText: "确认取消",
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      DB.cancel(registrationId)
        .then(function (outcome) {
          UI.toast(outcome.promoted ? "已取消报名，候补同学已自动递补" : "已取消报名");
          App.refresh();
        })
        .catch(function (error) {
          UI.toast(error.message, { tone: "warn" });
        });
    });
  };

  App.actions["share-activity"] = function (el) {
    var link = location.origin + location.pathname + "#/activity/" + el.getAttribute("data-id");
    UI.copy(link).then(function () {
      UI.toast("活动链接已复制，可以直接发给同学");
    });
  };

  /* ------------------------------------------------------------------------
     Global settings
     ------------------------------------------------------------------------ */

  App.go = function (path) {
    location.hash = path;
  };
  App.refresh = render;
  App.cover = coverMarkup;
  App.card = activityCard;
  App.seatMarkup = seatMarkup;
  App.openSignup = openSignup;
  App.roleLabel = roleLabel;
  App.esc = esc;
  App.icon = icon;
  App.closeSidebar = closeSidebar;

  global.App = App;

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */

  document.addEventListener("click", function (event) {
    var target = event.target.closest("[data-action]");
    if (!target) {
      var pop = document.getElementById("notifPopover");
      if (pop && !pop.hidden && !event.target.closest(".topbar-wrap")) {
        pop.hidden = true;
      }
      return;
    }
    var action = App.actions[target.getAttribute("data-action")];
    if (!action) return;
    event.preventDefault();
    action(target, event);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      var pop = document.getElementById("notifPopover");
      if (pop) pop.hidden = true;
      closeSidebar();
    }
  });

  window.addEventListener("hashchange", render);

  function showFatal(error) {
    var shell = document.getElementById("shell");
    if (!shell) return;
    shell.innerHTML =
      '<div class="app-main" style="margin-left:0">' +
      '<div class="view" style="max-width:560px;margin-top:96px">' +
      '<div class="card card-pad stack" style="gap:var(--space-200)">' +
      '<h1 class="heading-5">工作台没有加载成功</h1>' +
      '<p class="body-6 muted">' +
      esc(error && error.message ? error.message : "网络异常，请稍后重试。") +
      "</p>" +
      '<div class="row" style="gap:var(--space-75)">' +
      '<button class="btn btn-primary btn-sm button-sm" type="button" id="retryBoot">重新加载</button>' +
      '<a class="btn btn-secondary btn-sm button-sm" href="login.html">回到登录页</a>' +
      "</div></div></div></div>";
    var retry = document.getElementById("retryBoot");
    if (retry) retry.addEventListener("click", function () { global.location.reload(); });
  }

  DB.init()
    .then(function () {
      App.user = DB.user();
      document.getElementById("shell").innerHTML =
        sidebarMarkup() +
        '<div class="app-main">' +
        '<div id="topbarHost"></div>' +
        '<main id="view" class="view" tabindex="-1"></main>' +
        "</div>";
      render();
    })
    .catch(showFatal);
})(window);
