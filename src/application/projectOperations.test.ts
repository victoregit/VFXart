import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectModel, validateProject } from '../core/project';
import type { Project } from '../core/types';
import { ProjectOperationError, ProjectOperations } from './projectOperations';

const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vfxart-mcp-')); roots.push(root);
  await fs.mkdir(path.join(root, 'frames', 'f1'), { recursive: true }); await fs.mkdir(path.join(root, 'frames', 'f2'), { recursive: true }); await fs.mkdir(path.join(root, 'exports'), { recursive: true });
  const write = async (relative: string, color: [number, number, number]) => { const png = new PNG({ width: 2, height: 2 }); for (let i = 0; i < png.data.length; i += 4) { png.data[i] = color[0]; png.data[i + 1] = color[1]; png.data[i + 2] = color[2]; png.data[i + 3] = 255; } await fs.writeFile(path.join(root, relative), PNG.sync.write(png)); };
  await write('frames/f1/image.png', [255, 0, 0]); await write('frames/f2/image.png', [0, 0, 255]);
  const project = createProjectModel(randomUUID(), 'MCP fixture');
  project.frames = ['f1', 'f2'].map((id, index) => ({ id, source: `frames/${id}/image.png`, originalSource: `frames/${id}/image.png`, revisions: [{ id: `${id}:initial`, source: `frames/${id}/image.png`, createdAt: project.createdAt }], activeRevisionId: `${id}:initial`, width: 2, height: 2, offsetX: index, offsetY: 0, anchorX: 1, anchorY: 1 }));
  project.animation.frameIds = ['f1', 'f2']; project.exportSettings = { prefix: 'mcp', layout: 'horizontal', columns: 2, padding: 0, includeMetadata: true };
  await fs.writeFile(path.join(root, 'project.json'), JSON.stringify(project));
  return { root, project };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe('ProjectOperations', () => {
  it('previews in memory, applies independent revisions, and persists the active revision', async () => {
    const { root } = await fixture(), operations = new ProjectOperations();
    const preview = await operations.previewProcess(root, 'f1', { colorCount: 1, minimumAlpha: 1 });
    expect(preview.frame.width).toBe(2);
    const before = await fs.readdir(path.join(root, 'frames', 'f1'));
    expect(before).toEqual(['image.png']);
    const applied = await operations.applyProcess(root, ['f1'], { colorCount: 1, minimumAlpha: 1 });
    expect(applied.frames[0].source).not.toBe('frames/f1/image.png');
    expect(applied.frames[0].revisions).toHaveLength(2);
    expect(await fs.access(path.join(root, applied.frames[0].source)).then(() => true)).toBe(true);
    const reopened = validateProject(JSON.parse(await fs.readFile(path.join(root, 'project.json'), 'utf8')) as Project);
    expect(reopened.frames[0].activeRevisionId).toBe(applied.frames[0].activeRevisionId);
  });

  it('uses a shared Upgrade transaction and exports without silent overwrite', async () => {
    const { root } = await fixture(), operations = new ProjectOperations();
    const before = await operations.analyze(root, { profile: 'pixel-art', strength: 70, padding: 2 });
    expect(before.frameCount).toBe(2);
    const upgraded = await operations.applyUpgrade(root, { profile: 'pixel-art', strength: 70, padding: 2 });
    expect(upgraded.frames.every(frame => frame.revisions.length === 2)).toBe(true);
    expect(upgraded.frames[0].revisions.at(-1)?.upgrade?.sharedPalette).toEqual(upgraded.frames[1].revisions.at(-1)?.upgrade?.sharedPalette);
    const exported = await operations.exportAnimation(root, { prefix: 'mcp_result' });
    expect(exported.files).toContain('exports/mcp_result_sheet.png');
    await expect(operations.exportAnimation(root, { prefix: 'mcp_result' })).rejects.toMatchObject({ code: 'COLLISION' } satisfies Partial<ProjectOperationError>);
  });
});
