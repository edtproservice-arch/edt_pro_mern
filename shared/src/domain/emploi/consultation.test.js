import { describe, it, expect } from 'vitest';
import {
  AXES_CONSULTATION,
  agendaDuSujet,
  assemblerConsultation,
  contenuLigne,
  facettesDesGroupes,
  filtrerGroupes,
  filtrerSujets,
  instantLocal,
  sallesDeLaSemaine,
  seanceTerminee,
} from './consultation.js';

/**
 * Lecture d'une semaine sous trois angles (F5 — page « Édition »).
 * ← displayGlobalSchedule() / findGroupData() / findSalleData() de edition.html
 */
const seance = (surcharges = {}) => ({
  formateurMatricule: '9863',
  groupe: 'GM101',
  module: 'M101',
  salle: 'A12',
  jour: 'Lundi',
  seance: 'S1',
  periode: 'jour',
  ...surcharges,
});

const caseDe = (lignes, sujet, jour, creneau) =>
  lignes.find((l) => l.sujet === sujet)?.cases.find((c) => c.jour === jour && c.seance === creneau);

describe('AXES_CONSULTATION', () => {
  /*
   * ⚠️ CHAQUE AXE MONTRE CE QU'IL NE PORTE PAS. Sur la ligne d'un formateur on
   * lit le groupe ; sur celle d'un groupe, le formateur ; sur celle d'une salle,
   * les deux. Répéter le sujet dans ses propres cases ne dirait rien.
   */
  it('les trois axes, avec ce que chaque ligne montre', () => {
    expect(AXES_CONSULTATION.formateur.lignes).toEqual(['Groupe', 'Module', 'Salle']);
    expect(AXES_CONSULTATION.groupe.lignes).toEqual(['Formateur', 'Module', 'Salle']);
    expect(AXES_CONSULTATION.salle.lignes).toEqual(['Formateur', 'Module', 'Groupe']);
  });
});

