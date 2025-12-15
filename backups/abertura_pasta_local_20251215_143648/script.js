// script.js - VERSÃO COMPLETA (LOGIN, NAVEGAÇÃO E CRUD)

const API_BASE_URL = `http://${window.location.hostname}:${window.SAGRA_API_PORT || 8000}/api`;
let currentAno = null;
let currentId = null;
let currentProduct = null;
let currentUser = null;
let currentPage = 1;
const itemsPerPage = 10; // ALTERADO PARA 10 ITENS POR PÁGINA

// Variáveis de Estado
let lastSelectedHistoryData = null;
let isEditing = false;

document.addEventListener('DOMContentLoaded', () => {
    checkLogin();
});

// --- LÓGICA DE LOGIN ---
// --- LÓGICA DE LOGIN ---
function checkLogin() {
    const savedPonto = localStorage.getItem('sagra_user_ponto');

    // Listener de Login (movido para cá ou garantido na inicialização)
    const btnLogin = document.getElementById('btn-login-confirm');
    if (btnLogin) {
        btnLogin.onclick = (e) => {
            e.preventDefault();
            performLogin();
        };
    }

    const inputLogin = document.getElementById('login-ponto-input');
    if (inputLogin) {
        inputLogin.onkeypress = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performLogin();
            }
        };
    }

    if (savedPonto) {
        currentUser = savedPonto;
        const overlay = document.getElementById('login-overlay');
        if (overlay) overlay.style.display = 'none';
        updateHeaderUser();
        startApp();
    } else {
        const overlay = document.getElementById('login-overlay');
        if (overlay) overlay.style.display = 'flex';
        setTimeout(() => {
            const el = document.getElementById('login-ponto-input');
            if (el) el.focus();
        }, 100);
    }

    // Logout Listener
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.onclick = () => {
            localStorage.removeItem('sagra_user_ponto');
            location.reload();
        };
    }
}

function performLogin() {
    const input = document.getElementById('login-ponto-input');
    const pontoRaw = input.value.trim().replace(/\D/g, '');

    if (!pontoRaw) {
        alert('Por favor, informe o número do ponto.');
        return;
    }

    localStorage.setItem('sagra_user_ponto', pontoRaw);
    currentUser = pontoRaw;

    document.getElementById('login-overlay').style.display = 'none';
    updateHeaderUser();
    startApp();
}

function updateHeaderUser() {
    const el = document.getElementById('header-user-id');
    if (el) el.textContent = `ID: ${formatPonto(currentUser)}`;
}

function formatPonto(val) {
    if (!val) return '';
    let v = val.toString().replace(/\D/g, '');
    return v.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// --- INICIALIZAÇÃO DO APP ---
function startApp() {
    console.log('SAGRA Web UI Loaded for User:', currentUser);
    loadAuxData();
    setupEventListeners();
    setupContextMenu(); // Inicializa o menu de contexto
    startAutoRefresh(); // Inicia atualização automática
    startEmailNotificationUpdates(); // Inicia atualização de notificações de email
    startWebSocket(); // Inicia WebSocket Global
}

// --- WEBSOCKET CLIENT ---
function startWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const port = window.SAGRA_API_PORT || 8000;
    const wsUrl = `${protocol}//${window.location.hostname}:${port}/ws`;

    let socket;
    let reconnectTimer = null;

    const connect = () => {
        console.log("Connecting to Global WebSocket:", wsUrl);
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log("Global WebSocket connected");
            if (reconnectTimer) clearTimeout(reconnectTimer);
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'system_update') {
                    handleSystemUpdate(data);
                }
            } catch (e) { console.error("WS Message Error", e); }
        };

        socket.onclose = () => {
            console.warn("Global WebSocket disconnected. Reconnecting in 5s...");
            reconnectTimer = setTimeout(connect, 5000);
        };

        socket.onerror = (err) => {
            console.error("WebSocket Error", err);
            socket.close();
        };
    };

    connect();
}

function handleSystemUpdate(data) {
    console.log("System update received:", data);

    // 1. Preservar Estado (Scroll, Seleção)
    const tbody = document.getElementById('orders-table-body');
    const scrollTop = tbody ? tbody.scrollTop : 0;

    // 2. Atualizar Listas (Silent)
    fetchOrders(true).then(() => {
        // Restaurar Scroll da Tabela (se necessário)
        const newTbody = document.getElementById('orders-table-body');
        if (newTbody) newTbody.scrollTop = scrollTop;
    });

    // 3. Verificar conflito na tela de edição atual
    // Se a OS atualizada é a que está aberta:
    if (currentId && currentAno && data.id === parseInt(currentId) && data.ano === parseInt(currentAno)) {
        // Notificar apenas
        showUpdateNotification(`A OS ${currentId}/${currentAno} foi atualizada no sistema.`);

        // Se for atualização de histórico, podemos recarregar o histórico sem medo?
        // Histórico é uma lista abaixo. Se estiver editando histórico, `isEditing` is true.
        // Se `isEditing` for false, podemos recarregar histórico.
        if (data.action && data.action.includes('history') && !isEditing) {
            loadHistory(currentAno, currentId);
        }
    }
}

function showUpdateNotification(msg) {
    let notif = document.getElementById('sys-update-notif');
    if (!notif) {
        notif = document.createElement('div');
        notif.id = 'sys-update-notif';
        notif.style.cssText = "position:fixed; top:20px; right:20px; background: #3498db; color:white; padding:15px; border-radius:4px; box-shadow:0 2px 10px rgba(0,0,0,0.2); z-index:9999; display:none; animation: slideIn 0.3s;";
        document.body.appendChild(notif);

        // Add style for slideIn if not exists
        const style = document.createElement('style');
        style.innerHTML = `@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`;
        document.head.appendChild(style);
    }
    notif.textContent = msg;
    notif.style.display = 'block';

    // Opcional: Botão de Reload
    const btn = document.createElement('button');
    btn.innerText = " ↻ Recarregar";
    btn.style.cssText = "margin-left:10px; background:rgba(0,0,0,0.2); border:none; color:white; cursor:pointer; padding:2px 6px; border-radius:3px;";
    btn.onclick = () => {
        loadDetails(currentAno, currentId);
        loadHistory(currentAno, currentId);
        notif.style.display = 'none';
    };
    notif.appendChild(btn);

    // Auto hide after 10s
    setTimeout(() => {
        notif.style.display = 'none';
    }, 10000);
}

// --- AUTO-REFRESH ---
let refreshInterval = null;
function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
        // Apenas se não estiver editando ou interagindo pesadamente (opcional)
        // Mas a regra é: atualizar sem quebrar nada.
        if (!document.hidden) {
            fetchOrders(true); // isSilent = true
        }
    }, 5000); // 5 segundos
}

