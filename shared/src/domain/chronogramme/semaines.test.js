import { describe, it, expect } from 'vitest';
import {
  JOURS_PAR_SEMAINE,
  NOMBRE_SEMAINES,
  plafondSemaine,
  semainesChronogramme,
  semainesDeLaLigne,
  semainesEnFormation,
} from './semaines.js';

const ANNEE = 2026;

describe('semainesChronogramme', () => {
  it('rend 45 semaines, numérotées à partir de la rentrée', () => {
    const semaines = semainesChronogramme(ANNEE);

    expect(semaines).toHaveLength(NOMBRE_SEMAINES);
    expect(semaines[0].numero).toBe(1);
    expect(semaines.at(-1).numero).toBe(NOMBRE_SEMAINES);
  });

  it('ouvre sur le LUNDI de la semaine du 1er septembre — souvent en août', () => {
    // La règle du domaine, pas « le 1er septembre » : S1 est la semaine qui
    // CONTIENT le 1er septembre. En reprendre une autre décalerait toutes les
    // colonnes d'un cran.
    expect(semainesChronogramme(2026)[0].debut).toBe('2026-08-31');
  });

  it('VERROUILLE une semaine de vacances, même partielle', () => {
    // On ne planifie pas une demi-semaine de cours au milieu des vacances.
    const semaines = semainesChronogramme(ANNEE, {
      vacances: [{ debut: '2026-09-09', fin: '2026-09-10' }],
    });

    const touchee = semaines.find((s) => s.debut <= '2026-09-09' && s.fin >= '2026-09-09');
    expect(touchee.disponible).toBe(false);
    expect(touchee.motif).toBe('vacances');
    expect(touchee.joursDisponibles).toBe(0);
  });

  it('VERROUILLE une semaine de stage, pour CE groupe seulement', () => {
    const options = {
      stages: [{ groupe: 'DEV101', debut: '2026-09-14', fin: '2026-09-19' }],
    };

    const pourDev = semainesChronogramme(ANNEE, { ...options, groupe: 'DEV101' });
    const pourAutre = semainesChronogramme(ANNEE, { ...options, groupe: 'GE101' });

    const trouver = (liste) => liste.find((s) => s.debut === '2026-09-14');
    expect(trouver(pourDev).motif).toBe('stage');
    // Le stage d'un groupe ne verrouille pas le chronogramme d'un autre.
    expect(trouver(pourAutre).disponible).toBe(true);
  });

  it('un jour FÉRIÉ ne verrouille pas : il réduit la capacité', () => {
    const semaines = semainesChronogramme(ANNEE, {
      joursFeries: [{ date: '2026-11-06', intitule: 'Marche Verte' }],
    });

    const touchee = semaines.find((s) => s.debut <= '2026-11-06' && s.fin >= '2026-11-06');
    expect(touchee.disponible).toBe(true);
    expect(touchee.joursDisponibles).toBe(JOURS_PAR_SEMAINE - 1);
    expect(touchee.motif).toBeNull();
  });

  it('REMONTE les fériés de la semaine, pas seulement leur nombre', () => {
    // L'en-tête de colonne les nomme au survol : sans le détail, on saurait
    // qu'un jour manque sans savoir lequel ni si sa date est encore estimée.
    const semaines = semainesChronogramme(ANNEE, {
      joursFeries: [
        { date: '2026-11-06', intitule: 'Marche Verte', estime: false },
        { date: '2026-11-07', intitule: 'Fête lunaire', estime: true },
      ],
    });

    const touchee = semaines.find((s) => s.debut <= '2026-11-06' && s.fin >= '2026-11-06');
    expect(touchee.feries).toHaveLength(2);
    expect(touchee.feries[0].intitule).toBe('Marche Verte');
    expect(touchee.feries[1].estime).toBe(true);
    expect(touchee.joursDisponibles).toBe(JOURS_PAR_SEMAINE - 2);
  });

  it('rend une liste de fériés VIDE sur une semaine ordinaire', () => {
    const semaines = semainesChronogramme(ANNEE);
    expect(semaines[0].feries).toEqual([]);
  });

  it('refuse une année qui n’est pas un entier', () => {
    expect(() => semainesChronogramme('2026')).toThrow(TypeError);
  });
});

