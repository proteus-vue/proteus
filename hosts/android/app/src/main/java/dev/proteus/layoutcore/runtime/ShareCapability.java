// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ShareCapability.java
// ★★★#1336 App 能力 C22：`share` —— 系统分享面板（Android 侧）。
//
// 【为什么需要】`useShare` 要的 `bridge.share(options)` 在 App 端一直没有宿主方法
//   ⇒ Level 层 `wrap(bridge.share(options))` 直接抛 TypeError（连 unsupported 都读不到）。
//   Android 本来就有 `Intent.ACTION_SEND` + `createChooser` ⇒ 属"有平台能力、没接线"。
//
// 【★语义边界】
//   `ACTION_SEND` + `createChooser` **只拉起系统分享面板并预填内容**；
//   返回 `{dispatched:true}` = **面板已交给系统**，不是"已分享到某处"——选哪个目标由用户决定。
//
// 【★★输入校验（安全基线：分享会把内容交给**别的 App**）】
//   ① 至少一项内容（title/text/url 全空 ⇒ 报错，不拉起空面板）；
//   ② 长度上限：Intent extra 走 Binder，超限抛 `TransactionTooLargeException`
//      （异常在系统侧、极难归因）⇒ 文本 8 KiB / 标题 256 / URL 2 KiB，与 JS 层同值；
//   ③ **URL scheme 只允许 http/https**：`file:` / `content:` / 自定义 scheme 一旦流出，
//      等于把本机私有路径或可执行语义递给任意接收方。非法**报错不清洗**。
//   ★JS 层已校验一遍，这里是第二道（业务可直接调 `__proteusHostInvoke` 绕过 JS）。
//
// 【为什么单独成文件】`HostCapabilities.java` 已有 200+ 行分派 ⇒ 新能力落新文件（决策 #870 三层范式）。
package dev.proteus.layoutcore.runtime;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import org.json.JSONObject;

public final class ShareCapability {

    /** 与 JS 层同值（`capability-app-share.ts`）——改一处要改四处 */
    static final int MAX_TEXT = 8192;
    static final int MAX_TITLE = 256;
    static final int MAX_URL = 2048;

    private ShareCapability() { }

    /** URL 白名单：只允许 http/https（见文件头 ③）。空串/null 视为"没有 url"。 */
    static boolean isAllowedUrl(String u) {
        if (u == null || u.isEmpty()) return true;
        if (u.length() > MAX_URL) return false;
        Uri parsed = Uri.parse(u);
        String scheme = parsed.getScheme();
        if (scheme == null) return false;
        String s = scheme.toLowerCase(java.util.Locale.ROOT);
        return s.equals("http") || s.equals("https");
    }

    /**
     * `share`：`{ title?, text?, url? }` → `{ dispatched: true }`
     *
     * @throws IllegalArgumentException 内容为空 / 超长 / url scheme 非法（**失败**，不是 unsupported）
     * @throws IllegalStateException Activity 不可用（⇒ JS 侧按失败上报）
     */
    public static JSONObject share(Activity activity, JSONObject args) throws Exception {
        // ★#1336 真机剖出：宿主层此前不 trim 标题，而 JS 层会 trim ⇒ 直调宿主传 `"   "`
        //   被判"有内容"而受理（拉起空面板）。口径与 JS 一致：标题 trim，正文不 trim。
        String title = args.optString("title", "").trim();
        String text = args.optString("text", "");
        String url = args.optString("url", "");

        if (title.length() > MAX_TITLE) {
            throw new IllegalArgumentException("share: title 过长（" + title.length() + " > " + MAX_TITLE + "）");
        }
        if (text.length() > MAX_TEXT) {
            throw new IllegalArgumentException("share: text 过长（" + text.length() + " > " + MAX_TEXT + "）");
        }
        if (!isAllowedUrl(url)) {
            // ★不回显原始 URL（可能带 token，且会进日志）
            throw new IllegalArgumentException("share: url 非法（只允许 http/https 且 ≤ " + MAX_URL + " 字符）");
        }
        if (title.isEmpty() && text.isEmpty() && url.isEmpty()) {
            throw new IllegalArgumentException("share: 内容为空（title/text/url 至少给一项）");
        }
        if (activity == null) {
            throw new IllegalStateException("share: Activity 不可用");
        }

        /* ★URL 用 EXTRA_TEXT 承载（而不是 EXTRA_STREAM）：多数接收方对纯文本+链接的兼容性最好，
           而 EXTRA_STREAM 需要 content:// URI 授权（FileProvider），那是"分享文件"另一个能力。
           同时把 url 单独放进 EXTRA_HTML_TEXT 之外的普通 extra，便于接收方识别。 */
        String body = text;
        if (!url.isEmpty()) {
            body = body.isEmpty() ? url : (body + "\n" + url);
        }

        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        if (!title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
        if (!body.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, body);

        /* ★createChooser 而不是裸 startActivity：
           ① 裸 `ACTION_SEND` 在"只有一个匹配应用"时会**直接进去**（用户看不到选择，也不易取消）；
           ② `createChooser` 保证"总是弹面板"，与本能力的语义（把内容交给系统选择）一致。
           ★Android 11+ 包可见性：`createChooser` 本身**不需要** `<queries>` 声明
             （与 #1285 同一教训：能查询到 ≠ 能解析到；这里干脆不做 resolveActivity 前置判断）。 */
        Intent chooser = Intent.createChooser(send, title.isEmpty() ? null : title);
        activity.startActivity(chooser);

        JSONObject out = new JSONObject();
        out.put("dispatched", true);
        return out;
    }
}
