// ============================================================
// 影分身「三色 + 四态」出图 + 几何断言 —— 一次性验证脚本,不属于游戏运行时代码。
//
// 为什么要有这个工具:这次改的是**观感契约** —— 同场三个黑剪影必须一眼分得出谁是谁。
// 它坏起来不崩、不 NaN、tsc 也不报:三色塌成一色、辉光把亮球场糊成一片、三组头顶 pips
// 连成一条横杠、辉光形状逐帧重掷抖成噪点。只有"把同一批多边形画出来肉眼判"才看得见。
// 与 aura-preview / panel-preview 同一套路:cc.Graphics 换记录型替身 → node 里 dump SVG
// → headless Chrome 光栅化。
//
// **与真机共用同一个画法函数**:这里调 sprites.drawShadowClone,render/world.ts 走的也是它。
// 预览与实机不同源是这类工具最坏的失败模式(纸上好看、真机另一回事)—— 画法之所以从 world
// 挪进 sprites,就是为了这一条,顺带让 frame-cost 护栏也量同一个函数。
//
// 钉住的六条(全是"不会崩、只会安静地难看"的那类坏):
//   1 三色两两不等,且任意两色的最大通道差 ≥ 门槛(小屏上分不开就不叫"三色")
//   2 本体仍是纯黑剪影:一帧里除黑/白与这一枚的身份色以外不许有第四种色
//   3 辉光形状**出生定形**:同一枚跨帧只整体缩放,形状签名逐位不变(seed 被逐帧重掷就红)
//   4 头顶 pips:同一枚三片同高、不同枚按槽位错行(不错行就连成一条横杠)
//   5 辉光浓度有上限(拉爆就把亮球场糊成一团)
//   6 每枚一帧的笔画数在预算内(三枚同屏是 3 倍成本)
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/shadow-preview.js                 # 断言 + 出 SVG/HTML
//   node .tools-build/tools/shadow-preview.js --selftest      # 五份改坏的真实写法必须被报警
//   # 肉眼看:把 HTML 交给 headless Chrome 光栅化
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
//     --screenshot=.tools-build/shadow-preview/shadow.png --window-size=1560,1300 \
//     file://$PWD/.tools-build/shadow-preview/shadow.html
// ============================================================
import fs from "fs";
// 顺序即语义:cc-stub 必须在 sprites 之前求值(它在模块求值时给 Module._load 打补丁)
import { installCc, Graphics as StubGraphics, StubOp, opPoints, opsToSvg } from "./cc-stub";
import { __resetPoseState, drawShadowClone, ShadowCloneView } from "../assets/scripts/render/sprites";
import type { Viewport } from "../assets/scripts/render/world";
import { CFG } from "../assets/scripts/core/config";
import { Rules } from "../assets/scripts/core/rules";
import { Skills } from "../assets/scripts/core/skills";
import { ShadowGate } from "../assets/scripts/core/shadow-gate";
import { Ball, Player, ShadowCloneState } from "../assets/scripts/core/types";
import { makeChecker, Checker } from "./harness";

installCc();

const C = CFG;
const CO = C.court, SH = C.skills.shadow;

const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ".tools-build/shadow-preview";
})();
fs.mkdirSync(OUT, { recursive: true });

/**
 * 出图用的**局部视口**:原点钉在"这枚分身脚下往上 0.55 身高"处。
 * 用整场坐标画的话,人物落在 viewBox 外面 —— 截图就是一排空白卡片(第一版正是这样:
 * 断言全绿、图上一个剪影都没有,因为断言量的是笔画之间的相对几何,看不见构图)。
 * 三人同屏那张把原点钉在中间那枚身上,三股才都进画面。
 */
function localVp(cx: number, feetY: number): Viewport {
  const cy = feetY - C.player.h * 0.55;
  return {
    x: (wx: number): number => wx - cx,
    y: (wy: number): number => cy - wy,
  };
}

