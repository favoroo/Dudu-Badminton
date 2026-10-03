// ============================================================
// 全局设置:唯一真值源。
//
// 为什么要有这一层:UI 拿不到 GameRoot 的私有 sfx/bgm(两套音频各有实例:
// GameRoot 一份、UIManager 一份,都往 Canvas 挂 AudioSource),渲染层也不该
// 回头问 UI。老做法是让 UI 去 `node.getComponents(AudioSource)` 扫一遍 ——
// 非递归,于是挂在子节点上的 6 个 BGM stem 从来没被静音过。现在改成
// 「谁用谁读 Settings」,真值只有一份,谁都够得着,不需要跨层摸私有字段。
//
// 为什么只 import ./utils 与 ./config(不碰 cc):tools/tsconfig.json 只编
// assets/scripts/core/**,这个文件要能在 node 下被 settings-check 直接跑 —— 滑轨的
// 对位几何也从这里出,这样「轨长 == 可达区间」能在回归里被断言住。
//
// 按键布局存的是「相对默认位的位移 dx/dy + 绝对半径 r」,不是屏幕绝对坐标:
// 设计分辨率是 FIXED_HEIGHT —— 高恒 540、宽随长宽比变(16:9 是 960,20:9 是
// 1080),再叠加左右刘海内缩,绝对坐标在 A 机调好到 B 机就出屏。控制簇靠
// Widget 吸附屏幕角落,簇内相对位移能同时穿越长宽比变化与安全区变化。
// ============================================================
import { clamp, load, save } from "./utils";
import { CFG } from "./config";

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
 * buttons 模式的左簇摆成「三角」:左右键并排在底部,跳键居中在两者正上方
 * (v3 前基准 (188,172) 偏在右键外侧,不居中),三键同半径 48。
 * 右簇上下对调(v3):击球抬到上排、跨步落到贴底的左下 —— 击球离拇指落点更近,
 * 跨步是低频救球键,挪到角落不碍事。
 */
