# INVENTÁRIO COMPLETO DO SISTEMA

**Projeto:** SagraWeb (`c:\dev\SagraWeb`)  
**Data do inventário:** 06/06/2026  
**Escopo:** Análise somente leitura — nenhum código alterado.  
**Objetivo:** Base para manual operacional completo do sistema.

---

## 1. Visão Geral do Sistema

### Nome do sistema
**SAGRA Web** — Sistema de Acompanhamento Gráfico (DEAPA / SEFOC / Câmara dos Deputados).

### Objetivo
Gerenciar o ciclo de vida de **Ordens de Serviço (OS)** gráficas: busca, criação, edição, histórico, vinculações, análise técnica de qualidade, e-mail (Exchange), papelaria, PCP (fila de produção), gravação (Xpose), relatórios, painéis operacionais em tempo real e portais externos para clientes (gabinetes/deputados).

### Público-alvo
- Operadores internos da produção gráfica (SEFOC)
- Analistas de qualidade
- PCP / planejamento
- Administradores de sistema e permissões
- Deputados/gabinetes (portal cliente e portais por token)
- Monitores/TVs de setor (painéis sem login)

### Perfis de usuário

| Perfil | Autenticação | Descrição |
|--------|--------------|-----------|
| **Operador LAN** | Ponto + nome (`POST /api/auth/session`) | Terminal interno; permissões baseadas em IP |
| **Operador externo** | E-mail/ponto + senha (`POST /api/auth/login`) | Acesso via internet (Cloudflare/zrok); overlay de permissões por usuário |
| **MASTER** | IP privilegiado (`10.120.1.14`, servidor local, loopback) | Acesso total; rotas `/api/admin/*` |
| **Admin IPs** | IP + permissão `sb_admin_ips` | Gestão de IPs, configurações de sistema, templates de e-mail |
| **Admin usuários** | IP + permissão `sb_usuarios` | Cadastro de usuários, permissões individuais, clientes gabinete |
| **Cliente gabinete** | E-mail + senha (`POST /api/auth/cliente/login`) | Portal `/cliente` — acompanhamento de OS próprias |
| **Portal anônimo** | Token na URL | PT, prova, upload de arquivos, aprovação — sem login staff |
| **Painel TV** | Nenhuma (GET anônimo) | `/painel/setor`, `/painel/global` |

### Principais módulos

| Módulo | Rota front | Router back-end | Estado |
|--------|-----------|-----------------|--------|
| Início / Busca OS | `/` | `os_routes.py` | **Pronto** (React) |
| Gerência OS | `/gerencia` | `os_routes.py`, `auxiliar_routes.py` | **Pronto** |
| E-mail / Exchange | `/email` | `email_routes.py` | **Pronto** |
| Análise técnica | `/analise` | `analise_routes.py`, `pre_analise_routes.py` | **Pronto** |
| Papelaria | `/papelaria` | `papelaria_routes.py` | **Pronto** (aba legado parcial) |
| Relatórios | `/relatorios` | `report_custom_routes.py` | **Pronto** |
| PCP | `/pcp` | `pcp_routes.py` | **Pronto** |
| Gravação | `/gravacao` | `gravacao_routes.py` | **Pronto** (legado PrintQ compat.) |
| Painel setor | `/painel/setor` | `os_routes.py`, `pcp_routes.py`, `realtime.py` | **Pronto** |
| Painel global | `/painel/global` | `os_routes.py`, `realtime.py` | **Pronto** |
| Usuários / Admin | `/usuarios`, `/admin/ips`, `/admin/configuracoes` | `user_admin_routes.py`, `ip_admin_routes.py`, `admin_system_routes.py` | **Pronto** |
| Portais token | `/portal/*` | `analise_routes.py`, `proof_portal_routes.py`, `os_arquivos_routes.py` | **Pronto** |
| Portal cliente | `/cliente/*` | `cliente_gabinete_routes.py` | **Pronto** |
| Impressão ficha | `/impressao/requisicao/$ano/$id` | `requisicao_routes.py` | **Pronto** |
| Sync andamentos | *(sem rota React)* | `sync_routes.py` | **Condicional/desabilitado** |
| UI legada HTML | `app/frontend/*.html` | — | **Em migração** → React |

### Tecnologias principais

**Front-end (SPA React — `apps/web/`):**
- React 19, TypeScript 5.7+, Vite 6
- TanStack Router, TanStack Query v5, Zustand
- React Hook Form + Zod, Tailwind CSS v4, Radix/shadcn
- @dnd-kit (PCP), Chart.js (painel global), pdf.js (análise/portais)
- PWA (workbox), WebSocket nativo

**Back-end (`app/backend/`):**
- Python, FastAPI 7.x, Uvicorn `:8001`
- MySQL 8 (`sagrafulldb`) — fonte da verdade
- Microsoft Access MDB (dual-write assíncrono, opcional)
- Exchange EWS (`services/ews_service.py`)
- PyMuPDF, Tesseract OCR (pré-análise)
- WebSocket (`routers/realtime.py`)

**Infra:**
- Nginx (proxy `/sagra/` → static + API)
- Cloudflare Tunnel (`cgraf.online`)
- zrok (`sagra-painel.shares.zrok.io` — painéis)
- Monorepo pnpm (`apps/web`, `packages/ui`, `packages/api-types`)

---

## 2. Mapa Geral de Rotas Front-end

> **Gerado em:** `apps/web/src/routeTree.gen.ts` (TanStack Router file-based)

