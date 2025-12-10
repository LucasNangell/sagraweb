// panel.js - Fix: Define hostname fallback para localhost

const hostname = window.location.hostname || 'localhost';
const API_BASE_URL = `http://${hostname}:8001/api`;

let currentSector = localStorage.getItem('sagra_panel_sector');
let refreshInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    initPanel();
});

function initPanel() {
    const btnConfig = document.getElementById('btn-config');
    const btnSave = document.getElementById('btn-modal-save');
    const btnClose = document.getElementById('btn-modal-close');

    if (btnConfig) btnConfig.onclick = openConfigModal;
    if (btnSave) btnSave.onclick = saveConfig;
    if (btnClose) btnClose.onclick = closeConfigModal;

    if (currentSector) {
        updateTitle(currentSector);
        loadPanelData();
        startAutoRefresh();
    } else {
        openConfigModal();
    }
}

function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(loadPanelData, 10000);
}

function updateTitle(sector) {
    const titleEl = document.getElementById('panel-title');
    if (titleEl) titleEl.textContent = `OSs na ${sector}`;
}

async function loadPanelData() {
    if (!currentSector) return;

    const container = document.getElementById('cards-container');
    const loadingState = document.getElementById('loading-state');

    // Mostra loading apenas se estiver vazio
    if (container && container.children.length === 0 && loadingState) {
        loadingState.style.display = 'block';
    }

    try {
        const url = `${API_BASE_URL}/os/panel?setor=${encodeURIComponent(currentSector)}`;
        console.log("Fetching Panel:", url); // Debug
        const response = await fetch(url);

        if (!response.ok) throw new Error("Falha ao buscar dados");

        const data = await response.json();

        if (loadingState) loadingState.style.display = 'none';
        renderCards(data);

    } catch (e) {
        console.error("Erro no Painel:", e);
    }
}

function renderCards(data) {
    const container = document.getElementById('cards-container');
    if (!container) return;

    container.innerHTML = '';

    if (data.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color:#777; padding:40px; font-size:1.2rem;">Nenhuma OS neste setor com os status monitorados.</div>';
        return;
    }

    data.forEach(os => {
        const card = createCard(os);
        container.appendChild(card);
    });
}

function createCard(os) {
    const div = document.createElement('div');

    // Classes de Status Padrão
    let borderClass = '';
    let badgeClass = '';
    const status = os.situacao || '';

    if (status.includes('Problemas')) {
        borderClass = 'border-problemas';
        badgeClass = 'bg-problemas';
    } else if (status.includes('Execução')) {
        borderClass = 'border-execucao';
        badgeClass = 'bg-execucao';
    } else if (status.includes('Tramit')) {
        borderClass = 'border-tramite';
        badgeClass = 'bg-tramite';
    } else if (status.includes('Saída') || status.includes('Encam')) {
        borderClass = 'border-saida';
        badgeClass = 'bg-saida';
    }

    // Classes de Prioridade (Sobrepõem Status se existirem)
    let priorityClass = '';
    let prioIcon = '';
    if (os.prioridade) {
        if (os.prioridade.includes('Prometido')) {
            priorityClass = 'card-prometido';
            prioIcon = '<i class="fas fa-exclamation-triangle prio-urgente" title="Prometido"></i> ';
        } else if (os.prioridade.includes('Solicitado')) {
            priorityClass = 'card-solicitado';
            prioIcon = '<i class="fas fa-exclamation-circle" style="color:#856404;" title="Solicitado"></i> ';
        }
    }

    div.className = `os-card ${priorityClass || borderClass}`;

    div.onclick = () => {
        window.location.href = `gerencia.html?ano=${os.ano}&id=${os.nr_os}`;
    };

    const dataEntrega = os.data_entrega ? new Date(os.data_entrega).toLocaleDateString('pt-BR') : '--/--';

    div.innerHTML = `
        <div class="card-header">
            <span class="os-number">${os.nr_os}/${os.ano}</span>
            <span class="os-date"><i class="far fa-calendar-alt"></i> ${dataEntrega}</span>
        </div>
        <div class="card-body">
            <div class="os-title">${truncate(os.titulo, 80)}</div>
            <div class="os-info"><i class="fas fa-user"></i> ${truncate(os.solicitante, 40)}</div>
            <div class="os-info"><i class="fas fa-box"></i> ${os.produto || 'N/A'}</div>
            <div class="os-info"><i class="fas fa-print"></i> Tiragem: ${os.Tiragem || '-'}</div>
        </div>
        <div class="card-footer">
            <span class="status-badge ${badgeClass}">${status}</span>
            <span>${prioIcon}</span>
        </div>
    `;

    return div;
}

// --- MODAL LOGIC ---

async function openConfigModal() {
    const modal = document.getElementById('config-modal');
    if (modal) modal.style.display = 'flex';

    const select = document.getElementById('modal-setor-select');
    if (!select) return;

    if (select.options.length <= 1) {
        try {
            const res = await fetch(`${API_BASE_URL}/aux/setores`);
            const setores = await res.json();

            select.innerHTML = '<option value="">Selecione...</option>';
            setores.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.Setor;
                opt.textContent = s.Setor;
                select.appendChild(opt);
            });

            if (currentSector) select.value = currentSector;

        } catch (e) {
            console.error("Erro carregando setores", e);
            select.innerHTML = '<option>Erro ao carregar</option>';
        }
    } else {
        if (currentSector) select.value = currentSector;
    }
}

function closeConfigModal() {
    const modal = document.getElementById('config-modal');
    if (modal) modal.style.display = 'none';
}

function saveConfig() {
    const select = document.getElementById('modal-setor-select');
    const val = select ? select.value : null;

    if (val) {
        currentSector = val;
        localStorage.setItem('sagra_panel_sector', val);
        updateTitle(val);
        loadPanelData();
        startAutoRefresh();
        closeConfigModal();
    } else {
        alert("Por favor, selecione um setor.");
    }
}

function truncate(str, n) {
    return (str && str.length > n) ? str.substr(0, n - 1) + '...' : str;
}