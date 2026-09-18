<?php
/**
 * FIXTURES DE CARACTÉRISATION — masses horaires (Phase 2).
 *
 *   php outils/caracterisation/generer-fixtures-masses.php
 *
 * `enoteMassesHoraires()` (includes/functions.php:220) répartit la masse
 * horaire d'un cours entre semestre 1 et semestre 2. Ces heures alimentent
 * ensuite tout le module d'avancement (F7), où un écart d'arrondi est
 * immédiatement visible et contesté par les établissements.
 *
 * Point de vigilance du portage : `round()` en PHP et `Math.round()` en
 * JavaScript ne traitent pas les demis de la même façon, et PHP corrige en plus
 * l'imprécision des flottants avant d'arrondir. On fige donc les sorties réelles
 * plutôt que de supposer que les deux coïncident.
 */

$racinePhp = __DIR__ . '/../../../gestion_edt';

require_once $racinePhp . '/config/database.php';
require_once $racinePhp . '/includes/functions.php';

$sortie = __DIR__ . '/../../shared/src/domain/enote/__fixtures__';
if (!is_dir($sortie)) mkdir($sortie, 0755, true);

// Colonnes utilisées par enoteMassesHoraires.
const COL_PART_S1 = 23;  // X
const COL_PART_S2 = 27;  // AB
const COL_MHP     = 35;  // AJ  masse horaire présentielle
const COL_MHSYN   = 36;  // AK  masse horaire synchrone

$vus = [];
$stmt = $pdo->query("SELECT donnees_json FROM donnees_avancement");

foreach ($stmt as $ligne) {
    $rows = json_decode($ligne['donnees_json'], true);
    if (!is_array($rows)) continue;

    foreach ($rows as $row) {
        $entree = [
            'partS1' => (string)($row[COL_PART_S1] ?? ''),
            'partS2' => (string)($row[COL_PART_S2] ?? ''),
            'mhp'    => (string)($row[COL_MHP] ?? ''),
            'mhsyn'  => (string)($row[COL_MHSYN] ?? ''),
        ];

        $cle = implode('|', $entree);
        if (isset($vus[$cle])) continue;

        // On reconstruit une ligne minimale : la fonction ne lit que 4 colonnes.
        $ligneMinimale = [];
        $ligneMinimale[COL_PART_S1] = $entree['partS1'];
        $ligneMinimale[COL_PART_S2] = $entree['partS2'];
        $ligneMinimale[COL_MHP]     = $entree['mhp'];
        $ligneMinimale[COL_MHSYN]   = $entree['mhsyn'];

        $vus[$cle] = ['entree' => $entree, 'sortie' => enoteMassesHoraires($ligneMinimale)];
    }
}

$cas = array_values($vus);

file_put_contents("$sortie/masses-horaires.json", json_encode([
    'genereLe' => date('c'),
    'source'   => 'includes/functions.php (enoteMassesHoraires)',
    'total'    => count($cas),
    'cas'      => $cas,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

echo "combinaisons distinctes : ", count($cas), "\n";
echo "ecrit dans              : shared/src/domain/enote/__fixtures__/masses-horaires.json\n";
