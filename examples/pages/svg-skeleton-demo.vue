<!-- examples/pages/svg-skeleton-demo.vue —— ★2026-09-10 SVG 骨骼动画演示（可交互）
     与 svg-showcase-demo（一堆各自独立的特效）**不同思路**：
     本页只讲一件事——**嵌套 <g> 变换的复合（层级运动学）**：
       父级变换 → 子级变换 → 孙级变换 沿链累乘，一个关节的运动会带动整条下游骨骼。
     这正是骨骼动画/IK/机械臂的数学本质，也是「整体变换 → CSS」通道**表达不了**的能力
       （CSS 只能整张 SVG 转，无法让某段骨骼相对父级转）——故编译期自动改走 Canvas 通道逐节点绘制。

     ★交互（三套动作）：底部按钮切换 走/跑/跳 —— 每个动作是**独立场景**（各自 <svg> + 绑定数据），
       切走的场景 :playing=false（停表，不耗 CPU 回传），切到的场景 :playing=true。
       另附 慢放/倒放/定格 三个速率控制（:speed 透传组件）。
     诚实边界：Canvas 通道逐帧回传（20fps 可跑），非游戏级 60fps；纯装饰动画。 -->
<template>
  <view class="page">
    <!-- ★状态栏安全区（app 为 navigationStyle:custom，无原生导航栏）：p-safe 在 Skyline 走运行时读数
         （env() 不受支持）→ 让出状态栏+胶囊，否则标题/小人被遮挡（用户真机反馈） -->
    <p-safe area="top" :fallback="50" />
    <text class="title">SVG 骨骼动画</text>
    <text class="sub">嵌套变换复合 · 层级运动学 · 可交互</text>

    <!-- ══ 动作切换（三个独立场景：走 / 跑 / 跳）══ -->
    <view class="tabs">
      <text class="tab" :class="{ 'tab-on': mode === 'walk' }" @tap="setMode('walk')">行走</text>
      <text class="tab" :class="{ 'tab-on': mode === 'run' }" @tap="setMode('run')">奔跑</text>
      <text class="tab" :class="{ 'tab-on': mode === 'jump' }" @tap="setMode('jump')">跳跃</text>
    </view>

    <view class="stage">
      <view class="hit" @tap="onPoke"></view>

      <!-- ① 行走：机械双足，前后腿反相，步伐稳健（常驻场景，非活动时 playing=false 停表 + 容器隐藏） -->
      <view :class="{ 'scene-on': mode === 'walk', 'scene-off': mode !== 'walk', 'scene-fade': fading }">
      <svg viewBox="0 -80 320 300" width="288" height="270" :playing="playing && mode === 'walk'" :speed="speed" :progress="seed" @tick="onTick">
        <line x1="0" y1="214" x2="320" y2="214" stroke="#334155" stroke-width="2" stroke-dasharray="10 8">
          <animate attributeName="stroke-dashoffset" values="0;-18" dur="0.5s" repeatCount="indefinite" />
        </line>
        <g transform="translate(172,96)">
          <g>
            <animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0;0 -3;0 0" dur="1.2s" repeatCount="indefinite" />
            <!-- 尾巴 3 节 -->
            <g transform="translate(-14,16)">
              <g><rect x="-26" y="-4" width="26" height="8" rx="4" fill="#7c3aed" />
                <animateTransform attributeName="transform" type="rotate" values="6;-4;6" dur="0.8s" repeatCount="indefinite" />
                <g transform="translate(-26,0)">
                  <g><rect x="-24" y="-3.5" width="24" height="7" rx="3.5" fill="#8b5cf6" />
                    <animateTransform attributeName="transform" type="rotate" values="8;-5;8" dur="0.8s" repeatCount="indefinite" />
                    <g transform="translate(-24,0)">
                      <g><rect x="-22" y="-3" width="22" height="6" rx="3" fill="#a78bfa" />
                        <animateTransform attributeName="transform" type="rotate" values="10;-6;10" dur="0.8s" repeatCount="indefinite" />
                      </g>
                    </g>
                  </g>
                </g>
              </g>
            </g>
            <!-- 后腿 -->
            <g><g><rect x="-9" y="0" width="18" height="52" rx="6" fill="#1e3a8a" />
                <animateTransform attributeName="transform" type="rotate" values="-24;22;-24" dur="1.2s" repeatCount="indefinite" />
                <g transform="translate(0,52)"><g><rect x="-7" y="0" width="14" height="50" rx="5" fill="#1d4ed8" />
                    <animateTransform attributeName="transform" type="rotate" values="6;44;6" dur="1.2s" repeatCount="indefinite" />
                    <g transform="translate(0,50)"><g><rect x="-6" y="-2" width="22" height="9" rx="4" fill="#3b82f6" />
                        <animateTransform attributeName="transform" type="rotate" values="-10;10;-10" dur="1.2s" repeatCount="indefinite" /></g></g>
                  </g></g>
              </g></g>
            <!-- 后臂 -->
            <g><g transform="translate(0,-58)"><g><rect x="-6" y="0" width="12" height="34" rx="5" fill="#1e3a8a" />
                  <animateTransform attributeName="transform" type="rotate" values="-22;20;-22" dur="1.2s" repeatCount="indefinite" />
                  <g transform="translate(0,34)"><g><rect x="-5" y="0" width="10" height="30" rx="4" fill="#1d4ed8" />
                      <animateTransform attributeName="transform" type="rotate" values="10;34;10" dur="1.2s" repeatCount="indefinite" /></g></g>
                </g></g>
            </g>
            <!-- 躯干 + 头 -->
            <rect x="-19" y="-70" width="38" height="70" rx="13" fill="#334155" />
            <rect x="-19" y="-70" width="38" height="70" rx="13" fill="none" stroke="#475569" stroke-width="2" />
            <circle cx="6" cy="-90" r="17" fill="#0ea5e9" />
            <rect x="4" y="-94" width="16" height="8" rx="4" fill="#e0f2fe" />
            <!-- 前腿 -->
            <g><g><rect x="-10" y="0" width="20" height="52" rx="7" fill="#0f766e" />
                <animateTransform attributeName="transform" type="rotate" values="24;-24;24" dur="1.2s" repeatCount="indefinite" />
                <g transform="translate(0,52)"><g><rect x="-8" y="0" width="16" height="50" rx="6" fill="#14b8a6" />
                    <animateTransform attributeName="transform" type="rotate" values="6;50;6" dur="1.2s" repeatCount="indefinite" />
                    <g transform="translate(0,50)"><g><rect x="-8" y="-2" width="24" height="9" rx="4" fill="#2dd4bf" />
                        <animateTransform attributeName="transform" type="rotate" values="-12;12;-12" dur="1.2s" repeatCount="indefinite" /></g></g>
                  </g></g>
              </g></g>
            <!-- 前臂 -->
            <g><g transform="translate(0,-58)"><g><rect x="-7" y="0" width="14" height="34" rx="6" fill="#0f766e" />
                  <animateTransform attributeName="transform" type="rotate" values="22;-20;22" dur="1.2s" repeatCount="indefinite" />
                  <g transform="translate(0,34)"><g><rect x="-6" y="0" width="12" height="30" rx="5" fill="#14b8a6" />
                      <animateTransform attributeName="transform" type="rotate" values="8;36;8" dur="1.2s" repeatCount="indefinite" /></g></g>
                </g></g>
            </g>
          </g>
        </g>
      </svg>

      </view>
      <!-- ② 奔跑：更大摆幅 + 更快节奏 + 前倾 -->
      <view :class="{ 'scene-on': mode === 'run', 'scene-off': mode !== 'run', 'scene-fade': fading }">
      <svg viewBox="0 -80 320 300" width="288" height="270" :playing="playing && mode === 'run'" :speed="speed" :progress="seed" @tick="onTick">
        <line x1="0" y1="214" x2="320" y2="214" stroke="#334155" stroke-width="2" stroke-dasharray="14 6">
          <animate attributeName="stroke-dashoffset" values="0;-40" dur="0.25s" repeatCount="indefinite" />
        </line>
        <g transform="translate(172,90) rotate(10)">
          <g>
            <animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0;0 -8;0 0" dur="0.55s" repeatCount="indefinite" />
            <!-- 后腿（大摆幅） -->
            <g><g><rect x="-9" y="0" width="18" height="52" rx="6" fill="#7f1d1d" />
                <animateTransform attributeName="transform" type="rotate" values="-46;40;-46" dur="0.55s" repeatCount="indefinite" />
                <g transform="translate(0,52)"><g><rect x="-7" y="0" width="14" height="50" rx="5" fill="#b91c1c" />
                    <animateTransform attributeName="transform" type="rotate" values="20;80;20" dur="0.55s" repeatCount="indefinite" />
                    <g transform="translate(0,50)"><g><rect x="-6" y="-2" width="22" height="9" rx="4" fill="#ef4444" />
                        <animateTransform attributeName="transform" type="rotate" values="-16;16;-16" dur="0.55s" repeatCount="indefinite" /></g></g>
                  </g></g>
              </g></g>
            <!-- 后臂 -->
            <g><g transform="translate(0,-58)"><g><rect x="-6" y="0" width="12" height="34" rx="5" fill="#7f1d1d" />
                  <animateTransform attributeName="transform" type="rotate" values="-40;44;-40" dur="0.55s" repeatCount="indefinite" />
                  <g transform="translate(0,34)"><g><rect x="-5" y="0" width="10" height="30" rx="4" fill="#b91c1c" />
                      <animateTransform attributeName="transform" type="rotate" values="50;20;50" dur="0.55s" repeatCount="indefinite" /></g></g>
                </g></g>
            </g>
            <!-- 躯干 + 头（前倾） -->
            <rect x="-19" y="-70" width="38" height="70" rx="13" fill="#450a0a" />
            <rect x="-19" y="-70" width="38" height="70" rx="13" fill="none" stroke="#991b1b" stroke-width="2" />
            <circle cx="8" cy="-90" r="17" fill="#dc2626" />
            <rect x="6" y="-94" width="16" height="8" rx="4" fill="#fee2e2" />
            <!-- 前腿（大摆幅） -->
            <g><g><rect x="-10" y="0" width="20" height="52" rx="7" fill="#7c2d12" />
                <animateTransform attributeName="transform" type="rotate" values="46;-46;46" dur="0.55s" repeatCount="indefinite" />
                <g transform="translate(0,52)"><g><rect x="-8" y="0" width="16" height="50" rx="6" fill="#c2410c" />
                    <animateTransform attributeName="transform" type="rotate" values="20;86;20" dur="0.55s" repeatCount="indefinite" />
                    <g transform="translate(0,50)"><g><rect x="-8" y="-2" width="24" height="9" rx="4" fill="#fb923c" />
                        <animateTransform attributeName="transform" type="rotate" values="-18;18;-18" dur="0.55s" repeatCount="indefinite" /></g></g>
                  </g></g>
              </g></g>
            <!-- 前臂 -->
            <g><g transform="translate(0,-58)"><g><rect x="-7" y="0" width="14" height="34" rx="6" fill="#7c2d12" />
                  <animateTransform attributeName="transform" type="rotate" values="44;-40;44" dur="0.55s" repeatCount="indefinite" />
                  <g transform="translate(0,34)"><g><rect x="-6" y="0" width="12" height="30" rx="5" fill="#c2410c" />
                      <animateTransform attributeName="transform" type="rotate" values="40;70;40" dur="0.55s" repeatCount="indefinite" /></g></g>
                </g></g>
            </g>
          </g>
        </g>
      </svg>

      </view>
      <!-- ③ 跳跃：整体腾空 translate + 腿部收展 + 落地压缩 -->
      <view :class="{ 'scene-on': mode === 'jump', 'scene-off': mode !== 'jump', 'scene-fade': fading }">
      <svg viewBox="0 -80 320 300" width="288" height="270" :playing="playing && mode === 'jump'" :speed="speed" :progress="seed" @tick="onTick">
        <line x1="0" y1="214" x2="320" y2="214" stroke="#334155" stroke-width="2" />
        <g transform="translate(160,96)">
          <!-- 整体腾空（根级 translate 动画） -->
          <g>
            <animateTransform attributeName="transform" type="translate" values="0 0;0 -60;0 0" dur="1.6s" repeatCount="indefinite" />
            <!-- 后腿（空中伸展 / 落地收拢） -->
            <g><g><rect x="-9" y="0" width="18" height="50" rx="6" fill="#065f46" />
                <animateTransform attributeName="transform" type="rotate" values="10;50;10" dur="1.6s" repeatCount="indefinite" />
                <g transform="translate(0,50)"><g><rect x="-7" y="0" width="14" height="46" rx="5" fill="#047857" />
                    <animateTransform attributeName="transform" type="rotate" values="10;90;10" dur="1.6s" repeatCount="indefinite" />
                    <g transform="translate(0,46)"><g><rect x="-6" y="-2" width="20" height="8" rx="4" fill="#10b981" />
                        <animateTransform attributeName="transform" type="rotate" values="-10;20;-10" dur="1.6s" repeatCount="indefinite" /></g></g>
                  </g></g>
              </g></g>
            <!-- 后臂 -->
            <g><g transform="translate(0,-58)"><g><rect x="-6" y="0" width="12" height="34" rx="5" fill="#065f46" />
                  <animateTransform attributeName="transform" type="rotate" values="0;-70;0" dur="1.6s" repeatCount="indefinite" />
                  <g transform="translate(0,34)"><g><rect x="-5" y="0" width="10" height="30" rx="4" fill="#047857" />
                      <animateTransform attributeName="transform" type="rotate" values="20;10;20" dur="1.6s" repeatCount="indefinite" /></g></g>
                </g></g>
            </g>
            <!-- 躯干 + 头 -->
            <rect x="-19" y="-70" width="38" height="70" rx="13" fill="#064e3b" />
            <rect x="-19" y="-70" width="38" height="70" rx="13" fill="none" stroke="#059669" stroke-width="2" />
            <circle cx="6" cy="-90" r="17" fill="#10b981" />
            <rect x="4" y="-94" width="16" height="8" rx="4" fill="#d1fae5" />
            <!-- 前腿 -->
            <g><g><rect x="-10" y="0" width="20" height="50" rx="7" fill="#134e4a" />
                <animateTransform attributeName="transform" type="rotate" values="-12;-56;-12" dur="1.6s" repeatCount="indefinite" />
                <g transform="translate(0,50)"><g><rect x="-8" y="0" width="16" height="46" rx="6" fill="#0f766e" />
                    <animateTransform attributeName="transform" type="rotate" values="6;96;6" dur="1.6s" repeatCount="indefinite" />
                    <g transform="translate(0,46)"><g><rect x="-8" y="-2" width="22" height="8" rx="4" fill="#2dd4bf" />
                        <animateTransform attributeName="transform" type="rotate" values="-8;24;-8" dur="1.6s" repeatCount="indefinite" /></g></g>
                  </g></g>
              </g></g>
            <!-- 前臂 -->
            <g><g transform="translate(0,-58)"><g><rect x="-7" y="0" width="14" height="34" rx="6" fill="#134e4a" />
                  <animateTransform attributeName="transform" type="rotate" values="0;-90;0" dur="1.6s" repeatCount="indefinite" />
                  <g transform="translate(0,34)"><g><rect x="-6" y="0" width="12" height="30" rx="5" fill="#0f766e" />
                      <animateTransform attributeName="transform" type="rotate" values="16;8;16" dur="1.6s" repeatCount="indefinite" /></g></g>
                </g></g>
            </g>
          </g>
        </g>
      </svg>
      </view>
    </view>

    <!-- 速率控制（:speed 透传组件——慢放/倒放/定格） -->
    <view class="speeds">
      <text class="sbtn" :class="{ 'sbtn-on': speed === 0.4 }" @tap="setSpeed(0.4)">慢放</text>
      <text class="sbtn" :class="{ 'sbtn-on': speed === 1 }" @tap="setSpeed(1)">原速</text>
      <text class="sbtn" :class="{ 'sbtn-on': speed === 2 }" @tap="setSpeed(2)">快放</text>
      <text class="sbtn" :class="{ 'sbtn-on': speed === -1 }" @tap="setSpeed(-1)">倒放</text>
      <text class="sbtn" :class="{ 'sbtn-on': speed === 0 }" @tap="setSpeed(0)">定格</text>
    </view>

    <text class="status">{{ status }}</text>
    <text class="status">帧数 {{ frames }}</text>
    <!-- ★真机诊断（排障后移除） -->
    <text class="diag">回传 {{ emits }} · 发起 {{ issued }} · 失败 {{ fails }}</text>
    <text class="diag">{{ img }}</text>
    <text class="diag">{{ srcTail }}</text>
    <text class="diag">{{ err }}</text>

    <!-- 结构说明 -->
    <view class="legend">
      <view class="legend-row"><text class="k">根 → 髋</text><text class="v">translate（整体定位/腾空）</text></view>
      <view class="legend-row"><text class="k">髋 → 大腿</text><text class="v">rotate 摆动</text></view>
      <view class="legend-row"><text class="k">大腿 → 小腿</text><text class="v">rotate 屈膝（相对父级）</text></view>
      <view class="legend-row"><text class="k">动作切换</text><text class="v">独立场景 :playing 控制（停表不耗回传）</text></view>
    </view>

    <text class="hint">父级变换 × 子级变换 沿链累乘 · 切动作 / 变速 / 点机甲</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { PSafe } from '@proteus-vue/components'

