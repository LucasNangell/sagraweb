# SAGRA Web — Relatório de Auditoria e Contexto Executivo

**Workspace analisado:** `\\cgrafsysvm\s\SagraWeb`  
**Data da auditoria:** 26/05/2026  
**Escopo:** Análise de código, configuração, segurança, performance, frontend, stack e plano de reorganização (somente leitura — nenhum arquivo foi alterado ou excluído na auditoria).

---

## Contexto executivo

O **SAGRA** (Sistema de Acompanhamento Gráfico) é um sistema híbrido de controle de Ordens de Serviço (OS) para ambiente corporativo (Câmara/SEFOC), com:

| Camada | Tecnologia |
|--------|------------|
| Backend | Python 3.14, **FastAPI 7.0** (`routers/api.py`), Uvicorn `:8001` |
| Frontend | HTML/CSS/JS estático (MPA), jQuery, Select2 |
| Dados | **MySQL** `sagrafulldb` + **Microsoft Access** `.mdb` (dual-write) |
| Infra | Nginx `:80`, NSSM/PyInstaller, Cloudflare Tunnel (portal cliente) |
| Subprojeto | `web-orchestrator` (React + FastAPI) — separado do app principal |

O núcleo operacional está **funcional**, mas há **lacunas críticas de segurança**, **poluição estrutural na raiz** (~150+ arquivos soltos) e **funcionalidades referenciadas porém ausentes ou desconectadas**.

---

## 1. MAPEAMENTO COMPLETO DE FUNCIONALIDADES

