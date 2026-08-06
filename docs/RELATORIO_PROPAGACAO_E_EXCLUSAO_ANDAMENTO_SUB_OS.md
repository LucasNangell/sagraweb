# Relatório — Propagação e Exclusão de Andamento Sub OS

**Data:** 2026-06-08  
**Escopo:** Propagação do andamento da OS principal para componentes/Sub OSs ativos; exclusão segura de andamentos de Sub OS; limpeza de herdados ao excluir andamento principal.

---

## 1. Regra implementada

### Andamento da OS principal
Ao lançar andamento na OS principal (`POST /api/os/{ano}/{id}/history`):

1. Grava em `tabAndamento` com `UltimoStatus=1` (fluxo existente).
2. Replica para MDB (fluxo existente).
3. Se a OS tiver **componentes ativos** em `tab_os_componentes`:
   - Cria/reutiliza Sub OS por componente.
   - Zera `ultimo_status` anterior de cada Sub OS.
   - Insere andamento **herdado** em `tab_os_sub_os_andamento`.
   - **Não** cria espelho em `tabAndamento` por componente.
   - **Não** grava no MDB por componente.

### Andamento manual de Sub OS
Fluxo existente preservado:

- Registro em `tab_os_sub_os_andamento` com `source_type=manual_sub_os`.
- Espelho em `tabAndamento` com `UltimoStatus=0`.
- Sincronização do espelho no MDB.

### Exclusão de andamento Sub OS
Novo endpoint `DELETE /api/os/{ano}/{id}/sub-os/{sub_os_id}/history/{history_id}`:

| Tipo | Ação |
|------|------|
| **Herdado** (`inherited_main_os`) | Remove só o registro da Sub OS; não altera `tabAndamento` nem MDB |
| **Manual** (`manual_sub_os`) | Remove registro da Sub OS; tomba/exclui espelho (`UltimoStatus=0`); sincroniza exclusão no MDB |

Em ambos os casos: recalcula `ultimo_status` da Sub OS (promove o andamento mais recente restante).

### Exclusão de andamento principal propagado
Ao excluir andamento principal (`DELETE /api/os/{ano}/{id}/history/{cod_status}`):

- Remove andamentos herdados com `source_cod_status = cod_status`.
- Recalcula `ultimo_status` de cada Sub OS afetada.
- MDB recebe apenas a exclusão do andamento principal (como antes).

---

## 2. Campos e tabelas alterados

### Migração idempotente (`os_sub_os_schema.py`)

Novas colunas em `tab_os_sub_os_andamento`:

| Coluna | Tipo | Uso |
|--------|------|-----|
| `source_type` | `VARCHAR(32)` default `manual_sub_os` | `manual_sub_os` ou `inherited_main_os` |
| `source_cod_status` | `VARCHAR(32)` NULL | `CodStatus` do andamento principal (herdados) |
| `herdado_da_os_principal` | `TINYINT(1)` default 0 | Flag de auditoria |

Índice único (dedupe):

```sql
UNIQUE (sub_os_id, source_cod_status)
```

Registros manuais têm `source_cod_status=NULL` (múltiplos NULL permitidos no MySQL).

### Exclusão
- **Delete físico** em `tab_os_sub_os_andamento` (consistente com `tabAndamento` e ausência de tombstone nesta tabela).
- Espelhos manuais seguem padrão existente: `deleted_andamentos` + delete em `tabAndamento` com guarda `UltimoStatus=0`.

---

## 3. Fluxo de propagação

```
POST /history (OS principal)
    │
    ├─► tabAndamento (UltimoStatus=1) ──► MDB
    │
    └─► Para cada componente ativo:
            ├─► tab_os_sub_os (criar/reutilizar)
            └─► tab_os_sub_os_andamento
                  source_type = inherited_main_os
                  source_cod_status = CodStatus principal
                  herdado_da_os_principal = 1
                  cod_status_espelho = NULL
                  ultimo_status = 1
```

**Dedupe:** se já existir registro com `(sub_os_id, source_cod_status)`, não reinsere.

**Congelamento:** propagação ocorre dentro da transação; `sync_sub_os_congelada_flags` continua após commit (Entregue/Cancelada congela Sub OSs depois da propagação).

