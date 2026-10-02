<script setup lang="ts">
// website/src/pages/Consistency.vue —— ★★CS6：多端一致性标准（对外展示页）
//
// 【这一页是什么】把《Proteus 多端一致性标准方案》的对外部分 + **实时机器指标**公开展示——
//   标准 §12.4 要求"展示三件：标准本身 / 实时指标 / 证据链"。
//
// 【数据从哪来（★本页最重要的纪律）】页面内**零手写数字**——全部来自
//   `src/data/consistency-page.ts`（由 scripts/gen-consistency-data.mjs 从
//   docs/generated/*.json + allow-differences.json 生成；`pnpm check:consistency-data` 防漂移）。
//   数字会随产物更新，页面**不可能**说谎；"含不好看的数"（M1 覆盖率 + 存量债务）照样公开（标准 §6.2）。
//
// 【对外表述纪律（标准 §12.3 三条禁语）】本页遵守：
//   · 不说"逐像素一致"，说"可验证的一致性 + 量化指标"；
//   · 不说"不自绘"（易误解），说"绕开原生控件树、复用系统渲染管线"；
//   · 明确承认"像素绘制一致性不如 Flutter"——见对照表（短板主动摆出来，长板才有人信）。
//
// 【D-2 门禁】零 @media（走柔性网格 auto-fill/minmax）、零裸平台 API（图片走 public 静态资产，
//   不用 URL/fetch）——官网自身是 dogfooding 验证场，四规则零容忍。
import { computed } from 'vue'
import { locale } from '../i18n'
import DemoIcon from '../components/DemoIcon.vue'
import { CONSISTENCY_PAGE } from '../data/consistency-page'

const isEn = computed(() => locale.value === 'en')
const base = import.meta.env.BASE_URL || '/'
const D = CONSISTENCY_PAGE

const pct = (v: number): string => (v * 100).toFixed(1) + '%'

/** 端名（英文页用）——中文页直接用端显示名 */
const END_LABEL: Record<string, string> = {
  skyline: '微信 Skyline · WeChat Skyline',
  webview: '微信 WebView · WeChat WebView',
  web: '浏览器 · Browser',
  android: 'Android（真机 · device）',
  ios: 'iOS（模拟器 · simulator）',
  'ios-device': 'iOS（真机 · device）',
}

/** 核心指标卡（数字全部来自机器产物） */
const metrics = computed(() => [
  {
    icon: 'blocks',
    value: pct(D.m1.value),
    label: isEn.value ? 'M1 · numeric consistency coverage' : 'M1 · 数值一致性覆盖率',
    note: isEn.value
      ? `by-layer sum (L1 ${D.m1.byLayer.L1.covered} · L2 ${D.m1.byLayer.L2.covered} · L3 ${D.m1.byLayer.L3.covered}); union across layers ${pct(D.m1.union.value)}`
      : `分层加总（L1 ${D.m1.byLayer.L1.covered} · L2 ${D.m1.byLayer.L2.covered} · L3 ${D.m1.byLayer.L3.covered}）；任意层并集 ${pct(D.m1.union.value)}`,
  },
  {
    icon: 'bookmark',
    value: String(D.m2.value),
    label: isEn.value ? 'M2 · declared allowed differences' : 'M2 · 允许差异条目',
    note: isEn.value ? 'each entry carries a reason + evidence; fewer is better' : '每条必须有理由与证据；越少越好',
  },
  {
    icon: 'bolt',
    value: `${D.m4.captured}/${D.m4.injected}`,
    label: isEn.value ? 'M4 · mutation detection rate' : 'M4 · 一致性回归检出率',
    note: isEn.value
      ? `injected defects across ${D.m4.layers.length} layers, all caught · ${D.m4.pendingCount} pending`
      : `跨 ${D.m4.layers.length} 层注入缺陷，全部捕获 · ${D.m4.pendingCount} 个待布点`,
  },
  {
    icon: 'signal',
    value: String(D.pixel.pairs.length),
    label: isEn.value ? 'L4 · real pixel observation pairs' : 'L4 · 真截图像素观测对',
    note: isEn.value ? 'non-gating observation; screenshots from real renderers' : '非门禁观察；截图来自真实渲染器',
  },
])

