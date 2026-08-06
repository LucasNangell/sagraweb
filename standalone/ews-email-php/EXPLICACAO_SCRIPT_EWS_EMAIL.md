# Script PHP independente — envio de e-mail via EWS (sepim.deapa@camara.leg.br)

Este diretório contém um **script autônomo**, sem dependência do backend Python, frontend ou banco do SAGRA Web. Ele replica o mesmo protocolo usado em `app/backend/services/ews_service.py` para enviar mensagens pelo Microsoft Exchange da Câmara dos Deputados.

---

## 1. O que o script faz

| Arquivo | Função |
|---------|--------|
| `EwsMailSender.php` | Cliente SOAP EWS (monta envelope, autentica, envia `CreateItem`) |
| `config.php` | Parâmetros genéricos (URL, SSL, credenciais, remetente, destino de teste) |
| `enviar_teste.php` | Script CLI que envia um e-mail de teste para `lucassantosabreu@gmail.com` |
| `EXPLICACAO_SCRIPT_EWS_EMAIL.md` | Este documento |

**Fluxo resumido:**

```text
enviar_teste.php
  → carrega config.php
  → EwsMailSender (cURL + SOAP)
  → POST https://ce.camara.leg.br/EWS/Exchange.asmx
  → operação CreateItem (MessageDisposition="SendAndSaveCopy")
  → e-mail sai como sepim.deapa@camara.leg.br
```

O SAGRA Web **não usa SMTP**. Toda comunicação é **HTTPS + XML/SOAP**, igual a este script.

---

## 2. Como funciona a autenticação (análise do sistema)

No SAGRA Web, a função `_resolve_ews_auth()` em `ews_service.py` escolhe o método nesta ordem:

### 2.1 NTLM com credenciais explícitas

Se existirem **usuário e senha**:

- Passados ao construtor de `EWSService`, ou
- Definidos no ambiente: `EWS_USERNAME` / `EWS_USER` e `EWS_PASSWORD`

→ o Python usa `HttpNtlmAuth` (`requests_ntlm`).

Formato típico do usuário no `.env` da Câmara:

```text
EWS_USERNAME=redecamara\P_XXXXXX
```

Também aceita endereço SMTP (`usuario@camara.leg.br`); o sistema normaliza para `@camara.leg.br` em algumas operações.

### 2.2 SSPI / Negotiate (padrão em produção Windows)

Se **não** houver credenciais explícitas:

→ usa `HttpNegotiateAuth` (`requests_negotiate_sspi`).

Nesse modo, a identidade é a **conta Windows sob a qual o processo roda** (serviço IIS, Uvicorn, gMSA, ou usuário logado na estação). Essa conta precisa ter:

- Permissão para usar EWS no Exchange
- Acesso delegado ou **Full Access** às caixas DEAPA
- Permissão **Send As** em `sepim.deapa@camara.leg.br` quando o remetente é essa mailbox compartilhada

### 2.3 Espelhamento no PHP

O script PHP reproduz os dois modos via cURL:

| Modo (`auth_mode`) | cURL | Quando usar |
|--------------------|------|-------------|
| `auto` (padrão) | NTLM se houver user+senha; senão `CURLAUTH_NEGOTIATE` | Recomendado |
| `ntlm` | `CURLAUTH_NTLM` + `USERPWD` | Servidor Linux, CI, ou quando SSPI não está disponível |
| `negotiate` | `CURLAUTH_NEGOTIATE` | Máquina Windows no domínio `redecamara`, usuário já autenticado |

**Importante:** `sepim.deapa@camara.leg.br` é uma **caixa compartilhada/delegada**. Quem autentica no EWS normalmente **não é** essa conta, e sim um usuário de serviço ou operador. O campo `<From>` no SOAP informa o remetente visível; o Exchange só aceita se existir delegação **Send As** (ou **Send on Behalf**) configurada no Exchange Admin — o mesmo requisito documentado na seção 7.1 do `docs/EMAIL_EWS_ENVIO_E_MONITORAMENTO.md`.

---

## 3. Detalhes técnicos do envio

### 3.1 Endpoint e versão

```text
URL:     https://ce.camara.leg.br/EWS/Exchange.asmx
Versão:  Exchange2010_SP2 (header RequestServerVersion)
```

### 3.2 Operação SOAP

Equivalente a `EWSService.send_email()`:

- `CreateItem` com `MessageDisposition="SendAndSaveCopy"`
- Corpo `BodyType="HTML"`
- Destinatários em `<ToRecipients>`
- Remetente opcional em `<From>` → configurado como `sepim.deapa@camara.leg.br`
- Anexos suportados na classe (Base64 em `FileAttachment`), não usados no teste padrão

### 3.3 SSL e proxy

Alinhado ao backend Python:

- **`verify_ssl` padrão: `false`** — certificado interno da Câmara costuma exigir isso no ambiente atual (`DEFAULT_VERIFY_SSL` em `email_config_service.py`).
- **Proxy:** por padrão o script **ignora** `HTTP_PROXY`/`HTTPS_PROXY` do Windows (evita timeout com proxy interno inacessível). Use `EWS_HTTPS_PROXY` apenas se o EWS exigir proxy explícito.

### 3.4 Tratamento de erros

O cliente PHP valida:

- Falhas de cURL (timeout, conexão)
- HTTP 4xx/5xx
- `soap:Fault` na resposta
- `ResponseCode` diferente de `NoError` nas mensagens EWS

---

## 4. Requisitos para funcionar

### 4.1 Software

- **PHP 8.0+** (recomendado 8.1+)
- Extensões:
  - `curl` (obrigatória)
  - `dom` / `libxml` (parse de resposta SOAP)
  - `openssl` (HTTPS)

Verificar:

```powershell
php -m | findstr /i "curl dom openssl"
php -v
```

### 4.2 Rede

- Acesso HTTPS à rede interna até `ce.camara.leg.br` (VPN ou estação na rede da Câmara, conforme política).
- Porta 443 liberada para o endpoint EWS.

### 4.3 Permissões no Exchange

A conta que **autentica** (NTLM/Negotiate) deve ter, no mínimo para este teste:

1. **EWS habilitado** para o usuário
2. **Send As** (ou equivalente) em `sepim.deapa@camara.leg.br`
3. Idealmente **Full Access** à mailbox para o passo de diagnóstico (`probeMailboxAccess`)

Sem **Send As**, o envio falha mesmo com autenticação válida.

### 4.4 Credenciais

Escolha **uma** das opções (em ordem de prioridade no `config.php`):

**A) Variáveis de ambiente** — sobrescrevem qualquer outra fonte:

```powershell
$env:EWS_USERNAME = "redecamara\P_XXXXXX"
$env:EWS_PASSWORD = "sua_senha"
php enviar_teste.php
```

**B) Arquivo criptografado (recomendado para deploy)** — senha não fica legível no código:

```powershell
# 1) Gera credentials.enc + credentials.key (AES-256-GCM)
php setup_credenciais.php --username "redecamara\P_XXXXXX" --password-file C:\temp\senha.txt --generate-key

# 2) Apague o arquivo de senha em texto após o setup
del C:\temp\senha.txt

# 3) Envie normalmente
php enviar_teste.php
```

Arquivos sensíveis (já listados no `.gitignore`):

| Arquivo | Conteúdo |
|---------|----------|
| `credentials.enc` | Usuário e senha criptografados |
| `credentials.key` | Chave de 32 bytes (base64) para descriptografar |

Alternativa à `credentials.key`: definir uma frase secreta no ambiente (mesma usada no setup):

```powershell
php setup_credenciais.php --username "redecamara\P_XXXXXX" --password-file senha.txt --key-passphrase "frase-secreta-longa"
$env:EWS_CREDENTIALS_KEY = "frase-secreta-longa"
php enviar_teste.php
```

**C) Windows integrado (Negotiate)** — sem credencial explícita, usa usuário logado:

```powershell
php enviar_teste.php
```

**Nunca** grave senha em texto claro no `config.php` ou no Git. Criptografia em disco **protege contra leitura casual**, mas quem tiver `credentials.key` (ou `EWS_CREDENTIALS_KEY`) + `credentials.enc` consegue recuperar a senha — guarde a chave em local seguro.

---

## 5. Como executar

### 5.1 Só testar conexão/permissão (sem enviar)

```powershell
php enviar_teste.php --probe-only
```

Lista subpastas da Inbox de `sepim.deapa@camara.leg.br` via `FindFolder`. Código de saída `0` = acesso OK; `2` = sem acesso.

### 5.2 Enviar e-mail de teste (padrão)

```powershell
php enviar_teste.php
```

