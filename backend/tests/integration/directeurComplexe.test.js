import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { AuditLog, ACTIONS_AUDIT } from '../../src/models/AuditLog.js';
import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * ═══ DIRECTEUR DE COMPLEXE (2026-10-27) ═══
 * Créé par un directeur depuis « Sessions » ; il ne CONSULTE que les
 * établissements de son complexe qui l'ont autorisé — en lecture seule.
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;
const SEMAINE = '2026-W3';

const etablissements = {};
const cookies = {};

async function directeur(email, etablissement) {
  return User.create({
    nomComplet: `DIRECTEUR ${email}`,
    email,
    motDePasse: MOT_DE_PASSE,
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
    configurationTerminee: true,
    etablissementIds: [etablissement.id],
  });
}

async function seConnecter(email) {
  const reponse = await request(app).post('/api/v2/auth/connexion').send({ identifiant: email, motDePasse: MOT_DE_PASSE });
  expect(reponse.status).toBe(200);
  return reponse.headers['set-cookie'];
}

/** Une requête au nom de `qui`, dans l'établissement `ou`. */
const en = (qui, ou) => {
  const avec = (r) =>
    r.set('Cookie', cookies[qui]).set('X-Annee-Scolaire', String(ANNEE)).set('X-Etablissement-Id', etablissements[ou].id);
  return {
    get: (url) => avec(request(app).get(url)),
    post: (url, corps) => avec(request(app).post(url)).send(corps),
    put: (url, corps) => avec(request(app).put(url)).send(corps),
    delete: (url) => avec(request(app).delete(url)),
  };
};

