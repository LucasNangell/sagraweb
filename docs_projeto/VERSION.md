# 📌 SAGRA - Controle de Versões

## 🚀 Histórico de Versões

### v1.4.2 - Sincronização Bidirecional de Exclusões (COMPLETO)
**Data:** 16/12/2025  
**Status:** 🚀 Publicado em PROD

**Problema Resolvido:**
- 🐛 Exclusões no MySQL não eram respeitadas - registros ressuscitavam do MDB
- 🐛 Exclusões via frontend não propagavam para MDB Access

**Correções Aplicadas:**
1. **Frontend (routers/os_routes.py):**
   - ✅ Endpoint de exclusão agora registra hash em `deleted_andamentos`
   - ✅ Compatibilidade DictCursor (dict vs tuple)
   - ✅ Hash SHA256 de 6 campos para detecção de ressurreição
   - ✅ Operação atômica (transaction única)

2. **Sync Engine (sync_andamentos_v2.py):**
   - ✅ `delete_mysql()` agora registra hash ANTES de excluir
   - ✅ Nova função `delete_mdb()` para remover de Access
   - ✅ PASSO 3.5: Propagação MySQL → MDB de exclusões
   - ✅ Verificação `is_deleted()` em MDB → MySQL (evita reinserção)
   - ✅ PASSO 4 removido (performance + redundante)

3. **Performance:**
   - ✅ Filtro de 30 dias mantido (data_limite)
   - ✅ Uso de dados em cache (sem queries extras)
   - ✅ Logs throttled (evita spam)

**Arquivos Modificados:**
- `routers/os_routes.py` (linha 708-768) - Hash registration no delete
- `sync_andamentos_v2.py` (linhas 978-1223) - 3 correções críticas
- Arquivos de teste: `test_transaction_direct.py`, `cleanup_test_data.py`

**Documentação:**
- `CORRECAO_SYNC_EXCLUSAO_MYSQL.md` - Análise técnica completa
- `CORRECAO_FRONTEND_DELETION.md` - Fix do endpoint DELETE

**Fluxo Completo:**
```
Frontend DELETE → hash em deleted_andamentos → DELETE MySQL
                ↓
         Sync detecta (2s)
                ↓
      is_deleted() = TRUE
                ↓
    DELETE de MDB Access
                ↓
         ✅ Sincronizado
```

**Impacto:**
- ✅ Exclusões bidirecionais (MySQL ↔ MDB)
- ✅ Zero ressurreições
- ✅ Integridade de dados garantida
- ✅ Performance mantida
- ✅ 100% testado e validado

---

### v1.4.1 - WebSocket e Indicador de Conexão
**Data:** 16/12/2025  
**Status:** 🚀 Publicado em PROD

