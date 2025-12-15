// Corrigir URL para funcionar localmente mesmo se abrir via arquivo
const hostname = window.location.hostname || 'localhost';
const API_BASE_URL = `http://${hostname}:8001/api`;

let activeTab = 'inbox';
let selectedId = null;
let currentUser = null;
let inboxData = []; // Armazena os e-mails carregados
let pendenciasData = []; // Armazena as pendências de OS
let currentEmailHTML = ''; // Armazena o HTML do email sendo editado/visualizado
let currentSelectedEmail = null; // Armazena o email atualmente selecionado
let refreshTimer = null; // Timer para auto-refresh
let notificationTimer = null; // Timer para notificações

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    checkLogin();
});

function checkLogin() {
    const savedPonto = localStorage.getItem('sagra_user_ponto');
    if (savedPonto) {
        currentUser = savedPonto;
        document.getElementById('login-overlay').style.display = 'none';
        updateHeaderUser();
        initApp();
    } else {
        document.getElementById('btn-login-confirm').onclick = () => {
            const val = document.getElementById('login-ponto-input').value;
            if (val) {
                localStorage.setItem('sagra_user_ponto', val);
                location.reload();
            }
        };
    }
}

function updateHeaderUser() {
    const el = document.getElementById('header-user-id');
    if (el) el.textContent = `ID: ${currentUser}`;
}

function initApp() {
    document.getElementById('tab-inbox').addEventListener('click', () => switchTab('inbox'));
    document.getElementById('tab-os').addEventListener('click', () => switchTab('os'));

    // Carrega dados iniciais
    loadInbox();
    
    // Iniciar auto-refresh a cada 15s
    startAutoRefresh();
    
    // Iniciar atualização de notificações
    startNotificationUpdates();
}

async function loadInbox(silent = false) {
    const container = document.getElementById('email-list-container');
    
    if (!silent) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Carregando e-mails...</div>';
    }

    try {
        console.log(`Tentando conectar em: ${API_BASE_URL}/email/inbox`);
        const response = await fetch(`${API_BASE_URL}/email/inbox`);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Erro ${response.status}: ${errText}`);
        }

        const newData = await response.json();
        
        // Comparação simples: verificar se mudou
        const oldHash = inboxData.map(e => e.id).join(',');
        const newHash = newData.map(e => e.id).join(',');
        
        if (oldHash !== newHash || !silent) {
            // Salvar scroll atual
            const scrollPos = container.scrollTop;
            const previousSelectedId = selectedId;
            
            inboxData = newData;

            if (activeTab === 'inbox') {
                renderList();
                
                // Restaurar scroll
                if (silent) {
                    container.scrollTop = scrollPos;
                    
                    // Re-selecionar item se ainda existir
                    if (previousSelectedId && inboxData.find(e => e.id === previousSelectedId)) {
                        selectItem(previousSelectedId);
                    }
                }
            }
        }
    } catch (e) {
        console.error("Erro FETCH:", e);
        if (!silent) {
            container.innerHTML = `
                <div style="text-align:center; padding:20px; color:red;">
                    <i class="fas fa-exclamation-triangle"></i><br>
                    Erro ao sincronizar.<br>
                    <small style="color:#666;">${e.message}</small><br>
                    <small style="color:#aaa;">URL: ${API_BASE_URL}/email/inbox</small>
                </div>`;
        }
    }
}

async function loadPendencias() {
    const container = document.getElementById('email-list-container');
    container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Carregando pendências...</div>';

    try {
        const response = await fetch(`${API_BASE_URL}/email/pendencias?setor=SEFOC`);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Erro ${response.status}: ${errText}`);
        }

        pendenciasData = await response.json();

        if (activeTab === 'os') {
            renderList();
        }
    } catch (e) {
        console.error("Erro FETCH Pendencias:", e);
        container.innerHTML = `
            <div style="text-align:center; padding:20px; color:red;">
                <i class="fas fa-exclamation-triangle"></i><br>
                Erro ao carregar pendências.<br>
                <small style="color:#666;">${e.message}</small>
            </div>`;
    }
}

function startAutoRefresh() {
    // Limpar timer anterior se existir
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
    
    // Atualizar a cada 15 segundos
    refreshTimer = setInterval(() => {
        if (activeTab === 'inbox') {
            loadInbox(true); // silent = true para não piscar
        }
    }, 15000);
}

