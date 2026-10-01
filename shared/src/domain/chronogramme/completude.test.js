import { describe, expect, it } from 'vitest';

import {
  cleSemaineChronogramme,
  completudeSemaine,
  poseDeLaSemaine,
  prevuDeLaSemaine,
  retraitRapprocheDuPlan,
  tauxConformite,
} from './completude.js';

/** Un chronogramme minimal : un groupe, un module, une cellule. */
const chrono = (groupe, module, semaine, heures, type = 'P') => ({
  groupe,
  planning: new Map([[module, [{ semaine, heures, type }]]]),
});

/** Une séance de la grille. `salle: 'TEAMS'` la rend synchrone. */
const seance = (groupe, module, extra = {}) => ({
  groupe,
  module,
  seance: 'S1',
  salle: 'A12',
  formateurMatricule: '9863',
  statut: 'planifie',
  ...extra,
});

const CONNUS = (...noms) => new Set(noms.map((n) => n.toUpperCase()));

describe('cleSemaineChronogramme', () => {
  it('traduit le numéro de semaine en clé de chronogramme', () => {
    expect(cleSemaineChronogramme(9)).toBe('S9');
    expect(cleSemaineChronogramme('12')).toBe('S12');
  });
});

describe('tauxConformite', () => {
  it('rend 100 quand le posé est exactement le prévu', () => {
    expect(tauxConformite(10, 10, 10)).toBe(100);
  });

  it('⚠️ FAIT BAISSER LE TAUX SUR UN DÉPASSEMENT, pas seulement sur un manque', () => {
    /*
     * C'est le défaut que l'ancien portait : `couvert / prévu` affichait 100 %
     * avec des heures hors plan. Une séance de trop consomme pourtant des
     * heures que le module n'a pas.
     */
    expect(tauxConformite(10, 10, 12.5)).toBe(75);
    // Symétrique : 2,5 h manquantes coûtent autant que 2,5 h en trop.
    expect(tauxConformite(10, 7.5, 7.5)).toBe(75);
  });

  it('ne dépasse jamais 100 et ne descend jamais sous 0', () => {
    expect(tauxConformite(10, 10, 100)).toBe(0);
    expect(tauxConformite(1, 1, 1)).toBe(100);
  });

  it('⚠️ rend null — jamais 0 — quand rien n’est prévu', () => {
    // Sans référence, 0 % ferait passer pour un retard ce qui n'est qu'une
    // absence de plan.
    expect(tauxConformite(0, 0, 5)).toBeNull();
  });
});

describe('prevuDeLaSemaine', () => {
  it('ne retient que la semaine demandée', () => {
    const lignes = [
      { groupe: 'GM101', planning: new Map([['M101', [
        { semaine: 'S9', heures: 5, type: 'P' },
        { semaine: 'S10', heures: 2.5, type: 'P' },
      ]]]) },
    ];
    const { prevu } = prevuDeLaSemaine(lignes, 'S9');
    expect([...prevu.values()]).toEqual([5]);
  });

  it('ignore une cellule à zéro heure', () => {
    // Une ligne peut exister avec un planning vide — c'est le cas après une
    // réinitialisation. « Enregistré » n'est pas « planifié ».
    const { prevu } = prevuDeLaSemaine([chrono('GM101', 'M101', 'S9', 0)], 'S9');
    expect(prevu.size).toBe(0);
  });

  it('SÉPARE le présentiel du synchrone pour un même module', () => {
    const lignes = [
      { groupe: 'GM101', planning: new Map([['M101', [
        { semaine: 'S9', heures: 5, type: 'P' },
        { semaine: 'S9', heures: 2.5, type: 'S' },
      ]]]) },
    ];
    const { prevu } = prevuDeLaSemaine(lignes, 'S9');
    expect(prevu.get('GM101||M101||presentiel')).toBe(5);
    expect(prevu.get('GM101||M101||synchrone')).toBe(2.5);
  });

  it('accepte un planning en objet nu, comme le rend `.lean()`', () => {
    // ⚠️ Mongoose rend un champ `Map` en objet simple sous `.lean()` — piège
    //    déjà payé sur `sallesAffectations` le 2026-09-23.
    const { prevu } = prevuDeLaSemaine(
      [{ groupe: 'GM101', planning: { M101: [{ semaine: 'S9', heures: 5, type: 'P' }] } }],
      'S9'
    );
    expect(prevu.get('GM101||M101||presentiel')).toBe(5);
  });
});

