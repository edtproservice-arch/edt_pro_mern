/**
 * Le pont Node ↔ solveur : construction des tâches et du problème.
 *
 * ⚠️ C'EST ICI QUE LES DÉFAUTS SONT SILENCIEUX. Une interdiction oubliée ne
 *    lève aucune erreur : elle produit une grille que `poser()` refusera
 *    ensuite, séance par séance, pour une raison que le rapport ne rattachera
 *    jamais à sa cause. Un module non apparié ne lève rien non plus — ses
 *    heures disparaissent simplement de la semaine.
 *
 * Les deux fonctions testées sont PURES : aucune base, aucun solveur.
 */

import { describe, expect, it } from 'vitest';

import { MOTIFS_IGNOREE, PERIODES, TYPES_COURS } from 'shared/constants';

import {
  construireProbleme,
  CRENEAUX_GENERES,
  joursOuverts,
} from '../../src/modules/generation/probleme.js';
import { prioriteDe, tachesDeLaSemaine } from '../../src/modules/generation/taches.js';

const SEMAINE = 3;

/** Un chronogramme : 5 h du module M1 en semaine 3, en présentiel. */
const chrono = (groupe, module = 'M1', type = 'P', heures = 5, numero = SEMAINE) => ({
  groupe,
  planning: { [module]: { [numero]: { heures, type } } },
});

const affectation = (extra = {}) => ({
  formateur: '15688',
  groupe: 'GM101',
  module: 'M1',
  type: TYPES_COURS.PRESENTIEL,
  s1Heures: 40,
  s2Heures: 0,
  estRegional: false,
  ...extra,
});

/** Une semaine ouverte du lundi au samedi, sans rien de fermé. */
function semaineOuverte(surcharges = {}) {
  const jours = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'].map((jour, i) => ({
    jour,
    date: `2026-09-${String(14 + i).padStart(2, '0')}`,
    ferie: null,
    vacances: false,
    rentreesGelees: [],
    stages: [],
    formations: [],
    ...(surcharges[jour] ?? {}),
  }));
  return { semaine: '2026-W3', anneeScolaire: 2026, jours, seances: [] };
}

const problemeDe = (options) =>
  construireProbleme({
    semaine: semaineOuverte(),
    taches: [],
    salles: ['Salle 1', 'Salle 2'],
    groupesFq: [],
    contraintes: [],
    formateurs: [{ matricule: '15688', nom: 'ABDELGHANI LAASAL' }],
    graine: 1,
    ...options,
  });

// ---------------------------------------------------------------------------

