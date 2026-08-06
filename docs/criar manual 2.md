PROMPT 2 — CRIAR MANUAL COMPLETO DO SISTEMA EM MARKDOWN

Você é um analista de sistemas sênior, documentador técnico, especialista em UX writing, instrutor de sistemas corporativos e arquiteto de software.

Objetivo:
Criar um manual completo, profissional e extremamente detalhado do sistema SAGRA Web em formato Markdown.

Este manual deve ter duas grandes partes:

PARTE 1 — Manual Técnico do Sistema
Voltado para analistas de sistemas, desenvolvedores, suporte técnico, administradores e equipe de manutenção.

PARTE 2 — Manual do Usuário Final
Voltado para usuários comuns do sistema, explicando como usar cada funcionalidade, tela, botão, fluxo e recurso.

Arquivos obrigatórios para leitura:

* `docs/INVENTARIO_COMPLETO_PARA_MANUAL_SAGRA_WEB.md`
* todos os arquivos de documentação existentes em `docs/`
* arquivos principais do frontend
* arquivos principais do backend
* arquivos de API
* arquivos de rotas
* arquivos de configuração relevantes
* qualquer documentação já existente do sistema

Regras críticas:

* NÃO alterar código.
* NÃO alterar backend.
* NÃO alterar frontend.
* NÃO alterar banco de dados.
* NÃO alterar `.env`.
* NÃO executar migrations.
* NÃO reiniciar servidor.
* NÃO publicar em produção.
* Apenas criar o manual em Markdown.

Arquivo final obrigatório:
Criar:

`docs/MANUAL_COMPLETO_SAGRA_WEB.md`

Estrutura obrigatória do manual:

# MANUAL COMPLETO DO SISTEMA SAGRA WEB

## Capa

Incluir:

* nome do sistema;
* subtítulo;
* versão/data de geração;
* finalidade do documento;
* público-alvo;
* observação de confidencialidade, se aplicável.

## Sumário

Criar sumário detalhado com links internos Markdown.

---

# PARTE 1 — MANUAL TÉCNICO DO SISTEMA

## 1. Visão Geral Técnica

Explicar:

* o que é o sistema;
* finalidade;
* público atendido;
* principais módulos;
* visão geral da arquitetura;
* tecnologias utilizadas;
* separação frontend/backend;
* relação com banco de dados;
* integrações externas.

## 2. Arquitetura do Sistema

Detalhar:

* arquitetura geral;
* frontend;
* backend;
* banco de dados;
* autenticação;
* permissões;
* comunicação via APIs;
* arquivos estáticos;
* build;
* produção;
* service worker/cache, se existir.

## 3. Estrutura de Pastas

Documentar:

* principais diretórios;
* função de cada pasta;
* arquivos críticos;
* onde ficam páginas;
* onde ficam componentes;
* onde ficam APIs;
* onde ficam routers backend;
* onde ficam services;
* onde ficam documentos.

## 4. Front-end

Documentar:

* framework usado;
* roteamento;
* componentes principais;
* stores/estado global;
* hooks;
* chamadas de API;
* padrões de loading;
* padrões de erro;
* responsividade;
* design system/Tailwind;
* build.

Para cada página/rota, incluir:

* URL;
* componente principal;
* descrição;
* usuário-alvo;
* dados carregados;
* APIs chamadas;
* ações disponíveis;
* estados da tela;
* observações técnicas.

## 5. Back-end

Documentar:

* framework usado;
* organização dos routers;
* serviços;
* autenticação;
* tratamento de sessão;
* endpoints;
* uploads;
* geração de relatórios;
* envio de e-mails;
* integrações;
* logs;
* erros comuns.

## 6. APIs e Endpoints

Criar uma seção detalhada com todos os endpoints encontrados.

Para cada endpoint, documentar:

* método;
* rota;
* arquivo/função;
* objetivo;
* autenticação;
* parâmetros;
* body;
* resposta;
* tabelas envolvidas;
* efeitos colaterais;
* tela que consome;
* observações.

Organizar por módulo:

* autenticação;
* usuário interno;
* cliente;
* OS;
* andamento;
* análise;
* problemas técnicos;
* provas/aprovação;
* arquivos/upload;
* e-mail;
* contas;
* relatórios;
* demais módulos encontrados.

