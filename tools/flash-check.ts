// 闪现扣杀必中回归(2026-09-30 新增)。
// 背景:旧闪现把脚底瞬移到「球上方 15px」,而判定区圆心在脚底上方 ~73px —— 球永远落在
// 圆心下方 ~88px,超出判定半径,于是一按闪现就是「闪过去了、球没打到」+ 白吃 5 秒冷却。
// 现在闪现改成:站位按判定区圆心反解 + 折跃那几帧球被按在半空(rules 的时停)+ 保底接触窗口。
// 本工具把这套承诺钉死,在「高度 × 横向位置 × 来球速度 ×  sides」的网格上逐格按技能,断言
//   ① 一定打出扣杀(kind=smash 且 skillKind=flash)、不挥空、落点在对方场内
//   ② 响应够快(按完到出球的帧数封顶,不能拖成"我按了但半天没反应")
//   ③ 该拒绝的场合照旧拒绝(自家球 / 低球 / 隔网球)
//   ④ 蓄力期球与人都不动(时停在机制上真的成立)
//   ⑤ 落位本来就在判定区圆心里 —— 保底窗口只是兜底,不是唯一支柱
//   ⑥ 高度威力曲线 + 顶点天雷(2026-10-06):出球矢量随接触高度乘算,与基线的比值单调、
//      低球逐位不变、apexHeight 台阶踩在真实接触高度上、乘后真实弹道仍落对方场内不下网
//
// 用法:node .tools-build/tools/flash-check.js
import { Rules } from "../assets/scripts/core/rules";
import { Player as Pl } from "../assets/scripts/core/player";
import { Skills } from "../assets/scripts/core/skills";
import { Physics } from "../assets/scripts/core/physics";
import { CFG } from "../assets/scripts/core/config";
import { Ball, PlayerInput, TeamSide, Player as PlayerEntity } from "../assets/scripts/core/types";

const C = CFG;
const CO = C.court;

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
  if (!cond) { failures++; console.log(`  ✗ ${msg}`); }
};

const emptyInput = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false,
  swingAim: null, lungePressed: false,
});

/** 站位镜像:左队的贴网位 ↔ 右队的贴网位 */
const mirror = (x: number): number => CO.netX * 2 - x;

/** 把局面摆成「来球正在该侧半场高空」:跳过分发球员循环,只测技能那一下 */
function setup(side: TeamSide, h: number, x: number, vx: number, vy: number): { hero: PlayerEntity; ball: Ball } {
  Rules.newMatch("1p", "normal");
  const R = Rules.R;
  const hero = R.players[side === "left" ? 0 : 1];
  hero.skill = Skills.initSkillState("flash");
  Skills.resetPoint(hero);
  // 人站回自己后场,与球拉开距离 —— 不这么摆等于"球本来就在判定区里",测不出折跃
  hero.x = side === "left" ? CO.netX - 210 : CO.netX + 210;
  hero.y = CO.groundY; hero.vx = 0; hero.vy = 0; hero.onGround = true;
  hero.stats.whiffs = 0;

  const ball = R.ball as Ball;
  ball.x = x; ball.y = CO.groundY - h;
  ball.px = ball.x; ball.py = ball.y;
  // vx 恒为「朝hero 那侧飞」:左半场来球往左(-),右半场来球往右(+)
  ball.vx = side === "left" ? -Math.abs(vx) : Math.abs(vx);
  ball.vy = vy;
  ball.live = true; ball.held = false; ball.owner = null;
  ball.flying = false; ball.flyT = 0;
  ball.lastHitter = side === "left" ? "right" : "left";
  ball.crossed = true; ball.netted = false; ball.shot = null;
  R.state = "RALLY";
  R.timer = 0; R.serveWait = 0;
  R.events.length = 0;
  return { hero, ball };
}

/** hero 那一侧按下技能要用哪个输入槽 */
function inputsWith(side: TeamSide, press: boolean): PlayerInput[] {
  const R = Rules.R;
  return R.players.map((p) => {
    const inp = emptyInput();
    if (p === R.players[side === "left" ? 0 : 1] && press) {
      inp.skillPressed = true;
      inp.skillDir = p.facing;
    }
    return inp;
  });
}