describe('tachesDeLaSemaine', () => {
  it('joint le chronogramme aux affectations', () => {
    const { taches } = tachesDeLaSemaine({
      chronogrammes: [chrono('GM101')],
      affectations: [affectation()],
      numero: SEMAINE,
    });

    expect(taches).toHaveLength(1);
    expect(taches[0]).toMatchObject({
      formateurMatricule: '15688',
      groupeLibelle: 'GM101',
      module: 'M1',
      heures: 5,
      // 5 h ÷ 2,5 = 2 séances
      seancesRequises: 2,
    });
  });

  it('attache la salle déclarée pour ce module DANS CE GROUPE', () => {
    const { taches } = tachesDeLaSemaine({
      chronogrammes: [chrono('GM101')],
      affectations: [affectation()],
      sallesAffectations: { 'GM101||M1': ['Atelier soudure'] },
      numero: SEMAINE,
    });
    expect(taches[0].sallesModule).toEqual(['Atelier soudure']);
  });

  it('ne confond pas le même module dans DEUX groupes différents', () => {
    /*
     * ⚠️ LA CLÉ PORTE LE GROUPE, et ce n'est pas un détail : « M1 » se donne en
     *    atelier pour GM101 et en salle ordinaire pour GM102. Une clé réduite
     *    au module aurait envoyé GM102 dans l'atelier — un conflit de salle
     *    fabriqué de toutes pièces, une semaine sur deux.
     */
    const { taches } = tachesDeLaSemaine({
      chronogrammes: [chrono('GM101'), chrono('GM102')],
      affectations: [affectation(), affectation({ groupe: 'GM102', formateur: '15689' })],
      sallesAffectations: { 'GM101||M1': ['Atelier soudure'] },
      numero: SEMAINE,
    });
    const parGroupe = Object.fromEntries(taches.map((t) => [t.groupeLibelle, t.sallesModule]));
    expect(parGroupe.GM101).toEqual(['Atelier soudure']);
    expect(parGroupe.GM102).toEqual([]);
  });

  it('rend un tableau vide — jamais undefined — quand rien n’est déclaré', () => {
    // ⚠️ `sallesModule?.length` protège côté service, mais `sallesDe` fait un
    //    `.filter()` : un `undefined` y lèverait, et la génération entière
    //    échouerait sur une carte parfaitement ordinaire.
    const { taches } = tachesDeLaSemaine({
      chronogrammes: [chrono('GM101')],
      affectations: [affectation()],
      numero: SEMAINE,
    });
    expect(taches[0].sallesModule).toEqual([]);
  });

  it('ignore les semaines qui ne sont pas demandées', () => {
    const { taches } = tachesDeLaSemaine({
      chronogrammes: [chrono('GM101', 'M1', 'P', 5, 12)],
      affectations: [affectation()],
      numero: SEMAINE,
    });
    expect(taches).toHaveLength(0);
  });

  it('SIGNALE un module planifié sans affectation au lieu de le perdre', () => {
    /*
     * L'ancien faisait `if (affectation)` sans `else` : les heures
     * disparaissaient de la génération sans le moindre message. C'est le cas
     * d'une carte remaniée sous un chronogramme resté en place.
     */
    const { taches, ignorees } = tachesDeLaSemaine({
      chronogrammes: [chrono('GM101', 'M-INCONNU')],
      affectations: [affectation()],
      numero: SEMAINE,
    });

    expect(taches).toHaveLength(0);
    expect(ignorees).toEqual([
      {
        groupe: 'GM101',
        module: 'M-INCONNU',
        type: TYPES_COURS.PRESENTIEL,
        heures: 5,
        // GM101 EXISTE dans la carte : c'est bien une affectation qui manque.
        motif: MOTIFS_IGNOREE.MODULE_NON_AFFECTE,
      },
    ]);
  });

  it('apparie un groupe à travers un libellé FUSIONNÉ, suffixe compris', () => {
    /*
     * ⚠️ Découper sur les espaces fabriquerait « ACADA101 » et « (FQ) », et le
     *    vrai groupe ressortirait sans aucun module — défaut constaté sur les
     *    données réelles.
     */
    const { taches, ignorees } = tachesDeLaSemaine({
      chronogrammes: [chrono('ACADA101 (FQ)', 'M1', 'S')],
      affectations: [
        affectation({ groupe: 'ACADA101 (FQ) GM102', type: TYPES_COURS.SYNCHRONE }),
      ],
      numero: SEMAINE,
    });

    expect(ignorees).toHaveLength(0);
    expect(taches[0].groupes).toEqual(['ACADA101 (FQ)', 'GM102']);
  });

  it("ne crée QU'UNE tâche pour une séance synchrone mutualisée", () => {
    /*
     * La séance figure dans le chronogramme de chacun de ses groupes — elle
     * n'est pourtant donnée qu'une fois. En créer deux doublerait le volume à
     * poser et réserverait deux créneaux au même formateur.
     */
    const { taches } = tachesDeLaSemaine({
      chronogrammes: [chrono('GM101', 'M1', 'S'), chrono('GM102', 'M1', 'S')],
      affectations: [affectation({ groupe: 'GM101 GM102', type: TYPES_COURS.SYNCHRONE })],
      numero: SEMAINE,
    });

    expect(taches).toHaveLength(1);
    expect(taches[0].groupeLibelle).toBe('GM101 GM102');
    expect(taches[0].seancesRequises).toBe(2);
  });

  it('retient le MAXIMUM des heures quand deux chronogrammes divergent', () => {
    const { taches } = tachesDeLaSemaine({
      chronogrammes: [chrono('GM101', 'M1', 'S', 5), chrono('GM102', 'M1', 'S', 2.5)],
      affectations: [affectation({ groupe: 'GM101 GM102', type: TYPES_COURS.SYNCHRONE })],
      numero: SEMAINE,
    });

    // 5 et non 7,5 : additionner compterait la séance deux fois.
    expect(taches[0].heures).toBe(5);
  });

  it('réserve le créneau de TOUS les membres, même sans cellule propre', () => {
    /*
     * Un groupe de la fusion peut n'avoir aucune cellule cette semaine-là — son
     * chronogramme est en retard. Il reçoit quand même la séance : ne compter
     * que les groupes rencontrés laisserait poser un autre cours au même moment.
     */
    const { taches } = tachesDeLaSemaine({
      chronogrammes: [chrono('GM101', 'M1', 'S')],
      affectations: [affectation({ groupe: 'GM101 GM102', type: TYPES_COURS.SYNCHRONE })],
      numero: SEMAINE,
    });

    expect(taches[0].groupes).toEqual(['GM101', 'GM102']);
  });

  it('sépare présentiel et synchrone du même module', () => {
    const { taches } = tachesDeLaSemaine({
      chronogrammes: [
        { groupe: 'GM101', planning: { M1: { [SEMAINE]: { heures: 5, type: 'P' } } } },
        { groupe: 'GM101', planning: { M1: { [SEMAINE]: { heures: 2.5, type: 'S' } } } },
      ],
      affectations: [
        affectation({ formateur: '15688' }),
        affectation({ formateur: '18494', type: TYPES_COURS.SYNCHRONE }),
      ],
      numero: SEMAINE,
    });

    expect(taches).toHaveLength(2);
    expect(taches.map((t) => t.formateurMatricule).sort()).toEqual(['15688', '18494']);
  });

  it('arrondit les séances vers le HAUT', () => {
    // 4 h ne font pas un compte rond de séances de 2,5 h : il en faut deux,
    // sinon une heure et demie de programme ne serait jamais placée.
    const { taches } = tachesDeLaSemaine({
      chronogrammes: [chrono('GM101', 'M1', 'P', 4)],
      affectations: [affectation()],
      numero: SEMAINE,
    });
    expect(taches[0].seancesRequises).toBe(2);
  });

  it('ordonne les priorités comme getPriorityLevel', () => {
    expect(prioriteDe(true, 'S1')).toBe(1);
    expect(prioriteDe(true, 'A')).toBe(2);
    expect(prioriteDe(false, 'S1')).toBe(3);
    expect(prioriteDe(false, 'A')).toBe(4);
    expect(prioriteDe(true, 'S2')).toBe(5);
    expect(prioriteDe(false, 'S2')).toBe(6);
    // Semestre indéterminé : traité en dernier, jamais confondu avec S1.
    expect(prioriteDe(false, '')).toBe(7);
  });
});

