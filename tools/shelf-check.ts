// ============================================================
// 商店货架几何回归 —— 防的是用户报的这条:「这个商店的商品列表要可以滑动查看」。
//
// 现象是角色皮肤页只能看到 8 款:12 款按 4 列排是 3 行,而网格窗只有 330 高(两行的量),
// 末行直接伸出面板底被屏幕下沿切掉 —— 不是「没做滚动」这么简单,是**排版与窗口高度对不上**,
// 手调绝对坐标迟早再撞一次(编辑器顶栏那次同理,见 tools/strip-check.ts)。
//
// 于是几何搬进 assets/scripts/ui/shop-shelf.ts(纯函数),这里断言五条:
//   1) 每一行都存在一个滚动位置能把它**完整**滚进窗内(revealRange 非空)——
//      这条就是上面那个现场的可执行化:末行露不全 = 货架白做;
//   2) 卡片块不顶破网格宽(gridCols 那句「6 列会顶破 520」的注释落成断言);
//   3) 静止在顶部时首行完整、且留着 padTop 那口气;静止在底部时末行完整、留着 padBot;
//   4) maxScroll == 0 只在「所有行本来就装得下」时成立 —— 否则该有滚动条却没有;
//   5) 滚动条滑块捏得住(≥34px)也不会比轨道还长,装得下时高度为 0(不画轨道);
//   6) 松手之后的运动学(惯性/回弹/定位)任何初态都在 5 秒内收进 [0, maxScroll],
//      不越界、不 NaN、速度只减不增 —— 猛甩一记必须真能从头滚到尾,不然「滑动查看」是假的。
// 商品款数直接读 CFG.skins,以后加/删皮肤不用改这里。
//
// 另带 --selftest:拿「改动前那套(窗只装两行、没有滚动)」当反例,确认它**会**被报警
// (规则脚本最怕悄悄全绿)。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/shelf-check.js
//   node .tools-build/tools/shelf-check.js --selftest
// ============================================================
import { CFG } from "../assets/scripts/core/config";
import { SkinKind } from "../assets/scripts/core/types";
import {
  FLING_MIN, SHELF, advanceScroll, gridCols, revealRange, rubberBand, rowTopY, shelfLayout, thumbHeight,
} from "../assets/scripts/ui/shop-shelf";

let fails = 0;
let checks = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) { fails++; console.log(`  ✗ ${msg}`); } else { console.log(`  ✓ ${msg}`); }
}

const S = SHELF;
const KINDS: SkinKind[] = ["player", "racket", "shuttle", "face"];
const KIND_NAME: Record<string, string> = {
  player: "角色皮肤", racket: "球拍皮肤", shuttle: "羽毛球皮肤", face: "面部皮肤",
};
/** 与 career-panel 的 BAR_PAD 同一个数(那边轨道 = 窗高 − 上下各 12) */
const BAR_PAD = 12;

console.log("商店货架:每行都滚得进来 / 不顶破网格 / 滚动条有得捏 / 松手收得住\n");