export interface PadBase { x: number; y: number; r: number; cluster: "left" | "right" }
export const PAD_BASE: Record<PadAction, PadBase> = {
  left: { x: 50, y: 50, r: 48, cluster: "left" },
  right: { x: 162, y: 50, r: 48, cluster: "left" },
  // 跳键 x = 左右键中点 (50+162)/2,与两键各留 ~19 的空隙
  jump: { x: 106, y: 150, r: 48, cluster: "left" },
  // 合并后的单击球键:居中放大(r=46),方便手指在按下后横滑区分深浅
  swing: { x: -135, y: 140, r: 46, cluster: "right" },
  // 以下两键保留给键盘专用路径(触屏不再为它们建按钮),旧存档兼容用
  swingFar: { x: -48, y: 48, r: 38, cluster: "right" },
  swingNear: { x: -146, y: 48, r: 38, cluster: "right" },
  lunge: { x: -235, y: 50, r: 40, cluster: "right" },
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
 *   "slider"   —— 一条与左半场 1:1 对位的精准滑轨:轨就画在球场正下方,长度、水平
 *                 位置都和球员可达区间等长对齐,手指在哪人就在哪(见 railGeo);
 *                 支持**上滑跳跃**与**双击跳跃**。
 *   "buttons"  —— 老式「左 / 右」两个按钮,离散全速。
 *                 没摇杆可推,跳跃退回左簇那个实体键(PAD_BASE.jump)。
 * 默认 slider(0.0.24 起,用户指令:滑轨升为默认操作方式,新手引导也按滑轨教);
 * 老档 sanitize 时一并切到 slider(可在设置页切回,不打断谁都不如让新手第一眼学会)。
 */
export type MoveMode = "joystick" | "buttons" | "slider";

/**
 * 位移上限 PLACE_GUARD 只是**坏档护栏**,不是手感限制:能拖到哪儿由视口决定
 * (input/touchpad.ts 的 clampDelta —— 控件整块不许出可视区)。取 2000 设计像素,
 * 任何机型半屏都到不了这个量级,它拦的只有手改 JSON 传进来的离谱值。
 * 半径给一个手指可点又不至于糊屏的区间;透明度 0.05~1.0(1.0 = 完全不透明,
 * 下限 0.05:几乎隐形但冷却读数仍有 cdAlpha 的 keep 保底,重置默认随时可回 0.8)。
 */
export const PLACE_GUARD = 2000;
export const PAD_LIMIT = { rMin: 26, rMax: 72, maxDx: PLACE_GUARD, maxDy: PLACE_GUARD, alphaMin: 0.05, alphaMax: 1.0 };

/** 摇杆本体默认:底圈圆心在左簇内的位置(与 PAD_BASE.left 同参考系)+ 底圈半径 */
export const JOYSTICK_BASE = { x: 78, y: 78, r: 68 };

/** 摇杆半径可调范围,比普通按钮大一档;手指捏得住又不糊左半屏 */
export const JOYSTICK_LIMIT = { rMin: 46, rMax: 96, maxDx: PLACE_GUARD, maxDy: PLACE_GUARD };

/**
 * 滑轨本体默认。**没有 x,也没有 w** —— 这两样不再是自由量:
 * 轨是左半场在地面上的投影,长度与水平位置都由 railGeo() 从 CFG.court 算出来,
 * 一动就和脚下的场地线对不上,「手指在哪人就在哪」这个承诺也就没了。
 * 所以滑轨只保留两个可调量:高度 y(屏幕底边中点参考系,设计像素)与粗细 r。
 */
export const SLIDER_BASE = { y: 64, r: 28 };

/**
 * 滑轨可调范围;maxDx 恒 0 = 水平锁死(见 SLIDER_BASE 注释),只留上下挪与粗细。
 * 纵向不再预留「顶部记分牌带」—— 轨可以拖到屏幕任意高度,只有横向那一维由球场对位锁住。
 */
export const SLIDER_LIMIT = { rMin: 20, rMax: 44, maxDx: 0, maxDy: PLACE_GUARD };

/**
 * 滑轨 ↔ 球场对位几何:滑块中心的行程 = 左场球员的可达区间 [wallL, netX - netPad]。
 *
 * 为什么能一比一:设计分辨率是 FIXED_HEIGHT —— 高恒 540,世界层挂在 Canvas 中心
 * 且不做横向拉伸,所以「世界 x - world.w/2」就是屏幕中心往右的 UI 像素数,
 * 1 世界单位 = 1 UI 单位。于是把滑块行程取成可达区间的长度、轨心放在区间中点的
 * 正下方,手指在轨上挪多少像素,人就在地面上挪多少像素。
 *
 * 端点必须和 player.ts 的夹取同源(否则轨的端点指向人到不了的位置),所以这里读的是
 * 同一组 CFG.court 字段,不另抄数字。
 */
export function railGeo(): { minX: number; maxX: number; span: number; centerUiX: number } {
  const CO = CFG.court;
  const minX = CO.wallL;
  const maxX = CO.netX - CO.netPad;
  return {
    minX, maxX,
    span: maxX - minX,
    centerUiX: (minX + maxX) / 2 - CFG.world.w / 2,
  };
}

export interface PadBtn { dx: number; dy: number; r: number }

export interface GameSettings {
  v: number;
  // 两条总线独立开关(用户要的「音效/音乐分开」),音量各自 0..1
  sfxOn: boolean; sfxVol: number;
  bgmOn: boolean; bgmVol: number;
  // 画面提示:落点预测圈 / 屏幕震动 / 飘字
  hintLanding: boolean; hintShake: boolean; hintFloat: boolean;
  // 触觉反馈:特殊击打/技能/得分的震动总闸(移动端,Web 是空操作)
  hapticOn: boolean;
  /**
   * 震动强度档 id(取值 = CFG.haptic.levels[*].id)。与 paceTier 同一套语义:
   * 存 id 不存下标也不存系数,缺字段/认不出都退 CFG.haptic.default。
   * hapticOn 只管"震不震",这一档管"震得多狠" —— 两个旋钮不合并,
   * 因为「关掉触觉」和「嫌太轻」是两件不同的事(后者要能当场试出来)。
   */
  hapticLevel: string;
  // 按钮整体透明度(0.2~1.0,1.0 = 完全不透明)—— 全局一条,不逐键独立
  padAlpha: number;
  pad: Record<PadAction, PadBtn>;
  /** 触屏移动方式:滑轨 or 摇杆 or 左右按键。默认 slider(新手引导按滑轨教),老档 sanitize 一并迁到 slider */
  moveMode: MoveMode;
  /**
   * 球速档位 id(取值 = CFG.pace.tiers[*].id,不存索引也不存系数:插档不会让老存档指错)。
   * 这里只存偏好,真正生效的是 core/pace.ts —— game-root 启动时 apply,面板改档时 request,
   * 由 rules.beginPoint() 在下一球落地。缺字段/认不出都退回 CFG.pace.default。
   */
  paceTier: string;
  /**
   * 人物移速档位 id(取值 = CFG.gait.tiers[*].id)。与球速档分开给,是因为两摊账互相补偿:
   * 球速档调「留给玩家几帧」,这一档调「这几帧里能覆盖多少地面」。即时生效,不等下一球。
   */
  gaitTier: string;
  /** 摇杆本体的位/大小:dx/dy 相对 JOYSTICK_BASE,r = 底圈半径(渲染时再乘设备 scale) */
  joystick: PadBtn;
  /** 滑轨本体的可调量:dy = 相对 SLIDER_BASE.y 的高度差(参考系是屏幕底边中点,不乘 scale);r = 底轨半高半径(渲染时乘设备 scale);dx 恒 0 —— 水平由球场对位锁死,见 SLIDER_BASE */
  slider: PadBtn;
}

const KEY = "settings";

function fresh(): GameSettings {
  const pad = {} as Record<PadAction, PadBtn>;
  for (const a of PAD_ACTIONS) pad[a] = { dx: 0, dy: 0, r: PAD_BASE[a].r };
  return {
    // v=2:「跳」从右簇键改成摇杆上推代跳,键位退化为 buttons 模式回退并搬到左簇。
    // v=3:默认布局整体重排(跳居中到左右键上方、右簇击球/跨步上下对调),
    //     旧偏移由 sanitize 全量重置(新装机走 fresh 的默认位,不触发)。
    v: 3,
    sfxOn: true, sfxVol: 0.8,
    bgmOn: true, bgmVol: 0.6,
    hintLanding: true, hintShake: true, hintFloat: true,
    hapticOn: true,
    hapticLevel: CFG.haptic.default,
    padAlpha: 0.8,
    pad,
    moveMode: "slider",
    paceTier: CFG.pace.default,
    gaitTier: CFG.gait.default,
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
// 球速档位:只认表里存在的 id(表在 config.pace.tiers),认不出退默认。
// 不 import pace.ts —— 这个模块刻意只依赖 utils+config,好让 tools/settings-check.ts
// 能在 node 下直接造实例跑断言。
const paceTierOf = (v: unknown, d: string): string =>
  typeof v === "string" && CFG.pace.tiers.some((t) => t.id === v) ? v : d;
const gaitTierOf = (v: unknown, d: string): string =>
  typeof v === "string" && CFG.gait.tiers.some((t) => t.id === v) ? v : d;
// 震动强度档:同样只认 config.haptic.levels 表里的 id
const hapticLevelOf = (v: unknown, d: string): string =>
  typeof v === "string" && CFG.haptic.levels.some((l) => l.id === v) ? v : d;

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
  // 手改存档写了个不存在的强度档 → 保持默认,不带病下发反射调用
  s.hapticLevel = hapticLevelOf(r.hapticLevel, s.hapticLevel);
  s.padAlpha = num(r.padAlpha, s.padAlpha, PAD_LIMIT.alphaMin, PAD_LIMIT.alphaMax);
  // 球速档位:老存档没这个键 → 直接吃到 CFG.pace.default(出货默认比上一版慢 8%)。
  // 这就是「老玩家也自动吃新默认」的落点,不需要版本号。
  s.paceTier = paceTierOf(r.paceTier, s.paceTier);
  s.gaitTier = gaitTierOf(r.gaitTier, s.gaitTier);
  const pad = r.pad as Record<string, Partial<PadBtn>> | null | undefined;
  if (pad && typeof pad === "object") {
    for (const a of PAD_ACTIONS) {
      const p = pad[a];
      if (!p || typeof p !== "object") continue;
      s.pad[a] = {
        dx: num(p.dx, 0, -PAD_LIMIT.maxDx, PAD_LIMIT.maxDx),
        dy: num(p.dy, 0, -PAD_LIMIT.maxDy, PAD_LIMIT.maxDy),
        r: num(p.r, PAD_BASE[a].r, PAD_LIMIT.rMin, PAD_LIMIT.rMax),
      };
    }
  }
  // 老档升级(v<2):跳跃偏移原本是相对**右下角**的位移,现在基准在**左下角**。
  // 老档升级(v<3):默认布局整体重排(跳居中到左右键上方、右簇击球/跨步上下对调),
  // 存档里的 dx/dy 是相对旧基准的位移,套到新基准上会把布局弄歪 —— 全部重置。
  // 半径与基准无关,保留用户调过的大小。
  // 不用「算距离判断是否越界」那套 —— 位移上限只是坏档护栏(PLACE_GUARD,视口到不了),
  // 老值全都合法,只有「簇/基准变了」这件事是数学上检测不出来的,必须靠版本号。
  if (typeof r.v !== "number" || r.v < 3) {
    for (const a of PAD_ACTIONS) s.pad[a] = { dx: 0, dy: 0, r: s.pad[a].r };
  }
  // 老档升级:raw 里带 pad 却没有 moveMode → 摇杆功能上线前的老玩家。
  // 0.0.24 起一并迁到 slider(用户指令:滑轨升为默认操作方式,新手引导也按滑轨教);
  // 想回摇杆/按键,设置页「操控」随时可切 —— 迁移只动默认值,不锁选择。
  s.moveMode = moveModeOf(r.moveMode, "slider");
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
  get hapticLevel(): string { return this.v.hapticLevel; }
  get padAlpha(): number { return this.v.padAlpha; }
  get moveMode(): MoveMode { return this.v.moveMode; }
  get paceTier(): string { return this.v.paceTier; }
  get gaitTier(): string { return this.v.gaitTier; }
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
  setPart(p: Partial<Pick<GameSettings, "sfxOn" | "sfxVol" | "bgmOn" | "bgmVol" | "hintLanding" | "hintShake" | "hintFloat" | "hapticOn" | "hapticLevel" | "padAlpha" | "moveMode" | "paceTier" | "gaitTier">>, persist = true): void {
    const s = this.v;
    if (p.sfxOn !== undefined) s.sfxOn = bool(p.sfxOn, s.sfxOn);
    if (p.sfxVol !== undefined) s.sfxVol = num(p.sfxVol, s.sfxVol, 0, 1);
    if (p.bgmOn !== undefined) s.bgmOn = bool(p.bgmOn, s.bgmOn);
    if (p.bgmVol !== undefined) s.bgmVol = num(p.bgmVol, s.bgmVol, 0, 1);
    if (p.hintLanding !== undefined) s.hintLanding = bool(p.hintLanding, s.hintLanding);
    if (p.hintShake !== undefined) s.hintShake = bool(p.hintShake, s.hintShake);
    if (p.hintFloat !== undefined) s.hintFloat = bool(p.hintFloat, s.hintFloat);
    if (p.hapticOn !== undefined) s.hapticOn = bool(p.hapticOn, s.hapticOn);
    if (p.hapticLevel !== undefined) s.hapticLevel = hapticLevelOf(p.hapticLevel, s.hapticLevel);
    if (p.padAlpha !== undefined) s.padAlpha = num(p.padAlpha, s.padAlpha, PAD_LIMIT.alphaMin, PAD_LIMIT.alphaMax);
    if (p.moveMode !== undefined) s.moveMode = moveModeOf(p.moveMode, s.moveMode);
    if (p.paceTier !== undefined) s.paceTier = paceTierOf(p.paceTier, s.paceTier);
    if (p.gaitTier !== undefined) s.gaitTier = gaitTierOf(p.gaitTier, s.gaitTier);
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
