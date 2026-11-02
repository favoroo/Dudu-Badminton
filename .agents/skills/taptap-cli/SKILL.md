---
name: taptap-cli
version: 1.0.0
description: "TapTap CLI 共享执行规范与总入口。用于能力发现、身份与 scope 判断、命令选择、JSON 输出外壳、错误处理、不可逆写门禁和业务 skill 路由；不直接承接具体业务流程。"
metadata:
  requires:
    bins: ["taptap-cli"]
  cliHelp: "taptap-cli --help;taptap-cli schema;taptap-cli skills list"
---

# taptap-cli

TapTap CLI 总入口，同时承担 TapTap 业务 skill 的共享执行规范。任何开发者业务请求先判断业务域、身份、scope、命令路径和风险门禁，再切到对应 `taptap-*` skill。

**路由规则 — 具体业务必须先路由到业务 skill，不要在总入口裸调业务工具。**

**CRITICAL — 不可逆写和高影响写必须先 `--dry-run` 或拿到用户明确确认，再追加 `--yes`。**

**CRITICAL — `--yes` 不代表用户同意协议，也不代表用户已核对提审风险。遇到服务端要求额外确认时只展示响应实际返回的 `blockers` / `warnings`；协议签署走独立的 `agree-sce-agreement`（先展示协议名称与 URL，用户明确同意后 `--yes` 执行，再重查确认 blocker 消失）。不得补造本地 flag 或请求字段。**

**CRITICAL — Agent 登录必须使用 `auth login --no-wait --json` 返回的裸 JSON 契约，并用响应中的完整恢复参数继续轮询。不要只用 `device_code` 重建命令，也不要输出、记录或上报 access token。**

**登录链接交接 — 将 `verification_url` 按两行原样提供给用户：第一行仅写“请完成授权：”，第二行仅写 URL。不要使用 Markdown 链接语法，也不要重复展示 URL。随后立即执行 `taptap-cli auth login --device-code <device_code> --expires-at-unix <data.expires_at> --interval-seconds <data.interval>` 持续轮询，不要等待用户回复；只有运行环境无法保活轮询进程时，才请用户完成授权后通知你。登录成功后向用户只回复“登录成功”。**

## 快速决策

| 用户意图 | 进入 skill | 起手动作 |
| --- | --- | --- |
| 查询 CLI 能力、安装或读取 skills | `taptap-cli` | 服务命令用 `schema`，其他命令用 `--help`，skill 用 `skills list` |
| 登录、当前身份、找 developerId/appId | `taptap-identity` | 已有 ID 不重复查；否则查候选 |
| 创建、注册、申请或入驻厂商 | `taptap-identity` | 首轮直接提供当前环境的开发者中心入口；不先查厂商列表 |
| 创建新游戏、选择游戏类型或包体方向 | `taptap-publish-game` | 先收集并确认创建字段 |
| 改资料、素材、主包体、整版提审/撤审/发布 | `taptap-app-edit` | 先 read-before-write |
| 上传本地图片、视频或包体（单个文件或目录/zip 盘点） | `taptap-materials` | 先盘点和确认用途，再逐项上传和交接 |
| 查资质缺口、补资质材料、资质增量提审/撤回 | `taptap-qualification` | 先确认发布意图，再分析 |
| 检索、生成或收录游戏图片素材 | `taptap-asset-library` | 先本地素材后生图；上传执行转 `taptap-materials` |
| 查包体库、线上/待处理包、自测入口 | `taptap-package-management` | 先读 overview |
| 查下载、PV、转化、订单、评分统计等数据 | `taptap-dashboard-stats` | 先确认指标、维度和时间范围 |
| 查玩家评价正文、差评、官方回复 | `taptap-player-feedback` | 先确认时间范围和评分口径 |
| 查论坛帖子、子版块、帖子正文、一级回复和子回复 | `taptap-community-management` | 先确认帖子意图、子版块和时间范围 |
| 管理测试计划、资格批次、用户资格、激活码 | `taptap-test-plan` | 先区分状态层级 |

## 常用命令

```bash
taptap-cli auth login --no-wait --json
taptap-cli overview
taptap-cli skills list
taptap-cli skills read taptap-cli
taptap-cli skills read taptap-cli references/shared-execution.md
taptap-cli schema
taptap-cli app --help
taptap-cli player-feedback --help
taptap-cli community-management --help
taptap-cli schema <service> <method>
```

