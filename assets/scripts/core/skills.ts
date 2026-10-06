// ============================================================
// 技能系统 (Skills): 球员可装备的主动技能状态机与物理驱动
// 纯逻辑层 (core/): 零 Cocos 依赖, 可在 Node 下跑完整回归测试
// 遵循分层铁律: types ← config ← skills ← player/rules ← render/ui
// ============================================================
import { CFG } from "./config";
import { clamp } from "./utils";
import { Physics } from "./physics";
import { Ball, HitOpt, Player, PlayerSkillState, SkillDef, SkillId } from "./types";
import { ShadowGate } from "./shadow-gate";

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

// ---------- 双槽寻址(2026-10-06 双技能槽) ----------
//
// 槽1 = p.skill(老槽,AI/关卡对手/全部回归工具只有这一槽),槽2 = p.skill2(只挂真人)。
// 所有"按 id 找技能状态"的判据都走 slotOfSkill,不许再写 `p.skill.id === "xxx"` ——
// 那是单槽假设的形状,技能装进槽2之后判据就静默失明(键亮着按了没反应的那类病)。

/** 槽位 → 运行时状态(1=主槽,2=副槽;空槽返回 undefined) */
export function slotState(p: Player, slot: 1 | 2): PlayerSkillState | undefined {
  return slot === 1 ? p?.skill : p?.skill2;
}

/** 这款技能装在哪一槽(同一款不许装两槽,装备层保证),没装返回 undefined */
export function slotOfSkill(p: Player, id: SkillId): PlayerSkillState | undefined {
  if (p?.skill?.id === id) return p.skill;
  if (p?.skill2?.id === id) return p.skill2;
  return undefined;
}

/** 是否携带这款技能(任一槽) */
export function hasSkill(p: Player, id: SkillId): boolean {
  return !!slotOfSkill(p, id);
}

/** 每回合开球前复位技能临时状态 (保留冷却或就绪) */
export function resetPoint(p: Player): void {
  const SH = C.skills.shadow;
  // 双槽同规:每分开始时重置冷却至就绪, 让每回合开局都可施展策略。
  // 槽1 缺失照旧兜底(老工具/半成品人物字面量不带 skill 字段)。
  if (!p.skill) p.skill = initSkillState("lunge");
  for (const s of [p.skill, p.skill2]) {
    if (!s) continue;
    s.activeT = -1;
    s.buffT = 0;
    s.magnetPulling = false;
    s.cd = 0;
  }
  p.flashT = 0;
  p.flashHoldT = 0;
  p.flashStrikeT = 0;
  p.flashFrom = null;
  p.focusT = 0;
  p.focusHit = false;
  p.lungeCd = 0;
  p.lungeT = -1;
  p.lungeShotT = 0;
  p.lungeAutoT = 0;   // 每分开新局不许留残窗:否则上一分没花掉的待发窗会给这一分的来球凭空补一拍
  p.smashAutoT = 0;   // 同一条规矩管重击的"代出一拍"窗(2026-10-04 一键化):残窗 = 凭空多打一拍
  p.rageAutoT = 0;    // 怒气重击的代拍窗同理:残窗跨分会让下一分的第一拍被系统替玩家轰出去。
                      // **怒气本身不清**(p.rage,含已攒的多管):用户口径「只有释放才扣量」,
                      // 攒是整局的事。buffT 上面已经归零(armed 窗跨分没有意义),所以这里只收代劳、不收资源。
  // 影分身(2026-10-05 改口径):召唤标记每分重开(「一分之内只能释放一次」照旧),
  // 但**在场的分身不再散去** —— 用户:「上一局的影分身可以保留到下一局,而不是会直接消失」。
  // 只做一件事:带着未用满额度活过这一分的分身,**额度补满回 maxHits**。
  // 两道闸缺一不可:
  //   · `hits < maxHits` —— 已经接满的那个不许复活(否则等于把"接三球就消散"偷偷改掉)
  //   · `despawnT <= 0` —— 正在播消散演出的那个也已经用满,同样不许复活
  // 不落盘、也不跨对局:重开新局由 rules 的 R.players = [] 整批丢弃,这里**不要**去清它。
  p.shadowCast = false;
  if (SH.refillHits) {
    for (const sc of ShadowGate.clonesOf(p)) {
      if (sc.hits < SH.maxHits && sc.despawnT <= 0) {
        sc.hits = 0;
        sc.refillT = SH.refillFlashFrames;   // 只开个读数,亮片由渲染层读它,倒计时由 shadow.updateClones 递减
      }
    }
  }
}

/**
 * 这款技能的键面走「蓄能环 + 百分比」还是「冷却倒计时」。**判据只有这一份**,
 * pad-cd / touchpad / game-root / skill-layout 全调它,不许在调用点各写一遍 id 比较
 * —— 多一款充能技能时那些散落的 `=== "rage"` 会一个个漏。
 *
 * 为什么不看 cd 长度自动判:cooldownFrames 小不等于"资源制"(影分身 60 帧、跨步 48 帧
 * 都很短,但它们的门槛确实是冷却)。资源制是一条设计声明,所以进表(SkillDef.kind)。
 */
export function isChargeSkill(id: SkillId): boolean {
  return defOf(id).kind === "charge";
}

/**
 * 怒气存量 → 0..1 比例(唯一换算处:分档演出、兑现强度、AI 满怒判据全读它,不各自除 max)。
 *
 * 多管蓄力后的读法:存量 ≥ 一整管时 clamp 恒返回 1 —— 这正是想要的那条分流:
 * `ratio >= 1`(modifyShot 的 forceSmash 支)与 `>= 1`(ai.ts 满怒才按)都等价于
 * "至少攒着一整管",零头小释放(<一管)才按比例缩放。键面要的"第几管/管内填充"
 * 是另一个量纲,走下面 ragePipesOf / ragePipeFillOf 两兄弟,别在这里塞。
 */
export function rageRatioOf(p: Player): number {
  const max = C.skills.rage.max;
  if (!(max > 0)) return 0;
  return clamp((p?.rage ?? 0) / max, 0, 1);
}

