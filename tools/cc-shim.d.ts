// ============================================================
// 临时 cc 模块声明 —— 仅供 CLI 下 `npx tsc` 校验 assets/scripts 全部代码,
// 项目尚未被 Cocos Creator 打开、还没有 temp/declarations/cc.d.ts 时兜底。
// 签名按 cocos-engine v3.8 源码抄写,要点:
//   * ellipse(cx,cy,rx,ry) 参数是「半径」;
//   * fill()/stroke() 只消费自上次 stroke/fill 后新增的路径(同 canvas beginPath 语义);
//   * arc 的扫向与 canvas 相反(sprites.ts 因此全部自采样,不直接用它);
//   * KeyCode 的值就是浏览器 KeyboardEvent.code 字符串('KeyA' 等)。
// 【注意】本文件在 tools/ 下、不在 assets/ 里,编辑器不会导入它;
// 打开工程生成正式 cc 类型后,本文件仅服务 tools/tsconfig.check.json。
// ============================================================
declare module "cc" {
  export enum LineCap { BUTT = "butt", ROUND = "round", SQUARE = "square" }
  export enum LineJoin { BEVEL = "bevel", ROUND = "round", MITER = "miter" }
  export enum KeyCode {
    NONE = 0,
    KEY_A = 65, KEY_B = 66, KEY_D = 68, KEY_W = 87, KEY_S = 83,
    KEY_J = 74, KEY_K = 75, KEY_L = 76, KEY_M = 77, KEY_P = 80,
    KEY_R = 82, KEY_Q = 81, KEY_Z = 90, KEY_X = 88,
    COMMA = 188, PERIOD = 190, SLASH = 191,
    ESCAPE = 27, SPACE = 32, ENTER = 13,
    ARROW_LEFT = 37, ARROW_UP = 38, ARROW_RIGHT = 39, ARROW_DOWN = 40,
  }

  export class Color {
    constructor(r?: number | string, g?: number, b?: number, a?: number);
    r: number; g: number; b: number; a: number;
    /** 十六进制串(#rgb/#rrggbb/#rrggbbaa)→ 本实例;返回 this 便于链式 */
    fromHEX(hexString: string): this;
  }

  export interface Vec3 { x: number; y: number; z: number }
  export const Vec3: { new(x?: number, y?: number, z?: number): Vec3 };

  export interface Vec2 { x: number; y: number }
  export const Vec2: { new(x?: number, y?: number): Vec2 };

  export function v3(x?: number, y?: number, z?: number): Vec3;
  export function v3(out: Vec3, x?: number, y?: number, z?: number): Vec3;

  /** 触摸事件:getUILocation 是设计分辨率下的 UI 坐标(与节点坐标同一单位) */
  export interface EventTouch {
    getID(): number;
    getUILocation(out?: Vec2): Vec2;
    getLocation(out?: Vec2): Vec2;
    getTarget(): Node;
    getCurrentTarget(): Node;
    preventDefault(): void;
  }
  export const EventTouch: { new(): EventTouch };

  export class Graphics extends Component {
    static LineCap: typeof LineCap;
    static LineJoin: typeof LineJoin;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
    arc(cx: number, cy: number, r: number, a0: number, a1: number, counterclockwise?: boolean): void;
    circle(x: number, y: number, r: number): void;
    ellipse(x: number, y: number, rx: number, ry: number): void;
    rect(x: number, y: number, w: number, h: number): void;
    roundRect(x: number, y: number, w: number, h: number, r: number): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    close(): void;
    fill(): void;
    stroke(): void;
    clear(): void;
    lineWidth: number;
    lineCap: LineCap;
    lineJoin: LineJoin;
    miterLimit: number;
    fillColor: Color;
    strokeColor: Color;
  }

