// 特殊击球触发系统回归(2026-10-01 第二轮:挥拍峰值追踪 + 提示反应补偿)。
// 本轮修的现场问题:「明明按着光环来点,但就是没触发」—— 根因有三层:
//   ① swingCue.arriveRadius 0.5 让「环收满」锚在球进内缩区,不是区心 → 按环按 = 早按;
//   ② 旧 tryHit 先到先得:球一碰判定区边缘就结算,质量取那一帧挥拍相位 → 进区帧比过心早
//      r/v 帧,按环收满按的 qRaw 崩塌,慢球必出普通球;
//   ③ 提示锚在 lead(按拍点)上发,人看到再按晚 9~15 帧 → 系统性迟到。
// 新契约(本文件逐条钉死):
//   ① 跳杀(飞行场景):空中 + 击球点离地 ≥ C.jumpSmash.minHeight = 必然扣杀,
//      真人与 AI 走同一条 tryHit 通道;地面拍 / 空中低球不许触发。
//   ② 球种预告:previewKind 与实打共用同一条 buildShot 代码路径。
//   ③ 时机(飞行场景,球直线飞向判定区心):
//      - 按提示按(late=0)必出完美特殊球,timingGrade≈0、无早/晚提示;
//      - ±2 帧内仍完美(峰值追踪:挥拍峰落进判定区即 qRaw 顶格);
//      - 中度偏差 grade 带正确符号(负=早 正=晚);大偏差晚按 = 普通球 + 「晚了」;
//        大偏差早按 = 普通球 + 「早了」;极端偏差 = 挥空。
//      - 结算帧契约:峰值追踪下「球离区心最近的记账帧」出手,静态摆球永远结算不出
//        (球不出区、窗未走完),所以本文件所有出球断言必须走飞行场景。
//   ④ AI 永不上报时机档(时机误差是难度参数,不该"被教学")。
//   ⑤ config 锚点契约:arriveRadius ≈ 0(锚区心)/ reactFrames 反应补偿 / 环跨度 ≤ 预算。
//   ⑥ 技能门槛原因:skillBlockReason 对「就绪但门槛未满足」给可读文案(不变)。
//   --selftest:把 blockText 文案表清空(旧版「静默拒绝」的真实状态),断言必须红掉。
//   --grid:打印 late −16..+16 的实测档位/时机读数(调判定几何时的人眼对照表)。
//
// 用法:node .tools-build/tools/spec-shot-check.js [--selftest] [--grid]
import { Rules } from "../assets/scripts/core/rules";
import { Player as Pl, PRESS_LEAD_FRAMES } from "../assets/scripts/core/player";
import { Skills } from "../assets/scripts/core/skills";
import { CFG } from "../assets/scripts/core/config";
import { Ball, Player as PlayerEntity, PlayerInput, ShotResult, TeamSide } from "../assets/scripts/core/types";

const C = CFG;
const CO = C.court;
const SW = C.swing;

let failures = 0;
let checks = 0;
const assert = (cond: boolean, msg: string): void => {
  checks++;
  if (!cond) { failures++; console.log(`  ✗ ${msg}`); }
};

/** 静态摆球(仅供 previewKind / skillBlockReason 这类不依赖结算时机的测试) */
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

/**
 * 飞行场景:球从判定区心前方直线飞向区心(匀速无重力 —— tryHit 只读位置,不积分),
 * 真人第 0 帧起拍,与 rules.step 同序:update → 球推进 → tryHit。
 * late = 相对最佳按拍点「晚」按的帧数(负 = 早按):球在 swingT = PRESS_LEAD_FRAMES − late
 * 那一帧到达判定区心。late=0 即「提示闪环 → 反应 reactFrames 帧 → 按下」的理想按拍。
 * 悬空(lift>0)时每帧钉住人的位置:真实跳跃会落地移走判定区,那是跳跃系统的事,这里测触发。
 */
