import { instantLocal, semestreDe, separerFusion } from 'shared/domain';
import { TYPES_COURS } from 'shared/constants';
import { Base } from '../../models/Base.js';
import { Stagiaire } from '../../models/Stagiaire.js';
import { Repartition } from '../../models/Repartition.js';
import { intitulesModules } from '../../lib/intitulesModules.js';
import { notFound } from '../../lib/httpError.js';
import * as seancesService from '../seances/seances.service.js';
import * as avancementService from '../avancement/avancement.service.js';

/**
 * Sessions consultatives — formateur & stagiaire (F14).
 * ← `get_formateur_timetable.php`, `get_stagiaire_timetable.php`,
 *   `emploiFormateur.html`, `emploiStagiaire.html`, `avancementFormateur.html`,
 *   `avancementStagiaire.html`, `affectationFormateur.html`
 *
 * ═══ ⚠️ CE MODULE NE RECALCULE RIEN — IL RÉUTILISE, PUIS FILTRE ═══
 * `seances.service.js` et `avancement.service.js` savent déjà construire la
 * semaine et l'avancement de TOUT l'établissement — c'est ce que « Emploi » et
 * « Avancement » leur demandent. Réécrire ce calcul pour un formateur ou un
 * stagiaire serait la cause n°1 d'instabilité du §4.2 : deux implémentations
 * du même parcours, qui divergeraient au premier ajustement (règle de
 * rentrée, synchrone mutualisé, jours fériés…).
 *
 * ⚠️ MAIS LE RÉSULTAT NE PART JAMAIS TEL QUEL. Ces deux services rendent une
 * vue D'ÉTABLISSEMENT — tous les formateurs, tous les groupes — parce que
 * c'est un directeur qui les interroge. Un formateur ou un stagiaire ne doit
 * voir NI les séances des autres, NI l'avancement de modules qu'il n'assure
 * pas : le filtrage a donc lieu ICI, avant que la réponse ne quitte le
 * serveur — jamais côté client, où elle serait déjà partie.
 */

/**
 * Les semaines déjà remplies — établissement entier, rien de personnel.
 *
 * ═══ ⚠️ C'EST `courante` QUI PORTE LA PUBLICATION ═══ (2026-09-06, demande du
 * porteur : « le bouton publier affiche la semaine que le directeur a publiée
 * pour toutes les sessions gestionnaire, formateur, stagiaire ».)
 *
 * L'écran ouvre déjà `courante` : faire décider le SERVEUR évite d'ajouter un
 * appel — l'existant avait `get_published_week.php`, un aller-retour de plus —
 * et surtout d'écrire la priorité une fois par écran consultatif. Elle vit dans
 * `semaineAOuvrir`, testée, et personne ne la recopie.
 *
 * ⚠️ ET LA RÈGLE DU WEEK-END NE VAUT QUE POUR EUX. Le DIRECTEUR travaille sur
 * la semaine qu'il prépare : le samedi après-midi, le déplacer d'office sur la
 * suivante lui ferait perdre le fil de sa saisie. Ces écrans-ci ne font que
 * consulter — ce qu'on y cherche le week-end est bien la semaine qui vient.
 */
export async function semaines(etablissementId, anneeScolaire) {
  const [liste, publication] = await Promise.all([
    seancesService.semaines(etablissementId, anneeScolaire),
    seancesService.publicationCourante(etablissementId, anneeScolaire),
  ]);

  return {
    semaines: liste,
    courante: seancesService.semaineCourante(anneeScolaire, new Date(), {
      semainePubliee: publication?.semaine ?? null,
      regleWeekEnd: true,
    }),
    publication,
  };
}

/**
 * Code de module → intitulé complet : `lib/intitulesModules.js` (partagé avec
 * les absences de formateurs).
 */

/**
 * La semaine d'UN formateur : sa ligne seule, et les motifs d'absence qui LE
 * concernent — jamais ceux de ses collègues.
 */
