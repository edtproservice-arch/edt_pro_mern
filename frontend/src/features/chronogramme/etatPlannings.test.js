import { describe, it, expect } from 'vitest';
import {
  amorcerPlannings,
  amorcerVersions,
  groupesModifies,
  integrerPlanning,
  omettreGroupes,
} from './etatPlannings.js';

const planning = (module, semaine, heures) => ({ [module]: { [semaine]: { heures, type: 'P' } } });

describe('amorcerPlannings', () => {
  it('verse un groupe qui vient d’arriver', () => {
    const charges = { GM101: planning('M101', 5, 7.5) };
    expect(amorcerPlannings({}, charges)).toEqual(charges);
  });

  it('NE TOUCHE PAS à une saisie en cours', () => {
    // Un rafraîchissement de cache ne doit pas effacer ce qu'on écrit.
    const enCours = planning('M101', 5, 10);
    const resultat = amorcerPlannings({ GM101: enCours }, { GM101: planning('M101', 5, 7.5) });
    expect(resultat.GM101).toBe(enCours);
  });

  it('retire un groupe décoché', () => {
    const resultat = amorcerPlannings({ GM101: {}, GM102: {} }, { GM101: {} });
    expect(Object.keys(resultat)).toEqual(['GM101']);
  });

  it('rend le MÊME objet quand rien ne change', () => {
    // Sinon chaque rendu en produirait un nouveau, et l'effet qui en dépend
    // repartirait en boucle.
    const courants = { GM101: planning('M101', 5, 7.5) };
    expect(amorcerPlannings(courants, { GM101: courants.GM101 })).toBe(courants);
  });

  it('IGNORE un groupe encore en vol', () => {
    /*
     * ⚠️ LE DÉFAUT QUI A COÛTÉ DES DONNÉES. Un groupe absent de `charges` n'a pas
     * répondu : l'amorcer à `{}` posait la clé, l'empêchait d'être repris à
     * l'arrivée des données, et le faisait ensuite passer pour modifié.
     */
    const resultat = amorcerPlannings({}, {});
    expect(resultat).toEqual({});
    expect('GM101' in resultat).toBe(false);
  });
});

describe('groupesModifies', () => {
  it('repère une cellule ajoutée', () => {
    expect(
      groupesModifies({ GM101: planning('M101', 5, 7.5) }, { GM101: {} })
    ).toEqual(['GM101']);
  });

  it('ne signale rien quand tout correspond', () => {
    const contenu = planning('M101', 5, 7.5);
    expect(groupesModifies({ GM101: contenu }, { GM101: structuredClone(contenu) })).toEqual([]);
  });

  it('repère un VIDAGE volontaire', () => {
    // « Réinitialiser » doit bien s'enregistrer : la règle ci-dessous ne
    // protège pas contre l'effacement voulu, seulement contre l'accidentel.
    expect(groupesModifies({ GM101: {} }, { GM101: planning('M101', 5, 7.5) })).toEqual(['GM101']);
  });

  it('⚠️ NE DÉCLARE JAMAIS MODIFIÉ un groupe qui n’a pas encore répondu', () => {
    /*
     * C'est l'invariant central. Un groupe absent de `charges` n'a pas d'état de
     * référence : le déclarer modifié demandait son écriture avant de savoir ce
     * qu'il contient — et l'enregistrement automatique écrasait sa grille avec
     * l'objet vide posé en attendant.
     */
    expect(groupesModifies({ GM101: {} }, {})).toEqual([]);
    expect(groupesModifies({ GM101: planning('M101', 5, 7.5) }, {})).toEqual([]);
  });

  it('n’interroge pas un groupe absent de l’état local', () => {
    expect(groupesModifies({}, { GM101: planning('M101', 5, 7.5) })).toEqual([]);
  });
});

