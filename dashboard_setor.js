const { createApp, ref, onMounted, onUnmounted, watch } = Vue;

createApp({
    setup() {
        // =================================================================
        // WAKE LOCK API - Impede que o monitor desligue
        // =================================================================
        let wakeLock = null;
        let wakeLockSupported = false;

        // Verificar suporte ao Wake Lock API
        if ('wakeLock' in navigator) {
            wakeLockSupported = true;
            console.log('[Wake Lock] API suportada');
        } else {
            console.warn('[Wake Lock] API nao suportada - usando fallback');
        }

        // Solicitar Wake Lock
        const requestWakeLock = async () => {
            if (!wakeLockSupported) {
                return;
            }

            try {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('[Wake Lock] Ativado com sucesso');

                // Listener para quando o wake lock for liberado
                wakeLock.addEventListener('release', () => {
                    console.log('[Wake Lock] Liberado');
                    wakeLock = null;
                });

            } catch (err) {
                console.error('[Wake Lock] Erro ao ativar:', err.message);
                wakeLock = null;
            }
        };

        // Liberar Wake Lock
        const releaseWakeLock = async () => {
            if (wakeLock !== null) {
                try {
                    await wakeLock.release();
                    wakeLock = null;
                    console.log('[Wake Lock] Liberado manualmente');
                } catch (err) {
                    console.error('[Wake Lock] Erro ao liberar:', err);
                }
            }
        };

        // Gerenciar Wake Lock baseado na visibilidade da aba
        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible') {
                console.log('[Wake Lock] Aba visivel - reativando');
                await requestWakeLock();
            } else {
                console.log('[Wake Lock] Aba oculta - liberando');
                await releaseWakeLock();
            }
        };

        // FALLBACK: Manter atividade sem Wake Lock API
        let fallbackIntervalId = null;
        const startFallback = () => {
            if (wakeLockSupported) {
                return; // Nao precisa de fallback
            }

            console.log('[Wake Lock Fallback] Iniciando manutenção de atividade');
            
            // Usar requestAnimationFrame para manter atividade
            let lastTime = Date.now();
            const keepActive = () => {
                const now = Date.now();
                // A cada 30 segundos, fazer uma micro-operacao
                if (now - lastTime > 30000) {
                    // Operacao invisivel que mantém navegador "ativo"
                    document.title = document.title; // No-op visual
                    lastTime = now;
                }
                fallbackIntervalId = requestAnimationFrame(keepActive);
            };

            fallbackIntervalId = requestAnimationFrame(keepActive);
        };

        const stopFallback = () => {
            if (fallbackIntervalId !== null) {
                cancelAnimationFrame(fallbackIntervalId);
                fallbackIntervalId = null;
                console.log('[Wake Lock Fallback] Parado');
            }
        };

        // =================================================================
        // KEEP-ALIVE AGRESSIVO - Simula atividade para manter monitor ligado
        // =================================================================
        let keepAliveInterval = null;
        
        const startKeepAlive = () => {
            console.log('[Keep-Alive] Iniciando modo leve');
            // No user-input simulation to avoid page event handlers; just keep a small tick
            const tick = () => {
                try {
                    // Touch document title to keep minimal activity without triggering listeners
                    document.title = document.title;
                } catch (err) {
                    console.warn('[Keep-Alive] Tick falhou:', err?.message || err);
                }
            };
            tick();
            keepAliveInterval = setInterval(tick, 60000);
        };
        
        const stopKeepAlive = () => {
            if (keepAliveInterval !== null) {
                clearInterval(keepAliveInterval);
                keepAliveInterval = null;
                console.log('[Keep-Alive] Simulacao parada');
            }
        };
        // =================================================================

        // Inicializar Wake Lock ao montar componente
        onMounted(async () => {
            console.log('[Wake Lock] Inicializando sistema');
            
            // Solicitar Wake Lock inicial
            await requestWakeLock();

            // Iniciar fallback se necessario
            if (!wakeLockSupported) {
                startFallback();
            }

            // Iniciar Keep-Alive agressivo (sempre, como garantia adicional)
            startKeepAlive();

            // Listeners para gerenciar visibilidade
            document.addEventListener('visibilitychange', handleVisibilityChange);
            
            // Listeners para foco da janela
            window.addEventListener('focus', async () => {
                console.log('[Wake Lock] Janela em foco - reativando');
                await requestWakeLock();
            });

            window.addEventListener('blur', async () => {
                console.log('[Wake Lock] Janela fora de foco - mantendo ativo');
                // Nao liberar no blur, apenas no visibility hidden
            });

            // Carregar configuracoes e dados
            loadConfig();
            await loadSetores();
            await loadAndamentos();
            fetchData();
            
            // Iniciar WebSocket (atualização instantânea)
            setupWebSocket();
            
            // Iniciar timer como fallback (caso WebSocket falhe)
            startTimer();

            // Initialize Lucide icons if available globally
            if (window.lucide) window.lucide.createIcons();
        });

        // Liberar recursos ao desmontar
        onUnmounted(() => {
            console.log('[Wake Lock] Limpando recursos');
            releaseWakeLock();
            stopFallback();
            stopKeepAlive();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        });

        // =================================================================
        // FIM WAKE LOCK API
        // =================================================================

        const apiPort = window.SAGRA_API_PORT || window.location.port || 8001;
        const forcedBase = 'http://10.120.1.12:8001/api';
        const candidateApiBases = Array.from(new Set([
            forcedBase,
            `http://${window.location.hostname}:${apiPort}/api`,
            `http://${window.location.hostname}:${apiPort}`
        ].filter(Boolean)));
        let resolvedApiBase = null;

        const getApiBases = () => resolvedApiBase ? [resolvedApiBase] : candidateApiBases;

        const fetchJsonWithFallback = async (path) => {
            const bases = getApiBases();
            let lastError = null;
            for (const base of bases) {
                const url = `${base}${path}`;
                try {
                    console.log('[API] GET', url);
                    const response = await fetch(url, { cache: 'no-store' });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const data = await response.json();
                    resolvedApiBase = base;
                    return data;
                } catch (err) {
                    lastError = err;
                    console.warn('[API] Falha em', url, err?.message || err);
                }
            }
            throw lastError || new Error('Todas as bases falharam');
        };

        // --- State ---
        const lastUpdated = ref("Carregando...");
        const progress = ref(0);
        const connectionStatus = ref('disconnected'); // 'connected' | 'disconnected'
        const showSettings = ref(false);
        const setoresList = ref([]);
        const andamentosList = ref([]);

        // Configuration State (Persisted)
        const config = ref({
            sector: "SEFOC",
            columnCount: 4,
            columns: [
                {
                    id: 'col_0',
                    title: 'p/ Triagem',
                    statuses: ['Saída p/', 'Saída parcial p/', 'Entrada Inicial', 'Tramit. de Prova p/', 'Tramit. de Prévia p/', 'Comentário']
                },
                {
                    id: 'col_1',
                    title: 'Em Execução',
                    statuses: ['Em Execução', 'Recebido']
                },
                {
                    id: 'col_2',
                    title: 'Problemas Técnicos',
                    statuses: ['Problemas Técnicos', 'Problema Técnico']
                },
                {
                    id: 'col_3',
                    title: 'Enviar e-mail',
                    statuses: ['Encam. de Docum.']
                }
            ]
        });

        const tempConfig = ref(JSON.parse(JSON.stringify(config.value))); // Deep copy for modal editing

        // Display Data
        const columns = ref([]);
        const unmappedItems = ref([]); // Itens que não casam com nenhum andamento configurado
        const previousDataMap = ref(new Map()); // To track "New" items
        const hiddenCount = ref(0); // Quantidade de OSs fora dos filtros

        // --- Logic ---

        // Fetch available setores from API
        const loadSetores = async () => {
            try {
                const result = await fetchJsonWithFallback('/aux/setores');
                if (result && Array.isArray(result) && result.length > 0) {
                    setoresList.value = result.map(item => item.Setor);
                    console.log("Setores carregados:", setoresList.value);
                } else {
                    console.warn("Nenhum setor retornado da API");
                }
            } catch (error) {
                console.error("Error loading setores:", error);
            }
        };

        // Fetch available andamentos from API
        const loadAndamentos = async () => {
            try {
                const result = await fetchJsonWithFallback('/aux/andamentos');
                if (result && Array.isArray(result) && result.length > 0) {
                    andamentosList.value = result.map(item => item.Situacao);
                    console.log("Andamentos carregados:", andamentosList.value);
                } else {
                    console.warn("Nenhum andamento retornado da API");
                }
            } catch (error) {
                console.error("Error loading andamentos:", error);
            }
        };

        // Toggle andamento for a column
        const toggleAndamento = (colIdx, andamento) => {
            const col = tempConfig.value.columns[colIdx];
            const idx = col.statuses.indexOf(andamento);
            if (idx === -1) {
                col.statuses.push(andamento);
            } else {
                col.statuses.splice(idx, 1);
            }
        };

        // Add new column
        const addColumn = () => {
            if (tempConfig.value.columns.length >= 6) {
                alert('Máximo de 6 colunas atingido!');
                return;
            }
            const newId = `col_${Date.now()}`;
            tempConfig.value.columns.push({
                id: newId,
                title: `Coluna ${tempConfig.value.columns.length + 1}`,
                statuses: []
            });
            tempConfig.value.columnCount = tempConfig.value.columns.length;
        };

        // Remove column
        const removeColumn = (idx) => {
            if (tempConfig.value.columns.length <= 1) {
                alert('É necessário ter pelo menos 1 coluna!');
                return;
            }
            tempConfig.value.columns.splice(idx, 1);
            tempConfig.value.columnCount = tempConfig.value.columns.length;
        };

        // Adjust columns based on columnCount input
        const adjustColumns = () => {
            const targetCount = parseInt(tempConfig.value.columnCount) || 1;
            const currentCount = tempConfig.value.columns.length;

            // Validate bounds
            if (targetCount < 1) {
                tempConfig.value.columnCount = 1;
                return;
            }
            if (targetCount > 6) {
                tempConfig.value.columnCount = 6;
                return;
            }

            // Add columns if needed
            while (tempConfig.value.columns.length < targetCount) {
                const newId = `col_${Date.now()}_${tempConfig.value.columns.length}`;
                tempConfig.value.columns.push({
                    id: newId,
                    title: `Coluna ${tempConfig.value.columns.length + 1}`,
                    statuses: []
                });
            }

            // Remove columns if needed
            while (tempConfig.value.columns.length > targetCount) {
                tempConfig.value.columns.pop();
            }
        };

        // Load Config from LocalStorage
        const loadConfig = () => {
            const saved = localStorage.getItem('sagra_dashboard_config');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    // Merge to ensure structure integrity
                    config.value.sector = parsed.sector || "SEFOC";
                    config.value.columnCount = parsed.columnCount || parsed.columns?.length || 4;
                    if (parsed.columns && parsed.columns.length > 0) {
                        config.value.columns = parsed.columns;
                    }
                } catch (e) { console.error("Error loading config", e); }
            }
            // Sync columnCount with actual columns length
            config.value.columnCount = config.value.columns.length;
            // Initialize display columns from config
            columns.value = config.value.columns.map(c => ({ ...c, items: [] }));
            tempConfig.value = JSON.parse(JSON.stringify(config.value));
        };

        const openSettings = () => {
            // Deep copy config when opening modal
            tempConfig.value = JSON.parse(JSON.stringify(config.value));
            showSettings.value = true;
        };

        const saveSettings = () => {
            config.value = JSON.parse(JSON.stringify(tempConfig.value));
            localStorage.setItem('sagra_dashboard_config', JSON.stringify(config.value));
            showSettings.value = false;
            // Re-init columns and fetch immediately
            columns.value = config.value.columns.map(c => ({ ...c, items: [] }));
            previousDataMap.value.clear(); // Clear history to avoid stale comparisons
            fetchData();
        };

        const clearCache = () => {
            if (confirm('Tem certeza que deseja limpar o cache e restaurar a configuração padrão?\n\nIsso vai redefinir:\n- Setor selecionado\n- Colunas configuradas\n- Andamentos selecionados')) {
                localStorage.removeItem('sagra_dashboard_config');
                console.log('[Cache] Configuração local removida');
                
                // Restaurar configuração padrão
                config.value = {
                    sector: "SEFOC",
                    columnCount: 4,
                    columns: [
                        {
                            id: 'col_0',
                            title: 'p/ Triagem',
                            statuses: ['Saída p/', 'Saída parcial p/', 'Entrada Inicial', 'Tramit. de Prova p/', 'Tramit. de Prévia p/', 'Comentário']
                        },
                        {
                            id: 'col_1',
                            title: 'Em Execução',
                            statuses: ['Em Execução', 'Recebido']
                        },
                        {
                            id: 'col_2',
                            title: 'Problemas Técnicos',
                            statuses: ['Problemas Técnicos', 'Problema Técnico']
                        },
                        {
                            id: 'col_3',
                            title: 'Enviar e-mail',
                            statuses: ['Encam. de Docum.']
                        }
                    ]
                };
                
                tempConfig.value = JSON.parse(JSON.stringify(config.value));
                columns.value = config.value.columns.map(c => ({ ...c, items: [] }));
                previousDataMap.value.clear();
                
                showSettings.value = false;
                fetchData();
                
                alert('✅ Cache limpo! Configuração padrão restaurada.');
            }
        };

        const fetchLegacyData = async () => {
            const isGravacao = config.value.sector === 'Gravação';
            const params = new URLSearchParams();
            params.append('setor', isGravacao ? 'SEFOC' : config.value.sector);
            params.append('include_finished', 'false');
            params.append('limit', '200');
            params.append('pcp_order', 'true');

            const basesToTry = getApiBases();
            for (const base of basesToTry) {
                const url = `${base}/os/search?${params.toString()}`;
                try {
                    console.log('[PCP] Fallback legacy em', url);
                    const response = await fetch(url, { cache: 'no-store' });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const result = await response.json();
                    if (result && result.data) {
                        let data = result.data;
                        if (isGravacao) {
                            const allowed = new Set(['Gravação', 'Gravação Parcial']);
                            data = data.filter(item => allowed.has(item.situacao));
                        }
                        console.log('[PCP] Fallback legacy OK, itens:', data.length);
                        processData(data);
                        connectionStatus.value = 'connected';
                        resolvedApiBase = base;
                        return;
                    }
                } catch (err) {
                    console.warn('[PCP] Falha no fallback legacy em', url, err?.message || err);
                }
            }
            throw new Error('Legacy fetch falhou em todas as bases');
        };

        // Fetch Data from API (prioriza ordenação PCP; fallback mantém comportamento atual)
        const fetchData = async () => {
            const params = new URLSearchParams();
            params.append('setor', config.value.sector);
            params.append('_ts', Date.now());

            const basesToTry = getApiBases();
            let success = false;

            for (const base of basesToTry) {
                const url = `${base}/pcp/queue?${params.toString()}`;
                try {
                    console.log('[PCP] Buscando fila em', url);
                    const response = await fetch(url, { cache: 'no-store' });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);

                    const result = await response.json();
                    const count = Array.isArray(result?.items) ? result.items.length : 0;
                    console.log('[PCP] Resposta', { url, count });
                    if (count > 0) {
                        processData(result.items);
                        connectionStatus.value = 'connected';
                        resolvedApiBase = base;
                        success = true;
                        break;
                    } else {
                        console.warn('Fila PCP vazia ou formato inesperado — fallback padrão');
                        resolvedApiBase = base;
                        success = true;
                        await fetchLegacyData();
                        break;
                    }
                } catch (err) {
                    console.warn('[PCP] Falha ao buscar fila em', url, err?.message || err);
                }
            }

            if (!success) {
                console.warn('Fila PCP indisponível, usando ordenação padrão');
                try {
                    await fetchLegacyData();
                } catch (legacyErr) {
                    console.error('Falha no fallback de painel', legacyErr);
                    connectionStatus.value = 'disconnected';
                }
            }

            lastUpdated.value = new Date().toLocaleTimeString();
        };

        const processData = (rawData) => {
            // Create a temp map for the new data
            const currentDataMap = new Map();

            // Temporary storage for columns
            const tempColumns = config.value.columns.map(c => ({ ...c, items: [] }));
            const tempUnmapped = [];
            let hidden = 0;

            rawData.forEach(os => {
                const uniqueKey = `${os.nr_os}-${os.ano}`;
                const priorityType = os.prioridade ?
                    (os.prioridade.includes('Prometido') ? 'priority-high' :
                        os.prioridade.includes('Solicitado') ? 'priority-medium' : null) : null;
                const isNew = !previousDataMap.value.has(uniqueKey);
                const pcpOrder = Number.isFinite(Number(os.pcp_ordem)) ? Number(os.pcp_ordem) : null;

                const item = {
                    ...os,
                    uniqueKey,
                    priorityType,
                    isNew: isNew, // Flag for animation
                    pcp_ordem: pcpOrder
                };

                currentDataMap.set(uniqueKey, item);

                // Map to Column
                // Logic: Check which column's statuses list contains (or starts with) the OS status
                const colIndex = tempColumns.findIndex(col => {
                    return col.statuses.some(statusFilter => {
                        // Exact match OR Starts With (for "Saída p/...")
                        return os.situacao === statusFilter || os.situacao.startsWith(statusFilter);
                    });
                });

                if (colIndex !== -1) {
                    tempColumns[colIndex].items.push(item);
                } else {
                    hidden += 1; // não casa com filtros configurados
                    tempUnmapped.push(item);
                }
            });

            // --- Sorting Logic (New Rule) ---
            // 1. Prometido p/
            // 2. Solicitado p/
            // 3. OS < 5000
            // 4. OS >= 5000
            // Internal Sort: Last Update ASC (Oldest First)
            const getWeight = (os) => {
                const prio = os.prioridade || "";
                if (prio.includes("Prometido p/")) return 0;
                if (prio.includes("Solicitado p/")) return 1;
                const nr = parseInt(os.nr_os);
                if (!isNaN(nr) && nr < 5000) return 2;
                return 3;
            };

            tempColumns.forEach(col => {
                col.items.sort((a, b) => {
                    const hasPcpA = Number.isInteger(a.pcp_ordem);
                    const hasPcpB = Number.isInteger(b.pcp_ordem);

                    if (hasPcpA || hasPcpB) {
                        if (hasPcpA && hasPcpB) return a.pcp_ordem - b.pcp_ordem;
                        if (hasPcpA) return -1;
                        return 1;
                    }

                    const wA = getWeight(a);
                    const wB = getWeight(b);

                    if (wA !== wB) return wA - wB;

                    // Internal: Date ASC
                    // last_update comes from API (added to server.py)
                    const dA = a.last_update ? new Date(a.last_update).getTime() : 0;
                    const dB = b.last_update ? new Date(b.last_update).getTime() : 0;
                    return dA - dB;
                });
            });

            // Ordena também os não mapeados pela mesma lógica PCP-first
            const sortByPcp = (a, b) => {
                const hasPcpA = Number.isInteger(a.pcp_ordem);
                const hasPcpB = Number.isInteger(b.pcp_ordem);
                if (hasPcpA || hasPcpB) {
                    if (hasPcpA && hasPcpB) return a.pcp_ordem - b.pcp_ordem;
                    if (hasPcpA) return -1;
                    return 1;
                }
                const wA = getWeight(a);
                const wB = getWeight(b);
                if (wA !== wB) return wA - wB;
                const dA = a.last_update ? new Date(a.last_update).getTime() : 0;
                const dB = b.last_update ? new Date(b.last_update).getTime() : 0;
                return dA - dB;
            };
            tempUnmapped.sort(sortByPcp);

            // Update Reactive State
            // We replace items but keep Vue's reactivity happy if possible, 
            // but for full list replacement usually just updating the array is fine.
            // Vue 3 transition-group handles the diff based on :key

            columns.value = tempColumns;
            unmappedItems.value = tempUnmapped;
            hiddenCount.value = hidden;

            // Update History Map for next cycle
            previousDataMap.value = currentDataMap;
        };

        // Progress Bar & Polling
        const startTimer = () => {
            progress.value = 0;
            const duration = 5000; // 5 seconds
            const interval = 100;

            const timer = setInterval(() => {
                progress.value += (interval / duration) * 100;
                if (progress.value >= 100) {
                    clearInterval(timer);
                    fetchData();
                    startTimer(); // Loop
                }
            }, interval);
        };

        const startWebSocket = () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.hostname}:${apiPort}/ws`;

            let socket;
            let reconnectTimeout;
            let wsHeartbeat;

            const connect = () => {
                console.log("[WebSocket] Conectando:", wsUrl);
                
                try {
                    socket = new WebSocket(wsUrl);

                    socket.onopen = () => {
                        console.log("[WebSocket] Conectado com sucesso");
                        connectionStatus.value = 'connected';
                        
                        if (reconnectTimeout) {
                            clearTimeout(reconnectTimeout);
                            reconnectTimeout = null;
                        }
                        if (wsHeartbeat) clearInterval(wsHeartbeat);
                        wsHeartbeat = setInterval(() => {
                            if (socket && socket.readyState === WebSocket.OPEN) {
                                socket.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
                            }
                        }, 20000);
                    };

                    socket.onmessage = (event) => {
                        try {
                            const data = JSON.parse(event.data);
                            if (data.type === 'system_update' || data.type === 'pcp_queue_update') {
                                console.log("[WebSocket] Atualização recebida:", data);
                                fetchData();
                            }
                        } catch (e) { 
                            console.error("[WebSocket] Erro ao processar mensagem:", e); 
                        }
                    };

                    socket.onclose = () => {
                        console.warn("[WebSocket] Conexão fechada. Reconectando em 5s...");
                        connectionStatus.value = 'disconnected';
                        if (wsHeartbeat) {
                            clearInterval(wsHeartbeat);
                            wsHeartbeat = null;
                        }
                        reconnectTimeout = setTimeout(connect, 5000);
                    };

                    socket.onerror = (err) => {
                        console.error("[WebSocket] Erro:", err);
                        connectionStatus.value = 'disconnected';
                        if (wsHeartbeat) {
                            clearInterval(wsHeartbeat);
                            wsHeartbeat = null;
                        }
                        socket.close();
                    };
                } catch (err) {
                    console.error("[WebSocket] Erro ao criar conexão:", err);
                    connectionStatus.value = 'disconnected';
                    if (wsHeartbeat) {
                        clearInterval(wsHeartbeat);
                        wsHeartbeat = null;
                    }
                    reconnectTimeout = setTimeout(connect, 5000);
                }
            };

            connect();
        };

        // Alias para compatibilidade com código existente
        const setupWebSocket = startWebSocket;

        watch(showSettings, (val) => {
            if (!val && window.lucide) {
                // re-render icons when modal closes if needed
                setTimeout(() => window.lucide.createIcons(), 100);
            }
        });

        // Liberar Wake Lock quando o componente for desmontado
        onUnmounted(() => {
            releaseWakeLock();
        });

        return {
            config,
            tempConfig,
            columns,
            unmappedItems,
            hiddenCount,
            lastUpdated,
            progress,
            connectionStatus,
            showSettings,
            openSettings,
            saveSettings,
            clearCache,
            setoresList,
            andamentosList,
            toggleAndamento,
            addColumn,
            removeColumn,
            adjustColumns
        };
    }
}).mount('#app');