export async function emploiFormateur(etablissementId, anneeScolaire, valeur, matricule) {
  const grille = await seancesService.semaine(etablissementId, anneeScolaire, valeur);
  const seances = grille.seances.filter((s) => s.formateurMatricule === matricule);
  const codes = [...new Set(seances.map((s) => String(s.module ?? '').trim()).filter(Boolean))];

  return {
    ...grille,
    seances,
    modules: await intitulesModules(codes),
    /*
     * ⚠️ LES STAGES DE SES COLLÈGUES N'ONT RIEN À FAIRE ICI : un stage ferme un
     * GROUPE, jamais un formateur — la liste ne le concerne pas. Les
     * FORMATIONS, elles, sont réduites à la sienne : sans ce filtre, la carte
     * au survol nommerait les collègues en formation ce jour-là.
     */
    jours: grille.jours.map((jour) => ({
      ...jour,
      stages: [],
      formations: jour.formations.filter((f) => f.matricule === matricule),
    })),
  };
}

/**
 * La semaine d'UN stagiaire : les groupes où il est inscrit — le principal, et
 * ceux d'une éventuelle formation qualifiante.
 *
 * ⚠️ ELLE REND AUSSI LES NOMS DES FORMATEURS. La grille détaillée, sur l'axe
 * « groupe », affiche une ligne « Formateur » — sans cette table, elle
 * n'aurait que des matricules à montrer. Ce ne sont que des noms : le
 * trousseau des formateurs de l'établissement n'est pas une donnée sensible
 * pour un stagiaire qui les croise chaque semaine.
 */
export async function emploiStagiaire(etablissementId, anneeScolaire, valeur, groupes) {
  const [grille, base] = await Promise.all([
    seancesService.semaine(etablissementId, anneeScolaire, valeur),
    Base.findOne({ etablissementId, anneeScolaire }).select('formateurs').lean(),
  ]);

  const concerne = (groupeSeance) => separerFusion(groupeSeance).some((g) => groupes.includes(g));
  const seances = grille.seances.filter((s) => concerne(s.groupe));
  const codes = [...new Set(seances.map((s) => String(s.module ?? '').trim()).filter(Boolean))];

  return {
    ...grille,
    seances,
    modules: await intitulesModules(codes),
    jours: grille.jours.map((jour) => ({
      ...jour,
      stages: jour.stages.filter((s) => groupes.includes(s.groupe)),
      formations: [],
    })),
    formateurs: (base?.formateurs ?? [])
      .filter((f) => String(f.matricule ?? '').trim() !== '')
      .map((f) => ({ matricule: f.matricule, nom: f.nomComplet })),
  };
}

/**
 * ═══ LE RÉALISÉ eDTpro DES SESSIONS = LES SÉANCES TERMINÉES ═══ (2026-09-12,
 * demande du porteur.) Recalculé à CHAQUE appel : figé au chargement du module,
 * l'instant serait celui du démarrage du serveur.
 *
 * ⚠️ L'HEURE EST CELLE DU SERVEUR, lue en heure LOCALE — comme toutes les dates
 * de ce projet (`enJour`, `semaineCourante`). Un serveur réglé sur UTC jugerait
 * les séances avec une heure de retard sur le Maroc : à régler au déploiement
 * (fuseau `Africa/Casablanca`), pas en corrigeant ici.
 */
const SEANCES_TERMINEES = () => ({ maintenant: instantLocal(new Date()) });

/** Le nom affiché de chaque formateur, comme le fait `avancement.service.js`. */
function nomsParIdentifiant(base) {
  const table = new Map();
  for (const formateur of base.formateurs ?? []) {
    const nom = String(formateur.nomComplet ?? '').trim();
    if (nom === '') continue;
    for (const cle of [formateur.matricule, formateur.nomUnique, formateur.nomComplet]) {
      const identifiant = String(cle ?? '').trim();
      if (identifiant !== '') table.set(identifiant, nom);
    }
  }
  return table;
}

/**
 * L'avancement d'UN formateur : ses lignes seules, dans les deux faces.
 *
 * ⚠️ ON RECONNAÎT « SES » LIGNES PAR SON NOM AFFICHÉ, pas son matricule : les
 * lignes d'avancement portent déjà `formateurPresentiel` / `formateurSynchrone`
 * résolus en noms par `avancement.service.js` (les affectations, elles,
 * portent l'identifiant — mais le convertir une seconde fois ici aurait
 * demandé de dupliquer la table de résolution). On la reconstruit donc une
 * fois, pour traduire SON PROPRE matricule dans le même vocabulaire que la
 * réponse déjà reçue.
 */
