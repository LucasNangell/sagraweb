# 📋 CHANGELOG - Dashboard de Setor

## [2.1] - 16/12/2024

### 🚀 Adicionado
- **Sistema Keep-Alive Agressivo** para prevenir suspensão do monitor
- Simulação de eventos de mouse (MouseEvent invisível em 0,0)
- Simulação de eventos de teclado (tecla Shift - não invasiva)
- Simulação de micro-scroll (1px imperceptível)
- Intervalo de 25 segundos para atividade constante
- Função `startKeepAlive()` com triple-redundancy
- Função `stopKeepAlive()` para cleanup
- Variável `keepAliveInterval` para controle do timer
- Logs detalhados no console: `[Keep-Alive]`
- Documentação completa (IMPLEMENTACAO_KEEP_ALIVE.md)
- Integração automática no `onMounted()`
- Cleanup automático no `onUnmounted()`

### 🔄 Modificado
- Wake Lock agora possui 3 camadas de proteção:
  1. Wake Lock API (quando suportado)
  2. Fallback Timer (requisições HTTP)
  3. **Keep-Alive Agressivo (sempre ativo)** ⭐ NOVO
- Sistema de prevenção de suspensão mais robusto e confiável

### 🛠️ Corrigido
- **Monitores não desligam mais** durante visualização do dashboard
- Proteção adicional contra configurações agressivas de energia do Windows
- Fallback quando Wake Lock API não é suficiente

---

## [2.0] - 16/12/2024

### ✨ Adicionado
- Configuração dinâmica de quantidade de colunas (1 a 6)
- Campo numérico para ajustar quantidade de colunas
- Botão "+ Adicionar Coluna" para criar novas colunas
- Botão "🗑️ Remover" para excluir colunas específicas
- Input de texto editável para título de cada coluna
- Validação de limites (mínimo 1, máximo 6 colunas)
- Botões automaticamente desabilitados quando apropriado
- Atributo `data-columns` para controle dinâmico do grid CSS
- Layouts fixos por quantidade (1-6 colunas)
- Cards adaptativos que ajustam largura conforme quantidade de colunas
- Fontes escaláveis para 5-6 colunas
- Media queries para TV 4K (≥1920px)
- Media queries para notebooks (≤1366px)
- Media queries para telas menores (≤1024px)
- Redução automática de colunas em telas menores
- Persistência de `columnCount` no localStorage
- Função JavaScript `addColumn()`
- Função JavaScript `removeColumn(idx)`
- Função JavaScript `adjustColumns()`
- Estilos hover para botões do modal
- Estilos para inputs focus
- Modal expandido (600px → 700px)
- Scroll vertical no modal
- Documentação técnica completa (IMPLEMENTACAO_COLUNAS_DINAMICAS.md)
- Guia rápido do usuário (GUIA_RAPIDO_COLUNAS.md)
- Sistema de versionamento (VERSIONAMENTO_DASHBOARD.md)
- Backups automáticos com timestamp

### 🔄 Modificado
- IDs de colunas mudaram de nomes fixos (`entrada`, `execucao`) para dinâmicos (`col_0`, `col_1`, etc.)
- Config state agora inclui `columnCount` além de `columns[]`
- Função `loadConfig()` atualizada para suportar `columnCount`
- Grid CSS mudou de `repeat(auto-fit, minmax(280px, 1fr))` para sistema fixo com `data-columns`
- Cards mudaram de `min-width: 430px` fixo para larguras adaptativas
- Modal de configurações expandido com novos controles
- Seção de configuração de colunas reorganizada com headers
- Interface de checkboxes agrupada por coluna com melhor visual
- Return do setup Vue expandido com novas funções

### 🛠️ Corrigido
- Responsividade em telas muito grandes (4K) agora funciona corretamente
- Fontes não ficam microscópicas com muitas colunas
- Grid não quebra em resoluções extremas
- Cards mantêm proporções legíveis em todas as configurações

