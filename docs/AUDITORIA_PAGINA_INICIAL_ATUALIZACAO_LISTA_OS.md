# Auditoria — Página Inicial: Atualização Automática e Lista de OSs

**Data:** 2026-06-10  
**Escopo:** somente leitura — nenhuma alteração de código, backend, banco, `.env` ou deploy.  
**Sintoma reportado:** lista da página inicial não atualiza corretamente com filtros; OSs existentes no banco (visíveis no painel do setor) não aparecem na lista.

---

## 1. Resumo executivo

A página inicial (`/`) é implementada por `OsHomePage` e alimenta a **lista principal** via `GET /api/os/search`. O **painel do setor** (`/painel/setor`) é uma rota separada que consome primariamente `GET /api/pcp/queue` e agrega OSs por colunas de situação — exibindo contadores por coluna (quantitativos).

A auditoria identificou **divergências estruturais** entre os dois fluxos que explicam o sintoma “painel encontra, lista não”:

| Fator | Lista (`/os/search`) | Painel setor (`/pcp/queue`) |
|-------|----------------------|-----------------------------|
| Fonte do último andamento | `tab_os_ultimo_andamento_operacional` (se populada) | `tabAndamento` com `UltimoStatus = 1` |
| Filtros do usuário | Situação/setor/prioridade + defaults salvos | Apenas setor do painel + colunas de situação |
| Paginação | `limit=20`, página 1 default | Sem paginação (lista completa do setor) |
| Polling | Não (só WebSocket + fallback WS down) | Sim — a cada 5 min + WebSocket |
| Cache HTTP | `Cache-Control: no-store` | Cache in-memory backend 8 s + `max-age` |

**Causa raiz provável (combinada):**

1. **Backend — filtro `include_finished=false` com tabela materializada:** quando `tab_os_ultimo_andamento_operacional` está populada, OSs **sem linha materializada** ou com `situacao` NULL são **excluídas** da lista ativa. O painel PCP lê `tabAndamento.UltimoStatus=1` diretamente e não sofre essa exclusão.
2. **Filtros default do usuário na home:** `OsHomePage` aplica automaticamente setores/situações salvos (`GET /settings/filtros/ponto/{ponto}`) antes da primeira busca. O painel **não** aplica esses filtros.
3. **Paginação:** a lista retorna no máximo 20 OSs por página; o painel lista todas as OPs do setor. Uma OS pode estar na fila do setor mas fora da primeira página da home.
4. **Atualização automática:** a lista **não** usa `refetchInterval`; depende de WebSocket (`system_update`, `pcp_queue_update`, `force_refresh`). Se eventos forem perdidos ou a materialização atrasar, a lista pode ficar desatualizada enquanto o painel se atualiza por polling.

**Correção provável:** **backend + frontend** (alinhamento de fonte de andamento, filtro NULL, bootstrap de filtros, polling de segurança).

---

## 2. Descrição do problema

### Sintomas observados (reportados)

1. Atualização automática da lista não reflete mudanças recentes nem respeita filtros corretamente após eventos em tempo real.
2. OSs que existem no banco e aparecem no painel do setor (contadores/cards) **não** aparecem na lista principal da página inicial.

### O que o painel prova

O painel do setor exibe cards e contadores por coluna (`dashboard-setor-column-count`, footer “N OPs”). Se uma OS aparece ali, ela passou por `fetchDashboardSectorData` → `GET /api/pcp/queue?setor=...` (ou fallback legado em `/os/search` com parâmetros fixos do painel).

---

## 3. Arquitetura da página inicial

```
Rota: /_authenticated/  (apps/web/src/routes/_authenticated/index.tsx)
  └─ AuthGuard (permissão sb_inicio)
       └─ OsHomePage (features/os/components/OsHomePage.tsx)
            ├─ OsFiltersPanel          — filtros visuais + botão Atualizar
            ├─ OsOrdersTable           — tabela virtualizada + paginação
            ├─ OsDetailsPanel          — detalhes da OS selecionada
            ├─ OsHistoryPanel          — histórico / andamentos
            ├─ useOsSearch             — TanStack Query → GET /api/os/search
            ├─ useOsRealtimeSync       — WebSocket → silentRefreshOsSearch
            ├─ useOsActiveSearchStore  — refetch() da query montada
            ├─ useOsFiltersStore       — Zustand (filtros + toggles persistidos)
            ├─ useOsSelectionStore     — OS selecionada
            ├─ useSavedFilters / useUserFiltersDefault — filtros salvos/default
            └─ SettingsModal           — preferências de filtros (sb_configuracoes)
```

