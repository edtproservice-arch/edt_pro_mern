import { groupesSeCroisent } from './conflits.js';

/**
 * EFM régional : la planification d'un examen et de sa surveillance.
 * ← `api/profile/save_efm_regional.php` + `initEFMLogic()` de
 *   `public/assets/js/profile/profil-dialogues.js`
 *
 * ═══ CE QUE FAIT CET ÉCRAN ═══
 * Il ne DÉCLARE pas qu'un module est régional — `estRegional` vient de la base
 * e-note. Il PLANIFIE l'examen : un groupe, un module régional, une date, une
 * salle, des créneaux, et des SURVEILLANTS. Chaque surveillant reçoit alors une
 * séance sur ces créneaux.
 */

/**
 * Les modules régionaux d'un groupe, avec leur titulaire.
 *
 * ⚠️ SEULS LES RÉGIONAUX. C'est la règle de l'existant, et son bandeau le dit :
 * un EFM régional porte sur un module évalué au niveau de la région. Offrir les
 * autres laisserait planifier un examen qui n'existe pas.
 *
 * ⚠️ LE TITULAIRE EST L'IDENTIFIANT, PAS LE NOM. `save_efm_regional.php`
 * comparait des noms courts (`getShortName`) — le mécanisme même qui fabrique
 * les « formateurs qui disparaissent » (§4.2 du plan).
 */
export function modulesRegionaux(affectations = [], groupe) {
  const parModule = new Map();

  for (const affectation of affectations) {
    if (!affectation?.estRegional) continue;

    // ⚠️ `groupesSeCroisent`, pas une présence dans un ensemble : un EFM de
    // « GE101 (GE) » ne doit pas proposer les modules de « GE101 (GC) ».
    if (!groupesSeCroisent(affectation.groupe, groupe)) continue;

    const code = String(affectation.module ?? '').trim();
    if (!code) continue;

    /*
     * ⚠️ UN MODULE PEUT AVOIR DEUX TITULAIRES — l'un pour le présentiel,
     * l'autre pour le synchrone. On les garde TOUS : c'est la liste des
     * personnes qui ne peuvent pas surveiller leur propre examen.
     */
    if (!parModule.has(code)) parModule.set(code, { module: code, titulaires: new Set() });
    const matricule = String(affectation.formateur ?? '').trim();
    if (matricule) parModule.get(code).titulaires.add(matricule);
  }

  return [...parModule.values()]
    .map(({ module, titulaires }) => ({ module, titulaires: [...titulaires] }))
    .sort((a, b) => a.module.localeCompare(b.module, 'fr', { numeric: true }));
}

/** Les matricules qui ne peuvent pas surveiller ce module. */
export function titulairesDuModule(affectations, groupe, module) {
  const fiche = modulesRegionaux(affectations, groupe).find((m) => m.module === module);
  return fiche?.titulaires ?? [];
}

/**
 * L'état de chaque surveillant possible pour un examen donné.
 *
 * ═══ ⚠️ TROIS ÉTATS, ET LE TITULAIRE N'EST PAS « OCCUPÉ » ═══
 * Le formateur du module ne surveille pas son propre examen : ce n'est pas une
 * question de disponibilité mais de règle. L'existant le disait déjà — carte
 * grisée, mention « Titulaire du module » — et le distinguer d'un simple
 * « Occupé » évite de chercher quel cours l'empêcherait.
 *
 * @param {Array<{matricule, nom}>} formateurs
 * @param {object} examen  `{ titulaires: string[], creneaux: string[] }`
 * @param {Array} occupation  les séances de la JOURNÉE visée
 * @returns {Array<{matricule, nom, statut, motif}>}
 */
export function surveillantsPossibles(formateurs = [], examen = {}, occupation = []) {
  const titulaires = new Set((examen.titulaires ?? []).map((m) => String(m).trim()));
  const creneaux = new Set(examen.creneaux ?? []);

  /*
   * ⚠️ L'OCCUPATION SE LIT PAR CRÉNEAU, pas par journée. Un formateur a quatre
   * séances dans une journée : le déclarer occupé dès qu'il en a une le rendrait
   * indisponible pour tout examen, à toute heure.
   */
  const pris = new Map();
  for (const seance of occupation) {
    if (!creneaux.has(seance.seance)) continue;
    const matricule = String(seance.formateurMatricule ?? '').trim();
    if (!matricule || pris.has(matricule)) continue;
    pris.set(matricule, seance);
  }

  return formateurs.map((formateur) => {
    const matricule = String(formateur.matricule ?? '').trim();

    if (titulaires.has(matricule)) {
      return { ...formateur, statut: 'titulaire', motif: 'Titulaire du module' };
    }

    const seance = pris.get(matricule);
    if (seance) {
      return {
        ...formateur,
        statut: 'occupe',
        motif: `${seance.module} avec ${seance.groupe}`,
      };
    }

    return { ...formateur, statut: 'libre', motif: '' };
  });
}

/**
 * Les séances à écrire pour un examen : une par surveillant et par créneau.
 *
 * ⚠️ TOUTES PORTENT LE MÊME GROUPE, LE MÊME MODULE ET LA MÊME SALLE. C'est ce
 * que faisait l'existant, et c'est juste : les surveillants sont ensemble, dans
 * la même salle, sur le même examen. Seul le matricule change.
 *
 * ⚠️ ET TOUTES PORTENT `estEfm` : sans ce drapeau, une surveillance compterait
 * comme un cours donné — le module paraîtrait avancer pendant son examen.
 */
export function seancesDeLExamen({ groupe, module, salle, jour, creneaux = [], surveillants = [] }) {
  const seances = [];

  for (const matricule of surveillants) {
    for (const creneau of creneaux) {
      seances.push({
        formateurMatricule: String(matricule).trim(),
        groupe,
        module,
        salle,
        jour,
        seance: creneau,
        estEfm: true,
      });
    }
  }

  return seances;
}
