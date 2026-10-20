/**
 * Heures supplémentaires d'un formateur (demande du porteur, 2026-10-17).
 *
 * ═══ LA RÈGLE ═══
 *  1. Le QUOTA annuel = masse AFFECTÉE − masse STATUTAIRE. Un formateur à 1000 h
 *     affectées pour 910 h statutaires a 90 h supplémentaires à payer, pas plus.
 *  2. Chaque SEMAINE, seules comptent les heures situées ENTRE un seuil et 35 h :
 *     au-delà de 35 h, rien n'est compté. Le seuil est la masse HEBDOMADAIRE
 *     statutaire (MHS) — 26 h pour 910 h annuelles, 36 h pour 1260 h — et descend
 *     avec les jours fermés (fériés, vacances) de la semaine : −6 h pour le premier,
 *     −5 h pour chacun des suivants — 26, 20, 15, 10, 5, 0.
 *  2 bis. Toute AUTRE masse annuelle est celle d'un VACATAIRE : pas d'heures
 *     supplémentaires (précision du porteur, 2026-10-17).
 *  3. Chaque MOIS, le payé est plafonné à 30 h.
 *  4. Une fois le quota épuisé, plus rien n'est compté, même une semaine chargée.
 *
 * ⚠️ UNE SEMAINE APPARTIENT AU MOIS DE SON JEUDI — celui qui porte la majorité de
 * ses jours. C'est la répartition du tableau de suivi du porteur : la semaine du
 * 28 septembre au 4 octobre est rangée en octobre.
 *
 * ⚠️ LE QUOTA SE CONSOMME SUR LE PAYÉ, pas sur le brut : une heure au-delà des
 * 30 h du mois n'est pas payée, elle n'entame donc pas le quota.
 */

export const SEUIL_HEURES_SUPP = 26;

/** Masse annuelle statutaire → masse hebdomadaire (MHS). Les seules qui ouvrent droit aux HS. */
export const REGIMES_STATUTAIRES = Object.freeze({ 910: 26, 1260: 36 });
export const PLAFOND_HEURES_SUPP_SEMAINE = 35;
export const PLAFOND_HEURES_SUPP_MOIS = 30;

/**
 * Mois EXCLUS du calcul : juillet et août (demande du porteur, 2026-10-17). Une semaine en relève
 * si son JEUDI y tombe — la même règle que pour le rangement des semaines par mois.
 */
export const MOIS_HORS_HEURES_SUPP = Object.freeze(['07', '08']);
export const moisCompteHeuresSupp = (mois) => !MOIS_HORS_HEURES_SUPP.includes(String(mois).slice(5, 7));

const arrondi = (valeur) => Math.round(valeur * 100) / 100;

/**
 * Le régime d'un formateur d'après sa masse annuelle statutaire.
 * @returns {{statut: 'permanent'|'vacataire'|'inconnu', mhs: number|null}}
 *   `inconnu` : masse non renseignée (0) ; `vacataire` : toute masse hors des régimes connus.
 */
export function regimeFormateur(masseStatutaire) {
  const masse = Number(masseStatutaire) || 0;
  if (masse <= 0) return { statut: 'inconnu', mhs: null };
  const mhs = REGIMES_STATUTAIRES[masse];
  return mhs ? { statut: 'permanent', mhs } : { statut: 'vacataire', mhs: null };
}

/**
 * Le seuil d'une semaine selon ses jours fermés (lundi → samedi), à partir de la MHS :
 * 26, 20, 15, 10, 5, 0 — ou 36, 30, 25, 20…
 */
export function seuilHebdomadaire(joursFermes = 0, mhs = SEUIL_HEURES_SUPP) {
  const n = Math.max(0, Math.floor(Number(joursFermes) || 0));
  if (n === 0) return mhs;
  return Math.max(0, mhs - 6 - 5 * (n - 1));
}

/**
 * La MASSE HORAIRE d'une semaine, pour le Cumul TH.SUP du mois (2026-10-20, règle du porteur) :
 * « sans jours fériés = 26 ; avec jours fériés = 26 − 4,334 × le nombre de jours fériés de la
 * semaine ». 4,334 est un sixième de 26 (arrondi au millième supérieur) : chaque jour fermé retire
 * un jour ouvré sur six. Pour une MHS de 36 h, le même principe retire 6 h par jour.
 *
 * ⚠️ CE N'EST PAS `seuilHebdomadaire` (−6 h puis −5 h), qui reste le seuil des heures supp de
 * chaque semaine — et donc de ce qui est payé.
 *
 * @returns {number|null}  `null` pour un vacataire (pas de MHS)
 */
export function masseHebdomadaireCumul(joursFermes = 0, mhs = SEUIL_HEURES_SUPP) {
  if (!mhs) return null;
  const n = Math.max(0, Math.floor(Number(joursFermes) || 0));
  const parJour = Math.ceil((mhs / 6) * 1000) / 1000;
  return arrondi(Math.max(0, mhs - parJour * n));
}

