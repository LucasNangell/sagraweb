---
name: Fix data entrega -1d
overview: A data de entrega aparece um dia a menos porque `formatDateBr` e `formatDateForInput` fazem `new Date("YYYY-MM-DD")`, que o JS trata como UTC midnight e, no fuso do Brasil (UTC−3), cai no dia anterior. Prioridade não altera a data — só torna o bug mais visível.
todos:
  - id: fix-civil-date-parse
    content: Corrigir formatDateBr e formatDateForInput em apps/web/src/lib/format.ts com parse civil local de YYYY-MM-DD
    status: completed
  - id: dedupe-gerencia-formatter
    content: Fazer gerencia/utils.ts reutilizar formatDateForInput de @/lib/format
    status: completed
  - id: add-regression-tests
    content: Adicionar format.test.ts cobrindo o caso YYYY-MM-DD no fuso BR
    status: completed
isProject: false
---

# Corrigir data de entrega com dia a menos

## Causa raiz (confiança alta)

A API devolve `EntregData` / `data_entrega` como date-only ISO (`"YYYY-MM-DD"`). No frontend, os formatadores usam `new Date(value)` e depois getters **locais**:

- Lista (coluna Data): [`OsOrdersTable.tsx`](apps/web/src/features/os/components/OsOrdersTable.tsx) → `formatDateBr(data_entrega)`
- Detalhes (campo Data): [`OsDetailsPanel.tsx`](apps/web/src/features/os/components/OsDetailsPanel.tsx) → `formatDateForInput(EntregData)`

Ambos em [`apps/web/src/lib/format.ts`](apps/web/src/lib/format.ts):

```1:9:apps/web/src/lib/format.ts
export function formatDateBr(value: string | null | undefined): string {
  ...
  const date = new Date(value);
  ...
  return date.toLocaleDateString("pt-BR");
}
```

```74:88:apps/web/src/lib/format.ts
export function formatDateForInput(...) {
  ...
  const date = new Date(value);
  ...
  // getFullYear / getMonth / getDate (local)
}
```

Para `"2026-08-12"`, o ECMAScript interpreta UTC `00:00`. Em America/Sao_Paulo vira `2026-08-11 21:00` → exibe **11/08/2026** ou **2026-08-11**.

**Prioridade não muda o campo de data.** `EntregPrazoLink` / `prioridade` só afeta badge/ordenação. OSs “Solicitado/Prometido” costumam ter `EntregData` preenchida; por isso o sintoma aparece nessas linhas.

```mermaid
flowchart LR
  DB["MySQL EntregData"] --> API["JSON YYYY-MM-DD"]
  API --> Bad["new Date ISO date-only = UTC"]
  Bad --> Local["getters locais UTC-3"]
  Local --> Wrong["dia anterior"]
```

## Correção

Centralizar parse de **data civil** (sem timezone) em [`apps/web/src/lib/format.ts`](apps/web/src/lib/format.ts):

1. Adicionar helper interno (ex.: `parseCivilDate`) que:
   - Para `YYYY-MM-DD` (ou prefixo antes de `T`/` `): monta `new Date(y, m-1, d)` **local**, sem UTC.
   - Para datetime com horário: manter `new Date(value)` (comportamento atual de timestamps).
2. Usar esse parse em `formatDateBr` e `formatDateForInput`.
3. Alinhar o duplicado em [`apps/web/src/features/gerencia/utils.ts`](apps/web/src/features/gerencia/utils.ts) (`formatDateForInput` local) para importar o de `@/lib/format` (mesmo bug em Gerência / campo `val_data`).
4. **Não** reutilizar `parseDateLocal` de [`pcpUtils.ts`](apps/web/src/features/pcp/pcpUtils.ts): para date-only ele cai no mesmo `new Date(value)` e tem o mesmo problema.

Escopo mínimo pedido: lista + detalhes da home — resolvido ao corrigir os helpers compartilhados.

## Testes

Adicionar [`apps/web/src/lib/format.test.ts`](apps/web/src/lib/format.test.ts):

- `"2026-08-12"` → `formatDateBr` = `12/08/2026`
- `"2026-08-12"` → `formatDateForInput` = `2026-08-12`
- Aceitar também `"2026-08-12T00:00:00"` / `"2026-08-12T00:00:00.000Z"` como data civil `12/08/2026` quando o intent for date-only (prefixo `YYYY-MM-DD`)
- Vazios / inválidos inalterados

Rodar o teste unitário do Vitest nesse arquivo.

## Validação manual

Na home, OS com prioridade e `EntregData` conhecida no banco: coluna Data e painel Detalhes devem mostrar o mesmo dia do banco (não D−1).
