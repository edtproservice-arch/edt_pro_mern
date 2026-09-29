import { estProtegee } from './application.js';

/**
 * Ce que le formateur a le droit de faire dans sa proposition.
 * ← `checkRestrictedMode()` de inbox.html, précisé par le porteur (2026-09-23) :
 *
 *   « si l'emploi de la semaine proposée est vide, le formateur est libre ; si
 *     le directeur a planifié l'emploi de la semaine, le formateur peut
 *     seulement déplacer ; si le chronogramme existe, le formateur n'est pas
 *     libre : il doit importer les séances depuis le chronogramme et déplacer. »
 *
 * ⚠️ L'EMPLOI PLANIFIÉ L'EMPORTE SUR LE CHRONOGRAMME : le directeur a déjà
 * traduit les heures en séances, les réimporter ferait doublon. C'était déjà
 * l'ordre de l'existant (`hasOrigSessions` masquait l'import).
 *
 * ⚠️ LES SÉANCES PROTÉGÉES (EFM, absence, rattrapage) NE COMPTENT PAS comme un
 * emploi planifié : elles ne se proposent pas, et une semaine qui n'a qu'un EFM
 * reste à construire.
 */
export const MODES_PROPOSITION = {
  LIBRE: 'libre',
  DEPLACER: 'deplacer',
  CHRONOGRAMME: 'chronogramme',
};

/**
 * @param {object} p
 * @param {Array} p.actuelles   séances actuelles du formateur (S1-S4, jour)
 * @param {Array} p.aImporter   `[{ groupe, module, nombre }]` venus du chronogramme
 */
export function modeDeProposition({ actuelles = [], aImporter = [] }) {
  if (actuelles.some((s) => !estProtegee(s))) return MODES_PROPOSITION.DEPLACER;
  if (aImporter.some((item) => item.nombre > 0)) return MODES_PROPOSITION.CHRONOGRAMME;
  return MODES_PROPOSITION.LIBRE;
}

const cle = (...parties) => parties.map((p) => String(p ?? '').trim().toUpperCase()).join('|');

function compter(seances, cleDe) {
  const comptes = new Map();
  for (const s of seances) comptes.set(cleDe(s), (comptes.get(cleDe(s)) ?? 0) + 1);
  return comptes;
}

/**
 * Ce qui, dans la proposition, sort de ce que le mode autorise.
 * C'est le contrôle que le SERVEUR rejoue : l'écran cache les boutons, il ne
 * garantit rien.
 *
 *  · `deplacer` : exactement les mêmes séances (groupe, module, salle), en même
 *    nombre — seules leurs cases changent.
 *  · `chronogramme` : chaque séance vient d'une ligne à importer, sans en
 *    dépasser le nombre. La salle reste au choix : l'import n'en connaît pas
 *    toujours une.
 *  · `libre` : rien à vérifier ici (les affectations le sont ailleurs).
 *
 * @returns {string[]} les écarts, formulés pour l'écran — vide si tout est permis
 */
export function ecartsAuMode({ mode, seances = [], actuelles = [], aImporter = [] }) {
  if (mode === MODES_PROPOSITION.DEPLACER) {
    const libelle = (s) => `${s.groupe} · ${s.module}${s.salle ? ` · ${s.salle}` : ''}`;
    const cleDe = (s) => cle(s.groupe, s.module, s.salle);
    const avant = compter(actuelles.filter((s) => !estProtegee(s)), cleDe);
    const apres = compter(seances, cleDe);
    const exemples = new Map([...actuelles, ...seances].map((s) => [cleDe(s), libelle(s)]));

    const ecarts = [];
    for (const k of new Set([...avant.keys(), ...apres.keys()])) {
      const diff = (apres.get(k) ?? 0) - (avant.get(k) ?? 0);
      if (diff > 0) ecarts.push(`Séance ajoutée : ${exemples.get(k)} — seul un déplacement est permis`);
      if (diff < 0) ecarts.push(`Séance retirée : ${exemples.get(k)} — seul un déplacement est permis`);
    }
    return ecarts;
  }

  if (mode === MODES_PROPOSITION.CHRONOGRAMME) {
    const cleDe = (s) => cle(s.groupe, s.module);
    const permis = new Map(aImporter.map((item) => [cleDe(item), item.nombre]));
    const ecarts = [];
    for (const [k, nombre] of compter(seances, cleDe)) {
      const [groupe, module] = k.split('|');
      if (!permis.has(k)) {
        ecarts.push(`${groupe} · ${module} n’est pas au chronogramme de cette semaine`);
      } else if (nombre > permis.get(k)) {
        ecarts.push(`${groupe} · ${module} : ${nombre} séances pour ${permis.get(k)} prévues au chronogramme`);
      }
    }
    return ecarts;
  }

  return [];
}
