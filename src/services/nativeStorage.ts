import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeDocumentImageRef {
  uri: string;
  name: string;
  mimeType: string;
}

interface StoragePickerPlugin {
  pickMultipleImages(): Promise<{
    cancelled: boolean;
    files?: NativeDocumentImageRef[];
  }>;
  pickFolderImages(): Promise<{
    cancelled: boolean;
    files?: NativeDocumentImageRef[];
  }>;
  readDocumentImage(options: { uri: string }): Promise<{
    dataUrl: string;
  }>;
  pickExportFolder(): Promise<{
    cancelled: boolean;
    treeUri?: string;
    folderName?: string;
  }>;
  beginBackupWrite(options: {
    treeUri: string;
    filename: string;
  }): Promise<{
    started: boolean;
    filename?: string;
  }>;
  appendBackupChunk(options: { chunk: string }): Promise<{ ok: boolean }>;
  finishBackupWrite(): Promise<{
    filename?: string;
    bytesWritten: number;
  }>;
  pickBackupFile(): Promise<{
    cancelled: boolean;
    filename?: string;
    totalChars?: number;
  }>;
  readBackupChunk(options: {
    offset: number;
    length: number;
  }): Promise<{
    chunk: string;
    done: boolean;
  }>;
  clearBackupReadCache(): Promise<void>;
}

const StoragePicker = registerPlugin<StoragePickerPlugin>('StoragePicker');

export interface ImportableImageSource {
  name: string;
  loadDataUrl: () => Promise<string>;
}

const IMAGE_EXT_REGEX = /\.(jpe?g|png|webp|bmp|gif)$/i;

function isImageFilename(name: string, mimeType = ''): boolean {
  return mimeType.startsWith('image/') || IMAGE_EXT_REGEX.test(name);
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片文件失败'));
    reader.readAsDataURL(blob);
  });
}

// Type helpers for Desktop File System Access API
interface FsFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: string | Blob): Promise<void>;
    close(): Promise<void>;
  }>;
}

interface FsDirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FsFileHandle | FsDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
}

interface WindowWithFsApi extends Window {
  showDirectoryPicker?: (options?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<FsDirectoryHandle>;
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FsFileHandle[]>;
}

async function collectImagesFromDirectoryHandle(
  dirHandle: FsDirectoryHandle,
  results: ImportableImageSource[],
  depth = 0
): Promise<void> {
  if (depth > 3) return;
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      if (isImageFilename(entry.name)) {
        results.push({
          name: entry.name,
          loadDataUrl: async () => {
            const file = await entry.getFile();
            return readBlobAsDataUrl(file);
          },
        });
      }
    } else if (entry.kind === 'directory') {
      await collectImagesFromDirectoryHandle(entry, results, depth + 1);
    }
  }
}

/**
 * Opens a real system Folder Picker (native Android SAF on APK, OS folder dialog on desktop)
 * and returns lazy image loaders so large folders never exhaust memory.
 */
export async function pickFolderImagesNativeOrWeb(
  fallbackClickInput: () => void
): Promise<{
  handled: boolean;
  cancelled: boolean;
  items: ImportableImageSource[];
}> {
  // 1. Native Android APK via StoragePicker plugin (ACTION_OPEN_DOCUMENT_TREE)
  if (Capacitor.isNativePlatform()) {
    const res = await StoragePicker.pickFolderImages();
    if (res.cancelled) {
      return { handled: true, cancelled: true, items: [] };
    }
    const items: ImportableImageSource[] = (res.files || []).map((f) => ({
      name: f.name,
      loadDataUrl: async () => {
        const read = await StoragePicker.readDocumentImage({ uri: f.uri });
        return read.dataUrl;
      },
    }));
    return { handled: true, cancelled: false, items };
  }

  // 2. Desktop Chrome/Edge OS Folder Picker
  const win = window as WindowWithFsApi;
  if (typeof win.showDirectoryPicker === 'function') {
    try {
      const dirHandle = await win.showDirectoryPicker({ mode: 'read' });
      const items: ImportableImageSource[] = [];
      await collectImagesFromDirectoryHandle(dirHandle, items);
      return { handled: true, cancelled: false, items };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { handled: true, cancelled: true, items: [] };
      }
      // Fall through to HTML input fallback if browser restricts FS API inside iframe
    }
  }

  // 3. Fallback to HTML webkitdirectory input
  fallbackClickInput();
  return { handled: false, cancelled: false, items: [] };
}

/**
 * Opens the native Android SAF document picker (ACTION_OPEN_DOCUMENT + EXTRA_ALLOW_MULTIPLE)
 * so original filenames are preserved instead of being replaced with Android Photo Picker IDs.
 */
