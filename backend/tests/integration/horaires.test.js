import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';
import { horaireParDefaut } from 'shared/domain';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Les horaires des séances — hiver, été, ramadan. (demande du porteur, 2026-09-20.)
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';

let cookiesAdmin;
let cookiesDirecteur;
let cookiesStagiaire;

async function compte(email, role) {
  await User.create({
    nomComplet: `Compte ${email}`,
    email,
    motDePasse: MOT_DE_PASSE,
    role,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
  const reponse = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: email, motDePasse: MOT_DE_PASSE });
  return reponse.headers['set-cookie'];
}

const reglage = (surcharge = {}) => ({
  actif: 'hiver',
  horaires: {
    hiver: horaireParDefaut('hiver'),
    ete: horaireParDefaut('ete'),
    ramadan: horaireParDefaut('ramadan'),
  },
  ...surcharge,
});

beforeEach(async () => {
  cookiesAdmin = await compte('admin@edtpro.ma', ROLES.ADMIN);
  cookiesDirecteur = await compte('directeur@edtpro.ma', ROLES.DIRECTEUR);
  cookiesStagiaire = await compte('stagiaire@edtpro.ma', ROLES.STAGIAIRE);
});

describe('Accès aux horaires', () => {
  it('refuse un visiteur non authentifié', async () => {
    expect((await request(app).get('/api/v2/horaires-seances')).status).toBe(401);
  });

  it('⚠️ tout compte connecté LIT l’horaire en vigueur — le stagiaire comme le directeur', async () => {
    for (const cookies of [cookiesStagiaire, cookiesDirecteur, cookiesAdmin]) {
      const reponse = await request(app).get('/api/v2/horaires-seances').set('Cookie', cookies);
      expect(reponse.status).toBe(200);
    }
  });

  it('refuse l’écriture à un directeur, l’accepte pour l’admin', async () => {
    const refus = await request(app)
      .put('/api/v2/admin/horaires-seances')
      .set('Cookie', cookiesDirecteur)
      .send(reglage());
    expect(refus.status).toBe(403);

    const accepte = await request(app)
      .put('/api/v2/admin/horaires-seances')
      .set('Cookie', cookiesAdmin)
      .send(reglage());
    expect(accepte.status).toBe(200);
  });
});

describe('Lecture', () => {
  it('rend l’horaire d’hiver d’origine tant que rien n’est réglé', async () => {
    const reponse = await request(app).get('/api/v2/horaires-seances').set('Cookie', cookiesStagiaire);

    expect(reponse.body.actif).toBe('hiver');
    expect(reponse.body.courant.semaine.S1).toEqual({ debut: '08:00', fin: '10:30' });
    expect(reponse.body.courant.semaine.S4).toEqual({ debut: '16:00', fin: '18:30' });
    expect(reponse.body.horaires.ramadan.semaine.S1).toEqual({ debut: '08:30', fin: '10:20' });
  });
});

describe('Réglage', () => {
  it('⚠️ basculer sur le ramadan change l’horaire lu par TOUS les comptes', async () => {
    await request(app)
      .put('/api/v2/admin/horaires-seances')
      .set('Cookie', cookiesAdmin)
      .send(reglage({ actif: 'ramadan' }));

    const vuParLeStagiaire = await request(app)
      .get('/api/v2/horaires-seances')
      .set('Cookie', cookiesStagiaire);

    expect(vuParLeStagiaire.body.actif).toBe('ramadan');
    expect(vuParLeStagiaire.body.courant.semaine.S2).toEqual({ debut: '10:25', fin: '12:15' });
    expect(vuParLeStagiaire.body.courant.semaine.S3).toEqual({ debut: '12:45', fin: '14:40' });
  });

  it('conserve une valeur modifiée', async () => {
    const corps = reglage();
    corps.horaires.hiver.semaine.S1 = { debut: '08:15', fin: '10:30' };

    await request(app).put('/api/v2/admin/horaires-seances').set('Cookie', cookiesAdmin).send(corps);
    const relu = await request(app).get('/api/v2/horaires-seances').set('Cookie', cookiesDirecteur);

    expect(relu.body.courant.semaine.S1).toEqual({ debut: '08:15', fin: '10:30' });
  });

  it('refuse un jeu incohérent (fin avant début, chevauchement)', async () => {
    const finAvantDebut = reglage();
    finAvantDebut.horaires.hiver.semaine.S2 = { debut: '10:30', fin: '10:00' };
    const chevauche = reglage();
    chevauche.horaires.ramadan.vendredi.S3 = { debut: '12:00', fin: '14:40' };

    for (const corps of [finAvantDebut, chevauche]) {
      const reponse = await request(app)
        .put('/api/v2/admin/horaires-seances')
        .set('Cookie', cookiesAdmin)
        .send(corps);
      expect(reponse.status).toBe(400);
    }
  });

  it('refuse un horaire inconnu et une heure mal écrite', async () => {
    const inconnu = await request(app)
      .put('/api/v2/admin/horaires-seances')
      .set('Cookie', cookiesAdmin)
      .send(reglage({ actif: 'automne' }));
    expect(inconnu.status).toBe(400);

    const mal = reglage();
    mal.horaires.hiver.semaine.S1.debut = '8h00';
    const reponse = await request(app)
      .put('/api/v2/admin/horaires-seances')
      .set('Cookie', cookiesAdmin)
      .send(mal);
    expect(reponse.status).toBe(400);
  });
});
