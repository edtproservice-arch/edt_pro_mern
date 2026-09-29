import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { Seance } from '../../src/models/Seance.js';
import { Message } from '../../src/models/Message.js';
import { UnplacedSession } from '../../src/models/UnplacedSession.js';
import { Chronogramme } from '../../src/models/Chronogramme.js';
import { AutoGenConfig } from '../../src/models/AutoGenConfig.js';
import { oublierMemoire } from '../../src/modules/calendrier/joursFeries.service.js';
import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';
import { analyserSemaine, anneeScolaire, dateDuJour, valeurSemaine } from 'shared/domain';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Propositions d'emploi du temps (F10, Phase 9 b).
 * ← api/messaging/apply_proposition.php + get_proposals_conflicts.php
 *
 * ⚠️ LA SEMAINE EST TOUJOURS LA SUIVANTE (décision du 2026-09-23) : elle se
 * calcule ici depuis la date du jour, comme le fait le serveur.
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';

const PROCHAINE = new Date();
PROCHAINE.setDate(PROCHAINE.getDate() + 7);
const SEMAINE = valeurSemaine(PROCHAINE);
const ANNEE = anneeScolaire(PROCHAINE);

let etablissement;
let directeur;
let formateur;
let collegue;
let cookies;

const creer = (nom, email, role, extra = {}) =>
  User.create({
    nomComplet: nom,
    email,
    motDePasse: MOT_DE_PASSE,
    role,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
    ...extra,
  });

const connecter = async (email) =>
  (await request(app).post('/api/v2/auth/connexion').send({ identifiant: email, motDePasse: MOT_DE_PASSE }))
    .headers['set-cookie'];

beforeEach(async () => {
  oublierMemoire();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

  directeur = await creer('Directeur Test', 'directeur@edtpro.ma', ROLES.DIRECTEUR);
  etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Test',
    anneeScolaire: ANNEE,
    espaces: ['A12', 'B02'],
  });
  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  formateur = await creer('BRAHIM LOURID', 'f1@edtpro.ma', ROLES.FORMATEUR, {
    identifiant: '9863',
    etablissementIds: [etablissement.id],
  });
  collegue = await creer('AHMED CHERKAOUI', 'f2@edtpro.ma', ROLES.FORMATEUR, {
    identifiant: '4211',
    etablissementIds: [etablissement.id],
  });

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [
      { matricule: '9863', nomComplet: 'BRAHIM LOURID' },
      { matricule: '4211', nomComplet: 'AHMED CHERKAOUI' },
    ],
    groupes: ['GM101', 'GM102'],
    affectations: [
      { formateur: '9863', groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 60 },
      { formateur: '9863', groupe: 'GM102', module: 'M102', type: TYPES_COURS.PRESENTIEL, s1Heures: 60 },
      { formateur: '4211', groupe: 'GM101', module: 'M105', type: TYPES_COURS.PRESENTIEL, s1Heures: 60 },
    ],
  });

  cookies = {
    directeur: await connecter('directeur@edtpro.ma'),
    formateur: await connecter('f1@edtpro.ma'),
    collegue: await connecter('f2@edtpro.ma'),
  };
});

const seance = (surcharges = {}) =>
  Seance.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    semaine: SEMAINE,
    jour: 'Lundi',
    seance: 'S1',
    date: dateDuJour(SEMAINE, surcharges.jour ?? 'Lundi'),
    formateurMatricule: '9863',
    groupe: 'GM101',
    module: 'M101',
    salle: 'A12',
    ...surcharges,
  });

const proposer = (qui, seances, extra = {}) =>
  request(app).post('/api/v2/propositions').set('Cookie', cookies[qui]).send({ seances, ...extra });

const geste = (action, id, corps = {}, qui = 'directeur') =>
  request(app).post(`/api/v2/propositions/${id}/${action}`).set('Cookie', cookies[qui]).send(corps);

const s = (jour, creneau, groupe = 'GM101', module = 'M101', salle = 'A12') => ({
  jour,
  seance: creneau,
  groupe,
  module,
  salle,
});

