import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
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
const ANCIEN = 'MotDePasse2026';
const NOUVEAU = 'NouveauSecret2027';

const dernierCode = () => /(\d{6})/.exec(envois.at(-1).texte)[1];

beforeEach(async () => {
  envois.length = 0;
  await User.create({
    nomComplet: 'Directeur Test',
    email: EMAIL,
    motDePasse: ANCIEN,
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
});

describe('Réinitialisation du mot de passe', () => {
  it("ne révèle pas si l'adresse existe", async () => {
    const connue = await request(app)
      .post('/api/v2/auth/mot-de-passe/demande')
      .send({ email: EMAIL });
    const inconnue = await request(app)
      .post('/api/v2/auth/mot-de-passe/demande')
      .send({ email: 'personne@edtpro.ma' });

    expect(connue.status).toBe(200);
    expect(inconnue.status).toBe(200);
    expect(connue.body.message).toBe(inconnue.body.message);

    // Seule l'adresse existante a déclenché un envoi.
    expect(envois).toHaveLength(1);
  });

  it('change le mot de passe et révoque toutes les sessions', async () => {
    // Session ouverte avant la réinitialisation.
    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: EMAIL, motDePasse: ANCIEN });
    const cookies = connexion.headers['set-cookie'];

    const utilisateur = await User.findOne({ email: EMAIL });
    expect(await RefreshToken.countDocuments({ utilisateurId: utilisateur.id })).toBe(1);

    await request(app).post('/api/v2/auth/mot-de-passe/demande').send({ email: EMAIL });

    const reset = await request(app).post('/api/v2/auth/mot-de-passe/reinitialisation').send({
      email: EMAIL,
      code: dernierCode(),
      motDePasse: NOUVEAU,
      confirmation: NOUVEAU,
    });
    expect(reset.status).toBe(200);

    // L'ancien mot de passe ne fonctionne plus, le nouveau si.
    const avecAncien = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: EMAIL, motDePasse: ANCIEN });
    expect(avecAncien.status).toBe(401);

    const avecNouveau = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: EMAIL, motDePasse: NOUVEAU });
    expect(avecNouveau.body.action).toBe('connecte');

    // La session ouverte AVANT le changement a été coupée : un compte compromis
    // ne doit pas rester accessible à l'intrus.
    const rafraichir = await request(app).post('/api/v2/auth/rafraichir').set('Cookie', cookies);
    expect(rafraichir.status).toBe(401);
  });

  it('refuse un code erroné', async () => {
    await request(app).post('/api/v2/auth/mot-de-passe/demande').send({ email: EMAIL });

    const reponse = await request(app).post('/api/v2/auth/mot-de-passe/reinitialisation').send({
      email: EMAIL,
      code: '000000',
      motDePasse: NOUVEAU,
      confirmation: NOUVEAU,
    });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('CODE_INVALIDE');
  });

  it('applique la politique de complexité au nouveau mot de passe', async () => {
    await request(app).post('/api/v2/auth/mot-de-passe/demande').send({ email: EMAIL });

    const reponse = await request(app).post('/api/v2/auth/mot-de-passe/reinitialisation').send({
      email: EMAIL,
      code: dernierCode(),
      motDePasse: 'faible',
      confirmation: 'faible',
    });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('VALIDATION_ERROR');
  });
});

describe("Demande d'essai", () => {
  it('est enregistrée pour un directeur en attente, une seule fois', async () => {
    await User.updateOne({ email: EMAIL }, { statut: STATUTS_COMPTE.EN_ATTENTE });

    // Un directeur en attente peut se connecter — c'est ce qui lui permet de
    // demander un essai (← login.php:110-122).
    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: EMAIL, motDePasse: ANCIEN });
    expect(connexion.body.action).toBe('connecte');

    const cookies = connexion.headers['set-cookie'];

    const premiere = await request(app).post('/api/v2/auth/essai').set('Cookie', cookies);
    expect(premiere.status).toBe(200);

    const seconde = await request(app).post('/api/v2/auth/essai').set('Cookie', cookies);
    expect(seconde.status).toBe(409);
    expect(seconde.body.code).toBe('ESSAI_DEJA_DEMANDE');
  });

  it('est refusée pour un compte déjà approuvé', async () => {
    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: EMAIL, motDePasse: ANCIEN });

    const reponse = await request(app)
      .post('/api/v2/auth/essai')
      .set('Cookie', connexion.headers['set-cookie']);

    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('DEJA_APPROUVE');
  });
});

