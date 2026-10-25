#!/usr/bin/env node
// scripts/capability-scale-audit.mjs —— ★★★能力端「规模承载」体检（用户 2026-10-20 明令的硬指标）
//
// 【为什么需要（用户原话）】
//   「每一个能力的端落地都要能承载大厂超级应用规模才行，不能是只有基本能力，这个是端落地的硬指标。」
//   ⇒ 「端上有这个方法」不等于「落地」。一个只在 demo 跑通、一上量就 OOM/卡死/静默丢数据的实现，
//     按**未落地**计（与「方法存在但纯空壳不算可用」同族：都是"看起来有、实际不能用"）。
//   本工具把这条要求变成**可观测的体检**，而不是一句口号。
//
// 【判据（四项，见 docs/Proteus_原生能力接入方案.md §1.0）】
//   ① 上限：有没有明确字节/条数上界？超限是否**显式报错**（不是静默截断）？
//   ② 背压：生产快于消费时怎么办？有没有队列上界/丢弃计数？
//   ③ 回收：异常/取消/退出时原生资源谁释放？是否登记进资源账本？
//   ④ 并发/淘汰：同时 N 个实例会怎样？表项有无上界？
//
// 【★能力边界（必须说清，否则会被当成"规模合格证"）】
//   本工具是**静态体检**——它读源码里的"上限常量 / 上界 / 账本登记 / 丢弃计数"等**结构证据**，
//   **不能**证明真实规模下的行为（那要真机压测：大文件、百连接、长时间跑）。
//   ⇒ 它回答「有没有为规模做设计的痕迹」，不回答「规模下一定不崩」。
//   ★并且它**不做判定门槛**（不 exit 1）：规模档是**排期输入**，不是 CI 红绿。
//     真正该红的是"标了 ✅ 却连 S1 证据都没有"——那由能力页与真机判据负责。
//
// 用法：node scripts/capability-scale-audit.mjs [--json] [--cap=upload,websocket]
// 退出码：0 成功（缺口不是错误——是待办）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JSON_OUT = process.argv.includes('--json')
const capArg = process.argv.find((a) => a.startsWith('--cap='))
const ONLY = capArg ? capArg.slice(6).split(',').map((s) => s.trim()).filter(Boolean) : null

const API_DIR = path.join(ROOT, 'packages/api/src')
const HOSTS = {
  android: path.join(ROOT, 'hosts/android/app/src/main/java/dev/proteus/layoutcore'),
  ios: path.join(ROOT, 'hosts/ios/ProteusHost/runtime'),
}