| Funcionalidade / Módulo | Status Atual | Arquivos Relacionados | Diagnóstico rápido |
|-------------------------|--------------|----------------------|-------------------|
| **Painel OS (Início)** | Funcional com Ressalvas | `index.html`, `script.js`, `styles.css`, `routers/os_routes.py`, `permissions.js` | CRUD de OS, busca, histórico, vinculações. Middleware HTML ativo; API sem auth. `innerHTML` extensivo (XSS). |
| **Gerência** | Funcional com Ressalvas | `gerencia.html`, `gerencia.js`, `routers/os_routes.py`, `routers/auxiliar_routes.py` | Gestão operacional; depende de permissões por IP no frontend. |
| **E-mail / EWS** | Funcional com Ressalvas | `email.html`, `email.js`, `routers/email_routes.py`, `services/ews_service.py` | Integração Exchange via SSPI (Windows). Templates legados (`emailProvaOS.htm`). |
| **Análise de Qualidade** | Funcional com Ressalvas | `analise.html`, `analise.js`, `routers/analise_routes.py`, `report_service.py` | Fluxo completo com `html_snapshot` (risco XSS armazenado). Tokens cliente em `tabClientTokens`. |
| **Portal Cliente (PT/Proof)** | Incompleta ou Faltando Configuração | Referências em `routers/api.py`, `routers/analise_routes.py` | Middleware Cloudflare espera `client_pt.html` e `client_proof.html` — **arquivos não existem no workspace**. |
| **Papelaria** | Funcional com Ressalvas | `papelaria.html`, `papelaria.js`, `routers/papelaria_routes.py`, `routers/mdb_writer.py` | Modelos e preview; sync MDB. |
| **Configurações / Filtros Salvos** | Pronta para Produção | `settings.html`, `settings.js`, `routers/settings_routes.py` | CRUD de filtros; escopo menor. |
| **Relatórios Customizados** | Funcional com Ressalvas | `relatorio.html`, `relatorio.js`, `routers/report_custom_routes.py` | Geração via `report_service.py` / FPDF. |
| **Requisição (Impressão Ficha)** | Funcional com Ressalvas | `requisicao.html`, `routers/requisicao_routes.py` | PDF/barcode; permissão `ctx_imprimir_ficha`. |
| **Dashboard Setor** | Funcional com Ressalvas | `dashboard_setor.html`, `.css`, `.js`, `config_painel_global.json`, `dashboard/hub.py` | Painel em tempo real; cópias obsoletas na raiz (`dashboard_setor copy.*`). |
| **Dashboard Global** | Funcional com Ressalvas | `dashboard_global.html`, `.css`, `.js` | Exposto via Nginx em `/producao`; não no middleware `SCREEN_PERMISSIONS`. |
| **PCP (Fila de Produção)** | Funcional com Ressalvas | `pcp.html`, `pcp.js`, `pcp.css`, `routers/pcp_routes.py`, `pcp_queue_service.py` | Fila de produção; `sb_pcp` no RBAC. |
| **Gravação / Xpose Jobs** | Funcional com Ressalvas | `gravacao.html`, `gravacao.js`, `gravacao_ws_jobs.js`, `routers/gravacao_routes.py` | WebSocket `/api/ws/jobs`; `except: pass` em trechos. |
| **Usuários (Ponto)** | Funcional com Ressalvas | `usuarios.html`, `routers/user_routes.py`, `permissions.js` | Identificação só por ponto (sem senha). `localStorage`. |
| **RBAC por IP** | Funcional com Ressalvas | `routers/ip_admin_routes.py`, `admin_ips.html`, `permissions.js`, `js/access_guard.js` | HTML protegido; **API admin sem autenticação**. Fail-open no `catch` de `permissions.js`. |
| **Computadores Ativos** | Funcional com Ressalvas | `active_computers.html`, `routers/api.py` (`/api/connected-ips`) | Monitoramento de IPs; restrito a master no HTML. |
| **Notificações** | Funcional com Ressalvas | `routers/notifications_routes.py`, `script.js` | Badge no header; tabela criada em runtime. |
| **Realtime / WebSocket** | Funcional com Ressalvas | `routers/realtime.py`, `gravacao_ws_jobs.js` | Usuários online por ponto; Redis nas deps (uso a confirmar). |
| **Sync Access↔MySQL** | Pronta para Produção | `sync_andamentos_v2.py`, `sync_tables/*`, triggers em `schema_sagrafulldb.sql` | Motor central; logs ~234 MB cada. v3 é alternativa não ativa. |
| **Controle de Sync (UI)** | Incompleta ou Faltando Configuração | `controls/sync_control.html`, `controls/js/sync_control.js`, `routers/sync_routes.py` | **`sync_routes.py` não está registrado em `api.py`** — UI provavelmente inoperante. |
| **Folder Opener (Windows)** | Funcional com Ressalvas | `folder_opener_service.py`, `/api/download/folder-opener` | Abre pastas DFS; exe em `local_services/dist/`. |
| **Monitor de Pastas OS** | Funcional com Ressalvas | `monitor_os_changes.py`, `run_api.py` | Iniciado pelo supervisor; watchdog. |
| **Backup MySQL Rotativo** | Funcional com Ressalvas | `mysql_backup_rotativo.py`, `criar_tarefa_backup_mysql.bat` | Scripts OK; **`backup_23.sql` (~9,6 GB) na raiz web**. |
| **Recovery DB** | Funcional com Ressalvas | `recovery.py` | Credenciais hardcoded; uso administrativo. |
| **Launcher / Serviços Windows** | Pronta para Produção | `launcher.py`, `launcher_gui.pyw`, `run_api.py`, `iniciar_sagra.bat`, `NSSM_SERVICOS.md`, `dist/*.exe` | Stack de deploy madura. |
| **Orchestrator Desktop (Qt)** | Funcional com Ressalvas | `orchestrator/` | PySide6; gestão de serviços locais. |
| **Web-Orchestrator (React)** | Incompleta ou Faltando Configuração | `web-orchestrator/backend/`, `web-orchestrator/frontend/` | Subprojeto moderno **desacoplado** do SAGRA principal. |
| **Nginx Multi-sistema** | Funcional com Ressalvas | `nginx/conf/nginx.conf` | SAGRA + OBS + Apogee; **`location /api` → porta 4040 (OBS)** conflita conceitualmente com SAGRA `:8001`. |
| **API Legada Monolítica** | Incompleta ou Faltando Configuração | `server.py` (~94 KB) | Substituída por `routers/*`; **não referenciada** em `main.py`/`run_api.py`. Risco de confusão. |
| **Auxiliares / Lookups** | Pronta para Produção | `routers/auxiliar_routes.py` | Setores, situações, deputados, etc. |
| **MDB Writer (Dual-write)** | Funcional com Ressalvas | `routers/mdb_writer.py` | Escrita Access após MySQL; ponto de falha se MDB indisponível. |