async function etablissement(nom, complexe) {
  const proprietaire = await User.create({
    nomComplet: `PROPRIETAIRE ${nom}`,
    email: `proprio.${nom.toLowerCase()}@edtpro.ma`,
    motDePasse: MOT_DE_PASSE,
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
  return Etablissement.create({
    proprietaireId: proprietaire.id,
    region: 'Casablanca-Settat',
    complexe,
    nom,
    anneeScolaire: ANNEE,
    espaces: ['A12'],
  });
}

beforeEach(async () => {
  etablissements.a = await etablissement('ISTA A', 'Complexe Ben Msik');
  etablissements.b = await etablissement('ISTA B', 'Complexe Ben Msik');
  etablissements.c = await etablissement('ISTA C', 'Complexe Hay Hassani');

  for (const cle of ['a', 'b', 'c']) {
    await directeur(`dir.${cle}@edtpro.ma`, etablissements[cle]);
    cookies[cle] = await seConnecter(`dir.${cle}@edtpro.ma`);
    await Base.create({
      etablissementId: etablissements[cle].id,
      anneeScolaire: ANNEE,
      formateurs: [{ matricule: '9863', nomComplet: 'BRAHIM LOURID' }],
      groupes: ['GM101'],
      affectations: [{ formateur: '9863', groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 }],
    });
  }
});

async function creerCompteComplexe() {
  const reponse = await en('a', 'a').post('/api/v2/complexe/comptes', {
    nomComplet: 'Directeur Complexe',
    email: 'complexe@edtpro.ma',
    motDePasse: MOT_DE_PASSE,
  });
  expect(reponse.status).toBe(201);
  cookies.dc = await seConnecter('complexe@edtpro.ma');
  return reponse.body.compte;
}

describe('directeur de complexe', () => {
  it('est créé par un directeur, autorisé d’emblée sur son établissement, et tracé', async () => {
    const compte = await creerCompteComplexe();
    expect(compte).toMatchObject({ nomComplet: 'Directeur Complexe', autorise: true, creeParMoi: true, etablissements: ['ISTA A'] });
    const enBase = await User.findById(compte.id).lean();
    expect(enBase.role).toBe(ROLES.DIRECTEUR_COMPLEXE);
    expect(await AuditLog.countDocuments({ action: ACTIONS_AUDIT.COMPLEXE_COMPTE_CREE })).toBe(1);
  });

  it('ne consulte que les établissements qui l’ont autorisé', async () => {
    await creerCompteComplexe();

    expect((await en('dc', 'a').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(200);
    const refuse = await en('dc', 'b').get(`/api/v2/seances/${SEMAINE}`);
    expect(refuse.status).toBe(403);

    const tableau = await request(app).get('/api/v2/complexe/tableau').set('Cookie', cookies.dc);
    expect(tableau.status).toBe(200);
    expect(tableau.body.etablissements.map((e) => e.nom)).toEqual(['ISTA A']);
    expect(tableau.body.etablissements[0].effectifs).toEqual({ groupes: 1, formateurs: 1, affectations: 1 });
  });

  // L'accord global : le directeur de B autorise, le compte voit B ; il retire, B disparaît.
  it('voit un établissement du complexe quand son directeur l’autorise, et le perd au retrait', async () => {
    const compte = await creerCompteComplexe();

    const vu = await en('b', 'b').get('/api/v2/complexe/comptes');
    expect(vu.body.comptes).toEqual([expect.objectContaining({ id: compte.id, autorise: false, creeParMoi: false })]);

    const autorise = await en('b', 'b').post(`/api/v2/complexe/comptes/${compte.id}/autoriser`);
    expect(autorise.body.compte).toMatchObject({ autorise: true, etablissements: ['ISTA A', 'ISTA B'] });
    expect((await en('dc', 'b').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(200);

    await en('b', 'b').post(`/api/v2/complexe/comptes/${compte.id}/retirer`);
    expect((await en('dc', 'b').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(403);
    expect(await AuditLog.countDocuments({ action: ACTIONS_AUDIT.COMPLEXE_ACCES_RETIRE })).toBe(1);
  });

  // Un autre complexe n'en sait rien : ni la liste, ni l'autorisation.
  it('reste invisible à un directeur d’un autre complexe', async () => {
    const compte = await creerCompteComplexe();
    expect((await en('c', 'c').get('/api/v2/complexe/comptes')).body.comptes).toEqual([]);
    expect((await en('c', 'c').post(`/api/v2/complexe/comptes/${compte.id}/autoriser`)).status).toBe(404);
  });

  it('ne peut rien écrire, même sur un établissement qui l’a autorisé', async () => {
    await creerCompteComplexe();
    const ecriture = await en('dc', 'a').put(`/api/v2/seances/${SEMAINE}/case`, {
      jour: 'Lundi',
      seance: 'S1',
      periode: 'jour',
      formateurMatricule: '9863',
      groupe: 'GM101',
      module: 'M101',
      salle: 'A12',
    });
    expect(ecriture.status).toBe(403);
    expect(ecriture.body.code).toBe('LECTURE_SEULE');
    // Ni les comptes de l'établissement (des noms), ni ses réglages.
    expect((await en('dc', 'a').get('/api/v2/comptes')).status).toBe(403);
  });

  it('n’est supprimé que par l’établissement qui l’a créé', async () => {
    const compte = await creerCompteComplexe();
    await en('b', 'b').post(`/api/v2/complexe/comptes/${compte.id}/autoriser`);
    expect((await en('b', 'b').delete(`/api/v2/complexe/comptes/${compte.id}`)).status).toBe(403);
    expect((await en('a', 'a').delete(`/api/v2/complexe/comptes/${compte.id}`)).status).toBe(200);
    expect(await User.exists({ _id: compte.id })).toBeNull();
  });

  it('refuse une adresse déjà utilisée', async () => {
    await creerCompteComplexe();
    const doublon = await en('b', 'b').post('/api/v2/complexe/comptes', {
      nomComplet: 'Autre',
      email: 'complexe@edtpro.ma',
      motDePasse: MOT_DE_PASSE,
    });
    expect(doublon.status).toBe(409);
  });
});

/*
 * ═══ ÉTAPE 2 (2026-10-27) — FORMATEURS, ESPACES, ABSENCES, MESSAGERIE ═══
 * Toujours sur les établissements autorisés seuls, et sans aucun nom de stagiaire.
 */
describe('directeur de complexe — étape 2', () => {
  const dc = (url) => request(app).get(url).set('Cookie', cookies.dc);

  it('voit les formateurs mutualisés entre deux établissements qui l’ont autorisé', async () => {
    const compte = await creerCompteComplexe();
    await en('b', 'b').post(`/api/v2/complexe/comptes/${compte.id}/autoriser`);

    const reponse = await dc('/api/v2/complexe/formateurs');
    expect(reponse.status).toBe(200);
    const brahim = reponse.body.formateurs.find((f) => f.matricule === '9863');
    expect(brahim).toMatchObject({ mutualise: true, heuresAffectees: 60 });
    expect(brahim.parEtablissement.map((e) => e.etablissement)).toEqual(['ISTA A', 'ISTA B']);
  });

  it('compte les absences en chiffres, sans un nom, et seulement chez qui l’a autorisé', async () => {
    await creerCompteComplexe();
    const { AbsenceStagiaire } = await import('../../src/models/AbsenceStagiaire.js');
    for (const cle of ['a', 'c']) {
      await AbsenceStagiaire.create({
        etablissementId: etablissements[cle].id,
        anneeScolaire: ANNEE,
        matricule: 'S001',
        nomComplet: 'STAGIAIRE SECRET',
        groupe: 'GM101',
        date: '2026-10-05',
        semaine: SEMAINE,
        jour: 'Lundi',
        seance: 'S1',
        typeAbsence: 'absence',
        justifiee: true,
      });
    }

    const reponse = await dc('/api/v2/complexe/absences');
    expect(reponse.status).toBe(200);
    expect(reponse.body.etablissements).toHaveLength(1);
    expect(reponse.body.etablissements[0].stagiaires).toMatchObject({ absences: 1, retards: 0, justifiees: 1 });
    expect(JSON.stringify(reponse.body)).not.toContain('STAGIAIRE SECRET');
  });

  it('dit l’occupation des salles de la semaine en cours', async () => {
    await creerCompteComplexe();
    const reponse = await dc('/api/v2/complexe/espaces');
    expect(reponse.status).toBe(200);
    expect(reponse.body.creneauxParSemaine).toBe(24);
    expect(reponse.body.etablissements[0].salles).toEqual([{ nom: 'A12', creneaux: 0, taux: 0 }]);
  });

  // Ces résumés lui sont réservés : un directeur d'établissement n'y a pas accès.
  it('refuse ces résumés à un autre rôle', async () => {
    expect((await en('a', 'a').get('/api/v2/complexe/formateurs')).status).toBe(403);
  });

  it('écrit aux directeurs qui l’ont autorisé, et à eux seuls', async () => {
    await creerCompteComplexe();
    const reponse = await dc('/api/v2/messages/correspondants');
    expect(reponse.status).toBe(200);
    const correspondants = reponse.body.correspondants ?? reponse.body;
    expect(correspondants.map((c) => c.email)).toEqual(['dir.a@edtpro.ma']);
  });
});
