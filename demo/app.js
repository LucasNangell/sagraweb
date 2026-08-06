/**
 * SAGRA Web — Aplicação JavaScript Principal (SPA Router & Simulações)
 */

// Estado Global da Aplicação
let dbData = { os_list: [], ips: [], papelaria_jobs: [], chat_messages: [], active_users: [] };
let currentUser = null;
let activeOs = null;
let viewer3D = null;
let portalViewer3D = null;
let currentFilterStatus = '';

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  checkLoginState();
  initRouter();
  initEventListeners();
  initCorelEditor();
  
  // Polling de Simulação de Andamentos (Gravação e PCP)
  setInterval(simulateBackgroundProcesses, 4000);
});

// 1. LOGIN & AUTENTICAÇÃO
function checkLoginState() {
  const savedPonto = sessionStorage.getItem('sagra_ponto');
  if (savedPonto) {
    currentUser = { ponto: savedPonto, nome: 'Operador ' + savedPonto };
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    document.getElementById('user-display-name').textContent = 'Operador ' + savedPonto;
    document.getElementById('user-display-ponto').textContent = 'Ponto: ' + savedPonto;
    
    // Carrega dados iniciais da API
    fetchData();
  } else {
    document.getElementById('login-overlay').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
  }
}

function initEventListeners() {
  // Formulário de Login
  document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ponto = document.getElementById('ponto-input').value.trim();
    if (ponto) {
      sessionStorage.setItem('sagra_ponto', ponto);
      checkLoginState();
      showToast('Bem-vindo ao SAGRA Web!');
    }
  });

  // Botão de Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem('sagra_ponto');
    currentUser = null;
    checkLoginState();
  });

  // Reset do Banco
  document.getElementById('btn-reset-db').addEventListener('click', () => {
    if (confirm('Deseja realmente resetar o banco de dados temporário da demo?')) {
      fetch('api.php?action=reset_data')
        .then(res => res.json())
        .then(res => {
          showToast(res.message);
          fetchData();
        });
    }
  });

  // Filtros de Tabela OS
  document.getElementById('os-search-input').addEventListener('input', filterOsTable);
  document.getElementById('filter-sector').addEventListener('change', filterOsTable);
  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    document.getElementById('os-search-input').value = '';
    document.getElementById('filter-sector').value = '';
    currentFilterStatus = '';
    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
    filterOsTable();
  });

  // Clique em Cards de Status
  document.querySelectorAll('.stat-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
      const status = card.getAttribute('data-filter-status');
      if (currentFilterStatus === status) {
        currentFilterStatus = '';
      } else {
        currentFilterStatus = status;
        card.classList.add('active');
      }
      filterOsTable();
    });
  });

  // Modais de Criação de OS
  document.getElementById('btn-new-os').addEventListener('click', () => {
    document.getElementById('modal-new-os').classList.remove('hidden');
    document.getElementById('new-nr-os').value = Math.floor(Math.random() * 1000) + 5050; // default OS número alto (papelaria)
  });
  
  document.getElementById('btn-close-os-modal').addEventListener('click', () => {
    document.getElementById('modal-new-os').classList.add('hidden');
  });

  // Form Submissão Nova OS
  document.getElementById('new-os-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const osObj = {
      nr_os: parseInt(document.getElementById('new-nr-os').value),
      ano: parseInt(document.getElementById('new-ano').value),
      produto: document.getElementById('new-produto').value,
      titulo: document.getElementById('new-titulo').value,
      titular: document.getElementById('new-titular').value,
      solicitante: document.getElementById('new-solicitante').value || 'Gabinete',
      partido: document.getElementById('new-partido').value,
      uf: document.getElementById('new-uf').value.toUpperCase(),
      gabinete: document.getElementById('new-gabinete').value,
      anexo: document.getElementById('new-anexo').value,
      email: document.getElementById('new-email').value,
      cores: document.getElementById('new-cores').value,
      frente_verso: document.getElementById('new-fv').value,
      status: 'pendente',
      setor: 'PCP',
      mockup_url: '',
      corel_fields: []
    };

    fetch('api.php?action=os_save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(osObj)
    })
    .then(res => res.json())
    .then(res => {
      if (res.status === 'success') {
        document.getElementById('modal-new-os').classList.add('hidden');
        showToast(`OS #${osObj.nr_os} salva com sucesso!`);
        fetchData();
      }
    });
  });

  // Ações de Detalhes OS
  document.getElementById('btn-close-details-modal').addEventListener('click', () => {
    document.getElementById('modal-os-details').classList.add('hidden');
  });

  document.getElementById('btn-det-process-papelaria').addEventListener('click', () => {
    document.getElementById('modal-os-details').classList.add('hidden');
    window.location.hash = '#papelaria';
  });

  document.getElementById('btn-det-ver-prova').addEventListener('click', () => {
    document.getElementById('modal-os-details').classList.add('hidden');
    window.location.hash = '#analise';
  });

  document.getElementById('btn-det-send-ews').addEventListener('click', () => {
    document.getElementById('modal-os-details').classList.add('hidden');
    window.location.hash = '#email';
  });

  document.getElementById('btn-det-save-status').addEventListener('click', () => {
    if (!activeOs) return;
    const select = document.getElementById('det-change-status-select');
    const newStatus = select.value;
    let sector = activeOs.setor;
    
    // Lógicas de mapeamento de setor automático para ajudar a simulação
    if (newStatus === 'pendente') sector = 'PCP';
    else if (newStatus === 'producao') sector = 'Impressão Digital';
    else if (newStatus === 'analise') sector = 'Análise de Qualidade';
    else if (newStatus === 'aprovado') sector = 'C2P / Gravação';
    else if (newStatus === 'concluido') sector = 'Expedição';

    updateOsStatus(activeOs.nr_os, activeOs.ano, newStatus, sector, 'Alteração de status manual via painel de detalhes');
    document.getElementById('modal-os-details').classList.add('hidden');
  });

  // Ações Papelaria
  document.getElementById('btn-papelaria-prefill').addEventListener('click', () => {
    if (activeOs) {
      prefillPapelariaFromOS(activeOs);
    } else {
      showToast('Nenhuma OS ativa vinculada na sessão. Por favor selecione uma OS na página inicial.');
    }
  });

  document.getElementById('btn-process-corel').addEventListener('click', () => {
    if (!activeOs) {
      showToast('Nenhuma OS ativa na sessão.');
      return;
    }
    const preset = document.getElementById('papelaria-product-select').value;
    if (!preset) {
      showToast('Selecione um modelo de papelaria para processar.');
      return;
    }

    const fields = getCorelFormFields();
    
    // Dispara a animação do console do worker
    triggerCorelWorkerSimulation(activeOs.nr_os, activeOs.ano, () => {
      // Registrar Job no backend PHP
      const jobPayload = {
        nr_os: activeOs.nr_os,
        ano: activeOs.ano,
        produto: COREL_TEMPLATES[preset].name,
        usuario: currentUser.nome,
        corel_fields: fields
      };
      
      fetch('api.php?action=create_job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobPayload)
      })
      .then(res => res.json())
      .then(res => {
        if (res.status === 'success') {
          // Atualiza status do job para completo
          const mockupKey = preset; // mockup key coincide com o preset
          const updatePayload = {
            job_id: res.job_id,
            status: 'completed',
            progresso: 100,
            log_step: 'Job completed. Mockup cached.',
            mockup_url: mockupKey
          };
          
          fetch('api.php?action=update_job_status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatePayload)
          })
          .then(() => {
            fetchData();
            setTimeout(() => {
              document.getElementById('modal-worker').classList.add('hidden');
              window.location.hash = '#analise';
            }, 1000);
          });
        }
      });
    });
  });

  document.getElementById('btn-close-worker-modal').addEventListener('click', () => {
    document.getElementById('modal-worker').classList.add('hidden');
  });

  // Checkboxes Análise de Qualidade
  const checkBoxes = document.querySelectorAll('.quality-checkbox');
  checkBoxes.forEach(chk => {
    chk.addEventListener('change', () => {
      const allChecked = Array.from(checkBoxes).every(c => c.checked);
      document.getElementById('btn-approve-qa').disabled = !allChecked;
    });
  });

  // Aprovar Arte na Análise
  document.getElementById('btn-approve-qa').addEventListener('click', () => {
    if (!activeOs) return;
    updateOsStatus(
      activeOs.nr_os, 
      activeOs.ano, 
      'aprovado', 
      'C2P / Gravação', 
      'Arte aprovada na Análise de Qualidade. Enviado para gravação laser Xpose.'
    );
    showToast('Arte aprovada com sucesso! Enviada para gravação de chapas.');
    
    // Reset checks
    checkBoxes.forEach(c => c.checked = false);
    document.getElementById('btn-approve-qa').disabled = true;
    
    setTimeout(() => {
      window.location.hash = '#gravacao';
    }, 800);
  });

  // Rejeitar Arte
  document.getElementById('btn-reject-qa').addEventListener('click', () => {
    if (!activeOs) return;
    const motivo = prompt('Descreva o motivo da rejeição da prova:');
    if (motivo) {
      updateOsStatus(
        activeOs.nr_os,
        activeOs.ano,
        'pendente',
        'PCP',
        'Arte rejeitada pelo controle de qualidade. Motivo: ' + motivo
      );
      showToast('OS enviada de volta para ajustes.');
      window.location.hash = '#painel';
    }
  });

  // Controles 3D
  document.getElementById('slider-zoom').addEventListener('input', (e) => {
    if (viewer3D) viewer3D.setZoom(e.target.value);
  });
  document.getElementById('slider-rot-y').addEventListener('input', (e) => {
    if (viewer3D) viewer3D.setRotY(e.target.value);
  });
  document.getElementById('slider-fold').addEventListener('input', (e) => {
    if (viewer3D) viewer3D.setFold(e.target.value);
  });
  document.getElementById('btn-toggle-face').addEventListener('click', () => {
    if (viewer3D) {
      viewer3D.options.rotY += 180;
      document.getElementById('slider-rot-y').value = (viewer3D.options.rotY % 360);
      viewer3D.updateSceneTransform();
    }
  });
  document.getElementById('btn-reset-3d').addEventListener('click', () => {
    if (viewer3D) {
      viewer3D.resetCamera();
      document.getElementById('slider-zoom').value = 1.0;
      document.getElementById('slider-rot-y').value = -30;
      document.getElementById('slider-fold').value = 0.3;
    }
  });

  // Chat
  document.getElementById('chat-send-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input-msg');
    const msgText = input.value.trim();
    if (!msgText) return;
    
    const payload = {
      sender: 'Suporte PCP (' + currentUser.ponto + ')',
      message: msgText
    };

    fetch('api.php?action=send_chat_message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(res => {
      input.value = '';
      fetchData();
      
      // Simula uma resposta do assessor do deputado após 3 segundos
      simulateClientChatReply(msgText);
    });
  });

  // E-mail Presets
  document.getElementById('email-preset-select').addEventListener('change', (e) => {
    loadEmailPreset(e.target.value);
  });

  document.getElementById('btn-send-email').addEventListener('click', () => {
    const to = document.getElementById('email-to').value.trim();
    const subject = document.getElementById('email-subject').value.trim();
    if (!to || !subject) {
      showToast('Por favor, preencha o destinatário e o assunto.');
      return;
    }
    
    showToast('Enviando prova via Exchange EWS...');
    
    setTimeout(() => {
      showToast('E-mail de prova enviado com sucesso!');
      if (activeOs) {
        // adiciona andamento
        updateOsStatus(
          activeOs.nr_os,
          activeOs.ano,
          activeOs.status,
          activeOs.setor,
          `E-mail de prova enviado para ${to} com assunto: ${subject}`
        );
      }
    }, 1200);
  });

  // Relatórios
  document.getElementById('btn-generate-report').addEventListener('click', renderReports);
  document.getElementById('btn-download-pdf-report').addEventListener('click', () => {
    showToast('Relatório PDF exportado com sucesso via FPDF.');
  });

  // Gerência - IPs
  document.getElementById('btn-add-ip').addEventListener('click', () => {
    const ip = prompt('Digite o endereço IP:');
    const setor = prompt('Digite o Setor:');
    const desc = prompt('Digite a Descrição:');
    const perm = prompt('Digite a Permissão (MASTER_IP ou OPERADOR_IP):', 'OPERADOR_IP');
    
    if (ip && setor) {
      const payload = { id: 0, ip, setor, descricao: desc, permissao: perm };
      fetch('api.php?action=ip_save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(() => {
        fetchData();
        showToast('IP salvo com sucesso.');
      });
    }
  });

  // PORTAL CLIENTE
  document.getElementById('portal-login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const token = document.getElementById('portal-token-input').value.trim();
    const os = dbData.os_list.find(o => o.client_token === token);
    
    if (os) {
      document.getElementById('portal-login-screen').classList.add('hidden');
      document.getElementById('portal-workspace-screen').classList.remove('hidden');
      
      document.getElementById('portal-os-id').textContent = os.nr_os;
      document.getElementById('portal-os-product').textContent = os.produto;
      document.getElementById('portal-os-date').textContent = os.data_solicitacao;
      
      // Inicia visualizador 3D do portal
      setTimeout(() => {
        let presetType = 'ct_visita';
        if (os.produto.includes('Duplo')) presetType = 'ct_duplo';
        else if (os.produto.includes('Timbrado')) presetType = 'timbrado';
        
        const artUrl = generateDynamicArtworkSVG(presetType, os.corel_fields);
        
        portalViewer3D = new SagraMockup3D('portal-viewport-3d-scene-container', {
          preset: presetType,
          artworkUrl: artUrl
        });
        
        if (presetType === 'ct_duplo') {
          document.getElementById('portal-fold-control-wrapper').classList.remove('hidden');
        } else {
          document.getElementById('portal-fold-control-wrapper').classList.add('hidden');
        }
      }, 300);
      
      // Escutas do portal 3D
      document.getElementById('portal-slider-rot-y').addEventListener('input', (e) => {
        if (portalViewer3D) portalViewer3D.setRotY(e.target.value);
      });
      document.getElementById('portal-slider-fold').addEventListener('input', (e) => {
        if (portalViewer3D) portalViewer3D.setFold(e.target.value);
      });
      document.getElementById('btn-portal-toggle-face').addEventListener('click', () => {
        if (portalViewer3D) {
          portalViewer3D.options.rotY += 180;
          document.getElementById('portal-slider-rot-y').value = (portalViewer3D.options.rotY % 360);
          portalViewer3D.updateSceneTransform();
        }
      });
      
      activeOs = os; // define no escopo
    } else {
      alert('Token de prova inválido ou não encontrado.');
    }
  });

  document.getElementById('btn-portal-exit').addEventListener('click', () => {
    document.getElementById('portal-login-screen').classList.remove('hidden');
    document.getElementById('portal-workspace-screen').classList.add('hidden');
    portalViewer3D = null;
  });

  // Ações de Aprovação do Portal
  document.getElementById('btn-portal-approve').addEventListener('click', () => {
    if (!activeOs) return;
    if (confirm('Deseja realmente APROVAR este layout para produção?')) {
      updateOsStatus(
        activeOs.nr_os,
        activeOs.ano,
        'aprovado',
        'C2P / Gravação',
        'Prova aprovada eletronicamente pelo cliente via Portal SagraWeb.',
        true // aprovação cliente = true
      );
      alert('Layout aprovado! Obrigado. Sua OS já foi encaminhada para a fila de gravação de chapas.');
      document.getElementById('btn-portal-exit').click();
    }
  });

  document.getElementById('btn-portal-reject').addEventListener('click', () => {
    document.getElementById('portal-reject-reason-box').classList.remove('hidden');
  });

  document.getElementById('btn-portal-submit-reject').addEventListener('click', () => {
    const reason = document.getElementById('portal-reject-reason').value.trim();
    if (!reason) {
      alert('Por favor, descreva as correções.');
      return;
    }
    updateOsStatus(
      activeOs.nr_os,
      activeOs.ano,
      'pendente',
      'PCP',
      'Layout REJEITADO pelo cliente no Portal. Solicitação de ajuste: ' + reason
    );
    alert('Sua solicitação de ajuste foi enviada aos operadores.');
    document.getElementById('portal-reject-reason').value = '';
    document.getElementById('portal-reject-reason-box').classList.add('hidden');
    document.getElementById('btn-portal-exit').click();
  });
}

