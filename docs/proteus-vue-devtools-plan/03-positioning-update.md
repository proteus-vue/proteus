---
title: "positioning.md 第 5 章补充"
---

# 对外话术更新（proteus-positioning.md）

## 第 5 章「杀手特性」新增一条

> **⑦ 调试体验复用 Vue DevTools 生态，原生层通过自定义 Inspector 暴露**
>
> Proteus 不重新发明调试器：Web 端零成本复用 Vue DevTools 浏览器扩展，App / 小程序端复用其
> Frontend + 自研 Backend（WS Bridge）。框架把原生层数据——
> IR 树、JSI 调用时序、Style Safety 拦截记录、安全区实参、AOT/IFR 首帧——
> 注册为 `proteus-native-tree` / `proteus-jsi` / `proteus-style-safety` 等自定义 Inspector。
> **开发者用的还是熟悉的 Vue DevTools，看到的是原生渲染的全貌。**

## 对标矩阵新增一行

| 维度 | uni-app | RN | Flutter | Lynx | **Proteus** |
|------|---------|----|---------|------|------------|
| 调试器 | Chrome DevTools | Flipper / React DevTools | DevTools | Chrome | **复用 Vue DevTools + 原生层自定义 Inspector** |

## 差异化总结补一条

> **别人要么用 Chrome DevTools（uni-app）、要么自研 DevTools（Flutter / RN），Proteus 复用 Vue 生态最成熟的
> 调试器，并把原生层数据无缝接入——零学习成本 + 原生全貌。**

## 收尾 slogan 补充

> Write once in Vue. Render natively everywhere. **Debug with the tools you already love.**
