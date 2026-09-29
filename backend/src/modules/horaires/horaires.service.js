import { HorairesSeances } from '../../models/HorairesSeances.js';
import { configurationHoraires, horairesCourants } from 'shared/domain';

/**
 * Les horaires des séances S1 à S4. (demande du porteur, 2026-09-20.)
 *
 * ═══ ⚠️ ÉCRITURE ADMIN, LECTURE OUVERTE À TOUT COMPTE CONNECTÉ ═══
 * Directeur, gestionnaire, formateur et stagiaire LISENT l'horaire en vigueur — c'est lui qui
 * dit à quelle heure commence un cours — mais seul l'administrateur le règle : une correction
 * faite ici vaut pour tout le réseau.
 */

const CLE = 'reseau';

/** Ce qui part sur le fil : le réglage complet ET le jeu en vigueur, déjà calculé. */
export function presenter(document) {
  const configuration = configurationHoraires(document);
  return { ...configuration, courant: horairesCourants(configuration) };
}

/**
 * ⚠️ UN DOCUMENT ABSENT N'EST PAS UNE ERREUR : tant que l'administrateur n'a rien réglé, ce
 * sont les valeurs d'origine (hiver) qui s'appliquent.
 */
export async function obtenir() {
  return presenter(await HorairesSeances.findOne({ cle: CLE }).lean());
}

/** Remplacement complet : l'écran envoie les trois jeux qu'il affiche. */
export async function enregistrer({ actif, horaires }) {
  const document = await HorairesSeances.findOneAndUpdate(
    { cle: CLE },
    { $set: { actif, horaires } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return presenter(document);
}
