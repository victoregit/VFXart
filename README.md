# VFXart

VFXart is a Windows-first desktop workflow for importing, slicing, editing, animating and exporting pixel-art sprites.

## Development

```powershell
npm install
npm run dev
```

## Validation and packaging

```powershell
npm run typecheck
npm test
npm run build
npm run build:electron
```

The Windows NSIS installer is written to `release/<version>/VFXart Setup <version>.exe`.

Projects are portable folders containing `project.json`, immutable source images in `assets/originals`, generated frame PNGs in `frames`, and exported assets in `exports`.

## Local ChatGPT MCP

Open a project with frames, select **MCP** in the lower-left corner, choose a connection mode, and enable the local server. VFXart serves Streamable HTTP only on `127.0.0.1` at the displayed `/mcp` endpoint.

- **Local** is for MCP Inspector and local testing.
- **Secure MCP Tunnel** permits previews and writes after the external OpenAI `tunnel-client` is configured for that endpoint. VFXart does not manage `tunnel_id` or API keys.
- **Public HTTPS fallback** is intentionally read-only: analysis and previews work, while Apply and Export are rejected.

The MCP session is bound to the currently open project. Process, Upgrade, and Export requests from ChatGPT always show a local VFXart confirmation dialog before filesystem changes begin.

To import a trusted asset folder from a ChatGPT request, choose **Authorize source folder…** in the MCP panel first. The server exposes only an opaque folder ID to MCP, copies supported images into `assets/originals`, and creates one initial frame per image. The authorization is cleared when the project changes or the app closes; VFXart never modifies the selected source folder.

