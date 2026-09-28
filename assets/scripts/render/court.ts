// ============================================================
// 球场多主题环境皮肤系统 (Courts Theme Engine)
// 包含 4 套原生 Cocos Graphics 纯代码绘制的大师级场景：
// 1. arena: 黄昏专业馆 (Dusk Arena)
// 2. beach: 阳光椰林海滩 (Sunny Beach)
// 3. cyber: 赛博霓虹夜市 (Cyber Neon City)
// 4. dojo:  竹林和风道场 (Bamboo Dojo)
//
// 【重大布局防穿帮设计】
// 为适配游戏世界整体抬高 offsetY = 50 留出的触屏虚拟按键带，
// 地面系统向下深度延展 180px（世界坐标至 720，屏幕 Y 轴延伸至 -400 以下），
// 并且 4 大主题均做了专属的自然近景延展（木纹进深、贝壳金沙、大透视倒影、和风缘侧），
// 彻底消灭屏幕底部露底与穿帮。
// ============================================================

import { Color, Graphics } from "cc";
import { CFG } from "../core/config";
import { Viewport } from "./world";
import { load, save } from "../core/utils";

const C = CFG;
const CO = C.court;
const W = C.world.w;  // 960
const H = C.world.h;  // 540
const LAMPS = [180, 480, 780];

// 核心场景抬高延伸几何常量
const EXT_H = 180;             // 场景向下延伸厚度 (540 -> 720)
const BOTTOM_WY = H + EXT_H;   // 延伸后的世界底部 Y (720)
const EXT_W = 120;             // 左右各外延 120px，防超宽屏漏边
const TOTAL_W = W + EXT_W * 2; // 1200px 覆盖全宽

export type CourtThemeId = "arena" | "beach" | "cyber" | "dojo";

export interface CourtThemeItem {
  id: string;
  name: string;
  title: string;
  sub: string;
  tag: string;
  desc: string;
  accent: string;
}

// ------------------------------------------------------------
// 数学与颜色辅助工具
// ------------------------------------------------------------
function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function colRgba(r: number, g: number, b: number, a = 1): Color {
  return new Color(r, g, b, Math.round(clamp(a, 0, 1) * 255));
}

function hslToRgb(h: number, s: number, l: number, a = 1): Color {
  h = ((h % 360) + 360) % 360 / 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    r = hue2rgb(h + 1 / 3);
    g = hue2rgb(h);
    b = hue2rgb(h - 1 / 3);
  }
  return new Color(
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
    Math.round(clamp(a, 0, 1) * 255)
  );
}

// ------------------------------------------------------------
// Cocos Graphics 绘制辅助（彻底校正 Y 向下与左下角锚点差异）
// ------------------------------------------------------------
function fillRect(g: Graphics, vp: Viewport, wx: number, wy: number, w: number, h: number, col: Color): void {
  g.fillColor = col;
  g.rect(vp.x(wx), vp.y(wy + h), w, h);
  g.fill();
}

function strokeRect(g: Graphics, vp: Viewport, wx: number, wy: number, w: number, h: number, col: Color, lineWidth = 1): void {
  g.strokeColor = col;
  g.lineWidth = lineWidth;
  g.rect(vp.x(wx), vp.y(wy + h), w, h);
  g.stroke();
}

function fillCircle(g: Graphics, vp: Viewport, cx: number, cy: number, r: number, col: Color): void {
  g.fillColor = col;
  g.circle(vp.x(cx), vp.y(cy), r);
  g.fill();
}

function fillEllipse(g: Graphics, vp: Viewport, cx: number, cy: number, rx: number, ry: number, col: Color): void {
  g.fillColor = col;
  g.ellipse(vp.x(cx), vp.y(cy), rx, ry);
  g.fill();
}

function drawLine(g: Graphics, vp: Viewport, x1: number, y1: number, x2: number, y2: number, col: Color, lineWidth = 1): void {
  g.strokeColor = col;
  g.lineWidth = lineWidth;
  g.moveTo(vp.x(x1), vp.y(y1));
  g.lineTo(vp.x(x2), vp.y(y2));
  g.stroke();
}

/** 模拟多阶梯线性垂直渐变色带 */
function fillVerticalGradient(
  g: Graphics,
  vp: Viewport,
  wx: number,
  topWy: number,
  w: number,
  h: number,
  stops: { stop: number; color: Color }[],
  steps = 14
): void {
  if (stops.length < 2 || h <= 0) return;
  const stepH = h / steps;
  for (let i = 0; i < steps; i++) {
    const curTop = topWy + i * stepH;
    const curBot = i === steps - 1 ? topWy + h : curTop + stepH;
    const midT = (i + 0.5) / steps;
    let c1 = stops[0];
    let c2 = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (midT >= stops[s].stop && midT <= stops[s + 1].stop) {
        c1 = stops[s];
        c2 = stops[s + 1];
        break;
      }
    }
    const span = c2.stop - c1.stop;
    const localT = span > 0.0001 ? (midT - c1.stop) / span : 0;
    const r = Math.round(lerp(c1.color.r, c2.color.r, localT));
    const gr = Math.round(lerp(c1.color.g, c2.color.g, localT));
    const b = Math.round(lerp(c1.color.b, c2.color.b, localT));
    const a = Math.round(lerp(c1.color.a, c2.color.a, localT));
    g.fillColor = new Color(r, gr, b, a);
    g.rect(vp.x(wx), vp.y(curBot), w, curBot - curTop);
    g.fill();
  }
}

/** 模拟同心圆/同心椭圆径向光晕 */
function fillConcentricGlow(
  g: Graphics,
  vp: Viewport,
  cx: number,
  cy: number,
  maxRx: number,
  maxRy: number,
  centerCol: Color,
  outerCol: Color,
  layers = 5
): void {
  for (let i = layers; i >= 1; i--) {
    const t = i / layers;
    const rx = maxRx * t;
    const ry = maxRy * t;
    const r = Math.round(lerp(centerCol.r, outerCol.r, t));
    const gr = Math.round(lerp(centerCol.g, outerCol.g, t));
    const b = Math.round(lerp(centerCol.b, outerCol.b, t));
    const a = Math.round(lerp(centerCol.a, outerCol.a, t * t));
    g.fillColor = new Color(r, gr, b, a);
    g.ellipse(vp.x(cx), vp.y(cy), rx, ry);
    g.fill();
  }
}

// ------------------------------------------------------------
// 预生成几何数据类型定义
// ------------------------------------------------------------
interface CrowdMember {
  x: number;
  y: number;
  r: number;
  ph: number;
  tone: number;
  shadeBase: number;
  row: number;
}

interface GlowStick {
  crowdIdx: number;
  color: Color;
  ph: number;
}

interface ArenaBoard {
  x: number;
  w: number;
  t: number;
}

interface DustParticle {
  x: number;
  y: number;
  r: number;
  speedY: number;
  speedX: number;
  ph: number;
  baseAlpha: number;
}

interface BeachCloud {
  x: number;
  y: number;
  w: number;
  h: number;
  speed: number;
  alpha: number;
}

interface BeachSeagull {
  x: number;
  y: number;
  vx: number;
  scale: number;
  ph: number;
}

interface BeachShell {
  x: number;
  y: number;
  size: number;
  col: Color;
}

interface CyberBuilding {
  x: number;
  w: number;
  h: number;
  hue: number;
  windows: boolean[];
  antenna: {
    offX: number;
    h: number;
    beaconPh: number;
  } | null;
}

interface CyberParticle {
  x: number;
  y: number;
  size: number;
  speedY: number;
  speedX: number;
  color: Color;
  alpha: number;
}

interface CyberFloorTrace {
  y: number;
  x1: number;
  x2: number;
  hue: number;
}

interface DojoMountain {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

interface DojoShojiShadow {
  x: number;
  w: number;
  lean: number;
}

interface DojoBamboo {
  x: number;
  w: number;
  colorTone: number;
  lean: number;
  joints: number[];
}

interface DojoPetal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  alpha: number;
}

interface DojoLantern {
  x: number;
  y: number;
  r: number;
}

// ============================================================
// 球场渲染器核心类
// ============================================================
export class CourtRenderer {
  private currentTheme: CourtThemeId = "arena";

  // 物理与时间状态
  private time = 0;
  private netShakeAmp = 0;
  private netHitY = CO.netTopY + 18;
  private netShakeTime = 0;

  // 1. 黄昏球馆数据
  private crowd: CrowdMember[] = [];
  private arenaGlowSticks: GlowStick[] = [];
  private arenaSigns: string[] = [];
  private boards: ArenaBoard[] = [];
  private dusts: DustParticle[] = [];

