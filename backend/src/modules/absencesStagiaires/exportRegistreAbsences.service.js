import { bornesAnneeScolaire, dureeSeance, fusionnerVacances, sanctionComportement } from 'shared/domain';
import { AbsenceStagiaire } from '../../models/AbsenceStagiaire.js';
import { Etablissement } from '../../models/Etablissement.js';
import { IndisciplineStagiaire } from '../../models/IndisciplineStagiaire.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { badRequest } from '../../lib/httpError.js';
import { joursFeries } from '../calendrier/calendrier.service.js';
import { obtenir as calendrierNational } from '../calendrierNational/calendrierNational.service.js';
import { construireXlsxRegistreAbsences } from './exportRegistreAbsencesXlsx.js';

/**
 * Le REGISTRE des absences de l'année en un tableau Excel (2026-10-10, demande
 * du porteur) : une ligne par stagiaire — groupe, stagiaire —, une colonne par
 * jour de l'année de formation, puis le total des heures NON justifiées et
 * celui des heures justifiées.
 *
 * ═══ CE QUE PORTE UNE CASE ═══
 * Le nombre d'HEURES d'absence du jour — la durée de chaque séance manquée
 * (`dureeSeance`, 2,5 h le jour), additionnées. Une absence justifiée porte en
 * commentaire son motif, séance par séance.
 *
 * ⚠️ LES RETARDS N'Y SONT PAS : comme « T. A » de la feuille hebdomadaire, ce
 * registre compte des ABSENCES — un retard n'est pas une heure manquée.
 *
 * ⚠️ LES DIMANCHES NE SONT PAS DES COLONNES : la grille porte six jours, un
 * dimanche serait une colonne toujours vide sur 52 semaines. Les vacances et
 * les fériés, eux, restent — grisés et nommés : c'est ce qui explique un trou
 * de deux semaines dans les absences.
 *
 * ═══ LE COMPORTEMENT, UNE COLONNE PAR SANCTION (2026-10-10, demande du
 * porteur) ═══ Après les heures : mise en garde, avertissement, blâme,
 * exclusion de 2 jours, exclusion définitive — la grille de comportement, dans
 * l'ordre. La n-ième indiscipline du stagiaire remplit la n-ième colonne : sa
 * date, et son motif en commentaire.
 *
 * ⚠️ LE RANG EST CELUI DU STAGIAIRE, PAS DU GROUPE : comme sur sa fiche, ses
 * indisciplines de l'année se comptent toutes, dans l'ordre chronologique — un
 * stagiaire inscrit aussi en formation qualifiante porte les mêmes sanctions sur
 * ses deux lignes. Au-delà de la 5ᵉ, l'exclusion définitive est déjà prononcée :
 * les suivantes s'ajoutent à son commentaire.
 *
 * @param {string[]} [groupes] — sans liste, tous les groupes de la base Konosys
 */
