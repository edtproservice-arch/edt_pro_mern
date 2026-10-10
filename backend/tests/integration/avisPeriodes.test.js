import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';
import { createApp } from '../../src/app.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Message } from '../../src/models/Message.js';
import { Stagiaire } from '../../src/models/Stagiaire.js';
import { User } from '../../src/models/User.js';
import { envoyerAvisPeriodes } from '../../src/modules/avisPeriodes/avisPeriodes.service.js';

/**
 * Avis automatique des stages et des formations, une semaine avant (2026-10-10).
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
// Midi : la fenêtre se calcule en dates locales, loin de tout changement de jour.
const MAINTENANT = new Date('2026-10-05T12:00:00');

let etablissement;
let stagiaire;
let formateur;

const compte = (champs) =>
  User.create({ motDePasse: MOT_DE_PASSE, statut: STATUTS_COMPTE.APPROUVE, estVerifie: true, ...champs });

beforeEach(async () => {
  const directeur = await compte({ nomComplet: 'Directeur Test', email: 'directeur@edtpro.ma', role: ROLES.DIRECTEUR });

  etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Test',
    anneeScolaire: 2026,
    stages: [
      { groupe: 'GM101', debut: '2026-10-08', fin: '2026-10-30' }, // dans 3 jours → avisé
      { groupe: 'GM101', debut: '2026-12-01', fin: '2026-12-20' }, // trop loin → rien
    ],
    formations: [{ matriculeFormateur: '9863', nomFormateur: 'BRAHIM LOURID', debut: '2026-10-12', fin: '2026-10-14' }],
  });
  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  stagiaire = await compte({
    nomComplet: 'YASSINE ALAOUI',
    email: 'stagiaire@edtpro.ma',
    identifiant: 'CEF001',
    role: ROLES.STAGIAIRE,
    etablissementIds: [etablissement.id],
  });
  await Stagiaire.create({
    etablissementId: etablissement.id,
    anneeScolaire: 2026,
    matricule: 'CEF001',
    groupes: ['GM101'],
    groupePrincipal: 'GM101',
  });
  // Un stagiaire d'un AUTRE groupe : il ne doit rien recevoir.
  await compte({
    nomComplet: 'SARA BENNANI',
    email: 'autre@edtpro.ma',
    identifiant: 'CEF002',
    role: ROLES.STAGIAIRE,
    etablissementIds: [etablissement.id],
  });
  await Stagiaire.create({ etablissementId: etablissement.id, anneeScolaire: 2026, matricule: 'CEF002', groupes: ['GM102'] });

  formateur = await compte({
    nomComplet: 'BRAHIM LOURID',
    email: 'formateur@edtpro.ma',
    identifiant: '9863',
    role: ROLES.FORMATEUR,
    etablissementIds: [etablissement.id],
  });
});

describe('envoyerAvisPeriodes', () => {
  it('avise les stagiaires du groupe et le formateur, rien d’autre', async () => {
    const bilan = await envoyerAvisPeriodes(MAINTENANT);
    expect(bilan).toEqual({ avis: 2, messages: 2 });

    const recus = await Message.find().lean();
    expect(recus.map((m) => String(m.destinataireId)).sort()).toEqual([String(stagiaire._id), String(formateur._id)].sort());

    const avisStage = recus.find((m) => String(m.destinataireId) === String(stagiaire._id));
    expect(avisStage.sujet).toContain('GM101');
    expect(avisStage.corps).toContain('dans 3 jours');
    expect(avisStage.avisPeriode).toMatchObject({ type: 'stage', debut: '2026-10-08', fin: '2026-10-30' });
  });

  it('ne remet jamais deux fois le même avis', async () => {
    await envoyerAvisPeriodes(MAINTENANT);
    const second = await envoyerAvisPeriodes(new Date('2026-10-06T12:00:00'));

    expect(second.messages).toBe(0);
    expect(await Message.countDocuments()).toBe(2);
  });

  it('avise de nouveau une période DÉPLACÉE, à ses nouvelles dates', async () => {
    await envoyerAvisPeriodes(MAINTENANT);
    await Etablissement.updateOne(
      { _id: etablissement.id },
      { $set: { 'stages.0.debut': '2026-10-09' } }
    );
    const apres = await envoyerAvisPeriodes(MAINTENANT);
    expect(apres.messages).toBe(1);
  });

  it('interdit au stagiaire de répondre à l’avis', async () => {
    await envoyerAvisPeriodes(MAINTENANT);
    const avis = await Message.findOne({ destinataireId: stagiaire._id }).lean();

    const cookies = (
      await request(app).post('/api/v2/auth/connexion').send({ identifiant: 'stagiaire@edtpro.ma', motDePasse: MOT_DE_PASSE })
    ).headers['set-cookie'];
    const reponse = await request(app)
      .post('/api/v2/messages')
      .set('Cookie', cookies)
      .send({ destinataires: [String(avis.expediteurId)], sujet: 'Re', corps: 'Merci', reponseA: String(avis._id) });

    expect(reponse.status).toBeGreaterThanOrEqual(400);
    expect(await Message.countDocuments({ expediteurId: stagiaire._id })).toBe(0);
  });
});
