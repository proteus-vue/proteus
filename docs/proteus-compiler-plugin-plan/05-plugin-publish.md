# 插件发布规范与生态（G-21）

> 让社区能**稳定地发现、安装、发布** Proteus 编译器插件，形成组件库/工具链生态。

## 一、命名规范

| 类型 | 命名 | 示例 |
|------|------|------|
| 官方插件 | `@proteus-vue/plugin-<name>` | `@proteus-vue/plugin-i18n` |
| 第三方插件 | `proteus-plugin-<name>` | `proteus-plugin-permission` |
| 组织插件 | `<scope>/proteus-plugin-<name>` | `@myorg/proteus-plugin-calendar` |

**前缀强制**：Compiler 识别 `proteus-plugin-` / `@*/proteus-plugin-` 前缀，`proteus.config` 自动 resolve。

## 二、`package.json` 约定字段

```json
{
  "name": "proteus-plugin-permission",
  "version": "1.0.0",
  "type": "module",
  "proteusPlugin": {
    "version": "1",          // 插件 API 主版本（本方案 = 1）
    "hooks": ["parse", "transform"],  // 声明使用的钩子（用于依赖分析）
    "engines": { "proteus": ">=0.1.0" }
  },
  "peerDependencies": {
    "@proteus-vue/compiler-core": "^0.1.0"
  },
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  }
}
```

`proteusPlugin` 字段作用：
- `version`：API 兼容性校验（主版本不匹配 → error）
- `hooks`：静态分析插件影响阶段（用于构建优化 / 警告顺序冲突）
- `engines.proteus`：版本约束

## 三、插件发现与注册

### 自动发现
```bash
# 安装即注册（约定前缀）
npm i -D proteus-plugin-permission
```
Compiler 启动时扫描 `node_modules` 中符合命名 + 含 `proteusPlugin` 字段的包，**自动注册**（无需手动 import）。

### 显式配置（`proteus.config.ts`）
```ts
export default defineProteus({
  compiler: {
    plugins: [
      'proteus-plugin-permission',                    // 自动 resolve
      ['proteus-plugin-analytics', { endpoint: '...' }], // 带配置
      myInlinePlugin,                                  // 内联对象
    ],
  },
});
```

## 四、插件市场（远景）

- **官方 registry**：`proteus plugins search <kw>` / `proteus plugins add <name>`
- **元数据**：每个插件含 `description` / `homepage` / `tags` / `maintainers`
- **质量徽章**：类型齐全 / 有测试 / 有 JSDoc / semver 稳定 → 官方推荐

## 五、安全与沙箱

> 编译器插件运行在**构建期 Node 进程**，拥有文件/网络权限——必须约束。

| 风险 | 防护 |
|------|------|
| 恶意插件读密钥/发包 | **沙箱**：默认无网络/无 env 访问，需 `permissions` 声明 |
| 插件死循环/超时 | 钩子超时（默认 500ms/文件）+ 全局超时预算 |
| 插件污染全局 | 隔离 `cache` 命名空间 + 禁止共享全局 |
| 供应链攻击 | 官方签名 + 校验和 + 推荐徽章 |

### 权限声明
```ts
export default definePlugin({
  name: 'proteus-plugin-fetch-metadata',
  permissions: ['network'], // 声明需网络，否则 ctx.fetch 抛错
  hooks: { /* ... */ },
});
```

## 六、插件模板（scaffold）

```bash
proteus create plugin my-plugin
```
生成：
```
my-plugin/
├── src/index.ts        # definePlugin + hooks
├── src/rules/*.ts      # 规则文件（JSDoc 契约）
├── tests/*.test.ts     # 单测
├── package.json        # proteusPlugin 字段
└── tsconfig.json
```

## 七、验收

- [ ] 命名前缀自动 resolve 生效
- [ ] `package.json` `proteusPlugin` 字段校验
- [ ] `proteus create plugin` 模板可用
- [ ] 权限沙箱：未声明 `network` 的插件调用 `ctx.fetch` → error
- [ ] 插件市场搜索/安装流程
