import { forbidden } from '../lib/httpError.js';

/**
 * ═══ CE QU'UN COMPTE DE DÉMO NE PEUT PAS FAIRE (2026-11-01) ═══
 * Dans son bac à sable, le visiteur fait tout : construire, publier, supprimer, écrire.
 * Seules sont fermées les actions qui SORTENT de la copie ou touchent de vraies personnes :
 * créer des comptes (avec de vraies adresses), changer son profil ou son mot de passe,
 * partager avec d'autres établissements ou un complexe, créer un établissement, s'abonner
 * aux notifications poussées. La lecture reste toujours permise.
 *
 * ⚠️ UNE LISTE DE PRÉFIXES, PAS DE ROUTES EXACTES : une route ajoutée plus tard sous l'un
 *    d'eux est fermée d'office. Appelé par `authenticate`, pour les seuls comptes de démo.
 */
const FERMEES = [
  '/api/v2/comptes',
  '/api/v2/auth/profil',
  '/api/v2/auth/mot-de-passe',
  '/api/v2/auth/essai',
  '/api/v2/auth/appareils',
  '/api/v2/espaces-mutualises',
  '/api/v2/formateurs-mutualises',
  '/api/v2/complexe',
  '/api/v2/partages',
  '/api/v2/notifications',
  '/api/v2/admin',
];

/** La création d'un AUTRE établissement : `POST /api/v2/etablissements` exactement. */
const CREATION_ETABLISSEMENT = /^\/api\/v2\/etablissements\/?$/;

export function verifierActionDemo(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  const chemin = String(req.originalUrl ?? '').split('?')[0];
  const fermee =
    FERMEES.some((prefixe) => chemin === prefixe || chemin.startsWith(`${prefixe}/`)) ||
    (req.method === 'POST' && CREATION_ETABLISSEMENT.test(chemin));
  if (fermee) {
    throw forbidden('Cette action est désactivée dans la démo. Inscrivez votre établissement pour l’utiliser.', {
      code: 'DEMO_LIMITEE',
    });
  }
}
