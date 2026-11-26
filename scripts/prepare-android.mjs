import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

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

// ---------------------------------------------------------------------------
// Minimalist App Icon Renderer (Option 1: #F8F8F7 warm paper + #141413 ink)
// Pure-Node 4x4 supersampled SDF rasterizer (zero external dependencies)
// ---------------------------------------------------------------------------

function distPointToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  let t = lenSq > 0 ? (wx * vx + wy * vy) / lenSq : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

function sampleQuadraticBezier(x0, y0, x1, y1, x2, y2, steps = 20) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const inv = 1 - t;
    pts.push([
      inv * inv * x0 + 2 * inv * t * x1 + t * t * x2,
      inv * inv * y0 + 2 * inv * t * y1 + t * t * y2,
    ]);
  }
  return pts;
}

function buildIconStrokes(insetMode) {
  // Adaptive foreground uses slightly tighter 30..78 coordinates inside 108x108 safe circle;
  // full square/web icon uses 27..81 inside 108x108 for optimal visual presence.
  if (insetMode === 'adaptive') {
    return [
      // Four viewfinder brackets [30..78]
      {
        r: 2.1,
        pts: [
          [30, 41],
          ...sampleQuadraticBezier(30, 36.5, 30, 30, 36.5, 30, 14),
          [41, 30],
        ],
      },
      {
        r: 2.1,
        pts: [
          [67, 30],
          ...sampleQuadraticBezier(71.5, 30, 78, 30, 78, 36.5, 14),
          [78, 41],
        ],
      },
      {
        r: 2.1,
        pts: [
          [78, 67],
          ...sampleQuadraticBezier(78, 71.5, 78, 78, 71.5, 78, 14),
          [67, 78],
        ],
      },
      {
        r: 2.1,
        pts: [
          [41, 78],
          ...sampleQuadraticBezier(36.5, 78, 30, 78, 30, 71.5, 14),
          [30, 67],
        ],
      },
      // Minimalist face centered at (54, 54)
      { r: 2.1, pts: [[44.5, 44], [44.5, 48]] },
      { r: 2.1, pts: [[63.5, 44], [63.5, 48]] },
      {
        r: 1.9,
        pts: [
          [54, 45],
          [54, 53],
          ...sampleQuadraticBezier(54, 53, 54, 55.5, 51.8, 55.5, 10),
        ],
      },
      {
        r: 2.1,
        pts: sampleQuadraticBezier(45.5, 61, 54, 67.5, 62.5, 61, 20),
      },
    ];
  }

  return [
    // Four viewfinder brackets [27..81]
    {
      r: 2.3,
      pts: [
        [27, 40],
        ...sampleQuadraticBezier(27, 34.5, 27, 27, 34.5, 27, 14),
        [40, 27],
      ],
    },
    {
      r: 2.3,
      pts: [
        [68, 27],
        ...sampleQuadraticBezier(73.5, 27, 81, 27, 81, 34.5, 14),
        [81, 40],
      ],
    },
    {
      r: 2.3,
      pts: [
        [81, 68],
        ...sampleQuadraticBezier(81, 73.5, 81, 81, 73.5, 81, 14),
        [68, 81],
      ],
    },
    {
      r: 2.3,
      pts: [
        [40, 81],
        ...sampleQuadraticBezier(34.5, 81, 27, 81, 27, 73.5, 14),
        [27, 68],
      ],
    },
    // Minimalist face centered at (54, 54)
    { r: 2.3, pts: [[43.5, 43.5], [43.5, 48]] },
    { r: 2.3, pts: [[64.5, 43.5], [64.5, 48]] },
    {
      r: 2.0,
      pts: [
        [54, 44.5],
        [54, 53.2],
        ...sampleQuadraticBezier(54, 53.2, 54, 56, 51.4, 56, 10),
      ],
    },
    {
      r: 2.3,
      pts: sampleQuadraticBezier(44.5, 62.5, 54, 69.5, 63.5, 62.5, 20),
    },
  ];
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: None
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Renders the Option 1 icon into an RGBA PNG buffer.
 * @param {number} size Pixel width & height
 * @param {'square'|'round'|'foreground'} variant
 */
function renderIconPngBuffer(size, variant) {
  const strokes = buildIconStrokes(variant === 'foreground' ? 'adaptive' : 'full');
  const bgR = 0xf8;
  const bgG = 0xf8;
  const bgB = 0xf7;
  const fgR = 0x14;
  const fgG = 0x14;
  const fgB = 0x13;

  const rgba = Buffer.alloc(size * size * 4);
  const ss = 3; // 3x3 supersampling per pixel
  const invSamples = 1 / (ss * ss);
  const scale = 108 / size;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let fgCov = 0;
      let bgCov = 0;

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const ux = (px + (sx + 0.5) / ss) * scale;
          const uy = (py + (sy + 0.5) / ss) * scale;

          let insideShape = true;
          if (variant === 'round') {
            insideShape = Math.hypot(ux - 54, uy - 54) <= 50.5;
          } else if (variant === 'square') {
            // Subtle rounded square for legacy launcher & web icon
            const rx = Math.max(Math.abs(ux - 54) - (52 - 22), 0);
            const ry = Math.max(Math.abs(uy - 54) - (52 - 22), 0);
            insideShape = Math.hypot(rx, ry) <= 22;
          }

          if (variant !== 'foreground' && insideShape) {
            bgCov += invSamples;
          }

          let hitStroke = false;
          for (let i = 0; i < strokes.length; i++) {
            const st = strokes[i];
            const pts = st.pts;
            for (let j = 0; j < pts.length - 1; j++) {
              const d = distPointToSegment(
                ux,
                uy,
                pts[j][0],
                pts[j][1],
                pts[j + 1][0],
                pts[j + 1][1]
              );
              if (d <= st.r) {
                hitStroke = true;
                break;
              }
            }
            if (hitStroke) break;
          }

          if (hitStroke && (variant === 'foreground' || insideShape)) {
            fgCov += invSamples;
          }
        }
      }

      const idx = (py * size + px) * 4;
      if (variant === 'foreground') {
        rgba[idx] = fgR;
        rgba[idx + 1] = fgG;
        rgba[idx + 2] = fgB;
        rgba[idx + 3] = Math.round(fgCov * 255);
      } else if (bgCov <= 0) {
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 0;
      } else {
        const fgRatio = Math.min(1, fgCov / bgCov);
        rgba[idx] = Math.round(bgR * (1 - fgRatio) + fgR * fgRatio);
        rgba[idx + 1] = Math.round(bgG * (1 - fgRatio) + fgG * fgRatio);
        rgba[idx + 2] = Math.round(bgB * (1 - fgRatio) + fgB * fgRatio);
        rgba[idx + 3] = Math.round(bgCov * 255);
      }
    }
  }

  return encodeRgbaPng(size, size, rgba);
}

