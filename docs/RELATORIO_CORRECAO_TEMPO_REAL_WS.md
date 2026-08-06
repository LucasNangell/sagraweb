# Relatório — Correção de regressão de tempo real (WebSocket)

**Data:** 2026-06-08  
**Escopo:** Página inicial/lista de OSs, painéis setor/global, Sub OS, PCP  
**Restrições respeitadas:** MDB, `UltimoStatus`, portal cliente, polling agressivo não reintroduzido

---

## 1. Causa da regressão

A regressão foi **multifatorial**, combinando otimizações de performance com falhas no pipeline WS → cache → UI:

| Camada | Problema | Efeito |
|--------|----------|--------|
| **Frontend — `osRealtimeSync.ts`** | `fetchOsDetails` usado sem import | `silentRefreshOsPanels` lançava `ReferenceError`; histórico/detalhes da OS selecionada não atualizavam após WS |
| **Frontend — `useOsRealtimeSync.ts`** | `normalizeSystemUpdate()` descartava `action`, `sub_os_id`, etc. | Eventos `sub_os_history_*` não invalidavam queries de Sub OS/histórico |
| **Frontend — patch incremental** | `history[0]` após ordenação por `CodStatus` (não por `Data`) | Lista podia receber situação/setor **errados** ou sem mudança visível |
| **Frontend — `applyOsSystemUpdate`** | `return` antecipado quando OS não estava no cache da página e não estava selecionada | Lista não atualizava quando a OS deveria entrar/sair do filtro ou estava em outra página |
| **Frontend — painel setor** | Filtro WS `!data.setor \|\| data.setor === config.sector` | Com `setor` no payload (portal/PCP), painéis de **outros setores** não atualizavam quando a OS **saía** do setor |
| **Backend — PCP** | Cache in-memory (`SAGRA_PCP_QUEUE_CACHE_SEC`, default 8 s) invalidado **somente** em reorder | Painéis recebiam WS e refetch, mas a API devolvia **cache stale** até expirar TTL |
| **Otimização Fase 1** | Polling painéis 20–30 s → **5 min** | Correto como fallback, mas expôs os bugs acima (WS/cache/handlers deixaram de ser confiáveis) |

---

## 2. Eventos WS que estavam faltando ou mal tratados

### Backend — emissão

Os eventos **continuavam sendo emitidos** em andamento normal, Sub OS, PCP e rotas públicas. O gap principal não era ausência de broadcast, e sim:

- Payload incompleto (`setor`, `situacao`, `sub_os_id`) em alguns fluxos
- Cache PCP não invalidado junto com o broadcast

**Ajustes:**

- `_broadcast_os_system_update` e `broadcast_os_system_update` agora incluem `setor`, `situacao`, `sub_os_id`, `scope` quando disponíveis
- Sub OS usa `broadcast_os_system_update()` unificado (com invalidação de cache PCP)
- History add/update/replicate enviam `setor` e `situacao` no payload WS

### Frontend — tratamento

| Evento | Antes | Depois |
|--------|-------|--------|
| `system_update` | `action` ignorada | `action`, `sub_os_id` repassados a `applyOsSystemUpdate` |
| `sub_os_history_added` | Invalidação condicional quebrada | Invalida `subOs` + `subOsHistory` do alvo |
| `sub_os_history_deleted` | Idem | Idem + lógica de colapsar seleção Sub OS |
| `pcp_queue_update` | OK na home (`scheduleListRefresh`) | Mantido; painel setor filtra por setor |
| `system_update` (painel setor) | Filtrado por setor | **Sempre** dispara refetch (OS pode sair do setor) |

---

## 3. Queries que não estavam sendo invalidadas / atualizadas

| Query / cache | Problema | Correção |
|---------------|----------|----------|
| `queryKeys.os.history(ano, id)` | `silentRefreshOsPanels` falhava | Import de `fetchOsDetails` + refresh funcional |
| `queryKeys.os.subOs(ano, id)` | `action` ausente no handler | Invalidação em eventos `sub_os_history_*` |
| `queryKeys.os.subOsHistory(ano, id, subId)` | Idem | Usa `sub_os_id` do payload WS |
| `osSearchQueryKey(filters)` | Early return + patch errado | Full refresh quando patch falha ou OS fora da página |
| Cache backend `/api/pcp/queue` | Stale após andamento | `invalidate_pcp_queue_cache()` em todo broadcast operacional |

`invalidateQueries` + `setQueryData` (via `silentRefreshOsSearch` / `silentRefreshOsPanels`) garantem refetch imediato independentemente de `staleTime` (30 s na lista, 15 s no histórico).

---

## 4. Ajustes de cache / refetch

