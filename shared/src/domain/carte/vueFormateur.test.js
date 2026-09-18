import { describe, it, expect } from 'vitest';
import { calculerCharges } from './bilanCharge.js';
import { affectationsDuFormateur, placesDisponibles } from './vueFormateur.js';

/** Un module de la carte, dans la forme que produit la projection. */
const module = (code, champs = {}) => ({
  code,
  nom: `Intitulé ${code}`,
  mhpS1: 0,
  mhpS2: 0,
  mhsynS1: 0,
  mhsynS2: 0,
  ...champs,
});

const groupe = (nom, modules, champs = {}) => ({
  nom,
  codeFiliere: 'GM',
  intituleFiliere: 'Génie Mécanique',
  anneeFormation: 1,
  mode: 'Résidentiel',
  modules,
  ...champs,
});

describe('affectationsDuFormateur', () => {
  it('rend le présentiel d’un formateur, groupe par groupe', () => {
    const groupes = [
      groupe('GM101', [module('M101', { mhpS1: 30, formateurPresentiel: 'ZINEB' })]),
      groupe('GM102', [module('M101', { mhpS1: 30, formateurPresentiel: 'ZINEB' })]),
    ];

    const lignes = affectationsDuFormateur(groupes, 'zineb');

    expect(lignes).toHaveLength(2);
    expect(lignes.map((l) => l.groupes)).toEqual([['GM101'], ['GM102']]);
    expect(lignes.every((l) => l.type === 'presentiel' && l.total === 30)).toBe(true);
  });

  /*
   * ═══ ⚠️ LE POINT QUI COMPTE (choix du porteur, 2026-09-06) ═══
   * Une séance donnée à deux groupes à la fois est UNE séance : elle ne fait
   * qu'une ligne, et son total est celui d'une seule diffusion.
   */
  it('réunit une séance synchrone mutualisée en UNE ligne', () => {
    const synchrone = {
      mhsynS1: 20,
      formateurSynchrone: 'ZINEB',
      groupeFusion: 'GM101 GM102',
    };
    const groupes = [
      groupe('GM101', [module('EGQ102', synchrone)]),
      groupe('GM102', [module('EGQ102', synchrone)]),
    ];

    const lignes = affectationsDuFormateur(groupes, 'ZINEB');

    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ type: 'synchrone', total: 20 });
    expect(lignes[0].groupes).toEqual(['GM101', 'GM102']);
  });

  /*
   * ⚠️ ET LE TOTAL DE LA FICHE EST EXACTEMENT LA CHARGE QUE LE BILAN LUI
   * ATTRIBUE : c'est ce lien qui empêche les deux écrans de se contredire —
   * l'écart qu'a fallu corriger le même jour sur « Suivi de l'avancement ».
   */
  it('a le même total que `calculerCharges`, séance mutualisée comprise', () => {
    const synchrone = { mhsynS1: 20, formateurSynchrone: 'ZINEB', groupeFusion: 'GM101 GM102' };
    const groupes = [
      groupe('GM101', [
        module('M101', { mhpS1: 30, formateurPresentiel: 'ZINEB' }),
        module('EGQ102', synchrone),
      ]),
      groupe('GM102', [module('EGQ102', synchrone)]),
    ];

    const totalFiche = affectationsDuFormateur(groupes, 'ZINEB').reduce(
      (somme, ligne) => somme + ligne.total,
      0
    );

    expect(totalFiche).toBe(calculerCharges(groupes).get('ZINEB').total);
    expect(totalFiche).toBe(50); // 30 de présentiel + 20 d'UNE séance synchrone
  });

  it('ne rend rien pour un module désactivé', () => {
    const groupes = [
      groupe('GM101', [module('M101', { mhpS1: 30, formateurPresentiel: 'ZINEB', actif: false })]),
    ];
    expect(affectationsDuFormateur(groupes, 'ZINEB')).toEqual([]);
  });

  it('ignore la casse et les espaces du nom', () => {
    const groupes = [groupe('GM101', [module('M101', { mhpS1: 30, formateurPresentiel: 'ZINEB' })])];
    expect(affectationsDuFormateur(groupes, '  zineb ')).toHaveLength(1);
  });

  it('rend une liste vide sans nom', () => {
    const groupes = [groupe('GM101', [module('M101', { mhpS1: 30, formateurPresentiel: 'ZINEB' })])];
    expect(affectationsDuFormateur(groupes, '')).toEqual([]);
    expect(affectationsDuFormateur(groupes, null)).toEqual([]);
    expect(affectationsDuFormateur()).toEqual([]);
  });

  /*
   * ⚠️ UNE FUSION VIDE NE VEUT PAS DIRE « INCONNU » mais « fusionné avec
   * personne » : c'est ce qu'écrit la projection pour une séance à un seul
   * groupe. On retombe sur le nom du groupe, qui EST l'identité de la séance.
   */
  it('retombe sur le groupe quand la séance synchrone n’est fusionnée avec personne', () => {
    const groupes = [
      groupe('GM101', [module('EGQ102', { mhsynS1: 10, formateurSynchrone: 'ZINEB' })]),
    ];

    const [ligne] = affectationsDuFormateur(groupes, 'ZINEB');
    expect(ligne.groupes).toEqual(['GM101']);
    expect(ligne.cle).toBe('GM101||EGQ102||synchrone');
  });

  /* Le pendant synchrone du test ci-dessous : mêmes replis, même repli d'intitulé. */
  it('supporte une séance synchrone sans intitulé ni second semestre', () => {
    const groupes = [
      groupe('GM101', [{ code: 'EGQ102', mhsynS1: 10, formateurSynchrone: 'ZINEB' }]),
    ];

    const [ligne] = affectationsDuFormateur(groupes, 'ZINEB');
    expect(ligne).toMatchObject({ intitule: '', s1: 10, s2: 0, total: 10, estRegional: false });
  });

  it('additionne les deux semestres et retient l’EFM régional', () => {
    const groupes = [
      groupe('GM101', [
        module('M102', { mhpS1: 20, mhpS2: 25, formateurPresentiel: 'ZINEB', estRegional: true }),
      ]),
    ];

    const [ligne] = affectationsDuFormateur(groupes, 'ZINEB');
    expect(ligne).toMatchObject({ s1: 20, s2: 25, total: 45, estRegional: true });
  });

  it('supporte un groupe sans modules et un module sans intitulé', () => {
    const groupes = [
      groupe('GM101', undefined),
      groupe('GM102', [{ code: 'M101', mhpS1: 30, formateurPresentiel: 'ZINEB' }]),
    ];

    const lignes = affectationsDuFormateur(groupes, 'ZINEB');
    expect(lignes).toHaveLength(1);
    expect(lignes[0].intitule).toBe('');
  });

  /* ⚠️ Les deux rôles d'un même module sont DEUX lignes : ce sont deux
     affectations distinctes, aux heures distinctes. */
  it('distingue le présentiel et le synchrone d’un même module', () => {
    const groupes = [
      groupe('GM101', [
        module('M101', {
          mhpS1: 30,
          formateurPresentiel: 'ZINEB',
          mhsynS1: 10,
          formateurSynchrone: 'ZINEB',
        }),
      ]),
    ];

    const lignes = affectationsDuFormateur(groupes, 'ZINEB');
    expect(lignes.map((l) => l.type).sort()).toEqual(['presentiel', 'synchrone']);
  });

  /*
   * ═══ ⚠️ LE SEMESTRE EST CELUI DU MODULE, PAS CELUI DE LA LIGNE ═══
   * Une ligne ne porte qu'une NATURE. Ce module a son présentiel en S1 et son
   * synchrone en S2 : il est ANNUEL, et les DEUX lignes doivent le dire. Jugé
   * nature par nature, il s'afficherait « S1 » et « S2 » ici, « annuel » dans la
   * matrice — le même module avec deux badges selon la vue.
   */
  it('rend le semestre DU MODULE sur chacune de ses lignes', () => {
    const groupes = [
      groupe('GM101', [
        module('M101', {
          mhpS1: 30,
          formateurPresentiel: 'ZINEB',
          mhsynS2: 10,
          formateurSynchrone: 'ZINEB',
        }),
      ]),
    ];

    const lignes = affectationsDuFormateur(groupes, 'ZINEB');
    expect(lignes).toHaveLength(2);
    expect(lignes.map((l) => l.semestre)).toEqual(['annuel', 'annuel']);
  });

  it('rend le semestre d’un module d’un seul semestre', () => {
    const groupes = [
      groupe('GM101', [module('M101', { mhpS2: 30, formateurPresentiel: 'ZINEB' })]),
    ];
    expect(affectationsDuFormateur(groupes, 'ZINEB')[0].semestre).toBe('S2');
  });
});

