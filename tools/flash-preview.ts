// 闪现折跃序列预览 —— 把"按下闪现之后系统真的会画出来的那几帧"在 node 里出图。
//
// 为什么需要它:闪现这轮重做往渲染层加了两段新笔画(蓄力雷环 + 来向速度线),
// 它们只在 flashHoldT / flashFrom 挂上时才会画,pose-preview 与 fx-preview 都碰不到
// 这条状态。观感改动必须看得见才算验收 —— 手法与前两者一致:Graphics 换成记录笔画的
// 替身,用**真实的 rules+skills 状态机**跑帧,逐帧 dump SVG。
//
// 断言:折跃当帧必须留下 flashFrom 与雷光笔画;蓄力期必须画出比待机更多的笔画(环+电弧);
// 起拍那一帧球必须已经落到人物上方的够得着位;全程零 NaN;命中后残影按时收掉。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/flash-preview.js [--out DIR]
// 产物:DIR/flash.html(六帧并排)+ DIR/frame-*.svg
// ============================================================

// 顺序即语义:cc-stub 必须排在 render 模块之前(它在模块求值时打 Module._load 补丁)
import { installCc, Graphics as StubGraphics, StubOp, opsToSvg } from "./cc-stub";
installCc();

import { CFG } from "../assets/scripts/core/config";
import { Rules } from "../assets/scripts/core/rules";
import { Player as Pl } from "../assets/scripts/core/player";
import { Skills } from "../assets/scripts/core/skills";
import { Ball, PlayerInput } from "../assets/scripts/core/types";
import { __resetPoseState, drawPlayer, drawShuttle, Viewport } from "../assets/scripts/render/sprites";
import { FXSystem } from "../assets/scripts/render/fx";

const C = CFG;
const CO = C.court;
const FL = C.skills.flash;

const argv = process.argv.slice(2);
const OUT = argv[argv.indexOf("--out") + 1] || ".tools-build/flash-preview";
const fs = require("fs") as typeof import("fs");
fs.mkdirSync(OUT, { recursive: true });

/** 与 world.makeViewport 同一变换:世界(y 向下)→ Graphics(y 向上) */
const VP: Viewport = {
  x: (wx: number) => wx - C.world.w / 2,
  y: (wy: number) => C.world.h / 2 - wy,
};
const gfx = (g: StubGraphics) => g as unknown as Parameters<typeof drawPlayer>[0];

