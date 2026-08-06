---
name: Fix Folhear load fit
overview: Corrigir o Folhear travado na página 1 (race loadedSrc vs reset) e o enquadramento que corta A5, medindo o estágio real e escalando em contain — mudanças isoladas em ProvaWebFlipbook (+ CSS se preciso), reaproveitadas no portal e staff.
todos:
  - id: fix-loadedsrc-race
    content: Unificar reset/seed de loadedSrc; estado inicial com janela da página 0
    status: completed
  - id: fit-contain-stage
    content: ResizeObserver + scale contain 1p/2p; PageFlip fixed ou maxWidth coerente; update no flip/resize
    status: completed
  - id: verify-folhear
    content: Checar capa sem spinner, A5 sem corte; regressão zoom/navegação; mockup intacto
    status: completed
isProject: false
---

# Folhear: loading na capa + fit sem corte

## Problemas confirmados

### 1. Spinner na primeira página até folhear

Em [`ProvaWebFlipbook.tsx`](apps/web/src/features/prova-web/ProvaWebFlipbook.tsx), na montagem:

1. Efeito progressivo (L89) enfileira `setLoadedSrc` com URLs da janela (página 0).
2. Efeito de reset por `cacheKey` (L117) enfileira **`setLoadedSrc({})` depois**.
3. `pageIndex` já é `0` → o reset não muda deps → o progressivo **não roda de novo**.

Resultado: `loadedSrc` vazio → placeholder shimmer; ao mudar de página, `pageIndex` muda e as imagens aparecem. Afeta staff e portal (mesmo componente).

### 2. Livro A5 cortado em cima/baixo

- `baseSize` usa `window.innerHeight - 190`, ignora largura e a altura real do estágio (header/tabs/padding).
- Host com `maxWidth = baseSize.width * 2` mesmo em capa (retrato); PageFlip `stretch` + `showCover` gera altura exagerada.
- Container com `overflow-hidden` → corta. CSS das imgs já é `object-fit: contain`; o bug é a **caixa do livro**, não o crop da imagem.

```mermaid
flowchart LR
  mount[Mount Folhear]
  seed[Progressive seed]
  wipe[Reset loadedSrc vazio]
  stuck[Placeholder na capa]
  flip[Mudar pagina]
  ok[Imagens aparecem]
  mount --> seed --> wipe --> stuck
  stuck --> flip --> ok
```

## Correções (só Folhear)

Arquivo principal: [`ProvaWebFlipbook.tsx`](apps/web/src/features/prova-web/ProvaWebFlipbook.tsx). Shell/mockup 3D intactos.

### A. Loading estável

- Extrair helper `seedLoadedWindow(pages, pageIndex, pageUrl)`.
- **Unificar** reset + seed: um efeito em `[cacheKey, pageUrl, pages, total]` que zera índice/jump e seta `loadedSrc` já com a janela da página 0 (e capas).
- Efeito progressivo em `[pageIndex, …]` só **adiciona** entradas (sticky), sem depender do wipe.
- Estado inicial: `useState(() => seed…)` quando `pages`/`pageUrl` existem, para o primeiro paint já ter `<img>`.
- Remover o efeito isolado que só faz `setLoadedSrc({})`.

Não remontar PageFlip a cada mudança de `loadedSrc`.

### B. Fit contain no estágio

- Medir o container do livro (`flex-1` / stage) com **`ResizeObserver`** (mesmo padrão de [`ProvaWebBookMockup3D.tsx`](apps/web/src/features/prova-web/ProvaWebBookMockup3D.tsx)).
- Com `availW` / `availH` e metadados `pageW`/`pageH` do manifesto:
  - Capa/retrato (`pageIndex === 0` ou página ímpar isolada com cover): escala para caber **1 página** em `availW × availH`.
  - Espalmado (2 páginas): escala para caber **`2*pageW × pageH`** em `availW × availH`.
  - `scale = min(1, availW/needW, availH/needH)`.
- Aplicar `baseSize` derivado dessa escala; no PageFlip preferir **`size: "fixed"`** com `width`/`height` = `baseSize`, ou manter stretch mas com `maxWidth` coerente ao modo atual (1× vs 2× page width).
- Ao mudar orientação (flip capa ↔ miolo) ou resize: `flip.update()` / reaplicar dimensões sem `destroy` se a API permitir; se não, reinit só quando size/cacheKey mudar (já há cleanup).
- Outer: `maxWidth` alinhado ao modo (1 página na capa, 2 no miolo); estágio continua centrado; evitar cortar — priorizar shrink contain sobre `overflow-hidden` agressivo.

### C. CSS

Revisar [`prova-web.css`](apps/web/src/features/prova-web/prova-web.css) só se o wrapper do PageFlip ainda forçar altura via `paddingBottom` incompatível com `fixed`; ajustar `.prova-web-book` / page box sem tocarmos mockups 3D.

## Verificação

- Abrir Folhear staff e portal: capa mostra imagem sem spinner eterno; sem precisar “próxima → voltar”.
- Prova A5 (retrato): capa e espalhado cabem inteiros no estágio (margens ok, nada cortado).
- Folhear miolo / zoom / fullscreen / setas / jump: intactos.
- Mockup 3D / folheto: sem mudança.

Smoke manual recomendado (OS A5 + OS landscape se houver). Teste unitário leve opcional: helper de seed + fórmula `scale = min(availW/needW, availH/needH)` se extrair funções puras.