/** 能力 → 相关源文件（共享 TS + 两端宿主） */
const CAP_SOURCES = {
  // ★★★#1242 修正（第三处同类"读错文件"的假红）：upload/download 的**流式主体在
  //   `HttpCapability`**（宿主直读文件边读边发 / 边收边写盘），不在 `FileTransferCapability`。
  //   证据：Android `performUploadFromFile` 的 `FileInputStream` + `STREAM_CHUNK` 循环、
  //        `setFixedLengthStreamingMode`；iOS `uploadTask(with:fromFile:)` + `registerSaving`。
  //   ⇒ 只登记 FileTransferCapability 会让两个**已在双真机验到 S3**的能力（#1120/#1123）
  //     永远显示"流式 ❌ / 背压 ❌" ⇒ 团队会去"修"一个没坏的东西（假红与假绿同害）。
  upload: {
    ts: ['capability-transfer.ts'],
    hosts: ['HttpCapability.java', 'http-capability.swift', 'FileTransferCapability.java', 'file-transfer-capability.swift'],
  },
  download: {
    ts: ['capability-transfer.ts'],
    hosts: ['HttpCapability.java', 'http-capability.swift', 'FileTransferCapability.java', 'file-transfer-capability.swift'],
  },
  websocket: { ts: ['capability-websocket.ts', 'capability-app-device.ts'], hosts: ['websocket-capability.swift', 'WebSocketCapability.java'] },
  'socket-task': { ts: ['capability-socket-task.ts'], hosts: ['websocket-capability.swift', 'WebSocketCapability.java'] },
  sensor: { ts: ['capability-app-device.ts'], hosts: ['DeviceCapability.java', 'device-capability.swift'] },
  // ★★#1243 补齐：`capability-fetch-pipeline.ts` 是**回收**维度的落点（在飞请求登记账本 +
  //   页面 dispose ⇒ abort）。不登记它 ⇒ fetch 会被判"无资源账本"（假红），
  //   而账本真接上以后又会被判"已达标"却拿不出证据（假绿的镜像）。
  fetch: {
    ts: ['capability-invoke.ts', 'request-engineering.ts', 'capability-fetch-pipeline.ts'],
    hosts: ['HttpCapability.java', 'http-capability.swift'],
  },
  'screen-capture': { ts: ['capability-app-capture.ts'], hosts: ['CaptureCapability.java', 'capture-capability.swift'] },
  worker: { ts: [], hosts: [] },
  // ★#1239 修正：原登记指向 Web/MP 桥 ⇒ App 侧实现永远探不到（永远 S1）
  storage: {
    ts: ['capability-app-storage.ts', 'capability-app-filesystem.ts'],
    hosts: ['FileTransferCapability.java', 'file-transfer-capability.swift', 'proteus_fs.h'],
  },
  // ★#1239：file-system（App 共享层 capability-app-filesystem.ts + ZIP 解析 + 三端 fs.*）
  'file-system': {
    ts: [
      'capability-app-filesystem.ts',
      'capability-app-unzip.ts',
      'capability-app-fs-encoding.ts',
      // ★#1236 在飞配额池（背压/回收/并发三项的落点——不登记就会漏判成"无背压"）
      'capability-app-fs-governor.ts',
    ],
    hosts: ['FileTransferCapability.java', 'file-transfer-capability.swift', 'proteus_fs.h'],
  },
  log: {
    ts: ['capability-app-log.ts'],
    hosts: ['LogCapability.java', 'log-capability.swift', 'proteus_log.h'],
  },
}

/** 各组证据的正则（结构痕迹，不判语义）
 *  ★#1113 第一版判据太宽（`stream|chunk|offset` 命中注释与局部变量 ⇒ 几乎全部 ✅），
 *    实测 `transfer` 里 `stream` 只出现 1 次（还是注释）、`offset` 是读文件的局部变量。
 *    ⇒ 收紧为**成对/带数量**的形态：必须有"分块循环"、"队列 + 上限"、"丢弃计数"这类**组合**，
 *      而不是单个关键词。宁可漏判（显示更保守的档位）也不要假绿——与 #1111 同一纪律。
 *
 *  ★#1114 第四处修正：**"上限"必须对号入座**。
 *    实测 fetch 被判 `upperBound:true`，命中的是 `capability-invoke.ts` 的
 *    `PENDING_HOST_CALLS_MAX = 1024`——那是**挂起调用条数**上限（并发维度），
 *    与"响应体能吞多大"**毫无关系**（真正的响应读取在两端宿主：Android `readAll` **无总上限**、
 *    iOS `dataTask` 一次性进内存）。
 *    ⇒ 判据要求上限常量**名里带 size/bytes/length 语义**，或与 body 读取在同一文件内。
 *      `` PENDING/COUNT/QUEUE `` 一类名字归到**并发**维度，不算"上限"。
 */
