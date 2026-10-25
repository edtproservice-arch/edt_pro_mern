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

describe('POST /absences-stagiaires/registre/export — le registre de l’année en Excel (2026-10-10)', () => {
  const exporter = (qui = 'directeur') =>
    request(app)
      .post('/api/v2/absences-stagiaires/registre/export')
      .set('Cookie', cookies[qui])
      .buffer(true)
      .parse(bufferiserExport)
      .send({});

  const marquer = (champs) =>
    AbsenceStagiaire.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      matricule: 'CEF001',
      nomComplet: 'ALAOUI Yassine',
      groupe: 'GM101',
      date: LUNDI,
      semaine: SEMAINE,
      jour: 'Lundi',
      typeAbsence: 'absence',
      ...champs,
    });

  it('une ligne par stagiaire, les heures du jour dans sa colonne, le motif en commentaire, les deux totaux en fin de ligne', async () => {
    await marquer({ seance: 'S1' });
    await marquer({ seance: 'S2', justifiee: true, motif: 'Certificat médical' });
    // Un RETARD n'est pas une heure manquée : il n'entre ni dans la case ni dans les totaux.
    await marquer({ seance: 'S1', date: MARDI, jour: 'Mardi', typeAbsence: 'retard' });

    const reponse = await exporter();
    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-disposition']).toContain('.xlsx');

    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);
    const feuille = classeur.getWorksheet('Registre');

    const entete = feuille.getRow(6);
    expect(entete.getCell(1).value).toBe('Groupe');
    expect(entete.getCell(2).value).toBe('Stagiaire');
    const derniere = feuille.columnCount;
    expect(entete.getCell(derniere - 6).value).toBe('Heures non justifiées');
    expect(entete.getCell(derniere - 5).value).toBe('Heures justifiées');

    // Groupes dans l'ordre, stagiaires dans l'ordre alphabétique.
    const lignes = [7, 8, 9].map((n) => [feuille.getRow(n).getCell(1).value, feuille.getRow(n).getCell(2).value]);
    expect(lignes).toEqual([
      ['GM101', 'ALAOUI Yassine'],
      ['GM101', 'BENANI Sara'],
      ['GM102', 'CHAFIK Omar'],
    ]);

    // La colonne du lundi 14 septembre : 2 séances = 5 h, le motif de la justifiée en commentaire.
    let colonneLundi = null;
    entete.eachCell((cellule, colonne) => {
      if (colonneLundi === null && cellule.value === 'L\n14') colonneLundi = colonne;
    });
    expect(colonneLundi).not.toBeNull();
    const caseLundi = feuille.getRow(7).getCell(colonneLundi);
    expect(caseLundi.value).toBe(5);
    expect(JSON.stringify(caseLundi.note)).toContain('Certificat médical');
    // Le mardi du retard reste vide.
    expect(feuille.getRow(7).getCell(colonneLundi + 1).value).toBeNull();

    expect(feuille.getRow(7).getCell(derniere - 6).value).toBe(2.5);
    expect(feuille.getRow(7).getCell(derniere - 5).value).toBe(2.5);
    expect(feuille.getRow(8).getCell(derniere - 6).value).toBe(0);

    // Aucun dimanche parmi les colonnes de jours.
    const dimanches = [];
    entete.eachCell((cellule, colonne) => {
      if (colonne > 2 && colonne < derniere - 6 && String(cellule.value).startsWith('D\n')) dimanches.push(colonne);
    });
    expect(dimanches).toEqual([]);
  });

  it('⚠️ le comportement en fin de ligne, une colonne par sanction : la n-ième indiscipline remplit la n-ième, date et motif', async () => {
    const indiscipline = (date, motif, observation = '') =>
      IndisciplineStagiaire.create({
        etablissementId: etablissement.id,
        anneeScolaire: ANNEE,
        matricule: 'CEF001',
        nomComplet: 'ALAOUI Yassine',
        groupe: 'GM101',
        date,
        motif,
        observation,
      });
    // Saisies dans le désordre : le rang suit la DATE, comme sur la fiche du stagiaire.
    await indiscipline(MARDI, 'Téléphone en cours');
    await indiscipline(LUNDI, 'Bavardage', 'Rappel à l’ordre');

    const reponse = await exporter();
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);
    const feuille = classeur.getWorksheet('Registre');

    const derniere = feuille.columnCount;
    const entete = feuille.getRow(6);
    expect([1, 2, 3, 4, 5].map((n) => entete.getCell(derniere - 5 + n).value)).toEqual([
      'Mise en garde (SG)',
      'Avertissement (D)',
      'Blâme (CD)',
      'Exclusion de 2 jours (CD)',
      'Exclusion définitive (CD)',
    ]);
    expect(entete.getCell(derniere - 5).value).toBe('Heures justifiées');

    const alaoui = feuille.getRow(7);
    expect(alaoui.getCell(derniere - 4).value).toBe('14/09/2026');
    expect(JSON.stringify(alaoui.getCell(derniere - 4).note)).toContain('Bavardage');
    expect(JSON.stringify(alaoui.getCell(derniere - 4).note)).toContain('Rappel à l’ordre');
    expect(alaoui.getCell(derniere - 3).value).toBe('15/09/2026');
    expect(alaoui.getCell(derniere - 2).value).toBeNull();
    // BENANI n'a rien commis : ses colonnes de sanction restent vides.
    expect(feuille.getRow(8).getCell(derniere - 4).value).toBeNull();
  });

  it('est réservé à l’encadrement', async () => {
    // Une erreur JSON : sans le parseur binaire (voir plus haut).
    const refus = await request(app)
      .post('/api/v2/absences-stagiaires/registre/export')
      .set('Cookie', cookies.formateur)
      .send({});
    expect(refus.status).toBe(403);
    expect((await exporter('gestionnaire')).status).toBe(200);
  });
});

