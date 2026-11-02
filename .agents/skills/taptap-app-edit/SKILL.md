---
name: taptap-app-edit
version: 1.0.0
description: "TapTap 游戏资料维护、字段修改、素材规格、包体槽位选择、审核提交、撤审、发布、定时、草稿重置和版本历史 runbook。用户要完善资料、改字段、换主包体或 Windows 包体、提审、撤审、上线或查拒审原因时使用；不负责新游戏创建、包体库诊断或测试计划管理。"
metadata:
  requires:
    bins: ["taptap-cli"]
  cliHelp: "taptap-cli app --help;taptap-cli schema app precheck-app-review;taptap-cli schema app prepare-review-snapshot;taptap-cli schema app submit-app-review"
---

# app-edit

开始前先读 [`../taptap-cli/references/shared-execution.md`](../taptap-cli/references/shared-execution.md)。本 skill 修改资料草稿和版本状态，是 TapTap CLI 的高风险业务域。

**CRITICAL — 写入前必须 read-before-write：读取真实字段、可见性、必填项、版本状态和最新 `expected`，再构造变更。**

**CRITICAL — 审核、发布、撤审、撤定时、立即上线和重置草稿等高影响动作，必须先 dry-run 或等待用户明确确认。哪些请求不算提审意图，以 [shared execution](../taptap-cli/references/shared-execution.md)「提审意图门禁」的唯一词表为准；三步契约流程细节见 [audit and history](references/app-edit-audit-and-history.md)。**

**CRITICAL — 版本发布与分发状态独立。发布前读取 `platform-status`，只处理当次实际返回且可见的 `region_flag_*`，不能预设入口、状态或替用户切换。**

**每次资料、包体、审核或发布写操作完成后必须输出 handoff：当前阶段、已完成、未完成、用户现在是否需要操作、下一次检查时间、下一步命令/动作和实际返回的页面或试玩入口。审核中不得表述为已上线；定时上线不得表述为已发布。**

**成功提交审核或发布并完成状态读回后，按共享“运营阶段手册交接”读取内置官方描述并补充一个手册。提审前用 `list-app-versions --page-all` 读取完整发布历史：无发布历史且目标为首次正式上线才是 `first_launch`，已有 `online` / `offline` / `published` 证据的版本更新是 `long_term`；历史不完整时不得猜测，判定正本见 [运营阶段识别与官方手册](../taptap-cli/references/operation-handbooks.md)「识别顺序」。**

**CRITICAL — 资料提示和提审风险必须区分 `official_rule`、`current_fact`、`historical_review`、`test_evidence` 和 `agent_assessment`。只有两份 v4 官方文档明确写出的内容才能称为官方规范；审核原文不得反向补造成规则。填写或提审前按 [review risk checklist](references/review-risk-checklist.md) 输出可溯源结论。**

**创建后交接、每次资料或素材写入完成并写后读回、以及正式提审前，都必须主动提醒用户按规范完善游戏图标、简介、开发者的话、游戏截图、宣传图、实机视频及当前可见且适用的首页推荐素材选项。系统默认图标仅用于完成游戏创建，不代表已通过素材审核；如未替换为符合要求的正式图标，可能导致素材审核不通过并影响首页或编辑推荐展示。只在当前字段 `required`、服务端预检结果或适用的官方物料要求提供依据时，才将其列为提审 blocker。首页推荐和访问入口的影响必须分别引用官方栏目条件或当前 `platform-status` 证据，不得从素材缺失直接推导具体访问路径。**

**素材缺口和候选不得混写。输出资料体检或 handoff 时，按图标、简介、开发者的话、游戏截图、宣传图、实机视频和首页推荐逐项列出当前状态；本地候选按场景逐项列出，每个文件单独输出实际绝对路径。宿主能返回图片时逐张展示并保留路径，不能返回图片时明确说明并逐行输出路径。**

**包体写入事实门禁 —** `package_slots` 是唯一槽位写入事实。schema 未声明、槽位不可用、候选非 ready 或 `expected` 缺失时必须停止并报告契约缺口，不得从 `current_bindings`、候选或历史响应补造；`current_bindings` 只用于展示。完整契约见 [fields and packages](references/app-edit-fields-and-packages.md)「包体槽位」。包体管理页面入口不由 CLI 承诺。

## 快速决策