describe('poseDeLaSemaine', () => {
  it('compte 2,5 h en journée et 2 h le soir', () => {
    /*
     * ⚠️ L'ancien `get_completude.php` comptait 2,5 h partout, S5 compris —
     *    son propre voisin qualifie cela de « défaut préexistant ». Le taux
     *    diffère donc de l'ancien sur les semaines à séances du soir.
     */
    const { pose } = poseDeLaSemaine([
      seance('GM101', 'M101'),
      seance('GM101', 'M101', { seance: 'S5', periode: 'soir' }),
    ]);
    expect(pose.get('GM101||M101||presentiel')).toBe(4.5);
  });

  it('⚠️ une séance ABSENTE reste POSÉE, et elle est comptée à part', () => {
    // Le formateur absent occupe bien le créneau : la séance est placée, elle
    // n'a pas été donnée. La retirer creuserait un manque qui n'existe pas.
    const { pose, absences } = poseDeLaSemaine([seance('GM101', 'M101', { statut: 'absent' })]);
    expect(pose.get('GM101||M101||presentiel')).toBe(2.5);
    expect(absences.get('GM101||M101||presentiel')).toBe(2.5);
  });

  it('⚠️ une séance FUSIONNÉE compte pour CHACUN de ses groupes', () => {
    // Elle est donnée une fois mais couvre les deux, et le chronogramme est
    // tenu par groupe.
    const { pose } = poseDeLaSemaine([seance('GM101 GM102', 'M101')]);
    expect(pose.get('GM101||M101||presentiel')).toBe(2.5);
    expect(pose.get('GM102||M101||presentiel')).toBe(2.5);
  });

  it('ne coupe PAS un suffixe entre parenthèses', () => {
    // « ACADA101 (FQ) » est UN groupe, pas deux.
    const { pose } = poseDeLaSemaine([seance('ACADA101 (FQ)', 'M101')]);
    expect([...pose.keys()]).toEqual(['ACADA101 (FQ)||M101||presentiel']);
  });

  it('range TEAMS en synchrone', () => {
    const { pose } = poseDeLaSemaine([seance('GM101', 'M101', { salle: 'TEAMS' })]);
    expect(pose.get('GM101||M101||synchrone')).toBe(2.5);
  });
});