// ---------------------------------------------------------------------------

describe('construireProbleme — créneaux', () => {
  it('produit 4 créneaux par jour ouvert, et JAMAIS le soir', () => {
    const { probleme } = problemeDe({});
    expect(CRENEAUX_GENERES).toEqual(['S1', 'S2', 'S3', 'S4']);
    expect(probleme.creneaux).toHaveLength(6 * 4);
    expect(probleme.creneaux.every((creneau) => creneau.rang < 4)).toBe(true);
  });

  it('retire les jours fériés et les vacances au lieu de les interdire', () => {
    /*
     * Un férié ferme l'ÉTABLISSEMENT : le transmettre comme interdiction
     * obligerait à le répéter sur chaque tâche, et le diagnostic dirait
     * « créneau interdit » là où il faut dire « la semaine est fermée ».
     */
    const semaine = semaineOuverte({
      Lundi: { ferie: { libelle: 'Aïd' } },
      Mardi: { vacances: true },
    });
    const { probleme } = construireProbleme({
      semaine,
      taches: [],
      salles: ['Salle 1'],
      formateurs: [],
      graine: 1,
    });

    expect(probleme.creneaux).toHaveLength(4 * 4);
    expect(probleme.creneaux.some((creneau) => creneau.jour === 'Lundi')).toBe(false);
    expect(probleme.creneaux.some((creneau) => creneau.jour === 'Mardi')).toBe(false);
  });

  it('forme les blocs [S1,S2] et [S3,S4], jamais [S2,S3]', () => {
    const { probleme } = problemeDe({});
    const parId = new Map(probleme.creneaux.map((creneau) => [creneau.id, creneau]));

    expect(probleme.blocs).toHaveLength(6 * 2);
    for (const [a, b] of probleme.blocs) {
      expect(parId.get(a).jour).toBe(parId.get(b).jour);
      // La pause déjeuner sépare S2 de S3 : un bloc ne démarre qu'en rang pair.
      expect(parId.get(a).rang % 2).toBe(0);
      expect(parId.get(b).rang - parId.get(a).rang).toBe(1);
    }
  });
});

