---
name: Faca topológica e preview pro
overview: Substituir a detecção de painéis por grade/raster por extração topológica de faces com shapely, dobras com segmento 2D real (qualquer ângulo), e reescrever a cinemática 3D em coordenadas canônicas da net com rotação em eixo arbitrário, mais acabamento de render profissional e um validador de importação no Admin.
todos:
  - id: shapely-faces
    content: Adicionar shapely>=2.0 ao app/backend/requirements.txt e reescrever build_panel_graph_from_parsed para extrair faces via unary_union + set_precision + polygonize, removendo grade axis-aligned, máscara raster 1,5 mm, marching squares e _edge_cover_ratio
    status: completed
  - id: hinge-segment
    content: Hinges com segmentMm (segmento 2D real, qualquer ângulo) pareados por interseção face/dobra; axis e positionMm derivados; normalize_box_model_config aceita formato antigo e novo sem migração
    status: completed
  - id: svg-sequence
    content: Ler data-fold-order / data-fold-angle / data-fold-towards das paths de dobra no SVG e popular operations automaticamente em vez de devolver lista vazia
    status: completed
  - id: pdf-curves
    content: Tesselar itens de curva ('c') em _line_segments do parse de PDF reaproveitando _cubic_bezier_points
    status: completed
  - id: box-kinematics
    content: "Extrair boxKinematics.ts puro e reescrever boxGraphScene com coordenadas canônicas da net: geometria em coords da net, pivô em hingeOrigin - parentPivotOrigin, mesh em -hingeOrigin, rotação por setFromAxisAngle no eixo do hinge"
    status: completed
  - id: uv-polygonoffset
    content: UV por vértice via UVGenerator do ExtrudeGeometry (u = x_net/netW) substituindo map.offset/repeat, e anti z-fight por polygonOffset em vez do deslocamento geométrico zOff = depth * 0.02
    status: completed
  - id: render-finish
    content: OrbitControls com damping, sombras PCFSoftShadowMap, MeshPhysicalMaterial com laterais kraft, LineSegments nos vincos e easing easeInOutCubic em setOpen01
    status: completed
  - id: admin-validator
    content: Overlay de diagnóstico em BoxModelDielineEditor (segmentos crus, faces, hinges, IDs) e warnings estruturados com pointMm devolvidos por parse-faca, clicáveis para zoom
    status: completed
  - id: svg-contract-doc
    content: "Documentar o contrato de export SVG com template: camadas corte/dobras, corte_perimetro, camada paineis com data-panel-id e atributos de sequência nas dobras"
    status: completed
  - id: tests
    content: Fixtures SVG (aba trapezoidal, contorno curvo, vinco diagonal, contorno aberto, sequência embutida) + testes puros de boxKinematics; rodar pytest e vitest e validar em DEV com a faca que está errando
    status: completed
isProject: false
---

## Diagnóstico: por que erra hoje

O parser de SVG está bom — a tesselação de C/S/Q/T/A com passo de 0,75 mm produz polilinhas fiéis. O erro nasce depois, em três camadas que se somam.

**1. Painéis são inventados por grade, não extraídos da geometria.** Em [app/backend/services/prova_web_box_panel_graph.py](app/backend/services/prova_web_box_panel_graph.py) as curvas fiéis são jogadas numa grade axis-aligned de vincos H/V e validadas contra uma máscara raster de 1,5 mm:

```421:432:app/backend/services/prova_web_box_panel_graph.py
    vs = [
        float(v)
        for v in (parsed.get("verticalCreasesMm") or [])
        if x0 + 1 < float(v) < x1 - 1
    ]
```

O contorno de cada painel é então reconstruído por marching squares em células de 1,5 mm e simplificado com tolerância de 0,45 mm. Toda curva fina degrada ou some, abas trapezoidais viram retângulos, e vincos diagonais são descartados na origem porque `_fold_axes_from_segs` só aceita `dx <= 0,8` ou `dy <= 0,8`. Se o contorno de corte não fechar, o flood-fill falha e o código assume "tudo dentro", criando painéis fantasmas.

**2. O 3D posiciona pelo AABB, com convenções de origem inconsistentes.** Em [apps/web/src/features/prova-web/box-engine/boxGraphScene.ts](apps/web/src/features/prova-web/box-engine/boxGraphScene.ts), a dobra é um escalar com eixo só `vertical`/`horizontal`, e o mesh do filho recebe Y = 0 mesmo tendo sido construído relativo a `pc.yMm`:

```195:207:apps/web/src/features/prova-web/box-engine/boxGraphScene.ts
    if (hinge?.axis === "vertical") {
      const sharedX = hinge.positionMm - pp.xMm;
      localX = sharedX;
      localY = -(pc.yMm - pp.yMm);
      if (hasPoly) {
        child.mesh.position.set(pc.xMm - hinge.positionMm, 0, zOff);
```

O `spanStartMm`/`spanEndMm` que o backend calcula é descartado no frontend (o cast de hinges só lê `axis` e `positionMm`). E o anti z-fighting desloca fisicamente cada nível em Z (`zOff = depth * 0.02`), fazendo os painéis flutuarem e descolarem nas dobras.

