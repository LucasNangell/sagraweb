# Relatório — Diagnóstico e Correção WebSocket Chat de Suporte

## 1. Veredito

**Corrigido com ressalvas.**

A causa raiz do chat do usuário não receber mensagens em tempo real foi identificada e corrigida no front-end. Logs de diagnóstico foram adicionados (somente em desenvolvimento) no backend e no front para provar o fluxo. O teste em **duas abas do mesmo navegador com o mesmo cookie de sessão** continua inválido — documentado abaixo.

---

## 2. Causa real

O evento **não se perdia no backend** na maioria dos cenários válidos. O problema estava no **front-end da página `/mensagens`**:

### Causa principal: duas conexões WebSocket na mesma aba

A `UserSupportMessagesPage` abria **duas conexões WS simultâneas** para o mesmo `ponto`:

| Conexão | Hook | `enabled` | Tratava |
|---------|------|-----------|---------|
| A | `useSupportChatRealtime` | só com ticket selecionado | `support_subscribe`, `support_chat_message`, typing |
| B | `useSagraWebSocket` (separado) | sempre que `ponto` existe | **apenas** `notification_new` / `support_reply` |

O backend entrega `support_chat_message` para conexões **subscribed** ou com `owner_ponto`/`assigned_ponto` correspondente. Porém:

1. A conexão **B** (sempre ativa) **não enviava** `support_subscribe` e **ignorava** `support_chat_message`.
2. A conexão **A** só existia com ticket selecionado; em race de reconexão o subscribe podia falhar (`send()` retorna `false` se socket ainda não aberto).
3. O backend faz broadcast para **todas** as conexões elegíveis — a mensagem podia chegar na conexão **B** e ser descartada silenciosamente (handler só olhava `notification_new`).

O admin funcionava porque:
- `useSupportChatRealtime` + listener `support_incoming` invalidam queries;
- o admin tipicamente tem ticket aberto com subscribe ativo;
- invalidação via notificação compensa falhas pontuais de cache.

### Causa secundária: typing

O typing (`support_typing` → relay → `support_chat_typing`) depende de WS conectado e `send()` bem-sucedido. Com conexão duplicada/instável na página do usuário, o admin deixava de receber `support_typing` enviado pelo usuário.

### Causa de teste inválido (localhost, mesma máquina)

Se admin e usuário estão em **duas abas do mesmo navegador** em `localhost`, compartilham o **mesmo cookie de sessão**. O último login sobrescreve a sessão — ambas as abas passam a ser o mesmo `ponto`. Nesse caso:
- WS do “usuário” autentica como admin;
- `owner_ponto` do ticket ≠ `conn.ponto`;
- subscribe pode ser aceito, mas entrega por `owner_match` falha;
- logs `[WS CONNECT]` mostram o **mesmo ponto** nas duas abas.

Isso **não é bug de produção** — é limitação de teste local.

---

## 3. Prova por logs

### Backend (somente `env=development|dev|local`)

Arquivo: `app/backend/services/support_ws_debug.py` + `app/backend/routers/realtime.py`

Exemplos esperados:

```
[WS CONNECT] id=a1b2c3d4 scope=authenticated ponto=123456 cliente_id=None path=... total=2
[SUPPORT SUBSCRIBE] conn=a1b2c3d4 ponto=123456 ticket=45 exists=True owner=123456 assigned=None accepted=True
[SUPPORT BROADCAST] ticket=45 message=99 owner=123456 assigned=None event=support_chat_message candidates=3
[SUPPORT DELIVERY] conn=a1b2c3d4 ponto=123456 subscribed=True owner_match=True assigned_match=False delivered=True
[SUPPORT DELIVERY] conn=e5f6g7h8 ponto=999999 subscribed=False owner_match=False assigned_match=False delivered=False
[SUPPORT TYPING RX] conn=a1b2c3d4 ponto=123456 ticket=45 type=support_typing author=usuario
[SUPPORT TYPING] ticket=45 author=usuario typing=True delivered_to=['e5f6g7h8:999999']
```

### Front-end usuário (somente `import.meta.env.DEV`)

Arquivo: `apps/web/src/lib/supportWsDebug.ts` + `useUserSupportPageWebSocket.ts`

```
[USER SUPPORT PAGE] montada { ponto: "123456", user: "João", selectedTicketId: 45 }
[USER SUPPORT PAGE] WebSocket status { status: "connected", ponto: "123456", selectedTicketId: 45 }
[USER SUPPORT WS] WS SEND ok { type: "support_subscribe", ticket_id: 45 }
[USER SUPPORT WS EVENT] support_chat_message { ticket_id: 45, messageId: 99 }
[USER SUPPORT WS] cache thread atualizado { queryKey: ["support","userTicket",45] }
```

### Front-end admin

```
[ADMIN SUPPORT WS] support_chat_message { ticket_id: 45, messageId: 100, author_role: "usuario" }
[ADMIN SUPPORT PAGE] support_incoming → invalidate adminMessages
[ADMIN SUPPORT WS] WS SEND ok { type: "support_typing", ticket_id: 45, author_role: "admin" }
```

---

## 4. Correções aplicadas

### Backend

- `app/backend/services/support_ws_debug.py` — helper `ws_log()` gated por `config_manager.is_development()`.
- `app/backend/routers/realtime.py`:
  - `conn_id` por conexão;
  - log `[WS CONNECT]`, `[SUPPORT SUBSCRIBE]`, `[SUPPORT UNSUBSCRIBE]`;
  - log `[SUPPORT BROADCAST]` + `[SUPPORT DELIVERY]` por conexão (subscribed, owner_match, assigned_match);
  - log `[SUPPORT TYPING RX]` e relay `[SUPPORT TYPING]`.

