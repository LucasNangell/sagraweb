# Mapeamento de Campos - Ficha OS

## ✅ Campos Mapeados com Sucesso

Os seguintes campos da ficha são preenchidos automaticamente com dados da API `/os/{ano}/{id}/details`:

### Seção: Requisição
| Campo na Ficha | Campo no Banco | Observações |
|----------------|----------------|-------------|
| Data | DataEntrada | Formatado DD/MM/AAAA |
| Processo | ProcessoSolicit | |
| Tiragem | Tiragem | |

### Seção: Entidade Solicitante
| Campo na Ficha | Campo no Banco | Observações |
|----------------|----------------|-------------|
| Categoria | CategoriaLink | |
| Cód. do Usuário | CodUsuarioLink | |
| Contato | ContatoTrab | |
| Nome | NomeUsuario | |
| Ramal | RamalUsuario | |
| Interessado | OrgInteressado | |

### Seção: Informações Técnicas
| Campo na Ficha | Campo no Banco | Observações |
|----------------|----------------|-------------|
| Tipo de Serviço | TipoPublicacaoLink | |
| Máquina Sugerida | MaquinaLink | |
| Páginas | Pags | |
| Frente/Verso | FrenteVerso | Convertido para "Sim"/"Não" |
| Título | Titulo | |
| Cor | Cores + CoresDescricao | Concatenado com " - " |
| Papel | PapelLink + PapelDescricao | Concatenado com " - " |
| Acabamento | DescAcabamento | |

### Seção: Observações Gerais
| Campo na Ficha | Campo no Banco | Observações |
|----------------|----------------|-------------|
| Observações Gerais | Observ | Primeira textarea grande |
| Insumos Fornecidos | InsumosFornecidos | |
| Material Entregue | MaterialFornecido | |

### Seção: Dados de Entrega
| Campo na Ficha | Campo no Banco | Observações |
|----------------|----------------|-------------|
| Prazo p/ Entrega | EntregPrazoLink | |
| Data | EntregData | Formatado DD/MM/AAAA (segunda ocorrência de "Data") |

---

## ⚠️ Campos NÃO Mapeados (Necessitam Definição)

Os seguintes campos da ficha **não foram preenchidos** pois não há correspondência clara nos dados retornados pela API:

### Seção: Requisição
| Campo na Ficha | Motivo | Sugestão de Origem |
|----------------|--------|-------------------|
| Cota Rcoror | Não identificado no banco | CotaRepro tabprotocolos |
| Cota Preto | Não identificado no banco | deixar em branco |
| R$ na Cor | Não identificado no banco | Deixar em branco |
| R$ na P/B | Não identificado no banco | Deixar em branco |
| Cálculo Cor | Não identificado no banco | Deixar em branco |
| Cálculo P/B | Não identificado no banco | Deixar em branco |
| Desdob. | Não identificado no banco | Deixar em branco |

### Seção: Informações Técnicas
| Campo na Ficha | Motivo | Sugestão de Origem |
|----------------|--------|-------------------|
| Formato | Não identificado no banco | FormatoLink tabdetalhesservico |
| Observações (Cor) | Parcialmente mapeado | CoresDescricao tabdetalhesservico |
| Observações (Papel) | Parcialmente mapeado | PapelDescricao tabdetalhesservico |

### Seção: Dados de Entrega
| Campo na Ficha | Motivo | Sugestão de Origem |
|----------------|--------|-------------------|
| Resp. na Gráfica | Não identificado no banco | ResponsavelGrafLink tabprotocolos |
| Forma de Entrega | Não identificado no banco | EntregaFormaLink tabprotocolos |
| Avisos | Não identificado no banco | EntregPeriodo e EntregPrazoLink tabprotocolos |

---

## 📋 Campos Disponíveis na API mas Não Utilizados

Estes campos estão disponíveis na resposta da API mas não foram usados pois não há correspondência na ficha:

- CodigoRequisicao (p.CodigoRequisic)
- Titular
- SiglaOrgao
- GabSalaUsuario
- Andar
- Localizacao
- NroProtocolo / AnoProtocolo
- CSnro
- TiragemSolicitada
- TiragemFinal
- CotaRepro
- CotaCartao
- CotaTotal
- ModelosArq
- Fotolito
- ModeloDobra
- ProvaImpressa
- MidiaDigitalLink
- MidiaDigitDescricao
- ElemGrafBrasao
- ElemGrafTimbre
- ElemGrafArteGab
- ElemGrafAssinatura

---

## 🔧 Próximos Passos (Se Necessário)

Para completar o mapeamento dos campos faltantes:

1. **Verificar o schema do banco de dados** - Confirmar se os campos não mapeados existem em alguma tabela
2. **Atualizar a query da API** - Se os campos existirem, incluí-los na query de `/os/{ano}/{id}/details`
3. **Atualizar script.js** - Adicionar o mapeamento dos novos campos na função `openPrintFichaModal()`
4. **Documentar campos derivados** - Se algum campo for calculado, documentar a lógica de cálculo

---

## 💡 Observações Técnicas

- O preenchimento é feito através de busca por labels (texto exato)
- Campos com mesmo nome (ex: "Data", "Observações") são diferenciados por índice
- Campos vazios no banco resultam em campos vazios na ficha
- A formatação de datas segue o padrão brasileiro (DD/MM/AAAA)
- Valores booleanos são convertidos para "Sim"/"Não"