// --- EMAIL NOTIFICATIONS ---
let emailNotificationInterval = null;
function startEmailNotificationUpdates() {
    // Atualizar imediatamente
    updateEmailNotificationBadge();

    // Limpar intervalo anterior se existir
    if (emailNotificationInterval) clearInterval(emailNotificationInterval);

    // Atualizar a cada 15 segundos
    emailNotificationInterval = setInterval(() => {
        updateEmailNotificationBadge();
    }, 15000);
}

async function updateEmailNotificationBadge() {
    try {
        const response = await fetch(`${API_BASE_URL}/email/notification_status?setor=SEFOC`);

        if (!response.ok) return;

        const data = await response.json();
        const badge = document.getElementById('email-notification-badge');

        if (!badge) return;

        if (data.has_notification) {
            const total = data.inbox_count + data.pendencias_count;
            badge.textContent = total > 99 ? '99+' : total;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    } catch (e) {
        console.error('Erro ao atualizar badge de notificação de email:', e);
    }
}

function setupEventListeners() {
    // Filtros
    const filterInputs = ['nr-os', 'ano', 'produto', 'titulo', 'solicitante'];
    filterInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => { currentPage = 1; fetchOrders(); });
            if (el.tagName === 'INPUT') {
                el.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') { currentPage = 1; fetchOrders(); }
                });
            }
        }
    });

    // Listener para o novo Checkbox "Exibir entregues e canceladas"
    const chkFinished = document.getElementById('chk-show-finished');
    if (chkFinished) {
        chkFinished.addEventListener('change', () => {
            currentPage = 1;
            fetchOrders();
        });
    }

    // Botões
    setupHistoryButtons();
    setupNavigation();

    const btnClear = document.getElementById('btn-clear-filters');
    if (btnClear) btnClear.addEventListener('click', clearFilters);

    const btnUpdate = document.querySelector('.btn-update');
    if (btnUpdate) btnUpdate.addEventListener('click', () => { currentPage = 1; fetchOrders(); });

    const btnPrev = document.getElementById('btn-prev');
    if (btnPrev) btnPrev.addEventListener('click', () => {
        if (currentPage > 1) { currentPage--; fetchOrders(); }
    });

    const btnNext = document.getElementById('btn-next');
    if (btnNext) btnNext.addEventListener('click', () => {
        currentPage++; fetchOrders();
    });
}

