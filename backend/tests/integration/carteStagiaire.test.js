import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import JSZip from 'jszip';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Stagiaire } from '../../src/models/Stagiaire.js';
import { creerJetonCarte } from '../../src/modules/auth/jetonCarte.js';
import { anneeScolaireCourante } from 'shared/domain';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * ═══ LA CARTE DE STAGIAIRE ET SON QR (2026-10-11) ═══ Le QR connecte à la
 * session du stagiaire : il doit le faire pour la BONNE carte, et pour elle
 * seule — jamais pour un jeton fabriqué, une carte renouvelée, une année passée
 * ou un compte qui n'est pas celui d'un stagiaire.
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = anneeScolaireCourante();

let etablissement;
let directeur;
let stagiaire;
let cookiesDirecteur;

const compte = (role, email, extra = {}) =>
  User.create({
    nomComplet: email.split('@')[0].toUpperCase(),
    email,
    motDePasse: MOT_DE_PASSE,
    role,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
    ...extra,
  });

const jetonDe = (utilisateur, surcharges = {}) =>
  creerJetonCarte({ utilisateurId: String(utilisateur._id), version: 1, anneeScolaire: ANNEE, ...surcharges });

const scanner = (jeton) => request(app).post('/api/v2/auth/carte').send({ jeton });

beforeEach(async () => {
  directeur = await compte(ROLES.DIRECTEUR, 'directeur@edtpro.ma');
  etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Test',
    nomAbrege: 'ISTA TEST',
    anneeScolaire: ANNEE,
  });
  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  stagiaire = await compte(ROLES.STAGIAIRE, 'cef001@ofppt-edu.ma', {
    identifiant: 'CEF001',
    etablissementIds: [etablissement.id],
  });
  await Stagiaire.create([
    { matricule: 'CEF001', nom: 'ALAOUI', prenom: 'Yassine', niveau: 'TS', annee: '1A', groupes: ['GM101'] },
    // Sans compte : sa carte n'aura pas de QR.
    { matricule: 'CEF002', nom: 'BENANI', prenom: 'Sara', groupes: ['GM101'] },
  ].map((s) => ({ ...s, etablissementId: etablissement.id, anneeScolaire: ANNEE })));

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookiesDirecteur = connexion.headers['set-cookie'];
});

describe('POST /auth/carte — la connexion par le QR', () => {
  it('ouvre la session du stagiaire avec un jeton valide', async () => {
    const reponse = await scanner(jetonDe(stagiaire));
    expect(reponse.status).toBe(200);
    expect(reponse.body.utilisateur.role).toBe(ROLES.STAGIAIRE);
    expect(reponse.headers['set-cookie']?.length).toBeGreaterThan(0);
  });

  it('refuse un jeton altéré, un compte qui n’est pas stagiaire, une année passée', async () => {
    const valide = jetonDe(stagiaire);
    const altere = `${valide.slice(0, -1)}${valide.endsWith('A') ? 'B' : 'A'}`;

    for (const jeton of [altere, jetonDe(directeur), jetonDe(stagiaire, { anneeScolaire: ANNEE - 1 }), 'n-importe-quoi-ici']) {
      const reponse = await scanner(jeton);
      expect(reponse.status).toBe(jeton === 'n-importe-quoi-ici' ? 401 : 401);
      expect(reponse.body.code).toBe('CARTE_INVALIDE');
    }
  });

  it('refuse un compte stagiaire désactivé', async () => {
    await User.updateOne({ _id: stagiaire._id }, { $set: { estActif: false } });
    const reponse = await scanner(jetonDe(stagiaire));
    expect(reponse.status).toBe(403);
  });
});