describe('construireProbleme — interdictions par tâche', () => {
  const tache = (extra = {}) => ({
    id: 'T1',
    formateurMatricule: '15688',
    groupeLibelle: 'GM101',
    groupes: ['GM101'],
    module: 'M1',
    type: TYPES_COURS.PRESENTIEL,
    seancesRequises: 2,
    priorite: 3,
    ...extra,
  });

  const interditsDe = (probleme) => {
    const parId = new Map(probleme.creneaux.map((creneau) => [creneau.id, creneau]));
    return new Set(probleme.taches[0].creneauxInterdits.map((id) => parId.get(id).jour));
  };

  it('ferme les jours où le GROUPE est en stage', () => {
    const semaine = semaineOuverte({ Mercredi: { stages: [{ groupe: 'GM101' }] } });
    const { probleme } = problemeDe({ semaine, taches: [tache()] });
    expect(interditsDe(probleme)).toEqual(new Set(['Mercredi']));
  });

  it('apparie le stage sans tenir compte de la casse ni des espaces', () => {
    // Les stages se saisissent à la main, les groupes viennent de l'e-note :
    // une majuscule d'écart ne doit pas laisser poser un cours.
    const semaine = semaineOuverte({ Jeudi: { stages: [{ groupe: '  gm101 ' }] } });
    const { probleme } = problemeDe({ semaine, taches: [tache()] });
    expect(interditsDe(probleme)).toEqual(new Set(['Jeudi']));
  });

  it('ferme les jours où le FORMATEUR est en formation, apparié par matricule', () => {
    const semaine = semaineOuverte({ Vendredi: { formations: [{ matricule: '15688' }] } });
    const { probleme } = problemeDe({ semaine, taches: [tache()] });
    expect(interditsDe(probleme)).toEqual(new Set(['Vendredi']));
  });

  it("n'appelle JAMAIS une formation au nom vide sur tout le monde", () => {
    /*
     * ⚠️ Le défaut corrigé le 2026-08-14 : la comparaison bidirectionnelle
     *    rendait vrai pour `"AMMARI".includes("")`, et une ligne au nom vide
     *    rendait TOUS les formateurs indisponibles. La colonne est nullable.
     */
    const semaine = semaineOuverte({ Lundi: { formations: [{ matricule: '', nom: '' }] } });
    const { probleme } = problemeDe({ semaine, taches: [tache()] });
    expect(probleme.taches[0].creneauxInterdits).toEqual([]);
  });

  it('ferme les jours précédant la rentrée de ce niveau', () => {
    // L'année de formation se lit dans le nom du groupe : « GM101 » → 1re année.
    const semaine = semaineOuverte({
      Lundi: { rentreesGelees: [{ anneeFormation: 1, date: '2026-09-15' }] },
      Mardi: { rentreesGelees: [{ anneeFormation: 2, date: '2026-09-08' }] },
    });
    const { probleme } = problemeDe({ semaine, taches: [tache()] });
    // Seul le gel de la 1re année ferme GM101 ; celui de la 2e ne le concerne pas.
    expect(interditsDe(probleme)).toEqual(new Set(['Lundi']));
  });

  it('N’INTERDIT PAS les créneaux « à éviter » : il les signale à éviter', () => {
    /*
     * ═══ ⚠️ CE TEST A CHANGÉ DE SENS LE 2026-09-22, ET C'EST VOULU ═══
     * Il affirmait l'inverse, au nom de la règle du 2026-09-17 :
     * « automatiquement, il n'y a personne pour arbitrer, donc la consigne du
     * formateur doit être respectée ». Le porteur a rouvert la question le
     * 2026-09-21 avec une raison NOUVELLE, et mesurée : les traiter en dur
     * coûtait 37 séances non placées — 136 au relevé du 2026-09-22.
     *
     * ⚠️ L'ARGUMENT QUI A RETOURNÉ LA DÉCISION : **une séance non placée n'est
     *    pas arbitrée non plus, elle est perdue.** Le solveur évite donc ces
     *    créneaux tant qu'il a mieux à faire, et ne s'y résout qu'en dernier
     *    recours — ce que Python savait déjà faire, et que Node ne lui
     *    demandait jamais.
     */
    const { probleme } = problemeDe({
      taches: [tache()],
      contraintes: [
        { formateur: '15688', espaces: [], indisponibilites: [{ jour: 'Lundi', seance: 'S1' }] },
      ],
    });
    expect(probleme.taches[0].creneauxInterdits).toEqual([]);
    expect(probleme.taches[0].creneauxAEviter).toHaveLength(1);
  });

  it('les compte quand même dans la DIFFICULTÉ de la tâche', () => {
    /*
     * ⚠️ L'EFFET DE BORD QUE CE TEST INTERDIT. `difficulte` se calcule sur les
     *    créneaux restants ; sortir les consignes des interdictions sans les
     *    recompter ici aurait rendu ces tâches artificiellement faciles, donc
     *    changé l'ordre de priorisation, donc la grille — par-dessus le
     *    changement voulu, et sans que personne l'ait demandé.
     */
    const sans = problemeDe({ taches: [tache()] }).probleme.taches[0].difficulte;
    const avec = problemeDe({
      taches: [tache()],
      contraintes: [
        { formateur: '15688', espaces: [], indisponibilites: [{ jour: 'Lundi', seance: 'S1' }] },
      ],
    }).probleme.taches[0].difficulte;

    expect(avec).toBeGreaterThan(sans);
  });

  it('lève les indisponibilités sur demande explicite', () => {
    const { probleme } = problemeDe({
      taches: [tache()],
      contraintes: [
        { formateur: '15688', espaces: [], indisponibilites: [{ jour: 'Lundi', seance: 'S1' }] },
      ],
      assouplissement: { ignorerIndisponibilites: true },
    });
    expect(probleme.taches[0].creneauxInterdits).toEqual([]);
  });
});

