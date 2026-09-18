import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Message } from '../../src/models/Message.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Messagerie interne (F10) — sous-livraison (a).
 * ← api/messaging/*.php
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';

let directeur;
let formateur;
let collegue;
let stagiaire;
let gestionnaire;
let ailleurs;
let gestionnaireAilleurs;
let admin;
let etablissement;

const creer = async (nom, email, role, etablissements = []) =>
  User.create({
    nomComplet: nom,
    email,
    motDePasse: MOT_DE_PASSE,
    role,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
    etablissementIds: etablissements,
  });

const connecter = async (email) => {
  const reponse = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: email, motDePasse: MOT_DE_PASSE });
  return reponse.headers['set-cookie'];
};

beforeEach(async () => {
  directeur = await creer('Directeur Test', 'directeur@edtpro.ma', ROLES.DIRECTEUR);

  etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Test',
    anneeScolaire: 2026,
  });

  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  formateur = await creer('Formateur Un', 'f1@edtpro.ma', ROLES.FORMATEUR, [etablissement.id]);
  collegue = await creer('Formateur Deux', 'f2@edtpro.ma', ROLES.FORMATEUR, [etablissement.id]);
  stagiaire = await creer('Stagiaire Un', 's1@edtpro.ma', ROLES.STAGIAIRE, [etablissement.id]);
  gestionnaire = await creer('Gestion Un', 'g1@edtpro.ma', ROLES.GESTIONNAIRE, [etablissement.id]);
  admin = await creer('Admin Test', 'admin@edtpro.ma', ROLES.ADMIN);

  // Un formateur d'un AUTRE établissement : le témoin de l'isolation.
  const autre = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Casablanca-Settat',
    complexe: 'CF Autre',
    nom: 'ISTA Ailleurs',
    anneeScolaire: 2026,
  });
  ailleurs = await creer('Formateur Ailleurs', 'f9@edtpro.ma', ROLES.FORMATEUR, [autre.id]);
  gestionnaireAilleurs = await creer('Gestion Ailleurs', 'g9@edtpro.ma', ROLES.GESTIONNAIRE, [autre.id]);
});

const envoyer = (cookies, corps) =>
  request(app).post('/api/v2/messages').set('Cookie', cookies).send(corps);

describe('POST /messages — la matrice de droits', () => {
  it('le directeur écrit à son formateur', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    const reponse = await envoyer(cookies, {
      destinataires: [formateur.id],
      sujet: 'Réunion',
      corps: 'Jeudi 14 h.',
    });

    expect(reponse.status).toBe(200);
    expect(reponse.body.envoyes).toBe(1);
  });

  /*
   * ⚠️⚠️ RÉVISÉ LE 2026-09-03 (demande du porteur) : le directeur ÉCRIT
   * désormais à l'admin et à ses gestionnaires — ce n'était permis QU'EN
   * RÉPONSE jusqu'ici. Vérifié directement, sans message préalable.
   */
  it('le directeur écrit à l’admin et à son gestionnaire, sans échange préalable', async () => {
    const cookies = await connecter('directeur@edtpro.ma');

    const versAdmin = await envoyer(cookies, {
      destinataires: [admin.id],
      sujet: 'Question',
      corps: 'Bonjour',
    });
    expect(versAdmin.status).toBe(200);
    expect(versAdmin.body.envoyes).toBe(1);

    const versGestionnaire = await envoyer(cookies, {
      destinataires: [gestionnaire.id],
      sujet: 'Consigne',
      corps: 'Bonjour',
    });
    expect(versGestionnaire.status).toBe(200);
    expect(versGestionnaire.body.envoyes).toBe(1);
  });

  it('⚠️ REFUSE le gestionnaire d’un AUTRE établissement', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    const reponse = await envoyer(cookies, {
      destinataires: [gestionnaireAilleurs.id],
      sujet: 'Bonjour',
      corps: 'Test',
    });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('DESTINATAIRES_REFUSES');
  });

  /*
   * ⚠️ L'ISOLATION MULTI-ÉTABLISSEMENT. C'est le trou de `toggle_user_status.php`,
   * déjà rencontré sur les comptes : un contrôle de rôle sans contrôle
   * d'établissement laisse écrire à l'EFP d'à côté.
   */
  it('⚠️ REFUSE le formateur d’un AUTRE établissement', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    const reponse = await envoyer(cookies, {
      destinataires: [ailleurs.id],
      sujet: 'Bonjour',
      corps: 'Test',
    });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('DESTINATAIRES_REFUSES');
  });

  it('le stagiaire n’écrit QU’AUX gestionnaires', async () => {
    const cookies = await connecter('s1@edtpro.ma');

    const versGestionnaire = await envoyer(cookies, {
      destinataires: [gestionnaire.id],
      sujet: 'Question',
      corps: 'Bonjour',
    });
    expect(versGestionnaire.status).toBe(200);

    const versDirecteur = await envoyer(cookies, {
      destinataires: [directeur.id],
      sujet: 'Question',
      corps: 'Bonjour',
    });
    expect(versDirecteur.status).toBe(400);
  });

  it('le formateur écrit à ses collègues et à son directeur, pas aux stagiaires', async () => {
    const cookies = await connecter('f1@edtpro.ma');

    expect((await envoyer(cookies, { destinataires: [collegue.id], sujet: 'S', corps: 'C' })).status).toBe(200);
    expect((await envoyer(cookies, { destinataires: [directeur.id], sujet: 'S', corps: 'C' })).status).toBe(200);
    expect((await envoyer(cookies, { destinataires: [stagiaire.id], sujet: 'S', corps: 'C' })).status).toBe(400);
  });

  /*
   * ⚠️ UN REFUS EST NOMMÉ, PAS TU. `send.php` faisait `continue` sur un
   * destinataire non autorisé et répondait « envoyé » : on croyait avoir écrit à
   * cinq personnes, trois l'avaient reçu.
   */
  it('un envoi PARTIEL dit qui n’a pas reçu', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    const reponse = await envoyer(cookies, {
      destinataires: [formateur.id, ailleurs.id],
      sujet: 'Réunion',
      corps: 'Jeudi',
    });

    expect(reponse.status).toBe(200);
    expect(reponse.body.envoyes).toBe(1);
    expect(reponse.body.refuses).toHaveLength(1);
    expect(reponse.body.refuses[0].nom).toBe('Formateur Ailleurs');
  });

  /*
   * ⚠️ RÉPONDRE EST TOUJOURS PERMIS. Depuis la révision du 2026-09-03,
   * `directeur → gestionnaire` passe déjà par la matrice — c'est désormais
   * `formateur → gestionnaire` qui reste le seul pair asymétrique, et c'est
   * lui qui démontre l'exception.
   */
  it('⚠️ on peut RÉPONDRE à qui la matrice ne permet pas d’écrire', async () => {
    const duGestionnaire = await connecter('g1@edtpro.ma');
    const envoi = await envoyer(duGestionnaire, {
      destinataires: [formateur.id],
      sujet: 'Congés',
      corps: 'Demande',
    });
    expect(envoi.status).toBe(200);

    const recu = await Message.findOne({ destinataireId: formateur.id });

    const duFormateur = await connecter('f1@edtpro.ma');
    const sansFil = await envoyer(duFormateur, {
      destinataires: [gestionnaire.id],
      sujet: 'Autre sujet',
      corps: 'Test',
    });
    expect(sansFil.status).toBe(400);

    const reponse = await envoyer(duFormateur, {
      destinataires: [gestionnaire.id],
      sujet: 'Re: Congés',
      corps: 'Accordé',
      reponseA: String(recu._id),
    });
    expect(reponse.status).toBe(200);
  });

  it('on ne s’écrit pas à SOI-MÊME', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    const reponse = await envoyer(cookies, {
      destinataires: [directeur.id],
      sujet: 'Note',
      corps: 'Pour moi',
    });

    expect(reponse.status).toBe(400);
  });

  /*
   * ⚠️ LE CORPS N'EST PLUS ÉCHAPPÉ À L'ÉCRITURE. `send.php` appliquait
   * `htmlspecialchars` à l'ENTRÉE : « l'emploi » était stocké « l&#039;emploi »
   * et le restait à jamais. React échappe à l'affichage — le bon endroit (§4.6).
   */
  it('⚠️ le corps est stocké TEL QUEL, pas encodé', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    await envoyer(cookies, {
      destinataires: [formateur.id],
      sujet: 'L’emploi du temps',
      corps: "Voir l'onglet <Emploi> & la grille",
    });

    const message = await Message.findOne({ destinataireId: formateur.id });
    expect(message.corps).toBe("Voir l'onglet <Emploi> & la grille");
    expect(message.sujet).toBe('L’emploi du temps');
  });
});

