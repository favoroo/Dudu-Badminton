// ============================================================
// 首页排版回归 —— 防的是用户 2026-10-07 的真机现场图:
// 「手机上看这个底部的活动中心这一块,被挤到下面去了」。
//
// 这一屏从前把坐标全手拍在 main-menu.ts 里,而它是全站唯一跟着屏幕长宽比变的一屏
// (设计分辨率 FIXED_HEIGHT:高恒 540、宽随长宽比涨)。拍的那排是 960 那一版,于是:
//   · 竖向只剩两道 5 单位的缝(色块阵底 -216 → 横幅顶 -221、横幅底 -265 → 屏底 -270),
//     在 20:9 的机器上就是「横幅贴着屏幕最下沿」,圆角 + 手势条一压读起来像被切了一半;
//   · 横向 915 宽的一排在 1200 可视区里两侧各空 140,整屏看着沉在中间。
// 排版已经搬进 assets/scripts/ui/menu-layout.ts(纯函数),这里对**逐档长宽比**断言:
//   ① 块与块、块内件与件互不压;
//   ② 块不出可视区、块内件不出块缘;
//   ③ 三道竖向缝(屏底留白 / 阵↔横幅 / 标题↔阵)各自 >= 常量,且 16:9 恒等旧版;
//   ④ 真文案量得进格子(含「今日 3/3 · 每周 4/4」那支动态副行);
//   ⑤ 整块即按钮的入口高 >= 触控下限 44;
//   ⑥ 源码事实:main-menu 只照版式摆,旧的手拍坐标不许回来。
// 另带 --selftest:拿五份畸形排版当反例,断言它们**会**被报警 —— 规则脚本最怕悄悄全绿。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/menu-check.js [--selftest]
// ============================================================
import { readFileSync } from "fs";
import { makeChecker } from "./harness";
import {
  BASE_HALF, BANNER_SUB_CLAIMABLE, MENU, MENU_TEXT, layoutMenu, menuFit,
  menuOverflow, menuOverlaps, menuTextFits, menuTouchFits, top, bottom, width,
  type MenuLayout,
} from "../assets/scripts/ui/menu-layout";

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

/** 逐档长宽比:16:9 是设计基准,20:9 是用户那台红米(1080×2400),21:9 封顶档 */
const SCREENS: Array<{ tag: string; visW: number; safeX?: number; safeBottom?: number }> = [
  { tag: "16:9 · 960", visW: 960 },
  { tag: "16:9 刘海 · 960", visW: 960, safeX: 60 },
  { tag: "18:9 · 1080", visW: 1080 },
  { tag: "20:9 · 1200(现场机)", visW: 1200 },
  { tag: "21:9 · 1260", visW: 1260 },
  { tag: "16:9 屏底安全区 · 960", visW: 960, safeBottom: 24 },
  { tag: "20:9 双安全区 · 1200", visW: 1200, safeX: 60, safeBottom: 24 },
  // 拉伸系数的**下限**那一头:比 16:9 还窄(分屏小窗 / 带大刘海的窄屏),f 撞到 fitMin
  { tag: "分屏窄窗 · 880 带刘海", visW: 880, safeX: 70 },
];
/** 已知到顶:再窄(fitMin 也装不下)就与全站 880 宽的面板同一处短板,不在这一屏另开一套 */

console.log("首页:五块色块 + 底部活动横幅 —— 逐档长宽比不压字、不出屏、缝不塌\n");

// ---------- ① ~ ⑤ 逐档断言 ----------
for (const s of SCREENS) {
  const L = layoutMenu({ visW: s.visW, safeX: s.safeX, safeBottom: s.safeBottom });
  const ov = menuOverlaps(L), of = menuOverflow(L);
  const tf = [...menuTextFits(L), ...menuTextFits(L, BANNER_SUB_CLAIMABLE)];
  const tc = menuTouchFits(L);
  ok(ov.length === 0, `${s.tag}:不压字${ov.length ? ` → ${ov.join(" / ")}` : ""}`);
  ok(of.length === 0, `${s.tag}:不溢出${of.length ? ` → ${of.join(" / ")}` : ""}`);
  ok(tf.length === 0, `${s.tag}:文案量得进格子${tf.length ? ` → ${tf.join(" / ")}` : ""}`);
  ok(tc.length === 0, `${s.tag}:入口高度够拇指${tc.length ? ` → ${tc.join(" / ")}` : ""}`);
  console.log(`      ${s.tag} → 拉伸 ${L.f.toFixed(3)} · 内容 ${width(L.banner.outer).toFixed(0)} 宽 · `
    + `行高 ${L.entries[0].outer.h.toFixed(1)} · 横幅底 ${bottom(L.banner.outer).toFixed(1)} · 屏底留白 ${L.margin.bottom.toFixed(1)}`);
}

