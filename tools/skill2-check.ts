// ============================================================
// 双技能槽回归(2026-10-06)—— 防的是"单槽假设漏改"这一族病:
// 所有判据从前只认 `p.skill`(一场只有一个 skill.id),双槽化之后任何一处
// 忘改的 `p.skill.id === X` 都会让槽2 的技能静默失明 —— 键亮着按了没反应、
// 怒气在槽2不攒管、代拍窗不认货。这类 bug 不崩、不报错、预览里看不见,
// 只有真机把技能装进槽2才露馅,所以值得一把专属尺子。
//
// 八段:
//   A) 装备层(Career):双槽存档、撞款互换、槽1恒有技能、老档兜底、解锁闸
//   B) 槽寻址(slotState / slotOfSkill / hasSkill)+ 对局挂载 + AI 单槽不漂移
//   C) 激活路由:skill2Pressed → 槽2;双槽冷却/armed 互不挤兑
//   D) modifyShot 组合语义(口径用户拍板:数值直接叠加):重击×怒气同拍相加、
//      跨步强化窗×重击、消耗各源各自结清、预告通道一口不吃
//   E) 时空领域:领域中按技能2恰好触发一次;领域到期冷却开在装 focus 的那一槽
//   F) 代拍链:双窗并存按链序(跨步 > 重击),armed 门读装着那款技能的槽
//   G) 输入层:pad 的 skill2 边沿/方向/清边沿/意图输出,与 lunge 完全同构
//   H) resetPoint 清双槽(残窗/残冷却不许跨分)
// 另带 --selftest:把 modifyShot / activate 换回"只认 p.skill"的旧单槽版,
// 断言上面的判据**会**变红 —— 规则脚本最怕悄悄全绿。
//
// 用法(仓库根目录):
//   npx tsc -p tools/tsconfig.json && node .tools-build/tools/skill2-check.js [--selftest]
// ============================================================
import { Rules } from "../assets/scripts/core/rules";
import { Player as Pl } from "../assets/scripts/core/player";
import { Skills } from "../assets/scripts/core/skills";
import { Career } from "../assets/scripts/core/career";
import { CFG } from "../assets/scripts/core/config";
import {
  Ball, HitOpt, Player as PlayerEntity, PlayerInput, SkillId,
} from "../assets/scripts/core/types";
import { press, clearEdges, buildIntent, resetPadHolds, newPad } from "../assets/scripts/input/pad";
import { makeChecker } from "./harness";

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

const C = CFG;
const CO = C.court;
const SM = C.skills.smash;
const RG = C.skills.rage;
const FOCUS_CD = Skills.defOf("focus").cooldownFrames;
const SMASH_CD = Skills.defOf("smash").cooldownFrames;

const idleInput = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false,
  swingAim: null, lungePressed: false,
});

/** 球钉在场中的静态场景(激活/键面判据用;不涉及挥拍结算) */
function scene2(s1: SkillId | null, s2: SkillId | null): { hero: PlayerEntity; ball: Ball } {
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const hero = R.players[0];
  hero.skill = s1 ? Skills.initSkillState(s1) : undefined;
  hero.skill2 = s2 ? Skills.initSkillState(s2) : undefined;
  Skills.resetPoint(hero);
  hero.x = CO.netX - 170; hero.y = CO.groundY;
  hero.vx = 0; hero.vy = 0; hero.onGround = true;
  hero.swingT = -1; hero.swingBest = null; hero.swingHit = false; hero.hitLock = 0;
  hero.flashStrikeT = 0; hero.flashHoldT = 0; hero.focusT = 0; hero.focusHit = false;
  const ball = R.ball as Ball;
  ball.x = hero.x + 120; ball.y = CO.groundY - 90;
  ball.px = ball.x; ball.py = ball.y;
  ball.vx = -3; ball.vy = 0;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0;
  ball.lastHitter = "right"; ball.crossed = true; ball.netted = false;
  ball.shot = null; ball.magnetPull = null;
  R.state = "RALLY"; R.timer = 0; R.serveWait = 0; R.events.length = 0;
  return { hero, ball };
}

