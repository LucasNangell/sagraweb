---
name: Notificações e controle chapas
overview: Restringir notificações nativas do navegador a situações de erro, substituir os avisos internos de início/conclusão da gravação por e-mails configuráveis e ajustar a lista de controle de chapas, incluindo edição protegida da NF e exclusão permanente com permissão própria. O débito normal da cota será mantido na conclusão, pois a consulta atual já contabiliza somente gravações com status `concluida`; a exclusão do lançamento recalculará a cota automaticamente.
todos:
  - id: browser-errors-only
    content: Separar canais e limitar Web Push/toast nativo a situações de erro
    status: completed
  - id: gravacao-email-config
    content: Adicionar modelos e configurações de destinatário distintas para início e conclusão
    status: completed
  - id: replace-inapp-email
    content: Substituir notificações in-app de gravação pelos e-mails via remetente de ativação
    status: completed
  - id: controle-table-ui
    content: Reordenar/renomear colunas e proteger edição de Pagamento NF
    status: completed
  - id: controle-delete-permission
    content: Criar permissão, endpoint e UI para exclusão permanente do lançamento
    status: completed
  - id: quota-tests-verification
    content: Confirmar débito na conclusão, reajuste na exclusão e executar validações
    status: completed
isProject: false
---

# Notificações e controle de chapas

## 1. Notificação nativa somente para erro

- Em [app/backend/services/os_notificacao_dispatch_service.py](app/backend/services/os_notificacao_dispatch_service.py), separar o registro/notificação interna do canal nativo e classificar centralmente como erro as situações de andamento com semântica de falha (`Erro`, `Falha`, `Problema Técnico` e cancelamento). Andamentos normais ou concluídos continuam disponíveis no sistema, mas não geram Web Push.
- Incluir no payload WebSocket um indicador explícito de notificação nativa e, em [apps/web/src/features/os/components/OsNotificationHandler.tsx](apps/web/src/features/os/components/OsNotificationHandler.tsx), chamar `showOsWatchNativeToast` somente quando esse indicador for de erro. Isso cobre tanto aba aberta quanto fechada sem depender de texto no frontend.
- Preservar os alertas visuais de falha das operações e testar a classificação para impedir que `Entregue`, `Saída`, `Recebido`, `Gravação Externa` e demais sucessos voltem a disparar toast nativo.

## 2. E-mails de início e conclusão da gravação

- Criar dois modelos de sistema distintos (`gravacao_iniciada` e `gravacao_concluida`) em [app/backend/services/email_template_service.py](app/backend/services/email_template_service.py), ambos usando `mailbox_key="activation"`, portanto o mesmo remetente configurado para ativação de conta e recuperação de senha.
- Persistir configuração separada por evento na configuração global de e-mail:
  - modo de destino `usuario` ou `personalizado`;
  - lista de endereços personalizados para aquele evento;
  - conteúdo/assunto editáveis pelos modelos existentes.
- Expor os novos campos nos contratos e endpoints de [app/backend/routers/admin_system_routes.py](app/backend/routers/admin_system_routes.py), [apps/web/src/api/adminSystem.ts](apps/web/src/api/adminSystem.ts) e [apps/web/src/features/configuracoes/types.ts](apps/web/src/features/configuracoes/types.ts).
- Em [apps/web/src/features/configuracoes/components/EmailTemplatesSection.tsx](apps/web/src/features/configuracoes/components/EmailTemplatesSection.tsx), adicionar configuração independente para “Gravação iniciada” e “Gravação concluída”, permitindo escolher:
  - e-mail cadastrado do usuário destinatário; ou
  - endereços personalizados configurados para o evento.
- Criar um serviço de envio de gravação externa que resolva o e-mail do usuário lançador quando o modo for `usuario`, valide/deduplicate destinatários e envie via EWS com o remetente de ativação. Falha de e-mail será registrada sem desfazer a alteração de status da gravação.
- Em [app/backend/services/gravacao_externa_service.py](app/backend/services/gravacao_externa_service.py), remover `insert_user_notification` e `push_user_notification` dos eventos `gravacao_externa_iniciada` e `gravacao_externa_concluida`, substituindo-os pelo novo envio de e-mail. Manter os eventos WebSocket de ciclo de vida (`push_gravacao_externa_iniciada/concluida`) exclusivamente para atualização das telas, sem popup de sistema.

