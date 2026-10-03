// ============================================================
// 新手教学演示出图 —— 把三主题 × 各段代表帧画成 SVG,肉眼判「看不看得懂」。
//
// 为什么需要它:AGENTS.md 坑 1/2 —— 编辑器自动化封闭、Cocos 构建产物在内置浏览器
// 永久 hang,这一屏的**观感**在真机之外没有第二条路可看。而断言只能证明「弧线是
// 真值、落点在界内」,证明不了「玩家看完知道手往哪儿动」。
//
// 与 drill-diagram-preview 同一条纪律:**不重抄一遍画面**。直接 import
// render/tutorial-anim(引擎的 Graphics 被 cc-stub 换成记录每一笔画的桩),出的图
// 与真机上画的是同一批多边形。代表帧不是手挑的帧号:扫描整个循环按「段签名」
// 分组取中点 —— 节拍改了(config/烘焙),图自动跟着改。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json
//   node .tools-build/tools/tutorial-demo-preview.js --out .tools-build/tutorial-demo
//   for f in .tools-build/tutorial-demo/*.svg; do
//     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
//       --use-gl=swiftshader --screenshot="$f.png" --window-size=1660,320 "file://$PWD/$f"; done
// ============================================================
import "./cc-stub";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Graphics } from "cc";
import { Graphics as StubGraphics, opsToSvg } from "./cc-stub";
import { TUTORIAL_TOPICS } from "../assets/scripts/core/config";
import * as TutorialAnim from "../assets/scripts/render/tutorial-anim";
import { drawBevelSlot } from "../assets/scripts/ui/p5-paint";
import { SLANT } from "../assets/scripts/ui/p5-tokens";

const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
/** 一格 = 演示画布(430×244)按 K 缩放 */
const K = 0.86;
const GW = Math.round(430 * K), GH = Math.round(244 * K);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** 一块记录型 Graphics 的 SVG 片段(局部 y 向上 → SVG y 向下) */
function shape(cx: number, cy: number, draw: (g: Graphics) => void): string {
  const g = new StubGraphics();
  draw(g as unknown as Graphics);
  return `<g transform="translate(${r2(cx)},${r2(cy)}) scale(1,-1)">${opsToSvg(g.ops)}</g>`;
}

function txt(x: number, y: number, s: string, size: number, hex: string,
  opts: { anchor?: "start" | "middle" | "end"; bold?: boolean } = {}): string {
  const a = opts.anchor ?? "middle";
  return `<text x="${r2(x)}" y="${r2(y + size * 0.36)}" font-family="${FONT}" font-size="${r2(size)}" `
    + `fill="${hex}"${opts.bold ? " font-weight=\"700\"" : ""} text-anchor="${a}">${esc(s)}</text>`;
}

/** 段签名:扫描循环时按它分组(节拍改了,段与代表帧自动跟着改) */
function segOf(topic: number, t: number): string {
  if (topic === 0) {
    const m = TutorialAnim.moveState(t);
    if (!m.pressed) return "松手停住";
    if (m.dwell) return "停稳进圈";
    return t < 20 ? "按下" : "拖动";
  }
  if (topic === 1) {
    const s = TutorialAnim.hitState(t);
    const side = s.deep ? "深球·右滑" : "网前·左滑";
    const name = s.phase === "in" ? "来球" : s.phase === "wind" ? "引拍" : s.phase === "freeze" ? "触球" : s.phase === "out" ? "回球" : "落点";
    return `${side}·${name}`;
  }
  const s = TutorialAnim.jumpState(t);
  const side = s.double ? "双击" : "上滑";
  const name = s.phase === "in" ? "来球" : s.phase === "gesture" ? "手势" : s.phase === "air" ? "腾空" : s.phase === "land" ? "落地" : "定格";
  return `${side}·${name}`;
}

interface Seg { name: string; from: number; to: number }

/** 扫整个循环,按段签名分组(保留首末帧) */
function segsOf(topic: number): Seg[] {
  const loop = TutorialAnim.loopOf(topic);
  const out: Seg[] = [];
  let cur: Seg | null = null;
  for (let t = 0; t < loop; t++) {
    const name = segOf(topic, t);
    if (cur && cur.name === name) cur.to = t;
    else {
      if (cur && cur.to - cur.from >= 3) out.push(cur);
      cur = { name, from: t, to: t };
    }
  }
  if (cur && cur.to - cur.from >= 3) out.push(cur);
  return out;
}

