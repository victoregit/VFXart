import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { ProjectOperations, ProjectOperationError, contactSheetPng, framePreviewPng, type ImportedSpriteInput } from '../application/projectOperations';
import type { PixelProcessingSettings } from '../core/pixel-processing';
import type { Project } from '../core/types';
import type { UpgradeAnalysisOptions } from '../core/upgrade';

export type McpConnectionMode = 'local' | 'secure-tunnel' | 'public-https';
export interface McpSourceFolder { id: string; label: string; }
export interface McpStatus { enabled: boolean; mode: McpConnectionMode; port?: number; endpoint?: string; projectName?: string; projectId?: string; sourceFolders: McpSourceFolder[]; lastActivity?: { tool: string; at: string }; }
export interface McpApprovalRequest { id: string; tool: 'apply_process' | 'apply_upgrade' | 'export_animation'; projectName: string; summary: string; }
export type McpApproval = (request: McpApprovalRequest) => Promise<boolean>;
export const modeAllowsWrites = (mode: McpConnectionMode) => mode === 'local' || mode === 'secure-tunnel';

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false } as const;
const settingsSchema = z.object({}).catchall(z.unknown());
const upgradeSchema = z.object({ profile: z.enum(['clean', 'pixel-art', 'strong']).optional(), strength: z.number().min(0).max(100).optional(), padding: z.number().int().min(0).max(128).optional(), target: z.object({ width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096) }).nullable().optional() });
const upgradeRequestSchema = upgradeSchema.extend({ frameIds: z.array(z.string().min(1)).min(1).max(200).optional() });
const supportedImage = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_IMPORT_FILES = 200;
const MAX_IMPORT_BYTES = 250 * 1024 * 1024;

export class VfxMcpServer {
  private server?: HttpServer;
  private root?: string;
  private mode: McpConnectionMode = 'local';
  private project?: { id: string; name: string };
  private sourceFolders = new Map<string, { root: string; label: string }>();
  private lastActivity?: McpStatus['lastActivity'];
  private readonly operations = new ProjectOperations();

  constructor(private readonly approve: McpApproval, private readonly onProjectChanged?: (project: Project) => void) {}
  private projectChanged(project: Project) { this.onProjectChanged?.(project); }

