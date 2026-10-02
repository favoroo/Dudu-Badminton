// ============================================================
// P5 潮酷街机风格人物形象 高精度重构 Demo v2.0
//
// 针对 v1.0 机械拼凑/几何木偶感的彻底重写:
// 1. 废除生硬胶囊与裸露关节圆，全面引入解剖学肌肉流线与贝塞尔曲线
// 2. 重塑精致锐利的二次元面容: 清晰眼眶、多层瞳孔高光、英气剑眉、立体鼻梁与自信嘴角
// 3. 层次丰富的飞扬发型与动感发带: 碎发阴影层、主发簇、烈焰红挑染发梢、飘舞后带
// 4. 机能风流线球衣与人体工学: 倒三角胸背、V领包边、斜切动感涂装、肌肉转折自然衔接
// 5. 5.5 头身黄金竞技比例 + SW.pivotY=-70px 肩点锁定铁律
// ============================================================

import "./cc-stub";
import * as fs from "fs";
import * as path from "path";
import { Graphics as StubGraphics, opsToSvg } from "./cc-stub";

export interface CharacterTheme {
  name: string;
  hairBase: string;
  hairHi: string;
  headband: string;
  headbandAccent: string;
  skin: string;
  skinShadow: string;
  eyeIris: string;
  eyeHighlight: string;
  jerseyMain: string;
  jerseyShadow: string;
  jerseyStripe1: string;
  jerseyStripe2: string;
  pants: string;
  pantsShadow: string;
  pantsStripe: string;
  wristband: string;
  sock: string;
  shoeMain: string;
  shoeAccent: string;
  shoeSole: string;
  racketFrame: string;
  racketGrip: string;
}

export const THEMES: Record<string, CharacterTheme> = {
  "p5-ken": {
    name: "P5 斩劈红黑 (Ken)",
    hairBase: "#12131a",
    hairHi: "#e60012",       // 标志性斩劈红挑染
    headband: "#0a0a0f",
    headbandAccent: "#ffe14d",// 荧光黄条纹
    skin: "#ffe4cf",
    skinShadow: "#e8bfa0",
    eyeIris: "#e60012",
    eyeHighlight: "#ffffff",
    jerseyMain: "#1a1c26",
    jerseyShadow: "#101118",
    jerseyStripe1: "#e60012",
    jerseyStripe2: "#ffe14d",
    pants: "#14151e",
    pantsShadow: "#0d0e14",
    pantsStripe: "#e60012",
    wristband: "#e60012",
    sock: "#f8fafc",
    shoeMain: "#1a1c24",
    shoeAccent: "#e60012",
    shoeSole: "#ffffff",
    racketFrame: "#e60012",
    racketGrip: "#111218",
  },
  "shonen-blue": {
    name: "清流高校蓝 (Shonen)",
    hairBase: "#1e293b",
    hairHi: "#38bdf8",
    headband: "#1d4ed8",
    headbandAccent: "#ffffff",
    skin: "#ffeedb",
    skinShadow: "#ebcbb0",
    eyeIris: "#2563eb",
    eyeHighlight: "#ffffff",
    jerseyMain: "#2563eb",
    jerseyShadow: "#1e40af",
    jerseyStripe1: "#ffffff",
    jerseyStripe2: "#38bdf8",
    pants: "#1e3a8a",
    pantsShadow: "#172554",
    pantsStripe: "#ffffff",
    wristband: "#ffffff",
    sock: "#f1f5f9",
    shoeMain: "#ffffff",
    shoeAccent: "#2563eb",
    shoeSole: "#1e293b",
    racketFrame: "#38bdf8",
    racketGrip: "#1e293b",
  },
  "cyber-neon": {
    name: "赛博机能黑青 (Cyber)",
    hairBase: "#090d16",
    hairHi: "#00f0ff",
    headband: "#05080f",
    headbandAccent: "#00f0ff",
    skin: "#f5ebff",
    skinShadow: "#dac4f7",
    eyeIris: "#00f0ff",
    eyeHighlight: "#ffffff",
    jerseyMain: "#0d111a",
    jerseyShadow: "#06080d",
    jerseyStripe1: "#00f0ff",
    jerseyStripe2: "#a855f7",
    pants: "#090d14",
    pantsShadow: "#04060a",
    pantsStripe: "#00f0ff",
    wristband: "#00f0ff",
    sock: "#1e293b",
    shoeMain: "#05080f",
    shoeAccent: "#00f0ff",
    shoeSole: "#a855f7",
    racketFrame: "#00f0ff",
    racketGrip: "#05080f",
  },
};

