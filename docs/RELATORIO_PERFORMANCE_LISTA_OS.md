# Relatório de Performance — Lista Inicial de OSs

**Data:** 2026-06-09  
**Escopo:** auditoria somente leitura — nenhuma alteração de código, migration ou comportamento.  
**Ambiente medido:** MySQL `sagrafulldb` em `10.1.1.73` (via backend local `C:\dev\SagraWeb\app\backend`).

---

## 1. Resumo executivo

A lentidão da lista inicial **não é causada principalmente pelo React nem pela paginação client-side**. O gargalo dominante está no **backend SQL**: cada chamada a `GET /api/os/search` executa **duas queries pesadas** (dados + `COUNT DISTINCT`), ambas materializando o **último andamento operacional de todas as ~198 mil linhas de `tabAndamento`** via `ROW_NUMBER()` e, adicionalmente, materializando **todas as ~86 mil linhas de `tabDetalhesServico`**, mesmo quando o usuário não filtra por produto/título.

Medições em produção (2026-06-09):

| Operação | Tempo médio |
|----------|-------------|
| Query de dados (abertura inicial, 20 linhas) | **~4,6 s** |
| Query de contagem total | **~3,0 s** |
| **Total por requisição HTTP** | **~7,5 s** |

Com ~84 mil OSs na base, mas apenas **~217 OSs ativas** (não entregues/canceladas, operacional, nº &lt; 5000), a query atual **varre e ordena dezenas de milhares de registros históricos** para devolver 20 linhas.

**Causa provável (ordenada por impacto):**

1. **Subquery derivada de último andamento** — full scan + sort + materialize em `tabAndamento` a cada busca.
2. **JOIN de detalhes sempre ativo** — materializa `tabDetalhesServico` inteira mesmo sem filtro textual.
3. **`COUNT(DISTINCT …)` duplicando o custo** — mesma árvore de JOINs executada duas vezes por request.
4. **Ordenação default sobre ~83 mil protocolos** antes do `LIMIT 21`.
5. **`EXISTS has_sub_os` por linha** — impacto menor (~20 linhas/página), mas evitável.
6. **Front-end secundário** — debounce ok; WebSocket pode amplificar refetch; renderização já usa virtualização.

**Plano recomendado:** Fase 1 (índices + evitar JOIN desnecessário + adiar COUNT); Fase 2 (tabela/view materializada de último status operacional); Fase 3 (cache, fulltext, arquivamento por ano).

---

## 2. Como a lista funciona hoje

### 2.1 Endpoint e fluxo de abertura

```
OsHomePage
  → useOsFiltersStore (filtros + page/limit)
  → useDebouncedValue (250 ms) em nrOs, ano, produto, titulo, solicitante
  → useOsSearch(searchFilters, prefsBootstrapped)
  → searchOs() → GET /api/os/search?...
```

- **Endpoint:** `GET /api/os/search` (prefixo `/api` no client: `apiFetch('/os/search?…')`).
- **Query key TanStack Query:** `["os", "search", normalizedFilters]` via `osSearchQueryKey()` → `queryKeys.os.search(normalizeOsSearchFilters(filters))`.

### 2.2 Filtros default na abertura

Definidos em `defaultOsFilters()` (`osFiltersStore.ts`):

| Parâmetro | Default |
|-----------|---------|
| `nrOs`, `ano` | `undefined` (todos os anos) |
| Textos (`produto`, `titulo`, `solicitante`) | vazio |
| `situacao`, `setor`, `prioridade` | `[]` |
| `includeFinished` | `false` (exclui Entregue/Cancelada/Cancelado) |
| `includeOs` | `true` |
| `includeSp` | `true` |
| `page` | `1` |
| `limit` | **20** (`DEFAULT_PAGE_SIZE`) |
| `sortBy`, `sortDir` | `undefined` → ordenação default do backend |

**Filtros implícitos enviados ao backend** (`buildOsSearchQueryString`):

