---
name: Faca SVG Admin
overview: Trocar o pré-cadastro de modelos de caixa para importar SVG (contínuo = corte, pontilhado = dobra), montar o grafo a partir dessas linhas e deixar o Admin configurar só sequência e ângulo de cada dobra — alinhado à faca do anexo.
todos:
  - id: svg-parser
    content: Implementar parse_dieline_svg (dasharray/class → cut/fold + segmentos mm)
    status: completed
  - id: api-store-svg
    content: parse_faca_to_box_config + rotas Admin aceitam/armazenam/servem SVG
    status: completed
  - id: admin-ux-simplify
    content: Upload SVG; UI só sequência+ângulo; remover Corte/Dobra do fluxo principal
    status: completed
  - id: fixture-tests
    content: Fixture SVG estilo anexo + pytest/vitest smoke
    status: completed
isProject: false
---

# Faca SVG no Admin (corte contínuo / dobra pontilhada)

## Problema

Hoje o Admin importa **PDF** e classifica via `page.get_drawings()` + `dashes` em [`prova_web_dieline_service.py`](app/backend/services/prova_web_dieline_service.py). Em facas reais (Corel/Illustrator) o pontilhado frequentemente **não chega** como dash (vira traços curtos sólidos, ou paths complexos) → o sistema mistura corte/dobra e a UI de “Corte/Dobra” fica confusa.

O anexo mostra a regra desejada com clareza: **linha contínua = corte**, **linha pontilhada = dobra**. O operador Admin deve só montar a **sequência** e o **ângulo** das dobras.

## Decisão

- **Formato principal no Admin:** SVG (não PDF).
- **Classificação:** `stroke-dasharray` presente / não-vazio → **dobra**; senão → **corte**. Override se `id`/`class` contiver `fold`/`dobra` ou `cut`/`corte`.
- **Heurística extra:** sequência de segmentos colineares curtos e regulares (dash “desenhado”) → tratar como dobra.
- **PDF no cadastro Admin:** deixa de ser o fluxo principal (upload passa a aceitar `.svg`). O modo Prova legado `combined`/`separate` com PDF por OS permanece intacto.
- **Armazenamento:** reutilizar o LONGBLOB atual (`FacaPdf`) + `FacaFileName` (ex. `faca.svg`); endpoint de download passa a servir `image/svg+xml` quando a extensão for `.svg`.

```mermaid
flowchart LR
  svg[SVG_faca]
  parse[parse_dieline_svg]
  graph[build_panel_graph]
  model[tabProvaWebBoxModel]
  admin[Admin_sequencia_angulo]
  prova[Prova_modelo_mais_arte]
  svg --> parse --> graph --> model
  model --> admin
  model --> prova
```

## Backend

### 1. Parser SVG → mesmo contrato do parse PDF

Novo módulo (ou funções em [`prova_web_dieline_service.py`](app/backend/services/prova_web_dieline_service.py)):

- Entrada: bytes SVG.
- Extrair `path` / `line` / `polyline` / `polygon` / `rect` (com `transform` simples: `matrix`/`translate`/`scale`).
- Unidades: preferir `viewBox` + mapa para mm (atributo `width`/`height` em mm, ou convenção `1 user unit = 1 mm` se sem unidade explícita — documentar no UI).
- Produzir o **mesmo** dict que `parse_dieline_page` hoje:
  - `pageWidthMm`, `pageHeightMm`, `cutBboxMm`
  - `foldSegmentsMm`, `cutSegmentsMm`
  - `verticalCreasesMm`, `horizontalCreasesMm` (eixos V/H a partir só das dobras)
- Reusar [`build_panel_graph_from_parsed`](app/backend/services/prova_web_box_panel_graph.py) (já deixa `operations: []`).

### 2. Orquestração e API Admin

- [`parse_faca_to_box_config`](app/backend/services/prova_web_box_model_service.py): detectar SVG (`filename`/magic/`<svg`) vs PDF; branch SVG chama o novo parser.
- [`admin_box_model_routes.py`](app/backend/routers/admin_box_model_routes.py): `parse-faca` e create/update aceitam `.svg`; GET faca responde SVG ou PDF conforme arquivo.
- Limite de tamanho mantido (~25 MB).

### 3. Fixture de teste

- Criar SVG sintético espelhando o anexo (painéis em fileira + flaps + glue flap; contínuo/pontilhado) em `app/backend/tests/fixtures/caixa_dieline_exemplo.svg`.
- Pytest: dobras ≥ N, cortes ≥ N, `operations == []`, hinges entre painéis principais; smoke `parse → mockup`.

## Frontend Admin

### UX simplificada (só sequência + ângulo)

Em [`BoxModelsSection.tsx`](apps/web/src/features/configuracoes/components/BoxModelsSection.tsx) / editor:

1. Upload **SVG da faca**.
2. Preview SVG/net com cortes (sólido) e dobras (tracejado) vindos do parse — **sem** botões Corte/Dobra no fluxo principal.
3. Lista **Sequência** começa vazia.
4. Clique numa **dobra** → **Adicionar à sequência** (ordem = clique) → campos: ângulo, painel móvel, direção, ↑↓.
5. Painel base continua clicável no retângulo.

Remover (ou esconder) a classificação manual Corte/Dobra; o SVG é a fonte da verdade. Manter só “Remover da sequência”.

Ajustes em [`boxModels.ts`](apps/web/src/api/boxModels.ts) (`accept` / labels) e [`BoxModelDielineEditor.tsx`](apps/web/src/features/configuracoes/components/BoxModelDielineEditor.tsx) (legenda: contínuo=corte, pontilhado=dobra).

## Grafo 3D / Prova

Sem mudança de contrato: `ConfigJson` com `edges`/`hinges`/`operations`/`panels` continua consumido por [`boxMockupFromConfig.ts`](apps/web/src/features/prova-web/box-engine/boxMockupFromConfig.ts) e render com `boxModelId` + `artTransform`.

Limitação aceita neste ciclo: painéis ainda via **grade eixo-alinhada** dos vincos V/H (adequada à tipología do anexo: corpos retangulares + flaps). Cantos arredondados/diagonais entram no **contorno de corte** (bbox/segments), não como painéis irregulares. Polígonos de face livres ficam fora do MVP.

## Critérios de aceite

- Importar SVG do tipo do anexo → dobras pontilhadas e cortes contínuos corretos na preview.
- Lista de sequência inicia vazia; só dobras entram; ângulo/ordem editáveis.
- Admin não exige reclassificar corte/dobra manualmente.
- Pytest com fixture SVG verde; fluxo Prova modelo+arte inalterado.
- PDF legado de OS (não Admin) não quebra.
