import { Router } from 'express';
import { z } from 'zod';

import { MOTEURS, ROLES } from 'shared/constants';

import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveTenant } from '../../middleware/resolveTenant.js';
import { validate } from '../../middleware/validate.js';
import { annoncerModification } from '../tempsReel/annonces.js';
import * as service from './generation.service.js';

/**
 * Génération automatique des emplois du temps (F6, Phase 6).
 * ← le bouton « Lancer la Génération » de emploi.html
 *
 * ═══ ⚠️ LE DIRECTEUR SEUL, ET C'EST DÉLIBÉRÉ ═══
 * La génération RÉÉCRIT des semaines entières — jusqu'à l'année complète. Elle
 * rejoint donc « publier », « importer » et « réinitialiser », réservés au
 * directeur depuis le 2026-09-12 pour exactement cette raison : un invité
 * « peut modifier » édite des cases, il ne remplace pas une année de travail.
 */
const router = Router();

router.use(authenticate, requireRole(ROLES.DIRECTEUR), resolveTenant);

/*
 * ⚠️ BORNÉE À 60 SEMAINES. L'année scolaire en compte 45 ; au-delà, c'est une
 *    erreur d'appel. Sans borne, une liste construite par erreur ferait tourner
 *    le serveur — et écraserait des semaines — sans que rien ne l'arrête.
 */
const semainesSchema = z
  .array(z.string().trim().min(1))
  .min(1, 'au moins une semaine')
  .max(60, 'au plus 60 semaines à la fois');

const corpsGeneration = z.object({
  semaines: semainesSchema,
  /*
   * ⚠️ FACULTATIVE. Absente, le service reprend celle qui est enregistrée, ou
   *    en tire une neuve — et l'enregistre. La fournir sert à REJOUER une
   *    génération à l'identique, ce que l'ancien ne savait pas faire.
   */
  graine: z.number().int().min(0).max(2 ** 31 - 1).optional(),
  /*
   * ← les relances de la fenêtre de résolution des séances non placées.
   * ⚠️ Jamais posé par une génération ordinaire : celle-ci respecte les
   *    contraintes saisies. C'est un geste explicite, après un premier échec.
   */
  assouplissement: z
    .object({
      ignorerIndisponibilites: z.boolean().default(false),
      toutesLesSalles: z.boolean().default(false),
    })
    .default({}),
  /*
   * ═══ ⚠️ LE GLOUTON RESTE LE DÉFAUT, ET CE N'EST PAS UNE PRUDENCE ═══
   * Une génération au glouton coûte 1 seconde pour l'année ; en CP-SAT, elle en
   * coûte SEPT MINUTES pour 27 séances de plus sur 5 458 (mesuré le 2026-09-21
   * sur l'année réelle). C'est un arbitrage que le directeur doit poser
   * sciemment, pas un réglage qu'on lui applique.
   *
   * ⚠️ `z.enum` PLUTÔT QU'UNE CHAÎNE LIBRE : une faute de frappe est refusée
   *    ICI, en 400, avec les valeurs admises. Sans ça elle irait jusqu'à Python
   *    — qui la refuse aussi, mais depuis un sous-processus, et le directeur
   *    lirait « le problème envoyé au solveur est invalide ».
   *
   * ⚠️ SUR LA ROUTE NON DIFFUSÉE (`POST /`), `cpsat` SUR UNE ANNÉE ENTIÈRE
   *    TIENDRA LA RÉPONSE OUVERTE ~15 MINUTES, et tout proxy la coupera bien
   *    avant — sans annuler la génération, qui va à son terme (voir `/flux`).
   *    Le front passe par `/flux` pour cette raison ; un client qui demande
   *    `cpsat` ici doit savoir ce qu'il fait.
   */
  moteur: z.enum([MOTEURS.GLOUTON, MOTEURS.CPSAT]).default(MOTEURS.GLOUTON),
});

/**
 * Ce qu'une génération remplacerait — sans rien écrire.
 *
 * ⚠️ EN POST, BIEN QUE CE SOIT UNE LECTURE : la liste des semaines est un
 *    corps, pas un paramètre d'URL. Quarante-cinq valeurs en chaîne de requête
 *    se heurteraient aux limites de longueur des proxys, et l'échec serait
 *    intermittent — le pire des symptômes.
 */
router.post(
  '/previsualisation',
  validate({ body: z.object({ semaines: semainesSchema }) }),
  async (req, res, next) => {
    try {
      /*
       * ⚠️ LE SERVICE REND DÉSORMAIS `{ semaines, modulesSansAffectation }` :
       *    l'envelopper une seconde fois donnerait `semaines.semaines`, et
       *    l'écran afficherait une liste vide sans la moindre erreur.
       */
      res.json(await service.previsualiser(req.etablissementId, req.anneeScolaire, req.body));
    } catch (erreur) {
      next(erreur);
    }
  }
);