// 2. SPA ROUTER
function initRouter() {
  const handleRouting = () => {
    const hash = window.location.hash || '#painel';
    const tabName = hash.replace('#', '');
    
    // Atualiza classes do Sidebar
    document.querySelectorAll('.nav-menu .nav-item').forEach(item => {
      if (item.getAttribute('data-tab') === tabName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Mostra/esconde painéis
    document.querySelectorAll('.spa-panel').forEach(panel => {
      if (panel.id === 'panel-' + tabName) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });

    // Atualiza cabeçalho
    const titles = {
      'painel': 'Painel de Ordens de Serviço',
      'papelaria': 'Criação de Papelaria (CorelDRAW Integration)',
      'analise': 'Análise e Controle de Qualidade',
      'pcp': 'Fila de Produção PCP',
      'gravacao': 'Gravação de Chapas (Laser Xpose C2P)',
      'email': 'Envio de Prova por E-mail (Exchange)',
      'relatorios': 'Relatórios Estatísticos',
      'gerencia': 'Gerenciamento de Acesso e IPs',
      'mensagens': 'Chat de Suporte ao Cliente',
      'portal': 'Portal do Cliente'
    };
    document.getElementById('page-title').textContent = titles[tabName] || 'SAGRA Web';
    
    // Ações ao carregar a aba
    if (tabName === 'analise') {
      load3DPreview();
    } else if (tabName === 'email') {
      loadEmailPreset('prova_os');
    } else if (tabName === 'relatorios') {
      renderReports();
    }
  };

  window.addEventListener('hashchange', handleRouting);
  // Executa no boot
  setTimeout(handleRouting, 100);
}

// 3. API & SYNC DADOS
function fetchData() {
  fetch('api.php?action=get_data')
    .then(res => res.json())
    .then(data => {
      dbData = data;
      renderAllViews();
    });
}

function updateOsStatus(nrOs, ano, status, sector, desc, approved = null) {
  const payload = {
    nr_os: nrOs,
    ano: ano,
    status: status,
    setor: sector,
    usuario: currentUser ? currentUser.nome : 'Sistema',
    descricao: desc
  };
  
  if (approved !== null) {
    payload.approved_by_client = approved;
  }

  fetch('api.php?action=os_status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(() => {
    fetchData();
  });
}

// Renderização geral das abas com base no banco
function renderAllViews() {
  updateStatusSummary();
  renderOsTable();
  renderPcpTable();
  renderGravacaoJobs();
  renderIpsTable();
  renderActiveComputers();
  renderChatHistory();
}

// Atualiza contadores do topo
function updateStatusSummary() {
  const counts = { pendente: 0, producao: 0, analise: 0, aprovado: 0 };
  dbData.os_list.forEach(os => {
    if (counts[os.status] !== undefined) {
      counts[os.status]++;
    }
  });
  
  document.getElementById('count-pendente').textContent = counts.pendente;
  document.getElementById('count-producao').textContent = counts.producao;
  document.getElementById('count-analise').textContent = counts.analise;
  document.getElementById('count-aprovado').textContent = counts.aprovado;
}

// Renderiza a tabela de OS
function renderOsTable() {
  const body = document.getElementById('os-table-body');
  body.innerHTML = '';
  
  dbData.os_list.forEach(os => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    
    // Status Badge
    let badgeClass = 'badge-secondary';
    if (os.status === 'pendente') badgeClass = 'badge-warning';
    else if (os.status === 'producao') badgeClass = 'badge-primary';
    else if (os.status === 'analise') badgeClass = 'badge-secondary';
    else if (os.status === 'aprovado') badgeClass = 'badge-success';
    else if (os.status === 'concluido') badgeClass = 'badge-success';

    tr.innerHTML = `
      <td><strong>${os.nr_os}</strong></td>
      <td>${os.ano}</td>
      <td><span class="badge badge-primary">${os.produto}</span></td>
      <td>${os.titulo}</td>
      <td><strong>${os.titular}</strong> <span class="text-muted">(${os.partido}/${os.uf})</span></td>
      <td><span class="badge ${badgeClass}">${os.status}</span></td>
      <td><span class="text-orange">${os.setor}</span></td>
      <td>
        <button class="btn-secondary btn-sm btn-action-view" data-os="${os.nr_os}"><i class="fa-solid fa-eye"></i></button>
      </td>
    `;
    
    // Clique na linha ativa OS na sessão
    tr.addEventListener('click', (e) => {
      // Ignorar cliques no botão de ações
      if (e.target.closest('.btn-action-view')) return;
      
      activeOs = os;
      document.getElementById('active-os-badge').classList.remove('hidden');
      document.getElementById('active-os-text').textContent = `#${os.nr_os} (${os.titular})`;
      
      // Auto-preenche os inputs da papelaria se a aba mudar
      document.getElementById('pap-nr-os').value = os.nr_os;
      document.getElementById('pap-ano').value = os.ano;
      
      // Tenta setar o preset correto da papelaria
      let selectPreset = '';
      if (os.produto.includes('Visita')) selectPreset = 'ct_visita';
      else if (os.produto.includes('Duplo')) selectPreset = 'ct_duplo';
      else if (os.produto.includes('Timbrado')) selectPreset = 'timbrado';
      
      document.getElementById('papelaria-product-select').value = selectPreset;
      loadCorelPreset(selectPreset);
      
      showToast(`OS #${os.nr_os} selecionada como contexto ativo.`);
    });
    
    body.appendChild(tr);
  });
  
  // Escuta dos botões de visualizar detalhes
  document.querySelectorAll('.btn-action-view').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const nr = btn.getAttribute('data-os');
      const os = dbData.os_list.find(o => o.nr_os == nr);
      if (os) {
        showOsDetailsModal(os);
      }
    });
  });
}

