import React, { useMemo, useRef, useState } from 'react';
import { Camera as CameraIcon, Loader2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import {
  Camera as NativeCamera,
  CameraDirection,
  CameraResultType,
  CameraSource,
} from '@capacitor/camera';
import type { EngineState, PersonRecord, RecognizedFace } from '../types/face';
import {
  loadImageElement,
  matchDescriptorAgainstLibrary,
  readFileAsDataUrl,
  recognizeFacesInSource,
} from '../services/faceEngine';

interface CameraRecognizeViewProps {
  persons: PersonRecord[];
  engineState: EngineState;
  minSimilarity: number;
}

export const CameraRecognizeView: React.FC<CameraRecognizeViewProps> = ({
  persons,
  engineState,
  minSimilarity,
}) => {
  const webCaptureInputRef = useRef<HTMLInputElement>(null);

  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);
  const [capturedFaces, setCapturedFaces] = useState<RecognizedFace[]>([]);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [hasAttemptedCapture, setHasAttemptedCapture] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Re-evaluate captured faces immediately whenever library or similarity setting changes
  const evaluatedFaces = useMemo(() => {
    if (capturedFaces.length === 0) return [];
    return capturedFaces.map((face) => {
      const { matchedPerson, topCandidates } = matchDescriptorAgainstLibrary(
        face.descriptor,
        persons,
        minSimilarity
      );
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

  const analyzeDataUrl = async (dataUrl: string) => {
    setCapturedPhotoUrl(dataUrl);
    setIsAnalyzing(true);
    setAnalysisError(null);
    setHasAttemptedCapture(true);

    try {
      const img = await loadImageElement(dataUrl);
      const result = await recognizeFacesInSource(
        img,
        persons,
        minSimilarity,
        'accurate'
      );
      setCapturedFaces(result.faces);
      setSelectedFaceId(result.faces[0]?.id ?? null);
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : '照片识别失败，请重新拍摄'
      );
      setCapturedFaces([]);
      setSelectedFaceId(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleOpenSystemCamera = async () => {
    if (engineState.status !== 'ready' || isCapturing || isAnalyzing) return;
    setAnalysisError(null);

    if (Capacitor.isNativePlatform()) {
      setIsCapturing(true);
      try {
        const photo = await NativeCamera.getPhoto({
          source: CameraSource.Camera,
          direction: CameraDirection.Rear,
          resultType: CameraResultType.DataUrl,
          quality: 92,
          width: 2048,
          correctOrientation: true,
          allowEditing: false,
          saveToGallery: false,
        });

        if (photo.dataUrl) {
          await analyzeDataUrl(photo.dataUrl);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Silently ignore when user taps Back/Cancel in the system camera
        if (!/cancel|dismiss|abort/i.test(msg)) {
          setAnalysisError('无法打开系统相机，请检查应用相机权限设置');
        }
      } finally {
        setIsCapturing(false);
      }
      return;
    }

    // Mobile & desktop web browser fallback: launches native camera on mobile browsers
    webCaptureInputRef.current?.click();
  };

  const handleWebInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      await analyzeDataUrl(dataUrl);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : '无法读取拍摄照片');
    }
  };

  const isBusy = engineState.status !== 'ready' || isCapturing || isAnalyzing;

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Hidden native-capture input for mobile web browser fallback */}
      <input
        ref={webCaptureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleWebInputChange}
        className="hidden"
      />

      {/* UPPER HALF: Native System Camera Trigger & High-Resolution Photo Preview */}
      <section
        aria-label="原生相机拍摄区"
        className={`relative w-full rounded-2xl overflow-hidden border border-neutral-200/90 flex items-center justify-center min-h-[260px] h-[46vh] sm:h-[48vh] max-h-[500px] ${
          capturedPhotoUrl ? 'bg-[#111214]' : 'bg-white'
        }`}
      >
        {capturedPhotoUrl ? (
          <>
            {/* Tightly Fitted Photo Stage so Face Boxes Align Precisely */}
            <div className="relative inline-flex items-center justify-center max-w-full max-h-full">
              <img
                src={capturedPhotoUrl}
                alt="系统相机拍摄照片"
                referrerPolicy="no-referrer"
                className="block max-h-[46vh] sm:max-h-[48vh] max-w-full w-auto h-auto"
              />

              {/* Clickable Face Boxes for Multi-Person Shots */}
              {evaluatedFaces.length > 0 && (
                <div className="absolute inset-0 pointer-events-none">
                  {evaluatedFaces.map((face) => {
                    const matched = Boolean(face.matchedPerson);
                    const isSelected = activeFace?.id === face.id;
                    return (
                      <button
                        key={face.id}
                        type="button"
                        onClick={() => setSelectedFaceId(face.id)}
                        style={{
                          left: `${face.box.x * 100}%`,
                          top: `${face.box.y * 100}%`,
                          width: `${face.box.width * 100}%`,
                          height: `${face.box.height * 100}%`,
                        }}
                        aria-label={face.matchedPerson?.personName ?? '未匹配人脸'}
                        className={`pointer-events-auto absolute rounded-md transition-all ${
                          matched
                            ? isSelected
                              ? 'ring-2 ring-emerald-400 bg-emerald-400/10'
                              : 'ring-1 ring-emerald-400/80'
                            : isSelected
                              ? 'ring-2 ring-white bg-white/10'
                              : 'ring-1 ring-white/70'
                        }`}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bottom-Center Tactile Re-Shoot Button */}
            <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center pointer-events-none">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleOpenSystemCamera()}
                aria-label="重新调用系统相机拍照"
                className="pointer-events-auto min-h-[48px] px-5 py-2.5 rounded-full bg-white/95 hover:bg-white text-neutral-950 text-xs font-semibold shadow-md backdrop-blur-xs active:scale-95 transition-all inline-flex items-center gap-2 disabled:opacity-50"
              >
                {isCapturing || isAnalyzing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CameraIcon className="w-4 h-4" strokeWidth={2} />
                )}
                <span>继续拍照</span>
              </button>
            </div>
          </>
        ) : (
          /* Serene Minimalist Initial Camera Launch Panel */
          <div className="px-6 py-8 text-center flex flex-col items-center justify-center gap-4">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleOpenSystemCamera()}
              aria-label="调用相机拍照"
              className="w-[76px] h-[76px] rounded-full bg-[#141413] hover:bg-neutral-800 active:scale-95 text-white flex items-center justify-center transition-all disabled:opacity-45"
            >
              {isCapturing || isAnalyzing ? (
                <Loader2 className="w-7 h-7 animate-spin" />
              ) : (
                <CameraIcon className="w-7 h-7" strokeWidth={1.75} />
              )}
            </button>

            <div className="space-y-1">
              <p className="text-sm font-medium text-neutral-900">
                点击调用相机拍照
              </p>
              <p className="text-xs text-neutral-500">
                支持原生光学变焦与长焦拍摄
              </p>
            </div>
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
      </section>

      {/* Multi-face Selector (Only when >= 2 faces detected in a photo) */}
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
        className="grid grid-cols-2 gap-3 sm:gap-5 flex-1 items-stretch"
      >
        {/* LEFT HALF: Captured Face Crop */}
        <div className="bg-white rounded-2xl border border-neutral-200/90 p-3 sm:p-4 flex flex-col gap-2.5">
          <div className="h-5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-neutral-500 leading-none">
              抓拍人脸
            </span>
          </div>

          <div className="aspect-square w-full rounded-xl overflow-hidden bg-[#F4F4F2] border border-neutral-100 flex items-center justify-center">
            {activeFace?.cropThumbnail ? (
              <img
                src={activeFace.cropThumbnail}
                alt="抓拍的人脸"
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

          <div className="h-7 flex items-center justify-between text-xs text-neutral-500">
            <span className="truncate leading-normal">
              {activeFace
                ? `画面清晰度 ${Math.round(activeFace.detectionScore * 100)}%`
                : '拍完自动检测人脸'}
            </span>
          </div>
        </div>

        {/* RIGHT HALF: Matched Person Portrait & Name from Library */}
        <div className="bg-white rounded-2xl border border-neutral-200/90 p-3 sm:p-4 flex flex-col gap-2.5">
          <div className="h-5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-neutral-500 leading-none">
              人物匹配
            </span>
            {activeFace?.matchedPerson && (
              <span className="text-[11px] font-mono font-medium text-emerald-700 tabular-nums leading-none">
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

          <div className="h-7 flex items-center justify-between gap-2 text-xs">
            {activeFace?.matchedPerson ? (
              <span className="text-base sm:text-lg font-semibold tracking-tight text-neutral-950 truncate leading-none">
                {activeFace.matchedPerson.personName}
              </span>
            ) : !activeFace ? (
              <span className="text-xs text-neutral-400 truncate leading-normal">
                匹配后显示姓名
              </span>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
};