// --- CONFIGURAÇÃO DO MENU DE CONTEXTO ---
function setupContextMenu() {
    const menu = document.getElementById('context-menu');

    // Ocultar menu ao clicar em qualquer lugar
    document.addEventListener('click', () => {
        menu.style.display = 'none';
    });

    // Ações do Menu
    document.getElementById('ctx-new-os').addEventListener('click', () => {
        window.location.href = 'gerencia.html';
    });

    document.getElementById('ctx-duplicate-os').addEventListener('click', () => {
        if (currentAno && currentId) {
            alert(`Funcionalidade Duplicar OS (${currentId}/${currentAno}) em desenvolvimento.`);
            // Exemplo de implementação futura:
            // window.location.href = `gerencia.html?action=duplicate&ano=${currentAno}&id=${currentId}`;
        } else {
            alert('Selecione uma OS.');
        }
    });

    document.getElementById('ctx-edit-os').addEventListener('click', () => {
        if (currentAno && currentId) {
            window.location.href = `gerencia.html?ano=${currentAno}&id=${currentId}`;
        } else {
            alert('Selecione uma OS.');
        }
    });

    document.getElementById('ctx-link-os').addEventListener('click', () => {
        if (currentAno && currentId) {
            openVincularModal(currentId, currentAno);
        } else {
            alert('Selecione uma OS.');
        }
    });

    // Ação Abrir Pasta
    /**
     * Tenta abrir pasta localmente via serviço residente
     * @param {string} path - Caminho da pasta
     * @returns {Promise<boolean>} true se conseguiu abrir, false caso contrário
     */
    window.tryOpenFolderLocally = async function tryOpenFolderLocally(path) {
        try {
            const response = await fetch('http://127.0.0.1:5566/open-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path }),
                signal: AbortSignal.timeout(2000) // Timeout de 2s
            });
            
            if (response.ok) {
                const data = await response.json();
                return data.success === true;
            }
            return false;
        } catch (error) {
            console.log('Serviço local não disponível:', error.message);
            return false;
        }
    }

    /**
     * Mostra notificação oferecendo download do aplicativo local
     */
    window.showDownloadServiceNotification = function showDownloadServiceNotification() {
        console.log('🔔 Criando notificação de download');
        
        // Remover notificação existente se houver
        const existing = document.getElementById('local-service-notification');
        if (existing) {
            existing.remove();
        }
        
        // Criar notificação
        const notification = document.createElement('div');
        notification.id = 'local-service-notification';
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #fff3cd;
            border: 2px solid #ffc107;
            border-radius: 8px;
            padding: 16px;
            max-width: 350px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 99999;
            font-family: Arial, sans-serif;
            animation: slideIn 0.3s ease-out;
        `;
        notification.innerHTML = `
            <style>
                @keyframes slideIn {
                    from {
                        transform: translateX(400px);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
            </style>
            <div style="display: flex; align-items: start; gap: 12px;">
                <i class="fas fa-info-circle" style="color: #ffc107; font-size: 24px;"></i>
                <div style="flex: 1;">
                    <strong style="display: block; margin-bottom: 8px; color: #856404;">
                        Abertura automática de pastas
                    </strong>
                    <p style="margin: 0 0 12px 0; font-size: 13px; color: #856404; line-height: 1.4;">
                        Para habilitar a abertura automática de pastas, instale o aplicativo local.
                    </p>
                    <div style="display: flex; gap: 8px;">
                        <button id="btn-download-service" style="
                            background: #28a745;
                            color: white;
                            border: none;
                            padding: 8px 16px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 13px;
                            font-weight: bold;
                        ">
                            <i class="fas fa-download"></i> Baixar aplicativo
                        </button>
                        <button id="btn-close-notification" style="
                            background: #6c757d;
                            color: white;
                            border: none;
                            padding: 8px 12px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 13px;
                        ">
                            Fechar
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(notification);
        console.log('✅ Notificação adicionada ao DOM');
        
        // Event listeners
        document.getElementById('btn-download-service').addEventListener('click', () => {
            console.log('⬇️ Iniciando download do serviço');
            // Iniciar download do executável
            window.location.href = `${API_BASE_URL}/download/folder-opener`;
            notification.remove();
        });
        
        document.getElementById('btn-close-notification').addEventListener('click', () => {
            console.log('❌ Notificação fechada pelo usuário');
            notification.remove();
        });
    }

    document.getElementById('ctx-open-folder').addEventListener('click', async () => {
        console.log("=== DEBUG: Open Folder Clicked ===");
        console.log("Ano:", currentAno, "ID:", currentId);
        
        if (currentAno && currentId) {
            const osTitle = `OS ${currentId}/${currentAno}`;
            
            try {
                console.log("1️⃣ Fetching path...");
                const res = await fetch(`${API_BASE_URL}/os/${currentAno}/${currentId}/path`);
                console.log("2️⃣ Response Status:", res.status);
                if (!res.ok) throw new Error("Erro na busca");
                const data = await res.json();
                const folderPath = data.path;
                console.log("3️⃣ Folder Path:", folderPath);
                
                // Tentar abrir localmente (apenas DEV)
                console.log("4️⃣ Tentando abrir pasta localmente:", folderPath);
                const openedLocally = await window.tryOpenFolderLocally(folderPath);
                console.log("5️⃣ Resultado openedLocally:", openedLocally);
                
                if (openedLocally) {
                    console.log("✅ Pasta aberta automaticamente! Não mostra popup.");
                    // Sucesso - não precisa mostrar modal
                    return;
                }
                
                // Fallback: mostrar popup tradicional
                console.log("⚠️ Serviço local não disponível - usando fallback");
                console.log("6️⃣ Mostrando modal...");
                const modal = document.getElementById('modal-folder-path');
                const display = document.getElementById('folder-path-display');
                const title = document.getElementById('folder-path-os-title');

                modal.style.display = 'flex';
                title.innerText = osTitle;
                display.innerText = folderPath;
                console.log("7️⃣ Modal exibido");
                
                // Verificar sessionStorage
                const alreadyNotified = sessionStorage.getItem('folder-service-notified');
                console.log("8️⃣ SessionStorage 'folder-service-notified':", alreadyNotified);
                
                // Mostrar notificação para download do serviço (apenas uma vez por sessão)
                if (!alreadyNotified) {
                    console.log('📢 Mostrando notificação de download do serviço local');
                    setTimeout(() => {
                        console.log('⏰ Executando showDownloadServiceNotification após delay');
                        window.showDownloadServiceNotification();
                    }, 500);
                    sessionStorage.setItem('folder-service-notified', 'true');
                    console.log('9️⃣ SessionStorage marcado como "true"');
                } else {
                    console.log('ℹ️ Notificação já foi exibida nesta sessão');
                }
                
            } catch (e) {
                console.error("❌ DEBUG FETCH ERROR:", e);
                alert("Erro ao buscar caminho da pasta: " + e.message);
            }

        } else {
            alert('Selecione uma OS.');
        }
    });

    // Ação Imprimir Ficha
    document.getElementById('ctx-print-ficha').addEventListener('click', async () => {
        console.log('Imprimir Ficha clicado! Ano:', currentAno, 'ID:', currentId);
        if (currentAno && currentId) {
            await openPrintFichaModal(currentId, currentAno);
        } else {
            alert('Selecione uma OS.');
        }
    });

    // Copiar Caminho
    const btnCopy = document.getElementById('btn-copy-path');
    if (btnCopy) {
        btnCopy.addEventListener('click', () => {
            const displayEl = document.getElementById('folder-path-display');
            const text = displayEl ? displayEl.innerText : '';
            const lower = text ? text.toLowerCase() : '';
            // Não copia se estiver em estado de busca ou erro
            if (text && !lower.includes('buscando') && !lower.startsWith('erro') && !lower.includes('não encontrada')) {
                navigator.clipboard.writeText(text).then(() => {
                    const originalHTML = btnCopy.innerHTML;
                    btnCopy.innerHTML = '<i class="fas fa-check"></i> Copiado!';
                    // Fechar modal após um curto delay para dar feedback visual
                    setTimeout(() => {
                        btnCopy.innerHTML = originalHTML;
                        const modal = document.getElementById('modal-folder-path');
                        if (modal) modal.style.display = 'none';
                    }, 500);
                }).catch((err) => {
                    console.error('Erro ao copiar para clipboard:', err);
                    alert('Não foi possível copiar o caminho para a área de transferência.');
                });
            }
        });
    }
}

// --- NOVA FUNÇÃO DE NAVEGAÇÃO ---
function setupNavigation() {
    const linkGerencia = document.getElementById('link-gerencia');
    if (linkGerencia) {
        linkGerencia.addEventListener('click', (e) => {
            e.preventDefault();

            if (!currentAno || !currentId) {
                alert("Por favor, selecione uma Ordem de Serviço na lista antes de acessar a Gerência.");
                return;
            }

            window.location.href = `gerencia.html?ano=${currentAno}&id=${currentId}`;
        });
    }

    const navAnalise = document.getElementById('nav-analise');
    if (navAnalise) {
        navAnalise.addEventListener('click', (e) => {
            e.preventDefault();
            if (!currentAno || !currentId) {
                alert("Por favor, selecione uma Ordem de Serviço na lista antes de acessar a Análise.");
            } else {
                window.location.href = `analise.html?ano=${currentAno}&id=${currentId}`;
            }
        });
    }

    const linkPapelaria = document.getElementById('link-papelaria');
    if (linkPapelaria) {
        linkPapelaria.addEventListener('click', (e) => {
            e.preventDefault();

            if (!currentId) {
                alert("Por favor, selecione uma Ordem de Serviço.");
                return;
            }

            const idNum = parseInt(currentId, 10);
            if (isNaN(idNum) || idNum <= 5000) {
                alert("O acesso à Papelaria é restrito a OS com número superior a 5000.");
                return;
            }

            // Salva o produto para auto-seleção na próxima tela
            if (currentProduct) {
                sessionStorage.setItem('sagra_target_product', currentProduct);
            }
            if (currentId) sessionStorage.setItem('sagra_current_os_id', currentId);
            if (currentAno) sessionStorage.setItem('sagra_current_os_ano', currentAno);

            window.location.href = 'papelaria.html';
        });
    }
}

// --- FUNÇÕES DE HISTÓRICO ---
function setHistoryFieldsState(enabled) {
    $('#new-history-situacao').prop('disabled', !enabled);
    $('#new-history-setor').prop('disabled', !enabled);
    document.getElementById('new-history-obs').disabled = !enabled;
    document.getElementById('new-history-ponto').disabled = !enabled;
}

function setupHistoryButtons() {
    const btnNewHist = document.getElementById('btn-new-history');
    if (btnNewHist) {
        btnNewHist.addEventListener('click', () => {
            isEditing = false;
            toggleHistoryButtons(true);
            setHistoryFieldsState(true);

            $('#new-history-situacao').val('').trigger('change');
            $('#new-history-setor').val('').trigger('change');
            document.getElementById('new-history-obs').value = '';
            document.getElementById('new-history-ponto').value = formatPonto(currentUser);

            setTimeout(() => {
                $('#new-history-situacao').select2('open');
            }, 50);
        });
    }

    const btnEditHist = document.getElementById('btn-edit-history');
    if (btnEditHist) {
        btnEditHist.addEventListener('click', () => {
            if (!lastSelectedHistoryData) {
                alert("Selecione um andamento na lista para editar.");
                return;
            }
            isEditing = true;
            toggleHistoryButtons(true);
            setHistoryFieldsState(true);

            const obsField = document.getElementById('new-history-obs');
            obsField.focus();
            const len = obsField.value.length;
            obsField.setSelectionRange(len, len);
        });
    }

    const btnCancel = document.getElementById('btn-cancel-history');
    if (btnCancel) {
        btnCancel.addEventListener('click', () => {
            toggleHistoryButtons(false);
            setHistoryFieldsState(false);
            isEditing = false;

            if (lastSelectedHistoryData) {
                $('#new-history-situacao').val(lastSelectedHistoryData.situacao).trigger('change');
                $('#new-history-setor').val(lastSelectedHistoryData.setor).trigger('change');
                document.getElementById('new-history-obs').value = lastSelectedHistoryData.obs;
                document.getElementById('new-history-ponto').value = formatPonto(lastSelectedHistoryData.ponto || '');
            } else {
                $('#new-history-situacao').val('').trigger('change');
                $('#new-history-setor').val('').trigger('change');
                document.getElementById('new-history-obs').value = '';
                document.getElementById('new-history-ponto').value = '';
            }
        });
    }

    const btnSave = document.getElementById('btn-save-history');
    if (btnSave) btnSave.addEventListener('click', postHistory);

    const btnDelete = document.getElementById('btn-delete-history');
    if (btnDelete) {
        btnDelete.addEventListener('click', deleteHistory);
    }
}

async function postHistory() {
    if (!currentAno || !currentId) {
        alert('Selecione uma OS primeiro.');
        return;
    }

    const situacao = document.getElementById('new-history-situacao').value;
    const setor = document.getElementById('new-history-setor').value;
    const obs = document.getElementById('new-history-obs').value;
    const ponto = document.getElementById('new-history-ponto').value;

    if (!situacao || !setor) {
        alert('Preencha Situação e Setor.');
        return;
    }

    const payload = {
        situacao: situacao,
        setor: setor,
        obs: obs,
        usuario: ponto
    };

    try {
        let response;
        if (isEditing) {
            if (!lastSelectedHistoryData || !lastSelectedHistoryData.codStatus) {
                throw new Error("Erro: Código do andamento não encontrado para edição.");
            }
            payload.cod_status = lastSelectedHistoryData.codStatus;

            response = await fetchWithRetry(`${API_BASE_URL}/os/${currentAno}/${currentId}/history`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            // Intercept Saída p/ when vinculos exist
            const lowerSitu = (situacao || '').toLowerCase();
            if (lowerSitu.startsWith('saída p') || lowerSitu.startsWith('saida p')) {
                // Check vinculos
                const vres = await fetch(`${API_BASE_URL}/os/${currentAno}/${currentId}/vinculos`);
                if (vres.ok) {
                    const vdata = await vres.json();
                    if (vdata && vdata.length > 0) {
                        // Show decision modal
                        showDecisaoSaida(payload);
                        return; // wait for user decision
                    }
                }

            }

            response = await fetchWithRetry(`${API_BASE_URL}/os/${currentAno}/${currentId}/history`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (!response.ok) throw new Error('Falha ao salvar dados.');

        alert('Operação realizada com sucesso!');
        isEditing = false;
        toggleHistoryButtons(false);
        setHistoryFieldsState(false);
        loadHistory(currentAno, currentId);
        fetchOrders();

    } catch (e) {
        alert('Erro ao salvar: ' + e.message);
    }
}

// ---------------- Vincular UI ----------------
function openVincularModal(id, ano) {
    const modal = document.getElementById('modal-vincular-os');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('vinc-numero').value = '';
    document.getElementById('vinc-ano').value = '';
    loadVinculosList(id, ano);

    const btnAdd = document.getElementById('btn-add-vinculo');
    btnAdd.onclick = async () => {
        const numero = parseInt(document.getElementById('vinc-numero').value, 10);
        const vano = parseInt(document.getElementById('vinc-ano').value, 10);
        if (!numero || !vano) { alert('Informe número e ano válidos.'); return; }
        try {
            const res = await fetch(`${API_BASE_URL}/os/${ano}/${id}/vincular`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numero: numero, ano: vano })
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.detail || 'Erro'); }
            await loadVinculosList(id, ano);
            document.getElementById('vinc-numero').value = '';
            document.getElementById('vinc-ano').value = '';
        } catch (e) { alert('Erro ao vincular: ' + e.message); }
    };
}

async function loadVinculosList(id, ano) {
    const container = document.getElementById('vinculos-list');
    if (!container) return;
    try {
        const res = await fetch(`${API_BASE_URL}/os/${ano}/${id}/vinculos`);
        if (!res.ok) throw new Error('Erro ao carregar vínculos');
        const data = await res.json();
        container.innerHTML = '';
        if (!data || data.length === 0) {
            container.innerHTML = '<div style="color:#666;">Nenhuma vinculação.</div>';
            return;
        }
        data.forEach(v => {
            const el = document.createElement('div');
            el.style.display = 'flex'; el.style.justifyContent = 'space-between'; el.style.alignItems = 'center'; el.style.padding = '6px 4px';
            el.innerHTML = `<div>${v.numero}/${v.ano}</div><div><button class="btn-danger-action" data-num="${v.numero}" data-ano="${v.ano}">🗑️</button></div>`;
            container.appendChild(el);
            const btn = el.querySelector('button');
            btn.addEventListener('click', async () => {
                if (!confirm('Remover vínculo?')) return;
                try {
                    const del = await fetch(`${API_BASE_URL}/os/${ano}/${id}/vinculo/${v.numero}/${v.ano}`, { method: 'DELETE' });
                    if (!del.ok) throw new Error('Falha ao remover');
                    await loadVinculosList(id, ano);
                } catch (e) { alert('Erro: ' + e.message); }
            });
        });
    } catch (e) {
        container.innerHTML = `<div style="color:#c0392b;">Erro: ${e.message}</div>`;
    }
}

// ---------------- Decisão Saída p/ ----------------
let _pendingHistoryPayload = null;
function showDecisaoSaida(payload) {
    _pendingHistoryPayload = payload;
    document.getElementById('modal-decisao-saida').style.display = 'flex';
}

document.getElementById('btn-cancel-decisao').addEventListener('click', () => {
    document.getElementById('modal-decisao-saida').style.display = 'none';
    _pendingHistoryPayload = null;
});

document.getElementById('btn-confirm-decisao').addEventListener('click', async () => {
    const choice = document.querySelector('input[name="decisao_sa"]:checked').value;
    const payload = _pendingHistoryPayload;
    document.getElementById('modal-decisao-saida').style.display = 'none';
    _pendingHistoryPayload = null;
    try {
        if (choice === 'all') {
            const res = await fetch(`${API_BASE_URL}/os/${currentAno}/${currentId}/history/replicate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!res.ok) { const err = await res.json(); throw new Error(err.detail || 'Erro'); }
            alert('Andamento replicado para o grupo.');
        } else {
            // Only this OS — post normally and mark excecao
            const res = await fetch(`${API_BASE_URL}/os/${currentAno}/${currentId}/history`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!res.ok) { const err = await res.json(); throw new Error(err.detail || 'Erro'); }
            // Mark exception
            await fetch(`${API_BASE_URL}/os/${currentAno}/${currentId}/vinculo/excecao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ observacao: 'Andamento divergente aplicado apenas a esta OS' }) });
            alert('Andamento salvo apenas nesta OS (grupo marcado como divergente).');
        }
        loadHistory(currentAno, currentId);
        fetchOrders();
    } catch (e) {
        alert('Erro ao aplicar decisão: ' + e.message);
    }
});

