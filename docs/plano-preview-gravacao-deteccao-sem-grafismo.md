Plano de preview e detecção de TIFF sem grafismo — SAGRA Web
==========================================================

Data: 09/09/2026. Escopo: planejamento fundamentado em inspeção do código e medições locais. Nenhuma funcionalidade de produção foi alterada.

**Recomendação:** acrescentar preview ao modal existente e um serviço assíncrono de inspeção de arquivos, com cache, processamento limitado e classificação conservadora. Usar `tifffile` por faixas como referência técnica já medida; comparar `pyvips/libvips` em uma prova de conceito antes de escolher o motor definitivo. Reaproveitar Pillow para operações sobre imagens já reduzidas e o visualizador de PDF existente no fluxo de gravação.

Integridade deve ser um conjunto de critérios verificáveis. Não é possível prometer reconhecimento perfeito de conteúdo arbitrário a partir de uma amostra: marcas técnicas e grafismo legítimo podem ter formas semelhantes. A solução deve reconhecer os perfis homologados, explicar resultados incertos e manter a decisão operacional com o usuário.

**1. Evidências do sistema atual**

| Ponto | Evidência e consequência |
|---|---|
| Modal solicitado | [GravacaoPendenteLaunchModal.tsx](C:/dev/SagraWeb/apps/web/src/features/gravacao-externa/components/GravacaoPendenteLaunchModal.tsx:565) usa `os-gravacao-root`. Tem largura `max-w-2xl`, PDFs/TIFFs por máquina e modos de lançamento e edição. Os itens ainda não selecionam um preview. |
| Seleção anterior ao salvamento | Os arquivos são identificados por `absolute_path` e `nome`; ainda não há ID persistido da sessão. As rotas atuais de preview exigem sessão e ID do arquivo, portanto não atendem diretamente ao novo lançamento. |
| Preview existente | [GravacaoExternaPreview.tsx](C:/dev/SagraWeb/apps/web/src/features/gravacao-externa/components/GravacaoExternaPreview.tsx:70) já exibe PNG em `img` e PDF em `iframe`, com credenciais e descarte de URLs de blob. Está acoplado a IDs de arquivos/sessões. |
| Renderer TIFF | [gravacao_externa_service.py](C:/dev/SagraWeb/app/backend/services/gravacao_externa_service.py:882) usa Pillow, carrega a imagem inteira, reduz para até 2.400 pixels e aplica a cor da separação. |
| Cache | [gravacao_preview_cache_service.py](C:/dev/SagraWeb/app/backend/services/gravacao_preview_cache_service.py:48) usa caminho, nome, tamanho e mtime. Tem gravação via temporário e aquecimento em threads. Não inclui versão do renderer/detector nem coordena todas as solicitações concorrentes do mesmo arquivo. |
| Acesso à rede | [network_files_routes.py](C:/dev/SagraWeb/app/backend/routers/network_files_routes.py:13) verifica permissões de gravação; [file_access.py](C:/dev/SagraWeb/app/backend/security/file_access.py:137) resolve os caminhos dentro das raízes permitidas. Reutilizar essas fronteiras. |
| Dependências | FastAPI/Python, React 19, TanStack Query, Pillow, NumPy, OpenCV e PyMuPDF já fazem parte do projeto. `tifffile`, `imagecodecs` e `pyvips` não constam nos requirements de produção, embora estejam instalados no Python local. |

O preview atual modifica `Image.MAX_IMAGE_PIXELS` globalmente e ativa `ImageFile.LOAD_TRUNCATED_IMAGES`. O detector novo deve trabalhar com leitura estrita e limites próprios em processo isolado. Um preview tolerante a truncamento nunca serve como prova de que um arquivo está sem grafismo.