### Front-end usuário

- **Novo** `useUserSupportPageWebSocket.ts` — **uma única conexão WS** para `/mensagens`:
  - subscribe/unsubscribe com retry (0, 400, 1200 ms);
  - trata `support_chat_message`, `support_chat_typing`, `support_chat_resolved`;
  - trata `notification_new` / `support_reply` (fallback);
  - emite typing com debounce/stop.
- `UserSupportMessagesPage.tsx` — substituído `useSupportChatRealtime` + segundo `useSagraWebSocket` pelo hook unificado.
- `apps/web/src/lib/supportWsDebug.ts` — logs dev no console.

### Front-end admin

- `useSupportChatRealtime.ts` — logs dev opcionais (`debugScope`).
- `AdminSupportMessagesPage.tsx` — logs em `support_incoming`.

### Typing

- Usuário: typing via `useUserSupportPageWebSocket` (mesma conexão que subscribe).
- Admin: inalterado estruturalmente (`useSupportChatRealtime`); logs adicionados.

### Cache/query

- `support_chat_message` → `applyThreadMessageToCache` em `["support","userTicket", id]`.
- Lista → invalida `["support","userTickets"]`.
- `support_reply` → `handleSupportReplyNotification` (invalida ticket + lista + notifications).

---

## 5. Como testar corretamente em localhost

**Não use duas abas normais do mesmo navegador** para simular admin + usuário — o cookie de sessão é compartilhado por domínio.

Opções válidas:

| Método | Admin | Usuário |
|--------|-------|---------|
| Recomendado | Chrome normal | Chrome janela anônima |
| Alternativa | Chrome | Edge / Firefox |
| Alternativa | Perfil Chrome A | Perfil Chrome B |
| Alternativa | `localhost` | `127.0.0.1` (se sessões forem isoladas por host) |

Confirme nos logs:
- `[WS CONNECT]` mostra **pontos diferentes** em cada sessão;
- `[SUPPORT SUBSCRIBE]` aparece ao selecionar ticket na `/mensagens`;
- `[SUPPORT DELIVERY] delivered=True` para a conexão do usuário dono do ticket.

---

## 6. Eventos WebSocket finais

| Evento | Origem | Destino | Payload principal | Quem trata |
|--------|--------|---------|-------------------|------------|
| `support_subscribe` | Front | Backend | `ticket_id` | Backend registra em `support_tickets` |
| `support_unsubscribe` | Front | Backend | `ticket_id` | Backend remove subscribe |
| `support_typing` / `support_typing_stop` | Front | Backend → relay | `ticket_id`, `author_role`, `author_label` | Backend relay → `support_chat_typing` |
| `support_chat_message` | Backend (após POST reply) | Front subscribed/owner/assigned | `ticket_id`, `message`, `owner_ponto` | `useUserSupportPageWebSocket`, `useSupportChatRealtime` |
| `support_chat_typing` | Backend relay | Front subscribed/owner/assigned | `typing`, `author_role`, `author_label` | Hooks de chat |
| `support_chat_resolved` | Backend | Front | `ticket_id` | Hooks de chat |
| `notification_new` / `support_reply` | Backend push | Front (filtro ponto) | `action`, `ticket_id` | `useUserSupportPageWebSocket`, NotificationCenter |
| `notification_new` / `support_incoming` | Backend push | Admin | `action` | AdminSupportMessagesPage, NotificationCenter |

---

## 7. Query keys / cache

| Key | Quando atualiza (`setQueryData`) | Quando invalida |
|-----|----------------------------------|-------------------|
| `["support","userTicket", id]` | `support_chat_message` com ticket aberto | `support_reply`, fallback sem `message` |
| `["support","userTickets", status?]` | — | nova mensagem, resolved, `support_reply` |
| `["support","adminTicket", id]` | `support_chat_message` (admin hook) | `support_incoming`, reply mutation |
| `["support","adminMessages", status?]` | — | `support_incoming`, mutations |
| `["notifications", ponto]` | — | `support_reply`, `support_incoming` |

---

## 8. Segurança

- Entrega WS de chat continua filtrada por `_should_deliver`: subscribe explícito, `owner_ponto`, `assigned_ponto` ou `cliente_id` (portal cliente).
- Usuário não recebe ticket de outro sem match de ponto/subscribe.
- Admin inalterado; notificações e portal cliente não foram modificados estruturalmente.

---

## 9. Testes executados

| Comando | Resultado |
|---------|-----------|
| `pnpm test:frontend` | 94 passed |
| `python -m pytest app/backend/tests/test_websocket.py -q` | 8 passed |
| `pnpm build` | OK |
| `pnpm lint` | OK (placeholder Fase 0) |
| `pnpm typecheck` | **Falha pré-existente** TS6310 (projetos referenciados com `noEmit`) |

Testes manuais E2E (admin + usuário em sessões separadas) devem ser executados pelo operador seguindo a seção 5.

---

## 10. Pendências

- **Singleton WebSocket global** — NotificationCenter, OsNotificationHandler e páginas de chat ainda podem abrir múltiplas conexões por aba; unificar em hub compartilhado reduziria carga e races.
- Paginação de thread longa.
- Estado lido/não lido por mensagem.
- Remover logs de diagnóstico após estabilização em produção (ou gate por `VITE_WS_DEBUG`).

---

## Resumo da correção

**Antes:** página `/mensagens` tinha 2 WebSockets; o permanente ignorava `support_chat_message`.

**Depois:** `useUserSupportPageWebSocket` — 1 conexão, subscribe + mensagens + typing + notificações.

**Critério de aceite:** com sessões realmente separadas, resposta do admin aparece em `/mensagens` sem F5; typing funciona nos dois sentidos.
