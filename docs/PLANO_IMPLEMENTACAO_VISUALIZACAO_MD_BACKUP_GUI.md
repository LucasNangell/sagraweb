# Plano de Implementação — Visualização de Arquivos .md da Release no backup_gui.py

Este plano descreve as modificações necessárias para permitir que os usuários visualizem os arquivos `.md` (notas de release ou documentações) de uma versão selecionada diretamente da interface do `backup_gui.py`.

## User Review Required

> [!NOTE]
> A visualização dos arquivos `.md` será feita através de uma janela modal secundária (`Toplevel`) integrada ao Tkinter. Esta janela listará os arquivos `.md` encontrados no diretório físico da release e exibirá seu conteúdo em um componente de texto de leitura com scrollbars, sem necessidade de dependências externas para renderização de markdown (utilizando a visualização de texto plano limpa).

## Proposed Changes

---

### Interface Gráfica de Releases

#### [MODIFY] [backup_gui.py](file:///c:/dev/SagraWeb/deploy/scripts/backup_gui.py)
- **`build_ui`**:
  - Adicionar o botão "Visualizar Documentos (.md)" (`self.view_md_btn`) ao lado do botão "Restaurar Arquivo Selecionado" na barra de título dos arquivos alterados (`files_title_frame`).
  - Definir o estado inicial deste botão como desabilitado (`disabled`).
- **`on_release_select`**:
  - Modificar a consulta de detalhes da release (`query_details`) para selecionar também a coluna `backup_path` do banco de dados.
  - Salvar as informações da release selecionada em variáveis de instância (`self.selected_release_id`, `self.selected_release_name`, `self.selected_release_backup_path`).
  - Habilitar o botão `self.view_md_btn` se a release for selecionada com sucesso.
- **`refresh_releases_list`**:
  - Limpar as variáveis de instância (`self.selected_release_id`, `self.selected_release_name`, `self.selected_release_backup_path`) e desabilitar o botão `self.view_md_btn` ao atualizar a lista de releases.
- **`open_md_viewer_dialog`**:
  - Buscar os arquivos `.md` recursivamente na pasta física da release (`backup_path`).
  - Se nenhum arquivo for encontrado, mostrar um aviso amigável.
  - Se houver arquivos, abrir um diálogo modal (`Toplevel`) contendo:
    - Um painel esquerdo com a lista de arquivos `.md` relativos disponíveis.
    - Um painel direito com uma caixa de texto scrollável e em modo somente leitura mostrando o conteúdo do arquivo selecionado.
    - O fechamento automático e gerenciamento seguro de eventos do Tkinter.

---

## Verification Plan

### Manual Verification
1. Executar a GUI via terminal ou script bat: `backup-gui-dev.bat`.
2. Selecionar uma release que possua arquivos `.md` (por exemplo, a Release #4).
3. Confirmar que o botão "Visualizar Documentos (.md)" foi habilitado.
4. Clicar no botão e verificar a abertura do modal:
   - A lista de arquivos `.md` deve ser carregada no painel esquerdo.
   - O primeiro arquivo deve ser auto-selecionado e seu conteúdo exibido corretamente com suporte a codificação UTF-8.
5. Clicar em outros arquivos da lista e observar a atualização correta do texto.
6. Fechar o modal e garantir que a interface principal continue funcionando normalmente.
7. Selecionar uma release sem arquivos `.md` ou com o caminho de backup inválido e verificar o tratamento de erros (avisos amigáveis sem travamento do sistema).
