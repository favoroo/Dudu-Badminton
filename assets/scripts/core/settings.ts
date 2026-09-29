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

/**
 * 触屏击球键合并为单个 "swing" 按钮,通过滑动手势区分深浅:
 *   直接点击 = mid(由物理自动决定球种)
 *   右滑     = deep(深球/扣杀)
 *   左滑     = near(短球/放网)
 * swingFar / swingNear 保留给键盘专用(两键天然不冲突),旧存档也仍含这两个字段。
 */
export type PadAction = "left" | "right" | "jump" | "swing" | "swingFar" | "swingNear" | "lunge";

/**
 * 6 个虚拟键的默认布局(数值来源:input/touchpad.ts 原来的字面量)
 *
 * 「跳」原来住在右簇,和击球两键挤同一个拇指的活动范围 —— 跳杀要同时起跳 + 出拍,
 * 一只手按不住跳跃又能精准点球路。现在摇杆模式下由**往上推摇杆**代跳(左手本该
 * 管的事),右簇只剩三键;这个 jump 条目退化成 buttons 模式(无摇杆可推)的实体回退键。
 *
 * 基准 (188,172) 在左簇摇杆右上:与摇杆中心 (78,78) 相距 144.7,扣掉本身半径 48 后
 * 最近边缘 96.7 —— 摇杆本体(68)不被遮挡。选这个位置是为了让两种模式里「跳跃」
 * 都住在左手上方同一块屏幕区域,肌肉记忆连续。
 */
export interface PadBase { x: number; y: number; r: number; cluster: "left" | "right" }
export const PAD_BASE: Record<PadAction, PadBase> = {
  left: { x: 50, y: 50, r: 44, cluster: "left" },
  right: { x: 155, y: 50, r: 44, cluster: "left" },
  jump: { x: 188, y: 172, r: 48, cluster: "left" },
  // 合并后的单击球键:居中放大(r=46),方便手指在按下后横滑区分深浅
  swing: { x: -97, y: 48, r: 46, cluster: "right" },
  // 以下两键保留给键盘专用路径(触屏不再为它们建按钮),旧存档兼容用
  swingFar: { x: -48, y: 48, r: 38, cluster: "right" },
  swingNear: { x: -146, y: 48, r: 38, cluster: "right" },
  // 跨步键坐标没动:右簇腾出的右上那格直接留空,免得右手为剩下的键重新学位置。
  lunge: { x: -152, y: 142, r: 40, cluster: "right" },
};
/** 键名(设置面板与编辑器 chip 共用;文案只写触屏向,不出现键位名) */
export const PAD_LABEL: Record<PadAction, string> = {
  left: "左", right: "右", jump: "跳", swing: "击球", swingFar: "深球", swingNear: "短球", lunge: "跨步",
};
/** 存档/重置的遍历序:左簇(摇杆模式下的回退键) → 右簇 */
export const PAD_ACTIONS: PadAction[] = ["left", "right", "jump", "swing", "swingFar", "swingNear", "lunge"];

/**
 * 触屏移动方式:
 *   "joystick" —— 左半屏一个虚拟摇杆,推多少走多少,能做小碎步与缓冲;
 *                 **往上推即起跳**,所以这个模式下右簇只有三键、没有跳跃键。
 *   "slider"   —— 左半屏一个精准滑轨,滑到哪里角色就平滑移到对应位置精准刹停;
 *                 支持**上滑跳跃**与**双击跳跃**。
 *   "buttons"  —— 老式「左 / 右」两个按钮,离散全速。
 *                 没摇杆可推,跳跃退回左簇那个实体键(PAD_BASE.jump)。
 * 新装机默认 joystick;老用户存档 sanitize 时保留 buttons,不打断肌肉记忆。
 */
export type MoveMode = "joystick" | "buttons" | "slider";

/**
 * 精彩即时回放模式:
 *   "off"        —— 关闭回放
 *   "matchpoint" —— 仅在赛点绝杀时慢动作回放
 *   "all"        —— 扣杀得分与赛点绝杀均进行慢动作回放
 */
export type ReplayMode = "off" | "matchpoint" | "all";

/** 位移按簇内相对值夹,半径给一个手指可点又不至于糊屏的区间;透明度 0.2~1.0(1.0 = 完全不透明) */
export const PAD_LIMIT = { rMin: 26, rMax: 72, maxDx: 240, maxDy: 180, alphaMin: 0.2, alphaMax: 1.0 };

/** 摇杆本体默认:底圈圆心在左簇内的位置(与 PAD_BASE.left 同参考系)+ 底圈半径 */
export const JOYSTICK_BASE = { x: 78, y: 78, r: 68 };

/** 摇杆半径可调范围,比普通按钮大一档;手指捏得住又不糊左半屏 */
export const JOYSTICK_LIMIT = { rMin: 46, rMax: 96, maxDx: 200, maxDy: 160 };

/** 滑轨本体默认:底座中心在左簇内的位置(与 PAD_BASE.left 同参考系)+ 胶囊轨半高半径 */
export const SLIDER_BASE = { x: 125, y: 64, w: 220, h: 56, r: 28 };

