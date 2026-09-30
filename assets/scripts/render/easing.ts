// ============================================================
// 视觉缓动曲线库 —— 只服务表现层(渲染/特效/预览工具),不参与任何模拟。
//
// 为什么不放进 core/utils.ts:那是逻辑层的数学底座(physics / AI / probe 回归
// 断言都吃它),把"淡出曲线"这类纯观感量塞进去,等于让渲染风格污染模拟层,
// 违反分层铁律 4(core 零依赖、可在 node 下回归)。本文件零 cc、只读 CFG.fx,
// 所以 render/* 与 tools/fx-preview.ts 都能直接用。
//
// 为什么要有这个文件:老实现里**所有**特效淡出都是线性的 life/max,扩散环用
// lerp(rr, rr1, 0.28) 一步到位,震屏是纯随机噪声 —— 线性淡出在眼里就是"啪地
// 出现、啪地消失",这是"简单粗暴"观感的第一成因。曲线一律走 ease-out 前段:
// 出现快、消失慢,余量留在尾巴上,才读得出"飘"和"散"。
// ============================================================

/** 0..1 夹取(缓动函数的入参一律先过这里,防 NaN 与越界把 alpha 打飞) */
export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** 三次缓出:粒子透明度、丝带淡出的默认曲线 */
export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

/** 四次缓出:比 cubic 更"弹"的前段,扩散环扩张用它 */
export function easeOutQuart(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u * u;
}

/**
 * 回弹缓出:先冲过目标再回落。飘字弹入、球体压扁回顶都靠它的过冲
 * (overshoot 典型 1.2~2.0,越大越"Q")。
 */
export function easeOutBack(t: number, overshoot = 1.7): number {
  const u = clamp01(t) - 1;
  const k = overshoot + 1;
  return 1 + u * u * ((k * u) + k);
}

/** 幂淡出:a ∈ 0..1 存活比,k>1 时尾段掉得快(像被风吹散),k<1 时更黏 */
export function fadePow(a: number, k: number): number {
  const u = clamp01(a);
  return k === 1 ? u : Math.pow(u, k);
}

/** 角度绕回 (-π, π]:滞后角追踪必须比"最短弧",否则球头会绕远路翻面 */
export function wrapAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  else if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/** 弹性追踪一步(位移式):cur 以 k 的比例靠近 target,阻尼 v 衰减 */
export function springTo(cur: number, target: number, vel: number, k: number, damp: number): [number, number] {
  const v = (vel + (target - cur) * k) * damp;
  return [cur + v, v];
}
