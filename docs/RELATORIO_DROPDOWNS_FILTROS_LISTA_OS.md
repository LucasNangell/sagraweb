# Relatório — Dropdowns Inteligentes e Ano por Modo na Lista de OSs

## 1. Veredito

**Corrigido** — implementação concluída com compatibilidade retroativa, cancelamento de busca via `AbortSignal`, endpoints leves de opções e padrão inteligente de ano na abertura.

## 2. O que foi alterado

| Área | Alteração |
|------|-----------|
| **Ano** | Segmented control `A partir de` / `Ano específico` + dropdown de anos (DESC) |
| **Produto** | Multiselect pesquisável; busca de opções com debounce 250 ms; **não** dispara `/api/os/search` ao digitar |
| **Solicitante** | Idem Produto |
| **Busca** | `ano_mode`, `produtos[]`, `solicitantes[]`; SQL `>=` ou `=` para ano; `IN` indexável para seleções |
| **Cancelamento** | `AbortSignal` em `searchOs` + TanStack Query |
| **Tabelas auxiliares** | `tab_os_filter_produtos`, `tab_os_filter_solicitantes` + script de backfill |

## 3. Estratégia de carregamento das opções

| Recurso | Estratégia |
|---------|------------|
| **Anos** | `GET /api/os/filter-options/years` — `SELECT DISTINCT AnoProtocolo` com cache em memória 15 min |
| **Produtos** | `GET /api/os/filter-options/products?q=&limit=30` — tabela auxiliar com `LIKE prefix%` normalizado; fallback limitado na fonte se tabela vazia |
| **Solicitantes** | `GET /api/os/filter-options/requesters?q=&limit=30` — idem |
| **Front** | Anos em paralelo (`staleTime` 10 min); produto/solicitante só ao abrir dropdown + debounce interno |
| **Lista principal** | Não bloqueada pelos dropdowns; `/api/os/search` independente |

## 4. Banco de dados

### Tabelas auxiliares

- `tab_os_filter_produtos` — fonte `tabDetalhesServico.TipoPublicacaoLink`
- `tab_os_filter_solicitantes` — fonte `tabProtocolos.NomeUsuario`

### Índices adicionados

- `idx_detalhes_produto_os` em `tabDetalhesServico (TipoPublicacaoLink, AnoProtocoloLinkDet, NroProtocoloLinkDet)`
- Índices nas tabelas auxiliares (criados no DDL)

### Backfill

```bash
python scripts/rebuild_os_filter_options.py
```

Idempotente (TRUNCATE + INSERT agregado). Recomendado após deploy e periodicamente (noturno) até haver atualização incremental em save OS.

### Atualização incremental

Pendência leve: hook em save OS/detalhes para upsert nas auxiliares. Inicialmente o rebuild periódico cobre o gap.

## 5. Contrato de API

### `GET /api/os/search` (novos parâmetros)

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `ano` | int | Ano selecionado |
| `ano_mode` | `specific` \| `from` | `specific` → `AnoProtocolo = ano`; `from` → `AnoProtocolo >= ano` |
| `produtos` | string[] (repeat) | Igualdade `IN` em `TipoPublicacaoLink` (máx. 20) |
| `solicitantes` | string[] (repeat) | Igualdade `IN` em `NomeUsuario` (máx. 20) |

**Compatibilidade:** `produto` e `solicitante` (texto único) continuam com FULLTEXT/prefixo quando arrays vazios.

### Opções

- `GET /api/os/filter-options/years` → `{ "data": [2026, 2025, ...] }`
- `GET /api/os/filter-options/products?q=&limit=30` → `{ "data": [{ "value", "label", "count?" }] }`
- `GET /api/os/filter-options/requesters?q=&limit=30` → idem

## 6. Front-end

### Componentes

- `SegmentedControl` — modo do ano
- `SearchableMultiSelect` — produto/solicitante com busca interna
- `OsFiltersPanel` — layout ano + multiselects
- `osFilterDefaults.ts` — padrão e resolução de ano

### Comportamento