| Caminho | Arquivo da rota | Nome da página | Objetivo | Permissão | Componentes principais | APIs consumidas | Estado | Observações |
|---------|-----------------|----------------|----------|-----------|------------------------|-----------------|--------|-------------|
| `/` | `routes/_authenticated/index.tsx` | OsHomePage | Busca e gestão de OS | `sb_inicio` | OsFiltersPanel, OsOrdersTable, OsDetailsPanel, OsHistoryPanel, modais | `GET /api/os/search`, details, history, vinculos, audit-log | **Pronta** | WS tempo real; filtros salvos |
| `/gerencia` | `routes/_authenticated/gerencia.tsx` | GerenciaPage | Criar/editar/duplicar OS | `sb_gerencia` | GerenciaFormGrid, NovaOsArquivosModal | `POST /api/os/save`, `GET /api/os/next_id`, aux lookups, folder-* | **Pronta** | Lazy-loaded; **não está no sidebar** |
| `/email` | `routes/_authenticated/email.tsx` | EmailPage | Inbox Exchange, pendências, PT | `sb_email` | EmailListPanel, EmailInboxDetail, EmailPendenciaDetail, EmailConfigPanel | `/api/email/*` | **Pronta** | Lazy-loaded; badge no menu |
| `/analise` | `routes/_authenticated/analise.tsx` | AnalisePage | Análise técnica de qualidade | `sb_analise` | AnaliseItemsTree, AnaliseHtmlEditor, PreAnalisePanel | `/api/analise/*`, `/api/files/*`, pre-analise | **Pronta** | Requer `?ano=&id=`; lazy-loaded |
| `/papelaria` | `routes/_authenticated/papelaria.tsx` | PapelariaPage | Cartões e modelos Corel | `sb_papelaria` | PapelariaCartaoSvgPanel, aba legado | `/api/papelaria/*` | **Pronta/parcial** | Aba "Corel/PDF legado"; exige OS > 5000 |
| `/relatorios` | `routes/_authenticated/relatorios.tsx` | RelatorioPage | Relatórios customizados | `sb_relatorio` | RelatorioFiltersPanel | `POST /api/reports/custom`, `/xlsx` | **Pronta** | Lazy-loaded |
| `/pcp` | `routes/_authenticated/pcp.tsx` | PcpPage | Fila kanban por setor | `sb_pcp` | PcpColumnWrapper, PcpSettingsModal | `GET/POST /api/pcp/queue` | **Pronta** | Drag-and-drop; WS refresh |
| `/gravacao` | `routes/_authenticated/gravacao.tsx` | GravacaoPage | Monitor Xpose/PrintQ | `sb_gravacao` | Tabelas jobs/paths | `GET /api/gravacao/*`, WS `/api/ws/jobs` | **Pronta** | Suporte payload legado PrintQ |
| `/usuarios` | `routes/_authenticated/usuarios.tsx` | UsuariosPage | Admin usuários e clientes | `sb_usuarios` | UserAdminPanel, ClienteCadastroForm | `/api/admin/users/*`, `/api/admin/clientes/*` | **Pronta** | Master para CRUD clientes |
| `/admin/ips` | `routes/_authenticated/admin/ips.tsx` | AdminIpsPage | Matriz de IPs | `sb_admin_ips` | Tabela IPs, solicitações acesso | `/api/admin/ip/*`, `/api/access-request` | **Pronta** | Master para mutações |
| `/admin/configuracoes` | `routes/_authenticated/admin/configuracoes.tsx` | ConfiguracoesPage | Pré-análise e templates e-mail | `sb_admin_ips` | PreAnaliseChecksSection, EmailTemplatesSection | `/api/admin/system/*` | **Pronta** | Mesma permissão que Admin IPs |
| `/impressao/requisicao/$ano/$id` | `routes/_authenticated/impressao/requisicao.$ano.$id.tsx` | RequisicaoPrintPage | Ficha/requisição para impressão | `ctx_imprimir_ficha` | Viewer HTML + auto-print | `GET /api/reports/requisicao/{ano}/{id}` | **Pronta** | Search: `mode`, `print` |
| `/$` (splat) | `routes/_authenticated/$.tsx` | ModulePlaceholderPage | Placeholder migração | Sessão apenas | Texto estático | — | **Em migração** | Rotas legadas não migradas |
| `/login` | `routes/login.index.tsx` | Login | Auth staff | Pública | Form ponto/senha | `/api/auth/session`, `/api/auth/login` | **Pronta** | Redirect se autenticado |
| `/login/activate` | `routes/login.activate.tsx` | Ativação staff | Ativar conta internet | Pública | Form ativação | `/api/auth/activate/*` | **Pronta** | Token 48h |
| `/login/forgot` | `routes/login.forgot.tsx` | Esqueci senha | Solicitar reset | Pública | Form e-mail | `POST /api/auth/forgot-password` | **Pronta** | Apenas internet |
| `/login/reset` | `routes/login.reset.tsx` | Redefinir senha | Nova senha | Pública | Form senha | `/api/auth/reset-password/*` | **Pronta** | Token 1h |
| `/painel/setor` | `routes/painel/setor.tsx` | DashboardSetorPage | Painel TV setor | Sidebar `sb_dashboard_setor` *(sem guard)* | Colunas OS, alertas, settings | `GET /api/os/search`, WS | **Pronta** | Sem AppShell; acesso direto URL |
| `/painel/global` | `routes/painel/global.tsx` | PainelGlobalPage | Painel TV global | Sidebar `sb_dashboard_global` *(sem guard)* | Gráficos Chart.js, colunas | `GET /api/os/search`, WS | **Pronta** | Sem AppShell |
| `/portal/aprovacao/$token` | `routes/portal/aprovacao.$token.tsx` | PortalAprovacaoPage | Aprovar/reprovar prova | Token | PDF viewer, form resposta | `/api/client/proof/*` | **Pronta** | Query: `?os=&ano=` |
| `/portal/os-arquivos/$token` | `routes/portal/os-arquivos.$token.tsx` | PortalOsArquivosPage | Upload arquivos nova OS | Token | Drag-drop upload | `/api/client/os-arquivos/*` | **Pronta** | GDrive opcional |
| `/portal/prova/$token` | `routes/portal/prova.$token.tsx` | PortalProvaPage | Comprovante PT read-only | Token | PDF viewer | `/api/client/report/*` | **Pronta** | |
| `/portal/pt/$token` | `routes/portal/pt.$token.tsx` | PortalPtPage | Portal PT interativo | Token | Upload, desconsiderar, identidade | `/api/analise/client/*`, `/api/client/*` | **Pronta** | |
| `/cliente` | `routes/cliente/index.tsx` | ClienteDashboardPage | Dashboard gabinete | ClienteAuthGuard | ClienteOsList, ClienteOsTimeline, ClienteContasPanel | `/api/cliente/*` | **Pronta** | Cookie `sagra_cliente_session` |
| `/cliente/login` | `routes/cliente/login.index.tsx` | ClienteLoginPage | Login gabinete | Pública | Form e-mail/senha | `POST /api/auth/cliente/login` | **Pronta** | |
| `/cliente/login/activate` | `routes/cliente/login.activate.tsx` | Ativação cliente | Ativar conta gabinete | Pública | Form ativação | `/api/auth/cliente/activate/*` | **Pronta** | Query: `?token=` |

**Layouts:**
- `routes/_authenticated.tsx` — AuthGuard + AppShell (Header + Sidebar)
- `routes/painel.tsx` — Full-screen TV, sem sidebar
- `routes/portal.tsx` — PortalLayout público
- `routes/login.tsx` — Layout auth staff
- `routes/cliente/login.tsx` — Layout auth cliente

**Lazy-loaded (6):** `/gerencia`, `/email`, `/analise`, `/relatorios`, `/pcp`, `/gravacao`

---

## 3. Inventário Detalhado de Páginas

### 3.1 Início (OsHomePage)

- **Rota:** `/`
- **Arquivo:** `apps/web/src/features/os/components/OsHomePage.tsx`
- **Objetivo:** Hub central — buscar OS, ver detalhes, histórico, ações de contexto
- **Usuário-alvo:** Todos os operadores com `sb_inicio`
- **Como acessar:** Menu lateral "Início" ou URL `/`
- **Permissões:** `sb_inicio`; ações de contexto exigem `ctx_*`
- **Dados ao abrir:** Filtros do store (`osFiltersStore`), filtros salvos (`GET /api/settings/filters/saved/{ponto}`), preferências default (`GET /api/settings/filtros/ponto/{ponto}`), busca OS (`GET /api/os/search`)
- **Estados:** carregando (query), erro (query error), vazio (0 rows), sucesso, bloqueado (AuthGuard → `/login`)
- **Componentes:** OsFiltersPanel, OsOrdersTable, OsDetailsPanel, OsHistoryPanel, OsRowContextMenu, OsNotificationHandler, SettingsModal, OsVincularModal, OsAuditLogModal, OsPrintModeModal, OsPrintFichaModal, OsFolderBrowserModal
- **APIs:** `searchOs`, `fetchOsDetails`, `fetchOsHistory`, `fetchOsAuditLog`, `fetchOsPath`, vinculos CRUD, saved filters
- **Stores/hooks:** `useOsFiltersStore`, `useOsSelectionStore`, `useOsSearch`, `useOsRealtimeSync`, `useAccessControl`, `useAuthStore`
- **Fluxo:** Aplicar filtros → debounce 250ms → busca paginada → selecionar linha → painel detalhes/histórico → menu contexto para ações
- **Riscos:** Performance com milhares de OS; WS pode causar refresh concorrente
- **Validação manual:** Filtros salvos, paginação, ordenação, menu contexto por permissão, refresh manual vs WS

### 3.2 Gerência (GerenciaPage)

- **Rota:** `/gerencia?ano=&id=&action=&type=&modo=`
- **Arquivo:** `apps/web/src/features/gerencia/components/GerenciaPage.tsx`
- **Objetivo:** Criar, editar, duplicar OS; especificação técnica; pasta de rede
- **Usuário-alvo:** Operadores com `sb_gerencia`
- **Como acessar:** Menu contexto OS (Nova/Editar/Duplicar/Detalhes) — **não no sidebar**
- **Permissões:** `sb_gerencia`; contexto: `ctx_nova_os`, `ctx_editar_os`, `ctx_duplicar_os`
- **Dados ao abrir:** Aux lookups (setores, situações, produtos, etc.), OS existente se `ano/id`, próximo ID se `action=new`
- **Estados:** carregando aux/OS, erro save, vazio (nova OS), sucesso, bloqueado
- **Componentes:** GerenciaFormGrid, NovaOsArquivosModal
- **APIs:** `saveOs`, `fetchNextOsId`, `fetchOsDetails`, `fetchOsFolderPlan`, `createOsFolder`, aux endpoints
- **Fluxo:** Carregar form → preencher → salvar → modal arquivos (nova OS) → opcional e-mail cliente
- **Riscos:** Dual-write MDB pode falhar silenciosamente (mensagem no save)
- **Validação manual:** Nova OS normal vs papelaria, duplicação, browse/criação pasta UNC

### 3.3 E-mail (EmailPage)

- **Rota:** `/email`
- **Arquivo:** `apps/web/src/features/email/components/EmailPage.tsx`
- **Objetivo:** Gerenciar e-mails Exchange, pendências, envio PT, andamentos
- **Usuário-alvo:** Operadores com `sb_email`
- **Permissões:** `sb_email`; config exige sessão (`require_session`)
- **Dados:** Inbox, pendências, config Exchange, status notificação
- **APIs:** `/api/email/inbox`, `/pendencias`, `/config`, `/send`, `/send-pt`, `/andamento`, `/save-mht`, `/mark-read`
- **Estado:** **Pronta** — Exchange real (não mock)
- **Validação manual:** Conectar Exchange, listar pastas, enviar PT, registrar andamento

### 3.4 Análise (AnalisePage)

