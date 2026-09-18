import { describe, it, expect } from 'vitest';
import { objectifsParGroupe, tauxObjectifPedagogique } from './objectif.js';

/**
 * L'année 2026-2027 : le lundi de la semaine du 1er septembre 2026 est le
 * 31 août 2026, et la 1ʳᵉ année s'achève le 18 juillet 2027.
 */
const ANNEE = 2026;

const objectif = (surcharges = {}) =>
  tauxObjectifPedagogique({ anneeScolaire: ANNEE, annee: 1, groupe: 'GM101', ...surcharges });

describe('tauxObjectifPedagogique', () => {
  it('vaut zéro le jour de la rentrée, cent après la fin de formation', () => {
    // ⚠️ Le premier jour n'est pas encore ÉCOULÉ au sens du calcul : il compte
    // pour un, sur ~280 — soit un pourcentage tout juste au-dessus de zéro.
    expect(objectif({ aujourdhui: '2026-08-31' })).toBeLessThan(1);
    expect(objectif({ aujourdhui: '2027-12-31' })).toBe(100);
  });

  it('progresse au fil de l’année', () => {
    const novembre = objectif({ aujourdhui: '2026-11-15' });
    const mars = objectif({ aujourdhui: '2027-03-15' });

    expect(novembre).toBeGreaterThan(0);
    expect(mars).toBeGreaterThan(novembre);
    expect(mars).toBeLessThan(100);
  });

  /*
   * ⚠️ LA 2ᵉ ANNÉE FINIT PLUS TÔT (2 juin contre 18 juillet) : à date égale, son
   * objectif est donc PLUS HAUT — il lui reste moins de temps. C'est ce que les
   * dates réglementaires de l'existant imposent, et l'inverse serait invisible
   * sans ce test.
   */
  it('monte plus vite pour une 2ᵉ année, qui finit plus tôt', () => {
    const premiere = objectif({ annee: 1, aujourdhui: '2027-03-15' });
    const deuxieme = objectif({ annee: 2, aujourdhui: '2027-03-15' });

    expect(deuxieme).toBeGreaterThan(premiere);
  });

  /*
   * ⚠️ LE STAGE EST PROPRE AU GROUPE, et c'est tout l'intérêt de la courbe :
   * deux groupes de la même promotion n'ont pas le même objectif si l'un part en
   * entreprise. Un stage PASSÉ retire des jours écoulés ET des jours ouvrés,
   * donc l'objectif baisse — le groupe a eu moins de temps de cours.
   */
  it('retire les jours de stage DU GROUPE', () => {
    const stages = [{ groupe: 'GM101', debut: '2026-10-01', fin: '2026-10-31' }];

    const avec = objectif({ aujourdhui: '2027-03-15', stages });
    const sans = objectif({ aujourdhui: '2027-03-15' });
    const voisin = objectif({ groupe: 'GM102', aujourdhui: '2027-03-15', stages });

    expect(avec).not.toBe(sans);
    // Le stage d'un autre groupe ne change rien à celui-ci.
    expect(voisin).toBe(sans);
  });

  it('retire les jours fériés et les vacances', () => {
    const sans = objectif({ aujourdhui: '2027-03-15' });
    const avec = objectif({
      aujourdhui: '2027-03-15',
      joursFeries: [{ date: '2026-11-18', nom: 'Indépendance' }],
      vacances: [{ debut: '2026-12-07', fin: '2026-12-13' }],
    });

    expect(avec).not.toBe(sans);
  });

  /*
   * ⚠️ LE SAMEDI EST UN JOUR DE FORMATION : la grille en porte six. Le compter
   * comme chômé raccourcirait l'année d'un sixième, et l'objectif paraîtrait
   * toujours en avance. Un dimanche de plus ne doit rien changer.
   */
  it('ne compte pas les dimanches, mais compte les samedis', () => {
    // Du 31/08 (lundi) au 05/09 (samedi) : 6 jours ouvrés, le 06/09 est un dimanche.
    const samedi = objectif({ aujourdhui: '2026-09-05' });
    const dimanche = objectif({ aujourdhui: '2026-09-06' });

    expect(samedi).toBe(dimanche);
  });

  /*
   * ⚠️ `null`, JAMAIS `0`, sur une entrée inexploitable : « 0 % » se lirait
   * comme « aucun jour écoulé », c'est-à-dire une information — alors qu'il n'y
   * en a aucune.
   */
  it('rend null sans année scolaire exploitable', () => {
    expect(tauxObjectifPedagogique({ anneeScolaire: null, annee: 1, groupe: 'X' })).toBeNull();
    expect(tauxObjectifPedagogique({})).toBeNull();
  });

  it('retombe sur la fin de 1ʳᵉ année pour un niveau inconnu', () => {
    expect(objectif({ annee: 9, aujourdhui: '2027-03-15' })).toBe(
      objectif({ annee: 1, aujourdhui: '2027-03-15' })
    );
  });
});