describe('construireProbleme — salles', () => {
  const tache = (type) => ({
    id: 'T1',
    formateurMatricule: '15688',
    groupeLibelle: 'GM101',
    groupes: ['GM101'],
    module: 'M1',
    type,
    seancesRequises: 1,
    priorite: 3,
  });

  it('déclare TEAMS comme salle non réelle', () => {
    const { probleme } = problemeDe({});
    expect(probleme.salles).toContainEqual({ nom: 'TEAMS', reelle: false });
    expect(probleme.salles).toContainEqual({ nom: 'Salle 1', reelle: true });
  });

  it("n'offre que TEAMS à une séance à distance", () => {
    const { probleme } = problemeDe({ taches: [tache(TYPES_COURS.SYNCHRONE)] });
    expect(probleme.taches[0].sallesPossibles).toEqual(['TEAMS']);
  });

  it('offre TOUTES les salles quand aucune n’est attribuée', () => {
    // Une liste vide veut dire « toutes », comme dans l'ancien : rendre une
    // liste vide priverait le formateur de tout créneau.
    const { probleme } = problemeDe({ taches: [tache(TYPES_COURS.PRESENTIEL)] });
    expect(probleme.taches[0].sallesPossibles).toEqual(['Salle 1', 'Salle 2']);
  });

  it('respecte les salles attribuées au formateur', () => {
    const { probleme } = problemeDe({
      taches: [tache(TYPES_COURS.PRESENTIEL)],
      contraintes: [{ formateur: '15688', espaces: ['Salle 2'], indisponibilites: [] }],
    });
    expect(probleme.taches[0].sallesPossibles).toEqual(['Salle 2']);
  });

  it('rend toutes les salles sur assouplissement', () => {
    const { probleme } = problemeDe({
      taches: [tache(TYPES_COURS.PRESENTIEL)],
      contraintes: [{ formateur: '15688', espaces: ['Salle 2'], indisponibilites: [] }],
      assouplissement: { toutesLesSalles: true },
    });
    expect(probleme.taches[0].sallesPossibles).toEqual(['Salle 1', 'Salle 2']);
  });
});