Há outro detalhe relevante: Pillow usa nearest-neighbor ao redimensionar imagens no modo `1`, mesmo quando o chamador solicita `BOX`. Portanto, o PNG atual pode perder detalhes finos e não deve ser a entrada do detector. Para a nova miniatura, reduzir por área sobre blocos em escala de cinza, antes da coloração. [Documentação do Pillow](https://pillow.readthedocs.io/en/stable/reference/Image.html#PIL.Image.Image.resize).

**2. O que foi medido no exemplo**

Arquivo: [TIFF fornecido](<C:/dev/SagraWeb/docs/2026_OS 00801-PM-Coedi-Livro_Congre (Cad 0 A) (C).tif>).

- 2.013.000 bytes em disco; 49.605 × 43.369 pixels, aproximadamente 2,15 bilhões de pixels.
- Uma página, 1 bit, compressão LZW, `PhotometricInterpretation=0` (MINISWHITE), 2.400 dpi, software Apogee.
- 13 strips, com até 3.380 linhas por strip. Não é diretamente mapeável como array por `memmap`.
- Cobertura total de tinta contada: aproximadamente 0,7747%. A principal faixa superior com tinta fica entre as linhas 15.750 e 16.628, aproximadamente 36–38% da altura. Outras marcas e informações aparecem na parte inferior.
- Consequência: descartar 5% ou 8% das bordas não remove todas as marcas; baixa cobertura global também não demonstra ausência de conteúdo.

Três execuções por modalidade, em subprocessos separados no Windows/Python 3.14.2, arquivo local e sem limpar o cache do sistema operacional:

| Modalidade | Tempo mediano | Maior pico de memória do processo |
|---|---:|---:|
| Reprodução do caminho atual Pillow: leitura, redução, coloração e PNG | 0,83 s | 2.153 MiB |
| Estudo `tifffile.asarray().astype(uint8)` e amostragem central | 1,37 s | 4.148 MiB |
| `tifffile.segments(maxworkers=1)` e contagem integral de tinta por linha | 1,93 s | 227,5 MiB |

Essas modalidades fazem trabalhos diferentes: a terceira conta todos os pixels, mas ainda não gera preview nem reconhece marcas. A tabela demonstra o custo das estratégias de leitura; não mede o desempenho de um detector completo, nem a latência SMB ou da aplicação em produção. Tempos excluem imports. Memória é o pico do processo, incluindo bibliotecas.

O estudo atual classifica corretamente esta amostra, mas sua uniformidade central fica em aproximadamente 99,17%, perto do limiar de 99,05%. Dois contraexemplos sintéticos, calculados com a mesma regra, foram classificados incorretamente como sem grafismo: uma região inteiramente preenchida por tinta e uma linha fina com 0,2% de cobertura que caiu entre as linhas amostradas.

Os arquivos `com_grafismo.txt`, `sem_grafismo.txt` e `erros.txt` são resultados existentes de estudos, não uma base de verdade revisada. Não utilizar seus rótulos como comprovação de acurácia.

Reprodução e dados: [benchmark.py](C:/dev/SagraWeb/estudos/preview_grafismo_20260909/benchmark.py), [benchmark.json](C:/dev/SagraWeb/estudos/preview_grafismo_20260909/benchmark.json). A sonda lê somente o arquivo indicado e grava seu relatório ao lado do script.

**3. Escolha das bibliotecas**

| Alternativa | Avaliação | Decisão proposta |
|---|---|---|
| Pillow integral | Já integrado e rápido nesta amostra, mas chegou a aproximadamente 2,1 GiB por arquivo. A concorrência multiplica esse custo. | Manter como compatibilidade controlada; preferir seu uso depois da redução. Não ampliar o processamento integral em paralelo. |
| `tifffile` + `imagecodecs` + NumPy | Permite inspecionar metadados e iterar strips/tiles. A leitura segmentada reduziu muito a memória no exemplo. Strips maiores podem exigir mais memória; não há limite universal de 227 MiB. | Referência inicial recomendada para o detector. Usar APIs de segmentos, sem carregar/copiar o raster completo e sem criar um decoder LZW próprio. |
| `pyvips` + libvips | Pipeline sob demanda e acesso sequencial são adequados para avaliar preview e análise de imagens grandes. O benefício depende do arquivo, do decoder e das operações usadas. | Concorrente na prova de conceito. Adotar se superar a alternativa segmentada nas métricas completas, com implantação Windows validada. |
| OpenCV/NumPy após redução | Úteis para projeções, componentes conectados e geometria das marcas; já existem no projeto. | Usar apenas sobre mapas pequenos, preservando contagens do original. Sem OCR ou modelo de IA nesta primeira solução. |

O `pyvips` local não importou: `libvips-42.dll` ausente. Nenhuma medição de desempenho dessa biblioteca foi obtida. A distribuição `pyvips[binary]` é uma opção oficial, mas o pacote binário documentado não inclui carregamento de PDF; o preview de PDF deve seguir pelo fluxo já existente. [Instalação pyvips](https://pypi.org/project/pyvips/).

O modo sequencial pode reduzir o volume de imagem residente em RAM, mas não implica que todo TIFF comprimido permita pular a descompressão. Este exemplo é LZW em strips e não possui pirâmide reduzida identificada. Verificar também os limites do decoder libtiff; não habilitar `unlimited` como correção genérica de falhas. [Modelo de leitura libvips](https://www.libvips.org/API/8.16/How-it-opens-files.html), [TIFF loader](https://www.libvips.org/API/current/ctor.Image.tiffload.html).

Fixar versões compatíveis com o Python do servidor e testar codecs reais. Suporte a CCITT em `tifffile` depende da combinação de versões, e não deve ser presumido por experiências com releases antigos. [Projeto tifffile](https://github.com/cgohlke/tifffile).

**4. Comportamento do modal**

1. Ampliar o modal para duas colunas em desktop: formulário/listas à esquerda, preview à direita, com largura máxima inicial de aproximadamente 1.400 px e altura limitada à viewport. Manter cabeçalho e rodapé acessíveis, com rolagens independentes. Em telas pequenas, empilhar o preview abaixo da lista.
2. Clique no nome/área do arquivo seleciona o preview; oferecer ativação por teclado. O botão de remover permanece independente, sem disparar seleção. Separar o estado de visualização dos arquivos incluídos no lançamento.
3. Exibir estado inicial “Selecione um arquivo para visualizar”, nome completo acessível, carregamento, erro e tentativa novamente. TIFF usa PNG reduzido e PDF usa o visualizador do navegador, com navegação entre páginas. Quando o navegador não suportar PDF embutido, oferecer abertura do arquivo autorizado.
4. Usar seleção estável por linha da máquina + caminho normalizado; deduplicar trabalho no backend pelo arquivo real. Não inventar IDs de banco para arquivos ainda não salvos.
5. Troca rápida A→B cancela a requisição de A e impede que sua resposta substitua B. Limpar a seleção ao remover o arquivo/máquina, trocar de OS ou fechar o modal; revogar URLs de blob e parar polling.
6. Inspecionar todos os TIFFs incluídos no modal, inclusive os hidratados na edição, independentemente do arquivo aberto no preview. PDFs recebem preview, mas ficam fora da classificação de grafismo.
7. Exibir aviso agregado acima das listas de máquinas: “Existem N TIFFs sem grafismo detectado. Revise os arquivos destacados.” A borda vermelha deve permanecer mesmo quando o item está selecionado; usar fundo ou indicador separado para a seleção. Acrescentar ícone/texto “Sem grafismo detectado”, sem depender somente de cor.
8. Exibir progresso discreto, por exemplo “Verificando TIFFs: 8 de 24”, e distinguir “Verificação inconclusiva” e “Falha na verificação”. O estado pendente não pode parecer um resultado aprovado.
9. O aviso é informativo: não remove arquivos, não desmarca separações, não altera quantidade de chapas e não bloqueia o salvamento. Preservar validações existentes de máquina, PDF-only, grupos/lâminas, espelhos e OSs juntadas.

O escopo principal é a lista do próprio `os-gravacao-root`. Não varrer todas as pastas do navegador de rede. Acrescentar preview também ao modal de navegação pode ser uma extensão posterior, reaproveitando o mesmo serviço.

**5. Detector: separação entre tinta e marcas técnicas**

**Passo A — identificar e validar.** Ler metadados antes dos pixels: dimensões, páginas, bits, canais, compressão, orientação, strips/tiles, dpi e origem RIP. Conferir estimativa de memória por segmento antes de decodificar. No início, homologar o perfil de TIFF 1-bit Apogee do exemplo. TIFFs coloridos, layouts desconhecidos e codecs não suportados continuam com preview quando possível, mas a análise retorna inconclusiva/indisponível, nunca “sem grafismo”.

**Passo B — normalizar a tinta.** Interpretar explicitamente a fotometria: MINISWHITE=0 e MINISBLACK=1; no exemplo bruto 1-bit, valor 1 representa tinta. Não deduzir branco pela cor majoritária nem por `max(media, 1-media)`: uma área totalmente preta tem grafismo. Tratar orientação e coordenadas das máscaras de maneira consistente.

**Passo C — produzir evidência preservando detalhes.** Percorrer segmentos com memória limitada e acumular contagens de tinta em uma grade de coordenadas globais, projeções e presença de tinta por bloco. Somar todos os pixels, inclusive blocos parciais e fronteiras entre strips. Gerar preview reduzido por média de área e mapa de análise com contagens/presença, como produtos distintos da mesma leitura quando viável. Não usar amostragem com passo fixo para declarar ausência; traços e retículas podem cair entre as amostras. Evitar binarizar uma miniatura média de forma que tinta esparsa desapareça.

**Passo D — identificar marcas homologadas.** Criar perfis versionados por origem RIP, formato/dpi, orientação e máquina quando confiável. Cada perfil descreve regiões técnicas e geometria esperada das barras, registros e informações de identificação. Usar alinhamento das marcas e componentes conectados como apoio, com tolerância calibrada. As máscaras devem ser estreitas e auditáveis: não apagar toda uma faixa horizontal só porque contém uma barra, nem excluir margens fixas onde pode existir conteúdo legítimo. Inspecionar visualmente uma sobreposição das máscaras durante a homologação.

As posições do exemplo são evidência para o primeiro perfil, não coordenadas universais a fixar para qualquer chapa. Onde metadados confiáveis de imposição estiverem disponíveis, avaliar seu uso para delimitar área útil; não pressupor que os XMLs atuais forneçam essa geometria.

**Passo E — decidir de forma conservadora.**

- `com_grafismo`: evidência suficiente de tinta fora das marcas homologadas. É possível encerrar cedo a classificação; continuar apenas o trabalho necessário ao preview solicitado.
- `sem_grafismo`: perfil reconhecido, leitura completa e válida, todas as áreas relevantes verificadas e somente tinta explicada pelas marcas técnicas, dentro das tolerâncias homologadas.
- `inconclusivo`: pouco conteúdo, marcas/layout desconhecidos, correspondência ambígua ou ausência de certeza sobre uma região. Não assumir que uma linha estreita é uma marca.
- `erro`: arquivo corrompido, codec indisponível, timeout, acesso negado, limite excedido ou alteração durante a leitura. Guardar motivo técnico e apresentar texto compreensível.

Quando a máscara for inferida a partir do mapa reduzido e a resolução não bastar para confirmar os pixels em sua borda, refinar a região nos segmentos originais. Essa leitura adicional é permitida apenas nos candidatos ambíguos; medir seu custo. Sem confirmação, manter inconclusivo. Para TIFF 1-bit digital, começar conservadoramente com ausência de tinta não explicada; só aceitar ruído não nulo após calibrar em amostras reais.

Para TIFF multipágina, guardar resultado por página. O arquivo inteiro só é `sem_grafismo` se todas as páginas válidas analisadas forem sem grafismo. Arquivo misto deve informar as páginas suspeitas, sem afirmar que o documento inteiro está vazio. Não analisar apenas a primeira página silenciosamente.

O PDF espelho pode ajudar a conferência humana, mas não prova que cada separação CMYK contém tinta: um canal pode legitimamente estar vazio.

**6. Processamento, API e cache**

Fluxo: inclusão de TIFFs → registro do lote → validação e fila → leitura segmentada → resultado/cache → atualização das bordas e aviso. Clique em arquivo → prioridade para seu preview → apresentação à direita.

Contratos propostos, sem exigir uma sessão de gravação salva:

| Operação | Contrato |
|---|---|
| `POST /files/network-inspections` | Recebe lote limitado de arquivos e seleção prioritária opcional. Autentica e valida estrutura/raízes; devolve `202`, ID opaco da inspeção e estados disponíveis, sem esperar a descompressão. Validações SMB potencialmente lentas ficam no processamento de background. |
| `GET /files/network-inspections/{id}` | Retorna snapshot incremental por arquivo: chave, revisão/fingerprint quando conhecido, estado do preview, estado da análise, motivo, páginas e versão do detector/perfil. Não executa leitura integral no polling. |
| `GET /files/network-inspections/{id}/files/{key}/preview` | Entrega apenas o PDF ou PNG autorizado e pronto. Preview ainda em fila é informado no snapshot, não enviado como JSON para uma tag de imagem. Permite priorizar o arquivo selecionado em nova solicitação idempotente. |

Separar progresso (`queued`, `running`, `done`, `failed`) da classificação e do estado do preview. Um PNG pronto não implica detecção pronta; falha na análise não deve inutilizar automaticamente um PDF/preview válido. IDs de inspeção são temporários e vinculados ao acesso do solicitante; expirados devem produzir resposta recuperável pela UI.

Implementar serviço de coordenação pequeno, iniciado/encerrado pelo lifespan da API, e worker de imagem isolado em processo. Começar com um processo de imagem e fila limitada, por exemplo 100 arquivos por lote; definir também limite global de fila e tratar sobrecarga explicitamente. Não usar uma thread ilimitada por lote nem multiplicar quatro arquivos por várias threads internas do codec. Ajustar concorrência apenas depois de medir CPU, RAM e SMB. Se houver vários processos da API, a coordenação e o limite precisam abranger todos eles; confirmar a topologia de produção antes de escolher coordenação em memória.

Timeout de requisição não encerra processamento nativo. O supervisor precisa impor prazo real ao processo, encerrá-lo quando necessário e recuperar a capacidade do worker. O mesmo vale para arquivo preso em leitura de rede. Ao fechar o modal, cancelar interesse e polling; cancelar trabalhos pendentes sem consumidores, mantendo no máximo o trabalho já iniciado que ainda seja útil a outros consumidores.

Priorizar preview do arquivo selecionado e inspeções da sessão aberta. Integrar o aquecimento atual à mesma coordenação/limites para que não concorra sem controle. Não antecipar previews de todas as OSs como efeito de abrir este modal, nem gerar compostos CMYK para atender ao pedido de preview individual.

Reaproveitar a estrutura do cache existente, com estas extensões:

- Fingerprint por caminho canônico UNC, tamanho, `mtime_ns`, página e parâmetros do renderer. Análise inclui versão do algoritmo e do perfil; cor de apresentação e resolução pertencem à chave do preview.
- Um trabalho ativo por fingerprint; consumidores compartilham o resultado. Coordenar processos diferentes quando a implantação os utilizar.
- Temporários com nomes únicos por tentativa e publicação atômica. O atual sufixo `.tmp` fixo não é suficiente para escritores simultâneos.
- Conferir identidade/metadados antes e depois da leitura. Arquivo alterado não publica resultado; reagendar depois de estabilizar. Se o produtor puder substituir conteúdo preservando tamanho/data, exigir hash do conteúdo ou uma revisão confiável do produtor para a invalidação; `stat` sozinho não garante detectar esse caso.
- Cache é derivado e reconstruível. JSONs guardam motivo, contagens, perfil e revisão; originais permanecem somente leitura. Arquivo ausente/inacessível não pode continuar exibindo resultado antigo como atual.
- Limites de espaço, idade e coleta de órfãos; erros transitórios com expiração curta; nunca converter erro em ausência de grafismo. Local persistente configurável via padrão existente `SAGRA_GRAVACAO_PREVIEW_DIR`, validado no deploy Windows.
- HTTP cache privado com revisão/ETag coerente. Resposta `304` só após validação de acesso. Evitar cache público ou permanência indevida no service worker.

No frontend, usar TanStack Query para lote/status, chaves estáveis, polling apenas enquanto houver pendências e modal visível, inicialmente em torno de 1 s com recuo em espera prolongada. Mudanças de seleção não devem reiniciar todas as análises. `AbortController` e geração/revisão da seleção protegem contra respostas atrasadas.

**7. Segurança e preservação dos fluxos**

- Reutilizar permissões de gravação e resolução de caminhos de rede; aplicar checagem também no acesso a resultados/cache, não apenas na criação do lote. Não criar endpoint genérico que leia qualquer caminho do servidor.
- Revalidar o caminho no worker e no acesso ao original; verificar extensão real e assinatura do arquivo. Nome fornecido pelo cliente não define o tipo nem autoriza acesso. Testar UNC, unidades mapeadas, caminhos fora da raiz e junctions/reparse points que escapem da área permitida.
- Não gravar nos TIFFs/PDFs nem mover, renomear ou apagar originais. Não alterar tabelas de andamento, chapas, arquivos, pagamentos ou juntadas para armazenar essa análise derivada.
- Manter `onConfirm` e o contrato de salvamento existentes. Preview/inspeção não lança OS, envia e-mail, altera contagem ou remove canal vazio automaticamente.
- Não transmitir os documentos para serviços externos. Logs com ID/código de erro e métricas; evitar caminhos completos e conteúdo dos arquivos quando desnecessários.
- Preservar endpoints de previews de sessões existentes; mudanças compartilhadas precisam de testes de regressão para gravação pendente, externa e composto CMYK.

**8. Sequência de implementação com condições de saída**

| Etapa | Entrega | Condição para avançar |
|---|---|---|
| 1. Corpus e prova de conceito | Revisar exemplos com/sem grafismo por máquina/RIP; comparar leitura segmentada e pyvips em ambiente isolado Windows; medir preview + detecção completos. | Motor escolhido por tempo, pico de memória, qualidade da redução, codecs e viabilidade de deploy. Registrar versões e formatos não suportados. |
| 2. Serviço e cache | Coordenação com limite, isolamento, leitura estrita, resultados versionados e invalidação; testes de concorrência/falhas. | Nenhum resultado parcial publicado; uma leitura por trabalho compartilhado; limites efetivos; originais intactos. |
| 3. Preview pré-salvamento | API autenticada para arquivos da rede e painel visual desacoplado de IDs persistidos. | TIFF/PDF funcionam antes do lançamento e na edição; A→B e remoção/fechamento não exibem arquivo errado. |
| 4. Detector e calibração | Perfis de marcas, mapa de evidência e classificação com motivos; executar primeiro sem alertas operacionais. | Exemplo fornecido detectado; corpus de validação separado dos exemplos de calibração sem falsos positivos críticos; casos não homologados explícitos. |
| 5. Integração visual | Bordas vermelhas, aviso agregado, estados de progresso/erro e atualização ao remover/adicionar arquivos. | Todos os TIFFs incluídos são verificados; seleção e remoção continuam corretas; regras de lançamento intactas. |
| 6. Homologação e ativação | Ensaios na rede real, múltiplos usuários, deploy Windows e rollback por flags. | Orçamento de desempenho cumprido e operadores confirmam os resultados. Ativar por grupo e acompanhar. |

Preview pode ser entregue e habilitado independentemente da detecção. A escolha final entre os motores não deve atrasar o trabalho de layout, contrato e proteção contra respostas atrasadas.

Arquivos a modificar: o modal; extração do núcleo visual de `GravacaoExternaPreview.tsx`; `apps/web/src/api/networkFiles.ts`; router/serviço de rede; cache/renderer de gravação; configuração de lifespan e requirements conforme o motor escolhido. Criar um serviço específico de inspeção/detecção e hook correspondente, sem aumentar ainda mais o modal com lógica de classificação.

**9. Validação e critérios de aceite**

| Área | Casos obrigatórios |
|---|---|
| Detecção | TIFF fornecido; branco puro; marcas sem conteúdo em mais de um layout; conteúdo mínimo/linha fina; texto isolado e próximo às bordas; retícula; página totalmente preenchida; barra ao lado de conteúdo; C/M/Y/K e Pantone; fotometria invertida; rotação; layouts não homologados. |
| Formato e robustez | LZW, PackBits, Deflate e CCITT quando suportados; BigTIFF/tiles/strips; TIFF multipágina; segmentos grandes; arquivo truncado, inexistente, em gravação, codec ausente e estouro de prazo/memória. |
| Cache | Acerto sem decodificação; mudança de arquivo/perfil/renderer; dois usuários simultâneos; erro de escrita; arquivo substituído com metadados preservados; reinício da API; cache sem autorização; limpeza concorrente. |
| UI | Preview antes de salvar e na edição; selecionar TIFF/PDF; PDF multipágina; A→B com A lento; remover arquivo/máquina; fechar/reabrir/trocar OS; falhas parciais; aviso e bordas corretos; teclado e viewport estreita. |
| Regressão | PDF-only e quantidade manual; quantidade automática por TIFF; validação espelhos×lâminas; juntadas; confirmação/cancelamento; previews pendente/externa e composto. |
| Integridade | Hash dos originais igual antes/depois dos ensaios; nenhuma escrita de negócio causada pela inspeção; nenhuma classificação incorreta de erro como arquivo vazio. |

Executar pytest nos serviços de rede, previews/cache, novo detector/API e rotas de gravação afetadas. Executar Vitest/Testing Library no modal, hook, visualizador e utilitários afetados; `pnpm --filter @sagra/web typecheck` e build da SPA. Incluir ensaio real de navegador: jsdom não valida renderização do PDF nem comportamento visual do layout.

Acurácia: separar calibração e validação por job/layout, evitando que canais quase idênticos do mesmo job apareçam nos dois conjuntos. Publicar matriz de confusão, falsos positivos, falsos negativos e proporção de inconclusivos. Zero falsos positivos críticos no corpus de homologação é condição de ativação; não é promessa de acerto universal. Também exigir cobertura útil dos perfis homologados: classificar tudo como inconclusivo não atende ao objetivo.

Metas iniciais de desempenho, a confirmar no servidor e na rede reais, não resultados já alcançados:

- Modal interativo sem esperar qualquer TIFF; feedback de seleção no próximo ciclo de renderização.
- Preview já pronto em cache: p95 de até 300 ms na intranet de homologação, incluindo requisição e exibição.
- Para o exemplo em disco local, buscar inspeção completa + preview em até 3 s e até 512 MiB por processo de imagem. Se o reconhecimento/refino aumentar esse custo, apresentar medição e ajustar motor/algoritmo antes da ativação.
- Ensaiar lotes de 1, 20 e 100 arquivos, com cache frio/quente da aplicação e vários usuários. Medir p50/p95 de fila, leitura, decodificação, análise e preview, pico agregado de RAM e throughput SMB. Não chamar cache frio da aplicação de cache frio do sistema operacional.
- Não aumentar a concorrência sem manter o limite global de memória e sem evidenciar ganho. Comparar latência dos endpoints normais com/sem inspeção; meta inicial de regressão p95 menor que 10% sob a mesma carga.
- A medição por strips atual já custa cerca de 1,93 s por arquivo desta amostra. Cache vazio com 100 semelhantes pode levar minutos em série: progresso incremental, priorização e reaproveitamento são necessários; não prometer resultado instantâneo para o lote inteiro.

**10. Implantação e retorno seguro**

Flags separadas para preview novo e detector. Homologar dependências no Python real de produção, incluindo libvips/DLLs caso escolhido, permissões de rede da conta do serviço, diretório persistente de cache e encerramento de processos no Windows.

Ativar primeiro preview, depois detector para perfis revisados. Observar duração, espera em fila, RAM, taxa de cache, erros, inconclusivos e divergências reportadas pelos operadores. Se houver regressão, desativar a flag correspondente e retornar ao comportamento anterior. Como a análise é derivada e não muda dados de negócio, o rollback não exige migração reversa de banco.

**Resultado esperado:** o usuário seleciona um PDF/TIFF e vê o arquivo à direita; a análise dos TIFFs incluídos ocorre em background com limites; arquivos reconhecidos como sem grafismo recebem borda vermelha e aviso no topo. A implementação só é considerada concluída quando isso funciona nos modos de lançamento/edição, preserva os fluxos atuais e cumpre os critérios de integridade, classificação e desempenho acima.
