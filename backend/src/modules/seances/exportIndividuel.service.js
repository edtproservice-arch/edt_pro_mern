import {
  AXES_CONSULTATION,
  SEANCES_JOUR,
  analyserSemaine,
  assemblerConsultation,
  filtrerGroupes,
  filtrerSujets,
  horaireCreneau,
  libelleSemaine,
  sallesDeLaSemaine,
} from 'shared/domain';
import { PERIODES } from 'shared/constants';
import { Etablissement } from '../../models/Etablissement.js';
import { badRequest } from '../../lib/httpError.js';
import * as seancesService from './seances.service.js';
import * as horairesService from '../horaires/horaires.service.js';
import { construireDocxIndividuel } from './exportIndividuelDocx.js';
import { construireXlsxIndividuel } from './exportIndividuelXlsx.js';
import { construirePdfIndividuel } from './exportIndividuelPdf.js';

/**
 * Export Word / PDF / Excel de la vue DÉTAILLÉE — UNE PAGE PAR SUJET
 * actuellement affiché à l'écran. ← demande du porteur (2026-09-24) : « le
 * même bouton Imprimer — en vue globale télécharge la globale, en vue
 * détaillée télécharge la détaillée, selon le filtre ». Pas de second bouton :
 * ce service partage exactement les mêmes filtres (`axe`, `choisis`, `filtre`,
 * `filtreGroupes`) que `exportGlobal.service.js`, appelé à la place de celui-ci
 * quand la page est en vue détaillée.
 *
 * ═══ ⚠️ « DÉTAILLÉE » NE CONNAÎT PAS LE SOIR PAR AXE, ELLE LE DÉCIDE PAR SUJET
 * ═══ contrairement à la vue globale, la liste des groupes n'y est JAMAIS
 * réduite aux groupes CDS (`groupesDuSoir`) : chaque page ajoute sa propre
 * charge du soir aux « heures » affichées, exactement comme le fait
 * `GrilleDetaillee` à l'écran — voir son commentaire. Le CANEVAS, lui, ne
 * porte que les 4 créneaux du jour : une séance du soir compte dans la masse
 * horaire affichée, mais ne peut pas se dessiner dans la grille.
 */
export async function construireExportIndividuel(etablissementId, anneeScolaire, valeur, options) {
  const {
    format,
    axe = 'formateur',
    choisis = [],
    filtre = {},
    filtreGroupes: filtreGroupesOptions = {},
  } = options;

  const semaineInfo = analyserSemaine(valeur);
  if (!semaineInfo) throw badRequest(`Semaine « ${valeur} » illisible`, { code: 'SEMAINE_INVALIDE' });

  const [contexte, grille, etablissement, horaires] = await Promise.all([
    seancesService.contexte(etablissementId, anneeScolaire),
    seancesService.semaine(etablissementId, anneeScolaire, valeur),
    Etablissement.findById(etablissementId).select('nom nomAbrege complexe region').lean(),
    horairesService.obtenir(),
  ]);

  const seances = grille.seances;
  const nomsFormateurs = new Map(contexte.formateurs.map((f) => [f.matricule, f.nom]));

  let sujets;
  if (axe === 'salle') sujets = sallesDeLaSemaine(contexte.salles ?? [], seances);
  else if (axe === 'groupe') sujets = contexte.groupes ?? [];
  else sujets = contexte.formateurs.map((f) => f.matricule);

  const parIdentite =
    axe === 'groupe'
      ? filtrerGroupes(sujets, contexte.groupesIdentites ?? {}, filtreGroupesOptions)
      : sujets;
  const designes = choisis.length > 0 ? parIdentite.filter((s) => choisis.includes(s)) : parIdentite;
  const affiches = filtrerSujets(designes, seances, axe, filtre);

  if (affiches.length === 0) {
    throw badRequest('Rien à exporter pour ce filtre', { code: 'EXPORT_VIDE' });
  }

  // ⚠️ JOUR + SOIR, COMBINÉS COMME `GrilleDetaillee` — voir le commentaire
  // au-dessus de cette fonction.
  const assembleesJour = assemblerConsultation({ sujets: affiches, seances, axe, periode: PERIODES.JOUR });
  const assembleesSoir = assemblerConsultation({ sujets: affiches, seances, axe, periode: PERIODES.SOIR });

  const libelleDuSujet = (sujet) => (axe === 'formateur' ? (nomsFormateurs.get(sujet) ?? sujet) : sujet);

  const pages = affiches.map((sujet, index) => ({
    sujet,
    libelle: libelleDuSujet(sujet),
    heures: Math.round((assembleesJour[index].heures + assembleesSoir[index].heures) * 100) / 100,
    cases: assembleesJour[index].cases,
  }));

  const horaireDuCreneau = (jour, creneau) => horaireCreneau(jour, creneau, horaires.courant);

  const donnees = {
    etablissement: etablissement ?? {},
    anneeScolaire,
    semaineLabel: libelleSemaine(valeur, { court: true }),
    semaineDebut: semaineInfo.debut,
    entete: AXES_CONSULTATION[axe].libelle,
    lignes: AXES_CONSULTATION[axe].lignes,
    creneaux: SEANCES_JOUR,
    pages,
    nomsFormateurs,
    horaireDuCreneau,
  };

  if (format === 'docx') return construireDocxIndividuel(donnees);
  if (format === 'xlsx') return construireXlsxIndividuel(donnees);
  return construirePdfIndividuel(donnees);
}
