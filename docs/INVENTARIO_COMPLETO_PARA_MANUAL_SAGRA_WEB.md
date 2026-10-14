# INVENTÁRIO COMPLETO PARA MANUAL SAGRA WEB

**Projeto:** SAGRA Web (`C:\dev\SagraWeb`)  
**Data da auditoria:** 09/06/2026  
**Escopo:** Análise somente leitura — nenhum código, configuração de produção, banco ou servidor foi alterado.  
**Objetivo:** Base documental para criação posterior de:
1. Manual técnico (analistas/desenvolvedores)
2. Manual operacional (usuário final)

**Legenda de confiança:**
- **[CERTO]** — confirmado diretamente no código-fonte analisado
- **[INFERÊNCIA]** — deduzido a partir de padrões, documentação interna ou configuração de deploy
- **[NÃO IDENTIFICADO]** — não encontrado no código analisado

**Documentos relacionados já existentes:** `docs/INVENTARIO_COMPLETO_SISTEMA.md` (06/06/2026), `docs/PAGINA_CLIENTE.md`, `docs/PAGINA_PORTAL_PT_PROBLEMAS_TECNICOS.md`, `docs/MANUAL_COMPLETO_SAGRA_WEB.md`.

---

## 1. Visão Geral do Sistema

### 1.1 Identificação

| Item | Valor |
|------|-------|
| Nome | **SAGRA Web** — Sistema de Acompanhamento Gráfico |
| Organização | DEAPA / SEFOC / Câmara dos Deputados |
| Finalidade | Gerenciar o ciclo de vida de **Ordens de Serviço (OS)** gráficas: busca, criação, histórico, análise técnica, e-mail Exchange, papelaria, PCP, gravação, relatórios, painéis TV e portais para clientes (gabinetes/deputados) |
| Repositório principal | `C:\dev\SagraWeb` |
| Deploy produção | `\\cgrafsysvm\Sistemas CGraf\Sagra Web` **[CERTO]** |
| Proxy Nginx | `\\cgrafsysvm\nginx\conf\nginx.conf` **[CERTO]** |

### 1.2 Público-alvo e perfis

| Perfil | Autenticação | Onde acessa |
|--------|--------------|-------------|
| Operador LAN | Ponto + nome → cookie `sagra_session` | `/_authenticated/*` |
| Operador remoto | E-mail/ponto + senha → cookie `sagra_session` | `/_authenticated/*` via internet (`cgraf.online`) |
| MASTER / admin sistema | IP privilegiado + sessão | `/api/admin/*`, `/admin/ips`, `/admin/configuracoes` |
| Admin usuários | Permissão `sb_usuarios` + sessão | `/usuarios` |
| Cliente gabinete | E-mail + senha → cookie `sagra_cliente_session` | `/cliente/*` |
| Cliente anônimo (link) | Token na URL | `/portal/*` |
| Painel TV | Sem login (GET anônimo) | `/painel/setor`, `/painel/global` |

### 1.3 Estado geral do sistema **[CERTO]**

O sistema está em **migração de UI legada HTML/jQuery** (`app/frontend/`) para **SPA React 19** (`apps/web/`). O backend FastAPI permanece como camada única de API. Em produção, `mysql_only: true` e `sync_andamentos_enabled: false` — MySQL é a fonte da verdade; escrita em Access MDB e sync bidirecional estão desabilitados por padrão.

### 1.4 Módulos obrigatórios — status de mapeamento

| Módulo solicitado | Status | Rota / Router principal |
|-------------------|--------|-------------------------|
| Login interno | ✅ Mapeado | `/login/*` → `auth_routes.py` |
| Login do cliente | ✅ Mapeado | `/cliente/login/*` → `cliente_gabinete_routes.py` |
| Dashboard / Início | ✅ Mapeado | `/` → `OsHomePage` |
| Gerência | ✅ Mapeado | `/gerencia` → `os_routes.py` |
| Análise | ✅ Mapeado | `/analise` → `analise_routes.py` |
| E-mail | ✅ Mapeado | `/email` → `email_routes.py` |
| Portal do Cliente | ✅ Mapeado | `/cliente/*` → `cliente_gabinete_routes.py` |
| Portal Problemas Técnicos | ✅ Mapeado | `/portal/pt/$token` → `analise_routes.py` |
| Provas / Aprovação | ✅ Mapeado | `/portal/aprovacao/$token`, `/portal/prova/$token` → `proof_portal_routes.py` |
| Envio de arquivos | ✅ Mapeado | `/portal/os-arquivos/$token`, `/cliente/os/.../arquivos` → `os_arquivos_routes.py` |
| Contas do gabinete | ✅ Mapeado | `/cliente/contas` → `cliente_gabinete_routes.py` |
| Ordens de serviço | ✅ Mapeado | `/`, `/gerencia` → `os_routes.py` |
| Andamentos / timeline | ✅ Mapeado | `OsHistoryPanel`, `/api/cliente/os/.../andamentos` |
| Protocolos | ✅ Mapeado | Campos em `tabProtocolos`; lookup `/api/aux/protocolo/buscar` |
| Usuários / permissões | ✅ Mapeado | `/usuarios`, `/admin/ips` → `user_admin_routes.py`, `ip_admin_routes.py` |
| Relatórios | ✅ Mapeado | `/relatorios` → `report_custom_routes.py` |
| Pasta de rede | ✅ Mapeado | `os_folder_structure.py`, UNC em `config.json` |
| Google Drive | ✅ Código existe, desabilitado por padrão | `gdrive_portal_upload.py` |
| E-mail / EWS | ✅ Mapeado | `ews_service.py` |
| Sync MDB/MySQL | ✅ Código existe, desabilitado em produção | `sync_andamentos_v2.py`, `sync_routes.py` |
| Upload/download arquivos | ✅ Mapeado | `os_arquivos_routes.py`, `analise_routes.py` |
| Geração PDF | ✅ Mapeado | `pre_analise/`, `proof_files_service.py`, `requisicao_routes.py` |
| PCP | ✅ Mapeado | `/pcp` → `pcp_routes.py` |
| Gravação | ✅ Mapeado | `/gravacao` → `gravacao_routes.py` |
| Papelaria | ✅ Mapeado | `/papelaria` → `papelaria_routes.py` |
| Painéis TV | ✅ Mapeado | `/painel/*` |
| Sub-OS / componentes | ✅ Mapeado | `os_sub_os_routes.py` |
| Pré-análise automatizada | ✅ Mapeado | `pre_analise_routes.py` |
| Sync andamentos (UI admin) | ⚠️ Condicional | `sync_routes.py` — só registrado se `SYNC_ANDAMENTOS_ENABLED=true` |
| Computadores ativos | ⚠️ Sem rota React | Permissão `sb_active_computers` existe; página legada **[NÃO IDENTIFICADO]** em React |

---

## 2. Arquitetura Técnica

### 2.1 Stack **[CERTO]**

| Camada | Tecnologia | Versão / detalhe |
|--------|------------|------------------|
| Monorepo | pnpm workspaces | `pnpm-workspace.yaml` |
| Frontend | React + TypeScript + Vite | React 19, TS 5.7, Vite 6 |
| Roteamento front | TanStack Router | File-based; `routeTree.gen.ts` gerado |
| Estado servidor | TanStack Query v5 | `lib/query-client.ts` |
| Estado cliente | Zustand | 6 stores principais |
| Formulários | React Hook Form + Zod | |
| Estilo | Tailwind CSS v4 | + pacote `@sagra/ui` (shadcn-style) |
| PWA | vite-plugin-pwa + Workbox | `vite.config.ts` |
| Backend | FastAPI + Uvicorn | Python 3; porta dev `8001`, prod `8050` |
| Banco | MySQL (`sagrafulldb`) | PyMySQL pool — `database.py` |
| Legado dados | Microsoft Access MDB | Opcional via `mdb_writer.py` |
| Proxy | Nginx | `/sagra/api/` → backend `:8050` |
| Túneis | Cloudflare, zrok | Painéis e acesso externo |

### 2.2 Separação frontend / backend **[CERTO]**

```
Dev:  Vite :5173  ──proxy /api,/ws──►  FastAPI :8001
Prod: Nginx :80   ──/sagra/api/────►  FastAPI :8050
      Nginx       ──/ (SPA)────────►  app/frontend/ (build React)
```

Resolução de prefixo API no front: `apps/web/src/lib/api.ts` → `resolveSagraApiPrefix()` retorna `/api` (dev) ou `/sagra/api` (prod).

### 2.3 Padrões arquiteturais **[CERTO]**

