import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { Chronogramme } from '../../src/models/Chronogramme.js';
import { AbsenceFormateur } from '../../src/models/AbsenceFormateur.js';
import { oublierMemoire } from '../../src/modules/calendrier/joursFeries.service.js';
import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';
import { dateDuJour, enJour } from 'shared/domain';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Absences de formateurs et rattrapages (F8) — Phase 5, sous-livraison (d).
 * ← api/data/get_absences.php · update_rattrapage.php · save_observation.php
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;
const SEMAINE = '2026-W3';

let etablissement;
let cookies;

beforeEach(async () => {
  oublierMemoire();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

  const directeur = await User.create({
    nomComplet: 'Directeur Test',
    email: 'directeur@edtpro.ma',
    motDePasse: MOT_DE_PASSE,
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });

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

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [{ matricule: '9863', nomComplet: 'BRAHIM LOURID' }],
    groupes: ['GM101', 'GM102'],
    affectations: [
      { formateur: '9863', groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 },
      { formateur: '9863', groupe: 'GM102', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 },
      /*
       * Une séance SYNCHRONE mutualisée. ⚠️ C'est la COLONNE `groupe` qui porte
       * le libellé fusionné — pas un champ à part : `optionsDuFormateur` en
       * déduit les membres ET propose le libellé entier, celui qu'on choisit
       * pour une séance à distance.
       */
      {
        formateur: '9863',
        groupe: 'GM101 GM102',
        module: 'M101',
        type: TYPES_COURS.SYNCHRONE,
        s1Heures: 10,
      },
    ],
  });

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookies = connexion.headers['set-cookie'];
});

/** Pose une séance par l'API, éventuellement marquée absente. */
const poserSeance = (surcharges = {}) =>
  request(app)
    .put(`/api/v2/seances/${SEMAINE}/case`)
    .set('Cookie', cookies)
    .send({
      jour: 'Lundi',
      seance: 'S1',
      periode: 'jour',
      formateurMatricule: '9863',
      groupe: 'GM101',
      module: 'M101',
      salle: 'A12',
      ...surcharges,
    });

const chronogrammeAvec = (groupe, cellules) =>
  Chronogramme.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    groupe,
    planning: { M101: cellules },
  });

const heuresDe = async (groupe, semaine) => {
  const document = await Chronogramme.findOne({ etablissementId: etablissement.id, groupe }).lean();
  const cellules = document?.planning?.M101 ?? [];
  return cellules.find((cellule) => cellule.semaine === semaine)?.heures ?? 0;
};

describe('synchronisation depuis la grille', () => {
  it('⚠️ MARQUER ABSENT crée l’absence — sans passer par un second appel', async () => {
    /*
     * C'est ce qui remplace la synchro PAR DIFFÉRENCE de save_timetable.php :
     * `Seance.statut` porte le fait, le registre suit.
     */
    await poserSeance({ statut: 'absent' });

    const reponse = await request(app).get('/api/v2/absences').set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(reponse.body.absences).toHaveLength(1);
    expect(reponse.body.absences[0]).toMatchObject({
      jour: 'Lundi',
      seance: 'S1',
      formateurMatricule: '9863',
      formateurNom: 'BRAHIM LOURID',
      groupe: 'GM101',
      module: 'M101',
      dateRattrapage: null,
    });
  });

  it('⚠️ LA SALLE EST CONSERVÉE : l’existant l’écrasait par « ABSENT »', async () => {
    // On perdait alors l'endroit où le cours aurait dû avoir lieu.
    const reponse = await poserSeance({ statut: 'absent' });

    expect(reponse.body.seance.salle).toBe('A12');
    expect(reponse.body.seance.statut).toBe('absent');
  });

  it('le RETOUR à « présent » retire l’absence', async () => {
    const posee = await poserSeance({ statut: 'absent' });
    // ⚠️ L'`id` dit « je remplace celle-ci » : sans lui, reposer sur un créneau
    // déjà occupé par ce formateur est un CONFLIT, pas une modification.
    const { body } = await poserSeance({ statut: 'planifie', id: posee.body.seance.id });

    expect(body.seance.statut).toBe('planifie');
    expect(await AbsenceFormateur.countDocuments({})).toBe(0);
  });

  it('⚠️ RÉÉCRIRE la séance ne perd PAS l’observation déjà saisie', async () => {
    // Changer la salle d'une séance absente ne doit pas effacer le motif.
    const { body } = await poserSeance({ statut: 'absent' });
    const absence = await AbsenceFormateur.findOne({});

    await request(app)
      .patch(`/api/v2/absences/${absence.id}`)
      .set('Cookie', cookies)
      .send({ observation: 'Congé maladie' });

    await poserSeance({ statut: 'absent', salle: 'B02', id: body.seance.id });

    expect((await AbsenceFormateur.findById(absence.id)).observation).toBe('Congé maladie');
  });

  it('vider la case retire aussi l’absence', async () => {
    await poserSeance({ statut: 'absent' });

    await request(app)
      .delete(`/api/v2/seances/${SEMAINE}/case`)
      .set('Cookie', cookies)
      .send({ jour: 'Lundi', seance: 'S1', periode: 'jour', formateurMatricule: '9863' });

    expect(await AbsenceFormateur.countDocuments({})).toBe(0);
  });
});