  // 2. 阳光海滩数据
  private beachClouds: BeachCloud[] = [];
  private beachSeagulls: BeachSeagull[] = [];
  private beachWaves: { x: number; phase: number }[] = [];
  private beachIslands: { x: number; y: number; w: number; h: number }[] = [];
  private beachBoats: { x: number; y: number; speed: number; bobPh: number }[] = [];
  private beachShells: BeachShell[] = [];

  // 3. 赛博夜市数据
  private cyberBuildings: CyberBuilding[] = [];
  private cyberParticles: CyberParticle[] = [];
  private cyberFloorTraces: CyberFloorTrace[] = [];

  // 4. 竹林道场数据
  private dojoMountains: DojoMountain[] = [];
  private dojoShojiShadows: DojoShojiShadow[] = [];
  private dojoBamboos: DojoBamboo[] = [];
  private dojoPetals: DojoPetal[] = [];
  private dojoLanterns: DojoLantern[] = [];

  constructor() {
    this.currentTheme = load<CourtThemeId>("court_theme", "arena");
    if (!C.courts.some((c) => c.id === this.currentTheme)) {
      this.currentTheme = "arena";
    }
    this.buildAll();
  }

  get currentThemeId(): CourtThemeId {
    return this.currentTheme;
  }

  get shakeAmp(): number {
    return this.netShakeAmp;
  }

  // ------------------------------------------------------------
  // 数据预生成与随机种子重置
  // ------------------------------------------------------------
  private buildAll(): void {
    let seed = 20260927;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    // 1. 黄昏球馆
    this.crowd = [];
    const rows = [
      { y: 154, n: 48, r: 4.8, shadeBase: 16 },
      { y: 180, n: 44, r: 5.6, shadeBase: 20 },
      { y: 206, n: 40, r: 6.4, shadeBase: 24 },
      { y: 232, n: 36, r: 7.2, shadeBase: 28 },
      { y: 258, n: 32, r: 8.0, shadeBase: 32 },
    ];
    rows.forEach((rowCfg, rowIdx) => {
      const { y, n, r, shadeBase } = rowCfg;
      for (let i = 0; i < n; i++) {
        this.crowd.push({
          x: 16 + (i + rnd() * 0.6) * ((W - 32) / n),
          y: y + rnd() * 4,
          r: r + rnd() * 1.4,
          ph: rnd() * 6.28,
          tone: rnd(),
          shadeBase,
          row: rowIdx,
        });
      }
    });

    this.arenaGlowSticks = [
      { crowdIdx: 6, color: colRgba(74, 222, 128, 0.55), ph: 0.5 },
      { crowdIdx: 22, color: colRgba(255, 225, 77, 0.55), ph: 2.1 },
      { crowdIdx: 38, color: colRgba(56, 189, 248, 0.55), ph: 4.3 },
    ];

    this.arenaSigns = [
      "DUDU OPEN 2026",
      "SUPER SERIES 1000",
      "BWF WORLD TOUR",
      "POWERED BY CANVAS",
      "VICTORIOUS ARENA",
    ];

    this.boards = [];
    for (let i = 0; i < 48; i++) {
      this.boards.push({
        x: -EXT_W + i * 25 + (i % 3) * 4,
        w: 16 + (i % 4) * 3,
        t: (i * 37) % 100,
      });
    }

    this.dusts = [];
    for (let i = 0; i < 24; i++) {
      this.dusts.push({
        x: rnd() * W,
        y: 60 + rnd() * 380,
        r: 0.8 + rnd() * 1.2,
        speedY: -0.15 - rnd() * 0.25,
        speedX: (rnd() - 0.5) * 0.2,
        ph: rnd() * 6.28,
        baseAlpha: 0.15 + rnd() * 0.35,
      });
    }

    // 2. 阳光海滩
    this.beachClouds = [];
    for (let i = 0; i < 6; i++) {
      this.beachClouds.push({
        x: rnd() * W,
        y: 35 + rnd() * 95,
        w: 90 + rnd() * 110,
        h: 24 + rnd() * 18,
        speed: 0.08 + rnd() * 0.12,
        alpha: 0.65 + rnd() * 0.25,
      });
    }

    this.beachSeagulls = [];
    for (let i = 0; i < 4; i++) {
      this.beachSeagulls.push({
        x: rnd() * W,
        y: 50 + rnd() * 100,
        vx: 0.4 + rnd() * 0.5,
        scale: 0.7 + rnd() * 0.5,
        ph: rnd() * 6.28,
      });
    }

    this.beachWaves = [];
    for (let i = 0; i < 32; i++) {
      this.beachWaves.push({
        x: (i / 32) * W,
        phase: rnd() * 6.28,
      });
    }

    this.beachIslands = [
      { x: 190, y: 250, w: 85, h: 12 },
      { x: 670, y: 252, w: 120, h: 15 },
    ];

    this.beachBoats = [
      { x: 380, y: 254, speed: 0.04, bobPh: 0.8 },
      { x: 530, y: 256, speed: -0.03, bobPh: 3.2 },
    ];

    // 包含近景向下延伸 180px 散落的贝壳海螺
    this.beachShells = [];
    for (let i = 0; i < 36; i++) {
      const sy = CO.groundY + 10 + rnd() * (BOTTOM_WY - CO.groundY - 16);
      this.beachShells.push({
        x: -EXT_W + 30 + rnd() * (TOTAL_W - 60),
        y: sy,
        size: 1.2 + rnd() * 2.4,
        col: rnd() > 0.5 ? colRgba(254, 243, 199, 0.45) : colRgba(180, 83, 9, 0.22),
      });
    }

    // 3. 赛博夜市
    this.cyberBuildings = [];
    for (let i = 0; i < 28; i++) {
      const bw = 28 + rnd() * 45;
      const hasAntenna = rnd() > 0.4;
      this.cyberBuildings.push({
        x: i * 36 - 20 + rnd() * 12,
        w: bw,
        h: 140 + rnd() * 180,
        hue: rnd() > 0.5 ? 280 + rnd() * 40 : 180 + rnd() * 40,
        windows: Array.from({ length: 16 }, () => rnd() > 0.45),
        antenna: hasAntenna
          ? {
              offX: 6 + rnd() * (bw - 12),
              h: 16 + rnd() * 24,
              beaconPh: rnd() * 6.28,
            }
          : null,
      });
    }

    this.cyberParticles = [];
    for (let i = 0; i < 30; i++) {
      this.cyberParticles.push({
        x: rnd() * W,
        y: rnd() * CO.groundY,
        size: 1.5 + rnd() * 2.5,
        speedY: -0.4 - rnd() * 0.8,
        speedX: (rnd() - 0.5) * 0.3,
        color: rnd() > 0.5 ? new Color(0, 240, 255, 255) : new Color(255, 0, 127, 255),
        alpha: 0.3 + rnd() * 0.5,
      });
    }

    this.cyberFloorTraces = [
      { y: CO.groundY + 18, x1: -EXT_W + 60, x2: W / 2 - 30, hue: 190 },
      { y: CO.groundY + 45, x1: 150, x2: TOTAL_W - 60, hue: 330 },
      { y: CO.groundY + 80, x1: -EXT_W + 80, x2: W + 60, hue: 190 },
      { y: CO.groundY + 125, x1: 80, x2: TOTAL_W - 120, hue: 330 },
    ];

    // 4. 竹林道场
    this.dojoMountains = [
      { cx: 220, cy: 260, rx: 190, ry: 75 },
      { cx: 480, cy: 265, rx: 220, ry: 85 },
      { cx: 760, cy: 260, rx: 200, ry: 78 },
    ];

    this.dojoShojiShadows = [];
    for (let i = 0; i < 7; i++) {
      this.dojoShojiShadows.push({
        x: 60 + i * 135 + (rnd() - 0.5) * 40,
        w: 12 + rnd() * 8,
        lean: (rnd() - 0.5) * 8,
      });
    }

    this.dojoBamboos = [];
    for (let i = 0; i < 26; i++) {
      this.dojoBamboos.push({
        x: (i / 26) * W + (rnd() - 0.5) * 30,
        w: 9 + rnd() * 12,
        colorTone: rnd(),
        lean: (rnd() - 0.5) * 6,
        joints: [100 + rnd() * 30, 180 + rnd() * 30, 260 + rnd() * 30, 340 + rnd() * 30],
      });
    }

    this.dojoPetals = [];
    for (let i = 0; i < 26; i++) {
      this.dojoPetals.push({
        x: rnd() * W,
        y: rnd() * CO.groundY,
        vx: 0.3 + rnd() * 0.6,
        vy: 0.4 + rnd() * 0.5,
        rot: rnd() * 6.28,
        vrot: 0.02 + rnd() * 0.04,
        size: 2.2 + rnd() * 2.8,
        alpha: 0.35 + rnd() * 0.45,
      });
    }

    this.dojoLanterns = [
      { x: 140, y: 75, r: 16 },
      { x: 340, y: 68, r: 14 },
      { x: 620, y: 68, r: 14 },
      { x: 820, y: 75, r: 16 },
    ];
  }

