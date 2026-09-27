// ★★DCP-1 spike（Yoga 侧）：同一套对照实验 —— 与 Taffy 侧逐项对齐
//
// 复用 M1 对拍抓出的 6 个 CSS 语义缺陷作为判据（浏览器真值已知），回答同一批问题：
//   ① 语义正确性  ② 多轮 measure（D3 核心）  ③ 增量（脏传播）  ④ 性能
#include <yoga/Yoga.h>
#include <cstdio>
#include <string>
#include <vector>
#include <map>
#include <chrono>
#include <algorithm>

// ── 测量计数（验证 D3 单次测量）──
struct MeasureCounter { std::vector<std::string> constraints; };

static YGSize measureFn(YGNodeConstRef node, float width, YGMeasureMode widthMode, float height, YGMeasureMode heightMode) {
  auto* ctx = static_cast<MeasureCounter*>(YGNodeGetContext(const_cast<YGNodeRef>(node)));
  if (ctx) {
    const char* wm = widthMode == YGMeasureModeExactly ? "Exactly" : widthMode == YGMeasureModeAtMost ? "AtMost" : "Undefined";
    const char* hm = heightMode == YGMeasureModeExactly ? "Exactly" : heightMode == YGMeasureModeAtMost ? "AtMost" : "Undefined";
    char buf[128];
    snprintf(buf, sizeof(buf), "w=%.0f(%s) h=%.0f(%s)", width, wm, height, hm);
    ctx->constraints.push_back(buf);
  }
  return YGSize{ widthMode == YGMeasureModeUndefined ? 100.0f : width, 20.0f };
}

static int passCount = 0, totalCount = 0;
static void report(const char* name, bool pass, const std::string& detail) {
  printf("  %s %-32s %s\n", pass ? "✓" : "✗", name, detail.c_str());
  totalCount++; if (pass) passCount++;
}