describe('POST /absences-stagiaires/notes/export — les notes de discipline par groupe (2026-10-11)', () => {
  const exporter = (corps, qui = 'directeur') =>
    request(app)
      .post('/api/v2/absences-stagiaires/notes/export')
      .set('Cookie', cookies[qui])
      .buffer(true)
      .parse(bufferiserExport)
      .send(corps);

  const marquer = (champs) =>
    AbsenceStagiaire.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      matricule: 'CEF001',
      nomComplet: 'ALAOUI Yassine',
      groupe: 'GM101',
      date: LUNDI,
      semaine: SEMAINE,
      jour: 'Lundi',
      typeAbsence: 'absence',
      ...champs,
    });

  it('un onglet par groupe, les notes de l’écran : assiduité, comportement, /15 et /20 en 1re année', async () => {
    await marquer({ seance: 'S1' });
    await marquer({ seance: 'S2' });
    await marquer({ seance: 'S1', date: MARDI, jour: 'Mardi', typeAbsence: 'retard' });
    // Justifiée : affichée, mais ne retire rien.
    await marquer({ seance: 'S3', justifiee: true, motif: 'Certificat' });
    await IndisciplineStagiaire.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      matricule: 'CEF001',
      nomComplet: 'ALAOUI Yassine',
      groupe: 'GM101',
      date: LUNDI,
      motif: 'Bavardage',
    });

    const reponse = await exporter({ format: 'xlsx', groupes: ['GM101', 'GM102'] });
    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-disposition']).toContain('Notes_discipline_2_groupes.xlsx');

    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);
    expect(classeur.worksheets.map((f) => f.name)).toEqual(['GM101', 'GM102']);

    const feuille = classeur.getWorksheet('GM101');
    const entete = feuille.getRow(6).values.slice(1);
    expect(entete.at(-1)).toBe('Note /20');
    const alaoui = Object.fromEntries(entete.map((titre, i) => [titre, feuille.getRow(7).getCell(i + 1).value]));
    expect(alaoui['Nom et prénom']).toBe('ALAOUI Yassine');
    expect(alaoui['Absences non justifiées (séances)']).toBe(2);
    expect(alaoui['Absences justifiées (séances)']).toBe(1);
    expect(alaoui['Retards non justifiés']).toBe(1);
    // 2 séances (−1) + 1 retard (−0,25) → 8,75 /10 et 1ʳᵉ mise en garde.
    expect(alaoui['Assiduité /10']).toBe(8.75);
    expect(alaoui['Sanction assiduité']).toBe('1ère mise en garde (SG)');
    expect(alaoui['Comportement /5']).toBe(4);
    expect(alaoui['Sanction comportement']).toBe('Mise en garde (SG)');
    expect(alaoui['Note /15']).toBe(12.75);
    expect(alaoui['Note /20']).toBe(17);
    expect(feuille.getRow(8).getCell(3).value).toBe('BENANI Sara');
  });

  it('rend aussi un Word, et reste réservé à l’encadrement', async () => {
    const word = await exporter({ format: 'docx', groupes: ['GM101'] });
    expect(word.status).toBe(200);
    expect(word.headers['content-disposition']).toContain('Notes_discipline_GM101.docx');
    expect(word.body.subarray(0, 2).toString()).toBe('PK');

    // Une erreur JSON : sans le parseur binaire (voir plus haut).
    const refus = await request(app)
      .post('/api/v2/absences-stagiaires/notes/export')
      .set('Cookie', cookies.formateur)
      .send({ format: 'xlsx', groupes: ['GM101'] });
    expect(refus.status).toBe(403);
  });
});