export async function construireExportRegistreAbsences(etablissementId, anneeScolaire, { groupes } = {}) {
  const filtreGroupes = groupes?.length ? { $in: groupes } : { $exists: true };

  const [stagiaires, marquages, indisciplines, etablissement, national, feries] = await Promise.all([
    Stagiaire.find({ etablissementId, anneeScolaire, groupes: filtreGroupes })
      .select('matricule nom prenom groupes')
      .sort({ nom: 1, prenom: 1 })
      .lean(),
    AbsenceStagiaire.find({ etablissementId, anneeScolaire, groupe: filtreGroupes, typeAbsence: 'absence' })
      .select('matricule nomComplet groupe date seance justifiee motif')
      .lean(),
    // Toute l'année du stagiaire, quel que soit le groupe : le rang de la sanction en dépend.
    IndisciplineStagiaire.find({ etablissementId, anneeScolaire })
      .select('matricule nomComplet groupe date motif observation')
      .sort({ date: 1, createdAt: 1 })
      .lean(),
    Etablissement.findById(etablissementId).select('nom nomAbrege calendrier').lean(),
    calendrierNational(anneeScolaire),
    joursFeries(etablissementId, anneeScolaire).catch(() => ({ joursFeries: [] })),
  ]);

  const { debut, fin } = bornesAnneeScolaire(anneeScolaire, national?.rentrees ?? []);

  // Ce qui ferme chaque jour : un férié l'emporte sur les vacances qui l'entourent.
  const fermetures = new Map();
  const vacances = fusionnerVacances(
    national?.vacances ?? [],
    etablissement?.calendrier?.vacances ?? [],
    etablissement?.calendrier?.vacancesEcartees ?? []
  );
  for (const periode of vacances) {
    for (const jour of joursEntre(periode.debut, periode.fin)) {
      fermetures.set(jour, { type: 'vacances', libelle: periode.nom || 'Vacances' });
    }
  }
  for (const ferie of feries.joursFeries ?? []) {
    fermetures.set(String(ferie.date).slice(0, 10), { type: 'ferie', libelle: ferie.intitule || 'Jour férié' });
  }

  const jours = joursEntre(debut, fin)
    .filter((jour) => new Date(`${jour}T12:00:00`).getDay() !== 0)
    .map((date) => ({ date, fermeture: fermetures.get(date) ?? null }));

  /* Les marquages, par (groupe, matricule) puis par jour. */
  const parStagiaire = new Map();
  for (const marquage of marquages) {
    if (marquage.date < debut || marquage.date > fin) continue;
    const cle = `${marquage.groupe}||${marquage.matricule}`;
    if (!parStagiaire.has(cle)) parStagiaire.set(cle, { nomComplet: marquage.nomComplet, parJour: new Map() });
    const { parJour } = parStagiaire.get(cle);
    if (!parJour.has(marquage.date)) parJour.set(marquage.date, []);
    parJour.get(marquage.date).push(marquage);
  }

  /*
   * ⚠️ LA LISTE KONOSYS, PUIS LES ABSENTS QUI N'Y SONT PLUS : un stagiaire
   * retiré de la base depuis garde ses absences au registre — les taire ferait
   * mentir le total du groupe.
   */
  const lignesParGroupe = new Map();
  const ajouter = (groupe, matricule, nom) => {
    if (!lignesParGroupe.has(groupe)) lignesParGroupe.set(groupe, new Map());
    const lignes = lignesParGroupe.get(groupe);
    if (!lignes.has(matricule)) lignes.set(matricule, { groupe, matricule, nom });
  };
  const retenus = groupes?.length ? new Set(groupes) : null;
  for (const stagiaire of stagiaires) {
    const nom = [stagiaire.nom, stagiaire.prenom].filter(Boolean).join(' ').trim() || stagiaire.matricule;
    for (const groupe of stagiaire.groupes ?? []) {
      if (!retenus || retenus.has(groupe)) ajouter(groupe, stagiaire.matricule, nom);
    }
  }
  for (const [cle, { nomComplet }] of parStagiaire) {
    const [groupe, matricule] = cle.split('||');
    ajouter(groupe, matricule, nomComplet || matricule);
  }

  /* Les indisciplines, par stagiaire, dans l'ordre où elles ont été commises. */
  const indisciplinesParMatricule = new Map();
  for (const indiscipline of indisciplines) {
    if (!indisciplinesParMatricule.has(indiscipline.matricule)) indisciplinesParMatricule.set(indiscipline.matricule, []);
    indisciplinesParMatricule.get(indiscipline.matricule).push(indiscipline);
    if (indiscipline.groupe && (!retenus || retenus.has(indiscipline.groupe))) {
      ajouter(indiscipline.groupe, indiscipline.matricule, indiscipline.nomComplet || indiscipline.matricule);
    }
  }

  const lignes = [...lignesParGroupe.keys()]
    .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
    .flatMap((groupe) =>
      [...lignesParGroupe.get(groupe).values()].map((ligne) => {
        const parJour = parStagiaire.get(`${groupe}||${ligne.matricule}`)?.parJour ?? new Map();
        let nonJustifiees = 0;
        let justifiees = 0;
        const cases = jours.map(({ date }) => {
          const seances = (parJour.get(date) ?? []).sort((a, b) => a.seance.localeCompare(b.seance));
          if (seances.length === 0) return null;
          const heuresNj = somme(seances.filter((s) => !s.justifiee));
          const heuresJ = somme(seances.filter((s) => s.justifiee));
          nonJustifiees += heuresNj;
          justifiees += heuresJ;
          return {
            heures: heuresNj + heuresJ,
            justifiee: heuresNj === 0,
            // Le motif, séance par séance — seulement s'il y a une justification à dire.
            commentaire: heuresJ > 0
              ? seances
                  .map((s) =>
                    s.justifiee
                      ? `${s.seance} (${heures(dureeSeance(s.seance))}) : justifiée${s.motif ? ` — ${s.motif}` : ''}`
                      : `${s.seance} (${heures(dureeSeance(s.seance))}) : non justifiée`
                  )
                  .join('\n')
              : null,
          };
        });
        return {
          ...ligne,
          cases,
          nonJustifiees,
          justifiees,
          comportement: comportementDe(indisciplinesParMatricule.get(ligne.matricule) ?? []),
        };
      })
    );

  if (lignes.length === 0) {
    throw badRequest('Aucun stagiaire dans la base de l’année', { code: 'GROUPE_VIDE' });
  }

  return construireXlsxRegistreAbsences({
    etablissement: etablissement?.nom ?? '',
    anneeScolaire,
    jours,
    lignes,
    sanctions: SANCTIONS_COMPORTEMENT,
  });
}

