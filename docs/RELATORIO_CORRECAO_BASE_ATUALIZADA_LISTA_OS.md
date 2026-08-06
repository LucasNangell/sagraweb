# Relatório — Correção Base Atualizada da Lista de OSs

**Data:** 2026-06-10  
**Referências:**  
- [`AUDITORIA_PAGINA_INICIAL_ATUALIZACAO_LISTA_OS.md`](AUDITORIA_PAGINA_INICIAL_ATUALIZACAO_LISTA_OS.md)  
- [`RELATORIO_CORRECAO_PAGINA_INICIAL_LISTA_OS.md`](RELATORIO_CORRECAO_PAGINA_INICIAL_LISTA_OS.md)

---

## 1. Problema observado

1. **OS 5954/2026** — lista exibia `Em Execução`, histórico mostrava último andamento real `Aguard. Juntada` (10/06/2026).
2. **OSs até 5962/2026** existem em `tabProtocolos`, mas a lista parecia parar em **5956** (especialmente com situação visível preenchida).

---

## 2. Evidência quantitativa

| Fonte | Maior OS 2026 |
|-------|----------------|
| `tabProtocolos` | **5962** |
| `tab_os_ultimo_andamento_operacional` | **5957** |
| `/api/os/search` (antes da correção híbrida, nr desc) | 5962 com `situacao` NULL em 5958–5962 |

**OSs em `tabProtocolos` sem linha materializada (2026):** 5962, 5961, 5960, 5959, 5958, 1034, 1033, 448.

---

## 3. Evidência: situação antiga (5954/2026)

| Fonte | Situação | Data | CodStatus |
|-------|----------|------|-----------|
| `tabAndamento` (live, UltimoStatus=1) | **Aguard. Juntada** | 2026-06-10 | 059542026-07 |
| Materializada | Em Execução (stale) | 2026-06-09 22:47 | 059542026-06 |
| `/api/os/search` (antes) | Em Execução | — | — |
| `/api/os/search` (depois) | **Aguard. Juntada** | 2026-06-10 | — |

---

## 4. Diagnóstico comparativo (OS 5954–5962)

