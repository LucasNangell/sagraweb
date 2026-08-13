# Tutorial: exportar faca SVG no CorelDRAW (Prova WEB)

Guia prático para montar a faca no CorelDRAW e exportar um SVG que o SAGRA Web reconhece sem erros de painel/posição.

Contrato técnico resumido: [contrato-svg-faca-caixa.md](./contrato-svg-faca-caixa.md).

---

## 1. O que o sistema espera

O Admin lê **só traços** (stroke). Ignora fills decorativos, textos e bitmaps.

| Tipo de traço | Como identificar | Função |
|---------------|------------------|--------|
| **Corte** | Camada `corte` **ou** cor `#ED3237` | Contorno e cortes internos |
| **Dobra (vinco)** | Camada `dobras` **ou** cor `#00AFEF` **ou** linha tracejada | Junta entre painéis |
| **Contorno da peça** | Objeto com nome `corte_perimetro` | Silhueta externa (curvas OK) |
| **Painéis (opcional)** | Camada `paineis` | Faces explícitas — caminho mais seguro |

Unidades: **milímetros**. Desenhe e exporte em mm (não em pixels).

---

## 2. Preparar o documento no CorelDRAW

1. **Arquivo → Novo**
2. Unidade da página: **mm**
3. Tamanho da página: um pouco maior que a faca aberta (ex.: 300 × 200 mm)
4. Remova guias, sangria e arte gráfica deste arquivo — a faca deve ficar **só com linhas de produção**
5. Use **curvas Bézier / elipses / retângulos** nativos. Não converta tudo em bitmap. Curvas finas são bem-vindas; o sistema as tessela depois.

### Cores (paleta fixa)

Crie duas cores RGB (ou CMYK equivalentes, desde que o SVG saia com esses hex):

| Uso | RGB | Hex no SVG |
|-----|-----|------------|
| Corte | R 237, G 50, B 55 | `#ED3237` |
| Dobra | R 0, G 175, B 239 | `#00AFEF` |

Aplique **apenas no contorno (outline)**. Preenchimento dos traços de corte/dobra: **nenhum**.

Espessura sugerida do outline: **0,25–0,5 mm** (só visual; o parser não usa a espessura para medir).

---

## 3. Camadas (obrigatório)

No **Gerenciador de objetos**, crie exatamente estas camadas (nomes em minúsculas, sem acento):

```
corte
dobras
paineis          ← opcional, mas recomendado em facas complexas
```

Ordem sugerida (de baixo para cima): `paineis` → `corte` → `dobras`.

O exportador do Corel costuma gerar grupos `<g id="corte">`, `<g id="dobras">` etc. O SAGRA usa o **nome da camada** para classificar o traço — mais confiável do que só a cor.

---

## 4. Objeto a objeto: o que incluir

### 4.1 Camada `corte`

| Objeto | Nome do objeto (Object Manager) | Outline | Fill | Observação |
|--------|----------------------------------|---------|------|------------|
| Contorno externo da peça | **`corte_perimetro`** | `#ED3237` sólido | nenhum | **Um único path fechado.** Pode ter curvas, cantos arredondados, abas. Este nome é o mais importante do arquivo. |
| Cortes internos (janelas, furos) | `corte_janela_1`, `corte_cola`, etc. | `#ED3237` sólido | nenhum | Nome livre; útil no diagnóstico |
| Linhas de corte que não fecham o perímetro | nomes descritivos | `#ED3237` | nenhum | Devem conectar nas pontas — contorno aberto gera aviso e zero painéis |

**Regras do contorno:**

- Feche o path (primeira ponta = última).
- Não deixe vão de 0,1 mm “quase fechado” — o sistema solda até ~0,05 mm; acima disso o contorno falha.
- Não agrupe o perímetro com a arte; deixe como curva nomeada na camada `corte`.

### 4.2 Camada `dobras`

