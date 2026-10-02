// ============================================================
// BGM 唯一烘焙源(把 tools/bake-audio.ts 的 BGM 段整体迁入,遗留的全混音
// 版本已废弃 —— 旧版与 bake-audio 都写 bgm_menu.wav,谁后跑谁覆盖)
//
// 编曲升级(2026-10,对照老仓库 嘟嘟02/src/bgm.js):
//   对局曲 4 小节 → 8 小节 A/B 段:Am-F-C-G | Am-F-Dm-G。
//   A 段保留老 LEAD hook(记忆点),B 段新变奏;Dm 是「pluck-safe」新和弦
//   (A 小调五声 over Dm = 5/b7/root/9/11,全软协和;E 大含 G# 会与拨弦打架,
//   故弃安达卢西亚下行)。军鼓 fill 从 bar3 挪到 bar7(循环末小节)。
//   音色升级:bass 三层(方波+八度+正弦补厚)、lead 三振荡+slap 回声、
//   snare 三层、hat 力度分级、arp 立体声错位;新增 pad 和弦垫 stem。
//   循环 4→8 小节(≈14.5s),配合变奏拉长新鲜感周期。
//   菜单曲独立主题:108 BPM、Am-F-C-G ×2、8 小节长音歌唱性旋律,
//   弃掉旧版「1500Hz 整体压暗的 bass 律动」,改轻 LP 2800 + 编曲本身松弛。
//
// stem 约定:全部 game stem 烘成同长同相(128 步 ≈14.55s),运行时 bgm.ts
// 同帧起播 + 同长 ⇒ 循环相位永锁,A/B 段差异直接烘在谱面里,混音零改动。
// 接缝用 wrap-add 回折(渲染 L+TAIL,尾段逐样本加回头部):比 crossfade
// 适合多 stem —— 不改头部谱面相位,stem 间对齐严格成立。
// 立体声策略:groove/drums/tamb 居中单声道;arp/lead/pad/menu 烘 stereo
// (Cocos AudioSource 对 stereo ogg 三端原生支持,宽度在烘焙端做)。
//
// 用法: npx tsc -p tools/tsconfig.json
//       node .tools-build/tools/bake-bgm.js       ← 写 wav + 打印统计
//       node .tools-build/tools/bgm-check.js      ← 结构断言(内存重渲,不需要 wav)
//       node .tools-build/tools/oggify.js         ← 分发格式是 ogg,烘焙后必须转码
// 产物: assets/resources/audio/bgm/*.wav(经 oggify 转成 .ogg 并删 wav)
// ============================================================
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SR = 44100;
// 从 __dirname 向上找工程根(认 assets/scripts/core/config.ts,避免选中 .tools-build 镜像)
function projectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(dir, "assets", "scripts", "core", "config.ts"))) return dir;
    dir = join(dir, "..");
  }
  throw new Error("找不到工程根(assets/scripts/core/config.ts)");
}
import { existsSync } from "node:fs";
const OUT_DIR = join(projectRoot(), "assets", "resources", "audio", "bgm");

// ---------- 确定性随机(烘焙可复现,diff 友好) ----------
let seed = 0x9e3779b1;
const srand = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return ((seed >>> 0) % 0x7fffff) / 0x7fffff * 2 - 1;   // [-1, 1)
};
const urand = (a: number, b: number) => a + (srand() * 0.5 + 0.5) * (b - a);

// ---------- WebAudio 语义复刻 ----------
type Wave = "sine" | "square" | "sawtooth" | "triangle";
type FilterType = "lowpass" | "highpass" | "bandpass";

const waveAt = (type: Wave, p: number): number => {
  p = p - Math.floor(p);
  switch (type) {
    case "sine": return Math.sin(2 * Math.PI * p);
    case "square": return p < 0.5 ? 1 : -1;
    case "sawtooth": return 2 * p - 1;
    case "triangle": return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
  }
};

// 指数斜坡:v0 → v1 在 dur 内(WebAudio exponentialRampToValueAtTime 语义)
const expramp = (v0: number, v1: number, t: number, dur: number): number =>
  v0 * Math.pow(v1 / v0, Math.min(1, Math.max(0, t / dur)));