**Layout:** `AppShell` → `Outlet` (sem painel de setor embutido na home).

**Painel do setor:** rota separada `/painel/setor` → `DashboardSetorPage` (abre em nova janela via sidebar).

---

## 4. Mapa dos componentes da lista

| Componente | Arquivo | Responsabilidade |
|------------|---------|------------------|
| `OsHomePage` | `features/os/components/OsHomePage.tsx` | Orquestra filtros, busca, realtime, seleção |
| `OsFiltersPanel` | `features/os/components/OsFiltersPanel.tsx` | UI de filtros, toggles OS/SP/entregues, filtros salvos |
| `OsOrdersTable` | `features/os/components/OsOrdersTable.tsx` | Renderização, sort UI, paginação, expand Sub OS |
| `useOsSearch` | `api/hooks/useOsSearch.ts` | TanStack Query wrapper |
| `searchOs` | `api/os.ts` | Monta query string e chama API |
| `buildOsHomeSearchFilters` | `features/os/osSearchUtils.ts` | Merge filtros com texto debounced |
| `normalizeOsSearchFilters` | `features/os/osSearchUtils.ts` | Normalização para queryKey |
| `osSearchQueryKey` | `features/os/osSearchQueryKey.ts` | `["os","search", JSON.stringify(normalized)]` |
| `useOsFiltersStore` | `features/os/osFiltersStore.ts` | Estado global dos filtros |
| `useOsActiveSearchStore` | `features/os/osActiveSearchStore.ts` | Registra refetch da query ativa |
| `useOsRealtimeSync` | `features/os/hooks/useOsRealtimeSync.ts` | WS + fallback polling quando WS down |
| `silentRefreshOsSearch` | `features/os/osRealtimeSync.ts` | Refetch ou setQueryData |
| `osTableRows` | `features/os/osTableRows.ts` | Linhas display (main + sub OS expandidas) |

**Sem filtro client-side pós-API:** `rows = searchQuery.data?.data ?? []` — a tabela exibe exatamente o retorno do backend (exceto expansão visual de Sub OS).

---

## 5. Mapa dos componentes do painel do setor

| Componente | Arquivo | Responsabilidade |
|------------|---------|------------------|
| Rota | `routes/painel/setor.tsx` | Página standalone |
| `DashboardSetorPage` | `features/dashboard-setor/components/DashboardSetorPage.tsx` | UI colunas + contadores |
| `useDashboardSetorData` | `features/dashboard-setor/hooks/useDashboardSetorData.ts` | Fetch + polling 5 min |
| `fetchDashboardSectorData` | `features/dashboard-setor/api.ts` | PCP queue + fallback |
| `processDashboardData` | `features/dashboard-setor/utils.ts` | Agrupa por coluna de situação |
| `configStorage` | `features/dashboard-setor/configStorage.ts` | Setor/colunas em localStorage |
| WebSocket | `DashboardSetorPage` + hook | `system_update` / `pcp_queue_update` |

**Quantitativos:** contagem por coluna = `col.items.length` no header e footer de cada coluna.

---

## 6. Endpoint usado pela lista

| Item | Valor |
|------|-------|
| **HTTP** | `GET /api/os/search` |
| **Client** | `searchOs()` em `apps/web/src/api/os.ts` → `apiFetch('/os/search?...')` |
| **Router** | `app/backend/routers/os_routes.py` → `search_os()` |
| **Service** | `app/backend/services/os_search_service.py` → `execute_os_search()` |
| **Cache-Control** | `no-store, no-cache, must-revalidate, max-age=0` |

### Parâmetros enviados pelo frontend (`buildOsSearchQueryString`)

| Query param | Origem |
|-------------|--------|
| `nr_os` | `filters.nrOs` |
| `ano` | `filters.ano` |
| `produto`, `titulo`, `solicitante` | campos texto (debounce 250 ms) |
| `situacao`, `setor`, `prioridade` | arrays multi-select (repetidos na query) |
| `include_finished` | toggle “Exibir entregues e canceladas” |
| `include_os` | toggle “Exibir OSs” (nº ≥ 5000 quando false) |
| `include_sp` | toggle “Exibir SPs” (nº < 5000 quando false) |
| `simple_pagination` | sempre `true` |
| `page`, `limit` | paginação (default page=1, limit=20) |
| `sort_by`, `sort_dir` | ordenação opcional da tabela |

---

## 7. Endpoint usado pelo painel do setor

