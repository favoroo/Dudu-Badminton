// ============================================================
// 音效离线烘焙(决策③:音频烘焙成文件)
// 把老仓库 audio.js 的 WebAudio 现场合成为数学等价的离线渲染:
//   tone  = 振荡器(sine/square/sawtooth/triangle + 频率指数/线性斜坡) × 指数包络
//   noise = 白噪声缓冲(带随机速率/偏移) × RBJ 双二阶滤波(lowpass/highpass/bandpass) × 指数包络
// 每个音色渲染成单声道 WAV,Cocos 三端(Web/微信/安卓)零解码延迟直放。
// 参数与老 audio.js 逐一对照,游戏运行时不再有任何合成开销。
//
// 用法: npx tsc -p tools/tsconfig.json && node .tools-build/tools/bake-audio.js
// 产物: assets/resources/audio/sfx/*.wav(音效保持 wav:短样本零解码延迟)
//       本脚本末段还烘焙 bgm stem 到 assets/resources/audio/bgm/*.wav ——
//       那部分是循环长样本,分发格式为 ogg,烘焙后必须跑 node .tools-build/tools/oggify.js
// ============================================================
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SR = 44100;
// 兼容两种运行方式(tsc 产物在 .tools-build/tools/ 下 / 直接跑源码在 tools/ 下):
// 从 __dirname 向上找到 assets/ 所在的工程根
import { existsSync } from "node:fs";
function projectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    // 认准只在工程根存在的文件,防止选中 .tools-build 这类镜像目录
    if (existsSync(join(dir, "assets", "scripts", "core", "config.ts"))) return dir;
    dir = join(dir, "..");
  }
  throw new Error("找不到工程根(assets/scripts/core/config.ts)");
}
const OUT_DIR = join(projectRoot(), "assets", "resources", "audio", "sfx");

// ---------- 确定性随机(烘焙可复现,diff 友好) ----------
let seed = 0x2f6e2b1;
const srand = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return ((seed >>> 0) % 0x7fffff) / 0x7fffff * 2 - 1;   // [-1, 1)
};
// 老实现用 Math.random(),这里用同分布的确定性替代;偏移类参数取 [a,b) 均匀
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
  lp?: number;   // 低通截止频率(对照 bgm.js osc() 的可选 lp;方/锯过 lowpass 去毛刺)
}