describe('assemblerConsultation', () => {
  it('range la séance sur la ligne de son formateur', () => {
    const lignes = assemblerConsultation({ sujets: ['9863'], seances: [seance()], axe: 'formateur' });

    expect(caseDe(lignes, '9863', 'Lundi', 'S1').seances).toHaveLength(1);
    expect(caseDe(lignes, '9863', 'Lundi', 'S2').seances).toEqual([]);
  });

  /*
   * ⚠️⚠️ C'EST LA DIFFÉRENCE AVEC LA GRILLE D'ÉDITION. `assemblerGrille` indexe
   * sur le groupe EXACT : une séance « GM101 GM102 » n'apparaîtrait sur AUCUNE
   * des deux lignes. En lecture, les deux groupes ont bien cours.
   */
  it('⚠️ une FUSION apparaît sur la ligne de CHACUN de ses groupes', () => {
    const lignes = assemblerConsultation({
      sujets: ['GM101', 'GM102'],
      seances: [seance({ groupe: 'GM101 GM102', salle: 'TEAMS' })],
      axe: 'groupe',
    });

    expect(caseDe(lignes, 'GM101', 'Lundi', 'S1').seances).toHaveLength(1);
    expect(caseDe(lignes, 'GM102', 'Lundi', 'S1').seances).toHaveLength(1);
  });

  it('⚠️ le SUFFIXE ne fait pas rater le groupe', () => {
    const lignes = assemblerConsultation({
      sujets: ['GE102'],
      seances: [seance({ groupe: 'GE102 (GC)' })],
      axe: 'groupe',
    });

    expect(caseDe(lignes, 'GE102', 'Lundi', 'S1').seances).toHaveLength(1);
  });

  it('⚠️⚠️ une filière homonyme ne descend PAS sur la ligne de l’autre', () => {
    // GE101 (GE) — Génie électrique — n'est pas GE101 (GC) (2026-09-11).
    const lignes = assemblerConsultation({
      sujets: ['GE101 (GC)', 'GE101 (GE)'],
      seances: [seance({ groupe: 'GE101 (GE) GE102 (GE)', salle: 'TEAMS' })],
      axe: 'groupe',
    });

    expect(caseDe(lignes, 'GE101 (GE)', 'Lundi', 'S1').seances).toHaveLength(1);
    expect(caseDe(lignes, 'GE101 (GC)', 'Lundi', 'S1').seances).toHaveLength(0);
  });

  /*
   * ⚠️ UN COURS DU FQ N'EST PAS UN COURS DE SES CONSTITUANTS. L'afficher sur
   * leur ligne compterait ses heures deux fois, et ferait lire un module que le
   * groupe ne suit pas sous ce nom-là. La composition FQ sert aux CONFLITS, pas
   * à la lecture.
   */
  it('⚠️ un cours du groupe FQ ne descend PAS sur la ligne de ses constituants', () => {
    const lignes = assemblerConsultation({
      sujets: ['GM101'],
      seances: [seance({ groupe: 'ACADA101 (FQ)' })],
      axe: 'groupe',
    });

    expect(caseDe(lignes, 'GM101', 'Lundi', 'S1').seances).toEqual([]);
  });

  /*
   * ⚠️ PLUSIEURS SÉANCES PAR CASE — c'est le cas d'un EFM, où chaque surveillant
   * porte sa propre séance dans la même salle. N'en garder qu'une ferait croire
   * la salle libre pour les autres.
   */
  it('⚠️ une salle peut porter PLUSIEURS séances sur le même créneau', () => {
    const lignes = assemblerConsultation({
      sujets: ['A12'],
      seances: [
        seance({ formateurMatricule: '9863', estEfm: true }),
        seance({ formateurMatricule: '4211', estEfm: true }),
      ],
      axe: 'salle',
    });

    expect(caseDe(lignes, 'A12', 'Lundi', 'S1').seances).toHaveLength(2);
  });

  it('la période sépare le jour et le soir', () => {
    const seances = [seance(), seance({ seance: 'S5', periode: 'soir' })];

    const jour = assemblerConsultation({ sujets: ['9863'], seances, axe: 'formateur' });
    const soir = assemblerConsultation({ sujets: ['9863'], seances, axe: 'formateur', periode: 'soir' });

    expect(jour[0].cases).toHaveLength(24);
    expect(soir[0].cases).toHaveLength(6);
    expect(caseDe(soir, '9863', 'Lundi', 'S5').seances).toHaveLength(1);
  });

  it('compte les heures du sujet — 2,5 h en journée, 2 h le soir', () => {
    const lignes = assemblerConsultation({
      sujets: ['9863'],
      seances: [seance(), seance({ jour: 'Mardi' })],
      axe: 'formateur',
    });

    expect(lignes[0].heures).toBe(5);
  });

  /*
   * ⚠️ UNE SÉANCE ABSENTE NE COMPTE PAS dans les heures — le formateur ne les a
   * pas assurées. Elle reste AFFICHÉE : c'est bien ce qui était prévu ce jour-là.
   */
  it('⚠️ une séance absente s’affiche mais ne compte pas dans les heures', () => {
    const lignes = assemblerConsultation({
      sujets: ['9863'],
      seances: [seance({ statut: 'absent' })],
      axe: 'formateur',
    });

    expect(lignes[0].heures).toBe(0);
    expect(caseDe(lignes, '9863', 'Lundi', 'S1').seances).toHaveLength(1);
  });

  it('un sujet sans aucune séance garde sa ligne, vide', () => {
    const lignes = assemblerConsultation({ sujets: ['4211'], seances: [seance()], axe: 'formateur' });

    expect(lignes[0].heures).toBe(0);
    expect(lignes[0].cases.every((c) => c.seances.length === 0)).toBe(true);
  });
});