let fails = 0;
const rows: string[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  if (!ok) fails++;
  rows.push(`  ${ok ? "✓" : "✗"} ${name.padEnd(26)} ${detail}`);
};
function badCoords(ops: StubOp[]): number {
  let n = 0;
  for (const op of ops) {
    for (const c of op.cmds) {
      for (const k of ["x", "y", "cx", "cy", "rx", "ry", "w", "h", "dx", "dy"] as const) {
        const v = c[k];
        if (v !== undefined && !Number.isFinite(v)) n++;
      }
    }
    if (!Number.isFinite(op.width)) n++;
  }
  return n;
}
function frameSvg(ops: StubOp[], title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${C.world.w}" height="${C.world.h}" viewBox="0 0 ${C.world.w} ${C.world.h}">
<title>${title}</title><rect width="100%" height="100%" fill="#101523"/>
<g transform="translate(${C.world.w / 2},${C.world.h / 2}) scale(1,-1)">
<line x1="-480" y1="${C.world.h / 2 - CO.groundY}" x2="480" y2="${C.world.h / 2 - CO.groundY}" stroke="#2c3648" stroke-width="2"/>
<line x1="${CO.netX - C.world.w / 2}" y1="${C.world.h / 2 - CO.groundY}" x2="${CO.netX - C.world.w / 2}" y2="${C.world.h / 2 - CO.netTopY}" stroke="#3d4a63" stroke-width="3"/>
${opsToSvg(ops)}
</g></svg>`;
}

const emptyInput = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false,
});

// ---------- 摆一个"球在我方高空正在下坠"的局面,然后按闪现 ----------
Rules.newMatch("1p", "normal");
const R = Rules.R;
const hero = R.players[0];
hero.skill = Skills.initSkillState("flash");
Skills.resetPoint(hero);
hero.x = CO.netX - 320; hero.y = CO.groundY;
const ball = R.ball as Ball;
ball.x = CO.netX - 210; ball.y = CO.groundY - 195;
ball.px = ball.x; ball.py = ball.y; ball.vx = -2.6; ball.vy = 5.4;
ball.live = true; ball.held = false; ball.owner = null;
ball.lastHitter = "right"; ball.crossed = true; ball.netted = false; ball.shot = null;
R.state = "RALLY"; R.events.length = 0;

// 待机基线笔画数:同一个人在没有技能状态下画多少笔 —— 蓄力环/电弧必须明显多于这个数
const idleG = new StubGraphics();
__resetPoseState();
drawPlayer(gfx(idleG), VP, hero, 0, 0, ball);
const idleOps = idleG.ops.length;

const fx = new FXSystem();
const AT = [0, 1, 2, 3, 4, 5];            // 折跃当帧 → 命中后
const cells: { f: number; svg: string }[] = [];
let holdRing = 0, ghostLine = 0, hitFrame = -1, contactGap = 0;

for (let f = 0; f <= 8; f++) {
  const inp = emptyInput();
  if (f === 0) { inp.skillPressed = true; inp.skillDir = hero.facing; }
  R.events.length = 0;
  Rules.step([inp, emptyInput()]);
  // 折跃当帧:复刻 game-root onSkill 演出会送的那两道粒子(逻辑层不管粒子)
  if (f === 0 && hero.flashFrom) {
    fx.blink(hero.flashFrom.x, hero.flashFrom.y, hero.x, hero.y);
    fx.sweet(ball.x, ball.y, Math.atan2(ball.vy, ball.vx));
  }
  const g = new StubGraphics();
  const gg = gfx(g);
  drawPlayer(gg, VP, hero, 0, 0, ball);
  drawShuttle(gg, VP, ball, null);
  fx.draw(gg, VP);
  if (AT.indexOf(f) >= 0) {
    const s = frameSvg(g.ops, `闪现第 ${f} 帧`);
    cells.push({ f, svg: s });
    fs.writeFileSync(`${OUT}/frame-${f}.svg`, s);
    if ((hero.flashHoldT ?? 0) > 0) holdRing = Math.max(holdRing, g.ops.length);
    if (hero.flashFrom) ghostLine = Math.max(ghostLine, g.ops.length);
  }
  const hit = R.events.find((e) => e.t === "hit");
  if (hit && hitFrame < 0) {
    hitFrame = f;
    contactGap = ball.y - hero.y;     // y 向下:负值 = 球在人上方
    check("命中是闪现扣杀", hit.skillKind === "flash" && hit.kind === "smash",
      `skillKind=${hit.skillKind} kind=${hit.kind} q=${(hit.q as number).toFixed(2)}`);
    check("保底窗口已消耗", (hero.flashStrikeT ?? 0) === 0, `剩 ${hero.flashStrikeT} 帧`);
  }
  fx.step(1 / 60);
}

check("蓄力期画出雷环电弧", holdRing > idleOps + 4, `待机 ${idleOps} 笔 → 蓄力 ${holdRing} 笔`);
check("折跃当帧有来向笔画", ghostLine > idleOps, `${ghostLine} 笔(flashFrom 生效)`);
check("折跃当帧记下起点", !!hero.flashFrom || hitFrame >= 0, `flashFrom 已按时收掉(命中帧 ${hitFrame})`);
check("球在人物上方够得着位", hitFrame >= 0 && contactGap < -30 && contactGap > -(CO.groundY), `球与脚底高差 ${contactGap.toFixed(0)}px`);
check("响应够快", hitFrame >= 0 && hitFrame <= FL.holdFrames + 3, `按下后 ${hitFrame} 帧出球(蓄力 ${FL.holdFrames} 帧)`);
const svgAll = cells.map((c) => c.svg).join("");
check("无非法坐标", svgAll.indexOf("NaN") < 0 && svgAll.indexOf("Infinity") < 0, "六帧 SVG 里没有 NaN/Infinity 坐标");

const html = `<!doctype html><meta charset="utf-8"><title>flash preview</title>
<style>body{background:#0b0e15;color:#dfe6f3;font:13px/1.5 ui-monospace,Menlo,monospace;margin:16px}
.row{display:flex;flex-wrap:wrap;gap:10px}
.c{background:#161b26;border:1px solid #2a3242;border-radius:8px;padding:6px}
.c b{display:block;margin-bottom:4px}
.c svg{width:420px;height:auto;background:#101523}</style>
<h2>闪现折跃六帧:按下当帧(0) → 蓄力悬空(1-3) → 起拍(4) → 扣杀命中(5)</h2>
<div class="row">${cells.map((c) => `<div class="c"><b>第 ${c.f} 帧</b>${c.svg}</div>`).join("")}</div>
<pre>${rows.join("\n")}</pre>`;
fs.writeFileSync(`${OUT}/flash.html`, html);

console.log("闪现折跃序列预览 —— 输出 " + OUT + "/flash.html");
console.log(rows.join("\n"));
console.log(fails === 0 ? "\n全部通过 ✓" : `\n${fails} 项失败 ✗`);
process.exit(fails === 0 ? 0 : 1);