/** 怒气存量 → 已攒满的整管数(0..pipes)。键面"点亮几段"与满怒外环触发都吃它 */
export function ragePipesOf(p: Player): number {
  const RG = C.skills.rage;
  const max = RG.max;
  if (!(max > 0)) return 0;
  const pipes = Math.max(1, Math.round(RG.pipes ?? 1));
  return Math.min(Math.floor((p?.rage ?? 0) / max), pipes);
}

/**
 * 怒气存量 → 进行中那管的填充(0..1)。
 * 刻意的边界口径:恰好攒满 k 管(rage = k×max)时填充实战语义由 ragePipesOf 表达,
 * 这里恒回 0 —— 键面画"两段满 + 第三段空"比"两段满 + 第三段 100%"少一根歧义弧。
 */
export function ragePipeFillOf(p: Player): number {
  const max = C.skills.rage.max;
  if (!(max > 0)) return 0;
  return ((p?.rage ?? 0) % max) / max;
}

/**
 * 比例 → 档位下标(0 微怒 / 1 升温 / 2 沸腾 / 3 怒极),吃 C.skills.rage.tierAt。
 *
 * 【坑】必须**从高档往低档找**,返回第一个够得着的界。反过来从小往大找会永远落在第一档
 * —— 满怒读成 0 档,四档演出全被打成最低档,而它不崩、不报错,只是"攒了一整局结果毫无区别"。
 * (烟测现场抓到过这一条,rage-check ② 把它钉住:档位必须随 ratio 单调不降。)
 * 用 >= 比较:tierAt 末档恒为 1 ⇒ 满怒必落最后一档,不会出现"100% 却是第二档"的边角。
 */
export function rageTierOf(ratio: number): number {
  const RG = C.skills.rage;
  const tiers = RG.tierAt;
  const r = clamp(ratio, 0, 1);
  // 返回值再钳一次到演出表的最后一个下标:tierAt 与 tiers[] 等长是配置自洽判据(rage-check ②)
  // 该管的事,但这里越界会让表现层拿到 undefined 然后在 C 里炸,而这条路径只在改数值时才走到。
  const last = Math.min(tiers.length, RG.tiers.length) - 1;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (r >= tiers[i]) return Math.min(i, last);
  }
  return 0;
}

/**
 * 攒怒气:一记真实命中进来,按「物理档」给这一拍算该涨多少,返回实际增量(已含上限钳制)。
 *
 * 为什么这个函数住在 skills 而调用点在 player.settle:分档判据是技能知识,该住逻辑层;
 * 而"每一拍"这个事件只有 player 的结算路径知道(依赖方向 types←config←skills←player,
 * skills 不能反向 import player,所以由 player 报事实、skills 定数值)。
 *
 * 三条要命的口径,都有反例盯着(rage-check ②⑤⑥):
 * ① **只吃物理档**:sweet/perfect 必须是 player.ts 里从 qRaw 算出来的那两个局部量,
 *    不能读 shot.sweet/perfect —— 后者被技能钩子抬到顶档了。读错就等于"满怒那一拍自己
 *    给自己充能",与 player.ts:684-687「别把 buff 折进统计」是同一条规矩。
 * ② 释放那一拍整口不攒:调用方按 skillKind !== "rage" 挡掉(免费回血)。
 * ③ 没装这款技能一律不涨:资源不该在看不见的地方积累,换装回来也不该白得一管。
 */
export function gainRage(p: Player, f: { sweet: boolean; perfect: boolean; smash: boolean }): number {
  if (!p || !hasSkill(p, "rage")) return 0;   // 双槽:怒气装在槽2也要能攒(slotOfSkill 判,不认 p.skill.id)
  const RG = C.skills.rage;
  const hot = f.sweet || f.perfect;
  // 合并系数而非叠乘:bothMul 若不做成单独一档,1.8×2.0=3.6 ⇒ 一拍 18 点,六拍打穿上限
  const mul = hot && f.smash ? RG.bothMul : hot ? RG.sweetMul : f.smash ? RG.smashMul : 1;
  const gain = Math.round(RG.perHit * mul);
  // 总上限 = max × pipes(氮气式多管):瓶满三管后溢出作废,像氮气瓶装不进第四瓶
  const cap = RG.max * Math.max(1, Math.round(RG.pipes ?? 1));
  p.rage = Math.min((p.rage ?? 0) + gain, cap);
  return gain;
}

/**
 * 这一位球员的冷却是否「推迟开启」。
 *
 * ① 百分百重击(真人): 按下只上弦, 真正扣出去那一拍才付 (挥空不罚冷却)。
 * ② 时空减速(真人): 技能效果完全结束后才进入冷却 (生效期间键面显示"领域中", 结束后正式倒计时)。
 *
 * 不给 AI 开:它的技能循环强度归 diffs.* 那根旋钮管,放宽冷却等于偷偷改难度 —— 而
 * serve-check / ai-check 的真人替身从不按技能键,那两把尺子量不到这条,只能在这里钉死。
 * activate 与 modifyShot 两端共用这一个判据,别在调用点各写一份条件(写漏一侧就是白嫖)。
 *
 * 双槽(2026-10-06):推迟是**槽上技能**的属性,不是全人的属性 —— 槽1 跨步 + 槽2 重击时,
 * 激活跨步必须照常付冷却,只有激活重击那一槽才推迟。所以 activate / modifyShot 一律传
 * 具体的槽状态 `s` 进来按它的 id 判;不传 s 的旧口径(任一槽有推迟款就算)只留给
 * 单槽时代的旧调用方,双槽玩家身上它的语义是"并集",别拿它做付钱决定。
 */
export function defersCooldownToConsume(p: Player, s?: PlayerSkillState): boolean {
  if (!p || p.isAI) return false;
  const check = (st: PlayerSkillState): boolean =>
    (st.id === "smash" && C.skills.smash.cdOnConsume) || st.id === "focus";
  if (s) return check(s);
  return !!p.skill && check(p.skill) || !!p.skill2 && check(p.skill2);
}