- **Rota:** `/analise?ano=&id=`
- **Arquivo:** `apps/web/src/features/analise/components/AnalisePage.tsx`
- **Objetivo:** Análise técnica completa — itens, HTML, pré-análise PDF, links cliente, movimentos
- **Usuário-alvo:** Analistas com `sb_analise`
- **Permissões:** `sb_analise`
- **Dados:** `ensureAnalise`, `fetchAnaliseFull`, problemas padrão, versões PDF, pré-análise checks
- **Componentes:** AnaliseItemsTree, AnaliseHtmlEditor, PreAnalisePanel, AnaliseAnnotationModal, PageDivergenceModal, modais obs/arquivo inline
- **APIs:** Todos em `api/analise.ts`, `api/preAnalise.ts`
- **Estado:** **Pronta** — `PreAnaliseModal.tsx` existe mas **não é usado** (substituído por PreAnalisePanel)
- **Validação manual:** Adicionar item, finalizar análise, gerar link PT, pré-análise streaming, anotações PDF

### 3.5 Papelaria (PapelariaPage)

- **Rota:** `/papelaria`
- **Arquivo:** `apps/web/src/features/papelaria/components/PapelariaPage.tsx`
- **Objetivo:** Produção de cartões (SVG) e preview Corel legado
- **Usuário-alvo:** Operadores com `sb_papelaria`
- **Permissões:** `sb_papelaria`; sidebar exige OS selecionada com `nr_os > 5000`
- **APIs:** `/api/papelaria/modelos`, `/svg/*`, `/preview`
- **Estado:** **Pronta/parcial** — aba Corel legado depende de Windows + win32com + UNC
- **Validação manual:** Render SVG, export, preview Corel (somente Windows)

### 3.6 Relatórios (RelatorioPage)

- **Rota:** `/relatorios`
- **Arquivo:** `apps/web/src/features/relatorio/components/RelatorioPage.tsx`
- **Objetivo:** Relatórios customizados HTML/XLSX
- **Permissões:** `sb_relatorio`
- **APIs:** `POST /api/reports/custom`, `/custom/xlsx`
- **Estado:** **Pronta**

### 3.7 PCP (PcpPage)

- **Rota:** `/pcp`
- **Arquivo:** `apps/web/src/features/pcp/components/PcpPage.tsx`
- **Objetivo:** Fila kanban multi-setor com reordenação drag-and-drop
- **Permissões:** `sb_pcp`
- **APIs:** `GET /api/pcp/queue`, `POST /api/pcp/queue/reorder`
- **Stores:** `usePcpConfigStore` (setor selecionado persistido)
- **Estado:** **Pronta** — WS `pcp_queue_update`

### 3.8 Gravação (GravacaoPage)

- **Rota:** `/gravacao`
- **Arquivo:** `apps/web/src/features/gravacao/components/GravacaoPage.tsx`
- **Objetivo:** Monitorar jobs Xpose e paths CTP
- **Permissões:** `sb_gravacao`
- **APIs:** `/api/gravacao/xpose/status`, WS `/api/ws/jobs`
- **Estado:** **Pronta** — compatível payload PrintQ legado

### 3.9 Usuários (UsuariosPage)

- **Rota:** `/usuarios`
- **Arquivo:** `apps/web/src/features/usuarios/components/UsuariosPage.tsx`
- **Objetivo:** CRUD usuários staff, permissões, setor, defaults painel; cadastro clientes gabinete
- **Permissões:** `sb_usuarios` (UI); endpoints admin exigem Master
- **APIs:** `/api/admin/users/*`, `/api/admin/clientes/*`, `/api/users/online`
- **Estado:** **Pronta**

### 3.10 Admin IPs (AdminIpsPage)

- **Rota:** `/admin/ips`
- **Arquivo:** `apps/web/src/features/admin-ips/components/AdminIpsPage.tsx`
- **Objetivo:** Matriz RBAC por IP, grupos, solicitações de acesso
- **Permissões:** `sb_admin_ips` (UI); mutações Master
- **APIs:** `/api/admin/ip/*`, `/api/access-request`, `/api/admin/access-requests`
- **Estado:** **Pronta**

### 3.11 Configurações (ConfiguracoesPage)

- **Rota:** `/admin/configuracoes`
- **Arquivo:** `apps/web/src/features/configuracoes/components/ConfiguracoesPage.tsx`
- **Objetivo:** Checks pré-análise desabilitáveis; templates e-mail admin
- **Permissões:** `sb_admin_ips`
- **APIs:** `/api/admin/system/pre-analise-checks`, `/email-templates/*`
- **Estado:** **Pronta**

### 3.12 Painel Setor (DashboardSetorPage)

- **Rota:** `/painel/setor`
- **Arquivo:** `apps/web/src/features/dashboard-setor/components/DashboardSetorPage.tsx`
- **Objetivo:** Dashboard TV por setor — colunas OS, alertas prioridade, wake lock
- **Permissões:** Sidebar `sb_dashboard_setor` + `painelSetores[]`; **rota sem AuthGuard**
- **APIs:** `GET /api/os/search`, `GET /api/pcp/queue`, WS; defaults `GET /api/settings/setor-painel-default/{setor}`
- **Estado:** **Pronta** — exposto via zrok (`iniciar-zrok-painel.bat`)

### 3.13 Painel Global (PainelGlobalPage)

- **Rota:** `/painel/global`
- **Arquivo:** `apps/web/src/features/painel-global/components/PainelGlobalPage.tsx`
- **Objetivo:** Visão global produção — gráficos, colunas, tema/mute
- **Permissões:** Sidebar `sb_dashboard_global`; **rota sem AuthGuard**
- **APIs:** `fetchPainelQueueBySetor`, fallback `fetchPainelLegacyBySetor` via `/api/os/search`
- **Estado:** **Pronta**

### 3.14 Portais por Token

| Página | Arquivo | Token | APIs |
|--------|---------|-------|------|
| PortalAprovacaoPage | `features/portal/PortalAprovacaoPage.tsx` | `$token` path + `?os=&ano=` | `proof-portal.ts` |
| PortalPtPage | `features/portal/PortalPtPage.tsx` | idem | `client-portal.ts` |
| PortalProvaPage | `features/portal/PortalProvaPage.tsx` | idem | `client-portal.ts` |
| PortalOsArquivosPage | `features/portal/PortalOsArquivosPage.tsx` | idem | `osArquivos.ts` |

**Estado:** **Prontas** — sem login staff; validação token no back-end

### 3.15 Portal Cliente Gabinete

- **Rota:** `/cliente`, `/cliente/login`, `/cliente/login/activate`
- **Arquivos:** `features/cliente/components/*`, `clienteStore.ts`
- **Objetivo:** Deputados/gabinetes acompanham OS, timeline, sub-contas
- **Permissões:** Cookie `sagra_cliente_session`
- **Estado:** **Pronta**

### 3.16 Login / Auth Staff

- **Arquivos:** `routes/login.*.tsx`, `features/auth/authStore.ts`, `features/auth/api.ts`
- **Modos:** LAN (ponto+nome) vs internet (e-mail/ponto+senha)
- **Estado:** **Pronta** — fail-open bloqueado (sem permissões → logout)

### 3.17 Impressão Requisição

- **Rota:** `/impressao/requisicao/$ano/$id`
- **Arquivo:** `features/os/components/RequisicaoPrintPage.tsx`
- **Permissão:** `ctx_imprimir_ficha`
- **API:** `GET /api/reports/requisicao/{ano}/{id}`
- **Estado:** **Pronta**

### 3.18 Placeholder Migração

- **Rota:** `/$` (splat autenticado)
- **Arquivo:** `routes/_authenticated/$.tsx`
- **Estado:** **Em migração** — exibe "Módulo em migração"

---

## 4. Inventário de Botões e Ações da Interface

### 4.1 Header global (`components/layout/Header.tsx`)

| Botão | Condição | Permissão | Ação | Função | API | Teste |
|-------|----------|-----------|------|--------|-----|-------|
| Notificações (sino) | Sempre visível (sm+) | Nenhuma | Nenhuma | — | — | **Stub** — badge fixo 0, title "em breve" |
| Sair | Autenticado | Sessão | Logout + redirect | `handleLogout` → `authStore.logout()` | `POST /api/auth/logout` | Clicar Sair → `/login` |

### 4.2 Sidebar (`components/layout/Sidebar.tsx`)

| Item | Rótulo | Arquivo | Condição | Permissão | Ação |
|------|--------|---------|----------|-----------|------|
| Nav link | Início, E-mail, Análise, ... | `nav-config.ts` | `getVisibleNavItems()` | `sb_*` respectivo | Navegação React Router |
| Painel setor/global | Painel setor/global | Sidebar | `opensInNewWindow: true` | `sb_dashboard_*` | `openPainelInNewWindow()` — nova janela fullscreen |
| Recolher menu | Chevron | Sidebar | md+ | — | `onToggle()` collapse |
| Badge E-mail | Contador | Sidebar | `sb_email` + counts > 0 | `sb_email` | `useEmailNotificationStatus` → `/api/email/notification_status` |

**Análise/Papelaria:** Links incluem search params `ano`, `id` da OS selecionada (`useOsSelectionStore`).

### 4.3 Menu de contexto OS (`features/os/components/OsContextMenu.tsx`)

