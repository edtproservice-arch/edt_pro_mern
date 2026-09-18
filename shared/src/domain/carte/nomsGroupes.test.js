import { describe, it, expect } from 'vitest';
import {
  prefixeNomGroupe,
  codeSecteur,
  estCoursDuSoir,
  sansSuffixe,
  prefixeDuNom,
  suffixeGroupe,
  conflitsDePrefixe,
  genererNomsGroupes,
  renommagesDesambiguisation,
  nomGroupeBrut,
} from './nomsGroupes.js';

describe('prefixeNomGroupe', () => {
  it('prend le deuxième segment quand le code en compte trois ou plus', () => {
    expect(prefixeNomGroupe('GE_GE_TS')).toBe('GE');
    expect(prefixeNomGroupe('GM_BECM_TS_RCDS')).toBe('BECM');
    expect(prefixeNomGroupe('AE_IRMC_FQ_RCDS')).toBe('IRMC');
  });

  it('écarte le niveau quand le code n\'a que deux segments', () => {
    expect(prefixeNomGroupe('DEVOWFS_S')).toBe('DEVOWFS');
    expect(prefixeNomGroupe('ACADA_TS')).toBe('ACADA');
    expect(prefixeNomGroupe('ACADA_FQ')).toBe('ACADA');
  });

  it('garde le second segment quand ce n\'est pas un niveau connu', () => {
    expect(prefixeNomGroupe('GE_ELECTRO')).toBe('ELECTRO');
  });

  it('retombe sur les quatre premiers caractères sans séparateur', () => {
    expect(prefixeNomGroupe('DEVELOPPEMENT')).toBe('DEVE');
    expect(prefixeNomGroupe('a-b/c')).toBe('ABC');
  });

  it('donne GRP faute de code exploitable', () => {
    expect(prefixeNomGroupe('')).toBe('GRP');
    expect(prefixeNomGroupe(null)).toBe('GRP');
    expect(prefixeNomGroupe('---')).toBe('GRP');
  });
});

describe('codeSecteur', () => {
  it('prend le premier segment, nettoyé', () => {
    expect(codeSecteur('FGT_GE_TS')).toBe('FGT');
    expect(codeSecteur('gm_becm_ts')).toBe('GM');
  });

  it('rend une chaîne vide quand il n\'y a rien à extraire', () => {
    expect(codeSecteur('')).toBe('');
    expect(codeSecteur('--_X')).toBe('');
  });
});

describe('estCoursDuSoir', () => {
  it('reconnaît le suffixe _RCDS, quelle que soit la casse', () => {
    expect(estCoursDuSoir('GM_BECM_TS_RCDS')).toBe(true);
    expect(estCoursDuSoir('gm_becm_ts_rcds')).toBe(true);
  });

  it('ne confond pas avec un code qui contient CDS ailleurs', () => {
    expect(estCoursDuSoir('CDS_GE_TS')).toBe(false);
    expect(estCoursDuSoir('GM_BECM_TS')).toBe(false);
  });
});

describe('sansSuffixe et prefixeDuNom', () => {
  it('retire tous les suffixes entre parenthèses', () => {
    expect(sansSuffixe('BECM101 (CDS) (GM)')).toBe('BECM101');
    expect(sansSuffixe('DEV201')).toBe('DEV201');
  });

  it('extrait le préfixe alphabétique', () => {
    expect(prefixeDuNom('GE101 (FGT)')).toBe('GE');
    expect(prefixeDuNom('DEVOWFS201')).toBe('DEVOWFS');
  });

  it('rend le nom entier quand il ne commence pas par des lettres', () => {
    expect(prefixeDuNom('101')).toBe('101');
  });
});

describe('suffixeGroupe', () => {
  it('n\'ajoute rien pour un cours du jour sans conflit', () => {
    expect(suffixeGroupe('DEVOWFS_S')).toBe('');
  });

  it('ajoute (CDS) pour une filière du soir', () => {
    expect(suffixeGroupe('GM_BECM_TS_RCDS')).toBe(' (CDS)');
  });

  it('ajoute le code secteur en cas de conflit, après (CDS)', () => {
    expect(suffixeGroupe('FGT_GE_TS', { desambiguiser: true })).toBe(' (FGT)');
    expect(suffixeGroupe('GM_BECM_TS_RCDS', { desambiguiser: true })).toBe(' (CDS) (GM)');
  });

  it('n\'ajoute pas de parenthèses vides quand le secteur est indéterminable', () => {
    expect(suffixeGroupe('_GE_TS', { desambiguiser: true })).toBe('');
  });
});

