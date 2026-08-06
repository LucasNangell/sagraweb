---
name: Espelhos PDF no topo
overview: Reordenar a lista de arquivos em gravacao-externa para que a seção de espelhos (PDF) apareça antes dos grupos TIF, inclusive na aba Pendente com agrupamento por máquina.
todos:
  - id: reorder-jsx
    content: Mover bloco espelhos acima de chapas em ArquivosChapaList
    status: completed
  - id: reorder-machine-sort
    content: Colocar grupo sem máquina no topo do sort groupByMachine
    status: completed
  - id: update-tests
    content: Atualizar/adicionar asserts de ordem em GravacaoExternaPreview.test.tsx
    status: completed
isProject: false
---

# Espelhos PDF no topo da lista

## Contexto

A lista compartilhada em [`GravacaoExternaPreview.tsx`](apps/web/src/features/gravacao-externa/components/GravacaoExternaPreview.tsx) já separa PDFs (`espelhos`) de TIFs (`chapas` / `others`) via `groupArquivosByChapa`, mas **renderiza TIFs primeiro**. Na aba Pendente (`groupByMachine`), o bloco **"Espelhos / sem máquina"** também é ordenado por último.

Ordem desejada na tela:

1. Espelhos de chapa (PDF)
2. Grupos de chapas (TIF)
3. Outros (TIF sem padrão de placa)

Sem alterar ordem de persistência/ZIP no modal de lançamento (pedido é só exibição).

## Alterações

### 1. `ArquivosChapaList` — JSX

Em [`GravacaoExternaPreview.tsx`](apps/web/src/features/gravacao-externa/components/GravacaoExternaPreview.tsx) (~499–632), mover o bloco `{espelhos.length > 0 ? …}` para **antes** de `{chapas.map(…)}`. Manter `others` no final.

Isso cobre:
- aba **Externa** (lista flat)
- cada seção de máquina na aba **Pendente** (se algum grupo tiver PDF)

### 2. Sort com `groupByMachine`

No comparator de `machineGroups` (~679–689), inverter a prioridade de grupos sem máquina:

- Hoje: `!maquina` → último  
- Novo: `!maquina` → primeiro  

Assim **"Espelhos / sem máquina"** fica no topo, depois as máquinas (qty ascendente + label, como hoje).

### 3. Testes

Em [`GravacaoExternaPreview.test.tsx`](apps/web/src/features/gravacao-externa/components/GravacaoExternaPreview.test.tsx):

- Atualizar o teste de `groupByMachine`: esperar que `"Espelhos / sem máquina"` seja o **primeiro** heading (não o último).
- No teste de PDF (ou um assert extra): garantir ordem no DOM — botão "Espelhos de chapa" aparece **antes** do botão do caderno TIF (via `compareDocumentPosition` ou índices em `getAllByRole("button")`).

## Verificação

- `pnpm --filter @sagra/web test -- GravacaoExternaPreview`
- Conferir visualmente nas abas Pendente e Externa com OS que tenha PDF + TIFs
