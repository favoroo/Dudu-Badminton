// ============================================================
// 背景音乐离线烘焙(决策③:音频烘焙成文件)
// 把老仓库 src/bgm.js 的 WebAudio 现场合成(4 小节 Am-F-C-G 和弦进程
// + kick/snare/hat/bass/arp/lead 分层编曲)等价离线渲染成 WAV 循环片段:
//   bgm_menu.wav —— 仅 groove 层(bass + closed hat)+ 低通压暗,平静轻快
//   bgm_game.wav —— 全层(kick/snare/open hat/bass/arp/lead + 末段 snare fill)
// 首尾用等功率交叉淡化(Zero-crossing crossfade)处理跨循环边界,
// 播放器循环时听不到接缝;运行时不再有任何合成开销。
// 合成原语(tone/noise/Biquad)与 bake-audio.ts 同源、自包含。
//
// 用法: npx tsc -p tools/tsconfig.json && node .tools-build/tools/bake-bgm.js
//       && node .tools-build/tools/oggify.js   ← 分发格式是 ogg,烘焙后必须转码
// 产物: assets/resources/audio/bgm/*.wav(经 oggify 转成 .ogg 并删 wav)
// ============================================================
import { writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
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
const OUT_DIR = join(projectRoot(), "assets", "resources", "audio", "bgm");

// ---------- 确定性随机(烘焙可复现,diff 友好) ----------
let seed = 0x9e3779b1;
const srand = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return ((seed >>> 0) % 0x7fffff) / 0x7fffff * 2 - 1;   // [-1, 1)
};
const urand = (a: number, b: number) => a + (srand() * 0.5 + 0.5) * (b - a);

// ---------- WebAudio 语义复刻(与 bake-audio.ts 一致) ----------
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
  peak?: number; atk?: number; curve?: "exp" | "lin"; lp?: number;
}

// 振荡器 × 指数包络,可选低通(方波/锯齿去毛刺)。写入 buf(累加)。
function tone(buf: Float32Array, opt: ToneOpt): void {
  const { type = "sine", f0 = 440, f1 = f0, t0 = 0, dur = 0.12, peak = 0.3, curve = "exp", lp = 0 } = opt;
  const start = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  const atk = opt.atk ?? Math.min(0.012, dur * 0.2);   // bgm.js vKick 传 0.002 抢锐起音
  let phase = 0;
  // 低通链(逐采样系数随频率斜坡更新,同 bake-audio)
  const bq = lp ? new Biquad() : null;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = f1 === f0 ? f0
      : curve === "exp" ? expramp(f0, f1, t, dur)
      : f0 + (f1 - f0) * Math.min(1, t / dur);
    phase += (2 * Math.PI * Math.max(20, f)) / SR;
    const env = t < atk ? expramp(0.0001, peak, t, atk) : expramp(peak, 0.0001, t - atk, dur - atk);
    let s = waveAt(type, phase / (2 * Math.PI)) * env;
    if (bq) { bq.set("lowpass", lp, 0.8); s = bq.process(s); }
    const idx = start + i;
    if (idx >= 0 && idx < buf.length) buf[idx] += s;
  }
}

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
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

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

// ---------- 乐谱(逐字照抄 src/bgm.js) ----------
// 和弦进行 Am-F-C-G(相对 A2 半音),四小节一循环
const PROG = [0, -4, 3, -2];
// 各小节和弦内音(相对根音半音):Am 小三和弦,其余大三
const CHORD = [[0, 3, 7, 12], [0, 4, 7, 12], [0, 4, 7, 12], [0, 4, 7, 12]];
// A 小调五声(两个八度):主旋律用
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

