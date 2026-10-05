// ============================================================
// 面板脚手架:四个面板(设置 / 闯关大厅 / 训练场 / 商店)共用的「一块能点的色块」。
//
// 为什么要这一层 —— 首页与对练屏的大色块是各自在文件里手搓的:main-menu 有个
// `block()` 闭包,mode-screen 有 `pressable()` + `solidBlock()` 两个 protected 方法,
// 而 campaign / career / drill 三个面板又各自抄了 mkNode + 圆角矩形。
// 同一个「斜切实底块 + 按压反馈」在五个地方长得不完全一样,改风格要跑五处。
// 这里收成一份工厂,mode-screen 反过来委托它(它那两个方法是本文件的原型)。
//
// ⚠ 一条引擎硬约束(闸门见 tools/ui-click-check.ts):
//   `Button.EventType.CLICK` 只由 `Button._onTouchEnded` 派发,而 TOUCH_* 监听也只由
//   `Button._registerNodeEvent` 注册 —— 一个只有 UITransform + Graphics 的节点即便
//   `on(Button.EventType.CLICK)` 也**进不了引擎的命中判定**:既不响,也不吞触摸。
//   症状很挑:同屏装了 Button 的块全好,唯独漏挂的那一排死。
//   所以本文件所有可点工厂一律自己 addComponent(Button),调用点不需要(也不允许)记得。
//
// 依赖纪律:只 import cc 与 ui-arcade / p5-*。不 import ui-manager ——
// 面板经 UiKit 拿东西,反手 import 会成环(与 widgets.ts 同一条规矩)。
// ============================================================
import { Button, Component, Graphics, Label, Node, UITransform } from "cc";
import type { Role } from "./p5-tokens";
import { C, SLANT, inkFor } from "./p5-tokens";
import {
  ac, drawBevelSlot, drawHalftone, drawP5Block, drawPosterPlate, mkLabel,
  retainedDraw, type HalftoneOpts, type PlateOpts,
} from "./ui-arcade";

/** 建一个 UI 节点:layer 跟父级走(裸 Node 默认 DEFAULT 层,UI 相机照不到) */
export function uinode(name: string, parent: Node, w: number, h: number): Node {
  const n = new Node(name);
  n.layer = parent.layer;
  n.addComponent(UITransform).setContentSize(w, h);
  n.setParent(parent);
  return n;
}

/**
 * 给手绘节点补上真按钮。zoomScale 是「按下去缩多少」,0.94~0.96 之间取。
 * 单独导出是因为有些节点在别处已经画好了底,只缺这一环。
 */
export function pressable(n: Node, zoom = 0.96): Node {
  const b = n.addComponent(Button);
  b.transition = Button.Transition.SCALE;
  b.zoomScale = zoom;
  b.target = n;
  return n;
}

/** 挂个 CLICK:声音由调用方决定(面板各自的 kit.sfx),这里只保证「点得动」 */
export function onTap(n: Node, cb: () => void): Node {
  n.on(Button.EventType.CLICK, cb);
  return n;
}

/** 面板衬纸:一张撕下来的黑纸垫在 accent 色纸上(L1) */
export function posterPlate(name: string, parent: Node, w: number, h: number, o: PlateOpts = {}): Graphics {
  const g = uinode(name, parent, w, h).addComponent(Graphics);
  return retainedDraw(g, () => drawPosterPlate(g, w, h, o));
}

/**
 * 网点层:预算敏感,返回画了多少点,调用方要能看见这个数
 * (红线在 p5-tokens.HALFTONE.maxDots,由 tools/panel-check.ts 钉住)。
 */
export function halftoneLayer(name: string, parent: Node, w: number, h: number, o: HalftoneOpts = {}): number {
  const g = uinode(name, parent, w, h).addComponent(Graphics);
  let count = 0;
  retainedDraw(g, () => { count = drawHalftone(g, w, h, o); });
  return count;
}

/** 实底大色块(L3):自带 Button,返回节点供补 Label / 角签 */
export function solidBlock(name: string, parent: Node, w: number, h: number, accent: string, slantDeg = SLANT.block): Node {
  const n = uinode(name, parent, w, h);
  drawP5Block(n.addComponent(Graphics), w, h, accent, slantDeg);
  return pressable(n, 0.96);
}

/** 按状态重画一块底:保留型画布唯一安全的改法是 clear + 重画 */
export function repaint(g: Graphics, draw: () => void): void {
  g.clear();
  draw();
}

/**
 * 容器整树清空:children 先 slice 再逐个 destroy —— `removeAllChildren()`/`removeFromParent()`
 * 只是**摘下来**不打断销毁,那些画过一次的 Graphics 会飘在场景外占着渲染数据
 * (切页重建两轮就翻一倍)。凡「清空重来」的容器一律走这里,别手写摘除。
 */
export function clearKids(n: Node): void {
  for (const c of n.children.slice()) c.destroy();
}

