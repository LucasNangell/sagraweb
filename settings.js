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

function loadSavedPreferences() {
    const prefs = JSON.parse(localStorage.getItem('sagra_prefs_v1'));
    if (!prefs) return;

    if (prefs.ano) $('#cfg-ano').val(prefs.ano);

    // Aplica valores e FORÇA atualização visual
    if (prefs.situacao && prefs.situacao.length > 0) {
        const el = $('#cfg-situacao');
        el.val(prefs.situacao).trigger('change');
        updateVisualDisplay(el); // Atualiza visual na hora
    }

    if (prefs.setor && prefs.setor.length > 0) {
        const el = $('#cfg-setor');
        el.val(prefs.setor).trigger('change');
        updateVisualDisplay(el); // Atualiza visual na hora
    }
}

function savePreferences() {
    const prefs = {
        ano: $('#cfg-ano').val(),
        situacao: $('#cfg-situacao').val() || [],
        setor: $('#cfg-setor').val() || []
    };
    localStorage.setItem('sagra_prefs_v1', JSON.stringify(prefs));
    alert('Preferências salvas com sucesso!');
    window.location.href = 'index.html';
}