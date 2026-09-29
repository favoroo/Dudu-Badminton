// ============================================================
// 数学工具 + 存储封装
// 存储不再直接摸 localStorage:后端由宿主注入(Cocos 里注入 sys.localStorage,
// node 回归测试不注入走内存),注入失败/未注入时内存兜底,
// Safari file:// 直接抛异常这类平台差异都被挡在这一层。
// ============================================================

export const TAU = Math.PI * 2;
export const D2R = Math.PI / 180;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const inv = (a: number, b: number, v: number): number => (b === a ? 0 : clamp((v - a) / (b - a), 0, 1));
export const rand = (a = 1, b?: number): number => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randi = (a: number, b?: number): number => Math.floor(rand(a, b === undefined ? a : b));
export const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

// 点 → 线段 的最近点与距离平方(扫掠碰撞用)
export function closestOnSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return { x: ax + dx * t, y: ay + dy * t, t };
}

export function segSegDist2(a1x: number, a1y: number, a2x: number, a2y: number, b1x: number, b1y: number, b2x: number, b2y: number): number {
  // 两线段最近距离²:取四端点到对段的最小值(足够用于本游戏的短段)
  const c1 = closestOnSeg(a1x, a1y, b1x, b1y, b2x, b2y);
  const c2 = closestOnSeg(a2x, a2y, b1x, b1y, b2x, b2y);
  const c3 = closestOnSeg(b1x, b1y, a1x, a1y, a2x, a2y);
  const c4 = closestOnSeg(b2x, b2y, a1x, a1y, a2x, a2y);
  return Math.min(
    dist2(a1x, a1y, c1.x, c1.y), dist2(a2x, a2y, c2.x, c2.y),
    dist2(b1x, b1y, c3.x, c3.y), dist2(b2x, b2y, c4.x, c4.y),
  );
}

// 线段与圆的扫掠相交(两物体都在动)
export function sweptHit(a1x: number, a1y: number, a2x: number, a2y: number, b1x: number, b1y: number, b2x: number, b2y: number, r: number): boolean {
  return segSegDist2(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y) <= r * r;
}

// ---------- 存储 ----------

/** 平台存储后端的最小接口(Cocos 的 sys.localStorage 天然满足) */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MEM = new Map<string, string>();
const NS = "dd02.";
let backend: KVStorage | null = null;

/** 宿主启动时调用一次;传 null 退回纯内存(单测/无档场景) */
export function setStorageBackend(b: KVStorage | null): void {
  backend = b;
}

export function load<T>(key: string, fallback: T): T {
  const k = NS + key;
  if (backend) {
    try {
      const raw = backend.getItem(k);
      if (raw === null) return fallback;
      return JSON.parse(raw) as T;
    } catch (_) { /* 掉进内存兜底 */ }
  }
  const m = MEM.get(k);
  return m === undefined ? fallback : (JSON.parse(m) as T);
}

export function save(key: string, value: unknown): void {
  const k = NS + key;
  MEM.set(k, JSON.stringify(value));
  if (backend) {
    try { backend.setItem(k, JSON.stringify(value)); } catch (_) { /* 内存兜底 */ }
  }
}
