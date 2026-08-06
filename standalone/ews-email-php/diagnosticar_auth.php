<?php
/**
 * Diagnóstico de autenticação EWS — compare a saída entre as duas máquinas.
 * Uso: php diagnosticar_auth.php
 */

declare(strict_types=1);

require_once __DIR__ . '/EwsMailSender.php';

$config = require __DIR__ . '/config.php';

echo "=== Diagnóstico EWS ===\n\n";

echo "--- Ambiente ---\n";
echo 'PHP        : ' . PHP_VERSION . "\n";
if (function_exists('curl_version')) {
    $curl = curl_version();
    echo 'cURL       : ' . ($curl['version'] ?? '?') . "\n";
    echo 'SSL        : ' . ($curl['ssl_version'] ?? '?') . "\n";
    echo 'libz       : ' . ($curl['libz_version'] ?? '?') . "\n";
}
echo 'SO         : ' . PHP_OS . "\n";
$whoami = '';
if (function_exists('shell_exec')) {
    $whoami = strtolower(trim((string) shell_exec('whoami 2>nul') ?: ''));
}
echo 'whoami     : ' . ($whoami !== '' ? $whoami : '(indisponível)') . "\n";
echo 'Endpoint   : ' . $config['ews_url'] . "\n\n";

echo "--- Credencial ---\n";
$username = trim((string) ($config['username'] ?? ''));
$passwordLen = strlen((string) ($config['password'] ?? ''));
echo 'Usuário    : ' . ($username !== '' ? $username : '(vazio)') . "\n";
echo 'Senha len  : ' . $passwordLen . "\n";
echo 'Fonte      : ';
if (is_file(__DIR__ . '/credentials.enc')) {
    echo "credentials.enc + " . (is_file(__DIR__ . '/credentials.key') ? 'credentials.key' : 'EWS_CREDENTIALS_KEY') . "\n";
} elseif ($username !== '') {
    echo "variáveis de ambiente\n";
} else {
    echo "negotiate (Windows)\n";
}

if ($username === '' || $passwordLen === 0) {
    fwrite(STDERR, "\nSem credencial NTLM. Use credentials.enc ou EWS_USERNAME/EWS_PASSWORD.\n");
    exit(1);
}

echo "\n--- Teste EWS (NTLM com variações automáticas) ---\n";

try {
    $sender = new EwsMailSender($config);
    $variants = $sender->getNtlmUsernameVariantsForDiagnostics();
    echo "Formatos de usuário:\n";
    foreach ($variants as $variant) {
        echo "  - {$variant}\n";
    }

    $ok = $sender->probeMailboxAccess((string) $config['from_mailbox']);
    if ($ok) {
        echo "\nRESULTADO: OK nesta máquina.\n";
        exit(0);
    }

    echo "\nRESULTADO: FALHOU com NTLM (credentials.enc).\n\n";

    $credUser = strtolower($username);
    if ($whoami !== '' && $credUser !== '' && $whoami !== $credUser) {
        echo "CAUSA PROVÁVEL: usuário Windows logado ({$whoami}) é DIFERENTE do\n";
        echo "credentials.enc ({$username}). NTLM remoto com outra conta costuma dar 401\n";
        echo "neste PHP/cURL, mesmo com senha correta.\n\n";
        echo "Se você quer enviar com SUAS credenciais nesta máquina, use PHP com curl.exe:\n";
        echo "  php enviar_teste.php\n";
        echo "  (modo auto tenta curl.exe após 401 do PHP)\n";
        echo "Ou force: EWS_HTTP_TRANSPORT=curl_exe php enviar_teste.php\n\n";
        echo "Alternativa: conta logada + impersonation (precisa permissão do p_921456):\n";
        echo "  php enviar_windows.php\n\n";
    }

    echo "PHP/cURL desta máquina pode falhar NTLM com credencial de outro usuário.\n";
    echo "EwsMailSender.php é uma CLASSE — use enviar_teste.php ou enviar_teste.ps1.\n";
    exit(2);
} catch (Throwable $e) {
    fwrite(STDERR, 'ERRO: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