const seancesDe = async (matricule = '9863') =>
  (await Seance.find({ semaine: SEMAINE, formateurMatricule: matricule }).lean())
    .map((x) => `${x.jour} ${x.seance} ${x.groupe}`)
    .sort();

describe('GET /propositions/nouvelle', () => {
  it('rend la semaine suivante, l’emploi actuel et les affectations du formateur', async () => {
    await seance();
    await seance({ jour: 'Mardi', seance: 'S3', estEfm: true });

    const reponse = await request(app).get('/api/v2/propositions/nouvelle').set('Cookie', cookies.formateur);

    expect(reponse.status).toBe(200);
    expect(reponse.body).toMatchObject({ semaine: SEMAINE, ouverte: true, motif: null, enCours: null, mode: 'deplacer' });
    expect(reponse.body.actuelles).toEqual([
      expect.objectContaining({ jour: 'Lundi', seance: 'S1', groupe: 'GM101', protegee: false }),
      expect.objectContaining({ jour: 'Mardi', seance: 'S3', protegee: true }),
    ]);
    expect(reponse.body.options.presentiel.modulesParGroupe).toEqual({ GM101: ['M101'], GM102: ['M102'] });
    expect(reponse.body.options.synchrone.groupes).toEqual([]);
    expect(reponse.body.espaces).toEqual(['A12', 'B02']);
    // Semestre, régional et posé — ce que la liste des modules de la page Emploi affiche.
    expect(reponse.body.indicateurs.fiches['GM101||M101']).toMatchObject({ semestre: '1', estRegional: false, presentiel: 60 });
    // Le Lundi S1 compte (2,5 h) ; l'EFM du mardi, non.
    expect(reponse.body.indicateurs.posees['GM101||M101']).toMatchObject({ presentiel: 2.5 });
    expect(reponse.body.indicateurs.fiches['GM101||M105']).toBeUndefined();
  });

  it('montre les créneaux proposés par un collègue', async () => {
    await proposer('collegue', [s('Lundi', 'S2', 'GM101', 'M105', 'B02')]);

    const reponse = await request(app).get('/api/v2/propositions/nouvelle').set('Cookie', cookies.formateur);
    expect(reponse.body.reservees).toEqual([
      { auteur: 'AHMED CHERKAOUI', seances: [s('Lundi', 'S2', 'GM101', 'M105', 'B02')] },
    ]);
  });

  it('se ferme quand la semaine est publiée', async () => {
    await Etablissement.updateOne(
      { _id: etablissement.id },
      { $set: { publications: [{ anneeScolaire: ANNEE, semaine: SEMAINE, publieeLe: new Date() }] } }
    );
    const reponse = await request(app).get('/api/v2/propositions/nouvelle').set('Cookie', cookies.formateur);
    expect(reponse.body).toMatchObject({ ouverte: false, motif: 'publiee' });
  });

  it('rend les indisponibilités du formateur — pour les AFFICHER, sans rien bloquer', async () => {
    await AutoGenConfig.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      contraintes: [
        { formateur: '9863', espaces: ['B02'], indisponibilites: [{ jour: 'Lundi', seance: 'S1' }] },
        { formateur: '4211', espaces: [], indisponibilites: [{ jour: 'Mardi', seance: 'S2' }] },
      ],
    });

    const reponse = await request(app).get('/api/v2/propositions/nouvelle').set('Cookie', cookies.formateur);
    expect(reponse.body.indisponibilites).toEqual([{ jour: 'Lundi', seance: 'S1' }]);
    // L'espace attribué, présélectionné à l'ajout manuel.
    expect(reponse.body.espacesAttribues).toEqual(['B02']);

    // Une séance proposée SUR l'indisponibilité passe quand même.
    expect((await proposer('formateur', [s('Lundi', 'S1')])).status).toBe(201);
  });

  it('est réservée au formateur', async () => {
    const reponse = await request(app).get('/api/v2/propositions/nouvelle').set('Cookie', cookies.directeur);
    expect(reponse.status).toBe(403);
  });
});

