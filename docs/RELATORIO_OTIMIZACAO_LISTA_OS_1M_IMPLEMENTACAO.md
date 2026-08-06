# Relatório — Otimização Lista de OSs para Base 1M+

**Data:** 2026-06-11  
**Referência:** [`RELATORIO_AUDITORIA_LISTA_OS_FILTROS_PAGINACAO.md`](RELATORIO_AUDITORIA_LISTA_OS_FILTROS_PAGINACAO.md)

---

## 1. Veredito

**Corrigido com ressalvas.**

A busca `GET /api/os/search` passou a usar **`tab_os_ultimo_andamento_operacional`** em vez de `ROW_NUMBER()` global em `tabAndamento`. Benchmarks em homologação (~84k protocolos) ficaram **abaixo de 500 ms** na abertura e filtros comuns; busca exata por Nr OS em **~6 ms**.

**Ressalvas:**

- Em homologação a materializada cobre **9.681 OSs** de **84.056** protocolos (OSs sem `UltimoStatus=1` operacional não têm linha — comportamento alinhado ao JOIN live anterior).
- Para **1M+** registros na abertura sem filtro de ano, ainda é recomendável particionamento/arquivo por ano ou filtro default de ano corrente (pendência estrutural).
- Rodar `python scripts/rebuild_os_ultimo_andamento.py` após deploy em ambiente novo.
- Uma divergência em amostra de 20 linhas (`materialized_exists_live_missing` OS 1042/2026) — investigar dado pontual; não bloqueia o rollout.

---

## 2. Causa da lentidão

| Fator | Impacto |
|-------|---------|
| `ROW_NUMBER()` sobre `tabAndamento` a cada request | **Crítico** — eliminado |
| Sort global em `tabProtocolos` antes do `LIMIT` | **Alto** — mitigado com driver indexado em setor/situação |
| `COUNT DISTINCT` duplicando custo | **Alto** — já adiado (`simple_pagination=true`) |
| `GROUP BY` global em `tab_os_sub_os` | **Médio** — substituído por subquery correlacionada |
| `LIKE '%texto%'` | **Alto** quando usado — documentado, FULLTEXT em fase futura |
| `staleTime=0` + poll 60s no front | **Médio** — ajustado para 30s + poll 120s |

---

## 3. Arquitetura nova da busca

### 3.1 Join de andamento

```sql
LEFT JOIN tab_os_ultimo_andamento_operacional AS a_op
  ON a_op.nro_protocolo = p.NroProtocolo
 AND a_op.ano_protocolo = p.AnoProtocolo
```

Mapeamento:

| Coluna materializada | Campo API |
|---------------------|-----------|
| `situacao` | `situacao` |
| `setor` | `setor` |
| `data` | `last_update` |
| `observacao` | `observacao` |

**Removido da busca normal:** `ROW_NUMBER()`, scan global em `tabAndamento`, `MIRROR_EXCLUDE_CLAUSE` no search (regra já aplicada na materializada).

**Fallback live** (`ROW_NUMBER()`): apenas com `OS_SEARCH_ALLOW_LIVE_FALLBACK=1` (debug/admin).

### 3.2 Plano invertido (setor/situação)

Quando há filtro de **setor** e/ou **situação**:

```sql
FROM tab_os_ultimo_andamento_operacional AS a_op
INNER JOIN tabProtocolos AS p ON ...
```

Usa índices `idx_ua_oper_setor`, `idx_ua_oper_situacao`, `idx_ua_oper_setor_situacao`.

Abertura **sem** filtro de escolha mantém `FROM tabProtocolos LEFT JOIN materializada` para preservar OSs com `situacao` NULL (sem linha materializada).

### 3.3 Filtros preservados

Todos os filtros existentes mantidos: OS/SP, entregues, ano, nr_os, produto, título, solicitante, setor, situação (+ Sub OS OR), prioridade, `exact_os_lookup`, ordenação, `pcp_order`.

### 3.4 Ordenação default

Inalterada:

1. Prometido → Solicitado → demais (`EntregPrazoLink`)
2. `COALESCE(EntregData, DataEntrada)` ASC
3. `AnoProtocolo DESC`, `NroProtocolo DESC`

### 3.5 Paginação