/** « AAAA-MM » du jeudi de la semaine qui commence ce lundi (« AAAA-MM-JJ »). */
export function moisDeLaSemaine(lundi) {
  const jeudi = new Date(`${lundi}T12:00:00`);
  jeudi.setDate(jeudi.getDate() + 3);
  return `${jeudi.getFullYear()}-${String(jeudi.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Numéro de semaine CALENDAIRE (ISO 8601) — celui des états de l'administration (« S-40 »).
 * ⚠️ À NE PAS CONFONDRE avec la semaine de l'année de formation (S1 = rentrée), que porte
 * `numero` partout ailleurs.
 */
export function semaineCalendaire(jour) {
  const date = new Date(`${jour}T12:00:00Z`);
  const jeudi = new Date(date);
  jeudi.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const premierJanvier = new Date(Date.UTC(jeudi.getUTCFullYear(), 0, 1, 12));
  return Math.floor((jeudi - premierJanvier) / 86_400_000 / 7) + 1;
}

/**
 * Heures supplémentaires dues sur l'année : jamais négatif, nul sans masse statutaire et nul
 * pour un vacataire.
 */
export function quotaHeuresSupp(affecte, statutaire) {
  if (regimeFormateur(statutaire).mhs === null) return 0;
  return arrondi(Math.max(0, (Number(affecte) || 0) - statutaire));
}

/**
 * @param {{
 *   semaines: Array<{numero: number, lundi: string, joursFermes: number, heures: number}>,
 *   quota: number,
 *   mhs?: number|null,
 *   jusquau?: string|null,
 * }} entree  les semaines de l'année, dans l'ordre, avec les heures du formateur ; `mhs` est sa
 *   masse hebdomadaire statutaire — `null` (vacataire) : aucune heure supplémentaire. `jusquau`
 *   (« AAAA-MM-JJ ») : une semaine qui commence après ce jour n'entre pas dans la masse du mois —
 *   elle n'a pas encore eu lieu, on ne la compte pas comme un manque.
 * @returns {{
 *   semaines: Array<{numero, lundi, mois, seuil, plafond, heures, brut, paye, cumulMois,
 *     restant, horsPlafond, nonPaye: 'quota'|'plafondMois'|null}>,
 *   mois: Array<{mois, heures, objectif, brut, paye, masse, cumul}>,
 *   totaux: {heures, objectif, brut, paye, quota, restant},
 * }}
 */
export function calculerHeuresSupp({ semaines = [], quota = 0, mhs = SEUIL_HEURES_SUPP, jusquau = null }) {
  const eligible = mhs !== null && mhs !== undefined;
  let restant = Math.max(0, Number(quota) || 0);
  const parMois = new Map();
  const detail = [];

  for (const semaine of [...semaines].sort((a, b) => a.lundi.localeCompare(b.lundi))) {
    const mois = moisDeLaSemaine(semaine.lundi);
    // Juillet et août ne comptent pas : ni heures, ni objectif, ni HS.
    if (!moisCompteHeuresSupp(mois)) continue;
    const seuil = eligible ? seuilHebdomadaire(semaine.joursFermes, mhs) : null;
    const heures = arrondi(Number(semaine.heures) || 0);
    const brut = eligible
      ? arrondi(Math.max(0, Math.min(heures, PLAFOND_HEURES_SUPP_SEMAINE) - seuil))
      : 0;

    if (!parMois.has(mois)) parMois.set(mois, { mois, heures: 0, objectif: 0, brut: 0, paye: 0, masse: 0 });
    const cumul = parMois.get(mois);

    const restantAvant = restant;
    const paye = arrondi(Math.max(0, Math.min(brut, PLAFOND_HEURES_SUPP_MOIS - cumul.paye, restant)));
    restant = arrondi(restant - paye);
    // Ce qui a retenu une heure réalisée : le quota s'il est à sec, sinon le plafond du mois.
    const nonPaye = brut > paye ? (paye >= restantAvant ? 'quota' : 'plafondMois') : null;

    cumul.heures = arrondi(cumul.heures + heures);
    cumul.objectif = arrondi(cumul.objectif + (seuil ?? 0));
    cumul.brut = arrondi(cumul.brut + brut);
    cumul.paye = arrondi(cumul.paye + paye);
    if (eligible && (!jusquau || semaine.lundi <= jusquau)) {
      cumul.masse = arrondi(cumul.masse + masseHebdomadaireCumul(semaine.joursFermes, mhs));
    }

    detail.push({
      numero: semaine.numero,
      lundi: semaine.lundi,
      mois,
      seuil,
      plafond: PLAFOND_HEURES_SUPP_SEMAINE,
      heures,
      brut,
      paye,
      cumulMois: cumul.paye,
      restant,
      horsPlafond: eligible ? arrondi(Math.max(0, heures - PLAFOND_HEURES_SUPP_SEMAINE)) : 0,
      nonPaye,
    });
  }

  /*
   * ═══ LE CUMUL TH.SUP DU MOIS (2026-10-20, règle du porteur) ═══
   * Total réalisé − masse horaire du mois (la somme des masses de ses semaines déjà commencées).
   * Positif : des heures au-delà de la masse ; négatif : ce qui manque pour l'atteindre. Un
   * affichage : le payé, lui, reste calculé semaine par semaine.
   */
  const mois = [...parMois.values()].map((m) => ({
    ...m,
    cumul: eligible ? arrondi(m.heures - m.masse) : null,
  }));
  const somme = (cle) => arrondi(mois.reduce((total, m) => total + m[cle], 0));

  return {
    semaines: detail,
    mois,
    totaux: {
      heures: somme('heures'),
      objectif: somme('objectif'),
      brut: somme('brut'),
      paye: somme('paye'),
      quota: arrondi(Math.max(0, Number(quota) || 0)),
      restant,
    },
  };
}