// 绘图工具
function p(g: StubGraphics, fill?: string, stroke?: string, lw = 1) {
  g.close();
  if (fill) { g.fillColor.fromHEX(fill); g.fill(); }
  if (stroke) { g.strokeColor.fromHEX(stroke); g.lineWidth = lw; g.stroke(); }
}

function line(g: StubGraphics, x0: number, y0: number, x1: number, y1: number, col: string, lw: number) {
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.strokeColor.fromHEX(col);
  g.lineWidth = lw;
  g.stroke();
}

/** 绘制精美高精度 P5 角色 */
export function drawRefinedP5Character(
  g: StubGraphics,
  theme: CharacterTheme,
  poseType: "idle" | "ready" | "lunge" | "smash" | "run" = "idle"
): void {
  g.clear();

  // 严格锁定的判定肩点 (SW.pivotY = -70)
  const PIVOT_SHOULDER = { x: 0, y: -70 };

  // 根据不同姿势计算核心关节位移
  let hip = { x: 0, y: -36 };
  let torsoLean = 3;   // 度
  let headTilt = 0;    // 度
  let airDist = 0;     // 起跳离地高度

  let leadElbow = { x: 13, y: -57 };
  let leadWrist = { x: 21, y: -64 };
  let racketAngle = -35; // 度

  let trailElbow = { x: -9, y: -57 };
  let trailWrist = { x: -12, y: -45 };

  let leadKnee = { x: 3, y: -18 };
  let leadAnkle = { x: 6, y: 0 };
  let trailKnee = { x: -6, y: -18 };
  let trailAnkle = { x: -7, y: 0 };

  if (poseType === "ready") {
    hip = { x: 2, y: -32 }; // 屈膝下沉
    torsoLean = 7;
    headTilt = 2;
    leadElbow = { x: 15, y: -55 };
    leadWrist = { x: 25, y: -62 };
    racketAngle = -15;
    trailElbow = { x: -16, y: -65 };
    trailWrist = { x: -24, y: -75 }; // 远臂高抬导向
    leadKnee = { x: 10, y: -16 };
    leadAnkle = { x: 15, y: 0 };
    trailKnee = { x: -10, y: -15 };
    trailAnkle = { x: -14, y: 0 };
  } else if (poseType === "lunge") {
    hip = { x: 12, y: -22 }; // 大幅深蹲下沉
    torsoLean = 19;
    headTilt = 4;
    leadElbow = { x: 30, y: -44 };
    leadWrist = { x: 42, y: -38 }; // 极度前伸捞球
    racketAngle = 18;
    trailElbow = { x: -16, y: -58 };
    trailWrist = { x: -30, y: -66 }; // 远臂反向拉平
    leadKnee = { x: 29, y: -12 };
    leadAnkle = { x: 33, y: 0 };
    trailKnee = { x: -8, y: -10 };
    trailAnkle = { x: -26, y: 0 };
  } else if (poseType === "smash") {
    hip = { x: -2, y: -62 }; // 腾空离地 26px
    airDist = 26;
    torsoLean = -12;         // 身体腾空反弓
    headTilt = -9;          // 仰头锁定球体
    leadElbow = { x: -12, y: -94 }; // 肘部举过头顶蓄力
    leadWrist = { x: -2, y: -106 };
    racketAngle = -118;
    trailElbow = { x: 18, y: -79 };
    trailWrist = { x: 29, y: -89 }; // 远手直指羽毛球
    leadKnee = { x: 8, y: -45 };
    leadAnkle = { x: 3, y: -28 };
    trailKnee = { x: -7, y: -44 };
    trailAnkle = { x: -15, y: -26 };
  } else if (poseType === "run") {
    hip = { x: 0, y: -38 };
    torsoLean = 14;
    headTilt = 3;
    leadElbow = { x: 17, y: -58 };
    leadWrist = { x: 19, y: -69 };
    racketAngle = -45;
    trailElbow = { x: -15, y: -55 };
    trailWrist = { x: -21, y: -46 };
    leadKnee = { x: 18, y: -19 };
    leadAnkle = { x: 15, y: -6 };
    trailKnee = { x: -14, y: -13 };
    trailAnkle = { x: -21, y: 0 };
  }

  // ----------------------------------------------------
  // 0. 地面阴影
  // ----------------------------------------------------
  const shadowAlpha = Math.max(0.12, 0.45 - airDist * 0.012);
  const shadowScale = Math.max(0.45, 1 - airDist * 0.016);
  g.fillColor.fromHEX("#000000");
  g.ellipse(hip.x * 0.4, 0, 24 * shadowScale, 5.5 * shadowScale);
  g.fill();

  // ----------------------------------------------------
  // 1. 远侧腿 (景深压暗层, 流线型肌肉腿)
  // ----------------------------------------------------
  const tk = trailKnee;
  const ta = trailAnkle;
  const th = { x: hip.x - 2, y: hip.y };

  // 远侧大腿
  g.moveTo(th.x - 3.5, th.y);
  g.quadraticCurveTo(th.x - 5, (th.y + tk.y) * 0.5, tk.x - 3.2, tk.y);
  g.lineTo(tk.x + 3.0, tk.y);
  g.quadraticCurveTo(th.x + 4, (th.y + tk.y) * 0.5, th.x + 3.0, th.y);
  p(g, theme.pantsShadow, "#08090d", 1.0);

  // 远侧小腿 + 袜子
  g.moveTo(tk.x - 3.0, tk.y);
  g.quadraticCurveTo(tk.x - 4.5, tk.y + 9, ta.x - 2.5, ta.y - 4);
  g.lineTo(ta.x - 2.0, ta.y);
  g.lineTo(ta.x + 2.2, ta.y);
  g.lineTo(ta.x + 2.2, ta.y - 4);
  g.quadraticCurveTo(tk.x + 3.0, tk.y + 9, tk.x + 2.8, tk.y);
  p(g, theme.skinShadow, "#08090d", 1.0);

  // 远侧球鞋
  g.moveTo(ta.x - 2.5, ta.y - 3);
  g.lineTo(ta.x + 2.5, ta.y - 3);
  g.lineTo(ta.x + 9.5, ta.y + 0.5);
  g.lineTo(ta.x + 9.0, ta.y + 2.5);
  g.lineTo(ta.x - 3.5, ta.y + 2.5);
  p(g, theme.shoeMain, "#08090d", 1.0);

  // ----------------------------------------------------
  // 2. 远侧平衡臂 (景深压暗层)
  // ----------------------------------------------------
  const ts = { x: PIVOT_SHOULDER.x - 4.5, y: PIVOT_SHOULDER.y + 2.5 };
  const te = trailElbow;
  const tw = trailWrist;

  // 上臂
  g.moveTo(ts.x - 3.0, ts.y);
  g.lineTo(te.x - 2.2, te.y);
  g.lineTo(te.x + 2.2, te.y);
  g.lineTo(ts.x + 3.0, ts.y);
  p(g, theme.skinShadow, "#08090d", 1.0);
  // 袖口
  g.moveTo(ts.x - 3.8, ts.y - 1);
  g.lineTo((ts.x + te.x) * 0.5 - 3.4, (ts.y + te.y) * 0.5);
  g.lineTo((ts.x + te.x) * 0.5 + 3.4, (ts.y + te.y) * 0.5);
  g.lineTo(ts.x + 3.8, ts.y - 1);
  p(g, theme.jerseyShadow, "#08090d", 1.0);

  // 前臂与自然张开的手掌
  g.moveTo(te.x - 2.2, te.y);
  g.lineTo(tw.x - 1.8, tw.y);
  g.lineTo(tw.x + 1.8, tw.y);
  g.lineTo(te.x + 2.2, te.y);
  p(g, theme.skinShadow, "#08090d", 1.0);
  // 远手指尖微展
  g.moveTo(tw.x - 1.5, tw.y);
  g.lineTo(tw.x - 2.5, tw.y + 4.5);
  g.lineTo(tw.x + 1.0, tw.y + 3.5);
  g.lineTo(tw.x + 1.5, tw.y);
  p(g, theme.skinShadow, "#08090d", 0.8);

  // ----------------------------------------------------
  // 3. 躯干与运动球衣 (倒三角健美轮廓 + P5 斜切赛璐珞动感)
  // ----------------------------------------------------
  const sL = { x: PIVOT_SHOULDER.x - 9.0, y: PIVOT_SHOULDER.y + 4.5 }; // 后背肩端
  const sR = { x: PIVOT_SHOULDER.x + 10.5, y: PIVOT_SHOULDER.y + 2.5 };// 前胸肩端
  const hL = { x: hip.x - 6.5, y: hip.y - 1 };                        // 后腰
  const hR = { x: hip.x + 7.5, y: hip.y - 1 };                        // 前腹

  // 球衣主体轮廓 (带有微内收的腰身弧线)
  g.moveTo(sL.x, sL.y);
  g.quadraticCurveTo((sL.x + hL.x) * 0.5 - 1.2, (sL.y + hL.y) * 0.5, hL.x, hL.y);
  g.lineTo(hR.x, hR.y);
  g.quadraticCurveTo((sR.x + hR.x) * 0.5 + 1.5, (sR.y + hR.y) * 0.5, sR.x, sR.y);
  g.lineTo(PIVOT_SHOULDER.x + 1.5, PIVOT_SHOULDER.y + 2.5); // 领口
  g.lineTo(sL.x, sL.y);
  p(g, theme.jerseyMain, "#0a0c14", 1.5);

  // 侧腰背光暗面 (展现躯干的立体厚度)
  g.moveTo(sL.x, sL.y);
  g.quadraticCurveTo((sL.x + hL.x) * 0.5 - 1.2, (sL.y + hL.y) * 0.5, hL.x, hL.y);
  g.lineTo(hL.x + 4.2, hL.y);
  g.quadraticCurveTo((sL.x + hL.x) * 0.5 + 3.0, (sL.y + hL.y) * 0.5, sL.x + 3.5, sL.y);
  p(g, theme.jerseyShadow);

  // P5 锋锐斜切色带 1 (标志性斩劈红)
  g.moveTo(sL.x + 1.5, sL.y + 6.0);
  g.lineTo(sR.x - 1.0, sR.y + 13.0);
  g.lineTo(sR.x - 2.5, sR.y + 18.0);
  g.lineTo(sL.x + 0.5, sL.y + 11.0);
  p(g, theme.jerseyStripe1);

  // P5 锋锐斜切色带 2 (荧光黄利刃细线)
  g.moveTo(sL.x + 2.0, sL.y + 13.5);
  g.lineTo(sR.x - 3.5, sR.y + 20.0);
  g.lineTo(sR.x - 4.5, sR.y + 22.0);
  g.lineTo(sL.x + 1.5, sL.y + 15.5);
  p(g, theme.jerseyStripe2);

  // V 领精致包边
  const vNeckTip = { x: PIVOT_SHOULDER.x + 3.0, y: PIVOT_SHOULDER.y + 7.5 };
  line(g, PIVOT_SHOULDER.x - 1.5, PIVOT_SHOULDER.y + 2.5, vNeckTip.x, vNeckTip.y, theme.jerseyStripe2, 1.2);
  line(g, vNeckTip.x, vNeckTip.y, PIVOT_SHOULDER.x + 7.0, PIVOT_SHOULDER.y + 2.0, theme.jerseyStripe2, 1.2);

  // ----------------------------------------------------
  // 4. 运动短裤与前侧腿 (近侧强受光与肌肉流线)
  // ----------------------------------------------------
  const lk = leadKnee;
  const la = leadAnkle;
  const lh = { x: hip.x + 2.5, y: hip.y };

  // 运动短裤 (立体硬挺剪裁)
  g.moveTo(hL.x, hL.y - 1);
  g.lineTo(hR.x + 0.5, hR.y - 1);
  g.lineTo(lk.x + 4.5, lk.y - 3.5);
  g.lineTo(lk.x - 5.5, lk.y - 3.5);
  p(g, theme.pants, "#0a0c14", 1.4);
  // 短裤侧面开衩锋锐红条纹
  line(g, hR.x - 0.5, hR.y + 1.5, lk.x + 3.5, lk.y - 4.5, theme.pantsStripe, 1.8);

  // 近侧大腿 (优美的大腿肌弧线，不再是直棍！)
  g.moveTo(lh.x - 3.8, lk.y - 4.0);
  g.quadraticCurveTo(lk.x - 5.5, (lh.y + lk.y) * 0.5, lk.x - 3.8, lk.y);
  g.lineTo(lk.x + 3.8, lk.y);
  g.quadraticCurveTo(lk.x + 5.2, (lh.y + lk.y) * 0.5, lh.x + 4.0, lk.y - 4.0);
  p(g, theme.skin, "#0a0c14", 1.2);

  // 膝盖骨节自然转折 (受光亮点)
  g.fillColor.fromHEX(theme.skinShadow);
  g.circle(lk.x, lk.y - 0.5, 2.8);
  g.fill();
  g.fillColor.fromHEX(theme.skin);
  g.circle(lk.x + 0.6, lk.y - 1.2, 1.8);
  g.fill();

  // 近侧小腿 (结实的腓肠肌曲线)
  g.moveTo(lk.x - 3.5, lk.y);
  g.quadraticCurveTo(lk.x - 5.0, lk.y + 9.0, la.x - 3.0, la.y - 5.0);
  g.lineTo(la.x - 2.5, la.y);
  g.lineTo(la.x + 2.8, la.y);
  g.lineTo(la.x + 3.2, la.y - 5.0);
  g.quadraticCurveTo(lk.x + 4.2, lk.y + 9.0, lk.x + 3.2, lk.y);
  p(g, theme.skin, "#0a0c14", 1.2);

  // 专业高筒运动袜
  g.moveTo(la.x - 3.2, la.y - 5.5);
  g.lineTo(la.x + 3.2, la.y - 5.5);
  g.lineTo(la.x + 2.8, la.y - 0.5);
  g.lineTo(la.x - 2.8, la.y - 0.5);
  p(g, theme.sock, "#0a0c14", 1.0);
  // 袜子顶端黑红装饰横纹
  line(g, la.x - 3.0, la.y - 4.8, la.x + 3.0, la.y - 4.8, theme.jerseyStripe1, 1.0);

  // 专业羽毛球鞋 (流线鞋身 + 防撞鞋头 + 气垫厚底)
  const toe = { x: la.x + 11.5, y: la.y + 0.5 };
  const heel = { x: la.x - 4.5, y: la.y + 0.5 };

  // 鞋身
  g.moveTo(la.x - 3.5, la.y - 1.5);
  g.lineTo(la.x + 3.0, la.y - 1.5);
  g.quadraticCurveTo(la.x + 7.5, la.y - 1.0, toe.x, toe.y);
  g.lineTo(toe.x - 0.5, toe.y + 2.6);
  g.lineTo(heel.x, heel.y + 2.6);
  g.lineTo(heel.x - 0.5, heel.y - 0.5);
  p(g, theme.shoeMain, "#0a0c14", 1.4);

  // 鞋侧破风红刃流光
  line(g, la.x - 0.5, la.y, toe.x - 2.5, toe.y + 0.5, theme.shoeAccent, 1.8);
  // 白色防滑耐磨大底
  line(g, heel.x + 0.5, heel.y + 2.0, toe.x - 0.5, toe.y + 2.0, theme.shoeSole, 1.4);

  // ----------------------------------------------------
  // 5. 头部与脸型 (二次元帅气精髓: 锐利眼神 + 飞扬发型 + 潮流发带)
  // ----------------------------------------------------
  const neck = { x: PIVOT_SHOULDER.x + 1.5, y: PIVOT_SHOULDER.y - 1.5 };
  const head = {
    x: neck.x + 2.0 + Math.sin((headTilt * Math.PI) / 180) * 5,
    y: neck.y - 12.5,
  };

  // 脖子与喉结转折
  g.moveTo(neck.x - 3.0, neck.y + 1.0);
  g.lineTo(neck.x + 3.5, neck.y + 1.0);
  g.lineTo(head.x + 2.5, head.y + 6.0);
  g.lineTo(head.x - 2.5, head.y + 6.0);
  p(g, theme.skinShadow, "#0a0c14", 1.0);

  // 精致日漫 3/4 侧脸轮廓 (高挺鼻梁、翘下巴、紧致下颌线)
  g.moveTo(head.x - 5.5, head.y - 5.0); // 后脑发际线
  g.lineTo(head.x + 3.0, head.y - 6.5); // 额头
  g.lineTo(head.x + 6.8, head.y - 2.2); // 眉骨
  g.lineTo(head.x + 8.8, head.y + 0.8); // 鼻尖
  g.lineTo(head.x + 6.2, head.y + 3.5); // 上唇微内收
  g.lineTo(head.x + 5.2, head.y + 7.5); // 尖下巴
  g.lineTo(head.x - 1.8, head.y + 6.2); // 下颌角
  g.lineTo(head.x - 5.0, head.y + 1.5); // 耳际
  p(g, theme.skin, "#0a0c14", 1.3);

  // 脸颊立体阴影 (使下巴与脖子交界格外分明)
  g.moveTo(head.x + 5.2, head.y + 7.5);
  g.lineTo(head.x - 1.8, head.y + 6.2);
  g.lineTo(head.x - 2.5, head.y + 9.5);
  p(g, theme.skinShadow);

  // --- 五官精绘: 专注杀气的英气眼神 ---
  const eye = { x: head.x + 4.8, y: head.y - 0.2 };

  // 1) 锋锐剑眉 (眉尾斜挑上扬，粗细渐变)
  g.moveTo(eye.x - 3.5, eye.y - 3.2);
  g.lineTo(eye.x + 2.8, eye.y - 2.8);
  g.lineTo(eye.x + 3.4, eye.y - 2.2);
  g.lineTo(eye.x - 3.5, eye.y - 2.6);
  p(g, theme.hairBase);

  // 2) 眼白 (干净的月牙轮廓)
  g.moveTo(eye.x - 2.2, eye.y);
  g.quadraticCurveTo(eye.x + 0.2, eye.y - 1.6, eye.x + 2.6, eye.y - 0.5);
  g.quadraticCurveTo(eye.x + 0.2, eye.y + 1.6, eye.x - 2.2, eye.y);
  p(g, "#ffffff", "#0a0c14", 0.6);

  // 3) 虹膜 (P5 标志性赤红眼瞳)
  g.fillColor.fromHEX(theme.eyeIris);
  g.circle(eye.x + 0.5, eye.y, 1.25);
  g.fill();

  // 4) 上眼眶粗黑线 (二次元眼线，眼尾锐利飞挑，给角色注入灵魂！)
  g.moveTo(eye.x - 2.6, eye.y + 0.2);
  g.quadraticCurveTo(eye.x + 0.2, eye.y - 1.9, eye.x + 2.8, eye.y - 0.6);
  g.lineTo(eye.x + 3.6, eye.y - 1.2); // 眼尾外挑飞线
  g.strokeColor.fromHEX("#0a0c14");
  g.lineWidth = 1.6;
  g.stroke();

  // 5) 瞳孔高光 (一点白光瞬间鲜活)
  g.fillColor.fromHEX(theme.eyeHighlight);
  g.circle(eye.x + 0.8, eye.y - 0.4, 0.45);
  g.fill();

  // 6) 自信嘴角与下唇微影
  line(g, head.x + 4.2, head.y + 4.6, head.x + 6.6, head.y + 4.2, "#451a14", 1.1);

  // --- 潮流运动发带 ---
  const hBand = [
    { x: head.x - 6.0, y: head.y - 4.2 },
    { x: head.x + 6.2, y: head.y - 5.5 },
    { x: head.x + 6.5, y: head.y - 2.2 },
    { x: head.x - 5.8, y: head.y - 1.2 },
  ];
  g.moveTo(hBand[0].x, hBand[0].y);
  for (let i = 1; i < hBand.length; i++) g.lineTo(hBand[i].x, hBand[i].y);
  p(g, theme.headband, "#0a0c14", 1.1);
  // 发带金色赛博线条
  line(g, head.x - 5.0, head.y - 2.6, head.x + 6.0, head.y - 3.8, theme.headbandAccent, 1.2);

  // 发带后方随风翻飞的双飘带 (增加动作的流动感与速度感)
  g.moveTo(head.x - 5.5, head.y - 2.5);
  g.quadraticCurveTo(head.x - 12, head.y - 1.0, head.x - 15.5, head.y + 3.5);
  g.lineTo(head.x - 14.0, head.y + 5.5);
  g.quadraticCurveTo(head.x - 10, head.y + 1.0, head.x - 5.0, head.y - 0.5);
  p(g, theme.headband, "#0a0c14", 1.0);

  // --- P5 动感碎发群 (多层次立体发块 + 红色高光碎发束) ---
  // 1) 脑后与耳侧暗面底发
  g.moveTo(head.x - 5.0, head.y - 1.0);
  g.lineTo(head.x - 9.5, head.y - 3.5);
  g.lineTo(head.x - 7.5, head.y - 7.5);
  g.lineTo(head.x - 12.0, head.y - 10.0);
  g.lineTo(head.x - 8.5, head.y - 13.0);
  g.lineTo(head.x - 11.5, head.y - 15.5);
  g.lineTo(head.x - 6.0, head.y - 16.0);
  g.lineTo(head.x - 1.5, head.y - 17.5);
  g.lineTo(head.x + 3.5, head.y - 15.5);
  g.lineTo(head.x + 8.5, head.y - 11.0);
  g.lineTo(head.x + 6.0, head.y - 6.0);
  p(g, theme.hairBase, "#0a0c14", 1.4);

  // 2) 额前与头顶挑染烈焰红发缕 (P5 视觉标志！)
  // 缕 1: 头顶冲冠发束
  g.moveTo(head.x - 2.0, head.y - 15.0);
  g.lineTo(head.x + 1.5, head.y - 19.5); // 锐角冲天
  g.lineTo(head.x + 2.5, head.y - 15.5);
  p(g, theme.hairHi, "#0a0c14", 1.0);

  // 缕 2: 额前飞扬刘海 (自然垂落于眉眼之上)
  g.moveTo(head.x + 3.0, head.y - 6.5);
  g.lineTo(head.x + 8.5, head.y - 4.5);
  g.lineTo(head.x + 6.0, head.y - 1.5);
  g.lineTo(head.x + 2.5, head.y - 3.5);
  p(g, theme.hairHi, "#0a0c14", 1.0);

  // 缕 3: 眉骨前微翘小碎发
  g.moveTo(head.x + 1.0, head.y - 5.5);
  g.lineTo(head.x + 4.5, head.y - 2.0);
  g.lineTo(head.x + 2.5, head.y - 1.5);
  p(g, theme.hairBase, "#0a0c14", 0.9);

  // ----------------------------------------------------
  // 6. 近侧持拍臂 (动力学核心: 肩 -> 肱二头肌 -> 肘 -> 护腕手腕 -> 球拍)
  // ----------------------------------------------------
  const ls = { x: PIVOT_SHOULDER.x + 3.5, y: PIVOT_SHOULDER.y + 0.5 };
  const le = leadElbow;
  const lw = leadWrist;

  // 上臂肌肉线条与红黑短袖
  g.moveTo(ls.x - 3.8, ls.y);
  g.quadraticCurveTo((ls.x + le.x) * 0.5 - 4.0, (ls.y + le.y) * 0.5, le.x - 3.0, le.y);
  g.lineTo(le.x + 3.0, le.y);
  g.quadraticCurveTo((ls.x + le.x) * 0.5 + 4.2, (ls.y + le.y) * 0.5, ls.x + 3.8, ls.y);
  p(g, theme.skin, "#0a0c14", 1.3);

  // 短袖袖管 (自然包裹上臂上段)
  g.moveTo(ls.x - 4.8, ls.y - 1.0);
  g.lineTo((ls.x + le.x) * 0.5 - 4.2, (ls.y + le.y) * 0.5 - 0.5);
  g.lineTo((ls.x + le.x) * 0.5 + 4.4, (ls.y + le.y) * 0.5 + 0.5);
  g.lineTo(ls.x + 4.8, ls.y - 0.5);
  p(g, theme.jerseyMain, "#0a0c14", 1.3);
  // 袖口红色滚边
  line(
    g,
    (ls.x + le.x) * 0.5 - 4.0,
    (ls.y + le.y) * 0.5 - 0.5,
    (ls.x + le.x) * 0.5 + 4.2,
    (ls.y + le.y) * 0.5 + 0.5,
    theme.jerseyStripe1,
    1.4
  );

  // 前臂紧致肌肉流线 (绝无生硬圆圈衔接！)
  g.moveTo(le.x - 3.0, le.y);
  g.quadraticCurveTo((le.x + lw.x) * 0.5 - 3.5, (le.y + lw.y) * 0.5, lw.x - 2.6, lw.y);
  g.lineTo(lw.x + 2.6, lw.y);
  g.quadraticCurveTo((le.x + lw.x) * 0.5 + 3.5, (le.y + lw.y) * 0.5, le.x + 3.0, le.y);
  p(g, theme.skin, "#0a0c14", 1.3);

  // 标志性红色吸汗运动护腕
  const wbStart = { x: (le.x + lw.x * 2) / 3, y: (le.y + lw.y * 2) / 3 };
  g.moveTo(wbStart.x - 3.2, wbStart.y);
  g.lineTo(lw.x - 3.0, lw.y);
  g.lineTo(lw.x + 3.0, lw.y);
  g.lineTo(wbStart.x + 3.2, wbStart.y);
  p(g, theme.wristband, "#0a0c14", 1.2);

  // 抓握拍柄的紧握手拳 (五指握紧轮廓)
  g.moveTo(lw.x - 2.5, lw.y);
  g.lineTo(lw.x - 3.2, lw.y + 4.0);
  g.lineTo(lw.x + 2.5, lw.y + 4.5);
  g.lineTo(lw.x + 3.2, lw.y + 0.5);
  p(g, theme.skin, "#0a0c14", 1.2);

  // ----------------------------------------------------
  // 7. 专业羽毛球拍 (碳纤维中杆 + 高刚性拍框 + 银白拍线)
  // ----------------------------------------------------
  const rRad = (racketAngle * Math.PI) / 180;
  const cosR = Math.cos(rRad);
  const sinR = Math.sin(rRad);

  const gripBottom = { x: lw.x - cosR * 5.0, y: lw.y - sinR * 5.0 };
  const shaftTop = { x: lw.x + cosR * 26.0, y: lw.y + sinR * 26.0 };
  const racketCenter = { x: shaftTop.x + cosR * 11.0, y: shaftTop.y + sinR * 11.0 };
  const rHeadR = 10.5;

  // 拍柄手胶
  line(g, gripBottom.x, gripBottom.y, lw.x + cosR * 7.0, lw.y + sinR * 7.0, theme.racketGrip, 2.8);
  // 钛碳中杆
  line(g, lw.x + cosR * 7.0, lw.y + sinR * 7.0, shaftTop.x, shaftTop.y, "#94a3b8", 1.5);

  // 拍框
  const framePoints: { x: number; y: number }[] = [];
  const fSegs = 24;
  for (let i = 0; i < fSegs; i++) {
    const th = (i / fSegs) * Math.PI * 2;
    const lx = Math.cos(th) * rHeadR;
    const ly = Math.sin(th) * (rHeadR * 0.76);
    const rx = lx * cosR - ly * sinR;
    const ry = lx * sinR + ly * cosR;
    framePoints.push({ x: racketCenter.x + rx, y: racketCenter.y + ry });
  }
  g.moveTo(framePoints[0].x, framePoints[0].y);
  for (let i = 1; i < framePoints.length; i++) g.lineTo(framePoints[i].x, framePoints[i].y);
  p(g, undefined, theme.racketFrame, 1.8);

  // 拍面经纬甜区网线
  line(
    g,
    racketCenter.x - cosR * (rHeadR * 0.7),
    racketCenter.y - sinR * (rHeadR * 0.7),
    racketCenter.x + cosR * (rHeadR * 0.7),
    racketCenter.y + sinR * (rHeadR * 0.7),
    "rgba(255,255,255,0.4)",
    0.8
  );
  line(
    g,
    racketCenter.x - (-sinR) * (rHeadR * 0.5),
    racketCenter.y - (cosR) * (rHeadR * 0.5),
    racketCenter.x + (-sinR) * (rHeadR * 0.5),
    racketCenter.y + (cosR) * (rHeadR * 0.5),
    "rgba(255,255,255,0.4)",
    0.8
  );
}