interface ToneOpt {
  type?: Wave; f0?: number; f1?: number; t0?: number; dur?: number;
  peak?: number; curve?: "exp" | "lin";
  atk?: number;  // 显式起音时长(pad 长攻击需要;默认 min(0.012, dur*0.2))
  lp?: number;
}

// 振荡器 × 指数包络,可选低通(方波/锯齿去毛刺)。写入 buf(累加)。
function tone(buf: Float32Array, opt: ToneOpt): void {
  const { type = "sine", f0 = 440, f1 = f0, t0 = 0, dur = 0.12, peak = 0.3, curve = "exp", lp = 0 } = opt;
  const start = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  const atk = opt.atk ?? Math.min(0.012, dur * 0.2);
  const bq = lp ? new Biquad() : null;
  if (bq) bq.set("lowpass", lp, 0.8);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = f1 === f0 ? f0
      : curve === "exp" ? expramp(f0, f1, t, dur)
      : f0 + (f1 - f0) * Math.min(1, t / dur);
    phase += (2 * Math.PI * Math.max(20, f)) / SR;
    const env = t < atk ? expramp(0.0001, peak, t, atk) : expramp(peak, 0.0001, t - atk, dur - atk);
    let s = waveAt(type, phase / (2 * Math.PI)) * env;
    if (bq) s = bq.process(s);
    const idx = start + i;
    if (idx >= 0 && idx < buf.length) buf[idx] += s;
  }
}

// RBJ 双二阶(与 WebAudio BiquadFilter 同族)
class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  set(type: FilterType, f: number, q: number): void {
    const w = 2 * Math.PI * Math.max(20, f) / SR;
    const cs = Math.cos(w), sn = Math.sin(w);
    const alpha = sn / (2 * q);
    let b0: number, b1: number, b2: number;
    switch (type) {
      case "lowpass": b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; break;
      case "highpass": b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; break;
      case "bandpass": b0 = alpha; b1 = 0; b2 = -alpha; break;
    }
    const a0 = 1 + alpha, a1 = -2 * cs, a2 = 1 - alpha;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// 白噪声缓冲(1.2s),确定性填充
const NOISE_LEN = Math.round(SR * 1.2);
const noiseBuf = new Float32Array(NOISE_LEN);
for (let i = 0; i < NOISE_LEN; i++) noiseBuf[i] = srand();

interface NoiseOpt {
  t0?: number; dur?: number; peak?: number; type?: FilterType;
  f0?: number; f1?: number; q?: number;
}

function noise(buf: Float32Array, opt: NoiseOpt): void {
  const { t0 = 0, dur = 0.1, peak = 0.2, type = "bandpass", f0 = 1200, f1 = f0, q = 1.2 } = opt;
  const start = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  const rate = urand(0.85, 1.15);
  let pos = Math.floor(urand(0, 0.5) * SR);
  const bq = new Biquad();
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    bq.set(type, f1 === f0 ? f0 : expramp(f0, Math.max(30, f1), t, dur), q);
    pos += rate;
    const s = noiseBuf[(pos | 0) % NOISE_LEN];
    const env = t < 0.006 ? expramp(0.0001, peak, t, 0.006) : expramp(peak, 0.0001, t - 0.006, dur - 0.006);
    const idx = start + i;
    if (idx >= 0 && idx < buf.length) buf[idx] += bq.process(s) * env;
  }
}

// ============================================================
// 乐谱 —— 对局曲(132 BPM,8 小节 A/B 段)
// ============================================================
const BPM = 132;
const STEP = 15 / BPM;                        // 16 分音符时长(秒)
const BARS = 8, SPB = 16;
const NSTEP = BARS * SPB;                     // 128 步 = 8 小节一循环
const STEM_LEN = Math.round(SR * NSTEP * STEP);   // ≈14.55s,全 game stem 同长
const TAIL = 0.6;                             // 回折窗:盖住 lead slap 回声/snare fill 的跨界尾巴

// 8 小节和弦根音(相对 A2 半音):Am F C G | Am F Dm G
const PROG = [0, -4, 3, -2, 0, -4, -7, -2];
// 对应和弦内音(相对根音半音):小和弦 [0,3,7,12],大和弦 [0,4,7,12]
const CHORD = [
  [0, 3, 7, 12], [0, 4, 7, 12], [0, 4, 7, 12], [0, 4, 7, 12],   // Am F C G
  [0, 3, 7, 12], [0, 4, 7, 12], [0, 3, 7, 12], [0, 4, 7, 12],   // Am F Dm G
];
// A 小调五声(两个八度):主旋律/击球 combo 共用,击球 pluck 的和声安全由此保证
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