describe('conflitsDePrefixe', () => {
  const existants = [
    { nom: 'GE101', codeFiliere: 'GE_GE_TS' },
    { nom: 'GE102', codeFiliere: 'GE_GE_TS' },
    { nom: 'DEV201', codeFiliere: 'DEVOWFS_S' },
  ];

  it('signale les filières distinctes qui partagent le préfixe', () => {
    const conflits = conflitsDePrefixe('GE', 'FGT_GE_TS', existants);
    expect([...conflits.keys()]).toEqual(['GE_GE_TS']);
    expect(conflits.get('GE_GE_TS')).toEqual(['GE101', 'GE102']);
  });

  it('ignore la filière en cours — regénérer ses groupes n\'est pas un conflit', () => {
    expect(conflitsDePrefixe('GE', 'GE_GE_TS', existants).size).toBe(0);
  });

  it('ignore les entrées sans nom', () => {
    expect(conflitsDePrefixe('GE', 'FGT_GE_TS', [{ codeFiliere: 'GE_GE_TS' }]).size).toBe(0);
  });
});

describe('genererNomsGroupes', () => {
  it('numérote à partir de l\'année × 100', () => {
    const { noms, prefixe } = genererNomsGroupes({
      codeFiliere: 'DEVOWFS_S',
      anneeFormation: 2,
      nombre: 3,
    });

    expect(prefixe).toBe('DEVOWFS');
    expect(noms).toEqual(['DEVOWFS201', 'DEVOWFS202', 'DEVOWFS203']);
  });

  it('suffixe les groupes du soir', () => {
    const { noms } = genererNomsGroupes({ codeFiliere: 'GM_BECM_TS_RCDS', anneeFormation: 1 });
    expect(noms).toEqual(['BECM101 (CDS)']);
  });

  it('désambiguïse quand une autre filière occupe déjà le préfixe', () => {
    const { noms, conflits } = genererNomsGroupes({
      codeFiliere: 'FGT_GE_TS',
      anneeFormation: 1,
      nombre: 2,
      groupesExistants: [{ nom: 'GE101', codeFiliere: 'GE_GE_TS' }],
    });

    expect(noms).toEqual(['GE101 (FGT)', 'GE102 (FGT)']);
    expect(conflits.size).toBe(1);
  });

  it('reprend la numérotation après les groupes existants', () => {
    // Sans cela, générer un second groupe rendait « DEVOWFS101 » — le nom du
    // premier — et le remplaçait au lieu de s'y ajouter.
    const { noms, depart } = genererNomsGroupes({
      codeFiliere: 'DEVOWFS_S',
      anneeFormation: 1,
      nombre: 2,
      groupesExistants: [
        { nom: 'DEVOWFS101', codeFiliere: 'DEVOWFS_S' },
        { nom: 'DEVOWFS102', codeFiliere: 'DEVOWFS_S' },
      ],
    });

    expect(depart).toBe(3);
    expect(noms).toEqual(['DEVOWFS103', 'DEVOWFS104']);
  });

  it('permet deux modes de formation dans la même filière', () => {
    // Un groupe résidentiel et un groupe alterné de la même filière : ils ne
    // peuvent pas porter le même nom, sinon le second écrase le premier.
    const residentiel = genererNomsGroupes({ codeFiliere: 'GM_GM_TS', anneeFormation: 1 });
    const alterne = genererNomsGroupes({
      codeFiliere: 'GM_GM_TS',
      anneeFormation: 1,
      groupesExistants: [{ nom: residentiel.noms[0], codeFiliere: 'GM_GM_TS' }],
    });

    expect(residentiel.noms).toEqual(['GM101']);
    expect(alterne.noms).toEqual(['GM102']);
  });

  it('ne compte pas les groupes d\'une autre année', () => {
    const { noms } = genererNomsGroupes({
      codeFiliere: 'GM_GM_TS',
      anneeFormation: 1,
      // GM201 est l'année 2 : il n'occupe pas un rang de l'année 1.
      groupesExistants: [{ nom: 'GM201', codeFiliere: 'GM_GM_TS' }],
    });

    expect(noms).toEqual(['GM101']);
  });

  it('ne compte pas le groupe d\'une filière homonyme', () => {
    const { noms } = genererNomsGroupes({
      codeFiliere: 'GE_GE_TS',
      anneeFormation: 1,
      groupesExistants: [{ nom: 'GE101 (FGT)', codeFiliere: 'FGT_GE_TS' }],
    });

    // Le suffixe sépare déjà les deux : « GE101 (GE) » et « GE101 (FGT) » ne se
    // confondent pas. Avancer le compteur créerait un trou sans raison.
    expect(noms).toEqual(['GE101 (GE)']);
  });

  it('ignore un nom qui ne se termine pas par un numéro', () => {
    const { noms } = genererNomsGroupes({
      codeFiliere: 'GM_GM_TS',
      anneeFormation: 1,
      groupesExistants: [{ nom: 'GM', codeFiliere: 'GM_GM_TS' }],
    });

    expect(noms).toEqual(['GM101']);
  });

  it('retient une année de formation illisible à 1', () => {
    const { noms } = genererNomsGroupes({ codeFiliere: 'DEVOWFS_S', anneeFormation: 'n/a' });
    expect(noms).toEqual(['DEVOWFS101']);
  });

  it('refuse un nombre de groupes hors bornes', () => {
    const appel = (nombre) => () =>
      genererNomsGroupes({ codeFiliere: 'DEVOWFS_S', anneeFormation: 1, nombre });

    expect(appel(0)).toThrow(TypeError);
    expect(appel(21)).toThrow(TypeError);
    expect(appel(1.5)).toThrow(TypeError);
  });
});

