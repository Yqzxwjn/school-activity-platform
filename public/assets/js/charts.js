/* ==========================================================================
   Lightweight SVG charts (no external libraries)
   ========================================================================== */

(function (global) {
  "use strict";

  var Charts = {};

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  Charts.line = function (data, options) {
    var opts = options || {};
    var width = 640;
    var height = 240;
    var pad = { top: 24, right: 16, bottom: 32, left: 36 };
    var innerW = width - pad.left - pad.right;
    var innerH = height - pad.top - pad.bottom;
    var max = Math.max.apply(null, data.map(function (item) { return item.value; }).concat([1]));
    max = Math.ceil(max / 20) * 20;
    var step = data.length > 1 ? innerW / (data.length - 1) : innerW;

    var points = data.map(function (item, index) {
      return {
        x: pad.left + step * index,
        y: pad.top + innerH - (item.value / max) * innerH,
        value: item.value,
        label: item.label
      };
    });

    var line = points
      .map(function (point, index) {
        return (index === 0 ? "M" : "L") + point.x.toFixed(1) + " " + point.y.toFixed(1);
      })
      .join(" ");

    var area = line + " L" + points[points.length - 1].x.toFixed(1) + " " + (pad.top + innerH) + " L" + points[0].x.toFixed(1) + " " + (pad.top + innerH) + " Z";

    var grid = "";
    for (var i = 0; i <= 4; i += 1) {
      var y = pad.top + (innerH / 4) * i;
      grid +=
        '<line x1="' + pad.left + '" y1="' + y + '" x2="' + (width - pad.right) + '" y2="' + y + '" stroke="#E5E3DA" stroke-width="1"/>' +
        '<text class="chart-axis" x="' + (pad.left - 8) + '" y="' + (y + 4) + '" text-anchor="end">' +
        Math.round(max - (max / 4) * i) +
        "</text>";
    }

    var dots = points
      .map(function (point) {
        return (
          '<circle cx="' + point.x + '" cy="' + point.y + '" r="3.5" fill="#0E6B4F" stroke="#FFFFFF" stroke-width="2"/>' +
          '<text class="chart-axis" x="' + point.x + '" y="' + (point.y - 12) + '" text-anchor="middle" fill="#17170F">' + point.value + "</text>"
        );
      })
      .join("");

    var labels = points
      .map(function (point) {
        return '<text class="chart-axis" x="' + point.x + '" y="' + (height - 8) + '" text-anchor="middle">' + esc(point.label) + "</text>";
      })
      .join("");

    return (
      '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + esc(opts.label || "趋势图") + '">' +
      grid +
      '<path d="' + area + '" fill="#0E6B4F" fill-opacity="0.08"/>' +
      '<path d="' + line + '" fill="none" stroke="#0E6B4F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      dots +
      labels +
      "</svg>"
    );
  };

  var DONUT_COLORS = ["#0E6B4F", "#A8541F", "#2B4C7E", "#8B8B80"];

  Charts.donut = function (data, options) {
    var opts = options || {};
    var total = data.reduce(function (sum, item) { return sum + item.value; }, 0) || 1;
    var radius = 52;
    var circumference = 2 * Math.PI * radius;
    var offset = 0;
    var segments = data
      .map(function (item, index) {
        var portion = item.value / total;
        var dash = portion * circumference;
        var segment =
          '<circle cx="80" cy="80" r="' + radius + '" fill="none" stroke="' + DONUT_COLORS[index % DONUT_COLORS.length] +
          '" stroke-width="16" stroke-dasharray="' + dash.toFixed(2) + " " + (circumference - dash).toFixed(2) +
          '" stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 80 80)"/>';
        offset += dash;
        return segment;
      })
      .join("");

    return (
      '<div class="row" style="gap:var(--space-300);align-items:center;flex-wrap:wrap">' +
      '<svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="' + esc(opts.label || "占比图") + '" style="flex:none">' +
      '<circle cx="80" cy="80" r="' + radius + '" fill="none" stroke="#F1EFE7" stroke-width="16"/>' +
      segments +
      '<text x="80" y="76" text-anchor="middle" font-size="22" font-weight="600" fill="#17170F">' + total + "</text>" +
      '<text x="80" y="96" text-anchor="middle" font-size="11" fill="#6F6F65">' + esc(opts.unit || "人次") + "</text>" +
      "</svg>" +
      '<div class="stack" style="gap:var(--space-75);flex:1;min-width:120px">' +
      data
        .map(function (item, index) {
          var percent = Math.round((item.value / total) * 100);
          return (
            '<div class="row" style="justify-content:space-between;gap:var(--space-100)">' +
            '<span class="legend-item caption-2"><span class="legend-swatch" style="background:' + DONUT_COLORS[index % DONUT_COLORS.length] + '"></span>' + esc(item.name) + "</span>" +
            '<span class="caption-1">' + item.value + " <span class=\"muted caption-5\">" + percent + "%</span></span>" +
            "</div>"
          );
        })
        .join("") +
      "</div></div>"
    );
  };

  Charts.bars = function (data) {
    var max = Math.max.apply(null, data.map(function (item) { return item.value; }).concat([1]));
    return (
      '<div class="stack" style="gap:var(--space-200)">' +
      data
        .map(function (item) {
          return (
            '<div class="bar-row">' +
            '<div class="bar-label caption-2"><span>' + esc(item.name) + "</span><span class=\"mono\">" + item.value + "</span></div>" +
            '<div class="progress progress-lg"><i style="width:' + Math.round((item.value / max) * 100) + '%"></i></div>' +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  };

  global.Charts = Charts;
})(window);
