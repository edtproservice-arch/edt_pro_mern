import { JOURS, SEANCES } from '../../constants/index.js';
import { detecterConflits, estSalleReelle } from './conflits.js';

/**
 * Disponibilité et salles attribuées d'un formateur.
 * ← `configurations_auto_gen.config_json` : `{ formateur → { spaces[], unavailable[{jour, seance}] } }`,
 *   édité par profil-contraintes.js et lu par emploi.html.
 *
 * ═══ CE QUE CES CONTRAINTES VEULENT DIRE ═══
 * - `espaces` : les salles où l'on place ce formateur de préférence. Une liste
 *   VIDE veut dire « aucune restriction » (décision du porteur, 2026-09-17) —
 *   l'ancien générateur, lui, ne plaçait jamais un formateur sans salle cochée.
 * - `indisponibilites` : les créneaux à ÉVITER. En saisie manuelle, ils ne
 *   ferment rien (décision du porteur) : la grille le signale, et le directeur
 *   reste libre de poser la séance.
 *
 * ⚠️ LE SOIR (S5) N'EN FAIT PAS PARTIE, comme dans l'existant : la grille de
 * disponibilité compte 6 jours × 4 créneaux.
 */
export const CRENEAUX_CONTRAINTES = SEANCES.slice(0, 4);

const cleCreneau = (jour, seance) => `${jour}|${seance}`;

/**
 * Remet des contraintes saisies en forme : salles connues seulement, sans
 * doublon, créneaux valides dans l'ordre de la semaine.
 *
 * ⚠️ UNE SALLE RETIRÉE DES ESPACES DISPARAÎT ICI : garder un nom que
 * l'établissement ne connaît plus ferait pré-remplir un local qui n'existe pas.
 * « TEAMS » n'est pas un local — il n'est jamais retenu.
 *
 * @param {{espaces?: string[], indisponibilites?: Array<{jour, seance}>}} entree
 * @param {string[]} sallesConnues
 */
export function normaliserContraintes(entree = {}, sallesConnues = []) {
  const connues = new Set(sallesConnues.map((s) => String(s).trim()).filter(estSalleReelle));

  const espaces = [];
  for (const salle of entree.espaces ?? []) {
    const nom = String(salle ?? '').trim();
    if (connues.has(nom) && !espaces.includes(nom)) espaces.push(nom);
  }

  const retenus = new Set(
    (entree.indisponibilites ?? [])
      .filter((c) => JOURS.includes(c?.jour) && CRENEAUX_CONTRAINTES.includes(c?.seance))
      .map((c) => cleCreneau(c.jour, c.seance))
  );

  const indisponibilites = JOURS.flatMap((jour) =>
    CRENEAUX_CONTRAINTES.filter((seance) => retenus.has(cleCreneau(jour, seance))).map((seance) => ({
      jour,
      seance,
    }))
  );

  return { espaces, indisponibilites };
}

/**
 * Index des contraintes par formateur, pour des lectures en temps constant —
 * la grille interroge chaque case, plus d'un millier de fois par rendu.
 *
 * @param {Array<{formateur, espaces, indisponibilites}>} liste
 * @returns {Map<string, {espaces: string[], indisponibles: Set<string>}>}
 */
export function indexerContraintes(liste = []) {
  const index = new Map();
  for (const entree of liste ?? []) {
    const formateur = String(entree?.formateur ?? '').trim();
    if (!formateur) continue;
    index.set(formateur, {
      espaces: entree.espaces ?? [],
      indisponibles: new Set(
        (entree.indisponibilites ?? []).map((c) => cleCreneau(c.jour, c.seance))
      ),
    });
  }
  return index;
}

/** Ce créneau est-il déclaré à éviter pour ce formateur ? */
export function creneauAEviter(index, formateur, jour, seance) {
  if (!index || !formateur) return false;
  return Boolean(index.get(String(formateur).trim())?.indisponibles.has(cleCreneau(jour, seance)));
}

/**
 * La salle à proposer d'office quand on pose une séance : la première salle
 * attribuée au formateur qui soit LIBRE sur le créneau.
 * ← assignDefaultRoomFromConfig() de emploi.html
 *
 * ⚠️ LA LIBERTÉ D'UNE SALLE SE JUGE AVEC `detecterConflits`, la fonction du
 * serveur : une seconde règle aurait pré-rempli une salle que le serveur refuse.
 *
 * @returns {string} '' si aucune salle attribuée n'est libre, ou s'il n'y en a aucune
 */
export function salleParDefaut(index, formateur, surLeCreneau = [], { id } = {}) {
  const espaces = index?.get(String(formateur ?? '').trim())?.espaces ?? [];
  const libre = espaces.find(
    (salle) =>
      !detecterConflits({ id, salle }, surLeCreneau).some((conflit) => conflit.type === 'salle')
  );
  return libre ?? '';
}
