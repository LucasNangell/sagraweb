# Plano — Unificação das páginas Admin/IPs e Usuários ("Controle de Acesso")

Data: 2026-11-10 · Doc vivo (versão editável): https://claude.ai/artifact/DNXxjGeVrjc5tXH4ERqXGs

## 1. Contexto e problema

As páginas `/admin/ips` e `/usuarios` administram o mesmo conjunto de ~40 chaves de permissão (`ctx_*` e `sb_*`) em dois lugares, com interfaces diferentes: matriz de checkboxes por IP em uma, modal de checkboxes por usuário na outra.

- A regra de precedência é invisível na interface: na rede local vale a base do IP mais a sobreposição do usuário; no acesso via internet valem só as permissões do usuário; o IP MASTER tem acesso total (`app/backend/security/user_permissions.py`).
- "IP" aparece com dois sentidos distintos: o cadastro de terminais (`ip_permissions`, em /admin/ips) e os "IPs cadastrados" de cada usuário (isenção de senha na intranet, em /usuarios).
- /usuarios acumulou funções sem relação direta com usuários internos: cadastro de clientes do portal (gabinete/órgão), padrão de painel por setor e os botões de forçar refresh dos clients.

Resultado: redundância, risco de configurar no lugar errado e nenhuma forma de responder "o que este usuário consegue acessar deste terminal?".

## 2. Diagnóstico das páginas atuais

| Aspecto | /admin/ips | /usuarios |
| --- | --- | --- |
| Guarda de acesso | `sb_admin_ips` | `sb_usuarios` |
| Componente principal | `features/admin-ips/components/AdminIpsPage.tsx` | `features/usuarios/components/UsuariosPage.tsx` |
| Gerencia | Terminais (`ip_permissions`): cadastro com wildcard `%`, grupo/sala, ativo, exclusão | Usuários (`tabUsuarios` + `user_permissions`): cadastro com link de ativação, perfil, senha, foto facial, exclusão |
| Edição de permissões | Matriz inline com 36 colunas de checkbox por IP (`AdminIpsPermissionsTable`) | Modal com os mesmos checkboxes por usuário + painéis e setores (`UserAdminPanel`) |
| Funções extras | Solicitações de acesso pendentes | Clientes do portal, padrão de painel por setor, forçar refresh dos clients, status online/offline |
| Endpoints | `/api/admin/ip/*`, `/api/admin/access-requests` | `/api/admin/users*` (perfil, ips, permissões, senha, ativação) |

Sobreposições concretas no código:

- Rótulos das permissões duplicados: `admin-ips/constants.ts` (colunas abreviadas) e `UserAdminPanel.tsx` (`PERMISSION_LABELS`). Qualquer permissão nova exige editar os dois.
- Chaves que só existem por usuário (`ctx_prova_web`, `ctx_comparar_versoes`, `sb_dashboard_global`, `sb_dashboard_tablet`, `painel_setores`) — hoje isso é um comentário no código, não algo visível para quem configura.
- O usuário edita "IPs cadastrados" em um textarea no modal de perfil, sem ligação com o cadastro de terminais da outra página.
- Ambas usam `window.confirm` e mensagens de feedback idênticas, cada uma com sua implementação.

## 3. Proposta: página única "Controle de Acesso"

Substituir as duas páginas por uma única página `/admin/acesso` com abas, organizada pelo modelo mental **quem** (usuários) e **onde** (terminais), com um único editor de permissões compartilhado e a regra de precedência visível na interface.

- Um só catálogo de permissões (rótulo, categoria, escopo IP/usuário/ambos) alimenta todas as telas.
- O editor de permissões é o mesmo componente para usuário e terminal; só muda o alvo. Chaves fora de escopo aparecem desabilitadas com explicação.
- Um simulador de **acesso efetivo** mostra o resultado da mesclagem para um usuário + terminal escolhidos, usando a mesma regra do backend (`resolve_effective_permissions`).

Regra de resolução (implementada em `security/user_permissions.py`, a UI deve torná-la visível):

```
Sessão autenticada → Origem?
├─ IP MASTER / servidor (inclui master remoto) → acesso total
├─ Internet (login por senha)                  → só permissões do usuário; sem cadastro = tudo negado
└─ Rede local (sessão por IP)                  → base: permissões do IP + sobreposição do usuário (se customizada)
```

## 4. Estrutura de UI

Uma página, quatro abas, editor único de permissões em painel lateral (drawer). A URL guarda a aba e o alvo aberto (`/admin/acesso?aba=usuarios&ponto=918713`).

| Aba | Conteúdo | Visível com |
| --- | --- | --- |
| Visão geral | Cartões de resumo (usuários ativos/online, terminais ativos, solicitações pendentes), atalho para o simulador, bloco "Manutenção" com forçar refresh dos clients | `sb_usuarios` ou `sb_admin_ips` |
| Usuários | Lista com busca e filtros (setor, online, fornecedor, conta internet) + cadastro; drawer com seções Perfil, Acesso internet (senha/ativação), IPs vinculados, Foto facial, Permissões, Painéis | `sb_usuarios` |
| Terminais | Cadastro de IPs com wildcard, grupos/salas recolhíveis, solicitações pendentes no topo com "aprovar e cadastrar"; drawer com Dados do terminal + Permissões | `sb_admin_ips` |
| Clientes do portal | Cadastro gabinete/órgão, reenvio de ativação, navegação liberada (atual `ClienteCadastroForm`) | `sb_usuarios` |

