/**
 * Les deux COURBES DE RÉFÉRENCE du graphe d'avancement, en heures.
 * ← `datasets.push({ label: 'Masse Horaire Statutaire' … })` et
 *   `{ label: 'Masse Horaire Globale' … }` d'avancement.html (l. 4635-4636)
 *
 * ═══ ⚠️ ELLES SONT SUR L'AXE DES HEURES, PAS DES POURCENTAGES ═══
 * L'existant les posait explicitement sur `yAxisID: 'y_hours'`, contrairement
 * aux courbes de taux. Ce sont des PLAFONDS à comparer aux barres : la masse
 * statutaire dit ce qu'un formateur doit assurer dans l'année, la masse globale
 * ce que le programme d'un groupe prévoit. Les mettre sur l'axe des taux les
 * rendrait incomparables à ce qu'elles bornent.
 *
 * ⚠️ CHACUNE SUR SON SEUL AXE : une masse statutaire n'a pas de sens pour un
 * groupe, ni une masse de programme pour une personne.
 */

/**
 * La masse du PROGRAMME de chaque groupe — ce que le référentiel prévoit, y
 * compris les modules que personne n'assure encore.
 *
 * ⚠️ ELLE SE SOMME SUR LES LIGNES RETENUES, donc APRÈS filtrage : sur une vue
 * réduite à la 1ʳᵉ année, le plafond doit descendre avec les barres. Calculée
 * une fois pour toutes côté serveur, elle resterait au niveau de l'année
 * entière et la comparaison n'aurait plus de sens.
 *
 * ⚠️ ELLE NE COUVRE QUE LES MODULES PRÉSENTS DANS LES LIGNES — c'était déjà la
 * limite de l'existant, qui sommait sur les lignes du fichier. Un module que
 * rien ne mentionne n'a pas de ligne, donc pas de masse comptée.
 */
export function massesGlobalesParGroupe(lignes = []) {
  const masses = new Map();

  for (const ligne of lignes) {
    const groupe = String(ligne.groupe ?? '').trim();
    const masse = Number(ligne.masseDrif ?? 0);
    if (groupe === '' || !(masse > 0)) continue;

    masses.set(groupe, (masses.get(groupe) ?? 0) + masse);
  }

  return Object.fromEntries(
    [...masses].map(([groupe, masse]) => [groupe, Math.round(masse * 100) / 100])
  );
}

/**
 * La référence à tracer pour l'axe demandé.
 *
 * ⚠️ UN SEUL POINT D'ENTRÉE, pour que l'écran n'ait pas à savoir laquelle des
 * deux s'applique où — c'est une règle métier, pas une décision d'affichage.
 *
 * @param {'formateur'|'groupe'|'module'} axe
 * @param {object} sources — `{ statutaires, lignes }`
 * @returns {{valeurs: object, libelle: string}|null}
 */
export function referenceDeLAxe(axe, { statutaires = {}, lignes = [] } = {}) {
  if (axe === 'formateur') {
    return Object.keys(statutaires).length === 0
      ? null
      : { valeurs: statutaires, libelle: 'Masse horaire statutaire' };
  }

  if (axe === 'groupe') {
    const valeurs = massesGlobalesParGroupe(lignes);
    return Object.keys(valeurs).length === 0
      ? null
      : { valeurs, libelle: 'Masse horaire globale' };
  }

  /*
   * ⚠️ RIEN SUR L'AXE MODULE : ni la masse statutaire d'une personne ni le
   * programme d'un groupe ne s'y rapportent. L'existant n'en traçait pas non
   * plus.
   */
  return null;
}