describe('groupesModifies — la comparaison parle la langue du serveur', () => {
  /*
   * ═══ ⚠️⚠️ LE DÉFAUT « MODIFICATION EN ATTENTE » QUI NE PARTAIT JAMAIS ═══
   * (2026-08-26, signalé par le porteur.) `poserCellule` vide une cellule en
   * retirant sa clé — le module reste, à `{}`. Le serveur, lui, DROPPE un module
   * sans séance. La comparaison brute les déclarait différents à tout jamais :
   * `modifie` restait vrai, la minuterie ne se ré-armait pas, et l'en-tête
   * affichait « Modification en attente… » indéfiniment.
   */
  it('un module VIDÉ ne compte pas comme une modification', () => {
    const enBase = { GM101: { M1: { 5: { heures: 5, type: 'P' } } } };
    // Ce que la base rend après l'enregistrement : le module a disparu.
    const apresEnregistrement = { GM101: {} };
    // Ce que l'écran garde : la clé du module, à vide.
    const aLEcran = { GM101: { M1: {} } };

    expect(groupesModifies(aLEcran, apresEnregistrement)).toEqual([]);
    // Et il compte bien tant que l'écriture n'a pas eu lieu.
    expect(groupesModifies(aLEcran, enBase)).toEqual(['GM101']);
  });

  it('une cellule à ZÉRO ne compte pas non plus', () => {
    expect(
      groupesModifies({ GM101: { M1: { 5: { heures: 0, type: 'P' } } } }, { GM101: {} })
    ).toEqual([]);
  });

  /* ⚠️ L'ORDRE DES CLÉS NE DOIT PAS COMPTER : deux objets identiques au sens
     métier mais sérialisés différemment feraient repartir un enregistrement. */
  it('ignore l’ordre des modules et des semaines', () => {
    const a = { G: { B: { 2: { heures: 5, type: 'P' } }, A: { 10: { heures: 5, type: 'P' } } } };
    const b = { G: { A: { 10: { heures: 5, type: 'P' } }, B: { 2: { heures: 5, type: 'P' } } } };
    expect(groupesModifies(a, b)).toEqual([]);
  });

  it('voit toujours une vraie modification', () => {
    expect(
      groupesModifies(
        { G: { M1: { 5: { heures: 7.5, type: 'P' } } } },
        { G: { M1: { 5: { heures: 5, type: 'P' } } } }
      )
    ).toEqual(['G']);
  });

  it('voit un changement de TYPE, à heures égales', () => {
    expect(
      groupesModifies(
        { G: { M1: { 5: { heures: 5, type: 'S' } } } },
        { G: { M1: { 5: { heures: 5, type: 'P' } } } }
      )
    ).toEqual(['G']);
  });
});

describe('amorcerPlannings — suivre ce qu’un collègue enregistre (étape d2)', () => {
  const avant = { GM101: { M1: { 1: { heures: 5, type: 'P' } } } };
  const apres = { GM101: { M1: { 1: { heures: 5, type: 'P' }, 2: { heures: 2.5, type: 'P' } } } };

  it('prend la nouvelle version d’un groupe qu’on n’a pas touché', () => {
    const suivants = amorcerPlannings(avant, apres, avant);
    expect(suivants.GM101).toBe(apres.GM101);
  });

  // ⚠️ La saisie en cours n'est jamais écrasée par une relecture.
  it('garde la saisie en cours, même si le serveur a changé', () => {
    const saisie = { GM101: { M1: { 1: { heures: 10, type: 'P' } } } };
    const suivants = amorcerPlannings(saisie, apres, avant);
    expect(suivants).toBe(saisie);
  });

  it('ne change rien quand le serveur rend la même chose', () => {
    const courants = { GM101: { M1: { 1: { heures: 5, type: 'P' } } } };
    expect(amorcerPlannings(courants, { GM101: { ...avant.GM101 } }, avant)).toBe(courants);
  });

  // Sans version précédente connue (premier tour), rien ne se remplace.
  it('ne remplace rien sans version précédente', () => {
    expect(amorcerPlannings(avant, apres)).toBe(avant);
  });
});

describe('amorcerVersions — la version sur laquelle repose la saisie (étape d3)', () => {
  const serveur = { GM101: { M1: { 3: { heures: 5, type: 'P' } } } };

  it('prend la version du serveur quand la copie locale lui est identique', () => {
    expect(amorcerVersions({ GM101: 2 }, { GM101: serveur.GM101 }, serveur, { GM101: 3 })).toEqual({ GM101: 3 });
  });

  // ⚠️ Le cas qui compte : une saisie en cours garde SA version — le 409 viendra de là.
  it('garde la version d’une saisie en cours quand un collègue a enregistré', () => {
    const local = { GM101: { M1: { 3: { heures: 10, type: 'P' } } } };
    expect(amorcerVersions({ GM101: 2 }, local, serveur, { GM101: 3 })).toEqual({ GM101: 2 });
  });

  // Par contenu : un collègue qui enregistre la même chose nous remet d'accord.
  it('rejoint le serveur quand le contenu coïncide, même par un autre objet', () => {
    const local = { GM101: { M1: { 3: { heures: 5, type: 'P' }, 4: {} } } };
    expect(amorcerVersions({ GM101: 2 }, local, serveur, { GM101: 3 })).toEqual({ GM101: 3 });
  });

  it('écarte un groupe que le serveur ne rend plus', () => {
    expect(amorcerVersions({ GM101: 2 }, { GM101: {} }, {}, {})).toEqual({});
  });
});

