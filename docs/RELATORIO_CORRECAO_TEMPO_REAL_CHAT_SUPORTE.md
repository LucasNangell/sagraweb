# Relatório — Correção Tempo Real Chat de Suporte

## 1. Veredito

**Corrigido com ressalvas.**

O sintoma reportado (typing funciona, mensagem não; mensagem aparece ~1 min depois; typing para após envio) foi rastreado até **três causas combinadas** no fluxo pós-envio do admin. Correções aplicadas no backend e front-end. Teste local continua exigindo **sessões separadas** (navegador + anônimo).

---

## 2. Causa real

### Por que typing chegava inicialmente

- `support_chat_typing` usa **relay direto** (`relay_support_typing`) — **sem dedupe global**.
- Entrega usa as mesmas regras de `_should_deliver` (subscribe / owner_ponto / assigned_ponto).
- Se typing aparece, a conexão WS do usuário está autenticada e elegível.

### Por que a mensagem não aparecia em tempo real

**Causa A — Race `support_chat_message` vs `support_reply` (principal)**

Sequência ao admin enviar resposta:

1. Backend emite `support_chat_message` (WS).
2. Backend emite `notification_new` / `action=support_reply` (WS).
3. Front usuário recebe `support_chat_message` → `applyThreadMessageToCache` append.
4. Front recebe `support_reply` → `handleSupportReplyNotification` **invalidava/refetch** de `["support","userTicket", id]`.
5. Refetch HTTP podia completar **antes** ou **sobrescrever** o cache WS com dados stale → mensagem sumia ou nunca aparecia na UI.
6. O fallback visível ~**30–60 s** era o `refetchInterval` da `detailQuery` (30 s), não o WS.

**Causa B — `ticket_id` ausente no payload WS de `support_reply`**

`push_user_notification` não incluía `ticket_id` no payload WS. O handler dependia de `viewing.usuario` ou fetch lento de notificações HTTP — refetch tardio ou errado.

**Causa C — Dedupe global podia bloquear `support_chat_message`**

`_dedupe_key` para `support_chat_message` usava apenas `type + ticket_id + owner_ponto` quando `message.Id` ausente. Mensagens distintas no mesmo ticket em <1 s podiam ser descartadas. **Corrigido:** `support_chat_message` não passa mais por dedupe.

### Por que typing parava após envio

- Admin envia `support_typing_stop` ao publicar mensagem → indicador some (esperado).
- Se subscription/WS ficava inconsistente após race de refetch, novos eventos typing podiam não atualizar UI.
- **Correção:** re-subscribe em `onOpen` + `status=connected`; não refetch destrutivo do ticket aberto em `support_reply`.

---

## 3. Prova por logs

### Backend (DEV)

```
[SUPPORT MESSAGE EMIT] ticket=45 message=99 author=admin owner=918713 assigned=None event=support_chat_message
[SUPPORT BROADCAST] ticket=45 message=99 owner=918713 event=support_chat_message candidates=3
[SUPPORT DELIVERY] event=support_chat_message ticket=45 conn=abc scope=authenticated ponto=918713 subscribed=true owner_match=true delivered=true reason=delivered
```

### Front usuário (DEV)

```
[USER WS OPEN] /ws?ponto=918713
[USER SUPPORT SUBSCRIBE] ticket_selected ticket=45 { sent: true }
[USER SUPPORT EVENT] type=support_chat_typing
[USER SUPPORT MESSAGE RECEIVED] { eventTicketId: 45, activeTicketId: 45, messageId: 99 }
[USER SUPPORT CACHE UPDATED] appended { queryKey: ["support","userTicket",45] }
```

Se aparecer `cache_miss → refetch`, o refetch imediato substitui o polling de 30 s.

---

## 4. Correções aplicadas

### Backend

| Arquivo | Mudança |
|---------|---------|
| `support_realtime_service.py` | Log `[SUPPORT MESSAGE EMIT]` |
| `notification_push_service.py` | `ticket_id` / `support_message_id` no payload WS |
| `support_message_service.py` | Passa `ticket_id` em `support_reply` |
| `realtime.py` | **`support_chat_message` isento de dedupe**; logs `[SUPPORT DELIVERY]` com `reason` |

### Front usuário

| Arquivo | Mudança |
|---------|---------|
| `supportThreadCache.ts` | `normalizeSupportThreadMessage`, `mergeSupportThreadMessage`; `cache_miss` → **`refetchQueries`**; não limpa cache com `undefined` |
| `supportNotificationHandlers.ts` | **Não refetch** do ticket aberto quando `viewing.usuario === ticketId` |
| `useUserSupportPageWebSocket.ts` | Logs OPEN/CLOSE/SUBSCRIBE/MESSAGE/CACHE; normalize message; resubscribe em `onOpen` |
| `useSagraWebSocket.ts` | Callbacks `onOpen` / `onClose` |
| `UserSupportMessagesPage.tsx` | `setViewingTicket` síncrono em `selectTicket` |

### Front admin

| Arquivo | Mudança |
|---------|---------|
| `useSupportChatRealtime.ts` | Normaliza mensagem WS; `refetchQueries` se payload inválido |

---

## 5. Eventos WebSocket finais

| Evento | Origem | Destino | Tratamento front usuário |
|--------|--------|---------|--------------------------|
| `support_chat_message` | `push_support_thread_message` | Owner/subscribed | `applyThreadMessageToCache` + log |
| `support_chat_typing` | `relay_support_typing` | Owner/subscribed | `remoteTyping` state |
| `support_chat_resolved` | `push_support_ticket_resolved` | Owner/subscribed | Cache status resolvido |
| `notification_new` / `support_reply` | `push_user_notification` | Filtro ponto | Invalida lista; **não refetch ticket aberto** |
| `support_subscribe` | Front → backend | — | Registra ticket na conexão |

---

## 6. Query keys / cache

| Key | WS `support_chat_message` | `support_reply` (ticket aberto) |
|-----|---------------------------|----------------------------------|
| `["support","userTicket", id]` | `setQueryData` append | **skip refetch** se `viewing.usuario === id` |
| `["support","userTickets"]` | invalidate | invalidate |
| `["notifications", ponto]` | — | invalidate |

---

## 7. Fallback

| Query | Intervalo | Quando |
|-------|-----------|--------|
| `userTickets` | 30 s | Sempre na página |
| `userTicket` | 30 s (WS ok) / 15 s (WS down) | Ticket selecionado, não resolvido |

**Não é solução principal.** Aceite: mensagem via WS em <1–2 s.

---

## 8. Testes executados

| Comando | Resultado |
|---------|-----------|
| `pnpm test:frontend` | 95 passed |
| `pytest test_websocket.py` | 9 passed |
| `pnpm build` | OK |
| `pnpm typecheck` | Falha **pré-existente** TS6310 |

---

## 9. Pendências

- Hub WebSocket único por aba (NotificationCenter + chat).
- Lido/não lido, paginação de thread, anexos.
- Remover logs DEV após estabilização ou gate `VITE_WS_DEBUG`.

---

## Como validar

1. Admin: Chrome normal. Usuário: **janela anônima**.
2. Usuário: `/mensagens` → selecionar ticket.
3. Console: `[USER SUPPORT SUBSCRIBE] ... sent: true`.
4. Admin digita → usuário vê typing.
5. Admin envia → console: `[USER SUPPORT CACHE UPDATED] appended` → mensagem **imediata**.
6. Admin digita de novo → typing continua funcionando.
