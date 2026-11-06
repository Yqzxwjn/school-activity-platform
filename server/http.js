/* ==========================================================================
   HTTP 工具：JSON 响应、Cookie、请求体、静态文件
   ========================================================================== */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8"
};

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function fail(res, status, message, extra) {
  sendJson(res, status, Object.assign({ error: message }, extra || {}));
}

function readJson(req, limit) {
  const max = limit || 512 * 1024;
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(Object.assign(new Error("请求内容过大"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(Object.assign(new Error("请求内容不是合法的 JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index === -1) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch (error) {
      out[key] = value;
    }
  });
  return out;
}

function setCookie(res, name, value, options) {
  const opts = options || {};
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
  if (opts.expires) parts.push(`Expires=${new Date(opts.expires).toUTCString()}`);
  if (opts.secure) parts.push("Secure");
  const existing = res.getHeader("Set-Cookie");
  const cookie = parts.join("; ");
  if (existing) {
    res.setHeader("Set-Cookie", [].concat(existing, cookie));
  } else {
    res.setHeader("Set-Cookie", cookie);
  }
}

function clearCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* --------------------------------------------------------------------------
   静态文件
   -------------------------------------------------------------------------- */

function serveStatic(root, req, res, pathname) {
  const clean = decodeURIComponent(pathname.split("?")[0]);
  let relative = clean === "/" ? "/index.html" : clean;
  const filePath = path.normalize(path.join(root, relative));
  if (!filePath.startsWith(path.normalize(root))) {
    fail(res, 403, "禁止访问");
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      const notFound = path.join(root, "404.html");
      fs.readFile(notFound, (notFoundError, html) => {
        if (notFoundError) {
          fail(res, 404, "页面不存在");
          return;
        }
        res.writeHead(404, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
        res.end(html);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    const headers = {
      "Content-Type": mime,
      "Content-Length": stat.size,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    };
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    if (ext === ".html" || ext === ".css" || ext === ".js" || ext === ".json" || ext === ".svg") {
      res.end(fs.readFileSync(filePath));
    } else {
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

module.exports = {
  securityHeaders,
  sendJson,
  fail,
  readJson,
  parseCookies,
  setCookie,
  clearCookie,
  serveStatic,
  MIME
};
