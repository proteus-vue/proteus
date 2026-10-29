package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/DocumentCapability.java
// ★★★#1384 App 能力 C84：`document.open` —— 文档预览（Android 侧）。
//
// 【★为什么声明在父包 `dev.proteus.layoutcore`（而文件在 runtime/ 目录）】
//   本类要复用 `FileTransferCapability.resolve()`（沙箱校验的**唯一实现**），它是
//   **package-private** ⇒ 必须同包才能调。`FileTransferCapability` 本身就是"文件在
//   runtime/、包是父包"的既有形态（见其文件头）。★不要为了"看着整齐"把它挪到 `.runtime`：
//   那样 resolve 就调不到，只能复制一份校验（#1212：两份沙箱校验必然漂移）。
//
// 【为什么需要】C84 的 MP（`wx.openDocument`）/ Web（`window.open`）两腿在 NC1 就有，
//   App 端一直缺宿主方法 ⇒ `useOpenDocument` 恒 `document.open.unsupported`。
//   Android 本来就有 `Intent.ACTION_VIEW` ⇒ 属"有平台能力、没接线"。
//
// 【★★为什么要自建 ContentProvider（这是本单最容易做错的一处）】
//   直觉写法是 `Uri.fromFile(file)` + `ACTION_VIEW` —— **在 Android 7.0+ 必崩**
//   （`FileUriExposedException`：file:// URI 不得跨应用传递，因为对方拿不到你的存储权限）。
//   而 `androidx.core.content.FileProvider` **本仓没有 androidx 依赖**
//   （`hosts/android/thirdparty/` 只有 okhttp/okio，`check-host-compile.sh` 的 classpath 也只有
//   android.jar）⇒ 加 androidx 会引入打包/许可证/体积的一整套决定。
//   ⇒ 这里用**框架自带**的 `ContentProvider`（`openFile` 直接返回 `ParcelFileDescriptor`），
//     不引第三方、不依赖 androidx。URI 形态 `content://dev.proteus.layoutcore.docfiles/<rel>`。
//
// 【★URI 里放的是沙箱相对路径（不是绝对路径）——安全边界】
//   本 Provider **不做导出**（manifest `exported=false` + `grantUriPermissions`）：
//   只有被显式授权的接收方能读。且 `openFile` 仍走 `FileTransferCapability.resolve()`
//   的同一份沙箱校验（拒绝绝对路径与 `..`）——**不开第二份校验**（#1212 教训：两份沙箱根必然漂移）。
//   ★业务若把 URI 传给了恶意方，对方也只能读到那一个被授权的文件（URI 授权是 per-URI 的）。
//
// 【★语义边界】`ACTION_VIEW` 只**拉起预览器**；返回 `{dispatched:true}` = 已交给系统，
//   不是"用户看完了"。也没有"用户关掉了预览"的回调——本方法不谎称能感知。
//
// 【诚实边界】
//   · 设备上**没有任何应用能处理该 MIME** ⇒ `ActivityNotFoundException` ⇒ 抛
//     `UnsupportedOperationException` ⇒ JS 侧 `document.open.unsupported`（如实"本机打不开"，
//     不是笼统的 failed）。★与 #1285 同一教训：**不做 `resolveActivity` 前置判断**
//     （Android 11+ 包可见性会把它过滤成 null，而 `startActivity` 本身不受限）。
//   · 单文件上限 64 MiB（与 `fs.readBytes` 同值）：预览要把整份文件交给系统。
//   · 只支持白名单扩展名（JS 层已拦一遍，这里是第二道：业务可直接调 `__proteusHostInvoke`）。

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import org.json.JSONObject;

import java.util.Locale;

public final class DocumentCapability {

    /** 单文件上限 64 MiB（与 `capability-app-document.ts` / iOS / 鸿蒙 **同值**，改一处要改四处） */
    static final long MAX_BYTES = 64L * 1024L * 1024L;

    private DocumentCapability() { }

    /** 扩展名 → MIME（白名单，与 JS 层 `DOC_OPEN_MIME` 同一集，改一处要改四处） */
    static String mimeFor(String ext) {
        switch (ext) {
            case "pdf":  return "application/pdf";
            case "doc":  return "application/msword";
            case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "xls":  return "application/vnd.ms-excel";
            case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case "ppt":  return "application/vnd.ms-powerpoint";
            case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            case "txt":  return "text/plain";
            default:     return null;
        }
    }

    /** 取小写扩展名（不含点）；没有则返回 "" */
    static String extensionOf(String name) {
        int dot = name.lastIndexOf('.');
        if (dot <= 0 || dot == name.length() - 1) return "";
        return name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    /** 取文件名（最后一个 '/' 之后） */
    static String baseName(String path) {
        int i = path.lastIndexOf('/');
        return i >= 0 ? path.substring(i + 1) : path;
    }

    /**
     * `document.open`：`{ path, mimeType?, title? }` → `{ dispatched: true, uri }`
     *
     * @throws IllegalArgumentException       路径非法 / 扩展名不在白名单 / 文件不存在或过大
     * @throws UnsupportedOperationException  设备上没有能处理该 MIME 的应用（⇒ JS 侧 unsupported）
     * @throws IllegalStateException          Activity 不可用
     */
    public static JSONObject open(Activity activity, JSONObject args) throws Exception {
        String path = args.optString("path", "").trim();
        if (path.isEmpty()) throw new IllegalArgumentException("document.open 需要 { path }");

        // ★★★沙箱校验复用 `FileTransferCapability.resolve`——**不开第二份**
        //   （同一族：#1212 两份沙箱根必然漂移）。它负责拒绝对路径与 `..`。
        java.io.File f = FileTransferCapability.resolve(activity, path);
        if (!f.isFile()) {
            // ★不回显绝对路径（业务只给了相对路径，回显会让日志出现设备目录结构）
            throw new IllegalArgumentException("document.open: 沙箱内没有该文件（" + path + "）");
        }
        long size = f.length();
        if (size > MAX_BYTES) {
            throw new IllegalArgumentException("document.open: 文件过大（" + size + "B > " + MAX_BYTES + "B）");
        }

        // ★MIME **由扩展名自己推**，不信任入参（入参可由业务伪造；扩展名与真实内容不符的
        //   风险由"系统预览器自己解析失败"承担——本层不猜内容类型）。
        String name = baseName(path);
        String ext = extensionOf(name);
        String mime = mimeFor(ext);
        if (mime == null) {
            throw new IllegalArgumentException(
                    "document.open: 不支持 ." + ext + "（支持：pdf/doc/docx/xls/xlsx/ppt/pptx/txt）");
        }
        if (activity == null) throw new IllegalStateException("document.open: Activity 不可用");

        Uri uri = DocumentProvider.uriFor(path);
        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(uri, mime);
        // ★这两个 flag 必须一起给：GRANT_READ 让接收方读到这个 URI；
        //   NEW_TASK 保证在没有 Activity 上下文歧义时也能起（Activity 上下文下无害）。
        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            activity.startActivity(view);
        } catch (ActivityNotFoundException e) {
            // ★没有处理该 MIME 的应用 ⇒ **如实 unsupported**（与 #1285 拨号同一分档），
            //   而不是笼统的 failed——"本机打不开"与"代码坏了"是两件事。
            throw new UnsupportedOperationException(
                    "document.open: 设备上没有能打开 " + mime + " 的应用");
        }

        JSONObject out = new JSONObject();
        out.put("dispatched", true);
        // ★只回相对路径构造的 URI（不含绝对路径，可直接进日志）
        out.put("uri", uri.toString());
        out.put("mimeType", mime);
        return out;
    }
}