describe('POST /propositions — le formateur propose', () => {
  it('envoie au directeur un message qui PORTE la proposition', async () => {
    const reponse = await proposer('formateur', [s('Mardi', 'S1'), s('Lundi', 'S2')]);

    expect(reponse.status).toBe(201);
    expect(reponse.body.semaine).toBe(SEMAINE);

    const message = await Message.findById(reponse.body.id).lean();
    expect(String(message.destinataireId)).toBe(directeur.id);
    expect(message.proposition).toMatchObject({
      semaine: SEMAINE,
      formateurMatricule: '9863',
      statut: 'en_attente',
    });
    // Triée par jour puis créneau.
    expect(message.proposition.seances.map((x) => `${x.jour} ${x.seance}`)).toEqual(['Lundi S2', 'Mardi S1']);

    // Le directeur la lit dans son message.
    const lu = await request(app).get(`/api/v2/messages/${reponse.body.id}`).set('Cookie', cookies.directeur);
    expect(lu.body.message.proposition).toMatchObject({ semaine: SEMAINE, statut: 'en_attente' });
    expect(lu.body.message.proposition.seances).toHaveLength(2);
  });

  it('⚠️ refuse une semaine déjà publiée', async () => {
    await Etablissement.updateOne(
      { _id: etablissement.id },
      { $set: { publications: [{ anneeScolaire: ANNEE, semaine: SEMAINE, publieeLe: new Date() }] } }
    );
    const reponse = await proposer('formateur', [s('Lundi', 'S1')]);
    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('SEMAINE_PUBLIEE');
    expect(await Message.countDocuments()).toBe(0);
  });

  it('refuse un module qui ne lui est pas affecté', async () => {
    const reponse = await proposer('formateur', [s('Lundi', 'S1', 'GM101', 'M102')]);
    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('AFFECTATION_ABSENTE');
  });

  it('⚠️ refuse un formateur glissé dans la requête', async () => {
    const reponse = await proposer('formateur', [s('Lundi', 'S1')], { formateurMatricule: '4211' });
    expect(reponse.status).toBe(400);
  });

  it('refuse un créneau réservé par un collègue — même groupe', async () => {
    await proposer('collegue', [s('Lundi', 'S2', 'GM101', 'M105', 'B02')]);
    const reponse = await proposer('formateur', [s('Lundi', 'S2', 'GM101', 'M101', 'A12')]);
    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('CRENEAU_RESERVE');
    expect(reponse.body.details[0].message).toContain('AHMED CHERKAOUI');
  });

  it('refuse un créneau réservé par un collègue — même salle', async () => {
    await proposer('collegue', [s('Lundi', 'S2', 'GM101', 'M105', 'A12')]);
    const reponse = await proposer('formateur', [s('Lundi', 'S2', 'GM102', 'M102', 'A12')]);
    expect(reponse.status).toBe(409);
    expect(reponse.body.details[0].type).toBe('salle');
  });

  it('une nouvelle proposition REMPLACE la précédente', async () => {
    const premiere = await proposer('formateur', [s('Lundi', 'S1')]);
    const seconde = await proposer('formateur', [s('Lundi', 'S2')]);

    expect(seconde.status).toBe(201);
    expect(seconde.body.remplacees).toBe(1);
    expect((await Message.findById(premiere.body.id).lean()).proposition.statut).toBe('remplacee');

    // L'ancienne ne s'applique plus.
    const applique = await geste('appliquer', premiere.body.id);
    expect(applique.status).toBe(409);
    expect(applique.body.code).toBe('PROPOSITION_REMPLACEE');
  });

  it('⚠️ ne remplace pas une proposition déjà en partie appliquée', async () => {
    const premiere = await proposer('formateur', [s('Lundi', 'S2')]);
    await geste('appliquer', premiere.body.id, { jour: 'Lundi' });

    const seconde = await proposer('formateur', [s('Mardi', 'S2')]);
    expect(seconde.status).toBe(409);
    expect(seconde.body.code).toBe('PROPOSITION_EN_COURS');
  });

  it('une proposition refusée ne réserve plus rien', async () => {
    const autre = await proposer('collegue', [s('Lundi', 'S2', 'GM101', 'M105', 'B02')]);
    await geste('refuser', autre.body.id);
    expect((await proposer('formateur', [s('Lundi', 'S2')])).status).toBe(201);
  });
});

