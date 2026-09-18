<?php
/**
 * Exporte la table `repartitions` de MySQL vers un JSON, pour la reprise Mongo.
 *
 *   php outils/exporter-repartitions.php
 *
 * Écrit `outils/repartitions.json`, lu ensuite par
 * `backend/scripts/importer-repartitions.js`.
 *
 * Ce détour par un fichier est volontaire : il évite d'ajouter une dépendance
 * MySQL au backend Node pour une reprise qui ne se fera qu'une fois. Le jour où
 * la DRIF publie une nouvelle répartition, elle sera importée par l'écran
 * d'administration de la nouvelle application, pas par ce script.
 */

$racinePhp = __DIR__ . '/../../gestion_edt';
require_once $racinePhp . '/config/database.php';

$destination = __DIR__ . '/repartitions.json';

$lignes = $pdo
    ->query('SELECT * FROM repartitions ORDER BY id')
    ->fetchAll(PDO::FETCH_ASSOC);

if (!$lignes) {
    fwrite(STDERR, "La table `repartitions` est vide.\n");
    exit(1);
}

// `id` et `date_import` sont propres à MySQL : Mongo a les siens.
foreach ($lignes as &$ligne) {
    unset($ligne['id'], $ligne['date_import']);
}
unset($ligne);

file_put_contents(
    $destination,
    json_encode($lignes, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
);

printf("%d ligne(s) exportée(s) vers %s\n", count($lignes), $destination);
