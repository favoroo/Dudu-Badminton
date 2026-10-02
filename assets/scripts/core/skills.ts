// ============================================================
// 技能系统 (Skills): 球员可装备的主动技能状态机与物理驱动
// 纯逻辑层 (core/): 零 Cocos 依赖, 可在 Node 下跑完整回归测试
// 遵循分层铁律: types ← config ← skills ← player/rules ← render/ui
// ============================================================
import { CFG } from "./config";
import { clamp } from "./utils";
import { Physics } from "./physics";
import { Ball, HitOpt, Player, PlayerSkillState, SkillDef, SkillId } from "./types";

const C = CFG;
const CO = C.court;

/** 获取全部技能元数据定义 */
export function allSkills(): SkillDef[] {
  return C.skills.list as SkillDef[];
}

/** 根据 id 查询技能定义, 不存在兜底至 "lunge" */
export function defOf(id: SkillId): SkillDef {
  const list = allSkills();
  return list.find((s) => s.id === id) || list[0];
}

/** 初始化球员技能运行时状态 */
export function initSkillState(id: SkillId = "lunge"): PlayerSkillState {
  const def = defOf(id);
  return {
    id: def.id,
    cd: 0,
    maxCd: def.cooldownFrames,
    activeT: -1,
    buffT: 0,
    ready: true,
    magnetPulling: false,
  };
}

/** 每回合开球前复位技能临时状态 (保留冷却或就绪) */
export function resetPoint(p: Player): void {
  if (!p.skill) p.skill = initSkillState("lunge");
  p.skill.activeT = -1;
  p.skill.buffT = 0;
  p.skill.magnetPulling = false;
  p.flashT = 0;
  p.flashHoldT = 0;
  p.flashStrikeT = 0;
  p.flashFrom = null;
  p.focusT = 0;
  // 每分开始时重置冷却至就绪, 让每回合开局都可施展策略
  p.skill.cd = 0;
  p.lungeCd = 0;
  p.lungeT = -1;
  p.lungeShotT = 0;
}

/** 当前局势下是否满足激活门槛 (供 UI 按钮点亮/置灰与 AI 决策使用) */
export function canActivate(p: Player, ball: Ball): boolean {
  if (!p || !p.skill) return false;
  const s = p.skill;
  if (s.cd > 0) return false;

  switch (s.id) {
    case "lunge":
      // 强力跨步: 在地面、未挥拍、未在跨步中
      return p.onGround && p.swingT < 0 && p.lungeT < 0;

    case "smash":
      // 百分百重击: 随时可预开启附魔 (只要未在附魔期)
      return s.buffT <= 0;

    case "flash": {
      // 闪现扣杀:
      // 1. 球必须在 play 飞行中,而且**不是自己刚打出去的那一拍**(lastHitter 同侧的话
      //    tryHit 一定拒绝,按下只会白白吃掉冷却 + 让人悬在半空丢脸)
      // 2. 球必须进入自己这半场
      // 3. 球离地高度达到扣杀高度 (>= 115px)
      // 4. 未在挥拍中、也不在上一段折跃的悬空/保底窗口里
      if (!ball || !ball.live || ball.held || ball.flying) return false;
      if (ball.lastHitter === p.side) return false;
      if ((p.flashHoldT ?? 0) > 0 || (p.flashStrikeT ?? 0) > 0) return false;
      const inCourt = p.side === "left" ? ball.x < CO.netX - 8 : ball.x > CO.netX + 8;
      const highEnough = (CO.groundY - ball.y) >= C.skills.flash.minHeight;
      return inCourt && highEnough && p.swingT < 0;
    }

    case "magnet": {
      // 引力吸球:
      // 对方发球后、回合进行中、且球未在吸取中、未被抓手
      if (!ball || !ball.live || ball.held || ball.flying) return false;
      if (ball.magnetPull) return false;
      return p.swingT < 0;
    }

    case "focus":
      // 时空减速: 回合进行中未在领域中
      if (!ball || !ball.live || ball.held || ball.flying) return false;
      return s.buffT <= 0;

    default:
      return true;
  }
}