  // ------------------------------------------------------------
  // 对外接口契约
  // ------------------------------------------------------------
  setTheme(themeId: string): boolean {
    if (C.courts.some((c) => c.id === themeId)) {
      this.currentTheme = themeId as CourtThemeId;
      save("court_theme", themeId);
      this.buildAll();
      return true;
    }
    return false;
  }

  getTheme(): CourtThemeItem {
    return (C.courts.find((c) => c.id === this.currentTheme) || C.courts[0]) as CourtThemeItem;
  }

  cycleTheme(): CourtThemeItem {
    const list = C.courts;
    const idx = list.findIndex((c) => c.id === this.currentTheme);
    const next = list[(idx + 1) % list.length];
    this.setTheme(next.id);
    return next as CourtThemeItem;
  }

  hitNet(hitY?: number, power = 1.0): void {
    this.netShakeAmp = Math.min(2.0, this.netShakeAmp + power);
    this.netHitY = hitY != null && hitY >= CO.netTopY ? hitY : CO.netTopY + 18;
  }

  step(dt: number): void {
    const frames = Math.max(0.5, Math.min(3, dt * 60));
    this.time += frames;

    if (this.netShakeAmp > 0.003) {
      this.netShakeTime += frames;
      this.netShakeAmp *= Math.pow(0.90, frames);
    } else {
      this.netShakeAmp = 0;
      this.netShakeTime = 0;
    }
  }

  // ------------------------------------------------------------
  // 全量绘制总调度
  // ------------------------------------------------------------
  draw(g: Graphics, vp: Viewport, rallyCount = 0): void {
    const glow = clamp(rallyCount / 18, 0, 1);
    const t = this.time;

    if (this.currentTheme === "beach") {
      this.drawBeach(g, vp, t, glow);
    } else if (this.currentTheme === "cyber") {
      this.drawCyber(g, vp, t, glow);
    } else if (this.currentTheme === "dojo") {
      this.drawDojo(g, vp, t, glow);
    } else {
      this.drawArena(g, vp, t, glow);
    }

    // 绘制具有弹性受力晃动的物理球网
    this.drawNet(g, vp);
  }