const PAT = {
  kick:  "x...x...x...x...",   // 四踩底鼓
  snare: "....x.......x...",   // 2/4 拍军鼓
  hat:   "x.x.x.x.x.x.x.x.",   // 闭合镲 8 分(开镲步让位)
  open:  "..x...x...x...x.",   // 反拍开镲
  tamb:  "x.xxx.xxx.xxx.xx",   // 赛点 16 分铃鼓
};
// 贝斯律动(套当前和弦根音,-1=休止,12=高八度)
const BASS = [0, -1, -1, 0, -1, -1, 0, -1, -1, 0, -1, 12, -1, 0, -1, -1];
// 琶音:16 分连流(CHORD 下标)
const ARP = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3];

// 主旋律 hook,8 小节 = A 段(老 hook 逐字保留)+ B 段(新变奏)
// A 段:Am 起句、F 回应、C 推进、G 落回主音
const LEAD_A = [
  [0, -1, 1, -1, 3, -1, 4, 3, 2, -1, 1, -1, -1, -1, -1, -1],
  [0, -1, 1, -1, 2, -1, 1, 0, -1, -1, -1, -1, 0, -1, 4, -1],
  [3, -1, 4, -1, 3, -1, 1, -1, 2, -1, 3, -1, 4, -1, 3, -1],
  [2, -1, 3, -1, 2, -1, 1, -1, 2, 3, 2, 1, 0, -1, -1, -1],
];
// B 段:bar5=bar1 的上三度答句(同节奏型、整体上移、落点改下行);
// bar6=bar2 移位变体;bar7 给新和弦 Dm 专属上行波浪;bar8 级进收束到主音,
// 末尾两拍留白,循环头部的 Am 起句更有推进力
const LEAD_B = [
  [4, -1, 5, -1, 6, -1, 7, 6, 5, -1, 3, -1, -1, -1, -1, -1],
  [5, -1, 6, -1, 7, -1, 6, 5, -1, -1, -1, -1, 5, -1, 7, -1],
  [3, -1, 4, -1, 5, -1, 6, -1, 7, -1, 6, -1, 5, -1, 3, -1],
  [2, -1, 1, -1, 0, -1, 1, -1, 2, -1, 1, -1, 0, -1, -1, -1],
];
const LEAD = [...LEAD_A, ...LEAD_B];

const semi = (base: number, n: number): number => base * Math.pow(2, n / 12);

