import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { metadata, sheetDimensions } from '../core/export';
import { processFrame, resolveSettings } from '../core/pixel-processing';
import type { PixelProcessingSettings, RawFrame } from '../core/pixel-processing';
import { analyzeUpgrade, previewUpgrade } from '../core/upgrade';
import type { UpgradeAnalysisOptions, UpgradeProfile, UpgradeProvenance } from '../core/upgrade';
import { validateProject } from '../core/project';
import type { FrameRevision, Project, SpriteFrame } from '../core/types';

export interface ImportedSpriteInput {
  /** Path relative to a source folder already authorized by the desktop app. */
  name: string;
  original: Uint8Array;
  png: Uint8Array;
}

export type ProjectOperationErrorCode = 'NOT_FOUND' | 'INVALID_ARGUMENT' | 'COLLISION' | 'WRITE_FAILED';
export class ProjectOperationError extends Error { constructor(public readonly code: ProjectOperationErrorCode, message: string) { super(message); } }

const relativePath = (value: string) => {
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) throw new ProjectOperationError('INVALID_ARGUMENT', 'Invalid project-relative path');
  return normalized;
};
const resolveInside = (root: string, relative: string) => {
  const resolvedRoot = path.resolve(root);
  const result = path.resolve(resolvedRoot, relativePath(relative));
  if (!result.startsWith(`${resolvedRoot}${path.sep}`)) throw new ProjectOperationError('INVALID_ARGUMENT', 'Path escapes the authorized project');
  return result;
};
const pixelCount = (frame: RawFrame) => frame.width * frame.height;
const cloneFrame = (frame: RawFrame): RawFrame => ({ width: frame.width, height: frame.height, data: new Uint8ClampedArray(frame.data) });

async function atomicWrite(file: string, data: Uint8Array | string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temporary, data);
  try { await fs.rename(temporary, file); }
  catch (error) { await fs.unlink(temporary).catch(() => undefined); throw error; }
}
async function loadProject(root: string): Promise<Project> {
  const file = path.join(path.resolve(root), 'project.json');
  try { return validateProject(JSON.parse(await fs.readFile(file, 'utf8'))); }
  catch (error) { throw new ProjectOperationError('NOT_FOUND', `Could not open the authorized project: ${(error as Error).message}`); }
}
async function persistProject(root: string, project: Project) {
  project.updatedAt = new Date().toISOString();
  const text = JSON.stringify(project, null, 2);
  JSON.parse(text);
  await atomicWrite(path.join(path.resolve(root), 'project.json'), text);
  return project;
}
async function decodePng(root: string, source: string): Promise<RawFrame> {
  try {
    const decoded = PNG.sync.read(await fs.readFile(resolveInside(root, source)));
    return { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) };
  } catch (error) { throw new ProjectOperationError('NOT_FOUND', `Could not read frame PNG: ${(error as Error).message}`); }
}
function encodePng(frame: RawFrame) {
  const png = new PNG({ width: frame.width, height: frame.height });
  png.data = Buffer.from(frame.data);
  return PNG.sync.write(png);
}
function frameFor(project: Project, frameId: string) {
  const frame = project.frames.find(candidate => candidate.id === frameId);
  if (!frame) throw new ProjectOperationError('NOT_FOUND', `Frame '${frameId}' was not found in the authorized project`);
  return frame;
}
function sourceRevision(frame: SpriteFrame) { return frame.revisions.find(revision => revision.id === frame.activeRevisionId); }
function revisionPath(frameId: string) { return `frames/${frameId}/revision-${randomUUID()}.png`; }
async function ensureNotExists(root: string, relative: string) {
  const exists = await fs.access(resolveInside(root, relative)).then(() => true).catch(() => false);
  if (exists) throw new ProjectOperationError('COLLISION', `Export already exists: ${relative}`);
}
async function nextAvailableRelative(root: string, relative: string) {
  const normalized = relativePath(relative), extension = path.posix.extname(normalized), stem = normalized.slice(0, normalized.length - extension.length);
  let candidate = normalized, index = 2;
  while (await fs.access(resolveInside(root, candidate)).then(() => true).catch(() => false)) candidate = `${stem}_${index++}${extension}`;
  return candidate;
}
function upgradeProvenance(frame: SpriteFrame, analysis: ReturnType<typeof analyzeUpgrade>, profile: UpgradeProfile, strength: number): UpgradeProvenance {
  return { upgradeVersion: '1', profile, strength, settings: analysis.recommendedSettings.processor, target: { width: analysis.recommendedWidth, height: analysis.recommendedHeight }, sharedPalette: analysis.sharedPalette, sourceRevisionId: frame.activeRevisionId, globalBounds: analysis.globalBounds, framing: analysis.recommendedSettings.framing };
}
function mergeSettings(settings: Partial<PixelProcessingSettings>) { return resolveSettings(settings); }

