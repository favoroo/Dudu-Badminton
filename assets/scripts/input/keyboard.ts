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
const KEYMAP: Array<{ action: "left" | "right" | "jump" | "swingFar" | "swingNear"; codes: string[] }> = [
  { action: "left", codes: C.keys.p1.left },
  { action: "right", codes: C.keys.p1.right },
  { action: "jump", codes: C.keys.p1.jump },
  { action: "swingFar", codes: C.keys.p1.swingFar },
  { action: "swingNear", codes: C.keys.p1.swingNear },
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
      // 击球键是纯边沿语义,没有「按住」状态可松
      if (m.action !== "swingFar" && m.action !== "swingNear" && match(m.codes, code)) {
        release(pad, m.action);
      }
    }
  });
}