// ---------- ① 逐类商品:行数、能滚多远、每一行滚得进来 ----------
for (const kind of KINDS) {
  const n = (CFG.skins[kind] ?? []).length;
  const L = shelfLayout(n, S);
  const blockW = L.cols * S.cardW + (L.cols - 1) * S.gap;
  console.log(`\n[${KIND_NAME[kind]}] ${n} 款 → ${L.cols} 列 × ${L.rows} 行,货架 ${L.contentH} / 窗 ${S.h},maxScroll ${L.maxScroll}`);

  ok(n > 0, `${KIND_NAME[kind]}:货架非空`);
  ok(L.rows === Math.ceil(n / L.cols), `${KIND_NAME[kind]}:行数与款数自洽(${L.rows} 行装 ${n} 款)`);
  ok(blockW <= S.w, `${KIND_NAME[kind]}:卡片块 ${blockW} 顶不破网格宽 ${S.w}`);
  ok(S.cardH < S.h, `${KIND_NAME[kind]}:单卡高 ${S.cardH} 小于窗高 ${S.h},否则任何一行都露不全`);

  for (let row = 0; row < L.rows; row++) {
    const r = revealRange(row, L.maxScroll, S);
    ok(r.min <= r.max, `${KIND_NAME[kind]}:第 ${row + 1} 行能完整滚进窗内(s ∈ [${r.min}, ${r.max}])`);
  }

  // 静止两端:顶部看首行、底部看末行
  const first = revealRange(0, L.maxScroll, S);
  const last = revealRange(L.rows - 1, L.maxScroll, S);
  ok(first.min === 0, `${KIND_NAME[kind]}:不滚动时首行就完整在窗内(顶部留白 ${S.padTop} 还在)`);
  ok(rowTopY(0, S) + 0 <= S.h / 2 - S.padTop + 0.001, `${KIND_NAME[kind]}:首行顶缘落在窗顶下方 ${S.padTop}px`);
  if (L.maxScroll > 0) {
    const lastBottom = rowTopY(L.rows - 1, S) - S.cardH + L.maxScroll;
    ok(lastBottom >= -S.h / 2 + S.padBot - 0.001,
      `${KIND_NAME[kind]}:滚到底时末行下缘 ${lastBottom.toFixed(0)} 不低于窗底+留白 ${(-S.h / 2 + S.padBot).toFixed(0)}`);
    ok(last.max === L.maxScroll, `${KIND_NAME[kind]}:滚到底 = 位移 ${L.maxScroll},末行仍在可见区间内`);
  } else {
    ok(L.contentH <= S.h, `${KIND_NAME[kind]}:装得下(${L.contentH} ≤ ${S.h})所以不需要滚动`);
  }

  // 滚动条:要么不画,要么捏得住
  const trackH = S.h - BAR_PAD * 2;
  const th = thumbHeight(trackH, S.h, L.maxScroll);
  if (L.maxScroll > 0) ok(th >= 34 && th <= trackH, `${KIND_NAME[kind]}:滑块高 ${th.toFixed(0)} 在 [34, ${trackH}] 之间`);
  else ok(th === 0, `${KIND_NAME[kind]}:装得下时滑块高度 0(不画轨道)`);
}

// ---------- ② 越界阻尼:窗内不动,窗外压缩但同向 ----------
{
  const max = 96, k = 0.35;
  ok(rubberBand(40, max, k) === 40, "窗内位移原样返回");
  ok(rubberBand(-40, max, k) === -14, "往上拉过头只走 35%(还能感觉到阻力)");
  ok(rubberBand(max + 40, max, k) === max + 14, "往下推过头同样压缩,且不会越过边界反向");
  ok(rubberBand(-9999, max, k) < 0 && rubberBand(9999, max, k) > max, "再狠的过界也留在同一侧,松手才弹得回去");
}

// ---------- ③ 列数规则(与 gridCols 的注释口径一致) ----------
{
  ok(gridCols(10, S) === 5 && gridCols(8, S) === 4 && gridCols(12, S) === 4, "10→5 列 / 8→4 列 / 12→4 列");
  ok(gridCols(3, S) === 3 && gridCols(7, S) === 5, "不足一行的按款数排,凑不满也不硬撑 5 列");
  ok(shelfLayout(0, S).rows === 1 && shelfLayout(0, S).maxScroll === 0, "0 款不炸:按 1 行算、没有可滚的距离");
}

