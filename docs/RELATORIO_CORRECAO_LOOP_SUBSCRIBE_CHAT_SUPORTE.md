# Relatório — Correção Loop Subscribe Chat Suporte

## 1. Veredito

**Corrigido com ressalvas.**

Dois problemas distintos foram endereçados:

1. **Script dev** não reiniciava a API quando a porta 8001 já estava em uso → testes contra backend antigo.
2. **Loop subscribe/unsubscribe** no front → perda de eventos `support_chat_message` entre unsubscribe e re-subscribe.

---

## 2. Causa real

### API antiga rodando

`iniciar-servidor.bat` apenas avisava `Porta 8001 já em uso` e iniciava só o Vite. Correções de WebSocket no Python **não entravam em vigor** sem matar o processo Uvicorn anterior.

### Loop subscribe/unsubscribe (front)

| Problema | Efeito |
|---------|--------|
| **3 efeitos** disparando subscribe (`onOpen`, `status_connected`, `ticket_selected`) | 6–9 `SUBSCRIBE` por ticket |
| **`SUBSCRIBE_RETRY_MS = [0, 400, 1200]`** em cada efeito | Triplicava tentativas |
| **Cleanup unmount** com `sendUnsubscribe` | React StrictMode desmonta/remonta → `UNSUBSCRIBE ticket_change` no meio do chat |
| Log `"montada"` a cada mudança de `selectedId` | Parecia remontagem contínua |
| `resubscribeActiveTicket` resetava `subscribedTicketRef` no `onOpen` | Re-subscribe desnecessário |

**Resultado:** admin enviava mensagem no intervalo em que o usuário estava **desinscrito** → typing (relay) às vezes chegava, mensagem (broadcast) não.

### Não era (primariamente)

- Dedupe bloqueando mensagens (já isento).
- Payload sem `ticket_id` (corrigido na entrega anterior).

---

## 3. Correção no script dev

Arquivo: `iniciar-servidor.bat`

| Comando | Comportamento |
|---------|---------------|
| `iniciar-servidor.bat restart` | Mata PID em `:8001`, inicia API + Vite |
| `iniciar-servidor.bat --restart` | Idem |
| `iniciar-servidor.bat api-only` | Mata PID, reinicia só API |
| (sem restart) | Aviso + instrução `Use: iniciar-servidor.bat restart` |

Implementação:

- `netstat -ano | findstr ":8001" | findstr "LISTENING"`
- `taskkill /PID <pid> /F`
- Confirma porta liberada antes de subir API

---

## 4. Correção no front

### `useUserSupportPageWebSocket.ts`

- **`ensureSubscribed(ticketId, reason)`** centralizado:
  - Skip se `subscribedTicketRef.current === ticketId`
  - Unsubscribe anterior **só** se ticket mudou
  - Um retry em 400 ms se `send()` falhar
- **Um único `useEffect`** depende de `[status, selectedTicketId]`
- **Removido** unmount `sendUnsubscribe` (WS disconnect limpa no servidor)
- **Removidos** triple timers e efeitos duplicados
- Logs enriquecidos: `selected`, `subscribed`, `message`

### `UserSupportMessagesPage.tsx`

- Log `"montada"` **uma vez** com versão
- Log separado `"ticket selecionado"` ao trocar ticket

### Versões runtime (obrigatórias em teste)

| Onde | Log |
|------|-----|
| Backend startup | `[SUPPORT WS FIX VERSION] support-ws-fix-final-20250609-1930 pid=...` |
| Front `/mensagens` | `[SUPPORT FRONT VERSION] support-front-fix-final-20250609-1930` |

### Fallback `support_reply`

- Sempre `refetchQueries` do ticket (removido skip que impedia fallback imediato)

---

## 5. Logs de prova esperados

```
[SUPPORT WS FIX VERSION] support-ws-fix-final-20250609-1930 pid=12345
[SUPPORT FRONT VERSION] support-front-fix-final-20250609-1930
[USER SUPPORT PAGE] montada { version: "...", selectedTicketId: 5 }
[USER SUPPORT SUBSCRIBE] ws_connected ticket=5 { sent: true }
[USER SUPPORT SUBSCRIBE] skip (já inscrito) ticket=5   ← ao reconectar status, NÃO re-subscribe
[USER SUPPORT MESSAGE RECEIVED] { ticket: 5, selected: 5, subscribed: 5, message: 123 }
[USER SUPPORT CACHE UPDATED] appended { ticket: 5, message: 123, appended: true }
```

**Não deve aparecer** em loop:

```
[USER SUPPORT UNSUBSCRIBE] ticket_change ticket=5
[USER SUPPORT SUBSCRIBE] ticket_selected ticket=5  (repetido 6x)
```

---

## 6. Testes executados

| Comando | Resultado |
|---------|-----------|
| `pnpm test:frontend` | 101 passed |
| `pytest test_websocket.py` | 10 passed |
| `pnpm build` | OK |

---

## 7. Pendências

- Singleton WebSocket por aba (NotificationCenter + chat).
- Paginação thread, lido/não lido, anexos.

---

## Como validar (obrigatório)

1. `iniciar-servidor.bat restart`
2. Terminal SAGRA-API: confirmar `[SUPPORT WS FIX VERSION]`
3. Console usuário: confirmar `[SUPPORT FRONT VERSION]`
4. Abrir `/mensagens?ticket=5` — **um** subscribe ticket=5
5. Admin envia mensagem — aparece em < 1 s
6. Sem loop UNSUBSCRIBE/SUBSCRIBE no mesmo ticket
