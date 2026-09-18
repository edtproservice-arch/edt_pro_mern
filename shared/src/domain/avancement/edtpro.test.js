import { describe, it, expect } from 'vitest';
import { TYPES_COURS } from '../../constants/index.js';
import { lignesDepuisAffectations } from './edtpro.js';
import { agregerAvancement } from './agregation.js';

const affectation = (surcharges = {}) => ({
  formateur: '18448',
  groupe: 'SMP201',
  module: 'EGQ202',
  type: TYPES_COURS.PRESENTIEL,
  s1Heures: 40,
  s2Heures: 35,
  estRegional: false,
  ...surcharges,
});

const noms = (identifiant) => ({ 18448: 'ZINEB EL OMARI' }[identifiant] ?? identifiant);

describe('lignesDepuisAffectations', () => {
  it('additionne les deux semestres en une masse prévue', () => {
    const [ligne] = lignesDepuisAffectations([affectation()], new Map(), noms);
    expect(ligne).toMatchObject({ groupe: 'SMP201', module: 'EGQ202', prevuPresentiel: 75 });
  });

  /*
   * ⚠️ LES AFFECTATIONS PORTENT L'IDENTIFIANT, PAS LE NOM — souvent un
   * matricule. L'écran afficherait « 18448 » sans cette traduction, et l'axe
   * formateur serait illisible.
   */
  it('traduit l’identifiant du formateur en nom', () => {
    const [ligne] = lignesDepuisAffectations([affectation()], new Map(), noms);
    expect(ligne.formateurPresentiel).toBe('ZINEB EL OMARI');
  });

  /*
   * ═══ ⚠️ UNE ENTRÉE SYNCHRONE FUSIONNÉE DEVIENT UNE LIGNE PAR GROUPE ═══
   * C'est la forme de l'export e-note, et c'est ce qui rend les deux faces
   * comparables.
   */
  it('éclate la séance mutualisée en une ligne par groupe, avec l’ensemble', () => {
    const lignes = lignesDepuisAffectations(
      [affectation({ groupe: 'SMP201 SMP202', type: TYPES_COURS.SYNCHRONE, s1Heures: 20, s2Heures: 0 })],
      new Map(),
      noms
    );

    expect(lignes.map((l) => l.groupe)).toEqual(['SMP201', 'SMP202']);
    for (const ligne of lignes) {
      expect(ligne.prevuSynchrone).toBe(20);
      expect(ligne.fusionGroupe).toBe('SMP201 SMP202');
    }
  });

  /* Et l'agrégation la compte alors UNE fois pour le formateur. */
  it('le formateur ne porte la séance mutualisée qu’une fois', () => {
    const lignes = lignesDepuisAffectations(
      [affectation({ groupe: 'SMP201 SMP202', type: TYPES_COURS.SYNCHRONE, s1Heures: 20, s2Heures: 0 })],
      new Map(),
      noms
    );

    const [formateur] = agregerAvancement(lignes, 'formateur');
    expect(formateur.prevuSynchrone).toBe(20);
  });

  it('un groupe seul n’est pas marqué comme fusionné', () => {
    const [ligne] = lignesDepuisAffectations(
      [affectation({ type: TYPES_COURS.SYNCHRONE })],
      new Map(),
      noms
    );
    expect(ligne.fusionGroupe).toBe('');
  });

  /*
   * ⚠️ DEUX ENTRÉES, DEUX FORMATEURS, UNE SEULE LIGNE : le présentiel et le
   * synchrone d'un module peuvent être assurés par deux personnes.
   */
  it('réunit le présentiel et le synchrone d’un module sur une ligne', () => {
    const lignes = lignesDepuisAffectations(
      [
        affectation({ formateur: '18448' }),
        affectation({ formateur: 'AUTRE', type: TYPES_COURS.SYNCHRONE, s1Heures: 20, s2Heures: 0 }),
      ],
      new Map(),
      noms
    );

    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      formateurPresentiel: 'ZINEB EL OMARI',
      formateurSynchrone: 'AUTRE',
      prevuPresentiel: 75,
      prevuSynchrone: 20,
    });
  });

  it('attache les heures réellement posées', () => {
    const posees = new Map([
      ['SMP201||EGQ202', { [TYPES_COURS.PRESENTIEL]: 30, [TYPES_COURS.SYNCHRONE]: 10 }],
    ]);
    const [ligne] = lignesDepuisAffectations([affectation()], posees, noms);

    expect(ligne).toMatchObject({ realisePresentiel: 30, realiseSynchrone: 10 });
  });

  /* Rien de posé : le réalisé est zéro, jamais `undefined` — le taux tomberait. */
  it('sans séance posée, le réalisé vaut zéro', () => {
    const [ligne] = lignesDepuisAffectations([affectation()], new Map(), noms);
    expect(ligne).toMatchObject({ realisePresentiel: 0, realiseSynchrone: 0 });
  });

  it('ignore une affectation sans module', () => {
    expect(lignesDepuisAffectations([affectation({ module: '' })], new Map(), noms)).toEqual([]);
  });
});

