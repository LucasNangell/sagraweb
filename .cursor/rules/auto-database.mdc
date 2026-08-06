---
description: Persistência MySQL e dual-write Access MDB
globs:
  - "app/backend/database.py"
  - "app/backend/**/mdb*.py"
  - "app/services/sync*/**/*"
  - "deploy/sql/**/*"
alwaysApply: false
---

<!-- generated-by: bootstrap-project-rules -->

# Banco de dados

## Modelo

- **Sem ORM** — SQL direto via PyMySQL (`app/backend/database.py`, pool customizado).
- **MySQL** — DB principal (`sagrafulldb` em `config/.env.example`).
- **Access MDB** — dual-write via `pyodbc`; desligado com `MYSQL_ONLY=true`.

## Regras

- Respeitar flag `MYSQL_ONLY` em `config_manager.py` e `routers/mdb_writer.py`.
- Migrações: scripts SQL manuais em `deploy/sql/` — não há migrator automático.
- Sync andamentos: `app/services/sync_andamentos_v2.py`, `sync_tables/`.

## Referências

`app/backend/database.py`, `config/.env.example`, `config/config.example.json` (paths MDB).