// ★★★#1246 第三处修正（判据的语义假设过窄）：
//   原来 `upperBound` 只认**尺寸语义**（size/bytes/len/…），于是"订阅数上限"
//   `SENSOR_MAX_SUBSCRIPTIONS` 被判成"没有上限"——**假红**。
//   ★但这里要小心不要退回到"什么 MAX_* 都算上限"（那正是 #1114/#1115 修掉的假绿：
//     `PENDING_HOST_CALLS_MAX` 是**并发**维度，不能当"响应体能吞多大"）。
//   ⇒ 口径：**单次/单实例的容量上界**（subscriptions/tasks/handlers/connections/messages）
//     属于"这个能力一次能吃多少" ⇒ 算上限；**并发/挂起数**（PENDING/COUNT/QUEUE）
//     仍归 tableBound（由 COUNT_WORD 排除，见 isSizeBound）。
const SIZE_WORD =
  /size|bytes|len|length|body|response|payload|content|MB|MiB|KB|subscriptions?|handlers?|messages?|connections?|samples?|depth/i
const COUNT_WORD = /PENDING|COUNT|QUEUE|CONN|ITEMS|ENTRIES|CALLS|TASKS/i

const SIGNALS = {
  // 上限：常量名必须表达"尺寸"，且不得是并发计数类名字
  //   ★#1115 第五处修正：**值也必须是有限合理数**。实测把上限改成 `Long.MAX_VALUE`
  //     （事实上无界）时判据仍判"有上限"（名字里还有 MAX_BODY_BYTES）⇒ 破坏性验证没变红。
  //     ⇒ 单独用函数判（见 `hasFiniteSizeBound`），显式排除"无界"写法。
  //   ★#1240 第六处修正：**带前缀的常量名**（`LOG_MAX_MESSAGE_BYTES` / `FS_MAX_CHUNK_BYTES`）此前一律漏判——
  //     原正则用 `\bMAX_`，而 `LOG_MAX_` 里 MAX 前是 `_`（word 字符）⇒ **无词边界** ⇒ 明明写了上限也判"无上限"。
  //     这是判据的结构性盲区（不是实现缺失），改为「前面不是字母数字」的 MAX（覆盖 行首/空白/(/下划线 三种前缀形态）。
  upperBound: [
    // ★★★#1246 第四处修正：原来的 `+\s*(?:\*\s*[\d_]+\s*)+` 要求**乘法表达式**
    //   （形如 `64 * 1024 * 1024`）⇒ 裸数字上限 `SENSOR_MAX_SUBSCRIPTIONS = 64` **完全漏判**（假红）。
    //   ★但也不能退化成"任意数字都算"——所以仍要求**名字里有容量语义**（SIZE_WORD 的承担者见下）。
    //   这里用一个显式词表 + 允许单值。
    /(?:^|[^A-Za-z0-9])MAX_[A-Z_]*(SIZE|BYTES|LEN|LENGTH|BODY|RESPONSE|CONTENT|SUBSCRIPTIONS|HANDLERS|CONNECTIONS|TASKS|MESSAGES|SAMPLES|DEPTH)[A-Z_]*\s*=\s*[\d_]+/i,
    /\b(maxSize|maxBytes|maxBody|maxResponse|sizeLimit|byteLimit)\s*[:=]\s*[\d_]+\s*(?:\*\s*[\d_]+\s*)*/i,
    /\bMAX\s*=\s*[\d_]+\s*\*\s*[\d_]+\s*\*\s*[\d_]+/, // 形如 64*1024*1024
  ],
  // 「显式报错」= 超限时抛出/返回**可识别的错误**（不是静默截断）。
  //   ★#1115：除了中文"过大"，也要认**结构化错误码**（本项目实际用的是 `xxx.tooLarge` 一族）——
  //     否则一个明明写了专用错误码的实现，会被判成"没有显式报错"（反向假红）。
  // ★★★#1246 第五处修正：**"拒绝型"错误码**（tooMany* / busy / overloaded）同样是显式报错。
  //   原词表只认 `tooLarge` 一族 ⇒ `sensor.tooManySubscriptions`、`file-system.busy`、
  //   `websocket.tooManyConnections` 全被判"没有显式报错"（假红）。
  //   ★口径：**超限时必须给出可辨识的错误码**——不管是"太大"还是"太多"。
  //   静默截断才是要抓的形态（删掉 toString/truncate 而只留计数）。
  explicitError: [
    /throw[^\n]*(过大|太多|too large|too many|exceeds|超出)/i,
    /(过大|太多|too large|too many|exceeds)[^\n]*throw/i,
    /\b\w+\.tooLarge\b/,
    /\b\w+\.tooMany[A-Za-z]*\b/,
    /BodyTooLarge|TooLargeException|PayloadTooLarge/i,
  ],
  // 「流式」= 真有"分块循环"或"分块 **API/常量**"，不是出现 stream/分块 这些词
  //   ★#1113 第三处修正：字符串字面量也要排除——实测命中来自错误消息
  //     `"fs.readBytes: 文件过大（)——分块读取属后续批次"`（**它在说"没有分块"**），
  //     而这被当成了"有流式"的证据。⇒ 判据读的是**代码标识符**，不是文案。
  streaming: [
    /for\s*\([^)]*\)\s*\{[\s\S]{0,200}?(read|write)\([^)]*chunk/i,
    /\b(readChunk|writeChunk|chunkSize|CHUNK_SIZE|chunked[A-Za-z]*)\b/,
  ],
  // 「背压」= **有界队列 + 丢弃/阻塞计数**两件齐备；单个 queue/buffer 不算。
  //   ★★★#1236 第七处修正（两个方向都错，实测取证）：
  //     · **假绿**：旧第二条 `/(丢弃|drop)[^\n]{0,40}(计数|count|统计)/i` 命中的是
  //       iOS `dropFirst(docs.count`（Swift 标准库调用，与丢弃计数毫无关系）
  //       ⇒ fetch 的「背压 ✅」当时是**靠这条假证据**撑住的。
  //     · **假红**：旧第一条只认 `MAX_QUEUE|dropCount` 这类名字，
  //       而真实实现用的是 `STREAM_QUEUE_DEPTH`（fetch）/ `LOG_MAX_QUEUE`（log）/
  //       `FS_MAX_WAITERS`（file-system）/ `STORAGE_MAX_PENDING_WRITES`（storage）
  //       ⇒ 四个真有背压的能力被判"无背压"。
  //   ⇒ 判据改为**成对**：有界（队列深度/等待表/待落盘上限）+ 计数（丢弃/拒绝/阻塞/合并）。
  //     成对是对本仓 #1113 教训（单关键词会命中注释与无关标识符）的直接执行——
  //     必须"两件事同时存在"才算，而不是"出现了背压这个词"。
  backpressure: null,
  resourceLedger: [/registry\.register\(|resources\.register\(|\.register\(\{[\s\S]{0,120}?type:/],
  // 「并发上界」= 表项/挂起数上限常量或淘汰逻辑（这是 COUNT_WORD 的归属）
  //   ★#1240 同款前缀盲区：`LOG_PENDING_MAX` / `FS_MAX_INFLIGHT_TASKS` 里的 MAX 前也是 `_`。
  //   ★#1245 增补 `MAX_TASKS|MAX_SOCKETS|MAX_HANDLES|MAX_SESSIONS`：**长生命周期句柄数**上界。
  //     与 MAX_CONN 同族但不是"连接"——socket-task 的句柄在 connecting 阶段还没有连接，
  //     却已经占着积压数组与订阅集（逐条上限 ≠ 整体上限，#1236 同源）。
  //   ★#1246 增补 `MAX_SUBSCRIPTIONS`：**订阅表项**上界（sensor 的 ④ 维度：N 个订阅会怎样）。
  tableBound: [/(?:^|[^A-Za-z0-9])(MAX_CONN|MAX_TASKS|MAX_SOCKETS|MAX_HANDLES|MAX_SESSIONS|MAX_SUBSCRIPTIONS|MAX_ITEMS|MAX_ENTRIES|MAX_INFLIGHT|PENDING_[A-Z_]*MAX|MAX_[A-Z_]*CALLS|maxConnections|maxEntries|pendingMax|evict|LRU)/i],
}

/** ② 背压的"有界"一侧：队列/等待表/待落盘 的容量上界 */
//   ★#1244 增补 `MAX_DISPATCH*` / `MAX_IN_FLIGHT*`：**单次处理批量上界**（不是队列，但同样是
//   "一次最多处理多少"的有界性）。ws 分发用它——N 个慢订阅者串行会让一条消息卡死整条通道。
//   ★#1246 增补 `MAX_SUBSCRIPTIONS|MAX_HANDLERS|MAX_CONNECTIONS|MAX_TASKS`：
//   **订阅者/句柄数上界**是"生产快于消费"的可控面——订阅者越多，每次分发的成本越高，
//   而分发是同步的（宿主线程被占）⇒ 上界 + 丢弃/慢分发计数就是这一族的背压证据。
const BP_BOUND = /(MAX_QUEUE|QUEUE_CAP|QUEUE_LIMIT|QUEUE_DEPTH|maxQueue|queueLimit|MAX_WAITERS|MAX_PENDING_[A-Z_]+|MAX_PENDING_WRITES|MAX_DISPATCH_[A-Z_]+|MAX_IN_FLIGHT[A-Z_]*|MAX_SUBSCRIPTIONS|MAX_HANDLERS_PER_[A-Z_]+|MAX_CONNECTIONS|MAX_TASKS)/i
/** ② 背压的"计数"一侧：丢弃 / 拒绝 / 阻塞 / 写合并 的可观测量 */
//   ★#1242 增补 `slowWrites?` / `blockedWrites?` / `blocked*`：**阻塞式背压**（无队列）的
//   合法计数形态。上传就是这一族——背压来自 `sink.write` 在 TCP 窗口满时阻塞，
//   没有队列也没有丢弃，但"慢写次数"照样是"生产快于消费"的可观测证据。
//   ★与此前的假绿区别（`dropFirst(docs.count`）：那个是标准库调用，**不被递增**；
//   这一族必须在写入循环里 `++`，所以它是真的计数器（判据读的是"被递增的标识符"）。
const BP_COUNTER = /(dropped[A-Za-z_]*|dropCount|rejected[A-Za-z_]*|backpressure[A-Za-z_]*|coalesced[A-Za-z_]*|slowWrites?|blockedWrites?|blocked[A-Za-z_]*|waited\b|waiters\b)/i

/**
 * ② 背压判定（**成对**：有界 + 计数）。
 * ★为什么必须成对：只有上界没有计数 ⇒ 业务不知道丢了多少（不可观测）；
 *   只有计数没有上界 ⇒ 队列仍可无界增长（"计数的无界"仍是 OOM）。
 *   见 SIGNALS.backpressure 处的取证注释（假绿 + 假红各一例）。
 */
function hasBackpressure(text) {
  return BP_BOUND.test(text) && BP_COUNTER.test(text)
}

/** 该上限常量是否表达"尺寸"而非"条数"（用于给 `upperBound` 复核） */
export function isSizeBound(name) {
  return SIZE_WORD.test(name) && !COUNT_WORD.test(name)
}

/**
 * ★#1113 第二处修正：**必须剥离注释再判**。
 *   实测：`capability-transfer.ts` 的注释里写着「**分块协议属后续批次**」「未做流式落盘」，
 *   而我的"流式"正则匹配到了注释里的"分块"二字 ⇒ **把"明确没有的实现"判成了有**（假绿）。
 *   ★这与 #1105「逐点差异冒充画质」/ #1111「注释里的历史写法」是同一族：**判据读错了文本层**。
 *   剥离规则：`//` 行注释、块注释、Swift 的 `///`、Python/Shell 的 `#`。
 */
function stripComments(src) {
  let t = src.replace(/\/\*[\s\S]*?\*\//g, '')
  t = t.replace(/^\s*\/\/\/?.*$/gm, '')
  t = t.replace(/(^|[^:])\/\/.*$/gm, '$1')
  t = t.replace(/^\s*#.*$/gm, '')
  return t
}

function readAll(files) {
  let text = ''
  const found = []
  for (const f of files) {
    if (!f) continue
    // TS 侧按名前缀匹配（文件名已知）；宿主侧在目录树里找同名文件
    let p = path.join(API_DIR, f)
    if (!fs.existsSync(p)) {
      // 宿主文件：递归找
      for (const root of Object.values(HOSTS)) {
        const hit = findByName(root, f)
        if (hit) { p = hit; break }
      }
    }
    if (fs.existsSync(p)) { text += '\n' + stripComments(fs.readFileSync(p, 'utf8')); found.push(path.relative(ROOT, p)) }
  }
  return { text, found }
}

function findByName(dir, name, acc = []) {
  if (!fs.existsSync(dir)) return null
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { const r = findByName(p, name, acc); if (r) return r }
    else if (e.name === name) return p
  }
  return null
}

/**
 * ★★★#1248 **上限常量必须真的被用于判断**（不是"文件里有这个常量"）。
 *
 * 【为什么必须升级（反向验证抓出的结构性假绿）】
 *   实测：把 `STORAGE_MAX_KEYS` / `LOG_MAX_QUEUE` / `WS_MAX_CONNECTIONS` 等常量
 *   **逐个删掉**后重跑体检 —— **7 个里 6 个档位完全不变**。
 *   根因：原判据是**文件级 any()**（`text` 里出现任一上限就五项全 ✅），
 *   而能力文件里通常还有别的上限 ⇒ 删掉某一个仍被判"有上限"。
 *   ★这证明当时的 S3 **不是被实现撑住的，是被词表撑住的**——与本仓 #1109
 *     「断言符号存在等于没断言」完全同族（第 4 次）。
 *
 * 【新判据】对每个候选上限常量 `NAME = <num>`，要求同一文件里存在
 *   **对 NAME 的比较/取用**（`> NAME` / `>= NAME` / `< NAME` / `=== NAME` /
 *   `Math.min(..., NAME)` / `length >= NAME` 等），并且该常量名本身带容量语义。
 *   ★只要有一个常量"被真的用于判断"就算达成——因为能力的上限闸可能分散在多处。
 */
function usedBounds(text) {
  const out = []
  for (const m of text.matchAll(/(?:^|[^A-Za-z0-9])((?:[A-Z][A-Z0-9_]*_)?MAX_[A-Z0-9_]+)\s*=\s*[\d_]/g)) {
    const name = m[1]
    /**
     * ★★★#1248 关键修正：这里**不能再套 COUNT_WORD 排除**。
     *   原判据（文件级）用 COUNT_WORD 是为了**区分维度**（`PENDING_HOST_CALLS_MAX` 是并发、
     *   不是"响应体能吞多大"，见 #1114/#1115 的假绿）；
     *   但升级到"逐常量 + 必须被用于判断"之后，这个排除反而把**真上限**打掉了：
     *   `LOG_MAX_QUEUE`（队列容量，是真上限）、`MAX_TASKS`/`MAX_CONNECTIONS`（句柄上界）
     *   名字里都带 COUNT_WORD 的词 ⇒ 全被跳过 ⇒ 全部能力掉到 S1（假红，本轮实测）。
     *   ⇒ 现在的口径：**只要它被用于一个"拒绝/停止"判断**，就说明实现真的用它设了闸；
     *     名字属于哪个维度由 `upperBoundNames` 如实列出，交由人复核（不再由词表替人下结论）。
     */
    if (!SIZE_WORD.test(name)) continue
    // ★"被用于判断"：名字在同文件里出现在比较/取小/判等的一侧
    const used = new RegExp(
      '(?:[<>]=?|===?|!==?)\\s*' + name + '\\b' +   // x >= NAME
        '|\\b' + name + '\\s*(?:[<>]=?|===?|!==?)' +  // NAME > x
        '|\\b(?:Math\\.min|Math\\.max)\\([^)]*\\b' + name + '\\b',  // Math.min(..., NAME)
      'i',
    ).test(text)
    if (used) out.push(name)
  }
  return out
}

export function audit(cap) {
  const cfg = CAP_SOURCES[cap]
  if (!cfg) return { cap, error: '未登记源文件（在 CAP_SOURCES 补一行）' }
  const { text, found } = readAll([...cfg.ts, ...cfg.hosts])
  if (!found.length) return { cap, error: '找不到源文件（能力可能未实现）' }

  const has = (reList) => reList.some((re) => re.test(text))
  const bounds = usedBounds(text)
  const r = {
    cap,
    sources: found,
    // ★#1248：必须是"被用于判断"的上限，不是"文件里出现过"
    upperBound: bounds.length > 0,
    upperBoundNames: bounds,
    explicitError: has(SIGNALS.explicitError),
    streaming: has(SIGNALS.streaming),
    backpressure: hasBackpressure(text),
    resourceLedger: has(SIGNALS.resourceLedger),
    tableBound: has(SIGNALS.tableBound),
  }
  // 规模档推导（保守：只按结构证据）
  //   S1 基本可用 · S2 = 上限 + 显式报错 · S3 = S2 + 背压 + 回收 + 并发上界
  r.tier = r.upperBound && r.explicitError
    ? (r.backpressure && r.resourceLedger && r.tableBound ? 'S3' : 'S2')
    : 'S1'
  // 高频/大数据能力要求 S3
  // ★§1.0 明列的高频/大数据族（网络/文件/媒体/socket/日志/埋点）要求 S3
  r.needsS3 = ['websocket', 'socket-task', 'upload', 'download', 'sensor', 'fetch', 'log', 'file-system', 'storage'].includes(cap)
  return r
}

// ★仅作 CLI 时执行（被官网生成链 import 时不打印、不 exit）
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
const CAPS = ONLY ?? Object.keys(CAP_SOURCES)

const results = isMain ? CAPS.map(audit) : []

if (isMain && JSON_OUT) { console.log(JSON.stringify(results, null, 2)); process.exit(0) }

if (isMain) {
console.log('[capability-scale-audit] 能力规模承载体检（静态结构证据，非压测）')
console.log('  判据：S2 = 上限 + 显式报错；S3 = S2 + 背压 + 回收 + 并发上界')
console.log('')
const mark = (b) => (b ? '✅' : '❌')
for (const r of results) {
  if (r.error) { console.log(`  ? ${r.cap.padEnd(16)} ${r.error}`); continue }
  const need = r.needsS3 ? '（要求 S3）' : '（要求 ≥S2）'
  const okTier = r.needsS3 ? r.tier === 'S3' : r.tier !== 'S1'
  console.log(`  ${okTier ? '✅' : '⚠️'} ${r.cap.padEnd(16)} 档位 ${r.tier}${need}`)
  console.log(
    `      上限 ${mark(r.upperBound)} · 显式报错 ${mark(r.explicitError)} · 流式 ${mark(r.streaming)}` +
      ` · 背压 ${mark(r.backpressure)} · 资源账本 ${mark(r.resourceLedger)} · 并发上界 ${mark(r.tableBound)}`,
  )
}
console.log('')
console.log('  ★能力边界：本工具是**静态体检**——读源码结构证据，不能证明真实规模下不崩。')
console.log('    真实规模需要真机压测（大文件 / 百连接 / 长时跑）；本体检只回答"有没有为规模做设计的痕迹"。')
console.log('  ★不判红：规模档是排期输入，不是 CI 红绿。')
}
