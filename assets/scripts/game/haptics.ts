// ============================================================
// 触觉反馈:震动通道的唯一出口(game 层适配器)。
//
// 分工:「哪一下震多重、同时两件事谁先响」是打击感分级的一部分,住在纯逻辑层
// core/haptic.ts(能在 node 下断言);这里只做三件事 —— 探测设备能力、把一段脉冲
// 翻译成平台调用、以及**把失败说出来**。
//
// 为什么强调第三点:上一版这里是一个裸 `catch {}`,反射桥任何一点不对(老包没这
// 方法、签名写错、设备拒收)都会变成"开关打开了但什么都不发生",用户只能靠真机猜。
// 现在失败会记在 bridge/rejected 上,由 hapticStatus() 显示到设置页那一行读数里 ——
// 「到底哪一环断了」从此是可读的。
//
// 平台分支:
//   Android 原生 → native.reflection 反射 AppActivity.vibrate(int ms, int amp)
//   微信小游戏   → wx.vibrateShort({ type }),振幅映射成 light/medium/heavy 三型
//   浏览器       → navigator.vibrate(ms):只有时长没有振幅,所以按"无振幅控制"处理,
//                  强度差由 core/haptic.ts 折进时长(而且浏览器可能因非手势上下文忽略)
//   iOS 原生     → 有意不接:UIImpactFeedbackGenerator 要自定义 AppDelegate,
//                  本项目只发 Android APK + 微信小游戏,不做半吊子 iOS 触觉
// cc 3.8 的公开 API 没有 sys.vibrate,所以走上面这条反射桥(与 installApk 同款)。
// 开关真值只在 Settings.hapticOn / hapticLevel,本模块不自持手感状态。
// ============================================================
import { native, sys } from "cc";
import { Settings } from "../core/settings";
import { HapticCaps, HapticGate, HapticKey, HapticSeg, plan } from "../core/haptic";

const CLASS = "com/cocos/game/AppActivity";   // native/engine/android/app/.../AppActivity.java

type Kind = "android" | "wechat" | "web" | "ios" | "none";
/** 反射桥的健康状况 —— 直接印在设置页读数上 */
type Bridge = "pending" | "ok" | "no-bridge" | "no-method" | "rejected";

let kind: Kind = "none";
let bridge: Bridge = "pending";
let probed = false;
let warned = false;
/** 连续被 Java 侧拒收的次数:到 3 次就停手,不再每拍白烧一次 JNI 往返 */
let rejects = 0;

const caps: HapticCaps = { hasVibrator: false, hasAmplitude: false };
const gate = new HapticGate();

/** 一次性反射调用:失败不抛,交给调用点按 bridge 记账 */
function reflect(method: string, sig: string, ...args: number[]): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: native.reflection.callStaticMethod(CLASS, method, sig, ...args) };
  } catch {
    return { ok: false, value: undefined };
  }
}

/** 探测平台 + 设备能力,只做一次并缓存(每拍查会退化成每拍两次 JNI 往返) */
function probe(): void {
  probed = true;
  if (sys.platform === sys.Platform.WECHAT_GAME) {
    kind = "wechat";
    caps.hasVibrator = true;
    caps.hasAmplitude = true;   // 三型 type 就是振幅档
    bridge = typeof (globalThis as { wx?: unknown }).wx === "object" ? "ok" : "no-bridge";
    return;
  }
  if (sys.isNative) {
    if (sys.os === sys.OS.ANDROID) {
      kind = "android";
      if (!native || !native.reflection) { bridge = "no-bridge"; return; }
      const hv = reflect("hasVibrator", "()Z");
      if (!hv.ok) { bridge = "no-method"; return; }
      const ha = reflect("hasAmplitudeControl", "()Z");
      caps.hasVibrator = hv.value === true;
      caps.hasAmplitude = ha.ok && ha.value === true;
      bridge = "ok";
      return;
    }
    kind = sys.os === sys.OS.IOS || sys.os === sys.OS.OSX ? "ios" : "none";
    bridge = "no-bridge";
    return;
  }
  kind = typeof navigator !== "undefined" && typeof navigator.vibrate === "function" ? "web" : "none";
  if (kind === "web") {
    caps.hasVibrator = true;
    caps.hasAmplitude = false;  // navigator.vibrate 只吃时长
  }
  bridge = kind === "web" ? "ok" : "no-bridge";
}

