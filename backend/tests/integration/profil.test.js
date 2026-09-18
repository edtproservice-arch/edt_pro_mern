import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';

async function creerCompte(role, email, identifiant = null) {
  await User.create({
    nomComplet: 'Nom Initial',
    email,
    motDePasse: MOT_DE_PASSE,
    identifiant,
    role,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
}

async function connecter(identifiant) {
  const reponse = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant, motDePasse: MOT_DE_PASSE });
  return reponse.headers['set-cookie'];
}

describe('Modification du profil (nom et e-mail)', () => {
  it('un DIRECTEUR peut modifier son nom et son e-mail', async () => {
    await creerCompte(ROLES.DIRECTEUR, 'directeur@edtpro.ma');
    const cookies = await connecter('directeur@edtpro.ma');

    const reponse = await request(app)
      .patch('/api/v2/auth/profil')
      .set('Cookie', cookies)
      .send({ nomComplet: 'Nouveau Nom', email: 'nouveau@edtpro.ma' });

    expect(reponse.status).toBe(200);

    const utilisateur = await User.findOne({ email: 'nouveau@edtpro.ma' });
    expect(utilisateur.nomComplet).toBe('Nouveau Nom');
  });

  /*
   * ⚠️⚠️ FORMATEUR ET STAGIAIRE N'Y ONT PAS DROIT (2026-09-05, demande du
   * porteur) : leur identité vient d'un import (e-note / Konosys), pas d'une
   * inscription. Se renommer soi-même romprait l'appariement que
   * `shared/src/domain/formateurs` et la résolution des séances garantissent
   * par le nom — et l'e-mail est celui auquel partent les identifiants créés
   * en masse.
   */
  it('un FORMATEUR est refusé, et rien ne change en base', async () => {
    await creerCompte(ROLES.FORMATEUR, 'formateur@edtpro.ma', '18688');
    const cookies = await connecter('formateur@edtpro.ma');

    const reponse = await request(app)
      .patch('/api/v2/auth/profil')
      .set('Cookie', cookies)
      .send({ nomComplet: 'Nouveau Nom', email: 'formateur-modifie@edtpro.ma' });

    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('PROFIL_NON_MODIFIABLE');

    const utilisateur = await User.findOne({ email: 'formateur@edtpro.ma' });
    expect(utilisateur.nomComplet).toBe('Nom Initial');
  });

  it('un STAGIAIRE est refusé, et rien ne change en base', async () => {
    await creerCompte(ROLES.STAGIAIRE, 'stagiaire@edtpro.ma', '1996102900204');
    const cookies = await connecter('stagiaire@edtpro.ma');

    const reponse = await request(app)
      .patch('/api/v2/auth/profil')
      .set('Cookie', cookies)
      .send({ nomComplet: 'Nouveau Nom', email: 'stagiaire-modifie@edtpro.ma' });

    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('PROFIL_NON_MODIFIABLE');

    const utilisateur = await User.findOne({ email: 'stagiaire@edtpro.ma' });
    expect(utilisateur.nomComplet).toBe('Nom Initial');
  });

  it('refuse sans session', async () => {
    const reponse = await request(app)
      .patch('/api/v2/auth/profil')
      .send({ nomComplet: 'X', email: 'x@edtpro.ma' });

    expect(reponse.status).toBe(401);
  });
});
