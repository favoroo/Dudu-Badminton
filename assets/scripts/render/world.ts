// ============================================================
// 世界渲染层:视口变换 + 每帧重绘(角色/羽毛球/拖尾/飘字) + 镜头震动。
// Cocos Graphics 是保留式几何,这里采用「每帧 clear + 全量重绘」——
// 与老 canvas 全帧重绘同构,元素量级(两人一球)毫无压力。
// 渲染层只读游戏状态,不改任何逻辑字段。
// ============================================================
import { Color, Graphics, Label, Layers, Node, UIOpacity, UITransform } from "cc";
import { CFG } from "../core/config";
import { lerp, clamp } from "../core/utils";
import { Ball, GameEvent, Player, SkinDef } from "../core/types";
import { drawPlayer, drawShuttle } from "./sprites";
import { courtRenderer, CourtThemeItem } from "./court";
import { FXSystem } from "./fx";

const C = CFG;

/** 世界坐标(canvas,y 向下,0..960/540)→ Graphics 本地坐标(居中原点,y 向上) */
export interface Viewport {
  x(wx: number): number;
  y(wy: number): number;
}

function makeViewport(): Viewport {
  return {
    x: (wx: number) => wx - C.world.w / 2,
    y: (wy: number) => C.world.h / 2 - wy,
  };
}

interface FloatText {
  node: Node;
  opacity: UIOpacity;
  life: number;
  maxLife: number;
  vy: number;
}

interface TrailDot { x: number; y: number; life: number; sweet: boolean }

export class WorldView {
  readonly root: Node;          // 受震屏/镜头冲击影响的容器
  private courtGfx: Graphics;
  private g: Graphics;
  private vp: Viewport;
  private floatLayer: Node;
  private floats: FloatText[] = [];
  private trail: TrailDot[] = [];
  readonly fx = new FXSystem(); // 完整打击特效与粒子系统
  shakeX = 0;
  private shakeAmt = 0;
  frameT = 0;

  constructor(parent: Node) {
    this.vp = makeViewport();
    this.root = new Node("world");
    this.root.layer = Layers.Enum.UI_2D;
    this.root.addComponent(UITransform);
    this.root.setPosition(0, C.view.offsetY, 0);   // 整体抬高:地面线上移,底部让出虚拟按键带
    this.root.setParent(parent);

    // 球场多主题层(支持动态元素与晃网重绘)
    const bg = new Node("court-bg");
    bg.layer = Layers.Enum.UI_2D;
    bg.addComponent(UITransform);
    bg.setParent(this.root);
    this.courtGfx = bg.addComponent(Graphics);
    courtRenderer.draw(this.courtGfx, this.vp);

    // 动态层:每帧重绘(球员、羽毛球、特效粒子)
    const dyn = new Node("dyn");
    dyn.layer = Layers.Enum.UI_2D;
    dyn.addComponent(UITransform);
    dyn.setParent(this.root);
    this.g = dyn.addComponent(Graphics);

    // 飘字层:位于最上,不参与 clear
    this.floatLayer = new Node("floats");
    this.floatLayer.layer = Layers.Enum.UI_2D;
    this.floatLayer.addComponent(UITransform);
    this.floatLayer.setParent(this.root);
  }

  // ---------- 球场主题与触网物理 ----------
  hitNet(hitY?: number, power = 1.0): void {
    courtRenderer.hitNet(hitY, power);
  }

  cycleCourtTheme(): CourtThemeItem {
    const t = courtRenderer.cycleTheme();
    this.redrawCourt();
    return t;
  }

  setCourtTheme(themeId: string): boolean {
    const ok = courtRenderer.setTheme(themeId);
    if (ok) this.redrawCourt();
    return ok;
  }

  getCourtTheme(): CourtThemeItem {
    return courtRenderer.getTheme();
  }

  private redrawCourt(rallyCount = 0): void {
    this.courtGfx.clear();
    courtRenderer.draw(this.courtGfx, this.vp, rallyCount);
  }

  // ---------- rules.setTrailHook 的落点 ----------
  pushTrail(b: Ball): void {
    const sweet = !!(b.shot && (b.shot.sweet || b.shot.perfect));
    this.trail.push({ x: b.x, y: b.y, life: sweet ? C.fx.trailSweetLen : C.fx.trailLen, sweet });
  }

