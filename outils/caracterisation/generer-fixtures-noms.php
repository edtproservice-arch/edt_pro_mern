<?php
/**
 * Génère les FIXTURES DE CARACTÉRISATION pour la normalisation des noms de
 * formateurs (Phase 2 du plan de migration).
 *
 *   php outils/caracterisation/generer-fixtures-noms.php
 *
 * Principe : on exécute les implémentations PHP EXISTANTES sur les données
 * réelles de production, et on fige leurs sorties. Le portage JavaScript devra
 * reproduire ces sorties à l'identique. Toute divergence devient alors une
 * décision explicite, pas un accident découvert six mois plus tard.
 *
 * C'est le garde-fou du module F4, classé en risque critique : un import qui
 * produit des identifiants de formateurs différents casse rétroactivement tous
 * les emplois du temps déjà saisis.
 *
 * ⚠️ Ce script lit le dépôt PHP voisin. Il est temporaire — à supprimer une
 * fois la Phase 4 validée.
 */

$racinePhp = __DIR__ . '/../../../gestion_edt';

require_once $racinePhp . '/config/database.php';
require_once $racinePhp . '/includes/functions.php';
require_once $racinePhp . '/includes/parse_base_rows.php';

$sortie = __DIR__ . '/../../shared/src/domain/formateurs/__fixtures__';
if (!is_dir($sortie)) mkdir($sortie, 0755, true);

// ---------------------------------------------------------------------------
// 1. Corpus : tous les noms de formateurs réellement présents en base
// ---------------------------------------------------------------------------
$noms = [];

// a) Noms bruts des bases e-note importées (colonnes 20 et 22).
$stmt = $pdo->query("SELECT etablissement_id, donnees_json FROM donnees_avancement");
foreach ($stmt as $ligne) {
    $rows = json_decode($ligne['donnees_json'], true);
    if (!is_array($rows)) continue;
    foreach ($rows as $row) {
        foreach ([20, 22] as $colonne) {
            $valeur = trim((string)($row[$colonne] ?? ''));
            if ($valeur !== '') $noms[$valeur] = true;
        }
    }
}

// b) Noms déjà enregistrés dans formateurs_details.
$stmt = $pdo->query("SELECT DISTINCT nom_formateur FROM formateurs_details WHERE nom_formateur <> ''");
foreach ($stmt as $ligne) $noms[trim($ligne['nom_formateur'])] = true;

$corpus = array_keys($noms);
sort($corpus);

// ---------------------------------------------------------------------------
// 2. Sorties des fonctions unitaires, nom par nom
// ---------------------------------------------------------------------------
$unitaires = [];
foreach ($corpus as $nom) {
    $unitaires[] = [
        'entree'          => $nom,
        'getBaseName'     => getBaseName($nom),
        'getFormattedName'=> getFormattedName($nom),
    ];
}

// ---------------------------------------------------------------------------
// 3. Résolution d'homonymes, par établissement et par année
//    (c'est un traitement de GROUPE : le résultat d'un nom dépend des autres)
// ---------------------------------------------------------------------------
$groupes = [];
$stmt = $pdo->query(
    "SELECT etablissement_id, annee_scolaire, donnees_json
     FROM donnees_de_base WHERE type_donnee = 'formateur' ORDER BY etablissement_id, annee_scolaire"
);

foreach ($stmt as $ligne) {
    $liste = json_decode($ligne['donnees_json'], true);
    if (!is_array($liste) || $liste === []) continue;

    // La liste existe en deux formats selon l'ancienneté : simples chaînes, ou
    // objets {matricule, nom_complet}. Les deux doivent être caractérisés.
    $entrees = [];
    foreach ($liste as $item) {
        $nomComplet = is_array($item) ? ($item['nom_complet'] ?? '') : (string)$item;
        $matricule  = is_array($item) ? ($item['matricule'] ?? '') : '';
        if (trim($nomComplet) === '') continue;
        $entrees[] = ['nom_complet' => $nomComplet, 'matricule' => $matricule];
    }
    if ($entrees === []) continue;

    $groupes[] = [
        'etablissementId' => (int)$ligne['etablissement_id'],
        'anneeScolaire'   => (int)$ligne['annee_scolaire'],
        'entrees'         => $entrees,
        // Les deux implémentations concurrentes, sur la MÊME entrée.
        'resolveNameConflicts'    => array_map(
            fn($f) => ['nom_complet' => $f['nom_complet'], 'nom' => $f['nom'] ?? null],
            resolveNameConflicts($entrees)
        ),
        'pb_resolveNameConflicts' => array_map(
            fn($f) => ['nom_complet' => $f['nom_complet'], 'nom_unique' => $f['nom_unique'] ?? null],
            pb_resolveNameConflicts($entrees)
        ),
    ];
}

// ---------------------------------------------------------------------------
// 4. Écriture
// ---------------------------------------------------------------------------
$options = JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

file_put_contents("$sortie/noms-unitaires.json", json_encode([
    'genereLe' => date('c'),
    'source'   => 'includes/functions.php (getBaseName, getFormattedName)',
    'total'    => count($unitaires),
    'cas'      => $unitaires,
], $options));

file_put_contents("$sortie/homonymes-groupes.json", json_encode([
    'genereLe' => date('c'),
    'source'   => 'includes/functions.php + includes/parse_base_rows.php',
    'total'    => count($groupes),
    'groupes'  => $groupes,
], $options));

echo "corpus de noms      : ", count($corpus), "\n";
echo "groupes d'homonymes : ", count($groupes), "\n";
echo "ecrit dans          : shared/src/domain/formateurs/__fixtures__/\n";
