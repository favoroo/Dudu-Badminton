// ============================================================
// 输入意图合成:多个输入源(键盘 / 触屏虚拟按键)写同一张 Pad,
// 每个模拟步把它翻成 PlayerInput 后清边沿 —— 与老仓库 DD.Input 的
// isDown / justPressed / clearEdges 三件套同一套语义,只是平面化成对象。
// ============================================================
import { CFG } from "../core/config";
import type { PlayerInput } from "../core/types";

export interface Pad {
  left: boolean;
  right: boolean;
  /** 按住 = 可变跳高的 held 语义 */
  jump: boolean;
  lunge: boolean;
  /** 边沿:本步内刚按下(每步用后即清) */
  jumpPressed: boolean;
  lungePressed: boolean;
  /** 跨步方向:-1=向左, 1=向右 */
  lungeDir?: number;
  /** 击球键自带落点:far = 深球压底线,near = 短球放网前 */
  swingFarPressed: boolean;
  swingNearPressed: boolean;
  /** 双击方向键内部计时与状态(毫秒) */
  _lastLeftPressTime?: number;
  _lastRightPressTime?: number;
  _leftReleased?: boolean;
  _rightReleased?: boolean;
}

export function newPad(): Pad {
  return {
    left: false, right: false, jump: false, lunge: false,
    jumpPressed: false, lungePressed: false, lungeDir: 0,
    swingFarPressed: false, swingNearPressed: false,
    _lastLeftPressTime: 0, _lastRightPressTime: 0,
    _leftReleased: true, _rightReleased: true,
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
  const now = Date.now();
  const windowMs = CFG.lunge.doubleTapWindowMs || 300;

  switch (action) {
    case "left": {
      if (!pad.left) {
        // 从未按下转为按下(上升沿)时进行双击判定,长按重发不触发双击
        if (pad._leftReleased && (now - (pad._lastLeftPressTime || 0)) <= windowMs) {
          pad.lungePressed = true;
          pad.lungeDir = -1;
          pad._lastLeftPressTime = 0;
          pad._leftReleased = false;
        } else {
          pad._lastLeftPressTime = now;
          pad._leftReleased = false;
        }
        pad._lastRightPressTime = 0; // 反方向按键清空对方计时
      }
      pad.left = true;
      break;
    }
    case "right": {
      if (!pad.right) {
        if (pad._rightReleased && (now - (pad._lastRightPressTime || 0)) <= windowMs) {
          pad.lungePressed = true;
          pad.lungeDir = 1;
          pad._lastRightPressTime = 0;
          pad._rightReleased = false;
        } else {
          pad._lastRightPressTime = now;
          pad._rightReleased = false;
        }
        pad._lastLeftPressTime = 0; // 反方向按键清空对方计时
      }
      pad.right = true;
      break;
    }
    case "jump": pad.jump = true; pad.jumpPressed = true; break;
    case "lunge": pad.lunge = true; pad.lungePressed = true; break;
    case "swingFar": pad.swingFarPressed = true; break;
    case "swingNear": pad.swingNearPressed = true; break;
  }
}

/** 松开(状态),边沿不动 */
export function release(pad: Pad, action: "left" | "right" | "jump" | "lunge"): void {
  switch (action) {
    case "left":
      pad.left = false;
      pad._leftReleased = true;
      break;
    case "right":
      pad.right = false;
      pad._rightReleased = true;
      break;
    case "jump": pad.jump = false; break;
    case "lunge": pad.lunge = false; break;
  }
}

/**
 * 清空所有按下状态。虚拟按键层被隐藏(离开对局态)时必须调一次:
 * 节点 inactive 之后 TOUCH_END 不会再送到按钮,手指抬起这件事就"丢"了,
 * pad.left 会一直卡在 true,双击跨步的计时字段也会留下半截状态。
 * 计时清零 + _Released 置回 true,恢复后的第一次点击不会被凑成"双击"。
 */
export function resetPadHolds(pad: Pad): void {
  release(pad, "left");
  release(pad, "right");
  release(pad, "jump");
  release(pad, "lunge");
  pad.lungePressed = false;
  pad.lungeDir = 0;
  pad.swingFarPressed = false;
  pad.swingNearPressed = false;
  pad._lastLeftPressTime = 0;
  pad._lastRightPressTime = 0;
  pad._leftReleased = true;
  pad._rightReleased = true;
}

/** 老仓库 humanIntent 的等价物:把 Pad 翻成 PlayerInput(含反馈钩子) */
export function buildIntent(pad: Pad, hooks: Partial<PlayerInput>): PlayerInput {
  return {
    left: pad.left,
    right: pad.right,
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
  left: false, right: false, jumpPressed: false, jumpHeld: false,
  swingAim: null, lungePressed: false, lungeDir: 0,
});
