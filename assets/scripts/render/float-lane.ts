// ============================================================
// 场边飘字的「车道分配」—— 纯函数,引擎与 node 共用。
//
// 为什么单独一个文件:用户报的现场是「同一拍同时触发多个特殊击打
// (跳杀 + 重击附魔),左侧的标签会重叠」。旧错行(world.floatSpawn)只数
// 同侧还活着的带板字条数,而且 Math.min(n, 2) 封顶两行 —— 跳杀 + 附魔一拍
// 最多同帧出生四条场边字(档位 + 技能 + 跳杀 + 热手),第 3、4 条直接叠回
// 同一点;行高还只看新字自己的 size*1.9,不看已有各行的实际占位。
//
// 这里改成「接着同侧最低的下沿往下排」:每个堆叠成员 spawn 时记下自己的
// 占位盒(中心 y + 盒高),新字落在最低下沿 + gap 处;同侧没有活口(或都
// 已上浮过锚点)时回锚点行;最后夹到地面线上方 —— 一拍至多四条场边字,
// 这个上限只会在第 4 条上轻微压过地面线,好过把两行字叠回同一点。
// star 星芒外径远大于盒高,那是装饰性外溢,允许交叠 —— 这里保证的是
// 文字与底板本体不叠。
//
// 分层:零 cc 依赖,坐标语义全是世界系(y 向下);消费方 render/world.ts
// 的 floatSpawn(它负责把 FloatText 映射成 LaneRecord);判据
// tools/float-lane-check.ts。
// ============================================================

/** 一个飘字的占位记录(世界系):laneH = 车道占位盒高,0 = 非堆叠成员 */
export interface LaneRecord {
  active: boolean;
  wx: number;
  wy: number;
  laneH: number;
}

export interface LaneOpts {
  /** 新字的出生 x(定侧) */
  wx: number;
  /** 网 x:小于它算左场边,否则右场边 */
  netX: number;
  /** 场边锚点行(config.fx.floatSide.y) */
  anchorY: number;
  /** 新字的占位盒高(板高 size*1.7) */
  boxH: number;
  /** 行间缝隙(config.fx.floatLaneGap) */
  gap: number;
  /** 中心 y 上限(地面线上方):超出就夹住,宁可两行贴近也不排进球场地面 */
  maxCenter: number;
}

/** 算出下一条场边飘字的中心 y(世界坐标,y 向下)。 */
export function nextLaneY(records: LaneRecord[], o: LaneOpts): number {
  const mySide = o.wx < o.netX ? 0 : 1;
  let lowest = -Infinity;
  for (const r of records) {
    if (!r.active || r.laneH <= 0) continue;           // 非成员/已隐藏不占行
    if ((r.wx < o.netX ? 0 : 1) !== mySide) continue;  // 只看同侧
    const bottom = r.wy + r.laneH / 2;
    if (bottom > lowest) lowest = bottom;
  }
  let sy = o.anchorY;
  if (lowest > -Infinity) sy = Math.max(o.anchorY, lowest + o.gap + o.boxH / 2);
  return Math.min(sy, o.maxCenter);
}