function startNotificationUpdates() {
    // Atualizar badge imediatamente
    updateNotificationBadge();
    
    // Limpar timer anterior se existir
    if (notificationTimer) {
        clearInterval(notificationTimer);
    }
    
    // Atualizar a cada 15 segundos
    notificationTimer = setInterval(() => {
        updateNotificationBadge();
    }, 15000);
}

async function updateNotificationBadge() {
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
        console.error('Erro ao atualizar badge de notificação:', e);
    }
}

function switchTab(tab) {
    activeTab = tab;
    selectedId = null;

    document.querySelectorAll('.email-nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');

    document.getElementById('list-title').textContent = tab === 'inbox' ? 'Caixa de Entrada' : 'Pendências de O.S.';
    renderDetail(null);
    
    if (tab === 'inbox') {
        if (inboxData.length === 0) {
            loadInbox();
        } else {
            renderList();
        }
    } else {
        loadPendencias();
    }
}

function renderList() {
    const container = document.getElementById('email-list-container');
    container.innerHTML = '';

    const data = activeTab === 'inbox' ? inboxData : pendenciasData;

    if (data.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Nenhum item.</div>';
        return;
    }

    data.forEach(item => {
        const el = document.createElement('div');
        el.className = `list-item ${selectedId === (activeTab === 'inbox' ? item.id : item.os) ? 'selected' : ''}`;
        el.onclick = () => selectItem(activeTab === 'inbox' ? item.id : item.os);

        if (activeTab === 'inbox') {
            // Badges de Conta
            let badgeClass = 'badge-sepim';
            let badgeText = 'SEPIM';
            if (item.account && item.account.includes('papelaria')) {
                badgeClass = 'badge-papelaria';
                badgeText = 'PAPELARIA';
            }

            el.innerHTML = `
                <div style="display:flex; align-items:center;">
                    <span class="account-badge ${badgeClass}">${badgeText}</span>
                    <span class="folder-badge">${item.folder}</span>
                </div>
                <div class="list-item-header">
                    <span class="sender-name ${item.read ? 'read' : ''}">${item.sender}</span>
                    <span class="item-date">${item.date}</span>
                </div>
                <div class="item-subject" style="${!item.read ? 'font-weight:700; color:#000;' : ''}">
                    ${item.subject}
                </div>
                <div class="item-preview">${item.preview}</div>
                ${item.hasAttachment ? '<i class="fas fa-paperclip" style="font-size:12px; color:#999; margin-top:4px;"></i>' : ''}
            `;
        } else {
            // Pendências de OS
            el.innerHTML = `
                <div class="list-item-header">
                    <span class="sender-name">OS ${item.os}/${String(item.ano).slice(-2)}</span>
                    <span class="item-date">${new Date(item.data).toLocaleDateString()}</span>
                </div>
                <div class="item-subject" style="font-weight:600; color:#333;">
                    ${item.situacao}
                </div>
                <div class="item-preview">Setor: ${item.setor}</div>
            `;
        }
        container.appendChild(el);
    });
}

function selectItem(id) {
    selectedId = id;
    renderList();

    const data = activeTab === 'inbox' ? inboxData : pendenciasData;
    const item = data.find(x => (activeTab === 'inbox' ? x.id === id : x.os === id));
    
    // Armazenar email selecionado para uso posterior
    if (activeTab === 'inbox' && item) {
        currentSelectedEmail = item;
    }
    
    renderDetail(item);
}

