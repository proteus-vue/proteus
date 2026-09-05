<script setup lang="ts">
// website/src/pages/MultiDevice.vue —— ★#489-B 高质量原生移植（以原版 flexible-multi-device.html 为唯一事实源）
// CSS 逐字照搬（scoped 限域）、六端模板照原版结构、数据双语；不做自由设计。
import { computed, ref } from 'vue'
import { locale, t } from '../i18n'

const demoUrl = import.meta.env.BASE_URL + 'flexible-multi-device.html'

const isEn = computed(() => locale.value === 'en')
interface Prod {
  name: string
  desc: string
  skus: string[]
  price: number
  related: { name: string; price: number }[]
  cart: string
  buy: string
  back: string
  home: string
  discover: string
  cartTab: string
  me: string
  shop: string
  audio: string
  hot: string
  orders: string
  settings: string
  relatedTitle: string
  voiceTitle: string
  continuePlay: string
  playLbl: string
  driveWarn: string
  hint: string
  forYou: string
  buyNow: string
  fav: string
  unboxing: string
  reviews: string
  shipping: string
  tradeIn: string
  priceLbl: string
  colorLbl: string
  crownNote: string
  add: string
}
const P: Record<'zh' | 'en', Prod> = {
  zh: {
    name: '无线降噪耳机 Pro',
    desc: '40h 续航 · 自适应降噪 · 空间音频 · 多设备秒切。Hi-Res 认证，通勤与办公场景全适配。',
    skus: ['曜石黑', '月光白', '雾霭蓝'], price: 1299,
    related: [{ name: '耳机保护套', price: 99 }, { name: 'Type-C 快充线', price: 59 }, { name: '替换耳塞套', price: 39 }, { name: '便携充电盒', price: 299 }],
    cart: '加入购物车', buy: '立即购买', back: '商品详情',
    home: '首页', discover: '发现', cartTab: '购物车', me: '我的',
    shop: '云端商城', audio: '音频', hot: '热销', orders: '订单', settings: '设置',
    relatedTitle: '相关推荐',
    voiceTitle: '语音购物 · 驾驶模式', continuePlay: '继续播放',
    playLbl: '降噪体验曲目 · 方向盘控制',
    driveWarn: '驾驶模式：大热区 + 焦点导航 · 详情长文已折叠 · 禁止细滚动',
    hint: '悬停卡片可预览详情 · Tab 键遍历全部可操作项',
    forYou: '为你推荐', buyNow: '立即购买', fav: '收藏',
    unboxing: '开箱视频', reviews: '用户评价', shipping: '配送说明', tradeIn: '以旧换新',
    priceLbl: '价格', colorLbl: '配色', crownNote: '表冠可切换', add: '加购',
  },
  en: {
    name: 'Proteus Buds Pro',
    desc: '40h battery · adaptive ANC · spatial audio · seamless multi-device switching. Hi-Res certified for commute & office.',
    skus: ['Obsidian', 'Moonlight', 'Mist Blue'], price: 1299,
    related: [{ name: 'Carrying case', price: 99 }, { name: 'Type-C cable', price: 59 }, { name: 'Ear tips', price: 39 }, { name: 'Charging box', price: 299 }],
    cart: 'Add to cart', buy: 'Buy now', back: 'Product detail',
    home: 'Home', discover: 'Discover', cartTab: 'Cart', me: 'Me',
    shop: 'Cloud store', audio: 'Audio', hot: 'Hot', orders: 'Orders', settings: 'Settings',
    relatedTitle: 'Related',
    voiceTitle: 'Voice shopping · drive mode', continuePlay: 'Keep playing',
    playLbl: 'ANC playlist · wheel control',
    driveWarn: 'Drive mode: big hit areas + focus nav · long copy folded · no fine scrolling',
    hint: 'Hover a card to preview · Tab walks every control',
    forYou: 'For you', buyNow: 'Buy now', fav: 'Wishlist',
    unboxing: 'Unboxing', reviews: 'Reviews', shipping: 'Shipping', tradeIn: 'Trade-in',
    priceLbl: 'Price', colorLbl: 'Color', crownNote: 'crown to switch', add: 'Add',
  },
}

