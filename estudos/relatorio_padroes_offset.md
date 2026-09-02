# Relatório de padrões - trabalhos offset

Fonte principal: `relatorio trabalhos offset.xlsx`.
Base analisada: 148 OS da planilha; 148 `.docx` localizados por ano e número da OS.

## Leitura geral

A sequência de produção nos `.docx` é predominantemente textual e segue um modelo bastante estável:

1. Título com OS e ano.
2. Impressão.
3. Formato de impressão por componente do produto, normalmente `Capa`, `Miolo` e, quando necessário, encartes/divisórias/miolo colorido.
4. Acabamento, com etapas condicionais como laminação, corte, dobra, alceamento, encadernação, capeadeira, Wire-O/espiral, serrilha/picote e refile final.

## Distribuição da amostra

| Produto | Qtde |
| --- | --- |
| Livreto c/ Capa | 76 |
| Livro | 43 |
| Revista c/ Capa | 26 |
| Revista | 2 |
| Livreto s/ Capa | 1 |

| Formato | Qtde |
| --- | --- |
| A5 | 98 |
| A4 | 26 |
| 160 x 230 | 4 |
| 220 x 164 | 3 |
| 120 x 180 | 3 |
| 160 x 200 | 3 |
| 155 x 225 | 2 |
| A5 Paisagem | 1 |
| 164 x 220 | 1 |
| 120 x 200 | 1 |
| 140x140 | 1 |
| 160x230 | 1 |
| 160x230 mm | 1 |
| 175 x 255 | 1 |
| 160x200 mm | 1 |

| Máquina | Qtde |
| --- | --- |
| Komori | 48 |
| PM52/SM74 | 41 |
| Komori/PM52 | 34 |
| Komori/SM74 | 22 |
| SM74 | 3 |

## Etapas encontradas nos DOCX

| Etapa | Qtde | % da base |
| --- | --- | --- |
| laminacao | 44 | 30% |
| dobra | 145 | 98% |
| alceamento | 144 | 97% |
| canoa | 105 | 71% |
| wire o | 4 | 3% |
| espiral | 0 | 0% |
| capeadeira | 38 | 26% |
| hot stamping | 0 | 0% |
| serrilha picote | 4 | 3% |
| refile | 148 | 100% |

## Regras candidatas para automação

### 1. Produto define o esqueleto da sequência

Use `Produto (Tipo)` como primeira chave de decisão. Ele determina se a OS tende a virar uma sequência de canoa, livro colado/capeado, lâminas soltas, Wire-O ou item de acabamento simples.

Padrões por produto:

- **Livreto c/ Capa** (76 OS): formatos principais: A5 (74), A5 Paisagem (1), 140x140 (1); etapas DOCX: laminação (1), dobra (76), alceamento (74), canoa (75), refile (76); acabamentos informados: Refile (76), Grampo Canoa (41), Dobra (40), Grampo canoa (29), Granpo Canoa (2), Grapo canoa (2).
- **Livro** (43 OS): formatos principais: A5 (22), 160 x 230 (4), 220 x 164 (3), 120 x 180 (3), 160 x 200 (3); etapas DOCX: laminação (43), dobra (40), alceamento (41), canoa (1), Wire-O (4), capeadeira (38), refile (43); acabamentos informados: Refile (41), Laminação Brilho na Capa (13), Laminação Fosca na Capa (11), Orelhas de 70mm (11), Capas com Laminação Brilho F/V (4), 1 folha no CF 170g com Laminação Brilho F/V e com serilha na lateral esquerda próximo dos furos do Wire-ô, ele deverá ser colocada após a 1ª página do Miolo. (4).
- **Revista c/ Capa** (26 OS): formatos principais: A4 (25), 120 x 200 (1); etapas DOCX: dobra (26), alceamento (26), canoa (26), refile (26); acabamentos informados: Refile (26), Dobra (15), Grampo canoa (15), Grampo Canoa (9), Gramnpo canoa (1), 2 Grampos Canoa (1).
- **Revista** (2 OS): formatos principais: A4 (1), A5 (1); etapas DOCX: dobra (2), alceamento (2), canoa (2), refile (2); acabamentos informados: Refile (2), Dobra (1), Grampo canoa (1), Grampo Canoa (1).
- **Livreto s/ Capa** (1 OS): formatos principais: A5 (1); etapas DOCX: dobra (1), alceamento (1), canoa (1), refile (1); acabamentos informados: Dobra (1), Grampo Canoa (1), Refile (1).

### 2. Acabamento da planilha liga e parametriza as etapas

