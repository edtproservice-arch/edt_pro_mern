import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Stagiaire } from '../../src/models/Stagiaire.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Import Konosys — la base des stagiaires (F11).
 * ← api/students/upload.php, appelé depuis canvas.html
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;

let directeur;
let etablissement;
let cookies;

const ENTETES = [
  'MatriculeEtudiant',
  'Nom',
  'Prenom',
  'Nom_Arabe',
  'Prenom_arabe',
  'CIN',
  'DateNaissance',
  'CodeDiplome',
  'Site',
  'LibelleLong',
];

/** Classeur Konosys : la PREMIÈRE feuille, en-têtes en ligne 1. */
async function classeurKonosys(lignes) {
  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet('Etudiants');
  feuille.addRow(ENTETES);
  for (const ligne of lignes) feuille.addRow(ENTETES.map((entete) => ligne[entete] ?? ''));
  return Buffer.from(await classeur.xlsx.writeBuffer());
}

const stagiaire = (surcharges = {}) => ({
  MatriculeEtudiant: 'S001',
  Nom: 'BENANI',
  Prenom: 'Salma',
  Nom_Arabe: 'بناني',
  Prenom_arabe: 'سلمى',
  CIN: 'BE12345',
  DateNaissance: '2004-03-12',
  CodeDiplome: 'DEVOWFS201',
  Site: 'CASABLANCA',
  LibelleLong: 'ISTA_NTIC_TS-Développement Digital (2A)',
  ...surcharges,
});

/** Importe dans l'année active, ou dans `annee` quand elle est donnée. */
async function importer(lignes, annee = null) {
  const requete = request(app).post('/api/v2/stagiaires/import').set('Cookie', cookies);
  if (annee) requete.set('X-Annee-Scolaire', String(annee));
  return requete.attach('fichier', await classeurKonosys(lignes), 'konosys.xlsx');
}

const creerCompte = (matricule) =>
  request(app)
    .post('/api/v2/comptes')
    .set('Cookie', cookies)
    .send({
      nomComplet: `Stagiaire ${matricule}`,
      role: ROLES.STAGIAIRE,
      identifiant: matricule,
      motDePasse: 'Stagiaire2026',
    });

beforeEach(async () => {
  directeur = await User.create({
    nomComplet: 'Directeur Konosys',
    email: 'directeur@edtpro.ma',
    motDePasse: MOT_DE_PASSE,
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });

  etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Casablanca-Settat',
    complexe: 'CF NTIC',
    nom: "ISTA BEN M'SIK",
    anneeScolaire: ANNEE,
  });

  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookies = connexion.headers['set-cookie'];
});

