import { describe, it, expect } from 'vitest';
import {
  disponibilite,
  enJour,
  formationDuFormateur,
  fusionnerJoursFeries,
  jourFerie,
  stageDuGroupe,
  stageDuGroupeSurSemaine,
  vacances,
  absencesDuJour,
} from './calendrier.js';

/**
 * Le calendrier n'a pas de fixture de caractérisation : les règles sont en JS
 * dans emploi.html et se lisent directement. Les cas ci-dessous reprennent les
 * DONNÉES RÉELLES des tables `stages` et `formations` de production.
 */

// ← table `formations`, établissement 96
const FORMATIONS = [
  {
    matriculeFormateur: 'PB134876',
    nomFormateur: 'ABLAZIZ BOUKAL',
    debut: '2025-12-08',
    fin: '2025-12-24',
  },
  {
    matriculeFormateur: '10039',
    nomFormateur: 'SAMIR EL ACHOURI',
    debut: '2025-12-15',
    fin: '2025-12-21',
  },
];

describe('jourFerie', () => {
  const feries = [
    { date: '2026-01-01', libelle: "Jour de l'An" },
    { date: '2026-03-20', libelle: 'Aïd Al Fitr' },
  ];

  it('reconnaît un jour férié', () => {
    expect(jourFerie('2026-03-20', feries).libelle).toBe('Aïd Al Fitr');
    expect(jourFerie(new Date(2026, 2, 20), feries).libelle).toBe('Aïd Al Fitr');
  });

  it('renvoie null hors jour férié', () => {
    expect(jourFerie('2026-03-21', feries)).toBeNull();
    expect(jourFerie('date invalide', feries)).toBeNull();
  });
});

describe('vacances', () => {
  const periodes = [{ debut: '2025-12-20', fin: '2026-01-04', libelle: "Vacances d'hiver" }];

  it('couvre les bornes incluses', () => {
    expect(vacances('2025-12-20', periodes)).not.toBeNull();
    expect(vacances('2026-01-04', periodes)).not.toBeNull();
    expect(vacances('2025-12-19', periodes)).toBeNull();
    expect(vacances('2026-01-05', periodes)).toBeNull();
  });
});

describe('stages', () => {
  const stages = [
    { groupe: 'DEVOWFS201', debut: '2026-02-02', fin: '2026-02-27' },
    { groupe: 'GEOCF201 (CDS)', debut: '2026-03-02', fin: '2026-03-06' },
  ];

  it('bloque le groupe concerné, et lui seul', () => {
    expect(stageDuGroupe('DEVOWFS201', '2026-02-10', stages)).not.toBeNull();
    expect(stageDuGroupe('DEVOWFS202', '2026-02-10', stages)).toBeNull();
  });

  it('compare le nom APRÈS renommage, suffixe compris', () => {
    expect(stageDuGroupe('GEOCF201 (CDS)', '2026-03-03', stages)).not.toBeNull();
    expect(stageDuGroupe('GEOCF201', '2026-03-03', stages)).toBeNull();
  });

  it('marque la semaine dès qu\'un seul jour chevauche', () => {
    // ← isGroupOnInternshipDuringWeek : comparaison par chevauchement.
    // Le stage commence le lundi 2 mars ; la semaine du 23 février au 1er mars
    // ne doit pas être touchée, celle du 2 au 8 mars si.
    expect(stageDuGroupeSurSemaine('GEOCF201 (CDS)', '2026-02-23', '2026-03-01', stages)).toBeNull();
    expect(
      stageDuGroupeSurSemaine('GEOCF201 (CDS)', '2026-03-02', '2026-03-08', stages)
    ).not.toBeNull();
  });

  it('ignore un groupe vide', () => {
    expect(stageDuGroupe('', '2026-02-10', stages)).toBeNull();
  });

  it('accepte les noms de colonnes MySQL, tels que les fournira l\'ETL', () => {
    // Table `stages` : groupe_nom, date_debut, date_fin.
    const brutes = [{ groupe_nom: 'DEVOWFS201', date_debut: '2026-02-02', date_fin: '2026-02-27' }];

    expect(stageDuGroupe('DEVOWFS201', '2026-02-10', brutes)).not.toBeNull();
    expect(stageDuGroupeSurSemaine('DEVOWFS201', '2026-02-09', '2026-02-15', brutes)).not.toBeNull();
  });

  it('rejette une semaine mal bornée ou un groupe vide', () => {
    expect(stageDuGroupeSurSemaine('DEVOWFS201', 'hier', '2026-02-15', stages)).toBeNull();
    expect(stageDuGroupeSurSemaine('DEVOWFS201', '2026-02-09', 'demain', stages)).toBeNull();
    expect(stageDuGroupeSurSemaine('', '2026-02-09', '2026-02-15', stages)).toBeNull();
  });
});

