// ============================================================
// 场边飘字的「车道整层重排」—— 纯函数,引擎与 node 共用。
//
// 演进:0.0.24 的 nextLaneY 是「spawn 时一次性分配」—— 新字接着同侧最低
// 占位下沿往下排,排不下就 Math.min(sy, maxCenter) 硬夹。用户现场(0.0.25):
// 「标签一多还是会有重叠」—— 夹取把所有超限的字精确叠在同一个 y 上,像素级
// 重合;而且行位出生时定死,行只朝下长、永不回收,锚点上方的天空全浪费。
// 叠字还有两个帮凶,不在这个文件里:池化节点不重排兄弟序(后生的牌子可能
// 画在先生的下面)、各字按剩余寿命各自上浮(后出生的升得快,行距被吃掉)。
//
// 这里改成「每步整层重排 + 容量驱逐」:调用方(render/world.ts)每模拟步把
// 全体堆叠成员喂进来,这里按侧分组、按出生序从锚点行向下堆;堆不下(最后
// 一条的底沿要探过地面线)就驱逐 remain 最小的成员、其余整体上移回填。
// 被驱逐者由调用方就地快速淡出、不再占行 —— 于是「任何时刻的存活底板
// 两两不叠」是算术保证,不再依赖 spawn 时序与运气。
//
// 行距的运动学锁死同样在调用方:同侧所有成员共享一份「列上浮偏移」,
// 目标行位 + 偏移逐帧指数缓动,个体速度差不再吃缝。
//
// star 星芒整体压到所有底板下层的共享画布上(world.floatStarG),行与行之间
// 只剩受控的少量外溢 —— 这里保证的是文字与底板本体不叠。
//
// 分层:零 cc 依赖,坐标语义全是世界系(y 向下);判据 tools/float-lane-check.ts。
// ============================================================

/** 一个场边堆叠成员(世界系):laneH = 占位盒高(板高 size*1.7),0 = 非成员 */
export interface LaneMember {
  /** 出生 x(定侧) */
  wx: number;
  laneH: number;
  /** 剩余寿命比 life/maxLife(0..1):容量超限时驱逐最小的 —— 它本来就快淡完了 */
  remain: number;
  /** 已被判驱逐(淡出中):不再参与堆叠,也不会被重复驱逐 */
  condemned: boolean;
}

export interface LaneLayoutOpts {
  /** 网 x:小于它算左场边,否则右场边 */
  netX: number;
  /** 场边锚点行(config.fx.floatSide.y) */
  anchorY: number;
  /** 行间缝隙(config.fx.floatLaneGap) */
  gap: number;
  /** 地面线:任何存活底板的下沿不许探过(世界 y 向下) */
  maxBottom: number;
}

export interface LaneLayout {
  /** 与入参对齐的目标中心 y;非成员 / 已驱逐 / 本次被判驱逐 = null(调用方跳过) */
  targets: (number | null)[];
  /** 与入参对齐;本次新判驱逐的成员(调用方置 condemned + 砍寿命走快速淡出) */
  evict: boolean[];
}

/** 按当前成员子集模拟「锚点向下堆」,返回每条的中心 y(与 stack 下标对齐) */
function stackYs(members: LaneMember[], stack: number[], o: LaneLayoutOpts): number[] {
  const ys: number[] = [];
  let prevBottom = -Infinity;
  for (let k = 0; k < stack.length; k++) {
    const h = members[stack[k]].laneH;
    const y = k === 0 ? o.anchorY : prevBottom + o.gap + h / 2;
    ys.push(y);
    prevBottom = y + h / 2;
  }
  return ys;
}

/**
 * 场边堆叠层整层重排:同侧活成员按出生序(数组序)从锚点行向下堆,
 * 堆不下就驱逐 remain 最小者(并列取先出生的)重堆,直到放下或只剩一条。
 */
export function layoutLanes(members: LaneMember[], o: LaneLayoutOpts): LaneLayout {
  const targets: (number | null)[] = new Array(members.length).fill(null);
  const evict: boolean[] = new Array(members.length).fill(false);

  for (let side = 0; side < 2; side++) {
    const stack: number[] = [];
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      if (m.laneH <= 0 || m.condemned) continue;   // 非成员/已驱逐不占行
      if ((m.wx < o.netX ? 0 : 1) !== side) continue;
      stack.push(i);
    }
    // 容量驱逐:最后一条底沿探过地面线就砍 remain 最小的一条,重堆回填。
    // 只剩一条时不再驱逐(孤字永远让它显示,真放不下就贴地面线收)。
    let ys = stackYs(members, stack, o);
    while (stack.length > 1 &&
           ys[ys.length - 1] + members[stack[stack.length - 1]].laneH / 2 > o.maxBottom) {
      let victim = 0;
      for (let k = 1; k < stack.length; k++) {
        if (members[stack[k]].remain < members[stack[victim]].remain) victim = k;
      }
      evict[stack[victim]] = true;
      stack.splice(victim, 1);
      ys = stackYs(members, stack, o);
    }
    for (let k = 0; k < stack.length; k++) targets[stack[k]] = ys[k];
    // 单条也放不下的兜底(现役数值造不出来:锚点 298 + 半盒 ≤ 325 ≪ 470)
    if (stack.length === 1) {
      const i = stack[0];
      const bottom = ys[0] + members[i].laneH / 2;
      if (bottom > o.maxBottom) targets[i] = o.maxBottom - members[i].laneH / 2;
    }
  }
  return { targets, evict };
}
