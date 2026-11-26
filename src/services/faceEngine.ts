import * as faceapi from '@vladmandic/face-api';
import type {
  CandidateMatch,
  NormalizedBox,
  PersonRecord,
  RecognitionResult,
  RecognizedFace,
} from '../types/face';
import {
  analyzeImageWithNativeInsightFace,
  initializeNativeInsightFace,
  isNativeInsightFacePlatform,
} from './nativeFaceEngine';

const MODEL_BASE_URL = '/models';

let loadPromise: Promise<void> | null = null;
let isLoaded = false;
let activeBackend: 'insightface-r50' | 'face-api-web' = 'face-api-web';

export function isEngineReady(): boolean {
  return isLoaded;
}

export function getActiveEngineBackend(): 'insightface-r50' | 'face-api-web' {
  return activeBackend;
}

export function getActiveDescriptorDim(): 512 | 128 {
  return activeBackend === 'insightface-r50' ? 512 : 128;
}

export async function initializeFaceEngine(
  onProgress?: (text: string) => void
): Promise<void> {
  if (isLoaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      if (isNativeInsightFacePlatform()) {
        onProgress?.('正在初始化旗舰高精度识别引擎 (SCRFD + ArcFace R50)...');
        await initializeNativeInsightFace();
        activeBackend = 'insightface-r50';
        isLoaded = true;
        onProgress?.('旗舰本地人脸引擎已就绪');
        return;
      }

      onProgress?.('正在加载人脸检测网络 (SSD MobileNet)...');
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_BASE_URL);

      onProgress?.('正在加载轻量检测器 (TinyFace)...');
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_BASE_URL);

      onProgress?.('正在加载面部关键点模型...');
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_BASE_URL);

      onProgress?.('正在加载面部特征提取模型...');
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_BASE_URL);

      activeBackend = 'face-api-web';
      isLoaded = true;
      onProgress?.('本地人脸特征引擎已就绪');
    } catch (error) {
      loadPromise = null;
      throw error instanceof Error
        ? error
        : new Error('人脸识别模型加载失败，请重启应用重试');
    }
  })();

  return loadPromise;
}

/**
 * Extracts a clean person name from an imported photo filename.
 * Examples:
 * - "陈默.jpg" -> "陈默"
 * - "folder/林知夏_02.png" -> "林知夏" (when mergeIndexedSuffixes is true)
 * - "周明远 (1).jpeg" -> "周明远" (when mergeIndexedSuffixes is true)
 */
export function parsePersonNameFromFilename(
  filename: string,
  mergeIndexedSuffixes = true
): string {
  const baseWithExt = filename.split(/[\\/]/).pop() || filename;
  let stem = baseWithExt.replace(/\.[^/.]+$/, '').trim();

  if (mergeIndexedSuffixes) {
    stem = stem
      .replace(/[\s_-]*\(\d+\)$/u, '')
      .replace(/[\s_-]*（\d+）$/u, '')
      .replace(/[_-]\d+$/u, '')
      .trim();
  }

  return stem || '未命名人物';
}

/**
 * Computes cosine similarity between two equal-length embeddings.
 */
export function cosineSimilarity(
  a: Float32Array | number[],
  b: Float32Array | number[]
): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom <= 1e-8) return -1;
  return dot / denom;
}

function computeNormalizedCentroid(vectors: number[][]): number[] {
  const dim = vectors[0]?.length ?? 0;
  const mean = new Array<number>(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      mean[i] += vec[i];
    }
  }
  let normSq = 0;
  for (let i = 0; i < dim; i++) {
    normSq += mean[i] * mean[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm > 1e-8) {
    for (let i = 0; i < dim; i++) {
      mean[i] /= norm;
    }
  }
  return mean;
}

/**
 * Calibrated cosine-to-percentage mapping for InsightFace ArcFace ResNet50 (w600k_r50).
 * Different East Asian faces typically score 0.00 - 0.25; same person scores 0.38 - 0.78.
 * Maps smoothly so:
 *   cos 0.22 -> 40%
 *   cos 0.30 -> 50% (宽松)
 *   cos 0.38 -> 60% (标准)
 *   cos 0.46 -> 70% (严格)
 *   cos 0.58 -> 85%
 *   cos >= 0.69 -> 99%
 */
