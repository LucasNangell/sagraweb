---
description: Secrets, config runtime e dados sensíveis
globs:
  - "config/**/*"
  - "app/backend/security/**/*"
alwaysApply: false
---

<!-- generated-by: bootstrap-project-rules -->

# Segurança e configuração

## Secrets — nunca commitar

- `config/.env` — credenciais MySQL, flags runtime.
- `config/vapid*.json` — push notifications.
- `config/gdrive/*` — tokens Google Drive.
- Templates seguros: `config/.env.example`, `config/config.example.json`.

## Auth API

- Middleware em `app/backend/security/api_auth.py`.
- RBAC por IP/sessão; respeitar rotas protegidas ao adicionar endpoints.

## Input externo

- Sanitização HTML: `bleach` (requirements).
- Uploads e portal cliente: validar em routers correspondentes (`proof_portal_routes`, etc.).

## Dual-write MDB

Com `MYSQL_ONLY=true`, gravação Access desativada — não reativar sem entender impacto em produção.