- `include_finished=false`
- `include_os=true`, `include_sp=true`
- `simple_pagination=true`
- `page`, `limit`, `sort_by`, `sort_dir` quando definidos

**Bootstrap de preferências do usuário:** antes da primeira busca, `OsHomePage` aguarda `useUserFiltersDefault(ponto)`. Se o usuário tiver setores/situações padrão salvos, aplica via `patchFilters` e só então seta `prefsBootstrapped=true`, habilitando `useOsSearch`. Isso **evita uma busca “sem filtros do usuário”**, mas **não evita** o custo SQL intrínseco.

**Persistência local:** apenas toggles `includeFinished`, `includeOs`, `includeSp` (localStorage `sagra-os-filter-toggles`).

### 2.3 Paginação e ordenação

- **Server-side:** `page` + `limit` (máx. 100 no backend).
- Backend usa **`LIMIT limit+1`** para inferir `has_next`, mas **ainda executa `COUNT(DISTINCT)`** para `total_records` / `total_pages`.
- **Ordenação default (sem `sort_by`):**
  1. Prioridade (`EntregPrazoLink`: Prometido → Solicitado → demais)
  2. `EntregData ASC`
  3. `AnoProtocolo DESC`, `NroProtocolo DESC`

### 2.4 Debounce, cache e refetch

| Aspecto | Comportamento |
|---------|---------------|
| Debounce texto | **250 ms** (`useDebouncedValue`) em nrOs, ano, produto, titulo, solicitante |
| Debounce setor/situação/prioridade/página | **Nenhum** — refetch imediato |
| `staleTime` | **30 s** (`OS_SEARCH_STALE_MS`) |
| `gcTime` | **5 min** |
| `placeholderData` | `keepPreviousData` (UI não pisca entre páginas) |
| `refetchOnWindowFocus` | **false** |
| `refetchOnReconnect` | **true** |
| Cache HTTP | Backend envia `Cache-Control: no-store` — **sem cache de proxy/browser** |

### 2.5 WebSocket e refresh

`useOsRealtimeSync`:

- Mensagens `system_update` → patch incremental via histórico **ou** `silentRefreshOsSearch` (debounce **300 ms**).
- `pcp_queue_update`, `force_refresh` → refresh da lista (300 ms).
- Reconexão WS → refresh imediato (`triggerSafeRefresh(0)`).
- WS desconectado → polling com backoff **5 s → 30 s** enquanto aba visível.
- Lock cross-tab (`localStorage`, TTL 2,5 s) evita refresh simultâneo em múltiplas abas.

**Seleção de linha:** não dispara nova busca; painéis de detalhe/histórico carregam endpoints separados.

### 2.6 Renderização (`OsOrdersTable`)

- TanStack Table + **virtualização** (`@tanstack/react-virtual`, overscan 8).
- Paginação manual (sorting server-side).
- Sub OS: `has_sub_os` da API; expansão chama `GET /os/{ano}/{id}/sub-os` (lazy).
- Auto-expand quando `matched_via_sub_os=true` (filtro bateu na Sub OS).
- Após refetch WS, re-busca Sub OS expandidas com delay **900 ms**.

**Conclusão front-end:** renderização está razoavelmente otimizada; o tempo percebido na abertura/filtro é dominado pela **latência da API (~7,5 s)**.

---

## 3. Query atual de `/api/os/search`

Implementação: `app/backend/routers/os_routes.py` → `search_os()`.

### 3.1 Query principal (dados)

