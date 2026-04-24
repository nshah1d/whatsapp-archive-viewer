<?php
define('EXPECTED_TOKEN', '');
if (!isset($_SERVER['HTTP_X_CHRONICLE_TOKEN']) || $_SERVER['HTTP_X_CHRONICLE_TOKEN'] !== EXPECTED_TOKEN) {
    http_response_code(403);
    echo json_encode(["error" => "Forbidden"]);
    exit;
}

header('Content-Type: application/json');

$chatData = [];
$items = scandir('.');

foreach ($items as $folder) {
    if ($folder === '.' || $folder === '..' || !is_dir($folder)) {
        continue;
    }
    
    if (file_exists($folder . '/_chat.txt')) {
        $files = scandir($folder);
        $cleanFiles = array_values(array_diff($files, ['.', '..']));
        
        $chatData[] = [
            'id' => $folder,
            'files' => $cleanFiles
        ];
    }
}

echo json_encode($chatData);
?>
