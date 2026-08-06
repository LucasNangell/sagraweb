# Relatório: Cálculo de Lombada — `CalcularLombada2010.mdb`

**Fonte:** `c:\_SAGRA\Bancos Extras\CalcularLombada2010.mdb`  
**Versão do formulário:** v1 (rótulo no canto do form)  
**Access:** 08.50 / Jet 4.0  
**Startup:** `Form.formLombada`  
**Data da análise:** 2026-07-27

---

## 1. Visão geral

O banco é uma calculadora Access dedicada à **espessura de lombada** de livros/brochuras. Não grava histórico de cálculos: a lógica vive no formulário `formLombada` (VBA) e a tabela `tabPapel` fornece a **espessura medida de cada papel em mícrons**.

Fluxo resumido:

1. Usuário informa **páginas do miolo**, **papel da capa**, **papel do miolo** e a **diferença de medição (L − C)**.
2. O sistema ajusta automaticamente os fatores **F Cola** e **F Cad**.
3. Calcula a lombada em mm.
4. Classifica o acabamento sugerido: **Grampo Canoa**, **Lombada Quadrada** ou **Espiral**.

---

## 2. Objetos do banco

| Objeto | Tipo | Função |
|--------|------|--------|
| `tabPapel` | Tabela | Cadastro de papéis (nome, formato, espessura em µm, disponibilidade) |
| `consPapelLombada` | Consulta | Papéis com `Espessura IS NOT NULL`, ordenados por nome — fonte dos combos |
| `tabPapel Consulta` | Consulta | Projeção administrativa da tabela |
| `formLombada` | Formulário | UI + toda a lógica de cálculo |
| `Funções` | Módulo | Utilitários de UI (simulação de formato de papel) — **não entra no cálculo** |
| `Variaveis` | Módulo | Constantes legadas de planejamento (lombada min/max 6/50 mm, capeadeira, etc.) |

SQL de `consPapelLombada`:

```sql
SELECT tabPapel.CodPapel, tabPapel.Papel, tabPapel.Espessura
FROM tabPapel
WHERE (((tabPapel.Espessura) Is Not Null))
ORDER BY tabPapel.Papel;
```

Os combos `comboCapaPapel` e `comboMioloPapel` usam 3 colunas (`CodPapel`, `Papel`, `Espessura`), exibindo só o nome; a espessura é lida de `Column(2)`.

---

## 3. Entradas do usuário

| Controle | Nome | Unidade | Obrigatório | Descrição |
|----------|------|---------|-------------|-----------|
| Páginas do miolo | `txtPgs` | páginas | Sim | Qtde de páginas do miolo (`> 0`) |
| Papel da capa | `comboCapaPapel` | — | Sim | Seleção → preenche `txtCapaEspFolha` (µm) |
| Papel do miolo | `comboMioloPapel` | — | Sim | Seleção → preenche `txtMioloEspFolha` (µm) |
| Diferença L − C | `txtDifLombada` | mm | Sim | Default **1,4**. StatusBar: *(L) Esp. Lomb − (C) Alt Livro medida no centro* |

Campos derivados (somente leitura / calculados):

| Controle | Significado |
|----------|-------------|
| `txtCapaEspFolha` / `txtMioloEspFolha` | Espessura da folha em **mícrons** (do cadastro) |
| `txtFcola` | Fator de cola (mm) — ajustado por `AjustarFcola` |
| `txtFcad` | Fator de cadernos (mm) — ajustado por `AjustarFcad` |
| `txtFcapa` | Existe na UI, mas **não é preenchido nem usado** na fórmula atual |
| `txtEspessLombada` | Lombada **calculada** (mm, precisão decimal) |
| `txtEspessConvertida` | Lombada **sugerida** = `Round(calculada, 0)` — só visível na faixa quadrada |

Pré-condição (`verifica()`): só calcula se páginas, capa, miolo e diferença estiverem preenchidos.

---

## 4. Fórmula principal

Implementada em `CalcularLombada` (código do formulário):

```vb
espMiolo = (Pgs / 2) * (MioloEspFolha / 1000)
espCapa  = CapaEspFolha / 500
espTotal = espMiolo + espCapa
CalcularLombada = espTotal + Fcola + Fcad
```

### 4.1 Interpretação física

| Parcela | Fórmula | Interpretação |
|---------|---------|----------------|
| Miolo | `(páginas / 2) × (espessura_µm / 1000)` | Cada folha = 2 páginas; espessura convertida de µm → mm |
| Capa | `espessura_capa_µm / 500` | Equivale a **2 × (µm / 1000)** — frente + verso da capa |
| Cola | `Fcola` | Espaço destinado à cola (mm) |
| Cadernos | `Fcad` | Expansão dos cadernos com a cola (mm) |

**Unidade resultante:** milímetros (mm).

**Observação:** `Fcapa` (acréscimo por dobra da capa) aparece na interface com a nota de que “deve ser considerado apenas p/ a medida da espessura final total do livro”, mas **não entra** em `CalcularLombada`. Na carga do form fica vazio e nenhum evento o atualiza.