| Item | Valor |
|------|-------|
| **Primário** | `GET /api/pcp/queue?setor={sector}` |
| **Client** | `fetchPcpQueue()` em `apps/web/src/api/pcp.ts` |
| **Router** | `app/backend/routers/pcp_routes.py` → `get_pcp_queue()` |
| **Fallback** | `fetchLegacyDashboardQueue()` → `GET /api/os/search?setor=...&include_finished=false&limit=200&pcp_order=true` |
| **Cache backend** | In-memory TTL default 8 s (`SAGRA_PCP_QUEUE_CACHE_SEC`) |
| **Cache-Control** | `private, max-age={ttl}` quando cache ativo |

### SQL do painel (principal)

- `FROM tabProtocolos p`
- `LEFT JOIN tabDetalhesServico d`
- `LEFT JOIN tabAndamento a` via subquery com **`UltimoStatus = 1`**
- `WHERE a.SetorLink = {base_setor}` + exclusão Entregue/Cancelada
- `UNION` lógico com `fetch_sub_os_queue_rows()` para Sub OS (`row_kind=sub_os`)
- Ordenação PCP (`tab_pcp_fila.ordem`) + prioridade + data

---

## 8. Comparação entre os dois endpoints

| Aspecto | `GET /os/search` (lista) | `GET /pcp/queue` (painel) |
|---------|--------------------------|---------------------------|
| **Último andamento** | `tab_os_ultimo_andamento_operacional` se populada; senão `ROW_NUMBER()` legacy em `tabAndamento` | `tabAndamento` com `UltimoStatus=1` |
| **Regra de ranking** | `UltimoStatus DESC, Data DESC, CodStatus DESC` + exclusão espelhos | Entre registros `UltimoStatus=1`: `Data DESC, CodStatus DESC` |
| **Filtro setor** | Opcional (multi-select); vazio = todos | Obrigatório (setor do painel) |
| **Filtro situação** | Opcional (multi-select) + default usuário | Implícito nas colunas do painel (classificação client-side) |
| **Sub OS** | Inclusão via `OR EXISTS` no filtro; linha única por OS pai | Linhas virtuais `row_kind=sub_os` na fila |
| **Paginação** | Sim — `limit=20` default, `has_next` | Não — retorna fila completa |
| **Exclui finalizadas** | `include_finished=false` → `situacao NOT IN (...)` | Sempre exclui Entregue/Cancelada |
| **NULL situacao** | **Exclui** com materializada (sem `IS NULL OR`) | Exige `a.CodStatus IS NOT NULL` |
| **OS < 5000 / ≥ 5000** | `include_os` / `include_sp` | Sem distinção (todas na fila do setor) |
| **Atualização front** | WebSocket; sem polling com WS up | Polling 300 s + WebSocket |
| **Cache** | Sem cache HTTP | Cache 8 s backend |

### Por que o painel encontra e a lista não (cenários)

1. **Materialização ausente/desatualizada:** PCP lê `tabAndamento`; lista lê materializada. OS com andamento válido em `tabAndamento` mas sem linha em `tab_os_ultimo_andamento_operacional` → painel sim, lista não.
2. **Filtros default do usuário:** lista aplica `situacoes`/`setores` do perfil; painel filtra só pelo setor configurado.
3. **Paginação:** OS na posição 21+ da fila global não aparece na página 1 da home.
4. **Busca por Nr OS com filtros ativos:** backend faz **AND** de todos os filtros — OS específica pode ser excluída por setor/situação default.
5. **Sub OS no painel, pai com outro setor:** painel mostra card Sub OS; lista pode incluir pai via `OR EXISTS` mas só se filtros permitirem.

---

## 9. Query keys e estratégia de cache/refetch

### TanStack Query (`useOsSearch`)

| Opção | Valor |
|-------|-------|
| `queryKey` | `["os", "search", serializeOsSearchFilters(filters)]` |
| `staleTime` | `0` (`OS_SEARCH_STALE_MS`) |
| `gcTime` | `5 min` |
| `refetchInterval` | **não definido** |
| `refetchOnMount` | `"always"` |
| `refetchOnWindowFocus` | `false` |
| `refetchOnReconnect` | `true` |
| `structuralSharing` | `false` |
| `keepPreviousData` | **não usado** |
| `enabled` | `prefsBootstrapped` (aguarda filtros default) |

### Filtros na queryKey

Sim — via `normalizeOsSearchFilters` + `JSON.stringify`. Arrays ordenados; strings trimadas. Testes em `osSearchQueryKey.test.ts`.

### Atualização automática