// ---------- ③ 竖向节奏:现场图那一刀的两把尺 ----------
const base = layoutMenu({ visW: 960 });
const wide = layoutMenu({ visW: 1200 });
const gapScreen = base.margin.bottom;
const gapGridBanner = bottom(base.hero.outer) - top(base.banner.outer);
ok(gapScreen >= MENU.bottomMargin, `屏底留白 ${gapScreen} >= ${MENU.bottomMargin}(旧版 = 5,横幅贴到屏幕最下沿)`);
ok(gapGridBanner >= MENU.gapBanner, `色块阵与横幅的缝 ${gapGridBanner.toFixed(1)} >= ${MENU.gapBanner}(旧版 = 5)`);
ok(base.margin.bottom - MENU.bottomMargin < 1, `留白就是常量那一刀,没被别处偷偷加高`);

// ---------- ③b 横向:16:9 恒等旧版,宽屏真的用起来了 ----------
ok(base.f === 1, `16:9 拉伸系数 = 1(${base.f})⇒ 与改版前那一排逐像素相同`);
ok(Math.abs(width(base.banner.outer) - 915) < 1, `16:9 内容宽 ${width(base.banner.outer)} = 旧版 915`);
ok(Math.abs(BASE_HALF * 2 - 915) < 0.01, `基准半宽 ${BASE_HALF} 对得上旧版那一排`);
ok(wide.f > 1.15 && wide.f <= MENU.fitMax, `20:9 拉伸系数 ${wide.f.toFixed(3)} 用掉宽屏余量(封顶 ${MENU.fitMax})`);
ok(width(wide.banner.outer) > width(base.banner.outer) * 1.15, `20:9 横幅跟着变宽 ${width(wide.banner.outer).toFixed(0)}`);
ok(menuFit(1400, 14) === MENU.fitMax, `超宽屏(1400)封在 ${MENU.fitMax},不无限摊大`);
ok(menuFit(960, 60) < 1, `刘海机收到 ${menuFit(960, 60).toFixed(3)},内容不被刘海啃掉半块`);
const narrow = layoutMenu({ visW: 880, safeX: 70 });
ok(narrow.f === MENU.fitMin, `窄窗 880 撞在拉伸下限 ${MENU.fitMin}(再窄就与全站 880 宽面板同一处短板,不在这屏另开一套)`);

// ---------- ③c 横幅与五块同宽同轴(它是那一排的收尾条,不是另起一块) ----------
for (const L of [base, wide]) {
  ok(Math.abs(L.banner.outer.left - L.hero.outer.left) < 0.51, `横幅左缘对齐 hero 左缘(${L.visW})`);
  const last = L.entries[3];
  ok(Math.abs(L.banner.outer.right - last.outer.right) < 0.51, `横幅右缘对齐生涯块右缘(${L.visW})`);
}

