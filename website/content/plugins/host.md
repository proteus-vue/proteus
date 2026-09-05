---
title: host（v0.1.0）
order: 92
group: 插件 API
generated: true
source_hash: 1511dee1
---

# host

> 本页由 WIT 自动生成（since_v0_1_0.wit），请勿手工编辑。
> 需要补充「为什么 / 怎么做」，请写到指南并链接过来。

插件宿主（PluginHost）——生命周期 + 能力探测 + 运行时调用 + 治理。

## activate

激活插件。宿主按 activationEvents 决定时机（激活时机是契约，不是优化项）。

```ts
activate(plugin-id: `string`) -> result<string, string>
```

| 参数 | 类型 |
|---|---|
| plugin-id | `string` |

## suspend

挂起插件。deactivate 必须对称清理资源（未清理项记入审计并降信任分）。

```ts
suspend(plugin-id: `string`) -> 
```

| 参数 | 类型 |
|---|---|
| plugin-id | `string` |

## uninstall

卸载插件。

```ts
uninstall(plugin-id: `string`) -> 
```

| 参数 | 类型 |
|---|---|
| plugin-id | `string` |

## supports

★ 能力探测：纯元数据查询，零副作用、零网络、零内核调用。 严禁"发一个请求看会不会崩"——用有副作用的调用探测能力是设计错误。

```ts
supports(cap: `string`) -> bool
```

| 参数 | 类型 |
|---|---|
| cap | `string` |

## invoke

运行时调用。越权返回 denied（权限系统的正常输出，非错误——宿主记录并继续）。

```ts
invoke(plugin-id: `string`, call: `string`) -> result<string, string>
```

| 参数 | 类型 |
|---|---|
| plugin-id | `string` |
| call | `string` |

## get-usage

治理：查询插件资源用量（内存 / CPU / 超时）。

```ts
get-usage(plugin-id: `string`) -> string
```

| 参数 | 类型 |
|---|---|
| plugin-id | `string` |

## kill-plugin

治理：终止失控插件（资源超限强制执行，只杀该插件不影响其他）。

```ts
kill-plugin(plugin-id: `string`, reason: `string`) -> 
```

| 参数 | 类型 |
|---|---|
| plugin-id | `string` |
| reason | `string` |

## api-surface

★ 架构试金石：内核 API 面快照。加自有宿主/内置插件不得改变此快照。

```ts
api-surface() -> list<string>
```
