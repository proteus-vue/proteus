package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/SaveTypes.java
// ★★★#1200：**落盘的两个数据类**（从 `HttpCapability` 抽出——那个文件已到 1000 行上限）。
//
// 【为什么单列】它们只是**数据结构**，与"一条 http.request 怎么走"无关：
//   · `SaveStats`：一次落盘的记账（真机判据读它证明"内存不随文件增长"）；
//   · `SaveTooLarge`：超限异常（带实际上限，供回执给可读原因）。
//   ★抽出后 `HttpCapability` 不再为"加一行 fsync"而挤注释——这才是拆的理由。

/** 落盘记账（真机判据读它证明"内存不随文件增长"）。 */
final class SaveStats {
    volatile long bytes = 0;
    volatile int chunks = 0;
    volatile int peakChunkBytes = 0;
    volatile boolean completed = false;
    volatile String path = null;
    volatile String error = null;
}

/** 落盘超限（`atLeast` = 已收到的字节数，供错误信息使用）。 */
final class SaveTooLarge extends Exception {
    SaveTooLarge(long maxBytes, long atLeast) {
        super("fetch.tooLarge: 落盘超过上限 " + maxBytes + "B（已收 " + atLeast + "B）");
    }
}
