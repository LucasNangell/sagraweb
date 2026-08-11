---
name: Lista Lab igual Análise
overview: Alinhar a lista «Problemas registrados» do Lab à árvore da Análise (ordem de versões, colapso, versão atual expandida) e importar de forma idempotente os itens de tabAnaliseItens para tabAnaliseLabItem com vínculo ItemAnaliseID, sem clobber de edições Lab.
todos:
  - id: schema-unique
    content: UNIQUE em tabAnaliseLabItem.ItemAnaliseID + ensure schema
    status: completed
  - id: import-classic
    content: import_classic_items idempotente e seguro; chamar em get_analise_lab/save
    status: completed
  - id: backend-tests
    content: "Testes import: create, no-dupe, missing classic"
    status: completed
  - id: tree-order-collapse
    content: Ordem OS versions, hide empty slots, allLabTreeNodeKeys
    status: completed
  - id: list-ui-collapse
    content: "AnaliseLabItemList: colapso, headers, expand versão atual"
    status: completed
  - id: verify
    content: Vitest tree + pytest import; smoke Inspeção vs Folhear
    status: completed
isProject: false
---

# Lista Lab = árvore Análise + import da clássica

## Decisões

- **Dados:** ao carregar a sessão Lab, importar itens faltantes de `tabAnaliseItens` da mesma OS para `tabAnaliseLabItem`, com `ItemAnaliseID` e índice único. Não sobrescrever linhas Lab já existentes.
- **Edição:** continua no Lab; ao concluir, `mirror_items_to_analise` já sincroniza de volta via `ItemAnaliseID`.
- **Colapso:** versões colapsadas por padrão; expandir a versão atual da sessão (paridade com Análise). Sem nó Pré-análise.

## Backend — import seguro e idempotente

Em [`analise_lab_items_service.py`](app/backend/services/analise_lab_items_service.py) (ou módulo irmão):

1. `import_classic_items(sessao_id, ano, os_id) -> int` (criados):
   - Resolver `ID_Analise` de `tabAnalises` para `(OS, Ano)`.
   - Se não houver análise clássica, no-op.
   - Ler itens clássicos (mesmo select de [`get_full_analysis`](app/backend/routers/analise_routes.py): título, html, componente, versao, obs, flags).
   - Já existentes na sessão (`ItemAnaliseID IN (...)`) → **pular** (não overwrite).
   - Inserir faltantes: `Escopo='arquivo'`, `Pagina=0`, `VersaoLabel` do clássico, `Ordem` sequencial, demais campos copiados; `ItemAnaliseID = classic.ID`.
2. Integridade:
   - Em [`analise_lab_schema.py`](app/backend/analise_lab_schema.py): `UNIQUE KEY uq_lab_item_analise_id (ItemAnaliseID)` (NULLs múltiplos ok no MySQL) via `_ensure` idempotente.
   - Antes de inserir, validar que o `ID` clássico pertence ao `ID_Analise` da mesma OS (nunca importar de outra OS).
   - `INSERT` protegido por unique + catch duplicate → treat as already imported.
3. Gatilho: em [`get_analise_lab`](app/backend/routers/analise_lab_routes.py) quando há sessão, chamar import **antes** de `list_items`. Também após `save`/criação de sessão se a resposta incluir `itens`.
4. Testes em [`test_analise_lab.py`](app/backend/tests/test_analise_lab.py): import cria vínculo; segunda chamada não duplica; OS sem clássica não quebra; Item de outra OS rejeitado/não entra.

## Frontend — paridade visual/colapso

### Árvore

Em [`analiseLabItemsTree.ts`](apps/web/src/features/analise-lab/analiseLabItemsTree.ts):

- Preservar **ordem de `OsVersionItem[]`** (como Análise), sem reordenar “editável primeiro”; orphans no fim.
- Ocultar componentes sem itens e sem PDF (`versionFiles`/`versionFile`), igual [`AnaliseItemsTree`](apps/web/src/features/analise/components/AnaliseItemsTree.tsx).
- Helper `allLabTreeNodeKeys(tree)` com chaves estáveis de versão **e** componente que o UI realmente usa (evitar o bug clássico de seed `1-Capa` vs `v1::…`).

### Lista

Em [`AnaliseLabItemList.tsx`](apps/web/src/features/analise-lab/AnaliseLabItemList.tsx):

- Estado `collapsedNodes` + chevrons; headers de versão no estilo da Análise (`border-l-4`, badge de contagem).
- Seed: colapsar todas as chaves → remover a chave da versão atual (`itemMatchesVersion` / `vN` da sessão).
- Manter Abrir arquivo, DnD, replicar, toggles, delete (já existentes).
- Sem Pré-análise.

### Página

[`AnaliseLabPage.tsx`](apps/web/src/features/analise-lab/AnaliseLabPage.tsx): passar `currentVersaoLabel` / versions (já feitos); após `GET analise-lab`, itens já vêm importados — sem fetch clássico separado no client.

## Fluxo

```mermaid
sequenceDiagram
  participant UI as AnaliseLabPage
  participant API as get_analise_lab
  participant Imp as import_classic_items
  participant Lab as tabAnaliseLabItem
  participant Cl as tabAnaliseItens

  UI->>API: GET analise-lab
  API->>Imp: session exists
  Imp->>Cl: SELECT itens da OS
  Imp->>Lab: INSERT missing ItemAnaliseID
  API->>Lab: list_items
  API-->>UI: itens unificados
  Note over UI: árvore colapsada; versão atual expandida
```

## Critérios de aceite

- OS com itens na Análise clássica: ao abrir Lab (com sessão), lista mostra esses problemas agrupados por versão, sem duplicar em reload.
- UI: versões ordenadas como pastas Original; colapsadas; versão da sessão expandida; Abrir arquivo e ações Lab intactas.
- Concluir Lab continua espelhando via `ItemAnaliseID` sem criar duplicates clássicos.
- Folhear inalterado.