```
WebSocket (useOsRealtimeSync)
  ├─ system_update → applyOsSystemUpdate → silentRefreshOsSearch
  ├─ pcp_queue_update → scheduleListRefresh (debounce 300 ms)
  └─ force_refresh → scheduleListRefresh + handleRefresh (refetch explícito)

silentRefreshOsSearch
  1. refetchActiveOsSearchList() — refetch() do useOsSearch montado
  2. fallback: searchOs + setQueryData na queryKey dos filtros ativos

WS desconectado: polling exponencial 5 s → 30 s (só se documento visível)
```

### Zustand / localStorage

| Store | Persistência |
|-------|--------------|
| `useOsFiltersStore` | Parcial: `includeFinished`, `includeOs`, `includeSp` em `localStorage` (`sagra-os-filter-toggles`) |
| Situação/setor/prioridade/textos | **Memória apenas** (perdidos no refresh, re-bootstrap via API) |
| `homeDefaultPrefsApplied` | Variável de módulo (sobrevive navegação SPA, não refresh) |

### Service Worker (PWA)

`vite.config.ts`: rotas `/api/` usam handler **`NetworkOnly`** — API não é cacheada pelo SW.

### Cross-tab lock

`osSearchRefreshLock.ts`: evita múltiplas abas disparando search simultâneo (TTL 2,5 s). Realtime usa `skipCrossTabLock: true`.

---

## 10. Filtros visíveis

Na `OsFiltersPanel`:

| Filtro | Tipo |
|--------|------|
| Exibir entregues e canceladas | checkbox → `includeFinished` |
| Exibir OSs | checkbox → `includeOs` |
| Exibir SPs | checkbox → `includeSp` |
| Meus Filtros... | select → filtros salvos |
| Nr OS | texto numérico |
| Ano | texto numérico |
| Produto | texto |
| Título | texto |
| Solicitante | texto |
| Situação | multi-select (`useSituacoesLookup`) |
| Setor | multi-select (`useSetoresLookup`) |
| Prioridade | multi-select (Normal, Solicitado p/, Prometido p/) |
| Limpar / Atualizar | ações |

**Status visual:** `filterStatus` em `OsHomePage` — mostra filtro salvo ou “Filtro Personalizado” + hints implícitos (`filterStatus.ts`).

---

## 11. Filtros implícitos/default

| Filtro | Valor default | Onde |
|--------|---------------|------|
| `includeFinished` | `false` | `defaultOsFilters()` |
| `includeOs` / `includeSp` | `true` | idem |
| `page` | `1` | idem |
| `limit` | `20` | `DEFAULT_PAGE_SIZE` |
| `ano` | `undefined` (todos) | idem |
| Exclusão entregues/canceladas | backend quando `include_finished=false` | `execute_os_search` |
| Filtros default do usuário | `situacoes` + `setores` de `GET /settings/filtros/ponto/{ponto}` | `OsHomePage` bootstrap |
| `simple_pagination` | `true` | sempre enviado |
| Busca textual mínima | 3 caracteres (sem nr_os/ano) | `OS_SEARCH_MIN_LIKE_CHARS` backend |

**Não há:** filtro URL/search params, filtro “minhas OSs”, filtro por ponto/responsável na home.

---

## 12. Filtros enviados para a API

Fluxo:

```
useOsFiltersStore.filters
  → buildOsHomeSearchFilters(filters, debouncedText)  // 250 ms debounce em textos
  → normalizeOsSearchFilters (na query)
  → buildOsSearchQueryString
  → GET /api/os/search?...
```

**Debounce:**

- Textos (nrOs, ano, produto, titulo, solicitante): **250 ms**
- Situação/setor/prioridade: **imediato** (`isChoiceFilterPending = false` — debounce de 200 ms documentado em relatório anterior **não está ativo** no código atual)

**Bootstrap:** enquanto `prefsBootstrapped=false`, `useOsSearch` está `enabled=false` e `clearActiveSearch()` impede refetch realtime.

---

## 13. Filtros aplicados no backend

`execute_os_search()` em `os_search_service.py`:

| Condição | SQL / lógica |
|----------|--------------|
| `include_finished=false` | `situacao NOT IN ('Entregue','Cancelada','Cancelado')` — **sem** `IS NULL OR` se materializada |
| `include_os=false` | `p.NroProtocolo >= 5000` |
| `include_sp=false` | `p.NroProtocolo < 5000` |
| `nr_os`, `ano` | igualdade em `tabProtocolos` |
| `produto`, `titulo` | `EXISTS` em `tabDetalhesServico` com `LIKE` (mín. 3 chars) |
| `solicitante` | `p.NomeUsuario LIKE` |
| `situacao` / `setor` | `build_main_or_sub_os_filter_sql` — main **OR** Sub OS |
| `prioridade` | `p.EntregPrazoLink IN (...)` |
| Ordenação default | prioridade + `COALESCE(EntregData, DataEntrada)` + desempate ano/nr |

