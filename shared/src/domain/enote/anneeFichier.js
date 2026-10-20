import { indexColonne } from './colonnes.js';

/**
 * Le fichier e-note appartient-il à l'année scolaire de la base ? (2026-10-19)
 *
 * Deux preuves, contrôlées l'une ET l'autre :
 *
 *  1. Colonne B (« Année ») : pour 2026-2027, seules 2026 et 2027 sont admises.
 *     Toutes les années écrites dans la cellule sont lues (« 2026 »,
 *     « 2026/2027 »…).
 *
 *  2. Colonne A (« Date MAJ ») : la date de l'export doit tomber dans l'année
 *     scolaire, du 1er août 2026 au 31 juillet 2027. ⚠️ LA COLONNE B NE SUFFIT
 *     PAS (signalé par le porteur) : un export de mai 2026, donc de 2025-2026,
 *     peut y porter « 2026 ».
 *
 * La fenêtre de la date ne chevauche pas celle de l'année voisine : un export
 * de juillet appartient à l'année qui s'achève, un export d'août à celle qui
 * s'ouvre.
 *
 * Une cellule vide ou illisible ne prouve rien et n'est pas comptée : un
 * fichier sans ces colonnes n'est pas refusé pour autant.
 *
 * @param {Array<Array<string>>} lignes  Lignes de données, sans l'en-tête.
 * @param {number} anneeScolaire  2026 pour « 2026-2027 ».
 * @param {Array<string>} [entete]
 */
export function verifierAnneeFichier(lignes, anneeScolaire, entete = []) {
  const debut = Number(anneeScolaire);
  const admises = [debut, debut + 1];
  const periode = { debut: dateLocale(debut, 8, 1), fin: dateLocale(debut + 1, 7, 31) };

  const colonneAnnee = indexColonne('annee', entete);
  const colonneDate = indexColonne('dateMaj', entete);

  const horsAnnee = new Set();
  let lignesHorsAnnee = 0;
  const datesHorsPeriode = new Set();
  let lignesDateHorsPeriode = 0;

  for (const ligne of lignes ?? []) {
    const annees = (String(ligne?.[colonneAnnee] ?? '').match(/\b(?:19|20)\d{2}\b/g) ?? []).map(Number);
    const etrangeres = annees.filter((annee) => !admises.includes(annee));
    if (etrangeres.length > 0) {
      lignesHorsAnnee += 1;
      etrangeres.forEach((annee) => horsAnnee.add(annee));
    }

    const date = lireDate(ligne?.[colonneDate]);
    if (date && (date < periode.debut || date > periode.fin)) {
      lignesDateHorsPeriode += 1;
      datesHorsPeriode.add(formater(date));
    }
  }

  return {
    conforme: lignesHorsAnnee === 0 && lignesDateHorsPeriode === 0,
    admises,
    horsAnnee: [...horsAnnee].sort((a, b) => a - b),
    lignesHorsAnnee,
    periode: { debut: formater(periode.debut), fin: formater(periode.fin) },
    datesHorsPeriode: [...datesHorsPeriode].slice(0, 3),
    lignesDateHorsPeriode,
  };
}

/** Minuit, heure locale. `mois` de 1 à 12. */
function dateLocale(annee, mois, jour) {
  return new Date(annee, mois - 1, jour);
}

/** « 15/05/2026 ». */
function formater(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Une date valide, ramenée à minuit — ou `null` si la valeur n'en est pas une. */
function valide(annee, mois, jour) {
  const date = dateLocale(annee, mois, jour);
  return date.getFullYear() === annee && date.getMonth() === mois - 1 && date.getDate() === jour
    ? date
    : null;
}

/**
 * La date d'une cellule « Date MAJ », quel que soit le format reçu :
 *   - texte français « 19/10/2026 10:00:00 » (export e-note, export de la carte),
 *     avec « / », « - » ou « . » ;
 *   - ISO « 2026-10-19 » ;
 *   - date Excel rendue par le lecteur (« Mon Oct 19 2026 … ») ;
 *   - numéro de série Excel (46314).
 * Une année à deux chiffres (« 10/19/26 ») est ambiguë sur le mois : ignorée.
 */
export function lireDate(valeur) {
  const texte = String(valeur ?? '').trim();
  if (texte === '') return null;

  let m = texte.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valide(Number(m[1]), Number(m[2]), Number(m[3]));

  m = texte.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (m) return valide(Number(m[3]), Number(m[2]), Number(m[1]));

  if (/^\d+(?:\.\d+)?$/.test(texte)) {
    const serie = Number(texte);
    // De 1955 à 2119 : en deçà, ce n'est pas une date de mise à jour.
    if (serie < 20000 || serie > 80000) return null;
    const jours = Math.floor(serie) - 25569; // 25569 = 01/01/1970 en série Excel
    const utc = new Date(jours * 86400000);
    return valide(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
  }

  if (/^[A-Za-z]{3} [A-Za-z]{3} \d{1,2} \d{4}/.test(texte)) {
    const date = new Date(texte);
    return Number.isNaN(date.getTime()) ? null : valide(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  return null;
}
