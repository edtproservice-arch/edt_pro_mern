import { spawnSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';

import { createApp } from '../../src/app.js';
import { Base } from '../../src/models/Base.js';
import { Chronogramme } from '../../src/models/Chronogramme.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { User } from '../../src/models/User.js';
import { oublierMemoire } from '../../src/modules/calendrier/joursFeries.service.js';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * `POST /api/v2/chronogrammes/generer` — de la requête à l'écriture, avec le
 * vrai solveur Python (2026-10-04).
 *
 * ⚠️ IGNORÉS SI PYTHON EST ABSENT, comme `solveur.client.test.js` : une
 *    dépendance manquante ne doit pas peindre la suite en rouge.
 */
const pythonDisponible = (() => {
  try {
    return spawnSync(process.env.PYTHON_BIN ?? 'python', ['--version']).status === 0;
  } catch {
    return false;
  }
})();

const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;

let etablissement;
let cookies;

const generer = (corps, jar = cookies) =>
  request(app).post('/api/v2/chronogrammes/generer').set('Cookie', jar).send(corps);

const connecter = async (identifiant) =>
  (await request(app).post('/api/v2/auth/connexion').send({ identifiant, motDePasse: MOT_DE_PASSE }))
    .headers['set-cookie'];

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
  });
  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [{ matricule: '9863', nomComplet: 'BRAHIM LOURID', masseHoraire: 1000 }],
    groupes: ['GM101', 'GM102'],
    affectations: [
      { formateur: '9863', groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 60, s2Heures: 0, estRegional: true },
      { formateur: '9863', groupe: 'GM101', module: 'M102', type: TYPES_COURS.PRESENTIEL, s1Heures: 40, s2Heures: 40 },
      { formateur: '9863', groupe: 'GM102 GM101', module: 'M103', type: TYPES_COURS.SYNCHRONE, s1Heures: 0, s2Heures: 30 },
    ],
  });

  // Une case d'un module SANS affectation : la génération ne doit jamais l'effacer.
  await Chronogramme.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    groupe: 'GM101',
    planning: { M999: [{ semaine: 'S5', heures: 5, type: 'P' }] },
  });

  cookies = await connecter('directeur@edtpro.ma');
});

(pythonDisponible ? describe : describe.skip)('génération du chronogramme', () => {
  it('SIMULE par défaut, sans rien écrire', async () => {
    const reponse = await generer({});

    expect(reponse.status).toBe(200);
    expect(reponse.body).toMatchObject({
      simulation: true,
      mode: 'remplacer',
      // M101 est régional : 2,5 h laissées en réserve.
      heuresDemandees: 167.5,
      heuresPlanifiees: 167.5,
      reserveRegionale: 2.5,
      nonPlanifiees: [],
    });
    expect(reponse.body.formateurs[0]).toMatchObject({ nom: 'BRAHIM LOURID', masseAffectee: 170 });

    const gm101 = await Chronogramme.findOne({ groupe: 'GM101' });
    expect([...gm101.planning.keys()]).toEqual(['M999']);
    expect(await Chronogramme.countDocuments({ groupe: 'GM102' })).toBe(0);
  });

  it('écrit chaque groupe, garde les modules non affectés, et avance la version', async () => {
    const reponse = await generer({ simulation: false });
    expect(reponse.status).toBe(200);
    expect(reponse.body.groupesEcrits).toEqual(['GM101', 'GM102']);

    const gm101 = await Chronogramme.findOne({ groupe: 'GM101' });
    const total = (chrono, module) => chrono.planning.get(module).reduce((s, c) => s + c.heures, 0);
    expect(total(gm101, 'M101')).toBe(57.5);
    expect(total(gm101, 'M102')).toBe(80);
    expect(total(gm101, 'M103')).toBe(30);
    expect(total(gm101, 'M999')).toBe(5);
    expect(gm101.version).toBe(1);

    // Le synchrone mutualisé tombe les MÊMES semaines dans les deux groupes.
    const gm102 = await Chronogramme.findOne({ groupe: 'GM102' });
    const semaines = (chrono) => chrono.planning.get('M103').map((c) => c.semaine).sort();
    expect(semaines(gm102)).toEqual(semaines(gm101));
  });

  it('refuse un mode inconnu en 400', async () => {
    expect((await generer({ mode: 'tout' })).status).toBe(400);
  });

  it('est réservée au directeur', async () => {
    await User.create({
      nomComplet: 'Brahim Lourid',
      email: 'brahim.lourid@edtpro.ma',
      motDePasse: MOT_DE_PASSE,
      role: ROLES.FORMATEUR,
      identifiant: '9863',
      statut: STATUTS_COMPTE.APPROUVE,
      estVerifie: true,
      etablissementIds: [etablissement.id],
    });
    const formateur = await connecter('brahim.lourid@edtpro.ma');
    expect((await generer({}, formateur)).status).toBe(403);
  });
});