type Mode = 'walk' | 'run' | 'jump'
/** ★注意：不要写 ref<Mode>('walk')——编译器对带泛型实参的 ref() 无法静态求值初值
 *  （会警告「无法静态求值 → data.mode = undefined」）→ 用无泛型 ref + 读取处断言。 */
const mode = ref('walk')
const playing = ref(true)
const speed = ref(1)
/** ★动作切换的相位连续：切换时把上一动作的周期进度（0..1）作为种子传给各场景组件 */
const seed = ref(-1)
/** 当前动作的归一化周期进度（来自 tick 事件——用于生成下一次切换的种子） */
const progress = ref(0)
/** 过渡淡入（切换时置 true → 下一帧清除；CSS opacity 过渡） */
const fading = ref(false)
let fadeTimer: ReturnType<typeof setTimeout> | null = null
const frames = ref(0)
const pokes = ref(0)
const status = ref('机械双足行走中')
/** ★真机诊断字段（tick 事件回传——排障后移除） */
const emits = ref(0)
const issued = ref(0)
const fails = ref(0)
const img = ref('img -')
const srcTail = ref('src -')
const err = ref('err -')

const MODE_LABEL: Record<Mode, string> = { walk: '行走', run: '奔跑', jump: '跳跃' }

function setMode(m: Mode): void {
  if (mode.value === m) return
  // ★相位连续：以当前进度作种子（新动作从相同周期位置起，腿部不回到起点）
  seed.value = progress.value
  mode.value = m
  playing.value = true
  fadeIn()
  status.value = '动作：' + MODE_LABEL[m] + '（相位承接 ' + Math.round(progress.value * 100) + '%）'
}