describe('completudeSemaine', () => {
  const base = (extra = {}) => ({
    semaineChrono: 'S9',
    groupesConnus: CONNUS('GM101'),
    ...extra,
  });

  it('ne signale rien quand le posé correspond au prévu', () => {
    const bilan = completudeSemaine(base({
      chronogrammes: [chrono('GM101', 'M101', 'S9', 5)],
      seances: [seance('GM101', 'M101'), seance('GM101', 'M101')],
    }));

    expect(bilan.total.taux).toBe(100);
    expect(bilan.ecarts).toEqual([]);
    expect(bilan.groupes[0].conforme).toBe(true);
  });

  it('nomme une séance MANQUANTE et le formateur AFFECTÉ', () => {
    const bilan = completudeSemaine(base({
      chronogrammes: [chrono('GM101', 'M101', 'S9', 5)],
      seances: [seance('GM101', 'M101')],
      formateurParModule: new Map([['GM101||M101||presentiel', 'AHMED CHERKAOUI']]),
    }));

    expect(bilan.ecarts).toHaveLength(1);
    expect(bilan.ecarts[0]).toMatchObject({
      groupe: 'GM101',
      module: 'M101',
      nature: 'manquante',
      prevu: 5,
      pose: 2.5,
      ecart: -2.5,
      formateur: 'AHMED CHERKAOUI',
    });
  });

  it('⚠️ pour une séance EN TROP, nomme celui qui la PORTE, pas l’affecté', () => {
    /*
     * Les deux ne coïncident pas forcément, et c'est chez le porteur qu'il faut
     * aller la retirer. Donner le mauvais nom enverrait chercher au mauvais
     * endroit.
     */
    const bilan = completudeSemaine(base({
      chronogrammes: [chrono('GM101', 'M101', 'S9', 2.5)],
      seances: [seance('GM101', 'M101'), seance('GM101', 'M101', { formateurMatricule: '10241' })],
      formateurParModule: new Map([['GM101||M101||presentiel', 'AHMED CHERKAOUI']]),
      nomsFormateurs: new Map([['9863', 'AHMED CHERKAOUI'], ['10241', 'FATIMA BENALI']]),
    }));

    expect(bilan.ecarts[0].nature).toBe('en_trop');
    expect(bilan.ecarts[0].formateur).toBe('AHMED CHERKAOUI · FATIMA BENALI');
  });

  it('distingue « hors chronogramme » d’une simple séance en trop', () => {
    // Trois natures, parce qu'elles n'appellent pas la même suite : compléter,
    // retirer, ou vérifier le chronogramme d'où ce module ne devrait pas sortir.
    const bilan = completudeSemaine(base({
      chronogrammes: [],
      seances: [seance('GM101', 'M999')],
    }));

    expect(bilan.ecarts[0].nature).toBe('hors_chronogramme');
    expect(bilan.total.taux).toBeNull();
  });

  it('⚠️ un module prévu en PRÉSENTIEL et posé en SYNCHRONE n’est PAS conforme', () => {
    /*
     * ═══ DIVERGENCE ASSUMÉE AVEC L'ANCIEN ═══
     * `get_completude.php` additionne les deux natures et affiche « conforme ».
     * Or une heure à distance ne remplace pas une heure en salle : c'est déjà
     * la règle du quota du serveur — « CHAQUE TYPE A SON QUOTA ».
     */
    const bilan = completudeSemaine(base({
      chronogrammes: [chrono('GM101', 'M101', 'S9', 2.5, 'P')],
      seances: [seance('GM101', 'M101', { salle: 'TEAMS' })],
    }));

    expect(bilan.ecarts).toHaveLength(2);
    expect(bilan.ecarts.map((e) => e.nature).sort()).toEqual(['hors_chronogramme', 'manquante']);
  });

  it('⚠️ NOMME un groupe absent de la carte sans le compter dans le taux', () => {
    /*
     * Le taire laisserait un chronogramme fantôme vivre indéfiniment ; le
     * compter donnerait un manque que rien ne peut combler — le groupe n'a
     * plus d'affectation.
     */
    const bilan = completudeSemaine(base({
      chronogrammes: [chrono('GM101', 'M101', 'S9', 5), chrono('DISPARU', 'M200', 'S9', 10)],
      seances: [seance('GM101', 'M101'), seance('GM101', 'M101')],
    }));

    expect(bilan.total.taux).toBe(100);
    expect(bilan.inconnus).toEqual([{ groupe: 'DISPARU', prevu: 10, pose: 0 }]);
    expect(bilan.groupes.map((g) => g.groupe)).toEqual(['GM101']);
  });

  it('classe les groupes les MOINS conformes en tête, l’anomalie avant les conformes', () => {
    const bilan = completudeSemaine({
      semaineChrono: 'S9',
      groupesConnus: CONNUS('BON', 'MOYEN', 'SANS_PLAN'),
      chronogrammes: [chrono('BON', 'M1', 'S9', 2.5), chrono('MOYEN', 'M2', 'S9', 5)],
      seances: [seance('BON', 'M1'), seance('MOYEN', 'M2'), seance('SANS_PLAN', 'M3')],
    });

    // `SANS_PLAN` n'a pas de référence (taux null) : c'est une anomalie, elle
    // passe avant le conforme.
    expect(bilan.groupes.map((g) => g.groupe)).toEqual(['SANS_PLAN', 'MOYEN', 'BON']);
  });

  it('distingue le TAUX de la RÉALISATION — l’un plafonne, l’autre non', () => {
    const bilan = completudeSemaine(base({
      chronogrammes: [chrono('GM101', 'M101', 'S9', 2.5)],
      seances: [seance('GM101', 'M101'), seance('GM101', 'M101')],
    }));

    expect(bilan.total.taux).toBe(0); // 2,5 h en trop sur 2,5 h prévues
    expect(bilan.total.realisation).toBe(200); // le volume posé, lui, peut dépasser
  });

  it('compte les séances de la grille, fusions comprises', () => {
    const bilan = completudeSemaine(base({
      chronogrammes: [chrono('GM101', 'M101', 'S9', 2.5)],
      seances: [seance('GM101 GM102', 'M101')],
      groupesConnus: CONNUS('GM101', 'GM102'),
    }));

    // Une séance dans la grille, mais deux groupes servis.
    expect(bilan.total.seancesGrille).toBe(1);
    expect(bilan.groupes).toHaveLength(2);
  });

  it('ne lève pas sur des entrées vides', () => {
    const bilan = completudeSemaine();
    expect(bilan.total.taux).toBeNull();
    expect(bilan.groupes).toEqual([]);
    expect(bilan.ecarts).toEqual([]);
  });
});

