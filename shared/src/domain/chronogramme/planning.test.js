import { describe, it, expect } from 'vitest';
import { TYPES, capaciteSemaine, poserCellule, resteAPlanifier, totalSemaine, totauxModule, verifierCellule } from './planning.js';

const pleine = (numero = 3) => ({ numero, disponible: true, joursDisponibles: 6, motif: null });
const masses = { presentiel: 60, synchrone: 20 };

describe('totauxModule', () => {
  const planning = {
    M101: {
      1: { heures: 5, type: TYPES.PRESENTIEL },
      2: { heures: 2.5, type: TYPES.PRESENTIEL },
      3: { heures: 5, type: TYPES.SYNCHRONE },
    },
  };

  it('sépare présentiel et synchrone', () => {
    expect(totauxModule(planning, 'M101')).toEqual({ presentiel: 7.5, synchrone: 5 });
  });

  it('EXCLUT la semaine qu’on est en train de modifier', () => {
    /*
     * Sans cette exclusion, la cellule modifiée serait comptée deux fois — son
     * ancienne valeur et la nouvelle — et toute augmentation paraîtrait
     * dépasser la masse horaire.
     */
    expect(totauxModule(planning, 'M101', { saufSemaine: 1 }).presentiel).toBe(2.5);
  });

  it('rend zéro sur un module inconnu', () => {
    expect(totauxModule(planning, 'INEXISTANT')).toEqual({ presentiel: 0, synchrone: 0 });
    expect(totauxModule(undefined, 'M101')).toEqual({ presentiel: 0, synchrone: 0 });
  });
});

describe('totalSemaine', () => {
  it('somme la COLONNE, tous modules confondus', () => {
    const planning = {
      M101: { 4: { heures: 5, type: TYPES.PRESENTIEL } },
      M102: { 4: { heures: 2.5, type: TYPES.SYNCHRONE }, 5: { heures: 10, type: TYPES.PRESENTIEL } },
    };

    expect(totalSemaine(planning, 4)).toBe(7.5);
    expect(totalSemaine(planning, 5)).toBe(10);
    expect(totalSemaine(planning, 9)).toBe(0);
  });
});

describe('verifierCellule', () => {
  const base = { planning: {}, module: 'M101', heures: 5, type: TYPES.PRESENTIEL, masses };

  it('accepte une valeur régulière', () => {
    expect(verifierCellule({ ...base, semaine: pleine() }).possible).toBe(true);
  });

  it('refuse une semaine de vacances, en le DISANT', () => {
    const resultat = verifierCellule({
      ...base,
      semaine: { numero: 3, disponible: false, motif: 'vacances' },
    });

    expect(resultat.possible).toBe(false);
    expect(resultat.motif).toMatch(/vacances/i);
  });

  it('refuse une semaine de stage, avec son propre motif', () => {
    const resultat = verifierCellule({
      ...base,
      semaine: { numero: 3, disponible: false, motif: 'stage' },
    });

    expect(resultat.motif).toMatch(/stage/i);
  });

  it('refuse une valeur hors du pas de 2,5 h', () => {
    expect(verifierCellule({ ...base, heures: 3, semaine: pleine() }).possible).toBe(false);
  });

  it('refuse au-delà du plafond RÉDUIT d’une semaine amputée', () => {
    /*
     * UN seul jour ouvert → 10 h au plus, même si 20 h passeraient une semaine
     * pleine. C'est le cas donné par le porteur : un groupe parti 5 jours en
     * stage ne laisse qu'une journée, et une journée porte quatre créneaux de
     * 2,5 h.
     */
    const semaine = { numero: 3, disponible: true, joursDisponibles: 1, motif: null };
    const resultat = verifierCellule({ ...base, heures: 15, semaine });

    expect(resultat.possible).toBe(false);
    expect(resultat.plafond).toBe(10);
    expect(resultat.motif).toMatch(/1 jour/);
  });

  /*
   * ⚠️ ET UNE SEMAINE AMPUTÉE DE PEU RESTE PLEINEMENT SAISISSABLE : trois jours
   * ouverts contiennent trente heures, bien plus que le plafond d'une cellule.
   * L'ancienne proportion les ramenait à 10 h et refusait des saisies tenables.
   */
  it('trois jours ouverts acceptent encore le plafond entier', () => {
    const semaine = { numero: 3, disponible: true, joursDisponibles: 3, motif: null };
    expect(verifierCellule({ ...base, heures: 20, semaine }).possible).toBe(true);
  });

  it('refuse un dépassement de la masse horaire, par TYPE', () => {
    const planning = { M101: { 1: { heures: 57.5, type: TYPES.PRESENTIEL } } };

    // 57,5 + 5 = 62,5 h pour 60 h de présentiel → refusé…
    expect(verifierCellule({ ...base, planning, semaine: pleine() }).possible).toBe(false);

    // …mais les mêmes 5 h en SYNCHRONE passent : les deux masses sont distinctes.
    expect(
      verifierCellule({ ...base, planning, semaine: pleine(), type: TYPES.SYNCHRONE }).possible
    ).toBe(true);
  });

  it('laisse passer quand aucune masse n’est déclarée', () => {
    // Un module sans masse horaire connue ne doit pas bloquer la saisie : c'est
    // à l'établissement de la renseigner, pas au chronogramme de l'inventer.
    const resultat = verifierCellule({ ...base, semaine: pleine(), masses: {} });
    expect(resultat.possible).toBe(true);
  });
});