| OS | tabProtocolos | Último tabAndamento | Materializada | Situação search (antes) | Situação search (depois) | Motivo divergência (antes) |
|----|---------------|---------------------|---------------|-------------------------|--------------------------|----------------------------|
| 5954 | Sim | Aguard. Juntada / SEFOC | Em Execução (stale) | Em Execução | **Aguard. Juntada** | Materializada desatualizada |
| 5955 | Sim | Entregue | Entregue | Entregue | Entregue | OK |
| 5956 | Sim | Gravação | Gravação | Gravação | Gravação | OK |
| 5957 | Sim | Saída p/ / Expedição | Recebido (stale) | Recebido | **Saída p/** | Materializada desatualizada |
| 5958 | Sim | Aguard. Aprovação | **Ausente** | NULL | **Aguard. Aprovação** | Sem materialização + sem fallback live |
| 5959 | Sim | Aguard. Aprovação | **Ausente** | NULL | **Aguard. Aprovação** | Idem |
| 5960 | Sim | Aguard. Aprovação | **Ausente** | NULL | **Aguard. Aprovação** | Idem |
| 5961 | Sim | Aguard. Aprovação | **Ausente** | NULL | **Aguard. Aprovação** | Idem |
| 5962 | Sim | Aguard. Aprovação | **Ausente** | NULL | **Aguard. Aprovação** | Idem |

Script de diagnóstico: `scripts/diag_lista_os_2026.py`

---

## 5. Causa raiz

1. **`GET /api/os/search` usava somente `tab_os_ultimo_andamento_operacional`** para situação/setor/data quando a tabela estava populada.
2. **Materializada desatualizada** — andamentos registrados via sync/importação ou após falha de refresh não atualizavam a linha (ex.: 5954, 5957).
3. **OSs novas sem linha materializada** (5958–5962) — importadas em `tabProtocolos` sem `refresh_os_ultimo_andamento_operacional`; a busca retornava `situacao` NULL em vez do andamento live.
4. **Ordenação default da home** (prioridade + data) não lista por `nr_os desc` — OSs 5958–5962 não aparecem na primeira página sem ordenar por número; com `sort_by=nr_os&sort_dir=desc` já apareciam, mas com situação vazia.

**Fluxos de escrita:** `save_os` e andamentos via API chamam `_broadcast_os_system_update` → `refresh_materialized_os_operacional`. **Sync MDB/MySQL** (`sync_andamentos_v2`, `sync_tabprotocolos_*`) **não** chama refresh da materializada — explica OS 5958–5962.

---

## 6. Fonte oficial definida para a lista

| Dado | Fonte oficial |
|------|----------------|
| Existência da OS | `tabProtocolos` (FROM principal) |
| Último andamento | `tabAndamento` (ranking operacional: UltimoStatus DESC, Data DESC, CodStatus DESC, excl. espelhos) |
| Otimização | `tab_os_ultimo_andamento_operacional` — cache, **não** fonte exclusiva |

---

## 7. Estratégia adotada (Opção A — híbrida)

**Materializada + fallback live em SQL**, sem remover a tabela materializada:

- `LEFT JOIN tab_os_ultimo_andamento_operacional AS a`
- `LEFT JOIN` subquery legacy `a_legacy` (último andamento operacional em `tabAndamento`)
- Expressão `CASE` escolhe live quando:
  - não há materialização;
  - andamento live é mais recente (`Data` ou `CodStatus` com collation `utf8mb4_general_ci`);
  - caso contrário usa materializada (performance quando coerente).

Aplicado em **SELECT**, **filtros** (`include_finished`, setor/situação) e **ordenação por situação/setor**.

---

## 8. Como OSs novas passam a aparecer

- Continuam partindo de `tabProtocolos` — nunca excluídas por ausência na materializada.
- Situação/setor/data vêm do `tabAndamento` via `a_legacy` quando materializada ausente.
- Com `sort_by=nr_os&sort_dir=desc`, 5962–5958 retornam com `Aguard. Aprovação` preenchido.

**Recomendação futura (P2):** chamar `refresh_os_ultimo_andamento_operacional` após sync de protocolos/andamentos — fora do escopo desta correção mínima.

---

## 9. Como último andamento passa a ser correto

Para cada OS na página de resultados, situação/setor/data/observação usam a expressão híbrida que **prefere `tabAndamento` quando mais recente**.

Validado em produção/homologação (MySQL `sagrafulldb`):

- 5954 → `Aguard. Juntada` / SEFOC / 2026-06-10
- 5957 → `Saída p/` / Expedição
- 5962 → `Aguard. Aprovação` / SEFOC

Alinhado ao endpoint de histórico (`tabAndamento`, UltimoStatus=1).

---

## 10. Cache / refetch validado

| Camada | Status |
|--------|--------|
| `Cache-Control: no-store` em `/api/os/search` | Mantido |
| PWA Service Worker | `NetworkOnly` para `/api/` |
| TanStack Query polling 60s | Mantido (correção anterior) |
| WebSocket | Mantido |
| Cache PCP (`/pcp/queue`) | **Não alterado** |

---

## 11. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `app/backend/services/os_search_service.py` | Join híbrido + expressões CASE + collation |
| `app/backend/tests/test_os_ultimo_andamento_search.py` | Testes híbridos |
| `scripts/diag_lista_os_2026.py` | Script diagnóstico (novo) |

**Frontend:** sem alterações nesta etapa (correção é backend).

---

## 12. Testes criados/alterados

- `TestOsSearchHybridAndamento` — join híbrido e expressões
- `test_hybrid_active_filter_allows_null_or_non_finished` — filtro ativo
- Testes anteriores (`exact_os_lookup`, NULL, finished) preservados

---

## 13. Comandos executados

```bash
python scripts/diag_lista_os_2026.py
python -m pytest app/backend/tests/test_os_ultimo_andamento_search.py -q
pnpm test:backend
pnpm test:frontend
pnpm build
pnpm lint
pnpm typecheck
```

---

## 14. Resultado dos comandos

| Comando | Resultado |
|---------|-----------|
| Diagnóstico 2026 | Confirmou divergências e validou correção |
| pytest (search) | **16 passed** |
| `pnpm test:backend` | **223 passed** |
| `pnpm test:frontend` | **124 passed** |
| `pnpm build` | **OK** |
| `pnpm lint` | **OK** |
| `pnpm typecheck` | **FALHOU** — TS6310 pré-existente |

---

## 15. Riscos remanescentes

1. **Performance** — join híbrido reintroduz subquery `ROW_NUMBER()` em `tabAndamento` quando materializada está populada; trade-off aceito por correção operacional.
2. **Materializada ainda pode ficar stale no disco** — leitura correta via híbrido; refresh assíncrono em sync MDB permanece melhoria futura.
3. **Ordenação default** — OSs 5958–5962 não aparecem na página 1 sem ordenar por `nr_os desc` (comportamento esperado de fila por prioridade/data).
4. **Collation** — comparação `CodStatus` usa `utf8mb4_general_ci` explicitamente.

---

## 16. Checklist manual

- [ ] Limpar filtros na home
- [ ] Ordenar coluna **Nr OS** descendente
- [ ] Confirmar 5962, 5961, 5960, 5959, 5958 com situação `Aguard. Aprovação`
- [ ] Buscar **5954/2026** — situação `Aguard. Juntada`
- [ ] Comparar com painel histórico inferior
- [ ] Buscar **5957/2026** — `Saída p/`
- [ ] Botão Atualizar + reload + aguardar 60s polling
- [ ] Painel setor (`/painel/setor`) inalterado
- [ ] Filtros setor/situação continuam funcionando
- [ ] `exact_os_lookup` com Nr OS preenchido

---

## Resumo técnico

A lista agora resolve situação/setor/data com **híbrido materializada + tabAndamento live**, garantindo que o que o usuário vê corresponde ao último andamento real, mesmo quando a materializada está ausente ou desatualizada. A existência da OS continua ancorada em `tabProtocolos`.
