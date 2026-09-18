import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { EnoteImport } from '../../src/models/EnoteImport.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';

let etablissement;
let cookies;

/**
 * Fabrique un classeur au format e-note : 51 colonnes, dont les 14 que
 * l'import lit réellement.
 */
async function classeurEnote(lignes, { avecEntete = true } = {}) {
  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet('Avancement');

  if (avecEntete) {
    const entete = new Array(51).fill('');
    entete[4] = 'Code Filière';
    entete[8] = 'Groupe';
    entete[12] = 'FusionGroupe';
    entete[16] = 'Code Module';
    entete[19] = 'Mle Affecté Présentiel Actif';
    entete[20] = 'Formateur Affecté Présentiel Actif';
    feuille.addRow(entete);
  }

  for (const ligne of lignes) feuille.addRow(ligne);

  return Buffer.from(await classeur.xlsx.writeBuffer());
}

/** Ligne e-note minimale, colonnes placées à leurs index réels. */
function ligneEnote({
  codeFiliere = 'DEVOWFS_S',
  groupe = 'DEV101',
  fusion = '',
  mode = 'RES',
  module = 'M101',
  matricule = '9863',
  formateur = 'AHMED CHERKAOUI',
  partS1 = '30',
  partS2 = '30',
  mhp = '60',
} = {}) {
  const ligne = new Array(51).fill('');
  ligne[4] = codeFiliere;
  ligne[8] = groupe;
  ligne[12] = fusion;
  ligne[15] = mode;
  ligne[16] = module;
  ligne[19] = matricule;
  ligne[20] = formateur;
  ligne[23] = partS1;
  ligne[27] = partS2;
  ligne[35] = mhp;
  return ligne;
}

beforeEach(async () => {
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
    anneeScolaire: 2026,
  });

  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookies = connexion.headers['set-cookie'];
});