**3. A arte é mapeada por retângulo.** `panelMaterial` usa `map.offset`/`map.repeat` sobre o AABB do painel, sem UV por vértice — em painel não retangular a arte não acompanha a forma.

## Sobre a stack: three.js está certo, o modelo geométrico não

É three.js 0.185 imperativo, com loop `requestAnimationFrame` próprio. Não há React Three Fiber, drei, GSAP, framer-motion nem tween.js; a órbita é drag manual e não há sombras.

Recomendação: **manter three.js imperativo**. Migrar para R3F seria um refactor grande sem ganho de qualidade visual, e o controle fino do loop de render sob demanda que já existe é uma vantagem. GSAP também é desnecessário — o easing que falta são ~30 linhas. Vou adicionar apenas `OrbitControls`, que já vem no pacote `three`.

O que realmente falta já existe no repositório: o `fold-engine` (`apps/web/src/features/prova-web/fold-engine/`) faz cinemática por matrizes com eixo de dobra 3D real (`resolveWorldHinge`, `makeRotationAroundLine`), colisão OBB, UV por vértice e anti z-fight por `polygonOffset`. O plano converge o box-engine para esse padrão.

## Fase 1 — Extração topológica de faces (backend)

Adicionar `shapely>=2.0,<3.0` em [app/backend/requirements.txt](app/backend/requirements.txt).

Reescrever o núcleo de [prova_web_box_panel_graph.py](app/backend/services/prova_web_box_panel_graph.py) trocando grade + máscara + marching squares por arranjo planar. O idioma do shapely faz exatamente a extração de faces por half-edge, em C:

```python
from shapely.geometry import LineString
from shapely.ops import polygonize, unary_union
import shapely

lines = [LineString([(s["x1"], s["y1"]), (s["x2"], s["y2"])])
         for s in cut_segs + fold_segs]
noded = shapely.set_precision(unary_union(lines), _WELD_TOL_MM)  # 0.05 mm
faces = [f for f in polygonize(noded) if f.area >= _MIN_FACE_MM2]
```

- `unary_union` faz o noding (quebra segmentos nas interseções) e o `set_precision` solda pontas quase coincidentes dentro de 0,05 mm.
- `polygonize` devolve as faces mínimas com o polígono **exato** na resolução da tesselação. Sem grade, sem raster, sem 1,5 mm.
- Curvas, abas trapezoidais e vincos diagonais passam a funcionar sem tratamento especial.
- Remover `_build_inside_cut_mask`, `_contour_from_mask_roi`, `_edge_cover_ratio`, `_MASK_STEP_MM`, `_POLY_AREA_FRAC` e a montagem de `xs`/`ys`.
- `netOutlineMm`: `corte_perimetro` quando presente, senão `unary_union(faces).exterior` — muito mais fiel que o traçado da máscara.
- `polygonMm` = `list(face.exterior.coords)`; `xMm/yMm/wMm/hMm` = `face.bounds` (mantidos só para enquadramento e compatibilidade, nunca mais para posicionar).

## Fase 2 — Dobras com segmento real e sequência vinda do SVG

**Hinge com geometria, não escalar.** Cada segmento de dobra que separa duas faces gera:

```python
{"id": ..., "panelA": ..., "panelB": ...,
 "segmentMm": [[x1, y1], [x2, y2]],   # novo: eixo real, qualquer ângulo
 "axis": "vertical" | "horizontal" | "oblique",  # derivado, retrocompat
 "positionMm": ...}                    # derivado, retrocompat
```

O pareamento face↔dobra usa `face.exterior.buffer(tol).intersection(fold_line).length >= 0.5 * fold_line.length`, o que também elimina o problema de dobra que atravessa vão entre flaps.

**Compatibilidade sem migração de dados:** `normalize_box_model_config` em [prova_web_box_model_service.py](app/backend/services/prova_web_box_model_service.py) aceita as duas formas — se vier só `axis` + `positionMm` + span (modelos já salvos), deriva `segmentMm`; se vier `segmentMm`, deriva `axis`/`positionMm`. Nada quebra em produção.

**Sequência automática.** Como controlamos o export, ler atributos opcionais nas paths de dobra em [prova_web_dieline_svg.py](app/backend/services/prova_web_dieline_svg.py): `data-fold-order`, `data-fold-angle`, `data-fold-towards`. Quando presentes, `build_panel_graph_from_parsed` popula `operations` em vez de devolver `[]`, e o operador deixa de montar a sequência à mão em cada modelo.

**PDF:** `_line_segments` em [prova_web_dieline_service.py](app/backend/services/prova_web_dieline_service.py) hoje só lê itens `"l"` e `"re"`, ignorando `"c"` do PyMuPDF — por isso faca em PDF com curva nunca funciona. Tesselar os itens `"c"` reaproveitando `_cubic_bezier_points`.

## Fase 3 — Cinemática canônica no 3D (a correção do posicionamento)

Reescrever a montagem da cena em [boxGraphScene.ts](apps/web/src/features/prova-web/box-engine/boxGraphScene.ts) com **uma única convenção**: toda geometria é construída em coordenadas da net (`x - cx`, `-(y - cy)`), e nenhum cálculo usa AABB.