```sql
SELECT 
    p.NroProtocolo AS nr_os, 
    p.AnoProtocolo AS ano, 
    d.Titulo AS titulo, 
    p.NomeUsuario AS solicitante,
    a.SituacaoLink AS situacao, 
    p.EntregPrazoLink AS prioridade,
    d.TipoPublicacaoLink AS produto,
    d.FormatoLink AS formato,
    a.SetorLink AS setor,
    p.EntregData AS data_entrega,
    p.EntregPeriodo AS entreg_periodo,
    a.Data AS last_update,
    a.`Observaçao` AS observacao,
    EXISTS (
        SELECT 1
        FROM tab_os_sub_os s
        WHERE s.nro_protocolo = p.NroProtocolo
          AND s.ano_protocolo = p.AnoProtocolo
          AND s.ativo = 1
    ) AS has_sub_os
FROM tabProtocolos AS p
-- JOIN detalhes (sempre presente)
LEFT JOIN (
    SELECT NroProtocoloLinkDet, AnoProtocoloLinkDet, Titulo, TipoPublicacaoLink, FormatoLink
    FROM (
        SELECT d2.*, ROW_NUMBER() OVER (
            PARTITION BY d2.NroProtocoloLinkDet, d2.AnoProtocoloLinkDet
            ORDER BY d2.NroProtocoloLinkDet, d2.AnoProtocoloLinkDet
        ) AS _rn
        FROM tabDetalhesServico AS d2
    ) AS d_ranked
    WHERE d_ranked._rn = 1
) AS d ON p.NroProtocolo = d.NroProtocoloLinkDet AND p.AnoProtocolo = d.AnoProtocoloLinkDet
-- JOIN último andamento operacional (sempre presente)
LEFT JOIN (
    SELECT NroProtocoloLink, AnoProtocoloLink, CodStatus, SituacaoLink, SetorLink, `Data`, `Observaçao`
    FROM (
        SELECT a2.*, ROW_NUMBER() OVER (
            PARTITION BY a2.NroProtocoloLink, a2.AnoProtocoloLink
            ORDER BY a2.UltimoStatus DESC, a2.`Data` DESC, a2.CodStatus DESC
        ) AS _rn
        FROM tabAndamento AS a2
        WHERE NOT EXISTS (
            SELECT 1 FROM tab_os_sub_os_andamento m
            WHERE m.cod_status_espelho IS NOT NULL AND m.cod_status_espelho != ''
              AND m.cod_status_espelho COLLATE utf8mb4_general_ci = a2.CodStatus COLLATE utf8mb4_general_ci
        )
    ) AS ranked
    WHERE ranked._rn = 1
) AS a ON a.NroProtocoloLink = p.NroProtocolo AND a.AnoProtocoloLink = p.AnoProtocolo
WHERE 1=1
  -- + filtros dinâmicos (ver §3.3)
ORDER BY /* default ou sort_by */
LIMIT %(limit)s OFFSET %(offset)s
```

### 3.2 Query de contagem

```sql
SELECT COUNT(DISTINCT p.NroProtocolo, p.AnoProtocolo) AS total
FROM tabProtocolos AS p
[LEFT JOIN detalhes — só se filtro produto/título]
[JOIN andamento operacional — sempre]
WHERE /* mesmos filtros */
```

Executada **sempre** via `_fetch_os_search_total_records()`, mesmo com `simple_pagination=true`.

### 3.3 JOINs explicados

| JOIN | Propósito | Observação |
|------|-----------|------------|
| `tabProtocolos p` | Base da listagem | ~84 mil linhas |
| `d` (derived) | Um detalhe por OS | Deduplica ~1.734 registros duplicados em `tabDetalhesServico`; **materializa 86 mil linhas sempre** |
| `a` (derived) | Último andamento **operacional** | Ignora espelhos Sub OS (`MIRROR_EXCLUDE_CLAUSE`); **não usa `UltimoStatus=1` diretamente**; materializa ~191 mil linhas |
| `EXISTS tab_os_sub_os` | `has_sub_os` | Por linha retornada (barato com índice) |

### 3.4 Último andamento

- Lógica em `_os_search_andamento_join_sql()` + `services/andamento_operacional.py`.
- Ranking: `UltimoStatus DESC`, `Data DESC`, `CodStatus DESC`, excluindo `CodStatus` que aparecem como `cod_status_espelho` em `tab_os_sub_os_andamento`.
- **Diferença prática:** 217 OSs ativas (join operacional) vs 248 ( `UltimoStatus=1` ) — pequena, mas confirma que o join operacional é mais caro que um índice simples em `UltimoStatus`.