function filterOsTable() {
  const query = document.getElementById('os-search-input').value.toLowerCase();
  const sector = document.getElementById('filter-sector').value;
  const rows = document.querySelectorAll('#os-table-body tr');
  
  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    const statusSpan = row.querySelector('td:nth-child(6) .badge');
    const status = statusSpan ? statusSpan.textContent.toLowerCase() : '';
    const sectorCell = row.querySelector('td:nth-child(7)').textContent;
    
    let matchQuery = text.includes(query);
    let matchSector = sector === '' || sectorCell.includes(sector);
    let matchStatus = currentFilterStatus === '' || status === currentFilterStatus;
    
    if (matchQuery && matchSector && matchStatus) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

// Modal de Detalhes da OS
function showOsDetailsModal(os) {
  activeOs = os;
  document.getElementById('det-nr-os').textContent = os.nr_os;
  document.getElementById('det-produto').textContent = os.produto;
  document.getElementById('det-titulo').textContent = os.titulo;
  document.getElementById('det-titular').textContent = os.titular;
  document.getElementById('det-partido-uf').textContent = `${os.partido}/${os.uf}`;
  document.getElementById('det-gabinete').textContent = os.gabinete;
  document.getElementById('det-anexo').textContent = os.anexo;
  document.getElementById('det-email').textContent = os.email;
  document.getElementById('det-solicitante').textContent = os.solicitante;
  document.getElementById('det-cores').textContent = os.cores;
  document.getElementById('det-fv').textContent = os.frente_verso;
  document.getElementById('det-setor').textContent = os.setor;
  document.getElementById('det-aprovacao').innerHTML = os.approved_by_client 
    ? '<span class="text-success"><i class="fa-solid fa-check"></i> Aprovado pelo Cliente</span>' 
    : '<span class="text-orange"><i class="fa-solid fa-hourglass"></i> Pendente</span>';
  
  // Set select status
  document.getElementById('det-change-status-select').value = os.status;
  
  // Timeline/Histórico
  const timeline = document.getElementById('det-history-timeline');
  timeline.innerHTML = '';
  os.andamentos.slice().reverse().forEach((evt, idx) => {
    const div = document.createElement('div');
    div.className = `timeline-event ${idx === 0 ? 'active' : ''}`;
    div.innerHTML = `
      <div class="event-time">${evt.data}</div>
      <div class="event-user"><i class="fa-solid fa-user-gear"></i> ${evt.usuario}</div>
      <div class="event-desc">${evt.descricao}</div>
    `;
    timeline.appendChild(div);
  });

  document.getElementById('modal-os-details').classList.remove('hidden');
}

// 4. ANÁLISE & VIEWPORT 3D
function load3DPreview() {
  if (!activeOs) {
    document.getElementById('viewport-3d-scene-container').innerHTML = `
      <div style="padding: 2rem; text-align: center; color: var(--text-secondary)">
        <i class="fa-solid fa-circle-info" style="font-size: 2rem; margin-bottom: 1rem; color: var(--primary)"></i>
        <p>Selecione uma OS na aba Painel para carregar sua respectiva arte tridimensional.</p>
      </div>
    `;
    document.getElementById('client-token-display').textContent = '----';
    document.getElementById('client-approval-badge').textContent = 'Pendente';
    return;
  }
  
  // Monta interface
  document.getElementById('viewport-3d-scene-container').innerHTML = `
    <div class="pm3d-scene" id="scene-3d">
      <div class="pm3d-product" id="product-3d"></div>
    </div>
  `;
  
  document.getElementById('client-token-display').textContent = activeOs.client_token;
  document.getElementById('client-approval-badge').textContent = activeOs.approved_by_client ? 'Aprovado' : 'Pendente';
  document.getElementById('client-approval-badge').className = activeOs.approved_by_client ? 'badge badge-success' : 'badge badge-warning';
  
  let presetType = 'ct_visita';
  if (activeOs.produto.includes('Duplo')) presetType = 'ct_duplo';
  else if (activeOs.produto.includes('Timbrado')) presetType = 'timbrado';
  
  const artUrl = generateDynamicArtworkSVG(presetType, activeOs.corel_fields);
  
  // Inicializa o visualizador 3D
  viewer3D = new SagraMockup3D('viewport-3d-scene-container', {
    preset: presetType,
    artworkUrl: artUrl
  });
  
  if (presetType === 'ct_duplo') {
    document.getElementById('fold-control-wrapper').classList.remove('hidden');
  } else {
    document.getElementById('fold-control-wrapper').classList.add('hidden');
  }
}

// 5. FILA PCP
function renderPcpTable() {
  const body = document.getElementById('pcp-table-body');
  body.innerHTML = '';
  
  const pcpOs = dbData.os_list.filter(o => o.status === 'pendente' || o.status === 'producao');
  
  pcpOs.forEach((os, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="badge badge-secondary">#${idx + 1}</span></td>
      <td><strong>${os.nr_os}</strong></td>
      <td>${os.produto}</td>
      <td>${os.titulo}</td>
      <td>${os.solicitante}</td>
      <td>
        <select class="pcp-operator-select" data-os="${os.nr_os}">
          <option value="">Alocar Operador...</option>
          <option value="Lucas Santos" ${os.setor.includes('Digital') ? 'selected' : ''}>Lucas Santos (Digital)</option>
          <option value="Juliana Costa" ${os.setor.includes('Qualidade') ? 'selected' : ''}>Juliana Costa (Qualidade)</option>
          <option value="Roberto Ramos" ${os.setor.includes('Gravação') ? 'selected' : ''}>Roberto Ramos (Gravação)</option>
        </select>
      </td>
      <td><span class="badge ${os.status === 'producao' ? 'badge-primary' : 'badge-warning'}">${os.status}</span></td>
      <td>
        <button class="btn-move btn-move-up" data-os="${os.nr_os}" ${idx === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button>
        <button class="btn-move btn-move-down" data-os="${os.nr_os}" ${idx === pcpOs.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button>
      </td>
    `;
    
    // Escuta troca de operador
    tr.querySelector('select').addEventListener('change', (e) => {
      const op = e.target.value;
      if (op) {
        updateOsStatus(os.nr_os, os.ano, 'producao', 'PCP - Fila Alocada', `Operador ${op} alocado para o trabalho.`);
        showToast(`Operador ${op} alocado à OS #${os.nr_os}`);
      }
    });
    
    body.appendChild(tr);
  });

  // Listener subida/descida na fila
  document.querySelectorAll('.btn-move-up').forEach(btn => {
    btn.addEventListener('click', () => {
      showToast('Prioridade da OS alterada na Fila PCP.');
      fetchData(); // apenas re-sincroniza na simulação
    });
  });
  document.querySelectorAll('.btn-move-down').forEach(btn => {
    btn.addEventListener('click', () => {
      showToast('Prioridade da OS alterada na Fila PCP.');
      fetchData();
    });
  });
}

