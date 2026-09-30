// 特殊击球触发系统回归(2026-10-01 重做:触发从「随机碰」改成「成因可见、可主动复现」)。
// 把新系统的承诺逐条钉死:
//   ① 跳杀:空中 + 击球点离地 ≥ C.jumpSmash.minHeight = 必然扣杀 + jumpSmash 标记,
//      真人与 AI 走同一条 tryHit 通道;地面拍 / 空中低球不许触发。
//      高度门槛还必须高于站地击球点(-C.swing.pivotY),否则跳不跳没有区别。
//   ② 球种预告:previewKind 与实打共用同一条 buildShot 代码路径 —— 空中高球预告扣杀、
//      near 瞄准预告并实打出放网、正常地面拍重复采样不抖(预告与实打不会各画各的)。
//   ③ 时机档:真人恒上报带符号 timingGrade(负=早 正=晚 0=正中);非甜蜜才有 timingHint,
//      甜蜜/完美不打扰;AI 永不上报(时机误差是难度参数,不该"被教学")。
//   ④ 技能门槛原因:skillBlockReason 对「就绪但门槛未满足」给可读文案,冷却/就绪返回 null。
//   --selftest:把 blockText 文案表清空(旧版「静默拒绝」的真实状态)——
//      门槛原因的断言必须在这套旧世界里红掉,否则「有提示」的契约没有牙齿。
//
// 用法:node .tools-build/tools/spec-shot-check.js(加 --selftest 跑反例)
import { Rules } from "../assets/scripts/core/rules";
import { Player as Pl } from "../assets/scripts/core/player";
import { Skills } from "../assets/scripts/core/skills";
import { CFG } from "../assets/scripts/core/config";
import { Ball, Player as PlayerEntity, ShotResult, TeamSide } from "../assets/scripts/core/types";

const C = CFG;
const CO = C.court;
const SW = C.swing;

let failures = 0;
let checks = 0;
const assert = (cond: boolean, msg: string): void => {
  checks++;
  if (!cond) { failures++; console.log(`  ✗ ${msg}`); }
};

/** 摆一记来球到 hero 的判定区心;lift = 人悬空高度(px,0 = 地面),球高跟着抬高 */
function setup(opts: { side?: TeamSide; lift?: number; swingT?: number } = {}):
  { R: typeof Rules.R; hero: PlayerEntity; ball: Ball } {
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const idx = opts.side === "right" ? 1 : 0;
  const hero = R.players[idx];
  const lift = opts.lift ?? 0;
  hero.x = idx === 0 ? CO.netX - 170 : CO.netX + 170;
  hero.y = CO.groundY - lift;
  hero.vx = 0; hero.vy = 0;
  hero.onGround = lift <= 0;
  hero.swingT = opts.swingT ?? (SW.windup + 8);   // 窗口正中 = 质量峰(第 9 帧)
  hero.hitLock = 0; hero.swingHit = false;
  hero.swingStyle = "over"; hero.swingAim = C.aimDepth.mid;
  hero.stats.whiffs = 0;
  const ball = R.ball as Ball;
  const z = Pl.strikeZone(hero, 5);
  ball.x = z.x; ball.y = z.y;
  ball.px = ball.x; ball.py = ball.y;
  ball.vx = idx === 0 ? -3 : 3; ball.vy = 2;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0;
  ball.lastHitter = idx === 0 ? "right" : "left";
  ball.crossed = true; ball.netted = false; ball.shot = null;
  ball.magnetPull = null;
  R.state = "RALLY"; R.timer = 0; R.serveWait = 0;
  R.events.length = 0;
  return { R, hero, ball };
}