### 3.5 Filtros aplicados

| Filtro | SQL |
|--------|-----|
| Não entregues (default) | `a.SituacaoLink IS NULL OR NOT IN ('Entregue','Cancelada','Cancelado')` |
| OS / SP | `p.NroProtocolo < 5000` ou `>= 5000` |
| `nr_os`, `ano` | Igualdade indexável |
| `produto`, `titulo`, `solicitante` | `LIKE '%termo%'` (mín. 3 chars se sem nr/ano) |
| `prioridade` | `p.EntregPrazoLink IN (...)` |
| `setor` / `situacao` | `build_main_or_sub_os_filter_sql()` — ver §9 |

### 3.6 Paginação e total

- `offset = (page - 1) * limit`
- `limit_clause = limit + 1` quando `simple_pagination=true`
- `total_records` = COUNT DISTINCT (query separada)
- `total_pages = ceil(total / limit)`
- Pós-processamento: `_dedupe_os_search_rows`, `annotate_search_sub_os_matches`

### 3.7 `has_sub_os` e `sub_os_count`

- **`has_sub_os`:** `EXISTS` em `tab_os_sub_os` com `ativo=1` — **presente na query atual**.
- **`sub_os_count`:** **não é calculado** na query atual; existe apenas no tipo TypeScript (`types.ts`) e documentação antiga. Front-end usa fallback `(sub_os_count ?? 0) > 0` mas o backend **não envia** esse campo hoje.

### 3.8 N+1 e subqueries

| Padrão | Presente? |
|--------|-----------|
| N+1 no backend da lista | **Não** (uma query de dados) |
| Subquery correlacionada por linha de protocolo | **Substituída** por derived table — porém derived table **recalcula tudo** a cada request |
| `COUNT` pesado duplicado | **Sim** — ~3 s adicionais |
| N+1 no front (Sub OS expandidas) | **Sim** — `fetchSubOsList` por OS expandida / `matched_via_sub_os` |

---

## 4. Volume de dados

Consultas executadas em 2026-06-09 (`SELECT` only):

| Métrica | Valor |
|---------|-------|
| Registros `tabProtocolos` | **84.040** |
| Registros `tabDetalhesServico` | **85.617** (83.883 OS distintas → **~1.734 duplicatas**) |
| Registros `tabAndamento` | **198.664** |
| Média andamentos/OS | **2,36** (mín. 1, máx. **94**) |
| OSs com &gt; 10 andamentos | **7.322** |
| Sub OS ativas (`tab_os_sub_os`) | **1** |
| Componentes ativos | **11** |
| OSs entregues/canceladas (`UltimoStatus=1`) | **83.719** |
| OSs ativas (`UltimoStatus=1`, não finalizadas, n&lt;5000) | **248** |
| OSs ativas (join **operacional**, default listagem) | **217** |

### OSs por ano (top 15)

| Ano | Quantidade |
|-----|------------|
| 2026 | 1.989 |
| 2025 | 4.244 |
| 2024 | 3.435 |
| 2023 | 5.637 |
| 2022 | 2.678 |
| 2021 | 2.443 |
| 2020 | 1.499 |
| 2019 | 6.891 |
| 2018 | 3.852 |
| 2017 | 5.284 |
| 2016 | 4.912 |
| 2015 | 7.639 |
| 2014 | 4.189 |
| 2013 | 6.892 |
| 2012 | 5.091 |

**Tamanho do resultado filtrado mais comum (abertura):** após filtros default + operacional, **217 OSs** — mas a query processa **~83 mil protocolos** e **~198 mil andamentos** antes de paginar.

---

## 5. EXPLAIN e gargalos SQL

Planos obtidos via `EXPLAIN` (MySQL 8, optimizer trace resumido).

### 5.1 Abertura inicial (não entregues, OS &lt; 5000)

