import { describe, it, expect } from 'vitest';
import {
  calculerBilan,
  calculerCharges,
  construireEnsembles,
  cleEnsemble,
  estActif,
  etatAffectation,
  heuresPresentiel,
  heuresSynchrone,
  semestreModule,
} from './bilanCharge.js';

function groupe(nom, modules, surcharges = {}) {
  return {
    nom,
    codeFiliere: 'DEVOWFS_S',
    intituleFiliere: 'Développement',
    anneeFormation: 1,
    modules,
    ...surcharges,
  };
}

function module(code, surcharges = {}) {
  return {
    code,
    nom: code,
    mhpS1: 30,
    mhpS2: 30,
    mhsynS1: 0,
    mhsynS2: 0,
    metier: 'Développement',
    formateurPresentiel: '',
    formateurSynchrone: '',
    ...surcharges,
  };
}

describe('semestreModule', () => {
  const heures = (surcharges) =>
    module('M101', { mhpS1: 0, mhpS2: 0, mhsynS1: 0, mhsynS2: 0, ...surcharges });

  it('nomme le semestre unique', () => {
    expect(semestreModule(heures({ mhpS1: 140 }))).toBe('S1');
    expect(semestreModule(heures({ mhpS2: 140 }))).toBe('S2');
  });

  it('dit « annuel » quand les DEUX semestres portent des heures', () => {
    expect(semestreModule(heures({ mhpS1: 68, mhpS2: 72 }))).toBe('annuel');
  });

  it('compte aussi le SYNCHRONE', () => {
    /*
     * Un module sans présentiel mais donné à distance au second semestre est un
     * module du S2. Ne regarder que `mhp*` le laisserait sans badge, comme s'il
     * n'était pas dispensé du tout.
     */
    expect(semestreModule(heures({ mhsynS2: 20 }))).toBe('S2');
    expect(semestreModule(heures({ mhpS1: 30, mhsynS2: 5 }))).toBe('annuel');
  });

  it('ne dit RIEN sur un module sans heures', () => {
    // Un badge « annuel » sur un module à 0 h serait un mensonge : il n'est
    // dispensé nulle part.
    expect(semestreModule(heures({}))).toBeNull();
    expect(semestreModule(undefined)).toBeNull();
  });
});

describe('construireEnsembles', () => {
  it('regroupe par filière et année', () => {
    const ensembles = construireEnsembles([
      groupe('DEV101', [module('M101')]),
      groupe('DEV102', [module('M101')]),
      groupe('DEV201', [module('M201')], { anneeFormation: 2 }),
    ]);

    expect(ensembles).toHaveLength(2);
    expect(ensembles[0].groupes.map((g) => g.nom)).toEqual(['DEV101', 'DEV102']);
    expect(ensembles[1].groupes.map((g) => g.nom)).toEqual(['DEV201']);
  });

  it("prend l'union des modules — un module retiré d'un groupe reste visible", () => {
    const ensembles = construireEnsembles([
      groupe('DEV101', [module('M101'), module('M102')]),
      groupe('DEV102', [module('M101')]),
    ]);

    expect(ensembles[0].modules.map((m) => m.code)).toEqual(['M101', 'M102']);
  });

  it('trie par intitulé puis par année', () => {
    const ensembles = construireEnsembles([
      groupe('B201', [module('M2')], { intituleFiliere: 'Zéro', anneeFormation: 2 }),
      groupe('A101', [module('M1')], { intituleFiliere: 'Alpha', codeFiliere: 'A_A_TS' }),
    ]);

    expect(ensembles.map((e) => e.intituleFiliere)).toEqual(['Alpha', 'Zéro']);
  });

  it('distingue deux filières homonymes par leur code', () => {
    expect(cleEnsemble({ codeFiliere: 'GE_GE_TS', anneeFormation: 1 })).not.toBe(
      cleEnsemble({ codeFiliere: 'FGT_GE_TS', anneeFormation: 1 })
    );
  });

  it('sépare les modes de formation', () => {
    // Un groupe alterné n'a pas les mêmes masses horaires qu'un résidentiel de
    // la même filière : les mettre dans la même matrice mêle deux réalités.
    const ensembles = construireEnsembles([
      groupe('MMC101', [module('M101')], { mode: 'Résidentiel' }),
      groupe('MMC102', [module('M101')], { mode: 'Alterné' }),
      groupe('MMC103', [module('M101')], { mode: 'Alterné' }),
    ]);

    expect(ensembles).toHaveLength(2);
    expect(ensembles.map((e) => e.mode)).toEqual(['Alterné', 'Résidentiel']);
    expect(ensembles[0].groupes.map((g) => g.nom)).toEqual(['MMC102', 'MMC103']);
  });

  it('accepte une carte vide', () => {
    expect(construireEnsembles()).toEqual([]);
  });
});

