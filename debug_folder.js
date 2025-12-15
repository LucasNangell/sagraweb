document.addEventListener('DOMContentLoaded', () => {
    // --- Lógica de Abrir Pasta (Patch Check) ---

    // 1. Abrir Pasta
    const btn = document.getElementById('ctx-open-folder');
    if (btn) {
        // Remove clone/replace logic as simple addEventListener is working now
        // We use a named function or check to avoid duplicates if we were merging, 
        // but since this is a patch script, we just add it.

        btn.addEventListener('click', async (e) => {
            // Stop propagation to avoid any duplicate handling from script.js if it ever wakes up
            e.stopImmediatePropagation();

            // Access globals
            const ano = window.currentAno || currentAno;
            const id = window.currentId || currentId;

            if (ano && id) {
                const apiBase = window.API_BASE_URL || `http://${window.location.hostname}:8001/api`;
                const url = `${apiBase}/os/${ano}/${id}/path`;

                // UI Elements
                const modal = document.getElementById('modal-folder-path');
                const display = document.getElementById('folder-path-display');
                const osTitle = document.getElementById('folder-path-os-title');
                const btnCopy = document.getElementById('btn-copy-path');

                // Reset Button State
                if (btnCopy) btnCopy.innerHTML = '<i class="fas fa-copy"></i> Copiar';

                if (modal) {
                    modal.style.display = 'flex';
                    if (osTitle) osTitle.innerText = `OS ${id}/${ano}`;
                    if (display) display.innerText = "Consultando servidor...";
                }

                try {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error("Server error: " + res.status);

                    const data = await res.json();

                    if (display) {
                        display.innerText = data.path;
                    }

                } catch (err) {
                    console.error("Folder Path Error:", err);
                    if (display) display.innerText = "Erro ao buscar caminho.";
                }
            } else {
                alert("Selecione uma OS na tabela primeiro.");
            }
        });
    }

    // 2. Botão Copiar (Adicionado aqui para garantir funcionamento)
    const btnCopy = document.getElementById('btn-copy-path');
    if (btnCopy) {
        // Remove previous listeners by cloning (trick to clear potentially broken listeners from script.js)
        const newBtnCopy = btnCopy.cloneNode(true);
        btnCopy.parentNode.replaceChild(newBtnCopy, btnCopy);

        newBtnCopy.addEventListener('click', () => {
            const display = document.getElementById('folder-path-display');
            const text = display ? display.innerText : "";
            const lower = text ? text.toLowerCase() : '';

            // Evitar copiar enquanto estiver buscando ou em estado de erro
            if (text && !lower.includes('consult') && !lower.includes('busc') && !lower.includes('erro') && !lower.includes('não encontrada')) {
                navigator.clipboard.writeText(text).then(() => {
                    newBtnCopy.innerHTML = '<i class="fas fa-check"></i> Copiado!';
                    // Fecha o modal após curto delay para feedback visual
                    setTimeout(() => {
                        newBtnCopy.innerHTML = '<i class="fas fa-copy"></i> Copiar';
                        const modal = document.getElementById('modal-folder-path');
                        if (modal) modal.style.display = 'none';
                    }, 500);
                }).catch(err => {
                    console.error("Clipboard error:", err);
                    alert("Erro ao copiar para a área de transferência.");
                });
            }
        });

        // Listener para o botão Fechar do Modal também, para garantir
        const btnClose = document.querySelector('#modal-folder-path .btn-secondary'); // Assuming class based or we find by text
        // Or better, check index.html structure for the close button ID or class
    }

    // 3. Fechar Modal (Garantir)
    // Looking at index.html (implied), there is likely a close button inside #modal-folder-path
    const modal = document.getElementById('modal-folder-path');
    if (modal) {
        // Find close button inside
        const buttons = modal.querySelectorAll('button');
        buttons.forEach(b => {
            if (b.textContent.includes('Fechar') || b.classList.contains('btn-secondary')) {
                b.addEventListener('click', () => {
                    modal.style.display = 'none';
                });
            }
        });
    }
});