Destinatário padrão: **lucassantosabreu@gmail.com**  
Remetente padrão: **sepim.deapa@camara.leg.br**

### 5.3 Parâmetros opcionais

```powershell
php enviar_teste.php --to outro@email.com --subject "Meu assunto" --from sepim.deapa@camara.leg.br
php enviar_teste.php --help
```

### 5.4 Variáveis de ambiente

| Variável | Efeito | Padrão |
|----------|--------|--------|
| `EWS_URL` | Endpoint EWS | `https://ce.camara.leg.br/EWS/Exchange.asmx` |
| `EWS_EXCHANGE_VERSION` | Versão SOAP | `Exchange2010_SP2` |
| `EWS_VERIFY_SSL` | `true`/`1` verifica certificado | `false` |
| `EWS_TIMEOUT` | Timeout em segundos | `30` |
| `EWS_HTTPS_PROXY` / `EWS_HTTP_PROXY` | Proxy explícito | vazio (direto) |
| `EWS_AUTH_MODE` | `auto`, `ntlm`, `negotiate` | `auto` |
| `EWS_USERNAME` / `EWS_USER` | Usuário NTLM | vazio / `credentials.enc` |
| `EWS_PASSWORD` | Senha NTLM | vazio / `credentials.enc` |
| `EWS_CREDENTIALS_KEY` | Frase para descriptografar `credentials.enc` | usa `credentials.key` |
| `EWS_SEND_STRATEGY` | `delegate_drafts`, `direct`, `auto` | `delegate_drafts` |
| `EWS_FROM_MAILBOX` | Remetente | `sepim.deapa@camara.leg.br` |
| `EWS_TEST_TO` | Destinatário do teste | `lucassantosabreu@gmail.com` |
| `EWS_TEST_SUBJECT` | Assunto do teste | texto padrão no `config.php` |

---

## 6. Uso programático (além do teste)

```php
<?php
require_once __DIR__ . '/EwsMailSender.php';

$config = require __DIR__ . '/config.php';
$sender = new EwsMailSender($config);

$sender->sendEmail(
    to: ['destinatario@exemplo.com'],
    subject: 'Assunto',
    htmlBody: '<p>Corpo <strong>HTML</strong></p>',
    fromMailbox: 'sepim.deapa@camara.leg.br',
    attachments: [
        ['filename' => 'documento.pdf', 'content' => file_get_contents('/caminho/doc.pdf')],
    ]
);
```

---

## 7. Diagnóstico de falhas comuns

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| Timeout / conexão recusada | Rede, VPN, proxy | Testar `curl -k -I https://ce.camara.leg.br/EWS/Exchange.asmx`; conferir `EWS_HTTPS_PROXY` |
| HTTP 401 | Credencial inválida ou Negotiate indisponível | Definir `EWS_USERNAME`/`EWS_PASSWORD` ou rodar no Windows logado no domínio |
| SOAP Fault / `ErrorAccessDenied` | Sem Send As na mailbox DEAPA | Solicitar delegação no Exchange para a conta que autentica |
| `ResponseCode` de envio | Política Exchange, destinatário bloqueado | Ver `MessageText` na exceção; testar destino `@camara.leg.br` primeiro |
| Probe falha mas envio OK | Conta tem Send As mas não Full Access | Comportamento possível; o envio ainda pode funcionar |

---

## 8. Relação com o SAGRA Web

Este script **não altera** nenhum arquivo do sistema. Ele apenas **reimplementa em PHP** o mesmo contrato EWS já usado em:

- `app/backend/services/ews_service.py` — `send_email()`, `_resolve_ews_auth()`, `_post()`
- `docs/EMAIL_EWS_ENVIO_E_MONITORAMENTO.md` — documentação completa do módulo

Diferenças intencionais:

- Sem FastAPI, sessão de operador ou `tabEmailExchangeConfig`
- Sem salvar cópia em subpastas customizadas (`Saida de Prob. Tec.`) — usa pasta **Itens Enviados** padrão do Exchange
- Configuração local em `config.php` + variáveis de ambiente, não `.env` do SAGRA

---

## 9. Segurança

- Mantenha `config.php` sem senhas em repositório
- Prefira variáveis de ambiente ou cofre de segredos em produção
- `verify_ssl=false` é conveniente no ambiente interno, mas reduz validação do certificado — habilite `EWS_VERIFY_SSL=true` se a cadeia de certificados estiver corretamente instalada na máquina
