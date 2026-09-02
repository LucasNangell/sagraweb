# Plano de implementação - Sequência de produção da OS

## Objetivo

Criar uma nova aba **Sequência de produção** no modal `os-gerencia-root`, capaz de:

1. gerar automaticamente uma prévia da sequência de produção a partir dos dados da OS;
2. permitir edição manual da sequência antes da emissão;
3. salvar o rascunho editado para reabrir depois;
4. criar um `.docx` formatado no padrão dos documentos modelo analisados;
5. salvar o `.docx` na pasta da OS.

A funcionalidade deve ser determinística e auditável. O usuário precisa conseguir entender de onde veio cada etapa, editar o texto quando necessário e gerar o Word final sem depender de edição externa.

## Contexto técnico existente

- O modal de detalhes da OS é `apps/web/src/features/os/components/OsGerenciaDetailModal.tsx`.
- As abas do modal são montadas por `buildGerenciaModalNavSections` e renderizadas por `renderGerenciaSection`.
- As seções atuais da gerência ficam em `apps/web/src/features/gerencia/components/GerenciaFormSections.tsx`.
- Os dados técnicos mais importantes já estão em `TechSpec`, definido em `apps/web/src/features/gerencia/techSpec.ts`.
- O backend já expõe dados da OS em `GET /os/{ano}/{id}/details`.
- O backend já resolve e cria pasta da OS com `folder-plan`, `folder-create` e `_resolve_os_root_path`.
- O estudo de padrões está em `estudos/relatorio_padroes_offset.md` e a base estruturada em `estudos/analise_offset_padroes.json`.

## Decisão de arquitetura

Implementar a geração no backend, não no frontend.

Motivos:

- a criação do `.docx` precisa acessar a pasta da OS na rede;
- as regras precisam ser testáveis sem interface;
- a geração deve ser igual para todos os usuários;
- o backend já concentra a leitura de OS, componentes, pasta e permissões;
- evita expor caminhos de rede e lógica de arquivo no navegador.

O frontend deve apenas exibir o rascunho, permitir edição e acionar as operações.

## Modelo funcional

### Estados da aba

A aba deve trabalhar com quatro estados:

1. **Gerado automaticamente**: ainda não houve edição manual.
2. **Editado pelo usuário**: o rascunho foi alterado e salvo.
3. **Divergente da OS**: a OS mudou depois da última geração/edição.
4. **DOCX criado**: existe arquivo final salvo na pasta da OS.

### Comportamento esperado

Ao abrir a aba:

1. buscar o rascunho salvo;
2. se não houver rascunho, gerar uma sequência inicial a partir da OS;
3. se houver rascunho, comparar o hash dos dados-base da OS;
4. se os dados-base mudaram, mostrar aviso e oferecer **Regenerar a partir da OS**.

O botão **Criar docx** deve gerar o documento usando exatamente o conteúdo exibido/editado na aba, não recalcular silenciosamente uma sequência diferente.

## Contrato de dados

Criar um modelo canônico independente do `.docx`:

```json
{
  "version": 1,
  "os": {
    "numero": 2,
    "ano": 2026,
    "titulo": "..."
  },
  "source_hash": "sha256...",
  "confidence": "automatic | automatic_with_notes | needs_review",
  "warnings": [
    {
      "code": "WIRE_O_EXCEPTION",
      "message": "Sequência com Wire-O exige conferência."
    }
  ],
  "sections": [
    {
      "id": "impressao",
      "title": "Impressão",
      "blocks": [
        {
          "id": "formato-impressao",
          "title": "Formato de Impressão",
          "lines": [
            "Capa: 656 x 470mm (CF 115g)",
            "Miolo: 656 x 470mm (Ap 90g)"
          ],
          "locked": false,
          "confidence": "automatic"
        }
      ]
    },
    {
      "id": "acabamento",
      "title": "Acabamento",
      "blocks": [
        {
          "id": "corte",
          "title": "Corte",
          "lines": [
            "Capa: conforme indicação na impressão",
            "Miolo: TR 8pgs"
          ],
          "confidence": "automatic"
        }
      ]
    }
  ]
}
```

Esse JSON é a fonte única para:

- renderização da prévia na aba;
- salvamento do rascunho;
- geração do `.docx`;
- testes de regras.

