# Relatório — Dados para Previsão de Prazo de Conclusão da OS

**Data da auditoria:** 12/06/2026  
**Ambiente consultado:** MySQL `sagrafulldb` em `10.1.1.73` (somente `SELECT`)  
**Escopo:** levantamento de dados, qualidade, queries e plano — **sem implementação**

---

## 1. Resumo executivo

### Os dados são suficientes?

**Parcialmente sim**, com ressalvas importantes:

| Dimensão | Avaliação |
|----------|-----------|
| Volume histórico | **Excelente** — 84.083 OS, 199.179 andamentos |
| Status atual da OS | **Confiável** — tabela materializada cobre 99,99% das OS |
| Data de início | **Confiável** — `DataEntrada` preenchida em 100% dos protocolos |
| Data de conclusão | **Parcialmente confiável** — `DataConclusao` existe em apenas ~47% das OS entregues; nos anos 2024–2026 o preenchimento é praticamente zero |
| Prazo prometido/solicitado | **Parcialmente confiável** — `EntregData` preenchida em apenas ~25% das OS; `EntregPrazoLink` (texto de prioridade) em ~99,9% |
| Fluxo operacional (setores) | **Limitado** — 88% das OS entregues têm **apenas 1 andamento** (fechamento direto, sem histórico de trâmite) |
| Dados técnicos (produto, tiragem, etc.) | **Bons** — `tabDetalhesServico` com cobertura ~102% em relação a protocolos |
| Sub OS / componentes | **Insuficientes hoje** — feature nova, 6 Sub OS e 0 andamentos Sub OS |
| Aprovação de prova / e-mail | **Insuficientes hoje** — 10 tokens de prova no total |

**Conclusão:** há base estatística robusta para previsão **por produto, prioridade e setor**, mas o histórico de **fluxo detalhado** (sequência de setores, tempos por etapa, retrabalho) está disponível para **~9.000 OS entregues** (≈11% do universo entregue). Para OS ativas (451 hoje), a previsão em tempo real é viável com abordagem estatística + estado atual.

### Melhor estratégia recomendada

**Começar pelo Nível 1 (estatístico)**, evoluindo para Nível 2 (ML clássico) após validação operacional.

**Targets iniciais recomendados:**

1. **Opção B** — dias restantes a partir do estado atual (principal)
2. **Opção C** — risco de atraso vs. `EntregData` (quando existir)
3. **Opção D** — prazo estimado por setor (complementar, explicabilidade)

**Proxy de conclusão para treinamento:** quando `DataConclusao` for nula, usar `tab_os_ultimo_andamento_operacional.data` com `situacao = 'Entregue'`.

**Separar modelos/estatísticas:** OS normal (`NroProtocolo < 5000`) vs. Papelaria/SP (`NroProtocolo >= 5000`) — fluxos e tempos são distintos.

---

## 2. Tabelas analisadas

| Tabela | Função | Volume | Chaves | Campos relevantes para prazo | Confiabilidade |
|--------|--------|--------|--------|------------------------------|----------------|
| `tabProtocolos` | Cabeçalho administrativo da OS | **84.083** | PK: `(NroProtocolo, AnoProtocolo)` | `DataEntrada`, `EntregData`, `EntregPrazoLink`, `EntregPeriodo`, `DataConclusao`, `RecebimData`, `NomeUsuario`, `GabSalaUsuario`, campos de cancelamento/entrega | **Parcial** — administrativo confiável; datas de conclusão incompletas |
| `tabAndamento` | Histórico de movimentação operacional | **199.179** | PK: `CodStatus`; FK: `(NroProtocoloLink, AnoProtocoloLink)` | `SituacaoLink`, `SetorLink`, `Data`, `UltimoStatus`, `Observaçao`, `Ponto` | **Boa** para status; **limitada** como histórico (média 2,37 andamentos/OS) |
| `tabDetalhesServico` | Especificação técnica do serviço | **85.660** | FK: `(NroProtocoloLinkDet, AnoProtocoloLinkDet)` | `Titulo`, `TipoPublicacaoLink`, `FormatoLink`, `MaquinaLink`, `Tiragem`, `Pags`, `PapelLink`, `Cores`, `DescAcabamento`, `ProvaImpressa`, campos `Calc*` | **Boa** — produto quase sempre preenchido |
| `tab_os_ultimo_andamento_operacional` | Último andamento operacional materializado | **84.075** | PK: `(nro_protocolo, ano_protocolo)` | `situacao`, `setor`, `data`, `cod_status`, `ultimo_status`, `atualizado_em` | **Confiável** — espelha `UltimoStatus=1` excluindo espelhos Sub OS |
| `tab_os_componentes` | Componentes (capa, miolo, etc.) | **12** | PK: `id` | `nome`, `techspec_json`, `ordem` | **Nova** — volume ainda irrelevante |
| `tab_os_sub_os` | Sub OS por componente | **6** | PK: `id` | `display_name`, `congelada`, `ativo` | **Nova** — volume ainda irrelevante |
| `tab_os_sub_os_andamento` | Andamentos das Sub OS | **0** | PK: `id` | `situacao`, `setor`, `data`, `cod_status_espelho` | **Sem dados históricos** |
| `tab_pcp_fila` | Ordem manual da fila PCP por setor | **291** | Implícita por `setor` + `nro_os`/`ano` | `ordem`, `ultima_atualizacao` | **Operacional** — reflete fila atual, não histórico |
| `tabProofTokens` | Portal de aprovação de prova | **10** | PK: `ID` | `DataEnvio`, `DataResposta`, `Aprovado`, `Versao`, `CreatedAt` | **Insuficiente** para ML hoje |
| `tabPapelariaJobs` | Fila de geração Corel (papelaria) | **61** | PK: `id` | status, timestamps de job | **Útil só para papelaria recente** |
| `tabClienteGabinete` | Contas do portal do cliente | **4** | PK: `ID` | `Gabinete`, `CreatedAt` | **Irrelevante** para prazo hoje |
| `tab_os_audit_log` | Auditoria de alterações (SAGRA Web) | **1.102** | PK: `id` | `evento_em`, `campo`, `valor_anterior/novo` | **Parcial** — útil para mudanças recentes de prazo |

