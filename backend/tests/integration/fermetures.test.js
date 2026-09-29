import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { Seance } from '../../src/models/Seance.js';
import { Chronogramme } from '../../src/models/Chronogramme.js';
import { UnplacedSession } from '../../src/models/UnplacedSession.js';
import { oublierMemoire } from '../../src/modules/calendrier/joursFeries.service.js';
import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';
import { dateDuJour, enJour, semainesChronogramme } from 'shared/domain';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Une nouvelle période (stage, formation, vacances) supprime ce qu'elle
 * recouvre — après confirmation (2026-09-23, demande du porteur).
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;
const SEMAINE = '2026-W3';

const jourDe = (jour, semaine = SEMAINE) => enJour(dateDuJour(semaine, jour));
const S3 = semainesChronogramme(ANNEE)[2];

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
    espaces: ['A12'],
  });

  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [
      { matricule: '9863', nomComplet: 'BRAHIM LOURID' },
      { matricule: '1111', nomComplet: 'SALMA IDRISSI' },
    ],
    groupes: ['GM101', 'GM102'],
    affectations: [
      { formateur: '9863', groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 },
      { formateur: '1111', groupe: 'GM102', module: 'M102', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 },
    ],
  });

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookies = connexion.headers['set-cookie'];
});

const seance = (surcharges = {}) => {
  const jour = surcharges.jour ?? 'Lundi';
  const semaine = surcharges.semaine ?? SEMAINE;
  return Seance.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    semaine,
    jour,
    seance: 'S1',
    date: dateDuJour(semaine, jour),
    formateurMatricule: '9863',
    groupe: 'GM101',
    module: 'M101',
    salle: 'A12',
    ...surcharges,
  });
};

const envoyerStages = (stages, corps = {}) =>
  request(app)
    .put('/api/v2/etablissements/courant/stages')
    .set('Cookie', cookies)
    .send({ stages, ...corps });

describe('stage', () => {
  it('⚠️ refuse en 409 avec les chiffres, et n’écrit RIEN', async () => {
    await seance();
    await seance({ jour: 'Mardi' });

    const reponse = await envoyerStages([{ groupe: 'GM101', debut: jourDe('Lundi'), fin: jourDe('Lundi') }]);

    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('PERIODES_SUPPRESSIONS');
    expect(reponse.body.details).toMatchObject({ seances: 1, parMotif: { stage: 1 }, groupes: ['GM101'] });

    const apres = await Etablissement.findById(etablissement.id).lean();
    expect(apres.stages).toHaveLength(0);
    expect(await Seance.countDocuments()).toBe(2);
  });

  it('confirmé : supprime la séance du jour couvert et l’inscrit en non placée', async () => {
    await seance();
    await seance({ jour: 'Mardi' });
    await seance({ groupe: 'GM102', formateurMatricule: '1111', module: 'M102', seance: 'S2' });

    const reponse = await envoyerStages(
      [{ groupe: 'GM101', debut: jourDe('Lundi'), fin: jourDe('Lundi') }],
      { confirmerSuppressions: true }
    );

    expect(reponse.status).toBe(200);
    expect(reponse.body.stages).toHaveLength(1);
    expect(reponse.body.cascade).toMatchObject({ seances: 1, nonPlacees: 1 });

    const restantes = await Seance.find().lean();
    expect(restantes.map((s) => `${s.groupe} ${s.jour}`).sort()).toEqual(['GM101 Mardi', 'GM102 Lundi']);

    const nonPlacee = await UnplacedSession.findOne({ semaine: SEMAINE, groupe: 'GM101', module: 'M101' }).lean();
    expect(nonPlacee).toMatchObject({ manquantes: 1, total: 1, formateurMatricule: '9863' });
  });

  it('une fusion part dès qu’un de ses membres est en stage', async () => {
    await seance({ groupe: 'GM101 GM102' });

    const reponse = await envoyerStages(
      [{ groupe: 'GM102', debut: jourDe('Lundi'), fin: jourDe('Lundi') }],
      { confirmerSuppressions: true }
    );

    expect(reponse.status).toBe(200);
    expect(await Seance.countDocuments()).toBe(0);
  });

  it('⚠️ chronogramme : vide la semaine ENTIÈREMENT fermée, garde la semaine amputée', async () => {
    await Chronogramme.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      groupe: 'GM101',
      planning: {
        M101: [
          { semaine: 'S3', heures: 10, type: 'P' },
          { semaine: 'S4', heures: 5, type: 'P' },
        ],
      },
    });
    const S4 = semainesChronogramme(ANNEE)[3];

    const refus = await envoyerStages([
      { groupe: 'GM101', debut: S3.debut, fin: S3.fin },
      // Deux jours de S4 seulement : la semaine reste ouverte.
      { groupe: 'GM101', debut: S4.debut, fin: jourDe('Mardi', '2026-W4') },
    ]);
    expect(refus.status).toBe(409);
    expect(refus.body.details).toMatchObject({ seances: 0, cellules: 1, heures: 10 });

    const reponse = await envoyerStages(
      [
        { groupe: 'GM101', debut: S3.debut, fin: S3.fin },
        { groupe: 'GM101', debut: S4.debut, fin: jourDe('Mardi', '2026-W4') },
      ],
      { confirmerSuppressions: true }
    );
    expect(reponse.status).toBe(200);
    expect(reponse.body.cascade).toMatchObject({ heures: 10 });

    const chrono = await Chronogramme.findOne({ groupe: 'GM101' }).lean();
    expect(chrono.planning.M101).toEqual([{ semaine: 'S4', heures: 5, type: 'P' }]);
    expect(chrono.version).toBe(1);
  });

  it('⚠️ une période déjà en place, raccourcie ou retirée ne supprime rien', async () => {
    await Etablissement.updateOne(
      { _id: etablissement.id },
      { $set: { stages: [{ groupe: 'GM101', debut: jourDe('Lundi'), fin: jourDe('Mercredi') }] } }
    );
    // Posée AVANT la livraison, sous un stage existant : elle doit survivre.
    await seance();

    const raccourci = await envoyerStages([{ groupe: 'GM101', debut: jourDe('Lundi'), fin: jourDe('Mardi') }]);
    expect(raccourci.status).toBe(200);
    expect(raccourci.body.cascade).toBeNull();

    const retire = await envoyerStages([]);
    expect(retire.status).toBe(200);
    expect(await Seance.countDocuments()).toBe(1);
  });

  it('une version périmée reste un VERSION_PERIMEE, pas une confirmation', async () => {
    await seance();

    const reponse = await envoyerStages(
      [{ groupe: 'GM101', debut: jourDe('Lundi'), fin: jourDe('Lundi') }],
      { version: 7 }
    );

    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('VERSION_PERIMEE');
  });
});

