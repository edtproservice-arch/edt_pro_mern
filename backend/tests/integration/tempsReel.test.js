import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import { createApp } from '../../src/app.js';
import { attacherTempsReel, CHEMIN_TEMPS_REEL, lireCookie } from '../../src/modules/tempsReel/serveur.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { Message } from '../../src/models/Message.js';
import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';
import { FERMETURES_TEMPS_REEL } from 'shared/schemas';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Collaboration temps réel (Phase 5bis, étape a).
 *
 * ⚠️ SUPERTEST NE FAIT PAS DE WEBSOCKET : chaque test démarre un VRAI serveur
 * HTTP sur un port libre, y branche le serveur temps réel, et s'y connecte avec
 * le client `ws` — exactement le chemin du navigateur, poignée de main comprise.
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;
const ORIGINE = 'http://localhost:5173';

let serveur;
let tempsReel;
let url;
let etablissement;
let autreEtablissement;
const sockets = [];

async function creerCompte(role, email, etablissementId) {
  return User.create({
    nomComplet: `${role.toUpperCase()} TEST`,
    email,
    motDePasse: MOT_DE_PASSE,
    role,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
    etablissementIds: etablissementId ? [etablissementId] : [],
  });
}

async function seConnecter(email) {
  const reponse = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: email, motDePasse: MOT_DE_PASSE });
  expect(reponse.status).toBe(200);
  return reponse.headers['set-cookie'];
}

/** « a=1; Path=/; HttpOnly » × n → « a=1; b=2 », la forme d'un en-tête Cookie. */
const enTeteCookie = (cookies) => cookies.map((c) => c.split(';')[0]).join('; ');

/**
 * Ouvre une socket et range ses messages dans une file, pour qu'aucun ne soit
 * perdu entre deux `attendre` — le serveur envoie `bienvenue` dès l'ouverture.
 */
function ouvrir({ cookies, origine = ORIGINE, chemin = CHEMIN_TEMPS_REEL } = {}) {
  const ws = new WebSocket(`${url}${chemin}`, {
    headers: { origin: origine, ...(cookies ? { cookie: enTeteCookie(cookies) } : {}) },
  });
  sockets.push(ws);

  const recus = [];
  const attentes = [];
  ws.on('message', (donnees) => {
    const message = JSON.parse(donnees.toString('utf8'));
    recus.push(message);
    for (const attente of [...attentes]) {
      if (attente.filtre(message)) {
        attentes.splice(attentes.indexOf(attente), 1);
        attente.resoudre(message);
      }
    }
  });

  const fermeture = new Promise((resoudre) => {
    ws.on('close', (code, raison) => resoudre({ code, raison: raison.toString() }));
  });

  /** Le premier message reçu (ou à venir) qui passe le filtre. */
  function attendre(filtre, delai = 3000) {
    const deja = recus.find(filtre);
    if (deja) {
      recus.splice(recus.indexOf(deja), 1);
      return Promise.resolve(deja);
    }
    return new Promise((resoudre, rejeter) => {
      const attente = { filtre, resoudre };
      attentes.push(attente);
      setTimeout(() => {
        attentes.splice(attentes.indexOf(attente), 1);
        rejeter(new Error('Message attendu non reçu'));
      }, delai);
    });
  }

  const envoyer = (message) => ws.send(JSON.stringify(message));

  return { ws, recus, attendre, envoyer, fermeture };
}

const type = (t) => (m) => m.type === t;

/** Ouvre, attend la bienvenue, rejoint la salle `emploi` et attend d'y être. */
async function rejoindre(cookies, message = {}) {
  const client = ouvrir({ cookies });
  const bienvenue = await client.attendre(type('bienvenue'));
  client.envoyer({ type: 'rejoindre', page: 'emploi', anneeScolaire: ANNEE, ...message });
  await client.attendre(type('rejoint'));
  return { ...client, connexionId: bienvenue.connexionId };
}

/** Attend que PLUS AUCUN message de ce type n'arrive pendant le délai. */
async function rienNeVient(client, filtre, delai = 300) {
  await new Promise((r) => setTimeout(r, delai));
  expect(client.recus.filter(filtre)).toEqual([]);
}

