# Relatório — Correção Definitiva da Lista Home em Tempo Real

**Data:** 2026-06-11  
**Escopo:** consistência `tabAndamento` ↔ materializada ↔ WebSocket ↔ lista home

---

## 1. Veredito

**Corrigido com ressalvas.**

A lista home (`GET /api/os/search`) volta a refletir o mesmo status operacional visível no painel do setor (`GET /api/pcp/queue`), com atualização em tempo real via WebSocket após qualquer mudança interna de andamento, fallback seguro para gaps transitórios e job de reconciliação automática.

**Ressalvas:**

- Andamentos gravados **exclusivamente** por sistemas externos (fora do Sagra Web) dependem do **job de reconciliação** (60 s default) até integrarem `after_andamento_changed` no sync externo.
- Filtro setor com fallback `EXISTS` ficou ~1,1 s neste ambiente (meta 1 s em casos comuns — aceitável vs. lista vazia).
- Rodar `python scripts/rebuild_os_ultimo_andamento.py` uma vez após deploy em ambiente novo.

---

## 2. Causa raiz

| Camada | Painel setor | Lista home (antes) |
|--------|--------------|-------------------|
| Fonte | `tabAndamento` + `UltimoStatus=1` | `tab_os_ultimo_andamento_operacional` |
| Gap | Não afetado | OS sem linha materializada sumia |
| Driver ativo | N/A | `INNER JOIN` materializada excluía gaps |
| Sync externo | Escreve `tabAndamento` | Não chamava refresh |
| WebSocket | Painel poll + WS | WS ok, mas materializada stale |

**Exemplo confirmado:** 5967/2026, 5966/2026, 1044/2026 — presentes no painel SEFOC, ausentes na home com filtros `Saída p/` + `Recebido` até refresh manual.

---

## 3. Correções aplicadas

### 3.1 Serviço central pós-andamento

Arquivo: `app/backend/services/os_andamento_post_change_service.py`

```python
after_andamento_changed(nro, ano, action, *, notify=True, ...)
```

Ordem obrigatória: **refresh materializada → WebSocket** (nunca invertido).

Logs: `[OS MATERIALIZED REFRESH]` e `[OS HOME WS]`.

### 3.2 Integração nos fluxos existentes

- `broadcast_os_system_update` → delega a `after_andamento_changed`
- `recalc_ultimo_status_operacional` → refresh sem WS (WS vem do caller)
- `refresh_materialized_os_operacional` → wrapper sem WS

**Regra documentada no código:** qualquer alteração em `tabAndamento` deve acabar em `after_andamento_changed`.

### 3.3 Reconciliação periódica

Arquivos:

- `app/backend/services/os_materialized_reconcile_service.py`
- `app/backend/services/os_materialized_reconcile_scheduler.py` (startup FastAPI)

Config (`.env`):

```env
SAGRA_OS_MATERIALIZED_RECONCILE_ENABLED=true
SAGRA_OS_MATERIALIZED_RECONCILE_INTERVAL_SECONDS=60
SAGRA_OS_MATERIALIZED_RECONCILE_LOOKBACK_MINUTES=30
SAGRA_OS_MATERIALIZED_RECONCILE_MAX_ROWS=500
```

### 3.4 Endpoints admin

Prefixo: `/api/admin/os/materialized/`

| Método | Rota | Função |
|--------|------|--------|
| GET | `/diagnostics` | Auditoria + amostra de gaps |
| GET | `/gaps` | Lista gaps recentes |
| POST | `/reconcile` | Ciclo incremental |
| POST | `/reconcile/{ano}/{nro}` | Uma OS |
| POST | `/gaps/fix` | Corrige gaps listados |
| POST | `/rebuild` | Backfill completo (emergência) |

Protegido por `require_admin_config_access`.

### 3.5 Fallback seguro na busca

Arquivos: `os_search_service.py`, `os_sub_os_queries.py`

- **Desativado** driver `INNER JOIN` materializada (excluía gaps).
- **Mantido** `LEFT JOIN` materializada (performance).
- **Adicionado** `EXISTS` pontual em `tabAndamento` quando `a_op` é NULL (sem `ROW_NUMBER()` global).
- **Enriquecimento pós-página** `_enrich_operacional_gaps()` para situação/setor corretos.

