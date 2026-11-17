# Inventário de `window.alert` — SAGRA Web

Total ativos: **245** | Comentados (já inativos): **2**

Escopo: `apps/web/src` (código-fonte do frontend ativo).

## Como selecionar

1. Em cada item, marque **`[x] REMOVER`** nos alertas que devem sair.
2. Deixe **`[x] MANTER`** (ou troque) nos que devem permanecer.
3. Depois diga algo como: *"remova todos marcados como REMOVER"*.

IDs estáveis no formato `A001`, `A002`… para você referenciar no chat.

---

## Feature: `analise`

### `apps/web/src/features/analise/components/AnaliseItemsTree.tsx`

#### A003 — linha 354

- **Mensagem:** "Não foi possível abrir o arquivo localmente.\\n\\nVerifique se o serviço SAGRA Folder Opener está em execução.\\n\\n{...}"
- **Handler:** `handleOpen`
- **Momento:** Validação bloqueante quando: `!ok`
- **Trecho:** `window.alert( 'Não foi possível abrir o arquivo localmente.\n\nVerifique se o serviço SAGRA Folder Opener está em execução.\n\n${file.name}', );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/analise/components/AnalisePage.tsx`

#### A004 — linha 636

- **Mensagem:** "(dinâmico / fallback) Erro ao mover item para outro componente."
- **Handler:** `?`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( e instanceof Error ? e.message : "Erro ao mover item para outro componente.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A005 — linha 742

- **Mensagem:** "(variável: msg)"
- **Handler:** `?`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(msg);`
- [ ] **REMOVER**
- [x] **MANTER**

#### A006 — linha 757

- **Mensagem:** "(dinâmico / fallback) Erro ao adicionar item."
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert(e instanceof Error ? e.message : "Erro ao adicionar item.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A007 — linha 773

- **Mensagem:** "(dinâmico / fallback) Erro ao remover item."
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert(e instanceof Error ? e.message : "Erro ao remover item.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A008 — linha 795

- **Mensagem:** "(dinâmico / fallback) Erro ao atualizar resolução obrigatória."
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert(e instanceof Error ? e.message : "Erro ao atualizar resolução obrigatória.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A009 — linha 821

- **Mensagem:** "(dinâmico / fallback) Erro ao registrar correção interna."
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert(e instanceof Error ? e.message : "Erro ao registrar correção interna.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A010 — linha 855

- **Mensagem:** " (readOnlyReason ?? \"Análise em modo visualização.\");"
- **Handler:** `handleRegisterPt`
- **Momento:** Validação bloqueante quando: `readOnlyMode`
- **Trecho:** `window.alert(readOnlyReason ?? "Análise em modo visualização.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A011 — linha 859

- **Mensagem:** "Selecione um item na biblioteca."
- **Handler:** `handleRegisterPt`
- **Momento:** Validação bloqueante quando: `!previewLibrary?.ID`
- **Trecho:** `window.alert("Selecione um item na biblioteca.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A012 — linha 863

- **Mensagem:** "OS ou usuário inválido para registro."
- **Handler:** `handleRegisterPt`
- **Momento:** Validação bloqueante quando: `!validOs || !ponto`
- **Trecho:** `window.alert("OS ou usuário inválido para registro.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A013 — linha 878

- **Mensagem:** "(dinâmico / fallback) Erro ao preparar a análise para registro."
- **Handler:** `handleRegisterPt`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( e instanceof Error ? e.message : "Erro ao preparar a análise para registro.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A014 — linha 929

- **Mensagem:** "Item \"{...}\" criado com sucesso!"
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert('Item "${data.titulo}" criado com sucesso!');`
- [x] **REMOVER**
- [ ] **MANTER**

#### A015 — linha 941

- **Mensagem:** "(dinâmico / fallback) Erro ao criar item."
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert(e instanceof Error ? e.message : "Erro ao criar item.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A016 — linha 947

- **Mensagem:** " (readOnlyReason ?? \"Análise em modo visualização.\");"
- **Handler:** `handleReplicatePt`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert(readOnlyReason ?? "Análise em modo visualização.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A017 — linha 951

- **Mensagem:** "Nenhum item selecionado."
- **Handler:** `handleReplicatePt`
- **Momento:** Validação bloqueante quando: `!selectedItem`
- **Trecho:** `window.alert("Nenhum item selecionado.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A018 — linha 956

- **Mensagem:** "Este problema não possui vínculo com a biblioteca e não pode ser replicado automaticamente."
- **Handler:** `handleReplicatePt`
- **Momento:** Validação bloqueante quando: `!idPadrao`
- **Trecho:** `window.alert( "Este problema não possui vínculo com a biblioteca e não pode ser replicado automaticamente.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A019 — linha 962

- **Mensagem:** "OS ou usuário inválido para registro."
- **Handler:** `handleReplicatePt`
- **Momento:** Validação bloqueante quando: `!validOs || !ponto`
- **Trecho:** `window.alert("OS ou usuário inválido para registro.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A020 — linha 977

- **Mensagem:** "(dinâmico / fallback) Erro ao preparar a análise para replicação."
- **Handler:** `handleReplicatePt`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( e instanceof Error ? e.message : "Erro ao preparar a análise para replicação.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A021 — linha 1012

- **Mensagem:** "Problema replicado para {...} ({...})."
- **Handler:** `addItemMutation.mutate`
- **Momento:** Ao executar `addItemMutation.mutate`
- **Trecho:** `window.alert( 'Problema replicado para ${itemVersao} (${targetComponente}).', );`
- [x] **REMOVER**
- [ ] **MANTER**

#### A022 — linha 1022

- **Mensagem:** " (readOnlyReason ?? \"Análise em modo visualização.\");"
- **Handler:** `handleOpenAnnotation`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(readOnlyReason ?? "Análise em modo visualização.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A023 — linha 1026

- **Mensagem:** "Nenhum item selecionado."
- **Handler:** `handleOpenAnnotation`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert("Nenhum item selecionado.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A024 — linha 1031

- **Mensagem:** "Selecione uma versão analisada válida."
- **Handler:** `handleOpenAnnotation`
- **Momento:** Validação bloqueante quando: `!path`
- **Trecho:** `window.alert("Selecione uma versão analisada válida.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A025 — linha 1041

- **Mensagem:** "(dinâmico / fallback) Erro ao listar arquivos."
- **Handler:** `handleOpenAnnotation`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(e instanceof Error ? e.message : "Erro ao listar arquivos.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A026 — linha 1061

- **Mensagem:** "Não foi possível gerar a imagem de indicação."
- **Handler:** `handleAnnotationSave`
- **Momento:** Validação bloqueante quando: `newHtml === (selectedItem.html || "")`
- **Trecho:** `window.alert("Não foi possível gerar a imagem de indicação.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A027 — linha 1072

- **Mensagem:** "Erro ao gravar a indicação no item."
- **Handler:** `handleAnnotationSave`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert("Erro ao gravar a indicação no item.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A028 — linha 1075

- **Mensagem:** "(dinâmico / fallback) Erro ao salvar imagem de indicação."
- **Handler:** `handleAnnotationSave`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( e instanceof Error ? e.message : "Erro ao salvar imagem de indicação.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A029 — linha 1084

- **Mensagem:** " (readOnlyReason ?? \"Análise em modo visualização.\");"
- **Handler:** `handleRemoveIndication`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(readOnlyReason ?? "Análise em modo visualização.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A030 — linha 1097

- **Mensagem:** "Não foi possível remover a indicação."
- **Handler:** `handleRemoveIndication`
- **Momento:** Validação bloqueante quando: `newHtml === currentHtml`
- **Trecho:** `window.alert("Não foi possível remover a indicação.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A031 — linha 1108

- **Mensagem:** "Erro ao remover a indicação do item."
- **Handler:** `handleRemoveIndication`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert("Erro ao remover a indicação do item.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A032 — linha 1183

- **Mensagem:** "(dinâmico / fallback) Erro ao finalizar análise."
- **Handler:** `completeFinish`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(e instanceof Error ? e.message : "Erro ao finalizar análise.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A033 — linha 1191

- **Mensagem:** " (readOnlyReason ?? \"Análise em modo visualização.\");"
- **Handler:** `handleFinish`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(readOnlyReason ?? "Análise em modo visualização.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A034 — linha 1228

- **Mensagem:** "Informe a observação."
- **Handler:** `handleConfirmObservacao`
- **Momento:** Validação bloqueante quando: `!obsText.trim()`
- **Trecho:** `window.alert("Informe a observação.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A035 — linha 1247

- **Mensagem:** "(dinâmico / fallback) Erro ao registrar andamento."
- **Handler:** `handleConfirmObservacao`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(e instanceof Error ? e.message : "Erro ao registrar andamento.");`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `analise-lab`

### `apps/web/src/features/analise-lab/AnaliseLabItemList.tsx`

#### A036 — linha 467

- **Mensagem:** "Não foi possível abrir o arquivo localmente.\\n\\nVerifique se o serviço SAGRA Folder Opener está em execução.\\n\\n{...}"
- **Handler:** `handleOpen`
- **Momento:** Validação bloqueante quando: `!ok`
- **Trecho:** `window.alert( 'Não foi possível abrir o arquivo localmente.\n\nVerifique se o serviço SAGRA Folder Opener está em execução.\n\n${file.name}', );`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `configuracoes`

### `apps/web/src/features/configuracoes/components/CotasGrafSettingsSection.tsx`

#### A037 — linha 69

- **Mensagem:** "Novo semestre iniciado com sucesso."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert("Novo semestre iniciado com sucesso.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A038 — linha 72

- **Mensagem:** " (err.message || \"Não foi possível iniciar o novo semestre.\");"
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert(err.message || "Não foi possível iniciar o novo semestre.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A039 — linha 87

- **Mensagem:** " (err.message || \"Não foi possível importar a planilha.\");"
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert(err.message || "Não foi possível importar a planilha.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A040 — linha 95

- **Mensagem:** "Cotas recalculadas.\\n\\n"
- **Handler:** `onSuccess`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert( 'Cotas recalculadas.\n\n' + 'Movimentos sincronizados: ${data.movimentos_inseridos.toLocaleString("pt-BR")}\n' + 'Clientes atualizados: ${data.clientes_atualizados.toLocaleString("pt-BR")}', );`
- [x] **REMOVER**
- [ ] **MANTER**

#### A041 — linha 102

- **Mensagem:** " (err.message || \"Não foi possível recalcular as cotas.\");"
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert(err.message || "Não foi possível recalcular as cotas.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A042 — linha 111

- **Mensagem:** "Informe o período do novo semestre."
- **Handler:** `handleIniciar`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert("Informe o período do novo semestre.");`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/configuracoes/components/CustosSettingsSection.tsx`

#### A043 — linha 111

- **Mensagem:** "(dinâmico / fallback) Operação falhou."
- **Handler:** `reportError`
- **Momento:** Ao executar `reportError`
- **Trecho:** `window.alert(error instanceof Error ? error.message : "Operação falhou.");`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/configuracoes/components/DesenvolvimentoSettingsSection.tsx`

#### A044 — linha 37

- **Mensagem:** "Flags de desenvolvimento salvas."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert("Flags de desenvolvimento salvas.");`
- [x] **REMOVER**
- [ ] **MANTER**

### `apps/web/src/features/configuracoes/components/EmailDispatchModePanel.tsx`

#### A045 — linha 139

- **Mensagem:** "(dinâmico / fallback) Não foi possível alterar o tipo de envio."
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert(error instanceof Error ? error.message : "Não foi possível alterar o tipo de envio.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A046 — linha 161

- **Mensagem:** "Nenhum modelo «{...}» encontrado para {...}. Verifique a seção «Modelos de envio»."
- **Handler:** `onSelectMode`
- **Momento:** Validação bloqueante quando: `!target`
- **Trecho:** `window.alert( 'Nenhum modelo «${modeLabel(mode, isProva)}» encontrado para ${grupo}. Verifique a seção «Modelos de envio».', );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/configuracoes/components/EmailTemplateModelsSection.tsx`

#### A047 — linha 122

- **Mensagem:** "(dinâmico / fallback) Operação falhou."
- **Handler:** `reportError`
- **Momento:** Ao executar `reportError`
- **Trecho:** `window.alert(error instanceof Error ? error.message : "Operação falhou.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A048 — linha 138

- **Mensagem:** "Modelo salvo."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert("Modelo salvo.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A049 — linha 159

- **Mensagem:** "Modelo criado."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert("Modelo criado.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A050 — linha 178

- **Mensagem:** "Modelo excluído."
- **Handler:** `onSuccess`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert("Modelo excluído.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A051 — linha 203

- **Mensagem:** "Teste enviado para {...}\\nAssunto: {...}"
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert('Teste enviado para ${data.to}\nAssunto: ${data.subject}');`
- [x] **REMOVER**
- [ ] **MANTER**

### `apps/web/src/features/configuracoes/components/EmailTemplatesSection.tsx`

#### A052 — linha 312

- **Mensagem:** "(dinâmico / fallback) Operação falhou."
- **Handler:** `reportError`
- **Momento:** Ao executar `reportError`
- **Trecho:** `window.alert(error instanceof Error ? error.message : "Operação falhou.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A053 — linha 333

- **Mensagem:** "Modelo de e-mail salvo."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert("Modelo de e-mail salvo.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A054 — linha 347

- **Mensagem:** "Modelo restaurado para o padrão do sistema."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert("Modelo restaurado para o padrão do sistema.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A055 — linha 390

- **Mensagem:** "E-mail de teste enviado para {...}.\\n\\nAssunto: {...}\\nRemetente: {...}"
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert( 'E-mail de teste enviado para ${data.to}.\n\nAssunto: ${data.subject}\nRemetente: ${fromLabel}', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A056 — linha 423

- **Mensagem:** "Arquivo cadastrado e aplicado a este modelo."
- **Handler:** `onSuccess`
- **Momento:** Validação bloqueante quando: `uploadInputRef.current`
- **Trecho:** `window.alert("Arquivo cadastrado e aplicado a este modelo.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A057 — linha 447

- **Mensagem:** "Modelo cadastrado removido."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert("Modelo cadastrado removido.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A058 — linha 461

- **Mensagem:** "Contas de envio salvas."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert("Contas de envio salvas.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A059 — linha 487

- **Mensagem:** "Notificações de gravação salvas."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert("Notificações de gravação salvas.");`
- [x] **REMOVER**
- [ ] **MANTER**

### `apps/web/src/features/configuracoes/components/GerenciaSettingsSection.tsx`

#### A060 — linha 39

- **Mensagem:** "Configurações de gerência salvas."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert("Configurações de gerência salvas.");`
- [x] **REMOVER**
- [ ] **MANTER**

### `apps/web/src/features/configuracoes/components/MachineGroupsPanel.tsx`

#### A061 — linha 91

- **Mensagem:** "(dinâmico / fallback) Operação falhou."
- **Handler:** `reportError`
- **Momento:** Ao executar `reportError`
- **Trecho:** `window.alert(error instanceof Error ? error.message : "Operação falhou.");`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/configuracoes/components/OperationalEmailEditorPanel.tsx`

#### A062 — linha 137

- **Mensagem:** "(dinâmico / fallback) Operação falhou."
- **Handler:** `reportError`
- **Momento:** Ao executar `reportError`
- **Trecho:** `window.alert(error instanceof Error ? error.message : "Operação falhou.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A063 — linha 153

- **Mensagem:** "Modelo salvo."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert("Modelo salvo.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A064 — linha 176

- **Mensagem:** "Modelo criado."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert("Modelo criado.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A065 — linha 195

- **Mensagem:** "Modelo excluído."
- **Handler:** `onSuccess`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert("Modelo excluído.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A066 — linha 220

- **Mensagem:** "Teste enviado para {...}\\nAssunto: {...}"
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert('Teste enviado para ${data.to}\nAssunto: ${data.subject}');`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/configuracoes/components/PreAnaliseChecksSection.tsx`

#### A067 — linha 39

- **Mensagem:** "Scripts de pré-análise salvos."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert("Scripts de pré-análise salvos.");`
- [x] **REMOVER**
- [ ] **MANTER**

### `apps/web/src/features/configuracoes/components/ProdutoEtapasPanel.tsx`

#### A068 — linha 90

- **Mensagem:** "(dinâmico / fallback) Falha ao salvar etapas."
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert(err instanceof Error ? err.message : "Falha ao salvar etapas."),`
- [ ] **REMOVER**
- [x] **MANTER**

#### A069 — linha 103

- **Mensagem:** "(dinâmico / fallback) Falha ao copiar etapas."
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert(err instanceof Error ? err.message : "Falha ao copiar etapas."),`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/configuracoes/components/SincronizacaoSettingsSection.tsx`

#### A070 — linha 90

- **Mensagem:** "Política de sincronização salva. O serviço aplica no próximo ciclo."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert("Política de sincronização salva. O serviço aplica no próximo ciclo.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A071 — linha 93

- **Mensagem:** "Falha ao salvar: {...}"
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert('Falha ao salvar: ${err.message}');`
- [ ] **REMOVER**
- [x] **MANTER**

#### A072 — linha 107

- **Mensagem:** "Comando {...} enviado para {...}."
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert('Comando ${vars.action} enviado para ${vars.name}.');`
- [x] **REMOVER**
- [ ] **MANTER**

#### A073 — linha 110

- **Mensagem:** "Falha no controle do serviço: {...}"
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert('Falha no controle do serviço: ${err.message}');`
- [ ] **REMOVER**
- [x] **MANTER**

#### A074 — linha 132

- **Mensagem:** "Falha: {...}"
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert('Falha: ${err.message}');`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/configuracoes/components/SistemaSettingsSection.tsx`

#### A075 — linha 131

- **Mensagem:** "(dinâmico / fallback) Operação falhou."
- **Handler:** `reportError`
- **Momento:** Ao executar `reportError`
- **Trecho:** `window.alert(error instanceof Error ? error.message : "Operação falhou.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A076 — linha 422

- **Mensagem:** "(dinâmico / fallback) Falha ao abrir o produto."
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert(err instanceof Error ? err.message : "Falha ao abrir o produto."),`
- [ ] **REMOVER**
- [x] **MANTER**

#### A077 — linha 540

- **Mensagem:** "(dinâmico / fallback) Operação falhou."
- **Handler:** `reportError`
- **Momento:** Ao executar `reportError`
- **Trecho:** `window.alert(error instanceof Error ? error.message : "Operação falhou.");`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `cotas-graf`

### `apps/web/src/features/cotas-graf/components/CotasGrafPage.tsx`

#### A078 — linha 408

- **Mensagem:** "(dinâmico / fallback) Não foi possível lançar no CotasGraf."
- **Handler:** `lancarMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( err instanceof Error ? err.message : "Não foi possível lançar no CotasGraf.", );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/cotas-graf/components/CotasGrafSettingsModal.tsx`

#### A079 — linha 120

- **Mensagem:** "Sessão inválida. Faça login novamente."
- **Handler:** `handleCreateFilter`
- **Momento:** Validação bloqueante quando: `!ponto`
- **Trecho:** `window.alert("Sessão inválida. Faça login novamente.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A080 — linha 125

- **Mensagem:** "Digite um nome para o filtro."
- **Handler:** `handleCreateFilter`
- **Momento:** Validação bloqueante quando: `!nome`
- **Trecho:** `window.alert("Digite um nome para o filtro.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A081 — linha 137

- **Mensagem:** "Filtro salvo com sucesso."
- **Handler:** `createFilterMutation.mutate`
- **Momento:** Feedback de sucesso após a ação (createFilterMutation.mutate)
- **Trecho:** `window.alert("Filtro salvo com sucesso.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A082 — linha 139

- **Mensagem:** "(dinâmico / fallback) Erro ao salvar filtro."
- **Handler:** `createFilterMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(err instanceof Error ? err.message : "Erro ao salvar filtro.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A083 — linha 147

- **Mensagem:** "Digite um nome para o filtro."
- **Handler:** `handleUpdateFilter`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert("Digite um nome para o filtro.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A084 — linha 157

- **Mensagem:** "Filtro atualizado com sucesso."
- **Handler:** `updateFilterMutation.mutate`
- **Momento:** Feedback de sucesso após a ação (updateFilterMutation.mutate)
- **Trecho:** `window.alert("Filtro atualizado com sucesso.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A085 — linha 159

- **Mensagem:** "(dinâmico / fallback) Erro ao atualizar filtro."
- **Handler:** `updateFilterMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(err instanceof Error ? err.message : "Erro ao atualizar filtro.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A086 — linha 174

- **Mensagem:** "(dinâmico / fallback) Erro ao definir padrão."
- **Handler:** `setDefaultMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(err instanceof Error ? err.message : "Erro ao definir padrão.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A087 — linha 185

- **Mensagem:** "(dinâmico / fallback) Erro ao excluir filtro."
- **Handler:** `deleteFilterMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(err instanceof Error ? err.message : "Erro ao excluir filtro.");`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `dashboard-setor`

### `apps/web/src/features/dashboard-setor/components/DashboardSetorPage.tsx`

#### A088 — linha 117

- **Mensagem:** "✅ Cache limpo! Configuração padrão restaurada."
- **Handler:** `handleClearCache`
- **Momento:** Ao executar `handleClearCache`
- **Trecho:** `window.alert("✅ Cache limpo! Configuração padrão restaurada.");`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/dashboard-setor/components/DashboardSetorSettingsForm.tsx`

#### A089 — linha 194

- **Mensagem:** "Máximo de 6 colunas atingido!"
- **Handler:** `addColumn`
- **Momento:** Validação bloqueante quando: `prev.columns.length >= 6`
- **Trecho:** `window.alert("Máximo de 6 colunas atingido!");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A090 — linha 212

- **Mensagem:** "É necessário ter pelo menos 1 coluna!"
- **Handler:** `removeColumn`
- **Momento:** Validação bloqueante quando: `prev.columns.length <= 1`
- **Trecho:** `window.alert("É necessário ter pelo menos 1 coluna!");`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `dashboard-tablet`

### `apps/web/src/features/dashboard-tablet/components/DashboardTabletPage.tsx`

#### A091 — linha 303

- **Mensagem:** "(dinâmico / fallback) Não foi possível alterar as notificações."
- **Handler:** `handleSaveSettings`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( err instanceof Error ? err.message : "Não foi possível alterar as notificações.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A092 — linha 347

- **Mensagem:** "Cache limpo! Configuração padrão restaurada."
- **Handler:** `handleClearCache`
- **Momento:** Ao executar `handleClearCache`
- **Trecho:** `window.alert("Cache limpo! Configuração padrão restaurada.");`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `email`

### `apps/web/src/features/email/components/EmailInboxDetail.tsx`

#### A093 — linha 158

- **Mensagem:** "Informe uma OS existente (número e ano válidos)."
- **Handler:** `handleSend`
- **Momento:** Validação bloqueante quando: `!osAnoPair || !osReady`
- **Trecho:** `window.alert("Informe uma OS existente (número e ano válidos).");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A094 — linha 182

- **Mensagem:** "Erro ao enviar para execução: {...}"
- **Handler:** `handleSend`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Erro ao enviar para execução: ${e instanceof Error ? e.message : String(e)}', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A095 — linha 196

- **Mensagem:** "Erro ao desconsiderar: {...}"
- **Handler:** `handleDesconsiderar`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Erro ao desconsiderar: ${e instanceof Error ? e.message : String(e)}', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A096 — linha 204

- **Mensagem:** "Informe uma OS existente (número e ano válidos)."
- **Handler:** `handleReply`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert("Informe uma OS existente (número e ano válidos).");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A097 — linha 218

- **Mensagem:** "Erro ao responder: {...}"
- **Handler:** `handleReply`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert('Erro ao responder: ${e instanceof Error ? e.message : String(e)}');`
- [ ] **REMOVER**
- [x] **MANTER**

#### A098 — linha 224

- **Mensagem:** "Informe uma OS existente (número e ano válidos)."
- **Handler:** `handleSaveMht`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert("Informe uma OS existente (número e ano válidos).");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A099 — linha 228

- **Mensagem:** "Não foi possível identificar o e-mail no Exchange."
- **Handler:** `handleSaveMht`
- **Momento:** Validação bloqueante quando: `!email.real_id`
- **Trecho:** `window.alert("Não foi possível identificar o e-mail no Exchange.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A100 — linha 239

- **Mensagem:** "Erro ao salvar e-mail (.mht): {...}"
- **Handler:** `handleSaveMht`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Erro ao salvar e-mail (.mht): ${e instanceof Error ? e.message : String(e)}', );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/email/components/EmailPendenciaDetail.tsx`

#### A101 — linha 307

- **Mensagem:** "Selecione um PDF dentro da pasta Sefoc."
- **Handler:** `handleProofPdfPick`
- **Momento:** Validação bloqueante quando: `!proofFilename`
- **Trecho:** `window.alert("Selecione um PDF dentro da pasta Sefoc.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A102 — linha 315

- **Mensagem:** "Preencha o número da versão (ex: 1, 2, 3...)"
- **Handler:** `handleSend`
- **Momento:** Validação bloqueante quando: `requiresVersao && !versao.trim()`
- **Trecho:** `window.alert("Preencha o número da versão (ex: 1, 2, 3...)");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A103 — linha 324

- **Mensagem:** "Selecione o PDF de prova que será enviado ao cliente."
- **Handler:** `handleSend`
- **Momento:** Feedback de sucesso após a ação (handleSend)
- **Trecho:** `window.alert("Selecione o PDF de prova que será enviado ao cliente.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A104 — linha 332

- **Mensagem:** "DOCX do Timbrado A4 Digital não encontrados na pasta Sefoc. Gere o Timbrado Digital antes de enviar."
- **Handler:** `handleSend`
- **Momento:** Ao executar `handleSend`
- **Trecho:** `window.alert( "DOCX do Timbrado A4 Digital não encontrados na pasta Sefoc. Gere o Timbrado Digital antes de enviar.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A105 — linha 338

- **Mensagem:** "Corpo do e-mail Apogee indisponível para envio."
- **Handler:** `handleSend`
- **Momento:** Validação bloqueante quando: `isApogee && !item.body?.trim()`
- **Trecho:** `window.alert("Corpo do e-mail Apogee indisponível para envio.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A106 — linha 345

- **Mensagem:** "Preencha pelo menos um e-mail de destinatário"
- **Handler:** `handleSend`
- **Momento:** Validação bloqueante quando: `destinatarios.length === 0`
- **Trecho:** `window.alert("Preencha pelo menos um e-mail de destinatário");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A107 — linha 351

- **Mensagem:** "E-mail inválido: {...}"
- **Handler:** `handleSend`
- **Momento:** Validação bloqueante quando: `!emailRegex.test(addr)`
- **Trecho:** `window.alert('E-mail inválido: ${addr}');`
- [ ] **REMOVER**
- [x] **MANTER**

#### A108 — linha 399

- **Mensagem:** "E-mail enviado e andamento registrado."
- **Handler:** `?`
- **Momento:** Feedback de sucesso após a ação
- **Trecho:** `window.alert("E-mail enviado e andamento registrado.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A109 — linha 401

- **Mensagem:** "E-mail enviado, mas falha ao registrar andamento: {...}"
- **Handler:** `?`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'E-mail enviado, mas falha ao registrar andamento: ${ andamentoErr instanceof Error ? andamentoErr.message : String(andamentoErr) }', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A110 — linha 408

- **Mensagem:** "(variável: msg)"
- **Handler:** `?`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(msg);`
- [ ] **REMOVER**
- [x] **MANTER**

#### A111 — linha 416

- **Mensagem:** "Erro ao enviar e-mail: {...}"
- **Handler:** `?`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Erro ao enviar e-mail: ${e instanceof Error ? e.message : String(e)}', );`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `gerencia`

### `apps/web/src/features/gerencia/components/GerenciaPage.tsx`

#### A112 — linha 62

- **Mensagem:** "Erro ao carregar dados da OS."
- **Handler:** `GerenciaPage`
- **Momento:** Validação bloqueante quando: `loadError`
- **Trecho:** `window.alert("Erro ao carregar dados da OS.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A113 — linha 96

- **Mensagem:** " (result.message || \"Erro ao salvar OS.\");"
- **Handler:** `applySaveResult`
- **Momento:** Validação bloqueante quando: `result.status !== "ok"`
- **Trecho:** `window.alert(result.message || "Erro ao salvar OS.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A114 — linha 119

- **Mensagem:** " ( result.message || `OS salva com sucesso! (OS: ${result.id}/${result.ano})`, );"
- **Handler:** `applySaveResult`
- **Momento:** Feedback de sucesso após a ação (applySaveResult)
- **Trecho:** `window.alert( result.message || 'OS salva com sucesso! (OS: ${result.id}/${result.ano})', );`
- [x] **REMOVER**
- [ ] **MANTER**

### `apps/web/src/features/gerencia/components/NovaOsArquivosModal.tsx`

#### A115 — linha 134

- **Mensagem:** " (res.message || \"E-mail enviado ao cliente.\");"
- **Handler:** `handleSendEmail`
- **Momento:** Feedback de sucesso após a ação (handleSendEmail)
- **Trecho:** `window.alert(res.message || "E-mail enviado ao cliente.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A116 — linha 157

- **Mensagem:** "Arquivos enviados ({...}) para a pasta {...}."
- **Handler:** `handleConfirmSelf`
- **Momento:** Feedback de sucesso após a ação (handleConfirmSelf)
- **Trecho:** `window.alert( 'Arquivos enviados (${res.files?.length ?? 0}) para a pasta ${res.folder ?? "Original"}.', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A117 — linha 368

- **Mensagem:** "Pastas movidas com sucesso para OS {...}/{...}.\\n\\n"
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert( 'Pastas movidas com sucesso para OS ${osId}/${ano}.\n\n' + 'Itens: ${moved}\n' + (result.dest_folder_created ? "\nA pasta de destino foi criada na rede." : ""), );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/gerencia/components/TrabalhoComponentes.tsx`

#### A118 — linha 115

- **Mensagem:** "Arquivo é um componente automático e não pode ser adicionado manualmente."
- **Handler:** `addNamedComponente`
- **Momento:** Validação bloqueante quando: `isGenericoComponente({ nome, lotes: [] })`
- **Trecho:** `window.alert( "Arquivo é um componente automático e não pode ser adicionado manualmente.", );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/gerencia/hooks/useGerenciaOsEditor.ts`

#### A119 — linha 346

- **Mensagem:** "Informe o Solicitante (mínimo 3 caracteres) antes de alterar a foto."
- **Handler:** `?`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( "Informe o Solicitante (mínimo 3 caracteres) antes de alterar a foto.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A120 — linha 352

- **Mensagem:** "Imagem muito grande (máx. 8MB)."
- **Handler:** `?`
- **Momento:** Validação bloqueante quando: `file.size > 8 * 1024 * 1024`
- **Trecho:** `window.alert("Imagem muito grande (máx. 8MB).");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A121 — linha 364

- **Mensagem:** "(dinâmico / fallback) Falha ao salvar a foto."
- **Handler:** `?`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( e instanceof Error ? e.message : "Falha ao salvar a foto.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A122 — linha 458

- **Mensagem:** "Selecione um Produto."
- **Handler:** `?`
- **Momento:** Validação bloqueante quando: `!form.val_produto`
- **Trecho:** `window.alert("Selecione um Produto.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A123 — linha 462

- **Mensagem:** "Informe o Título."
- **Handler:** `?`
- **Momento:** Validação bloqueante quando: `!form.val_titulo.trim()`
- **Trecho:** `window.alert("Informe o Título.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A124 — linha 466

- **Mensagem:** "Informe o Solicitante."
- **Handler:** `?`
- **Momento:** Validação bloqueante quando: `!form.req_solicitante.trim()`
- **Trecho:** `window.alert("Informe o Solicitante.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A125 — linha 471

- **Mensagem:** "(variável: entregaError)"
- **Handler:** `?`
- **Momento:** Validação bloqueante quando: `entregaError`
- **Trecho:** `window.alert(entregaError);`
- [ ] **REMOVER**
- [x] **MANTER**

#### A126 — linha 522

- **Mensagem:** "Erro de comunicação: {...}"
- **Handler:** `?`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Erro de comunicação: ${e instanceof Error ? e.message : String(e)}', );`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `gravacao-externa`

### `apps/web/src/features/gravacao-externa/components/GravacaoExternaChatPanel.tsx`

#### A127 — linha 79

- **Mensagem:** "Não foi possível enviar a mensagem."
- **Handler:** `postMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert("Não foi possível enviar a mensagem.");`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/gravacao-externa/components/GravacaoExternaTab.tsx`

#### A128 — linha 376

- **Mensagem:** " ( errors.length === ids.length ? errors[0] || \"Não foi possível remover a OS da lista.\" : `Parte da OS não pôde ser removida: ${errors.join(\" · \")}`, );"
- **Handler:** `removerMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( errors.length === ids.length ? errors[0] || "Não foi possível remover a OS da lista." : 'Parte da OS não pôde ser removida: ${errors.join(" · ")}', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A129 — linha 441

- **Mensagem:** "(dinâmico / fallback) Não foi possível concluir a gravação."
- **Handler:** `concluirMutation.mutate`
- **Momento:** Validação bloqueante quando: `fallback.length > 0`
- **Trecho:** `window.alert( e instanceof Error ? e.message : "Não foi possível concluir a gravação.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A130 — linha 460

- **Mensagem:** "Recebimento das chapas lançado."
- **Handler:** `entregaMutation.mutate`
- **Momento:** Feedback de sucesso após a ação (entregaMutation.mutate)
- **Trecho:** `window.alert("Recebimento das chapas lançado.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A131 — linha 466

- **Mensagem:** "(dinâmico / fallback) Não foi possível lançar o recebimento."
- **Handler:** `entregaMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( e instanceof Error ? e.message : "Não foi possível lançar o recebimento.", );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/gravacao-externa/components/GravacaoPendenteAdicionarOsModal.tsx`

#### A132 — linha 56

- **Mensagem:** "Informe número e ano válidos (ano entre {...} e {...})."
- **Handler:** `handleContinue`
- **Momento:** Validação bloqueante quando: `!parsed`
- **Trecho:** `window.alert( 'Informe número e ano válidos (ano entre ${OS_ANO_MIN} e ${OS_ANO_MAX}).', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A133 — linha 66

- **Mensagem:** "(dinâmico / fallback) Não foi possível localizar a OS."
- **Handler:** `handleContinue`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( error instanceof Error ? error.message : "Não foi possível localizar a OS.", );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/gravacao-externa/components/GravacaoPendenteLaunchModal.tsx`

#### A134 — linha 587

- **Mensagem:** "Por máquina, selecione apenas arquivos PDF de espelho."
- **Handler:** `handleBrowserConfirm`
- **Momento:** Validação bloqueante quando: `pdfs.length !== files.length`
- **Trecho:** `window.alert("Por máquina, selecione apenas arquivos PDF de espelho.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A135 — linha 601

- **Mensagem:** "Por máquina, selecione apenas arquivos TIF de separação."
- **Handler:** `handleBrowserConfirm`
- **Momento:** Validação bloqueante quando: `tifs.length !== files.length`
- **Trecho:** `window.alert("Por máquina, selecione apenas arquivos TIF de separação.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A136 — linha 635

- **Mensagem:** "Informe número e ano válidos da OS a juntar (ano entre {...} e {...})."
- **Handler:** `addJuntada`
- **Momento:** Validação bloqueante quando: `!Number.isFinite(nr) || nr <= 0 || ano == null`
- **Trecho:** `window.alert( 'Informe número e ano válidos da OS a juntar (ano entre ${OS_ANO_MIN} e ${OS_ANO_MAX}).', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A137 — linha 641

- **Mensagem:** "A OS atual já faz parte do lançamento."
- **Handler:** `addJuntada`
- **Momento:** Validação bloqueante quando: `nr === row.nr_os && ano === row.ano`
- **Trecho:** `window.alert("A OS atual já faz parte do lançamento.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A138 — linha 645

- **Mensagem:** "Esta OS já está na lista de juntadas."
- **Handler:** `addJuntada`
- **Momento:** Validação bloqueante quando: `juntadas.some((j) => j.nr_os === nr && j.ano === ano)`
- **Trecho:** `window.alert("Esta OS já está na lista de juntadas.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A139 — linha 656

- **Mensagem:** " ( e instanceof Error ? e.message : `OS ${nr}/${ano} não encontrada.`, );"
- **Handler:** `addJuntada`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( e instanceof Error ? e.message : 'OS ${nr}/${ano} não encontrada.', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A140 — linha 705

- **Mensagem:** "Aguarde a validação da OS que está sendo adicionada à juntada."
- **Handler:** `handleConfirm`
- **Momento:** Validação bloqueante quando: `juntadaBusy`
- **Trecho:** `window.alert("Aguarde a validação da OS que está sendo adicionada à juntada.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A141 — linha 709

- **Mensagem:** "Clique em \"+ OS\" para incluir a OS informada na juntada antes de confirmar."
- **Handler:** `handleConfirm`
- **Momento:** Validação bloqueante quando: `juntadaNumero.trim()`
- **Trecho:** `window.alert('Clique em "+ OS" para incluir a OS informada na juntada antes de confirmar.');`
- [ ] **REMOVER**
- [x] **MANTER**

#### A142 — linha 713

- **Mensagem:** "Adicione ao menos uma OS à juntada pelo botão \"+ OS\" ou desmarque \"Juntada de OSs\"."
- **Handler:** `handleConfirm`
- **Momento:** Validação bloqueante quando: `juntadas.length === 0`
- **Trecho:** `window.alert( 'Adicione ao menos uma OS à juntada pelo botão "+ OS" ou desmarque "Juntada de OSs".', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A143 — linha 731

- **Mensagem:** "Informe o nome da máquina para cada linha com arquivos PDF ou TIF."
- **Handler:** `handleConfirm`
- **Momento:** Validação bloqueante quando: `hasTifs || hasPdfs`
- **Trecho:** `window.alert( "Informe o nome da máquina para cada linha com arquivos PDF ou TIF.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A144 — linha 753

- **Mensagem:** " ( hasTifs ? `Quantidade de chapas inválida para máquina ${maquina}.` : `Informe a quantidade de chapas para a máquina ${maquina} (lançamento só com PDF).`, );"
- **Handler:** `handleConfirm`
- **Momento:** Validação bloqueante quando: `!Number.isFinite(quantidade) || quantidade < 1`
- **Trecho:** `window.alert( hasTifs ? 'Quantidade de chapas inválida para máquina ${maquina}.' : 'Informe a quantidade de chapas para a máquina ${maquina} (lançamento só com PDF).', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A145 — linha 776

- **Mensagem:** "Selecione ao menos um arquivo TIF ou PDF de espelho."
- **Handler:** `handleConfirm`
- **Momento:** Validação bloqueante quando: `allArquivos.length === 0`
- **Trecho:** `window.alert("Selecione ao menos um arquivo TIF ou PDF de espelho.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A146 — linha 780

- **Mensagem:** "Informe ao menos uma máquina com quantidade de chapas."
- **Handler:** `handleConfirm`
- **Momento:** Validação bloqueante quando: `parsedChapas.length === 0`
- **Trecho:** `window.alert("Informe ao menos uma máquina com quantidade de chapas.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A147 — linha 789

- **Mensagem:** "Há {...} TIF(s) sem sufixo de canal (ex.: (C), (M), (Pantone…))."
- **Handler:** `?`
- **Momento:** Validação bloqueante quando: `summary.orphanCount > 0`
- **Trecho:** `window.alert( 'Há ${summary.orphanCount} TIF(s) sem sufixo de canal (ex.: (C), (M), (Pantone…)). ' + "Renomeie ou selecione arquivos com nomenclatura de separação para validar as lâminas contra o espelho.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A148 — linha 796

- **Mensagem:** "Os espelhos têm {...} página(s) → {...} lâmina(s) de separação esperada(s)."
- **Handler:** `?`
- **Momento:** Validação bloqueante quando: `summary.groupCount !== pdfPageCount`
- **Trecho:** `window.alert( 'Os espelhos têm ${pdfPageCount} página(s) → ${pdfPageCount} lâmina(s) de separação esperada(s). ' + 'Você selecionou ${summary.groupCount} lâmina(s) (${summary.fileCount} arquivo(s) TIF). ' + "Ajuste os TI`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/gravacao-externa/components/GravacaoPendenteTab.tsx`

#### A149 — linha 247

- **Mensagem:** "(dinâmico / fallback) Não foi possível excluir o lançamento."
- **Handler:** `deleteControleMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( error instanceof Error ? error.message : "Não foi possível excluir o lançamento.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A150 — linha 403

- **Mensagem:** " ( errors.length === ids.length ? errors[0] || \"Não foi possível remover a OS da lista.\" : `Parte da OS não pôde ser removida: ${errors.join(\" · \")}`, );"
- **Handler:** `removerMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( errors.length === ids.length ? errors[0] || "Não foi possível remover a OS da lista." : 'Parte da OS não pôde ser removida: ${errors.join(" · ")}', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A152 — linha 431

- **Mensagem:** "OS enviada para Gravação Externa."
- **Handler:** `enviarMutation.mutate`
- **Momento:** Validação bloqueante quando: `partial`
- **Trecho:** `window.alert("OS enviada para Gravação Externa.");`
- [x] **REMOVER**
- [ ] **MANTER**

#### A153 — linha 435

- **Mensagem:** "(dinâmico / fallback) Não foi possível enviar para Gravação Externa."
- **Handler:** `enviarMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( e instanceof Error ? e.message : "Não foi possível enviar para Gravação Externa.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A154 — linha 443

- **Mensagem:** "Selecione ao menos um conjunto de chapas para carregar os arquivos e enviar ao birô."
- **Handler:** `handleEnviar`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( "Selecione ao menos uma máquina nos badges de chapas para carregar os arquivos e enviar ao birô.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A155 — linha 453

- **Mensagem:** "Nenhum fornecedor cadastrado. Cadastre um usuário como Fornecedor."
- **Handler:** `handleEnviar`
- **Momento:** Validação bloqueante quando: `items.length === 0`
- **Trecho:** `window.alert( "Nenhum fornecedor cadastrado. Cadastre um usuário com flag Fornecedor.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A156 — linha 465

- **Mensagem:** "(dinâmico / fallback) Não foi possível carregar fornecedores."
- **Handler:** `handleEnviar`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( e instanceof Error ? e.message : "Não foi possível carregar fornecedores.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A157 — linha 749

- **Mensagem:** "(dinâmico / fallback) Não foi possível salvar a observação."
- **Handler:** `patchObservacaoMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( error instanceof Error ? error.message : "Não foi possível salvar a observação.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A159 — linha 1137

- **Mensagem:** "(dinâmico / fallback) Não foi possível adicionar a OS."
- **Handler:** `onConfirm`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( error instanceof Error ? error.message : "Não foi possível adicionar a OS.", );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/gravacao-externa/components/NetworkFolderBrowserModal.tsx`

#### A160 — linha 194

- **Mensagem:** "Selecione apenas arquivos PDF ou TIF."
- **Handler:** `?`
- **Momento:** Validação bloqueante quando: `!isGravacaoExternaFile(entryName)`
- **Trecho:** `window.alert("Selecione apenas arquivos PDF ou TIF.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A161 — linha 211

- **Mensagem:** "Selecione ao menos um arquivo PDF ou TIF."
- **Handler:** `?`
- **Momento:** Validação bloqueante quando: `picks.length === 0`
- **Trecho:** `window.alert("Selecione ao menos um arquivo PDF ou TIF.");`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `hooks`

### `apps/web/src/hooks/useWebPush.ts`

#### A244 — linha 106

- **Mensagem:** "Este navegador não suporta notificações."
- **Handler:** `ensureNotificationPermission`
- **Momento:** Validação bloqueante quando: `support === "unsupported"`
- **Trecho:** `window.alert("Este navegador não suporta notificações.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A245 — linha 110

- **Mensagem:** "Notificações exigem conexão segura (HTTPS) ou localhost. Use https://cgrafsysvm/sagra/ ou abra o SAGRA em http://localhost:5173."
- **Handler:** `ensureNotificationPermission`
- **Momento:** Validação bloqueante quando: `support === "insecure-context"`
- **Trecho:** `window.alert( "Notificações exigem conexão segura (HTTPS) ou localhost. Use https://cgrafsysvm/sagra/ ou abra o SAGRA em http://localhost:5173.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A246 — linha 121

- **Mensagem:** "Permissão negada. No Windows, abra Configurações → Sistema → Notificações e permita o navegador (Edge/Chrome) exibir alertas."
- **Handler:** `ensureNotificationPermission`
- **Momento:** Validação bloqueante quando: `permission !== "granted"`
- **Trecho:** `window.alert( "Permissão negada. No Windows, abra Configurações → Sistema → Notificações e permita o navegador (Edge/Chrome) exibir alertas.", );`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `layout`

### `apps/web/src/components/layout/Sidebar.tsx`

#### A001 — linha 211

- **Mensagem:** "Por favor, selecione uma Ordem de Serviço."
- **Handler:** `onClick`
- **Momento:** Ao executar `onClick`
- **Trecho:** `window.alert("Por favor, selecione uma Ordem de Serviço.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A002 — linha 219

- **Mensagem:** "O acesso à Papelaria é restrito a OS com número superior a 5000."
- **Handler:** `onClick`
- **Momento:** Ao executar `onClick`
- **Trecho:** `window.alert( "O acesso à Papelaria é restrito a OS com número superior a 5000.", );`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `lib`

### `apps/web/src/lib/painel-standalone.ts`

#### A247 — linha 56

- **Mensagem:** "Não foi possível abrir o painel. Verifique se o bloqueador de pop-ups está desativado para este site."
- **Handler:** `openPainelInNewWindow`
- **Momento:** Validação bloqueante quando: `!win`
- **Trecho:** `window.alert( "Não foi possível abrir o painel. Verifique se o bloqueador de pop-ups está desativado para este site.", );`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `os`

### `apps/web/src/features/os/components/OsContextMenu.tsx`

#### A162 — linha 73

- **Mensagem:** "Você não tem permissão para esta ação."
- **Handler:** `OsRowContextMenu`
- **Momento:** Validação bloqueante quando: `perm && !can(perm)`
- **Trecho:** `window.alert("Você não tem permissão para esta ação.");`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/components/OsFolderBrowserModal.tsx`

#### A163 — linha 360

- **Mensagem:** "Selecione um arquivo PDF."
- **Handler:** `handleCopyPath`
- **Momento:** Validação bloqueante quando: `!entry.name.toLowerCase().endsWith(".pdf")`
- **Trecho:** `window.alert("Selecione um arquivo PDF.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A164 — linha 365

- **Mensagem:** "O PDF de prova deve estar dentro da pasta Sefoc."
- **Handler:** `handleCopyPath`
- **Momento:** Validação bloqueante quando: `!rel.toLowerCase().startsWith("sefoc/")`
- **Trecho:** `window.alert("O PDF de prova deve estar dentro da pasta Sefoc.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A165 — linha 379

- **Mensagem:** "Selecione apenas arquivos PDF ou TIF."
- **Handler:** `handleCopyPath`
- **Momento:** Validação bloqueante quando: `!isGravacaoExternaFile(entry.name)`
- **Trecho:** `window.alert("Selecione apenas arquivos PDF ou TIF.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A166 — linha 394

- **Mensagem:** "Selecione ao menos um arquivo PDF ou TIF."
- **Handler:** `handleCopyPath`
- **Momento:** Validação bloqueante quando: `gravacaoPicks.length === 0`
- **Trecho:** `window.alert("Selecione ao menos um arquivo PDF ou TIF.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A167 — linha 413

- **Mensagem:** "(dinâmico / fallback) Não foi possível criar a pasta na rede."
- **Handler:** `createMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( e instanceof Error ? e.message : "Não foi possível criar a pasta na rede.", );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/components/OsFolderMoveForm.tsx`

#### A168 — linha 109

- **Mensagem:** "(dinâmico / fallback) Falha ao mover pastas."
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert( error instanceof Error ? error.message : "Falha ao mover pastas.", );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/components/OsFolderRequiredGateModal.tsx`

#### A169 — linha 67

- **Mensagem:** "(dinâmico / fallback) Não foi possível criar a pasta na rede."
- **Handler:** `createMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( e instanceof Error ? e.message : "Não foi possível criar a pasta na rede.", );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/components/OsGerenciaDetailModal.tsx`

#### A170 — linha 285

- **Mensagem:** " (result.message || \"Erro ao salvar OS.\");"
- **Handler:** `applySaveResult`
- **Momento:** Validação bloqueante quando: `result.status !== "ok"`
- **Trecho:** `window.alert(result.message || "Erro ao salvar OS.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A171 — linha 316

- **Mensagem:** " ( result.message || `OS salva com sucesso! (OS: ${result.id}/${result.ano})`, );"
- **Handler:** `applySaveResult`
- **Momento:** Feedback de sucesso após a ação (applySaveResult)
- **Trecho:** `window.alert( result.message || 'OS salva com sucesso! (OS: ${result.id}/${result.ano})', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A172 — linha 325

- **Mensagem:** " ( result.message || `OS salva com sucesso! (OS: ${result.id}/${result.ano})`, );"
- **Handler:** `applySaveResult`
- **Momento:** Feedback de sucesso após a ação (applySaveResult)
- **Trecho:** `window.alert( result.message || 'OS salva com sucesso! (OS: ${result.id}/${result.ano})', );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/components/OsGravacaoAlterarArquivosButton.tsx`

#### A173 — linha 119

- **Mensagem:** "Carregando arquivos da sessão…"
- **Handler:** `handleOpen`
- **Momento:** Validação bloqueante quando: `detailLoading`
- **Trecho:** `window.alert("Carregando arquivos da sessão…");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A174 — linha 146

- **Mensagem:** "Arquivos atualizados com sucesso."
- **Handler:** `updatePendenteMutation.mutate`
- **Momento:** Feedback de sucesso após a ação (updatePendenteMutation.mutate)
- **Trecho:** `window.alert("Arquivos atualizados com sucesso.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A175 — linha 148

- **Mensagem:** "(dinâmico / fallback) Não foi possível alterar os arquivos."
- **Handler:** `updatePendenteMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( e instanceof Error ? e.message : "Não foi possível alterar os arquivos.", );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/components/OsHistoryPanel.tsx`

#### A176 — linha 427

- **Mensagem:** "OS congelada (Entregue/Cancelada) — andamento bloqueado."
- **Handler:** `startNew`
- **Momento:** Validação bloqueante quando: `frozen`
- **Trecho:** `window.alert("OS congelada (Entregue/Cancelada) — andamento bloqueado.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A177 — linha 453

- **Mensagem:** "Selecione um andamento na lista para editar."
- **Handler:** `startEdit`
- **Momento:** Validação bloqueante quando: `!selectedHistory`
- **Trecho:** `window.alert("Selecione um andamento na lista para editar.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A178 — linha 545

- **Mensagem:** "Selecione uma OS primeiro."
- **Handler:** `saveHistory`
- **Momento:** Validação bloqueante quando: `!selected`
- **Trecho:** `window.alert("Selecione uma OS primeiro.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A179 — linha 549

- **Mensagem:** "OS congelada (Entregue/Cancelada) — andamento bloqueado."
- **Handler:** `saveHistory`
- **Momento:** Validação bloqueante quando: `frozen`
- **Trecho:** `window.alert("OS congelada (Entregue/Cancelada) — andamento bloqueado.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A180 — linha 553

- **Mensagem:** "Preencha Situação e Setor."
- **Handler:** `saveHistory`
- **Momento:** Validação bloqueante quando: `!form.situacao || !form.setor`
- **Trecho:** `window.alert("Preencha Situação e Setor.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A181 — linha 557

- **Mensagem:** "Selecione o componente para lançar o andamento."
- **Handler:** `saveHistory`
- **Momento:** Validação bloqueante quando: `!canSaveNew`
- **Trecho:** `window.alert("Selecione o componente para lançar o andamento.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A182 — linha 617

- **Mensagem:** "Edição de andamento de Sub OS não disponível nesta versão."
- **Handler:** `saveHistory`
- **Momento:** Validação bloqueante quando: `isEditMode`
- **Trecho:** `window.alert("Edição de andamento de Sub OS não disponível nesta versão.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A183 — linha 664

- **Mensagem:** "Erro ao salvar: {...}"
- **Handler:** `addMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Erro ao salvar: ${e instanceof Error ? e.message : "falha"}', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A184 — linha 695

- **Mensagem:** "Selecione o componente para lançar o andamento."
- **Handler:** `handleUnirConfirm`
- **Momento:** Validação bloqueante quando: `!hasComponentTarget`
- **Trecho:** `window.alert("Selecione o componente para lançar o andamento.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A185 — linha 730

- **Mensagem:** "Selecione um andamento para excluir."
- **Handler:** `handleDelete`
- **Momento:** Validação bloqueante quando: `!selectedSubHistory`
- **Trecho:** `window.alert("Selecione um andamento para excluir.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A186 — linha 745

- **Mensagem:** "Andamento da Sub OS excluído."
- **Handler:** `deleteSubOsMutation.mutate`
- **Momento:** Validação bloqueante quando: `!window.confirm(confirmMsg)`
- **Trecho:** `window.alert("Andamento da Sub OS excluído.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A187 — linha 749

- **Mensagem:** "Erro ao excluir: {...}"
- **Handler:** `deleteSubOsMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Erro ao excluir: ${e instanceof Error ? e.message : "falha"}', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A188 — linha 757

- **Mensagem:** "Selecione um andamento para excluir."
- **Handler:** `deleteSubOsMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert("Selecione um andamento para excluir.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A189 — linha 770

- **Mensagem:** "Andamento excluído e lista reorganizada."
- **Handler:** `deleteMutation.mutate`
- **Momento:** Validação bloqueante quando: `!window.confirm(confirmMsg)`
- **Trecho:** `window.alert("Andamento excluído e lista reorganizada.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A190 — linha 774

- **Mensagem:** "Erro ao excluir: {...}"
- **Handler:** `deleteMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Erro ao excluir: ${e instanceof Error ? e.message : "falha"}', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A191 — linha 795

- **Mensagem:** "(dinâmico / fallback) Andamento replicado para o grupo."
- **Handler:** `replicateMutation.mutate`
- **Momento:** Validação bloqueante quando: `choice === "all"`
- **Trecho:** `window.alert( origem === "juntada" ? "Andamento replicado para as OSs juntadas." : "Andamento replicado para o grupo.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A192 — linha 809

- **Mensagem:** "Andamento salvo apenas nesta OS. O criador do vínculo foi notificado."
- **Handler:** `addMutation.mutate`
- **Momento:** Feedback de sucesso após a ação (addMutation.mutate)
- **Trecho:** `window.alert( "Andamento salvo apenas nesta OS. O criador do vínculo foi notificado.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A193 — linha 813

- **Mensagem:** "Andamento salvo apenas nesta OS."
- **Handler:** `addMutation.mutate`
- **Momento:** Feedback de sucesso após a ação (addMutation.mutate)
- **Trecho:** `window.alert("Andamento salvo apenas nesta OS.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A194 — linha 819

- **Mensagem:** "Erro ao aplicar decisão: {...}"
- **Handler:** `addMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Erro ao aplicar decisão: ${e instanceof Error ? e.message : "falha"}', );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/components/OsHomePage.tsx`

#### A195 — linha 379

- **Mensagem:** "A atualização da lista está demorando. Tente novamente em alguns segundos."
- **Handler:** `?`
- **Momento:** Validação bloqueante quando: `timedOut`
- **Trecho:** `window.alert( "A atualização da lista está demorando. Tente novamente em alguns segundos.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A196 — linha 384

- **Mensagem:** "(dinâmico / fallback) Não foi possível atualizar a lista de OSs."
- **Handler:** `?`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( err instanceof Error ? err.message : "Não foi possível atualizar a lista de OSs.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A197 — linha 642

- **Mensagem:** " ( getTextFilterMinLengthHint(filters) ?? \"Complete os filtros de texto antes de exportar.\", );"
- **Handler:** `?`
- **Momento:** Validação bloqueante quando: `textBelowMinLength`
- **Trecho:** `window.alert( getTextFilterMinLengthHint(filters) ?? "Complete os filtros de texto antes de exportar.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A198 — linha 653

- **Mensagem:** "(dinâmico / fallback) Falha ao gerar relatório."
- **Handler:** `?`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( err instanceof Error ? err.message : "Falha ao gerar relatório.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A199 — linha 903

- **Mensagem:** "Selecione uma OS."
- **Handler:** `onPrintPicker`
- **Momento:** Validação bloqueante quando: `!selected`
- **Trecho:** `window.alert("Selecione uma OS.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A200 — linha 911

- **Mensagem:** "Selecione uma OS."
- **Handler:** `onSeparador`
- **Momento:** Validação bloqueante quando: `!selected`
- **Trecho:** `window.alert("Selecione uma OS.");`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/components/OsMoverPastasModal.tsx`

#### A201 — linha 62

- **Mensagem:** "Pastas movidas com sucesso para OS {...}/{...}.\\n\\n"
- **Handler:** `onSuccess`
- **Momento:** Callback de sucesso da mutation/query
- **Trecho:** `window.alert( 'Pastas movidas com sucesso para OS ${row.nr_os}/${row.ano}.\n\n' + 'Itens: ${moved}\n' + (result.dest_folder_created ? "\nA pasta de destino foi criada na rede." : ""), );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/components/OsNotificarModal.tsx`

#### A202 — linha 124

- **Mensagem:** "Informe o andamento e o setor, ou marque todos os andamentos."
- **Handler:** `handleSave`
- **Momento:** Validação bloqueante quando: `!andamentoSituacao.trim() || !andamentoSetor.trim()`
- **Trecho:** `window.alert("Informe o andamento e o setor, ou marque todos os andamentos.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A203 — linha 138

- **Mensagem:** "Preferências salvas, mas o Windows não vai exibir o aviso. Permita notificações do navegador (Edge/Chrome) e tente de novo."
- **Handler:** `saveMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( "Preferências salvas, mas o Windows não vai exibir o aviso. Permita notificações do navegador (Edge/Chrome) e tente de novo.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A204 — linha 150

- **Mensagem:** "Preferências salvas. A notificação do Windows funciona com o SAGRA aberto neste navegador. Com o navegador fechado não está disponível nesta rede."
- **Handler:** `saveMutation.mutate`
- **Momento:** Validação bloqueante quando: `ano != null && id != null`
- **Trecho:** `window.alert( "Preferências salvas. A notificação do Windows funciona com o SAGRA aberto neste navegador. Com o navegador fechado não está disponível nesta rede.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A205 — linha 156

- **Mensagem:** "Erro ao salvar: {...}"
- **Handler:** `saveMutation.mutate`
- **Momento:** Feedback de sucesso após a ação (saveMutation.mutate)
- **Trecho:** `window.alert( 'Erro ao salvar: ${e instanceof Error ? e.message : "falha"}', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A206 — linha 186

- **Mensagem:** "Não foi possível testar: {...}"
- **Handler:** `handleTest`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Não foi possível testar: ${e instanceof Error ? e.message : "falha"}', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A207 — linha 205

- **Mensagem:** "Erro: {...}"
- **Handler:** `handleRemove`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert('Erro: ${e instanceof Error ? e.message : "falha"}');`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/components/OsOriginalFilesPanel.tsx`

#### A208 — linha 245

- **Mensagem:** "Não foi possível abrir este arquivo. Com o SAGRA Folder Opener em execução, PDF e imagens abrem no programa correspondente; outros tipos não podem ser abertos no navegador."
- **Handler:** `handleOpen`
- **Momento:** Ao executar `handleOpen`
- **Trecho:** `window.alert( "Não foi possível abrir este arquivo. Com o SAGRA Folder Opener em execução, PDF e imagens abrem no programa correspondente; outros tipos não podem ser abertos no navegador.", );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/components/OsSeparadorModal.tsx`

#### A209 — linha 144

- **Mensagem:** "(variável: parsedUntil.message)"
- **Handler:** `?`
- **Momento:** Validação bloqueante quando: `!parsedUntil.ok`
- **Trecho:** `window.alert(parsedUntil.message);`
- [ ] **REMOVER**
- [x] **MANTER**

#### A210 — linha 148

- **Mensagem:** " ( openerError ?? \"Selecione a impressora Windows que tem o papel 102 × 297 mm.\", );"
- **Handler:** `?`
- **Momento:** Validação bloqueante quando: `!printer`
- **Trecho:** `window.alert( openerError ?? "Selecione a impressora Windows que tem o papel 102 × 297 mm.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A211 — linha 171

- **Mensagem:** "(variável: printed.error)"
- **Handler:** `?`
- **Momento:** Validação bloqueante quando: `!printed.ok`
- **Trecho:** `window.alert(printed.error);`
- [ ] **REMOVER**
- [x] **MANTER**

#### A212 — linha 177

- **Mensagem:** "(dinâmico / fallback) Falha ao gerar o PDF do separador."
- **Handler:** `?`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( error instanceof Error ? error.message : "Falha ao gerar o PDF do separador.", );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/components/OsSequenciaProducaoTab.tsx`

#### A213 — linha 180

- **Mensagem:** "DOCX criado na pasta Sefoc: {...}"
- **Handler:** `createDocxMutation.mutate`
- **Momento:** Feedback de sucesso após a ação (createDocxMutation.mutate)
- **Trecho:** `window.alert('DOCX criado na pasta Sefoc: ${result.filename}');`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/components/OsVinculosEditor.tsx`

#### A214 — linha 178

- **Mensagem:** "Informe ao menos um andamento e setor."
- **Handler:** `handleSaveAndamentos`
- **Momento:** Validação bloqueante quando: `completePairs.length === 0`
- **Trecho:** `window.alert("Informe ao menos um andamento e setor.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A215 — linha 184

- **Mensagem:** "Erro ao salvar andamentos: {...}"
- **Handler:** `handleSaveAndamentos`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Erro ao salvar andamentos: ${e instanceof Error ? e.message : "falha"}', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A216 — linha 193

- **Mensagem:** "Informe número e ano válidos (ano com 2 dígitos ou 4 dígitos entre {...} e {...})."
- **Handler:** `handleAdd`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Informe número e ano válidos (ano com 2 dígitos ou 4 dígitos entre ${OS_ANO_MIN} e ${OS_ANO_MAX}).', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A217 — linha 199

- **Mensagem:** "Não é possível vincular uma OS a ela mesma."
- **Handler:** `handleAdd`
- **Momento:** Validação bloqueante quando: `pair.os === id && pair.ano === ano`
- **Trecho:** `window.alert("Não é possível vincular uma OS a ela mesma.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A218 — linha 203

- **Mensagem:** "OS {...}/{...} não encontrada."
- **Handler:** `handleAdd`
- **Momento:** Validação bloqueante quando: `!vinculoFound`
- **Trecho:** `window.alert('OS ${pair.os}/${pair.ano} não encontrada.');`
- [ ] **REMOVER**
- [x] **MANTER**

#### A219 — linha 207

- **Mensagem:** "Informe ao menos um andamento e setor que definem o comportamento do grupo."
- **Handler:** `handleAdd`
- **Momento:** Validação bloqueante quando: `!grupoId && completePairs.length === 0`
- **Trecho:** `window.alert( "Informe ao menos um andamento e setor que definem o comportamento do grupo.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A220 — linha 220

- **Mensagem:** "Erro ao vincular: {...}"
- **Handler:** `addMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Erro ao vincular: ${e instanceof Error ? e.message : "falha"}', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A221 — linha 442

- **Mensagem:** "Erro: {...}"
- **Handler:** `delMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Erro: ${e instanceof Error ? e.message : "falha"}', );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/components/RequisicaoFichaViewer.tsx`

#### A222 — linha 187

- **Mensagem:** "Aguarde o carregamento completo da ficha antes de imprimir."
- **Handler:** `onMessage`
- **Momento:** Validação bloqueante quando: `!iframe?.contentWindow`
- **Trecho:** `window.alert("Aguarde o carregamento completo da ficha antes de imprimir.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A223 — linha 322

- **Mensagem:** "Erro ao iniciar impressão: {...}"
- **Handler:** `triggerPrint`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( 'Erro ao iniciar impressão: ${e instanceof Error ? e.message : "falha desconhecida"}', );`
- [ ] **REMOVER**
- [x] **MANTER**

### `apps/web/src/features/os/hooks/useOsEditLock.ts`

#### A224 — linha 72

- **Mensagem:** " (osEditLockAlertMessage(err));"
- **Handler:** `useOsEditLock`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(osEditLockAlertMessage(err));`
- [ ] **REMOVER**
- [x] **MANTER**

#### A225 — linha 121

- **Mensagem:** " (osEditLockAlertMessage(err));"
- **Handler:** `?`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(osEditLockAlertMessage(err));`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `painel-global`

### `apps/web/src/features/painel-global/components/PainelGlobalSettingsModal.tsx`

#### A226 — linha 111

- **Mensagem:** "Máximo de 8 colunas atingido!"
- **Handler:** `addColumn`
- **Momento:** Validação bloqueante quando: `tempConfig.columns.length >= 8`
- **Trecho:** `window.alert("Máximo de 8 colunas atingido!");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A227 — linha 129

- **Mensagem:** "É necessário ter pelo menos 1 coluna!"
- **Handler:** `removeColumn`
- **Momento:** Validação bloqueante quando: `tempConfig.columns.length <= 1`
- **Trecho:** `window.alert("É necessário ter pelo menos 1 coluna!");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A228 — linha 155

- **Mensagem:** "Erro ao exportar configuração."
- **Handler:** `exportConfig`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert("Erro ao exportar configuração.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A229 — linha 171

- **Mensagem:** "✅ Configuração carregada com sucesso!   Clique em \"Salvar e Recarregar\" para aplicar as alterações ao painel."
- **Handler:** `handleImportFile`
- **Momento:** Feedback de sucesso após a ação (handleImportFile)
- **Trecho:** `window.alert( '✅ Configuração carregada com sucesso! \n\nClique em "Salvar e Recarregar" para aplicar as alterações ao painel.', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A230 — linha 176

- **Mensagem:** "❌ Falha ao importar: {...}"
- **Handler:** `handleImportFile`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( '❌ Falha ao importar: ${err instanceof Error ? err.message : "Erro desconhecido"}', );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A231 — linha 184

- **Mensagem:** "Erro ao ler o arquivo."
- **Handler:** `handleImportFile`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert("Erro ao ler o arquivo.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A232 — linha 200

- **Mensagem:** "✅ Cache limpo! Configuração padrão restaurada."
- **Handler:** `clearCache`
- **Momento:** Ao executar `clearCache`
- **Trecho:** `window.alert("✅ Cache limpo! Configuração padrão restaurada.");`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `papelaria`

### `apps/web/src/features/papelaria/components/PapelariaCartaoSvgPanel.tsx`

#### A233 — linha 164

- **Mensagem:** " (err.message || \"Erro ao exportar SVG.\");"
- **Handler:** `onError`
- **Momento:** Callback de erro da mutation/query
- **Trecho:** `window.alert(err.message || "Erro ao exportar SVG.");`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `prova-web`

### `apps/web/src/features/prova-web/ProvaWebPage.tsx`

#### A234 — linha 190

- **Mensagem:** "Não foi possível copiar o link."
- **Handler:** `handleCopyLink`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert("Não foi possível copiar o link.");`
- [ ] **REMOVER**
- [x] **MANTER**

## Feature: `settings`

### `apps/web/src/features/settings/components/SettingsModal.tsx`

#### A235 — linha 207

- **Mensagem:** "Sessão inválida. Faça login novamente."
- **Handler:** `handleCreateFilter`
- **Momento:** Validação bloqueante quando: `!ponto`
- **Trecho:** `window.alert("Sessão inválida. Faça login novamente.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A236 — linha 212

- **Mensagem:** "Digite um nome para o filtro."
- **Handler:** `handleCreateFilter`
- **Momento:** Validação bloqueante quando: `!nome`
- **Trecho:** `window.alert("Digite um nome para o filtro.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A237 — linha 222

- **Mensagem:** "Filtro salvo com sucesso."
- **Handler:** `createFilterMutation.mutate`
- **Momento:** Feedback de sucesso após a ação (createFilterMutation.mutate)
- **Trecho:** `window.alert("Filtro salvo com sucesso.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A238 — linha 224

- **Mensagem:** "(dinâmico / fallback) Erro ao salvar filtro."
- **Handler:** `createFilterMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(error instanceof Error ? error.message : "Erro ao salvar filtro.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A239 — linha 232

- **Mensagem:** "Digite um nome para o filtro."
- **Handler:** `handleUpdateFilter`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert("Digite um nome para o filtro.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A240 — linha 241

- **Mensagem:** "Filtro atualizado com sucesso."
- **Handler:** `updateFilterMutation.mutate`
- **Momento:** Feedback de sucesso após a ação (updateFilterMutation.mutate)
- **Trecho:** `window.alert("Filtro atualizado com sucesso.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A241 — linha 243

- **Mensagem:** "(dinâmico / fallback) Erro ao atualizar filtro."
- **Handler:** `updateFilterMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert( error instanceof Error ? error.message : "Erro ao atualizar filtro.", );`
- [ ] **REMOVER**
- [x] **MANTER**

#### A242 — linha 254

- **Mensagem:** "(dinâmico / fallback) Erro ao definir filtro padrão."
- **Handler:** `setDefaultMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(error instanceof Error ? error.message : "Erro ao definir filtro padrão.");`
- [ ] **REMOVER**
- [x] **MANTER**

#### A243 — linha 264

- **Mensagem:** "(dinâmico / fallback) Erro ao excluir filtro."
- **Handler:** `deleteFilterMutation.mutate`
- **Momento:** Em caso de erro/exceção na operação
- **Trecho:** `window.alert(error instanceof Error ? error.message : "Erro ao excluir filtro.");`
- [ ] **REMOVER**
- [x] **MANTER**

## Já comentados (não ativos)

- A151 `apps/web/src/features/gravacao-externa/components/GravacaoPendenteTab.tsx:427` — "Arquivos de {...} enviados para Gravação Externa."
- A158 `apps/web/src/features/gravacao-externa/components/GravacaoPendenteTab.tsx:1134` — "OS adicionada à lista de Gravação Pendente."

---

## Resumo por feature

| Feature | Qtde |
|---|---:|
| analise | 33 |
| analise-lab | 1 |
| configuracoes | 41 |
| cotas-graf | 10 |
| dashboard-setor | 3 |
| dashboard-tablet | 2 |
| email | 19 |
| gerencia | 15 |
| gravacao-externa | 33 |
| hooks | 3 |
| layout | 2 |
| lib | 1 |
| os | 64 |
| painel-global | 7 |
| papelaria | 1 |
| prova-web | 1 |
| settings | 9 |
| **TOTAL** | **245** |