// ---------- ⑥ 源码事实:坐标只许从版式模块出 ----------
const src = readFileSync("assets/scripts/ui/main-menu.ts", "utf8");
ok(/from "\.\/menu-layout"/.test(src), "main-menu 读 menu-layout 的坐标");
const stale = [
  ["-243", "横幅旧行心(屏底只剩 5)"],
  ["316, 330", "hero 旧尺寸"],
  ["282, 150", "小块旧尺寸"],
  ["915, 44", "横幅旧尺寸"],
  ["-298", "hero 旧 x"],
  ["318, -138", "生涯块旧坐标"],
  ["372, 74", "标题衬底旧尺寸"],
  ["-81, 190", "标题大字旧坐标"],
  ["完成任务领金币", "横幅副行旧字面量(格式已收进 bannerSubClaimable)"],
];
for (const [lit, why] of stale) {
  ok(!src.includes(lit), `旧手拍坐标/文案 ${lit} 不再出现:${why}`);
}
// 五块与横幅那一段:摆位只许走 bind/txt,不许再出现字面量坐标
// (锚点用**带破折号的段标题**与段尾注释:光「五块实底大色块」在文件头注释里也出现一次)
const band = src.slice(src.indexOf("// ---------- 街机海报标题"), src.indexOf("版本号与「检查更新」不再占首页底部"));
ok(band.length > 800, `扫得到「标题 + 五块 + 横幅」那一段(锚点没漂,实长 ${band.length})`);
ok(!/setPosition\(\s*-?\d+(\.\d+)?\s*,/.test(band), "那一段里没有字面量 setPosition 坐标(全部走版式)");
ok(/bannerSubClaimable\(/.test(src), "横幅「有可领」那一支的格式只有一个出口");

// ---------- ⑦ 屏底安全区变大时:整阵变矮,而不是把横幅顶出屏外 ----------
const inset = layoutMenu({ visW: 960, safeBottom: 24 });
ok(inset.entries[0].outer.h < base.entries[0].outer.h, `屏底安全区 24 ⇒ 行高 ${base.entries[0].outer.h} → ${inset.entries[0].outer.h.toFixed(1)}(让位的是阵,不是留白)`);
ok(inset.margin.bottom >= MENU.bottomMargin + 24 - 0.01, `让位后屏底留白仍 >= ${MENU.bottomMargin} + 安全区`);
ok(inset.entries[0].outer.h >= MENU.rowHMin, `行高收得住,不低于下限 ${MENU.rowHMin}`);

if (process.argv.includes("--selftest")) {
  console.log("\n反例(必须被拦住):");
  const clone = (): MenuLayout => JSON.parse(JSON.stringify(base)) as MenuLayout;
  const cases: Array<[string, MenuLayout, (o: string[]) => boolean]> = [
    // (a) 旧版横幅行心:屏底只剩 5
    ["横幅贴回屏底(旧 -243)", (() => { const L = clone(); L.banner.outer.cy = -243; return L; })(),
      (o) => o.some((s) => s.includes("贴屏底"))],
    // (b) 旧版 hero 高度:整阵顶穿标题那一缝
    ["色块阵长回 330(旧值)", (() => { const L = clone(); L.hero.outer.h = 330; L.hero.outer.cy += 4.5; return L; })(),
      (o) => o.some((s) => s.includes("标题与色块阵的缝"))],
    // (c) 横幅与色块阵的缝塌回 5
    ["阵↔横幅缝塌回 5", (() => { const L = clone(); L.banner.outer.cy += 13; return L; })(),
      (o) => o.some((s) => s.includes("色块阵与横幅的缝"))],
    // (d) 副行格子被压窄:真文案出格(压到可领角签上)
    ["横幅副行格子变窄", (() => { const L = clone(); L.banner.line!.left = L.banner.line!.right - 60; return L; })(),
      (o) => o.some((s) => s.includes("副行放不下"))],
    // (e) 小块名称越出块缘
    ["名称探出小块右缘", (() => { const L = clone(); L.entries[3].name.right += 90; return L; })(),
      (o) => o.some((s) => s.includes("越出块左右缘") || s.includes("名称压住箭标"))],
    // (f) 触控下限:横幅矮到 40
    ["横幅矮到 40", (() => { const L = clone(); L.banner.outer.h = 40; return L; })(),
      (o) => o.some((s) => s.includes("不足触控下限"))],
  ];
  for (const [tag, L, want] of cases) {
    const out = [...menuOverlaps(L), ...menuOverflow(L), ...menuTextFits(L), ...menuTextFits(L, BANNER_SUB_CLAIMABLE), ...menuTouchFits(L)];
    ok(want(out), `${tag} → 被报警${out.length ? `(${out[0]})` : "(无输出!判据失效)"}`);
  }
}

console.log(`\n${h.fails === 0 ? "✓ 首页排版全绿" : `✗ 首页排版失败 ${h.fails} 条`}(共 ${h.checks} 项)`);
process.exit(h.fails === 0 ? 0 : 1);
