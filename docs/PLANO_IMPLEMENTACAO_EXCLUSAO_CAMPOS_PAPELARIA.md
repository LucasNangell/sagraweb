# Plano de Implementação — Exclusão de Campos do Modelo na Página de Papelaria

Este plano descreve as modificações necessárias para permitir que os usuários excluam/removam campos do modelo (como e-mail, telefone, etc.) diretamente na interface da página de Papelaria. O worker do CorelDRAW aplicará essa exclusão apagando (ou limpando o texto) das formas correspondentes no documento CorelDRAW gerado.

## User Review Required

> [!NOTE]
> Para evitar alterações estruturais no banco de dados e garantir 100% de retrocompatibilidade, a lista de campos excluídos será enviada sob a chave especial `__exclusoes` (contendo um array JSON de strings) dentro do campo `dados` (coluna `DadosJson` no banco). O backend e o worker farão o parse dessa chave especial de forma transparente.

## Proposed Changes

---

### Backend

#### [MODIFY] [papelaria_jobs_service.py](file:///c:/dev/SagraWeb/app/backend/services/papelaria_jobs_service.py)
- **`_sanitize_dados`**: Permitir a chave especial `__exclusoes` contendo uma string JSON serializada com a lista de chaves de campos a excluir.
- **`_validate_required_fields`**: Ignorar validação de obrigatoriedade para campos que foram marcados para exclusão em `__exclusoes`.
- **`build_worker_job_payload`**: Extrair a chave `__exclusoes` de `dados`, desserializá-la e colocá-la como uma lista `exclusoes` de alto nível no payload do job enviado ao worker.

---

### Worker (CorelDRAW Integration)

#### [MODIFY] [corel_generator.py](file:///c:/dev/SagraWeb/worker/papelaria_worker/corel_generator.py)
- **`excluir_campo`**: Implementar nova função que busca as ocorrências do shape associado ao campo e executa `shape.Delete()`. Se falhar, faz fallback para `alterar_texto` com string vazia `""`.
- **`_gerar_arquivo_corel_impl` / `gerar_arquivo_corel`**: Aceitar parâmetro opcional `exclusoes: list[str]`. Se o campo do modelo estiver nessa lista, executar `excluir_campo` em vez de `aplicar_campo`.

#### [MODIFY] [worker.py](file:///c:/dev/SagraWeb/worker/papelaria_worker/worker.py)
- Propagar o parâmetro `exclusoes` do payload do job recebido da API para a chamada da função `gerar_arquivo_corel`.

---

### Frontend

#### [MODIFY] [PapelariaCorelPanel.tsx](file:///c:/dev/SagraWeb/apps/web/src/features/papelaria/components/PapelariaCorelPanel.tsx)
- Manter o estado dos campos excluídos na interface (`excludedFields: string[]`).
- Reiniciar a lista de exclusões sempre que o modelo selecionado mudar.
- Passar a lista de exclusões na chave especial `__exclusoes` em `dadosForJob` ao submeter para criação de job (`runGerarArquivo`) ou ao finalizar edição manual (`handleFinalizarCorel`).
- Atualizar a assinatura e chamadas de `validateRequiredFields` e a renderização do `DynamicFields` para dar suporte a exclusões (exibir botão "Excluir" / "Restaurar" ao lado dos campos, desativar inputs de campos excluídos, aplicar estilização de texto tachado).

---

## Verification Plan

### Automated Tests
- Executar a suíte de testes de papelaria no backend:
  `python -m pytest app/backend/tests/test_papelaria_models_service.py app/backend/tests/test_papelaria_jobs_service.py -v`
- Escrever teste unitário em `app/backend/tests/test_papelaria_jobs_service.py` validando que campos obrigatórios marcados para exclusão em `__exclusoes` não barram a validação.
- Executar a suíte de testes do worker:
  `python -m pytest worker/papelaria_worker/tests -v`
- Escrever teste unitário em `worker/papelaria_worker/tests/test_corel_utils.py` ou mockando a chamada de `excluir_campo`.

### Manual Verification
- Acessar a página de Papelaria de uma OS configurada.
- Excluir um dos campos do formulário (ex.: "e-mail") clicando no botão de exclusão.
- Observar que o campo fica desativado, o texto do label tachado, e a validação de obrigatoriedade não impede o envio se ele for obrigatório.
- Clicar em "Gerar arquivo" e validar se o PDF e CDR gerados e salvos na pasta da OS omitiram corretamente o elemento visual/texto correspondente.
- Tentar restaurar o campo, digitar um valor e gerar novamente, verificando que o valor volta a aparecer normalmente.