/**
 * Ce qu'un assouplissement récupérerait — sans rien écrire.
 *
 * ⚠️ EN POST POUR LA MÊME RAISON QUE `/previsualisation` : la liste des
 *    semaines est un corps, pas une chaîne de requête.
 *
 * ⚠️ BORNÉE PLUS SERRÉ QUE LA GÉNÉRATION : **12 semaines**, là où générer en
 *    accepte 60. Une simulation coûte QUATRE résolutions par semaine (la base
 *    plus trois hypothèses) : sur une année entière, ce serait 180 appels au
 *    solveur pour répondre à une question de curiosité. Et elle ne sert que
 *    sur les semaines INCOMPLÈTES, qui se comptent sur les doigts — l'écran ne
 *    la propose d'ailleurs que pour celles-là.
 */
router.post(
  '/simulation',
  validate({
    body: z.object({
      semaines: z
        .array(z.string().trim().min(1))
        .min(1, 'au moins une semaine')
        .max(12, 'au plus 12 semaines à la fois'),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(await service.simuler(req.etablissementId, req.anneeScolaire, req.body));
    } catch (erreur) {
      next(erreur);
    }
  }
);

/** Génération, réponse en un bloc. */
router.post('/', validate({ body: corpsGeneration }), async (req, res, next) => {
  try {
    const rapport = await service.generer(
      req.etablissementId,
      req.anneeScolaire,
      req.body,
      { lanceePar: req.utilisateur?.id ?? null }
    );

    /*
     * ⚠️ LES QUATRE PAGES QUI LISENT CES SÉANCES SONT PRÉVENUES, pas seulement
     *    l'emploi du temps : un collègue qui regarde l'avancement ou les
     *    absences verrait sinon des chiffres périmés sans savoir pourquoi.
     */
    annoncerModification(req, ['emploi', 'absences', 'avancement', 'efm'], {
      action: 'generation',
    });

    res.json(rapport);
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * Génération avec progression (SSE).
 *
 * ═══ ⚠️ POURQUOI SSE ET PAS UNE WEBSOCKET ═══
 * Le flux ne va que du serveur vers le client, et il s'arrête à la fin de la
 * génération : c'est une réponse HTTP qui met du temps à s'écrire, pas un canal.
 * Une socket demanderait de gérer l'authentification dans le canal — l'access
 * token vit 15 minutes — pour un besoin strictement unidirectionnel.
 *
 * ⚠️ LE CLIENT LE LIT AVEC `fetch`, PAS AVEC `EventSource` : celui-ci ne sait
 *    faire que des GET, et la liste des semaines est un CORPS (voir
 *    `/previsualisation`). On perd la reconnexion automatique d'`EventSource` —
 *    une coupure interrompt la RESTITUTION de l'avancement, jamais l'opération,
 *    qui va à son terme côté serveur.
 *
 * ⚠️ MAIS LA GÉNÉRATION N'EST PAS ANNULÉE SI LE CLIENT PART. Elle écrit en
 *    base : l'interrompre à moitié laisserait la moitié des semaines générées
 *    et l'autre non, sans que personne ne sache lesquelles. On la laisse finir.
 */
router.post('/flux', validate({ body: corpsGeneration }), async (req, res, next) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // ⚠️ Nginx tamponne par défaut : sans cet en-tête, la progression
    //    n'arriverait qu'à la fin, ce qui la rend inutile.
    'X-Accel-Buffering': 'no',
  });

  const envoyer = (type, charge) => {
    if (res.writableEnded) return;
    res.write(`event: ${type}\ndata: ${JSON.stringify(charge)}\n\n`);
  };

  try {
    const rapport = await service.generer(req.etablissementId, req.anneeScolaire, req.body, {
      lanceePar: req.utilisateur?.id ?? null,
      onProgres: (etape) => envoyer('progres', etape),
    });

    annoncerModification(req, ['emploi', 'absences', 'avancement', 'efm'], {
      action: 'generation',
    });

    envoyer('termine', rapport);
    res.end();
  } catch (erreur) {
    /*
     * ⚠️ L'EN-TÊTE EST DÉJÀ PARTI : on ne peut plus rendre un code d'erreur.
     *    Passer à `next(erreur)` ferait échouer le gestionnaire d'erreurs sur
     *    une réponse déjà envoyée — le défaut déjà rencontré sur les annonces
     *    temps réel. L'erreur voyage donc dans le flux.
     */
    if (res.headersSent) {
      envoyer('erreur', {
        code: erreur.code ?? 'ERREUR',
        message: erreur.message ?? 'La génération a échoué',
      });
      res.end();
      return;
    }
    next(erreur);
  }
});

export default router;