/** 与 Flutter 的分维度诚实对照（标准 §3——主动承认短板） */
const compare = computed(() => [
  { dim: isEn.value ? 'Control-tree fragmentation' : '控件树碎片化', f: isEn.value ? 'Bypassed' : '绕开', p: isEn.value ? 'Bypassed' : '绕开', win: 'tie' },
  { dim: isEn.value ? 'Layout geometry' : '布局几何', f: isEn.value ? 'Dart, single point' : 'Dart 单点计算', p: isEn.value ? 'Rust, single point' : 'Rust 单点计算', win: 'tie' },
  { dim: isEn.value ? 'Text metrics' : '文本度量', f: isEn.value ? 'Unified but platform fallback' : '统一度量，但回退依赖平台', p: isEn.value ? 'Platform-injected' : '平台注入（StaticLayout / CoreText）', win: 'flutter' },
  { dim: isEn.value ? 'Pixel rasterization' : '像素绘制', f: isEn.value ? 'Self-drawn, unified' : '自绘统一', p: isEn.value ? 'System pipelines differ' : '系统管线，抗锯齿/阴影各异', win: 'flutter' },
  { dim: isEn.value ? 'Verifiability' : '可验证性', f: isEn.value ? 'Pixel goldens, officially flaky' : '像素 golden，官方承认跨端 flaky', p: isEn.value ? 'Numeric comparison, machine-judged' : '数值比对，机器判定', win: 'proteus' },
  { dim: isEn.value ? 'Difference enumerability' : '差异可枚举性', f: isEn.value ? 'Hard-coded platform switch' : '硬编码平台 switch', p: isEn.value ? 'Declarable, enumerable, testable' : '可声明、可枚举、可测试', win: 'proteus' },
  { dim: isEn.value ? 'Primitive space' : '差异空间大小', f: isEn.value ? 'CustomPainter open-ended' : 'CustomPainter 开放（可画任意内容）', p: isEn.value ? 'Closed set of primitives' : '封闭原语集', win: 'proteus' },
])

/** 证据链（标准 §10.3——每项主张指向机器产物） */
const evidence = computed(() => [
  { k: isEn.value ? 'L1 support matrix (28 fields × 3 ends)' : 'L1 支持度矩阵（28 字段 × 3 端实测）', v: 'end-support-matrix.json', gate: 'check:end-support' },
  { k: isEn.value ? 'L1 boundary rules (24, from official formats)' : 'L1 边界规则（官方 formats 派生 24 条）', v: 'skyline-boundary-rules.generated.ts', gate: 'check:profile-boundary' },
  { k: isEn.value ? 'Ratchet baselines (debt visible, only shrinks)' : '存量债务棘轮基线（可见且只减不增）', v: 'profile-boundary-baseline.json', gate: 'check:profile-baseline' },
  { k: isEn.value ? 'M1–M4 metrics' : 'M1–M4 指标', v: 'consistency-metrics.json', gate: 'check:consistency-metrics' },
  { k: isEn.value ? 'Allowed differences (M2)' : '允许差异清单（M2）', v: 'allow-differences.json', gate: 'schema in check:consistency-metrics' },
  { k: isEn.value ? 'L4 pixel observation report' : 'L4 像素观察报告', v: 'consistency-pixel-report.json', gate: 'check:consistency-pixel' },
])

function shotUrl(file: string): string {
  return `${base}consistency/${file}`
}

function pairLabel(id: string): string {
  // 去掉案例前缀（`l4:` / `sfc:`）——展示层只要"端 ⇄ 端"
  return id.replace(/^(l4|sfc):/, '').replace(/-vs-/, ' ⇄ ')
}

/** 配对形态标签（三档——残差量级不同，展示时必须区隔，避免"混读"） */
function pairModeLabel(mode: string | null): string {
  if (mode === 'same-runtime') return isEn.value ? 'same runtime' : '同运行时'
  if (mode === 'same-platform') return isEn.value ? 'device vs simulator' : '真机 ⇄ 模拟器'
  return isEn.value ? 'cross-runtime' : '跨运行时'
}
</script>