export async function avancementFormateur(etablissementId, anneeScolaire, observation, matricule) {
  const [complet, base] = await Promise.all([
    avancementService.avancement(etablissementId, anneeScolaire, observation, SEANCES_TERMINEES()),
    Base.findOne({ etablissementId, anneeScolaire }).select('formateurs').lean(),
  ]);

  const monNom = nomsParIdentifiant(base ?? { formateurs: [] }).get(matricule) ?? matricule;
  const estMoi = (ligne) => ligne.formateurPresentiel === monNom || ligne.formateurSynchrone === monNom;

  return {
    ...complet,
    // ⚠️ Sa MASSE STATUTAIRE seule : celle des autres formateurs ne le regarde
    // pas, et la table entière révélerait la charge de tout l'établissement.
    statutaires: monNom in complet.statutaires ? { [monNom]: complet.statutaires[monNom] } : {},
    faces: {
      edtpro: complet.faces.edtpro.filter(estMoi),
      enote: complet.faces.enote.filter(estMoi),
    },
  };
}

/** L'avancement d'UN stagiaire : les lignes de son ou ses groupes. */
export async function avancementStagiaire(etablissementId, anneeScolaire, observation, groupes) {
  const complet = await avancementService.avancement(
    etablissementId,
    anneeScolaire,
    observation,
    SEANCES_TERMINEES()
  );
  const estMonGroupe = (ligne) => groupes.includes(ligne.groupe);

  return {
    ...complet,
    // Les masses statutaires des formateurs ne concernent pas un stagiaire.
    statutaires: {},
    faces: {
      edtpro: complet.faces.edtpro.filter(estMonGroupe),
      enote: complet.faces.enote.filter(estMonGroupe),
    },
  };
}

/**
 * Les affectations d'UN formateur : ce qu'il enseigne, et combien d'heures.
 * ← le panneau « affectationFormateur.html », réduit à une lecture — la carte
 * elle-même ne se modifie que depuis « Paramètres → Affectations ».
 */
export async function affectationsFormateur(etablissementId, anneeScolaire, matricule) {
  const base = await Base.findOne({ etablissementId, anneeScolaire })
    .select('affectations')
    .lean();

  if (!base) {
    throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });
  }

  const miennes = (base.affectations ?? []).filter(
    (a) => String(a.formateur ?? '').trim() === matricule
  );

  const codes = [...new Set(miennes.map((a) => String(a.module ?? '').trim()).filter(Boolean))];
  const references =
    codes.length > 0
      ? await Repartition.find({ codeModule: { $in: codes } }).select('codeModule module').lean()
      : [];
  // ⚠️ LE CHAMP LISIBLE S'APPELLE `module`, PAS `intitule` — c'est `codeModule`
  // qui porte le CODE. Une seule ligne par code : le référentiel en porte
  // plusieurs (une par filière), et deux lectures ne doivent pas rendre deux
  // noms différents pour la même personne.
  const intitules = Object.fromEntries(references.map((r) => [r.codeModule, r.module]));

  /*
   * ═══ ⚠️ UNE LIGNE PAR (GROUPE, MODULE), COMME « PROGRAMME » ═══ (2026-09-06,
   * demande du porteur : « le même style que la page mon programme ».) Le
   * présentiel et le synchrone sont DEUX affectations en base — une par `type` —
   * mais un seul module pour qui l'enseigne : deux lignes qui ne diffèrent que
   * par une icône se lisaient comme un doublon.
   *
   * ═══ ⚠️⚠️ ET ON N'ÉCLATE PAS LA FUSION ICI, contrairement à
   * `programmeStagiaire` ═══ Une affectation synchrone porte le libellé de
   * l'ENSEMBLE (« GM101 GM102 ») : le GROUPE reçoit bien ces heures en entier,
   * d'où l'éclatement côté stagiaire — mais le FORMATEUR ne les donne QU'UNE
   * FOIS. Les éclater ici doublerait sa charge synchrone dans le total, et c'est
   * exactement le défaut déjà corrigé quatre fois (bilan de charge, bouton
   * « Charge », feuille du classeur, masses du chronogramme). Le libellé
   * d'ensemble reste donc tel quel dans la colonne « Groupe » — il DIT que la
   * séance couvre les deux.
   */
  const lignes = new Map();

  for (const a of miennes) {
    const module = String(a.module ?? '').trim();
    if (module === '') continue;

    const cle = `${a.groupe}||${module}`;
    if (!lignes.has(cle)) {
      lignes.set(cle, {
        groupe: a.groupe,
        module,
        intitule: intitules[module] ?? '',
        presentiel: 0,
        synchrone: 0,
        estRegional: false,
        heuresS1: 0,
        heuresS2: 0,
      });
    }

    const ligne = lignes.get(cle);
    const s1 = a.s1Heures ?? 0;
    const s2 = a.s2Heures ?? 0;

    ligne.heuresS1 += s1;
    ligne.heuresS2 += s2;
    ligne.estRegional = ligne.estRegional || Boolean(a.estRegional);

    if (a.type === TYPES_COURS.SYNCHRONE) ligne.synchrone += s1 + s2;
    else ligne.presentiel += s1 + s2;
  }

  return {
    anneeScolaire,
    affectations: [...lignes.values()]
      .map((ligne) => ({
        ...ligne,
        // ⚠️ LA MÊME RÈGLE QUE LES DEUX FACES DE L'AVANCEMENT : le semestre se
        // DÉDUIT des masses, il n'est écrit nulle part. Deux règles classeraient
        // le même module en S1 ici et en annuel ailleurs.
        semestre: semestreDe(ligne.heuresS1, ligne.heuresS2),
      }))
      .sort((a, b) => a.groupe.localeCompare(b.groupe, 'fr') || a.module.localeCompare(b.module, 'fr')),
  };
}

