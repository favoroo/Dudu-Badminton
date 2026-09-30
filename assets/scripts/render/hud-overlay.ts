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
import { Physics } from "../core/physics";
import { Settings } from "../core/settings";
import { Rules } from "../core/rules";
import { Drill } from "../core/drill";
import { meter, winU, targetZoneFor } from "./drill-anim";
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
  // ---------- 轨迹预测虚线的预分配缓冲(每帧复用,零 GC)----------
  // predictPath 写世界坐标点 → px/py 存换算后的 Graphics 坐标 → dashBuf 存切好的虚线段
  // (每段 5 个 float:x0,y0,x1,y1,透明度档)。虚线段数上限 ≈ 弧长/(dash+gap),
  // 800/5=160 段足够最远的那条弧,写满就提前收笔,不会越界。
  private pathBuf = new Float32Array((C.landing.pathHorizon + 2) * 2);
  private px = new Float32Array(C.landing.pathHorizon + 2);
  private py = new Float32Array(C.landing.pathHorizon + 2);
  private dashBuf = new Float32Array(800);

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
    const b = R.ball;

    // ---------- 落点预测(六层叠画,见 config.landing 的注释)----------
    // 设置页的「落点预测圈」开关掐这一处:只关预测圈,拍数徽标与训练时机条不受影响
    if (b && b.live && !b.held && b.shot && Settings.hintLanding) this.landingMarker(R, t);

    // ---------- 训练场:把引导页那根时机条搬到球员头顶 + 目标落点与迎击位 ----------
    if (R.mode === "drill") {
      this.drillFieldGuides(R, t);
      this.drillMeter(R);
    }

    // ---------- 赛点霓虹旗标 ----------
    this.matchPointFlag(R, t);
  }

  // ---------- 落点预测:衬底 / 光斑 / 收缩准星环 / 双描边主圈 / 列光 / 下箭头 ----------
  // 三档强度是这条提示线的核心判断:
  //   落在真人守的一侧 → 满档(这是唯一需要玩家改动作的信息);
  //   落在纯 AI 一侧(自己刚打出去的那拍)→ 收一档,只当瞄准反馈,不催;
  //   预计出界 / 撞网 → 压暗、收缩放慢、不挂列光 —— 这类球正确做法是不去够,
  //     提示再亮反而是在教人失误。
  private landingMarker(R: typeof Rules.R, t: number): void {
    const L = C.landing;
    const g = this.g;
    const b = R.ball;
    if (!b || !b.shot) return;
    const land = b.shot.landX;
    if (land <= CO.left - 60 || land >= CO.right + 60) return;   // 飞出镜头外就不画

    const shot = b.shot;
    const isSmash = shot.kind === "smash";
    const willOut = land < CO.left || land > CO.right;
    const willNet = shot.intoNet;
    const real = !willOut && !willNet;          // 这拍真会落在这儿(值得催)

    // 这一侧有没有真人守(2p 两边都是真人 → 两边都满档)
    const side = land < CO.netX ? "left" : "right";
    const mine = R.players.some((p) => !p.isAI && p.side === side);

    // 距落地还剩几帧:y/vy 与 x/vx 各估一个取更早的那个 ——
    // vx 被空气阻力一路拖慢,x 估子偏乐观;平飘球的 y 估子会过早。取 min 最保守。
    let remain = -1;
    if (b.vy > 0.2) remain = (CO.groundY - 2 - b.y) / b.vy;
    const dx = land - b.x;
    if (Math.abs(b.vx) > 0.2 && dx * b.vx > 0) {
      const ex = Math.abs(dx) / Math.abs(b.vx);
      remain = remain < 0 ? ex : Math.min(remain, ex);
    }
    // urgentFrames 与 remain 都是「剩余帧」量,故意不随球速档位折算:
    // 不折 = 落点圈在真实时间里同样提前催(见 core/pace.ts 头注释的「不缩放清单」)
    const urg = real ? Math.max(0, Math.min(1, 1 - Math.max(0, remain) / L.urgentFrames)) : 0;
    const u = urg * (mine ? 1 : 0.55);
    const dim = (mine ? 1 : 0.8) * (real ? 1 : 0.62);

    const hex = willNet ? "#ff6b6b" : willOut ? "#9fb4d6" : isSmash ? "#ff5500" : "#ffe14d";
    const rx = willOut ? L.outRx : isSmash ? L.smashRx : L.rx;
    const ry = willOut ? L.outRy : isSmash ? L.smashRy : L.ry;

    const cx = this.vp.x(land);
    const lineY = this.vp.y(CO.groundY + 2);   // 地面线(Graphics 里向上为正)
    const cy = lineY - ry;                     // 光斑顶边贴线,主体画在近景地胶上

    // ⓪ 轨迹预测虚线:先画,让地面那几层压在它之上(线头收在落点圈里,不越过它喊话)
    this.landingPath(b.x, b.y, b.vx, b.vy, dim);

    // ① 落点列光:盯球时不必移开视线就能读出落点 x(三段叠近似垂直渐隐)
    if (real) {
      const seg = 3;
      const baseA = L.beamA * dim * (0.72 + 0.28 * u);
      for (let i = 0; i < seg; i++) {
        const f0 = i / seg, f1 = (i + 1) / seg;
        const y0 = lineY + L.beamH * f0, y1 = lineY + L.beamH * f1;
        const w0 = L.beamW * (1 + f0 * 0.9) * 0.5, w1 = L.beamW * (1 + f1 * 0.9) * 0.5;
        g.fillColor = withAlpha(pal(hex), baseA * (1 - f0 * 0.75));
        g.moveTo(cx - w0, y0);
        g.lineTo(cx + w0, y0);
        g.lineTo(cx + w1, y1);
        g.lineTo(cx - w1, y1);
        g.close();
        g.fill();
      }
    }

    // ② 暗衬底:不指望「颜色够亮」,先垫一块暗底 —— 沙滩金沙、球馆暖白线、道场榻榻米
    //    三套亮底主题上原来的金圈糊成一片,这一步是显眼与否的地基
    g.fillColor = withAlpha("#000000", L.backingA);
    g.ellipse(cx, cy, rx * L.backing, ry * L.backing + 2);
    g.fill();

    // ③ 地贴光斑:Graphics 没有径向渐变,由外向内叠层近似(外圈几乎透明)。恒定亮度。
    const spotA = L.spotA * dim;
    for (let i = L.glowLayers; i >= 1; i--) {
      const f = i / L.glowLayers;
      g.fillColor = withAlpha(pal(hex), spotA * (1 - f * f));
      g.ellipse(cx, cy, rx * f, ry * f);
      g.fill();
    }

    // ④ 收缩准星环:只留一道,而且透明度用 sin(π·ph) 两端 ease ——
    //    原来是「收到最亮那一帧突然跳回 0.1 消失」,那个 pop 加两道错峰就是「一直在闪」。
    //    现在它从透明里慢慢浮出来、收进主圈时又慢慢化掉,一圈 50 帧,不催也不跳。
    const period = L.ringPeriodSlow + (L.ringPeriodFast - L.ringPeriodSlow) * u;
    const ringA = L.ringA * dim * (real ? 1 : 0.6);
    g.lineWidth = L.ringW;
    for (let i = 0; i < L.rings; i++) {
      const ph = (t / period + i / L.rings) % 1;
      const k = L.ringFrom + (1 - L.ringFrom) * ph;
      g.strokeColor = withAlpha(pal(hex), ringA * Math.sin(ph * Math.PI));
      g.ellipse(cx, cy, rx * k, ry * k);
      g.stroke();
    }

    // ⑤ 主圈双描边:主题色外描压形状,白芯内描提轮廓(单描边在亮底上照样糊)。恒定亮度。
    const edgeA = 0.95 * dim;
    g.strokeColor = withAlpha(pal(hex), edgeA);
    g.lineWidth = isSmash ? 4.5 : 3.6;
    g.ellipse(cx, cy, rx, ry);
    g.stroke();
    g.strokeColor = withAlpha("#ffffff", edgeA * 0.85);
    g.lineWidth = 1.5;
    g.ellipse(cx, cy, rx - 2, Math.max(1.5, ry - 1.5));
    g.stroke();

    // ⑥ 精确落点:白芯点(画在暗衬底上,不是画在那条白色地面线上)
    g.fillColor = withAlpha("#ffffff", 0.92 * dim);
    g.ellipse(cx, cy, 3.4, 2.2);
    g.fill();

    // ⑦ 下箭头:钉在光斑上方不晃(原来 4px 上下浮动 + 亮度随紧迫度涨落,也是「闪」的一部分)
    if (real) {
      const ay = lineY + ry + 17;
      g.strokeColor = withAlpha(pal(hex), 0.8 * dim);
      g.lineWidth = 3;
      g.moveTo(cx - 7, ay + 8);
      g.lineTo(cx, ay);
      g.lineTo(cx + 7, ay + 8);
      g.stroke();
    }
  }

  // ---------- 轨迹预测虚线 ----------
  // 弹道由 Physics.predictPath 沿**同一套积分**往前推(与 trace 共用落地/撞网判据),
  // 所以这条弧就是球真正会走的那条;渲染层绝不另抄一份积分,否则改一次手感要同步两处。
  // cc Graphics 没有 setLineDash → 按累计弧长自己切段;整条线沿弧长分三档降透明度,
  // 靠球那端最实、往落点方向淡出,末端交给落点圈喊,这条线只负责「读出这条弧的形状」。
  private landingPath(bx: number, by: number, vx: number, vy: number, dim: number): void {
    const L = C.landing;
    const g = this.g;
    const n = Physics.predictPath(bx, by, vx, vy, L.pathHorizon, this.pathBuf);
    if (n < 2) return;
    const fade = L.pathFade;

    for (let i = 0; i < n; i++) {                 // 世界坐标 → Graphics 坐标,一次换算
      this.px[i] = this.vp.x(this.pathBuf[i * 2]);
      this.py[i] = this.vp.y(this.pathBuf[i * 2 + 1]);
    }
    let total = 0;
    for (let i = 1; i < n; i++) total += Math.hypot(this.px[i] - this.px[i - 1], this.py[i] - this.py[i - 1]);
    if (total < 8) return;

    const D = L.dashOn, CYC = L.dashOn + L.dashOff, bandLen = total / fade.length;
    let acc = 0, travel = 0, cnt = 0;
    for (let i = 1; i < n; i++) {
      const x0 = this.px[i - 1], y0 = this.py[i - 1], x1 = this.px[i], y1 = this.py[i];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (seg > 0) {
        const ux = (x1 - x0) / seg, uy = (y1 - y0) / seg;
        let pos = 0;
        while (pos < seg) {
          const phase = acc % CYC;
          const drawing = phase < D;
          const room = drawing ? D - phase : CYC - phase;   // 当前这一截(实或空)还剩多长
          const take = room < seg - pos ? room : seg - pos;
          if (drawing && cnt + 5 <= this.dashBuf.length) {
            let bi = Math.floor((travel + pos) / bandLen);
            if (bi < 0) bi = 0; else if (bi >= fade.length) bi = fade.length - 1;
            this.dashBuf[cnt++] = x0 + ux * pos;
            this.dashBuf[cnt++] = y0 + uy * pos;
            this.dashBuf[cnt++] = x0 + ux * (pos + take);
            this.dashBuf[cnt++] = y0 + uy * (pos + take);
            this.dashBuf[cnt++] = bi;
          }
          pos += take; acc += take;
        }
        travel += seg;
      }
    }

    g.lineWidth = L.pathW;
    for (let bi = 0; bi < fade.length; bi++) {
      let any = false;
      g.strokeColor = withAlpha(pal("#bfe6ff"), L.pathA * dim * fade[bi]);
      for (let k = 0; k + 4 < cnt; k += 5) {
        if (this.dashBuf[k + 4] !== bi) continue;
        g.moveTo(this.dashBuf[k], this.dashBuf[k + 1]);
        g.lineTo(this.dashBuf[k + 2], this.dashBuf[k + 3]);
        any = true;
      }
      if (any) g.stroke();
    }
  }

  // ---------- 训练场:目标落点区与接球站位指引 ----------
  private drillFieldGuides(R: typeof Rules.R, t: number): void {
    const def = Drill.cur();
    if (!def) return;
    const tgt = targetZoneFor(def);
    const tx1 = this.vp.x(tgt.x1);
    const tx2 = this.vp.x(tgt.x2);
    const tw = Math.max(24, tx2 - tx1);
    const gy = this.vp.y(CO.groundY);
    const b = R.ball;
    const isMyBall = b && b.live && b.lastHitter === "left";
    const isTargeting = isMyBall && b.shot && b.shot.landX >= tgt.x1 && b.shot.landX <= tgt.x2;

    const pulse = 0.5 + 0.5 * Math.sin(t * 0.15);
    const bgA = isTargeting ? 0.38 + 0.15 * pulse : 0.18 + 0.08 * pulse;
    const strokeCol = isTargeting ? "#ffe14d" : "#7dff9e";

    // 1. 对方半场目标落点高亮带
    this.g.fillColor = withAlpha(pal(strokeCol), bgA);
    this.g.rect(tx1, gy - 8, tw, 10);
    this.g.fill();

    this.g.strokeColor = withAlpha(pal(strokeCol), isTargeting ? 0.95 : 0.65);
    this.g.lineWidth = isTargeting ? 2.5 : 1.6;
    this.g.rect(tx1, gy - 8, tw, 10);
    this.g.stroke();

    // 中心微型准星
    const tcx = (tx1 + tx2) / 2;
    this.g.strokeColor = withAlpha(pal(strokeCol), 0.7);
    this.g.lineWidth = 1.2;
    this.g.circle(tcx, gy - 3, 5);
    this.g.stroke();

    // 2. 玩家半场最佳迎击站位指示
    const isIncoming = b && b.live && (b.lastHitter === "right" || (b.held && b.owner?.side === "right"));
    if (isIncoming) {
      const cx = this.vp.x(def.contactX);
      const inPulse = 0.5 + 0.5 * Math.sin(t * 0.2);
      this.g.strokeColor = withAlpha(pal("#00f0ff"), 0.5 + 0.3 * inPulse);
      this.g.lineWidth = 1.8;
      this.g.ellipse(cx, gy - 2, 18, 6);
      this.g.stroke();

      if (def.pose?.jump) {
        // 向上箭头暗示起跳
        this.g.strokeColor = withAlpha(pal("#ffe14d"), 0.8 * inPulse);
        this.g.lineWidth = 2.0;
        this.g.moveTo(cx, gy + 12);
        this.g.lineTo(cx, gy + 22);
        this.g.moveTo(cx - 4, gy + 17);
        this.g.lineTo(cx, gy + 22);
        this.g.lineTo(cx + 4, gy + 17);
        this.g.stroke();
      }
    }
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