describe('PATCH /absences/:id — rattrapage', () => {
  it('REPORTE 2,5 h dans la semaine du rattrapage', async () => {
    await chronogrammeAvec('GM101', [{ semaine: 'S16', heures: 5, type: 'P' }]);
    await poserSeance({ statut: 'absent' });
    const absence = await AbsenceFormateur.findOne({});

    // ⚠️ 2026-12-14 tombe en S16 — VÉRIFIÉ avec `semaineDe`, pas supposé : la
    // numérotation part du lundi de la semaine du 1er septembre, pas d'ISO 8601.
    const reponse = await request(app)
      .patch(`/api/v2/absences/${absence.id}`)
      .set('Cookie', cookies)
      .send({ dateRattrapage: '2026-12-14' });

    expect(reponse.status).toBe(200);
    expect(reponse.body.chronogramme.reporte).toBe(1);
    expect(await heuresDe('GM101', 'S16')).toBe(7.5);
  });

  it('⚠️⚠️ REPLANIFIER REPREND les heures de l’ANCIENNE date', async () => {
    /*
     * Sans cela, déplacer un rattrapage laisserait ses heures dans l'ancienne
     * semaine ET les ajouterait dans la nouvelle — le chronogramme annoncerait
     * 5 h de plus que la réalité.
     */
    await chronogrammeAvec('GM101', [
      { semaine: 'S16', heures: 5, type: 'P' },
      { semaine: 'S17', heures: 5, type: 'P' },
    ]);
    await poserSeance({ statut: 'absent' });
    const absence = await AbsenceFormateur.findOne({});

    const patch = (date) =>
      request(app)
        .patch(`/api/v2/absences/${absence.id}`)
        .set('Cookie', cookies)
        .send({ dateRattrapage: date });

    await patch('2026-12-14'); // S16 → 7,5 h
    await patch('2026-12-21'); // S17 → 7,5 h, et S16 REVIENT à 5 h

    expect(await heuresDe('GM101', 'S16')).toBe(5);
    expect(await heuresDe('GM101', 'S17')).toBe(7.5);
  });

  it('⚠️ CONFIRMER DEUX FOIS la même date ne compte pas double', async () => {
    await chronogrammeAvec('GM101', [{ semaine: 'S16', heures: 5, type: 'P' }]);
    await poserSeance({ statut: 'absent' });
    const absence = await AbsenceFormateur.findOne({});

    for (let essai = 0; essai < 2; essai += 1) {
      await request(app)
        .patch(`/api/v2/absences/${absence.id}`)
        .set('Cookie', cookies)
        .send({ dateRattrapage: '2026-12-14' });
    }

    expect(await heuresDe('GM101', 'S16')).toBe(7.5);
  });

  it('ANNULER le rattrapage reprend les heures', async () => {
    await chronogrammeAvec('GM101', [{ semaine: 'S16', heures: 5, type: 'P' }]);
    await poserSeance({ statut: 'absent' });
    const absence = await AbsenceFormateur.findOne({});

    const patch = (date) =>
      request(app)
        .patch(`/api/v2/absences/${absence.id}`)
        .set('Cookie', cookies)
        .send({ dateRattrapage: date });

    await patch('2026-12-14');
    const reponse = await patch(null);

    expect(reponse.body.dateRattrapage).toBeNull();
    expect(await heuresDe('GM101', 'S16')).toBe(5);
  });

  it('⚠️ UNE FUSION reporte dans le chronogramme de CHAQUE groupe', async () => {
    // Une séance synchrone couvre plusieurs groupes, et chacun a son planning :
    // n'en reporter qu'un laisserait les autres avec des heures jamais données.
    await chronogrammeAvec('GM101', [{ semaine: 'S16', heures: 5, type: 'P' }]);
    await chronogrammeAvec('GM102', [{ semaine: 'S16', heures: 2.5, type: 'S' }]);
    await poserSeance({ statut: 'absent', groupe: 'GM101 GM102' });
    const absence = await AbsenceFormateur.findOne({});

    await request(app)
      .patch(`/api/v2/absences/${absence.id}`)
      .set('Cookie', cookies)
      .send({ dateRattrapage: '2026-12-14' });

    expect(await heuresDe('GM101', 'S16')).toBe(7.5);
    expect(await heuresDe('GM102', 'S16')).toBe(5);
  });

  it('⚠️ DIT quand le report n’a pas pu se faire', async () => {
    // Un groupe sans chronogramme ne reçoit rien — se taire laisserait croire
    // le rattrapage inscrit.
    await poserSeance({ statut: 'absent' });
    const absence = await AbsenceFormateur.findOne({});

    const reponse = await request(app)
      .patch(`/api/v2/absences/${absence.id}`)
      .set('Cookie', cookies)
      .send({ dateRattrapage: '2026-12-14' });

    expect(reponse.body.chronogramme.reporte).toBe(0);
    expect(reponse.body.chronogramme.alertes).toEqual([
      expect.objectContaining({ groupe: 'GM101', etat: 'sans_chronogramme' }),
    ]);
  });

  it('l’observation s’enregistre sans toucher au rattrapage', async () => {
    await poserSeance({ statut: 'absent' });
    const absence = await AbsenceFormateur.findOne({});

    const reponse = await request(app)
      .patch(`/api/v2/absences/${absence.id}`)
      .set('Cookie', cookies)
      .send({ observation: 'Formation à Rabat' });

    expect(reponse.body.observation).toBe('Formation à Rabat');
    expect(reponse.body.dateRattrapage).toBeNull();
  });

  it('⚠️ REFUSE une absence d’un AUTRE établissement', async () => {
    // Même contrôle qu'ailleurs : l'identifiant seul ne donne pas le droit.
    await poserSeance({ statut: 'absent' });
    const absence = await AbsenceFormateur.findOne({});
    await AbsenceFormateur.updateOne(
      { _id: absence._id },
      { $set: { etablissementId: etablissement._id.toString().replace(/.$/, '0') } }
    );

    const reponse = await request(app)
      .patch(`/api/v2/absences/${absence.id}`)
      .set('Cookie', cookies)
      .send({ observation: 'tentative' });

    expect(reponse.status).toBe(404);
  });

  it('filtre les absences sans rattrapage', async () => {
    await poserSeance({ statut: 'absent' });
    await poserSeance({ statut: 'absent', jour: 'Mardi' });
    const [premiere] = await AbsenceFormateur.find({});

    await request(app)
      .patch(`/api/v2/absences/${premiere.id}`)
      .set('Cookie', cookies)
      .send({ dateRattrapage: '2026-12-14' });

    const attente = await request(app).get('/api/v2/absences?rattrapees=non').set('Cookie', cookies);
    const faites = await request(app).get('/api/v2/absences?rattrapees=oui').set('Cookie', cookies);

    expect(attente.body.absences).toHaveLength(1);
    expect(faites.body.absences).toHaveLength(1);
  });
});

