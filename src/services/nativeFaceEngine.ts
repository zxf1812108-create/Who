import { Capacitor, registerPlugin } from '@capacitor/core';
import type { NormalizedBox } from '../types/face';

export interface NativeFaceDetectionItem {
  descriptor: number[];
  box: NormalizedBox;
  score: number;
  thumbnail: string;
}

export interface NativeAnalyzeResponse {
  faces: NativeFaceDetectionItem[];
  imageWidth: number;
  imageHeight: number;
  elapsedMs: number;
  engine: string;
}

interface NativeFaceEnginePlugin {
  initialize(): Promise<{
    ready: boolean;
    engine: string;
    descriptorDim: number;
  }>;
  analyzeImage(options: {
    imageDataUrl: string;
    primaryOnly?: boolean;
  }): Promise<NativeAnalyzeResponse>;
}

const NativeFaceEngine = registerPlugin<NativeFaceEnginePlugin>('NativeFaceEngine');

export function isNativeInsightFacePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export async function initializeNativeInsightFace(): Promise<{
  ready: boolean;
  engine: string;
  descriptorDim: number;
}> {
  return NativeFaceEngine.initialize();
}

export async function analyzeImageWithNativeInsightFace(
  imageDataUrl: string,
  primaryOnly = false
): Promise<NativeAnalyzeResponse> {
  return NativeFaceEngine.analyzeImage({ imageDataUrl, primaryOnly });
}
