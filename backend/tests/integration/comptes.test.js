import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { Base } from '../../src/models/Base.js';
import { Stagiaire } from '../../src/models/Stagiaire.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

const { envois } = vi.hoisted(() => ({ envois: [] }));
vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async (m) => {
    envois.push(m);
    return { envoye: true };
  }),
}));

const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';

let directeur;
let cookiesDirecteur;
let etablissement;
let autreEtablissement;

async function creerDirecteur(email, nomEtablissement) {
  const utilisateur = await User.create({
    nomComplet: `Directeur ${email}`,
    email,
    motDePasse: MOT_DE_PASSE,
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
  const etab = await Etablissement.create({
    proprietaireId: utilisateur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: nomEtablissement,
    anneeScolaire: 2026,
  });
  utilisateur.etablissementIds = [etab.id];
  await utilisateur.save();
  return { utilisateur, etab };
}

beforeEach(async () => {
  envois.length = 0;

  const principal = await creerDirecteur('directeur@edtpro.ma', 'ISTA Principal');
  directeur = principal.utilisateur;
  etablissement = principal.etab;

  const voisin = await creerDirecteur('voisin@edtpro.ma', 'ISTA Voisin');
  autreEtablissement = voisin.etab;

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookiesDirecteur = connexion.headers['set-cookie'];
});

const nouveauFormateur = {
  nomComplet: 'Ahmed Cherkaoui',
  role: ROLES.FORMATEUR,
  identifiant: '9863',
  motDePasse: 'Formateur2026',
};

describe('Création de comptes', () => {
  it('crée un formateur actif, vérifié, rattaché à l\'établissement', async () => {
    const reponse = await request(app)
      .post('/api/v2/comptes')
      .set('Cookie', cookiesDirecteur)
      .send(nouveauFormateur);

    expect(reponse.status).toBe(201);
    expect(reponse.body.compte.role).toBe(ROLES.FORMATEUR);
    // Ces comptes n'ont pas de parcours d'inscription : le directeur en répond.
    expect(reponse.body.compte.estActif).toBe(true);

    const cree = await User.findOne({ identifiant: '9863' });
    expect(cree.estVerifie).toBe(true);
    expect(cree.etablissementIds[0].toString()).toBe(etablissement.id);

    // Il peut se connecter avec son matricule, pas seulement une adresse.
    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: '9863', motDePasse: 'Formateur2026' });
    expect(connexion.body.action).toBe('connecte');
  });

  it('fabrique une adresse de remplissage quand il n\'y en a pas', async () => {
    const reponse = await request(app)
      .post('/api/v2/comptes')
      .set('Cookie', cookiesDirecteur)
      .send(nouveauFormateur);

    expect(reponse.body.compte.email).toBe('9863@placeholder.ofppt.ma');
    expect(reponse.body.compte.emailFictif).toBe(true);
  });

  it('refuse un identifiant déjà pris', async () => {
    await request(app).post('/api/v2/comptes').set('Cookie', cookiesDirecteur).send(nouveauFormateur);
    const doublon = await request(app)
      .post('/api/v2/comptes')
      .set('Cookie', cookiesDirecteur)
      .send(nouveauFormateur);

    expect(doublon.status).toBe(409);
    expect(doublon.body.code).toBe('COMPTE_EXISTANT');
  });

  it('interdit à un directeur de créer un directeur ou un admin', async () => {
    for (const role of [ROLES.DIRECTEUR, ROLES.ADMIN]) {
      const reponse = await request(app)
        .post('/api/v2/comptes')
        .set('Cookie', cookiesDirecteur)
        .send({ ...nouveauFormateur, identifiant: `x${role}`, role });

      expect(reponse.status).toBe(400);
      expect(reponse.body.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('Isolation entre établissements', () => {
  it("ne liste que les comptes de son propre établissement", async () => {
    await request(app).post('/api/v2/comptes').set('Cookie', cookiesDirecteur).send(nouveauFormateur);

    // Compte appartenant au voisin.
    await User.create({
      nomComplet: 'Formateur Voisin',
      identifiant: '7777',
      email: '7777@placeholder.ofppt.ma',
      motDePasse: MOT_DE_PASSE,
      role: ROLES.FORMATEUR,
      statut: STATUTS_COMPTE.APPROUVE,
      estVerifie: true,
      etablissementIds: [autreEtablissement.id],
    });

    const liste = await request(app).get('/api/v2/comptes').set('Cookie', cookiesDirecteur);

    expect(liste.body.total).toBe(1);
    expect(liste.body.comptes[0].identifiant).toBe('9863');
  });

  it("refuse d'agir sur un compte d'un autre établissement", async () => {
    const voisin = await User.create({
      nomComplet: 'Formateur Voisin',
      identifiant: '7777',
      email: '7777@placeholder.ofppt.ma',
      motDePasse: MOT_DE_PASSE,
      role: ROLES.FORMATEUR,
      statut: STATUTS_COMPTE.APPROUVE,
      estVerifie: true,
      etablissementIds: [autreEtablissement.id],
    });

    // C'est le trou que `toggle_user_status.php` laissait ouvert : il vérifiait
    // le rôle de la cible, mais pas son établissement.
    const activation = await request(app)
      .patch(`/api/v2/comptes/${voisin.id}/activation`)
      .set('Cookie', cookiesDirecteur)
      .send({ actif: false });
    expect(activation.status).toBe(404);

    const suppression = await request(app)
      .delete(`/api/v2/comptes/${voisin.id}`)
      .set('Cookie', cookiesDirecteur);
    expect(suppression.status).toBe(404);

    expect(await User.findById(voisin.id)).not.toBeNull();
  });

  it("refuse d'agir sur un directeur, même du même établissement", async () => {
    const reponse = await request(app)
      .delete(`/api/v2/comptes/${directeur.id}`)
      .set('Cookie', cookiesDirecteur);

    expect(reponse.status).toBe(404);
    expect(await User.findById(directeur.id)).not.toBeNull();
  });
});

describe('Activation et mot de passe', () => {
  let formateurId;

  beforeEach(async () => {
    const creation = await request(app)
      .post('/api/v2/comptes')
      .set('Cookie', cookiesDirecteur)
      .send(nouveauFormateur);
    formateurId = creation.body.compte.id;
  });

  it('la désactivation coupe les sessions ouvertes', async () => {
    await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: '9863', motDePasse: 'Formateur2026' });
    expect(await RefreshToken.countDocuments({ utilisateurId: formateurId })).toBe(1);

    await request(app)
      .patch(`/api/v2/comptes/${formateurId}/activation`)
      .set('Cookie', cookiesDirecteur)
      .send({ actif: false });

    expect(await RefreshToken.countDocuments({ utilisateurId: formateurId })).toBe(0);

    const reconnexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: '9863', motDePasse: 'Formateur2026' });
    expect(reconnexion.status).toBe(403);
  });

  it('renvoie le mot de passe quand aucune adresse réelle n\'existe', async () => {
    const reponse = await request(app)
      .post(`/api/v2/comptes/${formateurId}/mot-de-passe`)
      .set('Cookie', cookiesDirecteur);

    // Sans adresse réelle, aucun autre canal ne permet de le transmettre.
    expect(reponse.body.aTransmettre).toBe(true);
    expect(reponse.body.motDePasse).toMatch(/^Aa1/);
    expect(envois).toHaveLength(0);

    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: '9863', motDePasse: reponse.body.motDePasse });
    expect(connexion.body.action).toBe('connecte');
  });

  it("l'envoie par e-mail — et ne le renvoie pas — quand l'adresse est réelle", async () => {
    const creation = await request(app)
      .post('/api/v2/comptes')
      .set('Cookie', cookiesDirecteur)
      .send({
        nomComplet: 'Fatima Alami',
        role: ROLES.FORMATEUR,
        identifiant: '9864',
        email: 'fatima.alami@ofppt.ma',
        motDePasse: 'Formateur2026',
      });

    const reponse = await request(app)
      .post(`/api/v2/comptes/${creation.body.compte.id}/mot-de-passe`)
      .set('Cookie', cookiesDirecteur);

    expect(reponse.body.aTransmettre).toBe(false);
    expect(reponse.body.motDePasse).toBeUndefined();
    expect(envois.at(-1).destinataire).toBe('fatima.alami@ofppt.ma');
  });
});

