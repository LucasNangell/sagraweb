---
description: API FastAPI e serviços Python
globs:
  - "app/backend/**/*"
  - "app/services/**/*"
  - "worker/**/*"
alwaysApply: false
---

<!-- generated-by: bootstrap-project-rules -->

# Backend Python

## API FastAPI

- Entry point: `routers.api:app` — `uvicorn routers.api:app` (ver `deploy/bat/_iniciar-api.cmd`, `iniciar-servidor.bat`).
- OpenAPI 3.1; contratos em `routers/api.py`.
- Novos endpoints: router em `routers/`, lógica em `services/`, schemas Pydantic quando aplicável.
- Auth/RBAC: `security/api_auth.py`.

## Dependências

`app/backend/requirements.txt` — FastAPI, Uvicorn, Pydantic 2, PyMySQL, pyodbc, pywebpush, OCR/PDF, Google Drive API.

## Serviços auxiliares

`app/services/` — sync MDB, monitor, backup; separado da API principal.

## Worker papelaria

`worker/papelaria_worker/` — Windows, CorelDRAW COM, `pywin32`. Build: `build_exe.ps1`.

## Referências

`app/backend/routers/api.py`, `app/backend/database.py`, `app/backend/config_manager.py`, `pytest.ini`.