// ============================================================
// 乐谱 —— 菜单曲(108 BPM,独立主题,Am-F-C-G ×2)
// ============================================================
const MENU_BPM = 108;
const MST = 15 / MENU_BPM;                    // 菜单 16 分步长
const MENU_LEN = Math.round(SR * NSTEP * MST);    // ≈17.78s,菜单独奏自循环
const MENUPROG = [0, -4, 3, -2, 0, -4, 3, -2];
const MENUCHORD = [
  [0, 3, 7, 12], [0, 4, 7, 12], [0, 4, 7, 12], [0, 4, 7, 12],
  [0, 3, 7, 12], [0, 4, 7, 12], [0, 4, 7, 12], [0, 4, 7, 12],
];
// 菜单主题:长音歌唱性旋律(SCALE 度数,-1=休止)。
// 起句两遍(第二遍尾上扬)、E-G 摇摆、级进长下行收束到主音
const MENULEAD = [
  [0, -1, -1, -1, 1, -1, -1, -1, 3, -1, -1, -1, 2, -1, 1, -1],
  [0, -1, -1, -1, -1, -1, -1, -1, 1, -1, 0, -1, -1, -1, -1, -1],
  [3, -1, -1, -1, 4, -1, -1, -1, 3, -1, 2, -1, 1, -1, 2, -1],
  [0, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
  [0, -1, -1, -1, 1, -1, -1, -1, 3, -1, -1, -1, 4, -1, 5, -1],
  [4, -1, -1, -1, 3, -1, -1, -1, 1, -1, 2, -1, 3, -1, 4, -1],
  [5, -1, -1, -1, 4, -1, -1, -1, 3, -1, 4, -1, 5, -1, 6, -1],
  [7, -1, 6, -1, 5, -1, 4, -1, 3, -1, 1, -1, 0, -1, -1, -1],
];

// ============================================================
// 音色(对照 bgm.js 音色名,升级层见注释)
// ============================================================
function vKick(b: Float32Array, t: number): void {
  tone(b, { type: "sine", f0: 165, f1: 42, t0: t, dur: 0.15, peak: 0.95, atk: 0.002 });
}
// 军鼓三层:bandpass 主体 + highpass 炸裂层 + 三角波鼓身 + 鼓壳泛音
function vSnare(b: Float32Array, t: number, v = 1): void {
  noise(b, { t0: t, dur: 0.13, peak: 0.4 * v, type: "bandpass", f0: 1900, q: 0.8 });
  noise(b, { t0: t, dur: 0.05, peak: 0.15 * v, type: "highpass", f0: 3800, q: 1.0 });
  tone(b, { type: "triangle", f0: 210, f1: 140, t0: t, dur: 0.07, peak: 0.16 * v });
  tone(b, { type: "triangle", f0: 330, t0: t, dur: 0.05, peak: 0.08 * v });
}
// 闭合镲力度分级:强拍 0.16 / 反拍 0.12 / 其余 0.08(groove 立刻活)
function vHat(b: Float32Array, t: number, open: boolean, vel = 0.16): void {
  noise(b, { t0: t, dur: open ? 0.24 : 0.04, peak: open ? 0.13 : vel, type: "highpass", f0: 7600, q: 0.7 });
}
const hatVel = (sub: number): number => sub % 4 === 0 ? 0.16 : sub % 2 === 0 ? 0.12 : 0.08;
// 贝斯三层:方波主体(lp700)+ 八度加定义(lp1800)+ 正弦补基频厚度
function vBass(b: Float32Array, t: number, f: number): void {
  tone(b, { type: "square", f0: f, t0: t, dur: 0.2, peak: 0.30, lp: 700 });
  tone(b, { type: "square", f0: f * 2, t0: t, dur: 0.2, peak: 0.09, lp: 1800 });
  tone(b, { type: "sine", f0: f, t0: t, dur: 0.22, peak: 0.18 });
}
function vArp(b: Float32Array, t: number, f: number): void {
  tone(b, { type: "sawtooth", f0: f, t0: t, dur: 0.09, peak: 0.10, lp: 3200 });
}
// 主旋律核心:双失谐方波 + 八度锯齿亮泽;gv 是整组增益(slap 回声用 0.35)
function vLeadCore(b: Float32Array, t: number, f: number, det1: number, det2: number, gv: number): void {
  tone(b, { type: "square", f0: f * det1, t0: t, dur: 0.24, peak: 0.085 * gv, lp: 4200 });
  tone(b, { type: "square", f0: f * det2, t0: t, dur: 0.24, peak: 0.05 * gv, lp: 4200 });
  tone(b, { type: "sawtooth", f0: f * 2, t0: t, dur: 0.18, peak: 0.035 * gv, lp: 5200 });
}
// 立体声 lead:两声道主失谐互换铺宽 + slap 回声(1.5 步 ≈170ms)
function vLead(l: Float32Array, r: Float32Array, t: number, f: number): void {
  vLeadCore(l, t, f, 0.9965, 1.0035, 1);
  vLeadCore(r, t, f, 1.0035, 0.9965, 1);
  vLeadCore(l, t + 1.5 * STEP, f, 0.9965, 1.0035, 0.35);
  vLeadCore(r, t + 1.5 * STEP, f, 1.0035, 0.9965, 0.35);
}
function vTamb(b: Float32Array, t: number): void {
  noise(b, { t0: t, dur: 0.05, peak: 0.11, type: "bandpass", f0: 6800, q: 3 });
}
// 和弦垫:整小节锯齿长音,长攻击(0.8s)柔进入,lp900 暖
function vPadNote(b: Float32Array, t: number, f: number, dur: number, atk: number): void {
  tone(b, { type: "sawtooth", f0: f, t0: t, dur, peak: 0.045, atk, lp: 900 });
}

// ---- 事件 one-shot 音色(与 bake-audio.ts 迁入,逐字保留) ----
function vPluck(b: Float32Array, t: number, f: number, v = 1): void {
  tone(b, { type: "triangle", f0: f, t0: t, dur: 0.16, peak: 0.3 * v });
  tone(b, { type: "square", f0: f, t0: t, dur: 0.07, peak: 0.12 * v, lp: 5000 });
}
function vSmashNote(b: Float32Array, t: number, f: number): void {
  tone(b, { type: "sawtooth", f0: f, t0: t, dur: 0.2, peak: 0.2, lp: 2600 });
  tone(b, { type: "sawtooth", f0: f * 1.5, t0: t, dur: 0.16, peak: 0.14, lp: 2600 });
  noise(b, { t0: t, dur: 0.06, peak: 0.14, type: "highpass", f0: 3200, q: 1.0 });
}
function vStab(b: Float32Array, t: number): void {
  tone(b, { type: "sawtooth", f0: semi(440, 12), t0: t, dur: 0.22, peak: 0.16, lp: 3000 });
  tone(b, { type: "sawtooth", f0: semi(440, 19), t0: t, dur: 0.22, peak: 0.12, lp: 3000 });
  vKick(b, t);
}

// ============================================================
// 渲染:每条 stem 渲染 L+TAIL,wrap-add 回折后截断到 L
// ============================================================
interface StemBuf { name: string; ch: 1 | 2; l: Float32Array; r: Float32Array | null; frames: number; }

// 尾段逐样本加回头部(保谱面相位,stem 间对齐严格成立),然后截断到 L
function foldLoop(b: Float32Array, len: number): Float32Array {
  const tailN = b.length - len;
  for (let i = 0; i < tailN; i++) b[i] += b[len + i];
  return b.subarray(0, len);
}

function newPair(len: number): [Float32Array, Float32Array] {
  return [new Float32Array(len), new Float32Array(len)];
}

function renderGroove(): StemBuf {
  const [l, r] = newPair(STEM_LEN + Math.round(TAIL * SR));
  for (let s = 0; s < NSTEP; s++) {
    const bar = (s >> 4) % BARS, sub = s & 15, t = s * STEP;
    if (PAT.open[sub] === "x") vHat(l, t, true);
    else if (PAT.hat[sub] === "x") vHat(l, t, false, hatVel(sub));
    const bo = BASS[sub];
    if (bo >= 0) vBass(l, t, semi(110, PROG[bar] + bo));
  }
  return { name: "bgm_groove", ch: 1, l: foldLoop(l, STEM_LEN), r: null, frames: STEM_LEN };
}

function renderDrums(): StemBuf {
  const [l, r] = newPair(STEM_LEN + Math.round(TAIL * SR));
  for (let s = 0; s < NSTEP; s++) {
    const bar = (s >> 4) % BARS, sub = s & 15, t = s * STEP;
    if (PAT.kick[sub] === "x") vKick(l, t);
    if (PAT.snare[sub] === "x") vSnare(l, t, 1);
    if (bar === BARS - 1 && sub >= 13) vSnare(l, t, 0.5 + (sub - 13) * 0.25);   // 循环末军鼓 fill
  }
  return { name: "bgm_drums", ch: 1, l: foldLoop(l, STEM_LEN), r: null, frames: STEM_LEN };
}

// 琶音立体声错位:R 声道延迟半步 + 微失谐,16 分连流立刻有宽度
function renderArp(): StemBuf {
  const [l, r] = newPair(STEM_LEN + Math.round(TAIL * SR));
  for (let s = 0; s < NSTEP; s++) {
    const bar = (s >> 4) % BARS, sub = s & 15, t = s * STEP;
    const ai = ARP[sub];
    if (ai >= 0) {
      const f = semi(220, PROG[bar] + CHORD[bar][ai]);
      vArp(l, t, f);
      vArp(r, t + STEP / 2, f * 1.0025);
    }
  }
  return { name: "bgm_arp", ch: 2, l: foldLoop(l, STEM_LEN), r: foldLoop(r, STEM_LEN), frames: STEM_LEN };
}

function renderLead(): StemBuf {
  const [l, r] = newPair(STEM_LEN + Math.round(TAIL * SR));
  for (let s = 0; s < NSTEP; s++) {
    const bar = (s >> 4) % BARS, sub = s & 15, t = s * STEP;
    const deg = LEAD[bar][sub];
    if (deg >= 0) vLead(l, r, t, semi(440, SCALE[deg]));
  }
  return { name: "bgm_lead", ch: 2, l: foldLoop(l, STEM_LEN), r: foldLoop(r, STEM_LEN), frames: STEM_LEN };
}

function renderTamb(): StemBuf {
  const [l, r] = newPair(STEM_LEN + Math.round(TAIL * SR));
  for (let s = 0; s < NSTEP; s++) {
    const sub = s & 15, t = s * STEP;
    if (PAT.tamb[sub] === "x") vTamb(l, t);
  }
  return { name: "bgm_tamb", ch: 1, l: foldLoop(l, STEM_LEN), r: null, frames: STEM_LEN };
}

// 和弦垫 stem:每小节一颗,lvl≥2 起 lvl≥2 跟 drums 一起淡入(运行时 0.55)
// 立体声: L=根音+五音, R=三音+八度,排列换位铺开
function renderPad(): StemBuf {
  const [l, r] = newPair(STEM_LEN + Math.round(TAIL * SR));
  const barDur = SPB * STEP;
  for (let bar = 0; bar < BARS; bar++) {
    const t = bar * barDur, root = PROG[bar], ch = CHORD[bar];
    vPadNote(l, t, semi(110, root + ch[0]), barDur + 0.1, 0.8);
    vPadNote(l, t, semi(110, root + ch[2]), barDur + 0.1, 0.8);
    vPadNote(r, t, semi(110, root + ch[1]), barDur + 0.1, 0.8);
    vPadNote(r, t, semi(110, root + ch[3]), barDur + 0.1, 0.8);
  }
  return { name: "bgm_pad", ch: 2, l: foldLoop(l, STEM_LEN), r: foldLoop(r, STEM_LEN), frames: STEM_LEN };
}

// 菜单曲:独立主题(108 BPM),bass 全音符减半量 + 弱化 hat + pad 垫 +
// 柔 lead(triangle+八度方波亮头),整体轻 LP 2800(松弛但不清哑)
function renderMenu(): StemBuf {
  const len = MENU_LEN + Math.round(TAIL * SR);
  const [l, r] = newPair(len);
  const barDur = SPB * MST;
  for (let s = 0; s < NSTEP; s++) {
    const bar = (s >> 4) % BARS, sub = s & 15, t = s * MST;
    const root = MENUPROG[bar];
    if (sub % 2 === 0 && PAT.hat[sub] === "x") vHat(l, t, false, 0.06);
    if (sub === 0) {
      // 全音符根音 bass(比对局减半量),中央声道
      const f = semi(110, root);
      tone(l, { type: "square", f0: f, t0: t, dur: barDur - 0.2, peak: 0.20, lp: 700 });
      tone(l, { type: "sine", f0: f, t0: t, dur: barDur, peak: 0.10 });
      tone(r, { type: "square", f0: f, t0: t, dur: barDur - 0.2, peak: 0.20, lp: 700 });
      tone(r, { type: "sine", f0: f, t0: t, dur: barDur, peak: 0.10 });
      // 每小节和弦垫,L/R 排列换位
      const ch = MENUCHORD[bar];
      vPadNote(l, t, semi(110, root + ch[0]), barDur + 0.2, 1.0);
      vPadNote(l, t, semi(110, root + ch[2]), barDur + 0.2, 1.0);
      vPadNote(r, t, semi(110, root + ch[1]), barDur + 0.2, 1.0);
      vPadNote(r, t, semi(110, root + ch[3]), barDur + 0.2, 1.0);
    }
    const deg = MENULEAD[bar][sub];
    if (deg >= 0) {
      const f = semi(440, SCALE[deg]);
      // 柔 lead:triangle 长音 + 一点八度方波亮头,轻微失谐铺宽
      tone(l, { type: "triangle", f0: f * 0.998, t0: t, dur: 0.35, peak: 0.11 });
      tone(l, { type: "square", f0: f * 2 * 0.998, t0: t, dur: 0.12, peak: 0.03, lp: 3000 });
      tone(r, { type: "triangle", f0: f * 1.002, t0: t, dur: 0.35, peak: 0.11 });
      tone(r, { type: "square", f0: f * 2 * 1.002, t0: t, dur: 0.12, peak: 0.03, lp: 3000 });
    }
  }
  // 轻 LP 2800 压毛刺(弃掉旧版 1500 整体压暗 —— 菜单难听的直接根因)
  for (const b of [l, r]) {
    const bq = new Biquad();
    bq.set("lowpass", 2800, 0.7);
    for (let i = 0; i < b.length; i++) b[i] = bq.process(b[i]);
  }
  return { name: "bgm_menu", ch: 2, l: foldLoop(l, MENU_LEN), r: foldLoop(r, MENU_LEN), frames: MENU_LEN };
}

// ---- 事件 one-shot 渲染(自 bake-audio.ts 迁入,参数逐字不动) ----
function bakeShot(name: string, render: (b: Float32Array) => void, dur = 0.6): Float32Array {
  const b = new Float32Array(Math.round(SR * dur));
  render(b);
  let end = b.length - 1;
  while (end > 0 && Math.abs(b[end]) < 0.0008) end--;
  return b.subarray(0, Math.min(b.length, end + Math.round(SR * 0.03) + 1));
}

function renderShots(): { name: string; data: Float32Array }[] {
  const out: { name: string; data: Float32Array }[] = [];
  // 击球拨弦 11 音高(五声音阶 combo 爬升;rally 越长音越高)
  for (let i = 0; i < SCALE.length; i++) {
    const n = SCALE[i] + 12;
    out.push({ name: `pluck_${String(i).padStart(2, "0")}`, data: bakeShot(`pluck_${String(i).padStart(2, "0")}`, (b) => vPluck(b, 0, semi(440, n), 1)) });
  }
  // 扣杀拨弦 11 音高(音色更猛)
  for (let i = 0; i < SCALE.length; i++) {
    const n = SCALE[i] + 12;
    out.push({ name: `smash_pluck_${String(i).padStart(2, "0")}`, data: bakeShot(`smash_pluck_${String(i).padStart(2, "0")}`, (b) => vSmashNote(b, 0, semi(440, n))) });
  }
  // 完美/甜蜜泛光(叠加于拨弦之上的"闪光音符")
  out.push({ name: "perfect_shine", data: bakeShot("perfect_shine", (b) => {
    tone(b, { type: "sine", f0: semi(440, 12 + 24), t0: 0.01, dur: 0.12, peak: 0.14 });
    tone(b, { type: "sine", f0: semi(440, 12 + 31), t0: 0.03, dur: 0.1, peak: 0.08 });
  }) });
  out.push({ name: "sweet_shine", data: bakeShot("sweet_shine", (b) => {
    tone(b, { type: "sine", f0: semi(440, 12 + 24), t0: 0.01, dur: 0.1, peak: 0.1 });
  }) });
  // 得分和弦重音 / 平分上行三连音 / 终局 jingle
  out.push({ name: "stab", data: bakeShot("stab", (b) => vStab(b, 0)) });
  out.push({ name: "deuce_sting", data: bakeShot("deuce_sting", (b) => {
    [0, 3, 7].forEach((s, i) => tone(b, { type: "triangle", f0: semi(440, s + 12), t0: i * 0.08, dur: 0.15, peak: 0.12, lp: 4000 }));
  }) });
  out.push({ name: "win_jingle", data: bakeShot("win_jingle", (b) => {
    [0, 4, 7, 12].forEach((s, i) => tone(b, { type: "square", f0: semi(440, s + 12), t0: i * 0.13, dur: 0.18, peak: 0.14, lp: 5000 }));
    tone(b, { type: "square", f0: semi(440, 31), t0: 0.55, dur: 0.5, peak: 0.14, lp: 5000 });
    tone(b, { type: "square", f0: semi(440, 36), t0: 0.55, dur: 0.5, peak: 0.1, lp: 5000 });
    vKick(b, 0);
  }, 1.2) });
  out.push({ name: "lose_jingle", data: bakeShot("lose_jingle", (b) => {
    [0, -5, -9, -12].forEach((s, i) => tone(b, { type: "triangle", f0: semi(440, s + 12), t0: i * 0.22, dur: 0.32, peak: 0.18 }));
  }, 1.2) });
  return out;
}

// ============================================================
// 总线:软限幅 + WAV 封装(mono/stereo)
// ============================================================
const softclip = (v: number): number => Math.tanh(v * 1.1) / Math.tanh(1.1);

function writeWav(name: string, f32: Float32Array, outDir: string = OUT_DIR): string {
  const pcm = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    pcm[i] = Math.max(-1, Math.min(1, softclip(f32[i]))) * 32767;
  }
  const dataLen = pcm.length * 2;
  const out = Buffer.alloc(44 + dataLen);
  out.write("RIFF", 0); out.writeUInt32LE(36 + dataLen, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22); out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < pcm.length; i++) out.writeInt16LE(pcm[i], 44 + i * 2);
  const path = join(outDir, `${name}.wav`);
  writeFileSync(path, out);
  return path;
}