describe('heures d\'un module', () => {
  it('additionne les deux semestres', () => {
    expect(heuresPresentiel({ mhpS1: 25, mhpS2: 20 })).toBe(45);
    expect(heuresSynchrone({ mhsynS1: 10, mhsynS2: 10 })).toBe(20);
  });

  it('rend 0 pour un module sans masse horaire', () => {
    expect(heuresPresentiel({})).toBe(0);
    expect(heuresSynchrone(null)).toBe(0);
  });

  it('conserve les demi-heures', () => {
    expect(heuresPresentiel({ mhpS1: 12.5, mhpS2: 12.5 })).toBe(25);
  });
});

describe('calculerBilan — demande', () => {
  it('additionne présentiel et synchrone de chaque groupe', () => {
    const bilan = calculerBilan({
      groupes: [
        groupe('DEV101', [module('M101', { mhsynS1: 10, mhsynS2: 10 })]),
        groupe('DEV102', [module('M101', { mhsynS1: 10, mhsynS2: 10 })]),
      ],
      formateurs: [],
    });

    // 2 groupes × (60 h présentiel + 20 h synchrone)
    expect(bilan.demande.total).toBe(160);
    expect(bilan.demande.couvert).toBe(0);
    expect(bilan.demande.taux).toBe(0);
    expect(bilan.besoin).toBe(160);
  });

  it('compte comme couvert ce qui porte un formateur', () => {
    const bilan = calculerBilan({
      groupes: [groupe('DEV101', [module('M101', { formateurPresentiel: 'AHMED' })])],
      formateurs: [{ nom: 'AHMED', masseHoraire: 720 }],
    });

    expect(bilan.demande.couvert).toBe(60);
    expect(bilan.demande.taux).toBe(100);
    expect(bilan.besoin).toBe(0);
  });
});