export function cosineToSimilarity(cos: number): number {
  if (cos >= 0.69) return 99;
  if (cos <= 0.02) return 5;
  if (cos < 0.22) {
    return Math.max(5, Math.round(5 + ((cos - 0.02) / 0.2) * 35));
  }
  return Math.min(99, Math.round(40 + (cos - 0.22) * 125));
}

/**
 * Converts 128D Euclidean distance (web fallback) to an intuitive similarity percentage (0 - 100).
 */
export function distanceToSimilarity(distance: number): number {
  if (distance <= 0.15) return 99;
  if (distance >= 0.95) return 5;
  const normalized = Math.max(0, Math.min(1, 1 - Math.pow(distance / 0.88, 1.65)));
  return Math.round(normalized * 100);
}

/**
 * Converts a user-facing minimum similarity percentage (40 - 85) into
 * the corresponding 128D Euclidean distance cutoff (web fallback).
 */
export function similarityToDistance(similarityPercent: number): number {
  const clamped = Math.max(10, Math.min(99, similarityPercent));
  const dist = 0.88 * Math.pow(1 - clamped / 100, 1 / 1.65);
  return Number(dist.toFixed(4));
}

/**
 * Crops a clean portrait thumbnail centered on the detected face box with headroom.
 */
export function cropFaceThumbnail(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number },
  outputSize = 240
): string {
  const sourceWidth =
    source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const sourceHeight =
    source instanceof HTMLVideoElement ? source.videoHeight : source.height;

  const padX = box.width * 0.32;
  const padTop = box.height * 0.42;
  const padBottom = box.height * 0.28;

  const rawX = Math.max(0, box.x - padX);
  const rawY = Math.max(0, box.y - padTop);
  const rawW = Math.min(sourceWidth - rawX, box.width + padX * 2);
  const rawH = Math.min(sourceHeight - rawY, box.height + padTop + padBottom);

  const side = Math.min(Math.max(rawW, rawH), Math.min(sourceWidth, sourceHeight));
  const centerX = rawX + rawW / 2;
  const centerY = rawY + rawH / 2;
  const cropX = Math.max(0, Math.min(sourceWidth - side, centerX - side / 2));
  const cropY = Math.max(0, Math.min(sourceHeight - side, centerY - side / 2));

  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.drawImage(source, cropX, cropY, side, side, 0, 0, outputSize, outputSize);
  return canvas.toDataURL('image/jpeg', 0.84);
}

export function createSnapshotDataUrl(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  maxWidth = 960
): { dataUrl: string; width: number; height: number } {
  const naturalW =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth || source.width
        : source.width;
  const naturalH =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight || source.height
        : source.height;

  const scale = naturalW > maxWidth ? maxWidth / naturalW : 1;
  const width = Math.max(1, Math.round(naturalW * scale));
  const height = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(source, 0, 0, width, height);
  }
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.88),
    width,
    height,
  };
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('无法读取该图片文件'));
    img.src = src;
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取本地文件失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * Resize huge mobile camera photos before neural extraction so batch import stays fast & memory-safe.
 */
export function prepareCanvasFromImage(
  img: HTMLImageElement,
  maxDim = 1280
): HTMLCanvasElement {
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
  const width = Math.max(1, Math.round(naturalW * scale));
  const height = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0, width, height);
  }
  return canvas;
}

export interface ExtractedFaceFeature {
  descriptor: number[];
  thumbnail: string;
  originalPhoto: string;
  detectionScore: number;
  box: NormalizedBox;
}

/**
 * Extracts the primary (largest) face feature vector from an imported photo.
 * Uses Android native InsightFace SCRFD + ArcFace R50 (512D + Flip-TTA) on APK,
 * and falls back to face-api (128D) in desktop/web preview.
 */
