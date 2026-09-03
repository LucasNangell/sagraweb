---
name: Flipbook page stack
overview: "Adicionar pilhas laterais dinâmicas no Folhear (2D page-flip): espessura visual esquerda/direita proporcional às páginas já viradas vs. restantes, atualizando a cada navegação."
todos:
  - id: helper-counts
    content: Criar flipbookPageStack.ts (counts + width clamp) e testes unitários
    status: completed
  - id: dom-css
    content: Renderizar stacks no slot 2p + CSS listrado; reservar gutter no stage
    status: completed
  - id: verify-nav
    content: Validar capa/miolo/contracapa e regressão de overlays/PageFlip
    status: completed
isProject: false
---

# Page stack dinâmico no flipbook

## Contexto

O Folhear usa `PageFlip` em [`ProvaWebFlipbook.tsx`](apps/web/src/features/prova-web/ProvaWebFlipbook.tsx) dentro de um slot 2p fixo. Hoje só há sombra de gutter na lombada; **não há** pilha nas bordas externas. Espessura listrada já existe no mockup fechado (`.prova-web-book-mockup__face--block` em [`prova-web-book-mockup.css`](apps/web/src/features/prova-web/prova-web-book-mockup.css)).

**Estilo escolhido:** faixas laterais com padrão de folhas empilhadas (repeating gradient), não bloco 3D. Cresce/diminui com a quantidade de páginas de cada lado, com clamp para livros longos.

## Contagem (pura, testável)

Extrair helper (ex. [`flipbookPageStack.ts`](apps/web/src/features/prova-web/flipbookPageStack.ts)):

```ts
flipbookPageStackCounts(total, pageIndex) → { left: number; right: number }
```

Alinhado a `resolveVisiblePages`:

| Estado | left | right |
|--------|------|-------|
| Capa (`pageIndex === 0`) | 0 | `total - 1` |
| Contracapa (`pageIndex >= total - 1`) | `total - 1` | 0 |
| Spread com página esquerda `L` | `L` | `total - (L + 2)` |

Espessura em px: `clamp(0, count * pxPerPage, maxPx)` (ex. ~0.35–0.5 px/página, max ~18–24 px). Com 0 páginas → `display: none` / width 0.

## Inserção no DOM

No slot 2p (~linhas 576–666 de `ProvaWebFlipbook.tsx`), **irmãos** de `.prova-web-book` (nunca dentro das `.prova-web-page` — o PageFlip as transforma):

```
slot (relative)
  ├─ stack left   (absolute, borda externa da página esquerda)
  ├─ .prova-web-book
  ├─ stack right  (absolute, borda externa da página direita)
  ├─ overlays…
```

- **Spread:** esquerda do slot / direita do slot, altura ≈ `baseSize.height`, alinhadas às bordas do livro aberto.
- **Capa só (flush direita):** pilha só à direita da capa; esquerda width 0.
- **Contracapa:** pilha só à esquerda.

Reservar gutter no stage (`padX` / `maxStackPx`) para o `overflow-hidden` do estágio não cortar as pilhas, ou desenhar as pilhas **ligeiramente sobrepostas** à borda externa da página (2–4 px) se preferir zero impacto no fit — default: **gutter reservado** no `measure` do `stageRef` (+ `maxStackPx` em cada lado).

## CSS

Em [`prova-web.css`](apps/web/src/features/prova-web/prova-web.css), classes novas (ex. `.prova-web-page-stack`, `--left`, `--right`):

- `position: absolute`, `pointer-events: none`, `z-index` abaixo dos overlays de Análise Lab / special chips
- Background no espírito do mockup: `repeating-linear-gradient` horizontal (folhas) + sombra leve na aresta
- `transition: width 180ms ease` para acompanhar a navegação sem salto brusco
- Durante `flipping`, manter contagens do `pageIndex` atual (já sincronizado no evento `flip`); a transição de width cobre o meio

## Escopo

- Só o flipbook **horizontal** Folhear (`ProvaWebFlipbookHorizontal`).
- Fora: modo folhas, pager espiral vertical, mockup 3D, viewer físico não ligado ao shell.

## Testes

Arquivo [`flipbookPageStack.test.ts`](apps/web/src/features/prova-web/flipbookPageStack.test.ts): capa, miolo, contracapa, livro curto (2–3 págs), total 0/1.

## Critérios de aceite

- Ao abrir a capa, pilha direita reflete o miolo restante; esquerda some.
- No meio do livro, esquerda cresce e direita diminui a cada virada (e o inverso ao voltar).
- Na contracapa, só pilha esquerda.
- Páginas especiais / overlays continuam clicáveis; virar página do PageFlip não quebra.
- Fit do livro não “pula” de forma perceptível ao mudar a espessura (gutter estável = max, ou pilha inset).
