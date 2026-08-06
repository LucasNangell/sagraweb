# Relatório — Visualização e aprovação de prova (Portal do Cliente)

**Data:** 08/06/2026  
**Escopo:** Botão “Visualizar prova”, timeline, página de prova e resposta do cliente.

---

## 1. Objetivo da alteração

Permitir que o cliente do Portal SAGRA Web:

1. Veja o botão **Visualizar prova** nos cards da seção **Aguardando Aprovação** e no andamento correspondente da timeline expandida.
2. Acesse a página `/cliente/os/{ano}/{nrOs}/prova` para visualizar o PDF da prova.
3. Informe **nome**, **número de ponto** e **observações**, e registre **aprovação** ou **solicitação de alterações**.

A implementação reutiliza a infraestrutura existente de prova (`/client/proof/*`, `tabProofTokens`, bridge autenticado) e complementa o que ainda faltava na UX e nos dados do dashboard.

---

## 2. Arquivos analisados

| Área | Arquivos |
|------|----------|
| Dashboard / cards | `ClienteDashboardPage.tsx`, `ClienteCollapsibleWorkBoard.tsx`, `ClienteCollapsibleSection.tsx`, `ClienteCompactOsCard.tsx`, `ClienteOsActionButton.tsx`, `clienteSectionConfig.ts` |
| Timeline | `ClienteOsTimeline.tsx`, `cliente_os_timeline_service.py`, `useClienteOsTimeline.ts` |
| Página de prova | `ClienteProofBridgePage.tsx`, `proof/ClienteProofPage.tsx`, `ClienteProofActions.tsx`, `ClienteProofViewer.tsx`, `ClienteProofDecisionModal.tsx`, `ClienteOsContextHeader.tsx` |
| Rotas | `routes/cliente/os/$ano/$nrOs/prova.tsx` |
| APIs frontend | `api/cliente-portal.ts`, `api/proof-portal.ts`, `utils/pendenciaBridge.ts` |
| Backend | `cliente_gabinete_routes.py`, `proof_portal_routes.py`, `email_routes.py`, `cliente_os_timeline_service.py` |
| Testes existentes | `pendenciaBridge.test.ts`, `test_public_tokens.py` |

---

## 3. Arquivos criados

| Arquivo | Descrição |
|---------|-----------|
| `apps/web/src/features/cliente/utils/proofApprovalUtils.ts` | `isProofApprovalPending`, `isProofTimelineMovement`, `getProofApprovalRoute`, `PROOF_VIEW_LABEL` |
| `apps/web/src/features/cliente/utils/proofApprovalUtils.test.ts` | Testes das funções utilitárias |
| `apps/web/src/features/cliente/components/proof/ClienteProofActions.test.tsx` | Testes de validação do formulário |
| `docs/RELATORIO_IMPLEMENTACAO_PROVA_CLIENTE.md` | Este relatório |

---

## 4. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `pendenciaBridge.ts` | Label de prova → “Visualizar prova” |
| `pendenciaBridge.test.ts` | Atualização do teste de label |
| `ClienteOsActionButton.tsx` | Detecção de prova via utilitário; botão azul para prova; suporte a `sectionKind` |
| `ClienteCompactOsCard.tsx` | Repasse de `sectionKind` ao botão |
| `ClienteOsTimeline.tsx` | Botão interno “Visualizar prova” apenas em andamentos de prova |
| `ClienteProofBridgePage.tsx` | Título e subtítulo da página |
| `ClienteProofPage.tsx` | Campo ponto; textos de confirmação/sucesso |
| `ClienteProofActions.tsx` | Campos Nome, Número de ponto, Observações; “Solicitar alterações” |
| `ClienteProofViewer.tsx` | Textos “Prova ainda não disponível”, “Abrir PDF em nova aba”, “Baixar PDF” |
| `ClienteProofDecisionModal.tsx` | Fechar com tecla Escape |
| `api/proof-portal.ts` | Campo `ponto` no `respondProof` |
| `app/backend/routers/proof_portal_routes.py` | Campo `ponto` obrigatório; observação obrigatória ao rejeitar; ponto no andamento |
| `app/backend/routers/cliente_gabinete_routes.py` | `pendencia_tipo` no payload; label “Visualizar prova” |
| `app/backend/tests/test_public_tokens.py` | Teste de rejeição sem observações |

---

## 5. Como o botão foi incluído nos cards

- A seção **Aguardando Aprovação** já tinha `showPendenciaButton: true` em `clienteSectionConfig.ts`.
- `ClienteOsActionButton` agora usa `isProofApprovalPending(item, sectionKind)` para exibir o botão mesmo quando `pendencia_tipo` não vinha no payload (corrigido no backend).
- Texto do botão: **Visualizar prova** (`PROOF_VIEW_LABEL`).
- Navegação interna: `/cliente/os/$ano/$nrOs/prova` (rota autenticada).
- Estilo: `secondary-blue` (destaque sem cor agressiva); largura confortável no mobile (`w-full sm:w-auto`).

