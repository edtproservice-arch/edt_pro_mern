import {
  analyserSemaine,
  datesDeLaPlage,
  fusionnerVacances,
  heuresPosees,
  lignesDepuisAffectations,
  lireAvancementEnote,
  lundiPremiereSemaine,
  objectifsParGroupe,
  plageDeSemaines,
  progressionEtablissement,
  SEMAINES_ANNEE_REGIONALE,
  semaineDansAnnee,
  seanceTerminee,
  semainesDeVacances,
  separerFusion,
  tauxRegional,
  totalAvancement,
} from 'shared/domain';
import { Base } from '../../models/Base.js';
import { EnoteImport } from '../../models/EnoteImport.js';
import { Seance } from '../../models/Seance.js';
import { Etablissement } from '../../models/Etablissement.js';
import { Chronogramme } from '../../models/Chronogramme.js';
import { Repartition } from '../../models/Repartition.js';
import { joursFeries } from '../calendrier/calendrier.service.js';
import { obtenir as calendrierNational } from '../calendrierNational/calendrierNational.service.js';
import { notFound } from '../../lib/httpError.js';

/**
 * Avancement réalisé / prévu, sous ses DEUX faces (F7).
 * ← api/data/get_avancement_data.php · get_planned_progress.php
 *   · get_completion_status.php
 *
 * ═══ ⚠️ DEUX FACES, UN SEUL PRÉVU ═══
 * « E-note » lit ce que l'établissement a DÉCLARÉ dans le système national ;
 * « eDTpro » compte ce qui est réellement posé dans la grille. Les deux se
 * rapportent aux mêmes masses AFFECTÉES : c'est ce qui rend l'écart lisible —
 * il dit ce qui n'a pas été saisi d'un côté ou de l'autre, pas une différence
 * de référentiel.
 *
 * ⚠️ L'AGRÉGATION EST LA MÊME POUR LES DEUX. Les lignes eDTpro sont
 * reconstruites dans la forme exacte des lignes e-note, puis passées aux mêmes
 * fonctions de domaine. Deux calculs parallèles auraient divergé au premier
 * ajustement — et c'est précisément sur cet écran qu'un écart d'un demi-point
 * est contesté par l'établissement.
 */
/**
 * @param {Date|null} observation  rembobinage (chronologie) — `null` = aujourd'hui
 * @param {{ maintenant?: {date: string, heure: string} }} [options]
 *   `maintenant` : ne compter au réalisé eDTpro que les séances TERMINÉES à cet
 *   instant (sessions consultatives). Sans lui, la borne reste la fin de la
 *   semaine en cours — la règle de la page du directeur, inchangée.
 */