describe('POST /absences-stagiaires/presence/convocation-eff — la convocation à l’EFF (2026-10-11)', () => {
  const exporter = (corps) =>
    request(app)
      .post('/api/v2/absences-stagiaires/presence/convocation-eff')
      .set('Cookie', cookies.directeur)
      .buffer(true)
      .parse(bufferiserExport)
      .send(corps);

  it('convoque les groupes de 2e année, écarte la 1re, et refuse une demande sans aucun groupe concerné', async () => {
    await Stagiaire.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      matricule: 'CEF201',
      nom: 'DRISSI',
      prenom: 'Amine',
      niveau: 'TS',
      groupes: ['GM201'],
      groupePrincipal: 'GM201',
    });
    const examen = { date: '2027-06-21', debut: '08:30', fin: '12:30', epreuve: 'Epreuve de synthèse' };

    // GM101 (1re année) est écarté en silence : seul GM201 est convoqué.
    const reponse = await exporter({ format: 'docx', groupes: ['GM101', 'GM201'], examen });
    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-disposition']).toContain('Convocation_EFF_GM201');

    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(reponse.body)).file('word/document.xml').async('string');
    expect(xml).toContain('DRISSI Amine');
    expect(xml).toContain('Lundi 21 Juin 2027');
    expect(xml).toContain('de 08h30 à 12h30');
    expect(xml).not.toContain('ALAOUI');

    // Une erreur JSON : sans le parseur binaire (voir plus haut).
    const refus = await request(app)
      .post('/api/v2/absences-stagiaires/presence/convocation-eff')
      .set('Cookie', cookies.directeur)
      .send({ format: 'docx', groupes: ['GM101'], examen });
    expect(refus.status).toBe(400);
    expect(refus.body.code).toBe('ANNEE_NON_CONCERNEE');
  });
});

describe('POST /absences-stagiaires/presence/convention — seulement les groupes ayant un stage (2026-10-11)', () => {
  const exporter = (groupes) =>
    request(app)
      .post('/api/v2/absences-stagiaires/presence/convention')
      .set('Cookie', cookies.directeur)
      .buffer(true)
      .parse(bufferiserExport)
      .send({ format: 'docx', groupes });

  it('écarte un groupe sans période de stage, et refuse quand aucun n’en a', async () => {
    await Etablissement.updateOne(
      { _id: etablissement.id },
      { $set: { stages: [{ groupe: 'GM101', debut: '2027-03-01', fin: '2027-04-10' }] } }
    );

    const reponse = await exporter(['GM101', 'GM102']);
    expect(reponse.status).toBe(200);
    // GM102 n'a pas de stage : seul GM101 reçoit ses conventions.
    expect(reponse.headers['content-disposition']).toContain('Convention_Stage_GM101');

    // ⚠️ Une ERREUR JSON se lit SANS `bufferiserExport` (voir plus haut) : le
    // parseur binaire y déclenche le « double callback » de superagent.
    const refus = await request(app)
      .post('/api/v2/absences-stagiaires/presence/convention')
      .set('Cookie', cookies.directeur)
      .send({ format: 'docx', groupes: ['GM102'] });
    expect(refus.status).toBe(400);
    expect(refus.body.code).toBe('SANS_PERIODE_DE_STAGE');
  });
});