// 导出与出图函数
export function generateRefinedDemo(outDir: string): void {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const g = new StubGraphics();
  const theme = THEMES["p5-ken"];
  const poses: ("idle" | "ready" | "lunge" | "smash" | "run")[] = ["idle", "ready", "lunge", "smash", "run"];

  for (const pose of poses) {
    drawRefinedP5Character(g, theme, pose);
    const svgBody = opsToSvg(g.ops);
    const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -130 110 145" width="440" height="580" style="background:#090c14;">
      <!-- 参考地平线 -->
      <line x1="-50" y1="0" x2="60" y2="0" stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="2,2"/>
      <!-- 肩部判定锁定位 SW.pivotY = -70 -->
      <line x1="-45" y1="-70" x2="55" y2="-70" stroke="rgba(230,0,18,0.35)" stroke-width="0.8" stroke-dasharray="3,3"/>
      <text x="-48" y="-72" fill="rgba(230,0,18,0.6)" font-family="monospace" font-size="4.5">SW.pivotY = -70 (Physics Locked)</text>
      <g>${svgBody}</g>
    </svg>`;
    fs.writeFileSync(path.join(outDir, `refined-${pose}.svg`), fullSvg, "utf8");
  }

  console.log(`[Refined Demo] 高精重构姿势 SVG 已生成至: ${outDir}`);
}

if (require.main === module) {
  const outDir = path.resolve(process.cwd(), ".tools-build/p5-demo");
  generateRefinedDemo(outDir);
}