async function deleteHistory() {
    if (!currentAno || !currentId || !lastSelectedHistoryData) {
        alert("Selecione um andamento para excluir.");
        return;
    }
    const confirmMsg = "ATENÇÃO: Deseja excluir este andamento?\n\nIsso irá reorganizar a numeração de todos os andamentos desta OS.\nEssa ação não pode ser desfeita.";
    if (!confirm(confirmMsg)) return;
    try {
        const codEncoded = encodeURIComponent(lastSelectedHistoryData.codStatus);
        const response = await fetchWithRetry(`${API_BASE_URL}/os/${currentAno}/${currentId}/history/${codEncoded}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Falha ao excluir.');
        alert('Andamento excluído e lista reorganizada.');
        lastSelectedHistoryData = null;
        document.getElementById('new-history-obs').value = '';
        document.getElementById('new-history-ponto').value = '';
        $('#new-history-situacao').val('').trigger('change');
        $('#new-history-setor').val('').trigger('change');
        loadHistory(currentAno, currentId);
        fetchOrders();
    } catch (e) {
        alert('Erro ao excluir: ' + e.message);
    }
}

async function loadHistory(ano, id) {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Carregando...</td></tr>';

    lastSelectedHistoryData = null;
    toggleHistoryButtons(false);
    setHistoryFieldsState(false);
    isEditing = false;
    $('#new-history-situacao').val('').trigger('change');
    $('#new-history-setor').val('').trigger('change');
    document.getElementById('new-history-obs').value = '';
    document.getElementById('new-history-ponto').value = '';

    try {
        const res = await fetchWithRetry(`${API_BASE_URL}/os/${ano}/${id}/history`);
        const data = await res.json();
        tbody.innerHTML = '';

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Nenhum andamento.</td></tr>';
            return;
        }

        data.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${row.SituacaoLink || '-'}</td>
                <td>${row.SetorLink || '-'}</td>
                <td>${formatDate(row.Data)}</td>
            `;

            tr.onclick = () => {
                tbody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
                tr.classList.add('selected');

                lastSelectedHistoryData = {
                    codStatus: row.CodStatus,
                    situacao: row.SituacaoLink,
                    setor: row.SetorLink,
                    obs: row.Observaçao,
                    ponto: row.Ponto
                };

                setValue('new-history-situacao', row.SituacaoLink);
                setValue('new-history-setor', row.SetorLink);
                setValue('new-history-obs', row.Observaçao);
                setValue('new-history-ponto', formatPonto(row.Ponto));

                toggleHistoryButtons(false);
                setHistoryFieldsState(false);
                isEditing = false;
            };

            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:red;">Erro ao carregar histórico.</td></tr>';
    }
}

// --- AUXILIARES ---

async function loadAuxData() {
    try {
        const [situacoes, setores, maquinas] = await Promise.all([
            fetchWithRetry(`${API_BASE_URL}/aux/situacoes`).then(r => r.json()),
            fetchWithRetry(`${API_BASE_URL}/aux/setores`).then(r => r.json()),
            fetchWithRetry(`${API_BASE_URL}/aux/maquinas`).then(r => r.json())
        ]);
        const sortFunc = (a, b) => (a.Situacao || a.Setor || "").localeCompare(b.Situacao || b.Setor || "");
        populateSelect('situacao', situacoes.sort(sortFunc), 'Situacao');
        populateSelect('setor', setores.sort(sortFunc), 'Setor');
        populateSelect('new-history-situacao', situacoes, 'Situacao');
        populateSelect('new-history-setor', setores, 'Setor');
        populateSelect('val_maquina', maquinas, 'MaquinaLink');
        setTimeout(() => {
            initSelect2();
            applyPreferences();
        }, 50);
    } catch (error) {
        console.error('Error loading aux data:', error);
    }
}

function initSelect2() {
    $('.select2-filter').select2({
        placeholder: "Selecione...",
        allowClear: true,
        closeOnSelect: false,
        width: '100%',
        dropdownAutoWidth: false,
        language: { noResults: () => "Vazio", searching: () => "..." }
    });
    $('.select2-filter').on('change select2:select select2:unselect select2:clear', function (e) {
        updateVisualDisplay($(this));
        if (e.type === 'change' || e.type === 'select2:clear') {
            if (e.originalEvent || e.isTrigger) {
                currentPage = 1;
                fetchOrders();
            }
        }
    });
    $('.select2-filter').each(function () {
        updateVisualDisplay($(this));
    });
}

function updateVisualDisplay($select) {
    const data = $select.select2('data');
    const count = data.length;
    const $container = $select.next('.select2-container').find('.select2-selection--multiple');
    if (count > 0) {
        let text = (count === 1) ? data[0].text : `${count} selecionados`;
        $container.attr('data-label', text);
        $container.addClass('has-custom-label');
    } else {
        $container.removeAttr('data-label');
        $container.removeClass('has-custom-label');
    }
}

function populateSelect(elementId, data, key) {
    const select = document.getElementById(elementId);
    if (!select) return;
    select.innerHTML = '';
    if (!select.multiple) {
        const placeholder = document.createElement('option');
        placeholder.text = "Selecione...";
        placeholder.value = "";
        select.appendChild(placeholder);
    }
    data.forEach(item => {
        const option = document.createElement('option');
        option.value = item[key];
        option.textContent = item[key];
        select.appendChild(option);
    });
}

async function fetchOrders(isSilent = false) {
    const tbody = document.getElementById('orders-table-body');
    // Se não for silencioso, mostra loading e limpa
    if (!isSilent) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Carregando...</td></tr>';
    }

    const params = new URLSearchParams();
    ['nr-os', 'ano', 'produto', 'titulo', 'solicitante'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.value) params.append(id.replace('-', '_'), el.value);
    });
    const situacaoVals = $('#situacao').val() || [];
    const setorVals = $('#setor').val() || [];
    situacaoVals.forEach(v => params.append('situacao', v));
    setorVals.forEach(v => params.append('setor', v));

    // --- LÓGICA DO NOVO CHECKBOX ---
    const chkFinished = document.getElementById('chk-show-finished');
    if (chkFinished) {
        // Envia 'true' se marcado, 'false' se desmarcado
        params.append('include_finished', chkFinished.checked);
    }

    params.append('page', currentPage);
    params.append('limit', itemsPerPage);
    try {
        const response = await fetchWithRetry(`${API_BASE_URL}/os/search?${params.toString()}`);
        const data = await response.json();

        let rows = [];
        let meta = {};

        if (data.meta) {
            rows = data.data;
            meta = data.meta;
            updatePaginationUI(meta);
        } else {
            rows = data;
        }

        renderTable(rows);

    } catch (error) {
        console.error(error);
        if (!isSilent && tbody) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:red;">Erro ao carregar.</td></tr>';
        }
    }
}

