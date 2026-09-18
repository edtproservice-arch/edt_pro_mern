import { normaliserContraintes } from 'shared/domain';
import { AutoGenConfig } from '../../models/AutoGenConfig.js';
import { Base } from '../../models/Base.js';
import { Etablissement } from '../../models/Etablissement.js';
import { badRequest, notFound } from '../../lib/httpError.js';

/**
 * Disponibilité et salles attribuées des formateurs.
 * ← api/data/save_auto_gen_config.php + includes/config_auto_gen.php
 *
 * La donnée vit dans `AutoGenConfig` — celle que le générateur lira (Phase 6) —
 * et non dans `Base` : un réimport e-note remplace la base, il ne doit pas
 * effacer les créneaux et les salles saisis par l'établissement.
 */

/** Identifiant d'un formateur de la base — la règle de `parseBase`. */
const identifiant = (formateur) => {
  const matricule = String(formateur.matricule ?? '').trim();
  return matricule !== '' ? matricule : String(formateur.nomComplet ?? '').trim();
};

const presenter = (entree) => ({
  formateur: entree.formateur,
  espaces: entree.espaces ?? [],
  indisponibilites: (entree.indisponibilites ?? []).map((c) => ({ jour: c.jour, seance: c.seance })),
});

/** Toutes les contraintes de l'année — `[]` quand rien n'est encore saisi. */
export async function lister(etablissementId, anneeScolaire) {
  const config = await AutoGenConfig.findOne({ etablissementId, anneeScolaire })
    .select('contraintes')
    .lean();
  return (config?.contraintes ?? []).map(presenter);
}

/**
 * Enregistre les contraintes d'UN formateur.
 *
 * ⚠️ PARTIELLE, COMME L'EXISTANT : un champ absent n'est pas touché. La modale
 * de génération (Phase 6) écrira `heures` et `seancesTeams` dans la même entrée
 * — renvoyer une entrée complète effacerait ce que l'autre écran a posé.
 *
 * ⚠️ UN FORMATEUR À LA FOIS, donc sans version optimiste : deux collègues sur
 * deux formateurs différents ne s'écrasent pas, et sur le même formateur la
 * dernière écriture l'emporte champ par champ.
 */
export async function definir(etablissementId, anneeScolaire, { formateur, espaces, indisponibilites }) {
  const [base, etablissement] = await Promise.all([
    Base.findOne({ etablissementId, anneeScolaire }).select('formateurs').lean(),
    Etablissement.findById(etablissementId).select('espaces').lean(),
  ]);

  if (!base) throw notFound('Aucune base pour cette année scolaire', { code: 'BASE_ABSENTE' });

  // ⚠️ Une contrainte sur un formateur inconnu ne s'appliquerait à personne.
  if (!(base.formateurs ?? []).some((f) => identifiant(f) === formateur)) {
    throw notFound('Formateur introuvable dans la base', { code: 'FORMATEUR_INTROUVABLE' });
  }

  const salles = etablissement?.espaces ?? [];

  // ⚠️ REFUSÉE PLUTÔT QU'IGNORÉE : une salle inconnue disparaîtrait sans un mot
  // et le formateur paraîtrait sans restriction.
  const inconnues = (espaces ?? []).filter((salle) => !salles.includes(salle));
  if (inconnues.length > 0) {
    throw badRequest(`Salle(s) inconnue(s) : ${inconnues.join(', ')}`, { code: 'SALLE_INCONNUE' });
  }

  const propre = normaliserContraintes({ espaces, indisponibilites }, salles);
  const champs = {};
  if (espaces !== undefined) champs.espaces = propre.espaces;
  if (indisponibilites !== undefined) champs.indisponibilites = propre.indisponibilites;

  const filtre = { etablissementId, anneeScolaire };
  await AutoGenConfig.updateOne(filtre, { $setOnInsert: filtre }, { upsert: true });

  const $set = Object.fromEntries(Object.entries(champs).map(([cle, v]) => [`contraintes.$.${cle}`, v]));
  const misAJour =
    Object.keys($set).length > 0
      ? await AutoGenConfig.updateOne({ ...filtre, 'contraintes.formateur': formateur }, { $set })
      : { matchedCount: 0 };

  if (misAJour.matchedCount === 0) {
    /*
     * ⚠️ LE `$ne` REND L'AJOUT ATOMIQUE : deux premières saisies simultanées sur
     * le même formateur ne créent pas deux entrées.
     */
    await AutoGenConfig.updateOne(
      { ...filtre, 'contraintes.formateur': { $ne: formateur } },
      { $push: { contraintes: { formateur, espaces: [], indisponibilites: [], ...champs } } }
    );
  }

  const config = await AutoGenConfig.findOne(filtre).select('contraintes').lean();
  return presenter(config.contraintes.find((c) => c.formateur === formateur));
}
