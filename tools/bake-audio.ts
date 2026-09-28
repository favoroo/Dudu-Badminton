// ============================================================
// 音效离线烘焙(决策③:音频烘焙成文件)
// 把老仓库 audio.js 的 WebAudio 现场合成为数学等价的离线渲染:
//   tone  = 振荡器(sine/square/sawtooth/triangle + 频率指数/线性斜坡) × 指数包络
//   noise = 白噪声缓冲(带随机速率/偏移) × RBJ 双二阶滤波(lowpass/highpass/bandpass) × 指数包络
// 每个音色渲染成单声道 WAV,Cocos 三端(Web/微信/安卓)零解码延迟直放。
// 参数与老 audio.js 逐一对照,游戏运行时不再有任何合成开销。
//
// 用法: npx tsc -p tools/tsconfig.json && node .tools-build/tools/bake-audio.js
// 产物: assets/resources/audio/sfx/*.wav
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
}

function tone(buf: Float32Array, opt: ToneOpt): void {
  const { type = "sine", f0 = 440, f1 = f0, t0 = 0, dur = 0.12, peak = 0.3, curve = "exp" } = opt;
  const start = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  const atk = Math.min(0.012, dur * 0.2);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = f1 === f0 ? f0
      : curve === "exp" ? expramp(f0, f1, t, dur)
      : f0 + (f1 - f0) * Math.min(1, t / dur);
    phase += (2 * Math.PI * Math.max(20, f)) / SR;
    const env = t < atk ? expramp(0.0001, peak, t, atk) : expramp(peak, 0.0001, t - atk, dur - atk);
    const idx = start + i;
    if (idx >= 0 && idx < buf.length) buf[idx] += waveAt(type, phase / (2 * Math.PI)) * env;
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
function writeWav(name: string, f32: Float32Array): string {
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
  const path = join(OUT_DIR, `${name}.wav`);
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