export interface FrameInfo { id: string; width: number; height: number; anchorX: number; anchorY: number; offsetX: number; offsetY: number; duration?: number; activeRevisionId: string; revisionCount: number; }
export interface ProjectStatus { id: string; name: string; schemaVersion: number; frameCount: number; fps: number; loop: boolean; frameIds: string[]; }

export class ProjectOperations {
  async status(root: string): Promise<ProjectStatus> {
    const project = await loadProject(root);
    return { id: project.id, name: project.name, schemaVersion: project.schemaVersion, frameCount: project.frames.length, fps: project.animation.fps, loop: project.animation.loop, frameIds: project.animation.frameIds };
  }

  async inspectFrames(root: string, ids?: string[]): Promise<FrameInfo[]> {
    const project = await loadProject(root);
    const selection = ids?.length ? ids.map(id => frameFor(project, id)) : project.animation.frameIds.map(id => frameFor(project, id));
    return selection.map(frame => ({ id: frame.id, width: frame.width, height: frame.height, anchorX: frame.anchorX, anchorY: frame.anchorY, offsetX: frame.offsetX, offsetY: frame.offsetY, duration: frame.duration, activeRevisionId: frame.activeRevisionId, revisionCount: frame.revisions.length }));
  }

  async rawFrame(root: string, frameId: string) { const project = await loadProject(root); const frame = frameFor(project, frameId); return { frame, raw: await decodePng(root, frame.source) }; }
  async animationInputs(root: string) {
    const project = await loadProject(root);
    const frames = await Promise.all(project.animation.frameIds.map(async id => {
      const frame = frameFor(project, id); const raw = await decodePng(root, frame.source);
      return { id: frame.id, frame: raw, offsetX: frame.offsetX, offsetY: frame.offsetY, anchorX: frame.anchorX, anchorY: frame.anchorY, source: frame.source };
    }));
    return { project, frames };
  }

  async analyze(root: string, options: UpgradeAnalysisOptions = {}) { const { frames } = await this.animationInputs(root); return analyzeUpgrade(frames, options); }
  async previewProcess(root: string, frameId: string, settings: Partial<PixelProcessingSettings>) {
    const { raw } = await this.rawFrame(root, frameId); const resolved = mergeSettings(settings); return { frame: processFrame(cloneFrame(raw), resolved), settings: resolved };
  }
  async previewUpgrade(root: string, options: UpgradeAnalysisOptions = {}) { const { frames } = await this.animationInputs(root); return previewUpgrade(frames, options); }

