<?php
/**
 * Exporta credenciais do config/credentials.enc para uso por enviar_teste.ps1.
 * Uso interno: php carregar_credenciais.php
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

$config = require __DIR__ . '/config.php';
$user = trim((string) ($config['username'] ?? ''));
$pass = (string) ($config['password'] ?? '');

if ($user === '' || $pass === '') {
    fwrite(STDERR, "Credencial ausente.\n");
    exit(1);
}

echo json_encode(
    [
        'username' => $user,
        'password' => $pass,
        'from_mailbox' => (string) ($config['from_mailbox'] ?? 'sepim.deapa@camara.leg.br'),
        'test_to' => (string) ($config['test_to'] ?? 'lucassantosabreu@gmail.com'),
        'ews_url' => (string) ($config['ews_url'] ?? 'https://ce.camara.leg.br/EWS/Exchange.asmx'),
    ],
    JSON_UNESCAPED_UNICODE
);