describe('construireProbleme — la salle déclarée pour le module', () => {
  /*
   * ═══ ⚠️ DEUX LISTES, PAS UNE ═══ (2026-09-23)
   * `sallesPossibles` est ce que le solveur a le DROIT d'employer,
   * `sallesPreferees` ce qu'il DEVRAIT employer. Les confondre reviendrait à
   * faire d'une consigne une interdiction — et à perdre les séances que
   * l'atelier ne peut pas absorber, exactement ce que la décision du
   * 2026-09-21 sur les créneaux « à éviter » a renversé.
   */
  const tache = (extra = {}) => ({
    id: 'T1',
    formateurMatricule: '15688',
    groupeLibelle: 'GM101',
    groupes: ['GM101'],
    module: 'M1',
    type: TYPES_COURS.PRESENTIEL,
    seancesRequises: 1,
    priorite: 3,
    ...extra,
  });

  it('met la salle du module EN TÊTE, sans retirer les autres', () => {
    const { probleme } = problemeDe({ taches: [tache({ sallesModule: ['Salle 2'] })] });
    expect(probleme.taches[0].sallesPreferees).toEqual(['Salle 2']);
    expect(probleme.taches[0].sallesPossibles).toEqual(['Salle 2', 'Salle 1']);
  });

  it('LA SALLE DU MODULE L’EMPORTE sur celle du formateur, sans l’exclure', () => {
    /*
     * ⚠️ DÉCISION DU PORTEUR : un atelier est imposé par la MATIÈRE, pas par la
     *    personne qui l'enseigne. La salle du formateur reste néanmoins
     *    possible — sinon l'atelier occupé ferait perdre la séance.
     */
    const { probleme } = problemeDe({
      taches: [tache({ sallesModule: ['Salle 1'] })],
      contraintes: [{ formateur: '15688', espaces: ['Salle 2'], indisponibilites: [] }],
    });
    expect(probleme.taches[0].sallesPreferees).toEqual(['Salle 1']);
    expect(probleme.taches[0].sallesPossibles).toEqual(['Salle 1', 'Salle 2']);
  });

  it('IGNORE une salle qui n’existe plus dans l’établissement', () => {
    /*
     * ⚠️ LA CARTE S'ENREGISTRE PENDANT QUE LE DIRECTEUR CRÉE SES ESPACES : une
     *    salle déclarée puis supprimée ferait poser des séances dans un local
     *    qui n'existe pas — et `lecture.py` refuserait le problème entier.
     */
    const { probleme } = problemeDe({ taches: [tache({ sallesModule: ['Atelier disparu'] })] });
    expect(probleme.taches[0].sallesPreferees).toEqual([]);
    expect(probleme.taches[0].sallesPossibles).toEqual(['Salle 1', 'Salle 2']);
  });

  it('n’impose rien à une séance à distance', () => {
    const { probleme } = problemeDe({
      taches: [tache({ type: TYPES_COURS.SYNCHRONE, sallesModule: ['Salle 2'] })],
    });
    expect(probleme.taches[0].sallesPossibles).toEqual(['TEAMS']);
    expect(probleme.taches[0].sallesPreferees).toEqual([]);
  });

  it('rend les préférées TOUJOURS incluses dans les possibles', () => {
    /*
     * ⚠️ L'INVARIANT QUE `lecture.py` VÉRIFIE À L'AUTRE BOUT : une préférence
     *    hors des possibles fait échouer la génération entière, côté Python.
     *    Mieux vaut que ce test tombe ici.
     */
    for (const cas of [['Salle 1'], ['Salle 2'], ['Salle 1', 'Salle 2'], ['Ailleurs'], []]) {
      const { probleme } = problemeDe({ taches: [tache({ sallesModule: cas })] });
      const { sallesPossibles, sallesPreferees } = probleme.taches[0];
      for (const salle of sallesPreferees) expect(sallesPossibles).toContain(salle);
    }
  });

  it('sans déclaration, ne change RIEN aux salles d’avant', () => {
    const { probleme } = problemeDe({ taches: [tache()] });
    expect(probleme.taches[0].sallesPossibles).toEqual(['Salle 1', 'Salle 2']);
    expect(probleme.taches[0].sallesPreferees).toEqual([]);
  });
});

describe('construireProbleme — incompatibilités et occupation', () => {
  const tache = (id, groupes) => ({
    id,
    formateurMatricule: '15688',
    groupeLibelle: groupes.join(' '),
    groupes,
    module: 'M1',
    type: TYPES_COURS.PRESENTIEL,
    seancesRequises: 1,
    priorite: 3,
  });

  it('relie un groupe FQ à ses constituants', () => {
    /*
     * Ce sont les mêmes stagiaires : sans cette carte, la génération poserait
     * deux cours au même moment pour la même classe.
     */
    const { probleme } = problemeDe({
      taches: [tache('T1', ['ACADA101 (FQ)']), tache('T2', ['GM101'])],
      // Forme réelle du modèle : UN COUPLE PAR LIGNE, pas une liste de composants.
      groupesFq: [
        { groupeFq: 'ACADA101 (FQ)', groupeConstituant: 'GM101' },
        { groupeFq: 'ACADA101 (FQ)', groupeConstituant: 'GM102' },
      ],
    });

    const croisent =
      probleme.incompatibilites['ACADA101 (FQ)']?.includes('GM101') ||
      probleme.incompatibilites.GM101?.includes('ACADA101 (FQ)');
    expect(croisent).toBe(true);
  });

  it('transmet les séances préservées comme créneaux occupés', () => {
    const { probleme } = problemeDe({
      taches: [tache('T1', ['GM101'])],
      aPreserver: [
        {
          jour: 'Lundi',
          seance: 'S1',
          periode: PERIODES.JOUR,
          formateurMatricule: '18494',
          groupe: 'GM102',
          salle: 'Salle 1',
          estEfm: true,
        },
      ],
    });

    expect(probleme.occupation).toHaveLength(1);
    expect(probleme.occupation[0]).toMatchObject({
      formateur: '18494',
      groupes: ['GM102'],
      salle: 'Salle 1',
    });
  });

  it('ne compte pas TEAMS comme salle occupée', () => {
    // Une salle non réelle n'occupe aucun lieu : la réserver empêcherait toute
    // autre séance à distance sur ce créneau.
    const { probleme } = problemeDe({
      taches: [tache('T1', ['GM101'])],
      aPreserver: [
        {
          jour: 'Lundi',
          seance: 'S1',
          periode: PERIODES.JOUR,
          formateurMatricule: '18494',
          groupe: 'GM102',
          salle: 'TEAMS',
        },
      ],
    });
    expect(probleme.occupation[0].salle).toBeNull();
  });

  it('écarte une séance préservée du SOIR, que la génération ne remplit pas', () => {
    const { probleme } = problemeDe({
      taches: [tache('T1', ['GM101'])],
      aPreserver: [
        {
          jour: 'Lundi',
          seance: 'S5',
          periode: PERIODES.SOIR,
          formateurMatricule: '18494',
          groupe: 'GM102',
          salle: 'Salle 1',
        },
      ],
    });
    expect(probleme.occupation).toEqual([]);
  });
});

