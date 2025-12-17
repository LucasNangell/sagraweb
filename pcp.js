const { createApp, ref, onMounted, onUnmounted, watch, nextTick } = Vue;

createApp({
    setup() {
        // Prefer explicit SAGRA_API_PORT, then current host port, then default 8001 (API runs there by padrão)
        const apiPort = window.SAGRA_API_PORT || window.location.port || 8001;
        const API_BASE_URL = `http://${window.location.hostname}:${apiPort}/api`;

        const setores = ref([]);
        const selectedSetores = ref([]);
        const queues = ref({});
        const loading = ref(false);
        const savingSetor = ref(null);
        const lastUpdated = ref('—');
        const wsStatus = ref('disconnected');
        const nowTick = ref(Date.now());
        const andamentos = ref([]);

        const config = ref({
            selectedSetores: [],
            filters: {} // { [setor]: string[] }
        });
        const tempConfig = ref({ selectedSetores: [], filters: {} });
        const showSettings = ref(false);
        const modalSetor = ref(null);

        let wsInstance = null;
        let tickTimer = null;
        let pollTimer = null;

        const loadSetores = async () => {
            const response = await fetch(`${API_BASE_URL}/aux/setores`);
            const result = await response.json();
            const values = Array.isArray(result) ? result.map(r => r.Setor).filter(Boolean) : [];
            setores.value = values;
            if (config.value.selectedSetores.length === 0 && values.length > 0) {
                config.value.selectedSetores = values.slice(0, 3);
            }
            selectedSetores.value = config.value.selectedSetores;
            if (!modalSetor.value && values.length > 0) {
                modalSetor.value = values[0];
            }
        };

        const loadAndamentos = async () => {
            const response = await fetch(`${API_BASE_URL}/aux/andamentos`);
            const result = await response.json();
            andamentos.value = Array.isArray(result) ? result.map(r => r.Situacao).filter(Boolean) : [];
        };

        const loadConfig = () => {
            try {
                const saved = localStorage.getItem('pcp_config');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    config.value.selectedSetores = parsed.selectedSetores || [];
                    config.value.filters = parsed.filters || {};
                }
            } catch (_) { /* ignore parse errors */ }
            selectedSetores.value = config.value.selectedSetores;
        };

        const openSettings = () => {
            tempConfig.value = JSON.parse(JSON.stringify(config.value));
            if (!tempConfig.value.selectedSetores.length && setores.value.length) {
                tempConfig.value.selectedSetores = setores.value.slice(0, 3);
            }
            modalSetor.value = tempConfig.value.selectedSetores[0] || setores.value[0] || null;
            showSettings.value = true;
        };

        const saveSettings = () => {
            config.value = JSON.parse(JSON.stringify(tempConfig.value));
            localStorage.setItem('pcp_config', JSON.stringify(config.value));
            selectedSetores.value = config.value.selectedSetores;
            showSettings.value = false;
            refreshAll();
        };

        const toggleSetorInTemp = (setor) => {
            const list = new Set(tempConfig.value.selectedSetores || []);
            if (list.has(setor)) list.delete(setor); else list.add(setor);
            tempConfig.value.selectedSetores = Array.from(list);
            if (!tempConfig.value.selectedSetores.includes(modalSetor.value)) {
                modalSetor.value = tempConfig.value.selectedSetores[0] || null;
            }
        };

        const toggleAndamentoInTemp = (andamento) => {
            if (!modalSetor.value) return;
            const filters = { ...(tempConfig.value.filters || {}) };
            const set = new Set(filters[modalSetor.value] || []);
            if (set.has(andamento)) set.delete(andamento); else set.add(andamento);
            filters[modalSetor.value] = Array.from(set);
            tempConfig.value.filters = filters;
        };

        const clearFiltersInTemp = (setor) => {
            const filters = { ...(tempConfig.value.filters || {}) };
            delete filters[setor];
            tempConfig.value.filters = filters;
        };

        const fetchLegacyQueue = async (setor) => {
            const params = new URLSearchParams();
            const isGravacao = setor === 'Gravação';
            params.append('setor', isGravacao ? 'SEFOC' : setor);
            params.append('include_finished', 'false');
            params.append('limit', '200');
            params.append('pcp_order', 'true');

            const response = await fetch(`${API_BASE_URL}/os/search?${params.toString()}`);
            if (!response.ok) throw new Error(`Legacy HTTP ${response.status}`);
            const result = await response.json();
            let items = Array.isArray(result?.data) ? result.data : [];
            if (isGravacao) {
                const allowed = new Set(['Gravação', 'Gravação Parcial']);
                items = items.filter(it => allowed.has(it.situacao));
            }
            queues.value = { ...queues.value, [setor]: items };
        };

        const fetchQueue = async (setor) => {
            const params = new URLSearchParams();
            params.append('setor', setor);

            try {
                const response = await fetch(`${API_BASE_URL}/pcp/queue?${params.toString()}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const result = await response.json();
                if (result && Array.isArray(result.items) && result.items.length > 0) {
                    queues.value = {
                        ...queues.value,
                        [setor]: result.items,
                    };
                    return;
                }
                console.warn('Fila PCP vazia ou formato inesperado — usando fallback padrão', result);
                await fetchLegacyQueue(setor);
            } catch (err) {
                console.warn('Erro ao buscar fila PCP — fallback para padrão', err);
                await fetchLegacyQueue(setor);
            }
        };

        const refreshQueue = async (setor) => {
            try {
                await fetchQueue(setor);
                await nextTick();
                initSortableFor(setor);
                lastUpdated.value = new Date().toLocaleTimeString();
            } catch (err) {
                console.error(`Erro ao atualizar setor ${setor}:`, err);
            }
        };

        const refreshAll = async () => {
            if (selectedSetores.value.length === 0) return;
            loading.value = true;
            try {
                await Promise.all(selectedSetores.value.map(setor => refreshQueue(setor)));
                lastUpdated.value = new Date().toLocaleTimeString();
            } finally {
                loading.value = false;
            }
        };

        const initSortableFor = (setor) => {
            nextTick(() => {
                const el = document.querySelector(`.queue-list[data-setor="${setor}"]`);
                if (!el) return;

                if (el._sortable) {
                    el._sortable.destroy();
                }

                el._sortable = new Sortable(el, {
                    animation: 180,
                    handle: '.os-card',
                    ghostClass: 'drag-ghost',
                    chosenClass: 'drag-chosen',
                    onEnd: (evt) => {
                        const list = queues.value[setor] ? [...queues.value[setor]] : [];
                        if (!list.length) return;
                        const [moved] = list.splice(evt.oldIndex, 1);
                        list.splice(evt.newIndex, 0, moved);
                        queues.value = { ...queues.value, [setor]: list };
                        persistOrder(setor).catch(err => console.error('Erro ao salvar ordem', err));
                    }
                });
            });
        };

        const persistOrder = async (setor) => {
            const items = queues.value[setor] || [];
            savingSetor.value = setor;
            try {
                const payload = {
                    setor,
                    items: items.map(item => ({ nr_os: item.nr_os, ano: item.ano })),
                };
                const response = await fetch(`${API_BASE_URL}/pcp/queue/reorder`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!response.ok) {
                    const detail = await response.text();
                    throw new Error(detail || 'Erro ao salvar ordem');
                }
            } finally {
                savingSetor.value = null;
            }
        };

        const connectWebSocket = () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.hostname}:${apiPort}/ws`;

            let reconnectTimer = null;

            const connect = () => {
                try {
                    wsInstance = new WebSocket(wsUrl);

                    wsInstance.onopen = () => {
                        wsStatus.value = 'connected';
                        if (reconnectTimer) {
                            clearTimeout(reconnectTimer);
                            reconnectTimer = null;
                        }
                    };

                    wsInstance.onmessage = (event) => {
                        try {
                            const data = JSON.parse(event.data);
                            if (data.type === 'pcp_queue_update' || data.type === 'system_update') {
                                if (data.setor && selectedSetores.value.includes(data.setor)) {
                                    refreshQueue(data.setor);
                                } else {
                                    refreshAll();
                                }
                            }
                        } catch (err) {
                            console.error('Erro ao processar WS', err);
                        }
                    };

                    wsInstance.onclose = () => {
                        wsStatus.value = 'disconnected';
                        // Fallback polling while offline
                        if (!pollTimer) {
                            pollTimer = setInterval(refreshAll, 20000);
                        }
                        reconnectTimer = setTimeout(connect, 5000);
                    };

                    wsInstance.onerror = () => {
                        wsStatus.value = 'disconnected';
                        try { wsInstance.close(); } catch (_) { /* ignore */ }
                    };
                } catch (err) {
                    wsStatus.value = 'disconnected';
                    if (!pollTimer) {
                        pollTimer = setInterval(refreshAll, 20000);
                    }
                    reconnectTimer = setTimeout(connect, 5000);
                }
            };

            connect();
        };

        const parseDateLocal = (value) => {
            if (!value) return null;
            const match = `${value}`.match(/(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
            if (match) {
                const [, y, m, d, hh, mm, ss] = match;
                return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss || 0), 0);
            }
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        };

        const extractLastUpdateMs = (item) => {
            if (!item) return null;
            let baseDate = item.last_update ? parseDateLocal(item.last_update) : null;
            const obsText = item.observacao || item.Observaçao || item.observação || '';
            const timeMatch = obsText.match(/^\s*(\d{1,2})h(\d{2})/i);

            if (timeMatch && baseDate && !Number.isNaN(baseDate.getTime())) {
                const hours = parseInt(timeMatch[1], 10);
                const minutes = parseInt(timeMatch[2], 10);
                if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
                    if (!baseDate || Number.isNaN(baseDate.getTime())) {
                        const today = new Date();
                        baseDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                    }
                    const enriched = new Date(baseDate);
                    enriched.setHours(hours, minutes, 0, 0);
                    return enriched.getTime();
                }
            }

            if (baseDate && !Number.isNaN(baseDate.getTime())) {
                return baseDate.getTime();
            }
            return null;
        };

        const formatElapsed = (item, tick) => {
            const ts = extractLastUpdateMs(item);
            if (!ts) return 'Sem registro';
            const diffMs = Math.max(tick - ts, 0);
            const totalMinutes = Math.floor(diffMs / 60000);
            const days = Math.floor(totalMinutes / (60 * 24));
            const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
            const minutes = totalMinutes % 60;

            const parts = [];
            if (days > 0) parts.push(`${days} ${days === 1 ? 'dia' : 'dias'}`);
            if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hora' : 'horas'}`);
            parts.push(`${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`);

            return parts.join(' ');
        };

        const elapsedClass = (item) => {
            const ts = extractLastUpdateMs(item);
            if (!ts) return 'muted';
            const minutes = (nowTick.value - ts) / 60000;
            if (minutes < 60) return 'ok';
            if (minutes < 180) return 'soon';
            return 'late';
        };

        const priorityClass = (prioridade) => {
            if (!prioridade) return 'muted';
            if (prioridade.includes('Prometido')) return 'ok';
            if (prioridade.includes('Solicitado')) return 'warn';
            return 'muted';
        };

        const filteredQueue = (setor) => {
            const list = queues.value[setor] || [];
            const excluded = ['Entregue', 'Cancelado', 'Cancelada'];
            const filters = config.value.filters || {};
            const filterSet = filters[setor] ? new Set(filters[setor]) : null;
            return list.filter(item => {
                if (excluded.includes(item.situacao)) return false;
                if (filterSet && filterSet.size > 0) {
                    return filterSet.has(item.situacao);
                }
                return true;
            });
        };

        const isFiltered = (setor) => {
            const filters = config.value.filters || {};
            const filterSet = filters[setor];
            return filterSet && filterSet.length > 0;
        };

        watch(selectedSetores, () => {
            config.value.selectedSetores = selectedSetores.value;
            localStorage.setItem('pcp_config', JSON.stringify(config.value));
            refreshAll();
        });

        onMounted(async () => {
            loadConfig();
            await loadSetores();
            await loadAndamentos();
            await refreshAll();
            nowTick.value = Date.now();
            lastUpdated.value = new Date(nowTick.value).toLocaleTimeString();
            tickTimer = setInterval(() => {
                const now = Date.now();
                nowTick.value = now;
                lastUpdated.value = new Date(now).toLocaleTimeString();
            }, 1000); // live clock every 1s
            pollTimer = setInterval(refreshAll, 60000); // gentle periodic refresh even com websocket
            connectWebSocket();
        });

        onUnmounted(() => {
            if (wsInstance) {
                try { wsInstance.close(); } catch (_) { /* ignore */ }
            }
            if (tickTimer) clearInterval(tickTimer);
            if (pollTimer) clearInterval(pollTimer);
        });

        return {
            setores,
            selectedSetores,
            queues,
            loading,
            savingSetor,
            lastUpdated,
            wsStatus,
            nowTick,
            andamentos,
            config,
            tempConfig,
            showSettings,
            modalSetor,
            refreshAll,
            refreshQueue,
            formatElapsed,
            elapsedClass,
            priorityClass,
            filteredQueue,
            isFiltered,
            openSettings,
            saveSettings,
            toggleSetorInTemp,
            toggleAndamentoInTemp,
            clearFiltersInTemp
        };
    }
}).mount('#app');