/**
 * Le PROGRAMME d'un stagiaire — la « table des matières » de son année.
 * ← `tableMatieres.html` (1 112 l.), entrée « Programme » du menu stagiaire de
 *   l'existant (2026-09-05, demande du porteur).
 *
 * ═══ ⚠️ LA MÊME SOURCE QUE « MES AFFECTATIONS », L'AUTRE MOITIÉ DE LA QUESTION
 * ═══ Un formateur demande « qu'est-ce que j'enseigne » ; un stagiaire, « qu'est-ce
 * qu'on m'enseigne ». C'est la MÊME table `Base.affectations`, lue par l'autre
 * bout — d'où la reprise mot pour mot de `affectationsFormateur` : même
 * résolution d'intitulés, même tri, mêmes champs. Passer par l'avancement
 * (`avancementStagiaire`) aurait donné les mêmes chiffres au prix du parcours
 * de TOUTES les séances de l'année, pour une page qui n'affiche aucun réalisé.
 *
 * ⚠️ UNE LIGNE PAR (GROUPE, MODULE), PAS PAR MODULE SEUL. L'existant n'avait
 * pas la question : il filtrait sur UN groupe (`row[8] === userGroup`) et
 * dédoublonnait par code de module. Ici un stagiaire peut être inscrit à deux
 * groupes — son tronc diplômant et une FQ (`Stagiaire.groupes`, 2026-08-19) —
 * et cumuler leurs heures sous un seul code gonflerait la masse horaire d'un
 * programme qu'il suit bel et bien deux fois.
 *
 * ⚠️ LE PRÉSENTIEL ET LE SYNCHRONE SE RÉUNISSENT SUR LA MÊME LIGNE : ce sont
 * deux affectations distinctes en base (une par `type`), mais un seul module
 * pour qui le suit — c'est déjà ce que montrait l'existant, qui affichait les
 * deux masses dans une seule cellule.
 *
 * ⚠️ AUCUN DÉDOUBLONNAGE DU SYNCHRONE MUTUALISÉ : une séance donnée à deux
 * groupes à la fois, le GROUPE la reçoit en entier — c'est la règle déjà tenue
 * par `lignesDepuisAffectations` côté groupe. Le dédoublonnage ne vaut que pour
 * la charge d'un FORMATEUR, qui ne la donne qu'une fois.
 */