export async function extractPrimaryFaceFromImage(
  img: HTMLImageElement
): Promise<ExtractedFaceFeature | null> {
  await initializeFaceEngine();

  if (activeBackend === 'insightface-r50') {
    const canvas = prepareCanvasFromImage(img, 1280);
    const inputDataUrl = canvas.toDataURL('image/jpeg', 0.93);
    const originalPhoto = createSnapshotDataUrl(canvas, 820).dataUrl;
    const response = await analyzeImageWithNativeInsightFace(inputDataUrl, true);
    const primary = response.faces[0];
    if (!primary || !primary.descriptor || primary.descriptor.length !== 512) {
      return null;
    }
    return {
      descriptor: primary.descriptor,
      thumbnail: primary.thumbnail,
      originalPhoto,
      detectionScore: Number(primary.score.toFixed(3)),
      box: primary.box,
    };
  }

  const canvas = prepareCanvasFromImage(img, 960);

  let detections = await faceapi
    .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.42 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (detections.length === 0) {
    detections = await faceapi
      .detectAllFaces(
        canvas,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 })
      )
      .withFaceLandmarks()
      .withFaceDescriptors();
  }

  if (detections.length === 0) {
    return null;
  }

  detections.sort(
    (a, b) =>
      b.detection.box.width * b.detection.box.height -
      a.detection.box.width * a.detection.box.height
  );

  const primary = detections[0];
  const { box, score } = primary.detection;
  const thumbnail = cropFaceThumbnail(canvas, box, 240);
  const originalPhoto = createSnapshotDataUrl(canvas, 760).dataUrl;

  return {
    descriptor: Array.from(primary.descriptor),
    thumbnail,
    originalPhoto,
    detectionScore: Number(score.toFixed(3)),
    box: {
      x: box.x / canvas.width,
      y: box.y / canvas.height,
      width: box.width / canvas.width,
      height: box.height / canvas.height,
    },
  };
}

/**
 * Matches a face embedding against the person library.
 * - For 512D InsightFace ArcFace embeddings: uses Cosine Similarity + Multi-Sample Centroid Fusion + Top1/Top2 margin protection.
 * - For 128D web fallback embeddings: uses Euclidean Distance.
 */