describe('Boîte, lecture et compteur', () => {
  const poser = async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    await envoyer(cookies, { destinataires: [formateur.id], sujet: 'Réunion', corps: 'Jeudi' });
    return cookies;
  };

  it('la boîte de réception rend le message et son expéditeur', async () => {
    await poser();
    const cookies = await connecter('f1@edtpro.ma');
    const reponse = await request(app).get('/api/v2/messages').set('Cookie', cookies);

    expect(reponse.body.messages).toHaveLength(1);
    expect(reponse.body.messages[0]).toMatchObject({
      sujet: 'Réunion',
      lu: false,
      correspondant: { nom: 'Directeur Test', role: ROLES.DIRECTEUR },
    });
  });

  it('les ENVOYÉS rendent le destinataire, pas l’expéditeur', async () => {
    const cookies = await poser();
    const reponse = await request(app)
      .get('/api/v2/messages?boite=envoyes')
      .set('Cookie', cookies);

    expect(reponse.body.messages[0].correspondant.nom).toBe('Formateur Un');
  });

  it('ouvrir marque LU, et le compteur suit', async () => {
    await poser();
    const cookies = await connecter('f1@edtpro.ma');

    expect((await request(app).get('/api/v2/messages/non-lus').set('Cookie', cookies)).body.nonLus).toBe(1);

    const message = await Message.findOne({ destinataireId: formateur.id });
    await request(app).get(`/api/v2/messages/${message._id}`).set('Cookie', cookies);

    expect((await request(app).get('/api/v2/messages/non-lus').set('Cookie', cookies)).body.nonLus).toBe(0);
  });

  /*
   * ⚠️ SEUL LE DESTINATAIRE MARQUE LU. Relire un message qu'on a ENVOYÉ ne doit
   * pas le faire passer pour lu chez l'autre — `read.php` ne s'en gardait pas.
   */
  it('⚠️ l’EXPÉDITEUR qui relit son message ne le marque PAS lu', async () => {
    const cookies = await poser();
    const message = await Message.findOne({ destinataireId: formateur.id });

    await request(app).get(`/api/v2/messages/${message._id}`).set('Cookie', cookies);

    expect((await Message.findById(message._id)).lu).toBe(false);
  });

  it('un message qui ne vous concerne pas est refusé', async () => {
    await poser();
    const message = await Message.findOne({ destinataireId: formateur.id });
    const cookies = await connecter('s1@edtpro.ma');

    const reponse = await request(app).get(`/api/v2/messages/${message._id}`).set('Cookie', cookies);
    expect(reponse.status).toBe(403);
  });
});