console.log("① 跳杀:空中 + 高球 = 必然扣杀(两侧 × 三种悬空状态的确定性网格)");
for (const side of ["left", "right"] as TeamSide[]) {
  for (const lift of [60, 20, 0]) {
    const { hero, ball } = setup({ side, lift });
    const shot = Pl.tryHit(hero, ball) as ShotResult;
    const expect = lift >= 60;   // 球高 = lift + 70 + rad·0.06:lift=60 → ≈134(≥105),20 → ≈94(<105)
    assert(!!shot, `${side} lift=${lift}:判定区心一拍应当命中`);
    assert(shot.jumpSmash === expect, `${side} lift=${lift}:jumpSmash 标记应=${expect}`);
    if (expect) assert(shot.kind === "smash", `${side} lift=${lift}:跳杀必须定性为扣杀`);
  }
}
assert(C.jumpSmash.minHeight > -C.swing.pivotY,
  `跳杀门槛 ${C.jumpSmash.minHeight} 必须高于站地击球点(${-C.swing.pivotY}),否则地面拍也会被算成跳杀`);

console.log("② 球种预告:previewKind 与实打同一代码路径");
{
  const { hero } = setup({ lift: 60 });
  assert(Pl.previewKind(hero, Rules.R.ball as Ball) === "smash", "空中高球应预告扣杀");
}
{
  const { hero, ball } = setup({});   // 地面 mid 瞄准,远离放网/平抽边界,重复采样必须稳定
  const kinds = new Set(Array.from({ length: 8 }, () => Pl.previewKind(hero, ball)));
  assert(kinds.size === 1, `地面正常拍预告应稳定不抖(实际:${[...kinds].join("/")})`);
}
{
  const { hero, ball } = setup({});
  hero.swingAim = C.aimDepth.near;    // 落点深度 0.12 < netDepth 0.3 → 预告与实打都应是放网
  const pk = Pl.previewKind(hero, ball);
  const shot = Pl.tryHit(hero, ball) as ShotResult;
  assert(pk === "netshot", `near 瞄准应预告放网(实际:${pk})`);
  assert(!!shot && shot.kind === "netshot", `near 瞄准实打也应是放网(实际:${shot?.kind})`);
}

console.log("③ 时机档:带符号 timingGrade + 非甜蜜才提示");
{
  const { hero, ball } = setup({ swingT: SW.windup + 3 });   // 第 3 帧 = 偏早
  const shot = Pl.tryHit(hero, ball) as ShotResult;
  assert(!!shot && typeof shot.timingGrade === "number" && shot.timingGrade! < 0,
    `早拍 timingGrade 应为负(实际:${shot?.timingGrade})`);
  assert(shot.timingHint === "early", `早拍应给 early 提示(实际:${shot?.timingHint})`);
}
{
  const { hero, ball } = setup({ swingT: SW.windup + 14 });  // 第 14 帧 = 偏晚
  const shot = Pl.tryHit(hero, ball) as ShotResult;
  assert(!!shot && shot.timingGrade! > 0, `晚拍 timingGrade 应为正(实际:${shot?.timingGrade})`);
  assert(shot.timingHint === "late", `晚拍应给 late 提示(实际:${shot?.timingHint})`);
}
{
  const { hero, ball } = setup({});                           // 正中 = 完美
  const shot = Pl.tryHit(hero, ball) as ShotResult;
  assert(!!shot && Math.abs(shot.timingGrade!) < 0.05, `正中档应≈0(实际:${shot?.timingGrade})`);
  assert(shot.timingHint == null, "踩进甜蜜/完美不给「早了晚了」");
}
{
  const { hero, ball } = setup({ side: "right" });            // AI 不上报时机档
  const shot = Pl.tryHit(hero, ball) as ShotResult;
  assert(shot.timingGrade === undefined && shot.timingHint === undefined, "AI 不得上报时机档/提示");
}
{
  // 窗口宽度契约:完美窗 ≥4 帧(80ms 量级),且必须窄于甜蜜窗
  const winS = SW.active * C.sweet.coreRatio;
  const winP = SW.active * C.perfect.coreRatio;
  assert(winP >= 4, `完美窗 ${winP.toFixed(1)} 帧应 ≥4 帧(旧 0.15 只有 2.4 帧 = "撞出来的完美")`);
  assert(winS > winP, `甜蜜窗 ${winS.toFixed(1)} 帧必须宽于完美窗`);
}

