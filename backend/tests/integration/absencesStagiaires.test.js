import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { Seance } from '../../src/models/Seance.js';
import { Stagiaire } from '../../src/models/Stagiaire.js';
import { AbsenceStagiaire } from '../../src/models/AbsenceStagiaire.js';
import { IndisciplineStagiaire } from '../../src/models/IndisciplineStagiaire.js';
import { AppelValidation } from '../../src/models/AppelValidation.js';
import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * L'appel des stagiaires et la note de discipline (F9), 2026-09-14.
 *
 * ⚠️ « AUJOURD'HUI » EST FIGÉ AU MERCREDI 16 SEPTEMBRE 2026 : l'appel refuse un
 * jour à venir, et ces tests ne doivent pas changer de sens avec le calendrier
 * réel. Seule `Date` est simulée — les minuteries restent vraies, sans quoi
 * mongodb-memory-server ne répond plus (piège déjà consigné).
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;
const SEMAINE = '2026-W3';
const LUNDI = '2026-09-14';
const MARDI = '2026-09-15';

let etablissement;
const cookies = {};

const creerCompte = (role, email, extra = {}) =>
  User.create({
    nomComplet: email.split('@')[0].toUpperCase(),
    email,
    motDePasse: MOT_DE_PASSE,
    role,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
    ...extra,
  });

const seance = (champs) =>
  Seance.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    semaine: SEMAINE,
    salle: 'A12',
    type: TYPES_COURS.PRESENTIEL,
    ...champs,
  });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-16T10:00:00'));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

  const directeur = await creerCompte(ROLES.DIRECTEUR, 'directeur@edtpro.ma');
  etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Test',
    anneeScolaire: ANNEE,
    espaces: ['A12'],
  });
  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  const dans = { etablissementIds: [etablissement.id] };
  await creerCompte(ROLES.GESTIONNAIRE, 'gestionnaire@edtpro.ma', dans);
  await creerCompte(ROLES.FORMATEUR, 'formateur@edtpro.ma', { ...dans, identifiant: '9863' });
  await creerCompte(ROLES.STAGIAIRE, 'stagiaire@edtpro.ma', { ...dans, identifiant: 'CEF001' });

  await Stagiaire.create([
    { matricule: 'CEF001', nom: 'ALAOUI', prenom: 'Yassine', groupes: ['GM101'], groupePrincipal: 'GM101' },
    { matricule: 'CEF002', nom: 'BENANI', prenom: 'Sara', groupes: ['GM101'], groupePrincipal: 'GM101' },
    { matricule: 'CEF003', nom: 'CHAFIK', prenom: 'Omar', groupes: ['GM102'], groupePrincipal: 'GM102' },
  ].map((s) => ({ ...s, etablissementId: etablissement.id, anneeScolaire: ANNEE })));

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [
      { matricule: '9863', nomComplet: 'BRAHIM LOURID' },
      { matricule: '4211', nomComplet: 'AHMED CHERKAOUI' },
    ],
    groupes: ['GM101', 'GM102'],
  });

  // Lundi : S1 est au formateur connecté, S2 à un collègue.
  await seance({ jour: 'Lundi', seance: 'S1', date: new Date(`${LUNDI}T00:00:00`), formateurMatricule: '9863', groupe: 'GM101', module: 'M101' });
  await seance({ jour: 'Lundi', seance: 'S2', date: new Date(`${LUNDI}T00:00:00`), formateurMatricule: '4211', groupe: 'GM101', module: 'M102' });
  // Mardi : S1 est une séance MUTUALISÉE, S2 un cours dont le formateur était absent.
  await seance({ jour: 'Mardi', seance: 'S1', date: new Date(`${MARDI}T00:00:00`), formateurMatricule: '9863', groupe: 'GM101 GM102', module: 'M101', salle: 'TEAMS', type: TYPES_COURS.SYNCHRONE });
  await seance({ jour: 'Mardi', seance: 'S2', date: new Date(`${MARDI}T00:00:00`), formateurMatricule: '4211', groupe: 'GM102', module: 'M102', statut: 'absent' });
  // Jeudi : un cours À VENIR.
  await seance({ jour: 'Jeudi', seance: 'S1', date: new Date('2026-09-17T00:00:00'), formateurMatricule: '9863', groupe: 'GM101', module: 'M101' });

  const connexion = async (email) =>
    (await request(app).post('/api/v2/auth/connexion').send({ identifiant: email, motDePasse: MOT_DE_PASSE }))
      .headers['set-cookie'];
  cookies.directeur = await connexion('directeur@edtpro.ma');
  cookies.gestionnaire = await connexion('gestionnaire@edtpro.ma');
  cookies.formateur = await connexion('formateur@edtpro.ma');
  cookies.stagiaire = await connexion('stagiaire@edtpro.ma');
});

afterEach(() => {
  vi.useRealTimers();
});

const appel = (qui, corps) =>
  request(app).put('/api/v2/absences-stagiaires/appel').set('Cookie', cookies[qui]).send(corps);

const validerAppel = (qui, corps) =>
  request(app).put('/api/v2/absences-stagiaires/appel/valider').set('Cookie', cookies[qui]).send(corps);

const lireAppel = (qui, { date, seance, groupe }) =>
  request(app)
    .get(`/api/v2/absences-stagiaires/appel?date=${date}&seance=${seance}&groupe=${encodeURIComponent(groupe)}`)
    .set('Cookie', cookies[qui]);

