---
name: taptap-publish-game
version: 1.0.0
description: "TapTap 新游戏创建 runbook。用于收集厂商、游戏名、游戏类型、包体方向，生成创建预览，确认后创建草稿，并在创建后交接到资料编辑、测试计划或包体流程；不负责已有游戏资料维护。"
metadata:
  requires:
    bins: ["taptap-cli"]
  cliHelp: "taptap-cli app --help;taptap-cli schema app create-app"
---

# publish-game

开始前先读 [`../taptap-cli/references/shared-execution.md`](../taptap-cli/references/shared-execution.md)（身份、JSON 输出外壳、错误处理、确认门禁）。

publish-game 只负责“创建新游戏草稿”。创建成功后的资料字段、包体绑定、提审、测试计划都要交接给后续 skill。

**CRITICAL — 创建必须 plan-first。厂商角色（developer / author / publisher）、游戏名、游戏类型、包体方向和 developerId 都要有明确来源；缺字段先补齐，用户未明确确认前只能预览。**

**CRITICAL — 创建流程不得因为缺少图片或视频而自动生成 AI 素材。创建成功并列出缺失物料和动态规格后，先询问用户是否有可用的本地素材或真实游戏截图；用户确认没有本地素材后，再询问是否需要为图标、宣传图或 Windows 素材生成本地候选图。只有用户明确同意 AI 生成时，才能转 `taptap-asset-library` 处理允许生图的场景；不得生成虚构游戏截图或实机录屏。**

**素材 handoff — 创建后按图标、简介、开发者的话、截图、宣传图、视频和首页推荐逐项列出状态；本地候选每个文件单独输出实际绝对路径。宿主能返回图片时逐张展示并保留路径，不能返回图片时明确说明并逐行输出路径。**

**确认节奏 — 每轮只确认一个字段，并按宿主能力使用选择组件。**

**CRITICAL — 禁止从名称、题材词、版本词或“极速”等字样猜游戏类型、H5 或其他包体方向。创建后必须读取真实 `platform-status` 和包体能力，不得把不可用方式列成选项或声称可通过其它入口创建。`TOOL_NOT_IN_SCOPE` 表示当前 CLI 服务执行范围未开放创建工具，必须立即停止并报告当前不可用；不得提供、猜测或打开网页入口，也不得改用浏览器自动化。**

**内部模式展示 — `publishMode=quick|regular` 只在工具内部使用，不能面向用户展示。**

**首轮素材说明 — 用户首次询问新游戏创建流程或所需资料时，在当前唯一确认问题之外主动说明后续素材类别，并直接提供 TapTap 官方素材规范；官方入口为 `https://developer.taptap.cn/docs/store/release/publish/material/`，面向用户时按共享规范单独一行输出。规范来源、appId 前后处理和冲突口径统一按[游戏物料要求](../taptap-cli/references/material-requirements.md)执行。**

**创建后素材提醒 — 创建成功拿到 `appId` 后，必须在同一轮 handoff 主动提示用户按规范完善游戏图标、简介、开发者的话、游戏截图、宣传图、实机视频及当前页面可见且适用的首页推荐素材选项。系统默认图标仅用于完成游戏创建，不代表已通过素材审核；如未替换为符合要求的正式图标，可能导致素材审核不通过并影响首页或编辑推荐展示。是否构成提审 blocker 必须按当前字段 `required`、服务端预检结果或适用的官方物料要求判断，不得把整张清单无条件标为必填。**

## 快速决策

| 用户意图 / 缺失字段 | 处理 | 必读 |
| --- | --- | --- |
| 缺 `developerId` | 转 `taptap-identity` 查厂商候选 | [creation](references/publish-game-creation.md) |
| 缺游戏名 | 确认正式名称；若像玩法/版本描述，本轮只澄清该字段 | [creation](references/publish-game-creation.md) |
| 缺游戏类型 | 先问玩法，再给不超过 3 个候选和依据 | [creation](references/publish-game-creation.md) |
| 缺包体方向 | 始终在 APK / Tap 小游戏 / PC / H5 四项中确认，不因“休闲小游戏”等描述删减选项，也不从名称推断 | [creation](references/publish-game-creation.md) |
| “先看看 / 能不能创建” | 只检查字段并输出预览 | [creation](references/publish-game-creation.md) |
| 用户明确确认创建 | 用预览时相同的 `--data` 调 `app create-app --idempotency-key <key> --yes` | [creation](references/publish-game-creation.md) |
| 已有 appId，想补资料、素材或包体 | 转 `taptap-app-edit` | [`taptap-app-edit`](../taptap-app-edit/SKILL.md) |
| 查包体库、自测二维码或包状态 | 转 `taptap-package-management` | [`taptap-package-management`](../taptap-package-management/SKILL.md) |