// ---------- ④ 松手之后的运动学:收得住、不越界、不 NaN ----------
{
  const max = shelfLayout((CFG.skins.player ?? []).length, S).maxScroll;
  const dt = 1 / 60;

  /** 跑到位返回步数;5 秒还没停 = 抖个不停 */
  const settleAt = (y0: number, v0: number, easeTo: number | null): number => {
    const m = { y: y0, v: v0, easeTo };
    for (let i = 1; i <= 300; i++) {
      advanceScroll(m, max, dt);
      if (!isFinite(m.y) || !isFinite(m.v)) return -1;
      if (m.easeTo === null && Math.abs(m.v) <= FLING_MIN && m.y >= 0 && m.y <= max) return i;
    }
    return 999;
  };
  /** 轨迹是否始终待在 [lo, hi] 里(越界回弹不许弹过头) */
  const staysIn = (y0: number, v0: number, easeTo: number | null, lo: number, hi: number): boolean => {
    const m = { y: y0, v: v0, easeTo };
    for (let i = 0; i <= 300; i++) {
      if (m.y < lo - 1e-6 || m.y > hi + 1e-6) return false;
      advanceScroll(m, max, dt);
    }
    return true;
  };

  let worst = 0, bad = 0, nan = 0;
  for (const y0 of [-40, -0.3, 0, max / 2, max, max + 0.3, max + 40]) {
    for (const v0 of [-4000, -600, -FLING_MIN - 1, 0, FLING_MIN + 1, 600, 4000]) {
      const n = settleAt(y0, v0, null);
      if (n === -1) nan++;
      else if (n === 999) bad++;
      else worst = Math.max(worst, n);
    }
  }
  ok(nan === 0, "任意初态(含越界与 ±4000px/s)都不出 NaN");
  ok(bad === 0, `任意初态都在 5 秒内收进 [0, ${max}](最慢 ${worst} 帧 ≈ ${(worst / 60).toFixed(2)}s)`);
  ok(staysIn(-40, 0, null, -40, max), "从上方越界松手:只往回走,不弹过 0 再甩到下面");
  ok(staysIn(max + 40, 0, null, 0, max + 40), "从下方越界松手:同样单调弹回,不越界");
  ok(staysIn(0, 4000, null, 0, max), "从顶部猛甩:最多停在货架底,不会穿过去");
  ok(staysIn(max, -4000, null, 0, max), "从底部反向猛甩:最多停在顶,不会穿过去");

  // 惯性真的能走完整个货架(否则「滑动查看」只是拖一下弹回来)
  {
    const m = { y: 0, v: 4000, easeTo: null as number | null };
    let prevAbsV = Math.abs(m.v) + 1, monotone = true, steps = 0;
    while (Math.abs(m.v) > FLING_MIN && steps++ < 300) {
      advanceScroll(m, max, dt);
      if (Math.abs(m.v) > prevAbsV + 1e-9) monotone = false;
      prevAbsV = Math.abs(m.v);
    }
    ok(m.y === max, `一记 4000px/s 的快甩从顶部滚到货架底(y=${m.y},用时 ${(steps / 60).toFixed(2)}s)`);
    ok(monotone, "惯性段速度只减不增(不会越滚越离谱)");
  }
  {
    const m = { y: 0, v: FLING_MIN - 1, easeTo: null as number | null };
    advanceScroll(m, max, dt);
    ok(m.y === 0 && m.v === 0, "低于停止阈值的轻推直接停住(不在末尾抖半像素)");
  }
  {
    const m = { y: 0, v: 900, easeTo: 42 as number | null };
    for (let i = 0; i < 300; i++) advanceScroll(m, max, dt);
    ok(m.y === 42 && m.easeTo === null, "定位(easeTo)优先于惯性:选中窗外那一行时稳稳停在 42");
  }
}

// ---------- ⑤ selftest:改动前那套必须被报警 ----------
if (process.argv.includes("--selftest")) {
  console.log("\nselftest:拿「窗只装两行、没有滚动」的旧状态当反例");
  const n = (CFG.skins.player ?? []).length;
  const L = shelfLayout(n, S);
  // 旧状态 = 同样的排版,但 maxScroll 被写死成 0(没有滚动这回事)
  const noScroll = 0;
  const rowsOld = Math.ceil(n / gridCols(n, S));
  const unreachable: number[] = [];
  for (let row = 0; row < rowsOld; row++) {
    const r = revealRange(row, noScroll, S);
    if (r.min > r.max) unreachable.push(row + 1);
  }
  ok(unreachable.length > 0, `旧状态被报警:第 ${unreachable.join("、")} 行在任何位置都露不全`);
  ok(unreachable.includes(rowsOld), "报的正是末行 —— 用户看到的「只能看 8 款」");
  ok(revealRange(0, noScroll, S).min === 0, "首行在旧状态下没事(所以只有下面几行丢给用户)");
  ok(L.maxScroll > 0 && revealRange(rowsOld - 1, L.maxScroll, S).min <= L.maxScroll,
    `同一套排版在 maxScroll=${L.maxScroll} 下末行滚得进来 —— 新排版在同一个判据下干净`);
  // 反例二:硬上 6 列会顶破网格
  const wide = { ...S, cardW: S.cardW };
  const cols6 = 6;
  ok(cols6 * wide.cardW + (cols6 - 1) * wide.gap > S.w, "6 列卡片块顶破 520 宽 —— gridCols 卡 5 列的理由成立");
  // 反例三:滑块下限被拿掉时,长货架会捏不到
  const tinyThumb = (S.h - BAR_PAD * 2) * S.h / (S.h + 10_000);
  ok(tinyThumb < 34 && thumbHeight(S.h - BAR_PAD * 2, S.h, 10_000) >= 34,
    `10000px 货架按比例只有 ${tinyThumb.toFixed(1)}px 滑块,靠下限兜回 ${thumbHeight(S.h - BAR_PAD * 2, S.h, 10_000)}`);
}

console.log(`\n${fails === 0 ? "✓" : "✗"} ${checks} 项断言,失败 ${fails}`);
process.exit(fails === 0 ? 0 : 1);