describe('joursOuverts — le garde de la semaine fermée', () => {
  /*
   * ═══ ⚠️ LE DÉFAUT QUE CE PRÉDICAT EXISTE POUR FERMER ═══ (2026-09-22)
   * `construireProbleme` filtrait `!ferie && !vacances` dans son coin ; le
   * service, lui, ne testait que `taches.length === 0`. Une semaine
   * ENTIÈREMENT fermée dont le chronogramme réclame des cours arrivait donc au
   * solveur sans aucun créneau, et le directeur lisait « creneaux : au moins un
   * créneau est attendu » — un message de Python, sur un écran de gestion.
   *
   * ⚠️ Mesuré sur l'année réelle : la S21 réclame **154 séances pour 0
   *    créneau**. C'est la plus grosse perte de l'année.
   */
  /** La semaine réellement fermée : fériée le lundi, en vacances le reste. */
  const semaineFermee = () => {
    const semaine = semaineOuverte();
    semaine.jours[0].ferie = { libelle: 'Fête du Trône' };
    for (const jour of semaine.jours.slice(1)) jour.vacances = true;
    return semaine;
  };

  it('ne rend AUCUN jour quand la semaine entière est fériée ou en vacances', () => {
    expect(joursOuverts(semaineFermee())).toEqual([]);
  });

  it('le problème construit sur une telle semaine n’a AUCUN créneau', () => {
    /*
     * ⚠️ C'EST EXACTEMENT L'ÉTAT QUI FAISAIT ÉCHOUER PYTHON — « creneaux : au
     *    moins un créneau est attendu ». Le service doit s'arrêter AVANT d'en
     *    arriver là, et c'est ce que `joursOuverts` lui permet de voir.
     */
    const { probleme } = problemeDe({ semaine: semaineFermee(), taches: [] });
    expect(probleme.creneaux).toEqual([]);
  });

  it('garde les jours que la génération peut remplir', () => {
    const semaine = semaineOuverte();
    semaine.jours[0].vacances = true;

    expect(joursOuverts(semaine).map((jour) => jour.jour)).toEqual([
      'Mardi',
      'Mercredi',
      'Jeudi',
      'Vendredi',
      'Samedi',
    ]);
  });

  it('est LE MÊME prédicat que celui du problème construit', () => {
    /*
     * ⚠️ C'EST LA DIVERGENCE ENTRE LES DEUX QUI AVAIT CRÉÉ LE TROU : deux
     *    définitions de « ouvert » à deux endroits, dont une seule consultée
     *    par le service. Si elles se remettaient à diverger, ce test tomberait.
     */
    const semaine = semaineOuverte();
    semaine.jours[1].ferie = { libelle: 'Fête du Trône' };

    const { probleme } = problemeDe({ semaine, taches: [] });
    const joursDuProbleme = new Set(
      probleme.creneaux.map((creneau) => creneau.jour)
    );
    expect([...joursDuProbleme].sort()).toEqual(
      joursOuverts(semaine)
        .map((jour) => jour.jour)
        .sort()
    );
  });
});

