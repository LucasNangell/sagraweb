# Relatório — Integração Portal do Cliente: Problemas Técnicos e Provas

**Data:** 08/06/2026  
**Escopo:** PROMPT 3 — integração visual/navegacional de PT e provas no portal autenticado `/cliente`, sem alterar fluxos públicos por token.

---

## 1. Resumo executivo

O Portal do Cliente ganhou navegação horizontal (Visão Geral, Problemas Técnicos, Provas, Contas), rotas autenticadas de bridge para cada pendência e uma página profissional de prova/aprovação. Os portais públicos `/portal/pt/{token}` e `/portal/aprovacao/{token}` permanecem inalterados em autenticação e validação por token.

---

## 2. Arquivos criados

### Rotas TanStack Router

| Arquivo | Rota |
|---------|------|
| `apps/web/src/routes/cliente/problemas-tecnicos.tsx` | `/cliente/problemas-tecnicos` |
| `apps/web/src/routes/cliente/provas.tsx` | `/cliente/provas` |
| `apps/web/src/routes/cliente/contas.tsx` | `/cliente/contas` |
| `apps/web/src/routes/cliente/os/$ano/$nrOs/problemas-tecnicos.tsx` | `/cliente/os/$ano/$nrOs/problemas-tecnicos` |
| `apps/web/src/routes/cliente/os/$ano/$nrOs/prova.tsx` | `/cliente/os/$ano/$nrOs/prova` |
| `apps/web/src/routes/cliente/os/$ano/$nrOs/arquivos.tsx` | `/cliente/os/$ano/$nrOs/arquivos` |

### Layout e navegação

- `apps/web/src/features/cliente/layout/ClientePortalShell.tsx`
- `apps/web/src/features/cliente/layout/ClienteAuthenticatedLayout.tsx`
- `apps/web/src/features/cliente/components/ClientePortalNav.tsx`
- `apps/web/src/features/cliente/components/ClientePortalBreadcrumb.tsx`

### Bridges e utilitários

- `apps/web/src/features/cliente/utils/pendenciaBridge.ts`
- `apps/web/src/features/cliente/utils/pendenciaBridge.test.ts`
- `apps/web/src/features/cliente/hooks/useClienteDashboardOs.ts`
- `apps/web/src/features/cliente/components/ClienteOsActionButton.tsx`
- `apps/web/src/features/cliente/components/ClienteOsContextHeader.tsx`
- `apps/web/src/features/cliente/components/ClienteLinkUnavailable.tsx`
- `apps/web/src/features/cliente/components/ClientePtBridgePage.tsx`
- `apps/web/src/features/cliente/components/ClienteProofBridgePage.tsx`
- `apps/web/src/features/cliente/components/ClienteArquivosBridgePage.tsx`
- `apps/web/src/features/cliente/components/ClientePendenciasListPage.tsx`

### Página de prova (componentes)

- `apps/web/src/features/cliente/components/proof/ClienteProofPage.tsx`
- `apps/web/src/features/cliente/components/proof/ClienteProofViewer.tsx`
- `apps/web/src/features/cliente/components/proof/ClienteProofActions.tsx`
- `apps/web/src/features/cliente/components/proof/ClienteProofStatusBadge.tsx`
- `apps/web/src/features/cliente/components/proof/ClienteProofDecisionModal.tsx`

---

## 3. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `apps/web/src/routes/cliente/index.tsx` | Envolve dashboard em `ClienteAuthenticatedLayout` |
| `apps/web/src/features/cliente/components/ClienteDashboardPage.tsx` | Remove header duplicado; conteúdo dentro do shell |
| `apps/web/src/features/cliente/components/ClienteCompactOsCard.tsx` | Usa `ClienteOsActionButton` com rotas internas |
| `apps/web/src/features/portal/PortalPtPage.tsx` | Modo `embedded`, polish visual, botão voltar |
| `apps/web/src/features/portal/PortalAprovacaoPage.tsx` | Delega para `ClienteProofPage` |
| `apps/web/src/routeTree.gen.ts` | Regenerado automaticamente pelo build |

---

## 4. Como o portal PT público foi preservado

| Regra | Status |
|-------|--------|
| Rota `/portal/pt/$token` intacta | ✅ `routes/portal/pt.$token.tsx` inalterada |
| Sem exigência de login no PT | ✅ Rota pública continua fora de `ClienteAuthGuard` |
| Validação por token | ✅ `fetchClientAnalysis`, upload e desconsiderar usam o mesmo `token` |
| Endpoints de upload/desconsiderar | ✅ Não alterados |
| Expiração de token | ✅ Lógica no backend inalterada |
| Links antigos por e-mail | ✅ `pendencia_url` com `/portal/pt/...` continua válido; `ClienteOsActionButton` faz fallback para URL externa quando necessário |

No portal autenticado, a bridge (`ClientePtBridgePage`) lê `pendencia_url` do cache do dashboard, extrai o token com `parsePortalLinkFromUrl` e renderiza `PortalPtPage` em modo `embedded` — **sem burlar** a validação por token.

---

