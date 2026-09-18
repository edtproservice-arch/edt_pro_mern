import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * Limitation de débit.
 *
 * L'implémentation PHP (`check_rate_limit`, config/security.php:110) écrivait un
 * fichier JSON par clé dans logs/ — non atomique, donc perdant des compteurs en
 * concurrence. Et surtout, le login l'appelait avec **500 tentatives par
 * 5 minutes** (login.php:42) : la protection contre la force brute était de fait
 * désactivée. On revient ici à la valeur que `environment.php:88` déclarait
 * pourtant déjà comme défaut.
 *
 * ⚠️ Le magasin est en mémoire : correct pour un seul processus Node. Si l'API
 * est un jour répliquée, il faudra un magasin partagé (Redis).
 */

/** Exporté pour que les tests vérifient les seuils — c'est LE réglage qui a dérivé en PHP. */
export const SEUILS = {
  connexion: { fenetreMs: 5 * 60 * 1000, maximum: 5 },
  inscription: { fenetreMs: 60 * 60 * 1000, maximum: 3 },
  code: { fenetreMs: 15 * 60 * 1000, maximum: 10 },
  // Plus strict que la validation : un renvoi déclenche un e-mail réel, donc
  // un abus remplit la boîte de la victime et brûle le quota d'envoi.
  renvoi: { fenetreMs: 15 * 60 * 1000, maximum: 5 },
};

/**
 * Les tests d'intégration partagent tous la même IP : sans cette neutralisation,
 * le 4e test d'inscription serait rejeté en 429 et les échecs se propageraient
 * en cascade. Les seuils restent vérifiés par leur propre test.
 */
const enTest = () => env.NODE_ENV === 'test';

function creerLimiteur({ fenetreMs, maximum }, options = {}) {
  return rateLimit({
    windowMs: fenetreMs,
    limit: maximum,
    standardHeaders: true,
    legacyHeaders: false,
    skip: enTest,
    message: {
      success: false,
      message: 'Trop de tentatives. Réessayez dans quelques minutes.',
      code: 'TROP_DE_TENTATIVES',
    },
    ...options,
  });
}

export const limiteurConnexion = creerLimiteur(SEUILS.connexion, {
  // Une session légitime ne doit pas consommer le quota : seuls les échecs comptent.
  skipSuccessfulRequests: true,
});

export const limiteurInscription = creerLimiteur(SEUILS.inscription);

/** Codes de vérification : empêche de balayer les 10^6 combinaisons. */
export const limiteurCode = creerLimiteur(SEUILS.code);

export const limiteurRenvoi = creerLimiteur(SEUILS.renvoi);