/**
 * 技能键「就绪但门槛未满足」的可读原因(冷却是另一态,走倒计时,不在这里报)。
 * 文案住在 config.skills.blockText —— UI 只显示,不自己猜判据。
 * 返回 null = 无需解释(完全就绪 / 还在冷却)。
 */
export function skillBlockReason(p: Player, ball: Ball | null): string | null {
  if (!p || !p.skill) return null;
  const s = p.skill;
  if (s.cd > 0) return null;
  if (canActivate(p, ball as Ball)) return null;
  const T = C.skills.blockText as Record<string, string>;
  switch (s.id) {
    case "lunge":
      if (!p.onGround) return T.needGround;
      if (p.swingT >= 0) return T.swinging;
      if (p.lungeT >= 0) return T.lunging;
      return null;
    case "smash":
      return T.buffing;
    case "flash": {
      if (!ball || !ball.live || ball.held || ball.flying) return T.notIncoming;
      if (ball.lastHitter === p.side) return T.notIncoming;
      if ((p.flashHoldT ?? 0) > 0 || (p.flashStrikeT ?? 0) > 0) return T.swinging;
      if (p.swingT >= 0) return T.swinging;
      const inCourt = p.side === "left" ? ball.x < CO.netX - 8 : ball.x > CO.netX + 8;
      if (!inCourt) return T.notIncoming;
      return T.lowBall;
    }
    case "magnet":
      if (!ball || !ball.live || ball.held || ball.flying) return T.notIncoming;
      if (p.swingT >= 0) return T.swinging;
      return T.pulling;
    case "focus":
      return T.focusing;
    default:
      return null;
  }
}