---

## 4. Fluxo de exclusão Sub OS

```
DELETE /sub-os/{id}/history/{history_id}
    │
    ├─ Valida OS não congelada / Sub OS não congelada
    ├─ Identifica source_type
    │
    ├─ inherited_main_os:
    │     DELETE tab_os_sub_os_andamento
    │     recalc ultimo_status Sub OS
    │     WS: sub_os_history_deleted
    │
    └─ manual_sub_os (+ cod_status_espelho):
          tombstone deleted_andamentos
          DELETE tabAndamento WHERE UltimoStatus=0
          DELETE tab_os_sub_os_andamento
          recalc ultimo_status Sub OS
          MDB: sync_andamento_delete_to_mdb(espelho)
          WS: sub_os_history_deleted
```

---

## 5. Manual vs herdado

| | Manual Sub OS | Herdado OS principal |
|---|---------------|---------------------|
| `source_type` | `manual_sub_os` | `inherited_main_os` |
| `cod_status_espelho` | preenchido | NULL |
| Espelho `tabAndamento` | Sim (`UltimoStatus=0`) | Não |
| MDB | Espelho sincronizado | Não |
| Exclusão na Sub OS | Remove espelho + MDB | Só registro Sub OS |
| Exclusão na OS principal | N/A (espelho via histórico principal) | Remove herdados vinculados |

Registros legados sem `source_type`: inferidos por `herdado_da_os_principal`, `source_cod_status` ou presença de `cod_status_espelho`.

---

## 6. Garantias MDB

- Um único registro MDB por andamento principal.
- Espelhos manuais Sub OS continuam com `UltimoStatus=0` no MDB.
- Andamentos herdados **nunca** vão ao MDB.
- Estrutura MDB inalterada; sem Sub OS real no MDB.

---

## 7. Garantias UltimoStatus

- `tabAndamento.UltimoStatus=1` exclusivo da OS principal (`recalc_ultimo_status_operacional` ignora espelhos).
- Espelhos manuais sempre `UltimoStatus=0`.
- Exclusão Sub OS nunca promove espelho a `UltimoStatus=1`.
- Exclusão Sub OS nunca altera status operacional da OS principal.

---

## 8. Comportamento em exclusão/update do principal

### Exclusão
Implementado: `delete_inherited_andamento_for_main_cod()` na transação de `delete_os_history`.

### Edição (`PUT /history`)
**Pendência documentada:** edição de andamento principal **não** atualiza registros herdados nas Sub OSs. Motivo: risco de inconsistência temporal e concorrência; recomenda-se novo andamento principal se o status propagado precisar mudar.

---

## 9. Frontend

### Novo andamento OS principal
- Aviso quando destino = principal e há componentes/Sub OSs:
  - *"Este andamento será lançado na OS principal e também atualizará todos os componentes ativos desta OS."*
- Checkbox:
  - *"Confirmo que este andamento pertence à OS principal e deve ser aplicado a todos os componentes ativos."*

### Exclusão Sub OS
- Botão excluir habilitado quando Sub OS selecionada.
- Confirmação diferenciada para herdado vs manual.
- `deleteSubOsHistory()` + invalidação de histórico Sub OS, lista Sub OS e histórico principal (se espelho manual).

---

## 10. Arquivos principais

| Arquivo | Alteração |
|---------|-----------|
| `app/backend/os_sub_os_schema.py` | Colunas + índice único |
| `app/backend/services/os_componentes_service.py` | Propagação, recálculo, exclusão Sub OS |
| `app/backend/routers/os_routes.py` | Propagação em `add_os_history`; limpeza herdados em `delete_os_history` |
| `app/backend/routers/os_sub_os_routes.py` | DELETE implementado; campos origem no modelo |
| `apps/web/src/features/os/components/OsHistoryPanel.tsx` | UX propagação + exclusão Sub OS |
| `apps/web/src/api/os.ts` | `deleteSubOsHistory` |
| `apps/web/src/api/hooks/useSubOs.ts` | `deleteMutation` |
| `app/backend/tests/test_sub_os_propagacao_exclusao.py` | Testes novos |

---

## 11. Testes executados

