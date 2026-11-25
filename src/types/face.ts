export interface FaceSample {
  id: string;
  /** 128-dimensional facial feature embedding extracted by FaceRecognitionNet */
  descriptor: number[];
  /** Cropped face thumbnail as compressed JPEG data URL */
  thumbnail: string;
  /** Original imported filename */
  sourceFilename: string;
  /** Face detection confidence score (0 - 1) */
  detectionScore: number;
  createdAt: number;
}

export interface PersonRecord {
  id: string;
  name: string;
  note: string;
  samples: FaceSample[];
  createdAt: number;
  updatedAt: number;
}

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CandidateMatch {
  personId: string;
  personName: string;
  personNote: string;
  referenceThumbnail: string;
  distance: number;
  similarity: number;
}

export interface RecognizedFace {
  id: string;
  /** Normalized coordinates (0..1) relative to source image/video natural dimensions */
  box: NormalizedBox;
  /** Cropped face image from the captured frame */
  cropThumbnail: string;
  /** 128D descriptor for registering unknown faces directly */
  descriptor: number[];
  detectionScore: number;
  /** Matched person if best distance <= threshold, otherwise null */
  matchedPerson: CandidateMatch | null;
  /** Top 3 closest candidates regardless of threshold */
  topCandidates: CandidateMatch[];
}

export interface RecognitionResult {
  faces: RecognizedFace[];
  /** Real measured processing latency in milliseconds */
  elapsedMs: number;
  imageWidth: number;
  imageHeight: number;
}

export interface RecognitionHistoryEntry {
  id: string;
  timestamp: number;
  /** Compressed snapshot preview */
  snapshotDataUrl: string;
  sourceType: 'camera' | 'album' | 'sample';
  elapsedMs: number;
  threshold: number;
  matches: Array<{
    name: string;
    matched: boolean;
    similarity: number;
    distance: number;
    personId: string | null;
  }>;
}

export interface ImportQueueItem {
  id: string;
  filename: string;
  parsedName: string;
  status: 'pending' | 'processing' | 'success' | 'no-face' | 'error';
  message?: string;
  thumbnail?: string;
  detectionScore?: number;
  personId?: string;
  mergedIntoExisting?: boolean;
}

export type AppTab = 'camera' | 'import' | 'library' | 'history';

export interface EngineState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  progressText: string;
  errorMessage?: string;
}
