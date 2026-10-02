// 输入意图层自检(input/pad.ts)。
//
// 为什么单独测它:跨步的触发条件从「双击方向键」换成了「独立跨步键 + 方向取最近
// 的方向键」,这件事在真机上只有两种坏法,而且都不显眼 ——
//   ① 双击判定残留:对拉时快速左右换向又凑出一次跨步(用户就是要摆脱它才改的);
//   ② 方向解析跑偏:按着右边跨步却往左摔,或者忘清 lastDir 导致跨步方向粘住。
// 这两条靠手玩很容易当成手感问题,代码里常驻断言才守得住。
//
// 另外两条只有代码能验:
//   ① 边沿语义:跨步/击球键每步只响一次,clearEdges 后必须归零;
//   ② lungeDir=0(还没碰过方向键)时 player.ts 兜底:静止朝网,有惯性顺势跨,不许原地不跨。
// 挥拍缓冲也在这里一并验:挥拍中按下的击球键要在收招窗口内自动续拍,
// 不能被静默吞掉(真机上就是「明明按了却没反应」的手感事故)。
//
// 用法(先 npx tsc -p tools/tsconfig.json 编译):
//   node .tools-build/tools/input-check.js
import { makeChecker } from "./harness";
import { newPad, press, release, cancelJump, clearEdges, buildIntent, resetPadHolds, tickHolds, setTargetX } from "../assets/scripts/input/pad";
import { Player } from "../assets/scripts/core/player";
import { CFG } from "../assets/scripts/core/config";
import type { PlayerInput } from "../assets/scripts/core/types";

const h = makeChecker({});
const ok = (cond: boolean, msg: string): void => h.ok(cond, msg);

/** 只关心跨步的输入,其余字段给中性默认 */
const lungeInp = (dir: number): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false,
  swingAim: null, lungePressed: true, lungeDir: dir,
});

/** 只关心击球的输入,其余字段给中性默认 */
const swingInp = (aim: string | null): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false,
  swingAim: aim, lungePressed: false, lungeDir: 0,
});

console.log("输入意图层:跨步键 / 方向解析 / 边沿清理\n");

// ---------- ① 双击方向键不再触发跨步 ----------

{
  const pad = newPad();
  // 同一只手在窗口期内连点两次「左」—— 旧实现在这里会凑成双击并摔一跤
  press(pad, "left");
  const first = pad.lungePressed;
  release(pad, "left");
  press(pad, "left");
  ok(!first && !pad.lungePressed, "连点两次方向键不触发跨步(双击判定已删)");
  release(pad, "left");
  press(pad, "right"); release(pad, "right");
  press(pad, "right");
  ok(!pad.lungePressed, "左右来回快速换向也不触发跨步");
}

// ---------- ② 跨步方向 = 当前按着的方向键 ----------

{
  const pad = newPad();
  press(pad, "right");
  press(pad, "lunge");
  ok(pad.lungePressed && pad.lungeDir === 1, `按着「右」跨步 → 往右(实得 ${pad.lungeDir})`);
  const inp = buildIntent(pad, {});
  ok(inp.lungeDir === 1, "buildIntent 把解出的方向带进 PlayerInput");
}

// ---------- ③ 都松开了 → 沿用最近按过的方向键 ----------

{
  const pad = newPad();
  press(pad, "left");
  release(pad, "left");
  press(pad, "lunge");
  ok(pad.lungeDir === -1, `松手后跨步仍朝最后一次的方向键(实得 ${pad.lungeDir})`);

  // 左右都按着 = 互相抵消,该用「最后碰的那一个」而不是硬编某个方向
  press(pad, "right"); press(pad, "left");
  press(pad, "lunge");
  ok(pad.lungeDir === -1, `两边都按着时用最后碰的方向(实得 ${pad.lungeDir})`);
  release(pad, "left"); release(pad, "right");
}

// ---------- ④ 边沿语义与清理 ----------

{
  const pad = newPad();
  press(pad, "left");
  press(pad, "lunge");
  clearEdges(pad);
  ok(!pad.lungePressed && (pad.lungeDir ?? 0) === 0, "clearEdges 后跨步边沿归零(每步只响一次)");
  ok(pad.left === true, "clearEdges 不动「按住」状态(否则松手前就停止移动)");
  press(pad, "lunge");
  ok(pad.lungeDir === -1, "lastDir 跨步后仍留着,下一次按跨步还能用同一方向");

  // 虚拟按键层隐藏:按下状态必须清干净,方向意图不清
  press(pad, "right");
  resetPadHolds(pad);
  ok(!pad.right && !pad.lungePressed, "resetPadHolds 清掉按下状态");
  ok(pad.lastDir === 1, "resetPadHolds 保留最近方向(恢复对局第一次跨步不该退回朝网)");
}

