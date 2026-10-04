// ============================================================
// 键盘输入源:按 CFG.keys.p1 的 e.code 键位表,把 Cocos 键盘事件
// 写进 Pad。桌面预览用;键位表仍然是唯一权威,触屏端虚拟按键
// 映射的是同一套动作语义,不另立第二张表。
// ============================================================
import { input, Input, EventKeyboard, KeyCode } from "cc";
import { CFG } from "../core/config";
import { Pad, press, release } from "./pad";

const C = CFG;

// 常见 KeyCode 到标准 e.code 字符串的兜底映射(跨平台无 rawEvent 时使用)
const KEYCODE_TO_CODE: Record<number, string> = {
  [KeyCode.KEY_A]: "KeyA",
  [KeyCode.KEY_D]: "KeyD",
  [KeyCode.KEY_W]: "KeyW",
  [KeyCode.KEY_S]: "KeyS",
  [KeyCode.KEY_J]: "KeyJ",
  [KeyCode.KEY_K]: "KeyK",
  [KeyCode.KEY_L]: "KeyL",
  [KeyCode.COMMA]: "Comma",
  [KeyCode.KEY_Z]: "KeyZ",
  [KeyCode.KEY_X]: "KeyX",
  [KeyCode.KEY_R]: "KeyR",
  [KeyCode.KEY_M]: "KeyM",
  [KeyCode.KEY_P]: "KeyP",
  [KeyCode.ESCAPE]: "Escape",
  [KeyCode.SPACE]: "Space",
  [KeyCode.ARROW_UP]: "ArrowUp",
  [KeyCode.ARROW_DOWN]: "ArrowDown",
  [KeyCode.ARROW_LEFT]: "ArrowLeft",
  [KeyCode.ARROW_RIGHT]: "ArrowRight",
};

function getCode(e: EventKeyboard): string {
  // 浏览器环境下优先取原生 KeyboardEvent.code(保真 'KeyA', 'ArrowLeft' 等)
  const raw = (e as unknown as { rawEvent?: { code?: string } }).rawEvent;
  if (raw && typeof raw.code === "string" && raw.code.length > 0) {
    return raw.code;
  }
  return KEYCODE_TO_CODE[e.keyCode] || "";
}

// 动作 → 候选键 code 列表(取自 config.keys.p1,与老仓库 input.js 同一来源)
// 键盘不受触屏双键合并影响:J=深球(swingFar), K=短球(swingNear) 仍各占一键,
// U=挑高(swingUp), I=平抽(swingDown) —— 四键各定一个完整意图,
// press() 内部映射到 swingSwipe/swingSwipeY=±1,与触屏四向滑动手势殊途同归。
type PadAct = "left" | "right" | "jump" | "lunge" | "swingFar" | "swingNear" | "swingUp" | "swingDown";
/** 纯边沿语义的动作:一次按下就是一个动作,没有「按住」状态可松 */
const EDGE_ACTIONS: PadAct[] = ["lunge", "swingFar", "swingNear", "swingUp", "swingDown"];

/** 有「按住」状态的动作(类型守卫:KEY_UP 只会把这类交给 release) */
const isHoldAction = (a: PadAct): a is "left" | "right" | "jump" => !EDGE_ACTIONS.includes(a);

const KEYMAP: Array<{ action: PadAct; codes: string[] }> = [
  { action: "left", codes: C.keys.p1.left },
  { action: "right", codes: C.keys.p1.right },
  { action: "jump", codes: C.keys.p1.jump },
  { action: "lunge", codes: C.keys.p1.lunge },
  { action: "swingFar", codes: C.keys.p1.swingFar },
  { action: "swingNear", codes: C.keys.p1.swingNear },
  { action: "swingUp", codes: C.keys.p1.swingUp },
  { action: "swingDown", codes: C.keys.p1.swingDown },
];

function match(codes: string[], code: string): boolean {
  return codes.includes(code);
}

export function bindKeyboard(pad: Pad, onSystemKey: (code: string) => void): void {
  input.on(Input.EventType.KEY_DOWN, (e: EventKeyboard) => {
    const code = getCode(e);
    if (!code) return;
    // 系统键只取按下边沿
    onSystemKey(code);
    for (const m of KEYMAP) {
      if (match(m.codes, code)) press(pad, m.action);
    }
  });
  input.on(Input.EventType.KEY_UP, (e: EventKeyboard) => {
    const code = getCode(e);
    if (!code) return;
    for (const m of KEYMAP) {
      // 边沿键(跨步/击球)没有「按住」状态可松
      if (isHoldAction(m.action) && match(m.codes, code)) release(pad, m.action);
    }
  });
}
