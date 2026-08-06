# Relatório de Implementação — Otimização Lista Inicial de OSs

**Data:** 2026-06-09  
**Referência:** [`RELATORIO_PERFORMANCE_LISTA_OS.md`](RELATORIO_PERFORMANCE_LISTA_OS.md)

---

## 1. Veredito

**Corrigido com ressalvas.**

A lista inicial e os filtros comuns passaram de **~7,5 s** para **~0,4 s** por request (abertura default), e busca por OS/ano específico para **~10 ms**. A meta de 200–500 ms na abertura **não foi totalmente atingida** (~438 ms médio), mas ficou **abaixo de 1 s** e **~17× mais rápida** que antes.

**Ressalvas:**

- É necessário rodar o backfill (`scripts/rebuild_os_ultimo_andamento.py`) após deploy em ambiente novo.
- Paginação simples não retorna mais `total_records`/`total_pages` (front adaptado para `has_next`).
- `pnpm typecheck` continua falhando por **TS6310 pré-existente** nos packages referenciados.

---

## 2. Causa confirmada

| Item | Antes |
|------|-------|
| Gargalo principal | `ROW_NUMBER()` sobre **toda** `tabAndamento` (~198 mil linhas) **a cada** request |
| JOIN detalhes | Materialização global de **toda** `tabDetalhesServico` (~86 mil linhas) sempre |
| COUNT | `COUNT(DISTINCT …)` duplicando o custo (~3 s) mesmo com `simple_pagination=true` |
| Tempo total/request | **~7,5 s** (dados ~4,6 s + count ~3,0 s) |

Query antiga: derived tables em `tabAndamento` + `tabDetalhesServico` + `COUNT DISTINCT` — conforme auditoria.

---

## 3. Alterações implementadas

### Fase 1 — Quick wins

| Alteração | Status |
|-----------|--------|
| JOIN detalhes condicional (`EXISTS` para filtro; batch pós-página para exibição) | ✅ |
| Adiar `COUNT DISTINCT` quando `simple_pagination=true` | ✅ |
| Atalho implícito nr_os/ano (filtro indexável + sem materialização global) | ✅ |
| Debounce 200 ms setor/situação/prioridade no front | ✅ |
| `sub_os_count` + agregado `has_sub_os` via LEFT JOIN | ✅ |

### Fase 2 — Tabela materializada

| Alteração | Status |
|-----------|--------|
| `tab_os_ultimo_andamento_operacional` | ✅ |
| Migration idempotente + startup | ✅ |
| Backfill CLI | ✅ |
| Atualização incremental nos pontos de escrita | ✅ |

### Fase 3 — `/api/os/search`

| Alteração | Status |
|-----------|--------|
| JOIN materializada em vez de `ROW_NUMBER()` global | ✅ |
| Filtros e ordenação preservados | ✅ |
| Fallback legacy se tabela vazia | ✅ |
| Lógica extraída para `services/os_search_service.py` | ✅ |

### Fase 4 — Front-end

| Alteração | Status |
|-----------|--------|
| Paginação sem total exato | ✅ |
| `keepPreviousData` / virtualização / WebSocket mantidos | ✅ |

### Fase 5 — Rebuild

| Alteração | Status |
|-----------|--------|
| `scripts/rebuild_os_ultimo_andamento.py` | ✅ |
| Idempotente, loga tempo e quantidade | ✅ |

---

## 4. Tabela materializada

### Schema

Tabela: **`tab_os_ultimo_andamento_operacional`**

| Coluna | Tipo |
|--------|------|
| `nro_protocolo`, `ano_protocolo` | PK composta |
| `cod_status`, `situacao`, `setor` | status operacional |
| `data`, `observacao`, `ponto` | último andamento |
| `ultimo_status` | flag do registro escolhido |
| `atualizado_em` | auditoria |

Arquivos:

- `app/backend/os_ultimo_andamento_schema.py`
- `deploy/sql/create_tab_os_ultimo_andamento_operacional.sql`

