/**
 * Le mémo qui remplace 362 requêtes par une.
 *
 * ⚠️ IL RÉPOND À LA PLACE DE LA BASE sur deux contrôles qui REFUSENT des
 *    séances : le quota d'un module et le conflit de créneau. Une réponse trop
 *    pauvre laisse passer un dépassement ; une réponse trop riche refuse une
 *    pose légitime. Les deux sens comptent, et les deux sont ici.
 */

import { describe, expect, it } from 'vitest';

import { memoPose } from '../../src/modules/generation/memoPose.js';

/** Un faux modèle Mongoose : `find().select().session().lean()`. */
function fausseCollection(documents) {
  let appels = 0;
  const chaine = {
    select: () => chaine,
    session: () => chaine,
    lean: async () => documents,
  };
  return {
    find: () => {
      appels += 1;
      return chaine;
    },
    get appels() {
      return appels;
    },
  };
}

const seance = (extra = {}) => ({
  _id: `id-${Math.random()}`,
  semaine: '2026-W3',
  jour: 'Lundi',
  seance: 'S1',
  periode: 'jour',
  groupe: 'GM101',
  module: 'M101',
  salle: 'A1',
  statut: 'planifie',
  ...extra,
});

describe('memoPose', () => {
  it('ne lit la base QU’UNE fois', async () => {
    // ⚠️ C'est toute la raison d'être : 362 requêtes remplacées par une.
    const Seance = fausseCollection([seance(), seance({ module: 'M202' })]);
    const memo = await memoPose(Seance, 'e1', 2026, null);

    memo.obtenirSeancesDuModule('M101');
    memo.obtenirSeancesDuModule('M202');
    memo.obtenirSurLeCreneau('2026-W3', 'Lundi', 'S1', 'jour');

    expect(Seance.appels).toBe(1);
  });

  it('range par module et par créneau', async () => {
    const memo = await memoPose(
      fausseCollection([
        seance({ module: 'M101', jour: 'Lundi' }),
        seance({ module: 'M101', jour: 'Mardi' }),
        seance({ module: 'M202', jour: 'Lundi' }),
      ]),
      'e1',
      2026,
      null
    );

    expect(memo.obtenirSeancesDuModule('M101')).toHaveLength(2);
    expect(memo.obtenirSurLeCreneau('2026-W3', 'Lundi', 'S1', 'jour')).toHaveLength(2);
  });

  it('rend une liste VIDE pour un module ou un créneau inconnu', async () => {
    // ⚠️ `undefined` ferait planter le décompte du quota, pas refuser la séance.
    const memo = await memoPose(fausseCollection([]), 'e1', 2026, null);
    expect(memo.obtenirSeancesDuModule('INCONNU')).toEqual([]);
    expect(memo.obtenirSurLeCreneau('2026-W3', 'Lundi', 'S1', 'jour')).toEqual([]);
  });

  it('COMPTE la séance qu’on vient de poser', async () => {
    /*
     * ═══ ⚠️ LE DÉFAUT QUE CE TEST INTERDIT ═══
     * Sans `noter`, le mémo resterait figé sur l'état d'avant la génération :
     * les 181 séances posées ne compteraient dans AUCUN quota, et la carte
     * laisserait poser bien plus d'heures qu'elle n'en accorde. Le défaut ne se
     * verrait qu'en mai, sur un module deux fois trop fourni.
     */
    const memo = await memoPose(fausseCollection([]), 'e1', 2026, null);
    expect(memo.obtenirSeancesDuModule('M101')).toHaveLength(0);

    memo.noter(seance());

    expect(memo.obtenirSeancesDuModule('M101')).toHaveLength(1);
    expect(memo.obtenirSurLeCreneau('2026-W3', 'Lundi', 'S1', 'jour')).toHaveLength(1);
  });

  it('REMPLACE au lieu d’ajouter quand la même séance est réécrite', async () => {
    /*
     * ⚠️ `poser()` est un UPSERT : corriger la salle d'une séance déjà posée la
     *    fait repasser ici. La compter deux fois ferait refuser la suivante
     *    pour un quota qui n'est pas atteint.
     */
    const memo = await memoPose(fausseCollection([]), 'e1', 2026, null);
    const originale = seance();

    memo.noter(originale);
    memo.noter({ ...originale, salle: 'B2' });

    expect(memo.obtenirSeancesDuModule('M101')).toHaveLength(1);
    expect(memo.obtenirSeancesDuModule('M101')[0].salle).toBe('B2');
  });

  it('suit une séance qui CHANGE de créneau', async () => {
    // Elle doit quitter l'ancien créneau, sans quoi il resterait faussement occupé.
    const memo = await memoPose(fausseCollection([]), 'e1', 2026, null);
    const originale = seance();

    memo.noter(originale);
    memo.noter({ ...originale, jour: 'Mardi' });

    expect(memo.obtenirSurLeCreneau('2026-W3', 'Lundi', 'S1', 'jour')).toHaveLength(0);
    expect(memo.obtenirSurLeCreneau('2026-W3', 'Mardi', 'S1', 'jour')).toHaveLength(1);
  });

  it('ignore un appel sans séance', async () => {
    const memo = await memoPose(fausseCollection([]), 'e1', 2026, null);
    expect(() => memo.noter(null)).not.toThrow();
    expect(() => memo.noter(undefined)).not.toThrow();
  });
});

describe('memoPose — les absences de formateur (2026-09-28)', () => {
  /** Faux `AbsenceFormateur` : `find().session()` rend les documents. */
  const fauxRegistre = (documents) => {
    let appels = 0;
    return {
      find: () => {
        appels += 1;
        return { session: async () => documents };
      },
      get appels() {
        return appels;
      },
    };
  };
  const cle = {
    etablissementId: 'e1',
    semaine: '2026-W3',
    jour: 'Lundi',
    seance: 'S1',
    formateurMatricule: '9863',
  };

  it('répond ce que `findOne(cle)` aurait rendu, en UNE lecture', async () => {
    const absence = { _id: 'a1', ...cle };
    const Absences = fauxRegistre([absence]);
    const memo = await memoPose(fausseCollection([]), 'e1', 2026, null, Absences);

    expect(memo.obtenirAbsence(cle)).toBe(absence);
    expect(memo.obtenirAbsence({ ...cle, seance: 'S2' })).toBeNull();
    expect(memo.obtenirAbsence({ ...cle, formateurMatricule: 'AUTRE' })).toBeNull();
    expect(Absences.appels).toBe(1);
  });

  it('suit ce que `synchroniser` supprime ou crée', async () => {
    const memo = await memoPose(fausseCollection([]), 'e1', 2026, null, fauxRegistre([{ _id: 'a1', ...cle }]));

    memo.noterAbsence(cle, null);
    expect(memo.obtenirAbsence(cle)).toBeNull();

    const creee = { _id: 'a2', ...cle };
    memo.noterAbsence(cle, creee);
    expect(memo.obtenirAbsence(cle)).toBe(creee);
  });

  it('⚠️ sans le modèle, ne répond RIEN (`undefined`) : la base est interrogée comme avant', async () => {
    const memo = await memoPose(fausseCollection([]), 'e1', 2026, null);
    expect(memo.obtenirAbsence(cle)).toBeUndefined();
  });
});
