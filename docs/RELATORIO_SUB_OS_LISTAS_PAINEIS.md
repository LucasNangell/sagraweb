# Relatório — Sub OS em Listas e Painéis

## O que foi corrigido

Sub OSs com status em `tab_os_sub_os_andamento.ultimo_status=1` passam a participar de **filtros de busca** e aparecem como **linhas virtuais** nos painéis operacionais, sem alterar `tabAndamento.UltimoStatus` da OS principal.

| Área | Antes | Depois |
|------|-------|--------|
| `GET /api/os/search` | Filtro setor/situação só em `tabAndamento` | `(main match) OR EXISTS(Sub OS com ultimo_status=1)` |
| `GET /api/pcp/queue` | Só OS principal | OS principal + linhas `row_kind=sub_os` |
| Lista inicial | Sub OS só após expandir manualmente | Auto-expande quando `matched_via_sub_os=true` |
| Painel global / Dashboard setor | Só número da OS principal | Exibe `2532 [Capa]` com destaque visual |

## Endpoints alterados

| Endpoint | Alteração | Compatibilidade |
|----------|-----------|-----------------|
| `GET /api/os/search` | Cláusula `OR EXISTS` para Sub OS; campo `matched_via_sub_os` | Campos anteriores mantidos; paginação continua por OS principal |
| `GET /api/pcp/queue` | Union lógica main + Sub OS virtual | Itens extras com `row_kind`, `sub_os_id`, `display_label` |

## Como Sub OS entra nos filtros

**Busca (`/os/search`):**

```sql
AND (
  (a.SetorLink IN (...) [AND a.SituacaoLink IN (...)])
  OR EXISTS (
    SELECT 1 FROM tab_os_sub_os s
    JOIN tab_os_sub_os_andamento sa ON sa.sub_os_id = s.id
    WHERE sa.ultimo_status = 1
      AND sa.setor IN (...)
      [AND sa.situacao IN (...)]
      ...
  )
)
```

- Retorna **uma linha** por OS principal (sem duplicar paginação).
- Se o match veio da Sub OS, `matched_via_sub_os=true` → front-end expande automaticamente.

**Painéis (`/pcp/queue`):**

- Query principal: inalterada (status da OS via `tabAndamento.UltimoStatus=1`).
- Query adicional: `fetch_sub_os_queue_rows()` — status de `tab_os_sub_os_andamento.ultimo_status=1`.
- Dedupe por `(nr_os, ano, row_kind, sub_os_id)` — permite main + Sub OS na mesma OS em setores diferentes.

## Como Sub OS aparece nos painéis

Campos mínimos nas linhas virtuais:

- `row_kind: "sub_os"`
- `sub_os_id`, `display_label` (ex.: `2532 [Capa]`)
- `situacao`, `setor` da Sub OS
- `parent_nr_os`, `parent_ano`
- `titulo`, `produto`, `prioridade` herdados da OS pai

Front-end:

- `painelDisplayLabel()` / `formatQueueDisplayLabel()` para rótulo
- Classe CSS `sub-os-card` / `sub-os-row` (borda âmbar)

## Garantias MDB / UltimoStatus

- Nenhuma alteração em MDB.
- Espelhos continuam com `UltimoStatus=0`.
- Status da OS principal continua exclusivamente de `tabAndamento.UltimoStatus=1`.
- Status de componente exclusivamente de `tab_os_sub_os_andamento.ultimo_status=1`.

## Testes executados

| Comando | Resultado |
|---------|-----------|
| `python -m pytest app/backend/tests -q` | **83 passed** |
| `pnpm build` | OK |
| `pnpm lint` | OK |

Novos testes: `app/backend/tests/test_sub_os_listas_paineis.py`

## Pendências

- Fallback legacy do painel (`/os/search` sem fila PCP) não emite linhas virtuais Sub OS — apenas inclui OS pai no filtro.
- Portal cliente não consome estes endpoints — sem impacto.
- Otimização batch em `list_sub_os()` (N+1) permanece como melhoria futura.
- Reordenar fila PCP continua válido só para OS principal (`row_kind=main_os`).

## Testes manuais recomendados

1. Sub OS `2532 [Capa]` em SIELT → filtrar lista por SIELT → OS 2532 aparece expandida.
2. Filtrar SEFOC → OS principal aparece se status principal for SEFOC.
3. Painel SIELT → card `2532 [Capa]`.
4. Painel SEFOC → OS principal normal (sem duplicar).
5. Paginação: contagem de páginas não aumenta por Sub OS.
6. Confirmar espelhos `UltimoStatus=0` após andamento de componente.
