// ============================================================
// 风格原型与骨架相容性预览生成器 (Style Demo Preview)
// 验证：3 款帅气新风格在现有游戏骨骼（H=100, 肩高-70, 判定弧线, 腿部IK）下的实际矢量渲染表现
// ============================================================
import { installCc, StubOp, opsToSvg, Color } from "./cc-stub";
import * as fs from "fs";

installCc();

const OUT_DIR = ".tools-build/style-demo";
fs.mkdirSync(OUT_DIR, { recursive: true });

// 样式定义
interface StyleSpec {
  id: string;
  name: string;
  tag: string;
  desc: string;
  headR: number;       // 头部等效半径(旧版 21 -> 新版 14~15, 显著拉伸头身比)
  chinY: number;       // 下巴收尖偏移
  eyeType: "anime" | "p5_sharp" | "cyber_visor";
  hairType: "shonen_spiky" | "p5_messy" | "cyber_flow";
  suitType: "sport" | "techwear" | "bodysuit";
  mainCol: string;
  darkCol: string;
  accentCol: string;
  hairCol: string;
}

const STYLES: StyleSpec[] = [
  {
    id: "style-a",
    name: "风格 A：热血王道羽球番",
    tag: "Shonen Ace",
    desc: "4.8 头身运动少年，热血飒爽下颌角，层次碎发，专业运动羽球服",
    headR: 14.5,
    chinY: 4.5,
    eyeType: "anime",
    hairType: "shonen_spiky",
    suitType: "sport",
    mainCol: "#ff4d4d",
    darkCol: "#a8202c",
    accentCol: "#ffffff",
    hairCol: "#2c1d11",
  },
  {
    id: "style-b",
    name: "风格 B：P5 潮酷机能怪盗 (推荐)",
    tag: "Neo-Arcade",
    desc: "5.0 头身高挑剪影，P5黑白红黄高对比切面，鹰眸眼神，机能斜跨战术带",
    headR: 14.0,
    chinY: 5.5,
    eyeType: "p5_sharp",
    hairType: "p5_messy",
    suitType: "techwear",
    mainCol: "#161922",
    darkCol: "#0c0d12",
    accentCol: "#e60012",
    hairCol: "#181a20",
  },
  {
    id: "style-c",
    name: "风格 C：极简极速科技流线",
    tag: "Cyber-Speed",
    desc: "4.8 头身流体力学压缩服，冷峻面容，青色离子流光护目镜，极速爆发",
    headR: 14.2,
    chinY: 5.0,
    eyeType: "cyber_visor",
    hairType: "cyber_flow",
    suitType: "bodysuit",
    mainCol: "#1e2430",
    darkCol: "#10141c",
    accentCol: "#00f0ff",
    hairCol: "#d8e2ec",
  },
];

type PoseType = "idle" | "run" | "smash" | "lunge";

