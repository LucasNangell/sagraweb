// settings.js

const API_BASE_URL = `http://${window.location.hostname}:8001/api`;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Carregar Listas
    await loadSettingsData();

    // 2. Inicializar Select2
    initSelect2();

    // 3. Carregar Preferências com pequeno delay para garantir que Select2 está montado
    setTimeout(loadSavedPreferences, 50);

    // 4. Botão Salvar
    document.getElementById('btn-save-config').addEventListener('click', savePreferences);
});

async function loadSettingsData() {
    try {
        const [situacoes, setores] = await Promise.all([
            fetch(`${API_BASE_URL}/aux/situacoes`).then(r => r.json()),
            fetch(`${API_BASE_URL}/aux/setores`).then(r => r.json())
        ]);

        const sortFunc = (a, b) => (a.Situacao || a.Setor || "").localeCompare(b.Situacao || b.Setor || "");

        populateSelect('cfg-situacao', situacoes.sort(sortFunc), 'Situacao');
        populateSelect('cfg-setor', setores.sort(sortFunc), 'Setor');
    } catch (error) {
        console.error("Erro ao carregar dados:", error);
    }
}

function initSelect2() {
    $('.select2-filter').select2({
        placeholder: "Selecione...",
        allowClear: true,
        closeOnSelect: false,
        width: '100%',
        dropdownAutoWidth: false
    });

    // Adiciona o listener para atualizar visualmente ao mudar
    $('.select2-filter').on('change', function () {
        updateVisualDisplay($(this));
    });
}

// --- MESMA LÓGICA VISUAL DO INDEX ---
function updateVisualDisplay($select) {
    const count = $select.select2('data').length;
    const $container = $select.next('.select2-container');
    const $rendered = $container.find('.select2-selection__rendered');

    if (count > 1) {
        $rendered.find('li.select2-selection__choice').remove();
        $rendered.find('.select2-summary-text').remove();
        const summaryText = `<li class="select2-summary-text" style="list-style:none; padding-left:5px; color:#006400; font-weight:600;">${count} selecionados</li>`;
        $rendered.prepend(summaryText);
    }
}

function populateSelect(id, data, key) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '';
    data.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item[key];
        opt.textContent = item[key];
        select.appendChild(opt);
    });
}

async function loadSavedPreferences() {
    // 1. Manter Ano via LocalStorage (não solicitado BD para ano)
    const localPrefs = JSON.parse(localStorage.getItem('sagra_prefs_v1'));
    if (localPrefs && localPrefs.ano) {
        $('#cfg-ano').val(localPrefs.ano);
    }

    // 2. Carregar Setores e Situações do Backend
    const ponto = localStorage.getItem('sagra_user_ponto');
    if (!ponto) return;

    try {
        const res = await fetch(`${API_BASE_URL}/settings/filtros/${ponto}`);
        if (!res.ok) throw new Error("Erro ao buscar filtros");
        const data = await res.json();

        // Aplica e Atualiza Visual
        if (data.situacoes && data.situacoes.length > 0) {
            const el = $('#cfg-situacao');
            el.val(data.situacoes).trigger('change');
            updateVisualDisplay(el);
        }

        if (data.setores && data.setores.length > 0) {
            const el = $('#cfg-setor');
            el.val(data.setores).trigger('change');
            updateVisualDisplay(el);
        }
    } catch (e) {
        console.error("Erro carregando filtros do servidor:", e);
    }
}

async function savePreferences() {
    const ponto = localStorage.getItem('sagra_user_ponto') || '00000';
    // Tenta pegar nome de algum lugar ou usa placeholder 
    const usuario = localStorage.getItem('user_login') || 'Usuario_' + ponto;

    const situacoes = $('#cfg-situacao').val() || [];
    const setores = $('#cfg-setor').val() || [];
    const ano = $('#cfg-ano').val();

    // 1. Salvar Ano no LocalStorage (Legado/Extra)
    const localPrefs = { ano: ano };
    localStorage.setItem('sagra_prefs_v1', JSON.stringify(localPrefs));

    // 2. Salvar Filtros no Banco
    const btn = document.getElementById('btn-save-config');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE_URL}/settings/filtros/salvar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                usuario: usuario,
                ponto: ponto,
                situacoes: situacoes,
                setores: setores
            })
        });

        if (!res.ok) throw new Error("Erro ao salvar no servidor");

        alert('Preferências salvas com sucesso!');
        window.location.href = 'index.html';
    } catch (e) {
        alert('Erro ao salvar: ' + e.message);
        console.error(e);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}