const PAT = {
  kick:  "x...x...x...x...",   // 四踩底鼓
  snare: "....x.......x...",   // 2/4 拍军鼓
  hat:   "x.x.x.x.x.x.x.x.",   // 闭合镲 8 分
  open:  "..x...x...x...x.",   // 反拍开镲
};
// 贝斯:每小节同一律动,套进当前和弦根音(-1=休止)
const BASS = [0, -1, -1, 0, -1, -1, 0, -1, -1, 0, -1, 12, -1, 0, -1, -1];
// 琶音:16 分连流,在和弦内音里上下行(CHORD 下标)
const ARP = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3];
// 主旋律 hook:4 小节一句(SCALE 度数,-1=休止)
const LEAD = [
  [0, -1, 1, -1, 3, -1, 4, 3, 2, -1, 1, -1, -1, -1, -1, -1],
  [0, -1, 1, -1, 2, -1, 1, 0, -1, -1, -1, -1, 0, -1, 4, -1],
  [3, -1, 4, -1, 3, -1, 1, -1, 2, -1, 3, -1, 4, -1, 3, -1],
  [2, -1, 3, -1, 2, -1, 1, -1, 2, 3, 2, 1, 0, -1, -1, -1],
];

const BPM = 132;
const STEP_DUR = 15 / BPM;            // 16 分音符时长(秒),与 bgm.js stepDur 一致
const BARS = 4;                        // 一个和弦进程 = 4 小节,自然循环单元
const STEPS = BARS * 16;
const LOOP_DUR = STEPS * STEP_DUR;     // ≈7.27s

const freq = (base: number, semi: number) => base * Math.pow(2, semi / 12);

// ---------- 音色(逐字对照 bgm.js,层增益 base 烘进峰值) ----------
// 层增益取 bgm.js applyState 的目标值(groove=1 / drums=1 / arp=0.9 / lead=1)
const G = { groove: 1, drums: 1, arp: 0.9, lead: 1 };

function vKick(buf: Float32Array, t: number): void {
  tone(buf, { type: "sine", f0: 165, f1: 42, dur: 0.15, peak: 0.95 * G.drums, atk: 0.002, t0: t });
}
function vSnare(buf: Float32Array, t: number, v = 1): void {
  noise(buf, { dur: 0.13, peak: 0.4 * v * G.drums, type: "bandpass", f0: 1900, q: 0.8, t0: t });
  tone(buf, { type: "triangle", f0: 210, f1: 140, dur: 0.07, peak: 0.16 * v * G.drums, t0: t });
}
function vHat(buf: Float32Array, t: number, open: boolean): void {
  noise(buf, { dur: open ? 0.24 : 0.04, peak: (open ? 0.13 : 0.16) * G.groove, type: "highpass", f0: 7600, q: 0.7, t0: t });
}
function vBass(buf: Float32Array, t: number, f: number): void {
  tone(buf, { type: "square", f0: f, dur: 0.2, peak: 0.42 * G.groove, t0: t, lp: 820 });
}
function vArp(buf: Float32Array, t: number, f: number): void {
  tone(buf, { type: "sawtooth", f0: f, dur: 0.09, peak: 0.13 * G.arp, t0: t, lp: 3200 });
}
function vLead(buf: Float32Array, t: number, f: number): void {
  // 双振荡器微失谐,芯片音色也有宽度
  tone(buf, { type: "square", f0: f * 0.996, dur: 0.24, peak: 0.1 * G.lead, t0: t, lp: 4200 });
  tone(buf, { type: "square", f0: f * 1.004, dur: 0.24, peak: 0.1 * G.lead, t0: t, lp: 4200 });
}

// ---------- 调度(对照 bgm.js scheduleStep) ----------
// level:1=menu(仅 bass+closed hat) / 4=game(全层)
function schedule(buf: Float32Array, level: 1 | 4): void {
  for (let s = 0; s < STEPS; s++) {
    const bar = (s >> 4) % 4, sub = s & 15;
    const root = PROG[bar];
    const t = s * STEP_DUR;
    // 律动底(永远在):开镲步让位给闭合镲
    if (level >= 2 && PAT.open[sub] === "x") vHat(buf, t, true);
    else if (PAT.hat[sub] === "x") vHat(buf, t, false);
    const bo = BASS[sub];
    if (bo >= 0) vBass(buf, t, freq(110, root + bo));
    if (level >= 2) {
      if (PAT.kick[sub] === "x") vKick(buf, t);
      if (PAT.snare[sub] === "x") vSnare(buf, t, 1);
      if (bar === 3 && sub >= 13) vSnare(buf, t, 0.5 + (sub - 13) * 0.25);   // 循环末军鼓 fill
    }
    if (level >= 3) {
      const ai = ARP[sub];
      if (ai >= 0) vArp(buf, t, freq(220, root + CHORD[bar][ai]));
    }
    if (level >= 4) {
      const deg = LEAD[bar][sub];
      if (deg >= 0) vLead(buf, t, freq(440, SCALE[deg]));
    }
  }
}

