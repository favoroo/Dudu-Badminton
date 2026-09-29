# 嘟嘟羽毛球 · Cocos 版(dudu-cocos)

老仓库(`嘟嘟02`,零依赖 canvas 版)的 Cocos Creator + TypeScript 重构工程。
目标平台:微信小游戏 + Android。老仓库保留为**行为对照基准**,手感以它为准。

## 目录

```
assets/scripts/core/    逻辑层(纯 TS,零 Cocos 依赖,可在 node 里直接回归)
  types.ts              共享实体类型(Player/Ball/输入/事件/数据表)
  config.ts             ★ 全部平衡数值、键位、配色、AI 难度、皮肤、关卡表
  utils.ts              数学工具 + 存储封装(后端由宿主注入,node 走内存)
  physics.ts            羽毛球空气动力学 + 弹道反解 + 挥拍几何
  player.ts             移动/跳跃/挥拍状态机/命中判定
  ai.ts                 CPU 决策(重模拟球路 → 拦截点 → 时机挥拍)
  rules.ts              比赛状态机 + 计分 + 发球权(只发事件,不碰渲染)
  drill.ts              训练场:喂球机输入 + 达标判据 + 星级账本
  career.ts             生涯成长:赛后奖励/等级/皮肤购买装备
assets/scripts/input/   输入适配(Pad 意图合成 → 键盘 / 触屏虚拟按键两个源)
assets/scripts/render/  渲染层(world 视口与每帧重绘 / court 静态球场 / sprites 角色)
assets/scripts/game/    主循环胶水(game-root 固定步长组件 / sfx 音效映射)
assets/resources/audio/sfx/  烘焙音效(29 个 WAV,tools/bake-audio.ts 生成)
tools/                  node 回归(编译产物在 .tools-build/,已 gitignore)
  tsconfig.json         回归用编译配置(与 Cocos 编辑器无关)
  probe.ts              弹道矩阵 + 左右镜像对称校验
  drill-check.ts        训练场六关喂球自洽断言(--pick 搜参数 / --sweep 看趋势)
  sim-check.ts          AI 对 AI 完整一局 + 训练场喂球循环的整机冒烟
  pose-preview.ts       角色姿势 dump 成 SVG + 远臂几何断言(不启动 Cocos,见下)
  cc-stub.ts            pose-preview 用的运行时 cc 替身(记录型 Graphics)
  bake-audio.ts         音效离线烘焙(WebAudio 合成 → WAV)
```

## 回归(改物理/数值必跑)

```bash
npx tsc -p tools/tsconfig.json
node .tools-build/tools/probe.js         # 镜像对称必须全 ✓
node .tools-build/tools/drill-check.js   # 六关全部自洽(exit 0)
node .tools-build/tools/sim-check.js     # 整机自洽(exit 0)
```

## 改角色姿势必跑:姿势预览

角色是纯 `cc.Graphics` 折线/圆(零图片零骨骼),所以可以用记录型 Graphics 替身把
`drawPlayer` 直接 dump 成 SVG —— 不必启动编辑器,也不用跑 30s 构建(构建产物在内置
浏览器里会永久 hang,见 HANDOFF.md)。

```bash
npx tsc -p tools/tsconfig.json
node .tools-build/tools/pose-preview.js --out .tools-build/pose-preview
open .tools-build/pose-preview/index.html    # 15 个姿势 × 暗/亮两种球场底
```

exit 0 = 断言全绿。断言口径:远侧手臂的肘与手必须露在躯干背缘外(x ≤ -9.5)、
持续姿势的肘折角 ≥28°(过渡姿势伸直是真实手臂,不设地板)、两段恒等长、必须有手盘;
连续性用相对口径「远臂单帧跳变不超过持拍臂」—— blendIn 只有 3 帧,持拍臂本来就要甩
50~90°,绝对阈值怎么设都是错。

## 与老仓库的对应关系

- 模块一一对应:config/utils/physics/player/ai/rules/drill/career 逻辑原样移植,
  注释里「为什么」的设计动机全部保留,改之前先读。
- `DD` 全局命名空间 → 标准 ES Module;老仓库「禁止 ES Modules」是 file:// 的约束,此处天然解除。
- 分层铁律不变:rules 只发事件;render 只画不算;数值只进 config.ts。
- 有意的行为差异(仅两处):
  1. `rules.js` 曾直接调 `DD.FX.ballTrail` 画拖尾(表现层依赖泄漏),改为
     `setTrailHook()` 注入,game 层挂接。
  2. `config.js` 的 `serve` 定义过两次(前一段是死值),已合并成一段并保留全部字段。

## 三项产品决策(已定并部分落地)

1. **触屏方案 = 虚拟按键**:左下「左移/右移(双击跨步)」,右下「跳/深球/短球」,
   与键盘映射同一套 Pad 动作语义(`assets/scripts/input/`)。
2. **手机版先砍双人**:`CFG.mobileOnly` + `menuForPlatform()` 只暴露单人入口,
   2p/2v2 逻辑保留不删(`core/config.ts`)。
3. **音频离线烘焙**:`tools/bake-audio.ts` 把老 audio.js 的 WebAudio 合成数学
   (振荡器 + 指数包络 + RBJ 滤波)离线渲染成 29 个 WAV(共 712KB),
   产物在 `assets/resources/audio/sfx/`,播放映射在 `game/sfx.ts`。BGM 分层烘焙后置。

## 编辑器接入(阶段 2 的唯一手动步骤)

1. Creator 打开本工程后,双击打开一个场景(或新建 2D 场景,存为 `main`)。
2. 项目设置 → 项目数据:设计分辨率 **960×540**,适配高度。
3. 把 `GameRoot` 组件挂到 Canvas 节点上 → 预览即开一局「单人 · 普通」。

## 尚未移植(按阶段推进)

- 球场装饰(看台/灯光/主题皮肤,老 court.js 的 1272 行纯视觉部分)
- 完整 FX(镜头 punch/慢动作/粒子/彩带)、镜头冲击
- 菜单/暂停/结算/生涯/训练面板 UI
- BGM 烘焙(分层编曲 → 2~3 个强度档交叉淡入)
- 微信小游戏/安卓构建