## 常用命令

```bash
taptap-cli app --help
taptap-cli schema app create-app
taptap-cli app create-app --dev-id <developerId> \
  --data '{"title":"<title>","category":"<category>","developer_role":"<developer|author|publisher>","package_type":"<apk|mini_app|windows|h5>"}' \
  --idempotency-key <create-key> --dry-run
```

## 执行规则

- 按“厂商角色 → 游戏名称 → 游戏类型 → 包体方向”逐项收集；厂商角色在 developer / author / publisher 中确认用户与该厂商的关系，不从上下文默认。选择组件用法和完整字段判断读 [creation](references/publish-game-creation.md)。
- `developer_id` 用 `--dev-id`；其余创建字段统一放入 `--data`，使用当前 schema 的 snake_case 字段，且不要再包一层 `{"data": ...}`。复杂或多行 JSON 优先放入当前目录文件并传 `--data @request.json`。
- 只有游戏名、游戏类型和包体方向均有明确来源且已确认后，才输出创建预览；摘要简述来源或依据，不展示发布模式、icon 缺失或系统默认图标。
- 参数不确定时先 `schema app create-app`；用户明确确认后首个真实创建命令使用预览时完全相同的 `--data`，并同时传稳定的 `--idempotency-key` 和 `--yes`。不要先省略 `--yes` 触发 `confirmation_required` 再重复同一命令。
- 创建成功后给 appId、资料页入口和首批物料状态；此时才说明系统默认图标仅用于完成游戏创建，不代表已通过素材审核，并建议替换为符合要求的正式图标。
- 创建或上传成功后必须输出结构化 handoff：已完成、待完成、用户是否需要操作、下一步和实际可用入口；不能只说“创建成功”或“可以上线”。
- 创建成功拿到 appId 后，按[游戏物料要求](../taptap-cli/references/material-requirements.md)在同一轮报告当前字段、动态规格和缺失项，并主动提示用户完善游戏图标、简介、开发者的话、游戏截图、宣传图、实机视频及当前可见且适用的首页推荐素材选项；不要让用户再次追问尺寸。
- 如果当前缺失项包含图片素材，紧接着询问用户是否有可用的本地素材或真实游戏截图；用户确认没有后，再询问是否需要为图标、宣传图或 Windows 素材生成本地候选图，并转 `taptap-asset-library`。游戏截图只能使用真实游戏画面。
- 随后转 `taptap-app-edit` 读取实际可见的 `region_flag_*` 和动态 options；创建后推进由 CLI 固定提供三个推进方式（开预约 / 测试 / 正式上线），不依赖服务端返回的 `intent_options`，也不得按包体能力自行补造候选。
- 不要说“已经可以上线”。统一说明：已创建游戏草稿；发布版本不会自动改变分发入口状态。仍显示“敬请期待”的入口，如需开放下载或游玩，请在提审前先调整对应分发状态，随版本一起审核生效。
- 补资料、主包体和提审转 `taptap-app-edit`；包体库与自测转 `taptap-package-management`；CBT/OBT、资格批次和激活码转 `taptap-test-plan`。

## References

| Reference | 什么时候读 |
| --- | --- |
| [creation](references/publish-game-creation.md) | 完整字段收集、类型推荐、包体方向、素材和创建后推进细节。 |
| [游戏物料要求](../taptap-cli/references/material-requirements.md) | 首次说明素材类别，或创建后读取并判断精确规格。 |

## 不在本 skill 范围

- 创建后的资料预填、图片/视频/包体写入、提审、上线：转 `taptap-app-edit`。
- 测试计划、资格批次、激活码：转 `taptap-test-plan`。
- 包体库状态、自测二维码、小游戏/H5 状态：转 `taptap-package-management`。