interface Target {
  key: string
  ic: string
  nm: { zh: string; en: string }
  meta: { zh: string; en: string }
  form: { zh: string; en: string }
  nav: { zh: string; en: string }
  backend: { zh: string; en: string }
  ar: string
  maxW: number
  mediaAr: string
  notch: boolean
  caps: { ok: boolean; zh: string; en: string }[]
}
const TARGETS: Target[] = [
  {
    key: 'phone', ic: '📱', nm: { zh: '手机', en: 'Phone' }, meta: { zh: '竖屏 · 触控', en: 'portrait · touch' },
    form: { zh: 'portrait · 单手', en: 'portrait · one hand' }, nav: { zh: '底部 Tab', en: 'bottom tabs' },
    backend: { zh: 'NativeBackend（iOS/Android）', en: 'NativeBackend (iOS/Android)' },
    ar: '9/16', maxW: 300, mediaAr: '4/3', notch: true,
    caps: [{ ok: true, zh: 'SKU 全选', en: 'full SKU' }, { ok: true, zh: '底部 Tab', en: 'bottom tabs' }, { ok: false, zh: '悬停 → tap 高亮', en: 'hover → tap highlight' }],
  },
  {
    key: 'tablet', ic: '📲', nm: { zh: '平板', en: 'Tablet' }, meta: { zh: '横竖屏 · 触控', en: 'any · touch' },
    form: { zh: 'split 侧栏', en: 'split + rail' }, nav: { zh: '侧栏 + 双列', en: 'rail + 2 cols' },
    backend: { zh: 'NativeBackend（iPad/HarmonyPad）', en: 'NativeBackend (iPad/HarmonyPad)' },
    ar: '4/3', maxW: 460, mediaAr: '1/1', notch: false,
    caps: [{ ok: true, zh: '双列并排', en: 'two columns' }, { ok: true, zh: 'SKU 全选', en: 'full SKU' }],
  },
  {
    key: 'pc', ic: '🖥️', nm: { zh: 'PC / Mac', en: 'PC / Mac' }, meta: { zh: '鼠标键盘', en: 'mouse + kb' },
    form: { zh: 'desktop', en: 'desktop' }, nav: { zh: '侧栏 + 三列', en: 'side-nav + grid' },
    backend: { zh: 'VueDomBackend · CSS Grid', en: 'VueDomBackend · CSS Grid' },
    ar: '16/10', maxW: 560, mediaAr: '1/1', notch: false,
    caps: [{ ok: true, zh: '悬停态', en: 'hover' }, { ok: true, zh: '键盘可达', en: 'keyboard reachable' }],
  },
  {
    key: 'car', ic: '🚗', nm: { zh: '车机', en: 'In-car' }, meta: { zh: '旋钮 / d-pad', en: 'rotary / d-pad' },
    form: { zh: 'dashboard · 驾驶', en: 'dashboard · driving' }, nav: { zh: '焦点树', en: 'focus tree' },
    backend: { zh: 'NativeBackend（Harmony/AAOS）', en: 'NativeBackend (Harmony/AAOS)' },
    ar: '16/9', maxW: 520, mediaAr: '16/9', notch: false,
    caps: [{ ok: true, zh: '大热区', en: 'large hit areas' }, { ok: true, zh: '焦点导航', en: 'focus nav' }, { ok: false, zh: '详情长文（折叠）', en: 'long copy (folded)' }],
  },
  {
    key: 'tv', ic: '📺', nm: { zh: 'TV / 大屏', en: 'TV' }, meta: { zh: '10ft · 遥控', en: '10 ft · remote' },
    form: { zh: 'lean-back', en: 'lean-back' }, nav: { zh: '焦点行 + 海报流', en: 'focus rows' },
    backend: { zh: 'SkiaBackend / WebGL', en: 'SkiaBackend / WebGL' },
    ar: '16/9', maxW: 560, mediaAr: '16/9', notch: false,
    caps: [{ ok: true, zh: 'Hero + 海报流', en: 'hero + poster rows' }, { ok: false, zh: 'SKU 精简', en: 'condensed SKU' }],
  },
  {
    key: 'watch', ic: '⌚', nm: { zh: '手表', en: 'Watch' }, meta: { zh: '抬腕 · 表冠', en: 'glance · crown' },
    form: { zh: 'wearable', en: 'wearable' }, nav: { zh: '一屏一意', en: 'one screen' },
    backend: { zh: 'NativeBackend（WearOS/watchOS）', en: 'NativeBackend (WearOS/watchOS)' },
    ar: '1/1', maxW: 240, mediaAr: '1/1', notch: false,
    caps: [{ ok: true, zh: '一屏一意', en: 'one screen' }, { ok: true, zh: '表冠', en: 'crown' }, { ok: false, zh: 'SKU 精简', en: 'condensed SKU' }],
  },
]
const active = ref('phone')
const p = computed(() => P[isEn.value ? 'en' : 'zh'])
const target = computed(() => TARGETS.find((x) => x.key === active.value) ?? TARGETS[0]!)
const T = (v: { zh: string; en: string }) => (isEn.value ? v.en : v.zh)
const frameStyle = computed(() => ({ '--ar': target.value.ar, maxWidth: target.value.maxW + 'px' }))
const mediaStyle = computed(() => ({ '--media-ar': target.value.mediaAr }))
const y = (n: number) => '¥' + n
const relPairs = computed(() => {
  const r = p.value.related
  return [[r[0]!, r[1]!], [r[2]!, r[3]!]]
})
</script>

