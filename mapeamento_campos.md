# Field Mapping for Requisicao.html

This document lists all the fields in `requisicao.html` that will be replaced with dynamic variables.
**Please fill in the "Database Field" column with the corresponding field from your database.**

## Header Data
| Field Label | Variable Name | Description | Database Field (User Input) |
|---|---|---|---|
| Data | `{{ data_atual }}` | Date of the requisition | tabprotocolos.DataEntrada |
| RS Entregue | `{{ rs_entregue }}` | "Sim" or "Não" | tabprotocolos.ReqEntregue |
| RS Lançada | `{{ rs_lancada }}` | "Sim" or "Não" | tabprotocolos.ReqLançada |
| Processo | `{{ processo }}` | Process number | tabprotocolos.ProcessoSolicit |
| CS | `{{ cs }}` | CS value | tabprotocolos.CSnro |
| Cota Repro | `{{ cota_repro }}` | Repro quota value | tabprotocolos.CotaRepro |
| Cota Cartão | `{{ cota_cartao }}` | Card quota value | tabprotocolos.CotaCartao |
| Debitar | `{{ debitar_usuario }}` | User to debit | tabprotocolos.DebitarCGRAF |
| Order ID | `{{ numero_pedido }}` | The big number in the top right (e.g., 02561/25) | tabprotocolos.NroProtocolo/tabprotocolos.AnoProtocolo |
| Modelos | `{{ modelos_qtd }}` | Number of models | tabdetalhesservico.ModelosArq |
| Tiragem | `{{ tiragem_qtd }}` | Print run quantity | tabdetalhesservico.Tiragem |

## Entidade Solicitante
| Field Label | Variable Name | Description | Database Field (User Input) |
|---|---|---|---|
| Categoria | `{{ solicitante_categoria }}` | e.g. Orgao | tabprotocolos.CategoriaLink |
| Cód. do Usuário | `{{ solicitante_cod }}` | e.g. 22735 | tabprotocolos.CodUsuarioLink |
| Nome | `{{ solicitante_nome }}` | e.g. Coord. de Serviços ... | tabprotocolos.NomeUsuario |
| Sigla | `{{ solicitante_sigla }}` | e.g. CGRAF | tabprotocolos.SigleOrgao |
| Ramal | `{{ solicitante_ramal }}` | e.g. 6-2700 | tabprotocolos.RamalUsuario |
| Interessado | `{{ solicitante_interessado }}` | e.g. ARNALDO JARDIM | tabprotocolos.OrgInteressado |
| Contato | `{{ solicitante_contato }}` | Text area details | tabprotocolos.ContatoTrab |

## Informações Técnicas
| Field Label | Variable Name | Description | Database Field (User Input) |
|---|---|---|---|
| Tipo de Serviço | `{{ servico_tipo }}` | e.g. Ct Visita | tabdetalhesservico.TipoPublicacaoLink |
| Máquina Sugerida | `{{ maquina_sugerida }}` | e.g. Digital Cor | tabdetalhesservico.MaquinaLink |
| Páginas | `{{ paginas }}` | Number of pages | tabdetalhesservico.Pags |
| Frente / Verso | `{{ frente_verso }}` | Sim/Não | tabdetalhesservico.FrenteVerso |
| Título | `{{ servico_titulo }}` | e.g. Deputado Vicentinho Junior | tabdetalhesservico.Titulo |
| Formato | `{{ servico_formato }}` | e.g. Ct Visita2 50 x 85 | tabdetalhesservico.FormatoLink |
| Cor | `{{ servico_cor }}` | e.g. Policromia | tabdetalhesservico.Cores |
| Observações (Cor) | `{{ obs_cor }}` | Observations related to color | tabdetalhesservico.CoresDescricao |
| Papel | `{{ servico_papel }}` | e.g. Couchê Fosco 300gr | tabdetalhesservico.PapelLink |
| Observações (Papel) | `{{ obs_papel }}` | Observations related to paper | tabdetalhesservico.PapelDescricao |
| Acabamento | `{{ servico_acabamento }}` | List of finishings | tabdetalhesservico.DescAcabamento |

## Footer / Other
| Field Label | Variable Name | Description | Database Field (User Input) |
|---|---|---|---|
| Observações Gerais | `{{ obs_gerais }}` | General notes | tabdetalhesservico.Observ |
| Insumos Fornecidos | `{{ insumos }}` | Provided inputs | tabdetalhesservico.InsumosFornecidos |
| Material Entregue | `{{ material_entregue }}` | Delivered material | tabdetalhesservico.MaterialFornecido |
| Resp. na Gráfica | `{{ resp_grafica }}` | Responsible person at graphics | tabprotocolos.ResponsavelGrafLink |
| Prazo p/ Entrega | `{{ prazo_entrega }}` | e.g. Normal | tabprotocolos.EntregPrazoLink |
| Forma de Entrega | `{{ forma_entrega }}` | e.g. Entreg. na SEDIR IV | tabprotocolos.EntregaFormaLink |
| Data (Entrega) | `{{ data_entrega }}` | Delivery date | tabprotocolos.EntregData |
| Avisos (Line 1) | `{{ aviso_1 }}` | em branco |
| Avisos (Line 2) | `{{ aviso_2 }}` | em branco |
| Avisos (Line 3) | `{{ aviso_3 }}` | em branco |
| Timestamp Footer | `{{ timestamp_impressao }}` | Bottom right timestamp | data e hora da geração do relatório + " por " + ponto do usuário logado |