function renderDetail(item) {
    const container = document.getElementById('email-detail-content');

    if (!item) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><i class="fas fa-envelope-open-text"></i></div>
                <p>Selecione um item para visualizar</p>
            </div>
        `;
        return;
    }

    if (activeTab === 'inbox') {
        renderInboxDetail(item, container);
    } else {
        renderPendenciaDetail(item, container);
    }
}

// Helper function: Extrai OS/Ano do assunto
function parseOsAno(subject) {
    // Regex para encontrar padrão ####/##
    const match = subject.match(/(\d{4})\/(\d{2})/);
    if (match) {
        const os = parseInt(match[1], 10);
        const anoShort = match[2];
        const ano = 2000 + parseInt(anoShort, 10); // Converte 25 -> 2025
        return { os, ano };
    }
    return { os: '', ano: '' };
}

// Helper function: Remove thread antigos (corta em "De:" ou "From:")
function stripThread(body) {
    if (!body) return '';
    
    // Procura por linha iniciando com "De:" ou "From:"
    const lines = body.split('\n');
    const cutIndex = lines.findIndex(line => {
        const trimmed = line.trim();
        return trimmed.startsWith('De:') || trimmed.startsWith('From:');
    });
    
    if (cutIndex !== -1) {
        return lines.slice(0, cutIndex).join('\n');
    }
    
    return body;
}

function renderInboxDetail(email, container) {
    // Parse OS e Ano do assunto
    const { os, ano } = parseOsAno(email.subject);
    
    // Remove thread do corpo
    const cleanBody = stripThread(email.body);
    
    let attachmentsHtml = '';

    // Anexos Dinâmicos
    if (email.attachments && email.attachments.length > 0) {
        attachmentsHtml = `
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #f0f0f0;">
                <h4 style="font-size: 0.85rem; color: #777; margin-bottom: 10px;"><i class="fas fa-paperclip"></i> Anexos (${email.attachments.length})</h4>
                <div style="display: flex; flex-wrap: wrap; gap: 10px;">`;

        email.attachments.forEach((att, index) => {
            const downloadUrl = `${API_BASE_URL}/email/download?entry_id=${encodeURIComponent(email.real_id)}&att_index=${index + 1}`;

            attachmentsHtml += `
            <a href="${downloadUrl}" target="_blank" style="text-decoration:none; color:inherit;">
                <div style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #f9f9f9; border: 1px solid #eee; border-radius: 4px; cursor: pointer;" 
                     onmouseover="this.style.backgroundColor='#e9ecef'" 
                     onmouseout="this.style.backgroundColor='#f9f9f9'">
                    <i class="fas fa-file-download" style="color: #666;"></i>
                    <span style="font-size: 0.85rem; font-weight: 500;">${att.name || 'Anexo'}</span>
                </div>
            </a>`;
        });

        attachmentsHtml += `
                </div>
            </div>`;
    }

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; height: 100%;">
            <!-- Form Superior: 1/5 da altura -->
            <div style="flex: 0 0 20%; padding: 20px; background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                <h3 style="margin: 0 0 15px 0; font-size: 1.1rem; color: #333;">Enviar para Execução</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                    <div>
                        <label style="font-size: 0.85rem; font-weight: 600; color: #555;">NrOS</label>
                        <input type="number" id="inbox-os" value="${os}" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                    </div>
                    <div>
                        <label style="font-size: 0.85rem; font-weight: 600; color: #555;">Ano</label>
                        <input type="number" id="inbox-ano" value="${ano}" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                    <div>
                        <label style="font-size: 0.85rem; font-weight: 600; color: #555;">Situação</label>
                        <select id="inbox-situacao" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                            <option value="Em Execução" selected>Em Execução</option>
                            <option value="Aguardando">Aguardando</option>
                            <option value="Finalizado">Finalizado</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 0.85rem; font-weight: 600; color: #555;">Setor</label>
                        <select id="inbox-setor" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                            <option value="SEFOC" selected>SEFOC</option>
                            <option value="Arquivo">Arquivo</option>
                            <option value="Diretoria">Diretoria</option>
                        </select>
                    </div>
                </div>
                <div style="margin-bottom: 10px;">
                    <label style="font-size: 0.85rem; font-weight: 600; color: #555;">Observação</label>
                    <textarea id="inbox-obs" rows="4" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="Digite observações..."></textarea>
                </div>
                <button onclick="enviarParaExecucao()" style="width: 100%; padding: 10px; background: #007bff; color: white; border: none; border-radius: 4px; font-weight: 600; cursor: pointer;">
                    <i class="fas fa-paper-plane"></i> Enviar p/ Execução
                </button>
            </div>
            
            <!-- Corpo do Email: 4/5 da altura -->
            <div style="flex: 1; overflow-y: auto; padding: 20px;">
                <div class="detail-header">
                    <div class="detail-title-row">
                        <h1 class="detail-subject">${email.subject}</h1>
                        <div class="detail-actions">
                            <button title="Arquivar"><i class="fas fa-archive"></i></button>
                            <button title="Excluir"><i class="fas fa-trash-alt"></i></button>
                            <button><i class="fas fa-ellipsis-v"></i></button>
                        </div>
                    </div>
                    <div class="sender-info">
                        <div class="sender-avatar">${email.sender.charAt(0)}</div>
                        <div>
                            <div style="font-weight: 700; color: #333;">${email.sender} <span style="font-weight: 400; color: #777; font-size: 0.85rem;">&lt;${email.email}&gt;</span></div>
                            <div style="font-size: 0.85rem; color: #777;">Para: ${email.account || 'Mim'}</div>
                        </div>
                    </div>
                </div>
                <div class="detail-body">
                    <pre style="white-space: pre-wrap; font-family: inherit;">${cleanBody}</pre>
                    ${attachmentsHtml}
                </div>
            </div>
        </div>
    `;
}

