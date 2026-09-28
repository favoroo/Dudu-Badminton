// ============================================================
// 输入意图合成:多个输入源(键盘 / 触屏虚拟按键)写同一张 Pad,
// 每个模拟步把它翻成 PlayerInput 后清边沿 —— 与老仓库 DD.Input 的
// isDown / justPressed / clearEdges 三件套同一套语义,只是平面化成对象。
// ============================================================
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
  /** 击球键自带落点:far = 深球压底线,near = 短球放网前 */
  swingFarPressed: boolean;
  swingNearPressed: boolean;
}

export function newPad(): Pad {
  return {
    left: false, right: false, jump: false, lunge: false,
    jumpPressed: false, lungePressed: false,
    swingFarPressed: false, swingNearPressed: false,
  };
}

export function clearEdges(pad: Pad): void {
  pad.jumpPressed = false;
  pad.lungePressed = false;
  pad.swingFarPressed = false;
  pad.swingNearPressed = false;
}

/** 按下(边沿 + 状态),由各输入源调用 */
export function press(pad: Pad, action: "left" | "right" | "jump" | "lunge" | "swingFar" | "swingNear"): void {
  switch (action) {
    case "left": pad.left = true; break;
    case "right": pad.right = true; break;
    case "jump": pad.jump = true; pad.jumpPressed = true; break;
    case "lunge": pad.lunge = true; pad.lungePressed = true; break;
    case "swingFar": pad.swingFarPressed = true; break;
    case "swingNear": pad.swingNearPressed = true; break;
  }
}

/** 松开(状态),边沿不动 */
export function release(pad: Pad, action: "left" | "right" | "jump" | "lunge"): void {
  switch (action) {
    case "left": pad.left = false; break;
    case "right": pad.right = false; break;
    case "jump": pad.jump = false; break;
    case "lunge": pad.lunge = false; break;
  }
}

/** 老仓库 humanIntent 的等价物:把 Pad 翻成 PlayerInput(含反馈钩子) */
export function buildIntent(pad: Pad, hooks: Partial<PlayerInput>): PlayerInput {
  return {
    left: pad.left,
    right: pad.right,
    jumpPressed: pad.jumpPressed,
    jumpHeld: pad.jump,
    lungePressed: pad.lungePressed,
    // 击球键自带落点:远球键 = 深球压底线,近球键 = 短球放网前
    swingAim: pad.swingFarPressed ? "deep" : pad.swingNearPressed ? "near" : null,
    ...hooks,
  };
}

export const emptyIntent = (): PlayerInput => ({
  left: false, right: false, jumpPressed: false, jumpHeld: false,
  swingAim: null, lungePressed: false,
});
