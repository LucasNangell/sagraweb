PROMPT 1 — AUDITORIA COMPLETA DO SISTEMA PARA BASE DO MANUAL

Você é um analista de sistemas sênior, arquiteto de software, documentador técnico e especialista em criação de manuais profissionais para sistemas web críticos.

Objetivo desta etapa:
Realizar uma auditoria completa do sistema SAGRA Web para levantar todas as informações necessárias para criar posteriormente um manual completo, dividido em:

1. Manual técnico para analistas/desenvolvedores.
2. Manual operacional para usuário final.

IMPORTANTE:
Nesta etapa, NÃO altere nenhum código do sistema. Apenas analise, mapeie e gere documentação-base.

Regras críticas:

* NÃO alterar código.
* NÃO alterar backend.
* NÃO alterar frontend.
* NÃO alterar banco de dados.
* NÃO alterar `.env`.
* NÃO executar migrations.
* NÃO reiniciar servidor.
* NÃO publicar nada em produção.
* NÃO remover arquivos.
* NÃO criar funcionalidades.
* Apenas analisar e documentar.

Escopo da auditoria:
Analise todo o sistema, incluindo, mas não se limitando a:

Front-end:

* rotas;
* páginas;
* componentes;
* hooks;
* stores;
* contextos;
* serviços de API;
* autenticação;
* formulários;
* dashboards;
* permissões visuais;
* fluxos de navegação;
* estados de loading, erro e vazio;
* responsividade;
* bibliotecas utilizadas.

Back-end:

* rotas/endpoints;
* routers;
* services;
* models/schemas;
* autenticação;
* permissões;
* integrações externas;
* leitura/escrita no banco;
* regras de negócio;
* logs;
* uploads;
* geração de arquivos;
* envio de e-mail;
* sincronizações;
* tarefas automáticas, se existirem.

Banco de dados:

* tabelas principais;
* campos importantes;
* relacionamentos relevantes;
* tabelas legadas;
* tabelas do sistema novo;
* tabelas de autenticação;
* tabelas de OS, protocolos, andamento, usuários, cliente, análise, problemas técnicos, provas, arquivos, e-mail, contas e demais módulos existentes.

Módulos obrigatórios para mapear, se existirem:

* Login interno.
* Login do cliente.
* Página inicial/dashboard.
* Gerência.
* Análise.
* E-mail.
* Portal do Cliente.
* Portal de Problemas Técnicos.
* Página de Provas/Aprovação.
* Envio de arquivos.
* Contas do gabinete.
* Ordens de serviço.
* Andamentos/timeline.
* Protocolos.
* Usuários/permissões.
* Relatórios.
* Integrações com pasta de rede.
* Integrações com Google Drive, se existirem.
* Integrações com e-mail/EWS, se existirem.
* Sincronização MDB/MySQL, se existir.
* Upload/download de arquivos.
* Geração de PDF.
* Qualquer outro módulo encontrado no código.

Tarefas obrigatórias:

1. Mapear a arquitetura geral do sistema:

* stack utilizada;
* estrutura de pastas;
* separação frontend/backend;
* bibliotecas principais;
* padrão de rotas;
* padrão de API;
* padrão de autenticação;
* padrão de estado global;
* padrão de banco de dados.

2. Mapear todas as rotas do front-end:
   Para cada rota, documentar:

* URL;
* componente principal;
* finalidade;
* tipo de usuário que acessa;
* dados carregados;
* APIs chamadas;
* ações disponíveis;
* permissões envolvidas;
* estados de erro/loading/vazio;
* observações técnicas.

3. Mapear todos os endpoints do backend:
   Para cada endpoint, documentar:

* método HTTP;
* rota;
* arquivo/função responsável;
* finalidade;
* autenticação exigida;
* parâmetros de path;
* query params;
* body esperado;
* resposta esperada;
* tabelas consultadas/alteradas;
* efeitos colaterais;
* erros possíveis;
* telas que consomem o endpoint.

4. Mapear fluxos principais:
   Documentar fluxo ponta a ponta de:

* autenticação interna;
* autenticação do cliente;
* criação/consulta de OS;
* andamento/timeline;
* análise técnica;
* geração de problemas técnicos;
* portal de problemas técnicos;
* upload de arquivos corrigidos;
* provas e aprovação;
* envio de e-mails;
* contas do gabinete;
* atualização/refetch do Portal do Cliente;
* qualquer fluxo crítico encontrado.

5. Mapear entidades e dados:
   Documentar:

* principais tabelas;
* campos relevantes;
* como OS é identificada;
* como ano/protocolo são usados;
* como usuários são identificados;
* como cliente/gabinete é identificado;
* como tokens são usados;
* como arquivos são armazenados;
* como andamentos são registrados.

6. Mapear riscos e pontos sensíveis:
   Listar:

* arquivos críticos que não devem ser alterados sem cuidado;
* endpoints sensíveis;
* fluxos que impactam produção;
* autenticações diferentes;
* dependências de caminho de rede;
* dependências de banco legado;
* dependências de e-mail/Drive;
* riscos de cache/service worker;
* riscos de performance;
* riscos de permissões.

7. Mapear funcionalidades do usuário final:
   Para cada funcionalidade, registrar:

* nome da funcionalidade;
* onde fica no sistema;
* quem usa;
* para que serve;
* passo a passo resumido;
* resultado esperado;
* erros comuns;
* observações.

Saída obrigatória:
Criar o arquivo:

`docs/INVENTARIO_COMPLETO_PARA_MANUAL_SAGRA_WEB.md`

Esse arquivo deve conter:

1. Visão geral do sistema.
2. Arquitetura técnica.
3. Estrutura de pastas.
4. Mapa de rotas front-end.
5. Mapa de endpoints back-end.
6. Mapa de módulos.
7. Mapa de fluxos principais.
8. Mapa de tabelas/dados.
9. Mapa de autenticação e permissões.
10. Integrações externas.
11. Funcionalidades do usuário final.
12. Riscos técnicos.
13. Itens pendentes ou não encontrados.
14. Recomendações para criação do manual completo.

Critérios de qualidade:

* Seja detalhado.
* Não invente funcionalidades.
* Quando não encontrar algo, escreva “não identificado no código analisado”.
* Cite caminhos de arquivos sempre que possível.
* Diferencie claramente o que é certeza do que é inferência.
* Não simplifique demais.
* Esse inventário será usado como base para gerar um manual completo profissional.

Ao final, responda:

* arquivo criado;
* resumo do que foi mapeado;
* limitações encontradas;
* próximos passos recomendados.