// ---------- A) 装备层(Career 双槽) ----------
{
  const pr = Career.profile();
  pr.level = 99;                       // 解锁全部,只测装备语义(等级闸另有专门一问)
  pr.equippedSkill = "lunge";
  pr.equippedSkill2 = null;

  ok(Career.equippedSkill() === "lunge" && Career.equippedSkill2() === null, "出厂:槽1 跨步、槽2 未携带");

  ok(Career.equipSkill("focus", 2), "槽2 装时空");
  ok(Career.equippedSkill2() === "focus" && Career.equippedSkill() === "lunge", "槽2 装上、槽1 不动");

  ok(Career.equipSkill("magnet", 2) && Career.equippedSkill2() === "magnet", "槽2 换装吸球(直接覆盖,不弹回)");

  ok(Career.equipSkill("magnet", 1), "把槽2的吸球装回槽1 → 触发互换");
  ok(Career.equippedSkill() === "magnet" && Career.equippedSkill2() === "lunge",
    `互换成立:槽1=${Career.equippedSkill()} 槽2=${Career.equippedSkill2() ?? "null"}(槽2 接走槽1 旧款)`);

  ok(Career.unequipSkill(2) && Career.equippedSkill2() === null, "卸下槽2");
  ok(!Career.equipSkill("magnet", 2), "槽1那款挪不进空槽2 被拒(槽1 恒有技能)");
  ok(Career.equippedSkill() === "magnet" && Career.equippedSkill2() === null, "拒绝后两槽原样");
  ok(!Career.unequipSkill(1), "卸下槽1 恒拒绝(口径:槽1 不可卸空)");
  ok(Career.equippedSkill() === "magnet", "槽1 仍是原款");

  // 解锁闸对槽2 同样生效(等级回落到 1,smash 需要 Lv.2)
  pr.level = 1;
  ok(!Career.equipSkill("smash", 2), "未解锁装槽2 被解锁闸拦住");
  pr.level = 99;

  // 老档兜底:手删槽2字段 → 读数退 null,不崩
  pr.equippedSkill2 = undefined;
  ok(Career.equippedSkill2() === null, "老档缺槽2字段 → 读 null(零迁移)");

  // 未知 id 的坏档 → 退 null(profile 的类型防御),别让 defOf 静默兜成跨步骗人
  pr.equippedSkill2 = "no-such-skill" as SkillId;
  ok(Career.profile().equippedSkill2 === null, "坏档未知技能 id → 槽2 退 null");
  pr.equippedSkill2 = null;

  // 还原现场:后面的段落直接操作 player.skill,不依赖这里的存档状态
  pr.equippedSkill = "lunge";
  pr.equippedSkill2 = null;
}

// ---------- B) 槽寻址 + 挂载 + AI 单槽 ----------
{
  const { hero } = scene2("smash", "rage");
  ok(Skills.slotState(hero, 1)?.id === "smash" && Skills.slotState(hero, 2)?.id === "rage",
    "slotState 按槽寻址(1=主槽 2=副槽)");
  ok(Skills.slotOfSkill(hero, "rage") === hero.skill2 && Skills.slotOfSkill(hero, "smash") === hero.skill,
    "slotOfSkill 按技能找槽(装在哪槽认哪槽)");
  ok(Skills.hasSkill(hero, "rage") && !Skills.hasSkill(hero, "focus"), "hasSkill 判携带");

  const { hero: solo } = scene2("smash", null);
  ok(!Skills.hasSkill(solo, "rage") && Skills.slotState(solo, 2) === undefined,
    "单槽玩家(槽2 空)寻址干净,不串味");

  // 对局挂载:applyToMatch 把两槽都装给真人(槽2 空则清掉残留对象)
  Career.profile().equippedSkill = "focus";
  Career.profile().equippedSkill2 = "smash";
  Rules.newMatch("1p", "normal");
  Career.applyToMatch();
  const me = Rules.R.players[0];
  ok(me.skill?.id === "focus" && me.skill2?.id === "smash", "applyToMatch 双槽挂载(槽1=focus 槽2=smash)");
  Career.profile().equippedSkill2 = null;
  Career.applyToMatch();
  ok(me.skill?.id === "focus" && me.skill2 === undefined, "槽2 卸下后再 apply → skill2 清成 undefined(不留残留)");

  // AI 不吃双槽(「只帮真人不帮电脑」):CPU 与关卡对手恒单槽
  const cpu = Rules.R.players.find((p) => p.isAI) as PlayerEntity;
  ok(!!cpu && !!cpu.skill && cpu.skill2 === undefined, "AI 恒单槽(skill2 恒 undefined)");
  Career.profile().equippedSkill = "lunge";
}