/** 切换过渡：置 fading → 下一帧清除（触发 CSS opacity 淡入） */
function fadeIn(): void {
  fading.value = true
  if (fadeTimer) clearTimeout(fadeTimer)
  fadeTimer = setTimeout(function () {
    fading.value = false
  }, 60)
}

function setSpeed(v: number): void {
  speed.value = v
  status.value = v === 0 ? '定格' : v < 0 ? '倒放中' : v === 1 ? '原速播放' : v > 1 ? '快放 ' + v + '×' : '慢放 ' + v + '×'
}

function onTick(e: unknown): void {
  const ev = e as { detail?: { frames?: number; emits?: number; issued?: number; fails?: number; img?: string; src?: string; err?: string; progress?: number } }
  const d = ev && ev.detail
  if (!d) return
  if (typeof d.progress === 'number') progress.value = d.progress
  // ★轻量 tick（每 2 帧）只带 frames+progress；重型字段（每 10 帧）才带——
  //   故仅在有值时更新，避免被轻量 tick 清零。
  if (typeof d.frames === 'number') frames.value = d.frames
  if (typeof d.emits === 'number') emits.value = d.emits
  if (typeof d.issued === 'number') issued.value = d.issued
  if (typeof d.fails === 'number') fails.value = d.fails
  if (d.img) img.value = d.img
  if (d.src) srcTail.value = '…' + d.src
  if (d.err) err.value = d.err
}

