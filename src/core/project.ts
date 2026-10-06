import type { Project, SpriteFrame } from './types';
import type { PixelProcessingPreset } from './pixel-processing/types';

export const createProjectModel = (id: string, name: string): Project => ({
  schemaVersion: 2, id, name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  assets: [], slices: [], frames: [], palettes: [], processingPresets: [],
  animation: { frameIds: [], fps: 12, loop: true, reverse: false, pingPong: false },
  exportSettings: { prefix: 'sprite', layout: 'horizontal', columns: 1, padding: 0, includeMetadata: true }
});

type ProjectV1 = { schemaVersion: 1; id:string; name:string; createdAt:string; updatedAt:string; assets:Project['assets']; slices:Project['slices']; frames:Array<Omit<SpriteFrame,'originalSource'|'revisions'|'activeRevisionId'>>; animation:Project['animation']; palettes:Project['palettes']; exportSettings:Project['exportSettings']; };
export function migrateProject(input: unknown): Project {
  const value=input as Project | ProjectV1;
  if (!value || !Array.isArray(value.assets) || !Array.isArray(value.frames) || !Array.isArray(value.slices)) throw new Error('Invalid VFXart project manifest');
  if(value.schemaVersion===2) return value as Project;
  if(value.schemaVersion!==1) throw new Error('Unsupported VFXart project schema');
  const migratedFrames=(value.frames as ProjectV1['frames']).map(frame=>{const initialId=`${frame.id}:initial`;return {...frame,originalSource:frame.source,revisions:[{id:initialId,source:frame.source,createdAt:value.updatedAt??value.createdAt??new Date(0).toISOString()}],activeRevisionId:initialId};});
  return {...value,schemaVersion:2,frames:migratedFrames,processingPresets:[] as PixelProcessingPreset[]} as Project;
}
export const validateProject=migrateProject;