describe('Suppression', () => {
  /*
   * ⚠️ LA SUPPRESSION EST PAR CÔTÉ. Effacer pour les deux ferait disparaître un
   * message de la boîte de quelqu'un qui ne l'a pas demandé.
   */
  it('retirer de sa boîte laisse celui du correspondant', async () => {
    const duDirecteur = await connecter('directeur@edtpro.ma');
    await envoyer(duDirecteur, { destinataires: [formateur.id], sujet: 'S', corps: 'C' });
    const message = await Message.findOne({});

    const duFormateur = await connecter('f1@edtpro.ma');
    const reponse = await request(app)
      .delete(`/api/v2/messages/${message._id}`)
      .set('Cookie', duFormateur);

    expect(reponse.body.definitif).toBe(false);
    expect(await Message.countDocuments({})).toBe(1);

    const boite = await request(app).get('/api/v2/messages').set('Cookie', duFormateur);
    expect(boite.body.messages).toHaveLength(0);

    const envoyes = await request(app)
      .get('/api/v2/messages?boite=envoyes')
      .set('Cookie', duDirecteur);
    expect(envoyes.body.messages).toHaveLength(1);
  });

  it('quand les DEUX l’ont retiré, le document part', async () => {
    const duDirecteur = await connecter('directeur@edtpro.ma');
    await envoyer(duDirecteur, { destinataires: [formateur.id], sujet: 'S', corps: 'C' });
    const message = await Message.findOne({});

    const duFormateur = await connecter('f1@edtpro.ma');
    await request(app).delete(`/api/v2/messages/${message._id}`).set('Cookie', duFormateur);
    const seconde = await request(app)
      .delete(`/api/v2/messages/${message._id}`)
      .set('Cookie', duDirecteur);

    expect(seconde.body.definitif).toBe(true);
    expect(await Message.countDocuments({})).toBe(0);
  });
});