const NO_INPUT = { left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false };
const CAST_INPUT = { ...NO_INPUT, skillPressed: true };

/**
 * 走真实召唤链取三枚真分身当模特:newMatch("1p") → 装 shadow → 每"一分"召一枚。
 * 不手搓 ShadowCloneState:颜色/槽位/防区都得是 spawn 自己写出来的那份,
 * 否则这里绿了只证明"我构造的状态好看",不证明真机那两个函数对得上。
 */
function summonThree(): ShadowCloneState[] {
  Rules.newMatch("1p", "normal");
  const hero = Rules.R.players[0];
  const ball = Rules.R.ball as Ball;
  hero.skill = Skills.initSkillState("shadow");
  for (let i = 0; i < SH.slots.length; i++) {
    Skills.resetPoint(hero);
    Rules.R.state = "RALLY";
    ball.flying = false; ball.held = false; ball.live = true;
    Rules.step(Rules.R.players.map((p) => (p === hero ? CAST_INPUT : { ...NO_INPUT })));
    for (let f = 0; f < SH.spawnFrames + 2; f++) {
      Rules.step(Rules.R.players.map(() => ({ ...NO_INPUT })));
    }
  }
  return ShadowGate.clonesOf(hero).slice();
}

type Gfx = Parameters<typeof drawShadowClone>[0];

/** 一枚分身的一帧:实体摆到防区中央(跑位姿态会盖住要看的件),画进记录型替身 */
function sample(
  sc: ShadowCloneState,
  ov: Partial<ShadowCloneView> = {},
  extra: { rise?: number; vx?: number; center?: { x: number; y: number } } = {},
): StubOp[] {
  const p = sc.entity;
  p.x = p.homeX; p.px = p.homeX + (extra.vx ?? 0); p.y = CO.groundY - (extra.rise ?? 0); p.py = p.y;
  p.vx = extra.vx ?? 0; p.vy = 0; p.onGround = true; p.swingT = -1; p.lungeT = -1;
  const view: ShadowCloneView = {
    tint: ShadowGate.slotTint(sc.slot),
    remaining: SH.maxHits,
    slot: sc.slot,
    seed: sc.seed,
    phase: 24,
    showPips: true,
    ...ov,
  };
  __resetPoseState();          // 姿态缓动状态是模块级的,不清就会把上一张的余势画进来
  const g = new StubGraphics();
  const cx = extra.center ? extra.center.x : p.x;
  const cy = extra.center ? extra.center.y : CO.groundY;
  drawShadowClone(g as unknown as Gfx, localVp(cx, cy), p, 0, 1, null, view);
  return g.ops;
}

// ---------- 颜色 ----------

interface RGB { r: number; g: number; b: number }
const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const parseCss = (css: string): RGB => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : { r: -1, g: -1, b: -1 };
};
/** 肉眼在小屏上分辨颜色靠的就是这个数 */
const channelDelta = (a: RGB, b: RGB): number =>
  Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
/** 一条笔画的 alpha(替身把颜色存成 css 串;真 cc 里就是 a/255) */
const opAlpha = (css: string): number => {
  const m = /,([\d.]+)\)/.exec(css);
  return m ? +m[1] : 1;
};
/** 无彩色(黑/白/灰系,含人物描边那几档近黑墨色):本体剪影就该全是这一类 */
const isGrayish = (c: RGB): boolean => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= 30;
/** 明显带色相(通道跨度 >30)又离这一枚的身份色很远 ⇒ 那就是"把别处的颜色画进分身了" */
const isForeignChroma = (c: RGB, tint: RGB): boolean =>
  Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) > 30 && channelDelta(c, tint) > 40;

/** 尖刺环的两笔 = drawShadowClone 的头两笔(它画在身体之前)。取它们的 alpha 验"config 真被吃了" */
function glowAlphas(ops: StubOp[]): number[] {
  return ops.slice(0, 2).filter((op) => op.kind === "stroke").map((op) => opAlpha(op.color));
}

