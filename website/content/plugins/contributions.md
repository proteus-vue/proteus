---
title: contributions（v0.1.0）
order: 91
group: 插件 API
generated: true
source_hash: 1511dee1
---

# contributions

> 本页由 WIT 自动生成（since_v0_1_0.wit），请勿手工编辑。
> 需要补充「为什么 / 怎么做」，请写到指南并链接过来。

插件贡献点（ContributionPoints）——Tier 0 数据由宿主直接应用，Tier 1/2 需要运行时。

## command-def（record）

命令贡献：面板/菜单触发的行为入口（Tier 1+）。

- **id**: `string`
- **title**: `string`
- **icon**: `option<string>`

## panel-def（record）

面板贡献（Studio 特有：框架语义面板挂载点）。

- **id**: `string`
- **title**: `string`
- **where**: `string`

## theme-def（record）

主题贡献（Tier 0：纯数据，宿主读取后直接应用）。

- **id**: `string`
- **name**: `string`
- **css**: `string`