describe('Changement de mot de passe par un utilisateur connecté', () => {
  const AUTRE = 'EncoreUnAutre2028';

  async function connecter() {
    const reponse = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: EMAIL, motDePasse: ANCIEN });
    return reponse.headers['set-cookie'];
  }

  it('change le mot de passe et laisse la session courante ouverte', async () => {
    const cookies = await connecter();

    const reponse = await request(app)
      .patch('/api/v2/auth/mot-de-passe')
      .set('Cookie', cookies)
      .send({ actuel: ANCIEN, nouveau: AUTRE, confirmation: AUTRE });

    expect(reponse.status).toBe(200);

    // La session en cours survit : on ne déconnecte pas quelqu'un de l'écran
    // où il vient d'agir.
    const moi = await request(app).get('/api/v2/auth/moi').set('Cookie', cookies);
    expect(moi.status).toBe(200);

    // L'ancien mot de passe ne vaut plus, le nouveau oui.
    const ancien = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: EMAIL, motDePasse: ANCIEN });
    expect(ancien.status).toBe(401);

    const nouveau = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: EMAIL, motDePasse: AUTRE });
    expect(nouveau.status).toBe(200);
  });

  it('révoque les AUTRES appareils', async () => {
    // Deux sessions ouvertes : un poste de bureau, un portable.
    const bureau = await connecter();
    const portable = await connecter();

    const reponse = await request(app)
      .patch('/api/v2/auth/mot-de-passe')
      .set('Cookie', portable)
      .send({ actuel: ANCIEN, nouveau: AUTRE, confirmation: AUTRE });

    expect(reponse.body.appareilsRevoques).toBe(1);

    // Le rafraîchissement du poste révoqué échoue : sa session n'existe plus.
    const refus = await request(app).post('/api/v2/auth/rafraichir').set('Cookie', bureau);
    expect(refus.status).toBe(401);
  });

  it('exige le mot de passe ACTUEL', async () => {
    const cookies = await connecter();

    const reponse = await request(app)
      .patch('/api/v2/auth/mot-de-passe')
      .set('Cookie', cookies)
      .send({ actuel: 'PasLeBon2026', nouveau: AUTRE, confirmation: AUTRE });

    // Sans cette exigence, un poste laissé ouvert suffirait à prendre le compte.
    expect(reponse.status).toBe(401);
    expect(reponse.body.code).toBe('MOT_DE_PASSE_INCORRECT');
  });

  it("refuse un nouveau mot de passe identique à l'ancien", async () => {
    const cookies = await connecter();

    const reponse = await request(app)
      .patch('/api/v2/auth/mot-de-passe')
      .set('Cookie', cookies)
      .send({ actuel: ANCIEN, nouveau: ANCIEN, confirmation: ANCIEN });

    // Sinon l'utilisateur croit avoir tourné la page alors que rien n'a changé.
    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('MOT_DE_PASSE_IDENTIQUE');
  });

  it('refuse sans session', async () => {
    const reponse = await request(app)
      .patch('/api/v2/auth/mot-de-passe')
      .send({ actuel: ANCIEN, nouveau: AUTRE, confirmation: AUTRE });

    expect(reponse.status).toBe(401);
  });
});

describe('Révocation de tous les autres appareils', () => {
  async function connecter() {
    const reponse = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: EMAIL, motDePasse: ANCIEN });
    return reponse.headers['set-cookie'];
  }

  it('ferme les autres sessions et épargne la courante', async () => {
    const bureau = await connecter();
    const portable = await connecter();
    const telephone = await connecter();

    const reponse = await request(app)
      .delete('/api/v2/auth/appareils')
      .set('Cookie', telephone);

    expect(reponse.status).toBe(200);
    expect(reponse.body.revoques).toBe(2);

    // Le téléphone reste connecté : on ne se déconnecte pas de l'écran où l'on
    // vient de décider de tout fermer.
    const encore = await request(app).post('/api/v2/auth/rafraichir').set('Cookie', telephone);
    expect(encore.status).toBe(200);

    for (const autre of [bureau, portable]) {
      const refus = await request(app).post('/api/v2/auth/rafraichir').set('Cookie', autre);
      expect(refus.status).toBe(401);
    }
  });

  it("répond 0 quand aucune autre session n'existe", async () => {
    const seule = await connecter();

    const reponse = await request(app).delete('/api/v2/auth/appareils').set('Cookie', seule);
    expect(reponse.body.revoques).toBe(0);
  });

  it('refuse sans session', async () => {
    expect((await request(app).delete('/api/v2/auth/appareils')).status).toBe(401);
  });
});