describe('contenuLigne', () => {
  const nomsFormateurs = new Map([
    ['9863', 'BRAHIM LOURID'],
    ['4211', 'AHMED CHERKAOUI'],
  ]);

  it('rend le NOM du formateur, pas son matricule', () => {
    expect(contenuLigne([seance()], 'Formateur', nomsFormateurs)).toBe('BRAHIM LOURID');
  });

  it('⚠️ joint plusieurs séances par « / »', () => {
    const seances = [seance(), seance({ formateurMatricule: '4211' })];
    expect(contenuLigne(seances, 'Formateur', nomsFormateurs)).toBe(
      'BRAHIM LOURID / AHMED CHERKAOUI'
    );
  });

  it('⚠️ et écarte les doublons — un même groupe répété n’apprend rien', () => {
    const seances = [seance(), seance({ formateurMatricule: '4211' })];
    expect(contenuLigne(seances, 'Groupe', nomsFormateurs)).toBe('GM101');
  });

  it('rend le matricule si le nom est inconnu — jamais rien', () => {
    expect(contenuLigne([seance({ formateurMatricule: '7777' })], 'Formateur', nomsFormateurs)).toBe(
      '7777'
    );
  });

  it('une case vide rend une chaîne vide', () => {
    expect(contenuLigne([], 'Module', nomsFormateurs)).toBe('');
  });
});

describe('sallesDeLaSemaine', () => {
  it('réunit les espaces déclarés et ceux réellement occupés', () => {
    expect(sallesDeLaSemaine(['B02'], [seance({ salle: 'A12' })])).toEqual(['A12', 'B02']);
  });

  /*
   * ⚠️ « TEAMS » N'EST PAS UNE SALLE — c'est une séance à distance ; « ABSENT »
   * ne l'a jamais été. Les lister ferait une ligne d'occupation pour un local
   * qui n'existe pas.
   */
  it('⚠️ écarte TEAMS et ABSENT', () => {
    const salles = sallesDeLaSemaine(
      ['A12', 'TEAMS'],
      [seance({ salle: 'ABSENT' }), seance({ salle: 'teams' })]
    );

    expect(salles).toEqual(['A12']);
  });

  it('⚠️ garde une salle retirée des espaces mais qui porte encore des séances', () => {
    // L'omettre ferait disparaître ces heures de toute lecture.
    expect(sallesDeLaSemaine([], [seance({ salle: 'A12' })])).toEqual(['A12']);
  });

  it('trie dans l’ordre naturel — « Salle 2 » avant « Salle 10 »', () => {
    expect(sallesDeLaSemaine(['Salle 10', 'Salle 2'], [])).toEqual(['Salle 2', 'Salle 10']);
  });
});