## Backend

### Novos arquivos

Criar os serviços:

- `app/backend/services/sequencia_producao_models.py`
- `app/backend/services/sequencia_producao_rules.py`
- `app/backend/services/sequencia_producao_service.py`
- `app/backend/services/sequencia_producao_docx.py`

Criar a rota:

- `app/backend/routers/sequencia_producao_routes.py`

Registrar essa rota no carregamento principal da API, seguindo o padrão dos demais routers.

### Persistência

Criar tabela MySQL:

```sql
CREATE TABLE IF NOT EXISTS tab_os_sequencia_producao (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  nro_protocolo INT NOT NULL,
  ano_protocolo INT NOT NULL,
  draft_json JSON NOT NULL,
  source_hash CHAR(64) NOT NULL,
  docx_relative_path VARCHAR(500) NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(20) NULL,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  atualizado_por VARCHAR(20) NULL,
  UNIQUE KEY uq_os_sequencia (nro_protocolo, ano_protocolo)
);
```

Justificativa:

- permite reabrir uma sequência editada;
- evita perder alterações ao fechar o modal;
- permite detectar se a OS mudou desde a geração;
- não depende da pasta de rede estar disponível para salvar o rascunho.

### Endpoints

Adicionar:

#### `GET /os/{ano}/{id}/sequencia-producao`

Retorna o rascunho salvo ou uma geração inicial.

Query params:

- `regenerate=false`: quando `true`, ignora rascunho salvo e recalcula.

Resposta:

```json
{
  "status": "ok",
  "draft": {},
  "saved": true,
  "source_changed": false,
  "docx": {
    "exists": true,
    "relative_path": "00002_Seq Produçao.docx",
    "download_url": "/api/os/2026/2/sequencia-producao/docx"
  }
}
```

#### `PUT /os/{ano}/{id}/sequencia-producao`

Salva o rascunho editado.

Body:

```json
{
  "draft": {},
  "source_hash": "sha256..."
}
```

Validações:

- OS deve existir;
- JSON deve respeitar o schema;
- bloquear linhas completamente vazias no meio de blocos, normalizando espaços;
- registrar `atualizado_por`.

#### `POST /os/{ano}/{id}/sequencia-producao/docx`

Gera o `.docx` a partir do rascunho enviado ou do rascunho salvo.

Body:

```json
{
  "draft": {},
  "overwrite": false
}
```

Comportamento:

- se a pasta da OS não existir, tentar `ensure_os_folder_on_network`;
- salvar como `{OS_5_DIGITOS}_Seq Produçao.docx`;
- se já existir e `overwrite=false`, salvar versão com sufixo incremental: `{OS_5_DIGITOS}_Seq Produçao_v2.docx`;
- atualizar `docx_relative_path` na tabela;
- retornar caminho relativo e URL para download.

#### `GET /os/{ano}/{id}/sequencia-producao/docx`

Baixa ou abre o último `.docx` gerado.

### Geração das regras

O serviço `sequencia_producao_rules.py` deve receber:

- dados de `tabProtocolos` + `tabDetalhesServico`;
- componentes persistidos em `tab_os_componentes`;
- campos legados quando não houver componentes;
- parâmetros da OS: produto, formato, máquina, tiragem, páginas, frente/verso, papel, cores, acabamento e observação.

Fluxo:

1. normalizar textos;
2. montar componentes;
3. calcular formato de impressão por componente;
4. montar etapas de acabamento;
5. ordenar etapas;
6. atribuir confiança e avisos.

### Normalização obrigatória

Criar normalizador único para:

- remover acentos;
- corrigir grafias recorrentes;
- unificar caixa;
- mapear variações para códigos internos.

Mapeamentos iniciais:

- `Grampo canoa`, `Grampo Canoa`, `Granpo`, `Grapo`, `Gramnpo`, `Granmpo` -> `ENCADERNACAO_CANOA`
- `Laminação`, `Laminaçao`, `Laminacao` -> `LAMINACAO`
- `Laminação Brilho` -> `LAMINACAO_BRILHO`
- `Laminação Fosca` -> `LAMINACAO_FOSCA`
- `Wire-O`, `Wire-ô`, `Wire` -> `WIRE_O`
- `Serrilha`, `serrilha`, `serilha`, `picote` -> `SERRILHA_PICOTE`
- `Refile`, `Refile Final`, `Guilhotina` -> `REFILE_FINAL`