| 用户意图 | 首选命令 / 流程 | 必读 |
| --- | --- | --- |
| “还差什么 / 能不能提审” | 读取模块、包体、版本、资质和历史审核后生成分层风险清单 | [skill analysis](references/app-edit-analysis.md)、[review risk checklist](references/review-risk-checklist.md) |
| 查字段、选项、图片/视频规格 | `get-app-module --data '{"module_id":"<module_id>"}'`，附相关官方章节和检查状态 | [field map](references/app-edit-field-map.md)、[review risk checklist](references/review-risk-checklist.md) |
| 为 H5 开启 PC 分发（`platform-status`、`region_flag_pc`） | 读模块 → 保留全部现有平台并追加 `PC_OFFICIAL` → 写后立即重读 → 仅当 `region_flag_pc` 已实际返回且 `options` 含 `4` 时才按最新 `expected` 写入；H5 不得使用 `windows` 槽 | [audit and history](references/app-edit-audit-and-history.md)、[field map](references/app-edit-field-map.md) |
| 改文字、图片、视频等普通字段 | 读模块详情，带最新 `expected` 调 `save-changes` | [fields and packages](references/app-edit-fields-and-packages.md) |
| 切换或清空主包体 / Windows 包体 | `list-packages` → `select-package` / `clear-package` | [fields and packages](references/app-edit-fields-and-packages.md) |
| 按 Spark version_code 绑定资料页主包体 | `list-packages` → `+bind-spark-version` dry-run → 确认后 apply | [fields and packages](references/app-edit-fields-and-packages.md) |
| 提交审核并设置上线方式 | skill analysis → platform-status →（关卡/TapMaker 先签 SCE 协议）→ 三步提审，细则见 [audit and history](references/app-edit-audit-and-history.md) |
| 撤审、撤定时、改时间、重置草稿 | 先确认 version 状态，再预览和确认 | [version lifecycle](references/app-edit-version-lifecycle.md) |
| 定时已到但版本仍待上线 | 确认 `status="scheduled"` 且 `release_time <= now`，再确认后 `publish-scheduled-release` | [version lifecycle](references/app-edit-version-lifecycle.md) |
| 从文案文件提取字段、识别图片用途、规划新版资料 | Agent 生成候选，读当前值并确认后写入 | [skill analysis](references/app-edit-analysis.md) |
| 当前缺少图片素材 | 先询问是否有可用的本地素材；没有时再询问是否需要为允许生图的场景生成候选，并转 `taptap-asset-library` | [游戏物料要求](../taptap-cli/references/material-requirements.md)、[`taptap-asset-library`](../taptap-asset-library/SKILL.md) |
| 上传本地目录、zip 或多种图片/视频/包体 | 转 `taptap-materials`，上传后再回来写字段或绑定槽位 | [`taptap-materials`](../taptap-materials/SKILL.md) |
| 查上一版拒审原因或发版记录 | `list-app-versions` / `get-app-version` | [audit and history](references/app-edit-audit-and-history.md) |
| 包体库、线上包、自测二维码 | 转 `taptap-package-management` | [`taptap-package-management`](../taptap-package-management/SKILL.md) |
| 资质缺口和资质增量审核 | 转 `taptap-qualification` | [`taptap-qualification`](../taptap-qualification/SKILL.md) |

## 常用命令

```bash
taptap-cli app --help
taptap-cli app get-app-module --app-id <appId> --dev-id <developerId> --data '{"module_id":"<module_id>"}'
taptap-cli app list-app-versions --app-id <appId> --dev-id <developerId> --page 1 --page-size 20
taptap-cli app save-changes --app-id <appId> --dev-id <developerId> --data @changes.json --idempotency-key <save-key> --dry-run
taptap-cli app select-package --app-id <appId> --dev-id <developerId> --data @package-selection.json --idempotency-key <select-key> --dry-run
taptap-cli app +bind-spark-version --app-id <appId> --dev-id <developerId> --data @spark-binding.json --idempotency-key <intent-key> --dry-run
taptap-cli app prepare-review-snapshot --app-id <appId> --dev-id <developerId>
taptap-cli app precheck-app-review --app-id <appId> --dev-id <developerId> --data @review-precheck.json
taptap-cli app submit-app-review --app-id <appId> --dev-id <developerId> --data @audit-confirmation.json --idempotency-key <submit-key> --yes
taptap-cli app publish-scheduled-release --app-id <appId> --dev-id <developerId> --idempotency-key <publish-key> --dry-run
```