  async setAuthorizedProject(root: string | undefined, project?: { id: string; name: string }) {
    if (this.server && this.root !== root) await this.stop();
    if (this.root !== root) this.sourceFolders.clear();
    this.root = root; this.project = project;
  }
  status(): McpStatus { return { enabled: Boolean(this.server), mode: this.mode, port: this.server ? this.port : undefined, endpoint: this.server ? `http://127.0.0.1:${this.port}/mcp` : undefined, projectName: this.project?.name, projectId: this.project?.id, sourceFolders: [...this.sourceFolders.entries()].map(([id, value]) => ({ id, label: value.label })), lastActivity: this.lastActivity }; }
  private port?: number;
  private writable() { return modeAllowsWrites(this.mode); }
  private assertWritable() { if (!this.writable()) throw new Error('Write tools are disabled in Public HTTPS Fallback mode. Use Secure MCP Tunnel or Local mode.'); }
  private activity(tool: string) { this.lastActivity = { tool, at: new Date().toISOString() }; }
  private authorizedRoot() { if (!this.root || !this.project) throw new Error('No VFXart project is authorized for this MCP session'); return this.root; }
  async authorizeSourceFolder(folder: string) {
    const root = path.resolve(folder), details = await fs.stat(root).catch(() => undefined);
    if (!details?.isDirectory()) throw new Error('The selected source must be an existing folder');
    const id = randomUUID(); this.sourceFolders.set(id, { root, label: path.basename(root) || root });
    return this.status();
  }
  private sourceFolder(id: string) { const value = this.sourceFolders.get(id); if (!value) throw new Error('That source folder is not authorized for this VFXart session'); return value; }
  private async sourceImages(root: string, relative = '', collected: string[] = []): Promise<string[]> {
    if (collected.length >= MAX_IMPORT_FILES) return collected;
    const directory = path.join(root, relative), entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (collected.length >= MAX_IMPORT_FILES) break;
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) await this.sourceImages(root, next, collected);
      else if (entry.isFile() && supportedImage.has(path.extname(entry.name).toLowerCase())) collected.push(next);
    }
    return collected;
  }
  private async importAuthorizedFolder(sourceId: string) {
    this.assertWritable();
    const source = this.sourceFolder(sourceId), files = await this.sourceImages(source.root);
    if (!files.length) throw new Error('No PNG, JPG, JPEG or WebP files were found in the authorized source folder');
    if (files.length >= MAX_IMPORT_FILES) throw new Error(`The source folder has more than ${MAX_IMPORT_FILES} images. Choose a smaller folder.`);
    const { nativeImage } = await import('electron');
    let total = 0;
    const inputs: ImportedSpriteInput[] = [];
    for (const relative of files) {
      const absolute = path.resolve(source.root, relative);
      if (!absolute.startsWith(`${source.root}${path.sep}`)) throw new Error('Source path escapes the authorized folder');
      const original = await fs.readFile(absolute); total += original.byteLength;
      if (total > MAX_IMPORT_BYTES) throw new Error('The selected source images exceed the 250 MB import limit');
      const image = nativeImage.createFromBuffer(original);
      if (image.isEmpty()) throw new Error(`Could not decode image: ${relative}`);
      inputs.push({ name: relative.replaceAll('\\', '/'), original, png: image.toPNG() });
    }
    const imported = await this.operations.importSprites(this.authorizedRoot(), inputs);
    this.projectChanged(imported.project);
    this.activity('import_sprites');
    return { source: source.label, importedAssets: inputs.length, frameIds: imported.frameIds, projectUpdatedAt: imported.project.updatedAt };
  }
  private async requestApproval(tool: McpApprovalRequest['tool'], summary: string) {
    this.assertWritable();
    const project = this.project; if (!project) throw new Error('No VFXart project is authorized');
    const approved = await this.approve({ id: randomUUID(), tool, projectName: project.name, summary });
    if (!approved) throw new Error('The operation was not approved locally in VFXart');
  }

  async start(mode: McpConnectionMode) {
    if (!this.root || !this.project) throw new Error('Open a VFXart project before enabling MCP');
    if (this.server) { this.mode = mode; return this.status(); }
    this.mode = mode;
    for (let port = 8787; port < 8798; port++) {
      const server = createServer((request, response) => void this.handle(request, response));
      const listening = await new Promise<boolean>(resolve => { server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => resolve(true)); });
      if (listening) { this.server = server; this.port = port; return this.status(); }
      server.close();
    }
    throw new Error('Could not find an available local MCP port');
  }
  async stop() { const server = this.server; this.server = undefined; this.port = undefined; this.lastActivity = undefined; if (server) await new Promise<void>(resolve => server.close(() => resolve())); return this.status(); }

  private async handle(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) {
    if (!request.url) { response.writeHead(400).end('Missing URL'); return; }
    const url = new URL(request.url, `http://${request.headers.host ?? '127.0.0.1'}`);
    if (request.method === 'GET' && url.pathname === '/health') { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'VFXart MCP', mode: this.mode, projectAuthorized: Boolean(this.root) })); return; }
    if (url.pathname !== '/mcp' || !request.method || !['GET', 'POST', 'DELETE'].includes(request.method)) { response.writeHead(404).end('Not found'); return; }
    const mcp = this.createMcp(); const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.on('close', () => { void transport.close(); void mcp.close(); });
    try { await mcp.connect(transport); await transport.handleRequest(request, response); }
    catch (error) { if (!response.headersSent) response.writeHead(500).end('MCP request failed'); }
  }

  private createMcp() {
    const server = new McpServer({ name: 'vfxart-local', version: '0.2.2' }, { instructions: 'Operate only on the VFXart project currently authorized in the desktop app. Source folder IDs are pre-authorized locally in VFXart; use import_sprites only with those IDs. Use inspect_frames before targeting frame IDs. Preview changes before applying them. Write operations require local approval.' });
    // The SDK's deeply recursive schema inference becomes impractical with the
    // flexible settings objects accepted by VFXart. Runtime validation remains
    // provided by the Zod schemas below; this adapter keeps that boundary local.
    const registerTool = server.registerTool.bind(server) as (...args: any[]) => void;
    const result = (tool: string, data: unknown, text: string) => { this.activity(tool); return { structuredContent: data as Record<string, unknown>, content: [{ type: 'text' as const, text }] }; };
    const failure = (error: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: (error as Error).message || 'VFXart MCP operation failed' }] });

    registerTool('get_project_status', { title: 'Get VFXart project status', description: 'Use this to inspect the project currently authorized in VFXart, including IDs of folders authorized for automatic import.', annotations: readOnly }, async () => { try { const status = { ...await this.operations.status(this.authorizedRoot()), sourceFolders: this.status().sourceFolders }; return result('get_project_status', status, `Project ${status.name}: ${status.frameCount} frame(s), ${status.fps} FPS.`); } catch (error) { return failure(error); } });
    registerTool('import_sprites', { title: 'Import authorized sprite folder', description: 'Copy all supported images from a source folder explicitly authorized in VFXart. Each image becomes one initial frame. Source paths are never accepted here.', inputSchema: { sourceId: z.string().uuid() }, annotations: write }, async ({ sourceId }: { sourceId: string }) => { try { const imported = await this.importAuthorizedFolder(sourceId); return result('import_sprites', imported, `Imported ${imported.importedAssets} image(s) as ${imported.frameIds.length} frame(s) from ${imported.source}.`); } catch (error) { return failure(error); } });
    registerTool('inspect_frames', { title: 'Inspect frames', description: 'Use this to inspect metadata for specific VFXart frame IDs without modifying them.', inputSchema: { frameIds: z.array(z.string().min(1)).max(100).optional() }, annotations: readOnly }, async ({ frameIds }: { frameIds?: string[] }) => { try { const frames = await this.operations.inspectFrames(this.authorizedRoot(), frameIds); return result('inspect_frames', { frames }, `Inspected ${frames.length} frame(s).`); } catch (error) { return failure(error); } });
    registerTool('analyze_animation', { title: 'Analyze animation', description: 'Use this to analyze the authorized animation or one explicit frame group and receive global Upgrade recommendations.', inputSchema: upgradeRequestSchema, annotations: readOnly }, async ({ frameIds, ...options }: UpgradeAnalysisOptions & { frameIds?: string[] }) => { try { const analysis = await this.operations.analyze(this.authorizedRoot(), options, frameIds); return result('analyze_animation', analysis, `Analyzed ${analysis.frameCount} frame(s).`); } catch (error) { return failure(error); } });
    registerTool('preview_process', { title: 'Preview pixel processing', description: 'Use this to preview Pixel Processor settings on one frame. Does not create a revision or write a file.', inputSchema: { frameId: z.string().min(1), settings: settingsSchema }, annotations: readOnly }, async ({ frameId, settings }: { frameId: string; settings: Record<string, unknown> }) => { try { const preview = await this.operations.previewProcess(this.authorizedRoot(), frameId, settings as Partial<PixelProcessingSettings>); const image = framePreviewPng(preview.frame); this.activity('preview_process'); return { structuredContent: { frameId, width: preview.frame.width, height: preview.frame.height, settings: preview.settings }, content: [{ type: 'text' as const, text: `In-memory preview for frame ${frameId}.` }, { type: 'image' as const, data: image.toString('base64'), mimeType: 'image/png' }] }; } catch (error) { return failure(error); } });
    registerTool('preview_upgrade', { title: 'Preview animation Upgrade', description: 'Use this to preview an Upgrade across the whole authorized animation or an explicit frame group. Does not write files.', inputSchema: upgradeRequestSchema, annotations: readOnly }, async ({ frameIds, ...options }: UpgradeAnalysisOptions & { frameIds?: string[] }) => { try { const root = this.authorizedRoot(), preview = await this.operations.previewUpgrade(root, options, frameIds); const { frames } = await this.operations.animationInputs(root, frameIds), image = contactSheetPng(frames.map(frame => frame.frame), preview.frames.map(frame => frame.frame)); this.activity('preview_upgrade'); return { structuredContent: { analysis: preview.analysis, frameCount: preview.frames.length }, content: [{ type: 'text' as const, text: `In-memory Upgrade preview for ${preview.frames.length} frame(s).` }, { type: 'image' as const, data: image.toString('base64'), mimeType: 'image/png' }] }; } catch (error) { return failure(error); } });
    registerTool('apply_process', { title: 'Apply pixel processing', description: 'Create processed revisions for selected frames. Requires approval in the VFXart desktop app.', inputSchema: { frameIds: z.array(z.string().min(1)).min(1).max(100), settings: settingsSchema }, annotations: write }, async ({ frameIds, settings }: { frameIds: string[]; settings: Record<string, unknown> }) => { try { await this.requestApproval('apply_process', `Process ${frameIds.length} frame(s) and create new revisions.`); const project = await this.operations.applyProcess(this.authorizedRoot(), frameIds, settings as Partial<PixelProcessingSettings>); this.projectChanged(project); return result('apply_process', { frameIds, projectUpdatedAt: project.updatedAt }, `Processed ${frameIds.length} frame(s).`); } catch (error) { return failure(error); } });
    registerTool('apply_upgrade', { title: 'Apply animation Upgrade', description: 'Create upgraded revisions for every animation frame or an explicit frame group. Requires approval in the VFXart desktop app.', inputSchema: upgradeRequestSchema, annotations: write }, async ({ frameIds, ...options }: UpgradeAnalysisOptions & { frameIds?: string[] }) => { try { this.assertWritable(); const analysis = await this.operations.analyze(this.authorizedRoot(), options, frameIds); await this.requestApproval('apply_upgrade', `Upgrade ${analysis.frameCount} frame(s) using ${analysis.recommendedSettings.profile} at ${analysis.recommendedSettings.strength}%.`); const project = await this.operations.applyUpgrade(this.authorizedRoot(), options, frameIds); this.projectChanged(project); return result('apply_upgrade', { frameCount: analysis.frameCount, projectUpdatedAt: project.updatedAt, recommendedWidth: analysis.recommendedWidth, recommendedHeight: analysis.recommendedHeight }, 'Upgrade applied to the animation.'); } catch (error) { return failure(error); } });
    registerTool('export_animation', { title: 'Export animation', description: 'Export individual PNG frames, a spritesheet and optional JSON without overwriting existing files. Requires approval in VFXart.', inputSchema: { prefix: z.string().min(1).max(80).optional(), layout: z.enum(['horizontal', 'vertical', 'grid']).optional(), columns: z.number().int().min(1).max(100).optional(), padding: z.number().int().min(0).max(128).optional(), includeMetadata: z.boolean().optional() }, annotations: write }, async (options: { prefix?: string; layout?: 'horizontal' | 'vertical' | 'grid'; columns?: number; padding?: number; includeMetadata?: boolean }) => { try { await this.requestApproval('export_animation', `Export animation with prefix '${options.prefix ?? 'project default'}'. Existing files will never be overwritten.`); const exported = await this.operations.exportAnimation(this.authorizedRoot(), options); return result('export_animation', exported, `Exported ${exported.frameCount} frame(s) without overwriting existing files.`); } catch (error) { return failure(error); } });
    return server;
  }
}
