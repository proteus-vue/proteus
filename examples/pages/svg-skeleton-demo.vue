<!-- examples/pages/svg-skeleton-demo.vue —— ★2026-09-10 SVG 骨骼动画演示
     与 svg-showcase-demo（一堆各自独立的特效）**不同思路**：
     本页只讲一件事——**嵌套 <g> 变换的复合（层级运动学）**：
       父级变换 → 子级变换 → 孙级变换 沿链累乘，一个关节的运动会带动整条下游骨骼。
     这正是骨骼动画/IK/机械臂的数学本质，也是「整体变换 → CSS」通道**表达不了**的能力
       （CSS 只能整张 SVG 转，无法让某一段骨骼相对父级转）——故编译期自动改走 Canvas 通道逐节点绘制。

     本页含两个骨骼链（同屏，证明可组合）：
       ① 机械双足：髋 → 大腿 → 小腿 → 足（2 条腿），肩 → 上臂 → 前臂（2 条臂），脊柱微摆
       ② 尾巴：3 节链（每节相对父级转）——末端绝对位移 = 三节角度的和，直观展示「复合」
     诚实边界：Canvas 通道逐帧回传（20fps 可跑），非游戏级 60fps；纯装饰动画。 -->
<template>
  <view class="page">
    <text class="title">SVG 骨骼动画</text>
    <text class="sub">嵌套变换复合 · 层级运动学 · 单场景 Canvas 通道</text>

    <view class="stage">
      <!-- ★点击热区：透明 view 覆盖（Skyline 下 image/组件内触摸不可靠，原生 view 最稳） -->
      <view class="hit" @tap="onPoke"></view>
      <svg viewBox="0 0 320 240" width="288" height="216" @tick="onTick">
        <!-- 地面（虚线滚动——stroke-dashoffset 动画，Canvas 通道） -->
        <line x1="0" y1="214" x2="320" y2="214" stroke="#334155" stroke-width="2" stroke-dasharray="10 8">
          <animate attributeName="stroke-dashoffset" values="0;-18" dur="0.5s" repeatCount="indefinite" />
        </line>

        <!-- ══ 机械双足（根节点 = 髋，位于画面中下部） ══ -->
        <g transform="translate(172,96)">
          <!-- 脊柱随步伐轻微上下起伏（根级 translate 动画——也由 Canvas 引擎逐帧求值） -->
          <g>
            <animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0;0 -3;0 0" dur="1.2s" repeatCount="indefinite" />

            <!-- 后腿（先画 = 在下层）：髋 → 大腿 → 小腿 → 足 -->
            <g>
              <g>
                <rect x="-9" y="0" width="18" height="52" rx="6" fill="#1e3a8a" />
                <animateTransform attributeName="transform" type="rotate" values="-24;22;-24" dur="1.2s" repeatCount="indefinite" />
                <g transform="translate(0,52)">
                  <g>
                    <rect x="-7" y="0" width="14" height="50" rx="5" fill="#1d4ed8" />
                    <animateTransform attributeName="transform" type="rotate" values="6;44;6" dur="1.2s" repeatCount="indefinite" />
                    <g transform="translate(0,50)">
                      <g>
                        <rect x="-6" y="-2" width="22" height="9" rx="4" fill="#3b82f6" />
                        <animateTransform attributeName="transform" type="rotate" values="-10;10;-10" dur="1.2s" repeatCount="indefinite" />
                      </g>
                    </g>
                  </g>
                </g>
              </g>
            </g>

            <!-- 尾巴：3 节链（每节相对父级转——末端位移是三节角度之和） -->
            <g transform="translate(-14,16)">
              <g>
                <rect x="-26" y="-4" width="26" height="8" rx="4" fill="#7c3aed" />
                <animateTransform attributeName="transform" type="rotate" values="6;-4;6" dur="0.8s" repeatCount="indefinite" />
                <g transform="translate(-26,0)">
                  <g>
                    <rect x="-24" y="-3.5" width="24" height="7" rx="3.5" fill="#8b5cf6" />
                    <animateTransform attributeName="transform" type="rotate" values="8;-5;8" dur="0.8s" repeatCount="indefinite" />
                    <g transform="translate(-24,0)">
                      <g>
                        <rect x="-22" y="-3" width="22" height="6" rx="3" fill="#a78bfa" />
                        <animateTransform attributeName="transform" type="rotate" values="10;-6;10" dur="0.8s" repeatCount="indefinite" />
                      </g>
                    </g>
                  </g>
                </g>
              </g>
            </g>

            <!-- 后臂（肩 → 上臂 → 前臂），与后腿同相 -->
            <g>
              <g transform="translate(0,-58)">
                <g>
                  <rect x="-6" y="0" width="12" height="34" rx="5" fill="#1e3a8a" />
                  <animateTransform attributeName="transform" type="rotate" values="-22;20;-22" dur="1.2s" repeatCount="indefinite" />
                  <g transform="translate(0,34)">
                    <g>
                      <rect x="-5" y="0" width="10" height="30" rx="4" fill="#1d4ed8" />
                      <animateTransform attributeName="transform" type="rotate" values="10;34;10" dur="1.2s" repeatCount="indefinite" />
                    </g>
                  </g>
                </g>
              </g>
            </g>

            <!-- 躯干 + 头 -->
            <rect x="-19" y="-70" width="38" height="70" rx="13" fill="#334155" />
            <rect x="-19" y="-70" width="38" height="70" rx="13" fill="none" stroke="#475569" stroke-width="2" />
            <circle cx="0" cy="-70" r="5" fill="#22d3ee" opacity="0.9" />
            <circle cx="6" cy="-90" r="17" fill="#0ea5e9" />
            <circle cx="6" cy="-90" r="17" fill="none" stroke="#38bdf8" stroke-width="2" />
            <rect x="4" y="-94" width="16" height="8" rx="4" fill="#e0f2fe" />

            <!-- 前腿（后画 = 在上层）：与后腿反相 -->
            <g>
              <g>
                <rect x="-10" y="0" width="20" height="52" rx="7" fill="#0f766e" />
                <animateTransform attributeName="transform" type="rotate" values="24;-24;24" dur="1.2s" repeatCount="indefinite" />
                <g transform="translate(0,52)">
                  <g>
                    <rect x="-8" y="0" width="16" height="50" rx="6" fill="#14b8a6" />
                    <animateTransform attributeName="transform" type="rotate" values="6;50;6" dur="1.2s" repeatCount="indefinite" />
                    <g transform="translate(0,50)">
                      <g>
                        <rect x="-8" y="-2" width="24" height="9" rx="4" fill="#2dd4bf" />
                        <animateTransform attributeName="transform" type="rotate" values="-12;12;-12" dur="1.2s" repeatCount="indefinite" />
                      </g>
                    </g>
                  </g>
                </g>
              </g>
            </g>

            <!-- 前臂（与后臂反相） -->
            <g>
              <g transform="translate(0,-58)">
                <g>
                  <rect x="-7" y="0" width="14" height="34" rx="6" fill="#0f766e" />
                  <animateTransform attributeName="transform" type="rotate" values="22;-20;22" dur="1.2s" repeatCount="indefinite" />
                  <g transform="translate(0,34)">
                    <g>
                      <rect x="-6" y="0" width="12" height="30" rx="5" fill="#14b8a6" />
                      <animateTransform attributeName="transform" type="rotate" values="8;36;8" dur="1.2s" repeatCount="indefinite" />
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
    </view>

    <text class="status">{{ status }}</text>
    <text class="status">帧数 {{ frames }}</text>
    <!-- ★真机诊断（与 showcase 同款，排障后移除） -->
    <text class="diag">回传 {{ emits }} · 发起 {{ issued }} · 失败 {{ fails }}</text>
    <text class="diag">{{ img }}</text>
    <text class="diag">{{ srcTail }}</text>
    <text class="diag">{{ err }}</text>

    <!-- 结构说明：本页要证明的就是「层级」这件事 -->
    <view class="legend">
      <view class="legend-row"><text class="k">根 → 髋</text><text class="v">translate（整体定位）</text></view>
      <view class="legend-row"><text class="k">髋 → 大腿</text><text class="v">rotate 摆动</text></view>
      <view class="legend-row"><text class="k">大腿 → 小腿</text><text class="v">rotate 屈膝（相对父级）</text></view>
      <view class="legend-row"><text class="k">尾巴 3 节</text><text class="v">逐节相对父级转 → 末端复合位移</text></view>
    </view>

    <text class="hint">父级变换 × 子级变换 沿链累乘 · 点一下机甲有反应</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const status = ref('机械双足行走中')
const frames = ref(0)
/** ★真机诊断字段（tick 事件回传——排障后移除） */
const emits = ref(0)
const issued = ref(0)
const fails = ref(0)
const img = ref('img -')
const srcTail = ref('src -')
const err = ref('err -')

function onTick(e: unknown): void {
  const ev = e as { detail?: { frames?: number; emits?: number; issued?: number; fails?: number; img?: string; src?: string; err?: string } }
  const d = ev && ev.detail
  if (!d) return
  frames.value = d.frames || 0
  emits.value = d.emits || 0
  issued.value = d.issued || 0
  fails.value = d.fails || 0
  if (d.img) img.value = d.img
  if (d.src) srcTail.value = '…' + d.src
  if (d.err) err.value = d.err
}

let pokes = 0
function onPoke(): void {
  pokes += 1
  status.value = pokes % 3 === 1 ? '机甲收到指令：加速' : pokes % 3 === 2 ? '机甲状态：稳定' : '机甲状态：过载预警'
}
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 12px 40px;
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
.stage {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.hit {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
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
