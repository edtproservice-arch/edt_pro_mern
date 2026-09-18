import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

// Le mailer est remplacé : aucun courriel réel, et le code à 6 chiffres devient
// observable (il est haché en base, donc illisible autrement).
const { envois } = vi.hoisted(() => ({ envois: [] }));
vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async (message) => {
    envois.push(message);
    return { envoye: true };
  }),
}));

const app = createApp();

const INSCRIPTION = {
  nomComplet: 'Mouad Directeur',
  region: 'Fès-Meknès',
  complexe: 'CF Bâtiment',
  nomEtablissement: 'ISTA NARGISS FES',
  email: 'directeur@edtpro.ma',
  telephone: '0612345678',
  motDePasse: 'MotDePasse2026',
  confirmation: 'MotDePasse2026',
};

function dernierCode() {
  return /(\d{6})/.exec(envois.at(-1).texte)[1];
}

/** Inscrit puis vérifie l'e-mail et approuve le compte, comme le ferait l'admin. */
async function compteApprouve() {
  await request(app).post('/api/v2/auth/inscription').send(INSCRIPTION);
  await request(app)
    .post('/api/v2/auth/verification')
    .send({ email: INSCRIPTION.email, code: dernierCode(), type: 'email' });

  await User.updateOne(
    { email: INSCRIPTION.email },
    { statut: STATUTS_COMPTE.APPROUVE, dateApprobation: new Date() }
  );
}

beforeEach(() => {
  envois.length = 0;
});

describe('POST /api/v2/auth/inscription', () => {
  it("crée le compte et son établissement, et envoie un code de vérification", async () => {
    const reponse = await request(app).post('/api/v2/auth/inscription').send(INSCRIPTION);

    expect(reponse.status).toBe(201);
    expect(reponse.body.success).toBe(true);

    const utilisateur = await User.findOne({ email: INSCRIPTION.email });
    expect(utilisateur.role).toBe(ROLES.DIRECTEUR);
    expect(utilisateur.statut).toBe(STATUTS_COMPTE.EN_ATTENTE);
    expect(utilisateur.estVerifie).toBe(false);

    const etablissement = await Etablissement.findById(utilisateur.etablissementIds[0]);
    expect(etablissement.nom).toBe(INSCRIPTION.nomEtablissement);

    expect(envois).toHaveLength(1);
  });

  it('ne renvoie jamais le hash du mot de passe', async () => {
    const reponse = await request(app).post('/api/v2/auth/inscription').send(INSCRIPTION);
    expect(JSON.stringify(reponse.body)).not.toContain('$2');
    expect(reponse.body.utilisateur.motDePasse).toBeUndefined();
  });

  it('stocke le mot de passe haché, jamais en clair', async () => {
    await request(app).post('/api/v2/auth/inscription').send(INSCRIPTION);

    const utilisateur = await User.findOne({ email: INSCRIPTION.email }).select('+motDePasse');
    expect(utilisateur.motDePasse).not.toBe(INSCRIPTION.motDePasse);
    expect(utilisateur.motDePasse).toMatch(/^\$2[aby]\$/);
  });

  it('refuse un mot de passe qui ne respecte pas la politique', async () => {
    const reponse = await request(app)
      .post('/api/v2/auth/inscription')
      .send({ ...INSCRIPTION, motDePasse: 'faible', confirmation: 'faible' });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('VALIDATION_ERROR');
  });

  it('refuse une adresse déjà utilisée', async () => {
    await request(app).post('/api/v2/auth/inscription').send(INSCRIPTION);
    const reponse = await request(app).post('/api/v2/auth/inscription').send(INSCRIPTION);

    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('EMAIL_EXISTANT');
  });
});

describe('POST /api/v2/auth/connexion', () => {
  it('refuse tant que le compte n\'est pas vérifié', async () => {
    await request(app).post('/api/v2/auth/inscription').send(INSCRIPTION);

    const reponse = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: INSCRIPTION.email, motDePasse: INSCRIPTION.motDePasse });

    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('COMPTE_NON_VERIFIE');
  });

  it('ouvre une session et pose les cookies après approbation', async () => {
    await compteApprouve();

    const reponse = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: INSCRIPTION.email, motDePasse: INSCRIPTION.motDePasse });

    expect(reponse.status).toBe(200);
    expect(reponse.body.action).toBe('connecte');

    const cookies = reponse.headers['set-cookie'].join(';');
    expect(cookies).toContain('edt_access');
    expect(cookies).toContain('edt_refresh');
    // Les deux cookies doivent être inaccessibles au JavaScript de la page.
    expect(reponse.headers['set-cookie'].every((c) => c.includes('HttpOnly'))).toBe(true);
  });

  it('donne le même message pour un compte inconnu et un mot de passe faux', async () => {
    await compteApprouve();

    const inconnu = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: 'personne@edtpro.ma', motDePasse: 'MotDePasse2026' });
    const mauvais = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: INSCRIPTION.email, motDePasse: 'MauvaisMotDePasse1' });

    expect(inconnu.status).toBe(401);
    expect(mauvais.status).toBe(401);
    expect(inconnu.body.message).toBe(mauvais.body.message);
  });
});

