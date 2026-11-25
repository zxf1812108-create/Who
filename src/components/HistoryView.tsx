import React, { useState } from 'react';
import { Camera, Clock, Image as ImageIcon, Trash2 } from 'lucide-react';
import type { RecognitionHistoryEntry } from '../types/face';

interface HistoryViewProps {
  history: RecognitionHistoryEntry[];
  onDeleteEntry: (id: string) => Promise<void>;
  onClearAll: () => Promise<void>;
  onGoToCamera: () => void;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  onDeleteEntry,
  onClearAll,
  onGoToCamera,
}) => {
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            识别记录
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            共保存 {history.length} 次拍照与选图检索记录
          </p>
        </div>

        {history.length > 0 && (
          <div>
            {confirmClear ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-200 text-xs font-medium text-slate-700"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await onClearAll();
                    setConfirmClear(false);
                  }}
                  className="min-h-[40px] px-3.5 rounded-xl bg-red-600 text-white text-xs font-medium hover:bg-red-700"
                >
                  确认清空全部
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:text-red-600 hover:border-red-200 inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>清空记录</span>
              </button>
            )}
          </div>
        )}
      </div>

      {history.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 px-6 py-16 text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-500">
            <Clock className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">
              暂无识别记录
            </h2>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              使用拍照识别或从相册选图比对后，检索结果会自动保存在本地记录中。
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToCamera}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 inline-flex items-center gap-2"
          >
            <Camera className="w-4 h-4" />
            <span>前往拍照识别</span>
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
          {history.map((entry) => {
            const matchedNames = entry.matches
              .filter((m) => m.matched)
              .map((m) => m.name);
            const primaryMatch = entry.matches[0];

            return (
              <div
                key={entry.id}
                className="p-4 sm:p-5 flex items-center gap-4 hover:bg-slate-50/60 transition-colors"
              >
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-slate-100 border border-slate-200/80 overflow-hidden shrink-0">
                  <img
                    src={entry.snapshotDataUrl}
                    alt="识别快照"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-base font-semibold text-slate-900">
                      {matchedNames.length > 0
                        ? matchedNames.join('、')
                        : entry.matches.length > 0
                          ? '未匹配人物'
                          : '未检测到人脸'}
                    </span>
                    {primaryMatch && primaryMatch.matched && (
                      <span className="text-xs font-medium text-emerald-700 tabular-nums">
                        相似度 {primaryMatch.similarity}%
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-slate-500 tabular-nums flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      {entry.sourceType === 'camera' ? (
                        <Camera className="w-3.5 h-3.5" />
                      ) : (
                        <ImageIcon className="w-3.5 h-3.5" />
                      )}
                      {entry.sourceType === 'camera'
                        ? '相机拍摄'
                        : entry.sourceType === 'sample'
                          ? '示例测试'
                          : '相册照片'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>检测 {entry.matches.length} 人</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{entry.elapsedMs} ms</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDateTime(entry.timestamp)}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void onDeleteEntry(entry.id)}
                  aria-label="删除该条记录"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
