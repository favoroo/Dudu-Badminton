/* ============================================================
   介绍站交互层 —— 无框架 IIFE,只做四件事:
     ① 从 window.GAME_DATA 渲染列表(玩法/难度/技能/皮肤/球馆/手势)
     ② 导航指示带借看与分区高亮
     ③ 滚动入场(静态值即终态:JS 不跑页面也完整可读)
     ④ 数据带数字滚动
   所有内容都在 HTML 里有兜底文字,JS 挂了页面只是少了动效,不是空白页。
   ============================================================ */
(function () {
  "use strict";

  var D = window.GAME_DATA;
  if (!D) return;

  /* ---------- 小工具 ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** 稀有度 → 色。config 的 RARITY_META 是唯一真话,网页不另抄一份色表 */
  function rarityColor(key) {
    var m = D.rarity && D.rarity[key];
    return (m && m.color) || "#8a93a8";
  }
  function rarityName(key) {
    var m = D.rarity && D.rarity[key];
    return (m && m.name) || "经典";
  }

  /* ---------- 版本号 ---------- */

  $$("[data-version]").forEach(function (n) {
    if (D.versionName) n.textContent = D.versionName;
  });

  /* ---------- 玩法:五块大色块 ---------- */

  var ROLE_COLOR = {
    primary: { bg: "var(--c-slash)", ink: "var(--c-paper)" },
    star: { bg: "var(--c-acid)", ink: "var(--c-ink)" },
    drill: { bg: "var(--c-good)", ink: "var(--c-ink)" },
    info: { bg: "var(--c-cyan)", ink: "var(--c-ink)" },
    record: { bg: "var(--c-paper)", ink: "var(--c-ink)" }
  };

  (function renderModes() {
    var box = $("[data-modes]");
    if (!box || !D.modes) return;
    box.textContent = "";
    D.modes.forEach(function (m) {
      var c = ROLE_COLOR[m.role] || ROLE_COLOR.record;
      var card = el("article", "mode");
      card.style.setProperty("--mc", c.bg);
      card.style.setProperty("--mc-ink", c.ink);
      card.appendChild(el("span", "mode-tag", m.tag));
      card.appendChild(el("h3", "mode-name", m.name));
      card.appendChild(el("p", "mode-line", m.line));
      card.appendChild(el("p", "mode-body", m.body));
      card.appendChild(el("span", "mode-chev", "→"));
      box.appendChild(card);
    });
  })();

  /* ---------- 难度表 ---------- */

  (function renderDiffs() {
    var box = $("[data-diffs]");
    if (!box || !D.diffs) return;
    box.textContent = "";
    D.diffs.forEach(function (d) {
      var li = el("li", "diff");
      li.style.setProperty("--da", d.accent);
      li.appendChild(el("span", "diff-name", d.name));
      li.appendChild(el("span", "diff-tag", d.tag));
      li.appendChild(el("span", "diff-desc", d.desc));
      box.appendChild(li);
    });
  })();

  /* ---------- 数据带 ---------- */

  (function renderStats() {
    var box = $("[data-stats]");
    if (!box || !D.stats) return;
    box.textContent = "";
    D.stats.forEach(function (s) {
      var li = el("li");
      var b = el("b", null, String(s.n));
      b.setAttribute("data-count", String(s.n));
      li.appendChild(b);
      li.appendChild(el("i", null, s.unit));
      li.appendChild(el("span", null, s.label));
      box.appendChild(li);
    });
  })();

  /** 数字滚动:从 0 数到目标值,ease-out。prefers-reduced-motion 下直接落终值 */
  function countUp() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var nodes = $$("[data-count]");
    if (!nodes.length) return;
    var DUR = 620;
    nodes.forEach(function (n) {
      var target = parseInt(n.getAttribute("data-count"), 10) || 0;
      var t0 = 0;
      n.textContent = "0";
      function tick(ts) {
        if (!t0) t0 = ts;
        var p = Math.min(1, (ts - t0) / DUR);
        var eased = 1 - Math.pow(1 - p, 3);
        n.textContent = String(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(tick);
        else n.textContent = String(target);
      }
      requestAnimationFrame(tick);
    });
  }

  /* ---------- 技能 ---------- */

  (function renderSkills() {
    var list = $("[data-skills]");
    if (!list || !D.skills) return;
    list.textContent = "";

    var shot = $("[data-skill-shot]");
    var frames = $("[data-skill-frames]");
    var shotTag = $("[data-skill-shot-tag]");
    var nm = $("[data-skill-name]");
    var desc = $("[data-skill-desc]");
    var cd = $("[data-skill-cd]");
    var lv = $("[data-skill-lv]");
    var tag = $("[data-skill-tag]");

    var buttons = [];
    var FRAME_LABEL = ["起手", "位移", "兑现", "收招"];

    function select(i) {
      var s = D.skills[i];
      if (!s) return;
      buttons.forEach(function (b, j) {
        b.classList.toggle("on", i === j);
        b.setAttribute("aria-selected", i === j ? "true" : "false");
      });
      if (shot) shot.style.setProperty("--sa", s.accent);
      if (frames) {
        frames.textContent = "";
        FRAME_LABEL.forEach(function (label, k) {
          var cell = el("div", "skill-frame");
          var img = el("img");
          img.src = "img/skill/" + s.id + "-" + (k + 1) + ".svg";
          img.alt = s.name + " 第 " + (k + 1) + " 帧：" + label;
          img.loading = "eager";
          cell.appendChild(img);
          cell.appendChild(el("span", "skill-frame-n", label));
          frames.appendChild(cell);
        });
      }
      if (shotTag) shotTag.textContent = s.name;
      if (nm) nm.textContent = s.name;
      if (desc) desc.textContent = s.desc;
      if (cd) cd.textContent = (s.cd / 60).toFixed(1);
      if (lv) lv.textContent = "Lv." + s.unlock;
      if (tag) tag.textContent = s.tag;
    }

    D.skills.forEach(function (s, i) {
      var b = el("button", "skill-item");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.style.setProperty("--sa", s.accent);
      var dot = el("span", "skill-dot");
      b.appendChild(dot);
      b.appendChild(el("span", "skill-nm", s.name));
      b.appendChild(el("span", "skill-lv", "Lv." + s.unlock));
      b.addEventListener("click", function () { select(i); });
      list.appendChild(b);
      buttons.push(b);
    });

    // 默认选中「闪现扣杀」(空中折跃那一款观感最强);找不到就退回第一个
    var start = 0;
    D.skills.forEach(function (s, i) { if (s.id === "flash") start = i; });
    select(start);
  })();

  /* ---------- 皮肤 ---------- */

  (function renderSkins() {
    var bar = $("[data-skinbar]");
    var grid = $("[data-skins]");
    if (!grid || !D.skins) return;

    var tabs = D.skins.tabs || [];
    var current = "player";
    var buttons = [];

    function card(skin) {
      var c = el("article", "skin");
      c.style.setProperty("--ra", rarityColor(skin.rarity));
      c.style.setProperty("--sc", skin.color || "#8a93a8");

      var art = el("div", "skin-art");
      if (skin.art) {
        var img = el("img");
        img.src = skin.art;
        img.alt = skin.name;
        img.loading = "eager";
        img.width = 300;
        img.height = 430;
        art.appendChild(img);
      } else {
        art.classList.add("none");
      }
      c.appendChild(art);

      c.appendChild(el("h3", "skin-nm", skin.name));

      var meta = el("p", "skin-meta");
      meta.appendChild(el("span", "skin-rar", rarityName(skin.rarity)));
      meta.appendChild(el("span", null, skin.price === 0 ? "默认" : skin.price + " 金币"));
      c.appendChild(meta);

      if (skin.unlock > 0) {
        var lock = el("span", "skin-lock", "Lv." + skin.unlock);
        c.appendChild(lock);
      }
      return c;
    }

    function paint(key) {
      current = key;
      buttons.forEach(function (b) {
        b.classList.toggle("on", b.getAttribute("data-key") === key);
      });
      grid.textContent = "";
      if (key === "player") {
        grid.classList.add("skins-player");
        (D.skins.player || []).forEach(function (s) { grid.appendChild(card(s)); });
        return;
      }
      // 球拍/羽毛球/脸面只有数量,没有出图 —— 用一组信息签交代清楚,不硬凑图
      grid.classList.remove("skins-player");
      grid.textContent = "";
      var tab = null;
      tabs.forEach(function (t) { if (t.key === key) tab = t; });
      var info = el("div", "skin-summary");
      var h = el("h3", null, (tab ? tab.label : "") + " · " + (tab ? tab.count : 0) + " 款");
      info.appendChild(h);
      var p = el("p", null, SUMMARY[key] || "");
      info.appendChild(p);
      var list = el("ul", "skin-summary-list");
      (SUMMARY_ITEMS[key] || []).forEach(function (t) {
        var li = el("li", null, t);
        list.appendChild(li);
      });
      info.appendChild(list);
      grid.appendChild(info);
    }

    var SUMMARY = {
      racket: "八款球拍，从免费的标准拍到传说的虹光拍。拍框、拍杆、拍线配色逐款不同，挥拍时的拖影特效也跟着换。",
      shuttle: "八款羽毛球，各有独立的裙羽配色与飞行拖尾（星轨、火焰、花瓣、虹光）。纯装饰，不影响任何物理。",
      face: "九款脸面，含免费的普通肤色、经典墨面与「跟随人物」。付费款走肤色特征：雀斑、泪痣、猫须、白眉。"
    };
    var SUMMARY_ITEMS = {
      racket: ["标准拍 · 免费", "碳黑拍 / 翡翠拍 / 玫瑰金拍 · 88 金币", "星辉拍 · 稀有", "炽焰拍 / 冰晶拍 · 史诗", "虹光拍 · 传说"],
      shuttle: ["标准球 · 免费", "荧光球 / 冰晶球 / 樱羽球 · 88 金币", "彗星羽 · 稀有", "凤凰羽 / 花语羽 · 史诗", "星河羽 · 传说"],
      face: ["普通肤色 / 经典墨面 / 跟随人物 · 免费", "纯黑无面 / 纯白无面 · 88 金币", "雀斑肤色 / 泪痣肤色 · 88 金币", "猫系脸面 / 宗师脸面 · 168 金币"]
    };

    if (bar) {
      bar.textContent = "";
      tabs.forEach(function (t) {
        var b = el("button", "skinbar-btn");
        b.type = "button";
        b.setAttribute("data-key", t.key);
        var span = el("span", null, t.label);
        b.appendChild(span);
        b.appendChild(el("i", null, String(t.count)));
        b.addEventListener("click", function () { paint(t.key); });
        bar.appendChild(b);
        buttons.push(b);
      });
    }

    paint(current);
  })();

  /* ---------- 球馆 ---------- */

  (function renderCourts() {
    var box = $("[data-courts]");
    if (!box || !D.courts) return;
    box.textContent = "";
    D.courts.forEach(function (c) {
      var a = el("article", "court");
      a.style.setProperty("--ca", c.accent);

      var img = el("img");
      img.src = "img/court/" + c.id + ".png";
      img.alt = c.title + "球场";
      img.loading = "eager";
      img.width = 1480;
      img.height = 720;
      a.appendChild(img);

      var body = el("div", "court-body");
      body.appendChild(el("span", "court-tag", c.tag));
      body.appendChild(el("h3", "court-nm", c.name));
      body.appendChild(el("p", "court-sub", c.sub));
      body.appendChild(el("p", "court-desc", c.desc));
      a.appendChild(body);
      box.appendChild(a);
    });
  })();

  /* ---------- 手势 ---------- */

  (function renderGestures() {
    var box = $("[data-gestures]");
    if (!box || !D.gestures) return;
    box.textContent = "";
    D.gestures.forEach(function (g) {
      var li = el("li");
      li.appendChild(el("span", "g-dir", g.dir));
      li.appendChild(el("span", "g-nm", g.name));
      li.appendChild(el("span", "g-desc", g.desc));
      box.appendChild(li);
    });
  })();

  /* ---------- 图片放大窗 ---------- */

  (function lightbox() {
    var box = $("[data-lightbox]");
    var zoomables = $$("[data-zoom]");
    if (!box || !zoomables.length) return;
    var img = $("img", box);
    var closeBtn = $(".lightbox-close", box);

    function open(src, alt) {
      img.src = src;
      img.alt = alt || "";
      box.hidden = false;
      document.body.style.overflow = "hidden";
      if (closeBtn) closeBtn.focus();
    }
    function close() {
      box.hidden = true;
      img.removeAttribute("src");
      document.body.style.overflow = "";
    }

    zoomables.forEach(function (b) {
      b.addEventListener("click", function () {
        open(b.getAttribute("data-zoom"), b.getAttribute("data-zoom-alt"));
      });
    });
    box.addEventListener("click", function (e) {
      // 点图本身也关:放大后图可能超出视口,再点一次是最自然的退出
      if (e.target === box || e.target === img || e.target === closeBtn) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !box.hidden) close();
    });
  })();

  /* ---------- 导航指示带 ---------- */

  (function navInd() {
    var nav = $(".nav");
    var ind = $(".nav-ind");
    if (!nav || !ind) return;
    var links = $$("a", nav);
    var sections = links.map(function (a) {
      var id = a.getAttribute("href").slice(1);
      return document.getElementById(id);
    });
    var active = links[0];

    function moveTo(a) {
      if (!a) { ind.style.width = "0"; return; }
      ind.style.left = a.offsetLeft + "px";
      ind.style.width = a.offsetWidth + "px";
    }

    function setActive(a) {
      if (a === active) return;
      active = a;
      links.forEach(function (x) { x.classList.toggle("on", x === a); });
      moveTo(a);
    }

    links.forEach(function (a) {
      a.addEventListener("mouseenter", function () { moveTo(a); });
      a.addEventListener("focus", function () { moveTo(a); });
    });
    nav.addEventListener("mouseleave", function () { moveTo(active); });

    function onScroll() {
      var y = window.scrollY + 120;
      var best = null;
      sections.forEach(function (s, i) {
        if (s && s.offsetTop <= y) best = links[i];
      });
      setActive(best || links[0]);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () { moveTo(active); });
    onScroll();
    moveTo(active);
  })();

  /* ---------- 滚动入场 ---------- */

  (function reveal() {
    var targets = $$(".sec-head, .modes, .difftable, .skills, .skinbar, .skins, .skin-note, .courts, .controls, .getgrid, .faq");
    if (!targets.length) return;

    if (!("IntersectionObserver" in window)) {
      targets.forEach(countUpSoon);
      countUp();
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("on");
        if (e.target.classList.contains("modes")) countUp();
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

    targets.forEach(function (t) {
      // 只给「此刻还在首屏下方」的块挂 rv;已经在视口里的块直接是终态
      if (t.getBoundingClientRect().top > window.innerHeight * 0.9) {
        t.classList.add("rv");
      }
      io.observe(t);
    });

    // 兜底:1.2s / 4s 各扫一次,防止 IO 在某些 WebView 里不回调
    [1200, 4000].forEach(function (ms) {
      setTimeout(function () {
        targets.forEach(function (t) {
          if (t.classList.contains("rv") && !t.classList.contains("on")) {
            t.classList.add("on");
          }
        });
      }, ms);
    });
  })();

  function countUpSoon() { /* 占位:无 IO 时数字已由 countUp 处理 */ }

})();
