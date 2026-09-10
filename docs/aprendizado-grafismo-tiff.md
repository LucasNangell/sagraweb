# Aprendizado da detecção de grafismo em TIFF

## Uso

Selecione a máquina e um TIFF no modal de gravação. O rodapé direito do preview
mostra a máquina, a separação e a classificação atual. O botão oferece a correção:
`Possui grafismo` quando o sistema indica ausência, ou `Não possui grafismo` quando
indica presença. A borda e o aviso da lista mudam após a confirmação do servidor.
A correção é salva imediatamente, mesmo se o lançamento da OS for cancelado depois.
PDFs não participam do aprendizado.

## Modelo e treinamento

O algoritmo é **k-NN supervisionado com rejeição por distância**. Os exemplos
rotulados constituem o modelo: cada correção atualiza o conjunto de treino sem
um job pesado de retreinamento. Implementação NumPy, já disponível no sistema;
não requer scikit-learn, pyvips, GPU ou serviço externo.
Referência do método: [aprendizado supervisionado por vizinhos](https://scikit-learn.org/stable/modules/neighbors.html).

As características são extraídas dos pixels em uma única decodificação por strips:
proporção da chapa, cobertura de tinta, proporção de linhas ativas e raiz da
densidade em uma grade 16×16. São 259 valores com versão `plate-grid-v2`.
A inspeção respeita a fotometria MINISWHITE/MINISBLACK. TIFFs não suportados,
multipágina, tiles ou strips que excedem os limites ficam inconclusivos.

Uma correção tem prioridade para o mesmo conteúdo SHA-256, máquina, cor e versão
das características, mesmo se o arquivo mudar de pasta. A cor é extraída no
servidor usando o parser existente de CMYK/Pantone e o nome real do arquivo.
A máquina vem da linha selecionada. Alterar a máquina dispara outra inspeção.
Cor desconhecida é registrada, mas não usada para generalizar a outros arquivos.

Para classificar arquivos novos, o sistema consulta até 1.000 exemplos recentes
da **mesma máquina e cor**. Exige ao menos três exemplos de cada classe e três
vizinhos concordantes; rejeita candidatos distantes ou próximos de exemplos da
classe oposta. Distância máxima 0,025; a classe oposta deve ficar além de
`max(0,01; 1,5 × distância do terceiro vizinho)`. A distância inclui diferenças
globais e a maior diferença local para não diluir conteúdo pequeno na média.
Se as condições não forem atendidas, permanece a análise de imagem.
Esses limites são conservadores iniciais, não uma acurácia estatística comprovada.

Somente decisões humanas entram no treino. Repetir a mesma correção não adiciona
votos; corrigir novamente substitui o rótulo da amostra e preserva o histórico.
Com apenas exemplos sem grafismo, a correção exata já funciona, mas a generalização
aguarda exemplos com grafismo. Os quatro arquivos locais de `docs` são regressões
confirmadas pelo usuário, não um conjunto suficiente para medir acurácia de ML.
Não foi inferida uma máquina para importá-los como amostras de treinamento.

## Persistência, acesso e implantação

### Pacote Windows e dependências TIFF

`deploy-release-dev.bat` chama `deploy/scripts/deploy-release-dev.ps1`, que gera
o pacote por `package-release.ps1` e o copia para a pasta de releases. A publicação
no servidor é outra etapa, executada por `publicar-release.bat`.

Foi corrigida uma lacuna: o pacote embutia OCR/Pillow, mas apenas copiava o
`requirements.txt` com tifffile/imagecodecs; publicar não instalava essas bibliotecas.
Em uma instalação sem imagecodecs, a análise dos TIFFs comprimidos falhava. A mensagem
genérica “Não foi possível inspecionar o TIFF” sozinha não confirma essa causa;
erros específicos continuam registrados no log da API.

Agora `requirements-tiff.txt` fixa tifffile 2024.8.30 e imagecodecs 2024.6.1 no
`python_pkgs` e em `wheels`, para Python 3.10 x64 (alvo padrão de produção).
O NumPy da API não é substituído: ele deve ser >=1.24 e é testado no preflight.
Isso evita sobrepor a versão compartilhada por OpenCV/pandas/ONNX. A versão de
[imagecodecs escolhida suporta NumPy 1 e 2](https://pypi.org/project/imagecodecs/2024.6.1/).
Se mudar o alvo Python para uma versão sem esses wheels, o build falha e as versões
fixadas devem ser revistas e testadas para o novo ambiente.

O build valida a presença dos módulos e o binário `_imcd` com ABI correto. Mesmo
com `-SkipBuild`, o envio rejeita pacote antigo sem o validador. No servidor,
`publicar-release-prod.ps1` executa `check_tiff_runtime.py` usando o mesmo `python`
do PATH e os caminhos de bibliotecas da API. Verifica arquitetura/versão, imports,
DLLs, round-trip LZW e equivalência do extrator em TIFF 1-bit. Falha nessa etapa
interrompe a publicação **antes de parar a API e alterar current**.

Para aplicar esta correção, execute `deploy-release-dev.bat` **sem `-SkipBuild`**
e publique a nova release pelo comando indicado ao final. Não reutilize o pacote
antigo de `deploy/release`. Para diagnóstico local no servidor, sem publicar:

```powershell
python .\current\check_tiff_runtime.py --release-root .\current
```

Esse teste não acessa a rede, o banco nem os TIFFs do usuário: cria o TIFF de teste
em memória. Permissões de leitura dos arquivos de rede ainda dependem da conta
que executa a API. Configuração e rótulos persistentes continuam em seus locais
existentes; não é necessário instalar pyvips para essa implementação.

Validação adicional: preflight e os quatro TIFFs reais passaram em Python 3.10.11
x64 portátil, NumPy 1.26.4, tifffile 2024.8.30 e imagecodecs 2024.6.1. Os quatro
foram classificados como sem grafismo, em 1,14–1,17 s cada no ambiente local.
Não foi executada uma publicação no servidor durante essa validação.

### Dados do aprendizado

- `tab_tif_graphics_sample`: conteúdo, características, máquina, cor, rótulo,
  nome do arquivo, usuário, revisão e data.
- `tab_tif_graphics_feedback`: histórico das decisões e classificação anterior.
- Transação única para amostra e histórico; revisão otimista detecta correções
  conflitantes. O token da inspeção detecta alteração do arquivo antes de salvar.
- A rota `POST /files/network-graphics-feedback` exige sessão e permissão de
  gravação, valida a raiz de rede e extrai as características no servidor.
  Não aceita características, cor nem usuário fornecidos pelo cliente.

O startup da API cria as tabelas de forma aditiva e idempotente. Para ambientes
em que DDL é aplicado separadamente, executar
`deploy/sql/20260909_tif_graphics_learning.sql` antes de reiniciar a API.
Não há migração ou dual-write para Access: estes são dados auxiliares do SAGRA Web.
Inclua as duas tabelas no backup normal do MySQL.

Recuperação: a versão anterior pode continuar usando o banco com as tabelas novas.
Ao reverter o código, preserve as tabelas para não perder os rótulos e o histórico.
Se o banco de aprendizado estiver indisponível, a análise de imagem continua;
uma tentativa de salvar correção apresenta erro e não simula sucesso.

## Desempenho e validação

A análise de TIFFs de 1 bit, sem compressão ou com LZW, FillOrder=1 e Predictor=1,
conta diretamente os bits dos strips, sem expandir cada pixel em um byte.
Não há redução de resolução: as características e a classificação são exatamente
as mesmas do decodificador anterior. Outros formatos suportados usam o caminho
tifffile existente. A versão `plate-grid-v2` e os exemplos treinados são preservados.

Há no máximo duas análises simultâneas por processo, e apenas uma delas pode usar
o decodificador expandido. Strips acima de 256 milhões de pixels ficam inconclusivos.
O cache em memória guarda até 512 resultados; o SQLite local guarda até 10.000,
com validade de 30 dias. A chave considera caminho, tamanho, mtime e versão.
O arquivo é conferido novamente após a análise para rejeitar resultados obsoletos.
Nenhum bitmap completo ou decisão de aprendizado por máquina fica nesses caches.
Solicitações simultâneas para o mesmo arquivo compartilham a análise.

O cache persistente fica em `data/tif_graphics_cache/features.sqlite3`. O diretório
pode ser definido por `SAGRA_TIF_INSPECTION_CACHE_DIR` e precisa permitir escrita
pelo usuário da API. Em implantação com pastas de releases, prefira um diretório
persistente fora delas. O cache é reconstruível e não substitui o backup das tabelas
de aprendizado. Falha de acesso ou corrupção do SQLite não impede a análise.

No modal, cada arquivo/máquina tem sua própria consulta, com no máximo duas
requisições de inspeção ativas. Os resultados aparecem progressivamente. Excluir
um item cancela apenas sua inspeção, se ainda pendente; os demais não reiniciam.
Adicionar um arquivo verifica apenas esse arquivo. Trocar a máquina cria outro
contexto de classificação. Corrigir manualmente um resultado não reinicia a fila.
Ao fechar, os envios pendentes são cancelados; análises já iniciadas no servidor
podem terminar. Não há job de longa duração criado em segundo plano.

O limite da API continua sendo 50 arquivos por requisição; a seleção de 300
é atendida por requisições curtas de um arquivo. Arquivo inacessível recebe o
sinalizador `Não verificado`, sem interromper os outros. Falha de rede interrompe
novos envios; `Tentar novamente` repete apenas as verificações que falharam.
O cache do navegador é por arquivo/máquina, com frescor de 60 segundos;
editar a seleção não refaz consultas dos observadores que permaneceram montados.

O modal mantém altura `min(94vh, 860px)`, com avisos compactos ao lado do título
em uma área de 40 px e lista de PDFs com 40 px e rolagem interna, evitando espaços
vazios grandes. A lista TIFF tem 176 px para exibir quatro itens,
inclusive preservando o espaço quando vazia. As observações permanecem após as
listas no modo de lançamento. O resumo dos PDFs ocupa somente seu conteúdo,
ao lado de “+ Máquina”; foram removidos os 112 px vazios abaixo das máquinas.
Sem resumo, há 12 px entre o cartão e o botão e 16 px até as observações.
A inferência compara vetores, sem reabrir TIFFs.
O cache de exemplos tem 16 entradas, duração de até dez segundos e invalidação
local imediata após uma correção. Outros processos recebem o novo conjunto em
até dez segundos. Correções exatas são lidas diretamente do banco.

Medição local em 09/09/2026 nos quatro TIFFs de 49.605×43.369 pixels:

| Operação | Tempo medido |
| --- | --- |
| Análise completa anterior | 1,959–2,357 s/arquivo |
| Análise completa com bits compactados | 0,795–0,808 s/arquivo |
| Oito análises completas novas, sequenciais | 6,376 s |
| Oito análises completas novas, duas simultâneas | 3,353 s |
| Leitura de 300 entradas distintas do cache SQLite | 1,032 s |

As oito análises usam os quatro arquivos reais repetidos duas vezes, sem cache de
resultados. O teste das 300 entradas usa características sintéticas persistidas,
não 300 TIFFs reais inéditos. Os números excluem latência da rede/MySQL, chamadas
HTTP e geração de preview; não representam o tempo integral de uma OS em produção.

Também foi medida a instalação funcional de pyvips 3.2.0 / libvips 8.18.6:
leitura sequencial com `avg()`, somente para cobertura de tinta, levou 1,392–1,467 s
por arquivo. Como a análise completa dos bits compactados levou cerca de 0,8 s,
esse caminho foi mantido. A comparação é específica destes TIFFs, não uma avaliação
universal das bibliotecas. pyvips não foi adicionado como dependência do sistema.
NumPy 2 usa `bitwise_count`; NumPy 1 tem alternativa por tabela de contagem de bits.
Uma medição adicional, com 1.000 exemplos sintéticos e cinco inferências,
resultou em aproximadamente 29 ms por classificação, incluindo leitura dos
vetores JSON. Em falha de conexão, a consulta de correções aguarda dez segundos
antes de tentar novamente, evitando repetir o timeout para cada TIFF do lote.

O erro dos lados B era causado pelo bounding box que unia duas marcas laterais
(x=2645–3245 e x=46360–46960) como se houvesse tinta entre elas. A nova regra
verifica a ausência de tinta no interior, além da altura e posição das marcas.
Os quatro TIFFs agora são classificados como sem grafismo. Um teste sintético
adiciona tinta central à mesma faixa e exige classificação com grafismo.

Os testes cobrem aprendizado de arquivo novo, isolamento por máquina/cor,
classes insuficientes, conflito, persistência, rollback, reenvio, acesso,
alteração do arquivo, erro de gravação e comportamento do botão. A persistência
é testada com SQLite em memória e tradução do dialeto; isso não substitui uma
validação de implantação em MySQL. Antes de ampliar os limites de generalização,
validar um conjunto independente com grafismo pequeno, várias máquinas e cores,
sem colocar separações da mesma chapa simultaneamente em treino e validação.

Validação desta implementação: 60 testes de backend (detecção, aprendizado,
cache persistente, equivalência de características e preview composto) e 30 testes
de frontend passaram. Há regressões para remoção de itens concluídos, ativos e
pendentes em lote de 300, cancelamento, inclusão incremental, troca de máquina,
falha de rede e correção durante a fila. Nos quatro TIFFs reais e em casos sintéticos
com ambas as fotometrias e limites de bytes/strips, o caminho novo é idêntico ao antigo.
No navegador, com dados simulados, o lote chegou a 300 requisições sem repetição,
com no máximo duas simultâneas, mesmo com correção e exclusão durante o processamento.
O modal manteve 676,8 px e a lista TIFF 176 px, inclusive após esvaziá-la.
O typecheck do conjunto de arquivos TypeScript apresentou 667 diagnósticos fora
dos arquivos alterados e zero nesses arquivos; portanto não se declara o
typecheck global aprovado. Os testes de backend que criam TIFFs temporários
precisaram executar fora do sandbox devido às permissões de arquivos do Windows.
