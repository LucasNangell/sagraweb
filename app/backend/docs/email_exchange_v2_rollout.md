# Email Exchange Config V2 - Rollout e Observabilidade

## Objetivo

Ativar as novas configuracoes de monitoramento e roteamento de enviados por usuario/ponto sem regressao do fluxo atual.

## Estrategia de rollout

1. **Deploy backend compativel**
   - Endpoints `/email/config`, `/email/config/send-plan` e `send-pt` com fallback legado ativo.
   - Campos V2 opcionais: `send_routing`, `sent_folder_routing`, `config_version`.
2. **Piloto controlado**
   - Habilitar uso de configuracao V2 para um pequeno conjunto de pontos (usuarios-piloto).
   - Validar operacao por 2 dias uteis.
3. **Expansao gradual**
   - Aumentar lote de usuarios em ondas (10% -> 25% -> 50% -> 100%).
4. **Padrao operacional**
   - V2 como preferencia, mantendo fallback legado indefinidamente para resiliencia.

## Indicadores de saude

- **Taxa de fallback de pasta de enviados** (`routing.used_default_sent_items = true`).
- **Erros de localizacao de pasta** (`routing.fallback_reason` preenchido).
- **Taxa de sucesso de envio `send-pt`** por tipo (`pt`, `proof`, `apogee`, `reply`).
- **Latencia media** de `POST /email/send-pt` e `POST /email/config/send-plan`.
- **Erros de EWS** por mailbox de origem.

## Checklist de aceitacao por onda

- [ ] Usuario consegue visualizar contas monitoradas na tela de configuracao.
- [ ] Usuario consegue adicionar/remover pastas monitoradas por conta.
- [ ] Usuario consegue configurar conta e pasta de enviados por tipo.
- [ ] Envio sem configuracao V2 continua funcionando (fallback legado).
- [ ] Mensagens sao salvas em pasta configurada quando existente.
- [ ] Quando pasta nao existe, envio continua e usa Sent Items padrao.

## Procedimento de rollback

1. Orientar usuarios a limpar roteamento V2 (se necessario).
2. Operar somente com campos legados (`send_mailbox_os_lt_5000`, `send_mailbox_os_gte_5000`).
3. Confirmar que `send-pt` segue enviando com `routing.used_default_sent_items = true` quando aplicavel.
4. Investigar inconsistencias em configuracoes por ponto antes de nova tentativa.

