<?php
/**
 * Armazenamento de credenciais EWS criptografadas em disco (AES-256-GCM).
 *
 * Arquivos (não versionar):
 * - credentials.enc  — usuário/senha criptografados
 * - credentials.key  — chave de 32 bytes (base64) OU use EWS_CREDENTIALS_KEY no ambiente
 */

declare(strict_types=1);

final class CredentialStore
{
    private const CIPHER = 'aes-256-gcm';
    private const IV_LENGTH = 12;
    private const TAG_LENGTH = 16;

    /** @var string */
    private $baseDir;

    /** @var string */
    private $encFilename;

    /** @var string */
    private $keyFilename;

    public function __construct(
        string $baseDir,
        string $encFilename = 'credentials.enc',
        string $keyFilename = 'credentials.key'
    ) {
        $this->baseDir = $baseDir;
        $this->encFilename = $encFilename;
        $this->keyFilename = $keyFilename;
    }

    public function encFilePath(): string
    {
        return $this->baseDir . DIRECTORY_SEPARATOR . $this->encFilename;
    }

    public function keyFilePath(): string
    {
        return $this->baseDir . DIRECTORY_SEPARATOR . $this->keyFilename;
    }

    public function hasEncryptedFile(): bool
    {
        return is_file($this->encFilePath());
    }

    /**
     * @return array{username: string, password: string, auth_mode?: string}|null
     */
    public function load(): ?array
    {
        if (!$this->hasEncryptedFile()) {
            return null;
        }

        $key = $this->resolveEncryptionKey();
        $payload = file_get_contents($this->encFilePath());
        if ($payload === false || trim($payload) === '') {
            throw new RuntimeException('credentials.enc está vazio ou ilegível.');
        }

        $json = $this->decrypt(trim($payload), $key);
        $data = json_decode($json, true);
        if (json_last_error() !== JSON_ERROR_NONE || !is_array($data)) {
            throw new RuntimeException('credentials.enc: JSON inválido após descriptografia.');
        }

        $username = trim((string) ($data['username'] ?? ''));
        $password = (string) ($data['password'] ?? '');
        if ($username === '' || $password === '') {
            throw new RuntimeException('credentials.enc não contém username/password.');
        }

        $result = [
            'username' => $username,
            'password' => $password,
        ];

        $authMode = trim((string) ($data['auth_mode'] ?? ''));
        if ($authMode !== '') {
            $result['auth_mode'] = $authMode;
        }

        return $result;
    }

    /**
     * @param array{username: string, password: string, auth_mode?: string} $credentials
     */
    public function save(array $credentials, ?string $keyPassphrase = null, bool $generateKeyFile = false): void
    {
        $username = trim((string) ($credentials['username'] ?? ''));
        $password = (string) ($credentials['password'] ?? '');
        if ($username === '' || $password === '') {
            throw new InvalidArgumentException('username e password são obrigatórios.');
        }

        $payload = json_encode(
            [
                'username' => $username,
                'password' => $password,
                'auth_mode' => (string) ($credentials['auth_mode'] ?? 'ntlm'),
            ],
            JSON_UNESCAPED_UNICODE
        );
        if ($payload === false) {
            throw new RuntimeException('Falha ao serializar credenciais para JSON.');
        }

        if ($generateKeyFile || !is_file($this->keyFilePath())) {
            if ($keyPassphrase !== null && $keyPassphrase !== '') {
                throw new InvalidArgumentException(
                    'Use apenas --generate-key OU --key-passphrase, não os dois.'
                );
            }
            $rawKey = random_bytes(32);
            file_put_contents($this->keyFilePath(), base64_encode($rawKey));
        }

        $key = $keyPassphrase !== null && $keyPassphrase !== ''
            ? $this->deriveKeyFromPassphrase($keyPassphrase)
            : $this->resolveEncryptionKey();

        $encrypted = $this->encrypt($payload, $key);
        file_put_contents($this->encFilePath(), $encrypted . PHP_EOL);
    }

    public function encrypt(string $plaintext, string $rawKey): string
    {
        $this->assertKeyLength($rawKey);
        $iv = random_bytes(self::IV_LENGTH);
        $tag = '';
        $ciphertext = openssl_encrypt(
            $plaintext,
            self::CIPHER,
            $rawKey,
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            '',
            self::TAG_LENGTH
        );

        if ($ciphertext === false) {
            throw new RuntimeException('Falha ao criptografar credenciais.');
        }

        return base64_encode($iv . $tag . $ciphertext);
    }

    public function decrypt(string $encoded, string $rawKey): string
    {
        $this->assertKeyLength($rawKey);
        $binary = base64_decode($encoded, true);
        if ($binary === false || strlen($binary) < self::IV_LENGTH + self::TAG_LENGTH + 1) {
            throw new RuntimeException('credentials.enc corrompido ou em formato inválido.');
        }

        $iv = substr($binary, 0, self::IV_LENGTH);
        $tag = substr($binary, self::IV_LENGTH, self::TAG_LENGTH);
        $ciphertext = substr($binary, self::IV_LENGTH + self::TAG_LENGTH);

        $plaintext = openssl_decrypt(
            $ciphertext,
            self::CIPHER,
            $rawKey,
            OPENSSL_RAW_DATA,
            $iv,
            $tag
        );

        if ($plaintext === false) {
            throw new RuntimeException(
                'Falha ao descriptografar credentials.enc (chave incorreta ou arquivo alterado).'
            );
        }

        return $plaintext;
    }

    private function resolveEncryptionKey(): string
    {
        $envPassphrase = getenv('EWS_CREDENTIALS_KEY');
        if (is_string($envPassphrase) && $envPassphrase !== '') {
            return $this->deriveKeyFromPassphrase($envPassphrase);
        }

        if (!is_file($this->keyFilePath())) {
            throw new RuntimeException(
                'Chave ausente: defina EWS_CREDENTIALS_KEY ou crie credentials.key com setup_credenciais.php --generate-key.'
            );
        }

        $encoded = trim((string) file_get_contents($this->keyFilePath()));
        $raw = base64_decode($encoded, true);
        if ($raw === false) {
            throw new RuntimeException('credentials.key inválido (base64 esperado).');
        }

        $this->assertKeyLength($raw);
        return $raw;
    }

    private function deriveKeyFromPassphrase(string $passphrase): string
    {
        return hash('sha256', $passphrase, true);
    }

    private function assertKeyLength(string $key): void
    {
        if (strlen($key) !== 32) {
            throw new RuntimeException('Chave de criptografia deve ter 32 bytes.');
        }
    }
}
