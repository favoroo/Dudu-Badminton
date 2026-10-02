// ============================================================
// P5 潮酷街机风格人物形象 v3.0 (高保真美学升级)
//
// 核心逻辑:
// 继承原版最成功的「极致圆润、干净平滑、无断缝」的程序化美学，
// 彻底解决「低幼大头卡通」痛点:
// 1. 头身比从 3.5 头身升级为 4.5 头身 (头半径从 21px 收至 15px，身体拔高修长)
// 2. 眼神从呆板横线升级为 P5 冷峻锐利凤眼 (倾斜飞挑、杀气与专注)
// 3. 头部增加帅气流线发型与随风翻飞的双红色发带
// 4. 躯干重塑为倒三角宽肩收腰健美体魄，搭配 P5 斩劈红+荧光黄斜切机能球衣
// 5. 肢体保留极度平滑的无缝圆头管线，增加吸汗护腕、侧开衩短裤与专业气垫球鞋
// ============================================================

import "./cc-stub";
import * as fs from "fs";
import * as path from "path";
import { Graphics as StubGraphics, opsToSvg } from "./cc-stub";

const PIVOT_Y = -70; // 物理锁定位

function line(g: StubGraphics, x0: number, y0: number, x1: number, y1: number, col: string, lw: number): void {
  g.strokeColor.fromHEX(col);
  g.lineWidth = lw;
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

export function drawSleekP5(g: StubGraphics, pose: "idle" | "ready" | "lunge" | "smash" = "idle") {
  g.clear();

  // 姿态参数
  let hipY = -34;
  let hipX = 0;
  let torsoLean = 2; // 度
  let headTilt = 0;
  let airDist = 0;

  let leadElbow = { x: 12, y: -57 };
  let leadWrist = { x: 20, y: -63 };
  let racketAng = -35;

  let trailElbow = { x: -8, y: -57 };
  let trailWrist = { x: -11, y: -45 };

  let leadKnee = { x: 3, y: -17 };
  let leadFoot = { x: 6, y: 0 };
  let trailKnee = { x: -6, y: -17 };
  let trailFoot = { x: -7, y: 0 };

  if (pose === "ready") {
    hipY = -30;
    torsoLean = 6;
    leadElbow = { x: 14, y: -55 };
    leadWrist = { x: 24, y: -60 };
    racketAng = -15;
    trailElbow = { x: -14, y: -64 };
    trailWrist = { x: -20, y: -72 };
    leadKnee = { x: 9, y: -15 };
    leadFoot = { x: 14, y: 0 };
    trailKnee = { x: -9, y: -15 };
    trailFoot = { x: -13, y: 0 };
  } else if (pose === "lunge") {
    hipY = -22;
    hipX = 8;
    torsoLean = 16;
    leadElbow = { x: 26, y: -46 };
    leadWrist = { x: 38, y: -42 };
    racketAng = 15;
    trailElbow = { x: -14, y: -58 };
    trailWrist = { x: -26, y: -64 };
    leadKnee = { x: 26, y: -12 };
    leadFoot = { x: 30, y: 0 };
    trailKnee = { x: -8, y: -10 };
    trailFoot = { x: -24, y: 0 };
  } else if (pose === "smash") {
    hipY = -58;
    airDist = 24;
    torsoLean = -10;
    leadElbow = { x: -10, y: -90 };
    leadWrist = { x: 0, y: -102 };
    racketAng = -115;
    trailElbow = { x: 16, y: -78 };
    trailWrist = { x: 26, y: -88 };
    leadKnee = { x: 7, y: -42 };
    leadFoot = { x: 3, y: -26 };
    trailKnee = { x: -6, y: -40 };
    trailFoot = { x: -12, y: -24 };
  }

  // 1. 阴影
  g.fillColor.fromHEX("#000000");
  const sScale = Math.max(0.4, 1 - airDist * 0.015);
  g.ellipse(hipX * 0.5, 0, 22 * sScale, 5 * sScale);
  g.fill();

  // 辅助画平滑管状肢体 (无缝衔接)
  const drawBone = (p0: { x: number; y: number }, p1: { x: number; y: number }, w: number, col: string) => {
    g.strokeColor.fromHEX(col);
    g.lineWidth = w;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.moveTo(p0.x, p0.y);
    g.lineTo(p1.x, p1.y);
    g.stroke();
  };

  // 2. 远侧腿 (景深压暗)
  const tHip = { x: hipX - 2.5, y: hipY };
  drawBone(tHip, trailKnee, 6.6, "#0a0c14"); // 短裤
  drawBone(trailKnee, { x: (trailKnee.x + trailFoot.x) * 0.5, y: (trailKnee.y + trailFoot.y) * 0.5 }, 5.0, "#d49b6a"); // 皮肤
  drawBone({ x: (trailKnee.x + trailFoot.x) * 0.5, y: (trailKnee.y + trailFoot.y) * 0.5 }, trailFoot, 5.2, "#cbd5e1"); // 袜子
  // 远侧鞋
  g.fillColor.fromHEX("#0e111a");
  g.rect(trailFoot.x - 3, trailFoot.y - 4, 11, 4.5);
  g.fill();

  // 3. 远侧平衡臂 (景深压暗)
  const tShoulder = { x: -4, y: PIVOT_Y + 1 };
  drawBone(tShoulder, trailElbow, 5.0, "#0a0c14"); // 短袖
  drawBone(trailElbow, trailWrist, 4.4, "#d49b6a"); // 肤色小臂
  g.fillColor.fromHEX("#d49b6a");
  g.circle(trailWrist.x, trailWrist.y, 2.6);
  g.fill();

  // 4. 躯干 (倒三角宽肩收腰机能球衣)
  const leanRad = (torsoLean * Math.PI) / 180;
  const sLeft = { x: -10, y: PIVOT_Y + 3 };
  const sRight = { x: 10, y: PIVOT_Y + 2 };
  const hLeft = { x: hipX - 6.5, y: hipY };
  const hRight = { x: hipX + 6.5, y: hipY };

  // 球衣底色 (纯黑机能哑光)
  g.moveTo(sLeft.x, sLeft.y);
  g.lineTo(hLeft.x, hLeft.y);
  g.lineTo(hRight.x, hRight.y);
  g.lineTo(sRight.x, sRight.y);
  g.close();
  g.fillColor.fromHEX("#141620");
  g.fill();

  // P5 斩劈红对角斜切色带
  g.moveTo(sLeft.x + 2, sLeft.y + 6);
  g.lineTo(sRight.x - 1, sRight.y + 13);
  g.lineTo(sRight.x - 2, sRight.y + 18);
  g.lineTo(sLeft.x + 1, sLeft.y + 11);
  g.close();
  g.fillColor.fromHEX("#e60012");
  g.fill();

  // 荧光黄动感细线
  g.moveTo(sLeft.x + 2.5, sLeft.y + 13.5);
  g.lineTo(sRight.x - 3, sRight.y + 20.5);
  g.lineTo(sRight.x - 4, sRight.y + 22.5);
  g.lineTo(sLeft.x + 1.5, sLeft.y + 15.5);
  g.close();
  g.fillColor.fromHEX("#ffe14d");
  g.fill();

  // 精致深红 V 领
  g.strokeColor.fromHEX("#e60012");
  g.lineWidth = 1.4;
  g.moveTo(0, PIVOT_Y + 2);
  g.lineTo(2.5, PIVOT_Y + 7);
  g.lineTo(6.5, PIVOT_Y + 2);
  g.stroke();

  // 5. 运动短裤与前侧近腿
  const lHip = { x: hipX + 2.5, y: hipY };
  drawBone(lHip, leadKnee, 7.4, "#141620"); // 短裤
  // 短裤侧边红条纹
  g.strokeColor.fromHEX("#e60012");
  g.lineWidth = 1.6;
  g.moveTo(hRight.x - 1, hRight.y + 1);
  g.lineTo(leadKnee.x + 2.5, leadKnee.y - 3);
  g.stroke();

  // 近侧大腿肌肉 (饱满流线)
  drawBone(leadKnee, { x: (leadKnee.x + leadFoot.x) * 0.5, y: (leadKnee.y + leadFoot.y) * 0.5 }, 5.4, "#f2c491");
  // 小腿 + 罗纹运动袜
  drawBone({ x: (leadKnee.x + leadFoot.x) * 0.5, y: (leadKnee.y + leadFoot.y) * 0.5 }, leadFoot, 5.6, "#f8fafc");

  // 专业羽毛球鞋 (气垫大底 + 红刃包边)
  const toe = { x: leadFoot.x + 11, y: leadFoot.y };
  g.moveTo(leadFoot.x - 4, leadFoot.y - 4);
  g.lineTo(leadFoot.x + 4, leadFoot.y - 4);
  g.lineTo(toe.x, toe.y - 1);
  g.lineTo(toe.x - 0.5, toe.y + 2);
  g.lineTo(leadFoot.x - 4.5, leadFoot.y + 2);
  g.close();
  g.fillColor.fromHEX("#1c1f2b");
  g.fill();
  // 红色流线
  g.strokeColor.fromHEX("#e60012");
  g.lineWidth = 1.6;
  g.moveTo(leadFoot.x - 1, leadFoot.y - 1);
  g.lineTo(toe.x - 2, toe.y - 0.5);
  g.stroke();
  // 白色气垫大底
  g.strokeColor.fromHEX("#ffffff");
  g.lineWidth = 1.4;
  g.moveTo(leadFoot.x - 4, leadFoot.y + 1.6);
  g.lineTo(toe.x - 0.5, toe.y + 1.6);
  g.stroke();

  // 6. 头部 (核心升级: 4.5 头身修长圆润，彻底消除低幼气球感)
  const neckY = PIVOT_Y - 2;
  const headCenter = {
    x: 1.5 + Math.sin((headTilt * Math.PI) / 180) * 4,
    y: neckY - 14,
  };
  const hr = 15.0; // 黄金半径: 比原版 21px 缩小 28%，身体比例瞬间修长！

  // 颈部
  g.fillColor.fromHEX("#d49b6a");
  g.rect(headCenter.x - 2.5, neckY - 5, 5.5, 6);
  g.fill();

  // 脸蛋基底 (饱满微椭圆，暗黑墨面款，极致平滑！)
  g.fillColor.fromHEX("#0a0e18");
  g.ellipse(headCenter.x, headCenter.y, hr, hr * 1.05);
  g.fill();
  g.strokeColor.fromHEX("rgba(235,240,255,0.45)");
  g.lineWidth = 1.4;
  g.ellipse(headCenter.x, headCenter.y, hr, hr * 1.05);
  g.stroke();

  // 头顶高光微弧
  g.strokeColor.fromHEX("rgba(255,255,255,0.22)");
  g.lineWidth = 1.8;
  g.moveTo(headCenter.x - hr * 0.6, headCenter.y - hr * 0.7);
  g.quadraticCurveTo(headCenter.x, headCenter.y - hr * 0.95, headCenter.x + hr * 0.5, headCenter.y - hr * 0.7);
  g.stroke();

  // --- P5 杀手锏: 冷峻锐利的二次元凤眼 (彻底替代呆板平横线！) ---
  const eyeX = headCenter.x + hr * 0.42;
  const eyeY = headCenter.y + hr * 0.12;

  // 近眼: 锐利上扬上眼睑
  g.strokeColor.fromHEX("#ffffff");
  g.lineWidth = 1.8;
  g.moveTo(eyeX - 3.5, eyeY + 0.8);
  g.quadraticCurveTo(eyeX, eyeY - 2.4, eyeX + 4.2, eyeY - 0.8);
  g.stroke();
  // 红色聚焦瞳孔
  g.fillColor.fromHEX("#e60012");
  g.circle(eyeX + 0.6, eyeY - 0.2, 1.4);
  g.fill();
  // 白色聚光焦点
  g.fillColor.fromHEX("#ffffff");
  g.circle(eyeX + 1.0, eyeY - 0.6, 0.5);
  g.fill();

  // 远眼: 侧身透视较小微眯
  const fEyeX = headCenter.x - hr * 0.18;
  const fEyeY = headCenter.y + hr * 0.15;
  g.strokeColor.fromHEX("#ffffff");
  g.lineWidth = 1.4;
  g.moveTo(fEyeX - 2.4, fEyeY + 0.5);
  g.quadraticCurveTo(fEyeX, fEyeY - 1.8, fEyeX + 2.8, fEyeY - 0.5);
  g.stroke();

  // 嘴角微抿短线 (专注沉稳神态)
  g.strokeColor.fromHEX("rgba(255,255,255,0.75)");
  g.lineWidth = 1.2;
  g.moveTo(headCenter.x + hr * 0.15, headCenter.y + hr * 0.42);
  g.lineTo(headCenter.x + hr * 0.42, headCenter.y + hr * 0.38);
  g.stroke();

  // --- 潮流飞扬发带与脑后飘带 ---
  // 发带本体 (横跨额头)
  g.strokeColor.fromHEX("#e60012");
  g.lineWidth = 3.6;
  g.moveTo(headCenter.x - hr * 0.88, headCenter.y - hr * 0.2);
  g.quadraticCurveTo(headCenter.x, headCenter.y - hr * 0.45, headCenter.x + hr * 0.88, headCenter.y - hr * 0.2);
  g.stroke();
  // 荧光黄内芯条纹
  g.strokeColor.fromHEX("#ffe14d");
  g.lineWidth = 1.0;
  g.moveTo(headCenter.x - hr * 0.85, headCenter.y - hr * 0.2);
  g.quadraticCurveTo(headCenter.x, headCenter.y - hr * 0.45, headCenter.x + hr * 0.85, headCenter.y - hr * 0.2);
  g.stroke();

  // 脑后随风翻飞的双飘带 (动感拉满！)
  g.moveTo(headCenter.x - hr * 0.85, headCenter.y - hr * 0.2);
  g.quadraticCurveTo(headCenter.x - hr * 1.5, headCenter.y - hr * 0.1, headCenter.x - hr * 2.2, headCenter.y + hr * 0.4);
  g.lineTo(headCenter.x - hr * 2.0, headCenter.y + hr * 0.6);
  g.quadraticCurveTo(headCenter.x - hr * 1.4, headCenter.y + hr * 0.1, headCenter.x - hr * 0.8, headCenter.y - 0.5);
  g.close();
  g.fillColor.fromHEX("#e60012");
  g.fill();

  // --- 层次帅气刺猬发束 (平滑饱满大块面，绝无生硬毛刺！) ---
  const hairColor = "#12131a";
  g.moveTo(headCenter.x - hr * 0.8, headCenter.y - hr * 0.4);
  g.quadraticCurveTo(headCenter.x - hr * 1.4, headCenter.y - hr * 0.9, headCenter.x - hr * 0.9, headCenter.y - hr * 1.3);
  g.quadraticCurveTo(headCenter.x - hr * 1.2, headCenter.y - hr * 1.6, headCenter.x - hr * 0.5, headCenter.y - hr * 1.5);
  g.quadraticCurveTo(headCenter.x, headCenter.y - hr * 1.8, headCenter.x + hr * 0.4, headCenter.y - hr * 1.4);
  g.quadraticCurveTo(headCenter.x + hr * 0.9, headCenter.y - hr * 1.2, headCenter.x + hr * 0.75, headCenter.y - hr * 0.7);
  g.quadraticCurveTo(headCenter.x + hr * 0.2, headCenter.y - hr * 0.9, headCenter.x - hr * 0.8, headCenter.y - hr * 0.4);
  g.close();
  g.fillColor.fromHEX(hairColor);
  g.fill();

  // 额前微翘小挑染碎发 (烈焰红)
  g.moveTo(headCenter.x + hr * 0.3, headCenter.y - hr * 0.8);
  g.lineTo(headCenter.x + hr * 0.8, headCenter.y - hr * 0.6);
  g.lineTo(headCenter.x + hr * 0.5, headCenter.y - hr * 0.4);
  g.close();
  g.fillColor.fromHEX("#e60012");
  g.fill();

  // 7. 近侧持拍臂 (肌肉管状无缝衔接)
  const lShoulder = { x: 3, y: PIVOT_Y };
  drawBone(lShoulder, leadElbow, 5.8, "#141620"); // 黑短袖
  // 袖口红边
  g.strokeColor.fromHEX("#e60012");
  g.lineWidth = 1.4;
  g.circle((lShoulder.x + leadElbow.x) * 0.5, (lShoulder.y + leadElbow.y) * 0.5, 3.2);
  g.stroke();

  // 健美前臂
  drawBone(leadElbow, leadWrist, 5.2, "#f2c491");
  // 红色吸汗护腕
  drawBone(
    { x: (leadElbow.x + leadWrist.x * 2) / 3, y: (leadElbow.y + leadWrist.y * 2) / 3 },
    leadWrist,
    5.6,
    "#e60012"
  );
  // 手掌
  g.fillColor.fromHEX("#f2c491");
  g.circle(leadWrist.x, leadWrist.y, 3.2);
  g.fill();

  // 8. 羽毛球拍
  const rRad = (racketAng * Math.PI) / 180;
  const cosR = Math.cos(rRad), sinR = Math.sin(rRad);
  const shaftEnd = { x: leadWrist.x + cosR * 25, y: leadWrist.y + sinR * 25 };
  const rCenter = { x: shaftEnd.x + cosR * 10, y: shaftEnd.y + sinR * 10 };

  // 拍柄手胶
  line(g, leadWrist.x - cosR * 4, leadWrist.y - sinR * 4, leadWrist.x + cosR * 6, leadWrist.y + sinR * 6, "#0a0c14", 2.6);
  // 银灰碳素中杆
  line(g, leadWrist.x + cosR * 6, leadWrist.y + sinR * 6, shaftEnd.x, shaftEnd.y, "#94a3b8", 1.4);

  // 斩劈红拍框
  g.strokeColor.fromHEX("#e60012");
  g.lineWidth = 1.8;
  g.ellipse(rCenter.x, rCenter.y, 10, 8);
  g.stroke();
  // 甜区网线
  line(g, rCenter.x - cosR * 6, rCenter.y - sinR * 6, rCenter.x + cosR * 6, rCenter.y + sinR * 6, "rgba(255,255,255,0.4)", 0.8);
}

// 出图测试
if (require.main === module) {
  const outDir = path.resolve(process.cwd(), ".tools-build/p5-v3");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const g = new StubGraphics();
  const poses: ("idle" | "ready" | "lunge" | "smash")[] = ["idle", "ready", "lunge", "smash"];

  for (const pose of poses) {
    drawSleekP5(g, pose);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -130 110 145" width="440" height="580" style="background:#090c14;">
      <line x1="-50" y1="0" x2="60" y2="0" stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="2,2"/>
      <line x1="-45" y1="-70" x2="55" y2="-70" stroke="rgba(230,0,18,0.35)" stroke-width="0.8" stroke-dasharray="3,3"/>
      <g>${opsToSvg(g.ops)}</g>
    </svg>`;
    fs.writeFileSync(path.join(outDir, `${pose}.svg`), svg, "utf8");
  }
  console.log(`[P5 v3] 渲染完成: ${outDir}`);
}