describe('formationDuFormateur', () => {
  it('apparie sur le matricule, identifiant stable', () => {
    const trouve = formationDuFormateur(
      { matricule: 'PB134876', nomComplet: 'PEU IMPORTE' },
      '2025-12-10',
      FORMATIONS
    );
    expect(trouve).not.toBeNull();
  });

  it('retombe sur le nom exact quand le matricule manque', () => {
    expect(
      formationDuFormateur({ nomComplet: 'SAMIR EL ACHOURI' }, '2025-12-16', FORMATIONS)
    ).not.toBeNull();
  });

  it('respecte les bornes de la période', () => {
    const formateur = { matricule: '10039' };
    expect(formationDuFormateur(formateur, '2025-12-14', FORMATIONS)).toBeNull();
    expect(formationDuFormateur(formateur, '2025-12-15', FORMATIONS)).not.toBeNull();
    expect(formationDuFormateur(formateur, '2025-12-21', FORMATIONS)).not.toBeNull();
    expect(formationDuFormateur(formateur, '2025-12-22', FORMATIONS)).toBeNull();
  });

  it("n'apparie JAMAIS sur une valeur vide", () => {
    // ⚠️ Le défaut de l'existant : `"AMMARI".includes("")` vaut true, donc une
    // formation sans nom rendait TOUS les formateurs indisponibles.
    const formationSansNom = [{ nomFormateur: '', debut: '2025-12-01', fin: '2025-12-31' }];

    expect(formationDuFormateur({ nomComplet: 'AMMARI' }, '2025-12-10', formationSansNom)).toBeNull();
    expect(
      formationDuFormateur({ matricule: '9863' }, '2025-12-10', formationSansNom)
    ).toBeNull();
  });

  it("n'apparie pas sur un nom seulement contenu dans un autre", () => {
    // L'existant appariait « AMMARI » avec « AMMARI HASSAN » et réciproquement.
    const formations = [
      { nomFormateur: 'AMMARI HASSAN', debut: '2025-12-01', fin: '2025-12-31' },
    ];
    expect(formationDuFormateur({ nomComplet: 'AMMARI' }, '2025-12-10', formations)).toBeNull();
  });

  it('ignore un formateur sans identifiant', () => {
    expect(formationDuFormateur({}, '2025-12-10', FORMATIONS)).toBeNull();
  });

  it('accepte les noms de colonnes MySQL, tels que les fournira l\'ETL', () => {
    // Pendant la reprise, les lignes arrivent avec les noms de la table
    // `formations` : matricule_formateur, nom_formateur, date_debut, date_fin.
    const brutes = [
      {
        matricule_formateur: 'PB134876',
        nom_formateur: 'ABLAZIZ BOUKAL',
        date_debut: '2025-12-08',
        date_fin: '2025-12-24',
      },
    ];

    expect(formationDuFormateur({ matricule: 'PB134876' }, '2025-12-10', brutes)).not.toBeNull();
    expect(
      formationDuFormateur({ nomComplet: 'ABLAZIZ BOUKAL' }, '2025-12-10', [
        { nom_formateur: 'ABLAZIZ BOUKAL', date_debut: '2025-12-08', date_fin: '2025-12-24' },
      ])
    ).not.toBeNull();
  });

  it('accepte un formateur passé sous forme de simple chaîne', () => {
    expect(formationDuFormateur('SAMIR EL ACHOURI', '2025-12-16', FORMATIONS)).not.toBeNull();
  });
});