function onPoke(): void {
  pokes.value += 1
  const n = pokes.value
  status.value = n % 3 === 1 ? '机甲收到指令：加速' : n % 3 === 2 ? '机甲状态：稳定' : '机甲状态：过载预警'
}
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 12px 40px;
  /* Web 端刘海避让（Skyline 丢弃 env() → 回退 shorthand 的 16px，再由 MP 运行时内联覆盖） */
  padding-top: calc(16px + env(safe-area-inset-top, 0px));
  gap: 6px;
  background: #0b1020;
  min-height: 100vh;
  box-sizing: border-box;
}
.title {
  font-size: 20px;
  font-weight: 700;
  color: #e0f2fe;
  letter-spacing: 2px;
}
.sub {
  font-size: 12px;
  color: #7dd3fc;
  opacity: 0.85;
  text-align: center;
}
.tabs {
  display: flex;
  flex-direction: row;
  gap: 10px;
  margin-top: 10px;
}
.tab {
  font-size: 13px;
  color: #94a3b8;
  background: #111a30;
  border: 1px solid #1e293b;
  border-radius: 18px;
  padding: 6px 18px;
}
.tab-on {
  color: #04121f;
  background: #38bdf8;
  border-color: #38bdf8;
  font-weight: 700;
}
.stage {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
/* 场景容器：仅当前动作 display:flex，其余 display:none（停渲染） */
.scene {
  align-items: center;
  justify-content: center;
}
.scene-on {
  display: flex;
}
.scene-off {
  display: none;
}
/* 切换过渡：fading 期间压低不透明度（下一帧清除 → 过渡回 1，弱化生硬跳变） */
.scene-fade {
  opacity: 0.3;
  transition: opacity 0.16s ease-out;
}
.hit {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
}
.speeds {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
}
.sbtn {
  font-size: 12px;
  color: #94a3b8;
  background: #111a30;
  border: 1px solid #1e293b;
  border-radius: 14px;
  padding: 5px 14px;
}
.sbtn-on {
  color: #052e16;
  background: #34d399;
  border-color: #34d399;
  font-weight: 700;
}
.status {
  font-size: 13px;
  color: #a5f3fc;
  margin-top: 4px;
  font-weight: 600;
}
.diag {
  font-size: 12px;
  color: #fca5a5;
  word-break: break-all;
  text-align: center;
  line-height: 1.3;
}
.legend {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 18px;
  width: 100%;
  max-width: 300px;
  background: #111a30;
  border: 1px solid #1e293b;
  border-radius: 12px;
  padding: 12px 14px;
  box-sizing: border-box;
}
.legend-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}
.k {
  font-size: 12px;
  color: #7dd3fc;
  font-weight: 600;
}
.v {
  font-size: 12px;
  color: #94a3b8;
}
.hint {
  font-size: 12px;
  color: #64748b;
  margin-top: 16px;
  text-align: center;
}
</style>
