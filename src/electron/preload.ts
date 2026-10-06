import { contextBridge, ipcRenderer } from 'electron';
import type { Project } from '../core/types';
import type { McpConnectionMode, McpStatus } from './mcpServer';
import type { PixelProcessingSettings } from '../core/pixel-processing';
import type { UpgradeAnalysisOptions } from '../core/upgrade';

const api = {
  createProject: (name: string) => ipcRenderer.invoke('project:create', name) as Promise<{root:string;project:Project}|null>,
  openProject: () => ipcRenderer.invoke('project:open') as Promise<{root:string;project:Project}|null>,
  saveProject: (root: string, project: Project) => ipcRenderer.invoke('project:save', root, project) as Promise<Project>,
  selectAndImport: (root:string) => ipcRenderer.invoke('asset:select-and-import', root) as Promise<{name:string;relativePath:string}[]>,
  importPaths: (root:string, paths:string[]) => ipcRenderer.invoke('asset:import-paths', root, paths) as Promise<{name:string;relativePath:string}[]>,
  readFile: (root:string, relative:string) => ipcRenderer.invoke('file:read', root, relative) as Promise<Uint8Array>,
  writeFile: (root:string, relative:string, bytes:Uint8Array, overwrite?:boolean) => ipcRenderer.invoke('file:write', root, relative, bytes, overwrite) as Promise<string>,
  confirmDiscard: (message:string) => ipcRenderer.invoke('app:confirm-discard',message) as Promise<boolean>,
  appVersion: () => ipcRenderer.invoke('app:version') as Promise<string>,
  mcpStatus: () => ipcRenderer.invoke('mcp:status') as Promise<McpStatus>,
  authorizeMcpSourceFolder: () => ipcRenderer.invoke('mcp:authorize-source-folder') as Promise<McpStatus>,
  startMcp: (mode:McpConnectionMode) => ipcRenderer.invoke('mcp:start', mode) as Promise<McpStatus>,
  stopMcp: () => ipcRenderer.invoke('mcp:stop') as Promise<McpStatus>,
  applyProcess: (root:string, frameIds:string[], settings:Partial<PixelProcessingSettings>) => ipcRenderer.invoke('mcp:apply-process', root, frameIds, settings) as Promise<Project>,
  applyUpgrade: (root:string, options:UpgradeAnalysisOptions) => ipcRenderer.invoke('mcp:apply-upgrade', root, options) as Promise<Project>,
  exportAnimation: (root:string, options:Partial<Project['exportSettings']>) => ipcRenderer.invoke('mcp:export', root, options) as Promise<{files:string[];frameCount:number;sheet:{width:number;height:number}}>
};
contextBridge.exposeInMainWorld('vfx', api);
