---
name: taptap-dashboard-stats
version: 1.0.0
description: "TapTap 开发者后台数据表现查询 runbook。用于下载、PV、曝光、转化、预约、订单、评分、关注、收藏，以及论坛访问量、活跃用户、内容发布/删除/移动、回复等指标查询和趋势解释；不负责评价正文、论坛帖子正文或业务写操作。"
metadata:
  requires:
    bins: ["taptap-cli"]
  cliHelp: "taptap-cli dashboard-stats --help;taptap-cli schema dashboard-stats get-dashboard-stats;taptap-cli schema dashboard-stats get-forum-stats"
---

# dashboard-stats

开始前先读 [`../taptap-cli/references/shared-execution.md`](../taptap-cli/references/shared-execution.md)（身份、JSON 输出外壳、错误处理）。

dashboard-stats 是只读数据查询 skill。核心风险不是写入，而是指标口径混用、时间范围不清、游戏形态不匹配。

**CRITICAL — 不要把不同游戏形态套同一套口径。指标口径、时间范围或形态不匹配会把数据解释成错误的业务结论；不同形态、平台或渠道分别查询后再汇总。**

## 快速决策

| 用户意图 | 处理 |
| --- | --- |
| 下载量、PV、曝光、转化、预约、订单、评分、关注、收藏 | 用本 skill 查询指标 |
| 论坛访问量、活跃、内容发布/回复、关注与内容总数 | 用 `get-forum-stats`，见 [forum stats](references/forum-stats-cheatsheet.md) |
| 不确定 metric key | 先查 `schema dashboard-stats get-dashboard-stats` / [metrics cheatsheet](references/dashboard-metrics-cheatsheet.md)，不要猜 |
| 查询某个推荐位 / 展示位转化 | 先 `get-dashboard-position-options` 取合法 value，再查 `metric=position` |
| 用户没给时间范围 | 追问；若上下文有“昨天/上周/最近 7 天”，转成具体日期 |
| 用户问“表现怎么样” | 先按游戏形态选核心指标，再补趋势/异常 |
| 对比两个时间段/平台/渠道 | 分别查询后汇总差异，不混用口径 |
| 无数据或指标不适用 | 解释可能原因：时间范围、形态不适用、权限、统计延迟 |
| 评价正文、论坛帖子正文 | 转 `taptap-player-feedback` / `taptap-community-management`；跨社区舆情检索不在 CLI 覆盖范围 |

## 常用命令

```bash
taptap-cli dashboard-stats --help
taptap-cli schema dashboard-stats get-dashboard-stats
taptap-cli dashboard-stats get-dashboard-position-options --app-id <appId> --dev-id <developerId>
taptap-cli schema dashboard-stats get-dashboard-stats
taptap-cli dashboard-stats get-dashboard-stats \
  --app-id <appId> --dev-id <developerId> \
  --data '{"metric":"<metricKey>","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD"}'
```

## 执行规则

- 缺 `developerId` / `appId` 时转 `taptap-identity`，不要猜 ID。
- 先确认业务问题，再从 [metrics cheatsheet](references/dashboard-metrics-cheatsheet.md) 和 `schema <service> <method>` 选择 metric 与维度。
- `metric=position` 查询整体拆分时可不传 `position`；用户指定单个推荐位时必须先用 `get-dashboard-position-options` 取本 scope 的合法 value，不能猜 `home_top` 等 key。
- 自然语言日期转成具体 `YYYY-MM-DD`；回复写清时间范围。用户没有给范围且上下文也无相对日期时先追问。
- 预约游戏优先看预约、预约转化、曝光到预约。
- APK 可下载游戏优先看下载、商店页 PV、下载转化。Windows / PC 当前没有稳定的专属下载或转化指标；用户询问 Windows 下载、PC 转化或独立承接时明确说明“目前暂无 Windows 相关数据”，不得用 `download`、`mini_device` 或 `cloud_start` 替代。
- 买断/付费游戏看订单、收入、支付转化时必须说明统计口径。
- 评价相关指标只覆盖数据表现页可查的评分/评价统计，不等于评价正文检索；要评价正文转 `taptap-player-feedback`。
- 社区关注、收藏等是聚合指标，不等于帖子内容分析。
- 论坛数据指标用 `get-forum-stats`，口径与无数据判读见 [forum stats](references/forum-stats-cheatsheet.md)。
- 查询后先给口径、时间范围、汇总值、趋势和异常解释。
- 常规 metric 的 `total` 是汇总对象，不是数字；优先读取 `overview.list`，趋势字段按 `key_map` 解读。
- `version` 是否生效以当前接口结果为准；CLI 不在本地忽略或改写 metadata 已声明的字段。
- 不默认输出原始 JSON、内部字段名、枚举或 schema；用户明确要求 debug/JSON/schema 时例外。
- 无数据时不要直接说“没有表现”；先解释可能原因并给下一步查询建议。
- 所有统计查询都是只读；任何修改资料、创建活动、提交审核、发版需求转对应业务 skill。

## References

| Reference | 什么时候读 |
| --- | --- |
| [metrics cheatsheet](references/dashboard-metrics-cheatsheet.md) | 选择 metric、platform、position、review_type 等取值时。 |
| [forum stats](references/forum-stats-cheatsheet.md) | 查论坛数据指标时。 |

## 不在本 skill 范围

- 评价正文、单条评价的配图、作者与回复：转 `taptap-player-feedback`。
- 论坛帖子正文、一级回复和子回复：转 `taptap-community-management`；跨社区舆情检索不在当前 CLI 范围。
- 修改资料、创建活动、提交审核、发版等写操作转对应业务 skill。