## 3. Lista de controle de chapas

- Em [apps/web/src/features/gravacao-externa/components/GravacaoPendenteTab.tsx](apps/web/src/features/gravacao-externa/components/GravacaoPendenteTab.tsx), alterar a tabela expandida para esta ordem e nomenclatura relevante:
  - `Chapas / máquina`;
  - `Disp. p/ Gravação` (campo atual `criado_em`, movido para logo após chapas);
  - `Saída p/ Birô`;
  - `Grav. Concluída`;
  - `Receb. CGRAF`;
  - `Recebido por`.
- Aplicar `Grav. Concluída` também à coluna equivalente da visualização recolhida.
- Tornar “Pagamento NF” bloqueado por padrão. Adicionar ação de editar ao lado; ao habilitar, exibir o campo de data e botões explícitos de salvar/cancelar. Após salvar, bloquear novamente e atualizar a consulta; não salvar mais implicitamente no `blur`.

## 4. Exclusão permanente e permissão

- Adicionar a permissão específica `sb_gravacao_pendente_excluir` em schemas, contratos e persistência de permissões de usuário/IP: [app/backend/user_auth_schema.py](app/backend/user_auth_schema.py), [app/backend/ip_permissions_schema.py](app/backend/ip_permissions_schema.py), [app/backend/security/user_permissions.py](app/backend/security/user_permissions.py), [app/backend/schemas/permissions.py](app/backend/schemas/permissions.py), [app/backend/routers/user_admin_routes.py](app/backend/routers/user_admin_routes.py) e [app/backend/routers/ip_admin_routes.py](app/backend/routers/ip_admin_routes.py).
- Exibir a opção “Excluir lançamento do controle de chapas” na página de usuários em [apps/web/src/features/usuarios/components/UserAdminPanel.tsx](apps/web/src/features/usuarios/components/UserAdminPanel.tsx).
- Criar endpoint `DELETE /gravacao-pendente/controle/{gravacao_pendente_id}` em [app/backend/routers/gravacao_pendente_routes.py](app/backend/routers/gravacao_pendente_routes.py), exigindo simultaneamente acesso a gravações pendentes e a nova permissão de exclusão.
- Em [app/backend/services/gravacao_pendente_service.py](app/backend/services/gravacao_pendente_service.py), apagar permanentemente somente a linha correspondente de `tab_os_gravacao_pendente`, conforme definido. Não apagar a OS principal, a sessão externa nem os demais registros relacionados.
- Adicionar botão de lixeira apenas para usuários autorizados, com confirmação explícita de ação irreversível. Após excluir, invalidar histórico e resumo de cota.
- Como a cota é calculada pela junção com o lançamento pendente, a exclusão retira automaticamente essas chapas do total contabilizado e devolve o saldo; cobrir esse efeito em teste.

## 5. Débito de cota e verificação

- Manter em [app/backend/services/gravacao_pendente_service.py](app/backend/services/gravacao_pendente_service.py) a regra atual `ge.Status = 'concluida'`: pendente, envio e início não debitam; a conclusão passa a contabilizar as chapas.
- Adicionar/atualizar testes backend para:
  - sucesso sem Web Push e erro com Web Push;
  - destinatários separados por tipo, remetente de ativação e ausência das notificações in-app;
  - autorização e exclusão permanente do lançamento;
  - cota debitada na conclusão e reajustada após exclusão.
- Adicionar testes frontend para ordem/rótulos das colunas, bloqueio/edição/salvamento da NF, visibilidade da exclusão por permissão e configuração independente dos dois e-mails.
- Executar testes focados de backend e frontend, `pnpm typecheck` e verificação independente do fluxo multiarquivo.