beforeEach(async () => {
  const directeur = await creerCompte(ROLES.DIRECTEUR, 'directeur@edtpro.ma');

  etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Test',
    anneeScolaire: ANNEE,
    espaces: ['A12', 'B02'],
  });
  autreEtablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Voisin',
    anneeScolaire: ANNEE,
  });

  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  await creerCompte(ROLES.GESTIONNAIRE, 'gestionnaire@edtpro.ma', etablissement.id);
  await creerCompte(ROLES.FORMATEUR, 'formateur@edtpro.ma', etablissement.id);

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [{ matricule: '9863', nomComplet: 'BRAHIM LOURID' }],
    groupes: ['GM101'],
    affectations: [
      { formateur: '9863', groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 },
    ],
  });

  serveur = http.createServer(app);
  tempsReel = attacherTempsReel(serveur);
  await new Promise((resoudre) => serveur.listen(0, '127.0.0.1', resoudre));
  url = `ws://127.0.0.1:${serveur.address().port}`;
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await tempsReel.fermer();
  await new Promise((resoudre) => serveur.close(resoudre));
});

describe('lireCookie', () => {
  it('lit un cookie parmi d’autres, et rend null s’il manque', () => {
    expect(lireCookie('a=1; edt_access=abc%3D; b=2', 'edt_access')).toBe('abc=');
    expect(lireCookie('a=1', 'edt_access')).toBeNull();
    expect(lireCookie(undefined, 'edt_access')).toBeNull();
  });
});

describe('poignée de main', () => {
  /*
   * ⚠️ LE CONTRÔLE D'ORIGINE est ce qui empêche un autre site d'ouvrir une
   * socket avec le cookie de la victime — la poignée de main WebSocket n'est pas
   * soumise à la politique de même origine.
   */
  it('refuse une origine étrangère en 403, avant toute authentification', async () => {
    const cookies = await seConnecter('directeur@edtpro.ma');
    const ws = new WebSocket(`${url}${CHEMIN_TEMPS_REEL}`, {
      headers: { origin: 'https://site-malveillant.example', cookie: enTeteCookie(cookies) },
    });
    sockets.push(ws);

    const statut = await new Promise((resoudre) => {
      ws.on('unexpected-response', (req, res) => resoudre(res.statusCode));
      ws.on('error', () => {});
    });
    expect(statut).toBe(403);
  });

  it('refuse un autre chemin en 404', async () => {
    const ws = new WebSocket(`${url}/api/v2/autre-chose`, { headers: { origin: ORIGINE } });
    sockets.push(ws);
    const statut = await new Promise((resoudre) => {
      ws.on('unexpected-response', (req, res) => resoudre(res.statusCode));
      ws.on('error', () => {});
    });
    expect(statut).toBe(404);
  });

  /*
   * ⚠️ UN CODE DE FERMETURE, PAS UN 401 : le navigateur ne voit pas le statut
   * d'une poignée de main refusée. Seul ce code lui dit de rafraîchir sa session.
   */
  it('ferme en 4001 une socket sans session, sans rien lui envoyer', async () => {
    const client = ouvrir();
    const { code, raison } = await client.fermeture;
    expect(code).toBe(FERMETURES_TEMPS_REEL.REAUTHENTIFIER);
    expect(raison).toBe('NON_AUTHENTIFIE');
    expect(client.recus).toEqual([]);
  });

  it('ferme en 4001 quand le jeton expire, socket ouverte', async () => {
    const directeur = await User.findOne({ email: 'directeur@edtpro.ma' });
    const jeton = jwt.sign(
      { sub: directeur.id, role: directeur.role },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: 1 }
    );

    const client = ouvrir({ cookies: [`edt_access=${jeton}`] });
    await client.attendre(type('bienvenue'));
    const { code, raison } = await client.fermeture;

    expect(code).toBe(FERMETURES_TEMPS_REEL.REAUTHENTIFIER);
    expect(raison).toBe('JETON_EXPIRE');
  });

  it('ferme en 4003 un compte désactivé — il ne doit pas se reconnecter', async () => {
    const cookies = await seConnecter('gestionnaire@edtpro.ma');
    await User.updateOne({ email: 'gestionnaire@edtpro.ma' }, { estActif: false });

    const client = ouvrir({ cookies });
    const { code } = await client.fermeture;
    expect(code).toBe(FERMETURES_TEMPS_REEL.COMPTE_REFUSE);
  });
});

