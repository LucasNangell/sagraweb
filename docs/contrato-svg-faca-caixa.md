# Contrato SVG — faca de caixa (Prova WEB)

Exportar a faca a partir do Illustrator/CorelDRAW seguindo este contrato. O Admin importa o SVG e monta painéis/dobras sem adivinhar geometria.

**Tutorial passo a passo (CorelDRAW):** [tutorial-exportar-faca-svg-coreldraw.md](./tutorial-exportar-faca-svg-coreldraw.md).

## Camadas e cores

| Camada / id | Cor sugerida | Função |
|-------------|--------------|--------|
| `corte` | `#ED3237` | Traços de corte |
| `dobras` | `#00AFEF` | Traços de dobra (vincos) |
| `corte_perimetro` (id do path) ou `data-sagra="cut-outline"` | — | Contorno externo da peça |
| `paineis` (opcional) | fill qualquer | Faces explícitas — pula inferência |

Stroke sólido = corte; `stroke-dasharray` ou camada `dobras` = dobra.

## Contorno canônico

Um único path fechado com `id="corte_perimetro"` (ou `data-sagra="cut-outline"`). Preferir curvas Bézier/arco nativas — o parser tessela com passo ~0,75 mm.

## Painéis explícitos (recomendado em modelos difíceis)

```xml
<g id="paineis">
  <path data-sagra="panel" data-panel-id="base"
        d="M 0 0 H 100 V 60 H 0 Z" fill="#eee" stroke="none"/>
  <path data-sagra="panel" data-panel-id="tampa"
        d="M 0 60 H 100 V 100 H 0 Z"/>
</g>
```

Com a camada `paineis` presente, o backend **não** polygoniza — usa esses polígonos.

## Sequência de dobra no SVG (opcional)

Nas paths/lines de dobra:

| Atributo | Exemplo | Efeito |
|----------|---------|--------|
| `data-fold-order` | `1` | Ordem na sequência (mesmo valor = passo paralelo) |
| `data-fold-angle` | `90` | Ângulo alvo (graus, com sinal) |
| `data-fold-towards` | `front` \| `back` | Sentido da dobra |
| `data-fold-side` | `positive` \| `negative` | Lado móvel |

Exemplo:

```xml
<line id="dobra_tampa" x1="0" y1="60" x2="100" y2="60"
      stroke="#00AFEF" stroke-dasharray="4 2"
      data-fold-order="1" data-fold-angle="90" data-fold-towards="front"/>
```

Sem esses atributos, a sequência continua vazia e o operador monta no Admin.

## Template mínimo

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="100mm"
     viewBox="0 0 120 100">
  <g id="corte" stroke="#ED3237" fill="none" stroke-width="0.35">
    <path id="corte_perimetro" data-sagra="cut-outline"
          d="M 10 10 H 110 V 90 H 10 Z"/>
  </g>
  <g id="dobras" stroke="#00AFEF" fill="none" stroke-width="0.35"
     stroke-dasharray="3 2">
    <line id="dobra_h" x1="10" y1="50" x2="110" y2="50"
          data-fold-order="1" data-fold-angle="90"/>
  </g>
</svg>
```

## Diagnóstico no Admin

Após importar, use as camadas do editor 2D (Faces / Cortes / Dobras / Hinges / IDs) e a lista de avisos. Clique num aviso para destacar o ponto problemático (vão de contorno, dobra órfã, face pequena).
