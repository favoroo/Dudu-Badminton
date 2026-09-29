// ============================================================
// 世界渲染层:视口变换 + 每帧重绘(角色/羽毛球/拖尾/飘字) + 镜头震动。
// Cocos Graphics 是保留式几何,这里采用「每帧 clear + 全量重绘」——
// 与老 canvas 全帧重绘同构,元素量级(两人一球)毫无压力。
// 渲染层只读游戏状态,不改任何逻辑字段。
// ============================================================
import { Color, Graphics, Label, Layers, Node, UIOpacity, UITransform } from "cc";
import { CFG } from "../core/config";
import { Settings } from "../core/settings";
import { lerp, clamp } from "../core/utils";
import { Ball, GameEvent, Player, SkinDef } from "../core/types";
import { drawPlayer, drawShuttle } from "./sprites";
import { courtRenderer, CourtThemeItem } from "./court";
import { FXSystem } from "./fx";
import { HudOverlay } from "./hud-overlay";

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
  label: Label;
  opacity: UIOpacity;
  life: number;
  maxLife: number;
  vy: number;
}

interface TrailDot { x: number; y: number; life: number; sweet: boolean }

/** 一个角色的表现层文字:头顶名牌(YOU/CPU/搭档…)+ 球衣号(sprites.ts【移植限制】补字) */
interface TagText { tag: Label; jersey: Label }

export class WorldView {
  readonly root: Node;          // 受震屏/镜头冲击影响的容器
  private courtGfx: Graphics;
  private g: Graphics;
  private vp: Viewport;
  private floatLayer: Node;
  private tagLayer: Node;
  private floats: FloatText[] = [];
  private floatPool: FloatText[] = [];
  private tags: TagText[] = [];
  private trail: TrailDot[] = [];
  readonly fx = new FXSystem(); // 完整打击特效与粒子系统
  /** 画布内世界提示层(老 hud.js:落点圈/训练时机条/拍数徽标/赛点旗标) */
  readonly hudOverlay: HudOverlay;
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

    // 画布内世界提示层(落点圈/训练时机条/拍数徽标/赛点旗标,老 hud.js)
    this.hudOverlay = new HudOverlay(this.root, this.vp);

    // 角色名牌/球衣号文字层(sprites 画不了字,Label 补)
    this.tagLayer = new Node("tags");
    this.tagLayer.layer = Layers.Enum.UI_2D;
    this.tagLayer.addComponent(UITransform);
    this.tagLayer.setParent(this.root);