A coluna `Acabamento` deve ser normalizada para uma lista de operações. Termos equivalentes e grafias com erro devem cair no mesmo código interno.

| Acabamento informado | Qtde |
| --- | --- |
| Refile | 146 |
| Dobra | 58 |
| Grampo Canoa | 52 |
| Grampo canoa | 45 |
| Laminação Brilho na Capa | 13 |
| Laminação Fosca na Capa | 11 |
| Orelhas de 70mm | 11 |
| Capas com Laminação Brilho F/V | 4 |
| 1 folha no CF 170g com Laminação Brilho F/V e com serilha na lateral esquerda próximo dos furos do Wire-ô, ele deverá ser colocada após a 1ª página do Miolo. | 4 |
| Laminação Fosca na capa | 4 |
| Orelhas de 50mm | 4 |
| Lombada de 8mm | 4 |
| Lombada de 33mm | 4 |
| Lombada de 7mm | 4 |
| Wire-ô na lateral esquerda | 3 |
| Laminaçao Brilho na Capa | 3 |
| Lombada de 21mm | 2 |
| Granpo Canoa | 2 |
| Laminação Brilho na capa | 2 |
| Lombada de 9mm | 2 |
| Grapo canoa | 2 |
| Orelhas de 70 mm | 2 |
| Laminação Brilho na capa. | 2 |
| Lombada de 12mm | 2 |
| Laminação Fosca | 2 |
| Lombada de 09mm | 2 |
| Lombada de 6mm | 2 |
| Lombada de 24 mm | 1 |
| Refile. | 1 |
| Granpo canoa | 1 |

Normalizações recomendadas:

- `Grampo canoa`, `Grampo Canoa`, `Encadernação (Canoa)` -> `ENCADERNACAO_CANOA`.
- `Granpo` -> tratar como `Grampo`.
- `Laminação Brilho/Fosca`, `Laminaçao`, `Laminação na Capa` -> `LAMINACAO`, com atributo `tipo` e `aplicacao`.
- `Wire-O`, `Wire-ô`, `Wire` -> `WIRE_O`.
- `Serrilha`, `picote`, `serilha` -> `SERRILHA_PICOTE`.
- `Refile`, `Refile Final`, `Guilhotina` -> `REFILE_FINAL` quando estiver no fechamento da sequência.

### 3. Formato de impressão deve ser gerado por componente

Nos `.docx`, o formato de impressão não é um único campo da OS: ele aparece por componente. Exemplos recorrentes: `Capa`, `Miolo`, `Miolo PB`, `Miolo Colorido`, `Divisória`, `Encarte`.

Formatos de impressão mais frequentes extraídos dos documentos:

| Linha do DOCX | Qtde |
| --- | --- |
| Capa: 656 x 470mm (CF 115g) | 36 |
| Miolo: 656 x 470mm (Ap 90g) | 30 |
| Miolo: 656 x 470mm (Ap 75g) | 26 |
| Miolo: 656 x 470mm (AP 90g) | 21 |
| Miolo: 656 x 318mm (Ap 90g) – SANFONA 12pgs | 15 |
| Capa: 455 x 328mm (CF 115g) | 11 |
| Capa: 656 x 470mm (CF 170g) | 8 |
| Capa: 450 x 300mm (CF 250g) | 7 |
| Miolo: 656 x 470 (Ap 75g) | 5 |
| Miolo: 656 x 470mm (AP 75g) | 5 |
| Miolo: 656 x 470mm (Ap 90g) – TR 8pgs | 4 |
| Capa: 656 x 300mm (CF 250g) | 4 |
| Capa: 478 x 300mm (CF 250g) | 4 |
| Capa: 520 x 300mm (CF 250g) | 3 |
| Miolo PB: 656 x 470mm (Ap 120g) | 3 |
| Capa: 470 x 328mm (CF 120g) | 3 |
| Capa: 455 x 328 (CF 170g) | 3 |
| Miolo: 690 x 510mm (Ap 90g) | 3 |
| Capa: 656x 470 - CF 250g | 2 |
| Miolo: 540 x 410 - AP 75g | 2 |

Regra de implementação: montar uma lista de componentes a partir de `Papel (Descrição)`, `Cores (Descrição)` e `Produto (Tipo)`, então aplicar uma tabela de imposição/formato por máquina, formato final e componente.

### 4. Dobra deriva principalmente de páginas por caderno

As linhas de dobra mostram assinaturas como `16 pgs`, `8 pgs` e `4 pgs`, com instruções de dobra associadas. Para livros e livretos, esta é uma área com bom potencial de automação.

