// ============================================================
// 时空减速(focus 领域掌控)优化回归 —— 2026-10-04。
//
// 对应用户需求:
//   1. 结束逻辑改成: 接完一个球过一会就可以结束 (而不是固定干等满 180 帧保底);
//   2. 击球效果大幅强化: 顶档甜区品质(sweet/perfect/q>=0.98) + 初速+5.0 + 压弧+14°;
//   3. 冷却时间改成技能效果结束后才进冷却, 而不是点完技能就进入冷却。
//
// 本工具断言:
//   ① 激活时 cd === 0, 键面报"领域中"(focusing), 不可重复释放;
//   ② previewKind (球种预告) 绝不偷吃/缩短领域时间, 逐字段不变;
//   ③ 真正击球(!preview) 时初速+5.0、压弧+14、顶档 sweet/perfect, 且时间精准收缩到 postHitFrames (22 帧);
//   ④ 接球后缓释 22 帧走完, 领域结束, 冷却正式启动为 270 帧 (4.5s), 随后正常倒计时;
//   ⑤ 未接球时持续至保底超时 (180 帧), 走完后同样启动 270 帧冷却;
//   ⑥ 小分重置 (resetPoint) 彻底清空临时状态与残窗;
//   ⑦ --selftest 模式: 反例(按下即付 CD、击球不收缩、预告偷吃、无顶档强化)必须被报警拦下。
//
// 用法:
//   node .tools-build/tools/focus-check.js [--selftest]
// ============================================================
import { makeChecker } from "./harness";
import { CFG } from "../assets/scripts/core/config";
import { Skills } from "../assets/scripts/core/skills";
import { Rules } from "../assets/scripts/core/rules";
import type { Ball, HitOpt, Player as PlayerEntity } from "../assets/scripts/core/types";

const SELFTEST = process.argv.includes("--selftest");