<template>
  <div class="cons">
    <!-- ═══ Hero ═══ -->
    <header class="cons-head">
      <span class="cons-eyebrow">{{ isEn ? 'Verifiable Consistency' : '可验证的一致性' }}</span>
      <h1 class="cons-title">
        {{ isEn ? 'Flutter assumes consistency. Proteus verifies it.' : 'Flutter 的一致性是被假定的，Proteus 的是被验证的。' }}
      </h1>
      <p class="cons-sub">
        {{
          isEn
            ? 'Cross-platform pixel-perfect identity is an illusion — even self-drawn engines fall short (a Skia upgrade once garbled Chinese fonts on whole device fleets). What the industry actually lacks is not "more consistency", but the ability to prove how consistent a framework is. Proteus defines that standard with machine-judged numbers.'
            : '跨端逐像素一致是伪命题——自绘引擎也做不到（一次 Skia 升级就让整批设备的中文字体崩坏）。行业真正缺的不是"更一致"，而是"能证明自己一致到什么程度"。Proteus 用机器判定把这个标准定义出来。'
        }}
      </p>
    </header>

    <!-- ═══ M1–M4 实时指标（数字全部来自机器产物） ═══ -->
    <section class="cons-sec">
      <p class="cons-sec-title">{{ isEn ? 'Live metrics' : '实时指标' }}</p>
      <p class="cons-sec-note">
        {{
          isEn
            ? 'Generated from the repository artifacts on every check — no hand-written numbers. Including the unflattering ones we refuse to hide.'
            : '每次校验从仓库机器产物重新生成——页面里没有一个手写数字。包括我们拒绝隐藏的、不好看的数。'
        }}
      </p>
      <div class="cons-grid">
        <article v-for="m in metrics" :key="m.label" class="cons-card">
          <DemoIcon class="cons-ic" :name="m.icon" />
          <p class="cons-value">{{ m.value }}</p>
          <p class="cons-label">{{ m.label }}</p>
          <p class="cons-note">{{ m.note }}</p>
        </article>
      </div>
    </section>

    <!-- ═══ ★★★SFC 压力测试（一份源码 → 多端渲染）═══ -->
    <section v-if="D.sfc" class="cons-sec cons-sfc">
      <p class="cons-sec-title">{{ isEn ? 'SFC stress test · one source file, four targets' : 'SFC 压力测试 · 一份源码，四端渲染' }}</p>
      <p class="cons-sec-note">
        {{
          isEn
            ? 'Not hand-written fixtures — one .vue file compiled/instantiated through three independent chains (Proteus compiler for Web & mini-program; Vapor artifacts for iOS & Android), each rendered by its own engine. 44 nodes: anchor + title + 10 rows (v-for with per-row dynamic chip width + text + dot) + footer.'
            : '不是手写夹具——同一个 .vue 文件经三条独立链（Web/小程序走 Proteus 编译器；iOS/Android 走 Vapor 编译产物 + 端上实例化），各端用自己的引擎渲染。44 节点：锚点 + 标题 + 10 行（v-for 行内动态 chip 宽 + 文字 + 圆点）+ 页脚。这是对"你们这是 SFC 渲染的吗"这类质疑的直接回答。'
        }}
      </p>
      <div class="cons-sfc-src"><code>{{ D.sfc.source }}</code></div>
      <div class="cons-shots">
        <figure v-for="s in D.sfc.shots" :key="s.end" class="cons-shot">
          <img class="cons-shot-img" :src="shotUrl(s.pub)" :alt="s.label" loading="lazy" />
          <figcaption class="cons-shot-cap">{{ s.label }}</figcaption>
        </figure>
      </div>
      <div class="cons-pairs">
        <div v-for="p in D.sfc.pairs" :key="p.id" class="cons-pair">
          <span class="cons-pair-head">{{ pairLabel(p.id) }}</span>
          <span class="cons-pair-mode" :class="p.mode">{{ pairModeLabel(p.mode) }}</span>
          <span class="cons-pair-val">
            {{ (p.diffRatio * 100).toFixed(2) }}%
            <span class="cons-pair-sub">{{ isEn ? 'pixels differ' : '像素差异' }} · hash {{ p.hashDistance }} · {{ p.verdict }}</span>
          </span>
        </div>
      </div>
      <p class="cons-note">
        {{
          isEn
            ? 'Residual differences are dominated by glyph rasterisation — the one structural difference the standard never claims to eliminate (§2). Layout, sizes and per-row dynamic widths match across all four targets.'
            : '剩余差异以字形栅格化为主——这正是标准里明确声明"不可消除"的那一项结构性差异（§2）。布局、尺寸与每行动态宽度四端一致。'
        }}
      </p>
    </section>

    <!-- ═══ 五端真截图（L4 像素观测） ═══ -->
    <section class="cons-sec">
      <p class="cons-sec-title">{{ isEn ? 'Pixel observation · one fixture, six real targets' : '像素观测 · 同一夹具，六种真实目标' }}</p>
      <p class="cons-sec-note">
        {{
          isEn
            ? 'One fixture (radius / shadow / gradient / glyph) under the same declarations, rendered by six real targets: WeChat Skyline, WeChat WebView, browser, Android device, iOS simulator, iOS device. Each screenshot is anchored to a common coordinate system by the fixture blue block (position + scale), colour-managed (Display P3 → sRGB), then compared with a perceptual algorithm (pHash + block-level diff). Device-vs-simulator (same OS) measures the device-level floor; cross-runtime measures the real spread. Observation only — never a gate.'
            : '同一夹具（圆角 / 阴影 / 渐变 / 字形）在同一组声明下，由六个真实目标渲染：微信 Skyline、微信 WebView、浏览器、Android 真机、iOS 模拟器、iOS 真机。每张截图按夹具蓝块锚定归一（位置 + 尺度两个自由度），做色彩管理（Display P3 → sRGB），再用感知算法比对（pHash + 分块差异定位）——**真机⇄模拟器（同 OS）测的是设备级底噪，跨运行时测的才是真实差距**。仅观察，永不作为门禁。'
        }}
      </p>
      <div class="cons-shots">
        <figure v-for="s in D.shots" :key="s.end" class="cons-shot">
          <img class="cons-shot-img" :src="shotUrl(s.pub)" :alt="s.label" loading="lazy" />
          <figcaption class="cons-shot-cap">{{ s.label }}</figcaption>
        </figure>
      </div>
      <!-- 归一记录：各端源分辨率/色彩空间/锚块/缩放——"怎么归到统一坐标系"的可复现证据 -->
      <div class="cons-norms">
        <span v-for="(n, end) in D.pixel.endNorm" :key="end" class="cons-norm">
          <b>{{ end }}</b>
          {{ n.srcSize.width }}×{{ n.srcSize.height }} → ×{{ n.scale }}
          <span v-if="n.colorSpace === 'display-p3'" class="cons-norm-cs">Display P3 → sRGB</span>
        </span>
      </div>
      <div class="cons-pairs">
        <div v-for="p in D.pixel.pairs" :key="p.id" class="cons-pair">
          <span class="cons-pair-head">{{ pairLabel(p.id) }}</span>
          <span class="cons-pair-mode" :class="p.mode">{{ pairModeLabel(p.mode) }}</span>
          <span class="cons-pair-val">
            {{ (p.diffRatio * 100).toFixed(2) }}%
            <span class="cons-pair-sub">{{ isEn ? 'pixels differ' : '像素差异' }} · hash {{ p.hashDistance }} · {{ p.verdict }}</span>
          </span>
          <span v-if="p.knownNoise" class="cons-pair-sub cons-known">{{ isEn ? 'known rasterization noise (declared)' : '已知光栅化噪声（已登记）' }}</span>
        </div>
      </div>
    </section>

    <!-- ═══ 允许差异清单（M2——"差异是数据，不是代码分支"的直接证据） ═══ -->
    <section class="cons-sec">
      <p class="cons-sec-title">{{ isEn ? 'Declared differences — data, not code branches' : '允许差异清单——差异是数据，不是代码分支' }}</p>
      <p class="cons-sec-note">
        {{
          isEn
            ? 'Flutter hard-codes platform differences into framework switches — developers cannot declare, enumerate or test them. Here every accepted difference is a data entry with a reason and evidence: anything on the list is not a failure; anything off the list is a bug.'
            : 'Flutter 把平台差异硬编码进框架 switch——开发者无法声明、无法枚举、无法测试。这里每一条被接受的差异都是一条带理由与证据的数据：清单内不判失败；清单外一律当 bug。'
        }}
      </p>
      <div class="cons-diffs">
        <div v-for="d in D.m2.items" :key="d.id" class="cons-diff">
          <span class="cons-diff-id">{{ d.id }}</span>
          <span class="cons-diff-cat">{{ d.category }}</span>
          <span class="cons-diff-title">{{ d.title }}</span>
          <span class="cons-diff-reason">{{ d.reason }}</span>
        </div>
      </div>
    </section>

    <!-- ═══ 与 Flutter 的诚实对照（承认短板） ═══ -->
    <section class="cons-sec">
      <p class="cons-sec-title">{{ isEn ? 'Honest comparison with Flutter' : '与 Flutter 的分维度诚实对照' }}</p>
      <p class="cons-sec-note">
        {{
          isEn
            ? 'Pixel rasterization: Flutter wins — it self-draws everything. Verifiability: we win — its pixel goldens are officially acknowledged as flaky across platforms. Shortcomings stated first.'
            : '像素绘制一致性：Flutter 更强——它全自绘。可验证性与差异可枚举性：我们更强——Flutter 的像素 golden 官方承认跨端不稳定。短板先摆出来。'
        }}
      </p>
      <div class="cons-table">
        <div class="cons-tr cons-th">
          <span>{{ isEn ? 'Dimension' : '维度' }}</span>
          <span>Flutter</span>
          <span>Proteus</span>
        </div>
        <div v-for="c in compare" :key="c.dim" class="cons-tr">
          <span class="cons-td-dim">{{ c.dim }}</span>
          <span class="cons-td" :class="{ win: c.win === 'flutter' }">{{ c.f }}</span>
          <span class="cons-td" :class="{ win: c.win === 'proteus' }">{{ c.p }}</span>
        </div>
      </div>
    </section>

    <!-- ═══ 证据链 ═══ -->
    <section class="cons-sec">
      <p class="cons-sec-title">{{ isEn ? 'Evidence chain' : '证据链' }}</p>
      <p class="cons-sec-note">
        {{
          isEn
            ? 'Every claim above points to a machine artifact kept in the repository, each guarded by a CI gate that fails on drift.'
            : '上面每一个主张都指向仓库里可查的机器产物，每一项都有 CI 门禁守着防漂移。'
        }}
      </p>
      <div class="cons-ev">
        <div v-for="e in evidence" :key="e.v" class="cons-ev-row">
          <span class="cons-ev-k">{{ e.k }}</span>
          <code class="cons-ev-v">{{ e.v }}</code>
          <span class="cons-ev-gate">{{ e.gate }}</span>
        </div>
      </div>
      <p class="cons-note cons-foot">
        {{ isEn ? 'Deliberately absent: any claim of pixel-perfect cross-platform identity.' : '刻意不写：任何"跨端逐像素一致"的宣称。' }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.cons { max-width: 1080px; margin: 0 auto; padding: 18px 0 46px; }
.cons-head { margin-bottom: 26px; }
.cons-eyebrow {
  display: inline-block;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 1px;
  color: var(--brand-ink);
  background: var(--brand-soft);
  border-radius: 999px;
  padding: 4px 12px;
}
.cons-title { color: var(--ink); font-size: 32px; font-weight: 800; line-height: 1.35; margin: 14px 0 0; max-width: 860px; }
.cons-sub { color: var(--muted); font-size: 14px; line-height: 1.8; margin: 12px 0 0; max-width: 760px; }

.cons-sec { margin-top: 30px; }
.cons-sec-title { color: var(--ink); font-size: 19px; font-weight: 800; margin: 0 0 6px; }
.cons-sec-note { color: var(--muted); font-size: 13px; line-height: 1.75; margin: 0 0 14px; max-width: 780px; }

.cons-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.cons-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
}
.cons-ic { font-size: 20px; line-height: 1; color: var(--brand-ink); }
.cons-value { color: var(--ink); font-size: 28px; font-weight: 800; margin: 2px 0 0; line-height: 1.1; }
.cons-label { color: var(--ink); font-size: 12.5px; font-weight: 700; margin: 0; }
.cons-note { color: var(--muted); font-size: 11.5px; line-height: 1.6; margin: 0; }