describe('calculerBilan — le synchrone est mutualisé', () => {
  /*
   * `groupeFusion` porte les groupes que la SÉANCE couvre — c'est ce qu'écrit
   * `definirLignesSynchrone`, et ce qui décide de la mutualisation. Le formateur
   * ne suffit pas : rien ne l'empêche d'assurer deux séances du même module.
   */
  const modulesSynchrones = (formateur, fusion = '') => [
    module('M101', {
      mhpS1: 0,
      mhpS2: 0,
      mhsynS1: 10,
      mhsynS2: 10,
      formateurSynchrone: formateur,
      groupeFusion: fusion,
    }),
  ];

  it('couvre chaque groupe mais ne pèse qu\'une fois sur le formateur', () => {
    const fusion = 'DEV101 DEV102 DEV103';

    const bilan = calculerBilan({
      groupes: [
        groupe('DEV101', modulesSynchrones('AHMED', fusion)),
        groupe('DEV102', modulesSynchrones('AHMED', fusion)),
        groupe('DEV103', modulesSynchrones('AHMED', fusion)),
      ],
      formateurs: [{ nom: 'AHMED', masseHoraire: 720 }],
    });

    // Demande : les 3 groupes doivent suivre 20 h chacun.
    expect(bilan.demande.total).toBe(60);
    expect(bilan.demande.couvert).toBe(60);

    // Offre : la séance est donnée UNE fois. La compter trois fois ferait
    // croire à une charge de 60 h et à une surcharge inexistante.
    expect(bilan.offre.affecte).toBe(20);
    expect(bilan.formateurs[0].affecte).toBe(20);
  });

  it('compte deux fois quand deux formateurs différents assurent le module', () => {
    const bilan = calculerBilan({
      groupes: [
        groupe('DEV101', modulesSynchrones('AHMED', 'DEV101')),
        groupe('DEV102', modulesSynchrones('FATIMA', 'DEV102')),
      ],
      formateurs: [
        { nom: 'AHMED', masseHoraire: 720 },
        { nom: 'FATIMA', masseHoraire: 720 },
      ],
    });

    expect(bilan.offre.affecte).toBe(40);
  });

  it('compte deux fois le MÊME formateur sur deux séances non fusionnées', () => {
    /*
     * Le cas signalé sur données réelles : BRAHIM LOURID, Arabe synchrone,
     * GM101 sur une séance et GM102 sur une autre. Les groupes ne sont PAS
     * fusionnés — ce sont deux séances, il les donne toutes les deux.
     *
     * La règle précédente dédoublonnait sur (ensemble, module, formateur) : elle
     * n'en comptait qu'une, la moitié de sa charge disparaissait du bilan, et il
     * apparaissait disponible alors qu'il ne l'était pas.
     */
    const bilan = calculerBilan({
      groupes: [
        groupe('DEV101', modulesSynchrones('AHMED', 'DEV101')),
        groupe('DEV102', modulesSynchrones('AHMED', 'DEV102')),
      ],
      formateurs: [{ nom: 'AHMED', masseHoraire: 720 }],
    });

    expect(bilan.offre.affecte).toBe(40);
    expect(bilan.formateurs[0].affecte).toBe(40);
  });

  it('traite une fusion VIDE comme une séance propre au groupe', () => {
    // La reconstruction depuis la base laisse `groupeFusion` vide quand
    // l'affectation ne porte qu'un groupe : « fusionné avec personne », et non
    // « fusion inconnue ». Le nom du groupe fait alors l'identité de la séance.
    const bilan = calculerBilan({
      groupes: [
        groupe('DEV101', modulesSynchrones('AHMED')),
        groupe('DEV102', modulesSynchrones('AHMED')),
      ],
      formateurs: [{ nom: 'AHMED', masseHoraire: 720 }],
    });

    expect(bilan.offre.affecte).toBe(40);
  });

  it('ne mutualise pas entre deux ensembles distincts', () => {
    const bilan = calculerBilan({
      groupes: [
        groupe('DEV101', modulesSynchrones('AHMED')),
        groupe('DEV201', modulesSynchrones('AHMED'), { anneeFormation: 2 }),
      ],
      formateurs: [{ nom: 'AHMED', masseHoraire: 720 }],
    });

    // Deux années différentes : deux séances réelles.
    expect(bilan.offre.affecte).toBe(40);
  });
});

describe('calculerBilan — offre', () => {
  it('somme les masses statutaires déclarées', () => {
    const bilan = calculerBilan({
      groupes: [groupe('DEV101', [module('M101', { formateurPresentiel: 'AHMED' })])],
      formateurs: [
        { nom: 'AHMED', masseHoraire: 720 },
        { nom: 'FATIMA', masseHoraire: 600 },
      ],
    });

    expect(bilan.offre.statutaire).toBe(1320);
    expect(bilan.offre.affecte).toBe(60);
    expect(bilan.offre.taux).toBe(5);
  });

  it('signale un formateur en dépassement de sa masse statutaire', () => {
    const bilan = calculerBilan({
      groupes: [
        groupe('DEV101', [module('M101', { mhpS1: 100, mhpS2: 100, formateurPresentiel: 'AHMED' })]),
      ],
      formateurs: [{ nom: 'AHMED', masseHoraire: 120 }],
    });

    expect(bilan.surcharges).toEqual([
      expect.objectContaining({ nom: 'AHMED', affecte: 200, disponible: -80 }),
    ]);
  });

  it('ne signale pas de dépassement quand aucune masse n\'est déclarée', () => {
    const bilan = calculerBilan({
      groupes: [groupe('DEV101', [module('M101', { formateurPresentiel: 'AHMED' })])],
      formateurs: [{ nom: 'AHMED' }],
    });

    // Masse inconnue : on ne peut rien affirmer, donc on n'alerte pas.
    expect(bilan.surcharges).toEqual([]);
    expect(bilan.offre.taux).toBe(0);
  });

  it('apparie le formateur sans tenir compte de la casse', () => {
    const bilan = calculerBilan({
      groupes: [groupe('DEV101', [module('M101', { formateurPresentiel: 'ahmed' })])],
      formateurs: [{ nom: 'AHMED', masseHoraire: 720 }],
    });

    expect(bilan.formateurs[0].affecte).toBe(60);
  });
});

