// ============================================================
// 键盘输入源:按 CFG.keys.p1 的 e.code 键位表,把 Cocos 键盘事件
// 写进 Pad。桌面预览用;键位表仍然是唯一权威,触屏端虚拟按键
// 映射的是同一套动作语义,不另立第二张表。
// ============================================================
import { input as ccinput, EventKeyboard, KeyCode } from "cc";
import { CFG } from "../core/config";
import { Pad, press, release } from "./pad";

const C = CFG;

// 动作 → 候选键 code 列表(取自 config.keys.p1,与老仓库 input.js 同一来源)
const KEYMAP: Array<{ action: "left" | "right" | "jump" | "lunge" | "swingFar" | "swingNear"; codes: string[] }> = [
  { action: "left", codes: C.keys.p1.left },
  { action: "right", codes: C.keys.p1.right },
  { action: "jump", codes: C.keys.p1.jump },
  { action: "lunge", codes: C.keys.p1.lunge },
  { action: "swingFar", codes: C.keys.p1.swingFar },
  { action: "swingNear", codes: C.keys.p1.swingNear },
];

function match(codes: string[], code: KeyCode): boolean {
  return codes.includes(code as unknown as string);
}

export function bindKeyboard(pad: Pad, onSystemKey: (code: string) => void): void {
  ccinput.on(ccinput.EventType.KEY_DOWN, (e: EventKeyboard) => {
    // 系统键只取按下边沿
    onSystemKey(e.keyCode as unknown as string);
    for (const m of KEYMAP) {
      if (match(m.codes, e.keyCode)) press(pad, m.action);
    }
  });
  ccinput.on(ccinput.EventType.KEY_UP, (e: EventKeyboard) => {
    for (const m of KEYMAP) {
      if (match(m.codes, e.keyCode)) release(pad, m.action);
    }
  });
}
