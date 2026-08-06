# Relatório — Otimização dos Filtros Textuais da Lista de OSs

**Data:** 2026-06-11  
**Referências:**

- [`RELATORIO_OTIMIZACAO_LISTA_OS_1M_IMPLEMENTACAO.md`](RELATORIO_OTIMIZACAO_LISTA_OS_1M_IMPLEMENTACAO.md)
- [`RELATORIO_AUDITORIA_LISTA_OS_FILTROS_PAGINACAO.md`](RELATORIO_AUDITORIA_LISTA_OS_FILTROS_PAGINACAO.md)

---

## 1. Veredito

**Corrigido com ressalvas.**

Filtros textuais (Produto, Título, Solicitante) passaram de `LIKE '%termo%'` (full scan, minutos em 1M+ registros) para **FULLTEXT BOOLEAN MODE** com índices dedicados. Em homologação (~84k detalhes), p50 ficou entre **~18 ms e ~132 ms** — meta &lt; 1 s atingida.

**Ressalvas:**

- Índices FULLTEXT devem ser criados em **janela de manutenção** em produção 1M+ (`deploy/sql/create_os_text_search_indexes.sql`).
- Sem índices, filtros produto/título são **ignorados** (não executam busca lenta) — exceto com `OS_SEARCH_ALLOW_SLOW_TEXT_FALLBACK=1`.
- Solicitante sem FULLTEXT usa fallback **prefixo** `LIKE 'termo%'` (indexável).
- Stopwords e `innodb_ft_min_token_size` podem afetar termos muito curtos.

---

## 2. Causa da lentidão

| Fator | Impacto |
|-------|---------|
| `LIKE '%termo%'` em `tabDetalhesServico.Titulo` / `TipoPublicacaoLink` | **Crítico** — não usa índice B-tree |
| `LIKE '%termo%'` em `tabProtocolos.NomeUsuario` | **Crítico** |
| `EXISTS` correlacionado com LIKE interno | **Alto** — por cada protocolo candidato |
| Escala 1M+ registros | Minutos de varredura |

### Auditoria do código anterior

| Campo | Tabela.coluna | Mecanismo antigo |
|-------|---------------|------------------|
| Produto | `tabDetalhesServico.TipoPublicacaoLink` | `EXISTS` + `LIKE %(produto)s` |
| Título | `tabDetalhesServico.Titulo` | `EXISTS` + `LIKE %(titulo)s` |
| Solicitante | `tabProtocolos.NomeUsuario` | `LIKE %(solicitante)s` |

Detalhes para exibição: batch `IN (...)` pós-paginação (inalterado).

---

## 3. Solução implementada

### 3.1 Normalização (`os_text_search_utils.py`)

- Trim e colapso de espaços
- Mínimo 3 caracteres (salvo nr_os/ano)
- `build_fulltext_boolean_query`: `"cartao visita"` → `"+cartao* +visita*"`
- Escape de caracteres booleanos (`+`, `-`, `@`, etc.)
- Stopwords PT comuns ignoradas

### 3.2 Índices FULLTEXT (`os_text_search_indexes_schema.py`)

| Índice | Tabela | Coluna(s) |
|--------|--------|-----------|
| `ft_detalhes_titulo` | `tabDetalhesServico` | `Titulo` |
| `ft_detalhes_produto` | `tabDetalhesServico` | `TipoPublicacaoLink` |
| `ft_protocolos_solicitante` | `tabProtocolos` | `NomeUsuario` |

Startup: `ensure_os_text_search_indexes()` em `api.py`  
Config: `SAGRA_AUTO_CREATE_FULLTEXT_INDEXES=true` (default) — `false` em produção grande + SQL manual.

### 3.3 Backend (`os_search_service.py`)

**Produto / Título** (FULLTEXT disponível):