describe('plafondSemaine', () => {
  const semaine = (joursDisponibles, disponible = true) => ({ disponible, joursDisponibles });

  it('plafonne à 20 h une semaine pleine', () => {
    expect(plafondSemaine(semaine(6))).toBe(20);
  });

  /*
   * ═══ ⚠️ LE PLAFOND EST LE PLUS PETIT DE DEUX BORNES ═══
   * (règle du porteur, 2026-08-26) : les 20 h d'une cellule, et ce que les
   * jours restants peuvent PHYSIQUEMENT contenir — 10 h par jour, quatre
   * créneaux de 2,5 h.
   *
   * ⚠️ CE N'EST PLUS UNE PROPORTION, et c'est un changement RÉEL sur les
   * fériés : une semaine amputée d'un jour tombait à 15 h alors que ses cinq
   * jours restants peuvent en contenir cinquante. Elle refusait des saisies
   * parfaitement tenables.
   */
  it('deux jours suffisent à atteindre le plafond de la cellule', () => {
    expect(plafondSemaine(semaine(5))).toBe(20);
    expect(plafondSemaine(semaine(3))).toBe(20);
    expect(plafondSemaine(semaine(2))).toBe(20);
  });

  it('un seul jour ouvert ne peut porter que 10 h', () => {
    // Le cas donné par le porteur : 5 jours de stage, il reste une journée.
    expect(plafondSemaine(semaine(1))).toBe(10);
  });

  it('aucun jour ouvert, aucun plafond', () => {
    expect(plafondSemaine(semaine(0))).toBe(0);
  });

  it('arrondit au pas INFÉRIEUR', () => {
    /*
     * Un plafond qui ne tombe pas sur le pas de saisie serait inatteignable :
     * la dernière valeur possible paraîtrait refusée sans raison.
     */
    expect(plafondSemaine(semaine(1)) % 2.5).toBe(0);
    expect(plafondSemaine(semaine(2)) % 2.5).toBe(0);
  });

  it('rend 0 sur une semaine verrouillée', () => {
    expect(plafondSemaine(semaine(6, false))).toBe(0);
    expect(plafondSemaine(undefined)).toBe(0);
  });
});

describe('semainesEnFormation', () => {
  const semaines = semainesChronogramme(ANNEE);
  const formateur = { matricule: '9863', nomComplet: 'BRAHIM LOURID' };

  /*
   * ⚠️ ELLE REND DES JOURS, plus une simple liste de numéros : une formation se
   * saisit en plage libre et peut ne couvrir qu'une partie de la semaine.
   */
  it('rend les semaines touchées AVEC le nombre de jours', () => {
    const touchees = semainesEnFormation(semaines, formateur, [
      { matriculeFormateur: '9863', debut: '2026-11-16', fin: '2026-11-20' },
    ]);

    const attendue = semaines.find((s) => s.debut <= '2026-11-16' && s.fin >= '2026-11-16');
    // Du lundi 16 au vendredi 20 : cinq jours ouvrés sur six.
    expect(touchees).toEqual([{ numero: attendue.numero, jours: 5 }]);
  });

  it('n’apparie PAS un autre formateur', () => {
    expect(
      semainesEnFormation(semaines, formateur, [
        { matriculeFormateur: '4211', debut: '2026-11-16', fin: '2026-11-20' },
      ])
    ).toEqual([]);
  });

  it('n’apparie JAMAIS sur un nom vide', () => {
    /*
     * ⚠️ Le défaut de `isFormateurEnFormation()` : la comparaison était
     * bidirectionnelle, et `"AMMARI".includes("")` vaut VRAI — une ligne au
     * `nom_formateur` vide rendait TOUS les formateurs indisponibles. La colonne
     * est nullable, donc rien ne l'empêche d'arriver.
     */
    expect(
      semainesEnFormation(semaines, formateur, [
        { nomFormateur: '', debut: '2026-11-16', fin: '2026-11-20' },
      ])
    ).toEqual([]);
  });

  it('rend une liste vide sans formateur ou sans formation', () => {
    expect(semainesEnFormation(semaines, null, [{ matriculeFormateur: '9863' }])).toEqual([]);
    expect(semainesEnFormation(semaines, formateur, [])).toEqual([]);
  });
});