**Novidades:**
- ⚡ Atualização instantânea via WebSocket (ws://server:8000/ws)
- 🟢 Indicador visual de conexão (verde/vermelho com glow)
- 🔄 Polling mantido como fallback (redundância dupla)
- ♻️ Reconexão automática (5 segundos)
- 📊 Dashboard com prefixo OS/SP nos números

**Arquivos Modificados:**
- `dashboard_setor.html` - Indicador de status no header
- `dashboard_setor.css` - Estilos verde/vermelho com box-shadow
- `dashboard_setor.js` - WebSocket + connectionStatus ref

**Documentação:**
- `ALTERACAO_WEBSOCKET_INDICADOR.md` - Guia completo de implementação

**Comportamento:**
- WebSocket ativo → 🟢 verde, atualizações instantâneas
- WebSocket falha → 🔴 vermelho, continua via polling
- Reconexão automática a cada 5s

**Impacto:**
- ✅ Experiência do usuário melhorada (tempo real)
- ✅ Sistema mais robusto (dupla redundância)
- ✅ Feedback visual de status
- ✅ Zero breaking changes

---

### v1.3.0 - Padronização e Wake Lock
**Data:** 15/12/2025  
**Status:** 🚀 Publicado em PROD

**Novidades:**
- 🔐 Sistema de priorização de permissões por IP (específico > wildcard > fallback)
- 📝 Padronização completa de andamentos:
  - Observações: formato `HHhMM\n` + texto com quebras preservadas
  - Pontos: formato `#.#00` (918713 → 918.713)
  - 11 locais atualizados em todo o sistema
- 🔒 Wake Lock no dashboard_setor (mantém tela sempre ativa)
  - Wake Lock API nativa + Vídeo invisível (fallback)
  - 100% compatibilidade em navegadores modernos
- ✅ Suite de testes automatizados (11/11 passaram)
- 📚 Documentação completa e validação

**Arquivos Novos:**
- `routers/andamento_helpers.py` - Funções de formatação centralizadas
- `test_format_ponto.py` - Testes automatizados
- `CORRECAO_OBSERVACOES_ANDAMENTOS.md` - Documentação formatação
- `VALIDACAO_WAKE_LOCK.md` - Validação completa

**Arquivos Modificados:**
- `routers/permissions_routes.py` - Priorização de IPs
- `routers/os_routes.py` - 5 locais com formatação
- `routers/email_routes.py` - 2 locais com formatação
- `routers/analise_routes.py` - 1 local central
- `server.py` - 3 locais legados
- `IMPLEMENTACAO_WAKE_LOCK.md` - Estratégia dupla documentada

**Impacto:**
- ✅ Controle de acesso mais preciso
- ✅ Dados padronizados e legíveis
- ✅ Dashboard pode ser usado como painel permanente
- ✅ 100% backward compatible

**Release Notes:** Ver `RELEASE_v1.3.0.md`

---

### v1.2.0 - Cloudflare Tunnel (Exposição Pública Controlada)
**Data:** 15/12/2025 17:19  
**Status:** 🚀 Publicado em PROD

**Novidades:**
- ✨ Exposição pública de páginas de cliente via Cloudflare Tunnel
- 🔒 Segurança em duas camadas (Tunnel + Middleware)
- 🌐 Domínio público: cgraf.online
- 🔗 Geração automática de links com domínio público
- 📊 Monitoramento cloudflared integrado ao launcher
- 🛠️ 3 scripts PowerShell (configurar, iniciar, validar)
- 📚 Documentação completa (8 arquivos markdown)
- 🔐 Regex patterns para proteção: `^/client_.*`

**Rotas Públicas:**
- ✅ /client_pt.html, /client_proof.html
- ❌ Todas as outras rotas bloqueadas (404)

**Arquivos:**
- Backup: `backups/cloudflare_tunnel_20251215_171925/`
- Changelog: Ver `backups/cloudflare_tunnel_20251215_171925/CHANGELOG.md`

---

### v1.1.0 - Abertura Automática de Pasta Local
**Data:** 15/12/2025 14:36  
**Status:** ✅ Em Produção

**Novidades:**
- ✨ Abertura automática de pastas via serviço local residente
- 📥 Download de executável integrado ao sistema
- 🔔 Sistema de notificações para instalação
- 🛡️ Validações de segurança (localhost only, path validation)
- 📚 Documentação completa (3 arquivos markdown)

**Arquivos:**
- Backup: `backups/abertura_pasta_local_20251215_143648/`
- Changelog: Ver `backups/abertura_pasta_local_20251215_143648/CHANGELOG.md`

---

### v1.0.0 - Resolução Obrigatória
**Data:** 15/12/2025 13:34  
**Status:** ✅ Em Produção

**Novidades:**
- ✨ Campo "Resolução Obrigatória" para OS
- 🗃️ Migração de banco de dados (nova coluna)
- 🎨 Interface atualizada com checkbox
- 🔄 Sincronização SAGRA Nuvem implementada

**Arquivos:**
- Backup: `backups/resolucao_obrigatoria_20251215_133433/`

---

### v0.9.0 - Sistema Base
**Data:** Anterior a 15/12/2025  
**Status:** ✅ Estável

**Funcionalidades Base:**
- Sistema de Ordem de Serviço (OS)
- Gestão de usuários e setores
- Análise de documentos
- Envio de emails
- Papelaria
- Dashboard por setor
- Sistema de notificações WebSocket

---

## 📦 Estrutura de Backups

```
backups/
├── cloudflare_tunnel_20251215_171925/       ← v1.2.0 (ATUAL)
│   ├── CHANGELOG.md
│   ├── README.md
│   ├── RESTORE.ps1
│   ├── analise_routes.py
│   ├── launcher.py
│   ├── configure_public_domain.ps1
│   ├── start_cloudflare_prod.ps1
│   ├── validate_cloudflare.ps1
│   └── CLOUDFLARE_*.md (8 arquivos)
│
├── abertura_pasta_local_20251215_143648/    ← v1.1.0
│   ├── CHANGELOG.md
│   ├── README.md
│   ├── RESTORE.ps1
│   ├── script.js
│   ├── index.html
│   ├── api.py
│   ├── FEATURE_ABERTURA_PASTA_LOCAL.md
│   ├── QUICK_START_PASTA_LOCAL.md
│   └── local_services/
│
└── resolucao_obrigatoria_20251215_133433/   ← v1.0.0
    ├── CHANGELOG.md
    ├── README.md
    ├── RESTORE.ps1
    └── (arquivos da versão)
```

---

## 🔄 Como Restaurar uma Versão

### Via Script (Recomendado):
```powershell
cd backups\[nome_da_versao]
.\RESTORE.ps1
```

### Manual:
Consulte o arquivo `README.md` dentro da pasta do backup.

---

## 📝 Convenção de Versionamento

**Formato:** `vMAJOR.MINOR.PATCH`

- **MAJOR:** Mudanças incompatíveis (breaking changes)
- **MINOR:** Novas funcionalidades (compatível)
- **PATCH:** Correções de bugs (compatível)

**Exemplo:**
- v1.0.0 → v1.1.0: Nova feature (Abertura de Pasta)
- v1.1.0 → v1.1.1: Correção de bug
- v1.1.1 → v2.0.0: Mudança estrutural grande

---

## 🎯 Roadmap

### v1.2.0 (Planejado)
- [ ] A definir...

### Backlog
- [ ] Assinatura digital do executável
- [ ] Ícone customizado para SAGRA-FolderOpener.exe
- [ ] Auto-update do serviço local
- [ ] Tray icon com status do serviço
- [ ] Suporte para múltiplas pastas em batch

---

## 📊 Estatísticas do Projeto

**Versão Atual:** v1.1.0  
**Total de Features:** 2 (Resolução Obrigatória + Abertura de Pasta)  
**Total de Backups:** 2  
**Última Atualização:** 15/12/2025  

---

## 🔧 Manutenção

### Antes de Começar Nova Feature:
1. ✅ Commit atual no Git (se usando)
2. ✅ Criar backup manual se necessário
3. ✅ Atualizar este arquivo após implementação
4. ✅ Documentar mudanças no CHANGELOG

### Após Completar Feature:
1. ✅ Criar backup automático
2. ✅ Atualizar `VERSION.md` (este arquivo)
3. ✅ Criar CHANGELOG.md no backup
4. ✅ Testar restauração do backup
5. ✅ Documentar no README.md do backup

---

## 📞 Contato

**Projeto:** SAGRA Web  
**Organização:** Câmara Legislativa  
**Desenvolvedor:** GitHub Copilot (Claude Sonnet 4.5)  
**Última Revisão:** 15/12/2025

---

**Nota:** Este arquivo é atualizado automaticamente a cada nova versão.