int main() {
  printf("\n═══ DCP-1 spike：Yoga 3.2.1（C++）实测 ═══\n");

  // ① CSS 语义：主轴 auto = max-content
  {
    YGNodeRef root = YGNodeNew();
    YGNodeStyleSetWidth(root, 340); YGNodeStyleSetFlexDirection(root, YGFlexDirectionRow);
    YGNodeRef mid = YGNodeNew();
    YGNodeStyleSetFlexDirection(mid, YGFlexDirectionRow);
    YGNodeRef c1 = YGNodeNew(); YGNodeStyleSetWidth(c1, 30); YGNodeStyleSetHeight(c1, 20);
    YGNodeRef c2 = YGNodeNew(); YGNodeStyleSetWidth(c2, 100); YGNodeStyleSetHeight(c2, 20);
    YGNodeInsertChild(mid, c1, 0); YGNodeInsertChild(mid, c2, 1);
    YGNodeRef other = YGNodeNew(); YGNodeStyleSetWidth(other, 40); YGNodeStyleSetHeight(other, 20);
    YGNodeInsertChild(root, mid, 0); YGNodeInsertChild(root, other, 1);
    YGNodeCalculateLayout(root, 340, YGUndefined, YGDirectionLTR);
    float w = YGNodeLayoutGetWidth(mid);
    report("flex-base-is-max-content", w == 130.0f, "内层 auto 宽容器 = " + std::to_string(w) + "（max-content 基线 130）");
    YGNodeFreeRecursive(root);
  }

  // ② CSS 语义：交叉轴居中参照系
  {
    YGNodeRef root = YGNodeNew();
    YGNodeStyleSetWidth(root, 200); YGNodeStyleSetHeight(root, 20);
    YGNodeStyleSetFlexDirection(root, YGFlexDirectionRow);
    YGNodeStyleSetAlignItems(root, YGAlignCenter);
    YGNodeRef child = YGNodeNew(); YGNodeStyleSetWidth(child, 20); YGNodeStyleSetHeight(child, 16);
    YGNodeInsertChild(root, child, 0);
    YGNodeCalculateLayout(root, 200, 20, YGDirectionLTR);
    float y = YGNodeLayoutGetTop(child);
    report("cross-center-uses-content-box", y == 2.0f, "居中 y = " + std::to_string(y) + "（期望 2.0）");
    YGNodeFreeRecursive(root);
  }

  // ③ CSS 语义：absolute 原点
  {
    YGNodeRef root = YGNodeNew();
    YGNodeStyleSetWidth(root, 200); YGNodeStyleSetHeight(root, 150);
    YGNodeStyleSetPadding(root, YGEdgeLeft, 10); YGNodeStyleSetPadding(root, YGEdgeTop, 20);
    YGNodeRef abs = YGNodeNew();
    YGNodeStyleSetPositionType(abs, YGPositionTypeAbsolute);
    YGNodeStyleSetPosition(abs, YGEdgeLeft, 30); YGNodeStyleSetPosition(abs, YGEdgeTop, 40);
    YGNodeStyleSetWidth(abs, 50); YGNodeStyleSetHeight(abs, 20);
    YGNodeInsertChild(root, abs, 0);
    YGNodeCalculateLayout(root, 200, 150, YGDirectionLTR);
    float x = YGNodeLayoutGetLeft(abs), y = YGNodeLayoutGetTop(abs);
    report("absolute-origin-is-padding-box", x == 30.0f && y == 40.0f,
           "absolute x=" + std::to_string(x) + " y=" + std::to_string(y) + "（期望 30,40）");
    YGNodeFreeRecursive(root);
  }

  // ④ CSS 语义：min/max 冻结—再分配
  {
    YGNodeRef root = YGNodeNew();
    YGNodeStyleSetWidth(root, 200); YGNodeStyleSetHeight(root, 30);
    YGNodeStyleSetFlexDirection(root, YGFlexDirectionRow);
    YGNodeStyleSetGap(root, YGGutterColumn, 10);
    YGNodeRef a = YGNodeNew(); YGNodeStyleSetFlexGrow(a, 1); YGNodeStyleSetMaxWidth(a, 60); YGNodeStyleSetHeight(a, 30);
    YGNodeRef b = YGNodeNew(); YGNodeStyleSetFlexGrow(b, 1); YGNodeStyleSetHeight(b, 30);
    YGNodeInsertChild(root, a, 0); YGNodeInsertChild(root, b, 1);
    YGNodeCalculateLayout(root, 200, 30, YGDirectionLTR);
    float wa = YGNodeLayoutGetWidth(a), wb = YGNodeLayoutGetWidth(b);
    report("minmax-freeze-redistribute", wa == 60.0f && wb == 130.0f,
           "a=" + std::to_string(wa) + " b=" + std::to_string(wb) + "（期望 60 / 130）");
    YGNodeFreeRecursive(root);
  }

  // ⑤ CSS 语义：display:none 无盒
  {
    YGNodeRef root = YGNodeNew();
    YGNodeStyleSetWidth(root, 100); YGNodeStyleSetFlexDirection(root, YGFlexDirectionColumn);
    YGNodeRef hidden = YGNodeNew(); YGNodeStyleSetDisplay(hidden, YGDisplayNone);
    YGNodeStyleSetWidth(hidden, 50); YGNodeStyleSetHeight(hidden, 50);
    YGNodeRef shown = YGNodeNew(); YGNodeStyleSetWidth(shown, 20); YGNodeStyleSetHeight(shown, 20);
    YGNodeInsertChild(root, hidden, 0); YGNodeInsertChild(root, shown, 1);
    YGNodeCalculateLayout(root, 100, YGUndefined, YGDirectionLTR);
    float hw = YGNodeLayoutGetWidth(hidden), hh = YGNodeLayoutGetHeight(hidden), sy = YGNodeLayoutGetTop(shown);
    report("display-none-no-box", hw == 0.0f && hh == 0.0f && sy == 0.0f,
           "hidden=" + std::to_string(hw) + "x" + std::to_string(hh) + " shown.y=" + std::to_string(sy));
    YGNodeFreeRecursive(root);
  }

  // ⑥ CSS 语义：百分比基准 = 父内容盒
  {
    YGNodeRef root = YGNodeNew();
    YGNodeStyleSetWidth(root, 300); YGNodeStyleSetHeight(root, 200);
    YGNodeStyleSetPadding(root, YGEdgeLeft, 25); YGNodeStyleSetPadding(root, YGEdgeRight, 25);
    YGNodeRef child = YGNodeNew(); YGNodeStyleSetWidthPercent(child, 50); YGNodeStyleSetHeight(child, 30);
    YGNodeInsertChild(root, child, 0);
    YGNodeCalculateLayout(root, 300, 200, YGDirectionLTR);
    float w = YGNodeLayoutGetWidth(child);
    report("percent-based-on-content-box", w == 125.0f,
           "50% of 内容盒(250) = " + std::to_string(w) + "（期望 125；border-box 会得 150）");
    YGNodeFreeRecursive(root);
  }

  // ⑦ ★Grid 支持（DCP-2 关键事实）
  //   ★证据形式：**编译期事实**——Yoga 3.2.1 的 YGDisplay 枚举只有 Flex/None/Contents，
  //     连 Grid 这个值都不存在（若硬写 YGDisplayGrid 会编译失败）。这比「跑一下看行为」更硬。
  {
    report("grid-supported", false,
           "Yoga 3.2.1 的 YGDisplay 枚举 = {Flex, None, Contents}，**无 Grid**（编译期即不成立）");
  }

  // ⑧ ★多轮 measure：深链 auto 尺寸容器（D3 核心判据）
  {
    auto chainCalls = [](int depth) -> int {
      YGNodeRef leaf = YGNodeNew();
      auto* counter = new MeasureCounter();
      YGNodeSetContext(leaf, counter);
      YGNodeSetMeasureFunc(leaf, measureFn);
      YGNodeRef cur = leaf;
      for (int d = 0; d < depth; d++) {
        YGNodeRef parent = YGNodeNew();
        YGNodeStyleSetFlexDirection(parent, YGFlexDirectionColumn);
        YGNodeInsertChild(parent, cur, 0);
        cur = parent;
      }
      YGNodeCalculateLayout(cur, 300, YGUndefined, YGDirectionLTR);
      int n = static_cast<int>(counter->constraints.size());
      YGNodeFreeRecursive(cur);
      delete counter;
      return n;
    };
    printf("\n  ── Yoga 深链（auto 尺寸容器）measure 次数 ──\n");
    int c2 = chainCalls(2), c6 = chainCalls(6), c12 = chainCalls(12);
    printf("     depth 2: %d · depth 6: %d · depth 12: %d\n", c2, c6, c12);
    report("measure-depth-independent", c12 <= c2,
           "深度 2 → " + std::to_string(c2) + " 次，深度 12 → " + std::to_string(c12) + " 次");
  }

  // ⑨ flex-wrap 支持
  {
    YGNodeRef root = YGNodeNew();
    YGNodeStyleSetWidth(root, 150);
    YGNodeStyleSetFlexDirection(root, YGFlexDirectionRow);
    YGNodeStyleSetFlexWrap(root, YGWrapWrap);
    for (int i = 0; i < 6; i++) {
      YGNodeRef c = YGNodeNew(); YGNodeStyleSetWidth(c, 60); YGNodeStyleSetHeight(c, 20); YGNodeStyleSetFlexShrink(c, 0);
      YGNodeInsertChild(root, c, i);
    }
    YGNodeCalculateLayout(root, 150, YGUndefined, YGDirectionLTR);
    float h = YGNodeLayoutGetHeight(root);
    report("flex-wrap-supported", h == 60.0f, "wrap 6×60dp 于 150dp 宽：容器高 " + std::to_string(h) + "（3 行期望 60）");
    YGNodeFreeRecursive(root);
  }

  // ⑩ 性能：4050 节点
  {
    YGNodeRef root = YGNodeNew();
    YGNodeStyleSetWidth(root, 750); YGNodeStyleSetFlexDirection(root, YGFlexDirectionColumn);
    std::vector<YGNodeRef> rows;
    for (int r = 0; r < 81; r++) {
      YGNodeRef row = YGNodeNew();
      YGNodeStyleSetFlexDirection(row, YGFlexDirectionRow); YGNodeStyleSetGap(row, YGGutterColumn, 4);
      for (int i = 0; i < 50; i++) {
        YGNodeRef leaf = YGNodeNew(); YGNodeStyleSetWidth(leaf, 40); YGNodeStyleSetHeight(leaf, 16); YGNodeStyleSetFlexShrink(leaf, 0);
        YGNodeInsertChild(row, leaf, i);
      }
      YGNodeInsertChild(root, row, r);
    }
    YGNodeCalculateLayout(root, 750, YGUndefined, YGDirectionLTR); // 预热
    std::vector<double> samples;
    for (int i = 0; i < 10; i++) {
      auto t0 = std::chrono::steady_clock::now();
      YGNodeCalculateLayout(root, 750, YGUndefined, YGDirectionLTR);
      auto t1 = std::chrono::steady_clock::now();
      samples.push_back(std::chrono::duration<double, std::milli>(t1 - t0).count());
    }
    std::sort(samples.begin(), samples.end());
    double median = samples[5];
    char buf[160];
    snprintf(buf, sizeof(buf), "4050 叶子 + 81 行：中位 %.3fms（min %.3f / max %.3f）", median, samples.front(), samples.back());
    report("perf-4050-nodes", median < 16.67, buf);
    YGNodeFreeRecursive(root);
  }

  // ═══ 交叉验证：与 Taffy 同一批用例（判据值取自 M1 浏览器对拍基线）═══
  printf("\n  ── 交叉验证（与 Taffy 同口径，判据来自浏览器基线）──\n");
  {
    // case1: row + space-between + padding
    YGNodeRef root = YGNodeNew();
    YGNodeStyleSetFlexDirection(root, YGFlexDirectionRow);
    YGNodeStyleSetJustifyContent(root, YGJustifySpaceBetween);
    YGNodeStyleSetAlignItems(root, YGAlignCenter);
    YGNodeStyleSetWidth(root, 320); YGNodeStyleSetHeight(root, 80);
    YGNodeStyleSetPadding(root, YGEdgeLeft, 10); YGNodeStyleSetPadding(root, YGEdgeRight, 10);
    YGNodeRef n1 = YGNodeNew(); YGNodeStyleSetWidth(n1,50); YGNodeStyleSetHeight(n1,30); YGNodeStyleSetFlexShrink(n1,0);
    YGNodeRef n2 = YGNodeNew(); YGNodeStyleSetWidth(n2,80); YGNodeStyleSetHeight(n2,50); YGNodeStyleSetFlexShrink(n2,0);
    YGNodeRef n3 = YGNodeNew(); YGNodeStyleSetWidth(n3,40); YGNodeStyleSetHeight(n3,40); YGNodeStyleSetFlexShrink(n3,0);
    YGNodeInsertChild(root,n1,0); YGNodeInsertChild(root,n2,1); YGNodeInsertChild(root,n3,2);
    YGNodeCalculateLayout(root,320,80,YGDirectionLTR);
    report("case1.a.x (=10)", YGNodeLayoutGetLeft(n1)==10.0f, "got=" + std::to_string(YGNodeLayoutGetLeft(n1)));
    report("case1.c.right (=310)", YGNodeLayoutGetLeft(n3)+YGNodeLayoutGetWidth(n3)==310.0f, "got=" + std::to_string(YGNodeLayoutGetLeft(n3)+YGNodeLayoutGetWidth(n3)));
    report("case1.b.centered-y (=15)", YGNodeLayoutGetTop(n2)==15.0f, "got=" + std::to_string(YGNodeLayoutGetTop(n2)));
    YGNodeFreeRecursive(root);
  }
  {
    // case2: flex-grow 1:2:1
    YGNodeRef root = YGNodeNew();
    YGNodeStyleSetFlexDirection(root, YGFlexDirectionRow);
    YGNodeStyleSetWidth(root,400); YGNodeStyleSetHeight(root,50);
    YGNodeRef a = YGNodeNew(); YGNodeStyleSetFlexGrow(a,1); YGNodeStyleSetHeight(a,50);
    YGNodeRef b = YGNodeNew(); YGNodeStyleSetFlexGrow(b,2); YGNodeStyleSetHeight(b,50);
    YGNodeRef c = YGNodeNew(); YGNodeStyleSetFlexGrow(c,1); YGNodeStyleSetHeight(c,50);
    YGNodeInsertChild(root,a,0); YGNodeInsertChild(root,b,1); YGNodeInsertChild(root,c,2);
    YGNodeCalculateLayout(root,400,50,YGDirectionLTR);
    report("case2.a.w (=100)", YGNodeLayoutGetWidth(a)==100.0f, "got=" + std::to_string(YGNodeLayoutGetWidth(a)));
    report("case2.b.w (=200)", YGNodeLayoutGetWidth(b)==200.0f, "got=" + std::to_string(YGNodeLayoutGetWidth(b)));
    report("case2.c.x (=300)", YGNodeLayoutGetLeft(c)==300.0f, "got=" + std::to_string(YGNodeLayoutGetLeft(c)));
    YGNodeFreeRecursive(root);
  }
  {
    // case3: 三层嵌套（判据 228 / 228 / 194 / 250，来自浏览器基线）
    YGNodeRef root = YGNodeNew();
    YGNodeStyleSetFlexDirection(root, YGFlexDirectionRow);
    YGNodeStyleSetGap(root, YGGutterColumn, 12);
    YGNodeStyleSetWidth(root,360); YGNodeStyleSetHeight(root,200);
    YGNodeStyleSetPadding(root, YGEdgeLeft, 10); YGNodeStyleSetPadding(root, YGEdgeRight, 10);
    YGNodeStyleSetPadding(root, YGEdgeTop, 10); YGNodeStyleSetPadding(root, YGEdgeBottom, 10);
    YGNodeRef col = YGNodeNew();
    YGNodeStyleSetFlexDirection(col, YGFlexDirectionColumn); YGNodeStyleSetGap(col, YGGutterRow, 6); YGNodeStyleSetFlexGrow(col, 1);
    YGNodeRef innerRow = YGNodeNew();
    YGNodeStyleSetFlexDirection(innerRow, YGFlexDirectionRow); YGNodeStyleSetGap(innerRow, YGGutterColumn, 4); YGNodeStyleSetHeight(innerRow, 40);
    YGNodeRef r1 = YGNodeNew(); YGNodeStyleSetWidth(r1,30); YGNodeStyleSetHeight(r1,40); YGNodeStyleSetFlexShrink(r1,0);
    YGNodeRef grow = YGNodeNew(); YGNodeStyleSetFlexGrow(grow,1); YGNodeStyleSetHeight(grow,40); YGNodeStyleSetFlexShrink(grow,0);
    YGNodeInsertChild(innerRow,r1,0); YGNodeInsertChild(innerRow,grow,1);
    YGNodeRef c6 = YGNodeNew(); YGNodeStyleSetHeight(c6,60); YGNodeStyleSetMargin(c6, YGEdgeTop, 4);
    YGNodeInsertChild(col,innerRow,0); YGNodeInsertChild(col,c6,1);
    YGNodeRef side = YGNodeNew();
    YGNodeStyleSetFlexDirection(side, YGFlexDirectionColumn); YGNodeStyleSetWidth(side,100);
    YGNodeRef s1 = YGNodeNew(); YGNodeStyleSetHeight(s1,30);
    YGNodeRef s2 = YGNodeNew(); YGNodeStyleSetHeight(s2,30);
    YGNodeInsertChild(side,s1,0); YGNodeInsertChild(side,s2,1);
    YGNodeInsertChild(root,col,0); YGNodeInsertChild(root,side,1);
    YGNodeCalculateLayout(root,360,200,YGDirectionLTR);
    report("case3.col.w (=228)", YGNodeLayoutGetWidth(col)==228.0f, "got=" + std::to_string(YGNodeLayoutGetWidth(col)));
    report("case3.innerRow.w (=228)", YGNodeLayoutGetWidth(innerRow)==228.0f, "got=" + std::to_string(YGNodeLayoutGetWidth(innerRow)));
    report("case3.growChild.w (=194)", YGNodeLayoutGetWidth(grow)==194.0f, "got=" + std::to_string(YGNodeLayoutGetWidth(grow)));
    report("case3.side.x (=250)", YGNodeLayoutGetLeft(side)==250.0f, "got=" + std::to_string(YGNodeLayoutGetLeft(side)));
    YGNodeFreeRecursive(root);
  }
  {
    // case4: absolute 定位（判据 60 / 50 / 60）
    YGNodeRef root = YGNodeNew();
    YGNodeStyleSetFlexDirection(root, YGFlexDirectionColumn);
    YGNodeStyleSetWidth(root,300); YGNodeStyleSetHeight(root,150);
    YGNodeStyleSetPadding(root, YGEdgeLeft, 30); YGNodeStyleSetPadding(root, YGEdgeTop, 20);
    YGNodeRef a = YGNodeNew(); YGNodeStyleSetHeight(a,40);
    YGNodeRef abs = YGNodeNew();
    YGNodeStyleSetPositionType(abs, YGPositionTypeAbsolute);
    YGNodeStyleSetPosition(abs, YGEdgeLeft, 60); YGNodeStyleSetPosition(abs, YGEdgeTop, 50);
    YGNodeStyleSetWidth(abs,80); YGNodeStyleSetHeight(abs,30);
    YGNodeRef c = YGNodeNew(); YGNodeStyleSetHeight(c,40);
    YGNodeInsertChild(root,a,0); YGNodeInsertChild(root,abs,1); YGNodeInsertChild(root,c,2);
    YGNodeCalculateLayout(root,300,150,YGDirectionLTR);
    report("case4.abs.x (=60)", YGNodeLayoutGetLeft(abs)==60.0f, "got=" + std::to_string(YGNodeLayoutGetLeft(abs)));
    report("case4.abs.y (=50)", YGNodeLayoutGetTop(abs)==50.0f, "got=" + std::to_string(YGNodeLayoutGetTop(abs)));
    report("case4.third.y (=60)", YGNodeLayoutGetTop(c)==60.0f, "got=" + std::to_string(YGNodeLayoutGetTop(c)));
    YGNodeFreeRecursive(root);
  }

  printf("\n  合计：%d/%d 项通过\n\n", passCount, totalCount);
  return 0;
}