async function enviarParaExecucao() {
    const os = parseInt(document.getElementById('inbox-os').value);
    const ano = parseInt(document.getElementById('inbox-ano').value);
    const situacao = document.getElementById('inbox-situacao').value;
    const setor = document.getElementById('inbox-setor').value;
    const observacao = document.getElementById('inbox-obs').value;
    
    if (!os || !ano) {
        alert('Preencha os campos NrOS e Ano');
        return;
    }
    
    // Pegar o entry_id do email selecionado
    const emailEntryId = currentSelectedEmail ? currentSelectedEmail.real_id : null;
    
    try {
        const response = await fetch(`${API_BASE_URL}/email/andamento`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                os, ano, situacao, setor,
                observacao: observacao || '',
                ponto: currentUser,
                email_entry_id: emailEntryId
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Erro ao enviar');
        }
        
        const result = await response.json();
        
        // Verificar se houve problema com Outlook
        if (result.outlook_updated === false) {
            showToast('Andamento lançado, mas não foi possível marcar o e-mail no Outlook');
        } else {
            showToast('Andamento criado e e-mail marcado como lido!');
        }
        
        console.log('Andamento criado:', result);
        
        // Limpar campos
        document.getElementById('inbox-obs').value = '';
        
        // Recarregar inbox após 1 segundo
        setTimeout(() => {
            loadInbox(true);
        }, 1000);
        
    } catch (e) {
        console.error('Erro:', e);
        alert('Erro ao enviar para execução: ' + e.message);
    }
}