describe('les cours ouverts à l’appel', () => {
  it('un formateur ne voit que SES séances de la journée', async () => {
    const reponse = await request(app)
      .get(`/api/v2/absences-stagiaires/seances?date=${LUNDI}`)
      .set('Cookie', cookies.formateur);

    expect(reponse.status).toBe(200);
    expect(reponse.body.jour).toBe('Lundi');
    expect(reponse.body.semaine).toBe(SEMAINE);
    expect(reponse.body.seances.map((s) => s.seance)).toEqual(['S1']);
    expect(reponse.body.seances[0].formateur).toBe('BRAHIM LOURID');
  });

  it('le directeur voit tous les cours du groupe choisi', async () => {
    const reponse = await request(app)
      .get(`/api/v2/absences-stagiaires/seances?date=${LUNDI}&groupe=GM101`)
      .set('Cookie', cookies.directeur);

    expect(reponse.body.seances.map((s) => s.seance)).toEqual(['S1', 'S2']);
  });

  it('refuse un stagiaire (403)', async () => {
    const reponse = await request(app)
      .get(`/api/v2/absences-stagiaires/seances?date=${LUNDI}`)
      .set('Cookie', cookies.stagiaire);
    expect(reponse.status).toBe(403);
  });
});

describe('PUT /absences-stagiaires/appel', () => {
  it('marque absents et retards, avec le module et le formateur relus dans la séance', async () => {
    const reponse = await appel('formateur', {
      date: LUNDI,
      seance: 'S1',
      groupe: 'GM101',
      marques: [
        { matricule: 'CEF001', type: 'absence' },
        { matricule: 'CEF002', type: 'retard' },
      ],
    });

    expect(reponse.status).toBe(200);
    expect(reponse.body).toMatchObject({ absences: 1, retards: 1 });

    const absence = await AbsenceStagiaire.findOne({ matricule: 'CEF001' }).lean();
    expect(absence).toMatchObject({
      date: LUNDI,
      jour: 'Lundi',
      semaine: SEMAINE,
      seance: 'S1',
      groupe: 'GM101',
      module: 'M101',
      formateurMatricule: '9863',
      nomComplet: 'ALAOUI Yassine',
      typeAbsence: 'absence',
    });
  });

  it('un stagiaire remis « présent » est retiré, les autres restent', async () => {
    const marquer = (marques) => appel('formateur', { date: LUNDI, seance: 'S1', groupe: 'GM101', marques });
    await marquer([
      { matricule: 'CEF001', type: 'absence' },
      { matricule: 'CEF002', type: 'retard' },
    ]);
    await marquer([
      { matricule: 'CEF001', type: null },
      { matricule: 'CEF002', type: 'retard' },
    ]);

    const restantes = await AbsenceStagiaire.find().lean();
    expect(restantes.map((a) => a.matricule)).toEqual(['CEF002']);
  });

  it('passer d’absent à retard garde la justification déjà saisie', async () => {
    await appel('formateur', { date: LUNDI, seance: 'S1', groupe: 'GM101', marques: [{ matricule: 'CEF001', type: 'absence' }] });
    await AbsenceStagiaire.updateOne({ matricule: 'CEF001' }, { $set: { justifiee: true, motif: 'Certificat' } });
    await appel('formateur', { date: LUNDI, seance: 'S1', groupe: 'GM101', marques: [{ matricule: 'CEF001', type: 'retard' }] });

    const absence = await AbsenceStagiaire.findOne({ matricule: 'CEF001' }).lean();
    expect(absence).toMatchObject({ typeAbsence: 'retard', justifiee: true, motif: 'Certificat' });
  });

  it('une séance mutualisée réunit ses groupes, chacun garde le sien', async () => {
    const liste = await request(app)
      .get(`/api/v2/absences-stagiaires/appel?date=${MARDI}&seance=S1&groupe=GM101%20GM102`)
      .set('Cookie', cookies.formateur);
    expect(liste.body.stagiaires.map((s) => [s.matricule, s.groupe])).toEqual([
      ['CEF001', 'GM101'],
      ['CEF002', 'GM101'],
      ['CEF003', 'GM102'],
    ]);

    await appel('formateur', {
      date: MARDI,
      seance: 'S1',
      groupe: 'GM101 GM102',
      marques: [{ matricule: 'CEF003', type: 'absence' }],
    });
    const absence = await AbsenceStagiaire.findOne({ matricule: 'CEF003' }).lean();
    expect(absence).toMatchObject({ groupe: 'GM102', groupeSeance: 'GM101 GM102' });
  });

  it('refuse au formateur le cours d’un collègue, sans rien écrire', async () => {
    const reponse = await appel('formateur', {
      date: LUNDI,
      seance: 'S2',
      groupe: 'GM101',
      marques: [{ matricule: 'CEF001', type: 'absence' }],
    });
    expect(reponse.status).toBe(404);
    expect(reponse.body.code).toBe('SEANCE_INTROUVABLE');
    expect(await AbsenceStagiaire.countDocuments()).toBe(0);
  });

  it('le gestionnaire fait l’appel de n’importe quel cours', async () => {
    const reponse = await appel('gestionnaire', {
      date: LUNDI,
      seance: 'S2',
      groupe: 'GM101',
      marques: [{ matricule: 'CEF001', type: 'absence' }],
    });
    expect(reponse.status).toBe(200);
    // Le formateur de la SÉANCE, pas celui qui a fait l'appel.
    expect((await AbsenceStagiaire.findOne().lean()).formateurMatricule).toBe('4211');
  });

  it('refuse un stagiaire hors de la liste du cours', async () => {
    const reponse = await appel('directeur', {
      date: LUNDI,
      seance: 'S1',
      groupe: 'GM101',
      marques: [{ matricule: 'CEF003', type: 'absence' }],
    });
    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('STAGIAIRE_HORS_GROUPE');
    expect(await AbsenceStagiaire.countDocuments()).toBe(0);
  });

  it('refuse un cours dont le formateur était absent', async () => {
    const reponse = await appel('directeur', {
      date: MARDI,
      seance: 'S2',
      groupe: 'GM102',
      marques: [{ matricule: 'CEF003', type: 'absence' }],
    });
    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('CRENEAU_FERME');
  });

  it('refuse un jour à venir, un jour hors de l’année et un créneau sans cours', async () => {
    const corps = { seance: 'S1', groupe: 'GM101', marques: [] };
    expect((await appel('directeur', { ...corps, date: '2026-09-17' })).body.code).toBe('DATE_FUTURE');
    expect((await appel('directeur', { ...corps, date: '2026-08-01' })).body.code).toBe('DATE_HORS_ANNEE');
    expect((await appel('directeur', { ...corps, date: '2026-09-13' })).body.code).toBe('DATE_DIMANCHE');
    expect((await appel('directeur', { ...corps, date: LUNDI, seance: 'S4' })).body.code).toBe('SEANCE_INTROUVABLE');
  });

  it('refuse un champ que le serveur relit lui-même (corps strict)', async () => {
    const reponse = await appel('directeur', {
      date: LUNDI,
      seance: 'S1',
      groupe: 'GM101',
      module: 'M999',
      marques: [],
    });
    expect(reponse.status).toBe(400);
  });
});

