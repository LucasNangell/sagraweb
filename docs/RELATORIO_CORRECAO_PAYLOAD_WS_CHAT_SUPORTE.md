# Relatório — Correção Payload WebSocket Chat de Suporte

## 1. Veredito

**Corrigido com ressalvas.**

A causa principal não era “front lendo caminho errado” para typing (que já tinha `ticket_id` na raiz), e sim:

1. **`support_chat_message` não era entregue de forma confiável** — usava apenas `schedule_broadcast` (thread sync), enquanto notificações usam HTTP `/realtime/notify` (loop async garantido).
2. **`SocketMessage` descartava campos extras** (`ticket_id`, `message`, etc.) no endpoint `/api/realtime/notify` — explicando `ticket_id: undefined` nos logs de `support_incoming` / `support_reply`.
3. **Logs admin poluídos** — eventos `pong` (heartbeat) eram logados como se fossem suporte, gerando `ticket_id: undefined` falso-positivo.

---

## 2. Causa real

| Sintoma | Causa |
|---------|-------|
| Typing funciona | Relay WS direto no handler async; payload com `ticket_id` na raiz |
| Mensagem não chega em tempo real | `push_support_thread_message` → `schedule_broadcast` falhava/intermitente em thread sync; usuário só via polling ~30s |
| Admin log `ticket_id: undefined` em `support_incoming` | `push_user_notification` não passava `ticket_id`; HTTP notify stripava extras via Pydantic |
| Admin log `ticket_id: undefined` genérico | Heartbeat `pong` logado sem filtro |
| Usuário não loga `support_chat_message` | Evento não chegava ao browser (entrega backend), não era bug de cache |

**Não era:** dedupe bloqueando mensagens (já isento desde correção anterior).

**Era também:** race refetch em `support_reply` (corrigido anteriormente — skip refetch com ticket aberto).

---

## 3. Evidências dos logs

### Antes (admin — falso positivo)

```
[ADMIN SUPPORT PAGE] pong { ticket_id: undefined, action: undefined }
[ADMIN SUPPORT PAGE] notification_new { ticket_id: undefined, action: "support_incoming" }
```

### Depois (esperado em DEV)

Backend:
```
[SUPPORT EMIT] type=support_chat_message ticket_id=4 message_id=123 author_role=admin owner=918713
[SUPPORT DELIVERY] event=support_chat_message ticket=4 ... delivered=true reason=delivered
```

Front usuário:
```
[SUPPORT WS RAW] USER { type: "support_chat_message", ticket_id: 4, message_id: 123, message: {...} }
[SUPPORT WS NORMALIZED] USER { type: "support_chat_message", ticketId: 4, messageId: 123, ... }
[USER SUPPORT EVENT] support_chat_message { ticket_id: 4, message_id: 123 }
[USER SUPPORT CACHE UPDATED] appended
```

Front admin (`support_incoming`):
```
[SUPPORT WS NORMALIZED] ADMIN PAGE { action: "support_incoming", ticketId: 4, ... }
```

---

## 4. Correções no backend

| Arquivo | Mudança |
|---------|---------|
| `notification_push_service.py` | Novo `broadcast_ws_payload()` — HTTP notify primeiro, `schedule_broadcast` fallback |
| `support_realtime_service.py` | `_schedule()` usa `broadcast_ws_payload`; payload padronizado com `message_id`, `author_role` na raiz; log `[SUPPORT EMIT]` |
| `realtime.py` | `SocketMessage` com `extra="allow"` + campos explícitos (`ticket_id`, `message_id`, `message`, `author_role`, …) |
| `support_message_service.py` | `support_incoming` passa `ticket_id` / `support_message_id` no push |

### Payload padronizado — mensagem

```json
{
  "type": "support_chat_message",
  "ticket_id": 4,
  "message_id": 123,
  "message": { "Id": 123, "TicketId": 4, "Mensagem": "...", "AutorTipo": "admin" },
  "author_role": "admin",
  "owner_ponto": "918713",
  "ticket_status": "aberto"
}
```

### Payload padronizado — notificação

```json
{
  "type": "notification_new",
  "action": "support_reply",
  "ticket_id": 4,
  "support_message_id": 4,
  "target_ponto": "918713",
  "notification_id": 999
}
```

---

## 5. Correções no front

| Arquivo | Mudança |
|---------|---------|
| `normalizeSupportWsEvent.ts` | **Novo** — extrai `ticketId`, `messageId`, `message`, etc. de múltiplos caminhos; `logSupportWsEvent()` com RAW + NORMALIZED |
| `useUserSupportPageWebSocket.ts` | Usa evento normalizado; log de erro se `support_chat_message` sem `ticketId` |
| `useSupportChatRealtime.ts` | Usa normalização; fallback `message.TicketId` |
| `AdminSupportMessagesPage.tsx` | Normalização; ignora `pong`; `support_incoming` com `ticketId` |
| `supportThreadCache.ts` | Alias `mergeSupportMessageIntoTicket`; `cache_miss` → `refetchQueries` |

---

## 6. Eventos finais

| type | action | ticket_id | message_id | Emissor | Receptor | Tratamento front |
|------|--------|-----------|------------|---------|----------|------------------|
| `support_chat_message` | — | raiz | raiz | Backend reply | Owner/subscribed | `applyThreadMessageToCache` |
| `support_chat_typing` | — | raiz | — | Relay WS | Owner/subscribed | `remoteTyping` |
| `support_chat_resolved` | — | raiz | — | Backend resolve | Owner/subscribed | cache status |
| `notification_new` | `support_reply` | raiz | — | Backend notify | Usuário (ponto) | invalidate/refetch |
| `notification_new` | `support_incoming` | raiz | — | Backend notify | Admin (ponto) | invalidate admin |

---

## 7. Testes executados

| Comando | Resultado |
|---------|-----------|
| `pnpm test:frontend` | 101 passed (incl. 6 testes `normalizeSupportWsEvent`) |
| `pytest test_websocket.py` | 10 passed |
| `pnpm build` | OK |
| `pnpm typecheck` | Falha **pré-existente** TS6310 |

---

## 8. Pendências

- Singleton WebSocket por aba (NotificationCenter + chat).
- Paginação de thread, lido/não lido, anexos.
- Remover logs RAW após estabilização ou gate `VITE_WS_DEBUG`.

---

## Como validar

1. **Reiniciar backend** (código alterado em Python).
2. Admin: Chrome normal | Usuário: janela anônima.
3. Usuário: `/mensagens?ticket=4`.
4. Admin envia mensagem.
5. Console usuário **deve** mostrar:
   - `[SUPPORT WS RAW]` com `ticket_id: 4`
   - `[USER SUPPORT EVENT] support_chat_message ticket_id=4`
   - `[USER SUPPORT CACHE UPDATED] appended`
6. Mensagem aparece **< 1 s** sem F5.
7. Console admin **não** deve logar `pong` como evento de suporte.
8. `support_incoming` deve mostrar `ticketId: 4` no objeto normalizado.
