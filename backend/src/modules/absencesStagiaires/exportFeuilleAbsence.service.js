import { JOURS } from 'shared/constants';
import { SEANCES_JOUR, analyserSemaine, dureeSeance, separerFusion } from 'shared/domain';
import { AbsenceStagiaire } from '../../models/AbsenceStagiaire.js';
import { Base } from '../../models/Base.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { badRequest } from '../../lib/httpError.js';
import { semaine as semaineDeLaGrille } from '../seances/seances.service.js';
import { construireDocxFeuilleAbsence } from './exportFeuilleAbsenceDocx.js';
import { construireXlsxFeuilleAbsence } from './exportFeuilleAbsenceXlsx.js';
import { construirePdfFeuilleAbsence } from './exportFeuilleAbsencePdf.js';

/**
 * Export Word / PDF / Excel de la feuille d'absence hebdomadaire d'un ou
 * plusieurs groupes (2026-09-29, demande du porteur : « je veux intégrer
 * l'absence pour stagiaire, voici le canvas pour Feuille d'Absence
 * Hebdomadaire »).
 *
 * ═══ ⚠️ PLUSIEURS GROUPES = LE FILTRE DE « FAIRE L'APPEL » (2026-09-29,
 * demande du porteur : « en faire l'appel je veux ajouter l'option de filtre
 * comme en édition » ; « si tous les groupes s'affiche il télécharge tous les
 * groupes, d'après le filtre ») ═══ L'écran envoie la liste des groupes que
 * son filtre (filière / niveau / année, comme en Édition) laisse visibles sur
 * la grille — un seul, ou tous. Un fichier, une page par groupe (voir
 * `exportFeuilleAbsenceDocx.js`), un onglet par groupe pour l'Excel.
 *
 * ═══ ⚠️ « T. A » S'ACCUMULE SEMAINE APRÈS SEMAINE (2026-09-29, demande du
 * porteur : « il faut qu'il accule le T.A pour chaque semaine » — revient sur
 * la décision du 2026-09-29 plus tôt, qui l'arrêtait à la semaine affichée)
 * ═══ C'est le cumul de TOUTES les semaines de l'année scolaire, de S1 jusqu'à
 * la semaine affichée INCLUSE — pas le cumul de l'année ENTIÈRE si la semaine
 * affichée est en cours d'année, et pas non plus la seule semaine affichée.
 * Voir la note de discipline (`discipline.service.js`) pour le cumul TOTAL de
 * l'année, un besoin différent (la note ne s'arrête jamais à une semaine).
 *
 * ═══ ⚠️ LA LIGNE ROUGE : UNE ABSENCE DE LA SEMAINE PRÉCÉDENTE, TOUJOURS PAS
 * JUSTIFIÉE (2026-09-29, demande du porteur — d'abord « absent en S4 [puis]
 * S5 », précisé ensuite : « si un stagiaire était absent en S4, si n'a pas
 * justifié son absence, alors en S5 sa ligne être en rouge ») ═══ CE N'EST
 * PAS « absent les deux semaines de suite » : un stagiaire absent la semaine
 * qui PRÉCÈDE la semaine affichée, et dont CETTE absence-là n'a toujours pas
 * été justifiée (`AbsenceStagiaire.justifiee`), voit toute sa ligne (N°, nom,
 * T. A, les 24 cases) basculer en rouge — même s'il est présent partout
 * cette semaine-ci. C'est le signe qu'un dossier reste à régler, pas une
 * redite de l'absence elle-même. Fond clair, texte rouge foncé (le rouge sur
 * rouge du porteur serait illisible — même teinte que les cases « A », voir
 * `COULEURS_MARQUE`). Le signe que montrait déjà le canevas transmis
 * (BOUHZAM DOUNIA, surlignée à la main) n'était donc pas qu'une annotation de
 * l'exemplaire : c'est CETTE règle-là, maintenant calculée.
 *
 * Le N° reste 1, 2, 3… SANS TROU, dans l'ordre alphabétique (décision du
 * porteur, 2026-09-29) — le tri Mongo (`nom`, `prenom`) fait déjà cet ordre ;
 * `index + 1` fait la numérotation.
 *
 * ⚠️ LES RETARDS N'ENTRENT PAS DANS « T. A » : le libellé du canevas dit
 * « Total Absences », et un retard reste un fait distinct ailleurs dans
 * l'application (`TYPES_ABSENCE.RETARD`). Il apparaît néanmoins sur sa propre
 * case du jour, en « R » plutôt qu'en « A » — et compte pour la ligne rouge
 * comme pour la semaine précédente : SEULES les vraies absences y comptent.
 *
 * ═══ ⚠️ LA LIGNE « FORMATEURS » VIENT DE L'EMPLOI DU TEMPS, PAS DE L'APPEL
 * (2026-09-29, demande du porteur : « en ligne formateur en bas afficher le
 * nom du formateur ») ═══ C'est la MÊME grille que « Faire l'appel »
 * (`seances.service.js#semaine`), lue une seule fois pour tous les groupes
 * demandés — un formateur mutualisé peut apparaître sur plusieurs feuilles à
 * la fois. Le canevas porte déjà `<w:textDirection w:val="btLr"/>` sur
 * chacune de ses 24 cases : le nom s'y écrit à la verticale sans rien à
 * ajouter côté greffe, voir `exportFeuilleAbsenceDocx.js`.
 */