describe('PUT /absences-stagiaires/appel/valider — le signe demandé par le porteur', () => {
  /*
   * ⚠️ TIMEOUT ÉLARGI : le replica-set à un seul nœud de
   * `mongodb-memory-server` met plusieurs secondes à valider chaque
   * transaction — deux appels dans un même test dépassent le délai par
   * défaut de vitest (20 s) sans qu'aucun bogue ne soit en cause.
   */
  it(
    'écrit les marques ET atteste l’appel en une seule fois',
    async () => {
      const reponse = await validerAppel('formateur', {
        date: LUNDI,
        seance: 'S1',
        groupe: 'GM101',
        marques: [{ matricule: 'CEF001', type: 'absence' }],
      });
      expect(reponse.status).toBe(200);
      expect(reponse.body).toMatchObject({ absences: 1 });
      expect(await AbsenceStagiaire.countDocuments()).toBe(1);

      const validation = await AppelValidation.findOne().lean();
      expect(validation).toMatchObject({ groupe: 'GM101', validateurNom: 'FORMATEUR' });

      const liste = await lireAppel('gestionnaire', { date: LUNDI, seance: 'S1', groupe: 'GM101' });
      expect(liste.body.validation).toMatchObject({ validateurNom: 'FORMATEUR' });
    },
    30000
  );

  /*
   * ⚠️ CELUI QUI A CLIQUÉ, PAS LE FORMATEUR DE LA SÉANCE (2026-09-29, bogue
   * signalé par le porteur : « validé par doit être le propriétaire de la
   * session qui a validé l'absence ») — le gestionnaire valide le cours d'un
   * AUTRE formateur (S2, cf. `beforeEach`) : le nom attesté doit être le
   * sien, jamais celui du formateur de la séance.
   */
  it(
    'nomme celui qui a cliqué « Valider », pas le formateur de la séance',
    async () => {
      const reponse = await validerAppel('gestionnaire', {
        date: LUNDI,
        seance: 'S2',
        groupe: 'GM101',
        marques: [{ matricule: 'CEF001', type: 'absence' }],
      });
      expect(reponse.status).toBe(200);

      const validation = await AppelValidation.findOne().lean();
      expect(validation).toMatchObject({ validateurNom: 'GESTIONNAIRE' });
    },
    30000
  );

  it(
    'toute réécriture par le simple PUT /appel retire la validation',
    async () => {
      await validerAppel('formateur', {
        date: LUNDI,
        seance: 'S1',
        groupe: 'GM101',
        marques: [{ matricule: 'CEF001', type: 'absence' }],
      });
      expect(await AppelValidation.countDocuments()).toBe(1);

      await appel('gestionnaire', {
        date: LUNDI,
        seance: 'S1',
        groupe: 'GM101',
        marques: [{ matricule: 'CEF001', type: 'retard' }],
      });
      expect(await AppelValidation.countDocuments()).toBe(0);

      const liste = await lireAppel('gestionnaire', { date: LUNDI, seance: 'S1', groupe: 'GM101' });
      expect(liste.body.validation).toBeNull();
    },
    30000
  );

  it(
    'revalider remplace l’attestation précédente, sans dupliquer le document',
    async () => {
      await validerAppel('formateur', { date: LUNDI, seance: 'S1', groupe: 'GM101', marques: [] });
      await validerAppel('formateur', {
        date: LUNDI,
        seance: 'S1',
        groupe: 'GM101',
        marques: [{ matricule: 'CEF001', type: 'absence' }],
      });
      expect(await AppelValidation.countDocuments()).toBe(1);
    },
    30000
  );

  it('refuse au formateur le cours d’un collègue, sans rien valider', async () => {
    const reponse = await validerAppel('formateur', {
      date: LUNDI,
      seance: 'S2',
      groupe: 'GM101',
      marques: [{ matricule: 'CEF001', type: 'absence' }],
    });
    expect(reponse.status).toBe(404);
    expect(await AppelValidation.countDocuments()).toBe(0);
  });
});