interface Cast {
  hitFrames: number;
  skillKind: string | null;
  kind: string | null;
  q: number;
  perfect: boolean;
  intoNet: boolean;
  landX: number;
  whiffed: boolean;
  strikeLeft: number;
  contactX: number;
  contactY: number;
  vx: number;
  vy: number;
  flashApex: boolean;
}

/** 按一次技能,看这一拍到底成没成(返回 null = 一记都没扣出去) */
function cast(side: TeamSide, h: number, x: number, vx: number, vy: number): Cast | null {
  const R = Rules.R;
  const { hero } = setup(side, h, x, vx, vy);
  for (let f = 0; f < 90; f++) {
    R.events.length = 0;
    Rules.step(inputsWith(side, f === 0));
    const hit = R.events.find((e) => e.t === "hit");
    if (hit) {
      return {
        hitFrames: f,
        skillKind: (hit.skillKind as string | null) ?? null,
        kind: hit.kind as string,
        q: hit.q as number,
        perfect: !!hit.perfect,
        intoNet: !!hit.intoNet,
        landX: hit.landX as number,
        whiffed: hero.stats.whiffs > 0,
        strikeLeft: hero.flashStrikeT ?? 0,
        contactX: hit.x as number,
        contactY: hit.y as number,
        vx: hit.vx as number,
        vy: hit.vy as number,
        flashApex: hit.flashApex === true,
      };
    }
    if (hero.stats.whiffs > 0) return null;   // 挥空了,不用再等
    if (R.state !== "RALLY") return null;     // 球落地/得分:技能没接到球
  }
  return null;
}

const label = (side: TeamSide, h: number, x: number, v: string): string =>
  `${side === "left" ? "左" : "右"} h=${h} x=${Math.round(x)} ${v}`;

// ---------- ⓪ 反例自检(--selftest):旧落位必须打不到球 ----------
// 这条是给本工具自己用的:如果"必中"的判据连旧版那个稳定漏球的站位都拦不住,
// 那后面所有绿色都是假的(与 strip-check --selftest 同一个动机)。
if (process.argv.includes("--selftest")) {
  // 旧版写死的两个数(已从 config 删除,这里只作为历史反例留在回归里)
  const LEGACY_BACK = 28;    // 瞬移至球后方距离
  const LEGACY_UP = 15;      // 瞬移至球上方高度 —— 就是这一条把人物摆到了球的上面
  const { hero, ball } = setup("left", 150, CO.netX - 200, 2, 5);
  const oldX = ball.x - hero.facing * LEGACY_BACK;
  const oldY = Math.min(Math.max(ball.y - LEGACY_UP, 60), CO.groundY - 50);
  const probe = { x: oldX, y: oldY, facing: hero.facing, swingRadius: hero.swingRadius, zoneScale: 1 };
  const edge = Pl.ballInZone(probe, ball);
  const z = Pl.strikeZone(probe, Math.hypot(ball.vx, ball.vy));
  const d = Math.hypot(ball.x - z.x, ball.y - z.y);
  assert(edge === null, `反例自检失效:旧落位仍被判定位接受(${d.toFixed(1)}px ≤ r ${z.r.toFixed(1)})`);
  console.log(`⓪ 反例:旧落位(球上方 ${LEGACY_UP}px)离圆心 ${d.toFixed(1)}px、半径只有 ${z.r.toFixed(1)}px → 判定区拒绝 ✓(这就是当年"闪过去却打不到"的几何)`);
  console.log(failures ? "\n✗ flash-check selftest 失败" : "\n✓ flash-check selftest:反例被拦住");
  process.exit(failures ? 1 : 0);
}

