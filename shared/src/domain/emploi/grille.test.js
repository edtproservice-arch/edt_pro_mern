import { describe, it, expect } from 'vitest';
import {
  DUREE_JOUR,
  DUREE_SOIR,
  dureeSeance,
  SEANCES_JOUR,
  SEANCE_SOIR,
  assemblerGrille,
  groupesDuSoir,
  heuresParSujet,
  indexerSeances,
  niveauCharge,
  basculeVersSemaineSuivante,
  semaineAOuvrir,
  prochaineBascule,
} from './grille.js';
import { bornesAnneeScolaire, lundiPremiereSemaine } from '../planning/anneeScolaire.js';
import { valeurSemaine } from '../planning/semaines.js';

const seance = (surcharges = {}) => ({
  formateurMatricule: '9863',
  groupe: 'GM101',
  module: 'M101',
  salle: 'A12',
  jour: 'Lundi',
  seance: 'S1',
  periode: 'jour',
  statut: 'planifie',
  ...surcharges,
});

describe('les créneaux', () => {
  it('⚠️ la grille de JOUR va de S1 à S4', () => {
    /*
     * C'est ce que dit l'en-tête de l'existant : `colspan="4"` par jour. En
     * étaler cinq ajouterait partout une case que personne ne peut remplir, et
     * ferait croire à un créneau libre.
     */
    expect(SEANCES_JOUR).toEqual(['S1', 'S2', 'S3', 'S4']);
  });

  it('S5 est le créneau du SOIR', () => {
    expect(SEANCE_SOIR).toBe('S5');
    expect(SEANCES_JOUR).not.toContain(SEANCE_SOIR);
  });
});

describe('indexerSeances', () => {
  it('range par formateur, jour et créneau', () => {
    const index = indexerSeances([seance()]);
    expect(index.get('9863||Lundi||S1||jour').groupe).toBe('GM101');
  });

  it('range par GROUPE quand c’est l’axe demandé', () => {
    const index = indexerSeances([seance()], 'groupe');
    expect(index.get('GM101||Lundi||S1||jour').formateurMatricule).toBe('9863');
  });

  it('⚠️ NE CONFOND PAS le S5 du jour et celui du SOIR', () => {
    /*
     * Sans la période dans la clé, les deux se remplaceraient l'une l'autre à
     * l'affichage — et c'est précisément le cas qui existe, S5 étant le
     * créneau du soir.
     */
    const index = indexerSeances([
      seance({ seance: 'S5', periode: 'jour', module: 'JOUR' }),
      seance({ seance: 'S5', periode: 'soir', module: 'SOIR' }),
    ]);

    expect(index.get('9863||Lundi||S5||jour').module).toBe('JOUR');
    expect(index.get('9863||Lundi||S5||soir').module).toBe('SOIR');
  });

  it('ignore une séance sans sujet', () => {
    expect(indexerSeances([seance({ formateurMatricule: '' })]).size).toBe(0);
  });
});

describe('heuresParSujet', () => {
  it('compte une séance pour sa durée', () => {
    expect(heuresParSujet([seance(), seance({ seance: 'S2' })]).get('9863')).toBe(2 * DUREE_JOUR);
  });

  it('⚠️ N’ADDITIONNE PAS une séance ABSENTE', () => {
    /*
     * Le formateur n'a pas assuré ces heures. Les compter ferait croire sa
     * semaine pleine alors qu'il faut les rattraper — et le badge de l'existant
     * ne s'affiche pas non plus sur une cellule absente.
     */
    const heures = heuresParSujet([seance(), seance({ seance: 'S2', statut: 'absent' })]);
    expect(heures.get('9863')).toBe(DUREE_JOUR);
  });

  it('compte par groupe sur l’autre axe', () => {
    const heures = heuresParSujet([seance(), seance({ groupe: 'GM102', seance: 'S2' })], 'groupe');
    expect(heures.get('GM101')).toBe(DUREE_JOUR);
    expect(heures.get('GM102')).toBe(DUREE_JOUR);
  });
});

