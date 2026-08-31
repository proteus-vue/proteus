# 08 Native SDK 类型自动生成

## 1. 设计思路（对齐 Types plan 铁律 #6）

NativeScript 的核心优势：**Native 类的类型自动生成 `.d.ts`**。
Proteus 复用同一思路——**禁止手写 SDK 类型**，从官方头文件自动生成。

## 2. 三端生成器

| 端 | 源文件 | 生成器 | 输出 |
|----|--------|--------|------|
| iOS | `.h` / `.swiftinterface` | `proteus-type-gen-ios` | `*.d.ts` |
| Android | `.java` / `.kt` + 反射 | `proteus-type-gen-android` | `*.d.ts` |
| 鸿蒙 | `.d.ts`（ArkUI 自带） | 直接复用 | `*.d.ts` |

## 3. 生成流程

```
SDK 头文件 → AST 解析 → IR → TypeScript 声明
                                ↓
                     @proteus-vue/types 消费
```

```bash
# CLI（对齐 CLI plan）
proteus typegen --platform ios --sdk /path/to/iOS.sdk --out src/types/ios/
proteus typegen --platform android --sdk $ANDROID_HOME --out src/types/android/
proteus typegen --platform harmony --out src/types/harmony/
```

## 4. 命名空间

```ts
// 自动生成，禁止手写
declare namespace ProteusNative {
  namespace ios {
    class UIGlassEffect {
      static regular(): UIGlassEffect
      setCornerRadius(radius: number): void
    }
  }
  namespace android {
    class RenderEffect {
      static createBlurEffect(...): RenderEffect
    }
  }
  namespace harmony {
    // ArkUI blur/fractal
  }
}
```

业务层通过 `assertPlatform` + 判别联合安全访问：

```ts
if (assertPlatform('app')) {
  const glass = new ProteusNative.ios.UIGlassEffect.regular()
}
```

## 5. 版本对齐

- SDK 版本 → typings 版本 **1:1 锁定**
- `proteus.config.ts` 指定目标 SDK → 自动拉取对应 typings
- 对齐 Glass plan 的 `MpSdkVersion` 思路

## 6. 与 miniprogram-api-typings 的关系

- 小程序端：`wx.*` → 用官方 `miniprogram-api-typings`（Types plan §8）
- App 端：Native API → **本方案自动生成**
- 统一收敛到 `@proteus-vue/types` 的 `ProteusNative` 命名空间

## 7. 更新策略

- SDK 大版本更新 → 重新生成 → 对比 diff → 破坏性变更标 `@deprecated`
- 对齐 Types plan 的向后兼容策略（major 版本化）