/** 触发技能激活, 返回是否成功 */
export function activate(p: Player, ball: Ball, dir?: number): boolean {
  if (!p || !p.skill) return false;
  if (!canActivate(p, ball)) return false;

  const def = defOf(p.skill.id);
  p.skill.cd = def.cooldownFrames;
  p.skill.maxCd = def.cooldownFrames;

  switch (p.skill.id) {
    case "lunge": {
      // 强力跨步: 原有跨步冲量强化, 开启 1 秒流风动画与暴击窗口
      const LG = C.lunge;
      p.lungeT = 0;
      p.lungeDir = dir ? dir : (Math.abs(p.vx) > 1 ? (p.vx > 0 ? 1 : -1) : p.facing);
      p.lungeShotT = LG.shotWindow; // 60 帧 = 1 秒
      p.sq = 0.85;
      p.vx += p.lungeDir * LG.speed;
      p.skill.activeT = LG.duration;
      return true;
    }

    case "smash": {
      // 百分百重击: 开启烈焰聚能附魔, 球拍高亮
      p.skill.buffT = C.skills.smash.buffDuration;
      p.smashGlow = 36;
      p.face = "fierce";
      p.faceT = 30;
      return true;
    }

    case "flash": {
      // 闪现扣杀:原地留一道雷光残影,瞬间折跃到「球下方的高点」,悬空举拍 → 时停放行 → 必定劈扣。
      // 站位不再是拍脑袋的「球后方 28px / 球上方 15px」,而是拿判定区圆心(Physics.strikeOffset,
      // 与 player.strikeZone 同一条式子)反解脚底 —— 把球摆回圆心,本来就是一记够得着的正常高球;
      // 后面的保底接触窗口只替贴墙/贴网被边界夹取挪走、以及极高球顶到悬空上限那些情形兜底。
      const FL = C.skills.flash;
      const rad = Physics.reachRadius(ball);
      p.swingRadius = rad;                  // 半径跟着来球速度走:别让上次挥拍的残留值决定这次的圆心
      const off = Physics.strikeOffset(rad, p.facing);
      const minX = p.side === "left" ? CO.wallL : CO.netX + CO.netPad;
      const maxX = p.side === "left" ? CO.netX - CO.netPad : CO.wallR;
      p.flashFrom = { x: p.x, y: p.y };     // 渲染层拿 from→to 画雷光与残影(逻辑只留这一个数据点)
      p.flashT = FL.ghostFrames;
      p.flashHoldT = FL.holdFrames;
      p.flashStrikeT = 0;
      p.x = clamp(ball.x - off.dx, minX, maxX);
      // y 越小越高:脚底 = 球位往下挪 |off.dy|(圆心在脚底上方 ~73px),再夹一层悬空上限
      p.y = Math.max(ball.y - off.dy, CO.groundY - FL.maxHover);
      // 上一帧位一起搬:渲染画的是 lerp(px, x, alpha),而折跃当帧主循环要定格 7 帧
      // (fx.hitstopFlashCast)。定格期间 Rules.step 不跑、px 留在闪现前那一位,alpha 又常年
      // 贴着 0 —— 于是「时停」最该看清楚的那几帧,人物被画回起点,读起来就是
      // 「闪过去了、人又回到原位」。折跃是瞬移,不是位移,插值基准必须跟着跳。
      p.px = p.x;
      p.py = p.y;
      p.vx = 0;
      p.vy = 0;
      p.onGround = false;
      p.sq = C.player.jumpStretch;          // 起手那一下纵向拉伸,读作"跃起来了"而不是"飘上去了"
      p.swingT = -1;                        // 起拍交给 update 的状态机:蓄力帧走完那一帧才真的挥拍
      p.swingHit = false;
      p.swingStyle = "over";
      p.swingAim = C.aimDepth.deep;         // 默认压深场;玩家横滑仍能改落点
      p.smashGlow = 30;
      p.face = "fierce";
      p.faceT = 30;
      return true;
    }

    case "magnet": {
      // 引力吸球: 展开引力力场, 羽毛球高速牵引至身前
      p.skill.magnetPulling = true;
      const tx = p.x + p.facing * 34;
      const ty = Math.min(p.y - 42, CO.groundY - 60);
      const total = C.skills.magnet.pullFrames;
      ball.magnetPull = {
        targetX: tx,
        targetY: ty,
        player: p,
        total,
        t: total,
        fromX: ball.x,
        fromY: ball.y,
      };
      // 玩家准备挥拍
      p.smashGlow = 20;
      p.swingT = 0;
      p.swingStyle = "under";
      return true;
    }

    case "focus": {
      // 时空减速: 开启 1.5 秒子弹时间
      p.skill.buffT = C.skills.focus.duration;
      p.focusT = C.skills.focus.duration;
      return true;
    }
  }

  return false;
}

/** 每帧驱动技能状态机 */
export function update(p: Player, ball: Ball): void {
  if (!p || !p.skill) return;
  const s = p.skill;

  // 冷却计时
  if (s.cd > 0) s.cd--;
  // 增益状态计时
  if (s.buffT > 0) s.buffT--;
  // 执行期计时
  if (s.activeT >= 0) {
    s.activeT--;
    if (s.activeT < 0) s.activeT = -1;
  }
  // 闪现折跃特效衰减
  if (p.flashT && p.flashT > 0) p.flashT--;
  if ((p.flashT ?? 0) <= 0) p.flashFrom = null;   // 残影画完就收掉起点,不留脏数据
  // 时空减速衰减
  if (p.focusT && p.focusT > 0) p.focusT--;

  // ---------- 闪现折跃状态机:悬空蓄力 → 起拍(保底窗口同步开) → 随挥落地 ----------
  // 起拍不在 activate() 里直接设,是因为那一下要和「时停」对上:主循环在折跃当帧定格若干帧
  // (世界时钟不前进,这里也不递减),放行后再悬空几帧举拍,球才真正被扣出去。
  // 递减不看 s.id:中途换装(Career.equipSkill 直接重建 skill 状态)会留下一个没人认领的
  // flashHoldT,而 rules 的"蓄力期把球按住"是看人物字段的 —— 让它一定排得空,球才不会定死。
  if ((p.flashHoldT ?? 0) > 0) {
    p.flashHoldT = (p.flashHoldT ?? 0) - 1;
    if (p.flashHoldT <= 0) {
      p.flashHoldT = 0;
      if (s.id === "flash") {              // 中途被换装摘掉技能就只排空蓄力,不再凭空补一拍
        p.swingT = C.swing.windup;                  // 本帧末尾 player 的挥拍机器 +1,正好落进命中窗口
        p.swingHit = false;
        p.swingQ = 0;
        p.flashStrikeT = C.skills.flash.strikeFrames;
        p.racketPrev = Physics.racketHead(p, 0, p.swingRadius);
        // 落点就在折跃这里:起拍那一拍的惯量把人带下来,而不是从高点松手飘落地。
        // 悬空蓄力期 p.vy 被 player.ts 按住为 0,蓄力一结束这里给初速,重力照常接管。
        p.vy = C.skills.flash.diveVy;
      }
    }
  }
  if (p.flashStrikeT && p.flashStrikeT > 0) p.flashStrikeT--;

  // 保持同步 lungeCd 字段兼容现有逻辑
  if (s.id === "lunge") {
    p.lungeCd = s.cd;
  }

  // 动态评估就绪状态
  s.ready = canActivate(p, ball);
}

