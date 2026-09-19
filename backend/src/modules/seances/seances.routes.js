import { Router } from 'express';
import { z } from 'zod';
import { JOURS, PERIODES, ROLES, SEANCES } from 'shared/constants';
/* ⚠️ `SEANCES_JOUR` vit dans le DOMAINE, pas dans les constantes : c'est une
   règle de grille (S5 est le créneau du soir), pas une liste brute. */
import { SEANCES_JOUR } from 'shared/domain';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import * as service from './seances.service.js';
import { annoncerModification } from '../tempsReel/annonces.js';
import { exigerDroitPage } from '../partages/exigerDroitPage.js';

/**
 * Emploi du temps hebdomadaire (F5, F8).
 * ← api/data/get_timetable.php, get_all_timetables.php, save_timetable.php
 *
 * ⚠️ LECTURE SEULE pour l'instant : aucune route n'écrit. L'édition arrive en
 * sous-livraison (b) — la page la plus utilisée du SaaS ne se remplace pas d'un
 * bloc sans point de contrôle.
 */
const router = Router();

/*
 * ═══ ⚠️ LE RÔLE NE SUFFIT PLUS : C'EST LE DROIT SUR LA PAGE QUI DÉCIDE ═══
 * (2026-09-12, Phase 5bis — invitations.) Un formateur INVITÉ lit et modifie
 * l'emploi du temps ; un formateur non invité non. Le routeur admet donc les
 * trois rôles qui peuvent y avoir accès, puis chaque route exige un DROIT :
 *   - lire          → `consulter`  (directeur, gestionnaire par son rôle, invités)
 *   - poser, vider  → `modifier`   (directeur, invités « peut modifier »)
 *   - publier, importer, réinitialiser → le DIRECTEUR seul (décision du
 *     2026-09-12) : ces gestes touchent des semaines entières, ou ce que voient
 *     formateurs et stagiaires.
 *   - planifier un EFM → `modifier` sur la page EFM (étape d2), qui se partage
 *     à part.
 *
 * ⚠️ CONSÉQUENCE ASSUMÉE POUR LE GESTIONNAIRE : il pouvait jusqu'ici ÉCRIRE par
 * son seul rôle, alors que l'écran ne lui ouvre que « Édition » depuis le
 * 2026-09-03. Le serveur rejoint enfin l'écran : il écrit s'il est invité.
 *
 * `requireRole` reste AVANT `resolveTenant` : un administrateur doit recevoir un
 * 403, pas un 400 « établissement absent ».
 */
router.use(
  authenticate,
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR),
  resolveTenant
);

const lire = exigerDroitPage('emploi', 'consulter');
const modifier = exigerDroitPage('emploi', 'modifier');
const directeurSeul = requireRole(ROLES.DIRECTEUR);

/*
 * ═══ L'« EFM RÉGIONAL » LIT L'EMPLOI DU TEMPS (étape d2) ═══
 * Planifier un examen demande la composition des groupes, les modules
 * régionaux et l'OCCUPATION de la semaine — sans quoi l'écran ne sait pas quels
 * surveillants sont libres. Ces trois lectures s'ouvrent donc à qui détient un
 * droit sur L'UNE des deux pages ; l'écriture de l'examen, elle, n'exige que la
 * page EFM : un invité de l'emploi du temps n'y planifie rien pour autant.
 */
const lireEmploiOuEfm = exigerDroitPage(['emploi', 'efm'], 'consulter');

/*
 * ⚠️ UNE SÉANCE ÉCRITE CONCERNE QUATRE SALLES : l'emploi du temps, les absences
 * (le registre SUIT le statut des séances), l'avancement (heures posées) et
 * l'EFM (occupation des surveillants). Toutes relisent.
 */
const PAGES_DES_SEANCES = ['emploi', 'absences', 'avancement', 'efm'];

/** Formateurs, groupes et salles : ce qui ne change pas d'une semaine à l'autre. */
router.get('/contexte', lireEmploiOuEfm, async (req, res, next) => {
  try {
    const donnees = await service.contexte(req.etablissementId, req.anneeScolaire);
    res.json({ success: true, ...donnees });
  } catch (error) {
    next(error);
  }
});

/**
 * Publier la semaine qui FAIT FOI. ← `publish_timetable.php`
 *
 * ═══ ⚠️ LE DIRECTEUR SEUL — ET C'EST UN GARDE DE ROUTE, PAS D'ÉCRAN ═══
 * (décision du porteur, 2026-09-06, conforme à l'existant.) Le routeur admet
 * aussi le GESTIONNAIRE : sans ce `requireRole` par route, il publierait.
 *
 * ⚠️ ET L'ANCIEN AVAIT LE DÉFAUT INVERSE : `emploi.html` montrait le bouton à
 * l'ADMIN (`role === 'director' || role === 'admin'`) quand le serveur le
 * refusait en 403 — un bouton qui échoue toujours. Ici l'écran lit le même rôle
 * que la route.
 */
