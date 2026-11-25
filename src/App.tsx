import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Camera,
  Clock,
  FolderPlus,
  Loader2,
  Users,
  AlertCircle,
} from 'lucide-react';
import type {
  AppTab,
  EngineState,
  FaceSample,
  ImportQueueItem,
  PersonRecord,
  RecognitionHistoryEntry,
} from './types/face';
import {
  extractPrimaryFaceFromImage,
  initializeFaceEngine,
  loadImageElement,
  parsePersonNameFromFilename,
  readFileAsDataUrl,
} from './services/faceEngine';
import {
  addHistoryEntry,
  clearAllHistory,
  deleteHistoryEntry,
  deletePersonById,
  getAllHistory,
  getAllPersons,
  parseBackupJson,
  putPerson,
  serializeBackup,
} from './services/faceDb';
import { SAMPLE_PROFILES } from './data/sampleProfiles';
import { CameraRecognizeView } from './components/CameraRecognizeView';
import { BatchImportView } from './components/BatchImportView';
import { PeopleLibraryView } from './components/PeopleLibraryView';
import { HistoryView } from './components/HistoryView';

const NAV_ITEMS: Array<{
  id: AppTab;
  label: string;
  mobileLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'camera', label: '拍照识别', mobileLabel: '拍照识人', icon: Camera },
  { id: 'import', label: '批量导入', mobileLabel: '批量导入', icon: FolderPlus },
  { id: 'library', label: '人物库', mobileLabel: '人物库', icon: Users },
  { id: 'history', label: '识别记录', mobileLabel: '记录', icon: Clock },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('camera');
  const [engineState, setEngineState] = useState<EngineState>({
    status: 'loading',
    progressText: '正在初始化本地人脸特征模型...',
  });

  const [persons, setPersons] = useState<PersonRecord[]>([]);
  const [history, setHistory] = useState<RecognitionHistoryEntry[]>([]);
  const [threshold, setThreshold] = useState<number>(0.52);

  // Batch import state persisted across tab switches
  const [importQueue, setImportQueue] = useState<ImportQueueItem[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [mergeIndexedSuffixes, setMergeIndexedSuffixes] = useState(true);

  const bootEngine = useCallback(async () => {
    setEngineState({
      status: 'loading',
      progressText: '正在加载本地神经网络权重...',
    });
    try {
      await initializeFaceEngine((text) => {
        setEngineState({ status: 'loading', progressText: text });
      });
      setEngineState({
        status: 'ready',
        progressText: '人脸识别模型已就绪',
      });
    } catch (err) {
      setEngineState({
        status: 'error',
        progressText: '模型加载失败',
        errorMessage:
          err instanceof Error ? err.message : '无法加载人脸识别权重文件',
      });
    }
  }, []);

  // Load local IndexedDB data + neural engine on startup
  useEffect(() => {
    void (async () => {
      try {
        const [storedPersons, storedHistory] = await Promise.all([
          getAllPersons(),
          getAllHistory(),
        ]);
        setPersons(storedPersons);
        setHistory(storedHistory);
      } catch {
        // Ignore IndexedDB error if private mode blocks storage
      }
    })();
    void bootEngine();
  }, [bootEngine]);

  const totalSampleCount = useMemo(
    () => persons.reduce((sum, p) => sum + p.samples.length, 0),
    [persons]
  );

  // Upsert a person record by name (merging multiple samples if name already exists)
  const upsertPersonSample = useCallback(
    async (
      name: string,
      sample: FaceSample,
      note = '',
      currentList: PersonRecord[]
    ): Promise<{ updatedList: PersonRecord[]; person: PersonRecord; merged: boolean }> => {
      const normalized = name.trim() || '未命名人物';
      const existingIndex = currentList.findIndex(
        (p) => p.name.trim().toLowerCase() === normalized.toLowerCase()
      );

      const now = Date.now();
      let updatedPerson: PersonRecord;
      let merged = false;
      let nextList: PersonRecord[];

      if (existingIndex >= 0) {
        const existing = currentList[existingIndex];
        merged = true;
        updatedPerson = {
          ...existing,
          note: existing.note || note,
          samples: [sample, ...existing.samples],
          updatedAt: now,
        };
        nextList = [
          updatedPerson,
          ...currentList.filter((_, idx) => idx !== existingIndex),
        ];
      } else {
        updatedPerson = {
          id: `person-${now}-${Math.random().toString(36).slice(2, 7)}`,
          name: normalized,
          note,
          samples: [sample],
          createdAt: now,
          updatedAt: now,
        };
        nextList = [updatedPerson, ...currentList];
      }

      await putPerson(updatedPerson);
      return { updatedList: nextList, person: updatedPerson, merged };
    },
    []
  );

  const handleBatchImportFiles = useCallback(
    async (
      files: File[],
      notesMap?: Record<string, string>
    ) => {
      if (files.length === 0 || engineState.status !== 'ready') return;

      setIsImporting(true);
      const initialItems: ImportQueueItem[] = files.map((file, idx) => ({
        id: `q-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        filename: file.name,
        parsedName: parsePersonNameFromFilename(file.name, mergeIndexedSuffixes),
        status: 'pending',
      }));

      setImportQueue((prev) => [...initialItems, ...prev]);

      // Use latest persisted persons list as working copy during sequential extraction
      let workingPersons = await getAllPersons();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const itemId = initialItems[i].id;
        const parsedName = initialItems[i].parsedName;

        setImportQueue((prev) =>
          prev.map((item) =>
            item.id === itemId ? { ...item, status: 'processing' } : item
          )
        );

        try {
          const dataUrl = await readFileAsDataUrl(file);
          const img = await loadImageElement(dataUrl);
          const extracted = await extractPrimaryFaceFromImage(img);

          if (!extracted) {
            setImportQueue((prev) =>
              prev.map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      status: 'no-face',
                      message: '未检测到清晰正面人脸，请更换清晰人像照',
                    }
                  : item
              )
            );
            continue;
          }

          const newSample: FaceSample = {
            id: `sample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            descriptor: extracted.descriptor,
            thumbnail: extracted.thumbnail,
            sourceFilename: file.name,
            detectionScore: extracted.detectionScore,
            createdAt: Date.now(),
          };

          const { updatedList, person, merged } = await upsertPersonSample(
            parsedName,
            newSample,
            notesMap?.[file.name] || '',
            workingPersons
          );

          workingPersons = updatedList;
          setPersons(workingPersons);

          setImportQueue((prev) =>
            prev.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    status: 'success',
                    thumbnail: extracted.thumbnail,
                    detectionScore: extracted.detectionScore,
                    personId: person.id,
                    mergedIntoExisting: merged,
                  }
                : item
            )
          );
        } catch (err) {
          setImportQueue((prev) =>
            prev.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    status: 'error',
                    message:
                      err instanceof Error ? err.message : '图片解析失败',
                  }
                : item
            )
          );
        }
      }

      setIsImporting(false);
    },
    [engineState.status, mergeIndexedSuffixes, upsertPersonSample]
  );

  const handleImportSampleProfiles = useCallback(async () => {
    if (engineState.status !== 'ready' || isImporting) return;
    setActiveTab('import');

    const files: File[] = [];
    const notesMap: Record<string, string> = {};

    for (const profile of SAMPLE_PROFILES) {
      try {
        const res = await fetch(profile.imageUrl);
        const blob = await res.blob();
        const file = new File([blob], profile.filename, {
          type: blob.type || 'image/jpeg',
        });
        files.push(file);
        notesMap[profile.filename] = profile.note;
      } catch {
        // Skip unreachable asset
      }
    }

    if (files.length > 0) {
      await handleBatchImportFiles(files, notesMap);
    }
  }, [engineState.status, isImporting, handleBatchImportFiles]);

  const handleQuickRegisterFace = useCallback(
    async (
      name: string,
      note: string,
      descriptor: number[],
      thumbnail: string
    ): Promise<PersonRecord> => {
      const current = await getAllPersons();
      const sample: FaceSample = {
        id: `sample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        descriptor,
        thumbnail,
        sourceFilename: `${name.trim()}_实拍录入.jpg`,
        detectionScore: 0.99,
        createdAt: Date.now(),
      };
      const { updatedList, person } = await upsertPersonSample(
        name,
        sample,
        note,
        current
      );
      setPersons(updatedList);
      return person;
    },
    [upsertPersonSample]
  );

  const handleUpdatePerson = useCallback(
    async (personId: string, name: string, note: string) => {
      const target = persons.find((p) => p.id === personId);
      if (!target) return;
      const updated: PersonRecord = {
        ...target,
        name,
        note,
        updatedAt: Date.now(),
      };
      await putPerson(updated);
      setPersons((prev) =>
        prev.map((p) => (p.id === personId ? updated : p))
      );
    },
    [persons]
  );

  const handleAddSampleToPerson = useCallback(
    async (personId: string, file: File): Promise<{ ok: boolean; message: string }> => {
      const target = persons.find((p) => p.id === personId);
      if (!target) return { ok: false, message: '未找到该人物档案' };

      try {
        const dataUrl = await readFileAsDataUrl(file);
        const img = await loadImageElement(dataUrl);
        const extracted = await extractPrimaryFaceFromImage(img);
        if (!extracted) {
          return { ok: false, message: '该照片中未检测到清晰人脸，请换一张正面照' };
        }

        const newSample: FaceSample = {
          id: `sample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          descriptor: extracted.descriptor,
          thumbnail: extracted.thumbnail,
          sourceFilename: file.name,
          detectionScore: extracted.detectionScore,
          createdAt: Date.now(),
        };

        const updated: PersonRecord = {
          ...target,
          samples: [newSample, ...target.samples],
          updatedAt: Date.now(),
        };
        await putPerson(updated);
        setPersons((prev) => prev.map((p) => (p.id === personId ? updated : p)));
        return { ok: true, message: '已成功补充 1 组 128 维面部特征样本' };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : '样本提取失败',
        };
      }
    },
    [persons]
  );

  const handleDeleteSample = useCallback(
    async (personId: string, sampleId: string) => {
      const target = persons.find((p) => p.id === personId);
      if (!target || target.samples.length <= 1) return;
      const updated: PersonRecord = {
        ...target,
        samples: target.samples.filter((s) => s.id !== sampleId),
        updatedAt: Date.now(),
      };
      await putPerson(updated);
      setPersons((prev) => prev.map((p) => (p.id === personId ? updated : p)));
    },
    [persons]
  );

  const handleDeletePerson = useCallback(async (personId: string) => {
    await deletePersonById(personId);
    setPersons((prev) => prev.filter((p) => p.id !== personId));
  }, []);

  const handleExportBackup = useCallback(() => {
    const json = serializeBackup(persons);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `面谱识人特征库_${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [persons]);

  const handleImportBackup = useCallback(
    async (file: File): Promise<{ ok: boolean; message: string }> => {
      try {
        const text = await file.text();
        const restored = parseBackupJson(text);
        let working = await getAllPersons();

        for (const incoming of restored) {
          const idx = working.findIndex(
            (p) => p.name.trim().toLowerCase() === incoming.name.trim().toLowerCase()
          );
          if (idx >= 0) {
            const mergedSamples = [...incoming.samples, ...working[idx].samples];
            const dedupMap = new Map(mergedSamples.map((s) => [s.id, s]));
            const mergedPerson: PersonRecord = {
              ...working[idx],
              note: working[idx].note || incoming.note,
              samples: Array.from(dedupMap.values()),
              updatedAt: Date.now(),
            };
            await putPerson(mergedPerson);
            working[idx] = mergedPerson;
          } else {
            await putPerson(incoming);
            working = [incoming, ...working];
          }
        }

        const refreshed = await getAllPersons();
        setPersons(refreshed);
        return {
          ok: true,
          message: `已成功恢复 ${restored.length} 位人物的面部特征数据`,
        };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : '备份文件读取失败',
        };
      }
    },
    []
  );

  const handleRecordHistory = useCallback(async (entry: RecognitionHistoryEntry) => {
    await addHistoryEntry(entry);
    setHistory((prev) => [entry, ...prev].slice(0, 60));
  }, []);

  const handleDeleteHistory = useCallback(async (id: string) => {
    await deleteHistoryEntry(id);
    setHistory((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleClearHistory = useCallback(async () => {
    await clearAllHistory();
    setHistory([]);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F7F9] text-slate-900">
      {/* Sticky Top App Bar (Clean 3-Zone Contract on Desktop, Compact 52px Mobile Header) */}
      <header className="sticky top-0 z-30 h-[52px] lg:h-16 bg-white/90 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('camera')}
            className="text-base lg:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600 rounded"
          >
            面谱识人
          </button>

          {/* Zone 2: Desktop Single-Line Navigation Links */}
          <nav
            aria-label="主导航"
            className="hidden lg:flex items-center gap-7 text-sm font-medium"
          >
            {NAV_ITEMS.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`relative py-5 transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'text-blue-600'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.id === 'library' && persons.length > 0 && (
                    <span className="ml-1 text-xs font-mono text-slate-400 tabular-nums">
                      {persons.length}
                    </span>
                  )}
                  {active && (
                    <span className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary Contextual Action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() =>
                setActiveTab(activeTab === 'import' ? 'camera' : 'import')
              }
              className="min-h-[38px] lg:min-h-[40px] px-3.5 lg:px-4 py-1.5 rounded-xl bg-blue-600 text-white text-xs lg:text-sm font-medium hover:bg-blue-700 active:scale-[0.98] transition-all whitespace-nowrap shrink-0"
            >
              {activeTab === 'import' ? '去拍照识别' : '批量导入照片'}
            </button>
          </div>
        </div>
      </header>

      {/* Real Model Initialization Progress Notice (Shown only while loading or on error) */}
      {engineState.status === 'loading' && (
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 pt-4">
          <div className="bg-white border border-slate-200/80 rounded-2xl px-4 py-3 flex items-center gap-3 text-sm text-slate-700">
            <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
            <span className="truncate">{engineState.progressText}</span>
          </div>
        </div>
      )}

      {engineState.status === 'error' && (
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 pt-4">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 text-sm text-amber-900">
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {engineState.errorMessage || '本地人脸模型加载失败'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void bootEngine()}
              className="min-h-[36px] px-3 rounded-lg bg-amber-900 text-white text-xs font-medium shrink-0 whitespace-nowrap"
            >
              重新加载
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area (Extra bottom padding on mobile for fixed thumb tab bar) */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 pb-24 lg:py-7 lg:pb-12">
        {activeTab === 'camera' && (
          <CameraRecognizeView
            persons={persons}
            engineState={engineState}
            threshold={threshold}
            onChangeThreshold={setThreshold}
            onQuickRegisterFace={handleQuickRegisterFace}
            onRecordHistory={handleRecordHistory}
            onGoToImport={() => setActiveTab('import')}
            onImportSamples={handleImportSampleProfiles}
            isImporting={isImporting}
          />
        )}

        {activeTab === 'import' && (
          <BatchImportView
            engineState={engineState}
            personCount={persons.length}
            totalSampleCount={totalSampleCount}
            queue={importQueue}
            isImporting={isImporting}
            mergeIndexedSuffixes={mergeIndexedSuffixes}
            onToggleMergeSuffixes={setMergeIndexedSuffixes}
            onImportFiles={(files) => handleBatchImportFiles(files)}
            onImportSamples={handleImportSampleProfiles}
            onClearQueue={() => setImportQueue([])}
            onGoToCamera={() => setActiveTab('camera')}
            onGoToLibrary={() => setActiveTab('library')}
          />
        )}

        {activeTab === 'library' && (
          <PeopleLibraryView
            persons={persons}
            engineState={engineState}
            onUpdatePerson={handleUpdatePerson}
            onAddSampleToPerson={handleAddSampleToPerson}
            onDeleteSample={handleDeleteSample}
            onDeletePerson={handleDeletePerson}
            onExportBackup={handleExportBackup}
            onImportBackup={handleImportBackup}
            onGoToImport={() => setActiveTab('import')}
          />
        )}

        {activeTab === 'history' && (
          <HistoryView
            history={history}
            onDeleteEntry={handleDeleteHistory}
            onClearAll={handleClearHistory}
            onGoToCamera={() => setActiveTab('camera')}
          />
        )}
      </main>

      {/* Mobile Fixed Bottom Thumb-Zone Tab Bar (Hidden on Desktop >= 1024px) */}
      <nav
        aria-label="底部功能切换"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/80 pb-safe"
      >
        <div className="grid grid-cols-4 h-[60px] items-center">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-blue-600' : 'text-slate-500'
                }`}
              >
                <Icon className="w-[21px] h-[21px]" />
                <span className="text-[11px] font-medium tracking-tight whitespace-nowrap">
                  {item.mobileLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