export async function pickMultipleImagesNativeOrWeb(
  fallbackClickInput: () => void
): Promise<{
  handled: boolean;
  cancelled: boolean;
  items: ImportableImageSource[];
}> {
  if (Capacitor.isNativePlatform()) {
    const res = await StoragePicker.pickMultipleImages();
    if (res.cancelled) {
      return { handled: true, cancelled: true, items: [] };
    }
    const items: ImportableImageSource[] = (res.files || []).map((f) => ({
      name: f.name,
      loadDataUrl: async () => {
        const read = await StoragePicker.readDocumentImage({ uri: f.uri });
        return read.dataUrl;
      },
    }));
    return { handled: true, cancelled: false, items };
  }

  fallbackClickInput();
  return { handled: false, cancelled: false, items: [] };
}

/**
 * Opens a real system Folder Picker so the user chooses the target folder,
 * then writes the full backup JSON directly into that folder.
 */
export async function exportBackupToChosenFolder(
  filename: string,
  content: string
): Promise<{
  cancelled: boolean;
  ok: boolean;
  message: string;
}> {
  // 1. Native Android APK: Two-step SAF folder pick + chunked streaming write
  //    (avoids Android 1MB Binder TransactionTooLargeException on large photo backups)
  if (Capacitor.isNativePlatform()) {
    const picked = await StoragePicker.pickExportFolder();
    if (picked.cancelled || !picked.treeUri) {
      return { cancelled: true, ok: false, message: '' };
    }

    const CHUNK_CHARS = 180_000;
    await StoragePicker.beginBackupWrite({
      treeUri: picked.treeUri,
      filename,
    });

    for (let offset = 0; offset < content.length; offset += CHUNK_CHARS) {
      const chunk = content.slice(offset, offset + CHUNK_CHARS);
      await StoragePicker.appendBackupChunk({ chunk });
    }

    const finished = await StoragePicker.finishBackupWrite();
    const targetFolder = picked.folderName ? `「${picked.folderName}」文件夹中的 ` : '';
    return {
      cancelled: false,
      ok: true,
      message: `已将全部照片、特征数据与设置导出至 ${targetFolder}${finished.filename || filename}`,
    };
  }

  // 2. Desktop Chrome/Edge: OS Folder Picker + direct write
  const win = window as WindowWithFsApi;
  if (typeof win.showDirectoryPicker === 'function') {
    try {
      const dirHandle = await win.showDirectoryPicker({ mode: 'readwrite' });
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return {
        cancelled: false,
        ok: true,
        message: `已将完整备份导出至「${dirHandle.name}」文件夹：${filename}`,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { cancelled: true, ok: false, message: '' };
      }
      // Fall through to standard browser download if iframe blocks showDirectoryPicker
    }
  }

  // 3. Standard browser download fallback
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return {
    cancelled: false,
    ok: true,
    message: `已导出完整备份文件：${filename}`,
  };
}

/**
 * Opens the native Android file/folder browser (ACTION_OPEN_DOCUMENT) or web file picker
 * so the user can navigate folders and choose a backup JSON file to restore.
 */
export async function pickBackupFileNativeOrWeb(
  fallbackClickInput: () => void
): Promise<{
  handled: boolean;
  cancelled: boolean;
  filename?: string;
  content?: string;
}> {
  // 1. Native Android APK: ACTION_OPEN_DOCUMENT + chunked read from native cache
  //    (avoids Android WebView evaluateJavascript payload truncation on multi-MB backups)
  if (Capacitor.isNativePlatform()) {
    const res = await StoragePicker.pickBackupFile();
    if (res.cancelled || !res.totalChars || res.totalChars <= 0) {
      return { handled: true, cancelled: true };
    }

    const CHUNK_CHARS = 180_000;
    const parts: string[] = [];
    try {
      for (let offset = 0; offset < res.totalChars; offset += CHUNK_CHARS) {
        const piece = await StoragePicker.readBackupChunk({
          offset,
          length: CHUNK_CHARS,
        });
        parts.push(piece.chunk);
        if (piece.done) break;
      }
    } finally {
      try {
        await StoragePicker.clearBackupReadCache();
      } catch {
        // Ignore cache cleanup errors
      }
    }

    return {
      handled: true,
      cancelled: false,
      filename: res.filename,
      content: parts.join(''),
    };
  }

  // 2. Desktop Chrome/Edge OS file dialog
  const win = window as WindowWithFsApi;
  if (typeof win.showOpenFilePicker === 'function') {
    try {
      const [fileHandle] = await win.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: '认脸完整备份文件',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      if (!fileHandle) return { handled: true, cancelled: true };
      const file = await fileHandle.getFile();
      const content = await file.text();
      return {
        handled: true,
        cancelled: false,
        filename: file.name,
        content,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { handled: true, cancelled: true };
      }
      // Fall through to file input fallback
    }
  }

  // 3. Fallback to HTML file input
  fallbackClickInput();
  return { handled: false, cancelled: false };
}
