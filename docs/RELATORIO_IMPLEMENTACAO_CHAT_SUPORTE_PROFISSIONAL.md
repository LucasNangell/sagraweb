# Relatório — Implementação Chat de Suporte Profissional

**Data:** 09/06/2026  
**Escopo:** correção de tempo real no modal do usuário + melhorias de UX + paridade mínima admin/cliente

---

## 1. Veredito

**Corrigido com ressalvas.**

A causa raiz foi tratada com **fallback simétrico ao admin** (`notification_new` / `support_reply` → invalidação de `userTicket`), **cache de thread robusto** (`setQueryData` + deduplicação por `Id`), **subscribe WS reforçado** (reenvio após reconexão) e **polling leve** (15–30 s) enquanto a thread está aberta.

**Ressalva:** `pnpm typecheck` continua falhando por erro **pré-existente** (`TS6310` em projetos referenciados `api-types` / `ui`). Build e testes passaram.

---

## 2. Causa do bug

O modal do usuário dependia quase exclusivamente de uma **terceira conexão WebSocket efêmera** (`useSupportChatRealtime`, ativa só na view `thread`). Se o evento `support_chat_message` não fosse processado nessa conexão, **não havia fallback**.

O admin, por outro lado, tinha **duas camadas**:

1. `useSupportChatRealtime` → `setQueryData`
2. Listener de `notification_new` / `support_incoming` → `invalidateQueries` em `adminTicket` e `adminMessages`

Para o usuário, `support_reply` invalidava **apenas** `notifications(ponto)`, não `["support", "userTicket", id]`. Fechar e reabrir o modal forçava novo `GET /api/support/tickets/{id}`, mascarando o problema.

---

## 3. Correções de tempo real

### Eventos tratados

| Evento | Onde | Ação |
|--------|------|------|
| `support_chat_message` | `useSupportChatRealtime` | `applyThreadMessageToCache` + invalidação de listas |
| `support_chat_resolved` | idem | `applyTicketResolvedToCache` |
| `support_chat_typing` | idem | indicador preservado |
| `notification_new` / `support_reply` | `NotificationCenter`, `OsNotificationHandler` | `handleSupportReplyNotification` |
| `notification_new` / `cliente_support` | idem | `handleClienteSupportNotification` |

### Query keys invalidadas (fallback `support_reply`)

- `["support", "userTicket", ticketId]`
- `["support", "userTickets"]`
- `["notifications", ponto]`
- Resolução de `ticketId`: payload WS → `viewingTickets.usuario` → última notificação persistida

### Cache atualizado

- Função central `mergeThreadMessageIntoTicket` / `applyThreadMessageToCache`
- Deduplicação por `message.Id`
- `cache_miss` → `invalidateQueries` do ticket (não ignora mensagem)

### Fallback polling

- Modal usuário: `refetchInterval` **30 s** (WS conectado) ou **15 s** (WS desconectado/instável), só com thread aberta e ticket não resolvido
- Lista de conversas abertas: **30 s** com modal aberto na view `list`
- Portal cliente: mesma lógica na query `clienteTicket`

---

## 4. WebSocket

### Subscribe

- Envio de `support_subscribe` ao conectar (`status === "connected"`)
- **Reenvio após 400 ms** para cobrir race de handshake
- Unsubscribe no cleanup do effect

### Reconexão

- `useSagraWebSocket` já reconecta com backoff; effect reexecuta ao voltar `connected` e re-subscribe

### Duplicidade

- Merge ignora mensagens com mesmo `Id`
- Mutations locais continuam fazendo `setQueryData` com resposta HTTP completa (sem duplicar se WS chegar depois com mesmo `Id`)

**Não implementado:** singleton/provider global de WebSocket (pendência consciente, menor risco nesta entrega).

---

## 5. UX implementada

| Item | Status |
|------|--------|
| Cabeçalho “Suporte” + assunto + badge de status | Sim |
| Status: Aberto / Aguardando resposta / Respondido / Resolvido | Sim (derivado da thread) |
| Tipo Problema / Sugestão | Sim |
| Balões modernos (usuário direita azul, suporte esquerda) | Sim |
| Separadores por data (Hoje / Ontem / data) | Sim |
| Timestamps legíveis (hora) | Sim |
| Enter envia / Shift+Enter nova linha | Sim |
| Limite visual 8000 caracteres | Sim |
| Estados enviando / enviado / erro + tentar novamente | Sim (modal usuário) |
| Auto-scroll inteligente + botão “Novas mensagens” | Sim |
| Typing indicator | Preservado |
| Modal responsivo (mobile `dvh`, bottom sheet) | Sim |

