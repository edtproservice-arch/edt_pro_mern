import { describe, it, expect } from 'vitest';
import { analyser, choisirFeuille, cleLigne, dedoublonner, lireLignes } from './import.js';
import { COLONNES, COLONNES_OBLIGATOIRES, nombre, estRegional } from './colonnes.js';

/** Un en-tête complet, dans l'ordre officiel. */
const ENTETES = Object.keys(COLONNES);

/** Une ligne de classeur, à partir de valeurs nommées. */
function ligneClasseur(valeurs = {}) {
  return ENTETES.map((intitule) => String(valeurs[intitule] ?? ''));
}

const LIGNE_TYPE = {
  Secteur: 'Aéronautique',
  'Niveau de formation': 'TS',
  'Type de formation': 'Diplômante',
  Créneau: 'RES',
  'Code Filière DRIF': 'AE_TEST',
  'Intitulé Filière DRIF': 'Filière de test',
  'Code Filière Carte': 'AE_TEST',
  Filière: 'Filière de test',
  'Anneé de Formation': '1',
  'Code Module': 'M101',
  Module: 'Anglais',
  'MHP S1': '30',
  'MHP S2': '0',
  'EFM Régional': 'O',
  Métier: 'construction',
};

describe('nombre', () => {
  /*
   * ⚠️ LA VIRGULE EST LE SÉPARATEUR DÉCIMAL DES CLASSEURS MAROCAINS :
   * `Number('12,5')` rend `NaN`, et la masse horaire disparaîtrait sans erreur.
   */
  it('lit la virgule décimale comme le point', () => {
    expect(nombre('12,5')).toBe(12.5);
    expect(nombre('12.5')).toBe(12.5);
    expect(nombre(12.5)).toBe(12.5);
  });

  it('rend zéro sur une cellule vide ou illisible', () => {
    expect(nombre('')).toBe(0);
    expect(nombre('n/a')).toBe(0);
    expect(nombre(null)).toBe(0);
  });

  /*
   * ⚠️ UN NOMBRE PEUT ÊTRE INVALIDE SANS ÊTRE UNE CHAÎNE : une cellule
   * d'erreur (#DIV/0!) revient parfois en `NaN` du lecteur de classeur, et une
   * masse `NaN` contaminerait tous les totaux qui la traversent.
   */
  it('rend zéro sur un nombre non fini', () => {
    expect(nombre(Number.NaN)).toBe(0);
    expect(nombre(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('estRegional', () => {
  /* ⚠️ « O »/« N », pas un booléen : c'est l'écriture du classeur et de MySQL. */
  it('ne retient que « O »', () => {
    expect(estRegional('O')).toBe(true);
    expect(estRegional(' o ')).toBe(true);
    expect(estRegional('N')).toBe(false);
    expect(estRegional('')).toBe(false);
    /* Une cellule ABSENTE, pas seulement vide : une ligne tronquée par le
       lecteur de classeur ne rend rien du tout pour ses dernières colonnes. */
    expect(estRegional(null)).toBe(false);
    expect(estRegional(undefined)).toBe(false);
  });
});

describe('choisirFeuille', () => {
  it('préfère « RepartitionHoraire » même si elle n’est pas la première', () => {
    const feuilles = [
      { nom: 'Synthèse', lignes: [['Secteur', 'Total']] },
      { nom: 'RepartitionHoraire', lignes: [ENTETES] },
    ];

    expect(choisirFeuille(feuilles)?.nom).toBe('RepartitionHoraire');
  });

  /*
   * ═══ ⚠️ LA FEUILLE DE SYNTHÈSE NE PORTE PAS LA VENTILATION S1 / S2 ═══
   * Prendre la première feuille venue reviendrait à importer des masses
   * annuelles à la place des masses semestrielles, sans qu'aucun message ne le
   * signale. On retient donc la première qui porte les colonnes OBLIGATOIRES.
   */
  it('écarte une feuille à laquelle il manque une colonne obligatoire', () => {
    const amputee = ENTETES.filter((intitule) => intitule !== 'MHP S2');
    const feuilles = [
      { nom: 'Synthèse', lignes: [amputee] },
      { nom: 'Données', lignes: [ENTETES] },
    ];

    expect(choisirFeuille(feuilles)?.nom).toBe('Données');
  });

  /* Les classeurs portent souvent un titre ou une ligne vide avant l'en-tête. */
  it('trouve un en-tête qui n’est pas sur la première ligne', () => {
    const feuilles = [
      { nom: 'Données', lignes: [['RÉPARTITION 2026'], [], ENTETES] },
    ];

    expect(choisirFeuille(feuilles)).toMatchObject({ nom: 'Données', indexEntete: 2 });
  });

  it('rend null quand aucune feuille n’est exploitable', () => {
    expect(choisirFeuille([{ nom: 'Vide', lignes: [['a', 'b']] }])).toBeNull();
    expect(choisirFeuille([])).toBeNull();
  });

  it('les colonnes obligatoires font toutes partie des colonnes lues', () => {
    /* Sans quoi une colonne pourrait être exigée sans jamais être importée. */
    expect(COLONNES_OBLIGATOIRES.every((c) => ENTETES.includes(c))).toBe(true);
  });
});

describe('lireLignes', () => {
  it('convertit une ligne aux champs du modèle', () => {
    const { lignes } = lireLignes([ENTETES, ligneClasseur(LIGNE_TYPE)], ENTETES, 0);

    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      secteur: 'Aéronautique',
      codeFiliereDrif: 'AE_TEST',
      anneeFormation: 1,
      codeModule: 'M101',
      module: 'Anglais',
      mhpS1: 30,
      efmRegional: true,
    });
  });

  /*
   * ═══ ⚠️ ON APPARIE PAR INTITULÉ, JAMAIS PAR INDEX ═══
   * Les classeurs officiels comptent 43 colonnes dont l'ordre a déjà changé
   * d'une année à l'autre : lu par position, l'import poserait les masses
   * horaires dans les mauvais champs sans rien signaler.
   */
  it('suit les colonnes même quand leur ordre change', () => {
    const inverse = [...ENTETES].reverse();
    const brute = inverse.map((intitule) => String(LIGNE_TYPE[intitule] ?? ''));

    const { lignes } = lireLignes([inverse, brute], inverse, 0);

    expect(lignes[0].codeModule).toBe('M101');
    expect(lignes[0].mhpS1).toBe(30);
  });

  /* Les classeurs portent des sous-totaux et des séparateurs. */
  it('écarte les lignes sans filière ou sans module, et les compte', () => {
    const { lignes, ignorees } = lireLignes(
      [
        ENTETES,
        ligneClasseur(LIGNE_TYPE),
        ligneClasseur({ ...LIGNE_TYPE, 'Code Module': '' }),
        ligneClasseur({ ...LIGNE_TYPE, 'Code Filière DRIF': '' }),
      ],
      ENTETES,
      0
    );

    expect(lignes).toHaveLength(1);
    expect(ignorees).toBe(2);
  });

  /*
   * ═══ ⚠️ UNE LIGNE PLUS COURTE QUE SON EN-TÊTE ═══
   * SheetJS TRONQUE une ligne après sa dernière cellule renseignée : les
   * colonnes de droite n'existent alors même pas dans le tableau. Le piège est
   * déjà consigné pour l'e-note ; ici il toucherait « EFM Régional » et
   * « Métier », qui ferment la liste.
   */
  it('supporte une ligne tronquée après sa dernière cellule remplie', () => {
    const courte = ENTETES.slice(0, 11).map((intitule) => String(LIGNE_TYPE[intitule] ?? ''));

    const { lignes } = lireLignes([ENTETES, courte], ENTETES, 0);

    expect(lignes).toHaveLength(1);
    expect(lignes[0].codeModule).toBe('M101');
    /* Les colonnes absentes prennent leur valeur par défaut, sans planter. */
    expect(lignes[0].mhpS1).toBe(0);
    expect(lignes[0].efmRegional).toBe(false);
    expect(lignes[0].metier).toBe('');
  });

  it('signale les colonnes lues qui manquent au classeur', () => {
    const amputee = ENTETES.filter((intitule) => intitule !== 'Métier');
    const { lignes, colonnesAbsentes } = lireLignes([amputee, amputee.map(() => 'x')], amputee, 0);

    expect(colonnesAbsentes).toEqual(['Métier']);
    /* La colonne absente ne casse pas la lecture : elle vaut sa valeur par défaut. */
    expect(lignes[0].metier).toBe('');
  });
});

describe('cleLigne', () => {
  /*
   * ═══ ⚠️ L'INTITULÉ DU MODULE NE FAIT PAS PARTIE DE L'IDENTITÉ ═══
   * Deux lignes qui ne diffèrent que par leur libellé décrivent LE MÊME
   * module : l'une corrige l'autre. C'est la clé de `rep_cle_ligne()`, et
   * l'index unique du modèle a été aligné dessus le 2026-09-02 — il incluait
   * l'intitulé, ce qui aurait fait insérer un doublon à chaque correction.
   */
  it('ignore l’intitulé du module', () => {
    const a = { codeFiliereDrif: 'AE_TEST', anneeFormation: 1, codeModule: 'M101', module: 'Anglais' };
    const b = { ...a, module: 'Anglais technique' };

    expect(cleLigne(a)).toBe(cleLigne(b));
  });

  it('ne distingue ni la casse ni les espaces', () => {
    const a = { codeFiliereDrif: 'ae_test', anneeFormation: 1, codeModule: ' m101 ' };
    const b = { codeFiliereDrif: 'AE_TEST', anneeFormation: 1, codeModule: 'M101' };

    expect(cleLigne(a)).toBe(cleLigne(b));
  });

  /* Une ligne sans année ne doit pas rendre « undefined » dans la clé, ce qui
     la ferait entrer en collision avec une autre ligne tout aussi incomplète
     mais d'une AUTRE année. */
  it('supporte une ligne dont l’année manque', () => {
    expect(cleLigne({ codeFiliereDrif: 'AE_TEST', codeModule: 'M101' })).toBe('AE_TEST||||M101');
    expect(cleLigne({})).toBe('||||');
  });

  it('sépare deux années de la même filière', () => {
    const a = { codeFiliereDrif: 'AE_TEST', anneeFormation: 1, codeModule: 'M101' };
    expect(cleLigne(a)).not.toBe(cleLigne({ ...a, anneeFormation: 2 }));
  });
});

describe('dedoublonner', () => {
  /*
   * ⚠️ INDISPENSABLE AU REMPLACEMENT : l'index unique refuserait le second
   * exemplaire d'une clé répétée, et l'insertion échouerait APRÈS avoir vidé le
   * référentiel — il ne resterait rien.
   */
  it('ne garde qu’une ligne par identité, la dernière', () => {
    const base = { codeFiliereDrif: 'AE_TEST', anneeFormation: 1, codeModule: 'M101' };

    const uniques = dedoublonner([
      { ...base, mhpS1: 10 },
      { ...base, mhpS1: 20 },
      { ...base, codeModule: 'M102', mhpS1: 5 },
    ]);

    expect(uniques).toHaveLength(2);
    expect(uniques[0].mhpS1).toBe(20);
  });

  /* Même règle que `analyser` : l'intitulé ne fait pas l'identité. */
  it('confond deux lignes qui ne diffèrent que par l’intitulé', () => {
    const base = { codeFiliereDrif: 'AE_TEST', anneeFormation: 1, codeModule: 'M101' };
    expect(dedoublonner([{ ...base, module: 'Anglais' }, { ...base, module: 'Anglais tech.' }]))
      .toHaveLength(1);
  });

  it('rend un tableau vide sur une entrée vide', () => {
    expect(dedoublonner()).toEqual([]);
  });
});

describe('analyser', () => {
  const existante = {
    codeFiliereDrif: 'AE_TEST',
    anneeFormation: 1,
    codeModule: 'M101',
    module: 'Anglais',
    mhpS1: 30,
    mhpS2: 0,
    efmRegional: false,
    secteur: 'Aéronautique',
  };

  it('distingue ajout, correction et ligne identique', () => {
    const bilan = analyser(
      [existante],
      [
        { ...existante },
        { ...existante, codeModule: 'M102', module: 'Français' },
        { ...existante, anneeFormation: 2, codeModule: 'M201' },
      ]
    );

    expect(bilan.identiques).toBe(1);
    expect(bilan.ajouts).toHaveLength(2);
    expect(bilan.corrections).toHaveLength(0);
  });

  /*
   * ═══ TROIS SORTS, PAS DEUX ═══
   * `rep_completer()` ne connaissait que « nouvelle » et « déjà connue » : une
   * masse corrigée par la DRIF était IGNORÉE en silence.
   */
  it('repère une masse horaire corrigée et NOMME les champs qui changent', () => {
    const bilan = analyser([existante], [{ ...existante, mhpS1: 45 }]);

    expect(bilan.ajouts).toHaveLength(0);
    expect(bilan.identiques).toBe(0);
    expect(bilan.corrections).toHaveLength(1);
    expect(bilan.corrections[0].champs).toEqual(['mhpS1']);
    expect(bilan.corrections[0].ancienne.mhpS1).toBe(30);
    expect(bilan.corrections[0].nouvelle.mhpS1).toBe(45);
  });

  it('voit une correction d’intitulé, sans en faire un ajout', () => {
    const bilan = analyser([existante], [{ ...existante, module: 'Anglais technique' }]);

    expect(bilan.ajouts).toHaveLength(0);
    expect(bilan.corrections[0].champs).toEqual(['module']);
  });

  /* ⚠️ « 30 » et 30 sont la même masse : sans cela, tout classeur relu à
     l'identique se présenterait comme une correction de bout en bout. */
  it('ne prend pas un texte numérique pour une correction', () => {
    const bilan = analyser([existante], [{ ...existante, mhpS1: '30' }]);

    expect(bilan.corrections).toHaveLength(0);
    expect(bilan.identiques).toBe(1);
  });

  /*
   * « Le fichier ajoute une filière » et « il complète une filière existante »
   * n'appellent pas la même vigilance. ← les deux listes de `rep_completer()`.
   */
  it('sépare les filières ajoutées de celles qui sont complétées', () => {
    const bilan = analyser(
      [existante],
      [
        { ...existante, codeModule: 'M102' },
        { ...existante, codeFiliereDrif: 'AE_NEUVE', codeModule: 'M101' },
      ]
    );

    expect(bilan.filieresCompletees).toEqual(['AE_TEST']);
    expect(bilan.filieresAjoutees).toEqual(['AE_NEUVE']);
  });

  it('ne compte qu’une fois une clé répétée dans le fichier', () => {
    const bilan = analyser(
      [],
      [
        { ...existante, codeModule: 'M102', mhpS1: 10 },
        { ...existante, codeModule: 'M102', mhpS1: 20 },
      ]
    );

    expect(bilan.ajouts).toHaveLength(1);
    /* La DERNIÈRE l'emporte, comme le ferait une écriture successive. */
    expect(bilan.ajouts[0].mhpS1).toBe(20);
    expect(bilan.doublonsFichier).toBe(1);
  });

  /* Une ligne sans code de filière ne doit pas faire planter le classement des
     filières ajoutées — `lireLignes` l'écarte, mais `analyser` est aussi
     appelée sur des lignes venues de la base. */
  it('supporte une ligne existante sans code de filière', () => {
    const bilan = analyser([{ anneeFormation: 1, codeModule: 'M101' }], [{ ...existante }]);

    expect(bilan.ajouts).toHaveLength(1);
    expect(bilan.filieresAjoutees).toEqual(['AE_TEST']);
  });

  it('rend un bilan vide sur un fichier sans ligne', () => {
    const bilan = analyser([existante], []);

    expect(bilan.ajouts).toHaveLength(0);
    expect(bilan.corrections).toHaveLength(0);
    expect(bilan.identiques).toBe(0);
  });
});