describe('GET /messages/correspondants', () => {
  /*
   * ⚠️ LA MÊME RÈGLE QUE LE CONTRÔLE D'ENVOI. Deux définitions — une pour
   * proposer, une pour vérifier — divergeraient, et l'écran offrirait des
   * destinataires que le serveur refuse.
   */
  it('rend exactement ce que le rôle permet de joindre', async () => {
    const cookies = await connecter('s1@edtpro.ma');
    const reponse = await request(app).get('/api/v2/messages/correspondants').set('Cookie', cookies);

    expect(reponse.body.correspondants.map((c) => c.nom)).toEqual(['Gestion Un']);
  });

  /*
   * ⚠️ L'ADRESSE, PAS SEULEMENT LE NOM (2026-09-03, demande du porteur :
   * « comme dans Gmail »). Sans elle, deux homonymes de deux établissements —
   * cas réel dans un parc de mille comptes — sont indiscernables dans la liste
   * des destinataires.
   */
  it('rend l’adresse de chaque correspondant', async () => {
    const cookies = await connecter('s1@edtpro.ma');
    const reponse = await request(app).get('/api/v2/messages/correspondants').set('Cookie', cookies);

    expect(reponse.body.correspondants[0].email).toBeTruthy();
  });

  it('n’y fait jamais figurer un compte d’un autre établissement', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    const reponse = await request(app).get('/api/v2/messages/correspondants').set('Cookie', cookies);

    const noms = reponse.body.correspondants.map((c) => c.nom);
    expect(noms).toContain('Formateur Un');
    expect(noms).not.toContain('Formateur Ailleurs');
    expect(noms).not.toContain('Gestion Ailleurs');
  });

  /*
   * ⚠️⚠️ RÉVISÉ LE 2026-09-03 : le directeur voit désormais l'admin et son
   * gestionnaire dans SA propre liste de correspondants, pas seulement dans
   * la matrice d'envoi — c'est cette liste qui alimente le sélecteur écran.
   */
  it('le directeur voit l’admin et son gestionnaire parmi ses correspondants', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    const reponse = await request(app).get('/api/v2/messages/correspondants').set('Cookie', cookies);

    const noms = reponse.body.correspondants.map((c) => c.nom);
    expect(noms).toContain('Admin Test');
    expect(noms).toContain('Gestion Un');
  });

  /*
   * ⚠️ « correspondants » et « non-lus » se déclarent AVANT `/:id` — sinon la
   * route d'identifiant les capterait et répondrait 400 sur une route pourtant
   * écrite. Le piège déjà rencontré sur les séances et les chronogrammes.
   */
  it('n’est pas captée par la route d’un identifiant', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    expect((await request(app).get('/api/v2/messages/correspondants').set('Cookie', cookies)).status).toBe(200);
    expect((await request(app).get('/api/v2/messages/non-lus').set('Cookie', cookies)).status).toBe(200);
  });
});