**Query de dados (~4,6 s):**

- `Table scan on p` (~83.634 linhas) + **Sort** (prioridade + data + ano/nr).
- `Materialize` derived table `d_ranked`: **table scan `d2`** (86.421 linhas) + window + sort.
- `Materialize` derived table `ranked` (andamento): **table scan `a2`** (**191.338 linhas**) + window + sort.
- Antijoin espelhos Sub OS: index scan em `idx_sub_os_andamento_espelho` (barato).
- `Filter` situacao not in entregues **após** joins caros.
- Custo estimado optimizer: **~724×10⁶** (nested loop cartesiano entre sorts).

**COUNT (~3,0 s):**

- `Aggregate: count(distinct …)` com **mesma materialização de andamento**.
- `Covering index range scan` em `p` para `NroProtocolo < 5000` (melhor que data query).
- Gargalo permanece: **materialize andamento completo**.

### 5.2 Filtro por ano (ex.: 2025)

- Ainda materializa andamento/detalhes inteiros.
- Filtragem por ano ocorre **tarde** na árvore (após sort/joins) — **sem índice dedicado `(AnoProtocolo, …)`** além do PK composto.

### 5.3 Filtro por número da OS

- Mesmo com igualdade em `(NroProtocolo, AnoProtocolo)`, **ainda materializa derived table de andamento** (~2,5 s medidos).
- Prova que o derived table não é “pushdown” para a OS específica.

### 5.4 Filtro por setor / situação

- Usa colunas `a.SetorLink` / `a.SituacaoLink` pós-join.
- Índice `idx_andamento_filtros (SituacaoLink, SetorLink, UltimoStatus)` **não ajuda** o plano atual porque o optimizer não parte de `tabAndamento` filtrada — parte de `tabProtocolos` + materialização.

### 5.5 Filtro textual (`Titulo LIKE '%relat%'`)

- `Table scan on d_ranked` + filter LIKE — **full scan em detalhes materializados**.
- `idx_detalhes_produto_titulo` **inutilizado** por wildcard à esquerda.

### 5.6 Filtro setor/situação com Sub OS

- Adiciona `EXISTS` aninhado em `tab_os_sub_os` + `tab_os_sub_os_andamento` (barato hoje — 1 Sub OS ativa).
- Custo continua dominado por materialização de andamento + scan de protocolos.

### 5.7 Síntese EXPLAIN

| Sintoma | Observado |
|---------|-----------|
| Usa índice | Parcialmente (`idx_proto_unique`, sub_os espelho) |
| Full scan | **`tabAndamento`**, **`tabDetalhesServico`**, **`tabProtocolos`** (sort) |
| Filesort | **Sim** — prioridade, datas, window functions |
| Temporary table / Materialize | **Sim** — derived tables `ranked`, `d_ranked` |
| Subquery último andamento | **Custo altíssimo** — processa tabela inteira por request |

---

## 6. Índices existentes

### 6.1 `tabProtocolos`

| Índice | Colunas |
|--------|---------|
| `idx_proto_unique` (UNIQUE) | `NroProtocolo`, `AnoProtocolo` |
| `idx_protocolos_data_prioridade` | `EntregData`, `EntregPrazoLink`, `AnoProtocolo`, `NroProtocolo` |
| `idx_protocolos_solicitante` | `NomeUsuario` |
| `idx_protocolos_search_sort` | `EntregData`, `AnoProtocolo`, `NroProtocolo` |

Criado em startup via `os_search_indexes_schema.ensure_os_search_indexes()`.

### 6.2 `tabDetalhesServico`

| Índice | Colunas |
|--------|---------|
| `idx_detalhes_protocolo` | `NroProtocoloLinkDet`, `AnoProtocoloLinkDet` |
| `idx_detalhes_join` | `NroProtocoloLinkDet`, `AnoProtocoloLinkDet` |
| `idx_detalhes_produto_titulo` | `TipoPublicacaoLink`, `Titulo` |
| `idx_detalhes_os_link` | `AnoProtocoloLinkDet`, `NroProtocoloLinkDet` |