describe('POST /propositions/:id/appliquer — le directeur applique', () => {
  it('REMPLACE le jour : pose le nouveau, vide ce qui est laissé vide, ne touche pas aux autres jours', async () => {
    await seance(); // Lundi S1
    await seance({ jour: 'Mardi', seance: 'S1', groupe: 'GM102', module: 'M102' });
    // Emploi planifié : un DÉPLACEMENT (Lundi S1 → Lundi S2), le mardi inchangé.
    const { body } = await proposer('formateur', [s('Lundi', 'S2'), s('Mardi', 'S1', 'GM102', 'M102')]);

    const reponse = await geste('appliquer', body.id, { jour: 'Lundi' });

    expect(reponse.status).toBe(200);
    expect(reponse.body).toMatchObject({ jours: ['Lundi'], posees: 1, statut: 'partielle' });
    expect(await seancesDe()).toEqual(['Lundi S2 GM101', 'Mardi S1 GM102']);

    const p = (await Message.findById(body.id).lean()).proposition;
    expect(p.jours.Lundi).toBe('appliquee');
    expect(p.jours.Mardi).toBe('en_attente');
    expect(p.anciennes).toEqual([s('Lundi', 'S1')]);
    expect(String(p.traiteePar)).toBe(directeur.id);
  });

  it('refuse d’appliquer deux fois le même jour', async () => {
    const { body } = await proposer('formateur', [s('Lundi', 'S2')]);
    await geste('appliquer', body.id, { jour: 'Lundi' });
    const reponse = await geste('appliquer', body.id, { jour: 'Lundi' });
    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('DEJA_APPLIQUEE');
  });

  it('⚠️ TOUT OU RIEN : un conflit réel annule toute la semaine', async () => {
    await seance(); // Lundi S1, conservé si rien n'est écrit
    await seance({ seance: 'S4', groupe: 'GM102', module: 'M102' });
    // Le collègue occupe déjà la salle A12 le mardi en S3, dans la grille réelle.
    await seance({ jour: 'Mardi', seance: 'S3', formateurMatricule: '4211', module: 'M105', salle: 'A12' });
    const { body } = await proposer('formateur', [s('Lundi', 'S2'), s('Mardi', 'S3', 'GM102', 'M102')]);

    const reponse = await geste('appliquer', body.id);

    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('CRENEAU_OCCUPE');
    expect(reponse.body.message).toContain('Mardi S3');
    // Le lundi, pourtant traité AVANT le mardi, n'a pas bougé.
    expect(await seancesDe()).toEqual(['Lundi S1 GM101', 'Lundi S4 GM102']);
    expect((await Message.findById(body.id).lean()).proposition.statut).toBe('en_attente');
  });

  it('⚠️ un EFM reste en place quand la proposition laisse son créneau vide…', async () => {
    await seance({ seance: 'S3', estEfm: true });
    const { body } = await proposer('formateur', [s('Lundi', 'S1')]);

    expect((await geste('appliquer', body.id, { jour: 'Lundi' })).status).toBe(200);
    expect(await seancesDe()).toEqual(['Lundi S1 GM101', 'Lundi S3 GM101']);
  });

  it('⚠️ …et BLOQUE quand la proposition veut son créneau', async () => {
    await seance({ seance: 'S3', estEfm: true });
    const { body } = await proposer('formateur', [s('Lundi', 'S3', 'GM102', 'M102')]);

    const reponse = await geste('appliquer', body.id, { jour: 'Lundi' });
    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('CRENEAU_PROTEGE');
    expect(reponse.body.message).toContain('un EFM');
  });

  it('décompte les séances non placées au lieu de les effacer', async () => {
    await UnplacedSession.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      semaine: SEMAINE,
      formateurMatricule: '9863',
      groupe: 'GM101',
      module: 'M101',
      manquantes: 2,
      total: 4,
    });
    const { body } = await proposer('formateur', [s('Lundi', 'S2')]);
    await geste('appliquer', body.id, { jour: 'Lundi' });

    expect((await UnplacedSession.findOne().lean()).manquantes).toBe(1);
  });

  it('est réservé au directeur destinataire', async () => {
    const { body } = await proposer('formateur', [s('Lundi', 'S2')]);
    expect((await geste('appliquer', body.id, {}, 'formateur')).status).toBe(403);

    // Un autre directeur, dans son propre établissement : la proposition n'existe pas pour lui.
    const autre = await creer('Autre Directeur', 'autre@edtpro.ma', ROLES.DIRECTEUR);
    const sien = await Etablissement.create({
      proprietaireId: autre.id,
      region: 'Oriental',
      complexe: 'CF',
      nom: 'ISTA Ailleurs',
      anneeScolaire: ANNEE,
    });
    autre.etablissementIds = [sien.id];
    await autre.save();
    cookies.autre = await connecter('autre@edtpro.ma');

    expect((await geste('appliquer', body.id, {}, 'autre')).status).toBe(404);
    expect(await seancesDe()).toEqual([]);
  });
});

