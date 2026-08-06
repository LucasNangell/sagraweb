<?php
/**
 * Verifica se o PHP da máquina atende aos requisitos do script EWS.
 * Uso: php verificar_php.php
 */

echo 'PHP ' . PHP_VERSION . PHP_EOL;

$minVersion = '7.4.0';
if (version_compare(PHP_VERSION, $minVersion, '<')) {
    fwrite(STDERR, "ERRO: PHP {$minVersion}+ necessário. Versão atual: " . PHP_VERSION . PHP_EOL);
    exit(1);
}

$required = ['curl', 'openssl', 'dom', 'json'];
$missing = [];
foreach ($required as $ext) {
    $ok = extension_loaded($ext);
    echo ($ok ? '[OK] ' : '[FALTA] ') . $ext . PHP_EOL;
    if (!$ok) {
        $missing[] = $ext;
    }
}

if ($missing !== []) {
    fwrite(STDERR, 'Habilite no php.ini: ' . implode(', ', $missing) . PHP_EOL);
    exit(1);
}

echo PHP_EOL . 'Ambiente OK para ews-email-php.' . PHP_EOL;
exit(0);
