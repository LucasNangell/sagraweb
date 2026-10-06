---
name: Agrupar Birô por fornecedor
overview: Agrupar a lista da aba "OPs pendentes no Birô" (GravacaoExternaTab) por fornecedor, com cabeçalho mostrando o nome do fornecedor, exceto quando o usuário logado for fornecedor. Isso exige expor `fornecedor_nome` nas listas do backend.
todos:
  - id: backend-nome
    content: Adicionar JOIN tabUsuarios + fornecedor_nome nas duas listas de gravacao_externa_service e no modelo GravacaoExternaOsItem; atualizar teste pytest
    status: completed
  - id: frontend-tipo
    content: Adicionar fornecedor_nome ao tipo GravacaoExternaOsItem em api/gravacaoExterna.ts
    status: completed
  - id: frontend-agrupar
    content: Agrupar listPanel de GravacaoExternaTab por fornecedor (exceto user.fornecedor), com cabeçalho do nome; mostrar nome no painel Aguardando retirada
    status: completed
  - id: frontend-teste
    content: Criar teste vitest cobrindo agrupamento para não-fornecedor e lista plana para fornecedor
    status: completed
  - id: validar
    content: Rodar pnpm test e typecheck
    status: completed
isProject: false
---

# Agrupar "OPs pendentes no Birô" por fornecedor

## Contexto
- A aba "OPs pendentes no Birô" é renderizada por [apps/web/src/features/gravacao-externa/components/GravacaoExternaTab.tsx](apps/web/src/features/gravacao-externa/components/GravacaoExternaTab.tsx) (`listPanel`, linhas ~372-403). Ela tem dois segmentos: "Gravação pendente" e "Aguardando retirada". O agrupamento vale para os dois.
- Hoje os itens trazem só `fornecedor_ponto`. O nome já é resolvido em outro lugar via `LEFT JOIN tabUsuarios uf ...` em [app/backend/services/gravacao_pendente_service.py](app/backend/services/gravacao_pendente_service.py) (linhas ~2032-2039). Vamos reaproveitar o mesmo padrão.
- Fornecedores são identificados no frontend por `user?.fornecedor` (padrão já usado em `GravacaoExternaTab` e `GravacaoPendenteTab`).

## Backend
1. [app/backend/services/gravacao_externa_service.py](app/backend/services/gravacao_externa_service.py)
   - `list_os_gravacao_externa` (~linha 592) e `list_os_gravacao_aguardando_entrega` (~linha 2032): adicionar ao `list_sql` o mesmo join usado no serviço de pendente:

```sql
LEFT JOIN tabUsuarios uf
    ON uf.Ponto = NULLIF(
        CAST(REPLACE(REPLACE(IFNULL(ge.FornecedorPonto, ''), '.', ''), '-', '') AS UNSIGNED),
        0
    )
```

   - Selecionar `uf.Nome AS fornecedor_nome` e incluir `"fornecedor_nome": row.get("fornecedor_nome")` no dict de cada item. O `_aggregate_list_items_by_juntada` já preserva os campos do primeiro item via `**item`. O `count_sql` não muda.
2. [app/backend/routers/gravacao_externa_routes.py](app/backend/routers/gravacao_externa_routes.py): adicionar `fornecedor_nome: Optional[str] = None` em `GravacaoExternaOsItem`.
3. [app/backend/tests/test_gravacao_externa_service.py](app/backend/tests/test_gravacao_externa_service.py): incluir `fornecedor_nome` na linha mockada do teste de `list_os_gravacao_externa` e fazer assert do valor.

## Frontend
1. [apps/web/src/api/gravacaoExterna.ts](apps/web/src/api/gravacaoExterna.ts): adicionar `fornecedor_nome?: string | null` em `GravacaoExternaOsItem`.
2. `GravacaoExternaTab.tsx`:
   - `const groupByFornecedor = !user?.fornecedor;`
   - Criar um helper puro `groupItemsByFornecedor(items)` com `useMemo`. Ele agrupa pela chave `fornecedor_ponto`, e o rótulo é `fornecedor_nome?.trim() || fornecedor_ponto || "Sem fornecedor"`. Os grupos ficam em ordem alfabética pelo rótulo, com "Sem fornecedor" por último. Dentro de cada grupo, os itens mantêm a ordem do backend.
   - Extrair a renderização do card atual para uma função local `renderItem(item)`, para evitar duplicação.
   - Quando `groupByFornecedor` for verdadeiro, renderizar cada grupo como uma `<section>` com cabeçalho: nome do fornecedor + contador, estilo `text-xs font-semibold uppercase text-neutral-500`, `sticky top-0 bg-white`. Abaixo vem a `<ul className="space-y-1">` com os cards. Quando for falso (usuário fornecedor), manter a lista plana atual, sem mudanças.
   - No painel do segmento "Aguardando retirada" (~linha 437), trocar `Fornecedor: {selected.fornecedor_ponto}` para mostrar `fornecedor_nome` e usar o ponto como fallback.
3. Teste: criar `apps/web/src/features/gravacao-externa/components/GravacaoExternaTab.grouping.test.tsx`, seguindo os mocks de [GravacaoExternaTab.download.test.tsx](apps/web/src/features/gravacao-externa/components/GravacaoExternaTab.download.test.tsx). Casos:
   - Usuário não fornecedor: mostra cabeçalhos com os nomes dos fornecedores e as OSs sob o grupo certo.
   - Usuário fornecedor: sem cabeçalhos de grupo.

## Validação
- `pnpm test` (pytest + vitest) e `pnpm typecheck` em `apps/web`.