  // ============================================================
  // 主题 1: 黄昏专业馆 (Dusk Arena)
  // ============================================================
  private drawArena(g: Graphics, vp: Viewport, time: number, glow: number): void {
    // 1. 穹顶与背景墙 (分段线性渐变)
    fillVerticalGradient(
      g,
      vp,
      -EXT_W,
      0,
      TOTAL_W,
      CO.groundY,
      [
        { stop: 0, color: new Color(6, 9, 20, 255) },
        { stop: 0.35, color: new Color(11, 16, 34, 255) },
        { stop: 0.75, color: new Color(16, 22, 46, 255) },
        { stop: 1, color: new Color(20, 28, 56, 255) },
      ],
      12
    );

    // 2. 顶棚金属双弦钢桁架与交叉斜腹杆
    fillRect(g, vp, -EXT_W, 10, TOTAL_W, 4, new Color(24, 34, 60, 255));
    fillRect(g, vp, -EXT_W, 28, TOTAL_W, 4, new Color(20, 28, 50, 255));

    g.strokeColor = colRgba(35, 48, 82, 0.65);
    g.lineWidth = 1.5;
    const bayW = 32;
    for (let x = -EXT_W; x < TOTAL_W; x += bayW) {
      g.moveTo(vp.x(x), vp.y(12));
      g.lineTo(vp.x(x + bayW), vp.y(30));
      g.moveTo(vp.x(x + bayW), vp.y(12));
      g.lineTo(vp.x(x), vp.y(30));
    }
    g.stroke();

    // 3. 远景赛会滚动 LED 横幅
    fillRect(g, vp, -EXT_W, 84, TOTAL_W, 34, new Color(13, 19, 38, 255));
    fillRect(g, vp, -EXT_W, 84, TOTAL_W, 2, new Color(36, 50, 90, 255));
    fillRect(g, vp, -EXT_W, 116, TOTAL_W, 2, new Color(24, 34, 64, 255));

    // LED 点阵发光装饰条与跑马方块
    const ledOff = (time * 1.5) % 180;
    for (let x = -EXT_W; x < TOTAL_W; x += 18) {
      const isBright = ((x + ledOff) % 90 < 36);
      const col = isBright ? colRgba(255, 225, 77, 0.65) : colRgba(255, 225, 77, 0.18);
      fillRect(g, vp, x, 98, 9, 6, col);
    }

    // 4. 阶梯看台与微动观众群
    fillVerticalGradient(
      g,
      vp,
      -EXT_W,
      118,
      TOTAL_W,
      212,
      [
        { stop: 0, color: new Color(12, 18, 36, 255) },
        { stop: 1, color: new Color(18, 26, 52, 255) },
      ],
      6
    );

    const steps = [156, 182, 208, 234, 260];
    for (const sy of steps) {
      fillRect(g, vp, -EXT_W, sy - 4, TOTAL_W, 4, new Color(8, 12, 26, 255));
      fillRect(g, vp, -EXT_W, sy, TOTAL_W, 2, new Color(29, 40, 74, 255));
    }

    for (const c of this.crowd) {
      const bob = Math.sin(time * 0.028 + c.ph) * 0.9;
      const shade = c.shadeBase + c.tone * 22;
      // 观众身体
      fillRect(
        g,
        vp,
        c.x - c.r * 1.1,
        c.y + bob + c.r * 0.7,
        c.r * 2.2,
        c.r * 2.0,
        colRgba(shade - 4, shade - 6, shade + 16, 0.92)
      );
      // 观众头部
      fillCircle(g, vp, c.x, c.y + bob, c.r, new Color(shade + 8, shade + 6, shade + 28, 255));
    }

    // 相持高潮挥动荧光棒
    if (glow > 0.35) {
      const stickAlpha = Math.min(0.65, (glow - 0.35) * 1.2);
      g.lineWidth = 2.5;
      for (const gs of this.arenaGlowSticks) {
        const c = this.crowd[gs.crowdIdx];
        if (!c) continue;
        const wave = Math.sin(time * 0.09 + gs.ph) * 5;
        g.strokeColor = new Color(gs.color.r, gs.color.g, gs.color.b, Math.round(stickAlpha * 255));
        g.moveTo(vp.x(c.x + 3), vp.y(c.y - 2));
        g.lineTo(vp.x(c.x + 8 + wave), vp.y(c.y - 12));
        g.stroke();
      }
    }

    // 看台护栏
    g.strokeColor = colRgba(42, 56, 94, 0.45);
    g.lineWidth = 2;
    g.moveTo(vp.x(-EXT_W), vp.y(298));
    g.lineTo(vp.x(TOTAL_W), vp.y(298));
    g.moveTo(vp.x(-EXT_W), vp.y(312));
    g.lineTo(vp.x(TOTAL_W), vp.y(312));
    for (let x = -EXT_W + 20; x < TOTAL_W; x += 48) {
      g.moveTo(vp.x(x), vp.y(292));
      g.lineTo(vp.x(x), vp.y(320));
    }
    g.stroke();

    // 5. 场边专业防眩内墙与 A-Board 广告挡板
    fillVerticalGradient(
      g,
      vp,
      -EXT_W,
      330,
      TOTAL_W,
      102,
      [
        { stop: 0, color: new Color(16, 23, 48, 255) },
        { stop: 1, color: new Color(20, 28, 56, 255) },
      ],
      5
    );

    // 裁判高椅 (Umpire Chair, x: 442~464)
    const uy = 352;
    g.strokeColor = new Color(37, 49, 84, 255);
    g.lineWidth = 2;
    g.moveTo(vp.x(446), vp.y(CO.groundY - 2));
    g.lineTo(vp.x(452), vp.y(uy + 20));
    g.moveTo(vp.x(462), vp.y(CO.groundY - 2));
    g.lineTo(vp.x(458), vp.y(uy + 20));
    for (let sy = uy + 30; sy < CO.groundY - 10; sy += 18) {
      g.moveTo(vp.x(447 + (sy - uy) * 0.08), vp.y(sy));
      g.lineTo(vp.x(461 - (sy - uy) * 0.06), vp.y(sy));
    }
    g.stroke();
    // 裁判座板与顶板
    fillRect(g, vp, 444, uy + 20, 22, 3, new Color(61, 79, 130, 255));
    fillRect(g, vp, 442, uy + 2, 2, 20, new Color(42, 55, 96, 255));
    fillRect(g, vp, 464, uy + 2, 2, 20, new Color(42, 55, 96, 255));
    fillRect(g, vp, 440, uy, 26, 3, new Color(71, 92, 150, 255));
    // 裁判剪影与记分卡
    fillCircle(g, vp, 454, uy + 10, 3.8, new Color(22, 32, 58, 255));
    fillRect(g, vp, 451, uy + 14, 7, 7, new Color(22, 32, 58, 255));
    fillRect(g, vp, 456, uy + 16, 4, 3, new Color(56, 74, 122, 255));

    // 司线员剪影 (Linesmen)
    for (const lx of [54, 906]) {
      fillRect(g, vp, lx - 7, CO.groundY - 14, 14, 14, new Color(24, 34, 61, 255));
      fillCircle(g, vp, lx, CO.groundY - 25, 4.2, new Color(18, 25, 46, 255));
      fillRect(g, vp, lx - 4, CO.groundY - 20, 8, 10, new Color(21, 32, 56, 255));
      fillRect(g, vp, lx - 1, CO.groundY - 19, 2, 5, new Color(220, 38, 38, 255));
    }

    // A-Board 广告挡板
    fillVerticalGradient(
      g,
      vp,
      -EXT_W,
      432,
      TOTAL_W,
      38,
      [
        { stop: 0, color: new Color(28, 38, 74, 255) },
        { stop: 0.2, color: new Color(19, 26, 52, 255) },
        { stop: 1, color: new Color(13, 19, 38, 255) },
      ],
      4
    );
    fillRect(g, vp, -EXT_W, 431, TOTAL_W, 2, new Color(61, 78, 128, 255));
    fillRect(g, vp, -EXT_W, 433, TOTAL_W, 1, colRgba(255, 255, 255, 0.12));
    fillRect(g, vp, -EXT_W, 467, TOTAL_W, 3, colRgba(0, 0, 0, 0.55));

    // A-Board 广告色块牌
    for (let bx = -EXT_W + 80; bx < TOTAL_W; bx += 220) {
      fillRect(g, vp, bx - 60, 442, 120, 18, colRgba(255, 235, 160, 0.08));
      strokeRect(g, vp, bx - 60, 442, 120, 18, colRgba(255, 235, 160, 0.22), 1);
      fillRect(g, vp, bx - 30, 448, 60, 6, colRgba(255, 225, 77, 0.35));
    }

    // 6. 悬挂排灯灯具外形
    for (const lamp of LAMPS) {
      fillRect(g, vp, lamp - 22, 10, 2, 22, new Color(32, 42, 72, 255));
      fillRect(g, vp, lamp + 20, 10, 2, 22, new Color(32, 42, 72, 255));

      g.fillColor = new Color(30, 39, 68, 255);
      g.moveTo(vp.x(lamp - 34), vp.y(30));
      g.lineTo(vp.x(lamp + 34), vp.y(30));
      g.lineTo(vp.x(lamp + 40), vp.y(42));
      g.lineTo(vp.x(lamp - 40), vp.y(42));
      g.close();
      g.fill();

      fillRect(g, vp, lamp - 34, 31, 68, 2, new Color(65, 80, 125, 255));
      fillRect(g, vp, lamp - 36, 41, 72, 4, new Color(255, 249, 230, 255));
      fillRect(g, vp, lamp - 30, 42, 60, 2, new Color(255, 255, 255, 255));
    }

    // 7. 柔和丁达尔聚光灯束 (梯形矢量分段，随相持升温)
    const beamBaseAlpha = 0.115 + glow * 0.045;
    for (const lamp of LAMPS) {
      const segs = 4;
      for (let s = 0; s < segs; s++) {
        const t1 = s / segs;
        const t2 = (s + 1) / segs;
        const y1 = 42 + t1 * (CO.groundY - 42);
        const y2 = 42 + t2 * (CO.groundY - 42);
        const w1 = 36 + t1 * (165 - 36);
        const w2 = 36 + t2 * (165 - 36);
        const alpha = beamBaseAlpha * (1.0 - t1 * 0.75);

        g.fillColor = colRgba(255, 240, 195, alpha);
        g.moveTo(vp.x(lamp - w1), vp.y(y1));
        g.lineTo(vp.x(lamp + w1), vp.y(y1));
        g.lineTo(vp.x(lamp + w2), vp.y(y2));
        g.lineTo(vp.x(lamp - w2), vp.y(y2));
        g.close();
        g.fill();
      }

      // 排灯径向晕圈
      fillConcentricGlow(
        g,
        vp,
        lamp,
        42,
        110,
        70,
        colRgba(255, 248, 220, 0.26 + glow * 0.08),
        colRgba(255, 225, 150, 0),
        4
      );
    }

    // 浮动微尘粒子
    const dustSpeedMul = 1.0 + glow * 0.35;
    for (const d of this.dusts) {
      d.y += d.speedY * dustSpeedMul;
      d.x += d.speedX * dustSpeedMul;
      if (d.y < 50) d.y = CO.groundY - 10;
      if (d.x < 0) d.x = W;
      if (d.x > W) d.x = 0;
      let inBeam = false;
      for (const lamp of LAMPS) {
        const spread = 36 + ((d.y - 42) / (CO.groundY - 42)) * 130;
        if (Math.abs(d.x - lamp) < spread) {
          inBeam = true;
          break;
        }
      }
      if (inBeam) {
        const alpha = d.baseAlpha * (0.6 + Math.sin(time * 0.04 + d.ph) * 0.4);
        fillCircle(g, vp, d.x, d.y, d.r, colRgba(255, 245, 210, alpha * 0.6));
      }
    }

    // 8. 【核心·实木地板延伸】：延伸至 BOTTOM_WY (720)，厚度 250px
    // 纵向进深渐暗处理：从地表暖焦糖色向近景深暗木色自然过渡
    fillVerticalGradient(
      g,
      vp,
      -EXT_W,
      CO.groundY,
      TOTAL_W,
      BOTTOM_WY - CO.groundY,
      [
        { stop: 0, color: new Color(200, 112, 58, 255) },
        { stop: 0.25, color: new Color(171, 91, 40, 255) },
        { stop: 0.6, color: new Color(110, 53, 20, 255) },
        { stop: 1, color: new Color(55, 24, 8, 255) },
      ],
      12
    );

    // 木板缝隙拼花：完整贯通延伸到底部
    for (const b of this.boards) {
      const col = b.t % 2 ? colRgba(132, 66, 29, 0.22) : colRgba(230, 151, 68, 0.16);
      fillRect(g, vp, b.x, CO.groundY, b.w, BOTTOM_WY - CO.groundY, col);
    }

    // 专业草绿色 PVC 比赛地胶 (在 wy=560 处立体收边，留下近景外延实木)
    const matL = CO.left - 28;
    const matR = CO.right + 28;
    const matW = matR - matL;
    const matH = 560 - CO.groundY; // 90px 高度地胶
    fillVerticalGradient(
      g,
      vp,
      matL,
      CO.groundY,
      matW,
      matH,
      [
        { stop: 0, color: new Color(25, 84, 62, 255) },
        { stop: 0.45, color: new Color(20, 69, 51, 255) },
        { stop: 1, color: new Color(13, 49, 36, 255) },
      ],
      6
    );

    // 地胶四周封边压条与立体暗阴影
    fillRect(g, vp, matL - 2, CO.groundY, 2, matH, colRgba(0, 0, 0, 0.45));
    fillRect(g, vp, matR, CO.groundY, 2, matH, colRgba(0, 0, 0, 0.45));
    fillRect(g, vp, matL, CO.groundY, matW, 2, colRgba(255, 255, 255, 0.22));
    fillRect(g, vp, matL - 2, 560, matW + 4, 3, colRgba(0, 0, 0, 0.5));
    fillRect(g, vp, matL, 558, matW, 2, colRgba(255, 255, 255, 0.18));

    // 地面排灯反光光斑 (近景木地板与地胶双重反射)
    for (const lamp of LAMPS) {
      fillConcentricGlow(
        g,
        vp,
        lamp,
        CO.groundY + 14,
        180,
        42,
        colRgba(255, 248, 220, 0.16 + glow * 0.05),
        colRgba(255, 220, 150, 0),
        3
      );
    }
    fillRect(g, vp, -EXT_W, CO.groundY, TOTAL_W, 2, colRgba(255, 238, 195, 0.55));

    // 【专属延展细节】：底部近景场边哑光防滑包边收边条 (wy: 680~720)
    fillRect(g, vp, -EXT_W, 680, TOTAL_W, 40, new Color(24, 18, 14, 255));
    fillRect(g, vp, -EXT_W, 680, TOTAL_W, 2, colRgba(255, 255, 255, 0.12));
    fillRect(g, vp, -EXT_W, 683, TOTAL_W, 3, new Color(234, 179, 8, 200)); // 专业防滑警戒黄线

    // 9. 标线与暗角
    this.drawLines(g, vp, colRgba(255, 248, 235, 0.92), colRgba(255, 248, 235, 0.55));
    this.drawVignette(g, vp, 0.52);
  }