/**
 * 尖刺环的**形状签名**:每点到质心的距离 ÷ 平均距离(四舍五入到 3 位)。
 * 整体缩放(呼吸半径)对它无影响,而顶点被重掷就会变 —— 这一格就是"出生定形 vs 逐帧 rand"
 * 的分界线,拿笔画数或包围盒都比不出来(重掷也一样是 22 个点、差不多的框)。
 */
function ringShape(ops: StubOp[]): number[] {
  let best: StubOp | null = null, bestN = 0;
  for (const op of ops) {
    if (op.kind !== "stroke") continue;
    const n = opPoints(op).length;
    if (n > bestN) { bestN = n; best = op; }
  }
  if (!best) return [];
  const pts = opPoints(best);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const rs = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const mean = rs.reduce((s, r) => s + r, 0) / rs.length || 1;
  return rs.map((r) => Math.round((r / mean) * 1000) / 1000);
}

/** 这一笔是不是 pips 那种斜切小片(颜色落在身份色族 + 4 点 + 小包围盒 + 坐标有限) */
function isPipOp(op: StubOp, tint: string): boolean {
  if (op.kind !== "fill") return false;
  if (channelDelta(parseCss(op.color), hexToRgb(tint)) > 24) return false;   // 灭片是同色相低 alpha
  const pts = opPoints(op);
  if (pts.length !== 4) return false;
  if (!pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return false;
  const w = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  const h = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
  return w <= 12 && h <= 13 && w >= 3;
}

/**
 * 头顶 pips 的几何读数。识别条件必须**同时**卡颜色与尺寸:人物本体里也有四条点的斜块
 * (球衣明暗、鞋底),只按"4 个点 + 小包围盒"会把它们一起收进来 —— 于是"三片同高"量出
 * 四片、行数还多出几条(第一版就红在这里)。
 */
function pips(ops: StubOp[], tint: string): Array<{ y: number; lit: boolean }> {
  const out: Array<{ y: number; lit: boolean }> = [];
  for (const op of ops) {
    if (!isPipOp(op, tint)) continue;
    const pts = opPoints(op);
    out.push({ y: Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length), lit: opAlpha(op.color) > 0.5 });
  }
  return out;
}

// ---------- 判据 ----------

const MIN_DELTA = 60;          // 三色两两最小通道差
const MAX_GLOW_ALPHA = 0.7;    // 辉光浓度上限
const OPS_PER_CLONE = 46;      // 每枚一帧笔画上限

