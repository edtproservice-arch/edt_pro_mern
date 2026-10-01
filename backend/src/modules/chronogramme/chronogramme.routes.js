import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ROLES } from 'shared/constants';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { badRequest, forbidden } from '../../lib/httpError.js';
import * as service from './chronogramme.service.js';
import * as completude from './completude.service.js';
import * as completer from '../generation/completer.service.js';
import { exigerDroitPage } from '../partages/exigerDroitPage.js';
import { annoncerModification } from '../tempsReel/annonces.js';

/**
 * Chronogramme : planning annuel prévisionnel, par groupe (F7).
 * ← api/profile/get_chronogramme_data.php, save_chronogramme.php,
 *   get_chrono_status.php
 */
const router = Router();

/*
 * ═══ LE DROIT SUR LA PAGE DÉCIDE, PLUS LE RÔLE (Phase 5bis, étape d2) ═══
 *   - lire, exporter      → `consulter`
 *   - enregistrer         → `modifier` (un invité « peut modifier »)
 *   - importer un classeur → le DIRECTEUR seul : comme l'import d'une semaine
 *     d'emploi du temps, il réécrit plusieurs groupes d'un coup.
 *
 * ⚠️ Le gestionnaire perd l'accès par son seul RÔLE, que l'écran ne lui ouvrait
 * pas depuis le 2026-09-03 ; il le retrouve s'il est invité.
 */
router.use(
  authenticate,
  requireRole(ROLES.DIRECTEUR, ROLES.GESTIONNAIRE, ROLES.FORMATEUR),
  resolveTenant
);

const lire = exigerDroitPage('chronogramme', 'consulter');
const modifier = exigerDroitPage('chronogramme', 'modifier');

/** Le planning change l'avancement (le « planifié ») : les deux salles relisent. */
const PAGES_DU_CHRONOGRAMME = ['chronogramme', 'avancement'];

const nomGroupe = z.object({
  // Les noms de groupe portent des espaces et des parenthèses — « ACADA101 (FQ) ».
  groupe: z.string().trim().min(1).max(60),
});

/**
 * Planning envoyé par l'écran.
 *
 * ⚠️ Les clés de semaine sont validées comme des ENTIERS de 1 à 45 : sans cette
 * borne, une clé fantaisiste entrerait en base et produirait une colonne que la
 * grille ne sait pas afficher — une donnée invisible, donc jamais corrigée.
 */
const planningSchema = z.object({
  // La version du planning que l'écran a lue (étape d3) — voir `lib/versionOptimiste.js`.
  version: z.number().int().min(0).optional(),
  planning: z.record(
    z.string().trim().min(1).max(60),
    z.record(
      z.string().regex(/^([1-9]|[1-3][0-9]|4[0-5])$/, 'Semaine hors des 45 de l’année'),
      z
        .object({
          heures: z.coerce.number().min(0).max(20),
          /*
           * ⚠️ « PS » = case MIXTE (2026-10-01) : présentiel ET synchrone la même
           * semaine. Ses deux parts DOIVENT être déclarées ici — zod retire les
           * clés inconnues, et une case mixte sans ses parts arriverait vide en
           * base, sans erreur.
           */
          type: z.enum(['P', 'S', 'PS']),
          presentiel: z.coerce.number().min(0).max(20).optional(),
          synchrone: z.coerce.number().min(0).max(20).optional(),
        })
        .refine(
          (cellule) =>
            cellule.type !== 'PS' ||
            (cellule.presentiel > 0 &&
              cellule.synchrone > 0 &&
              Math.abs(cellule.presentiel + cellule.synchrone - cellule.heures) < 0.01),
          'Case mixte : les parts présentiel et synchrone doivent faire le total'
        )
    )
  ),
});

/**
 * Le fichier reste EN MÉMOIRE — jamais sur disque.
 *
 * Un classeur de chronogramme pèse quelques centaines de kilo-octets et son
 * contenu part directement en base. Écrire un fichier temporaire n'apporterait
 * qu'un répertoire à purger et une fuite de données possible.
 */