/**
 * 吸球的「挥拍中」闸 —— 判据只这一份,canActivate 与键面原因 skillBlockReason 共用它
 * (写漏一侧就是"键亮着按了没反应",或反过来说不能按却按得响)。
 *
 * 2026-10-05 用户口径:「吸球技能优化一下,挥拍的时候也要可以使用技能」。
 * 旧门槛 `p.swingT < 0` 的代价不是"晚一拍才响",而是**一整段时间听不见**:一次挥拍
 * windup+active+recover = 22 帧,挥空再 +4 帧硬直,而收招瞬间 `p.swingBuf` 还能无缝续拍
 * —— 连着打球的真人,swingT 长期 >= 0,吸球键就长期是灰的。而这款技能的定位恰恰是
 * "这一拍挥空了/挥早了,还能把球捞回来",被它要救的那次挥拍锁死是反的。
 *
 * 真人放行后按下即**接管**正在进行的这一拍(见 activate 的 magnet 分支),所以既不会
 * 白扣一次冷却(那一拍必定兑现),也不会出现两条挥拍时间线抢同一颗球。
 *
 * AI 恒守旧门槛:它的强度归 diffs.* 那根旋钮管,放宽门槛等于偷偷送 CPU 一次"挥空也能捞回来"
 * (与 lunge 的 onGround 闸、三条一键化的 `!p.isAI` 同一条口径 —— serve-check / ai-check /
 * sim-check 的真人替身从不按技能键,那三把尺子量不到这条,只能在这里钉死)。
 *
 * 想把真人也退回旧行为:在下面的合取里加一条 `|| !C.skills.magnet.castWhileSwing`,
 * 并给 config.skills.magnet 补一个总闸键(与 smash.cdOnConsume / lunge.autoReturn 同款)。
 */
function magnetSwingGated(p: Player): boolean {
  return p.isAI && p.swingT >= 0;
}

/**
 * 当前局势下是否满足激活门槛 (供 UI 按钮点亮/置灰与 AI 决策使用)。
 * 双槽(2026-10-06):slot 指定问哪一槽(缺省 1 = 旧口径,AI 与全部旧调用方不动)。
 */
export function canActivate(p: Player, ball: Ball, slot: 1 | 2 = 1): boolean {
  const s = slotState(p, slot);
  if (!p || !s) return false;
  if (s.cd > 0) return false;

  switch (s.id) {
    case "lunge":
      // 强力跨步: 未挥拍、未在跨步中。
      // 2026-10-04 起真人跳跃中也可释放:跨步冲量照给(读作空中突进),重力不动,一次
      // 起跳至多一次 —— 冷却 48 帧长于满跳滞空 ~38 帧,不会变成空中小马达。
      // AI 保持落地门槛:AI 的够球范围归 diffs.* 那根旋钮管,空中突进不该白送
      // (同 lungeAutoT 的 !p.isAI 口径,serve-check / ai-check 的真人替身从不按技能键)。
      if (p.isAI && !p.onGround) return false;
      return p.swingT < 0 && p.lungeT < 0;

    case "smash":
      // 百分百重击: 随时可预开启附魔 (只要未在附魔期)
      // 2026-10-04 起真人这边 cd 在"扣出去"那一拍才付,所以拦人的门槛是 buffT 而不是冷却:
      // 附魔挂着的时候再按一次没有意义(那一拍已经在等着兑现),按键因此仍置灰 = "附魔中"。
      return s.buffT <= 0;

    case "rage": {
      // 怒气重击:**任何怒气档位都放得出去**(用户口径「怒气够一点就能放」,强度按档位走),
      // 所以门槛只有两条:① 已有一发释放挂着没兑现(buffT,与重击用附魔拦人同一条)
      //                  ② 怒气至少攒满一拍(rageMinRelease)
      // 第②条堵的是资源制最坏的漏洞:0 怒气也能放 ⇒ 每 20 帧白嫖一记 +speedMin 的球,
      // 不崩不报错、只会安静地变强。cd(20 帧)不是门槛、也别拿它当门槛 ——
      // resetPoint 每分把它清零,它只挡同一帧连点(与影分身同一条先例)。
      if (s.buffT > 0) return false;
      return (p.rage ?? 0) >= C.skills.rage.rageMinRelease;
    }

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
      // 引力吸球:回合进行中、球未被抓手、且不在牵引中。
      // 挥拍中同样放行(判据与理由只在 magnetSwingGated 那一份,别在这里再写一遍 swingT)。
      if (!ball || !ball.live || ball.held || ball.flying) return false;
      if (ball.magnetPull) return false;
      return !magnetSwingGated(p);
    }

    case "focus":
      // 时空减速: 回合进行中未在领域中
      if (!ball || !ball.live || ball.held || ball.flying) return false;
      return s.buffT <= 0;

    case "shadow": {
      // 影分身:三条闸 —— 模式合格、本分没召过、槽位没占满;外加球不在得分飞回动画里。
      // 刻意比别的技能宽:发球蓄力中(ball.held)也允许先召 —— "先布防再发球"是正当策略。
      // 满编判据用**占位数**而不是"活着的个数":正在播消散演出的那枚仍占着自己的槽位,
      // 若按"活的"算就会出现 canActivate 说能召、freeSlotOf 说没位置 ⇒ 按了没反应(静默吞掉)。
      if (!ShadowGate.on || !ShadowGate.canSummon(p)) return false;
      return !p.shadowCast && !!ball && !ball.flying;
    }

    default:
      return true;
  }
}

/**
 * 技能键「就绪但门槛未满足」的可读原因(冷却是另一态,走倒计时,不在这里报)。
 * 文案住在 config.skills.blockText —— UI 只显示,不自己猜判据。
 * 返回 null = 无需解释(完全就绪 / 还在冷却)。
 * 双槽(2026-10-06):slot 指定问哪一槽(缺省 1),game-root 每颗技能键各喂一份。
 */