describe('poserCellule', () => {
  it('pose une valeur', () => {
    const planning = poserCellule({}, 'M101', 3, 5, TYPES.PRESENTIEL);
    expect(planning.M101[3]).toEqual({ heures: 5, type: TYPES.PRESENTIEL });
  });

  it('RETIRE la cellule quand les heures tombent à zéro', () => {
    /*
     * Une cellule conservée à 0 compterait comme une séance prévue dans
     * l'export et dans la comparaison « planifié vs réalisé ».
     */
    const planning = poserCellule({ M101: { 3: { heures: 5, type: 'P' } } }, 'M101', 3, 0, 'P');
    expect(planning.M101[3]).toBeUndefined();
  });

  it('ne touche pas les autres modules ni les autres semaines', () => {
    const depart = {
      M101: { 1: { heures: 5, type: 'P' } },
      M102: { 1: { heures: 2.5, type: 'S' } },
    };
    const planning = poserCellule(depart, 'M101', 2, 5, 'P');

    expect(planning.M101[1]).toEqual({ heures: 5, type: 'P' });
    expect(planning.M102).toEqual(depart.M102);
    // Immuable : l'objet de départ n'est pas modifié.
    expect(depart.M101[2]).toBeUndefined();
  });
});

describe('resteAPlanifier', () => {
  it('dit ce qui reste, par type', () => {
    const planning = {
      M101: { 1: { heures: 20, type: 'P' }, 2: { heures: 5, type: 'S' } },
    };

    expect(resteAPlanifier(planning, 'M101', masses)).toEqual({ presentiel: 40, synchrone: 15 });
  });

  it('ne descend jamais sous zéro', () => {
    // Une masse corrigée à la baisse APRÈS la saisie rendrait un reste négatif,
    // qui se lirait comme « il manque -10 h ».
    const planning = { M101: { 1: { heures: 80, type: 'P' } } };
    expect(resteAPlanifier(planning, 'M101', masses).presentiel).toBe(0);
  });
});

describe('verifierCellule — le garde de la SEMAINE, tous modules confondus', () => {
  /*
   * ═══ ⚠️ CE QUI MANQUAIT ═══ (garde signalé par le porteur, 2026-08-26.)
   * Le plafond de CELLULE borne un module ; il n'empêchait pas trois modules de
   * poser 10 h chacun dans une semaine où il ne reste qu'une journée. Le
   * chronogramme promettait alors trente heures dans une seule journée.
   */
  const base = { planning: {}, module: 'M1', masses: { presentiel: 200, synchrone: 0 } };
  const uneJournee = { numero: 5, disponible: true, joursDisponibles: 1, motif: null };

  it('refuse ce qui dépasse la capacité de la semaine', () => {
    const resultat = verifierCellule({ ...base, heures: 5, semaine: uneJournee, posesSemaine: 7.5 });

    expect(resultat.possible).toBe(false);
    expect(resultat.plafond).toBe(10);
    expect(resultat.motif).toMatch(/semaine/i);
  });

  it('accepte ce qui tient exactement dans la journée restante', () => {
    expect(
      verifierCellule({ ...base, heures: 2.5, semaine: uneJournee, posesSemaine: 7.5 }).possible
    ).toBe(true);
  });

  /*
   * ⚠️ LA CAPACITÉ DE LA SEMAINE N'EST PAS LE PLAFOND D'UNE CELLULE : celui-ci
   * borne AUSSI à 20 h, ce qui n'a de sens que pour un module. Six jours ouvrés
   * portent soixante heures, et trois modules à 20 h y tiennent.
   */
  it('une semaine PLEINE porte bien plus que le plafond d’une cellule', () => {
    const pleine = { numero: 5, disponible: true, joursDisponibles: 6, motif: null };
    expect(capaciteSemaine(pleine)).toBe(60);
    expect(verifierCellule({ ...base, heures: 20, semaine: pleine, posesSemaine: 40 }).possible).toBe(
      true
    );
  });

  /*
   * ⚠️ OMIS, LE CONTRÔLE NE S'APPLIQUE PAS : l'appelant seul sait dédoublonner
   * une séance synchrone mutualisée. Le plafond de cellule, lui, joue toujours.
   */
  it('sans `posesSemaine`, le contrôle hebdomadaire est ignoré', () => {
    expect(verifierCellule({ ...base, heures: 10, semaine: uneJournee }).possible).toBe(true);
  });
});