describe('renommagesDesambiguisation', () => {
  it('ajoute le code secteur aux groupes encore sans suffixe', () => {
    const conflits = new Map([['GE_GE_TS', ['GE101', 'GE102']]]);

    expect(renommagesDesambiguisation(conflits)).toEqual([
      { ancien: 'GE101', nouveau: 'GE101 (GE)' },
      { ancien: 'GE102', nouveau: 'GE102 (GE)' },
    ]);
  });

  it('laisse intact un groupe déjà suffixé — un second suffixe le rendrait introuvable', () => {
    const conflits = new Map([['GE_GE_TS', ['GE101 (GE)']]]);
    expect(renommagesDesambiguisation(conflits)).toEqual([]);
  });

  it('ignore une filière dont le secteur est indéterminable', () => {
    expect(renommagesDesambiguisation(new Map([['', ['GE101']]]))).toEqual([]);
  });
});

describe('nomGroupeBrut', () => {
  it('retire le suffixe que l\'import saura recalculer', () => {
    expect(nomGroupeBrut('BECM101 (CDS)', 'GM_BECM_TS_RCDS')).toBe('BECM101');
    expect(nomGroupeBrut('ACADA101 (FQ)', 'ACADA_FQ')).toBe('ACADA101');
  });

  it('retire un suffixe qui répète le préfixe de la filière', () => {
    expect(nomGroupeBrut('GE101 (GE)', 'GE_GE_TS')).toBe('GE101');
  });

  it('retire le suffixe de désambiguïsation, que l\'import redéduit du code', () => {
    // (FGT) est le PREMIER segment de FGT_GE_TS : `construireGroupes` le
    // recalcule. Le laisser produirait « GE101 (FGT) (FGT) ».
    expect(nomGroupeBrut('GE101 (FGT)', 'FGT_GE_TS')).toBe('GE101');
  });

  it('garde un suffixe étranger au code — l\'import ne saurait pas le retrouver', () => {
    expect(nomGroupeBrut('GE101 (SOIR)', 'FGT_GE_TS')).toBe('GE101 (SOIR)');
  });

  it('laisse intact un nom sans suffixe', () => {
    expect(nomGroupeBrut('DEV201', 'DEVOWFS_S')).toBe('DEV201');
    expect(nomGroupeBrut('', 'DEVOWFS_S')).toBe('');
  });

  it('laisse intact un nom réduit à un suffixe', () => {
    expect(nomGroupeBrut('(CDS)', 'GM_BECM_TS_RCDS')).toBe('(CDS)');
  });
});
