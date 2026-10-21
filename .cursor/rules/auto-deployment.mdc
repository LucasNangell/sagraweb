---
description: Deploy Windows, releases e infraestrutura
globs:
  - "deploy/**/*"
  - "*.bat"
  - "GUIA_DEPLOY_RELEASES_SAGRA.md"
alwaysApply: false
---

<!-- generated-by: bootstrap-project-rules -->

# Deploy e infraestrutura

## Ambiente

Deploy **Windows + PowerShell**; sem Docker ou GitHub Actions no repositório.

## Fluxo confirmado

1. Build SPA → `apps/web/dist/`; empacotamento copia para `deploy/release/app/frontend/` (`VITE_BASE_PATH=/sagra/`, `VITE_API_BASE_URL=/sagra/api`).
2. Empacotar: `pnpm package:release` → `deploy/release/`.
3. Deploy remoto: `deploy/scripts/deploy_release.ps1`, `deploy-producao.ps1`.
4. Servidor: releases versionadas + `shared/` persistente (`config`, logs, `Modelos`).
5. Watchdog: `SAGRA-SystemWatchdog` monitora API + `SAGRA-SyncAndamentos`; ver `deploy/templates/instalar-servico-watchdog-sistema.ps1` e `docs/RUNBOOK_WATCHDOG_SISTEMA.md`.

## Scripts úteis

- `deploy/scripts/rollback_release.ps1`
- `deploy/scripts/finish-release-junctions.ps1`
- `iniciar-servidor.bat` — dev local (não usar `deploy/release/iniciar-api.bat` para dev).

## Proxy

Nginx: `deploy/nginx/conf/`. Cloudflare workers: `deploy/cloudflare-worker-painel*.js`.

## Referências

`GUIA_DEPLOY_RELEASES_SAGRA.md`, `deploy/scripts/package-release.ps1`, `deploy/templates/LEIA-ME-DEPLOY.md`.
