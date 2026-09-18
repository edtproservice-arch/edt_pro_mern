import { instantLocal } from 'shared/domain';

/**
 * Où en est une séance de l'agenda, à l'instant présent.
 * ← `statusMap` de `public/emploiStagiaire.html` (completed / active / pending).
 *
 * ═══ « EN COURS » REDEVIENT POSSIBLE (2026-09-12, demande du porteur) ═══
 * Tant que l'agenda ne connaissait que des créneaux numérotés, on s'arrêtait au
 * JOUR (« Aujourd'hui »). Depuis que `agendaDuSujet` porte l'horaire OFFICIEL
 * de chaque créneau, l'instant présent se situe exactement : avant, pendant, ou
 * après — et, dans un bloc fusionné, dans QUEL créneau.
 *
 * ⚠️ L'HEURE SE COMPARE EN CHAÎNE « HH:MM » : le zéro de tête (« 08:30 ») rend
 * l'ordre alphabétique égal à l'ordre chronologique — c'est la forme exacte que
 * rend `horaireCreneau`, et celle que produit `instantPresent`.
 *
 * ⚠️ « EN PAUSE » N'EST PAS « EN COURS » : le Vendredi, un bloc S2 + S3 va de
 * 10:30 à 16:30 mais porte un écart RÉEL de deux heures (la prière). Entre
 * 12:30 et 14:30, personne n'est en cours — le dire serait faux.
 *
 * @param {{horaires?: Array<{debut: string, fin: string}>}} bloc
 * @param {string} [dateDuJour]  « AAAA-MM-JJ »
 * @param {{date: string, heure: string}} maintenant
 * @returns {{etat: 'termine'|'encours'|'pause'|'aujourdhui'|'avenir'|'inconnu', creneauCourant: number|null, progression: number|null}}
 */
export function etatDuBloc(bloc, dateDuJour, maintenant) {
  const horaires = bloc?.horaires ?? [];
  const aucun = { creneauCourant: null, progression: null };

  if (!dateDuJour || horaires.length === 0) return { etat: 'inconnu', ...aucun };
  if (dateDuJour < maintenant.date) return { etat: 'termine', ...aucun };
  if (dateDuJour > maintenant.date) return { etat: 'avenir', ...aucun };

  const debut = horaires[0].debut;
  const fin = horaires.at(-1).fin;
  const heure = maintenant.heure;

  if (heure >= fin) return { etat: 'termine', ...aucun };
  // Plus tard dans la journée : « Aujourd'hui », comme avant — plus précis
  // qu'« À venir » pour qui regarde son agenda le matin.
  if (heure < debut) return { etat: 'aujourdhui', ...aucun };

  const progression = Math.min(1, Math.max(0, (minutes(heure) - minutes(debut)) / (minutes(fin) - minutes(debut))));
  const index = horaires.findIndex((h) => h.debut <= heure && heure < h.fin);

  return index === -1
    ? { etat: 'pause', creneauCourant: null, progression }
    : { etat: 'encours', creneauCourant: index, progression };
}

/** L'instant présent, en heure LOCALE. ⚠️ C'est `instantLocal` du domaine — la
 *  MÊME forme que celle avec laquelle le serveur décide qu'une séance est
 *  terminée pour l'avancement : une seconde écriture aurait pu faire dire
 *  « Terminé » à l'agenda sans que l'avancement ait compté les heures. */
export function instantPresent(d = new Date()) {
  return instantLocal(d);
}

function minutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