// Função auxiliar para gerar HTML da prioridade
function getPrioHtml(raw) {
    let html = raw || '';
    if (html.includes('Solicitado')) html = `<span class="badge-yellow">${html}</span>`;
    if (html.includes('Prometido')) html = `<span style="background:#f8d7da; color:#721c24; padding:2px 5px; border-radius:4px;">${html}</span>`;
    return html;
}

function renderTable(data) {
    const tbody = document.getElementById('orders-table-body');
    if (!tbody) return;

    // Caso lista vazia
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Nenhum registro encontrado.</td></tr>';
        return;
    }

    // --- SMART RENDERING / RECONCILIATION ---
    // Estratégia: Atualizar linhas existentes pelo índice para manter a ordem da API.
    // Se o ID mudar, sobrescreve tudo. Se for o mesmo, diff suave.

    // 1. Remove linhas de placeholder (Carregando/Vazio) ou excesso
    // Se a primeira linha tiver apenas 1 célula (colspan), é placeholder, limpa tudo.
    if (tbody.children.length > 0 && tbody.children[0].cells.length === 1) {
        tbody.innerHTML = '';
    }

    // Remove excesso de linhas (se antes tinha 10 e agora tem 5)
    while (tbody.children.length > data.length) {
        tbody.removeChild(tbody.lastChild);
    }

    // 2. Itera sobre os dados e atualiza/cria linhas
    data.forEach((row, index) => {
        let tr = tbody.children[index];
        const uniqueKey = `${row.nr_os}-${row.ano}`;

        // Se a linha não existe, cria
        if (!tr) {
            tr = document.createElement('tr');
            tbody.appendChild(tr);
            // Configura Data Key inicial
            tr.dataset.key = "";
            // Adiciona listeners (uma única vez na criação)
            setupRowListeners(tr);
        }

        // Verifica se é a mesma OS visualmente
        const isSameOS = (tr.dataset.key === uniqueKey);

        // Atualiza Dataset
        tr.dataset.key = uniqueKey;
        // Armazena objeto completo para acesso rápido no clique
        tr.rowData = row;

        // Gera o CONTEÚDO HTML das células para comparação
        // Nota: innerHTML total é custoso, então podemos fazer algo hibrido:
        // Setar row.innerHTML é mais simples que diff celula-a-celula manualmente, 
        // mas perde selecionado se reconstruir tudo.
        // POREM, se usarmos innerHTML, os Listeners somem? Não, os listeners estão no TR.
        // O clique no TD propaga pro TR.

        // CONTEUDO
        const cellsData = [
            row.nr_os,
            row.ano,
            row.produto || '',
            `<span title="${row.solicitante || ''}" style="display:block; max-width:150px; overflow:hidden; text-overflow:ellipsis;">${row.solicitante || ''}</span>`,
            `<span title="${row.titulo || ''}" style="display:block; max-width:300px; overflow:hidden; text-overflow:ellipsis;">${row.titulo || ''}</span>`,
            row.situacao || '',
            row.setor || '',
            getPrioHtml(row.prioridade),
            formatDate(row.data_entrega)
        ];

        // Se a linha já existia, vamos verificar se precisamos mexer
        // A maneira mais robusta sem virtual DOM complexo é garantir que a estrutura TD existe.
        if (tr.children.length !== 9) {
            // Estrutura errada ou nova, recria TDs
            let html = '';
            cellsData.forEach(c => html += `<td>${c}</td>`);
            tr.innerHTML = html;
        } else {
            // Diff Célula a Célula
            if (!isSameOS) {
                // OS diferente: atualiza tudo cegamente
                Array.from(tr.children).forEach((td, i) => {
                    if (td.innerHTML !== String(cellsData[i])) td.innerHTML = cellsData[i];
                });
            } else {
                // Mesma OS: Verifica mudanças finas (ex: status mudou)
                Array.from(tr.children).forEach((td, i) => {
                    const newVal = String(cellsData[i]);
                    if (td.innerHTML !== newVal) {
                        td.innerHTML = newVal;
                        // Opcional: Efeito visual de update (highlight)
                        // td.style.transition = 'background 0.5s';
                        // td.style.backgroundColor = '#ffffcc';
                        // setTimeout(() => td.style.backgroundColor = '', 500);
                    }
                });
            }
        }

        // Restaura seleção visual se necessário
        if (currentId && currentAno && row.nr_os == currentId && row.ano == currentAno) {
            if (!tr.classList.contains('selected')) {
                // Limpa outros
                document.querySelectorAll('tbody tr.selected').forEach(r => r.classList.remove('selected'));
                tr.classList.add('selected');
            }
        } else {
            // Se esta linha estava selecionada mas não é mais a atual (ex: mudou id?), remove
            // Mas aqui comparamos com as variaveis globais.
            // Se eu selecionei OS 100. Na lista ela é Row 2.
            // Se OS 100 sai da lista, Row 2 vira OS 101.
            // Row 2 (OS 101) != currentId (100). Remove selected. Correto.
            tr.classList.remove('selected');
        }
    });
}

