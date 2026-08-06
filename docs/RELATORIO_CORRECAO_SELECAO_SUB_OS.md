# Relatório — Correção de seleção de Sub OS na lista

**Data:** 2026-06-08

## Causa encontrada

A lentidão/travamento vinha principalmente de **dois efeitos colaterais** ao clicar em Sub OS:

1. **`useEffect([rows, expandedOs])` em `OsOrdersTable`** — a cada refetch da lista (WebSocket, filtros, paginação), refazia **fetch de todas as Sub OS expandidas** em paralelo, bloqueando a UI e competindo com o clique de seleção.
2. **`OsHomePage` limpava seleção** comparando só `nr_os/ano`, sem distinguir Sub OS — em refetch a seleção podia ser descartada ou conflitar com a linha principal (mesmo protocolo).
3. **Chave de seleção ambígua** — OS principal e Sub OS compartilhavam identificação `ano-nr_os`; `isSameOsSelection` dependia de flags que podiam ser perdidas ao recriar linhas em `buildDisplayRows`.
4. **Refetch em cascata ao selecionar Sub OS** — `OsHistoryPanel` buscava componentes mesmo com Sub OS selecionada; `useSubOsHistory` usava `refetchOnMount: "always"`, amplificando loading.

## Chave de seleção

| Tipo | Formato |
|------|---------|
| OS principal | `main:{ano}:{nr_os}` |
| Sub OS | `sub:{parent_ano}:{parent_nr_os}:{sub_os_id}` |

Funções: `selectionRowKey()`, `displayRowId()`, `normalizeOsSelection()`, `isSameOsSelection()`.

Seleção normalizada no store com `kind: "main_os" | "sub_os"` e campos `parent_ano`, `parent_nr_os`, `sub_os_id`, `componente_id`, `display_label`.

## Propagação de clique

- Botão **`+`/expandir**: `e.stopPropagation()` — só expande/recolhe.
- Linha Sub OS / OS principal: `handleSelectRow()` com `useTransition` — seleção imediata sem bloquear render.
- Context menu: `normalizeOsSelection()` antes de gravar no store.

## Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `apps/web/src/features/os/osTableRows.ts` | Chaves estáveis, cache de linhas Sub OS, `normalizeOsSelection`, `isParentOsInSearchResults` |
| `apps/web/src/features/os/osSelectionStore.ts` | Normaliza seleção ao gravar |
| `apps/web/src/features/os/components/OsOrdersTable.tsx` | Remove refetch agressivo; debounce 900 ms só após mudança real da lista; `useTransition` na seleção |
| `apps/web/src/features/os/components/OsHomePage.tsx` | Preserva seleção Sub OS enquanto OS pai estiver na página |
| `apps/web/src/features/os/components/OsDetailsPanel.tsx` | Loading menos agressivo; reutiliza cache de componentes |
| `apps/web/src/features/os/components/OsHistoryPanel.tsx` | Componentes só quando OS principal selecionada |
| `apps/web/src/features/os/components/OsContextMenu.tsx` | Seleção normalizada |
| `apps/web/src/api/hooks/useSubOs.ts` | `keepPreviousData`, remove refetch forçado no histórico Sub OS |
| `apps/web/src/features/os/types.ts` | Campo `kind` |
| `apps/web/src/features/os/osTableRows.test.ts` | Testes de chave e normalização |

**Backend:** sem alterações.

## Testes executados

| Comando | Resultado |
|---------|-----------|
| `pnpm build` | OK |
| `pnpm lint` | OK |
| `pnpm --filter @sagra/web test` | 55 passed |
| `python -m pytest app/backend/tests -q` | 108 passed |

## Pendências

- Homologação manual: expandir → 1 clique Sub OS → trocar Sub OS → voltar OS principal → WS durante seleção.
- Sub OS expandidas após WS atualizam com debounce de ~900 ms (não bloqueia clique; dados podem ficar alguns ms desatualizados até o fetch debounced).