describe('formation', () => {
  it('ne supprime que les séances du formateur concerné', async () => {
    await seance();
    await seance({ groupe: 'GM102', formateurMatricule: '1111', module: 'M102' });

    const formations = [{ matriculeFormateur: '9863', debut: jourDe('Lundi'), fin: jourDe('Lundi') }];
    const refus = await request(app)
      .put('/api/v2/etablissements/courant/formations')
      .set('Cookie', cookies)
      .send({ formations });
    expect(refus.status).toBe(409);
    expect(refus.body.details.parMotif).toEqual({ vacances: 0, stage: 0, formation: 1 });

    const reponse = await request(app)
      .put('/api/v2/etablissements/courant/formations')
      .set('Cookie', cookies)
      .send({ formations, confirmerSuppressions: true });

    expect(reponse.status).toBe(200);
    const restantes = await Seance.find().lean();
    expect(restantes.map((s) => s.formateurMatricule)).toEqual(['1111']);
  });
});

describe('vacances', () => {
  it('ferment l’établissement : toutes les séances du jour partent, après confirmation', async () => {
    await seance();
    await seance({ groupe: 'GM102', formateurMatricule: '1111', module: 'M102' });
    await seance({ jour: 'Mardi' });

    const vacances = [{ intitule: 'Pont', debut: jourDe('Lundi'), fin: jourDe('Lundi') }];
    const refus = await request(app).put('/api/v2/calendrier').set('Cookie', cookies).send({ vacances });
    expect(refus.status).toBe(409);
    expect(refus.body.details).toMatchObject({ seances: 2, parMotif: { vacances: 2 } });

    const reponse = await request(app)
      .put('/api/v2/calendrier')
      .set('Cookie', cookies)
      .send({ vacances, confirmerSuppressions: true });

    expect(reponse.status).toBe(200);
    expect(reponse.body.vacances).toHaveLength(1);
    expect(reponse.body.cascade).toMatchObject({ seances: 2 });
    expect((await Seance.find().lean()).map((s) => s.jour)).toEqual(['Mardi']);
  });

  it('sans séance touchée, s’enregistre sans rien demander', async () => {
    const reponse = await request(app)
      .put('/api/v2/calendrier')
      .set('Cookie', cookies)
      .send({ vacances: [{ intitule: 'Pont', debut: jourDe('Lundi'), fin: jourDe('Lundi') }] });

    expect(reponse.status).toBe(200);
    expect(reponse.body.cascade).toBeNull();
  });
});