// 6. GRAVAÇÃO & SIMULAÇÃO REAL-TIME
function renderGravacaoJobs() {
  const list = document.getElementById('gravacao-jobs-list');
  list.innerHTML = '';
  
  const activeJobs = dbData.papelaria_jobs.slice(-3); // Pega os últimos 3 jobs para exibição
  
  activeJobs.forEach(job => {
    const div = document.createElement('div');
    div.className = 'job-item';
    
    let statusBadge = 'badge-warning';
    if (job.status === 'completed') statusBadge = 'badge-success';
    else if (job.status === 'processing') statusBadge = 'badge-primary';
    
    div.innerHTML = `
      <div class="job-item-header">
        <span>Job #${job.id} (OS #${job.nr_os})</span>
        <span class="badge ${statusBadge}">${job.status}</span>
      </div>
      <div><strong>${job.produto}</strong></div>
      <div class="job-item-progress">
        <div class="job-item-progress-fill ${job.status === 'completed' ? 'success' : ''}" style="width: ${job.progresso}%"></div>
      </div>
      <div style="font-size: 0.65rem; color: var(--text-muted)">
        Solicitante: ${job.solicitante} | Atualizado em: ${job.data}
      </div>
    `;
    list.appendChild(div);
  });
}

// 7. E-MAIL PRESETS
const EMAIL_PRESETS_CONTENT = {
  prova_os: {
    subj: 'SAGRA Web - Prova de Arquivo - OS #5021',
    body: `Prezado(a) Parlamentar,\n\nA prova digital do seu Cartão de Visita referente à OS #5021 já está disponível.\n\nPor favor acesse o link de aprovação abaixo utilizando o seu token de segurança:\n\nLink: http://localhost:8000/demo/#portal\nToken: tkn-5021-x9a\n\nQualquer dúvida estamos à disposição.\n\nAtenciosamente,\nServiço de Produção Gráfica (SEFOC)`
  },
  prova_sp: {
    subj: 'SAGRA Web - Prova Digital para Liberação',
    body: `Olá,\n\nEncaminhamos a prova digital do serviço de impressão geral da OS de número 4910.\n\nPor favor confira o anexo e aprove respondendo a este e-mail.\n\nAtenciosamente,\nCoordenação de Produção Gráfica`
  },
  portal_aprovacao: {
    subj: 'Acesso ao Portal de Provas Gráficas SAGRA',
    body: `Prezado Gabinete,\n\nDisponibilizamos o token de acesso exclusivo para o Portal do Cliente para acompanhamento 3D de suas peças gráficas:\n\nToken: tkn-5022-b2z\n\nLink: http://localhost:8000/demo/#portal`
  }
};