function setupRowListeners(tr) {
    // Clique Esquerdo
    tr.addEventListener('click', () => {
        // Recupera dados do dom object
        const row = tr.rowData;
        if (!row) return;

        document.querySelectorAll('tbody tr').forEach(r => r.classList.remove('selected'));
        tr.classList.add('selected');

        // Atualiza estado global
        currentId = row.nr_os;
        currentAno = row.ano;
        currentProduct = row.produto;

        loadDetails(currentAno, currentId);
        loadHistory(currentAno, currentId);
    });

    // Clique Direito
    tr.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const row = tr.rowData;
        if (!row) return;

        document.querySelectorAll('tbody tr').forEach(r => r.classList.remove('selected'));
        tr.classList.add('selected');

        currentId = row.nr_os;
        currentAno = row.ano;
        currentProduct = row.produto;

        const menu = document.getElementById('context-menu');
        menu.style.top = `${e.pageY}px`;
        menu.style.left = `${e.pageX}px`;
        menu.style.display = 'block';
    });
}


function updatePaginationUI(meta) {
    const infoSpan = document.getElementById('pagination-info');
    if (infoSpan) infoSpan.textContent = `Total: ${meta.total_records}`;
    const pageDisplay = document.getElementById('current-page-display');
    if (pageDisplay) pageDisplay.textContent = meta.page;
    const btnPrev = document.getElementById('btn-prev');
    if (btnPrev) btnPrev.disabled = meta.page <= 1;
    const btnNext = document.getElementById('btn-next');
    if (btnNext) btnNext.disabled = meta.page >= meta.total_pages;
}

