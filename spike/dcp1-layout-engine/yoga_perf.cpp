// ★性能项复核：Yoga 的 0.000ms 需要证实或证伪
//   Yoga 有「布局缓存 + 脏标记」——若第二次调用因缓存命中而直接返回，测到的就是缓存的 0。
//   故必须测试：① 缓存命中（同一输入重复调用）② 真实重算（markDirty 后）
#include <yoga/Yoga.h>
#include <cstdio>
#include <vector>
#include <chrono>
#include <algorithm>

int main() {
  YGNodeRef root = YGNodeNew();
  YGNodeStyleSetWidth(root, 750); YGNodeStyleSetFlexDirection(root, YGFlexDirectionColumn);
  for (int r = 0; r < 81; r++) {
    YGNodeRef row = YGNodeNew();
    YGNodeStyleSetFlexDirection(row, YGFlexDirectionRow); YGNodeStyleSetGap(row, YGGutterColumn, 4);
    for (int i = 0; i < 50; i++) {
      YGNodeRef leaf = YGNodeNew(); YGNodeStyleSetWidth(leaf, 40); YGNodeStyleSetHeight(leaf, 16); YGNodeStyleSetFlexShrink(leaf, 0);
      YGNodeInsertChild(row, leaf, i);
    }
    YGNodeInsertChild(root, row, r);
  }
  // 首次（真算）
  auto t0 = std::chrono::steady_clock::now();
  YGNodeCalculateLayout(root, 750, YGUndefined, YGDirectionLTR);
  auto t1 = std::chrono::steady_clock::now();
  double first = std::chrono::duration<double, std::milli>(t1 - t0).count();

  // 同输入重复（应命中缓存）
  std::vector<double> cached;
  for (int i = 0; i < 5; i++) {
    auto a = std::chrono::steady_clock::now();
    YGNodeCalculateLayout(root, 750, YGUndefined, YGDirectionLTR);
    auto b = std::chrono::steady_clock::now();
    cached.push_back(std::chrono::duration<double, std::milli>(b - a).count());
  }
  // 改属性触发真重算（Yoga 的 markDirty 只允许作用于带 measure 的叶子——
  //   故用「改一个叶子的宽度」来合法地制造脏，这与真实业务（数据变化 → 改样式）同形）
  YGNodeRef firstLeaf = YGNodeGetChild(YGNodeGetChild(root, 0), 0);
  std::vector<double> dirty;
  for (int i = 0; i < 5; i++) {
    YGNodeStyleSetWidth(firstLeaf, 40 + i + 1);
    auto a = std::chrono::steady_clock::now();
    YGNodeCalculateLayout(root, 750, YGUndefined, YGDirectionLTR);
    auto b = std::chrono::steady_clock::now();
    dirty.push_back(std::chrono::duration<double, std::milli>(b - a).count());
  }
  std::sort(dirty.begin(), dirty.end());
  std::sort(cached.begin(), cached.end());

  printf("\n═══ Yoga 性能复核（4050 叶子 + 81 行）═══\n");
  printf("  首次布局（冷）        ：%.3f ms\n", first);
  printf("  同输入重复（缓存命中）：中位 %.3f ms（min %.3f / max %.3f）\n", cached[2], cached[0], cached[4]);
  printf("  改叶子宽度后重算（真算）：中位 %.3f ms（min %.3f / max %.3f）\n", dirty[2], dirty[0], dirty[4]);
  printf("\n  判定：初测的 0.000ms 是**缓存命中**；真算成本看「markDirty 后重算」一行\n");
  return 0;
}
