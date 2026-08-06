# Monorepo SAGRA Web — Fase 0

## Pré-requisitos

- Node.js ≥ 20
- pnpm ≥ 9 (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)

## Comandos (raiz do projeto)

```powershell
cd "\\cgrafsysvm\Sistemas CGraf\Sagra Web"
pnpm install
pnpm dev          # SPA em http://127.0.0.1:5173
pnpm typecheck    # todos os workspaces
pnpm build        # build de produção (@sagra/web → apps/web/dist)
```

## API em desenvolvimento

Suba o backend antes do `pnpm dev`:

```powershell
cd app\backend
python -m uvicorn routers.api:app --host 127.0.0.1 --port 8001 --reload
```

O Vite faz proxy de `/api` → `http://127.0.0.1:8001/api`.

## Workspaces

| Pacote | Caminho |
|--------|---------|
| `@sagra/web` | `apps/web` |
| `@sagra/api-types` | `packages/api-types` |
| `@sagra/ui` | `packages/ui` |

**Nota:** a pasta `\\cgrafsysvm\s\SagraWeb` (legado) não é alterada por este monorepo.
