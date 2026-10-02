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
  "serve-check",
  "reach-check",
  "ai-check",
  "sim-check",
  "flash-check",
  "campaign-check",
  "haptic-check",
  "env-check",
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