    // 飘字层:位于最上,不参与 clear
    this.floatLayer = new Node("floats");
    this.floatLayer.layer = Layers.Enum.UI_2D;
    this.floatLayer.addComponent(UITransform);
    this.floatLayer.setParent(this.root);
  }

  /** 名牌/球衣号文字池:按需增长,标签样式对齐 sprites.ts 的 fillText 约定 */
  private ensureTags(count: number): void {
    while (this.tags.length < count) {
      const mk = (name: string, size: number, bold: boolean): Label => {
        const n = new Node(name);
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform);
        n.setParent(this.tagLayer);
        const l = n.addComponent(Label);
        l.fontSize = size;
        l.lineHeight = Math.round(size * 1.2);
        l.isBold = bold;
        l.horizontalAlign = Label.HorizontalAlign.CENTER;
        return l;
      };
      this.tags.push({ tag: mk("tag", 10, true), jersey: mk("jersey", Math.round(C.player.h * 0.115), true) });
    }
  }

  /** 每帧同步名牌与球衣号(颜色/文字规则 = sprites.ts drawPlayerTag 注释) */
  private syncTags(players: Player[], rxs: number[], rys: number[]): void {
    let i = 0;
    for (let k = 0; k < players.length; k++) {
      const p = players[k];
      if (p.hideTag) continue;
      this.ensureTags(i + 1);
      const pair = this.tags[i++];
      const label = p.label || (p.isAI ? "AI" : "YOU");
      const name = label === "你" ? "YOU" : label;
      const isMainUser = !p.isAI && (label === "你" || label === "P1" || label === "YOU");
      const isPartner = label === "搭档";
      const isP2 = label === "P2";
      pair.tag.node.active = true;
      pair.tag.node.setPosition(Math.round(this.vp.x(rxs[k])), Math.round(this.vp.y(rys[k] - C.player.h - 18 + 0.5)), 0);
      pair.tag.string = name;
      pair.tag.color = isMainUser
        ? new Color().fromHEX(p.side === "left" ? "#ffe14d" : "#3ea8ff")
        : isPartner ? new Color().fromHEX("#6ee7b7")
        : isP2 ? new Color().fromHEX("#7fd0ff")
        : new Color(255, 255, 255, 173);
      // 球衣号:胸前局部 (1, -0.568H) ≈ 世界 (x+1, y-0.568H)(sprites.ts#L417-420 注释)
      pair.jersey.node.active = true;
      pair.jersey.node.setPosition(Math.round(this.vp.x(rxs[k] + 1)), Math.round(this.vp.y(rys[k] - C.player.h * 0.568)), 0);
      pair.jersey.string = p.jersey;
      pair.jersey.color = new Color(255, 255, 255, 204);
    }
    for (let k = i; k < this.tags.length; k++) {
      this.tags[k].tag.node.active = false;
      this.tags[k].jersey.node.active = false;
    }
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

  /** 震屏总量:调用方只管「这次多狠」,是否生效由设置里的开关决定 */
  shake(amt: number): void {
    if (!Settings.hintShake) return;
    this.shakeAmt = Math.max(this.shakeAmt, amt);
  }

  /**
   * 事件驱动的飘字(老 FX.float 的精简版:上浮 + 淡出)
   * 「飘字提示」开关掐在这个唯一入口 —— 关掉时「下网/出界/擦网/平分/训练有效+1」
   * 这些文字提示也一并没了(要的就是干净画面;想只关击球飘字得给本函数加分类参数)。
   */
  /**
   * 事件驱动的飘字(老 FX.float 的精简版:上浮 + 淡出)
   * 采用节点对象池(floatPool),寿命耗尽时隐藏并回收入池,杜绝节点泄露与幽灵残留
   */
  float(wx: number, wy: number, text: string, color: string, size: number, life: number, vy = -1): void {
    if (!Settings.hintFloat) return;
    let item = this.floatPool.pop();
    if (!item) {
      const node = new Node("float");
      node.layer = Layers.Enum.UI_2D;
      node.addComponent(UITransform);
      const label = node.addComponent(Label);
      const opacity = node.addComponent(UIOpacity);
      node.setParent(this.floatLayer);
      item = { node, label, opacity, life: 0, maxLife: 0, vy: -1 };
    }
    item.life = life;
    item.maxLife = life;
    item.vy = vy || -1;
    item.node.setPosition(this.vp.x(wx), this.vp.y(wy), 0);
    item.label.string = text;
    item.label.fontSize = size;
    item.label.lineHeight = Math.round(size * 1.15);
    item.label.color = color.startsWith("#") ? new Color().fromHEX(color) : new Color(255, 255, 255, 255);
    item.opacity.opacity = 255;
    item.node.active = true;
    this.floats.push(item);
  }

  /** 清空当前所有飘字(换局/重新发球/重置时调用) */
  clearFloats(): void {
    for (let i = 0; i < this.floats.length; i++) {
      const f = this.floats[i];
      f.node.active = false;
      f.opacity.opacity = 0;
      this.floatPool.push(f);
    }
    this.floats.length = 0;
  }

  /** 每模拟步推进(寿命计数,帧率无关) */
  stepFx(dt = 1 / 60): void {
    this.shakeAmt *= 0.85;
    this.shakeX = this.shakeAmt > 0.3 ? (Math.random() * 2 - 1) * this.shakeAmt : 0;
    
    let alive = 0;
    for (let i = 0; i < this.floats.length; i++) {
      const f = this.floats[i];
      f.life--;
      if (f.life > 0) {
        this.floats[alive++] = f;
      } else {
        f.node.active = false;
        f.opacity.opacity = 0;
        this.floatPool.push(f);
      }
    }
    this.floats.length = alive;

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
    const rxs: number[] = [], rys: number[] = [];
    for (const p of order) {
      const rx = lerp(p.px, p.x, alpha);
      const ry = lerp(p.py, p.y, alpha);
      rxs.push(rx); rys.push(ry);
      drawPlayer(g, this.vp, { ...p, x: rx, y: ry }, animT, alpha, ball);
    }
    // 名牌文字与球衣号(与角色同层叠加)
    this.syncTags(order, rxs, rys);

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

    // 若设置中关闭了飘字提示，立即清空现有活跃飘字
    if (!Settings.hintFloat && this.floats.length > 0) {
      this.clearFloats();
    }

    // 飘字:上浮 + 末段淡出
    for (let i = 0; i < this.floats.length; i++) {
      const f = this.floats[i];
      const pos = f.node.position;
      f.node.setPosition(pos.x, pos.y + f.vy, 0);
      const remain = Math.max(0, f.life / f.maxLife);
      f.opacity.opacity = remain < 0.35 ? Math.round(255 * (remain / 0.35)) : 255;
    }
  }
}

export const clampAlpha = (acc: number, step: number): number => clamp(acc / step, 0, 1);