| Objeto | Nome | Outline | Estilo | Observação |
|--------|------|---------|--------|------------|
| Cada vinco | `dobra_tampa`, `dobra_aba_esq`, `dobra_h_1`… | `#00AFEF` | **Tracejado** (ex.: 3 mm / 2 mm) | Uma dobra = um segmento (ou path) contínuo entre dois painéis |
| Vincos diagonais | mesmo padrão | `#00AFEF` tracejado | OK — o motor aceita eixo oblíquo |

**Regras das dobras:**

- A dobra precisa **tocar a fronteira compartilhada** de dois painéis (não atravessar o vão entre abas soltas).
- Não use uma única linha longa atravessando três painéis; quebre em um segmento por junta.
- Prefira **linhas retas** ou paths simples. Evite “pincel artístico” e efeito de contorno.

### 4.3 Camada `paineis` (recomendado)

Use quando a faca tem abas trapezoidais, curvas fortes ou o Admin ainda “inventa” faces erradas.

| Objeto | Nome | Fill | Outline | Atributo mental |
|--------|------|------|---------|-----------------|
| Cada face da net | `base`, `tampa`, `aba_dir`, `lateral_esq`… | cinza claro qualquer | nenhum (ou bem fino) | Vira painel com esse id |

Cada painel deve ser um **polígono/path fechado** cobrindo só aquela face (sem sobrepor vizinhos). O sistema **pula a inferência automática** e usa esses shapes.

Dica: desenhe a face com a ferramenta Bézier / Polígono seguindo o contorno real (incluindo trapézios e cantos curvos).

### 4.4 O que **não** colocar no SVG da faca

- Arte da caixa, fotos, logos
- Textos de cotas, legendas, “1:1”
- Linhas de sangria / registro de impressão (a menos que sejam corte de verdade)
- Duplicatas da mesma dobra (sólida + tracejada)
- Grupos com transformações complexas sem “Quebrar grupo / Converter em curvas” quando necessário

---

## 5. Nomes e metadados no CorelDRAW

### O que o Corel exporta bem

No **Gerenciador de objetos**, o **nome do objeto** costuma virar `id="..."` no SVG. Use isso:

| Nome no Corel | Vira no SVG | Efeito no SAGRA |
|---------------|-------------|-----------------|
| `corte_perimetro` | `id="corte_perimetro"` | Contorno canônico |
| `dobra_tampa` | `id="dobra_tampa"` | Nome da aresta no diagnóstico |
| `base` (na camada `paineis`) | `id="base"` | Id do painel |

### Sequência de dobra (opcional)

O Admin monta a sequência na tela. Se quiser **já vir preenchida**, o SVG precisa dos atributos:

| Atributo | Valores | Significado |
|----------|---------|-------------|
| `data-fold-order` | `1`, `2`, `3`… | Ordem do passo (mesmo número = dobras em paralelo) |
| `data-fold-angle` | `90`, `-90`, `180`… | Ângulo alvo em graus |
| `data-fold-towards` | `front` ou `back` | Sentido |
| `data-fold-side` | `positive` ou `negative` | Lado móvel |

O CorelDRAW **não grava esses `data-*` pelo nome do objeto**. Duas opções:

**A) Exportar e editar o SVG** (mais simples)  
Abra o `.svg` no Bloco de Notas / VS Code e acrescente nos elementos de dobra:

```xml
<line id="dobra_tampa" ... stroke="#00AFEF" stroke-dasharray="3 2"
      data-fold-order="1" data-fold-angle="90" data-fold-towards="front"/>
```

**B) Deixar a sequência vazia**  
Importe no Admin e use “Adicionar à sequência” nas dobras — fluxo normal do dia a dia.

Para painéis explícitos opcionais no XML:

```xml
<path id="base" data-sagra="panel" data-panel-id="base" ... />
```

Se a curva já estiver na camada `paineis`, o `data-sagra="panel"` é opcional; o `id` / `data-panel-id` define o nome.

---

## 6. Passo a passo de exportação

