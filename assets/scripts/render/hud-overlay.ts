// ============================================================
// 画布内世界提示:落点预测圈、训练头顶时机条、赛点霓虹旗标。
// 自老版 canvas 工程 src/render/hud.js 逐行移植 —— 比分/发球权等 DOM 层信息
// 在 ui/hud.ts,这里只画「长在球场上」的东西。
//
// Graphics 无 globalAlpha,原版的 ctx.globalAlpha 全部折算进颜色 alpha;
// 文字(Graphics 画不了)用挂在世界层的小 Label,每帧同步位置。
// 渲染层只读游戏状态,不改任何逻辑字段。
// ============================================================
import { Color, Graphics, Label, Layers, Node, UITransform } from "cc";
import { CFG } from "../core/config";
import { Settings } from "../core/settings";
import { Rules } from "../core/rules";
import { Drill } from "../core/drill";
import { meter, winU } from "./drill-anim";
import type { Viewport } from "./world";
import { pal, withAlpha } from "./palette";

const C = CFG;
const CO = C.court;

function txt(parent: Node, name: string, size: number): Label {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform);
  n.setParent(parent);
  const l = n.addComponent(Label);
  l.string = "";          // Label 默认串是 "label",不清掉会漏出调试浮字
  l.fontSize = size;
  l.lineHeight = Math.round(size * 1.15);
  return l;
}

export class HudOverlay {
  private g: Graphics;
  private vp: Viewport;
  // 赛点旗标(拍数由 HUD 的连击大字负责,训练进度由 HUD 的状态行负责)
  private mpLabel: Label;

  constructor(parent: Node, vp: Viewport) {
    this.vp = vp;
    const n = new Node("hud-overlay");
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform);
    n.setParent(parent);
    this.g = n.addComponent(Graphics);
    this.mpLabel = txt(n, "mp", 11);
    this.mpLabel.node.active = false;
  }

  draw(R: typeof Rules.R, t: number): void {
    const g = this.g;
    g.clear();
    const X = (wx: number) => this.vp.x(wx);
    const Y = (wy: number) => this.vp.y(wy);
    const b = R.ball;

    // ---------- 落点预测圈(hud.js#L14-33) ----------
    // 设置页的「落点预测圈」开关掐这一处:只关预测圈,拍数徽标与训练时机条不受影响
    if (b && b.live && !b.held && b.shot && Settings.hintLanding) {
      const land = b.shot.landX;
      if (land > CO.left - 60 && land < CO.right + 60) {
        const isSmash = b.shot.kind === "smash";
        const a = isSmash ? 0.65 + Math.sin(t * 0.25) * 0.25 : 0.30 + Math.sin(t * 0.14) * 0.12;
        const rx = isSmash ? 17 : 13, ry = isSmash ? 6 : 4.5;
        const cy = Y(CO.groundY + 2) - ry;   // 椭圆中心(Graphics 圆心)
        if (isSmash) {
          g.fillColor = withAlpha(pal("#ff6400"), 0.25 * a);
          g.ellipse(X(land), cy, rx, ry);
          g.fill();
        }
        g.strokeColor = withAlpha(pal(b.shot.intoNet ? "#ff6b6b" : isSmash ? "#ff5500" : "#ffe14d"), a);
        g.lineWidth = isSmash ? 3.5 : 2;
        g.ellipse(X(land), cy, rx, ry);
        g.stroke();
      }
    }

    // ---------- 训练场:把引导页那根时机条搬到球员头顶(hud.js#L174-197) ----------
    if (R.mode === "drill") this.drillMeter(R);

    // ---------- 赛点霓虹旗标 ----------
    this.matchPointFlag(R, t);
  }

  // ---------- 训练场:头顶挥拍时机条 ----------
  // 复用引导页同一个 meter 原语 ——「教的」和「场上看到的」必须是一套视觉语言
  private drillMeter(R: typeof Rules.R): void {
    const def = Drill.cur();
    if (!def) return;
    const p = R.players[0];
    if (!p || p.isAI) return;
    const b = R.ball;
    const mine = !b || b.lastHitter === "left";
    const swinging = p.swingT >= 0;
    const w = 132;
    // 世界坐标(原版画布坐标=屏幕坐标):条左上角
    const wx = p.x - w / 2, wy = p.y - C.player.h - 96;
    const x0 = this.vp.x(wx), y0 = this.vp.y(wy + 12);   // +12 = 条高,转成 Graphics 的下缘
    const u = swinging ? winU(p.swingT) : null;
    const a = swinging ? 1 : mine ? 0.34 : 0.8;
    meter(this.g, x0, y0, w, u, { h: 12, a });
  }

  // ---------- 赛点顶部霓虹旗标(hud.js#L90-169 的旗标那一半) ----------
  // 拍数不在这里重复:RALLY 计数由 HUD 的「x N 连击」大字负责
  private matchPointFlag(R: typeof Rules.R, t: number): void {
    const g = this.g;
    const isMP = (R.state === "SERVE" || R.state === "RALLY") && Rules.isMatchPoint();

    this.mpLabel.node.active = isMP;
    if (isMP) {
      const mp = Rules.matchPointInfo();
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.12);
      const cx = this.vp.x(C.world.w / 2), cy = this.vp.y(25);
      // rules 的 label 里自带 ★,这里只补两侧装饰 —— 直接拼会出现「★ ★ 赛末点 ★」
      const raw = mp.label.replace(/★/g, "").trim();
      const content = raw ? `★ ${raw} ★` : "★ MATCH POINT ★";
      const pw = Math.max(136, content.length * 11 * 0.62 + 24);
      const ph = 20;
      // 胶囊衬底
      g.fillColor = withAlpha(pal("#2d0a10"), 0.85 + 0.1 * pulse);
      g.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, ph / 2);
      g.fill();
      // 边框
      g.lineWidth = 1.6;
      g.strokeColor = withAlpha(pal("#ff5050"), 0.7 + 0.3 * pulse);
      g.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, ph / 2);
      g.stroke();
      // 细微外发光
      g.lineWidth = 3.5;
      g.strokeColor = withAlpha(pal("#ff3c3c"), 0.2 * pulse);
      g.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, ph / 2);
      g.stroke();
      this.mpLabel.node.setPosition(cx, cy, 0);
      this.mpLabel.string = content;
      this.mpLabel.color = pulse > 0.4 ? new Color().fromHEX("#fff0f0") : new Color().fromHEX("#ffb0b0");
    }
  }
}
