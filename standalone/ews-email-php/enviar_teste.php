<?php
/**
 * Script CLI independente: envia e-mail de teste via EWS.
 *
 * Uso:
 *   php enviar_teste.php
 *   php enviar_teste.php --probe-only
 *   php enviar_teste.php --to outro@email.com --subject "Assunto"
 *
 * Variáveis de ambiente suportadas: ver config.php e EXPLICACAO_SCRIPT_EWS_EMAIL.md
 */

declare(strict_types=1);

require_once __DIR__ . '/EwsMailSender.php';

$config = require __DIR__ . '/config.php';

$options = getopt('', ['probe-only', 'to:', 'subject:', 'from:', 'help']);

if (isset($options['help'])) {
    echo "Uso: php enviar_teste.php [--probe-only] [--to=email] [--subject=texto] [--from=mailbox]\n";
    exit(0);
}

$to = isset($options['to']) ? trim((string) $options['to']) : (string) $config['test_to'];
$subject = isset($options['subject']) ? trim((string) $options['subject']) : (string) $config['test_subject'];
$fromMailbox = isset($options['from']) ? trim((string) $options['from']) : (string) $config['from_mailbox'];
$probeOnly = array_key_exists('probe-only', $options);

$htmlBody = str_replace(
    '{{timestamp}}',
    (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('d/m/Y H:i:s T'),
    (string) $config['test_html_body']
);

$authMode = strtolower((string) $config['auth_mode']);
$hasCreds = trim((string) $config['username']) !== '' && (string) $config['password'] !== '';
$usingEncryptedCreds = is_file(__DIR__ . '/credentials.enc')
    && trim((string) (getenv('EWS_USERNAME') ?: getenv('EWS_USER') ?: '')) === ''
    && (string) (getenv('EWS_PASSWORD') ?: '') === ''
    && $hasCreds;

echo "=== Envio de teste EWS (PHP independente) ===\n";
echo "Endpoint : {$config['ews_url']}\n";
echo "Remetente: {$fromMailbox}\n";
echo "Destino  : {$to}\n";
echo "Auth     : " . ($authMode === 'auto' ? ($hasCreds ? 'auto → ntlm' : 'auto → negotiate') : $authMode) . "\n";
if ($usingEncryptedCreds) {
    echo "Credencial: credentials.enc (criptografado)\n";
} elseif ($hasCreds) {
    echo "Credencial: variáveis de ambiente\n";
}
echo "SSL verify: " . ($config['verify_ssl'] ? 'sim' : 'não') . "\n";
echo "Estratégia: " . ($config['send_strategy'] ?? 'delegate_drafts') . "\n";
echo "Envio    : " . ($config['message_disposition'] ?? 'SendOnly') . "\n";
echo "Transport: " . ($config['http_transport'] ?? 'auto') . " (auto usa curl.exe se PHP der 401)\n";
if (($config['auth_mode'] ?? '') === 'negotiate') {
    $imp = trim((string) ($config['impersonate_mailbox'] ?? ''));
    if ($imp === '') {
        $imp = (string) ($config['from_mailbox'] ?? '');
    }
    if ($imp !== '') {
        echo "Impersonate: {$imp} (conta Windows logada)\n";
    }
}
echo "\n";

try {
    $sender = new EwsMailSender($config);

    $runProbe = $probeOnly || !empty($config['probe_before_send']);
    if ($runProbe) {
        echo "1) Testando acesso à mailbox remetente (diagnóstico opcional)...\n";
        $accessible = $sender->probeMailboxAccess($fromMailbox);
        if ($accessible) {
            echo "   OK — credencial consegue acessar a Inbox de {$fromMailbox}\n";
        } else {
            echo "   AVISO — não foi possível listar pastas de {$fromMailbox}.\n";
            echo "   Isso não impede o envio se houver permissão Send As.\n";
        }

        if ($probeOnly) {
            echo "\nModo --probe-only: envio não executado.\n";
            exit($accessible ? 0 : 2);
        }
        echo "\n2) Enviando e-mail de teste...\n";
    } else {
        echo "Enviando e-mail de teste...\n";
    }
    $sender->sendEmail(
        [$to],
        $subject,
        $htmlBody,
        $fromMailbox
    );

    echo "   OK — e-mail enviado com sucesso.\n";
    echo "\nVerifique a caixa de entrada de {$to} (e a pasta Itens Enviados de {$fromMailbox}).\n";
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, "\nERRO: " . $e->getMessage() . "\n\n");
    fwrite(STDERR, "Dicas:\n");
    fwrite(STDERR, "- Confirme rede/VPN até ce.camara.leg.br\n");
    fwrite(STDERR, "- Padrão: send_strategy=delegate_drafts (usa Full Access, como o Outlook)\n");
    fwrite(STDERR, "- Se falhar, tente: EWS_SEND_STRATEGY=auto ou EWS_SEND_STRATEGY=direct\n");
    fwrite(STDERR, "- direct exige Send As em {$fromMailbox}; delegate_drafts exige Full Access\n");
    fwrite(STDERR, "- Credenciais: EWS_USERNAME=redecamara\\usuario e EWS_PASSWORD=...\n");
    exit(1);
}