---

## 2. AUDITORIA DE SEGURANÇA E ROBUSTEZ (DevSecOps)

### 2.1 Vulnerabilidades e falhas

| ID | Achado | Classificação | Detalhe técnico |
|----|--------|---------------|-----------------|
| S1 | **Credenciais em texto claro** | **[CRÍTICO]** | `config.json`, `config_manager.py` (defaults), `config.yaml`, `recovery.py`, `dist/config.json` expõem `db_password`. Inconsistência `sefoc_2018` vs `Sefoc_2018`. |
| S2 | **Dump completo do banco na raiz web** | **[CRÍTICO]** | `backup_23.sql` (~9,6 GB) servido via `StaticFiles(directory=".")` — download trivial se Nginx/Uvicorn expuser a raiz. |
| S3 | **API `/api/*` sem autenticação** | **[CRÍTICO]** | `AccessControlMiddleware` ignora `/api/` explicitamente. Qualquer host na LAN pode chamar `/api/admin/ip/*`, `/api/os/save`, etc. |
| S4 | **Endpoints admin sem verificação de IP/master** | **[CRÍTICO]** | `list_ips`, `add_ip`, `update_ip`, `delete_ip` em `ip_admin_routes.py` — zero `Depends` de auth. |
| S5 | **SQL Injection potencial** | **[ALTO]** | `os_routes.py` L673: `cursor.execute(f"SELECT ... LIKE '{base_prefix}%'")` — `id`/`ano` são int na rota, mas padrão frágil. |
| S6 | **CORS permissivo** | **[ALTO]** | `allow_origins=["*"]` + `allow_credentials=True` — combinação incorreta segundo spec e facilita abuso cross-origin. |
| S7 | **Fail-open em permissões frontend** | **[ALTO]** | `permissions.js` L39-43: em erro de rede, `getAllPermissionsTrue()` concede **todas** as permissões (contradiz L26-30 para HTTP error). |
| S8 | **Identificação sem senha** | **[ALTO]** | Login = ponto em `localStorage`; `/api/users/identify` cria/atualiza usuário sem prova de identidade. |
| S9 | **XSS armazenado/refletido** | **[ALTO]** | `html_snapshot` persistido em `tabProblemasPadrao` / análise; renderização via `innerHTML` em `script.js`, `analise.js`, `usuarios.html`. |
| S10 | **Exposição de arquivos sensíveis via StaticFiles** | **[ALTO]** | Mount `"/"` → diretório raiz inclui `config.json`, logs, `.sql`, possivelmente `venv/`. |
| S11 | **Sem CSRF** | **[MÉDIO]** | POSTs JSON sem token CSRF; mitigado parcialmente por rede interna, insuficiente se houver browser na LAN. |
| S12 | **IP spoofing via X-Forwarded-For** | **[MÉDIO]** | Middleware confia em `XFF` quando IP é `127.0.0.1` — risco se proxy mal configurado. |
| S13 | **Portal cliente incompleto** | **[MÉDIO]** | Páginas `client_pt.html` / `client_proof.html` ausentes; tokens gerados mas UX quebrada. |
| S14 | **Logs gigantes com dados operacionais** | **[MÉDIO]** | `sync_andamentos.log`, `synlog.txt` (~234 MB) podem conter IDs, paths, erros de DB. |
| S15 | **Colisão Nginx `/api`** | **[MÉDIO]** | `nginx.conf` encaminha `/api` para OBS `:4040`, não SAGRA `:8001` — comportamento depende de ordem/alias. |
| S16 | **Dependências Flask legadas** | **[BAIXO]** | `flask`, `flask-socketio` em `requirements.txt` sem uso aparente no entry point atual. |
| S17 | **Debug logs na raiz** | **[BAIXO]** | `access_debug.log`, `server_debug.log` com IPs e paths. |

### 2.2 Tratamento de erros e logging