// ---------- 首尾无缝循环:等功率交叉淡化 ----------
// 渲染 L + fade 长度,把跨过循环末尾的尾巴(如末段 snare fill)折叠回
// 头部:out[i] = head[i]*sin + tail[i]*cos,等功率过渡无接缝。
function crossfadeLoop(buf: Float32Array, L: number, fadeLen: number): Float32Array {
  const out = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    let s = buf[i];
    if (i < fadeLen) {
      const a = (i / fadeLen) * Math.PI / 2;     // 头部淡入 / 尾部淡出
      const tail = L + i < buf.length ? buf[L + i] : 0;
      s = buf[i] * Math.sin(a) + tail * Math.cos(a);
    }
    out[i] = s;
  }
  return out;
}

// ---------- 主总线:主音量 + 菜单低通压暗 + 软限幅 ----------
const MASTER_VOL = 0.5;   // CFG.bgm.volume

function masterize(buf: Float32Array, menu: boolean): Float32Array {
  // 菜单/终局把高频压暗(松弛),比赛全开 —— 对照 bgm.js gFilter
  let out = buf;
  if (menu) {
    const lp = new Biquad();
    const o = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i++) { lp.set("lowpass", 1500, 0.7); o[i] = lp.process(buf[i]); }
    out = o;
  }
  for (let i = 0; i < out.length; i++) out[i] *= MASTER_VOL;
  return out;
}

// ---------- WAV 封装(16-bit PCM mono) ----------
function writeWav(name: string, f32: Float32Array): string {
  // 软限幅:tanh 只压超大概率用到的峰值,小信号几乎无损,保持层间相对响度
  const pcm = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.tanh(f32[i] * 1.1) / Math.tanh(1.1);
    pcm[i] = Math.max(-1, Math.min(1, v)) * 32767;
  }
  const dataLen = pcm.length * 2;
  const out = Buffer.alloc(44 + dataLen);
  out.write("RIFF", 0); out.writeUInt32LE(36 + dataLen, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22); out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < pcm.length; i++) out.writeInt16LE(pcm[i], 44 + i * 2);
  const path = join(OUT_DIR, `${name}.wav`);
  writeFileSync(path, out);
  return path;
}

// ---------- 烘焙 ----------
mkdirSync(OUT_DIR, { recursive: true });

const L = Math.round(LOOP_DUR * SR);
const FADE = Math.round(0.012 * SR);   // 12ms:盖住末段 snare fill 尾,又不过度软化 downbeat

interface Track { name: string; level: 1 | 4; menu: boolean; }
const TRACKS: Track[] = [
  { name: "bgm_menu", level: 1, menu: true },
  { name: "bgm_game", level: 4, menu: false },
];

let total = 0;
for (const tr of TRACKS) {
  const buf = new Float32Array(L + FADE);
  schedule(buf, tr.level);
  const mastered = masterize(buf, tr.menu);
  const looped = crossfadeLoop(mastered, L, FADE);
  const p = writeWav(tr.name, looped);
  const kb = (statSync(p).size / 1024).toFixed(1);
  total += Number(kb);
  console.log(`✓ ${tr.name.padEnd(10)} ${(looped.length / SR).toFixed(2)}s  ${kb} KB  (lvl=${tr.level})`);
}
console.log(`\n${TRACKS.length} 条 BGM 循环,共 ${total.toFixed(0)} KB → ${OUT_DIR}`);