describe('le registre', () => {
  it('un formateur ne voit que ce qui a été marqué sur SES séances', async () => {
    await appel('formateur', { date: LUNDI, seance: 'S1', groupe: 'GM101', marques: [{ matricule: 'CEF001', type: 'absence' }] });
    await appel('directeur', { date: LUNDI, seance: 'S2', groupe: 'GM101', marques: [{ matricule: 'CEF002', type: 'absence' }] });

    const duFormateur = await request(app).get('/api/v2/absences-stagiaires').set('Cookie', cookies.formateur);
    expect(duFormateur.body.absences.map((a) => a.matricule)).toEqual(['CEF001']);

    const duDirecteur = await request(app).get('/api/v2/absences-stagiaires').set('Cookie', cookies.directeur);
    expect(duDirecteur.body.total).toBe(2);
  });

  it('seul l’encadrement justifie ou supprime', async () => {
    await appel('formateur', { date: LUNDI, seance: 'S1', groupe: 'GM101', marques: [{ matricule: 'CEF001', type: 'absence' }] });
    const { _id } = await AbsenceStagiaire.findOne().lean();

    const refus = await request(app)
      .patch(`/api/v2/absences-stagiaires/${_id}`)
      .set('Cookie', cookies.formateur)
      .send({ justifiee: true });
    expect(refus.status).toBe(403);

    const ok = await request(app)
      .patch(`/api/v2/absences-stagiaires/${_id}`)
      .set('Cookie', cookies.gestionnaire)
      .send({ justifiee: true, motif: 'Certificat médical' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ justifiee: true, motif: 'Certificat médical' });
  });
});

/** Écrit des faits sans passer par l'appel : la note, seule, est éprouvée ici. */
const faits = (matricule, liste) =>
  AbsenceStagiaire.create(
    liste.map((fait, i) => ({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      matricule,
      nomComplet: matricule,
      groupe: 'GM101',
      date: `2026-09-${String(1 + i).padStart(2, '0')}`,
      semaine: '2026-W1',
      jour: 'Lundi',
      seance: 'S1',
      ...fait,
    }))
  );

describe('GET /absences-stagiaires/notes', () => {
  it('calcule la note sur la grille : retards et absences s’additionnent, le justifié ne compte pas', async () => {
    await faits('CEF001', [
      { typeAbsence: 'absence' },
      { typeAbsence: 'absence' },
      { typeAbsence: 'retard' },
      { typeAbsence: 'retard' },
      { typeAbsence: 'absence', justifiee: true },
    ]);
    await IndisciplineStagiaire.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      matricule: 'CEF001',
      nomComplet: 'ALAOUI Yassine',
      date: '2026-09-10',
      motif: 'Téléphone en cours',
    });

    const reponse = await request(app)
      .get('/api/v2/absences-stagiaires/notes?groupe=GM101')
      .set('Cookie', cookies.directeur);

    expect(reponse.status).toBe(200);
    const [alaoui, benani] = reponse.body.stagiaires;
    expect(alaoui).toMatchObject({ matricule: 'CEF001', absencesNJ: 2, absencesJ: 1, retardsNJ: 2, indisciplines: 1 });
    // 2 séances (−1) + 2 retards (−0,5) = −1,5 → 8,5 ; comportement 4 → 12,5/15 → 16,67/20.
    expect(alaoui.note.assiduite).toMatchObject({ pointsRetires: 1.5, note: 8.5 });
    expect(alaoui.note.assiduite.sanction).toMatchObject({ libelle: '1ère mise en garde', autorite: 'SG' });
    expect(alaoui.note.comportement.sanction.libelle).toBe('Mise en garde');
    expect(alaoui.note).toMatchObject({ note15: 12.5, note20: 16.67 });
    expect(benani.note).toMatchObject({ note15: 15, note20: 20 });
    // GM101 est une 1ʳᵉ année : examen de passage, sur 20.
    expect(reponse.body.examen).toEqual({ type: 'passage', sur: 20 });
    expect(alaoui.note.noteExamen).toBe(16.67);
  });

  it('2ᵉ année : fin de formation, la note reste sur 15 sans conversion', async () => {
    await Stagiaire.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      matricule: 'CEF201',
      nom: 'DAOUDI',
      prenom: 'Nada',
      groupes: ['SMP201'],
      groupePrincipal: 'SMP201',
    });
    await faits('CEF201', [{ typeAbsence: 'absence' }]);

    const reponse = await request(app)
      .get('/api/v2/absences-stagiaires/notes?groupe=SMP201')
      .set('Cookie', cookies.directeur);

    expect(reponse.status).toBe(200);
    expect(reponse.body.examen).toEqual({ type: 'fin', sur: 15 });
    expect(reponse.body.stagiaires[0].note).toMatchObject({ note15: 14.5, note20: null, noteExamen: 14.5 });

    const fiche = await request(app)
      .get('/api/v2/absences-stagiaires/stagiaires/CEF201')
      .set('Cookie', cookies.directeur);
    expect(fiche.body.note).toMatchObject({ examen: { type: 'fin', sur: 15 }, note20: null });
  });

  it('⚠️ un réimport Konosys ne fait pas perdre les absences — elles tiennent au CEF', async () => {
    await faits('CEF001', [{ typeAbsence: 'absence' }, { typeAbsence: 'absence' }]);
    const avant = await Stagiaire.find({ etablissementId: etablissement.id }).lean();
    await Stagiaire.deleteMany({ etablissementId: etablissement.id });
    await Stagiaire.insertMany(avant.map(({ _id, ...s }) => s));

    const reponse = await request(app)
      .get('/api/v2/absences-stagiaires/notes?groupe=GM101')
      .set('Cookie', cookies.directeur);
    expect(reponse.body.stagiaires[0].note.assiduite.note).toBe(9);
  });

  it('refuse le formateur (403)', async () => {
    const reponse = await request(app)
      .get('/api/v2/absences-stagiaires/notes?groupe=GM101')
      .set('Cookie', cookies.formateur);
    expect(reponse.status).toBe(403);
  });
});