  shake(amt: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amt);
  }

  /** 事件驱动的飘字(老 FX.float 的精简版:上浮 + 淡出) */
  float(wx: number, wy: number, text: string, color: string, size: number, life: number, vy = -1): void {
    const node = new Node("float");
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform);
    node.setPosition(this.vp.x(wx), this.vp.y(wy), 0);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = Math.round(size * 1.15);
    label.color = color.startsWith("#") ? new Color().fromHEX(color) : new Color(255, 255, 255, 255);
    const opacity = node.addComponent(UIOpacity);
    node.setParent(this.floatLayer);
    this.floats.push({ node, opacity, life, maxLife: life, vy: vy || -1 });
  }

  /** 每模拟步推进(寿命计数,帧率无关) */
  stepFx(dt = 1 / 60): void {
    this.shakeAmt *= 0.85;
    this.shakeX = this.shakeAmt > 0.3 ? (Math.random() * 2 - 1) * this.shakeAmt : 0;
    for (const f of this.floats) f.life--;
    this.floats = this.floats.filter((f) => f.life > 0);
    for (const t of this.trail) t.life--;
    this.trail = this.trail.filter((t) => t.life > 0);

    // 推进球场动态(海浪、观众微动、落花、晃网)与 FX 特效粒子
    courtRenderer.step(dt);
    this.fx.step(dt);
  }

  /**
   * 每渲染帧:插值 + 全量重绘。
   * animT 由胶水层决定:比赛进行中用世界时钟(hitstop 时身体彻底不动),
   * 面板/暂停态用帧时钟兜底维持呼吸 —— 与老 game.js render() 同一约定。
   */
  render(players: Player[], ball: Ball | null, alpha: number, animT: number, skin: SkinDef | null, rallyCount = 0): void {
    this.frameT++;
    const g = this.g;
    g.clear();
    this.root.setPosition(this.shakeX, C.view.offsetY, 0);

    // 动态球场重绘(包含球网弹性晃动、看台荧光棒、海浪、霓虹粒子等)
    this.redrawCourt(rallyCount);

    // 插值:120Hz 屏也不见阶梯;离网远的先画,近网压前(与老 render 同序)
    const order = players.slice().sort(
      (a, b) => Math.abs(C.court.netX - b.x) - Math.abs(C.court.netX - a.x));
    for (const p of order) {
      const rx = lerp(p.px, p.x, alpha);
      const ry = lerp(p.py, p.y, alpha);
      drawPlayer(g, this.vp, { ...p, x: rx, y: ry }, animT, alpha, ball);
    }

    // 羽毛球 + 拖尾(甜蜜/完美更长更亮)
    if (ball && (ball.live || ball.held)) {
      const bx = ball.held ? ball.x : lerp(ball.px, ball.x, alpha);
      const by = ball.held ? ball.y : lerp(ball.py, ball.y, alpha);
      // sqR:形变的帧间插值(drawShuttle 无 alpha 参数,渲染前补进副本)
      const sqR = lerp(ball.sqPrev ?? ball.sq, ball.sq ?? 1, alpha);
      for (const t of this.trail) {
        const a = t.life / (t.sweet ? C.fx.trailSweetLen : C.fx.trailLen);
        g.fillColor = t.sweet
          ? new Color(255, 225, 77, Math.round(140 * a))
          : new Color(255, 255, 255, Math.round(60 * a));
        g.circle(this.vp.x(t.x), this.vp.y(t.y), 3 + 3 * a);
        g.fill();
      }
      drawShuttle(g, this.vp, { ...ball, x: bx, y: by, sqR } as Ball, skin);
    }

    // 绘制粒子与打击特效(冲击波/火花/羽毛/彩带等)
    this.fx.draw(g, this.vp);

    // 飘字:上浮 + 末段淡出
    for (const f of this.floats) {
      const pos = f.node.position;
      f.node.setPosition(pos.x, pos.y + f.vy, 0);
      const remain = f.life / f.maxLife;
      f.opacity.opacity = remain < 0.35 ? Math.round(255 * (remain / 0.35)) : 255;
    }
  }
}

export const clampAlpha = (acc: number, step: number): number => clamp(acc / step, 0, 1);
