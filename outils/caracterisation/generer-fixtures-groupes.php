<?php
/**
 * FIXTURES DE CARACTÉRISATION — renommage des groupes (Phase 2).
 *
 *   php outils/caracterisation/generer-fixtures-groupes.php
 *
 * Le nom d'un groupe n'est pas celui du fichier e-note : l'import lui ajoute un
 * suffixe de désambiguïsation — « (CDS) », « (FQ) », ou le préfixe de sa filière
 * quand un même nom est porté par plusieurs filières. Ce nom renommé devient
 * l'identifiant du groupe dans les emplois du temps : s'il change, toutes les
 * séances qui le référencent deviennent orphelines.
 *
 * On fige donc ici le comportement réel de `pb_buildBaseStructureFromRows()`
 * sur les données de production.
 */

$racinePhp = __DIR__ . '/../../../gestion_edt';

require_once $racinePhp . '/config/database.php';
require_once $racinePhp . '/includes/parse_base_rows.php';

$sortie = __DIR__ . '/../../shared/src/domain/enote/__fixtures__';
if (!is_dir($sortie)) mkdir($sortie, 0755, true);

// Index des colonnes utiles, tels que définis dans pb_buildBaseStructureFromRows.
const COL_GROUPE       = 8;
const COL_CODE_FILIERE = 4;
const COL_FUSION       = 12;
const COL_MODE         = 15;

// ---------------------------------------------------------------------------
// 1. Cas unitaires de nettoyage de suffixe
// ---------------------------------------------------------------------------
$nomsBruts = [];
$stmt = $pdo->query("SELECT donnees_json FROM donnees_avancement");
foreach ($stmt as $ligne) {
    $rows = json_decode($ligne['donnees_json'], true);
    if (!is_array($rows)) continue;
    foreach ($rows as $row) {
        $g = trim((string)($row[COL_GROUPE] ?? ''));
        if ($g !== '') $nomsBruts[$g] = true;
    }
}

// Les noms déjà renommés stockés en base : ce sont eux qui font courir le
// risque de double suffixe (« ACADA101 (FQ) (FQ) ») lors d'un réimport.
$stmt = $pdo->query("SELECT donnees_json FROM donnees_de_base WHERE type_donnee = 'groupe'");
foreach ($stmt as $ligne) {
    $liste = json_decode($ligne['donnees_json'], true);
    if (!is_array($liste)) continue;
    foreach ($liste as $g) {
        if (is_string($g) && trim($g) !== '') $nomsBruts[trim($g)] = true;
    }
}

$suffixes = [];
foreach (array_keys($nomsBruts) as $nom) {
    $suffixes[] = ['entree' => $nom, 'pb_stripSuffixeGroupe' => pb_stripSuffixeGroupe($nom)];
}
usort($suffixes, fn($a, $b) => strcmp($a['entree'], $b['entree']));

// ---------------------------------------------------------------------------
// 2. Renommage complet, import par import (traitement de LOT : le suffixe de
//    filière dépend de l'ensemble des lignes)
// ---------------------------------------------------------------------------
$imports = [];
$stmt = $pdo->query(
    "SELECT id, etablissement_id, nom_fichier, donnees_json
     FROM donnees_avancement ORDER BY id"
);

foreach ($stmt as $ligne) {
    $rows = json_decode($ligne['donnees_json'], true);
    if (!is_array($rows) || $rows === []) continue;

    // Entrée réduite aux colonnes qui pilotent le renommage, et débarrassée
    // des tuples strictement identiques : ils n'apportent rien au résultat et
    // feraient peser 2 Mo de fixture au dépôt. La déduplication conserve la
    // DERNIÈRE occurrence, ce qui préserve le « dernier gagne » de groupeModes.
    $vus = [];
    foreach ($rows as $index => $row) {
        $tuple = [
            'groupe'      => (string)($row[COL_GROUPE] ?? ''),
            'codeFiliere' => (string)($row[COL_CODE_FILIERE] ?? ''),
            'fusion'      => (string)($row[COL_FUSION] ?? ''),
            'mode'        => (string)($row[COL_MODE] ?? ''),
        ];
        $vus[implode('|', $tuple)] = $tuple;
    }
    $entrees = array_values($vus);

    // Sortie de l'implémentation de production, sans en-tête ni PDO :
    // seul le renommage nous intéresse ici.
    $structure = pb_buildBaseStructureFromRows($rows, [], null, null);

    $imports[] = [
        'importId'        => (int)$ligne['id'],
        'etablissementId' => (int)$ligne['etablissement_id'],
        'fichier'         => $ligne['nom_fichier'],
        'entrees'         => $entrees,
        'groupes'         => $structure['groupes'],
        'fusionGroupes'   => $structure['fusionGroupes'],
        'groupeModes'     => $structure['groupeModes'],
    ];
}

$options = JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

file_put_contents("$sortie/suffixes-unitaires.json", json_encode([
    'genereLe' => date('c'),
    'source'   => 'includes/parse_base_rows.php (pb_stripSuffixeGroupe)',
    'total'    => count($suffixes),
    'cas'      => $suffixes,
], $options));

file_put_contents("$sortie/renommage-imports.json", json_encode([
    'genereLe' => date('c'),
    'source'   => 'includes/parse_base_rows.php (pb_buildBaseStructureFromRows)',
    'total'    => count($imports),
    'imports'  => $imports,
], $options));

echo "noms de groupes distincts : ", count($suffixes), "\n";
echo "imports caracterises      : ", count($imports), "\n";
echo "ecrit dans                : shared/src/domain/enote/__fixtures__/\n";
