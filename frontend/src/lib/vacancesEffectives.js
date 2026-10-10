/**
 * Les vacances qui s'appliquent VRAIMENT à l'établissement, à partir de la
 * réponse de `GET /api/v2/calendrier`.
 *
 * ═══ ⚠️ `vacances` NE SUFFIT PAS (2026-10-10, corrigé à la demande du porteur) ═══
 * La route rend deux listes : `vacances`, les périodes PROPRES à
 * l'établissement, et `nationales`, celles du réseau — qui s'appliquent par
 * DÉFAUT, sauf celles qu'il a écartées (`ecartees`, par leur NOM : la règle de
 * `EtapeCalendrier`). Les calendriers de saisie ne lisaient que la première :
 * Toussaint ou fin d'année n'y apparaissaient pas tant que l'établissement ne
 * les avait pas recopiées à la main.
 *
 * Une même période présente dans les deux listes n'est rendue qu'une fois.
 *
 * @returns {Array<{intitule?: string, debut: string, fin: string}>}
 */
export function vacancesEffectives(calendrier) {
  const cle = (nom) => String(nom ?? '').trim().toLowerCase();
  const ecartees = new Set((calendrier?.ecartees ?? []).map(cle));

  const toutes = [
    ...(calendrier?.nationales ?? []).filter((periode) => !ecartees.has(cle(periode.intitule))),
    ...(calendrier?.vacances ?? []),
  ];

  const vues = new Set();
  return toutes.filter((periode) => {
    if (!periode?.debut || !periode?.fin) return false;
    const identite = `${periode.debut}|${periode.fin}`;
    if (vues.has(identite)) return false;
    vues.add(identite);
    return true;
  });
}
