// ============================================================
// 全局设置:唯一真值源。
//
// 为什么要有这一层:UI 拿不到 GameRoot 的私有 sfx/bgm(两套音频各有实例:
// GameRoot 一份、UIManager 一份,都往 Canvas 挂 AudioSource),渲染层也不该
// 回头问 UI。老做法是让 UI 去 `node.getComponents(AudioSource)` 扫一遍 ——
// 非递归,于是挂在子节点上的 6 个 BGM stem 从来没被静音过。现在改成
// 「谁用谁读 Settings」,真值只有一份,谁都够得着,不需要跨层摸私有字段。
//
// 为什么只 import ./utils(不碰 cc):tools/tsconfig.json 只编
// assets/scripts/core/**,这个文件要能在 node 下被 settings-check 直接跑。
//
// 按键布局存的是「相对默认位的位移 dx/dy + 绝对半径 r」,不是屏幕绝对坐标:
// 设计分辨率是 FIXED_HEIGHT —— 高恒 540、宽随长宽比变(16:9 是 960,20:9 是
// 1080),再叠加左右刘海内缩,绝对坐标在 A 机调好到 B 机就出屏。控制簇靠
// Widget 吸附屏幕角落,簇内相对位移能同时穿越长宽比变化与安全区变化。
// ============================================================
import { clamp, load, save } from "./utils";

export type PadAction = "left" | "right" | "jump" | "swingFar" | "swingNear" | "lunge";

/** 6 个虚拟键的默认布局(数值来源:input/touchpad.ts 原来的字面量) */
export interface PadBase { x: number; y: number; r: number; cluster: "left" | "right" }
export const PAD_BASE: Record<PadAction, PadBase> = {
  left: { x: 50, y: 50, r: 44, cluster: "left" },
  right: { x: 155, y: 50, r: 44, cluster: "left" },
  swingFar: { x: -48, y: 48, r: 38, cluster: "right" },
  swingNear: { x: -146, y: 48, r: 38, cluster: "right" },
  jump: { x: -60, y: 142, r: 48, cluster: "right" },
  // 跨步键与「跳」同一排、靠左:右手四键成 2×2,拇指不用重新学位置。
  // 与 jump 圆心相距 92 > 半径和 88,默认布局下不重叠。
  lunge: { x: -152, y: 142, r: 40, cluster: "right" },
};
/** 键名(设置面板与编辑器 chip 共用;文案只写触屏向,不出现键位名) */
export const PAD_LABEL: Record<PadAction, string> = {
  left: "左", right: "右", jump: "跳", swingFar: "深球", swingNear: "短球", lunge: "跨步",
};
/** 顺序即编辑器 chip 的展示顺序:左手两键 → 右手四键 */
export const PAD_ACTIONS: PadAction[] = ["left", "right", "jump", "swingFar", "swingNear", "lunge"];

/**
 * 触屏移动方式:
 *   "joystick" —— 左半屏一个虚拟摇杆,推多少走多少,能做小碎步与缓冲;
 *   "buttons"  —— 老式「左 / 右」两个按钮,离散全速。
 * 新装机默认 joystick;老用户存档 sanitize 时保留 buttons,不打断肌肉记忆。
 */
export type MoveMode = "joystick" | "buttons";

/** 位移按簇内相对值夹,半径给一个手指可点又不至于糊屏的区间;透明度 0.2~1.0(1.0 = 完全不透明) */
export const PAD_LIMIT = { rMin: 26, rMax: 72, maxDx: 240, maxDy: 180, alphaMin: 0.2, alphaMax: 1.0 };

/** 摇杆本体默认:底圈圆心在左簇内的位置(与 PAD_BASE.left 同参考系)+ 底圈半径 */
export const JOYSTICK_BASE = { x: 78, y: 78, r: 68 };

/** 摇杆半径可调范围,比普通按钮大一档;手指捏得住又不糊左半屏 */
export const JOYSTICK_LIMIT = { rMin: 46, rMax: 96, maxDx: 200, maxDy: 160 };

export interface PadBtn { dx: number; dy: number; r: number }