function writeWavStereo(name: string, l: Float32Array, r: Float32Array, outDir: string = OUT_DIR): string {
  const n = Math.min(l.length, r.length);
  const pcm = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    pcm[i * 2] = Math.max(-1, Math.min(1, softclip(l[i]))) * 32767;
    pcm[i * 2 + 1] = Math.max(-1, Math.min(1, softclip(r[i]))) * 32767;
  }
  const dataLen = pcm.length * 2;
  const out = Buffer.alloc(44 + dataLen);
  out.write("RIFF", 0); out.writeUInt32LE(36 + dataLen, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20);
  out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28);
  out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < pcm.length; i++) out.writeInt16LE(pcm[i], 44 + i * 2);
  const path = join(outDir, `${name}.wav`);
  writeFileSync(path, out);
  return path;
}

// ---------- 统计 ----------
export interface StemStats { name: string; ch: 1 | 2; frames: number; peak: number; rms: number; }

function statsOf(name: string, t: StemBuf): StemStats {
  let peak = 0, sum = 0;
  const n = t.l.length;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(t.l[i]);
    if (v > peak) peak = v;
    sum += t.l[i] * t.l[i];
  }
  if (t.r) {
    for (let i = 0; i < n; i++) {
      const v = Math.abs(t.r[i]);
      if (v > peak) peak = v;
      sum += t.r[i] * t.r[i];
    }
  }
  const samples = t.r ? n * 2 : n;
  return { name: t.name, ch: t.ch, frames: n, peak, rms: Math.sqrt(sum / samples) };
}

