import { describe, it, expect } from 'vitest';
import {
  ENTETES_GROUPE,
  VALEURS_AUTORISEES,
  fusionnerCellules,
  lignesClasseur,
  lireFeuilleChronogramme,
} from './classeur.js';

const MODULES = [
  {
    code: 'M101',
    intitule: 'Algorithmique',
    semestre: 'S1',
    estRegional: false,
    formateurs: ['BRAHIM LOURID'],
    masses: { presentiel: 30, synchrone: 10 },
  },
  {
    code: 'M102',
    intitule: 'Bases de données',
    semestre: 'annuel',
    estRegional: true,
    formateurs: ['SAID AMMARI'],
    masses: { presentiel: 20, synchrone: 0 },
  },
];

const referentiel = {
  groupes: new Map([['GM101', 'GM101']]),
  modulesParGroupe: new Map([
    ['GM101', new Map([['M101', 'M101'], ['M102', 'M102']])],
  ]),
};

/** Construit une feuille au format de l'export, pour la relire. */
function feuille({ mode = 'groupe', sujet = 'GM101', corps = [], entete = ENTETES_GROUPE } = {}) {
  const semaines = Array.from({ length: 45 }, (_, i) => `S${i + 1}`);

  return {
    nom: sujet,
    lignes: [
      [mode === 'groupe' ? 'Groupe' : 'Formateur', sujet],
      ['Année scolaire', '2026-2027'],
      [],
      ['État de la semaine'],
      ['Semaine du'],
      [...entete, ...semaines],
      ...corps,
    ],
  };
}

/**
 * Les seules cellules REMPLIES.
 *
 * ⚠️ Une feuille relue émet aussi un EFFACEMENT par case vide — c'est le
 * contrat : le fichier fait autorité sur les modules qu'il nomme, et une
 * semaine qu'on y a vidée doit disparaître de la grille. Les 45 entrées d'une
 * ligne sont donc normales ; les tests qui portent sur le contenu filtrent.
 */
const remplies = (cellules) => cellules.filter((c) => c.heures !== null);

/** Une ligne de données : colonnes fixes puis 45 semaines. */
const ligne = (fixes, heuresParSemaine = {}) => [
  ...fixes,
  ...Array.from({ length: 45 }, (_, i) => String(heuresParSemaine[i + 1] ?? '')),
];

describe('lignesClasseur', () => {
  it('donne une ligne P, et une ligne S SEULEMENT si le module en prévoit', () => {
    // En produire une systématiquement doublerait la hauteur du tableau avec
    // des lignes que rien ne peut remplir.
    const lignes = lignesClasseur(MODULES, {});
    expect(lignes.map((l) => `${l.code}/${l.type}`)).toEqual(['M101/P', 'M101/S', 'M102/P']);
  });

  it('range les heures sur la ligne de LEUR type', () => {
    const planning = {
      M101: { 3: { heures: 5, type: 'P' }, 4: { heures: 2.5, type: 'S' } },
    };
    const [p, s] = lignesClasseur(MODULES, planning);

    expect(p.heures).toEqual({ 3: 5 });
    expect(s.heures).toEqual({ 4: 2.5 });
  });

  it('abrège le semestre comme les badges de la grille', () => {
    const lignes = lignesClasseur(MODULES, {});
    expect(lignes[0].semestre).toBe('1');
    expect(lignes.at(-1).semestre).toBe('A');
  });

  it('n’offre que les valeurs de la grille', () => {
    // Un fichier retouché hors ligne ne doit pas produire une valeur que
    // l'écran refuserait.
    expect(VALEURS_AUTORISEES[0]).toBe(2.5);
    expect(VALEURS_AUTORISEES.at(-1)).toBe(20);
    expect(VALEURS_AUTORISEES.every((v) => v % 2.5 === 0)).toBe(true);
  });
});

