# Guia — Deploy por Releases (SAGRA Web)

## 1. Estrutura de produção

```text
\\cgrafsysvm\Sistemas CGraf\Sagra Web\
  (raiz legada — ATIVA até migracao autorizada)
  releases\
    initial_YYYYMMDD_HHMMSS\    # snapshot baseline
    staging_YYYYMMDD_HHMMSS\    # deploy do DEV
  current\                      # junction -> release ativa (apos migracao)
  shared\
    config\.env
    config\config.json
    logs\
    storage\
    storage_client_uploads\
    storage_test\
    Modelos\
    temp\ cache\ generated\
    data\gravacao_preview\   # cache PNG prévia rápida TIF (gravação)
  deploy\
    packages\
    scripts\
    backups\
    current-release.txt
    previous-release.txt
    deploy.log
```

**Caminho local no servidor:** `C:\Sistemas CGraf\Sagra Web\` (usar para junctions e bats)

---

## 2. Onde fica cada coisa

| Item | Local |
|------|-------|
| Código versionado | `releases/{nome}/` |
| Release ativa | `current/` (junction) + `deploy/current-release.txt` |
| Segredos e dados | `shared/` |
| Scripts de deploy | `deploy/scripts/` (cópia espelhada do repo DEV) |
| Backups automáticos | `deploy/backups/backup_pre_release_*` |

---

## 3. Como executar deploy

```powershell
# Na estacao de DEV (VPN conectada)
cd C:\dev\SagraWeb

# Nova release a partir do codigo DEV (build + copia)
powershell -File deploy\scripts\deploy_release.ps1 -ReleaseName "20260611_180000"

# Usar pacote ja gerado (sem rebuild)
powershell -File deploy\scripts\deploy_release.ps1 -ReleaseName "20260611_190000" -SkipBuild

# Snapshot da producao legada (baseline)
powershell -File deploy\scripts\deploy_release.ps1 -FromProduction -ReleaseName "initial_20260611_120000"
```

O script **nao ativa** a release por padrao. Producao legada continua servindo.

---

## 4. Junctions no servidor

Copias via UNC podem falhar para junctions de pastas. Apos deploy remoto:

```powershell
# NO SERVIDOR 10.1.1.73 (PowerShell como Admin)
cd "C:\Sistemas CGraf\Sagra Web"
powershell -File deploy\scripts\finish-release-junctions.ps1 -ReleaseName "staging_20260611_193049"
```

---

## 5. Como executar rollback

```powershell
# Listar releases (sem alterar producao)
powershell -File deploy\scripts\rollback_release.ps1 -ListReleases

# Rollback (EXIGE confirmacao — so apos migracao para current)
powershell -File deploy\scripts\rollback_release.ps1 -ConfirmProductionSwitch -ToRelease "initial_20260611_192811"
```

**Independente do sync:** activate / rollback / publicar **nao** start/stop do servico Windows
`SAGRA-SyncAndamentos` (NSSM). Ver `docs/RUNBOOK_SYNC_ANDAMENTOS_SERVICO.md`.

O monitor geral de disponibilidade é o serviço `SAGRA-SystemWatchdog`; ele verifica
`/health/live`, `/health` e o heartbeat do Sync, com proteção contra restart storm.
Instalação e operação: `docs/RUNBOOK_WATCHDOG_SISTEMA.md`.

---

## 6. Validacao

```powershell
# Estrutura + release mais recente
powershell -File deploy\scripts\validate-release.ps1

# Release especifica
powershell -File deploy\scripts\validate-release.ps1 -ReleaseName "staging_20260611_193049"

# Somente estrutura
powershell -File deploy\scripts\validate-release.ps1 -StructureOnly
```

**NGINX:** `nginx -t` no servidor antes de qualquer reload.

**API:** `http://127.0.0.1:8050/health` **no servidor** (nao funciona de estacao remota via 127.0.0.1).

---

## 7. O que NUNCA copiar do DEV para producao

- `config/.env` do DEV
- `node_modules`, `.git`, `.venv`, `__pycache__`
- `logs/`, `storage/`, `Modelos/` (previews uploadados)
- `data/` (cache de prévia rápida TIF da gravação pendente/externa)
- Sobrescrever `config.json` de producao (use `shared/config/`)

---

## 8. Se o deploy falhar

1. Release nova fica em `releases/{nome}` — producao legada intacta
2. Se ativou com `-Activate` e health falhou: `rollback_release.ps1 -ConfirmProductionSwitch`
3. Logs em `deploy/deploy.log`
4. Backups em `deploy/backups/`

---

## 9. Limpar releases antigas

```powershell
powershell -File deploy\scripts\deploy_release.ps1 -ReleaseName "..." -Cleanup
```

Mantém as 5 mais recentes (exceto ativa e anterior). **So use `-Cleanup` quando tiver certeza.**

---

## 10. Migracao real para `current` (requer OK expresso)

**Pre-requisitos:**

1. Migrar dados mutaveis da raiz legada para `shared/` (com backup)
2. Junctions locais OK (`finish-release-junctions.ps1`)
3. Validar release alvo

**Comandos no servidor (janela de indisponibilidade ~1–3 min):**

```powershell
# 1. Parar API legada
cd "C:\Sistemas CGraf\Sagra Web"
.\parar-api.bat

# 2. Ativar release (escolher staging ou outra validada)
powershell -File deploy\scripts\deploy_release.ps1 `
  -ReleaseName "staging_20260611_193049" `
  -Activate -ConfirmProductionSwitch -SkipBuild

# 3. Iniciar API a partir de current
cd "C:\Sistemas CGraf\Sagra Web\current"
.\iniciar-api.bat

# 4. Validar
curl http://127.0.0.1:8050/health
# Testar http://10.1.1.73/ e /sagra/api/
```

**NGINX:** provavelmente **nao** precisa reload (mesma porta 8050). Se alterar nginx.conf:

```bat
cd C:\nginx
nginx -t
nginx -s reload
```

---

## 11. Blue/green (futuro)

```
Porta 8051 = release A (atual)
Porta 8052 = release B (nova)
NGINX upstream sagra_backend alterna apos health check em B
```

Beneficio: zero downtime na troca de backend. Complexidade maior (duas instancias, sync de shared). Recomendado apos estabilizar o modelo releases/current/shared.

---

## 12. Scripts disponiveis

| Script | Funcao |
|--------|--------|
| `init-release-structure.ps1` | Cria pastas releases/shared/deploy |
| `prepare-shared.ps1` | Prepara shared, copia .env se ausente |
| `deploy_release.ps1` | Deploy principal |
| `rollback_release.ps1` | Rollback |
| `validate-release.ps1` | Validacao sem reiniciar servicos |
| `finish-release-junctions.ps1` | Junctions locais no servidor |
| `deploy-common.ps1` | Biblioteca compartilhada |

---

## 13. Worker Papelaria

O worker roda em maquinas separadas (`SAGRA-Papelaria-Worker.exe`) e comunica via API HTTP. **Nao e afetado** por esta estrutura, desde que a URL da API (`/sagra/api/`) permaneca a mesma.
