// script.js - VERSÃO COMPLETA (LOGIN, NAVEGAÇÃO E CRUD)

const API_BASE_URL = `http://${window.location.hostname}:8001/api`;
let currentAno = null;
let currentId = null;
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
function checkLogin() {
    const savedPonto = localStorage.getItem('sagra_user_ponto');

    if (savedPonto) {
        currentUser = savedPonto;
        document.getElementById('login-overlay').style.display = 'none';
        updateHeaderUser();
        startApp();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        setTimeout(() => document.getElementById('login-ponto-input').focus(), 100);
    }

    document.getElementById('btn-login-confirm').onclick = performLogin;
    document.getElementById('login-ponto-input').onkeypress = (e) => {
        if (e.key === 'Enter') performLogin();
    };

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            localStorage.removeItem('sagra_user_ponto');
            location.reload();
        });
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

async function fetchOrders() {
    const tbody = document.getElementById('orders-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Carregando...</td></tr>';
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
        if (data.meta) {
            renderTable(data.data);
            updatePaginationUI(data.meta);
        } else {
            renderTable(data);
        }
    } catch (error) {
        console.error(error);
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:red;">Erro ao carregar.</td></tr>';
    }
}

function renderTable(data) {
    const tbody = document.getElementById('orders-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Nenhum registro encontrado.</td></tr>';
        return;
    }
    data.forEach(row => {
        const tr = document.createElement('tr');
        let prioHtml = row.prioridade || '';
        if (prioHtml.includes('Solicitado')) prioHtml = `<span class="badge-yellow">${prioHtml}</span>`;
        if (prioHtml.includes('Prometido')) prioHtml = `<span style="background:#f8d7da; color:#721c24; padding:2px 5px; border-radius:4px;">${prioHtml}</span>`;
        tr.innerHTML = `
            <td>${row.nr_os}</td>
            <td>${row.ano}</td>
            <td>${row.produto || ''}</td>
            <td title="${row.solicitante || ''}" style="max-width:150px; overflow:hidden; text-overflow:ellipsis;">${row.solicitante || ''}</td>
            <td title="${row.titulo || ''}" style="max-width:300px; overflow:hidden; text-overflow:ellipsis;">${row.titulo || ''}</td>
            <td>${row.situacao || ''}</td>
            <td>${row.setor || ''}</td>
            <td>${prioHtml}</td>
            <td>${formatDate(row.data_entrega)}</td>
        `;
        tr.addEventListener('click', () => {
            document.querySelectorAll('tbody tr').forEach(r => r.classList.remove('selected'));
            tr.classList.add('selected');
            loadDetails(row.ano, row.nr_os);
            loadHistory(row.ano, row.nr_os);
        });
        tbody.appendChild(tr);
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

function applyPreferences() {
    const prefs = JSON.parse(localStorage.getItem('sagra_prefs_v1'));
    if (!prefs) { fetchOrders(); return; }
    if (prefs.ano && document.getElementById('ano')) { document.getElementById('ano').value = prefs.ano; }
    if (prefs.situacao && prefs.situacao.length > 0) {
        const el = $('#situacao'); el.val(prefs.situacao).trigger('change');
    }
    if (prefs.setor && prefs.setor.length > 0) {
        const el = $('#setor'); el.val(prefs.setor).trigger('change');
    }
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