// ---------- C) 激活路由:skill2Pressed → 槽2,双槽状态互不挤兑 ----------
{
  const { hero, ball } = scene2("lunge", "focus");
  // 第 0 步:两槽同帧都按 —— 各激活各的
  Pl.update(hero, { ...idleInput(), lungePressed: true, skill2Pressed: true }, ball);
  ok((hero.skill?.cd ?? 0) > 0, `槽1 跨步激活付冷却(hero.skill.cd=${hero.skill?.cd})`);
  ok((hero.skill2?.buffT ?? 0) > 0 && (hero.focusT ?? 0) > 0, "槽2 时空激活:领域开在 focusT,armed 记在槽2");
  ok(hero.stats.skillCasts === 2, `同帧双释放计入 skillCasts(=${hero.stats.skillCasts})`);
  ok((hero.skill2?.cd ?? 0) === 0, "槽2 时空冷却推迟(defersCooldownToConsume 按槽判,激活不付)");

  // 冷却独立:槽1 冷却中不影响槽2 再放(领域收掉后再按一次)
  hero.focusT = 0; hero.skill2!.buffT = 0;
  Pl.update(hero, { ...idleInput(), skill2Pressed: true }, ball);
  ok((hero.skill2?.buffT ?? 0) > 0, "槽1 冷却中,槽2 照常激活(双槽互不挤兑)");
}