describe('salle et présence', () => {
  it('rejoint la salle emploi, et se voit présent', async () => {
    const cookies = await seConnecter('directeur@edtpro.ma');
    const client = await rejoindre(cookies, { vue: { ecran: 'emploi', semaine: '2026-W3' } });

    const presence = await client.attendre(type('presence'));
    expect(presence.membres).toEqual([
      expect.objectContaining({
        nom: 'DIRECTEUR TEST',
        role: ROLES.DIRECTEUR,
        vue: { ecran: 'emploi', semaine: '2026-W3' },
        onglets: 1,
        usurpePar: null,
      }),
    ]);
  });

  it('annonce l’arrivée puis le départ d’un collègue', async () => {
    const directeur = await rejoindre(await seConnecter('directeur@edtpro.ma'));
    await directeur.attendre(type('presence'));

    const gestionnaire = await rejoindre(await seConnecter('gestionnaire@edtpro.ma'));
    const arrivee = await directeur.attendre((m) => m.type === 'presence' && m.membres.length === 2);
    expect(arrivee.membres.map((m) => m.role).sort()).toEqual([ROLES.DIRECTEUR, ROLES.GESTIONNAIRE].sort());

    gestionnaire.ws.close();
    const depart = await directeur.attendre((m) => m.type === 'presence' && m.membres.length === 1);
    expect(depart.membres[0].role).toBe(ROLES.DIRECTEUR);
  });

  /*
   * ═══ L'ADMINISTRATEUR EN COLLABORATION ENTRE DANS LA SALLE (2026-09-14) ═══
   * La socket passe par les mêmes `resoudreContexte` et `droitDe` que les routes :
   * l'établissement de la collaboration, porté par le jeton, doit lui ouvrir la
   * salle — et les collègues le voir « peut modifier », sous son nom.
   */
  it('fait entrer l’administrateur en collaboration, sous son nom', async () => {
    const admin = await creerCompte(ROLES.ADMIN, 'admin@edtpro.ma');
    const directeurCompte = await User.findOne({ email: 'directeur@edtpro.ma' });
    const collaboration = await request(app)
      .post(`/api/v2/admin/utilisateurs/${directeurCompte.id}/collaboration`)
      .set('Cookie', enTeteCookie(await seConnecter(admin.email)))
      .send({});
    expect(collaboration.status).toBe(200);

    const directeur = await rejoindre(await seConnecter('directeur@edtpro.ma'));
    await directeur.attendre(type('presence'));
    await rejoindre(collaboration.headers['set-cookie']);
    const arrivee = await directeur.attendre((m) => m.type === 'presence' && m.membres.length === 2);
    expect(arrivee.membres.find((m) => m.role === ROLES.ADMIN)).toMatchObject({
      id: admin.id,
      droit: 'modifier',
      usurpePar: null,
    });
  });

  // Hors collaboration, l'administrateur n'a pas d'établissement : la salle lui reste fermée.
  it('refuse la salle à un administrateur hors collaboration', async () => {
    const admin = await creerCompte(ROLES.ADMIN, 'admin@edtpro.ma');
    const client = ouvrir({ cookies: await seConnecter(admin.email) });
    await client.attendre(type('bienvenue'));
    client.envoyer({ type: 'rejoindre', page: 'emploi', anneeScolaire: ANNEE });
    const erreur = await client.attendre(type('erreur'));
    expect(erreur.code).toBe('ETABLISSEMENT_ABSENT');
  });

  /*
   * ⚠️ DEUX ONGLETS NE FONT PAS DEUX PRÉSENCES : on croirait à un collègue.
   */
  it('compte deux onglets de la même personne comme UNE présence', async () => {
    const cookies = await seConnecter('directeur@edtpro.ma');
    const premier = await rejoindre(cookies);
    await rejoindre(cookies);

    const presence = await premier.attendre((m) => m.type === 'presence' && m.membres[0]?.onglets === 2);
    expect(presence.membres).toHaveLength(1);
  });

  it('diffuse le changement de semaine aux autres', async () => {
    const directeur = await rejoindre(await seConnecter('directeur@edtpro.ma'));
    const gestionnaire = await rejoindre(await seConnecter('gestionnaire@edtpro.ma'));

    gestionnaire.envoyer({ type: 'vue', page: 'emploi', vue: { ecran: 'edition', semaine: '2026-W5' } });

    const presence = await directeur.attendre(
      (m) => m.type === 'presence' && m.membres.some((x) => x.vue?.semaine === '2026-W5')
    );
    expect(presence.membres.find((x) => x.role === ROLES.GESTIONNAIRE).vue).toEqual({
      ecran: 'edition',
      semaine: '2026-W5',
    });
  });

  /*
   * ⚠️ LA SALLE SUIT LE GARDE DES ROUTES : un formateur n'a pas accès à
   * `/seances`, il n'a pas davantage accès à ce qu'on y fait.
   */
  it('refuse la salle emploi à un formateur', async () => {
    const client = ouvrir({ cookies: await seConnecter('formateur@edtpro.ma') });
    await client.attendre(type('bienvenue'));
    client.envoyer({ type: 'rejoindre', page: 'emploi', anneeScolaire: ANNEE });

    const erreur = await client.attendre(type('erreur'));
    expect(erreur).toMatchObject({ page: 'emploi', code: 'ACCES_REFUSE' });
  });

  /*
   * ⚠️ ISOLATION MULTI-ÉTABLISSEMENT : l'établissement demandé passe par la même
   * résolution que `resolveTenant`.
   */
  it('refuse la salle d’un établissement qui n’est pas le sien', async () => {
    const client = ouvrir({ cookies: await seConnecter('directeur@edtpro.ma') });
    await client.attendre(type('bienvenue'));
    client.envoyer({
      type: 'rejoindre',
      page: 'emploi',
      anneeScolaire: ANNEE,
      etablissementId: autreEtablissement.id,
    });

    const erreur = await client.attendre(type('erreur'));
    expect(erreur.code).toBe('ETABLISSEMENT_INTERDIT');
  });

  it('refuse un message invalide SANS fermer la socket', async () => {
    const client = await rejoindre(await seConnecter('directeur@edtpro.ma'));
    client.ws.send('pas du json');
    client.envoyer({ type: 'rejoindre', page: 'chronogramme' });

    await client.attendre((m) => m.type === 'erreur' && m.code === 'MESSAGE_INVALIDE');
    await client.attendre((m) => m.type === 'erreur' && m.code === 'MESSAGE_INVALIDE');
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('isole deux années scolaires : même page, deux salles', async () => {
    const directeur = await rejoindre(await seConnecter('directeur@edtpro.ma'));
    await rejoindre(await seConnecter('gestionnaire@edtpro.ma'), { anneeScolaire: ANNEE + 1 });

    await rienNeVient(directeur, (m) => m.type === 'presence' && m.membres.length > 1);
  });
});

describe('diffusion des écritures', () => {
  const seance = {
    jour: 'Lundi',
    seance: 'S1',
    periode: 'jour',
    formateurMatricule: '9863',
    groupe: 'GM101',
    module: 'M101',
    salle: 'A12',
  };

  it('annonce une pose aux autres, jamais à l’onglet qui l’a faite', async () => {
    const cookiesDirecteur = await seConnecter('directeur@edtpro.ma');
    const directeur = await rejoindre(cookiesDirecteur);
    const gestionnaire = await rejoindre(await seConnecter('gestionnaire@edtpro.ma'));

    const pose = await request(app)
      .put('/api/v2/seances/2026-W3/case')
      .set('Cookie', cookiesDirecteur)
      .set('X-Annee-Scolaire', String(ANNEE))
      .set('X-Connexion-Id', directeur.connexionId)
      .send(seance);
    expect(pose.status).toBe(200);

    const annonce = await gestionnaire.attendre(type('modification'));
    expect(annonce).toMatchObject({
      page: 'emploi',
      action: 'poser',
      semaine: '2026-W3',
      auteur: { nom: 'DIRECTEUR TEST' },
    });
    // Ni l'établissement ni l'identifiant de connexion ne repartent au client.
    expect(annonce).not.toHaveProperty('origine');
    expect(annonce).not.toHaveProperty('etablissementId');

    await rienNeVient(directeur, type('modification'));
  });

  it('n’annonce RIEN d’une écriture refusée', async () => {
    const cookiesDirecteur = await seConnecter('directeur@edtpro.ma');
    const gestionnaire = await rejoindre(await seConnecter('gestionnaire@edtpro.ma'));

    const refus = await request(app)
      .put('/api/v2/seances/2026-W3/case')
      .set('Cookie', cookiesDirecteur)
      .set('X-Annee-Scolaire', String(ANNEE))
      .send({ ...seance, module: 'M999' });
    expect(refus.status).toBe(400);

    await rienNeVient(gestionnaire, type('modification'));
  });

  it('annonce le vidage d’une case, mais pas celui d’une case déjà vide', async () => {
    const cookiesDirecteur = await seConnecter('directeur@edtpro.ma');
    const gestionnaire = await rejoindre(await seConnecter('gestionnaire@edtpro.ma'));
    const creneau = { jour: 'Lundi', seance: 'S1', periode: 'jour', formateurMatricule: '9863' };

    await request(app)
      .delete('/api/v2/seances/2026-W3/case')
      .set('Cookie', cookiesDirecteur)
      .set('X-Annee-Scolaire', String(ANNEE))
      .send(creneau);
    await rienNeVient(gestionnaire, type('modification'));

    await request(app)
      .put('/api/v2/seances/2026-W3/case')
      .set('Cookie', cookiesDirecteur)
      .set('X-Annee-Scolaire', String(ANNEE))
      .send(seance);
    await gestionnaire.attendre((m) => m.type === 'modification' && m.action === 'poser');

    await request(app)
      .delete('/api/v2/seances/2026-W3/case')
      .set('Cookie', cookiesDirecteur)
      .set('X-Annee-Scolaire', String(ANNEE))
      .send(creneau);
    const vidage = await gestionnaire.attendre((m) => m.type === 'modification' && m.action === 'vider');
    expect(vidage.semaine).toBe('2026-W3');
  });

  it('n’annonce rien à un autre établissement', async () => {
    const voisin = await creerCompte(ROLES.DIRECTEUR, 'voisin@edtpro.ma', autreEtablissement.id);
    const client = await rejoindre(await seConnecter(voisin.email));
    const cookiesDirecteur = await seConnecter('directeur@edtpro.ma');

    await request(app)
      .put('/api/v2/seances/2026-W3/case')
      .set('Cookie', cookiesDirecteur)
      .set('X-Annee-Scolaire', String(ANNEE))
      .send(seance);

    await rienNeVient(client, type('modification'));
  });
});

describe('révocation', () => {
  /*
   * ⚠️ UNE RÉVOCATION FERME LA SOCKET SUR-LE-CHAMP, par le crochet posé sur
   * `RefreshToken.deleteMany` — le point commun des neuf chemins qui révoquent.
   */
  it('ferme les sockets d’un compte dont les sessions sont révoquées', async () => {
    const gestionnaire = await rejoindre(await seConnecter('gestionnaire@edtpro.ma'));
    const directeur = await rejoindre(await seConnecter('directeur@edtpro.ma'));
    const compte = await User.findOne({ email: 'gestionnaire@edtpro.ma' });

    await RefreshToken.deleteMany({ utilisateurId: compte._id });

    const { code, raison } = await gestionnaire.fermeture;
    expect(code).toBe(FERMETURES_TEMPS_REEL.REAUTHENTIFIER);
    expect(raison).toBe('SESSION_REVOQUEE');
    // Les autres restent — et voient partir le collègue.
    expect(directeur.ws.readyState).toBe(WebSocket.OPEN);
    await directeur.attendre((m) => m.type === 'presence' && m.membres.length === 1);
  });
});

describe('invités, curseurs et case ouverte (étapes b et c)', () => {
  /** Invite, puis ACCEPTE avec la session de l'invité — sans quoi il n'a aucun accès. */
  const inviter = async (cookiesDirecteur, email, droit) => {
    const compte = await User.findOne({ email });
    const reponse = await request(app)
      .post('/api/v2/partages/emploi/membres')
      .set('Cookie', cookiesDirecteur)
      .set('X-Annee-Scolaire', String(ANNEE))
      .send({ utilisateurIds: [compte.id], droit });
    expect(reponse.status).toBe(200);

    const message = await Message.findOne({ destinataireId: compte.id, 'invitation.statut': 'en_attente' });
    const acceptation = await request(app)
      .post(`/api/v2/partages/invitations/${message.id}/accepter`)
      .set('Cookie', await seConnecter(email));
    expect(acceptation.status).toBe(200);
    return compte;
  };

  it('laisse entrer un formateur INVITÉ, et dit son droit aux autres', async () => {
    const cookiesDirecteur = await seConnecter('directeur@edtpro.ma');
    await inviter(cookiesDirecteur, 'formateur@edtpro.ma', 'modifier');

    const directeur = await rejoindre(cookiesDirecteur);
    const formateur = await rejoindre(await seConnecter('formateur@edtpro.ma'));

    const presence = await directeur.attendre((m) => m.type === 'presence' && m.membres.length === 2);
    expect(presence.membres.find((m) => m.role === ROLES.FORMATEUR).droit).toBe('modifier');
    expect(presence.membres.find((m) => m.role === ROLES.DIRECTEUR).droit).toBe('proprietaire');
    expect(formateur.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('relaie le curseur aux autres — pas à celui qui bouge', async () => {
    const directeur = await rejoindre(await seConnecter('directeur@edtpro.ma'));
    const gestionnaire = await rejoindre(await seConnecter('gestionnaire@edtpro.ma'));

    const position = { semaine: '2026-W3', periode: 'jour', axe: 'formateur', cle: '9863||Lundi||S1||jour', x: 0.25, y: 0.5 };
    directeur.envoyer({ type: 'curseur', page: 'emploi', position });

    const curseur = await gestionnaire.attendre(type('curseur'));
    expect(curseur).toMatchObject({ page: 'emploi', position, utilisateur: { nom: 'DIRECTEUR TEST' } });
    // L'identifiant PUBLIC, jamais celui qui écarte des annonces.
    expect(curseur.connexion).not.toBe(directeur.connexionId);

    await rienNeVient(directeur, type('curseur'));
  });

  it('refuse un curseur hors bornes, sans fermer la socket', async () => {
    const directeur = await rejoindre(await seConnecter('directeur@edtpro.ma'));
    directeur.envoyer({
      type: 'curseur',
      page: 'emploi',
      position: { semaine: '2026-W3', periode: 'jour', axe: 'formateur', cle: 'x', x: 4, y: 0 },
    });
    await directeur.attendre((m) => m.type === 'erreur' && m.code === 'MESSAGE_INVALIDE');
    expect(directeur.ws.readyState).toBe(WebSocket.OPEN);
  });

  /*
   * ⚠️ UN MEMBRE « PEUT CONSULTER » N'OUVRE AUCUNE CASE : relayer sa `focus`
   * dessinerait « X modifie » chez les autres pour quelqu'un qui ne le peut pas.
   */
  it('relaie la case ouverte d’un éditeur, jamais celle d’un lecteur', async () => {
    const directeur = await rejoindre(await seConnecter('directeur@edtpro.ma'));
    const gestionnaire = await rejoindre(await seConnecter('gestionnaire@edtpro.ma'));
    const focus = { semaine: '2026-W3', periode: 'jour', axe: 'formateur', cle: '9863||Lundi||S1||jour' };

    gestionnaire.envoyer({ type: 'focus', page: 'emploi', focus });
    await rienNeVient(directeur, type('focus'));

    directeur.envoyer({ type: 'focus', page: 'emploi', focus });
    const recu = await gestionnaire.attendre(type('focus'));
    expect(recu.focus).toEqual(focus);
  });

  it('annonce le départ d’une connexion, pour effacer son curseur', async () => {
    const directeur = await rejoindre(await seConnecter('directeur@edtpro.ma'));
    const gestionnaire = await rejoindre(await seConnecter('gestionnaire@edtpro.ma'));

    directeur.envoyer({
      type: 'curseur',
      page: 'emploi',
      position: { semaine: '2026-W3', periode: 'jour', axe: 'formateur', cle: 'c', x: 0, y: 0 },
    });
    const { connexion } = await gestionnaire.attendre(type('curseur'));

    directeur.ws.close();
    const parti = await gestionnaire.attendre(type('parti'));
    expect(parti.connexion).toBe(connexion);
  });

  /*
   * ═══ ⚠️ RETIRER UNE INVITATION FERME LA SALLE SUR-LE-CHAMP ═══
   */
  it('sort de la salle un invité dont l’invitation est retirée', async () => {
    const cookiesDirecteur = await seConnecter('directeur@edtpro.ma');
    const compte = await inviter(cookiesDirecteur, 'formateur@edtpro.ma', 'modifier');

    const directeur = await rejoindre(cookiesDirecteur);
    const formateur = await rejoindre(await seConnecter('formateur@edtpro.ma'));
    await directeur.attendre((m) => m.type === 'presence' && m.membres.length === 2);

    await request(app)
      .delete(`/api/v2/partages/emploi/membres/${compte.id}`)
      .set('Cookie', cookiesDirecteur)
      .set('X-Annee-Scolaire', String(ANNEE));

    await formateur.attendre(type('acces-retire'));
    await directeur.attendre((m) => m.type === 'presence' && m.membres.length === 1);
  });

  /*
   * ═══ CHRONOGRAMME (2026-09-13) ═══ Sa clé de case — `groupe||module||semaine`
   * — est la même dans les deux vues : ni semaine, ni période, ni axe. Le schéma
   * les rend facultatifs ; sans cela, aucun curseur du chronogramme ne passerait.
   */
  it('relaie un curseur et une case ouverte SANS semaine ni axe (chronogramme)', async () => {
    const rejoindreChrono = async (cookies) => {
      const client = ouvrir({ cookies });
      await client.attendre(type('bienvenue'));
      client.envoyer({ type: 'rejoindre', page: 'chronogramme', anneeScolaire: ANNEE });
      await client.attendre(type('rejoint'));
      return client;
    };
    /*
     * Deux onglets du DIRECTEUR : le gestionnaire n'a plus le chronogramme par son
     * seul rôle (étape d2) — il n'y entrerait pas. Le relais se fait par
     * CONNEXION, un second onglet reçoit donc bien le curseur du premier.
     */
    const cookiesDirecteur = await seConnecter('directeur@edtpro.ma');
    const directeur = await rejoindreChrono(cookiesDirecteur);
    const second = await rejoindreChrono(cookiesDirecteur);

    const position = { cle: 'GM101||M101||3', x: 0.5, y: 0.5 };
    directeur.envoyer({ type: 'curseur', page: 'chronogramme', position });
    expect((await second.attendre(type('curseur'))).position).toEqual(position);

    directeur.envoyer({ type: 'focus', page: 'chronogramme', focus: { cle: 'GM101||M101||3' } });
    expect((await second.attendre(type('focus'))).focus).toEqual({ cle: 'GM101||M101||3' });
  });

  /*
   * ⚠️ L'ANNONCE PORTE LE PLANNING ET SA VERSION : les collègues l'appliquent
   * sans relire. L'avancement, lui, reçoit une annonce nue.
   */
  it('annonce un chronogramme enregistré AVEC son planning et sa version', async () => {
    const cookiesDirecteur = await seConnecter('directeur@edtpro.ma');
    // Un AUTRE onglet du directeur : sans `X-Connexion-Id`, l'écriture ne l'écarte pas.
    const onglet = ouvrir({ cookies: cookiesDirecteur });
    await onglet.attendre(type('bienvenue'));
    onglet.envoyer({ type: 'rejoindre', page: 'chronogramme', anneeScolaire: ANNEE });
    await onglet.attendre(type('rejoint'));

    const planning = { M101: { 3: { heures: 5, type: 'P' } } };
    const reponse = await request(app)
      .put('/api/v2/chronogrammes/GM101')
      .set('Cookie', cookiesDirecteur)
      .set('X-Annee-Scolaire', String(ANNEE))
      .send({ planning, version: 0 });
    expect(reponse.status).toBe(200);

    const annonce = await onglet.attendre((m) => m.type === 'modification' && m.page === 'chronogramme');
    expect(annonce).toMatchObject({ action: 'enregistrer', groupe: 'GM101', planning, version: 1 });
  });

  /*
   * ═══ AFFECTATIONS (2026-09-13) ═══ L'annonce d'une écriture de la base porte
   * la base PRÉSENTÉE à la salle « affectations » — la carte s'y applique sans
   * relecture. Les autres salles reçoivent une annonce nue.
   */
  describe('la base jointe à l’annonce', () => {
    const rejoindrePage = async (cookies, page) => {
      const client = ouvrir({ cookies });
      await client.attendre(type('bienvenue'));
      client.envoyer({ type: 'rejoindre', page, anneeScolaire: ANNEE });
      await client.attendre(type('rejoint'));
      return client;
    };

    it('joint la base à la salle Affectations, et à elle seule', async () => {
      const cookiesDirecteur = await seConnecter('directeur@edtpro.ma');
      const affectations = await rejoindrePage(cookiesDirecteur, 'affectations');
      const chronogramme = await rejoindrePage(cookiesDirecteur, 'chronogramme');

      const reponse = await request(app)
        .patch('/api/v2/base/formateurs/masse-horaire')
        .set('Cookie', cookiesDirecteur)
        .set('X-Annee-Scolaire', String(ANNEE))
        .send({ matricule: '9863', masseHoraire: 900 });
      expect(reponse.status).toBe(200);

      const annonce = await affectations.attendre(
        (m) => m.type === 'modification' && m.page === 'affectations'
      );
      expect(annonce.action).toBe('masse-horaire');
      // La forme de `GET /base` : c'est dans son cache que le client la pose.
      expect(annonce.base.version).toBe(1);
      expect(annonce.base.formateurs[0]).toMatchObject({ matricule: '9863', masseHoraire: 900 });

      const nue = await chronogramme.attendre(
        (m) => m.type === 'modification' && m.page === 'chronogramme'
      );
      expect(nue.base).toBeUndefined();
    });

    it('joint la carte enregistrée, version comprise', async () => {
      const cookiesDirecteur = await seConnecter('directeur@edtpro.ma');
      const affectations = await rejoindrePage(cookiesDirecteur, 'affectations');

      const reponse = await request(app)
        .post('/api/v2/base/carte')
        .set('Cookie', cookiesDirecteur)
        .set('X-Annee-Scolaire', String(ANNEE))
        .send({
          version: 0,
          formateurs: [{ nom: 'BRAHIM LOURID', matricule: '9863' }],
          groupes: [
            {
              nom: 'GM102',
              codeFiliere: 'GM',
              intituleFiliere: 'Génie mécanique',
              anneeFormation: 1,
              niveau: 'T',
              secteur: 'Mécanique',
              typeFormation: 'Diplômante',
              creneau: 'CDJ',
              mode: 'Résidentiel',
              modules: [
                { code: 'M101', nom: 'Métier', mhpS1: 30, mhpS2: 0, formateurPresentiel: 'BRAHIM LOURID' },
              ],
            },
          ],
        });
      expect(reponse.status).toBe(201);

      const annonce = await affectations.attendre(
        (m) => m.type === 'modification' && m.page === 'affectations'
      );
      expect(annonce).toMatchObject({ action: 'enregistrer-carte' });
      expect(annonce.base.version).toBe(reponse.body.version);
      expect(annonce.base.groupes).toContain('GM102');
    });
  });

  it('prévient un invité dont le droit change', async () => {
    const cookiesDirecteur = await seConnecter('directeur@edtpro.ma');
    const compte = await inviter(cookiesDirecteur, 'formateur@edtpro.ma', 'modifier');
    const formateur = await rejoindre(await seConnecter('formateur@edtpro.ma'));

    await request(app)
      .patch(`/api/v2/partages/emploi/membres/${compte.id}`)
      .set('Cookie', cookiesDirecteur)
      .set('X-Annee-Scolaire', String(ANNEE))
      .send({ droit: 'consulter' });

    const changement = await formateur.attendre(type('acces-modifie'));
    expect(changement.droit).toBe('consulter');
  });
});
