import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Loader2, ScanFace, UserPlus, Video } from 'lucide-react';
import * as faceapi from '@vladmandic/face-api';
import type { EngineState, PersonRecord, RecognizedFace } from '../types/face';
import {
  distanceToSimilarity,
  recognizeFacesInSource,
  similarityToDistance,
} from '../services/faceEngine';

interface CameraRecognizeViewProps {
  persons: PersonRecord[];
  engineState: EngineState;
  minSimilarity: number;
  onQuickRegisterFace: (
    name: string,
    note: string,
    descriptor: number[],
    thumbnail: string
  ) => Promise<PersonRecord>;
}

interface ZoomCapabilities extends MediaTrackCapabilities {
  zoom?: {
    min: number;
    max: number;
    step?: number;
  };
}

interface ZoomSettings extends MediaTrackSettings {
  zoom?: number;
}

interface ZoomConstraintSet extends MediaTrackConstraintSet {
  zoom?: number;
}

function getTouchDistance(t1: React.Touch, t2: React.Touch): number {
  return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

export const CameraRecognizeView: React.FC<CameraRecognizeViewProps> = ({
  persons,
  engineState,
  minSimilarity,
  onQuickRegisterFace,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Hardware + fallback digital zoom state
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(4);
  const [hardwareZoomSupported, setHardwareZoomSupported] = useState(false);
  const [zoomBadgeVisible, setZoomBadgeVisible] = useState(false);

  const zoomStepRef = useRef(0.1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const zoomApplyingRef = useRef(false);
  const pendingZoomRef = useRef<number | null>(null);
  const zoomBadgeTimerRef = useRef<number | null>(null);
  const pinchStateRef = useRef<{
    startDist: number;
    startZoom: number;
  } | null>(null);

  const [capturedFaces, setCapturedFaces] = useState<RecognizedFace[]>([]);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [hasAttemptedCapture, setHasAttemptedCapture] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [registerName, setRegisterName] = useState('');
  const [registering, setRegistering] = useState(false);

  const internalCutoff = useMemo(
    () => similarityToDistance(minSimilarity),
    [minSimilarity]
  );

  const showZoomBadgeBriefly = useCallback(() => {
    setZoomBadgeVisible(true);
    if (zoomBadgeTimerRef.current !== null) {
      window.clearTimeout(zoomBadgeTimerRef.current);
    }
    zoomBadgeTimerRef.current = window.setTimeout(() => {
      setZoomBadgeVisible(false);
    }, 1600);
  }, []);

  const applyZoomValue = useCallback(
    async (rawNextZoom: number) => {
      const clamped = Math.max(minZoom, Math.min(maxZoom, rawNextZoom));
      const step = zoomStepRef.current;
      const snapped =
        step > 0
          ? Math.round((clamped - minZoom) / step) * step + minZoom
          : clamped;
      const cleanZoom = Number(
        Math.max(minZoom, Math.min(maxZoom, snapped)).toFixed(2)
      );

      setZoom(cleanZoom);
      showZoomBadgeBriefly();

      if (!hardwareZoomSupported || !videoTrackRef.current) {
        return;
      }

      if (zoomApplyingRef.current) {
        pendingZoomRef.current = cleanZoom;
        return;
      }

      zoomApplyingRef.current = true;
      try {
        let target: number | null = cleanZoom;
        while (target !== null && videoTrackRef.current) {
          pendingZoomRef.current = null;
          const constraint: ZoomConstraintSet = { zoom: target };
          await videoTrackRef.current.applyConstraints({
            advanced: [constraint],
          });
          target = pendingZoomRef.current;
        }
      } catch {
        // Ignore transient hardware zoom rejections
      } finally {
        zoomApplyingRef.current = false;
      }
    },
    [hardwareZoomSupported, maxZoom, minZoom, showZoomBadgeBriefly]
  );

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    videoTrackRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const startRearCamera = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('当前设备不支持调用摄像头。');
      return;
    }

    stopCamera();
    setCameraStarting(true);
    setCameraError(null);

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] || null;
      videoTrackRef.current = track;

      // Inspect native system camera hardware zoom capability
      const caps = track?.getCapabilities
        ? (track.getCapabilities() as ZoomCapabilities)
        : null;

      if (caps?.zoom && caps.zoom.max > caps.zoom.min) {
        const settings = track?.getSettings
          ? (track.getSettings() as ZoomSettings)
          : null;
        const hwMin = Number(caps.zoom.min);
        const hwMax = Number(caps.zoom.max);
        const hwStep = Number(caps.zoom.step) || 0.1;
        const initial =
          typeof settings?.zoom === 'number'
            ? Math.max(hwMin, Math.min(hwMax, settings.zoom))
            : hwMin;

        setHardwareZoomSupported(true);
        setMinZoom(hwMin);
        setMaxZoom(hwMax);
        zoomStepRef.current = hwStep;
        setZoom(Number(initial.toFixed(2)));
      } else {
        // Fallback smooth digital sensor-crop zoom when hardware zoom is unavailable
        setHardwareZoomSupported(false);
        setMinZoom(1);
        setMaxZoom(4);
        zoomStepRef.current = 0.05;
        setZoom(1);
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? '摄像头权限未开启，请在系统或浏览器中允许访问相机。'
          : '未检测到可用摄像头，请检查设备相机状态。';
      setCameraError(message);
    } finally {
      setCameraStarting(false);
    }
  }, [stopCamera]);

  useEffect(() => {
    void startRearCamera();
    return () => {
      if (zoomBadgeTimerRef.current !== null) {
        window.clearTimeout(zoomBadgeTimerRef.current);
      }
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-evaluate captured faces immediately when library or similarity setting changes
  const evaluatedFaces = useMemo(() => {
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
      const matchedPerson =
        best && best.similarity >= minSimilarity ? best : null;

      return {
        ...face,
        matchedPerson,
        topCandidates,
      };
    });
  }, [capturedFaces, persons, minSimilarity]);

  const activeFace =
    evaluatedFaces.find((f) => f.id === selectedFaceId) ??
    evaluatedFaces[0] ??
    null;

  /**
   * Captures current video frame; if using digital zoom fallback (> 1x), crops the zoomed center region.
   */
  const buildCaptureSourceFromVideo = (
    video: HTMLVideoElement
  ): HTMLVideoElement | HTMLCanvasElement => {
    if (hardwareZoomSupported || zoomRef.current <= 1.01) {
      return video;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0) return video;

    const factor = zoomRef.current;
    const cropW = vw / factor;
    const cropH = vh / factor;
    const sx = (vw - cropW) / 2;
    const sy = (vh - cropH) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vw);
    canvas.height = Math.round(vh);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);
    }
    return canvas;
  };

  const handleCaptureClick = async () => {
    if (engineState.status !== 'ready' || isAnalyzing) return;
    if (!cameraActive || !videoRef.current) {
      await startRearCamera();
      return;
    }

    setShutterFlash(true);
    window.setTimeout(() => setShutterFlash(false), 140);

    setIsAnalyzing(true);
    setAnalysisError(null);
    setHasAttemptedCapture(true);
    setRegisterName('');

    try {
      const source = buildCaptureSourceFromVideo(videoRef.current);
      const result = await recognizeFacesInSource(
        source,
        persons,
        internalCutoff,
        'accurate'
      );
      setCapturedFaces(result.faces);
      setElapsedMs(result.elapsedMs);
      setSelectedFaceId(result.faces[0]?.id ?? null);
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : '识别失败，请调整光线后重试'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Two-finger pinch-to-zoom handlers
  const handleTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (!cameraActive || e.touches.length !== 2) return;
    const dist = getTouchDistance(e.touches[0], e.touches[1]);
    if (dist > 0) {
      pinchStateRef.current = {
        startDist: dist,
        startZoom: zoomRef.current,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    if (!cameraActive || e.touches.length !== 2 || !pinchStateRef.current) return;
    const currentDist = getTouchDistance(e.touches[0], e.touches[1]);
    const ratio = currentDist / pinchStateRef.current.startDist;
    const nextZoom = pinchStateRef.current.startZoom * ratio;
    void applyZoomValue(nextZoom);
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
    if (e.touches.length < 2) {
      pinchStateRef.current = null;
    }
  };

  const handleWheelZoom = (e: React.WheelEvent<HTMLElement>) => {
    if (!cameraActive) return;
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    void applyZoomValue(zoomRef.current + delta);
  };

  const handleQuickSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFace || !registerName.trim()) return;
    setRegistering(true);
    try {
      await onQuickRegisterFace(
        registerName.trim(),
        '',
        activeFace.descriptor,
        activeFace.cropThumbnail
      );
      setRegisterName('');
    } finally {
      setRegistering(false);
    }
  };

  const displayZoomRatio = minZoom > 0 ? zoom / minZoom : zoom;
  const isZoomedIn = displayZoomRatio > 1.04;

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* UPPER HALF: Rear Camera Viewfinder with Pinch-to-Zoom & Shutter Button */}
      <section
        aria-label="后置摄像头拍照区"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onWheel={handleWheelZoom}
        className="touch-none relative w-full bg-[#111214] rounded-2xl overflow-hidden border border-neutral-200/80 flex items-center justify-center min-h-[280px] h-[47vh] sm:h-[50vh] max-h-[520px] select-none"
      >
        <video
          ref={videoRef}
          playsInline
          muted
          style={
            !hardwareZoomSupported && zoom > 1
              ? { transform: `scale(${zoom})`, transformOrigin: 'center center' }
              : undefined
          }
          className={`w-full h-full object-cover transition-transform duration-75 ${
            cameraActive ? 'block' : 'hidden'
          }`}
        />

        {/* Camera Idle / Permission Fallback */}
        {!cameraActive && (
          <div className="px-6 py-8 text-center max-w-sm space-y-4">
            <div className="mx-auto w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center text-white/80">
              <ScanFace className="w-5 h-5" strokeWidth={1.75} />
            </div>
            <p className="text-xs text-neutral-300 leading-relaxed">
              {cameraStarting
                ? '正在启动后置摄像头...'
                : cameraError || '点击下方按钮开启后置摄像头'}
            </p>
            <button
              type="button"
              disabled={cameraStarting}
              onClick={() => void startRearCamera()}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-white text-neutral-950 text-xs font-medium hover:bg-neutral-100 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {cameraStarting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Video className="w-3.5 h-3.5" />
              )}
              <span>开启摄像头</span>
            </button>
          </div>
        )}

        {/* Minimal Floating Zoom Multiplier (Visible while pinching or zoomed in; tap to reset 1x) */}
        {cameraActive && (zoomBadgeVisible || isZoomedIn) && (
          <button
            type="button"
            onClick={() => void applyZoomValue(minZoom)}
            aria-label="重置焦距为 1 倍"
            className="absolute bottom-[86px] left-1/2 -translate-x-1/2 z-20 min-h-[30px] px-2.5 rounded-full bg-black/50 backdrop-blur-xs text-white text-xs font-mono tabular-nums hover:bg-black/70 transition-opacity"
          >
            {displayZoomRatio.toFixed(1)}×
          </button>
        )}

        {/* Shutter Button Anchored Bottom-Center of Camera Area */}
        {cameraActive && (
          <div className="absolute inset-x-0 bottom-4 z-20 flex flex-col items-center pointer-events-none">
            <button
              type="button"
              disabled={engineState.status !== 'ready' || isAnalyzing}
              onClick={() => void handleCaptureClick()}
              aria-label="拍照并匹配人物"
              className="pointer-events-auto w-[62px] h-[62px] rounded-full border-[2.5px] border-white/95 p-1 flex items-center justify-center bg-black/20 backdrop-blur-xs active:scale-92 transition-transform disabled:opacity-50"
            >
              <span className="w-full h-full rounded-full bg-white flex items-center justify-center text-neutral-900">
                {isAnalyzing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Camera className="w-5 h-5" strokeWidth={1.9} />
                )}
              </span>
            </button>
          </div>
        )}

        {/* Analyzing Veil */}
        {isAnalyzing && (
          <div className="absolute inset-0 z-10 bg-black/45 backdrop-blur-[2px] flex items-center justify-center">
            <div className="px-4 py-2 rounded-xl bg-black/75 text-white text-xs font-medium flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>正在识别匹配中...</span>
            </div>
          </div>
        )}

        {/* Shutter Flash */}
        {shutterFlash && (
          <div className="absolute inset-0 z-30 bg-white/80 pointer-events-none" />
        )}
      </section>

      {/* Multi-face Selector (Only appears if >= 2 faces captured in one photo) */}
      {evaluatedFaces.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          <span className="text-xs text-neutral-500 shrink-0">
            检测到 {evaluatedFaces.length} 张人脸：
          </span>
          {evaluatedFaces.map((face, idx) => {
            const selected = activeFace?.id === face.id;
            return (
              <button
                key={face.id}
                type="button"
                onClick={() => setSelectedFaceId(face.id)}
                className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                  selected
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-300'
                }`}
              >
                {face.matchedPerson?.personName ?? `人脸 ${idx + 1}`}
              </button>
            );
          })}
        </div>
      )}

      {analysisError && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">
          {analysisError}
        </p>
      )}

      {/* LOWER HALF: Strict Left / Right Comparison Split */}
      <section
        aria-label="抓拍与人物库比对结果"
        className="grid grid-cols-2 gap-3 sm:gap-5 flex-1 items-start"
      >
        {/* LEFT HALF: Captured Face Crop from Camera */}
        <div className="bg-white rounded-2xl border border-neutral-200/90 p-3 sm:p-4 space-y-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-neutral-500">
              抓拍人脸
            </span>
            {elapsedMs !== null && activeFace && (
              <span className="text-[11px] font-mono text-neutral-400 tabular-nums">
                {elapsedMs} ms
              </span>
            )}
          </div>

          <div className="aspect-square w-full rounded-xl overflow-hidden bg-[#F4F4F2] border border-neutral-100 flex items-center justify-center">
            {activeFace?.cropThumbnail ? (
              <img
                src={activeFace.cropThumbnail}
                alt="摄像区抓拍的人脸"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-xs text-neutral-400 px-3 text-center leading-relaxed">
                {hasAttemptedCapture && !isAnalyzing
                  ? '未检测到清晰人脸'
                  : '等待拍照抓拍'}
              </span>
            )}
          </div>

          <div className="min-h-[24px] flex items-center justify-between text-xs text-neutral-500">
            <span className="truncate">
              {activeFace
                ? `画面清晰度 ${Math.round(activeFace.detectionScore * 100)}%`
                : '双指开合可调焦'}
            </span>
          </div>
        </div>

        {/* RIGHT HALF: Matched Person Portrait & Name from Library */}
        <div className="bg-white rounded-2xl border border-neutral-200/90 p-3 sm:p-4 space-y-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-neutral-500">
              人物库匹配
            </span>
            {activeFace?.matchedPerson && (
              <span className="text-[11px] font-mono font-medium text-emerald-700 tabular-nums">
                相似度 {activeFace.matchedPerson.similarity}%
              </span>
            )}
          </div>

          <div className="aspect-square w-full rounded-xl overflow-hidden bg-[#F4F4F2] border border-neutral-100 flex items-center justify-center">
            {activeFace?.matchedPerson?.referenceThumbnail ? (
              <img
                src={activeFace.matchedPerson.referenceThumbnail}
                alt={activeFace.matchedPerson.personName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-xs text-neutral-400 px-3 text-center leading-relaxed">
                {activeFace
                  ? persons.length === 0
                    ? '暂无库内人物'
                    : '未匹配到库内人物'
                  : '等待比对结果'}
              </span>
            )}
          </div>

          <div className="min-h-[24px] flex items-baseline justify-between gap-2">
            {activeFace?.matchedPerson ? (
              <span className="text-base sm:text-lg font-semibold tracking-tight text-neutral-950 truncate">
                {activeFace.matchedPerson.personName}
              </span>
            ) : activeFace ? (
              <span className="text-xs text-neutral-500 truncate">
                {activeFace.topCandidates[0]
                  ? `最接近 ${activeFace.topCandidates[0].personName}（${activeFace.topCandidates[0].similarity}%）`
                  : '暂无匹配档案'}
              </span>
            ) : (
              <span className="text-xs text-neutral-400 truncate">
                匹配后显示姓名
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Inline Quick Save for Unmatched Face */}
      {activeFace && !activeFace.matchedPerson && (
        <form
          onSubmit={handleQuickSave}
          className="bg-white rounded-2xl border border-neutral-200/90 p-3.5 flex items-center gap-2.5"
        >
          <UserPlus className="w-4 h-4 text-neutral-400 shrink-0" />
          <input
            type="text"
            value={registerName}
            onChange={(e) => setRegisterName(e.target.value)}
            placeholder="未在库中匹配，输入姓名可直接录入..."
            className="flex-1 min-w-0 min-h-[38px] text-sm text-neutral-900 placeholder:text-neutral-400 bg-transparent focus:outline-none"
          />
          <button
            type="submit"
            disabled={registering || !registerName.trim()}
            className="min-h-[38px] px-3.5 rounded-xl bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            {registering ? '保存中' : '存入库'}
          </button>
        </form>
      )}
    </div>
  );
};