describe('omettreGroupes — l’adoption forcée après un 409', () => {
  it('retire les groupes, sans toucher les autres ni l’original', () => {
    const plannings = { GM101: { a: 1 }, GM102: { b: 2 } };
    expect(omettreGroupes(plannings, ['GM101'])).toEqual({ GM102: { b: 2 } });
    expect(plannings).toHaveProperty('GM101');
  });

  it('rend le même objet quand il n’y a rien à retirer', () => {
    const plannings = { GM101: {} };
    expect(omettreGroupes(plannings, [])).toBe(plannings);
  });

  // Retiré, le groupe est repris du serveur par l'amorçage, comme s'il arrivait.
  it('fait reprendre le groupe du serveur par l’amorçage', () => {
    const local = { GM101: { M1: { 3: { heures: 10, type: 'P' } } } };
    const serveur = { GM101: { M1: { 3: { heures: 5, type: 'P' } } } };
    expect(amorcerPlannings(omettreGroupes(local, ['GM101']), serveur, serveur).GM101).toBe(serveur.GM101);
  });
});

describe('integrerPlanning — le planning reçu avec l’annonce (2026-09-13)', () => {
  const planning = { M101: { 3: { heures: 5, type: 'P' } } };
  const annonce = { groupe: 'GM101', planning, version: 4 };

  it('pose le planning et sa version dans la réponse d’un groupe', () => {
    const donnees = { groupe: 'GM101', modules: [1], planning: {}, version: 3 };
    expect(integrerPlanning(donnees, annonce)).toEqual({ groupe: 'GM101', modules: [1], planning, version: 4 });
  });

  // ⚠️ Une annonce en retard sur une relecture ne doit pas faire reculer la grille.
  it('ignore une version déjà dépassée, et rend le même objet', () => {
    const donnees = { groupe: 'GM101', planning: {}, version: 4 };
    expect(integrerPlanning(donnees, annonce)).toBe(donnees);
  });

  it('n’applique pas l’annonce d’un autre groupe', () => {
    const donnees = { groupe: 'GM102', planning: {}, version: 0 };
    expect(integrerPlanning(donnees, annonce)).toBe(donnees);
  });

  it('pose le planning du groupe dans la réponse d’un formateur', () => {
    const donnees = { lignes: [], plannings: { GM101: {}, GM102: { x: 1 } }, versions: { GM101: 3, GM102: 1 } };
    const resultat = integrerPlanning(donnees, annonce);
    expect(resultat.plannings).toEqual({ GM101: planning, GM102: { x: 1 } });
    expect(resultat.versions).toEqual({ GM101: 4, GM102: 1 });
  });

  it('pose le premier enregistrement d’un groupe que la réponse ne portait pas encore', () => {
    const donnees = { lignes: [{ groupe: 'GM101', code: 'M101' }], plannings: {}, versions: {} };
    const resultat = integrerPlanning(donnees, annonce);
    expect(resultat.plannings).toEqual({ GM101: planning });
    expect(resultat.versions).toEqual({ GM101: 4 });
  });

  // Un formateur qui n'enseigne pas à ce groupe n'a rien à recevoir.
  it('laisse la réponse d’un formateur qui ne touche pas ce groupe', () => {
    const donnees = { plannings: { GM102: {} }, versions: { GM102: 1 } };
    expect(integrerPlanning(donnees, annonce)).toBe(donnees);
  });

  it('ignore une annonce sans planning ni version', () => {
    const donnees = { groupe: 'GM101', planning: {}, version: 0 };
    expect(integrerPlanning(donnees, { groupe: 'GM101' })).toBe(donnees);
    expect(integrerPlanning(undefined, annonce)).toBeUndefined();
  });
});
