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

if (mode === 'models' || mode === 'all') {
  ensureFaceModels();
}
if (mode === 'manifest' || mode === 'all') {
  patchAndroidManifest();
}