describe('POST /absences-stagiaires/presence/transfert — le formulaire de transfert (2026-10-11)', () => {
  it('pré-remplit la partie du demandeur et coche niveau, année et mode', async () => {
    await Stagiaire.updateOne(
      { etablissementId: etablissement.id, matricule: 'CEF001' },
      { $set: { niveau: 'TS', annee: '1A', niveauScolaire: 'Baccalauréat', filiere: 'Génie Mécanique' } }
    );

    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/presence/transfert')
      .set('Cookie', cookies.directeur)
      .buffer(true)
      .parse(bufferiserExport)
      .send({ format: 'docx', groupes: ['GM101'] });
    expect(reponse.status).toBe(200);

    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(reponse.body)).file('word/document.xml').async('string');
    expect(xml).toContain('Je soussigné, Mlle, Mme, M. ALAOUI Yassine');
    expect(xml).toContain('Niveau scolaire Baccalauréat');
    expect(xml).toContain('Filière de formation : Génie Mécanique');
    // TS coché ; « 1ère Année » cochée ; mode inconnu → résidentiel coché.
    expect(xml).toMatch(/Niveau : TS <\/w:t>[\s\S]*?☒/);
    expect(xml).toContain('☒ 1ère Année');
    expect(xml).toContain('☒ Résidentielle');
  });
});

describe('POST /absences-stagiaires/presence/pv-discipline — le PV du conseil de discipline (2026-10-11)', () => {
  it('un PV pour le seul stagiaire qui relève du conseil, ses faits écrits ; refusé quand personne n’en relève', async () => {
    // Dix séances d'absence non justifiées : 5 points retirés → blâme, autorité du Conseil de discipline.
    const jours = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
    await AbsenceStagiaire.create(
      jours.flatMap((date) =>
        ['S1', 'S2'].map((seance) => ({
          etablissementId: etablissement.id,
          anneeScolaire: ANNEE,
          matricule: 'CEF001',
          nomComplet: 'ALAOUI Yassine',
          groupe: 'GM101',
          date,
          semaine: '2026-W1',
          jour: 'Lundi',
          seance,
          typeAbsence: 'absence',
        }))
      )
    );

    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/presence/pv-discipline')
      .set('Cookie', cookies.directeur)
      .buffer(true)
      .parse(bufferiserExport)
      .send({ format: 'docx', groupes: ['GM101'] });
    expect(reponse.status).toBe(200);

    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(reponse.body)).file('word/document.xml').async('string');
    expect(xml).toContain('ALAOUI Yassine');
    // BENANI Sara n'a rien : pas de PV pour elle.
    expect(xml).not.toContain('BENANI');
    expect(xml).toContain("10 séance(s) d'absence non justifiée(s)");
    // La case « Absence » cochée.
    expect(xml).toContain('☒Absence');

    // GM102 : personne ne relève du conseil.
    const refus = await request(app)
      .post('/api/v2/absences-stagiaires/presence/pv-discipline')
      .set('Cookie', cookies.directeur)
      .send({ format: 'docx', groupes: ['GM102'] });
    expect(refus.status).toBe(400);
    expect(refus.body.code).toBe('AUCUN_CONSEIL');
  });

  it('demandé nommément (« Notes de discipline »), le PV d’un stagiaire sort même sans sanction du conseil', async () => {
    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/presence/pv-discipline')
      .set('Cookie', cookies.directeur)
      .buffer(true)
      .parse(bufferiserExport)
      .send({ format: 'docx', groupes: ['GM101'], matricules: ['CEF002'] });
    expect(reponse.status).toBe(200);

    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(reponse.body)).file('word/document.xml').async('string');
    expect(xml).toContain('BENANI Sara');
    expect(xml).not.toContain('ALAOUI');
    // Aucune sanction : ni « Absence » ni « Conduite » cochées.
    expect(xml).not.toContain('☒Absence');
  });
});