describe('lireFeuilleChronogramme — garde-fous', () => {
  it('écarte les feuilles TECHNIQUES de l’export', () => {
    expect(lireFeuilleChronogramme({ nom: 'Valeurs', lignes: [] }, referentiel).etat).toBe(
      'technique'
    );
    expect(lireFeuilleChronogramme({ nom: 'Charge groupes', lignes: [] }, referentiel).etat).toBe(
      'technique'
    );
  });

  it('refuse une feuille dont A1 n’annonce rien', () => {
    /*
     * ⚠️ C'EST LE GARDE-FOU, pas le nom de la feuille : une feuille de bilan
     * RENOMMÉE continue d'être écartée, et une feuille étrangère ne peut pas se
     * faire passer pour des données.
     */
    const resultat = lireFeuilleChronogramme(
      { nom: 'Feuil1', lignes: [['Autre chose', 'GM101']] },
      referentiel
    );
    expect(resultat.etat).toBe('ignoree');
    expect(resultat.raison).toContain('A1');
  });

  it('CHERCHE la ligne d’en-tête, elle n’est jamais supposée', () => {
    /*
     * Une ligne de titre ajoutée à la main ne doit pas casser la relecture : le
     * bloc d'en-tête se CHERCHE par son premier libellé.
     *
     * ⚠️ En revanche A1 reste A1 — c'est la contrainte de l'existant, et elle
     * tient : l'étiquette « Groupe » / « Formateur » est ce qui distingue une
     * feuille de données de n'importe quelle autre. L'insertion se fait donc
     * SOUS le bloc d'identification, là où l'utilisateur ajouterait un titre.
     */
    const f = feuille({ corps: [ligne(['M101', '', '1', '', '', 'P'], { 3: 5 })] });
    f.lignes.splice(2, 0, ['Chronogramme 2026-2027']);

    const resultat = lireFeuilleChronogramme(f, referentiel);
    expect(resultat.etat).toBe('lue');
    expect(resultat.cellules).toContainEqual({ groupe: 'GM101', code: 'M101', semaine: 3, heures: 5, type: 'P' });
  });

  it('refuse un groupe inconnu', () => {
    const resultat = lireFeuilleChronogramme(feuille({ sujet: 'INCONNU' }), referentiel);
    expect(resultat.etat).toBe('ignoree');
    expect(resultat.raison).toContain('INCONNU');
  });

  it('refuse une feuille sans colonne de semaine', () => {
    const f = feuille();
    f.lignes[5] = [...ENTETES_GROUPE];
    expect(lireFeuilleChronogramme(f, referentiel).raison).toContain('semaine');
  });
});

