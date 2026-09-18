/**
 * Lecture d'un export Konosys — les stagiaires de l'établissement.
 * ← api/students/upload.php:62-121 + le `sheet_to_json` de canvas.html:1143
 *
 * ═══ CE QUE KONOSYS REND, ET POURQUOI CE N'EST PAS UNE LIGNE PAR PERSONNE ═══
 * Le fichier porte une ligne par INSCRIPTION : un stagiaire suivant un tronc
 * diplômant et un module FQ y figure deux fois, avec deux `CodeDiplome`. MySQL
 * les stockait telles quelles — 1 671 lignes pour ~995 personnes — et chaque
 * lecture devait ensuite deviner laquelle faisait foi ; c'est ce que faisait le
 * tri `CASE WHEN niveau = 'FQ'` de `create_user_account.php:88-100`.
 *
 * Ici les lignes sont REGROUPÉES par matricule : un stagiaire, un document, et
 * la liste de ses groupes. L'index unique `(établissement, matricule)` devient
 * alors tenable, et c'est lui qui garantit un seul compte par personne.
 */

/** Colonnes lues, telles qu'elles apparaissent en tête du fichier Konosys. */
export const COLONNES_KONOSYS = {
  matricule: ['MatriculeEtudiant'],
  nom: ['Nom'],
  prenom: ['Prenom'],
  nomArabe: ['Nom_Arabe'],
  prenomArabe: ['Prenom_arabe'],
  cin: ['CIN'],
  dateNaissance: ['DateNaissance'],
  // ⚠️ Konosys écrit tantôt « CodeDiplome », tantôt « codediplome1 » — les deux
  // sont acceptés, comme le faisait `$s['CodeDiplome'] ?? $s['codediplome1']`.
  codeDiplome: ['CodeDiplome', 'codediplome1'],
  site: ['Site'],
  libelleLong: ['LibelleLong'],
};

const texte = (valeur) => String(valeur ?? '').trim();

/** Première colonne renseignée parmi les intitulés acceptés. */
function champ(ligne, intitules) {
  for (const intitule of intitules) {
    const valeur = texte(ligne?.[intitule]);
    if (valeur !== '') return valeur;
  }
  return '';
}

/**
 * Décompose `LibelleLong` en niveau, année et filière.
 * ← upload.php:75-98
 *
 * Exemple réel : « ISTA_NTIC_TS-Développement Digital (1A) »
 *   année   = ce qui est entre parenthèses            → « 1A »
 *   niveau  = 3ᵉ segment souligné du code, avant le tiret → « TS »
 *   filière = après le tiret, avant la parenthèse     → « Développement Digital »
 *
 * ⚠️ `LibelleLong` n'est PAS conservé — l'existant l'avait explicitement retiré
 * de l'insertion. Tout ce qu'il porte est dans ces trois champs.
 */
export function decomposerLibelle(libelleLong) {
  const libelle = texte(libelleLong);
  if (libelle === '') return { niveau: '', annee: '', filiere: '' };

  const entreParentheses = /\((.*?)\)/.exec(libelle);
  const annee = entreParentheses ? texte(entreParentheses[1]) : '';

  // Découpe au PREMIER tiret seulement : une filière peut en contenir.
  const separateur = libelle.indexOf('-');
  if (separateur === -1) return { niveau: '', annee, filiere: '' };

  const code = libelle.slice(0, separateur);
  const reste = libelle.slice(separateur + 1);

  const segments = code.split('_');
  const niveau = texte(segments[2] ?? '');

  const filiere = texte(reste.split('(')[0]);

  return { niveau, annee, filiere };
}

/**
 * Le groupe est-il un module de formation qualifiante ?
 *
 * Un stagiaire n'est FQ qu'en complément : sa ligne diplômante porte son
 * niveau, sa filière et son année réels, et c'est elle qui figure sur les
 * documents imprimés. C'est le sens du tri de `create_user_account.php`.
 */
const estFq = (niveau) => texte(niveau).toUpperCase() === 'FQ';

/**
 * Lignes Konosys → stagiaires, un par matricule.
 *
 * @param {Array<object>} lignes  lignes du fichier, clés = intitulés de colonnes
 * @returns {{stagiaires: Array, ignorees: number}}
 *   `ignorees` compte les lignes SANS matricule : elles ne peuvent être
 *   rattachées à personne, et les taire ferait croire à un import complet.
 */
export function lireStagiaires(lignes = []) {
  const parMatricule = new Map();
  let ignorees = 0;

  for (const ligne of lignes) {
    const matricule = champ(ligne, COLONNES_KONOSYS.matricule);
    if (matricule === '') {
      ignorees += 1;
      continue;
    }

    const { niveau, annee, filiere } = decomposerLibelle(
      champ(ligne, COLONNES_KONOSYS.libelleLong)
    );
    const groupe = champ(ligne, COLONNES_KONOSYS.codeDiplome);

    const existant = parMatricule.get(matricule);

    if (!existant) {
      parMatricule.set(matricule, {
        matricule,
        nom: champ(ligne, COLONNES_KONOSYS.nom),
        prenom: champ(ligne, COLONNES_KONOSYS.prenom),
        nomArabe: champ(ligne, COLONNES_KONOSYS.nomArabe),
        prenomArabe: champ(ligne, COLONNES_KONOSYS.prenomArabe),
        cin: champ(ligne, COLONNES_KONOSYS.cin),
        dateNaissance: champ(ligne, COLONNES_KONOSYS.dateNaissance),
        site: champ(ligne, COLONNES_KONOSYS.site),
        /*
         * ⚠️ L'adresse n'est PAS lue dans le fichier : `upload.php:74` la
         * FABRIQUE à partir du matricule. Konosys n'en fournit pas.
         */
        email: `${matricule}@ofppt-edu.ma`,
        groupes: groupe === '' ? [] : [groupe],
        groupePrincipal: estFq(niveau) || groupe === '' ? '' : groupe,
        niveau,
        annee,
        filiere,
      });
      continue;
    }

    // Ligne supplémentaire du même stagiaire : on ajoute son groupe…
    if (groupe !== '' && !existant.groupes.includes(groupe)) existant.groupes.push(groupe);

    /*
     * …et la ligne DIPLÔMANTE l'emporte pour l'identité scolaire. Sans cela, un
     * stagiaire dont la ligne FQ arrive en premier porterait « FQ » comme niveau
     * sur sa carte imprimée, et sa filière réelle serait perdue.
     */
    if (!estFq(niveau) && existant.groupePrincipal === '') {
      existant.groupePrincipal = groupe;
      existant.niveau = niveau;
      existant.annee = annee;
      existant.filiere = filiere;
    }
  }

  return { stagiaires: [...parMatricule.values()], ignorees };
}
