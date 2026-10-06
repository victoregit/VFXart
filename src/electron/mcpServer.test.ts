import { describe, expect, it } from 'vitest';
import { VfxMcpServer, modeAllowsWrites } from './mcpServer';

describe('MCP connection policy', () => {
  it('allows writes only for local and Secure Tunnel sessions', () => {
    expect(modeAllowsWrites('local')).toBe(true);
    expect(modeAllowsWrites('secure-tunnel')).toBe(true);
    expect(modeAllowsWrites('public-https')).toBe(false);
  });

  it('serves health only on a local endpoint while a project is authorized', async () => {
    const server = new VfxMcpServer(async () => false);
    await server.setAuthorizedProject('C:/fixture/project', { id: 'fixture', name: 'Fixture' });
    const status = await server.start('public-https');
    expect(status.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const health = await fetch(status.endpoint!.replace('/mcp', '/health')).then(response => response.json() as Promise<{ mode: string; projectAuthorized: boolean }>);
    expect(health).toMatchObject({ mode: 'public-https', projectAuthorized: true });
    await server.stop();
  });
});