### Observações de schema

- Tabelas legadas (`tabProtocolos`, `tabAndamento`, `tabDetalhesServico`) **não têm DDL no repositório**; estrutura inferida de `mdb_helpers.py`, `os_audit_service.py` e uso em serviços.
- `DataCriacao` **não existe** nas tabelas legadas de OS; equivalente mais próximo: `DataEntrada` (protocolo) e `Data` (andamento).
- Não há tabela de feriados no sistema.

---

## 3. Campos de data encontrados

| Campo | Tabela | Significado provável | Confiabilidade |
|-------|--------|----------------------|----------------|
| `DataEntrada` | `tabProtocolos` | Data de cadastro/entrada da OS | **Confiável** (0 nulos em 84.083 registros) |
| `EntregData` | `tabProtocolos` | Data de entrega prevista/prometida | **Parcial** — 75% nulos (63.318/84.083) |
| `EntregPrazoLink` | `tabProtocolos` | Texto de prioridade: `Normal`, `Solicitado p/`, `Prometido p/` | **Confiável** (2 vazios) |
| `EntregPeriodo` | `tabProtocolos` | Período/turno de entrega | **Parcial** — não auditado em detalhe |
| `DataConclusao` | `tabProtocolos` | Data formal de conclusão ao marcar Entregue | **Parcial** — preenchida só via SAGRA Web ao entregar; 53% das entregues sem valor |
| `RecebimData` | `tabProtocolos` | Data de recebimento na entrega | **Parcial** — correlaciona com entrega recente via API |
| `Data` | `tabAndamento` | Timestamp do andamento | **Confiável** — base do fluxo e proxy de conclusão |
| `data` | `tab_os_ultimo_andamento_operacional` | Data do último andamento operacional | **Confiável** |
| `atualizado_em` | `tab_os_ultimo_andamento_operacional` | Manutenção da materializada | **Confiável** (técnico) |
| `DataResposta` | `tabProofTokens` | Resposta do cliente à prova | **Confiável quando existe** (3/10) |
| `DataEnvio` | `tabProofTokens` | Envio da prova por e-mail | **Confiável quando existe** |
| `CreatedAt` | `tabProofTokens` | Criação do token | **Confiável** |
| `criado_em` | `tab_os_*` (Sub OS) | Criação de componente/Sub OS | **Confiável** (poucos registros) |
| `evento_em` | `tab_os_audit_log` | Timestamp de auditoria | **Confiável** (escopo limitado no tempo) |
| `CancelamentoData` | `tabProtocolos` (legado MDB) | Data de cancelamento | **Não confiável** — não populada pelo fluxo atual SAGRA Web |

### Qual campo usar?

| Conceito | Campo recomendado | Justificativa |
|----------|-------------------|---------------|
| **Início real da OS** | `DataEntrada` | 100% preenchido; alinhado ao cadastro. Primeiro andamento costuma ocorrer **após** a entrada (diferença média de ~76 dias em relação ao 1º andamento — ver qualidade). |
| **Conclusão real** | **Primário:** `DataConclusao` quando preenchida. **Fallback:** `data` do último andamento com `situacao = 'Entregue'` | `DataConclusao` só existe em OS entregues pelo SAGRA Web (~2023 e anteriores parcialmente). Para 2024–2026, o proxy por andamento é obrigatório. Média entrada→andamento Entregue: **11,2 dias** (mais realista que 136,9 dias via `DataConclusao` em dados antigos). |
| **Prazo prometido/solicitado** | `EntregData` + `EntregPrazoLink` | `EntregData` é a data objetivo; `EntregPrazoLink` classifica urgência (`Prometido` > `Solicitado` > `Normal`). |

### Problemas de datas identificados

| Problema | Quantidade | Impacto |
|----------|------------|---------|
| OS entregues sem `DataConclusao` | **41.813** (53%) | Alto — exige proxy por andamento |
| `DataConclusao` nula em 2024–2026 | **~100%** das entregues recentes | Alto — modelo deve usar andamento |
| `EntregData` nula | **63.318** (75%) | Alto — risco de atraso só para ~25% das OS |
| Conclusão antes da entrada | **244** | Médio — excluir do treinamento |
| Prometida antes da entrada | **169** | Médio — revisar ou excluir |
| Conclusão > 365 dias após prometida | **14** | Baixo |
| Entrada futura | **0** | OK |
| Conclusão futura | **16** | Baixo — provável erro de digitação |
| `DataEntrada` vs. 1º andamento com diff > 7 dias | **35.817** OS | Médio — início operacional pode divergir do cadastro |

---

## 4. Definição recomendada de início e conclusão da OS

### Situações que indicam fim da OS

Definidas em `os_search_service.py`, `pcp_routes.py`, `cliente_gabinete_routes.py`:

| Situação | Tratamento |
|----------|------------|
| `Entregue` | **Concluída com sucesso** |
| `Cancelada` / `Cancelado` | **Encerrada sem entrega** — excluir do treinamento de prazo |
| Demais situações | **Ativa** (em produção, pendência, aprovação, etc.) |

Distribuição atual (materializada):

| Situação | Qtd |
|----------|-----|
| Entregue | 78.835 |
| Cancelado | 4.789 |
| Aguard. Aprovação | 194 |
| Produção Suspensa | 80 |
| Pendência Usuário | 59 |
| Outras (ativas) | 118 |

### `UltimoStatus = 1` é confiável?

**Sim, com ressalvas menores:**

- Lógica em `andamento_operacional.py`: recálculo promove o andamento operacional mais recente, **excluindo espelhos Sub OS** (`MIRROR_EXCLUDE_CLAUSE`).
- **151 OS** com múltiplos `UltimoStatus=1` (inconsistência legada).
- **2 OS** sem nenhum `UltimoStatus=1`.
- A tabela materializada `tab_os_ultimo_andamento_operacional` mitiga isso para leitura rápida (84.075/84.083 OS cobertas).

### Tabela materializada pode ser usada?

**Sim**, para:

- situação/setor atual;
- data do último movimento;
- filtros de OS ativa vs. finalizada;
- idade da OS no setor atual (`NOW() - data`).

**Não substitui** `tabAndamento` para sequência histórica de setores.

### Sub OS e espelhos

| Regra | Recomendação |
|-------|--------------|
| Espelhos em `tabAndamento` (`cod_status_espelho`) | **Ignorar** no status da OS principal — já tratado no sistema |
| Sub OS no cálculo da OS principal | **Não no MVP** — apenas 6 Sub OS; incluir na Fase 3 quando houver volume |
| OS cancelada no treinamento | **Excluir** |
| OS com 1 andamento “Entregue” | **Incluir** em estatística por produto/prioridade; **excluir** de features de fluxo |

---

## 5. Volume histórico útil

### Totais gerais

| Métrica | Valor |
|---------|-------|
| Total de OS | **84.083** |
| OS normal (`Nro < 5000`) | **54.821** (65%) |
| Papelaria/SP (`Nro >= 5000`) | **29.262** (35%) |
| Total de andamentos | **199.179** |
| Média de andamentos por OS | **2,37** |
| OS sem andamento | **3** |
| OS ativas (hoje) | **451** |
| OS entregues | **78.835** |
| OS canceladas | **4.789** |

### OS por ano (últimos 15 anos no recorte)

| Ano | Total | Normal | Papelaria |
|-----|-------|--------|-----------|
| 2026 | 2.032 | 1.059 | 973 |
| 2025 | 4.244 | 2.637 | 1.607 |
| 2024 | 3.435 | 1.950 | 1.485 |
| 2023 | 5.637 | 2.299 | 3.338 |
| 2022 | 2.678 | 1.270 | 1.408 |
| 2021 | 2.443 | 1.213 | 1.230 |
| 2020 | 1.499 | 754 | 745 |
| 2019 | 6.891 | 2.966 | 3.925 |
| 2018 | 3.852 | 2.603 | 1.249 |
| 2017 | 5.284 | 3.610 | 1.674 |
| 2016 | 4.912 | 3.023 | 1.889 |
| 2015 | 7.639 | 4.155 | 3.484 |
| 2014 | 4.189 | 3.193 | 996 |
| 2013 | 6.892 | 4.830 | 2.062 |
| 2012 | 5.091 | 3.504 | 1.587 |

### Tempos médios (OS entregues)

| Recorte | Amostra | Média (dias entrada → conclusão) |
|---------|---------|----------------------------------|
| Geral (com `DataConclusao` válida) | 36.796 | **136,9** |
| Geral (proxy: entrada → andamento Entregue) | 78.835 | **11,2** |
| OS normal (`< 5000`) | 18.653 | **236,0** |
| Papelaria (`>= 5000`) | 18.369 | **-8,9** ⚠️ (dados de conclusão inconsistentes) |

> A discrepância entre 136,9 e 11,2 dias confirma que `DataConclusao` em bases antigas não reflete bem o tempo operacional. **Usar proxy por andamento** como target principal.

### Tempo médio por produto (top 10, mín. 50 OS)

| Produto | OS | Média (dias) |
|---------|-----|--------------|
| Ct Visita | 8.311 | 34,1 |
| Timbrado A4 | 3.452 | 25,3 |
| Pasta Avulso c/ Bolso | 3.049 | 37,6 |
| Bloco A5 | 2.728 | 58,3 |
| Impresso Genérico | 2.301 | 124,5 |
| Ct Gab Simples (Cor) | 2.255 | 19,2 |
| Ct de Cumprimento | 1.810 | 48,4 |
| Aerograma | 1.528 | 534,8 ⚠️ |
| Livro | 1.250 | 2.140,7 ⚠️ |
| Acabamento | 1.214 | 5,9 |

### Tempo médio por prioridade (`EntregPrazoLink`)

| Prioridade | OS | Média dias (entrada→conclusão) | Média atraso vs `EntregData` |
|------------|-----|-------------------------------|------------------------------|
| Normal/Outros | 33.886 | 115,8 | 1,8 |
| Solicitado p/ | 2.670 | 6,9 | 113,0 ⚠️ |
| Prometido p/ | 466 | 635,3 | 514,9 ⚠️ |