/** 一张定格画面 */
function frame(topic: number, f: number, label: string, ox: number, oy: number): string {
  const rig = TutorialAnim.build(topic);
  rig.t = f;
  const parts: string[] = [];
  parts.push(shape(ox + GW / 2, oy + GH / 2, (g) => drawBevelSlot(g, GW, GH, SLANT.block, "#0d1120")));
  parts.push(shape(ox + GW / 2, oy + GH / 2, (g) => TutorialAnim.drawFrame(g, rig, GW, GH)));
  for (const c of TutorialAnim.callouts(rig, GW, GH)) {
    parts.push(txt(ox + GW / 2 + c.x * K, oy + GH / 2 - c.y * K, c.text, c.size * K, c.hex, { bold: true }));
  }
  parts.push(txt(ox + 8, oy + 14, label, 13, "#f5f1e6", { anchor: "start", bold: true }));
  return parts.join("");
}

const TOPIC_NAMES = ["移动", "击球", "起跳"];

function sheet(topic: number): { svg: string; w: number; h: number } {
  const segs = segsOf(topic);
  const gap = 18, pad = 24, padTop = 44;
  const w = pad * 2 + segs.length * GW + (segs.length - 1) * gap;
  const h = padTop + GH + 28;
  const out: string[] = [];
  out.push(txt(pad, 26, `${TOPIC_NAMES[topic]}演示 · 每段一张代表帧(与真机同一批多边形;弧线/站位/跳跃全是烘焙真值)`, 16, "#f5f1e6", { anchor: "start", bold: true }));
  segs.forEach((seg, i) => {
    const ox = pad + i * (GW + gap);
    const f = Math.floor((seg.from + seg.to) / 2);
    out.push(frame(topic, f, `${seg.name}  t=${f}`, ox, padTop));
  });
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(w)}" height="${r2(h)}" viewBox="0 0 ${r2(w)} ${r2(h)}">`
    + `<rect width="100%" height="100%" fill="#0d0f16"/>${out.join("")}</svg>`, w, h };
}

const outIdx = process.argv.indexOf("--out");
const dir = outIdx >= 0 ? process.argv[outIdx + 1] : ".tools-build/tutorial-demo";
mkdirSync(dir, { recursive: true });

// ---------- 节拍自检:循环长合法、advance 一个循环后回卷、每主题段覆盖完整 ----------
let bad = 0;
for (let topic = 0; topic < 3; topic++) {
  const loop = TutorialAnim.loopOf(topic);
  if (loop <= 0) { console.log(`✗ 主题 ${topic} 循环长 ${loop} 非法`); bad++; continue; }
  const rig = TutorialAnim.build(topic);
  TutorialAnim.advance(rig, (loop - 0.5) / 60);
  TutorialAnim.advance(rig, 1 / 60);
  if (rig.t >= loop) { console.log(`✗ 主题 ${topic} advance 越过循环没有回卷(t=${rig.t} loop=${loop})`); bad++; }
  const segs = segsOf(topic);
  // 段覆盖检查:击球必须有深球与网前两圈,起跳必须有上滑与双击两式
  const names = segs.map((s) => s.name).join("|");
  if (topic === 1 && !names.includes("深球") ) { console.log(`✗ 击球演示缺深球圈:${names}`); bad++; }
  if (topic === 1 && !names.includes("网前")) { console.log(`✗ 击球演示缺网前圈:${names}`); bad++; }
  if (topic === 2 && !names.includes("上滑")) { console.log(`✗ 起跳演示缺上滑圈:${names}`); bad++; }
  if (topic === 2 && !names.includes("双击")) { console.log(`✗ 起跳演示缺双击圈:${names}`); bad++; }
  console.log(`✓ ${TOPIC_NAMES[topic]} 循环 ${loop} 帧 ≈ ${(loop / 60).toFixed(1)}s · ${segs.length} 段`);
}

const index: string[] = [];
for (let topic = 0; topic < 3; topic++) {
  const s = sheet(topic);
  const file = join(dir, `topic-${topic}-${TUTORIAL_TOPICS[topic].id}.svg`);
  writeFileSync(file, s.svg);
  index.push(`<li><a href="topic-${topic}-${TUTORIAL_TOPICS[topic].id}.svg">${TOPIC_NAMES[topic]}(${TUTORIAL_TOPICS[topic].id})</a> ${s.w.toFixed(0)}×${s.h.toFixed(0)}</li>`);
  console.log(`✓ ${TOPIC_NAMES[topic]} 出图 ${s.w.toFixed(0)}×${s.h.toFixed(0)}`);
}
writeFileSync(join(dir, "index.html"),
  `<!meta charset="utf-8"><body style="background:#0d0f16;color:#efe7d6;font-family:${FONT}">`
  + `<h3>新手教学演示 · 三主题分帧</h3><ul>${index.join("")}</ul>`
  + `<p style="color:#9aa4c0">每格 = 演示画布一段的代表帧(与真机同一批 Graphics 笔画 + 同一批标字坐标)。弧线/站位/跳跃高度全部来自 core/tutorial-demo 的烘焙真值。</p></body>`);
console.log(bad ? `\n${bad} 处节拍问题` : "\n节拍自洽,三张图已出");
process.exit(bad ? 1 : 0);