describe('GET /absences-stagiaires/tableau-bord — l’accueil du gestionnaire', () => {
  it('agrège absences, retards et indisciplines pour tout l’établissement', async () => {
    await faits('CEF001', [
      { typeAbsence: 'absence' },
      { typeAbsence: 'absence', justifiee: true },
      { typeAbsence: 'retard' },
    ]);
    await faits('CEF003', [{ typeAbsence: 'absence', groupe: 'GM102' }]);
    await IndisciplineStagiaire.create([
      {
        etablissementId: etablissement.id,
        anneeScolaire: ANNEE,
        matricule: 'CEF001',
        nomComplet: 'ALAOUI Yassine',
        groupe: 'GM101',
        date: '2026-09-10',
        motif: 'Téléphone en cours',
      },
      {
        etablissementId: etablissement.id,
        anneeScolaire: ANNEE,
        matricule: 'CEF003',
        nomComplet: 'CHAFIK Omar',
        groupe: 'GM102',
        date: '2026-09-12',
        motif: 'Insolence',
      },
    ]);

    const reponse = await request(app)
      .get('/api/v2/absences-stagiaires/tableau-bord')
      .set('Cookie', cookies.gestionnaire);

    expect(reponse.status).toBe(200);
    expect(reponse.body.absences).toMatchObject({ total: 3, justifiees: 1, nonJustifiees: 2 });
    expect(reponse.body.retards).toMatchObject({ total: 1, justifies: 0, nonJustifies: 1 });
    expect(reponse.body.indisciplines.total).toBe(2);
    expect(reponse.body.indisciplines.recentes.map((i) => i.motif)).toEqual(
      expect.arrayContaining(['Téléphone en cours', 'Insolence'])
    );
    // « groupesAbsences » et « groupesRetards » comptent chacun LEUR fait, pas les deux mélangés.
    expect(reponse.body.groupesAbsences).toEqual(
      expect.arrayContaining([{ groupe: 'GM101', n: 2 }, { groupe: 'GM102', n: 1 }])
    );
    expect(reponse.body.groupesRetards).toEqual(
      expect.arrayContaining([{ groupe: 'GM101', n: 1 }])
    );
    expect(reponse.body.groupesIndisciplines).toEqual(
      expect.arrayContaining([{ groupe: 'GM101', n: 1 }, { groupe: 'GM102', n: 1 }])
    );
  });

  it('refuse le formateur (403)', async () => {
    const reponse = await request(app)
      .get('/api/v2/absences-stagiaires/tableau-bord')
      .set('Cookie', cookies.formateur);
    expect(reponse.status).toBe(403);
  });
});

describe('la date « Modifié il y a… » de la page Absences', () => {
  it('le gestionnaire la lit sur Absences, où il travaille — et sur aucune autre page', async () => {
    const absences = await request(app).get('/api/v2/modifications/absences').set('Cookie', cookies.gestionnaire);
    expect(absences.status).toBe(200);

    const chrono = await request(app).get('/api/v2/modifications/chronogramme').set('Cookie', cookies.gestionnaire);
    expect(chrono.status).toBe(403);
  });
});

describe('les indisciplines', () => {
  const declarer = (corps, qui = 'gestionnaire') =>
    request(app).post('/api/v2/absences-stagiaires/indisciplines').set('Cookie', cookies[qui]).send(corps);
  const fiche = () =>
    request(app).get('/api/v2/absences-stagiaires/stagiaires/CEF001').set('Cookie', cookies.directeur);

  it('le rang suit l’ordre chronologique, et en retirer une fait remonter les suivantes', async () => {
    const premiere = await declarer({ matricule: 'CEF001', date: '2026-09-08', motif: 'Retard répété' });
    await declarer({ matricule: 'CEF001', date: '2026-09-10', motif: 'Insolence' });
    expect(premiere.status).toBe(201);

    let lue = await fiche();
    // Les plus récentes d'abord à l'écran.
    expect(lue.body.indisciplines.map((i) => [i.rang, i.sanction.libelle])).toEqual([
      [2, 'Avertissement'],
      [1, 'Mise en garde'],
    ]);
    expect(lue.body.note.comportement.note).toBe(3);

    await request(app)
      .delete(`/api/v2/absences-stagiaires/indisciplines/${premiere.body.id}`)
      .set('Cookie', cookies.directeur);
    lue = await fiche();
    expect(lue.body.indisciplines.map((i) => [i.rang, i.motif])).toEqual([[1, 'Insolence']]);
  });

  it('refuse une date à venir, un stagiaire inconnu, et le formateur', async () => {
    expect((await declarer({ matricule: 'CEF001', date: '2026-09-20', motif: 'x' })).body.code).toBe('DATE_FUTURE');
    expect((await declarer({ matricule: 'CEF999', date: '2026-09-10', motif: 'x' })).status).toBe(404);
    expect((await declarer({ matricule: 'CEF001', date: '2026-09-10', motif: 'x' }, 'formateur')).status).toBe(403);
    expect(await IndisciplineStagiaire.countDocuments()).toBe(0);
  });
});