describe('fusionnerJoursFeries — ajustements', () => {
  const depuisApi = [
    { date: '2026-03-20', libelle: 'Aïd Al Fitr' },
    { date: '2026-03-21', libelle: 'Aïd Al Fitr (2e jour)' },
    { date: '2026-05-27', libelle: 'Aïd Al Adha' },
  ];

  it('conserve les dates de l\'API sans ajustement', () => {
    const resultat = fusionnerJoursFeries(depuisApi, []);
    expect(resultat).toHaveLength(3);
    expect(resultat.every((f) => f.origine === 'api')).toBe(true);
  });

  it('décale une date corrigée par l\'établissement', () => {
    // Les fêtes religieuses sont des ESTIMATIONS, confirmées tardivement par
    // l'observation de la lune : la correction ne doit pas être écrasée au
    // prochain appel à l'API.
    const resultat = fusionnerJoursFeries(depuisApi, [
      { libelle: 'Aïd Al Fitr', date: '2026-03-21' },
    ]);

    const aid = resultat.find((f) => f.libelle === 'Aïd Al Fitr');
    expect(aid.date).toBe('2026-03-21');
    expect(aid.origine).toBe('ajuste');
  });

  it('retire une fête que l\'établissement ne retient pas', () => {
    const resultat = fusionnerJoursFeries(depuisApi, [
      { libelle: 'Aïd Al Fitr (2e jour)', supprime: true },
    ]);

    expect(resultat.map((f) => f.libelle)).not.toContain('Aïd Al Fitr (2e jour)');
    expect(resultat).toHaveLength(2);
  });

  it('ajoute un jour férié saisi à la main', () => {
    const resultat = fusionnerJoursFeries(depuisApi, [
      { libelle: 'Fête locale', date: '2026-04-15' },
    ]);

    const local = resultat.find((f) => f.libelle === 'Fête locale');
    expect(local.origine).toBe('manuel');
  });

  it('conserve la date de l\'API si l\'ajustement n\'en porte pas', () => {
    // Un ajustement peut ne servir qu'à marquer une fête sans la déplacer.
    const resultat = fusionnerJoursFeries(depuisApi, [{ libelle: 'Aïd Al Adha' }]);
    const aid = resultat.find((f) => f.libelle === 'Aïd Al Adha');

    expect(aid.date).toBe('2026-05-27');
    expect(aid.origine).toBe('ajuste');
  });

  it('ignore un ajustement manuel sans date', () => {
    // Sinon on produirait une entrée sans date, inexploitable.
    const resultat = fusionnerJoursFeries(depuisApi, [{ libelle: 'Fête sans date' }]);
    expect(resultat.map((f) => f.libelle)).not.toContain('Fête sans date');
    expect(resultat).toHaveLength(3);
  });

  it('rend une liste triée par date', () => {
    const resultat = fusionnerJoursFeries(depuisApi, [
      { libelle: 'Fête locale', date: '2026-01-10' },
    ]);
    expect(resultat[0].libelle).toBe('Fête locale');
    expect(resultat.map((f) => f.date)).toEqual([...resultat.map((f) => f.date)].sort());
  });
});

describe('disponibilite', () => {
  const contexte = {
    joursFeries: [{ date: '2026-01-01', libelle: "Jour de l'An" }],
    vacances: [{ debut: '2025-12-20', fin: '2026-01-04', libelle: 'Hiver' }],
    stages: [{ groupe: 'DEVOWFS201', debut: '2026-02-02', fin: '2026-02-27' }],
    formations: FORMATIONS,
  };

  it('autorise une séance ordinaire', () => {
    const resultat = disponibilite({
      ...contexte,
      date: '2026-01-15',
      groupe: 'DEVOWFS201',
      formateur: { matricule: '10039' },
    });
    expect(resultat).toEqual({ disponible: true, motif: null, detail: null });
  });

  it('annonce la cause la plus générale en premier', () => {
    // Le 1er janvier est à la fois férié ET en vacances : on annonce « férié ».
    expect(disponibilite({ ...contexte, date: '2026-01-01' }).motif).toBe('ferie');
    expect(disponibilite({ ...contexte, date: '2025-12-22' }).motif).toBe('vacances');
  });

  it('distingue une indisponibilité de groupe d\'une indisponibilité de formateur', () => {
    expect(
      disponibilite({ ...contexte, date: '2026-02-10', groupe: 'DEVOWFS201' }).motif
    ).toBe('stage');

    expect(
      disponibilite({ ...contexte, date: '2025-12-16', formateur: { matricule: '10039' } }).motif
    ).toBe('formation');
  });

  it('n\'applique le stage qu\'au groupe concerné', () => {
    expect(
      disponibilite({ ...contexte, date: '2026-02-10', groupe: 'DEVOWFS202' }).disponible
    ).toBe(true);
  });

  it('refuse une date invalide', () => {
    expect(() => disponibilite({ ...contexte, date: 'hier' })).toThrow(TypeError);
  });
});