export interface GameSettings {
  v: number;
  // 两条总线独立开关(用户要的「音效/音乐分开」),音量各自 0..1
  sfxOn: boolean; sfxVol: number;
  bgmOn: boolean; bgmVol: number;
  // 画面提示:落点预测圈 / 屏幕震动 / 飘字
  hintLanding: boolean; hintShake: boolean; hintFloat: boolean;
  // 触觉反馈:按键/击球/得分的短震动(移动端,Web 是空操作)
  hapticOn: boolean;
  // 按钮整体透明度(0.2~1.0,1.0 = 完全不透明)—— 全局一条,不逐键独立
  padAlpha: number;
  pad: Record<PadAction, PadBtn>;
  /** 触屏移动方式:摇杆 or 左右按键。老档缺失时 sanitize 走 "buttons"(不打断既成习惯) */
  moveMode: MoveMode;
  /** 摇杆本体的位/大小:dx/dy 相对 JOYSTICK_BASE,r = 底圈半径(渲染时再乘设备 scale) */
  joystick: PadBtn;
}

const KEY = "settings";

function fresh(): GameSettings {
  const pad = {} as Record<PadAction, PadBtn>;
  for (const a of PAD_ACTIONS) pad[a] = { dx: 0, dy: 0, r: PAD_BASE[a].r };
  return {
    v: 1,
    sfxOn: true, sfxVol: 0.8,
    bgmOn: true, bgmVol: 0.6,
    hintLanding: true, hintShake: true, hintFloat: true,
    hapticOn: true,
    padAlpha: 0.8,
    pad,
    moveMode: "joystick",
    joystick: { dx: 0, dy: 0, r: JOYSTICK_BASE.r },
  };
}

// ---------- 消毒:坏档最坏退回默认,不许崩 ----------

const num = (v: unknown, d: number, lo: number, hi: number): number =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : d;
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const moveModeOf = (v: unknown, d: MoveMode): MoveMode =>
  v === "joystick" || v === "buttons" ? v : d;

/** 坏档不许崩:认不出的字段一律退回默认。导出给 tools/settings-check.ts 直接断言 */
export function sanitize(raw: unknown): GameSettings {
  const s = fresh();
  if (!raw || typeof raw !== "object") return s;
  const r = raw as Partial<GameSettings> & Record<string, unknown>;
  s.sfxOn = bool(r.sfxOn, s.sfxOn);
  s.sfxVol = num(r.sfxVol, s.sfxVol, 0, 1);
  s.bgmOn = bool(r.bgmOn, s.bgmOn);
  s.bgmVol = num(r.bgmVol, s.bgmVol, 0, 1);
  s.hintLanding = bool(r.hintLanding, s.hintLanding);
  s.hintShake = bool(r.hintShake, s.hintShake);
  s.hintFloat = bool(r.hintFloat, s.hintFloat);
  s.hapticOn = bool(r.hapticOn, s.hapticOn);
  s.padAlpha = num(r.padAlpha, s.padAlpha, PAD_LIMIT.alphaMin, PAD_LIMIT.alphaMax);
  const pad = r.pad as Record<string, Partial<PadBtn>> | null | undefined;
  let padSeen = false;
  if (pad && typeof pad === "object") {
    for (const a of PAD_ACTIONS) {
      const p = pad[a];
      if (!p || typeof p !== "object") continue;
      padSeen = true;
      s.pad[a] = {
        dx: num(p.dx, 0, -PAD_LIMIT.maxDx, PAD_LIMIT.maxDx),
        dy: num(p.dy, 0, -PAD_LIMIT.maxDy, PAD_LIMIT.maxDy),
        r: num(p.r, PAD_BASE[a].r, PAD_LIMIT.rMin, PAD_LIMIT.rMax),
      };
    }
  }
  // 老档升级:raw 里带 pad 却没有 moveMode → 判定为摇杆功能上线前装机的老玩家,
  // 保持他们的「左右按键」体验,不无预警换成摇杆。新装机走 fresh() 的 "joystick"。
  const legacyMode: MoveMode = padSeen ? "buttons" : "joystick";
  s.moveMode = moveModeOf(r.moveMode, legacyMode);
  const joy = r.joystick as Partial<PadBtn> | null | undefined;
  if (joy && typeof joy === "object") {
    s.joystick = {
      dx: num(joy.dx, 0, -JOYSTICK_LIMIT.maxDx, JOYSTICK_LIMIT.maxDx),
      dy: num(joy.dy, 0, -JOYSTICK_LIMIT.maxDy, JOYSTICK_LIMIT.maxDy),
      r: num(joy.r, JOYSTICK_BASE.r, JOYSTICK_LIMIT.rMin, JOYSTICK_LIMIT.rMax),
    };
  }
  return s;
}