/*
 * ⚠️ `superagent` NE BUFFÉRISE EN `Buffer` QUE LES TYPES MIME QU'IL CONNAÎT —
 * ni le Word ni l'Excel n'en font partie (voir `absences.test.js`, même piège).
 */
const bufferiserExport = (res, callback) => {
  const morceaux = [];
  res.on('data', (chunk) => morceaux.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(morceaux)));
};

describe('POST /absences-stagiaires/export — la feuille d’absence hebdomadaire (2026-09-29)', () => {
  const exporter = (corps, qui = 'directeur') =>
    request(app)
      .post('/api/v2/absences-stagiaires/export')
      .set('Cookie', cookies[qui])
      .buffer(true)
      .parse(bufferiserExport)
      .send(corps);

  it('rend un .docx exploitable, avec son en-tête de téléchargement', async () => {
    const reponse = await exporter({ format: 'docx', groupes: ['GM101'], semaine: SEMAINE });

    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-type']).toContain('wordprocessingml.document');
    expect(reponse.headers['content-disposition']).toContain('.docx');
    expect(reponse.body.subarray(0, 2).toString()).toBe('PK');
  });

  it('⚠️ N°, marque et « T. A » EN HEURES (2026-09-29, demande du porteur : « met total absence par heure ») : l’ordre alphabétique, la case du bon créneau, le total de LA SEMAINE affichée', async () => {
    await AbsenceStagiaire.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      matricule: 'CEF001',
      nomComplet: 'ALAOUI Yassine',
      groupe: 'GM101',
      date: LUNDI,
      semaine: SEMAINE,
      jour: 'Lundi',
      seance: 'S1',
      typeAbsence: 'absence',
    });

    const reponse = await exporter({ format: 'xlsx', groupes: ['GM101'], semaine: SEMAINE });
    expect(reponse.status).toBe(200);

    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);
    const feuille = classeur.worksheets[0];

    // Ligne 7 : premier étudiant du groupe dans l'ordre alphabétique (ALAOUI avant BENANI).
    expect(feuille.getRow(7).getCell(1).value).toBe(1);
    expect(feuille.getRow(7).getCell(2).value).toBe('ALAOUI Yassine');
    // Une séance d'absence, 2,5 h (`dureeSeance`) — pas « 1 » séance.
    expect(feuille.getRow(7).getCell(3).value).toBe(2.5);
    expect(feuille.getRow(7).getCell(4).value).toBe('A');
    // BENANI, jamais marquée : N° 2, T. A à 0, aucune case remplie.
    expect(feuille.getRow(8).getCell(1).value).toBe(2);
    expect(feuille.getRow(8).getCell(3).value).toBe(0);
    expect(feuille.getRow(8).getCell(4).value).toBeNull();
  });

  it('un retard marque « R », mais n’entre pas dans « T. A »', async () => {
    await AbsenceStagiaire.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      matricule: 'CEF002',
      nomComplet: 'BENANI Sara',
      groupe: 'GM101',
      date: LUNDI,
      semaine: SEMAINE,
      jour: 'Lundi',
      seance: 'S2',
      typeAbsence: 'retard',
    });

    const reponse = await exporter({ format: 'xlsx', groupes: ['GM101'], semaine: SEMAINE });
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);
    const feuille = classeur.worksheets[0];

    expect(feuille.getRow(8).getCell(5).value).toBe('R');
    expect(feuille.getRow(8).getCell(3).value).toBe(0);
  });

  it('⚠️ « T. A » CUMULE DEPUIS S1 (2026-09-29, demande du porteur : « il faut qu’il accule le T.A pour chaque semaine »)', async () => {
    // CEF001 absent la semaine PRÉCÉDENTE (2026-W2) ET la semaine affichée (2026-W3, SEMAINE).
    await AbsenceStagiaire.create([
      {
        etablissementId: etablissement.id,
        anneeScolaire: ANNEE,
        matricule: 'CEF001',
        nomComplet: 'ALAOUI Yassine',
        groupe: 'GM101',
        // ⚠️ UNE DATE DIFFÉRENTE DE CELLE DE LA SEMAINE AFFICHÉE, ci-dessous :
        // l'index unique porte sur (matricule, date, séance, période), pas sur
        // `semaine` — la même date sur les deux ferait échouer l'insertion.
        date: '2026-09-07',
        semaine: '2026-W2',
        jour: 'Lundi',
        seance: 'S1',
        typeAbsence: 'absence',
        justifiee: true,
      },
      {
        etablissementId: etablissement.id,
        anneeScolaire: ANNEE,
        matricule: 'CEF001',
        nomComplet: 'ALAOUI Yassine',
        groupe: 'GM101',
        date: LUNDI,
        semaine: SEMAINE,
        jour: 'Lundi',
        seance: 'S1',
        typeAbsence: 'absence',
      },
    ]);

    const reponse = await exporter({ format: 'xlsx', groupes: ['GM101'], semaine: SEMAINE });
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);
    const feuille = classeur.worksheets[0];

    // Deux séances d'absence cumulées (2026-W2 puis 2026-W3), 2,5 h chacune —
    // le cumul ne distingue pas justifiée ou non, contrairement à la ligne rouge.
    expect(feuille.getRow(7).getCell(3).value).toBe(5);
  });

  it('⚠️ LA LIGNE ROUGE (2026-09-29, demande du porteur : « si un stagiaire était absent en S4, si n’a pas justifié son absence, alors en S5 sa ligne être en rouge ») : la semaine PRÉCÉDENTE, TOUJOURS PAS JUSTIFIÉE — pas besoin d’être absent cette semaine-ci', async () => {
    // CEF001 : absence de la semaine précédente JAMAIS justifiée → rouge, même présent cette semaine.
    await AbsenceStagiaire.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      matricule: 'CEF001',
      nomComplet: 'ALAOUI Yassine',
      groupe: 'GM101',
      date: '2026-09-07',
      semaine: '2026-W2',
      jour: 'Lundi',
      seance: 'S1',
      typeAbsence: 'absence',
      justifiee: false,
    });
    // CEF002 : absence de la semaine précédente, mais JUSTIFIÉE depuis → pas rouge.
    await AbsenceStagiaire.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      matricule: 'CEF002',
      nomComplet: 'BENANI Sara',
      groupe: 'GM101',
      date: '2026-09-08',
      semaine: '2026-W2',
      jour: 'Mardi',
      seance: 'S1',
      typeAbsence: 'absence',
      justifiee: true,
    });

    const reponse = await exporter({ format: 'xlsx', groupes: ['GM101'], semaine: SEMAINE });
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);
    const feuille = classeur.worksheets[0];

    expect(feuille.getRow(7).getCell(1).fill?.fgColor?.argb).toBe('FFFEE2E2');
    expect(feuille.getRow(7).getCell(1).font?.color?.argb).toBe('FFB91C1C');
    expect(feuille.getRow(8).getCell(1).fill?.fgColor).toBeUndefined();
  });

  it('rend un .pdf', async () => {
    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/export')
      .set('Cookie', cookies.directeur)
      .send({ format: 'pdf', groupes: ['GM101'], semaine: SEMAINE });

    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-type']).toBe('application/pdf');
  }, 30_000);

  it('⚠️ PLUSIEURS GROUPES = UN SEUL FICHIER, un onglet Excel par groupe (2026-09-29, demande du porteur : « si tous les groupes s’affiche il télécharge tous les groupes, d’après le filtre »)', async () => {
    const reponse = await exporter({ format: 'xlsx', groupes: ['GM101', 'GM102'], semaine: SEMAINE });

    expect(reponse.status).toBe(200);
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);
    expect(classeur.worksheets.map((f) => f.name)).toEqual(['GM101', 'GM102']);
    // GM102 n'a que CHAFIK Omar.
    expect(classeur.worksheets[1].getRow(7).getCell(2).value).toBe('CHAFIK Omar');
  });

  it('⚠️ REFUSE plutôt que de rendre une feuille sans personne dessus', async () => {
    // ⚠️ SANS `bufferiserExport` ICI (2026-09-29, constaté ici même) : cette
    // route répond une ERREUR JSON normale, que `superagent` sait déjà
    // parser — le parseur binaire, lui, laisserait `reponse.body` en `Buffer`
    // et `reponse.body.code` resterait `undefined`.
    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/export')
      .set('Cookie', cookies.directeur)
      .send({ format: 'docx', groupes: ['GROUPE_INEXISTANT'], semaine: SEMAINE });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('GROUPE_VIDE');
  });

  it('un groupe SANS stagiaire n’empêche pas les autres de sortir', async () => {
    const reponse = await exporter({ format: 'xlsx', groupes: ['GM101', 'GROUPE_INEXISTANT'], semaine: SEMAINE });

    expect(reponse.status).toBe(200);
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);
    expect(classeur.worksheets.map((f) => f.name)).toEqual(['GM101']);
  });

  it('⚠️ LA LIGNE « FORMATEURS » VIENT DE L’EMPLOI DU TEMPS (2026-09-29, demande du porteur : « en ligne formateur en bas afficher le nom du formateur verticalement »)', async () => {
    const reponse = await exporter({ format: 'xlsx', groupes: ['GM101'], semaine: SEMAINE });
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);
    const feuille = classeur.worksheets[0];

    // 2 stagiaires (ALAOUI, BENANI) : la ligne « Formateurs » est la 9ᵉ.
    // Lundi S1 est à BRAHIM LOURID (matricule 9863), Lundi S2 à AHMED CHERKAOUI (4211).
    expect(feuille.getRow(9).getCell(4).value).toBe('BRAHIM LOURID');
    expect(feuille.getRow(9).getCell(5).value).toBe('AHMED CHERKAOUI');
    // Mercredi : aucune séance posée pour GM101 dans la fixture, la case reste vide.
    expect(feuille.getRow(9).getCell(12).value).toBeNull();
  });

  it('refuse une semaine mal formée, une liste vide et un format inconnu', async () => {
    expect((await exporter({ format: 'docx', groupes: ['GM101'], semaine: '2026-3' })).status).toBe(400);
    expect((await exporter({ format: 'docx', groupes: [], semaine: SEMAINE })).status).toBe(400);
    expect((await exporter({ format: 'jpeg', groupes: ['GM101'], semaine: SEMAINE })).status).toBe(400);
  });

  it('réservée à l’encadrement : un formateur ne peut pas la télécharger', async () => {
    const reponse = await exporter({ format: 'docx', groupes: ['GM101'], semaine: SEMAINE }, 'formateur');
    expect(reponse.status).toBe(403);
  });
});