### 6.3 `tabAndamento`

| Índice | Colunas |
|--------|---------|
| `PRIMARY` | `CodStatus` |
| `idx_andamento_protocolo` | `NroProtocoloLink`, `AnoProtocoloLink` |
| `idx_panel_opt` | `UltimoStatus`, `SituacaoLink`, `SetorLink` |
| `idx_andamento_os_ultimo_data` | `NroProtocoloLink`, `AnoProtocoloLink`, `UltimoStatus`, `Data`, `CodStatus` |
| `idx_andamento_filtros` | `SituacaoLink`, `SetorLink`, `UltimoStatus` |
| `idx_andamento_os_operacional` | `NroProtocoloLink`, `AnoProtocoloLink`, `UltimoStatus`, `Data`, `CodStatus` |

### 6.4 Sub OS

| Tabela | Índices relevantes |
|--------|-------------------|
| `tab_os_sub_os` | `uk_sub_os_os_componente`, `idx_sub_os_os (ano, nro, ativo)` |
| `tab_os_sub_os_andamento` | `idx_sub_os_andamento_sub`, `idx_sub_os_andamento_espelho`, `uk_sub_os_andamento_inherited` |
| `tab_os_componentes` | `idx_os_componentes_os`, `idx_os_componentes_nome_norm` |

**Observação:** índices existem, mas o plano atual **não consegue usá-los de forma seletiva** por causa da derived table global de andamento.

---

## 7. Índices recomendados

> **Nota:** recomendações para fase futura — **não criar migrations nesta etapa**.

### 7.1 Fase 1 — baixo risco (complementares)

| Índice sugerido | Tabela | Colunas | Motivo |
|-----------------|--------|---------|--------|
| `idx_protocolos_ano_nro` | `tabProtocolos` | `(AnoProtocolo, NroProtocolo)` | Filtro por ano; range por ano |
| `idx_protocolos_tipo_ano` | `tabProtocolos` | `(AnoProtocolo, NroProtocolo)` WHERE implícito `<5000` | Separar OS/SP com filtro composto |
| `idx_sub_os_lookup` | `tab_os_sub_os` | `(nro_protocolo, ano_protocolo, ativo)` | Já coberto por `idx_sub_os_os` — OK |
| `idx_sub_os_andamento_filtro` | `tab_os_sub_os_andamento` | `(ultimo_status, setor, situacao, sub_os_id)` | Acelerar EXISTS de filtro Sub OS quando volume crescer |

**Limite:** índices **sozinhos não resolvem** a materialização de `ROW_NUMBER()` em toda `tabAndamento`. Ganho marginal até Fase 2.

### 7.2 Fase 2 — impacto alto (estrutural)

| Artefato | Descrição |
|----------|-----------|
| **`tab_os_ultimo_andamento_operacional`** (ou view materializada) | Uma linha por `(nro, ano)` com `situacao`, `setor`, `data`, `observacao`, mantida por trigger/job incremental |
| Índice na tabela materializada | `(situacao, setor)`, `(data DESC)` |
| Eliminar derived table | JOIN direto `p → ultimo_operacional → d` |

### 7.3 Fase 3

- **FULLTEXT** em `tabDetalhesServico.Titulo`, `TipoPublicacaoLink` se busca textual for requisito frequente.
- Índice funcional/prefix em `NomeUsuario` se busca por solicitante for crítica.

---

## 8. Gargalos no front-end

| Gargalo | Severidade | Detalhe |
|---------|------------|---------|
| Latência API | **Crítica** | ~7,5 s/request — domina UX |
| COUNT total sempre | **Alta** | Backend calcula total mesmo com `simple_pagination` |
| Bootstrap filtros default | Média | +1 round-trip settings antes da busca (120 s stale) |
| Refetch WS / polling | Média | Debounce 300 ms; polling 5–30 s offline WS pode somar carga |
| Debounce só em texto | Baixa | Setor/situação disparam request imediato (aceitável se SQL fosse rápido) |
| Sub OS expand / matched_via_sub_os | Baixa hoje | N+1 `fetchSubOsList`; volume Sub OS = 1 |
| Renderização tabela | **Baixa** | Virtualização ativa; 20 linhas/página |
| `sub_os_count` ausente | Info | Front preparado; API só manda `has_sub_os` |

