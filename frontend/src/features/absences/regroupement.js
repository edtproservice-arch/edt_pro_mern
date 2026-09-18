/**
 * Les absences d'une même personne, un même jour, réunies en une seule carte.
 * (2026-08-26, demande du porteur : « en vue carte, essaie de grouper ».)
 *
 * ═══ ⚠️ POURQUOI GROUPER, ET SUR QUOI ═══
 * Une personne absente trois créneaux d'affilée produisait trois cartes
 * identiques à un « S3 / S4 / S5 » près : on relisait trois fois le même nom, la
 * même date, le même groupe. Or c'est UN fait — quelqu'un n'était pas là ce
 * jour-là — et c'est ainsi qu'on en parle.
 *
 * La clé est donc `formateur + date`. Pas le module : la même personne peut
 * manquer deux cours différents le même jour, et ce reste une seule absence à
 * traiter.
 *
 * ═══ ⚠️ CHAQUE CRÉNEAU GARDE SA PROPRE SAISIE ═══
 * Le regroupement est un AFFICHAGE, jamais une fusion de données : chaque
 * créneau porte son observation et sa date de rattrapage, parce que chacun vaut
 * 2,5 h à reprendre et peut être rattrapé un jour différent. Les écritures
 * restent indépendantes, une par absence.
 */

/**
 * @param {Array} absences — telles que le serveur les rend, déjà triées.
 * @returns {Array<{cle, formateurNom, dateAbsence, semaine, entrees, sansRattrapage}>}
 */
export function grouperAbsences(absences = []) {
  const groupes = new Map();

  for (const absence of absences) {
    const cle = `${absence.formateurNom ?? ''}||${absence.dateAbsence ?? ''}`;

    if (!groupes.has(cle)) {
      groupes.set(cle, {
        cle,
        formateurNom: absence.formateurNom,
        dateAbsence: absence.dateAbsence,
        semaine: absence.semaine,
        entrees: [],
      });
    }
    groupes.get(cle).entrees.push(absence);
  }

  return [...groupes.values()].map((groupe) => ({
    ...groupe,
    /*
     * ⚠️ LA CARTE EST MARQUÉE DÈS QU'UN SEUL CRÉNEAU RESTE À RATTRAPER. C'est
     * le repère de ce qu'il reste à traiter : l'éteindre parce que les autres
     * sont réglés ferait disparaître le travail restant de la vue d'ensemble.
     */
    sansRattrapage: groupe.entrees.some((entree) => !entree.dateRattrapage),
    /*
     * Le groupe et le module ne sont remontés en tête QUE s'ils sont les mêmes
     * partout : sinon la carte annoncerait un cours pour un créneau qui en
     * porte un autre.
     */
    sujetCommun: commun(groupe.entrees),
  }));
}

/** `{groupe, module}` si toutes les entrées les partagent, sinon `null`. */
function commun(entrees) {
  const premier = entrees[0];
  const identiques = entrees.every(
    (entree) => entree.groupe === premier.groupe && entree.module === premier.module
  );

  return identiques ? { groupe: premier.groupe, module: premier.module } : null;
}

/**
 * Les groupes-jour d'une même personne, réunis en UNE fiche par formateur.
 * ← demande du porteur, 2026-09-03 : « en carte affiche seulement le nom du
 * formateur, combien d'absence…, et si je clique s'affiche un modal qui
 * contient le détail ».
 *
 * ═══ ⚠️ ELLE REPART DE `grouperAbsences`, NE REDÉFINIT PAS LE JOUR ═══
 * C'est lui qui sait fusionner les créneaux d'un même jour (et calculer
 * `sujetCommun`) ; une seconde lecture ici aurait fini par diverger du premier
 * ajustement — la cause n°1 d'instabilité que ce projet répète depuis la
 * Phase 2. Cette fonction ne fait qu'EMPILER ses résultats par personne.
 *
 * @param {Array} absences — telles que le serveur les rend.
 * @returns {Array<{cle, formateurNom, jours, total, sansRattrapage}>}
 *   `jours` porte les groupes-jour de `grouperAbsences`, dans l'ordre
 *   d'arrivée ; `total` et `sansRattrapage` comptent des CRÉNEAUX, pas des
 *   jours — une personne absente deux créneaux le même jour, c'est 2 absences.
 */
export function grouperParFormateur(absences = []) {
  const parFormateur = new Map();

  for (const jour of grouperAbsences(absences)) {
    const cle = jour.formateurNom ?? '';

    if (!parFormateur.has(cle)) {
      parFormateur.set(cle, {
        cle,
        formateurNom: jour.formateurNom,
        // ⚠️ POUR LE RATTRAPAGE EN CHRONOGRAMME/EMPLOI (2026-09-03) : ces deux
        // grilles s'interrogent par MATRICULE, jamais par nom — c'est la clé
        // stable, le nom n'étant qu'un affichage. Lu sur la première entrée du
        // premier jour : il ne varie pas au sein d'une même fiche.
        formateurMatricule: jour.entrees[0]?.formateurMatricule ?? null,
        jours: [],
        total: 0,
        sansRattrapage: 0,
      });
    }

    const fiche = parFormateur.get(cle);
    fiche.jours.push(jour);
    fiche.total += jour.entrees.length;
    fiche.sansRattrapage += jour.entrees.filter((entree) => !entree.dateRattrapage).length;
  }

  return [...parFormateur.values()];
}
