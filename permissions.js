/**
 * Sistema de Permissões por IP - Frontend
 * Aplica as permissões obtidas do backend ocultando elementos do DOM
 */

(function () {
    'use strict';

    const API_BASE_URL = `http://${window.location.hostname}:${window.SAGRA_API_PORT || 8001}/api`;
    let userPermissions = null;

    /**
     * Inicializa o sistema de permissões
     * Deve ser chamado no carregamento da página
     */
    async function initPermissions() {
        try {
            console.log('[Permissions] Carregando permissões do IP...');
            
            const response = await fetch(`${API_BASE_URL}/permissions`);
            
            if (!response.ok) {
                console.error('[Permissions] Erro ao buscar permissões:', response.status);
                // Em caso de erro, assume todas permissões (fail-open para não quebrar o sistema)
                userPermissions = getAllPermissionsTrue();
                return;
            }

            userPermissions = await response.json();
            console.log('[Permissions] Permissões carregadas:', userPermissions);

            // Aplicar permissões ao DOM
            applyPermissions();

        } catch (error) {
            console.error('[Permissions] Erro ao inicializar permissões:', error);
            // Em caso de erro, assume todas permissões
            userPermissions = getAllPermissionsTrue();
        }
    }

    /**
     * Retorna objeto com todas permissões TRUE (fallback)
     */
    function getAllPermissionsTrue() {
        return {
            ctx_nova_os: true,
            ctx_duplicar_os: true,
            ctx_editar_os: true,
            ctx_vincular_os: true,
            ctx_abrir_pasta: true,
            ctx_imprimir_ficha: true,
            ctx_detalhes_os: true,
            sb_inicio: true,
            sb_gerencia: true,
            sb_email: true,
            sb_analise: true,
            sb_papelaria: true,
            sb_usuario: true,
            sb_configuracoes: true,
        };
    }

    /**
     * Aplica as permissões ao DOM, ocultando elementos quando necessário
     */
    function applyPermissions() {
        if (!userPermissions) {
            console.warn('[Permissions] Permissões não carregadas ainda');
            return;
        }

        console.log('[Permissions] Aplicando permissões ao DOM...');

        // Mapeamento de permissões para IDs de elementos
        const permissionMap = {
            // Menu de Contexto
            ctx_nova_os: '#ctx-new-os',
            ctx_duplicar_os: '#ctx-duplicate-os',
            ctx_editar_os: '#ctx-edit-os',
            ctx_vincular_os: '#ctx-link-os',
            ctx_abrir_pasta: '#ctx-open-folder',
            ctx_imprimir_ficha: '#ctx-print-ficha',
            ctx_detalhes_os: '#ctx-view-details',

            // Sidebar
            sb_inicio: 'a[href="index.html"], a[href="#"][class*="nav-item"]:has(i.fa-home)',
            sb_gerencia: 'a[href="gerencia.html"], #link-gerencia',
            sb_email: 'a[href="email.html"]',
            sb_analise: '#nav-analise',
            sb_papelaria: 'a[href="papelaria.html"], #link-papelaria',
            sb_usuario: 'a.nav-item:has(i.fa-user)',
            sb_configuracoes: 'a[href="settings.html"]',
        };

        // Aplicar cada permissão
        Object.keys(permissionMap).forEach(permission => {
            const hasPermission = userPermissions[permission];
            const selector = permissionMap[permission];

            if (!hasPermission) {
                // Ocultar elemento(s)
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    el.style.display = 'none';
                    el.setAttribute('data-permission-hidden', 'true');
                    console.log(`[Permissions] Ocultando elemento: ${selector}`);
                });
            }
        });

        // Tratar casos especiais
        handleSpecialCases();

        console.log('[Permissions] Permissões aplicadas com sucesso');
    }

    /**
     * Trata casos especiais que precisam de lógica adicional
     */
    function handleSpecialCases() {
        // Se sidebar "Início" está oculto, verificar se precisa redirecionar
        if (!userPermissions.sb_inicio) {
            const currentPage = window.location.pathname;
            if (currentPage === '/' || currentPage === '/index.html') {
                // Usuário está na página inicial mas não tem permissão
                // Redirecionar para primeira página disponível
                redirectToFirstAvailable();
            }
        }

        // Verificar se o menu de contexto ficou vazio
        const contextMenu = document.getElementById('context-menu');
        if (contextMenu) {
            const visibleItems = Array.from(contextMenu.querySelectorAll('li')).filter(
                li => li.style.display !== 'none' && !li.getAttribute('data-permission-hidden')
            );

            if (visibleItems.length === 0) {
                // Menu de contexto completamente vazio - ocultar o menu inteiro
                contextMenu.style.display = 'none';
                console.log('[Permissions] Menu de contexto completamente oculto (sem permissões)');
            }
        }
    }

    /**
     * Redireciona para a primeira página disponível no sidebar
     */
    function redirectToFirstAvailable() {
        const availablePages = [
            { perm: 'sb_gerencia', url: 'gerencia.html' },
            { perm: 'sb_email', url: 'email.html' },
            { perm: 'sb_analise', url: 'analise.html' },
            { perm: 'sb_papelaria', url: 'papelaria.html' },
            { perm: 'sb_configuracoes', url: 'settings.html' },
        ];

        for (const page of availablePages) {
            if (userPermissions[page.perm]) {
                console.log(`[Permissions] Redirecionando para ${page.url}`);
                window.location.href = page.url;
                return;
            }
        }

        // Se nenhuma página está disponível, mostrar mensagem de erro
        document.body.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100vh; font-family: Arial;">
                <div style="text-align: center;">
                    <i class="fas fa-lock" style="font-size: 60px; color: #999; margin-bottom: 20px;"></i>
                    <h2 style="color: #333;">Acesso Restrito</h2>
                    <p style="color: #666;">Seu IP não possui permissões para acessar o sistema.</p>
                    <p style="color: #999; font-size: 0.9rem;">Entre em contato com o administrador.</p>
                </div>
            </div>
        `;
    }

    /**
     * Verifica se o usuário tem uma permissão específica
     * Útil para lógica condicional no JavaScript
     */
    function hasPermission(permissionName) {
        if (!userPermissions) {
            console.warn('[Permissions] Permissões não carregadas, assumindo TRUE');
            return true; // Fail-open
        }
        return userPermissions[permissionName] === true;
    }

    /**
     * Reaplica as permissões (útil se o DOM foi modificado dinamicamente)
     */
    function reapplyPermissions() {
        console.log('[Permissions] Reaplicando permissões...');
        applyPermissions();
    }

    // Exportar funções globais
    window.SagraPermissions = {
        init: initPermissions,
        has: hasPermission,
        reapply: reapplyPermissions,
        get: () => userPermissions
    };

    // Auto-inicializar quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPermissions);
    } else {
        // DOM já está pronto
        initPermissions();
    }

})();
