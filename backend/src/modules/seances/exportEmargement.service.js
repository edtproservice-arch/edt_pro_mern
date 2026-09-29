import {
  agendaDuSujet,
  analyserSemaine,
  avancementModule,
  fichesModules,
  heuresPosees,
  libelleSemaine,
} from 'shared/domain';
import { JOURS } from 'shared/constants';
import { Etablissement } from '../../models/Etablissement.js';
import { badRequest } from '../../lib/httpError.js';
import * as seancesService from './seances.service.js';
import * as horairesService from '../horaires/horaires.service.js';
import { Base } from '../../models/Base.js';
import { cleGroupeModule } from '../../lib/intitulesModules.js';
import { referentielDesModules } from '../avancement/avancement.service.js';
import { construireDocxEmargement } from './exportEmargementDocx.js';
import { construireXlsxEmargement } from './exportEmargementXlsx.js';
import { construirePdfEmargement } from './exportEmargementPdf.js';

/**
 * Export Word / PDF / Excel de l'émargement JOURNALIER — la feuille de
 * signature qu'un établissement imprime pour UN jour donné, un formateur par
 * bloc de cours continu, avec son taux d'avancement du moment.
 * ← demande du porteur, canevas Word « EMARGEMENT_Lundi_2026-W4 » transmis.
 *
 * ═══ ⚠️ TOUT VIENT DE FONCTIONS DÉJÀ ÉCRITES ═══
 * Le découpage en blocs contigus est celui de `agendaDuSujet()` (le même que
 * l'agenda personnel d'un formateur) ; le taux d'avancement est celui
 * d'`avancementModule()` (le même que la page Avancement). Aucun des deux
 * n'est recalculé ici — recopier l'un ou l'autre aurait fini par diverger au
 * premier ajustement, la cause n°1 d'instabilité du §4.2.
 */
export async function construireExportEmargement(etablissementId, anneeScolaire, valeur, options) {
  const { jour, format } = options;

  if (!JOURS.includes(jour)) {
    throw badRequest(`Jour « ${jour} » inconnu`, { code: 'JOUR_INVALIDE' });
  }

  const semaineInfo = analyserSemaine(valeur);
  if (!semaineInfo) throw badRequest(`Semaine « ${valeur} » illisible`, { code: 'SEMAINE_INVALIDE' });

  const [contexte, grille, etablissement, horaires] = await Promise.all([
    seancesService.contexte(etablissementId, anneeScolaire),
    seancesService.semaine(etablissementId, anneeScolaire, valeur),
    Etablissement.findById(etablissementId).select('nom nomAbrege complexe').lean(),
    horairesService.obtenir(),
  ]);

  const jourInfo = grille.jours.find((j) => j.jour === jour);
  const dateJour = jourInfo?.date ? new Date(`${jourInfo.date}T00:00:00`) : null;

  const nomsFormateurs = new Map(contexte.formateurs.map((f) => [f.matricule, f.nom]));
  /*
   * ⚠️ LES MÊMES DEUX SOURCES QUE LA PAGE AVANCEMENT — `fichesModules` (le
   * prévu, depuis les affectations de la carte) et `heuresPosees` (le réalisé,
   * ici DÉJÀ agrégé sur l'année entière par `contexte()`, qui les calcule pour
   * la grille d'édition). Aucune requête de plus : `avancementModule` prend
   * les deux tels quels.
   */
  const fiches = fichesModules(contexte.affectations ?? []);
  const posees = new Map(Object.entries(contexte.posees ?? {}));

  const lignes = [];
  for (const formateur of contexte.formateurs) {
    const agenda = agendaDuSujet({
      sujet: formateur.matricule,
      seances: grille.seances,
      axe: 'formateur',
      nomsFormateurs,
      horaires: horaires.courant,
    });

    const jourAgenda = agenda.jours.find((j) => j.jour === jour);
    if (!jourAgenda) continue;

    for (const bloc of jourAgenda.blocs) {
      const avancement = avancementModule(fiches, posees, bloc.groupeSeance, bloc.module, null);

      lignes.push({
        formateur: formateur.nom,
        groupe: bloc.autreSujet,
        module: bloc.module,
        salle: bloc.salle,
        debut: bloc.debut,
        fin: bloc.fin,
        taux: avancement?.taux ?? null,
        prevu: avancement?.prevu ?? null,
        pose: avancement?.pose ?? null,
        niveau: avancement?.niveau ?? null,
      });
    }
  }

  if (lignes.length === 0) {
    throw badRequest(`Aucune séance le ${jour.toLowerCase()} de cette semaine`, {
      code: 'EMARGEMENT_VIDE',
    });
  }

  /*
   * ⚠️ TRIÉES PAR NOM DE FORMATEUR (2026-09-24, demande du porteur : « trier
   * la liste en tableau en ordre alphabétique »). Un même formateur peut
   * porter PLUSIEURS blocs ce jour-là (matin et après-midi) : le tri ne
   * touche que l'ORDRE DES FORMATEURS entre eux, jamais celui de leurs
   * propres blocs, déjà chronologique — `Array.prototype.sort` est STABLE,
   * les blocs d'un même nom restent donc dans l'ordre où `agendaDuSujet` les
   * a posés.
   */
  lignes.sort((a, b) => a.formateur.localeCompare(b.formateur, 'fr'));

  /*
   * ⚠️ LE NOM COMPLET À CÔTÉ DU CODE (2026-09-25, demande du porteur) — même
   * source que la carte au survol de la page Avancement (`referentielDesModules`,
   * la répartition DRIF), en UNE SEULE requête pour tous les modules du jour
   * plutôt qu'une par ligne. Un module hors référentiel n'est pas une erreur :
   * la ligne garde alors son seul code, comme la carte le fait déjà.
   */
  // ⚠️ AVEC LA BASE : l'intitulé se lit dans la filière du groupe de la ligne.
  const base = await Base.findOne({ etablissementId, anneeScolaire })
    .select('affectations groupes groupeFilieres')
    .lean();
  const { intitules, intitulesParGroupe } = await referentielDesModules(lignes, base);
  for (const ligne of lignes) {
    const intitule =
      intitulesParGroupe.get(cleGroupeModule(ligne.groupe, ligne.module)) ?? intitules[ligne.module];
    ligne.moduleAffiche = intitule ? `${ligne.module} - ${intitule}` : ligne.module;
  }

  const donnees = {
    etablissement: etablissement ?? {},
    anneeScolaire,
    semaineLabel: libelleSemaine(valeur, { court: true }),
    jour,
    date: dateJour,
    lignes,
  };

  if (format === 'docx') return construireDocxEmargement(donnees);
  if (format === 'xlsx') return construireXlsxEmargement(donnees);
  return construirePdfEmargement(donnees);
}
