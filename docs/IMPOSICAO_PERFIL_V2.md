# Imposição de papelaria — perfil v2 (0.62.0)

Todos os produtos de papelaria usam o mesmo formulário de imposição, em
**Configurações → Papelaria → Produtos → aba Imposição (produto)**. Não há
regra de produto no código: folha, slots, rotações, marcas, pré-impresso,
juntada e destino do PDF são configurados pelo usuário.

## Na página Papelaria

O botão **Imposição** abre só a pergunta *Offset ou Digital?*. A geração usa
o que está salvo. Se o perfil permite juntada e há OSs compatíveis, aparece
um segundo passo para escolher as OSs que entram na mesma folha.

## Estados de cada variante (Digital / Offset)

| Estado | O que gera |
| --- | --- |
| Não configurado | Nada (a opção aparece desabilitada no diálogo). |
| Fluxo antigo | A configuração antiga (`tabPapelariaProdutoImposicaoConfigs` + override do modelo). |
| Rascunho | Ainda a configuração antiga; o perfil está sendo preparado. |
| Em uso | O perfil v2 (`tabPapelariaImposicaoPerfis`, `AtivoV2 = 1`). |

"Voltar ao fluxo antigo" desliga o perfil na hora, sem apagar nada.

## Como migrar um produto

1. Na aba Imposição, escolha a variante e clique em **Importar da configuração
   atual** (traz só o que está salvo no banco) ou comece em branco.
2. Complete as seções 1–7. Para produtos que o sistema completava na geração
   (pré-impresso), use **Comparar com o fluxo atual**: a tabela mostra as
   posições que o sistema usa hoje; ajuste até ficar *igual* (ou use
   "Aplicar valores do fluxo atual ao rascunho").
3. **Salvar** e **Aprovar e ativar**.
4. Gere uma OS real e confira no Apogee.

## Coordenadas

Na tela: milímetros, origem no **canto inferior esquerdo da folha**, Y para
cima. (x, y) é o **centro da página** no slot (o centro não muda com a
rotação).

Gravado no perfil (JSON/banco): o mesmo centro, mas com Y contado a partir do
topo da folha (`y_gravado = altura_folha − y_tela`). A conversão para a tela
fica só no frontend (`yUsuario` em `perfilUtils.ts`). A conversão para o PDF/JDF
(canto inferior esquerdo da área ocupada) acontece só no backend
(`slots_topo_esquerda` / `compilar_config_jdf`). O preview desenha a partir dos
mesmos dados gravados, então o que se vê é o que vai para o JDF.

## PDF de marcas

O PDF de marcas é **enviado pela tela e guardado no servidor**, em
`storage/papelaria_imposicao_marcas` (pasta persistente entre releases). O
perfil guarda só o nome interno do arquivo (`marcas.arquivo`), que é
deduplicado pelo conteúdo.

Na geração do JDF, esse PDF é copiado para a pasta da OS na rede
(`NNNNN-Nome-Marcas.pdf`, ou `-Marcas-OP.pdf` quando há carimbo de OP), e o
JDF aponta para essa cópia. Assim o Apogee nunca depende do disco do servidor
da API nem de arquivos locais de quem configurou.

Perfis que ainda usam caminho de rede (`marcas.pdf_path`) continuam
funcionando. A tela mostra um aviso com o botão "Copiar este arquivo para o
servidor".

## Banco

As tabelas são criadas automaticamente na primeira leitura. Se o usuário do
banco não tiver permissão de `CREATE`, aplique antes:

```
python deploy/scripts/apply_imposicao_perfis_dev_prod.py
```

DDL em `deploy/sql/create_papelaria_imposicao_perfis.sql`.

## Código

| Arquivo | Papel |
| --- | --- |
| `app/backend/services/papelaria_imposicao_perfil_service.py` | Schema v2, validação, geometria, juntada, compilação para o gerador de JDF, comparação. |
| `app/backend/services/papelaria_imposicao_perfil_store.py` | Persistência dos perfis e modelos de perfil. |
| `app/backend/services/papelaria_imposicao_v2_service.py` | Geração pelo perfil, opções do diálogo, candidatas, ponte com o fluxo antigo (comparação). |
| `app/backend/routers/papelaria_imposicao_routes.py` | Endpoints `/papelaria/admin/imposicao/*` e `/papelaria/os/{ano}/{nro}/imposicao-variantes`. |
| `apps/web/src/features/papelaria/imposicao/perfil/` | Tipos, utilitários, editor, preview, tabela de slots. |
| `apps/web/src/features/configuracoes/components/PerfilImposicaoPanel.tsx` | Aba Imposição do produto. |
| `apps/web/src/features/papelaria/components/PapelariaImposicaoVarianteDialog.tsx` | Diálogo Offset/Digital. |

O teste `test_codigo_generico_nao_cita_produtos` falha se algum nome de
produto aparecer nos arquivos genéricos acima.

## Limpeza futura (F4)

Quando todos os produtos estiverem "Em uso": remover o fluxo antigo
(`placements_*`, constantes de folha/página/centros em
`papelaria_imposicao_juntada_service.py`, `_merge_imposicao_override`,
`PapelariaModeloImposicaoPanel`, `PapelariaImposicaoOsModal`, `ImposicaoConfigEditor`)
e o desvio por `AtivoV2` em `create_imposicao_job`.