### 4.2 Arredondamento / sugestão

```vb
Formulario.txtEspessConvertida = Round(CalcularLombada, 0)
```

A lombada calculada mantém decimais; a “sugerida” é o valor arredondado ao inteiro mais próximo (regra VBA `Round`).

---

## 5. Fatores empíricos: F Cola e F Cad

A diferença **DifLombada** (L − C) calibra os acréscimos de cola e cadernos com base em experiência de serviços anteriores (textos do próprio form).

### 5.1 `AjustarFcad(DifLombada)`

| Diferença (mm) | F Cad (mm) |
|----------------|------------|
| `0 < Dif ≤ 1` | **0,5** |
| `1 < Dif ≤ 2` | **1,0** |
| Fora dessas faixas | **não altera** o valor atual |

No `Form_Load`, `txtFcola` inicia em **0,5** e, se DifLombada já tiver valor (default 1,4), chama `AjustarFcad` → com 1,4 cai na faixa `1 < Dif ≤ 2` → **Fcad = 1**.

### 5.2 `AjustarFcola(Pgs, DifLombada)`

Dois regimes, conforme a diferença:

**Diferença grande — `DifLombada > 1,4`**

| Páginas do miolo | F Cola (mm) |
|------------------|-------------|
| 1 – 200 | 1 |
| 201 – 400 | 2 |
| 401 – 600 | 3 |
| 601 – 800 | 4 |

**Diferença pequena — `DifLombada < 1,5`** (inclui o default 1,4)

| Páginas do miolo | F Cola (mm) |
|------------------|-------------|
| 1 – 200 | 0,5 |
| 201 – 400 | 1 |
| 401 – 600 | 2 |
| 601 – 800 | 3 |

Limiares de tipografia na UI:

- Dif. Peq.: 0 a 1,4  
- Dif. Gde.: maior que 1,5  

Comportamento em pontos limítrofes:

| DifLombada | Ramo usado |
|------------|------------|
| `1,4` | Pequena (`< 1,5`; a condição `> 1,4` é falsa) |
| `1,5` | Grande (`> 1,4`) |

Acima de 800 páginas, o `Select Case` não define Fcola (valor permanece o anterior).

---

## 6. Classificação do tipo de acabamento

Constantes no formulário:

```vb
Const LombadaMinima As Integer = 6
Const LombadaMaxima As Integer = 35
```

| Lombada calculada | Destaque na UI | Lombada sugerida (`txtEspessConvertida`) |
|-------------------|----------------|------------------------------------------|
| **&lt; 6 mm** | Grampo Canoa | Oculta |
| **6 – 35 mm** (inclusive 6) | Lombada Quadrada | Visível (arredondada) |
| **&gt; 35 mm** | Espiral | Oculta |

Rótulos fixos na UI: “Até 6mm” / “De 6mm a 35mm” / “A partir de 35mm”.

### Inconsistência com o módulo `Variaveis`

No módulo global constam:

- `sngPubLombadaMinima = 6`
- `sngPubLombadaMaxima = 50`

O formulário **não usa** essas constantes públicas; usa 6 e **35**. Os valores 50 / capeadeira / tipos Binder etc. parecem herança de um formulário de planejamento antigo (há vestígios `~sq_cformPlanejamento*` no banco).

---

## 7. Eventos que disparam recálculo

| Evento | Efeito |
|--------|--------|
| `Form_Load` | Zera campos; Fcola=0,5; ajusta Fcad se Dif preenchida; calcula se `verifica` |
| `comboCapaPapel_AfterUpdate` | Copia espessura µm; recalcula |
| `comboMioloPapel_AfterUpdate` | Copia espessura µm; recalcula |
| `txtPgs_AfterUpdate` | `AjustarFcola` + recalcula |
| `txtDifLombada_AfterUpdate` | `AjustarFcad` + `AjustarFcola` + recalcula |

---

## 8. Exemplo numérico

**Entradas:** 200 páginas · miolo `ap 75gr AA` (80 µm) · capa `Couché Fosco 250gr` (220 µm) · Dif = 1,4 mm

1. Fcad: `1 < 1,4 ≤ 2` → **1,0 mm**  
2. Fcola: Dif &lt; 1,5 e 1–200 págs → **0,5 mm**  
3. Miolo: `(200 / 2) × (80 / 1000)` = **8,000 mm**  
4. Capa: `220 / 500` = **0,440 mm**  
5. Lombada = `8,000 + 0,440 + 0,5 + 1,0` = **9,940 mm**  
6. Sugerida = `Round(9,94)` = **10 mm** → faixa **Lombada Quadrada**

---

## 9. Cadastro de espessuras (`tabPapel`)

Espessura armazenada em **mícrons**. Só entram no cálculo registros com espessura não nula (24 papéis na consulta).