// ---------- D) modifyShot 组合语义(数值直接叠加,消耗各自结清) ----------
{
  // 重击(槽1 armed)× 怒气(槽2 armed,满一管):同拍 → 速度加成相加、forceSmash、
  // skillKind 后者赢(rage);消耗:重击进冷却、怒气扣一管
  const { hero } = scene2("smash", "rage");
  hero.skill!.buffT = SM.buffDuration;
  hero.skill2!.buffT = RG.releaseWindow;
  hero.rage = RG.max;                                   // 恰好一整管
  const sum = Skills.modifyShot(hero, { preview: false, q: 0.5 } as HitOpt);
  const rageBoost = RG.speedMin + (RG.speedMax - RG.speedMin) * 1;
  ok(Math.abs(sum.speedBoost - (SM.speedBoost + rageBoost)) < 1e-9,
    `重击×怒气同拍速度加成 = 相加(${sum.speedBoost.toFixed(2)} = ${SM.speedBoost}+${rageBoost.toFixed(2)}),口径「数值直接叠加」`);
  ok(sum.forceSmash, "forceSmash 任一满足");
  ok(sum.skillKind === "rage", `skillKind 后者赢(=${sum.skillKind},飘字/音效按单槽时代同一优先级)`);
  ok(hero.skill!.buffT === 0 && (hero.skill!.cd ?? 0) === SMASH_CD,
    `重击消耗:附魔清零 + 冷却这一拍开跑(cd=${hero.skill!.cd}/${SMASH_CD})`);
  ok(hero.rage === 0 && hero.skill2!.buffT === 0, "怒气消耗:整管扣掉 + armed 窗收掉(各付各的,不含糊)");
  ok(hero.smashAutoT === 0 && hero.rageAutoT === 0, "两条代拍窗一并收掉(兑现了就不许再代)");

  // 预告通道一口不吃(两个槽都一样):预览跑十遍,状态一个字节不动
  scene2("smash", "rage");
  const hero2 = Rules.R.players[0];
  hero2.skill!.buffT = SM.buffDuration;
  hero2.skill2!.buffT = RG.releaseWindow;
  hero2.rage = RG.max;
  for (let i = 0; i < 10; i++) Skills.modifyShot(hero2, { preview: true, q: 0.5 } as HitOpt);
  ok(hero2.skill!.buffT === SM.buffDuration && hero2.skill2!.buffT === RG.releaseWindow && hero2.rage === RG.max,
    "预告十连:双槽状态零消耗(preview 闸对两槽都有效)");

  // 跨步强化窗(Player 级)× 槽2 重击:同拍相加(窗口与槽位无关,天然叠加)
  scene2(null, "smash");
  const hero3 = Rules.R.players[0];
  hero3.lungeShotT = 60;
  hero3.skill2!.buffT = SM.buffDuration;
  const sum2 = Skills.modifyShot(hero3, { preview: false, q: 0.5, lungeShot: true } as HitOpt);
  ok(Math.abs(sum2.speedBoost - (C.lunge.shotBoost + SM.speedBoost)) < 1e-9,
    `跨步窗×重击同拍 = ${C.lunge.shotBoost}+${SM.speedBoost}(窗口不认槽,叠加口径一致)`);
  ok(hero3.lungeShotT === 0 && hero3.skill2!.buffT === 0, "两源都兑现:窗口与附魔一起清");

  // 单槽行为逐位不漂:只装怒气时,加成/消耗与单槽时代完全一致
  scene2(null, "rage");
  const hero4 = Rules.R.players[0];
  hero4.skill2!.buffT = RG.releaseWindow;
  hero4.rage = RG.max;
  const solo = Skills.modifyShot(hero4, { preview: false, q: 0.5 } as HitOpt);
  ok(Math.abs(solo.speedBoost - rageBoost) < 1e-9 && solo.rageRatio === 1 && hero4.rage === 0,
    "单装怒气(槽2):强度与消耗与旧单槽逐位一致");
}

// ---------- E) 时空领域 × 槽2 ----------
{
  // 领域中按技能2:恰好触发一次(激活吃边沿,不逐帧连发)
  const { hero, ball } = scene2("focus", "smash");
  Skills.activate(hero, ball, undefined, 1);            // 开领域
  const casts0 = hero.stats.skillCasts;
  Pl.update(hero, { ...idleInput(), skill2Pressed: true }, ball);
  ok((hero.skill2?.buffT ?? 0) > 0 && hero.stats.skillCasts === casts0 + 1, "领域中按技能2:重击照常上弦");
  for (let f = 0; f < 10; f++) Pl.update(hero, idleInput(), ball);
  ok(hero.stats.skillCasts === casts0 + 1, "领域中不按就不发(边沿语义,无凭空连发)");

  // 领域自然到期 → 冷却开在装 focus 的那一槽(先测槽2,再对照槽1)
  scene2("smash", "focus");
  const h2 = Rules.R.players[0];
  Skills.activate(h2, Rules.R.ball as Ball, undefined, 2);
  h2.focusT = 1;
  Pl.update(h2, idleInput(), Rules.R.ball as Ball);
  ok((h2.focusT ?? 0) === 0 && (h2.skill2?.cd ?? 0) === FOCUS_CD,
    `领域到期:槽2 时空开冷却(cd=${h2.skill2?.cd}/${FOCUS_CD}),槽1 重击不受牵连`);
  ok((h2.skill?.cd ?? 0) === 0, "槽1 cd 恒 0(到期冷却不串槽)");

  scene2("focus", "rage");
  const h3 = Rules.R.players[0];
  Skills.activate(h3, Rules.R.ball as Ball, undefined, 1);
  h3.focusT = 1;
  Pl.update(h3, idleInput(), Rules.R.ball as Ball);
  ok((h3.skill?.cd ?? 0) === FOCUS_CD, "槽1 时空到期开冷却(旧口径逐位不漂)");
}