- **Backend:** nova função pública `invalidate_pcp_queue_cache()`; chamada em `_broadcast_os_system_update`, `broadcast_os_system_update` e fluxos Sub OS
- **Frontend lista:** patch incremental preservado quando OS está na página; fallback para `silentRefreshOsSearch` nos demais casos
- **Frontend histórico:** `pickLatestHistoryRow()` escolhe andamento por `Data` (não por `CodStatus`)
- **Painéis:** debounce WS 500 ms mantido; polling **5 min** mantido como fallback
- **Portal cliente:** não alterado (continua `staleTime: 60_000`, sem polling agressivo)

---

## 5. Atualização instantânea — página inicial

Fluxo após correção:

1. Backend emite `system_update` (com `action`, opcionalmente `setor`/`sub_os_id`)
2. `useOsRealtimeSync` recebe via `useSagraWebSocket`
3. `applyOsSystemUpdate`:
   - Patch rápido na linha se OS está na página atual
   - `silentRefreshOsSearch` se patch insuficiente ou OS fora da página
   - Se OS selecionada: `silentRefreshOsPanels` + invalidação Sub OS quando aplicável
4. Fallback WS desconectado: polling adaptativo 5–30 s (já existente em `useOsRealtimeSync`)

---

## 6. Atualização instantânea — painéis

### Painel setor

- `system_update` → **sempre** `scheduleFetchFromWs()` (debounce 500 ms)
- `pcp_queue_update` → refetch apenas se `setor` compatível
- Refetch chama `fetchDashboardSectorData` → `/api/pcp/queue` com cache backend **já invalidado**

### Painel global

- Sem alteração de lógica WS (já refetchava em todo `system_update`)
- Beneficia da invalidação de cache PCP no backend

---

## 7. Polling como fallback

| Tela | Intervalo | Papel |
|------|-----------|-------|
| Página inicial (lista OS) | WS + fallback 5–30 s se WS down | Primário: WS |
| Painel setor | 5 min (`DASHBOARD_POLL_INTERVAL_MS`) | Fallback |
| Painel global | 5 min (`POLL_MS`) | Fallback |
| Portal cliente | Sem intervalo; `staleTime` 60 s + focus | Inalterado |

Polling agressivo (20–30 s) **não** foi reintroduzido.

---

## 8. Arquivos alterados

### Backend

- `app/backend/routers/pcp_routes.py` — export `invalidate_pcp_queue_cache()`
- `app/backend/routers/os_routes.py` — broadcast enriquecido + invalidação PCP
- `app/backend/routers/realtime.py` — `broadcast_os_system_update` com campos extras + invalidação PCP
- `app/backend/services/os_componentes_service.py` — Sub OS usa broadcast unificado

### Frontend

- `apps/web/src/features/os/osRealtimeSync.ts` — import fix, lógica de refresh, `pickLatestHistoryRow`
- `apps/web/src/features/os/osHistoryUtils.ts` — `pickLatestHistoryRow()`
- `apps/web/src/features/os/hooks/useOsRealtimeSync.ts` — repasse completo do payload WS
- `apps/web/src/features/dashboard-setor/components/DashboardSetorPage.tsx` — WS `system_update` sempre refetch
- `apps/web/src/features/os/osHistoryUtils.test.ts` — teste unitário novo

---

## 9. Testes executados

| Comando | Resultado |
|---------|-----------|
| `python -m pytest app/backend/tests -q` | **107 passed** |
| `pnpm build` | **OK** |
| `pnpm lint` | **OK** (placeholders Fase 0) |
| `pnpm typecheck` | **Falha TS6310 pré-existente** em `tsconfig.app.json` (referências `api-types` / `ui` com `noEmit`) |
| `pnpm --filter @sagra/web test` | **40 passed** (incl. `osHistoryUtils.test.ts`) |

### Testes manuais recomendados (homologação)

1. Duas abas na página inicial: andamento em uma → lista e histórico (OS selecionada) atualizam sem F5
2. Andamento por componente → Sub OS / histórico / lista expandida
3. Painel setor aberto → novo andamento no setor aparece sem aguardar 5 min
4. Painel global → idem
5. Reorder PCP → fila atualiza via WS
6. WS desconectado → fallback eventual (5 min painéis; 5–30 s home)
7. Portal cliente → sem regressão

---

## 10. Pendências

1. **Homologação manual** nos cenários acima em ambiente com Nginx/produção
2. **`pnpm typecheck` TS6310** — erro pré-existente; corrigir configuração de project references quando conveniente
3. **Invalidação PCP por setor antigo/novo** — hoje limpa todo o cache in-memory (simples e correto para volume atual); otimização futura: invalidar apenas setores afetados em mudança de setor
4. **ESLint real** no `@sagra/web` ainda pendente (Fase 0)

---

## Resumo executivo

A regressão não foi causada pela remoção do polling em si, mas porque o pipeline **WebSocket → invalidação → refetch** tinha falhas (import ausente, `action` descartada, patch incorreto, cache PCP stale, filtro de setor no painel). As otimizações de performance foram **preservadas** (patch incremental na lista, polling 5 min nos painéis, cache portal cliente). O tempo real volta a depender de **WS + invalidação/refetch correto**, com polling apenas como fallback.