### Índices

- PK `(nro_protocolo, ano_protocolo)`
- `idx_ua_oper_situacao (situacao)`
- `idx_ua_oper_setor (setor)`
- `idx_ua_oper_setor_situacao (setor, situacao)`
- `idx_ua_oper_data (data)`
- `idx_ua_oper_ano_nro (ano_protocolo, nro_protocolo)`

### Regra de seleção (igual à busca antiga)

```sql
ORDER BY UltimoStatus DESC, Data DESC, CodStatus DESC
WHERE NOT EXISTS (espelho Sub OS via cod_status_espelho)
```

### Backfill

```bash
python scripts/rebuild_os_ultimo_andamento.py
```

**Medição homologação (2026-06-09):** 84.036 linhas em **6,2 s**.

### Atualização incremental

Função: `refresh_os_ultimo_andamento_operacional(nro, ano)` em `services/os_ultimo_andamento_service.py`

**Pontos de chamada:**

| Fluxo | Arquivo |
|-------|---------|
| `recalc_ultimo_status_operacional` (exclusão) | `services/andamento_operacional.py` |
| `save_os` | `routers/os_routes.py` |
| `duplicate_os` | `routers/os_routes.py` |
| `add_os_history` | `routers/os_routes.py` |
| `update_os_history` | `routers/os_routes.py` |
| `replicate_history` (cada OS alvo) | `routers/os_routes.py` |

**Não altera:** `UltimoStatus` em `tabAndamento`, MDB, espelhos Sub OS como status oficial.

---

## 5. `/api/os/search`

### Query nova (resumo)

```sql
SELECT p.*, a.situacao, a.setor, a.data AS last_update, ...
       COALESCE(sub_agg.sub_os_count, 0), ...
FROM tabProtocolos p
LEFT JOIN tab_os_ultimo_andamento_operacional a
  ON a.nro_protocolo = p.NroProtocolo AND a.ano_protocolo = p.AnoProtocolo
LEFT JOIN (SELECT ... COUNT(*) FROM tab_os_sub_os WHERE ativo=1 GROUP BY ...) sub_agg ...
WHERE /* filtros */
ORDER BY /* prioridade + EntregData + ano/nr */
LIMIT limit+1 OFFSET offset
-- Detalhes (titulo/produto/formato): batch IN (...) após paginação
-- Filtro texto produto/título: EXISTS em tabDetalhesServico
```

### Filtros preservados

OS/SP, entregues, ano, nr_os, produto, título, solicitante, setor, situação (com Sub OS), prioridade, ordenação por coluna, `pcp_order`.

### Paginação / total

- `simple_pagination=true` (default): **`has_next` via limit+1**; **`total_records`/`total_pages` omitidos**.
- `simple_pagination=false`: COUNT DISTINCT mantido (legado/admin).

### Sub OS

- `build_main_or_sub_os_filter_sql` aceita colunas configuráveis (`a.situacao` / `a.setor`).
- `matched_via_sub_os` inalterado.
- Sub OS não vira linha independente na lista.

### EXPLAIN simplificado (abertura, pós-optimização)

- JOIN indexado `tab_os_ultimo_andamento_operacional` por PK.
- Sort em `tabProtocolos` (~83 mil linhas filtradas n&lt;5000) — gargalo remanescente.
- Sem materialize de `tabAndamento` inteira.

---

## 6. Performance antes/depois

Ambiente: MySQL `sagrafulldb` @ 10.1.1.73, 2026-06-09.

| Cenário | Antes (ms) | Depois (ms) | Melhora |
|---------|------------|-------------|---------|
| Abertura inicial (ativas, OS&lt;5000) | ~7.500 | **438** | **~94%** |
| Query de dados (abertura) | ~4.600 | **~370** | ~92% |
| COUNT (abertura) | ~3.000 | **0** (adiado) | 100% |
| nr_os=1234 + ano=2025 | ~2.500 | **11** | **~99,6%** |
| Filtro ano=2025 | — | **294** | — |
| Setor + situação | — | **399** | — |
| Título LIKE `%relat%` | — | **213** | — |
| Página 2 | — | **264** | — |