| Padrão | Implementação |
|--------|---------------|
| Rotas API | Routers FastAPI em `app/backend/routers/` montados em `api.py` |
| Regras de negócio | `app/backend/services/` (57 módulos) |
| Contratos API | Pydantic em `app/backend/schemas/` + modelos inline nos routers |
| Acesso a dados | SQL raw via `database.execute_query` / `execute_transaction` — **sem ORM** |
| Auth API | Middleware `APIAccessMiddleware` (`security/api_auth.py`) — IP + sessão HttpOnly |
| Auth SPA | `AuthGuard` / `ClienteAuthGuard` + `GET /api/permissions` |
| Tempo real | WebSocket `/ws`, `/api/ws` — `routers/realtime.py` |
| Schema DB | `CREATE TABLE IF NOT EXISTS` no startup (`api.py`) + DDL em `deploy/sql/` |

### 2.4 Bibliotecas principais

**Frontend** (`apps/web/package.json`): `@tanstack/react-router`, `@tanstack/react-query`, `@tanstack/react-table`, `@tanstack/react-virtual`, `zustand`, `chart.js`, `pdfjs-dist`, `@dnd-kit/*`, `lucide-react`, `workbox-window`.

**Backend** (`app/backend/requirements.txt`): `fastapi`, `uvicorn`, `pydantic`, `PyMySQL`, `pyodbc`, `fpdf2`, `pymupdf`, `pytesseract`, `opencv-python-headless`, `pandas`, `Jinja2`, `bleach`, `requests-negotiate-sspi`, `google-api-python-client`, `python-dotenv`.

### 2.5 Ambientes **[CERTO / INFERÊNCIA]**

| Ambiente | Host | Porta API | URL pública |
|----------|------|-----------|-------------|
| Dev local | `10.1.1.73` | `8001` | `http://10.1.1.73:8001` |
| Produção (cgrafsysvm) | `10.1.1.73` / `cgrafsysvm` | `8050` | `http://cgrafsysvm` (Nginx) |
| Internet staff | Cloudflare | — | `cgraf.online` **[INFERÊNCIA]** |
| Painéis TV | zrok | — | `sagra-painel.shares.zrok.io` **[INFERÊNCIA — `iniciar-zrok-painel.bat`]** |

---

## 3. Estrutura de Pastas

```
C:\dev\SagraWeb\
├── apps\web\                    # SPA React (fonte principal UI)
│   └── src\
│       ├── routes\              # Rotas TanStack (file-based)
│       ├── features\            # Módulos de domínio (os, analise, email, cliente…)
│       ├── api\                 # Clientes HTTP + hooks React Query
│       ├── components\          # UI compartilhada (auth, layout, portal, pwa)
│       └── lib\                 # api.ts, query-client.ts, utilitários
├── packages\
│   ├── ui\                      # Componentes shadcn compartilhados
│   └── api-types\               # Tipos TS derivados de OpenAPI (planejado)
├── app\
│   ├── backend\                 # FastAPI — routers, services, security, schemas, tests
│   └── frontend\                # Build SPA + HTML legado (migração)
├── config\                      # config.json, .env, .env.example
├── deploy\                      # Scripts release, templates, SQL DDL
│   └── sql\                     # Migrations manuais (CREATE TABLE, índices)
├── docs\                        # Documentação (este arquivo e relatórios)
├── app\services\                # Scripts operacionais (sync, backup, monitor)
│   └── sync_tables\             # Sync MDB↔MySQL batch
├── logs\                        # Logs de runtime
├── ajuste_andamentos_os_antigas.py  # Script manutenção andamentos (MySQL only)
├── contexto_executivo.md        # Auditoria executiva anterior (parcialmente desatualizada)
└── package.json                 # Scripts monorepo (dev, build, deploy)
```

**Entry points críticos:**
- Front: `apps/web/src/main.tsx`
- Back: `app/backend/main.py` → `routers/api.py:app`
- Config: `app/backend/config_manager.py` lê `config/config.json` + `.env`

---

## 4. Mapa de Rotas Front-end

> Gerado a partir de `apps/web/src/routeTree.gen.ts` e arquivos em `apps/web/src/routes/`.  
> O segmento `_authenticated` é **pathless** — URLs reais são `/`, `/analise`, etc.

### 4.1 Rotas internas (staff autenticado)

Layout: `routes/_authenticated.tsx` → `AuthGuard` + `AppShell`  
Nav: `components/layout/nav-config.ts`

| URL | Arquivo rota | Componente | Permissão | Finalidade | APIs principais | Estados UI |
|-----|--------------|------------|-----------|------------|-----------------|------------|
| `/` | `_authenticated/index.tsx` | `OsHomePage` | `sb_inicio` | Busca/lista OS, detalhes, histórico | `GET /api/os/search`, details, history, vinculos, audit-log | loading (query), erro, vazio, WS refresh |
| `/gerencia` | `_authenticated/gerencia.tsx` | `GerenciaPage` (lazy) | `sb_gerencia` | Criar/editar/duplicar OS | `POST /api/os/save`, `GET /api/os/next_id`, aux, folder-* | loading aux/OS, erro save; **não está no sidebar** |
| `/analise` | `_authenticated/analise.tsx` | `AnalisePage` (lazy) | `sb_analise` | Análise técnica, pré-análise, links PT | `/api/analise/*`, `/api/files/*`, pre-analise | requer `?ano=&id=` |
| `/email` | `_authenticated/email.tsx` | `EmailPage` (lazy) | `sb_email` | Inbox Exchange, pendências, envio PT | `/api/email/*` | badge contador no menu |
| `/papelaria` | `_authenticated/papelaria.tsx` | `PapelariaPage` | `sb_papelaria` | Cartões SVG + preview Corel legado | `/api/papelaria/*` | exige OS > 5000 |
| `/relatorios` | `_authenticated/relatorios.tsx` | `RelatorioPage` (lazy) | `sb_relatorio` | Relatórios customizados HTML/XLSX | `POST /api/reports/custom`, `/xlsx` | |
| `/pcp` | `_authenticated/pcp.tsx` | `PcpPage` (lazy) | `sb_pcp` | Fila kanban por setor | `GET/POST /api/pcp/queue` | DnD + WS |
| `/gravacao` | `_authenticated/gravacao.tsx` | `GravacaoPage` (lazy) | `sb_gravacao` | Monitor Xpose/PrintQ | `/api/gravacao/*`, WS `/api/ws/jobs` | |
| `/usuarios` | `_authenticated/usuarios.tsx` | `UsuariosPage` | `sb_usuarios` | Admin usuários e clientes gabinete | `/api/admin/users/*`, `/api/admin/clientes/*` | |
| `/admin/ips` | `_authenticated/admin/ips.tsx` | `AdminIpsPage` | `sb_admin_ips` | Matriz RBAC por IP | `/api/admin/ip/*`, `/api/access-request` | |
| `/admin/configuracoes` | `_authenticated/admin/configuracoes.tsx` | `ConfiguracoesPage` | `sb_admin_ips` | Pré-análise checks, templates e-mail | `/api/admin/system/*` | |
| `/impressao/requisicao/$ano/$id` | `_authenticated/impressao/requisicao.$ano.$id.tsx` | `RequisicaoPrintPage` | `ctx_imprimir_ficha` | Ficha requisição para impressão | `GET /api/reports/requisicao/{ano}/{id}` | auto-print |
| `/$` (catch-all) | `_authenticated/$.tsx` | `ModulePlaceholderPage` | sessão apenas | Placeholder rotas não migradas | — | "Módulo em migração" |

**Permissões de menu de contexto OS** (não são rotas, mas controlam ações na `/`):
`ctx_nova_os`, `ctx_duplicar_os`, `ctx_editar_os`, `ctx_vincular_os`, `ctx_abrir_pasta`, `ctx_imprimir_ficha`, `ctx_detalhes_os` — definidas em `features/auth/types.ts`, aplicadas via `useAccessControl`.

### 4.2 Login staff (público)

| URL | Arquivo | Finalidade | APIs |
|-----|---------|------------|------|
| `/login` | `login.index.tsx` | Login LAN (ponto+nome) ou internet (senha) | `POST /api/auth/session`, `POST /api/auth/login` |
| `/login/activate` | `login.activate.tsx` | Ativação conta internet | `/api/auth/activate/*` |
| `/login/forgot` | `login.forgot.tsx` | Solicitar reset senha | `POST /api/auth/forgot-password` |
| `/login/reset` | `login.reset.tsx` | Redefinir senha com token | `/api/auth/reset-password/*` |

