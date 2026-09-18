import { describe, it, expect } from 'vitest';
import {
  SEUIL_ACHEVEMENT,
  completionModules,
  datesDeLaPlage,
  plageDeSemaines,
} from './completion.js';

/**
 * ⚠️ LA FORME RÉELLE D'UNE LIGNE, celle que rend `lignesDepuisAffectations` :
 * deux masses par TYPE, jamais leur somme. Ma première fixture inventait `prevu`
 * et `realise` — champs que seule l'AGRÉGATION produit — et le bilan sortait
 * donc vide sur les données réelles alors que les tests passaient.
 */
const ligne = (surcharges = {}) => ({
  groupe: 'GM101',
  module: 'M101',
  formateurPresentiel: 'BRAHIM LOURID',
  formateurSynchrone: '',
  prevuPresentiel: 100,
  prevuSynchrone: 0,
  realisePresentiel: 50,
  realiseSynchrone: 0,
  semestre: 'S1',
  estRegional: false,
  ...surcharges,
});

describe('completionModules', () => {
  it('compte les modules achevés et ceux en cours', () => {
    const bilan = completionModules([
      ligne({ groupe: 'GM101', realisePresentiel: 100 }),
      ligne({ groupe: 'GM102', realisePresentiel: 50 }),
    ]);

    expect(bilan).toMatchObject({ acheves: 1, enCours: 1, total: 2, taux: 50 });
  });

  /*
   * ⚠️ 95 %, LE SEUIL DE L'EXISTANT : un module dont il reste une demi-séance est
   * tenu pour fait. L'écart avec 100 % est assumé — c'est le chiffre que les
   * établissements connaissent.
   */
  it('tient un module pour achevé dès 95 %', () => {
    expect(completionModules([ligne({ realisePresentiel: 95 })]).acheves).toBe(1);
    expect(completionModules([ligne({ realisePresentiel: 94.9 })]).acheves).toBe(0);
    expect(SEUIL_ACHEVEMENT).toBe(95);
  });

  /*
   * ⚠️ SANS MASSE AFFECTÉE, LE MODULE NE COMPTE PAS — ni au numérateur ni au
   * dénominateur. L'inclure ferait plonger le taux d'achèvement pour une raison
   * qui n'est pas pédagogique.
   */
  it('écarte un module sans masse affectée', () => {
    const bilan = completionModules([ligne({ prevuPresentiel: 0, realisePresentiel: 0 }), ligne()]);
    expect(bilan.total).toBe(1);
  });

  /*
   * ⚠️ UN MODULE EST UN COUPLE (GROUPE, MODULE) : « M101 » peut être achevé pour
   * GM101 et pas pour GM102. Les réunir masquerait exactement le retard qu'on
   * vient chercher.
   */
  it('traite chaque groupe séparément pour un même module', () => {
    const bilan = completionModules([
      ligne({ groupe: 'GM101', realisePresentiel: 100 }),
      ligne({ groupe: 'GM102', realisePresentiel: 0 }),
    ]);

    expect(bilan.total).toBe(2);
    expect(bilan.details.map((d) => d.groupe)).toEqual(['GM102', 'GM101']);
  });

  // « En cours » d'abord : c'est la liste de ce qu'il reste à faire.
  it('range les modules en cours avant les achevés', () => {
    const bilan = completionModules([
      ligne({ groupe: 'AAA', realisePresentiel: 100 }),
      ligne({ groupe: 'ZZZ', realisePresentiel: 10 }),
    ]);

    expect(bilan.details.map((d) => d.acheve)).toEqual([false, true]);
  });

  /*
   * ⚠️ LES DEUX FORMATEURS : le présentiel et le synchrone d'un même module
   * peuvent être assurés par deux personnes. N'en nommer qu'une attribuerait le
   * module à qui n'en fait que la moitié.
   */
  it('nomme les deux formateurs, sans doublon', () => {
    const [seul] = completionModules([ligne({ formateurSynchrone: 'BRAHIM LOURID' })]).details;
    expect(seul.formateurs).toEqual(['BRAHIM LOURID']);

    const [deux] = completionModules([ligne({ formateurSynchrone: 'ZINEB EL OMARI' })]).details;
    expect(deux.formateurs).toEqual(['BRAHIM LOURID', 'ZINEB EL OMARI']);
  });

  /*
   * ⚠️ LE TEST QUI MANQUAIT : les deux types s'additionnent. Sans lui, une ligne
   * dont toute la masse est SYNCHRONE passait pour vide — et c'est cette
   * confusion entre la forme d'une LIGNE et celle d'un AGRÉGAT qui a fait sortir
   * le bilan à zéro sur les données réelles.
   */
  it('additionne le présentiel et le synchrone de la ligne', () => {
    const [detail] = completionModules([
      ligne({ prevuPresentiel: 30, prevuSynchrone: 20, realisePresentiel: 15, realiseSynchrone: 20 }),
    ]).details;

    expect(detail.prevu).toBe(50);
    expect(detail.realise).toBe(35);
    expect(detail.taux).toBe(70);
  });

  it('compte une ligne entièrement synchrone', () => {
    const bilan = completionModules([
      ligne({ prevuPresentiel: 0, prevuSynchrone: 40, realisePresentiel: 0, realiseSynchrone: 40 }),
    ]);

    expect(bilan.total).toBe(1);
    expect(bilan.acheves).toBe(1);
  });

  it('rend un bilan vide plutôt que de lever, sans ligne', () => {
    expect(completionModules()).toMatchObject({ total: 0, acheves: 0, taux: null });
  });
});

describe('plageDeSemaines', () => {
  /*
   * ⚠️ ON TRIE SUR LE NUMÉRO, jamais sur la chaîne : « S10 » précède « S2 » en
   * ordre alphabétique, et la plage se lirait à l'envers.
   */
  it('rend la première et la dernière semaine', () => {
    expect(plageDeSemaines([10, 2, 7])).toEqual({ debut: 2, fin: 10 });
  });

  it('ignore les valeurs illisibles', () => {
    expect(plageDeSemaines([0, -3, null, 'S4', 5])).toEqual({ debut: 5, fin: 5 });
  });

  it('rend null quand aucune semaine n’est occupée', () => {
    expect(plageDeSemaines([])).toBeNull();
    expect(plageDeSemaines()).toBeNull();
  });
});

describe('datesDeLaPlage', () => {
  /*
   * 2026-2027 : la S1 commence le lundi 31 août 2026. La S3 commence donc le
   * 14 septembre, et se termine le SAMEDI 19.
   */
  it('va du lundi de la première au samedi de la dernière', () => {
    expect(datesDeLaPlage(2026, { debut: 1, fin: 3 })).toEqual({
      debut: '2026-08-31',
      fin: '2026-09-19',
    });
  });

  /*
   * ⚠️ LA FIN EST UN SAMEDI, PAS UN VENDREDI. L'existant forçait `+4 days` : un
   * module qui finit le samedi voyait sa plage close la veille, et la grille
   * porte bien six jours.
   */
  it('ferme la plage au samedi, six jours après le lundi', () => {
    const plage = datesDeLaPlage(2026, { debut: 1, fin: 1 });
    expect(new Date(`${plage.fin}T12:00:00`).getDay()).toBe(6);
  });

  it('rend null sur une entrée inexploitable', () => {
    expect(datesDeLaPlage(2026, null)).toBeNull();
    expect(datesDeLaPlage(null, { debut: 1, fin: 2 })).toBeNull();
  });
});
