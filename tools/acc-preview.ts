// ============================================================
// 配饰试穿出图 + 渲染断言 —— 配饰是「纯画面改动」,坏只会坏成「戴错了位置/画不出来」,
// 崩不了也不报错。Cocos 编辑器对自动化封闭,唯一能自证的路就是把 cc.Graphics 换成
// 记录型替身、在 node 里 dump SVG(pose-preview / aura-preview 同一套路)。
//
// 断言四条(逻辑层判据在 tools/accessory-check.ts,这里管「看得见」):
//   ① 每件配饰上身都真的多出笔画(ops 数 > 不戴基线)—— style 未注册/接线漏挂在这现形;
//   ② 坐标全部有限(不吃 NaN/Infinity);
//   ③ 同帧重画笔画数一致(逐帧 rand 会抖成噪点,acc.ts 头注的铁律);
//   ④ 卡片静置画非空。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/acc-preview.js                 # 断言 + 出 acc.html
//   # 肉眼看:headless Chrome 光栅化(一次性,跑完自退)
// ============================================================
import fs from "fs";
// 顺序即语义:cc-stub 必须在 acc/sprites 之前求值(它在模块求值时给 Module._load 打补丁)
import { installCc, Graphics as StubGraphics, StubOp, opsToSvg } from "./cc-stub";
import { __resetPoseState, drawPlayer, Viewport } from "../assets/scripts/render/sprites";
import { drawAccStill } from "../assets/scripts/render/acc";
import { CFG } from "../assets/scripts/core/config";
import { AccessoryDef, Player } from "../assets/scripts/core/types";

installCc();

const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ".tools-build/acc-preview";
})();
fs.mkdirSync(OUT, { recursive: true });

const h = { checks: 0, fails: 0 };
const ok = (c: boolean, m: string): void => { h.checks++; if (!c) h.fails++; console.log(`${c ? "✓" : "✗"} ${m}`); };

// ---------- 最小可用实体(字段形状对齐 career-panel.dummyPlayer / aura-preview 同款) ----------

function dummy(over: Partial<Player> = {}): Player {
  const sk = CFG.skins.player[0];
  return {
    side: "left", isAI: false,
    theme: { main: sk.main, dark: sk.dark, glow: sk.glow, name: sk.name },
    jersey: "01", aiDiff: null, ai: null, zone: "", teamLabel: "", idx: 0,
    x: 0, y: CFG.court.groundY, vx: 0, vy: 0, px: 0, py: CFG.court.groundY, homeX: 0,
    facing: 1, onGround: true, coyote: 0, jumpBuf: 0, sq: 1, sqPrev: 1, recoverT: 0,
    runPhase: 0, runAmt: 0, runStep: 0, blinkSeed: 0,
    swingT: -1, swingStyle: "over" as const, swingHit: false, swingQ: 0, swingBuf: 0,
    swingBufAim: null, swingAim: "mid", swingRadius: 52,
    racket: { x: 0, y: 0, ang: 0 }, racketPrev: { x: 0, y: 0 },
    hitLock: 0, contactFlash: 0, speedMul: 1, aiAimErr: 0, zoneScale: 1, score: 0,
    smashGlow: 0, sweetGlow: 0, perfectGlow: 0, heat: 0, hitRecoil: 0,
    lungeT: -1, lungeDir: 0, lungeCd: 0, lungeShotT: 0,
    stats: {
      hits: 0, smashes: 0, sweets: 0, perfects: 0, whiffs: 0, lungeShots: 0, jumpSmashes: 0,
      iaiStrikes: 0, skillCasts: 0, deepShots: 0, netIntercepts: 0, airHits: 0, empReturns: 0,
      zonePenalties: 0, exhausted: 0,
    },
    playerSkin: sk, hideTag: true, groundY: CFG.court.groundY,
    faceSkin: { id: "face-auto", kind: "face", name: "auto", price: 0, faceStyle: "auto" },
    ...over,
  } as unknown as Player;
}

/** 渲染一帧,交出笔画(与 drawPlayer 同一入口 —— 预览与真机必须同一支笔) */
function render(p: Player, t: number): StubOp[] {
  __resetPoseState();
  const vp: Viewport = { x: (wx: number) => wx, y: (wy: number) => CFG.court.groundY - wy };
  const g = new StubGraphics();
  drawPlayer(g as unknown as Parameters<typeof drawPlayer>[0], vp, p, t, 0, null);
  return g.ops;
}

// ---------- 三种姿势(待机 / 跑动 / 挥拍峰):挂载点跟随姿势是验收核心 ----------

type Pose = { name: string; over: (t: number) => Partial<Player> };
const POSES: Pose[] = [
  { name: "待机", over: () => ({}) },
  { name: "跑动", over: (t) => ({ runAmt: 1, runPhase: t * 0.42 }) },
  { name: "挥拍", over: () => ({ swingT: 8, swingStyle: "over" as const, swingHit: true }) },
];

function finite(ops: StubOp[]): boolean {
  for (const op of ops) {
    for (const c of op.cmds) {
      for (const v of [c.x, c.y, c.cx, c.cy, c.rx, c.ry, c.w, c.h, c.dx, c.dy]) {
        if (v !== undefined && !Number.isFinite(v)) return false;
      }
    }
  }
  return true;
}

// ---------- 断言 ----------

