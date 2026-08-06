PROMPT 3 — GERAR PDF PROFISSIONAL A PARTIR DO MANUAL MARKDOWN

Você é um especialista em documentação profissional, diagramação técnica, Markdown, PDF, CSS para impressão, Pandoc/Playwright/HTML print e criação de manuais corporativos.

Objetivo:
Transformar o arquivo:

`docs/MANUAL_COMPLETO_SAGRA_WEB.md`

em um PDF profissional, bem diagramado, com aparência institucional, estrutura clara, sumário, paginação, cabeçalhos, rodapés e formatação adequada para leitura técnica e operacional.

Arquivo final obrigatório:
Criar:

`docs/MANUAL_COMPLETO_SAGRA_WEB.pdf`

Regras críticas:

* NÃO alterar código do sistema.
* NÃO alterar frontend.
* NÃO alterar backend.
* NÃO alterar banco.
* NÃO alterar `.env`.
* NÃO reiniciar servidor.
* NÃO publicar em produção.
* Apenas gerar arquivos de documentação.
* Se precisar criar HTML/CSS intermediário, salvar em `docs/manual_pdf_assets/`.
* Não remover o Markdown original.

Antes de gerar o PDF:

1. Ler integralmente `docs/MANUAL_COMPLETO_SAGRA_WEB.md`.
2. Verificar se o arquivo existe.
3. Verificar se possui:

   * capa;
   * sumário;
   * Parte 1 técnica;
   * Parte 2 usuário final;
   * endpoints;
   * fluxos;
   * glossário;
   * checklists.
4. Se houver placeholders vazios ou seções incompletas, criar relatório de pendências antes de gerar o PDF.
5. Se estiver completo, seguir com a geração.

Padrão visual desejado:

* Manual corporativo profissional.
* Visual limpo, institucional e moderno.
* Títulos bem hierarquizados.
* Margens confortáveis.
* Fonte legível.
* Tabelas bem formatadas.
* Código com fundo diferenciado.
* Blocos de atenção destacados.
* Quebras de página adequadas.
* Sumário no início.
* Cabeçalho com nome do sistema.
* Rodapé com número da página.
* Capa profissional.
* Separadores claros entre Parte 1 e Parte 2.
* Diagramas Mermaid renderizados, se possível.
* Links internos funcionando, se possível.
* Links externos preservados, se existirem.

Estrutura visual obrigatória:

1. Capa.
2. Página de informações do documento.
3. Sumário.
4. Introdução.
5. Parte 1 — Manual Técnico.
6. Parte 2 — Manual do Usuário Final.
7. Glossário.
8. Checklists.
9. Apêndices.
10. Histórico de versão.

Configuração de página:

* Formato A4.
* Orientação retrato.
* Margens equilibradas.
* Numeração de páginas.
* Cabeçalho discreto.
* Rodapé discreto.
* Tabelas não devem estourar a largura da página.
* Blocos de código devem quebrar linha ou ter tamanho ajustado.
* Evitar títulos órfãos no fim da página.
* Evitar quebras ruins em tabelas grandes.

Ferramenta:
Use a melhor ferramenta disponível no ambiente do projeto.

Preferência:

1. Pandoc, se disponível.
2. Markdown → HTML profissional → PDF via Playwright/Chromium, se disponível.
3. Script Node/Python local, se for mais adequado.
4. Outra ferramenta instalada, desde que gere PDF profissional.

Se usar HTML intermediário:
Criar:

* `docs/manual_pdf_assets/manual.html`
* `docs/manual_pdf_assets/manual.css`

O CSS deve conter:

* estilos de capa;
* estilos de títulos;
* estilos de tabelas;
* estilos de código;
* estilos de blocos de atenção;
* estilos de quebra de página;
* estilos para impressão;
* cabeçalho/rodapé, se viável.

Validações obrigatórias após gerar PDF:

1. Confirmar que `docs/MANUAL_COMPLETO_SAGRA_WEB.pdf` existe.
2. Confirmar que o PDF não está vazio.
3. Confirmar número aproximado de páginas.
4. Confirmar que a capa aparece.
5. Confirmar que o sumário aparece.
6. Confirmar que a Parte 1 aparece.
7. Confirmar que a Parte 2 aparece.
8. Confirmar que tabelas principais aparecem sem estouro evidente.
9. Confirmar que blocos de código estão legíveis.
10. Confirmar que diagramas Mermaid foram renderizados ou, se não foram, documentar a limitação.
11. Confirmar que o arquivo Markdown original continua preservado.

Criar também um relatório:
`docs/RELATORIO_GERACAO_PDF_MANUAL_SAGRA_WEB.md`

Esse relatório deve conter:

* data/hora;
* arquivo Markdown de origem;
* arquivo PDF gerado;
* ferramenta usada;
* arquivos intermediários criados;
* número aproximado de páginas;
* validações realizadas;
* limitações encontradas;
* recomendações de revisão humana.

Checklist final:

* Markdown completo existe.
* PDF profissional gerado.
* PDF abre corretamente.
* PDF possui capa.
* PDF possui sumário.
* PDF possui Parte Técnica.
* PDF possui Parte do Usuário Final.
* PDF possui glossário.
* PDF possui checklists.
* Relatório de geração criado.
* Nenhum código do sistema foi alterado.
* Nenhum servidor foi iniciado ou reiniciado.

Ao final, responda:

* PDF gerado;
* caminho do PDF;
* relatório criado;
* ferramenta usada;
* eventuais limitações;
* próximos passos recomendados.
