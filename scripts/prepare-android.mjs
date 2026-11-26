import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const mode = process.argv[2] || 'all';

function ensureFaceModels() {
  const srcDir = path.join(rootDir, 'node_modules', '@vladmandic', 'face-api', 'model');
  const destDir = path.join(rootDir, 'public', 'models');

  if (!fs.existsSync(srcDir)) {
    throw new Error('未找到 @vladmandic/face-api 模型目录，请先运行 npm install');
  }

  fs.mkdirSync(destDir, { recursive: true });

  const prefixes = [
    'ssd_mobilenetv1_model',
    'tiny_face_detector_model',
    'face_landmark_68_model',
    'face_recognition_model',
  ];

  const files = fs.readdirSync(srcDir).filter((name) =>
    prefixes.some((prefix) => name.startsWith(prefix))
  );

  for (const file of files) {
    const srcFile = path.join(srcDir, file);
    const destFile = path.join(destDir, file);
    if (!fs.existsSync(destFile)) {
      fs.copyFileSync(srcFile, destFile);
    }
  }
  console.log(`[prepare-android] Face recognition models ready (${files.length} files).`);
}

function patchAndroidManifest() {
  const manifestPath = path.join(
    rootDir,
    'android',
    'app',
    'src',
    'main',
    'AndroidManifest.xml'
  );

  if (!fs.existsSync(manifestPath)) {
    console.log('[prepare-android] AndroidManifest.xml not found yet, skipping manifest patch.');
    return;
  }

  let xml = fs.readFileSync(manifestPath, 'utf8');

  const entries = [
    {
      check: 'android.permission.CAMERA',
      line: '    <uses-permission android:name="android.permission.CAMERA" />',
    },
    {
      check: 'android.permission.READ_MEDIA_IMAGES',
      line: '    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />',
    },
    {
      check: 'android.permission.READ_EXTERNAL_STORAGE',
      line: '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
    },
    {
      check: 'android.hardware.camera"',
      line: '    <uses-feature android:name="android.hardware.camera" android:required="false" />',
    },
    {
      check: 'android.hardware.camera.autofocus',
      line: '    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />',
    },
  ];

  const toInsert = entries
    .filter((entry) => !xml.includes(entry.check))
    .map((entry) => entry.line);

  if (toInsert.length > 0) {
    xml = xml.replace('<application', `${toInsert.join('\n')}\n\n    <application`);
    fs.writeFileSync(manifestPath, xml, 'utf8');
    console.log(`[prepare-android] Added ${toInsert.length} permission/feature entries to AndroidManifest.xml.`);
  } else {
    console.log('[prepare-android] AndroidManifest.xml already contains camera and photo permissions.');
  }
}

function patchAndroidVersionCode() {
  const gradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');
  if (!fs.existsSync(gradlePath)) return;

  const currentYear = Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
    }).format(new Date())
  );
  const major = Math.max(1, currentYear - 2025);
  const envMinor = Number(process.env.ANDROID_VERSION_MINOR);
  const minor =
    Number.isInteger(envMinor) && envMinor >= 1 ? envMinor : 1;

  const versionName =
    (process.env.ANDROID_VERSION_NAME || '').trim() || `${major}.${minor}`;

  const envCode = Number(process.env.ANDROID_VERSION_CODE);
  const versionCode =
    Number.isInteger(envCode) && envCode >= 1
      ? envCode
      : major * 100000 + minor;

  let gradle = fs.readFileSync(gradlePath, 'utf8');
  const updated = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);

  if (updated !== gradle) {
    fs.writeFileSync(gradlePath, updated, 'utf8');
    console.log(
      `[prepare-android] Updated Android version to ${versionName} (versionCode ${versionCode}).`
    );
  }
}

