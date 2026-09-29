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
//   ② lungeDir=0(还没碰过方向键)时 player.ts 兜底成面向方向,不许原地不跨。
// 挥拍缓冲也在这里一并验:挥拍中按下的击球键要在收招窗口内自动续拍,
// 不能被静默吞掉(真机上就是「明明按了却没反应」的手感事故)。
//
// 用法(先 npx tsc -p tools/tsconfig.json 编译):
//   node .tools-build/tools/input-check.js
import { newPad, press, release, clearEdges, buildIntent, resetPadHolds } from "../assets/scripts/input/pad";
import { Player } from "../assets/scripts/core/player";
import { CFG } from "../assets/scripts/core/config";
import type { PlayerInput } from "../assets/scripts/core/types";

let bad = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) bad++;
};

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

{
  const p = Player.create("left");
  Player.update(p, lungeInp(0), null);
  ok(p.lungeT === 0 && p.lungeDir === p.facing, `lungeDir=0 → 兜底面向方向(实得 ${p.lungeDir},facing=${p.facing})`);

  const q = Player.create("left");
  const before = q.x;
  for (let i = 0; i < 6; i++) Player.update(q, i === 0 ? lungeInp(-1) : { ...lungeInp(-1), lungePressed: false }, null);
  ok(q.x < before, `往左跨真的往左移动了(Δx=${(q.x - before).toFixed(1)})`);

  // 挥拍期间不许跨步:跨步是有恢复期的承诺,不能和白送的一拍叠在一起
  const r = Player.create("left");
  r.swingT = 2;
  Player.update(r, lungeInp(1), null);
  ok(r.lungeT === -1, "挥拍中按下跨步不触发");
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

console.log(bad === 0 ? "\n输入意图层自洽 ✓" : `\n${bad} 项未通过`);
process.exit(bad === 0 ? 0 : 1);