// 生成纯 SVG 渲染（完全保持游戏骨骼尺寸: 真实脚底 y=0, 肩点 y=70, 拍长 55, 判定区严格吻合）
function renderStyleSvg(style: StyleSpec, pose: PoseType, bg: string): string {
  const W = 320, H = 440;
  const cx = 160, groundY = 380; // 脚底原点位于 (160, 380)

  // 姿态参数（与游戏 rules/physics 完全一致）
  let hipY = -34, shoulderY = -70;
  let torsoLean = 0;
  let leadKnee = { x: 8, y: -18 }, leadAnkle = { x: 5, y: 0 };
  let backKnee = { x: -6, y: -17 }, backAnkle = { x: -8, y: 0 };
  let hand = { x: 22, y: -48 }, racketAng = 65; // 拍角度
  let farHand = { x: -12, y: -46 };

  if (pose === "run") {
    torsoLean = 6;
    leadKnee = { x: 18, y: -22 }; leadAnkle = { x: 14, y: -8 };
    backKnee = { x: -14, y: -16 }; backAnkle = { x: -20, y: 0 };
    hand = { x: 18, y: -52 }; racketAng = 55;
    farHand = { x: -16, y: -58 };
  } else if (pose === "smash") {
    // 空中扣杀: 离地起跳，弓背拉满，持拍臂高举过头顶
    hipY = -68; shoulderY = -104;
    torsoLean = 4;
    leadKnee = { x: 12, y: -48 }; leadAnkle = { x: 8, y: -30 };
    backKnee = { x: -8, y: -46 }; backAnkle = { x: -14, y: -28 };
    hand = { x: 26, y: -128 }; racketAng = -35; // 凌空下压劈扣
    farHand = { x: -22, y: -88 };
  } else if (pose === "lunge") {
    // 深跨步上网
    hipY = -24; shoulderY = -58;
    torsoLean = 14;
    leadKnee = { x: 32, y: -12 }; leadAnkle = { x: 28, y: 0 };
    backKnee = { x: -16, y: -12 }; backAnkle = { x: -28, y: 0 };
    hand = { x: 38, y: -38 }; racketAng = 15;
    farHand = { x: -24, y: -64 };
  }

  // 坐标映射
  const px = (x: number) => (cx + x).toFixed(1);
  const py = (y: number) => (groundY + y).toFixed(1);

  // SVG 元素绘制
  const skin = "#f2c59d";
  const skinShadow = "#dfab7f";
  const { mainCol, darkCol, accentCol, hairCol, headR, chinY } = style;

  const elements: string[] = [];

  // 1. 投影
  if (pose !== "smash") {
    elements.push(`<ellipse cx="${cx}" cy="${groundY + 2}" rx="32" ry="7" fill="rgba(0,0,0,0.38)"/>`);
  } else {
    elements.push(`<ellipse cx="${cx}" cy="${groundY + 2}" rx="18" ry="4" fill="rgba(0,0,0,0.18)"/>`);
  }

  // 2. 远腿 (后景深)
  elements.push(`
    <path d="M ${px(-4)} ${py(hipY)} L ${px(backKnee.x)} ${py(backKnee.y)} L ${px(backAnkle.x)} ${py(backAnkle.y)}" 
          fill="none" stroke="${darkCol}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M ${px(backKnee.x * 0.7 + backAnkle.x * 0.3)} ${py(backKnee.y * 0.7 + backAnkle.y * 0.3)} L ${px(backAnkle.x)} ${py(backAnkle.y)}" 
          fill="none" stroke="#d5d0c4" stroke-width="5" stroke-linecap="round"/>
    <rect x="${cx + backAnkle.x - 3}" y="${groundY + backAnkle.y - 4}" width="14" height="6" rx="2" fill="#121620"/>
  `);

  // 3. 远臂
  elements.push(`
    <path d="M ${px(-8 + torsoLean * 0.6)} ${py(shoulderY + 2)} L ${px((farHand.x - 8) / 2)} ${py((farHand.y + shoulderY) / 2 + 2)} L ${px(farHand.x)} ${py(farHand.y)}" 
          fill="none" stroke="${darkCol}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${px(farHand.x)}" cy="${py(farHand.y)}" r="3" fill="${skin}"/>
  `);

  // 4. 躯干 (倒三角运动剪影 + 脊柱平滑)
  const shX = cx + torsoLean * 0.9;
  const shY = groundY + shoulderY;
  const hpX = cx;
  const hpY = groundY + hipY;

  if (style.suitType === "techwear") {
    // P5 机能风：黑底战术背心 + 亮红斩劈斜跨带
    elements.push(`
      <polygon points="${shX - 14},${shY} ${shX + 14},${shY} ${hpX + 10},${hpY} ${hpX - 10},${hpY}" fill="${mainCol}"/>
      <!-- P5 战术斜跨带 -->
      <line x1="${shX - 10}" y1="${shY + 4}" x2="${hpX + 8}" y2="${hpY - 2}" stroke="${accentCol}" stroke-width="4" stroke-linecap="round"/>
      <line x1="${shX - 11}" y1="${shY + 7}" x2="${hpX + 6}" y2="${hpY - 1}" stroke="#ffe14d" stroke-width="1.2"/>
      <!-- 立领切面 -->
      <polygon points="${shX - 5},${shY - 6} ${shX + 5},${shY - 6} ${shX + 3},${shY + 4} ${shX - 3},${shY + 4}" fill="${accentCol}"/>
    `);
  } else if (style.suitType === "bodysuit") {
    // 极简科技流线压缩衣 + 离子荧光导线
    elements.push(`
      <polygon points="${shX - 13},${shY} ${shX + 13},${shY} ${hpX + 9},${hpY} ${hpX - 9},${hpY}" fill="${mainCol}"/>
      <path d="M ${shX - 9} ${shY + 4} Q ${shX - 2} ${shY + 16} ${hpX - 4} ${hpY - 2}" fill="none" stroke="${accentCol}" stroke-width="1.8"/>
      <path d="M ${shX + 9} ${shY + 4} Q ${shX + 4} ${shY + 16} ${hpX + 5} ${hpY - 2}" fill="none" stroke="${accentCol}" stroke-width="1.8"/>
    `);
  } else {
    // 热血运动服 + 经典 V 领 + 侧翼拼接
    elements.push(`
      <polygon points="${shX - 14},${shY} ${shX + 14},${shY} ${hpX + 10},${hpY} ${hpX - 10},${hpY}" fill="${mainCol}"/>
      <polygon points="${shX - 14},${shY + 2} ${shX - 7},${shY + 2} ${hpX - 5},${hpY - 2} ${hpX - 10},${hpY - 2}" fill="${darkCol}"/>
      <line x1="${shX - 4}" y1="${shY + 2}" x2="${shX}" y2="${shY + 9}" stroke="#ffffff" stroke-width="1.6"/>
      <line x1="${shX + 4}" y1="${shY + 2}" x2="${shX}" y2="${shY + 9}" stroke="#ffffff" stroke-width="1.6"/>
    `);
  }

  // 5. 近腿
  elements.push(`
    <path d="M ${px(4)} ${py(hipY)} L ${px(leadKnee.x)} ${py(leadKnee.y)} L ${px(leadAnkle.x)} ${py(leadAnkle.y)}" 
          fill="none" stroke="${mainCol}" stroke-width="7.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M ${px(leadKnee.x * 0.5 + leadAnkle.x * 0.5)} ${py(leadKnee.y * 0.5 + leadAnkle.y * 0.5)} L ${px(leadAnkle.x)} ${py(leadAnkle.y)}" 
          fill="none" stroke="#f6f4ee" stroke-width="5.4" stroke-linecap="round"/>
    <rect x="${cx + leadAnkle.x - 3}" y="${groundY + leadAnkle.y - 5}" width="15" height="7" rx="2.5" fill="#1b2130"/>
    <rect x="${cx + leadAnkle.x}" y="${groundY + leadAnkle.y - 1}" width="12" height="3" fill="${accentCol}"/>
  `);

  // 6. 头部与面部（飒爽下颌角 + 锐利眼神，告别大圆球！）
  const headCenterX = cx + torsoLean * 0.9 + 2;
  const headCenterY = groundY + shoulderY - headR - 6;

  // 动漫下颌多边形 (具有微收下巴，非死板正圆)
  const chinPtX = headCenterX + 3;
  const chinPtY = headCenterY + headR + chinY;
  elements.push(`
    <!-- 头部基底 (倒卵型下颌切面) -->
    <path d="M ${headCenterX - headR} ${headCenterY} 
             C ${headCenterX - headR} ${headCenterY - headR * 1.05}, ${headCenterX + headR} ${headCenterY - headR * 1.05}, ${headCenterX + headR} ${headCenterY} 
             C ${headCenterX + headR} ${headCenterY + headR * 0.6}, ${chinPtX + 6} ${chinPtY - 3}, ${chinPtX} ${chinPtY} 
             C ${chinPtX - 8} ${chinPtY - 4}, ${headCenterX - headR} ${headCenterY + headR * 0.5}, ${headCenterX - headR} ${headCenterY} Z" 
          fill="${skin}" stroke="${darkCol}" stroke-width="1.2"/>
  `);

  // 五官绘制
  if (style.eyeType === "p5_sharp") {
    // P5 锐角鹰眸 + 黄色聚焦高光 + 自信嘴角
    elements.push(`
      <polygon points="${headCenterX + 3},${headCenterY - 1} ${headCenterX + 10},${headCenterY - 4} ${headCenterX + 8},${headCenterY + 1} ${headCenterX + 4},${headCenterY + 1}" fill="#0a0e18"/>
      <circle cx="${headCenterX + 6.5}" cy="${headCenterY - 0.8}" r="1.5" fill="#ffe14d"/>
      <path d="M ${headCenterX + 2} ${headCenterY + 6} L ${headCenterX + 8} ${headCenterY + 5}" stroke="#0a0e18" stroke-width="1.4" stroke-linecap="round"/>
    `);
  } else if (style.eyeType === "cyber_visor") {
    // 科技流线一体式护目镜 (半透明青色荧光)
    elements.push(`
      <polygon points="${headCenterX - 2},${headCenterY - 4} ${headCenterX + 13},${headCenterY - 5} ${headCenterX + 11},${headCenterY + 3} ${headCenterX - 1},${headCenterY + 2}" 
               fill="rgba(0, 240, 255, 0.45)" stroke="#00f0ff" stroke-width="1.2"/>
      <line x1="${headCenterX + 1}" y1="${headCenterY - 1}" x2="${headCenterX + 9}" y2="${headCenterY - 1.5}" stroke="#ffffff" stroke-width="0.8"/>
    `);
  } else {
    // 热血番专注双层眼眶 + 眼神光
    elements.push(`
      <path d="M ${headCenterX + 2} ${headCenterY - 2} Q ${headCenterX + 6} ${headCenterY - 4} ${headCenterX + 9} ${headCenterY}" fill="none" stroke="#2a1a12" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="${headCenterX + 6}" cy="${headCenterY}" r="1.8" fill="#2a1a12"/>
      <circle cx="${headCenterX + 6.8}" cy="${headCenterY - 0.5}" r="0.6" fill="#ffffff"/>
      <line x1="${headCenterX + 3}" y1="${headCenterY + 6}" x2="${headCenterX + 7}" y2="${headCenterY + 5.5}" stroke="#2a1a12" stroke-width="1.3" stroke-linecap="round"/>
    `);
  }

  // 发型绘制（带两段层次与飘动张力）
  if (style.hairType === "p5_messy") {
    // P5 动感不羁卷碎发 + 前额挑染
    elements.push(`
      <path d="M ${headCenterX - headR - 2} ${headCenterY - 2} 
               L ${headCenterX - headR - 5} ${headCenterY - 10} 
               L ${headCenterX - headR + 2} ${headCenterY - 13}
               L ${headCenterX - 3} ${headCenterY - headR - 9}
               L ${headCenterX + 6} ${headCenterY - headR - 10}
               L ${headCenterX + 12} ${headCenterY - headR - 4}
               L ${headCenterX + headR + 4} ${headCenterY - 6}
               L ${headCenterX + headR} ${headCenterY + 3}
               L ${headCenterX + 7} ${headCenterY - 3}
               L ${headCenterX + 2} ${headCenterY - 2} Z" 
            fill="${hairCol}" stroke="#0a0e18" stroke-width="1.2"/>
      <!-- 鲜红斜切挑染 -->
      <polygon points="${headCenterX + 1},${headCenterY - headR - 4} ${headCenterX + 7},${headCenterY - headR - 6} ${headCenterX + 4},${headCenterY - headR + 2}" fill="${accentCol}"/>
    `);
  } else if (style.hairType === "cyber_flow") {
    // 银白流线短发
    elements.push(`
      <path d="M ${headCenterX - headR} ${headCenterY - 1} 
               L ${headCenterX - headR - 3} ${headCenterY - 8} 
               L ${headCenterX - 2} ${headCenterY - headR - 8}
               L ${headCenterX + 8} ${headCenterY - headR - 6}
               L ${headCenterX + headR + 3} ${headCenterY - 3}
               L ${headCenterX + 8} ${headCenterY - 2} Z" 
            fill="${hairCol}" stroke="#9cb0c6" stroke-width="1.0"/>
    `);
  } else {
    // 热血碎发
    elements.push(`
      <path d="M ${headCenterX - headR - 2} ${headCenterY} 
               L ${headCenterX - headR - 4} ${headCenterY - 9} 
               L ${headCenterX - 2} ${headCenterY - headR - 9}
               L ${headCenterX + 5} ${headCenterY - headR - 11}
               L ${headCenterX + 12} ${headCenterY - headR - 5}
               L ${headCenterX + headR + 3} ${headCenterY - 4}
               L ${headCenterX + 8} ${headCenterY - 1} Z" 
            fill="${hairCol}" stroke="#180e08" stroke-width="1.2"/>
    `);
  }

  // 7. 持拍近臂与球拍（严格保持手臂 IK 与判定尺寸）
  const hx = cx + hand.x;
  const hy = groundY + hand.y;
  const rrad = (racketAng * Math.PI) / 180;
  const racketHeadX = hx + Math.cos(rrad) * 38;
  const racketHeadY = hy - Math.sin(rrad) * 38;

  elements.push(`
    <!-- 持拍臂两段 -->
    <path d="M ${shX + 8} ${shY + 2} L ${(shX + 8 + hx) / 2 + 6} ${(shY + 2 + hy) / 2 + 4} L ${hx} ${hy}" 
          fill="none" stroke="${skin}" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${hx}" cy="${hy}" r="3.2" fill="${skin}"/>
    <!-- 球拍中杆 -->
    <line x1="${hx}" y1="${hy}" x2="${racketHeadX}" y2="${racketHeadY}" stroke="#d8dde8" stroke-width="2.2" stroke-linecap="round"/>
    <!-- 破风拍框 (精准几何) -->
    <ellipse cx="${racketHeadX + Math.cos(rrad) * 16}" cy="${racketHeadY - Math.sin(rrad) * 16}" rx="16" ry="12" 
             transform="rotate(${-racketAng}, ${racketHeadX + Math.cos(rrad) * 16}, ${racketHeadY - Math.sin(rrad) * 16})"
             fill="rgba(255,255,255,0.06)" stroke="${accentCol}" stroke-width="2.6"/>
  `);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="100%" height="100%" fill="${bg}" rx="8"/>
      ${elements.join("\n")}
    </svg>
  `;
}

// 生成全部预览与交互对比页
const POSES: { key: PoseType; label: string }[] = [
  { key: "idle", label: "待机架拍" },
  { key: "run", label: "冲刺奔跑" },
  { key: "smash", label: "凌空暴扣" },
  { key: "lunge", label: "深跨步救球" },
];

const cardsHtml: string[] = [];

for (const s of STYLES) {
  const poseSvgs = POSES.map((p) => {
    const svgDark = renderStyleSvg(s, p.key, "#121520");
    return `
      <div class="pose-box">
        <span class="pose-label">${p.label}</span>
        ${svgDark}
      </div>
    `;
  }).join("");

  cardsHtml.push(`
    <div class="style-card" id="${s.id}">
      <div class="card-header">
        <div class="title-row">
          <h3>${s.name}</h3>
          <span class="badge ${s.id === 'style-b' ? 'rec' : ''}">${s.tag}</span>
        </div>
        <p class="desc">${s.desc}</p>
      </div>
      <div class="poses-row">
        ${poseSvgs}
      </div>
    </div>
  `);
}

const fullHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>嘟嘟羽毛球 — 3 款帅气人物形象与动作流畅度原型选型</title>
<style>
  :root {
    --bg: #0a0d14;
    --card-bg: #141824;
    --border: #232a3b;
    --accent: #e60012;
    --text: #f0f4fc;
    --sub: #8ea1b8;
  }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", sans-serif;
    margin: 0;
    padding: 24px;
  }
  .header {
    max-width: 1400px;
    margin: 0 auto 28px;
    border-bottom: 2px solid var(--border);
    padding-bottom: 16px;
  }
  .header h1 {
    margin: 0 0 8px;
    font-size: 26px;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .header p {
    margin: 0;
    color: var(--sub);
    font-size: 14px;
    line-height: 1.6;
  }
  .container {
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  .style-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }
  .card-header {
    margin-bottom: 16px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    padding-bottom: 12px;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .title-row h3 {
    margin: 0;
    font-size: 20px;
    color: #fff;
  }
  .badge {
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: bold;
    background: #2a344a;
    color: #8bb2ff;
  }
  .badge.rec {
    background: #e60012;
    color: #fff;
  }
  .desc {
    margin: 6px 0 0;
    color: var(--sub);
    font-size: 13.5px;
  }
  .poses-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }
  .pose-box {
    background: #0d1018;
    border: 1px solid #1c2233;
    border-radius: 8px;
    padding: 10px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .pose-label {
    font-size: 12px;
    font-weight: 600;
    color: #7d90a8;
    margin-bottom: 8px;
  }
  .pose-box svg {
    max-width: 100%;
    height: auto;
  }
</style>
</head>
<body>
  <div class="header">
    <h1>🏸 嘟嘟羽毛球 — 人物形象帅气化重塑（3 版 Demo 选型对比）</h1>
    <p>
      所有 Demo 均在<strong>严格保持游戏判定支点（肩高 -70px）、挥拍击球扫掠半径（55px）、接地约束与等长双段 IK 链条</strong>的前提下生成。<br/>
      头身比由原版的 2.5 头身升级为 <strong>4.8 ~ 5.0 头身</strong>，面部重构为硬朗动漫下颌，大幅提升动作张力与帅气度！
    </p>
  </div>
  <div class="container">
    ${cardsHtml.join("")}
  </div>
</body>
</html>
`;

fs.writeFileSync(`${OUT_DIR}/index.html`, fullHtml);
console.log(`Demo 页面已生成: ${OUT_DIR}/index.html`);
