/**
 * Import d'une liste de formateurs depuis un classeur.
 * ← public/assets/js/affectation-carte.js:761-950 (importFormateursExcel)
 *
 * Le format attendu est celui du canevas : Mle · Nom & Prénom · MHS Annuelle.
 * Mais les états fournis par les directions régionales varient, donc les
 * colonnes sont RECONNUES par leur intitulé plutôt que par leur position — un
 * fichier dont l'ordre diffère reste lisible.
 *
 * ⚠️ La masse horaire attendue est la masse STATUTAIRE ANNUELLE, pas le total
 * des heures affectées. La confusion fausse tous les taux de charge (F7).
 */

/** L'en-tête n'est pas toujours en première ligne : les états portent un titre. */
const LIGNES_ENTETE_EXAMINEES = 5;

function texte(valeur) {
  return String(valeur ?? '').trim();
}

function cle(valeur) {
  return texte(valeur).toUpperCase();
}

/**
 * Repère les colonnes du fichier.
 * ← la boucle de détection d'en-tête, reprise à l'identique
 *
 * @returns {{ligneEntete: number, nom: number, matricule: number,
 *            masseHoraire: number, email: number} | null}
 *   `null` quand aucune colonne de nom n'a été trouvée : sans elle, rien n'est
 *   exploitable.
 */
export function detecterColonnes(lignes) {
  if (!Array.isArray(lignes)) {
    throw new TypeError('detecterColonnes attend un tableau de lignes');
  }

  const limite = Math.min(lignes.length, LIGNES_ENTETE_EXAMINEES);
  let meilleur = null;
  let meilleurScore = 0;

  for (let rang = 0; rang < limite; rang += 1) {
    const entete = (lignes[rang] ?? []).map((cellule) => texte(cellule).toLowerCase());

    let nom = -1;
    let matricule = -1;
    let masseHoraire = -1;
    let email = -1;

    for (let colonne = 0; colonne < entete.length; colonne += 1) {
      const intitule = entete[colonne];
      if (intitule.includes('mle') || intitule.includes('matricule')) matricule = colonne;
      if (intitule.includes('nom') || intitule.includes('prénom') || intitule.includes('formateur'))
        nom = colonne;
      // MHS, MHA ou « masse horaire » selon l'état fourni par la direction.
      if (intitule.includes('mhs') || intitule.includes('mha') || intitule.includes('masse'))
        masseHoraire = colonne;
      if (intitule.includes('email')) email = colonne;
    }

    if (nom === -1) continue;

    // On retient la ligne qui reconnaît le PLUS de colonnes, pas la première
    // qui en reconnaît une. Sans cela, un titre comme « ÉTAT DES FORMATEURS »
    // passe pour l'en-tête — il contient « formateur » — et l'import ne lit
    // plus qu'une colonne. L'existant s'arrêtait à la première ligne trouvée.
    const score = [nom, matricule, masseHoraire, email].filter((c) => c !== -1).length;

    if (score > meilleurScore) {
      meilleurScore = score;
      meilleur = { ligneEntete: rang, nom, matricule, masseHoraire, email };
    }
  }

  return meilleur;
}

/**
 * Extrait les formateurs du classeur.
 *
 * @returns {{formateurs: Array<{nom, matricule, email, masseHoraire}>,
 *            colonnes: object, lignesIgnorees: number}}
 * @throws {Error} quand la colonne des noms est introuvable
 */
export function lireFormateurs(lignes) {
  const colonnes = detecterColonnes(lignes);

  if (!colonnes) {
    throw new Error(
      'Colonne « Nom & Prénom » introuvable. Reportez-vous au canevas : Mle · Nom & Prénom · MHS Annuelle.'
    );
  }

  const formateurs = [];
  const vus = new Set();
  let lignesIgnorees = 0;

  for (let rang = colonnes.ligneEntete + 1; rang < lignes.length; rang += 1) {
    const ligne = lignes[rang] ?? [];
    // Le nom est mis en majuscules : c'est la clé d'appariement avec les
    // affectations, et un fichier peut mélanger les casses.
    const nom = cle(ligne[colonnes.nom]);

    if (!nom) {
      lignesIgnorees += 1;
      continue;
    }

    // Un même formateur peut apparaître deux fois dans un état régional.
    if (vus.has(nom)) {
      lignesIgnorees += 1;
      continue;
    }
    vus.add(nom);

    const masse =
      colonnes.masseHoraire === -1
        ? 0
        : Number.parseInt(texte(ligne[colonnes.masseHoraire]), 10) || 0;

    formateurs.push({
      nom,
      matricule: colonnes.matricule === -1 ? '' : texte(ligne[colonnes.matricule]),
      email: colonnes.email === -1 ? '' : texte(ligne[colonnes.email]),
      masseHoraire: masse,
    });
  }

  return { formateurs, colonnes, lignesIgnorees };
}