  // ============================================================
  // 主题 2: 阳光椰林海滩 (Sunny Beach)
  // ============================================================
  private drawBeach(g: Graphics, vp: Viewport, time: number, glow: number): void {
    // 1. 蔚蓝晴空渐变 (0~270)
    fillVerticalGradient(
      g,
      vp,
      -EXT_W,
      0,
      TOTAL_W,
      270,
      [
        { stop: 0, color: new Color(37, 99, 235, 255) },
        { stop: 0.35, color: new Color(56, 189, 248, 255) },
        { stop: 0.8, color: new Color(125, 211, 252, 255) },
        { stop: 1, color: new Color(186, 230, 253, 255) },
      ],
      10
    );

    // 远景海岛剪影
    for (const isl of this.beachIslands) {
      fillEllipse(g, vp, isl.x, isl.y, isl.w * 0.5, isl.h, colRgba(40, 110, 145, 0.45));
    }

    // 2. 远景海浪与海平线 (250~470)
    fillVerticalGradient(
      g,
      vp,
      -EXT_W,
      250,
      TOTAL_W,
      CO.groundY - 250,
      [
        { stop: 0, color: new Color(2, 132, 199, 255) },
        { stop: 0.4, color: new Color(3, 105, 161, 255) },
        { stop: 0.85, color: new Color(7, 89, 133, 255) },
        { stop: 1, color: new Color(12, 74, 110, 255) },
      ],
      8
    );

    // 远海微型三角白帆船
    for (const boat of this.beachBoats) {
      boat.x += boat.speed;
      if (boat.x > W + 40) boat.x = -EXT_W;
      if (boat.x < -EXT_W) boat.x = W + 40;
      const by = boat.y + Math.sin(time * 0.05 + boat.bobPh) * 1.6;

      fillRect(g, vp, boat.x - 7, by, 14, 3, new Color(30, 58, 95, 255));
      g.fillColor = colRgba(255, 255, 255, 0.90);
      g.moveTo(vp.x(boat.x - 2), vp.y(by - 1));
      g.lineTo(vp.x(boat.x - 2), vp.y(by - 12));
      g.lineTo(vp.x(boat.x + 6), vp.y(by - 3));
      g.close();
      g.fill();
    }

    // 翻滚波浪白线 (双层动态相位流动)
    g.strokeColor = colRgba(255, 255, 255, 0.65);
    g.lineWidth = 2.5;
    for (let x = -EXT_W; x < TOTAL_W; x += 16) {
      const wy = 270 + Math.sin(time * 0.04 + x * 0.03) * 3;
      if (x === -EXT_W) g.moveTo(vp.x(x), vp.y(wy));
      else g.lineTo(vp.x(x), vp.y(wy));
    }
    g.stroke();

    g.strokeColor = colRgba(255, 255, 255, 0.40);
    g.lineWidth = 1.8;
    for (let x = -EXT_W; x < TOTAL_W; x += 16) {
      const wy = 290 + Math.sin(time * 0.05 + x * 0.02 + 1.5) * 4;
      if (x === -EXT_W) g.moveTo(vp.x(x), vp.y(wy));
      else g.lineTo(vp.x(x), vp.y(wy));
    }
    g.stroke();

    // 3. 耀眼太阳光芒与同心光晕
    fillConcentricGlow(
      g,
      vp,
      820,
      70,
      180 + glow * 30,
      140 + glow * 20,
      colRgba(255, 255, 255, 0.95),
      colRgba(253, 224, 71, 0),
      5
    );

    // 4. 浮动白云
    for (const c of this.beachClouds) {
      c.x += c.speed * (1.0 + glow * 0.2);
      if (c.x > W + 80) c.x = -150;
      const col = colRgba(255, 255, 255, c.alpha * 0.85);
      fillEllipse(g, vp, c.x, c.y, c.w * 0.5, c.h * 0.5, col);
      fillEllipse(g, vp, c.x + c.w * 0.2, c.y - 6, c.w * 0.35, c.h * 0.6, col);
      fillEllipse(g, vp, c.x - c.w * 0.2, c.y - 3, c.w * 0.3, c.h * 0.5, col);
    }

    // 5. 飞翔海鸥
    g.strokeColor = colRgba(255, 255, 255, 0.85);
    g.lineWidth = 1.8;
    for (const bg of this.beachSeagulls) {
      bg.x += bg.vx * (1.0 + glow * 0.25);
      if (bg.x > W + 40) bg.x = -40;
      const wingY = Math.sin(time * 0.1 + bg.ph) * 4 * bg.scale;
      const s = bg.scale;
      g.moveTo(vp.x(bg.x - 10 * s), vp.y(bg.y + wingY));
      g.quadraticCurveTo(vp.x(bg.x - 4 * s), vp.y(bg.y - 4 * s), vp.x(bg.x), vp.y(bg.y));
      g.quadraticCurveTo(vp.x(bg.x + 4 * s), vp.y(bg.y - 4 * s), vp.x(bg.x + 10 * s), vp.y(bg.y + wingY));
    }
    g.stroke();

    // 6. 左侧热带椰子树剪影 (带微风叶片摆动)
    g.strokeColor = new Color(69, 36, 16, 255);
    g.lineWidth = 14;
    g.moveTo(vp.x(35), vp.y(CO.groundY));
    g.quadraticCurveTo(vp.x(80), vp.y(240), vp.x(110), vp.y(120));
    g.stroke();

    // 树冠椰子
    fillCircle(g, vp, 106, 126, 5, new Color(56, 26, 6, 255));
    fillCircle(g, vp, 114, 128, 4.5, new Color(56, 26, 6, 255));
    fillCircle(g, vp, 110, 134, 4.5, new Color(56, 26, 6, 255));

    // 柔韧风动椰树叶簇
    const fronds = [-0.9, -0.5, -0.1, 0.3, 0.7, 1.1, 1.5];
    g.strokeColor = new Color(22, 101, 52, 255);
    g.lineWidth = 4;
    for (const a of fronds) {
      const sway = Math.sin(time * 0.032 + a * 2.0) * 0.07;
      const curA = a + sway;
      const ex = 110 + Math.cos(curA) * 75;
      const ey = 120 + Math.sin(curA) * 55;
      const cx = 110 + Math.cos(curA) * 40;
      const cy = 120 + Math.sin(curA) * 20 - 15;
      g.moveTo(vp.x(110), vp.y(120));
      g.quadraticCurveTo(vp.x(cx), vp.y(cy), vp.x(ex), vp.y(ey));
    }
    g.stroke();

    // 7. 右侧木质遮阳伞与躺椅
    fillRect(g, vp, 880, 310, 6, 160, new Color(120, 53, 15, 255));
    // 红白相间伞盖
    g.fillColor = new Color(239, 68, 68, 255);
    g.moveTo(vp.x(810), vp.y(335));
    g.lineTo(vp.x(950), vp.y(335));
    g.lineTo(vp.x(883), vp.y(290));
    g.close();
    g.fill();

    g.fillColor = new Color(255, 255, 255, 255);
    for (let sx = 825; sx <= 935; sx += 30) {
      g.moveTo(vp.x(sx), vp.y(335));
      g.lineTo(vp.x(sx + 15), vp.y(335));
      g.lineTo(vp.x(883), vp.y(290));
      g.close();
      g.fill();
    }
    // 躺椅
    g.strokeColor = new Color(180, 83, 9, 255);
    g.lineWidth = 3.5;
    g.moveTo(vp.x(820), vp.y(440));
    g.lineTo(vp.x(855), vp.y(460));
    g.lineTo(vp.x(875), vp.y(460));
    g.stroke();

    // 8. 【核心·金黄沙滩全屏铺满延伸】：延伸至 BOTTOM_WY (720)
    fillVerticalGradient(
      g,
      vp,
      -EXT_W,
      CO.groundY,
      TOTAL_W,
      BOTTOM_WY - CO.groundY,
      [
        { stop: 0, color: new Color(253, 230, 138, 255) },
        { stop: 0.25, color: new Color(252, 211, 77, 255) },
        { stop: 0.6, color: new Color(245, 158, 11, 255) },
        { stop: 0.85, color: new Color(217, 119, 6, 255) },
        { stop: 1, color: new Color(154, 76, 10, 255) }, // 近景略暗干沙
      ],
      12
    );

    // 散落贝壳与沙斑 (包含近景延伸区)
    for (const sh of this.beachShells) {
      fillCircle(g, vp, sh.x, sh.y, sh.size, sh.col);
    }

    // 潮水退去湿润水渍呼吸线
    const wetAlpha = 0.65 + Math.sin(time * 0.04) * 0.15;
    fillRect(g, vp, -EXT_W, CO.groundY - 2, TOTAL_W, 3, colRgba(255, 255, 255, wetAlpha));
    fillRect(g, vp, -EXT_W, CO.groundY + 1, TOTAL_W, 2, colRgba(180, 83, 9, 0.35));

    // 【专属延展细节】：近景浅水潮汐湿润光斑 (wy: 620~700)
    for (let bx = -EXT_W + 100; bx < TOTAL_W; bx += 260) {
      fillEllipse(g, vp, bx, 650, 90, 18, colRgba(254, 240, 138, 0.12));
    }

    // 9. 沙滩防滑编织织带标线与暗角
    this.drawLines(g, vp, new Color(2, 132, 199, 255), colRgba(2, 132, 199, 0.65));
    this.drawVignette(g, vp, 0.28);
  }

