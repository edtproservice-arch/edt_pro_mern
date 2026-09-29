import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { JOURS, ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';

import { createApp } from '../../src/app.js';
import { AutoGenConfig } from '../../src/models/AutoGenConfig.js';
import { Base } from '../../src/models/Base.js';
import { Chronogramme } from '../../src/models/Chronogramme.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Seance } from '../../src/models/Seance.js';
import { User } from '../../src/models/User.js';
import { oublierMemoire } from '../../src/modules/calendrier/joursFeries.service.js';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Placer les séances « À placer » de la fenêtre de conformité (2026-09-27).
 *
 * ═══ CE QUE CETTE SUITE GARDE ═══
 *  · la simulation N'ÉCRIT RIEN, et annonce pourtant ce que l'écriture fera ;
 *  · rien de ce qui est déjà posé ne bouge — on COMPLÈTE, on ne régénère pas ;
 *  · les trois niveaux : libre / à éviter, sans salle, non placée ;
 *  · dissocié, le chronogramme ne fait plus foi : le geste est refusé.
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;
const SEMAINE = `${ANNEE}-W9`;
const MATRICULE = '9863';
const CRENEAUX = ['S1', 'S2', 'S3', 'S4'];

let etablissement;
let cookies;

beforeEach(async () => {
  oublierMemoire();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

  const directeur = await User.create({
    nomComplet: 'Directeur Test',
    email: 'directeur@edtpro.ma',
    motDePasse: MOT_DE_PASSE,
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });

  etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Test',
    anneeScolaire: ANNEE,
    espaces: ['A12', 'B1'],
  });
  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [
      { matricule: MATRICULE, nomComplet: 'BRAHIM LOURID', masseHoraire: 1000 },
      { matricule: '4211', nomComplet: 'SAID AMMARI', masseHoraire: 1000 },
    ],
    groupes: ['GM101', 'GM102'],
    affectations: [
      { formateur: MATRICULE, groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 60 },
      { formateur: MATRICULE, groupe: 'GM102', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 60 },
      { formateur: '4211', groupe: 'GM102', module: 'M102', type: TYPES_COURS.PRESENTIEL, s1Heures: 200 },
    ],
  });

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookies = connexion.headers['set-cookie'];
});

const planifier = (groupe, module, heures) =>
  Chronogramme.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    groupe,
    planning: new Map([[module, [{ semaine: 'S9', heures, type: 'P' }]]]),
  });

const seance = (extra = {}) => ({
  etablissementId: etablissement.id,
  anneeScolaire: ANNEE,
  semaine: SEMAINE,
  jour: 'Lundi',
  date: new Date(`${ANNEE}-11-02T00:00:00.000Z`),
  seance: 'S1',
  formateurMatricule: MATRICULE,
  groupe: 'GM101',
  module: 'M101',
  salle: 'A12',
  statut: 'planifie',
  ...extra,
});

/** Une séance sur CHAQUE créneau de jour de la semaine. */
const partout = (extra) =>
  Seance.create(JOURS.flatMap((jour) => CRENEAUX.map((s) => seance({ jour, seance: s, ...extra }))));

const placer = (corps = {}) =>
  request(app)
    .post('/api/v2/chronogrammes/completude/placer')
    .set('Cookie', cookies)
    .send({ semaine: SEMAINE, ...corps });