export function skillBlockReason(p: Player, ball: Ball | null, slot: 1 | 2 = 1): string | null {
  const s = slotState(p, slot);
  if (!p || !s) return null;
  // 冷却中不报门槛(键面正在倒计时,那是另一种、更该先看见的理由)。
  // **但充能款例外**:它的键面从来不画倒计时(20 帧、0.33 秒,画不出也读不出),
  // 于是 cd>0 时若不落到下面的分支,就会出现"按下毫无反应、一个字都不说"——
  // 而这款真正该被读出来的状态永远是 armed(重击中)或怒气未聚二者之一。
  // 核过的可达性:按下即武装 buffT=240,而 cd 只有 20 帧,所以 cd>0 且 buffT<=0 只可能
  // 发生在"按下后 20 帧内就兑现了"(此时 rage 必为 0 ⇒ 报「怒气未聚」为真),不会撒谎。
  if (s.cd > 0 && !isChargeSkill(s.id)) return null;
  if (canActivate(p, ball as Ball, slot)) return null;
  const T = C.skills.blockText as Record<string, string>;
  switch (s.id) {
    case "lunge":
      // 真人空中也能跨(见 canActivate),不再有「落地再按」这一态;AI 不读 UI
      if (p.swingT >= 0) return T.swinging;
      if (p.lungeT >= 0) return T.lunging;
      return null;
    case "smash":
      return T.buffing;
    case "rage": {
      // 两态分明:"重击中"是等下一拍兑现(过一会儿自己就好),"怒气未聚"是这一分还没打够
      // (得先去接球) —— 让玩家知道该等帧数还是该改打法,别混成一句"不能用"。
      // 顺序照 canActivate:armed 优先,否则满怒按下去的那 240 帧会读成"怒气未聚"。
      if (s.buffT > 0) return T.rageArmed;
      return T.rageLow;
    }
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
      // 真人挥拍中已放行(magnetSwingGated),这一条今天只有 AI 会命中,而 AI 不看键面 ——
      // 留着是因为它是那条闸的**同一份判据**:总闸一旦关回旧行为,键面立刻跟着报「挥拍中」,
      // 不会变成"按了没反应、一个字都不说"。
      if (magnetSwingGated(p)) return T.swinging;
      return T.pulling;
    case "focus":
      return T.focusing;
    case "shadow": {
      // 四态,按"这条理由要占键面多久"排序(越耐久的越先说,玩家才知道该等帧数还是该换打法):
      //   此地不召 = 整个模式都不给召(训练场/教学/本地对战),等多少帧都没用
      //   分身满编 = 槽位占满了,得等谁接满三球散掉
      //   已召唤   = 本分召过了,下一分自己就好
      // 旧写法只有后两态,而且用 `p.shadowClone` 判在场 —— 多分身之后那个字段已经不存在了。
      if (!ShadowGate.on) return T.shadowNoMode;
      if (!ShadowGate.canSummon(p)) return T.shadowFull;
      if (p.shadowCast) return T.shadowUsed;
      return T.shadowActive;
    }
    default:
      return null;
  }
}

/**
 * 引力吸球的吸附点(拍前身位):activate 起手与 rules 牵引每帧都走这一个式子。
 * 跟随 p.y 而不是贴地 —— 空中释放时球吸到跳跃中的身前高点,回击才读作"凌空一拍";
 * y 轴向下为正,"p.y - 42" 即比脚底高 42px,地面释放被 min 钳在离地 60px 的低手位。
 */
export function magnetAimPoint(p: Player): { x: number; y: number } {
  return { x: p.x + p.facing * 34, y: Math.min(p.y - 42, CO.groundY - 60) };
}

/**
 * 触发技能激活, 返回是否成功。
 * 双槽(2026-10-06):slot 指定激活哪一槽(缺省 1 = AI 与全部旧调用方的旧口径),
 * 冷却与 buffT 记在**那一槽**的状态上;散装效果(lungeT/flash 系/focusT/rage/shadow 系)照旧写 Player 本体。
 */
