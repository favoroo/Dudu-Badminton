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
import { newPad, press, release, cancelJump, clearEdges, buildIntent, restoreSwingAim, lockSwingAxis, clearSwingLocks, resetPadHolds, tickHolds, setTargetX } from "../assets/scripts/input/pad";
import { Player } from "../assets/scripts/core/player";
import { CFG } from "../assets/scripts/core/config";
import { Gait } from "../assets/scripts/core/gait";
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
  // 「全速」= player.vmax × 移速档(真人侧那一层,core/gait.ts)。写死 vmax 的话,
  // 出货默认不是标准档时这条会假红(实测默认 slow 档 → 7.82 ≠ 9.2)。
  const fullSpeed = CFG.player.vmax * Gait.s;
  const c = Player.create("left");
  for (let i = 0; i < 7; i++) Player.update(c, i === 0 ? lungeInp(1) : { ...lungeInp(1), lungePressed: false }, mkBall());
  ok(c.lungeT === -1 && c.lungeCd > 0, `爆发结束进入冷却(lungeT=${c.lungeT}, cd=${c.lungeCd})`);
  Player.update(c, { ...lungeInp(0), lungePressed: false, right: true }, null);
  ok(c.vx === fullSpeed, `冷却期移动不受限,一帧回到全速(vx=${c.vx}, 全速=${fullSpeed.toFixed(2)})`);

  // 跑动中跨步 = 跑速 + 爆发(冲量叠加,不是替换):旧逻辑 vx=dir×speed 把跑速抹掉,
  // 跑动时只比干跑快一点点,「跨了像没跨」;叠加后 vx 应明显超过纯爆发速。
  const m = Player.create("left");
  const runInp = (right: boolean, lunge = false): PlayerInput => ({
    left: false, right, jumpPressed: false, jumpHeld: false,
    swingAim: null, lungePressed: lunge, lungeDir: right ? 1 : -1,
  });
  for (let i = 0; i < 12; i++) Player.update(m, runInp(true), null);  // 跑到全速
  ok(Math.abs(m.vx - fullSpeed) < 0.01, `先跑到全速(vx=${m.vx.toFixed(2)}, 全速=${fullSpeed.toFixed(2)})`);
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

// ---------- ⑨ 滑轨模式与跨步技能兼容性回归 ----------

{
  const mkBall = () => ({
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    live: false, held: true, owner: null, lastHitter: null,
    crossed: false, netted: false, shot: null, sq: 1, sqPrev: 1,
    flying: false, flyT: 0, flyFromX: 0, flyFromY: 0,
  });

  // 1. setTargetX 支持手势方向传参: 向左滑动(-1)
  const pad1 = newPad();
  setTargetX(pad1, 150, -1);
  ok(pad1.lastDir === -1, "setTargetX(-1) 成功记录向左滑动手势");
  press(pad1, "lunge");
  ok(pad1.lungeDir === -1, `滑轨向左滑动后按跨步 → lungeDir 为 -1 (实得 ${pad1.lungeDir})`);

  // 2. 松手后(setTargetX 不传方向或松开)按跨步仍沿用向左
  const pad2 = newPad();
  setTargetX(pad2, 160, -1);
  press(pad2, "lunge");
  clearEdges(pad2);
  // 跨步后清掉了前序 targetX,避免往回拉
  ok(pad2.targetX === undefined, "clearEdges 消费了跨步的前序 targetX");
  // 再次按跨步仍能读到 lastDir
  press(pad2, "lunge");
  ok(pad2.lungeDir === -1, "松开滑轨后再次跨步仍能朝向左(-1)");

  // 3. 几何方位优先: 角色在 250, targetX 在 120 (身后), 即使 lungeDir=0 也向后跨
  const pBehind = Player.create("left");
  pBehind.x = 250;
  pBehind.vx = 0;
  const inpBehind: PlayerInput = {
    left: false, right: false, jumpPressed: false, jumpHeld: false,
    swingAim: null, lungePressed: true, lungeDir: 0,
    targetX: 120,
  };
  Player.update(pBehind, inpBehind, mkBall());
  ok(pBehind.lungeDir === -1, `targetX 在身后(120 < 250) → 实体几何解析向后跨步(实得 ${pBehind.lungeDir})`);
  ok(pBehind.vx === -CFG.lunge.speed, `向后跨步获得向左冲量(实得 vx=${pBehind.vx})`);

  // 4. 几何方位优先: 角色在 250, targetX 在 380 (身前) → 向前跨
  const pAhead = Player.create("left");
  pAhead.x = 250;
  pAhead.vx = 0;
  const inpAhead: PlayerInput = {
    left: false, right: false, jumpPressed: false, jumpHeld: false,
    swingAim: null, lungePressed: true, lungeDir: 0,
    targetX: 380,
  };
  Player.update(pAhead, inpAhead, mkBall());
  ok(pAhead.lungeDir === 1, `targetX 在身前(380 > 250) → 实体几何解析向前跨步(实得 ${pAhead.lungeDir})`);
  ok(pAhead.vx === CFG.lunge.speed, `向前跨步获得向右冲量(实得 vx=${pAhead.vx})`);

  // 5. 跨步物理冲量保护: 跨步期间哪怕刚好在 targetX 附近, 速度也不被 arriveEps 截停
  const pImmune = Player.create("left");
  pImmune.x = 200;
  pImmune.vx = 0;
  const inpHit: PlayerInput = {
    left: false, right: false, jumpPressed: false, jumpHeld: false,
    swingAim: null, lungePressed: true, lungeDir: -1,
    targetX: 200, // 距离当前 x 恰好为 0
  };
  Player.update(pImmune, inpHit, mkBall());
  ok(pImmune.lungeT === 1, "跨步成功起步");
  ok(pImmune.vx === -CFG.lunge.speed, `距离 targetX 零距离但跨步速度不被刹停(实得 vx=${pImmune.vx})`);
}

