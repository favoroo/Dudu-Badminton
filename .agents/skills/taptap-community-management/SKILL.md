---
name: taptap-community-management
version: 1.0.0
description: "TapTap 社区论坛管理只读查询 runbook。按帖子意图、子版块和排序分页检索当前 App 论坛的帖子，读取帖子详情（正文与图片）、一级回复和子回复，并解释深分页上限、置顶回复与统计口径；不负责玩家评价（转 taptap-player-feedback）、经营数据（转 taptap-dashboard-stats），也不做发帖、回帖和内容处置。"
metadata:
  requires:
    bins: ["taptap-cli"]
  cliHelp: "taptap-cli community-management --help;taptap-cli schema community-management list-community-moments"
---

# community-management

开始前先读 [`../taptap-cli/references/shared-execution.md`](../taptap-cli/references/shared-execution.md)（身份、JSON 输出外壳、错误处理）。

本 skill 只读，回答「这个 App 的论坛里有哪些帖子、帖子写了什么、大家怎么回复」，不做发帖、回帖或内容处置。先按下表选场景，再读对应 reference 取命令、参数和字段细节。

## 快速决策

| 用户意图 | Reference | 起手命令 |
| --- | --- | --- |
| 看帖子列表、排序，或按子版块 / 求助反馈筛选 | [read-moments](references/read-moments.md) | `list-community-moments` |
| 看帖子正文和图片 | [read-moments](references/read-moments.md) | `get-community-moment` |
| 查有哪些子版块 / 取 `group_label_id` | [read-moments](references/read-moments.md) | `list-community-group-labels` |
| 看帖子的一级回复 | [read-replies](references/read-replies.md) | `list-community-moment-replies` |
| 看某条回复下的子回复 | [read-replies](references/read-replies.md) | `list-community-moment-child-replies` |
| 统计回复数，或解释置顶回复、`stat` / `total` 口径 | [read-replies](references/read-replies.md) | — |
| 要玩家评价或经营数据（评分、下载、曝光等） | 转 `taptap-player-feedback` / `taptap-dashboard-stats` | — |
| 要发帖、回帖、置顶、加精、删除或处理内容 | CLI 不支持写；说明只能查看，不要承诺已处置 | — |

## 执行规则

**CRITICAL — 分页别贪全：只有 `list-community-moments` / `list-community-moment-replies` / `list-community-moment-child-replies` 支持分页（`page_size` 1–100、默认 20），`page × page_size` 必须 ≤ 10000，越界会直接失败；`get-community-moment` / `list-community-group-labels` 不分页。由于数据量和性能原因，不推荐用 `--page-all` 取全量——逐页串行请求、页数越多越慢，翻得越深成本越高。需要更多数据时优先用 `group_label_id`、`moment_intent`、`order` 缩小范围或排序。**

**CRITICAL — `moment_id` / `parent_reply_id` 是位数很长的十进制整数 ID，必须当作字符串原样回传：不要转成数字（会丢精度），也不要补零或重新拼接。**

**CRITICAL — `list-community-moment-replies` 只返回直接回复帖子的那一层；某条回复下的回复要用 `list-community-moment-child-replies` 传 `parent_reply_id`，父回复可以是任意层级。**

- 本域只有只读能力，权限与论坛管理相关；缺权限时按共享错误约定解释，不要改用其它接口绕过。
- 缺 `developerId` / `appId` 时转 `taptap-identity`。
- `--data` 只写 reference 列出的字段；`app_id` / `developer_id` 用 `--app-id` / `--dev-id`，不要重复写进 `--data`。
- 泛问「社区」时先确认三件事：只看某类帖（求助 / 反馈）、要不要某个子版块、要列表还是要正文和回复。
- 本 skill 不做任何写操作，也不要调用其它业务域的写接口代表用户处置社区内容。

## References

| Reference | 什么时候读 |
| --- | --- |
| [read moments](references/read-moments.md) | 读帖子：列表与排序、子版块、意图筛选、正文与图片字段。 |
| [read replies](references/read-replies.md) | 读回复：一级回复、子回复、置顶回复，以及 `stat` / `total` 口径。 |

## 不在本 skill 范围

- 玩家评价（评分、评价正文、评价回复）：转 `taptap-player-feedback`。
- 评分、下载、曝光、转化等经营数据：转 `taptap-dashboard-stats`。
- 发帖、回帖、置顶、加精、沉底、删除或其它内容处置：CLI 不支持写。
- 创建游戏、修改资料、包体、资质、测试计划：转对应业务 skill。