function writeWebIconPng() {
  const outPath = path.join(rootDir, 'public', 'icon-512.png');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, renderIconPngBuffer(512, 'square'));
  console.log('[prepare-android] Generated public/icon-512.png.');
}

function writeAndroidIconsAndSplash() {
  const resDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'res');
  if (!fs.existsSync(resDir)) {
    console.log('[prepare-android] Android res directory not found yet, skipping icon & splash generation.');
    return;
  }

  // 1. Adaptive Icon Background Color (#F8F8F7)
  const valuesDir = path.join(resDir, 'values');
  fs.mkdirSync(valuesDir, { recursive: true });
  fs.writeFileSync(
    path.join(valuesDir, 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#F8F8F7</color>
</resources>
`,
    'utf8'
  );

  // 2. Adaptive Icon Crisp Vector Foreground (108dp viewport, 66dp safe-zone compliant)
  const drawableDir = path.join(resDir, 'drawable');
  fs.mkdirSync(drawableDir, { recursive: true });
  const legacyV24Foreground = path.join(resDir, 'drawable-v24', 'ic_launcher_foreground.xml');
  if (fs.existsSync(legacyV24Foreground)) {
    fs.unlinkSync(legacyV24Foreground);
  }
  fs.writeFileSync(
    path.join(drawableDir, 'ic_launcher_foreground.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <!-- Four camera viewfinder corner brackets -->
    <path
        android:pathData="M30,41 L30,36.5 Q30,30 36.5,30 L41,30"
        android:strokeColor="#141413"
        android:strokeWidth="4.2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />
    <path
        android:pathData="M67,30 L71.5,30 Q78,30 78,36.5 L78,41"
        android:strokeColor="#141413"
        android:strokeWidth="4.2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />
    <path
        android:pathData="M78,67 L78,71.5 Q78,78 71.5,78 L67,78"
        android:strokeColor="#141413"
        android:strokeWidth="4.2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />
    <path
        android:pathData="M41,78 L36.5,78 Q30,78 30,71.5 L30,67"
        android:strokeColor="#141413"
        android:strokeWidth="4.2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />
    <!-- Minimalist face recognition mark -->
    <path
        android:pathData="M44.5,44 L44.5,48"
        android:strokeColor="#141413"
        android:strokeWidth="4.2"
        android:strokeLineCap="round" />
    <path
        android:pathData="M63.5,44 L63.5,48"
        android:strokeColor="#141413"
        android:strokeWidth="4.2"
        android:strokeLineCap="round" />
    <path
        android:pathData="M54,45 L54,53 Q54,55.5 51.8,55.5"
        android:strokeColor="#141413"
        android:strokeWidth="3.8"
        android:strokeLineCap="round"
        android:strokeLineJoin="round" />
    <path
        android:pathData="M45.5,61 Q54,67.5 62.5,61"
        android:strokeColor="#141413"
        android:strokeWidth="4.2"
        android:strokeLineCap="round" />
</vector>
`,
    'utf8'
  );

  // 3. Adaptive Icon XML (API 26+ & Android 13+ monochrome themed icon)
  const anydpiDir = path.join(resDir, 'mipmap-anydpi-v26');
  fs.mkdirSync(anydpiDir, { recursive: true });
  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`;
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher.xml'), adaptiveXml, 'utf8');
  fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_round.xml'), adaptiveXml, 'utf8');

  // 4. Legacy & APK-installer preview raster PNGs across all mipmap densities
  const densities = [
    { dir: 'mipmap-mdpi', iconSize: 48, fgSize: 108 },
    { dir: 'mipmap-hdpi', iconSize: 72, fgSize: 162 },
    { dir: 'mipmap-xhdpi', iconSize: 96, fgSize: 216 },
    { dir: 'mipmap-xxhdpi', iconSize: 144, fgSize: 324 },
    { dir: 'mipmap-xxxhdpi', iconSize: 192, fgSize: 432 },
  ];

  for (const d of densities) {
    const targetDir = path.join(resDir, d.dir);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'ic_launcher.png'),
      renderIconPngBuffer(d.iconSize, 'square')
    );
    fs.writeFileSync(
      path.join(targetDir, 'ic_launcher_round.png'),
      renderIconPngBuffer(d.iconSize, 'round')
    );
    fs.writeFileSync(
      path.join(targetDir, 'ic_launcher_foreground.png'),
      renderIconPngBuffer(d.fgSize, 'foreground')
    );
  }

  // 5. Replace Capacitor's default blue splash.png with clean warm-white minimalist splash.xml
  const splashDirs = [
    'drawable',
    'drawable-land-mdpi',
    'drawable-land-hdpi',
    'drawable-land-xhdpi',
    'drawable-land-xxhdpi',
    'drawable-land-xxxhdpi',
    'drawable-port-mdpi',
    'drawable-port-hdpi',
    'drawable-port-xhdpi',
    'drawable-port-xxhdpi',
    'drawable-port-xxxhdpi',
  ];
  for (const dirName of splashDirs) {
    const oldSplash = path.join(resDir, dirName, 'splash.png');
    if (fs.existsSync(oldSplash)) {
      fs.unlinkSync(oldSplash);
    }
  }
  fs.writeFileSync(
    path.join(drawableDir, 'splash.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/ic_launcher_background" />
    <item
        android:width="128dp"
        android:height="128dp"
        android:gravity="center"
        android:drawable="@drawable/ic_launcher_foreground" />
</layer-list>
`,
    'utf8'
  );

  console.log('[prepare-android] Generated minimalist Option-1 adaptive icons, mipmap PNGs, and warm-white splash screen.');
}

if (mode === 'models' || mode === 'all') {
  ensureFaceModels();
}
if (mode === 'icons' || mode === 'all') {
  writeWebIconPng();
}
if (mode === 'manifest' || mode === 'all') {
  patchAndroidManifest();
  patchAndroidVersionCode();
  writeNativeAndroidSources();
  writeAndroidIconsAndSplash();
}