<template>
  <p-view class="six-root">
    <header class="hero">
      <h1>{{ isEn ? 'One ' : '同一份 ' }}<em>{{ isEn ? 'product page' : '商品详情页' }}</em>{{ isEn ? ', six terminals, each natively rendered' : '，六种终端，各自原生呈现' }}</h1>
      <p>{{ isEn ? 'The page below is a single source, never modified — switch any terminal; what changes is the RenderBackend’s rendering decisions, not your code. That is the real evidence of “one codebase, all targets”.' : '下面这份页面始终是一份文件、从未改动——切换任一终端，变化的是 RenderBackend 的渲染决策，不是你的代码。这才是「一套代码，多端呈现」的真实证据。' }}</p>
      <div class="badges">
        <span v-for="tk in TARGETS" :key="tk.key" class="badge">{{ tk.ic }} {{ T(tk.nm) }} <b>{{ T(tk.nav) }}</b></span>
      </div>
      <div class="claim">
        ✅ {{ isEn ? 'Source identical before/after switching · six terminals share the same product data · 100% of the difference comes from the Backend' : '源码切换前后完全相同 · 六端共享同一份商品数据 · 差异 100% 来自 Backend' }}
      </div>
    </header>

    <section class="stage-area">
      <!-- 设备选择器 -->
      <div class="devices">
        <button
          v-for="tk in TARGETS"
          :key="tk.key"
          type="button"
          class="dev-btn"
          :class="{ active: tk.key === active }"
          @click="active = tk.key"
        >
          <span class="ic">{{ tk.ic }}</span>
          <span class="nm">{{ T(tk.nm) }}</span>
          <span class="meta">{{ T(tk.meta) }}</span>
        </button>
      </div>

      <div class="stage-wrap">
        <div class="device-meta">
          <div><span>{{ isEn ? 'Current:' : '当前端：' }}</span> <b>{{ T(target.nm) }}</b></div>
          <span class="backend-tag">{{ T(target.backend) }}</span>
        </div>

        <!-- ★ 设备帧（容器比例 + max-width，零溢出；样式逐字来自原版） -->
        <div class="frame-host">
          <div class="frame" :class="{ 'has-notch': target.notch }" :style="frameStyle">
            <div v-if="target.notch" class="notch" style="width: 40%; height: 7px" />
            <div class="screen">
              <div class="statusbar"><span>9:41</span><span>📶 🔋</span></div>
              <div class="app-body">
                <!-- 📱 手机 -->
                <div v-if="target.key === 'phone'" class="ui with-tab">
                  <div class="ui-header"><span class="back">‹</span> {{ p.back }}</div>
                  <div class="prod-media" :style="mediaStyle"><span class="big">🎧</span><span>{{ p.name }}</span></div>
                  <div class="price"><span class="cur">¥</span>{{ p.price }}</div>
                  <div class="sku-row"><span v-for="(s, i) in p.skus" :key="i" class="sku" :class="{ on: i === 0 }">{{ s }}</span></div>
                  <div class="btn-primary">{{ p.cart }}</div>
                  <div class="btn-ghost">{{ p.buy }} →</div>
                  <div class="desc">{{ p.desc }}</div>
                  <div class="sec-title">{{ p.relatedTitle }}</div>
                  <div class="rec" style="grid-template-columns:repeat(2,1fr)">
                    <div v-for="(pair, i) in relPairs" :key="i">
                      <div v-for="r in pair" :key="r.name" class="rec-card"><span class="thumb">🎁</span><span><div class="tt">{{ r.name }}</div><div class="pp">{{ y(r.price) }}</div></span></div>
                    </div>
                  </div>
                  <div class="nav-tab">
                    <span class="t on">🏠 {{ p.home }}</span><span class="t">🔍 {{ p.discover }}</span><span class="t">🛒 {{ p.cartTab }}</span><span class="t">👤 {{ p.me }}</span>
                  </div>
                </div>
                <!-- 📲 平板 -->
                <div v-else-if="target.key === 'tablet'" class="ui split">
                  <div class="side">
                    <div class="brand-s">🎧 {{ p.shop }}</div>
                    <div class="item on">🏠 {{ p.home }}</div>
                    <div class="item">🎧 {{ p.audio }}</div>
                    <div class="item">🔥 {{ p.hot }}</div>
                    <div class="item">📦 {{ p.orders }}</div>
                    <div class="item">⚙️ {{ p.settings }}</div>
                  </div>
                  <div class="main">
                    <div class="ui-header">{{ p.name }}</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:start">
                      <div class="prod-media" :style="mediaStyle"><span class="big">🎧</span><span>{{ p.name }}</span></div>
                      <div>
                        <div class="price"><span class="cur">¥</span>{{ p.price }}</div>
                        <div class="sku-row"><span v-for="(s, i) in p.skus" :key="i" class="sku" :class="{ on: i === 0 }">{{ s }}</span></div>
                        <div class="btn-primary">{{ p.cart }}</div>
                      </div>
                    </div>
                    <div class="desc" style="margin-top:6px">{{ p.desc }}</div>
                    <div class="sec-title">{{ p.relatedTitle }}</div>
                    <div class="rec" style="grid-template-columns:repeat(2,1fr)">
                      <div v-for="(pair, i) in relPairs" :key="i">
                        <div v-for="r in pair" :key="r.name" class="rec-card"><span class="thumb">🎁</span><span><div class="tt">{{ r.name }}</div><div class="pp">{{ y(r.price) }}</div></span></div>
                      </div>
                    </div>
                  </div>
                </div>
                <!-- 🖥️ PC -->
                <div v-else-if="target.key === 'pc'" class="ui split">
                  <div class="side">
                    <div v-for="(it, i) in ['🏠 ' + p.home, '🎧 ' + p.audio, '🔥 ' + p.hot, '📦 ' + p.orders, '⚙️ ' + p.settings]" :key="i" class="item" :class="{ on: i === 0 }">{{ it }}</div>
                  </div>
                  <div class="main">
                    <div class="hover-hint">💡 {{ p.hint }}</div>
                    <div class="ui-header">{{ p.name }}</div>
                    <div class="pc-grid">
                      <div class="prod-media" :style="mediaStyle"><span class="big">🎧</span><span>{{ p.name }}</span></div>
                      <div>
                        <div class="price"><span class="cur">¥</span>{{ p.price }}</div>
                        <div class="sku-row"><span v-for="(s, i) in p.skus" :key="i" class="sku" :class="{ on: i === 0 }">{{ s }}</span></div>
                        <div class="pc-actions"><div class="btn-primary">{{ p.cart }}</div><div class="btn-ghost">{{ p.buy }}</div></div>
                        <div class="desc">{{ p.desc }}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <!-- 🚗 车机 -->
                <div v-else-if="target.key === 'car'" class="ui">
                  <div class="ui-header" style="color:#1a2a55">🛒 {{ p.voiceTitle }}</div>
                  <div class="prod-media" :style="mediaStyle"><span class="big">🎧</span><span>{{ p.name }}</span></div>
                  <div class="car-tile car-focus"><div class="big">{{ p.name }}</div><div class="lbl">{{ y(p.price) }} · {{ isEn ? 'say “add to cart”' : '说“加入购物车”即可下单' }}</div></div>
                  <div class="car-tile"><div class="big">🎵 {{ p.continuePlay }}</div><div class="lbl">{{ p.playLbl }}</div></div>
                  <div class="car-hint">⚠ {{ p.driveWarn }}</div>
                </div>
                <!-- 📺 TV -->
                <div v-else-if="target.key === 'tv'" class="ui tv-root">
                  <div class="tv-hero tv-focus">
                    <div class="t1">{{ p.name }}</div>
                    <div class="t2">{{ p.desc }}</div>
                    <div><span style="font-size:13px;font-weight:850;color:#ffb13d">¥{{ p.price }}</span></div>
                    <div style="display:flex;gap:6px">
                      <span style="font-size:9px;border:1px solid #fff;padding:2px 8px;border-radius:4px">▶ {{ p.buyNow }}</span>
                      <span style="font-size:9px;border:1px solid #fff;padding:2px 8px;border-radius:4px">＋ {{ p.fav }}</span>
                    </div>
                  </div>
                  <div class="sec-title" style="color:#fff">{{ p.forYou }}</div>
                  <div class="tv-row">
                    <span v-for="r in p.related" :key="r.name" class="tv-pill">🎁 {{ r.name }}<span class="pp">{{ y(r.price) }}</span></span>
                  </div>
                  <div class="tv-row">
                    <span class="tv-pill">🎬 {{ p.unboxing }}</span><span class="tv-pill">⭐ {{ p.reviews }}</span>
                    <span class="tv-pill">📦 {{ p.shipping }}</span><span class="tv-pill">🔄 {{ p.tradeIn }}</span>
                  </div>
                </div>
                <!-- ⌚ 手表 -->
                <div v-else class="ui watch-face">
                  <div class="watch-hero"><span class="big">🎧</span><span style="font-size:9px;color:#556">{{ p.name }}</span></div>
                  <div class="watch-pill">{{ p.priceLbl }} <b>¥{{ p.price }}</b></div>
                  <div class="watch-pill">{{ p.colorLbl }} <b>{{ p.skus[0] }}</b> · {{ p.crownNote }}</div>
                  <div class="watch-row">
                    <div class="btn-primary">🛒 {{ p.add }}</div>
                    <div class="btn-primary" style="background:#eef1f8;color:#556">❤️ {{ p.fav }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 端推导 + 能力声明 -->
        <div class="side-panel">
          <div class="sp-line"><span>{{ isEn ? 'Form' : '形态' }}</span><b>{{ T(target.form) }}</b></div>
          <div class="sp-line"><span>{{ isEn ? 'Input' : '输入' }}</span><b>{{ T(target.meta) }}</b></div>
          <div class="sp-line"><span>{{ isEn ? 'Nav' : '导航' }}</span><b>{{ T(target.nav) }}</b></div>
          <h4 class="cap-h">{{ isEn ? 'Capability declarations' : '能力声明' }}</h4>
          <div v-for="(c, i) in target.caps" :key="i" class="cap-line">
            <span class="st" :class="c.ok ? 'ok-s' : 'no-s'">{{ c.ok ? '✓' : '—' }}</span>{{ isEn ? c.en : c.zh }}
          </div>
        </div>
      </div>
    </section>

    <footer class="foot">
      <p><strong>{{ isEn ? 'The same source, six different shapes' : '同一份源码，六端渲染出不同形态' }}</strong> — {{ isEn ? 'differences come 100% from how each RenderBackend derives semantics, business code never changes. Breakpoints are semantic constraints, not CSS media queries — in-car / TV are driven by input (d-pad) and usage distance (10 ft), not pixels.' : '差异 100% 来自 RenderBackend 对语义的推导，业务源码零改动。断点是语义约束，不是 CSS 媒体查询——车机 / TV 由 input（d-pad）与 usage-distance（10ft）触发，而非屏幕像素。' }}</p>
      <div class="diff">
        <div class="d"><h5>❌ {{ isEn ? 'Traditional “responsive”' : '传统「响应式」' }}</h5><p>{{ isEn ? 'Same DOM + CSS media queries — desktop page only shrinks/folds to small screens. Watch/in-car are unusable.' : '同一份 DOM + CSS 媒体查询，只是把桌面页面缩放/折叠到小屏。' }}</p></div>
        <div class="d"><h5>❌ {{ isEn ? 'Multi-platform via #ifdef' : '小程序多端 #ifdef' }}</h5><p>{{ isEn ? 'Conditional compilation per target — code grows linearly with targets, one logic scattered across N places.' : '靠 #ifdef 条件编译为每个端写分支，代码量随端数线性膨胀。' }}</p></div>
        <div class="d"><h5>✅ {{ isEn ? 'Proteus' : 'Proteus 柔性框架' }}</h5><p>{{ isEn ? 'One semantic SFC + multiple Backend implementations. Topology, navigation and input are derived from the form factor — no if (isPhone).' : '一份语义 SFC + 多 Backend 实现。布局拓扑、导航范式、输入方式由端形态推导，业务代码不写任何 if (isPhone)。' }}</p></div>
      </div>
      <p class="alt"><a :href="demoUrl">{{ isEn ? 'Original standalone demo (iframe embed) →' : '原版独立演示（iframe 嵌入版）→' }}</a></p>
    </footer>
  </p-view>
</template>

<style scoped>
/* —— 主题变量（原版 :root → 作用域容器；其余规则逐字照搬） —— */
.six-root {
  --bg: #0b1020; --panel: #121933; --card: #1a2344; --line: #2a365e;
  --txt: #e8ecf7; --sub: #93a0c2; --brand: #5b8cff; --brand2: #39d0c4;
  --ios: #5b8cff; --android: #3ddc84; --harmony: #ffb13d; --web: #7c8cff;
  --warn: #ff8b5b; --ok: #39d0c4;
  --device-phone: #0d1530; --device-tablet: #111c40; --device-pc: #0f1838;
  --device-car: #1a1208; --device-tv: #0a1024; --device-watch: #0d0d18;
  --border-soft: #dde; --ink-soft: #556; --sub-soft: #889;
  background: var(--bg); color: var(--txt);
  font-family: 'WenQuanYi Micro Hei', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  line-height: 1.6;
  border-radius: 18px;
}
/* 原版 hero / badges / claim */
.hero { padding: 22px 4px 8px; text-align: center; }
.hero h1 { font-size: 24px; font-weight: 850; line-height: 1.3; margin-bottom: 8px; }
.hero h1 em { font-style: normal; color: var(--brand2); }
.hero p { color: var(--sub); max-width: 780px; margin: 0 auto; font-size: 13px; }
.badges { margin-top: 12px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.badge { font-size: 11.5px; padding: 4px 11px; border: 1px solid var(--line); border-radius: 999px; color: var(--sub); }
.badge b { color: var(--brand2); }
.claim { margin-top: 14px; display: inline-flex; align-items: center; gap: 10px; background: rgba(57, 208, 196, 0.1); border: 1px solid rgba(57, 208, 196, 0.35); border-radius: 12px; padding: 9px 16px; font-size: 12px; color: var(--brand2); }
.stage-area { padding: 4px 0 8px; }
.devices { display: grid; grid-template-columns: repeat(6, 1fr); gap: 7px; margin-bottom: 12px; }
.dev-btn { padding: 9px 4px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--sub); cursor: pointer; font-size: 12px; transition: 0.15s; display: flex; flex-direction: column; align-items: center; gap: 3px; font-family: inherit; }
.dev-btn:hover { border-color: var(--brand); }
.dev-btn.active { border-color: var(--brand); background: rgba(91, 140, 255, 0.16); color: var(--txt); }
.dev-btn .ic { font-size: 17px; }
.dev-btn .nm { font-weight: 700; }
.dev-btn .meta { font-size: 9.5px; opacity: 0.75; }
.stage-wrap { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.device-meta { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--sub); gap: 10px; flex-wrap: wrap; }
.device-meta b { color: var(--txt); }
.backend-tag { font-size: 10px; padding: 2px 8px; border-radius: 6px; background: rgba(57, 208, 196, 0.14); color: var(--brand2); font-weight: 700; text-align: center; }
.frame-host { width: 100%; display: flex; align-items: center; justify-content: center; min-height: 360px; padding: 6px; }
.frame { position: relative; width: 100%; transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1); margin: 0 auto; }
.notch { position: absolute; top: 0; left: 50%; transform: translateX(-50%); background: #000; border-radius: 0 0 12px 12px; z-index: 5; }
.screen { width: 100%; aspect-ratio: var(--ar, 9/16); background: #f6f8fc; overflow: hidden; display: flex; flex-direction: column; color: #1a2238; box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45); border: 2px solid #2a365e; border-radius: 14px; }
.frame.has-notch .screen { border-top-left-radius: 22px; border-top-right-radius: 22px; }
.statusbar { height: 22px; background: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; font-size: 9px; color: #556; border-bottom: 1px solid #eef0f6; flex-shrink: 0; }
.app-body { flex: 1; overflow: hidden; position: relative; }
/* 通用 UI 原子 */
.ui { height: 100%; padding: 9px; overflow: hidden; }
.ui-header { font-weight: 800; font-size: 12px; margin-bottom: 7px; color: #1a2a55; display: flex; align-items: center; gap: 6px; }
.ui-header .back { color: #667; font-weight: 400; }
.prod-media { width: 100%; aspect-ratio: var(--media-ar, 4/3); border-radius: 8px; background: linear-gradient(135deg, #eef2ff, #e6fbff); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #556; font-size: 10px; margin-bottom: 8px; }
.prod-media .big { font-size: 26px; }
.price { font-size: 18px; font-weight: 850; color: #e05b5b; margin-bottom: 6px; }
.price .cur { font-size: 11px; }
.sku-row { display: flex; gap: 6px; margin-bottom: 7px; flex-wrap: wrap; }
.sku { border: 1px solid var(--border-soft); border-radius: 6px; padding: 4px 8px; font-size: 9px; color: var(--ink-soft); }
.sku.on { border-color: var(--brand); color: var(--brand); background: #eef3ff; font-weight: 700; }
.btn-primary { background: var(--brand); color: #fff; border: none; border-radius: 8px; padding: 9px; text-align: center; font-size: 11px; font-weight: 700; margin-bottom: 7px; }
.btn-ghost { background: #eef1f8; color: #556; border: none; border-radius: 8px; padding: 8px; text-align: center; font-size: 10px; }
.sec-title { font-size: 10px; font-weight: 800; color: #1a2a55; margin: 7px 0 5px; }
.desc { font-size: 9.5px; color: #667; line-height: 1.55; }
.rec { display: grid; gap: 6px; }
.rec-card { background: #fff; border-radius: 8px; padding: 6px; box-shadow: 0 2px 6px rgba(20, 40, 90, 0.07); display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.rec-card .thumb { width: 34px; height: 34px; border-radius: 6px; flex-shrink: 0; background: linear-gradient(135deg, #eef2ff, #e6fbff); display: flex; align-items: center; justify-content: center; font-size: 9px; color: #556; }
.rec-card .tt { font-size: 9.5px; font-weight: 700; }
.rec-card .pp { font-size: 9px; color: #e05b5b; font-weight: 700; }
.nav-tab { position: absolute; left: 0; right: 0; bottom: 0; display: flex; gap: 4px; padding: 6px 8px; background: #fff; border-top: 1px solid #eef0f6; }
.nav-tab .t { flex: 1; text-align: center; font-size: 8.5px; padding: 4px 2px; border-radius: 6px; color: #889; }
.nav-tab .t.on { color: var(--brand); font-weight: 700; }
.ui.with-tab { padding-bottom: 44px; }
.split { display: flex; gap: 8px; height: 100%; }
.side { width: 34%; flex-shrink: 0; background: #fff; border-right: 1px solid #eef0f6; padding: 8px; }
.side .item { padding: 7px 8px; border-radius: 6px; font-size: 9.5px; color: #556; margin-bottom: 3px; }
.side .item.on { background: #eef3ff; color: var(--brand); font-weight: 700; }
.side .brand-s { font-weight: 850; font-size: 11px; color: #1a2a55; margin-bottom: 8px; }
.main { flex: 1; padding: 2px 4px; overflow: hidden; }
.pc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pc-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-bottom: 8px; }
.hover-hint { font-size: 8.5px; color: var(--brand); background: #eef3ff; padding: 4px 7px; border-radius: 6px; margin-bottom: 6px; }
.car-focus { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 10px; }
.car-tile { background: #fff; border-radius: 10px; padding: 12px; margin-bottom: 9px; text-align: center; }
.car-tile .big { font-size: 17px; font-weight: 850; color: #1a2a55; }
.car-tile .lbl { font-size: 9px; color: #667; margin-top: 3px; }
.car-hint { font-size: 9px; color: var(--warn); text-align: center; margin-top: 4px; }
.tv-root { background: #0f1838; color: #fff; padding: 10px; }
.tv-hero { width: 100%; aspect-ratio: 16/7; background: linear-gradient(135deg, #1a2a55, #0d1530); border-radius: 10px; display: flex; flex-direction: column; justify-content: flex-end; padding: 12px; gap: 5px; margin-bottom: 9px; }
.tv-hero .t1 { font-size: 15px; font-weight: 850; }
.tv-hero .t2 { font-size: 8.5px; color: #bcd; max-width: 75%; }
.tv-row { display: flex; gap: 7px; margin-bottom: 7px; }
.tv-pill { flex: 1; aspect-ratio: 16/9; background: rgba(255, 255, 255, 0.12); border-radius: 7px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 8px; color: #cde; gap: 2px; }
.tv-pill .pp { color: #ffb13d; font-weight: 700; }
.tv-focus { outline: 3px solid var(--brand); outline-offset: 3px; border-radius: 9px; }
.watch-face { display: flex; flex-direction: column; gap: 7px; }
.watch-hero { width: 100%; aspect-ratio: 1; border-radius: 12px; background: linear-gradient(135deg, #eef2ff, #e6fbff); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
.watch-hero .big { font-size: 22px; }
.watch-row { display: flex; gap: 6px; }
.watch-row .btn-primary { flex: 1; padding: 10px; font-size: 10px; border-radius: 10px; margin-bottom: 0; }
.watch-pill { background: #fff; border-radius: 10px; padding: 8px 10px; font-size: 9px; color: #556; margin-bottom: 5px; }
.watch-pill b { color: #e05b5b; font-size: 12px; }
.side-panel { border-top: 1px dashed var(--line); padding-top: 10px; display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; }
.sp-line { font-size: 11px; color: var(--sub); display: flex; gap: 6px; align-items: center; }
.sp-line span { color: var(--dim); text-transform: uppercase; font-size: 10px; letter-spacing: 0.4px; }
.sp-line b { color: var(--txt); }
.cap-h { font-size: 10px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.8px; margin: 0 0 0 6px; }
.cap-line { display: flex; align-items: center; gap: 5px; font-size: 11px; padding: 2px 0; color: var(--sub); }
.cap-line .st { width: 14px; height: 14px; border-radius: 4px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 9px; color: #fff; }
.ok-s { background: var(--ok); }
.no-s { background: var(--warn); }
/* footer */
.foot { padding: 4px 0 20px; text-align: center; color: var(--sub); font-size: 12px; max-width: 860px; margin: 0 auto; }
.foot .alt { margin-top: 12px; font-size: 11.5px; }
.foot .alt a { color: var(--brand2); }
.diff { margin-top: 12px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; text-align: left; }
.diff .d { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
.diff .d h5 { font-size: 12px; color: var(--brand2); margin-bottom: 5px; }
.diff .d p { font-size: 11px; line-height: 1.6; color: var(--sub); }
@media (max-width: 1080px) { .devices { grid-template-columns: repeat(3, 1fr); } .diff { grid-template-columns: 1fr; } }
</style>