export async function construireExportFeuilleAbsence(etablissementId, anneeScolaire, options) {
  const { format, groupes, semaine } = options;

  const semaineAnalysee = analyserSemaine(semaine);
  if (!semaineAnalysee) throw badRequest(`Semaine « ${semaine} » illisible`, { code: 'SEMAINE_INVALIDE' });
  const numeroActuel = semaineAnalysee.numero;
  const semainePrecedente = numeroActuel > 1 ? `${anneeScolaire}-W${numeroActuel - 1}` : null;

  const [stagiaires, marquages, etablissement, grille, base] = await Promise.all([
    Stagiaire.find({ etablissementId, anneeScolaire, groupes: { $in: groupes } })
      .select('matricule nom prenom filiere annee groupes')
      .sort({ nom: 1, prenom: 1 })
      .lean(),
    // ⚠️ TOUTE L'ANNÉE, PAS LA SEULE SEMAINE AFFICHÉE : « T. A » cumule depuis
    // S1, et la ligne rouge regarde aussi la semaine précédente — voir le
    // commentaire en tête de fichier.
    AbsenceStagiaire.find({ etablissementId, anneeScolaire, groupe: { $in: groupes }, periode: 'jour' })
      .select('matricule groupe semaine jour seance typeAbsence justifiee')
      .lean(),
    Etablissement.findById(etablissementId).select('nom').lean(),
    semaineDeLaGrille(etablissementId, anneeScolaire, semaine),
    Base.findOne({ etablissementId, anneeScolaire }).select('formateurs').lean(),
  ]);

  const nomDuStagiaire = (s) => [s.nom, s.prenom].filter(Boolean).join(' ').trim() || s.matricule;
  const joursOuvres = JOURS.slice(0, 6);

  const nomsFormateurs = new Map();
  for (const f of base?.formateurs ?? []) {
    for (const cle of [f.matricule, f.nomUnique, f.nomComplet]) {
      if (String(cle ?? '').trim()) nomsFormateurs.set(String(cle).trim(), f.nomComplet);
    }
  }

  /** Le formateur de CE groupe sur CE créneau de jour — le premier trouvé, une fusion réunissant plusieurs groupes. */
  function formateurDuCreneau(groupe, jour, seance) {
    const trouvee = grille.seances.find(
      (s) =>
        s.jour === jour &&
        s.seance === seance &&
        (s.periode ?? 'jour') === 'jour' &&
        s.groupe &&
        separerFusion(s.groupe).includes(groupe)
    );
    if (!trouvee) return '';
    return nomsFormateurs.get(String(trouvee.formateurMatricule ?? '').trim()) ?? trouvee.formateurMatricule ?? '';
  }

  const registresParGroupe = new Map();
  for (const marquage of marquages) {
    if (!registresParGroupe.has(marquage.groupe)) registresParGroupe.set(marquage.groupe, new Map());
    const parMatricule = registresParGroupe.get(marquage.groupe);
    if (!parMatricule.has(marquage.matricule)) parMatricule.set(marquage.matricule, []);
    parMatricule.get(marquage.matricule).push(marquage);
  }

  const feuilles = groupes
    .map((groupe) => {
      const roster = stagiaires.filter((s) => (s.groupes ?? []).includes(groupe));
      if (roster.length === 0) return null;

      const registresParMatricule = registresParGroupe.get(groupe) ?? new Map();
      const lignes = roster.map((stagiaire, index) => {
        const registres = registresParMatricule.get(stagiaire.matricule) ?? [];

        // La grille de créneaux n'affiche QUE la semaine demandée.
        const marquesSemaine = new Map(
          registres.filter((r) => r.semaine === semaine).map((r) => [`${r.jour}|${r.seance}`, r.typeAbsence])
        );
        const marques = joursOuvres.flatMap((jour) =>
          SEANCES_JOUR.map((seance) => marquesSemaine.get(`${jour}|${seance}`) ?? null)
        );

        // « T. A » cumule depuis S1 jusqu'à la semaine affichée INCLUSE.
        const totalCumule = registres.reduce((total, r) => {
          if (r.typeAbsence !== 'absence') return total;
          const analyse = analyserSemaine(r.semaine);
          if (!analyse || analyse.numero > numeroActuel) return total;
          return total + dureeSeance(r.seance);
        }, 0);

        // Une absence de la semaine PRÉCÉDENTE, jamais justifiée depuis : la ligne passe au rouge.
        const absenceNonJustifieeSemainePrecedente =
          semainePrecedente !== null &&
          registres.some((r) => r.semaine === semainePrecedente && r.typeAbsence === 'absence' && !r.justifiee);

        return {
          numero: index + 1,
          nom: nomDuStagiaire(stagiaire),
          marques,
          // ⚠️ EN HEURES, PAS EN SÉANCES (2026-09-29, demande du porteur : « met
          // total absence par heure ») — `dureeSeance`, jamais une constante
          // plate, comme partout ailleurs dans le domaine (2,5 h la séance de
          // jour).
          totalSemaine: totalCumule,
          rouge: absenceNonJustifieeSemainePrecedente,
        };
      });

      const formateurs = joursOuvres.flatMap((jour) =>
        SEANCES_JOUR.map((seance) => formateurDuCreneau(groupe, jour, seance))
      );

      return {
        groupe,
        filiere: roster[0].filiere ?? '',
        anneeLabel: roster[0].annee ?? '',
        lignes,
        formateurs,
      };
    })
    .filter(Boolean);

  if (feuilles.length === 0) {
    throw badRequest('Aucun stagiaire dans les groupes demandés', { code: 'GROUPE_VIDE' });
  }

  const donnees = { etablissement: etablissement ?? {}, anneeScolaire, semaine, feuilles };

  if (format === 'docx') return construireDocxFeuilleAbsence(donnees);
  if (format === 'xlsx') return construireXlsxFeuilleAbsence(donnees);
  return construirePdfFeuilleAbsence(donnees);
}