describe('niveauCharge', () => {
  it('reprend les seuils de l’existant', () => {
    // > 35 rouge, > 22.5 orange : au-delà, la semaine ne tient pas.
    expect(niveauCharge(0)).toBe('normal');
    expect(niveauCharge(22.5)).toBe('normal');
    expect(niveauCharge(25)).toBe('eleve');
    expect(niveauCharge(35)).toBe('eleve');
    expect(niveauCharge(37.5)).toBe('surcharge');
  });
});

describe('groupesDuSoir', () => {
  it('retient les groupes portant « CDS »', () => {
    // Le suffixe est posé par le renommage de l'import e-note : c'est la seule
    // marque que la base en garde.
    expect(groupesDuSoir(['GM101', 'GE101 (CDS)', 'cds202'])).toEqual(['GE101 (CDS)', 'cds202']);
  });

  it('rend une liste vide sans groupe du soir', () => {
    expect(groupesDuSoir(['GM101'])).toEqual([]);
  });
});

describe('assemblerGrille', () => {
  it('rend 6 jours × 4 créneaux en grille de jour', () => {
    const [ligne] = assemblerGrille({ sujets: ['9863'], seances: [seance()] });

    expect(ligne.cases).toHaveLength(24);
    expect(ligne.cases[0]).toMatchObject({ jour: 'Lundi', seance: 'S1' });
    expect(ligne.cases[0].contenu.module).toBe('M101');
  });

  it('rend 6 cases en grille du SOIR', () => {
    const [ligne] = assemblerGrille({
      sujets: ['GE101 (CDS)'],
      seances: [seance({ groupe: 'GE101 (CDS)', seance: 'S5', periode: 'soir' })],
      axe: 'groupe',
      periode: 'soir',
    });

    expect(ligne.cases).toHaveLength(6);
    expect(ligne.cases[0].contenu.module).toBe('M101');
  });

  it('laisse la case VIDE quand rien n’est posé', () => {
    const [ligne] = assemblerGrille({ sujets: ['9863'], seances: [] });
    expect(ligne.cases.every((c) => c.contenu === null)).toBe(true);
    expect(ligne.heures).toBe(0);
  });

  it('rend un sujet même sans aucune séance', () => {
    // Une ligne absente laisserait croire que le formateur n'existe pas, alors
    // qu'il n'a simplement rien cette semaine-là.
    const grille = assemblerGrille({ sujets: ['9863', '4211'], seances: [seance()] });
    expect(grille.map((l) => l.sujet)).toEqual(['9863', '4211']);
  });

  it('porte les heures et le niveau de charge', () => {
    const seances = Array.from({ length: 10 }, (_, rang) =>
      seance({ jour: 'Lundi', seance: SEANCES_JOUR[rang % 4], groupe: `G${rang}` })
    );
    const [ligne] = assemblerGrille({ sujets: ['9863'], seances });

    expect(ligne.heures).toBe(25);
    expect(ligne.niveau).toBe('eleve');
  });
});