function loadEmailPreset(presetKey) {
  const preset = EMAIL_PRESETS_CONTENT[presetKey];
  if (!preset) return;
  
  document.getElementById('email-subject').value = preset.subj;
  document.getElementById('email-body').value = preset.body;
  
  if (activeOs) {
    document.getElementById('email-to').value = activeOs.email;
  }
  
  updateEmailPreview();
}

function updateEmailPreview() {
  const subj = document.getElementById('email-subject').value;
  const body = document.getElementById('email-body').value;
  const frame = document.getElementById('email-preview-frame');
  
  frame.innerHTML = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; border: 1px solid #e2e8f0; padding: 1.5rem; background-color: #ffffff; color: #333;">
      <div style="border-bottom: 2px solid #1e3a8a; padding-bottom: 0.5rem; margin-bottom: 1rem;">
        <span style="font-size: 1.25rem; font-weight: bold; color: #1e3a8a;">SAGRA Web</span>
      </div>
      <p><strong>Assunto:</strong> ${subj}</p>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 1rem 0;">
      <p style="white-space: pre-wrap; font-size: 0.9rem; line-height: 1.5; color: #4b5563;">${body}</p>
    </div>
  `;
}

document.getElementById('email-subject').addEventListener('input', updateEmailPreview);
document.getElementById('email-body').addEventListener('input', updateEmailPreview);

// 8. RELATÓRIOS (CANVAS)
function renderReports() {
  // Gráfico Pizza (Distribuição Status)
  const canvasPie = document.getElementById('chart-pie-os');
  if (canvasPie) {
    const ctx = canvasPie.getContext('2d');
    ctx.clearRect(0,0,250,250);
    
    // Fake counts
    const statusCounts = { pendente: 2, producao: 1, analise: 1, aprovado: 2 };
    if (dbData.os_list.length > 0) {
      statusCounts.pendente = dbData.os_list.filter(o => o.status === 'pendente').length;
      statusCounts.producao = dbData.os_list.filter(o => o.status === 'producao').length;
      statusCounts.analise = dbData.os_list.filter(o => o.status === 'analise').length;
      statusCounts.aprovado = dbData.os_list.filter(o => o.status === 'aprovado' || o.status === 'concluido').length;
    }
    
    const colors = ['#f59e0b', '#3b82f6', '#8b5cf6', '#10b981'];
    const labels = ['Pendente', 'PCP Fila', 'Análise', 'Aprovadas'];
    const values = [statusCounts.pendente, statusCounts.producao, statusCounts.analise, statusCounts.aprovado];
    const total = values.reduce((a,b)=>a+b, 0);
    
    let startAngle = 0;
    values.forEach((val, idx) => {
      if (val === 0) return;
      const sliceAngle = (val / total) * 2 * Math.PI;
      
      ctx.fillStyle = colors[idx];
      ctx.beginPath();
      ctx.moveTo(125, 125);
      ctx.arc(125, 125, 90, startAngle, startAngle + sliceAngle);
      ctx.closePath();
      ctx.fill();
      
      startAngle += sliceAngle;
    });
    
    // Desenha Legenda
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px sans-serif';
    // Draw center donut cut out for premium look
    ctx.fillStyle = '#0f1322';
    ctx.beginPath();
    ctx.arc(125, 125, 50, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.fill();
  }

  // Gráfico Barra (Produção Acumulada)
  const canvasBar = document.getElementById('chart-bar-os');
  if (canvasBar) {
    const ctx = canvasBar.getContext('2d');
    ctx.clearRect(0,0,350,250);
    
    const months = ['Mar', 'Abr', 'Mai', 'Jun'];
    const values = [42, 65, 89, 124];
    
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px sans-serif';
    
    // Draw Axis
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, 20);
    ctx.lineTo(40, 220);
    ctx.lineTo(330, 220);
    ctx.stroke();
    
    // Draw Bars
    const barWidth = 40;
    const spacing = 30;
    let x = 60;
    
    values.forEach((val, idx) => {
      const barHeight = (val / 150) * 180;
      
      // Gradient
      const grad = ctx.createLinearGradient(0, 220 - barHeight, 0, 220);
      grad.addColorStop(0, '#00bfff');
      grad.addColorStop(1, '#1e3a8a');
      
      ctx.fillStyle = grad;
      ctx.fillRect(x, 220 - barHeight, barWidth, barHeight);
      
      // Text
      ctx.fillStyle = '#9ca3af';
      ctx.fillText(months[idx], x + 10, 235);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(val, x + 12, 215 - barHeight);
      
      x += barWidth + spacing;
    });
  }
}

// 9. GERÊNCIA
function renderIpsTable() {
  const body = document.getElementById('ips-table-body');
  body.innerHTML = '';
  
  dbData.ips.forEach(ip => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${ip.ip}</code></td>
      <td>${ip.setor}</td>
      <td>${ip.descricao}</td>
      <td><span class="badge ${ip.permissao === 'MASTER_IP' ? 'badge-danger' : 'badge-secondary'}">${ip.permissao}</span></td>
      <td>
        <button class="btn-icon btn-sm btn-delete-ip" data-id="${ip.id}" style="color: var(--danger)"><i class="fa-solid fa-trash-can"></i></button>
      </td>
    `;
    
    tr.querySelector('.btn-delete-ip').addEventListener('click', () => {
      if (confirm('Deseja deletar esta regra de IP?')) {
        fetch('api.php?action=ip_delete&id=' + ip.id)
          .then(() => {
            fetchData();
            showToast('Regra de IP removida.');
          });
      }
    });
    
    body.appendChild(tr);
  });
}

