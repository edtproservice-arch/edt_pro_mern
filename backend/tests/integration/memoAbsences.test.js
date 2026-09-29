import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';

import { AbsenceFormateur } from '../../src/models/AbsenceFormateur.js';
import { Base } from '../../src/models/Base.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Seance } from '../../src/models/Seance.js';
import { User } from '../../src/models/User.js';
import { oublierMemoire } from '../../src/modules/calendrier/joursFeries.service.js';
import { chargerCommun } from '../../src/modules/generation/donnees.js';
import { memoPose } from '../../src/modules/generation/memoPose.js';
import { poser } from '../../src/modules/seances/seances.service.js';

/**
 * La vérification d'absence de `synchroniser()` passe par la mémoire de
 * transaction (2026-09-28) — ~10 s de moins par semaine générée.
 *
 * ⚠️ CE QUI EST GARDÉ ICI : le RÉSULTAT est celui d'avant. Une absence présente
 *    sur le créneau est bien effacée quand la génération y pose une séance
 *    planifiée, et une requête `absenceformateurs.findOne` n'est plus émise.
 */
const ANNEE = 2026;
const SEMAINE = `${ANNEE}-W9`;
const MATRICULE = '9863';
let etablissement;

beforeEach(async () => {
  oublierMemoire();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
  const directeur = await User.create({
    nomComplet: 'Directeur Test',
    email: 'directeur@edtpro.ma',
    motDePasse: 'MotDePasse2026',
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
  etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Test',
    nom: 'ISTA Test',
    anneeScolaire: ANNEE,
    espaces: ['A12'],
  });
  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [{ matricule: MATRICULE, nomComplet: 'BRAHIM LOURID', masseHoraire: 1000 }],
    groupes: ['GM101'],
    affectations: [
      { formateur: MATRICULE, groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 60 },
    ],
  });
});

/** Pose DANS une transaction, avec la précharge de la génération. */
async function poserCommeLaGeneration(donnees, { avecAbsences }) {
  const commun = await chargerCommun(etablissement.id, ANNEE);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const precharge = {
        ...commun.prechargePoser,
        ...(await memoPose(
          Seance,
          etablissement.id,
          ANNEE,
          session,
          avecAbsences ? AbsenceFormateur : null
        )),
      };
      for (const d of donnees) {
        await poser(etablissement.id, ANNEE, SEMAINE, d, { session, precharge, verrou: false });
      }
    });
  } finally {
    await session.endSession();
  }
}

const donnees = (extra = {}) => ({
  jour: 'Lundi',
  seance: 'S1',
  periode: 'jour',
  formateurMatricule: MATRICULE,
  groupe: 'GM101',
  module: 'M101',
  salle: 'A12',
  statut: 'planifie',
  ...extra,
});

describe('synchroniser() par la mémoire de transaction', () => {
  it('efface l’absence du créneau — le même résultat qu’avant', async () => {
    await AbsenceFormateur.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      semaine: SEMAINE,
      jour: 'Lundi',
      seance: 'S1',
      formateurMatricule: MATRICULE,
      groupe: 'GM101',
      module: 'M101',
      dateAbsence: new Date(`${ANNEE}-11-02T00:00:00.000Z`),
    });

    await poserCommeLaGeneration([donnees()], { avecAbsences: true });

    expect(await AbsenceFormateur.countDocuments()).toBe(0);
    expect(await Seance.countDocuments()).toBe(1);
  });

  it('garde les absences des AUTRES créneaux', async () => {
    await AbsenceFormateur.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      semaine: SEMAINE,
      jour: 'Mardi',
      seance: 'S3',
      formateurMatricule: MATRICULE,
      groupe: 'GM101',
      module: 'M101',
      dateAbsence: new Date(`${ANNEE}-11-03T00:00:00.000Z`),
    });

    await poserCommeLaGeneration([donnees(), donnees({ seance: 'S2' })], { avecAbsences: true });

    expect(await AbsenceFormateur.countDocuments()).toBe(1);
  });

  it('⚠️ n’interroge plus la base à chaque pose', async () => {
    const espion = vi.spyOn(AbsenceFormateur, 'findOne');

    await poserCommeLaGeneration(
      [donnees(), donnees({ seance: 'S2' }), donnees({ jour: 'Mardi' })],
      { avecAbsences: true }
    );
    expect(espion).not.toHaveBeenCalled();

    // Sans la mémoire, la requête revient : c'est bien elle qui l'évitait.
    await Seance.deleteMany({});
    await poserCommeLaGeneration([donnees({ jour: 'Jeudi' })], { avecAbsences: false });
    expect(espion).toHaveBeenCalledTimes(1);
    espion.mockRestore();
  });
});
