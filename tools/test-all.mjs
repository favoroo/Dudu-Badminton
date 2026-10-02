#!/usr/bin/env node
// ============================================================
// 回归总入口:先 npx tsc 两遍(工具编译 + 全量类型检查),再串行跑全部 check。
// 从前 19+ 个 check 靠 CHANGELOG 里手抄的逐条命令验收,新增工具很容易忘了跑
// —— 这份清单就是「哪些工具存在且必须绿」的唯一事实源,加新 check 记得登记。
// 用法: npm test(= test:build + 本脚本)
// ============================================================
import { spawnSync } from "node:child_process";

/** 全部 check:进程内断言 + exit 码,任何非零都算失败 */
const CHECKS = [
  "probe",
  "drill-check",
  // 引导演示的真值闸门:钉住「演的那一拍就是判的那一拍」(旧版画的是手编抛物线)
  "drill-diagram-check",
  // 六关 × 四步定格出图 + 锚帧自洽(不登记就等于没人跑,而这一屏的赌注是观感)
  "drill-diagram-preview",
  // 四面板语法闸门。从前**根本没登记进这张表** —— 对比度/网点/触控/溢出/文案五类判据
  // 只在人肉跑 panel-check 时才生效,「哪些工具存在且必须绿」这份唯一事实源漏了它。
  "panel-check",
  "serve-check",
  "reach-check",
  "ai-check",
  // AI 体力账本的闸门:成本表是纯函数打表(替身从不杀球,「重杀才掉/软球回气」
  // 只有这里验得到);发球零成本、直觉钉子、归一化契约都钉在这份工具里
  "stamina-check",
  "sim-check",
  "flash-check",
  "campaign-check",
  "haptic-check",
  "env-check",
  // 第 1 关的风:出图 + 断言「画在不在玩家看得见的地方」——
  // 上一版风丝漏了 vp 换算,动画做了却整片飘出屏幕,这条钉子必须常驻
  "wind-preview",
  "notes-check",
  "strip-check",
  "brief-check",
  "skill-check",
  "pad-cd-check",
  "ui-hide-check",
  "ui-click-check",
  "shelf-check",
  "settings-check",
  "input-check",
  "spec-shot-check",
  // BGM 结构闸门:内存重渲断言 stem 同长同相/峰值/RMS 基线/循环接缝/声道数
  // (烘焙脚本 tools/bake-bgm.ts 是 BGM 唯一事实源,改动音色/乐谱必须过这道)
  "bgm-check",
];

/** 带反例的 check:--selftest 必须也绿(规则脚本最怕悄悄全绿) */
const SELFTESTS = [
  "flash-check",
  "campaign-check",
  "haptic-check",
  "env-check",
  "strip-check",
  "brief-check",
  "skill-check",
  "pad-cd-check",
  "ui-hide-check",
  "shelf-check",
  "spec-shot-check",
  "drill-diagram-check",
  "panel-check",
  "stamina-check",
];

let failed = 0;
const t0 = Date.now();

const run = (name, args) => {
  const t = Date.now();
  const r = spawnSync("node", [`.tools-build/tools/${name}.js`, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const ms = Date.now() - t;
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${args.length ? " --selftest" : ""}  (${(ms / 1000).toFixed(1)}s)`);
  if (!ok) {
    const out = `${r.stdout || ""}\n${r.stderr || ""}`.trim().split("\n");
    console.log(out.slice(-18).map((l) => `    ${l}`).join("\n"));
  }
  return ok;
};

console.log(`=== 回归套件:${CHECKS.length} 个 check + ${SELFTESTS.length} 个 selftest ===\n`);
for (const c of CHECKS) run(c, []);
for (const s of SELFTESTS) run(s, ["--selftest"]);

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${failed === 0 ? "✓ 全部通过" : `✗ ${failed} 项失败`}(${secs}s)`);
console.log("注:env-check 的 ☰ 条目是显式豁免(关卡机制视觉缺失,阶段 5 TODO),不算失败。");
process.exit(failed === 0 ? 0 : 1);