---

## 6. Como o botão foi incluído na timeline

- `ClienteOsTimeline` usa `isProofTimelineMovement(step)` para identificar andamentos de prova/aprovação.
- Somente nesses andamentos aparece `<Link>` interno com **Visualizar prova**.
- Demais pendências (PT, arquivos) continuam com link externo `pendencia_url`.
- Lazy loading da timeline preservado (`enabled: expanded`).

Critérios em `isProofTimelineMovement`:

- `pendencia_tipo === "aprovacao_prova"`
- Situação `Aguard. Aprovação` / `Aguardando Aprovação`
- Labels/mensagens contendo “visualizar prova”, “aprovação”, etc.

---

## 7. Rota criada para visualização da prova

**Rota (já existente, reutilizada):** `/cliente/os/$ano/$nrOs/prova`

| Arquivo | Papel |
|---------|-------|
| `routes/cliente/os/$ano/$nrOs/prova.tsx` | Rota TanStack Router |
| `ClienteProofBridgePage.tsx` | Bridge autenticado: resolve OS + token do dashboard |
| `ClienteProofPage.tsx` | Viewer PDF + formulário + modais de confirmação |

Título da página: **Visualização e aprovação de prova**  
Subtítulo: *Confira o arquivo enviado e registre sua aprovação ou solicitação de ajuste.*

---

## 8. Como o PDF é localizado

### Fluxo de envio (e-mail)

1. `email_routes.py` chama `ensure_proof_token(os, ano, versao)` → grava em **`tabProofTokens`** (token, versão, OS, ano).
2. Gera link `build_proof_portal_url` → `/portal/aprovacao/{token}?os=&ano=`.
3. O link é inserido no HTML do e-mail de prova.

### Servir o PDF

`proof_portal_routes._latest_proof_pdf(ano, os_id)`:

1. Resolve pasta da OS via `email_routes._get_os_folder_path`.
2. Busca `*.pdf` em subpasta **`Sefoc`**.
3. Retorna o PDF **mais recente** por `mtime`.

### Bridge autenticado

`ClienteProofBridgePage` extrai o token de `item.pendencia_url` (parse `/portal/aprovacao/{token}`) e repassa para `ClienteProofPage`, que consome `/api/client/proof/{ano}/{os}?token=`.

### Limitação documentada

O vínculo PDF ↔ versão da prova **não é armazenado explicitamente** no banco. O sistema usa o PDF mais recente na pasta `Sefoc` da OS. Se houver múltiplas versões simultâneas na mesma pasta, o arquivo exibido será o de modificação mais recente — não necessariamente indexado pelo token/versão.

---

## 9. Endpoints reutilizados

| Método | Endpoint | Uso |
|--------|----------|-----|
| GET | `/api/client/proof/{ano}/{os_id}?token=` | Metadados da prova |
| GET | `/api/client/proof/{ano}/{os_id}/pdf?token=` | Stream do PDF |
| POST | `/api/client/proof/respond` | Aprovar / solicitar alterações |
| GET | `/api/cliente/dashboard` | Lista OS + `pendencia_url` |
| GET | `/api/cliente/os/{ano}/{nr_os}/andamentos` | Timeline com pendências |

**Não foram criados** endpoints duplicados `GET /cliente/os/{ano}/{os}/prova` — o bridge autenticado reutiliza os endpoints token-based existentes, validando vínculo OS ↔ gabinete via sessão do dashboard.

---

## 10. Endpoints criados

Nenhum endpoint novo. Alterações mínimas em endpoints existentes:

- `POST /api/client/proof/respond`: campo **`ponto`** obrigatório; validação de **observações** ao solicitar alterações.

---

## 11. Validações de segurança

| Regra | Implementação |
|-------|---------------|
| Autenticação do cliente | `ClienteAuthenticatedLayout` na rota `/cliente/os/.../prova` |
| OS pertence ao gabinete | `ClienteProofBridgePage` valida OS no dashboard do cliente logado |
| Token de prova | `_validate_proof_token` — inválido/expirado/respondido → 403/409 |
| Sem aprovação via GET | Resposta apenas via `POST /client/proof/respond` |
| Nome e ponto obrigatórios | Pydantic `min_length` + validação frontend |
| Observações ao solicitar alterações | HTTP 400 se vazio no backend; botão disabled no frontend |
| PDF ausente | HTTP 404 no endpoint; UI “Prova ainda não disponível” |
| Caminho físico não exposto | `FileResponse` com nome do arquivo, sem path de rede |
| Andamento registrado | `_register_proof_andamento` com ponto formatado do cliente |
| Resposta duplicada | Token com `Aprovado` preenchido → 409 |

