// ============================================================
// 渲染层入参副本 —— 「每帧插值但不回写 core」的唯一正确形状。
//
// 现场(用户 2026-10-05 抓到):对练里 AI 明明穿着蓝球衣,头上却顶着一头烈焰少年的
// 橙发、胸前多一道斜披巾 —— 玩家口径「蓝色原皮 + 另一个皮肤的发型」。
//
// 根因不在皮肤表,在**副本**。world 为了把 px/py 插值成帧间位置又不改 core 的 Player,
// 每帧 `Object.assign(一个全站共用的 playerView, p)` 再改 x/y。而 Object.assign 只拷
// **源对象自己有的键**:playerSkin / racketSkin / faceSkin 是可选字段,player.create()
// 从不建键,只有 career.applyToMatch() 把它们挂在「你」身上 ⇒ 轮到 CPU 那一帧这三个键
// **没人覆盖**,上一名球员留下的皮肤就被 drawPlayer 读走了。绘制顺序是「离网远的先画」,
// 于是先画的那个恒然后画的那个的装扮(2v2 会串得更远,传说法阵也会套到对手脚下)。
//
// 判据:副本**按源对象各存一份**(WeakMap 键 = 实体本身)。这样键的形状跟人走 ——
// 谁身上没有 playerSkin,他的副本里就永远不会有。实体每局整批重建,WeakMap 自动放掉。
//
// 顺带第二条:副本对象不是实体,所以 sprites 里 `ball.owner === p` 这类**身份比较**在
// 对局里恒假(发球托球姿势因此只在商店/出图里出现过)。副本上挂一个 viewSrc 回指实体,
// 身份判断走那一跳 —— 不这么改就得让渲染直接写 core 的 x/y,那条铁律不能破。
//
// 零 cc 依赖:判据 tools/view-leak-check 在 node 下直接跑这里,不碰引擎。
// ============================================================
import type { Ball, Player } from "../core/types";

/** 渲染副本:源对象的全部字段 + 回指实体的 viewSrc */
export type View<S extends object> = S & { viewSrc: S };

/** drawShuttle 的球副本:sqR 是渲染层算的形变插值值(Ball 上没有,drawShuttle 按内部 RBall 读) */
export type BallView = View<Ball> & { sqR?: number };

/**
 * 取(或首建)src 专属的那一份副本。cache 由调用方持有 ⇒ 生命周期跟着持有者走,
 * 不藏模块级状态;实体整批重建时 WeakMap 自己放掉。
 */
export function viewOf<S extends object, V extends View<S>>(cache: WeakMap<S, V>, src: S): V {
  let v = cache.get(src);
  if (v === undefined) {
    v = { viewSrc: src } as unknown as V;
    cache.set(src, v);
  }
  return Object.assign(v, src);
}

/**
 * 身份比较用的那一跳:对局里 drawPlayer 收到的是副本(≠ 实体),商店/出图直接传实体。
 * 用它取代裸 `p`,两种入口都成立 —— 漏掉它就是「只有真机才有、预览里永远看不见」的 bug。
 */
export function entityOf(p: Player): Player {
  return (p as View<Player>).viewSrc ?? p;
}