export interface TabSpec {
  name: string;
  label: string;
  parent: Node;
  w: number;
  h: number;
  /** 选中态的角色色,默认 primary(斩劈红) */
  role?: Role;
  /** 字号,默认 14 */
  size?: number;
  /** 选中态要不要下缘撕纸齿 */
  tear?: boolean;
}

export interface TabHandle {
  node: Node;
  label: Label;
  /** 切选中态:选中 = 整面实底色块 + inkFor 字色;未选 = 凹陷槽 + dim 字 */
  paint(sel: boolean): void;
}

/**
 * 分段选择器的一格(tab / 摇杆滑轨按键 / 皮肤分类)。
 * 旧写法是「圆角矩形 + 一条 5% 白描边」,未选中态在深色面板上只有 1.1:1 ——
 * 读起来不像「能点但没点」,像「坏了」。现在未选中走凹陷槽:没有描边,靠上下缘的
 * 压暗/接光读出一个「凹」字,与选中态的「凸」正好成对。
 */
export function solidTab(spec: TabSpec): TabHandle {
  const n = uinode(spec.name, spec.parent, spec.w, spec.h);
  const g = n.addComponent(Graphics);
  const face = C[ROLE_FACE[spec.role ?? "primary"]];
  const label = mkLabel(n, "txt", spec.label, spec.size ?? 14, C.paper, {
    w: spec.w, align: 1, anchor: "center",
  });
  pressable(n, 0.94);
  const paint = (sel: boolean): void => {
    repaint(g, () => {
      if (sel) {
        drawP5Block(g, spec.w, spec.h, face, SLANT.block);
        if (spec.tear) {
          // 选中态下缘撕三齿:tab 是「撕下来的一张纸」,压在没撕的那叠上面
          for (const t of [0, 1, 2]) {
            const x = -spec.w / 2 + spec.w * (0.3 + t * 0.2);
            g.fillColor = ac(face, 0.97);
            g.moveTo(x, -spec.h / 2);
            g.lineTo(x + spec.w * 0.06, -spec.h / 2 - 5);
            g.lineTo(x + spec.w * 0.12, -spec.h / 2);
            g.close();
            g.fill();
          }
        }
      } else {
        drawBevelSlot(g, spec.w, spec.h, SLANT.block);
      }
    });
    label.color = ac(sel ? inkFor(face) : C.dim);
  };
  return { node: n, label, paint };
}

/** role → 色键(在 p5-tokens.ROLE 里查,这里只是省掉调用方的 .face 一跳) */
const ROLE_FACE: Record<Role, keyof typeof C> = {
  primary: "slash", star: "acid", drill: "good", info: "cyan", record: "paper", power: "hot", off: "navy2",
};

/** 一个角色该用的面色 */
export function faceOf(role: Role): string {
  return C[ROLE_FACE[role]];
}

/** 该角色面上的字色 */
export function textOf(role: Role): string {
  return inkFor(faceOf(role));
}

/**
 * 小节标题(L2 分区色带):整面 accent 实底 + 墨黑字,左锚。
 * 旧写法是一行荧光黄裸文字 —— P5 里没有「裸排飘字」这回事,标题得占住一块色。
 */
export function sectionTitle(name: string, parent: Node, text: string, role: Role, w: number, h = 24, size = 14): Node {
  const n = uinode(name, parent, w, h);
  const face = faceOf(role);
  drawP5Block(n.addComponent(Graphics), w, h, face, SLANT.band);
  mkLabel(n, "txt", text, size, inkFor(face), { align: 0, anchor: "align", x: -w / 2 + 10, w: w - 16 });
  return n;
}

/** 凹陷槽:经验槽、轨道、锁定态底 */
export function bevelSlot(name: string, parent: Node, w: number, h: number, face?: string): Graphics {
  const g = uinode(name, parent, w, h).addComponent(Graphics);
  drawBevelSlot(g, w, h, SLANT.block, face);
  return g;
}

/** 供组件内使用的 mixin 式基类:面板已经 extends Component,只能靠组合 */
export interface Shell {
  node(name: string, w: number, h: number): Node;
  block(name: string, w: number, h: number, accent: string, slantDeg?: number): Node;
  tab(spec: Omit<TabSpec, "parent">): TabHandle;
  title(name: string, text: string, role: Role, w: number, h?: number, size?: number): Node;
}

/** 绑一个面板根节点,拿到一套不用每次传 parent 的工厂 */
export function makeShell(root: Node): Shell {
  return {
    node: (name, w, h) => uinode(name, root, w, h),
    block: (name, w, h, accent, slantDeg) => solidBlock(name, root, w, h, accent, slantDeg ?? SLANT.block),
    tab: (spec) => solidTab({ ...spec, parent: root }),
    title: (name, text, role, w, h, size) => sectionTitle(name, root, text, role, w, h ?? 24, size ?? 14),
  };
}

/** 让 Component 也能顺手拿到(面板都是 Component,没有共同基类可继承) */
export function shellOf(c: Component): Shell {
  return makeShell(c.node);
}