// ---------- ① 必中网格:高度 × 位置 × 来球速度 × 两侧 ----------
const HEIGHTS = [120, 150, 200, 260, 330];
// 贴网 / 中前场 / 后场 / 贴墙(左队坐标;右队镜像)
const XS = [CO.netX - 26, CO.netX - 140, CO.netX - 260, CO.wallL + 14];
const VEL: Array<[number, number, string]> = [
  [2, 6, "垂直下坠"], [6, 2, "平快压过来"], [3, -4, "还在上升"], [10, 9, "对方重杀回钻"],
];

let grid = 0, ok = 0;
const bad: string[] = [];
for (const side of ["left", "right"] as TeamSide[]) {
  for (const h of HEIGHTS) {
    for (const xb of XS) {
      const x = side === "left" ? xb : mirror(xb);
      for (const [vx, vy, vLabel] of VEL) {
        // 贴墙那一格只测下落:上升中的球会在画面外飘出边界,那是出界不是技能的锅
        if (xb === CO.wallL + 14 && vy < 0) continue;
        grid++;
        const tag = label(side, h, x, vLabel);
        const r = cast(side, h, x, vx, vy);
        if (!r) { bad.push(`${tag} → 一记都没扣出去`); continue; }
        if (r.skillKind !== "flash" || r.kind !== "smash") {
          bad.push(`${tag} → skillKind=${r.skillKind} kind=${r.kind}`); continue;
        }
        if (r.whiffed) { bad.push(`${tag} → 记了挥空`); continue; }
        if (r.intoNet) { bad.push(`${tag} → 这记扣杀会下网`); continue; }
        const inOpponent = side === "left"
          ? r.landX > CO.netX && r.landX <= CO.right
          : r.landX < CO.netX && r.landX >= CO.left;
        if (!inOpponent) { bad.push(`${tag} → 落点 ${Math.round(r.landX)} 不在对方场内`); continue; }
        if (r.strikeLeft > 0) { bad.push(`${tag} → 命中后保底窗口没消耗(还剩 ${r.strikeLeft} 帧)`); continue; }
        if (!r.perfect || r.q < C.skills.flash.guaranteedQ - 1e-6) {
          bad.push(`${tag} → 质量只有 ${r.q.toFixed(2)}`); continue;
        }
        if (r.hitFrames > 24) { bad.push(`${tag} → 按完 ${r.hitFrames} 帧才出球,太拖`); continue; }
        ok++;
      }
    }
  }
}
for (const b of bad.slice(0, 12)) console.log(`  ✗ ${b}`);
assert(bad.length === 0, `闪现必中网格:${bad.length}/${grid} 格不合格`);
console.log(`① 必中网格:${ok}/${grid} 格全部扣杀成功、落在对方场内、质量顶档`);

// ---------- ② 该拒绝的场合不许点亮 ----------
{
  let s = setup("left", 200, CO.netX - 200, 2, 5);
  s.ball.lastHitter = "left";                       // 自己刚打出去的球:同队一回合只能击球一次
  assert(!Skills.canActivate(s.hero, s.ball), "自家刚击出的球仍允许闪现(按下去必然挥空)");
  s = setup("left", C.skills.flash.minHeight - 20, CO.netX - 200, 2, 5);
  assert(!Skills.canActivate(s.hero, s.ball), "低于 minHeight 的球也允许闪现");
  s = setup("left", 200, CO.netX + 120, 2, 5);
  assert(!Skills.canActivate(s.hero, s.ball), "球在对方半场仍允许闪现(隔网折跃)");
  s = setup("left", 200, CO.netX - 200, 2, 5);
  s.hero.skill!.cd = 1;
  assert(!Skills.canActivate(s.hero, s.ball), "冷却中仍允许闪现");
  console.log("② 拒绝条件:自家球 / 低球 / 隔网球 / 冷却中 四条全部拦住");
}