describe('completudeSemaine — où sont les séances à retirer (2026-09-27)', () => {
  it('donne les cases d’une séance hors chronogramme, pas celles d’une manquante', () => {
    const bilan = completudeSemaine({
      chronogrammes: [chrono('GM101', 'M101', 'S9', 2.5)],
      seances: [seance('GM101', 'M102', { jour: 'Mardi', seance: 'S3' })],
      semaineChrono: 'S9',
      groupesConnus: CONNUS('GM101'),
    });
    const hors = bilan.ecarts.find((e) => e.nature === 'hors_chronogramme');
    const manque = bilan.ecarts.find((e) => e.nature === 'manquante');
    expect(hors.positions).toEqual([
      {
        jour: 'Mardi',
        seance: 'S3',
        periode: 'jour',
        formateurMatricule: '9863',
        groupe: 'GM101',
        retirable: true,
      },
    ]);
    expect(manque.positions).toEqual([]);
  });

  it('une séance fusionnée garde son libellé de grille', () => {
    const bilan = completudeSemaine({
      chronogrammes: [],
      seances: [seance('GM101 GM102', 'M102', { jour: 'Lundi' })],
      semaineChrono: 'S9',
      groupesConnus: CONNUS('GM101', 'GM102'),
    });
    expect(bilan.ecarts.map((e) => e.positions[0].groupe)).toEqual(['GM101 GM102', 'GM101 GM102']);
  });
});

describe('retraitRapprocheDuPlan — la suppression permise sous verrou', () => {
  const S = 'S3';

  it('permet de retirer une séance EN TROP quand le retrait ne crée aucun manque', () => {
    // Prévu 5 h, posé 7,5 h : une séance de 2,5 h est de trop.
    const seances = [seance('AA101', 'M101'), seance('AA101', 'M101', { seance: 'S3' }), seance('AA101', 'M101', { seance: 'S4' })];
    const entrees = { chronogrammes: [chrono('AA101', 'M101', S, 5)], seances, semaineChrono: S };
    expect(retraitRapprocheDuPlan(seances[0], entrees)).toBe(true);
  });

  it('⚠️ refuse un retrait qui creuserait un manque', () => {
    // Prévu 5 h, posé 5 h : rien n'est de trop.
    const seances = [seance('AA101', 'M101'), seance('AA101', 'M101', { seance: 'S3' })];
    const entrees = { chronogrammes: [chrono('AA101', 'M101', S, 5)], seances, semaineChrono: S };
    expect(retraitRapprocheDuPlan(seances[0], entrees)).toBe(false);

    // Prévu 4 h, posé 5 h : 1 h de trop ne justifie pas de retirer 2,5 h.
    const partiel = { ...entrees, chronogrammes: [chrono('AA101', 'M101', S, 4)] };
    expect(retraitRapprocheDuPlan(seances[0], partiel)).toBe(false);
  });

  it('permet toujours de retirer une séance HORS CHRONOGRAMME', () => {
    const seances = [seance('AA101', 'M999')];
    const entrees = { chronogrammes: [chrono('AA101', 'M101', S, 5)], seances, semaineChrono: S };
    expect(retraitRapprocheDuPlan(seances[0], entrees)).toBe(true);
  });

  it('⚠️ une séance fusionnée doit être de trop pour CHAQUE groupe', () => {
    const fusion = seance('GM101 GM102', 'M101');
    const seances = [fusion, seance('GM101', 'M101', { seance: 'S3' })];
    const chronogrammes = [chrono('GM101', 'M101', S, 2.5), chrono('GM102', 'M101', S, 2.5)];
    // GM101 a 5 h pour 2,5 prévues, mais GM102 n'a que ses 2,5 h : refusé.
    expect(retraitRapprocheDuPlan(fusion, { chronogrammes, seances, semaineChrono: S })).toBe(false);
  });

  it('marque `retirable` sur les positions du bilan', () => {
    const seances = [seance('AA101', 'M101'), seance('AA101', 'M101', { seance: 'S3' })];
    const bilan = completudeSemaine({
      chronogrammes: [chrono('AA101', 'M101', S, 2.5)],
      seances,
      semaineChrono: S,
      groupesConnus: CONNUS('AA101'),
    });
    expect(bilan.ecarts[0].positions.every((p) => p.retirable)).toBe(true);
  });
});
