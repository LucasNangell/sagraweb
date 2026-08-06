# Relatório de Correções — Sub OS por Componente

## 1. Veredito

**Corrigido com ressalvas**

Os sete riscos da auditoria foram endereçados com alterações pontuais. A suíte de testes passou (57 testes backend). Homologação manual com MDB (`MYSQL_ONLY=false`) continua obrigatória antes de produção.

**Ressalva principal:** testes automatizados usam mocks — não substituem validação real no Access.

---

## 2. Correção do UltimoStatus

### Problema

`delete_os_history` recalculava `UltimoStatus=1` pelo andamento mais recente (`ORDER BY Data DESC`), podendo promover espelho de Sub OS.

### Estratégia

Novo módulo `services/andamento_operacional.py`:

- `recalc_ultimo_status_operacional()` — exclui `CodStatus` presentes em `tab_os_sub_os_andamento.cod_status_espelho`
- `get_mirror_cod_statuses_for_os()` — lista espelhos para o MDB

### Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `services/andamento_operacional.py` | **Novo** — recálculo seguro |
| `routers/os_routes.py` | Delete usa `recalc_ultimo_status_operacional` |
| `routers/mdb_writer.py` | `_fix_ultimo_status_mdb` exclui espelhos (lista do MySQL) |

### Teste

`test_sub_os_corrections.py::TestRecalcUltimoStatusOperacional` — verifica SQL com `NOT IN` e `cod_status_espelho`.

### Resultado

✅ Espelhos não são elegíveis para promoção no recálculo MySQL e MDB.

---

## 3. Correção de componente órfão

### Problema

Remoção na Gerência fazia DELETE se não havia andamento, mesmo com Sub OS criada.

### Regra implementada

`_componente_has_sub_os()` verifica `tab_os_sub_os`. Remoção usa inativação (`ativo=0`) se há Sub OS **ou** andamento.

### Teste

`TestComponenteSubOsOrfa` — Sub OS sem andamento detectada.

### Resultado

✅ Componente com Sub OS não é deletado fisicamente.

---

## 4. Correção de congelamento

### Fluxos cobertos

| Fluxo | `sync_sub_os_congelada_flags` |
|-------|-------------------------------|
| Add histórico principal | Já existia |
| Update histórico principal | **Adicionado** |
| Delete histórico principal | **Adicionado** |
| Replicate histórico | **Adicionado** (por OS alvo) |

### Regra final

- OS Entregue/Cancelada/Cancelado → `congelada=1`
- OS ativa → `congelada=0` (descongela automaticamente)

### Teste

`TestCongelamentoSubOs` — flags 1/0 conforme `is_os_frozen`.

### Resultado

✅ Sincronização em todos os fluxos que alteram status final da OS principal.

---

## 5. Summary/prefetch

### Foi otimizado? **Sim**

### Como ficou

- `/api/os/search` retorna campos opcionais `has_sub_os` e `sub_os_count` (subquery `LEFT JOIN` em `tab_os_sub_os`)
- Frontend remove prefetch de N× `/sub-os/summary`
- Indicador `+` lê dados da busca; expandir ainda faz lazy `GET /sub-os`

### Impacto

- Elimina até 20 requisições extras por página
- Paginação inalterada (1 linha por OS principal)

### Teste

`TestOsSearchDedupe` — uma linha por `(nr_os, ano)`.

---

## 6. Observação espelhada

### Formato final

```
14h26 - OS 886 [Capa]
<texto do usuário>
```

Primeira linha: `HHhMM - OS {nro} [{componente}]` (hífen, sem `format_andamento_obs`).

### Justificativa

Mais legível no histórico principal e no MDB; hora não duplicada.

### Impacto

- MDB recebe texto na coluna `Observaçao` — compatível com memo Access
- Timeline/regex de hora no legado: prefixo `HHhMM` mantido no início da linha

---

## 7. WebSocket

### Decisão

- **Removido** `_broadcast_os_system_update(..., "history_added")` duplicado em `add_sub_os_history`
- **Mantido** apenas `sub_os_history_added` com `scope: "sub_os"`
- Frontend `applyOsSystemUpdate` trata `sub_os_history_added` para invalidar painéis Sub OS quando necessário

### Refresh duplicado

Evitado no backend (um evento). Painéis principais ainda atualizam via `silentRefreshOsPanels` no handler único.

---

## 8. Arquivos alterados

| Arquivo | Alteração | Motivo |
|---------|-----------|--------|
| `services/andamento_operacional.py` | Novo | Recálculo UltimoStatus |
| `services/os_componentes_service.py` | Espelho obs, Sub OS check, WS | Riscos 2, 5, 6 |
| `routers/os_routes.py` | Delete recalc, congelamento, search fields | Riscos 1, 3, 4 |
| `routers/mdb_writer.py` | MDB recalc exclui espelhos | Risco 1 |
| `tests/test_sub_os_corrections.py` | Novo | Risco 7 |
| `apps/web/.../types.ts` | `has_sub_os`, `sub_os_count` | Risco 4 |
| `apps/web/.../OsOrdersTable.tsx` | Remove prefetch | Risco 4 |
| `apps/web/.../osRealtimeSync.ts` | WS Sub OS | Risco 6 |
| `apps/web/.../useOsRealtimeSync.ts` | Passa `action` | Risco 6 |

---

## 9. Testes executados

| Comando | Resultado | Observação |
|---------|-----------|------------|
| `pytest test_sub_os_corrections.py -q` | ✅ 12 passed | Novos testes |
| `pytest app/backend/tests -q` | ✅ 57 passed | Suite completa |
| `pnpm build` | ✅ Sucesso | |
| `pnpm lint` | ✅ Sucesso | Placeholder Fase 0 |
| `pnpm typecheck` | ❌ TS6310 | Pré-existente; sem erro novo da feature |

---

## 10. Pendências antes de produção

1. **MDB homologação** (`MYSQL_ONLY=false`): espelho gravado, `UltimoStatus=0`, recálculo após delete não promove espelho no Access.
2. **Delete manual de espelho** no histórico principal ainda possível — recálculo deve ignorar outros espelhos restantes.
3. **Edição/exclusão Sub OS** — continua 405 (fase futura).
4. **Painéis/PCP** — sem exibição de Sub OS (fase futura).
5. **Teste integração** com MySQL real para fluxo completo add Sub OS → espelho → delete operacional.
