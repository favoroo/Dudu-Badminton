---
name: taptap-package-management
version: 1.0.0
description: "TapTap 包体管理诊断与自测入口。用于 APK、Windows、H5、小游戏、TapTap 制造的包体库、版本状态和测试二维码查询；不负责资料页主包体绑定、提审或发布。"
metadata:
  requires:
    bins: ["taptap-cli"]
  cliHelp: "taptap-cli package-management --help;taptap-cli schema package-management get-available-package-types;taptap-cli schema package-management list-apk-packages;taptap-cli schema package-management get-test-qr-code"
---

# package-management

开始前先读 [`../taptap-cli/references/shared-execution.md`](../taptap-cli/references/shared-execution.md)（身份、JSON 输出外壳、错误处理、确认门禁）。

本 skill 主要读取包体管理状态和自测入口；本地包体上传由 `taptap-materials` 执行，本 skill 不调用任何 upload shortcut。资料“选择/切换主包体”、提审、发布都归 `taptap-app-edit`。

**包体查询路径 — 没有单一 overview 接口。先调 `get-available-package-types` 拿到该应用支持的包体类型，再按类型调对应的 `list-*`；不得臆造类型，也不得假设某个类型一定可见。**

**自测二维码交付 — 必须渲染为 PNG 并以图片附件交付给用户；只输出 URL、只给文件路径或声称“已展示”都不算交付。协议细节与宿主差异见 [diagnostics](references/package-management-diagnostics.md)「处理自测意图」。**

## 快速决策

| 用户意图 | 首选命令 / 流程 |
| --- | --- |
| 看当前支持哪些包体类型 | `get-available-package-types` |
| 看某类型的包体列表 | 按类型调 `list-apk-packages` / `list-pc-packages` / `list-h5-packages` / `list-mini-app-packages` / `list-spark-versions` |
| 获取可玩入口 / 自测二维码 | 先从对应 `list-*` 取该版本的 `package_id`（TapTap 制造取 `version_code`），再传给 `get-test-qr-code` |
| 用户说“当前包体版本号 / 当前包体 / 包体版本” | Windows 看 `list-pc-packages` 的 `current_package_id`；其它类型列全部候选后让用户确认 |
| 明确说 APK / Windows / H5 / 小游戏 / TapTap 制造 | 直接查该类型的 `list-*` 并解释状态 |
| 上传单个 APK / PC / H5 / 小游戏包 | 转 `taptap-materials` 执行对应 upload shortcut |
| 上传目录、混合 zip 或多种本地物料 | 转 `taptap-materials` 盘点并逐项上传 |
| 创建或更新 TapTap 制造包 | CLI 不上传；提供 TapTap 制造官方入口 `https://maker.taptap.cn/`，面向用户时按共享规范单独一行输出；完成后回 CLI 查询并编辑资料 |
| 把某个包设为资料页主包体 | 转 `taptap-app-edit`；Spark 使用 `+bind-spark-version`，其它类型按槽位契约使用 `select-package` |

## 常用命令

```bash
taptap-cli package-management --help
taptap-cli package-management get-available-package-types --app-id <appId> --dev-id <developerId>
taptap-cli package-management list-apk-packages --app-id <appId> --dev-id <developerId> --data '{"page":1,"page_size":20}'
taptap-cli package-management list-pc-packages --app-id <appId> --dev-id <developerId> --data '{"page":1,"page_size":100}'
taptap-cli package-management list-h5-packages --app-id <appId> --dev-id <developerId> --data '{"page":1,"page_size":10}'
taptap-cli package-management list-mini-app-packages --app-id <appId> --dev-id <developerId> --data '{"page":1,"page_size":100}'
taptap-cli package-management list-spark-versions --app-id <appId> --dev-id <developerId> --data '{"page":1,"page_size":10}'
taptap-cli package-management get-test-qr-code --app-id <appId> --dev-id <developerId> --data '{"package_id":<packageId>}'
taptap-cli package-management get-test-qr-code --app-id <appId> --dev-id <developerId> --data '{"version_code":"<sparkVersionCode>"}'
# 渲染自测二维码 PNG 供用户扫码（顶层 shortcut，--data 同样是扁平目标）
taptap-cli test-qr-code --app-id <appId> --dev-id <developerId> --data '{"package_id":<packageId>}' --output test-qr.png --json
taptap-cli schema package-management get-available-package-types
taptap-cli schema package-management get-test-qr-code
```

## 包体类型矩阵

| 类型 | 列表命令 | 本 skill 能做 | 不能做 / 转交 |
| --- | --- | --- | --- |
| APK | `list-apk-packages` | 查包体库、版本、包名、大小、配置状态 | 资料页主包体、提审、上线 |
| Windows | `list-pc-packages` | 查 PC 包状态、当前默认包体、分支（0=默认包体/1=游戏本体/2=启动器） | Windows 包体绑定、资料字段、发布动作 |
| H5 | `list-h5-packages` | 查 H5 版本、屏幕方向、是否发布中 | H5 主包体绑定、审核发布 |
| 小游戏 | `list-mini-app-packages` | 查开发/审核/线上版本、包体大小与时间 | 分包测试（见下方能力开通分支） |
| TapTap 制造 | `list-spark-versions` | 查地图版本、大小、是否为当前线上 | 创建/更新包体 -> TapTap 制造（官方入口 `https://maker.taptap.cn/`） |