**TanStack Query** está bem configurado (`staleTime`, `keepPreviousData`, sem refetch on focus). O problema não é cache client-side e sim **custo server-side + no-store HTTP**.

---

## 9. Impacto de Sub OS

### 9.1 Na query principal

- **`has_sub_os`:** `EXISTS` por linha — custo ~O(página) — **negligível** vs materialização de andamento.
- **Filtro setor/situação:** `build_main_or_sub_os_filter_sql()` adiciona:
  ```sql
  AND (
    (a.SetorLink IN (...) AND a.SituacaoLink IN (...))
    OR EXISTS (Sub OS com ultimo_status=1, manual, não congelada, ...)
  )
  ```
- **`annotate_search_sub_os_matches`:** pós-processamento Python — desprezível.

### 9.2 Volume atual

- **1 Sub OS ativa**, **11 componentes** — impacto Sub OS **desprezível em produção hoje**.
- Código Sub OS **escala mal** se volume crescer (EXISTS duplo por linha de protocolo no filtro).

### 9.3 Front-end Sub OS

- Expansão lazy + refresh após WS (900 ms).
- Não afeta abertura inicial exceto `matched_via_sub_os` (dispara fetch extra).

---

## 10. Plano de otimização por fases

### Fase 1 — baixo risco (quick wins)

| Ação | Benefício esperado | Risco |
|------|-------------------|-------|
| **Não JOIN `tabDetalhesServico` quando sem filtro produto/título** | Elimina materialize 86k linhas | Baixo — lógica já parcial (`join_details` só no COUNT) |
| **Adiar ou tornar opcional `COUNT DISTINCT`** (ex.: total só na 1ª página ou on-demand) | −~3 s por request | Baixo — UI já tolera `has_next` |
| **Índices complementares** (§7.1) | Marginal até Fase 2 | Baixo |
| **`has_sub_os` via LEFT JOIN agregado** (substituir EXISTS) | Pequeno | Baixo |
| Front: **debounce 150–300 ms em setor/situação** | Menos requests durante multi-select | Baixo |
| Front: **aumentar `staleTime` para 60–120 s** + manter WS patch | Menos refetch redundante | Médio — validar percepção tempo real |
| Manter paginação server-side | — | — |

**Meta Fase 1:** abertura **&lt; 1 s** se JOIN detalhes condicional + COUNT adiado; ainda insuficiente sem Fase 2.

### Fase 2 — query (impacto estrutural)

| Ação | Benefício |
|------|-----------|
| Tabela **`ultimo_andamento_operacional`** mantida incrementalmente | JOIN O(1) por OS; elimina window sobre 198k linhas |
| Reutilizar mesma tabela em painéis, PCP, e-mail pendências | Consistência + performance global |
| Busca exata nr/ano **short-circuit** (pula fila global) | OS específica &lt; 50 ms |
| Filtro setor/situação partindo da tabela materializada | Index range scan |
| Opcional: **`sub_os_count`** via subquery agregada na materialização | Alinha API ao front |

**Meta Fase 2:** abertura **200–500 ms**; filtros comuns **&lt; 800 ms**.

### Fase 3 — escala

| Ação | Benefício |
|------|-----------|
| Cache Redis curto keyed por hash de filtros + page | Protege picos; TTL 15–30 s |
| Snapshot de fila ativa (217 OSs) refresh periódico | Abertura instantânea |
| FULLTEXT para título/produto | Busca textual |
| Arquivamento/particionamento por `AnoProtocolo` | Reduz base quente |
| Read replica para search | Isola carga analítica |