- `panelGeometry`: `THREE.Shape` a partir de `polygonMm` em coordenadas da net (não relativo a `panel.xMm`), extrudado com `depth = thickness`.
- Pivô do filho: `childPivot.position = hingeOrigin - parentPivotOrigin` (acumulando os pivôs ao descer a árvore), e `childMesh.position = -hingeOrigin`. Com rotação zero, o painel cai exatamente na posição plana — é o invariante que hoje não existe.
- Rotação em eixo arbitrário: `quaternion.setFromAxisAngle(hingeDir.normalize(), angle)` a partir de `segmentMm`, substituindo `rotation.set(0, y, 0)` / `rotation.set(-x, 0, 0)`. Dobra diagonal passa a funcionar.
- Extrair essa matemática para um módulo puro `boxKinematics.ts`, testável sem WebGL.
- UV por vértice via `UVGenerator` customizado no `ExtrudeGeometry`: `u = x_net / netW`, `v = 1 - y_net / netH`. Remove `map.offset`/`map.repeat` e corrige a arte em painel não retangular.
- Anti z-fight por `polygonOffset: true, polygonOffsetFactor: -depth` no material, eliminando o `zOff = depth * 0.02` que desloca a geometria.

## Fase 4 — Acabamento profissional de render

- `OrbitControls` de `three/examples/jsm/controls/OrbitControls.js` com `enableDamping`, mantendo o clamp de `MAX_ROT_X` e preservando o auto-spin idle de `useIdleYawSpin`.
- Sombras: `renderer.shadowMap.enabled` com `PCFSoftShadowMap`, uma luz direcional com `castShadow` e um plano receptor discreto sob a peça. É o que mais diferencia visualmente.
- Material de papel/cartão: `MeshPhysicalMaterial` com `sheen` leve na face impressa e material distinto (kraft) nas laterais da extrusão, usando os grupos de material do `ExtrudeGeometry`.
- Vincos visíveis: `LineSegments` finos sobre as arestas de dobra, para a peça ler como cartonagem e não como papel liso.
- Easing na dobra: pequeno tween com `easeInOutCubic` em `setOpen01` (~30 linhas em `boxTween.ts`), sem GSAP.

## Fase 5 — Importação confiável: contrato + validador no Admin

O que torna a importação previsível é ver o que o parser viu.

- **Overlay de diagnóstico** em [BoxModelDielineEditor.tsx](apps/web/src/features/configuracoes/components/BoxModelDielineEditor.tsx): camadas ligáveis para segmentos de corte crus, segmentos de dobra crus, faces detectadas, segmentos de hinge e IDs de painel. Já é SVG em mm nativo, então é só acrescentar camadas.
- **Warnings estruturados** devolvidos por `parse_faca_to_box_config` e pela rota `parse-faca` em [admin_box_model_routes.py](app/backend/routers/admin_box_model_routes.py): contorno aberto com a coordenada do vão, face descartada por área mínima, painel sem nenhuma dobra, dobra que não separa duas faces, dobra oblíqua detectada. Cada warning carrega `pointMm` e a UI dá zoom nele ao clicar.
- **Contrato de export documentado** (`docs/` ou seção no guia Admin) com SVG template: camada `corte` em `#ED3237`, camada `dobras` em `#00AFEF`, `id="corte_perimetro"` no contorno, opcionalmente camada `paineis` com `data-panel-id`/`data-panel-label` e `data-fold-order`/`data-fold-angle`/`data-fold-towards` nas dobras. Com a camada `paineis` presente, o fast-path já existente pula qualquer inferência — é o caminho garantido para modelos difíceis.

## Fase 6 — Testes e verificação

Backend, em [test_prova_web_box_models.py](app/backend/tests/test_prova_web_box_models.py) com novas fixtures SVG: aba trapezoidal (polígono com 4 vértices não retangulares, AABB diferente da face), contorno curvo (vértices na curva preservados, sem degradação de 1,5 mm), vinco diagonal (hinge com `segmentMm` oblíquo), contorno aberto (gera warning e zero painéis fantasmas), e SVG com `data-fold-order` (gera `operations` não vazio).

Frontend: testes puros de `boxKinematics.ts` — flap rotacionado 90° em torno de hinge diagonal aterrissa na posição esperada; invariante de rotação zero devolve a posição plana exata; UV de vértice em painel trapezoidal.

Comandos: `python -m pytest app/backend/tests/test_prova_web_box_models.py -q` e `pnpm --filter web test`. Validação manual em DEV com a faca real que está errando, comparando o overlay 2D com o SVG de origem.

## Ordem de execução e risco

As fases 1 e 2 são o núcleo e devem ir juntas, porque o formato de hinge muda. A fase 3 depende delas. As fases 4 e 5 são independentes entre si e podem ser feitas depois que o posicionamento estiver correto.

Risco de produção: a única alteração de ambiente é `shapely` no `requirements.txt`, que precisa de `pip install` no próximo deploy. Nenhuma mudança de schema, e os modelos já salvos continuam a abrir pela retrocompatibilidade de hinge da fase 2.