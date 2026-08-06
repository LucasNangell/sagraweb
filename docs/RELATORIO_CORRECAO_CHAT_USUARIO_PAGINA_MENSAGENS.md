# Relatório — Correção do Chat do Usuário

**Data:** 09/06/2026  
**Solução adotada:** **B — Página `/mensagens`** (substitui o modal como fluxo principal)

---

## 1. Veredito

**Corrigido com ressalvas.**

O chat do usuário passa a funcionar em **`/mensagens`**, espelhando a arquitetura comprovada de `/admin/mensagens`. O modal interno foi **retirado do fluxo principal**; permanece apenas para tickets **assigned** (dúvidas de clientes em Problemas Técnicos).

---

## 2. Causa confirmada

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | O evento WS da resposta chega no front do usuário? | **Sim**, via `support_chat_message` e `notification_new` / `support_reply` (conexões globais do Header/`OsNotificationHandler`). |
| 2 | Chega no modal mas não atualiza cache? | **Parcialmente** — o hook até atualizava cache, mas o fluxo modal era frágil. |
| 3 | Não chega por conexão condicional/efêmera? | **Sim, fator principal** — `useSupportChatRealtime` no modal só com `enabled` quando modal aberto + view `thread`; 3ª conexão WS separada das conexões permanentes. |
| 4 | Problema de `enabled`, view, desmontagem? | **Sim** — modal retorna `null` quando fechado; troca menu/lista/thread desliga WS; estado fragmentado em múltiplas views. |
| 5 | Admin funciona por listener extra? | **Sim** — `/admin/mensagens` usa **página montada** + listener dedicado `support_incoming` + `useSupportChatRealtime` estável com ticket selecionado. |
| 6 | Admin serve de modelo? | **Sim** — adotado como referência direta. |

**Conclusão:** o modal concentrava WS condicional, lifecycle instável e fallback insuficiente comparado à página admin. **Solução B** é mais robusta.

---

## 3. Solução adotada

- **Página `/mensagens` criada** (`UserSupportMessagesPage`)
- **Modal interno removido** do fluxo principal (`SupportHelpMenu` → navegação)
- **Modal mantido** somente para `modalKind === "assigned"` (notificações `cliente_support`)

---

## 4. Nova arquitetura

### Rota

- `/_authenticated/mensagens` → URL **`/mensagens`**
- Query param: **`?ticket={id}`** (abre ticket automaticamente)

### Componentes

| Componente | Papel |
|------------|-------|
| `UserSupportMessagesPage.tsx` | Página principal (lista + thread + nova mensagem) |
| `SupportThreadView.tsx` | Thread compartilhada (balões, auto-scroll) |
| `useSupportChatRealtime.ts` | WS chat + subscribe por ticket |
| `supportNotificationHandlers.ts` | Fallback `support_reply` |
| `supportThreadCache.ts` | Merge deduplicado no cache |
| `SupportMessageModal.tsx` | **Legado assigned only** |

### Endpoints (usuário)

- `GET /api/support/tickets`
- `GET /api/support/tickets/{id}`
- `POST /api/support/messages`
- `POST /api/support/tickets/{id}/reply`

### Query keys

- `["support", "userTickets", status]`
- `["support", "userTicket", id]`

### WebSocket (dupla camada — igual admin)

1. **`useSupportChatRealtime`** — `support_chat_message`, typing, resolved → `setQueryData`
2. **Listener na página** — `notification_new` / `support_reply` → `handleSupportReplyNotification` → invalida ticket + lista

---

## 5. Tempo real

| Evento | Tratamento |
|--------|------------|
| `support_chat_message` | `applyThreadMessageToCache` no ticket aberto |
| `support_chat_resolved` | `applyTicketResolvedToCache` |
| `notification_new` / `support_reply` | Invalida `userTicket` + `userTickets` |
| `support_subscribe` | Enviado ao selecionar ticket + retry 400 ms após reconexão |

**Fallback polling:** 30 s (WS ok) / 15 s (WS instável), só com ticket aberto não resolvido; lista 30 s.

---

## 6. Alterações no menu/notificações

| Antes | Depois |
|-------|--------|
| Ajuda → “Mensagem ao suporte” abre modal | Navega para **`/mensagens`** |
| Notificação `support_reply` abre modal | Navega para **`/mensagens?ticket={id}`** |
| Notificação `cliente_support` | Modal assigned (inalterado) |
| Notificação `support_incoming` (admin) | `/admin/mensagens?ticket={id}` (inalterado) |

`viewingTickets.usuario` continua sendo setado na página para supressão correta de notificações.

---

## 7. Segurança

- Endpoints usuário filtram por `Ponto` da sessão (backend inalterado)
- WS entrega por `owner_ponto` / subscribe (testes backend existentes)
- Front filtra eventos por `ticket_id` e `target_ponto`
- Admin permanece isolado em `/admin/mensagens`

---

## 8. UX

- Layout **duas colunas** (desktop) igual admin
- **Mobile:** lista → conversa fullscreen com botão voltar
- Preview da última mensagem na lista
- Badges de status (Aberto / Respondido / Aguardando / Resolvido)
- Formulário “Nova mensagem” integrado
- Balões, separadores de data, auto-scroll inteligente, Enter/Shift+Enter

---

## 9. Arquivos alterados

| Arquivo | Motivo |
|---------|--------|
| `features/support/components/UserSupportMessagesPage.tsx` | **Novo** — página do usuário |
| `routes/_authenticated/mensagens.tsx` | **Novo** — rota `/mensagens` |
| `features/support/components/SupportHelpMenu.tsx` | Navegação em vez de modal |
| `features/support/components/NotificationCenter.tsx` | `support_reply` → `/mensagens?ticket=` |
| `components/layout/AppShell.tsx` | Modal só para `assigned` |
| `features/support/utils/supportDisplayUtils.ts` | Preview de última mensagem |
| `features/support/utils/supportDisplayUtils.test.ts` | **Novo** — testes preview |
| `routeTree.gen.ts` | Gerado automaticamente no build |

**Não alterados:** `AdminSupportMessagesPage`, backend, portal cliente, WebSocket server.

---

## 10. Testes executados

| Comando | Resultado |
|---------|-----------|
| `pnpm test` | **94 passed** |
| `pnpm build` | **OK** (rota `/mensagens` registrada) |
| `pnpm typecheck` | Falha **pré-existente** TS6310 |
| Backend pytest | Não reexecutado (sem alteração backend nesta entrega) |

### Checklist manual (executar em ambiente integrado)

1. Usuário abre `/mensagens`
2. Cria ticket → admin vê em `/admin/mensagens`
3. Admin responde → usuário vê **sem F5**
4. Três respostas rápidas → sem duplicata
5. Notificação → abre `/mensagens?ticket=id`
6. Mobile lista/conversa
7. Admin e portal cliente intactos

---

## 11. Pendências

| Item | Notas |
|------|-------|
| Modal legado (`SupportMessageModal`) | Mantido só para assigned; pode ser removido futuramente |
| Singleton WebSocket | Ainda múltiplas conexões; página reduz fragilidade vs modal |
| Lido/não lido por mensagem | Não implementado |
| Paginação de thread | Não implementado |
| Anexos | Fora de escopo |
| Entrada na sidebar principal | Apenas via menu Ajuda (como antes) |

---

**Critério de aceite:** conversa em `/mensagens` com atualização em tempo real equivalente ao admin — resposta do administrador visível imediatamente, sem fechar modal, sem F5.
