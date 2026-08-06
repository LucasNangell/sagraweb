<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SAGRA Web — Portal de Acompanhamento Gráfico (Demonstração)</title>
  
  <!-- Google Fonts: Inter e Outfit -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  
  <!-- FontAwesome 6 para Ícones Premium -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  
  <!-- Folha de Estilos Customizada -->
  <link rel="stylesheet" href="style.css">
</head>
<body>

  <!-- Overlay de Identificação por Ponto (Login) -->
  <div id="login-overlay" class="overlay-container">
    <div class="glass-card login-card animated fadeIn">
      <div class="login-header">
        <div class="logo-box">
          <i class="fa-solid fa-layer-group logo-icon"></i>
          <span>SAGRA<span>Web</span></span>
        </div>
        <p>Sistema de Acompanhamento Gráfico e Papelaria</p>
      </div>
      <form id="login-form">
        <div class="input-group">
          <label for="ponto-input"><i class="fa-solid fa-address-card"></i> Matrícula / Ponto</label>
          <input type="text" id="ponto-input" placeholder="Digite seu ponto (ex: 918713)" required autocomplete="off">
        </div>
        <button type="submit" class="btn-primary btn-block">
          <span>Acessar Painel</span> <i class="fa-solid fa-arrow-right"></i>
        </button>
      </form>
      <div class="login-footer">
        <span><i class="fa-solid fa-shield-halved"></i> Ambiente Restrito (Câmara/SEFOC)</span>
      </div>
    </div>
  </div>

  <!-- Contêiner Geral do Sistema -->
  <div id="app-container" class="hidden">
    
    <!-- Sidebar Flutuante -->
    <aside class="sidebar-nav">
      <div class="sidebar-logo">
        <i class="fa-solid fa-layer-group logo-icon"></i>
        <span class="logo-text">SAGRA<span>Web</span></span>
      </div>
      
      <nav class="nav-menu">
        <a href="#painel" class="nav-item active" data-tab="painel">
          <i class="fa-solid fa-chart-line"></i> <span>Painel de OS</span>
        </a>
        <a href="#papelaria" class="nav-item" data-tab="papelaria">
          <i class="fa-solid fa-pen-nib"></i> <span>Papelaria (Corel)</span>
        </a>
        <a href="#analise" class="nav-item" data-tab="analise">
          <i class="fa-solid fa-magnifying-glass-chart"></i> <span>Análise de Qualidade</span>
        </a>
        <a href="#pcp" class="nav-item" data-tab="pcp">
          <i class="fa-solid fa-list-check"></i> <span>Fila PCP</span>
        </a>
        <a href="#gravacao" class="nav-item" data-tab="gravacao">
          <i class="fa-solid fa-compact-disc"></i> <span>Gravação (Xpose)</span>
        </a>
        <a href="#email" class="nav-item" data-tab="email">
          <i class="fa-solid fa-envelope"></i> <span>E-mail EWS</span>
        </a>
        <a href="#relatorios" class="nav-item" data-tab="relatorios">
          <i class="fa-solid fa-file-invoice-dollar"></i> <span>Relatórios</span>
        </a>
        <a href="#gerencia" class="nav-item" data-tab="gerencia">
          <i class="fa-solid fa-gears"></i> <span>Gerência / IPs</span>
        </a>
        <a href="#mensagens" class="nav-item" data-tab="mensagens">
          <i class="fa-solid fa-comments"></i> <span>Suporte Chat</span>
          <span class="badge badge-danger hidden" id="chat-alert-badge">1</span>
        </a>
        
        <div class="nav-separator">Vistas Externas</div>
        <a href="#portal" class="nav-item portal-link" data-tab="portal">
          <i class="fa-solid fa-globe"></i> <span>Portal do Cliente</span>
        </a>
      </nav>
      
      <div class="sidebar-footer">
        <div class="user-badge">
          <i class="fa-solid fa-circle-user avatar"></i>
          <div class="user-info">
            <span class="user-name" id="user-display-name">Operador</span>
            <span class="user-ponto" id="user-display-ponto">Ponto: -----</span>
          </div>
        </div>
        <button id="btn-logout" title="Sair"><i class="fa-solid fa-right-from-bracket"></i></button>
      </div>
    </aside>

    <!-- Área Principal de Conteúdo -->
    <main class="content-wrapper">
      
      <!-- Top Header -->
      <header class="glass-header">
        <div class="header-left">
          <h1 id="page-title">Painel de Ordens de Serviço</h1>
          <div class="os-context-indicator hidden" id="active-os-badge">
            <i class="fa-solid fa-folder-open"></i> OS Ativa: <strong id="active-os-text">Nenhuma</strong>
          </div>
        </div>
        <div class="header-right">
          <!-- Status dos Serviços Sagra -->
          <div class="system-status">
            <span class="status-indicator online" id="status-api" title="API FastAPI rodando na porta 8001">
              <i class="fa-solid fa-server"></i> API :8001
            </span>
            <span class="status-indicator online" id="status-mdb" title="Dual-write Microsoft Access .mdb ativo">
              <i class="fa-solid fa-database"></i> Access MDB
            </span>
            <span class="status-indicator online" id="status-worker" title="Worker CorelDRAW Windows conectado">
              <i class="fa-solid fa-robot"></i> Corel Worker
            </span>
          </div>
          
          <button class="btn-icon" id="btn-reset-db" title="Resetar Banco de Dados Demo"><i class="fa-solid fa-rotate-left"></i></button>
          <div class="notification-bell">
            <i class="fa-regular fa-bell"></i>
            <span class="bell-badge">3</span>
          </div>
        </div>
      </header>

      <!-- SEÇÃO SPA: PAINÉIS INDIVIDUAIS -->
      <div class="tab-content-container">

        <!-- 1. PAINEL DE OS -->
        <section id="panel-painel" class="spa-panel active">
          <!-- Cartões de Resumo Estatístico -->
          <div class="dashboard-cards">
            <div class="stat-card glass-card" data-filter-status="pendente">
              <div class="card-icon blue"><i class="fa-solid fa-clock-rotate-left"></i></div>
              <div class="card-details">
                <span class="stat-value" id="count-pendente">0</span>
                <span class="stat-label">Pendentes de Arte</span>
              </div>
            </div>
            <div class="stat-card glass-card" data-filter-status="producao">
              <div class="card-icon orange"><i class="fa-solid fa-spinner fa-spin-pulse"></i></div>
              <div class="card-details">
                <span class="stat-value" id="count-producao">0</span>
                <span class="stat-label">Em Produção (PCP)</span>
              </div>
            </div>
            <div class="stat-card glass-card" data-filter-status="analise">
              <div class="card-icon purple"><i class="fa-solid fa-eye"></i></div>
              <div class="card-details">
                <span class="stat-value" id="count-analise">0</span>
                <span class="stat-label">Em Análise Técnica</span>
              </div>
            </div>
            <div class="stat-card glass-card" data-filter-status="aprovado">
              <div class="card-icon green"><i class="fa-solid fa-circle-check"></i></div>
              <div class="card-details">
                <span class="stat-value" id="count-aprovado">0</span>
                <span class="stat-label">Aprovadas pelo Cliente</span>
              </div>
            </div>
          </div>

          <!-- Filtros de Busca e Tabela -->
          <div class="glass-card table-section">
            <div class="table-filters">
              <div class="search-box">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" id="os-search-input" placeholder="Buscar por número, titular, produto...">
              </div>
              
              <div class="select-filters">
                <select id="filter-sector">
                  <option value="">Todos os Setores</option>
                  <option value="PCP">PCP</option>
                  <option value="Análise de Qualidade">Análise de Qualidade</option>
                  <option value="C2P / Gravação">C2P / Gravação</option>
                  <option value="Impressão Digital">Impressão Digital</option>
                  <option value="Impressão Offset">Impressão Offset</option>
                  <option value="Acabamento">Acabamento</option>
                </select>
                
                <button class="btn-secondary" id="btn-clear-filters"><i class="fa-solid fa-filter-circle-xmark"></i> Limpar</button>
                <button class="btn-primary" id="btn-new-os"><i class="fa-solid fa-plus"></i> Nova OS</button>
              </div>
            </div>

            <!-- Tabela de OSs -->
            <div class="table-container">
              <table id="os-table">
                <thead>
                  <tr>
                    <th>OS</th>
                    <th>Ano</th>
                    <th>Produto / Tipo</th>
                    <th>Título / Descrição</th>
                    <th>Parlamentar / Solicitante</th>
                    <th>Status</th>
                    <th>Setor</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody id="os-table-body">
                  <!-- Inserido dinamicamente via JS -->
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- 2. PAPELARIA (COREL SIMULATOR) -->
        <section id="panel-papelaria" class="spa-panel">
          <div class="papelaria-layout">
            <!-- Coluna Esquerda: Dados do Modelo -->
            <div class="glass-card papelaria-control-panel">
              <h2 class="section-title"><i class="fa-solid fa-circle-info"></i> Dados da OS e Modelo</h2>
              
              <div class="form-group">
                <label>Variação / Produto Sagra</label>
                <select id="papelaria-product-select">
                  <option value="">Selecione um Modelo Corel...</option>
                  <option value="Ct Visita">Cartão de Visita (Frente e Verso)</option>
                  <option value="Ct Duplo Paisagem Lateral">Cartão Duplo Paisagem Lateral (Dobra)</option>
                  <option value="Timbrado A4">Timbrado A4 Oficial</option>
                  <option value="Pasta Avulso c/ Bolso">Pasta com Bolso Lateral</option>
                </select>
              </div>
              
              <div class="form-group inline-fields">
                <div>
                  <label>Número OS</label>
                  <input type="number" id="pap-nr-os" readonly>
                </div>
                <div>
                  <label>Ano OS</label>
                  <input type="number" id="pap-ano" readonly>
                </div>
              </div>

              <div class="form-separator">Campos Canônicos CorelDRAW</div>
              <div id="papelaria-dynamic-fields">
                <!-- Preenchido dinamicamente baseado no modelo -->
                <p class="placeholder-text">Selecione um modelo de papelaria para renderizar o formulário.</p>
              </div>

              <div class="action-buttons margin-top-lg">
                <button class="btn-secondary btn-block" id="btn-papelaria-prefill"><i class="fa-solid fa-wand-magic-sparkles"></i> Prefill API Câmara</button>
                <button class="btn-primary btn-block" id="btn-process-corel"><i class="fa-solid fa-cogs"></i> Processar Arte no CorelDRAW</button>
              </div>
            </div>

            <!-- Coluna Direita: Simulador Prancheta CorelDRAW -->
            <div class="corel-simulator-container glass-card">
              <!-- Janela Simulação CorelDRAW -->
              <div class="corel-window">
                <div class="corel-titlebar">
                  <span class="corel-title"><i class="fa-solid fa-palette"></i> CorelDRAW 2026 - [SagraWeb_Template.cdr]</span>
                  <div class="corel-window-controls">
                    <span>➖</span> <span>🔲</span> <span>❌</span>
                  </div>
                </div>
                <div class="corel-menubar">
                  <span>Arquivo</span> <span>Editar</span> <span>Exibir</span> <span>Layout</span> <span>Organizar</span> <span>Efeitos</span> <span>Bitmaps</span> <span>Texto</span> <span>Ferramentas</span>
                </div>
                <div class="corel-workspace">
                  <!-- Ferramentas Lateral Corel -->
                  <div class="corel-toolbox">
                    <button class="active" title="Seleção"><i class="fa-solid fa-arrow-pointer"></i></button>
                    <button title="Forma (F10)"><i class="fa-solid fa-bezier-curve"></i></button>
                    <button title="Cortar"><i class="fa-solid fa-crop-simple"></i></button>
                    <button title="Zoom"><i class="fa-solid fa-magnifying-glass"></i></button>
                    <button title="Mão Livre"><i class="fa-solid fa-pen-nib"></i></button>
                    <button title="Retângulo"><i class="fa-regular fa-square"></i></button>
                    <button title="Elipse"><i class="fa-regular fa-circle"></i></button>
                    <button title="Polígono"><i class="fa-solid fa-draw-polygon"></i></button>
                    <button title="Texto (F8)"><i class="fa-solid fa-font"></i></button>
                    <button title="Sombra"><i class="fa-solid fa-clone"></i></button>
                  </div>
                  <!-- Mesa de Trabalho Central -->
                  <div class="corel-canvas-area">
                    <div class="corel-rulers-h"></div>
                    <div class="corel-rulers-v"></div>
                    <div class="corel-artboard" id="corel-artboard">
                      <!-- Renderizado via corel_editor.js -->
                      <div class="corel-rendered-design" id="corel-rendered-design"></div>
                    </div>
                  </div>
                  <!-- Inspetor de Objetos Direito -->
                  <div class="corel-inspector">
                    <div class="inspector-header">Gerenciador de Objetos</div>
                    <div class="inspector-tree">
                      <ul>
                        <li><i class="fa-solid fa-file"></i> Página 1
                          <ul>
                            <li><i class="fa-solid fa-layer-group"></i> Camada 1
                              <ul id="corel-inspector-shapes">
                                <!-- Shape layers -->
                              </ul>
                            </li>
                          </ul>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div class="corel-statusbar">
                  <span>Pronto</span> <span>X: 105.0 mm | Y: 148.0 mm</span> <span>Preenchimento: Nenhum</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 3. ANÁLISE DE QUALIDADE (3D PREVIEW) -->
        <section id="panel-analise" class="spa-panel">
          <div class="analise-layout">
            <!-- Lado Esquerdo: Check-list e Ações -->
            <div class="glass-card analise-checklist-panel">
              <h2 class="section-title"><i class="fa-solid fa-circle-check"></i> Checklist de Qualidade</h2>
              
              <ul class="checklist-items">
                <li>
                  <label class="checklist-item">
                    <input type="checkbox" id="chk-margin" class="quality-checkbox">
                    <span class="chk-label">Sangrias e Margens de Segurança (3mm)</span>
                  </label>
                </li>
                <li>
                  <label class="checklist-item">
                    <input type="checkbox" id="chk-font" class="quality-checkbox">
                    <span class="chk-label">Tipografia / Fontes Convertidas em Curvas</span>
                  </label>
                </li>
                <li>
                  <label class="checklist-item">
                    <input type="checkbox" id="chk-colors" class="quality-checkbox">
                    <span class="chk-label">Cores em CMYK (sem objetos RGB)</span>
                  </label>
                </li>
                <li>
                  <label class="checklist-item">
                    <input type="checkbox" id="chk-resolution" class="quality-checkbox">
                    <span class="chk-label">Imagens com 300 DPI ou superior</span>
                  </label>
                </li>
                <li>
                  <label class="checklist-item">
                    <input type="checkbox" id="chk-ortho" class="quality-checkbox">
                    <span class="chk-label">Ortografia e Dados do Deputado validados</span>
                  </label>
                </li>
              </ul>
              
              <div class="form-separator">Aprovação Cliente / Portal</div>
              <div class="approval-status-box glass-card margin-bottom-md">
                <div class="status-row">
                  <span>Aprovação Parlamentar:</span>
                  <strong id="client-approval-badge" class="badge badge-warning">Pendente</strong>
                </div>
                <div class="status-row">
                  <span>Token do Link de Prova:</span>
                  <code id="client-token-display">tkn-XXXXX</code>
                </div>
              </div>

              <div class="action-buttons">
                <button class="btn-success btn-block" id="btn-approve-qa" disabled><i class="fa-solid fa-check-double"></i> Aprovar Arte e Enviar p/ PCP</button>
                <button class="btn-danger btn-block" id="btn-reject-qa"><i class="fa-solid fa-ban"></i> Rejeitar e Notificar Ajuste</button>
              </div>
            </div>

            <!-- Lado Direito: Viewport 3D Mockup -->
            <div class="glass-card preview3d-container">
              <div class="viewport-3d-header">
                <h3><i class="fa-solid fa-cube"></i> Mockup 3D Interativo da Arte</h3>
                <span class="instructions-3d"><i class="fa-solid fa-circle-info"></i> Clique e arraste para girar no espaço</span>
              </div>
              
              <!-- Janela Principal do Viewport 3D -->
              <div class="pm3d-viewport" id="viewport-3d-scene-container">
                <div class="pm3d-scene" id="scene-3d">
                  <div class="pm3d-product" id="product-3d">
                    <!-- Gerado via mockup3d.js -->
                  </div>
                </div>
              </div>

              <!-- Controles do Viewport 3D -->
              <div class="viewport-3d-controls">
                <div class="control-row">
                  <label><i class="fa-solid fa-magnifying-glass"></i> Zoom
                    <input type="range" id="slider-zoom" min="0.6" max="1.5" step="0.05" value="1">
                  </label>
                  <label><i class="fa-solid fa-arrows-spin"></i> Rotação Y
                    <input type="range" id="slider-rot-y" min="-180" max="180" step="1" value="-30">
                  </label>
                  <label id="fold-control-wrapper" class="hidden"><i class="fa-solid fa-book-open"></i> Abertura Dobra
                    <input type="range" id="slider-fold" min="0" max="1" step="0.02" value="0.3">
                  </label>
                </div>
                <div class="control-row">
                  <button class="btn-secondary btn-sm" id="btn-toggle-face">Girar Frente/Verso</button>
                  <button class="btn-secondary btn-sm" id="btn-reset-3d">Resetar Câmera</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 4. FILA PCP -->
        <section id="panel-pcp" class="spa-panel">
          <div class="glass-card table-section">
            <div class="pcp-header">
              <h2><i class="fa-solid fa-list-ol"></i> Fila de Planejamento e Controle de Produção (PCP)</h2>
              <p>Gerencie a ordem de prioridade das OSs em produção e aloque operadores.</p>
            </div>
            
            <div class="table-container">
              <table id="pcp-table">
                <thead>
                  <tr>
                    <th>Prioridade</th>
                    <th>OS</th>
                    <th>Produto</th>
                    <th>Título / Trabalho</th>
                    <th>Solicitante</th>
                    <th>Operador Alocado</th>
                    <th>Status</th>
                    <th>Ações de Fila</th>
                  </tr>
                </thead>
                <tbody id="pcp-table-body">
                  <!-- Inserido dinamicamente via JS -->
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- 5. GRAVAÇÃO (XPOSE JOBS) -->
        <section id="panel-gravacao" class="spa-panel">
          <div class="gravacao-layout">
            <!-- Esquerda: Fila de Laser Xpose -->
            <div class="glass-card gravacao-queue">
              <h2 class="section-title"><i class="fa-solid fa-laser-cutter"></i> Gravação de Chapas C2P - Laser Xpose</h2>
              
              <div class="jobs-list" id="gravacao-jobs-list">
                <!-- Gravacao jobs list dynamic -->
              </div>
            </div>
            <!-- Direita: Detalhes da Gravação e Simulação -->
            <div class="glass-card gravacao-details">
              <h2 class="section-title"><i class="fa-solid fa-circle-nodes"></i> Console do Gravador C2P</h2>
              <div class="xpose-console">
                <div class="console-screen" id="xpose-console-log">
                  <p class="system-log">[SYSTEM] Inicializando gravador a laser Xpose...</p>
                  <p class="system-log">[SYSTEM] Aguardando chapas C2P da Fila de Produção...</p>
                </div>
              </div>
              <div class="xpose-machine-status glass-card margin-top-md">
                <div class="status-row">
                  <span>Temperatura do Diodo:</span>
                  <strong class="text-success">22.4 °C (Estável)</strong>
                </div>
                <div class="status-row">
                  <span>Velocidade de Rotação:</span>
                  <strong class="text-success">850 RPM</strong>
                </div>
                <div class="status-row">
                  <span>Potência do Laser:</span>
                  <strong class="text-success">180 mW</strong>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 6. E-MAIL EWS -->
        <section id="panel-email" class="spa-panel">
          <div class="email-layout">
            <!-- Editor de E-mail -->
            <div class="glass-card email-editor">
              <h2 class="section-title"><i class="fa-solid fa-paper-plane"></i> Envio de Prova por E-mail (EWS)</h2>
              
              <div class="form-group">
                <label>Selecionar Preset de Layout</label>
                <select id="email-preset-select">
                  <option value="prova_os">Layout Prova - OS Papelaria</option>
                  <option value="prova_sp">Layout Prova - Impressão Geral</option>
                  <option value="portal_aprovacao">Notificação de Acesso ao Portal do Cliente</option>
                </select>
              </div>

              <div class="form-group">
                <label>Destinatário (E-mail do Deputado/Assessor)</label>
                <input type="email" id="email-to" placeholder="ex: dep.nome@camara.leg.br">
              </div>

              <div class="form-group">
                <label>Assunto</label>
                <input type="text" id="email-subject" placeholder="Assunto do e-mail">
              </div>

              <div class="form-group">
                <label>Mensagem HTML / Corpo</label>
                <textarea id="email-body" rows="12"></textarea>
              </div>

              <button class="btn-primary btn-block" id="btn-send-email"><i class="fa-solid fa-share-from-square"></i> Enviar via Microsoft Exchange (SSPI)</button>
            </div>

            <!-- Preview HTML do E-mail -->
            <div class="glass-card email-preview">
              <h2 class="section-title"><i class="fa-solid fa-desktop"></i> Visualização do E-mail</h2>
              <div class="email-preview-frame" id="email-preview-frame">
                <!-- Preview Render HTML -->
              </div>
            </div>
          </div>
        </section>

        <!-- 7. RELATÓRIOS -->
        <section id="panel-relatorios" class="spa-panel">
          <div class="relatorios-layout">
            <div class="glass-card relatorios-filters">
              <h2 class="section-title"><i class="fa-solid fa-filter"></i> Filtros de Relatórios</h2>
              
              <div class="form-group">
                <label>Período</label>
                <select id="report-range">
                  <option value="7">Últimos 7 dias</option>
                  <option value="30">Últimos 30 dias</option>
                  <option value="90">Últimos 90 dias</option>
                </select>
              </div>

              <div class="form-group">
                <label>Tipo de Agrupamento</label>
                <select id="report-group">
                  <option value="sector">Por Setor</option>
                  <option value="status">Por Status</option>
                  <option value="product">Por Tipo de Produto</option>
                </select>
              </div>

              <button class="btn-primary btn-block" id="btn-generate-report"><i class="fa-solid fa-chart-pie"></i> Atualizar Relatório</button>
              <button class="btn-secondary btn-block" id="btn-download-pdf-report"><i class="fa-solid fa-file-pdf"></i> Exportar FPDF (Simulação)</button>
            </div>

            <div class="glass-card relatorios-charts">
              <h2 class="section-title"><i class="fa-solid fa-chart-column"></i> Gráficos Estatísticos</h2>
              
              <div class="charts-container-row">
                <div class="chart-box">
                  <h4>Distribuição de Ordens de Serviço</h4>
                  <canvas id="chart-pie-os" width="250" height="250"></canvas>
                </div>
                <div class="chart-box">
                  <h4>Produção Mensal Acumulada</h4>
                  <canvas id="chart-bar-os" width="350" height="250"></canvas>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 8. GERÊNCIA / IPS -->
        <section id="panel-gerencia" class="spa-panel">
          <div class="gerencia-layout">
            <!-- Controle de IPs com RBAC -->
            <div class="glass-card gerencia-ips-panel">
              <div class="ips-header">
                <h2><i class="fa-solid fa-network-wired"></i> IPs Autorizados no Sistema (RBAC)</h2>
                <button class="btn-primary btn-sm" id="btn-add-ip"><i class="fa-solid fa-plus"></i> Novo IP</button>
              </div>
              
              <div class="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Endereço IP</th>
                      <th>Setor</th>
                      <th>Descrição</th>
                      <th>Nível Permissão</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody id="ips-table-body">
                    <!-- Dynamic ips list -->
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Computadores Conectados Ativos -->
            <div class="glass-card gerencia-computers-panel">
              <h2><i class="fa-solid fa-computer"></i> Computadores Ativos na Rede</h2>
              <p class="description">Monitoramento de logins ativos e computadores conectados na intranet.</p>
              
              <ul class="computer-list" id="active-computers-list">
                <!-- dynamic active users -->
              </ul>
            </div>
          </div>
        </section>

        <!-- 9. CHAT SUPORTE -->
        <section id="panel-mensagens" class="spa-panel">
          <div class="chat-container glass-card">
            <div class="chat-sidebar">
              <div class="chat-sidebar-header">Conversas Ativas</div>
              <div class="chat-contact active">
                <i class="fa-solid fa-circle-user contact-avatar"></i>
                <div class="contact-details">
                  <span class="contact-name">Dep. Aline Silva (PL/RJ)</span>
                  <span class="contact-status online">Online</span>
                </div>
              </div>
              <div class="chat-contact">
                <i class="fa-solid fa-circle-user contact-avatar"></i>
                <div class="contact-details">
                  <span class="contact-name">Assessor Dep. Rodrigo</span>
                  <span class="contact-status offline">Offline</span>
                </div>
              </div>
            </div>
            <div class="chat-messages-area">
              <div class="chat-header">
                <div class="active-contact-info">
                  <span class="active-contact-name">Deputado Aline Silva (Gabinete 254 - PL/RJ)</span>
                  <span class="active-contact-status">Fila OS #5022</span>
                </div>
              </div>
              
              <!-- Corpo de Mensagens -->
              <div class="chat-history" id="chat-history-box">
                <!-- Dynamic messages -->
              </div>
              
              <div class="chat-typing-indicator hidden" id="chat-typing-indicator">
                <span></span><span></span><span></span> A deputada está digitando...
              </div>

              <!-- Input de envio -->
              <form class="chat-input-bar" id="chat-send-form">
                <input type="text" id="chat-input-msg" placeholder="Digite uma mensagem para o cliente..." autocomplete="off">
                <button type="submit" class="btn-primary"><i class="fa-solid fa-paper-plane"></i></button>
              </form>
            </div>
          </div>
        </section>

        <!-- 10. PORTAL DO CLIENTE (VISTA EXTERNA) -->
        <section id="panel-portal" class="spa-panel">
          <div id="portal-login-screen" class="glass-card portal-login-box">
            <div class="portal-logo">
              <i class="fa-solid fa-globe"></i>
              <span>Portal de Provas <span>SagraWeb</span></span>
            </div>
            <p>Insira seu Token de Prova para acessar a aprovação visual.</p>
            <form id="portal-login-form">
              <div class="input-group">
                <label>Token de Prova</label>
                <input type="text" id="portal-token-input" placeholder="ex: tkn-5022-b2z" required autocomplete="off">
              </div>
              <button type="submit" class="btn-primary btn-block">Acessar Prova Digital</button>
            </form>
          </div>

          <div id="portal-workspace-screen" class="hidden">
            <div class="portal-header-bar">
              <div class="portal-info-left">
                <h2>Prova Digital — OS #<span id="portal-os-id">0000</span></h2>
                <p>Produto: <strong id="portal-os-product">---</strong> | Solicitação: <span id="portal-os-date">--/--/----</span></p>
              </div>
              <button class="btn-secondary" id="btn-portal-exit"><i class="fa-solid fa-right-from-bracket"></i> Sair do Portal</button>
            </div>

            <div class="portal-main-layout">
              <!-- Visualização 3D -->
              <div class="glass-card portal-mockup-area">
                <div class="pm3d-viewport" id="portal-viewport-3d-scene-container">
                  <div class="pm3d-scene" id="portal-scene-3d">
                    <div class="pm3d-product" id="portal-product-3d">
                      <!-- Renderizado via JS -->
                    </div>
                  </div>
                </div>
                
                <div class="portal-mockup-controls">
                  <label>Rotação Y
                    <input type="range" id="portal-slider-rot-y" min="-180" max="180" step="1" value="-30">
                  </label>
                  <label id="portal-fold-control-wrapper" class="hidden">Abertura Dobra
                    <input type="range" id="portal-slider-fold" min="0" max="1" step="0.02" value="0.3">
                  </label>
                  <button class="btn-secondary btn-sm" id="btn-portal-toggle-face">Girar Frente/Verso</button>
                </div>
              </div>

              <!-- Formulário de Decisão -->
              <div class="glass-card portal-decision-area">
                <h3>Decisão de Prova</h3>
                <p>Analise a simulação tridimensional do seu arquivo acima. Certifique-se de que os dados e a disposição do layout estão de acordo com o solicitado.</p>
                
                <div class="decision-box">
                  <button class="btn-success btn-block" id="btn-portal-approve"><i class="fa-solid fa-circle-check"></i> APROVAR LAYOUT</button>
                  <button class="btn-danger btn-block" id="btn-portal-reject"><i class="fa-solid fa-circle-xmark"></i> REJEITAR / SOLICITAR AJUSTES</button>
                </div>

                <div class="form-group margin-top-md hidden" id="portal-reject-reason-box">
                  <label>Descreva as correções necessárias:</label>
                  <textarea id="portal-reject-reason" rows="4" placeholder="Ex: Ajustar o telefone do assessor para (11) 99999-9999"></textarea>
                  <button class="btn-primary btn-block margin-top-sm" id="btn-portal-submit-reject">Enviar Correção</button>
                </div>
              </div>
            </div>
          </div>
        </section>

      </div>
    </main>
  </div>

  <!-- Modal para Criar Nova OS -->
  <div id="modal-new-os" class="modal-overlay hidden">
    <div class="glass-card modal-box">
      <div class="modal-header">
        <h3>Nova Ordem de Serviço (MDB Mock)</h3>
        <button class="btn-close" id="btn-close-os-modal">&times;</button>
      </div>
      <form id="new-os-form">
        <div class="form-group inline-fields">
          <div>
            <label>Número OS</label>
            <input type="number" id="new-nr-os" required>
          </div>
          <div>
            <label>Ano</label>
            <input type="number" id="new-ano" value="2026" required>
          </div>
        </div>
        
        <div class="form-group">
          <label>Produto / Tipo</label>
          <select id="new-produto" required>
            <option value="Ct Visita">Cartão de Visita</option>
            <option value="Ct Duplo Paisagem Lateral">Cartão Duplo Paisagem Lateral</option>
            <option value="Timbrado A4">Timbrado A4</option>
            <option value="Pasta Avulso c/ Bolso">Pasta com Bolso</option>
            <option value="Panfleto A5">Panfleto A5</option>
          </select>
        </div>

        <div class="form-group">
          <label>Título do Serviço</label>
          <input type="text" id="new-titulo" placeholder="Ex: Cartão de Visita Oficial Deputado..." required>
        </div>

        <div class="form-group inline-fields">
          <div>
            <label>Parlamentar (Titular)</label>
            <input type="text" id="new-titular" placeholder="Nome Eleitoral" required>
          </div>
          <div>
            <label>Solicitante</label>
            <input type="text" id="new-solicitante" placeholder="Nome do Assessor ou Solicitante">
          </div>
        </div>

        <div class="form-group inline-fields">
          <div>
            <label>Partido</label>
            <input type="text" id="new-partido" placeholder="Ex: PT" required>
          </div>
          <div>
            <label>UF</label>
            <input type="text" id="new-uf" placeholder="Ex: SP" maxLength="2" required style="text-transform: uppercase;">
          </div>
        </div>

        <div class="form-group inline-fields">
          <div>
            <label>Gabinete</label>
            <input type="text" id="new-gabinete" placeholder="Ex: 342" required>
          </div>
          <div>
            <label>Anexo</label>
            <select id="new-anexo" required>
              <option value="IV">Anexo IV</option>
              <option value="III">Anexo III</option>
              <option value="Gabinete Liderança">Liderança</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label>E-mail do Parlamentar</label>
          <input type="email" id="new-email" placeholder="dep.nome@camara.leg.br" required>
        </div>

        <div class="form-group inline-fields">
          <div>
            <label>Cores</label>
            <select id="new-cores">
              <option value="4x4 (Policromia)">4x4 (Frente/Verso Colorido)</option>
              <option value="4x0">4x0 (Frente Colorida)</option>
              <option value="1x0 (Preto)">1x0 (Monocromático)</option>
            </select>
          </div>
          <div>
            <label>Frente/Verso</label>
            <select id="new-fv">
              <option value="Frente e Verso">Frente e Verso</option>
              <option value="Somente Frente">Somente Frente</option>
            </select>
          </div>
        </div>

        <button type="submit" class="btn-primary btn-block margin-top-md">Salvar OS no MDB (MySQL Sync)</button>
      </form>
    </div>
  </div>

  <!-- Modal do Terminal do Worker CorelDRAW -->
  <div id="modal-worker" class="modal-overlay hidden">
    <div class="glass-card modal-box worker-terminal-box">
      <div class="modal-header">
        <h3><i class="fa-solid fa-terminal"></i> Terminal do Sagra CorelDRAW Worker</h3>
        <span class="worker-id-tag">ID: Worker-Corel-01 (IP: 192.168.1.55)</span>
      </div>
      <div class="worker-console-body">
        <div class="worker-progress-container">
          <div class="worker-progress-bar-fill" id="worker-progress-fill">0%</div>
        </div>
        <div class="worker-log-output" id="worker-log-output">
          <!-- Terminal steps dynamic -->
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="btn-close-worker-modal" disabled>Aguardando Conclusão...</button>
      </div>
    </div>
  </div>

  <!-- Modal Visualização de Detalhes da OS (Histórico e Ações) -->
  <div id="modal-os-details" class="modal-overlay hidden">
    <div class="glass-card modal-box details-box">
      <div class="modal-header">
        <h3>Detalhes da OS #<span id="det-nr-os">0000</span></h3>
        <button class="btn-close" id="btn-close-details-modal">&times;</button>
      </div>
      
      <div class="details-grid">
        <div class="details-metadata">
          <h4>Metadados Gerais</h4>
          <p><strong>Produto:</strong> <span id="det-produto">---</span></p>
          <p><strong>Título:</strong> <span id="det-titulo">---</span></p>
          <p><strong>Parlamentar:</strong> <span id="det-titular">---</span> (<span id="det-partido-uf">--/--</span>)</p>
          <p><strong>Gabinete:</strong> Sala <span id="det-gabinete">--</span>, Anexo <span id="det-anexo">--</span></p>
          <p><strong>E-mail:</strong> <span id="det-email">---</span></p>
          <p><strong>Solicitante:</strong> <span id="det-solicitante">---</span></p>
          <p><strong>Cores / Layout:</strong> <span id="det-cores">---</span> | <span id="det-fv">---</span></p>
          <p><strong>Setor Atual:</strong> <strong id="det-setor" class="text-orange">---</strong></p>
          <p><strong>Aprovação Cliente:</strong> <span id="det-aprovacao">---</span></p>
          
          <div class="action-panel-box margin-top-md">
            <h4>Ações Rápidas</h4>
            <div class="quick-actions-row">
              <button class="btn-primary btn-sm" id="btn-det-process-papelaria"><i class="fa-solid fa-pen-nib"></i> Ir p/ Papelaria</button>
              <button class="btn-secondary btn-sm" id="btn-det-ver-prova"><i class="fa-solid fa-magnifying-glass-chart"></i> Ver Prova QA</button>
              <button class="btn-secondary btn-sm" id="btn-det-send-ews"><i class="fa-solid fa-envelope"></i> Enviar E-mail</button>
            </div>
            
            <div class="status-change-box margin-top-md">
              <label>Mudar Status Manualmente</label>
              <div class="inline-fields">
                <select id="det-change-status-select">
                  <option value="pendente">Pendente de Arte</option>
                  <option value="producao">Em Produção (PCP)</option>
                  <option value="analise">Em Análise Técnica</option>
                  <option value="aprovado">Aprovado pelo Cliente</option>
                  <option value="concluido">Concluído / Arquivado</option>
                </select>
                <button class="btn-primary btn-sm" id="btn-det-save-status">Salvar</button>
              </div>
            </div>
          </div>
        </div>

        <div class="details-history">
          <h4>Histórico de Andamentos (MDB Sync log)</h4>
          <div class="history-timeline" id="det-history-timeline">
            <!-- Timeline elements -->
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Bibliotecas / Módulos Javascript -->
  <script src="mockup3d.js"></script>
  <script src="corel_editor.js"></script>
  <script src="app.js"></script>
</body>
</html>