```sql
EXISTS (
  SELECT 1 FROM tabDetalhesServico d_f
  WHERE d_f.NroProtocoloLinkDet = p.NroProtocolo
    AND d_f.AnoProtocoloLinkDet = p.AnoProtocolo
    AND MATCH(d_f.Titulo) AGAINST (%(ft_titulo)s IN BOOLEAN MODE)
    AND MATCH(d_f.TipoPublicacaoLink) AGAINST (%(ft_produto)s IN BOOLEAN MODE)
)
```

Campos separados quando só um filtro preenchido.

**Solicitante:**

```sql
MATCH(p.NomeUsuario) AGAINST (%(ft_solicitante)s IN BOOLEAN MODE)
```

Fallback sem FULLTEXT: `NomeUsuario LIKE 'termo%' ESCAPE '\\'`.

**Fallback lento:** `LIKE '%termo%'` só com `OS_SEARCH_ALLOW_SLOW_TEXT_FALLBACK=1`.

**Preservado:** materializada, paginação simples, ordenação prioridade, Sub OS, driver setor/situação.

Meta `text_search_modes` na resposta (ex.: `["detalhes:fulltext","solicitante:fulltext"]`).

### 3.4 Front-end

| Ajuste | Arquivo |
|--------|---------|
| Debounce texto **450 ms** | `OsHomePage.tsx` |
| Não envia termos &lt; 3 chars (sem nr/ano) | `osSearchUtils.ts` |
| Hint "Digite pelo menos 3 caracteres…" | `filterStatus.ts` |
| `keepPreviousData` / staleTime 30s | `useOsSearch.ts` (já existente) |

---

## 4. Queries antigas vs novas

### Antes (produto)

```sql
AND EXISTS (
  SELECT 1 FROM tabDetalhesServico d_f
  WHERE d_f.NroProtocoloLinkDet = p.NroProtocolo
    AND d_f.AnoProtocoloLinkDet = p.AnoProtocolo
    AND d_f.TipoPublicacaoLink LIKE '%folder%'
)
```

### Depois (produto)

```sql
AND EXISTS (
  SELECT 1 FROM tabDetalhesServico d_f
  WHERE ...
    AND MATCH(d_f.TipoPublicacaoLink) AGAINST ('+folder*' IN BOOLEAN MODE)
)
```

### Antes (solicitante)

```sql
AND p.NomeUsuario LIKE '%Silva%'
```

### Depois (solicitante)

```sql
AND MATCH(p.NomeUsuario) AGAINST ('+Silva*' IN BOOLEAN MODE)
```

---

## 5. Índices criados

| Tabela | Índice | Aplicado homologação |
|--------|--------|----------------------|
| `tabDetalhesServico` | `ft_detalhes_titulo` | ✅ (~13 s criação) |
| `tabDetalhesServico` | `ft_detalhes_produto` | ✅ |
| `tabProtocolos` | `ft_protocolos_solicitante` | ✅ |

Engine confirmada: **InnoDB**, collation `utf8mb4_general_ci`.

---

## 6. Performance antes/depois

Ambiente: MySQL `sagrafulldb` @ 10.1.1.73, ~84k protocolos / ~83k detalhes, 2026-06-11.

| Cenário | LIKE `%x%` (ref.) | FULLTEXT p50 | Meta |
|---------|-------------------|--------------|------|
| Título `relat` | **~347 ms** (1 run, 84k) | **~44–57 ms** | &lt; 1 s ✅ |
| Título `cartao` | — | **~35 ms** | ✅ |
| Produto `folder` | — | **~64–104 ms** | ✅ |
| Produto `impresso` | — | **~131 ms** | ✅ |
| Solicitante `Silva` | — | **~18–20 ms** | ✅ |
| Título + setor | — | **~24–31 ms** | ✅ |
| Produto + situação | — | **~45–56 ms** | ✅ |
| Solicitante + prioridade | — | **~34–53 ms** | ✅ |

**Projeção 1M+:** LIKE tende a **minutos**; FULLTEXT escala com índice invertido — esperado **&lt; 1–2 s** após criação dos índices.

