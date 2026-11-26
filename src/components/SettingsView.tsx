import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  ImagePlus,
  Loader2,
  Minus,
  Plus,
  Upload,
} from 'lucide-react';
import type { EngineState, ImportQueueItem } from '../types/face';
import type { ImportableImageSource } from '../services/nativeStorage';
import {
  pickBackupFileNativeOrWeb,
  pickFolderImagesNativeOrWeb,
} from '../services/nativeStorage';

interface SettingsViewProps {
  engineState: EngineState;
  personCount: number;
  totalSampleCount: number;
  queue: ImportQueueItem[];
  isImporting: boolean;
  mergeIndexedSuffixes: boolean;
  minSimilarity: number;
  onToggleMergeSuffixes: (val: boolean) => void;
  onImportFiles: (files: File[]) => Promise<void>;
  onImportSources: (sources: ImportableImageSource[]) => Promise<void>;
  onClearQueue: () => void;
  onChangeMinSimilarity: (val: number) => void;
  onExportBackup: () => Promise<{ cancelled: boolean; ok: boolean; message: string }>;
  onImportBackupContent: (rawJson: string) => Promise<{ ok: boolean; message: string }>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  engineState,
  personCount,
  totalSampleCount,
  queue,
  isImporting,
  mergeIndexedSuffixes,
  minSimilarity,
  onToggleMergeSuffixes,
  onImportFiles,
  onImportSources,
  onClearQueue,
  onChangeMinSimilarity,
  onExportBackup,
  onImportBackupContent,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const [backupBusy, setBackupBusy] = useState<'export' | 'restore' | null>(null);
  const [backupNotice, setBackupNotice] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const input = folderInputRef.current;
    if (input) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const showNotice = (type: 'ok' | 'err', text: string) => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    setBackupNotice({ type, text });
    noticeTimerRef.current = window.setTimeout(() => {
      setBackupNotice(null);
      noticeTimerRef.current = null;
    }, 8000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []).filter(
      (f) =>
        f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif)$/i.test(f.name)
    );
    e.target.value = '';
    if (selected.length > 0) {
      void onImportFiles(selected);
    }
  };

  const handleFolderButtonClick = async () => {
    if (isDisabled) return;
    try {
      const result = await pickFolderImagesNativeOrWeb(() => {
        folderInputRef.current?.click();
      });
      if (!result.handled || result.cancelled) return;
      if (result.items.length === 0) {
        showNotice('err', '所选文件夹中没有找到可导入的图片文件');
        return;
      }
      await onImportSources(result.items);
    } catch (err) {
      showNotice(
        'err',
        err instanceof Error ? err.message : '打开文件夹失败，请重试'
      );
    }
  };

  const handleExportClick = async () => {
    if (backupBusy) return;
    setBackupBusy('export');
    setBackupNotice(null);
    try {
      const res = await onExportBackup();
      if (!res.cancelled) {
        showNotice(res.ok ? 'ok' : 'err', res.message);
      }
    } catch (err) {
      showNotice(
        'err',
        err instanceof Error ? err.message : '导出备份失败，请重试'
      );
    } finally {
      setBackupBusy(null);
    }
  };

  const handleRestoreClick = async () => {
    if (backupBusy) return;
    setBackupBusy('restore');
    setBackupNotice(null);
    try {
      const picked = await pickBackupFileNativeOrWeb(() => {
        backupInputRef.current?.click();
      });
      if (!picked.handled || picked.cancelled || !picked.content) {
        return;
      }
      const res = await onImportBackupContent(picked.content);
      showNotice(res.ok ? 'ok' : 'err', res.message);
    } catch (err) {
      showNotice(
        'err',
        err instanceof Error ? err.message : '读取备份文件失败'
      );
    } finally {
      setBackupBusy(null);
    }
  };

  const handleBackupInputFallback = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackupBusy('restore');
    try {
      const content = await file.text();
      const res = await onImportBackupContent(content);
      showNotice(res.ok ? 'ok' : 'err', res.message);
    } catch (err) {
      showNotice(
        'err',
        err instanceof Error ? err.message : '读取备份文件失败'
      );
    } finally {
      setBackupBusy(null);
    }
  };

  const isDisabled = engineState.status !== 'ready' || isImporting;
  const successCount = queue.filter((q) => q.status === 'success').length;
  const failedCount = queue.filter(
    (q) => q.status === 'no-face' || q.status === 'error'
  ).length;
  const processedCount = successCount + failedCount;
  const progressPct =
    queue.length > 0 ? Math.round((processedCount / queue.length) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* UPPER SECTION: Batch Import Photos & Full Backup */}
      <section
        aria-label="导入照片"
        className="bg-white rounded-2xl border border-neutral-200/90 p-5 space-y-4"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-neutral-950">
              导入照片
            </h1>
            <p className="text-xs text-neutral-500 mt-0.5">
              以照片文件名作为人物姓名，自动提取面部特征
            </p>
          </div>
          <span className="text-xs text-neutral-400 tabular-nums shrink-0">
            库内 {personCount} 人 · {totalSampleCount} 张
          </span>
        </div>

        {/* Primary Import Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={isDisabled}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[48px] px-4 py-3 rounded-xl bg-neutral-950 text-white text-sm font-medium hover:bg-neutral-800 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-45"
          >
            <ImagePlus className="w-4 h-4" strokeWidth={1.8} />
            <span>批量导入照片</span>
          </button>

          <button
            type="button"
            disabled={isDisabled}
            onClick={() => void handleFolderButtonClick()}
            className="min-h-[48px] px-4 py-3 rounded-xl bg-[#F4F4F2] text-neutral-900 text-sm font-medium hover:bg-neutral-200/75 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-45"
          >
            <FolderOpen className="w-4 h-4" strokeWidth={1.8} />
            <span>导入整个文件夹</span>
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
        <input
          ref={folderInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Merge Same-Person Suffix Option */}
        <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
          <input
            type="checkbox"
            checked={mergeIndexedSuffixes}
            onChange={(e) => onToggleMergeSuffixes(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-neutral-900"
          />
          <span className="text-xs text-neutral-600 leading-relaxed">
            自动合并同名序号照片（如{' '}
            <span className="font-mono text-neutral-800">张三_1.jpg</span> 与{' '}
            <span className="font-mono text-neutral-800">张三_2.jpg</span>{' '}
            归为同一人）
          </span>
        </label>

        {/* Live Import Queue */}
        {queue.length > 0 && (
          <div className="pt-3 border-t border-neutral-100 space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="text-neutral-600 tabular-nums flex items-center gap-1.5">
                <span>
                  处理进度 {processedCount}/{queue.length}
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-700">成功 {successCount}</span>
                {failedCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-700">未识别 {failedCount}</span>
                  </>
                )}
              </div>
              {!isImporting && (
                <button
                  type="button"
                  onClick={onClearQueue}
                  className="text-neutral-400 hover:text-neutral-800"
                >
                  清除记录
                </button>
              )}
            </div>

            <div className="h-1 bg-neutral-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-neutral-900 transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <ul className="divide-y divide-neutral-100 max-h-56 overflow-y-auto">
              {queue.map((item) => (
                <li
                  key={item.id}
                  className="py-2 flex items-center gap-3 text-xs"
                >
                  <div className="w-9 h-9 rounded-lg bg-[#F4F4F2] overflow-hidden shrink-0 flex items-center justify-center">
                    {item.thumbnail ? (
                      <img
                        src={item.thumbnail}
                        alt={item.parsedName}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : item.status === 'processing' ? (
                      <Loader2 className="w-3.5 h-3.5 text-neutral-600 animate-spin" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-neutral-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-neutral-900 truncate">
                      {item.parsedName}
                    </div>
                    <div className="text-[11px] text-neutral-400 truncate">
                      {item.status === 'processing'
                        ? '提取面部特征中...'
                        : item.status === 'success'
                          ? item.mergedIntoExisting
                            ? '已追加至已有档案'
                            : '已建立新档案'
                          : item.status === 'pending'
                            ? '排队等待'
                            : item.message || '未检测到人脸'}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {item.status === 'success' && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    )}
                    {item.status === 'processing' && (
                      <Loader2 className="w-4 h-4 text-neutral-500 animate-spin" />
                    )}
                    {(item.status === 'no-face' || item.status === 'error') && (
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Full Data Backup & Restore Utilities */}
        <div className="pt-3 border-t border-neutral-100 flex items-center justify-around gap-4 text-xs">
          <button
            type="button"
            disabled={backupBusy !== null}
            onClick={() => void handleExportClick()}
            className="min-h-[40px] px-3 text-neutral-700 hover:text-neutral-950 inline-flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
          >
            {backupBusy === 'export' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{backupBusy === 'export' ? '正在导出...' : '导出备份'}</span>
          </button>
          <button
            type="button"
            disabled={backupBusy !== null}
            onClick={() => void handleRestoreClick()}
            className="min-h-[40px] px-3 text-neutral-700 hover:text-neutral-950 inline-flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
          >
            {backupBusy === 'restore' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            <span>{backupBusy === 'restore' ? '正在恢复...' : '恢复备份'}</span>
          </button>
          <input
            ref={backupInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleBackupInputFallback}
            className="hidden"
          />
        </div>

        {backupNotice && (
          <div
            className={`text-xs px-3 py-2.5 rounded-xl border leading-relaxed ${
              backupNotice.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            {backupNotice.text}
          </div>
        )}
      </section>

      {/* LOWER SECTION: Minimalist Similarity Slider */}
      <section
        aria-label="匹配相似度设置"
        className="bg-white rounded-2xl border border-neutral-200/90 p-5 space-y-4"
      >
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold text-neutral-950">
            匹配相似度
          </h2>
          <p className="text-xs text-neutral-500 leading-relaxed">
            数值越小，匹配越宽松，越容易认出，但也容易认错；数值越大，匹配越严格，越不容易认出，但也不容易认错。
          </p>
        </div>

        {/* Precision Slider + +/- 1% Stepper with Centered Value Beneath */}
        <div className="pt-1 space-y-2">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              aria-label="降低 1%"
              disabled={minSimilarity <= 40}
              onClick={() => onChangeMinSimilarity(minSimilarity - 1)}
              className="min-h-[44px] min-w-[44px] rounded-xl border border-neutral-200 bg-[#F8F8F7] hover:bg-neutral-100 active:scale-95 flex items-center justify-center text-neutral-800 disabled:opacity-35 transition-all shrink-0"
            >
              <Minus className="w-4 h-4" />
            </button>

            <div className="flex-1 px-1">
              <input
                type="range"
                aria-label="精确调节最低匹配相似度"
                min={40}
                max={85}
                step={1}
                value={minSimilarity}
                onChange={(e) => onChangeMinSimilarity(Number(e.target.value))}
                className="w-full h-2 accent-neutral-950 cursor-pointer"
              />
            </div>

            <button
              type="button"
              aria-label="提高 1%"
              disabled={minSimilarity >= 85}
              onClick={() => onChangeMinSimilarity(minSimilarity + 1)}
              className="min-h-[44px] min-w-[44px] rounded-xl border border-neutral-200 bg-[#F8F8F7] hover:bg-neutral-100 active:scale-95 flex items-center justify-center text-neutral-800 disabled:opacity-35 transition-all shrink-0"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="text-center text-base font-semibold font-mono text-neutral-950 tabular-nums">
            {minSimilarity}%
          </div>
        </div>
      </section>
    </div>
  );
};