export async function avancement(etablissementId, anneeScolaire, observation = null, options = {}) {
  const [base, importe, seances, etablissement, feries, national] = await Promise.all([
    /*
     * ⚠️ `groupeModes` EN PLUS : le MODE DE FORMATION (résidentiel, alterné…)
     * est propre au GROUPE, pas à l'affectation. La face e-note le lit en
     * colonne 15 ; côté grille il faut aller le chercher ici, sinon la facette
     * « Mode de formation » resterait vide sur cette face — une case qui ne rend
     * jamais rien fait douter du filtre plutôt que des données.
     */
    Base.findOne({ etablissementId, anneeScolaire })
      .select('affectations formateurs groupeModes')
      .lean(),
    /*
     * Le plus RÉCENT des imports de l'année : c'est l'état courant du système
     * national. L'historique reste en base pour la frise, qui viendra ensuite.
     */
    /*
     * ⚠️ « LE PLUS RÉCENT AVANT LA DATE OBSERVÉE », pas simplement le plus
     * récent : rembobiner au 12 novembre doit rendre le fichier qui faisait foi
     * ce jour-là, pas celui importé depuis. ← `get_enote_at_date.php`.
     */
    EnoteImport.findOne({
      etablissementId,
      anneeScolaire,
      ...(observation ? { importeLe: { $lte: observation } } : {}),
    })
      .sort({ importeLe: -1 })
      .select('nomFichier importeLe entete lignes')
      .lean(),
    /*
     * ⚠️ LA SALLE FAIT PARTIE DU DÉCOMPTE : c'est elle qui dit si la séance est
     * à distance, donc de quelle masse elle relève. Sans ce champ, tout serait
     * rangé en présentiel et le réalisé synchrone resterait à zéro — le défaut
     * déjà rencontré sur les indicateurs de la grille.
     */
    Seance.find({ etablissementId, anneeScolaire })
      /*
       * ⚠️ `semaine` EN PLUS : la courbe de progression cumule les heures
       * SEMAINE PAR SEMAINE. Sans ce champ, `analyserSemaine` ne rend rien et la
       * courbe reste plate à zéro — sans la moindre erreur pour le signaler.
       */
      /* ⚠️ `date` EN PLUS : c'est elle qui permet de rembobiner à un jour près,
         là où l'existant ne connaissait que la date de sauvegarde du blob. */
      .select('groupe module jour seance semaine statut salle estEfm date')
      .lean(),
    /*
     * ⚠️ LE CALENDRIER SERT AU TAUX OBJECTIF PÉDAGOGIQUE, pas aux heures : il
     * compte les JOURS DE FORMATION écoulés — dimanches, fériés, vacances et
     * stages du groupe retirés. Sans lui, la courbe d'objectif compterait des
     * jours de vacances comme des jours de cours et paraîtrait toujours en
     * avance sur la réalité.
     */
    Etablissement.findById(etablissementId).select('calendrier stages').lean(),
    joursFeries(etablissementId, anneeScolaire).catch(() => ({ joursFeries: [] })),
    /*
     * Le calendrier NATIONAL : ses vacances s'appliquent par défaut à tous les
     * établissements, et ses dates de rentrée décident du DÉBUT de l'année de
     * chaque groupe — donc du dénominateur de l'objectif pédagogique.
     */
    calendrierNational(anneeScolaire),
  ]);

  if (!base) {
    throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });
  }

  /*
   * ⚠️ LES VACANCES DU RÉSEAU S'APPLIQUENT ICI AUSSI. Lire les seules périodes
   * de l'établissement ferait diverger l'objectif pédagogique de ce que la
   * grille et le chronogramme montrent : des jours comptés comme ouvrés d'un
   * côté, fermés de l'autre.
   */
  const vacancesDeLAnnee = fusionnerVacances(
    national.vacances,
    etablissement?.calendrier?.vacances ?? [],
    etablissement?.calendrier?.vacancesEcartees ?? []
  );

  /*
   * ⚠️ LES AFFECTATIONS PORTENT L'IDENTIFIANT, PAS LE NOM (souvent un
   * matricule). L'axe formateur afficherait « 18448 » sans cette table — et
   * l'existant portait un commentaire sur ce point précis : sans conversion,
   * « la masse horaire planifiée ressortait à zéro pour tous les formateurs ».
   */
  const nomsParIdentifiant = new Map();
  for (const formateur of base.formateurs ?? []) {
    const nom = String(formateur.nomComplet ?? '').trim();
    if (nom === '') continue;
    for (const cle of [formateur.matricule, formateur.nomUnique, formateur.nomComplet]) {
      const identifiant = String(cle ?? '').trim();
      if (identifiant !== '') nomsParIdentifiant.set(identifiant, nom);
    }
  }
  const nomDuFormateur = (identifiant) => nomsParIdentifiant.get(identifiant) ?? identifiant;

  /*
   * ═══ ⚠️ ON FILTRE LES SÉANCES, ON NE LES RECHARGE PAS ═══
   * La PROGRESSION garde toute l'année — c'est une frise, la tronquer effacerait
   * ce qu'on vient y lire. Seul le RÉALISÉ des lignes se rembobine.
   *
   * ⚠️ ET C'EST EXACT, là où l'existant approximait : `Seance.date` porte le jour
   * réel de la séance, quand le blob PHP ne datait que sa SAUVEGARDE. Rembobiner
   * y dépendait de quand quelqu'un avait cliqué « enregistrer ».
   */
  /*
   * ═══ ⚠️ LA SEMAINE EN COURS EST CALCULÉE, PLUS DEVINÉE ═══ (correction du
   * porteur, 2026-09-01.)
   *
   * L'écran la cherchait en repérant le point dont le rythme régional vaut celui
   * d'aujourd'hui. Or ce rythme NE MONTE PAS pendant les vacances : plusieurs
   * semaines partagent alors la même valeur, et la recherche rendait la
   * PREMIÈRE — une semaine de vacances en cours s'annonçait donc sous le nom de
   * la semaine PRÉCÉDENTE.
   *
   * ⚠️ BORNÉE À [1, 39], comme le taux régional est borné à 100 : passé la fin
   * de l'année régionale, le repère se pose sur la dernière semaine plutôt que
   * de disparaître — sinon l'écran perdrait d'un coup son écart et son
   * « À la Sxx », et afficherait 0 % d'avancement.
   */
  const { numero: semaineCourante, fin: finSemaineCourante } =
    semaineCouranteDe(anneeScolaire);

  /*
   * ═══ ⚠️⚠️ LE RÉALISÉ S'ARRÊTE À LA SEMAINE EN COURS ═══ (demande du porteur,
   * 2026-09-01 : « il faut afficher l'avancement jusqu'à la semaine en cours,
   * pas l'avancement global ».)
   *
   * Sans cette borne, le graphe comptait AUSSI les séances déjà posées sur les
   * semaines À VENIR : un module planifié jusqu'en juin s'affichait comme s'il
   * était déjà fait, et le taux paraissait en avance sur la réalité. « Réalisé »
   * ne peut désigner que ce qui a EU LIEU.
   *
   * ⚠️ LA BORNE EST LA FIN DE LA SEMAINE, pas l'instant présent : c'est la
   * granularité de tout cet écran — la chronologie l'écrit en toutes lettres,
   * « l'état est celui de la fin de cette semaine ». Sans cela, le mercredi, les
   * séances du jeudi de la même semaine disparaîtraient du décompte, et l'écran
   * changerait de chiffre en cours de semaine sans que rien ne soit saisi.
   *
   * ⚠️ ET C'EST EXACTEMENT LA MÊME BORNE QUE LE REMBOBINAGE sur la semaine en
   * cours : l'affichage par défaut est le point courant de la chronologie, pas
   * un troisième état à part.
   */
  const borne = observation ?? finSemaineCourante;

  /*
   * ═══ ⚠️ LES SESSIONS CONSULTATIVES NE COMPTENT QUE LES SÉANCES TERMINÉES ═══
   * (2026-09-12, demande du porteur : « pour l'avancement eDTpro, afficher
   * l'avancement des séances terminées ».) Un formateur qui ouvre son écran le
   * mercredi matin ne doit pas voir comptées les séances de jeudi : elles n'ont
   * pas eu lieu. La règle est `seanceTerminee`, celle du badge « Terminé » de son
   * agenda — un jour passé, ou le jour même une fois l'horaire OFFICIEL échu.
   *
   * ⚠️ LA PAGE DU DIRECTEUR GARDE SA BORNE DE FIN DE SEMAINE (décision du
   * 2026-09-01) : c'est la granularité de sa chronologie. Seul l'appelant qui
   * passe `maintenant` change de règle, et un rembobinage (`observation`)
   * l'emporte toujours.
   */
  const maintenant = observation ? null : options.maintenant ?? null;
  const seancesObservees = seances.filter((seance) =>
    maintenant
      ? seanceTerminee(seance, maintenant)
      : seance.date && new Date(seance.date) <= borne
  );

  const lignesEdtpro = lignesDepuisAffectations(
    base.affectations ?? [],
    new Map(heuresPosees(seancesObservees)),
    nomDuFormateur,
    base.groupeModes ?? {}
  );
  const lignesEnote = lireAvancementEnote(importe);

  /*
   * ⚠️ IL SE CALCULE PAR GROUPE, PAS PAR LIGNE : le parcours va de septembre à
   * juillet, soit ~320 itérations, et le refaire pour chacune des 238 lignes
   * coûterait 76 000 tours pour vingt et un résultats distincts.
   *
   * ⚠️ SUR LES LIGNES eDTpro seulement : ce sont les groupes de la CARTE
   * courante. La face e-note peut porter des groupes d'un import plus ancien,
   * dont l'objectif ne se rapporterait à rien de comparable.
   */
  const objectifs = objectifsParGroupe(lignesEdtpro, {
    anneeScolaire,
    joursFeries: feries.joursFeries ?? [],
    vacances: vacancesDeLAnnee,
    stages: etablissement?.stages ?? [],
    /*
     * ⚠️ L'ANNÉE D'UN GROUPE COMMENCE À SA RENTRÉE (décision du porteur,
     * 2026-09-02). Sans elle, les jours qui séparent la S1 de la reprise
     * comptaient comme écoulés, et l'objectif d'une 1ʳᵉ année partait en avance
     * sur une promotion qui n'était pas encore là.
     */
    rentrees: national.rentrees,
  });

  /*
   * Les intitulés lisibles des modules, pour la carte au survol de l'écran.
   * ← `intituleModule()` de `seances.service.js`, mais EN UNE SEULE REQUÊTE :
   * l'avancement en affiche cinquante-quatre à la fois, et les interroger un par
   * un ferait cinquante-quatre allers-retours pour ouvrir une page.
   */
  /*
   * ⚠️ LES INTITULÉS ET LES MASSES DU RÉFÉRENTIEL VIENNENT DE LA MÊME REQUÊTE :
   * ce sont deux colonnes du même document DRIF, et les chercher séparément
   * ferait deux parcours de la collection pour un seul besoin.
   */
  const { intitules, massesDrif } = await referentielDesModules([
    ...lignesEdtpro,
    ...lignesEnote,
  ]);

  /*
   * ⚠️ LA MASSE DRIF EST POSÉE SUR LES LIGNES eDTpro, pas rendue à part : c'est
   * l'écran qui somme par groupe, APRÈS filtrage — sur une vue réduite à la
   * 1ʳᵉ année, le plafond doit descendre avec les barres. La face e-note, elle,
   * la lit dans ses propres colonnes 31-32.
   */
  for (const ligne of lignesEdtpro) {
    ligne.masseDrif = massesDrif[ligne.module] ?? 0;
  }

  /*
   * La masse horaire STATUTAIRE de chaque formateur — ce qu'il doit assurer dans
   * l'année. Elle vit sur la carte, pas sur les affectations.
   *
   * ⚠️ INDEXÉE PAR NOM, comme l'axe formateur du graphe : les affectations
   * portent l'identifiant, mais c'est le nom qui est affiché et donc la clé du
   * sujet. Indexer par matricule laisserait la courbe introuvable.
   */
  const statutaires = {};
  for (const formateur of base.formateurs ?? []) {
    const nom = String(formateur.nomComplet ?? '').trim();
    const masse = Number(formateur.masseHoraire ?? 0);
    if (nom !== '' && masse > 0) statutaires[nom] = masse;
  }

  /*
   * Le rythme attendu au niveau RÉGIONAL — une référence unique pour tout
   * l'établissement, en semaines actives de S1 à S39. Il ne se confond pas avec
   * l'objectif pédagogique, qui compte des jours ouvrés groupe par groupe.
   */
  const debutAnnee = lundiPremiereSemaine(anneeScolaire);
  /*
   * ⚠️ `rentrees` EN PLUS DES VACANCES (2026-09-03, demande du porteur) : sans
   * elle, la S1 comptait comme « active » même quand AUCUN niveau n'avait
   * encore sa rentrée — le rythme régional annonçait un retard avant que
   * l'établissement n'ait pu ouvrir un seul cours.
   */
  const regional = tauxRegional({
    anneeScolaire,
    vacances: vacancesDeLAnnee,
    rentrees: national.rentrees,
  });



  /*
   * ═══ ⚠️ LA COMPARAISON EST GLOBALE, PAS PAR SUJET ═══ (correction du porteur,
   * 2026-08-31.) Le taux régional est UN nombre pour tout l'établissement :
   * c'est au taux GLOBAL qu'il se compare. Semaine après semaine, l'écart entre
   * les deux courbes montre si l'établissement rattrape ou décroche — ce qu'un
   * chiffre seul ne dit jamais.
   *
   * ⚠️ ELLE N'EST PAS FILTRÉE, et l'écran le dit : c'est la progression de
   * l'ÉTABLISSEMENT. La calculer sur la sélection courante demanderait le détail
   * par semaine ET par ligne, et surtout la comparerait au rythme régional, qui
   * ne connaît, lui, aucune notion de filière ni de formateur.
   */
  const progression = progressionEtablissement(
    seances,
    totalAvancement(lignesEdtpro).prevu,
    /*
     * Le rythme attendu à la FIN de la semaine N — donc au dimanche, sans quoi
     * la première semaine paraîtrait n'avoir rien à rattraper.
     */
    (numero) => {
      const dimanche = new Date(debutAnnee);
      dimanche.setDate(dimanche.getDate() + numero * 7 - 1);
      return (
        tauxRegional({
          anneeScolaire,
          aujourdhui: dimanche,
          vacances: vacancesDeLAnnee,
          rentrees: national.rentrees,
        })?.taux ?? null
      );
    },
    /* Les MÊMES semaines que celles que le rythme régional écarte — c'est ce que
       le graphe signale, et il ne peut pas les désigner autrement. */
    semainesDeVacances({ anneeScolaire, vacances: vacancesDeLAnnee })
  );

  return {
    anneeScolaire,
    /* La date observée, renvoyée telle quelle : l'écran doit pouvoir dire à quel
       moment il s'est arrêté, et non le déduire de ce qu'il a demandé. */
    observation: observation ? observation.toISOString().slice(0, 10) : null,
    /* L'instant auquel les séances ont été jugées terminées — l'écran le dit, sans
       quoi « 12 h réalisées » ne se rapporterait à aucun moment. */
    seancesTermineesAu: maintenant,
    intitules,
    source: importe
      ? { fichier: importe.nomFichier, importeLe: importe.importeLe, lignes: importe.lignes.length }
      : null,
    /*
     * ═══ ⚠️ ON RENVOIE LES LIGNES, PLUS LES AGRÉGATS ═══
     * L'écran filtre par niveau, mode, groupe, formateur, semestre et statut
     * régional, PUIS agrège : un module vu « par module » réunit tous ses
     * groupes, et filtrer après agrégation ne pourrait que le garder ou le
     * retirer en bloc — alors que la question posée est « ce module, POUR LES
     * GROUPES DE 1ʳᵉ ANNÉE ».
     *
     * L'agrégation étant une fonction PURE du domaine, la faire dans le
     * navigateur ne crée pas un second calcul : c'est la même, au même endroit,
     * appelée depuis l'autre côté du réseau. Et le filtrage devient immédiat,
     * sans un aller-retour par facette cochée.
     */
    /*
     * Le taux objectif pédagogique, groupe par groupe : la courbe en pointillé
     * de la vue « par groupe ». ← `calculateObjectiveRate()` d'avancement.html.
     */
    objectifs,
    regional,
    semaineCourante,
    progression,
    statutaires,
    faces: {
      edtpro: lignesEdtpro,
      enote: lignesEnote,
    },
  };
}