describe('objectifsParGroupe', () => {
  const lignes = [
    { groupe: 'GM101', annee: 1 },
    { groupe: 'GM101', annee: 1 },
    { groupe: 'SMP201', annee: 2 },
    { groupe: '', annee: 1 },
  ];

  it('rend un objectif par groupe distinct', () => {
    const objectifs = objectifsParGroupe(lignes, {
      anneeScolaire: ANNEE,
      aujourdhui: '2027-03-15',
    });

    expect(Object.keys(objectifs).sort()).toEqual(['GM101', 'SMP201']);
    // La 2ᵉ année finit plus tôt : son objectif est plus haut.
    expect(objectifs.SMP201).toBeGreaterThan(objectifs.GM101);
  });

  it('ignore une ligne sans groupe plutôt que d’inventer une clé vide', () => {
    const objectifs = objectifsParGroupe(lignes, { anneeScolaire: ANNEE });
    expect(objectifs['']).toBeUndefined();
  });
});

/**
 * ═══ L'ANNÉE D'UN GROUPE COMMENCE À SA RENTRÉE ═══
 * (décision du porteur, 2026-09-02.)
 */
describe('tauxObjectifPedagogique — rentrée', () => {
  const RENTREES = [
    { anneeFormation: 1, date: '2026-09-11' },
    { anneeFormation: 2, date: '2026-09-07' },
  ];

  it('ne change RIEN tant qu’aucune rentrée n’est paramétrée', () => {
    const sans = tauxObjectifPedagogique({
      anneeScolaire: 2026,
      annee: 1,
      groupe: 'GM101',
      aujourdhui: '2026-12-01',
    });
    const vide = tauxObjectifPedagogique({
      anneeScolaire: 2026,
      annee: 1,
      groupe: 'GM101',
      aujourdhui: '2026-12-01',
      rentrees: [],
    });

    expect(vide).toBe(sans);
  });

  it('n’avance PLUS avant la rentrée du groupe', () => {
    // Le 9 septembre, la 1ʳᵉ année n'est pas encore là : son objectif ne peut
    // pas être entamé. Sans la rentrée, les jours depuis le 31 août comptaient.
    const options = {
      anneeScolaire: 2026,
      annee: 1,
      groupe: 'GM101',
      aujourdhui: '2026-09-09',
    };

    expect(tauxObjectifPedagogique(options)).toBeGreaterThan(0);
    expect(tauxObjectifPedagogique({ ...options, rentrees: RENTREES })).toBe(0);
  });

  it('donne un objectif PLUS BAS à l’année qui rentre plus tard', () => {
    // À la même date, la 1ʳᵉ année a commencé quatre jours après la 2ᵉ : elle
    // doit être moins avancée. Sans ce départ décalé, les deux partaient
    // ensemble et la 1ʳᵉ paraissait en retard toute l'année.
    const commun = { anneeScolaire: 2026, aujourdhui: '2026-11-15', rentrees: RENTREES };

    const premiere = tauxObjectifPedagogique({ ...commun, annee: 1, groupe: 'GM101' });
    const deuxieme = tauxObjectifPedagogique({ ...commun, annee: 2, groupe: 'SMP201' });

    // La 2ᵉ année finit aussi plus tôt (2 juin contre 18 juillet) : c'est CE
    // rapport-là qu'on vérifie, pas une égalité de dates.
    expect(premiere).toBeLessThan(deuxieme);
  });

  it('propage les rentrées jusqu’à `objectifsParGroupe`', () => {
    const objectifs = objectifsParGroupe([{ groupe: 'GM101', annee: 1 }], {
      anneeScolaire: 2026,
      aujourdhui: '2026-09-09',
      rentrees: RENTREES,
    });

    expect(objectifs.GM101).toBe(0);
  });
});