describe('POST /absences-stagiaires/billets — le(s) billet(s) d’excuse (2026-09-29, demande du porteur : « si un seul stagiaire justifié il s’affiche une seule billet… si deux stagiaires justifient en même temps il s’affiche deux billets »)', () => {
  const creerAbsence = (champs) =>
    AbsenceStagiaire.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      groupe: 'GM101',
      semaine: SEMAINE,
      jour: 'Lundi',
      seance: 'S1',
      typeAbsence: 'absence',
      ...champs,
    });

  // ⚠️ `superagent` NE BUFFÉRISE EN `Buffer` QUE LES TYPES MIME QU'IL CONNAÎT —
  // ni le Word ni l'Excel n'en font partie (voir `absences.test.js`, même piège).
  const bufferiserBillets = (res, callback) => {
    const morceaux = [];
    res.on('data', (chunk) => morceaux.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(morceaux)));
  };

  /** Pour les réponses BINAIRES (docx, pdf, xlsx) — jamais pour lire `reponse.body.code`. */
  const demanderBillets = (ids, format = 'pdf', qui = 'directeur') =>
    request(app)
      .post('/api/v2/absences-stagiaires/billets')
      .set('Cookie', cookies[qui])
      .buffer(true)
      .parse(bufferiserBillets)
      .send({ format, ids });

  /** Pour les réponses D'ERREUR, en JSON normal. */
  const demanderBilletsErreur = (ids, format = 'pdf', qui = 'directeur') =>
    request(app)
      .post('/api/v2/absences-stagiaires/billets')
      .set('Cookie', cookies[qui])
      .send({ format, ids });

  it('⚠️ UN SEUL IDENTIFIANT → UN SEUL BILLET, en PDF', async () => {
    const absence = await creerAbsence({
      matricule: 'CEF001',
      nomComplet: 'ALAOUI Yassine',
      filiere: 'Développement Digital',
      date: LUNDI,
      justifiee: true,
    });

    const reponse = await demanderBillets([absence.id], 'pdf');

    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-type']).toBe('application/pdf');
    expect(reponse.body.subarray(0, 5).toString()).toBe('%PDF-');
  }, 15_000);

  it('⚠️ DEUX IDENTIFIANTS JUSTIFIÉS → DEUX BILLETS, en Excel (2026-09-29, demande du porteur : « je veux avec trois word, pdf, excel »)', async () => {
    const a1 = await creerAbsence({
      matricule: 'CEF001',
      nomComplet: 'ALAOUI Yassine',
      filiere: 'Développement Digital',
      date: LUNDI,
      seance: 'S1',
      justifiee: true,
    });
    const a2 = await creerAbsence({
      matricule: 'CEF002',
      nomComplet: 'BENANI Sara',
      filiere: 'Génie Mécanique',
      date: MARDI,
      seance: 'S2',
      typeAbsence: 'retard',
      justifiee: true,
    });

    const reponse = await demanderBillets([a1.id, a2.id], 'xlsx');
    expect(reponse.status).toBe(200);

    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);
    const feuille = classeur.worksheets[0];

    expect(feuille.getRow(2).getCell(1).value).toBe('ALAOUI');
    expect(feuille.getRow(2).getCell(5).value).toBe('Absence');
    expect(feuille.getRow(3).getCell(1).value).toBe('BENANI');
    expect(feuille.getRow(3).getCell(5).value).toBe('Retard');
  });

  it('rend un .docx exploitable pour plusieurs billets', async () => {
    const a1 = await creerAbsence({ matricule: 'CEF001', nomComplet: 'ALAOUI Yassine', date: LUNDI, justifiee: true });
    const a2 = await creerAbsence({
      matricule: 'CEF002',
      nomComplet: 'BENANI Sara',
      date: MARDI,
      seance: 'S2',
      justifiee: true,
    });

    const reponse = await demanderBillets([a1.id, a2.id], 'docx');

    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-type']).toContain('wordprocessingml.document');
    expect(reponse.body.subarray(0, 2).toString()).toBe('PK');
  });

  it('⚠️ REFUSE dès qu’UNE SEULE des absences demandées n’est pas justifiée', async () => {
    const justifiee = await creerAbsence({ matricule: 'CEF001', nomComplet: 'ALAOUI Yassine', date: LUNDI, justifiee: true });
    const nonJustifiee = await creerAbsence({
      matricule: 'CEF002',
      nomComplet: 'BENANI Sara',
      date: MARDI,
      seance: 'S2',
    });

    const reponse = await demanderBilletsErreur([justifiee.id, nonJustifiee.id]);

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('ABSENCE_NON_JUSTIFIEE');
  });

  it('réservée à l’encadrement : un formateur ne peut pas les télécharger', async () => {
    const absence = await creerAbsence({ matricule: 'CEF001', nomComplet: 'ALAOUI Yassine', date: LUNDI, justifiee: true });

    const reponse = await demanderBillets([absence.id], 'pdf', 'formateur');

    expect(reponse.status).toBe(403);
  });

  it('refuse une liste vide et un identifiant introuvable', async () => {
    expect((await demanderBillets([])).status).toBe(400);
    expect((await demanderBillets(['000000000000000000000000'])).status).toBe(404);
  });
});
