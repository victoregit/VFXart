export interface RawFrame { width: number; height: number; data: Uint8ClampedArray; }
export type ProcessedFrame = RawFrame;
export interface Rgb { r: number; g: number; b: number; }
export interface GradientStop extends Rgb { position: number; }
export type DitherMode = 'none' | 'bayer2' | 'bayer4';
export type OutlineMode = 'none' | '4-neighbor' | '8-neighbor';
export interface PixelProcessingSettings {
  targetWidth?: number; targetHeight?: number;
  minimumAlpha: number; alphaThreshold: number; alphaLevels: number;
  brightness: number; saturation: number; hue: number; contrast: number;
  gradientStops: GradientStop[]; colorCount: number; customPalette: Rgb[];
  dithering: DitherMode; ditherStrength: number;
  minIslandSize: number; maxHoleSize: number;
  outline: OutlineMode; outlineColor: Rgb;
}
export interface PixelProcessingPreset { id: string; name: string; settings: Partial<PixelProcessingSettings>; }
export interface PaletteExtractionOptions { colorCount: number; minimumAlpha: number; }
export interface PixelAutoEnhanceMetrics {
  visiblePixels: number;
  semiTransparentPixels: number;
  semiTransparentRatio: number;
  uniqueVisibleColors: number;
  isolatedPixelComponents: number;
  luminanceRange: number;
}
export interface PixelAutoEnhanceSuggestion {
  version: string;
  settings: PixelProcessingSettings;
  metrics: PixelAutoEnhanceMetrics;
  reasons: string[];
}