  export class UITransform extends Component {
    setContentSize(w: number, h: number): void;
    setAnchorPoint(x: number, y: number): void;
    readonly contentSize: { width: number; height: number };
    readonly width: number;
    readonly height: number;
    anchorPoint: { x: number; y: number };
    /** 世界(UI)坐标 → 本节点锚点相对局部坐标;虚拟按键拖动用 */
    convertToNodeSpaceAR(worldPoint: Vec3, out?: Vec3): Vec3;
    /** 反向:局部 → 世界 */
    convertToWorldSpaceAR(localPoint: Vec3, out?: Vec3): Vec3;
  }
  export class Widget extends Component {
    isAlignTop: boolean; top: number;
    isAlignBottom: boolean; bottom: number;
    isAlignLeft: boolean; left: number;
    isAlignRight: boolean; right: number;
    /** 水平/垂直居中(滑轨的「屏幕底边中点」参考系用);引擎真类型里也是这两名 */
    isAlignHorizontalCenter: boolean; horizontalCenter: number;
    isAlignVerticalCenter: boolean; verticalCenter: number;
    updateAlignment(): void;
  }
  export class Label extends Component {
    string: string;
    fontSize: number;
    lineHeight: number;
    horizontalAlign: number;
    verticalAlign: number;
    color: Color;
    isBold: boolean;
    enableOutline: boolean;
    outlineColor: Color;
    outlineWidth: number;
    /** 阴影(hud/settle/main-menu 大字用) */
    enableShadow: boolean;
    shadowColor: Color;
    shadowOffset: Vec2;
    overflow: number;
    /** 子集化标题字体(uiLabel disp 选项挂 dudu-display 用) */
    font: Font | null;
    useSystemFont: boolean;
  }
  /** 字体资源(resources.load("fonts/dudu-display") 的产物;仅类型兜底) */
  export class Font {
    name: string;
    isValid: boolean;
  }
  export namespace Label {
    export enum Overflow { NONE = 0, CLAMP = 1, SHRINK = 2, RESIZE_HEIGHT = 3 }
    export enum HorizontalAlign { LEFT = 0, CENTER = 1, RIGHT = 2 }
    export enum VerticalAlign { TOP = 0, CENTER = 1, BOTTOM = 2 }
  }
  export class UIOpacity extends Component { opacity: number }
  export class AudioClip { name: string }
  export enum AudioSourceState {
    INVALID = 0,
    INIT_STATE = 1,
    PLAYING = 2,
    PAUSED = 3,
    STOPPED = 4,
  }
  export class AudioSource {
    clip: AudioClip | null;
    loop: boolean;
    volume: number;
    /** 总静音开关(不影响 playOneShot 的相对音量) */
    mute: boolean;
    state: AudioSourceState;
    play(): void;
    stop(): void;
    pause(): void;
    playOneShot(clip: AudioClip, volume?: number): void;
  }

  export namespace Layers {
    export enum Enum {
      DEFAULT = 1073741824,
      UI_2D = 33554432,
    }
  }

  export class Node {
    constructor(name?: string);
    readonly name: string;
    layer: number;
    position: Readonly<Vec3>;
    setPosition(x: number, y: number, z?: number): void;
    getPosition(out?: Vec3): Vec3;
    setParent(parent: Node | null): void;
    getParent(): Node | null;
    addComponent<T>(type: { new(): T }): T;
    getComponent<T>(type: { new(): T }): T | null;
    getComponents<T>(type: { new(): T }): T[];
    /** 递归查找自身+所有子孙节点上挂的同类型组件(真实引擎同名 API 的兜底声明) */
    getComponentsInChildren<T>(type: { new(): T }): T[];
    /**
     * 事件回调参数放宽成 any[]:真实 cc 类型里 TOUCH_START/MOVE 等回调是 EventTouch,
     * 写成 never[] 会让 handler 里的 e.getUILocation() 报 TS2339(编辑器外检查与引擎不符)。
     */
    on(type: string, cb: (...args: any[]) => void, target?: unknown): void;
    off(type: string, cb?: (...args: any[]) => void, target?: unknown): void;
    /** 按名字找直接子节点 */
    getChildByName(name: string): Node | null;
    removeFromParent(): void;
    removeAllChildren(): void;
    readonly children: Node[];
    readonly parent: Node | null;
    destroy(): boolean;
    active: boolean;
    /** 节点是否有效(未销毁);面板析构时防悬空 */
    readonly isValid: boolean;
    setScale(x: number, y: number, z?: number): void;
    /** 世界坐标(真实引擎同名 API 的兜底声明;touchpad 层级命中把键心转层坐标用) */
    readonly worldPosition: Readonly<Vec3>;
    /** 当前缩放(真实引擎同名 API 的兜底声明) */
    readonly scale: Readonly<Vec3>;
    /** 3.x 保留 API,等价 setParent */
    addChild(child: Node): void;
    /** 3.x 保留 API:插入到指定兄弟位(arcade 面板把底块垫到最底用) */
    insertChild(child: Node, siblingIndex: number): void;
    setSiblingIndex(index: number): void;
    getSiblingIndex(): number;
    /** 2D 旋转角(度,settle 面板飘字/徽章用) */
    angle: number;
  }
  export namespace Node {
    export const EventType: {
      TOUCH_START: string;
      TOUCH_MOVE: string;
      TOUCH_END: string;
      TOUCH_CANCEL: string;
    };
  }

  // ---------- UI 流程层所需(阶段 3) ----------

  export class Button extends Component {
    transition: number;
    zoomScale: number;
    interactable: boolean;
    target: Node | null;
  }
  export namespace Button {
    export enum Transition { NONE = 0, COLOR = 1, SPRITE = 2, SCALE = 3 }
    export const EventType: { CLICK: string };
  }

  /** 挡住触摸穿透到下层节点(全屏遮罩用) */
  export class BlockInputEvents extends Component {}