async function loadDetails(ano, id) {
    currentAno = ano; currentId = id;
    const titleEl = document.getElementById('details-title');
    if (titleEl) titleEl.textContent = `Detalhes da OS ${id}/${ano}`;
    const fieldsToClear = ['val_maquina', 'val_tiragem', 'val_modelos', 'val_pgs', 'val_data', 'txt_obs', 'txt_papel', 'txt_cor', 'txt_acabamento', 'txt_contato'];
    fieldsToClear.forEach(fid => {
        const el = document.getElementById(fid);
        if (el) el.value = '';
    });
    try {
        const res = await fetchWithRetry(`${API_BASE_URL}/os/${ano}/${id}/details`);
        if (!res.ok) throw new Error('Erro detalhes');
        const data = await res.json();
        setValue('val_maquina', data.MaquinaLink);
        setValue('val_tiragem', data.Tiragem);
        setValue('val_prioridade', data.EntregPrazoLink);
        setValue('val_modelos', data.ModelosArq);
        setValue('val_pgs', data.Pags);
        setValue('val_data', formatDateForInput(data.EntregData));
        setValue('txt_acabamento', data.DescAcabamento);
        setValue('txt_papel', [data.PapelLink, data.PapelDescricao].filter(Boolean).join('\n'));
        setValue('txt_cor', [data.Cores, data.CoresDescricao].filter(Boolean).join('\n'));
        setValue('txt_obs', data.Observ);
        setValue('txt_contato', data.ContatoTrab);
        const chk = document.getElementById('chk_fv');
        if (chk) chk.checked = !!data.FrenteVerso;
    } catch (e) {
        console.error("Erro ao carregar detalhes:", e);
    }
}

function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
}

function toggleHistoryButtons(showActions) {
    const normalBtns = [document.getElementById('btn-new-history'), document.getElementById('btn-edit-history')];
    const actionBtns = [document.getElementById('btn-cancel-history'), document.getElementById('btn-save-history')];
    if (showActions) {
        normalBtns.forEach(b => b && (b.style.display = 'none'));
        actionBtns.forEach(b => b && (b.style.display = 'inline-block'));
    } else {
        normalBtns.forEach(b => b && (b.style.display = 'inline-block'));
        actionBtns.forEach(b => b && (b.style.display = 'none'));
    }
}

async function applyPreferences() {
    // 1. Manter Ano via LocalStorage
    const localPrefs = JSON.parse(localStorage.getItem('sagra_prefs_v1'));
    if (localPrefs && localPrefs.ano && document.getElementById('ano')) {
        document.getElementById('ano').value = localPrefs.ano;
    }

    // 2. Buscar Filtros do Backend
    const ponto = localStorage.getItem('sagra_user_ponto');
    if (ponto) {
        try {
            const res = await fetchWithRetry(`${API_BASE_URL}/settings/filtros/ponto/${ponto}`);
            if (res.ok) {
                const data = await res.json();
                if (data.situacoes && data.situacoes.length > 0) {
                    $('#situacao').val(data.situacoes).trigger('change');
                }
                if (data.setores && data.setores.length > 0) {
                    $('#setor').val(data.setores).trigger('change');
                }
            }
        } catch (e) {
            console.error("Erro ao sincronizar filtros:", e);
        }
    }

    // Atualiza Labels Visuais
    ['situacao', 'setor'].forEach(id => {
        const el = $('#' + id);
        if (el.length) updateVisualDisplay(el);
    });

    currentPage = 1;
    // IMPORTANTE: Busca dados ao iniciar
    fetchOrders();
}