// ---------- ⑤ 逻辑层兜底:方向没解出来时朝网跨 ----------
// 0.0.16 起 lunge 走技能通道(player.update 里 `skillHit && ball && canActivate`),
// 夹具必须喂一颗球才进得了触发分支 —— 从前这里全传 null,六条断言常红两批版本。

{
  // lunge 的 canActivate/activate 只看人(在地面/未挥拍/未跨步),球只要非 null 即可
  const mkBall = () => ({
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    live: false, held: true, owner: null, lastHitter: null,
    crossed: false, netted: false, shot: null, sq: 1, sqPrev: 1,
    flying: false, flyT: 0, flyFromX: 0, flyFromY: 0,
  });

  const p = Player.create("left");
  Player.update(p, lungeInp(0), mkBall());
  ok(p.lungeT >= 0 && p.lungeDir === p.facing, `lungeDir=0(静止)→ 兜底面向方向(实得 ${p.lungeDir},facing=${p.facing})`);
  // 按下当帧就要爆发:旧结构先推进再判触发,移动中按下会先吃 1 帧旧移动,手感像顿了一下
  ok(p.lungeT === 1 && Math.abs(p.vx) === CFG.lunge.speed,
    `按下当帧即爆发(lungeT=${p.lungeT}, vx=${p.vx})`);

  const q = Player.create("left");
  const before = q.x;
  for (let i = 0; i < 6; i++) Player.update(q, i === 0 ? lungeInp(-1) : { ...lungeInp(-1), lungePressed: false }, mkBall());
  ok(q.x < before, `往左跨真的往左移动了(Δx=${(q.x - before).toFixed(1)})`);

  // 挥拍期间不许跨步:跨步是全身承诺,不能和白送的一拍叠在一起
  const r = Player.create("left");
  r.swingT = 2;
  Player.update(r, lungeInp(1), mkBall());
  ok(r.lungeT === -1, "挥拍中按下跨步不触发");

  // 爆发结束只进冷却,不吃慢速惩罚:冷却期里按方向键要能立刻全速跑走
  // (旧恢复期把速度硬钳到 35%,移动中跨步比干跑还慢,像急刹)
  const c = Player.create("left");
  for (let i = 0; i < 7; i++) Player.update(c, i === 0 ? lungeInp(1) : { ...lungeInp(1), lungePressed: false }, mkBall());
  ok(c.lungeT === -1 && c.lungeCd > 0, `爆发结束进入冷却(lungeT=${c.lungeT}, cd=${c.lungeCd})`);
  Player.update(c, { ...lungeInp(0), lungePressed: false, right: true }, null);
  ok(c.vx === CFG.player.vmax, `冷却期移动不受限,一帧回到全速(vx=${c.vx})`);

  // 跑动中跨步 = 跑速 + 爆发(冲量叠加,不是替换):旧逻辑 vx=dir×speed 把跑速抹掉,
  // 跑动时只比干跑快一点点,「跨了像没跨」;叠加后 vx 应明显超过纯爆发速。
  const m = Player.create("left");
  const runInp = (right: boolean, lunge = false): PlayerInput => ({
    left: false, right, jumpPressed: false, jumpHeld: false,
    swingAim: null, lungePressed: lunge, lungeDir: right ? 1 : -1,
  });
  for (let i = 0; i < 12; i++) Player.update(m, runInp(true), null);  // 跑到全速
  ok(Math.abs(m.vx - CFG.player.vmax) < 0.01, `先跑到全速(vx=${m.vx.toFixed(2)})`);
  Player.update(m, runInp(true, true), mkBall());  // 全速中按跨步
  ok(m.vx > CFG.lunge.speed + 1,
    `跑动中跨步叠加冲量:vx 应超过纯爆发速 ${CFG.lunge.speed}(实得 ${m.vx.toFixed(2)})`);
}

// ---------- ⑥ 挥拍缓冲:挥拍中按下的击球键,收招窗口内自动续拍 ----------

