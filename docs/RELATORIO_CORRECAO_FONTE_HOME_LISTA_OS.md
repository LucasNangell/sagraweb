# Relatório — Correção Definitiva da Fonte da Lista Home

## 1. Veredito

**Corrigido com ressalvas** — implementação concluída no código; validação em produção depende de restart da API e teste operacional com andamento real (SAGRA Web + MDB legado).

---

## 2. Causa raiz

| Aspecto | Detalhe |
|---------|---------|
| **Fonte da home** | `GET /api/os/search` → `LEFT JOIN tab_os_ultimo_andamento_operacional AS a_op` (materializada) + enriquecimento pontual via `fetch_operacional_row` |
| **Fonte do painel setor** | `tabAndamento` com `UltimoStatus=1` (query live, ex.: `pcp_routes.py`) |
| **Onde surgiam gaps** | Sync MDB→MySQL escrevia em `tabandamento` (lowercase); backend lia `tabAndamento` — em MySQL case-sensitive são **tabelas distintas**; materializada era recalculada sobre tabela vazia/errada |
| **Duas tabelas?** | Sim, risco real quando `lower_case_table_names=0` (Linux). Em Windows local (`=1`) parecem a mesma |
| **Sync incompleto?** | Sync já atualizava materializada e notificava WS, mas sobre a tabela errada se houvesse divergência de case |
| **Faltava refresh?** | Fluxo SAGRA Web já chamava `after_andamento_changed`; faltava unificação de tabela + refresh incremental de filtros auxiliares |

**Divergência ocorre quando:** andamento válido está em uma tabela (`tabandamento`) e leituras/materializada/backfill usam outra (`tabAndamento`), ou quando a linha em `tab_os_ultimo_andamento_operacional` não foi recalculada após INSERT/UPDATE/DELETE.

---

## 3. Fluxo final

### SAGRA Web

```
Usuário → grava tabAndamento (MySQL) + MDB (fluxo legado)
       → refresh_home_os_sources()
            1. refresh_os_ultimo_andamento_operacional (tabela canônica)
            2. upsert_filter_options_for_os (produto/solicitante)
            3. WebSocket system_update
       → home refaz /api/os/search via useOsRealtimeSync
```

### Sync MDB → MySQL

```
MDB (somente leitura) → insert/update/delete MySQL (tabela canônica)
                      → refresh_os_ultimo_andamento_operacional
                      → refresh_os_filter_options_for_os
                      → POST /api/realtime/notify (WS após consistência)
```

**Regra:** `sync_andamentos_v2.py` **nunca** escreve no MDB (`SYNC_ALLOW_MDB_WRITE=false` por padrão).

---

## 4. Garantia sync somente MDB → MySQL

| Verificação | Status |
|-------------|--------|
| Lê MDB | Sim (`read_mdb`) |
| Escreve MySQL | Sim (`insert_mysql`, `update_mysql`, `delete_mysql`) |
| Escreve MDB | **Não** — `insert_mdb`, `_format_mdb_records`, parte MDB de `update_ultimo_status` bloqueados |
| MySQL→MDB no loop principal | Comentado/desativado (~linha 2107) |
| `delete_mdb` | Retorna sem excluir (proteção legada) |

Flag explícita para emergência: `SYNC_ALLOW_MDB_WRITE=true` (não usar em produção normal).

---

## 5. Tabelas da home

| Tabela | Papel | Atualização |
|--------|-------|-------------|
| `tabAndamento` / `tabandamento` | Andamento oficial (`UltimoStatus=1`) | SAGRA Web + sync MDB→MySQL |
| `tab_os_ultimo_andamento_operacional` | Situação/setor/data na busca | `refresh_os_ultimo_andamento_operacional` |
| `tabProtocolos` | Ano, solicitante, prazo | Sync background + SAGRA Web |
| `tabDetalhesServico` | Produto, título, formato | Sync background + SAGRA Web |
| `tab_os_filter_produtos` | Dropdown produto | Backfill + `upsert_filter_options_for_os` |
| `tab_os_filter_solicitantes` | Dropdown solicitante | Backfill + `upsert_filter_options_for_os` |
| `tab_os_sub_os_andamento` | Sub OS (não contamina materializada principal) | Fluxo Sub OS existente |

**Resolução de nome:** `services/andamento_table.py` → `get_andamento_table()` detecta tabela real via `information_schema` e prefere a com mais linhas se ambas existirem.

---

## 6. Reconcile

| Item | Valor |
|------|-------|
| Serviço | `os_materialized_reconcile_service.py` |
| Scheduler | `os_materialized_reconcile_scheduler.py` (startup API) |
| Script CLI | `scripts/reconcile_home_os_sources.py` (alias ampliado) |
| Env vars | `SAGRA_HOME_SOURCE_RECONCILE_*` ou legado `SAGRA_OS_MATERIALIZED_RECONCILE_*` |
| Default | enabled, 60s, lookback 30min, max 500 OS/ciclo |
| WS | Individual ≤20 OS; acima → `force_refresh` |

Exemplos:

```bash
python scripts/reconcile_home_os_sources.py --recent-minutes 60 --fix
python scripts/reconcile_home_os_sources.py --setor SEFOC --fix
python scripts/reconcile_home_os_sources.py --os 5967 --ano 2026 --fix
python scripts/reconcile_home_os_sources.py --full --limit 10000 --fix
```

