# Relatório — Correção Final Delivery Chat Suporte

## 1. Veredito

**Corrigido (v2 hub + broadcast in-process).** Versão front: `support-front-hub-20250609-2200`

## 2. Causa real (atualizada)

1. **Broadcast de suporte ia primeiro por HTTP `/realtime/notify`** — payload passava por `SocketMessage` (Pydantic) e podia perder campos; em alguns cenários o worker que tinha as conexões WS não recebia o evento.

2. **Admin com 2 conexões WebSocket na mesma página** — `AdminSupportMessagesPage` + `useSupportChatRealtime` abriam sockets separados; subscribe ia para um, expectativa de delivery no outro.

3. **`useSupportChatRealtime` fazia unsubscribe no cleanup do React** — StrictMode/remounts removiam a inscrição do admin antes da mensagem chegar.

4. **Usuário: mesmo padrão multi-socket** (NotificationCenter + hook) — mitigado com registry por ponto, mas o hub elimina a causa raiz no chat.

## 3. Correções v2

| Camada | Mudança |
|--------|---------|
| **Backend broadcast** | `support_*` usa **sempre** `schedule_broadcast` in-process (sem HTTP-first) |
| **Backend notify** | `/api/realtime/notify` aceita JSON bruto (preserva `message` aninhado) |
| **Backend delivery** | Registry `_ticket_conn_subscribers` + `_ponto_subscriptions` + owner/assigned |
| **Front hub** | `supportWebSocketHub.ts` — **uma conexão WS por aba** para suporte |
| **Admin** | Página + chat usam o mesmo hub (ref-count) |
| **Usuário** | `useUserSupportPageWebSocket` usa hub |
| **Subscribe** | Sem unsubscribe agressivo no unmount; troca só quando ticket muda |

## 4. Testes

```bash
python -m pytest app/backend/tests/test_websocket.py app/backend/tests/test_support_ws_delivery.py -v
# 22 passed

pnpm test:frontend
# 107 passed
```

## 5. Validar manualmente

1. `iniciar-servidor.bat restart`
2. Admin Chrome + usuário anônimo
3. Admin `/admin/mensagens?ticket=N` — enviar e receber mensagens < 1s
4. Usuário `/mensagens?ticket=N` — idem
5. Logs backend (`SUPPORT_WS_DEBUG=true`):
   - `[SUPPORT SUBSCRIBE RECEIVED] after_support_tickets=[N]`
   - `[SUPPORT DELIVERY CHECK] delivered=True`
6. Console front:
   - `support-front-hub-20250609-2200`
   - `MESSAGE RECEIVED` / `USER SUPPORT MESSAGE RECEIVED`

## 6. Segurança

Inalterada — delivery exige subscribe, owner, assigned ou cliente_id; teste `test_no_leak_to_other_user` passa.