### ⚡ Performance
- Zero impacto na performance do WebSocket
- Animações mantêm fluidez
- LocalStorage eficiente com estrutura otimizada

### 🔒 Segurança
- Validação de inputs (min/max)
- Sanitização automática de títulos
- Deep copy para evitar mutação de estado

### 📦 Compatibilidade
- ✅ 100% compatível com V1.0 (merge automático de configs antigas)
- ✅ WebSocket funcionando
- ✅ Wake Lock API intacta
- ✅ Sistema de prioridades preservado
- ✅ Animações mantidas
- ✅ Backend sem alterações necessárias

---

## [1.0] - Anterior a 16/12/2025 (Baseline)

### Funcionalidades Base
- 4 colunas fixas hardcoded
- Configuração de setor monitorado
- Checkboxes para andamentos por coluna
- Persistência básica em localStorage
- WebSocket para atualizações em tempo real
- Animações de entrada/saída (.is-new, transition-group)
- Sistema de prioridades com cores (Prometido=vermelho, Solicitado=amarelo)
- Wake Lock API para prevenir desligamento de tela
- Auto-refresh a cada 5 segundos
- Ordenação inteligente por peso e data
- Grid responsivo com auto-fit
- Cards com tamanho fixo
- Modal de configurações básico

---

## 🔄 Migração de V1.0 para V2.0

### Automática
- Config antiga é detectada e mesclada automaticamente
- Número de colunas é inferido do array `columns[]`
- IDs antigos são preservados se existirem

### Manual (Recomendado)
1. Após atualização, abrir Settings (⚙️)
2. Explorar novos controles
3. Ajustar títulos e quantidade se desejar
4. Salvar configuração

### Rollback
```powershell
# Restaurar V1.0
Copy-Item "dashboard_setor_v1_backup_20251216_145237.html" "dashboard_setor.html" -Force
Copy-Item "dashboard_setor_v1_backup_20251216_145237.js" "dashboard_setor.js" -Force
Copy-Item "dashboard_setor_v1_backup_20251216_145237.css" "dashboard_setor.css" -Force
```

---

## 📝 Notas de Release

### V2.0 - Colunas Dinâmicas

**Objetivo:** Tornar o dashboard completamente personalizável pelo usuário final, permitindo controle total sobre quantidade, títulos e conteúdo das colunas.

**Impacto:**
- 🎨 **UX**: Interface mais flexível e poderosa
- 📱 **Responsividade**: Suporte total a TV 4K até notebooks
- 🔧 **Manutenibilidade**: Usuários não precisam editar código
- ✅ **Compatibilidade**: Zero breaking changes

**Testes Realizados:**
- ✅ Adicionar/remover colunas via botões
- ✅ Ajustar quantidade via input numérico
- ✅ Editar títulos de colunas
- ✅ Selecionar andamentos por coluna
- ✅ Persistência em localStorage
- ✅ Rollback para V1.0
- ✅ Responsividade em múltiplas resoluções
- ✅ Validação de limites
- ✅ Compatibilidade com config antiga

**Problemas Conhecidos:**
- Nenhum identificado até o momento

**Próximos Passos:**
- Monitorar feedback de usuários
- Considerar V2.1 com drag & drop

---

## 🎯 Versões Futuras (Planejamento)

### V2.1 (Potencial)
- Drag & drop para reordenar colunas
- Temas de cores personalizáveis
- Export/import de configurações
- Layouts salvos (presets: "Simples", "Completo", "Custom")

### V2.2 (Potencial)
- Filtros avançados (data, período, cliente)
- Estatísticas por coluna (média de tempo, quantidade)
- Notificações visuais/sonoras para novas OSs
- Visualização multi-setor

### V3.0 (Conceito)
- Dashboard completamente modular
- Widgets personalizáveis
- API de plugins para extensões
- Modo offline com cache avançado
- Sincronização multi-dispositivo

---

**Mantido por:** GitHub Copilot  
**Última Atualização:** 16/12/2025  
**Versão Atual:** 2.0 - Colunas Dinâmicas