router.put('/publication', directeurSeul, async (req, res, next) => {
  try {
    const resultat = await service.publier(
      req.etablissementId,
      req.anneeScolaire,
      req.body?.semaine,
      req.utilisateur?.id
    );
    res.json({ success: true, publication: resultat });
    annoncerModification(req, 'emploi', { action: 'publication', semaine: resultat?.semaine });
  } catch (error) {
    next(error);
  }
});

/** Retirer la publication — on retombe sur la règle du week-end. */
router.delete('/publication', directeurSeul, async (req, res, next) => {
  try {
    await service.depublier(req.etablissementId, req.anneeScolaire);
    res.json({ success: true, publication: null });
    annoncerModification(req, 'emploi', { action: 'publication' });
  } catch (error) {
    next(error);
  }
});

/**
 * Les semaines déjà remplies, pour la navigation.
 *
 * ═══ ⚠️ LA SEMAINE OUVERTE DÉPEND DU RÔLE, et cette route en sert DEUX ═══
 * (2026-09-06.) Le GESTIONNAIRE consulte (« Édition ») : il ouvre sur la
 * semaine PUBLIÉE, comme le formateur et le stagiaire. Le DIRECTEUR, lui,
 * PRÉPARE : le déplacer d'office sur ce qu'il vient de publier — ou sur la
 * semaine suivante un samedi après-midi — lui ferait perdre le fil de sa
 * saisie. C'est lui qui pose la référence, il ne la subit pas.
 */
