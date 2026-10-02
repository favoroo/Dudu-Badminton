// ============================================================
// BGM 分发格式转换:assets/resources/audio/bgm/*.wav → *.ogg (Vorbis)
//
// 为什么要这一步:烘焙脚本(bake-audio.ts / bake-bgm.ts)输出 16-bit PCM WAV,
// 6 条 7.27s 循环 stem 各 641KB,整个 bgm 目录 4.4MB —— 而它只被 loop 播放。
// Vorbis q3 对这类合成芯片音几乎无损,体积 ≈1/6;Android 与 Web 原生支持,
// 加载是 loadDir 按资产名(与扩展名无关),运行时代码零改动。
// 转完删掉 wav 与 .meta(Cocos 编辑器/CLI 构建时为新 .ogg 自动生成 meta)。
// ⚠ 微信小游戏 iOS 端对 ogg 支持不稳 —— 未来若移植微信需 revisit 分发格式。
//
// 用法: npx tsc -p tools/tsconfig.json && node .tools-build/tools/oggify.js
// 依赖: PATH 里有 ffmpeg
// ============================================================
import { readdirSync, rmSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

function projectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(dir, "assets", "scripts", "core", "config.ts"))) return dir;
    dir = join(dir, "..");
  }
  throw new Error("找不到工程根(assets/scripts/core/config.ts)");
}
const BGM_DIR = join(projectRoot(), "assets", "resources", "audio", "bgm");

const wavs = readdirSync(BGM_DIR).filter((f) => f.endsWith(".wav"));
if (!wavs.length) {
  console.log("bgm 目录里没有 wav,无事可做");
  process.exit(0);
}

// 编码器探测:libvorbis(质量更好、支持单声道)优先;没有则退回 ffmpeg 自带的
// experimental 原生 vorbis —— 它只吃 2 声道,单声道源上混成立体声(96k 码率下
// 相关双声道几乎不涨体积)。vorbis 本身无 mp3 那种解码垫片,循环依旧无缝。
const encoders = (() => {
  try {
    return execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
  } catch { return ""; }
})();
const HAVE_LIBVORBIS = encoders.includes("libvorbis");
const codecArgs = HAVE_LIBVORBIS
  ? ["-c:a", "libvorbis", "-q:a", "3"]
  : ["-c:a", "vorbis", "-strict", "-2", "-ac", "2", "-b:a", "96k"];
console.log(HAVE_LIBVORBIS ? "编码器:libvorbis q3" : "编码器:ffmpeg 原生 vorbis(experimental,单声道→立体声上混)");

let totalBefore = 0;
let totalAfter = 0;
for (const f of wavs) {
  const src = join(BGM_DIR, f);
  const dst = join(BGM_DIR, `${basename(f, ".wav")}.ogg`);
  const before = statSync(src).size;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, ...codecArgs, dst]);
  const after = statSync(dst).size;
  rmSync(src);
  const meta = `${src}.meta`;
  if (existsSync(meta)) rmSync(meta);
  totalBefore += before;
  totalAfter += after;
  console.log(`✓ ${f.padEnd(22)} → ${basename(dst).padEnd(22)} ${(before / 1024).toFixed(0).padStart(5)} KB → ${(after / 1024).toFixed(0).padStart(4)} KB`);
}

console.log(`\n${wavs.length} 条 BGM:${(totalBefore / 1024 / 1024).toFixed(2)} MB → ${(totalAfter / 1024 / 1024).toFixed(2)} MB`);