### Regras iniciais de produto

#### Livreto c/ Capa

Sequência padrão:

1. Impressão
2. Formato de Impressão
3. Acabamento
4. Corte
5. Dobra
6. Alceamento
7. Encadernação (Canoa)
8. Refile Final

Regras:

- capa normalmente como `4 pgs`;
- miolo decomposto em cadernos de 16, 12 sanfona, 8 e 4 páginas;
- encadernação canoa com `2 grampos`;
- refile em guilhotina.

#### Revista c/ Capa

Mesmo fluxo de livreto com capa, mas formato final mais comum A4.

Priorizar regras de:

- capa 4 páginas;
- miolo em 16/8/4 páginas;
- canoa.

#### Revista

Fluxo próximo ao de revista com capa, mas sem componente `Capa` se o `TechSpec` não trouxer capa.

#### Livreto s/ Capa

Fluxo de canoa sem etapa de capa separada.

#### Livro

Sequência padrão:

1. Impressão
2. Formato de Impressão
3. Acabamento
4. Laminação, quando aplicável
5. Corte
6. Dobra, exceto lâminas soltas/Wire-O
7. Alceamento
8. Capeadeira ou Wire-O
9. Refile Final

Regras:

- capa separada para laminação/capeadeira;
- miolo em cadernos 16/8/4 quando não for lâmina solta;
- lombada e orelhas entram como linhas de capeadeira/acabamento;
- Wire-O substitui capeadeira/cola e precisa de aviso de conferência.

### Formato de impressão

Não hardcodar tudo no código principal.

Criar uma tabela parametrizável, inicialmente em JSON ou tabela MySQL, com chave:

```text
produto + formato_final + componente + maquina + papel
```

Retorno:

```text
formato_impressao = "656 x 470mm"
observacao = "TR 8pgs" | "SANFONA 12pgs" | null
```

Seed inicial com os padrões mais frequentes do estudo:

- `Capa A5 Komori CF 115g` -> `656 x 470mm`
- `Miolo A5 Komori AP 90g` -> `656 x 470mm`
- `Miolo A5 AP 75g` -> `656 x 470mm`
- `Miolo A5 AP 90g sanfona 12pgs` -> `656 x 318mm - SANFONA 12pgs`
- `Capa A4 CF 115g` -> `455 x 328mm`
- `Capa livro CF 250g` -> `450 x 300mm`, `478 x 300mm`, `520 x 300mm`, conforme formato final/lombada.

Quando não houver regra confiável:

- gerar linha com formato pendente: `Capa: conferir formato de impressão (CF 250g)`;
- marcar bloco como `needs_review`;
- não bloquear a edição nem a criação do `.docx`, mas mostrar aviso.

### Dobras e cadernos

Criar função:

```python
build_cadernos(total_paginas: int, produto: str, tem_capa: bool) -> list[Caderno]
```

Base:

- 16 páginas: três dobras, vertical/cabeça/vertical;
- 12 páginas: sanfona quando regra de formato indicar;
- 8 páginas: duas dobras, cabeça/vertical;
- 4 páginas: uma dobra vertical;
- capa com canoa: `Capa - 4 pgs`.

Estratégia inicial:

1. subtrair páginas de capa quando houver componente capa;
2. decompor miolo por maior caderno possível: 16, depois 12 se compatível, depois 8, depois 4;
3. se sobrar valor não suportado, gerar aviso `PAGES_NOT_MATCHING_SIGNATURE`.

## Geração do DOCX

### Dependência

Adicionar `python-docx` em `app/backend/requirements.txt`.

### Template

Criar `app/backend/templates/sequencia_producao_base.docx` a partir de um dos modelos existentes, mantendo:

- fonte;
- margens;
- estilos de título;
- estilos de subtítulo;
- espaçamentos.

Não usar documentos reais de OS como template em produção sem limpar conteúdo. O template deve conter somente estilos.

### Renderização do conteúdo

O `.docx` deve seguir o padrão dos modelos:

```text
Sequência de Produção da OS 00002/2026

Impressão

Formato de Impressão
Capa: 656 x 470mm (CF 115g)
Miolo: 656 x 470mm (Ap 90g)

Acabamento

Corte
Capa: conforme indicação na impressão
Miolo: TR 8pgs

Dobra (Dobradeira)
...
```

Regras de formatação:

- título no topo com OS em 5 dígitos;
- títulos de seção em negrito;
- blocos com espaçamento entre etapas;
- sem tabela;
- preservar acentos;
- usar `Produção` no título, mas nome do arquivo deve seguir o padrão existente: `Seq Produçao`, salvo se for decidido padronizar para `Produção`.

## Frontend

### Novos arquivos

- `apps/web/src/api/sequenciaProducao.ts`
- `apps/web/src/api/hooks/useSequenciaProducao.ts`
- `apps/web/src/features/os/components/OsSequenciaProducaoTab.tsx`
- `apps/web/src/features/os/components/OsSequenciaProducaoTab.test.tsx`

### Integração no modal

Alterar `OsGerenciaDetailModal.tsx`:

- incluir `"sequencia-producao"` em `GerenciaModalNavId`;
- adicionar `{ id: "sequencia-producao", label: "Sequência de produção" }` em `buildGerenciaModalNavSections`;
- renderizar `OsSequenciaProducaoTab` quando essa seção estiver ativa;
- passar `ano`, `osId`, `form`, `techSpec`, `formEditable` e permissões.

Essa aba deve aparecer apenas para OS existente, não para criação/duplicação ainda não salva.

### UI da aba

Layout sugerido:

- cabeçalho com status:
  - `Automática`;
  - `Editada`;
  - `Requer conferência`;
  - `OS alterada após geração`.
- ações:
  - **Regenerar a partir da OS**;
  - **Salvar rascunho**;
  - **Criar docx**;
  - **Abrir/Baixar docx**, quando existir.
- corpo:
  - cartões/áreas por seção: Impressão e Acabamento;
  - dentro de cada seção, blocos reordenáveis ou ao menos editáveis;
  - cada bloco com:
    - título;
    - textarea multiline para linhas;
    - botão de remover bloco;
    - botão de adicionar linha/bloco;
    - badge de confiança/aviso.

Para a primeira versão, evitar drag-and-drop. Usar botões `Subir` e `Descer` para reordenar blocos é mais simples e mais testável.

### Edição e salvamento

A aba terá estado próprio de rascunho.

Regras:

- edição da sequência não deve alterar automaticamente os dados da OS;
- se a OS estiver em modo somente leitura, a sequência também deve ser somente leitura, exceto o botão de download;
- `Salvar rascunho` salva o JSON;
- `Criar docx` deve salvar o rascunho antes de gerar, ou enviar o rascunho atual no corpo da requisição.

### Permissões

Criar permissões específicas ou reaproveitar temporariamente:

- visualizar: mesma permissão de detalhes da OS;
- editar rascunho/criar docx: inicialmente `ctx_editar_os`, mas idealmente criar:
  - `ctx_sequencia_producao_editar`
  - `ctx_sequencia_producao_gerar_docx`

## Testes

### Backend unitários

Criar `app/backend/tests/test_sequencia_producao_rules.py`.

Cobrir:

- livreto A5 com capa, 12 páginas, canoa;
- revista A4 com capa;
- livro com laminação fosca, lombada e refile;
- livro Wire-O com lâminas soltas;
- variações de grafia: `Granpo`, `Grapo`, `Laminaçao`, `Wire-ô`;
- falta de regra de formato de impressão gera `needs_review`;
- decomposição de páginas em cadernos.

### Backend integração

Criar `app/backend/tests/test_sequencia_producao_routes.py`.

Cobrir:

- `GET` retorna draft gerado;
- `PUT` salva rascunho editado;
- `GET` posterior retorna rascunho salvo;
- mudança no hash marca `source_changed`;
- `POST docx` cria arquivo em pasta temporária;
- conflito de arquivo gera sufixo quando `overwrite=false`.

### DOCX

Criar `app/backend/tests/test_sequencia_producao_docx.py`.

Verificar:

- arquivo é um `.docx` válido;
- título contém `Sequência de Produção da OS 00002/2026`;
- seções aparecem na ordem;
- linhas editadas pelo usuário aparecem exatamente;
- documento não usa tabelas;
- nome do arquivo segue padrão.

### Frontend

Criar testes com Vitest/Testing Library:

- nova aba aparece no modal para OS existente;
- aba não aparece durante criação/duplicação não salva;
- carrega rascunho automático;
- permite editar uma linha;
- salva rascunho;
- chama criação do `.docx`;
- exibe aviso quando `source_changed=true`;
- mostra link de download quando o backend retorna arquivo existente.

## Plano de entrega em fases

### Fase 1 - Núcleo de regras e DOCX sem UI

Entregas:

- modelos Pydantic;
- serviço de geração do JSON;
- normalização de acabamentos;
- writer `.docx`;
- testes unitários de regras;
- testes do `.docx`.

Critério de aceite:

- gerar, via teste, `.docx` válido para ao menos:
  - livreto com capa;
  - revista com capa;
  - livro com laminação/capeadeira;
  - livro com Wire-O.

### Fase 2 - Rotas e persistência

Entregas:

- tabela `tab_os_sequencia_producao`;
- endpoints `GET`, `PUT`, `POST docx`, `GET docx`;
- integração com pasta da OS;
- controle de conflito/sufixo;
- testes de rotas.

Critério de aceite:

- uma OS existente abre rascunho;
- rascunho editado persiste;
- documento final é salvo na pasta correta da OS.

### Fase 3 - Aba no modal

Entregas:

- API frontend;
- hook React Query;
- componente `OsSequenciaProducaoTab`;
- integração no `OsGerenciaDetailModal`;
- testes de UI.

Critério de aceite:

- usuário abre a aba, edita, salva rascunho e gera `.docx`;
- o botão de download/abrir aparece após a geração;
- estados de carregando/erro/sucesso são claros.

### Fase 4 - Parametrização e melhoria de cobertura

Entregas:

- tela ou config interna para tabela de formato de impressão;
- seed com padrões do estudo;
- ampliação de regras por formato/máquina/papel;
- relatório interno de confiança por OS.

Critério de aceite:

- regras deixam de depender de hardcode espalhado;
- casos sem regra explícita ficam marcados para conferência, não geram sequência enganosa.

## Riscos e mitigação

- **Formato de impressão não é totalmente dedutível pela OS atual.** Mitigação: tabela parametrizável e `needs_review`.
- **Acabamento tem muitas grafias livres.** Mitigação: normalizador central e testes com grafias reais do estudo.
- **Usuário edita a sequência e depois altera dados técnicos da OS.** Mitigação: `source_hash` e aviso de divergência.
- **Pasta de rede indisponível.** Mitigação: permitir salvar rascunho no banco; bloquear apenas a criação do `.docx` com mensagem clara.
- **Documento modelo tem conteúdo de OS real.** Mitigação: criar template limpo só com estilos.
- **Wire-O e lâminas soltas podem herdar texto de canoa em modelos antigos.** Mitigação: regra específica com aviso e prioridade sobre canoa.

## Ordem recomendada de implementação

1. Criar `sequencia_producao_models.py`.
2. Criar normalizador e regras puras em `sequencia_producao_rules.py`.
3. Criar testes com exemplos reais retirados da base analisada.
4. Criar writer `.docx` com template limpo.
5. Criar persistência e endpoints.
6. Criar API/hook frontend.
7. Adicionar aba no modal.
8. Criar componente editável.
9. Rodar testes backend e frontend.
10. Validar manualmente com 4 OS reais: uma de livreto, uma de revista, uma de livro capeado e uma de Wire-O.

## Definição de pronto

A funcionalidade só deve ser considerada pronta quando:

- a aba aparece no modal da OS existente;
- a sequência inicial é gerada a partir da OS;
- o usuário consegue editar e salvar o rascunho;
- o botão **Criar docx** salva arquivo Word válido;
- o arquivo segue o padrão visual/textual dos modelos;
- há tratamento para pasta indisponível;
- há aviso quando a OS mudou após geração;
- testes cobrem regras principais, rotas e UI;
- ao menos 4 OS reais foram comparadas visualmente com seus modelos históricos.