describe('POST /propositions/:id/retirer — RESTAURE ce qui existait', () => {
  it('remet les séances remplacées, retire les posées', async () => {
    await seance(); // Lundi S1
    await seance({ jour: 'Mardi', seance: 'S1', groupe: 'GM102', module: 'M102' });
    // Deux déplacements vers le lundi : S1 → S2, et la séance du mardi → Lundi S4.
    const { body } = await proposer('formateur', [s('Lundi', 'S2'), s('Lundi', 'S4', 'GM102', 'M102')]);
    await geste('appliquer', body.id, { jour: 'Lundi' });
    expect(await seancesDe()).toEqual(['Lundi S2 GM101', 'Lundi S4 GM102', 'Mardi S1 GM102']);

    const reponse = await geste('retirer', body.id, { jour: 'Lundi' });

    expect(reponse.status).toBe(200);
    expect(reponse.body.statut).toBe('en_attente');
    expect(await seancesDe()).toEqual(['Lundi S1 GM101', 'Mardi S1 GM102']);
    const p = (await Message.findById(body.id).lean()).proposition;
    expect(p.jours.Lundi).toBe('en_attente');
    expect(p.anciennes).toEqual([]);
  });

  it('refuse de retirer un jour jamais appliqué', async () => {
    const { body } = await proposer('formateur', [s('Lundi', 'S2')]);
    const reponse = await geste('retirer', body.id, { jour: 'Lundi' });
    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe('NON_APPLIQUEE');
  });
});

describe('POST /propositions/:id/refuser', () => {
  it('refuse ce qui n’est pas appliqué, garde ce qui l’est', async () => {
    const { body } = await proposer('formateur', [s('Lundi', 'S2'), s('Mardi', 'S2')]);
    await geste('appliquer', body.id, { jour: 'Lundi' });

    const reponse = await geste('refuser', body.id);

    expect(reponse.status).toBe(200);
    const p = (await Message.findById(body.id).lean()).proposition;
    expect(p.jours).toMatchObject({ Lundi: 'appliquee', Mardi: 'refusee', Samedi: 'refusee' });
    expect(p.statut).toBe('partielle');
    expect(await seancesDe()).toEqual(['Lundi S2 GM101']);

    expect((await geste('refuser', body.id)).status).toBe(409);
  });

  it('une proposition entièrement refusée est « refusée »', async () => {
    const { body } = await proposer('formateur', [s('Lundi', 'S2')]);
    expect((await geste('refuser', body.id)).body.statut).toBe('refusee');
  });
});

/*
 * ═══ LES TROIS CAS DU PORTEUR (2026-09-23) ═══
 * Emploi vide : libre. Emploi planifié : déplacer seulement. Chronogramme :
 * importer puis déplacer. Le serveur les fait respecter — l'écran ne fait que
 * cacher les boutons.
 */