function renderActiveComputers() {
  const list = document.getElementById('active-computers-list');
  list.innerHTML = '';
  
  dbData.active_users.forEach(u => {
    const li = document.createElement('li');
    li.className = 'computer-item';
    li.innerHTML = `
      <i class="fa-solid fa-desktop"></i>
      <div class="comp-details">
        <span class="comp-name">${u.nome} (${u.setor})</span>
        <span class="comp-ponto">Ponto: ${u.ponto} | Acesso em: ${u.ultimo_acesso}</span>
      </div>
    `;
    list.appendChild(li);
  });
}

// 10. CHAT DE SUPORTE
function renderChatHistory() {
  const box = document.getElementById('chat-history-box');
  if (!box) return;
  
  box.innerHTML = '';
  dbData.chat_messages.forEach(msg => {
    const div = document.createElement('div');
    const isMe = msg.sender.includes('PCP');
    div.className = `chat-msg ${isMe ? 'sent' : 'received'}`;
    div.innerHTML = `
      <strong>${msg.sender}</strong>
      <p>${msg.message}</p>
      <span class="chat-msg-time">${msg.time}</span>
    `;
    box.appendChild(div);
  });
  
  box.scrollTop = box.scrollHeight;
}

// Simula uma resposta do cliente após o operador enviar mensagem no chat
function simulateClientChatReply(opMessage) {
  const indicator = document.getElementById('chat-typing-indicator');
  
  setTimeout(() => {
    indicator.classList.remove('hidden');
    
    setTimeout(() => {
      indicator.classList.add('hidden');
      
      let reply = 'Certo, vou verificar o link do portal e fazer a aprovação em breve. Obrigada!';
      if (opMessage.toLowerCase().includes('token')) {
        reply = 'Consegui acessar! O mockup 3D do cartão duplo é sensacional, me ajudou muito a entender a dobra.';
      }
      
      const payload = {
        sender: 'Dep. Aline Silva (PL/RJ)',
        message: reply
      };

      fetch('api.php?action=send_chat_message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(() => {
        fetchData();
        // Dispara uma notificação flutuante no header
        document.getElementById('chat-alert-badge').classList.remove('hidden');
        showToast('Nova mensagem recebida no chat de suporte!');
      });
    }, 2500);
  }, 1000);
}

