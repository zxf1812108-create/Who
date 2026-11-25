import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  FolderOpen,
  ImagePlus,
  Loader2,
  Sparkles,
  Upload,
  AlertCircle,
  ArrowRight,
  Users,
} from 'lucide-react';
import type { EngineState, ImportQueueItem } from '../types/face';
import { SAMPLE_PROFILES } from '../data/sampleProfiles';

interface BatchImportViewProps {
  engineState: EngineState;
  personCount: number;
  totalSampleCount: number;
  queue: ImportQueueItem[];
  isImporting: boolean;
  mergeIndexedSuffixes: boolean;
  onToggleMergeSuffixes: (val: boolean) => void;
  onImportFiles: (files: File[]) => Promise<void>;
  onImportSamples: () => Promise<void>;
  onClearQueue: () => void;
  onGoToCamera: () => void;
  onGoToLibrary: () => void;
}

export const BatchImportView: React.FC<BatchImportViewProps> = ({
  engineState,
  personCount,
  totalSampleCount,
  queue,
  isImporting,
  mergeIndexedSuffixes,
  onToggleMergeSuffixes,
  onImportFiles,
  onImportSamples,
  onClearQueue,
  onGoToCamera,
  onGoToLibrary,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Set webkitdirectory safely without TypeScript JSX attribute issues
  useEffect(() => {
    const input = folderInputRef.current;
    if (input) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []).filter((f) =>
      f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif)$/i.test(f.name)
    );
    e.target.value = '';
    if (selected.length > 0) {
      void onImportFiles(selected);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files || []).filter((f) =>
      f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif)$/i.test(f.name)
    );
    if (dropped.length > 0) {
      void onImportFiles(dropped);
    }
  };

  const successCount = queue.filter((q) => q.status === 'success').length;
  const failedCount = queue.filter((q) => q.status === 'no-face' || q.status === 'error').length;
  const processedCount = successCount + failedCount;
  const progressPct = queue.length > 0 ? Math.round((processedCount / queue.length) * 100) : 0;

  const isDisabled = engineState.status !== 'ready' || isImporting;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: Import Actions & Rules */}
      <div className="lg:col-span-5 space-y-5">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 space-y-5">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              批量导入人物照片
            </h1>
            <p className="text-sm text-slate-500 leading-relaxed">
              系统自动以照片文件名作为人物姓名，并在本地提取 128 维面部特征向量建立索引。
            </p>
          </div>

          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!isDisabled) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
              isDragging
                ? 'border-blue-600 bg-blue-50/60'
                : 'border-slate-200 bg-slate-50/70 hover:border-slate-300'
            }`}
          >
            <div className="mx-auto w-12 h-12 rounded-2xl bg-white border border-slate-200/80 flex items-center justify-center text-blue-600 mb-3">
              <Upload className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-slate-900">
              拖拽多张人像照片到此处，或点击下方选择
            </p>
            <p className="text-xs text-slate-500 mt-1">
              支持 JPG、PNG、WebP · 例如：张伟.jpg、李敏_1.png
            </p>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isDisabled}
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap"
              >
                <ImagePlus className="w-4 h-4 shrink-0" />
                <span>选择多张照片</span>
              </button>

              <button
                type="button"
                disabled={isDisabled}
                onClick={() => folderInputRef.current?.click()}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-800 text-sm font-medium flex items-center justify-center gap-2 hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap"
              >
                <FolderOpen className="w-4 h-4 shrink-0" />
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
          </div>

          {/* Filename Parsing Rule */}
          <div className="pt-2 border-t border-slate-100 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer select-none min-h-[44px]">
              <input
                type="checkbox"
                checked={mergeIndexedSuffixes}
                onChange={(e) => onToggleMergeSuffixes(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-700 leading-snug">
                自动合并同名序号照片
                <span className="block text-xs text-slate-500 mt-0.5">
                  例如 <span className="font-mono">陈默_1.jpg</span> 与{' '}
                  <span className="font-mono">陈默 (2).png</span> 会合并至「陈默」，保存多角度特征提升识别率
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* Sample Portraits Quick Loader */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                快速体验示例人像库
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                内置 4 张清晰人像，一键测试批量特征提取与检索比对
              </p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2.5">
            {SAMPLE_PROFILES.map((profile) => (
              <div key={profile.filename} className="space-y-1.5">
                <div className="aspect-[3/4] rounded-xl overflow-hidden bg-slate-100 border border-slate-200/70">
                  <img
                    src={profile.imageUrl}
                    alt={profile.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover object-top"
                  />
                </div>
                <p className="text-xs font-medium text-slate-700 text-center truncate">
                  {profile.filename}
                </p>
              </div>
            ))}
          </div>

          <button
            type="button"
            disabled={isDisabled}
            onClick={() => void onImportSamples()}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-slate-800 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
          >
            {isImporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>导入这 4 张示例照片并提取特征</span>
          </button>
        </div>
      </div>

      {/* Right Column: Live Extraction Queue & Database Overview */}
      <div className="lg:col-span-7 space-y-5">
        {/* Clean Unboxed Stats Strip */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-xs text-slate-500">已建档人物</div>
              <div className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">
                {personCount}
                <span className="text-xs font-normal text-slate-500 ml-1">人</span>
              </div>
            </div>
            <div className="h-9 w-px bg-slate-200" />
            <div>
              <div className="text-xs text-slate-500">面部特征样本</div>
              <div className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">
                {totalSampleCount}
                <span className="text-xs font-normal text-slate-500 ml-1">组</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {personCount > 0 && (
              <>
                <button
                  type="button"
                  onClick={onGoToLibrary}
                  className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Users className="w-4 h-4" />
                  <span>查看人物库</span>
                </button>
                <button
                  type="button"
                  onClick={onGoToCamera}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <span>去拍照识别</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Batch Extraction Queue */}
        <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                特征提取队列
              </h2>
              {queue.length > 0 ? (
                <div className="text-xs text-slate-500 mt-0.5 tabular-nums flex items-center gap-2">
                  <span>共 {queue.length} 张</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-700">成功 {successCount}</span>
                  {failedCount > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-amber-700">未识别 {failedCount}</span>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500 mt-0.5">
                  导入照片后将在此实时显示人脸定位与 128 维特征编码进度
                </p>
              )}
            </div>

            {queue.length > 0 && !isImporting && (
              <button
                type="button"
                onClick={onClearQueue}
                className="min-h-[38px] px-3 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap"
              >
                清空记录
              </button>
            )}
          </div>

          {queue.length > 0 && (
            <div className="h-1 bg-slate-100 w-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}

          {queue.length === 0 ? (
            <div className="px-6 py-14 text-center space-y-2">
              <p className="text-sm font-medium text-slate-700">
                暂无正在处理的照片任务
              </p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                建议选择正面清晰、光线均匀的单人照片，并以人物真实姓名命名文件（如 <span className="font-mono text-slate-700">王磊.jpg</span>）。
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
              {queue.map((item) => (
                <li
                  key={item.id}
                  className="px-5 py-3.5 flex items-center gap-3.5"
                >
                  <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200/70 overflow-hidden shrink-0 flex items-center justify-center">
                    {item.thumbnail ? (
                      <img
                        src={item.thumbnail}
                        alt={item.parsedName}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : item.status === 'processing' ? (
                      <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                    ) : item.status === 'no-face' || item.status === 'error' ? (
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                    ) : (
                      <span className="text-xs text-slate-400">待处理</span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 truncate">
                        {item.parsedName}
                      </span>
                      <span className="text-xs text-slate-400 font-mono truncate">
                        {item.filename}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                      {item.status === 'pending' && <span>排队等待提取特征...</span>}
                      {item.status === 'processing' && (
                        <span className="text-blue-600">正在定位面部并提取 128 维特征...</span>
                      )}
                      {item.status === 'success' && (
                        <span className="text-emerald-700 tabular-nums">
                          {item.mergedIntoExisting
                            ? '已追加至已有档案'
                            : '已建立新人物特征档案'}
                          {typeof item.detectionScore === 'number'
                            ? ` · 清晰度 ${Math.round(item.detectionScore * 100)}%`
                            : ''}
                        </span>
                      )}
                      {(item.status === 'no-face' || item.status === 'error') && (
                        <span className="text-amber-700">
                          {item.message || '未检测到清晰人脸，已跳过'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    {item.status === 'success' && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    )}
                    {item.status === 'processing' && (
                      <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                    )}
                    {(item.status === 'no-face' || item.status === 'error') && (
                      <AlertCircle className="w-5 h-5 text-amber-500" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
