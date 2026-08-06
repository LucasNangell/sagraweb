# Relatório de Correção — Ordenação Lista Inicial de OSs

**Data:** 2026-06-09  
**Contexto:** regressão após otimização de `GET /api/os/search` ([`RELATORIO_OTIMIZACAO_LISTA_OS_IMPLEMENTACAO.md`](RELATORIO_OTIMIZACAO_LISTA_OS_IMPLEMENTACAO.md))

---

## 1. Causa da regressão

A ordenação default **permaneceu textualmente igual** à query antiga (`EntregData ASC` + CASE de prioridade), mas o comportamento visível mudou por dois motivos combinados:

1. **OSs `Normal` com `EntregData` NULL**  
   Com `ORDER BY p.EntregData ASC`, o MySQL agrupa todos os `NULL` no início do bloco “Normal” e desempata **apenas** por `AnoProtocolo DESC, NroProtocolo DESC`.  
   Resultado: OSs recentes (ex.: 1032/2026, 1031/2026) apareciam **antes** de OSs mais antigas ainda ativas — ordem invertida em relação à fila esperada por **data de cadastro**.

2. **Remoção do JOIN global de detalhes na query otimizada**  
   Antes, duplicatas em `tabDetalhesServico` podiam alterar quais linhas caíam no `LIMIT` antes do dedupe. Sem duplicatas, a paginação passou a refletir fielmente o `ORDER BY` SQL — expondo o problema do item 1.

**Prioridade (`Prometido` / `Solicitado` / `Normal`)** continuava correta; o desvio era principalmente na **segunda chave de ordenação** para OSs sem data de entrega.

---

## 2. Campo de prioridade

| Campo | Uso |
|-------|-----|
| **`p.EntregPrazoLink`** | Classificação: `Prometido p/`, `Solicitado p/`, `Normal` (e demais) |

Normalização aplicada:

```sql
TRIM(COALESCE(p.EntregPrazoLink, ''))
  LIKE 'Prometido p/%' OR = 'Prometido p/'  → rank 1
  LIKE 'Solicitado p/%' OR = 'Solicitado p/' → rank 2
  ELSE → rank 3 (Normal e demais)
```

---

## 3. Campo de data (segunda chave)

| Campo | Papel |
|-------|--------|
| **`p.EntregData`** | Data da coluna **“Data”** na lista e fila de Prometido/Solicitado (data de entrega/prazo) — **comportamento legado mantido** quando preenchida |
| **`p.DataEntrada`** | **Data de cadastro/criação** da OS — fallback quando `EntregData` é NULL (típico em OS `Normal`) |

**Decisão:** não substituir `EntregData` por `DataEntrada` em todos os casos (alteraria ordem de Solicitado com datas distintas). Usar:

```sql
COALESCE(p.EntregData, p.DataEntrada)
```

Isso restaura a fila cronológica para OSs Normal sem quebrar Prometido/Solicitado.

---

## 4. ORDER BY final (default, sem `sort_by`)

```sql
ORDER BY
  CASE
    WHEN TRIM(COALESCE(p.EntregPrazoLink, '')) LIKE 'Prometido p/%'
      OR TRIM(COALESCE(p.EntregPrazoLink, '')) = 'Prometido p/' THEN 1
    WHEN TRIM(COALESCE(p.EntregPrazoLink, '')) LIKE 'Solicitado p/%'
      OR TRIM(COALESCE(p.EntregPrazoLink, '')) = 'Solicitado p/' THEN 2
    ELSE 3
  END ASC,
  COALESCE(p.EntregData, p.DataEntrada) ASC,
  p.AnoProtocolo DESC,
  p.NroProtocolo DESC
```

- **`sort_by` vazio:** usa o bloco acima (via `OS_SEARCH_DEFAULT_ORDER`).
- **`sort_by` definido:** ordena pela coluna escolhida + desempate `AnoProtocolo DESC, NroProtocolo DESC` (sem forçar prioridade).
- **`sort_by=prioridade`:** usa o mesmo CASE + data + desempate (ASC/DESC conforme `sort_dir`).

---

## 5. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `app/backend/services/os_search_service.py` | Helpers `_os_search_priority_rank_sql`, `_os_search_default_date_sql`, `_os_search_stable_tiebreak_sql`; ORDER BY default corrigido |
| `app/backend/services/os_sub_os_queries.py` | Fila Sub OS alinhada ao mesmo ORDER BY |
| `app/backend/tests/test_os_ultimo_andamento_search.py` | Testes de fragmentos SQL de ordenação |

**Preservado:** tabela materializada, sem `ROW_NUMBER()` global, COUNT adiado, WebSocket, filtros, paginação `has_next`.

---

## 6. Comparação antes/depois (lista ativa, OS &lt; 5000)

| Posição | Antes (regressão) | Depois (corrigido) |
|---------|-------------------|---------------------|
| 1–9 | Solicitado por `EntregData` ✓ | Igual ✓ |
| 10 | 1032/2026 Normal | **98/2013 Normal** (por `DataEntrada`) |
| 11 | 1031/2026 Normal | **2080/2023 Normal** |
| 12 | 1030/2026 Normal | **313/2024 Normal** |

Prometido continua rank 1 quando existir na lista ativa (hoje 0 registros ativos com Prometido no ambiente medido).

---

## 7. Performance (não regressão)

| Cenário | Tempo pós-correção |
|---------|-------------------|
| Abertura default | **~501 ms** (mantido &lt; 1 s) |
| nr_os + ano | **~30 ms** |

Sem retorno à query pesada (~7,5 s).

---

## 8. Testes executados

| Comando | Resultado |
|---------|-----------|
| `python -m pytest app/backend/tests -q` | **193 passed** |
| `python -m pytest tests/test_os_ultimo_andamento_search.py tests/test_os_search_security.py -q` | **16 passed** |
| `pnpm build` | ✅ |
| `pnpm lint` | Placeholder (eslint pendente Fase 0) |

Casos cobertos nos testes:

- Fragmentos SQL: prioridade 1/2/3, `COALESCE(EntregData, DataEntrada)`, desempate ano/nr.
- Paginação simples sem COUNT.
- Join legado exportado para testes existentes.

---

## 9. Verificação manual recomendada

1. Abrir lista sem sort manual → Solicitado antes de Normal; Normal em ordem cronológica de cadastro.
2. Clicar coluna (ex. Nr OS) → sort manual; limpar sort → volta ao default.
3. Paginar páginas 1 e 2 → sem repetir/pular OS.
4. Filtro setor/situação → mesma ordem default.
