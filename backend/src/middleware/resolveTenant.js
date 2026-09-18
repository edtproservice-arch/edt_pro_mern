import { badRequest, forbidden } from '../lib/httpError.js';
import { Etablissement } from '../models/Etablissement.js';

const EN_TETE_ETABLISSEMENT = 'x-etablissement-id';
const EN_TETE_ANNEE = 'x-annee-scolaire';

/**
 * Résout l'établissement et l'année scolaire d'un utilisateur.
 *
 * ⚠️ RÈGLE D'ISOLATION — à ne jamais assouplir : l'établissement demandé doit
 * appartenir à `utilisateur.etablissementIds`. L'API PHP tenait cette garantie
 * autrement, en ne lisant JAMAIS `etablissement_id` depuis la requête (vérifié
 * sur les 96 endpoints) : il venait uniquement de la session. Comme le client
 * peut désormais choisir son établissement actif — un directeur en supervise
 * plusieurs —, l'appartenance doit être contrôlée explicitement, sinon on
 * ouvre un accès inter-établissements.
 *
 * ⚠️ EXTRAITE DU MIDDLEWARE (2026-09-12) : la salle temps réel d'une page est
 * propre à un établissement et une année, et la socket les demande dans son
 * message `rejoindre`. Elle passe par CETTE fonction — une seconde résolution
 * écrite pour la socket aurait été une seconde règle d'isolation à tenir.
 *
 * @param {string|undefined} demande      établissement demandé, ou rien
 * @param {number|undefined} anneeDemandee année demandée, ou rien
 * @returns {{ etablissement, etablissementId: string, anneeScolaire: number }}
 * @throws {HttpError}
 */
export async function resoudreContexte(utilisateur, demande, anneeDemandee) {
  if (!utilisateur) throw forbidden('Accès refusé', { code: 'NON_AUTHENTIFIE' });

  /*
   * ⚠️ UN ADMINISTRATEUR EN COLLABORATION (2026-09-14) n'a qu'UN établissement :
   * celui que son jeton désigne (`col`, posé dans `$locals`). Il n'en a aucun
   * dans `etablissementIds` — la règle d'isolation ne s'assouplit donc pas :
   * elle compare à cet établissement-là, et à lui seul.
   */
  const collaboration = utilisateur.$locals?.collaboration ?? null;
  const cible = demande || collaboration || utilisateur.etablissementIds[0]?.toString();

  if (!cible) {
    throw badRequest('Aucun établissement associé à ce compte', { code: 'ETABLISSEMENT_ABSENT' });
  }

  const autorise = collaboration
    ? cible === collaboration
    : utilisateur.etablissementIds.some((id) => id.toString() === cible);
  if (!autorise) {
    throw forbidden('Établissement non autorisé', { code: 'ETABLISSEMENT_INTERDIT' });
  }

  const etablissement = await Etablissement.findById(cible);
  if (!etablissement) {
    throw badRequest('Établissement introuvable', { code: 'ETABLISSEMENT_INCONNU' });
  }

  // Année scolaire = année de septembre. Une seule représentation dans toute
  // l'application, contre trois en MySQL (plan §2).
  const annee = Number(anneeDemandee);
  const anneeScolaire =
    Number.isInteger(annee) && annee >= 2000 && annee <= 2100 ? annee : etablissement.anneeScolaire;

  return { etablissement, etablissementId: etablissement.id, anneeScolaire };
}

/**
 * Renseigne `req.etablissement`, `req.etablissementId` et `req.anneeScolaire`.
 *
 * À monter APRÈS `authenticate`.
 */
export async function resolveTenant(req, res, next) {
  try {
    const contexte = await resoudreContexte(
      req.utilisateur,
      req.get(EN_TETE_ETABLISSEMENT),
      req.get(EN_TETE_ANNEE)
    );

    req.etablissement = contexte.etablissement;
    req.etablissementId = contexte.etablissementId;
    req.anneeScolaire = contexte.anneeScolaire;

    return next();
  } catch (error) {
    return next(error);
  }
}