describe('POST /absences-stagiaires/presence/reclamation — la fiche de réclamation (2026-10-11)', () => {
  const fiche = async (corps) => {
    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/presence/reclamation')
      .set('Cookie', cookies.directeur)
      .buffer(true)
      .parse(bufferiserExport)
      .send({ format: 'docx', ...corps });
    expect(reponse.status).toBe(200);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(reponse.body);
    return {
      corps: await zip.file('word/document.xml').async('string'),
      entete: await zip.file('word/header1.xml').async('string'),
    };
  };

  it('une fiche par groupe, sans nom ; une par stagiaire demandé nommément, son nom écrit', async () => {
    const { corps, entete } = await fiche({ groupes: ['GM101', 'GM102'] });
    expect(corps.match(/Groupe : GM10\d/g)).toEqual(['Groupe : GM101', 'Groupe : GM102']);
    expect(corps).not.toContain('ALAOUI');
    // L'établissement remplace celui du canevas.
    expect(entete).not.toContain('CFMMS TIT MELLIL');

    const seul = await fiche({ groupes: ['GM101'], matricules: ['CEF002'] });
    expect(seul.corps).toContain('Groupe : GM101');
    expect(seul.corps).toContain('Nom &amp; Prénom : BENANI Sara');
    expect(seul.corps).not.toContain('ALAOUI');
  });
});

describe('POST /absences-stagiaires/presence/badges-infos — filtrés par stagiaire (2026-10-17)', () => {
  it('ne sort que le badge choisi, avec le numéro de sa place dans la liste du groupe', async () => {
    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/presence/badges-infos')
      .set('Cookie', cookies.directeur)
      .buffer(true)
      .parse(bufferiserExport)
      .send({ format: 'docx', groupes: ['GM101'], matricules: ['CEF002'] });
    expect(reponse.status).toBe(200);

    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(reponse.body)).file('word/document.xml').async('string');
    const textes = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1].trim()).filter(Boolean);
    expect(textes).not.toContain('ALAOUI');
    // GM101 : ALAOUI (1), BENANI (2) — son badge, seul, porte le n° 2 : numéro, EFP, groupe, matricule.
    expect(textes[textes.indexOf('CEF002') - 3]).toBe('2');
  });
});