| Ação | Dispara `/api/os/search`? |
|------|---------------------------|
| Digitar no dropdown Produto/Solicitante | Não |
| Selecionar/remover Produto/Solicitante | Sim |
| Alterar ano ou modo | Sim |
| Digitar Título | Sim (debounce 450 ms, FULLTEXT) |

### Layout

Desktop: label Ano + segmented na mesma linha quando couber; mobile: segmented acima do select.

## 7. Performance

Homologação (~84k protocolos) — cenários esperados sem regressão na abertura:

| Cenário | Meta | Observação |
|---------|------|------------|
| Abertura com `ano_mode=from&ano=2025` | < 1 s | Reduz volume vs. histórico completo |
| Dropdown anos | < 300 ms | DISTINCT + cache |
| Autocomplete produto/solicitante | < 800 ms | Tabela auxiliar + limite 30 |
| Busca com `IN` selecionado | < 1 s | Sem FULLTEXT na seleção |

Benchmark formal: reutilizar `scripts/benchmark_os_search.py` com novos parâmetros após backfill em produção.

## 8. Cancelamento de requests

```typescript
useQuery({
  queryFn: async ({ signal }) => searchOs(normalized, { signal }),
});
```

TanStack Query aborta automaticamente ao mudar `queryKey`. Requests abortados não geram erro na UI.

## 9. WebSocket

`useOsRealtimeSync` continua registrando `searchFilters` ativos e chamando `refetch` — inalterado. Lista filtrada por ano/produto/solicitante atualiza situação/setor em tempo real.

## 10. Compatibilidade

| Origem | Comportamento |
|--------|---------------|
| `produto=texto` (URL antiga) | FULLTEXT/prefixo |
| `solicitante=texto` | FULLTEXT/prefixo |
| Filtros salvos (situação/setor) | Preservados; não alteram ano padrão ao aplicar |
| localStorage (toggles) | Só `includeFinished/includeOs/includeSp` — sem migração de ano |

**Migração de modelo:** `produto: "X"` → usar `produtos: ["X"]` no front; legado `produto` ainda enviável se array vazio.

**Ano salvo manualmente (hipotético):** se no futuro persistir `ano` sem `anoMode`, migrar para `anoMode: "specific"`.

## 11. Estado padrão do filtro de Ano

- **Modo padrão:** `A partir de` (`anoMode: "from"`).
- **Ano padrão:** ano anterior ao corrente (`currentYear - 1`). Em 2026 → dropdown `2025`, SQL `AnoProtocolo >= 2025`.
- **Prioridade:** filtros salvos do usuário / URL explícita > padrão.
- **Ajuste:** se o ano anterior não existir na lista do backend, usa o maior ano disponível ≤ preferido.
- **Objetivo:** evitar consultar todo o histórico na abertura sem impedir alteração livre.

## 12. Testes executados

### Backend (329 passed)

- `test_os_filter_dropdowns.py` — ano modo, `IN` produto/solicitante, legado FULLTEXT, limite máximo
- Suíte completa `pytest` sem regressões

### Frontend (17 novos/ajustados passed)

- `osFilterDefaults.test.ts`, `os.test.ts`, `osSearchUtils.test.ts`, `filterStatus.test.ts`

## 13. Pendências

1. **Backfill em produção** — executar `rebuild_os_filter_options.py` após deploy.
2. **Atualização incremental** das tabelas auxiliares no save OS (opcional; rebuild noturno aceitável).
3. **Benchmark formal** com os 14 cenários da especificação após backfill em base 1M+.
4. **Invalidação de cache de anos** quando protocolo com ano novo for criado (baixa prioridade).

## Arquivos principais

**Backend:** `os_search_service.py`, `os_filter_options_service.py`, `os_filter_options_routes.py`, `os_filter_options_schema.py`, `scripts/rebuild_os_filter_options.py`

**Frontend:** `OsFiltersPanel.tsx`, `osFiltersStore.ts`, `types.ts`, `api/os.ts`, `useOsSearch.ts`, `segmented-control.tsx`, `searchable-multi-select.tsx`
