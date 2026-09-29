// ============================================================
// 触觉反馈:震动通道的统一出口。
//
// 为什么要有这层:打击感体系(hitstop 六档 + 震屏 + punch)已经很完整,
// 但全部只走视听 —— 手机上最廉价有效的触觉通道是零。这里把「什么强度震多久」
// 收敛成三档,谁要震谁调,不关心平台差异:
//   Android 原生 → native.reflection 反射 AppActivity.vibrate(int)
//   Web          → navigator.vibrate(浏览器可能因非手势上下文忽略,静默降级)
//   其它         → 空操作
// cc 3.8 的公开 API 没有 sys.vibrate,所以才有上面这条反射桥(与 installApk 同款)。
// 开关真值只在 Settings.hapticOn,本模块不自持状态。
// ============================================================
import { native, sys } from "cc";
import { Settings } from "../core/settings";

export type HapticLevel = "light" | "hit" | "score";

/** 每档震动时长(毫秒):轻 = 虚拟按键按下,中 = 击球,重 = 得分/完美重扣 */
const MS: Record<HapticLevel, number> = { light: 12, hit: 24, score: 40 };

/** 节流:同帧多事件(击球+得分)或连打时不把手机震成马达 */
let lastAt = 0;
const THROTTLE_MS = 60;

function vibrate(ms: number): void {
  if (sys.isNative && sys.os === sys.OS.ANDROID) {
    try {
      native.reflection.callStaticMethod(
        "com/cocos/game/AppActivity",   // native/engine/android/app/.../AppActivity.java
        "vibrate",
        "(I)V",
        ms,
      );
    } catch { /* 旧包没有这个静态方法,静默降级为无震动 */ }
    return;
  }
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate === "function") nav.vibrate(ms);
}

/** 触觉反馈唯一入口;设置里关掉就是彻底的无操作 */
export function haptic(level: HapticLevel): void {
  if (!Settings.hapticOn) return;
  const now = Date.now();
  if (now - lastAt < THROTTLE_MS) return;
  lastAt = now;
  vibrate(MS[level]);
}