  /**
   * Commits copied originals and initial PNG frame revisions only after every
   * source has been written. Source locations never enter project.json.
   */
  async importSprites(root: string, inputs: ImportedSpriteInput[]): Promise<{ project: Project; frameIds: string[] }> {
    if (!inputs.length) throw new ProjectOperationError('INVALID_ARGUMENT', 'No supported sprite images were found in the authorized source folder');
    const project = await loadProject(root), next = structuredClone(project), staged: Array<{ original:string; frame:string; asset:Project['assets'][number]; slice:Project['slices'][number]; sprite:SpriteFrame }> = [], reservedOriginals = new Set<string>();
    for (const input of inputs) {
      const sourceName = relativePath(input.name);
      const decoded = PNG.sync.read(Buffer.from(input.png));
      if (decoded.width < 1 || decoded.height < 1) throw new ProjectOperationError('INVALID_ARGUMENT', `Invalid sprite dimensions: ${sourceName}`);
      let original = await nextAvailableRelative(root, `assets/originals/${sourceName}`);
      while (reservedOriginals.has(original)) {
        const extension = path.posix.extname(original), stem = original.slice(0, original.length - extension.length), match = stem.match(/_(\d+)$/), nextIndex = match ? Number(match[1]) + 1 : 2;
        original = `${match ? stem.slice(0, -match[0].length) : stem}_${nextIndex}${extension}`;
      }
      reservedOriginals.add(original);
      const id = randomUUID(), frame = `frames/${id}/image.png`, revisionId = `${id}:initial`, importedAt = new Date().toISOString();
      const asset = { id: randomUUID(), name: sourceName, originalPath: original, width: decoded.width, height: decoded.height, mime: sourceName.toLowerCase().endsWith('.webp') ? 'image/webp' : sourceName.match(/jpe?g$/i) ? 'image/jpeg' : 'image/png', importedAt };
      const slice = { id: randomUUID(), assetId: asset.id, x: 0, y: 0, width: decoded.width, height: decoded.height, order: next.slices.length + staged.length, mode: 'manual' as const };
      const sprite: SpriteFrame = { id, source: frame, originalSource: frame, revisions: [{ id: revisionId, source: frame, createdAt: importedAt }], activeRevisionId: revisionId, assetId: asset.id, sliceId: slice.id, width: decoded.width, height: decoded.height, offsetX: 0, offsetY: 0, anchorX: Math.floor(decoded.width / 2), anchorY: Math.floor(decoded.height / 2), derivedPath: frame };
      staged.push({ original, frame, asset, slice, sprite });
    }
    try {
      for (let index = 0; index < staged.length; index++) {
        await atomicWrite(resolveInside(root, staged[index].original), inputs[index].original);
        await atomicWrite(resolveInside(root, staged[index].frame), inputs[index].png);
      }
    } catch (error) {
      throw new ProjectOperationError('WRITE_FAILED', `Could not copy imported sprite files: ${(error as Error).message}`);
    }
    for (const item of staged) { next.assets.push(item.asset); next.slices.push(item.slice); next.frames.push(item.sprite); next.animation.frameIds.push(item.sprite.id); }
    return { project: await persistProject(root, next), frameIds: staged.map(item => item.sprite.id) };
  }

  async applyProcess(root: string, frameIds: string[], input: Partial<PixelProcessingSettings>): Promise<Project> {
    if (!frameIds.length) throw new ProjectOperationError('INVALID_ARGUMENT', 'At least one frame is required');
    const project = await loadProject(root); const settings = mergeSettings(input);
    const staged = await Promise.all(frameIds.map(async id => {
      const frame = frameFor(project, id), source = frame.source, raw = await decodePng(root, source), output = processFrame(raw, settings), relative = revisionPath(frame.id);
      await atomicWrite(resolveInside(root, relative), encodePng(output));
      const revision: FrameRevision = { id: randomUUID(), source: relative, createdAt: new Date().toISOString(), inputSource: source, processorVersion: '2', settings };
      return { frame, output, relative, revision };
    }));
    const next = structuredClone(project);
    for (const item of staged) {
      const frame = frameFor(next, item.frame.id); frame.source = item.relative; frame.derivedPath = item.relative; frame.width = item.output.width; frame.height = item.output.height; frame.revisions.push(item.revision); frame.activeRevisionId = item.revision.id;
    }
    return persistProject(root, next);
  }