describe('calculerBilan — détail par métier', () => {
  it('agrège demande, couverture et capacité par métier', () => {
    const bilan = calculerBilan({
      groupes: [
        groupe('DEV101', [
          module('M101', { metier: 'Développement', formateurPresentiel: 'AHMED' }),
          module('M102', { metier: 'Français', mhpS1: 20, mhpS2: 20 }),
        ]),
      ],
      formateurs: [{ nom: 'AHMED', masseHoraire: 720 }],
    });

    const [premier, second] = bilan.metiers;
    // Trié par demande décroissante.
    expect(premier).toMatchObject({
      metier: 'Développement',
      demande: 60,
      couvert: 60,
      capacite: 720,
      modulesNonCouverts: 0,
    });
    expect(second).toMatchObject({
      metier: 'Français',
      demande: 40,
      couvert: 0,
      modulesNonCouverts: 1,
      formateurs: 0,
    });
  });

  it('range sous « Non renseigné » les modules sans métier', () => {
    const bilan = calculerBilan({
      groupes: [groupe('DEV101', [module('M101', { metier: '' })])],
      formateurs: [],
    });

    expect(bilan.metiers[0].metier).toBe('Non renseigné');
  });
});

describe('calculerBilan — cas limites', () => {
  it('accepte une carte vide', () => {
    const bilan = calculerBilan();

    expect(bilan.offre).toEqual({ statutaire: 0, affecte: 0, taux: 0 });
    expect(bilan.demande).toEqual({ total: 0, couvert: 0, taux: 0 });
    expect(bilan.metiers).toEqual([]);
  });

  it('compte la charge d\'un formateur absent de la liste déclarée', () => {
    const bilan = calculerBilan({
      groupes: [groupe('DEV101', [module('M101', { formateurPresentiel: 'INCONNU' })])],
      formateurs: [],
    });

    // Les heures sont bien affectées, même si aucune capacité n'est déclarée :
    // les masquer ferait croire la carte plus légère qu'elle ne l'est.
    expect(bilan.offre.affecte).toBe(60);
    expect(bilan.offre.statutaire).toBe(0);
  });
});

describe('calculerCharges', () => {
  it('ventile la charge par semestre', () => {
    const charges = calculerCharges([
      groupe('DEV101', [
        module('M101', { mhpS1: 25, mhpS2: 20, formateurPresentiel: 'AHMED' }),
        module('M102', { mhpS1: 15, mhpS2: 15, formateurPresentiel: 'AHMED' }),
      ]),
    ]);

    expect(charges.get('AHMED')).toEqual({ s1: 40, s2: 35, total: 75, regional: 0 });
  });

  it('compte les EFM régionaux portés par le formateur', () => {
    const charges = calculerCharges([
      groupe('DEV101', [
        module('M101', { formateurPresentiel: 'AHMED', estRegional: true }),
        module('M102', { formateurPresentiel: 'AHMED' }),
      ]),
    ]);

    expect(charges.get('AHMED').regional).toBe(1);
  });

  it('ne compte la séance synchrone qu\'une fois quand les groupes sont fusionnés', () => {
    const synchrone = () => [
      module('M101', {
        mhpS1: 0,
        mhpS2: 0,
        mhsynS1: 10,
        mhsynS2: 10,
        formateurSynchrone: 'AHMED',
        groupeFusion: 'DEV101 DEV102',
      }),
    ];

    const charges = calculerCharges([
      groupe('DEV101', synchrone()),
      groupe('DEV102', synchrone()),
    ]);

    expect(charges.get('AHMED')).toMatchObject({ s1: 10, s2: 10, total: 20 });
  });

  it('compte deux fois deux séances non fusionnées du même formateur', () => {
    // C'est la charge que le sélecteur de formateur affiche : la sous-estimer
    // fait affecter quelqu'un qui est déjà pris.
    const synchrone = (fusion) => [
      module('M101', {
        mhpS1: 0,
        mhpS2: 0,
        mhsynS1: 10,
        mhsynS2: 10,
        formateurSynchrone: 'AHMED',
        groupeFusion: fusion,
      }),
    ];

    const charges = calculerCharges([
      groupe('DEV101', synchrone('DEV101')),
      groupe('DEV102', synchrone('DEV102')),
    ]);

    expect(charges.get('AHMED')).toMatchObject({ s1: 20, s2: 20, total: 40 });
  });

  it('ignore un module désactivé', () => {
    const charges = calculerCharges([
      groupe('DEV101', [
        module('M101', { formateurPresentiel: 'AHMED' }),
        module('M102', { formateurPresentiel: 'AHMED', actif: false }),
      ]),
    ]);

    expect(charges.get('AHMED').total).toBe(60);
  });

  it('apparie le formateur sans tenir compte de la casse', () => {
    const charges = calculerCharges([
      groupe('DEV101', [module('M101', { formateurPresentiel: ' ahmed ' })]),
    ]);

    expect(charges.get('AHMED').total).toBe(60);
  });

  it('rend une table vide pour une carte sans affectation', () => {
    expect(calculerCharges([groupe('DEV101', [module('M101')])]).size).toBe(0);
    expect(calculerCharges().size).toBe(0);
  });
});