上表除 TapTap 制造（Maker）一处外，其余“不能做”事项——各类型的资料页主包体绑定、资料字段、提审、发布——一律转 `taptap-app-edit`。

## 执行规则

- 先调 `get-available-package-types` 拿 `available_package_types`；只用其中实际返回的类型，不要补充不可见类型。
- 用户泛说“我要自测”时，先列出实际可用类型让用户选，不要把“自测”直接等同为“自测二维码”。
- **自测二维码**：从对应 `list-*` 里确定目标版本后，把它的 `package_id` 传给 `get-test-qr-code`（TapTap 制造传 `version_code`）。`package_id` 和 `version_code` 互斥，只能传其中一个。TapTap 制造只有当前线上之外的候选也能取二维码；接口返回目标不可用时按工具结果提示用户重新选择版本。
- **APK / Windows 没有二维码接口**：`get-test-qr-code` 只服务小游戏、H5 和 TapTap 制造。APK / Windows 想自测时，只说明包体列表状态，并引导用户在开发者中心对应包体页面发起自测；不要调用二维码 operation。
- **APK 的场景状态不在 CLI 契约内**：云玩 / TapPlay / 云微端 / 模拟器各场景的可用性、授权状态、当前包体、审核状态和不可用原因都不由任何 `package-management` 接口返回。用户问到时，只说明 CLI 只能列出包体本体（`list-apk-packages`），场景维度请到开发者中心包体管理页面查看；不要从包体列表推断场景可用性。
- **Windows 分支**：合法值与应用的包体模型绑定，判据是 `pc_package_branch` 白名单。命中白名单 → 分支模型，`branch=1` 游戏本体包、`branch=2` 启动器包（两个角色同时必填）；未命中 → legacy 模型，`branch=0` 是唯一槽位（默认包体），**不存在启动器包**。判据的接口信号是 `get-app-module --data '{"module_id":"other-settings"}'`：返回 `pc_game_package_whatsnew`/`pc_launcher_package_whatsnew` 即分支模型，只返回 `pc_whatsnew` 即 legacy。`upload-pc-package` 不传 `--windows-branch` 时会按这个信号自动判定（分支→1、legacy→0），判定失败会要求显式传 0/1/2。`current_package_id` 是当前默认包体，为 0 表示没有默认包体。
- 小游戏能力未开通时，`list-mini-app-packages` 会返回失败或不包含 `mini_app` 类型。用户明确要求开通时，展示影响并等待确认后才调用 `get-or-create-mini-app`，成功后重调 `get-available-package-types` 验证。
- H5 查询失败时不要调用小游戏开通工具；H5 和小游戏是不同能力。
- TapTap 制造包体全部由 Maker 传入；CLI 不提供 Spark 包体上传或更新能力。用户要创建、构建或更新 Maker 包体时，必须引导到 `https://maker.taptap.cn/`，完成后再用 CLI 查询已有版本或继续资料编辑。
- 历史 `mini-app-upload` 任务先用 `task +list|get` 诊断；用户明确要求恢复时可执行 `task +resume`。

## 输出规则

- 可以说明版本、文件名/包名、大小、更新时间、屏幕方向、阶段（`stage`）和各类型状态字段，以及二维码。
- 这些 `list-*` 都声明了分页（OpenAPI 名 `x-pagination`，catalog 里序列化为 `pagination`），且 catalog 声明的 `page_size` 默认值统一是 **20**。可用 `--page` / `--page-size`，翻全量用 `--page-all`（配 `--page-limit` / `--page-delay`）；也可以把 `page` / `page_size` 写进 `--data`。开发者中心各页面自己的分页条数（APK 20、Windows/小游戏 100、H5/TapTap 制造 10）是页面行为，**不是** API 默认值，不要当成默认值转述。
- TapTap 制造的发布状态字段不准确，暂不向用户展示；只说明版本、更新时间、大小和下一步。
- raw ID 只在用户明确要排查 ID 或接口数据时展示。
- 向用户解释列表时优先说版本名、包名/文件名、更新时间和状态标签，不要堆砌字段。
- 不承诺已经提交审核、发布或切换主包体。

## References

| Reference | 什么时候读 |
| --- | --- |
| [package management diagnostics](references/package-management-diagnostics.md) | 解释复杂包体状态、自测二维码、小游戏/H5/TapTap 制造分支。 |

## 不在本 skill 范围

- 绑定/切换资料页主包体、提审、发布：转 `taptap-app-edit`。
- 创建游戏：转 `taptap-publish-game`。
- 测试计划资格/激活码：转 `taptap-test-plan`。
- 本地包体上传（含单个确定包体）：转 `taptap-materials`。