function runSuite(patchMode?: "cdAtPress" | "noPostHit" | "previewConsumes" | "noQuality"): { ok: boolean; fails: string[] } {
  const fails: string[] = [];
  const checker = makeChecker({});
  const ok = (cond: boolean, msg: string): void => {
    if (!cond) fails.push(msg);
    if (!patchMode) checker.ok(cond, msg);
  };

  const origDefers = Skills.defersCooldownToConsume;
  const origModify = Skills.modifyShot;
  const origActivate = Skills.activate;

  if (patchMode === "cdAtPress") {
    // 模拟旧行为: 按下即进冷却 (如旧版直接置满 CD)
    Skills.activate = (p: PlayerEntity, ball: Ball, dir?: number) => {
      const r = origActivate(p, ball, dir);
      if (p.skill) p.skill.cd = p.skill.maxCd;
      return r;
    };
  } else if (patchMode === "noPostHit") {
    // 模拟旧行为: 击球不收缩时间
    Skills.modifyShot = (p: PlayerEntity, opt: HitOpt) => {
      const res = origModify(p, opt);
      // 撤销收缩
      if (p.focusHit && !opt.preview) {
        p.focusT = CFG.skills.focus.duration;
        if (p.skill) p.skill.buffT = CFG.skills.focus.duration;
      }
      return res;
    };
  } else if (patchMode === "previewConsumes") {
    // 模拟坏行为: 预告偷吃收缩时间
    Skills.modifyShot = (p: PlayerEntity, opt: HitOpt) => {
      if (p.skill?.id === "focus") {
        const postHit = CFG.skills.focus.postHitFrames ?? 22;
        p.focusT = Math.min(p.focusT ?? postHit, postHit);
      }
      return origModify(p, opt);
    };
  } else if (patchMode === "noQuality") {
    // 模拟旧行为: 无顶档甜区品质改写
    Skills.modifyShot = (p: PlayerEntity, opt: HitOpt) => {
      const res = origModify(p, opt);
      opt.sweet = false;
      opt.perfect = false;
      opt.q = 0.5;
      return res;
    };
  }

  try {
    Rules.newMatch("1p", "normal");
    const R = Rules.R;
    const hero = R.players[0];
    hero.skill = Skills.initSkillState("focus");
    Skills.resetPoint(hero);

    const ball = R.ball as Ball;
    ball.live = true;
    ball.held = false;
    ball.flying = false;
    ball.lastHitter = "right";

    // 1. 激活门槛与初始激活
    ok(Skills.canActivate(hero, ball), "就绪且来球飞行中可激活时空技能");
    const activated = Skills.activate(hero, ball);
    ok(activated, "时空技能成功激活");
    ok(hero.focusT === CFG.skills.focus.duration, `初始 focusT 达到配置保底持续时间 (${CFG.skills.focus.duration} 帧)`);
    ok(hero.skill.buffT === CFG.skills.focus.duration, `初始 buffT 同步达到 ${CFG.skills.focus.duration} 帧`);
    ok(hero.skill.cd === 0, "【核心诉求】激活时不立刻扣冷却, cd === 0");
    ok(Skills.canActivate(hero, ball) === false, "领域中不可重复释放");
    ok(Skills.skillBlockReason(hero, ball) === CFG.skills.blockText.focusing, "按键显示「领域中」阻挡原因");

    // 2. 预告通道 preview 不偷吃
    const snapT = hero.focusT;
    const dummyOpt: HitOpt = { preview: true };
    for (let i = 0; i < 5; i++) {
      Skills.modifyShot(hero, dummyOpt);
    }
    ok(hero.focusT === snapT, "球种预告 preview 绝不偷吃/缩短领域时间");
    ok(!hero.focusHit, "球种预告 preview 不标记已接球");

    // 3. 真正接球回击 (!preview): 效果强化 + 结束逻辑转入缓释
    const realOpt: HitOpt = { preview: false };
    const mod = Skills.modifyShot(hero, realOpt);
    ok(realOpt.sweet === true, "【击球强化】命中赋予 sweet 甜区");
    ok(realOpt.perfect === true, "【击球强化】命中赋予 perfect 完美击球");
    ok((realOpt.q ?? 0) >= 0.98, "【击球强化】品质 q 提升至顶档 >= 0.98");
    ok(mod.speedBoost === CFG.skills.focus.speedBoost && mod.speedBoost >= 5.0, `【击球强化】初速加成达到 +${mod.speedBoost}`);
    ok(mod.powerDeg === CFG.skills.focus.powerDeg && mod.powerDeg >= 14, `【击球强化】压弧加成达到 +${mod.powerDeg}°`);
    ok(hero.focusHit === true, "接球后标记已接球");
    const postHit = CFG.skills.focus.postHitFrames ?? 22;
    ok(hero.focusT === postHit, `【结束逻辑】接球后领域时间收缩到缓释帧数 postHitFrames (${postHit} 帧)`);
    ok(hero.skill.buffT === postHit, `buffT 同步收缩到 ${postHit} 帧`);
    ok(hero.skill.cd === 0, "缓释期间冷却仍未开始跑");

    // 4. 接球后过一会 (22 帧走完): 领域结束, 冷却正式启动
    for (let f = postHit; f > 1; f--) {
      Skills.update(hero, ball);
      ok(hero.skill.cd === 0, `缓释第 ${postHit - f + 1} 帧: 仍在领域中, cd 保持 0`);
    }
    // 最后一帧走完
    Skills.update(hero, ball);
    ok(hero.focusT === 0, "缓释走完后 focusT 归零, 领域正式结束");
    ok(hero.skill.cd === hero.skill.maxCd && hero.skill.cd === 270, "【核心诉求】领域结束后当帧正式进入冷却 (270 帧)");

    // 随后帧正常倒计时
    Skills.update(hero, ball);
    ok(hero.skill.cd === 269, "随后帧冷却正常递减 (270 -> 269)");

    // 5. 超时未击球保底路径测试
    Skills.resetPoint(hero);
    Skills.activate(hero, ball);
    const dur = CFG.skills.focus.duration;
    for (let f = 0; f < dur; f++) {
      Skills.update(hero, ball);
    }
    ok(hero.focusT === 0, "未击球时走完保底 duration 自然结束");
    ok(hero.skill.cd === 270, "未击球自然超时后同样正式启动 270 帧冷却");

    // 6. 小分重置卫生
    Skills.resetPoint(hero);
    ok(hero.focusT === 0 && hero.focusHit === false && hero.skill.cd === 0, "resetPoint 彻底重置领域与冷却至就绪态");

  } finally {
    Skills.activate = origActivate;
    (Skills as any).defersCooldownToConsume = origDefers;
    Skills.modifyShot = origModify;
  }

  return { ok: fails.length === 0, fails };
}

if (!SELFTEST) {
  const res = runSuite();
  if (!res.ok) {
    console.error("focus-check 失败项:", res.fails);
    process.exit(1);
  }
  console.log("✓ focus-check: 时空技能结束逻辑、击球强化、延后冷却全部断言通过!");
  process.exit(0);
} else {
  console.log("=== focus-check --selftest 反例验证 ===");
  const bads = ["cdAtPress", "noPostHit", "previewConsumes", "noQuality"] as const;
  for (const b of bads) {
    const res = runSuite(b);
    if (res.ok) {
      console.error(`反例 ${b} 居然没有被拦截! 测试脚本缺少牙齿!`);
      process.exit(1);
    }
    console.log(`  ✓ 反例 ${b} 成功被报警拦截 (触发 ${res.fails.length} 处断言失败)`);
  }
  console.log("✓ 所有反例成功被拦下, --selftest 通过!");
  process.exit(0);
}
