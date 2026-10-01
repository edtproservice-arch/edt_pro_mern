import { AbsenceStagiaire } from '../../models/AbsenceStagiaire.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { badRequest, notFound } from '../../lib/httpError.js';
import { BILLETS_VIERGES_PAR_PAGE, construireDocxBilletsAbsence } from './exportBilletAbsenceDocx.js';
import { construireXlsxBilletsAbsence } from './exportBilletAbsenceXlsx.js';
import { construirePdfBilletsAbsence } from './exportBilletAbsencePdf.js';

/**
 * Le(s) billet(s) d'excuse (Word, PDF ou Excel) d'une ou plusieurs absences
 * ou retards STAGIAIRES justifiés — 2026-09-29, demande du porteur : « si une
 * absence ou retard est justifié afficher un billet d'absence », précisé
 * ensuite : « si un seul stagiaire justifié il s'affiche une seule billet…
 * si deux stagiaires justifient en même temps il s'affiche deux billets… et
 * je veux avec trois word, pdf, excel ». Canevas transmis.
 *
 * ⚠️ AUTANT DE BILLETS QUE D'IDENTIFIANTS DEMANDÉS, DANS LEUR ORDRE — voir
 * `exportBilletAbsenceDocx.js` pour la mise en page (quatre par page, comme
 * le canevas).
 *
 * ⚠️ SEULEMENT SI TOUTES SONT JUSTIFIÉES : le billet atteste qu'un
 * justificatif a été examiné et accepté — en délivrer un pour une absence
 * encore en attente ferait croire à une excuse qui n'a pas eu lieu.
 *
 * ⚠️ NOM ET PRÉNOM SÉPARÉS VIENNENT DU STAGIAIRE, PAS DE `AbsenceStagiaire` :
 * celle-ci ne dénormalise que `nomComplet` (un seul champ, pour le registre),
 * quand le billet a besoin des deux séparément, comme le canevas les affiche.
 */
export async function construireBilletsAbsence(etablissementId, anneeScolaire, absenceIds, format) {
  const absences = await AbsenceStagiaire.find({
    _id: { $in: absenceIds },
    etablissementId,
    anneeScolaire,
  }).lean();

  const parId = new Map(absences.map((a) => [String(a._id), a]));
  const absencesOrdonnees = absenceIds.map((id) => parId.get(id)).filter(Boolean);
  if (absencesOrdonnees.length === 0) {
    throw notFound('Absence introuvable', { code: 'ABSENCE_INTROUVABLE' });
  }

  const nonJustifiees = absencesOrdonnees.filter((a) => !a.justifiee);
  if (nonJustifiees.length > 0) {
    throw badRequest('Une absence non justifiée ne peut pas recevoir de billet', {
      code: 'ABSENCE_NON_JUSTIFIEE',
    });
  }

  const matricules = [...new Set(absencesOrdonnees.map((a) => a.matricule))];
  const stagiaires = await Stagiaire.find({ etablissementId, anneeScolaire, matricule: { $in: matricules } })
    .select('matricule nom prenom')
    .lean();
  const stagiaireParMatricule = new Map(stagiaires.map((s) => [s.matricule, s]));

  const billets = absencesOrdonnees.map((absence) => {
    const stagiaire = stagiaireParMatricule.get(absence.matricule);
    return {
      nom: stagiaire?.nom ?? '',
      prenom: stagiaire?.prenom ?? '',
      filiere: absence.filiere ?? '',
      groupe: absence.groupe ?? '',
      type: absence.typeAbsence,
      date: absence.date,
    };
  });

  const donnees = { anneeScolaire, billets };

  if (format === 'docx') return construireDocxBilletsAbsence(donnees);
  if (format === 'xlsx') return construireXlsxBilletsAbsence(donnees);
  return construirePdfBilletsAbsence(donnees);
}

/**
 * Une page de billets VIERGES, à remplir à la main (2026-10-01, demande du
 * porteur : depuis la page Documents, « il télécharge le maximum des billets
 * dans une page vide »). Le billet du canevas, champs en pointillés, répété
 * sur toute la page (quinze) ; seule l’année est celle de l’établissement.
 *
 * ⚠️ WORD OU PDF SEULEMENT : l'Excel des billets est un TABLEAU de stagiaires,
 * qui vide ne dirait rien.
 */
export async function construireBilletsVierges(anneeScolaire, format) {
  const donnees = {
    anneeScolaire,
    billets: Array.from({ length: BILLETS_VIERGES_PAR_PAGE }, () => ({ vierge: true })),
  };
  if (format === 'docx') return construireDocxBilletsAbsence(donnees);
  return construirePdfBilletsAbsence(donnees);
}