function writeNativeAndroidSources() {
  const javaDir = path.join(
    rootDir,
    'android',
    'app',
    'src',
    'main',
    'java',
    'com',
    'mianpushiren',
    'app'
  );

  if (!fs.existsSync(javaDir)) {
    console.log('[prepare-android] Android Java package directory not found yet, skipping native plugin generation.');
    return;
  }

  // 1. MainActivity.java: Register StoragePickerPlugin + apply safe display cutout & status bar insets
  const mainActivitySource = `package com.mianpushiren.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(StoragePickerPlugin.class);
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.parseColor("#F8F8F7"));
        getWindow().setNavigationBarColor(Color.parseColor("#FFFFFF"));

        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(true);
            controller.setAppearanceLightNavigationBars(true);
        }

        View contentView = findViewById(android.R.id.content);
        if (contentView != null) {
            contentView.setBackgroundColor(Color.parseColor("#F8F8F7"));
            ViewCompat.setOnApplyWindowInsetsListener(contentView, (view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                        | WindowInsetsCompat.Type.displayCutout()
                        | WindowInsetsCompat.Type.ime()
                );
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(contentView);
        }
    }
}
`;

  fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), mainActivitySource, 'utf8');

  // 2. StoragePickerPlugin.java: Real Android SAF Folder Picker & File Read/Write
  const storagePluginSource = `package com.mianpushiren.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

@CapacitorPlugin(name = "StoragePicker")
public class StoragePickerPlugin extends Plugin {

    private String pendingExportFilename = null;
    private String pendingExportContent = null;

    @PluginMethod
    public void pickFolderImages(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "onPickFolderImagesResult");
    }

    @ActivityCallback
    private void onPickFolderImagesResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        Uri treeUri = result.getData().getData();
        if (treeUri == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        new Thread(() -> {
            try {
                JSArray files = new JSArray();
                String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
                collectImagesRecursively(getContext().getContentResolver(), treeUri, rootDocId, files, 0);

                JSObject ret = new JSObject();
                ret.put("cancelled", false);
                ret.put("files", files);
                call.resolve(ret);
            } catch (Exception ex) {
                call.reject("读取所选文件夹失败: " + ex.getMessage());
            }
        }).start();
    }

    private void collectImagesRecursively(
        ContentResolver resolver,
        Uri treeUri,
        String parentDocId,
        JSArray outFiles,
        int depth
    ) {
        if (depth > 3) return;

        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId);
        String[] projection = new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        };

        try (Cursor cursor = resolver.query(childrenUri, projection, null, null, null)) {
            if (cursor == null) return;
            while (cursor.moveToNext()) {
                String docId = cursor.getString(0);
                String name = cursor.getString(1);
                String mime = cursor.getString(2);

                if (docId == null || name == null) continue;

                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    collectImagesRecursively(resolver, treeUri, docId, outFiles, depth + 1);
                } else if (isImageFile(name, mime)) {
                    Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
                    JSObject item = new JSObject();
                    item.put("uri", docUri.toString());
                    item.put("name", name);
                    item.put("mimeType", mime != null ? mime : "image/jpeg");
                    outFiles.put(item);
                }
            }
        }
    }

    private boolean isImageFile(String name, String mime) {
        if (mime != null && mime.toLowerCase(Locale.ROOT).startsWith("image/")) {
            return true;
        }
        String lower = name.toLowerCase(Locale.ROOT);
        return lower.endsWith(".jpg")
            || lower.endsWith(".jpeg")
            || lower.endsWith(".png")
            || lower.endsWith(".webp")
            || lower.endsWith(".bmp");
    }

    @PluginMethod
    public void readDocumentImage(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("缺少图片路径");
            return;
        }

        new Thread(() -> {
            try {
                Uri uri = Uri.parse(uriStr);
                ContentResolver resolver = getContext().getContentResolver();

                int orientation = ExifInterface.ORIENTATION_NORMAL;
                try (InputStream exifStream = resolver.openInputStream(uri)) {
                    if (exifStream != null) {
                        ExifInterface exif = new ExifInterface(exifStream);
                        orientation = exif.getAttributeInt(
                            ExifInterface.TAG_ORIENTATION,
                            ExifInterface.ORIENTATION_NORMAL
                        );
                    }
                } catch (Exception ignored) {
                    // Non-JPEG or provider without EXIF metadata
                }

                BitmapFactory.Options boundsOpts = new BitmapFactory.Options();
                boundsOpts.inJustDecodeBounds = true;
                try (InputStream is = resolver.openInputStream(uri)) {
                    BitmapFactory.decodeStream(is, null, boundsOpts);
                }

                int maxDim = 1280;
                int sampleSize = 1;
                int maxSide = Math.max(boundsOpts.outWidth, boundsOpts.outHeight);
                while (maxSide / sampleSize > maxDim) {
                    sampleSize *= 2;
                }

                BitmapFactory.Options decodeOpts = new BitmapFactory.Options();
                decodeOpts.inSampleSize = sampleSize;
                Bitmap bitmap;
                try (InputStream is = resolver.openInputStream(uri)) {
                    bitmap = BitmapFactory.decodeStream(is, null, decodeOpts);
                }

                if (bitmap == null) {
                    call.reject("无法解码图片文件");
                    return;
                }

                bitmap = applyExifOrientation(bitmap, orientation);

                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.JPEG, 90, baos);
                bitmap.recycle();

                String b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
                JSObject ret = new JSObject();
                ret.put("dataUrl", "data:image/jpeg;base64," + b64);
                call.resolve(ret);
            } catch (Exception ex) {
                call.reject("读取图片失败: " + ex.getMessage());
            }
        }).start();
    }

    private Bitmap applyExifOrientation(Bitmap source, int orientation) {
        Matrix matrix = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_ROTATE_90:
                matrix.postRotate(90);
                break;
            case ExifInterface.ORIENTATION_ROTATE_180:
                matrix.postRotate(180);
                break;
            case ExifInterface.ORIENTATION_ROTATE_270:
                matrix.postRotate(270);
                break;
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:
                matrix.preScale(-1, 1);
                break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL:
                matrix.preScale(1, -1);
                break;
            default:
                return source;
        }
        Bitmap rotated = Bitmap.createBitmap(
            source,
            0,
            0,
            source.getWidth(),
            source.getHeight(),
            matrix,
            true
        );
        if (rotated != source) {
            source.recycle();
        }
        return rotated;
    }

    @PluginMethod
    public void exportBackupToFolder(PluginCall call) {
        String filename = call.getString("filename", "renlian-backup.json");
        String content = call.getString("content");
        if (content == null) {
            call.reject("备份内容为空");
            return;
        }

        pendingExportFilename = filename;
        pendingExportContent = content;

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "onExportBackupResult");
    }

    @ActivityCallback
    private void onExportBackupResult(PluginCall call, ActivityResult result) {
        String filename = pendingExportFilename != null ? pendingExportFilename : "renlian-backup.json";
        String content = pendingExportContent;
        pendingExportFilename = null;
        pendingExportContent = null;

        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        Uri treeUri = result.getData().getData();
        if (treeUri == null || content == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        new Thread(() -> {
            try {
                ContentResolver resolver = getContext().getContentResolver();
                String parentDocId = DocumentsContract.getTreeDocumentId(treeUri);
                Uri parentDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, parentDocId);
                String folderName = queryDisplayName(resolver, parentDocUri);

                Uri createdUri = DocumentsContract.createDocument(
                    resolver,
                    parentDocUri,
                    "application/json",
                    filename
                );
                if (createdUri == null) {
                    call.reject("无法在所选文件夹中创建备份文件");
                    return;
                }

                try (OutputStream os = resolver.openOutputStream(createdUri, "wt")) {
                    if (os == null) {
                        call.reject("无法写入备份文件");
                        return;
                    }
                    os.write(content.getBytes(StandardCharsets.UTF_8));
                    os.flush();
                }

                String savedName = queryDisplayName(resolver, createdUri);
                JSObject ret = new JSObject();
                ret.put("cancelled", false);
                ret.put("filename", savedName != null ? savedName : filename);
                ret.put("folderName", folderName != null ? folderName : "");
                call.resolve(ret);
            } catch (Exception ex) {
                call.reject("导出备份失败: " + ex.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void pickBackupFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "onPickBackupResult");
    }

    @ActivityCallback
    private void onPickBackupResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        Uri fileUri = result.getData().getData();
        if (fileUri == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        new Thread(() -> {
            try {
                ContentResolver resolver = getContext().getContentResolver();
                String filename = queryDisplayName(resolver, fileUri);
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                byte[] buffer = new byte[16384];

                try (InputStream is = resolver.openInputStream(fileUri)) {
                    if (is == null) {
                        call.reject("无法打开所选备份文件");
                        return;
                    }
                    int read;
                    while ((read = is.read(buffer)) != -1) {
                        baos.write(buffer, 0, read);
                    }
                }

                String content = new String(baos.toByteArray(), StandardCharsets.UTF_8);
                JSObject ret = new JSObject();
                ret.put("cancelled", false);
                ret.put("filename", filename != null ? filename : "backup.json");
                ret.put("content", content);
                call.resolve(ret);
            } catch (Exception ex) {
                call.reject("读取备份文件失败: " + ex.getMessage());
            }
        }).start();
    }

    private String queryDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(
            uri,
            new String[] { OpenableColumns.DISPLAY_NAME },
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getString(0);
            }
        } catch (Exception ignored) {
            // Fall back cleanly if provider omits DISPLAY_NAME
        }
        return null;
    }
}
`;

  fs.writeFileSync(path.join(javaDir, 'StoragePickerPlugin.java'), storagePluginSource, 'utf8');
  console.log('[prepare-android] Generated MainActivity.java (with safe display cutout insets) and StoragePickerPlugin.java.');
}

if (mode === 'models' || mode === 'all') {
  ensureFaceModels();
}
if (mode === 'manifest' || mode === 'all') {
  patchAndroidManifest();
  patchAndroidVersionCode();
  writeNativeAndroidSources();
}