describe('placesDisponibles', () => {
  it('propose un module dont le présentiel est libre', () => {
    const groupes = [groupe('GM101', [module('M101', { mhpS1: 30 })])];

    const [ensemble] = placesDisponibles(groupes, 'ZINEB');
    expect(ensemble.modules[0].presentiel.libres).toEqual(['GM101']);
    expect(ensemble.modules[0].presentiel.miens).toEqual([]);
  });

  /*
   * ⚠️ « LIBRE » SE JUGE PAR NATURE : un module dont le présentiel est pris
   * attend peut-être son synchrone. Une seule notion d'« occupé » aurait masqué
   * la moitié des places.
   */
  it('propose le synchrone d’un module dont le présentiel est déjà pris', () => {
    const groupes = [
      groupe('GM101', [module('M101', { mhpS1: 30, formateurPresentiel: 'AUTRE', mhsynS1: 10 })]),
    ];

    const [ensemble] = placesDisponibles(groupes, 'ZINEB');
    expect(ensemble.modules[0].presentiel.libres).toEqual([]);
    expect(ensemble.modules[0].synchrone.libres).toEqual(['GM101']);
  });

  it('distingue ce qui est DÉJÀ à lui de ce qui est pris par un autre', () => {
    const groupes = [
      groupe('GM101', [module('M101', { mhpS1: 30, formateurPresentiel: 'ZINEB' })]),
      groupe('GM102', [module('M101', { mhpS1: 30, formateurPresentiel: 'AUTRE' })]),
    ];

    const [ensemble] = placesDisponibles(groupes, 'ZINEB');
    expect(ensemble.modules[0].presentiel.miens).toEqual(['GM101']);
    expect(ensemble.modules[0].presentiel.libres).toEqual([]);
  });

  /* ⚠️ Un module sans heures de cette nature n'est pas proposé : l'affectation
     créerait une ligne qui ne pèse rien. */
  it('ne propose pas une nature d’heures à zéro', () => {
    const groupes = [groupe('GM101', [module('M101', { mhpS1: 30 })])];

    const [ensemble] = placesDisponibles(groupes, 'ZINEB');
    expect(ensemble.modules[0].synchrone.heures).toBe(0);
    expect(ensemble.modules[0].synchrone.libres).toEqual([]);
  });

  /*
   * ═══ ⚠️⚠️ CE TEST FIGEAIT LE CONTRAT INVERSE ═══ (réécrit le 2026-09-06.)
   * Il vérifiait qu'un ensemble entièrement pourvu DISPARAISSAIT — c'est
   * précisément ce que le porteur a signalé : la liste ne montrait qu'une
   * poignée de filières sur dix, sans rien dire des autres. Ce qui est pris
   * reste désormais visible, et NOMME son titulaire.
   */
  it('garde un ensemble entièrement pourvu par d’autres, en nommant le titulaire', () => {
    const groupes = [
      groupe('GM101', [module('M101', { mhpS1: 30, formateurPresentiel: 'AUTRE' })]),
    ];

    const [ensemble] = placesDisponibles(groupes, 'ZINEB');
    expect(ensemble.modules[0].presentiel).toMatchObject({
      libres: [],
      miens: [],
      pris: [{ groupe: 'GM101', formateur: 'AUTRE' }],
    });
  });

  /* ⚠️ Le titulaire est rendu TEL QU'IL EST ÉCRIT, pas normalisé : c'est un nom
     à afficher, et la comparaison, elle, se fait sans casse. */
  it('distingue les trois sorts d’une même nature sur trois groupes', () => {
    const groupes = [
      groupe('GM101', [module('M101', { mhpS1: 30, formateurPresentiel: 'zineb' })]),
      groupe('GM102', [module('M101', { mhpS1: 30, formateurPresentiel: 'Meryem Kbabra' })]),
      groupe('GM103', [module('M101', { mhpS1: 30 })]),
    ];

    const [ensemble] = placesDisponibles(groupes, 'ZINEB');
    expect(ensemble.modules[0].presentiel).toMatchObject({
      miens: ['GM101'],
      pris: [{ groupe: 'GM102', formateur: 'Meryem Kbabra' }],
      libres: ['GM103'],
    });
  });

  /* ⚠️ UN MODULE DÉSACTIVÉ RESTE ÉCARTÉ, et ce n'est pas la même chose qu'un
     module pris : il ne peut porter AUCUNE affectation. Le proposer mènerait à
     un cul-de-sac. */
  it('écarte un module désactivé', () => {
    const groupes = [groupe('GM101', [module('M101', { mhpS1: 30, actif: false })])];
    expect(placesDisponibles(groupes, 'ZINEB')).toEqual([]);
  });

  it('reconnaît une séance synchrone DÉJÀ à lui, et une prise par un autre', () => {
    const groupes = [
      groupe('GM101', [module('EGQ102', { mhsynS1: 10, formateurSynchrone: 'ZINEB' })]),
      groupe('GM102', [module('EGQ102', { mhsynS1: 10, formateurSynchrone: 'AUTRE' })]),
    ];

    const [ensemble] = placesDisponibles(groupes, 'ZINEB');
    expect(ensemble.modules[0].synchrone.miens).toEqual(['GM101']);
    expect(ensemble.modules[0].synchrone.libres).toEqual([]);
  });

  it('supporte un module sans masses horaires ni intitulé', () => {
    const groupes = [
      groupe('GM101', [{ code: 'M101', mhpS1: 30 }, { code: 'M999' }]),
    ];

    const [ensemble] = placesDisponibles(groupes, 'ZINEB');
    // M999 ne porte aucune heure : il n'est proposé pour aucune nature.
    expect(ensemble.modules.map((m) => m.code)).toEqual(['M101']);
    expect(ensemble.modules[0].intitule).toBe('');
  });

  it('supporte un groupe sans modules, et une carte vide', () => {
    expect(placesDisponibles([groupe('GM101', undefined)], 'ZINEB')).toEqual([]);
    expect(placesDisponibles()).toEqual([]);
  });

  it('rend les groupes de l’ensemble et son identité, pour l’affichage', () => {
    const groupes = [
      groupe('GM101', [module('M101', { mhpS1: 30 })]),
      groupe('GM102', [module('M101', { mhpS1: 30 })]),
    ];

    const [ensemble] = placesDisponibles(groupes, 'ZINEB');
    expect(ensemble).toMatchObject({
      codeFiliere: 'GM',
      intituleFiliere: 'Génie Mécanique',
      anneeFormation: 1,
      mode: 'Résidentiel',
    });
    expect(ensemble.groupes).toEqual(['GM101', 'GM102']);
    expect(ensemble.modules[0].intitule).toBe('Intitulé M101');
  });

  /* ⚠️ Sans nom, TOUT ce qui est pris l'est « par un autre » : la fiche d'un
     formateur non nommé ne doit rien s'attribuer. */
  it('n’attribue rien quand aucun nom n’est donné', () => {
    const groupes = [
      groupe('GM101', [module('M101', { mhpS1: 30, formateurPresentiel: 'ZINEB', mhsynS1: 10 })]),
    ];

    const [ensemble] = placesDisponibles(groupes);
    expect(ensemble.modules[0].presentiel.miens).toEqual([]);
    expect(ensemble.modules[0].synchrone.libres).toEqual(['GM101']);
  });
});