> Os atrasos extremos em Solicitado/Prometido sugerem que `EntregData` nem sempre representa o prazo real negociado, ou que a data foi registrada tardiamente.

### Distribuição de `EntregPrazoLink`

| Valor | Qtd |
|-------|-----|
| Normal | 62.548 |
| Solicitado p/ | 19.470 |
| Prometido p/ | 2.063 |

### Tempo médio por setor inicial (1º andamento)

| Setor inicial | OS | Média (dias) |
|---------------|-----|--------------|
| SEDIR | 30.785 | 158,1 |
| SECOG | 5.690 | 28,9 |
| SIELT | 119 | 3,6 |
| Expedição | 99 | 29,4 |
| SEPAC | 31 | 21,6 |
| SEFOC | 31 | 7,5 |

### OS com dados suficientes para treinamento

| Critério | Quantidade |
|----------|------------|
| Entregues | 78.835 |
| Com datas válidas (`DataEntrada` + `DataConclusao` coerentes) | 36.796 |
| Com produto preenchido | 36.796 |
| Com **2+ andamentos** (fluxo real) | **~9.079** (11,5% das entregues) |
| Com `EntregData` para cálculo de atraso | ~20.751 (estimado: 78.835 − 34.084 sem data) |

### Distribuição de andamentos em OS entregues

| Faixa | OS |
|-------|-----|
| 1 andamento | **69.756** (88%) |
| 2–5 | 611 |
| 6–10 | 1.232 |
| 11+ | 7.236 |

### Atraso vs. prazo prometido (quando `EntregData` existe)

| Situação | Qtd |
|----------|-----|
| No prazo | 1.958 |
| Atrasadas | 980 |
| Sem `EntregData` | 34.084 |
| Média de dias de atraso (quando calculável) | 151,7 |

---

## 6. Variáveis candidatas

### Administrativas

| Variável | Fonte | Confiabilidade | Uso |
|----------|-------|----------------|-----|
| `AnoProtocolo` | `tabProtocolos` | Confiável | Sazonalidade, separação temporal |
| `NroProtocolo` | `tabProtocolos` | Confiável | Tipo OS (`<5000` vs `>=5000`) |
| `NomeUsuario` / `GabSalaUsuario` | `tabProtocolos` | Confiável | Perfil do solicitante (categórica) |
| `EntregPrazoLink` | `tabProtocolos` | Confiável | Prioridade ordinal |
| `EntregData` | `tabProtocolos` | Parcial | Prazo alvo, risco de atraso |
| `situacao` / `setor` atuais | materializada ou live | Confiável | Estado para dias restantes |
| Idade da OS | `NOW() - DataEntrada` | Confiável | Feature temporal |
| Tempo no setor atual | `NOW() - data` (materializada) | Confiável | Gargalo atual |
| Qtd. andamentos | `tabAndamento` | Confiável | Complexidade / retrabalho |

### Técnicas

| Variável | Fonte | Confiabilidade | Nulos relevantes |
|----------|-------|----------------|------------------|
| `TipoPublicacaoLink` (produto) | `tabDetalhesServico` | **Confiável** | 2 |
| `Titulo` | `tabDetalhesServico` | Confiável | 156 |
| `FormatoLink` | `tabDetalhesServico` | Confiável | 1.256 |
| `Tiragem` | `tabDetalhesServico` | Parcial | 2.214 zerados/nulos |
| `Pags` | `tabDetalhesServico` | Parcial | 1.918 |
| `MaquinaLink` | `tabDetalhesServico` | Confiável | 2 |
| `PapelLink`, `Cores`, `DescAcabamento` | `tabDetalhesServico` | Parcial | variável |
| `ProvaImpressa` | `tabDetalhesServico` | Parcial | booleano legado |
| Componentes / Sub OS | `tab_os_*` | Não confiável hoje | volume mínimo |
| `techspec_json` | `tab_os_componentes` | Futuro | 12 registros |

### Fluxo

| Variável | Fonte | Disponibilidade |
|----------|-------|-----------------|
| Sequência de setores | `tabAndamento` | Só ~9k OS com 2+ movimentos |
| Setor anterior | derivado | Mesma limitação |
| Retornos ao mesmo setor | derivado | Média 0,83 retornos/OS; máx. 84 |
| Passou por aprovação | `SituacaoLink` + `tabProofTokens` | Situação sim; tokens quase vazios |
| Rejeição/retrabalho | obs/situação “Pendência”, “Produção Suspensa” | Parcial |
| Posição na fila PCP | `tab_pcp_fila` | Só OS na fila manual (291) |

### Temporais

| Variável | Fonte | Notas |
|----------|-------|-------|
| Dia da semana / mês de criação | `DataEntrada` | Confiável |
| Proximidade de feriado | — | **Não há tabela**; usar calendário externo (ex. `workalendar`) |
| Período de alta demanda | derivado por ano/mês | Confiável com agregações |
| 32 situações distintas / 20 setores | `tabAndamento` | Boa granularidade |

---

## 7. Qualidade dos dados

### Classificação por campo

