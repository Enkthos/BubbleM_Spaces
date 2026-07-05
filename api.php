<?php
declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);

const SESSION_LIFETIME = 86400;
const MAX_UPLOAD_BYTES = 26214400;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

$storageRoot = __DIR__ . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'sessions';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function jsonResponse(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $status = 400): void
{
    jsonResponse(['ok' => false, 'error' => $message], $status);
}

function sessionCode(): string
{
    $alphabet = CODE_ALPHABET;
    $last = strlen($alphabet) - 1;

    do {
        $code = '';
        for ($i = 0; $i < 6; $i++) {
            $code .= $alphabet[random_int(0, $last)];
        }
    } while (!preg_match('/[A-Z]/', $code) || !preg_match('/[0-9]/', $code));

    return $code;
}

function cleanCode(?string $value): string
{
    $code = strtoupper(trim((string) $value));
    if (!preg_match('/^[A-Z0-9]{6}$/', $code)) {
        fail('Enter a valid six-character session code.');
    }
    return $code;
}

function sessionDirectory(string $root, string $code): string
{
    return $root . DIRECTORY_SEPARATOR . $code;
}

function metadataPath(string $directory): string
{
    return $directory . DIRECTORY_SEPARATOR . 'session.json';
}

function readSession(string $root, string $code): array
{
    $directory = sessionDirectory($root, $code);
    $path = metadataPath($directory);
    if (!is_file($path)) {
        fail('Session not found or expired.', 404);
    }

    $session = json_decode((string) file_get_contents($path), true);
    if (!is_array($session) || (int) ($session['expiresAt'] ?? 0) <= time()) {
        fail('Session not found or expired.', 404);
    }
    return $session;
}

function publicSession(array $session): array
{
    return [
        'code' => $session['code'],
        'createdAt' => $session['createdAt'],
        'expiresAt' => $session['expiresAt'],
        'files' => array_values($session['files'] ?? []),
    ];
}

function cleanDevice(?string $device): string
{
    $device = trim((string) $device);
    $device = preg_replace('/[^\pL\pN ._-]/u', '', $device) ?: 'Shared device';
    return mb_substr($device, 0, 40);
}

function safeDownloadName(string $name): string
{
    $name = preg_replace('/[^A-Za-z0-9._-]/', '-', $name) ?: 'audio';
    return substr($name, 0, 100);
}

function cleanupExpired(string $root): void
{
    if (random_int(1, 20) !== 1 || !is_dir($root)) {
        return;
    }

    foreach (glob($root . DIRECTORY_SEPARATOR . '*', GLOB_ONLYDIR) ?: [] as $directory) {
        $path = metadataPath($directory);
        $session = is_file($path) ? json_decode((string) @file_get_contents($path), true) : null;
        if (!is_array($session) || (int) ($session['expiresAt'] ?? 0) <= time()) {
            foreach (glob($directory . DIRECTORY_SEPARATOR . '*') ?: [] as $file) {
                if (is_file($file)) {
                    @unlink($file);
                }
            }
            @rmdir($directory);
        }
    }
}

if (!is_dir($storageRoot) && !mkdir($storageRoot, 0750, true) && !is_dir($storageRoot)) {
    fail('Server storage is unavailable.', 500);
}

cleanupExpired($storageRoot);
$action = (string) ($_GET['action'] ?? $_POST['action'] ?? '');

if ($action === 'create') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }

    for ($attempt = 0; $attempt < 20; $attempt++) {
        $code = sessionCode();
        $directory = sessionDirectory($storageRoot, $code);
        if (@mkdir($directory, 0750)) {
            $session = [
                'code' => $code,
                'createdAt' => time(),
                'expiresAt' => time() + SESSION_LIFETIME,
                'files' => [],
            ];
            file_put_contents(metadataPath($directory), json_encode($session), LOCK_EX);
            jsonResponse(['ok' => true, 'session' => publicSession($session)], 201);
        }
    }
    fail('Could not create a session. Try again.', 500);
}

if ($action === 'list' || $action === 'join') {
    $code = cleanCode($_GET['code'] ?? $_POST['code'] ?? null);
    $session = readSession($storageRoot, $code);
    jsonResponse(['ok' => true, 'session' => publicSession($session)]);
}

