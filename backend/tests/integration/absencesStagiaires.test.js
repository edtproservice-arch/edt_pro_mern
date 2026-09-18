import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { Seance } from '../../src/models/Seance.js';
import { Stagiaire } from '../../src/models/Stagiaire.js';
import { AbsenceStagiaire } from '../../src/models/AbsenceStagiaire.js';
import { IndisciplineStagiaire } from '../../src/models/IndisciplineStagiaire.js';
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