---

## 11. Riscos

| Risco | Mitigação |
|-------|-----------|
| Tabela materializada dessincronizada | Atualizar nos mesmos pontos de write de andamento (já existem hooks pós-history) |
| Alterar semântica operacional vs `UltimoStatus` | **Não alterar `UltimoStatus`**; materializar regra operacional existente (`MIRROR_EXCLUDE`) |
| Quebrar filtro Sub OS | Testes de regressão com `build_main_or_sub_os_filter_sql` |
| Quebrar WebSocket / patch incremental | Manter contrato `OsSearchRow`; WS continua patch + refresh |
| Quebrar painéis / portal | Mudanças isoladas em `/os/search` + tabela nova |
| COUNT adiado confunde paginação | Exibir “20+” ou carregar total async |
| MDB | **Nenhuma alteração proposta no MDB** |
| Índices em tabela grande | `CREATE INDEX` online; monitorar locks |

---

## 12. Perguntas pendentes

1. **Qual a latência aceitável** para abertura (p95)? Ex.: &lt; 1 s, &lt; 500 ms?
2. **`total_records` é obrigatório** na UI de paginação ou basta “página X” + setas + `has_next`?
3. **Filtros default por usuário** — quais setores/situações típicos? (impacta cardinalidade real pós-bootstrap)
4. **Priorizar ano corrente** na abertura sem filtro explícito seria aceitável como otimização UX?
5. **Crescimento esperado de Sub OS** — regras atuais escalam para centenas de Sub OS por OS?
6. **MySQL version / recursos** — RAM, `innodb_buffer_pool_size`, replica disponível?
7. **Horário de pico** — quantos usuários simultâneos na lista? (multiplica ~7,5 s × N conexões)
8. **`sub_os_count` deve voltar à API** ou front usa só `has_sub_os`?
9. **Job noturno** para recalcular materialização é aceitável como fallback de consistência?
10. **Ambiente de homologação** com snapshot anonimizado para testar Fase 2 antes de produção?

---

## Apêndice A — Classificação de gargalos

| Categoria | Classificação |
|-----------|---------------|
| SQL/query (derived andamento global) | **Crítico** |
| Falta de estrutura materializada | **Crítico** |
| COUNT total pesado | **Alto** |
| JOIN último andamento | **Crítico** |
| LIKE `%texto%` | **Alto** (quando usado) |
| Sub OS no filtro | **Baixo hoje** / Médio futuro |
| Renderização front-end | **Baixo** |
| Cache/refetch TanStack | **Baixo** |
| WebSocket refresh excessivo | **Médio** |
| Payload grande | **Baixo** (~20 linhas × ~15 campos) |

---

## Apêndice B — Arquivos analisados

| Área | Arquivo |
|------|---------|
| Página inicial | `apps/web/src/features/os/components/OsHomePage.tsx` |
| Tabela | `apps/web/src/features/os/components/OsOrdersTable.tsx` |
| Hook busca | `apps/web/src/api/hooks/useOsSearch.ts` |
| API client | `apps/web/src/api/os.ts` |
| Filtros store | `apps/web/src/features/os/osFiltersStore.ts` |
| Seleção store | `apps/web/src/features/os/osSelectionStore.ts` |
| Query key | `apps/web/src/features/os/osSearchQueryKey.ts` |
| Realtime | `apps/web/src/features/os/hooks/useOsRealtimeSync.ts`, `osRealtimeSync.ts` |
| Backend route | `app/backend/routers/os_routes.py` |
| Sub OS SQL | `app/backend/services/os_sub_os_queries.py` |
| Andamento operacional | `app/backend/services/andamento_operacional.py` |
| Índices startup | `app/backend/os_search_indexes_schema.py` |
| Schema Sub OS | `app/backend/os_sub_os_schema.py` |

---

*Relatório gerado por auditoria estática + medições `EXPLAIN` e benchmark em MySQL. Nenhuma migration ou alteração de código foi aplicada.*
