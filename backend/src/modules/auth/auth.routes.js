import { Router } from 'express';
import {
  changementMotDePasseSchema,
  connexionSchema,
  demandeResetSchema,
  inscriptionSchema,
  modificationProfilSchema,
  reinitialisationSchema,
  renvoiCodeSchema,
  verificationCodeSchema,
} from 'shared/schemas';
import { ROLES } from 'shared/constants';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  limiteurCode,
  limiteurConnexion,
  limiteurInscription,
  limiteurRenvoi,
} from '../../middleware/rateLimit.js';
import {
  effacerCookies,
  lireRefreshToken,
  poserCookies,
} from './tokens.js';
import * as service from './auth.service.js';

/**
 * Routes d'authentification.
 *
 * Règle de couches (§10.1) : une route valide son entrée, appelle un service et
 * choisit un code HTTP. Elle ne contient aucune règle métier et ne touche jamais
 * Mongoose directement.
 */
const router = Router();

const APPAREIL_INCONNU = {
  nom: 'Appareil inconnu',
  navigateur: 'inconnu',
  os: 'inconnu',
  type: 'desktop',
};

/**
 * Appareil par défaut si le client n'envoie rien, complété par l'IP côté serveur.
 *
 * ⚠️ `req.body?` et non `req.body.` : sous Express 5, `req.body` vaut `undefined`
 * — et non plus `{}` — quand la requête n'a pas de corps JSON. C'est le cas de
 * /rafraichir et /deconnexion, qui n'envoient que des cookies.
 */
function contexteAppareil(req) {
  return {
    appareil: req.body?.appareil ?? APPAREIL_INCONNU,
    ip: req.ip,
  };
}

