<?php
/**
 * FIXTURES DE CARACTÉRISATION — structure complète de la base e-note (Phase 4).
 *
 *   php outils/caracterisation/generer-fixtures-base.php
 *
 * Le plan exige, pour F4 : « rejouer les 24 imports e-note réels et comparer
 * octet à octet la structure produite avec celle de PHP ».
 *
 * Stocker 24 structures complètes pèserait plusieurs mégaoctets — les
 * affectations font à elles seules 123 Ko. On enregistre donc :
 *   - pour LES 24 imports : les effectifs + une EMPREINTE SHA-256 de la
 *     structure canonique. Deux structures identiques ont la même empreinte ;
 *     la moindre différence la change. La comparaison reste donc exacte.
 *   - pour 3 imports représentatifs : la structure entière, lisible, qui sert
 *     à diagnostiquer une divergence quand l'empreinte ne correspond plus.
 */

$racinePhp = __DIR__ . '/../../../gestion_edt';

require_once $racinePhp . '/config/database.php';
require_once $racinePhp . '/includes/parse_base_rows.php';

$sortie = __DIR__ . '/../../shared/src/domain/enote/__fixtures__';
if (!is_dir($sortie)) mkdir($sortie, 0755, true);

/**
 * Forme canonique : clés triées récursivement, pour que l'empreinte ne dépende
 * pas de l'ordre d'insertion des clés d'un objet associatif.
 */
function canoniser($valeur) {
    if (!is_array($valeur)) return $valeur;

    $estListe = array_keys($valeur) === range(0, count($valeur) - 1);
    if ($estListe) return array_map('canoniser', $valeur);

    ksort($valeur);
    return array_map('canoniser', $valeur);
}

function empreinte(array $structure): string {
    return hash('sha256', json_encode(canoniser($structure), JSON_UNESCAPED_UNICODE));
}

/**
 * Les 14 colonnes réellement lues par pb_buildBaseStructureFromRows, sur les 51
 * du fichier. Les entrées sont réduites à celles-ci : stocker les lignes
 * entières pesait 2,4 Mo pour un résultat identique.
 */
const COLONNES_LUES = [4, 8, 12, 15, 16, 18, 19, 20, 21, 22, 23, 27, 35, 36];

/** Ligne complète → tableau des 14 valeurs utiles, dans l'ordre ci-dessus. */
function reduire(array $row): array {
    $reduite = [];
    foreach (COLONNES_LUES as $index) {
        $reduite[] = (string)($row[$index] ?? '');
    }
    return $reduite;
}

$imports = [];
$detailles = [];
$entreesVues = [];

$stmt = $pdo->query(
    "SELECT id, etablissement_id, nom_fichier, donnees_json
     FROM donnees_avancement ORDER BY id"
);

foreach ($stmt as $ligne) {
    $rows = json_decode($ligne['donnees_json'], true);
    if (!is_array($rows) || $rows === []) continue;

    // PDO à null : la masse horaire des formateurs déjà connus n'est pas
    // relue en base. Le résultat ne dépend donc que du fichier — c'est ce qui
    // rend la caractérisation reproductible.
    $structure = pb_buildBaseStructureFromRows($rows, [], null, null);

    $entrees = array_map('reduire', $rows);

    // Plusieurs imports sont le MÊME fichier réimporté : #36, 37, 39, 41…
    // portent tous 19 formateurs et 419 affectations. Les garder tous ferait
    // peser des mégaoctets sans rien vérifier de plus.
    $empreinteEntree = hash('sha256', json_encode($entrees, JSON_UNESCAPED_UNICODE));
    if (isset($entreesVues[$empreinteEntree])) {
        $imports[$entreesVues[$empreinteEntree]]['doublons'][] = (int)$ligne['id'];
        continue;
    }
    $entreesVues[$empreinteEntree] = count($imports);

    $imports[] = [
        'entrees'         => $entrees,
        'doublons'        => [],
        'importId'        => (int)$ligne['id'],
        'etablissementId' => (int)$ligne['etablissement_id'],
        'fichier'         => $ligne['nom_fichier'],
        'lignes'          => count($rows),
        'effectifs'       => [
            'formateurs'              => count($structure['formateurs']),
            'formateursDetails'       => count($structure['formateurs_details']),
            'nouveauxFormateurs'      => count($structure['nouveaux_formateurs']),
            'formateursSansMatricule' => count($structure['formateurs_sans_matricule']),
            'groupes'                 => count($structure['groupes']),
            'fusionGroupes'           => count($structure['fusionGroupes']),
            'affectations'            => count($structure['affectations']),
            'groupeModes'             => count($structure['groupeModes']),
        ],
        'empreinte' => empreinte($structure),
    ];
}

// Trois imports représentatifs : le plus riche, le plus pauvre, et un médian.
usort($imports, fn($a, $b) => $a['effectifs']['affectations'] <=> $b['effectifs']['affectations']);
$representatifs = [$imports[0]['importId'], $imports[intdiv(count($imports), 2)]['importId'], end($imports)['importId']];
usort($imports, fn($a, $b) => $a['importId'] <=> $b['importId']);

foreach ($representatifs as $importId) {
    $stmt = $pdo->prepare("SELECT donnees_json FROM donnees_avancement WHERE id = ?");
    $stmt->execute([$importId]);
    $rows = json_decode((string)$stmt->fetchColumn(), true);
    if (!is_array($rows)) continue;

    $detailles[] = [
        'importId'  => $importId,
        'structure' => pb_buildBaseStructureFromRows($rows, [], null, null),
    ];
}

$options = JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

// Sans mise en forme : ce fichier porte les donnees d'entree, la lisibilite
// n'y apporte rien et multiplie son poids par trois.
file_put_contents("$sortie/base-empreintes.json", json_encode([
    'genereLe'      => date('c'),
    'source'        => 'includes/parse_base_rows.php (pb_buildBaseStructureFromRows)',
    'colonnesLues'  => COLONNES_LUES,
    'total'         => count($imports),
    'imports'       => $imports,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

file_put_contents("$sortie/base-detaillee.json", json_encode([
    'genereLe'       => date('c'),
    'representatifs' => $representatifs,
    'imports'        => $detailles,
], $options));

echo "imports caracterises : ", count($imports), "\n";
echo "detailles            : ", implode(', ', $representatifs), "\n";
foreach ($imports as $i) {
    echo sprintf(
        "  #%-3d %3d formateurs %3d groupes %5d affectations\n",
        $i['importId'], $i['effectifs']['formateurs'], $i['effectifs']['groupes'], $i['effectifs']['affectations']
    );
}