describe('filtrerSujets', () => {
  const seances = [
    seance({ formateurMatricule: '9863', jour: 'Lundi', seance: 'S1' }),
    seance({ formateurMatricule: '4211', jour: 'Mardi', seance: 'S3' }),
    seance({ formateurMatricule: '7001', jour: 'Jeudi', seance: 'S1' }),
  ];
  const tous = ['9863', '4211', '7001'];

  it('sans filtre, tout le monde reste', () => {
    expect(filtrerSujets(tous, seances, 'formateur')).toEqual(tous);
    expect(filtrerSujets(tous, seances, 'formateur', { jours: [], creneaux: [] })).toEqual(tous);
  });

  it('ne garde que ceux qui ont cours le jour demandé', () => {
    expect(filtrerSujets(tous, seances, 'formateur', { jours: ['Lundi'] })).toEqual(['9863']);
  });

  /*
   * ⚠️ DEUX JOURS COCHÉS = « l'un OU l'autre ». C'est ce qu'on attend d'une
   * liste à cocher ; exiger les DEUX ne laisserait presque personne.
   */
  it('⚠️ deux jours cochés valent « l’un OU l’autre »', () => {
    expect(filtrerSujets(tous, seances, 'formateur', { jours: ['Mardi', 'Jeudi'] })).toEqual([
      '4211',
      '7001',
    ]);
  });

  it('filtre aussi par créneau seul', () => {
    expect(filtrerSujets(tous, seances, 'formateur', { creneaux: ['S1'] })).toEqual(['9863', '7001']);
  });

  /*
   * ⚠️ JOUR ET CRÉNEAU SE COMBINENT SUR LA MÊME SÉANCE. Les traiter séparément
   * rendrait « lundi » + « S3 » à quelqu'un qui travaille lundi en S1 et mardi
   * en S3 — alors qu'il n'a rien le lundi en S3.
   */
  it('⚠️ jour ET créneau doivent tomber sur la MÊME séance', () => {
    expect(filtrerSujets(tous, seances, 'formateur', { jours: ['Lundi'], creneaux: ['S3'] })).toEqual(
      []
    );
    expect(filtrerSujets(tous, seances, 'formateur', { jours: ['Lundi'], creneaux: ['S1'] })).toEqual(
      ['9863']
    );
  });

  it('vaut pour les trois axes — ici la salle', () => {
    const parSalle = [
      seance({ salle: 'A12', jour: 'Lundi' }),
      seance({ salle: 'B02', jour: 'Mardi' }),
    ];

    expect(filtrerSujets(['A12', 'B02'], parSalle, 'salle', { jours: ['Mardi'] })).toEqual(['B02']);
  });

  /*
   * ⚠️ UNE SÉANCE ABSENTE COMPTE : la question est « a-t-il cours ce jour-là ? »,
   * pas « l'a-t-il assuré ? ».
   */
  it('⚠️ une séance absente occupe quand même le créneau', () => {
    const avecAbsence = [seance({ formateurMatricule: '9863', jour: 'Lundi', statut: 'absent' })];
    expect(filtrerSujets(['9863'], avecAbsence, 'formateur', { jours: ['Lundi'] })).toEqual(['9863']);
  });
});

describe('filtrerGroupes — filière, niveau, année', () => {
  const identites = new Map([
    ['GM101', { filiere: 'GM_GM_TS', filiereLibelle: 'Génie Mécanique', niveau: 'TS', annee: 1 }],
    ['GM201', { filiere: 'GM_GM_TS', filiereLibelle: 'Génie Mécanique', niveau: 'TS', annee: 2 }],
    ['OPCM101', { filiere: 'GM_OPCM_Q', filiereLibelle: 'Ouvrier Polyvalent', niveau: 'Q', annee: 1 }],
    ['PM101', { filiere: 'GM_PM_T', filiereLibelle: 'Production mécanique', niveau: 'T', annee: 1 }],
  ]);
  const groupes = ['GM101', 'GM201', 'OPCM101', 'PM101'];

  it('aucune facette cochée = tout le monde', () => {
    expect(filtrerGroupes(groupes, identites, {})).toEqual(groupes);
    expect(filtrerGroupes(groupes, identites, { niveaux: [] })).toEqual(groupes);
  });

  /*
   * ⚠️ « OU » DANS UNE FACETTE : cocher TS et Q demande l'un OU l'autre. Exiger
   * les deux à la fois ne laisserait jamais personne — un groupe n'a qu'un
   * niveau.
   */
  it('deux valeurs d’une même facette s’additionnent', () => {
    expect(filtrerGroupes(groupes, identites, { niveaux: ['TS', 'Q'] })).toEqual([
      'GM101',
      'GM201',
      'OPCM101',
    ]);
  });

  /*
   * ⚠️ « ET » ENTRE LES FACETTES, et sur le MÊME groupe : « TS » + « 2e année »
   * ne doit pas rendre un TS de 1re année sous prétexte qu'un autre groupe est
   * en 2e.
   */
  it('les facettes se combinent sur le même groupe', () => {
    expect(filtrerGroupes(groupes, identites, { niveaux: ['TS'], annees: [2] })).toEqual(['GM201']);
    expect(filtrerGroupes(groupes, identites, { niveaux: ['Q'], annees: [2] })).toEqual([]);
  });

  it('filtre par code filière', () => {
    expect(filtrerGroupes(groupes, identites, { filieres: ['GM_GM_TS'] })).toEqual([
      'GM101',
      'GM201',
    ]);
  });

  /*
   * ⚠️ UN GROUPE SANS IDENTITÉ EST ÉCARTÉ dès qu'une facette est cochée — jamais
   * gardé « au cas où ». Le laisser passer sous « TS » alors qu'on ignore son
   * niveau ferait lire une liste fausse.
   */
  it('un groupe d’identité inconnue sort dès qu’une facette est cochée', () => {
    const avecInconnu = [...groupes, 'ZZ999'];
    expect(filtrerGroupes(avecInconnu, identites, {})).toContain('ZZ999');
    expect(filtrerGroupes(avecInconnu, identites, { niveaux: ['TS'] })).not.toContain('ZZ999');
  });

  it('accepte un objet simple autant qu’une Map — c’est ce que rend le serveur', () => {
    expect(filtrerGroupes(groupes, Object.fromEntries(identites), { annees: [2] })).toEqual([
      'GM201',
    ]);
  });

  /* L'année voyage en nombre côté domaine, en chaîne depuis une case cochée. */
  it('compare les années sans se soucier du type', () => {
    expect(filtrerGroupes(groupes, identites, { annees: ['1'] })).toEqual([
      'GM101',
      'OPCM101',
      'PM101',
    ]);
  });
});