// ---------- ③ 蓄力期球与人真的定住(时停的机制那一半) ----------
{
  const { hero, ball } = setup("left", 200, CO.netX - 200, 2, 6);
  Rules.step(inputsWith("left", true));
  const bx = ball.x, by = ball.y, py = hero.y;
  for (let f = 0; f < 3; f++) Rules.step(inputsWith("left", false));
  assert(ball.x === bx && ball.y === by, `蓄力期球在漂(${bx},${by}) → (${ball.x.toFixed(1)},${ball.y.toFixed(1)}):时间没停`);
  assert(hero.y === py, "蓄力期人在下坠 —— 悬空没生效");
  assert((hero.flashHoldT ?? 0) > 0, "蓄力帧没挂上");
  assert((hero.flashStrikeT ?? 0) === 0, "蓄力期就把保底窗口开了(应该等起拍那一帧)");
  console.log(`③ 时停:蓄力 ${C.skills.flash.holdFrames} 帧里球停在 (${Math.round(bx)},${Math.round(by)}) 一动不动`);
}

// ---------- ④ 落位 = 判定区圆心(几何本来就够得着,保底只是兜底) ----------
{
  const { hero, ball } = setup("left", 150, CO.netX - 200, 2, 5);
  Rules.step(inputsWith("left", true));
  const z = Pl.strikeZone(hero, Math.hypot(ball.vx, ball.vy));
  const d = Math.hypot(ball.x - z.x, ball.y - z.y);
  assert(d < 8, `落位偏离判定区圆心 ${d.toFixed(1)}px(旧版在这里偏 ~88px,所以稳定漏球)`);
  console.log(`④ 落位:球与判定区圆心相距 ${d.toFixed(1)}px`);
}

// ---------- ⑤ 保底窗口不许漏给下一拍(命中即消耗) ----------
{
  const { hero } = setup("left", 200, CO.netX - 200, 2, 5);
  for (let f = 0; f < 40; f++) { Rules.step(inputsWith("left", f === 0)); if (Rules.R.events.some((e) => e.t === "hit")) break; }
  Rules.R.events.length = 0;
  assert((hero.flashStrikeT ?? 0) === 0, `命中后窗口还剩 ${hero.flashStrikeT} 帧`);
  assert((hero.flashHoldT ?? 0) === 0, "命中后还在蓄力");
  assert(hero.swingT >= 0, "闪现后根本没起拍");
  console.log("⑤ 消耗:命中即关闭保底窗口,随挥照常走完");
}