Comando: `python scripts/benchmark_os_text_search.py`

Referência LIKE: `BENCHMARK_INCLUDE_SLOW_LIKE=1 python scripts/benchmark_os_text_search.py`

**Abertura inicial / dropdowns:** re-benchmark `scripts/benchmark_os_search.py` — sem regressão (~324 ms abertura).

---

## 7. WebSocket e tempo real

- Materializada atualizada **antes** do WS (inalterado).
- Refetch da lista com filtro textual usa **mesma query FULLTEXT**.
- `staleTime` 30s + invalidação por `system_update` — situação/setor atualizam no refetch/patch.
- Sem cache HTTP (`no-store`).

---

## 8. Testes executados

| Comando | Resultado |
|---------|-----------|
| `python -m pytest app/backend/tests -q` | **320 passed** |
| `tests/test_os_text_search.py` | 14 cenários FULLTEXT/fallback |
| `pnpm exec vitest run src/features/os/osSearchUtils.test.ts` | ✅ |
| `python scripts/benchmark_os_text_search.py` | ✅ §6 |

---

## 9. Riscos e ressalvas

| Risco | Mitigação |
|-------|-----------|
| Criação FULLTEXT bloqueia tabela grande | SQL manual em janela; `SAGRA_AUTO_CREATE_FULLTEXT_INDEXES=false` |
| Stopwords (`da`, `de`) | Tokens ignorados na query booleana |
| Termos &lt; 3 chars | Front + backend não disparam busca pesada |
| Acentos (`camara` vs `Câmara`) | `utf8mb4_general_ci` + wildcard `*` |
| FULLTEXT não encontra substring interna | Aceitável; fallback lento só com flag explícita |
| Índices ausentes em deploy | Filtros produto/título ignorados + log warning |

---

## 10. Como validar em produção

1. **Janela de manutenção:** executar `deploy/sql/create_os_text_search_indexes.sql`  
   Ou: `SAGRA_AUTO_CREATE_FULLTEXT_INDEXES=true` no primeiro startup (monitorar tempo).
2. Reiniciar backend.
3. `python scripts/diag_text_search_schema.py` — confirmar 3 índices FULLTEXT.
4. `python scripts/benchmark_os_text_search.py` — p50 &lt; 1 s.
5. UI: filtrar Título `relat`, Produto `folder`, Solicitante parcial.
6. Campo com 2 caracteres — hint aparece, sem request pesado.
7. Alterar andamento de OS na lista filtrada — WS atualiza situação em &lt; 1 s.
8. Abertura sem filtro — continua rápida.
9. Dropdowns situação/setor/prioridade — sem regressão.

**Rollback emergência:** não remover índices; definir `OS_SEARCH_ALLOW_SLOW_TEXT_FALLBACK=1` apenas se inevitável (lento).

---

## 11. Arquivos alterados

| Arquivo | Mudança |
|---------|---------|
| `app/backend/services/os_text_search_utils.py` | **Novo** — normalização FULLTEXT |
| `app/backend/os_text_search_indexes_schema.py` | **Novo** — DDL idempotente |
| `app/backend/services/os_search_service.py` | FULLTEXT + fallback controlado |
| `app/backend/routers/api.py` | Startup índices FULLTEXT |
| `deploy/sql/create_os_text_search_indexes.sql` | **Novo** |
| `scripts/benchmark_os_text_search.py` | **Novo** |
| `scripts/diag_text_search_schema.py` | **Novo** |
| `app/backend/tests/test_os_text_search.py` | **Novo** |
| `apps/web/src/features/os/osSearchUtils.ts` | Mínimo 3 chars |
| `apps/web/src/features/os/filterStatus.ts` | Hint UX |
| `apps/web/src/features/os/components/OsHomePage.tsx` | Debounce 450 ms |

---

*Implementação medida em homologação. Otimizações anteriores (materializada, dropdowns, paginação, WebSocket) preservadas.*