// 这张出图工具只测**挂件件**(自带 ACC_STYLES 画法的那几件):本体件不往 p.acc 上挂、
// 也没有"孤立静置画"可看,它们的正确性由 look-compose-check 逐键比对合成结果来管。
const ACCS = CFG.accessories.filter((a): a is AccessoryDef => a.kind === "wear");
const ALL_WORN = CFG.accSlots.map((s) => {
  // 面部槽戴墨镜(口罩另出一张),其余有挂件的槽各戴现有一件 —— 满配档
  return s.key === "face" ? ACCS.find((a) => a.id === "acc-shades")
    : ACCS.find((a) => a.slot === s.key);
}).filter((a): a is AccessoryDef => !!a);

// ① 每件配饰上身都多出笔画,且三种姿势都如此
for (const acc of ACCS) {
  const base = render(dummy({ acc: [] }), 30).length;
  const cells: string[] = [];
  let allMore = base > 0;
  for (const pose of POSES) {
    const n = render(dummy({ acc: [acc], ...pose.over(30) }), 30).length;
    if (n <= base) allMore = false;
  }
  ok(allMore, `「${acc.name}」上身三种姿势都比基线多笔画(挂载点真的画了)`);
  // ② ③ 有限坐标 + 同帧确定性
  const ops = render(dummy({ acc: [acc] }), 30);
  ok(finite(ops), `「${acc.name}」坐标全部有限`);
  ok(render(dummy({ acc: [acc] }), 30).length === ops.length, `「${acc.name}」同帧重画笔画数一致(零逐帧 rand)`);
}

// ② 全档:有限坐标(满配档,五件画法同帧在场)
{
  const ops = render(dummy({ acc: ALL_WORN }), 45);
  ok(finite(ops), "满配档(四槽齐戴)坐标全部有限");
}

// ④ 卡片静置画非空
for (const acc of ACCS) {
  const g = new StubGraphics();
  drawAccStill(g as unknown as Parameters<typeof drawAccStill>[0], { x: (w) => w, y: (w) => -w }, acc, 30);
  ok(g.ops.length > 0, `「${acc.name}」卡片静置画非空(${g.ops.length} 笔)`);
}

// ---------- 出图 ----------

const DARK = "#12161f";

function frame(ops: StubOp[], s: number, bg: string, w = 190, h = 230): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="${bg}"/>
<g transform="translate(${w / 2}, ${h - 20}) scale(${s}, ${-s})">${opsToSvg(ops)}</g>
</svg>`;
}

function stillFrameSvg(acc: AccessoryDef): string {
  const g = new StubGraphics();
  drawAccStill(g as unknown as Parameters<typeof drawAccStill>[0], { x: (w) => w, y: (w) => -w }, acc, 30);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="100" viewBox="0 0 90 100">
<rect width="100%" height="100%" fill="#1a1f2e"/>
<g transform="translate(45, 52)">${opsToSvg(g.ops)}</g>
</svg>`;
}

function sheet(title: string, cells: string[], cols: number): string {
  return `<div class="block"><h2>${title}</h2><div class="grid" style="grid-template-columns:repeat(${cols},1fr)">
${cells.map((c) => `<div class="c">${c}</div>`).join("")}
</div></div><div class="sep"></div>`;
}

const parts: string[] = [];

// 每件配饰 × 三姿势(30/34 两拍看围巾摆动)
for (const acc of ACCS) {
  const cells: string[] = [];
  for (const pose of POSES) {
    for (const t of [30, 34]) {
      cells.push(`<span class="lab">${pose.name} · t=${t}</span>` + frame(render(dummy({ acc: [acc], ...pose.over(t) }), t), 1.35, DARK));
    }
  }
  parts.push(sheet(`单件佩戴 · ${acc.name}(${acc.desc})`, cells, 6));
}

// 满配档(四槽齐戴)与口罩换装档
{
  const cells: string[] = [];
  for (const t of [30, 34, 42, 50]) {
    cells.push(`<span class="lab">四槽齐戴 · t=${t}</span>` + frame(render(dummy({ acc: ALL_WORN }), t), 1.35, DARK));
  }
  const withMask = ALL_WORN.map((a) => (a.id === "acc-shades" ? ACCS.find((x) => x.id === "acc-mask")! : a));
  for (const t of [30, 42]) {
    cells.push(`<span class="lab">口罩换墨镜 · t=${t}</span>` + frame(render(dummy({ acc: withMask }), t), 1.35, DARK));
  }
  parts.push(sheet("组合佩戴(跨槽叠加)", cells, 6));
}

// 卡片静置画(商店缩略图同款)
parts.push(sheet("卡片静置画(64×76 缩略图同源)", ACCS.map((a) =>
  `<span class="lab">${a.name} · ${CFG.rarity[a.rarity].name} · ${a.price} 金币</span>` + stillFrameSvg(a)), 5));

const html = `<!doctype html><meta charset="utf-8"><title>accessory preview</title>
<style>
body{background:#0b0e15;color:#dfe6f3;font:13px/1.5 ui-monospace,Menlo,monospace;margin:20px}
h2{font-size:14px;margin:0 0 8px;color:#ffe14d;font-weight:600}
.grid{display:grid;gap:10px}
.c{background:#10141f;border:1px solid #232a3c;padding:6px;display:flex;flex-direction:column;gap:4px;align-items:center}
.lab{font-size:11px;color:#8a93a8}
.sep{height:14px}
svg{display:block}
</style>
${parts.join("\n")}`;
fs.writeFileSync(`${OUT}/acc.html`, html);
console.log(`\n出图:${OUT}/acc.html`);

console.log(h.fails === 0 ? `✓ acc-preview:${h.checks} 项断言全绿` : `✗ acc-preview:${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);