describe('Import Konosys', () => {
  it('importe les stagiaires et décompose LibelleLong', async () => {
    const reponse = await importer([stagiaire()]);

    expect(reponse.status).toBe(200);
    expect(reponse.body.importes).toBe(1);

    const enregistre = await Stagiaire.findOne({ matricule: 'S001' });
    expect(enregistre).toMatchObject({
      nom: 'BENANI',
      prenom: 'Salma',
      nomArabe: 'بناني',
      niveau: 'TS',
      annee: '2A',
      filiere: 'Développement Digital',
      groupePrincipal: 'DEVOWFS201',
      // ⚠️ Konosys ne fournit pas d'adresse : elle est fabriquée.
      email: 's001@ofppt-edu.ma',
    });
    expect(enregistre.groupes).toEqual(['DEVOWFS201']);
    expect(enregistre.anneeScolaire).toBe(ANNEE);
  });

  it('REGROUPE les deux inscriptions d’un même stagiaire', async () => {
    // Konosys rend une ligne par inscription ; l'index unique impose un
    // document par personne. Sans regroupement, l'import échouerait en doublon.
    const reponse = await importer([
      stagiaire(),
      stagiaire({
        CodeDiplome: 'ACADA101 (FQ)',
        LibelleLong: 'CFP_HAY_FQ-Anglais professionnel (1A)',
      }),
    ]);

    expect(reponse.body.importes).toBe(1);

    const enregistre = await Stagiaire.findOne({ matricule: 'S001' });
    expect(enregistre.groupes).toEqual(['DEVOWFS201', 'ACADA101 (FQ)']);
    // La ligne diplômante garde l'identité scolaire.
    expect(enregistre.niveau).toBe('TS');
    expect(enregistre.groupePrincipal).toBe('DEVOWFS201');
  });

  it('REMPLACE la base précédente de la même année', async () => {
    await importer([stagiaire(), stagiaire({ MatriculeEtudiant: 'S002', Nom: 'ALAMI' })]);
    const reponse = await importer([stagiaire({ MatriculeEtudiant: 'S003', Nom: 'TAZI' })]);

    expect(reponse.body.remplaces).toBe(2);
    expect(reponse.body.anneeScolaire).toBe(ANNEE);
    const restants = await Stagiaire.find({ etablissementId: etablissement.id });
    expect(restants.map((s) => s.matricule)).toEqual(['S003']);
  });

  /*
   * ═══ UNE BASE PAR ANNÉE SCOLAIRE ═══ (décision du porteur, 2026-09-14)
   * Importer l'année suivante ne touche pas la base de l'année en cours ; seul
   * un nouvel import de la MÊME année l'écrase.
   */
  it('garde une base par année : importer une autre année ne touche pas la précédente', async () => {
    await importer([stagiaire(), stagiaire({ MatriculeEtudiant: 'S002', Nom: 'ALAMI' })]);
    const suivante = await importer([stagiaire({ MatriculeEtudiant: 'S003', Nom: 'TAZI' })], ANNEE + 1);

    expect(suivante.status).toBe(200);
    expect(suivante.body.remplaces).toBe(0);
    expect(await Stagiaire.countDocuments({ etablissementId: etablissement.id, anneeScolaire: ANNEE })).toBe(2);
    expect(await Stagiaire.countDocuments({ etablissementId: etablissement.id, anneeScolaire: ANNEE + 1 })).toBe(1);

    // Réimporter l'année en cours n'écrase QUE la sienne.
    await importer([stagiaire({ MatriculeEtudiant: 'S004', Nom: 'IDRISSI' })]);
    const parAnnee = await Stagiaire.find({ etablissementId: etablissement.id }).sort({ anneeScolaire: 1 });
    expect(parAnnee.map((s) => [s.anneeScolaire, s.matricule])).toEqual([
      [ANNEE, 'S004'],
      [ANNEE + 1, 'S003'],
    ]);
  });

  it('accepte le même stagiaire dans deux années (1re puis 2e année)', async () => {
    // L'année entre dans la clé unique : sans elle, la seconde base heurterait
    // la première sur le matricule.
    await importer([stagiaire()]);
    const reponse = await importer([stagiaire({ LibelleLong: 'ISTA_NTIC_TS-Développement Digital (2A)' })], ANNEE + 1);

    expect(reponse.status).toBe(200);
    expect(await Stagiaire.countDocuments({ matricule: 'S001' })).toBe(2);
  });

  it("lit la base de l'année affichée, et dit si une plus récente existe", async () => {
    await importer([stagiaire(), stagiaire({ MatriculeEtudiant: 'S002', Nom: 'ALAMI' })]);
    await importer([stagiaire({ MatriculeEtudiant: 'S003', Nom: 'TAZI' })], ANNEE + 1);

    const enCours = await request(app).get('/api/v2/stagiaires/statistiques').set('Cookie', cookies);
    expect(enCours.body).toMatchObject({ total: 2, anneeScolaire: ANNEE, anneePlusRecente: ANNEE + 1 });
    expect(enCours.body.importeLe).not.toBeNull();

    const suivante = await request(app)
      .get('/api/v2/stagiaires/statistiques')
      .set('Cookie', cookies)
      .set('X-Annee-Scolaire', String(ANNEE + 1));
    expect(suivante.body).toMatchObject({ total: 1, anneeScolaire: ANNEE + 1, anneePlusRecente: null });

    const liste = await request(app)
      .get('/api/v2/stagiaires')
      .set('Cookie', cookies)
      .set('X-Annee-Scolaire', String(ANNEE + 1));
    expect(liste.body.stagiaires.map((s) => s.matricule)).toEqual(['S003']);

    // Une année sans base : rien, et pas la base d'une autre année.
    const vide = await request(app)
      .get('/api/v2/stagiaires/statistiques')
      .set('Cookie', cookies)
      .set('X-Annee-Scolaire', String(ANNEE - 1));
    // La PLUS récente de toutes — celle qui fait foi pour les comptes.
    expect(vide.body).toMatchObject({ total: 0, importeLe: null, anneePlusRecente: ANNEE + 1 });
  });

  it('ne supprime aucun compte en réimportant une année qui n’est pas la plus récente', async () => {
    // Décision du porteur (2026-09-14) : les comptes suivent la base la plus
    // récente. Reprendre une année passée ne doit supprimer personne.
    await importer([stagiaire(), stagiaire({ MatriculeEtudiant: 'S002', Nom: 'ALAMI' })], ANNEE + 1);
    await creerCompte('S001');
    await creerCompte('S002');

    const passee = await importer([stagiaire()]);
    expect(passee.body.comptes).toEqual({ synchronises: false, anneePlusRecente: ANNEE + 1 });
    expect(await User.findOne({ identifiant: 'S002' })).not.toBeNull();

    // La base la plus récente, elle, fait foi : S002 en est absent → supprimé.
    const recente = await importer([stagiaire()], ANNEE + 1);
    expect(recente.body.comptes).toMatchObject({ synchronises: true, supprimes: 1 });
    expect(await User.findOne({ identifiant: 'S002' })).toBeNull();
  });

  it('SUPPRIME les comptes des stagiaires absents du fichier', async () => {
    /*
     * Comportement conservé à l'identique (décision du 2026-08-19), malgré le
     * risque exposé : un export partiel efface les comptes des autres. Ce qui
     * change, c'est que le nombre est RENVOYÉ — l'existant le taisait.
     */
    await importer([stagiaire(), stagiaire({ MatriculeEtudiant: 'S002', Nom: 'ALAMI' })]);

    for (const matricule of ['S001', 'S002']) await creerCompte(matricule);

    const reponse = await importer([stagiaire()]);

    expect(reponse.body.comptes.synchronises).toBe(true);
    expect(reponse.body.comptes.supprimes).toBe(1);
    expect(reponse.body.comptes.conserves).toBe(1);
    expect(await User.findOne({ identifiant: 'S002' })).toBeNull();
    expect(await User.findOne({ identifiant: 'S001' })).not.toBeNull();
  });

  it('met à jour le NOM d’un compte conservé', async () => {
    await importer([stagiaire()]);
    await request(app)
      .post('/api/v2/comptes')
      .set('Cookie', cookies)
      .send({
        nomComplet: 'BENANI Salma',
        role: ROLES.STAGIAIRE,
        identifiant: 'S001',
        motDePasse: 'Stagiaire2026',
      });

    const reponse = await importer([stagiaire({ Nom: 'BENANI-IDRISSI' })]);

    expect(reponse.body.comptes.misAJour).toBe(1);
    expect((await User.findOne({ identifiant: 'S001' })).nomComplet).toBe('BENANI-IDRISSI Salma');
  });

  it('compte les lignes sans matricule au lieu de les taire', async () => {
    const reponse = await importer([stagiaire(), stagiaire({ MatriculeEtudiant: '' })]);

    expect(reponse.body.importes).toBe(1);
    expect(reponse.body.lignesIgnorees).toBe(1);
  });

  it('refuse un fichier sans aucun matricule', async () => {
    const reponse = await importer([stagiaire({ MatriculeEtudiant: '' })]);

    expect(reponse.status).toBe(400);
    expect(reponse.body.message).toMatch(/MatriculeEtudiant/);
  });

  it('accepte un vrai fichier .xls (BIFF8, Excel 97-2003)', async () => {
    /*
     * ⚠️ Le fichier est réellement écrit en BIFF par SheetJS — pas un .xlsx
     * renommé. `exceljs` ne sait pas le lire : si le service retombait sur lui,
     * ce test échouerait, ce qui est précisément le garde-fou recherché.
     */
    const classeur = XLSX.utils.book_new();
    const feuille = XLSX.utils.aoa_to_sheet([
      ENTETES,
      ENTETES.map((entete) => stagiaire()[entete] ?? ''),
    ]);
    XLSX.utils.book_append_sheet(classeur, feuille, 'Etudiants');
    const binaire = XLSX.write(classeur, { type: 'buffer', bookType: 'xls' });

    const reponse = await request(app)
      .post('/api/v2/stagiaires/import')
      .set('Cookie', cookies)
      .attach('fichier', binaire, 'konosys.xls');

    expect(reponse.status).toBe(200);
    expect(reponse.body.importes).toBe(1);

    const enregistre = await Stagiaire.findOne({ matricule: 'S001' });
    // Les mêmes règles s'appliquent : le format ne change rien au métier.
    expect(enregistre).toMatchObject({ nom: 'BENANI', niveau: 'TS', filiere: 'Développement Digital' });
  });

  it('refuse une extension qui n’est ni .xlsx ni .xls', async () => {
    const reponse = await request(app)
      .post('/api/v2/stagiaires/import')
      .set('Cookie', cookies)
      .attach('fichier', await classeurKonosys([stagiaire()]), 'konosys.csv');

    expect(reponse.status).toBe(400);
  });

  it('alimente les filtres en cascade', async () => {
    await importer([
      stagiaire(),
      stagiaire({
        MatriculeEtudiant: 'S002',
        Nom: 'ALAMI',
        CodeDiplome: 'GESTA101',
        LibelleLong: 'CFP_HAY_T-Gestion des Entreprises (1A)',
      }),
    ]);

    const tous = await request(app).get('/api/v2/stagiaires/filtres').set('Cookie', cookies);
    expect(tous.body.niveaux).toEqual(['T', 'TS']);
    expect(tous.body.total).toBe(2);

    // La cascade se resserre : choisir « TS » ne doit plus proposer la filière
    // de gestion, sinon la combinaison rendrait une liste vide sans raison.
    const auNiveau = await request(app)
      .get('/api/v2/stagiaires/filtres?niveau=TS')
      .set('Cookie', cookies);
    expect(auNiveau.body.filieres).toEqual(['Développement Digital']);
  });

  it('filtre la liste par groupe, y compris un groupe FQ', async () => {
    await importer([
      stagiaire(),
      stagiaire({
        CodeDiplome: 'ACADA101 (FQ)',
        LibelleLong: 'CFP_HAY_FQ-Anglais professionnel (1A)',
      }),
      stagiaire({ MatriculeEtudiant: 'S002', Nom: 'ALAMI', CodeDiplome: 'GESTA101' }),
    ]);

    const reponse = await request(app)
      .get('/api/v2/stagiaires?groupe=ACADA101 (FQ)')
      .set('Cookie', cookies);

    // Le filtre porte sur le TABLEAU : le stagiaire y figure par sa seconde
    // inscription, alors que son groupe principal est ailleurs.
    expect(reponse.body.stagiaires).toHaveLength(1);
    expect(reponse.body.stagiaires[0].matricule).toBe('S001');
  });

  it("n'expose pas les stagiaires d'un autre établissement", async () => {
    const autre = await Etablissement.create({
      proprietaireId: directeur.id,
      region: 'Fès-Meknès',
      complexe: 'CF Voisin',
      nom: 'ISTA Voisin',
      anneeScolaire: ANNEE,
    });

    await Stagiaire.create({
      etablissementId: autre.id,
      anneeScolaire: ANNEE,
      matricule: 'X999',
      nom: 'VOISIN',
      prenom: 'Test',
    });

    await importer([stagiaire()]);

    const reponse = await request(app).get('/api/v2/stagiaires').set('Cookie', cookies);
    expect(reponse.body.stagiaires.map((s) => s.matricule)).toEqual(['S001']);

    // Et le remplacement ne touche PAS la base du voisin.
    expect(await Stagiaire.findOne({ matricule: 'X999' })).not.toBeNull();
  });

  it('compte les effectifs par filière et par groupe, sans double-compter les personnes', async () => {
    /*
     * ⚠️ LE TOTAL N'EST PAS LA SOMME DES GROUPES. Un stagiaire inscrit dans un
     * tronc ET un module FQ appartient à deux groupes : il pèse dans chacun,
     * mais c'est UNE personne. Additionner les groupes ferait annoncer plus de
     * stagiaires que l'établissement n'en a — un chiffre aussitôt contesté.
     */
    await importer([
      stagiaire(),
      stagiaire({ CodeDiplome: 'ACADA101 (FQ)', LibelleLong: 'CFP_HAY_FQ-Anglais (1A)' }),
      stagiaire({ MatriculeEtudiant: 'S002', Nom: 'ALAMI' }),
    ]);

    const reponse = await request(app)
      .get('/api/v2/stagiaires/statistiques')
      .set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(reponse.body.total).toBe(2); // deux personnes…
    expect(reponse.body.nombreGroupes).toBe(2); // …dans deux groupes

    // La filière retenue est celle du groupe DIPLÔMANT : l'inscription FQ
    // apparaît donc sous la filière réelle, ce qu'on veut sur un imprimé.
    expect(reponse.body.filieres).toHaveLength(1);
    const [filiere] = reponse.body.filieres;
    expect(filiere.nom).toBe('Développement Digital');
    expect(filiere.inscriptions).toBe(3); // 2 + 1 : des INSCRIPTIONS, pas des personnes
    expect(filiere.groupes).toEqual([
      { nom: 'ACADA101 (FQ)', total: 1 },
      { nom: 'DEVOWFS201', total: 2 },
    ]);
  });

  it('alimente la création de comptes de la page Sessions', async () => {
    /*
     * C'est la raison d'être de l'enchaînement : sans import Konosys, l'onglet
     * « Stagiaire » de Sessions n'a rien à lister. Ce test parcourt la chaîne
     * complète — import, candidats, création en lot — parce que c'est elle qui
     * casse quand une des trois pièces bouge.
     */
    await importer([
      stagiaire(),
      stagiaire({ MatriculeEtudiant: 'S002', Nom: 'ALAMI', Prenom: 'Youssef' }),
      // Deux lignes pour la même personne : elle ne doit apparaître QU'UNE fois
      // dans les candidats, sans quoi la création échouerait en doublon.
      stagiaire({ CodeDiplome: 'ACADA101 (FQ)', LibelleLong: 'CFP_HAY_FQ-Anglais (1A)' }),
    ]);

    const candidats = await request(app)
      .get('/api/v2/comptes/candidats?role=stagiaire')
      .set('Cookie', cookies);

    expect(candidats.body.personnes).toHaveLength(2);
    expect(candidats.body.personnes.map((p) => p.identifiant).sort()).toEqual(['S001', 'S002']);
    expect(candidats.body.personnes.every((p) => p.aDejaUnCompte === false)).toBe(true);

    const creation = await request(app)
      .post('/api/v2/comptes/lot')
      .set('Cookie', cookies)
      .send({
        role: ROLES.STAGIAIRE,
        matricules: ['S001', 'S002'],
        motDePasse: 'Stagiaire2026',
      });

    expect(creation.body.crees).toHaveLength(2);
    expect(creation.body.echecs).toEqual([]);

    // Le login est le MATRICULE, et l'adresse celle fabriquée à l'import.
    const compte = await User.findOne({ identifiant: 'S001' });
    expect(compte.role).toBe(ROLES.STAGIAIRE);
    expect(compte.email).toBe('s001@ofppt-edu.ma');

    // Et il se connecte réellement avec son matricule.
    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: 'S001', motDePasse: 'Stagiaire2026' });
    expect(connexion.status).toBe(200);

    // La liste des candidats les signale désormais comme servis.
    const apres = await request(app)
      .get('/api/v2/comptes/candidats?role=stagiaire')
      .set('Cookie', cookies);
    expect(apres.body.personnes.every((p) => p.aDejaUnCompte)).toBe(true);
  });

  it("interdit l'import à un formateur", async () => {
    await request(app)
      .post('/api/v2/comptes')
      .set('Cookie', cookies)
      .send({
        nomComplet: 'Formateur Test',
        role: ROLES.FORMATEUR,
        identifiant: '9863',
        motDePasse: 'Formateur2026',
      });

    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: '9863', motDePasse: 'Formateur2026' });

    const reponse = await request(app)
      .post('/api/v2/stagiaires/import')
      .set('Cookie', connexion.headers['set-cookie'])
      .attach('fichier', await classeurKonosys([stagiaire()]), 'konosys.xlsx');

    expect(reponse.status).toBe(403);
  });
});