function checks(ck: Checker, arr: ShadowCloneState[]): void {
  if (arr.length < SH.slots.length) {
    ck.ok(false, `取样:只召出 ${arr.length}/${SH.slots.length} 枚(先看 shadow-check ⑧)`);
    return;
  }
  const names = arr.map((sc) => ShadowGate.slotTint(sc.slot));

  // 1 三色两两不等且差得够开
  let worst = Infinity, worstPair = "";
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const d = channelDelta(hexToRgb(names[i]), hexToRgb(names[j]));
      if (d < worst) { worst = d; worstPair = `${names[i]}↔${names[j]}`; }
    }
  }
  ck.ok(worst >= MIN_DELTA, `1 三色两两最大通道差 ≥ ${MIN_DELTA}(最窄一对 ${worstPair} 实测 ${worst}):${names.join(" / ")}`);

  // 2 本体仍是纯黑剪影:除黑/白/近黑墨色与这一枚的身份色以外,不许出现带色相的第四种色
  for (const sc of arr) {
    const tint = ShadowGate.slotTint(sc.slot);
    const want = hexToRgb(tint);
    const ops = sample(sc);
    const foreign = ops.filter((op) => isForeignChroma(parseCss(op.color), want));
    ck.ok(foreign.length === 0, `2 ${sc.slot} 号本体没被染色(带异色相的笔画 ${foreign.length} 条:${
      foreign.slice(0, 2).map((o) => o.color).join(" ")})`);
    const black = ops.filter((op) => { const c = parseCss(op.color); return c.r < 12 && c.g < 12 && c.b < 12; }).length;
    ck.ok(black >= 8, `2b ${sc.slot} 号纯黑剪影主体还在(黑笔画 ${black} 条)`);
  }

  // 3 辉光形状出生定形:跨帧只缩放,形状签名逐位不变
  for (const sc of arr) {
    const early = ringShape(sample(sc, { phase: 24 }));
    const late = ringShape(sample(sc, { phase: 137 }));
    ck.ok(early.length > 6 && JSON.stringify(early) === JSON.stringify(late),
      `3 ${sc.slot} 号辉光跨帧只是缩放(形状签名 ${early.length} 点,${
        JSON.stringify(early) === JSON.stringify(late) ? "一致" : "变了 = 逐帧重掷"})`);
  }

  // 4 头顶 pips:同一枚三片同高,不同枚按槽位错行
  const per = arr.map((sc) => pips(sample(sc), ShadowGate.slotTint(sc.slot)));
  ck.ok(per.every((list) => new Set(list.map((x) => x.y)).size === 1),
    `4 每枚的 ${SH.maxHits} 片 pips 在同一行(实测各自行数 ${per.map((l) => new Set(l.map((x) => x.y)).size).join("/")})`);
  ck.ok(per.every((list) => list.length === SH.maxHits),
    `4b 每枚都画满 ${SH.maxHits} 片(含灭片;实测 ${per.map((l) => l.length).join("/")})`);
  const ys = per.map((list) => list[0].y);
  ck.ok(new Set(ys).size === ys.length, `4c 三组 pips 按槽位错开(实测 y ${ys.join(" / ")};不错行就连成一条横杠)`);

  // 4d 亮片数 = 剩余球数(接一球熄一枚,这条读数是玩家判断"还值不值得留它"的唯一出口)
  for (const left of [0, 1, 2, 3]) {
    const list = pips(sample(arr[0], { remaining: Math.min(left, SH.maxHits) }), ShadowGate.slotTint(arr[0].slot));
    const lit = list.filter((x) => x.lit).length;
    const want = Math.min(left, SH.maxHits);
    ck.ok(lit === want, `4d 剩 ${want} 球 ⇒ 亮 ${lit} 片`);
  }

  // 4e pips 不许压在头圈/辉光上:附属读数一旦和装饰同层就等于没了(出图现场:余量取 16 时
  //     三片正好落进头顶那圈身份色描边里,读成"头发上三道杠"而不是"剩余次数")
  for (const sc of arr) {
    const tint = ShadowGate.slotTint(sc.slot);
    const ops = sample(sc);
    const list = pips(ops, tint);
    const pipY = list.length ? Math.min(...list.map((x) => x.y)) : Infinity;
    const bodyTop = Math.max(...ops.filter((op) => !isPipOp(op, tint))
      .flatMap((op) => opPoints(op).map((p) => p.y)).filter((v) => Number.isFinite(v)), -Infinity);
    ck.ok(list.length === SH.maxHits && pipY > bodyTop + 2,
      `4e ${sc.slot} 号:${SH.maxHits} 片 pips 在身体最高件之上(${pipY} > ${Math.round(bodyTop)}+2,余量 ${SH.pipLift})`);
  }

  // 5 辉光浓度不吃满,而且 config 那个数真的被吃进去了(不是渲染里写死的字面量)
  ck.ok(SH.glowAlpha <= MAX_GLOW_ALPHA, `5 辉光浓度 ${SH.glowAlpha} ≤ ${MAX_GLOW_ALPHA}`);
  const ga = glowAlphas(sample(arr[0]));
  // drawSpikeRing 画两笔:外晕 = alpha × haloA(0.42),芯 = alpha ⇒ 取大的那一笔对账
  ck.ok(ga.length >= 1 && Math.abs(Math.max(...ga) - SH.glowAlpha) <= 1 / 32 + 0.01,
    `5b 辉光芯笔的 alpha ${ga.map((v) => v.toFixed(2)).join("/")} 就是 config 的 glowAlpha ${SH.glowAlpha}(没被字面量覆盖)`);

  // 6 每枚笔画预算
  for (const sc of arr) {
    const n = sample(sc).length;
    ck.ok(n <= OPS_PER_CLONE, `6 ${sc.slot} 号一帧 ${n} 笔 ≤ ${OPS_PER_CLONE}`);
  }
}