console.log("④ 技能门槛原因:skillBlockReason");
{
  const { R, hero } = setup({ lift: 60 });                    // 空中按跨步 → 落地再按
  hero.skill = Skills.initSkillState("lunge");
  Skills.resetPoint(hero);
  hero.swingT = -1; hero.lungeT = -1;
  const reason = Skills.skillBlockReason(hero, R.ball);
  assert(reason === C.skills.blockText.needGround, `空中按跨步应报「${C.skills.blockText.needGround}」,实际「${reason}」`);
}
{
  const { R, hero } = setup({});                              // 地面静立 → 完全就绪,无原因
  hero.skill = Skills.initSkillState("lunge");
  Skills.resetPoint(hero);
  hero.swingT = -1; hero.lungeT = -1;
  assert(Skills.skillBlockReason(hero, R.ball) === null, "地面静立跨步应完全就绪(无原因)");
}
{
  const { R, hero, ball } = setup({});                        // 冷却中 → 走倒计时,不叠原因
  hero.skill = Skills.initSkillState("lunge");
  Skills.resetPoint(hero);
  hero.swingT = -1; hero.lungeT = -1;
  hero.skill.cd = 30; hero.skill.maxCd = 60;
  assert(Skills.skillBlockReason(hero, ball) === null, "冷却中不报门槛原因(那是倒计时的职责)");
}
{
  const { R, hero, ball } = setup({});                        // 附魔进行中 → 附魔中
  hero.skill = Skills.initSkillState("smash");
  Skills.resetPoint(hero);
  hero.skill.buffT = 10;
  assert(Skills.skillBlockReason(hero, ball) === C.skills.blockText.buffing, "附魔期应报「附魔中」");
}
{
  const { R, hero, ball } = setup({});                        // 低球 → 球不够高
  hero.skill = Skills.initSkillState("flash");
  Skills.resetPoint(hero);
  hero.swingT = -1;
  ball.y = CO.groundY - 40;                                   // 低于 flash.minHeight
  assert(Skills.skillBlockReason(hero, ball) === C.skills.blockText.lowBall, `低球应报「${C.skills.blockText.lowBall}」,实际「${Skills.skillBlockReason(hero, ball)}」`);
}
{
  const { R, hero, ball } = setup({});                        // 自家球 → 球没过来
  hero.skill = Skills.initSkillState("flash");
  Skills.resetPoint(hero);
  hero.swingT = -1;
  ball.y = CO.groundY - 130; ball.lastHitter = hero.side;     // 高度够但是自己刚打的
  assert(Skills.skillBlockReason(hero, ball) === C.skills.blockText.notIncoming, "自家球应报「球没过来」");
}

console.log("");
if (failures === 0) {
  console.log(`全部通过:${checks} 条断言 ✓`);
} else {
  console.log(`失败 ${failures}/${checks} 条`);
  process.exit(1);
}

// ---------- --selftest:反例必须被报警 ----------
// 把 blockText 文案表清空 = 旧版「静默拒绝」的真实状态(判据还在,玩家什么都看不到)。
// 门槛原因的断言在这套旧世界里必须红掉,否则本工具没有牙齿。
if (process.argv.includes("--selftest")) {
  const table = C.skills.blockText as Record<string, string>;
  const saved = { ...table };
  for (const k of Object.keys(table)) table[k] = "";
  let anti = 0;
  const antiAssert = (cond: boolean, msg: string): void => { if (!cond) { anti++; console.log(`    (反例命中)${msg}`); } };
  const { R, hero } = setup({ lift: 60 });
  hero.skill = Skills.initSkillState("lunge");
  Skills.resetPoint(hero);
  hero.swingT = -1; hero.lungeT = -1;
  antiAssert(Skills.skillBlockReason(hero, R.ball) === saved.needGround, "空文案表下门槛原因断言应失败");
  for (const k of Object.keys(table)) table[k] = saved[k];
  if (anti === 0) {
    console.log("✗ 反例没被抓住:空文案表下断言仍全绿 —— 本工具没有牙齿");
    process.exit(1);
  }
  console.log(`--selftest 通过:反例被正确报警(${anti} 条)`);
}
