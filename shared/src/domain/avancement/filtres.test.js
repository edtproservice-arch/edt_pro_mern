import { describe, it, expect } from 'vitest';
import { facettesAvancement, filtrerAvancement, nombreDeFiltres } from './filtres.js';
import { semestreCumule, semestreDe } from './semestre.js';

const ligne = (surcharges = {}) => ({
  groupe: 'GM101',
  fusionGroupe: '',
  module: 'M101',
  formateurPresentiel: 'BRAHIM LOURID',
  formateurSynchrone: 'BRAHIM LOURID',
  prevuPresentiel: 30,
  prevuSynchrone: 0,
  realisePresentiel: 10,
  realiseSynchrone: 0,
  estRegional: false,
  mode: 'Résidentiel',
  semestre: 'S1',
  annee: 1,
  ...surcharges,
});

const CORPUS = [
  ligne(),
  ligne({ groupe: 'SMP201', annee: 2, semestre: 'S2', mode: 'Alterné', estRegional: true }),
  ligne({ groupe: 'GM102', formateurPresentiel: 'ZINEB EL OMARI', formateurSynchrone: '' }),
];

describe('facettesAvancement', () => {
  it('ne propose que les valeurs présentes', () => {
    const f = facettesAvancement(CORPUS);

    expect(f.annee).toEqual(['1', '2']);
    expect(f.mode).toEqual(['Alterné', 'Résidentiel']);
    expect(f.groupe).toEqual(['GM101', 'GM102', 'SMP201']);
    expect(f.formateur).toEqual(['BRAHIM LOURID', 'ZINEB EL OMARI']);
    expect(f.regional).toEqual(['oui', 'non']);
  });

  /*
   * ⚠️ L'ORDRE DU CURSUS, PAS L'ALPHABET : « A » tomberait avant « S1 », ce qui
   * ne veut rien dire pour qui lit une liste de semestres.
   */
  it('range les semestres dans l’ordre du cursus', () => {
    const f = facettesAvancement([...CORPUS, ligne({ semestre: 'A' })]);
    expect(f.semestre).toEqual(['S1', 'S2', 'A']);
  });

  it('n’invente pas de valeur pour un champ vide', () => {
    const f = facettesAvancement([ligne({ mode: '', semestre: '' })]);
    expect(f.mode).toEqual([]);
    expect(f.semestre).toEqual([]);
  });

  it('rend des listes vides plutôt que de lever, sans ligne', () => {
    expect(facettesAvancement([]).groupe).toEqual([]);
    expect(facettesAvancement().groupe).toEqual([]);
  });
});

describe('filtrerAvancement', () => {
  /*
   * ⚠️ UNE FACETTE VIDE VEUT DIRE « TOUTES », jamais « aucune » — sinon l'écran
   * s'ouvrirait sur une liste vide, et on chercherait la panne.
   */
  it('ne filtre rien sans aucun choix', () => {
    expect(filtrerAvancement(CORPUS, {})).toHaveLength(3);
    expect(filtrerAvancement(CORPUS, { annee: [] })).toHaveLength(3);
  });

  it('retient « l’un OU l’autre » dans une même facette', () => {
    const retenues = filtrerAvancement(CORPUS, { groupe: ['GM101', 'GM102'] });
    expect(retenues.map((l) => l.groupe)).toEqual(['GM101', 'GM102']);
  });

  /*
   * ⚠️ « ET » ENTRE LES FACETTES, sur LA MÊME LIGNE. Les traiter séparément
   * rendrait une 2ᵉ année résidentielle alors qu'aucune ligne ne l'est.
   */
  it('combine deux facettes sur la même ligne', () => {
    expect(filtrerAvancement(CORPUS, { annee: ['2'], mode: ['Alterné'] })).toHaveLength(1);
    expect(filtrerAvancement(CORPUS, { annee: ['2'], mode: ['Résidentiel'] })).toHaveLength(0);
  });

  /*
   * ⚠️ LE FORMATEUR SE CHERCHE SUR LES DEUX RÔLES : celui qui n'assure que les
   * séances à distance disparaîtrait de sa propre liste.
   */
  it('trouve un formateur qu’il soit en présentiel ou en synchrone', () => {
    const surLeSynchrone = filtrerAvancement(
      [ligne({ formateurPresentiel: 'AUTRE', formateurSynchrone: 'CIBLE' })],
      { formateur: ['CIBLE'] }
    );
    expect(surLeSynchrone).toHaveLength(1);
  });

  it('filtre sur le statut régional', () => {
    expect(filtrerAvancement(CORPUS, { regional: ['oui'] })).toHaveLength(1);
    expect(filtrerAvancement(CORPUS, { regional: ['non'] })).toHaveLength(2);
  });

  it('compte les valeurs retenues, toutes facettes confondues', () => {
    expect(nombreDeFiltres({ annee: ['1'], groupe: ['GM101', 'GM102'] })).toBe(3);
    expect(nombreDeFiltres({})).toBe(0);
  });
});

describe('semestreDe', () => {
  it('déduit le semestre des deux parts', () => {
    expect(semestreDe(10, 0)).toBe('S1');
    expect(semestreDe(0, 10)).toBe('S2');
    expect(semestreDe(10, 10)).toBe('A');
  });

  // Un module sans masse déclarée n'a pas de semestre — il n'en a pas « aucun ».
  it('rend une chaîne vide quand rien n’est déclaré', () => {
    expect(semestreDe(0, 0)).toBe('');
    expect(semestreDe(undefined, null)).toBe('');
  });

  it('accepte les valeurs en texte, comme les cellules du fichier', () => {
    expect(semestreDe('12,5', '')).toBe('S1');
  });
});

describe('semestreCumule', () => {
  it('garde le semestre unique', () => {
    expect(semestreCumule(['S1', 'S1'])).toBe('S1');
  });

  /*
   * ⚠️ DEUX SEMESTRES DIFFÉRENTS DONNENT « A » : un module donné en S1 à une
   * promotion et en S2 à une autre s'étale bien sur l'année.
   */
  it('rend « A » dès que deux semestres se côtoient', () => {
    expect(semestreCumule(['S1', 'S2'])).toBe('A');
    expect(semestreCumule(['S1', 'A'])).toBe('A');
  });

  it('ignore les valeurs vides', () => {
    expect(semestreCumule(['', 'S2', ''])).toBe('S2');
    expect(semestreCumule([])).toBe('');
  });
});