function flight(opts: {
  late?: number; v?: number; lift?: number; side?: TeamSide; aim?: string; frames?: number;
} = {}): { R: typeof Rules.R; hero: PlayerEntity; ball: Ball; shot: ShotResult | null } {
  const late = opts.late ?? 0;
  const v = opts.v ?? 8;
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const idx = opts.side === "right" ? 1 : 0;
  const hero = R.players[idx];
  const lift = opts.lift ?? 0;
  const from = idx === 0 ? 1 : -1;              // 来球从面向一侧飞来
  hero.x = idx === 0 ? CO.netX - 170 : CO.netX + 170;
  hero.y = CO.groundY - lift;
  hero.vx = 0; hero.vy = 0; hero.onGround = lift <= 0;
  hero.hitLock = 0; hero.swingHit = false; hero.swingT = -1; hero.swingBest = null;
  hero.stats.whiffs = 0;
  const ball = R.ball as Ball;
  // 起拍前先把球摆在同档高度:swingStyle(over/under)由球高决定,起拍定格后不再变
  ball.x = hero.x + from * 300; ball.y = CO.groundY - lift - 76;
  ball.px = ball.x; ball.py = ball.y;
  ball.vx = -from * v; ball.vy = 0;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.lastHitter = idx === 0 ? "right" : "left";
  ball.crossed = true; ball.netted = false; ball.shot = null;
  ball.magnetPull = null; ball.flying = false; ball.flyT = 0;
  R.state = "RALLY"; R.timer = 0; R.serveWait = 0; R.events.length = 0;

  const inp: PlayerInput = { left: false, right: false, jumpPressed: false, jumpHeld: false, swingAim: null, lungePressed: false };
  inp.swingAim = opts.aim ?? "mid";
  Pl.update(hero, inp, ball);                   // 第 0 帧起拍:startSwing 按来球速定 swingRadius
  const Tc = PRESS_LEAD_FRAMES - late;          // 球到判定区心的帧号
  const z = Pl.strikeZone(hero, v);             // 起拍后半径已定,区心从此不动
  ball.x = z.x + from * v * Tc; ball.y = z.y;
  ball.px = ball.x; ball.py = ball.y;

  let shot: ShotResult | null = null;
  const frames = opts.frames ?? 40;
  for (let f = 1; f <= frames; f++) {
    inp.swingAim = null;
    Pl.update(hero, inp, ball);
    if (lift > 0) { hero.y = CO.groundY - lift; hero.vy = 0; hero.onGround = false; }
    ball.px = ball.x; ball.py = ball.y;
    ball.x += ball.vx;
    const s = Pl.tryHit(hero, ball);
    if (s && !shot) shot = s;
  }
  return { R, hero, ball, shot };
}

console.log("① 跳杀:空中 + 高球 = 必然扣杀(飞行场景,两侧 × 四种悬空状态)");
for (const side of ["left", "right"] as TeamSide[]) {
  for (const lift of [70, 60, 20, 0]) {
    const { hero, shot } = flight({ side, lift });
    const expect = lift >= 70;   // 球高 = lift + 70 + rad·0.06:lift=70 → ≈144(≥140),60 → ≈134(压线反例,<140),20 → ≈94,0 → ≈74
    assert(!!shot, `${side} lift=${lift}:按准一拍应当命中`);
    assert(shot!.jumpSmash === expect, `${side} lift=${lift}:jumpSmash 标记应=${expect}`);
    assert(shot!.perfect === true, `${side} lift=${lift}:按准必出完美(特殊球触发就是本修复的验收线)`);
    if (expect) assert(shot!.kind === "smash", `${side} lift=${lift}:跳杀必须定性为扣杀`);
    void hero;
  }
}
assert(C.jumpSmash.minHeight > -C.swing.pivotY,
  `跳杀门槛 ${C.jumpSmash.minHeight} 必须高于站地击球点(${-C.swing.pivotY}),否则地面拍也会被算成跳杀`);

console.log("② 球种预告:previewKind 与实打同一代码路径");
{
  const { hero } = setup({ lift: 70 });   // 击球点 ≈144 ≥ jumpSmash.minHeight(140)才预告扣杀
  assert(Pl.previewKind(hero, Rules.R.ball as Ball) === "smash", "空中高球应预告扣杀");
}
{
  const { hero, ball } = setup({});   // 地面 mid 瞄准,远离放网/平抽边界,重复采样必须稳定
  const kinds = new Set(Array.from({ length: 8 }, () => Pl.previewKind(hero, ball)));
  assert(kinds.size === 1, `地面正常拍预告应稳定不抖(实际:${[...kinds].join("/")})`);
}
{
  const { hero, ball } = setup({});
  hero.swingAim = "near";             // 落点深度 near < netDepth → 预告放网
  const pk = Pl.previewKind(hero, ball);
  assert(pk === "netshot", `near 瞄准应预告放网(实际:${pk})`);
  const { shot } = flight({ aim: "near" });
  assert(!!shot && shot.kind === "netshot", `near 瞄准实打也应是放网(实际:${shot?.kind})`);
}