describe('enJour', () => {
  it('accepte Date et chaîne, et rejette le reste', () => {
    expect(enJour(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(enJour('2026-01-05')).toBe('2026-01-05');
    expect(enJour('2026-01-05 14:30:00')).toBe('2026-01-05');
    expect(enJour('05/01/2026')).toBeNull();
    expect(enJour(null)).toBeNull();
  });
});

describe('absencesDuJour — qui manque ce jour-là', () => {
  const donnees = {
    stages: [
      { groupe: 'GM101', libelle: 'Stage entreprise', debut: '2026-09-14', fin: '2026-09-20' },
      { groupe: 'GM102', libelle: 'Stage', debut: '2026-10-05', fin: '2026-10-11' },
    ],
    formations: [
      {
        matriculeFormateur: '9863',
        nomFormateur: 'BRAHIM LOURID',
        libelle: 'Formation pédagogique',
        debut: '2026-09-14',
        fin: '2026-09-16',
      },
    ],
  };

  it('rend le groupe en stage et le formateur en formation', () => {
    const { stages, formations } = absencesDuJour('2026-09-15', donnees);

    expect(stages).toEqual([
      { groupe: 'GM101', libelle: 'Stage entreprise', debut: '2026-09-14', fin: '2026-09-20' },
    ]);
    expect(formations).toEqual([
      {
        matricule: '9863',
        nom: 'BRAHIM LOURID',
        libelle: 'Formation pédagogique',
        debut: '2026-09-14',
        fin: '2026-09-16',
      },
    ]);
  });

  /*
   * ⚠️ LES BORNES SERVENT À RÉPONDRE « JUSQU'À QUAND ? ». C'est la question que
   * pose une ligne verrouillée, et l'intitulé seul n'y répond pas. Elles sont
   * NORMALISÉES comme les autres champs : la carte au survol lit « debut » sans
   * savoir si la source parlait MySQL.
   */
  it('rend les bornes de la période, y compris en snake_case', () => {
    const { stages } = absencesDuJour('2026-09-15', {
      stages: [{ groupe_nom: 'GM101', date_debut: '2026-09-14', date_fin: '2026-09-20' }],
    });

    expect(stages[0]).toMatchObject({ debut: '2026-09-14', fin: '2026-09-20' });
  });

  /*
   * ⚠️ LES BORNES SONT INCLUSES. Un stage « du 14 au 20 » comprend le 14 et le
   * 20 : les exclure rendrait disponible un jour où le groupe est en entreprise,
   * et la séance ne serait jamais assurée.
   */
  it('inclut le premier et le dernier jour', () => {
    expect(absencesDuJour('2026-09-14', donnees).stages).toHaveLength(1);
    expect(absencesDuJour('2026-09-20', donnees).stages).toHaveLength(1);
    expect(absencesDuJour('2026-09-21', donnees).stages).toHaveLength(0);
  });

  it('ne rend QUE les périodes du jour demandé', () => {
    // Le 17, la formation est finie mais le stage court encore.
    const { stages, formations } = absencesDuJour('2026-09-17', donnees);

    expect(stages.map((s) => s.groupe)).toEqual(['GM101']);
    expect(formations).toEqual([]);
  });

  it('accepte les noms de colonnes MySQL en snake_case', () => {
    const { stages, formations } = absencesDuJour('2026-09-15', {
      stages: [{ groupe_nom: 'GM101', date_debut: '2026-09-14', date_fin: '2026-09-20' }],
      formations: [
        { matricule_formateur: '9863', nom_formateur: 'X', date_debut: '2026-09-14', date_fin: '2026-09-16' },
      ],
    });

    expect(stages[0].groupe).toBe('GM101');
    expect(formations[0].matricule).toBe('9863');
  });

  it('une date illisible ne rend RIEN plutôt que tout', () => {
    // Rendre la liste entière ferait verrouiller la grille d'un bout à l'autre.
    expect(absencesDuJour(null, donnees)).toEqual({ stages: [], formations: [] });
  });

  it('sans stage ni formation, deux listes vides', () => {
    expect(absencesDuJour('2026-09-15', {})).toEqual({ stages: [], formations: [] });
  });
});
