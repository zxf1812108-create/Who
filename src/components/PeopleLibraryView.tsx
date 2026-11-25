import React, { useMemo, useRef, useState } from 'react';
import {
  Download,
  ImagePlus,
  Loader2,
  Search,
  Trash2,
  Upload,
  UserPlus,
  X,
  Check,
} from 'lucide-react';
import type { EngineState, PersonRecord } from '../types/face';
import { VectorBarcode } from './VectorBarcode';

interface PeopleLibraryViewProps {
  persons: PersonRecord[];
  engineState: EngineState;
  onUpdatePerson: (personId: string, name: string, note: string) => Promise<void>;
  onAddSampleToPerson: (personId: string, file: File) => Promise<{ ok: boolean; message: string }>;
  onDeleteSample: (personId: string, sampleId: string) => Promise<void>;
  onDeletePerson: (personId: string) => Promise<void>;
  onExportBackup: () => void;
  onImportBackup: (file: File) => Promise<{ ok: boolean; message: string }>;
  onGoToImport: () => void;
}

type SortKey = 'updated' | 'name' | 'samples';

function formatShortDate(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hh}:${mm}`;
}

export const PeopleLibraryView: React.FC<PeopleLibraryViewProps> = ({
  persons,
  engineState,
  onUpdatePerson,
  onAddSampleToPerson,
  onDeleteSample,
  onDeletePerson,
  onExportBackup,
  onImportBackup,
  onGoToImport,
}) => {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('updated');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  const [editName, setEditName] = useState('');
  const [editNote, setEditNote] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [addingSample, setAddingSample] = useState(false);
  const [detailNotice, setDetailNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [toolbarNotice, setToolbarNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const addSampleInputRef = useRef<HTMLInputElement>(null);
  const importBackupInputRef = useRef<HTMLInputElement>(null);

  const selectedPerson = useMemo(
    () => persons.find((p) => p.id === selectedPersonId) || null,
    [persons, selectedPersonId]
  );

  const openPersonSheet = (person: PersonRecord) => {
    setSelectedPersonId(person.id);
    setEditName(person.name);
    setEditNote(person.note);
    setConfirmDeleteId(null);
    setDetailNotice(null);
  };

  const closePersonSheet = () => {
    setSelectedPersonId(null);
    setConfirmDeleteId(null);
    setDetailNotice(null);
  };

  const filteredPersons = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = persons.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.note.toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'zh-CN');
      if (sortBy === 'samples') return b.samples.length - a.samples.length;
      return b.updatedAt - a.updatedAt;
    });
  }, [persons, query, sortBy]);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPerson) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setDetailNotice({ type: 'err', text: '人物姓名不能为空' });
      return;
    }
    await onUpdatePerson(selectedPerson.id, trimmed, editNote.trim());
    setDetailNotice({ type: 'ok', text: '档案信息已保存' });
  };

  const handleAddSampleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedPerson) return;
    setAddingSample(true);
    setDetailNotice(null);
    const result = await onAddSampleToPerson(selectedPerson.id, file);
    setAddingSample(false);
    setDetailNotice({
      type: result.ok ? 'ok' : 'err',
      text: result.message,
    });
  };

  const handleBackupUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const result = await onImportBackup(file);
    setToolbarNotice({
      type: result.ok ? 'ok' : 'err',
      text: result.message,
    });
    window.setTimeout(() => setToolbarNotice(null), 4000);
  };

  const totalSamples = persons.reduce((acc, p) => acc + p.samples.length, 0);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              人物特征库
            </h1>
            <div className="text-xs text-slate-500 mt-0.5 tabular-nums flex items-center gap-2">
              <span>{persons.length} 位人物</span>
              <span aria-hidden="true">·</span>
              <span>{totalSamples} 组 128 维特征模板</span>
              <span aria-hidden="true">·</span>
              <span>本地离线存储</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              disabled={persons.length === 0}
              onClick={onExportBackup}
              className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs sm:text-sm font-medium hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-45 disabled:pointer-events-none whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              <span>导出备份</span>
            </button>
            <button
              type="button"
              onClick={() => importBackupInputRef.current?.click()}
              className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs sm:text-sm font-medium hover:bg-slate-50 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Upload className="w-4 h-4" />
              <span>恢复备份</span>
            </button>
            <button
              type="button"
              onClick={onGoToImport}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-blue-600 text-white text-xs sm:text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5 whitespace-nowrap"
            >
              <UserPlus className="w-4 h-4" />
              <span>批量导入</span>
            </button>

            <input
              ref={importBackupInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleBackupUpload}
              className="hidden"
            />
          </div>
        </div>

        {toolbarNotice && (
          <div
            className={`text-xs px-3.5 py-2.5 rounded-xl border ${
              toolbarNotice.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            {toolbarNotice.text}
          </div>
        )}

        {/* Search + Sort */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索姓名或分组备注..."
              className="w-full min-h-[44px] pl-10 pr-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl shrink-0">
            {(
              [
                { key: 'updated', label: '最近更新' },
                { key: 'name', label: '按姓名' },
                { key: 'samples', label: '样本数' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSortBy(opt.key)}
                className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  sortBy === opt.key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Directory Grid */}
      {persons.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 px-6 py-16 text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-500">
            <UserPlus className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">
              人物特征库尚为空
            </h2>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              请先批量导入以姓名命名的人物照片，系统会自动提取并保存面部特征，随后即可在拍照时实时识别姓名。
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToImport}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 inline-flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            <span>立即批量导入照片</span>
          </button>
        </div>
      ) : filteredPersons.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 px-6 py-12 text-center">
          <p className="text-sm text-slate-600">
            未找到与「{query}」匹配的人物档案
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5 sm:gap-4">
          {filteredPersons.map((person) => {
            const cover = person.samples[0]?.thumbnail;
            return (
              <button
                key={person.id}
                type="button"
                onClick={() => openPersonSheet(person)}
                className="group text-left bg-white rounded-2xl border border-slate-200/80 overflow-hidden hover:border-blue-300 hover:shadow-sm transition-all focus-visible:outline-2 focus-visible:outline-blue-600"
              >
                <div className="aspect-square bg-slate-100 overflow-hidden relative">
                  {cover ? (
                    <img
                      src={cover}
                      alt={person.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 text-2xl font-semibold">
                      {person.name.slice(0, 1)}
                    </div>
                  )}
                </div>

                <div className="p-3.5 space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-base font-semibold text-slate-900 truncate">
                      {person.name}
                    </h3>
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {person.note ? person.note : '未设置备注'}
                  </div>
                  <div className="text-[11px] text-slate-400 tabular-nums pt-0.5 flex items-center gap-1.5">
                    <span>{person.samples.length} 组特征</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatShortDate(person.updatedAt)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Person Detail Bottom Sheet (Mobile) / Modal (Desktop) */}
      {selectedPerson && (
        <div
          className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-slate-950/45 backdrop-blur-xs p-0 lg:p-6"
          onClick={closePersonSheet}
        >
          <div
            className="w-full lg:max-w-xl bg-white rounded-t-3xl lg:rounded-2xl max-h-[88vh] flex flex-col overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile Drag Handle */}
            <div className="lg:hidden pt-3 pb-1 flex justify-center">
              <div className="w-10 h-1.5 rounded-full bg-slate-300" />
            </div>

            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-900 truncate">
                  {selectedPerson.name} 的面部特征档案
                </h2>
                <p className="text-xs text-slate-500 tabular-nums">
                  {selectedPerson.samples.length} 组样本 · 128 维浮点特征向量
                </p>
              </div>
              <button
                type="button"
                onClick={closePersonSheet}
                aria-label="关闭弹窗"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-6">
              {detailNotice && (
                <div
                  className={`text-xs px-3.5 py-2.5 rounded-xl border ${
                    detailNotice.type === 'ok'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  {detailNotice.text}
                </div>
              )}

              {/* Edit Name & Note */}
              <form onSubmit={handleSaveEdit} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      人物姓名
                    </label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      分组或备注（选填）
                    </label>
                    <input
                      type="text"
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      placeholder="例如：研发部 / 高三(2)班"
                      className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 inline-flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>保存资料修改</span>
                </button>
              </form>

              {/* Registered Face Samples */}
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      已采集的人脸样本
                    </h3>
                    <p className="text-xs text-slate-500">
                      同一人添加不同光线或角度的照片，可显著提高实拍识别准确度
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={engineState.status !== 'ready' || addingSample}
                    onClick={() => addSampleInputRef.current?.click()}
                    className="min-h-[40px] px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                  >
                    {addingSample ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="w-3.5 h-3.5" />
                    )}
                    <span>补充样本</span>
                  </button>
                  <input
                    ref={addSampleInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAddSampleFile}
                    className="hidden"
                  />
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {selectedPerson.samples.map((sample) => (
                    <div key={sample.id} className="space-y-1 relative group">
                      <div className="aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200/80 relative">
                        <img
                          src={sample.thumbnail}
                          alt={sample.sourceFilename}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                        {selectedPerson.samples.length > 1 && (
                          <button
                            type="button"
                            onClick={() => void onDeleteSample(selectedPerson.id, sample.id)}
                            aria-label="移除该样本"
                            className="absolute top-1.5 right-1.5 w-7 h-7 rounded-lg bg-slate-900/75 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate font-mono">
                        {sample.sourceFilename}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 128D Vector Fingerprint */}
              {selectedPerson.samples[0] && (
                <div className="space-y-2 pt-4 border-t border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-900">
                    主特征向量指纹
                  </h3>
                  <VectorBarcode descriptor={selectedPerson.samples[0].descriptor} />
                </div>
              )}

              {/* Delete Person Zone */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                {confirmDeleteId === selectedPerson.id ? (
                  <div className="w-full flex items-center justify-between gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <span className="text-xs font-medium text-red-800">
                      确定删除「{selectedPerson.name}」及全部特征数据？
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="min-h-[36px] px-3 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 font-medium"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await onDeletePerson(selectedPerson.id);
                          closePersonSheet();
                        }}
                        className="min-h-[36px] px-3 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700"
                      >
                        确认删除
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(selectedPerson.id)}
                    className="min-h-[42px] px-3.5 py-2 rounded-xl text-red-600 hover:bg-red-50 text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>删除该人物档案</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