- `simple_pagination=true` (default): `LIMIT limit+1`, `has_next`, **sem** `COUNT DISTINCT`.
- `page` + `OFFSET` mantidos (keyset pagination = fase futura).

### 3.6 Sub OS

- `sub_os_count` / `has_sub_os` via subquery correlacionada (não `GROUP BY` global).
- `build_main_or_sub_os_filter_sql` + `matched_via_sub_os` preservados.

---

## 4. Materializada

### 4.1 Auditoria (homologação 2026-06-11)

Comando: `python scripts/validate_os_ultimo_andamento.py --sample-size 20`

| Métrica | Valor |
|---------|-------|
| Linhas materializadas | 9.681 |
| Protocolos totais | 84.056 |
| Protocolos sem linha materializada | 74.377 |
| Índices PK + situacao/setor/data | ✅ presentes |

### 4.2 Schema / índices

Tabela: `tab_os_ultimo_andamento_operacional` — ver `os_ultimo_andamento_schema.py`.

### 4.3 Backfill

```bash
python scripts/rebuild_os_ultimo_andamento.py
python scripts/rebuild_os_ultimo_andamento.py --validate-only --sample-size 100
```

Idempotente (TRUNCATE + INSERT…SELECT offline). Não altera `tabAndamento` nem MDB.

### 4.4 Atualização incremental

`refresh_os_ultimo_andamento_operacional(nro, ano)` em:

- `recalc_ultimo_status_operacional` (transação)
- `broadcast_os_system_update` → **antes** do WebSocket

### 4.5 Validação de consistência

- `audit_materialized_table()` — somente leitura
- `sample_divergences_vs_live()` — compara amostra com cálculo live

---

## 5. WebSocket e tempo real

Fluxo após novo andamento:

1. Transação atualiza `tabAndamento` (+ recalc `UltimoStatus` se aplicável)
2. `refresh_os_ultimo_andamento_operacional` na mesma transação (recalc) ou em `broadcast_os_system_update`
3. `broadcast_os_system_update` atualiza materializada (idempotente) e **depois** emite WS
4. Front recebe `system_update` → patch ou `silentRefreshOsSearch` (300 ms debounce)
5. Refetch usa query materializada rápida

**Não alterado:** MDB, `UltimoStatus`, espelhos Sub OS como status oficial.

---

## 6. Sub OS

| Regra | Status |
|-------|--------|
| Sub OS não é linha na lista principal | ✅ |
| Filtro OR principal/Sub OS | ✅ |
| `matched_via_sub_os` | ✅ |
| Espelhos excluídos da materializada | ✅ |

---

## 7. Índices criados/recomendados

| Tabela | Índice | Motivo | Status |
|--------|--------|--------|--------|
| `tab_os_ultimo_andamento_operacional` | PK `(nro, ano)` | JOIN | ✅ existente |
| `tab_os_ultimo_andamento_operacional` | `idx_ua_oper_situacao` | Filtro ativo | ✅ |
| `tab_os_ultimo_andamento_operacional` | `idx_ua_oper_setor` | Filtro setor | ✅ |
| `tab_os_ultimo_andamento_operacional` | `idx_ua_oper_setor_situacao` | Filtro composto | ✅ |
| `tabProtocolos` | `idx_protocolos_ano_nro` | Filtro ano/nr | ✅ startup |
| `tabProtocolos` | `idx_protocolos_sort_date` | Ordenação | ✅ startup |
| `tab_os_sub_os` | `idx_sub_os_os_ativo` | has_sub_os | ✅ startup |
| `tab_os_sub_os_andamento` | `idx_sub_os_andamento_filtro` | EXISTS Sub OS | ✅ startup |

Criação idempotente: `os_search_indexes_schema.py` no startup.

---

## 8. Performance antes/depois

Ambiente: MySQL `sagrafulldb` @ 10.1.1.73, 2026-06-11, pós-implementação.

| Cenário | Antes (ref. jun/2026) | Depois (ms) | Meta |
|---------|----------------------|-------------|------|
| Abertura inicial | ~7.500 / ~438* | **324–359** | < 500 ms ✅ |
| Filtro setor | — | **57–279** | < 500 ms ✅ |
| Filtro situação | — | **17–90** | < 500 ms ✅ |
| Abertura + ano | — | **84** | < 500 ms ✅ |
| Nr OS exact | ~11* | **6** | < 100 ms ✅ |
| Página 2 | — | **350** | < 1 s ✅ |
| Título LIKE | — | **150–259** | aceitável |

