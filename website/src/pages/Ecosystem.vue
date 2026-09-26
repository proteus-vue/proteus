<script setup lang="ts">
// website/src/pages/Ecosystem.vue —— 生态页（2026-09-26 P0-3）
// 对标 Flutter Showcase / RN Who's using——框架官网的标志性栏目。
// ★诚实边界：无第三方用户案例前，以「官方工程案例」形态起步（本站本身/演示站/多端同屏
//   /脚手架工程）——每个案例都开源可查，不做不可验证的宣称；「你的项目」卡为诚实占位。
import { computed } from 'vue'
import { locale } from '../i18n'

const isEn = computed(() => locale.value === 'en')

const cases = computed(() => [
  {
    icon: '🌐',
    title: isEn.value ? 'This website' : 'Proteus 官网本身',
    desc: isEn.value
      ? 'The site you are reading is built with Proteus itself — p-grid is rendering this page right now. Fluid layout with zero @media, docs compiled from markdown at build time.'
      : '你正在读的这页就是用 Proteus 构建的——p-grid 正在渲染眼前的页面。柔性布局零 @media；文档 md 由 @proteus-vue/docs 引擎构建期编译。',
    tags: isEn.value ? ['dogfooding', 'fluid layout', 'docs engine'] : ['dogfooding', '柔性布局', '文档引擎'],
    link: '/',
    linkText: isEn.value ? 'View home' : '回到首页',
  },
  {
    icon: '🧩',
    title: isEn.value ? 'Showcase demo app' : 'Showcase 演示站',
    desc: isEn.value
      ? '73 component pages with live interactive demos, plus capability demos — one Vue source compiled to Web and WeChat mini-program (Skyline). It also powers the live demo embedded in every component doc page.'
      : '73 个组件详情页（真交互演示）+ 能力演示——同一份 Vue 源码编译到 Web 与微信小程序（Skyline）双端；也是组件文档「在线演示」的内核。',
    tags: isEn.value ? ['73 components', 'Web + Skyline', 'same source'] : ['73 组件', 'Web + Skyline', '双端同源'],
    link: '/docs/component/00-components-overview',
    linkText: isEn.value ? 'Browse components' : '浏览组件',
  },
  {
    icon: '📱',
    title: isEn.value ? 'Multi-device demo' : '多端同屏',
    desc: isEn.value
      ? 'One product-detail page rendered into six form factors — phone / tablet / PC / in-car / TV / watch. Switch the device and watch the render decision change, not your code.'
      : '同一份商品详情页渲染成六种终端形态——手机 / 平板 / PC / 车机 / TV / 手表。切换设备看渲染决策的变化，而不是你的代码。',
    tags: isEn.value ? ['6 form factors', 'render backend'] : ['六端形态', '渲染后端'],
    link: '/multi-device',
    linkText: isEn.value ? 'Open demo' : '打开演示',
  },
  {
    icon: '⚡',
    title: isEn.value ? 'create-proteus scaffold' : 'create-proteus 脚手架工程',
    desc: isEn.value
      ? 'One command generates a 32-file dual-target project (Web + WeChat mini-program): compile pipeline, router, runtime, app skeleton — everything the docs describe, ready to run.'
      : '一条命令生成 32 文件的双端工程（Web + 微信小程序）：编译管线、路由、运行时、应用骨架——文档描述的一切，开箱即跑。',
    tags: isEn.value ? ['scaffold', '32 files'] : ['脚手架', '32 文件'],
    code: 'npm create @proteus-vue/proteus my-app',
  },
])
</script>

<template>
  <div class="eco">
    <header class="eco-head">
      <span class="eco-eyebrow">{{ isEn ? 'Ecosystem' : '生态' }}</span>
      <h1 class="eco-title">{{ isEn ? 'Built with Proteus' : '用 Proteus 构建的工程' }}</h1>
      <p class="eco-sub">
        {{
          isEn
            ? 'The ecosystem is growing — starting from official engineering projects. Every case below is open source and verifiable; no unverifiable claims.'
            : '生态成长中——先从官方工程案例起步。以下每个案例都开源可查，不做不可验证的宣称。'
        }}
      </p>
    </header>

    <div class="eco-grid">
      <article v-for="c in cases" :key="c.title" class="eco-card">
        <span class="eco-icon" aria-hidden="true">{{ c.icon }}</span>
        <h2 class="eco-card-title">{{ c.title }}</h2>
        <p class="eco-card-desc">{{ c.desc }}</p>
        <p class="eco-tags">
          <span v-for="t in c.tags" :key="t" class="eco-tag">{{ t }}</span>
        </p>
        <p v-if="c.code" class="eco-code"><code>{{ c.code }}</code></p>
        <router-link v-if="c.link" :to="c.link" class="eco-link">{{ c.linkText }} →</router-link>
      </article>

      <!-- 诚实占位：生态成长中 -->
      <article class="eco-card eco-card--placeholder">
        <span class="eco-icon" aria-hidden="true">🚀</span>
        <h2 class="eco-card-title">{{ isEn ? 'Your project here' : '你的项目' }}</h2>
        <p class="eco-card-desc">
          {{
            isEn
              ? 'Building something with Proteus? Open an issue with your project — real-world cases (and the friction you hit) directly shape the roadmap.'
              : '在用 Proteus 做东西？开一个 issue 告诉我们——真实案例（以及你踩到的摩擦）会直接影响路线图。'
          }}
        </p>
        <a
          class="eco-link"
          href="https://github.com/proteus-vue/proteus/issues"
          target="_blank"
          rel="noreferrer"
        >{{ isEn ? 'Submit via Issues ↗' : '通过 Issues 提交 ↗' }}</a>
      </article>
    </div>
  </div>
</template>

<style scoped>
.eco { max-width: 1080px; margin: 0 auto; padding: 18px 0 46px; }
.eco-head { margin-bottom: 26px; }
.eco-eyebrow {
  display: inline-block;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 1px;
  color: var(--brand-ink);
  background: var(--brand-soft);
  border-radius: 999px;
  padding: 4px 12px;
}
.eco-title { color: var(--ink); font-size: 34px; font-weight: 800; margin: 14px 0 0; }
.eco-sub { color: var(--muted); font-size: 14px; line-height: 1.7; margin: 10px 0 0; max-width: 640px; }

.eco-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.eco-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 22px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  transition: border-color 0.16s ease, transform 0.16s ease;
}
.eco-card:hover { border-color: rgba(124, 92, 255, 0.5); transform: translateY(-2px); }
.eco-icon { font-size: 26px; line-height: 1; }
.eco-card-title { color: var(--ink); font-size: 16.5px; font-weight: 700; margin: 0; }
.eco-card-desc { color: var(--muted); font-size: 13px; line-height: 1.75; margin: 0; flex: 1; }
.eco-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
.eco-tag {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--brand-ink);
  background: var(--brand-soft);
  border-radius: 999px;
  padding: 3px 10px;
}
.eco-code { margin: 0; width: 100%; }
.eco-code code {
  display: block;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--ink);
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 12px;
  overflow-x: auto;
}
.eco-link { font-size: 12.5px; font-weight: 700; color: var(--brand-ink); text-decoration: none; }
.eco-link:hover { text-decoration: underline; }
.eco-card--placeholder { border-style: dashed; background: transparent; }
</style>
