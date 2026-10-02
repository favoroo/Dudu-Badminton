// ============================================================
// 字体资源统一加载与管理: MiSans 游戏多字重体系
//
// 设计策略:
//   用户提供了 MiSans 字体全家族,并提出"整体字体可以稍微粗一点(粗一点有质感)"。
//   为兼顾视觉冲击力与长文本可读性,采用双字重分级架构:
//   1. BodyFont (MiSans-Semibold, 650粗度):
//      作为全游戏默认主字体。字形饱满硬朗、线条扎实,在暗色渐变面板、
//      按钮、属性列表、战前简报、操作按键上展现出厚重高级的质感。
//   2. DisplayFont (MiSans-Heavy, 900粗度):
//      街机高爆发力字体。用于大标题、比分大字、COMBO、MATCH POINT 赛点、
//      大横幅与击打评级。
//
// 架构位置:
//   位于 game/ 基础设施层(只依赖 cc),可同时被 ui/、render/ 与 input/ 消费,
//   严格遵守 AGENTS.md"render 不反向 import ui"的分层铁律。
// ============================================================
import { Font, Label, resources } from "cc";

let bodyFont: Font | null = null;
let displayFont: Font | null = null;

const bodyWaiters: Array<(f: Font) => void> = [];
const displayWaiters: Array<(f: Font) => void> = [];

/** 获取主字体 (MiSans-Semibold, 稍粗厚实有质感) */
export function getBodyFont(): Font | null {
  return bodyFont;
}

/** 获取标题/比分大字字体 (MiSans-Heavy, 街机力量感) */
export function getDisplayFont(): Font | null {
  return displayFont;
}

/** 主字体就绪监听(若已就绪立即同步调用) */
export function onBodyFont(cb: (f: Font) => void): void {
  if (bodyFont) {
    cb(bodyFont);
    return;
  }
  bodyWaiters.push(cb);
}

/** 标题字体就绪监听(若已就绪立即同步调用) */
export function onDisplayFont(cb: (f: Font) => void): void {
  if (displayFont) {
    cb(displayFont);
    return;
  }
  displayWaiters.push(cb);
}

/**
 * 统一为 Label 挂载 MiSans 字体:
 * - disp = false (默认): 挂载主字体 (MiSans-Semibold, 整体饱满厚实有质感)
 * - disp = true: 挂载街机标题大字字体 (MiSans-Heavy, 比分/大标题/爆发力)
 *
 * 加载完成前先正常显示系统字,加载完成后无缝替换,无闪烁与报错。
 */
export function applyFont(label: Label | null | undefined, disp = false): void {
  if (!label || !label.isValid) return;

  const target = disp ? (displayFont ?? bodyFont) : bodyFont;
  if (target) {
    label.font = target;
    label.useSystemFont = false;
    return;
  }

  if (disp) {
    onDisplayFont((f) => {
      if (label && label.isValid) {
        label.font = f;
        label.useSystemFont = false;
      }
    });
    // 若 DisplayFont 较慢,先让已就绪的 BodyFont 顶上
    if (!bodyFont) {
      onBodyFont((bf) => {
        if (label && label.isValid && !displayFont) {
          label.font = bf;
          label.useSystemFont = false;
        }
      });
    }
  } else {
    onBodyFont((f) => {
      if (label && label.isValid) {
        label.font = f;
        label.useSystemFont = false;
      }
    });
  }
}

// 自动启动资源预加载(环境安全保护: node 测试或无 resources 环境下静默跳过)
try {
  if (resources && typeof resources.load === "function") {
    // 1. 加载主字体
    resources.load("fonts/dudu-body", Font, (err, asset) => {
      if (!err && asset && asset.isValid) {
        bodyFont = asset;
        for (const cb of bodyWaiters.splice(0)) {
          cb(asset);
        }
      }
    });

    // 2. 加载标题字体
    resources.load("fonts/dudu-display", Font, (err, asset) => {
      if (!err && asset && asset.isValid) {
        displayFont = asset;
        for (const cb of displayWaiters.splice(0)) {
          cb(asset);
        }
      }
    });
  }
} catch {
  // node / 测试环境降级
}
