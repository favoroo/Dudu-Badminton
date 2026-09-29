// ============================================================
// 画布内世界提示:落点预测圈、训练头顶时机条、回合拍数徽标、赛点霓虹旗标。
// 自老版 canvas 工程 src/render/hud.js 逐行移植 —— 比分/发球权等 DOM 层信息
// 在 ui/hud.ts,这里只画「长在球场上」的东西。
//
// Graphics 无 globalAlpha,原版的 ctx.globalAlpha 全部折算进颜色 alpha;
// 文字(Graphics 画不了)用挂在世界层的小 Label,每帧同步位置。
// 渲染层只读游戏状态,不改任何逻辑字段。
// ============================================================
import { Color, Graphics, Label, Layers, Node, UITransform } from "cc";
import { CFG } from "../core/config";
import { Rules } from "../core/rules";
import { Drill } from "../core/drill";
import { keyLabel, meter, winU } from "./drill-anim";
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
  // 文字标签(回合拍数 / 赛点旗标 / 训练进度)
  private rallyLabel: Label;
  private mpLabel: Label;
  private progLabel: Label;
  private progNode: Node;

  constructor(parent: Node, vp: Viewport) {
    this.vp = vp;
    const n = new Node("hud-overlay");
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform);
    n.setParent(parent);
    this.g = n.addComponent(Graphics);
    this.rallyLabel = txt(n, "rally", 13);
    this.mpLabel = txt(n, "mp", 11);
    this.progNode = new Node("drill-prog");
    this.progNode.layer = Layers.Enum.UI_2D;
    this.progNode.addComponent(UITransform);
    this.progNode.setParent(n);
    this.progLabel = this.progNode.addComponent(Label);
    this.progLabel.string = "";
    this.progLabel.fontSize = 13;
    this.progLabel.lineHeight = 15;
    // 三个文字标签初始都不可见:非训练模式 progNode 无人驱动,会带着默认串悬在画布中心
    this.progNode.active = false;
    this.rallyLabel.node.active = false;
    this.mpLabel.node.active = false;
  }

  draw(R: typeof Rules.R, t: number): void {
    const g = this.g;
    g.clear();
    const X = (wx: number) => this.vp.x(wx);
    const Y = (wy: number) => this.vp.y(wy);
    const b = R.ball;

    // ---------- 落点预测圈(hud.js#L14-33) ----------
    if (b && b.live && !b.held && b.shot) {
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
    else this.progNode.active = false;   // 退出训练后隐藏计数,否则残留最后一帧

    // ---------- 回合拍数徽标 & 赛点霓虹旗标 ----------
    this.rallyAndMatchPoint(R, t);
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
    const key = keyLabel(def.wantKey === "near" ? "swingNear" : "swingFar");
    const w = 132;
    // 世界坐标(原版画布坐标=屏幕坐标):条左上角
    const wx = p.x - w / 2, wy = p.y - C.player.h - 96;
    const x0 = this.vp.x(wx), y0 = this.vp.y(wy + 12);   // +12 = 条高,转成 Graphics 的下缘
    const u = swinging ? winU(p.swingT) : null;
    const a = swinging ? 1 : mine ? 0.34 : 0.8;
    meter(this.g, x0, y0, w, u, key, { h: 12, a });
    // 有效拍计数:让「还差几拍」始终在视线里
    const prg = Drill.prog();
    const goal = def.goal || C.drill.defaultGoal;
    this.progNode.active = true;
    this.progNode.setPosition(this.vp.x(p.x), this.vp.y(wy - 10), 0);
    this.progLabel.string = `${Math.min(prg.valid, goal)} / ${goal}`;
    this.progLabel.color = prg.valid >= goal
      ? new Color().fromHEX("#ffe14d")
      : new Color(255, 255, 255, 230);
  }

  // ---------- 回合拍数动态徽章 + 赛点霓虹旗标(hud.js#L90-169) ----------
  private rallyAndMatchPoint(R: typeof Rules.R, t: number): void {
    const g = this.g;
    const hasRally = R.state === "RALLY" && R.rally >= 3;
    const isMP = (R.state === "SERVE" || R.state === "RALLY") && Rules.isMatchPoint();

    // 1. 回合拍数 pill(三档质感:普白 → 金黄脉动 → 橙红电光)
    this.rallyLabel.node.active = hasRally;
    if (hasRally) {
      const r = R.rally;
      const isEpic = r >= 10;
      const isHot = r >= 6;
      const scale = isEpic ? 1 + Math.sin(t * 0.24) * 0.05
        : isHot ? 1 + Math.sin(t * 0.16) * 0.03
        : 1;
      const pw = (isEpic ? 122 : isHot ? 108 : 92) * scale;
      const ph = 22 * scale;
      const cx = this.vp.x(C.world.w / 2), cy = this.vp.y(24);
      // 胶囊背景
      g.fillColor = isEpic ? withAlpha(pal("#230a0a"), 0.85)
        : isHot ? withAlpha(pal("#141828"), 0.78)
        : withAlpha(pal("#0a0e1a"), 0.65);
      g.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, ph / 2);
      g.fill();
      // 边框
      g.lineWidth = isEpic ? 2 : 1.5;
      g.strokeColor = isEpic ? pal("#ff5522") : isHot ? pal("#ffe14d") : withAlpha(pal("#ffffff"), 0.35);
      g.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, ph / 2);
      g.stroke();
      this.rallyLabel.node.setPosition(cx, cy, 0);
      this.rallyLabel.node.setScale(scale, scale, 1);
      this.rallyLabel.string = `RALLY ${r}`;
      this.rallyLabel.color = isEpic ? new Color().fromHEX("#ffe855")
        : isHot ? new Color().fromHEX("#ffe14d")
        : new Color(255, 255, 255, 242);
    }

    // 2. 赛点 / 局点顶部霓虹旗标
    this.mpLabel.node.active = isMP;
    if (isMP) {
      const mp = Rules.matchPointInfo();
      const py = hasRally ? 50 : 25;
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.12);
      const cx = this.vp.x(C.world.w / 2), cy = this.vp.y(py);
      const content = mp.label ? `★ ${mp.label} ★` : "★ MATCH POINT ★";
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