// ---------- HTML 出图 ----------

const STATES: Array<{ name: string; ov: Partial<ShadowCloneView>; rise: number; vx?: number }> = [
  { name: "在场·满额", ov: { remaining: 3 }, rise: 0 },
  { name: "在场·剩两球", ov: { remaining: 2 }, rise: 0 },
  { name: "在场·耗尽(全灭)", ov: { remaining: 0 }, rise: 0 },
  { name: "成影闪烁", ov: { phase: 4 }, rise: 0 },
  { name: "消散上飘", ov: { remaining: 0, showPips: false }, rise: 14 },
  { name: "跑位中", ov: {}, rise: 0, vx: 5 },
];

/**
 * 一张卡片。viewBox 必须**向上留够空间**:画面中心钉在半身高处,而 pips 在身高 +28 处,
 * 按正方形 190 裁会把三片切掉(第一版截图里"看不见 pips"就是这个,不是没画)。
 */
function card(ops: StubOp[], bg: string, label: string, s = 1.2): string {
  return `<figure style="margin:0"><svg width="180" height="250" viewBox="-100 -150 200 260"
    style="background:${bg};border:1px solid #333">
    <g transform="scale(${s}, ${-s})">${opsToSvg(ops)}</g></svg>
    <figcaption style="font:11px monospace;color:#bbb;text-align:center">${label}</figcaption></figure>`;
}

function buildHtml(arr: ShadowCloneState[]): string {
  const blocks: string[] = [];
  for (const sc of arr) {
    const tint = ShadowGate.slotTint(sc.slot);
    const rows = STATES.map((st) =>
      ["#0d1114", "#cfd8e3"].map((bg) =>
        card(sample(sc, st.ov, { rise: st.rise, vx: st.vx }), bg, `${st.name}<br>${bg === "#0d1114" ? "暗场" : "亮场"}`)
      ).join("")).join("");
    blocks.push(`<section style="margin:16px 0">
      <h3 style="font:600 15px monospace;color:${tint};margin:6px 0">slot ${sc.slot} · ${tint} · 防区 x=${Math.round(sc.entity.homeX)}(netX${sc.entity.homeX < CO.netX ? "-" : "+"}${Math.abs(Math.round(sc.entity.homeX - CO.netX))})</h3>
      <div style="display:flex;gap:5px;flex-wrap:wrap">${rows}</div></section>`);
  }
  // 三人同屏 + 每人打掉不同球数:三色分不分得开、三组 pips 会不会连成线,看这一张
  const mid = arr[Math.floor(arr.length / 2)].entity.homeX;
  const trio: StubOp[] = [];
  for (const sc of arr) trio.push(...sample(sc, { remaining: SH.maxHits - arr.indexOf(sc) }, { center: { x: mid, y: CO.groundY } }));
  blocks.push(`<section style="margin:16px 0"><h3 style="font:600 15px monospace;color:#eee">三人同屏(各打掉不同球数)</h3>
    <div style="display:flex;gap:6px">${["#0d1114", "#cfd8e3"].map((bg) =>
      card(trio, bg, bg === "#0d1114" ? "暗场" : "亮场", 0.9)).join("")}</div></section>`);
  return `<!doctype html><meta charset="utf-8"><title>shadow preview</title>
<body style="background:#101418;margin:0;padding:16px">${blocks.join("\n")}</body>`;
}

// ---------- selftest:五份改坏的真实写法必须被点名 ----------

