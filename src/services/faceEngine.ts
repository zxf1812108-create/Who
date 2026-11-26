import * as faceapi from '@vladmandic/face-api';
import type {
  CandidateMatch,
  NormalizedBox,
  PersonRecord,
  RecognitionResult,
  RecognizedFace,
} from '../types/face';

const MODEL_BASE_URL = '/models';

let loadPromise: Promise<void> | null = null;
let isLoaded = false;

export function isEngineReady(): boolean {
  return isLoaded;
}

export async function initializeFaceEngine(
  onProgress?: (text: string) => void
): Promise<void> {
  if (isLoaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      onProgress?.('正在加载人脸检测网络 (SSD MobileNet)...');
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_BASE_URL);

      onProgress?.('正在加载实时取景检测器 (TinyFace)...');
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_BASE_URL);

      onProgress?.('正在加载 68 点面部关键点模型...');
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_BASE_URL);

      onProgress?.('正在加载 128 维面部特征提取模型...');
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_BASE_URL);

      isLoaded = true;
      onProgress?.('本地人脸特征引擎已就绪');
    } catch (error) {
      loadPromise = null;
      throw error instanceof Error
        ? error
        : new Error('人脸识别模型加载失败，请刷新重试');
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
 * Converts 128D Euclidean distance to an intuitive similarity percentage (0 - 100).
 * FaceRecognitionNet typical same-person distance: 0.20 - 0.48; different-person: > 0.58.
 */
export function distanceToSimilarity(distance: number): number {
  if (distance <= 0.15) return 99;
  if (distance >= 0.95) return 5;
  // Smooth calibrated curve: 0.30 -> ~83%, 0.42 -> ~70%, 0.50 -> ~60%, 0.58 -> ~50%
  const normalized = Math.max(0, Math.min(1, 1 - Math.pow(distance / 0.88, 1.65)));
  return Math.round(normalized * 100);
}

/**
 * Converts a user-facing minimum similarity percentage (40 - 85) into
 * the corresponding internal 128D Euclidean distance cutoff.
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

  // Make crop square while keeping face centered
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
    dataUrl: canvas.toDataURL('image/jpeg', 0.86),
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
  maxDim = 1024
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
  detectionScore: number;
  box: NormalizedBox;
}

/**
 * Extracts the primary (largest / highest-confidence) face feature vector from an imported photo.
 */
export async function extractPrimaryFaceFromImage(
  img: HTMLImageElement
): Promise<ExtractedFaceFeature | null> {
  await initializeFaceEngine();
  const canvas = prepareCanvasFromImage(img, 960);

  let detections = await faceapi
    .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.42 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (detections.length === 0) {
    // Fallback to TinyFaceDetector with lower threshold for small or low-light faces
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

  // Pick the most prominent face (largest bounding box area)
  detections.sort(
    (a, b) =>
      b.detection.box.width * b.detection.box.height -
      a.detection.box.width * a.detection.box.height
  );

  const primary = detections[0];
  const { box, score } = primary.detection;
  const thumbnail = cropFaceThumbnail(canvas, box, 240);

  return {
    descriptor: Array.from(primary.descriptor),
    thumbnail,
    detectionScore: Number(score.toFixed(3)),
    box: {
      x: box.x / canvas.width,
      y: box.y / canvas.height,
      width: box.width / canvas.width,
      height: box.height / canvas.height,
    },
  };
}

function matchDescriptorAgainstLibrary(
  descriptor: Float32Array | number[],
  persons: PersonRecord[],
  threshold: number
): { matchedPerson: CandidateMatch | null; topCandidates: CandidateMatch[] } {
  if (persons.length === 0) {
    return { matchedPerson: null, topCandidates: [] };
  }

  const candidates: CandidateMatch[] = [];

  for (const person of persons) {
    let minDistance = Number.POSITIVE_INFINITY;
    let bestThumbnail = person.samples[0]?.thumbnail || '';

    for (const sample of person.samples) {
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

  candidates.sort((a, b) => a.distance - b.distance);
  const topCandidates = candidates.slice(0, 3);
  const best = topCandidates[0];
  const matchedPerson = best && best.distance <= threshold ? best : null;

  return { matchedPerson, topCandidates };
}

/**
 * Detects and identifies ALL faces in a captured photo or live camera frame.
 */
export async function recognizeFacesInSource(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  persons: PersonRecord[],
  threshold = 0.52,
  mode: 'accurate' | 'fast' = 'accurate'
): Promise<RecognitionResult> {
  await initializeFaceEngine();
  const start = performance.now();

  let inputElement: HTMLCanvasElement | HTMLVideoElement =
    source instanceof HTMLImageElement
      ? prepareCanvasFromImage(source, 1024)
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
      : new faceapi.SsdMobilenetv1Options({ minConfidence: 0.42 });

  const detections = await faceapi
    .detectAllFaces(inputElement, options)
    .withFaceLandmarks()
    .withFaceDescriptors();

  // Sort left-to-right for natural reading order in group shots
  detections.sort((a, b) => a.detection.box.x - b.detection.box.x);

  const faces: RecognizedFace[] = detections.map((det, idx) => {
    const { box, score } = det.detection;
    const { matchedPerson, topCandidates } = matchDescriptorAgainstLibrary(
      det.descriptor,
      persons,
      threshold
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
