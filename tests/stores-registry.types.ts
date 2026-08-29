// tests/stores-registry.types.ts
// M8.4 类型注册表：useStore('typo') 编译期报错（vue-tsc 检查，不运行）
import { useStore } from '../examples/stores/registry'

// ✅ 正例：静态 id 字面量受限 + 类型匹配
const player = useStore('player')
player.play({ title: 'T', durationSec: 1 })
const counter = useStore('counter')
counter.inc()

// ❌ 负例：未知 store id 编译报错
// @ts-expect-error 非注册表内的 id
useStore('usr')

// ❌ 负例：id 类型不匹配（非字符串字面量）
// @ts-expect-error K 必须是注册表 key
useStore(42)

void player
void counter