**Tabelas:** `tabProtocolos`, `tab_os_ultimo_andamento_operacional` (ou subquery `tabAndamento`), `tabDetalhesServico` (condicional), `tab_os_sub_os`, agregado Sub OS.

---

## 14. Pontos onde a OS pode ser excluída da lista

1. **Sem linha em `tab_os_ultimo_andamento_operacional`** com materializada ativa + `include_finished=false`.
2. **Situação Entregue/Cancelada/Cancelado** (implícito ou explícito).
3. **Filtro setor/situação** do usuário (incl. default bootstrap) não coincide — nem no main nem em Sub OS (`OR EXISTS`).
4. **Paginação:** OS fora do `LIMIT/OFFSET` da página atual.
5. **`include_os=false`** e `NroProtocolo < 5000` (ou inverso para SP).
6. **Busca textual** com menos de 3 caracteres (ignorada silenciosamente).
7. **`produto`/`titulo`/`solicitante`** com termo que não casa (EXISTS/LIKE).
8. **Materialização desatualizada** — situacao/setor na materializada diferente de `tabAndamento.UltimoStatus=1`.
9. **Busca por Nr OS** ainda sujeita a filtros setor/situação (AND, não override).
10. **Dedupe** — duplicata removida (improvável ocultar OS única).

---

## 15. Hipóteses analisadas

| Hipótese | Status | Evidência |
|----------|--------|-----------|
| Filtros não entram na queryKey | **Descartada** | `osSearchQueryKey` serializa filtros normalizados |
| Refetch usa filtros antigos | **Parcial** | `filtersRef` em realtime; risco baixo em race de bootstrap |
| Endpoint lista ≠ painel | **Confirmada** | Materializada vs `tabAndamento.UltimoStatus=1` |
| Lista filtra no frontend pós-API | **Descartada** | Sem `.filter` nos rows da busca |
| Cache mantém resultado antigo | **Improvável** | `staleTime=0`, `no-store`, SW NetworkOnly |
| Paginação limita resultado | **Confirmada** | `limit=20`, painel sem limite |
| Busca OS não ignora filtros | **Confirmada** | Backend AND de todos os parâmetros |
| OS < 5000 vs ≥ 5000 | **Confirmada** | Toggles `include_os`/`include_sp` só na lista |
| Join último andamento falha | **Confirmada** | NULL excluído com materializada |
| OS sem detalhe excluída | **Descartada** | Detalhes via enrich pós-query; filtro EXISTS só com termo |
| Normalização situação/setor | **Possível** | Labels devem coincidir exatamente com banco |
| Service worker cacheando API | **Descartada** | NetworkOnly |
| Painel SQL mais amplo | **Confirmada** | Fila completa do setor, sem filtros do usuário |
| Lista exclui finalizadas | **Confirmada** | `include_finished=false` default |
| Filtro ano default incorreto | **Descartada** | `ano=undefined` = todos |
| Filtro responsável/ponto | **N/A** | Não existe na home |
| Sem polling na lista | **Confirmada** | Só WS; painel poll 5 min |
| Filtros default usuário ocultos | **Confirmada** | Bootstrap automático |
| Materialização stale pós-andamento | **Possível** | Depende de `refresh_os_ultimo_andamento_operacional` |
| PCP cache 8 s | **Menor** | Só painel; pode mostrar dado mais novo que lista stale |

---

## 16. Causa raiz provável ou confirmada

### Confirmada no código

**C1 — Exclusão de `situacao IS NULL` com tabela materializada**

```python
# os_search_service.py ~321-327
if not include_finished:
    if use_materialized:
        filters += f" AND {situacao_col} NOT IN ('Entregue', 'Cancelada', 'Cancelado')"
    else:
        filters += f" AND ({situacao_col} IS NULL OR {situacao_col} NOT IN (...))"
```

Teste explícito: `test_materialized_excludes_null_situacao_from_active_list` confirma ausência de `IS NULL OR`.

**C2 — Fontes de andamento divergentes**

- Lista: `tab_os_ultimo_andamento_operacional`
- Painel: `tabAndamento` + `UltimoStatus=1`

**C3 — Filtros default do usuário só na lista**

`OsHomePage` aplica `defaultFiltersQuery.data` antes de `prefsBootstrapped=true`.

### Provável (comportamental)

**P1 — Paginação** esconde OSs além da página 1.  
**P2 — Ausência de `refetchInterval`** na lista com WS conectado mas eventos perdidos.  
**P3 — Nr OS + filtros ativos** impede localizar OS mesmo existindo no banco.