## 7. Banco de Dados

Documentar:

* principais tabelas;
* finalidade de cada tabela;
* campos relevantes;
* relacionamentos conhecidos;
* chaves lógicas;
* tabelas legadas;
* tabelas críticas;
* tabelas usadas em fluxos específicos.

Não inventar schema se não estiver no código. Quando não houver certeza, informar claramente.

## 8. Autenticação, Sessões e Permissões

Explicar:

* login interno;
* login cliente;
* cookies;
* tokens;
* diferença entre portal autenticado e portal público por token;
* guards;
* permissões;
* riscos e cuidados.

## 9. Fluxos Técnicos Ponta a Ponta

Documentar detalhadamente:

* login interno;
* login do cliente;
* carregamento do dashboard;
* criação/consulta de OS;
* timeline/andamentos;
* análise técnica;
* geração de link de problemas técnicos;
* portal de problemas técnicos;
* desconsideração de item;
* upload de arquivo corrigido;
* expiração de token;
* página de provas;
* aprovação/reprovação;
* envio de e-mail;
* build/publicação;
* qualquer outro fluxo encontrado.

Usar diagramas Mermaid quando útil.

## 10. Integrações Externas

Documentar:

* e-mail/EWS;
* Google Drive;
* pasta de rede;
* banco legado MDB;
* MySQL/MariaDB;
* serviço de arquivos;
* qualquer outra integração encontrada.

## 11. Performance e Atualizações Automáticas

Documentar:

* React Query;
* staleTime;
* refetchInterval;
* polling;
* lazy loading;
* timeline sob demanda;
* riscos de chamadas excessivas;
* cache;
* service worker.

## 12. Segurança e Pontos Críticos

Documentar:

* endpoints sensíveis;
* tokens;
* uploads;
* autenticação;
* permissões;
* riscos de exposição de arquivos;
* dados sensíveis;
* cuidados em produção.

## 13. Build, Deploy e Produção

Explicar:

* comando de build;
* pasta de saída;
* pasta de produção;
* arquivos estáticos;
* backup antes de publicar;
* o que não deve ser alterado;
* como validar depois da publicação;
* cuidados para não reiniciar servidor indevidamente.

## 14. Manutenção e Suporte

Documentar:

* onde procurar erros;
* como diagnosticar problemas comuns;
* como validar se APIs estão funcionando;
* como validar frontend;
* como validar produção;
* checklist de suporte.

---

# PARTE 2 — MANUAL DO USUÁRIO FINAL

Esta parte deve ser didática, clara e organizada para usuários comuns.

## 15. Introdução ao Sistema

Explicar:

* para que serve o SAGRA Web;
* quem utiliza;
* principais benefícios;
* visão geral das telas.

## 16. Acesso ao Sistema

Explicar:

* como acessar;
* como fazer login;
* diferença entre usuário interno e cliente;
* problemas comuns de acesso;
* o que fazer se a sessão expirar.

## 17. Página Inicial / Dashboard

Explicar:

* o que aparece na tela;
* indicadores;
* filtros;
* cards;
* botões;
* atualização;
* como interpretar informações.

## 18. Ordens de Serviço

Explicar:

* o que é uma OS;
* como localizar;
* como acompanhar;
* status;
* setores;
* informações exibidas;
* timeline/andamentos.

## 19. Gerência / Gestão de OS

Se existir, explicar:

* finalidade;
* filtros;
* colunas;
* ações;
* alteração de status;
* acompanhamento;
* boas práticas.

## 20. Análise Técnica

Explicar para o usuário responsável:

* finalidade da análise;
* como acessar;
* como selecionar componentes;
* como registrar problemas;
* como usar biblioteca de problemas;
* como concluir;
* o que acontece quando há problemas técnicos;
* o que acontece quando não há problemas;
* cuidados antes de finalizar.

## 21. Problemas Técnicos

Explicar:

* o que são;
* como o cliente visualiza;
* como o técnico gera;
* como o cliente desconsidera item;
* como o cliente envia arquivo corrigido;
* quando o link expira;
* como acompanhar retorno.

## 22. Provas e Aprovação

Explicar:

* o que é prova;
* como visualizar;
* como aprovar;
* como solicitar ajuste;
* quando usar observação;
* consequências da aprovação;
* cuidados antes de aprovar.

