import type { PixelProcessingPreset, PixelProcessingSettings } from './pixel-processing/types';
import type { UpgradeProvenance } from './upgrade';
export type Tool = 'import' | 'cutter' | 'process' | 'editor' | 'animator' | 'export';
export type SliceMode = 'grid' | 'manual' | 'auto';
export type AnchorPreset = 'center' | 'top-center' | 'bottom-center' | 'custom';
export type ExportLayout = 'horizontal' | 'vertical' | 'grid';

export interface Asset { id: string; name: string; originalPath: string; width: number; height: number; mime: string; importedAt: string; }
export interface SliceRegion { id: string; assetId: string; x: number; y: number; width: number; height: number; order: number; mode: SliceMode; }
export interface FrameRevision { id: string; source: string; createdAt: string; inputSource?: string; processorVersion?: string; settings?: Partial<PixelProcessingSettings>; presetId?: string; upgrade?: UpgradeProvenance; }
export interface SpriteFrame {
  id: string; source: string; assetId?: string; sliceId?: string; width: number; height: number;
  offsetX: number; offsetY: number; anchorX: number; anchorY: number; duration?: number; derivedPath?: string;
  originalSource: string; revisions: FrameRevision[]; activeRevisionId: string;
}
export interface Animation { frameIds: string[]; fps: number; loop: boolean; reverse: boolean; pingPong: boolean; }
export interface Palette { id: string; name: string; colors: string[]; }
export interface ExportSettings { prefix: string; layout: ExportLayout; columns: number; padding: number; includeMetadata: boolean; }
export interface Project {
  schemaVersion: 2; id: string; name: string; createdAt: string; updatedAt: string;
  assets: Asset[]; slices: SliceRegion[]; frames: SpriteFrame[]; animation: Animation;
  palettes: Palette[]; processingPresets: PixelProcessingPreset[]; exportSettings: ExportSettings;
}
export interface HistoryCommand { label: string; bytes: number; undo: () => void; redo: () => void; }
export interface GenerationRequest { prompt: string; width: number; height: number; }
export interface GenerationResult { images: string[]; }
export interface ImageGenerationProvider { generate(input: GenerationRequest): Promise<GenerationResult>; }
export interface SliceSettings { alphaThreshold: number; minimumRegion: number; padding: number; groupingDistance: number; }
export interface PixelPatch { index: number; before: Uint8ClampedArray; after: Uint8ClampedArray; }