### 3.6 Frontend WebSocket

- `useOsSearch`: `staleTime = 0` (refetch imediato pós-evento).
- `useOsRealtimeSync`: `force_refresh` e eventos de materialização sem debounce; `history_*` com refetch direto.

### 3.7 Scripts

| Script | Uso |
|--------|-----|
| `scripts/reconcile_os_ultimo_andamento.py` | CLI reconciliação |
| `scripts/diag_home_vs_panel.py` | Compara painel vs home (`--fix`) |
| `scripts/rebuild_os_ultimo_andamento.py` | Backfill (existente) |

---

## 4. Fluxo final

```
tabAndamento (escrita)
    → after_andamento_changed()
        → refresh tab_os_ultimo_andamento_operacional
        → invalidate cache PCP
        → WebSocket system_update
            → useOsRealtimeSync
                → silentRefreshOsSearch (filtros atuais)
                    → GET /api/os/search (materializada + fallback EXISTS)
```

Job paralelo (60 s): `find_gaps` → `reconcile` → WS individual ou `force_refresh`.

---

## 5. Garantias de performance

Benchmark local pós-correção (`scripts/benchmark_os_search.py`):

| Cenário | Tempo |
|---------|-------|
| Abertura inicial | ~1,8 s |
| Filtro setor SEFOC | ~1,1 s |
| Filtro situação | ~0,7 s |
| Página 2 | ~0,8 s |
| Título LIKE | ~0,3 s |

- Sem `ROW_NUMBER()` global na busca.
- Materializada permanece fonte principal.
- Fallback `EXISTS` só com filtro setor/situação ativo.

---

## 6. Garantias de tempo real

- WebSocket emitido **após** refresh da materializada.
- Home refaz busca com filtros atuais em cada `system_update` / `force_refresh`.
- Reconciliação emite WS por OS (≤20) ou `force_refresh` consolidado.
- Polling 120 s permanece **somente** com WS offline.

---

## 7. Compatibilidade

| Item | Status |
|------|--------|
| Filtros otimizados (setor/situação/prioridade) | OK |
| Ano padrão (`ano >= ano-1`) | OK |
| Dropdowns Produto/Solicitante/Ano | OK |
| FULLTEXT | OK |
| Paginação server-side | OK |
| Ordenação prioridade | OK |
| Sub OS | OK |
| Painel setor (`/api/pcp/queue`) | Inalterado |
| Gravação MDB | Inalterada |
| WebSocket existente | Estendido |

---

## 8. Testes executados

| Teste | Resultado |
|-------|-----------|
| `test_os_andamento_post_change.py` | 2/2 pass |
| `test_os_materialized_reconcile.py` | 2/2 pass |
| `test_os_search_gap_fallback.py` | 2/2 pass |
| `test_os_operacional_notify.py` | 1/1 pass |
| `test_os_ultimo_andamento_search.py` | 12/12 pass |
| `diag_home_vs_panel.py --setor SEFOC --situacoes "Saída p/,Recebido"` | 3 OSs, 0 missing |

---

## 9. Como validar em produção

1. Deploy do backend + front.
2. `python scripts/rebuild_os_ultimo_andamento.py` (uma vez).
3. `python scripts/diag_home_vs_panel.py --setor SEFOC --situacoes "Saída p/,Recebido" --ano-from 2025`
4. Lançar andamento de teste pela API → confirmar painel SEFOC.
5. Confirmar home com mesmos filtros (sem F5).
6. DevTools → WS: evento `system_update` → request `os/search` em <1 s.
7. `GET /api/admin/os/materialized/diagnostics` (admin) → `recent_gap_count` ≈ 0.

---

## 10. Pendências

1. Integrar `after_andamento_changed` no **sync externo** de andamentos (quando o processo estiver no repositório).
2. Monitorar benchmark filtro setor; se >1 s em produção, índice composto em `tabAndamento (NroProtocoloLink, AnoProtocoloLink, UltimoStatus, SetorLink)`.
3. Alerta operacional se `recent_gap_count` > 0 por mais de 5 minutos.