## 5. Como a página de provas funciona

### Fluxo autenticado

1. Dashboard ou lista `/cliente/provas` exibe cards com CTA **"Analisar prova"**.
2. Link interno: `/cliente/os/{ano}/{nrOs}/prova`.
3. `ClienteProofBridgePage` valida que a OS pertence ao gabinete e que `pendencia_url` aponta para `/portal/aprovacao/{token}`.
4. `ClienteProofPage` carrega dados via token (mesma API do portal público).
5. Layout em duas colunas (desktop): viewer PDF à esquerda, resumo e ações à direita.
6. **Aprovar** e **Solicitar ajuste** abrem modal de confirmação; ajuste exige observação.
7. Ações via `POST /client/proof/respond` — nunca GET.
8. Após sucesso, invalida `["cliente", "dashboard"]` para a OS sair da seção no próximo refetch.

### Fluxo público (preservado)

- `/portal/aprovacao/{token}?os=&ano=` continua funcionando.
- `PortalAprovacaoPage` agora é um wrapper fino com `PortalSystemHeader` + `ClienteProofPage`.

### Estados tratados

- Aguardando aprovação (padrão)
- Aprovada / Ajuste solicitado (após POST)
- Link expirado/indisponível (erro 409 ou mensagem de expiração)
- Erro de carregamento
- PDF indisponível (`hasPdf: false`)

---

## 6. Endpoints

### Novos endpoints

**Nenhum.** Backend não foi alterado nesta entrega.

### Endpoints reutilizados

| Área | Endpoint | Método | Uso |
|------|----------|--------|-----|
| Dashboard | `/client/dashboard` | GET | Listas de pendências e `pendencia_url` |
| PT | `/client/analysis/{ano}/{os}` | GET | Carregar problemas técnicos |
| PT | Upload (gdrive/server) | POST | Envio de arquivo corrigido |
| PT | Desconsiderar item | POST | Marcar item como desconsiderado |
| Prova | `/client/proof/{ano}/{os}` | GET | Metadados da prova |
| Prova | `/client/proof/{ano}/{os}/pdf` | GET | Visualização/download PDF |
| Prova | `/client/proof/respond` | POST | Aprovar ou solicitar ajuste |
| Contas | `/client/contas` | GET/POST | Painel de subcontas |

---

## 7. Navegação do portal

`ClientePortalNav` — abas horizontais responsivas:

- **Visão Geral** → `/cliente`
- **Problemas Técnicos** → `/cliente/problemas-tecnicos`
- **Provas** → `/cliente/provas`
- **Contas** → `/cliente/contas`

Todas as rotas autenticadas usam `ClienteAuthenticatedLayout` (`ClienteAuthGuard` + `ClientePortalShell`).

---

## 8. Testes e build

| Comando | Resultado |
|---------|-----------|
| `pnpm test:frontend` | ✅ 32 testes (incl. 7 novos em `pendenciaBridge.test.ts`) |
| `pnpm test:backend` | ✅ 45 testes |
| `pnpm build` | ✅ Sucesso |
| `pnpm lint` | ✅ Pendente (Fase 0 — sem eslint configurado) |
| `pnpm typecheck` | ⚠️ TS6310 pré-existente em `tsconfig.app.json` (referências de projeto) |

---

## 9. Checklist de validação manual

| Item | Como validar |
|------|----------------|
| Login em `/cliente` | Cookie `sagra_cliente_session` |
| Dashboard carrega | Hero + seções colapsáveis |
| Seções colapsam/expandem | Clique nos headers |
| Problemas Técnicos | CTA → bridge → `PortalPtPage` embedded |
| `/portal/pt/{token}` sem login | Abrir link direto em aba anônima |
| Upload corrigido | Enviar arquivo no PT |
| Desconsiderar item | Botão na lista de problemas |
| Prova abre | CTA "Analisar prova" → viewer PDF |
| Aprovar prova | Modal + POST |
| Solicitar ajuste | Exige observação + modal |
| Mobile sem overflow | Nav horizontal com scroll; grid responsivo |
| Build aprovado | Ver seção 8 |

---

## 10. Arquitetura

```
/cliente (auth + ClientePortalShell + Nav)
├── /                          → Dashboard
├── /problemas-tecnicos        → Lista PT
├── /provas                    → Lista aprovação
├── /contas                    → Subcontas
└── /os/$ano/$nrOs/
    ├── problemas-tecnicos     → ClientePtBridgePage → PortalPtPage(token, embedded)
    ├── prova                  → ClienteProofBridgePage → ClienteProofPage(token)
    └── arquivos               → ClienteArquivosBridgePage → PortalOsArquivosPage(token)

/portal/pt/{token}             → PÚBLICO (inalterado)
/portal/aprovacao/{token}      → PÚBLICO (UI compartilhada via ClienteProofPage)
```

---

## 11. O que não foi feito (fora de escopo)

- Publicação em produção
- Alteração de backend, `tabClientTokens`, autenticação ou endpoints de PT
- Sidebar complexa (optou-se por nav horizontal leve)
- Iframe para PT (renderização direta com token)
