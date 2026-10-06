import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createProjectModel, validateProject } from '../core/project';
import type { Project } from '../core/types';
import { VfxMcpServer, type McpApprovalRequest, type McpConnectionMode } from './mcpServer';

const registeredRoots = new Set<string>();
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
let windowRef: BrowserWindow | undefined;
const mcp = new VfxMcpServer(async (request: McpApprovalRequest) => {
  const host = windowRef;
  if (!host || host.isDestroyed()) return false;
  const confirmation = dialog.showMessageBox(host, { type: 'question', buttons: ['Decline', 'Authorize'], defaultId: 0, cancelId: 0, title: 'VFXart MCP request', message: `ChatGPT requests: ${request.tool}`, detail: `Project: ${request.projectName}\n\n${request.summary}\n\nRequest: ${request.id}\n\nNo files will change unless you authorize this action.` }).then(result => result.response === 1);
  const timeout = new Promise<boolean>(resolve => setTimeout(() => resolve(false), 60_000));
  return Promise.race([confirmation, timeout]);
});

function normalizeRelative(value: string) { const normalized = path.posix.normalize(value.replaceAll('\\', '/')); if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..' || path.posix.isAbsolute(normalized)) throw new Error('Invalid project-relative path'); return normalized; }
function rootFor(root: string) { const resolved = path.resolve(root); if (!registeredRoots.has(resolved)) throw new Error('Project is not open'); return resolved; }
function inside(root: string, relative: string) { const result = path.resolve(root, normalizeRelative(relative)); if (!result.startsWith(root + path.sep)) throw new Error('Path escapes project'); return result; }
async function atomicJson(file: string, data: unknown) { const temporary = `${file}.${randomUUID()}.tmp`; const text = JSON.stringify(data, null, 2); JSON.parse(text); await fs.writeFile(temporary, text, 'utf8'); try { await fs.rename(temporary, file); } catch (error) { await fs.unlink(temporary).catch(() => undefined); throw error; } }
async function uniquePath(root: string, relative: string) { const normalized = normalizeRelative(relative), ext = path.extname(normalized), stem = normalized.slice(0, normalized.length - ext.length); let candidate = normalized, index = 2; while (await fs.access(inside(root, candidate)).then(() => true).catch(() => false)) candidate = `${stem}_${index++}${ext}`; return candidate; }
async function readManifest(root: string) { const project = validateProject(JSON.parse(await fs.readFile(path.join(root, 'project.json'), 'utf8'))); registeredRoots.add(root); return project; }

async function createWindow() {
  const preload = app.isPackaged ? path.join(__dirname, 'preload.js') : path.join(process.cwd(), 'dist-electron', 'electron', 'preload.js');
  windowRef = new BrowserWindow({ width: 1500, height: 980, minWidth: 1080, minHeight: 720, backgroundColor: '#15171b', webPreferences: { preload, contextIsolation: true, nodeIntegration: false } });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await windowRef.loadURL(devUrl); else await windowRef.loadFile(path.join(__dirname, '../../renderer/index.html'));
}

app.whenReady().then(async () => {
  ipcMain.handle('project:create', async (_event, name: string) => {
    const result = await dialog.showOpenDialog({ title: 'Choose where to create the VFXart project', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const safeName = name.trim().replace(/[<>:"/\\|?*]+/g, '-').replace(/\.+$/, '') || 'VFXart Project'; const root = path.join(result.filePaths[0], safeName);
    if (await fs.access(root).then(() => true).catch(() => false)) throw new Error('A folder with this project name already exists');
    await fs.mkdir(path.join(root, 'assets', 'originals'), { recursive: true }); await fs.mkdir(path.join(root, 'frames'), { recursive: true }); await fs.mkdir(path.join(root, 'exports'), { recursive: true });
    const project = createProjectModel(randomUUID(), safeName); await atomicJson(path.join(root, 'project.json'), project); registeredRoots.add(path.resolve(root)); await mcp.setAuthorizedProject(path.resolve(root), project); return { root: path.resolve(root), project };
  });
  ipcMain.handle('project:open', async () => { const result = await dialog.showOpenDialog({ title: 'Open VFXart project', properties: ['openDirectory'] }); if (result.canceled || !result.filePaths[0]) return null; const root = path.resolve(result.filePaths[0]); const project = await readManifest(root); await mcp.setAuthorizedProject(root, project); return { root, project }; });
  ipcMain.handle('project:save', async (_event, root: string, project: Project) => { const resolved=rootFor(root); const valid=validateProject(project); valid.updatedAt=new Date().toISOString(); await atomicJson(path.join(resolved, 'project.json'), valid); return valid; });
  ipcMain.handle('asset:select-and-import', async (_event, root: string) => { const resolved=rootFor(root); const result=await dialog.showOpenDialog({ title:'Import sprites', properties:['openFile','multiSelections'], filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}] }); if(result.canceled) return []; const imported=[] as {name:string; relativePath:string}[]; for(const input of result.filePaths) { const ext=path.extname(input).toLowerCase(); if(!imageExtensions.has(ext)) continue; const basename=path.basename(input); let relative=await uniquePath(resolved, `assets/originals/${basename}`); await fs.copyFile(input, inside(resolved,relative)); imported.push({name:path.basename(relative),relativePath:relative}); } return imported; });
  ipcMain.handle('asset:import-paths', async (_event, root:string, inputPaths:string[]) => { const resolved=rootFor(root), imported=[] as {name:string;relativePath:string}[]; for(const input of inputPaths) { const ext=path.extname(input).toLowerCase(); if(!imageExtensions.has(ext)) continue; const relative=await uniquePath(resolved,`assets/originals/${path.basename(input)}`); await fs.copyFile(input,inside(resolved,relative)); imported.push({name:path.basename(relative),relativePath:relative}); } return imported; });
  ipcMain.handle('file:read', async (_event, root:string, relative:string) => new Uint8Array(await fs.readFile(inside(rootFor(root),relative))));
  ipcMain.handle('file:write', async (_event, root:string, relative:string, bytes:Uint8Array, overwrite=false) => { const resolved=rootFor(root); let target=normalizeRelative(relative); if(!overwrite) target=await uniquePath(resolved,target); const output=inside(resolved,target); await fs.mkdir(path.dirname(output),{recursive:true}); await fs.writeFile(output,Buffer.from(bytes)); return target; });
  ipcMain.handle('app:confirm-discard', async (_event, message:string) => (await dialog.showMessageBox({type:'warning',buttons:['Cancel','Discard'],defaultId:0,cancelId:0,message})).response===1);
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('mcp:status', async () => mcp.status());
  ipcMain.handle('mcp:authorize-source-folder', async () => {
    const result = await dialog.showOpenDialog({ title: 'Authorize a source folder for VFXart MCP imports', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return mcp.status();
    return mcp.authorizeSourceFolder(result.filePaths[0]);
  });
  ipcMain.handle('mcp:start', async (_event, mode: McpConnectionMode) => mcp.start(mode));
  ipcMain.handle('mcp:stop', async () => mcp.stop());
  ipcMain.handle('mcp:apply-process', async (_event, root: string, frameIds: string[], settings: Record<string, unknown>) => { if (mcp.status().projectId === undefined) throw new Error('No project is authorized'); const service = new (await import('../application/projectOperations')).ProjectOperations(); return service.applyProcess(rootFor(root), frameIds, settings); });
  ipcMain.handle('mcp:apply-upgrade', async (_event, root: string, options: Record<string, unknown>) => { const service = new (await import('../application/projectOperations')).ProjectOperations(); return service.applyUpgrade(rootFor(root), options); });
  ipcMain.handle('mcp:export', async (_event, root: string, options: Record<string, unknown>) => { const service = new (await import('../application/projectOperations')).ProjectOperations(); return service.exportAnimation(rootFor(root), options); });
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { void mcp.stop(); });