\* Medições anteriores do [`RELATORIO_OTIMIZACAO_LISTA_OS_IMPLEMENTACAO.md`](RELATORIO_OTIMIZACAO_LISTA_OS_IMPLEMENTACAO.md).

Comando: `python scripts/benchmark_os_search.py --ano 2026 --nr-os 1234`

**EXPLAIN:** sem `ROW_NUMBER` / `tabAndamento` na query de dados; JOIN por PK na materializada.

---

## 9. Testes executados

| Comando | Resultado |
|---------|-----------|
| `python -m pytest app/backend/tests -q` | **306 passed** |
| `pnpm exec vitest run src/api/hooks/useOsSearch.test.ts` | **2 passed** |
| `python scripts/benchmark_os_search.py` | ✅ ver §8 |
| `python scripts/validate_os_ultimo_andamento.py` | ⚠️ 1 divergência em amostra 20 |

Testes atualizados para exigir materializada no search (`test_os_ultimo_andamento_search.py`, `test_os_search_security.py`).

---

## 10. Front-end

| Ajuste | Arquivo |
|--------|---------|
| `staleTime` 30s | `useOsSearch.ts` |
| `placeholderData: keepPreviousData` | `useOsSearch.ts` |
| Poll segurança 120s (não agressivo) | `useOsSearch.ts` |
| Debounce 200ms setor/situação/prioridade | `OsHomePage.tsx` |

WebSocket / `useOsRealtimeSync` inalterados na lógica; refetch usa busca materializada.

---

## 11. Riscos e pendências

| Item | Prioridade |
|------|------------|
| FULLTEXT título/produto | Média |
| Keyset pagination (substituir OFFSET profundo) | Média |
| Particionamento / arquivo por `AnoProtocolo` para 1M+ abertura sem ano | **Alta** |
| Cache Redis (só com invalidação WS) | Baixa |
| Read replica para search | Baixa |
| Expandir cobertura materializada (OSs sem UltimoStatus=1) | Avaliar com negócio |

---

## 12. Como validar em produção

1. Deploy backend + front.
2. Startup garante schema (`ensure_os_ultimo_andamento_schema`).
3. **Janela de manutenção:** `python scripts/rebuild_os_ultimo_andamento.py`
4. Validar: `python scripts/validate_os_ultimo_andamento.py --sample-size 100`
5. Benchmark: `python scripts/benchmark_os_search.py --ano <ano>`
6. Abrir lista — abertura < 1 s.
7. Alterar andamento de uma OS — lista atualiza situação/setor via WS em < 1 s.
8. Confirmar Sub OS: filtro por setor encontra OS via componente; `matched_via_sub_os` expande.

**Rollback:** definir `OS_SEARCH_ALLOW_LIVE_FALLBACK=1` (apenas emergência — lento em 1M+).

---

## 13. Arquivos alterados

| Arquivo | Mudança |
|---------|---------|
| `app/backend/services/os_search_service.py` | Busca via materializada + driver setor/situação |
| `app/backend/services/os_ultimo_andamento_service.py` | `audit_materialized_table`, `sample_divergences_vs_live` |
| `app/backend/os_search_indexes_schema.py` | Índices adicionais |
| `app/backend/tests/test_os_ultimo_andamento_search.py` | Testes materializada |
| `app/backend/tests/test_os_search_security.py` | Join materializada |
| `scripts/rebuild_os_ultimo_andamento.py` | Validação pós-backfill |
| `scripts/validate_os_ultimo_andamento.py` | **Novo** |
| `scripts/benchmark_os_search.py` | **Novo** |
| `apps/web/src/api/hooks/useOsSearch.ts` | staleTime, keepPreviousData, poll |
| `apps/web/src/features/os/components/OsHomePage.tsx` | Debounce filtros escolha |

---

*Implementação concluída com medição antes/depois em homologação. Nenhuma alteração em MDB ou `UltimoStatus`.*