console.log("③ 时机契约(飞行场景):按准必完美 + 偏差带正确符号");
{
  const { shot } = flight({ late: 0 });                       // 理想按拍(提示→反应→按下)
  assert(!!shot, "理想按拍应当命中");
  assert(shot!.perfect === true, `理想按拍必出完美(实际 q=${shot!.q.toFixed(2)})`);
  assert(shot!.sweet === true, "完美必是甜蜜(档级包含)");
  assert(Math.abs(shot!.timingGrade!) <= 0.14, `理想按拍时机档应≈0(实际:${shot!.timingGrade})`);
  assert(shot!.timingHint == null, "踩准了不给「早了/晚了」");
}
for (const late of [-2, 2]) {
  const { shot } = flight({ late });
  assert(!!shot && shot.perfect === true, `±${Math.abs(late)} 帧偏差仍应完美(峰值追踪:峰落进判定区即顶格;实际:${shot && `q=${shot.q.toFixed(2)} perfect=${shot.perfect}`})`);
}
{
  const { shot } = flight({ late: 6 });                       // 峰时球已越过区心 48px
  assert(!!shot && shot.perfect === false, "峰时球已越过背后界限,不应完美");
  assert(shot!.timingGrade! > 0.15, `晚按 6 帧时机档应为正(实际:${shot!.timingGrade})`);
}
{
  const { shot } = flight({ late: 9 });                       // 球过心时挥拍窗刚开
  assert(!!shot && shot.sweet === false, `晚按 9 帧应跌出甜蜜(实际:${shot && `q=${shot.q.toFixed(2)} sweet=${shot.sweet}`})`);
  assert(shot!.timingHint === "late", `晚按 9 帧应提示 late(实际:${shot!.timingHint})`);
}
{
  const { shot } = flight({ late: -16 });                     // 球进区时挥拍窗只剩尾巴
  assert(!!shot && shot.sweet === false, `早按 16 帧应跌出甜蜜(实际:${shot && `q=${shot.q.toFixed(2)} sweet=${shot.sweet}`})`);
  assert(shot!.timingHint === "early", `早按 16 帧应提示 early(实际:${shot!.timingHint})`);
}
{
  const { shot, hero } = flight({ late: 16 });                // 球过心在起拍前:没得打
  assert(shot === null, `极端晚按应挥空(实际:${shot && `出了 ${shot.kind}`})`);
  assert(hero.stats.whiffs === 1, "挥空要计入 whiffs");
}
{
  const { shot } = flight({ late: -20 });                     // 球进区在挥拍窗结束后
  assert(shot === null, `极端早按同样挥空(实际:${shot && `出了 ${shot.kind}`})`);
}
{
  // 挥拍峰追踪结算契约:静态摆球(球不出区、窗未走完)不得出手 —— 结算等「离区心最近帧」
  const { hero, ball } = setup({});
  const s = Pl.tryHit(hero, ball);
  assert(s === null, "峰值追踪:球停在区内不得当场结算(旧先到先得已废)");
  assert(hero.swingBest !== null, "静态球应已记账(swingBest 非空)");
}
{
  // 窗口宽度契约:完美窗 ≥4 帧(80ms 量级),且必须窄于甜蜜窗
  const winS = SW.active * C.sweet.coreRatio;
  const winP = SW.active * C.perfect.coreRatio;
  assert(winP >= 4, `完美窗 ${winP.toFixed(1)} 帧应 ≥4 帧(旧 0.15 只有 2.4 帧 = "撞出来的完美")`);
  assert(winS > winP, `甜蜜窗 ${winS.toFixed(1)} 帧必须宽于完美窗`);
}

console.log("④ AI 永不上报时机档");
{
  const { shot } = flight({ side: "right" });
  assert(!!shot, "AI 按准也应当命中");
  assert(shot!.timingGrade === undefined && shot!.timingHint === undefined, "AI 不得上报时机档/提示");
  assert(shot!.perfect === true, "AI 按准同样拿完美(同一通道,不搞双标)");
}

console.log("⑤ config 锚点契约:「按着光环没触发」的根因修复");
{
  const cue = C.swingCue;
  // 锚点契约现在是结构性的:game-root/ai-check 的 fc 一律取 flightFramesToClosest
  // (最近逼近帧,对走位误差鲁棒)—— 曾经的「进入内缩小圆」锚(0.5)按环必早按,
  // 改 0.04 又要求路径精确穿心、fc 恒 null(替身整局挥不上 3 拍),两种都翻过车。
  assert(!("arriveRadius" in cue), "swingCue 不得再带 arriveRadius(小圆锚环已废,fc 一律用最近逼近帧)");
  assert(cue.reactFrames >= 8, `swingCue.reactFrames=${cue.reactFrames} 应给人类反应留帧(旧 0 = 提示说「现在按」时按已经晚了)`);
  assert(PRESS_LEAD_FRAMES === SW.windup + 0.5 + (SW.active - 1) / 2, "PRESS_LEAD_FRAMES 必须等于质量峰帧(按下后第 9 帧)");
  assert(C.timingRing.spanFrames <= cue.horizonFrames, "时机环跨度不得超过预告预算,否则环还没开始收球就到了");
  // 反应补偿后的按拍窗:提示帧 = 峰帧 + reactFrames;玩家反应 6~15 帧都落在容错带内
  const pressAt = PRESS_LEAD_FRAMES + cue.reactFrames;
  assert(pressAt + 5 <= cue.horizonFrames, "提示帧 + 快反应余量不得超过预告预算");
}

console.log("⑥ 技能门槛原因:skillBlockReason");
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

// ---------- --grid:晚按/早按全档位实测表(调判定几何时的人眼对照) ----------
if (process.argv.includes("--grid")) {
  console.log("\nlate(帧) | 档位          | qRaw→q   | grade | hint");
  for (let late = -20; late <= 16; late += 2) {
    const { shot } = flight({ late });
    if (!shot) { console.log(`${String(late).padStart(4)}      | 挥空`); continue; }
    const grade = shot.timingGrade ?? 0;
    const tag = shot.perfect ? "perfect" : shot.sweet ? "sweet" : "normal";
    console.log(`${String(late).padStart(4)}      | ${tag.padEnd(13)} | ${shot.q.toFixed(2)}     | ${grade >= 0 ? "+" : ""}${grade.toFixed(2)}  | ${shot.timingHint ?? "-"}`);
  }
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