describe('semaineAOuvrir', () => {
  it('ouvre sur AUJOURD’HUI quand la date tombe dans l’année active', () => {
    // 2026-2027 s'ouvre le lundi de la semaine du 1er septembre 2026.
    expect(semaineAOuvrir(2026, new Date(2026, 10, 4))).toBe(valeurSemaine(new Date(2026, 10, 4)));
  });

  it('⚠️ ouvre sur la PREMIÈRE semaine quand la date est HORS de l’année', () => {
    /*
     * Un directeur qui prépare 2026-2027 au mois d'août est encore, au
     * calendrier, dans l'année 2025-2026 : ouvrir sur « la semaine
     * d'aujourd'hui » lui présenterait une semaine ne pouvant porter AUCUNE de
     * ses séances — la grille reviendrait vide sans que rien ne l'explique.
     */
    const ouverte = semaineAOuvrir(2026, new Date(2026, 7, 24));
    expect(ouverte).toBe(valeurSemaine(lundiPremiereSemaine(2026)));
    expect(ouverte).not.toBe(valeurSemaine(new Date(2026, 7, 24)));
  });

  it('ouvre sur la première semaine pour une année ENCORE À VENIR', () => {
    expect(semaineAOuvrir(2030, new Date(2026, 10, 4))).toBe(
      valeurSemaine(lundiPremiereSemaine(2030))
    );
  });

  /*
   * ═══ LA PUBLICATION NE PEUT QU'AVANCER ═══ (2026-09-14, révise le 2026-09-06
   * où elle passait avant tout.) Publier sert à montrer une semaine EN AVANCE ;
   * une publication oubliée ne doit plus retenir tout le monde dans le passé.
   */
  it('ouvre sur la semaine PUBLIÉE quand elle est plus tardive que celle du jour', () => {
    const publiee = '2026-W12';
    // Mercredi 4 novembre 2026 : S10. La S12 publiée l'emporte.
    expect(semaineAOuvrir(2026, new Date(2026, 10, 4), { semainePubliee: publiee })).toBe(publiee);
    // …y compris hors de l'année, où le repli aurait choisi la première semaine.
    expect(semaineAOuvrir(2026, new Date(2026, 7, 24), { semainePubliee: publiee })).toBe(publiee);
  });

  it('⚠️ une publication RÉVOLUE ne retient plus personne', () => {
    // Le cas signalé : S2 publiée le 6 septembre, toujours ouverte le 14 (S3).
    const lundi14 = new Date(2026, 8, 14, 9, 0);
    expect(semaineAOuvrir(2026, lundi14, { semainePubliee: '2026-W2', regleWeekEnd: true })).toBe(
      valeurSemaine(lundi14)
    );
    // Une publication d'une AUTRE année, antérieure, est révolue aussi.
    expect(semaineAOuvrir(2026, new Date(2026, 10, 4), { semainePubliee: '2025-W40' })).toBe(
      valeurSemaine(new Date(2026, 10, 4))
    );
  });

  it('⚠️ le samedi 6 h 30, la semaine suivante s’ouvre MÊME si la courante est publiée', () => {
    const samedi = new Date(2026, 10, 7, 6, 30); // samedi de la S10
    const courante = valeurSemaine(samedi);
    const suivante = valeurSemaine(new Date(2026, 10, 9));

    expect(semaineAOuvrir(2026, samedi, { semainePubliee: courante, regleWeekEnd: true })).toBe(
      suivante
    );
    // 6 h 29 : on reste sur la semaine publiée.
    const avant = new Date(2026, 10, 7, 6, 29);
    expect(semaineAOuvrir(2026, avant, { semainePubliee: courante, regleWeekEnd: true })).toBe(
      courante
    );
  });

  it('garde une publication ÉGALE à la semaine par la date, et normalise son écriture', () => {
    const mercredi = new Date(2026, 10, 4);
    const courante = valeurSemaine(mercredi);
    expect(semaineAOuvrir(2026, mercredi, { semainePubliee: courante })).toBe(courante);
    // Le zéro de remplissage existe en production (« 2026-W039 »).
    expect(semaineAOuvrir(2026, mercredi, { semainePubliee: '2026-W039' })).toBe('2026-W39');
  });

  it('ignore une publication illisible', () => {
    const mercredi = new Date(2026, 10, 4);
    expect(semaineAOuvrir(2026, mercredi, { semainePubliee: 'n’importe quoi' })).toBe(
      valeurSemaine(mercredi)
    );
  });

  it('ignore la règle du week-end tant qu’on ne la demande pas', () => {
    // Dimanche 8 novembre 2026 — sans `regleWeekEnd`, on reste sur sa semaine.
    const dimanche = new Date(2026, 10, 8, 20, 0);
    expect(semaineAOuvrir(2026, dimanche)).toBe(valeurSemaine(dimanche));
  });
});