// 11. PROCESSOS EM BACKGROUND SIMULADOS (WebSocket loop)
function simulateBackgroundProcesses() {
  // Aumentar progresso de jobs pendentes de gravação / PCP
  const changed = false;
  
  // 1. Simulação do Laser Xpose C2P
  const xposeLog = document.getElementById('xpose-console-log');
  
  dbData.os_list.forEach(os => {
    if (os.status === 'aprovado' && os.setor === 'C2P / Gravação') {
      // Simula gravação da chapa no Xpose
      const randomProgress = Math.floor(Math.random() * 15) + 5;
      
      // Registra andamento incremental
      if (xposeLog) {
        const line = document.createElement('p');
        line.innerHTML = `[${new Date().toLocaleTimeString()}] Laser Xpose: Gravando chapa OS #${os.nr_os}... Potência 100%`;
        xposeLog.appendChild(line);
        xposeLog.scrollTop = xposeLog.scrollHeight;
      }
      
      // Conclui após algumas voltas
      setTimeout(() => {
        updateOsStatus(
          os.nr_os,
          os.ano,
          'concluido',
          'Expedição',
          'Gravação de chapa C2P finalizada via laser Xpose. Encaminhado para a expedição física.'
        );
        showToast(`Gravação concluída para a OS #${os.nr_os}!`);
      }, 10000);
    }
  });
}

// TOAST NOTIFICATIONS UTILITY
function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 2rem;
    right: 2rem;
    background-color: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--primary);
    border-left: 4px solid var(--primary);
    padding: 0.85rem 1.5rem;
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-lg);
    z-index: 10000;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    animation: slideUp 0.35s ease forwards;
  `;
  toast.innerHTML = `<i class="fa-solid fa-circle-info text-primary"></i> <span>${message}</span>`;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.35s ease forwards';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// Adiciona keyframe dinâmico para slideUp se não houver
const styleSheet = document.createElement("style");
styleSheet.innerText = `
  @keyframes slideUp {
    from { transform: translateY(100px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
`;
document.head.appendChild(styleSheet);
