// ============================================================
// 输入意图合成:多个输入源(键盘 / 触屏虚拟按键 / 触屏虚拟摇杆)写同一张 Pad,
// 每个模拟步把它翻成 PlayerInput 后清边沿 —— 与老仓库 DD.Input 的
// isDown / justPressed / clearEdges 三件套同一套语义,只是平面化成对象。
//
// 跨步的方向不住在「跨步键」身上,而是从方向意图里现解:摇杆推多少就往哪走;
// 摇杆归零时沿用左右键;两者都没动才回落到「最近一次方向」。原先挂在方向键上的
// 双击判定已删除 —— 触屏上快速左右换向(对拉、追身球)会稳定凑成双击,
// 误触的代价还是一次带恢复期的爆发位移,比漏触更难受。
// ============================================================
import type { PlayerInput } from "../core/types";

/** 摇杆写入的最小步长:低于这个的抖动视作归零,避免手指微颤带来 vx 抖动 */
export const JOYSTICK_DEADZONE = 0.15;

export interface Pad {
  left: boolean;
  right: boolean;
  /**
   * 摇杆模拟量:-1..1。非零即生效(带死区),优先级高于 left/right;
   * 摇杆模式下 left/right 保持 false,让键盘与老按钮路径完全不受影响。
   */
  moveAxis: number;
  /** 按住 = 可变跳高的 held 语义 */
  jump: boolean;
  /** 边沿:本步内刚按下(每步用后即清) */
  jumpPressed: boolean;
  /** 跨步/击球键都是纯边沿语义:一次触发就是一个动作,没有「按住」状态 */
  lungePressed: boolean;
  /** 跨步方向:-1=向左, 1=向右(按下跨步键那一刻从方向意图解出) */
  lungeDir?: number;
  /** 最近一次方向键意图:-1=左, 1=右, 0=这局还没碰过方向键 */
  lastDir: number;
  /** 击球键自带落点:far = 深球压底线,near = 短球放网前 */
  swingFarPressed: boolean;
  swingNearPressed: boolean;
}

export function newPad(): Pad {
  return {
    left: false, right: false, moveAxis: 0, jump: false,
    jumpPressed: false, lungePressed: false, lungeDir: 0, lastDir: 0,
    swingFarPressed: false, swingNearPressed: false,
  };
}

export function clearEdges(pad: Pad): void {
  pad.jumpPressed = false;
  pad.lungePressed = false;
  pad.lungeDir = 0;
  pad.swingFarPressed = false;
  pad.swingNearPressed = false;
}

/** 按下(边沿 + 状态),由各输入源调用 */
export function press(pad: Pad, action: "left" | "right" | "jump" | "lunge" | "swingFar" | "swingNear"): void {
  switch (action) {
    case "left": pad.left = true; pad.lastDir = -1; break;
    case "right": pad.right = true; pad.lastDir = 1; break;
    case "jump": pad.jump = true; pad.jumpPressed = true; break;
    case "lunge": {
      // 方向在按下这一刻现解,优先级:摇杆推的方向 → 当前按着的左右键 → 最近一次方向。
      // 都为零时留 0,由 player.ts 兜底成面向方向(= 朝网)。
      pad.lungePressed = true;
      if (Math.abs(pad.moveAxis) > JOYSTICK_DEADZONE) {
        pad.lungeDir = pad.moveAxis < 0 ? -1 : 1;
      } else if (pad.left !== pad.right) {
        pad.lungeDir = pad.left ? -1 : 1;
      } else {
        pad.lungeDir = pad.lastDir;
      }
      break;
    }
    case "swingFar": pad.swingFarPressed = true; break;
    case "swingNear": pad.swingNearPressed = true; break;
  }
}

/** 松开(状态),边沿不动 —— 边沿键(lunge/swingFar/swingNear)没有可松的状态 */
export function release(pad: Pad, action: "left" | "right" | "jump"): void {
  switch (action) {
    case "left": pad.left = false; break;
    case "right": pad.right = false; break;
    case "jump": pad.jump = false; break;
  }
}

/**
 * 摇杆写入:只在触屏摇杆里调用,不与 left/right 键冲突。
 * axis 已经带死区处理:|axis| ≤ 阈值一律视作 0(回中)。
 * lastDir 跟着非零推送更新,松手回中时保留 —— 与左右键 release 语义一致。
 */
export function setMoveAxis(pad: Pad, axis: number): void {
  const a = Math.abs(axis) < JOYSTICK_DEADZONE ? 0 : Math.max(-1, Math.min(1, axis));
  pad.moveAxis = a;
  if (a < 0) pad.lastDir = -1;
  else if (a > 0) pad.lastDir = 1;
}

/**
 * 清空所有按下状态。虚拟按键层被隐藏(离开对局态)时必须调一次:
 * 节点 inactive 之后 TOUCH_END 不会再送到按钮,手指抬起这件事就"丢"了,
 * pad.left 会一直卡在 true / moveAxis 会停在最后一次推送值,下一局人自己往一边跑。
 * lastDir 是「方向意图」不是按下状态,不清 —— 恢复对局后的第一次跨步
 * 仍该沿用玩家上一个方向,而不是凭空退回朝网。
 */
export function resetPadHolds(pad: Pad): void {
  release(pad, "left");
  release(pad, "right");
  release(pad, "jump");
  pad.moveAxis = 0;
  pad.lungePressed = false;
  pad.lungeDir = 0;
  pad.swingFarPressed = false;
  pad.swingNearPressed = false;
}

/** 老仓库 humanIntent 的等价物:把 Pad 翻成 PlayerInput(含反馈钩子) */
export function buildIntent(pad: Pad, hooks: Partial<PlayerInput>): PlayerInput {
  return {
    left: pad.left,
    right: pad.right,
    moveAxis: pad.moveAxis,
    jumpPressed: pad.jumpPressed,
    jumpHeld: pad.jump,
    lungePressed: pad.lungePressed,
    lungeDir: pad.lungeDir,
    // 击球键自带落点:远球键 = 深球压底线,近球键 = 短球放网前
    swingAim: pad.swingFarPressed ? "deep" : pad.swingNearPressed ? "near" : null,
    ...hooks,
  };
}

export const emptyIntent = (): PlayerInput => ({
  left: false, right: false, moveAxis: 0, jumpPressed: false, jumpHeld: false,
  swingAim: null, lungePressed: false, lungeDir: 0,
});
