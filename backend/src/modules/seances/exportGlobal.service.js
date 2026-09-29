import {
  AXES_CONSULTATION,
  SEANCES_JOUR,
  SEANCE_SOIR,
  analyserSemaine,
  assemblerConsultation,
  filtrerGroupes,
  filtrerSujets,
  groupesDuSoir,
  horaireCreneau,
  libelleSemaine,
  sallesDeLaSemaine,
} from 'shared/domain';
import { PERIODES } from 'shared/constants';
import { Etablissement } from '../../models/Etablissement.js';
import { badRequest } from '../../lib/httpError.js';
import * as seancesService from './seances.service.js';
import * as horairesService from '../horaires/horaires.service.js';
import { construireDocxGlobal } from './exportGlobalDocx.js';
import { construireXlsxGlobal } from './exportGlobalXlsx.js';
import { construirePdfGlobal } from './exportGlobalPdf.js';

/**
 * Export Word / PDF / Excel de la « vue globale » de la page Édition.
 * ← demande du porteur : le canevas Word « EMPLOI GLOBAL FORMATEURS » d'un
 *   établissement, régénéré avec les données réelles plutôt que reproduit à la
 *   main, puis proposé aussi en PDF et en Excel.
 *
 * ═══ ⚠️ RIEN N'EST RECALCULÉ, TOUT EST RÉUTILISÉ ═══
 * `contexte()` et `semaine()` sont les MÊMES fonctions que la page Édition
 * appelle depuis le navigateur ; `assemblerConsultation`, `filtrerSujets`,
 * `filtrerGroupes` sont le MÊME domaine partagé qui construit ce qu'affiche
 * `GrilleConsultation`. Le fichier téléchargé montre donc exactement ce que
 * l'écran montrait au moment du clic — jamais un second calcul qui pourrait
 * diverger du premier.
 */
export async function construireExport(etablissementId, anneeScolaire, valeur, options) {
  const {
    format,
    axe = 'formateur',
    periode = PERIODES.JOUR,
    choisis = [],
    filtre = {},
    filtreGroupes: filtreGroupesOptions = {},
  } = options;

  const semaineInfo = analyserSemaine(valeur);
  if (!semaineInfo) throw badRequest(`Semaine « ${valeur} » illisible`, { code: 'SEMAINE_INVALIDE' });

  const [contexte, grille, etablissement, horaires] = await Promise.all([
    seancesService.contexte(etablissementId, anneeScolaire),
    seancesService.semaine(etablissementId, anneeScolaire, valeur),
    Etablissement.findById(etablissementId).select('nom nomAbrege complexe').lean(),
    horairesService.obtenir(),
  ]);

  const seances = grille.seances;
  const nomsFormateurs = new Map(contexte.formateurs.map((f) => [f.matricule, f.nom]));

  /* ⚠️ LA MÊME RÈGLE QUE `PageEdition` : les sujets dépendent de l'axe et de la
     période — voir son commentaire pour le « pourquoi » de chaque cas. */
  let sujets;
  if (axe === 'salle') sujets = sallesDeLaSemaine(contexte.salles ?? [], seances);
  else if (axe === 'groupe') {
    sujets = periode === PERIODES.SOIR ? groupesDuSoir(contexte.groupes ?? []) : (contexte.groupes ?? []);
  } else {
    sujets = contexte.formateurs.map((f) => f.matricule);
  }

  const parIdentite =
    axe === 'groupe'
      ? filtrerGroupes(sujets, contexte.groupesIdentites ?? {}, filtreGroupesOptions)
      : sujets;
  const designes = choisis.length > 0 ? parIdentite.filter((s) => choisis.includes(s)) : parIdentite;
  const affiches = filtrerSujets(designes, seances, axe, filtre);

  if (affiches.length === 0) {
    throw badRequest('Rien à exporter pour ce filtre', { code: 'EXPORT_VIDE' });
  }

  const creneaux = periode === PERIODES.SOIR ? [SEANCE_SOIR] : SEANCES_JOUR;

  /*
   * ⚠️ LE CANEVAS WORD A 4 CRÉNEAUX PAR JOUR, GRAVÉS DANS SA GRILLE — celui de
   * la vue du SOIR n'a qu'une seule colonne par jour, une forme que le
   * canevas ne porte pas. Le PDF en dérive (voir `exportGlobalPdf.js`) : la
   * même limite s'applique. L'Excel, lui, construit sa propre grille et n'a
   * pas cette contrainte.
   */
  if ((format === 'docx' || format === 'pdf') && creneaux.length !== SEANCES_JOUR.length) {
    throw badRequest(
      'Le Word et le PDF suivent le canevas de la vue du jour ; utilisez l’Excel pour la vue du soir.',
      { code: 'EXPORT_SOIR_NON_SUPPORTE' }
    );
  }

  const assemblees = assemblerConsultation({ sujets: affiches, seances, axe, periode });

  const libelleDuSujet = (sujet) => (axe === 'formateur' ? (nomsFormateurs.get(sujet) ?? sujet) : sujet);

  const horaireDuCreneau = (jour, creneau) => horaireCreneau(jour, creneau, horaires.courant);

  const donnees = {
    etablissement: etablissement ?? {},
    anneeScolaire,
    semaineLabel: libelleSemaine(valeur, { court: true }),
    semaineDebut: semaineInfo.debut,
    periode,
    axe,
    entete: AXES_CONSULTATION[axe].libelle,
    lignes: AXES_CONSULTATION[axe].lignes,
    creneaux,
    jours: grille.jours,
    assemblees,
    libelleDuSujet,
    /*
     * ⚠️ TOUJOURS FOURNIE, PAS SEULEMENT SUR L'AXE FORMATEUR (2026-09-23,
     * signalé par le porteur : « il affiche le matricule au lieu du nom »).
     * Sur l'axe GROUPE comme sur l'axe SALLE, la ligne « Formateur » de
     * chaque case en a besoin pour traduire le matricule que porte la séance
     * — `contenuLigne()` (shared/domain) le fait déjà pour toute case dont la
     * ligne s'appelle « Formateur », quel que soit l'axe affiché.
     */
    nomsFormateurs,
    horaireDuCreneau,
  };

  if (format === 'docx') return construireDocxGlobal(donnees);
  if (format === 'xlsx') return construireXlsxGlobal(donnees);
  return construirePdfGlobal(donnees);
}