describe('lireFeuilleChronogramme — contenu', () => {
  it('lit une cellule et lui donne le type de SA LIGNE', () => {
    const resultat = lireFeuilleChronogramme(
      feuille({
        corps: [
          ligne(['M101', 'Algorithmique', '1', '', 'X', 'P'], { 3: 5 }),
          ligne(['M101', 'Algorithmique', '1', '', 'X', 'S'], { 4: 2.5 }),
        ],
      }),
      referentiel
    );

    expect(remplies(resultat.cellules)).toEqual([
      { groupe: 'GM101', code: 'M101', semaine: 3, heures: 5, type: 'P' },
      { groupe: 'GM101', code: 'M101', semaine: 4, heures: 2.5, type: 'S' },
    ]);
    expect(resultat.refus).toEqual([]);
  });

  it('REFUSE une semaine remplie sur les DEUX lignes du module', () => {
    /*
     * Une case de la grille ne porte qu'un seul type. Sans ce refus, la
     * dernière ligne lue l'emporterait en silence.
     */
    const resultat = lireFeuilleChronogramme(
      feuille({
        corps: [
          ligne(['M101', '', '1', '', '', 'P'], { 3: 5 }),
          ligne(['M101', '', '1', '', '', 'S'], { 3: 2.5 }),
        ],
      }),
      referentiel
    );

    expect(resultat.refus).toHaveLength(1);
    expect(resultat.refus[0]).toContain('un seul type');
    // La première valeur lue est conservée, pas écrasée par la fautive.
    expect(resultat.cellules).toContainEqual({ groupe: 'GM101', code: 'M101', semaine: 3, heures: 5, type: 'P' });
  });

  it('une case VIDE efface, mais n’écrase pas l’autre ligne du module', () => {
    // C'est le cas NORMAL : le type non employé est vide partout.
    const resultat = lireFeuilleChronogramme(
      feuille({
        corps: [
          ligne(['M101', '', '1', '', '', 'P'], { 3: 5 }),
          ligne(['M101', '', '1', '', '', 'S'], {}),
        ],
      }),
      referentiel
    );

    expect(resultat.cellules).toContainEqual({ groupe: 'GM101', code: 'M101', semaine: 3, heures: 5, type: 'P' });
    expect(resultat.cellules.filter((c) => c.semaine === 3)).toHaveLength(1);
    // Les 44 autres semaines sont bien demandées à l'effacement.
    expect(remplies(resultat.cellules)).toHaveLength(1);
  });

  it('une case vidée sur les deux lignes demande l’EFFACEMENT', () => {
    const resultat = lireFeuilleChronogramme(
      feuille({ corps: [ligne(['M101', '', '1', '', '', 'P'], {})] }),
      referentiel
    );
    expect(resultat.cellules[0]).toEqual({ groupe: 'GM101', code: 'M101', semaine: 1, heures: null });
    expect(resultat.cellules).toHaveLength(45);
  });

  it('accepte la VIRGULE décimale d’un Excel français', () => {
    const resultat = lireFeuilleChronogramme(
      feuille({ corps: [ligne(['M101', '', '1', '', '', 'P'], { 3: '2,5' })] }),
      referentiel
    );
    expect(resultat.cellules).toContainEqual({ groupe: 'GM101', code: 'M101', semaine: 3, heures: 2.5, type: 'P' });
  });

  it('accepte encore l’ANCIEN format « 5|P »', () => {
    /*
     * Un classeur exporté avant le passage à la colonne « Type », et déjà
     * retouché, ne doit pas devenir illisible d'un coup.
     */
    const sansType = ['Module', 'Intitulé', 'SEM', 'REG', 'Formateur'];
    const resultat = lireFeuilleChronogramme(
      feuille({ entete: sansType, corps: [ligne(['M101', '', '1', '', ''], { 3: '5|S' })] }),
      referentiel
    );

    expect(resultat.cellules).toContainEqual({ groupe: 'GM101', code: 'M101', semaine: 3, heures: 5, type: 'S' });
  });

  it('NOMME ce qu’il refuse, ligne par ligne', () => {
    const resultat = lireFeuilleChronogramme(
      feuille({
        corps: [
          ligne(['M999', '', '1', '', '', 'P'], { 3: 5 }),
          ligne(['M101', '', '1', '', '', 'X'], { 3: 5 }),
          ligne(['M102', '', '1', '', '', 'P'], { 3: 'cinq' }),
        ],
      }),
      referentiel
    );

    expect(resultat.refus).toHaveLength(3);
    expect(resultat.refus[0]).toContain('M999');
    expect(resultat.refus[1]).toContain('attendu P ou S');
    expect(resultat.refus[2]).toContain('cinq');
  });

  it('ignore la ligne de TOTAL du bas', () => {
    const resultat = lireFeuilleChronogramme(
      feuille({ corps: [ligne(['TOTAL', '', '', '', '', ''], { 3: 5 })] }),
      referentiel
    );
    expect(resultat.refus).toEqual([]);
    expect(resultat.cellules).toEqual([]);   // une ligne TOTAL n'efface rien non plus
  });

  it('rapporte les refus AVEC le numéro de ligne du tableur', () => {
    // L'index 0 du tableau est la ligne 1 : sans ce décalage, l'utilisateur
    // irait corriger la mauvaise ligne de son fichier.
    const resultat = lireFeuilleChronogramme(
      feuille({ corps: [ligne(['M999', '', '1', '', '', 'P'], { 3: 5 })] }),
      referentiel
    );
    expect(resultat.refus[0]).toContain('ligne 7');
  });
});

describe('lireFeuilleChronogramme — mode formateur', () => {
  const referentielMulti = {
    groupes: new Map([['GM101', 'GM101'], ['GM102', 'GM102']]),
    modulesParGroupe: new Map([
      ['GM101', new Map([['M101', 'M101']])],
      ['GM102', new Map([['M101', 'M101']])],
    ]),
  };

  it('lit le GROUPE sur chaque ligne, pas dans le sujet', () => {
    const entete = ['Groupe', 'Module', 'Intitulé', 'SEM', 'REG', 'Type'];
    const resultat = lireFeuilleChronogramme(
      feuille({
        mode: 'formateur',
        sujet: 'BRAHIM LOURID',
        entete,
        corps: [
          ligne(['GM101', 'M101', '', '1', '', 'P'], { 3: 5 }),
          ligne(['GM102', 'M101', '', '1', '', 'P'], { 4: 5 }),
        ],
      }),
      referentielMulti
    );

    expect(resultat.mode).toBe('formateur');
    expect(resultat.sujet).toBe('BRAHIM LOURID');
    expect(remplies(resultat.cellules)).toEqual([
      { groupe: 'GM101', code: 'M101', semaine: 3, heures: 5, type: 'P' },
      { groupe: 'GM102', code: 'M101', semaine: 4, heures: 5, type: 'P' },
    ]);
  });
});

