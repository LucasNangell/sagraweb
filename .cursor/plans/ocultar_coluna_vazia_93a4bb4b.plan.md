---
name: Ocultar coluna vazia
overview: Adicionar flag opcional por coluna para ocultar a coluna quando não houver items; padrão permanece sempre visível. Persistida no mesmo JSON de config do painel.
todos: []
isProject: false
---

# Ocultar coluna vazia (por coluna)

## Comportamento

- Nova flag opcional em cada coluna: `hideWhenEmpty?: boolean` (omitida/false = comportamento atual: coluna sempre visível).
- No board: se `hideWhenEmpty === true` e `items.length === 0`, a coluna **não é renderizada**.
- Grid CSS: `data-columns` passa a refletir a **quantidade de colunas visíveis** (não o `columnCount` total da config), para o layout continuar correto.
- Cores do header (`COLUMN_HEADER_CLASSES`) usam o índice entre as colunas **visíveis**.
- Se todas as colunas com flag estiverem vazias e sobrar zero visíveis: renderizar as colunas que não têm a flag; se nenhuma sobrar (todas com flag e vazias), manter o board vazio sem erro (caso raro / aceitável).

## Modelo e persistência

Em [`types.ts`](apps/web/src/features/dashboard-setor/types.ts):

```ts
export interface DashboardColumnConfig {
  id: string;
  title: string;
  statuses: string[];
  sector?: string;
  /** Se true, coluna não aparece no board quando items.length === 0 */
  hideWhenEmpty?: boolean;
}
```

- [`normalizeConfig.ts`](apps/web/src/features/dashboard-setor/normalizeConfig.ts): normalizar boolean; `true` persiste, falsy omite.
- [`utils.ts`](apps/web/src/features/dashboard-setor/utils.ts) `buildDashboardConfigSignature`: incluir `hideWhenEmpty` para forçar reprocesso/UI ao salvar.
- Sem migração de schema (JSON livre, como `sector`).

## UI

Em [`DashboardSetorSettingsModal.tsx`](apps/web/src/features/dashboard-setor/components/DashboardSetorSettingsModal.tsx), no bloco de cada coluna (abaixo dos andamentos ou junto aos campos da coluna):

- Checkbox: **Ocultar quando vazia**
- Default unchecked; colunas novas sem a flag.

## Render

Em [`DashboardSetorPage.tsx`](apps/web/src/features/dashboard-setor/components/DashboardSetorPage.tsx):

```ts
const visibleColumns = columns.filter(
  (col) => !col.hideWhenEmpty || col.items.length > 0,
);
```

- `data-columns={String(visibleColumns.length)}` (ou `1` se zero, só para evitar CSS quebrado)
- Mapear `visibleColumns` em vez de `columns`

Helper pequeno em `utils.ts` (`getVisibleDashboardColumns`) para testar sem montar a página.

## Testes

Em [`utils.test.ts`](apps/web/src/features/dashboard-setor/utils.test.ts):

- sem flag → sempre presente mesmo vazia
- com flag + vazia → filtrada
- com flag + items → presente
- misturado: só as elegíveis saem na lista visível

## Critérios de aceite

1. Painel padrão inalterado (nenhuma coluna oculta sem ativar a opção).
2. Coluna com “Ocultar quando vazia” some do board se `items.length === 0` e reaparece quando entra card.
3. Título/setor/andamentos independentes dessa flag.
4. Preferência / padrão admin / localStorage persistem o checkbox.