## 执行规则

完整细则（包体两条路径、资质事实收集、提审三步与预检口径、运营阶段手册、素材话术、生命周期）见 [execution rules](references/app-edit-execution-rules.md)。要点：

- 缺 `developerId` / `appId` 时转 `taptap-identity`；不知道字段所属模块先读 [field map](references/app-edit-field-map.md)。
- 编辑资料时先确认资质判断事实（`app_features`），再推导必须资质。
- 可选 iOS 覆盖字段 `title_ios` / `description_ios` / `icon_ios` / `banner_4_ios` / `square_promo_image_ios` / `screenshots_ios`：继承、清空与 `expected` 口径见 [field map](references/app-edit-field-map.md)。
- 包体写入依赖 `list-packages` 的同次 ready 候选与槽位 `available=true`，按原样 `expected` 走 dry-run → `--yes` → 写后读回；stale/409 停止重读，详见 [fields and packages](references/app-edit-fields-and-packages.md)「包体槽位」。
- 普通字段每批不超过 10 个 change；`expected` 严格取值与 stale 处理见 [fields and packages](references/app-edit-fields-and-packages.md)「文字字段」。
- `age_grade`、`apk_package_name`、`mini_game_play_enabled` 不能通过普通字段保存；替代路径见 [field map](references/app-edit-field-map.md)。
- 版本状态以 `get-app-version` 的 `logs[].event` 为准：`schedule_cancelled` 不是审核驳回。
- 发布成功后交接运营手册：用 `list-app-versions --page-all` 读完整历史，按共享「运营阶段手册交接」区分「首次上线」与「长线运营」，正本见 [operation handbooks](../taptap-cli/references/operation-handbooks.md)。
- 图片和视频以当次返回的 `image_spec` / `video_spec` 为准；`trailer` 与 `gameplay_demo_video` 不能使用同一个 `videoId`。
- 提审意图必须单独确认；只有用户明确表达“提交审核 / 提审”后才可调用 `prepare-review-snapshot`，预审结果后仍须再次确认才可 `submit-app-review`。三步契约见 [audit and history](references/app-edit-audit-and-history.md)。
- 预检 HTTP 200 / 顶层成功不等于内容预审通过；分别解释预审结果、阻断项和风险。预审不通过本身不禁止提审，展示问题后用户明确继续/「强制提交」即可进入提交，由服务端裁决。仅在本次 blockers 明确为空时说“阻塞项：无”；预审通过且无阻断时说明“提交状态：可提交审核”，预审未通过时同时说明内容风险。不得原样输出 `Blocker`、`preaudit_passed=true` 等机器字段；完整组合见 [audit and history](references/app-edit-audit-and-history.md)。
- 关卡 / TapTap 制造游戏在体检阶段就引导签 SCE 协议：用户明确同意后调 `taptap-cli app agree-sce-agreement --yes`，再重查确认 blocker 消失。
- 每次写入后输出 handoff；面向用户报告业务语言，不默认输出完整 raw JSON 或 schema。

## References

| Reference | 什么时候读 |
| --- | --- |
| [skill analysis](references/app-edit-analysis.md) | 资料体检、文案候选、图片分类和新版资料规划。 |
| [field map](references/app-edit-field-map.md) | 模块字段、可见性、联动、平台差异和详细包体模型。 |
| [fields and packages](references/app-edit-fields-and-packages.md) | 资料完整度、文案、图片视频和包体槽位写入。 |
| [version lifecycle](references/app-edit-version-lifecycle.md) | 审核、发布、撤审、定时、重置草稿前。 |
| [audit and history](references/app-edit-audit-and-history.md) | 提审、SCE 协议、生命周期细节、版本历史和整套推进。 |
| [review risk checklist](references/review-risk-checklist.md) | 字段提示、官方规则、历史拒审、测试证据和提审前风险清单。 |

## 不在本 skill 范围

- 新游戏创建转 `taptap-publish-game`；包体库和自测转 `taptap-package-management`；测试计划转 `taptap-test-plan`。
- 上架资质转 `taptap-qualification`；图片素材库和本地模型生图转 `taptap-asset-library`。厂商成员权限仍不在当前 CLI 范围。
