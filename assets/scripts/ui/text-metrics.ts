// ============================================================
// 文案宽度估算 —— 全站唯一一把「字有多宽」的尺
//
// 单独成文件、零 cc 依赖的原因:更新弹窗的 markdown 折行(assets/scripts/ui/
// release-notes.ts)完全建立在这把尺上,而折行算错一个单位就是文字糊到标题上。
// 折行是纯算术,就该能在 node 下回归 —— 所以它不能和 cc 绑在同一个文件里。
// ui-arcade.ts 原样转出本函数,调用点不必改。
// ============================================================

/**
 * 全角按 1.05、半角按 0.62 个字宽。
 * Graphics 没有 measureText,而 Label 的 contentSize 要等布局才准(当帧读是旧值),
 * 所以「底块要跟着字长走」的地方(chip / 轻提示 / HUD 状态条)统一用这把尺子。
 * 全角系数取 1.05 而非 1.0:宁可在折行时早一点换行,也不能晚 —— 早换只是少排一个字,
 * 晚换就是溢出边框。
 */
export function textW(text: string, size: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += text.charCodeAt(i) > 255 ? 1.05 : 0.62;
  return Math.round(w * size);
}