| Campo | Classificação | Tratamento necessário |
|-------|---------------|----------------------|
| `DataEntrada` | **Confiável** | Nenhum |
| `EntregPrazoLink` | **Confiável** | Normalizar texto (`Prometido p/`, etc.) |
| `EntregData` | **Parcialmente confiável** | Tratar nulos; não usar como único target |
| `DataConclusao` | **Parcialmente confiável** | Fallback para `andamento.data`; excluir datas invertidas |
| `SituacaoLink` / `SetorLink` | **Confiável** | Trim em setores (`SEDIR ` com espaço) |
| `UltimoStatus` | **Confiável** | Usar materializada; reconciliar 151 casos duplicados |
| `TipoPublicacaoLink` | **Confiável** | Agrupar produtos raros em “Outros” |
| `Tiragem`, `Pags` | **Precisa de tratamento** | Imputar mediana por produto ou flag “ausente” |
| Histórico de andamentos | **Parcialmente confiável** | Flag `fluxo_completo = qtd_andamentos >= 2` |
| `tabProofTokens` | **Não confiável** (volume) | Ignorar no MVP |
| Sub OS | **Não confiável** (volume) | Ignorar no MVP |
| Dados antigos (pré-2020) | **Precisa de tratamento** | Ponderar menos ou filtrar para treino inicial |

### Problemas estruturais

1. **Fechamento em 1 andamento (88%)** — grande parte do histórico não registra trâmite intermediário (legado/MDB).
2. **`DataConclusao` só via SAGRA Web** — anos 2024–2026 com 0% de preenchimento nas entregues.
3. **1.734 OS com múltiplos detalhes** — exigir regra (primeiro detalhe, ou agregar).
4. **Média negativa na papelaria** — usar proxy por andamento e filtrar `DataConclusao >= DataEntrada`.
5. **Produtos com tempos aberrantes** (Livro, Aerograma) — winsorizar ou segmentar.
6. **Impacto de dados antigos** — OS de 2012–2019 concentram volume; fluxo operacional atual pode ter mudado.

---

## 8. Targets recomendados

### Opção A — Dias totais entre criação e entrega

| Aspecto | Avaliação |
|---------|-----------|
| Dados necessários | `DataEntrada` + data fim (conclusão ou andamento Entregue) |
| Vantagens | Simples; bom para estatística por produto |
| Riscos | Inútil para OS já em andamento; mistura OS antigas de 1 andamento |
| Complexidade | Baixa |
| **Recomendação** | Útil no **treinamento offline**, não como output principal para OS ativa |

### Opção B — Dias restantes a partir do status atual ⭐

| Aspecto | Avaliação |
|---------|-----------|
| Dados necessários | Estado atual (setor, situação, idade, tempo no setor) + histórico por produto/prioridade |
| Vantagens | Responde à pergunta operacional; funciona para lista inicial e PCP |
| Riscos | Depende de benchmarks por setor; baixa confiança sem fluxo histórico |
| Complexidade | Média |
| **Recomendação** | **Target principal do MVP** |

### Opção C — Probabilidade de atraso vs. `EntregData` ⭐

| Aspecto | Avaliação |
|---------|-----------|
| Dados necessários | `EntregData`, estado atual, benchmarks, dias já consumidos |
| Vantagens | Badge de risco; alertas; alinhado ao negócio |
| Riscos | Só ~25% das OS têm `EntregData`; prazo textual pode não bater com data |
| Complexidade | Média |
| **Recomendação** | **Secundário** — exibir só quando `EntregData` existir |

### Opção D — Prazo estimado por etapa/setor

| Aspecto | Avaliação |
|---------|-----------|
| Dados necessários | Sequência histórica de setores com tempos (9k OS) |
| Vantagens | Alta explicabilidade (“falta X dias na Encadernação”) |
| Riscos | Cobertura baixa; setores com poucos dados |
| Complexidade | Alta |
| **Recomendação** | **Fase 2** — justificativa textual do modelo |

---

## 9. Estratégia recomendada

### Nível 1 — Estatístico (implementar primeiro) ⭐

- Mediana/percentis de dias restantes por **produto + prioridade + setor atual**.
- Ajuste por idade da OS e tempo parado no setor.
- Risco de atraso: posição vs. percentil 75/90 do histórico similar.
- Explicação: “Baseado em N OS semelhantes (produto X, setor Y)”.
- **Vantagens:** interpretável, rápido, seguro, não exige GPU/libs pesadas.
- **Confiança:** alta quando N ≥ 30; baixa quando produto raro ou OS com 1 andamento histórico.

### Nível 2 — ML clássico (Fase 2)

- **Regressão:** `RandomForestRegressor` ou `GradientBoostingRegressor` para dias restantes.
- **Classificação:** `LogisticRegression` / `RandomForestClassifier` para atraso binário.
- Features: administrativas + técnicas + agregados de fluxo (quando existirem).
- Validação temporal (treino até 2023, teste 2024–2025).
- XGBoost/LightGBM se dependências forem aceitas no servidor.

### Nível 3 — Avançado (Fase 3)

- Similaridade por `Titulo` + produto (TF-IDF ou embeddings).
- Híbrido: k-NN de OS parecidas + modelo global.
- SHAP/top fatores para explicação.

### Recomendação final

**Nível 1 primeiro**, por 4–8 semanas de validação com usuários PCP, depois Nível 2 apenas se o ganho de acurácia justificar (meta: reduzir erro mediano em ≥15% vs. baseline estatístico).

---

## 10. Arquitetura proposta

### Backend (Python / FastAPI)

```
app/backend/services/os_prazo_previsao_service.py   # cálculo
app/backend/routers/os_prazo_routes.py              # endpoints
scripts/treinar_previsao_prazo_os.py                # job offline
scripts/backfill_previsao_prazo_os.py               # recálculo em lote
```