  async applyUpgrade(root: string, options: UpgradeAnalysisOptions = {}): Promise<Project> {
    const { project, frames } = await this.animationInputs(root); if (!frames.length) throw new ProjectOperationError('INVALID_ARGUMENT', 'Create frames in Cutter before running Upgrade');
    const profile = options.profile ?? 'pixel-art', strength = options.strength ?? 70, preview = previewUpgrade(frames, { ...options, profile, strength });
    const staged = await Promise.all(preview.frames.map(async output => {
      const original = frameFor(project, output.id), relative = revisionPath(output.id); await atomicWrite(resolveInside(root, relative), encodePng(output.frame));
      const revision: FrameRevision = { id: randomUUID(), source: relative, createdAt: new Date().toISOString(), inputSource: original.source, processorVersion: '2', settings: preview.analysis.recommendedSettings.processor, upgrade: upgradeProvenance(original, preview.analysis, profile, strength) };
      return { output, relative, revision };
    }));
    const next = structuredClone(project);
    for (const item of staged) { const frame = frameFor(next, item.output.id); frame.source = item.relative; frame.derivedPath = item.relative; frame.width = item.output.width; frame.height = item.output.height; frame.anchorX = item.output.anchorX; frame.anchorY = item.output.anchorY; frame.offsetX = item.output.offsetX; frame.offsetY = item.output.offsetY; frame.revisions.push(item.revision); frame.activeRevisionId = item.revision.id; }
    return persistProject(root, next);
  }

  async exportAnimation(root: string, overrides: Partial<Project['exportSettings']> = {}) {
    const project = await loadProject(root), settings = { ...project.exportSettings, ...overrides };
    const frames = project.animation.frameIds.map(id => frameFor(project, id)); if (!frames.length) throw new ProjectOperationError('INVALID_ARGUMENT', 'No frames to export');
    const prefix = settings.prefix.replace(/[^a-zA-Z0-9_-]/g, '_') || 'sprite';
    const numbered = frames.map((_, index) => `exports/${prefix}_${String(index + 1).padStart(3, '0')}.png`);
    const sheet = `exports/${prefix}_sheet.png`, json = `exports/${prefix}.json`, targets = [...numbered, sheet, ...(settings.includeMetadata ? [json] : [])];
    await Promise.all(targets.map(target => ensureNotExists(root, target)));
    const rasters = await Promise.all(frames.map(frame => decodePng(root, frame.source)));
    const dimensionFrames = frames.map((frame, index) => ({ ...frame, width: rasters[index].width, height: rasters[index].height }));
    const dimensions = sheetDimensions(dimensionFrames, settings), canvas: RawFrame = { width: dimensions.width, height: dimensions.height, data: new Uint8ClampedArray(dimensions.width * dimensions.height * 4) };
    for (let index = 0; index < rasters.length; index++) {
      const raster = rasters[index], column = index % dimensions.columns, row = Math.floor(index / dimensions.columns), baseX = column * (dimensions.frameWidth + settings.padding) + Math.floor((dimensions.frameWidth - raster.width) / 2), baseY = row * (dimensions.frameHeight + settings.padding) + Math.floor((dimensions.frameHeight - raster.height) / 2);
      for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) { const source = (y * raster.width + x) * 4, target = ((baseY + y) * canvas.width + baseX + x) * 4; canvas.data.set(raster.data.subarray(source, source + 4), target); }
    }
    await Promise.all(rasters.map((raster, index) => atomicWrite(resolveInside(root, numbered[index]), encodePng(raster))));
    await atomicWrite(resolveInside(root, sheet), encodePng(canvas));
    if (settings.includeMetadata) await atomicWrite(resolveInside(root, json), JSON.stringify(metadata(project, dimensionFrames), null, 2));
    return { files: targets, frameCount: frames.length, sheet: { width: canvas.width, height: canvas.height } };
  }
}

export function framePreviewPng(frame: RawFrame) { return encodePng(frame); }
export function contactSheetPng(before: RawFrame[], after: RawFrame[]) {
  const total = Math.min(before.length, after.length, 6); const maxW = Math.max(1, ...before.slice(0, total).map(frame => frame.width), ...after.slice(0, total).map(frame => frame.width)); const maxH = Math.max(1, ...before.slice(0, total).map(frame => frame.height), ...after.slice(0, total).map(frame => frame.height)); const sheet: RawFrame = { width: maxW * 2, height: maxH * total, data: new Uint8ClampedArray(maxW * 2 * maxH * total * 4) };
  for (let row = 0; row < total; row++) for (const [column, raster] of [[0, before[row]], [1, after[row]]] as const) for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) { const source = (y * raster.width + x) * 4, target = ((row * maxH + y) * sheet.width + column * maxW + x) * 4; sheet.data.set(raster.data.subarray(source, source + 4), target); }
  return encodePng(sheet);
}