| Linha de dobra | Qtde |
| --- | --- |
| Miolo - 16 pgs | 72 |
| Miolo - 8 pgs | 64 |
| Miolo - 12pgs sanfona | 26 |
| Miolo - 4 pgs | 18 |
| Capa - 4 pgs | 17 |
| Capa - 4pgs | 11 |
| Miolo 4pgs | 8 |
| Miolo: 16 pgs | 7 |
| Miolo 16pgs | 5 |
| T/R: 4 pgs | 3 |
| Miolo 12pgs | 3 |
| Miolo - 8pgs | 3 |
| Miolo - 16pgs | 3 |
| Miolo – 8 pgs | 3 |
| Capa – 4pgs | 2 |
| Capa 4pgs | 2 |
| Capa e miolo - 4 pgs | 2 |
| Miolo - 4pgs | 2 |
| Capa – 4Pgs | 2 |
| Capa – 4 pgs | 2 |

Regras candidatas:

- Caderno de `16 pgs`: geralmente três dobras, alternando vertical/cabeça/vertical.
- Caderno de `8 pgs`: geralmente duas dobras, cabeça e vertical.
- Caderno de `4 pgs`: geralmente uma dobra vertical.
- Canoa com capa: separar `Capa - 4 pgs`; miolo recebe cadernos conforme total de páginas restante.
- Livro colado: `Capa` deve ir separada para cola/capeadeira; miolo vira cadernos empilhados.

### 5. Alceamento e encadernação dependem do tipo de acabamento

O alceamento aparece quando há cadernos, lâminas ou conjunto capa+miolo a ordenar. O texto costuma indicar o recurso, como `AmGraphics` ou `Manual`, e depois a composição do conjunto.

Regras candidatas:

- `Grampo canoa`: alceamento de cadernos empilhados e encadernação canoa com 2 grampos, salvo exceção descrita.
- `Livro` com lombada/orelha/laminação de capa: laminação da capa, corte/separação de capa e miolo, dobra do miolo, alceamento manual, capeadeira e refile.
- `Wire-O`: tratar como encadernação própria, normalmente com furação/serrilha/picote quando informado.
- `Lâminas soltas`: evitar gerar dobra/encadernação se o docx ou acabamento indicar lâminas soltas; usar corte, ordenação e refile.

## Proposta de motor de regras

Entrada mínima recomendada a partir da OS:

- número, ano, produto, formato final, máquina, tiragem, páginas, frente/verso;
- componentes de papel: capa, miolo, folhas especiais, divisórias, encartes;
- mapa de cores por componente: policromia, PB, páginas coloridas específicas;
- operações de acabamento normalizadas;
- observações com prioridade de exceção manual.

Saída sugerida:

1. `Impressão` com linhas de formato por componente.
2. `Acabamento` com etapas ordenadas.
3. Para cada etapa: recurso/equipamento, parâmetros e instruções de exceção.

Ordem-base das etapas:

`Impressão` -> `Laminação/Hot Stamping` -> `Corte` -> `Dobra` -> `Serrilha/Picote/Furo` -> `Alceamento` -> `Encadernação/Capeadeira/Wire-O/Espiral` -> `Refile Final`.

## Pontos que precisam virar tabela de parametrização

- Formato de impressão por `máquina + formato final + componente + papel`.
- Capacidade de caderno por produto/formato: 16, 8, 4 páginas e exceções.
- Recurso padrão de alceamento: AmGraphics versus manual.
- Regras de lombada por páginas/papel, quando a OS já informa ou quando deve calcular.
- Aplicação de laminação: capa frente, capa F/V, folhas especiais, tipo brilho/fosca.
- Vocabulário controlado de acabamento para absorver variações de digitação.

## Divergências e cuidados

Foram detectadas 0 possíveis divergências entre acabamento informado na planilha e etapa reconhecida no `.docx`. Isso não significa erro de produção: algumas etapas podem estar descritas com outra palavra ou embutidas em observações.

Amostra de divergências para revisão:

| OS | Produto | Acabamento planilha | Etapas DOCX | DOCX |
| --- | --- | --- | --- | --- |

Casos que merecem regra de exceção:

- Sem etapa de dobra reconhecida: 3 OS. Em geral são livros com lâminas soltas, folha especial e Wire-O, não cadernos dobrados.
- Sem etapa de alceamento reconhecida: 4 OS. Conferir antes de usar alceamento como obrigatório para todo livro/livreto.
- Com Wire-O ou menção a Wire-O: 4 OS. Esse grupo deve usar regra própria e não a regra canoa, mesmo quando o `.docx` traz texto herdado como `Encadernação (Canoa)`.