describe('Import e-note', () => {
  it('lit le classeur, construit la base et trace l\'import', async () => {
    const fichier = await classeurEnote([
      ligneEnote(),
      ligneEnote({ groupe: 'DEV102', module: 'M102' }),
    ]);

    const reponse = await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', fichier, 'AvancementProgramme2026.xlsx');

    expect(reponse.status).toBe(201);
    expect(reponse.body.effectifs).toMatchObject({ formateurs: 1, groupes: 2, affectations: 2 });

    const base = await Base.findOne({ etablissementId: etablissement.id, anneeScolaire: 2026 });
    expect(base.groupes).toEqual(['DEV101', 'DEV102']);
    expect(base.affectations[0].formateur).toBe('9863');

    // La trace conserve le fichier tel qu'importé : c'est la source de
    // l'avancement (F7).
    const trace = await EnoteImport.findOne({ etablissementId: etablissement.id });
    expect(trace.nomFichier).toBe('AvancementProgramme2026.xlsx');
    expect(trace.lignes).toHaveLength(2);
  });

  it('signale les formateurs dont la masse horaire est déduite', async () => {
    const fichier = await classeurEnote([ligneEnote()]);

    const reponse = await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', fichier, 'base.xlsx');

    // 60 h affectées, aucune masse saisie : la valeur est déduite et doit être
    // vérifiée par l'établissement.
    expect(reponse.body.nouveauxFormateurs).toEqual([
      { matricule: '9863', nomComplet: 'AHMED CHERKAOUI', masseHoraire: 60 },
    ]);
  });

  it("n'écrase pas une masse horaire déjà corrigée lors d'un réimport", async () => {
    const fichier = await classeurEnote([ligneEnote()]);
    await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', fichier, 'base.xlsx');

    await request(app)
      .patch('/api/v2/base/formateurs/masse-horaire')
      .set('Cookie', cookies)
      .send({ matricule: '9863', masseHoraire: 910 });

    const reimport = await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      /* Même semaine : le remplacement doit être explicite. */
      .field('remplacer', 'true')
      .attach('fichier', fichier, 'base.xlsx');

    // La correction de l'établissement fait foi sur la valeur déduite.
    expect(reimport.body.nouveauxFormateurs).toEqual([]);

    const base = await Base.findOne({ etablissementId: etablissement.id });
    expect(base.formateurs[0].masseHoraire).toBe(910);
  });

  it('remplace la base au réimport, sans accumuler', async () => {
    await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', await classeurEnote([ligneEnote()]), 'base.xlsx');

    await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      /* ⚠️ MÊME SEMAINE : sans ce drapeau, le second dépôt est refusé — cf. la
         règle « une seule base e-note par semaine » ci-dessous. */
      .field('remplacer', 'true')
      .attach('fichier', await classeurEnote([ligneEnote({ groupe: 'GE201' })]), 'base.xlsx');

    const bases = await Base.find({ etablissementId: etablissement.id, anneeScolaire: 2026 });
    expect(bases).toHaveLength(1);
    expect(bases[0].groupes).toEqual(['GE201']);

    /*
     * ⚠️ UNE SEULE TRACE POUR LA SEMAINE — révision de la décision du
     * 2026-08-16 (« les traces s'accumulent, c'est l'historique »). Elles
     * s'accumulent toujours d'une SEMAINE à l'autre ; à l'intérieur d'une même
     * semaine, le remplacement en laisse une seule, faute de quoi la frise
     * chronologique porterait deux états pour un même point.
     */
    expect(await EnoteImport.countDocuments()).toBe(1);
  });

  /*
   * ═══ ⚠️⚠️ UNE SEULE BASE E-NOTE PAR SEMAINE ═══ (règle du porteur,
   * 2026-09-01.) C'est elle qui donne son sens à la frise : un point par
   * semaine, un état déclaré par semaine.
   */
  it('REFUSE un second import la même semaine, et ne touche à rien', async () => {
    await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', await classeurEnote([ligneEnote()]), 'premier.xlsx');

    const refus = await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', await classeurEnote([ligneEnote({ groupe: 'GE201' })]), 'second.xlsx');

    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('IMPORT_HEBDOMADAIRE');
    // Le refus NOMME le fichier en place : sans lui, on ne sait pas quoi remplacer.
    expect(refus.body.details.nomFichier).toBe('premier.xlsx');

    // Et rien n'a bougé — ni la base, ni l'historique.
    const base = await Base.findOne({ etablissementId: etablissement.id, anneeScolaire: 2026 });
    expect(base.groupes).toEqual(['DEV101']);
    expect(await EnoteImport.countDocuments()).toBe(1);
  });

  /*
   * ⚠️ MAIS ON N'ENFERME PAS L'ÉTABLISSEMENT : refuser sèchement bloquerait une
   * semaine entière sur un mauvais fichier — et c'est dans les minutes qui
   * suivent un import qu'on s'aperçoit de l'erreur.
   */
  it('accepte le remplacement explicite, et DIT ce qu’il a remplacé', async () => {
    await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', await classeurEnote([ligneEnote()]), 'premier.xlsx');

    const reponse = await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .field('remplacer', 'true')
      .attach('fichier', await classeurEnote([ligneEnote({ groupe: 'GE201' })]), 'second.xlsx');

    expect(reponse.status).toBe(201);
    // Une suppression muette laisserait croire que les deux fichiers cohabitent.
    expect(reponse.body.remplace.nomFichier).toBe('premier.xlsx');

    const traces = await EnoteImport.find({ etablissementId: etablissement.id }).lean();
    expect(traces).toHaveLength(1);
    expect(traces[0].nomFichier).toBe('second.xlsx');
  });

  /*
   * ⚠️ « false » EST UNE CHAÎNE, ET UNE CHAÎNE NON VIDE EST VRAIE. Comparer le
   * champ multipart sans le rapporter à « true » ferait passer un refus attendu
   * pour un remplacement — et détruirait la base de la semaine.
   */
  it('ne prend pas « false » pour un remplacement', async () => {
    await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', await classeurEnote([ligneEnote()]), 'premier.xlsx');

    const refus = await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .field('remplacer', 'false')
      .attach('fichier', await classeurEnote([ligneEnote({ groupe: 'GE201' })]), 'second.xlsx');

    expect(refus.status).toBe(409);
    expect(await EnoteImport.countDocuments()).toBe(1);
  });

  it('lit un fichier sans ligne d\'en-tête', async () => {
    const fichier = await classeurEnote([ligneEnote()], { avecEntete: false });

    const reponse = await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', fichier, 'base.xlsx');

    // Les index de colonnes prennent le relais quand l'en-tête manque.
    expect(reponse.status).toBe(201);
    expect(reponse.body.effectifs.groupes).toBe(1);
  });
});