/**
 * 击球修正钩子: 在 player.tryHit / buildShot 中注入技能加成
 */
export function modifyShot(p: Player, opt: HitOpt): {
  speedBoost: number;
  powerDeg: number;
  forceSmash: boolean;
  skillKind?: SkillId;
} {
  let speedBoost = 0;
  let powerDeg = 0;
  let forceSmash = false;
  let skillKind: SkillId | undefined = undefined;

  if (!p || !p.skill) {
    return { speedBoost, powerDeg, forceSmash };
  }

  // 1. 强力跨步击球
  if (opt.lungeShot && p.lungeShotT > 0) {
    speedBoost += C.lunge.shotBoost;
    powerDeg += C.lunge.shotPowerDeg;
    skillKind = "lunge";
  }

  // 2. 百分百重击 (消耗附魔)
  if (p.skill.id === "smash" && p.skill.buffT > 0) {
    opt.sweet = true;
    opt.perfect = true;
    opt.q = 1.0;
    forceSmash = true;
    speedBoost += C.skills.smash.speedBoost;
    powerDeg += C.skills.smash.powerDeg;
    p.skill.buffT = 0; // 命中消耗附魔
    skillKind = "smash";
  }

  // 3. 闪现扣杀:只在保底接触窗口内兑现,命中即消耗
  //    (旧版拿 flashT 那 20 帧当 buff,漏球之后随手一拍还能白嫖一记必杀)
  if (p.skill.id === "flash" && (p.flashStrikeT ?? 0) > 0) {
    opt.sweet = true;
    opt.perfect = true;
    opt.q = Math.max(opt.q ?? 0, C.skills.flash.guaranteedQ);
    forceSmash = true;
    p.flashStrikeT = 0;
    speedBoost += C.skills.flash.speedBoost;
    powerDeg += C.skills.flash.powerDeg;
    skillKind = "flash";
  }

  // 4. 引力吸球回击
  if (p.skill.id === "magnet" && p.skill.magnetPulling) {
    p.skill.magnetPulling = false;
    speedBoost += C.skills.magnet.speedBoost;
    powerDeg += 6;
    skillKind = "magnet";
  }

  // 5. 时空领域反击:领域持续期内击球,初速与压弧各加一档。
  //    全局时间膨胀对「相对局势」是恒等变换(球/AI/计时器同比例变慢),
  //    只补跑位拿不到分;这里把「从容反击」兑现成实际更凶的回球。
  if (p.skill.id === "focus" && ((p.focusT ?? 0) > 0 || p.skill.buffT > 0)) {
    speedBoost += C.skills.focus.speedBoost;
    powerDeg += C.skills.focus.powerDeg;
    skillKind = "focus";
  }

  return { speedBoost, powerDeg, forceSmash, skillKind };
}

export const Skills = {
  allSkills,
  defOf,
  initSkillState,
  resetPoint,
  canActivate,
  skillBlockReason,
  activate,
  update,
  modifyShot,
};