describe('semainesDeLaLigne', () => {
  const semaines = semainesChronogramme(ANNEE, {
    vacances: [{ debut: '2026-12-21', fin: '2026-12-27' }],
  });
  const enVacances = semaines.find((s) => s.motif === 'vacances').numero;

  it('verrouille les semaines de stage de CETTE ligne', () => {
    const resultat = semainesDeLaLigne(semaines, { stage: [3] });

    expect(resultat.find((s) => s.numero === 3)).toMatchObject({
      disponible: false,
      motif: 'stage',
      joursDisponibles: 0,
    });
    // Les autres lignes ne bougent pas : le stage ne ferme qu'un groupe.
    expect(resultat.find((s) => s.numero === 4).disponible).toBe(true);
  });

  it('verrouille les semaines de FORMATION de cette ligne', () => {
    expect(semainesDeLaLigne(semaines, { formation: [5] }).find((s) => s.numero === 5)).toMatchObject(
      { disponible: false, motif: 'formation' }
    );
  });

  it('NE REMPLACE PAS un motif déjà posé', () => {
    /*
     * Dire « formation » d'une semaine de vacances enverrait corriger le dossier
     * du formateur pour une colonne que le calendrier ferme de toute façon.
     */
    const resultat = semainesDeLaLigne(semaines, { formation: [enVacances], stage: [enVacances] });
    expect(resultat.find((s) => s.numero === enVacances).motif).toBe('vacances');
  });

  it('fait passer le STAGE avant la FORMATION', () => {
    // Portées décroissantes : un groupe entier absent prime sur une personne.
    expect(semainesDeLaLigne(semaines, { stage: [7], formation: [7] }).find((s) => s.numero === 7).motif).toBe(
      'stage'
    );
  });

  /*
   * ═══ ⚠️ UNE SEMAINE PARTIELLEMENT PRISE RESTE OUVERTE ═══
   * (2026-08-26, demande du porteur.) Trois jours de stage laissent trois jours
   * ouverts : les rendre insaisissables interdisait de planifier ce qui a
   * réellement lieu.
   */
  it('un stage de 3 jours RÉDUIT la semaine au lieu de la fermer', () => {
    const resultat = semainesDeLaLigne(semaines, { stage: [{ numero: 3, jours: 3 }] });

    expect(resultat.find((s) => s.numero === 3)).toMatchObject({
      disponible: true,
      motif: null,
      joursDisponibles: 3,
      joursStage: 3,
    });
  });

  it('une formation qui prend les SIX jours ferme bien la ligne', () => {
    expect(
      semainesDeLaLigne(semaines, { formation: [{ numero: 5, jours: 6 }] }).find((s) => s.numero === 5)
    ).toMatchObject({ disponible: false, motif: 'formation', joursDisponibles: 0 });
  });

  /*
   * ⚠️ LE PLUS GRAND DES DEUX, PAS LEUR SOMME : stage et formation peuvent
   * tomber sur les mêmes jours, et les additionner fermerait une semaine qui ne
   * l'est pas. Sans les dates exactes de chaque côté, le maximum est la seule
   * borne qu'on puisse affirmer.
   */
  it('ne CUMULE pas stage et formation sur les mêmes jours', () => {
    const resultat = semainesDeLaLigne(semaines, {
      stage: [{ numero: 9, jours: 4 }],
      formation: [{ numero: 9, jours: 4 }],
    });

    expect(resultat.find((s) => s.numero === 9).joursDisponibles).toBe(2);
  });

  /*
   * ⚠️ REPLI SUR L'ANCIENNE FORME : un simple numéro vaut une semaine ENTIÈRE.
   * C'est le seul repli sûr — il ferme plutôt qu'il n'ouvre.
   */
  it('accepte encore un numéro seul, traité comme une semaine entière', () => {
    expect(semainesDeLaLigne(semaines, { stage: [11] }).find((s) => s.numero === 11)).toMatchObject({
      disponible: false,
      motif: 'stage',
    });
  });

  it('rend le MÊME tableau quand il n’y a rien à appliquer', () => {
    // Un nouveau tableau à chaque rendu ferait remonter des lignes « changées »
    // à React sur les 45 colonnes de chacune des vingt lignes.
    expect(semainesDeLaLigne(semaines, {})).toBe(semaines);
  });
});

