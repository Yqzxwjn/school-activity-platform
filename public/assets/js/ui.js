/* ==========================================================================
   Shared UI helpers: formatting, icons, toasts, sheets, covers, csv export
   ========================================================================== */

(function (global) {
  "use strict";

  var WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function esc(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function icon(name, className) {
    return '<span class="icon icon-' + name + " " + (className || "") + '" aria-hidden="true"></span>';
  }

  function pad(n, width) {
    var out = String(n);
    while (out.length < width) out = "0" + out;
    return out;
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + WEEK[d.getDay()];
  }

  function fmtShort(ts) {
    var d = new Date(ts);
    return d.getMonth() + 1 + "月" + d.getDate() + "日 " + WEEK[d.getDay()];
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    return pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2);
  }

  function fmtRange(start, end) {
    var s = new Date(start);
    var e = new Date(end);
    var sameDay = s.toDateString() === e.toDateString();
    if (sameDay) return fmtShort(start) + " " + fmtTime(start) + " 至 " + fmtTime(end);
    return fmtShort(start) + " " + fmtTime(start) + " 至 " + fmtShort(end) + " " + fmtTime(end);
  }

  function relTime(ts) {
    var diff = Date.now() - ts;
    var abs = Math.abs(diff);
    var suffix = diff >= 0 ? "前" : "后";
    if (abs < 60000) return "刚刚";
    if (abs < 3600000) return Math.round(abs / 60000) + " 分钟" + suffix;
    if (abs < 86400000) return Math.round(abs / 3600000) + " 小时" + suffix;
    if (abs < 2592000000) return Math.round(abs / 86400000) + " 天" + suffix;
    return fmtShort(ts);
  }

  function countdown(ts) {
    var diff = ts - Date.now();
    if (diff <= 0) return "已截止";
    var days = Math.floor(diff / 86400000);
    var hours = Math.floor((diff % 86400000) / 3600000);
    var minutes = Math.floor((diff % 3600000) / 60000);
    if (days > 0) return "剩 " + days + " 天 " + hours + " 小时";
    if (hours > 0) return "剩 " + hours + " 小时 " + minutes + " 分";
    return "剩 " + minutes + " 分钟";
  }

  function toneOf(tone) {
    return tone === "blue" ? "blue" : tone === "clay" ? "clay" : "jade";
  }

  function cover(activity, options) {
    var opts = options || {};
    var category = global.DB.categoryById(activity.categoryId);
    var tone = toneOf(activity.coverTone || category.tone);
    var d = new Date(activity.startAt);
    return (
      '<div class="cover cover-' + tone + (opts.compact ? " cover-compact" : "") + '" aria-hidden="true">' +
      '<span class="cover-mark">' + icon(category.icon) + "</span>" +
      '<span class="cover-day mono">' + (d.getMonth() + 1) + "月" + d.getDate() + "日</span>" +
      '<span class="cover-week">' + WEEK[d.getDay()] + " " + fmtTime(activity.startAt) + "</span>" +
      "</div>"
    );
  }

  function statusBadge(activity) {
    var s = global.DB.statusOf(activity);
    return '<span class="badge badge-' + s.tone + '">' + (s.tone === "accent" ? '<span class="dot"></span>' : "") + s.label + "</span>";
  }

  function toast(message, options) {
    var opts = options || {};
    var region = document.querySelector(".toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "toast-region";
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      document.body.appendChild(region);
    }
    var node = document.createElement("div");
    node.className = "toast" + (opts.tone === "warn" ? " is-warn" : "");
    node.innerHTML =
      icon(opts.tone === "warn" ? "warning-circle" : "check-circle") +
      '<div class="toast-body"><span class="body-5">' +
      esc(message) +
      "</span>" +
      (opts.hint ? '<span class="caption-2 toast-hint">' + esc(opts.hint) + "</span>" : "") +
      "</div>";
    region.appendChild(node);
    requestAnimationFrame(function () {
      node.classList.add("is-in");
    });
    setTimeout(function () {
      node.classList.remove("is-in");
      setTimeout(function () {
        node.remove();
      }, 300);
    }, opts.duration || 3600);
  }

  var openSheet = null;

  function sheet(config) {
    if (openSheet) openSheet.close();
    var backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true" aria-label="' +
      esc(config.title) +
      '">' +
      '<div class="sheet-head"><div class="stack" style="gap:var(--space-25)">' +
      '<h2 class="heading-6">' +
      esc(config.title) +
      "</h2>" +
      (config.subtitle ? '<p class="body-6 muted">' + esc(config.subtitle) + "</p>" : "") +
      "</div>" +
      '<button class="icon-btn" type="button" data-sheet-close aria-label="关闭">' +
      icon("x") +
      "</button></div>" +
      '<div class="sheet-body">' +
      (config.body || "") +
      "</div>" +
      (config.actions && config.actions.length
        ? '<div class="sheet-foot">' +
          config.actions
            .map(function (a, i) {
              return (
                '<button type="button" class="btn ' +
                (a.variant === "primary" ? "btn-primary" : a.variant === "danger" ? "btn-danger" : "btn-secondary") +
                ' button-sm" data-action-index="' +
                i +
                '">' +
                esc(a.label) +
                "</button>"
              );
            })
            .join("") +
          "</div>"
        : "") +
      "</div>";
    document.body.appendChild(backdrop);
    document.body.style.overflow = "hidden";

    function close() {
      backdrop.classList.remove("is-in");
      document.body.style.overflow = "";
      setTimeout(function () {
        backdrop.remove();
      }, 260);
      document.removeEventListener("keydown", onKey);
      openSheet = null;
    }

    function onKey(event) {
      if (event.key === "Escape") close();
    }

    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) close();
    });
    backdrop.querySelectorAll("[data-sheet-close]").forEach(function (btn) {
      btn.addEventListener("click", close);
    });
    (config.actions || []).forEach(function (a, i) {
      var btn = backdrop.querySelector('[data-action-index="' + i + '"]');
      if (btn) {
        btn.addEventListener("click", function () {
          if (typeof a.onClick === "function") {
            var result = a.onClick(backdrop, close);
            if (result !== false) close();
          } else {
            close();
          }
        });
      }
    });

    requestAnimationFrame(function () {
      backdrop.classList.add("is-in");
    });

    openSheet = { el: backdrop, close: close };
    if (typeof config.onMount === "function") config.onMount(backdrop, close);
    return openSheet;
  }

  function confirm(config) {
    return new Promise(function (resolve) {
      sheet({
        title: config.title,
        subtitle: config.subtitle,
        body: '<p class="body-3">' + esc(config.body || "") + "</p>",
        actions: [
          { label: config.cancelText || "再想想", variant: "secondary", onClick: function () { resolve(false); } },
          {
            label: config.confirmText || "确认",
            variant: config.danger ? "danger" : "primary",
            onClick: function () { resolve(true); }
          }
        ]
      });
    });
  }

  function empty(config) {
    return (
      '<div class="empty">' +
      '<span class="empty-mark">' + icon(config.icon || "calendar-blank") + "</span>" +
      '<p class="title-2">' + esc(config.title) + "</p>" +
      (config.body ? '<p class="body-6 muted" style="max-width:340px">' + esc(config.body) + "</p>" : "") +
      (config.action || "") +
      "</div>"
    );
  }

  function download(filename, content, mime) {
    var blob = new Blob(["\ufeff" + content], { type: mime || "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    return Promise.resolve();
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(self, args);
      }, wait || 200);
    };
  }

  function query(name) {
    var params = new URLSearchParams(location.search);
    return params.get(name);
  }

  function lines(text) {
    return String(text || "")
      .split("\n")
      .filter(function (l) { return l.trim(); });
  }

  global.UI = {
    WEEK: WEEK,
    esc: esc,
    icon: icon,
    fmtDate: fmtDate,
    fmtShort: fmtShort,
    fmtTime: fmtTime,
    fmtRange: fmtRange,
    relTime: relTime,
    countdown: countdown,
    cover: cover,
    statusBadge: statusBadge,
    toast: toast,
    sheet: sheet,
    confirm: confirm,
    empty: empty,
    download: download,
    copy: copy,
    debounce: debounce,
    query: query,
    lines: lines,
    pad: pad
  };
})(window);