Layout: `routes/login.tsx` — redireciona autenticados para `/`.

### 4.3 Portal do Cliente (gabinete autenticado)

Layout autenticado: `features/cliente/layout/ClienteAuthenticatedLayout.tsx` → `ClienteAuthGuard` + `ClientePortalShell`  
Cookie: `sagra_cliente_session` (separado de `sagra_session`)

| URL | Arquivo | Componente | Finalidade | APIs |
|-----|---------|------------|------------|------|
| `/cliente` | `cliente/index.tsx` | `ClienteDashboardPage` | Dashboard OS do gabinete, timeline, pendências | `GET /api/cliente/dashboard`, `/api/cliente/me` |
| `/cliente/login` | `cliente/login.index.tsx` | `ClienteLoginPage` | Login gabinete | `POST /api/auth/cliente/login` |
| `/cliente/login/activate` | `cliente/login.activate.tsx` | Ativação conta | `?token=` → `/api/auth/cliente/activate/*` |
| `/cliente/contas` | `cliente/contas.tsx` | `ClienteContasPanel` | Subcontas do gabinete | `GET/POST /api/cliente/contas` |
| `/cliente/provas` | `cliente/provas.tsx` | `ClientePendenciasListPage` | Lista pendências de prova | dashboard + tokens |
| `/cliente/problemas-tecnicos` | `cliente/problemas-tecnicos.tsx` | `ClientePendenciasListPage` | Lista pendências PT | dashboard + tokens |
| `/cliente/os/$ano/$nrOs/prova` | `cliente/os/$ano/$nrOs/prova.tsx` | `ClienteProofBridgePage` | Ponte autenticada → portal prova | redireciona para `/portal/aprovacao/$token` |
| `/cliente/os/$ano/$nrOs/arquivos` | `cliente/os/$ano/$nrOs/arquivos.tsx` | `ClienteArquivosBridgePage` | Ponte → upload arquivos | redireciona para `/portal/os-arquivos/$token` |
| `/cliente/os/$ano/$nrOs/problemas-tecnicos` | `cliente/os/$ano/$nrOs/problemas-tecnicos.tsx` | `ClientePtBridgePage` | Ponte → portal PT | redireciona para `/portal/pt/$token` |

Refetch automático do dashboard: a cada 60s via React Query **[CERTO — `docs/PAGINA_CLIENTE.md`]**.

### 4.4 Portais públicos por token (sem login)

Layout: `routes/portal.tsx` → `PortalLayout`  
Validação: token no path + query `?os=&ano=` conferidos no handler backend.

| URL | Arquivo | Componente | Finalidade | APIs |
|-----|---------|------------|------------|------|
| `/portal/pt/$token` | `portal/pt.$token.tsx` | `PortalPtPage` | Problemas técnicos interativos, upload correções | `/api/analise/client/*`, `/api/client/upload-*` |
| `/portal/prova/$token` | `portal/prova.$token.tsx` | `PortalProvaPage` | Visualização PDF relatório PT (read-only) | `GET /api/client/report/{ano}/{os_id}` |
| `/portal/aprovacao/$token` | `portal/aprovacao.$token.tsx` | `PortalAprovacaoPage` | Aprovar/reprovar prova | `/api/client/proof/*` |
| `/portal/os-arquivos/$token` | `portal/os-arquivos.$token.tsx` | `PortalOsArquivosPage` | Upload arquivos nova OS | `/api/client/os-arquivos/*` |

### 4.5 Painéis TV (sem login, sem AppShell)

Layout: `routes/painel.tsx`

| URL | Arquivo | Componente | Finalidade | APIs |
|-----|---------|------------|------------|------|
| `/painel/setor` | `painel/setor.tsx` | `DashboardSetorPage` | Dashboard setor fullscreen | `GET /api/os/search`, `/api/pcp/queue`, WS |
| `/painel/global` | `painel/global.tsx` | `PainelGlobalPage` | Visão global produção | `GET /api/os/search`, WS, Chart.js |

**Observação:** Rotas sem `AuthGuard`; controle via permissão sidebar + flag `SAGRA_PAINEL_SKIP_IP_CHECK` no backend.

### 4.6 Resumo de rotas

**Total identificado:** 33 rotas em `routeTree.gen.ts` **[CERTO]**

**Lazy-loaded (6):** `/gerencia`, `/email`, `/analise`, `/relatorios`, `/pcp`, `/gravacao`

**Deep links SPA:** Backend registra shell routes em `api.py` (`_register_spa_shell_routes`) para `/login`, `/cliente`, `/portal`, `/painel`, etc.

---

## 5. Mapa de Endpoints Back-end

> App: `app/backend/routers/api.py` monta ~190 rotas REST + WebSocket.  
> Auth padrão: `APIAccessMiddleware` — IP em `ip_permissions` + cookie sessão (anti fail-open).  
> Legenda auth: **Pub** = público; **Sess** = sessão+IP; **M** = MASTER; **Token** = validado no handler; **Cli** = cookie cliente.

### 5.1 Infraestrutura

| Método | Rota | Arquivo | Auth | Finalidade | Tabelas | Telas |
|--------|------|---------|------|------------|---------|-------|
| GET | `/health` | `api.py` | Pub | Ping DB | — | — |
| GET | `/api/config/public` | `config_routes.py` | Pub | Flags bootstrap front | — | `main.tsx` |
| GET | `/api/connected-ips` | `api.py` | M | IPs ativos 60s | — | admin |
| GET | `/api/download/folder-opener` | `api.py` | Sess | Download `SAGRA-FolderOpener.exe` | — | context menu pasta |

### 5.2 Autenticação staff (`auth_routes.py`)

| Método | Rota | Função | Auth | Body / params | Resposta | Tabelas | Efeitos |
|--------|------|--------|------|---------------|----------|---------|---------|
| POST | `/api/auth/session` | `create_session` | Pub (LAN) | `{ponto, nome}` | cookie + user | `tabUsuarios` | Cookie `sagra_session` |
| POST | `/api/auth/login` | `login_password` | Pub (internet) | `{login, password}` | cookie + user | `tabUsuarios`, `user_permissions` | Cookie `sagra_session` |
| GET | `/api/auth/me` | `get_current_session` | Pub (401 se sem cookie) | — | user | — | — |
| POST | `/api/auth/logout` | `logout_session` | Pub | — | ok | — | Limpa cookie |
| GET/POST | `/api/auth/activate/*` | ativação | Pub | token + senha | ok/erro | `tabUsuarios` | Ativa conta |
| POST | `/api/auth/forgot-password` | reset request | Pub (internet) | `{login}` | ok | `tabUsuarios` | E-mail SMTP |
| GET/POST | `/api/auth/reset-password/*` | reset | Pub | token + senha | ok | `tabUsuarios` | Nova senha |

**Telas:** `/login/*` — `features/auth/api.ts`

### 5.3 Permissões e IP admin (`ip_admin_routes.py`)

| Método | Rota | Auth | Finalidade | Tabelas |
|--------|------|------|------------|---------|
| GET | `/api/permissions` | Sess | Permissões efetivas IP+usuário | `ip_permissions`, `user_permissions` |
| GET/POST | `/api/admin/ip/*` | M | CRUD IPs e flags RBAC | `ip_permissions` |
| POST | `/api/access-request` | Pub | Solicitação auto-acesso | `tabSolicitacoesAcesso` |
| GET/POST | `/api/admin/access-requests` | M | Gestão solicitações | `tabSolicitacoesAcesso` |

**Telas:** todas autenticadas + `AdminIpsPage`

### 5.4 OS (`os_routes.py`, `os_sub_os_routes.py`)

| Método | Rota | Função | Tabelas alteradas | Telas |
|--------|------|--------|-------------------|-------|
| GET | `/api/os/search` | `search_os` | leitura | OsHomePage, painéis |
| GET | `/api/os/{ano}/{id}/details` | details | leitura | OsDetailsPanel |
| GET | `/api/os/{ano}/{id}/history` | history | leitura | OsHistoryPanel |
| POST | `/api/os/{ano}/{id}/history` | add history | `tabAndamento` | OsHistoryPanel |
| PUT | `/api/os/{ano}/{id}/history` | update | `tabAndamento` | OsHistoryPanel |
| DELETE | `/api/os/{ano}/{id}/history/{cod_status}` | delete | `tabAndamento`, `deleted_andamentos` | OsHistoryPanel |
| POST | `/api/os/save` | `save_os` | `tabProtocolos`, `tabDetalhesServico` | GerenciaPage |
| POST | `/api/os/{ano}/{id}/duplicate` | duplicate | idem | GerenciaPage |
| GET | `/api/os/{ano}/{id}/path` | UNC path | — | context menu |
| GET/POST | `/api/os/{ano}/{id}/folder-*` | pasta rede | filesystem UNC | FolderBrowserModal |
| GET/POST/DELETE | `/api/os/{ano}/{id}/vinculo*` | vínculos | `tabOSVinculadas` | OsVincularModal |
| GET | `/api/os/{ano}/{id}/componentes` | componentes | `tab_os_componentes` | GerenciaPage |
| GET/POST | `/api/os/{ano}/{id}/sub-os/*` | sub-OS | `tab_os_sub_os`, `tab_os_sub_os_andamento` | GerenciaPage |