/**
 * Le gel des semaines antérieures à la rentrée.
 * (demande du porteur, 2026-09-02 : « figé sur l'emploi ET le chronogramme ».)
 *
 * Repères de l'année 2026-2027, tels que le porteur les a saisis :
 *   S1 = lundi 31 août → samedi 5 septembre
 *   S2 = lundi 7 septembre → samedi 12 septembre
 *   1ʳᵉ année : rentrée le vendredi 11 · 2ᵉ et 3ᵉ : lundi 7
 */
const RENTREES = [
  { anneeFormation: 1, date: '2026-09-11' },
  { anneeFormation: 2, date: '2026-09-07' },
  { anneeFormation: 3, date: '2026-09-07' },
];

describe('semainesChronogramme — rentrée', () => {
  it('ne gèle RIEN tant qu’aucune rentrée n’est paramétrée', () => {
    // Sans réglage, l'application doit se comporter exactement comme avant :
    // inventer une date figerait des journées que personne n'a déclarées.
    const semaines = semainesChronogramme(ANNEE, { groupe: 'GM101' });

    expect(semaines[0].disponible).toBe(true);
    expect(semaines[0].motif).toBe(null);
    expect(semaines[0].joursRentree).toBe(0);
  });

  it('FERME une semaine entièrement antérieure à la rentrée du groupe', () => {
    const semaines = semainesChronogramme(ANNEE, { groupe: 'GM101', rentrees: RENTREES });
    const s1 = semaines.find((s) => s.numero === 1);

    expect(s1.disponible).toBe(false);
    expect(s1.motif).toBe('rentree');
    expect(s1.joursDisponibles).toBe(0);
    // La date attendue repart avec la semaine : l'écran doit pouvoir dire
    // POURQUOI la colonne est fermée, pas seulement qu'elle l'est.
    expect(s1.rentree).toBe('2026-09-11');
  });

  it('RÉDUIT — sans fermer — la semaine à cheval sur la rentrée', () => {
    // La 1ʳᵉ année reprend le VENDREDI : le vendredi et le samedi sont ouverts.
    // Fermer la colonne interdirait de planifier deux journées bien réelles.
    const s2 = semainesChronogramme(ANNEE, {
      groupe: 'GM101',
      rentrees: RENTREES,
    }).find((s) => s.numero === 2);

    expect(s2.joursRentree).toBe(4);
    expect(s2.joursDisponibles).toBe(2);
    expect(s2.disponible).toBe(true);
    expect(s2.motif).toBe(null);
  });

  it('gèle les années SÉPARÉMENT — la 2ᵉ est déjà rentrée quand la 1ʳᵉ ne l’est pas', () => {
    const options = { rentrees: RENTREES };
    const premiere = semainesChronogramme(ANNEE, { ...options, groupe: 'GM101' });
    const deuxieme = semainesChronogramme(ANNEE, { ...options, groupe: 'GMOEMCM201' });

    expect(premiere.find((s) => s.numero === 2).joursRentree).toBe(4);
    expect(deuxieme.find((s) => s.numero === 2).joursRentree).toBe(0);
  });

  /*
   * ⚠️ SANS GROUPE, ON NE GÈLE RIEN. C'est le tableau du mode formateur : il
   * mêle des 1ʳᵉ et des 2ᵉ années, et sa colonne commune ne peut donc pas être
   * fermée — le gel y descend ligne par ligne.
   */
  it('ne gèle rien quand aucun groupe n’est donné', () => {
    const semaines = semainesChronogramme(ANNEE, { rentrees: RENTREES });

    expect(semaines[0].joursRentree).toBe(0);
    expect(semaines[0].disponible).toBe(true);
  });

  it('l’emporte sur le STAGE, qui ne peut pas précéder l’existence du groupe', () => {
    // Un groupe pas encore rentré n'est pas « en stage » : l'annoncer ainsi
    // enverrait corriger ses dates de stage, une fausse piste.
    const s1 = semainesChronogramme(ANNEE, {
      groupe: 'GM101',
      rentrees: RENTREES,
      stages: [{ groupe: 'GM101', debut: '2026-08-31', fin: '2026-09-05' }],
    }).find((s) => s.numero === 1);

    expect(s1.motif).toBe('rentree');
  });

  it('cède aux VACANCES, qui ferment tout l’établissement', () => {
    const s1 = semainesChronogramme(ANNEE, {
      groupe: 'GM101',
      rentrees: RENTREES,
      vacances: [{ debut: '2026-09-01', fin: '2026-09-02' }],
    }).find((s) => s.numero === 1);

    expect(s1.motif).toBe('vacances');
  });

  /*
   * ⚠️ ON PREND LE PLUS GRAND, PAS LA SOMME : rentrée et stage disent la même
   * chose — le groupe n'est pas là — et se recouvrent. Les additionner
   * fermerait une semaine qui ne l'est pas.
   */
  it('ne cumule pas les jours de rentrée et de stage qui se recouvrent', () => {
    const s2 = semainesChronogramme(ANNEE, {
      groupe: 'GM101',
      rentrees: RENTREES,
      stages: [{ groupe: 'GM101', debut: '2026-09-07', fin: '2026-09-09' }],
    }).find((s) => s.numero === 2);

    // 4 jours avant la rentrée, 3 jours de stage inclus dans ces quatre :
    // il reste bien 2 jours, pas moins.
    expect(s2.joursDisponibles).toBe(2);
  });
});