describe('Suppression en lot', () => {
  it('supprime tous les comptes d\'un rôle, sans toucher aux autres', async () => {
    await request(app).post('/api/v2/comptes').set('Cookie', cookiesDirecteur).send(nouveauFormateur);
    await request(app)
      .post('/api/v2/comptes')
      .set('Cookie', cookiesDirecteur)
      .send({
        nomComplet: 'Stagiaire Un',
        role: ROLES.STAGIAIRE,
        identifiant: 'CEF001',
        motDePasse: 'Stagiaire2026',
      });

    const reponse = await request(app)
      .post('/api/v2/comptes/suppression-lot')
      .set('Cookie', cookiesDirecteur)
      .send({ role: ROLES.STAGIAIRE });

    expect(reponse.body.supprimes).toBe(1);
    expect(await User.findOne({ identifiant: '9863' })).not.toBeNull();
    expect(await User.findOne({ identifiant: 'CEF001' })).toBeNull();
  });

  it('refuse une demande qui mélange identifiants et rôle', async () => {
    const reponse = await request(app)
      .post('/api/v2/comptes/suppression-lot')
      .set('Cookie', cookiesDirecteur)
      .send({ role: ROLES.STAGIAIRE, ids: ['507f1f77bcf86cd799439011'] });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('Création en masse depuis la base (Sessions)', () => {
  async function baseAvecFormateurs() {
    return Base.create({
      etablissementId: etablissement.id,
      anneeScolaire: 2026,
      formateurs: [
        { matricule: '9863', nomComplet: 'AHMED CHERKAOUI', email: 'a.cherkaoui@ofppt.ma' },
        { matricule: '18448', nomComplet: 'FATIMA ZAHRA IDRISSI', email: '' },
        // Sans matricule : le login EST le matricule, il ne peut pas être vide.
        { matricule: '', nomComplet: 'SANS MATRICULE', email: '' },
      ],
    });
  }

  it('liste les formateurs de la base, en signalant ceux déjà servis', async () => {
    await baseAvecFormateurs();

    await request(app)
      .post('/api/v2/comptes')
      .set('Cookie', cookiesDirecteur)
      .send({ ...nouveauFormateur, identifiant: '9863' });

    const reponse = await request(app)
      .get('/api/v2/comptes/candidats?role=formateur')
      .set('Cookie', cookiesDirecteur);

    expect(reponse.status).toBe(200);
    // Le formateur sans matricule est écarté : il n'a pas d'identifiant possible.
    expect(reponse.body.personnes).toHaveLength(2);

    const parIdentifiant = Object.fromEntries(
      reponse.body.personnes.map((p) => [p.identifiant, p])
    );
    expect(parIdentifiant['9863'].aDejaUnCompte).toBe(true);
    expect(parIdentifiant['18448'].aDejaUnCompte).toBe(false);
  });

  it('crée les comptes sélectionnés et IGNORE ceux qui existent déjà', async () => {
    await baseAvecFormateurs();

    await request(app)
      .post('/api/v2/comptes')
      .set('Cookie', cookiesDirecteur)
      .send({ ...nouveauFormateur, identifiant: '9863' });

    const reponse = await request(app)
      .post('/api/v2/comptes/lot')
      .set('Cookie', cookiesDirecteur)
      .send({ role: ROLES.FORMATEUR, matricules: ['9863', '18448'], motDePasse: 'Lot2026Secret' });

    expect(reponse.status).toBe(200);
    expect(reponse.body.crees).toHaveLength(1);
    // Un doublon est IGNORÉ, pas une erreur : sur 995 comptes, rejouer la
    // création après un ajout de dix personnes ne doit rien casser.
    expect(reponse.body.ignores).toEqual(['9863']);
    expect(reponse.body.echecs).toEqual([]);

    const cree = await User.findOne({ identifiant: '18448' });
    expect(cree.role).toBe(ROLES.FORMATEUR);
    expect(cree.estActif).toBe(true);
    expect(cree.estVerifie).toBe(true);
    // Sans adresse connue, le repli de create_user_account.php:82.
    expect(cree.email).toBe('18448@placeholder.ofppt.ma');
  });

  it('est REJOUABLE : un second envoi ne crée rien et ne casse rien', async () => {
    await baseAvecFormateurs();
    const charge = {
      role: ROLES.FORMATEUR,
      matricules: ['9863', '18448'],
      motDePasse: 'Lot2026Secret',
    };

    await request(app).post('/api/v2/comptes/lot').set('Cookie', cookiesDirecteur).send(charge);
    const second = await request(app)
      .post('/api/v2/comptes/lot')
      .set('Cookie', cookiesDirecteur)
      .send(charge);

    expect(second.body.crees).toEqual([]);
    expect(second.body.ignores).toHaveLength(2);
    expect(await User.countDocuments({ role: ROLES.FORMATEUR })).toBe(2);
  });

  it('signale un matricule absent de la base sans interrompre le lot', async () => {
    await baseAvecFormateurs();

    const reponse = await request(app)
      .post('/api/v2/comptes/lot')
      .set('Cookie', cookiesDirecteur)
      .send({
        role: ROLES.FORMATEUR,
        matricules: ['18448', 'FANTOME'],
        motDePasse: 'Lot2026Secret',
      });

    // L'existant enveloppait les 995 insertions dans UNE transaction : un échec
    // non attrapé annulait tout. Ici chaque compte est indépendant.
    expect(reponse.body.crees).toHaveLength(1);
    expect(reponse.body.echecs).toEqual([
      { identifiant: 'FANTOME', raison: 'Introuvable dans la base' },
    ]);
  });

  it("n'expose pas la base d'un autre établissement", async () => {
    await Base.create({
      etablissementId: autreEtablissement.id,
      anneeScolaire: 2026,
      formateurs: [{ matricule: '7777', nomComplet: 'VOISIN', email: '' }],
    });

    const reponse = await request(app)
      .get('/api/v2/comptes/candidats?role=formateur')
      .set('Cookie', cookiesDirecteur);

    expect(reponse.body.personnes).toEqual([]);
  });

  it('rend une liste vide de stagiaires tant que rien ne les alimente', async () => {
    // Leur source est l'import Konosys, porté par la page Documents. L'écran
    // annonce l'attente ; la route, elle, ne doit pas échouer.
    const reponse = await request(app)
      .get('/api/v2/comptes/candidats?role=stagiaire')
      .set('Cookie', cookiesDirecteur);

    expect(reponse.status).toBe(200);
    expect(reponse.body.personnes).toEqual([]);
  });

  it('garantit UN stagiaire par matricule — la priorité TS/FQ revient à l\'import', async () => {
    /*
     * ⚠️ Différence de modèle assumée avec MySQL, découverte en écrivant ce test.
     *
     * `stagiaires` portait une ligne par groupe suivi (1 671 lignes pour ~995
     * personnes), et `create_user_account.php:88-100` choisissait la ligne
     * diplômante au moment de créer le compte. Le modèle Mongo pose un index
     * UNIQUE sur (établissement, année, matricule) : le doublon ne peut plus exister,
     * donc le choix se fait à l'écriture — dans l'import Konosys, à porter.
     *
     * Ce test fige la contrainte pour que ce choix ne se perde pas : si l'index
     * disparaissait, la règle FQ devrait revenir dans `candidatsStagiaires`.
     */
    const ligne = {
      etablissementId: etablissement.id,
      anneeScolaire: 2026,
      matricule: 'S001',
      nom: 'BENANI',
      prenom: 'Salma',
    };

    await Stagiaire.create({ ...ligne, niveau: 'TS', email: 'ts@ofppt.ma' });
    await expect(
      Stagiaire.create({ ...ligne, niveau: 'FQ', email: 'fq@ofppt.ma' })
    ).rejects.toThrow(/duplicate key/i);

    const reponse = await request(app)
      .get('/api/v2/comptes/candidats?role=stagiaire')
      .set('Cookie', cookiesDirecteur);

    expect(reponse.body.personnes).toEqual([
      { identifiant: 'S001', nomComplet: 'BENANI Salma', email: 'ts@ofppt.ma', aDejaUnCompte: false },
    ]);
  });

  it("accepte une ADRESSE comme identifiant — le cas du gestionnaire", async () => {
    /*
     * ⚠️ Ce test manquait, et c'est ce qui a laissé passer le défaut.
     *
     * Un gestionnaire n'a pas de matricule : `create_user_account.php:54` posait
     * `login = email`. Le motif d'identifiant, taillé pour des matricules,
     * refusait l'arobase — toute création de gestionnaire échouait sur
     * « Lettres, chiffres, point, tiret et souligné uniquement », en pointant un
     * champ dont l'utilisateur ne voyait même pas qu'il était en cause.
     *
     * Les tests existants ne créaient que des formateurs, dont l'identifiant est
     * un nombre : ils ne pouvaient pas voir le cas.
     */
    const reponse = await request(app)
      .post('/api/v2/comptes')
      .set('Cookie', cookiesDirecteur)
      .send({
        nomComplet: 'MOUAD NOUZRI',
        role: ROLES.GESTIONNAIRE,
        identifiant: 'mouadnouzri17@gmail.com',
        email: 'mouadnouzri17@gmail.com',
        motDePasse: 'Gestionnaire2026',
      });

    expect(reponse.status).toBe(201);
    expect(reponse.body.compte.identifiant).toBe('mouadnouzri17@gmail.com');

    // Et il se connecte réellement avec cette adresse.
    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: 'mouadnouzri17@gmail.com', motDePasse: 'Gestionnaire2026' });

    expect(connexion.status).toBe(200);
  });

  it('renvoie l’année sur laquelle la liste a été cherchée', async () => {
    // Une liste vide veut presque toujours dire « mauvaise année », pas « aucun
    // formateur » : l'écran doit pouvoir le dire, donc le serveur doit l'envoyer.
    const reponse = await request(app)
      .get('/api/v2/comptes/candidats?role=formateur')
      .set('Cookie', cookiesDirecteur)
      .set('X-Annee-Scolaire', '2027');

    expect(reponse.body.anneeScolaire).toBe(2027);
    expect(reponse.body.personnes).toEqual([]);
  });

  it('reste interdit à un formateur', async () => {
    await request(app)
      .post('/api/v2/comptes')
      .set('Cookie', cookiesDirecteur)
      .send(nouveauFormateur);

    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: '9863', motDePasse: 'Formateur2026' });

    const reponse = await request(app)
      .get('/api/v2/comptes/candidats?role=formateur')
      .set('Cookie', connexion.headers['set-cookie']);

    expect(reponse.status).toBe(403);
  });
});