describe('import d’une semaine et réinitialisation', () => {
  const poserDans = (semaineCible, surcharges = {}) =>
    request(app)
      .put(`/api/v2/seances/${semaineCible}/case`)
      .set('Cookie', cookies)
      .send({
        jour: 'Lundi',
        seance: 'S1',
        periode: 'jour',
        formateurMatricule: '9863',
        groupe: 'GM101',
        module: 'M101',
        salle: 'A12',
        ...surcharges,
      });

  const lire = async (semaineCible) =>
    (await request(app).get(`/api/v2/seances/${semaineCible}`).set('Cookie', cookies)).body.seances;

  it('COPIE les séances d’une autre semaine', async () => {
    await poserDans(SEMAINE);
    await poserDans(SEMAINE, { jour: 'Mardi', seance: 'S2' });

    const reponse = await request(app)
      .post('/api/v2/seances/2026-W5/importer')
      .set('Cookie', cookies)
      .send({ depuis: SEMAINE });

    expect(reponse.status).toBe(200);
    expect(reponse.body).toMatchObject({ importees: 2, remplacees: 0, depuis: SEMAINE });
    expect(await lire('2026-W5')).toHaveLength(2);
    // La source reste intacte : c'est une COPIE, pas un déplacement.
    expect(await lire(SEMAINE)).toHaveLength(2);
  });

  it('⚠️ RECALCULE les dates : elles doivent tomber dans la semaine visée', async () => {
    // Recopiées telles quelles, elles dateraient de la semaine d'origine et
    // l'avancement compterait ces heures au mauvais moment.
    await poserDans(SEMAINE);
    await request(app)
      .post('/api/v2/seances/2026-W5/importer')
      .set('Cookie', cookies)
      .send({ depuis: SEMAINE });

    const [copiee] = await lire('2026-W5');
    const [origine] = await lire(SEMAINE);
    expect(copiee.date).not.toBe(origine.date);
  });

  it('⚠️ LE STATUT « ABSENT » NE SE COPIE PAS', async () => {
    // Une absence appartient au jour où elle a eu lieu : la recopier inventerait
    // un rattrapage pour un cours qui n'a pas manqué.
    await poserDans(SEMAINE, { statut: 'absent' });
    await request(app)
      .post('/api/v2/seances/2026-W5/importer')
      .set('Cookie', cookies)
      .send({ depuis: SEMAINE });

    expect((await lire('2026-W5'))[0].statut).toBe('planifie');
    expect(await AbsenceFormateur.countDocuments({})).toBe(1);
  });

  it('REMPLACE ce que la semaine visée portait, et le CHIFFRE', async () => {
    await poserDans(SEMAINE);
    await poserDans('2026-W5', { jour: 'Jeudi', seance: 'S3' });

    const reponse = await request(app)
      .post('/api/v2/seances/2026-W5/importer')
      .set('Cookie', cookies)
      .send({ depuis: SEMAINE });

    expect(reponse.body.remplacees).toBe(1);
    expect(await lire('2026-W5')).toHaveLength(1);
    expect((await lire('2026-W5'))[0].jour).toBe('Lundi');
  });

  it('refuse une source VIDE, et la semaine elle-même', async () => {
    const vide = await request(app)
      .post('/api/v2/seances/2026-W5/importer')
      .set('Cookie', cookies)
      .send({ depuis: '2026-W9' });
    expect(vide.status).toBe(400);

    await poserDans(SEMAINE);
    const memeSemaine = await request(app)
      .post(`/api/v2/seances/${SEMAINE}/importer`)
      .set('Cookie', cookies)
      .send({ depuis: SEMAINE });
    expect(memeSemaine.status).toBe(400);
  });

  it('EFFACE une semaine, sans toucher aux autres', async () => {
    await poserDans(SEMAINE);
    await poserDans('2026-W5', { jour: 'Jeudi', seance: 'S3' });

    const reponse = await request(app)
      .post('/api/v2/seances/reinitialiser')
      .set('Cookie', cookies)
      .send({ portee: 'semaine', semaine: SEMAINE });

    expect(reponse.body).toMatchObject({ effacees: 1, portee: 'semaine' });
    expect(await lire(SEMAINE)).toHaveLength(0);
    expect(await lire('2026-W5')).toHaveLength(1);
  });

  it('EFFACE l’année entière', async () => {
    await poserDans(SEMAINE);
    await poserDans('2026-W5', { jour: 'Jeudi', seance: 'S3' });

    const reponse = await request(app)
      .post('/api/v2/seances/reinitialiser')
      .set('Cookie', cookies)
      .send({ portee: 'annee' });

    expect(reponse.body.effacees).toBe(2);
    expect(await lire('2026-W5')).toHaveLength(0);
  });

  it('⚠️ EMPORTE LES ABSENCES et REPREND leurs heures au chronogramme', async () => {
    /*
     * Sans cela, effacer une semaine laisserait des rattrapages inscrits pour
     * des cours qui n'existent plus — des heures que personne ne viendrait
     * donner ni chercher.
     */
    await chronogrammeAvec('GM101', [{ semaine: 'S16', heures: 5, type: 'P' }]);
    await poserDans(SEMAINE, { statut: 'absent' });
    const absence = await AbsenceFormateur.findOne({});
    await request(app)
      .patch(`/api/v2/absences/${absence.id}`)
      .set('Cookie', cookies)
      .send({ dateRattrapage: '2026-12-14' });
    expect(await heuresDe('GM101', 'S16')).toBe(7.5);

    await request(app)
      .post('/api/v2/seances/reinitialiser')
      .set('Cookie', cookies)
      .send({ portee: 'semaine', semaine: SEMAINE });

    expect(await AbsenceFormateur.countDocuments({})).toBe(0);
    expect(await heuresDe('GM101', 'S16')).toBe(5);
  });

  it('⚠️ « semaine » sans dire LAQUELLE est refusé', async () => {
    // Sans ce garde, la portée retomberait sur l'année entière en silence.
    const reponse = await request(app)
      .post('/api/v2/seances/reinitialiser')
      .set('Cookie', cookies)
      .send({ portee: 'semaine' });

    expect(reponse.status).toBe(400);
  });
});