**Efeito colateral save:** fila async `mdb_writer` se `MYSQL_ONLY=false` **[CERTO]**.

### 5.5 Análise (`analise_routes.py`, `pre_analise_routes.py`)

| Grupo | Rotas | Auth | Tabelas |
|-------|-------|------|---------|
| CRUD análise | `/api/analise/ensure`, `/save`, `/finalize/{ano}/{os_id}`, `/{ano}/{os_id}/full`, `/meta` | Sess | `tabAnalises`, `tabAnaliseItens` |
| Itens / biblioteca | `/item/*`, `/problemas-padrao/*` | Sess | `tabAnaliseItens`, `tabProblemasPadrao` |
| Arquivos UNC | `/api/files/list`, `/files/serve`, `/indication-image` | Sess/Token | filesystem |
| Portal PT (token) | `/api/analise/client/{ano}/{os_id}`, `/api/client/upload-*`, `/desconsiderar-item`, `/resolver-item` | Token | `tabClientTokens`, `tabAndamento` |
| Links | `/generate-link`, `/register-link-movement` | Sess | `tabClientTokens`, `tabAndamento` |
| Pré-análise | `/pre-analise/checks`, `/run-all/stream`, `/{check_id}` | Sess | `tab_pre_analise_snapshot` |
| PDF legado SAT | `/legacy-pt/{sat_codigo}/pdf` | Sess/Token | `tabRegistroPT` |

**Telas:** `AnalisePage`, `PortalPtPage`

### 5.6 E-mail Exchange (`email_routes.py` — prefix `/api/email`)

| Método | Rota | Finalidade | Integração |
|--------|------|------------|------------|
| GET/PUT | `/config` | Config Exchange por ponto | `tabEmailExchangeConfig` |
| POST | `/config/connect`, `/config/folders` | Teste EWS, listar pastas | `ews_service.py` |
| GET | `/inbox`, `/pendencias`, `/notification_status` | Caixa e pendências | EWS |
| POST | `/send`, `/send-pt` | Envio e-mail / PT | EWS + templates |
| POST | `/andamento`, `/save-mht`, `/mark-read` | Andamento, salvar MHT, lido | EWS + `tabAndamento` |
| GET | `/proof-files/{ano}/{os}`, `/pt-html/{ano}/{os}` | Arquivos prova, preview PT | UNC + templates |

**Telas:** `EmailPage`

### 5.7 Portais prova e arquivos

| Router | Rotas | Auth | Tabelas |
|--------|-------|------|---------|
| `proof_portal_routes.py` | `/api/client/proof/{ano}/{os_id}`, `/pdf`, `/respond` | Token | `tabProofTokens`, `tabAndamento` |
| `os_arquivos_routes.py` | `/api/client/os-arquivos/*`, `/api/os/.../arquivos/enviar-email` | Token / Sess | `tabOsArquivosTokens` |

### 5.8 Cliente gabinete (`cliente_gabinete_routes.py`)

| Método | Rota | Auth | Finalidade | Tabelas |
|--------|------|------|------------|---------|
| POST | `/api/auth/cliente/login` | Pub | Login | `tabClienteGabinete` |
| GET/POST | `/api/auth/cliente/activate/*` | Pub | Ativação | `tabClienteGabinete` |
| GET | `/api/cliente/me` | Cli | Sessão atual | `tabClienteGabinete` |
| GET | `/api/cliente/dashboard` | Cli | OS do gabinete | `tabProtocolos`, tokens |
| GET | `/api/cliente/os/{ano}/{nr_os}/andamentos` | Cli | Timeline | `tabAndamento` |
| GET/POST | `/api/cliente/contas` | Cli | Subcontas | `tabClienteGabinete` |
| GET/POST | `/api/admin/clientes/*` | M | Admin clientes | `tabClienteGabinete` |

### 5.9 Demais routers

| Router | Prefixo | Endpoints chave | Telas |
|--------|---------|-----------------|-------|
| `auxiliar_routes.py` | `/api/aux` | categorias, situações, setores, deputado, protocolo | GerenciaPage, filtros |
| `pcp_routes.py` | `/api/pcp` | queue, reorder | PcpPage, painel setor |
| `papelaria_routes.py` | `/api/papelaria` | modelos, svg, preview | PapelariaPage |
| `gravacao_routes.py` | `/api/gravacao` | xpose/status, jobticket | GravacaoPage |
| `report_custom_routes.py` | `/api/reports` | custom, xlsx | RelatorioPage |
| `requisicao_routes.py` | `/api/reports/requisicao` | HTML ficha | RequisicaoPrintPage |
| `settings_routes.py` | `/api/settings` | preferences, filtros salvos | SettingsModal |
| `notifications_routes.py` | `/api/notifications` | lista, mark read | Header (parcial) |
| `admin_system_routes.py` | `/api/admin/system` | pré-análise checks, email templates | ConfiguracoesPage |
| `user_admin_routes.py` | `/api/admin/users` | CRUD usuários, permissões | UsuariosPage |
| `setor_painel_routes.py` | `/api/admin/setor-painel-defaults` | defaults painel | DashboardSetorPage |
| `realtime.py` | `/ws`, `/api/ws`, `/api/realtime/notify` | WebSocket | OsHomePage, PCP, painéis |
| `sync_routes.py` | `/api/sync/*` | start/stop/logs sync | **[condicional]** UI legada |

### 5.10 Erros comuns API **[CERTO]**

| Código | Causa |
|--------|-------|
| 401 | Sem cookie em rota que exige sessão explícita |
| 403 | IP não cadastrado ou sessão inválida (`APIAccessMiddleware`) |
| 404 | OS/recurso não encontrado |
| 503 | Pool DB esgotado (`DatabasePoolExhausted`) ou GDrive desabilitado |

---

## 6. Mapa de Módulos

| Módulo | Front (feature) | Back (router + services) | Tabelas principais | Integrações |
|--------|-----------------|--------------------------|-------------------|-------------|
| **Início / OS** | `features/os/` | `os_routes.py`, `os_sub_os_routes.py` | `tabProtocolos`, `tabDetalhesServico`, `tabAndamento` | WS, UNC, MDB opcional |
| **Gerência** | `features/gerencia/` | `os_routes.py`, `auxiliar_routes.py` | idem + `tab_os_*` | UNC, deputados API |
| **Análise** | `features/analise/` | `analise_routes.py`, `pre_analise_routes.py` | `tabAnalises`, `tabAnaliseItens`, `tabClientTokens` | PyMuPDF, Tesseract, UNC |
| **E-mail** | `features/email/` | `email_routes.py`, `ews_service.py` | `tabEmailExchangeConfig`, templates | Exchange EWS |
| **Portal PT** | `features/portal/` | `analise_routes.py` (client) | `tabClientTokens` | upload UNC/GDrive |
| **Provas** | `features/portal/` | `proof_portal_routes.py` | `tabProofTokens` | PDF em pasta OS |
| **Arquivos OS** | `features/portal/`, `gerencia/` | `os_arquivos_routes.py` | `tabOsArquivosTokens` | EWS, UNC, GDrive |
| **Portal Cliente** | `features/cliente/` | `cliente_gabinete_routes.py` | `tabClienteGabinete` | timeline, tokens |
| **Contas gabinete** | `ClienteContasPanel` | `cliente_gabinete_routes.py` | `tabClienteGabinete` | — |
| **Papelaria** | `features/papelaria/` | `papelaria_routes.py` | modelos MySQL + UNC Corel | win32com (Windows) |
| **PCP** | `features/pcp/` | `pcp_routes.py`, `pcp_queue_service.py` | `tab_pcp_fila` | WS |
| **Gravação** | `features/gravacao/` | `gravacao_routes.py` | `xpose_*`, `ct_gravacao_*` | WS jobs |
| **Relatórios** | `features/relatorio/` | `report_custom_routes.py` | queries dinâmicas | openpyxl |
| **Painéis** | `dashboard-setor/`, `painel-global/` | `os_routes.py`, `pcp_routes.py` | leitura OS | WS, Chart.js |
| **Usuários** | `features/usuarios/` | `user_admin_routes.py` | `tabUsuarios`, `user_permissions` | SMTP ativação |
| **Admin IPs** | `features/admin-ips/` | `ip_admin_routes.py` | `ip_permissions` | — |
| **Config sistema** | `features/configuracoes/` | `admin_system_routes.py` | templates, checks | EWS test send |
| **Auth** | `features/auth/` | `auth_routes.py`, `security/` | `tabUsuarios` | cookies HMAC |
| **Notificações** | `OsNotificationHandler` | `notifications_routes.py` | `tabNotificacoes` | WS push |
| **Sync** | UI legada | `sync_routes.py`, `sync_andamentos_v2.py` | `log_sync_andamentos`, cache | MDB pyodbc |

