import { pageAnnuelle } from 'shared/domain';
import { ModificationPage } from '../../models/ModificationPage.js';
import { Seance } from '../../models/Seance.js';
import { AbsenceFormateur } from '../../models/AbsenceFormateur.js';
import { Chronogramme } from '../../models/Chronogramme.js';
import { Base } from '../../models/Base.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { EnoteImport } from '../../models/EnoteImport.js';

/** La clé d'une page : son année seulement si ses données sont rangées par année. */
const cle = (etablissementId, anneeScolaire, page) => ({
  etablissementId,
  anneeScolaire: pageAnnuelle(page) ? anneeScolaire : null,
  page,
});

/**
 * Note qu'une page vient d'être modifiée.
 *
 * ⚠️ UN `upsert` ET NON UN `create` : une seule ligne par page, réécrite à
 * chaque écriture — c'est la DERNIÈRE modification qu'on affiche, pas un journal.
 */
export async function noter({ etablissementId, anneeScolaire, page, auteur, le = new Date() }) {
  await ModificationPage.updateOne(
    cle(etablissementId, anneeScolaire, page),
    { $set: { modifieLe: le, auteurId: auteur?.id ?? null, auteurNom: auteur?.nom ?? '' } },
    { upsert: true }
  );
}

/**
 * La dernière modification d'une page, ou `null` si on ne sait pas la dater.
 *
 * ═══ REPLI SUR LES DONNÉES ELLES-MÊMES ═══ Le suivi ne date que les écritures
 * faites depuis sa mise en place : une page qu'on n'a pas retouchée depuis
 * restait sans date. Quand ses données portent un horodatage FIABLE et qui ne
 * désigne qu'elles, on le lit (sans auteur — on ne le connaît pas).
 *
 * ⚠️ PAS DE REPLI POUR LES LISTES DE L'ÉTABLISSEMENT (salles, stages,
 * calendrier…) : elles vivent dans UN document dont `updatedAt` change avec
 * n'importe laquelle — la date d'une autre liste se serait affichée ici. Ni pour
 * les comptes : le battement de cœur réécrit `updatedAt` toutes les 30 s.
 */
export async function derniere(etablissementId, anneeScolaire, page) {
  const ligne = await ModificationPage.findOne(cle(etablissementId, anneeScolaire, page)).lean();
  if (ligne) {
    return {
      page,
      modifieLe: ligne.modifieLe,
      auteur: ligne.auteurId ? { id: String(ligne.auteurId), nom: ligne.auteurNom } : null,
    };
  }

  const modifieLe = await repli(etablissementId, anneeScolaire, page);
  return modifieLe ? { page, modifieLe, auteur: null } : null;
}

/** Le plus récent `updatedAt` d'une collection, pour un filtre. */
async function plusRecent(Modele, filtre, champ = 'updatedAt') {
  const document = await Modele.findOne(filtre).sort({ [champ]: -1 }).select(champ).lean();
  return document?.[champ] ?? null;
}

async function repli(etablissementId, anneeScolaire, page) {
  const annee = { etablissementId, anneeScolaire };
  switch (page) {
    case 'emploi':
    case 'efm':
      return plusRecent(Seance, annee);
    case 'absences':
      return plusRecent(AbsenceFormateur, annee);
    case 'chronogramme':
      return plusRecent(Chronogramme, annee);
    case 'affectations':
    case 'formateurs':
      return plusRecent(Base, annee);
    case 'documents':
      // Une base Konosys par année (2026-09-14) : sa date suit l'année affichée.
      return plusRecent(Stagiaire, annee);
    case 'avancement': {
      // Ce que l'avancement affiche change avec les séances, les chronogrammes et les imports.
      const dates = await Promise.all([
        plusRecent(Seance, annee),
        plusRecent(Chronogramme, annee),
        plusRecent(EnoteImport, annee, 'createdAt'),
      ]);
      const connues = dates.filter(Boolean).map((date) => new Date(date).getTime());
      return connues.length ? new Date(Math.max(...connues)) : null;
    }
    default:
      return null;
  }
}