| Endpoint | Função |
|----------|--------|
| `GET /api/os/{nro}/{ano}/previsao-prazo` | Previsão individual + justificativa + confiança |
| `GET /api/os/previsao-prazo/batch?nros=...` | Lote para painéis (lê cache) |
| `POST /api/internal/previsao-prazo/rebuild` | Job admin (backfill) |

### Tabelas novas sugeridas (MySQL-only, sem MDB)

```sql
-- Cache de previsão (leitura rápida na lista)
tab_os_previsao_prazo (
  nro_protocolo, ano_protocolo,
  previsao_conclusao DATE,
  dias_restantes INT,
  risco_atraso ENUM('baixo','medio','alto'),
  probabilidade_atraso DECIMAL(5,4) NULL,
  confianca ENUM('baixa','media','alta'),
  justificativa VARCHAR(500),
  modelo_versao VARCHAR(32),
  calculado_em DATETIME,
  PRIMARY KEY (nro_protocolo, ano_protocolo)
);

-- Histórico opcional para métricas
tab_os_previsao_prazo_log (...);
```

### Frontend

| Local | Exibição |
|-------|----------|
| Lista inicial (`/os/search`) | Coluna opcional “Previsão” + badge de risco (via batch/cache) |
| Detalhes da OS | Card “Estimativa de conclusão” + explicação + confiança |
| Painel PCP / Global | Indicador de risco; filtro “alto risco” |
| OS sem dados | Ocultar ou mostrar “Dados insuficientes” |

### Jobs

| Job | Frequência | Gatilho adicional |
|-----|------------|-------------------|
| Rebuild estatísticas globais | Diário (noite) | — |
| Atualizar cache por OS ativa | A cada 15–30 min | Andamento salvo, edição de `EntregData` |
| Treino ML | Semanal | Após Fase 2 |

---

## 11. Performance

### Regra: não deixar a lista de OS lenta

| Abordagem | Decisão |
|-----------|---------|
| Cálculo on-demand na lista | **Não** — proibido para `/api/os/search` |
| Pré-cálculo em job + cache (`tab_os_previsao_prazo`) | **Sim** |
| JOIN na lista | **Sim**, apenas PK em tabela pequena (451 ativas + cache das vistas recentes) |
| Atualização ao lançar andamento | **Sim**, assíncrono (fila/worker leve, 1 OS) |
| Atualização ao editar OS | **Sim**, se mudar `EntregData`, produto ou prioridade |
| Painéis PCP | Batch endpoint com no máximo N IDs da página |

Estimativa: JOIN em cache adiciona **< 5 ms** por página; cálculo estatístico por OS **< 50 ms** offline.

---

## 12. Queries SQL utilizadas/recomendadas

> Todas são **somente SELECT**. Executadas em 12/06/2026 contra `sagrafulldb`.

### Volume por tabela

```sql
SELECT 'tabProtocolos' AS tabela, COUNT(*) AS registros FROM tabProtocolos
UNION ALL SELECT 'tabAndamento', COUNT(*) FROM tabAndamento
UNION ALL SELECT 'tabDetalhesServico', COUNT(*) FROM tabDetalhesServico
UNION ALL SELECT 'tab_os_ultimo_andamento_operacional', COUNT(*) FROM tab_os_ultimo_andamento_operacional
UNION ALL SELECT 'tab_os_componentes', COUNT(*) FROM tab_os_componentes
UNION ALL SELECT 'tab_os_sub_os', COUNT(*) FROM tab_os_sub_os
UNION ALL SELECT 'tab_pcp_fila', COUNT(*) FROM tab_pcp_fila
UNION ALL SELECT 'tabProofTokens', COUNT(*) FROM tabProofTokens;
```

### OS totais, ativas, concluídas, canceladas

```sql
SELECT
  COUNT(*) AS total_os,
  SUM(ua.situacao = 'Entregue') AS entregues,
  SUM(ua.situacao IN ('Cancelada', 'Cancelado')) AS canceladas,
  SUM(ua.situacao IS NULL OR ua.situacao NOT IN ('Entregue', 'Cancelada', 'Cancelado')) AS ativas
FROM tabProtocolos p
LEFT JOIN tab_os_ultimo_andamento_operacional ua
  ON ua.nro_protocolo = p.NroProtocolo AND ua.ano_protocolo = p.AnoProtocolo;
```

### OS por ano e tipo (normal vs papelaria)

```sql
SELECT AnoProtocolo AS ano,
  COUNT(*) AS total,
  SUM(NroProtocolo < 5000) AS os_normal,
  SUM(NroProtocolo >= 5000) AS papelaria_sp
FROM tabProtocolos
GROUP BY AnoProtocolo
ORDER BY ano DESC;
```

### Média de andamentos por OS

```sql
SELECT
  COUNT(*) AS total_andamentos,
  COUNT(DISTINCT CONCAT(NroProtocoloLink, '/', AnoProtocoloLink)) AS os_distintas,
  ROUND(COUNT(*) / COUNT(DISTINCT CONCAT(NroProtocoloLink, '/', AnoProtocoloLink)), 2) AS media
FROM tabAndamento;
```

### Tempo médio por produto (entregues)