---

## 7. Mapa de Fluxos Principais

### 7.1 Autenticação interna **[CERTO]**

```
Usuário → /login
  ├─ LAN: POST /api/auth/session {ponto, nome}
  │    └─ Cookie sagra_session (HttpOnly HMAC)
  └─ Internet: POST /api/auth/login {login, password}
       └─ Cookie + overlay user_permissions

App load → AuthBootstrap → GET /api/auth/me + GET /api/permissions
  ├─ Permissões OK → AuthGuard libera /_authenticated/*
  └─ Sem permissões explícitas → logout (anti fail-open)
```

Arquivos: `authStore.ts`, `AuthBootstrap.tsx`, `security/session_auth.py`, `security/api_auth.py`

### 7.2 Autenticação do cliente **[CERTO]**

```
Gabinete → /cliente/login → POST /api/auth/cliente/login
  └─ Cookie sagra_cliente_session

/cliente → ClienteAuthGuard → GET /api/cliente/me + GET /api/cliente/dashboard
  └─ Refetch 60s; pendências PT/prova/arquivos com bridge routes
```

### 7.3 Criação / consulta de OS **[CERTO]**

```
Início: filtros → GET /api/os/search (debounce 250ms, paginação server-side)
  └─ Selecionar linha → GET details + history

Nova OS: menu contexto (ctx_nova_os) → /gerencia?action=new
  └─ GET /api/os/next_id → preencher form → POST /api/os/save
       ├─ MySQL commit
       ├─ [opcional] mdb_writer async
       ├─ audit log
       └─ NovaOsArquivosModal → enviar e-mail portal arquivos
```

### 7.4 Andamento / timeline **[CERTO]**

```
Staff: OsHistoryPanel → GET /api/os/{ano}/{id}/history
  ├─ POST add → tabAndamento (+ broadcast WS)
  ├─ PUT edit / DELETE (tombstone deleted_andamentos)
  └─ POST replicate → OS vinculadas

Cliente: GET /api/cliente/os/{ano}/{nr_os}/andamentos
  └─ cliente_os_timeline_service.py (filtros, sub-OS espelho)

Sub-OS: andamentos em tab_os_sub_os_andamento espelham tabAndamento
```

### 7.5 Análise técnica **[CERTO]**

```
/analise?ano=&id= → POST /api/analise/ensure → GET full
  ├─ Adicionar itens (biblioteca tabProblemasPadrao)
  ├─ Pré-análise PDF (stream NDJSON)
  ├─ Anotações em PDF (indication-image)
  └─ Finalizar:
       ├─ Sem itens → modal obs → andamento "Em Execução"
       └─ Com itens → generate-link → tabClientTokens
            → register-link-movement → "Problemas Técnicos"
```

### 7.6 Problemas técnicos (portal) **[CERTO]**

```
Técnico finaliza análise → URL /portal/pt/{token}?os=&ano=
Cliente (link e-mail ou /cliente/problemas-tecnicos):
  └─ GET /api/analise/client/{ano}/{os}?token=
  ├─ POST /client/desconsiderar-item (itens opcionais)
  └─ POST /client/upload-files (ou GDrive session)
       └─ Todos componentes resolvidos → andamento "Em Execução", token expira
```

Ver detalhe: `docs/PAGINA_PORTAL_PT_PROBLEMAS_TECNICOS.md`

### 7.7 Provas e aprovação **[CERTO]**

```
Técnico: módulo E-mail → send-pt ou fluxo prova
  └─ tabProofTokens + e-mail com link

Cliente:
  ├─ /portal/aprovacao/{token} → GET proof data + PDF
  │    └─ POST /api/client/proof/respond → andamento aprovação
  └─ /cliente/provas → bridge → portal
```

### 7.8 Envio de e-mails **[CERTO]**

```
/email → configurar EWS (tabEmailExchangeConfig)
  ├─ Inbox / pendências (EWS read)
  ├─ POST /send (corpo livre)
  └─ POST /send-pt (template HTML, link portal, anexos prova)
       └─ POST /andamento (registra movimento na OS)
```

### 7.9 Contas do gabinete **[CERTO]**

```
/cliente/contas → GET /api/cliente/contas (lista subcontas)
  └─ POST criar subconta → e-mail ativação (cliente_activation_email_service)
Admin: /usuarios → POST /api/admin/clientes (cadastro gabinete master)
```

### 7.10 Upload arquivos (nova OS) **[CERTO]**

```
Gerência pós-criação → POST /api/os/.../arquivos/enviar-email (EWS)
  └─ Cliente abre /portal/os-arquivos/{token}
       └─ POST upload-files ou GDrive staging → UNC pasta OS
```

### 7.11 Refetch Portal do Cliente **[CERTO]**

- Dashboard: `staleTime` + `refetchInterval: 60_000` em hooks cliente
- WS `system_update` atualiza staff; cliente usa polling **[INFERÊNCIA: cliente não usa WS diretamente]**
- Correção P0 documentada em `docs/RELATORIO_CORRECAO_P0_REFETCH_PORTAL_CLIENTE.md`

### 7.12 Sync MDB/MySQL **[CERTO — desabilitado em produção]**

```
Se SYNC_ANDAMENTOS_ENABLED=true:
  POST /api/sync/start → subprocess sync_andamentos_v2.py
  ↔ bidirecional tabAndamento MySQL ↔ Access cache
Produção atual: mysql_only=true, sync_andamentos_enabled=false
```

---

## 8. Mapa de Tabelas / Dados

### 8.1 Identificação de OS **[CERTO]**

| Conceito | Campo / regra |
|----------|---------------|
| Chave composta | `NroProtocolo` + `AnoProtocolo` |
| Tabela cabeçalho | `tabProtocolos` |
| Detalhes técnicos | `tabDetalhesServico` |
| Papelaria vs OS | `NroProtocolo >= 5000` → MDB Papelaria; `< 5000` → MDB OS Atual |
| Pasta rede | Derivada de ano + número via `os_folder_structure.py` → UNC `\\redecamara\DfsData\...` |

### 8.2 Tabelas legadas (Access-synced) **[CERTO]**

| Tabela | Finalidade |
|--------|------------|
| `tabProtocolos` | Cabeçalho OS |
| `tabDetalhesServico` | Especificação, produto, setor |
| `tabAndamento` | Histórico status (`CodStatus` PK) |
| `tabOSVinculadas` | OS vinculadas |
| `tabRegistroPT` | Relatórios SAT legados (PDF) |
| `tabcategorias`, `tabPapel`, `tabCores`, `tabFormatos` | Lookups |
| `tabdadosdeputados` | Deputados locais (XLS) |

### 8.3 Tabelas análise / portal **[CERTO]**

| Tabela | Finalidade |
|--------|------------|
| `tabAnalises` | Sessão análise por OS |
| `tabAnaliseItens` | Itens/problemas da análise |
| `tabProblemasPadrao` | Biblioteca problemas padrão |
| `tabClientTokens` | Tokens portal PT (`DataExpiracao`) |
| `tabProofTokens` | Tokens aprovação prova |
| `tabOsArquivosTokens` | Tokens upload arquivos |
| `tabMigracaoSatRegistroPT` | Controle migração SAT → análise |

### 8.4 Tabelas web-only (MySQL, sem MDB) **[CERTO]**

