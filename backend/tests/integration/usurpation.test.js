import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { AuditLog, ACTIONS_AUDIT } from '../../src/models/AuditLog.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';

async function creerCompte(email, role) {
  return User.create({
    nomComplet: `Compte ${email}`,
    email,
    motDePasse: MOT_DE_PASSE,
    role,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
}

async function connecter(email) {
  const reponse = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: email, motDePasse: MOT_DE_PASSE });
  return reponse.headers['set-cookie'];
}

let cookiesAdmin;
let directeur;
let admin;

beforeEach(async () => {
  admin = await creerCompte('admin@edtpro.ma', ROLES.ADMIN);
  directeur = await creerCompte('directeur@edtpro.ma', ROLES.DIRECTEUR);
  cookiesAdmin = await connecter('admin@edtpro.ma');
});

describe('Connexion à la place d\'un utilisateur', () => {
  it('ouvre une session déléguée, traçée, et permet le retour', async () => {
    const usurpation = await request(app)
      .post(`/api/v2/admin/utilisateurs/${directeur.id}/connexion`)
      .set('Cookie', cookiesAdmin);

    expect(usurpation.status).toBe(200);
    const cookiesDelegues = usurpation.headers['set-cookie'];

    // La session est bien celle du directeur, et elle se sait déléguée.
    const moi = await request(app).get('/api/v2/auth/moi').set('Cookie', cookiesDelegues);
    expect(moi.body.utilisateur.email).toBe('directeur@edtpro.ma');
    expect(moi.body.impersonateur.nomComplet).toBe(admin.nomComplet);

    // L'action est journalisée.
    const trace = await AuditLog.findOne({ action: ACTIONS_AUDIT.USURPATION_DEBUT });
    expect(trace.acteurEmail).toBe('admin@edtpro.ma');
    expect(trace.cibleEmail).toBe('directeur@edtpro.ma');

    // Retour au compte administrateur.
    const retour = await request(app)
      .post('/api/v2/auth/retour-admin')
      .set('Cookie', cookiesDelegues);
    expect(retour.status).toBe(200);
    expect(retour.body.utilisateur.email).toBe('admin@edtpro.ma');
  });

  it("survit au rafraîchissement du jeton", async () => {
    const usurpation = await request(app)
      .post(`/api/v2/admin/utilisateurs/${directeur.id}/connexion`)
      .set('Cookie', cookiesAdmin);

    const rafraichi = await request(app)
      .post('/api/v2/auth/rafraichir')
      .set('Cookie', usurpation.headers['set-cookie']);

    // Sans conservation de `imp`, l'administrateur perdrait le retour au bout
    // de 15 minutes.
    const moi = await request(app)
      .get('/api/v2/auth/moi')
      .set('Cookie', rafraichi.headers['set-cookie']);
    expect(moi.body.impersonateur).not.toBeNull();
  });

  it("refuse de se connecter à la place d'un autre administrateur", async () => {
    const autreAdmin = await creerCompte('admin2@edtpro.ma', ROLES.ADMIN);

    const reponse = await request(app)
      .post(`/api/v2/admin/utilisateurs/${autreAdmin.id}/connexion`)
      .set('Cookie', cookiesAdmin);

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('CIBLE_ADMIN');
  });

  it('refuse le retour depuis une session normale', async () => {
    const cookiesDirecteur = await connecter('directeur@edtpro.ma');

    const reponse = await request(app)
      .post('/api/v2/auth/retour-admin')
      .set('Cookie', cookiesDirecteur);

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('PAS_USURPATION');
  });
});

describe('Suppression de compte', () => {
  it('supprime le compte et ses dépendances', async () => {
    const etablissement = await Etablissement.create({
      proprietaireId: directeur.id,
      region: 'Fès-Meknès',
      complexe: 'CF Bâtiment',
      nom: 'ISTA Test',
      anneeScolaire: 2026,
    });
    await connecter('directeur@edtpro.ma');

    const reponse = await request(app)
      .delete(`/api/v2/admin/utilisateurs/${directeur.id}`)
      .set('Cookie', cookiesAdmin);

    expect(reponse.status).toBe(200);
    expect(reponse.body.etablissementsSupprimes).toBe(1);

    // MongoDB n'a pas de ON DELETE CASCADE : les dépendances doivent avoir été
    // retirées explicitement.
    expect(await User.findById(directeur.id)).toBeNull();
    expect(await Etablissement.findById(etablissement.id)).toBeNull();
    expect(await RefreshToken.countDocuments({ utilisateurId: directeur.id })).toBe(0);

    const trace = await AuditLog.findOne({ action: ACTIONS_AUDIT.COMPTE_SUPPRIME });
    expect(trace.cibleEmail).toBe('directeur@edtpro.ma');
  });

  it('refuse de supprimer un administrateur ou soi-même', async () => {
    const autreAdmin = await creerCompte('admin2@edtpro.ma', ROLES.ADMIN);

    const surAdmin = await request(app)
      .delete(`/api/v2/admin/utilisateurs/${autreAdmin.id}`)
      .set('Cookie', cookiesAdmin);
    expect(surAdmin.body.code).toBe('CIBLE_ADMIN');

    const surSoi = await request(app)
      .delete(`/api/v2/admin/utilisateurs/${admin.id}`)
      .set('Cookie', cookiesAdmin);
    expect(surSoi.body.code).toBe('AUTO_SUPPRESSION');
  });
});
