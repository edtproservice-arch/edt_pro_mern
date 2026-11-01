import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

/*
 * ═══ LES NOTIFICATIONS PUSH (2026-11-01) ═══ Le navigateur s'abonne (Web Push) ; un message
 * reçu part alors vers son appareil, même site fermé. `web-push` est remplacé : aucun service
 * de push n'est appelé pendant les tests.
 */
vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

const envoisWeb = [];
let reponseWeb = null;
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (abonnement, charge) => {
      envoisWeb.push({ abonnement, charge: JSON.parse(charge) });
      if (reponseWeb) throw reponseWeb;
    }),
  },
}));

const { createApp } = await import('../../src/app.js');
const { User } = await import('../../src/models/User.js');
const { Etablissement } = await import('../../src/models/Etablissement.js');
const { AbonnementPush } = await import('../../src/models/AbonnementPush.js');
const { ROLES, STATUTS_COMPTE } = await import('shared/constants');

const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';

const creer = (nomComplet, email, role, etablissementIds = []) =>
  User.create({
    nomComplet,
    email,
    motDePasse: MOT_DE_PASSE,
    role,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
    etablissementIds,
  });

const connecter = async (email) =>
  (await request(app).post('/api/v2/auth/connexion').send({ identifiant: email, motDePasse: MOT_DE_PASSE })).headers[
    'set-cookie'
  ];

const abonnement = {
  endpoint: 'https://push.exemple.test/abonnement/f1',
  expirationTime: null,
  keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
};

let formateur;

beforeEach(async () => {
  envoisWeb.length = 0;
  reponseWeb = null;
  process.env.VAPID_PUBLIC_KEY = 'BPubliqueDeTest';
  process.env.VAPID_PRIVATE_KEY = 'PriveeDeTest';
  const directeur = await creer('Directeur Test', 'directeur@edtpro.ma', ROLES.DIRECTEUR);
  const etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Test',
    anneeScolaire: 2026,
  });
  directeur.etablissementIds = [etablissement.id];
  await directeur.save();
  formateur = await creer('Formateur Un', 'f1@edtpro.ma', ROLES.FORMATEUR, [etablissement.id]);
});

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

const attendre = async (condition) => {
  for (let i = 0; i < 50 && !condition(); i += 1) await new Promise((r) => setTimeout(r, 20));
};

describe('Notifications push (2026-11-01)', () => {
  it('donne la clé publique, et enregistre l’abonnement du navigateur', async () => {
    const cookies = await connecter('f1@edtpro.ma');
    const cle = await request(app).get('/api/v2/notifications/cle-publique').set('Cookie', cookies);
    expect(cle.body.cle).toBe('BPubliqueDeTest');

    const reponse = await request(app)
      .post('/api/v2/notifications/abonnements')
      .set('Cookie', cookies)
      .send({ type: 'web', abonnement, appareil: 'Chrome' });
    expect(reponse.status).toBe(200);
    const enregistre = await AbonnementPush.findOne({ cle: abonnement.endpoint }).lean();
    expect(String(enregistre.utilisateurId)).toBe(String(formateur.id));
  });

  it('⚠️ un message reçu part vers le navigateur abonné, même site fermé', async () => {
    const cookiesFormateur = await connecter('f1@edtpro.ma');
    await request(app).post('/api/v2/notifications/abonnements').set('Cookie', cookiesFormateur).send({ type: 'web', abonnement });

    const cookiesDirecteur = await connecter('directeur@edtpro.ma');
    const envoi = await request(app)
      .post('/api/v2/messages')
      .set('Cookie', cookiesDirecteur)
      .send({ destinataires: [formateur.id], sujet: 'Réunion', corps: 'Jeudi 14 h.' });
    expect(envoi.status).toBe(200);

    await attendre(() => envoisWeb.length > 0);
    expect(envoisWeb).toHaveLength(1);
    expect(envoisWeb[0].abonnement.endpoint).toBe(abonnement.endpoint);
    expect(envoisWeb[0].charge).toEqual({ titre: 'Message de Directeur Test', corps: 'Réunion', lien: '/app/messagerie' });
  });

  it('⚠️ oublie un navigateur qui s’est désabonné (410)', async () => {
    const cookies = await connecter('f1@edtpro.ma');
    await request(app).post('/api/v2/notifications/abonnements').set('Cookie', cookies).send({ type: 'web', abonnement });
    reponseWeb = Object.assign(new Error('Gone'), { statusCode: 410 });

    const { envoyerPush } = await import('../../src/modules/notifications/push.service.js');
    await envoyerPush([String(formateur.id)], { genre: 'message', titre: 'T', corps: 'C', lien: '/app' });
    expect(await AbonnementPush.countDocuments({ cle: abonnement.endpoint })).toBe(0);
  });

  it('refuse un abonnement sans session', async () => {
    const reponse = await request(app).post('/api/v2/notifications/abonnements').send({ type: 'web', abonnement });
    expect(reponse.status).toBe(401);
  });
});
