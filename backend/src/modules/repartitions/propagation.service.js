import { TYPES_COURS } from 'shared/constants';
import { anneeDuNomGroupe, anneeScolaireCourante, filieresParGroupe, separerFusion } from 'shared/domain';
import { Base } from '../../models/Base.js';
import { bus, EVENEMENTS } from '../../lib/bus.js';
import { logger } from '../../lib/logger.js';

/**
 * ═══ UNE MASSE CHANGÉE DANS LA RÉPARTITION GAGNE TOUS LES ÉTABLISSEMENTS
 * (2026-10-10, demande du porteur : « si je change les masses horaires d'un
 * module en répartition horaire, change-les instantanément chez toutes les
 * sessions — affectations, chronogramme… ») ═══
 *
 * La répartition DRIF est un référentiel NATIONAL ; mais la masse AFFECTÉE à un
 * groupe est COPIÉE dans la base de l'établissement (`affectations[].s1Heures`,
 * `s2Heures`) au moment où le groupe reçoit son formateur — et c'est cette copie
 * que lisent le chronogramme, les quotas de l'emploi du temps, l'avancement.
 * Changer la répartition ne changeait donc rien pour un groupe déjà affecté.
 *
 * ⚠️ UNE MASSE AJUSTÉE PAR L'ÉTABLISSEMENT N'EST PAS TOUCHÉE. Un groupe alterné
 * reçoit souvent moins que le DRIF (20 h au lieu de 40 h) : c'est une décision
 * locale, que le référentiel ne doit pas effacer. Seule une affectation qui
 * portait EXACTEMENT l'ancienne masse — donc qui la suivait — reçoit la nouvelle.
 *
 * ⚠️ L'ANNÉE EN COURS ET LES SUIVANTES : une année close a ses séances faites et
 * son avancement arrêté ; lui changer ses masses réécrirait son histoire.
 *
 * ⚠️ LA VERSION DE LA BASE AUGMENTE : un directeur en pleine saisie de sa carte
 * enregistrera sur l'ancienne version, se fera refuser (409) et reprendra la
 * nouvelle — au lieu d'écraser en silence la masse qu'on vient de lui poser.
 */
const CHAMPS = {
  [TYPES_COURS.PRESENTIEL]: ['mhpS1', 'mhpS2'],
  [TYPES_COURS.SYNCHRONE]: ['mhsynS1', 'mhsynS2'],
};

const nombre = (valeur) => Math.round(Number(valeur ?? 0) * 100);
const egal = (a, b) => nombre(a) === nombre(b);

/** Les masses ont-elles changé entre deux états d'une ligne de répartition ? */
export const massesChangees = (avant, apres) =>
  Object.values(CHAMPS)
    .flat()
    .some((champ) => !egal(avant?.[champ], apres?.[champ]));

/**
 * Reporte, dans les bases concernées, le changement de masses d'UNE ligne de
 * répartition. `avant` et `apres` sont deux états de la même ligne.
 *
 * @returns {Promise<{ bases: number, affectations: number }>}
 */
export async function propagerMasses(avant, apres, { maintenant = new Date(), annoncer = true } = {}) {
  if (!avant || !apres || !massesChangees(avant, apres)) return { bases: 0, affectations: 0 };

  // L'identité de la ligne AVANT : c'est sous elle que les bases connaissent le module.
  const code = String(avant.codeModule ?? '').trim();
  const filiere = String(avant.codeFiliereCarte ?? '').trim();
  const anneeFormation = Number(avant.anneeFormation);
  if (code === '' || filiere === '') return { bases: 0, affectations: 0 };

  const bases = await Base.find({
    anneeScolaire: { $gte: anneeScolaireCourante(maintenant) },
    'affectations.module': code,
  });

  let total = 0;
  let touchees = 0;

  for (const base of bases) {
    const filieres = filieresParGroupe(base);
    let modifiees = 0;

    for (const affectation of base.affectations) {
      if (String(affectation.module ?? '').trim() !== code) continue;
      const champs = CHAMPS[affectation.type];
      if (!champs) continue;

      // Un libellé fusionné (« GM101 GM102 ») : il suffit qu'un de ses groupes soit de la filière.
      const concerne = separerFusion(affectation.groupe).some(
        (groupe) => filieres.get(groupe) === filiere && anneeDuNomGroupe(groupe) === anneeFormation
      );
      if (!concerne) continue;

      const [champS1, champS2] = champs;
      // Ajustée par l'établissement : on n'y touche pas.
      if (!egal(affectation.s1Heures, avant[champS1]) || !egal(affectation.s2Heures, avant[champS2])) continue;

      affectation.s1Heures = Number(apres[champS1] ?? 0);
      affectation.s2Heures = Number(apres[champS2] ?? 0);
      modifiees += 1;
    }

    if (modifiees === 0) continue;

    base.version = Number(base.version ?? 0) + 1;
    await base.save();
    total += modifiees;
    touchees += 1;

    /*
     * Les pages ouvertes sur cet établissement relisent leur base : la carte des
     * Affectations, le chronogramme, l'emploi du temps (ses quotas), l'avancement.
     * ⚠️ `origine: null` — aucun onglet n'est à écarter, l'écriture vient d'ailleurs.
     */
    for (const page of ['affectations', 'chronogramme', 'emploi']) {
      bus.emit(EVENEMENTS.MODIFICATION, {
        etablissementId: String(base.etablissementId),
        anneeScolaire: base.anneeScolaire,
        page,
        action: 'referentiel',
        semaine: null,
        auteur: { id: null, nom: 'Administration' },
        origine: null,
      });
    }
  }

  /*
   * ⚠️ ET TOUT LE MONDE, MÊME SANS AFFECTATION CONCERNÉE : un module encore sans
   * formateur n'a pas de copie en base — l'écran lit directement la répartition,
   * qu'il garde en cache. Le signal fait relire ce cache à toute session ouverte.
   */
  if (annoncer) bus.emit(EVENEMENTS.REFERENTIEL_MODIFIE, { codeModule: code });

  logger.info({ codeModule: code, filiere, anneeFormation, bases: touchees, affectations: total }, 'Masses de la répartition propagées');
  return { bases: touchees, affectations: total };
}

/**
 * Plusieurs lignes à la fois — un import du classeur DRIF. Une seule annonce à la
 * fin : des milliers de lignes ne doivent pas faire relire mille fois chaque écran.
 *
 * @param {{ avant, apres }[]} paires
 */
export async function propagerPlusieurs(paires, options = {}) {
  let bases = 0;
  let affectations = 0;
  let changees = 0;
  for (const { avant, apres } of paires) {
    if (!massesChangees(avant, apres)) continue;
    changees += 1;
    const bilan = await propagerMasses(avant, apres, { ...options, annoncer: false });
    bases += bilan.bases;
    affectations += bilan.affectations;
  }
  if (changees > 0) bus.emit(EVENEMENTS.REFERENTIEL_MODIFIE, { codeModule: null });
  return { lignes: changees, bases, affectations };
}