.cons-shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.cons-shot { margin: 0; display: flex; flex-direction: column; gap: 8px; }
.cons-shot-img {
  width: 100%;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--panel2);
}
/* ★SFC 区截图容器**限高 + 顶部对齐**（2026-10-02 实测的展示缺陷）：SFC 夹具是 375×800 竖屏，
   而各端源截图高宽比不同（Android 1200×2608 ≈ 2.17:1、Web 780×1688 ≈ 2.16:1、iOS 1206×2622
   ≈ 2.17:1——相近）**但内容只占上半屏**（SFC 高 800pt vs 屏 874pt）⇒ 等宽缩放后内容显得很小。
   限高 340px + object-fit: cover + object-position: top ⇒ **裁到内容区**（顶部对齐），
   四端内容以相近倍率呈现（对比更可读）。 */
.cons-sfc .cons-shot-img {
  height: 340px;
  object-fit: cover;
  object-position: top;
}
.cons-shot { align-items: center; }
.cons-shot-cap { color: var(--muted); font-size: 11.5px; text-align: center; }

.cons-sfc-src { margin-bottom: 12px; }
.cons-sfc-src code {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--brand-ink);
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px 12px;
}

.cons-norms { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.cons-norm {
  font-size: 11px;
  color: var(--muted);
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 5px 10px;
}
.cons-norm b { color: var(--ink); font-weight: 700; margin-right: 4px; }
.cons-norm-cs { color: var(--brand-ink); margin-left: 6px; }

.cons-pairs { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.cons-pair {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  padding: 10px 14px;
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.cons-pair-head { color: var(--ink); font-size: 12.5px; font-weight: 700; min-width: 180px; }
.cons-pair-mode {
  font-size: 10.5px;
  font-weight: 700;
  border-radius: 999px;
  padding: 2px 9px;
  color: var(--brand-ink);
  background: var(--brand-soft);
}
.cons-pair-val { color: var(--ink); font-size: 13px; font-weight: 700; }
.cons-pair-sub { color: var(--muted); font-size: 11px; font-weight: 400; margin-left: 6px; }

.cons-diffs { display: flex; flex-direction: column; gap: 6px; }
.cons-diff {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  padding: 9px 13px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--panel);
}
.cons-diff-id {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--brand-ink);
  background: var(--brand-soft);
  border-radius: 6px;
  padding: 2px 8px;
}
.cons-diff-cat { color: var(--muted); font-size: 10.5px; }
.cons-diff-title { color: var(--ink); font-size: 12.5px; font-weight: 700; min-width: 180px; }
.cons-diff-reason { color: var(--muted); font-size: 11.5px; flex: 1; min-width: 240px; line-height: 1.6; }

.cons-table { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.cons-tr {
  display: grid;
  grid-template-columns: 1.1fr 1.6fr 1.6fr;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
  background: var(--panel);
}
.cons-tr:first-child { border-top: none; }
.cons-th { background: var(--panel2); color: var(--brand-ink); font-size: 11.5px; font-weight: 800; letter-spacing: 0.4px; }
.cons-td-dim { color: var(--ink); font-size: 12.5px; font-weight: 700; }
.cons-td { color: var(--muted); font-size: 12px; line-height: 1.5; }
/* 该维度占优的一方加亮（诚实对照：强的一侧才被强调，不靠配色"美化"自己） */
.cons-td.win { color: var(--ink); font-weight: 600; }

.cons-ev { display: flex; flex-direction: column; gap: 6px; }
.cons-ev-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--panel);
}
.cons-ev-k { color: var(--ink); font-size: 12px; min-width: 260px; }
.cons-ev-v {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--brand-ink);
  background: var(--panel2);
  border-radius: 6px;
  padding: 2px 8px;
}
.cons-ev-gate { color: var(--muted); font-size: 10.5px; }
.cons-foot { margin-top: 14px; }
</style>