const televersement = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, fichier, suite) => {
    // Le type MIME du navigateur n'est pas fiable : on se fie à l'extension, et
    // la lecture refusera de toute façon un contenu qui n'est pas un classeur.
    if (!/\.xlsx?$/i.test(fichier.originalname)) {
      suite(badRequest('Format attendu : .xlsx ou .xls', { code: 'FORMAT_REFUSE' }));
      return;
    }
    suite(null, true);
  },
});

const exportSchema = z.object({
  mode: z.enum(['groupe', 'formateur']).default('groupe'),
  // Au moins un sujet : un classeur vide n'a rien à dire, et le produire
  // laisserait croire que l'export a fonctionné.
  sujets: z.array(z.string().trim().min(1).max(120)).min(1).max(60),
});

/**
 * Classeur d'export — un onglet par sujet.
 *
 * En POST et non en GET : la liste des sujets peut compter soixante noms avec
 * espaces et parenthèses, et une URL les tronquerait sans le dire.
 */
router.post('/export', lire, validate({ body: exportSchema }), async (req, res, next) => {
  try {
    const classeur = await service.exporter(req.etablissementId, req.anneeScolaire, req.body);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="chronogramme-${req.body.mode}-${req.anneeScolaire}.xlsx"`
    );
    res.send(classeur);
  } catch (error) {
    next(error);
  }
});

/**
 * Relecture d'un classeur.
 *
 * ⚠️ Réservé au DIRECTEUR, comme l'enregistrement : un import touche plusieurs
 * groupes d'un coup.
 */
router.post(
  '/import',
  requireRole(ROLES.DIRECTEUR),
  televersement.single('fichier'),
  async (req, res, next) => {
    try {
      if (!req.file) throw badRequest('Aucun fichier reçu', { code: 'FICHIER_ABSENT' });

      const bilan = await service.importer(
        req.etablissementId,
        req.anneeScolaire,
        req.file.buffer,
        req.file.originalname
      );

      res.json({ success: true, ...bilan });
      annoncerModification(req, PAGES_DU_CHRONOGRAMME, { action: 'importer' });
    } catch (error) {
      next(error);
    }
  }
);

/** Groupes de l'année et état de leur chronogramme. */
router.get('/', lire, async (req, res, next) => {
  try {
    const groupes = await service.listerGroupes(req.etablissementId, req.anneeScolaire);
    res.json({ success: true, groupes, anneeScolaire: req.anneeScolaire });
  } catch (error) {
    next(error);
  }
});

/**
 * L'emploi du temps est-il lié au chronogramme ? (2026-09-27)
 * ← `api/profile/get_chrono_status.php`
 *
 * ⚠️ DÉCLARÉE AVANT `/:groupe`, comme « charge » et « completude ».
 *
 * ⚠️ EN LECTURE : tout le monde doit savoir si le verrou mord — c'est ce qui
 *    explique un refus de saisie, et un formateur invité y a droit autant que
 *    le directeur.
 */
router.get('/liaison', lire, async (req, res, next) => {
  try {
    const etat = await completude.etatLiaison(req.etablissementId, req.anneeScolaire);
    res.json({ success: true, ...etat });
  } catch (error) {
    next(error);
  }
});

/**
 * Associe ou dissocie l'emploi du temps et le chronogramme.
 * ← `api/profile/set_liaison_chronogramme.php`
 *
 * ═══ ⚠️ `liee` N'A PAS DE VALEUR PAR DÉFAUT ═══
 * Zod l'exige explicitement. Un défaut ferait basculer l'établissement dans un
 * état qu'il n'a pas demandé sur une requête malformée — et dissocier lève le
 * verrou pour TOUT LE MONDE.
 *
 * ═══ ⚠️ LE DIRECTEUR SEUL, DIVERGENCE ASSUMÉE AVEC L'ANCIEN ═══
 * `set_liaison_chronogramme.php` se contente d'une session avec un
 * établissement, donc le gestionnaire aussi. Mais ce réglage change la règle de
 * saisie de TOUTE la grille, pour tous : c'est la même portée qu'un import de
 * classeur, que ce module réserve déjà au directeur.
 */
router.put(
  '/liaison',
  requireRole(ROLES.DIRECTEUR),
  modifier,
  validate({ body: z.object({ liee: z.boolean() }) }),
  async (req, res, next) => {
    try {
      const etat = await completude.definirLiaison(
        req.etablissementId,
        req.anneeScolaire,
        req.body.liee
      );
      annoncerModification(req, PAGES_DU_CHRONOGRAMME);
      res.json({ success: true, ...etat });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Reporte dans le chronogramme les séances déjà posées dans l'emploi du temps.
 * ← `api/profile/reporter_emploi_vers_chronogramme.php`
 *
 * ⚠️ `simulation: true` PAR DÉFAUT. Le report touche plusieurs groupes et
 *    réécrit des volumes : annoncer l'ampleur APRÈS coup n'est pas une
 *    confirmation. Une requête qui oublie le drapeau ne fait que compter.
 *
 * ⚠️ AU DIRECTEUR SEUL, comme l'import de classeur : il réécrit le
 *    chronogramme de plusieurs groupes d'un geste.
 */
router.post(
  '/report',
  requireRole(ROLES.DIRECTEUR),
  modifier,
  validate({ body: z.object({ simulation: z.boolean().default(true) }) }),
  async (req, res, next) => {
    try {
      const bilan = await completude.reporter(req.etablissementId, req.anneeScolaire, {
        simulation: req.body.simulation,
      });
      if (!bilan.simulation) annoncerModification(req, PAGES_DU_CHRONOGRAMME);
      res.json({ success: true, ...bilan });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Complétude de l'emploi du temps face au chronogramme.
 * ← `api/data/get_completude.php`
 *
 *   ?semaine=2026-W9 → bilan DÉTAILLÉ de la semaine, écarts module par module
 *   (sans paramètre)  → un taux par semaine, pour le calendrier
 *
 * ⚠️ DÉCLARÉE AVANT `/:groupe`, comme « charge » et « par-formateur » : Express
 *    retient la PREMIÈRE route qui correspond, et placée après elle serait
 *    captée par `/:groupe`, qui chercherait un groupe nommé « completude ».
 *
 * ⚠️ EN LECTURE (`consulter`) : ce bilan n'écrit rien. Un formateur invité doit
 *    pouvoir constater l'écart sur ses groupes sans pouvoir toucher à la grille.
 */
router.get(
  '/completude',
  lire,
  validate({ query: z.object({ semaine: z.string().trim().max(20).optional() }) }),
  async (req, res, next) => {
    try {
      const { semaine } = req.validatedQuery;

      const bilan = semaine
        ? await completude.completudeDUneSemaine(req.etablissementId, req.anneeScolaire, semaine)
        : await completude.completudeDeLAnnee(req.etablissementId, req.anneeScolaire);

      res.json({ success: true, ...bilan });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Place les séances « À placer » de la fenêtre de conformité (2026-09-27).
 * Voir `generation/completer.service.js`.
 *
 * ⚠️ `simulation: true` PAR DÉFAUT, comme le report : l'écran montre d'abord ce
 *    qui serait posé — et où, et sans quelle salle —, puis confirme.
 *
 * ⚠️ AU DIRECTEUR SEUL, comme la génération : ce geste écrit la grille depuis le
 *    chronogramme en passant outre le verrou des volumes.
 */
router.post(
  '/completude/placer',
  requireRole(ROLES.DIRECTEUR),
  validate({
    body: z.object({
      semaine: z.string().trim().min(1).max(20),
      simulation: z.boolean().default(true),
    }),
  }),
  async (req, res, next) => {
    try {
      const bilan = await completer.completerSemaine(
        req.etablissementId,
        req.anneeScolaire,
        req.body.semaine,
        { simulation: req.body.simulation }
      );
      if (!bilan.simulation && bilan.total.placees > 0) {
        annoncerModification(req, ['emploi', 'absences', 'avancement'], {
          semaine: bilan.semaine,
        });
      }
      res.json({ success: true, ...bilan });
    } catch (error) {
      next(error);
    }
  }
);

/*
 * ⚠️ LES DEUX ROUTES « par-formateur » SE DÉCLARENT AVANT `/:groupe`.
 * Express retient la PREMIÈRE route qui correspond : placées après, elles
 * seraient captées par `/:groupe`, qui chercherait alors un groupe nommé
 * « par-formateur » et répondrait 404 sur une route pourtant écrite.
 */

/**
 * Charge hebdomadaire de TOUS les formateurs et de TOUS les groupes.
 *
 * ⚠️ Déclarée AVANT `/:groupe`, comme « par-formateur » : sinon elle serait
 * captée par lui, qui chercherait un groupe nommé « charge ».
 */
router.get('/charge', lire, async (req, res, next) => {
  try {
    const bilan = await service.charge(req.etablissementId, req.anneeScolaire);
    res.json({ success: true, ...bilan });
  } catch (error) {
    next(error);
  }
});

/**
 * Modules partagés entre présentiel et synchrone (« À traiter » de l'accueil).
 *
 * ⚠️ Déclarée AVANT `/:groupe`, comme « charge ». Un FORMATEUR n'y voit que les
 * modules où il intervient — même règle que la liste ci-dessous.
 */
router.get('/partages-type', lire, async (req, res, next) => {
  try {
    let partages = await service.partagesParType(req.etablissementId, req.anneeScolaire);
    if (req.utilisateur.role === ROLES.FORMATEUR) {
      const moi = String(req.utilisateur.identifiant ?? '').trim().toUpperCase();
      const estMoi = (personne) => String(personne.identifiant).trim().toUpperCase() === moi;
      partages = partages.filter(
        (partage) => partage.presentiel.some(estMoi) || partage.synchrone.some(estMoi)
      );
    }
    res.json({ success: true, partages });
  } catch (error) {
    next(error);
  }
});

/**
 * Formateurs de l'année, pour le sélecteur du mode formateur.
 *
 * ⚠️ UN FORMATEUR N'Y VOIT QUE LUI-MÊME (2026-09-22, demande du porteur : « l'envoi du
 * chronogramme ne veut pas dire qu'il a partagé l'écran »). Le droit accordé par « Envoyer »
 * porte sur la PAGE entière — comme tout partage — mais ouvrir ce droit à la liste complète des
 * formateurs reviendrait à lui donner la vue du directeur sur tout l'établissement. Le
 * DIRECTEUR et le GESTIONNAIRE, eux, gardent la liste entière : c'est leur écran de pilotage.
 */
router.get('/par-formateur', lire, async (req, res, next) => {
  try {
    let formateurs = await service.listerFormateurs(req.etablissementId, req.anneeScolaire);
    if (req.utilisateur.role === ROLES.FORMATEUR) {
      const moi = String(req.utilisateur.identifiant ?? '').trim().toUpperCase();
      formateurs = formateurs.filter((f) => String(f.identifiant).trim().toUpperCase() === moi);
    }
    res.json({ success: true, formateurs, anneeScolaire: req.anneeScolaire });
  } catch (error) {
    next(error);
  }
});

/**
 * « Envoyer à tous » : le même envoi que ci-dessous, pour chaque formateur de l'année en un
 * clic (2026-09-22, demande du porteur).
 *
 * ⚠️ DÉCLARÉE AVANT `/par-formateur/:formateur/envoyer` : sans quoi Express y capturerait
 * « tous » comme un matricule de formateur, et cette route ne répondrait jamais.
 */
router.post('/par-formateur/tous/envoyer', requireRole(ROLES.DIRECTEUR), async (req, res, next) => {
  try {
    const resultat = await service.envoyerATousLesFormateurs(
      req.etablissementId,
      req.anneeScolaire,
      req.utilisateur
    );
    res.json({ success: true, ...resultat });
  } catch (error) {
    next(error);
  }
});

/**
 * Grille d'un formateur : ses modules dans TOUS les groupes où il intervient.
 *
 * ⚠️ UN FORMATEUR N'Y ACCÈDE QUE POUR LUI-MÊME, même avec le droit « modifier » sur la page —
 * ce droit lui vient de « Envoyer », il ne lui ouvre pas la grille de ses collègues (même
 * raison que la liste ci-dessus).
 */
router.get(
  '/par-formateur/:formateur',
  lire,
  validate({ params: z.object({ formateur: z.string().trim().min(1).max(120) }) }),
  async (req, res, next) => {
    try {
      if (req.utilisateur.role === ROLES.FORMATEUR) {
        const moi = String(req.utilisateur.identifiant ?? '').trim().toUpperCase();
        if (String(req.params.formateur).trim().toUpperCase() !== moi) {
          throw forbidden('Vous ne pouvez consulter que votre propre chronogramme', {
            code: 'CHRONOGRAMME_AUTRUI',
          });
        }
      }
      const grille = await service.obtenirParFormateur(
        req.etablissementId,
        req.anneeScolaire,
        req.params.formateur
      );
      res.json({ success: true, ...grille });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Envoie à ce formateur son chronogramme à remplir (2026-09-22, demande du porteur) : il
 * obtient le droit de modifier la page, et reçoit un message dédié.
 *
 * ⚠️ RÉSERVÉ AU DIRECTEUR, COMME LE PARTAGE : c'est `inviterSurPage` qui accorde le droit, et
 * lui-même n'est ouvert qu'au directeur.
 */
router.post(
  '/par-formateur/:formateur/envoyer',
  requireRole(ROLES.DIRECTEUR),
  validate({ params: z.object({ formateur: z.string().trim().min(1).max(120) }) }),
  async (req, res, next) => {
    try {
      const resultat = await service.envoyerAuFormateur(
        req.etablissementId,
        req.anneeScolaire,
        req.utilisateur,
        req.params.formateur
      );
      res.json({ success: true, ...resultat });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Renvoie au directeur le chronogramme d'UN formateur, pour validation (2026-09-22, demande du
 * porteur : « après le formateur rempli le chronogramme, il renvoie au directeur pour valider »).
 *
 * ⚠️ RÉSERVÉ AU FORMATEUR, ET SEULEMENT LE SIEN — le service vérifie que `:formateur` est bien
 * SON PROPRE matricule : sans ce contrôle, n'importe quel invité « peut modifier » pourrait
 * soumettre le travail d'un collègue à sa place.
 */
router.post(
  '/par-formateur/:formateur/renvoyer',
  requireRole(ROLES.FORMATEUR),
  modifier,
  validate({ params: z.object({ formateur: z.string().trim().min(1).max(120) }) }),
  async (req, res, next) => {
    try {
      const resultat = await service.renvoyerAuDirecteur(
        req.etablissementId,
        req.anneeScolaire,
        req.utilisateur,
        req.params.formateur
      );
      res.json({ success: true, ...resultat });
    } catch (error) {
      next(error);
    }
  }
);

/** Grille complète d'un groupe : modules, semaines et planning. */
router.get('/:groupe', lire, validate({ params: nomGroupe }), async (req, res, next) => {
  try {
    const grille = await service.obtenir(
      req.etablissementId,
      req.anneeScolaire,
      req.params.groupe
    );
    res.json({ success: true, ...grille });
  } catch (error) {
    next(error);
  }
});

/**
 * Enregistrement — remplacement intégral du planning du groupe.
 *
 * Au DIRECTEUR et aux invités « peut modifier » (étape d2) : le chronogramme
 * sert de référence au « planifié » de l'avancement, et la génération d'emploi
 * du temps le lit — d'où un droit explicite, jamais le seul rôle.
 */
router.put(
  '/:groupe',
  modifier,
  validate({ params: nomGroupe, body: planningSchema }),
  async (req, res, next) => {
    try {
      const bilan = await service.enregistrer(
        req.etablissementId,
        req.anneeScolaire,
        req.params.groupe,
        req.body.planning,
        req.body.version
      );
      res.json({ success: true, ...bilan });
      /*
       * ═══ LE PLANNING VOYAGE AVEC L'ANNONCE (2026-09-13) ═══ Les collègues
       * sur la page l'appliquent tel quel, avec sa version, au lieu de relire
       * le groupe : la cellule change chez eux à l'instant, sans aller-retour.
       * Un planning de groupe pèse ~2 Ko. L'avancement, lui, n'en a que faire :
       * son annonce reste nue.
       */
      annoncerModification(req, 'chronogramme', {
        action: 'enregistrer',
        groupe: req.params.groupe,
        planning: bilan.planning,
        version: bilan.version,
      });
      annoncerModification(req, 'avancement', { action: 'enregistrer', groupe: req.params.groupe });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
