# Relatório — Correção de Collation e Destino de Andamento Sub OS

## 1. Veredito

**Corrigido.**

- Exclusão de andamento operacional deixa de falhar com erro de collation.
- Fluxo de andamento por componente restaurado, incluindo componentes ainda sem Sub OS criada.

## 2. Erro de collation

### Onde ocorria

Em `recalc_ultimo_status_operacional()` (`services/andamento_operacional.py`), chamado por `delete_os_history` após excluir registro da `tabAndamento`.

A query usava:

```sql
AND a.CodStatus NOT IN (
    SELECT cod_status_espelho FROM tab_os_sub_os_andamento ...
)
```

### Collations encontradas

| Coluna | Tabela | Collation esperada |
|--------|--------|-------------------|
| `CodStatus` | `tabAndamento` | `utf8mb4_general_ci` (legado) |
| `cod_status_espelho` | `tab_os_sub_os_andamento` | `utf8mb4_unicode_ci` (tabelas Sub OS) |

MySQL rejeita comparação implícita entre collations diferentes → erro **1267**.

### Query corrigida

Substituído `NOT IN` por `NOT EXISTS` com `COLLATE utf8mb4_general_ci` em **ambos** os lados:

```sql
NOT EXISTS (
    SELECT 1 FROM tab_os_sub_os_andamento m
    WHERE m.cod_status_espelho IS NOT NULL
      AND m.cod_status_espelho != ''
      AND m.cod_status_espelho COLLATE utf8mb4_general_ci
          = a.CodStatus COLLATE utf8mb4_general_ci
)
```

### Por que a solução é segura

- Não altera collation global nem tabelas legadas.
- Alinha comparação à collation de `tabAndamento.CodStatus`.
- `NOT EXISTS` evita também ambiguidade com NULLs do `NOT IN`.
- `_fix_ultimo_status_mdb` não compara collations no MySQL (lista códigos em Python e usa Access) — inalterado.

### Testes

- `TestRecalcUltimoStatusOperacional` — valida `NOT EXISTS` + `COLLATE` na SQL executada.
- `TestRecalcCollationSafe` — valida constante `MIRROR_EXCLUDE_CLAUSE`.

## 3. Fluxo de andamento por componente

### Por que sumiu

O seletor só aparecia quando `hasActiveSubOs === true` (Sub OS já criada via `GET /sub-os`).

OS **2263** tinha componentes na Gerência, mas **nenhuma Sub OS** ainda — o seletor ficava oculto e o box azul mostrava apenas `OS 2263` com destino implícito `main`.

### Como foi restaurado

`OsHistoryPanel` agora:

1. Carrega **Sub OSs** (`useSubOsList`) e **componentes ativos** (`useOsComponentes`).
2. Monta `destinationOptions`:
   - `OS {n} (principal)`
   - Sub OSs existentes → `sub:{id}`
   - Componentes ativos **sem** Sub OS → `comp:{componente_id}` (ex.: `2263 [Capa]`)
3. Exibe seletor quando `needsDestinationSelector = sub_os.length > 0 || componentes.length > 0`.

### Tratamento por caso

| Caso | Comportamento |
|------|---------------|
| OS sem componentes/Sub OS | Fluxo simples; destino `main`; sem seletor |
| OS com Sub OSs | Seletor com OS principal + Sub OSs |
| OS com componentes sem Sub OS | Seletor inclui componentes como destinos |
| Sub OS selecionada na lista | Destino pré-preenchido `sub:{id}` |

### Save por destino

| Destino | Ação |
|---------|------|
| `main` | `POST /history` com `confirm_main_os_target=true` (UI exige checkbox) |
| `sub:{id}` | `POST /sub-os/{id}/history` |
| `comp:{id}` | `POST /sub-os` (create/reuse) → `POST /sub-os/{id}/history` |

## 4. UX de destino

- **Box azul** permanece e atualiza conforme seleção (`OS 2263`, `2263 [Capa]`, etc.).
- **Seletor obrigatório** quando há componentes ou Sub OSs.
- **Checkbox** de confirmação só quando destino = OS principal.
- **Sub OS na lista** → destino pré-preenchido; sem seletor extra.
- **Salvar** desabilitado até destino válido + confirmação (se principal).
- Layout responsivo mantido (select/checkbox empilhados).

## 5. Backend/payload

| Endpoint | Uso |
|----------|-----|
| `GET /componentes` | Lista componentes ativos para destinos `comp:` |
| `GET /sub-os` | Lista Sub OSs existentes |
| `POST /sub-os` | Cria/reutiliza Sub OS por `componente_id` |
| `POST /sub-os/{id}/history` | Andamento de componente |
| `POST /history` | Andamento OS principal |

- `confirm_main_os_target=true` exigido no backend **somente** quando `count_sub_os > 0`.
- OS com componentes mas **sem** Sub OS ainda pode gravar andamento principal sem flag (UI exige confirmação via checkbox).
- Espelho continua com `UltimoStatus=0`; MDB inalterado.

## 6. Proteções de UltimoStatus

- `recalc_ultimo_status_operacional()` ignora espelhos via `NOT EXISTS` + collation explícita.
- Espelho de Sub OS continua inserido com `UltimoStatus=0`.
- Exclusão operacional não promove espelho a status principal.

## 7. Arquivos alterados

| Arquivo | Alteração | Motivo |
|---------|-----------|--------|
| `app/backend/services/andamento_operacional.py` | `NOT EXISTS` + `COLLATE` | Corrigir erro 1267 na exclusão |
| `app/backend/tests/test_sub_os_corrections.py` | Testes collation e guard 403/200 | Regressão automatizada |
| `apps/web/src/features/os/components/OsHistoryPanel.tsx` | Seletor com componentes + `comp:` | Restaurar andamento por componente |

## 8. Testes executados

| Comando | Resultado | Observação |
|---------|-----------|------------|
| `python -m pytest app/backend/tests -q` | 76 passed | +2 testes novos |
| `pnpm build` | OK | |
| `pnpm lint` | OK | Placeholder Fase 0 |
| `pnpm typecheck` | Falha TS6310 | Pré-existente (project references) |

Sem infraestrutura Vitest — validação UI documentada manualmente abaixo.

## 9. Testes manuais recomendados

1. **Excluir andamento operacional** em OS com espelhos de Sub OS → sem erro 1267; status recalculado.
2. **OS sem componentes** → Novo andamento simples, sem seletor.
3. **OS com Sub OSs** → seletor visível; escolher Sub OS → salvar; box azul atualiza.
4. **OS com componentes sem Sub OS** (ex. 2263) → seletor com `2263 [Capa]`, etc.
5. **Componente sem Sub OS** → salvar cria Sub OS e lança andamento.
6. **OS principal com Sub OS** → tentar salvar sem checkbox → bloqueado na UI e 403 no backend.
7. **OS principal com Sub OS** → checkbox marcado → salvar OK.
8. **Validar MDB** → espelhos com `UltimoStatus=0` após andamento de componente.

## 10. Pendências

- Alinhar collation de `cod_status_espelho` na DDL (migration idempotente) — opcional; query já resolve.
- Testes automatizados de UI (Vitest/Playwright) para seletor de destino.
- `pnpm typecheck` TS6310 — correção de tooling em fase futura.
