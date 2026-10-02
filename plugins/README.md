# Quest plugins

Every studio tool and every chat model is a plugin. The core only knows the interface below, so you can add
Blender, Aseprite, another model host or anything else by dropping in a folder.

```
plugins/<kind>/<name>/plugin.json   manifest
plugins/<kind>/<name>/index.js      CommonJS module, runs in the local server (Node)
```

`plugin.json`:

```json
{ "id": "ollama", "kind": "provider", "label": "Ollama (local)", "description": "…", "cost": "free" }
```

`cost` is `free` or `paid`. The chat panel asks before each request to a `paid` provider.

`index.js` exports a factory: `module.exports = ({ cfg, manifest }) => plugin`. `cfg` is the game's `config.json`;
a plugin reads its own settings from `cfg.plugins?.[id]` (falling back to whatever older keys it supports).

## Kinds

- **provider**: a chat model host.
  - `available()` → `Promise<boolean>`
  - `models()` → `Promise<[{ id, label?, size? }]>`
  - `chat({ model, messages, system, signal })` → async iterable of text chunks (strings). A chunk may instead be
    `{ thinking: '…' }` for reasoning, which the panel shows as progress but never adds to the reply. `messages` is
    `[{ role: 'user' | 'assistant', content }]`.
- **tool3d** (planned): turns a request into a model file (.glb). First plugin: Blender, run headless.
- **tool2d** (planned): sprites and tiles. First plugin: the pixel editor built into the asset editor.

Plugins run with the server's permissions, so only install ones you trust. Endpoints are local only:
`GET /api/studio/plugins`, `GET /api/studio/models?provider=<id>`, `POST /api/studio/chat`.