describe('estActif', () => {
  it('considère actif un module sans le champ — les modules DRIF n\'en ont pas', () => {
    expect(estActif({ code: 'M101' })).toBe(true);
    expect(estActif({ code: 'M101', actif: true })).toBe(true);
    expect(estActif({ code: 'M101', actif: false })).toBe(false);
  });
});

describe('calculerBilan — modules désactivés', () => {
  it('les retire de la demande comme de la charge', () => {
    const bilan = calculerBilan({
      groupes: [
        groupe('DEV101', [
          module('M101', { formateurPresentiel: 'AHMED' }),
          module('M102', { formateurPresentiel: 'AHMED', actif: false }),
        ]),
      ],
      formateurs: [{ nom: 'AHMED', masseHoraire: 720 }],
    });

    expect(bilan.demande.total).toBe(60);
    expect(bilan.offre.affecte).toBe(60);
  });
});

describe('etatAffectation', () => {
  it('distingue les trois états', () => {
    expect(etatAffectation(0, 15)).toBe('vide');
    expect(etatAffectation(6, 15)).toBe('partiel');
    expect(etatAffectation(15, 15)).toBe('complet');
  });

  it('traite un groupe sans module comme vide, pas comme complet', () => {
    // 0/0 n'est pas un travail achevé : c'est un groupe sans rien à affecter.
    expect(etatAffectation(0, 0)).toBe('vide');
  });

  it('reste complet au-delà du total', () => {
    expect(etatAffectation(16, 15)).toBe('complet');
  });
});

