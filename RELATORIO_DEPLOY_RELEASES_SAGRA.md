# Relatório — Deploy por Releases (SAGRA Web)

**Data:** 2026-06-11  
**Escopo:** Auditoria pré-implementação (sem troca de produção)

---

## 1. Estrutura DEV (`C:\dev\SagraWeb`)

Monorepo pnpm: backend FastAPI em `app/backend`, SPA React em `apps/web`, pacote de produção gerado em `deploy/release`.

| Área | Caminho |
|------|---------|
| Backend | `app/backend/` — entry `routers.api:app` |
| Frontend fonte | `apps/web/` — build Vite → `apps/web/dist/` |
| Frontend servido | `app/frontend/` (cópia do dist no deploy) |
| Worker Papelaria | `worker/papelaria_worker/` — máquinas separadas, **não afetado pelo deploy do servidor** |
| Config | `config/config.json`, `config/.env` |
| Deploy legado | `deploy-producao.bat` → robocopy `/MIR` na raiz de produção |

---

## 2. Estrutura PROD legada (`\\cgrafsysvm\Sistemas CGraf\Sagra Web`)

Espelho de `deploy/release/` + artefatos de runtime:

- `app/backend`, `app/frontend`, `app/services`
- `config/` (`.env` ~1,2 KB, `config.json` produção)
- `logs/`, `storage/`, `storage_client_uploads/`, `storage_test/`, `Modelos/`
- `python_pkgs/`, `wheels/`
- `iniciar-api.bat` — Uvicorn `127.0.0.1:8050`
- Sync MDB: `sync_andamentos_v2.py` na raiz

**Problema atual:** `deploy-producao.ps1` usa robocopy `/MIR` diretamente na pasta em uso → arquivos bloqueados, necessidade de parar API durante cópia.

---

## 3. Código vs dados mutáveis

### Versionado (entra em releases)

- `app/backend`, `app/services`, `app/frontend` (dist)
- `scripts/`, `sql/`, `nginx/` (referência), `python_pkgs/`, `wheels/`
- `requirements*.txt`, bats de lifecycle, templates `config.example.json`

### Mutável (fica em `shared/`, NUNCA sobrescrito pelo deploy)

| Pasta/arquivo | Função |
|---------------|--------|
| `config/.env` | Segredos produção (DB, EWS, tokens) |
| `config/config.json` | Config servidor (porta 8050, URLs) |
| `logs/` | `api/sagra_api.log`, sync |
| `storage/` | `analise_indications/`, `papelaria_svg/` |
| `storage_client_uploads/` | Uploads portal |
| `storage_test/` | Testes |
| `Modelos/` | PDFs, previews PNG uploadados |
| `recovery_temp/` | Recovery MySQL (ops) |
| Sync logs raiz | `sync_andamentos.log`, `synlog.txt` |

**Cuidado:** `shared/` foi criado com cópia de `.env` e `config.json` da raiz legada. Pastas de dados (`storage`, `Modelos`, etc.) **ainda estão na raiz legada** — migração para `shared/` somente após backup e autorização.

---

## 4. Inicialização do backend

- **Dev:** `iniciar-servidor.bat` → uvicorn `:8001` + Vite `:5173`
- **Prod:** `iniciar-api.bat` na raiz do pacote → uvicorn `127.0.0.1:8050` com `--proxy-headers`
- **Sem serviço Windows/NSSM** — processo via CMD/bat manual ou detached
- `PROJECT_ROOT` = pasta do `iniciar-api.bat` (`config_manager.py` parents[2])

---

## 5. Frontend

- Build Vite com `VITE_BASE_PATH=/`, `VITE_API_PREFIX=/sagra/api`
- **NGINX não serve arquivos estáticos** — todo tráfego `/` vai para Uvicorn (SPA + API)
- Fallback SPA tratado pelo FastAPI (`_register_spa_shell_routes`)

---

## 6. NGINX (`\\cgrafsysvm\nginx\conf\nginx.conf`)

- `upstream sagra_backend { server 127.0.0.1:8050; }`
- `/sagra/api/` → proxy para Uvicorn
- `/` → proxy para Uvicorn (SPA)
- **Sem `root`/`alias` para Sagra** no config ativo
- **Impacto da migração:** NGINX **não precisa** mudar caminhos de disco; só a origem do processo Uvicorn muda para `current\`

---

## 7. Arquivos bloqueados durante execução

- `.py` carregados pelo Python (uvicorn --reload não usado em prod)
- `app/frontend/assets/*.js` se servidos pelo mesmo processo
- `logs/api/sagra_api.log` (handler rotativo)
- DLLs/arquivos em uso pelo processo Python

---

## 8. Decisões adotadas nesta etapa

| Decisão | Motivo |
|---------|--------|
| **`current` = junction local** + `deploy/current-release.txt` | Troca atômica; junction exige execução no servidor (`C:\Sistemas CGraf\Sagra Web`) |
| **Config (`.env`, `config.json`) = cópia de `shared/`** | Junction de arquivo não funciona via UNC; shared é fonte da verdade |
| **Dirs mutáveis = junction para `shared/`** | logs/storage/Modelos sobrevivem entre releases |
| **Deploy para `releases/{nome}`** | Cópia sem tocar raiz legada nem release ativa |
| **Ativação bloqueada** sem `-ConfirmProductionSwitch` | Produção não alterada nesta etapa |

---

## 9. Releases criadas (validação)

| Release | Origem | Status |
|---------|--------|--------|
| `initial_20260611_192811` | Snapshot produção legada | Integridade OK |
| `staging_20260611_193049` | Pacote DEV (`deploy/release`) | Integridade OK, não ativada |

**Produção legada:** continua ativa na raiz. `current/` e `current-release.txt` **não** apontam para nova estrutura.

---

## 10. Health check

- Existente: `GET /health` (DB ping)
- Ampliado: retorna `release` e `deployed_at` quando `RELEASE.txt` presente na release

---

## 11. Evolução futura (blue/green)

Documentado em `GUIA_DEPLOY_RELEASES_SAGRA.md`: API em duas portas (8051/8052), NGINX alterna upstream após health check — **não implementado nesta etapa**.