describe('groupe absent de la carte ou module non affecté', () => {
  /*
   * ═══ ⚠️ DEUX SITUATIONS, DEUX CORRECTIONS OPPOSÉES ═══ (2026-09-22)
   * Elles arrivaient sous le même message — « aucun formateur ne leur est
   * affecté dans la carte, c'est la carte qu'il faut corriger ». Le porteur
   * l'a signalé sur son établissement : la modale réclamait des affectations
   * pour des groupes qui n'existent nulle part. Mesuré : **les 39 cas étaient
   * des groupes ABSENTS**, et aucun n'était un module non affecté.
   */
  it('dit GROUPE ABSENT quand le groupe n’est dans AUCUNE affectation', () => {
    const { ignorees } = tachesDeLaSemaine({
      chronogrammes: [chrono('GE101 (GC)')],
      affectations: [affectation()],
      numero: SEMAINE,
    });

    expect(ignorees).toHaveLength(1);
    expect(ignorees[0].motif).toBe(MOTIFS_IGNOREE.GROUPE_ABSENT);
  });

  it('dit MODULE NON AFFECTÉ quand le groupe existe mais pas ce module-là', () => {
    const { ignorees } = tachesDeLaSemaine({
      chronogrammes: [chrono('GM101', 'M-AUTRE')],
      affectations: [affectation()],
      numero: SEMAINE,
    });

    expect(ignorees[0].motif).toBe(MOTIFS_IGNOREE.MODULE_NON_AFFECTE);
  });

  it('NE DÉCLARE PAS absent un groupe que la carte porte dans une FUSION', () => {
    /*
     * ⚠️ LE PIÈGE DE CETTE DISTINCTION. La carte écrit « OPCM101 OPCM102 » en
     *    un seul libellé ; un chronogramme sur « OPCM101 » seul doit donc être
     *    reconnu. Sans `separerFusion`, on conseillerait de supprimer un
     *    chronogramme parfaitement valide — et le directeur perdrait des heures
     *    en suivant notre conseil.
     */
    const { ignorees } = tachesDeLaSemaine({
      chronogrammes: [chrono('OPCM101', 'M-AUTRE')],
      affectations: [affectation({ groupe: 'OPCM101 OPCM102' })],
      numero: SEMAINE,
    });

    expect(ignorees[0].motif).toBe(MOTIFS_IGNOREE.MODULE_NON_AFFECTE);
  });

  it('apparie sans tenir compte de la casse', () => {
    // Les noms viennent de deux imports différents : l'un peut être en minuscules.
    const { ignorees } = tachesDeLaSemaine({
      chronogrammes: [chrono('gm101', 'M-AUTRE')],
      affectations: [affectation()],
      numero: SEMAINE,
    });

    expect(ignorees[0].motif).toBe(MOTIFS_IGNOREE.MODULE_NON_AFFECTE);
  });
});

describe('un groupe DÉCLARÉ dans la carte n’est jamais « absent »', () => {
  /*
   * ═══ ⚠️⚠️ LE DÉFAUT QUE CE TEST EXISTE POUR INTERDIRE ═══ (2026-09-22)
   * La première version du classement ne lisait que les AFFECTATIONS. Un
   * groupe déclaré dans la carte mais dont aucun module n'est encore attribué
   * passait donc pour « absent de la carte », et l'écran conseillait de
   * **supprimer son chronogramme** — alors qu'il suffisait d'affecter ses
   * modules.
   *
   * ⚠️ DÉTRUIRE LA PLANIFICATION D'UN GROUPE VIVANT SUR UN MAUVAIS DIAGNOSTIC
   *    est le pire dégât que cet écran puisse causer : le conseil précède le
   *    geste, et le geste est irréversible.
   */
  it('le dit MODULE NON AFFECTÉ, même sans la moindre affectation', () => {
    const { ignorees } = tachesDeLaSemaine({
      chronogrammes: [chrono('PM102')],
      affectations: [affectation()],
      groupes: ['GM101', 'PM102'],
      numero: SEMAINE,
    });

    expect(ignorees[0].motif).toBe(MOTIFS_IGNOREE.MODULE_NON_AFFECTE);
  });

  it('reste ABSENT quand il n’est NI déclaré NI affecté', () => {
    // L'autre moitié : sans elle, il suffirait de tout déclarer présent.
    const { ignorees } = tachesDeLaSemaine({
      chronogrammes: [chrono('GE101 (GC)')],
      affectations: [affectation()],
      groupes: ['GM101', 'PM102'],
      numero: SEMAINE,
    });

    expect(ignorees[0].motif).toBe(MOTIFS_IGNOREE.GROUPE_ABSENT);
  });

  it('reconnaît un groupe déclaré à l’intérieur d’une FUSION', () => {
    const { ignorees } = tachesDeLaSemaine({
      chronogrammes: [chrono('SMP202')],
      affectations: [affectation()],
      groupes: ['SMP201 SMP202'],
      numero: SEMAINE,
    });

    expect(ignorees[0].motif).toBe(MOTIFS_IGNOREE.MODULE_NON_AFFECTE);
  });
});
