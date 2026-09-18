import { Base } from '../../models/Base.js';
import { EnoteImport } from '../../models/EnoteImport.js';
import { notFound } from '../../lib/httpError.js';

/**
 * Consultation de la base d'un établissement (F3, F4).
 * ← api/data/get_base_data.php
 */

/**
 * Base de l'année, ou `null` si l'établissement n'a encore rien importé.
 *
 * `null` est un état ATTENDU — un directeur qui vient de s'inscrire n'a pas de
 * base. L'existant renvoyait une erreur HTTP dans ce cas, ce qui remplissait la
 * console du navigateur d'erreurs sans qu'il se passe rien d'anormal.
 */
export async function obtenir(etablissementId, anneeScolaire) {
  const base = await Base.findOne({ etablissementId, anneeScolaire });
  if (!base) return null;

  return {
    id: base.id,
    anneeScolaire: base.anneeScolaire,
    origine: base.origine,
    formateurs: base.formateurs.map((formateur) => ({
      matricule: formateur.matricule,
      nomComplet: formateur.nomComplet,
      nomUnique: formateur.nomUnique,
      email: formateur.email,
      masseHoraire: formateur.masseHoraire,
    })),
    groupes: base.groupes,
    fusionGroupes: base.fusionGroupes,
    groupeModes: Object.fromEntries(base.groupeModes ?? []),
    /*
     * ⚠️ SANS CETTE LIGNE, LA DÉSACTIVATION N'ARRIVE PAS À L'ÉCRAN. Le champ
     * serait bien enregistré, mais la carte se reconstruit à partir de CE
     * présentateur : le module reviendrait actif, et la correction du modèle
     * n'aurait servi à rien. C'est le même oubli que `espaces`, qui rendait la
     * page vide et faisait effacer les salles au premier enregistrement.
     */
    modulesInactifs: Object.fromEntries(base.modulesInactifs ?? []),
    groupeFilieres: Object.fromEntries(base.groupeFilieres ?? []),
    affectations: base.affectations,
    // La version que la carte renverra (étape d3).
    version: base.version ?? 0,
    misAJourLe: base.updatedAt,
  };
}

/** Résumé chiffré, pour les écrans qui n'ont pas besoin du détail. */
export async function resumer(etablissementId, anneeScolaire) {
  const base = await Base.findOne({ etablissementId, anneeScolaire }).select(
    'formateurs groupes fusionGroupes affectations origine updatedAt'
  );

  if (!base) {
    return { existe: false, formateurs: 0, groupes: 0, affectations: 0 };
  }

  return {
    existe: true,
    origine: base.origine,
    formateurs: base.formateurs.length,
    groupes: base.groupes.length,
    fusionGroupes: base.fusionGroupes.length,
    affectations: base.affectations.length,
    misAJourLe: base.updatedAt,
  };
}

/** Historique des imports, du plus récent au plus ancien. */
export async function listerImports(etablissementId, anneeScolaire) {
  const imports = await EnoteImport.find({ etablissementId, anneeScolaire })
    .select('nomFichier importeLe importePar lignes')
    .sort({ importeLe: -1 })
    .limit(50);

  return imports.map((enregistrement) => ({
    id: enregistrement.id,
    nomFichier: enregistrement.nomFichier,
    lignes: enregistrement.lignes.length,
    importeLe: enregistrement.importeLe,
    importePar: enregistrement.importePar,
  }));
}

/**
 * Corrections des fiches formateurs, en lot.
 * ← l'étape 2 de public/setup.html:515-545
 *
 * Le formateur est désigné par son `nomComplet` et non par son matricule :
 * c'est justement le matricule qui peut être absent ou faux, et que cet écran
 * sert à corriger. `nomComplet` est la clé produite par l'import
 * (`parseBase.js`), stable dans une base donnée.
 *
 * Écriture en un seul `save()` : les corrections sont validées ensemble ou pas
 * du tout. Une application partielle laisserait la moitié des formateurs
 * corrigés sans que personne sache lesquels.
 */
export async function corrigerFormateurs(etablissementId, anneeScolaire, corrections) {
  const base = await Base.findOne({ etablissementId, anneeScolaire });
  if (!base) throw notFound('Aucune base pour cette année', { code: 'BASE_ABSENTE' });

  const parNom = new Map(base.formateurs.map((formateur) => [formateur.nomComplet, formateur]));
  const inconnus = [];

  for (const correction of corrections) {
    const formateur = parNom.get(correction.nomComplet);
    if (!formateur) {
      inconnus.push(correction.nomComplet);
      continue;
    }

    if (correction.matricule !== undefined) formateur.matricule = correction.matricule;
    if (correction.email !== undefined) formateur.email = correction.email;
    if (correction.masseHoraire !== undefined) formateur.masseHoraire = correction.masseHoraire;
  }

  if (inconnus.length > 0) {
    throw notFound(`Formateur introuvable : ${inconnus.join(', ')}`, {
      code: 'FORMATEUR_INCONNU',
      details: { inconnus },
    });
  }

  /*
   * ⚠️ UNE CORRECTION AVANCE LA VERSION DE LA BASE (étape d3). Un matricule
   * corrigé ici serait sinon ÉCRASÉ par la carte d'un collègue ouverte avant :
   * elle renvoie ses formateurs tels qu'elle les a lus, et le parseur recrée la
   * base à partir d'eux. Avancée, la version fait refuser cette carte périmée.
   */
  base.version = (base.version ?? 0) + 1;
  await base.save();
  return { corriges: corrections.length, version: base.version };
}

/** Masse horaire statutaire d'un formateur, corrigée par l'établissement. */
export async function definirMasseHoraire(etablissementId, anneeScolaire, matricule, masseHoraire) {
  const base = await Base.findOne({ etablissementId, anneeScolaire });
  if (!base) throw notFound('Aucune base pour cette année', { code: 'BASE_ABSENTE' });

  const formateur = base.formateurs.find(
    (candidat) => String(candidat.matricule).trim() === String(matricule).trim()
  );
  if (!formateur) throw notFound('Formateur introuvable', { code: 'FORMATEUR_INCONNU' });

  formateur.masseHoraire = masseHoraire;
  // Même raison que les corrections : une carte ouverte avant ne doit pas l'écraser.
  base.version = (base.version ?? 0) + 1;
  await base.save();

  return { matricule: formateur.matricule, masseHoraire: formateur.masseHoraire };
}