  /**
   * 矩形/图形裁罩(更新弹窗的日志滚动区用)。
   * 真机上 GRAPHICS_RECT 会自造一个 Graphics 画 contentSize 大小的矩形写模板缓冲,
   * 所以只要 contentSize 对了就裁得对,调用方不必自己画。
   */
  export class Mask extends Component {
    static Type: typeof MaskType;
    type: MaskType;
    inverted: boolean;
    segments: number;
    alphaThreshold: number;
  }
  export enum MaskType {
    GRAPHICS_RECT = 0,
    GRAPHICS_ELLIPSE = 1,
    GRAPHICS_STENCIL = 2,
    SPRITE_STENCIL = 3,
  }

  export class Tween<T = unknown> {
    to(time: number, props: Record<string, number | Vec3>, opts?: { easing?: string }): Tween<T>;
    delay(time: number): Tween<T>;
    call(cb: () => void): Tween<T>;
    union(): Tween<T>;
    repeatForever(): Tween<T>;
    start(): Tween<T>;
    stop(): Tween<T>;
    static stopAllByTarget(target: unknown): void;
  }
  export function tween<T>(target: T): Tween<T>;

  export class Scene extends Node {}
  export const director: {
    getScene(): Scene | null;
    once(type: string, cb: () => void): void;
  };
  export const Director: { EVENT_AFTER_SCENE_LAUNCH: string };

  export class EventKeyboard {
    keyCode: KeyCode;
    /** 3.8 推荐:浏览器 KeyboardEvent.code 字符串('KeyA' 等) */
    code: string;
    rawEvent?: unknown;
  }
  export class Input {}
  export namespace Input {
    export enum EventType {
      KEY_DOWN = "keydown",
      KEY_UP = "keyup",
    }
  }
  export const input: {
    on(type: string | Input.EventType, cb: (e: EventKeyboard) => void, target?: unknown): void;
    off(type: string | Input.EventType, cb?: (e: EventKeyboard) => void, target?: unknown): void;
  };
  export const resources: {
    loadDir(dir: string, type: { new(): AudioClip }, cb: (err: Error | null, clips: AudioClip[]) => void): void;
    /** 单资源加载(ui-arcade 挂 dudu-display 子集字体用) */
    load<T>(path: string, type: { new(): T }, cb: (err: Error | null, asset: T | null) => void): void;
  };

  // 阶段 2 旧式键盘监听(drill-panel 在用;3.8 中已废弃但仍然导出)
  export namespace SystemEventType {
    export const KEY_DOWN: string;
    export const KEY_UP: string;
  }
  export const systemEvent: {
    on(type: string, cb: (e: EventKeyboard) => void, target?: unknown): void;
    off(type: string, cb?: (e: EventKeyboard) => void, target?: unknown): void;
  };

  export class Component {
    node: Node;
    /** 组件开关(真实引擎同名属性):批量禁用 BlockInputEvents 等场景用 */
    enabled: boolean;
    /** 对象有效性(CCObject.isValid):tween 回调里防悬空 */
    isValid: boolean;
    /** 生命周期按需覆写;shim 只声明可选签名供子类覆写 */
    onLoad?(): void;
    start?(): void;
    update?(dt: number): void;
    onDestroy?(): void;
  }
  export const _decorator: { ccclass(name?: string): ClassDecorator };

  export namespace sys {
    export const isNative: boolean;
    export const isBrowser: boolean;
    export const platform: number;
    export const os: string;
    export enum Platform {
      ANDROID = 1,
      IOS = 2,
      WIN32 = 3,
      MACOS = 4,
    }
    export const OS: {
      ANDROID: string;
      IOS: string;
      OSX: string;
      WINDOWS: string;
      LINUX: string;
    };
    export const localStorage: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      removeItem(key: string): void;
      clear(): void;
    };
    export function openURL(url: string): void;
    export function getSafeAreaRect(symmetric?: boolean): { x: number; y: number; width: number; height: number };
  }

  export enum ResolutionPolicy {
    EXACT_FIT = 0,
    NO_BORDER = 1,
    SHOW_ALL = 2,
    FIXED_HEIGHT = 3,
    FIXED_WIDTH = 4,
    UNKNOWN = 5,
  }

  export const profiler: {
    showStats(): void;
    hideStats(): void;
    isShowingStats(): boolean;
  };

  export const view: {
    getVisibleSize(): { width: number; height: number };
    getDesignResolutionSize(): { width: number; height: number };
    setDesignResolutionSize(width: number, height: number, resolutionPolicy: ResolutionPolicy | number): void;
  };

  export namespace native {
    export namespace reflection {
      export function callStaticMethod(className: string, methodName: string, methodSignature: string, ...parameters: any[]): any;
    }
    export namespace fileUtils {
      export function getWritablePath(): string;
      export function writeDataToFile(data: Uint8Array, fullPath: string): boolean;
      export function isFileExist(fullPath: string): boolean;
      export function removeFile(fullPath: string): boolean;
    }
  }
}
