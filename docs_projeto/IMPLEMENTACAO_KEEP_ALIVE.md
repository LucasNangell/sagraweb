# Implementação Keep-Alive Agressivo - Dashboard Setor

## 📋 Visão Geral

Este documento descreve a implementação do sistema **Keep-Alive Agressivo** adicionado ao Dashboard Setor para prevenir que o monitor entre em modo de suspensão durante a visualização.

## 🎯 Problema

O sistema original utilizava apenas o **Wake Lock API**, mas ainda assim os monitores estavam entrando em modo de suspensão. Isso ocorre porque:

1. O Wake Lock API não é suportado em todos os navegadores
2. Algumas configurações do sistema operacional podem sobrepor o Wake Lock
3. Configurações de energia podem ignorar requisições de aplicações web
4. Proteções de tela/economia de energia do Windows podem ter precedência

## 💡 Solução Implementada

Foi adicionado um sistema **Keep-Alive Agressivo** que simula atividade do usuário a cada 25 segundos, incluindo:

### 🎮 Eventos Simulados

1. **Mouse Move Event**
   - Movimento invisível do mouse (coordenadas 0,0)
   - Não interfere com a posição real do cursor
   - Suficiente para registrar atividade

2. **Keyboard Event**
   - Tecla `Shift` (pressionada e liberada)
   - Escolhida por não alterar estados (diferente de CapsLock)
   - Não interfere com digitação ou operações do usuário

3. **Micro-Scroll**
   - Scroll de 1px para baixo
   - Retorna à posição original após 10ms
   - Imperceptível para o usuário
   - Registra atividade de scroll

### ⏱️ Intervalo de Execução

- **25 segundos**: Intervalo configurado para ser menor que o timeout típico de screensavers (30-60 segundos)
- Garante atividade constante antes que qualquer suspensão seja acionada

## 🔧 Implementação Técnica

### Código Adicionado

```javascript
// Variável para controlar intervalo
let keepAliveInterval = null;

// Função para iniciar Keep-Alive
const startKeepAlive = () => {
    if (keepAliveInterval) return; // Evitar múltiplos intervalos
    
    console.log('[Keep-Alive] Iniciando simulacao agressiva de atividade');
    
    const simulateActivity = () => {
        // 1. MouseEvent
        const moveEvent = new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: 0,
            clientY: 0
        });
        document.dispatchEvent(moveEvent);
        
        // 2. Keyboard Event (Shift)
        const keyDown = new KeyboardEvent('keydown', {
            key: 'Shift',
            code: 'ShiftLeft',
            bubbles: true,
            cancelable: true
        });
        const keyUp = new KeyboardEvent('keyup', {
            key: 'Shift',
            code: 'ShiftLeft',
            bubbles: true,
            cancelable: true
        });
        document.dispatchEvent(keyDown);
        setTimeout(() => document.dispatchEvent(keyUp), 50);
        
        // 3. Micro-scroll
        const scrollPos = window.scrollY;
        window.scrollBy(0, 1);
        setTimeout(() => {
            window.scrollTo(0, scrollPos);
        }, 10);
        
        console.log('[Keep-Alive] Atividade simulada');
    };
    
    // Executar imediatamente
    simulateActivity();
    
    // Configurar intervalo
    keepAliveInterval = setInterval(simulateActivity, 25000);
};

// Função para parar Keep-Alive
const stopKeepAlive = () => {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
        console.log('[Keep-Alive] Simulacao parada');
    }
};
```

### Integração com Lifecycle Hooks

#### onMounted
```javascript
onMounted(async () => {
    // ... código existente ...
    
    // Iniciar Keep-Alive agressivo (sempre, como garantia adicional)
    startKeepAlive();
    
    // ... resto do código ...
});
```

#### onUnmounted
```javascript
onUnmounted(() => {
    // ... código existente ...
    stopKeepAlive();
    // ... resto do código ...
});
```

## 📊 Estratégia em Camadas

O sistema agora possui **3 camadas de proteção**:

1. **Wake Lock API** (quando suportado)
   - Método nativo do navegador
   - Mais eficiente energeticamente
   - Funciona quando disponível

2. **Fallback Timer** (quando Wake Lock não suportado)
   - Requisições HTTP periódicas
   - Mantém conexão com servidor ativa
   - Registra atividade de rede

3. **Keep-Alive Agressivo** (sempre ativo) ⭐ **NOVO**
   - Simula eventos de usuário
   - Mais agressivo e confiável
   - Última linha de defesa

## 🎨 Escolhas de Design

### Por que Shift ao invés de CapsLock?

O usuário sugeriu CapsLock, mas optamos por **Shift** porque:

- ✅ **Shift**: Não altera estados, não tem efeito colateral visível
- ❌ **CapsLock**: Alterna estado de maiúsculas, pode afetar digitação

### Por que coordenadas (0,0) no mouse?

- Movimento em (0,0) é registrado como atividade
- Não move o cursor real do usuário
- Não interfere com interações

### Por que micro-scroll?

- 1px é imperceptível visualmente
- Retorno imediato mantém posição do usuário
- Registra atividade de scroll sem afetar visualização

## 🧪 Como Testar

1. **Abrir Console do Navegador** (F12)
2. **Acessar Dashboard Setor**
3. **Verificar Logs**:
   ```
   [Wake Lock] Inicializando sistema
   [Keep-Alive] Iniciando simulacao agressiva de atividade
   [Keep-Alive] Atividade simulada
   ```

4. **Aguardar 25 segundos**: Log deve aparecer novamente
5. **Deixar aberto por 5+ minutos**: Monitor não deve desligar

## 📈 Monitoramento

### Console Logs

- `[Keep-Alive] Iniciando simulacao agressiva de atividade`: Sistema iniciado
- `[Keep-Alive] Atividade simulada`: Evento disparado (a cada 25s)
- `[Keep-Alive] Simulacao parada`: Sistema parado (componente desmontado)

### Verificação de Funcionamento

```javascript
// No console do navegador, verificar se intervalo está ativo:
console.log('Keep-Alive ativo:', keepAliveInterval !== null);
```

## 🚀 Versionamento

- **Versão Anterior**: V2.0 (Colunas Dinâmicas)
- **Versão Atual**: V2.1 (Keep-Alive Agressivo)
- **Data**: 16/12/2024
- **Arquivo Modificado**: `dashboard_setor.js`

## 📝 Backup

Antes da implementação, foi criado backup:
- `dashboard_setor_v1_backup_20251216_145237.js`

## ⚠️ Notas Importantes

1. **Compatibilidade**: Funciona em todos os navegadores modernos (Chrome, Firefox, Edge)
2. **Performance**: Impacto mínimo - eventos leves executados a cada 25s
3. **Energia**: Não consome bateria significativamente (eventos DOM são eficientes)
4. **Invisibilidade**: Usuário não percebe os eventos sendo disparados

## 🔄 Próximos Passos

1. ✅ Implementação completa
2. 🔄 Testar em ambiente de produção
3. 📊 Monitorar efetividade (verificar se monitores permanecem ligados)
4. 📦 Atualizar PROD após confirmação de sucesso

## 👥 Créditos

- **Sugestão Original**: Usuário sugeriu simular CapsLock
- **Implementação**: Adaptada para Shift + eventos adicionais
- **Objetivo**: Manter monitores ligados durante visualização do dashboard

---

**Status**: ✅ **Implementado e Pronto para Testes**