Decisões de design:

- **PermissionMatrix**: substitui a tabela de 36 colunas e o modal. Checkboxes agrupados por categoria (Menu lateral, Menu de contexto da OS, Painéis, Gravação, Estoque, Outros), busca por nome, "marcar/desmarcar categoria", contador de ativas. No alvo usuário, mostra o valor herdado do terminal ao lado de cada chave.
- **Drawer no lugar de modais**: painel lateral de ~480px (tela cheia no celular), seções em acordeão — acaba com os três modais sobrepostos atuais.
- **Responsividade**: abaixo de 768px as tabelas viram cartões; acima, tabela com primeira coluna fixa e cabeçalho aderente. A matriz nunca exige rolagem horizontal: as categorias empilham.
- **Estados e confirmações**: esqueletos de carregamento, estados vazios com ação sugerida, erro com "tentar novamente"; `ConfirmDialog` próprio no lugar de `window.confirm`.
- **O que sai da página**: "Padrão de painel por setor" (`SetorPainelDefaultsSection`) migra para `/admin/paineis` (decisão em aberto — ver §10). Forçar refresh vai para o bloco "Manutenção" na Visão geral.

## 5. Mudanças no frontend

Nova feature `apps/web/src/features/acesso/`; as features `admin-ips` e `usuarios` são absorvidas e depois removidas.

- **Catálogo único** — `features/acesso/permissionCatalog.ts`: para cada `PermissionKey`, rótulo curto, rótulo completo, categoria e escopo (`ip` | `user` | `both`). Substitui `CONTEXT_PERMISSION_COLUMNS`/`SIDEBAR_PERMISSION_COLUMNS` e `PERMISSION_LABELS`. `buildDefaultNewIpPayload` passa a derivar do catálogo (campo `defaultForNewIp`).
- **Componentes novos**: `AcessoPage` (abas + roteamento por query), `VisaoGeralTab`, `UsuariosTab`, `TerminaisTab`, `ClientesPortalTab`, `PermissionMatrix`, `UserDrawer`, `TerminalDrawer`, `AccessSimulator`, `ConfirmDialog` (candidato a `packages/ui`).
- **Reaproveitamento**: hooks `useAdminIpsQueries`, `useUsuariosQueries`, `useAuxLookups` e APIs `api/adminUsers.ts`, `api/cliente-portal.ts` permanecem; `EmailGalLookupField`, `CopyableLink` e a lógica de foto facial são reaproveitados.
- **Rotas**: nova `routes/_authenticated/admin/acesso.tsx` com `AuthGuard` aceitando `sb_usuarios` OU `sb_admin_ips` (cada aba valida a sua chave); `admin/ips.tsx` e `usuarios.tsx` viram redirects durante a transição.
- **Navegação**: em `components/layout/nav-config`, os dois itens dão lugar a um único "Controle de Acesso" — sem criar chave de permissão nova, para não exigir migração de dados.
- **Limpezas**: remover o rodapé de debug `Online Raw`; remover `UserAuthActions` (deprecado); trocar todos os `window.confirm` por `ConfirmDialog`.

## 6. Backend e API

O CRUD existente cobre a unificação — o grosso do trabalho é frontend. Permanecem como estão: `/api/admin/ip/{list,groups,add,update,delete}` e `/api/admin/access-requests` (`ip_admin_routes.py`); `/api/admin/users` e sub-rotas (`user_admin_routes.py`). Todos já exigem `require_master_ip`, então a página continua operacional apenas do terminal MASTER — `sb_usuarios`/`sb_admin_ips` controlam só a visibilidade do menu.

Adições propostas (router novo `acesso_admin_routes.py` ou nos existentes):

1. `GET /api/admin/access/preview?ponto=&ip=` — permissões efetivas da combinação, chamando `resolve_effective_permissions`/`merge_permissions` reais; resposta inclui a origem de cada chave (`ip`, `user`, `master`). Garante que o simulador nunca diverge do middleware.
2. `GET /api/admin/access/overview` — contadores para a Visão geral, evitando 3–4 chamadas na abertura.
3. Opcional, fase final: tabela `access_audit_log` (quem alterou qual permissão, de quem, quando) — script SQL manual em `deploy/sql/`.

Sem migração de banco no MVP: `ip_permissions`, `user_permissions`, `user_ips` e `tabUsuarios` intactas.

## 7. Migração e compatibilidade