| Padrão | Onde | Risco |
|--------|------|-------|
| `except: pass` silencioso | `analise_routes.py`, `papelaria_routes.py`, `gravacao_routes.py` | Falhas ignoradas; difícil diagnóstico |
| MySQL OK, MDB falha → warning | `os_routes.py` save | **Divergência de dados** entre MySQL e Access |
| Pool esgotado → Exception genérica | `database.py` | Sem métricas/alertas |
| `startup_db_check` com try/except | `api.py` | Falha de DDL silenciosa no log |
| Transações com rollback | `database.py` `execute_transaction` | Bom padrão onde usado |

**Recomendação imediata (sem reescrever stack):** middleware de API com validação de IP/permissão espelhando o HTML; mover secrets para variáveis de ambiente; bloquear servir `.sql`, `config.json`, `venv/`; corrigir fail-open; proteger rotas admin.

---

## 3. PERFORMANCE, LÓGICA E OTIMIZAÇÃO DE PROCESSOS

### 3.1 Gargalos identificados

| Área | Problema | Impacto |
|------|----------|---------|
| **Raiz como document root** | `StaticFiles(".")` serve tudo | I/O alto; risco de servir GB de SQL |
| **Logs monolíticos** | 234 MB+ sem rotação aparente no app | Disco cheio; lentidão em leitura |
| **Pool MySQL fixo (10)** | `database.py` | Contenção sob pico (muitas telas + sync) |
| **Dual-write MySQL+MDB** | Cada save de OS | Latência 2x; lock no Access |
| **Busca OS com SQL dinâmico** | `os_routes.py` `search_os` | Queries complexas; validar índices (`indexes.txt` sugere preocupação) |
| **Re-render `innerHTML` em tabelas** | `script.js` | Reflow custoso em listas grandes |
| **Sync contínuo** | `sync_andamentos_v2.py` | CPU/IO constante no MDB de rede `I:\` |
| **Hash cache pickle** | `sagra_hash_cache.pkl` (~1,4 MB) | Pode desatualizar; invalidação manual |
| **Backup na pasta web** | `backup_23.sql` | 9,6 GB prejudica backup/deploy |

### 3.2 APIs e endpoints

**Pontos positivos:** modularização em `routers/`; uso predominante de `%s` parametrizado; middleware No-Cache em `/api/`; health check `/health`.

**Pontos negativos:**
- Rotas admin e de escrita sem rate-limit nem auth.
- `sync_routes.py` implementado mas **não montado** — dead code.
- `server.py` duplica lógica (manutenção dobrada se alguém executar por engano).
- Nginx não proxy explícito para SAGRA `:8001` no trecho analisado (depende de acesso direto ao IP).

---

## 4. ANÁLISE DE CORREÇÃO VISUAL, LAYOUT E ESTRUTURA (FRONTEND)

### 4.1 Pontos positivos

- Design system com CSS variables (`--primary-green`, `--secondary-blue`) em `styles.css`.
- Tipografia consistente (Open Sans, Roboto via Google Fonts).
- Font Awesome 6.4 para ícones.
- Header/sidebar padronizados entre páginas principais.
- Overlay de login unificado.

### 4.2 Problemas de UX/UI

| Problema | Evidência | Sugestão |
|----------|-----------|----------|
| **Duplicação CSS/JS por página** | `gerencia.js`, `analise.js`, etc. separados | Extrair componentes compartilhados (mesmo em vanilla modular) |
| **Admin visível no DOM** | `index.html` L74-76 links `admin_ips.html` | Ocultar server-side ou não renderizar HTML |
| **Cópias de dashboard** | `dashboard_setor copy.html` | Confusão para usuários/desenvolvedores |
| **Fonte base 12px** | `styles.css` | Legibilidade baixa em monitores 4K |
| **`overflow: hidden` no body** | `styles.css` | Scroll problemático em telas pequenas |
| **Dependência CDN** | Google Fonts, Font Awesome | Falha offline em rede restrita |
| **Responsividade limitada** | Layout flex fixo 80px header | Mobile/tablet não priorizado |
| **Permissões só no cliente** | `permissions.js` | Usuário técnico contorna via DevTools |
| **Páginas email legadas** | `emailfinal.html`, cópias | Fluxo de email fragmentado |

### 4.3 Componentização

Não há framework SPA no app principal. jQuery + Select2 são usados pontualmente. Para evolução incremental: **Web Components** ou migração parcial de módulos críticos (painel OS, análise) sem reescrever tudo.

---

## 5. ESTUDO DE VIABILIDADE E MIGRAÇÃO DE STACK

### 5.1 Stack atual

```
[Browser] → [Nginx :80] → [Uvicorn/FastAPI :8001] → [MySQL]
                              ↓
                         [pyodbc → Access MDB]
                              ↓
                         [Sync loop / Triggers]