| Ação | Rótulo | Permissão | Função | API / Navegação |
|------|--------|-----------|--------|-----------------|
| new | Nova OS | `ctx_nova_os` | `handleAction("new")` | Confirm papelaria → `/gerencia?action=new&type=` |
| duplicate | Duplicar OS | `ctx_duplicar_os` | `handleAction("duplicate")` | `/gerencia?action=duplicate&ano=&id=` |
| edit | Editar OS | `ctx_editar_os` | `goGerencia()` | `/gerencia?ano=&id=` |
| details | Detalhes da OS | `ctx_detalhes_os` | `goGerencia({modo:"detalhes"})` | `/gerencia?modo=detalhes` |
| history | Histórico | `ctx_detalhes_os` | Event `sagra:os-audit-log` | Abre OsAuditLogModal |
| link | Vincular OS | `ctx_vincular_os` | Event `sagra:os-vincular` | Abre OsVincularModal |
| folder | Abrir Pasta de Rede | `ctx_abrir_pasta` | `openNetworkFolder()` | `GET /api/os/{ano}/{id}/path` + `tryOpenFolderLocally()` |
| print | Imprimir Ficha | `ctx_imprimir_ficha` | Event `sagra:os-print-ficha` | Abre OsPrintModeModal |

**Sem permissão:** `window.alert("Você não tem permissão para esta ação.")`

### 4.4 OsHomePage — filtros e toolbar

| Botão | Componente | Função | API |
|-------|------------|--------|-----|
| Atualizar | OsFiltersPanel | `handleRefresh` | `silentRefreshOsSearch` → `GET /api/os/search` |
| Limpar filtros | OsFiltersPanel | `handleResetFilters` | Local store |
| Filtro salvo | OsFiltersPanel | `handleSavedFilterChange` | Aplica filtro local |
| Configurações filtros | OsHomePage | `setSettingsOpen(true)` | `sb_configuracoes` — SettingsModal |
| Lista/Detalhes (mobile) | OsHomePage | Toggle `mobileView` | — |

### 4.5 Modais OS (botões internos resumidos)

| Modal | Arquivo | Botões principais | APIs |
|-------|---------|-------------------|------|
| SettingsModal | `features/settings/components/SettingsModal.tsx` | Salvar filtro, definir padrão, excluir | `/api/settings/filters/saved/*` |
| OsVincularModal | `features/os/components/OsVincularModal.tsx` | Vincular, exceção | `POST /api/os/{ano}/{id}/vincular`, `/vinculo/excecao` |
| OsAuditLogModal | `features/os/components/OsAuditLogModal.tsx` | Fechar | `GET /api/os/{ano}/{id}/audit-log` |
| OsPrintModeModal | `features/os/components/OsPrintModeModal.tsx` | Normal / Prova | Abre OsPrintFichaModal |
| OsPrintFichaModal | `features/os/components/OsPrintFichaModal.tsx` | Imprimir | `/impressao/requisicao/` ou HTML |
| OsFolderBrowserModal | `features/os/components/OsFolderBrowserModal.tsx` | Navegar, criar pasta | `/api/os/{ano}/{id}/folder-browse`, `/folder-create` |
| OsDecisaoSaidaModal | `features/os/components/OsDecisaoSaidaModal.tsx` | Confirmar saída | `POST /api/os/{ano}/{id}/history` |

### 4.6 AnalisePage — ações principais

| Botão/Chip | Função | API |
|------------|--------|-----|
| Finalizar análise | `handleFinish` | `POST /api/analise/finalize/{ano}/{os_id}` |
| Registrar PT | `handleRegisterPt` | `POST /api/analise/register-ptv-dispatch` |
| Replicar PT | `handleReplicatePt` | Movimentos + save |
| Anotação PDF | `handleOpenAnnotation` | AnaliseAnnotationModal |
| Pré-análise executar | `handleRunPreAnalise` | `streamPreAnaliseRunAll` → `/pre-analise/run-all/stream` |
| Gerar link cliente | generate link flow | `POST /api/analise/{ano}/{os_id}/generate-link` |
| Adicionar item biblioteca | `addProblemaPadrao` mutation | `POST /api/analise/problemas-padrao/add` |
| Toggle resolução obrigatória | mutation | `POST /api/analise/item/toggle-resolucao-obrigatoria` |

### 4.7 GerenciaPage

| Botão | Função | API |
|-------|--------|-----|
| Salvar OS | save mutation | `POST /api/os/save` |
| Browse pasta | folder modal | `/folder-browse`, `/folder-plan`, `/folder-create` |
| Enviar arquivos (pós-criação) | NovaOsArquivosModal | `/api/os/{ano}/{os_id}/arquivos/enviar-email` |

### 4.8 EmailPage

| Ação | Componente | API |
|------|------------|-----|
| Conectar Exchange | EmailConfigPanel | `POST /api/email/config/connect` |
| Salvar config | EmailConfigPanel | `PUT /api/email/config` |
| Enviar e-mail | EmailInboxDetail | `POST /api/email/send` |
| Enviar PT | EmailInboxDetail | `POST /api/email/send-pt` |
| Registrar andamento | EmailInboxDetail/Pendencia | `POST /api/email/andamento` |
| Salvar MHT | Detail | `POST /api/email/save-mht` |
| Marcar lido | Detail | `POST /api/email/mark-read` |

### 4.9 PCP

| Ação | Função | API |
|------|--------|-----|
| Drag reorder | DnD handler | `POST /api/pcp/queue/reorder` |
| Configurações | PcpSettingsModal | Local store `usePcpConfigStore` |

### 4.10 Painéis TV

| Botão | Página | Função |
|-------|--------|--------|
| Configurações (engrenagem) | DashboardSetorPage, PainelGlobalPage | Abre modal settings — colunas, import/export JSON, limpar cache |
| Mute/som | PainelGlobalPage | Toggle áudio alertas |
| Detalhe coluna | PainelGlobalPage | Modal coluna |

### 4.11 Portais token

| Portal | Botões | API |
|--------|--------|-----|
| Aprovação | Aprovar, Reprovar, comentário | `POST /api/client/proof/respond` |
| PT | Upload, Desconsiderar, Confirmar identidade | `/api/client/upload-*`, `/desconsiderar-item`, `/resolver-item` |
| OS Arquivos | Upload drag-drop, Finalizar | `/api/client/os-arquivos/*` |
| Prova | Visualizar PDF | `GET /api/client/proof/{ano}/{os_id}/pdf` |

### 4.12 Login / Logout / Recuperação

| Tela | Botão | Função | API |
|------|-------|--------|-----|
| `/login` | Entrar (ponto) | `authStore.login` | `POST /api/auth/session` |
| `/login` | Entrar (senha) | `authStore.loginPassword` | `POST /api/auth/login` |
| `/login/activate` | Ativar | `activateAccount` | `POST /api/auth/activate` |
| `/login/forgot` | Enviar | `requestPasswordReset` | `POST /api/auth/forgot-password` |
| `/login/reset` | Redefinir | `resetPassword` | `POST /api/auth/reset-password` |
| Header | Sair | `authStore.logout` | `POST /api/auth/logout` |
| Cliente login | Entrar | `clienteStore.login` | `POST /api/auth/cliente/login` |

### 4.13 Admin

| Página | Botões | APIs |
|--------|--------|------|
| AdminIpsPage | Adicionar IP, Editar, Excluir, Aprovar solicitação | `/api/admin/ip/*` |
| UsuariosPage | Cadastrar usuário, Editar permissões, Force refresh WS, Cadastrar cliente | `/api/admin/users/*`, `POST /api/realtime/notify` |
| ConfiguracoesPage | Salvar checks, Upload template, Preview, Enviar teste, Reset template | `/api/admin/system/*` |

---

## 5. Inventário de Formulários

### 5.1 Login staff (`routes/login.index.tsx`)

| Campo | Obrigatório | Validação | Endpoint |
|-------|-------------|-----------|----------|
| Ponto (LAN) | Sim | numérico | `POST /api/auth/session` `{ponto, nome}` |
| Nome (LAN) | Sim | texto | |
| Login (internet) | Sim | e-mail ou ponto | `POST /api/auth/login` `{login, password}` |
| Senha (internet) | Sim | min via Zod schema | |

**Após salvar:** Redirect para `/` ou `?redirect=`; cookie `sagra_session` HttpOnly.

### 5.2 Ativação staff (`routes/login.activate.tsx`)

| Campo | Endpoint |
|-------|----------|
| Token (query) | `GET /api/auth/activate/check?token=` |
| Senha, confirmar | `POST /api/auth/activate` |

### 5.3 Recuperação senha

| Form | Campos | Endpoint |
|------|--------|----------|
| Forgot | E-mail/login | `POST /api/auth/forgot-password` |
| Reset | Token + nova senha | `POST /api/auth/reset-password` |

### 5.4 Gerência OS (`GerenciaFormGrid.tsx`)