describe('Fiche fils d’agent (vierge) et demande de duplicata (par stagiaire) — 2026-10-17', () => {
  it('une seule fiche, sans aucun stagiaire : pointillés, cases vides, l’établissement dans l’en-tête', async () => {
    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/documents-vierges')
      .set('Cookie', cookies.formateur)
      .buffer(true)
      .parse(bufferiserExport)
      .send({ cle: 'fils-agent', format: 'docx' });
    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-disposition']).toContain('Fiche_Fils_Agent_vierge.docx');

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(reponse.body);
    const xml = await zip.file('word/document.xml').async('string');
    const textes = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1].trim()).filter(Boolean);
    expect(textes.filter((t) => t === 'Fiche du candidat Fils d’Agent OFPPT')).toHaveLength(1);
    // Personne : aucun stagiaire du groupe n'y figure, le CEF n'a que des cases vides.
    expect(textes).not.toContain('ALAOUI');
    expect(textes).not.toContain('BENANI');
    const debut = textes.indexOf('CEF :') + 1;
    expect(textes[debut]).toBe('Date de naissance :');
    // Le style des autres documents : l'en-tête officiel de l'attestation, l'établissement à sa place.
    const entete = await zip.file('word/header1.xml').async('string');
    expect(entete).toContain('Office de la Formation Professionnelle');
    expect(entete).toContain('ISTA Test');
    expect(entete).not.toContain('CFP MGD HASSANIA');
  });

  it('la demande de duplicata : une par stagiaire choisi, pré-remplie, ses pièces à joindre', async () => {
    await Stagiaire.updateOne(
      { etablissementId: etablissement.id, matricule: 'CEF002' },
      { $set: { cin: 'BK12345', lieuNaissance: 'Fès', dateNaissance: '06/10/2007 00:00:00' } }
    );
    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/presence/duplicata')
      .set('Cookie', cookies.directeur)
      .buffer(true)
      .parse(bufferiserExport)
      .send({ format: 'docx', groupes: ['GM101'], matricules: ['CEF002'] });
    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-disposition']).toContain('Demande_Duplicata_Diplome');

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(reponse.body);
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('Formulaire de demande du duplicata du diplôme');
    expect(xml).toContain('Une déclaration de perte ;');
    // Pré-remplie : le stagiaire choisi, et lui seul.
    expect(xml).toContain('>BENANI<');
    expect(xml).toContain('>CEF002<');
    expect(xml).toContain('>Fès<');
    expect(xml).toContain('>06/10/2007<');
    expect(xml).not.toContain('ALAOUI');
    expect(xml.match(/Formulaire de demande du duplicata du diplôme/g)).toHaveLength(1);
    // Des lignes à points de suite, pas des « … » : elles vont jusqu'au bord.
    expect(xml).toContain('w:leader="dot"');
    expect(await zip.file('word/header1.xml').async('string')).toContain('ISTA Test');
  });

  it('la demande de duplicata imprimée vierge : aucun stagiaire, une seule demande', async () => {
    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/documents-vierges')
      .set('Cookie', cookies.formateur)
      .buffer(true)
      .parse(bufferiserExport)
      .send({ cle: 'duplicata', format: 'docx' });
    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-disposition']).toContain('Demande_Duplicata_Diplome_vierge.docx');

    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(reponse.body)).file('word/document.xml').async('string');
    expect(xml.match(/Formulaire de demande du duplicata du diplôme/g)).toHaveLength(1);
    expect(xml).not.toContain('ALAOUI');
    expect(xml).not.toContain('BENANI');
  });

  it('refuse un document vierge inconnu', async () => {
    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/documents-vierges')
      .set('Cookie', cookies.formateur)
      .send({ cle: 'inconnu', format: 'docx' });
    expect(reponse.status).toBe(400);
  });
});

describe('PV de réorientation (2026-10-17)', () => {
  it('un PV par stagiaire choisi : rentrée, complexe, EFP et identité écrits', async () => {
    await Stagiaire.updateOne(
      { etablissementId: etablissement.id, matricule: 'CEF002' },
      { $set: { cin: 'BK12345', filiere: 'Génie Mécanique', dateNaissance: '06/10/2007 00:00:00' } }
    );
    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/presence/reorientation')
      .set('Cookie', cookies.directeur)
      .buffer(true)
      .parse(bufferiserExport)
      .send({ format: 'docx', groupes: ['GM101'], matricules: ['CEF002'] });
    expect(reponse.status).toBe(200);

    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(reponse.body)).file('word/document.xml').async('string');
    for (const valeur of ['BENANI', 'Sara', 'CEF002', 'BK12345', '06/10/2007', 'Génie Mécanique (GM101)', 'CF Bâtiment', `Rentrée ${ANNEE}/${ANNEE + 1}`]) {
      expect(xml).toContain(`>${valeur}<`);
    }
    expect(xml).not.toContain('ALAOUI');
    expect(xml.match(/PV de r/g)).toHaveLength(1);
  });

  it('imprimé vierge : aucun stagiaire, mais la rentrée, le complexe et l’EFP', async () => {
    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/documents-vierges')
      .set('Cookie', cookies.formateur)
      .buffer(true)
      .parse(bufferiserExport)
      .send({ cle: 'reorientation', format: 'docx' });
    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-disposition']).toContain('PV_Reorientation_vierge.docx');

    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(reponse.body)).file('word/document.xml').async('string');
    expect(xml).toContain('>CF Bâtiment<');
    expect(xml).toContain(`>Rentrée ${ANNEE}/${ANNEE + 1}<`);
    expect(xml).not.toContain('BENANI');
  });
});