describe('calculerBilan — sous-affectés et réconciliation', () => {
  // ← computeOffreDemande() : sousAffectes / surcharges / ecartNet
  const carte = {
    groupes: [
      groupe('DEV101', [
        module('M101', { mhpS1: 100, mhpS2: 100, formateurPresentiel: 'SATURE' }),
        module('M102', { mhpS1: 10, mhpS2: 10, formateurPresentiel: 'DISPO' }),
        module('M103', { mhpS1: 5, mhpS2: 5, formateurPresentiel: 'SANS MASSE' }),
        module('M104', { mhpS1: 30, mhpS2: 30 }),
      ]),
    ],
    formateurs: [
      { nom: 'SATURE', masseHoraire: 120 },
      { nom: 'DISPO', masseHoraire: 500 },
      { nom: 'SANS MASSE' },
    ],
  };

  it('sépare les sous-affectés des formateurs en dépassement', () => {
    const bilan = calculerBilan(carte);

    expect(bilan.sousAffectes.map((f) => f.nom)).toEqual(['DISPO']);
    expect(bilan.surcharges.map((f) => f.nom)).toEqual(['SATURE']);
    expect(bilan.surcharges[0].depassement).toBe(80);
  });

  it('ventile la charge par semestre', () => {
    const dispo = calculerBilan(carte).formateurs.find((f) => f.nom === 'DISPO');

    expect(dispo.s1).toBe(10);
    expect(dispo.s2).toBe(10);
    expect(dispo.affecte).toBe(20);
  });

  it("explique l'écart entre les heures disponibles et la tuile « Offre »", () => {
    const { reconciliation, offre } = calculerBilan(carte);

    // 480 h restent chez DISPO, mais elles ne se retrouvent pas telles quelles
    // dans l'écart de la tuile : trois volumes s'y soustraient.
    expect(reconciliation.disponible).toBe(480);
    expect(reconciliation.surcharge).toBe(80);
    expect(reconciliation.sansCapacite).toBe(1);
    expect(reconciliation.heuresSansCapacite).toBe(10);

    // 620 h statutaires − 230 h affectées.
    expect(offre.statutaire).toBe(620);
    expect(offre.affecte).toBe(230);
    expect(reconciliation.ecartNet).toBe(390);

    // Et l'égalité que la ligne affiche à l'écran :
    expect(
      reconciliation.disponible - reconciliation.surcharge - reconciliation.heuresSansCapacite
    ).toBe(reconciliation.ecartNet);
  });

  it('signale les heures affectées à un nom absent de la liste', () => {
    const bilan = calculerBilan({
      groupes: [groupe('DEV101', [module('M101', { formateurPresentiel: 'INCONNU' })])],
      formateurs: [{ nom: 'AHMED', masseHoraire: 720 }],
    });

    // 60 h pèsent sur l'offre sans être rattachables à un formateur connu.
    expect(bilan.reconciliation.horsListe).toBe(60);
  });

  it('donne la part de la demande encore non couverte', () => {
    const bilan = calculerBilan({
      groupes: [
        groupe('DEV101', [
          module('M101', { formateurPresentiel: 'AHMED' }),
          module('M102'),
          module('M103'),
          module('M104'),
        ]),
      ],
      formateurs: [{ nom: 'AHMED', masseHoraire: 720 }],
    });

    expect(bilan.besoin).toBe(180);
    expect(bilan.besoinTaux).toBe(75);
  });
});

describe('calculerBilan — détail des modules non couverts', () => {
  // ← `lignesNonCouvertes` : la feuille « Besoin détaillé » de l'export.
  const bilan = calculerBilan({
    groupes: [
      groupe('DEV101', [
        module('M101', { formateurPresentiel: 'AHMED' }),
        module('M102', { mhsynS1: 10, mhsynS2: 0, formateurPresentiel: 'AHMED' }),
        module('M103'),
      ]),
    ],
    formateurs: [{ nom: 'AHMED', masseHoraire: 720 }],
  });

  it("ne liste que les modules auxquels il manque quelque chose", () => {
    expect(bilan.lignes.map((l) => l.code)).toEqual(['M102', 'M103']);
  });

  it('dit CE QUI manque, présentiel ou synchrone', () => {
    // M102 a son formateur présentiel : seul le synchrone manque.
    const m102 = bilan.lignes.find((l) => l.code === 'M102');
    expect(m102).toMatchObject({
      manquePresentiel: false,
      manqueSynchrone: true,
      demande: 70,
      couvert: 60,
      besoin: 10,
    });

    // M103 n'a personne, et n'a pas d'heures synchrones à couvrir.
    expect(bilan.lignes.find((l) => l.code === 'M103')).toMatchObject({
      manquePresentiel: true,
      manqueSynchrone: false,
      besoin: 60,
    });
  });

  it('porte le contexte nécessaire pour agir : filière, groupe, mode', () => {
    expect(bilan.lignes[0]).toMatchObject({
      codeFiliere: 'DEVOWFS_S',
      intituleFiliere: 'Développement',
      anneeFormation: 1,
      groupe: 'DEV101',
      metier: 'Développement',
    });
  });

  it('somme le besoin des lignes au besoin total', () => {
    const somme = bilan.lignes.reduce((total, ligne) => total + ligne.besoin, 0);
    expect(somme).toBe(bilan.besoin);
  });

  it('ignore les modules désactivés', () => {
    const sansModule = calculerBilan({
      groupes: [groupe('DEV101', [module('M101', { actif: false })])],
      formateurs: [],
    });
    expect(sansModule.lignes).toEqual([]);
  });
});