export function activate(p: Player, ball: Ball, dir?: number, slot: 1 | 2 = 1): boolean {
  const s = slotState(p, slot);
  if (!p || !s) return false;
  if (!canActivate(p, ball, slot)) return false;

  const def = defOf(s.id);
  s.maxCd = def.cooldownFrames;
  // 冷却何时开跑:瞬发的四个技能按下即付;重击(真人)按下只上弦,真正扣出去那一拍才付
  // (判据与原因见 defersCooldownToConsume —— 两端共用,不许在这里再写一遍条件)。
  // 双槽口径:推迟与否按**这一槽**的技能判,槽里装着跨步就照常付,别被另一槽的重击连坐。
  s.cd = defersCooldownToConsume(p, s) ? 0 : def.cooldownFrames;

  switch (s.id) {
    case "lunge": {
      // 强力跨步: 原有跨步冲量强化, 开启 1 秒流风动画与暴击窗口
      // 空中按下 = 空中突进:冲量照给、重力不动,冲量期走 player 的 lunge 专用分支不受
      // 空中加速衰减影响,三件套(冲量/加力窗/待发窗)与地面释放同一套数值。
      // 2026-10-04 起这里多挂一个「自动回球待发窗」:跨过去之后由 player 的挥拍机器替玩家
      // 按那一拍(起手帧与时机环同一把尺子,见 player.ts 的 autoSwingDue)。
      // 两道消耗各管各的:自动那一拍出手**不**清 lungeAutoT(它是判定区尾段的开关,清了会把
      // 尾段从正在进行的挥拍里抽走),由帧数自己走完;加力窗 lungeShotT 则在命中时被 modifyShot
      // 清掉 —— 一次跨步只兑现一拍,与其余四技能同口径。
      const LG = C.lunge;
      p.lungeT = 0;
      p.lungeDir = dir ? dir : (Math.abs(p.vx) > 1 ? (p.vx > 0 ? 1 : -1) : p.facing);
      p.lungeShotT = LG.shotWindow; // 60 帧 = 1 秒
      // 待发窗**只给真人**:AI 也装 lunge、也会自己按这个键(ai.ts:487-501),给它开就等于
      // 给 CPU 白送一记"永远踩在最佳帧"的回球 —— 那不归技能管,归 diffs.* 那根旋钮管
      // (同 modifyShot 的 applyQuality 口径)。serve-check / ai-check 因此可证明不受影响。
      p.lungeAutoT = (!p.isAI && LG.autoReturn) ? LG.autoWindow : 0;
      p.sq = 0.85;
      p.vx += p.lungeDir * LG.speed;
      s.activeT = LG.duration;
      return true;
    }

    case "smash": {
      // 百分百重击: 开启烈焰聚能附魔, 球拍高亮
      // 2026-10-04 起这里多挂一个「代出一拍」待发窗:上弦之后由 player 的挥拍机器到点替玩家
      // 把那一记暴扣轰出去(择帧与跨步共用同一条 autoSwingDue,见 player.ts)。
      // 两道计时各管各的:buffT 是"这一拍必定暴扣"的兑现期(4 秒,手动按也照旧兑现);
      // smashAutoT 只覆盖"要不要替你按"这一段,走完就交还手动 —— 附魔没消失,消失的是代劳。
      // 窗长必须 ≤ buffDuration:超出去就会在附魔已经过期的帧上代出一记普通球,
      // 玩家读到的是"我按了重击,它给我回了个高远球"。
      const SM = C.skills.smash;
      s.buffT = SM.buffDuration;
      // 待发窗**只给真人**(同 lungeAutoT 的口径):AI 也会自己按这个键(ai.ts:502-506),
      // 给它开就等于白送一记"永远踩在最佳帧"的暴扣,而它的准头归 diffs 管。
      p.smashAutoT = (!p.isAI && SM.autoReturn) ? Math.min(SM.autoWindow, SM.buffDuration) : 0;
      p.smashGlow = 36;
      p.face = "fierce";
      p.faceT = 30;
      return true;
    }

    case "rage": {
      // 怒气重击:按下 = 把"当前攒下的这一坨怒气"挂成下一拍兑现的承诺。
      //
      // 与重击的**唯一**结构差别:重击的强度是固定的(附魔那一拍永远顶档暴扣),
      // 这里的强度按按下那一刻的怒气比例缩放 —— 所以怒气**在这里不清零**,
      // 清零在真正扣出去那一拍(modifyShot)。差别看着小,后果相反:
      // 在这儿清 = 玩家攒了一整局、按下去却回了一记空手球(反例 rageClearedAtPress)。
      //
      // armed 窗落进 s.buffT(与重击附魔同一个字段位、同一处递减:Skills.update),
      // 不另起计时器 —— 计时器多一处就多一处「两处各减一次」的风险(lungeShotT 真栽过)。
      const RG = C.skills.rage;
      s.buffT = RG.releaseWindow;
      // 代拍窗**只给真人**(与 lungeAutoT / smashAutoT 完全同一条口径):AI 也装 rage、
      // 也会自己按这个键(ai.ts),给它开就等于白送一记"永远踩在最佳帧"的暴扣,
      // 而它的准头归 diffs.* 那根旋钮管 —— serve-check / ai-check 的真人替身从不按技能键,
      // 那两把尺子量不到这条,只能在这里钉死。
      p.rageAutoT = (!p.isAI && RG.autoReturn) ? Math.min(RG.autoWindow, RG.releaseWindow) : 0;
      p.smashGlow = 30;          // 复用重击那记拍面高亮:读作"这一拍带着怒气",不新加一层视觉状态
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
      // 引力吸球: 展开引力力场, 羽毛球高速牵引至身前(吸附点只定初值,牵引期间
      // rules 每帧重算 magnetAimPoint 跟着人走 —— 跳跃中不吸到"按下时的旧位置")
      s.magnetPulling = true;
      const aim = magnetAimPoint(p);
      const total = C.skills.magnet.pullFrames;
      ball.magnetPull = {
        targetX: aim.x,
        targetY: aim.y,
        player: p,
        total,
        t: total,
        fromX: ball.x,
        fromY: ball.y,
      };
      // ---- 接管这一拍 ----
      // 玩家准备挥拍:空中释放直接起上手劈杀姿势(回击按引力跳杀兑现,见 modifyShot),
      // 落点瞄准压深场(与 config reboundDepth 的"强抽对方深场"同源);玩家滑轨仍可后续改。
      //
      // 2026-10-05 起这一拍可能是**打断正在进行的挥拍**拿过来的(canActivate 的挥拍闸已放开),
      // 所以这里必须补齐 Player.startSwing 那套记账 —— 漏一条就是"两拍抢同一条时间线",
      // 而且全都坏得悄无声息:
      //  · swingHit = false —— 被打断那拍没打出去,不许沿用上一拍的"已击球"真值。
      //    牵引到位那帧 rules 会当场把它置 true(rules.ts 的 magnetPull 收尾),
      //    所以收招既不会把它误记成挥空、也不会白吃一次瞄准消耗(consumeAutoAim)。
      //  · swingBest = null / swingQ = 0 —— 峰值追踪的账本重开。牵引 9 帧比命中窗 17 帧短,
      //    回击之后挥拍窗还开着;旧账本若留着,tryHit 会凭上一拍的记账再 settle 一次。
      //  · serveSwing = false —— 那是"起拍时球在手上"的粘性标记(startSwing 每次覆盖、无人清),
      //    留着就是发球后第一次吸球摆出发球托球姿势(render/sprites.ts 读 swinging && serveSwing)。
      //  · swingAuto = false —— 来路标记:吸球是玩家自己按下的技能拍,不许继承被接管那拍的"系统代打"。
      //  · swingLoft = 0 —— 与 startSwing 同口径:深浅/高低两轴都以起拍为界重新提交,滑轨当场还能改。
      const rad = Physics.reachRadius(ball);
      p.swingRadius = rad;                    // 半径现算:别让上一拍的够球半径决定这次的拍头位
      p.racketPrev = Physics.racketHead(p, 0, rad);   // 插值基准跟着跳,否则打断那帧拍头画出一条甩尾
      p.swingT = 0;
      p.swingHit = false;
      p.swingQ = 0;
      p.swingBest = null;
      p.serveSwing = false;
      p.swingAuto = false;
      p.swingStyle = p.onGround ? "under" : "over";
      p.swingAim = C.aimDepth.deep;
      p.swingLoft = 0;
      p.smashGlow = 20;
      return true;
    }

    case "focus": {
      // 时空减速: 开启子弹时间, 接球后强力反击并脱离领域
      s.buffT = C.skills.focus.duration;
      p.focusT = C.skills.focus.duration;
      p.focusHit = false;
      return true;
    }

    case "shadow": {
      // 影分身: 只做"本分已召唤"的记账与按键反馈,分身实体不在这里建 ——
      // create() 工厂在 player.ts,而 skills 不能反向 import player(依赖方向:types←config←skills←player)。
      // 真正的召唤在 player.update 的技能成功分支里调 spawnShadowClone(host) 完成;
      // **占几号槽位(= 颜色 + 防区 + AI 档)全在那一步算**,这里连数组都不碰。
      p.shadowCast = true; // 每分限召一次的闸:resetPoint 才放开(攒满三个要三分,限速靠的就是它)
      p.face = "happy";
      p.faceT = 36;
      return true;
    }
  }

  return false;
}