describe('POST /absences-stagiaires/documents-vierges — « Imprimer vierge » pour tous les documents (2026-10-18)', () => {
  it('chaque modèle sort vide : aucun stagiaire, aucun « undefined », l’établissement écrit', async () => {
    const { MODELES } = await import('../../src/modules/absencesStagiaires/exportFeuillePresenceDocx.js');
    const JSZip = (await import('jszip')).default;
    for (const cle of Object.keys(MODELES)) {
      const reponse = await request(app)
        .post('/api/v2/absences-stagiaires/documents-vierges')
        .set('Cookie', cookies.formateur)
        .buffer(true)
        .parse(bufferiserExport)
        .send({ cle, format: 'docx' });
      expect(reponse.status, cle).toBe(200);
      expect(reponse.headers['content-disposition'], cle).toContain('_vierge.docx');

      const zip = await JSZip.loadAsync(reponse.body);
      const textes = await Promise.all(
        Object.keys(zip.files)
          .filter((nom) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(nom))
          .map((nom) => zip.file(nom).async('string'))
      );
      const texte = textes.join('').replace(/<[^>]+>/g, '');
      expect(texte, cle).not.toMatch(/undefined|null|NaN/);
      for (const nom of ['ALAOUI', 'BENANI', 'CHAFIK']) expect(texte, cle).not.toContain(nom);
    }
  }, 120_000);
});

describe('POST /absences-stagiaires/presence/soins — le bon de soins (2026-10-18)', () => {
  it('un bon par stagiaire choisi : son nom, son groupe, l’en-tête de l’établissement', async () => {
    const reponse = await request(app)
      .post('/api/v2/absences-stagiaires/presence/soins')
      .set('Cookie', cookies.directeur)
      .buffer(true)
      .parse(bufferiserExport)
      .send({ format: 'docx', groupes: ['GM101'], matricules: ['CEF002'] });
    expect(reponse.status).toBe(200);

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(reponse.body);
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('>BENANI Sara<');
    expect(xml).toContain('>GM101<');
    expect(xml).not.toContain('ALAOUI');
    expect(xml.match(/>Bon de soins</g)).toHaveLength(1);
    expect(await zip.file('word/header1.xml').async('string')).toContain('ISTA Test');
  });
});

describe('POST /absences-stagiaires/justifier-periode — justifier une période d’un coup (2026-10-25)', () => {
  const justifierPeriode = (qui, corps) =>
    request(app).post('/api/v2/absences-stagiaires/justifier-periode').set('Cookie', cookies[qui]).send(corps);

  it('justifie les absences non justifiées de la période, sans toucher aux retards ni aux autres', async () => {
    await faits('CEF001', [
      { typeAbsence: 'absence' }, // 09-01
      { typeAbsence: 'absence' }, // 09-02
      { typeAbsence: 'retard' }, // 09-03
      { typeAbsence: 'absence', justifiee: true, motif: 'Convocation' }, // 09-04
      { typeAbsence: 'absence' }, // 09-05 — hors période
    ]);
    await faits('CEF002', [{ typeAbsence: 'absence' }]); // un autre stagiaire, même jour

    const reponse = await justifierPeriode('gestionnaire', {
      matricule: 'CEF001',
      du: '2026-09-01',
      au: '2026-09-04',
      motif: 'Certificat médical',
    });

    expect(reponse.status).toBe(200);
    expect(reponse.body).toEqual({ justifiees: 2 });
    const lignes = await AbsenceStagiaire.find({ matricule: 'CEF001' }).sort({ date: 1 }).lean();
    expect(lignes.map((l) => [l.date, l.justifiee, l.motif])).toEqual([
      ['2026-09-01', true, 'Certificat médical'],
      ['2026-09-02', true, 'Certificat médical'],
      ['2026-09-03', false, ''],
      // ⚠️ Déjà justifiée : elle garde SON motif.
      ['2026-09-04', true, 'Convocation'],
      ['2026-09-05', false, ''],
    ]);
    expect((await AbsenceStagiaire.findOne({ matricule: 'CEF002' }).lean()).justifiee).toBe(false);
  });

  it('les retards suivent sur demande', async () => {
    await faits('CEF001', [{ typeAbsence: 'absence' }, { typeAbsence: 'retard' }]);
    const reponse = await justifierPeriode('directeur', {
      matricule: 'CEF001',
      du: '2026-09-01',
      au: '2026-09-30',
      retards: true,
    });
    expect(reponse.body).toEqual({ justifiees: 2 });
  });

  it('refuse une période inversée, et le formateur', async () => {
    const inversee = await justifierPeriode('directeur', { matricule: 'CEF001', du: '2026-09-10', au: '2026-09-01' });
    expect(inversee.status).toBe(400);
    const formateur = await justifierPeriode('formateur', { matricule: 'CEF001', du: '2026-09-01', au: '2026-09-10' });
    expect(formateur.status).toBe(403);
  });
});

