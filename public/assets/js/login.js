/* ==========================================================================
   登录页：账号密码登录、错误提示、密码可见切换
   ========================================================================== */

(function (global) {
  "use strict";

  var DB = global.DB;

  var form = document.getElementById("authForm");
  var accountInput = document.getElementById("account");
  var passwordInput = document.getElementById("password");
  var errorBox = document.getElementById("authError");
  var errorText = document.getElementById("authErrorText");
  var submitBtn = document.getElementById("submitBtn");
  var submitLabel = document.getElementById("submitLabel");
  var toggle = document.getElementById("togglePassword");

  function showError(message) {
    errorText.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
  }

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitLabel.textContent = loading ? "正在登录…" : "登录";
  }

  var params = new URLSearchParams(global.location.search);
  if (params.get("expired")) showError("登录已过期，请重新登录。");
  if (params.get("logout")) showError("已退出登录。");

  // 已经登录就直接进入工作台
  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .then(function (data) {
      if (data && data.user && !params.get("expired")) {
        global.location.replace("app.html#/square");
      }
    })
    .catch(function () {
      /* 忽略 */
    });

  toggle.addEventListener("click", function () {
    var visible = passwordInput.type === "text";
    passwordInput.type = visible ? "password" : "text";
    toggle.setAttribute("aria-label", visible ? "显示密码" : "隐藏密码");
  });

  accountInput.addEventListener("input", clearError);
  passwordInput.addEventListener("input", clearError);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearError();

    var account = accountInput.value.trim();
    var password = passwordInput.value;
    if (!account) {
      showError("请输入学号或工号。");
      accountInput.focus();
      return;
    }
    if (!password) {
      showError("请输入密码。");
      passwordInput.focus();
      return;
    }

    setLoading(true);
    DB.login(account, password)
      .then(function () {
        global.location.replace("app.html#/square");
      })
      .catch(function (error) {
        setLoading(false);
        showError(error.message || "登录失败，请稍后重试。");
        passwordInput.select();
      });
  });
})(window);