---

## 17. Evidências encontradas no código

| Arquivo | Linha aprox. | Evidência |
|---------|--------------|-----------|
| `routes/_authenticated/index.tsx` | 6-14 | Rota home → `OsHomePage` |
| `OsHomePage.tsx` | 85-102 | `buildOsHomeSearchFilters` + `useOsSearch(..., prefsBootstrapped)` |
| `OsHomePage.tsx` | 164-204 | Bootstrap filtros default do usuário |
| `OsHomePage.tsx` | 100 | `isChoiceFilterPending = false` |
| `useOsSearch.ts` | 11-26 | `staleTime: 0`, sem `refetchInterval` |
| `api/os.ts` | 31-76 | Parâmetros enviados à API |
| `os_search_service.py` | 312-332 | Join materializada + filtro NULL |
| `os_search_service.py` | 334-337 | Regra OS ≥ 5000 |
| `pcp_routes.py` | 111-157 | Query painel com `UltimoStatus=1` |
| `dashboard-setor/api.ts` | 39-51 | PCP primário + fallback `/os/search` |
| `useOsRealtimeSync.ts` | 166-193 | Fallback polling só sem WS |
| `constants.ts` (dashboard) | 39 | `DASHBOARD_POLL_INTERVAL_MS = 300_000` |
| `osFiltersStore.ts` | 68-91 | Persistência parcial localStorage |
| `test_os_ultimo_andamento_search.py` | 129-140 | Teste exclusão NULL |
| `scripts/diag_os_search_solicitante.py` | 33-43 | Query diagnóstico gap materializada |

---

## 18. Procedimento para testar uma OS específica

Substitua `{NR}`, `{ANO}`, `{SETOR}`, `{TOKEN}` e `{PONTO}`.

### 18.1 Banco de dados (somente leitura)

```sql
-- Protocolo
SELECT NroProtocolo, AnoProtocolo, NomeUsuario, EntregPrazoLink, EntregData, DataEntrada
FROM tabProtocolos
WHERE NroProtocolo = {NR} AND AnoProtocolo = {ANO};

-- Último andamento operacional (flag UltimoStatus)
SELECT CodStatus, SituacaoLink, SetorLink, Data, UltimoStatus
FROM tabAndamento
WHERE NroProtocoloLink = {NR} AND AnoProtocoloLink = {ANO}
ORDER BY UltimoStatus DESC, Data DESC, CodStatus DESC
LIMIT 5;

-- Linha materializada
SELECT *
FROM tab_os_ultimo_andamento_operacional
WHERE nro_protocolo = {NR} AND ano_protocolo = {ANO};

-- Detalhes
SELECT Titulo, TipoPublicacaoLink
FROM tabDetalhesServico
WHERE NroProtocoloLinkDet = {NR} AND AnoProtocoloLinkDet = {ANO};

-- Sub OS (se aplicável)
SELECT s.id, s.display_name, sa.situacao, sa.setor, sa.ultimo_status
FROM tab_os_sub_os s
JOIN tab_os_sub_os_andamento sa ON sa.sub_os_id = s.id
WHERE s.nro_protocolo = {NR} AND s.ano_protocolo = {ANO}
ORDER BY sa.ultimo_status DESC, sa.data DESC;
```

**Gap materializada:**

```sql
SELECT COUNT(*) AS sem_materializada
FROM tabProtocolos p
LEFT JOIN tab_os_ultimo_andamento_operacional a
  ON a.nro_protocolo = p.NroProtocolo AND a.ano_protocolo = p.AnoProtocolo
WHERE p.NroProtocolo = {NR} AND p.AnoProtocolo = {ANO}
  AND a.nro_protocolo IS NULL;
```

### 18.2 Endpoint da lista (reproduzir exatamente o browser)

1. DevTools → Network → filtrar `search`.
2. Copiar query string da requisição `GET .../api/os/search?...`.
3. Ou montar manualmente:

```http
GET /api/os/search?nr_os={NR}&ano={ANO}&include_finished=false&include_os=true&include_sp=true&simple_pagination=true&page=1&limit=20
Authorization: Bearer {TOKEN}
```

Repetir **com** os mesmos `situacao`/`setor` que a UI envia (ver Network ou filtros default).

### 18.3 Endpoint do painel

```http
GET /api/pcp/queue?setor={SETOR}
```

Verificar se item aparece em `items[]` com `nr_os`, `ano`, `situacao`, `setor`, `row_kind`.

### 18.4 Comparar