{
  // 挥空一整拍的总帧数(球为 null 必挥空):起拍占 1 次 update,收招在第 TOTAL+1 次
  const TOTAL = CFG.swing.windup + CFG.swing.active + CFG.swing.recover + CFG.swing.whiffExtra;
  const runSwing = (extraPressAt: number): { swingT: number; aim: string | number; whiffs: number } => {
    const p = Player.create("left");
    for (let i = 1; i <= TOTAL + 1; i++) {
      // 第 1 帧起拍;extraPressAt 帧在挥拍中再按一次近球键(0 = 不按)
      Player.update(p, swingInp(i === 1 || i === extraPressAt ? "near" : null), null);
    }
    return { swingT: p.swingT, aim: p.swingAim, whiffs: p.stats.whiffs };
  };

  // 收招前 buffer-1 帧按下 → 收招瞬间自动续拍,且打出去的还是近球
  // (偏移从 CFG.swing.buffer 推导,调缓冲时长不用改测试)
  const queued = runSwing(TOTAL + 1 - (CFG.swing.buffer - 1));
  ok(queued.swingT === 0 && queued.aim === "near",
    `挥拍尾声按键收招即续拍(swingT=${queued.swingT}, aim=${queued.aim})`);

  // 窗口外(再早一帧)按下 → 缓冲过期,不凭空多挥一拍
  const expired = runSwing(TOTAL + 1 - CFG.swing.buffer);
  ok(expired.swingT === -1 && expired.whiffs === 1,
    `窗口外的按键自然过期(swingT=${expired.swingT}, whiffs=${expired.whiffs})`);

  // 非挥拍态按下 → 当帧立即起拍(原行为不回退)
  const fresh = Player.create("left");
  Player.update(fresh, swingInp("deep"), null);
  ok(fresh.swingT === 0 && fresh.swingAim === "deep", "非挥拍态按下仍当帧起拍");
}

// ---------- ⑦ 点跳补偿:摇杆上推快放 / 跳跃键快点 不该被 jumpCut 掐成抽搐跳 ----------
//
// 为什么在这儿验:摇杆代跳把"跳跃"变成了模拟量,快甩(flick)的输入时长天然就短,
// 和手指按按钮快点是同一类。而 player.ts 的上升段每帧 `vy *= jumpCut(0.5)`,
// 只按一帧的上升量实测不到满跳的一成 —— 真机上就是"明明推了却没跳起来"。
// 判据用**世界步计数**而不是挂钟:jumpApex/jumpCut 全是帧单位,掉帧时挂钟会和手感对不上。
{
  const GY = CFG.court.groundY;
  // 满跳理论升程:v²/(2g),与 player.ts 的离地初速/重力同一套数值
  const fullRise = (CFG.player.jumpV * CFG.player.jumpV) / (2 * CFG.player.gravity);

  /** 照 game-root 的每步节奏跑:buildIntent → Player.update → tickHolds → clearEdges */
  const run = (holdFrames: number): { rise: number; tail: number; heldAfterRelease: boolean } => {
    const pad = newPad();
    const p = Player.create("left");
    let minY = GY;
    let heldAfterRelease = false;
    const total = CFG.player.jumpApex * 2 + 10;
    for (let i = 1; i <= total; i++) {
      if (i === 1) press(pad, "jump");
      if (i === 1 + holdFrames) release(pad, "jump");
      const inp = buildIntent(pad, {});
      Player.update(p, inp, null);
      if (p.y < minY) minY = p.y;
      // 松手之后的下一步仍然报 held —— 这就是补的尾巴在起作用
      if (i === 2 + holdFrames) heldAfterRelease = inp.jumpHeld;
      tickHolds(pad);
      clearEdges(pad);
    }
    return { rise: GY - minY, tail: pad.jumpTail, heldAfterRelease };
  };

  const tap = run(1);
  ok(tap.rise > fullRise * 0.9,
    `只按 1 帧也能跳到接近满跳(升 ${tap.rise.toFixed(1)}px / 满跳 ${fullRise.toFixed(1)}px)`);
  ok(tap.heldAfterRelease, "松手之后 jumpHeld 仍为真(尾巴没跟着 release 被清掉)");
  ok(tap.tail === 0, `跑够久之后尾巴归零,不会一直挂着(${tap.tail})`);

  // 「推上去就是满跳」是刻意的取舍:放弃可变跳高,换输入端永不劈叉。
  // 这条把它锁住 —— 谁想调小 tapCommitFrames 找回短跳,会先在这里撞上,
  // 因为 jumpCut 是**每帧**砍半,短按平台与截断段之间必然劈出台阶。
  const late = run(CFG.player.tapCommitFrames + 3);
  ok(late.rise > fullRise * 0.9, `推住到顶点之后才松 = 满跳(升 ${late.rise.toFixed(1)}px)`);

  // 单调锁:按住更久不该跳得更矮。曾经 tapCommitFrames=5 时
  //   按 4 帧 → 87.5px,按 5 帧 → 45.3px —— 多按 16ms 少跳一半。
  let prevRise = -1;
  let worstDrop = 0;
  let worstAt = 0;
  for (let h = 1; h <= CFG.player.jumpApex + 9; h++) {
    const r = run(h).rise;
    if (prevRise >= 0 && prevRise - r > worstDrop) { worstDrop = prevRise - r; worstAt = h; }
    prevRise = r;
  }
  ok(worstDrop < 6, `升程随按住时长不劈叉(相邻最大回落 ${worstDrop.toFixed(1)}px @ 第 ${worstAt} 帧)`);

  // 到顶点之后再松:尾巴应为 0(上升段已过,jumpCut 本来也不再生效)
  const edge = newPad();
  press(edge, "jump");
  for (let i = 0; i < CFG.player.jumpApex; i++) tickHolds(edge);
  release(edge, "jump");
  ok(edge.jumpTail === 0, `按满 ${CFG.player.jumpApex} 帧到顶点再松 → 不再补尾巴`);

  // press 必须清掉上一拍的尾巴与计数,不然连点会串味
  const pad2 = newPad();
  press(pad2, "jump"); release(pad2, "jump");
  ok(pad2.jumpTail > 0, "第一次点跳确实留下了尾巴");
  press(pad2, "jump");
  ok(pad2.jumpTail === 0 && pad2.jumpSteps === 0, "再按一次会把上一拍的尾巴与计数清零");

  // 离场清理:resetPadHolds 内部走 release(),不显式清零就会凭空补出一段上升
  const pad3 = newPad();
  press(pad3, "jump"); release(pad3, "jump");
  resetPadHolds(pad3);
  ok(pad3.jumpTail === 0 && pad3.jump === false, "resetPadHolds 清掉尾巴(离场不算点跳)");

  // 真实踩过的坑:TouchPadController.setPlaying(false) 是先 releaseAll()(→ resetPadHolds,
  // 把 jumpSteps 归零)再 clearPressed()(原来这里走 release,0 < tapCommitFrames 于是
  // 又补出 19 帧 held,回对局后第一次跳收不住)。clearPressed 现在走 cancelJump。
  const pad4 = newPad();
  press(pad4, "jump");
  tickHolds(pad4);
  resetPadHolds(pad4);
  cancelJump(pad4);
  ok(pad4.jumpTail === 0 && pad4.jump === false,
    "隐藏按键层的次序(resetPadHolds → clearPressed)不会凭空补出尾巴");
}