Campos principais (controlados): nr_os, ano, titulo, solicitante, produto, setor, situação, prioridade, especificação técnica (múltiplos subcampos MDB), deputado/protocolo lookup, observações.

| Aspecto | Detalhe |
|---------|---------|
| Validação | Client-side + resposta API |
| Endpoint | `POST /api/os/save` |
| Payload | `SaveOsPayload` (`api/os.ts`) |
| Após salvar | Toast/alert; NovaOsArquivosModal se nova OS; navegação |

### 5.5 Filtros OS (`OsFiltersPanel.tsx`)

Campos: nr_os, ano, produto, titulo, solicitante, prioridade[], situação[], setor[], paginação, ordenação. Sem submit — debounce → search API.

### 5.6 Filtros salvos (`SettingsModal.tsx`)

| Campo | Endpoint |
|-------|----------|
| Nome filtro, situações, setores | `POST /api/settings/filters/saved` |
| Definir padrão | `POST /api/settings/filters/saved/default` |

### 5.7 Histórico OS (`OsHistoryPanel.tsx`, `OsDecisaoSaidaModal.tsx`)

| Ação | Endpoint |
|------|----------|
| Adicionar andamento | `POST /api/os/{ano}/{id}/history` |
| Editar | `PUT /api/os/{ano}/{id}/history` |
| Excluir | `DELETE /api/os/{ano}/{id}/history/{cod_status}` |
| Replicar | `POST /api/os/{ano}/{id}/history/replicate` |

### 5.8 Análise — observação modal

Campos: observação texto → `handleConfirmObservacao` → meta PATCH ou save.

### 5.9 E-mail config (`EmailConfigPanel.tsx`)

Campos: servidor, usuário, senha, pasta inbox, pasta pendências → `PUT /api/email/config`.

### 5.10 Relatório (`RelatorioFiltersPanel.tsx`)

Campos: período, setores, situações, colunas → `POST /api/reports/custom`.

### 5.11 Admin usuário (`UserAdminPanel.tsx`)

Campos: ponto, nome, e-mail, setor, matriz permissões → `/api/admin/users`, `/permissions`.

### 5.12 Cliente gabinete

| Form | Arquivo | Endpoint |
|------|---------|----------|
| Login | ClienteLoginPage | `POST /api/auth/cliente/login` |
| Sub-conta | ClienteContasPanel | `POST /api/cliente/contas` |
| Cadastro admin | ClienteCadastroForm | `POST /api/admin/clientes` |

### 5.13 Portal aprovação

Campos: decisão (aprovar/reprovar), comentário opcional → `POST /api/client/proof/respond`.

---

## 6. Inventário de Modais

| Nome | Página | Arquivo | Abertura | Fechamento | APIs |
|------|--------|---------|----------|------------|------|
| SettingsModal | Início | `features/settings/components/SettingsModal.tsx` | Botão config filtros | X / overlay | filters CRUD |
| OsVincularModal | Início | `features/os/components/OsVincularModal.tsx` | Event `sagra:os-vincular` | Cancelar/X | vincular API |
| OsAuditLogModal | Início | `features/os/components/OsAuditLogModal.tsx` | Event `sagra:os-audit-log` | Fechar | audit-log GET |
| OsPrintModeModal | Início | `features/os/components/OsPrintModeModal.tsx` | Event print | Escolher modo | — |
| OsPrintFichaModal | Início | `features/os/components/OsPrintFichaModal.tsx` | Após modo | Imprimir/fechar | requisicao GET |
| OsFolderBrowserModal | Início/Gerência | `features/os/components/OsFolderBrowserModal.tsx` | Ação pasta | X | folder-browse/create |
| OsDecisaoSaidaModal | Histórico | `features/os/components/OsDecisaoSaidaModal.tsx` | Fluxo saída | Cancelar/confirmar | history POST |
| NovaOsArquivosModal | Gerência | `features/gerencia/components/NovaOsArquivosModal.tsx` | Pós-save nova OS | Concluir | arquivos email |
| AnaliseAnnotationModal | Análise | `features/analise/components/AnaliseAnnotationModal.tsx` | Chip anotação | Salvar/cancelar | indication-image POST |
| PageDivergenceModal | Análise | `features/analise/components/PageDivergenceModal.tsx` | Divergência páginas | Confirmar | — |
| PreAnaliseModal | — | `features/analise/components/PreAnaliseModal.tsx` | **NÃO USADO** | — | — |
| Obs modal (inline) | Análise | AnalisePage.tsx | Finalizar c/ obs | Confirmar | finalize |
| File modal (inline) | Análise | AnalisePage.tsx | Seleção arquivo | Confirmar | files/list |
| DashboardSetorSettingsModal | Painel setor | `features/dashboard-setor/components/` | Engrenagem | Salvar/import/export/limpar | localStorage + prefs |
| PainelGlobalSettingsModal | Painel global | `features/painel-global/components/` | Engrenagem | Idem | localStorage |
| PcpSettingsModal | PCP | `features/pcp/components/PcpSettingsModal.tsx` | Config | Salvar | pcpConfigStore |
| Identidade overlay | Portal PT | PortalPtPage.tsx | Primeiro acesso | Confirmar | client register |

---

## 7. Inventário de Tabelas, Listagens e Filtros

### 7.1 OsOrdersTable (Início)

| Aspecto | Detalhe |
|---------|---------|
| Arquivo | `features/os/components/OsOrdersTable.tsx` |
| Colunas | nr_os, ano, titulo, produto, situação, setor, prioridade, datas, etc. |
| Filtros | OsFiltersPanel — texto, multi-select situação/setor/prioridade |
| Ordenação | `sortBy`, `sortDir` → query params |
| Paginação | `page`, `pageSize` — server-side |
| API | `GET /api/os/search` |
| Tempo real | `useOsRealtimeSync` → WS `system_update` → silent refresh |
| Performance | Virtualização via TanStack Virtual (se configurado); debounce 250ms |
| Teste | Alterar filtros, ordenar, paginar, verificar WS update |

### 7.2 OsHistoryPanel

| Aspecto | Detalhe |
|---------|---------|
| API | `GET /api/os/{ano}/{id}/history` |
| Ações inline | Editar, excluir, replicar, decisão saída |

### 7.3 EmailListPanel

Abas Inbox / Pendências; lista com seleção → detail panel.

### 7.4 PcpPage kanban

Colunas por setor; cards OS; drag reorder → `POST /api/pcp/queue/reorder`.

### 7.5 GravacaoPage

Tabelas Xpose Jobs e Paths; dados via WS `/api/ws/jobs` (poll 2s back-end).

### 7.6 UsuariosPage

Lista usuários; painel permissões; lista clientes gabinete.

### 7.7 AdminIpsPage

Tabela IPs com matriz checkbox permissões; tabela solicitações acesso.

### 7.8 ClienteOsList

Dashboard cliente — OS do gabinete com link timeline.

### 7.9 RelatorioPage

Preview colunas selecionadas; export HTML/XLSX.

---

## 8. Inventário de Endpoints Back-end

> **Base URL:** `/api` (prefixo `/sagra/api` via Nginx)  
> **App:** `app/backend/main.py` → `routers/api.py`

### 8.1 Sistema / Config

| Método | Rota | Arquivo | Função | Auth | Permissão |
|--------|------|---------|--------|------|-----------|
| GET | `/health` | api.py | health | Public | — |
| GET | `/api/config/public` | config_routes.py | get_public_config | Public | — |
| GET | `/api/connected-ips` | api.py | get_connected_ips | Master | — |
| GET | `/api/download/folder-opener` | api.py | download_folder_opener | Session+IP | — |

### 8.2 Autenticação staff (`auth_routes.py`)

| Método | Rota | Função | Auth | Body |
|--------|------|--------|------|------|
| POST | `/api/auth/session` | create_session | Public (LAN) | `{ponto, nome}` |
| POST | `/api/auth/login` | login_password | Public (internet) | `{login, password}` |
| GET | `/api/auth/activate/check` | check_activation_token | Public | `?token=` |
| POST | `/api/auth/activate` | activate_account | Public | `{token, password}` |
| POST | `/api/auth/forgot-password` | forgot_password | Public | `{login}` |
| GET | `/api/auth/reset-password/check` | check_reset_password_token | Public | `?token=` |
| POST | `/api/auth/reset-password` | reset_password | Public | `{token, password}` |
| POST | `/api/auth/logout` | logout_session | Public | — |
| GET | `/api/auth/me` | get_current_session | Cookie | — |

**Tabelas:** `tabUsuarios`, `user_permissions`  
**Front:** `features/auth/api.ts`, login routes

### 8.3 Permissões / IP admin (`ip_admin_routes.py`)