```text
python -m pytest app/backend/tests -q
94 passed

pnpm build   — OK
pnpm lint    — OK (eslint pendente Fase 0)
pnpm typecheck — TS6310 pré-existente (packages api-types/ui emit)
```

Cenários cobertos por testes unitários:

1. Propagação para componentes ativos sem espelho `tabAndamento`
2. Dedupe por `source_cod_status`
3. Sem componentes → sem propagação
4. `delete_inherited_andamento_for_main_cod` + recálculo
5. `recalc_sub_os_ultimo_status`
6. Resolução manual vs herdado
7. Exclusão herdada (sem MDB)
8. Exclusão manual com espelho (MDB)
9. Guard `confirm_main_os_target` com componentes ativos

---

## 12. Pendências

1. **Edição de andamento principal propagado** — não atualiza herdados (ver seção 8).
2. **Edição de andamento Sub OS** — continua 405 (fase anterior).
3. **Homologação manual** — validar cenários 1–9 do roteiro com OS real multi-componente.
4. **typecheck TS6310** — pré-existente no monorepo.

---

## 13. Checklist de não-regressão

| Item | Status |
|------|--------|
| OS sem componentes — fluxo antigo | OK |
| Andamento manual Sub OS — espelho UltimoStatus=0 | OK |
| MDB — só principal + espelhos manuais | OK |
| Histórico principal — sem duplicata por componente | OK |
| Histórico Sub OS — manuais + herdados | OK |
| Listas/painéis — status via `tab_os_sub_os_andamento` | OK (já existente) |
| Portal cliente | Inalterado |
| Congelamento Entregue/Cancelada | Bloqueio exclusão Sub OS mantido |

---

## 14. Detalhes técnicos da Sub OS (painel Detalhes)

### Problema corrigido
Ao selecionar Sub OS na lista (ex.: `2532 [Capa]`), o painel Detalhes exibia Máquina/Páginas/Papel/Cores agregados da OS principal.

### Comportamento
| Seleção | Campos administrativos | Campos técnicos |
|---------|------------------------|-----------------|
| OS principal | `GET /details` | `GET /details` (legado) |
| Sub OS | `GET /details` da OS pai | `techspec_json` do componente (`componente_id`) |

Campos técnicos sobrescritos na Sub OS: **Máquina**, **Páginas**, **Papel**, **Cores**.  
Demais campos (Tiragem, Formato, Prioridade, Acabamento, Obs, Contato, Frente/Verso) permanecem da OS principal.

Badge: `Detalhes técnicos exibidos para: 2532 [Capa]`.

Campo vazio no componente → exibe `—` (não faz fallback para dados da OS principal).

### Obtenção dos dados
1. `componente_id` propagado na linha Sub OS (`osTableRows.ts`).
2. `GET /api/os/{ano}/{id}/componentes?include_inactive=true` — lista lotes do componente (inclui inativos para Sub OS histórica).
3. Front-end: `extractComponentTechDetails()` agrega lotes (`maquina_link`, `paginas`, `papel_link`/`papel_desc`, `cores_link`/`cores_desc`).

Sem endpoint novo; uma query de componentes por OS (sem N+1).

### Arquivos
| Arquivo | Alteração |
|---------|-----------|
| `apps/web/src/features/os/components/OsDetailsPanel.tsx` | Sobrescrita técnica + badge |
| `apps/web/src/features/os/componentTechDetails.ts` | Extração de lotes |
| `apps/web/src/features/os/osTableRows.ts` | `componente_id` na linha Sub OS |
| `apps/web/src/features/os/types.ts` | `componente_id` em `OsSearchRow` |
| `apps/web/src/api/os.ts` | `includeInactive` em `fetchOsComponentes` |
| `apps/web/src/api/hooks/useSubOs.ts` | `useOsComponentes` com opções |
| `app/backend/routers/os_sub_os_routes.py` | Query `include_inactive` |

### Testes adicionais
- `apps/web/src/features/os/componentTechDetails.test.ts` (vitest)
- Backend: `include_inactive` no endpoint de componentes

### Limitações
- Frente/Verso, Módulos e Acabamento continuam da OS principal (não existem por componente no schema atual).
- Componente sem registro em `tab_os_componentes` (caso extremo) exibe `—` nos quatro campos técnicos.