describe('facettesDesGroupes — ne proposer que ce qui existe', () => {
  const identites = {
    GM101: { filiere: 'GM_GM_TS', filiereLibelle: 'Génie Mécanique', niveau: 'TS', annee: 1 },
    GM201: { filiere: 'GM_GM_TS', filiereLibelle: 'Génie Mécanique', niveau: 'TS', annee: 2 },
    OPCM101: { filiere: 'GM_OPCM_Q', filiereLibelle: 'Ouvrier Polyvalent', niveau: 'Q', annee: 1 },
  };

  it('rend chaque filière UNE fois, triée par libellé', () => {
    const { filieres } = facettesDesGroupes(Object.keys(identites), identites);
    expect(filieres).toEqual([
      { valeur: 'GM_GM_TS', libelle: 'Génie Mécanique' },
      { valeur: 'GM_OPCM_Q', libelle: 'Ouvrier Polyvalent' },
    ]);
  });

  /*
   * ⚠️ LES NIVEAUX SUIVENT L'ORDRE DU CURSUS, pas l'alphabet : « Q » viendrait
   * sinon entre « PC » et « S », ce qui ne veut rien dire.
   */
  it('ordonne les niveaux du cursus le plus court au plus long', () => {
    const { niveaux } = facettesDesGroupes(Object.keys(identites), identites);
    expect(niveaux).toEqual(['Q', 'TS']);
  });

  it('n’offre AUCUN niveau que l’établissement ne porte pas', () => {
    const { niveaux } = facettesDesGroupes(['OPCM101'], identites);
    expect(niveaux).toEqual(['Q']);
    expect(niveaux).not.toContain('BP');
  });

  it('trie les années en NOMBRES', () => {
    const dix = { ...identites, X: { filiere: 'F', niveau: 'T', annee: 10 } };
    expect(facettesDesGroupes(Object.keys(dix), dix).annees).toEqual(['1', '2', '10']);
  });

  it('ignore les groupes sans identité plutôt que de proposer du vide', () => {
    const { filieres, niveaux, annees } = facettesDesGroupes(['ZZ999'], identites);
    expect(filieres).toEqual([]);
    expect(niveaux).toEqual([]);
    expect(annees).toEqual([]);
  });
});

