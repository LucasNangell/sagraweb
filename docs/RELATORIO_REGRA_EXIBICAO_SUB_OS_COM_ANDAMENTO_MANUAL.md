# Relatório — Regra de exibição de Sub OS com andamento manual

**Data:** 2026-06-08  
**Escopo:** Sub OS visível na lista apenas quando possui andamento exclusivo/manual do componente.

---

## 1. Regra implementada

Uma **Sub OS só aparece** na listagem (`+`, expansão, `/sub-os`, `has_sub_os`, filas) quando existe **ao menos um andamento exclusivo/manual** em `tab_os_sub_os_andamento`.

| Tipo | Visível na lista? |
|------|-------------------|
| Andamento **manual** (`source_type=manual_sub_os` ou legado equivalente) | Sim — Sub OS listável |
| Andamento **herdado** (`inherited_main_os` / propagação da OS principal) | Não — sozinho não torna a Sub OS listável |

Propagação da OS principal continua gravando herdados internamente (status do componente), mas **não** cria linha Sub OS na lista.

---

## 2. Manual vs herdado

| | Manual / exclusivo | Herdado |
|---|-------------------|---------|
| Origem | Usuário lançou no componente | Propagação do andamento da OS principal |
| `source_type` | `manual_sub_os` | `inherited_main_os` |
| Espelho `tabAndamento` | Sim (`UltimoStatus=0`) | Não |
| Conta para listagem | **Sim** | **Não** |
| Legado sem `source_type` | Manual se não tiver flags de herdado | Inferido por `herdado_da_os_principal` ou `source_cod_status` sem espelho |

Fragmento SQL central: `MANUAL_ANDAMENTO_SQL` em `os_componentes_service.py`.

Funções:
- `sub_os_has_manual_history(sub_os_id)`
- `sync_sub_os_listable_state(cursor, sub_os_id)` — `ativo=1` com manual, `ativo=0` sem manual

---

## 3. Endpoints alterados

| Endpoint | Alteração |
|----------|-----------|
| `GET /api/os/{ano}/{id}/sub-os` | Default: só Sub OSs listáveis (com manual). Query `include_inherited_only=true` para debug |
| `GET /api/os/{ano}/{id}/sub-os/summary` | `count`/`has_sub_os` só listáveis |
| `GET /api/os/search` | `has_sub_os` / `sub_os_count` contam só Sub OSs com manual |
| `DELETE .../sub-os/.../history/{id}` | Resposta inclui `still_listable` |

Sem alteração em MDB, `tabAndamento` ou dados de componentes na Gerência.

---

## 4. Impacto na lista / filtros / painéis

### Lista de OSs
- Sem manual → sem `+`, sem linhas Sub OS ao expandir
- Com manual em Capa → `+` e `2532 [Capa]` ao expandir
- Andamento principal propagado → não altera indicador `+`

### Busca (`/os/search`)
- `has_sub_os=false` se só existirem herdados
- Filtro setor/situação: Sub OS só entra no `EXISTS` se tiver andamento manual **e** bater no status atual

### Fila PCP / painéis
- `fetch_sub_os_queue_rows` exige `EXISTS` de andamento manual

### Formulário de lançamento
- **Inalterado:** componentes ativos continuam como destino; primeiro manual cria/reativa Sub OS e passa a listá-la

---

## 5. Exclusão do último andamento manual

1. Remove registro manual (+ espelho/MDB se aplicável)
2. `recalc_sub_os_ultimo_status` (herdados podem permanecer)
3. `sync_sub_os_listable_state` → `ativo=0` se não restar manual
4. `still_listable=false` na API
5. Front-end: refresh da lista, remove `+`, recolhe expansão, seleção volta para OS principal

Excluir **herdado** na UI da Sub OS não remove da lista (manual ainda existe).

---

## 6. Arquivos modificados

| Arquivo | Alteração |
|---------|-----------|
| `app/backend/services/os_componentes_service.py` | `MANUAL_ANDAMENTO_SQL`, filtros, sync ativo |
| `app/backend/services/os_sub_os_queries.py` | Filtros busca e fila PCP |
| `app/backend/routers/os_routes.py` | Subquery `sub_cnt` na busca |
| `app/backend/routers/os_sub_os_routes.py` | Param `include_inherited_only`, `still_listable` |
| `apps/web/src/features/os/components/OsOrdersTable.tsx` | Recolhe `+` quando lista vazia |
| `apps/web/src/features/os/osTableRows.ts` | `toMainOsSelection()` |
| `apps/web/src/features/os/osRealtimeSync.ts` | Desseleciona Sub OS removida |
| `apps/web/src/api/hooks/useSubOs.ts` | `still_listable` pós-exclusão |

---

## 7. Testes executados

```text
python -m pytest app/backend/tests -q
pnpm --filter @sagra/web test
pnpm build
```

Novos:
- `app/backend/tests/test_sub_os_listagem_manual.py`
- `apps/web/src/features/os/osTableRows.test.ts`

---

## 8. Limitações

- Sub OS com `ativo=0` e herdados internos permanece no MySQL (não aparece na lista)
- `include_inherited_only=true` é para diagnóstico, não exposto na UI
- Histórico da Sub OS (endpoint próprio) ainda mostra herdados quando a Sub OS é acessada via lançamento futuro ou seleção residual — apenas a **listagem** exige manual