| Método | Rota | Função | Auth |
|--------|------|--------|------|
| GET | `/api/permissions` | get_permissions | Session+IP |
| GET | `/api/admin/ip/list` | list_ips | Master |
| GET | `/api/admin/ip/groups` | list_groups | Master |
| POST | `/api/admin/ip/add` | add_ip | Master |
| POST | `/api/admin/ip/update` | update_ip | Master |
| POST | `/api/admin/ip/delete` | delete_ip | Master |
| POST | `/api/access-request` | create_access_request | Public |
| GET | `/api/admin/access-requests` | list_access_requests | Master |
| POST | `/api/admin/access-request/delete` | delete_access_request | Master |

**Tabelas:** `ip_permissions`, `tabSolicitacoesAcesso`, `user_permissions`

### 8.4 OS (`os_routes.py`)

| Método | Rota | Função | Auth | Front |
|--------|------|--------|------|-------|
| GET | `/api/os/next_id` | get_next_os_id | Session+IP | GerenciaPage |
| GET | `/api/os/search` | search_os | Session+IP / Painel-anon | OsHomePage, painéis |
| GET | `/api/os/{ano}/{id}/details` | get_os_details | Session+IP | OsDetailsPanel |
| GET | `/api/os/{ano}/{id}/history` | get_os_history | Session+IP | OsHistoryPanel |
| GET | `/api/os/{ano}/{id}/audit-log` | get_os_audit_log | Session+IP | OsAuditLogModal |
| GET | `/api/os/{ano}/{id}/path` | get_os_path | Session+IP | Context menu |
| GET | `/api/os/{ano}/{id}/folder-browse` | browse_os_folder | Session+IP | FolderBrowserModal |
| GET | `/api/os/{ano}/{id}/folder-plan` | get_os_folder_plan | Session+IP | GerenciaPage |
| POST | `/api/os/{ano}/{id}/folder-create` | create_os_folder | Session+IP | FolderBrowserModal |
| POST | `/api/os/save` | save_os | Session+IP | GerenciaPage |
| POST | `/api/os/{ano}/{id}/duplicate` | duplicate_os | Session+IP | GerenciaPage |
| GET | `/api/os/{ano}/{id}/vinculos` | list_os_vinculos | Session+IP | OsVincularModal |
| POST | `/api/os/{ano}/{id}/vincular` | create_vinculo | Session+IP | OsVincularModal |
| DELETE | `/api/os/{ano}/{id}/vinculo/{v_num}/{v_ano}` | delete_vinculo | Session+IP | OsVincularModal |
| POST | `/api/os/{ano}/{id}/history` | add_os_history | Session+IP | OsHistoryPanel |
| PUT | `/api/os/{ano}/{id}/history` | update_os_history | Session+IP | OsHistoryPanel |
| DELETE | `/api/os/{ano}/{id}/history/{cod_status}` | delete_os_history | Session+IP | OsHistoryPanel |
| POST | `/api/os/{ano}/{id}/history/replicate` | replicate_history | Session+IP | OsHistoryPanel |
| POST | `/api/os/{ano}/{id}/vinculo/excecao` | create_vinculo_excecao | Session+IP | OsVincularModal |
| GET | `/api/os/{ano}/{id}/versions` | get_os_versions | Session+IP | AnalisePage |
| GET | `/api/os/panel` | get_panel_data | Session+IP | — |
| GET | `/api/os/{ano}/{id}/ultimo-andamento` | get_last_movement | Session+IP | AnalisePage |

**Tabelas:** `tabProtocolos`, `tabDetalhesServico`, `tabAndamento`, `tabOSVinculadas`, `tabOSVinculoExcecoes`, `tab_os_audit_log`, `deleted_andamentos`  
**Serviços:** `mdb_writer` (async), `schedule_broadcast`, `os_audit_service`

### 8.5 Análise (`analise_routes.py`, `pre_analise_routes.py`)

Endpoints principais (30+):

| Grupo | Rotas | Funções |
|-------|-------|---------|
| CRUD análise | `/api/analise/ensure`, `/save`, `/finalize/{ano}/{os_id}`, `/{ano}/{os_id}/full`, `/{ano}/{os_id}/meta` | ensure, save, finalize, get full, patch meta |
| Itens | `/item/add`, `/item/update`, `/item/{id}` DELETE, `/toggle-resolucao-obrigatoria` | item CRUD |
| Biblioteca | `/problemas-padrao`, `/problemas-padrao/add` | problemas padrão |
| Arquivos | `/files/list`, `/files/serve`, `/item/{id}/indication-image` | UNC serve |
| Portal cliente | `/client/{ano}/{os_id}`, `/client/report/*`, `/client/upload-*`, `/client/desconsiderar-item`, `/client/resolver-item` | Token validation |
| Links | `/generate-link`, `/client/register-link-movement` | tabClientTokens |
| Movimentos | `/register-ptv-dispatch`, `/register-execution-movement`, `/start` | tabAndamento |
| Pré-análise | `/pre-analise/checks`, `/snapshots`, `/run-all/stream`, `/{check_id}` | PyMuPDF, Tesseract |
| Legado | `/legacy-pt/{sat_codigo}/pdf` | storage/legacy_sat_pt |

**Tabelas:** `tabAnalises`, `tabAnaliseItens`, `tabProblemasPadrao`, `tabClientTokens`, `tab_pre_analise_snapshot`

### 8.6 E-mail (`email_routes.py` — prefix `/api/email`)

| Método | Rota | Função |
|--------|------|--------|
| GET | `/config` | get_email_config |
| POST | `/config/connect` | connect_email_exchange |
| POST | `/config/folders` | list_email_folders |
| PUT | `/config` | save_email_config |
| GET | `/inbox` | get_email_inbox |
| GET | `/pendencias` | get_pendencias |
| GET | `/notification_status` | get_notification_status |
| POST | `/send` | send_email |
| POST | `/send-pt` | send_pt_email |
| POST | `/andamento` | create_andamento |
| POST | `/save-mht` | save_email_as_mht |
| POST | `/mark-read` | mark_email_read |
| GET | `/download` | download_attachment |
| GET | `/pt-html/{ano}/{os}` | get_pt_html |

**Integração:** `services/ews_service.py` (Exchange EWS, NTLM/SSPI)

### 8.7 PCP, Aux, Papelaria, Relatórios, Gravação

| Router | Endpoints chave |
|--------|-----------------|
| pcp_routes | `GET /api/pcp/queue`, `POST /api/pcp/queue/reorder` |
| auxiliar_routes | `/api/aux/categorias`, `/situacoes`, `/setores`, `/maquinas`, `/produtos`, `/papeis`, `/formatos`, `/cores`, `/protocolo/buscar`, `/deputado/buscar`, `/deputado/emails` |
| papelaria_routes | `/api/papelaria/modelos`, `/preview`, `/svg/*` |
| report_custom_routes | `POST /api/reports/custom`, `/custom/xlsx` |
| requisicao_routes | `GET /api/reports/requisicao/{ano}/{id}` |
| gravacao_routes | `GET /api/gravacao/xpose/status`, `/status`, `/jobticket`; WS `/api/ws/jobs` |

### 8.8 Portais (`proof_portal_routes.py`, `os_arquivos_routes.py`)

| Método | Rota | Auth |
|--------|------|------|
| GET | `/api/client/proof/{ano}/{os_id}` | Token |
| GET | `/api/client/proof/{ano}/{os_id}/pdf` | Token |
| POST | `/api/client/proof/respond` | Token |
| GET | `/api/client/os-arquivos/{ano}/{os_id}` | Token |
| POST | `/api/client/os-arquivos/upload-*` | Token |
| POST | `/api/os/{ano}/{os_id}/arquivos/enviar-email` | Session |
| POST | `/api/os/{ano}/{os_id}/arquivos/finalizar-interno` | Session |

### 8.9 Cliente gabinete (`cliente_gabinete_routes.py`)

| Método | Rota | Auth |
|--------|------|------|
| POST | `/api/auth/cliente/login` | Public |
| GET/POST | `/api/auth/cliente/activate/*` | Public |
| POST | `/api/auth/cliente/logout` | Public |
| GET | `/api/cliente/me` | Cliente |
| GET | `/api/cliente/dashboard` | Cliente |
| GET | `/api/cliente/os/{ano}/{nr_os}/andamentos` | Cliente |
| GET/POST | `/api/cliente/contas` | Cliente |
| GET/POST | `/api/admin/clientes/*` | Master |

### 8.10 Admin sistema / usuários / settings / realtime

| Router | Endpoints |
|--------|-----------|
| admin_system_routes | `/api/admin/system/pre-analise-checks`, `/email-templates/*` |
| user_admin_routes | `/api/admin/users/*` (CRUD, permissions, resend-activation) |
| user_routes | `/api/users/identify`, `/api/users`, `/api/users/{ponto}` |
| settings_routes | `/api/settings/preferences/*`, `/filters/saved/*`, legacy `/filtros/*` |
| setor_painel_routes | `/api/admin/setor-painel-defaults/*`, `/api/settings/setor-painel-default/{setor}` |
| notifications_routes | `/api/notifications`, `/api/notifications/{id}/read` |
| realtime | `POST /api/realtime/notify`, WS `/ws`, `/api/ws`, `GET /api/users/online`, `/api/admin/active_clients` |
| sync_routes | `/api/sync/*` (**condicional** — `SYNC_ANDAMENTOS_ENABLED=true`) |