---

## 7. Fallback seguro

Em `/api/os/search` (sem alteração estrutural — já existia):

- **Principal:** `LEFT JOIN tab_os_ultimo_andamento_operacional`
- **Com filtro setor/situação:** `materialized_gap_fallback` — `EXISTS` pontual na tabela canônica quando `a_op` ausente
- **Pós-página:** `_enrich_operacional_gaps()` preenche situação/setor live
- **Proibido em produção 1M+:** `ROW_NUMBER()` global (`OS_SEARCH_ALLOW_LIVE_FALLBACK`)

Gap fallback agora usa `get_andamento_table()` — mesma tabela que sync e materializada.

---

## 8. WebSocket

| Origem | Evento | Momento |
|--------|--------|---------|
| SAGRA Web | `system_update` | Após `refresh_home_os_sources` |
| Sync | `system_update` (`origem: sync_mdb`) | Após materializada + filtros |
| Reconcile | `system_update` ou `force_refresh` | Após correção |
| Frontend | `useOsRealtimeSync` → `silentRefreshOsSearch` | Refetch com abort de busca anterior |

**Painel setor:** não alterado (conforme requisito).

---

## 9. Testes

| # | Teste | Status |
|---|-------|--------|
| 1 | Home encontra OS com materializada | Coberto (suite existente) |
| 2 | Fallback gap (setor/situação) | Coberto (`os_sub_os_queries` + search tests) |
| 3 | Reconcile cria materializada ausente | `test_os_materialized_reconcile` |
| 4 | Reconcile corrige divergência | idem |
| 5–7 | SAGRA Web INSERT/UPDATE/DELETE → refresh | `after_andamento_changed` → `refresh_home_os_sources` |
| 8–10 | Sync → materializada + notify | Fluxo `after_os_changed` (sync) |
| 11 | Sync não escreve MDB | `SYNC_ALLOW_MDB_WRITE=false` |
| 12–14 | Sub OS, filtros, FULLTEXT | Suite existente (354 passed) |
| 15 | Filtros Ano/Produto/Solicitante | Suite dropdowns |
| **Novos** | `test_andamento_table.py` | 2 passed |
| **Novos** | `test_os_home_source_service.py` | 2 passed |

**Backend total:** 354 testes passando.

---

## 10. Benchmarks

Benchmark formal antes/depois **não executado nesta sessão** (sem API de produção reiniciada).

Metas de design preservadas:

- Abertura home: JOIN materializada (sem ROW_NUMBER global)
- Filtros setor/situação: índices em materializada + gap EXISTS pontual
- Reconcile leve: max 500 OS, lookback 30min
- WS: emitido somente após refresh materializada

Recomendado pós-deploy:

```bash
python scripts/diag_home_vs_panel.py --setor SEFOC --ano-from 2025
python scripts/reconcile_home_os_sources.py --recent-minutes 60
```

---

## 11. Como validar em produção

1. **Deploy** backend + `sync_andamentos_v2.py` (sem reiniciar API automaticamente — operador executa `parar-api.bat` / `iniciar-api.bat`).
2. Verificar log startup: `Startup: tabela de andamento MySQL = tabAndamento` (ou `tabandamento`).
3. Rodar diagnóstico:
   ```bash
   python scripts/diag_home_vs_panel.py --setor SEFOC --fix
   ```
4. Lançar andamento pelo **SAGRA Web** → home deve atualizar em ~1s (WS).
5. Lançar andamento pelo **sistema legado (MDB)** → após ciclo sync → home atualiza.
6. Confirmar sync **não** alterou MDB (logs sem `INSERT`/`UPDATE`/`DELETE` MDB).
7. Se duas tabelas existirem no MySQL, planejar merge:
   ```sql
   -- exemplo (ajustar conforme auditoria)
   INSERT INTO tabAndamento SELECT * FROM tabandamento WHERE CodStatus NOT IN (SELECT CodStatus FROM tabAndamento);
   ```

---

## Arquivos alterados (principais)

- `app/backend/services/andamento_table.py` — **novo**
- `app/backend/services/os_home_source_service.py` — **novo** (`refresh_home_os_sources`)
- `app/backend/services/os_andamento_post_change_service.py` — delega ao serviço central
- `app/backend/services/os_ultimo_andamento_service.py` — tabela dinâmica
- `app/backend/services/os_materialized_reconcile_service.py` — tabela dinâmica + env aliases
- `app/backend/services/os_filter_options_service.py` — `upsert_filter_options_for_os`
- `app/backend/services/os_sub_os_queries.py` — gap fallback com tabela canônica
- `app/backend/routers/api.py` — resolve tabela no startup
- `sync_andamentos_v2.py` — tabela canônica MySQL + guard MDB write
- `scripts/reconcile_home_os_sources.py` — **novo**
- `scripts/diag_home_vs_panel.py` — tabela dinâmica

---

**Critério de aceite:** home e painel concordam quando a materializada está sincronizada com a tabela canônica de andamentos; qualquer alteração (Web ou sync) dispara refresh + WS; sync permanece estritamente MDB→MySQL.
