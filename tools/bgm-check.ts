// ============================================================
// BGM 结构断言(bgm 唯一烘焙源 bake-bgm.ts 的回归闸门)
// 不读音频文件:直接 import renderAll() 内存重渲 —— 确定性随机保证与烘焙
// 逐样本一致,oggify 删掉 wav 之后也照常可跑(登记进 test-all 不怕时序)。
//
// 五类判据:
//   1. stem 名单齐:6 条 game stem + menu,一个不少
//   2. 全 game stem 同帧数(运行时同帧起播 + 同长 ⇒ 循环相位永锁,差 1 样本都算炸)
//   3. peak < 0.99(软限幅前;顶满就是哪层爆了)
//   4. RMS 落在基线 ±3dB(防改音色时某层爆响/哑掉;基线 = 2026-10 编曲升级首版实测)
//   5. 循环接缝:|x[0] − x[末]| 不得超过 peak 的 1/4
//      (wrapFold 回折生效的充要症状:没回折时跨界尾巴被硬切,接缝跳变巨大)
//   6. 声道数:groove/drums/tamb 居中 mono,arp/lead/pad/menu 铺宽 stereo
//   附加:磁盘 wav 存在时,校验 WAV 头(声道/采样率/帧数)与内存渲染一致
//   (wav 已被 oggify 删掉则跳过 —— ogg 的解码校验交给真机听感验收)
//
// 用法: node .tools-build/tools/bgm-check.js
// ============================================================
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderAll } from "./bake-bgm";

function projectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(dir, "assets", "scripts", "core", "config.ts"))) return dir;
    dir = join(dir, "..");
  }
  throw new Error("找不到工程根(assets/scripts/core/config.ts)");
}

const GAME_STEMS = ["bgm_groove", "bgm_drums", "bgm_arp", "bgm_lead", "bgm_tamb", "bgm_pad"];
const MONO = new Set(["bgm_groove", "bgm_drums", "bgm_tamb"]);
// RMS 基线(编曲升级首版实测):±3dB 内算健康,±3dB 外说明某层被改响/改哑了
const RMS_BASELINE: Record<string, number> = {
  bgm_groove: 0.0885,
  bgm_drums: 0.0884,
  bgm_arp: 0.0136,
  bgm_lead: 0.0338,
  bgm_tamb: 0.0035,
  bgm_pad: 0.0103,
  bgm_menu: 0.0678,
};
const RMS_TOL = 1.413;   // 10^(3/20)

let failed = 0;
const fail = (msg: string): void => { failed++; console.error(`✗ ${msg}`); };
const ok = (msg: string): void => console.log(`✓ ${msg}`);

const { stems } = renderAll();
const byName = new Map(stems.map((s) => [s.name, s]));

// 1. 名单齐
for (const name of [...GAME_STEMS, "bgm_menu"]) {
  if (!byName.has(name)) fail(`缺 stem ${name}`);
}
if (stems.length === 7 && GAME_STEMS.every((n) => byName.has(n)) && byName.has("bgm_menu")) {
  ok(`stem 名单齐(6 game + menu,共 ${stems.length} 条)`);
}

// 2. 全 game stem 同帧数
const len0 = byName.get(GAME_STEMS[0])?.l.length ?? 0;
const mismatched = GAME_STEMS.filter((n) => {
  const s = byName.get(n);
  return !s || s.l.length !== len0 || (s.r !== null && s.r!.length !== len0);
});
if (mismatched.length) fail(`game stem 长度不一致: ${mismatched.join(",")} ≠ ${len0}`);
else ok(`全 game stem 同长同相(${len0} 样本 ≈ ${(len0 / 44100).toFixed(2)}s)`);

// 3~6. 每条 stem 的峰值/RMS/接缝/声道
const rmsOf = (b: Float32Array, from: number, to: number): number => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += b[i] * b[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};
for (const name of [...GAME_STEMS, "bgm_menu"]) {
  const s = byName.get(name);
  if (!s) continue;
  const channels: Float32Array[] = s.r ? [s.l, s.r] : [s.l];
  let peak = 0, sum = 0, n = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) {
    const v = Math.abs(c[i]);
    if (v > peak) peak = v;
    sum += c[i] * c[i]; n++;
  }
  const rms = Math.sqrt(sum / n);

  if (peak >= 0.99) fail(`${name} peak=${peak.toFixed(3)} 顶满限幅,哪层爆了`);
  const base = RMS_BASELINE[name];
  if (!base) fail(`${name} 没登记 RMS 基线(改完音色记得把实测值写回 RMS_BASELINE)`);
  else if (rms > base * RMS_TOL || rms < base / RMS_TOL) {
    fail(`${name} rms=${rms.toFixed(4)} 偏离基线 ${base} 超 ±3dB(音色被改响/改哑了)`);
  }
  const seamThresh = Math.max(0.05, peak * 0.25);
  for (const [ci, c] of channels.entries()) {
    const d0 = Math.abs(c[0] - c[c.length - 1]);
    if (d0 > seamThresh) fail(`${name} ch${ci + 1} 接缝跳变 ${d0.toFixed(3)} > ${seamThresh.toFixed(3)}(wrapFold 没生效?)`);
  }
  const wantCh = MONO.has(name) ? 1 : 2;
  if (s.ch !== wantCh) fail(`${name} 声道数 ${s.ch} ≠ 预期 ${wantCh}`);
}
if (failed === 0) ok("peak / RMS 基线(±3dB) / 接缝 / 声道数 全部健康");

// 附加:磁盘 wav 头校验(oggify 后 wav 缺席则跳过)
const dir = join(projectRoot(), "assets", "resources", "audio", "bgm");
let checked = 0, skipped = 0;
for (const name of [...GAME_STEMS, "bgm_menu"]) {
  const s = byName.get(name);
  const p = join(dir, `${name}.wav`);
  if (!s || !existsSync(p)) { skipped++; continue; }
  const buf = readFileSync(p);
  const ch = buf.readUInt16LE(22);
  const rate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  const dataLen = buf.readUInt32LE(40);
  const frames = dataLen / (2 * ch);
  if (ch !== s.ch) fail(`${name}.wav 声道 ${ch} ≠ 渲染 ${s.ch}`);
  else if (rate !== 44100 || bits !== 16) fail(`${name}.wav 格式异常: ${rate}Hz ${bits}bit`);
  else if (frames !== s.l.length) fail(`${name}.wav 帧数 ${frames} ≠ 渲染 ${s.l.length}(wav 过期?重跑 bake-bgm)`);
  else checked++;
}
if (checked + skipped > 0) {
  ok(`磁盘 wav 头校验:${checked} 条一致${skipped ? `,${skipped} 条已被 oggify 转走(跳过,听感验收走 ogg)` : ""}`);
}

console.log(failed === 0 ? "\nbgm-check: 全部通过" : `\nbgm-check: ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
