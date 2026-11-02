---
name: taptap-materials
version: 1.0.0
description: "TapTap 本地游戏物料盘点与上传编排。用于图片、视频、APK、Windows、H5、Tap 小游戏的目录或压缩包盘点、可支持物料的逐项上传、失败续跑和资料/包体交接；不直接写资料字段、绑定包体或提交审核。"
metadata:
  requires:
    bins: ["taptap-cli"]
  cliHelp: "taptap-cli materials +inspect --help;taptap-cli upload --help;taptap-cli upload-video --help;taptap-cli upload-apk --help;taptap-cli upload-pc-package --help;taptap-cli upload-h5-package --help;taptap-cli upload-mini-app-package --help"
---

# taptap-materials

开始前先读 [`../taptap-cli/references/shared-execution.md`](../taptap-cli/references/shared-execution.md)。本 skill 负责让本地物料取得可继续处理的远端句柄，是六个 upload shortcut（图片、视频、APK、Windows、H5、Tap 小游戏）的唯一执行入口；其他业务 skill 需要上传本地物料时转交到这里，不自行执行上传命令。它不拥有资料字段写入、资料页包体槽位绑定、提审或发布。

**CRITICAL — 不得在 Skill 中处理 OSS、Qiniu、upload_token，也不得自行轮询或恢复上传任务；云存储凭证和上传状态机只由 CLI workflow 负责。**

**CRITICAL — 上传成功不等于资料字段已写入，也不等于资料页包体已绑定；不得把上传结果表述为已完成字段写入、槽位绑定或可提审。**

## 当前 CLI 边界

目标命令是只读的 `taptap-cli materials +inspect <directory|archive>`：它安全盘点目录或 zip，输出每个文件的路径、识别类型、未知项和需要后续确认的歧义，不上传、不写资料、不绑定包体。

当前实现的 inspect 输出位于成功 envelope 的 `data` 下，不是 `data.result`：

```text
input:  one safe local <directory|archive>; read-only; default JSON output
output: ok=true, data.stage="materials-inspect",
        data.input, data.materials[], data.summary,
        optional data.skipped[], data.handoff.required, data.handoff.nextSteps[]
```

目录或直接文件中的可上传 `materials[]` 至少包含 `path`、`name`、`kind` 和 `reason`。压缩包内条目使用 `fromArchive`、`name`、`kind`、`reason` 和 `needsExtraction=true`，不会伪装成可直接上传的本地路径。包体使用 `kind="package"`，再由 `packageType="apk|pc|h5|tap|unknown"` 区分；`pc` 对外 handoff 为 Windows，`tap` 对外 handoff 为 Tap 小游戏。

## 快速决策

| 物料 | 当前可执行 shortcut | 上传后交接 |
| --- | --- | --- |
| 本地图片 | `upload <image>` | `taptap-app-edit` 决定字段用途，并按 `{"url", "info"}` 写入 |
| 本地视频 | `upload-video <video> --scene <trailer 或 gameplay_demo_video>` | `taptap-app-edit` 用返回的 `videoId` 写入 |
| APK | `upload-apk <apk>` | `taptap-package-management` 查状态；绑定见「交接」 |
| Windows 包 | `upload-pc-package <package> --launch-exe <relative-exe> --version <version> [--windows-branch 0/1/2]` | `taptap-package-management` 查状态；绑定见「交接」。**包体类别以接口返回为准**：没有 PC 包体分支能力的应用只有默认包体（`branch=0`），有分支能力时才有游戏本体包(1)/启动器包(2)；不传 `--windows-branch` 时 CLI 读 `get-app-module` 自动判定，判定失败会要求显式传 0/1/2。不要主动问用户要不要启动器包 |
| H5 zip | `upload-h5-package <package> [--screen-orientation 0/1]` | `taptap-package-management` 查状态；绑定见「交接」 |
| Tap 小游戏 zip | `upload-mini-app-package <package>` | `taptap-package-management` 用 `list-mini-app-packages` 查状态；绑定见「交接」 |
| 文案、表格或其他非上传文件 | Agent 直接读取并转 `taptap-app-edit` | 不走上传 shortcut |