  // ============================================================
  // 主题 3: 赛博霓虹夜市 (Cyber Neon City)
  // ============================================================
  private drawCyber(g: Graphics, vp: Viewport, time: number, glow: number): void {
    // 1. 深邃暗紫与电光天幕
    fillVerticalGradient(
      g,
      vp,
      -EXT_W,
      0,
      TOTAL_W,
      CO.groundY,
      [
        { stop: 0, color: new Color(8, 4, 20, 255) },
        { stop: 0.4, color: new Color(19, 9, 38, 255) },
        { stop: 0.8, color: new Color(26, 11, 54, 255) },
        { stop: 1, color: new Color(38, 14, 69, 255) },
      ],
      12
    );

    // 2. 远景激光透视网格
    g.strokeColor = colRgba(255, 0, 127, 0.18);
    g.lineWidth = 1;
    for (let y = 140; y < CO.groundY; y += 22) {
      g.moveTo(vp.x(-EXT_W), vp.y(y));
      g.lineTo(vp.x(TOTAL_W), vp.y(y));
    }
    for (let x = -EXT_W; x < TOTAL_W; x += 40) {
      g.moveTo(vp.x(x), vp.y(140));
      g.lineTo(vp.x(W / 2 + (x - W / 2) * 1.8), vp.y(CO.groundY));
    }
    g.stroke();

    // 3. 远景摩天大楼天际线与窗格矩阵
    for (const b of this.cyberBuildings) {
      const topY = CO.groundY - b.h;
      const bCol = hslToRgb(b.hue, 0.40, 0.09, 1.0);
      const strokeCol = hslToRgb(b.hue, 0.80, 0.55, 0.4);

      fillRect(g, vp, b.x, topY, b.w, b.h, bCol);
      strokeRect(g, vp, b.x, topY, b.w, b.h, strokeCol, 1);

      // 大楼通讯天线与慢闪航空警示红灯
      if (b.antenna) {
        const ax = b.x + b.antenna.offX;
        const ay = topY - b.antenna.h;
        fillRect(g, vp, ax, ay, 1.5, b.antenna.h, new Color(71, 85, 105, 255));
        const blink = Math.sin(time * 0.07 + b.antenna.beaconPh);
        if (blink > 0.2) {
          fillCircle(g, vp, ax + 0.75, ay, 2.2, new Color(239, 68, 68, 255));
        }
      }

      // 点阵发光窗格
      for (let r = 0; r < 8; r++) {
        for (let col = 0; col < 2; col++) {
          if (b.windows[(r * 2 + col) % b.windows.length]) {
            const wCol = col % 2 ? colRgba(0, 240, 255, 0.75) : colRgba(255, 0, 127, 0.75);
            fillRect(g, vp, b.x + 6 + col * (b.w - 18), topY + 16 + r * 14, 4, 6, wCol);
          }
        }
      }
    }

    // 4. 赛博全息 HUD 标语屏
    fillRect(g, vp, -EXT_W, 72, TOTAL_W, 32, colRgba(10, 4, 25, 0.85));
    fillRect(g, vp, -EXT_W, 72, TOTAL_W, 2, new Color(255, 0, 127, 255));
    fillRect(g, vp, -EXT_W, 102, TOTAL_W, 2, new Color(0, 240, 255, 255));

    // 全息滚动科技色块与数码字符块
    const cyberOff = (time * 2.2) % 240;
    for (let x = -EXT_W; x < TOTAL_W; x += 28) {
      const isCyan = (x + cyberOff) % 110 < 55;
      const col = isCyan ? colRgba(0, 240, 255, 0.75) : colRgba(255, 0, 127, 0.75);
      fillRect(g, vp, x, 84, 14, 8, col);
    }

    // 5. 顶棚激光发射器与双色霓虹光幕 (随相持升温)
    const cyberBeamAlpha = 0.22 + glow * 0.08;
    for (const lamp of LAMPS) {
      const isPink = lamp === 480;
      const segs = 4;
      for (let s = 0; s < segs; s++) {
        const t1 = s / segs;
        const t2 = (s + 1) / segs;
        const y1 = 20 + t1 * (CO.groundY - 20);
        const y2 = 20 + t2 * (CO.groundY - 20);
        const w1 = 30 + t1 * (150 - 30);
        const w2 = 30 + t2 * (150 - 30);
        const a = cyberBeamAlpha * (1.0 - t1 * 0.8);
        const col = isPink ? colRgba(255, 0, 127, a) : colRgba(0, 240, 255, a);

        g.fillColor = col;
        g.moveTo(vp.x(lamp - w1), vp.y(y1));
        g.lineTo(vp.x(lamp + w1), vp.y(y1));
        g.lineTo(vp.x(lamp + w2), vp.y(y2));
        g.lineTo(vp.x(lamp - w2), vp.y(y2));
        g.close();
        g.fill();
      }

      fillRect(g, vp, lamp - 24, 0, 48, 18, new Color(26, 11, 54, 255));
      fillRect(g, vp, lamp - 20, 14, 40, 4, isPink ? new Color(255, 0, 127, 255) : new Color(0, 240, 255, 255));
    }

    // 向上反重力漂浮数码粒子
    const cyberSpeedMul = 1.0 + glow * 0.3;
    for (const p of this.cyberParticles) {
      p.y += p.speedY * cyberSpeedMul;
      p.x += p.speedX * cyberSpeedMul;
      if (p.y < 30) p.y = CO.groundY - 10;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      fillRect(g, vp, p.x, p.y, p.size, p.size, p.color);
    }

    // 6. 【核心·赛博合金高光地面与透视网格延伸】：延伸至 BOTTOM_WY (720)
    fillVerticalGradient(
      g,
      vp,
      -EXT_W,
      CO.groundY,
      TOTAL_W,
      BOTTOM_WY - CO.groundY,
      [
        { stop: 0, color: new Color(16, 9, 34, 255) },
        { stop: 0.35, color: new Color(24, 13, 50, 255) },
        { stop: 0.7, color: new Color(33, 15, 68, 255) },
        { stop: 1, color: new Color(12, 6, 26, 255) },
      ],
      10
    );

    // 【专属延展细节】：大透视地面纵向激光网格向下大幅张开延伸
    g.strokeColor = colRgba(0, 240, 255, 0.22);
    g.lineWidth = 1;
    for (let y = CO.groundY + 25; y < BOTTOM_WY; y += 32) {
      g.moveTo(vp.x(-EXT_W), vp.y(y));
      g.lineTo(vp.x(TOTAL_W), vp.y(y));
    }
    // 透视纵深放射斜线 (从天际延伸经地面至底边 720)
    for (let x = -EXT_W; x < TOTAL_W; x += 60) {
      g.moveTo(vp.x(x), vp.y(CO.groundY));
      g.lineTo(vp.x(W / 2 + (x - W / 2) * 1.6), vp.y(BOTTOM_WY));
    }
    g.stroke();

    // 【专属延展细节】：摩天大楼与全息屏的垂直霓虹高光倒影 (地面反光感)
    for (const b of this.cyberBuildings) {
      if (b.h > 200) {
        const refCol = hslToRgb(b.hue, 1.0, 0.5, 0.08 + glow * 0.04);
        fillRect(g, vp, b.x, CO.groundY + 4, b.w, 140, refCol);
      }
    }

    // 地表导光光缆走线与脉冲数据流
    for (const tr of this.cyberFloorTraces) {
      const traceCol = hslToRgb(tr.hue, 1.0, 0.5, 0.25);
      drawLine(g, vp, tr.x1, tr.y, tr.x2, tr.y, traceCol, 1.5);

      const pulseT = (time * 1.6) % (tr.x2 - tr.x1);
      const pxX = tr.x1 + pulseT;
      const pCol = tr.hue === 190 ? new Color(0, 240, 255, 255) : new Color(255, 0, 127, 255);
      fillRect(g, vp, pxX - 6, tr.y - 1.5, 12, 3, pCol);
    }

    // 地面发光边线与霓虹光斑
    fillRect(g, vp, -EXT_W, CO.groundY, TOTAL_W, 2, new Color(0, 240, 255, 255));
    for (const lamp of LAMPS) {
      const isPink = lamp === 480;
      fillConcentricGlow(
        g,
        vp,
        lamp,
        CO.groundY + 12,
        160,
        36,
        isPink ? colRgba(255, 0, 127, 0.28) : colRgba(0, 240, 255, 0.28),
        colRgba(0, 0, 0, 0),
        3
      );
    }

    // 7. 发光双色场地标线与暗角
    this.drawLines(g, vp, new Color(0, 240, 255, 255), colRgba(255, 0, 127, 0.85));
    this.drawVignette(g, vp, 0.65);
  }