// ---------- 存储 ----------

/** 导出类是为了 tools/settings-check.ts 能造独立实例(带自己的假后端)跑断言 */
export class SettingsStore {
  private s: GameSettings = fresh();
  private loaded = false;
  private dirty = false;
  private subs: Array<(s: GameSettings) => void> = [];

  /**
   * 宿主启动时读盘一次(GameRoot.onLoad / UIManager.start 都会调,幂等)。
   * 要排在 game/host.installStorageBackend() 之后,否则读到的还是内存兜底。
   */
  init(): GameSettings {
    if (this.loaded) return this.s;
    this.loaded = true;
    const raw = load<unknown>(KEY, null);
    this.s = sanitize(raw);
    // 老档兼容:以前只有一个全局 muted,拆成两条总线时一起对齐
    if (raw === null && load("muted", false)) {
      this.s.sfxOn = false;
      this.s.bgmOn = false;
      this.flush();
    }
    return this.s;
  }

  /** 全量只读快照(面板重画用;取值前确保已读盘) */
  get v(): GameSettings {
    if (!this.loaded) this.init();
    return this.s;
  }

  // 高频读取路径:sfx 每拍一次、bgm 每帧一次,直接给叶子字段,少一层解构
  get sfxOn(): boolean { return this.v.sfxOn; }
  get sfxVol(): number { return this.v.sfxVol; }
  get bgmOn(): boolean { return this.v.bgmOn; }
  get bgmVol(): number { return this.v.bgmVol; }
  get hintLanding(): boolean { return this.v.hintLanding; }
  get hintShake(): boolean { return this.v.hintShake; }
  get hintFloat(): boolean { return this.v.hintFloat; }
  get hapticOn(): boolean { return this.v.hapticOn; }
  get padAlpha(): number { return this.v.padAlpha; }
  get moveMode(): MoveMode { return this.v.moveMode; }
  get joystick(): PadBtn { return this.v.joystick; }

  /** 某个键的当前布局(默认位 + 位移) */
  padOf(a: PadAction): PadBtn { return this.v.pad[a]; }

  /**
   * 改一个键。persist=false 只改内存 —— 拖动是 60Hz 的,而原生
   * sys.localStorage.setItem 是同步文件 IO,不能每帧写盘;松手时 flush()。
   */
  setPad(a: PadAction, p: Partial<PadBtn>, persist = true): void {
    const s = this.v;
    const cur = s.pad[a];
    if (p.dx !== undefined) cur.dx = clamp(p.dx, -PAD_LIMIT.maxDx, PAD_LIMIT.maxDx);
    if (p.dy !== undefined) cur.dy = clamp(p.dy, -PAD_LIMIT.maxDy, PAD_LIMIT.maxDy);
    if (p.r !== undefined) cur.r = clamp(p.r, PAD_LIMIT.rMin, PAD_LIMIT.rMax);
    this.after(persist);
  }

  /** 摇杆本体位/大小(独立于左右键:两种模式各自的存档,切换不会互相污染) */
  setJoystick(p: Partial<PadBtn>, persist = true): void {
    const cur = this.v.joystick;
    if (p.dx !== undefined) cur.dx = clamp(p.dx, -JOYSTICK_LIMIT.maxDx, JOYSTICK_LIMIT.maxDx);
    if (p.dy !== undefined) cur.dy = clamp(p.dy, -JOYSTICK_LIMIT.maxDy, JOYSTICK_LIMIT.maxDy);
    if (p.r !== undefined) cur.r = clamp(p.r, JOYSTICK_LIMIT.rMin, JOYSTICK_LIMIT.rMax);
    this.after(persist);
  }