**Não alterados (conforme regras):** `clienteStore`, `ClienteAuthGuard`, cookie `sagra_cliente_session`, `/portal/pt/{token}`.

---

## 12. Testes executados

### Backend (`pnpm test:backend`)

```
108 passed in 1.92s
```

Inclui novo teste: rejeição sem observações retorna 400.

### Frontend (`pnpm test:frontend`)

```
12 files, 51 tests passed
```

Novos/alterados:

- `proofApprovalUtils.test.ts` (8 testes)
- `ClienteProofActions.test.tsx` (3 testes)
- `pendenciaBridge.test.ts` (label atualizado)

### `pnpm test` (script raiz)

Falha **pré-existente** no ambiente Windows/PowerShell: o script usa `&&` em `package.json`, não suportado nesta versão do PowerShell. Os testes individuais (`test:backend`, `test:frontend`) passaram.

---

## 13. Resultado dos comandos

| Comando | Resultado |
|---------|-----------|
| `pnpm test:backend` | ✅ 108 passed |
| `pnpm test:frontend` | ✅ 51 passed |
| `pnpm test` | ❌ Falha no script `&&` (PowerShell) — pré-existente |
| `pnpm build` | ✅ Sucesso |
| `pnpm lint` | ✅ Sucesso (eslint pendente Fase 0 — pré-existente) |
| `pnpm typecheck` | ❌ TS6310 em `tsconfig.app.json` — pré-existente |

---

## 14. Pendências ou limitações

1. **PDF por versão:** não há campo estruturado ligando token/versão ao arquivo PDF específico; usa o mais recente em `Sefoc/`.
2. **Typecheck monorepo:** erro TS6310 pré-existente nos project references.
3. **Script `pnpm test`:** incompatível com PowerShell antigo (`&&`).
4. **Deploy:** alterações apenas em `app/backend` (não em `deploy/release`).

---

## 15. Checklist de validação manual

- [ ] Login no Portal do Cliente
- [ ] Abrir seção **Aguardando Aprovação**
- [ ] Verificar botão **Visualizar prova** no card
- [ ] Expandir OS
- [ ] Verificar botão **Visualizar prova** no andamento correto da timeline
- [ ] Abrir página de prova (`/cliente/os/{ano}/{os}/prova`)
- [ ] Confirmar que PDF aparece (ou estado “Prova ainda não disponível”)
- [ ] Testar **Abrir PDF em nova aba**
- [ ] Tentar aprovar sem nome → bloqueado
- [ ] Tentar aprovar sem ponto → bloqueado
- [ ] Tentar solicitar alterações sem observações → bloqueado
- [ ] Aprovar com dados válidos (ambiente de teste)
- [ ] Solicitar alterações com dados válidos (ambiente de teste)
- [ ] Verificar atualização da OS após resposta
- [ ] Testar em mobile
- [ ] Confirmar que **Problemas Técnicos** continuam funcionando
- [ ] Confirmar refetch 60s do dashboard (`staleTime: 60_000` em `useClienteDashboardOs`)

---

## Auditoria rápida (Parte 1)

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Como a OS entra em “Aguardando Aprovação”? | `_classify_pendencia`: situação `Aguard. Aprovação` → lista `pendencias_aprovacao` |
| 2 | `pendencia_tipo` de prova? | `aprovacao_prova` |
| 3 | Existe `pendencia_url`? | Sim — `/portal/aprovacao/{token}?os=&ano=` |
| 4 | E-mail grava link/token? | Sim — `tabProofTokens` + link no HTML do e-mail |
| 5 | Onde fica o PDF? | Pasta da OS → subpasta `Sefoc/*.pdf` |
| 6 | Endpoint do PDF? | `GET /api/client/proof/{ano}/{os_id}/pdf?token=` |
| 7 | Endpoint aprovar/alterar? | `POST /api/client/proof/respond` |
| 8 | Timeline identifica prova? | `cliente_os_timeline_service._resolve_pendencia_for_step` + `isProofTimelineMovement` |
| 9 | Payload do dashboard | OS, situação, `pendencia_url`, `versao`; agora também `pendencia_tipo` |
| 10 | Dados adicionados | `pendencia_tipo` no dashboard; `ponto` na resposta de prova |

---

## Resumo técnico

O Portal do Cliente já possuía a base da funcionalidade. Esta entrega **completou a experiência** com:

- Botão consistente **Visualizar prova** (card + timeline interna)
- Formulário completo (nome + ponto + observações)
- Textos e confirmações conforme especificação
- Utilitários centralizados para evitar lógica textual espalhada
- Correção do payload do dashboard (`pendencia_tipo`)
- Validação reforçada no backend para solicitação de alterações
