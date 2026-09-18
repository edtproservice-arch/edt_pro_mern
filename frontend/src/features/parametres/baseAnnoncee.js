/**
 * La base d'un collègue, reçue AVEC son annonce (Phase 5bis, 2026-09-13), posée
 * dans le cache de `GET /base` — la carte se reconstruit à partir d'elle, sans
 * relecture.
 *
 * ⚠️ SEULEMENT SI ELLE EST PLUS RÉCENTE : une annonce arrivée après une relecture
 * plus fraîche — la sienne, ou celle d'une autre annonce — ne doit pas faire
 * reculer la carte. C'est la règle du chronogramme (`integrerPlanning`).
 *
 * @param {{ success?: boolean, base: object | null } | undefined} donnees  le cache
 * @param {object | null | undefined} base  la base annoncée, forme de `GET /base`
 * @returns le cache à poser — le MÊME objet quand rien ne change
 */
export function integrerBase(donnees, base) {
  if (!base || typeof base.version !== 'number') return donnees;
  const actuelle = donnees?.base?.version;
  if (typeof actuelle === 'number' && actuelle >= base.version) return donnees;
  return { ...(donnees ?? {}), success: true, base };
}