1. Selecione **tudo** o que deve ir (ou deixe só as três camadas visíveis; oculte o resto).
2. **Arquivo → Exportar** (ou **Exportar para**).
3. Tipo: **SVG — Scalable Vector Graphics (*.svg)**.
4. Opções recomendadas (nomes variam por versão do Corel):
   - **Exportar texto como**: curvas (se houver texto residual)
   - **Unidades**: mm, se a opção existir
   - **Preservar nomes / IDs de objetos**: ligado
   - **Camadas** / estrutura de grupos: preservar
   - **Não** rasterizar
   - **Não** converter tudo em um único path
5. Salve com nome claro, ex.: `faca_caixa_tuck_80x50.svg`.
6. Abra o SVG em um editor de texto e confira rapidamente:
   - Existe `id="corte"` ou grupo com “corte”?
   - Existe `id="corte_perimetro"`?
   - Cores `#ED3237` / `#00AFEF` (ou camadas certas)?
   - Sem `image` / `base64` enorme?

---

## 7. Checklist antes de importar no Admin

- [ ] Documento em **mm**
- [ ] Camadas `corte` e `dobras` (e `paineis` se for o caso)
- [ ] Contorno fechado nomeado **`corte_perimetro`**
- [ ] Cortes em `#ED3237` sólido; dobras em `#00AFEF` tracejado
- [ ] Cada dobra cobre só **uma** junta entre dois painéis
- [ ] Sem arte, cotas ou bitmaps
- [ ] Objetos com nomes úteis (`dobra_…`, `base`, …)
- [ ] (Opcional) `data-fold-order` editado no SVG

---

## 8. Validar no SAGRA (Configurações → Modelos de caixa)

1. Importe o SVG.
2. No editor 2D, ligue as camadas de diagnóstico:
   - **Faces** — painéis detectados
   - **Cortes / Dobras** — segmentos crus
   - **Hinges** — juntas reconhecidas (roxo)
   - **IDs** — nomes dos painéis
3. Leia a lista **Avisos da importação**. Clique no aviso para marcar o ponto (vão, dobra órfã, face pequena).
4. Confira o preview 3D: aberto = plano; feche o slider e veja se as abas dobram no lugar certo.
5. Ajuste a sequência de dobra no painel direito, se não veio do SVG.
6. Salve o modelo.

### Problemas comuns

| Sintoma | Causa típica | Correção |
|---------|--------------|----------|
| “Contorno aberto” / zero painéis | Perímetro com gap | Feche `corte_perimetro`; una nós |
| Painéis no lugar errado | Sem camada `paineis` e geometria ambígua | Desenhe faces na camada `paineis` |
| Dobra sem hinge | Linha não toca a fronteira das duas faces | Estenda/recorte o vinco até a junta |
| Tudo virou corte | Camada/cor de dobra errada | Camada `dobras` + `#00AFEF` + tracejado |
| Preview “flutuando” / partes tortas | SVG antigo ou sem reimportar | Reexporte e reimporte após atualizar o sistema |

---

## 9. Estrutura mental do arquivo (resumo)

```
documento (mm)
├── camada paineis          (opcional)
│   ├── base                path fechado
│   ├── tampa
│   └── aba_esq …
├── camada corte
│   ├── corte_perimetro     path fechado #ED3237  ← obrigatório
│   └── corte_…             outros cortes
└── camada dobras
    ├── dobra_tampa         #00AFEF tracejado (+ data-fold-* opcional)
    └── dobra_aba_…
```

---

## 10. Modelo mínimo (referência XML)

Use só para conferir o que o Corel deveria gerar. Não precisa desenhar à mão no XML no dia a dia.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="100mm"
     viewBox="0 0 120 100">
  <g id="corte" stroke="#ED3237" fill="none" stroke-width="0.35">
    <path id="corte_perimetro"
          d="M 10 10 H 110 V 90 H 10 Z"/>
  </g>
  <g id="dobras" stroke="#00AFEF" fill="none" stroke-width="0.35"
     stroke-dasharray="3 2">
    <line id="dobra_tampa" x1="10" y1="50" x2="110" y2="50"
          data-fold-order="1" data-fold-angle="90" data-fold-towards="front"/>
  </g>
</svg>
```

Com isso, qualquer operador consegue padronizar a exportação da faca no CorelDRAW e o Admin passa a importar de forma previsível.