// ---------- ⑩ restoreSwingAim:自动击打的「一滑一拍」恢复的只是瞄准,不是按下状态 ----------

{
  const pad = newPad();
  press(pad, "swing");            // 真按下:两轴恢复锁值(没锁 = 0)+ swingPressed/swingHeld 立起来
  pad.swingSwipe = 1;             // 同帧手指横滑提交(trackSwingSwipe 干的事)
  pad.swingSwipeY = -1;
  press(pad, "right");            // 顺手按着右移 + 记一个方向意图
  pad.lastDir = -1;

  const before = { held: pad.swingHeld, pressed: pad.swingPressed, right: pad.right, lastDir: pad.lastDir };
  restoreSwingAim(pad);
  ok(pad.swingSwipe === 0 && pad.swingSwipeY === 0, "restoreSwingAim 没锁时把深浅 + 高低两轴一起归 0");
  const out = buildIntent(pad, {});
  ok(out.swingSwipe === 0 && out.swingSwipeY === 0,
    `清完之后 buildIntent 输出 0/0(实得 ${out.swingSwipe}/${out.swingSwipeY})⇒ 下一拍回到物理自动决定的那一档`);
  ok(pad.swingHeld === before.held && pad.right === before.right && pad.lastDir === before.lastDir,
    "只清瞄准:按住态 / 方向键 / lastDir 一个都不动(它是存储,不是按下状态;清错了就是把玩家定在原地)");
  restoreSwingAim(pad);
  ok(pad.swingSwipe === 0 && pad.swingHeld === before.held, "再清一次幂等(收招帧与 resetPadHolds 撞同一帧也不会互相顶)");

  // 与 press 的分工:键盘键自己就是完整意图,一次性化不插手键盘那一侧
  pad.swingSwipe = -1;
  press(pad, "swingNear");
  ok(pad.swingSwipe === -1, "press(swingNear) 自己就是提交(键盘路径即按即定),restoreSwingAim 不参与");
  press(pad, "swing");
  ok(pad.swingSwipe === 0 && pad.swingSwipeY === 0, "按下击球键没锁时仍把两轴恢复成 0(老规矩)");
}

// ---------- ⑩b 长滑锁定:lockSwingAxis 纯赋值 + clearSwingLocks 解除 + press/restore 恢复 ----------

{
  const pad = newPad();
  // 锁上:纯赋值 —— 同向再锁 = 维持,反向 = 换向,**没有 toggle**(取消走短滑解除)
  lockSwingAxis(pad, "x", 1);
  ok(pad.swingLockX === 1 && pad.swingLockY === 0, "长滑锁上横轴,纵轴不连坐(两轴独立)");
  lockSwingAxis(pad, "x", 1);
  ok(pad.swingLockX === 1, "同向再长滑 = 维持锁定(取消不在这条路上)");
  lockSwingAxis(pad, "x", -1);
  ok(pad.swingLockX === -1, "反向长滑 = 换向");
  lockSwingAxis(pad, "y", -1);
  ok(pad.swingLockY === -1, "纵轴独立上锁(与横轴互不干扰)");

  // 解除:锁与欠着的键值一起清 —— 锁着时的一次短滑 = 「我不锁了」,这一拍只听新滑动
  pad.swingSwipe = -1;
  pad.swingSwipeY = 1;                       // 模拟 press 恢复进来的锁值残留在键值上
  clearSwingLocks(pad);
  ok(pad.swingLockX === 0 && pad.swingLockY === 0,
    "clearSwingLocks 把两把锁一起收掉(解除 = 整体,不分轴)");
  ok(pad.swingSwipe === 0 && pad.swingSwipeY === 0,
    "键值跟着归零 —— press 恢复进来的锁值不许冒充这一拍的意图,方向由这次滑动重写");

  // pad 层契约:锁定时 press 恢复锁值、短滑覆盖本拍、收招回锁(手势层的「短滑=解除」
  // 在 UI 层先一步清锁,到不了这里的都是「没触发解除」的滑动)
  lockSwingAxis(pad, "x", -1);
  press(pad, "swing");
  ok(pad.swingSwipe === -1 && pad.swingLockX === -1, "有锁时按下 = 恢复锁值(横轴)");
  pad.swingSwipeY = 1;                       // 本拍短滑临时改挑高
  ok(pad.swingSwipeY === 1, "锁定期间短滑照常覆盖本拍键值");
  restoreSwingAim(pad);
  ok(pad.swingSwipeY === 0 && pad.swingSwipe === -1,
    "restoreSwingAim 有锁时回锁向:没锁的纵轴回 0、锁着的横轴停在锁值");

  // 换局边界:resetPadHolds 清锁 —— 新对局从 mid 打起,别把上一局锁的后场带过来
  resetPadHolds(pad);
  ok(pad.swingLockX === 0 && pad.swingLockY === 0 && pad.swingSwipe === 0 && pad.swingSwipeY === 0,
    "resetPadHolds 清锁 + 清键值(换局 = 全部回到物理自动决定)");
  press(pad, "swing");
  ok(pad.swingSwipe === 0 && pad.swingSwipeY === 0, "清锁后按下 = 老规矩的 0/0");
}

console.log(h.bad === 0 ? "\n输入意图层自洽 ✓" : `\n${h.bad} 项未通过`);
process.exit(h.bad === 0 ? 0 : 1);