const selftest = process.argv.includes("--selftest");

if (selftest) {
  console.log("反例自检:五份改坏的真实写法必须被点名拦下(拦不住 = 这套尺子没牙齿)");
  const snapTint = SH.slots.map((s) => s.tint);
  const snapAlpha = SH.glowAlpha;
  const restore = (): void => {
    SH.slots.forEach((s, i) => { s.tint = snapTint[i]; });
    SH.glowAlpha = snapAlpha;
  };
  const runChecks = (): number => {
    const ck = makeChecker({ printPass: false });
    try {
      checks(ck, summonThree());
    } finally {
      restore();
    }
    return ck.fails;
  };
  let bad = 0;
  const cases: Array<[string, () => void]> = [
    ["sameTint(槽位表三色填成同一个紫)", () => { SH.slots.forEach((s) => { s.tint = "#8b5cf6"; }); }],
    ["blackTint(身份色写成纯黑 = 旧写法把 glow 抹掉那一步)", () => { SH.slots[1].tint = "#000000"; SH.slots[2].tint = "#0b0b0b"; }],
    ["glowTooStrong(辉光浓度拉到 0.95,亮球场糊成一片)", () => { SH.glowAlpha = 0.95; }],
  ];
  for (const [label, patch] of cases) {
    restore();
    patch();
    const fails = runChecks();
    console.log(`  ${fails > 0 ? "✓" : "✗ 全绿 —— 拦不住"} 「${label}」:${fails} 条报警`);
    if (fails === 0) bad++;
  }

  // 两份参数级坏法:它们坏在调用方传进 drawShadowClone 的 view 上,不是 config
  const arr = summonThree();
  restore();
  {
    const ck = makeChecker({ printPass: false });
    // 真实坏形状:world 把 slot 恒传 0(旧写法只有一个分身,槽位字段那时没人在喂)
    const ys = arr.map((sc) => {
      const list = pips(sample(sc, { slot: 0 }), ShadowGate.slotTint(sc.slot));
      return list.length ? list[0].y : NaN;
    });
    ck.ok(new Set(ys).size === ys.length, "4c 三组 pips 按槽位错开");
    console.log(`  ${ck.fails > 0 ? "✓" : "✗ 全绿 —— 拦不住"} 「noStagger(view.slot 恒 0)」:${ck.fails} 条报警(y ${ys.join("/")})`);
    if (ck.fails === 0) bad++;
  }
  {
    const ck = makeChecker({ printPass: false });
    // 真实坏形状:辉光形状不在出生时定形,而是每帧重掷(AGENTS 的 P5 条明确禁止)
    const sc = arr[0];
    const early = ringShape(sample(sc, { seed: (Math.random() * 1e9) | 0, phase: 24 }));
    const late = ringShape(sample(sc, { seed: (Math.random() * 1e9) | 0, phase: 137 }));
    ck.ok(JSON.stringify(early) === JSON.stringify(late), "3 辉光跨帧只是缩放");
    console.log(`  ${ck.fails > 0 ? "✓" : "✗ 全绿 —— 拦不住"} 「reseedPerFrame(逐帧重掷 seed)」:${ck.fails} 条报警`);
    if (ck.fails === 0) bad++;
  }

  console.log(bad ? "\n✗ shadow-preview selftest 失败" : "\n✓ shadow-preview selftest:反例全被拦住");
  process.exit(bad ? 1 : 0);
}

const ck = makeChecker();
console.log("\n影分身三色与四态判据");
const arr = summonThree();
checks(ck, arr);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/shadow.html`, buildHtml(arr));
console.log(`\n出图: ${OUT}/shadow.html  —— headless Chrome 光栅化肉眼判三色与四态`);
console.log(`${ck.fails === 0 ? "✓" : "✗"} shadow-preview:${ck.checks} 条断言,${ck.fails} 条失败`);
process.exit(ck.fails ? 1 : 0);