| Tabela | Finalidade |
|--------|------------|
| `tab_os_componentes` | Componentes para Sub-OS |
| `tab_os_sub_os` | Sub-ordens de serviço |
| `tab_os_sub_os_andamento` | Andamentos Sub-OS (espelho) |
| `tabOSVinculoGrupos` | Grupos sincronização vínculos |
| `tabClienteGabinete` | Contas portal cliente / subcontas |
| `tabEmailExchangeConfig` | Config EWS por ponto |
| `tabEmailTemplateModel` | Modelos e-mail multi-template |
| `tab_pre_analise_snapshot` | Cache pré-análise |
| `tab_os_audit_log` | Auditoria alterações OS |
| `tabUserPreferences` | Preferências UI |
| `tabSetorPainelDefaults` | Defaults painel por setor |
| `tab_pcp_fila` | Fila PCP |
| `tabSolicitacoesAcesso` | Solicitações acesso IP |
| `user_permissions` | RBAC por ponto (internet) |
| `ip_permissions` | RBAC por IP |
| `ct_gravacao_*`, `xpose_*` | Gravação / Xpose |

### 8.5 Autenticação e tokens **[CERTO]**

| Item | Detalhe |
|------|---------|
| Usuário interno | `tabUsuarios.Ponto` (numérico); colunas auth adicionadas por `user_auth_schema.py` |
| Sessão staff | Cookie `sagra_session` — HMAC em `SAGRA_SESSION_SECRET` |
| Sessão cliente | Cookie `sagra_cliente_session` — modo `AUTH_MODE_CLIENTE` |
| Token portal | UUID em `tabClientTokens` / `tabProofTokens` / `tabOsArquivosTokens`; validação por OS+ano+expiração |
| Cliente/gabinete | `tabClienteGabinete` — vínculo a deputado/órgão **[INFERÊNCIA: campos em schema]** |

### 8.6 Arquivos **[CERTO]**

| Tipo | Onde |
|------|------|
| Pasta OS | UNC rede — path via `GET /api/os/{ano}/{id}/path` |
| PDFs prova | Subpasta da OS — `proof_files_service.py` |
| Indicações análise | Upload para path controlado — `analise_routes.py` |
| Templates e-mail | `tabEmailTemplateModel` + presets HTML em disco |
| Schema completo legado | `schema_sagrafulldb.sql` — **[NÃO IDENTIFICADO]** no repo dev (referenciado em docs) |

---

## 9. Mapa de Autenticação e Permissões

### 9.1 Três modos de acesso **[CERTO]**

| Modo | Cookie / credencial | Middleware | Rotas |
|------|---------------------|------------|-------|
| Staff | `sagra_session` | `APIAccessMiddleware` + IP | `/_authenticated/*`, `/api/*` (exceto públicas) |
| Cliente | `sagra_cliente_session` | Prefix `/api/cliente/*` valida cookie cliente | `/cliente/*` |
| Token público | Query/path token | Prefix `/api/client/` público; validação no handler | `/portal/*` |

### 9.2 Chaves de permissão **[CERTO]** — `features/auth/types.ts`

**Sidebar (`sb_*`):** `sb_inicio`, `sb_gerencia`, `sb_email`, `sb_analise`, `sb_papelaria`, `sb_relatorio`, `sb_dashboard_setor`, `sb_dashboard_global`, `sb_pcp`, `sb_gravacao`, `sb_usuarios`, `sb_admin_ips`, `sb_configuracoes`, `sb_usuario` (legado), `sb_active_computers` (sem rota React).

**Contexto OS (`ctx_*`):** `ctx_nova_os`, `ctx_duplicar_os`, `ctx_editar_os`, `ctx_vincular_os`, `ctx_abrir_pasta`, `ctx_imprimir_ficha`, `ctx_detalhes_os`.

**Painel setor:** `painelSetores[]` ou `painelSetoresLegacyAll`.

### 9.3 Precedência IP vs usuário **[CERTO]**

1. Base: `ip_permissions` (sempre)
2. Overlay: `user_permissions` (login internet; LAN se customizado)
3. Em conflito: overlay usuário prevalece **[INFERÊNCIA baseada em `get_permissions`]**

### 9.4 MASTER **[CERTO]**

IPs: `10.120.2.11` (config `allowed_ips.master`), servidor `10.1.1.73`, loopback.  
Acesso: todas rotas `/api/admin/*`, `/api/sync/*`, `/api/connected-ips`.

### 9.5 Onde permissões são aplicadas **[CERTO]**

| Camada | Arquivo | Granularidade |
|--------|---------|---------------|
| React AuthGuard | `components/auth/AuthGuard.tsx` | `sb_*` por rota |
| React contexto | `useAccessControl.ts` | `ctx_*` menu OS |
| API middleware | `security/api_auth.py` | IP + sessão (não cada `sb_*`) |
| SPA shell | `security/spa_access.py` | HTML deep links |
| Endpoints admin | `require_master_ip`, `require_admin_config_access` | Operações sensíveis |

**Nota importante:** RBAC granular `sb_*` é **primariamente frontend**; API valida IP cadastrado + sessão, não flag individual por endpoint (exceto admin).

### 9.6 Política anti fail-open **[CERTO]**

- Backend: sem sessão/IP → HTTP 403 (`api_auth.py`)
- Frontend: `createDeniedPermissions()` — todas negadas por padrão (`permissions.ts`)
- Permissões só concedidas com resposta explícita da API

---

## 10. Integrações Externas

