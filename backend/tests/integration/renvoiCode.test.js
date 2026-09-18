import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { CodeVerification } from '../../src/models/CodeVerification.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

const { envois } = vi.hoisted(() => ({ envois: [] }));
vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async (m) => {
    envois.push(m);
    return { envoye: true };
  }),
}));

const app = createApp();
const EMAIL = 'directeur@edtpro.ma';
const dernierCode = () => /(\d{6})/.exec(envois.at(-1).texte)[1];

beforeEach(async () => {
  envois.length = 0;
  await User.create({
    nomComplet: 'Directeur Test',
    email: EMAIL,
    motDePasse: 'MotDePasse2026',
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.EN_ATTENTE,
    estVerifie: false,
  });
});

describe('POST /api/v2/auth/renvoi', () => {
  it('envoie un nouveau code et invalide le précédent', async () => {
    await request(app).post('/api/v2/auth/renvoi').send({ email: EMAIL, type: 'email' });
    const premierCode = dernierCode();

    await request(app).post('/api/v2/auth/renvoi').send({ email: EMAIL, type: 'email' });
    const secondCode = dernierCode();

    expect(envois).toHaveLength(2);
    expect(secondCode).not.toBe(premierCode);

    // Une seule demande subsiste : il ne peut pas y avoir deux codes valides.
    expect(await CodeVerification.countDocuments({ type: 'email' })).toBe(1);

    // L'ancien code ne fonctionne plus…
    const avecAncien = await request(app)
      .post('/api/v2/auth/verification')
      .send({ email: EMAIL, code: premierCode, type: 'email' });
    expect(avecAncien.status).toBe(400);

    // …le nouveau, si.
    const avecNouveau = await request(app)
      .post('/api/v2/auth/verification')
      .send({ email: EMAIL, code: secondCode, type: 'email' });
    expect(avecNouveau.body.action).toBe('email_verifie');
  });

  it("remet le compteur de tentatives à zéro", async () => {
    await request(app).post('/api/v2/auth/renvoi').send({ email: EMAIL, type: 'email' });

    // 4 échecs : la demande est encore vivante (elle meurt au 5e).
    for (let i = 0; i < 4; i += 1) {
      await request(app)
        .post('/api/v2/auth/verification')
        .send({ email: EMAIL, code: '000000', type: 'email' });
    }

    await request(app).post('/api/v2/auth/renvoi').send({ email: EMAIL, type: 'email' });

    const demande = await CodeVerification.findOne({ type: 'email' });
    expect(demande.tentatives).toBe(0);
  });

  it("ne révèle pas si l'adresse existe", async () => {
    const connue = await request(app)
      .post('/api/v2/auth/renvoi')
      .send({ email: EMAIL, type: 'email' });
    const inconnue = await request(app)
      .post('/api/v2/auth/renvoi')
      .send({ email: 'personne@edtpro.ma', type: 'email' });

    expect(connue.status).toBe(200);
    expect(inconnue.status).toBe(200);
    expect(connue.body.message).toBe(inconnue.body.message);
    expect(envois).toHaveLength(1); // seul le compte réel a reçu un e-mail
  });

  it("ne renvoie pas de code de vérification à un compte déjà vérifié", async () => {
    await User.updateOne({ email: EMAIL }, { estVerifie: true });

    const reponse = await request(app)
      .post('/api/v2/auth/renvoi')
      .send({ email: EMAIL, type: 'email' });

    expect(reponse.status).toBe(200);
    expect(envois).toHaveLength(0);
  });
});