function renderPendenciaDetail(osItem, container) {
    currentEmailHTML = ''; // Reset
    
    container.innerHTML = `
        <div style="display: flex; flex-direction: column; height: 100%;">
            <!-- Form Superior: 1/5 -->
            <div style="flex: 0 0 20%; padding: 20px; background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                <h3 style="margin: 0 0 15px 0; font-size: 1.1rem; color: #333;">Informações da OS</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                    <div>
                        <label style="font-size: 0.85rem; font-weight: 600; color: #555;">NrOS</label>
                        <input type="number" id="pend-os" value="${osItem.os}" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" readonly>
                    </div>
                    <div>
                        <label style="font-size: 0.85rem; font-weight: 600; color: #555;">Ano</label>
                        <input type="number" id="pend-ano" value="${osItem.ano}" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" readonly>
                    </div>
                    <div>
                        <label style="font-size: 0.85rem; font-weight: 600; color: #555;">Versão</label>
                        <input type="text" id="pend-versao" value="" placeholder="Ex: 1, 2, 3..." style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" required>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                    <div>
                        <label style="font-size: 0.85rem; font-weight: 600; color: #555;">E-mail Dep</label>
                        <input type="email" id="pend-email-dep" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                    </div>
                    <div>
                        <label style="font-size: 0.85rem; font-weight: 600; color: #555;">E-mail Gab</label>
                        <input type="email" id="pend-email-gab" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                    </div>
                    <div>
                        <label style="font-size: 0.85rem; font-weight: 600; color: #555;">E-mail Contato</label>
                        <input type="email" id="pend-email-contato" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                    </div>
                </div>
                <div style="padding: 10px; background: #e3f2fd; border-left: 4px solid #2196f3; border-radius: 4px;">
                    <p style="margin: 0; font-size: 0.85rem; color: #1976d2;">
                        <i class="fas fa-info-circle"></i> O HTML do e-mail será carregado automaticamente do banco de dados
                    </p>
                </div>
            </div>
            
            <!-- Preview do Email: 4/5 -->
            <div style="flex: 1; overflow-y: auto; padding: 20px; background: #fff;">
                <h3 style="margin: 0 0 15px 0; font-size: 1rem; color: #666;">Pré-visualização do E-mail</h3>
                <div id="email-preview-container" style="border: 2px solid #dee2e6; border-radius: 8px; min-height: 400px; background: #fff;">
                    <p style="padding: 20px; text-align: center; color: #999;">
                        <i class="fas fa-spinner fa-spin" style="font-size: 3rem; color: #ccc; margin-bottom: 10px; display: block;"></i>
                        Carregando HTML do banco de dados...
                    </p>
                </div>
                
                <div style="text-align: right; margin-top: 20px;">
                    <button onclick="enviarEmailPendencia()" style="padding: 12px 30px; background: #007bff; color: white; border: none; border-radius: 4px; font-weight: 600; font-size: 1rem; cursor: pointer;">
                        <i class="fas fa-paper-plane"></i> Enviar E-mail
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Carregar HTML automaticamente
    loadEmailPreview(osItem.os, osItem.ano);
}

async function loadEmailPreview(os, ano) {
    const previewContainer = document.getElementById('email-preview-container');
    
    try {
        const response = await fetch(`${API_BASE_URL}/email/pt-html/${ano}/${os}`);
        
        if (!response.ok) {
            const error = await response.json();
            previewContainer.innerHTML = `
                <div style="padding: 40px; text-align: center;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #ff9800; margin-bottom: 15px; display: block;"></i>
                    <h4 style="margin: 0 0 10px 0; color: #e65100;">HTML não encontrado</h4>
                    <p style="color: #666; margin: 0;">${error.detail || 'Conclua a análise primeiro para gerar o e-mail.'}</p>
                </div>
            `;
            return;
        }
        
        const data = await response.json();
        currentEmailHTML = data.html;
        
        // Renderizar HTML na prévia
        previewContainer.innerHTML = data.html;
        
        // Se houver versão salva, preencher automaticamente
        if (data.versao) {
            const versaoInput = document.getElementById('pend-versao');
            if (versaoInput && !versaoInput.value) {
                versaoInput.value = data.versao;
            }
        }
        
        console.log('HTML carregado com sucesso:', {
            versao: data.versao,
            data: data.data,
            tamanho: data.html.length
        });
        
    } catch (err) {
        console.error('Erro ao carregar prévia:', err);
        previewContainer.innerHTML = `
            <div style="padding: 40px; text-align: center;">
                <i class="fas fa-times-circle" style="font-size: 3rem; color: #f44336; margin-bottom: 15px; display: block;"></i>
                <h4 style="margin: 0 0 10px 0; color: #c62828;">Erro ao carregar prévia</h4>
                <p style="color: #666; margin: 0;">${err.message}</p>
            </div>
        `;
    }
}

async function enviarEmailPendencia() {
    const os = parseInt(document.getElementById('pend-os').value);
    const ano = parseInt(document.getElementById('pend-ano').value);
    const versao = document.getElementById('pend-versao').value;
    const emailDep = document.getElementById('pend-email-dep').value.trim();
    const emailGab = document.getElementById('pend-email-gab').value.trim();
    const emailContato = document.getElementById('pend-email-contato').value.trim();
    
    // Validações
    if (!versao) {
        alert('Preencha o número da versão (ex: 1, 2, 3...)');
        document.getElementById('pend-versao').focus();
        return;
    }
    
    // Montar lista de destinatários (remover vazios)
    const destinatarios = [emailDep, emailGab, emailContato].filter(e => e !== '');
    
    if (destinatarios.length === 0) {
        alert('Preencha pelo menos um e-mail de destinatário');
        document.getElementById('pend-email-dep').focus();
        return;
    }
    
    // Validar formato de e-mails
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const email of destinatarios) {
        if (!emailRegex.test(email)) {
            alert(`E-mail inválido: ${email}`);
            return;
        }
    }
    
    try {
        // Usar novo endpoint que busca HTML do banco e registra andamento
        const response = await fetch(`${API_BASE_URL}/email/send-pt`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                os: os,
                ano: ano,
                versao: versao,
                to: destinatarios,
                ponto: currentUser
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Erro ao enviar e-mail');
        }
        
        const result = await response.json();
        
        // Mostrar confirmação de sucesso
        showToast('E-mail enviado com sucesso!');
        
        console.log('Email enviado:', result);
        console.log('Assunto:', result.subject);
        
        // Limpar campos
        document.getElementById('pend-versao').value = '';
        document.getElementById('pend-email-dep').value = '';
        document.getElementById('pend-email-gab').value = '';
        document.getElementById('pend-email-contato').value = '';
        
        // Recarregar pendências após 1 segundo
        setTimeout(() => {
            loadPendencias();
        }, 1000);
        
    } catch (e) {
        console.error('Erro:', e);
        alert('Erro ao enviar e-mail: ' + e.message);
    }
}

function showToast(msg) {
    const container = document.getElementById('toast-container');
    const messageEl = document.getElementById('toast-message');

    messageEl.textContent = msg;
    container.style.display = 'block';

    setTimeout(() => {
        container.style.display = 'none';
    }, 3000);
}