```

### 5.2 Stack recomendada (evolução, não big-bang)

| Camada | Atual | Recomendado (futuro) |
|--------|-------|----------------------|
| API | FastAPI (manter) | FastAPI + **Pydantic v2** rigoroso + OpenAPI |
| Auth | IP + ponto | **JWT/session** + IP como camada extra + AD/LDAP opcional |
| Frontend | HTML/JS | **React/Next.js** ou **Vue** para módulos novos; manter legado via iframe/micro-frontends |
| DB | MySQL + Access | **MySQL como source of truth**; Access como export legado até descomissionar |
| Deploy | PyInstaller + NSSM | **Docker** (se política permitir) ou manter NSSM com `.env` |
| Realtime | WebSocket raw | **Socket.IO** ou WS com Redis pub/sub (já há dep `redis`) |

### 5.3 Prós e contras

| | Stack atual | Stack moderna |
|--|-------------|---------------|
| **Prós** | Funciona no ambiente Windows legado; equipe conhece fluxo; dual-write com Access; deploy .exe | Tipagem, testes, componentização, auth padrão, CI/CD |
| **Contras** | Segurança por obscuridade (IP); raiz poluída; sem testes automatizados visíveis; XSS; 2 codebases (`server.py` + routers) | Esforço alto; risco em dual-write Access; curva de treinamento |

### 5.4 Ganhos reais

- **Performance:** 15–30% em UX (SPA + cache API), maior ganho ao **eliminar dual-write síncrono** e sync otimizado.
- **Escalabilidade:** FastAPI já escala; gargalo é Access em rede + pool 10.
- **Segurança:** Auth na API → maior ROI que trocar React.
- **Manutenção:** Reorganização + remover `server.py` > reescrita total.

### 5.5 Análise de esforço

| Abordagem | Esforço | Veredicto |
|-----------|---------|-----------|
| **Refatorar ao máximo na stack atual** | 3–6 meses (1–2 devs) | **Recomendado como Fase 1** — segurança, estrutura, desacoplar Access |
| **Reescrever em Next.js + FastAPI** | 12–18 meses | Só se Access for descontinuado e requisitos estabilizados |
| **Híbrido** | 6–9 meses | **Melhor custo/benefício:** API FastAPI endurecida + frontend novo módulo a módulo |

**Conclusão:** Não reescrever do zero agora. O backend FastAPI modular é base sólida; o problema principal é **segurança, organização e dependência Access**, não a ausência de React.

---

## 6. PLANO DE REORGANIZAÇÃO DE ARQUIVOS (Faxina Estrutural)

> **Regra:** mover para `/legacy_or_unused/`, **nunca deletar**.

### 6.1 Arquivos obsoletos / não utilizados (candidatos a `legacy_or_unused/`)

**Backend legado e duplicatas**
- `server.py`
- `sync_andamentos_v3.py`, `sync_andamentos_v2 copy.py`
- `run_api copy.py`
- `routers/email_routes_backup.py`
- `updateprotocolos copy.py`
- `sagraweb_server.spec`

**Configs deprecados**
- `config.yaml`, `configmdb.yaml`, `sync_tables/sync_conf.yaml` (se confirmado deprecated)

**Frontend obsoleto**
- `dashboard_setor copy.html`, `dashboard_setor copy.css`, `dashboard_setor copy.js`
- `emailfinal.html`, `emailfinal copy 2.html`

**Scripts de debug/teste/check (40+ arquivos)**
- `debug_*.py`, `test_*.py`, `check_*.py`, `teste.py`, `force_error*.py`, `simOBS.py`, etc.

**Logs e dumps (mover para fora da web root)**
- `backup_23.sql` → `data/backups/` (não servir via HTTP)
- `sync_andamentos.log`, `synlog.txt` → `logs/sync/`
- `access_debug.log`, `server_debug.log`, `monitor_debug.log`

**Artefatos de build**
- `__pycache__/` na raiz
- Arquivos soltos em `build/` já organizados

**Dependências não usadas no runtime**
- Referências Flask (documentar remoção futura em `requirements.txt`)

**Funcionalidade desconectada**
- `routers/sync_routes.py` (até ser registrado ou arquivado)

### 6.2 Árvore de diretórios recomendada

```
SagraWeb/
├── app/                          # Código de aplicação
│   ├── backend/
│   │   ├── main.py               # Entry Uvicorn
│   │   ├── run_api.py            # Supervisor
│   │   ├── database.py
│   │   ├── config_manager.py
│   │   └── routers/              # Todos os *_routes.py
│   ├── frontend/
│   │   ├── pages/                # *.html
│   │   ├── assets/
│   │   │   ├── css/
│   │   │   ├── js/
│   │   │   └── img/
│   │   └── lib/                  # jquery, select2
│   └── services/                 # sync, ews, folder_opener, monitor
├── config/
│   ├── config.json               # Sem senha (usar env)
│   ├── config.example.json
│   └── config_painel_global.json
├── data/
│   ├── backups/                  # backup_23.sql, dumps
│   └── cache/                    # sagra_hash_cache.pkl
├── deploy/
│   ├── nginx/
│   ├── bat/                      # iniciar_sagra, NSSM
│   ├── spec/                     # PyInstaller .spec
│   └── dist/
├── docs/
│   ├── NSSM_SERVICOS.md
│   └── Implementações/
├── legacy_or_unused/             # Tudo obsoleto listado acima
├── logs/
├── orchestrator/                 # Desktop Qt (inalterado)
├── web-orchestrator/             # Subprojeto React
├── sync_tables/
├── scripts/                      # setup_*, fix_*, one-off migrations
├── tests/
├── venv/                         # Fora do git e do StaticFiles
└── README.md
```

**Crítico:** alterar `StaticFiles` para servir apenas `app/frontend/`, nunca a raiz inteira.

---

## 7. PLANO DE IMPLEMENTAÇÃO PASSO A PASSO (Ação)

### Milestone 0 — Contenção de segurança (Semana 1–2)

| Passo | O que fazer | Arquivos impactados | Impacto |
|-------|-------------|---------------------|---------|
| 0.1 | Mover `backup_23.sql` e dumps para `data/backups/`; bloquear extensões `.sql`, `.json` de config no static | `routers/api.py`, Nginx | **[CRÍTICO]** elimina vazamento de DB |
| 0.2 | Rotacionar senha MySQL; remover de `config.json`; usar env vars | `config.json`, `config_manager.py`, `database.py`, NSSM scripts | Reduz exposição de credenciais |
| 0.3 | Middleware `APIAccessMiddleware` validando IP + permissão em **todas** rotas `/api/` exceto `/health`, `/api/client/*` com token | `routers/api.py`, novo `routers/auth_middleware.py` | Fecha bypass LAN |
| 0.4 | Proteger `/api/admin/*` — apenas MASTER_IP | `routers/ip_admin_routes.py` | Impede takeover de RBAC |
| 0.5 | Corrigir fail-open em `permissions.js` | `permissions.js` | Alinha frontend com política deny |

### Milestone 1 — Estabilidade e dados (Semana 3–5)

| Passo | O que fazer | Arquivos | Impacto |
|-------|-------------|----------|---------|
| 1.1 | Corrigir SQL f-string em `add_os_history` | `routers/os_routes.py` | Elimina vetor SQLi |
| 1.2 | Sanitizar `html_snapshot` (bleach/DOMPurify server-side) | `analise_routes.py`, frontend | Reduz XSS |
| 1.3 | CORS: lista explícita de origens internas | `routers/api.py` | Hardening |
| 1.4 | Política dual-write: fila assíncrona MDB ou flag de retry | `os_routes.py`, `mdb_writer.py` | Menos divergência MySQL/Access |
| 1.5 | Rotação de logs (`logging.handlers.RotatingFileHandler`) | sync scripts, API | Disco estável |

### Milestone 2 — Reorganização estrutural (Semana 6–8)

| Passo | O que fazer | Arquivos | Impacto |
|-------|-------------|----------|---------|
| 2.1 | Criar `legacy_or_unused/` e mover lista da §6.1 | ~80 arquivos raiz | Manutenibilidade |
| 2.2 | Reestruturar pastas conforme §6.2 | imports, `main.py`, bats | Deploy mais claro |
| 2.3 | Ajustar `StaticFiles` para `app/frontend` only | `api.py` | Performance + segurança |
| 2.4 | Documentar entry point único (`routers.api:app`) | README, remover refs a `server.py` | Menos regressões |

### Milestone 3 — Funcionalidades incompletas (Semana 9–11)

| Passo | O que fazer | Arquivos | Impacto |
|-------|-------------|----------|---------|
| 3.1 | Criar `client_pt.html` / `client_proof.html` ou remover refs | novos HTML + `analise_routes.py` | Portal cliente operacional |
| 3.2 | Registrar `sync_routes` OU remover UI `sync_control` | `api.py`, `controls/` | Controle sync funcional |
| 3.3 | Mapear telas faltantes no middleware (`gravacao`, `pcp`, `usuarios`, `dashboard_global`) | `api.py` `SCREEN_PERMISSIONS` | RBAC HTML completo |
| 3.4 | Revisar Nginx: proxy SAGRA `/sagra/api` vs OBS `/api` | `nginx/conf/nginx.conf` | Elimina colisão de rotas |

### Milestone 4 — Qualidade e observabilidade (Semana 12–16)

| Passo | O que fazer | Arquivos | Impacto |
|-------|-------------|----------|---------|
| 4.1 | Testes pytest para rotas críticas (OS save, permissions, tokens) | `tests/` | Regressão controlada |
| 4.2 | Substituir `except: pass` por log + métricas | routers diversos | Debug em produção |
| 4.3 | Aumentar pool ou usar async se carga crescer | `database.py` | Throughput API |
| 4.4 | OpenAPI documentado + validação Pydantic estrita | todos routers | Contratos claros |

### Milestone 5 — Evolução frontend (Mês 5+, opcional)

| Passo | O que fazer | Impacto |
|-------|-------------|---------|
| 5.1 | Extrair design tokens e CSS compartilhado | Consistência visual |
| 5.2 | Módulo piloto React em `web-orchestrator` integrado ao painel OS | Validação de migração |
| 5.3 | Auth corporativa (AD) no `/api/users/identify` | Identidade real |

---

## Resumo de prioridades

| Prioridade | Ação |
|------------|------|
| **P0** | Remover `backup_23.sql` da web root; auth em `/api/admin/*` e rotas de escrita |
| **P1** | Corrigir `permissions.js` fail-open; CORS; SQL f-string |
| **P2** | Faxina `legacy_or_unused/`; StaticFiles restrito |
| **P3** | Portal cliente; sync control; Nginx |
| **P4** | Migração frontend gradual (não reescrita total) |

---

## Referência técnica rápida

| Área | Caminho principal |
|------|-------------------|
| API canônica | `\\cgrafsysvm\s\SagraWeb\routers\api.py` |
| Camada DB | `\\cgrafsysvm\s\SagraWeb\database.py` |
| Config/secrets | `\\cgrafsysvm\s\SagraWeb\config.json`, `config_manager.py` |
| RBAC IP | `\\cgrafsysvm\s\SagraWeb\routers\ip_admin_routes.py` |
| API legada | `\\cgrafsysvm\s\SagraWeb\server.py` |
| Schema/triggers | `\\cgrafsysvm\s\SagraWeb\schema_sagrafulldb.sql` |
| Bridge MDB | `\\cgrafsysvm\s\SagraWeb\routers\mdb_writer.py` |
| Sync engine | `\\cgrafsysvm\s\SagraWeb\sync_andamentos_v2.py` |
| Reverse proxy | `\\cgrafsysvm\s\SagraWeb\nginx\conf\nginx.conf` |
| Startup serviços | `\\cgrafsysvm\s\SagraWeb\iniciar_sagra.bat`, `run_api.py` |

---

*Documento gerado a partir da auditoria técnica do workspace SagraWeb. Uso recomendado: alinhamento de equipe, planejamento de milestones e base para decisões de arquitetura.*
