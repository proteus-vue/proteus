# Architecture 规约更新（G-19）

## 1. 新增执行位

| 编号 | 名称 | 优先级 | 依赖 |
|------|------|--------|------|
| **G-19** | HMR & DevTools | P0 | G-18, Compiler B1 |

## 2. 原则落地

**原则 #3（编译透明）** 通过 DevTools 可视化落地：
- Style Safety 闸门可见（G-16）
- HMR 增量过程可观测
- 原生 View 树 ↔ 组件树映射

## 3. 全景图补充

工具链层完整：
```
[工具链层]  CLI(G-18) / Compiler / DevTools(G-19)
                ↓
          各层运行时
```

## 4. 关联

- 原则 #3（编译透明）、#10
- Style Safety(G-16)、Memory(G-06 LeakRegistry)
- Router(G-17 栈序列化用于安全 reload)
- CLI(G-18 dev server)