  // ============================================================
  // 主题 4: 竹林和风道场 (Bamboo Dojo)
  // ============================================================
  private drawDojo(g: Graphics, vp: Viewport, time: number, glow: number): void {
    // 1. 水墨晨雾灰青天际
    fillVerticalGradient(
      g,
      vp,
      -EXT_W,
      0,
      TOTAL_W,
      CO.groundY,
      [
        { stop: 0, color: new Color(22, 32, 36, 255) },
        { stop: 0.4, color: new Color(33, 47, 52, 255) },
        { stop: 0.75, color: new Color(43, 61, 66, 255) },
        { stop: 1, color: new Color(54, 75, 79, 255) },
      ],
      10
    );

    // 远景水墨远山
    for (const m of this.dojoMountains) {
      fillEllipse(g, vp, m.cx, m.cy, m.rx, m.ry, colRgba(18, 28, 32, 0.55));
    }
    // 山脚晨雾轻纱
    fillVerticalGradient(
      g,
      vp,
      -EXT_W,
      210,
      TOTAL_W,
      80,
      [
        { stop: 0, color: colRgba(220, 235, 230, 0) },
        { stop: 0.5, color: colRgba(220, 235, 230, 0.08) },
        { stop: 1, color: colRgba(220, 235, 230, 0) },
      ],
      4
    );

    // 2. 日式木构挑檐椽条与斗拱 (屋檐梁顶)
    fillRect(g, vp, -EXT_W, 0, TOTAL_W, 22, new Color(28, 20, 14, 255));
    fillRect(g, vp, -EXT_W, 22, TOTAL_W, 6, new Color(54, 34, 21, 255));
    for (let x = -EXT_W + 12; x < TOTAL_W; x += 32) {
      fillRect(g, vp, x, 24, 14, 26, new Color(38, 23, 13, 255));
      fillRect(g, vp, x + 2, 48, 10, 4, new Color(82, 50, 28, 255));
    }

    // 3. 青翠修竹竹林剪影与竹节高光
    for (const b of this.dojoBamboos) {
      const col = b.colorTone > 0.5 ? new Color(25, 51, 38, 255) : new Color(36, 68, 52, 255);
      g.fillColor = col;
      g.moveTo(vp.x(b.x - b.w / 2), vp.y(45));
      g.lineTo(vp.x(b.x + b.w / 2), vp.y(45));
      g.lineTo(vp.x(b.x + b.w / 2 + b.lean), vp.y(CO.groundY));
      g.lineTo(vp.x(b.x - b.w / 2 + b.lean), vp.y(CO.groundY));
      g.close();
      g.fill();

      for (const jy of b.joints) {
        fillRect(g, vp, b.x - b.w / 2 - 2, jy, b.w + 4, 3, new Color(66, 107, 84, 255));
      }
    }

    // 4. 日式木格障子门屏风 (Shoji Screens，内透竹影)
    fillRect(g, vp, -EXT_W, 280, TOTAL_W, 150, colRgba(245, 237, 218, 0.16));

    // 屏风透光竹影
    for (const sh of this.dojoShojiShadows) {
      g.fillColor = colRgba(22, 38, 30, 0.15);
      g.moveTo(vp.x(sh.x - sh.w / 2), vp.y(280));
      g.lineTo(vp.x(sh.x + sh.w / 2), vp.y(280));
      g.lineTo(vp.x(sh.x + sh.w / 2 + sh.lean), vp.y(426));
      g.lineTo(vp.x(sh.x - sh.w / 2 + sh.lean), vp.y(426));
      g.close();
      g.fill();
    }

    fillRect(g, vp, -EXT_W, 280, TOTAL_W, 4, new Color(56, 35, 21, 255));
    fillRect(g, vp, -EXT_W, 426, TOTAL_W, 4, new Color(38, 23, 13, 255));
    g.strokeColor = colRgba(56, 35, 21, 0.65);
    g.lineWidth = 2;
    for (let x = -EXT_W; x < TOTAL_W; x += 40) {
      g.moveTo(vp.x(x), vp.y(280));
      g.lineTo(vp.x(x), vp.y(426));
    }
    for (let y = 300; y < 426; y += 28) {
      g.moveTo(vp.x(-EXT_W), vp.y(y));
      g.lineTo(vp.x(TOTAL_W), vp.y(y));
    }
    g.stroke();

    // 5. 暖色和纸折叠灯笼 (Lanterns，带烛火明灭呼吸)
    for (const l of this.dojoLanterns) {
      fillRect(g, vp, l.x - 1, 45, 2, l.y - 45 - l.r, new Color(69, 40, 21, 255));
      const candleFlicker = Math.sin(time * 0.11 + l.x) * 2;
      const glowR = (l.r * 2.2 + candleFlicker) * (1.0 + glow * 0.15);

      fillConcentricGlow(
        g,
        vp,
        l.x,
        l.y,
        glowR,
        glowR,
        colRgba(255, 240, 180, 0.95),
        colRgba(249, 115, 22, 0),
        4
      );

      // 灯笼实体
      fillEllipse(g, vp, l.x, l.y, l.r, l.r * 1.25, new Color(234, 88, 12, 255));
      fillRect(g, vp, l.x - l.r * 0.7, l.y - l.r * 1.25, l.r * 1.4, 4, new Color(38, 23, 13, 255));
      fillRect(g, vp, l.x - l.r * 0.7, l.y + l.r * 1.25 - 4, l.r * 1.4, 4, new Color(38, 23, 13, 255));
    }

    // 6. 随风漂浮盘旋的淡粉樱花瓣与竹叶
    const petalSpeedMul = 1.0 + glow * 0.3;
    for (const p of this.dojoPetals) {
      p.x += p.vx * petalSpeedMul;
      p.y += p.vy * petalSpeedMul;
      p.rot += p.vrot;
      if (p.y > CO.groundY) {
        p.y = 40;
        p.x = Math.random() * W;
      }
      if (p.x > W) p.x = 0;
      fillEllipse(g, vp, p.x, p.y, p.size * 1.5, p.size * 0.8, colRgba(251, 207, 232, p.alpha));
    }

    // 7. 【核心·草编榻榻米地坪延展与和风回廊缘侧】：延伸至 BOTTOM_WY (720)
    // 榻榻米从 470 铺至 620
    fillVerticalGradient(
      g,
      vp,
      -EXT_W,
      CO.groundY,
      TOTAL_W,
      620 - CO.groundY,
      [
        { stop: 0, color: new Color(132, 150, 109, 255) },
        { stop: 0.4, color: new Color(113, 131, 91, 255) },
        { stop: 1, color: new Color(82, 99, 62, 255) },
      ],
      8
    );

    // 榻榻米黑布包边拼接格
    g.strokeColor = new Color(56, 35, 21, 255);
    g.lineWidth = 3;
    for (let tx = -EXT_W; tx < TOTAL_W; tx += 96) {
      strokeRect(g, vp, tx, CO.groundY, 96, 620 - CO.groundY, new Color(56, 35, 21, 255), 2.5);
    }
    fillRect(g, vp, -EXT_W, CO.groundY, TOTAL_W, 2, colRgba(254, 240, 138, 0.45));

    // 【专属延展细节】：底部深褐色和风实木回廊缘侧 (Engawa / 縁側, wy: 620~720)
    fillRect(g, vp, -EXT_W, 620, TOTAL_W, 6, new Color(24, 14, 8, 255)); // 黑漆包边收边木条
    fillVerticalGradient(
      g,
      vp,
      -EXT_W,
      626,
      TOTAL_W,
      94,
      [
        { stop: 0, color: new Color(42, 21, 12, 255) },
        { stop: 0.5, color: new Color(32, 15, 8, 255) },
        { stop: 1, color: new Color(18, 8, 4, 255) },
      ],
      5
    );

    // 实木横向长地板分缝与铜钉
    for (let py = 648; py < 720; py += 22) {
      fillRect(g, vp, -EXT_W, py, TOTAL_W, 2, new Color(14, 6, 2, 255));
      fillRect(g, vp, -EXT_W, py + 2, TOTAL_W, 1, colRgba(255, 255, 255, 0.08));
    }
    for (let px = -EXT_W + 40; px < TOTAL_W; px += 80) {
      fillCircle(g, vp, px, 638, 1.8, new Color(217, 119, 6, 200)); // 金铜固定泡钉
    }

    // 8. 暗朱红场地标线与暗角
    this.drawLines(g, vp, new Color(220, 38, 38, 255), colRgba(220, 38, 38, 0.65));
    this.drawVignette(g, vp, 0.48);
  }