/**
 * Fusionne la liste importée avec celle déjà saisie.
 *
 * Deux modes, comme dans l'existant :
 *   - `completer` : ajoute et met à jour, ne retire jamais personne ;
 *   - `remplacer` : retire en plus les absents du fichier — SAUF ceux qui
 *     portent encore une affectation.
 *
 * ⚠️ Cette protection est le correctif d'un défaut réel : le remplacement brut
 * d'origine effaçait les formateurs absents du fichier, et leurs affectations
 * avec eux, sans le dire.
 *
 * L'appariement se fait d'abord sur le MATRICULE — identifiant stable — puis
 * sur le nom, dont l'ordre des mots peut différer d'un état à l'autre.
 *
 * @param {Array} existants
 * @param {Array} importes
 * @param {{remplacer?: boolean, proteges?: string[]}} options
 *   `proteges` : noms encore portés par une affectation.
 * @returns {{formateurs: Array, ajoutes: number, misAJour: number,
 *            retires: string[], conserves: string[]}}
 */
export function fusionnerFormateurs(existants = [], importes = [], options = {}) {
  const { remplacer = false, proteges = [] } = options;

  // Les index portent sur les COPIES, pas sur les objets reçus : c'est la copie
  // qu'on modifie ensuite. Indexer les originaux donnerait des références que
  // le résultat ne contient pas.
  const resultat = existants.map((formateur) => ({ ...formateur }));

  const parMatricule = new Map();
  const parNom = new Map();

  for (const formateur of resultat) {
    if (formateur.matricule) parMatricule.set(cle(formateur.matricule), formateur);
    parNom.set(cle(formateur.nom), formateur);
  }

  let ajoutes = 0;
  let misAJour = 0;
  const nomsImportes = new Set();

  for (const nouveau of importes) {
    const existant =
      (nouveau.matricule && parMatricule.get(cle(nouveau.matricule))) ??
      parNom.get(cle(nouveau.nom));

    if (existant) {
      // Un champ vide dans le fichier n'efface pas une valeur déjà saisie :
      // un état partiel ne doit pas faire perdre ce qui a été corrigé.
      if (nouveau.nom) existant.nom = nouveau.nom;
      if (nouveau.matricule) existant.matricule = nouveau.matricule;
      if (nouveau.email) existant.email = nouveau.email;
      if (nouveau.masseHoraire) existant.masseHoraire = nouveau.masseHoraire;

      misAJour += 1;
      // Le nom retenu est celui d'APRÈS mise à jour : c'est lui qui figure
      // dans le résultat, donc lui qui protège la ligne d'un retrait.
      nomsImportes.add(cle(existant.nom));
      continue;
    }

    resultat.push({ ...nouveau });
    nomsImportes.add(cle(nouveau.nom));
    ajoutes += 1;
  }

  if (!remplacer) {
    return { formateurs: trier(resultat), ajoutes, misAJour, retires: [], conserves: [] };
  }

  const protegesNormalises = new Set(proteges.map(cle));
  const retires = [];
  const conserves = [];

  const gardes = resultat.filter((formateur) => {
    const nom = cle(formateur.nom);
    if (nomsImportes.has(nom)) return true;

    if (protegesNormalises.has(nom)) {
      conserves.push(formateur.nom);
      return true;
    }

    retires.push(formateur.nom);
    return false;
  });

  return { formateurs: trier(gardes), ajoutes, misAJour, retires, conserves };
}

function trier(formateurs) {
  return [...formateurs].sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr'));
}

/**
 * Canevas montré avant l'import : le format attendu, avec des exemples.
 * ← la modale `#aff-canevas-overlay` de affectation-carte.html:229-300
 *
 * Les trois lignes reprennent les cas réels : matricule numérique, matricule
 * alphanumérique (vacataire), et des masses horaires de trois ordres différents.
 */
export const CANEVAS_FORMATEURS = {
  colonnes: ['Mle', 'Nom & Prénom', 'MHS Annuelle'],
  exemples: [
    ['61630', 'AMINE JAWAD', '910'],
    ['70245', 'KARIM AHMED', '1260'],
    ['BX10245', 'YASSINE SAID', '360'],
  ],
};