export async function programmeStagiaire(etablissementId, anneeScolaire, groupes) {
  const base = await Base.findOne({ etablissementId, anneeScolaire })
    .select('affectations formateurs')
    .lean();

  if (!base) {
    throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });
  }

  const noms = nomsParIdentifiant(base);
  const nomDe = (identifiant) => {
    const brut = String(identifiant ?? '').trim();
    return brut === '' ? '' : (noms.get(brut) ?? brut);
  };

  const lignes = new Map();

  for (const affectation of base.affectations ?? []) {
    const module = String(affectation.module ?? '').trim();
    if (module === '') continue;

    const s1 = affectation.s1Heures ?? 0;
    const s2 = affectation.s2Heures ?? 0;
    const synchrone = affectation.type === TYPES_COURS.SYNCHRONE;

    /*
     * ⚠️ `separerFusion` EST INDISPENSABLE : une affectation synchrone porte le
     * libellé de l'ENSEMBLE (« GM101 GM102 »), jamais un groupe seul. Comparer
     * la chaîne entière ferait disparaître du programme tous les modules
     * mutualisés — c'est-à-dire ceux à distance.
     */
    for (const groupe of separerFusion(affectation.groupe)) {
      if (!groupes.includes(groupe)) continue;

      const cle = `${groupe}||${module}`;
      if (!lignes.has(cle)) {
        lignes.set(cle, {
          groupe,
          module,
          intitule: '',
          formateurPresentiel: '',
          formateurSynchrone: '',
          presentiel: 0,
          synchrone: 0,
          estRegional: false,
          heuresS1: 0,
          heuresS2: 0,
        });
      }

      const ligne = lignes.get(cle);
      ligne.heuresS1 += s1;
      ligne.heuresS2 += s2;
      ligne.estRegional = ligne.estRegional || Boolean(affectation.estRegional);

      if (synchrone) {
        ligne.synchrone += s1 + s2;
        ligne.formateurSynchrone = nomDe(affectation.formateur) || ligne.formateurSynchrone;
      } else {
        ligne.presentiel += s1 + s2;
        ligne.formateurPresentiel = nomDe(affectation.formateur) || ligne.formateurPresentiel;
      }
    }
  }

  const codes = [...new Set([...lignes.values()].map((ligne) => ligne.module))];
  const intitules = await intitulesModules(codes);

  return {
    anneeScolaire,
    groupes,
    modules: [...lignes.values()]
      .map(({ heuresS1, heuresS2, ...ligne }) => ({
        ...ligne,
        intitule: intitules[ligne.module] ?? '',
        // ⚠️ LE SEMESTRE SE DÉDUIT DES MASSES, par la MÊME fonction que les deux
        // faces de l'avancement : un module qui porte des heures des deux côtés
        // est ANNUEL. Deux règles auraient classé le même module différemment
        // d'un écran à l'autre.
        semestre: semestreDe(heuresS1, heuresS2),
      }))
      .sort(
        (a, b) =>
          a.groupe.localeCompare(b.groupe, 'fr') || a.module.localeCompare(b.module, 'fr')
      ),
  };
}

/**
 * Les groupes d'UN stagiaire, tels qu'inscrits par l'import Konosys.
 * ← `Stagiaire.groupes` (2026-08-19) : un stagiaire y est UN document, avec
 * toutes ses inscriptions — le tronc diplômant, et une éventuelle FQ.
 */
export async function groupesDuStagiaire(etablissementId, anneeScolaire, matricule) {
  /*
   * ═══ L'ANNÉE CONSULTÉE D'ABORD, LA PLUS RÉCENTE ENSUITE ═══ (2026-09-14)
   * Il y a une base Konosys par année. On prend celle de l'année que la session
   * consulte ; à défaut — la base de cette année n'est pas encore importée — la
   * plus récente où le stagiaire figure. Sans ce repli, un stagiaire dont la
   * direction n'a pas encore importé la rentrée tomberait sur « aucune fiche »
   * et verrait son emploi du temps vide.
   */
  const champs = 'groupes groupePrincipal nom prenom';
  const stagiaire =
    (await Stagiaire.findOne({ etablissementId, anneeScolaire, matricule }).select(champs).lean()) ??
    (await Stagiaire.findOne({ etablissementId, matricule })
      .sort({ anneeScolaire: -1 })
      .select(champs)
      .lean());

  if (!stagiaire) {
    throw notFound('Aucune fiche stagiaire pour ce compte', { code: 'STAGIAIRE_INTROUVABLE' });
  }

  return {
    groupes: stagiaire.groupes ?? [],
    groupePrincipal: stagiaire.groupePrincipal || stagiaire.groupes?.[0] || null,
  };
}
