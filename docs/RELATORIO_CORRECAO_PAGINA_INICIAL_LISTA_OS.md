# Relatório de Correção — Página Inicial: Lista de OSs

**Data:** 2026-06-10  
**Referência:** [`AUDITORIA_PAGINA_INICIAL_ATUALIZACAO_LISTA_OS.md`](AUDITORIA_PAGINA_INICIAL_ATUALIZACAO_LISTA_OS.md)

---

## 1. Problema corrigido

A lista principal da página inicial (`GET /api/os/search`) não localizava OSs visíveis no painel do setor e não se atualizava de forma confiável quando eventos WebSocket eram perdidos.

---

## 2. Causa raiz

Combinação de fatores confirmados na auditoria:

1. **Filtro SQL com materializada:** `situacao NOT IN (...)` excluía OSs com `situacao NULL` (sem linha em `tab_os_ultimo_andamento_operacional`).
2. **Filtros default do usuário** aplicados na home, ausentes no painel.
3. **Busca por Nr OS** ainda sujeita a filtros de setor/situação/prioridade no backend.
4. **Ausência de polling de segurança** na query principal — dependência exclusiva de WebSocket.

---

## 3. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `app/backend/services/os_search_service.py` | Filtro NULL + `exact_os_lookup` |
| `app/backend/routers/os_routes.py` | Parâmetro `exact_os_lookup` |
| `app/backend/tests/test_os_ultimo_andamento_search.py` | Testes atualizados/novos |
| `apps/web/src/features/os/types.ts` | Campo `exactOsLookup` |
| `apps/web/src/features/os/osSearchUtils.ts` | Lookup exato + normalização |
| `apps/web/src/api/os.ts` | Query param `exact_os_lookup` |
| `apps/web/src/api/hooks/useOsSearch.ts` | Polling 60 s |
| `apps/web/src/features/os/filterStatus.ts` | Hint de busca exata |
| `apps/web/src/features/os/osSearchUtils.test.ts` | Novo |
| `apps/web/src/features/os/filterStatus.test.ts` | Novo |
| `apps/web/src/api/hooks/useOsSearch.test.ts` | Novo |
| `apps/web/src/api/os.test.ts` | Novo |

**Não alterados (já corretos):**

- `app/backend/routers/pcp_routes.py` — painel intacto
- `apps/web/src/features/os/components/OsHomePage.tsx` — botão Atualizar e bootstrap já funcionais; hints via `filterStatus`

---

## 4. Alterações backend

### 4.1 Filtro `situacao NULL` (Parte 1)

Unificado o ramo materializado e legacy para:

```sql
(situacao IS NULL OR situacao NOT IN ('Entregue', 'Cancelada', 'Cancelado'))
```

`NULL` passa a significar **ausência de status materializado**, não OS finalizada.

### 4.2 `exact_os_lookup` (Parte 3)

Novo parâmetro `exact_os_lookup: bool = False` em `execute_os_search` e `GET /os/search`.

Quando `exact_os_lookup=true` **e** `nr_os` informado:

- Ignora filtros de `situacao`, `setor`, `prioridade`
- Ignora toggles `include_os` / `include_sp`
- Mantém `include_finished` (entregues/canceladas continuam excluídas por padrão)
- Mantém filtros textuais opcionais (`ano`, `produto`, `titulo`, `solicitante`)

**Decisão:** Opção B (backend com parâmetro explícito) — compatível com clientes legados; frontend envia `exact_os_lookup=true` quando `nrOs` está preenchido.

### 4.3 Materialização após andamento (Parte 2)

**Auditoria:** não foi necessária alteração de código.

Fluxos existentes já chamam `broadcast_os_system_update` → `refresh_materialized_os_operacional` → `refresh_os_ultimo_andamento_operacional`:

- `add_os_history`, `update_os_history`, `delete_os_history`, `replicate_history`
- `save_os`, `duplicate_os`
- `recalc_ultimo_status_operacional` (exclusão de andamento)
- Rotas de análise, e-mail, prova, arquivos, Sub OS

---

## 5. Alterações frontend

### 5.1 Lookup exato

`buildOsHomeSearchFilters` define `exactOsLookup: true` quando `nrOs` está preenchido e força `page: 1`.

### 5.2 Polling de segurança (Parte 4)

`useOsSearch`:

```ts
refetchInterval: 60_000,
refetchIntervalInBackground: false,
```

WebSocket permanece como canal rápido; polling só quando a aba está visível e query habilitada.

### 5.3 UI de filtros (Parte 6)

`getExactOsLookupHint` adiciona mensagem nos hints implícitos:

> "busca por Nr OS ignora filtros de situação, setor e prioridade"

Filtros default do perfil continuam aplicados no bootstrap; indicador "Filtro: {nome}" já existente. Botão Limpar chama `resetFilters()` sem reaplicar defaults (`homeDefaultPrefsApplied` impede re-bootstrap).

---

## 6. Divergência materializada vs painel