describe('Session', () => {
  it('/moi répond avec le cookie, et refuse sans', async () => {
    await compteApprouve();

    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: INSCRIPTION.email, motDePasse: INSCRIPTION.motDePasse });

    const cookies = connexion.headers['set-cookie'];

    const avecCookie = await request(app).get('/api/v2/auth/moi').set('Cookie', cookies);
    expect(avecCookie.status).toBe(200);
    expect(avecCookie.body.utilisateur.email).toBe(INSCRIPTION.email);

    /*
     * ⚠️ RÉGRESSION CORRIGÉE (2026-09-04) : « Mon emploi du temps » d'un
     * formateur affichait une grille VIDE malgré des séances réelles, faute de
     * ce champ. `PageMonEmploi.jsx` construit `sujets = [utilisateur.identifiant]`
     * pour isoler SA ligne dans la grille — `presenter()` l'omettait, et la
     * clé valait `undefined` (d'où aussi l'avertissement React sur la clé de
     * liste). Ce n'est pas une donnée sensible : c'est le propre identifiant
     * de connexion de la personne, déjà exposé au même titre que son e-mail.
     */
    expect('identifiant' in avecCookie.body.utilisateur).toBe(true);

    const sansCookie = await request(app).get('/api/v2/auth/moi');
    expect(sansCookie.status).toBe(401);
    expect(sansCookie.body.code).toBe('NON_AUTHENTIFIE');
  });

  it('liste l\'appareil connecté et le marque comme courant', async () => {
    await compteApprouve();
    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: INSCRIPTION.email, motDePasse: INSCRIPTION.motDePasse });

    const reponse = await request(app)
      .get('/api/v2/auth/appareils')
      .set('Cookie', connexion.headers['set-cookie']);

    expect(reponse.status).toBe(200);
    expect(reponse.body.appareils).toHaveLength(1);
    expect(reponse.body.appareils[0].courant).toBe(true);
  });

  it('la déconnexion révoque le refresh token', async () => {
    await compteApprouve();
    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: INSCRIPTION.email, motDePasse: INSCRIPTION.motDePasse });

    const cookies = connexion.headers['set-cookie'];
    await request(app).post('/api/v2/auth/deconnexion').set('Cookie', cookies);

    // Le refresh doit désormais échouer : la session n'existe plus côté serveur.
    const rafraichir = await request(app).post('/api/v2/auth/rafraichir').set('Cookie', cookies);
    expect(rafraichir.status).toBe(401);
  });

  it('fait tourner le refresh token : l\'ancien devient inutilisable', async () => {
    await compteApprouve();
    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: INSCRIPTION.email, motDePasse: INSCRIPTION.motDePasse });

    const anciensCookies = connexion.headers['set-cookie'];

    const premier = await request(app).post('/api/v2/auth/rafraichir').set('Cookie', anciensCookies);
    expect(premier.status).toBe(200);

    const rejeu = await request(app).post('/api/v2/auth/rafraichir').set('Cookie', anciensCookies);
    expect(rejeu.status).toBe(401);
    expect(rejeu.body.code).toBe('REFRESH_INVALIDE');
  });
});

describe('Codes de vérification', () => {
  it('rejette un code erroné puis invalide la demande après 5 essais', async () => {
    await request(app).post('/api/v2/auth/inscription').send(INSCRIPTION);

    for (let essai = 0; essai < 5; essai += 1) {
      const reponse = await request(app)
        .post('/api/v2/auth/verification')
        .send({ email: INSCRIPTION.email, code: '000000', type: 'email' });
      expect(reponse.body.code).toBe('CODE_INVALIDE');
    }

    // La demande a été détruite : même le bon code ne fonctionne plus.
    const apres = await request(app)
      .post('/api/v2/auth/verification')
      .send({ email: INSCRIPTION.email, code: dernierCode(), type: 'email' });

    expect(apres.status).toBe(400);
    expect(apres.body.code).toBe('CODE_EXPIRE');
  });
});