Amostra dos casos sem dobra:

| OS | Produto | Acabamento planilha | Etapas DOCX |
| --- | --- | --- | --- |
| 00031/2026 | Livro | Capas com Laminação Brilho F/V \| 1 folha no CF 170g com Laminação Brilho F/V e com serilha na lateral esquerda próximo dos furos do Wire-ô, ele deverá ser colocada após a 1ª página do Miolo. \| Refile \| Wire-ô na lateral esquerda | Formato de Impressao > Corte > Laminacao > Wire-O > Alceamento > Serrilha/Picote > Refile Final |
| 00447/2026 | Livro | Capas com Laminação Brilho F/V \| 1 folha no CF 170g com Laminação Brilho F/V e com serilha na lateral esquerda próximo dos furos do Wire-ô, ele deverá ser colocada após a 1ª página do Miolo. \| Refile \| Wire-ô 3/8 na lateral esquerda \| Orientação paisagem. | Formato de Impressao > Corte > Laminacao > Wire-O > Alceamento > Serrilha/Picote > Refile Final |
| 02071/2025 | Livro | Capas com Laminação Brilho F/V \| 1 folha no CF 170g com Laminação Brilho F/V e com serilha na lateral esquerda próximo dos furos do Wire-ô, ele deverá ser colocada após a 1ª página do Miolo. \| Refile \| Wire-ô na lateral esquerda | Formato de Impressao > Corte > Laminacao > Wire-O > Alceamento > Serrilha/Picote > Refile Final |

Amostra dos casos com Wire-O:

| OS | Produto | Acabamento planilha | Etapas DOCX |
| --- | --- | --- | --- |
| 00031/2026 | Livro | Capas com Laminação Brilho F/V \| 1 folha no CF 170g com Laminação Brilho F/V e com serilha na lateral esquerda próximo dos furos do Wire-ô, ele deverá ser colocada após a 1ª página do Miolo. \| Refile \| Wire-ô na lateral esquerda | Formato de Impressao > Corte > Laminacao > Wire-O > Alceamento > Serrilha/Picote > Refile Final |
| 00447/2026 | Livro | Capas com Laminação Brilho F/V \| 1 folha no CF 170g com Laminação Brilho F/V e com serilha na lateral esquerda próximo dos furos do Wire-ô, ele deverá ser colocada após a 1ª página do Miolo. \| Refile \| Wire-ô 3/8 na lateral esquerda \| Orientação paisagem. | Formato de Impressao > Corte > Laminacao > Wire-O > Alceamento > Serrilha/Picote > Refile Final |
| 02071/2025 | Livro | Capas com Laminação Brilho F/V \| 1 folha no CF 170g com Laminação Brilho F/V e com serilha na lateral esquerda próximo dos furos do Wire-ô, ele deverá ser colocada após a 1ª página do Miolo. \| Refile \| Wire-ô na lateral esquerda | Formato de Impressao > Corte > Laminacao > Wire-O > Alceamento > Serrilha/Picote > Refile Final |
| 01457/2025 | Livro | Capas com Laminação Brilho F/V \| 1 folha no CF 170g com Laminação Brilho F/V e com serilha na lateral esquerda próximo dos furos do Wire-ô, ele deverá ser colocada após a 1ª página do Miolo. \| Refile \| Wire-ô na lateral esquerda | Formato de Impressao > Corte > Dobra > Alceamento > Laminacao > Wire-O > Encadernacao > Refile Final |

## Arquivos gerados para auditoria

- `analise_offset_trabalhos.csv`: uma linha por OS, com campos da planilha, etapas reconhecidas no DOCX e trechos extraídos.
- `analise_offset_padroes.json`: resumo estruturado com frequências e agregações por produto.
- `relatorio_padroes_offset.md`: este relatório.

## Recomendações de implementação

1. Começar pelo gerador de sequência para `Livreto c/ Capa` e `Revista c/ Capa`, porque o fluxo canoa é o mais repetitivo.
2. Em seguida implementar `Livro`, separando capa, miolo, laminação, dobra de cadernos, alceamento, capeadeira e refile.
3. Criar uma camada de normalização de texto antes das regras; sem isso, grafias como `Granpo`, `Laminaçao`, `Wire-ô` e variações de caixa vão gerar exceções falsas.
4. Manter as observações da OS como bloco de exceções manuais no final de cada etapa afetada.
5. Registrar confiança por etapa: `automática`, `automática com observação`, `requer conferência`.