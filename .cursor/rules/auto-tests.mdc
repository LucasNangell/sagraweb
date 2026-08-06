---
description: Testes pytest e Vitest
globs:
  - "app/backend/tests/**/*"
  - "apps/web/src/**/*.test.ts"
  - "apps/web/src/**/*.test.tsx"
  - "pytest.ini"
  - "apps/web/vitest.config.ts"
alwaysApply: false
---

<!-- generated-by: bootstrap-project-rules -->

# Testes

## Backend (pytest)

- Local: `app/backend/tests/test_*.py`
- Config: `pytest.ini` — `testpaths = app/backend/tests`, `pythonpath = app/backend`.
- Comando: `pnpm test:backend` ou `python -m pytest app/backend/tests -q`.
- Deps: `app/backend/requirements-dev.txt` (pytest, pytest-asyncio, httpx).
- Padrão: `TestClient` FastAPI, mocks de DB.

## Frontend (Vitest)

- Local: `apps/web/src/**/*.test.{ts,tsx}`
- Config: `apps/web/vitest.config.ts` — jsdom, setup em `src/test/setup.ts`.
- Comando: `pnpm test:frontend` ou `pnpm --filter @sagra/web test`.
- Padrão: Testing Library + jsdom.

## Raiz

`pnpm test` executa backend e frontend em sequência.