/** 纯渲染(不写盘、不打印):bgm-check 内存重渲复用,确定性随机保证逐样本一致 */
export function renderAll(): { stems: StemBuf[]; shots: { name: string; data: Float32Array }[] } {
  const stems = [renderGroove(), renderDrums(), renderArp(), renderLead(), renderTamb(), renderPad(), renderMenu()];
  return { stems, shots: renderShots() };
}

// ---------- 主流程 ----------
function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const { stems, shots } = renderAll();

  // 硬断言:全 game stem 同长(运行时同帧起播 + 同长 ⇒ 相位永锁)
  const gameStems = stems.filter((s) => s.name !== "bgm_menu");
  const len0 = gameStems[0].l.length;
  for (const s of gameStems) {
    if (s.l.length !== len0 || (s.r && s.r.length !== len0)) {
      console.error(`✗ stem 长度不一致:${s.name} ${s.l.length} ≠ ${len0} —— 运行时相位会漂移,禁止出包`);
      process.exit(1);
    }
  }

  let kb = 0;
  for (const s of stems) {
    const st = statsOf(s.name, s);
    const p = s.r ? writeWavStereo(s.name, s.l, s.r) : writeWav(s.name, s.l);
    kb += statSync(p).size / 1024;
    console.log(`✓ ${st.name.padEnd(12)} ${(st.frames / SR).toFixed(2)}s  ch=${st.ch}  peak=${st.peak.toFixed(3)}  rms=${st.rms.toFixed(4)}  ${(statSync(p).size / 1024).toFixed(0)} KB`);
  }
  let shotKb = 0;
  for (const sh of shots) shotKb += statSync(writeWav(sh.name, sh.data)).size / 1024;
  console.log(`\n${stems.length} 条 stem(${(STEM_LEN / SR).toFixed(2)}s ×6 game + menu ${(MENU_LEN / SR).toFixed(2)}s)+ ${shots.length} 个 one-shot,共 ${(kb + shotKb).toFixed(0)} KB → ${OUT_DIR}`);
  console.log(`下一步:node .tools-build/tools/bgm-check.js && node .tools-build/tools/oggify.js`);
}

if (require.main === module) main();
