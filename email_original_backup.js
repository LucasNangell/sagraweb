// Corrigir URL para funcionar localmente mesmo se abrir via arquivo
const hostname = window.location.hostname || 'localhost';
const API_BASE_URL = `http://${hostname}:8001/api`;

let activeTab = 'inbox';
let selectedId = null;
let currentUser = null;
let inboxData = []; // Armazena os e-mails carregados

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
}

async function loadInbox() {
    const container = document.getElementById('email-list-container');
    container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Carregando e-mails...</div>';

    try {
        console.log(`Tentando conectar em: ${API_BASE_URL}/email/inbox`);
        const response = await fetch(`${API_BASE_URL}/email/inbox`);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Erro ${response.status}: ${errText}`);
        }

        inboxData = await response.json();

        if (activeTab === 'inbox') {
            renderList();
        }
    } catch (e) {
        console.error("Erro FETCH:", e);
        container.innerHTML = `
            <div style="text-align:center; padding:20px; color:red;">
                <i class="fas fa-exclamation-triangle"></i><br>
                Erro ao sincronizar.<br>
                <small style="color:#666;">${e.message}</small><br>
                <small style="color:#aaa;">URL: ${API_BASE_URL}/email/inbox</small>
            </div>`;
    }
}

function switchTab(tab) {
    activeTab = tab;
    selectedId = null;

    document.querySelectorAll('.email-nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');

    document.getElementById('list-title').textContent = tab === 'inbox' ? 'Caixa de Entrada' : 'Pendências de O.S.';
    renderDetail(null);
    renderList();
}

function renderList() {
    const container = document.getElementById('email-list-container');
    container.innerHTML = '';

    const data = activeTab === 'inbox' ? inboxData : []; // TODO: Implementar OS Mock se necessário

    if (data.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Nenhum item.</div>';
        return;
    }

    data.forEach(item => {
        const el = document.createElement('div');
        el.className = `list-item ${selectedId === item.id ? 'selected' : ''}`;
        el.onclick = () => selectItem(item.id);

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
        }
        container.appendChild(el);
    });
}

function selectItem(id) {
    selectedId = id;
    renderList();

    const data = activeTab === 'inbox' ? inboxData : [];
    const item = data.find(x => x.id === id);
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
    }
}

function renderInboxDetail(email, container) {
    let attachmentsHtml = '';

    // Anexos Dinâmicos (Vindo do Backend)
    if (email.attachments && email.attachments.length > 0) {
        attachmentsHtml = `
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #f0f0f0;">
                <h4 style="font-size: 0.85rem; color: #777; margin-bottom: 10px;"><i class="fas fa-paperclip"></i> Anexos (${email.attachments.length})</h4>
                <div style="display: flex; flex-wrap: wrap; gap: 10px;">`;

        // Note: att_index needs to be carefully handled. 
        // In server.py we used index 1..N. Here we are just iterating arrays.
        // We need to pass index + 1 to the backend.

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
            ${email.body}
            ${attachmentsHtml}
        </div>
        <div class="detail-footer">
            <textarea class="reply-box" rows="3" placeholder="Escreva uma resposta rápida..."></textarea>
            <div class="reply-toolbar">
                <div style="display: flex; gap: 10px; color: #777;">
                    <i class="fas fa-paperclip" style="cursor: pointer;"></i>
                    <i class="fas fa-image" style="cursor: pointer;"></i>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn-secondary-action">Encaminhar</button>
                    <button class="btn-send" onclick="showToast('Resposta enviada com sucesso!')">
                        <i class="fas fa-reply"></i> Responder
                    </button>
                </div>
            </div>
        </div>
    `;
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