TapTap 制造 / Spark 包不属于这六种上传能力，转 TapTap 制造；官方入口为 `https://maker.taptap.cn/`，面向用户时按共享规范单独一行输出。已有 ready Spark 版本转 `taptap-app-edit`，按实时候选和主槽位 expected 使用 `+bind-spark-version` 绑定。

## 执行规则

1. 对图片、视频、APK、Windows、H5、Tap 小游戏，显式缺 `developerId` / `appId` 且当前 profile 也没有可用 saved scope 时，先转 `taptap-identity`；六个 upload shortcut 都是 app-scope 写操作。
2. 用 `materials +inspect` 的 manifest 或用户明确提供的单文件路径建立计划。目录或 zip 中的未知项、歧义项、多个视频和 Windows branch 先让用户确认。
3. 对图片、视频、APK、Windows、H5、Tap 小游戏 文件先执行同一条 shortcut 的 `--dry-run`。用户确认后，以同一文件、scope 和业务意图执行 `--yes`，两次调用复用同一个 `--idempotency-key`。六个 shortcut 都接受该 flag（省略时由 CLI 自动派生），但图片上传必须显式提供稳定 key。
4. 图片、视频、APK、Windows、H5、Tap 小游戏 只调用本 skill 的六个端到端 upload shortcut，不直接调用动态 OpenAPI 的 upload/complete/submit operation。单文件 shortcut 的输入是位置参数 `<file>`、`--app-id`、`--dev-id` 和各自 flag；**不要传 `--data`，不要手写 `file_name`、`file_size`、`sha256`、`upload_token` 或 complete request body。** `file_size` 是字节大小，H5 的 `screen_orientation` 也是协议字段；这些字段由 Go workflow 按当前 schema 生成和校验。`<file>` 解析后必须落在当前工作目录内（相对路径或目录内绝对路径均可），目录外路径会被拒绝，此时先 `cd` 到素材所在目录再传相对路径。
5. 默认输出为 JSON；仅接受 `--format json` 或 `--format pretty`，普通 Agent 调用省略默认的 `--format json`。成功以顶层 `ok=true` 或 exit code `0` 判断；缺少 `--yes` 的确认门禁是 exit code `10`；其它非零退出码按 JSON error 停止和恢复，不把业务内字段当作进程成功。
6. 单项部分失败时保留已返回的远端句柄，按文件记录结果。只重试没有远端句柄的失败项，不能整批重跑。H5 和 Tap 小游戏 可用 `taptap-cli task +list|get|resume` 恢复已有任务；其下一步是否可执行完全由当前 Catalog 的 `enabled` / `disabled_reason` 决定。不得在 Skill 中重构 upload token。
7. 完成上传后，按“上传结果 -> 当前远端状态 -> 用户确认 -> 后续处理”的顺序交接；交接去向统一以「快速决策」表和「交接」一节为准，不在正文其他位置重复声明。不得在本 skill 自动执行 `save-changes`、`select-package`、`clear-package`、审核或发布。

## 端到端命令与结果句柄

```bash
# 图片：必须有稳定 idempotency key；成功使用 url 和完整 info。
taptap-cli upload ./icon.png \
  --app-id <appId> --dev-id <developerId> \
  --idempotency-key <image-intent-key> --dry-run

# 视频：scene 只决定资料回填目标，真实上传前会读取该字段的 video_spec。
taptap-cli upload-video <path> \
  --scene trailer --app-id <appId> --dev-id <developerId> --dry-run

# 包体：预览后用相同输入加 --yes。
taptap-cli upload-apk ./game.apk --app-id <appId> --dev-id <developerId> --dry-run
taptap-cli upload-pc-package ./game.zip --app-id <appId> --dev-id <developerId> \
  --windows-branch 1 --launch-exe game.exe --version 1.0.0 --dry-run
taptap-cli upload-h5-package <h5_zip> --app-id <appId> --dev-id <developerId> \
  --screen-orientation 0 --dry-run
taptap-cli upload-mini-app-package <mini_app_zip> --app-id <appId> --dev-id <developerId> --dry-run
```