/** Les sanctions de la grille de comportement, une par colonne — de la 1ʳᵉ indiscipline à la 5ᵉ. */
const SANCTIONS_COMPORTEMENT = [1, 2, 3, 4, 5].map((rang) => sanctionComportement(rang));

/**
 * Une case par sanction : la date de l'indiscipline qui l'a entraînée et son
 * motif — `null` tant que le stagiaire n'en est pas là.
 */
function comportementDe(liste) {
  const cases = SANCTIONS_COMPORTEMENT.map((_, rang) => {
    const indiscipline = liste[rang];
    if (!indiscipline) return null;
    return { date: enFrancais(indiscipline.date), commentaire: decrire(indiscipline) };
  });
  // Au-delà de la 5ᵉ : sur la dernière colonne, en commentaire.
  const suivantes = liste.slice(SANCTIONS_COMPORTEMENT.length);
  if (suivantes.length > 0) {
    const derniere = cases.at(-1);
    derniere.commentaire = [
      derniere.commentaire,
      ...suivantes.map((i) => `Puis le ${enFrancais(i.date)} : ${decrire(i)}`),
    ].join('\n');
  }
  return cases;
}

const decrire = (indiscipline) =>
  [`Motif : ${indiscipline.motif}`, indiscipline.observation && `Observation : ${indiscipline.observation}`]
    .filter(Boolean)
    .join('\n');

/** « 2026-09-14 » → « 14/09/2026 ». */
const enFrancais = (iso) => String(iso ?? '').slice(0, 10).split('-').reverse().join('/');

const somme = (seances) => seances.reduce((total, s) => total + dureeSeance(s.seance), 0);

/** « 2,5 h » */
const heures = (valeur) => `${String(valeur).replace('.', ',')} h`;

/** Les jours « AAAA-MM-JJ » de `debut` à `fin` inclus. */
function joursEntre(debut, fin) {
  const jours = [];
  if (!debut || !fin) return jours;
  const date = new Date(`${String(debut).slice(0, 10)}T12:00:00`);
  const borne = String(fin).slice(0, 10);
  for (;;) {
    const jour = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (jour > borne) return jours;
    jours.push(jour);
    date.setDate(date.getDate() + 1);
  }
}