| Papel | µm | mm/folha | Contribuição capa (2 faces, mm) |
|-------|-----|----------|----------------------------------|
| ap 75gr AA | 80 | 0,080 | 0,160 |
| ap 75gr BB | 84 | 0,084 | 0,168 |
| ap 90gr | 100 | 0,100 | 0,200 |
| ap 120gr | 130 | 0,130 | 0,260 |
| ap 150gr | 170 | 0,170 | 0,340 |
| ap 180gr | 240 | 0,240 | 0,480 |
| Couché Brilho 90gr | 60 | 0,060 | 0,120 |
| Couché Fosco 90gr | 80 | 0,080 | 0,160 |
| Couché Fosco 115gr B | 90 | 0,090 | 0,180 |
| Couché Br 115gr | 90 | 0,090 | 0,180 |
| Couché Fosco 120gr | 80 | 0,080 | 0,160 |
| Couché Fosco 170gr | 160 | 0,160 | 0,320 |
| Couché Fosco 230gr | 200 | 0,200 | 0,400 |
| Couché Fosco 250gr | 220 | 0,220 | 0,440 |
| Couché Fosco 300gr | 300 | 0,300 | 0,600 |
| Opaline 120gr | 130 | 0,130 | 0,260 |
| Reciclado 75gr | 90 | 0,090 | 0,180 |
| Reciclado 90gr | 130 | 0,130 | 0,260 |
| Reciclado 180gr | 250 | 0,250 | 0,500 |
| Linho Fosco 180gr | 200 | 0,200 | 0,400 |
| Linho Brilho 180gr | 220 | 0,220 | 0,440 |
| Craft | 115 | 0,115 | 0,230 |
| Cartão Magnu 400gr | 400 | 0,400 | 0,800 |
| Cartão 350 gr | 440 | 0,440 | 0,880 |

Há papéis no cadastro **sem** espessura (ex.: Opaline 220gr, ap 240gr, carbonado, coloridos 180/290gr) — não aparecem nos combos da calculadora. Alguns têm observação de medição (ex.: “espessura reduzida de 100,00 para 85”) e campo `DataMedicao`.

---

## 10. Pseudocódigo equivalente (para reimplementação)

```python
def ajustar_fcad(dif: float) -> float | None:
    if 0 < dif <= 1:
        return 0.5
    if 1 < dif <= 2:
        return 1.0
    return None  # não altera

def ajustar_fcola(pgs: float, dif: float) -> float | None:
    if dif > 1.4:
        ranges = [(200, 1), (400, 2), (600, 3), (800, 4)]
    elif dif < 1.5:
        ranges = [(200, 0.5), (400, 1), (600, 2), (800, 3)]
    else:
        return None
    for lim, val in ranges:
        if 1 <= pgs <= lim:
            return val
        # VBA Select Case is exclusive ranges; rewrite as:
    # Case 1 To 200, 201 To 400, ...
    if dif > 1.4:
        if 1 <= pgs <= 200: return 1
        if 201 <= pgs <= 400: return 2
        if 401 <= pgs <= 600: return 3
        if 601 <= pgs <= 800: return 4
    else:  # dif < 1.5
        if 1 <= pgs <= 200: return 0.5
        if 201 <= pgs <= 400: return 1
        if 401 <= pgs <= 600: return 2
        if 601 <= pgs <= 800: return 3
    return None

def calcular_lombada(pgs, miolo_um, capa_um, fcola, fcad):
    esp_miolo = (pgs / 2) * (miolo_um / 1000)
    esp_capa = capa_um / 500
    return esp_miolo + esp_capa + fcola + fcad

def tipo_acabamento(lombada_mm: float) -> str:
    if lombada_mm > 35:
        return "espiral"
    if lombada_mm >= 6:
        return "lombada_quadrada"
    return "grampo_canoa"
```

---

## 11. Limitações e pontos de atenção

1. **`Fcapa` não entra na fórmula** — campo morto na versão atual do form.  
2. **Diferença &gt; 2 mm** não atualiza Fcad.  
3. **&gt; 800 páginas** não atualiza Fcola.  
4. **Máximo 35 mm** no form vs **50 mm** no módulo `Variaveis`.  
5. Espessuras são **valores medidos/cadastrados**, não derivados da gramatura.  
6. Não há persistência do resultado — ferramenta de apoio à definição de acabamento.  
7. Vestígios de formulários antigos (`formCalcLombada`, `formPlanejamento`) no catálogo de tabelas sistema, sem código ativo neste MDB.

---

## 12. Conclusão

O cálculo de lombada do `CalcularLombada2010.mdb` é:

\[
L = \frac{P}{2}\cdot\frac{e_m}{1000} + \frac{e_c}{500} + F_{\text{cola}}(P,\Delta) + F_{\text{cad}}(\Delta)
\]

onde \(P\) = páginas do miolo, \(e_m\) / \(e_c\) = espessuras em µm do miolo e da capa, e \(\Delta\) = diferença empírica L − C (mm). O resultado em mm orienta o acabamento: canoa (&lt; 6), quadrada (6–35) ou espiral (&gt; 35).