describe('les trois modes de proposition', () => {
  const chronogramme = (heures, type = 'P') =>
    Chronogramme.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      groupe: 'GM101',
      planning: { M101: [{ semaine: `S${analyserSemaine(SEMAINE).numero}`, heures, type }] },
    });

  const nouvelle = () => request(app).get('/api/v2/propositions/nouvelle').set('Cookie', cookies.formateur);

  it('emploi vide, sans chronogramme : libre', async () => {
    const { body } = await nouvelle();
    expect(body).toMatchObject({ mode: 'libre', aImporter: [] });
    expect((await proposer('formateur', [s('Lundi', 'S1'), s('Mardi', 'S1', 'GM102', 'M102')])).status).toBe(201);
  });

  it('emploi planifié : un ajout ou un changement de salle est refusé, un déplacement accepté', async () => {
    await seance();

    const ajout = await proposer('formateur', [s('Lundi', 'S1'), s('Mardi', 'S1', 'GM102', 'M102')]);
    expect(ajout.status).toBe(400);
    expect(ajout.body.code).toBe('MODE_NON_RESPECTE');
    expect(ajout.body.details[0].message).toMatch(/^Séance ajoutée : GM102/);

    expect((await proposer('formateur', [s('Lundi', 'S1', 'GM101', 'M101', 'B02')])).status).toBe(400);
    expect((await proposer('formateur', [s('Jeudi', 'S4')])).status).toBe(201);
  });

  it('chronogramme : rend les séances à importer, ceil(heures / 2,5)', async () => {
    await chronogramme(5);
    const { body } = await nouvelle();
    expect(body.mode).toBe('chronogramme');
    expect(body.aImporter).toEqual([{ groupe: 'GM101', module: 'M101', type: 'presentiel', nombre: 2, salle: '' }]);
  });

  it('chronogramme : accepte les séances importées, refuse le surnombre et le hors-chronogramme', async () => {
    await chronogramme(5);

    const trop = await proposer('formateur', [s('Lundi', 'S1'), s('Lundi', 'S2'), s('Lundi', 'S3')]);
    expect(trop.status).toBe(400);
    expect(trop.body.code).toBe('MODE_NON_RESPECTE');

    expect((await proposer('formateur', [s('Lundi', 'S1', 'GM102', 'M102')])).status).toBe(400);

    // Salle au choix : l'import n'en connaît pas toujours une.
    expect((await proposer('formateur', [s('Lundi', 'S1', 'GM101', 'M101', 'B02'), s('Mardi', 'S3')])).status).toBe(201);
  });

  it('⚠️ l’emploi planifié l’emporte sur le chronogramme', async () => {
    await chronogramme(5);
    await seance();
    expect((await nouvelle()).body.mode).toBe('deplacer');
  });

  it('⚠️ TEAMS ne propose que les libellés FUSIONNÉS, une salle les groupes un par un', async () => {
    await Base.updateOne(
      {},
      {
        $push: {
          affectations: { formateur: '9863', groupe: 'GM101 GM102', module: 'M205', type: TYPES_COURS.SYNCHRONE, s1Heures: 30 },
        },
      }
    );
    const { options } = (await nouvelle()).body;
    expect(options.synchrone).toEqual({ groupes: ['GM101 GM102'], modulesParGroupe: { 'GM101 GM102': ['M205'] } });
    expect(options.presentiel.groupes).toEqual(['GM101', 'GM102']);
  });

  it('un synchrone s’importe en TEAMS', async () => {
    await Base.updateOne(
      {},
      {
        $push: {
          affectations: { formateur: '9863', groupe: 'GM101', module: 'M101', type: TYPES_COURS.SYNCHRONE, s1Heures: 30 },
        },
      }
    );
    await chronogramme(2.5, 'S');
    expect((await nouvelle()).body.aImporter).toEqual([
      { groupe: 'GM101', module: 'M101', type: 'synchrone', nombre: 1, salle: 'TEAMS' },
    ]);
  });
});
