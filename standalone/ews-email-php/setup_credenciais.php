<?php
/**
 * Gera credentials.enc com usuário/senha criptografados.
 *
 * Exemplos:
 *   php setup_credenciais.php --username "redecamara\P_XXXXXX" --generate-key
 *   php setup_credenciais.php --username "redecamara\P_XXXXXX" --password-file C:\temp\senha.txt --generate-key
 *   php setup_credenciais.php --username "redecamara\P_XXXXXX" --key-passphrase "frase-secreta-longa"
 */

declare(strict_types=1);

require_once __DIR__ . '/CredentialStore.php';

$options = getopt('', [
    'username:',
    'password::',
    'password-file:',
    'auth-mode::',
    'generate-key',
    'key-passphrase::',
    'help',
]);

if (isset($options['help'])) {
    echo <<<HELP
Uso:
  php setup_credenciais.php --username "redecamara\\P_XXXXXX" --generate-key
  php setup_credenciais.php --username "redecamara\\P_XXXXXX" --password-file senha.txt --generate-key
  php setup_credenciais.php --username "redecamara\\P_XXXXXX" --key-passphrase "sua-frase-secreta"

Opções:
  --username        Usuário NTLM (obrigatório)
  --password        Senha em texto (evite: fica no histórico do shell)
  --password-file   Arquivo com a senha (recomendado); uma linha, sem aspas
  --auth-mode       ntlm (padrão) ou negotiate
  --generate-key    Cria credentials.key aleatória (32 bytes, base64)
  --key-passphrase  Usa frase secreta em vez de credentials.key (defina EWS_CREDENTIALS_KEY igual)

Arquivos gerados (NÃO commitar):
  credentials.enc
  credentials.key   (se --generate-key)

HELP;
    exit(0);
}

$username = trim((string) ($options['username'] ?? ''));
if ($username === '') {
    fwrite(STDERR, "ERRO: informe --username\n");
    exit(1);
}

$password = resolvePassword($options);
if ($password === '') {
    fwrite(STDERR, "ERRO: senha vazia. Use --password-file ou --password\n");
    exit(1);
}

$authMode = strtolower(trim((string) ($options['auth-mode'] ?? 'ntlm')));
if (!in_array($authMode, ['ntlm', 'negotiate', 'auto'], true)) {
    fwrite(STDERR, "ERRO: --auth-mode inválido (ntlm, negotiate, auto)\n");
    exit(1);
}

$generateKey = array_key_exists('generate-key', $options);
$keyPassphrase = isset($options['key-passphrase']) ? (string) $options['key-passphrase'] : null;

if ($generateKey && $keyPassphrase !== null && $keyPassphrase !== '') {
    fwrite(STDERR, "ERRO: use apenas --generate-key OU --key-passphrase\n");
    exit(1);
}

try {
    $store = new CredentialStore(__DIR__);
    $store->save(
        [
            'username' => $username,
            'password' => $password,
            'auth_mode' => $authMode,
        ],
        $keyPassphrase,
        $generateKey
    );

    echo "OK — credenciais salvas em:\n";
    echo "  " . $store->encFilePath() . "\n";
    if ($generateKey) {
        echo "  " . $store->keyFilePath() . " (chave gerada)\n";
        echo "\nMantenha credentials.key em local seguro. Não versione no Git.\n";
    } elseif ($keyPassphrase !== null && $keyPassphrase !== '') {
        echo "\nDefina no ambiente antes de executar o envio:\n";
        echo '  $env:EWS_CREDENTIALS_KEY = "sua-frase-secreta"' . "\n";
    } else {
        echo "  " . $store->keyFilePath() . " (chave existente reutilizada)\n";
    }

    echo "\nTeste:\n  php enviar_teste.php --probe-only\n";
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'ERRO: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}

/**
 * @param array<string, mixed> $options
 */
function resolvePassword(array $options): string
{
    if (isset($options['password-file'])) {
        $path = (string) $options['password-file'];
        if (!is_file($path)) {
            fwrite(STDERR, "ERRO: password-file não encontrado: {$path}\n");
            exit(1);
        }
        return sanitizePassword((string) file_get_contents($path));
    }

    if (isset($options['password'])) {
        return (string) $options['password'];
    }

    echo 'Senha do domínio (NTLM): ';
    $line = fgets(STDIN);
    return $line === false ? '' : sanitizePassword($line);
}

function sanitizePassword(string $value): string
{
    $value = preg_replace('/^\xEF\xBB\xBF/', '', $value);
    return rtrim($value, "\r\n\0");
}