// ---------- F) 代拍链:双窗并存按链序,armed 门按槽 ----------
{
  // 怒气装槽2、armed:rageAutoT 开着时链要认账(单槽版只认 p.skill.id === "rage")
  const { hero, ball } = scene2("lunge", "rage");
  hero.rage = RG.max;
  Skills.activate(hero, ball, undefined, 2);            // 怒气 armed + rageAutoT 开
  ok((hero.skill2?.buffT ?? 0) > 0 && (hero.rageAutoT ?? 0) > 0, "槽2 怒气 armed + 代拍窗开(只给真人)");

  // 双窗并存:跨步窗 + 重击窗同开 → 链先让跨步代拍(lunge > smash),重击窗留到下一拍
  const { hero: h4, ball: b4 } = scene2("lunge", "smash");
  Skills.activate(h4, b4, undefined, 1);                // 跨步:lungeAutoT 开
  Skills.activate(h4, b4, undefined, 2);                // 重击:armed + smashAutoT 开
  const origDue = Pl.autoSwingDue;
  Pl.autoSwingDue = (): boolean => true;                // 择帧尺子换成"该按了",只验链序
  try {
    Pl.update(h4, idleInput(), b4);
    ok(h4.swingT >= 0 && (h4.smashAutoT ?? 0) > 0,
      "双窗同开第一拍:跨步先代(lungeAutoT 未清兼判定区开关),重击窗留着");
    const swingT = h4.swingT;
    Pl.update(h4, idleInput(), b4);
    ok(h4.swingT > swingT, "跨步代拍进行中,链不重复起拍(else-if 链 + swingT 钉死)");
    // 跨步窗收掉后,同帧重击窗顶上 —— armed 门读槽2
    h4.swingT = -1; h4.lungeAutoT = 0;
    Pl.update(h4, idleInput(), b4);
    ok(h4.swingT >= 0 && (h4.smashAutoT ?? 0) === 0, "跨步窗清掉后重击代拍顶上(smashAutoT 当场清)");
  } finally {
    Pl.autoSwingDue = origDue;                          // patch 必须还原,selftest 才能再换反例
  }
}

// ---------- G) 输入层:pad 的 skill2 与 lunge 同构 ----------
{
  const pad = newPad();
  press(pad, "skill2");
  ok(pad.skill2Pressed === true, "press(skill2) 置边沿");
  ok(pad.skill2Dir === 0, "无方向意图时方向 = lastDir(0)");
  pad.left = true; press(pad, "skill2");
  ok(pad.skill2Dir === -1, "按着左键按技能2 → 方向 -1(与 lunge 同一条优先级)");
  pad.left = false;
  clearEdges(pad);
  ok(!pad.skill2Pressed && pad.skill2Dir === 0, "clearEdges 清 skill2 边沿与方向");

  press(pad, "skill2");
  const inp = buildIntent(pad, {});
  ok(inp.skill2Pressed === true && inp.skill2Dir === 0, "buildIntent 输出 skill2Pressed/skill2Dir(喂 player 双槽路由)");
  clearEdges(pad);
  resetPadHolds(pad);
  press(pad, "skill2");
  resetPadHolds(pad);
  ok(!pad.skill2Pressed, "resetPadHolds 清 skill2 残边沿(换局不漏按)");

  // skill2 触发也消费滑轨 targetX(跨步接管滑轨的同一规矩,槽2装的跨步同样适用)
  press(pad, "skill2");
  pad.targetX = 123;
  clearEdges(pad);
  ok(pad.targetX === undefined, "技能2 边沿消费 targetX(避免跨步爆发后被拉回旧目标)");
}