function tone(buf: Float32Array, opt: ToneOpt): void {
  const { type = "sine", f0 = 440, f1 = f0, t0 = 0, dur = 0.12, peak = 0.3, curve = "exp", lp = 0 } = opt;
  const start = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  const atk = Math.min(0.012, dur * 0.2);
  const bq = lp ? new Biquad() : null;
  if (bq) bq.set("lowpass", lp, 0.8);            // 老实现 osc 的 lp biquad Q=0.8
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

// RBJ 双二阶(与 WebAudio BiquadFilter 同族):每步按当前截止频率重算系数
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

// 白噪声缓冲:与运行时 makeNoise 同长(1.2s),确定性填充
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
  const rate = urand(0.85, 1.15);           // 老实现:playbackRate 随机
  let pos = Math.floor(urand(0, 0.5) * SR); // 老实现:缓冲内随机起点
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

// ---------- 音色表:与 audio.js SFX 逐条对照 ----------
interface SfxDef { name: string; render(buf: Float32Array): void }

const HOT = true, PLAIN = false;

const SFX: SfxDef[] = [
  { name: "swing", render: (b) => {
    noise(b, { dur: 0.13, peak: 0.10, type: "bandpass", f0: 900, f1: 2600, q: 0.7 });
    tone(b, { type: "triangle", f0: 300, f1: 120, dur: 0.08, peak: 0.05 });
  } },
  { name: "whiff", render: (b) => {
    noise(b, { dur: 0.16, peak: 0.07, type: "bandpass", f0: 500, f1: 220, q: 0.6 });
  } },
  // 击球八变体:hot(扣杀/劈吊的音头) × 档位(普通/好球/甜蜜/完美)。
  // 老实现里 q 只用来分「普通 vs ≥0.86」档,sweet/perfect 优先级更高,
  // 所以离散化成 8 个文件不丢任何听感分支。
  { name: "hit_n", render: (b) => hitLike(b, PLAIN, 0.5, false, false) },
  { name: "hit_n86", render: (b) => hitLike(b, PLAIN, 0.9, false, false) },
  { name: "hit_nsweet", render: (b) => hitLike(b, PLAIN, 1, true, false) },
  { name: "hit_nperfect", render: (b) => hitLike(b, PLAIN, 1, false, true) },
  { name: "hit_hot", render: (b) => hitLike(b, HOT, 0.5, false, false) },
  { name: "hit_hot86", render: (b) => hitLike(b, HOT, 0.9, false, false) },
  { name: "hit_hotsweet", render: (b) => hitLike(b, HOT, 1, true, false) },
  { name: "hit_hotperfect", render: (b) => hitLike(b, HOT, 1, false, true) },
  { name: "smash", render: (b) => {
    tone(b, { type: "sawtooth", f0: 360, f1: 45, dur: 0.28, peak: 0.24 });
    tone(b, { type: "sine", f0: 180, f1: 30, dur: 0.32, peak: 0.30 });
    noise(b, { dur: 0.26, peak: 0.22, type: "lowpass", f0: 3800, f1: 200, q: 1.8 });
    noise(b, { dur: 0.08, peak: 0.20, type: "highpass", f0: 3500, f1: 1800, q: 1.0 });
  } },
  { name: "net", render: (b) => {
    noise(b, { dur: 0.22, peak: 0.16, type: "lowpass", f0: 700, f1: 180, q: 1 });
    tone(b, { type: "sine", f0: 150, f1: 70, dur: 0.18, peak: 0.14 });
  } },
  { name: "floor_05", render: (b) => floorLike(b, 0.5) },
  { name: "floor_10", render: (b) => floorLike(b, 1.0) },
  { name: "floor_15", render: (b) => floorLike(b, 1.5) },
  { name: "jump", render: (b) => { tone(b, { type: "square", f0: 320, f1: 620, dur: 0.07, peak: 0.06 }); } },
  { name: "lunge", render: (b) => {
    noise(b, { dur: 0.10, peak: 0.09, type: "bandpass", f0: 1800, f1: 800, q: 0.8 });
    tone(b, { type: "sine", f0: 140, f1: 80, dur: 0.08, peak: 0.10 });
    tone(b, { type: "triangle", f0: 260, f1: 180, dur: 0.06, peak: 0.05 });
  } },
  { name: "whistle", render: (b) => {
    tone(b, { type: "square", f0: 2050, f1: 2150, dur: 0.1, peak: 0.07 });
    tone(b, { type: "square", f0: 2150, f1: 2050, dur: 0.13, peak: 0.07, t0: 0.12 });
  } },
  { name: "score_good", render: (b) => {
    [523, 784].forEach((f, i) => tone(b, { type: "triangle", f0: f, f1: f, dur: 0.16, peak: 0.16, t0: i * 0.09 }));
  } },
  { name: "cheer_04", render: (b) => cheerLike(b, 0.4) },
  { name: "cheer_07", render: (b) => cheerLike(b, 0.7) },
  { name: "cheer_10", render: (b) => cheerLike(b, 1) },
  { name: "win", render: (b) => {
    [523, 659, 784, 1047].forEach((f, i) => {
      tone(b, { type: "triangle", f0: f, f1: f, dur: 0.3, peak: 0.16, t0: i * 0.11 });
      tone(b, { type: "square", f0: f * 2, f1: f * 2, dur: 0.16, peak: 0.04, t0: i * 0.11 });
    });
  } },
  { name: "lose", render: (b) => {
    [392, 330, 262].forEach((f, i) => tone(b, { type: "triangle", f0: f, f1: f * 0.98, dur: 0.28, peak: 0.13, t0: i * 0.14 }));
  } },
  { name: "ui", render: (b) => { tone(b, { type: "square", f0: 660, f1: 880, dur: 0.05, peak: 0.06 }); } },
  { name: "back", render: (b) => { tone(b, { type: "square", f0: 440, f1: 300, dur: 0.07, peak: 0.06 }); } },
  // 老实现的 delay 参数是「错开于胜利琶音之后」,烘焙版从 0 开始,错拍由运行时调度
  { name: "coin", render: (b) => {
    tone(b, { type: "square", f0: 988, f1: 988, dur: 0.09, peak: 0.10 });
    tone(b, { type: "square", f0: 1319, f1: 1319, dur: 0.16, peak: 0.09, t0: 0.08 });
  } },
  { name: "buy", render: (b) => {
    tone(b, { type: "triangle", f0: 660, f1: 990, dur: 0.1, peak: 0.12 });
    tone(b, { type: "square", f0: 1320, f1: 1760, dur: 0.14, peak: 0.08, t0: 0.08 });
    noise(b, { dur: 0.1, peak: 0.04, type: "highpass", f0: 3200, f1: 1400, t0: 0.02 });
  } },
  { name: "levelup", render: (b) => {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      tone(b, { type: "triangle", f0: f, f1: f, dur: 0.24, peak: 0.14, t0: i * 0.09 }));
  } },
  // 闪现折跃(时停那一下):低频骤坠 = "世界被按停",紧跟一道由亮坠暗的高频扫 = 雷光,
  // 尾上留一个高次谐波长音 = 停住的余韵。放在数组末尾:确定性随机流是按顺序消费的,
  // 插在前面会把后面所有音色的烘焙结果改掉。
  { name: "flash", render: (b) => {
    tone(b, { type: "sine", f0: 220, f1: 42, dur: 0.16, peak: 0.16 });
    noise(b, { dur: 0.13, peak: 0.10, type: "bandpass", f0: 4200, f1: 900, q: 1.6 });
    tone(b, { type: "triangle", f0: 1760, f1: 440, dur: 0.1, peak: 0.09, t0: 0.04 });
    tone(b, { type: "sine", f0: 3136, f1: 3136, dur: 0.22, peak: 0.06, t0: 0.06 });
  } },
];

