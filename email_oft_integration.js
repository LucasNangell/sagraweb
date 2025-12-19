/**
 * email_oft_integration.js
 * 
 * Integração completa do fluxo de emails de Problemas Técnicos com template .OFT
 * 
 * Inclui:
 * - Finalização de análise e geração de HTML
 * - Envio de email com template .OFT
 * - Logging e tratamento de erros
 */

// Configuração - Detectar porta dinamicamente
const SAGRA_API_PORT = typeof window.SAGRA_API_PORT !== 'undefined' ? window.SAGRA_API_PORT : 8001;
const API_BASE = `http://localhost:${SAGRA_API_PORT}`;
const LOGGER_PREFIX = '[PT Email OFT]';

console.log(`${LOGGER_PREFIX} Inicializando... Conectando em ${API_BASE}`);

// ==========================================
// PARTE 1: INTEGRAÇÃO COM analise.html
// ==========================================

/**
 * Chamada ao clicar em "Concluir" na tela de análise
 * Deve substituir ou ser integrada à função existente de conclusão de análise
 */
async function finalizarAnaliseComOFT() {
    console.log(`${LOGGER_PREFIX} Iniciando finalização de análise...`);
    
    try {
        // Validar dados obrigatórios
        if (typeof OS_ID === 'undefined' || typeof ANO === 'undefined') {
            console.error(`${LOGGER_PREFIX} Erro: OS_ID ou ANO não definidos`);
            alert('Erro: Dados da OS não encontrados');
            return false;
        }
        
        const os_id = parseInt(OS_ID);
        const ano = parseInt(ANO);
        const versao = "1"; // Ou obter do formulário se necessário
        
        console.log(`${LOGGER_PREFIX} Finalizando análise para OS ${os_id}/${ano}`);
        
        // Mostrar loading
        showLoadingIndicator('Gerando HTML dos problemas técnicos...');
        
        // Chamar rota de finalização
        const response = await fetch(
            `${API_BASE}/api/analise/finalize/${ano}/${os_id}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    versao: versao
                })
            }
        );
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Erro ao finalizar análise');
        }
        
        const result = await response.json();
        
        hideLoadingIndicator();
        
        console.log(`${LOGGER_PREFIX} Sucesso:`, result);
        
        // Feedback ao usuário
        alert(`✓ ${result.message}\n\nO HTML foi gerado e está pronto para envio.`);
        
        // Armazenar informações para uso posterior no envio
        sessionStorage.setItem('pt_html_gerado', JSON.stringify({
            os_id: os_id,
            ano: ano,
            versao: versao,
            data_geracao: new Date().toISOString()
        }));
        
        console.log(`${LOGGER_PREFIX} HTML salvo em banco de dados com sucesso`);
        
        // Opcional: Redirecionar para tela de email
        // window.location.href = 'email.html';
        
        return true;
        
    } catch (error) {
        hideLoadingIndicator();
        console.error(`${LOGGER_PREFIX} Erro ao finalizar análise:`, error);
        alert(`Erro ao finalizar análise: ${error.message}`);
        return false;
    }
}

// ==========================================
// PARTE 2: INTEGRAÇÃO COM email.html
// ==========================================

/**
 * Envia email de Problemas Técnicos usando template .OFT
 * Deve ser chamada quando tipo de email for "pt" (não "proof")
 */
async function enviarEmailPTComOFT(os_id, ano, versao, destinatarios_array, ponto = "SEFOC") {
    console.log(`${LOGGER_PREFIX} Iniciando envio de email PT com template .OFT...`);
    
    try {
        // Validar inputs
        if (!os_id || !ano || !destinatarios_array || destinatarios_array.length === 0) {
            throw new Error('Parâmetros obrigatórios faltando');
        }
        
        if (!versao) {
            versao = "1";
        }
        
        console.log(`${LOGGER_PREFIX} Configuração: OS ${os_id}/${ano}, v${versao}, ${destinatarios_array.length} destinatários`);
        
        // Mostrar loading
        showLoadingIndicator('Preparando email de Problemas Técnicos...');
        
        // Corpo da requisição
        const payload = {
            os: parseInt(os_id),
            ano: parseInt(ano),
            versao: versao,
            to: destinatarios_array,
            ponto: ponto,
            type: "pt"  // Essencial para usar template .OFT
        };
        
        console.log(`${LOGGER_PREFIX} Payload da requisição:`, payload);
        
        // Enviar email
        const response = await fetch(
            `${API_BASE}/api/email/send-pt`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            }
        );
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Erro ao enviar email');
        }
        
        const result = await response.json();
        
        hideLoadingIndicator();
        
        console.log(`${LOGGER_PREFIX} Email enviado com sucesso:`, result);
        
        // Feedback detalhado
        let mensagem = `✓ Email enviado com sucesso!\n\n`;
        mensagem += `Assunto: ${result.subject}\n`;
        mensagem += `Destinatários: ${destinatarios_array.join(', ')}\n`;
        mensagem += `Remetente: ${result.used_account}`;
        
        if (result.attachments && result.attachments.length > 0) {
            mensagem += `\nAnexos: ${result.attachments.join(', ')}`;
        }
        
        alert(mensagem);
        
        // Registrar sucesso em log
        const logEntry = {
            timestamp: new Date().toISOString(),
            tipo: 'pt',
            os: os_id,
            ano: ano,
            destinatarios: destinatarios_array,
            status: 'sucesso'
        };
        saveEmailLog(logEntry);
        
        return true;
        
    } catch (error) {
        hideLoadingIndicator();
        console.error(`${LOGGER_PREFIX} Erro ao enviar email:`, error);
        alert(`Erro ao enviar email: ${error.message}`);
        
        // Registrar erro em log
        const logEntry = {
            timestamp: new Date().toISOString(),
            tipo: 'pt',
            os: os_id,
            ano: ano,
            destinatarios: destinatarios_array,
            status: 'erro',
            erro: error.message
        };
        saveEmailLog(logEntry);
        
        return false;
    }
}

/**
 * Wrapper que detecta o tipo de email e chama a função apropriada
 * Use esta função como handler principal do botão de envio
 */
async function enviarEmailComDeteccao(tipo_email, os_id, ano, versao, destinatarios, ponto) {
    console.log(`${LOGGER_PREFIX} Detectado tipo de email: ${tipo_email}`);
    
    if (tipo_email === 'pt' || tipo_email === 'problemas_tecnicos') {
        // Usar template .OFT
        return await enviarEmailPTComOFT(os_id, ano, versao, destinatarios, ponto);
    } else if (tipo_email === 'proof') {
        // Usar HTML inline (comportamento existente)
        return await enviarEmailProof(os_id, ano, versao, destinatarios, ponto);
    } else {
        console.error(`${LOGGER_PREFIX} Tipo de email desconhecido: ${tipo_email}`);
        alert(`Tipo de email não suportado: ${tipo_email}`);
        return false;
    }
}

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

/**
 * Exibe indicador de carregamento
 */
function showLoadingIndicator(message = 'Processando...') {
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-indicator';
    loadingDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        z-index: 9999;
        text-align: center;
        font-family: Arial, sans-serif;
    `;
    
    loadingDiv.innerHTML = `
        <div style="margin-bottom: 15px;">
            <div class="spinner" style="
                display: inline-block;
                width: 40px;
                height: 40px;
                border: 4px solid #f3f3f3;
                border-top: 4px solid #3498db;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            "></div>
        </div>
        <p style="margin: 0; color: #333;">${message}</p>
    `;
    
    // Adicionar CSS animation
    if (!document.querySelector('style[data-loading-spinner]')) {
        const style = document.createElement('style');
        style.setAttribute('data-loading-spinner', '');
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(loadingDiv);
}

/**
 * Esconde indicador de carregamento
 */
function hideLoadingIndicator() {
    const loading = document.getElementById('loading-indicator');
    if (loading) {
        loading.remove();
    }
}

/**
 * Salva log de email em localStorage
 */
function saveEmailLog(logEntry) {
    try {
        let logs = [];
        const existing = localStorage.getItem('email_logs');
        if (existing) {
            logs = JSON.parse(existing);
        }
        
        logs.push(logEntry);
        
        // Manter apenas últimos 100 logs
        if (logs.length > 100) {
            logs = logs.slice(-100);
        }
        
        localStorage.setItem('email_logs', JSON.stringify(logs));
        console.log(`${LOGGER_PREFIX} Log salvo em localStorage`);
    } catch (error) {
        console.warn(`${LOGGER_PREFIX} Erro ao salvar log:`, error);
    }
}

/**
 * Recupera logs de email do localStorage
 */
function getEmailLogs(filtro = null) {
    try {
        const existing = localStorage.getItem('email_logs');
        let logs = existing ? JSON.parse(existing) : [];
        
        if (filtro) {
            logs = logs.filter(log => {
                if (filtro.status && log.status !== filtro.status) return false;
                if (filtro.tipo && log.tipo !== filtro.tipo) return false;
                if (filtro.os && log.os !== filtro.os) return false;
                return true;
            });
        }
        
        return logs;
    } catch (error) {
        console.error(`${LOGGER_PREFIX} Erro ao recuperar logs:`, error);
        return [];
    }
}

/**
 * Limpa logs de email
 */
function clearEmailLogs() {
    localStorage.removeItem('email_logs');
    console.log(`${LOGGER_PREFIX} Logs limpos`);
}

/**
 * Exibe relatório de logs
 */
function showEmailLogsReport() {
    const logs = getEmailLogs();
    
    if (logs.length === 0) {
        alert('Nenhum log de email disponível');
        return;
    }
    
    let report = 'RELATÓRIO DE EMAILS\n';
    report += '==================\n\n';
    
    const sucessos = logs.filter(l => l.status === 'sucesso').length;
    const erros = logs.filter(l => l.status === 'erro').length;
    
    report += `Total: ${logs.length} | Sucessos: ${sucessos} | Erros: ${erros}\n\n`;
    report += '--- Últimos 10 Eventos ---\n';
    
    logs.slice(-10).reverse().forEach(log => {
        const data = new Date(log.timestamp).toLocaleString('pt-BR');
        report += `${data} | OS ${log.os}/${log.ano} | ${log.tipo} | ${log.status}\n`;
    });
    
    console.log(report);
    alert(report);
}

// ==========================================
// CONFIGURAÇÃO GLOBAL
// ==========================================

// Expor funções globalmente se em ambiente de browser
if (typeof window !== 'undefined') {
    try {
        window.PT_Email_OFT = {
            finalizarAnalise: finalizarAnaliseComOFT,
            enviarEmail: enviarEmailPTComOFT,
            enviarComDeteccao: enviarEmailComDeteccao,
            getLogs: getEmailLogs,
            clearLogs: clearEmailLogs,
            showLogsReport: showEmailLogsReport,
            logger: {
                log: (msg) => console.log(`${LOGGER_PREFIX} ${msg}`),
                error: (msg) => console.error(`${LOGGER_PREFIX} ${msg}`),
                warn: (msg) => console.warn(`${LOGGER_PREFIX} ${msg}`)
            }
        };
        
        console.log(`${LOGGER_PREFIX} Módulo carregado. Use PT_Email_OFT.* para acessar funções`);
        console.log(`${LOGGER_PREFIX} Conectando em: ${API_BASE}`);
    } catch (err) {
        console.error(`${LOGGER_PREFIX} ERRO ao carregar módulo:`, err);
        console.error(`${LOGGER_PREFIX} Stack:`, err.stack);
    }
}

// ==========================================
// EXEMPLOS DE USO
// ==========================================

/*
// EM analise.html - ao clicar em "Concluir":
document.getElementById('btn-concluir').addEventListener('click', async (e) => {
    e.preventDefault();
    
    const sucesso = await PT_Email_OFT.finalizarAnalise();
    if (sucesso) {
        // Opcionalmente redirecionar para email.html
        // window.location.href = 'email.html?tipo=pt&pronto=true';
    }
});

// EM email.html - ao clicar em "Enviar":
document.getElementById('btn-enviar').addEventListener('click', async (e) => {
    e.preventDefault();
    
    const os_id = document.getElementById('os').value;
    const ano = document.getElementById('ano').value;
    const versao = document.getElementById('versao').value || "1";
    const destinatarios = document.getElementById('para').value.split(';').map(e => e.trim());
    
    const sucesso = await PT_Email_OFT.enviarEmail(os_id, ano, versao, destinatarios, 'SEFOC');
    if (sucesso) {
        console.log('Email enviado com sucesso!');
        // Limpar formulário ou redirecionar
    }
});

// Ver logs
PT_Email_OFT.showLogsReport();

// Limpar logs antigos
PT_Email_OFT.clearLogs();
*/
