import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';
import { createApp } from '../../src/app.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Message } from '../../src/models/Message.js';
import { User } from '../../src/models/User.js';
import { Stagiaire } from '../../src/models/Stagiaire.js';
import { remettreAnnoncesProgrammees } from '../../src/modules/annonces/annonces.service.js';

/** Annonces du bandeau passant, doublées en messagerie (2026-10-10). */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const FIN = '2099-12-31';

let ista;
let autre;
const cookies = {};
const comptes = {};

const creer = (champs) =>
  User.create({ motDePasse: MOT_DE_PASSE, statut: STATUTS_COMPTE.APPROUVE, estVerifie: true, ...champs });
const connexion = async (email) =>
  (await request(app).post('/api/v2/auth/connexion').send({ identifiant: email, motDePasse: MOT_DE_PASSE })).headers['set-cookie'];

beforeEach(async () => {
  comptes.admin = await creer({ nomComplet: 'Admin', email: 'admin@edtpro.ma', role: ROLES.ADMIN });
  comptes.directeur = await creer({ nomComplet: 'Directeur ISTA', email: 'directeur@edtpro.ma', role: ROLES.DIRECTEUR });
  comptes.directeurAutre = await creer({ nomComplet: 'Directeur Autre', email: 'directeur2@edtpro.ma', role: ROLES.DIRECTEUR });

  const etab = (proprietaire, nom) =>
    Etablissement.create({ proprietaireId: proprietaire.id, region: 'Fès-Meknès', complexe: 'CF', nom, anneeScolaire: 2026 });
  ista = await etab(comptes.directeur, 'ISTA Test');
  autre = await etab(comptes.directeurAutre, 'ISTA Autre');
  comptes.directeur.etablissementIds = [ista.id];
  await comptes.directeur.save();
  comptes.directeurAutre.etablissementIds = [autre.id];
  await comptes.directeurAutre.save();

  comptes.gestionnaire = await creer({ nomComplet: 'Gestionnaire', email: 'gest@edtpro.ma', role: ROLES.GESTIONNAIRE, etablissementIds: [ista.id] });
  comptes.formateur = await creer({ nomComplet: 'Formateur', email: 'form@edtpro.ma', identifiant: '9863', role: ROLES.FORMATEUR, etablissementIds: [ista.id] });
  comptes.formateurAutre = await creer({ nomComplet: 'Formateur Autre', email: 'form2@edtpro.ma', identifiant: '1111', role: ROLES.FORMATEUR, etablissementIds: [autre.id] });
  comptes.stagiaire = await creer({ nomComplet: 'Stagiaire', email: 'stag@edtpro.ma', identifiant: 'CEF001', role: ROLES.STAGIAIRE, etablissementIds: [ista.id] });

  for (const [cle, email] of [
    ['admin', 'admin@edtpro.ma'],
    ['directeur', 'directeur@edtpro.ma'],
    ['directeurAutre', 'directeur2@edtpro.ma'],
    ['gestionnaire', 'gest@edtpro.ma'],
    ['formateur', 'form@edtpro.ma'],
    ['formateurAutre', 'form2@edtpro.ma'],
    ['stagiaire', 'stag@edtpro.ma'],
  ]) {
    cookies[cle] = await connexion(email);
  }
});

const mes = async (cle) => (await request(app).get('/api/v2/annonces/mes').set('Cookie', cookies[cle])).body.annonces;