---

## 9. Fluxos Funcionais Completos

### 9.1 Login interno por ponto

| | |
|---|---|
| **Objetivo** | Autenticar operador LAN sem senha |
| **Perfil** | Terminal interno |
| **Pré-condições** | IP cadastrado em `ip_permissions`; modo LAN (não internet) |
| **Passos** | `/login` → aba Ponto → informar ponto + nome → Entrar |
| **Interno** | `POST /api/auth/session` → cookie `sagra_session` (`auth_mode=local`) → `GET /api/permissions` |
| **APIs** | session, permissions, me |
| **Tabelas** | `tabUsuarios`, `ip_permissions` |
| **Resultado** | Redirect `/` com menu filtrado |
| **Erros** | IP não cadastrado → 403; falha permissões → logout fail-closed |
| **Validar** | Login ponto válido/inválido; menu conforme IP |

### 9.2 Login externo por e-mail/senha

| | |
|---|---|
| **Objetivo** | Acesso remoto autenticado |
| **Perfil** | Operador internet |
| **Passos** | `/login` → aba Senha → e-mail/ponto + senha |
| **Interno** | `POST /api/auth/login` → cookie (`auth_mode=password`); merge `user_permissions` sobre IP |
| **Validar** | Conta ativada; overlay permissões usuário vs IP |

### 9.3 Logout

Header "Sair" → `POST /api/auth/logout` → limpa cookie → `/login`.

### 9.4 Ativação de conta

E-mail link → `/login/activate?token=` → `GET check` → definir senha → `POST activate`.

### 9.5 Recuperação de senha

`/login/forgot` → e-mail → link → `/login/reset?token=` → nova senha.

### 9.6 Busca de OS

`/` → filtros → debounce → `GET /api/os/search` → tabela paginada. WS pode refresh silencioso.

### 9.7 Detalhes / Histórico OS

Selecionar linha → OsDetailsPanel + OsHistoryPanel → APIs details/history.

### 9.8 Nova OS

Context menu "Nova OS" → confirm papelaria → `/gerencia?action=new` → form → `POST /api/os/save` → NovaOsArquivosModal.

### 9.9 Edição / Duplicação OS

Context menu → `/gerencia` com params → load OS → save/duplicate endpoints.

### 9.10 Pasta de rede

Context "Abrir Pasta" → `GET path` → Folder Opener local ou UNC.  
Gerência: browse → plan → `POST folder-create`.

### 9.11 Vínculos OS

OsVincularModal → buscar OS → `POST vincular` ou exceção → lista vinculos.

### 9.12 Análise técnica

Sidebar Análise (com OS selecionada) → `/analise?ano&id` → ensure → full → editar itens → save → finalize.

### 9.13 Pré-análise PDF

PreAnalisePanel → estimate → run-all stream → checks individuais → snapshots.

### 9.14 Portal PT (token)

Staff gera link → cliente abre `/portal/pt/{token}?os=&ano=` → valida token → upload/resolver/desconsiderar.

### 9.15 Portal aprovação (token)

`/portal/aprovacao/{token}` → PDF prova → aprovar/reprovar → `POST proof/respond`.

### 9.16 Portal upload arquivos (token)

`/portal/os-arquivos/{token}` → upload → complete → e-mail interno opcional.

### 9.17 Portal prova (token)

`/portal/prova/{token}` → PDF read-only comprovante PT.

### 9.18 Portal cliente gabinete

`/cliente/login` → dashboard OS → timeline andamentos → sub-contas.

### 9.19 Painel setor / global

Sidebar (nova janela) ou URL direta / zrok → polling/WS → colunas OS. Sem login; `SAGRA_PAINEL_SKIP_IP_CHECK=true` permite GET anônimo.

### 9.20 PCP

`/pcp` → selecionar setor → kanban → drag → reorder API → WS broadcast.

### 9.21 Gravação

`/gravacao` → WS jobs → tabelas Xpose.

### 9.22 E-mail / PT

`/email` → config Exchange → inbox → send-pt → andamento.

### 9.23 Relatórios

Filtros → colunas → generate HTML/XLSX → download/abrir.

### 9.24 Admin IPs / Usuários / Config

Fluxos CRUD padrão com confirmação Master para mutações sensíveis.

### 9.25 WebSocket tempo real

Conexão `/ws` ou `/api/ws` → auth por cookie ou painel scope → mensagens: `system_update`, `pcp_queue_update`, `force_refresh`, ping/pong.

### 9.26 Sync MySQL/MDB

Save OS → MySQL commit → fila async `mdb_writer` → Access MDB. Sync andamentos: script separado, router condicional desabilitado por padrão.

---

## 10. Permissões e Controle de Acesso

### 10.1 Chaves de permissão

**Context menu (`ctx_*`):**
- `ctx_nova_os`, `ctx_duplicar_os`, `ctx_editar_os`, `ctx_vincular_os`, `ctx_abrir_pasta`, `ctx_imprimir_ficha`, `ctx_detalhes_os`

**Sidebar (`sb_*`):**
- `sb_inicio`, `sb_gerencia`, `sb_email`, `sb_analise`, `sb_papelaria`, `sb_relatorio`, `sb_dashboard_setor`, `sb_dashboard_global`, `sb_pcp`, `sb_gravacao`, `sb_usuarios`, `sb_admin_ips`, `sb_configuracoes`
- **Legado sem rota React:** `sb_usuario`, `sb_active_computers`

**Extras:**
- `painelSetores[]` — restringe setores no painel setor
- `painelSetoresLegacyAll` — flag legado "todos setores"

### 10.2 IP vs usuário

| Camada | Quando | Precedência |
|--------|--------|-------------|
| IP (`ip_permissions`) | Sempre — base | Default LAN |
| Usuário (`user_permissions`) | Login internet sempre; LAN se customizado admin | Overlay vence conflitos |

### 10.3 MASTER

IPs: `10.120.1.14`, servidor local `10.1.1.73`, loopback, trusted proxies.  
Libera: todas rotas `/api/admin/*`, connected-ips, sync.

### 10.4 Rotas públicas

`/login/*`, `/cliente/login/*`, `/portal/*`, `/health`, `/api/config/public`, `/api/access-request`, assets estáticos, portais client legacy HTML.

### 10.5 Rotas protegidas

Todas em `/_authenticated/*` — AuthGuard + `requiredPermission`.

### 10.6 Rotas por token

`/portal/*` — token path + query `os`, `ano`; validação handler back-end (`tabClientTokens`, `tabProofTokens`, `tabOsArquivosTokens`).

### 10.7 Painéis sem login

`/painel/setor`, `/painel/global` — sem AuthGuard; API GET anônima se `SAGRA_PAINEL_SKIP_IP_CHECK=true`.

### 10.8 Onde permissões são aplicadas

| Camada | Arquivo | Escopo |
|--------|---------|--------|
| Front AuthGuard | `components/auth/AuthGuard.tsx` | Rotas React |
| Front useAccessControl | `features/auth/useAccessControl.ts` | Menu, contexto |
| Back SPA middleware | `security/spa_access.py` | HTML shell |
| Back API middleware | `security/api_auth.py` | `/api/*` — IP + sessão |
| Back Depends | `require_master_ip`, `require_session` | Endpoints específicos |

**Nota:** Maioria dos endpoints API verifica IP registrado, **não** cada flag `sb_*` individualmente — RBAC granular é principalmente front-end + SPA middleware.

---

## 11. Integrações Externas

### 11.1 Exchange / EWS

| | |
|---|---|
| **Objetivo** | Inbox, envio, PT, ativação usuário |
| **Arquivos** | `services/ews_service.py`, `routers/email_routes.py` |
| **Config** | `tabEmailExchangeConfig`, env Exchange |
| **Fluxo** | SOAP via requests + NTLM/SSPI (Windows) |
| **Validar** | connect → list folders → inbox → send-pt |

### 11.2 MySQL

| | |
|---|---|
| **Objetivo** | Fonte da verdade |
| **Arquivos** | `database.py`, todos routers |
| **Env** | `SAGRA_DB_HOST`, `SAGRA_DB_USER`, `SAGRA_DB_PASSWORD`, `SAGRA_DB_NAME` |
| **Validar** | Health + operação CRUD OS |

### 11.3 Access MDB

| | |
|---|---|
| **Objetivo** | Dual-write legado |
| **Arquivos** | `routers/mdb_writer.py`, `lookup_sync.py` |
| **Config** | `mdb_write_enabled`, path `I:\ControleDeTrabalhos\...` |
| **Fluxo** | Async queue pós-save MySQL |
| **Erros** | MDB indisponível — mensagem no save, MySQL OK |

### 11.4 Rede de arquivos (UNC)

