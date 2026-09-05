---
title: 创建你的第一个工程
order: 5
group: 开始
---

# 创建你的第一个工程

一条脚手架命令，创建一个 **Web + 微信小程序双端工程**。本页的命令与生成物以 `packages/create-proteus` 源码与模板为准。

## 创建

```bash
npm create @proteus-vue/proteus my-app
cd my-app
npm install
```

脚手架没有交互式提问：项目名就是命令参数（自动规范化为小写字母 / 数字 / 连字符）；目标目录已存在且非空时会拒绝。

它做三件事：

1. 复制内置模板工程（框架快照 + 编译管线 + 首页示例）
2. 把模板中的 `{{name}}` 占位符替换为项目名
3. 打印下一步提示：`npm run dev:web` 跑 Web 端、`npm run build:mp` 跑小程序端

> 若 `npm install` 时 `@proteus-vue/*` 包不可用（npm 尚未发布对应版本），脚手架 README 记载了过渡方案：临时以仓库路径安装对应 `packages/*` 包，或使用 npm link。

## 下一步

- [运行与预览](/docs/06-run-preview)：把 Web 端和小程序端都跑起来