```sql
SELECT d.TipoPublicacaoLink AS produto,
  COUNT(*) AS qtd,
  ROUND(AVG(DATEDIFF(COALESCE(p.DataConclusao, DATE(ua.data)), p.DataEntrada)), 1) AS media_dias
FROM tabProtocolos p
JOIN tab_os_ultimo_andamento_operacional ua
  ON ua.nro_protocolo = p.NroProtocolo AND ua.ano_protocolo = p.AnoProtocolo
JOIN tabDetalhesServico d
  ON d.NroProtocoloLinkDet = p.NroProtocolo AND d.AnoProtocoloLinkDet = p.AnoProtocolo
WHERE ua.situacao = 'Entregue'
  AND p.DataEntrada IS NOT NULL
  AND COALESCE(p.DataConclusao, DATE(ua.data)) >= p.DataEntrada
GROUP BY d.TipoPublicacaoLink
HAVING qtd >= 30
ORDER BY qtd DESC;
```

### Tempo médio por prioridade

```sql
SELECT
  CASE
    WHEN TRIM(COALESCE(p.EntregPrazoLink, '')) LIKE 'Prometido p/%' THEN 'Prometido'
    WHEN TRIM(COALESCE(p.EntregPrazoLink, '')) LIKE 'Solicitado p/%' THEN 'Solicitado'
    ELSE 'Normal'
  END AS prioridade,
  COUNT(*) AS qtd,
  ROUND(AVG(DATEDIFF(COALESCE(p.DataConclusao, DATE(ua.data)), p.DataEntrada)), 1) AS media_dias
FROM tabProtocolos p
JOIN tab_os_ultimo_andamento_operacional ua
  ON ua.nro_protocolo = p.NroProtocolo AND ua.ano_protocolo = p.AnoProtocolo
WHERE ua.situacao = 'Entregue' AND p.DataEntrada IS NOT NULL
GROUP BY prioridade;
```

### Tempo médio por setor atual (OS ativas)

```sql
SELECT ua.setor, COUNT(*) AS qtd,
  ROUND(AVG(DATEDIFF(CURDATE(), DATE(ua.data))), 1) AS dias_no_setor
FROM tab_os_ultimo_andamento_operacional ua
WHERE ua.situacao IS NULL
   OR ua.situacao NOT IN ('Entregue', 'Cancelada', 'Cancelado')
GROUP BY ua.setor
ORDER BY qtd DESC;
```

### Status finais (distribuição)

```sql
SELECT situacao, COUNT(*) AS qtd
FROM tab_os_ultimo_andamento_operacional
GROUP BY situacao
ORDER BY qtd DESC;
```

### Qualidade de datas

```sql
SELECT
  COUNT(*) AS total,
  SUM(DataEntrada IS NULL) AS sem_entrada,
  SUM(EntregData IS NULL) AS sem_entreg_data,
  SUM(DataConclusao IS NULL) AS sem_conclusao,
  SUM(DataConclusao IS NOT NULL AND DataEntrada IS NOT NULL AND DataConclusao < DataEntrada) AS conclusao_antes_entrada,
  SUM(EntregData IS NOT NULL AND DataEntrada IS NOT NULL AND EntregData < DataEntrada) AS prometida_antes_entrada
FROM tabProtocolos;
```

### OS entregues sem DataConclusao (proxy necessário)

```sql
SELECT COUNT(*) AS entregues_sem_data_conclusao
FROM tab_os_ultimo_andamento_operacional ua
JOIN tabProtocolos p
  ON p.NroProtocolo = ua.nro_protocolo AND p.AnoProtocolo = ua.ano_protocolo
WHERE ua.situacao = 'Entregue' AND p.DataConclusao IS NULL;
```

### Campos nulos em detalhes técnicos

```sql
SELECT
  COUNT(*) AS total,
  SUM(TipoPublicacaoLink IS NULL OR TRIM(TipoPublicacaoLink) = '') AS sem_produto,
  SUM(Titulo IS NULL OR TRIM(Titulo) = '') AS sem_titulo,
  SUM(Tiragem IS NULL OR Tiragem = 0) AS sem_tiragem,
  SUM(Pags IS NULL OR Pags = 0) AS sem_pags,
  SUM(FormatoLink IS NULL OR TRIM(FormatoLink) = '') AS sem_formato
FROM tabDetalhesServico;
```

### OS com fluxo completo (2+ andamentos)

```sql
SELECT
  SUM(cnt = 1) AS um_andamento,
  SUM(cnt BETWEEN 2 AND 5) AS dois_a_cinco,
  SUM(cnt >= 6) AS seis_ou_mais
FROM (
  SELECT NroProtocoloLink, AnoProtocoloLink, COUNT(*) AS cnt
  FROM tabAndamento
  GROUP BY NroProtocoloLink, AnoProtocoloLink
) t;
```

### Dataset de treinamento (view lógica recomendada)

```sql
SELECT
  p.NroProtocolo,
  p.AnoProtocolo,
  p.NroProtocolo < 5000 AS is_os_normal,
  p.DataEntrada,
  p.EntregData,
  p.EntregPrazoLink,
  d.TipoPublicacaoLink AS produto,
  d.Tiragem,
  d.Pags,
  ua.situacao,
  ua.setor,
  ua.data AS ultimo_andamento_em,
  COALESCE(p.DataConclusao, DATE(ua.data)) AS data_fim,
  DATEDIFF(COALESCE(p.DataConclusao, DATE(ua.data)), p.DataEntrada) AS dias_total,
  (SELECT COUNT(*) FROM tabAndamento a
   WHERE a.NroProtocoloLink = p.NroProtocolo AND a.AnoProtocoloLink = p.AnoProtocolo) AS qtd_andamentos
FROM tabProtocolos p
JOIN tab_os_ultimo_andamento_operacional ua
  ON ua.nro_protocolo = p.NroProtocolo AND ua.ano_protocolo = p.AnoProtocolo
LEFT JOIN tabDetalhesServico d
  ON d.NroProtocoloLinkDet = p.NroProtocolo AND d.AnoProtocoloLinkDet = p.AnoProtocolo
WHERE ua.situacao = 'Entregue'
  AND p.DataEntrada IS NOT NULL
  AND COALESCE(p.DataConclusao, DATE(ua.data)) >= p.DataEntrada;
```