/**
 * Le nom lisible de chaque module, par son code.
 *
 * ⚠️ `Base.affectations` NE GARDE QUE LE CODE : « M107 » n'apprend rien. Le nom
 * ne peut venir que de la RÉPARTITION DRIF — c'est déjà ce qui oblige la
 * reconstruction de la carte à croiser les deux.
 *
 * ⚠️ UN CODE PAR INTITULÉ, ET C'EST UNE SIMPLIFICATION ASSUMÉE. Le même code vit
 * dans plusieurs filières, parfois avec des intitulés différents — la fiche d'un
 * module de la grille interroge donc la filière ET l'année du groupe. Ici le
 * sujet EST le code, agrégé à travers toutes les filières : il n'y a qu'un
 * libellé à afficher. On choisit le premier par ordre de filière, pour que deux
 * chargements ne rendent pas deux noms différents.
 */
async function referentielDesModules(lignes) {
  const codes = [...new Set(lignes.map((ligne) => ligne.module).filter(Boolean))];
  if (codes.length === 0) return { intitules: {}, massesDrif: {} };

  const references = await Repartition.find({ codeModule: { $in: codes } })
    .select('codeModule module codeFiliereDrif mhpS1 mhpS2 mhsynS1 mhsynS2')
    .sort({ codeModule: 1, codeFiliereDrif: 1 })
    .lean();

  const intitules = {};
  const massesDrif = {};

  for (const reference of references) {
    const code = String(reference.codeModule ?? '').trim();
    if (code === '') continue;

    const nom = String(reference.module ?? '').trim();
    // Le premier rencontré fait foi ; le tri rend ce choix reproductible.
    if (nom !== '' && !intitules[code]) intitules[code] = nom;

    /*
     * ⚠️ PRÉSENTIEL + SYNCHRONE, SANS L'ASYNCHRONE — ce sont les colonnes 31 et
     * 32 que l'existant additionnait (« MHP Totale DRIF » et « MHSYN Totale
     * DRIF »), la 33 (« MHASYN ») restant de côté. Y ajouter l'asynchrone
     * relèverait le plafond au-dessus de ce que les barres peuvent atteindre :
     * elles, ne comptent que ce qui se pose dans une grille.
     */
    if (massesDrif[code] === undefined) {
      massesDrif[code] =
        Number(reference.mhpS1 ?? 0) +
        Number(reference.mhpS2 ?? 0) +
        Number(reference.mhsynS1 ?? 0) +
        Number(reference.mhsynS2 ?? 0);
    }
  }

  return { intitules, massesDrif };
}