## 23. Portal do Cliente

Explicar detalhadamente:

* login;
* cabeçalho;
* dados do gabinete;
* contadores;
* seção “Problemas Técnicos”;
* seção “Aguardando Aprovação”;
* seção “Aguardando Arquivos”;
* seção “Em andamento”;
* como abrir e fechar seções;
* como abrir detalhes da OS;
* como usar CTAs;
* como atualizar;
* como sair.

## 24. Envio de Arquivos

Explicar:

* quando enviar;
* formatos aceitos;
* limites, se existirem;
* confirmação;
* erros comuns;
* boas práticas de nome de arquivo.

## 25. E-mail

Se existir módulo interno de e-mail, explicar:

* finalidade;
* envio de problemas técnicos;
* envio de prova;
* templates;
* confirmação;
* cuidados.

## 26. Contas do Gabinete

Explicar:

* o que são;
* onde visualizar;
* como interpretar;
* limites/cotas;
* informações disponíveis.

## 27. Relatórios

Se existirem:

* como gerar;
* tipos de relatório;
* filtros;
* exportação;
* PDF;
* interpretação.

## 28. Usuários e Permissões

Se existir área administrativa:

* perfis;
* permissões;
* criação/edição;
* cuidados.

## 29. Erros Comuns e Como Resolver

Criar uma tabela com:

* problema;
* possível causa;
* como resolver;
* quando acionar suporte.

Exemplos:

* não consigo acessar;
* OS não aparece;
* botão não funciona;
* arquivo não envia;
* link expirado;
* prova não abre;
* problema técnico já foi resolvido mas ainda aparece;
* página desatualizada;
* erro de permissão.

## 30. Boas Práticas de Uso

Explicar:

* atualização da página;
* conferência antes de aprovar;
* envio correto de arquivos;
* uso de observações;
* acompanhamento de pendências.

## 31. Glossário

Criar glossário com termos como:

* OS;
* protocolo;
* andamento;
* setor;
* situação;
* PTV;
* prova;
* problemas técnicos;
* token;
* dashboard;
* portal do cliente;
* upload;
* refetch;
* aprovação;
* pendência.

## 32. Checklists Operacionais

Criar checklists:

* checklist para técnico concluir análise;
* checklist para cliente resolver problema técnico;
* checklist para cliente aprovar prova;
* checklist para suporte validar erro;
* checklist antes de publicar em produção.

## 33. Apêndices

Adicionar:

* matriz de módulos;
* matriz de endpoints resumida;
* matriz de permissões, se possível;
* histórico de versões do manual;
* observações técnicas.

Critérios de escrita:

* Linguagem técnica na Parte 1.
* Linguagem simples e didática na Parte 2.
* Explicações detalhadas, mas organizadas.
* Usar tabelas sempre que ajudar.
* Usar diagramas Mermaid quando fizer sentido.
* Usar blocos de atenção, exemplo, cuidado e observação.
* Não inventar funcionalidades.
* Se uma funcionalidade não estiver clara, escrever “funcionalidade identificada parcialmente no código; validar com equipe”.
* Evitar texto genérico.
* Citar caminhos de arquivos na parte técnica.
* Na parte do usuário final, explicar como se a pessoa nunca tivesse usado o sistema.

Formatação Markdown:

* Usar títulos hierárquicos.
* Usar sumário.
* Usar tabelas.
* Usar listas numeradas para passo a passo.
* Usar blocos destacados:

  * **Atenção**
  * **Exemplo**
  * **Importante**
  * **Resultado esperado**
* Usar diagramas Mermaid em fluxos críticos.
* Evitar linhas enormes.
* Criar um documento limpo e pronto para virar PDF.

Após criar o arquivo:

1. Validar se o Markdown possui sumário.
2. Validar se as duas partes existem.
3. Validar se há seção técnica de endpoints.
4. Validar se há seção de usuário final.
5. Validar se há glossário.
6. Validar se há checklists.
7. Validar se não há placeholders vazios.
8. Validar se o arquivo está salvo em `docs/MANUAL_COMPLETO_SAGRA_WEB.md`.

Ao final, responda:

* arquivo criado;
* tamanho aproximado;
* principais seções incluídas;
* pontos que precisam de validação humana;
* próximos passos para gerar PDF.