| Integração | Status | Arquivos | Config / env | Fluxo resumido |
|------------|--------|----------|--------------|----------------|
| **MySQL** | Ativo | `database.py` | `DB_*`, `SAGRA_DB_*` | Pool PyMySQL; fonte da verdade |
| **Access MDB** | Desabilitado prod | `mdb_writer.py` | `MYSQL_ONLY`, paths `mdb_*_path` | Dual-write async pós-save se habilitado |
| **UNC rede** | Ativo | `os_folder_structure.py`, `file_access.py` | `network_paths` em config.json | Pastas OS, modelos Corel, PDFs |
| **Exchange EWS** | Ativo | `ews_service.py` | `EWS_*` env, `tabEmailExchangeConfig` | SSPI/NTLM Windows; inbox, send, PT |
| **SMTP** | Ativo | `activation_email_service.py`, etc. | **[INFERÊNCIA]** credenciais env | Ativação usuário/cliente, reset senha |
| **Google Drive** | Código pronto, off | `gdrive_portal_upload.py` | `SAGRA_PORTAL_UPLOAD_GDRIVE`, `SAGRA_GDRIVE_*` | Upload portal via staging Drive → UNC |
| **Cloudflare Tunnel** | Ativo prod | `security/cloudflare_access.py` | — | Acesso internet; bloqueia rotas internas |
| **zrok** | Ativo painéis | `iniciar-zrok-painel.bat` | — | Expõe `/painel/*` |
| **Nginx** | Ativo | `\\cgrafsysvm\nginx\conf\nginx.conf` | upstream `:8050` | `/sagra/api/` → API; SPA na raiz |
| **PyMuPDF / Tesseract** | Ativo pré-análise | `services/pre_analise/` | `TESSERACT_CMD`, `SAGRA_PREANALISE_*` | Checks PDF automatizados |
| **Corel COM** | Windows only | `papelaria_routes.py` | UNC modelos `.cdr` | Preview PDF legado |
| **Câmara API deputados** | Ativo | `deputados_camara_service.py` | cache TTL env | Lookup na gerência |
| **Xpose / Apogee** | Ativo gravação | `gravacao_routes.py` | UNC `\\cgrafsysvm\ApogeeFiles\` | Jobs CTP em MySQL |
| **Folder Opener** | Ativo Windows | `local_services/`, download endpoint | — | Abre Explorer em UNC |
| **WebSocket** | Ativo | `realtime.py` | — | `system_update`, `pcp_queue_update`, `force_refresh` |

---

## 11. Funcionalidades do Usuário Final

> Formato: nome → onde → quem → para que → passos → resultado → erros comuns

### 11.1 Buscar e acompanhar OS (staff)

| Campo | Conteúdo |
|-------|----------|
| **Nome** | Busca de Ordens de Serviço |
| **Onde** | Menu **Início** (`/`) |
| **Quem** | Operadores com permissão Início |
| **Para que** | Localizar OS, ver detalhes, histórico e executar ações |
| **Passos** | 1) Ajustar filtros → 2) Selecionar OS na tabela → 3) Ver painel detalhes/histórico → 4) Menu contexto para ações |
| **Resultado** | OS localizada com dados atualizados; ações conforme permissão |
| **Erros comuns** | "Sem permissão" no menu contexto; lista vazia por filtros restritivos; lentidão com muitos registros |
| **Obs.** | Atualização automática via WebSocket; botão Atualizar força refresh |

### 11.2 Criar / editar OS (staff)

| Campo | Conteúdo |
|-------|----------|
| **Nome** | Gerência de OS |
| **Onde** | Menu contexto → Nova/Editar/Duplicar (abre `/gerencia`) |
| **Quem** | Operadores com Gerência + permissão de contexto |
| **Para que** | Cadastrar ou alterar dados da OS e pasta de rede |
| **Passos** | 1) Menu contexto → 2) Preencher formulário → 3) Salvar → 4) [nova OS] modal envio arquivos |
| **Resultado** | OS salva no sistema; pasta rede criada/planejada |
| **Erros comuns** | Falha MDB (se habilitado) com aviso; path UNC inacessível; validação campos obrigatórios |

### 11.3 Análise técnica (staff)

| Campo | Conteúdo |
|-------|----------|
| **Nome** | Análise de qualidade |
| **Onde** | Menu **Análise** (requer OS selecionada) |
| **Quem** | Analistas |
| **Para que** | Registrar problemas técnicos, pré-analisar PDFs, gerar link para cliente |
| **Passos** | 1) Selecionar OS → 2) Análise → 3) Adicionar itens → 4) [opcional] pré-análise → 5) Concluir e salvar |
| **Resultado** | Análise salva; link PT gerado; andamento "Problemas Técnicos" |
| **Erros comuns** | OS sem `ano/id` na URL; pré-análise lenta; Tesseract ausente |

### 11.4 E-mail e envio de PT (staff)

| Campo | Conteúdo |
|-------|----------|
| **Nome** | Módulo E-mail |
| **Onde** | Menu **E-mail** |
| **Quem** | Operadores com permissão E-mail |
| **Para que** | Ler caixa Exchange, tratar pendências, enviar relatório PT ao cliente |
| **Passos** | 1) Configurar Exchange (1ª vez) → 2) Inbox/pendências → 3) Selecionar mensagem → 4) Enviar PT / registrar andamento |
| **Resultado** | E-mail enviado; andamento registrado na OS |
| **Erros comuns** | Falha conexão EWS; credenciais; anexo grande (`SAGRA_EMAIL_ATTACHMENT_MAX_MB`) |

### 11.5 Portal do Cliente — acompanhar OS (cliente)

| Campo | Conteúdo |
|-------|----------|
| **Nome** | Dashboard Portal do Cliente |
| **Onde** | `/cliente` (login em `/cliente/login`) |
| **Quem** | Gabinetes/deputados com conta |
| **Para que** | Ver OS do gabinete, timeline, pendências PT/prova/arquivos |
| **Passos** | 1) Login e-mail/senha → 2) Ver lista OS → 3) Abrir timeline → 4) Clicar pendência |
| **Resultado** | Acompanhamento atualizado (refresh 60s) |
| **Erros comuns** | Conta não ativada; OS não vinculada ao gabinete; sessão expirada |

### 11.6 Contas do gabinete (cliente)

| Campo | Conteúdo |
|-------|----------|
| **Nome** | Gestão de subcontas |
| **Onde** | `/cliente/contas` |
| **Quem** | Conta principal do gabinete |
| **Para que** | Criar acessos secundários para equipe do gabinete |
| **Passos** | 1) Acessar Contas → 2) Preencher dados subconta → 3) Salvar → 4) Ativar via e-mail |
| **Resultado** | Subconta com acesso ao mesmo escopo de OS |
| **Erros comuns** | E-mail já cadastrado; token ativação expirado |

### 11.7 Problemas técnicos — portal (cliente externo)

| Campo | Conteúdo |
|-------|----------|
| **Nome** | Portal de Problemas Técnicos |
| **Onde** | Link `/portal/pt/{token}` (e-mail ou portal cliente) |
| **Quem** | Cliente com link válido (sem senha) |
| **Para que** | Ver problemas, desconsiderar opcionais, enviar arquivos corrigidos |
| **Passos** | 1) Abrir link → 2) Confirmar identidade → 3) Revisar itens → 4) Upload por componente |
| **Resultado** | Arquivos na pasta OS; andamento retorna "Em Execução" |
| **Erros comuns** | Token expirado; upload falha (tamanho/rede); GDrive 503 se desabilitado |

### 11.8 Aprovação de prova (cliente externo)

| Campo | Conteúdo |
|-------|----------|
| **Nome** | Portal de Aprovação de Prova |
| **Onde** | `/portal/aprovacao/{token}` |
| **Quem** | Cliente com link de prova |
| **Para que** | Aprovar ou reprovar prova PDF |
| **Passos** | 1) Abrir link → 2) Visualizar PDF → 3) Aprovar/Reprovar + comentário |
| **Resultado** | Decisão registrada; andamento na OS |
| **Erros comuns** | PDF indisponível; token inválido |

### 11.9 Upload arquivos nova OS (cliente)

| Campo | Conteúdo |
|-------|----------|
| **Nome** | Portal de Arquivos |
| **Onde** | `/portal/os-arquivos/{token}` |
| **Quem** | Cliente que recebeu link por e-mail |
| **Para que** | Enviar arquivos de produção para OS recém-criada |
| **Passos** | 1) Abrir link → 2) Arrastar arquivos → 3) Enviar |
| **Resultado** | Arquivos na pasta UNC da OS |
| **Erros comuns** | Link expirado; limite tamanho; falha rede |

### 11.10 PCP — fila de produção (staff)

| Campo | Conteúdo |
|-------|----------|
| **Nome** | Fila PCP |
| **Onde** | Menu **PCP** |
| **Quem** | Planejamento / setores com permissão PCP |
| **Para que** | Visualizar e reordenar fila de OS por setor |
| **Passos** | 1) Selecionar setor → 2) Arrastar cards → 3) Ordem salva automaticamente |
| **Resultado** | Prioridade atualizada para o setor |
| **Erros comuns** | Sem OS no setor; outro usuário reordenou simultaneamente |

### 11.11 Painéis TV (monitor)

| Campo | Conteúdo |
|-------|----------|
| **Nome** | Painel Setor / Painel Global |
| **Onde** | `/painel/setor`, `/painel/global` (nova janela pelo menu) |
| **Quem** | TVs de setor / gestão (sem login) |
| **Para que** | Visualização em tempo real da produção |
| **Passos** | 1) Abrir URL em TV/navegador → 2) [opcional] configurar colunas |
| **Resultado** | Dashboard atualizado via WS/polling |
| **Erros comuns** | Setor não permitido; tela bloqueia por sleep (wake lock mitiga) |

### 11.12 Administração (staff master)

| Campo | Conteúdo |
|-------|----------|
| **Nome** | Administração de IPs e usuários |
| **Onde** | `/admin/ips`, `/usuarios`, `/admin/configuracoes` |
| **Quem** | MASTER / admins com permissões |
| **Para que** | Controlar quem acessa o quê; configurar templates e checks |
| **Passos** | Variável por tarefa (adicionar IP, criar usuário, editar template) |
| **Resultado** | RBAC atualizado |
| **Erros comuns** | Operação requer IP master; remoção IP próprio |

---

## 12. Riscos Técnicos

### 12.1 Arquivos e componentes críticos (alterar com cautela)

| Arquivo / área | Risco |
|----------------|-------|
| `app/backend/routers/api.py` | Startup schema, middleware stack, registro routers |
| `app/backend/security/api_auth.py` | Toda segurança API |
| `app/backend/security/session_auth.py` | Cookies e HMAC |
| `app/backend/database.py` | Pool e transações |
| `app/backend/routers/os_routes.py` | CRUD OS + histórico |
| `app/backend/routers/mdb_writer.py` | Dual-write legado |
| `app/backend/services/andamento_operacional.py` | Regras andamento |
| `config/config.json`, `config/.env` | Segredos e paths produção |
| `\\cgrafsysvm\nginx\conf\nginx.conf` | Roteamento público |
| `apps/web/src/lib/api.ts` | Prefixo API prod/dev |
| `apps/web/src/features/auth/permissions.ts` | Anti fail-open front |

### 12.2 Endpoints sensíveis

| Endpoint | Risco |
|----------|-------|
| `POST /api/os/save` | Altera dados produção |
| `DELETE /api/os/.../history/{cod_status}` | Remove histórico |
| `POST /api/admin/ip/delete` | Remove acesso |
| `POST /api/realtime/notify` (force_refresh) | Recarrega todos clientes |
| `POST /api/sync/start` | Sync MDB (se habilitado) |
| `POST /api/admin/system/email-templates/*/reset` | Restaura templates |
| `/api/client/*` com token | Upload para pasta OS (escopo token) |

### 12.3 Fluxos que impactam produção

- Save OS + andamentos
- Finalizar análise → gera token PT
- Resposta prova cliente
- Upload portal → grava UNC
- Reordenação PCP
- Admin IPs / permissões

### 12.4 Dependências externas frágeis

| Dependência | Impacto se indisponível |
|-------------|-------------------------|
| MySQL `10.1.1.73` | Sistema inteiro para |
| UNC `\\redecamara\DfsData\...` | Pastas OS, uploads, pré-análise |
| Exchange EWS | Módulo e-mail; envio PT/prova |
| Nginx / Uvicorn | Acesso web |
| Tesseract | Pré-análise OCR degradada |
| Corel COM | Preview papelaria legado falha |
| Cloudflare/zrok | Acesso externo |

### 12.5 Riscos PWA / cache **[INFERÊNCIA]**

- `vite-plugin-pwa` com Workbox — atualizações via `PwaUpdatePrompt`
- Nginx aplica `no-cache` em HTML (`$sagra_html_no_cache`)
- Risco: cliente com SW antigo após deploy — mitigado por prompt de atualização

### 12.6 Riscos de performance

- `GET /api/os/search` com milhares de registros
- Pré-análise `run-all/stream` — CPU intensivo (PyMuPDF/OCR)
- Pool DB (`SAGRA_DB_POOL_SIZE`) esgotamento → 503
- Logs sync grandes (~234 MB mencionados em auditoria anterior)

### 12.7 Riscos de permissões

- Painéis sem AuthGuard — dependem de config backend
- API não valida cada `sb_*` — operador LAN com IP amplo tem acesso API completo
- Tokens portal — segurança depende de entropia + expiração + validação OS/ano
- WebSocket `/api/ws/jobs` — autenticação limitada **[CERTO]**

### 12.8 Divergência documentação legada

`contexto_executivo.md` (26/05/2026) descreve vulnerabilidades (API sem auth, fail-open) **parcialmente corrigidas** na Fase B (`APIAccessMiddleware`, `permissions.ts` anti fail-open). Validar sempre no ambiente alvo — **[INFERÊNCIA]**.

---

## 13. Itens Pendentes ou Não Encontrados

| Item | Status |
|------|--------|
| `schema_sagrafulldb.sql` completo no repo dev | **Não identificado** — apenas DDL incrementais em `deploy/sql/` |
| Rota React para `sb_active_computers` / computadores ativos | **Não identificado** — permissão existe, página legada |
| UI React para controle sync (`/api/sync/*`) | **Não identificado** — backend condicional; UI legada em `controls/` |
| `server.py` monolítico legado | Presente mas **não referenciado** em `main.py` — código morto |
| `web-orchestrator` subprojeto | Existe separado — **fora do escopo** SAGRA Web principal |
| Google Drive upload em produção | **Desabilitado por padrão** (`SAGRA_PORTAL_UPLOAD_GDRIVE`) |
| Header notificações (sino) | **Stub** — badge fixo 0, "em breve" |
| `PreAnaliseModal.tsx` | **Código morto** — substituído por `PreAnalisePanel` |
| `PermissionGate.tsx` | **Não utilizado** no código atual |
| Rotas legadas HTML restantes | Parcialmente servidas; catch-all `/_authenticated/$` para não migradas |
| Conteúdo exato `.env` produção | **Não acessível** nesta sessão (`\\cgrafsysvm\...\config\.env`) |
| Redis em realtime | Dependência listada em auditoria antiga — **uso não confirmado** no código analisado |

---

## 14. Recomendações para Criação do Manual Completo

### 14.1 Estrutura sugerida do manual técnico

1. **Arquitetura e deploy** — monorepo, build, Nginx, variáveis `.env`, ports 8001/8050
2. **Autenticação Fase B** — cookies, middleware, MASTER, troubleshooting 403
3. **Modelo de dados** — diagrama ER simplificado: OS, andamento, análise, tokens, RBAC
4. **API Reference** — agrupar por router; OpenAPI em `/docs`
5. **WebSocket** — tipos de mensagem, quem publica/consome
6. **Integrações** — EWS, UNC, MDB (modo legado), GDrive (opcional)
7. **Scripts operacionais** — backup, sync, `ajuste_andamentos_os_antigas.py`
8. **Testes** — `app/backend/tests/`, homologação por módulo

### 14.2 Estrutura sugerida do manual operacional

1. **Primeiro acesso** — login LAN vs internet vs cliente
2. **Guia por perfil** — operador, analista, PCP, admin, cliente gabinete
3. **Fluxos ilustrados** — OS nova, análise→PT, prova, arquivos
4. **Glossário** — OS, PT, PTV, PCP, SEFOC, gabinete, token, andamento
5. **FAQ / erros comuns** — 403, token expirado, EWS, pasta rede
6. **Painéis TV** — configuração monitor, URLs zrok
7. **Anexos** — matriz permissões `sb_*` / `ctx_*` com screenshots

### 14.3 Prioridades de validação em homologação

1. Login staff LAN + internet + cliente gabinete
2. Ciclo completo OS → análise → PT → upload cliente → execução
3. Ciclo prova → aprovação
4. E-mail send-pt com template configurado
5. PCP reorder + WS
6. Painéis setor/global via URL TV
7. Contas gabinete + subconta
8. Permissões IP — operador sem `sb_analise` não acessa `/analise`

### 14.4 Material fonte para redação

| Prioridade | Fonte |
|------------|-------|
| Alta | Este inventário + `docs/INVENTARIO_COMPLETO_SISTEMA.md` |
| Alta | `docs/PAGINA_CLIENTE.md`, `docs/PAGINA_PORTAL_PT_PROBLEMAS_TECNICOS.md` |
| Média | `docs/MANUAL_COMPLETO_SAGRA_WEB.md` (rascunho existente) |
| Média | `docs/API_FASE_B_AUTH.md`, `docs/EMAIL_EWS_ENVIO_E_MONITORAMENTO.md` |
| Baixa | `contexto_executivo.md` (verificar obsolescência antes de citar segurança) |

### 14.5 Decisões editoriais

- **Separar claramente** UI React (atual) vs HTML legado (migração)
- **Documentar Gerência** como acesso via menu contexto (não sidebar)
- **Incluir URLs produção** com e sem prefixo `/sagra` (Nginx redireciona)
- **Não documentar** `web-orchestrator` como parte do SAGRA Web operacional
- **Marcar operações irreversíveis**: delete andamento, delete vínculo, reset template

---

## Apêndice A — Stores Zustand

| Store | Arquivo | Persistência |
|-------|---------|--------------|
| `useAuthStore` | `features/auth/authStore.ts` | Cookie sessão |
| `useClienteStore` | `features/cliente/clienteStore.ts` | Cookie cliente |
| `useOsFiltersStore` | `features/os/osFiltersStore.ts` | localStorage |
| `useOsSelectionStore` | `features/os/osSelectionStore.ts` | Memória |
| `usePcpConfigStore` | `features/pcp/pcpConfigStore.ts` | localStorage |
| `usePainelConfigStore` | `features/painel-global/painelConfigStore.ts` | localStorage |

## Apêndice B — WebSocket

| Tipo mensagem | Efeito no front |
|---------------|-----------------|
| `system_update` | Refresh busca OS |
| `pcp_queue_update` | Refresh fila PCP |
| `force_refresh` | Reload página (admin) |
| `ping` / `pong` | Keepalive |

## Apêndice C — Variáveis de ambiente (nomes apenas)

Fonte: `config/.env.example` — **sem valores**.

`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `MASTER_IP`, `PORT`, `ENV`, `MYSQL_ONLY`, `SYNC_ANDAMENTOS_ENABLED`, `SAGRA_SESSION_SECRET`, `SAGRA_SESSION_SECURE`, `SAGRA_PUBLIC_WEB_BASE`, `SAGRA_CORS_ORIGINS`, `EWS_USERNAME`, `EWS_PASSWORD`, `EWS_URL`, `SAGRA_PORTAL_UPLOAD_GDRIVE`, `SAGRA_GDRIVE_CREDENTIALS_DIR`, `SAGRA_DB_POOL_SIZE`, `SAGRA_PAINEL_SKIP_IP_CHECK`, `SAGRA_RATE_LIMIT_ENABLED`, `TESSERACT_CMD`, `SAGRA_PREANALISE_*`, `VITE_DEV_PORT`.

---

*Documento gerado por análise estática do código em `C:\dev\SagraWeb` e configuração em `\\cgrafsysvm`. Nenhum arquivo do sistema foi modificado. Validar comportamento em homologação antes de publicar manuais.*