---

## 6. Segurança

| Controle | Status |
|----------|--------|
| Usuário só invalida/atualiza próprio ticket via API | Inalterado (backend) |
| WS entrega por `owner_ponto` / subscribe / `cliente_id` | Testado em `test_websocket.py` |
| `add_user_reply` rejeita outro `Ponto` | Testado em `test_support_message_service.py` |
| Texto puro (`whitespace-pre-wrap`, sem HTML) | Mantido |
| Limite 8000 chars no formulário | Alinhado ao backend |

---

## 7. Performance

- **`setQueryData`** preferido para ticket aberto
- **`invalidateQueries`** só em fallback (`cache_miss`, `support_reply`, listas)
- Polling **≥ 15 s**, desligado com ticket resolvido ou modal fechado
- Sem refetch global a cada mensagem

---

## 8. Arquivos alterados

| Arquivo | Motivo |
|---------|--------|
| `apps/web/src/features/support/utils/supportThreadCache.ts` | **Novo** — merge/invalidate cache thread |
| `apps/web/src/features/support/utils/supportNotificationHandlers.ts` | **Novo** — fallback `support_reply` / `cliente_support` |
| `apps/web/src/features/support/utils/supportDisplayUtils.ts` | **Novo** — labels status/tipo |
| `apps/web/src/features/support/utils/supportThreadCache.test.ts` | **Novo** — testes unitários merge |
| `apps/web/src/features/support/utils/supportNotificationHandlers.test.ts` | **Novo** — testes extract ticket id |
| `apps/web/src/features/support/hooks/useSupportChatRealtime.ts` | Cache robusto, subscribe retry, `wsStatus` |
| `apps/web/src/features/support/components/SupportMessageModal.tsx` | Polling, header UX, send states, scroll signal |
| `apps/web/src/features/support/components/SupportThreadView.tsx` | Balões, datas, auto-scroll inteligente, form |
| `apps/web/src/features/support/components/NotificationCenter.tsx` | Fallback `support_reply` |
| `apps/web/src/features/os/components/OsNotificationHandler.tsx` | Fallback `support_reply` |
| `apps/web/src/features/cliente/hooks/useClienteSupportChatRealtime.ts` | Paridade cache/subscribe |
| `apps/web/src/features/cliente/components/ClienteSupportModal.tsx` | Polling + scroll signal |
| `app/backend/tests/test_websocket.py` | Testes entrega WS suporte |
| `app/backend/tests/test_support_message_service.py` | **Novo** — permissão por ponto |

**Não alterados:** rotas REST, schema DB, backend de broadcast WS, página admin (compatível via hook compartilhado).

---

## 9. Testes executados

| Comando | Resultado |
|---------|-----------|
| `pnpm test` (apps/web) | **92 passed** (incl. 8 novos) |
| `pnpm build` (apps/web) | **OK** |
| `pnpm typecheck` | **Falha pré-existente** TS6310 |
| `pnpm lint` | Stub (“eslint pendente”) — não executável |
| `python -m pytest app/backend/tests/test_websocket.py app/backend/tests/test_support_message_service.py -q` | **10 passed** |

### Testes manuais recomendados (checklist da spec)

Executar em ambiente com admin + usuário logados:

1. Usuário na thread → admin responde → mensagem aparece **sem fechar modal**
2. Três respostas rápidas → sem duplicatas
3. Usuário responde → admin vê em tempo real
4. Usuário na **lista** → admin responde → ao abrir thread, mensagem presente
5. Modal fechado → admin responde → notificação OK → ao abrir, thread atualizada
6. Admin resolve → modal usuário mostra “Resolvido” / form desabilitado
7. Usuário A não vê ticket de B
8. Portal cliente continua OK
9. Simular WS offline → polling recupera em ≤ 30 s

---

## 10. Pendências

| Item | Prioridade |
|------|------------|
| Singleton / provider WebSocket multiplexado | Média |
| Lido/não lido por mensagem (schema) | Baixa |
| Paginação da thread | Média |
| Anexos | Fora de escopo |
| Categorias Dúvida/Urgente no banco | Baixa |
| Busca/filtros avançados no admin | Baixa |
| Corrigir `pnpm typecheck` (TS6310 monorepo) | Infra |

---

*Prioridade absoluta atendida: resposta do administrador deve refletir no modal do usuário via WS + fallback de notificação + polling leve, sem exigir fechar/reabrir o modal.*