/**
 * Les PLAGES d'un module : celle que le chronogramme PRÉVOIT, et celle que la
 * grille porte RÉELLEMENT.
 * ← `get_modules_completion_dates.php`
 *
 * ═══ CE QU'ELLE MONTRE ═══
 * « Prévu S3 → S12, posé S4 → S15 » : le module a démarré avec une semaine de
 * retard et s'étale sur trois de plus. C'est la dérive qu'aucun taux ne révèle —
 * un module peut être à 100 % et avoir fini deux mois après la date prévue.
 *
 * ⚠️ LES DEUX SOURCES SONT INDÉPENDANTES : un module peut être au chronogramme
 * sans être encore posé (rien dans la grille), ou posé sans figurer au
 * chronogramme (ajouté en cours d'année). Les deux cas sont rendus tels quels,
 * avec `null` du côté manquant — les taire laisserait croire à un oubli.
 *
 * ⚠️ ELLE SE REMBOBINE AUSSI (`observation`). Sans cela, un écran ramené à la
 * S3 aurait compté ses modules achevés à cette date — le nombre change bien —
 * mais aurait montré des plages posées allant jusqu'à la S12. Deux dates dans le
 * même bloc, dont l'une n'est écrite nulle part : c'est l'écart le plus
 * difficile à expliquer.
 *
 * ⚠️ LE CHRONOGRAMME, LUI, NE SE REMBOBINE PAS : c'est un PRÉVISIONNEL annuel,
 * établi une fois pour toutes. Le tronquer à la date observée ferait disparaître
 * précisément ce à quoi on compare le réalisé.
 */