function hitLike(b: Float32Array, hot: boolean, quality: number, sweet: boolean, perfect: boolean): void {
  tone(b, { type: "sine", f0: hot ? 520 : 400, f1: hot ? 110 : 170, dur: hot ? 0.13 : 0.09, peak: 0.34 });
  noise(b, { dur: hot ? 0.09 : 0.05, peak: 0.22, type: "highpass", f0: hot ? 2400 : 1500, f1: 800, q: 0.8 });
  if (perfect) {
    tone(b, { type: "triangle", f0: 2100, f1: 3400, dur: 0.09, peak: 0.2 });
    tone(b, { type: "square", f0: 2800, f1: 3900, dur: 0.06, peak: 0.12 });
    noise(b, { dur: 0.06, peak: 0.18, type: "bandpass", f0: 5200, f1: 3000, q: 2.4 });
    tone(b, { type: "sine", f0: 4200, f1: 4200, dur: 0.18, peak: 0.09, t0: 0.02 });
    tone(b, { type: "sine", f0: 5280, f1: 5280, dur: 0.14, peak: 0.05, t0: 0.03 });
  } else if (sweet) {
    tone(b, { type: "triangle", f0: 1680, f1: 2900, dur: 0.08, peak: 0.18 });
    tone(b, { type: "square", f0: 2400, f1: 3400, dur: 0.06, peak: 0.12 });
    noise(b, { dur: 0.05, peak: 0.16, type: "bandpass", f0: 3800, f1: 2200, q: 2.2 });
    tone(b, { type: "sine", f0: 3136, f1: 3136, dur: 0.15, peak: 0.08, t0: 0.02 });
  } else if (quality >= 0.86) {
    tone(b, { type: "square", f0: 1180, f1: 1720, dur: 0.07, peak: 0.09 });
    tone(b, { type: "sine", f0: 1760, f1: 2640, dur: 0.11, peak: 0.07, t0: 0.02 });
  }
}

function floorLike(b: Float32Array, hard: number): void {
  noise(b, { dur: 0.09, peak: 0.10 * hard, type: "lowpass", f0: 900, f1: 200, q: 1 });
  tone(b, { type: "sine", f0: 180 * hard, f1: 60, dur: 0.1, peak: 0.12 * hard });
}

function cheerLike(b: Float32Array, big: number): void {
  noise(b, { dur: 0.9, peak: 0.05 + big * 0.11, type: "bandpass", f0: 900, f1: 1500, q: 0.4 });
  noise(b, { dur: 1.2, peak: 0.03 + big * 0.06, type: "bandpass", f0: 2200, f1: 1200, q: 0.5, t0: 0.05 });
}