describe('agendaDuSujet', () => {
  const jourDe = (agenda, nom) => agenda.jours.find((j) => j.jour === nom);

  it('fusionne deux créneaux CONTIGUS qui portent exactement le même contenu', () => {
    const agenda = agendaDuSujet({
      sujet: '9863',
      axe: 'formateur',
      seances: [
        seance({ seance: 'S1' }),
        seance({ seance: 'S2' }),
      ],
    });

    const lundi = jourDe(agenda, 'Lundi');
    expect(lundi.blocs).toHaveLength(1);
    expect(lundi.blocs[0]).toMatchObject({
      creneaux: ['S1', 'S2'],
      heures: 5, // 2 × 2,5 h
      module: 'M101',
      autreSujet: 'GM101',
      salle: 'A12',
      // ← get_formateur_timetable.php:201-202 (jour non-Vendredi) : S1
      // 08:30-11:00, S2 11:00-13:30.
      debut: '08:30',
      fin: '13:30',
      pauses: ['Pause 15 min · reprise 11h15'],
    });
  });

  // F9 (2026-09-14) : l'appel se lance depuis la carte, il faut désigner la séance.
  it('porte le libellé de groupe de la séance, fusion comprise, et sa période', () => {
    const agenda = agendaDuSujet({
      sujet: '9863',
      axe: 'formateur',
      seances: [seance({ seance: 'S1', groupe: 'GM101 GM102', salle: 'TEAMS' })],
    });
    expect(jourDe(agenda, 'Lundi').blocs[0]).toMatchObject({ groupeSeance: 'GM101 GM102', periode: 'jour' });
  });

  it("porte l'horaire OFFICIEL, différent le VENDREDI (pause de la prière)", () => {
    const agenda = agendaDuSujet({
      sujet: '9863',
      axe: 'formateur',
      seances: [
        seance({ seance: 'S1', jour: 'Vendredi' }),
        seance({ seance: 'S2', jour: 'Vendredi' }),
      ],
    });

    // ← get_formateur_timetable.php:191-192 (Vendredi) : S1 08:30-10:30,
    // S2 10:30-12:30 — plus court que les autres jours.
    expect(jourDe(agenda, 'Vendredi').blocs[0]).toMatchObject({
      debut: '08:30',
      fin: '12:30',
      pauses: ['Pause 15 min · reprise 10h45'],
    });
  });

  it("porte l'horaire de CHAQUE créneau du bloc, écart du Vendredi compris", () => {
    const agenda = agendaDuSujet({
      sujet: '9863',
      axe: 'formateur',
      seances: [
        seance({ seance: 'S2', jour: 'Vendredi' }),
        seance({ seance: 'S3', jour: 'Vendredi' }),
      ],
    });

    // C'est ce détail qui dit QUEL créneau se déroule maintenant — et qu'entre
    // 12:30 et 14:30 on est dans la pause de la prière, pas dans un cours.
    expect(jourDe(agenda, 'Vendredi').blocs[0].horaires).toEqual([
      { debut: '10:30', fin: '12:30' },
      { debut: '14:30', fin: '16:30' },
    ]);
  });

  it('la pause déjeuner (S3 à 13:30) porte SA propre durée, 30 min', () => {
    const agenda = agendaDuSujet({
      sujet: '9863',
      axe: 'formateur',
      seances: [seance({ seance: 'S2' }), seance({ seance: 'S3' })],
    });

    // ← getPauseLabel() de l'ancien produit : le seul cas où la « pause »
    // affichée est la VRAIE pause déjeuner, pas une décoration de 15 min.
    expect(jourDe(agenda, 'Lundi').blocs[0].pauses).toEqual(['Pause 30 min · reprise 13h30']);
  });

  it('la pause déjeuner du VENDREDI dure 2h et reprend à 14h30, pas la décoration « 30 min » du jour standard', () => {
    const agenda = agendaDuSujet({
      sujet: '9863',
      axe: 'formateur',
      seances: [
        seance({ seance: 'S2', jour: 'Vendredi' }),
        seance({ seance: 'S3', jour: 'Vendredi' }),
      ],
    });

    // ⚠️ S2 finit à 12:30, S3 reprend à 14:30 (get_formateur_timetable.php:193)
    // — un écart RÉEL de deux heures PILE, jamais la décoration « 30 min »
    // du jour standard (où l'écart est nul, S2 finissant exactement quand
    // S3 commence). Le porteur avait d'abord corrigé à « reprise 14h20 »
    // (2026-09-05), avant de confirmer que 14h30 était la bonne valeur.
    expect(jourDe(agenda, 'Vendredi').blocs[0].pauses).toEqual(['Pause 2h · reprise 14h30']);
  });

  it('NE fusionne PAS deux créneaux contigus dont le contenu diffère', () => {
    const agenda = agendaDuSujet({
      sujet: '9863',
      axe: 'formateur',
      seances: [
        seance({ seance: 'S1', module: 'M101' }),
        seance({ seance: 'S2', module: 'M102' }),
      ],
    });

    const lundi = jourDe(agenda, 'Lundi');
    expect(lundi.blocs).toHaveLength(2);
    expect(lundi.blocs.map((b) => b.creneaux)).toEqual([['S1'], ['S2']]);
  });

  it('⚠️ un RATTRAPAGE ne fusionne pas avec le cours ordinaire contigu, et se signale', () => {
    // Même module, même groupe, même salle : sans la marque dans la signature,
    // les deux créneaux feraient UN bloc ↺ — et des heures ordinaires se
    // liraient comme rattrapées.
    const agenda = agendaDuSujet({
      sujet: '9863',
      axe: 'formateur',
      seances: [seance({ seance: 'S1' }), seance({ seance: 'S2', statut: 'rattrape' })],
    });

    const lundi = jourDe(agenda, 'Lundi');
    expect(lundi.blocs.map((b) => b.creneaux)).toEqual([['S1'], ['S2']]);
    expect(lundi.blocs.map((b) => b.rattrapage)).toEqual([false, true]);
    // Un rattrapage est un cours donné : ses heures comptent.
    expect(agenda.heures).toBe(5);
  });

  it('ne fusionne jamais à travers le soir, même à contenu identique', () => {
    const agenda = agendaDuSujet({
      sujet: '9863',
      axe: 'formateur',
      seances: [
        seance({ seance: 'S4' }),
        seance({ seance: 'S5', periode: 'soir' }),
      ],
    });

    const lundi = jourDe(agenda, 'Lundi');
    expect(lundi.blocs.map((b) => b.creneaux)).toEqual([['S4'], ['S5']]);
  });

  it('une séance ABSENTE ne compte pas dans les heures, et le dit', () => {
    const agenda = agendaDuSujet({
      sujet: '9863',
      axe: 'formateur',
      seances: [seance({ seance: 'S1', statut: 'absent' })],
    });

    const lundi = jourDe(agenda, 'Lundi');
    expect(lundi.blocs[0]).toMatchObject({ heures: 0, absente: true });
  });

  it("sur l'axe groupe, l'autre sujet est le FORMATEUR — résolu par son nom", () => {
    const noms = new Map([['9863', 'AHMED CHERKAOUI']]);
    const agenda = agendaDuSujet({
      sujet: 'GM101',
      axe: 'groupe',
      nomsFormateurs: noms,
      seances: [seance({ seance: 'S1' })],
    });

    expect(jourDe(agenda, 'Lundi').blocs[0].autreSujet).toBe('AHMED CHERKAOUI');
  });

  it('un jour sans séance rend une liste de blocs vide, pas une absence de jour', () => {
    const agenda = agendaDuSujet({ sujet: '9863', axe: 'formateur', seances: [] });
    expect(agenda.jours).toHaveLength(6);
    expect(agenda.jours.every((j) => j.blocs.length === 0)).toBe(true);
    expect(agenda.heures).toBe(0);
  });

  /*
   * ⚠️ LE MÊME TOTAL QUE LA BANDE DE `GrilleDetaillee` — demande du porteur
   * (2026-09-04) : « je veux que cette bande en agenda affiche le nb d'heure
   * de la semaine … comme celui dans vue tableau ». C'est le total que rend
   * DÉJÀ `assemblerConsultation`, pas un second calcul.
   */
  it('la BANDE porte le total de la semaine, sur les deux services', () => {
    const agenda = agendaDuSujet({
      sujet: '9863',
      axe: 'formateur',
      seances: [
        seance({ jour: 'Lundi', seance: 'S1' }),
        seance({ jour: 'Mardi', seance: 'S1' }),
        seance({ jour: 'Vendredi', seance: 'S5', periode: 'soir' }),
      ],
    });

    // 2 × 2,5 h (jour) + 1 × 2 h (soir) = 7 h.
    expect(agenda.heures).toBe(7);
  });

  it("une séance ABSENTE ne pèse rien dans le total de la bande non plus", () => {
    const agenda = agendaDuSujet({
      sujet: '9863',
      axe: 'formateur',
      seances: [seance({ seance: 'S1', statut: 'absent' }), seance({ jour: 'Mardi', seance: 'S1' })],
    });

    expect(agenda.heures).toBe(2.5);
  });

  it('repère une séance à distance (TEAMS) et une séance EFM', () => {
    const agenda = agendaDuSujet({
      sujet: '9863',
      axe: 'formateur',
      seances: [
        seance({ seance: 'S1', jour: 'Mardi', salle: 'TEAMS' }),
        seance({ seance: 'S1', jour: 'Mercredi', estEfm: true }),
      ],
    });

    expect(jourDe(agenda, 'Mardi').blocs[0]).toMatchObject({ aDistance: true, efm: false });
    expect(jourDe(agenda, 'Mercredi').blocs[0]).toMatchObject({ aDistance: false, efm: true });
  });
});