router.get('/semaines', lire, async (req, res, next) => {
  try {
    const consulte = req.utilisateur?.role !== ROLES.DIRECTEUR;

    const [liste, publication] = await Promise.all([
      service.semaines(req.etablissementId, req.anneeScolaire),
      service.publicationCourante(req.etablissementId, req.anneeScolaire),
    ]);

    res.json({
      success: true,
      semaines: liste,
      courante: service.semaineCourante(req.anneeScolaire, new Date(), {
        semainePubliee: consulte ? (publication?.semaine ?? null) : null,
        regleWeekEnd: consulte,
      }),
      publication,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * La fiche d'un module pour un groupe : intitulé complet et avancement semaine
 * par semaine. Interrogée au SURVOL d'un code de module dans la grille.
 */
router.get(
  '/module',
  lire,
  validate({
    query: z.object({
      groupe: z.string().trim().min(1).max(120),
      module: z.string().trim().min(1).max(60),
    }),
  }),
  async (req, res, next) => {
    try {
      const fiche = await service.ficheModule(
        req.etablissementId,
        req.anneeScolaire,
        req.validatedQuery
      );
      res.json({ success: true, ...fiche });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Les modules régionaux d'un groupe, avec leur intitulé complet.
 * ← `get_chronogramme_data.php?groupe=`, filtré sur `est_regional`
 */
router.get(
  '/modules-regionaux',
  lireEmploiOuEfm,
  validate({ query: z.object({ groupe: z.string().trim().min(1).max(120) }) }),
  async (req, res, next) => {
    try {
      const donnees = await service.modulesRegionauxDuGroupe(
        req.etablissementId,
        req.anneeScolaire,
        req.validatedQuery.groupe
      );
      res.json({ success: true, ...donnees });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * ⚠️ « contexte », « semaines », « module » et « modules-regionaux » se
 * déclarent AVANT `/:semaine`.
 * Express retient la première route qui correspond : placées après, elles
 * seraient captées par `/:semaine`, qui chercherait une semaine ainsi nommée et
 * répondrait 404 sur une route pourtant écrite.
 */

/** Toutes les séances d'une semaine — jour ET soir. */
router.get(
  '/:semaine',
  lireEmploiOuEfm,
  // « 2026-W3 », avec ou sans zéro de remplissage : `normaliserValeurSemaine`
  // tranche ensuite. C'est la forme que l'existant a laissée en base.
  validate({ params: z.object({ semaine: z.string().trim().regex(/^\d{4}-W\d{1,3}$/i) }) }),
  async (req, res, next) => {
    try {
      const grille = await service.semaine(
        req.etablissementId,
        req.anneeScolaire,
        req.params.semaine
      );
      res.json({ success: true, ...grille });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Une séance à poser ou remplacer.
 *
 * ⚠️ Le CRÉNEAU identifie la séance — pas un `id`. C'est ce que l'écran
 * manipule : on clique une case, on choisit un groupe. Passer par un
 * identifiant obligerait le client à savoir si la case était déjà remplie.
 */
const seanceSchema = z.object({
  /*
   * ⚠️ L'IDENTIFIANT DIT « JE REMPLACE CELLE-CI ». Absent, la pose est une
   * CRÉATION — et un formateur déjà occupé sur ce créneau devient alors un
   * conflit, au lieu d'être déplacé en silence.
   */
  id: z.string().trim().length(24).optional(),
  jour: z.enum(JOURS),
  seance: z.enum(SEANCES),
  periode: z.nativeEnum(PERIODES).default(PERIODES.JOUR),
  formateurMatricule: z.string().trim().min(1).max(40),
  groupe: z.string().trim().min(1).max(120),
  module: z.string().trim().min(1).max(60),
  salle: z.string().trim().max(60).default(''),
  statut: z.enum(['planifie', 'absent', 'rattrape']).default('planifie'),
});

/** Le créneau seul, pour vider une case. */
const creneauSchema = seanceSchema.pick({
  jour: true,
  seance: true,
  periode: true,
  formateurMatricule: true,
});

const semaineParam = z.object({ semaine: z.string().trim().regex(/^\d{4}-W\d{1,3}$/i) });

/**
 * Pose ou remplace UNE séance.
 *
 * Réservé au DIRECTEUR et au GESTIONNAIRE — c'est déjà la règle du routeur.
 * Un conflit répond 409 avec le DÉTAIL de ce qui bloque, jamais un simple refus.
 */
router.put(
  '/:semaine/case',
  modifier,
  validate({ params: semaineParam, body: seanceSchema }),
  async (req, res, next) => {
    try {
      const seance = await service.poser(
        req.etablissementId,
        req.anneeScolaire,
        req.params.semaine,
        req.body
      );
      res.json({ success: true, seance });
      // ⚠️ `req.params.semaine`, pas `seance.semaine` : le présentateur ne la rend pas.
      annoncerModification(req, PAGES_DES_SEANCES, { action: 'poser', semaine: req.params.semaine });
    } catch (error) {
      next(error);
    }
  }
);

/** Vide une case. */
router.delete(
  '/:semaine/case',
  modifier,
  validate({ params: semaineParam, body: creneauSchema }),
  async (req, res, next) => {
    try {
      const bilan = await service.vider(
        req.etablissementId,
        req.anneeScolaire,
        req.params.semaine,
        req.body
      );
      res.json({ success: true, ...bilan });
      // Vider une case déjà vide ne change rien : personne n'a à relire.
      if (bilan.supprimee) {
        annoncerModification(req, PAGES_DES_SEANCES, { action: 'vider', semaine: req.params.semaine });
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Un geste entier — coller, couper, déplacer, défaire — en UNE requête.
 *
 * ═══ ⚠️ POURQUOI UN LOT (2026-09-19, signalé par le porteur : « lent, surtout
 * hébergé ») ═══
 * Le client enchaînait une requête par case, l'une après l'autre : coller
 * trente cases, c'était soixante allers-retours entre le navigateur et le
 * serveur, chacun payant la latence d'Internet. En local elle vaut ~1 ms et
 * personne ne la voyait ; hébergé, elle vaut 100 à 300 ms et le geste durait
 * dix secondes. Le lot supprime ces allers-retours — les écritures, elles,
 * restent EXACTEMENT celles de `poser` et `vider`, une à une et dans l'ordre :
 * mêmes contrôles (conflits, quota, rentrée, rattrapage), mêmes refus.
 *
 * ⚠️ EN SÉRIE, PAS EN PARALLÈLE. Les conflits se cherchent sur l'état courant :
 * lancer dix écritures ensemble les ferait toutes regarder la même photo
 * d'avant, et deux séances du même bloc pourraient atterrir sur la même salle.
 *
 * ⚠️ UN REFUS N'ARRÊTE PAS LE LOT. Chaque opération rend son propre résultat :
 * coller vingt cases dont une est en conflit doit poser les dix-neuf autres et
 * NOMMER celle qui a échoué — c'est déjà ce que faisait l'écran, case par case.
 */
const operationLotSchema = z
  .object({
    type: z.enum(['poser', 'vider', 'deplacer']),
    cle: z.string().max(200).optional(),
    seance: seanceSchema.optional(),
    creneau: creneauSchema.optional(),
    source: creneauSchema.optional(),
  })
  .refine(
    (op) =>
      op.type === 'vider' ? Boolean(op.creneau) : Boolean(op.seance) && (op.type !== 'deplacer' || Boolean(op.source)),
    { message: 'Opération incomplète' }
  );

const lotSchema = z.object({ operations: z.array(operationLotSchema).min(1).max(400) });

router.post(
  '/:semaine/lot',
  modifier,
  validate({ params: semaineParam, body: lotSchema }),
  async (req, res, next) => {
    try {
      const { resultats, dureeMs } = await service.ecrireLot(
        req.etablissementId,
        req.anneeScolaire,
        req.params.semaine,
        req.body.operations
      );
      // Visible dans l'onglet Réseau du navigateur : dit ce que le serveur a
      // consommé, donc ce qui reste de la latence du réseau.
      res.setHeader('Server-Timing', `lot;dur=${dureeMs}`);
      res.json({ success: true, resultats });

      // Une seule annonce pour tout le geste : les collègues relisent UNE fois.
      if (resultats.some((r) => r.ok && !r.inchangee)) {
        annoncerModification(req, PAGES_DES_SEANCES, { action: 'lot', semaine: req.params.semaine });
      }
    } catch (error) {
      next(error);
    }
  }
);

/** Copie une AUTRE semaine dans celle-ci. ← `importWeekBtn` de emploi.html */
router.post(
  '/:semaine/importer',
  directeurSeul,
  validate({
    params: semaineParam,
    body: z.object({ depuis: z.string().trim().regex(/^\d{4}-W\d{1,3}$/i) }),
  }),
  async (req, res, next) => {
    try {
      const bilan = await service.importerSemaine(
        req.etablissementId,
        req.anneeScolaire,
        req.params.semaine,
        req.body
      );
      res.json({ success: true, ...bilan });
      annoncerModification(req, PAGES_DES_SEANCES, { action: 'importer', semaine: req.params.semaine });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Planifie un EFM régional : une surveillance par surveillant et par créneau.
 * ← `api/profile/save_efm_regional.php`
 *
 * ⚠️ AU MOINS UN CRÉNEAU ET UN SURVEILLANT : sans l'un ou l'autre, l'examen
 * n'existe pas — c'est déjà le contrôle que faisait l'écran d'origine, mais lui
 * seul. Ici il est aussi côté serveur.
 */
router.post(
  '/:semaine/efm',
  // ⚠️ Plus le DIRECTEUR SEUL (étape d2) : un invité « peut modifier » de la
  // page EFM planifie. Les contrôles de conflit et de rentrée restent les mêmes.
  exigerDroitPage('efm', 'modifier'),
  validate({
    params: semaineParam,
    body: z.object({
      groupe: z.string().trim().min(1).max(100),
      module: z.string().trim().min(1).max(50),
      salle: z.string().trim().max(50).default(''),
      jour: z.enum(JOURS),
      /*
       * ⚠️ LES CRÉNEAUX DE JOUR SEULEMENT (S1 à S4), comme l'écran d'origine.
       * S5 est le créneau du SOIR : un examen posé là serait écrit en
       * `periode: jour` et n'apparaîtrait sur aucune des deux grilles.
       */
      creneaux: z.array(z.enum(SEANCES_JOUR)).min(1).max(SEANCES_JOUR.length),
      surveillants: z.array(z.string().trim().min(1).max(20)).min(1).max(50),
    }),
  }),
  async (req, res, next) => {
    try {
      const bilan = await service.planifierEfm(
        req.etablissementId,
        req.anneeScolaire,
        req.params.semaine,
        req.body
      );
      res.json({ success: true, ...bilan });
      annoncerModification(req, PAGES_DES_SEANCES, { action: 'efm', semaine: req.params.semaine });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Efface une semaine, ou l'année entière.
 * ← `effacerEmploiDuTemps()` de emploi.html
 *
 * ⚠️ EN POST, PAS EN DELETE, et hors de `/:semaine` : la portée « année » ne
 * porte sur aucune semaine en particulier, et la faire passer par une route de
 * semaine laisserait croire qu'elle s'y limite.
 */
router.post(
  '/reinitialiser',
  directeurSeul,
  validate({
    body: z
      .object({
        portee: z.enum(['semaine', 'annee']),
        semaine: z.string().trim().regex(/^\d{4}-W\d{1,3}$/i).optional(),
      })
      .refine(
        (valeurs) => valeurs.portee !== 'semaine' || Boolean(valeurs.semaine),
        'La portée « semaine » demande de dire laquelle'
      ),
  }),
  async (req, res, next) => {
    try {
      const bilan = await service.reinitialiser(
        req.etablissementId,
        req.anneeScolaire,
        req.body
      );
      res.json({ success: true, ...bilan });
      annoncerModification(req, PAGES_DES_SEANCES, {
        action: 'reinitialiser',
        portee: req.body.portee,
        semaine: req.body.portee === 'semaine' ? req.body.semaine : null,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