describe('semainesDeLaLigne — rentrée', () => {
  const semaines = semainesChronogramme(ANNEE);

  it('ferme la LIGNE d’un groupe pas encore rentré, en laissant les autres', () => {
    const resultat = semainesDeLaLigne(semaines, {
      rentree: [{ numero: 1, jours: 6 }],
      rentreeLe: '2026-09-11',
    });

    expect(resultat.find((s) => s.numero === 1)).toMatchObject({
      disponible: false,
      motif: 'rentree',
      rentree: '2026-09-11',
    });
    // Les autres semaines sont intactes : c'est bien une règle de LIGNE.
    expect(resultat.find((s) => s.numero === 3).disponible).toBe(true);
  });

  it('réduit sans fermer une ligne à cheval sur la rentrée', () => {
    const resultat = semainesDeLaLigne(semaines, {
      rentree: [{ numero: 2, jours: 4 }],
      rentreeLe: '2026-09-11',
    });

    expect(resultat.find((s) => s.numero === 2)).toMatchObject({
      disponible: true,
      motif: null,
      joursDisponibles: 2,
    });
  });

  it('l’emporte sur le stage ET sur la formation', () => {
    const resultat = semainesDeLaLigne(semaines, {
      rentree: [{ numero: 1, jours: 6 }],
      stage: [{ numero: 1, jours: 6 }],
      formation: [{ numero: 1, jours: 6 }],
    });

    expect(resultat.find((s) => s.numero === 1).motif).toBe('rentree');
  });
});
