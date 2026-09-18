import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { Message } from '../../src/models/Message.js';
import { Partage } from '../../src/models/Partage.js';
import { AuditLog, ACTIONS_AUDIT } from '../../src/models/AuditLog.js';
import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';
import { PAGES_PARTAGEABLES, pagesPretes } from 'shared/domain';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Partage des pages collaboratives — la boîte « Partager » (Phase 5bis, c).
 *
 * ⚠️ CE QUI EST ÉPROUVÉ ICI, C'EST LA FRONTIÈRE : que l'emploi du temps se lise
 * et s'écrive selon le DROIT sur la page — invitation, accès général, rôle —
 * et jamais au-delà. L'écran guide ; ces tests disent ce que le serveur refuse.
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;
const SEMAINE = '2026-W3';

let etablissement;
let comptes;
const cookies = {};

const seance = {
  jour: 'Lundi',
  seance: 'S1',
  periode: 'jour',
  formateurMatricule: '9863',
  groupe: 'GM101',
  module: 'M101',
  salle: 'A12',
};

async function creer(role, email, etablissementIds) {
  return User.create({
    nomComplet: `${role.toUpperCase()} ${email.split('@')[0].toUpperCase()}`,
    email,
    motDePasse: MOT_DE_PASSE,
    role,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
    etablissementIds,
  });
}

async function seConnecter(email) {
  const reponse = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: email, motDePasse: MOT_DE_PASSE });
  expect(reponse.status).toBe(200);
  return reponse.headers['set-cookie'];
}

const en = (qui) => ({
  get: (url) => request(app).get(url).set('Cookie', cookies[qui]).set('X-Annee-Scolaire', String(ANNEE)),
  post: (url, corps) =>
    request(app).post(url).set('Cookie', cookies[qui]).set('X-Annee-Scolaire', String(ANNEE)).send(corps),
  put: (url, corps) =>
    request(app).put(url).set('Cookie', cookies[qui]).set('X-Annee-Scolaire', String(ANNEE)).send(corps),
  patch: (url, corps) =>
    request(app).patch(url).set('Cookie', cookies[qui]).set('X-Annee-Scolaire', String(ANNEE)).send(corps),
  delete: (url, corps) =>
    request(app).delete(url).set('Cookie', cookies[qui]).set('X-Annee-Scolaire', String(ANNEE)).send(corps),
});

/** Le message d'invitation EN ATTENTE d'un compte, s'il en a un. */
const invitationDe = (utilisateur) =>
  Message.findOne({ destinataireId: utilisateur.id, 'invitation.statut': 'en_attente' });

/**
 * ═══ ROUVRE AU PARTAGE, LE TEMPS D'UN BLOC, DES PAGES QUI NE SE PARTAGENT PLUS ═══
 * (2026-09-14 : seules Emploi, Chronogramme et Affectations se partagent.) Les
 * routes des autres gardent leur contrôle par droit (`exigerDroitPage`) — c'est
 * lui qu'on garde éprouvé, pour le jour où une page rouvrirait. La valeur
 * d'origine est RENDUE après chaque test : un bloc ne doit pas en ouvrir un autre.
 */
function ouvrirLeTempsDuBloc(pages) {
  const avant = {};
  beforeEach(() => {
    for (const page of pages) {
      avant[page] = PAGES_PARTAGEABLES[page].prete;
      PAGES_PARTAGEABLES[page].prete = true;
    }
  });
  afterEach(() => {
    for (const page of pages) PAGES_PARTAGEABLES[page].prete = avant[page];
  });
}

/** La clé de `cookies` d'un compte de la fixture. */
const cleDe = (utilisateur) => Object.keys(comptes).find((cle) => comptes[cle].id === utilisateur.id);

/** Répond à l'invitation en attente d'un compte, avec SA session. */
async function repondre(utilisateur, reponse = 'accepter') {
  const message = await invitationDe(utilisateur);
  if (!message) return null;
  return en(cleDe(utilisateur)).post(`/api/v2/partages/invitations/${message.id}/${reponse}`);
}

/**
 * Invite, puis — par défaut — ACCEPTE avec la session de l'invité : depuis le
 * 2026-09-12, une invitation en attente ne donne aucun accès.
 */
async function inviter(utilisateur, droit = 'modifier', { accepter = true } = {}) {
  const reponse = await en('directeur').post('/api/v2/partages/emploi/membres', {
    utilisateurIds: [utilisateur.id],
    droit,
  });
  if (accepter && reponse.status === 200) await repondre(utilisateur, 'accepter');
  return reponse;
}

beforeEach(async () => {
  const directeur = await creer(ROLES.DIRECTEUR, 'directeur@edtpro.ma', []);
  etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Test',
    anneeScolaire: ANNEE,
    espaces: ['A12'],
  });
  const voisin = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Voisin',
    anneeScolaire: ANNEE,
  });
  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  comptes = {
    directeur,
    formateur: await creer(ROLES.FORMATEUR, 'formateur@edtpro.ma', [etablissement.id]),
    autreFormateur: await creer(ROLES.FORMATEUR, 'autre@edtpro.ma', [etablissement.id]),
    gestionnaire: await creer(ROLES.GESTIONNAIRE, 'gestionnaire@edtpro.ma', [etablissement.id]),
    stagiaire: await creer(ROLES.STAGIAIRE, 'stagiaire@edtpro.ma', [etablissement.id]),
    etranger: await creer(ROLES.FORMATEUR, 'etranger@edtpro.ma', [voisin.id]),
  };

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [{ matricule: '9863', nomComplet: 'BRAHIM LOURID' }],
    groupes: ['GM101'],
    affectations: [
      { formateur: '9863', groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 },
    ],
  });

  for (const qui of ['directeur', 'formateur', 'autreFormateur', 'gestionnaire']) {
    cookies[qui] = await seConnecter(comptes[qui].email);
  }
});