// ---------- WAV 封装(16-bit PCM mono)+ 轻软限幅保平衡 ----------
function writeWav(name: string, f32: Float32Array, outDir: string = OUT_DIR): string {
  // 软限幅:tanh 只压超大会用到的峰值,小信号几乎无损,保持音色间相对响度
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
  const path = join(outDir, `${name}.wav`);
  writeFileSync(path, out);
  return path;
}

mkdirSync(OUT_DIR, { recursive: true });
let total = 0;
for (const def of SFX) {
  const dur = 1.5;   // 统一渲染窗:最长音色(cheer 1.25s + t0)也装得下,尾部静音被裁
  const buf = new Float32Array(Math.round(SR * dur));
  def.render(buf);
  // 裁掉尾部静音(留 30ms 余量),文件更小、播放器不拖尾
  let end = buf.length - 1;
  while (end > 0 && Math.abs(buf[end]) < 0.0008) end--;
  const trimmed = buf.subarray(0, Math.min(buf.length, end + Math.round(SR * 0.03) + 1));
  const p = writeWav(def.name, trimmed);
  const kb = (require("node:fs").statSync(p).size / 1024).toFixed(1);
  total += Number(kb);
  console.log(`✓ ${def.name.padEnd(14)} ${(trimmed.length / SR).toFixed(2)}s  ${kb} KB`);
}
console.log(`\n${SFX.length} 个音效,共 ${total.toFixed(0)} KB → ${OUT_DIR}`);

// ============================================================
// BGM 离线烘焙(对照 嘟嘟02/src/bgm.js 自适应合成引擎)
// 原版 WebAudio 现场分层合成 + 事件音乐化,Cocos 三端无可靠实时合成,
// 改为离线烘焙:5 条循环 stem(分层 fade 编排)+ menu 压暗版 + 事件 one-shot。
// 乐谱/音色与 bgm.js 逐条对照,产物 → assets/resources/audio/bgm/*.wav
// ============================================================
const BGM_DIR = join(projectRoot(), "assets", "resources", "audio", "bgm");
mkdirSync(BGM_DIR, { recursive: true });

const BPM = 132;
const BSTEP = 15 / BPM;                       // 16 分音符时长(秒)
const BARS = 4, SPB = 16;
const NSTEP = BARS * SPB;                     // 64 步 = 4 小节一循环
const STEM_LEN = Math.round(SR * NSTEP * BSTEP);   // ≈7.27s 无缝循环长度

const PROG = [0, -4, 3, -2];                  // Am-F-C-G(相对 A2 半音)
const CHORD = [[0,3,7,12],[0,4,7,12],[0,4,7,12],[0,4,7,12]];
const SCALE = [0,3,5,7,10,12,15,17,19,22,24]; // A 小调五声(两八度),击球 combo 爬音阶用
const PAT = {
  kick:  "x...x...x...x...",
  snare: "....x.......x...",
  hat:   "x.x.x.x.x.x.x.x.",
  open:  "..x...x...x...x.",
  tamb:  "x.xxx.xxx.xxx.xx",
};
const BASS = [0,-1,-1,0,-1,-1,0,-1,-1,0,-1,12,-1,0,-1,-1];
const ARP  = [0,1,2,3,2,1,0,1,2,3,2,1,0,1,2,3];
const LEAD = [
  [0,-1,1,-1,3,-1,4,3,2,-1,1,-1,-1,-1,-1,-1],
  [0,-1,1,-1,2,-1,1,0,-1,-1,-1,-1,0,-1,4,-1],
  [3,-1,4,-1,3,-1,1,-1,2,-1,3,-1,4,-1,3,-1],
  [2,-1,3,-1,2,-1,1,-1,2,3,2,1,0,-1,-1,-1],
];

const semi = (base: number, n: number): number => base * Math.pow(2, n / 12);