describe('Les cinq boîtes', () => {
  const poser = async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    await envoyer(cookies, { destinataires: [formateur.id], sujet: 'Réunion', corps: 'Jeudi' });
    return cookies;
  };

  /*
   * ⚠️ SUPPRIMER N'EFFACE PLUS : le message va dans la CORBEILLE, d'où il se
   * restaure. Sans cela, un clic malheureux était sans recours.
   */
  it('un message supprimé quitte la boîte et se retrouve dans la corbeille', async () => {
    await poser();
    const cookies = await connecter('f1@edtpro.ma');
    const message = await Message.findOne({ destinataireId: formateur.id });

    await request(app).delete(`/api/v2/messages/${message._id}`).set('Cookie', cookies);

    const reception = await request(app).get('/api/v2/messages').set('Cookie', cookies);
    expect(reception.body.messages).toHaveLength(0);

    const corbeille = await request(app)
      .get('/api/v2/messages?boite=corbeille')
      .set('Cookie', cookies);
    expect(corbeille.body.messages).toHaveLength(1);
  });

  it('et il en revient par « restaurer »', async () => {
    await poser();
    const cookies = await connecter('f1@edtpro.ma');
    const message = await Message.findOne({ destinataireId: formateur.id });

    await request(app).delete(`/api/v2/messages/${message._id}`).set('Cookie', cookies);
    await request(app).post(`/api/v2/messages/${message._id}/restaurer`).set('Cookie', cookies);

    const reception = await request(app).get('/api/v2/messages').set('Cookie', cookies);
    expect(reception.body.messages).toHaveLength(1);
  });

  /*
   * ⚠️ ARCHIVER N'EST PAS SUPPRIMER : le message quitte la réception, reste
   * consultable, et revient d'un geste.
   */
  it('archiver sort le message de la réception sans le jeter', async () => {
    await poser();
    const cookies = await connecter('f1@edtpro.ma');
    const message = await Message.findOne({ destinataireId: formateur.id });

    await request(app)
      .post(`/api/v2/messages/${message._id}/archive`)
      .set('Cookie', cookies)
      .send({ archive: true });

    expect((await request(app).get('/api/v2/messages').set('Cookie', cookies)).body.messages).toHaveLength(0);
    expect(
      (await request(app).get('/api/v2/messages?boite=archive').set('Cookie', cookies)).body.messages
    ).toHaveLength(1);
    expect(
      (await request(app).get('/api/v2/messages?boite=corbeille').set('Cookie', cookies)).body.messages
    ).toHaveLength(0);
  });

  /*
   * ⚠️ L'ARCHIVE EST PAR CÔTÉ, comme la suppression : ranger sa propre boîte ne
   * doit rien changer à celle du correspondant.
   */
  it('⚠️ archiver de mon côté ne touche PAS la boîte de l’autre', async () => {
    const duDirecteur = await poser();
    const duFormateur = await connecter('f1@edtpro.ma');
    const message = await Message.findOne({ destinataireId: formateur.id });

    await request(app)
      .post(`/api/v2/messages/${message._id}/archive`)
      .set('Cookie', duFormateur)
      .send({ archive: true });

    const envoyes = await request(app)
      .get('/api/v2/messages?boite=envoyes')
      .set('Cookie', duDirecteur);
    expect(envoyes.body.messages).toHaveLength(1);
  });

  it('les compteurs de la colonne de gauche', async () => {
    await poser();
    const cookies = await connecter('f1@edtpro.ma');

    const avant = await request(app).get('/api/v2/messages/boites').set('Cookie', cookies);
    expect(avant.body.boites).toEqual({ reception: 1, brouillons: 0, corbeille: 0, archive: 0 });

    const message = await Message.findOne({ destinataireId: formateur.id });
    await request(app).delete(`/api/v2/messages/${message._id}`).set('Cookie', cookies);

    const apres = await request(app).get('/api/v2/messages/boites').set('Cookie', cookies);
    expect(apres.body.boites).toMatchObject({ reception: 0, corbeille: 1 });
  });
});

