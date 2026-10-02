// ============================================================
// 「调整位置」顶栏排版回归 —— 防的是用户报的那个现场:
// 「按钮调整那里没有看到调整透明度的滑杆」。根因不是滑杆没建,是它被建在了
// 两颗按钮底下:透明度标签占 40..120、透明度滑杆占 154..334,而「重置默认」占
// 37..187、「完成」占 205..355 —— 按钮后建,兄弟序高的盖低的,滑杆整根 invisible。
//
// 这一栏要在 760 宽里放六件事,靠手调绝对坐标迟早再撞一次。所以排版搬进
// assets/scripts/ui/editor-strip.ts(纯函数),这里只断言四条:
//   1) 任何两件不许重叠(含「按钮压滑杆」这一条历史事故);
//   2) 文字放得进自己的框(面板 Label 是 Overflow.CLAMP,超了静默截字);
//   3) 整行 + 两侧留白不许超面板宽;
//   4) 两根滑杆的触摸宽够手指用(透明度 0.05 一档 ≈ 8px/档)。
// 另带 --selftest:拿改动前那套手调坐标当反例,断言它**会**被报警 ——
// 规则脚本最怕悄悄全绿。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/strip-check.js
// ============================================================
import { makeChecker } from "./harness";
import {
  BTN_TEXT_PAD, STRIP_GAP, STRIP_PANEL_W, STRIP_SIDE_PAD,
  stripLayout, stripOverlaps, stripTextOverflow, type StripLayout,
} from "../assets/scripts/ui/editor-strip";
import { textW } from "../assets/scripts/core/text-metrics";

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

console.log("编辑器顶栏:不重叠 / 不溢出 / 放得进面板\n");

// ---------- ① 面板宽与 settings-panel 的 PW 是同一个数(那边用它画底卡) ----------
ok(STRIP_PANEL_W === 760, `STRIP_PANEL_W == 760(settings-panel.PW 改了要同步这里)`);

// ---------- ② 三种移动方式下的名称文案都排得开 ----------
for (const modeName of ["摇杆", "滑轨", "大小"]) {
  const L = stripLayout(modeName);
  const ov = stripOverlaps(L);
  ok(ov.length === 0, `「${modeName}」档:六件互不重叠${ov.length ? ` → ${ov.join(" / ")}` : ""}`);
  const of = stripTextOverflow(L);
  ok(of.length === 0, `「${modeName}」档:文案放得进自己的框${of.length ? ` → ${of.join(" / ")}` : ""}`);
  ok(L.rowW + STRIP_SIDE_PAD * 2 <= L.panelW,
    `「${modeName}」档:整行 ${L.rowW} + 两侧 ${STRIP_SIDE_PAD} 塞得进 ${L.panelW} 面板`);
  ok(L.margin >= 0, `「${modeName}」档:行两侧各还剩 ${L.margin}`);
}

// ---------- ③ 顺序与间距:按钮必须排在两根滑杆之后,且留出可见间隙 ----------
{
  const L = stripLayout("摇杆");
  const byKey = Object.fromEntries(L.items.map((i) => [i.key, i]));
  const order = L.items.map((i) => i.key).join(">");
  ok(order === "name>size>alphaName>alpha>reset>done", `行内顺序 name>size>alphaName>alpha>reset>done(实得 ${order})`);
  ok(byKey.reset.left >= byKey.alpha.right, "「重置默认」整颗在透明度滑杆右侧,不再压上来");
  ok(byKey.done.left >= byKey.reset.right, "「完成」整颗在重置按钮右侧");
  let minGap = Infinity;
  for (let i = 1; i < L.items.length; i++) {
    minGap = Math.min(minGap, L.items[i].left - L.items[i - 1].right);
  }
  ok(Math.abs(minGap - STRIP_GAP) < 0.51, `相邻件间隙 = STRIP_GAP(${minGap})`);
}

// ---------- ④ 滑杆触摸宽与档位分辨率 ----------
{
  const L = stripLayout("大小");
  for (const key of ["size", "alpha"] as const) {
    const it = L.items.find((i) => i.key === key)!;
    ok(it.w >= 150, `${key} 滑杆宽 ${it.w} >= 150(手指点得着)`);
  }
  const alpha = L.items.find((i) => i.key === "alpha")!;
  const pxPerStep = alpha.w / ((1.0 - 0.2) / 0.05);
  ok(pxPerStep >= 7, `透明度每档 ${pxPerStep.toFixed(1)}px,拖得动也停得住`);
}

// ---------- ⑤ selftest:改动前那套手调坐标必须被报警 ----------
if (process.argv.includes("--selftest")) {
  console.log("\nselftest:拿旧版手调坐标当反例");
  /** 旧坐标还原:txt(40, w80) / slider(center 244, w180) / button(center 112, w150) / button(center 280, w150) */
  const mk = (key: StripLayout["items"][number]["key"], kind: StripLayout["items"][number]["kind"],
    left: number, w: number, text = "", fontSize = 0): StripLayout["items"][number] =>
    ({ key, kind, text, fontSize, left, w, right: left + w, center: left + w / 2 });
  const old: StripLayout = {
    items: [
      mk("name", "label", -354, 60, "摇杆", 14),
      mk("size", "slider", -274, 180),
      mk("alphaName", "label", 40, 80, "透明度", 14),
      mk("alpha", "slider", 154, 180),
      mk("reset", "button", 37, 150, "重置默认", 15),
      mk("done", "button", 205, 150, "完成", 16),
    ],
    rowW: 0, panelW: STRIP_PANEL_W, margin: 0,
  };
  const ov = stripOverlaps(old);
  ok(ov.length > 0, `旧坐标被报警(${ov.length} 处重叠)`);
  ok(ov.some((s) => s.startsWith("alpha(")) && ov.some((s) => s.startsWith("alphaName(")),
    "报的正是透明度那两件被按钮压住");
  const wide = stripLayout("摇杆");
  ok(stripOverlaps(wide).length === 0, "新排版在同一个判据下干净");
  // 文案溢出也要能报:把透明度标签框压到 20 宽
  const cramped: StripLayout = {
    ...wide,
    items: wide.items.map((i) => (i.key === "alphaName" ? { ...i, w: 20, right: i.left + 20 } : i)),
  };
  ok(stripTextOverflow(cramped).length === 1, "框宽不足时文案溢出会被报警");
  console.log(`  参照:textW("透明度",14) = ${textW("透明度", 14)} + 按钮内边距下限 ${BTN_TEXT_PAD}`);
}

console.log(`\n${h.fails === 0 ? "✓" : "✗"} ${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);