export async function achevementDesModules(etablissementId, anneeScolaire, observation = null) {
  const [chronogrammes, toutesLesSeances] = await Promise.all([
    Chronogramme.find({ etablissementId, anneeScolaire }).select('groupe planning').lean(),
    Seance.find({ etablissementId, anneeScolaire })
      .select('groupe module semaine statut estEfm date')
      .lean(),
  ]);

  /* ⚠️ LA MÊME BORNE PAR DÉFAUT QUE LES TAUX : le décompte de modules achevés
     et les plages posées vivent dans le même bloc de l'écran, et deux bornes
     différentes s'y contrediraient sans que rien ne le dise. */
  const borne = observation ?? semaineCouranteDe(anneeScolaire).fin;

  const seances = toutesLesSeances.filter(
    (seance) => seance.date && new Date(seance.date) <= borne
  );

  /* ── Ce que le chronogramme prévoit ──────────────────────────────────── */
  const prevues = new Map();
  for (const chrono of chronogrammes) {
    const planning = chrono.planning ?? {};
    for (const [module, cellules] of Object.entries(planning)) {
      const numeros = (cellules ?? [])
        .filter((cellule) => Number(cellule?.heures) > 0)
        .map((cellule) => Number(String(cellule.semaine).replace(/^S/iu, '')));

      const plage = plageDeSemaines(numeros);
      if (plage) prevues.set(cle(chrono.groupe, module), plage);
    }
  }

  /* ── Ce que la grille porte ──────────────────────────────────────────── */
  const posees = new Map();
  for (const seance of seances) {
    /*
     * ⚠️ LES MÊMES EXCLUSIONS QUE PARTOUT AILLEURS : une séance absente n'a pas
     * eu lieu, une surveillance d'EFM n'est pas un cours. Les compter ferait
     * commencer un module à la date de l'examen d'un autre.
     */
    if (seance.statut === 'absent' || seance.estEfm) continue;

    const analyse = analyserSemaine(seance.semaine);
    const module = String(seance.module ?? '').trim();
    if (!analyse || module === '') continue;

    /*
     * ⚠️ UNE SÉANCE FUSIONNÉE COMPTE POUR CHACUN DE SES GROUPES : « GM101 GM102 »
     * n'est le libellé d'aucune ligne de chronogramme, et la plage serait
     * introuvable pour les deux.
     */
    for (const groupe of separerFusion(seance.groupe)) {
      const identifiant = cle(groupe, module);
      if (!posees.has(identifiant)) posees.set(identifiant, []);
      posees.get(identifiant).push(analyse.numero);
    }
  }

  const identifiants = new Set([...prevues.keys(), ...posees.keys()]);
  const plages = {};

  for (const identifiant of identifiants) {
    const prevue = prevues.get(identifiant) ?? null;
    const posee = plageDeSemaines(posees.get(identifiant) ?? []);

    plages[identifiant] = {
      prevue,
      posee,
      datesPrevues: datesDeLaPlage(anneeScolaire, prevue),
      datesPosees: datesDeLaPlage(anneeScolaire, posee),
    };
  }

  return plages;
}