describe('Brouillons', () => {
  /*
   * ⚠️ UN BROUILLON N'EXIGE RIEN : ni destinataire, ni sujet, ni corps. Le
   * contraindre reviendrait à interdire de s'interrompre.
   */
  it('s’enregistre même vide', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    const reponse = await request(app)
      .post('/api/v2/messages/brouillons')
      .set('Cookie', cookies)
      .send({});

    expect(reponse.status).toBe(200);
    expect(reponse.body.id).toBeDefined();
  });

  it('se met à jour au lieu de se dupliquer', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    const premier = await request(app)
      .post('/api/v2/messages/brouillons')
      .set('Cookie', cookies)
      .send({ sujet: 'Ébauche' });

    await request(app)
      .post('/api/v2/messages/brouillons')
      .set('Cookie', cookies)
      .send({ id: premier.body.id, sujet: 'Ébauche revue', corps: 'Suite' });

    const boite = await request(app)
      .get('/api/v2/messages?boite=brouillons')
      .set('Cookie', cookies);

    expect(boite.body.messages).toHaveLength(1);
    expect(boite.body.messages[0].sujet).toBe('Ébauche revue');
  });

  /*
   * ⚠️ UN BROUILLON SANS DESTINATAIRE EST NOMMÉ : une ligne vide laisserait
   * croire à un défaut d'affichage, alors que c'est son état normal.
   */
  it('rend « Sans destinataire » quand il n’en porte pas', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    await request(app).post('/api/v2/messages/brouillons').set('Cookie', cookies).send({ sujet: 'X' });

    const boite = await request(app)
      .get('/api/v2/messages?boite=brouillons')
      .set('Cookie', cookies);

    expect(boite.body.messages[0].correspondant.nom).toBe('Sans destinataire');
  });

  it('rend les noms de ses destinataires quand il en porte', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    await request(app)
      .post('/api/v2/messages/brouillons')
      .set('Cookie', cookies)
      .send({ destinataires: [formateur.id], sujet: 'X' });

    const boite = await request(app)
      .get('/api/v2/messages?boite=brouillons')
      .set('Cookie', cookies);

    expect(boite.body.messages[0].correspondant.nom).toBe('Formateur Un');
  });

  it('⚠️ n’apparaît JAMAIS dans les envoyés — il n’est pas parti', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    await request(app)
      .post('/api/v2/messages/brouillons')
      .set('Cookie', cookies)
      .send({ destinataires: [formateur.id], sujet: 'X', corps: 'Y' });

    const envoyes = await request(app)
      .get('/api/v2/messages?boite=envoyes')
      .set('Cookie', cookies);
    expect(envoyes.body.messages).toHaveLength(0);
  });

  it('se supprime définitivement, sans passer par la corbeille', async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    const cree = await request(app)
      .post('/api/v2/messages/brouillons')
      .set('Cookie', cookies)
      .send({ sujet: 'À jeter' });

    await request(app)
      .delete(`/api/v2/messages/brouillons/${cree.body.id}`)
      .set('Cookie', cookies);

    expect(await Message.countDocuments({ brouillon: true })).toBe(0);
    const corbeille = await request(app)
      .get('/api/v2/messages?boite=corbeille')
      .set('Cookie', cookies);
    expect(corbeille.body.messages).toHaveLength(0);
  });

  it('⚠️ le brouillon d’un autre ne se modifie ni ne se supprime', async () => {
    const duDirecteur = await connecter('directeur@edtpro.ma');
    const cree = await request(app)
      .post('/api/v2/messages/brouillons')
      .set('Cookie', duDirecteur)
      .send({ sujet: 'Privé' });

    const duFormateur = await connecter('f1@edtpro.ma');
    expect(
      (
        await request(app)
          .post('/api/v2/messages/brouillons')
          .set('Cookie', duFormateur)
          .send({ id: cree.body.id, sujet: 'Détourné' })
      ).status
    ).toBe(404);

    expect(
      (await request(app).delete(`/api/v2/messages/brouillons/${cree.body.id}`).set('Cookie', duFormateur))
        .status
    ).toBe(404);
  });
});

