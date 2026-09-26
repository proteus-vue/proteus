<script setup lang="ts">
// ══════════════════════════════════════════════════════════════════════════════
// 柔性系统演示源 —— 同一份源码，六端形态（多端同屏页左栏展示的就是本文件的真实源码）
//
// 两条柔性机制（都在本文件里真实生效，页面上是真执行不是示意图）：
//   ① 容器断点（p-zone）：按**容器宽度**（不是视口）选命名槽——手表 sm / 手机 md /
//      折叠 lg / 宽屏 xl；`<template #sm>` 里是完全不同的布局，不是同一布局缩放。
//   ② 能力声明（caps）：端声明不支持的能力走**降级分支**（v-if="caps.xxx"）——
//      手表无底部 Tab、车机无 SKU 多选（条件降级）、TV 用焦点行而非 hover。
//
// 端注册表（端能力表实现在宿主——此处由本页按端注入；真实项目里来自端 profile）
// ══════════════════════════════════════════════════════════════════════════════
import { ref } from 'vue'

const props = defineProps<{
  /** 输入形态：触控 / 鼠标 / 遥控器 / 表冠（能力声明的一部分） */
  form: 'touch' | 'cursor' | 'remote' | 'dial'
  /** 端能力声明：缺省 = 该端声明不支持该能力（走降级分支，不静默失败） */
  caps?: { tabs?: boolean; rail?: boolean; focusRows?: boolean; dense?: boolean }
}>()

const product = {
  name: '无线降噪耳机 Pro',
  price: 1299,
  desc: '40h 续航 · 自适应降噪 · 空间音频',
}
const skus = ['曜石黑', '月光白', '雾霾蓝']
const picked = ref('曜石黑')
const counted = ref(1)
</script>

<template>
  <p-zone :design-width="375" class="fp">
    <!-- ── sm（手表 198px · 表冠形态）：一屏一意 —— 只有名称 / 价格 / 主操作 ── -->
    <template #sm>
      <div class="fp-watch">
        <span class="fp-watch-name">{{ product.name }}</span>
        <strong class="fp-price">¥{{ product.price }}</strong>
        <button class="fp-big" @click="counted++">{{ counted > 1 ? '已加购 ' + counted : '加购' }}</button>
        <span v-if="form === 'dial'" class="fp-hint">↕ 表冠滚动</span>
      </div>
    </template>

    <!-- ── md（手机 390px · 触控）：竖屏单列 —— 大图 / SKU / 双按钮 / 底部 Tab ── -->
    <template #md>
      <div class="fp-phone">
        <div class="fp-cover">🎧</div>
        <h3 class="fp-name">{{ product.name }}</h3>
        <span class="fp-desc">{{ product.desc }}</span>
        <strong class="fp-price">¥{{ product.price }}</strong>
        <div class="fp-skus">
          <span v-for="s in skus" :key="s" class="fp-sku" :class="{ on: picked === s }" @click="picked = s">{{ s }}</span>
        </div>
        <div class="fp-btns">
          <button class="fp-primary" @click="counted++">加入购物车</button>
          <button class="fp-ghost">立即购买</button>
        </div>
        <!-- 能力声明：手表/车机声明 tabs=false → 不渲染（降级分支可见） -->
        <nav v-if="caps?.tabs" class="fp-tabbar">
          <span class="on">首页</span><span>发现</span><span>购物车</span><span>我的</span>
        </nav>
      </div>
    </template>

    <!-- ── lg（折叠屏 / 小平板 469-608px）：图 + 详情双列 —— 过渡形态 ── -->
    <template #lg>
      <div class="fp-duo">
        <div class="fp-cover fp-cover--duo">🎧</div>
        <div class="fp-body">
          <h3 class="fp-name">{{ product.name }}</h3>
          <span class="fp-desc">{{ product.desc }}</span>
          <strong class="fp-price">¥{{ product.price }}</strong>
          <div class="fp-skus">
            <span v-for="s in skus" :key="s" class="fp-sku" :class="{ on: picked === s }" @click="picked = s">{{ s }}</span>
          </div>
          <button class="fp-primary" @click="counted++">加入购物车</button>
        </div>
      </div>
    </template>

    <!-- ── xl（平板 / PC / 车机 / TV，≥609px）：侧栏 + 主体 —— 形态由能力声明分岔 ── -->
    <template #xl>
      <div class="fp-wide">
        <!-- 能力声明：PC/平板声明 rail=true（侧栏）；手机/手表/TV 无侧栏 -->
        <aside v-if="caps?.rail" class="fp-rail">
          <span class="fp-brand">🎧 云端商城</span>
          <span class="on">首页</span><span>音频</span><span>订单</span><span>设置</span>
        </aside>
        <div class="fp-main">
          <!-- 遥控器形态（车机 / TV）：横向焦点行（海报流）+ 大热区——d-pad 可达 -->
          <template v-if="caps?.focusRows">
            <div class="fp-hero">
              <div class="fp-cover fp-cover--hero">🎧</div>
              <div class="fp-hero-info">
                <h3 class="fp-name">{{ product.name }}</h3>
                <strong class="fp-price">¥{{ product.price }}</strong>
                <span class="fp-desc">{{ product.desc }}</span>
                <!-- 能力声明：车机 form=remote → 大焦点按钮；焦点态由 d-pad 语义驱动 -->
                <div class="fp-btns">
                  <button class="fp-primary fp-focus" @click="counted++">▶ 加入购物车</button>
                  <button class="fp-ghost">＋ 收藏</button>
                </div>
              </div>
            </div>
            <h4 class="fp-rail-title">为你推荐 · 焦点行</h4>
            <div class="fp-focus-row">
              <div v-for="i in 5" :key="i" class="fp-card">
                <span class="fp-card-ic">🎵</span>
                <span class="fp-card-name">推荐 {{ i }}</span>
                <span class="fp-card-pt">¥{{ 199 * i }}</span>
              </div>
            </div>
          </template>
          <!-- 触控 / 鼠标形态（平板 / PC）：多列图文 + SKU（车机声明无 SKU 多选 → 此处不达） -->
          <template v-else>
            <div class="fp-cols">
              <div class="fp-cover fp-cover--col">🎧</div>
              <div class="fp-body">
                <h3 class="fp-name">{{ product.name }}</h3>
                <span class="fp-desc">{{ product.desc }}</span>
                <strong class="fp-price">¥{{ product.price }}</strong>
                <div class="fp-skus">
                  <span v-for="s in skus" :key="s" class="fp-sku" :class="{ on: picked === s }" @click="picked = s">{{ s }}</span>
                </div>
                <div class="fp-btns">
                  <button class="fp-primary" @click="counted++">加入购物车</button>
                  <button class="fp-ghost">立即购买</button>
                </div>
                <!-- 鼠标形态：hover 提示（TV/车机无 hover → 不渲染） -->
                <span v-if="form === 'cursor'" class="fp-hint">💻 悬停查看详情（hover 态）</span>
              </div>
              <div class="fp-aside">
                <span class="fp-aside-t">服务</span>
                <span>7 天无理由</span><span>顺丰包邮</span><span>一年保修</span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>
  </p-zone>