router.post(
  '/inscription',
  limiteurInscription,
  validate({ body: inscriptionSchema }),
  async (req, res, next) => {
    try {
      const resultat = await service.inscrire(req.body);
      res.status(201).json({ success: true, ...resultat });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/connexion',
  limiteurConnexion,
  validate({ body: connexionSchema }),
  async (req, res, next) => {
    try {
      const { appareil, ip } = contexteAppareil(req);
      const resultat = await service.connecter({
        identifiant: req.body.identifiant,
        motDePasse: req.body.motDePasse,
        appareil,
        ip,
      });

      // Appareil inconnu : un code vient d'être envoyé, aucune session ouverte.
      if (resultat.action === 'verification_appareil') {
        return res.json({ success: true, action: resultat.action, email: resultat.email });
      }

      poserCookies(res, resultat.accessToken, resultat.refreshToken);
      return res.json({ success: true, action: 'connecte', utilisateur: resultat.utilisateur });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/verification',
  limiteurCode,
  validate({ body: verificationCodeSchema }),
  async (req, res, next) => {
    try {
      const { appareil, ip } = contexteAppareil(req);
      const resultat = await service.verifierCode({ ...req.body, appareil, ip });

      if (resultat.action === 'email_verifie') {
        return res.json({ success: true, action: resultat.action });
      }

      poserCookies(res, resultat.accessToken, resultat.refreshToken);
      return res.json({ success: true, action: 'connecte', utilisateur: resultat.utilisateur });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * Renvoi d'un code. Répond TOUJOURS 200 : l'existence du compte ne doit pas
 * transparaître, et l'ancien code est invalidé au passage.
 */
router.post('/renvoi', limiteurRenvoi, validate({ body: renvoiCodeSchema }), async (req, res, next) => {
  try {
    const { appareil, ip } = contexteAppareil(req);
    await service.renvoyerCode({ ...req.body, appareil, ip });
    res.json({ success: true, message: 'Si un code était attendu, un nouveau vient de partir.' });
  } catch (error) {
    next(error);
  }
});

router.post('/rafraichir', async (req, res, next) => {
  try {
    const { appareil, ip } = contexteAppareil(req);
    const resultat = await service.rafraichir(lireRefreshToken(req), appareil, ip);

    poserCookies(res, resultat.accessToken, resultat.refreshToken);
    res.json({ success: true, utilisateur: resultat.utilisateur });
  } catch (error) {
    // Le refresh a échoué : on nettoie les cookies, sinon le client boucle.
    effacerCookies(res);
    next(error);
  }
});

router.post('/deconnexion', async (req, res, next) => {
  try {
    await service.deconnecter(lireRefreshToken(req));
    effacerCookies(res);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * Battement de cœur — ← api/auth/heartbeat.php.
 *
 * ═══ POURQUOI IL REVIENT ═══ (demande du porteur, 2026-09-02 : la page
 * « Statistiques » doit montrer le temps passé et qui est en ligne, comme
 * l'existant.) Ces deux indicateurs n'ont AUCUNE autre source : sans battement,
 * `derniereActivite` ne bouge qu'à la connexion et `tempsPasse` reste à zéro.
 *
 * ═══ ⚠️ L'INCRÉMENT EST MESURÉ, PAS SUPPOSÉ ═══
 * L'existant ajoutait 30 s à chaque appel, quoi qu'il arrive. Trois onglets
 * ouverts comptaient donc TROIS FOIS le même temps, et un rechargement en
 * ajoutait un de plus (il renvoyait un battement au bout de 5 s). Ici on ajoute
 * le temps RÉELLEMENT écoulé depuis la dernière activité, **borné** : au-delà de
 * la borne, la personne était absente — pas devant l'écran.
 */
router.post('/activite', authenticate, async (req, res, next) => {
  try {
    res.json({ success: true, ...(await service.enregistrerActivite(req.utilisateur)) });
  } catch (error) {
    next(error);
  }
});

router.get('/moi', authenticate, async (req, res, next) => {
  try {
    res.json({
      success: true,
      utilisateur: service.presenter(req.utilisateur),
      // Presence = session deleguee. Le client doit l'afficher en permanence :
      // agir sans savoir qu'on agit a la place de quelqu'un est dangereux.
      impersonateur: req.impersonateur
        ? { id: req.impersonateur.id, nomComplet: req.impersonateur.nomComplet }
        : null,
      /*
       * Un administrateur qui collabore avec un établissement (2026-09-14) : le
       * client en tire sa coquille, son menu et le bandeau qui le dit — pour la
       * même raison que ci-dessus.
       */
      collaboration: await service.collaborationPresentee(req.utilisateur),
    });
  } catch (error) {
    next(error);
  }
});

/** Referme la collaboration d'un administrateur : retour à l'administration. */
router.post('/quitter-collaboration', authenticate, async (req, res, next) => {
  try {
    const { appareil, ip } = contexteAppareil(req);
    const resultat = await service.quitterCollaboration(req.utilisateur, lireRefreshToken(req), appareil, ip);
    poserCookies(res, resultat.accessToken, resultat.refreshToken);
    res.json({ success: true, utilisateur: resultat.utilisateur });
  } catch (error) {
    next(error);
  }
});

/**
 * Modification des informations du profil (nom complet et e-mail).
 */
router.patch(
  '/profil',
  authenticate,
  validate({ body: modificationProfilSchema }),
  async (req, res, next) => {
    try {
      const utilisateur = await service.modifierProfil({
        utilisateurId: req.utilisateur.id,
        nomComplet: req.body.nomComplet,
        email: req.body.email,
      });

      res.json({ success: true, utilisateur });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Changement de mot de passe par un utilisateur connecte.
 * ← api/profile/change_password.php
 */
router.patch(
  '/mot-de-passe',
  authenticate,
  validate({ body: changementMotDePasseSchema }),
  async (req, res, next) => {
    try {
      const resultat = await service.changerMotDePasse({
        utilisateurId: req.utilisateur.id,
        actuel: req.body.actuel,
        nouveau: req.body.nouveau,
        // La session en cours est epargnee : on ne deconnecte pas quelqu'un de
        // l'ecran ou il vient d'agir.
        jetonCourant: lireRefreshToken(req),
      });

      res.json({ success: true, ...resultat });
    } catch (error) {
      next(error);
    }
  }
);

/** Met fin a une session deleguee et rend la main a l'administrateur. */
router.post('/retour-admin', authenticate, async (req, res, next) => {
  try {
    const { appareil, ip } = contexteAppareil(req);
    const resultat = await service.revenirAdmin(
      req.impersonateur,
      lireRefreshToken(req),
      appareil,
      ip
    );
    poserCookies(res, resultat.accessToken, resultat.refreshToken);
    res.json({ success: true, utilisateur: resultat.utilisateur });
  } catch (error) {
    next(error);
  }
});

/**
 * Demande de réinitialisation. Répond TOUJOURS 200, que l'adresse existe ou
 * non : la réponse ne doit pas permettre d'énumérer les comptes.
 */
router.post(
  '/mot-de-passe/demande',
  limiteurCode,
  validate({ body: demandeResetSchema }),
  async (req, res, next) => {
    try {
      await service.demanderReinitialisation(req.body.email);
      res.json({
        success: true,
        message: 'Si un compte existe pour cette adresse, un code vient d\'être envoyé.',
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/mot-de-passe/reinitialisation',
  limiteurCode,
  validate({ body: reinitialisationSchema }),
  async (req, res, next) => {
    try {
      await service.reinitialiserMotDePasse(req.body);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

/** Demande d'essai — réservée à un directeur pas encore approuvé. */
router.post('/essai', authenticate, requireRole(ROLES.DIRECTEUR), async (req, res, next) => {
  try {
    await service.demanderEssai(req.utilisateur);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
