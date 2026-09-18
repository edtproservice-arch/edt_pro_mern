import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { AutoGenConfig } from '../../src/models/AutoGenConfig.js';
import { oublierMemoire } from '../../src/modules/calendrier/joursFeries.service.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Disponibilité et salles attribuées des formateurs (2026-09-17).
 * ← api/data/save_auto_gen_config.php
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;
const URL = '/api/v2/base/formateurs/contraintes';

let etablissement;
let cookies;

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
    espaces: ['B02', 'A12'],
  });
  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [
      { matricule: '9863', nomComplet: 'BRAHIM LOURID' },
      { matricule: '', nomComplet: 'SANS M. MATRICULE' },
    ],
    groupes: ['GM101'],
    affectations: [],
  });

  cookies = await connecter('directeur@edtpro.ma');
});

describe('contraintes des formateurs', () => {
  it('rend une liste vide tant que rien n’est saisi', async () => {
    const reponse = await request(app).get(URL).set('Cookie', cookies);
    expect(reponse.status).toBe(200);
    expect(reponse.body.contraintes).toEqual([]);
  });

  it('enregistre salles et créneaux, remis en ordre, et les rend au contexte de l’emploi du temps', async () => {
    const reponse = await request(app)
      .patch(URL)
      .set('Cookie', cookies)
      .send({
        formateur: '9863',
        espaces: ['A12', 'A12'],
        indisponibilites: [
          { jour: 'Mardi', seance: 'S2' },
          { jour: 'Lundi', seance: 'S4' },
        ],
      });

    expect(reponse.status).toBe(200);
    expect(reponse.body.contraintes).toEqual({
      formateur: '9863',
      espaces: ['A12'],
      indisponibilites: [
        { jour: 'Lundi', seance: 'S4' },
        { jour: 'Mardi', seance: 'S2' },
      ],
    });

    const contexte = await request(app).get('/api/v2/seances/contexte').set('Cookie', cookies);
    expect(contexte.body.contraintesFormateurs).toEqual([reponse.body.contraintes]);
  });

  it('est PARTIELLE : un champ absent n’est pas touché, un tableau vide l’efface', async () => {
    await request(app)
      .patch(URL)
      .set('Cookie', cookies)
      .send({ formateur: '9863', espaces: ['B02'], indisponibilites: [{ jour: 'Lundi', seance: 'S1' }] });

    await request(app).patch(URL).set('Cookie', cookies).send({ formateur: '9863', espaces: [] });

    const reponse = await request(app).get(URL).set('Cookie', cookies);
    expect(reponse.body.contraintes).toEqual([
      { formateur: '9863', espaces: [], indisponibilites: [{ jour: 'Lundi', seance: 'S1' }] },
    ]);
    // Une seule entrée, pas deux.
    const config = await AutoGenConfig.findOne({ etablissementId: etablissement.id }).lean();
    expect(config.contraintes).toHaveLength(1);
  });

  it('accepte un formateur SANS matricule, identifié par son nom — point compris', async () => {
    const reponse = await request(app)
      .patch(URL)
      .set('Cookie', cookies)
      .send({ formateur: 'SANS M. MATRICULE', espaces: ['B02'] });
    expect(reponse.status).toBe(200);
    expect(reponse.body.contraintes.espaces).toEqual(['B02']);
  });

  it('refuse une salle inconnue, un formateur inconnu, le soir', async () => {
    const salle = await request(app).patch(URL).set('Cookie', cookies).send({ formateur: '9863', espaces: ['Z99'] });
    expect(salle.status).toBe(400);
    expect(salle.body.code).toBe('SALLE_INCONNUE');

    const inconnu = await request(app).patch(URL).set('Cookie', cookies).send({ formateur: '0000', espaces: [] });
    expect(inconnu.status).toBe(404);

    const soir = await request(app)
      .patch(URL)
      .set('Cookie', cookies)
      .send({ formateur: '9863', indisponibilites: [{ jour: 'Lundi', seance: 'S5' }] });
    expect(soir.status).toBe(400);

    expect(await AutoGenConfig.countDocuments()).toBe(0);
  });

  it('refuse l’écriture à un formateur non invité', async () => {
    await User.create({
      nomComplet: 'BRAHIM LOURID',
      email: 'brahim@edtpro.ma',
      identifiant: '9863',
      motDePasse: MOT_DE_PASSE,
      role: ROLES.FORMATEUR,
      statut: STATUTS_COMPTE.APPROUVE,
      estVerifie: true,
      etablissementIds: [etablissement.id],
    });
    const cookiesFormateur = await connecter('brahim@edtpro.ma');

    const reponse = await request(app)
      .patch(URL)
      .set('Cookie', cookiesFormateur)
      .send({ formateur: '9863', espaces: [] });
    expect(reponse.status).toBe(403);
  });
});
