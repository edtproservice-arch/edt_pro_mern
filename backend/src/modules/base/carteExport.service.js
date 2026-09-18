import {
  ENTETES_ENOTE,
  calculerBilan,
  carteVersLignesEnote,
  construireEnsembles,
  estActif,
  heuresPresentiel,
  heuresSynchrone,
} from 'shared/domain';
import { ajouterFeuille, feuillesBilan, nouveauClasseur } from './bilan.service.js';
import { completerColonnesServeur, effectifsParGroupe } from './carte.service.js';

/**
 * Export complet de la carte d'établissement.
 * ← exportCarteExcel() de affectation-carte.js:3745-3878
 *
 * ═══ LA PREMIÈRE FEUILLE EST LA PLUS IMPORTANTE ═══
 * « AvancementProgramme » porte la carte au format e-note, en-tête compris.
 * C'est le nom de feuille que cherche l'import : le fichier exporté est donc
 * DIRECTEMENT RÉIMPORTABLE, ici ou dans l'emploi du temps. C'est ce qui permet
 * à un établissement de transmettre sa carte, de la reprendre l'année suivante,
 * ou de la reconstruire après une fausse manœuvre.
 *
 * Les lignes sont produites par `carteVersLignesEnote()` — la MÊME fonction que
 * l'enregistrement — puis complétées par les deux colonnes que seul le serveur
 * connaît (effectif du groupe, code de fusion). Exporter et enregistrer partent
 * donc rigoureusement des mêmes données.
 */
export async function construireClasseurCarte({ carte, anneeScolaire, etablissementId }) {
  const effectifs = await effectifsParGroupe(etablissementId, anneeScolaire);

  const lignes = carteVersLignesEnote(carte, anneeScolaire);
  await completerColonnesServeur(lignes, etablissementId, anneeScolaire, effectifs);

  const classeur = nouveauClasseur();

  ajouterFeuille(classeur, {
    nom: 'AvancementProgramme',
    entete: ENTETES_ENOTE,
    lignes,
  });

  ajouterFeuille(classeur, feuilleAffectations(carte, effectifs));
  ajouterFeuille(classeur, feuilleGroupes(carte, effectifs));

  for (const feuille of feuillesBilan(calculerBilan(carte))) ajouterFeuille(classeur, feuille);

  return {
    tampon: Buffer.from(await classeur.xlsx.writeBuffer()),
    nomFichier: `Carte_etablissement_${anneeScolaire}-${anneeScolaire + 1}.xlsx`,
    resume: {
      groupes: carte.groupes.length,
      lignes: lignes.length,
      formateurs: carte.formateurs.length,
    },
  };
}

const effectif = (effectifs, nomGroupe) => effectifs.get(String(nomGroupe).toUpperCase()) ?? 0;

/** Groupes triés comme à l'écran : ordre naturel, « DEV2 » avant « DEV10 ». */
function groupesTries(carte) {
  return [...carte.groupes].sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }));
}

/**
 * Une ligne par groupe × module — la carte lisible.
 * ← la feuille « Affectations »
 *
 * Contrairement à « AvancementProgramme », faite pour être relue par la
 * machine, celle-ci est faite pour être lue par une personne : intitulés en
 * clair, heures ventilées, et les deux formateurs côte à côte.
 */