  // ------------------------------------------------------------
  // 通用场地标线与暗角
  // ------------------------------------------------------------
  private drawLines(g: Graphics, vp: Viewport, mainCol: Color, subCol: Color): void {
    // 地表主基准水平线
    drawLine(g, vp, CO.left, CO.groundY + 1, CO.right, CO.groundY + 1, mainCol, 3);

    // 场地四条向近景延伸的纵向透视界线
    for (const x of [CO.left, CO.right, CO.shortServeL, CO.shortServeR]) {
      const slant = x < W / 2 ? 14 : -14;
      drawLine(g, vp, x, CO.groundY + 4, x + slant, BOTTOM_WY, subCol, 2);
    }
  }

  private drawVignette(g: Graphics, vp: Viewport, maxAlpha: number): void {
    fillConcentricGlow(
      g,
      vp,
      W / 2,
      H * 0.5,
      640,
      380,
      colRgba(0, 0, 0, 0),
      colRgba(0, 0, 0, maxAlpha),
      4
    );
  }

  // ============================================================
  // 球网受力物理系统 (Net Jiggle & Wave Dynamics)
  // ============================================================
  drawNet(g: Graphics, vp: Viewport, shake?: number): void {
    const top = CO.netTopY;
    const gy = CO.groundY;
    const x = CO.netX;
    const halfW = 5;

    const amp = shake != null ? shake : this.netShakeAmp;
    // 柱头弹性弯曲阻尼正弦摆动
    const poleDX = amp > 0.001 ? Math.sin(this.netShakeTime * 0.48) * amp * 2.2 : 0;

    let poleCol1 = new Color(36, 43, 69, 255);
    let poleCol2 = new Color(72, 84, 138, 255);
    let netMeshCol = colRgba(201, 214, 255, 0.52);
    let tapeCol1 = new Color(246, 243, 234, 255);
    let tapeCol2 = new Color(200, 194, 178, 255);
    let capCol = new Color(255, 225, 77, 255);

    if (this.currentTheme === "beach") {
      poleCol1 = new Color(120, 53, 15, 255);
      poleCol2 = new Color(146, 64, 14, 255);
      netMeshCol = colRgba(255, 255, 255, 0.52);
      tapeCol1 = new Color(239, 68, 68, 255);
      tapeCol2 = new Color(255, 255, 255, 255);
      capCol = new Color(253, 224, 71, 255);
    } else if (this.currentTheme === "cyber") {
      poleCol1 = new Color(9, 5, 20, 255);
      poleCol2 = new Color(255, 0, 127, 255);
      netMeshCol = colRgba(0, 240, 255, 0.52);
      tapeCol1 = new Color(0, 240, 255, 255);
      tapeCol2 = new Color(255, 0, 127, 255);
      capCol = new Color(0, 240, 255, 255);
    } else if (this.currentTheme === "dojo") {
      poleCol1 = new Color(43, 24, 16, 255);
      poleCol2 = new Color(84, 51, 32, 255);
      netMeshCol = colRgba(226, 217, 200, 0.52);
      tapeCol1 = new Color(220, 38, 38, 255);
      tapeCol2 = new Color(153, 27, 27, 255);
      capCol = new Color(251, 191, 36, 255);
    }

    // 沙滩场地专属: 立柱抗海风斜撑拉线与地面地锚木桩
    if (this.currentTheme === "beach") {
      g.strokeColor = colRgba(120, 53, 15, 0.45);
      g.lineWidth = 1.2;
      g.moveTo(vp.x(x + poleDX), vp.y(top + 2));
      g.lineTo(vp.x(x - 38), vp.y(gy));
      g.moveTo(vp.x(x + poleDX), vp.y(top + 2));
      g.lineTo(vp.x(x + 38), vp.y(gy));
      g.stroke();

      fillRect(g, vp, x - 40, gy - 4, 4, 6, new Color(92, 43, 9, 255));
      fillRect(g, vp, x + 36, gy - 4, 4, 6, new Color(92, 43, 9, 255));
    }

    // 1. 双立柱 (底部固定于 groundY，顶部受力产生弹性倾斜)
    drawLine(g, vp, x + poleDX, top - 4, x, gy, poleCol1, 2);
    drawLine(g, vp, x + poleDX - 0.5, top - 4, x - 0.5, gy, poleCol2, 1);

    // 2. 网面水平横线 (带高斯衰减的受击正弦行波波动)
    g.strokeColor = netMeshCol;
    g.lineWidth = 1;
    for (let yy = top + 3; yy < gy; yy += 6) {
      let wave = 0;
      if (amp > 0.001) {
        const falloff = Math.exp(-Math.abs(yy - this.netHitY) / 26);
        wave = Math.sin(this.netShakeTime * 0.55 + (yy - top) * 0.08) * amp * 3.6 * falloff;
      }
      g.moveTo(vp.x(x - halfW + wave), vp.y(yy));
      g.lineTo(vp.x(x + halfW + wave), vp.y(yy));
    }

    // 垂直纵线 (连接顶部摆动点与底部固定锚点)
    for (let xx = -halfW; xx <= halfW; xx += 5) {
      const topX = x + xx + poleDX;
      const botX = x + xx;
      g.moveTo(vp.x(topX), vp.y(top + 2));
      g.lineTo(vp.x(botX), vp.y(gy));
    }
    g.stroke();

    // 3. 网顶白带 (双层分色 + 白色高光，跟随 poleDX 摆动)
    const tx = x + poleDX;
    fillRect(g, vp, tx - 6, top - 2, 12, 3, tapeCol1);
    fillRect(g, vp, tx - 6, top + 1, 12, 1, tapeCol2);
    fillRect(g, vp, tx - 6, top - 2, 12, 1, new Color(255, 255, 255, 255));

    // 赛博场专属: 撞网电火花放电折线
    if (this.currentTheme === "cyber" && amp > 0.2) {
      g.strokeColor = new Color(0, 240, 255, 255);
      g.lineWidth = 1.2;
      g.moveTo(vp.x(tx - 4), vp.y(top));
      g.lineTo(vp.x(tx - 8 + Math.sin(this.netShakeTime * 2) * 5), vp.y(top - 6));
      g.moveTo(vp.x(tx + 4), vp.y(top));
      g.lineTo(vp.x(tx + 8 + Math.cos(this.netShakeTime * 2) * 5), vp.y(top - 4));
      g.stroke();
    }

    // 4. 柱头金属帽
    fillCircle(g, vp, tx, top - 4.5, 2.2, capCol);
  }
}

// ------------------------------------------------------------
// 单例与向后兼容导出
// ------------------------------------------------------------
export const courtRenderer = new CourtRenderer();

/** 向后兼容的纯函数绘制接口 */
export function drawCourt(g: Graphics, vp: Viewport, rallyCount = 0): void {
  courtRenderer.draw(g, vp, rallyCount);
}