if ($action === 'upload') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail('Method not allowed.', 405);
    }

    $code = cleanCode($_POST['code'] ?? null);
    $directory = sessionDirectory($storageRoot, $code);
    readSession($storageRoot, $code);

    if (!isset($_FILES['audio']) || !is_array($_FILES['audio'])) {
        fail('Choose an audio file to upload.');
    }
    $upload = $_FILES['audio'];
    if ((int) $upload['error'] !== UPLOAD_ERR_OK) {
        fail((int) $upload['error'] === UPLOAD_ERR_INI_SIZE ? 'The file exceeds the server upload limit.' : 'The audio upload failed.');
    }
    $size = (int) $upload['size'];
    if ($size <= 0 || $size > MAX_UPLOAD_BYTES) {
        fail('Audio files must be smaller than 25 MB.');
    }

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = (string) $finfo->file($upload['tmp_name']);
    $extensions = [
        'audio/mpeg' => 'mp3',
        'audio/mp3' => 'mp3',
        'audio/mp4' => 'm4a',
        'video/mp4' => 'm4a',
        'audio/webm' => 'webm',
        'video/webm' => 'webm',
        'audio/ogg' => 'ogg',
        'application/ogg' => 'ogg',
        'audio/wav' => 'wav',
        'audio/x-wav' => 'wav',
    ];
    if (!isset($extensions[$mime])) {
        fail('Unsupported audio format.');
    }

    $id = bin2hex(random_bytes(10));
    $storedName = $id . '.' . $extensions[$mime];
    $target = $directory . DIRECTORY_SEPARATOR . $storedName;
    if (!move_uploaded_file($upload['tmp_name'], $target)) {
        fail('The server could not store this audio.', 500);
    }

    $lock = fopen($directory . DIRECTORY_SEPARATOR . 'session.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) {
        @unlink($target);
        fail('The session is busy. Try again.', 503);
    }

    try {
        $session = readSession($storageRoot, $code);
        $originalName = safeDownloadName((string) ($upload['name'] ?? ('audio.' . $extensions[$mime])));
        $file = [
            'id' => $id,
            'name' => $originalName,
            'size' => $size,
            'mime' => $mime,
            'device' => cleanDevice($_POST['device'] ?? null),
            'createdAt' => time(),
            'url' => 'api.php?action=file&code=' . rawurlencode($code) . '&id=' . rawurlencode($id),
        ];
        $session['files'][] = $file;
        file_put_contents(metadataPath($directory), json_encode($session), LOCK_EX);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }

    jsonResponse(['ok' => true, 'file' => $file], 201);
}

if ($action === 'file') {
    $code = cleanCode($_GET['code'] ?? null);
    $id = strtolower(trim((string) ($_GET['id'] ?? '')));
    if (!preg_match('/^[a-f0-9]{20}$/', $id)) {
        fail('Invalid audio file.', 404);
    }
    $session = readSession($storageRoot, $code);
    $match = null;
    foreach ($session['files'] ?? [] as $file) {
        if (hash_equals((string) $file['id'], $id)) {
            $match = $file;
            break;
        }
    }
    if (!$match) {
        fail('Audio file not found.', 404);
    }
    $extension = pathinfo((string) $match['name'], PATHINFO_EXTENSION);
    $storedExtension = match ((string) $match['mime']) {
        'audio/mpeg', 'audio/mp3' => 'mp3',
        'audio/mp4', 'video/mp4' => 'm4a',
        'audio/webm', 'video/webm' => 'webm',
        'audio/ogg', 'application/ogg' => 'ogg',
        default => $extension ?: 'wav',
    };
    $path = sessionDirectory($storageRoot, $code) . DIRECTORY_SEPARATOR . $id . '.' . $storedExtension;
    if (!is_file($path)) {
        fail('Audio file not found.', 404);
    }

    $fileSize = (int) filesize($path);
    $start = 0;
    $end = $fileSize - 1;
    if (isset($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', (string) $_SERVER['HTTP_RANGE'], $range)) {
        if ($range[1] === '' && $range[2] !== '') {
            $suffixLength = min((int) $range[2], $fileSize);
            $start = $fileSize - $suffixLength;
        } else {
            $start = $range[1] === '' ? 0 : (int) $range[1];
            $end = $range[2] === '' ? $end : min((int) $range[2], $end);
        }
        if ($start < 0 || $start > $end || $start >= $fileSize) {
            http_response_code(416);
            header('Content-Range: bytes */' . $fileSize);
            exit;
        }
        http_response_code(206);
        header("Content-Range: bytes {$start}-{$end}/{$fileSize}");
    }

    $length = $end - $start + 1;
    header('Content-Type: ' . $match['mime']);
    header('Content-Length: ' . $length);
    header('Content-Disposition: inline; filename="' . safeDownloadName((string) $match['name']) . '"');
    header('Accept-Ranges: bytes');
    $handle = fopen($path, 'rb');
    if (!$handle) {
        fail('Audio file could not be opened.', 500);
    }
    fseek($handle, $start);
    $remaining = $length;
    while ($remaining > 0 && !feof($handle)) {
        $chunk = fread($handle, min(8192, $remaining));
        if ($chunk === false) {
            break;
        }
        echo $chunk;
        $remaining -= strlen($chunk);
    }
    fclose($handle);
    exit;
}

fail('Unknown action.', 404);