| Antes | Depois |
|-------|--------|
| Lista excluía OS sem linha materializada | Lista inclui OS com `situacao NULL` na busca ativa |
| Painel lia `tabAndamento` diretamente | Painel **inalterado** |
| Gap entre fontes | Reduzido — OS ativa sem materialização aparece na lista |

Divergência residual possível se materializada estiver **desatualizada** (situacao/setor errados mas não NULL). Mitigado pelo refresh incremental existente + polling de segurança.

---

## 7. Caso `situacao NULL`

Documentado no código: NULL = sem status operacional materializado, **não** finalizado. Comportamento alinhado ao ramo legacy que já usava `IS NULL OR`.

---

## 8. Busca por OS específica

- Frontend: `exactOsLookup` automático com `nrOs` preenchido
- Backend: `exact_os_lookup=true` ignora filtros de escolha
- Paginação resetada para página 1 na busca exata
- Filtros visuais permanecem na UI; hint informa que são ignorados na API

---

## 9. Polling de segurança

- Intervalo: **60 segundos**
- Apenas com aba visível (`refetchIntervalInBackground: false`)
- Respeita filtros atuais via `queryKey`
- Cross-tab lock preservado no realtime (`skipCrossTabLock: true`)

---

## 10. Botão Atualizar

Validado sem alteração:

- `handleRefresh` → `searchQuery.refetch()`
- Usa filtros de `searchFilters` (via hook montado)
- Independente de WebSocket
- Não bloqueado após bootstrap (`prefsBootstrapped=true`)

---

## 11. Filtros default preservados

- Bootstrap em `OsHomePage` mantido
- Limpar filtros → `resetFilters()` sem reaplicar defaults na mesma sessão
- Indicador visual via `savedFilterName` / `filterStatus`

---

## 12. Paginação preservada

- `limit=20` mantido
- Busca por Nr OS força `page=1` em `buildOsHomeSearchFilters`
- `patchFilters` já resetava página ao alterar campos no formulário

---

## 13. Testes criados/alterados

### Backend

- `test_materialized_allows_null_situacao_in_active_list` (substitui teste antigo)
- `test_materialized_still_excludes_finished_when_not_included`
- `test_exact_os_lookup_skips_setor_situacao_filters`
- `test_exact_os_lookup_skips_os_sp_toggles`

### Frontend

- `osSearchUtils.test.ts`
- `filterStatus.test.ts`
- `useOsSearch.test.ts`
- `os.test.ts`

---

## 14. Comandos executados

```bash
python -m pytest app/backend/tests/test_os_ultimo_andamento_search.py app/backend/tests/test_os_operacional_notify.py app/backend/tests/test_sub_os_listas_paineis.py -q
pnpm test:backend
pnpm test:frontend
pnpm build
pnpm lint
pnpm typecheck
```

---

## 15. Resultado dos comandos

| Comando | Resultado |
|---------|-----------|
| pytest (OS/search/PCP) | **22 passed** |
| `pnpm test:backend` | **221 passed** |
| `pnpm test:frontend` | **124 passed** |
| `pnpm build` | **OK** |
| `pnpm lint` | **OK** (eslint pendente Fase 0 — pré-existente) |
| `pnpm typecheck` | **FALHOU** — `TS6310` pré-existente em `tsconfig.app.json` (packages referenciados com `noEmit`) |

---

## 16. Riscos remanescentes

1. **Materializada desatualizada** com situacao/setor incorretos (não NULL) — lista e painel podem divergir até próximo andamento/refresh.
2. **Paginação** — OS fora da página 1 sem busca por Nr OS ainda não aparece na primeira tela.
3. **Filtros default** — usuário pode não perceber que perfil restringe lista mas não o painel.
4. **Polling 60 s** — até 1 req/min/usuário com aba ativa na home (aceitável como rede de segurança).

---

## 17. Checklist manual

- [ ] Abrir home — Network mostra `/api/os/search` com filtros esperados
- [ ] Aguardar 60 s — segundo request de polling (aba visível)
- [ ] Botão Atualizar — refetch imediato
- [ ] OS do painel setor — buscar com filtros limpos
- [ ] OS do painel — buscar com filtros default ativos + Nr OS (deve aparecer com hint de lookup exato)
- [ ] Nr OS + Ano — `exact_os_lookup=true` na query
- [ ] OS Entregue com `include_finished=false` — não aparece
- [ ] Com "Exibir entregues" — pode aparecer
- [ ] Alterar andamento — lista atualiza via WS ou em até 60 s
- [ ] Painel setor — contadores/cards normais
- [ ] Sub OS — expandir/auto-expandir `matched_via_sub_os`
- [ ] Paginação página 2 — funciona
- [ ] Sem explosão de requests no Network

---

## Resumo técnico

| Item | Valor |
|------|-------|
| Endpoint lista | `GET /api/os/search` |
| Novo parâmetro | `exact_os_lookup=true` |
| Polling | 60 s (`OS_SEARCH_SAFETY_POLL_MS`) |
| Correção principal SQL | `situacao IS NULL OR situacao NOT IN (...)` |
| Painel | Sem alterações |
