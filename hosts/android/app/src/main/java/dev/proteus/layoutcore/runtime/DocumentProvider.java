package dev.proteus.layoutcore;

// hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/DocumentProvider.java
// ★★★#1384 C84：**自建 ContentProvider** —— 给系统预览器一个可授予读权限的 `content://` URI。
// ★包声明是父包 `dev.proteus.layoutcore`（与 `DocumentCapability` 同因：要复用
//   `FileTransferCapability.resolve()`——它 package-private，见该文件头注释）。
//
// 【为什么必须自建（不是"多写一层"）】
//   Android 7.0+ 起 `Intent` 里传 `file://` URI 会抛 `FileUriExposedException`
//   （对方的进程在你的私有目录上没有读权限，系统直接拒绝传递）。
//   官方解法是 `FileProvider`，**但它在 androidx 里**——而本仓
//   `hosts/android/thirdparty/` 只有 okhttp/okio，`check-host-compile.sh` 的 classpath 也只有
//   `android.jar` ⇒ 引 androidx 要连带决定打包方式/体积/许可证。
//   ⇒ 用**框架自带**的 `ContentProvider`：`openFile()` 返回 `ParcelFileDescriptor` 即可，
//     零第三方依赖、零 gradle 变更（宿主本来就是 aapt2 + javac + d8 手工打包）。
//
// 【★★安全边界（这个类的全部意义）】
//   ① manifest 里 `exported="false"` + `grantUriPermissions="true"` ⇒ **外部默认读不到**，
//      只有 `FLAG_GRANT_READ_URI_PERMISSION` 那一次授权生效，且只对**那一个 URI**；
//   ② URI 里携带的是**沙箱相对路径**（不是绝对路径）⇒ 即便 URI 泄漏，也不暴露设备目录结构；
//   ③ `openFile` 落盘前**复用 `FileTransferCapability.resolve()`** 的同一份沙箱校验
//      （拒绝绝对路径与 `..`）——**不开第二份**（#1212：两份沙箱校验必然漂移）。
//      ★这一条是"纵深防御"：URI 已由本类的 `uriFor()` 构造，但接收方理论上可构造任意 URI
//      再来请求（`content://…/../../etc/passwd`）⇒ 必须自己再校验一次。
//
// 【★只读】`openFile` 忽略写模式；`insert/delete/update` 一律抛
//   `UnsupportedOperationException`——本 Provider 不提供任何写入面。
//
// 【诚实边界】URI 形态 `content://dev.proteus.layoutcore.docfiles/<相对路径>`，路径段原样保留
//   （含子目录）。系统预览器与第三方阅读器都按"能 openFile 就行"的方式读，与 FileProvider 行为一致。

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

public final class DocumentProvider extends ContentProvider {

    /** authority（与 AndroidManifest.xml 的 `android:authorities` **必须一致**） */
    static final String AUTHORITY = "dev.proteus.layoutcore.docfiles";
    /** URI 前缀（构造用；`uriFor` 是唯一生产者） */
    private static final Uri BASE = Uri.parse("content://" + AUTHORITY);

    /**
     * 沙箱相对路径 → `content://` URI。
     * ★路径段用 `appendPath` 逐段拼（它会自动编码），**不手工拼字符串**——
     *   手拼时文件名里的 `/`、空格、`#`、`?` 会改变 URI 结构（与 #1285 号码注入同族）。
     */
    static Uri uriFor(String relPath) {
        Uri.Builder b = BASE.buildUpon();
        for (String seg : relPath.split("/")) {
            if (!seg.isEmpty()) b.appendPath(seg);
        }
        return b.build();
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    /**
     * 读：把 URI 路径还原成沙箱相对路径 → 复用 `fs` 的沙箱校验 → 打开只读 fd。
     * ★**不 catch 校验异常**：`resolve()` 抛 `IllegalArgumentException` 会让系统把读取判为失败，
     *   这正是我们要的结果（越权 URI 必须读不到，而不是"静默给个空文件"）。
     */
    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        Context ctx = getContext();
        if (ctx == null) throw new FileNotFoundException("DocumentProvider: context 不可用");
        // 只读：忽略调用方给的 mode（本 Provider 没有写入面）
        String rel = relativePathOf(uri);
        try {
            File f = FileTransferCapability.resolve(ctx, rel);
            if (!f.isFile()) throw new FileNotFoundException("DocumentProvider: 不是文件");
            return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
        } catch (IllegalArgumentException e) {
            // 沙箱外/含 `..`/空路径 —— 一律当作"找不到"（不把内部校验细节回给外部调用方）
            throw new FileNotFoundException("DocumentProvider: 路径不可读");
        }
    }

    /** URI → 沙箱相对路径（去掉前缀的路径段用 `/` 拼回）。 */
    private static String relativePathOf(Uri uri) {
        java.util.List<String> segs = uri.getPathSegments();
        StringBuilder sb = new StringBuilder();
        for (String s : segs) {
            if (sb.length() > 0) sb.append('/');
            sb.append(s);
        }
        return sb.toString();
    }

    @Override
    public String getType(Uri uri) {
        String rel = relativePathOf(uri);
        String ext = DocumentCapability.extensionOf(DocumentCapability.baseName(rel));
        String mime = DocumentCapability.mimeFor(ext);
        return mime != null ? mime : "application/octet-stream";
    }

    // ── 以下四个方法**全部拒绝**（本 Provider 是只读的，不提供任何写入/查询面）──
    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;   // 无查询面：返回 null 是 ContentProvider 契约里"不支持"的合法表达
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("DocumentProvider 是只读的");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("DocumentProvider 是只读的");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("DocumentProvider 是只读的");
    }
}