  /** 批量改布局(重置默认用)。只回位按钮半径,不动移动方式(用户偏好独立于布局) */
  resetPad(): void {
    const s = this.v;
    for (const a of PAD_ACTIONS) s.pad[a] = { dx: 0, dy: 0, r: PAD_BASE[a].r };
    s.padAlpha = 0.8;
    s.joystick = { dx: 0, dy: 0, r: JOYSTICK_BASE.r };
    this.after(true);
  }

  /**
   * 改声音/画面提示那批标量 + 移动方式。
   * persist=false 同 setPad:音量滑杆拖动时逐帧改内存、松手再 flush,
   * 原生 sys.localStorage.setItem 是同步文件 IO,不能跟着手指 60Hz 写盘。
   */
  setPart(p: Partial<Pick<GameSettings, "sfxOn" | "sfxVol" | "bgmOn" | "bgmVol" | "hintLanding" | "hintShake" | "hintFloat" | "hapticOn" | "padAlpha" | "moveMode">>, persist = true): void {
    const s = this.v;
    if (p.sfxOn !== undefined) s.sfxOn = bool(p.sfxOn, s.sfxOn);
    if (p.sfxVol !== undefined) s.sfxVol = num(p.sfxVol, s.sfxVol, 0, 1);
    if (p.bgmOn !== undefined) s.bgmOn = bool(p.bgmOn, s.bgmOn);
    if (p.bgmVol !== undefined) s.bgmVol = num(p.bgmVol, s.bgmVol, 0, 1);
    if (p.hintLanding !== undefined) s.hintLanding = bool(p.hintLanding, s.hintLanding);
    if (p.hintShake !== undefined) s.hintShake = bool(p.hintShake, s.hintShake);
    if (p.hintFloat !== undefined) s.hintFloat = bool(p.hintFloat, s.hintFloat);
    if (p.hapticOn !== undefined) s.hapticOn = bool(p.hapticOn, s.hapticOn);
    if (p.padAlpha !== undefined) s.padAlpha = num(p.padAlpha, s.padAlpha, PAD_LIMIT.alphaMin, PAD_LIMIT.alphaMax);
    if (p.moveMode !== undefined) s.moveMode = moveModeOf(p.moveMode, s.moveMode);
    this.after(persist);
  }

  // ---------- 全局静音(菜单徽章 / KeyM 的老语义,一个钮管两条总线) ----------

  get allMuted(): boolean { return !this.v.sfxOn && !this.v.bgmOn; }

  /** 全静音 ⇄ 全恢复;返回新的 allMuted,与老 toggleMute() 的返回值同义 */
  toggleAllMute(): boolean {
    const s = this.v;
    const off = !this.allMuted;
    s.sfxOn = !off;
    s.bgmOn = !off;
    this.after(true);
    return off;
  }

  // ---------- 落盘与通知 ----------

  /** 写盘;音量/开关类走 setPart 已含落盘,只有拖动中途的 persist=false 需要靠它补一刀 */
  flush(): void {
    save(KEY, this.s);
    // 镜像老键:回滚 APK 时旧版本读 muted 也仍是用户想要的静音态
    save("muted", this.allMuted);
    this.dirty = false;
  }

  private after(persist: boolean): void {
    if (persist) this.flush();
    else this.dirty = true;
    for (const cb of this.subs.slice()) cb(this.s);
  }

  /** 有待提交的内存改动吗(编辑器收尾时判断要不要 flush) */
  get hasPending(): boolean { return this.dirty; }

  /** 订阅改动,返回退订闭包(面板/按键实例共用一条通知链,谁改都同步) */
  onChange(cb: (s: GameSettings) => void): () => void {
    this.subs.push(cb);
    return () => {
      const i = this.subs.indexOf(cb);
      if (i >= 0) this.subs.splice(i, 1);
    };
  }
}

export const Settings = new SettingsStore();
