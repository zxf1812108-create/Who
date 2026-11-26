import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  GripHorizontal,
  ImagePlus,
  Loader2,
  RotateCcw,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import type { EngineState, PersonRecord } from '../types/face';
import { VectorBarcode } from './VectorBarcode';

interface AlbumViewProps {
  persons: PersonRecord[];
  hasCustomOrder: boolean;
  engineState: EngineState;
  onReorderPersons: (orderedIds: string[]) => Promise<void>;
  onResetNameOrder: () => Promise<void>;
  onUpdatePerson: (personId: string, name: string, note: string) => Promise<void>;
  onAddSampleToPerson: (
    personId: string,
    file: File
  ) => Promise<{ ok: boolean; message: string }>;
  onDeleteSample: (personId: string, sampleId: string) => Promise<void>;
  onDeletePerson: (personId: string) => Promise<void>;
}

export const AlbumView: React.FC<AlbumViewProps> = ({
  persons,
  hasCustomOrder,
  engineState,
  onReorderPersons,
  onResetNameOrder,
  onUpdatePerson,
  onAddSampleToPerson,
  onDeleteSample,
  onDeletePerson,
}) => {
  const [query, setQuery] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editNote, setEditNote] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [addingSample, setAddingSample] = useState(false);
  const [detailNotice, setDetailNotice] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [saveToast, setSaveToast] = useState(false);

  // Pointer-based drag-to-reorder state (works cleanly on Android touch & desktop mouse)
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draftOrderIds, setDraftOrderIds] = useState<string[] | null>(null);

  const dragSessionRef = useRef<{
    personId: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    didReorder: boolean;
    longPressTimer: number | null;
  } | null>(null);

  const suppressNextClickRef = useRef(false);
  const draftOrderRef = useRef<string[] | null>(null);
  const personsRef = useRef(persons);
  personsRef.current = persons;

  const addSampleInputRef = useRef<HTMLInputElement>(null);

  const isSearching = query.trim().length > 0;

  // Displayed list: live draft order while dragging, otherwise filtered/full persons
  const displayedPersons = useMemo(() => {
    if (isSearching) {
      const q = query.trim().toLowerCase();
      return persons.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.note.toLowerCase().includes(q)
      );
    }
    if (draftOrderIds) {
      const map = new Map(persons.map((p) => [p.id, p]));
      return draftOrderIds
        .map((id) => map.get(id))
        .filter((p): p is PersonRecord => Boolean(p));
    }
    return persons;
  }, [persons, query, isSearching, draftOrderIds]);

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

  // Global pointer move & up listeners for reliable cross-device drag reordering
  useEffect(() => {
    const activateDrag = (personId: string) => {
      const session = dragSessionRef.current;
      if (!session || session.active) return;
      session.active = true;
      suppressNextClickRef.current = true;
      const initialIds = personsRef.current.map((p) => p.id);
      draftOrderRef.current = initialIds;
      setDraftOrderIds(initialIds);
      setDraggingId(personId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== e.pointerId) return;

      const dx = e.clientX - session.startX;
      const dy = e.clientY - session.startY;
      const movedDist = Math.hypot(dx, dy);

      if (!session.active) {
        // Mouse activates immediately on 6px move; touch waits for long-press unless initiated from grip
        if (e.pointerType === 'mouse' && movedDist > 6) {
          activateDrag(session.personId);
        } else if (e.pointerType !== 'mouse' && movedDist > 10) {
          // User is scrolling vertically on touch -> cancel pending long press
          if (session.longPressTimer !== null) {
            window.clearTimeout(session.longPressTimer);
            session.longPressTimer = null;
          }
          dragSessionRef.current = null;
          return;
        }
      }

      if (!session.active) return;

      if (e.cancelable) {
        e.preventDefault();
      }

      const targetEl = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>('[data-person-id]');
      const overId = targetEl?.dataset.personId;

      if (overId && overId !== session.personId && draftOrderRef.current) {
        const current = draftOrderRef.current;
        const fromIdx = current.indexOf(session.personId);
        const toIdx = current.indexOf(overId);
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          const next = [...current];
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          draftOrderRef.current = next;
          session.didReorder = true;
          setDraftOrderIds(next);
        }
      }
    };

    const finishDrag = async (e: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== e.pointerId) return;

      if (session.longPressTimer !== null) {
        window.clearTimeout(session.longPressTimer);
        session.longPressTimer = null;
      }

      const finalIds = draftOrderRef.current;
      const shouldPersist = session.active && session.didReorder && finalIds;

      dragSessionRef.current = null;
      draftOrderRef.current = null;
      setDraggingId(null);
      setDraftOrderIds(null);

      if (shouldPersist) {
        await onReorderPersons(finalIds);
        setSaveToast(true);
        window.setTimeout(() => setSaveToast(false), 1800);
      }

      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 60);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  }, [onReorderPersons]);

  const startCardPointer = (
    e: React.PointerEvent,
    personId: string,
    immediate: boolean
  ) => {
    if (isSearching || persons.length < 2) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    if (immediate) {
      e.stopPropagation();
    }

    const session = {
      personId,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      didReorder: false,
      longPressTimer: null as number | null,
    };
    dragSessionRef.current = session;

    if (immediate) {
      session.active = true;
      suppressNextClickRef.current = true;
      const initialIds = persons.map((p) => p.id);
      draftOrderRef.current = initialIds;
      setDraftOrderIds(initialIds);
      setDraggingId(personId);
    } else if (e.pointerType !== 'mouse') {
      // Touch long-press anywhere on card activates drag while keeping scrolling smooth
      session.longPressTimer = window.setTimeout(() => {
        const cur = dragSessionRef.current;
        if (cur && cur.personId === personId && !cur.active) {
          cur.active = true;
          suppressNextClickRef.current = true;
          const initialIds = personsRef.current.map((p) => p.id);
          draftOrderRef.current = initialIds;
          setDraftOrderIds(initialIds);
          setDraggingId(personId);
        }
      }, 220);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPerson) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setDetailNotice({ type: 'err', text: '人物姓名不能为空' });
      return;
    }
    await onUpdatePerson(selectedPerson.id, trimmed, editNote.trim());
    setDetailNotice({ type: 'ok', text: '档案信息已更新' });
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

  return (
    <div className="space-y-4">
      {/* Top Minimalist Search Bar */}
      <div className="sticky top-0 z-20 pt-1 pb-2 bg-[#F8F8F7]/95 backdrop-blur-md">
        <div className="relative">
          <Search
            className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            strokeWidth={1.8}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索人物姓名..."
            aria-label="搜索人物姓名"
            className="w-full min-h-[46px] pl-10 pr-10 rounded-2xl bg-white border border-neutral-200/90 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-900 transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="清空搜索"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[38px] min-w-[38px] flex items-center justify-center text-neutral-400 hover:text-neutral-800"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Quiet Metadata & Sort Status Line (Zero Pills) */}
        <div className="mt-2.5 px-1 flex items-center justify-between gap-2 text-xs text-neutral-500">
          <div className="tabular-nums flex items-center gap-1.5 truncate">
            <span>
              {isSearching
                ? `匹配 ${displayedPersons.length} 人`
                : `共 ${persons.length} 位人物`}
            </span>
            {!isSearching && persons.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {saveToast
                    ? '已自动保存排序'
                    : hasCustomOrder
                      ? '自定义拖动排序'
                      : '按姓名排序 · 可拖动调整'}
                </span>
              </>
            )}
          </div>

          {!isSearching && hasCustomOrder && persons.length > 1 && (
            <button
              type="button"
              onClick={() => void onResetNameOrder()}
              className="text-xs text-neutral-600 hover:text-neutral-950 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3 h-3" />
              <span>恢复姓名排序</span>
            </button>
          )}
        </div>
      </div>

      {/* Empty Library State */}
      {persons.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/90 px-6 py-16 text-center space-y-3">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-[#F4F4F2] flex items-center justify-center text-neutral-500">
            <UserPlus className="w-5 h-5" strokeWidth={1.75} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-neutral-900">
              暂无人物照片
            </p>
            <p className="text-xs text-neutral-500">
              导入人物照片后将在此显示全部人物档案
            </p>
          </div>
        </div>
      ) : displayedPersons.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/90 px-6 py-14 text-center">
          <p className="text-sm text-neutral-500">
            未找到与「{query}」匹配的人物照片
          </p>
        </div>
      ) : (
        /* Draggable People Photo Grid */
        <div
          className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4 ${
            draggingId ? 'select-none' : ''
          }`}
        >
          {displayedPersons.map((person) => {
            const cover = person.samples[0]?.thumbnail;
            const isDragging = draggingId === person.id;

            return (
              <div
                key={person.id}
                data-person-id={person.id}
                onPointerDown={(e) => startCardPointer(e, person.id, false)}
                onClick={() => {
                  if (suppressNextClickRef.current) return;
                  openPersonSheet(person);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openPersonSheet(person);
                  }
                }}
                className={`group relative bg-white rounded-2xl border overflow-hidden cursor-pointer transition-transform duration-150 focus-visible:outline-2 focus-visible:outline-neutral-900 ${
                  isDragging
                    ? 'scale-[1.03] opacity-75 border-neutral-900 ring-2 ring-neutral-900/15 z-10'
                    : 'border-neutral-200/90 hover:border-neutral-300'
                }`}
              >
                <div className="aspect-square bg-[#F4F4F2] overflow-hidden relative">
                  {cover ? (
                    <img
                      src={cover}
                      alt={person.name}
                      draggable={false}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover select-none pointer-events-none"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-400 text-xl font-medium">
                      {person.name.slice(0, 1)}
                    </div>
                  )}

                  {/* Tactile Drag Handle for Instant Touch Reordering */}
                  {!isSearching && persons.length > 1 && (
                    <div
                      onPointerDown={(e) => startCardPointer(e, person.id, true)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`拖动调整 ${person.name} 的排序`}
                      title="按住拖动排序"
                      className="touch-none absolute top-2 right-2 w-8 h-8 rounded-full bg-black/35 backdrop-blur-xs text-white/90 flex items-center justify-center cursor-grab active:cursor-grabbing opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                    >
                      <GripHorizontal className="w-4 h-4" />
                    </div>
                  )}
                </div>

                <div className="px-3 py-2.5 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-neutral-950 truncate">
                    {person.name}
                  </span>
                  <span className="text-[11px] text-neutral-400 tabular-nums shrink-0">
                    {person.samples.length} 张
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Minimalist Person Detail Sheet */}
      {selectedPerson && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] p-0 sm:p-6"
          onClick={closePersonSheet}
        >
          <div
            className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl max-h-[86vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sm:hidden pt-3 pb-1 flex justify-center">
              <div className="w-9 h-1 rounded-full bg-neutral-300" />
            </div>

            <div className="px-5 py-3.5 border-b border-neutral-100 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-neutral-950 truncate">
                  {selectedPerson.name}
                </h2>
                <p className="text-xs text-neutral-500 tabular-nums">
                  {selectedPerson.samples.length} 组面部特征模板
                </p>
              </div>
              <button
                type="button"
                onClick={closePersonSheet}
                aria-label="关闭详情"
                className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl text-neutral-500 hover:bg-neutral-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5">
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

              <form onSubmit={handleSaveEdit} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">
                      姓名
                    </label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full min-h-[42px] px-3 rounded-xl border border-neutral-200 text-sm text-neutral-900 focus:outline-none focus:border-neutral-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-500 mb-1">
                      备注（选填）
                    </label>
                    <input
                      type="text"
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      placeholder="分组或备注信息"
                      className="w-full min-h-[42px] px-3 rounded-xl border border-neutral-200 text-sm text-neutral-900 focus:outline-none focus:border-neutral-900"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 inline-flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>保存修改</span>
                </button>
              </form>

              <div className="space-y-3 pt-4 border-t border-neutral-100">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-neutral-700">
                    已录入的人脸照片（多角度可提升识别率）
                  </span>
                  <button
                    type="button"
                    disabled={engineState.status !== 'ready' || addingSample}
                    onClick={() => addSampleInputRef.current?.click()}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl border border-neutral-200 text-neutral-900 text-xs font-medium hover:bg-neutral-50 inline-flex items-center gap-1.5 shrink-0 disabled:opacity-45"
                  >
                    {addingSample ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="w-3.5 h-3.5" />
                    )}
                    <span>补充照片</span>
                  </button>
                  <input
                    ref={addSampleInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAddSampleFile}
                    className="hidden"
                  />
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                  {selectedPerson.samples.map((sample) => (
                    <div key={sample.id} className="space-y-1 relative">
                      <div className="aspect-square rounded-xl overflow-hidden bg-[#F4F4F2] border border-neutral-200/80 relative">
                        <img
                          src={sample.thumbnail}
                          alt={sample.sourceFilename}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                        {selectedPerson.samples.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              void onDeleteSample(selectedPerson.id, sample.id)
                            }
                            aria-label="移除该照片样本"
                            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/65 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-400 truncate font-mono">
                        {sample.sourceFilename}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {selectedPerson.samples[0] && (
                <div className="space-y-2 pt-4 border-t border-neutral-100">
                  <span className="text-xs font-medium text-neutral-700">
                    128 维特征向量分布
                  </span>
                  <VectorBarcode descriptor={selectedPerson.samples[0].descriptor} />
                </div>
              )}

              <div className="pt-4 border-t border-neutral-100">
                {confirmDeleteId === selectedPerson.id ? (
                  <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
                    <span className="text-xs text-red-800">
                      确定删除「{selectedPerson.name}」及特征数据？
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="min-h-[34px] px-2.5 rounded-lg bg-white border border-neutral-200 text-xs text-neutral-700"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await onDeletePerson(selectedPerson.id);
                          closePersonSheet();
                        }}
                        className="min-h-[34px] px-2.5 rounded-lg bg-red-600 text-white text-xs font-medium"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(selectedPerson.id)}
                    className="min-h-[40px] px-3 py-1.5 rounded-xl text-red-600 hover:bg-red-50 text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>删除该人物</span>
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