describe('annonces', () => {
  it('directeur → formateurs de SON établissement, en bandeau et en messagerie', async () => {
    const reponse = await request(app)
      .post('/api/v2/annonces')
      .set('Cookie', cookies.directeur)
      .send({ texte: 'Réunion pédagogique jeudi 10 h', importance: 'importante', fin: FIN });

    expect(reponse.status).toBe(201);
    expect(reponse.body.remis).toBe(1);
    expect((await mes('formateur')).map((a) => a.texte)).toEqual(['Réunion pédagogique jeudi 10 h']);
    expect(await mes('formateurAutre')).toEqual([]);

    const message = await Message.findOne({ destinataireId: comptes.formateur._id }).lean();
    expect(message.sujet).not.toContain('[');
    expect(message.annonce).toMatchObject({ importance: 'importante' });
  });

  it('gestionnaire → stagiaires', async () => {
    const reponse = await request(app)
      .post('/api/v2/annonces')
      .set('Cookie', cookies.gestionnaire)
      .send({ texte: 'Port de la blouse obligatoire', importance: 'urgente', fin: FIN });

    expect(reponse.status).toBe(201);
    expect((await mes('stagiaire'))[0]).toMatchObject({ importance: 'urgente', texte: 'Port de la blouse obligatoire' });
    // Rien pour les formateurs : la cible suit le rôle de l'auteur.
    expect(await mes('formateur')).toEqual([]);
  });

  it('admin → tous les directeurs, ou ceux des établissements choisis', async () => {
    await request(app).post('/api/v2/annonces/admin').set('Cookie', cookies.admin).send({ texte: 'Maintenance samedi', fin: FIN });
    await request(app)
      .post('/api/v2/annonces/admin')
      .set('Cookie', cookies.admin)
      .send({ texte: 'Pour ISTA Test seulement', fin: FIN, etablissementIds: [ista.id] });

    expect((await mes('directeur')).map((a) => a.texte).sort()).toEqual(['Maintenance samedi', 'Pour ISTA Test seulement']);
    expect((await mes('directeurAutre')).map((a) => a.texte)).toEqual(['Maintenance samedi']);
  });

  it('directeur → seulement les formateurs choisis', async () => {
    const second = await creer({ nomComplet: 'Formateur Deux', email: 'form3@edtpro.ma', identifiant: '2222', role: ROLES.FORMATEUR, etablissementIds: [ista.id] });
    const cookiesSecond = await connexion('form3@edtpro.ma');

    const reponse = await request(app)
      .post('/api/v2/annonces')
      .set('Cookie', cookies.directeur)
      .send({ texte: 'Pour 9863 seulement', fin: FIN, matricules: ['9863'] });

    expect(reponse.body.remis).toBe(1);
    expect((await mes('formateur')).map((a) => a.texte)).toEqual(['Pour 9863 seulement']);
    const pourLeSecond = await request(app).get('/api/v2/annonces/mes').set('Cookie', cookiesSecond);
    expect(pourLeSecond.body.annonces).toEqual([]);
    expect(await Message.countDocuments({ destinataireId: second._id })).toBe(0);
  });

  it('gestionnaire → seulement les stagiaires des groupes choisis', async () => {
    await Stagiaire.create({ etablissementId: ista.id, anneeScolaire: 2026, matricule: 'CEF001', groupes: ['GM101'] });
    const autreStagiaire = await creer({ nomComplet: 'Stagiaire Deux', email: 'stag2@edtpro.ma', identifiant: 'CEF002', role: ROLES.STAGIAIRE, etablissementIds: [ista.id] });
    await Stagiaire.create({ etablissementId: ista.id, anneeScolaire: 2026, matricule: 'CEF002', groupes: ['GM102'] });
    const cookiesAutre = await connexion('stag2@edtpro.ma');

    const reponse = await request(app)
      .post('/api/v2/annonces')
      .set('Cookie', cookies.gestionnaire)
      .send({ texte: 'GM101 : examen lundi', fin: FIN, groupes: ['GM101'] });

    expect(reponse.body.remis).toBe(1);
    expect((await mes('stagiaire')).map((a) => a.texte)).toEqual(['GM101 : examen lundi']);
    expect((await request(app).get('/api/v2/annonces/mes').set('Cookie', cookiesAutre)).body.annonces).toEqual([]);
    expect(await Message.countDocuments({ destinataireId: autreStagiaire._id })).toBe(0);
  });

  it('refuse au stagiaire et au formateur d’en publier', async () => {
    for (const cle of ['stagiaire', 'formateur']) {
      const reponse = await request(app).post('/api/v2/annonces').set('Cookie', cookies[cle]).send({ texte: 'x', fin: FIN });
      expect(reponse.status).toBe(403);
    }
  });

  it('retirer l’ôte du bandeau, sans effacer le message remis', async () => {
    const { body } = await request(app)
      .post('/api/v2/annonces')
      .set('Cookie', cookies.directeur)
      .send({ texte: 'À retirer', fin: FIN });

    const retrait = await request(app).delete(`/api/v2/annonces/${body.annonce.id}`).set('Cookie', cookies.directeur);
    expect(retrait.status).toBe(200);
    expect(await mes('formateur')).toEqual([]);
    expect(await Message.countDocuments({ destinataireId: comptes.formateur._id })).toBe(1);
  });

  it('programmée : ni bandeau ni messagerie avant son jour, puis les deux', async () => {
    const reponse = await request(app)
      .post('/api/v2/annonces')
      .set('Cookie', cookies.directeur)
      .send({ texte: 'Programmée', debut: '2099-01-10', fin: '2099-01-20' });

    expect(reponse.body.programmee).toBe(true);
    expect(reponse.body.remis).toBe(0);
    expect(await mes('formateur')).toEqual([]);
    expect(await Message.countDocuments({ destinataireId: comptes.formateur._id })).toBe(0);

    // Le jour venu, la tâche horaire la remet — une seule fois.
    expect((await remettreAnnoncesProgrammees(new Date('2099-01-10T12:00:00'))).remis).toBe(1);
    expect((await remettreAnnoncesProgrammees(new Date('2099-01-11T12:00:00'))).remis).toBe(0);
    expect(await Message.countDocuments({ destinataireId: comptes.formateur._id })).toBe(1);
  });

  it('programmée puis annulée : aucun message ne part', async () => {
    const { body } = await request(app)
      .post('/api/v2/annonces')
      .set('Cookie', cookies.directeur)
      .send({ texte: 'Annulée', debut: '2099-01-10', fin: '2099-01-20' });
    await request(app).delete(`/api/v2/annonces/${body.annonce.id}`).set('Cookie', cookies.directeur);

    expect((await remettreAnnoncesProgrammees(new Date('2099-01-10T12:00:00'))).remis).toBe(0);
    expect(await Message.countDocuments({ destinataireId: comptes.formateur._id })).toBe(0);
  });

  it('une annonce expirée quitte le bandeau', async () => {
    await request(app)
      .post('/api/v2/annonces')
      .set('Cookie', cookies.directeur)
      .send({ texte: 'Passée', debut: '2020-01-01', fin: '2020-01-02' });
    expect(await mes('formateur')).toEqual([]);
  });
});