describe('Marquer non lu', () => {
  const poser = async () => {
    const cookies = await connecter('directeur@edtpro.ma');
    await envoyer(cookies, { destinataires: [formateur.id], sujet: 'Réunion', corps: 'Jeudi' });
    return cookies;
  };

  it('rend au message son état non lu après l’avoir ouvert', async () => {
    await poser();
    const cookies = await connecter('f1@edtpro.ma');
    const message = await Message.findOne({ destinataireId: formateur.id });

    await request(app).get(`/api/v2/messages/${message._id}`).set('Cookie', cookies);
    expect((await Message.findById(message._id)).lu).toBe(true);

    const reponse = await request(app)
      .post(`/api/v2/messages/${message._id}/non-lu`)
      .set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect((await Message.findById(message._id)).lu).toBe(false);
  });

  it('et le compteur du menu le recompte', async () => {
    await poser();
    const cookies = await connecter('f1@edtpro.ma');
    const message = await Message.findOne({ destinataireId: formateur.id });

    await request(app).get(`/api/v2/messages/${message._id}`).set('Cookie', cookies);
    expect((await request(app).get('/api/v2/messages/non-lus').set('Cookie', cookies)).body.nonLus).toBe(0);

    await request(app).post(`/api/v2/messages/${message._id}/non-lu`).set('Cookie', cookies);
    expect((await request(app).get('/api/v2/messages/non-lus').set('Cookie', cookies)).body.nonLus).toBe(1);
  });

  /*
   * ⚠️ `lu` DÉCRIT LA LECTURE DU DESTINATAIRE. L'expéditeur n'en a aucune :
   * le laisser marquer son propre envoi « non lu » ferait réapparaître le message
   * dans le compteur de QUELQU'UN D'AUTRE.
   */
  it('⚠️ l’expéditeur ne peut PAS marquer non lu ce qu’il a envoyé', async () => {
    const cookies = await poser();
    const message = await Message.findOne({ destinataireId: formateur.id });

    const reponse = await request(app)
      .post(`/api/v2/messages/${message._id}/non-lu`)
      .set('Cookie', cookies);

    expect(reponse.status).toBe(403);
    expect((await Message.findById(message._id)).lu).toBe(false);
  });

  it('⚠️ un étranger au message ne le touche pas', async () => {
    await poser();
    const cookies = await connecter('f2@edtpro.ma');
    const message = await Message.findOne({ destinataireId: formateur.id });

    expect(
      (await request(app).post(`/api/v2/messages/${message._id}/non-lu`).set('Cookie', cookies)).status
    ).toBe(403);
  });

  /*
   * ⚠️ `recu` NE SE DÉDUIT PAS DE LA BOÎTE : l'archive et la corbeille mêlent
   * les deux sens, et l'écran y annonçait « Reçu » sur un message envoyé.
   */
  it('« reçu » distingue les deux sens dans une même boîte', async () => {
    const duDirecteur = await poser();
    const message = await Message.findOne({ destinataireId: formateur.id });

    await request(app)
      .post(`/api/v2/messages/${message._id}/archive`)
      .set('Cookie', duDirecteur)
      .send({ archive: true });

    const cote = async (cookies) =>
      (await request(app).get('/api/v2/messages?boite=archive').set('Cookie', cookies)).body.messages;

    expect((await cote(duDirecteur))[0].recu).toBe(false);

    const duFormateur = await connecter('f1@edtpro.ma');
    await request(app)
      .post(`/api/v2/messages/${message._id}/archive`)
      .set('Cookie', duFormateur)
      .send({ archive: true });
    expect((await cote(duFormateur))[0].recu).toBe(true);
  });
});