// ---------- H) resetPoint 清双槽 ----------
{
  const { hero } = scene2("smash", "magnet");
  hero.skill!.cd = 100; hero.skill!.buffT = SM.buffDuration;
  hero.skill2!.cd = 50; hero.skill2!.magnetPulling = true;
  Skills.resetPoint(hero);
  ok(hero.skill!.cd === 0 && hero.skill!.buffT === 0, "resetPoint 清槽1(冷却/附魔)");
  const mp = hero.skill2?.magnetPulling ?? false;
  ok(hero.skill2!.cd === 0 && mp === false, "resetPoint 清槽2(冷却/牵引)—— 残留跨分就是白送");
}

// ---------- selftest:旧单槽实现必须被拦下 ----------
if (process.argv.includes("--selftest")) {
  console.log("\nselftest:把 modifyShot / activate 换回「只认 p.skill」的旧单槽版,判据必须变红");

  // (a) 单槽版 modifyShot:只读 p.skill(双槽化之前全体判据的真实形状)。
  //     槽1=smash、槽2=rage 的场景下,怒气的加成/消耗整块蒸发 —— 叠加判据必须报红。
  const origModify = Skills.modifyShot;
  Skills.modifyShot = (p: PlayerEntity, opt: HitOpt) => {
    if (p.skill2 && !p.skill) {
      // 单槽版连"槽2存在"都看不见:把槽2的 armed 抄进槽1再跑,读数才会碰得到
      return origModify({ ...p, skill: p.skill2, skill2: undefined } as PlayerEntity, opt);
    }
    return origModify({ ...p, skill2: undefined } as PlayerEntity, opt);
  };
  const dualViolations: string[] = [];
  {
    const { hero } = scene2("smash", "rage");
    hero.skill!.buffT = SM.buffDuration;
    hero.skill2!.buffT = RG.releaseWindow;
    hero.rage = RG.max;
    const sum = Skills.modifyShot(hero, { preview: false, q: 0.5 } as HitOpt);
    const rageBoost = RG.speedMin + (RG.speedMax - RG.speedMin) * 1;
    if (Math.abs(sum.speedBoost - (SM.speedBoost + rageBoost)) >= 1e-9) {
      dualViolations.push(`速度加成 ${sum.speedBoost.toFixed(2)} ≠ 相加 ${(SM.speedBoost + rageBoost).toFixed(2)}`);
    }
    if (hero.rage !== 0) dualViolations.push("怒气一管没扣(单槽版看不见槽2的 armed)");
  }
  ok(dualViolations.length > 0, `(a) 单槽版 modifyShot 被叠加判据点名:${dualViolations.join(" / ")}`);
  Skills.modifyShot = origModify;

  // (b) 单槽版 activate:忽略槽参数、恒写槽1。槽2 的激活路由必须报"按了没反应"。
  const origActivate = Skills.activate;
  const origCanActivate = Skills.canActivate;
  Skills.activate = ((p: PlayerEntity, ball: Ball, dir?: number) => origActivate(p, ball, dir, 1)) as typeof Skills.activate;
  Skills.canActivate = ((p: PlayerEntity, ball: Ball) => origCanActivate(p, ball, 1)) as typeof Skills.canActivate;
  const routeViolations: string[] = [];
  {
    const { hero, ball } = scene2(null, "focus");
    const before = hero.focusT ?? 0;
    Pl.update(hero, { ...idleInput(), skill2Pressed: true }, ball);
    if (!((hero.skill2?.buffT ?? 0) > 0) && (hero.focusT ?? 0) <= before) {
      routeViolations.push("skill2Pressed 按了没反应(单槽版把槽2的激活路由进了槽1)");
    }
  }
  ok(routeViolations.length > 0, `(b) 单槽版 activate/canActivate 被路由判据点名:${routeViolations.join(" / ")}`);
  Skills.activate = origActivate;
  Skills.canActivate = origCanActivate;
}

console.log(`\n${h.fails === 0 ? "✓" : "✗"} skill2-check:${h.checks} 项断言,失败 ${h.fails}`);
process.exit(h.fails === 0 ? 0 : 1);