**Metas:**

| Meta | Resultado |
|------|-----------|
| Abertura &lt; 1 s | ✅ ~438 ms |
| Abertura 200–500 ms | ⚠️ ~370–470 ms (próximo passo: filtrar ativas antes do sort) |
| OS específica &lt; 100 ms | ✅ ~11 ms |
| Filtros comuns &lt; 800 ms | ✅ |

---

## 7. Impacto em tempo real

- WebSocket / `silentRefreshOsSearch` **inalterados**.
- Materializada atualizada **sincronamente** após cada escrita de andamento → lista reflete mudanças no próximo GET/refresh.
- `Cache-Control: no-store` mantido no backend.
- TanStack Query: `staleTime` 30 s, `refetchOnWindowFocus: false`, `keepPreviousData`.

---

## 8. Garantias de não regressão

| Área | Status |
|------|--------|
| MDB | Não alterado |
| `UltimoStatus` | Não alterado (só lido na seleção materializada) |
| Sub OS / espelhos | Excluídos da materializada |
| Painéis / portal | Endpoints separados |
| Filtros Sub OS | Preservados + colunas configuráveis |
| Paginação | `has_next` + navegação por página |

---

## 9. Arquivos alterados

| Arquivo | Mudança |
|---------|---------|
| `app/backend/services/os_search_service.py` | **Novo** — busca otimizada |
| `app/backend/services/os_ultimo_andamento_service.py` | **Novo** — backfill/sync |
| `app/backend/os_ultimo_andamento_schema.py` | **Novo** — DDL idempotente |
| `app/backend/services/andamento_operacional.py` | Sync materializada pós-recalc |
| `app/backend/services/os_sub_os_queries.py` | Colunas main configuráveis |
| `app/backend/routers/os_routes.py` | Delega busca; hooks sync |
| `app/backend/routers/api.py` | Startup schema |
| `scripts/rebuild_os_ultimo_andamento.py` | **Novo** — CLI rebuild |
| `deploy/sql/create_tab_os_ultimo_andamento_operacional.sql` | **Novo** |
| `app/backend/tests/test_os_ultimo_andamento_search.py` | **Novo** |
| `apps/web/src/features/os/components/OsHomePage.tsx` | Debounce filtros choice |
| `apps/web/src/features/os/components/OsOrdersTable.tsx` | Paginação sem total |

---

## 10. Testes executados

| Comando | Resultado |
|---------|-----------|
| `python -m pytest app/backend/tests -q` | **190 passed** |
| `pnpm build` | ✅ |
| `pnpm lint` | Placeholder (eslint pendente Fase 0) |
| `pnpm typecheck` | ❌ TS6310 pré-existente (`packages/api-types`, `packages/ui`) |

---

## 11. Pendências

1. **Abertura 200–500 ms:** inverter ordem do plano — partir de OSs ativas via índice em `(situacao, setor)` na materializada antes de sort em `tabProtocolos`.
2. **Fulltext** para título/produto se busca textual for crítica.
3. **Cache curto** server-side (Redis) — só se necessário; hoje WebSocket cobre tempo real.
4. **Endpoint admin** HTTP para rebuild (hoje só CLI).
5. **Read replica** para search em pico.
6. **Corrigir TS6310** nos packages referenciados do monorepo.
7. **Rodar backfill em produção** no deploy (homologação já executado: 84.036 linhas).

---

## Deploy checklist

1. Deploy backend + front.
2. Startup cria tabela (`ensure_os_ultimo_andamento_schema`).
3. Executar: `python scripts/rebuild_os_ultimo_andamento.py`
4. Validar abertura da lista (&lt; 1 s).
5. Validar andamento novo atualiza linha na lista via WebSocket.