| | |
|---|---|
| **Objetivo** | Pastas OS, modelos Corel, PDFs análise |
| **Arquivos** | `config_manager.network_paths`, `os_routes.py`, `security/file_access.py`, `papelaria_routes.py` |
| **Paths** | `\\redecamara\DfsData\CGraf\Sefoc\Deputados`, modelos Corel |
| **Validar** | Abrir pasta OS; browse modal; serve PDF |

### 11.5 Google Drive

| | |
|---|---|
| **Objetivo** | Upload portal cliente (alternativa) |
| **Arquivos** | `services/gdrive_portal_upload.py` |
| **Env** | `SAGRA_PORTAL_UPLOAD_GDRIVE=true`, OAuth `config/gdrive/` |
| **Estado** | **Desabilitado por padrão** — retorna 503 |

### 11.6 zrok / Cloudflare

| | |
|---|---|
| **Objetivo** | Expor painéis/public internet |
| **Arquivos** | `iniciar-zrok-painel.bat`, `security/cloudflare_access.py` |
| **URLs** | `https://sagra-painel.shares.zrok.io/painel/*`, `cgraf.online` |
| **Fluxo** | zrok share → `http://cgrafsysvm`; CF middleware bloqueia rotas internas |
| **Validar** | Painel via zrok; API admin bloqueada via CF |

### 11.7 OCR / Tesseract

| | |
|---|---|
| **Objetivo** | Pré-análise PDF — detecção texto |
| **Arquivos** | `services/pre_analise/pdf_partial_raster.py` |
| **Env** | `TESSERACT_CMD` |
| **Estado** | Opcional — check `tesseract_ausente` |

### 11.8 PDF / PyMuPDF

| | |
|---|---|
| **Objetivo** | Pré-análise, relatórios cliente, legacy SAT PT |
| **Arquivos** | `services/pre_analise/*`, `analise_routes.py` |
| **Validar** | Pré-análise run-all; portal PDF |

### 11.9 Folder Opener (Windows)

| | |
|---|---|
| **Objetivo** | Abrir UNC no Explorer |
| **Arquivos** | `lib/sagraLocalOpener.ts`, `/api/download/folder-opener` |
| **Validar** | Instalar opener → context menu pasta |

### 11.10 Câmara API (deputados)

| | |
|---|---|
| **Objetivo** | Lookup deputado |
| **Arquivos** | `services/deputados_camara_service.py`, `auxiliar_routes.py` |
| **Validar** | Busca deputado na gerência |

### 11.11 Corel COM (Windows)

| | |
|---|---|
| **Objetivo** | Preview papelaria legado |
| **Arquivos** | `papelaria_routes.py` (win32com) |
| **Estado** | Windows-only |

### 11.12 Xpose / Gravação CTP

| | |
|---|---|
| **Objetivo** | Monitor jobs impressão |
| **Arquivos** | `gravacao_routes.py`, UNC XML `\\cgrafsysvm\ApogeeFiles\` |
| **Tabelas** | `xpose_tickets`, `xpose_paths`, `ct_gravacao_*` |

---

## 12. Funcionalidades Incompletas, Mockadas ou em Migração

| Funcionalidade | Arquivo | Estado | Funciona | Falta | Risco |
|----------------|---------|--------|----------|-------|-------|
| Splat catch-all | `routes/_authenticated/$.tsx` | Em migração | Placeholder | Rotas legadas restantes | Confusão usuário |
| UI legada HTML | `app/frontend/*.html` | Em migração | Parcial via Nginx | 100% React | Duplicação |
| Notificações header | `Header.tsx` | Mock/stub | UI only | API integration | Expectativa usuário |
| PreAnaliseModal | `PreAnaliseModal.tsx` | Obsoleto | — | Remover ou usar | Código morto |
| PermissionGate | `components/auth/PermissionGate.tsx` | Não usado | — | Integrar ou remover | — |
| sb_usuario, sb_active_computers | `types.ts` | Sem rota | RBAC matrix | Página React | Permissão órfã |
| Google Drive upload | `gdrive_portal_upload.py` | Desabilitado | Código existe | Config + OAuth | 503 se tentar |
| Sync andamentos UI | `sync_routes.py` | Condicional | Backend existe | Flag enable + UI React | Desatualização MDB |
| Tesseract OCR | pre_analise | Opcional | Checks sem OCR | Instalar Tesseract | Checks incompletos |
| Gravacao WS | `/api/ws/jobs` | Pronto | Sim | **Sem auth WS** | Exposição LAN |
| Papelaria Corel | `papelaria_routes.py` | Parcial | Windows only | Linux/dev sem COM | Preview falha |
| active_computers page | legado HTML | Não migrado | HTML legado? | Rota React | — |
| Legacy portals HTML | `client_pt.html`, `client_proof.html` | Redireciona | Redirect React | Remover legado | — |
| API RBAC granular | middleware | Parcial | IP check | sb_* por endpoint | API aberta LAN* |

\*Mitigado parcialmente por `APIAccessMiddleware` em versões recentes — validar ambiente.

---

## 13. Pontos de Atenção para o Manual Final

### Fluxos complexos
- Análise técnica completa (itens → HTML → pré-análise → finalize → link PT)
- Dual-write MySQL + MDB (mensagens de erro no save)
- Permissões IP + overlay usuário (internet vs LAN)
- Portal PT upload (server vs GDrive)
- PCP reorder com WS broadcast

### Telas críticas
- OsHomePage (hub operacional)
- GerenciaPage (save OS)
- AnalisePage (qualidade)
- EmailPage (Exchange)
- AdminIpsPage (segurança)

### Regras de negócio difíceis
- Papelaria só OS > 5000
- Vinculação OS e exceções
- Histórico — decisão saída, replicação
- Pré-análise checks configuráveis
- Painel setores restritos vs legacy all

### Termos técnicos
- OS, PT, PTV, PCP, SAT, MDB, EWS, UNC, Xpose, pré-análise

### Operações perigosas
- Excluir andamento histórico
- Delete vinculo
- Delete IP admin
- Reset template e-mail
- Force refresh WS (todos clientes)

### Ações irreversíveis
- Delete histórico, delete vinculo, delete IP, finalize análise (sem undo fácil)

### Permissões sensíveis
- `sb_admin_ips` — controla IPs e config sistema
- Master IP — acesso total admin
- `ctx_editar_os`, `ctx_nova_os` — alteração dados produção

---

## 14. Checklist de Cobertura

| Item | Status | Observação |
|------|--------|------------|
| Todas as rotas front-end | ✅ | 27 rotas mapeadas em `routeTree.gen.ts` |
| Todas as páginas | ✅ | 18 páginas principais + 4 portais + auth |
| Todos os botões | ⚠️ | Principais documentados; botões repetitivos (tabelas internas) agrupados por padrão |
| Todos os formulários | ✅ | 13+ formulários principais |
| Todos os modais | ✅ | 15 modais + 2 inline análise |
| Todos os endpoints | ✅ | 150+ endpoints em 24 routers |
| Todos os fluxos | ✅ | 26 fluxos solicitados |
| Todas as permissões | ✅ | 22 chaves + painelSetores |
| Todas as integrações | ✅ | 12 integrações |
| Todos os portais | ✅ | 4 token + cliente gabinete |
| Todos os painéis | ✅ | Setor + global |

---

## Apêndice A — Estrutura de Diretórios Relevante

```
SagraWeb/
├── apps/web/src/          # SPA React (rotas, features, api, components)
├── app/backend/           # FastAPI (routers, services, security)
├── app/frontend/          # HTML legado (migração)
├── packages/ui/           # Design system compartilhado
├── packages/api-types/    # Tipos TS compartilhados
├── docs/                  # Documentação (este arquivo)
├── deploy/                # Scripts release/deploy
├── iniciar-zrok-painel.bat # Túnel zrok painéis
└── contexto_executivo.md  # Auditoria executiva
```

## Apêndice B — Stores Zustand

| Store | Arquivo | Persistência |
|-------|---------|--------------|
| useAuthStore | `features/auth/authStore.ts` | Session cookie |
| useClienteStore | `features/cliente/clienteStore.ts` | Cookie cliente |
| useOsFiltersStore | `features/os/osFiltersStore.ts` | localStorage |
| useOsSelectionStore | `features/os/osSelectionStoreStore.ts` | Memória |
| usePcpConfigStore | `features/pcp/pcpConfigStore.ts` | localStorage |
| usePainelConfigStore | `features/painel-global/painelConfigStore.ts` | localStorage |

## Apêndice C — WebSocket Mensagens

| Tipo | Efeito front |
|------|--------------|
| `system_update` | Refresh busca OS |
| `pcp_queue_update` | Refresh fila PCP |
| `force_refresh` | Reload página (admin) |
| `ping` / `pong` | Keepalive |

---

*Documento gerado por análise estática do código-fonte. Validar comportamento em ambiente de homologação antes de publicar manual operacional.*
