// {{appName}} —— Proteus 鸿蒙 dev 可视化层（**dev 变体专用**；release 不创建 ⇒ 零残留）
//
// 【它做什么（决策 #728 · 对齐 Android/iOS 的 DevOverlay）】① 右上角持久 "DEV" 角标（**可点**展开底部菜单）；
//   ② `flash(msg)` 瞬时 toast（"DEV 模式 · 改源码保存即热刷" / "⟳ 已热重载 · vN"）；③ 菜单显示面板 URL、
//   渲染状态、一键重置（下批接命令集后启用）。
//   【为什么单独文件 + 门控创建】dev 调试件与宿主功能**分开**：release（`DEV=false`）**根本不创建**本层
//   （`mainPage` 里 `if (DEV)`）⇒ 正式包零残留（宿主定位 #727）。
import { promptAction } from '@kit.ArkUI';

export class DevOverlay {
  private edited: boolean = false;
  private panelUrl: string = '';

  setPanelUrl(url: string): void { this.panelUrl = url; }

  /** 瞬时提示（toast）。 */
  flash(msg: string): void {
    try {
      promptAction.showToast({ message: msg, duration: 1600 });
    } catch (e) { /* 无 UI 上下文 ⇒ 忽略 */ }
  }

  /** 渲染状态行（菜单显示用）。 */
  statusText(): string {
    return this.edited ? '⚠ 非项目代码效果（已就地编辑）' : '项目代码效果';
  }

  panel(): string { return this.panelUrl; }
}
