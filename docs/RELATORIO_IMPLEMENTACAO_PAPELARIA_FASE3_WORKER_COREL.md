# Relatório — Implementação Papelaria Fase 3 (Worker Windows CorelDRAW)

**Data:** 10/06/2026  
**Referências:** Fases 1–2, `docs/AUDITORIA_FUNCIONALIDADE_PAPELARIA_CORELDRAW.md`

---

## 1. Objetivo da fase

Implementar o **worker Windows** que processa jobs `pending` da fila `tabPapelariaJobs` usando **CorelDRAW COM** em máquina dedicada, com APIs autenticadas por secret e integração com a UI existente.

**Não implementado no servidor:** CorelDRAW, COM, geração de arquivos.

---

## 2. Arquivos criados

| Arquivo | Descrição |
|---------|-----------|
| `app/backend/security/papelaria_worker_auth.py` | Auth `X-Sagra-Worker-Secret` + `hmac.compare_digest` |
| `app/backend/routers/papelaria_worker_routes.py` | Endpoints heartbeat, claim, complete, fail, log |
| `worker/papelaria_worker/worker.py` | Loop principal do worker |
| `worker/papelaria_worker/corel_generator.py` | Lógica Corel extraída de `papelaria.py` |
| `worker/papelaria_worker/api_client.py` | Cliente HTTP |
| `worker/papelaria_worker/config.py` | Loader YAML |
| `worker/papelaria_worker/config.example.yaml` | Configuração de exemplo |
| `worker/papelaria_worker/requirements.txt` | Dependências worker |
| `worker/papelaria_worker/README.md` | Guia de instalação/operação |
| `app/backend/tests/test_papelaria_worker.py` | 10 testes worker/API |
| `worker/papelaria_worker/tests/test_corel_utils.py` | 5 testes utilitários (sem COM) |
| `docs/RELATORIO_IMPLEMENTACAO_PAPELARIA_FASE3_WORKER_COREL.md` | Este relatório |

---

## 3. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `app/backend/services/papelaria_jobs_service.py` | claim, complete, fail, heartbeat, paths OS, nomes de saída |
| `app/backend/security/api_auth.py` | Bypass middleware para rotas worker com secret |
| `app/backend/routers/api.py` | Registro `papelaria_worker_routes` |
| `app/backend/routers/papelaria_routes.py` | PDF inline, CDR attachment no download |
| `apps/web/.../PapelariaCorelPanel.tsx` | Links PDF/CDR quando `completed` |
| `config/.env.example` | Documentação `SAGRA_PAPELARIA_WORKER_SECRET` |

**Não alterado:** `config/.env` de produção, aba SVG, servidor em execução.

---

## 4. Endpoints worker (secret)

Header: `X-Sagra-Worker-Secret`  
Env servidor: `SAGRA_PAPELARIA_WORKER_SECRET`

| Método | Rota | Função |
|--------|------|--------|
| `POST` | `/api/papelaria/worker/heartbeat` | Registra worker ativo |
| `POST` | `/api/papelaria/jobs/claim` | Claim atômico `pending` → `processing` |
| `POST` | `/api/papelaria/jobs/{id}/complete` | Marca `completed` + paths relativos |
| `POST` | `/api/papelaria/jobs/{id}/fail` | Marca `failed` ou reenfileira se retryable |
| `POST` | `/api/papelaria/jobs/{id}/log` | Append log do worker |

Sem secret → **401**. Sem sessão humana necessária.

### Claim atômico

Transação MySQL com `SELECT ... FOR UPDATE` + `UPDATE` condicional em `Status='pending'`.

Payload retornado inclui: `job_id`, OS, `campos`, `dados`, `output_dir` (interno), `output_cdr_name`, `output_pdf_name`.

---

## 5. Resolução de pasta e destino

- Pasta OS via `_get_os_folder_path` (padrão rede CGraf)
- Destino: `{pasta_os}/Sefoc/Papelaria/` — criada se ausente (`resolve_os_papelaria_dir`)
- Nomes seguros: `OS{nro}_{ano}_{produto}_{nome}_Gab{xxx}_{cores}_job{id}`
- Colisão: sufixos `_v2`, `_v3` ou `_extra`
- Banco guarda **apenas nome relativo** (`ArquivoCdrGerado`, `ArquivoPdfGerado`)

---

## 6. Worker Windows

### Configuração externa (`config.yaml`)

Ver `worker/papelaria_worker/config.example.yaml`.

### Fluxo por job

1. Heartbeat
2. Claim
3. Localiza `.cdr` em `models_dir`
4. Cópia para `temp_dir/job_{id}/`
5. Corel COM — aplica campos, `doc.Save()`, `PublishToPDF`
6. Grava em `output_dir` (UNC da OS)
7. `complete` ou `fail`
8. Limpa temp

### Proteções

- Um job por vez no loop
- Cópia do modelo — nunca salva no original
- Timeout por job (`job_timeout_sec`, ThreadPoolExecutor)
- `CoInitialize` / `CoUninitialize`
- Documento sempre fechado no `finally`

---

## 7. Integração UI

- `complete` / `fail` emitem `papelaria_job_update` (WebSocket)
- UI faz polling (5s job ativo, 12s histórico)
- `completed`: botões **Abrir PDF** (inline) e **Baixar CDR** (attachment)
- `failed`: exibe `erro` do job

---

## 8. Download seguro

`GET /api/papelaria/jobs/{id}/arquivo/{tipo}`

- Sessão + `sb_papelaria`
- Job `completed`
- Path traversal bloqueado
- PDF: `Content-Disposition: inline`
- CDR: `Content-Disposition: attachment`
- Frontend recebe só URL da API — sem UNC

---

## 9. Testes executados

| Cenário | Resultado |
|---------|-----------|
| Worker sem secret → 401 | OK |
| Heartbeat com secret | OK |
| Claim atômico | OK |
| Complete → completed | OK |
| Fail → failed | OK |
| Worker errado não completa | OK |
| Nome de saída seguro | OK |
| Utilitários Corel (sem COM) | OK |

### Comandos

| Comando | Resultado |
|---------|-----------|
| `pnpm test:backend` | **258 passed** (+10) |
| `python -m pytest worker/papelaria_worker/tests` | **5 passed** |
| `pnpm test:frontend` | **124 passed** |
| `pnpm build` | OK |
| `pnpm lint` | OK |
| `pnpm typecheck` | Falha pré-existente TS6310 |

---

## 10. Como colocar em operação

1. No servidor: definir `SAGRA_PAPELARIA_WORKER_SECRET` em `config/.env` (mesmo valor do worker)
2. Na máquina Corel: copiar `config.example.yaml` → `config.yaml`
3. `pip install -r requirements.txt`
4. `python worker.py --test-connection`
5. `python worker.py --config config.yaml`

Detalhes: `worker/papelaria_worker/README.md`

---

## 11. Próxima fase (sugestões)

- Serviço Windows (NSSM / Task Scheduler)
- Recuperação automática de jobs `processing` órfãos (timeout servidor)
- Botão “Reprocessar” na UI (`JobPaiID` / nova versão)
- Métricas e painel admin de workers (heartbeats)
- Restrição opcional de download CDR por permissão extra

---

## Resultado esperado (atingido)

O servidor aceita jobs, o worker Windows busca jobs `pending`, gera `.cdr` e `.pdf` via CorelDRAW local, salva em `Sefoc/Papelaria` da OS e atualiza status para `completed` — visível na página `/papelaria` com links de download.