export function matchDescriptorAgainstLibrary(
  descriptor: Float32Array | number[],
  persons: PersonRecord[],
  minSimilarity: number
): { matchedPerson: CandidateMatch | null; topCandidates: CandidateMatch[] } {
  if (persons.length === 0 || descriptor.length === 0) {
    return { matchedPerson: null, topCandidates: [] };
  }

  const dim = descriptor.length;
  const isArcFace512 = dim === 512;
  const candidates: CandidateMatch[] = [];

  for (const person of persons) {
    const compatibleSamples = person.samples.filter(
      (s) => Array.isArray(s.descriptor) && s.descriptor.length === dim
    );
    if (compatibleSamples.length === 0) continue;

    if (isArcFace512) {
      let bestCos = -1;
      let bestThumbnail = compatibleSamples[0].thumbnail || '';

      for (const sample of compatibleSamples) {
        const cos = cosineSimilarity(descriptor, sample.descriptor);
        if (cos > bestCos) {
          bestCos = cos;
          bestThumbnail = sample.thumbnail;
        }
      }

      // Multi-sample centroid fusion boosts recall on intermediate angles/lighting
      let effectiveCos = bestCos;
      if (compatibleSamples.length >= 2) {
        const centroid = computeNormalizedCentroid(
          compatibleSamples.map((s) => s.descriptor)
        );
        const centroidCos = cosineSimilarity(descriptor, centroid);
        if (centroidCos > effectiveCos) {
          effectiveCos = centroidCos;
        }
      }

      candidates.push({
        personId: person.id,
        personName: person.name,
        personNote: person.note,
        referenceThumbnail: bestThumbnail,
        distance: Number((1 - effectiveCos).toFixed(4)),
        similarity: cosineToSimilarity(effectiveCos),
      });
    } else {
      let minDistance = Number.POSITIVE_INFINITY;
      let bestThumbnail = compatibleSamples[0].thumbnail || '';

      for (const sample of compatibleSamples) {
        const dist = faceapi.euclideanDistance(descriptor, sample.descriptor);
        if (dist < minDistance) {
          minDistance = dist;
          bestThumbnail = sample.thumbnail;
        }
      }

      if (Number.isFinite(minDistance)) {
        candidates.push({
          personId: person.id,
          personName: person.name,
          personNote: person.note,
          referenceThumbnail: bestThumbnail,
          distance: Number(minDistance.toFixed(4)),
          similarity: distanceToSimilarity(minDistance),
        });
      }
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  const topCandidates = candidates.slice(0, 3);
  const best = topCandidates[0];
  const second = topCandidates[1];

  let matchedPerson: CandidateMatch | null = null;
  if (best && best.similarity >= minSimilarity) {
    // Top1 vs Top2 margin guard: prevent false labeling when borderline score is nearly tied
    if (isArcFace512 && second) {
      const cosGap = second.distance - best.distance;
      const isBorderline = best.similarity < minSimilarity + 7;
      if (isBorderline && cosGap < 0.035) {
        matchedPerson = null;
      } else {
        matchedPerson = best;
      }
    } else {
      matchedPerson = best;
    }
  }

  return { matchedPerson, topCandidates };
}

/**
 * Detects and identifies ALL faces in a captured photo.
 */
export async function recognizeFacesInSource(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  persons: PersonRecord[],
  minSimilarity = 60,
  mode: 'accurate' | 'fast' = 'accurate'
): Promise<RecognitionResult> {
  await initializeFaceEngine();
  const start = performance.now();

  if (activeBackend === 'insightface-r50') {
    const canvas =
      source instanceof HTMLImageElement
        ? prepareCanvasFromImage(source, 1600)
        : source instanceof HTMLCanvasElement
          ? source
          : (() => {
              const c = document.createElement('canvas');
              c.width = source.videoWidth;
              c.height = source.videoHeight;
              c.getContext('2d')?.drawImage(source, 0, 0);
              return c;
            })();

    if (canvas.width === 0 || canvas.height === 0) {
      return {
        faces: [],
        elapsedMs: Math.round(performance.now() - start),
        imageWidth: 0,
        imageHeight: 0,
      };
    }

    const inputDataUrl = canvas.toDataURL('image/jpeg', 0.93);
    const nativeRes = await analyzeImageWithNativeInsightFace(inputDataUrl, false);

    // Sort left-to-right for natural reading order in group shots
    const sortedNative = [...nativeRes.faces].sort((a, b) => a.box.x - b.box.x);
    const faces: RecognizedFace[] = sortedNative.map((item, idx) => {
      const { matchedPerson, topCandidates } = matchDescriptorAgainstLibrary(
        item.descriptor,
        persons,
        minSimilarity
      );
      return {
        id: `face-${Date.now()}-${idx}`,
        box: item.box,
        cropThumbnail: item.thumbnail,
        descriptor: item.descriptor,
        detectionScore: Number(item.score.toFixed(3)),
        matchedPerson,
        topCandidates,
      };
    });

    return {
      faces,
      elapsedMs: Math.max(1, nativeRes.elapsedMs || Math.round(performance.now() - start)),
      imageWidth: nativeRes.imageWidth || canvas.width,
      imageHeight: nativeRes.imageHeight || canvas.height,
    };
  }

  const inputElement: HTMLCanvasElement | HTMLVideoElement =
    source instanceof HTMLImageElement
      ? prepareCanvasFromImage(source, 1440)
      : source;

  const sourceWidth =
    inputElement instanceof HTMLVideoElement
      ? inputElement.videoWidth
      : inputElement.width;
  const sourceHeight =
    inputElement instanceof HTMLVideoElement
      ? inputElement.videoHeight
      : inputElement.height;

  if (sourceWidth === 0 || sourceHeight === 0) {
    return {
      faces: [],
      elapsedMs: Math.round(performance.now() - start),
      imageWidth: 0,
      imageHeight: 0,
    };
  }

  const options =
    mode === 'fast'
      ? new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.42 })
      : new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 });

  let detections = await faceapi
    .detectAllFaces(inputElement, options)
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (detections.length === 0 && mode === 'accurate') {
    detections = await faceapi
      .detectAllFaces(
        inputElement,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.3 })
      )
      .withFaceLandmarks()
      .withFaceDescriptors();
  }

  detections.sort((a, b) => a.detection.box.x - b.detection.box.x);

  const faces: RecognizedFace[] = detections.map((det, idx) => {
    const { box, score } = det.detection;
    const { matchedPerson, topCandidates } = matchDescriptorAgainstLibrary(
      det.descriptor,
      persons,
      minSimilarity
    );

    const cropThumbnail =
      mode === 'accurate' ? cropFaceThumbnail(inputElement, box, 200) : '';

    return {
      id: `face-${Date.now()}-${idx}`,
      box: {
        x: Math.max(0, box.x / sourceWidth),
        y: Math.max(0, box.y / sourceHeight),
        width: Math.min(1, box.width / sourceWidth),
        height: Math.min(1, box.height / sourceHeight),
      },
      cropThumbnail,
      descriptor: Array.from(det.descriptor),
      detectionScore: Number(score.toFixed(3)),
      matchedPerson,
      topCandidates,
    };
  });

  return {
    faces,
    elapsedMs: Math.max(1, Math.round(performance.now() - start)),
    imageWidth: sourceWidth,
    imageHeight: sourceHeight,
  };
}