// ---- 音色(对照 bgm.js vKick/vSnare/vHat/vBass/vArp/vLead/vTamb/vPluck/vSmashNote/vStab) ----
function vKick(b: Float32Array, t: number): void {
  tone(b, { type: "sine", f0: 165, f1: 42, t0: t, dur: 0.15, peak: 0.95 });
}
function vSnare(b: Float32Array, t: number, v = 1): void {
  noise(b, { t0: t, dur: 0.13, peak: 0.4 * v, type: "bandpass", f0: 1900, q: 0.8 });
  tone(b, { type: "triangle", f0: 210, f1: 140, t0: t, dur: 0.07, peak: 0.16 * v });
}
function vHat(b: Float32Array, t: number, open: boolean): void {
  noise(b, { t0: t, dur: open ? 0.24 : 0.04, peak: open ? 0.13 : 0.16, type: "highpass", f0: 7600, q: 0.7 });
}
function vBass(b: Float32Array, t: number, f: number): void {
  tone(b, { type: "square", f0: f, t0: t, dur: 0.2, peak: 0.42, lp: 820 });
}
function vArp(b: Float32Array, t: number, f: number): void {
  tone(b, { type: "sawtooth", f0: f, t0: t, dur: 0.09, peak: 0.13, lp: 3200 });
}
function vLead(b: Float32Array, t: number, f: number): void {
  tone(b, { type: "square", f0: f * 0.996, t0: t, dur: 0.24, peak: 0.1, lp: 4200 });
  tone(b, { type: "square", f0: f * 1.004, t0: t, dur: 0.24, peak: 0.1, lp: 4200 });
}
function vTamb(b: Float32Array, t: number): void {
  noise(b, { t0: t, dur: 0.05, peak: 0.11, type: "bandpass", f0: 6800, q: 3 });
}
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

// ---- 分层 stem 渲染(4 小节无缝循环) ----
type StemLayer = Partial<Record<"groove" | "drums" | "arp" | "lead" | "tamb", boolean>>;

function renderStep(b: Float32Array, s: number, layer: StemLayer): void {
  const bar = (s >> 4) % BARS;
  const sub = s & 15;
  const t = s * BSTEP;
  const root = PROG[bar];
  if (layer.groove) {
    if (PAT.open[sub] === "x") vHat(b, t, true);
    else if (PAT.hat[sub] === "x") vHat(b, t, false);
    const bo = BASS[sub];
    if (bo >= 0) vBass(b, t, semi(110, root + bo));
  }
  if (layer.drums) {
    if (PAT.kick[sub] === "x") vKick(b, t);
    if (PAT.snare[sub] === "x") vSnare(b, t, 1);
    if (bar === 3 && sub >= 13) vSnare(b, t, 0.5 + (sub - 13) * 0.25);   // 循环末军鼓 fill
  }
  if (layer.arp) {
    const ai = ARP[sub];
    if (ai >= 0) vArp(b, t, semi(220, root + CHORD[bar][ai]));
  }
  if (layer.lead) {
    const deg = LEAD[bar][sub];
    if (deg >= 0) vLead(b, t, semi(440, SCALE[deg]));
  }
  if (layer.tamb) {
    if (PAT.tamb[sub] === "x") vTamb(b, t);
  }
}

// 末尾 5ms 线性淡出:消除循环边界 click(开头第一拍有 atk 渐入,首尾对齐到 0)
function fadeTail(b: Float32Array): void {
  const n = Math.round(SR * 0.005);
  for (let i = 0; i < n; i++) b[b.length - n + i] *= 1 - i / n;
}

function renderStem(name: string, layer: StemLayer): string {
  const b = new Float32Array(STEM_LEN);
  for (let s = 0; s < NSTEP; s++) renderStep(b, s, layer);
  fadeTail(b);
  return writeWav(name, b, BGM_DIR);
}

// menu = groove 单层 + 整体 lowpass 1500(对照 gFilter menu 态压暗)
function renderMenuStem(): string {
  const b = new Float32Array(STEM_LEN);
  for (let s = 0; s < NSTEP; s++) renderStep(b, s, { groove: true });
  const bq = new Biquad();
  bq.set("lowpass", 1500, 1);
  for (let i = 0; i < b.length; i++) b[i] = bq.process(b[i]);
  fadeTail(b);
  return writeWav("bgm_menu", b, BGM_DIR);
}

