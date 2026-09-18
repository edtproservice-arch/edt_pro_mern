import { describe, it, expect } from 'vitest';
import {
  detecterColonnes,
  lireFormateurs,
  fusionnerFormateurs,
  CANEVAS_FORMATEURS,
} from './importFormateurs.js';

const CANEVAS = [
  ['Mle', 'Nom & Prénom', 'MHS Annuelle'],
  ['61630', 'AMINE JAWAD', '910'],
  ['70245', 'KARIM AHMED', '1260'],
  ['BX10245', 'YASSINE SAID', '360'],
];

describe('detecterColonnes', () => {
  it('reconnaît le canevas officiel', () => {
    expect(detecterColonnes(CANEVAS)).toEqual({
      ligneEntete: 0,
      matricule: 0,
      nom: 1,
      masseHoraire: 2,
      email: -1,
    });
  });

  it('trouve un en-tête placé après un titre', () => {
    const avecTitre = [
      ['ÉTAT DES FORMATEURS — ISTA'],
      [],
      ['Matricule', 'Formateur', 'Masse horaire', 'Email'],
      ['9863', 'AHMED CHERKAOUI', '720', 'a@ofppt.ma'],
    ];

    expect(detecterColonnes(avecTitre)).toMatchObject({ ligneEntete: 2, nom: 1, email: 3 });
  });

  it('accepte un ordre de colonnes différent', () => {
    const inverse = [['MHS Annuelle', 'Nom & Prénom', 'Mle']];
    expect(detecterColonnes(inverse)).toMatchObject({ masseHoraire: 0, nom: 1, matricule: 2 });
  });

  it('accepte MHA et « masse » comme intitulé de masse horaire', () => {
    expect(detecterColonnes([['Mle', 'Nom', 'MHA']])).toMatchObject({ masseHoraire: 2 });
    expect(detecterColonnes([['Mle', 'Nom', 'Masse horaire']])).toMatchObject({ masseHoraire: 2 });
  });

  it('rend null quand aucune colonne de nom n\'existe', () => {
    expect(detecterColonnes([['Mle', 'MHS'], ['9863', '720']])).toBeNull();
  });

  it('ne cherche pas l\'en-tête au-delà des cinq premières lignes', () => {
    const tardif = [[], [], [], [], [], ['Mle', 'Nom & Prénom']];
    expect(detecterColonnes(tardif)).toBeNull();
  });

  it('refuse autre chose qu\'un tableau', () => {
    expect(() => detecterColonnes(null)).toThrow(TypeError);
  });
});

describe('lireFormateurs', () => {
  it('lit les trois lignes du canevas', () => {
    const { formateurs } = lireFormateurs(CANEVAS);

    expect(formateurs).toEqual([
      { nom: 'AMINE JAWAD', matricule: '61630', email: '', masseHoraire: 910 },
      { nom: 'KARIM AHMED', matricule: '70245', email: '', masseHoraire: 1260 },
      { nom: 'YASSINE SAID', matricule: 'BX10245', email: '', masseHoraire: 360 },
    ]);
  });

  it('met les noms en majuscules — c\'est la clé d\'appariement', () => {
    const { formateurs } = lireFormateurs([['Mle', 'Nom'], ['9863', 'Ahmed Cherkaoui']]);
    expect(formateurs[0].nom).toBe('AHMED CHERKAOUI');
  });

  it('ignore les lignes sans nom et les doublons', () => {
    const { formateurs, lignesIgnorees } = lireFormateurs([
      ['Mle', 'Nom & Prénom', 'MHS'],
      ['1', 'AMINE JAWAD', '910'],
      ['2', '', '500'],
      ['3', 'AMINE JAWAD', '999'],
    ]);

    expect(formateurs).toHaveLength(1);
    expect(lignesIgnorees).toBe(2);
  });

  it('accepte une masse horaire absente ou illisible', () => {
    const { formateurs } = lireFormateurs([
      ['Mle', 'Nom & Prénom', 'MHS'],
      ['1', 'AMINE JAWAD', 'n/a'],
      ['2', 'KARIM AHMED'],
    ]);

    expect(formateurs.map((f) => f.masseHoraire)).toEqual([0, 0]);
  });

  it('accepte un fichier sans colonne matricule', () => {
    const { formateurs } = lireFormateurs([['Nom & Prénom'], ['AMINE JAWAD']]);
    expect(formateurs[0]).toEqual({
      nom: 'AMINE JAWAD',
      matricule: '',
      email: '',
      masseHoraire: 0,
    });
  });

  it('refuse un fichier sans colonne de nom', () => {
    expect(() => lireFormateurs([['Mle', 'MHS'], ['1', '910']])).toThrow(/Nom & Prénom/);
  });
});