/*
 * ═══ LA RÈGLE DU SAMEDI 06H30 ═══ ← `getSemaineActiveParRegle()` de
 * emploiFormateur.html. Le seuil suit la journée de cours : le samedi matin on
 * enseigne encore, l'après-midi la semaine est finie.
 */
describe('basculeVersSemaineSuivante', () => {
  it('ne bascule pas en semaine, ni le samedi AVANT 6 h 30', () => {
    expect(basculeVersSemaineSuivante(new Date(2026, 10, 4, 23, 59))).toBe(false); // mercredi
    expect(basculeVersSemaineSuivante(new Date(2026, 10, 7, 6, 29))).toBe(false); // samedi 6h29
  });

  it('bascule à partir du samedi 6 h 30, et tout le dimanche', () => {
    expect(basculeVersSemaineSuivante(new Date(2026, 10, 7, 6, 30))).toBe(true);
    expect(basculeVersSemaineSuivante(new Date(2026, 10, 7, 14, 0))).toBe(true);
    expect(basculeVersSemaineSuivante(new Date(2026, 10, 8, 0, 1))).toBe(true); // dimanche
  });

  it('prochaineBascule rend le samedi 6 h 30 suivant, strictement après maintenant', () => {
    // Mercredi 4 novembre → samedi 7 à 6 h 30.
    expect(prochaineBascule(new Date(2026, 10, 4, 12, 0))).toEqual(new Date(2026, 10, 7, 6, 30));
    // Samedi 6 h 29 → le jour même.
    expect(prochaineBascule(new Date(2026, 10, 7, 6, 29))).toEqual(new Date(2026, 10, 7, 6, 30));
    // Samedi 6 h 30 pile et dimanche → le samedi d'après.
    expect(prochaineBascule(new Date(2026, 10, 7, 6, 30))).toEqual(new Date(2026, 10, 14, 6, 30));
    expect(prochaineBascule(new Date(2026, 10, 8, 23, 0))).toEqual(new Date(2026, 10, 14, 6, 30));
  });

  it('avance d’une semaine quand la règle est demandée', () => {
    const dimanche = new Date(2026, 10, 8, 20, 0);
    const suivante = new Date(2026, 10, 15, 20, 0);
    expect(semaineAOuvrir(2026, dimanche, { regleWeekEnd: true })).toBe(valeurSemaine(suivante));
  });

  /*
   * ⚠️ ON NE SORT PAS DE L'ANNÉE : la dernière semaine d'août n'a pas de
   * suivante, et basculer y ouvrirait l'année d'après — une grille vide.
   */
  it('reste dans l’année sur sa toute dernière semaine', () => {
    const bornes = bornesAnneeScolaire(2026);
    const [a, m, j] = bornes.fin.split('-').map(Number);
    const dernierJour = new Date(a, m - 1, j, 12, 0); // un dimanche par construction

    expect(semaineAOuvrir(2026, dernierJour, { regleWeekEnd: true })).toBe(
      valeurSemaine(dernierJour)
    );
  });
});

describe('dureeSeance', () => {
  it('⚠️ le créneau du SOIR dure 2 h, pas 2,5', () => {
    /*
     * C'est ce que dit `getSeanceDuration()` de l'existant. Une constante plate
     * faisait compter une demi-heure de trop par séance du soir — la charge
     * d'un formateur CDS était surévaluée sans que rien ne le signale.
     */
    expect(dureeSeance('S1')).toBe(2.5);
    expect(dureeSeance('S5')).toBe(2);
    expect(DUREE_SOIR).toBe(2);
  });

  it('compte une semaine du SOIR à la bonne durée', () => {
    const heures = heuresParSujet([
      seance({ seance: 'S5', periode: 'soir' }),
      seance({ seance: 'S5', periode: 'soir', jour: 'Mardi' }),
    ]);
    expect(heures.get('9863')).toBe(4);
  });
});