// ---------- ⑥ 高度威力曲线 + 顶点天雷(2026-10-06) ----------
// 接触点越高劈扣越狠:buildShot 在解出弹道后按接触高度对出球矢量乘算(iaiStrike 同一
// 先例 —— speedBoost 池封顶 5、powerDeg 在球高 ≥200px 顶 -24° 地板,老杠杆全是死的)。
// 本段钉死五件事:
//   a) 乘算真实生效且曲线单调:同一 h 下与「乘数清零」的基线对比,vx 比值随接触高度
//      单调不降。尺子必须是**与基线的比值**,不能跨高度裸比 —— 基准解算的 vx 本身随
//      接触高度变(高点更省力),裸比量的是几何不是曲线
//   b) 低球维持现状:minHeight 那格乘后矢量与基线逐位相等(t=0 恒不乘算)
//   c) 顶点档台阶踩在**真实接触高度**上:起摆高度要先按 Δ 校准 —— 球解冻后到接触点
//      还要坠 ~1 步(实测恒定 ~5px),不校准的话 ±1 两格会双双落进门槛以下
//   d) flashApex 判定只认真实接触高度
//   e) 乘后真实弹道仍落对方场内、不下网 —— 用事件里的(乘后)矢量重飞一遍;老网格 ①
//      的 landX 读的是 solveShot trace(乘算前),量不到乘算,这里补上
{
  const FL = C.skills.flash;
  // 探针:量「起摆高度 → 真实接触高度」的恒定落差
  const probe = cast("left", 260, CO.netX - 200, 2, 5);
  assert(!!probe, "⑥ 探针格没扣出去");
  const delta = probe ? 260 - (CO.groundY - probe.contactY) : 0;
  const HS = [FL.minHeight, 150, 200, FL.apexHeight - 1 + delta, FL.apexHeight + 1 + delta, 300 + delta];
  const run = (withMuls: boolean): Array<{ h: number; r: Cast }> => {
    const keep = [FL.curveVxMul, FL.curveVyMul, FL.apexVxMul, FL.apexVyMul];
    if (!withMuls) { FL.curveVxMul = 1; FL.curveVyMul = 1; FL.apexVxMul = 1; FL.apexVyMul = 1; }
    const out: Array<{ h: number; r: Cast }> = [];
    for (const h of HS) {
      const r = cast("left", h, CO.netX - 200, 2, 5);
      assert(!!r, `⑥ h=${h.toFixed(1)}(${withMuls ? "乘算" : "基线"}) → 一记都没扣出去`);
      if (r) out.push({ h, r });
    }
    FL.curveVxMul = keep[0]; FL.curveVyMul = keep[1]; FL.apexVxMul = keep[2]; FL.apexVyMul = keep[3];
    return out;
  };
  const base = run(false);
  const rows = run(true);
  // d) 档位判定只认真实接触高度;e) 乘后真实弹道不出界不下网
  for (const { h, r } of rows) {
    const contactH = CO.groundY - r.contactY;
    assert(r.flashApex === (contactH >= FL.apexHeight),
      `⑥ h=${h.toFixed(1)}(接触 ${contactH.toFixed(0)}px) 顶点档判定与接触高度不符`);
    const tr = Physics.trace(r.contactX, r.contactY, r.vx, r.vy);
    assert(tr.landX > CO.netX && tr.landX <= CO.right && !tr.hitNet,
      `⑥ h=${h.toFixed(1)} 乘后真实弹道落点 ${Math.round(tr.landX)}${tr.hitNet ? "(下网)" : "(出界/不及网)"}`);
  }
  // a) 乘算比值单调;b) 低球逐位相等
  let prevRatio = -1;
  for (let i = 0; i < rows.length; i++) {
    const ratio = rows[i].r.vx / base[i].r.vx;
    assert(ratio >= prevRatio - 1e-6,
      `⑥ 乘算比值不单调:${rows[i].h.toFixed(0)}px 比值 ${ratio.toFixed(4)} < 前格 ${prevRatio.toFixed(4)}`);
    prevRatio = ratio;
  }
  assert(Math.abs(rows[0].r.vx - base[0].r.vx) < 1e-9 && Math.abs(rows[0].r.vy - base[0].r.vy) < 1e-9,
    "⑥ 低球(minHeight)矢量被乘算改动 —— 「低球维持现状」被破坏");
  // c) 台阶:校准后的两格必须一无有一有,且 vx 真跳档
  const below = rows.find((x) => Math.abs(x.h - (FL.apexHeight - 1 + delta)) < 1e-6);
  const above = rows.find((x) => Math.abs(x.h - (FL.apexHeight + 1 + delta)) < 1e-6);
  if (below && above) {
    assert(!below.r.flashApex && above.r.flashApex, "⑥ 顶点档台阶没踩准(校准后 −1 应无档、+1 应有档)");
    assert(above.r.vx > below.r.vx,
      `⑥ 顶点档没跳档:vx ${below.r.vx.toFixed(2)} → ${above.r.vx.toFixed(2)}`);
  }
  const ratios = rows.map((x, i) => (x.r.vx / base[i].r.vx).toFixed(3)).join(" → ");
  const apexRow = rows[rows.length - 1];
  console.log(`⑥ 高度威力:乘算比值 ${ratios}(单调)` +
    `${below && above ? `,顶点跳档 vx ${below.r.vx.toFixed(1)}→${above.r.vx.toFixed(1)}` : ""}` +
    `;顶点合速 ${Math.hypot(apexRow.r.vx, apexRow.r.vy).toFixed(1)} vs 低球 ${Math.hypot(rows[0].r.vx, rows[0].r.vy).toFixed(1)},乘后弹道全部落对方场内`);
}

console.log(failures ? `\n✗ flash-check 失败 ${failures} 项` : "\n✓ flash-check 全绿");
process.exit(failures ? 1 : 0);
