import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  FlipHorizontal2,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  ScanFace,
  UserCheck,
  UserPlus,
  Users,
  Video,
  VideoOff,
  AlertTriangle,
} from 'lucide-react';
import type {
  EngineState,
  PersonRecord,
  RecognitionHistoryEntry,
  RecognizedFace,
} from '../types/face';
import {
  createSnapshotDataUrl,
  distanceToSimilarity,
  loadImageElement,
  readFileAsDataUrl,
  recognizeFacesInSource,
} from '../services/faceEngine';
import * as faceapi from '@vladmandic/face-api';
import { SAMPLE_PROFILES } from '../data/sampleProfiles';

interface CameraRecognizeViewProps {
  persons: PersonRecord[];
  engineState: EngineState;
  threshold: number;
  onChangeThreshold: (value: number) => void;
  onQuickRegisterFace: (
    name: string,
    note: string,
    descriptor: number[],
    thumbnail: string
  ) => Promise<PersonRecord>;
  onRecordHistory: (entry: RecognitionHistoryEntry) => Promise<void>;
  onGoToImport: () => void;
  onImportSamples: () => Promise<void>;
  isImporting: boolean;
}

const THRESHOLD_PRESETS = [
  { label: '严格', value: 0.44, desc: '防误识优先' },
  { label: '标准', value: 0.52, desc: '推荐平衡' },
  { label: '宽松', value: 0.6, desc: '逆光/侧脸兼容' },
] as const;