describe('fusionnerCellules', () => {
  const depart = {
    GM101: {
      M101: { 3: { heures: 5, type: 'P' } },
      M102: { 8: { heures: 10, type: 'P' } },
    },
  };

  it('⚠️ NE TOUCHE PAS aux modules que la feuille ne nomme pas', () => {
    /*
     * C'est LA règle de l'import. Une feuille de formateur ne porte qu'une
     * fraction des modules d'un groupe : reconstruire le planning à partir
     * d'elle seule effacerait tous les autres.
     */
    const { plannings } = fusionnerCellules(depart, [
      { groupe: 'GM101', code: 'M101', semaine: 4, heures: 2.5, type: 'S' },
    ]);

    expect(plannings.GM101.M102).toEqual({ 8: { heures: 10, type: 'P' } });
    expect(plannings.GM101.M101).toEqual({
      3: { heures: 5, type: 'P' },
      4: { heures: 2.5, type: 'S' },
    });
  });

  it('efface sur une valeur nulle', () => {
    const { plannings, effacees } = fusionnerCellules(depart, [
      { groupe: 'GM101', code: 'M101', semaine: 3, heures: null },
    ]);

    expect(plannings.GM101.M101).toBeUndefined();
    expect(effacees).toBe(1);
  });

  it('compte les écritures et nomme les groupes touchés', () => {
    const { ecrites, groupes } = fusionnerCellules(depart, [
      { groupe: 'GM101', code: 'M101', semaine: 5, heures: 5, type: 'P' },
      { groupe: 'GM101', code: 'M102', semaine: 9, heures: 5, type: 'P' },
    ]);

    expect(ecrites).toBe(2);
    expect(groupes).toEqual(['GM101']);
  });

  it('ne compte pas une valeur IDENTIQUE comme une écriture', () => {
    // Réimporter un fichier non modifié ne doit pas annoncer 700 changements.
    const { ecrites, effacees, groupes } = fusionnerCellules(depart, [
      { groupe: 'GM101', code: 'M101', semaine: 3, heures: 5, type: 'P' },
    ]);

    expect(ecrites).toBe(0);
    expect(effacees).toBe(0);
    expect(groupes).toEqual([]);
  });

  it('ne modifie PAS l’objet reçu', () => {
    const copie = structuredClone(depart);
    fusionnerCellules(depart, [{ groupe: 'GM101', code: 'M101', semaine: 3, heures: null }]);
    expect(depart).toEqual(copie);
  });
});

describe('aller-retour export → import', () => {
  it('redonne EXACTEMENT le planning de départ', () => {
    /*
     * ⚠️ LE GARDE-FOU DE CETTE FONCTIONNALITÉ. Le fichier n'existe que pour être
     * retouché hors ligne puis relu : s'il ne revient pas identique quand on n'y
     * touche pas, il n'est bon à rien. Comparer des cellules à la main aurait
     * laissé passer une colonne décalée ou un type inversé.
     */
    const planning = {
      M101: { 3: { heures: 5, type: 'P' }, 4: { heures: 2.5, type: 'S' }, 12: { heures: 20, type: 'P' } },
      M102: { 8: { heures: 10, type: 'P' } },
    };

    const lignes = lignesClasseur(MODULES, planning);

    const corps = lignes.map((l) =>
      ligne(
        [l.code, l.intitule, l.semestre, l.regional, l.formateurs, l.type],
        Object.fromEntries(Object.entries(l.heures))
      )
    );

    const relu = lireFeuilleChronogramme(feuille({ corps }), referentiel);
    const { plannings } = fusionnerCellules({ GM101: {} }, relu.cellules);

    expect(relu.refus).toEqual([]);
    expect(plannings.GM101).toEqual(planning);
  });
});