/** 滑轨半径(半高)可调范围 */
export const SLIDER_LIMIT = { rMin: 20, rMax: 44, maxDx: 200, maxDy: 160 };

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
  /** 触屏移动方式:摇杆 or 左右按键 or 滑轨。老档缺失时 sanitize 走 "buttons"(不打断既成习惯) */
  moveMode: MoveMode;
  /** 精彩即时回放模式:关闭 / 仅赛点 / 全部精彩扣杀 */
  replayMode: ReplayMode;
  /** 摇杆本体的位/大小:dx/dy 相对 JOYSTICK_BASE,r = 底圈半径(渲染时再乘设备 scale) */
  joystick: PadBtn;
  /** 滑轨本体的位/大小:dx/dy 相对 SLIDER_BASE,r = 底轨半高半径(渲染时再乘设备 scale) */
  slider: PadBtn;
}

const KEY = "settings";

function fresh(): GameSettings {
  const pad = {} as Record<PadAction, PadBtn>;
  for (const a of PAD_ACTIONS) pad[a] = { dx: 0, dy: 0, r: PAD_BASE[a].r };
  return {
    // v=2:「跳」从右簇键改成摇杆上推代跳,键位退化为 buttons 模式回退并搬到左簇。
    // sanitize 靠它识别老档、重置跳跃偏移(新装机走 fresh 的默认位,不触发)。
    v: 2,
    sfxOn: true, sfxVol: 0.8,
    bgmOn: true, bgmVol: 0.6,
    hintLanding: true, hintShake: true, hintFloat: true,
    hapticOn: true,
    padAlpha: 0.8,
    pad,
    moveMode: "joystick",
    replayMode: "matchpoint",
    joystick: { dx: 0, dy: 0, r: JOYSTICK_BASE.r },
    slider: { dx: 0, dy: 0, r: SLIDER_BASE.r },
  };
}

// ---------- 消毒:坏档最坏退回默认,不许崩 ----------

const num = (v: unknown, d: number, lo: number, hi: number): number =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : d;
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const moveModeOf = (v: unknown, d: MoveMode): MoveMode =>
  v === "joystick" || v === "buttons" || v === "slider" ? v : d;
const replayModeOf = (v: unknown, d: ReplayMode): ReplayMode =>
  v === "off" || v === "matchpoint" || v === "all" ? v : d;

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
  s.replayMode = replayModeOf(r.replayMode, s.replayMode);
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
  // 老档升级(v<2):跳跃偏移原本是相对**右下角**的位移,现在基准在**左下角**,
  // 照原值套过去会飞到屏幕正中甚至屏外。半径与簇无关,保留用户调过的大小。
  // 不用「算距离判断是否越界」那套 —— 位移上限本来就夹在 ±240/±180,老值全都合法,
  // 只有簇变了这件事是数学上检测不出来的,必须靠版本号。
  if (typeof r.v !== "number" || r.v < 2) {
    s.pad.jump = { dx: 0, dy: 0, r: s.pad.jump.r };
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
  const sld = r.slider as Partial<PadBtn> | null | undefined;
  if (sld && typeof sld === "object") {
    s.slider = {
      dx: num(sld.dx, 0, -SLIDER_LIMIT.maxDx, SLIDER_LIMIT.maxDx),
      dy: num(sld.dy, 0, -SLIDER_LIMIT.maxDy, SLIDER_LIMIT.maxDy),
      r: num(sld.r, SLIDER_BASE.r, SLIDER_LIMIT.rMin, SLIDER_LIMIT.rMax),
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
  get replayMode(): ReplayMode { return this.v.replayMode; }
  get joystick(): PadBtn { return this.v.joystick; }
  get slider(): PadBtn { return this.v.slider; }

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

  /** 滑轨本体位/大小(独立存档) */
  setSlider(p: Partial<PadBtn>, persist = true): void {
    const cur = this.v.slider;
    if (p.dx !== undefined) cur.dx = clamp(p.dx, -SLIDER_LIMIT.maxDx, SLIDER_LIMIT.maxDx);
    if (p.dy !== undefined) cur.dy = clamp(p.dy, -SLIDER_LIMIT.maxDy, SLIDER_LIMIT.maxDy);
    if (p.r !== undefined) cur.r = clamp(p.r, SLIDER_LIMIT.rMin, SLIDER_LIMIT.rMax);
    this.after(persist);
  }

  /** 批量改布局(重置默认用)。只回位按钮半径,不动移动方式(用户偏好独立于布局) */
  resetPad(): void {
    const s = this.v;
    for (const a of PAD_ACTIONS) s.pad[a] = { dx: 0, dy: 0, r: PAD_BASE[a].r };
    s.padAlpha = 0.8;
    s.joystick = { dx: 0, dy: 0, r: JOYSTICK_BASE.r };
    s.slider = { dx: 0, dy: 0, r: SLIDER_BASE.r };
    this.after(true);
  }

  /**
   * 改声音/画面提示那批标量 + 移动方式。
   * persist=false 同 setPad:音量滑杆拖动时逐帧改内存、松手再 flush,
   * 原生 sys.localStorage.setItem 是同步文件 IO,不能跟着手指 60Hz 写盘。
   */
  setPart(p: Partial<Pick<GameSettings, "sfxOn" | "sfxVol" | "bgmOn" | "bgmVol" | "hintLanding" | "hintShake" | "hintFloat" | "hapticOn" | "padAlpha" | "moveMode" | "replayMode">>, persist = true): void {
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
    if (p.replayMode !== undefined) s.replayMode = replayModeOf(p.replayMode, s.replayMode);
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