function clearFilters() {
    $('#situacao').val(null).trigger('change');
    $('#setor').val(null).trigger('change');
    ['nr-os', 'produto', 'titulo', 'solicitante'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

function formatDate(d) {
    if (!d) return '';
    try {
        const date = new Date(d);
        if (isNaN(date)) return d;
        return date.toLocaleDateString('pt-BR');
    } catch (e) { return d; }
}

function formatDateForInput(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date)) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function fetchWithRetry(url, options = {}, retries = 3) {
    try {
        const response = await fetch(url, options);
        if (!response.ok && response.status >= 500 && retries > 0) {
            throw new Error(response.status);
        }
        return response;
    } catch (error) {
        if (retries > 0) {
            await new Promise(r => setTimeout(r, 500));
            return fetchWithRetry(url, options, retries - 1);
        }
        throw error;
    }
}

// --- FUNCIONALIDADE IMPRIMIR FICHA ---
async function openPrintFichaModal(id, ano) {
    console.log('openPrintFichaModal chamada com id:', id, 'ano:', ano);
    const modal = document.getElementById('modal-print-ficha');
    const container = document.getElementById('ficha-container');

    console.log('Modal encontrado:', !!modal, 'Container encontrado:', !!container);

    if (!modal || !container) {
        console.error('Modal ou container não encontrado!');
        alert('Erro: Elementos do modal não foram encontrados.');
        return;
    }

    // Mostrar modal e bloquear scroll do body
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;"><i class="fas fa-spinner fa-spin" style="font-size: 24px;"></i><br>Carregando dados...</div>';

    try {
        // Buscar dados da OS
        console.log('Buscando dados da OS...');
        const response = await fetchWithRetry(`${API_BASE_URL}/os/${ano}/${id}/details`);
        if (!response.ok) throw new Error('Erro ao carregar dados da OS');
        const data = await response.json();
        console.log('Dados recebidos:', data);

        // Criar iframe para renderizar a ficha com Tailwind
        const iframe = document.createElement('iframe');
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.backgroundColor = 'white';
        
        container.innerHTML = '';
        container.appendChild(iframe);

        // Carregar template da ficha no iframe
        const fichaResponse = await fetch('fichaos.html');
        const fichaHTML = await fichaResponse.text();
        
        // Escrever HTML no iframe
        iframe.contentDocument.open();
        iframe.contentDocument.write(fichaHTML);
        iframe.contentDocument.close();
        
        // Aguardar o iframe carregar
        await new Promise(resolve => {
            if (iframe.contentDocument.readyState === 'complete') {
                resolve();
            } else {
                iframe.onload = resolve;
            }
        });
        
        // Aguardar Tailwind e scripts carregarem
        await new Promise(resolve => setTimeout(resolve, 800));
        
        const iframeDoc = iframe.contentDocument;
        
        // Preencher campos usando IDs
        setFichaFieldInIframe(iframeDoc, 'ficha-data', formatDateBR(data.DataEntrada));
        setFichaFieldInIframe(iframeDoc, 'ficha-processo', data.ProcessoSolicit);
        setFichaFieldInIframe(iframeDoc, 'ficha-cota-rcoro', data.CotaRepro);
        setFichaFieldInIframe(iframeDoc, 'ficha-cota-cartao', '');
        setFichaFieldInIframe(iframeDoc, 'ficha-os', `${id}/${ano}`);
        setFichaFieldInIframe(iframeDoc, 'ficha-ano', ano);
        setFichaFieldInIframe(iframeDoc, 'ficha-os-ano', `${String(id).padStart(5, '0')}/${String(ano).slice(-2)}`);
        setFichaFieldInIframe(iframeDoc, 'ficha-modelos', '');
        setFichaFieldInIframe(iframeDoc, 'ficha-tiragem', data.Tiragem);
        
        // Entidade Solicitante
        setFichaFieldInIframe(iframeDoc, 'ficha-categoria', data.CategoriaLink);
        setFichaFieldInIframe(iframeDoc, 'ficha-cod-usuario', data.CodUsuarioLink);
        setFichaFieldInIframe(iframeDoc, 'ficha-contato', data.ContatoTrab);
        setFichaFieldInIframe(iframeDoc, 'ficha-nome', data.NomeUsuario);
        setFichaFieldInIframe(iframeDoc, 'ficha-sigla', '');
        setFichaFieldInIframe(iframeDoc, 'ficha-ramal', data.RamalUsuario);
        setFichaFieldInIframe(iframeDoc, 'ficha-interessado', data.OrgInteressado);
        
        // Informações Técnicas
        setFichaFieldInIframe(iframeDoc, 'ficha-tipo-servico', data.TipoPublicacaoLink);
        setFichaFieldInIframe(iframeDoc, 'ficha-maquina', data.MaquinaLink);
        setFichaFieldInIframe(iframeDoc, 'ficha-paginas', data.Pags);
        setFichaFieldInIframe(iframeDoc, 'ficha-fv', data.FrenteVerso ? 'Sim' : 'Não');
        setFichaFieldInIframe(iframeDoc, 'ficha-titulo', data.Titulo);
        setFichaFieldInIframe(iframeDoc, 'ficha-formato', data.FormatoLink);
        setFichaFieldInIframe(iframeDoc, 'ficha-cor', data.Cores ? `${data.Cores}` : '');
        setFichaFieldInIframe(iframeDoc, 'ficha-obs-cor', data.CoresDescricao);
        setFichaFieldInIframe(iframeDoc, 'ficha-papel', data.PapelLink);
        setFichaFieldInIframe(iframeDoc, 'ficha-obs-papel', data.PapelDescricao);
        
        // Acabamento formatado como lista com quebras de linha
        let acabamento = '';
        if (data.DescAcabamento) {
            const lines = data.DescAcabamento.split(/\r?\n/).filter(l => l.trim());
            acabamento = lines.map(line => {
                line = line.trim();
                return line.startsWith('-') ? line : `- ${line}`;
            }).join('\n');
        }
        const acabamentoEl = iframeDoc.getElementById('ficha-acabamento');
        if (acabamentoEl && acabamento) {
            acabamentoEl.innerHTML = '';
            acabamento.split('\n').forEach(line => {
                const p = iframeDoc.createElement('p');
                p.textContent = line;
                p.style.margin = '0';
                p.style.lineHeight = '1.2';
                acabamentoEl.appendChild(p);
            });
        }
        
        // Observações Gerais
        setFichaFieldInIframe(iframeDoc, 'ficha-obs-gerais', data.Observ);
        
        // Insumos e Material
        setFichaFieldInIframe(iframeDoc, 'ficha-insumos', data.InsumosFornecidos || 'Arquivos na pasta');
        setFichaFieldInIframe(iframeDoc, 'ficha-material', data.MaterialFornecido);
        
        // Dados de Entrega
        setFichaFieldInIframe(iframeDoc, 'ficha-resp-grafica', data.ResponsavelGrafLink);
        setFichaFieldInIframe(iframeDoc, 'ficha-forma-entrega', data.EntregaFormaLink);
        setFichaFieldInIframe(iframeDoc, 'ficha-prazo', data.EntregPeriodo ? `Solicitado p/ ${data.EntregPeriodo}` : '');
        setFichaFieldInIframe(iframeDoc, 'ficha-data-entrega', formatDateBR(data.EntregData));
        
        // Avisos
        const avisos = [data.EntregPeriodo, data.EntregPrazoLink].filter(Boolean).join(' - ');
        setFichaFieldInIframe(iframeDoc, 'ficha-avisos', avisos);
        
        // Gerar código de barras no iframe
        if (iframe.contentWindow.JsBarcode) {
            const barcodeElement = iframeDoc.getElementById('barcode-header');
            if (barcodeElement) {
                const osAnoText = `${String(id).padStart(5, '0')}/${String(ano).slice(-2)}`;
                try {
                    iframe.contentWindow.JsBarcode(barcodeElement, osAnoText, {
                        format: "CODE128",
                        lineColor: "#000",
                        width: 2,
                        height: 35,
                        displayValue: false,
                        margin: 0
                    });
                } catch (e) {
                    console.warn('Erro ao gerar código de barras:', e);
                }
            }
        }
        
    } catch (error) {
        console.error('Erro ao carregar ficha:', error);
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: #d32f2f;"><i class="fas fa-exclamation-triangle" style="font-size: 24px;"></i><br>Erro ao carregar dados da OS</div>';
    }
}

function setFichaFieldInIframe(doc, id, value) {
    const element = doc.getElementById(id);
    if (element) {
        element.textContent = value || '';
    }
}

function formatDateBR(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

// Event listeners para botões da ficha (adicionado ao DOMContentLoaded principal)
(function setupFichaPrintListeners() {
    const btnPrint = document.getElementById('btn-print-ficha');
    const btnClose = document.getElementById('btn-close-ficha');
    const modal = document.getElementById('modal-print-ficha');

    if (btnPrint) {
        btnPrint.addEventListener('click', () => {
            const container = document.getElementById('ficha-container');
            if (!container) return;
            
            const iframe = container.querySelector('iframe');
            if (!iframe || !iframe.contentDocument) {
                alert('Aguarde o carregamento completo da ficha antes de imprimir.');
                return;
            }

            // Imprimir conteúdo do iframe
            try {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            } catch (e) {
                console.error('Erro ao imprimir:', e);
                alert('Erro ao iniciar impressão.');
            }
        });
    }

    if (btnClose) {
        btnClose.addEventListener('click', () => {
            if (modal) {
                modal.style.display = 'none';
                document.body.style.overflow = '';
            }
        });
    }

    // Fechar modal ao clicar fora
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.style.display = 'none';
                document.body.style.overflow = '';
            }
        });
    }
})();

