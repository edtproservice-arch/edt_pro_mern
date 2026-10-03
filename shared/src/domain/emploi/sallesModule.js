/**
 * La salle déclarée pour un module dans la carte (`Base.sallesAffectations`).
 *
 * ═══ ⚠️ ELLE EST IMPOSÉE, À LA GÉNÉRATION COMME À LA SAISIE ═══
 * (décision du porteur, 2026-10-03.) Un atelier de soudure est imposé par la
 * MATIÈRE : un cours posé ailleurs n'est pas le cours prévu. Une seule
 * définition ici, lue par `poser()` côté serveur et par la grille pour
 * pré-remplir la salle — deux règles pour une même question feraient proposer
 * à l'écran une salle que le serveur refuse.
 */

import { separerFusion } from '../carte/reconstruction.js';
import { estSalleReelle } from './conflits.js';
import { cleModule } from './indicateurs.js';

const maj = (valeur) => String(valeur ?? '').trim().toUpperCase();

/** `Map` Mongoose ou objet lu en `.lean()` / en JSON : les deux se lisent pareil. */
function lireTable(table) {
  if (!table) return {};
  return typeof table.entries === 'function' && !Array.isArray(table)
    ? Object.fromEntries(table.entries())
    : table;
}

/**
 * Les salles imposées à ce (groupe, module), avec l'orthographe de l'établissement.
 *
 * ⚠️ UNE FUSION CUMULE LES SALLES DE SES MEMBRES : la carte les déclare groupe
 *    par groupe, et le libellé fusionné n'y figure pas.
 *
 * ⚠️ FILTRÉES SUR LES ESPACES EXISTANTS, comme à la génération : une salle
 *    déclarée puis supprimée imposerait un local introuvable, et plus aucune
 *    séance du module ne pourrait se poser.
 *
 * @returns {string[]} vide = aucune salle imposée
 */
export function sallesImposees(sallesAffectations, groupe, module, espaces = []) {
  const table = lireTable(sallesAffectations);
  const parNom = new Map(espaces.map((salle) => [maj(salle), salle]));

  const retenues = new Set();
  for (const membre of separerFusion(groupe)) {
    for (const salle of table[cleModule(membre, module)] ?? []) {
      const existante = parNom.get(maj(salle));
      if (existante) retenues.add(existante);
    }
  }
  return [...retenues];
}

/**
 * Vrai quand `salle` est un local réel hors des salles imposées.
 *
 * ⚠️ SANS SALLE, À DISTANCE OU ABSENT, RIEN N'EST REFUSÉ : TEAMS n'est pas un
 *    local, et une séance sans salle (déplacement dont la salle a cédé, séance
 *    manquante que rien n'accueille) reste à compléter, pas à refuser.
 */
export function horsSalleImposee(salle, imposees) {
  if (!estSalleReelle(salle) || imposees.length === 0) return false;
  return !imposees.some((nom) => maj(nom) === maj(salle));
}