/** 每帧驱动技能状态机(双槽:两槽的 cd/buffT/activeT 各减各的,互不挤兑) */
export function update(p: Player, ball: Ball): void {
  if (!p || (!p.skill && !p.skill2)) return;

  // 冷却计时 / 增益状态计时 / 执行期计时:双槽遍历,同名计时器本来就是两份状态
  for (const s of [p.skill, p.skill2]) {
    if (!s) continue;
    if (s.cd > 0) s.cd--;
    // 增益状态计时
    if (s.buffT > 0) s.buffT--;
    // 执行期计时
    if (s.activeT >= 0) {
      s.activeT--;
      if (s.activeT < 0) s.activeT = -1;
    }
  }
  // 闪现折跃特效衰减
  if (p.flashT && p.flashT > 0) p.flashT--;
  if ((p.flashT ?? 0) <= 0) p.flashFrom = null;   // 残影画完就收掉起点,不留脏数据
  // 时空减速衰减与冷却触发
  const prevFocus = p.focusT ?? 0;
  if (p.focusT && p.focusT > 0) p.focusT--;
  // 时空领域效果刚刚自然结束(接球缓释到期或超时到期): 正式启动冷却倒计时。
  // 双槽:focusT 是全人唯一的领域时钟,到期冷却开在**装着 focus 的那一槽**。
  if (prevFocus > 0 && (p.focusT ?? 0) <= 0) {
    const fs = slotOfSkill(p, "focus");
    if (fs) {
      p.focusHit = false;
      if (fs.cd <= 0) {
        fs.cd = fs.maxCd > 0 ? fs.maxCd : defOf("focus").cooldownFrames;
      }
    }
  }

  // ---------- 闪现折跃状态机:悬空蓄力 → 起拍(保底窗口同步开) → 随挥落地 ----------
  // 起拍不在 activate() 里直接设,是因为那一下要和「时停」对上:主循环在折跃当帧定格若干帧
  // (世界时钟不前进,这里也不递减),放行后再悬空几帧举拍,球才真正被扣出去。
  // 递减不看 s.id:中途换装(Career.equipSkill 直接重建 skill 状态)会留下一个没人认领的
  // flashHoldT,而 rules 的"蓄力期把球按住"是看人物字段的 —— 让它一定排得空,球才不会定死。
  if ((p.flashHoldT ?? 0) > 0) {
    p.flashHoldT = (p.flashHoldT ?? 0) - 1;
    if (p.flashHoldT <= 0) {
      p.flashHoldT = 0;
      if (hasSkill(p, "flash")) {          // 双槽:flash 装在哪槽都行,起拍判据认"有没有装"(其余同旧口径)
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

  // 保持同步 lungeCd 字段兼容现有逻辑(双槽:lunge 装在哪槽就同步哪槽的 cd)
  const ls = slotOfSkill(p, "lunge");
  if (ls) {
    p.lungeCd = ls.cd;
  }

  // 动态评估就绪状态(双槽各评各的:两槽的门槛本来就不必同时成立)
  if (p.skill) p.skill.ready = canActivate(p, ball, 1);
  if (p.skill2) p.skill2.ready = canActivate(p, ball, 2);
}

/**
 * 击球修正钩子: 在 player.tryHit / buildShot 中注入技能加成
 *
 * **副作用契约**:本函数会消耗技能状态(附魔 / 必中窗 / 吸球回击 / 重击的冷却与待发窗 /
 * **怒气的整局存量**),因此只能挂在真正出手的那一次上。球种预告(player.previewKind)与实打共用同一条 buildShot
 * 通道,靠 opt.preview 区分:加成与质量改写照旧计算(徽标才不撒谎),
 * 下面几处「消耗」一律加 `!preview` 闸。漏一处就是"按了没反应"—— 判据 tools/smash-check.ts。
 * 怒气那一处漏了的后果更安静:预告每帧都在跑,存量会被无声抽干(rage-check ①)。
 *
 * **质量改写只给真人**(`applyQuality`):q/sweet/perfect 那三个回写会一路决定
 * 误差归零 + perfectBoost + perfect.powerDeg,等于把这一拍从"按得一般"抬成"顶档"。
 * 2026-10-03 修好读取顺序后它第一次真的生效,结果 AI 侧一并吃到 —— serve-check/ai-check
 * 实测真人得分率 easy 60%→46%、normal 39%→15%,相当于把技能 buff 当成难度补丁偷偷加给
 * 对手。AI 的准头归 diffs.* 那根旋钮管,技能不该覆盖它;forceSmash/speedBoost/powerDeg
 * 照旧两侧都吃(那本来就是旧代码里唯一真正生效的部分,行为与修前一致)。
 *
 * ---------- 双槽组合语义(2026-10-06 双技能槽,口径用户拍板:数值直接叠加) ----------
 *
 * 每个分支的判据从 `p.skill.id === X` 改成 `slotOfSkill(p, X)`(装在哪槽都认),
 * 于是两个技能的增益可以同拍全成立。成立时的合成规则:
 *   · speedBoost / powerDeg **直接相加**(重击+怒气同拍 = 4.0+4.8=8.8 —— 用户要的火力;
 *     平衡风险已知,真超了先削 RG/SM 数值,别改回"取最大",那会动单技能手感);
 *   · forceSmash 任一满足(布尔,天然可叠);
 *   · 品质改写(sweet/perfect/q)同向幂等,多分支重复写同一结果无害;
 *   · skillKind(飘字/音效)按分支顺序后者赢 —— 优先级 lunge < smash < flash < magnet < focus < rage,
 *     与单槽时代一致;
 *   · **消耗各源各自结清**:两个技能都兑现就都进冷却/都扣资源,不含糊。
 * 旧注释里「重击与怒气永不并存」的契约随双槽作废 —— 现在它们同拍就是相加,各自付账。
 */
export function modifyShot(p: Player, opt: HitOpt): {
  speedBoost: number;
  powerDeg: number;
  forceSmash: boolean;
  skillKind?: SkillId;
  /** 「怒气重击」兑现那一刻的怒气比例(0..1)。其余技能恒 undefined。
   *  只带比例、不带档位:档位由 rageTierOf 现推,两个数迟早分叉。
   *  为什么要把已经清零的量抄进结果:见 types.ts 的 ShotResult.rageRatio。 */
  rageRatio?: number;
  /** 闪现顶点天雷:接触点 ≥ C.skills.flash.apexHeight(飘字/升档演出读它)。
   *  威力部分的速度乘算不在这里 —— modifyShot 碰不到解算矢量,那一步在 buildShot。 */
  flashApex?: boolean;
} {
  const preview = !!opt.preview;   // 预告通道:只算不花
  const applyQuality = !!p && !p.isAI;   // 顶档改写只给真人:AI 的强度归 diffs 管
  let speedBoost = 0;
  let powerDeg = 0;
  let forceSmash = false;
  let skillKind: SkillId | undefined = undefined;
  let rageRatio: number | undefined = undefined;
  let flashApex: boolean | undefined = undefined;

  if (!p || (!p.skill && !p.skill2)) {
    return { speedBoost, powerDeg, forceSmash };
  }

  // 1. 强力跨步击球(命中即消耗)
  //    旧写法只读不写:一次跨步的 buff 能吃好几拍(窗口 0.5~1 秒内对手若很快回球就是白嫖第二记
  //    重击)。与其余四技能同口径「一次施放兑现一拍」。消耗必须挂 !preview 闸 ——
  //    球种预告与实打共用这条通道,漏一处就是"按了没反应"(2026-10-03 重击现场)。
  //    窗口(lungeShotT)是 Player 级的,与槽位无关 —— 双槽下它天然与另一槽的增益叠加。
  if (opt.lungeShot && p.lungeShotT > 0) {
    if (!preview) p.lungeShotT = 0;
    speedBoost += C.lunge.shotBoost;
    powerDeg += C.lunge.shotPowerDeg;
    skillKind = "lunge";
  }

  // 2. 百分百重击 (消耗附魔) —— 双槽:装在哪槽就消耗哪槽的附魔与冷却
  const sm = slotOfSkill(p, "smash");
  if (sm && sm.buffT > 0) {
    if (applyQuality) {
      opt.sweet = true;
      opt.perfect = true;
      opt.q = 1.0;
    }
    forceSmash = true;
    speedBoost += C.skills.smash.speedBoost;
    powerDeg += C.skills.smash.powerDeg;
    // 命中才算兑现:附魔清零 + 冷却在这一拍开跑(按下/挥空都不付,见 defersCooldownToConsume)。
    // 待发窗一并收掉 —— 附魔已经花掉了,再留一个"待发的自动拍"就是收招后凭空补第二下。
    // 预告通道一口都不能吃(下面整块挂在 !preview 闸里)—— 那是 2026-10-03 的真机现场。
    if (!preview) {
      sm.buffT = 0;
      p.smashAutoT = 0;
      if (defersCooldownToConsume(p, sm)) {
        // maxCd 是 activate 刚写的诚实值,也带着关卡的 cooldownMul —— 照它付,不另抄一份数字
        sm.cd = sm.maxCd > 0 ? sm.maxCd : defOf("smash").cooldownFrames;
      }
    }
    skillKind = "smash";
  }

  // 3. 闪现扣杀:只在保底接触窗口内兑现,命中即消耗
  //    (旧版拿 flashT 那 20 帧当 buff,漏球之后随手一拍还能白嫖一记必杀)
  if (hasSkill(p, "flash") && (p.flashStrikeT ?? 0) > 0) {
    if (applyQuality) {
      opt.sweet = true;
      opt.perfect = true;
      opt.q = Math.max(opt.q ?? 0, C.skills.flash.guaranteedQ);
    }
    forceSmash = true;
    // 这个窗还兼 tryHit 必中分支的门槛(player.ts),预告把它关掉就是把手到的一球变成挥空
    if (!preview) p.flashStrikeT = 0;
    speedBoost += C.skills.flash.speedBoost;
    powerDeg += C.skills.flash.powerDeg;
    skillKind = "flash";
    // 顶点天雷档:接触点 ≥ apexHeight(opt.contactH 由 buildShot 现算塞入)。
    // 纯读数不消耗 —— 预告通道同算,徽标才不撒谎;威力乘算在 buildShot 解出矢量之后。
    flashApex = (opt.contactH ?? 0) >= C.skills.flash.apexHeight;
  }

  // 4. 引力吸球回击
  //    空中收拍 = 引力跳杀:吸附点贴着 p.y 走,满跳球高 ~134px(92 跳高 + 42 吸附位)
  //    永远差 6px 够不到 jumpSmash.minHeight(140),所以这里不比高度 —— 跳起来释放
  //    就直接兑现扣杀,不许出现"跳了却没触发"的中间态。走 forceSmash(与 smash/flash
  //    同口径的技能强杀:loft ≤10 + kind="smash"),preview 同样返回,击球键徽标自动一致。
  const mg = slotOfSkill(p, "magnet");
  if (mg && mg.magnetPulling) {
    if (!p.onGround) forceSmash = true;
    if (!preview) mg.magnetPulling = false;   // 回击窗口只由真正那一拍关闭(否则回球加成被预告偷走)
    speedBoost += C.skills.magnet.speedBoost;
    powerDeg += 6;
    skillKind = "magnet";
  }

  // 5. 时空领域反击: 领域持续期内击球, 赋予顶档甜区品质、初速大幅加成与压弧下压。
  //    接完一个球过一会就可以结束: 真正击球(!preview)时将领域时间收缩至 postHitFrames (缓释收尾),
  //    出球破空特写后自然脱离领域并进入冷却。
  const fc = slotOfSkill(p, "focus");
  if (fc && ((p.focusT ?? 0) > 0 || fc.buffT > 0)) {
    if (applyQuality) {
      opt.sweet = true;
      opt.perfect = true;
      opt.q = Math.max(opt.q ?? 0, 0.98);
    }
    speedBoost += C.skills.focus.speedBoost;
    powerDeg += C.skills.focus.powerDeg;
    skillKind = "focus";

    if (!preview && !p.focusHit) {
      p.focusHit = true;
      const postHit = C.skills.focus.postHitFrames ?? 22;
      p.focusT = Math.min(p.focusT ?? postHit, postHit);
      fc.buffT = Math.min(fc.buffT, postHit);
    }
  }

  // 6. 怒气重击:armed 窗内的那一拍把这一管的怒气砸出去,强度按怒气比例分档。
  //
  //    与重击(#2)的分工:重击 = 固定顶档暴扣(有冷却),怒气重击 = 强度换档位
  //    (没有冷却,资源就是门槛)。单槽时代两者永不并存;双槽起(2026-10-06)同拍
  //    就是**数值直接相加**(见函数头组合语义),消耗各付各的 —— 怒气扣一管、重击进冷却。
  //
  //    **只有满怒那一档**才吃 forceSmash + 顶档质量改写(用户口径「怒气够一点就能放、
  //    攒得越足越狠」)。把 forceSmash 挪到 ratio>=1 之外 = 分档被抹平,这款立刻退化成
  //    一个更弱版本的 smash(反例 alwaysForceSmash,判据 rage-check ③)。
  //    顶档改写挂在 applyQuality = !p.isAI 上 —— 与 smash/flash/focus 同一条口径:
  //    q/sweet/perfect 那三个回写会一路决定误差归零 + perfectBoost + perfect.powerDeg,
  //    等于把"按得一般"抬成"顶档",AI 的准头归 diffs.* 管,不许在这儿白送。
  //
  //    怒气是**整局唯一的消耗点**,而且只在真扣出去那一拍扣(2026-10-05 多管蓄力:
  //    整管兑现只扣一管,余管保留 —— 用户口径「按一下消耗一个百分之百」):
  //    - 预告通道(preview)一口都不吃 —— 那是每个真实帧最多 10 次的通道,漏一处就是
  //      "攒了一整局、按下去怒气凭空蒸发"(判据 rage-check ①,与 smash-check 同一条病)。
  //    - 挥空 / armed 窗自己走完 / 跨分都不扣一分(资源制下罚它等于白罚:那一拍本就没兑现)。
  const rg = slotOfSkill(p, "rage");
  if (rg && rg.buffT > 0) {
    const RG = C.skills.rage;
    const ratio = rageRatioOf(p);                 // 读**清零之前**的怒气:这就是这一拍的强度
    speedBoost += RG.speedMin + (RG.speedMax - RG.speedMin) * ratio;
    powerDeg += RG.powerMin + (RG.powerMax - RG.powerMin) * ratio;
    rageRatio = ratio;
    if (ratio >= 1) {
      if (applyQuality) {
        opt.sweet = true;
        opt.perfect = true;
        opt.q = 1.0;
      }
      forceSmash = true;                          // buildShot 那边夹 loft≤10 并钉 kind="smash"
    }
    if (!preview) {
      // 整局唯一消耗点,两条路在这一个表达式里分流:
      // ratio >= 1 ⟺ 存量至少一整管(rageRatioOf 的 clamp 性质)⇒ 只扣一管,
      // 余管留到下一拍(250% 放完剩 150%);零头小释放(<一管)仍旧全放掉。
      const banked = p.rage ?? 0;
      p.rage = ratio >= 1 ? banked - RG.max : 0;
      p.rageAutoT = 0;                            // 代拍窗一并收掉,不留"收招后凭空补第二下"
      // armed 窗**必须一起关掉**(烟测抓到的一次施放吃掉多拍):留着它,下一拍仍然满足
      // `buffT > 0` 这条门,于是刚攒够一拍的怒气会被同一个承诺再兑现一次 —— 玩家看到的是
      // "按一次、连响两下"。与重击收 buffT 同口径:承诺兑现了就该收回。
      // 注意「手动优先」那条(player.ts 的手动分支)清的是代劳窗、**不清这里**,
      // 因为玩家自己挥的那一拍正是这个承诺要兑现的对象。
      rg.buffT = 0;
    }
    skillKind = "rage";
  }

  return { speedBoost, powerDeg, forceSmash, skillKind, rageRatio, flashApex };
}

export const Skills = {
  allSkills,
  defOf,
  initSkillState,
  resetPoint,
  // 双槽寻址三件套:所有"这款技能在不在/在哪槽"的判据都走这里,别再直读 p.skill.id
  slotState,
  slotOfSkill,
  hasSkill,
  canActivate,
  skillBlockReason,
  defersCooldownToConsume,
  activate,
  update,
  modifyShot,
  magnetAimPoint,
  // 怒气重击的五件套:判据只住这里,UI 与演出都读它们(散在各处比 id 会漏)。
  // ragePipesOf/ragePipeFillOf 是键面专用的"管"量纲(几段点亮/当前段填充),
  // 强度与档位仍然只走 rageRatioOf —— 两个量纲不许混用。
  isChargeSkill,
  rageRatioOf,
  ragePipesOf,
  ragePipeFillOf,
  rageTierOf,
  gainRage,
};