describe('lignesDepuisAffectations — les cas de bord', () => {
  /*
   * ⚠️ UNE AFFECTATION SANS MODULE N'EST PAS UNE LIGNE : la carte en produit
   * quand un groupe est déclaré avant qu'on lui affecte quoi que ce soit. La
   * garder fabriquerait un module au nom vide, qui apparaîtrait dans l'axe
   * « module » sans qu'on puisse dire ce qu'il désigne.
   */
  it('écarte une affectation sans module', () => {
    const lignes = lignesDepuisAffectations(
      [affectation({ module: '' }), affectation({ module: '   ' }), affectation({ module: undefined })],
      new Map(),
      noms
    );
    expect(lignes).toEqual([]);
  });

  /*
   * ⚠️ UN SEMESTRE ABSENT VAUT ZÉRO, PAS `NaN`. Les affectations de la carte
   * n'écrivent `s2Heures` que si le module tourne au second semestre : sans le
   * repli, la masse du module — et donc le total de l'écran — deviendrait `NaN`.
   */
  it('traite un semestre absent comme zéro', () => {
    const [ligne] = lignesDepuisAffectations(
      [affectation({ s1Heures: 30, s2Heures: undefined })],
      new Map(),
      noms
    );
    expect(ligne.prevuPresentiel).toBe(30);
  });

  /*
   * ⚠️ SANS TABLE DE NOMS, ON GARDE L'IDENTIFIANT plutôt que de rendre une ligne
   * anonyme : l'axe formateur afficherait un sujet vide, que `agregerAvancement`
   * écarte — la charge de la personne disparaîtrait purement et simplement.
   */
  it('garde l’identifiant quand aucune traduction n’est fournie', () => {
    const [ligne] = lignesDepuisAffectations([affectation()]);
    expect(ligne.formateurPresentiel).toBe('18448');
  });

  it('marque le module régional, qu’il vienne du présentiel ou du synchrone', () => {
    const [presentiel] = lignesDepuisAffectations([affectation({ estRegional: true })], new Map(), noms);
    const [synchrone] = lignesDepuisAffectations(
      [affectation({ type: TYPES_COURS.SYNCHRONE, estRegional: true })],
      new Map(),
      noms
    );

    expect(presentiel.estRegional).toBe(true);
    expect(synchrone.estRegional).toBe(true);
  });

  /*
   * ⚠️ `heuresPosees` REND UNE `Map`, mais un état sérialisé — passé par une
   * réponse HTTP, ou relu d'un cache — arrive en objet nu. Les deux formes se
   * lisent, sinon le réalisé retomberait silencieusement à zéro.
   */
  it('lit le réalisé depuis une Map comme depuis un objet nu', () => {
    const attendu = { presentiel: 12.5 };
    const [depuisMap] = lignesDepuisAffectations(
      [affectation()],
      new Map([['SMP201||EGQ202', attendu]]),
      noms
    );
    const [depuisObjet] = lignesDepuisAffectations(
      [affectation()],
      { 'SMP201||EGQ202': attendu },
      noms
    );

    expect(depuisMap.realisePresentiel).toBe(12.5);
    expect(depuisObjet.realisePresentiel).toBe(12.5);
  });

  // Rien de posé n'est pas une erreur : c'est l'état d'une année qui commence.
  it('rend zéro quand rien n’a été posé pour la clé', () => {
    const [ligne] = lignesDepuisAffectations([affectation()], undefined, noms);
    expect(ligne).toMatchObject({ realisePresentiel: 0, realiseSynchrone: 0 });
  });
});
