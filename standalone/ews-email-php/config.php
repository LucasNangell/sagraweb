<?php
/**
 * Configuração do script independente de envio EWS.
 *
 * Prioridade de credenciais:
 * 1. Variáveis de ambiente EWS_USERNAME / EWS_PASSWORD (sobrescreve tudo)
 * 2. Arquivo criptografado credentials.enc (ver setup_credenciais.php)
 * 3. Vazio → SSPI/Negotiate com usuário logado no Windows
 *
 * NÃO commite senhas neste arquivo.
 */

declare(strict_types=1);

require_once __DIR__ . '/CredentialStore.php';

$credentialStore = new CredentialStore(__DIR__);
$secureCredentials = null;

if (
    trim((string) (getenv('EWS_USERNAME') ?: getenv('EWS_USER') ?: '')) === ''
    && (string) (getenv('EWS_PASSWORD') ?: '') === ''
    && $credentialStore->hasEncryptedFile()
) {
    $secureCredentials = $credentialStore->load();
}

return [    // Endpoint corporativo (mesmo do SAGRA Web)
    'ews_url' => getenv('EWS_URL') ?: 'https://ce.camara.leg.br/EWS/Exchange.asmx',

    // Versão informada no header SOAP RequestServerVersion
    'exchange_version' => getenv('EWS_EXCHANGE_VERSION') ?: 'Exchange2010_SP2',

    // Certificado interno da Câmara: false é o padrão no SAGRA Web
    'verify_ssl' => in_array(strtolower((string) (getenv('EWS_VERIFY_SSL') ?: 'false')), ['1', 'true', 'yes'], true),

    'timeout_seconds' => (int) (getenv('EWS_TIMEOUT') ?: 30),

    // Proxy explícito (opcional). Vazio = conexão direta, ignorando proxy do Windows.
    'https_proxy' => getenv('EWS_HTTPS_PROXY') ?: (getenv('EWS_HTTP_PROXY') ?: ''),

    /**
     * auto   = NTLM se username+password existirem; senão Negotiate (SSPI Windows)
     * ntlm   = força NTLM com credenciais
     * negotiate = força autenticação integrada Windows (conta logada no SO)
     */
    'auth_mode' => getenv('EWS_AUTH_MODE')
        ?: ($secureCredentials['auth_mode'] ?? null)
        ?: 'auto',

    // Formato NTLM: redecamara\P_XXXXXX ou usuario@camara.leg.br
    'username' => getenv('EWS_USERNAME')
        ?: getenv('EWS_USER')
        ?: ($secureCredentials['username'] ?? ''),
    'password' => getenv('EWS_PASSWORD')
        ?: ($secureCredentials['password'] ?? ''),

    // Remetente DEAPA (caixa compartilhada/delegada)
    'from_mailbox' => getenv('EWS_FROM_MAILBOX') ?: 'sepim.deapa@camara.leg.br',

    /**
     * Com auth_mode=negotiate: header ExchangeImpersonation (como ews.php).
     * Vazio = usa from_mailbox automaticamente no modo negotiate.
     */
    'impersonate_mailbox' => getenv('EWS_IMPERSONATE_MAILBOX') ?: getenv('EWS_IMPERSONATE') ?: '',

    /**
     * auto      = php cURL; se HTTP 401, tenta curl.exe do Windows (recomendado)
     * php_curl  = só extensão curl do PHP
     * curl_exe  = só C:\Windows\System32\curl.exe (NTLM nativo; ideal com credentials.enc)
     */
    'http_transport' => getenv('EWS_HTTP_TRANSPORT') ?: 'auto',

    /**
     * delegate_drafts = cria em Rascunhos da mailbox delegada + SendItem (padrão; igual Outlook)
     * direct          = CreateItem com From (exige Send As no Exchange)
     * auto            = tenta delegate_drafts e depois direct
     */
    'send_strategy' => getenv('EWS_SEND_STRATEGY') ?: 'delegate_drafts',

    /**
     * SendOnly = apenas envia (recomendado para script de envio puro).
     * SendAndSaveCopy = envia e salva cópia em Itens Enviados do remetente.
     */
    'message_disposition' => getenv('EWS_MESSAGE_DISPOSITION') ?: 'SendOnly',

    // true = executa FindFolder na Inbox antes do envio (só diagnóstico; não é obrigatório)
    'probe_before_send' => in_array(
        strtolower((string) (getenv('EWS_PROBE_BEFORE_SEND') ?: 'false')),
        ['1', 'true', 'yes'],
        true
    ),

    // Destinatário padrão do teste
    'test_to' => getenv('EWS_TEST_TO') ?: 'lucassantosabreu@gmail.com',

    'test_subject' => getenv('EWS_TEST_SUBJECT') ?: 'Teste EWS PHP — sepim.deapa@camara.leg.br',

    'test_html_body' => <<<'HTML'
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Teste EWS</title></head>
<body style="font-family:Segoe UI,Arial,sans-serif;color:#1e293b;">
  <h2 style="color:#0f4c81;">E-mail de teste — script PHP independente</h2>
  <p>Este e-mail foi enviado via <strong>Exchange Web Services (EWS)</strong>, espelhando o fluxo do SAGRA Web.</p>
  <ul>
    <li><strong>Remetente:</strong> sepim.deapa@camara.leg.br</li>
    <li><strong>Protocolo:</strong> SOAP CreateItem (SendOnly)</li>
    <li><strong>Autenticação:</strong> NTLM ou Negotiate/SSPI</li>
  </ul>
  <p style="color:#64748b;font-size:12px;">Gerado em {{timestamp}} — script standalone/ews-email-php</p>
</body>
</html>
HTML,
];