/** La clé d'un couple (groupe, module) — celle que l'écran emploie aussi. */
const cle = (groupe, module) => `${String(groupe ?? '').trim()}||${String(module ?? '').trim()}`;


/**
 * Les POINTS de la frise chronologique, par face.
 * ← `get_timeline_dates.php`
 *
 * ═══ ⚠️ LES DEUX FACES N'ONT PAS LA MÊME CHRONOLOGIE ═══
 * E-note avance par IMPORTS : entre deux fichiers, rien ne change, et les points
 * sont donc ceux des dépôts. La grille, elle, avance par SEMAINES : chaque
 * semaine saisie déplace le réalisé. Offrir la même frise aux deux ferait
 * proposer des dates où l'une des faces ne bouge jamais.
 */
export async function chronologie(etablissementId, anneeScolaire) {
  const [imports, semaines] = await Promise.all([
    EnoteImport.find({ etablissementId, anneeScolaire })
      .select('nomFichier importeLe')
      .sort({ importeLe: 1 })
      .lean(),
    /*
     * ⚠️ LES SEMAINES QUI PORTENT VRAIMENT UNE SÉANCE, pas les 39 de l'année :
     * proposer une semaine vide donnerait un point où rien n'a changé, et la
     * frise laisserait croire à un arrêt de l'activité.
     */
    Seance.distinct('semaine', { etablissementId, anneeScolaire }),
  ]);

  const points = {
    /*
     * ═══ ⚠️ LA FRISE E-NOTE EST PAR SEMAINE, PLUS PAR JOUR ═══ (demande du
     * porteur, 2026-09-01 : « la même chronologie en mode e-note, et par semaine
     * pas par jour ».)
     *
     * Elle repose sur la règle « une seule base e-note par semaine » posée dans
     * `enoteImport.service.js` : un point = une semaine = un état déclaré. Les
     * deux faces parlent alors la même langue — « l'état à la S3 » — et
     * l'utilisateur n'a plus à traduire une date de dépôt en semaine scolaire.
     *
     * ⚠️ LA SEMAINE SE CALCULE DANS L'ANNÉE DE LA BASE, jamais dans celle du
     * dépôt : un fichier déposé le 19 août 2026 alimente 2026-2027 et vaut pour
     * sa S1 — `semaineDe` le rangerait en S1 de l'année qui s'achève.
     *
     * ⚠️ ET ON GARDE LE PLUS RÉCENT DE CHAQUE SEMAINE : la règle est récente,
     * les données antérieures peuvent porter deux dépôts la même semaine. Le
     * dernier est celui qui fait foi à la fin de cette semaine — c'est
     * exactement ce que le rembobinage ira chercher.
     */
    enote: [
      ...imports
        .reduce((parSemaine, entree) => {
          if (!entree.importeLe) return parSemaine;
          const numero = semaineDansAnnee(anneeScolaire, new Date(entree.importeLe)).numero;
          parSemaine.set(numero, entree);
          return parSemaine;
        }, new Map())
        .entries(),
    ]
      .sort(([a], [b]) => a - b)
      .map(([numero, entree]) => ({
        /*
         * ⚠️ LA FIN DE LA SEMAINE, comme pour l'autre face : c'est la borne qui
         * inclut le dépôt, quel que soit le jour où il a eu lieu.
         */
        date: enJourLocal(finDeSemaine(anneeScolaire, numero)),
        libelle: `S${numero}`,
        /* Le fichier reste nommé : c'est ce qu'on vient reconnaître. */
        detail: `${entree.nomFichier} — déposé le ${enJourLocal(entree.importeLe)}`,
      })),

    edtpro: semaines
      .map((valeur) => analyserSemaine(valeur))
      .filter(Boolean)
      .sort((a, b) => a.numero - b.numero)
      .map((analyse) => ({
        /*
         * ⚠️ LA FIN DE LA SEMAINE, PAS SON DÉBUT : « l'état à la S12 » veut dire
         * « une fois la S12 faite ». Prendre le lundi retirerait de la vue les
         * séances de la semaine qu'on vient de désigner.
         */
        date: enJourLocal(finDeSemaine(anneeScolaire, analyse.numero)),
        libelle: `S${analyse.numero}`,
        detail: enJourLocal(finDeSemaine(anneeScolaire, analyse.numero)),
      })),
  };

  return points;
}