describe('GET /absences-stagiaires/appel/en-attente — le rappel au formateur (2026-10-25)', () => {
  const enAttente = (qui) => request(app).get('/api/v2/absences-stagiaires/appel/en-attente').set('Cookie', cookies[qui]);
  const cles = (reponse) => reponse.body.map((c) => `${c.date} ${c.seance} ${c.groupe}`);

  it('le formateur voit SES cours passés non validés — ni aujourd’hui, ni ceux à venir', async () => {
    const reponse = await enAttente('formateur');
    expect(reponse.status).toBe(200);
    expect(cles(reponse)).toEqual([`${MARDI} S1 GM101 GM102`, `${LUNDI} S1 GM101`]);
    expect(reponse.body[0]).toMatchObject({ formateur: 'BRAHIM LOURID', module: 'M101' });
  });

  it('un appel validé sort du rappel ; un appel seulement enregistré y reste', async () => {
    await validerAppel('formateur', { date: LUNDI, seance: 'S1', groupe: 'GM101', marques: [] });
    await appel('directeur', { date: MARDI, seance: 'S1', groupe: 'GM101 GM102', marques: [{ matricule: 'CEF001', type: 'absence' }] });

    expect(cles(await enAttente('formateur'))).toEqual([`${MARDI} S1 GM101 GM102`]);
  });

  it('l’encadrement voit tous les formateurs ; un cours dont le formateur était absent n’a pas d’appel', async () => {
    expect(cles(await enAttente('directeur'))).toEqual([
      `${MARDI} S1 GM101 GM102`,
      `${LUNDI} S1 GM101`,
      `${LUNDI} S2 GM101`,
    ]);
  });
});

describe('GET /absences-stagiaires/tableau-bord — seuils, séries et semaines (2026-10-25)', () => {
  it('range les stagiaires par palier, avec leur plus longue série de jours successifs', async () => {
    // Mardi 1er, mercredi 2, jeudi 3 : trois jours de suite ; le vendredi 4, un simple retard.
    await faits('CEF001', [
      { typeAbsence: 'absence' },
      { typeAbsence: 'absence' },
      { typeAbsence: 'absence', justifiee: true },
      { typeAbsence: 'retard' },
    ]);
    await faits('CEF002', [{ typeAbsence: 'absence' }]);

    const reponse = await request(app).get('/api/v2/absences-stagiaires/tableau-bord').set('Cookie', cookies.directeur);

    // CEF001 : 2 séances (−1) + 1 retard (−0,25) ; CEF002 : 1 séance (−0,5), sous le premier palier.
    expect(reponse.body.seuilsAssiduite).toEqual([
      expect.objectContaining({
        matricule: 'CEF001',
        seances: 2,
        retards: 1,
        points: 1.25,
        // ⚠️ La justifiée compte dans la série : un décrocheur peut avoir un certificat.
        serieAbsence: { du: '2026-09-01', au: '2026-09-03', jours: 3 },
      }),
    ]);
    expect(reponse.body.absencesParJour).toEqual(
      expect.arrayContaining([
        { date: '2026-09-01', groupe: 'GM101', absences: 2, retards: 0 },
        { date: '2026-09-04', groupe: 'GM101', absences: 0, retards: 1 },
      ])
    );
  });
});