describe('Placer les séances manquantes (2026-09-27)', () => {
  it('SIMULE par défaut : annonce le placement sans rien écrire', async () => {
    await planifier('GM101', 'M101', 5);
    await Seance.create(seance());

    const reponse = await placer();

    expect(reponse.status).toBe(200);
    expect(reponse.body.simulation).toBe(true);
    expect(reponse.body.placees).toHaveLength(1);
    expect(reponse.body.placees[0]).toMatchObject({
      groupe: 'GM101',
      module: 'M101',
      formateur: 'BRAHIM LOURID',
      niveau: 'libre',
    });
    expect(await Seance.countDocuments()).toBe(1);
  });

  it('écrit sur demande, sans déplacer ce qui est posé, et la semaine devient conforme', async () => {
    await planifier('GM101', 'M101', 5);
    const existante = await Seance.create(seance());

    const reponse = await placer({ simulation: false });

    expect(reponse.status).toBe(200);
    expect(reponse.body.total.placees).toBe(1);
    expect(await Seance.countDocuments()).toBe(2);
    const inchangee = await Seance.findById(existante.id).lean();
    expect(inchangee).toMatchObject({ jour: 'Lundi', seance: 'S1', salle: 'A12' });

    const bilan = await request(app)
      .get(`/api/v2/chronogrammes/completude?semaine=${SEMAINE}`)
      .set('Cookie', cookies);
    expect(bilan.body.total.taux).toBe(100);
  });

  it('se résout à un créneau « à éviter » quand il n’y a rien d’autre, et le dit', async () => {
    await planifier('GM101', 'M101', 2.5);
    await AutoGenConfig.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      contraintes: [
        {
          formateur: MATRICULE,
          espaces: [],
          indisponibilites: JOURS.flatMap((jour) => CRENEAUX.map((s) => ({ jour, seance: s }))),
        },
      ],
    });

    const reponse = await placer({ simulation: false });

    expect(reponse.body.placees[0]).toMatchObject({ niveau: 'a_eviter', deconseille: true });
    expect(reponse.body.total.aEviter).toBe(1);
    expect(await Seance.countDocuments({ groupe: 'GM101' })).toBe(1);
  });

  it('pose SANS SALLE quand toutes les salles sont prises', async () => {
    await planifier('GM101', 'M101', 2.5);
    // A12 et B1 occupées partout, par un collègue et un autre groupe.
    await partout({ formateurMatricule: '4211', groupe: 'GM102', module: 'M102', salle: 'A12' });
    await Seance.create(
      JOURS.flatMap((jour) =>
        CRENEAUX.map((s) =>
          seance({ jour, seance: s, formateurMatricule: 'X', groupe: 'GM999', module: 'M9', salle: 'B1' })
        )
      )
    );

    const reponse = await placer({ simulation: false });

    expect(reponse.body.placees).toHaveLength(1);
    expect(reponse.body.placees[0]).toMatchObject({ niveau: 'sans_salle', salle: '' });
    expect(await Seance.findOne({ groupe: 'GM101' }).lean()).toMatchObject({ salle: '' });
  });

  it('rend NON PLACÉE, avec sa raison, la séance que rien ne peut accueillir', async () => {
    await planifier('GM101', 'M101', 2.5);
    // Le formateur est pris sur chaque créneau (chez GM102).
    await partout({ groupe: 'GM102', salle: '' });

    const reponse = await placer({ simulation: false });

    expect(reponse.body.placees).toEqual([]);
    expect(reponse.body.nonPlacees).toEqual([
      expect.objectContaining({ groupe: 'GM101', module: 'M101', nombre: 1, raison: 'formateur_occupe' }),
    ]);
    expect(await Seance.countDocuments({ groupe: 'GM101' })).toBe(0);
  });

  it('un module planifié sans affectation est rendu, jamais inventé', async () => {
    await planifier('GM101', 'M109', 2.5);

    const reponse = await placer({ simulation: false });

    expect(reponse.body.placees).toEqual([]);
    expect(reponse.body.nonPlacees).toEqual([
      expect.objectContaining({ groupe: 'GM101', module: 'M109', raison: 'sans_affectation' }),
    ]);
  });

  it('refuse quand l’emploi du temps est dissocié du chronogramme', async () => {
    await planifier('GM101', 'M101', 2.5);
    await AutoGenConfig.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      chronogrammeLie: false,
    });

    const reponse = await placer({ simulation: false });

    expect(reponse.status).toBe(409);
    expect(reponse.body.error?.code ?? reponse.body.code).toBe('CHRONOGRAMME_DISSOCIE');
    expect(await Seance.countDocuments()).toBe(0);
  });

  it('voit les cours du formateur dans son AUTRE établissement (constaté le 2026-09-27)', async () => {
    /*
     * ABDELGHANI LAASSAL, en production : pris à CFP MGD HASSANIA le lundi en
     * S1, le placement le croyait libre ici, `poser()` refusait, et la séance
     * ressortait « non placée » alors que la semaine avait de la place.
     */
    await planifier('GM101', 'M101', 2.5);

    const collegue = await User.create({
      nomComplet: 'Autre Directeur',
      email: 'autre@edtpro.ma',
      motDePasse: MOT_DE_PASSE,
      role: ROLES.DIRECTEUR,
      statut: STATUTS_COMPTE.APPROUVE,
      estVerifie: true,
    });
    const ailleurs = await Etablissement.create({
      proprietaireId: collegue.id,
      region: 'Casablanca-Settat',
      complexe: 'CF Autre',
      nom: 'CFP Ailleurs',
      anneeScolaire: ANNEE,
    });
    collegue.etablissementIds = [ailleurs.id];
    await collegue.save();
    await Base.create({
      etablissementId: ailleurs.id,
      anneeScolaire: ANNEE,
      formateurs: [{ matricule: MATRICULE, nomComplet: 'BRAHIM LOURID', masseHoraire: 1000 }],
      groupes: ['AA101'],
    });
    // Pris là-bas sur tous les créneaux, sauf le mardi en S3.
    await Seance.create(
      JOURS.flatMap((jour) => CRENEAUX.map((s) => ({ jour, seance: s })))
        .filter(({ jour, seance: s }) => !(jour === 'Mardi' && s === 'S3'))
        .map(({ jour, seance: s }) =>
          seance({ etablissementId: ailleurs.id, jour, seance: s, groupe: 'AA101', salle: 'X1' })
        )
    );

    const reponse = await placer({ simulation: false });

    expect(reponse.body.nonPlacees).toEqual([]);
    expect(reponse.body.placees).toEqual([
      expect.objectContaining({ groupe: 'GM101', jour: 'Mardi', seance: 'S3' }),
    ]);
  });

  it('exige d’être connecté', async () => {
    const reponse = await request(app)
      .post('/api/v2/chronogrammes/completude/placer')
      .send({ semaine: SEMAINE });
    expect(reponse.status).toBe(401);
  });
});