// ---------- ⑧ 滑轨定位 (targetX) 平滑定点刹停自洽 ----------

{
  const p = Player.create("left");
  p.x = 200;
  p.vx = 0;
  const targetX = 350;

  // 模拟帧推进:输入包含 targetX
  let arrived = false;
  for (let frame = 0; frame < 60; frame++) {
    const inp: PlayerInput = {
      left: false, right: false, jumpPressed: false, jumpHeld: false,
      swingAim: null, lungePressed: false, lungeDir: 0,
      targetX,
    };
    Player.update(p, inp, null);
    if (Math.abs(p.x - targetX) < 1e-4 && p.vx === 0) {
      arrived = true;
      break;
    }
  }
  ok(arrived, `targetX 能够精准刹停并立定到目标点(实得 x=${p.x}, target=${targetX})`);
  ok(p.vx === 0, "定点到达后速度完全归零，无持续飘移");

  // 反向定点
  const reverseTarget = 150;
  let reverseArrived = false;
  for (let frame = 0; frame < 60; frame++) {
    const inp: PlayerInput = {
      left: false, right: false, jumpPressed: false, jumpHeld: false,
      swingAim: null, lungePressed: false, lungeDir: 0,
      targetX: reverseTarget,
    };
    Player.update(p, inp, null);
    if (Math.abs(p.x - reverseTarget) < 1e-4 && p.vx === 0) {
      reverseArrived = true;
      break;
    }
  }
  ok(reverseArrived, `反向 targetX 能够精准刹停立定(实得 x=${p.x}, target=${reverseTarget})`);

  // Pad 流转: setTargetX / resetPadHolds
  const pad = newPad();
  setTargetX(pad, 300, 200);
  ok(pad.targetX === 300 && pad.lastDir === 1, "setTargetX 更新 targetX 与 lastDir");
  const intent = buildIntent(pad, {});
  ok(intent.targetX === 300, "buildIntent 正确打包 targetX");
  resetPadHolds(pad);
  ok(pad.targetX === undefined, "resetPadHolds 成功清除 targetX");
}

console.log(h.bad === 0 ? "\n输入意图层自洽 ✓" : `\n${h.bad} 项未通过`);
process.exit(h.bad === 0 ? 0 : 1);