describe('la boîte « Partager » du directeur', () => {
  it('liste qui peut être invité — formateurs et gestionnaires de SON établissement', async () => {
    const reponse = await en('directeur').get('/api/v2/partages/emploi');

    expect(reponse.status).toBe(200);
    expect(reponse.body.partage.membres).toEqual([]);
    expect(reponse.body.partage.general).toEqual({ portee: 'restreint', droit: 'consulter' });
    expect(reponse.body.partage.candidats.map((c) => c.email).sort()).toEqual(
      ['autre@edtpro.ma', 'formateur@edtpro.ma', 'gestionnaire@edtpro.ma'].sort()
    );
    // Le gestionnaire consulte déjà par son rôle : la boîte le dit.
    expect(reponse.body.partage.gestionnairesParRole).toBe(1);
  });

  it('refuse la boîte à tout autre que le directeur', async () => {
    expect((await en('gestionnaire').get('/api/v2/partages/emploi')).status).toBe(403);
    await inviter(comptes.formateur);
    expect((await en('formateur').get('/api/v2/partages/emploi')).status).toBe(403);
    expect((await en('formateur').post('/api/v2/partages/emploi/membres', {
      utilisateurIds: [comptes.autreFormateur.id],
      droit: 'modifier',
    })).status).toBe(403);
  });

  /*
   * ⚠️ ISOLATION : un compte d'un autre établissement, ou un stagiaire, ne
   * s'invite pas — l'identifiant vient du client, le serveur le revérifie.
   */
  it('refuse d’inviter un compte d’ailleurs ou un stagiaire', async () => {
    const reponse = await en('directeur').post('/api/v2/partages/emploi/membres', {
      utilisateurIds: [comptes.etranger.id, comptes.stagiaire.id],
      droit: 'modifier',
    });
    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('INVITES_REFUSES');
  });

  // Le directeur accorde consulter ou modifier — jamais la propriété.
  it('refuse d’accorder la propriété', async () => {
    const reponse = await inviter(comptes.formateur, 'proprietaire');
    expect(reponse.status).toBe(400);
  });

  it('prévient l’invité par la messagerie, et trace l’invitation', async () => {
    const reponse = await inviter(comptes.formateur, 'modifier', { accepter: false });
    expect(reponse.status).toBe(200);
    expect(reponse.body.partage.membres).toEqual([
      expect.objectContaining({ email: 'formateur@edtpro.ma', droit: 'modifier', statut: 'en_attente' }),
    ]);
    // Un membre n'est plus proposé à l'invitation : il change de droit dans sa ligne.
    expect(reponse.body.partage.candidats.map((c) => c.email)).not.toContain('formateur@edtpro.ma');

    const message = await Message.findOne({ destinataireId: comptes.formateur.id });
    expect(message.sujet).toMatch(/Invitation à collaborer/);
    expect(message.corps).toMatch(/vous pourrez modifier/);
    // ⚠️ Plus de lien : l'adresse n'est pas encore hébergée (demande du porteur).
    expect(message.corps).not.toMatch(/https?:\/\//);
    expect(message.invitation).toMatchObject({ pages: ['emploi'], droit: 'modifier', statut: 'en_attente' });

    const trace = await AuditLog.findOne({ action: ACTIONS_AUDIT.PARTAGE_MODIFIE });
    expect(trace.details).toMatchObject({ page: 'emploi', action: 'inviter', droit: 'modifier' });
  });

  // ⚠️ Une seconde invitation ne double pas la ligne : elle change le droit.
  it('réinviter un membre met son droit à jour sans le doubler', async () => {
    await inviter(comptes.formateur, 'modifier');
    const reponse = await inviter(comptes.formateur, 'consulter');
    expect(reponse.body.partage.membres).toHaveLength(1);
    expect(reponse.body.partage.membres[0].droit).toBe('consulter');
    // Et le message ne part qu'à la PREMIÈRE invitation.
    expect(await Message.countDocuments({ destinataireId: comptes.formateur.id })).toBe(1);
  });
});

describe('l’emploi du temps suit le droit sur la page', () => {
  it('ferme la page à un formateur non invité', async () => {
    const reponse = await en('formateur').get('/api/v2/seances/contexte');
    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('PAGE_NON_PARTAGEE');
  });

  it('laisse un invité « peut modifier » lire ET poser une séance', async () => {
    await inviter(comptes.formateur, 'modifier');

    expect((await en('formateur').get('/api/v2/seances/contexte')).status).toBe(200);
    expect((await en('formateur').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(200);
    expect((await en('formateur').put(`/api/v2/seances/${SEMAINE}/case`, seance)).status).toBe(200);
  });

  /*
   * ⚠️ PUBLIER, IMPORTER, EFM, RÉINITIALISER restent au directeur (décision du
   * 2026-09-12) : un invité « peut modifier » agit sur des CASES, pas sur des
   * semaines entières ni sur ce que voient formateurs et stagiaires.
   */
  it('garde au directeur publier, importer et réinitialiser', async () => {
    await inviter(comptes.formateur, 'modifier');

    expect((await en('formateur').put('/api/v2/seances/publication', { semaine: SEMAINE })).status).toBe(403);
    expect((await en('formateur').post(`/api/v2/seances/${SEMAINE}/importer`, { depuis: '2026-W2' })).status).toBe(403);
    expect((await en('formateur').post('/api/v2/seances/reinitialiser', { portee: 'annee' })).status).toBe(403);
  });

  it('laisse un invité « peut consulter » lire, jamais écrire', async () => {
    await inviter(comptes.formateur, 'consulter');

    expect((await en('formateur').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(200);
    const pose = await en('formateur').put(`/api/v2/seances/${SEMAINE}/case`, seance);
    expect(pose.status).toBe(403);
    expect(pose.body.code).toBe('DROIT_INSUFFISANT');
  });

  /*
   * ⚠️ LE GESTIONNAIRE N'ÉCRIT PLUS PAR SON SEUL RÔLE : il consulte (« Édition »),
   * et écrit s'il est invité. C'est le serveur qui rejoint enfin l'écran.
   */
  it('laisse le gestionnaire consulter par son rôle, et écrire s’il est invité', async () => {
    expect((await en('gestionnaire').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(200);
    expect((await en('gestionnaire').put(`/api/v2/seances/${SEMAINE}/case`, seance)).status).toBe(403);

    await inviter(comptes.gestionnaire, 'modifier');
    expect((await en('gestionnaire').put(`/api/v2/seances/${SEMAINE}/case`, seance)).status).toBe(200);
  });

  it('ouvre la page à tout l’établissement par l’accès général', async () => {
    const general = await en('directeur').patch('/api/v2/partages/emploi/general', {
      portee: 'etablissement',
      droit: 'modifier',
    });
    expect(general.status).toBe(200);

    // Un formateur jamais invité peut désormais poser.
    expect((await en('autreFormateur').put(`/api/v2/seances/${SEMAINE}/case`, seance)).status).toBe(200);

    // Revenir au restreint la referme.
    await en('directeur').patch('/api/v2/partages/emploi/general', { portee: 'restreint' });
    expect((await en('autreFormateur').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(403);
  });

  it('referme la page sur-le-champ quand le directeur retire l’invité', async () => {
    await inviter(comptes.formateur, 'modifier');
    expect((await en('formateur').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(200);

    const retrait = await en('directeur').delete(`/api/v2/partages/emploi/membres/${comptes.formateur.id}`);
    expect(retrait.status).toBe(200);
    expect(retrait.body.partage.membres).toEqual([]);

    expect((await en('formateur').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(403);
  });

  it('change le droit d’un membre depuis sa ligne', async () => {
    await inviter(comptes.formateur, 'modifier');
    const changement = await en('directeur').patch(
      `/api/v2/partages/emploi/membres/${comptes.formateur.id}`,
      { droit: 'consulter' }
    );
    expect(changement.body.partage.membres[0].droit).toBe('consulter');
    expect((await en('formateur').put(`/api/v2/seances/${SEMAINE}/case`, seance)).status).toBe(403);
  });
});

describe('GET /partages/moi — ce que le menu doit montrer', () => {
  it('annonce la page partagée à l’invité', async () => {
    await inviter(comptes.formateur, 'consulter');
    const reponse = await en('formateur').get('/api/v2/partages/moi');
    expect(reponse.body.pages).toEqual([
      { page: 'emploi', droit: 'consulter', source: 'invitation', partagee: true },
    ]);
  });

  /*
   * ⚠️ Le gestionnaire consulte par son rôle, depuis « Édition » : ce n'est PAS
   * une page « partagée », et son menu ne doit pas la doubler.
   */
  it('ne présente pas l’accès par le rôle comme un partage', async () => {
    const reponse = await en('gestionnaire').get('/api/v2/partages/moi');
    // Documents n'y figure plus depuis le 2026-09-14 : la page ne se partage pas — le
    // gestionnaire la garde par son rôle, et son menu l'avait déjà.
    expect(reponse.body.pages).toEqual([
      { page: 'emploi', droit: 'consulter', source: 'role', partagee: false },
    ]);
  });

  it('ne rend rien au formateur non invité', async () => {
    const reponse = await en('formateur').get('/api/v2/partages/moi');
    expect(reponse.body.pages).toEqual([]);
  });
});

describe('suppression d’un compte', () => {
  // ⚠️ Un compte supprimé ne doit pas rester en ligne morte dans les partages.
  it('retire le compte supprimé de la liste des invités', async () => {
    await inviter(comptes.formateur, 'modifier');
    await inviter(comptes.autreFormateur, 'consulter');

    const suppression = await en('directeur').delete(`/api/v2/comptes/${comptes.formateur.id}`);
    expect(suppression.status).toBe(200);

    const partage = await Partage.findOne({ page: 'emploi' }).lean();
    expect(partage.membres.map((m) => String(m.utilisateurId))).toEqual([comptes.autreFormateur.id]);
  });
});

describe('acceptation de l’invitation', () => {
  /*
   * ═══ ⚠️ UNE INVITATION DOIT ÊTRE ACCEPTÉE (demande du porteur, 2026-09-12) ═══
   */
  it('ne donne AUCUN accès tant qu’elle n’est pas acceptée', async () => {
    await inviter(comptes.formateur, 'modifier', { accepter: false });

    expect((await en('formateur').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(403);
    expect((await en('formateur').get('/api/v2/partages/moi')).body.pages).toEqual([]);
  });

  it('ouvre la page à l’acceptation, et le message le garde', async () => {
    await inviter(comptes.formateur, 'modifier', { accepter: false });
    const reponse = await repondre(comptes.formateur, 'accepter');

    expect(reponse.status).toBe(200);
    expect(reponse.body).toMatchObject({ statut: 'acceptee', pages: ['emploi'] });
    expect((await en('formateur').put(`/api/v2/seances/${SEMAINE}/case`, seance)).status).toBe(200);

    const message = await Message.findOne({ destinataireId: comptes.formateur.id });
    expect(message.invitation.statut).toBe('acceptee');

    // La boîte du directeur ne la dit plus « en attente ».
    const boite = await en('directeur').get('/api/v2/partages/emploi');
    expect(boite.body.partage.membres[0].statut).toBe('accepte');
  });

  it('refuse une seconde réponse à la même invitation', async () => {
    await inviter(comptes.formateur, 'modifier', { accepter: false });
    const message = await invitationDe(comptes.formateur);
    await en('formateur').post(`/api/v2/partages/invitations/${message.id}/accepter`);

    const seconde = await en('formateur').post(`/api/v2/partages/invitations/${message.id}/refuser`);
    expect(seconde.status).toBe(409);
    expect(seconde.body.code).toBe('INVITATION_TRAITEE');
  });

  it('retire l’invité qui refuse', async () => {
    await inviter(comptes.formateur, 'modifier', { accepter: false });
    const reponse = await repondre(comptes.formateur, 'refuser');

    expect(reponse.body.statut).toBe('refusee');
    const partage = await Partage.findOne({ page: 'emploi' }).lean();
    expect(partage.membres).toEqual([]);
    expect((await en('formateur').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(403);
  });

  // ⚠️ Seul le DESTINATAIRE répond : sinon l'identifiant du message suffirait.
  it('refuse qu’un autre que l’invité réponde à sa place', async () => {
    await inviter(comptes.formateur, 'modifier', { accepter: false });
    const message = await invitationDe(comptes.formateur);

    const usurpation = await en('autreFormateur').post(`/api/v2/partages/invitations/${message.id}/accepter`);
    expect(usurpation.status).toBe(404);
    expect((await en('formateur').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(403);
  });

  it('éteint les boutons d’une invitation que le directeur retire avant la réponse', async () => {
    await inviter(comptes.formateur, 'modifier', { accepter: false });
    const message = await invitationDe(comptes.formateur);

    await en('directeur').delete(`/api/v2/partages/emploi/membres/${comptes.formateur.id}`);

    const relu = await Message.findById(message.id);
    expect(relu.invitation.statut).toBe('retiree');
    const tentative = await en('formateur').post(`/api/v2/partages/invitations/${message.id}/accepter`);
    expect(tentative.status).toBe(409);
    expect((await en('formateur').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(403);
  });

  /*
   * ⚠️ Une invitation écrite AVANT la règle (sans statut) fonctionnait déjà :
   * elle ne doit pas être coupée par la mise à jour.
   */
  it('laisse valoir une invitation antérieure, sans statut', async () => {
    await Partage.collection.insertOne({
      etablissementId: etablissement._id,
      anneeScolaire: ANNEE,
      page: 'emploi',
      general: { portee: 'restreint', droit: 'consulter' },
      membres: [{ utilisateurId: comptes.formateur._id, droit: 'modifier', invitePar: comptes.directeur._id }],
    });
    expect((await en('formateur').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(200);
  });
});

describe('invitation sur plusieurs pages (étape d)', () => {
  // Sessions : en lecture seule — c'est ce qu'éprouve le bornage ci-dessous.
  ouvrirLeTempsDuBloc(['sessions']);
  // Toutes les pages sont prêtes depuis l'étape d4 : plus rien à ouvrir le temps du test.

  const inviterSur = (utilisateur, pages, droit = 'modifier') =>
    en('directeur').post('/api/v2/partages/emploi/membres', { utilisateurIds: [utilisateur.id], droit, pages });

  it('pose le membre sur chaque page, et n’envoie qu’UN message', async () => {
    const reponse = await inviterSur(comptes.formateur, ['chronogramme']);
    expect(reponse.status).toBe(200);

    const partages = await Partage.find({}).lean();
    expect(partages.map((p) => p.page).sort()).toEqual(['chronogramme', 'emploi']);
    for (const p of partages) expect(p.membres[0]).toMatchObject({ droit: 'modifier', statut: 'en_attente' });

    const messages = await Message.find({ destinataireId: comptes.formateur.id });
    expect(messages).toHaveLength(1);
    expect(messages[0].invitation.pages).toEqual(['emploi', 'chronogramme']);
    expect(messages[0].sujet).toBe('Invitation à collaborer sur 2 pages');
  });

  it('ouvre toutes les pages d’un seul « Accepter »', async () => {
    await inviterSur(comptes.formateur, ['chronogramme']);
    expect((await repondre(comptes.formateur, 'accepter')).status).toBe(200);

    const reponse = await en('formateur').get('/api/v2/partages/moi');
    expect(reponse.body.pages.map((p) => p.page).sort()).toEqual(['chronogramme', 'emploi']);
  });

  // ⚠️ Sessions est en lecture seule : « modifier » y devient « consulter ».
  it('borne le droit page par page, et le message le dit', async () => {
    await inviterSur(comptes.formateur, ['sessions'], 'modifier');

    const sessions = await Partage.findOne({ page: 'sessions' }).lean();
    expect(sessions.membres[0].droit).toBe('consulter');
    const emploi = await Partage.findOne({ page: 'emploi' }).lean();
    expect(emploi.membres[0].droit).toBe('modifier');

    const message = await Message.findOne({ destinataireId: comptes.formateur.id });
    expect(message.corps).toMatch(/Emploi du temps — vous pourrez modifier/);
    expect(message.corps).toMatch(/Sessions — vous pourrez consulter/);
  });

  // ⚠️ Déjà membre de l'emploi du temps : son nouveau message n'annonce que le reste.
  it('n’annonce à un membre existant que les pages nouvelles pour lui', async () => {
    await inviter(comptes.formateur, 'modifier');
    await inviterSur(comptes.formateur, ['chronogramme']);

    const messages = await Message.find({ destinataireId: comptes.formateur.id }).sort({ createdAt: 1 });
    expect(messages).toHaveLength(2);
    expect(messages[1].invitation.pages).toEqual(['chronogramme']);
  });
});

describe('un droit par page, et les pages d’un invité (2026-09-13)', () => {
  ouvrirLeTempsDuBloc(['absences', 'sessions']);
  const pagesDe = (utilisateur) => en('directeur').get(`/api/v2/partages/membres/${utilisateur.id}`);
  const regler = (utilisateur, droits) =>
    en('directeur').put(`/api/v2/partages/membres/${utilisateur.id}`, { droits });
  const membreSur = async (page, utilisateur) =>
    (await Partage.findOne({ page }).lean())?.membres.find((m) => String(m.utilisateurId) === utilisateur.id);

  it('accorde à chaque page SON droit, borné, et le message les nomme un par un', async () => {
    const reponse = await en('directeur').post('/api/v2/partages/emploi/membres', {
      utilisateurIds: [comptes.formateur.id],
      droits: { emploi: 'modifier', absences: 'consulter', sessions: 'modifier' },
    });
    expect(reponse.status).toBe(200);

    expect((await membreSur('emploi', comptes.formateur)).droit).toBe('modifier');
    expect((await membreSur('absences', comptes.formateur)).droit).toBe('consulter');
    // Sessions est en lecture seule : « modifier » y devient « consulter ».
    expect((await membreSur('sessions', comptes.formateur)).droit).toBe('consulter');

    const message = await invitationDe(comptes.formateur);
    expect(message.invitation.droit).toBe('modifier');
    expect(message.invitation.droits.map(({ page, droit }) => [page, droit])).toEqual([
      ['emploi', 'modifier'],
      ['absences', 'consulter'],
      ['sessions', 'consulter'],
    ]);
    expect(message.corps).toMatch(/Absences — vous pourrez consulter/);

    // ⚠️ Le PRÉSENTATEUR de la messagerie les rend : sans eux, la carte ne dirait que le plus haut.
    const lu = await en('formateur').get(`/api/v2/messages/${message.id}`);
    expect(lu.status).toBe(200);
    expect(lu.body.message.invitation.droits).toEqual([
      { page: 'emploi', droit: 'modifier' },
      { page: 'absences', droit: 'consulter' },
      { page: 'sessions', droit: 'consulter' },
    ]);
  });

  it('refuse une page inconnue dans `droits`', async () => {
    const reponse = await en('directeur').post('/api/v2/partages/emploi/membres', {
      utilisateurIds: [comptes.formateur.id],
      droits: { inexistante: 'modifier' },
    });
    expect(reponse.status).toBe(400);
    expect(await Partage.countDocuments()).toBe(0);
  });

  it('rend toutes les pages d’un invité, avec ce qu’il aurait sans invitation', async () => {
    await inviter(comptes.gestionnaire, 'modifier', { accepter: false });

    const reponse = await pagesDe(comptes.gestionnaire);
    expect(reponse.status).toBe(200);
    // Les seules pages qui se partagent — ici, avec les deux rouvertes par le bloc.
    expect(reponse.body.pages.map((p) => p.page)).toEqual(pagesPretes());

    const emploi = reponse.body.pages.find((p) => p.page === 'emploi');
    expect(emploi.invitation).toEqual({ droit: 'modifier', statut: 'en_attente' });
    // Le gestionnaire consulte l'emploi du temps par son RÔLE : la ligne le dit.
    expect(emploi.sansInvitation).toMatchObject({ droit: 'consulter' });

    const absences = reponse.body.pages.find((p) => p.page === 'absences');
    expect(absences.invitation).toBeNull();
    expect(absences.sansInvitation).toBeNull();
    expect(reponse.body.pages.find((p) => p.page === 'sessions').droitMax).toBe('consulter');
  });

  it('règle plusieurs pages d’un coup : change, retire, ajoute — et n’annonce que les nouvelles', async () => {
    await en('directeur').post('/api/v2/partages/emploi/membres', {
      utilisateurIds: [comptes.formateur.id],
      droits: { emploi: 'modifier', absences: 'modifier' },
    });
    await repondre(comptes.formateur, 'accepter');

    const reponse = await regler(comptes.formateur, { emploi: 'consulter', absences: null, chronogramme: 'modifier' });
    expect(reponse.status).toBe(200);

    // Le droit change, l'acceptation reste.
    expect(await membreSur('emploi', comptes.formateur)).toMatchObject({ droit: 'consulter', statut: 'accepte' });
    expect(await membreSur('absences', comptes.formateur)).toBeUndefined();
    expect(await membreSur('chronogramme', comptes.formateur)).toMatchObject({ droit: 'modifier', statut: 'en_attente' });

    const nouveau = await invitationDe(comptes.formateur);
    expect(nouveau.invitation.pages).toEqual(['chronogramme']);

    // La réponse est la vue à jour : rien à relire.
    const chrono = reponse.body.pages.find((p) => p.page === 'chronogramme');
    expect(chrono.invitation).toEqual({ droit: 'modifier', statut: 'en_attente' });

    // L'accès retiré se ferme aussitôt : Absences n'est plus dans son menu.
    const moi = await en('formateur').get('/api/v2/partages/moi');
    expect(moi.body.pages.map((p) => p.page)).toEqual(['emploi']);
  });

  it('garde les boutons d’une invitation tant qu’UNE de ses pages attend encore', async () => {
    await en('directeur').post('/api/v2/partages/emploi/membres', {
      utilisateurIds: [comptes.formateur.id],
      droits: { emploi: 'modifier', absences: 'consulter' },
    });

    await regler(comptes.formateur, { absences: null });
    expect((await invitationDe(comptes.formateur))?.invitation.pages).toEqual(['emploi', 'absences']);

    await regler(comptes.formateur, { emploi: null });
    expect(await invitationDe(comptes.formateur)).toBeNull();
    const message = await Message.findOne({ destinataireId: comptes.formateur.id });
    expect(message.invitation.statut).toBe('retiree');
  });

  it('ne règle que les comptes invitables de l’établissement, et au directeur seul', async () => {
    expect((await regler(comptes.etranger, { emploi: 'consulter' })).status).toBe(404);
    expect((await regler(comptes.stagiaire, { emploi: 'consulter' })).status).toBe(404);
    expect((await pagesDe(comptes.etranger)).status).toBe(404);

    const parFormateur = await en('formateur').put(`/api/v2/partages/membres/${comptes.autreFormateur.id}`, {
      droits: { emploi: 'modifier' },
    });
    expect(parFormateur.status).toBe(403);
    expect(await Partage.countDocuments()).toBe(0);
  });

  it('refuse un réglage vide', async () => {
    expect((await regler(comptes.formateur, {})).status).toBe(400);
  });
});

describe('l’administrateur collabore, invité par défaut (2026-09-14)', () => {
  /*
   * « Collaborer » : l'admin travaille AVEC l'établissement d'un compte, en son
   * nom, avec le droit d'un invité « peut modifier » sur les pages qui se
   * partagent — sans figurer dans la liste des invités.
   */
  let admin;

  beforeEach(async () => {
    admin = await creer(ROLES.ADMIN, 'admin@edtpro.ma', []);
    cookies.admin = await seConnecter(admin.email);
  });

  async function collaborer(cible = comptes.directeur) {
    const reponse = await request(app)
      .post(`/api/v2/admin/utilisateurs/${cible.id}/collaboration`)
      .set('Cookie', cookies.admin)
      .send({});
    if (reponse.status === 200) cookies.collab = reponse.headers['set-cookie'];
    return reponse;
  }

  it('ouvre les trois pages collaboratives, sans le montrer dans la liste des invités', async () => {
    const reponse = await collaborer();
    expect(reponse.status).toBe(200);
    expect(reponse.body.etablissement).toMatchObject({ id: etablissement.id, nom: 'ISTA Test' });

    const moi = await en('collab').get('/api/v2/partages/moi');
    expect(moi.body.pages).toEqual(
      ['emploi', 'chronogramme', 'affectations'].map((page) => ({ page, droit: 'modifier', source: 'admin', partagee: true }))
    );
    const session = await en('collab').get('/api/v2/auth/moi');
    expect(session.body.collaboration).toEqual({ etablissementId: etablissement.id, nom: 'ISTA Test' });

    // « N'affiche pas en liste » : ni membre, ni candidat, dans la boîte du directeur.
    const boite = await en('directeur').get('/api/v2/partages/emploi');
    expect([...boite.body.partage.membres, ...boite.body.partage.candidats].map((c) => c.id)).not.toContain(admin.id);
    expect(await AuditLog.countDocuments({ action: ACTIONS_AUDIT.COLLABORATION_DEBUT })).toBe(1);
  });

  it('écrit dans l’emploi du temps, jamais ce qui reste au directeur', async () => {
    await collaborer();
    expect((await en('collab').put(`/api/v2/seances/${SEMAINE}/case`, seance)).status).toBe(200);
    expect((await en('collab').put('/api/v2/seances/publication', { semaine: SEMAINE })).status).toBe(403);
    expect(
      (await en('collab').post('/api/v2/partages/emploi/membres', { utilisateurIds: [comptes.formateur.id] })).status
    ).toBe(403);
    // Une page qui ne se partage pas lui reste fermée.
    expect((await en('collab').get('/api/v2/absences')).status).toBe(403);
  });

  // ⚠️ La règle d'isolation ne s'assouplit pas : SON établissement, et lui seul.
  it('reste dans l’établissement de la collaboration', async () => {
    const ailleurs = await Etablissement.create({
      proprietaireId: comptes.directeur.id,
      region: 'Fès-Meknès',
      complexe: 'CF Bâtiment',
      nom: 'ISTA Ailleurs',
      anneeScolaire: ANNEE,
    });
    await collaborer();
    const reponse = await en('collab').get(`/api/v2/seances/${SEMAINE}`).set('X-Etablissement-Id', ailleurs.id);
    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('ETABLISSEMENT_INTERDIT');
  });

  it('survit au rafraîchissement, puis se referme', async () => {
    await collaborer();
    const rafraichi = await request(app).post('/api/v2/auth/rafraichir').set('Cookie', cookies.collab);
    expect(rafraichi.status).toBe(200);
    cookies.collab = rafraichi.headers['set-cookie'];
    expect((await en('collab').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(200);
    // L'administration lui reste ouverte pendant la collaboration.
    expect((await en('collab').get('/api/v2/admin/statistiques')).status).toBe(200);

    const quitte = await request(app).post('/api/v2/auth/quitter-collaboration').set('Cookie', cookies.collab);
    expect(quitte.status).toBe(200);
    cookies.collab = quitte.headers['set-cookie'];
    expect((await en('collab').get('/api/v2/auth/moi')).body.collaboration).toBeNull();
    expect((await en('collab').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(403);
    expect(await AuditLog.countDocuments({ action: ACTIONS_AUDIT.COLLABORATION_FIN })).toBe(1);
  });

  it('ne donne rien à un administrateur hors collaboration', async () => {
    expect((await en('admin').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(403);
    expect((await request(app).post('/api/v2/auth/quitter-collaboration').set('Cookie', cookies.admin)).status).toBe(400);
  });

  it('refuse de collaborer avec un administrateur, ou un compte sans établissement', async () => {
    const autreAdmin = await creer(ROLES.ADMIN, 'admin2@edtpro.ma', []);
    expect((await collaborer(autreAdmin)).status).toBe(400);
    const orphelin = await creer(ROLES.FORMATEUR, 'orphelin@edtpro.ma', []);
    expect((await collaborer(orphelin)).body.code).toBe('ETABLISSEMENT_ABSENT');
    // Réservé à l'administrateur.
    const parDirecteur = await request(app)
      .post(`/api/v2/admin/utilisateurs/${comptes.formateur.id}/collaboration`)
      .set('Cookie', cookies.directeur);
    expect(parDirecteur.status).toBe(403);
  });
});

describe('pages qui ne se partagent pas (2026-09-14)', () => {
  /*
   * Décision du porteur : seules Emploi, Chronogramme et Affectations se
   * partagent. Les autres refusent l'invitation et l'accès général AU SERVEUR —
   * un appel direct pourrait les nommer —, et un partage resté en base n'y ouvre
   * plus rien.
   */
  it('ne propose au menu que les trois pages collaboratives', () => {
    expect(pagesPretes()).toEqual(['emploi', 'chronogramme', 'affectations']);
  });

  // ⚠️ Au serveur : un appel direct ne doit pas ouvrir une page qui ne se partage pas.
  it('refuse une invitation qui nomme une page qui ne se partage pas', async () => {
    const reponse = await en('directeur').post('/api/v2/partages/emploi/membres', {
      utilisateurIds: [comptes.formateur.id],
      droit: 'modifier',
      pages: ['documents'],
    });
    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('PAGE_NON_PRETE');
    expect(await Partage.countDocuments()).toBe(0);

    const parDroits = await en('directeur').post('/api/v2/partages/emploi/membres', {
      utilisateurIds: [comptes.formateur.id],
      droits: { emploi: 'modifier', absences: 'consulter' },
    });
    expect(parDroits.status).toBe(400);
    expect(await Partage.countDocuments()).toBe(0);
  });

  it('refuse l’accès général sur une page qui ne se partage pas', async () => {
    const reponse = await en('directeur').patch('/api/v2/partages/sessions/general', {
      portee: 'etablissement',
      droit: 'modifier',
    });
    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('PAGE_NON_PRETE');
  });

  /*
   * ⚠️ LES INVITATIONS ACCEPTÉES AVANT LA DÉCISION RESTENT EN BASE — les
   * supprimer serait irréversible — MAIS N'OUVRENT PLUS RIEN : ni la route, ni
   * le menu. Sans cela, l'invité continuerait d'ouvrir la page par un lien.
   */
  it('n’ouvre plus rien par une invitation restée sur une page qui ne se partage plus', async () => {
    await Partage.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      page: 'absences',
      membres: [
        { utilisateurId: comptes.formateur.id, droit: 'modifier', statut: 'accepte', invitePar: comptes.directeur.id },
      ],
    });
    await Partage.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      page: 'stages',
      general: { portee: 'etablissement', droit: 'modifier' },
    });

    expect((await en('formateur').get('/api/v2/absences')).status).toBe(403);
    expect((await en('formateur').get('/api/v2/modifications/stages')).status).toBe(403);
    const moi = await en('formateur').get('/api/v2/partages/moi');
    expect(moi.body.pages).toEqual([]);

    // « Gérer ses pages » ne les liste plus, et la boîte ne les compte pas.
    const pages = await en('directeur').get(`/api/v2/partages/membres/${comptes.formateur.id}`);
    expect(pages.body.pages.map((p) => p.page)).toEqual(['emploi', 'chronogramme', 'affectations']);
    expect(pages.body.pages.every((p) => p.invitation === null)).toBe(true);
  });

  it('garde au gestionnaire ce que son rôle lui donne', async () => {
    expect((await en('gestionnaire').get('/api/v2/stagiaires/statistiques')).status).toBe(200);
  });
});

describe('pages de l’étape d2 — Absences, Chronogramme, Avancement, EFM', () => {
  ouvrirLeTempsDuBloc(['absences', 'avancement', 'efm']);
  /** Invite sur UNE page (la page de la route), puis accepte avec la session de l'invité. */
  async function inviterSurPage(utilisateur, page, droit = 'modifier') {
    const reponse = await en('directeur').post(`/api/v2/partages/${page}/membres`, {
      utilisateurIds: [utilisateur.id],
      droit,
    });
    expect(reponse.status).toBe(200);
    await repondre(utilisateur, 'accepter');
  }

  const efm = {
    groupe: 'GM101',
    module: 'M101',
    salle: 'A12',
    jour: 'Mardi',
    creneaux: ['S3'],
    surveillants: ['9863'],
  };

  // ⚠️ Le rôle ne suffit plus : sans invitation, rien — gestionnaire compris.
  it('refuse les quatre pages à qui n’est pas invité, gestionnaire compris', async () => {
    for (const qui of ['formateur', 'gestionnaire']) {
      expect((await en(qui).get('/api/v2/absences')).status).toBe(403);
      expect((await en(qui).get('/api/v2/chronogrammes')).status).toBe(403);
      expect((await en(qui).get('/api/v2/avancement')).status).toBe(403);
      expect((await en(qui).post(`/api/v2/seances/${SEMAINE}/efm`, efm)).status).toBe(403);
    }
    // Et le directeur, propriétaire, les lit toutes.
    expect((await en('directeur').get('/api/v2/absences')).status).toBe(200);
    expect((await en('directeur').get('/api/v2/avancement')).status).toBe(200);
  });

  it('Absences : « peut consulter » lit le registre, ne le modifie pas', async () => {
    await inviterSurPage(comptes.formateur, 'absences', 'consulter');
    expect((await en('formateur').get('/api/v2/absences')).status).toBe(200);

    const refus = await en('formateur').patch('/api/v2/absences/0123456789abcdef01234567', { observation: 'Malade' });
    expect(refus.status).toBe(403);
    expect(refus.body.code).toBe('DROIT_INSUFFISANT');
  });

  it('Absences : « peut modifier » passe la garde (l’absence inconnue répond 404, pas 403)', async () => {
    await inviterSurPage(comptes.formateur, 'absences', 'modifier');
    const reponse = await en('formateur').patch('/api/v2/absences/0123456789abcdef01234567', { observation: 'Malade' });
    expect(reponse.status).toBe(404);
  });

  it('Chronogramme : l’invité enregistre, mais l’import de classeur reste au directeur', async () => {
    await inviterSurPage(comptes.formateur, 'chronogramme', 'modifier');
    expect((await en('formateur').get('/api/v2/chronogrammes')).status).toBe(200);
    expect((await en('formateur').put('/api/v2/chronogrammes/GM101', { planning: {} })).status).toBe(200);

    const importer = await request(app)
      .post('/api/v2/chronogrammes/import')
      .set('Cookie', cookies.formateur)
      .set('X-Annee-Scolaire', String(ANNEE))
      .attach('fichier', Buffer.from('x'), 'c.xlsx');
    expect(importer.status).toBe(403);
  });

  it('Chronogramme : « peut consulter » lit, ne réécrit pas le planning', async () => {
    await inviterSurPage(comptes.formateur, 'chronogramme', 'consulter');
    expect((await en('formateur').get('/api/v2/chronogrammes/GM101')).status).toBe(200);
    expect((await en('formateur').put('/api/v2/chronogrammes/GM101', { planning: {} })).status).toBe(403);
  });

  // ⚠️ Avancement est en lecture seule : l'invitation « modifier » y vaut « consulter ».
  it('Avancement : l’invité lit les trois routes', async () => {
    await inviterSurPage(comptes.gestionnaire, 'avancement', 'modifier');
    expect((await Partage.findOne({ page: 'avancement' }).lean()).membres[0].droit).toBe('consulter');
    for (const url of ['/api/v2/avancement', '/api/v2/avancement/chronologie', '/api/v2/avancement/achevement']) {
      expect((await en('gestionnaire').get(url)).status).toBe(200);
    }
  });

  it('EFM : l’invité lit l’occupation de la semaine sans être invité à l’emploi du temps', async () => {
    await inviterSurPage(comptes.formateur, 'efm', 'consulter');
    expect((await en('formateur').get('/api/v2/seances/contexte')).status).toBe(200);
    expect((await en('formateur').get(`/api/v2/seances/${SEMAINE}`)).status).toBe(200);
    expect((await en('formateur').get('/api/v2/seances/modules-regionaux?groupe=GM101')).status).toBe(200);
    // Mais la saisie de l'emploi du temps lui reste fermée.
    expect((await en('formateur').put(`/api/v2/seances/${SEMAINE}/case`, seance)).status).toBe(403);
    // Et « consulter » ne planifie pas l'examen.
    expect((await en('formateur').post(`/api/v2/seances/${SEMAINE}/efm`, efm)).status).toBe(403);
  });

  it('EFM : « peut modifier » planifie ; un invité de l’emploi du temps seul, non', async () => {
    await inviterSurPage(comptes.formateur, 'efm', 'modifier');
    const planifie = await en('formateur').post(`/api/v2/seances/${SEMAINE}/efm`, efm);
    // La garde est passée : ce qui suit relève des contrôles métier (conflits, titulaire…).
    expect(planifie.status).not.toBe(403);

    await inviter(comptes.autreFormateur, 'modifier');
    expect((await en('autreFormateur').post(`/api/v2/seances/${SEMAINE}/efm`, efm)).status).toBe(403);
  });
});

describe('pages de l’étape d3 — pages « tout ou rien » et version optimiste', () => {
  ouvrirLeTempsDuBloc(['espaces', 'calendrier', 'formateurs', 'stages', 'formations', 'groupesFq']);
  async function inviterSurPage(utilisateur, page, droit = 'modifier') {
    const reponse = await en('directeur').post(`/api/v2/partages/${page}/membres`, {
      utilisateurIds: [utilisateur.id],
      droit,
    });
    expect(reponse.status).toBe(200);
    await repondre(utilisateur, 'accepter');
  }

  const carte = {
    formateurs: [{ nom: 'BRAHIM LOURID', matricule: '9863' }],
    groupes: [
      {
        nom: 'GM101',
        codeFiliere: 'GM_TS',
        intituleFiliere: 'Génie Mécanique',
        anneeFormation: 1,
        niveau: 'TS',
        mode: 'Résidentiel',
        modules: [{ code: 'M101', nom: 'Dessin', mhpS1: 30, formateurPresentiel: 'BRAHIM LOURID' }],
      },
    ],
  };

  // ⚠️ Le rôle ne suffit plus : sans invitation, rien — gestionnaire compris.
  it('refuse les pages « tout ou rien » à qui n’est pas invité, gestionnaire compris', async () => {
    for (const qui of ['formateur', 'gestionnaire']) {
      expect((await en(qui).put('/api/v2/etablissements/courant/espaces', { espaces: ['X'] })).status).toBe(403);
      expect((await en(qui).put('/api/v2/etablissements/courant/stages', { stages: [] })).status).toBe(403);
      expect((await en(qui).put('/api/v2/etablissements/courant/formations', { formations: [] })).status).toBe(403);
      expect((await en(qui).put('/api/v2/etablissements/courant/groupes-fq', { groupesFq: [] })).status).toBe(403);
      expect((await en(qui).put('/api/v2/calendrier', { vacances: [] })).status).toBe(403);
      expect((await en(qui).get('/api/v2/base')).status).toBe(403);
      expect((await en(qui).post('/api/v2/base/carte', carte)).status).toBe(403);
    }
    expect((await Etablissement.findById(etablissement.id)).espaces).toEqual(['A12']);
  });

  it('Espaces : l’invité écrit avec la version lue, et elle avance', async () => {
    await inviterSurPage(comptes.formateur, 'espaces');
    const lu = await en('formateur').get('/api/v2/etablissements/courant');
    expect(lu.body.etablissement.versions.espaces).toBe(0);

    const ecrit = await en('formateur').put('/api/v2/etablissements/courant/espaces', {
      espaces: ['A12', 'B7'],
      version: 0,
    });
    expect(ecrit.status).toBe(200);
    expect(ecrit.body).toMatchObject({ espaces: ['A12', 'B7'], version: 1 });
  });

  /*
   * ═══ LE CŒUR DE L'ÉTAPE ═══ Deux personnes lisent la même liste ; la première
   * enregistre, la seconde renvoie une version dépassée — refusée, et RIEN n'est
   * écrit : son envoi aurait effacé le travail de la première.
   */
  it('refuse en 409 une liste modifiée entre-temps, sans rien écrire', async () => {
    await inviterSurPage(comptes.formateur, 'stages');
    const stage = { groupe: 'GM101', debut: '2026-10-05', fin: '2026-10-30' };

    const premier = await en('directeur').put('/api/v2/etablissements/courant/stages', { stages: [stage], version: 0 });
    expect(premier.status).toBe(200);

    const refus = await en('formateur').put('/api/v2/etablissements/courant/stages', { stages: [], version: 0 });
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('VERSION_PERIMEE');

    const apres = await Etablissement.findById(etablissement.id);
    expect(apres.stages.map((s) => s.groupe)).toEqual(['GM101']);
    expect(apres.versions.stages).toBe(1);
  });

  // ⚠️ Un compteur par liste : enregistrer les stages ne périme pas les espaces.
  it('ne périme pas une liste voisine', async () => {
    await en('directeur').put('/api/v2/etablissements/courant/stages', { stages: [], version: 0 });
    const espaces = await en('directeur').put('/api/v2/etablissements/courant/espaces', { espaces: ['A12'], version: 0 });
    expect(espaces.status).toBe(200);
  });

  // L'assistant de configuration écrit sans version : l'écriture passe, la version avance quand même.
  it('écrit sans condition quand la version est absente', async () => {
    await en('directeur').put('/api/v2/etablissements/courant/formations', { formations: [] });
    const reponse = await en('directeur').put('/api/v2/etablissements/courant/formations', { formations: [] });
    expect(reponse.status).toBe(200);
    expect(reponse.body.version).toBe(2);
  });

  // ⚠️ Un établissement écrit AVANT la règle n'a pas de compteur : la version 0 doit passer.
  it('accepte la version 0 sur un document sans compteur', async () => {
    await Etablissement.collection.updateOne({ _id: etablissement._id }, { $unset: { versions: '' } });
    const reponse = await en('directeur').put('/api/v2/etablissements/courant/groupes-fq', { groupesFq: [], version: 0 });
    expect(reponse.status).toBe(200);
    expect(reponse.body.version).toBe(1);
  });

  it('« peut consulter » lit la liste, ne la réécrit pas', async () => {
    await inviterSurPage(comptes.formateur, 'formations', 'consulter');
    const refus = await en('formateur').put('/api/v2/etablissements/courant/formations', { formations: [], version: 0 });
    expect(refus.status).toBe(403);
    expect(refus.body.code).toBe('DROIT_INSUFFISANT');
  });

  it('Calendrier : version lue, 409 si dépassée, et les périodes écartées survivent', async () => {
    await inviterSurPage(comptes.formateur, 'calendrier');
    await Etablissement.updateOne({ _id: etablissement.id }, { $set: { 'calendrier.vacancesEcartees': ['Toussaint'] } });

    const lu = await en('formateur').get('/api/v2/calendrier');
    expect(lu.body.version).toBe(0);

    const vacances = [{ intitule: 'Hiver', debut: '2026-12-07', fin: '2026-12-13' }];
    const ecrit = await en('formateur').put('/api/v2/calendrier', { vacances, version: 0 });
    expect(ecrit.status).toBe(200);
    expect(ecrit.body.version).toBe(1);
    // `vacancesEcartees` non envoyé : conservé, pas effacé.
    expect(ecrit.body.ecartees).toEqual(['Toussaint']);

    const refus = await en('directeur').put('/api/v2/calendrier', { vacances: [], version: 0 });
    expect(refus.status).toBe(409);
    expect((await Etablissement.findById(etablissement.id)).calendrier.vacances).toHaveLength(1);
  });

  it('Affectations : la carte refuse une base remplacée entre-temps', async () => {
    await inviterSurPage(comptes.formateur, 'affectations');
    expect((await en('formateur').get('/api/v2/base')).body.base.version).toBe(0);

    const premiere = await en('directeur').post('/api/v2/base/carte', { ...carte, version: 0 });
    expect(premiere.status).toBe(201);
    expect(premiere.body.version).toBe(1);

    const autre = { ...carte, groupes: [{ ...carte.groupes[0], nom: 'GM102' }], version: 0 };
    const refus = await en('formateur').post('/api/v2/base/carte', autre);
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('VERSION_PERIMEE');

    // La transaction a été annulée : la base du directeur est intacte.
    const base = await Base.findOne({ etablissementId: etablissement.id, anneeScolaire: ANNEE });
    expect(base.groupes).toEqual(['GM101']);
    expect(base.version).toBe(1);

    // Avec la bonne version, l'invité enregistre.
    const juste = await en('formateur').post('/api/v2/base/carte', { ...carte, version: 1 });
    expect(juste.status).toBe(201);
    expect(juste.body.version).toBe(2);
  });

  // ⚠️ Une correction de formateur périme une carte ouverte avant : sinon elle l'écraserait.
  it('Formateurs : une correction avance la version de la base', async () => {
    await inviterSurPage(comptes.formateur, 'formateurs');
    const reponse = await en('formateur').patch('/api/v2/base/formateurs', {
      formateurs: [{ nomComplet: 'BRAHIM LOURID', email: 'brahim@ofppt.ma' }],
    });
    expect(reponse.status).toBe(200);
    expect((await Base.findOne({ etablissementId: etablissement.id })).version).toBe(1);

    expect((await en('directeur').post('/api/v2/base/carte', { ...carte, version: 0 })).status).toBe(409);
  });

  it('la base se lit depuis Stages, et son import reste au directeur', async () => {
    await inviterSurPage(comptes.formateur, 'stages', 'consulter');
    expect((await en('formateur').get('/api/v2/base')).status).toBe(200);

    await inviterSurPage(comptes.autreFormateur, 'affectations');
    const importer = await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies.autreFormateur)
      .set('X-Annee-Scolaire', String(ANNEE))
      .attach('fichier', Buffer.from('x'), 'b.xlsx');
    expect(importer.status).toBe(403);
  });

  it('Chronogramme : refuse en 409 le planning d’un groupe enregistré entre-temps', async () => {
    await inviterSurPage(comptes.formateur, 'chronogramme');
    expect((await en('formateur').get('/api/v2/chronogrammes/GM101')).body.version).toBe(0);

    const planning = { M101: { 3: { heures: 5, type: 'P' } } };
    const premier = await en('directeur').put('/api/v2/chronogrammes/GM101', { planning, version: 0 });
    expect(premier.status).toBe(200);
    expect(premier.body.version).toBe(1);

    const refus = await en('formateur').put('/api/v2/chronogrammes/GM101', { planning: {}, version: 0 });
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('VERSION_PERIMEE');
    expect((await en('formateur').get('/api/v2/chronogrammes/GM101')).body.planning).toEqual(planning);
  });
});

describe('pages de l’étape d4 — Sessions et Documents, en lecture', () => {
  ouvrirLeTempsDuBloc(['sessions', 'documents']);
  async function inviterSurPage(utilisateur, page, droit = 'consulter') {
    const reponse = await en('directeur').post(`/api/v2/partages/${page}/membres`, {
      utilisateurIds: [utilisateur.id],
      droit,
    });
    expect(reponse.status).toBe(200);
    await repondre(utilisateur, 'accepter');
  }

  it('ferme les deux pages au formateur non invité', async () => {
    expect((await en('formateur').get('/api/v2/comptes?role=formateur')).status).toBe(403);
    expect((await en('formateur').get('/api/v2/comptes/candidats?role=formateur')).status).toBe(403);
    expect((await en('formateur').get('/api/v2/stagiaires/statistiques')).status).toBe(403);
  });

  // ⚠️ Le plafond du registre : « peut modifier » sur Sessions vaut « peut consulter ».
  it('Sessions : l’invité lit les comptes, même invité « à modifier »', async () => {
    await inviterSurPage(comptes.formateur, 'sessions', 'modifier');
    expect((await Partage.findOne({ page: 'sessions' }).lean()).membres[0].droit).toBe('consulter');

    const liste = await en('formateur').get('/api/v2/comptes?role=formateur');
    expect(liste.status).toBe(200);
    expect(liste.body.comptes.map((c) => c.email)).toContain('autre@edtpro.ma');
    // Aucun mot de passe, ni rien qui en tienne lieu, dans la liste.
    expect(JSON.stringify(liste.body)).not.toMatch(/motDePasse/);

    expect((await en('formateur').get('/api/v2/comptes/candidats?role=formateur')).status).toBe(200);
  });

  /*
   * ═══ LE CŒUR DE L'ÉTAPE ═══ Aucune écriture pour un invité : réinitialiser le
   * mot de passe d'un collègue, c'est prendre son compte.
   */
  it('Sessions : refuse à l’invité toute écriture sur les comptes', async () => {
    await inviterSurPage(comptes.formateur, 'sessions');
    const cible = comptes.autreFormateur.id;

    expect((await en('formateur').post(`/api/v2/comptes/${cible}/mot-de-passe`)).status).toBe(403);
    expect((await en('formateur').patch(`/api/v2/comptes/${cible}/activation`, { actif: false })).status).toBe(403);
    expect((await en('formateur').delete(`/api/v2/comptes/${cible}`)).status).toBe(403);
    expect((await en('formateur').post('/api/v2/comptes/lot', { role: 'formateur', matricules: ['1'], motDePasse: 'MotDePasse2026' })).status).toBe(403);

    const intact = await User.findById(cible);
    expect(intact.estActif).toBe(true);
  });

  it('Sessions : le gestionnaire n’y a rien par son rôle', async () => {
    expect((await en('gestionnaire').get('/api/v2/comptes?role=formateur')).status).toBe(403);
  });

  it('Documents : le gestionnaire lit par son rôle, le formateur s’il est invité', async () => {
    expect((await en('gestionnaire').get('/api/v2/stagiaires/statistiques')).status).toBe(200);

    await inviterSurPage(comptes.formateur, 'documents', 'modifier');
    // Plafonné : Documents est en lecture seule, l'import restant au directeur.
    expect((await Partage.findOne({ page: 'documents' }).lean()).membres[0].droit).toBe('consulter');
    for (const url of ['/api/v2/stagiaires', '/api/v2/stagiaires/statistiques', '/api/v2/stagiaires/filtres']) {
      expect((await en('formateur').get(url)).status).toBe(200);
    }
  });

  it('Documents : l’import Konosys reste au directeur', async () => {
    await inviterSurPage(comptes.formateur, 'documents');
    for (const qui of ['formateur', 'gestionnaire']) {
      const reponse = await request(app)
        .post('/api/v2/stagiaires/import')
        .set('Cookie', cookies[qui])
        .set('X-Annee-Scolaire', String(ANNEE))
        .attach('fichier', Buffer.from('x'), 'k.xlsx');
      expect(reponse.status).toBe(403);
    }
  });
});

describe('date de modification d’une page (2026-09-13)', () => {
  // L'annonce note la date sans bloquer la réponse : on laisse l'écriture se poser.
  const laisserNoter = () => new Promise((resolve) => setTimeout(resolve, 150));

  it('rend null tant que rien n’a été écrit sur la page', async () => {
    const reponse = await en('directeur').get('/api/v2/modifications/stages');
    expect(reponse.status).toBe(200);
    expect(reponse.body.modification).toBeNull();
  });

  it('note la dernière écriture — quand, et par qui', async () => {
    const avant = Date.now();
    await en('directeur').put('/api/v2/etablissements/courant/stages', { stages: [], version: 0 });
    await laisserNoter();

    const { modification } = (await en('directeur').get('/api/v2/modifications/stages')).body;
    expect(Date.parse(modification.modifieLe)).toBeGreaterThanOrEqual(avant - 1000);
    expect(modification.auteur).toMatchObject({ id: comptes.directeur.id });
  });

  // Une écriture date aussi les pages qu'elle fait changer : un stage verrouille le chronogramme.
  it('date aussi les pages qui lisent la donnée écrite', async () => {
    await en('directeur').put('/api/v2/etablissements/courant/stages', { stages: [], version: 0 });
    await laisserNoter();
    expect((await en('directeur').get('/api/v2/modifications/chronogramme')).body.modification).not.toBeNull();
    expect((await en('directeur').get('/api/v2/modifications/espaces')).body.modification).toBeNull();
  });

  // ⚠️ La date d'une page n'est pas à montrer à qui ne la voit pas.
  it('ne se lit qu’avec le droit de consulter la page', async () => {
    expect((await en('formateur').get('/api/v2/modifications/stages')).status).toBe(403);
    // Le gestionnaire consulte Documents par son rôle : il en lit la date.
    expect((await en('gestionnaire').get('/api/v2/modifications/documents')).status).toBe(200);
    expect((await en('directeur').get('/api/v2/modifications/inconnue')).status).toBe(400);
  });

  // Sans écriture depuis le suivi, la date se lit dans les données — sans auteur, qu'on ne connaît pas.
  it('se replie sur la date des données quand elle est fiable', async () => {
    const { modification } = (await en('directeur').get('/api/v2/modifications/affectations')).body;
    expect(modification).not.toBeNull();
    expect(modification.auteur).toBeNull();
    // Les listes de l'établissement partagent un document : pas de repli, on ne l'inventerait pas.
    expect((await en('directeur').get('/api/v2/modifications/calendrier')).body.modification).toBeNull();
  });

  // Une page non annuelle garde sa date quand on bascule d'année.
  it('garde la date d’une page de l’établissement d’une année à l’autre', async () => {
    await en('directeur').put('/api/v2/etablissements/courant/espaces', { espaces: ['A12'], version: 0 });
    await laisserNoter();
    const autreAnnee = await request(app)
      .get('/api/v2/modifications/espaces')
      .set('Cookie', cookies.directeur)
      .set('X-Annee-Scolaire', String(ANNEE - 1));
    expect(autreAnnee.body.modification).not.toBeNull();
  });
});