describe('seanceTerminee — la règle du badge « Terminé » de l’agenda', () => {
  const le = (heure) => ({ date: '2026-09-11', heure });
  const vendrediS2 = { date: new Date(2026, 8, 11), jour: 'Vendredi', seance: 'S2' };

  it('un jour passé est terminé, un jour à venir ne l’est pas', () => {
    expect(seanceTerminee({ date: new Date(2026, 8, 10), jour: 'Jeudi', seance: 'S4' }, le('07:00'))).toBe(true);
    expect(seanceTerminee({ date: new Date(2026, 8, 12), jour: 'Samedi', seance: 'S1' }, le('23:59'))).toBe(false);
  });

  it('le jour même, terminée dès que l’horaire OFFICIEL est échu — et pas avant', () => {
    expect(seanceTerminee(vendrediS2, le('12:29'))).toBe(false);
    expect(seanceTerminee(vendrediS2, le('12:30'))).toBe(true);
  });

  it('⚠️ l’horaire dépend du jour : S2 finit à 12:30 le Vendredi, à 13:30 ailleurs', () => {
    const jeudiS2 = { date: new Date(2026, 8, 10), jour: 'Jeudi', seance: 'S2' };
    const maintenant = { date: '2026-09-10', heure: '13:00' };
    expect(seanceTerminee(jeudiS2, maintenant)).toBe(false);
    expect(seanceTerminee({ ...vendrediS2 }, { date: '2026-09-11', heure: '13:00' })).toBe(true);
  });

  it('⚠️ une date sérialisée se lit en heure LOCALE, pas par son préfixe UTC', () => {
    const minuitLocal = new Date(2026, 8, 11);
    const serialisee = { ...vendrediS2, date: minuitLocal.toISOString() };
    expect(seanceTerminee(serialisee, le('12:29'))).toBe(false);
    expect(seanceTerminee(serialisee, le('12:30'))).toBe(true);
  });

  it('sans date, rien n’est terminé', () => {
    expect(seanceTerminee({ jour: 'Lundi', seance: 'S1' }, le('23:00'))).toBe(false);
    expect(seanceTerminee(vendrediS2, null)).toBe(false);
  });
});

describe('instantLocal', () => {
  it('rend la date et l’heure LOCALES, avec leurs zéros de tête', () => {
    expect(instantLocal(new Date(2026, 8, 5, 8, 7))).toEqual({ date: '2026-09-05', heure: '08:07' });
  });
});