// ---- 事件 one-shot(击球拨弦/泛光/得分和弦/平分/终局 jingle) ----
function bakeShot(name: string, render: (b: Float32Array) => void, dur = 0.6): string {
  const b = new Float32Array(Math.round(SR * dur));
  render(b);
  let end = b.length - 1;
  while (end > 0 && Math.abs(b[end]) < 0.0008) end--;
  const trimmed = b.subarray(0, Math.min(b.length, end + Math.round(SR * 0.03) + 1));
  return writeWav(name, trimmed, BGM_DIR);
}

const bgmFiles: string[] = [];

// 5 条分层 stem + menu 压暗版
bgmFiles.push(renderStem("bgm_groove", { groove: true }));
bgmFiles.push(renderStem("bgm_drums", { drums: true }));
bgmFiles.push(renderStem("bgm_arp", { arp: true }));
bgmFiles.push(renderStem("bgm_lead", { lead: true }));
bgmFiles.push(renderStem("bgm_tamb", { tamb: true }));
bgmFiles.push(renderMenuStem());

// 击球拨弦 11 音高(五声音阶 combo 爬升;rally 越长音越高)
for (let i = 0; i < SCALE.length; i++) {
  const n = SCALE[i] + 12;
  bgmFiles.push(bakeShot(`pluck_${String(i).padStart(2, "0")}`, (b) => vPluck(b, 0, semi(440, n), 1)));
}
// 扣杀拨弦 11 音高(音色更猛)
for (let i = 0; i < SCALE.length; i++) {
  const n = SCALE[i] + 12;
  bgmFiles.push(bakeShot(`smash_pluck_${String(i).padStart(2, "0")}`, (b) => vSmashNote(b, 0, semi(440, n))));
}
// 完美/甜蜜泛光(取代表性音高 semi=12,叠加于拨弦之上的"闪光音符")
bgmFiles.push(bakeShot("perfect_shine", (b) => {
  tone(b, { type: "sine", f0: semi(440, 12 + 24), t0: 0.01, dur: 0.12, peak: 0.14 });
  tone(b, { type: "sine", f0: semi(440, 12 + 31), t0: 0.03, dur: 0.1, peak: 0.08 });
}));
bgmFiles.push(bakeShot("sweet_shine", (b) => {
  tone(b, { type: "sine", f0: semi(440, 12 + 24), t0: 0.01, dur: 0.1, peak: 0.1 });
}));
// 得分和弦重音(落回网格,把"得分了"衬进和声)
bgmFiles.push(bakeShot("stab", (b) => vStab(b, 0)));
// 平分上行三连音(小三度上行,紧绷感)
bgmFiles.push(bakeShot("deuce_sting", (b) => {
  [0, 3, 7].forEach((s, i) => tone(b, { type: "triangle", f0: semi(440, s + 12), t0: i * 0.08, dur: 0.15, peak: 0.12, lp: 4000 }));
}));
// 终局 jingle(胜利 A 大调上行 / 失败下行叹息)
bgmFiles.push(bakeShot("win_jingle", (b) => {
  [0, 4, 7, 12].forEach((s, i) => tone(b, { type: "square", f0: semi(440, s + 12), t0: i * 0.13, dur: 0.18, peak: 0.14, lp: 5000 }));
  tone(b, { type: "square", f0: semi(440, 31), t0: 0.55, dur: 0.5, peak: 0.14, lp: 5000 });
  tone(b, { type: "square", f0: semi(440, 36), t0: 0.55, dur: 0.5, peak: 0.1, lp: 5000 });
  vKick(b, 0);
}, 1.2));
bgmFiles.push(bakeShot("lose_jingle", (b) => {
  [0, -5, -9, -12].forEach((s, i) => tone(b, { type: "triangle", f0: semi(440, s + 12), t0: i * 0.22, dur: 0.32, peak: 0.18 }));
}, 1.2));

let bgmKb = 0;
for (const p of bgmFiles) bgmKb += Number((require("node:fs").statSync(p).size / 1024).toFixed(1));
console.log(`[BGM] ${bgmFiles.length} 个文件(${(STEM_LEN / SR).toFixed(2)}s stem ×6 + 事件 one-shot ×${bgmFiles.length - 6}),共 ${bgmKb.toFixed(0)} KB → ${BGM_DIR}`);