/** 把一段脉冲下发到平台 */
function send(seg: HapticSeg): void {
  if (bridge === "no-bridge" || bridge === "no-method" || kind === "ios" || kind === "none") return;
  if (kind === "android") {
    // 无振幅控制时下发 -1(= VibrationEffect.DEFAULT_AMPLITUDE),强度差已经在 plan 里折进时长了
    const amp = caps.hasAmplitude ? seg.amp : -1;
    const r = reflect("vibrate", "(II)Z", seg.ms, amp);
    if (!r.ok) { bridge = "no-method"; return; }
    if (r.value !== true) {
      rejects++;
      if (rejects >= 3) { bridge = "rejected"; gate.disable(); warn(); }
    }
    return;
  }
  if (kind === "wechat") {
    const wx = (globalThis as {
      wx?: { vibrateShort?: (o: { type: "light" | "medium" | "heavy"; fail?: () => void }) => void };
    }).wx;
    const type = seg.amp >= 200 ? "heavy" : seg.amp >= 140 ? "medium" : "light";
    wx?.vibrateShort?.({ type, fail: () => { rejects++; } });
    return;
  }
  if (kind === "web") navigator.vibrate(seg.ms);
}

function warn(): void {
  if (warned) return;
  warned = true;
  console.warn(`[haptics] 震动通道不可用:${hapticStatus()} —— 设置页「震动反馈」那行读数会一直显示它`);
}

/** 排队段的自驱泵:主菜单里的设置页没有 game-root 的帧循环,靠它把待发放放完 */
let pumpTimer: ReturnType<typeof setTimeout> | null = null;
function armPump(): void {
  if (pumpTimer !== null) return;   // 已有泵就不叠:每个 tick 都重新 setTimeout 会把队列无限推后
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    const seg = gate.tick(Date.now());
    if (seg) send(seg);
    if (gate.busy()) armPump();
  }, 8);
}

/**
 * 震动唯一入口。key 决定这一震的强度档;普通击球/按键根本不该走到这里
 * (判据在 core/haptic.ts 的 shotKey(),它给普通档返回 null)。
 */
export function haptic(key: HapticKey): void {
  if (!Settings.hapticOn) return;
  if (!probed) probe();
  if (bridge === "no-bridge" || bridge === "no-method" || bridge === "rejected") { warn(); return; }
  const segs = plan(key, Settings.hapticLevel, caps);
  if (segs.length === 0) return;
  const r = gate.submit(Date.now(), segs);
  if (r === "swallow") return;
  if (r === "fire") send(segs[0]);
  armPump();
}

/**
 * 真实帧循环里带一脚(由 game-root 的 update 调)。和自驱泵走的是同一个 gate.tick,
 * 谁先到点谁消费那段,重复调不会放两遍。放在真实帧而不是模拟帧:定格/慢动作期间
 * 不该把待发放攒着一口气放完。
 */
export function hapticTick(): void {
  if (!probed || !Settings.hapticOn) return;
  const seg = gate.tick(Date.now());
  if (seg) send(seg);
  if (gate.busy()) armPump();
}

/** 总闸关掉 / 面板收起 / 暂停:把待发放丢掉,不许有"关掉以后还震一下"的尾巴 */
export function hapticCancel(): void {
  gate.clear();
}

/**
 * 设置页那一行读数。设计目标不是"说明功能",而是**回答「为什么没震」**:
 * 显示 no-method 就是包没带上 Java,显示无马达就是设备/ROM 限制,
 * 读数正常但没感觉才轮到强度档与系统触感总闸。
 */
export function hapticStatus(): string {
  if (!probed) probe();
  if (kind === "android") {
    if (bridge === "no-bridge") return "反射桥不可用(native.reflection 缺失)";
    if (bridge === "no-method") return "安装包里没有 vibrate 方法(需要重装 APK)";
    if (bridge === "rejected") return "马达连续拒收,已停止下发(查 logcat)";
    if (!caps.hasVibrator) return "原生 Android · 系统报告本机无振动马达";
    return caps.hasAmplitude ? "原生 Android · 有马达 · 振幅可控" : "原生 Android · 有马达 · 振幅锁定(强度折算成时长)";
  }
  if (kind === "wechat") return bridge === "ok" ? "微信小游戏 · wx.vibrateShort 三型" : "微信小游戏 · 取不到 wx";
  if (kind === "web") return "浏览器 · navigator.vibrate(需系统触感允许)";
  if (kind === "ios") return "iOS 原生 · 未接触觉(UIImpactFeedbackGenerator 需自定义 AppDelegate)";
  return "该平台无震动通道";
}