| Campo | Lista | Painel | Banco |
|-------|-------|--------|-------|
| Último setor | resposta `setor` | `items[].setor` | `tabAndamento` / materializada |
| Situação | resposta `situacao` | `items[].situacao` | idem |
| Presente? | `data[]` contém par? | `items[]` contém par? | protocolo existe? |
| Filtros | query string completa | só `setor` | — |

### 18.5 Script de diagnóstico existente

```bash
cd C:\dev\SagraWeb
python scripts/diag_os_search_solicitante.py
```

Mede gap materializada e benchmark de `execute_os_search`.

### 18.6 Debug sem quebrar produção

- Backend: logs em `os_search_service`, `pcp_routes` (nível INFO já existe).
- Front: `console.info("[OS LIST] os-active-search-refetch-v20250610")` em `OsHomePage` confirma build.
- Verificar header `X-Sagra-Cache: hit|miss` em `/pcp/queue`.
- WebSocket: status em `useSagraWebSocket` (connected/disconnected).
- **Não** desativar cache/materialização em produção nesta etapa.

---

## 19. Plano de correção recomendado por prioridade

> **Não implementar nesta etapa** — apenas plano.

### P0 — Lista volta a buscar dados atualizados e filtros corretos

| # | Ação | Arquivo(s) | Correção proposta |
|---|------|------------|-------------------|
| P0.1 | Alinhar filtro ativo com legacy quando materializada | `os_search_service.py` ~322 | Restaurar `AND (a.situacao IS NULL OR a.situacao NOT IN (...))` ou tratar NULL como “ativa sem status” conforme regra de negócio |
| P0.2 | Garantir materialização síncrona em todo andamento | `os_routes.py`, `andamento_operacional.py` | Auditar chamadas a `refresh_os_ultimo_andamento_operacional` |
| P0.3 | Refetch com filtros atuais após mudança de filtro | `OsHomePage.tsx` | Invalidar query anterior ou forçar `refetch` quando `searchFilters` mudar |
| P0.4 | Polling de segurança na lista | `useOsSearch.ts` ou `useOsRealtimeSync.ts` | `refetchInterval` condicional (ex.: 60–120 s) quando aba visível |
| P0.5 | Busca por Nr OS ignora filtros setor/situação | `os_search_service.py` ou `OsHomePage.tsx` | Quando `nr_os`+`ano` informados, não aplicar filtros de setor/situação (comportamento esperado pelo usuário) |

### P1 — Alinhamento painel ↔ lista

| # | Ação | Arquivo(s) |
|---|------|------------|
| P1.1 | Unificar fonte de último andamento | `pcp_routes.py` e/ou `os_search_service.py` |
| P1.2 | Documentar/indicar filtros default ativos na UI | `OsHomePage.tsx`, `filterStatus.ts` |
| P1.3 | Fallback painel legacy alinhado com Sub OS | `dashboard-setor/api.ts` |
| P1.4 | Rebuild materializada agendado se gap detectado | `scripts/rebuild_os_ultimo_andamento.py` |

### P2 — Testes automatizados e logs de diagnóstico

| # | Ação |
|---|------|
| P2.1 | Teste integração: OS em `tabAndamento` UltimoStatus=1 sem materializada → deve aparecer na lista |
| P2.2 | Teste: filtros default aplicados vs query enviada |
| P2.3 | Teste E2E: WS `system_update` → lista reflete novo setor |
| P2.4 | Endpoint debug read-only `/os/search/diag/{ano}/{nr}` (opcional) |

### P3 — UX filtros e busca

| # | Ação |
|---|------|
| P3.1 | Indicador “filtros default do perfil ativos” mais visível |
| P3.2 | Busca Nr OS limpa filtros conflitantes ou mostra aviso |
| P3.3 | Restaurar debounce setor/situação se necessário (200 ms) |
| P3.4 | Exibir total aproximado ou “há mais resultados” na paginação simples |

### Bugs evidentes documentados (não corrigidos)

#### Bug B1 — NULL situacao excluída com materializada

- **Arquivo:** `app/backend/services/os_search_service.py`
- **Função:** `execute_os_search`
- **Linha:** ~321-327
- **Por quê:** `NULL NOT IN (...)` é UNKNOWN em SQL; LEFT JOIN sem linha materializada exclui OS.
- **Correção:** Adicionar `OR {situacao_col} IS NULL` no ramo materializado (como no legacy), ou INNER JOIN garantindo linha materializada sempre atualizada.

#### Bug B2 — Divergência PCP vs materializada

- **Arquivo:** `app/backend/routers/pcp_routes.py` vs `os_search_service.py`
- **Por quê:** PCP usa `UltimoStatus=1`; materializada usa ranking sem exigir flag.
- **Correção:** PCP consumir mesma função `fetch_operacional_row` / materializada.