H5 ZIP 上传前必须满足以下目录结构，根目录必须且只能有一个游戏文件夹：

```text
game.zip
└── game/
    ├── index.html
    ├── main.js
    └── assets/
```

`index.html` 必须位于这个游戏文件夹的第一层。以下结构必须在上传前修正：`index.html` 或其它游戏文件直接位于 ZIP 根目录；根目录包含多个游戏文件夹；根目录同时包含游戏文件夹和其它文件；入口文件被放在更深层目录。先执行 `--dry-run`，确认 `data.archive_preflight` 通过（`violations` 为空、`top_level_entries` 只有一个游戏文件夹）后，再使用相同文件和参数加 `--yes` 上传；预检失败不会创建远端上传任务，修正目录后重新打包并重新预览。`__MACOSX`、`.DS_Store` 和 `._*` 属于可忽略的 macOS 元数据；其它隐藏文件会作为 warning 展示，仍需确认是否应随包分发。

成功 JSON 的稳定业务句柄按 shortcut 区分：

| Shortcut | 成功后保留的字段 | 不应推断 |
| --- | --- | --- |
| `upload` | `data.url`、`data.info.width`、`data.info.height`、`data.info.size`、`data.info.format`、`data.assetId` | asset ID 只表示素材库收录结果，不表示图片已写入资料字段 |
| `upload-video` | `data.videoId`、`data.validationWarnings` | 上传完成；转码和资料字段写入仍是后续状态，不依赖未由当前 workflow 填充的 `videoUrl` / `transcoding` |
| `upload-apk` | `data.apkId` | 资料页主包体已切换 |
| `upload-pc-package` | `data.packageId`，以及存在时的绑定预览字段 | Windows 槽位已绑定 |
| `upload-h5-package` | `data.h5VersionId`、`data.h5PackageId` | H5 主包体已绑定或已审核 |
| `upload-mini-app-package` | `data.miniAppArtifactId`、`data.taskId` | 上传任务已创建；包体记录与提交状态以 `taptap-package-management` 的查询结果为准 |

`--dry-run` 的 JSON 是预览，不包含上述远端句柄。图片、APK、PC、H5、小游戏预览不发网络请求；视频预览会读取目标字段的实时 `video_spec`，但不会上传文件。

## 交接

- 图片：转 [`taptap-app-edit`](../taptap-app-edit/SKILL.md)，读取目标模块和最新 `expected`，展示用途候选，用户确认后才 `save-changes`。交接时必须同时给到 `upload` 返回的 `data.url` 与 `data.info`——图片字段的值是 `{"url": ..., "info": ...}` 对象；不带 info 虽然不会报错，但 C 端拿不到宽高，竖版图会被按 16:9 裁切。
- 视频：转 [`taptap-app-edit`](../taptap-app-edit/SKILL.md)，用 `upload-video` 返回的 `videoId` 写入（视频字段不需要 info）。
- APK、Windows、H5、Tap 小游戏：先转 [`taptap-package-management`](../taptap-package-management/SKILL.md) 查询远端包体状态；小游戏自测二维码只适用于 `stage=dev` 的版本，可同时查 `get-available-package-types` 确认该应用是否已支持小游戏。需要资料页绑定时转 `taptap-app-edit`，由其按包体槽位契约重新读取并经用户确认后执行。
- 任何上传完成后都不能直接进入提审；资料、包体、资质和分发状态仍按各业务 skill 的当前读取结果判断。

## 不在本 skill 范围

- 资料字段写入、包体槽位绑定、提审、上线：转 `taptap-app-edit`。
- 包体管理页诊断、自测二维码和小游戏能力开通：转 `taptap-package-management`。
- 图片素材库检索（找参考图）：转 `taptap-asset-library`；已有 HTTPS 图片先由客户端下载到本地，再按本 skill 的 `upload` 收录。
- CLI 上传协议、任务状态机、云存储凭证和目录/zip 安全扫描的实现：属于 Go CLI，不在 Skill 脚本中实现。