describe('POST /absences-stagiaires/cartes — les cartes', () => {
  const exporter = (corps, cookies = cookiesDirecteur) =>
    request(app)
      .post('/api/v2/absences-stagiaires/cartes')
      .set('Cookie', cookies)
      // `responseType('blob')` : superagent rend lui-même le corps en Buffer.
      .responseType('blob')
      .send(corps);

  it('pose un QR sur la carte d’un stagiaire qui a un compte, et le dit pour celui qui n’en a pas', async () => {
    const reponse = await exporter({ format: 'docx', groupes: ['GM101'] });
    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-disposition']).toContain('Cartes_stagiaires_GM101.docx');

    const zip = await JSZip.loadAsync(reponse.body);
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('ALAOUI Yassine');
    expect(xml).toContain('BENANI Sara');
    expect(xml).toContain('Compte non créé');
    // Un seul QR : celui du stagiaire qui a un compte.
    expect(Object.keys(zip.files).filter((nom) => /^word\/media\/qr\d+\.png$/.test(nom))).toHaveLength(1);
  });

  it('« renouveler » invalide la carte déjà imprimée', async () => {
    const ancienne = jetonDe(stagiaire);
    expect((await scanner(ancienne)).status).toBe(200);

    expect((await exporter({ format: 'docx', groupes: ['GM101'], renouveler: true })).status).toBe(200);
    expect((await User.findById(stagiaire._id)).versionCarte).toBe(2);

    const refus = await scanner(ancienne);
    expect(refus.status).toBe(401);
    expect((await scanner(jetonDe(stagiaire, { version: 2 }))).status).toBe(200);
  });

  it('est réservé à l’encadrement', async () => {
    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: 'cef001@ofppt-edu.ma', motDePasse: MOT_DE_PASSE });
    // Une erreur JSON : lue sans le parseur binaire (le « double callback » de superagent).
    const refus = await request(app)
      .post('/api/v2/absences-stagiaires/cartes')
      .set('Cookie', connexion.headers['set-cookie'])
      .send({ format: 'docx', groupes: ['GM101'] });
    expect(refus.status).toBe(403);
  });
});

/*
 * ═══ L'ADRESSE DU LIEN DU QR (2026-10-11, signalé par le porteur : le QR menait
 * à l'ANCIEN EDT Pro, « edtpro.ma ») ═══ Le lien part de l'application qui
 * demande les cartes — si son adresse est reconnue —, sinon d'`APP_URL`.
 */
describe('adresseDesLiens — où mène le QR', () => {
  const charger = () => import('../../src/modules/absencesStagiaires/exportCarteStagiaire.service.js');

  it('retient l’adresse de l’écran quand le navigateur l’atteste (Origin ou Referer), ou qu’elle est autorisée', async () => {
    const { adresseDesLiens } = await charger();
    const ici = 'https://edt.exemple.test';
    expect(adresseDesLiens({ demandee: ici, origine: ici })).toBe(ici);
    // Un GET de même origine n'a pas d'Origin : le Referer atteste.
    expect(adresseDesLiens({ demandee: `${ici}/`, referent: `${ici}/app/documents` })).toBe(ici);
    // `HTTP_ORIGINES` vaut « https://front.test » en test (vitest.config.js).
    expect(adresseDesLiens({ demandee: 'https://front.test' })).toBe('https://front.test');
  });

  it('n’accepte pas une adresse que rien n’atteste, et se rabat sur Origin, Referer puis APP_URL', async () => {
    const { adresseDesLiens } = await charger();
    const { env } = await import('../../src/config/env.js');
    const appUrl = env.APP_URL.replace(/\/+$/, '');
    expect(adresseDesLiens({ demandee: 'https://pirate.test', origine: 'https://edt.exemple.test' })).toBe(
      'https://edt.exemple.test'
    );
    expect(adresseDesLiens({ demandee: 'https://pirate.test' })).toBe(appUrl);
    expect(adresseDesLiens({ referent: 'https://edt.exemple.test/app' })).toBe('https://edt.exemple.test');
    expect(adresseDesLiens({})).toBe(appUrl);
  });
});

describe('GET /absences-stagiaires/cartes/liens — le QR de la fiche stagiaire', () => {
  it('rend le lien et le QR des stagiaires qui ont un compte, à l’adresse de l’écran', async () => {
    const reponse = await request(app)
      .get('/api/v2/absences-stagiaires/cartes/liens?groupe=GM101&adresse=https://front.test')
      .set('Cookie', cookiesDirecteur);
    expect(reponse.status).toBe(200);
    expect(reponse.body.liens).toHaveLength(1);
    const [lien] = reponse.body.liens;
    expect(lien.matricule).toBe('CEF001');
    expect(lien.lien.startsWith('https://front.test/carte/')).toBe(true);
    expect(lien.qr.startsWith('data:image/png;base64,')).toBe(true);

    // Le lien de la fiche connecte, comme la carte.
    const jeton = lien.lien.split('/carte/')[1];
    expect((await scanner(jeton)).status).toBe(200);
  });
});
