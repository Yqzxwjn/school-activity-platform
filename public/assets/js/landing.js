/* ==========================================================================
   Public site behaviour: mobile menu, scroll reveals, word by word tagline
   ========================================================================== */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------------- menu */
  var toggle = document.getElementById("navToggle");
  var menu = document.getElementById("mobileMenu");

  function setMenu(open) {
    if (!toggle || !menu) return;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
    menu.setAttribute("aria-hidden", String(!open));
    menu.classList.toggle("is-open", open);
    document.body.style.overflow = open ? "hidden" : "";
    menu.querySelectorAll("a").forEach(function (link, index) {
      link.style.transitionDelay = open ? Math.min(index * 60, 400) + "ms" : "0ms";
    });
  }

  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      setMenu(toggle.getAttribute("aria-expanded") !== "true");
    });
    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        setMenu(false);
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && menu.classList.contains("is-open")) {
        setMenu(false);
        toggle.focus();
      }
    });
  }

  /* ------------------------------------------------------------- reveal */
  var revealItems = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    revealItems.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    revealItems.forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  /* ------------------------------------------- tagline word by word reveal */
  var tagline = document.querySelector("[data-word-reveal]");

  function splitLine(line) {
    var text = line.textContent.trim();
    line.textContent = "";
    var fragment = document.createDocumentFragment();
    var punctuation = /[，。、：；！？）」』]/;

    Array.prototype.forEach.call(text, function (ch) {
      if (punctuation.test(ch) && fragment.lastChild) {
        fragment.lastChild.textContent += ch;
        return;
      }
      var span = document.createElement("span");
      span.className = "tagline-word";
      span.textContent = ch;
      fragment.appendChild(span);
    });

    line.appendChild(fragment);
  }

  if (tagline) {
    tagline.querySelectorAll("[data-line]").forEach(splitLine);
    var words = tagline.querySelectorAll(".tagline-word");

    if ("IntersectionObserver" in window && !reduceMotion) {
      var wordObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-lit");
              wordObserver.unobserve(entry.target);
            }
          });
        },
        { rootMargin: "0px 0px -32% 0px", threshold: 0 }
      );
      words.forEach(function (word) {
        wordObserver.observe(word);
      });
    } else {
      words.forEach(function (word) {
        word.classList.add("is-lit");
      });
    }
  }

  /* --------------------------------------------------- current nav link */
  var navLinks = document.querySelectorAll(".nav-link");
  var sections = [];

  navLinks.forEach(function (link) {
    var target = document.querySelector(link.getAttribute("href"));
    if (target) sections.push({ link: link, target: target });
  });

  if ("IntersectionObserver" in window && sections.length) {
    var sectionObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          sections.forEach(function (item) {
            item.link.classList.toggle("is-current", item.target === entry.target);
          });
        });
      },
      { threshold: 0.2, rootMargin: "-20% 0px -60% 0px" }
    );
    sections.forEach(function (item) {
      sectionObserver.observe(item.target);
    });
  }
})();
