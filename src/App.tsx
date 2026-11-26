import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Images,
  Loader2,
  SlidersHorizontal,
} from 'lucide-react';
import type {
  AppTab,
  EngineState,
  FaceSample,
  ImportQueueItem,
  PersonRecord,
} from './types/face';
import {
  extractPrimaryFaceFromImage,
  initializeFaceEngine,
  loadImageElement,
  parsePersonNameFromFilename,
  readFileAsDataUrl,
} from './services/faceEngine';
import {
  deletePersonById,
  getAllPersons,
  parseFullBackupJson,
  putPerson,
  putPersonsBatch,
  replaceAllPersons,
  serializeFullBackup,
  sortPersonsList,
} from './services/faceDb';
import type { ImportableImageSource } from './services/nativeStorage';
import { exportBackupToChosenFolder } from './services/nativeStorage';
import { CameraRecognizeView } from './components/CameraRecognizeView';
import { AlbumView } from './components/AlbumView';
import { SettingsView } from './components/SettingsView';

const BOTTOM_TABS: Array<{
  id: AppTab;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}> = [
  { id: 'camera', label: '拍照', icon: Camera },
  { id: 'album', label: '相册', icon: Images },
  { id: 'settings', label: '设置', icon: SlidersHorizontal },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('camera');
  const [engineState, setEngineState] = useState<EngineState>({
    status: 'loading',
    progressText: '正在初始化本地人脸识别模型...',
  });

  const [persons, setPersons] = useState<PersonRecord[]>([]);
  const [minSimilarity, setMinSimilarity] = useState<number>(() => {
    try {
      const saved = Math.round(
        Number(localStorage.getItem('face_roster_min_similarity'))
      );
      if (Number.isFinite(saved) && saved >= 40 && saved <= 85) {
        return saved;
      }
    } catch {
      // Ignore storage access errors
    }
    return 60;
  });

  const [mergeIndexedSuffixes, setMergeIndexedSuffixes] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('face_roster_merge_suffixes');
      if (saved === 'false') return false;
    } catch {
      // Ignore storage access errors
    }
    return true;
  });

  const [importQueue, setImportQueue] = useState<ImportQueueItem[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const handleChangeMinSimilarity = useCallback((value: number) => {
    const clamped = Math.max(40, Math.min(85, Math.round(value)));
    setMinSimilarity(clamped);
    try {
      localStorage.setItem('face_roster_min_similarity', String(clamped));
    } catch {
      // Ignore storage access errors
    }
  }, []);

  const handleToggleMergeSuffixes = useCallback((val: boolean) => {
    setMergeIndexedSuffixes(val);
    try {
      localStorage.setItem('face_roster_merge_suffixes', String(val));
    } catch {
      // Ignore storage access errors
    }
  }, []);

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
        progressText: '模型已就绪',
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

  useEffect(() => {
    void (async () => {
      try {
        const storedPersons = await getAllPersons();
        setPersons(storedPersons);
      } catch {
        // Ignore IndexedDB errors if private mode restricts access
      }
    })();
    void bootEngine();
  }, [bootEngine]);

  const totalSampleCount = useMemo(
    () => persons.reduce((sum, p) => sum + p.samples.length, 0),
    [persons]
  );

  const hasCustomOrder = useMemo(
    () => persons.some((p) => typeof p.sortOrder === 'number'),
    [persons]
  );

  const upsertPersonSample = useCallback(
    async (
      name: string,
      sample: FaceSample,
      note = '',
      currentList: PersonRecord[]
    ): Promise<{
      updatedList: PersonRecord[];
      person: PersonRecord;
      merged: boolean;
    }> => {
      const normalized = name.trim() || '未命名人物';
      const existingIndex = currentList.findIndex(
        (p) => p.name.trim().toLowerCase() === normalized.toLowerCase()
      );

      const now = Date.now();
      const customOrderActive = currentList.some(
        (p) => typeof p.sortOrder === 'number'
      );

      let updatedPerson: PersonRecord;
      let merged = false;
      let rawNext: PersonRecord[];

      if (existingIndex >= 0) {
        const existing = currentList[existingIndex];
        merged = true;
        updatedPerson = {
          ...existing,
          note: existing.note || note,
          samples: [sample, ...existing.samples],
          updatedAt: now,
        };
        rawNext = currentList.map((p, idx) =>
          idx === existingIndex ? updatedPerson : p
        );
      } else {
        const maxOrder = customOrderActive
          ? Math.max(-1, ...currentList.map((p) => p.sortOrder ?? -1))
          : -1;
        updatedPerson = {
          id: `person-${now}-${Math.random().toString(36).slice(2, 7)}`,
          name: normalized,
          note,
          samples: [sample],
          sortOrder: customOrderActive ? maxOrder + 1 : undefined,
          createdAt: now,
          updatedAt: now,
        };
        rawNext = [...currentList, updatedPerson];
      }

      await putPerson(updatedPerson);
      return {
        updatedList: sortPersonsList(rawNext),
        person: updatedPerson,
        merged,
      };
    },
    []
  );

  const handleBatchImportSources = useCallback(
    async (sources: ImportableImageSource[]) => {
      if (sources.length === 0 || engineState.status !== 'ready') return;

      setIsImporting(true);
      const initialItems: ImportQueueItem[] = sources.map((src, idx) => ({
        id: `q-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        filename: src.name,
        parsedName: parsePersonNameFromFilename(src.name, mergeIndexedSuffixes),
        status: 'pending',
      }));

      setImportQueue((prev) => [...initialItems, ...prev]);

      let workingPersons = await getAllPersons();

      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        const itemId = initialItems[i].id;
        const parsedName = initialItems[i].parsedName;

        setImportQueue((prev) =>
          prev.map((item) =>
            item.id === itemId ? { ...item, status: 'processing' } : item
          )
        );

        try {
          const dataUrl = await src.loadDataUrl();
          const img = await loadImageElement(dataUrl);
          const extracted = await extractPrimaryFaceFromImage(img);

          if (!extracted) {
            setImportQueue((prev) =>
              prev.map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      status: 'no-face',
                      message: '未检测到清晰人脸，已跳过',
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
            originalPhoto: extracted.originalPhoto,
            sourceFilename: src.name,
            detectionScore: extracted.detectionScore,
            createdAt: Date.now(),
          };

          const { updatedList, person, merged } = await upsertPersonSample(
            parsedName,
            newSample,
            '',
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
                    message: err instanceof Error ? err.message : '图片解析失败',
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

  const handleBatchImportFiles = useCallback(
    async (files: File[]) => {
      const sources: ImportableImageSource[] = files.map((file) => ({
        name: file.name,
        loadDataUrl: () => readFileAsDataUrl(file),
      }));
      await handleBatchImportSources(sources);
    },
    [handleBatchImportSources]
  );

  const handleQuickRegisterFace = useCallback(
    async (
      name: string,
      note: string,
      descriptor: number[],
      thumbnail: string,
      originalPhoto?: string
    ): Promise<PersonRecord> => {
      const current = await getAllPersons();
      const sample: FaceSample = {
        id: `sample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        descriptor,
        thumbnail,
        originalPhoto: originalPhoto || thumbnail,
        sourceFilename: `${name.trim()}_实拍.jpg`,
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

  const handleReorderPersons = useCallback(async (orderedIds: string[]) => {
    setPersons((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      const reordered: PersonRecord[] = [];

      orderedIds.forEach((id, idx) => {
        const item = byId.get(id);
        if (item) {
          reordered.push({ ...item, sortOrder: idx });
          byId.delete(id);
        }
      });

      for (const leftover of byId.values()) {
        reordered.push({ ...leftover, sortOrder: reordered.length });
      }

      void putPersonsBatch(reordered);
      return reordered;
    });
  }, []);

  const handleResetNameOrder = useCallback(async () => {
    const cleared = persons.map((p) => {
      const copy = { ...p };
      delete copy.sortOrder;
      return copy;
    });
    const sorted = sortPersonsList(cleared);
    setPersons(sorted);
    await putPersonsBatch(sorted);
  }, [persons]);

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
        sortPersonsList(prev.map((p) => (p.id === personId ? updated : p)))
      );
    },
    [persons]
  );

  const handleAddSampleToPerson = useCallback(
    async (
      personId: string,
      file: File
    ): Promise<{ ok: boolean; message: string }> => {
      const target = persons.find((p) => p.id === personId);
      if (!target) return { ok: false, message: '未找到该人物档案' };

      try {
        const dataUrl = await readFileAsDataUrl(file);
        const img = await loadImageElement(dataUrl);
        const extracted = await extractPrimaryFaceFromImage(img);
        if (!extracted) {
          return { ok: false, message: '该照片未检测到清晰人脸' };
        }

        const newSample: FaceSample = {
          id: `sample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          descriptor: extracted.descriptor,
          thumbnail: extracted.thumbnail,
          originalPhoto: extracted.originalPhoto,
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
        setPersons((prev) =>
          prev.map((p) => (p.id === personId ? updated : p))
        );
        return { ok: true, message: '已补充 1 组面部特征样本' };
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

  const handleExportFullBackup = useCallback(async () => {
    const latestPersons = await getAllPersons();
    const content = serializeFullBackup(latestPersons, {
      minSimilarity,
      mergeIndexedSuffixes,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `认脸完整备份_${stamp}.json`;
    return exportBackupToChosenFolder(filename, content);
  }, [minSimilarity, mergeIndexedSuffixes]);

  const handleImportFullBackupContent = useCallback(
    async (rawJson: string): Promise<{ ok: boolean; message: string }> => {
      try {
        const parsed = parseFullBackupJson(rawJson);

        // Restore full person database (photos, 128D features, custom sort order)
        if (parsed.persons.length > 0) {
          await replaceAllPersons(parsed.persons);
          const refreshed = await getAllPersons();
          setPersons(refreshed);
        }

        // Restore all saved application settings
        if (parsed.settings) {
          if (typeof parsed.settings.minSimilarity === 'number') {
            handleChangeMinSimilarity(parsed.settings.minSimilarity);
          }
          if (typeof parsed.settings.mergeIndexedSuffixes === 'boolean') {
            handleToggleMergeSuffixes(parsed.settings.mergeIndexedSuffixes);
          }
        }

        const photoCount = parsed.persons.reduce(
          (sum, p) => sum + p.samples.length,
          0
        );
        return {
          ok: true,
          message: `已恢复完整备份：${parsed.persons.length} 位人物（${photoCount} 张照片与特征）及软件设置`,
        };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : '备份文件读取失败',
        };
      }
    },
    [handleChangeMinSimilarity, handleToggleMergeSuffixes]
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F8F7] text-[#141413]">
      {/* Subtle Engine Status Notice (Respects safe-area top inset) */}
      {engineState.status === 'loading' && (
        <div className="max-w-4xl w-full mx-auto px-4 pt-safe">
          <div className="bg-white border border-neutral-200/90 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 text-xs text-neutral-600">
            <Loader2 className="w-3.5 h-3.5 text-neutral-800 animate-spin shrink-0" />
            <span className="truncate">{engineState.progressText}</span>
          </div>
        </div>
      )}

      {engineState.status === 'error' && (
        <div className="max-w-4xl w-full mx-auto px-4 pt-safe">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs text-amber-900">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {engineState.errorMessage || '本地人脸模型加载失败'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void bootEngine()}
              className="min-h-[34px] px-3 rounded-lg bg-amber-900 text-white text-xs font-medium shrink-0"
            >
              重试
            </button>
          </div>
        </div>
      )}

      {/* Main Content Above Bottom Minimalist Toolbar */}
      <main
        className={`flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 pb-24 ${
          engineState.status === 'ready' ? 'pt-safe' : 'pt-3'
        }`}
      >
        {activeTab === 'camera' && (
          <CameraRecognizeView
            persons={persons}
            engineState={engineState}
            minSimilarity={minSimilarity}
            onQuickRegisterFace={handleQuickRegisterFace}
          />
        )}

        {activeTab === 'album' && (
          <AlbumView
            persons={persons}
            hasCustomOrder={hasCustomOrder}
            engineState={engineState}
            onReorderPersons={handleReorderPersons}
            onResetNameOrder={handleResetNameOrder}
            onUpdatePerson={handleUpdatePerson}
            onAddSampleToPerson={handleAddSampleToPerson}
            onDeleteSample={handleDeleteSample}
            onDeletePerson={handleDeletePerson}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            engineState={engineState}
            personCount={persons.length}
            totalSampleCount={totalSampleCount}
            queue={importQueue}
            isImporting={isImporting}
            mergeIndexedSuffixes={mergeIndexedSuffixes}
            minSimilarity={minSimilarity}
            onToggleMergeSuffixes={handleToggleMergeSuffixes}
            onImportFiles={handleBatchImportFiles}
            onImportSources={handleBatchImportSources}
            onClearQueue={() => setImportQueue([])}
            onChangeMinSimilarity={handleChangeMinSimilarity}
            onExportBackup={handleExportFullBackup}
            onImportBackupContent={handleImportFullBackupContent}
          />
        )}
      </main>

      {/* Fixed Minimalist Bottom 3-Icon Toolbar (拍照 · 相册 · 设置) */}
      <nav
        aria-label="底部功能工具条"
        className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-neutral-200/80 pb-safe"
      >
        <div className="max-w-4xl mx-auto grid grid-cols-3 h-[58px] items-center">
          {BOTTOM_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-label={tab.label}
                aria-current={active ? 'page' : undefined}
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active
                    ? 'text-[#141413]'
                    : 'text-neutral-400 hover:text-neutral-600'
                }`}
              >
                <Icon
                  className="w-[21px] h-[21px]"
                  strokeWidth={active ? 2.15 : 1.65}
                />
                <span className="text-[10px] font-medium tracking-wide whitespace-nowrap">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
