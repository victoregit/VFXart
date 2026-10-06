import type { PixelProcessingPreset, PixelProcessingSettings } from './types';
export const PROCESSOR_VERSION = '1';
export const DEFAULT_PIXEL_PROCESSING_SETTINGS: PixelProcessingSettings = {
  minimumAlpha: 1, alphaThreshold: 0, alphaLevels: 0, brightness: 0, saturation: 0, hue: 0, contrast: 0,
  gradientStops: [], colorCount: 0, customPalette: [], dithering: 'none', ditherStrength: 0,
  minIslandSize: 0, maxHoleSize: 0, outline: 'none', outlineColor: { r: 0, g: 0, b: 0 }
};
export const BUILT_IN_PROCESSING_PRESETS: readonly PixelProcessingPreset[] = Object.freeze([
  { id: 'clean-pixel', name: 'Clean Pixel', settings: { alphaThreshold: 8, minIslandSize: 2 } },
  { id: 'limited-16', name: 'Limited 16', settings: { alphaThreshold: 8, colorCount: 16 } },
  { id: 'limited-8', name: 'Limited 8', settings: { alphaThreshold: 12, colorCount: 8, minIslandSize: 2 } },
  { id: 'high-contrast-vfx', name: 'High Contrast VFX', settings: { alphaThreshold: 10, contrast: 22, saturation: 12, colorCount: 16 } }
]);
export const resolveSettings = (partial: Partial<PixelProcessingSettings>): PixelProcessingSettings => ({ ...DEFAULT_PIXEL_PROCESSING_SETTINGS, ...partial, gradientStops: [...(partial.gradientStops ?? DEFAULT_PIXEL_PROCESSING_SETTINGS.gradientStops)].sort((a,b)=>a.position-b.position), customPalette: [...(partial.customPalette ?? DEFAULT_PIXEL_PROCESSING_SETTINGS.customPalette)] });