#### Bug B3 — Lista sem polling com WS “conectado”

- **Arquivo:** `apps/web/src/api/hooks/useOsSearch.ts`
- **Por quê:** Eventos WS perdidos não são recuperados até reconexão ou refresh manual.
- **Correção:** `refetchInterval` leve ou refetch ao receber foco.

#### Bug B4 — Bootstrap bloqueia query e realtime

- **Arquivo:** `apps/web/src/features/os/components/OsHomePage.tsx`
- **Linha:** ~102, 106-119
- **Por quê:** `enabled=false` e `clearActiveSearch` durante carga de filtros default.
- **Correção:** Aplicar defaults antes de montar query ou usar `placeholderData` da busca anterior.

---

## 20. Riscos de regressão

| Correção | Risco |
|----------|-------|
| `IS NULL OR` na lista | Pode reexibir OSs sem andamento operacional válido |
| Unificar PCP + search | Mudança de ordem/cards no painel |
| Ignorar filtros em busca Nr OS | Usuário pode não perceber que filtros foram bypassados |
| Polling adicional | Mais carga no servidor (~1 req/min/usuário) |
| Rebuild materializada | Janela de inconsistência durante backfill |

---

## 21. Checklist de testes manuais

- [ ] Abrir home sem filtros visíveis — verificar Network se `situacao`/`setor` vazios ou com default do perfil.
- [ ] OS visível no painel setor X — buscar mesmo Nr/Ano na home com filtros limpos.
- [ ] Repetir com filtros default do usuário ativos — confirmar exclusão.
- [ ] Alterar andamento de OS — lista atualiza em < 5 s via WS?
- [ ] Desconectar WS (offline) — lista atualiza em até 30 s?
- [ ] Botão Atualizar — refetch com mesmos filtros da Network.
- [ ] Paginar (página 2) — OS do painel que não estava na página 1 aparece?
- [ ] Toggle “Exibir entregues” — OS finalizada aparece?
- [ ] OS ≥ 5000 com “Exibir OSs” desmarcado — some da lista mas pode estar no painel?
- [ ] Sub OS em setor diferente do pai — painel mostra card Sub OS; lista expande com `matched_via_sub_os`?
- [ ] Duas abas abertas — refresh não trava por cross-tab lock na aba ativa.

---

## 22. Checklist de testes automatizados sugeridos

- [ ] `execute_os_search` com materializada mockada: OS com `tabAndamento` válido e sem linha materializada deve/não deve aparecer (definir regra).
- [ ] `buildOsSearchQueryString` inclui todos os filtros do store após bootstrap.
- [ ] `useOsSearch` dispara nova query quando `situacao` muda (queryKey diff).
- [ ] `silentRefreshOsSearch` chama `refetch` registrado com filtros atualizados.
- [ ] Comparar contagem `pcp/queue` vs `os/search` para mesmo setor (teste integração com DB fixture).
- [ ] `test_materialized_excludes_null_situacao` — revisar se comportamento desejado mudou após P0.

---

## Referências internas

- [`RELATORIO_PERFORMANCE_LISTA_OS.md`](RELATORIO_PERFORMANCE_LISTA_OS.md)
- [`RELATORIO_OTIMIZACAO_LISTA_OS_IMPLEMENTACAO.md`](RELATORIO_OTIMIZACAO_LISTA_OS_IMPLEMENTACAO.md)
- [`RELATORIO_CORRECAO_ORDENACAO_LISTA_OS.md`](RELATORIO_CORRECAO_ORDENACAO_LISTA_OS.md)
- [`RELATORIO_SUB_OS_LISTAS_PAINEIS.md`](RELATORIO_SUB_OS_LISTAS_PAINEIS.md)
- [`scripts/diag_os_search_solicitante.py`](../scripts/diag_os_search_solicitante.py)

---

## Apêndice — Respostas rápidas

| Pergunta | Resposta |
|----------|----------|
| **Endpoint da lista** | `GET /api/os/search` |
| **Endpoint do painel** | `GET /api/pcp/queue?setor={setor}` |
| **Principal hipótese** | Divergência materializada vs `tabAndamento` + filtros default usuário + paginação |
| **Frontend ou backend?** | **Ambos** (backend: fonte SQL; frontend: bootstrap filtros, sem polling) |
| **Arquivos prováveis na próxima etapa** | `os_search_service.py`, `pcp_routes.py`, `OsHomePage.tsx`, `useOsSearch.ts`, `useOsRealtimeSync.ts`, `os_ultimo_andamento_service.py` |