describe('POST /absences/:id/rattrapage — placer dans la grille (2026-09-14)', () => {
  // La semaine suivante : Lundi 21/09/2026, S4 de l'année scolaire.
  const CIBLE = { semaine: '2026-W4', jour: 'Lundi', seance: 'S2', salle: 'A12' };

  const absente = async (surcharges = {}) => {
    await poserSeance({ statut: 'absent', ...surcharges });
    return AbsenceFormateur.findOne({});
  };

  const placer = (id, corps = CIBLE) =>
    request(app).post(`/api/v2/absences/${id}/rattrapage`).set('Cookie', cookies).send(corps);

  const seancesDe = async (semaine) =>
    (await request(app).get(`/api/v2/seances/${semaine}`).set('Cookie', cookies)).body.seances;

  it('POSE une séance « rattrapage » avec le groupe, le module et le formateur DE L’ABSENCE', async () => {
    const absence = await absente();

    const reponse = await placer(absence.id);

    expect(reponse.status).toBe(200);
    const [posee] = await seancesDe('2026-W4');
    expect(posee).toMatchObject({
      jour: 'Lundi',
      seance: 'S2',
      formateurMatricule: '9863',
      groupe: 'GM101',
      module: 'M101',
      salle: 'A12',
      statut: 'rattrape',
      rattrapageDe: absence.id,
    });
    // ⚠️ LA DATE EST CELLE DU CRÉNEAU, écrite dans la même transaction.
    expect(reponse.body.dateRattrapage).toBe(enJour(dateDuJour('2026-W4', 'Lundi')));
    expect(reponse.body.rattrapage).toMatchObject({ semaine: '2026-W4', jour: 'Lundi', seance: 'S2' });
  });

  it('⚠️ REPORTE les heures au chronogramme UNE SEULE FOIS', async () => {
    await chronogrammeAvec('GM101', [{ semaine: 'S4', heures: 5, type: 'P' }]);
    const absence = await absente();

    await placer(absence.id);

    expect(await heuresDe('GM101', 'S4')).toBe(7.5);
  });

  it('⚠️ LE CORPS NE PEUT PAS IMPOSER un autre groupe ou module', async () => {
    // Le serveur relit tout dans l'absence : un champ de plus est refusé, pas ignoré.
    const absence = await absente();

    const reponse = await placer(absence.id, { ...CIBLE, groupe: 'GM102', module: 'M999' });

    expect(reponse.status).toBe(400);
    expect(await seancesDe('2026-W4')).toHaveLength(0);
  });

  it('⚠️⚠️ DÉPLACER reprend l’ancien créneau ET ses heures', async () => {
    await chronogrammeAvec('GM101', [
      { semaine: 'S4', heures: 5, type: 'P' },
      { semaine: 'S5', heures: 5, type: 'P' },
    ]);
    const absence = await absente();

    await placer(absence.id);
    const reponse = await placer(absence.id, { ...CIBLE, semaine: '2026-W5', jour: 'Mardi' });

    expect(reponse.status).toBe(200);
    expect(await seancesDe('2026-W4')).toHaveLength(0);
    expect((await seancesDe('2026-W5')).filter((s) => s.statut === 'rattrape')).toHaveLength(1);
    expect(await heuresDe('GM101', 'S4')).toBe(5);
    expect(await heuresDe('GM101', 'S5')).toBe(7.5);
  });

  it('⚠️ UN PLACEMENT REFUSÉ NE PERD PAS le rattrapage déjà posé', async () => {
    // L'ancien est retiré dans la transaction : un refus l'annule, il reste là.
    await chronogrammeAvec('GM101', [{ semaine: 'S4', heures: 5, type: 'P' }]);
    const absence = await absente();
    await placer(absence.id);
    // Le formateur a déjà cours (GM102) le mardi S1 de la W5.
    await request(app)
      .put('/api/v2/seances/2026-W5/case')
      .set('Cookie', cookies)
      .send({ jour: 'Mardi', seance: 'S1', periode: 'jour', formateurMatricule: '9863', groupe: 'GM102', module: 'M101', salle: 'A12' });

    const refus = await placer(absence.id, { ...CIBLE, semaine: '2026-W5', jour: 'Mardi', seance: 'S1' });

    expect(refus.status).toBe(409);
    expect((await seancesDe('2026-W4'))[0]?.statut).toBe('rattrape');
    expect(await heuresDe('GM101', 'S4')).toBe(7.5);
  });

  it('ANNULER retire la séance, les heures et la date', async () => {
    await chronogrammeAvec('GM101', [{ semaine: 'S4', heures: 5, type: 'P' }]);
    const absence = await absente();
    await placer(absence.id);

    const reponse = await request(app)
      .delete(`/api/v2/absences/${absence.id}/rattrapage`)
      .set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(reponse.body.dateRattrapage).toBeNull();
    expect(await seancesDe('2026-W4')).toHaveLength(0);
    expect(await heuresDe('GM101', 'S4')).toBe(5);
  });

  it('⚠️ VIDER la case du rattrapage dans la grille rend l’absence « à rattraper »', async () => {
    await chronogrammeAvec('GM101', [{ semaine: 'S4', heures: 5, type: 'P' }]);
    const absence = await absente();
    await placer(absence.id);

    await request(app)
      .delete('/api/v2/seances/2026-W4/case')
      .set('Cookie', cookies)
      .send({ jour: 'Lundi', seance: 'S2', periode: 'jour', formateurMatricule: '9863' });

    const relue = await AbsenceFormateur.findById(absence.id);
    expect(relue.dateRattrapage).toBeNull();
    expect(relue.seanceRattrapageId).toBeNull();
    expect(await heuresDe('GM101', 'S4')).toBe(5);
  });

  it('⚠️ L’ABSENCE RETIRÉE EMPORTE sa séance de rattrapage', async () => {
    await absente();
    const absence = await AbsenceFormateur.findOne({});
    await placer(absence.id);
    const [manquee] = await seancesDe(SEMAINE);

    await poserSeance({ statut: 'planifie', id: manquee.id });

    expect(await AbsenceFormateur.countDocuments({})).toBe(0);
    expect(await seancesDe('2026-W4')).toHaveLength(0);
  });

  it('⚠️ UNE DATE SAISIE NE PEUT PLUS CONTREDIRE la séance posée', async () => {
    const absence = await absente();
    await placer(absence.id);

    const reponse = await request(app)
      .patch(`/api/v2/absences/${absence.id}`)
      .set('Cookie', cookies)
      .send({ dateRattrapage: '2026-12-14' });

    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('RATTRAPAGE_PLACE');
  });

  it('⚠️ LA SAISIE ORDINAIRE ne fabrique pas de rattrapage', async () => {
    const reponse = await poserSeance({ statut: 'rattrape' });
    expect(reponse.status).toBe(400);
  });

  it('⚠️ un rattrapage ne change que de SALLE depuis la grille — et reste un rattrapage', async () => {
    const absence = await absente();
    await Etablissement.updateOne({ _id: etablissement.id }, { $set: { espaces: ['A12', 'B02'] } });
    await placer(absence.id);
    const [posee] = await seancesDe('2026-W4');

    const vers = (surcharges) =>
      request(app)
        .put('/api/v2/seances/2026-W4/case')
        .set('Cookie', cookies)
        .send({
          id: posee.id,
          jour: 'Lundi',
          seance: 'S2',
          periode: 'jour',
          formateurMatricule: '9863',
          groupe: 'GM101',
          module: 'M101',
          salle: 'A12',
          statut: 'rattrape',
          ...surcharges,
        });

    expect((await vers({ groupe: 'GM102' })).status).toBe(400);
    expect((await vers({ statut: 'absent' })).status).toBe(400);

    const salle = await vers({ salle: 'B02', statut: 'planifie' });
    expect(salle.status).toBe(200);
    expect(salle.body.seance).toMatchObject({ salle: 'B02', statut: 'rattrape' });
  });

  it('⚠️ LA NATURE DU COURS EST GARDÉE : un présentiel ne se rattrape pas sur TEAMS', async () => {
    const absence = await absente();
    const reponse = await placer(absence.id, { ...CIBLE, salle: 'TEAMS' });
    expect(reponse.status).toBe(400);
  });

  it('refuse une salle qui n’existe pas', async () => {
    const absence = await absente();
    const reponse = await placer(absence.id, { ...CIBLE, salle: 'Z99' });
    expect(reponse.status).toBe(400);
  });

  it('⚠️ REFUSE un jour où le groupe est en stage — la grille seule ne suffit pas', async () => {
    await Etablissement.updateOne(
      { _id: etablissement.id },
      { $set: { stages: [{ groupe: 'GM101', debut: '2026-09-21', fin: '2026-09-21' }] } }
    );
    const absence = await absente();

    const reponse = await placer(absence.id);

    expect(reponse.status).toBe(400);
    expect(await seancesDe('2026-W4')).toHaveLength(0);
  });

  it('la liste rend la salle du cours manqué et le créneau posé', async () => {
    const absence = await absente();
    await placer(absence.id);

    const { body } = await request(app).get('/api/v2/absences').set('Cookie', cookies);

    expect(body.absences[0]).toMatchObject({
      salle: 'A12',
      periode: 'jour',
      rattrapage: { semaine: '2026-W4', jour: 'Lundi', seance: 'S2', salle: 'A12' },
    });
  });
});

describe('⚠️ La DATE d’une absence, sans décalage de fuseau', () => {
  /*
   * ═══ LE DÉFAUT SIGNALÉ PAR LE PORTEUR (2026-08-26) ═══
   * Une séance du LUNDI 31 août s'affichait « 2026-08-30 ». `dateDuJour` pose
   * minuit LOCAL — au Maroc, 23:00 UTC la VEILLE — et le service des absences
   * relisait avec `toISOString()` : un jour de moins, systématiquement, pour
   * tout poste à l'est de Greenwich.
   */
  it('rend le JOUR de la séance, pas la veille', async () => {
    await poserSeance({ statut: 'absent' });

    const reponse = await request(app).get('/api/v2/absences').set('Cookie', cookies);
    const absence = reponse.body.absences[0];

    // Le lundi de la semaine de test — celui que la grille affiche.
    const attendu = enJour(dateDuJour(SEMAINE, 'Lundi'));
    expect(absence.dateAbsence).toBe(attendu);
    // Et ce jour EST un lundi : un décalage d'un jour en ferait un dimanche.
    expect(new Date(`${absence.dateAbsence}T12:00:00`).getDay()).toBe(1);
  });
});