export const CameraRecognizeView: React.FC<CameraRecognizeViewProps> = ({
  persons,
  engineState,
  threshold,
  onChangeThreshold,
  onQuickRegisterFace,
  onRecordHistory,
  onGoToImport,
  onImportSamples,
  isImporting,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const albumInputRef = useRef<HTMLInputElement>(null);
  const liveLoopTimerRef = useRef<number | null>(null);
  const liveBusyRef = useRef(false);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('user');
  const [liveTracking, setLiveTracking] = useState(true);
  const [liveFaces, setLiveFaces] = useState<RecognizedFace[]>([]);
  const [liveElapsedMs, setLiveElapsedMs] = useState<number | null>(null);

  // Captured / analyzed photo state
  const [capturedImageUrl, setCapturedImageUrl] = useState<string | null>(null);
  const [capturedFaces, setCapturedFaces] = useState<RecognizedFace[]>([]);
  const [capturedElapsedMs, setCapturedElapsedMs] = useState<number | null>(null);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Quick register unknown face state
  const [registerName, setRegisterName] = useState('');
  const [registerNote, setRegisterNote] = useState('');
  const [registering, setRegistering] = useState(false);

  const stopCamera = useCallback(() => {
    if (liveLoopTimerRef.current !== null) {
      window.clearTimeout(liveLoopTimerRef.current);
      liveLoopTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setLiveFaces([]);
  }, []);

  const startCamera = useCallback(
    async (requestedFacing: 'environment' | 'user' = facingMode) => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('当前浏览器不支持摄像头访问，请使用下方「相册选图」进行照片识别。');
        return;
      }

      stopCamera();
      setCameraStarting(true);
      setCameraError(null);
      setCapturedImageUrl(null);
      setCapturedFaces([]);
      setSelectedFaceId(null);
      setAnalysisError(null);

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: requestedFacing },
              width: { ideal: 1280 },
              height: { ideal: 960 },
            },
            audio: false,
          });
        } catch {
          // Fallback without facingMode constraint on desktop cameras
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setFacingMode(requestedFacing);
        setCameraActive(true);
      } catch (err) {
        const message =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? '摄像头权限未开启。请在浏览器地址栏允许相机权限，或直接使用「相册选图」识别照片。'
            : '未检测到可用摄像头，您仍可直接选择本地照片或示例人像体验快速识人。';
        setCameraError(message);
      } finally {
        setCameraStarting(false);
      }
    },
    [facingMode, stopCamera]
  );

  // Stop camera cleanly on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Re-evaluate captured faces immediately whenever persons library or threshold changes
  const evaluatedCapturedFaces = useMemo(() => {
    if (capturedFaces.length === 0) return [];
    return capturedFaces.map((face) => {
      if (persons.length === 0) {
        return { ...face, matchedPerson: null, topCandidates: [] };
      }

      const candidates = persons
        .map((person) => {
          let minDist = Number.POSITIVE_INFINITY;
          let refThumb = person.samples[0]?.thumbnail || '';
          for (const sample of person.samples) {
            const d = faceapi.euclideanDistance(face.descriptor, sample.descriptor);
            if (d < minDist) {
              minDist = d;
              refThumb = sample.thumbnail;
            }
          }
          return {
            personId: person.id,
            personName: person.name,
            personNote: person.note,
            referenceThumbnail: refThumb,
            distance: Number(minDist.toFixed(4)),
            similarity: distanceToSimilarity(minDist),
          };
        })
        .sort((a, b) => a.distance - b.distance);

      const topCandidates = candidates.slice(0, 3);
      const best = topCandidates[0];
      const matchedPerson = best && best.distance <= threshold ? best : null;
      return {
        ...face,
        matchedPerson,
        topCandidates,
      };
    });
  }, [capturedFaces, persons, threshold]);

  // Real-time live camera face tracking loop
  useEffect(() => {
    if (
      !cameraActive ||
      !liveTracking ||
      capturedImageUrl !== null ||
      engineState.status !== 'ready'
    ) {
      setLiveFaces([]);
      if (liveLoopTimerRef.current !== null) {
        window.clearTimeout(liveLoopTimerRef.current);
        liveLoopTimerRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const runStep = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && !liveBusyRef.current) {
        liveBusyRef.current = true;
        try {
          const result = await recognizeFacesInSource(video, persons, threshold, 'fast');
          if (!cancelled) {
            setLiveFaces(result.faces);
            setLiveElapsedMs(result.elapsedMs);
          }
        } catch {
          // Ignore single frame errors during stream transitions
        } finally {
          liveBusyRef.current = false;
        }
      }
      if (!cancelled) {
        liveLoopTimerRef.current = window.setTimeout(runStep, 280);
      }
    };

    liveLoopTimerRef.current = window.setTimeout(runStep, 180);

    return () => {
      cancelled = true;
      if (liveLoopTimerRef.current !== null) {
        window.clearTimeout(liveLoopTimerRef.current);
        liveLoopTimerRef.current = null;
      }
    };
  }, [cameraActive, liveTracking, capturedImageUrl, engineState.status, persons, threshold]);

  const analyzeImageSource = async (
    source: HTMLImageElement | HTMLVideoElement,
    sourceType: 'camera' | 'album' | 'sample'
  ) => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    setRegisterName('');
    setRegisterNote('');

    try {
      const snap = createSnapshotDataUrl(source, 960);
      setCapturedImageUrl(snap.dataUrl);

      const result = await recognizeFacesInSource(source, persons, threshold, 'accurate');
      setCapturedFaces(result.faces);
      setCapturedElapsedMs(result.elapsedMs);
      setSelectedFaceId(result.faces[0]?.id ?? null);

      const historyEntry: RecognitionHistoryEntry = {
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        snapshotDataUrl: snap.dataUrl,
        sourceType,
        elapsedMs: result.elapsedMs,
        threshold,
        matches: result.faces.map((f) => ({
          name: f.matchedPerson?.personName ?? '未匹配人物',
          matched: Boolean(f.matchedPerson),
          similarity: f.matchedPerson?.similarity ?? (f.topCandidates[0]?.similarity ?? 0),
          distance: f.matchedPerson?.distance ?? (f.topCandidates[0]?.distance ?? 1),
          personId: f.matchedPerson?.personId ?? null,
        })),
      };
      await onRecordHistory(historyEntry);
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : '识别该照片时出现异常，请重试'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCapturePhoto = async () => {
    const video = videoRef.current;
    if (!video || !cameraActive || engineState.status !== 'ready') return;

    setShutterFlash(true);
    window.setTimeout(() => setShutterFlash(false), 160);

    await analyzeImageSource(video, 'camera');
  };

  const handleAlbumFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || engineState.status !== 'ready') return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const img = await loadImageElement(dataUrl);
      await analyzeImageSource(img, 'album');
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : '无法读取该照片');
    }
  };

  const handleTestSamplePhoto = async (imageUrl: string) => {
    if (engineState.status !== 'ready') return;
    try {
      const img = await loadImageElement(imageUrl);
      await analyzeImageSource(img, 'sample');
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : '示例照片读取失败');
    }
  };

  const handleResumeLive = () => {
    setCapturedImageUrl(null);
    setCapturedFaces([]);
    setSelectedFaceId(null);
    setAnalysisError(null);
    if (!cameraActive) {
      void startCamera(facingMode);
    }
  };

  const activeFaces = capturedImageUrl ? evaluatedCapturedFaces : liveFaces;
  const activeElapsedMs = capturedImageUrl ? capturedElapsedMs : liveElapsedMs;
  const activeSelectedFace =
    evaluatedCapturedFaces.find((f) => f.id === selectedFaceId) ??
    evaluatedCapturedFaces[0] ??
    null;

  const isFrontMirrored = cameraActive && !capturedImageUrl && facingMode === 'user';

  const handleSubmitQuickRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSelectedFace) return;
    const cleanName = registerName.trim();
    if (!cleanName) return;

    setRegistering(true);
    try {
      await onQuickRegisterFace(
        cleanName,
        registerNote.trim(),
        activeSelectedFace.descriptor,
        activeSelectedFace.cropThumbnail
      );
      setRegisterName('');
      setRegisterNote('');
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left / Main Stage: Precision Camera Viewfinder + Thumb Controls */}
      <div className="lg:col-span-7 space-y-4">
        {/* Empty Library Reminder Strip (only when library has 0 people) */}
        {persons.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200/80 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">
                当前人物特征库为空
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                先导入命名照片建库，拍照后即可自动比对并显示姓名
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={engineState.status !== 'ready' || isImporting}
                onClick={() => void onImportSamples()}
                className="min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
              >
                {isImporting ? '提取中...' : '一键导入 4 位示例人物'}
              </button>
              <button
                type="button"
                onClick={onGoToImport}
                className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 whitespace-nowrap"
              >
                导入自有照片
              </button>
            </div>
          </div>
        )}

        {/* Optical Viewfinder Container */}
        <div className="bg-[#0B0E14] rounded-3xl overflow-hidden border border-slate-900/15 shadow-sm">
          {/* Viewfinder Top Utility Bar */}
          <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-white/10">
            <div className="text-xs text-slate-300 flex items-center gap-2 tabular-nums">
              <span className="font-medium text-white">
                {capturedImageUrl
                  ? '照片识别结果'
                  : cameraActive
                    ? facingMode === 'environment'
                      ? '后置镜头'
                      : '前置镜头'
                    : '拍照识人取景器'}
              </span>
              {activeElapsedMs !== null && (
                <>
                  <span aria-hidden="true" className="text-slate-600">
                    ·
                  </span>
                  <span className="font-mono text-slate-300">{activeElapsedMs} ms</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {cameraActive && !capturedImageUrl && (
                <button
                  type="button"
                  onClick={() => setLiveTracking((v) => !v)}
                  className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    liveTracking
                      ? 'bg-blue-600 text-white'
                      : 'bg-white/10 text-slate-300 hover:bg-white/15'
                  }`}
                >
                  {liveTracking ? '实时标名：开' : '实时标名：关'}
                </button>
              )}

              {cameraActive && (
                <button
                  type="button"
                  onClick={stopCamera}
                  aria-label="关闭摄像头"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white transition-colors"
                >
                  <VideoOff className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Main Lens Canvas Area */}
          <div className="relative w-full bg-[#0B0E14] min-h-[340px] flex items-center justify-center overflow-hidden">
            {/* Tightly Fitted Media + Overlay Stage (Zero Letterbox Offset) */}
            <div
              className={`relative items-center justify-center max-w-full ${
                cameraActive || capturedImageUrl ? 'inline-flex' : 'hidden'
              }`}
            >
              {/* Live Video Stream (kept mounted so videoRef is always available) */}
              <video
                ref={videoRef}
                playsInline
                muted
                className={`block max-h-[540px] max-w-full w-auto h-auto ${
                  cameraActive && !capturedImageUrl ? 'block' : 'hidden'
                } ${isFrontMirrored ? '-scale-x-100' : ''}`}
              />

              {/* Captured Snapshot Image */}
              {capturedImageUrl && (
                <img
                  src={capturedImageUrl}
                  alt="已拍摄识别的照片"
                  referrerPolicy="no-referrer"
                  className="block max-h-[540px] max-w-full w-auto h-auto"
                />
              )}

              {/* Real-Time & Snapshot Face Bounding Box Overlay */}
              {activeFaces.length > 0 && (
                <div className="absolute inset-0 pointer-events-none">
                  {activeFaces.map((face) => {
                    const matched = Boolean(face.matchedPerson);
                    const isSelected =
                      capturedImageUrl && activeSelectedFace?.id === face.id;
                    const displayX = isFrontMirrored
                      ? 1 - face.box.x - face.box.width
                      : face.box.x;
                    const labelBelow = face.box.y < 0.12;

                    return (
                      <button
                        key={face.id}
                        type="button"
                        onClick={() =>
                          capturedImageUrl && setSelectedFaceId(face.id)
                        }
                        style={{
                          left: `${displayX * 100}%`,
                          top: `${face.box.y * 100}%`,
                          width: `${face.box.width * 100}%`,
                          height: `${face.box.height * 100}%`,
                        }}
                        className={`absolute rounded-lg transition-all duration-150 ${
                          capturedImageUrl
                            ? 'pointer-events-auto cursor-pointer'
                            : 'pointer-events-none'
                        } ${
                          matched
                            ? isSelected
                              ? 'ring-2 ring-emerald-400 bg-emerald-500/10'
                              : 'ring-2 ring-emerald-400/85'
                            : isSelected
                              ? 'ring-2 ring-amber-400 bg-amber-500/10'
                              : 'ring-2 ring-amber-400/80'
                        }`}
                      >
                        {/* High-Contrast Floating Name Plate */}
                        <div
                          className={`absolute left-0 ${
                            labelBelow ? 'top-full mt-1.5' : '-top-8'
                          } max-w-[220px] px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 shadow-md ${
                            matched
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-900/90 text-amber-200 border border-amber-400/50'
                          }`}
                        >
                          <span className="truncate">
                            {face.matchedPerson
                              ? face.matchedPerson.personName
                              : '未匹配人物'}
                          </span>
                          {face.matchedPerson && (
                            <span className="font-mono text-[11px] opacity-90 tabular-nums">
                              {face.matchedPerson.similarity}%
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Idle / Permission Fallback State */}
            {!cameraActive && !capturedImageUrl && (
              <div className="px-6 py-12 text-center max-w-md mx-auto space-y-5">
                <div className="mx-auto w-14 h-14 rounded-2xl bg-white/8 border border-white/10 flex items-center justify-center text-blue-400">
                  <ScanFace className="w-7 h-7" />
                </div>

                <div className="space-y-1.5">
                  <h2 className="text-base font-semibold text-white">
                    {cameraStarting ? '正在启动摄像头...' : '准备就绪，随时拍照识人'}
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {cameraError ||
                      '点击下方按钮开启手机/电脑摄像头拍照识别，或直接从相册选取照片进行人物检索。'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    disabled={cameraStarting || engineState.status !== 'ready'}
                    onClick={() => void startCamera(facingMode)}
                    className="min-h-[46px] px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 active:scale-[0.98] transition-all inline-flex items-center gap-2 disabled:opacity-50 whitespace-nowrap"
                  >
                    {cameraStarting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Video className="w-4 h-4" />
                    )}
                    <span>开启摄像头</span>
                  </button>

                  <button
                    type="button"
                    disabled={engineState.status !== 'ready'}
                    onClick={() => albumInputRef.current?.click()}
                    className="min-h-[46px] px-4 py-2.5 rounded-xl bg-white/10 text-white text-sm font-medium hover:bg-white/15 active:scale-[0.98] transition-all inline-flex items-center gap-2 disabled:opacity-50 whitespace-nowrap"
                  >
                    <ImageIcon className="w-4 h-4" />
                    <span>相册选图识别</span>
                  </button>
                </div>
              </div>
            )}

            {/* Analyzing Overlay */}
            {isAnalyzing && (
              <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs flex flex-col items-center justify-center gap-2.5 text-white">
                <Loader2 className="w-7 h-7 animate-spin text-blue-400" />
                <span className="text-sm font-medium">正在提取面部特征并检索人物库...</span>
              </div>
            )}

            {/* Subtle Shutter Flash */}
            {shutterFlash && (
              <div className="absolute inset-0 bg-white/80 pointer-events-none transition-opacity duration-150" />
            )}
          </div>

          {/* Bottom Thumb-Zone Camera Action Bar */}
          <div className="px-5 py-4 bg-[#11151E] border-t border-white/10 flex items-center justify-between gap-4">
            {/* Left Action: Pick Photo from Album */}
            <button
              type="button"
              disabled={engineState.status !== 'ready' || isAnalyzing}
              onClick={() => albumInputRef.current?.click()}
              className="min-h-[48px] min-w-[84px] px-3 py-2 rounded-2xl bg-white/10 hover:bg-white/15 active:scale-[0.97] text-white text-xs font-medium flex flex-col items-center justify-center gap-1 transition-all disabled:opacity-45"
            >
              <ImageIcon className="w-4 h-4" />
              <span>相册选图</span>
            </button>

            <input
              ref={albumInputRef}
              type="file"
              accept="image/*"
              onChange={handleAlbumFileChange}
              className="hidden"
            />

            {/* Center Primary CTA: Tactile Shutter / Resume Camera */}
            {capturedImageUrl ? (
              <button
                type="button"
                onClick={handleResumeLive}
                className="min-h-[54px] px-6 py-3 rounded-full bg-blue-600 hover:bg-blue-500 active:scale-[0.97] text-white text-sm font-semibold flex items-center gap-2 shadow-lg shadow-blue-950/40 transition-all whitespace-nowrap"
              >
                <RefreshCw className="w-4 h-4" />
                <span>继续拍照识别</span>
              </button>
            ) : cameraActive ? (
              <button
                type="button"
                disabled={engineState.status !== 'ready' || isAnalyzing}
                onClick={() => void handleCapturePhoto()}
                aria-label="拍照并识别人物"
                className="group relative w-16 h-16 rounded-full border-[3px] border-white/90 p-1 flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
              >
                <span className="w-full h-full rounded-full bg-white group-hover:bg-blue-50 flex items-center justify-center text-slate-900">
                  <Camera className="w-6 h-6" />
                </span>
              </button>
            ) : (
              <button
                type="button"
                disabled={cameraStarting || engineState.status !== 'ready'}
                onClick={() => void startCamera(facingMode)}
                className="min-h-[54px] px-6 py-3 rounded-full bg-blue-600 hover:bg-blue-500 active:scale-[0.97] text-white text-sm font-semibold flex items-center gap-2 transition-all disabled:opacity-50 whitespace-nowrap"
              >
                <Camera className="w-4 h-4" />
                <span>开启拍照识别</span>
              </button>
            )}

            {/* Right Action: Switch Front/Rear Camera */}
            <button
              type="button"
              disabled={cameraStarting || engineState.status !== 'ready'}
              onClick={() => {
                const next = facingMode === 'environment' ? 'user' : 'environment';
                if (cameraActive && !capturedImageUrl) {
                  void startCamera(next);
                } else {
                  setFacingMode(next);
                }
              }}
              className="min-h-[48px] min-w-[84px] px-3 py-2 rounded-2xl bg-white/10 hover:bg-white/15 active:scale-[0.97] text-white text-xs font-medium flex flex-col items-center justify-center gap-1 transition-all disabled:opacity-45"
            >
              <FlipHorizontal2 className="w-4 h-4" />
              <span>{facingMode === 'environment' ? '切前置' : '切后置'}</span>
            </button>
          </div>
        </div>

        {/* Quick Test Strip using Sample Portraits (handy on devices without camera) */}
        {persons.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">
                快速照片比对测试（点击任意测试图立即检索）
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2.5">
              {SAMPLE_PROFILES.map((sample) => (
                <button
                  key={sample.filename}
                  type="button"
                  disabled={engineState.status !== 'ready' || isAnalyzing}
                  onClick={() => void handleTestSamplePhoto(sample.imageUrl)}
                  className="group relative aspect-[4/3] rounded-xl overflow-hidden bg-slate-100 border border-slate-200/80 hover:border-blue-500 transition-colors disabled:opacity-50"
                >
                  <img
                    src={sample.imageUrl}
                    alt={`测试识别 ${sample.name}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-200"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2 py-1 text-left">
                    <span className="text-[11px] font-medium text-white">
                      测试图
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right Column: Real-Time Identification Results & Sensitivity Controls */}
      <div className="lg:col-span-5 space-y-4">
        {/* Identification Results Card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold text-slate-900">
                人物姓名识别结果
              </h1>
              <div className="text-xs text-slate-500 mt-0.5 tabular-nums flex items-center gap-2">
                <span>人物库 {persons.length} 人</span>
                {activeElapsedMs !== null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>耗时 {activeElapsedMs} ms</span>
                  </>
                )}
              </div>
            </div>

            {capturedImageUrl && evaluatedCapturedFaces.length > 1 && (
              <span className="text-xs font-medium text-blue-600 tabular-nums">
                检测到 {evaluatedCapturedFaces.length} 人
              </span>
            )}
          </div>

          <div className="p-5 space-y-5">
            {analysisError && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{analysisError}</span>
              </div>
            )}

            {/* Case 1: Captured Photo Result */}
            {capturedImageUrl ? (
              evaluatedCapturedFaces.length === 0 ? (
                <div className="py-8 text-center space-y-2">
                  <p className="text-sm font-semibold text-slate-800">
                    照片中未检测到清晰人脸
                  </p>
                  <p className="text-xs text-slate-500">
                    请确保人物面部光线充足、正面朝向镜头且未被遮挡后重新拍摄。
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Multi-face selector strip if group photo */}
                  {evaluatedCapturedFaces.length > 1 && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {evaluatedCapturedFaces.map((face, idx) => {
                        const isSel = activeSelectedFace?.id === face.id;
                        return (
                          <button
                            key={face.id}
                            type="button"
                            onClick={() => setSelectedFaceId(face.id)}
                            className={`min-h-[44px] px-2.5 py-1.5 rounded-xl border flex items-center gap-2 shrink-0 transition-colors ${
                              isSel
                                ? 'border-blue-600 bg-blue-50/70'
                                : 'border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            {face.cropThumbnail && (
                              <img
                                src={face.cropThumbnail}
                                alt={`人脸 ${idx + 1}`}
                                referrerPolicy="no-referrer"
                                className="w-7 h-7 rounded-lg object-cover"
                              />
                            )}
                            <span className="text-xs font-medium text-slate-900 whitespace-nowrap">
                              {face.matchedPerson?.personName ?? `人物 ${idx + 1}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Active Face Match Detail */}
                  {activeSelectedFace && (
                    <div className="space-y-4">
                      {activeSelectedFace.matchedPerson ? (
                        <div className="space-y-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                                <CheckCircle2 className="w-4 h-4" />
                                <span>已匹配人物库档案</span>
                              </div>
                              <div className="text-3xl font-bold tracking-tight text-slate-900 mt-1">
                                {activeSelectedFace.matchedPerson.personName}
                              </div>
                              {activeSelectedFace.matchedPerson.personNote && (
                                <p className="text-sm text-slate-500 mt-0.5">
                                  {activeSelectedFace.matchedPerson.personNote}
                                </p>
                              )}
                            </div>

                            <div className="text-right tabular-nums shrink-0">
                              <div className="text-2xl font-bold text-emerald-700 font-mono">
                                {activeSelectedFace.matchedPerson.similarity}%
                              </div>
                              <div className="text-[11px] text-slate-500 font-mono">
                                距离 {activeSelectedFace.matchedPerson.distance.toFixed(3)}
                              </div>
                            </div>
                          </div>

                          {/* Side-by-side Face Comparison */}
                          <div className="grid grid-cols-2 gap-3 pt-1">
                            <div className="space-y-1.5">
                              <div className="aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200/80">
                                {activeSelectedFace.cropThumbnail && (
                                  <img
                                    src={activeSelectedFace.cropThumbnail}
                                    alt="本次拍摄人脸"
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                )}
                              </div>
                              <p className="text-xs text-slate-500 text-center">本次拍摄</p>
                            </div>

                            <div className="space-y-1.5">
                              <div className="aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200/80">
                                {activeSelectedFace.matchedPerson.referenceThumbnail && (
                                  <img
                                    src={activeSelectedFace.matchedPerson.referenceThumbnail}
                                    alt={activeSelectedFace.matchedPerson.personName}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                )}
                              </div>
                              <p className="text-xs text-slate-500 text-center">
                                库内底图 · {activeSelectedFace.matchedPerson.personName}
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center gap-3.5">
                            {activeSelectedFace.cropThumbnail && (
                              <img
                                src={activeSelectedFace.cropThumbnail}
                                alt="未匹配人脸"
                                referrerPolicy="no-referrer"
                                className="w-16 h-16 rounded-2xl object-cover border border-slate-200"
                              />
                            )}
                            <div>
                              <div className="text-base font-semibold text-slate-900">
                                未匹配到已建档人物
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {persons.length === 0
                                  ? '人物库为空，可直接将该人脸录入建档'
                                  : `当前阈值下无高于标准的匹配（最接近距离 ${
                                      activeSelectedFace.topCandidates[0]?.distance.toFixed(3) ?? '-'
                                    }）`}
                              </p>
                            </div>
                          </div>

                          {/* One-Tap Quick Register Form */}
                          <form
                            onSubmit={handleSubmitQuickRegister}
                            className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3"
                          >
                            <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                              <UserPlus className="w-4 h-4 text-blue-600" />
                              <span>直接将此人脸保存为新人物</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              <input
                                type="text"
                                required
                                value={registerName}
                                onChange={(e) => setRegisterName(e.target.value)}
                                placeholder="输入人物姓名"
                                className="min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                              />
                              <input
                                type="text"
                                value={registerNote}
                                onChange={(e) => setRegisterNote(e.target.value)}
                                placeholder="备注（选填）"
                                className="min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                              />
                            </div>
                            <button
                              type="submit"
                              disabled={registering || !registerName.trim()}
                              className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                              {registering ? '保存中...' : '录入特征并立即匹配'}
                            </button>
                          </form>
                        </div>
                      )}

                      {/* Top 3 Closest Candidates */}
                      {activeSelectedFace.topCandidates.length > 0 && (
                        <div className="pt-4 border-t border-slate-100 space-y-2.5">
                          <div className="text-xs font-medium text-slate-500">
                            特征向量最接近候选（前 {activeSelectedFace.topCandidates.length} 位）
                          </div>
                          <div className="space-y-2">
                            {activeSelectedFace.topCandidates.map((cand) => {
                              const isMatched = cand.distance <= threshold;
                              return (
                                <div
                                  key={cand.personId}
                                  className="flex items-center gap-3 py-1"
                                >
                                  <img
                                    src={cand.referenceThumbnail}
                                    alt={cand.personName}
                                    referrerPolicy="no-referrer"
                                    className="w-9 h-9 rounded-lg object-cover bg-slate-100 shrink-0"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                      <span className="font-medium text-slate-900 truncate">
                                        {cand.personName}
                                      </span>
                                      <span
                                        className={`font-mono tabular-nums ${
                                          isMatched ? 'text-emerald-700 font-semibold' : 'text-slate-500'
                                        }`}
                                      >
                                        {cand.similarity}% · d={cand.distance.toFixed(3)}
                                      </span>
                                    </div>
                                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1.5">
                                      <div
                                        className={`h-full rounded-full ${
                                          isMatched ? 'bg-emerald-500' : 'bg-slate-300'
                                        }`}
                                        style={{ width: `${cand.similarity}%` }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            ) : cameraActive && liveFaces.length > 0 ? (
              /* Case 2: Live Tracking Preview List */
              <div className="space-y-3">
                <div className="text-xs text-slate-500">
                  正在实时取景追踪，按下快门可锁定高清帧并保存识别记录
                </div>
                {liveFaces.map((face, idx) => (
                  <div
                    key={face.id}
                    className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          face.matchedPerson
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        <UserCheck className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-base font-semibold text-slate-900 truncate">
                          {face.matchedPerson
                            ? face.matchedPerson.personName
                            : `未匹配人物 #${idx + 1}`}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {face.matchedPerson?.personNote || '实时特征追踪中'}
                        </div>
                      </div>
                    </div>
                    {face.matchedPerson && (
                      <span className="font-mono text-sm font-semibold text-emerald-700 tabular-nums shrink-0">
                        {face.matchedPerson.similarity}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              /* Case 3: Waiting for capture */
              <div className="py-10 text-center space-y-2.5">
                <div className="mx-auto w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                  <Users className="w-5 h-5" />
                </div>
                <p className="text-sm font-medium text-slate-800">
                  等待拍摄或选择人物照片
                </p>
                <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                  拍摄单人或多人合照后，此处将实时显示每位人物的姓名、匹配置信度及底图对照。
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Matching Sensitivity Selector */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900">
              比对严格度阈值
            </span>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              欧氏距离 ≤ {threshold.toFixed(2)}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl">
            {THRESHOLD_PRESETS.map((preset) => {
              const active = Math.abs(threshold - preset.value) < 0.01;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => onChangeThreshold(preset.value)}
                  className={`min-h-[42px] px-2 py-1.5 rounded-lg text-xs font-medium transition-colors flex flex-col items-center justify-center ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>{preset.label}</span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    {preset.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