## 执行规则

- 判断请求是否属于 TapTap 开发者后台；不是就不要强行套 CLI。复杂流程和写操作先读 [shared execution](references/shared-execution.md)。
- 缺 `developerId` / `appId` 时转 `taptap-identity`；多候选让用户选择，不猜 ID，也不复用可能过期的历史 ID。交接命令显式带 `--dev-id` 和 `--app-id`。
- 参数不确定时先判断命令类型：服务命令使用 `schema <service> <method>` 查看输入输出；其他命令使用完整命令路径加 `--help`；再按业务主文件和领域 reference 查证，不猜字段或枚举。`config command inspect --argv-json` 只判断命令是否识别、来源、风险和策略，不提供参数说明或完整 contract。
- 优先使用已准入的 `taptap-cli <domain> <verb>`；当前能力缺失时说明 CLI 暂不支持，并给可执行替代路径。
- 需要用户转到网页继续时，遵循 [shared execution](references/shared-execution.md) 的人工页面交接规范：已知可靠入口必须首轮提供，URL 单独占一行且只展示一次；不要使用 Markdown 链接包装、追加追踪参数或猜测页面路径。
- 写操作先读取最新状态和 `expected`，再 dry-run 或展示影响；`confirmation_required` / exit code 10 是确认门禁，不是普通失败。
- `--dry-run` 只用于 write / create / delete 变更预览；`prepare-*` 如果 schema 标记为 `effect: read`，它本身就是只读预览，直接调用，不要追加 `--dry-run`。
- 标量字段优先使用 typed flags。typed 命令的 `--data` 是完整 tool input；raw API 的 `--params` 是 URL/query JSON，raw API 的 `--data` 是 request body JSON。
- `--data` / `--params` 都支持短 inline JSON、`-` stdin 和当前目录内的相对 `@file`；长 JSON 或多行 JSON 优先使用 `@file`。typed flag 与 `--data` 中的同名字段必须一致，否则 CLI 拒绝请求。
- 默认输出就是 JSON，普通命令、脚本、Skill 示例和生成命令都不要追加冗余的 `--format json`。只有命令自身默认输出文本或原始内容，而调用方明确需要结构化 JSON 时才显式追加。顶层成功看退出码或 `ok === true`；失败看 `error.type`、`error.subtype`、`error.message`、`error.hint`。业务工具自己的 `data.result.ok` 只表示业务结果，不是顶层 envelope。
- 面向用户回复时先给业务结论，再给风险和下一步；把字段 ID、camelCase key、数值状态和内部工具名翻译成可读标签。除非用户明确要求调试信息，不粘贴完整 raw JSON、schema 或底层请求。
- `auth status` 只在用户询问当前身份、登录失败或错误要求重登时运行，不作为每个任务的固定前置。唯一额外场景是人工页面交接需要区分当前构建环境且上下文中没有 `serverUrl`：此时只运行 `auth status --offline --json` 读取环境地址，不检查 Token 或访问网络。

## References

| Reference | 什么时候读 |
| --- | --- |
| [shared execution](references/shared-execution.md) | 复杂流程、写操作、确认门禁、错误处理和输出边界。 |
| [CLI command patterns](references/cli-command-patterns.md) | auth、命令树、上传或安装 skills 的具体命令。 |
| [business routing](references/business-routing.md) | 请求横跨多个业务域或路由不确定。 |
| [运营阶段识别与官方手册](references/operation-handbooks.md) | 提审、测试、首次上线或版本更新完成后的状态识别与运营手册交接。 |
| [游戏物料要求](references/material-requirements.md) | 回答图片、视频、Windows 素材规格或判断素材是否合规。 |
| [TapTap 上架规则目录 v4](references/official-review-rules-v4.md) | 资料填写提示、审核规则溯源，以及区分官方规则与历史审核。 |

## 不在本 skill 范围

- 具体业务流程由对应 `taptap-*` skill 承接。
- 未开放的服务端能力不在 skills 中承诺；服务命令能力以 `schema` 为准，其他命令以对应命令的 `--help` 为准，业务工作流以 `skills list` 为准。