describe('Import e-note — refus', () => {
  it("ACCEPTE l'ancien format .xls (BIFF8, Excel 97-2003)", async () => {
    /*
     * Le refus datait de ce qu'`exceljs` ne lit que l'OOXML. L'interface
     * d'origine acceptait le .xls, et e-note peut encore l'exporter : le
     * refuser était une régression. C'est SheetJS qui prend le relais pour ce
     * format seul (`lib/classeur`).
     *
     * ⚠️ Le fichier est réellement écrit en BIFF, pas un .xlsx renommé : si le
     * service retombait sur `exceljs`, ce test échouerait.
     */
    const entete = new Array(51).fill('');
    entete[4] = 'Code Filière';
    entete[8] = 'Groupe';
    entete[16] = 'Code Module';
    entete[20] = 'Formateur Affecté Présentiel Actif';

    const classeur = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      classeur,
      XLSX.utils.aoa_to_sheet([entete, ligneEnote()]),
      'Avancement'
    );

    const reponse = await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', XLSX.write(classeur, { type: 'buffer', bookType: 'xls' }), 'base.xls');

    expect(reponse.status).toBe(201);
    expect(reponse.body.effectifs.groupes).toBe(1);
  });

  it("refuse une extension qui n'est ni .xlsx ni .xls", async () => {
    const reponse = await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', Buffer.from('peu importe'), 'base.csv');

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('FORMAT_REFUSE');
  });

  it('refuse un fichier qui n\'est pas un classeur', async () => {
    const reponse = await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', Buffer.from('ceci est du texte'), 'base.xlsx');

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('FICHIER_ILLISIBLE');
  });

  it('refuse un classeur qui ne ressemble pas à une base e-note', async () => {
    const classeur = new ExcelJS.Workbook();
    const feuille = classeur.addWorksheet('Autre');
    feuille.addRow(['Nom', 'Prénom']);
    feuille.addRow(['Dupont', 'Jean']);

    const reponse = await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', Buffer.from(await classeur.xlsx.writeBuffer()), 'liste.xlsx');

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('FICHIER_NON_RECONNU');
  });

  it('refuse un import sans fichier', async () => {
    const reponse = await request(app).post('/api/v2/base/import').set('Cookie', cookies);

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('FICHIER_ABSENT');
  });
});

describe('Consultation de la base', () => {
  it("renvoie null tant que rien n'est importé — ce n'est pas une erreur", async () => {
    const reponse = await request(app).get('/api/v2/base').set('Cookie', cookies);

    // L'existant renvoyait une erreur HTTP dans ce cas, remplissant la console
    // du navigateur alors qu'il ne se passait rien d'anormal.
    expect(reponse.status).toBe(200);
    expect(reponse.body.base).toBeNull();
  });

  it('renvoie un résumé chiffré', async () => {
    await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', await classeurEnote([ligneEnote()]), 'base.xlsx');

    const reponse = await request(app).get('/api/v2/base/resume').set('Cookie', cookies);

    expect(reponse.body.resume).toMatchObject({ existe: true, formateurs: 1, groupes: 1 });
  });

  it("liste l'historique des imports", async () => {
    await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', await classeurEnote([ligneEnote()]), 'premier.xlsx');

    const reponse = await request(app).get('/api/v2/base/imports').set('Cookie', cookies);

    expect(reponse.body.imports).toHaveLength(1);
    expect(reponse.body.imports[0].nomFichier).toBe('premier.xlsx');
  });

  it('interdit l\'accès à un formateur', async () => {
    await User.create({
      nomComplet: 'Formateur Test',
      email: 'formateur@edtpro.ma',
      identifiant: '9863',
      motDePasse: MOT_DE_PASSE,
      role: ROLES.FORMATEUR,
      statut: STATUTS_COMPTE.APPROUVE,
      estVerifie: true,
      etablissementIds: [etablissement.id],
    });

    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: '9863', motDePasse: MOT_DE_PASSE });

    const reponse = await request(app)
      .get('/api/v2/base')
      .set('Cookie', connexion.headers['set-cookie']);

    expect(reponse.status).toBe(403);
  });
});