- `/admin/ips` e `/usuarios` redirecionam para `/admin/acesso?aba=terminais` e `?aba=usuarios`; os arquivos antigos só são removidos uma release depois da nova página estar estável.
- `sb_admin_ips` e `sb_usuarios` mantêm o significado (aba Terminais / aba Usuários). Nenhum IP ou usuário precisa ser reconfigurado.
- `SetorPainelDefaultsSection` muda de página no mesmo commit em que sai de Usuários, para a função nunca ficar indisponível.
- Deploy pelo fluxo normal de release (`pnpm package:release` + `deploy_release.ps1`), com `rollback_release.ps1` como plano de volta — MVP só de frontend, rollback trivial.
- Versionamento: incremento **MINOR** por fase, com commit e push.

## 8. Fases de implementação

Porta entre fases: `pnpm typecheck` e `pnpm test` verdes + paridade funcional.

| Fase | Entrega | Observações |
| --- | --- | --- |
| F0 | Catálogo único de permissões | Rótulos, categorias e escopo num só módulo; páginas atuais passam a consumi-lo (sem mudança visual) |
| F1 | Página `/admin/acesso` com abas | Abas embutem as telas atuais; redirects e item único no menu — primeira entrega visível |
| F2 | Aba Usuários redesenhada | Drawer unificado + PermissionMatrix; painel por setor migra para /admin/paineis; aba Clientes do portal |
| F3 | Aba Terminais redesenhada | Solicitações integradas; matriz por categorias no lugar das 36 colunas |
| F4 | Simulador e visão geral | Endpoints preview/overview no backend; simulador de acesso efetivo na UI |
| F5 | Limpeza e extras | Remoção das rotas e features antigas; auditoria opcional; polimento final |

Cada fase fecha com commit e push versionados (MINOR) e pode ir a produção sozinha — o sistema nunca fica num estado intermediário quebrado.

## 9. Testes e validação

- **Vitest**: catálogo (toda `PermissionKey` tem rótulo, categoria e escopo — pega chave nova esquecida); `PermissionMatrix` (marcar categoria, busca, chaves fora de escopo desabilitadas); redirects; visibilidade das abas por permissão (ampliando `permissions.test.ts` e `UserAdminPanel.test.tsx`).
- **pytest**: `GET /api/admin/access/preview` nas três origens (internet, rede local com e sem overlay, MASTER) com mocks de DB — vira o teste de regressão da regra de mesclagem, hoje sem cobertura direta.
- **Checklist manual por release**: do MASTER, criar/editar/excluir usuário e terminal; de um IP comum, menu respeita as chaves; via internet, usuário sem customização não acessa nada; aprovar uma solicitação ponta a ponta; testar em ~380px, 768px e 1920px.

## 10. Riscos e decisões em aberto

**Riscos**

- Chaves com escopo diferente (`ctx_prova_web`, `ctx_comparar_versoes`, `sb_dashboard_*` só por usuário): catálogo com campo `escopo` obrigatório + teste comparando com `_PERMISSION_BOOL_KEYS` do backend.
- Regressão silenciosa na mesclagem IP × usuário: testes do endpoint de preview (F4) e nenhuma lógica de mesclagem duplicada no frontend.
- A tabela de 36 colunas permite varrer vários IPs de uma vez; o drawer edita um por vez. Mitigação: ação "copiar permissões de outro terminal/usuário" desde F2/F3.

**Decisões em aberto**

1. Clientes do portal: aba da nova página (proposto) ou página própria?
2. Destino do "Padrão de painel por setor": `/admin/paineis` (proposto) ou `/admin/configuracoes`?
3. Perfis/templates de permissão (ex.: "Operador de gravação", "Gerência"): F6 futura ou fora do escopo?
4. Por quanto tempo manter os redirects (sugestão: 2 releases)?

## 11. Status da implementação (2026-11-10)

Fases F0–F5 implementadas, uma versão MINOR por fase: 0.22.0 (F0) → 0.27.0 (F5).

Decisões tomadas para as questões em aberto (§10):

1. **Clientes do portal** — aba da nova página (como proposto).
2. **Padrão de painel por setor** — foi para **Configurações › Painéis por setor**, não para `/admin/paineis`: esta é restrita a um único ponto (918713), o que tiraria a função de quem a usava; Configurações tem a mesma guarda efetiva (MASTER).
3. **Perfis/templates de permissão** — fora do escopo (F6 futura).
4. **Redirects** `/usuarios` e `/admin/ips` — mantidos; remover após 2 releases estáveis.

Achados de integridade tratados durante a implementação:

- O modal antigo de permissões reabria "Conta ativa" sempre marcado; salvar permissões reativava contas desativadas. Agora a conta ativa é salva à parte, com confirmação.
- `POST /api/admin/ip/add` com IP já existente sobrescreve o terminal com os padrões; a UI bloqueia IP duplicado (cadastro, edição e aprovação de solicitação).
- Regra real confirmada pelo simulador: permissões próprias do usuário **substituem por completo** as do terminal (inclusive no MASTER, exceto as rotas administrativas, que dependem só do IP MASTER); a UI explica isso.

Não implementado (opcional): tabela `access_audit_log`.