describe('fusionnerFormateurs — mode « compléter »', () => {
  const existants = [
    { nom: 'AMINE JAWAD', matricule: '61630', email: 'a.jawad@ofppt.ma', masseHoraire: 910 },
  ];

  it('ajoute les nouveaux sans toucher aux anciens', () => {
    const { formateurs, ajoutes, misAJour, retires } = fusionnerFormateurs(existants, [
      { nom: 'KARIM AHMED', matricule: '70245', email: '', masseHoraire: 1260 },
    ]);

    expect(ajoutes).toBe(1);
    expect(misAJour).toBe(0);
    expect(retires).toEqual([]);
    expect(formateurs.map((f) => f.nom)).toEqual(['AMINE JAWAD', 'KARIM AHMED']);
  });

  it('apparie sur le matricule même si le nom a changé d\'ordre', () => {
    const { formateurs, misAJour } = fusionnerFormateurs(existants, [
      { nom: 'JAWAD AMINE', matricule: '61630', email: '', masseHoraire: 1000 },
    ]);

    expect(misAJour).toBe(1);
    expect(formateurs).toHaveLength(1);
    expect(formateurs[0]).toMatchObject({ nom: 'JAWAD AMINE', masseHoraire: 1000 });
  });

  it('n\'efface pas une valeur saisie par un champ vide du fichier', () => {
    const { formateurs } = fusionnerFormateurs(existants, [
      { nom: 'AMINE JAWAD', matricule: '61630', email: '', masseHoraire: 0 },
    ]);

    expect(formateurs[0].email).toBe('a.jawad@ofppt.ma');
    expect(formateurs[0].masseHoraire).toBe(910);
  });

  it('ne retire jamais personne, même absent du fichier', () => {
    const { formateurs, retires } = fusionnerFormateurs(existants, [
      { nom: 'KARIM AHMED', matricule: '70245' },
    ]);

    expect(retires).toEqual([]);
    expect(formateurs).toHaveLength(2);
  });
});

describe('fusionnerFormateurs — mode « remplacer »', () => {
  const existants = [
    { nom: 'AMINE JAWAD', matricule: '61630', masseHoraire: 910 },
    { nom: 'KARIM AHMED', matricule: '70245', masseHoraire: 1260 },
    { nom: 'YASSINE SAID', matricule: 'BX10245', masseHoraire: 360 },
  ];

  it('retire les absents du fichier', () => {
    const { formateurs, retires } = fusionnerFormateurs(
      existants,
      [{ nom: 'AMINE JAWAD', matricule: '61630' }],
      { remplacer: true }
    );

    expect(retires.sort()).toEqual(['KARIM AHMED', 'YASSINE SAID']);
    expect(formateurs.map((f) => f.nom)).toEqual(['AMINE JAWAD']);
  });

  it('conserve un absent qui porte encore une affectation', () => {
    // Le remplacement brut de l'existant effaçait ce formateur ET son
    // affectation, sans le signaler.
    const { formateurs, retires, conserves } = fusionnerFormateurs(
      existants,
      [{ nom: 'AMINE JAWAD', matricule: '61630' }],
      { remplacer: true, proteges: ['KARIM AHMED'] }
    );

    expect(conserves).toEqual(['KARIM AHMED']);
    expect(retires).toEqual(['YASSINE SAID']);
    expect(formateurs.map((f) => f.nom)).toEqual(['AMINE JAWAD', 'KARIM AHMED']);
  });

  it('apparie les protégés sans tenir compte de la casse', () => {
    const { conserves } = fusionnerFormateurs(existants, [], {
      remplacer: true,
      proteges: ['karim ahmed'],
    });

    expect(conserves).toEqual(['KARIM AHMED']);
  });
});

describe('CANEVAS_FORMATEURS', () => {
  it('est lisible par le lecteur lui-même — le canevas montré est un fichier valide', () => {
    const { formateurs } = lireFormateurs([
      CANEVAS_FORMATEURS.colonnes,
      ...CANEVAS_FORMATEURS.exemples,
    ]);

    expect(formateurs).toHaveLength(3);
    expect(formateurs[2]).toMatchObject({ nom: 'YASSINE SAID', matricule: 'BX10245' });
  });
});