/**
 * La semaine scolaire d'AUJOURD'HUI, et l'instant où elle s'achève.
 *
 * ⚠️ BORNÉE À [1, 39] : hors de l'année régionale, on se rabat sur sa dernière
 * semaine plutôt que de rendre un numéro que la courbe ne porte pas.
 */
function semaineCouranteDe(anneeScolaire) {
  const numero = Math.min(
    SEMAINES_ANNEE_REGIONALE,
    Math.max(1, semaineDansAnnee(anneeScolaire, new Date()).numero)
  );

  const fin = finDeSemaine(anneeScolaire, numero);
  // Fin de journée LOCALE : à minuit, les séances du samedi seraient exclues.
  fin.setHours(23, 59, 59, 999);

  return { numero, fin };
}

/** Le samedi de la semaine N — six jours après son lundi. */
function finDeSemaine(anneeScolaire, numero) {
  const date = lundiPremiereSemaine(anneeScolaire);
  const fin = new Date(date);
  fin.setDate(fin.getDate() + (numero - 1) * 7 + 5);
  return fin;
}

/** « AAAA-MM-JJ » en heure LOCALE — `toISOString()` décalerait d'un jour. */
function enJourLocal(valeur) {
  const date = valeur instanceof Date ? valeur : new Date(valeur);
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}