### Confiabilidade UltimoStatus

```sql
SELECT
  SUM(c > 1) AS multiplos_ultimo_status,
  SUM(c = 0) AS sem_ultimo_status,
  SUM(c = 1) AS ok
FROM (
  SELECT NroProtocoloLink, AnoProtocoloLink, SUM(UltimoStatus = 1) AS c
  FROM tabAndamento
  GROUP BY NroProtocoloLink, AnoProtocoloLink
) t;
```

---

## 13. Plano de implementação por fases

### Fase 1 — Cálculo estatístico (4–6 semanas)

1. Definir `data_fim` = `COALESCE(DataConclusao, andamento Entregue)`.
2. Gerar tabelas agregadas offline: mediana por `(produto, setor, prioridade)`.
3. Criar `tab_os_previsao_prazo` + job de cache para OS ativas.
4. Endpoint individual + batch; exibir na ficha da OS e painel PCP.
5. Regras de confiança (baixa/média/alta) e ocultar quando N < 10.
6. Métricas: erro mediano em OS que concluíram na semana (backtest simples).

### Fase 2 — ML clássico (6–8 semanas)

1. Dataset com flag `fluxo_completo`.
2. Treino separado: OS normal vs. papelaria.
3. Regressão (dias restantes) + classificação (atraso).
4. Validação temporal; comparar com Fase 1.
5. Explicabilidade básica (top 3 features).

### Fase 3 — Similaridade e refinamentos

1. k-NN por título/produto.
2. Incorporar Sub OS quando volume > 500.
3. Tempos por etapa (Target D).
4. Feriados via calendário BR.
5. Integração com `tab_pcp_fila` (posição na fila).

---

## 14. Riscos e cuidados

### Dados

- Previsão baseada em histórico com **88% de OS sem trâmite** pode superestimar velocidade de OS complexas.
- `EntregData` ausente em 75% — risco de atraso não aplicável à maioria sem fallback claro.
- Misturar OS normal e papelaria distorce modelos.
- Produtos com poucas amostras geram previsões instáveis.

### Operacionais

- **Não alterar** `EntregData` nem prioridade automaticamente.
- Exibir sempre como **“Estimativa”**, nunca “prazo oficial”.
- Não prever para canceladas ou recém-criadas (< 4 h sem setor definido).
- Usuário pode ignorar previsão com confiança baixa — UX deve deixar isso claro.

### Performance

- Jamais calcular na query principal da lista sem cache.
- Rebuild completo só fora do horário de pico.

### Interpretação

- Médias históricas longas (Livro, Aerograma) não refletem SLA atual.
- Pendências do usuário (`Pendência Usuário`, `Aguard. Aprovação`) pausam o cronômetro — Fase 2 deve tratar.

---

## 15. Perguntas pendentes

Confirmar manualmente com negócio/PCP:

1. **`DataEntrada` vs. primeiro andamento:** qual representa o “início do cronômetro” para o cliente — cadastro ou entrada em SECOG/SEFOC?
2. **`EntregData`:** quando o campo é preenchido no fluxo? A data em `Solicitado p/` / `Prometido p/` é sempre coerente com `EntregData`?
3. **OS com 1 andamento “Entregue”:** são importações legadas ou entregas reais sem trâmite? Devem entrar no treinamento?
4. **`DataConclusao`:** há plano de backfill para OS entregues antes do SAGRA Web?
5. **Papelaria (≥ 5000):** previsão na mesma UI ou módulo separado?
6. **Pendências e aprovação:** o tempo em `Aguard. Aprovação` / `Pendência Usuário` deve pausar a previsão?
7. **Sub OS:** quando passarão a ser adotadas em escala? Qual peso no prazo da OS principal?
8. **Feriados/recesso da Câmara:** existe calendário oficial a integrar?
9. **Meta de acurácia:** qual erro aceitável (ex. ±2 dias úteis para cartões, ±5 para livretos)?
10. **Horário de corte:** previsão em dias corridos ou dias úteis?

---

## Referências no código

| Artefato | Caminho |
|----------|---------|
| Status final (Entregue/Cancelada) | `app/backend/services/os_search_service.py` |
| Atualização de `DataConclusao` na entrega | `app/backend/services/os_protocolo_andamento_service.py` |
| Materializada último andamento | `app/backend/services/os_ultimo_andamento_service.py` |
| Exclusão espelhos Sub OS | `app/backend/services/andamento_operacional.py` |
| Prioridade na ordenação | `app/backend/services/os_search_service.py` (`_os_search_priority_rank_sql`) |
| Schema Sub OS | `app/backend/os_sub_os_schema.py` |
| Portal de prova (`DataResposta`) | `app/backend/cliente_gabinete_schema.py` |
| Campos de data legados | `app/backend/mdb_helpers.py` (`DATE_FIELDS`) |
| Script de auditoria (esta análise) | `tools/audit_previsao_prazo_data.py` |

---

*Documento gerado na etapa de auditoria. Nenhuma tabela de produção, modelo ou endpoint foi criado ou alterado.*