function feuilleAffectations(carte, effectifs) {
  const matricules = new Map(
    carte.formateurs.map((f) => [String(f.nom).trim().toUpperCase(), f.matricule ?? ''])
  );
  const matriculeDe = (nom) => matricules.get(String(nom ?? '').trim().toUpperCase()) ?? '';

  const lignes = [];

  for (const groupe of groupesTries(carte)) {
    const modules = [...(groupe.modules ?? [])].sort((a, b) =>
      String(a.code ?? a.nom).localeCompare(String(b.code ?? b.nom), 'fr', { numeric: true })
    );

    for (const module of modules) {
      const mhsynS1 = module.mhsynS1 ?? 0;
      const mhsynS2 = module.mhsynS2 ?? 0;

      lignes.push([
        groupe.codeFiliere ?? '',
        groupe.intituleFiliere ?? '',
        groupe.anneeFormation ?? '',
        groupe.nom,
        groupe.mode ?? '',
        effectif(effectifs, groupe.nom),
        module.code ?? '',
        module.nom ?? '',
        module.estRegional ? 'Oui' : 'Non',
        // Un module désactivé reste dans le fichier, signalé : le retirer
        // laisserait croire qu'il n'existe pas, alors qu'il est seulement
        // non dispensé cette année.
        estActif(module) ? 'Oui' : 'Non',
        module.mhpS1 ?? 0,
        module.mhpS2 ?? 0,
        heuresPresentiel(module),
        mhsynS1,
        mhsynS2,
        heuresSynchrone(module),
        module.formateurPresentiel ?? '',
        matriculeDe(module.formateurPresentiel),
        module.formateurSynchrone ?? '',
        matriculeDe(module.formateurSynchrone),
        module.groupeFusion ?? '',
      ]);
    }
  }

  return {
    nom: 'Affectations',
    entete: [
      'Code filière',
      'Filière',
      'Année de formation',
      'Groupe',
      'Mode',
      'Effectif',
      'Code module',
      'Module',
      'EFM régional',
      'Module actif',
      'MHP S1',
      'MHP S2',
      'MHP totale',
      'MHSYN S1',
      'MHSYN S2',
      'MHSYN totale',
      'Formateur présentiel',
      'Mle présentiel',
      'Formateur synchrone',
      'Mle synchrone',
      'Groupes fusionnés',
    ],
    lignes,
  };
}

/**
 * Une ligne par groupe — l'état d'avancement de la carte.
 * ← la feuille « Groupes »
 *
 * Le taux d'affectation reprend la règle de la pastille d'avancement : seuls
 * les modules ACTIFS comptent, sans quoi un établissement qui désactive dix
 * modules paraîtrait à jamais incomplet.
 */
function feuilleGroupes(carte, effectifs) {
  // Le synchrone est mutualisé : une séance couvre plusieurs groupes mais n'est
  // comptée qu'une fois par ensemble. On retrouve l'ensemble de chaque groupe
  // pour ne pas gonfler les heures affichées ici.
  const ensembleDe = new Map();
  for (const ensemble of construireEnsembles(carte.groupes)) {
    for (const groupe of ensemble.groupes) ensembleDe.set(groupe.nom, ensemble.cle);
  }

  const lignes = groupesTries(carte).map((groupe) => {
    const actifs = (groupe.modules ?? []).filter(estActif);
    const affectes = actifs.filter((module) => module.formateurPresentiel).length;

    const mhp = actifs.reduce((somme, module) => somme + heuresPresentiel(module), 0);
    const mhsynAffectee = actifs
      .filter((module) => module.formateurSynchrone)
      .reduce((somme, module) => somme + heuresSynchrone(module), 0);

    return [
      groupe.codeFiliere ?? '',
      groupe.intituleFiliere ?? '',
      groupe.anneeFormation ?? '',
      groupe.nom,
      groupe.mode ?? '',
      effectif(effectifs, groupe.nom),
      actifs.length,
      affectes,
      actifs.length > 0 ? Math.round((affectes / actifs.length) * 100) : 0,
      Math.round(mhp * 100) / 100,
      Math.round(mhsynAffectee * 100) / 100,
    ];
  });

  return {
    nom: 'Groupes',
    entete: [
      'Code filière',
      'Filière',
      'Année de formation',
      'Groupe',
      'Mode',
      'Effectif',
      'Modules actifs',
      'Modules affectés',
      "Taux d'affectation (%)",
      'MHP totale (h)',
      'MHSYN affectée (h)',
    ],
    lignes,
  };
}