</template>

<style scoped>
.fp { background: #f7f8fa; color: #17171f; height: 100%; overflow: hidden; font-size: 13px; }

/* ── sm：手表 ── */
.fp-watch { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 14px 12px; text-align: center; }
.fp-watch-name { font-size: 11px; color: #666; }
.fp-big { width: 92px; height: 44px; border: none; border-radius: 22px; background: #7c5cff; color: #fff; font-size: 14px; font-weight: 800; }
.fp-hint { font-size: 10px; color: #999; }

/* ── md：手机 ── */
.fp-phone { height: 100%; overflow-y: auto; padding: 14px 14px 0; display: flex; flex-direction: column; gap: 8px; }
.fp-cover { height: 128px; border-radius: 12px; background: linear-gradient(135deg, #eef0ff, #e3e7f8); display: grid; place-items: center; font-size: 44px; }
.fp-name { margin: 0; font-size: 16px; font-weight: 800; }
.fp-desc { color: #777; font-size: 11.5px; }
.fp-price { font-size: 22px; font-weight: 800; color: #7c5cff; }
.fp-skus { display: flex; flex-wrap: wrap; gap: 7px; }
.fp-sku { padding: 7px 11px; border: 1px solid #ddd; border-radius: 8px; background: #fff; font-size: 11.5px; }
.fp-sku.on { border-color: #7c5cff; color: #7c5cff; font-weight: 700; }
.fp-btns { display: flex; gap: 8px; }
.fp-primary { flex: 1; padding: 11px; border: none; border-radius: 9px; background: #7c5cff; color: #fff; font-size: 13px; font-weight: 700; }
.fp-ghost { flex: 0 0 auto; padding: 11px 14px; border: 1px solid #7c5cff; border-radius: 9px; background: #fff; color: #7c5cff; font-size: 13px; font-weight: 700; }
.fp-tabbar { margin-top: auto; display: flex; border-top: 1px solid #e6e8f0; padding: 8px 0 10px; }
.fp-tabbar span { flex: 1; text-align: center; font-size: 11px; color: #999; }
.fp-tabbar .on { color: #7c5cff; font-weight: 800; }

/* ── lg：双列 ── */
.fp-duo { height: 100%; display: grid; grid-template-columns: 210px 1fr; gap: 14px; padding: 14px; }
.fp-cover--duo { height: 100%; }
.fp-body { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }

/* ── xl：宽屏（侧栏 + 主体） ── */
.fp-wide { height: 100%; display: flex; }
.fp-rail { width: 132px; flex-shrink: 0; background: #fff; border-right: 1px solid #e6e8f0; display: flex; flex-direction: column; gap: 4px; padding: 12px 10px; }
.fp-brand { font-size: 11.5px; font-weight: 800; margin-bottom: 8px; }
.fp-rail span { padding: 8px 10px; border-radius: 7px; color: #666; font-size: 12px; }
.fp-rail .on { background: #f0edff; color: #7c5cff; font-weight: 700; }
.fp-main { flex: 1; min-width: 0; overflow-y: auto; padding: 14px; }
.fp-hero { display: grid; grid-template-columns: 200px 1fr; gap: 16px; }
.fp-cover--hero { height: 148px; }
.fp-hero-info { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.fp-focus { border-radius: 10px; padding: 13px 26px; font-size: 15px; box-shadow: 0 0 0 3px rgba(124, 92, 255, 0.28); }
.fp-rail-title { margin: 16px 0 8px; font-size: 13px; color: #555; }
.fp-focus-row { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 6px; }
.fp-card { flex: 0 0 108px; background: #fff; border: 1px solid #e6e8f0; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 5px; align-items: center; }
.fp-card-ic { font-size: 26px; }
.fp-card-name { font-size: 11px; color: #555; }
.fp-card-pt { font-size: 12px; font-weight: 800; color: #7c5cff; }
.fp-cols { display: grid; grid-template-columns: 220px 1fr 130px; gap: 16px; }
.fp-cover--col { height: 170px; }
.fp-aside { display: flex; flex-direction: column; gap: 7px; font-size: 11.5px; color: #666; background: #fff; border: 1px solid #e6e8f0; border-radius: 10px; padding: 12px; height: fit-content; }
.fp-aside-t { font-weight: 800; color: #17171f; }
</style>
