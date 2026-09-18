import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { EnoteImport } from '../../src/models/EnoteImport.js';
import { Repartition } from '../../src/models/Repartition.js';
import { Stagiaire } from '../../src/models/Stagiaire.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Carte d'établissement construite à la main (F3, voie « sans fichier e-note »).
 * ← api/data/get_repartitions.php + api/profile/save_affectations.php
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;

let etablissement;
let cookies;

function ligneDrif(surcharges = {}) {
  return {
    secteur: 'Digital',
    niveauFormation: 'TS',
    typeFormation: 'Diplômante',
    creneau: 'CDJ',
    codeFiliereDrif: 'DEVOWFS_S',
    intituleFiliere: 'Développement Full Stack',
    codeFiliereCarte: 'DEVOWFS_S',
    filiere: 'Développement Full Stack',
    anneeFormation: 2,
    codeModule: 'M201',
    module: 'Programmation',
    mhpS1: 30,
    mhpS2: 30,
    mhpTotale: 60,
    efmRegional: false,
    metier: 'développement',
    ...surcharges,
  };
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
    anneeScolaire: ANNEE,
  });

  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  await Repartition.create([
    ligneDrif(),
    ligneDrif({ codeModule: 'M202', module: 'Base de données', efmRegional: true }),
    ligneDrif({ anneeFormation: 1, codeModule: 'M101', module: 'Algorithmique' }),
    ligneDrif({
      secteur: 'Génie électrique',
      codeFiliereDrif: 'GE_GE_TS',
      intituleFiliere: 'Génie électrique',
      creneau: 'CDS',
      codeModule: 'M210',
      module: 'Électrotechnique',
    }),
  ]);

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookies = connexion.headers['set-cookie'];
});

describe('Cascade de la répartition DRIF', () => {
  it('descend secteur → niveau → année → filière → modules', async () => {
    const secteurs = await request(app).get('/api/v2/repartitions/secteurs').set('Cookie', cookies);
    expect(secteurs.body.secteurs).toEqual(['Digital', 'Génie électrique']);

    const annees = await request(app)
      .get('/api/v2/repartitions/annees?secteur=Digital&niveau=TS')
      .set('Cookie', cookies);
    expect(annees.body.annees).toEqual([1, 2]);

    const filieres = await request(app)
      .get('/api/v2/repartitions/filieres?secteur=Digital&niveau=TS&annee=2')
      .set('Cookie', cookies);
    expect(filieres.body.filieres).toEqual([
      expect.objectContaining({ code: 'DEVOWFS_S', modules: 2 }),
    ]);

    const modules = await request(app)
      .get('/api/v2/repartitions/modules?filiere=DEVOWFS_S&annee=2')
      .set('Cookie', cookies);
    expect(modules.body.modules.map((m) => m.code)).toEqual(['M201', 'M202']);
    expect(modules.body.modules[1].estRegional).toBe(true);
    expect(modules.body.filiere).toMatchObject({ secteur: 'Digital', niveau: 'TS' });
  });

  it('filtre par créneau, et « ALL » ne filtre pas', async () => {
    const cds = await request(app)
      .get('/api/v2/repartitions/secteurs')
      .set('Cookie', cookies);
    expect(cds.status).toBe(200);

    const jour = await request(app)
      .get('/api/v2/repartitions/filieres?creneau=CDS')
      .set('Cookie', cookies);
    expect(jour.body.filieres.map((f) => f.code)).toEqual(['GE_GE_TS']);

    const tous = await request(app)
      .get('/api/v2/repartitions/filieres?creneau=ALL')
      .set('Cookie', cookies);
    expect(tous.body.filieres).toHaveLength(2);
  });

  /*
   * L'écran « Affectations » recharge la carte enregistrée : il lui faut la
   * répartition de CHAQUE ensemble (filière, année) présent dans la base. Il
   * lançait un appel par ensemble — dix pour seize groupes. Cette route les
   * rend en un seul, sans quoi le navigateur les sérialise par vagues de six et
   * chacun repaie la vérification du jeton et un aller-retour vers la base.
   */
  it('rend plusieurs ensembles (filière, année) en un seul appel', async () => {
    const reponse = await request(app)
      .get('/api/v2/repartitions/modules-multiples?ensembles=DEVOWFS_S:2,DEVOWFS_S:1,GE_GE_TS:2')
      .set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(Object.keys(reponse.body.ensembles).sort()).toEqual([
      'DEVOWFS_S||1',
      'DEVOWFS_S||2',
      'GE_GE_TS||2',
    ]);

    const ensemble = reponse.body.ensembles['DEVOWFS_S||2'];
    expect(ensemble.modules.map((m) => m.code)).toEqual(['M201', 'M202']);
    expect(ensemble.modules[1].estRegional).toBe(true);
    expect(ensemble.filiere).toMatchObject({ secteur: 'Digital', niveau: 'TS' });

    // Une ligne ne doit jamais atterrir dans le mauvais ensemble : c'est le seul
    // risque propre au regroupement en mémoire.
    expect(reponse.body.ensembles['DEVOWFS_S||1'].modules.map((m) => m.code)).toEqual(['M101']);
    expect(reponse.body.ensembles['GE_GE_TS||2'].modules.map((m) => m.code)).toEqual(['M210']);
  });

  it('rend exactement ce que rendait un appel par ensemble', async () => {
    const [seule, lot] = await Promise.all([
      request(app).get('/api/v2/repartitions/modules?filiere=DEVOWFS_S&annee=2').set('Cookie', cookies),
      request(app)
        .get('/api/v2/repartitions/modules-multiples?ensembles=DEVOWFS_S:2')
        .set('Cookie', cookies),
    ]);

    expect(lot.body.ensembles['DEVOWFS_S||2']).toEqual({
      filiere: seule.body.filiere,
      modules: seule.body.modules,
    });
  });

  /*
   * Un ensemble sans aucune ligne est rendu VIDE, pas omis : la reconstruction
   * doit pouvoir distinguer « cette filière n'a pas de modules » de « je ne l'ai
   * pas demandée », sans quoi un groupe reviendrait vide sans explication.
   */
  it('rend un ensemble vide plutôt que de l’omettre, et ignore les entrées mal formées', async () => {
    const reponse = await request(app)
      .get('/api/v2/repartitions/modules-multiples?ensembles=INCONNUE:3,DEVOWFS_S:2,,GE_GE_TS,X:9')
      .set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(reponse.body.ensembles['INCONNUE||3']).toEqual({ filiere: null, modules: [] });
    expect(reponse.body.ensembles['DEVOWFS_S||2'].modules).toHaveLength(2);
    // « GE_GE_TS » sans année et « X:9 » hors bornes ne sont pas des ensembles.
    expect(Object.keys(reponse.body.ensembles).sort()).toEqual(['DEVOWFS_S||2', 'INCONNUE||3']);
  });

  it("refuse l'accès à un compte non authentifié", async () => {
    expect((await request(app).get('/api/v2/repartitions/secteurs')).status).toBe(401);
    expect(
      (await request(app).get('/api/v2/repartitions/modules-multiples?ensembles=DEVOWFS_S:2')).status
    ).toBe(401);
  });
});

describe('Analyse d\'un classeur de formateurs', () => {
  async function classeur(lignes) {
    const classeurExcel = new ExcelJS.Workbook();
    const feuille = classeurExcel.addWorksheet('Formateurs');
    for (const ligne of lignes) feuille.addRow(ligne);
    return Buffer.from(await classeurExcel.xlsx.writeBuffer());
  }

  it('lit le canevas officiel et ne touche à rien en base', async () => {
    const fichier = await classeur([
      ['Mle', 'Nom & Prénom', 'MHS Annuelle'],
      ['61630', 'AMINE JAWAD', 910],
      ['70245', 'Karim Ahmed', 1260],
      ['BX10245', 'YASSINE SAID', 360],
    ]);

    const reponse = await request(app)
      .post('/api/v2/base/formateurs/analyse')
      .set('Cookie', cookies)
      .attach('fichier', fichier, 'formateurs.xlsx');

    expect(reponse.status).toBe(200);
    expect(reponse.body.formateurs).toEqual([
      { nom: 'AMINE JAWAD', matricule: '61630', email: '', masseHoraire: 910 },
      // Le nom est mis en majuscules : c'est la clé d'appariement.
      { nom: 'KARIM AHMED', matricule: '70245', email: '', masseHoraire: 1260 },
      { nom: 'YASSINE SAID', matricule: 'BX10245', email: '', masseHoraire: 360 },
    ]);
    expect(reponse.body.colonnesReconnues).toEqual({
      matricule: true,
      masseHoraire: true,
      email: false,
    });

    // Lecture seule : la carte n'est enregistrée qu'au bouton dédié.
    expect(await Base.countDocuments({ etablissementId: etablissement.id })).toBe(0);
  });

  it('signale les colonnes qu\'il n\'a pas trouvées', async () => {
    const fichier = await classeur([['Nom & Prénom'], ['AMINE JAWAD']]);

    const reponse = await request(app)
      .post('/api/v2/base/formateurs/analyse')
      .set('Cookie', cookies)
      .attach('fichier', fichier, 'partiel.xlsx');

    expect(reponse.body.colonnesReconnues).toMatchObject({
      matricule: false,
      masseHoraire: false,
    });
  });

  it('refuse un fichier sans colonne de nom, avec un motif lisible', async () => {
    const fichier = await classeur([
      ['Mle', 'MHS Annuelle'],
      ['61630', 910],
    ]);

    const reponse = await request(app)
      .post('/api/v2/base/formateurs/analyse')
      .set('Cookie', cookies)
      .attach('fichier', fichier, 'sansnom.xlsx');

    expect(reponse.status).toBe(400);
    expect(reponse.body.message).toMatch(/Nom & Prénom/);
  });

  it('refuse l\'ancien format .xls', async () => {
    const reponse = await request(app)
      .post('/api/v2/base/formateurs/analyse')
      .set('Cookie', cookies)
      .attach('fichier', Buffer.from('peu importe'), 'ancien.xls');

    expect(reponse.status).toBe(400);
  });
});

describe('Enregistrement de la carte', () => {
  const carte = {
    formateurs: [
      { nom: 'AHMED CHERKAOUI', matricule: '9863', masseHoraire: 720 },
      { nom: 'FATIMA BENALI', matricule: '10241' },
    ],
    groupes: [
      {
        nom: 'DEVOWFS201',
        codeFiliere: 'DEVOWFS_S',
        intituleFiliere: 'Développement Full Stack',
        anneeFormation: 2,
        niveau: 'TS',
        secteur: 'Digital',
        typeFormation: 'Diplômante',
        creneau: 'CDJ',
        mode: 'Résidentiel',
        modules: [
          {
            code: 'M201',
            nom: 'Programmation',
            mhpS1: 30,
            mhpS2: 30,
            formateurPresentiel: 'AHMED CHERKAOUI',
          },
          {
            code: 'M202',
            nom: 'Base de données',
            mhpS1: 20,
            mhpS2: 20,
            formateurPresentiel: 'FATIMA BENALI',
          },
        ],
      },
    ],
  };

  it('produit la même structure de base qu\'un import e-note', async () => {
    const reponse = await request(app)
      .post('/api/v2/base/carte')
      .set('Cookie', cookies)
      .send(carte);

    expect(reponse.status).toBe(201);
    expect(reponse.body.effectifs).toMatchObject({
      formateurs: 2,
      groupes: 1,
      affectations: 2,
    });

    const base = await Base.findOne({ etablissementId: etablissement.id, anneeScolaire: ANNEE });
    expect(base.origine).toBe('carte');
    expect(base.groupes).toEqual(['DEVOWFS201']);
    expect(base.affectations.map((a) => a.module)).toEqual(['M201', 'M202']);
    // Le formateur est identifié par son matricule, comme à l'import.
    expect(base.affectations[0].formateur).toBe('9863');
  });

  it('retient la masse horaire saisie dans la carte', async () => {
    await request(app).post('/api/v2/base/carte').set('Cookie', cookies).send(carte);

    const base = await Base.findOne({ etablissementId: etablissement.id, anneeScolaire: ANNEE });
    const ahmed = base.formateurs.find((f) => f.matricule === '9863');
    // 720 h saisies, et non les 60 h qui seraient déduites des affectations.
    expect(ahmed.masseHoraire).toBe(720);
  });

  it('⚠️⚠️ NE SUPPRIME PAS un groupe dont TOUS les modules sont désactivés', async () => {
    /*
     * LE DÉFAUT LE PLUS GRAVE DE CET ÉCRAN, constaté sur les données réelles.
     *
     * `construireBase` déduit la liste des groupes des LIGNES e-note produites.
     * Un module désactivé n'en produit aucune : un groupe dont tous les modules
     * le sont sortait donc sans aucune ligne, et DISPARAISSAIT de la base — avec
     * ses affectations, sans un message.
     *
     * Pire : la carte se recharge depuis la base, donc le second enregistrement
     * automatique repartait d'une carte déjà amputée. La perte devenait
     * définitive en deux secondes.
     */
    const toutInactif = {
      ...carte,
      groupes: [
        {
          ...carte.groupes[0],
          modules: carte.groupes[0].modules.map((module) => ({ ...module, actif: false })),
        },
      ],
    };

    const reponse = await request(app)
      .post('/api/v2/base/carte')
      .set('Cookie', cookies)
      .send(toutInactif);
    expect(reponse.status).toBe(201);

    const base = await Base.findOne({ etablissementId: etablissement.id, anneeScolaire: ANNEE });
    // Le groupe SURVIT, et son état de désactivation est conservé.
    expect(base.groupes).toContain('DEVOWFS201');
    expect(Object.fromEntries(base.modulesInactifs).DEVOWFS201).toEqual(
      expect.arrayContaining(['M201', 'M202'])
    );
  });

  it('⚠️ CONSERVE la désactivation d’un module', async () => {
    /*
     * LE DÉFAUT QUE CE TEST FIGE — signalé par le porteur : « l'activation /
     * désactivation n'est pas enregistrée ».
     *
     * Un module inactif ne produit AUCUNE ligne e-note : c'est ce qui le retire
     * du bilan, de la charge et du chronogramme. Mais la carte se RECONSTRUIT en
     * croisant la base avec la répartition DRIF, et le référentiel connaît
     * toujours le module — il revenait donc ACTIF au rechargement, et le
     * commutateur paraissait sans effet. Son état se range désormais À PART.
     */
    const avecInactif = {
      ...carte,
      groupes: [
        {
          ...carte.groupes[0],
          modules: carte.groupes[0].modules.map((module) =>
            module.code === 'M202' ? { ...module, actif: false } : module
          ),
        },
      ],
    };

    const reponse = await request(app)
      .post('/api/v2/base/carte')
      .set('Cookie', cookies)
      .send(avecInactif);
    expect(reponse.status).toBe(201);

    const base = await Base.findOne({ etablissementId: etablissement.id, anneeScolaire: ANNEE });
    expect(Object.fromEntries(base.modulesInactifs)).toEqual({ DEVOWFS201: ['M202'] });

    // Le module désactivé ne produit toujours aucune affectation — la
    // persistance n'annule pas ce qu'elle accompagne.
    expect(base.affectations.some((a) => a.module === 'M202')).toBe(false);

    // ⚠️ Et il doit REVENIR à l'écran : le présentateur doit porter le champ,
    // sans quoi le correctif du modèle ne servirait à rien.
    const relue = await request(app).get('/api/v2/base').set('Cookie', cookies);
    expect(relue.body.base.modulesInactifs).toEqual({ DEVOWFS201: ['M202'] });
  });

  it('⚠️⚠️ GARDE LES NOMS DE LA CARTE — pas de groupe fantôme entre filières homonymes', async () => {
    /*
     * Signalé par le porteur (2026-09-11). GC_GE_TS (quatre groupes) et
     * GE_GE_TS (deux) partagent le préfixe « GE ». Le parseur de l'import ne
     * suffixait que les noms EN COLLISION : GE103 et GE104 perdaient leur
     * « (GC) », et la réunion avec la liste de la carte faisait revenir les
     * anciens noms à côté des nouveaux — deux colonnes vides, à 0/16.
     */
    const groupe = (nom, codeFiliere) => ({
      ...carte.groupes[0],
      nom,
      codeFiliere,
      anneeFormation: 1,
      modules: [{ ...carte.groupes[0].modules[0], actif: nom === 'GE104 (GC)' ? false : undefined }],
    });

    const homonymes = {
      ...carte,
      groupes: [
        groupe('GE101 (GC)', 'GC_GE_TS'),
        groupe('GE102 (GC)', 'GC_GE_TS'),
        groupe('GE103 (GC)', 'GC_GE_TS'),
        groupe('GE104 (GC)', 'GC_GE_TS'),
        groupe('GE101 (GE)', 'GE_GE_TS'),
        groupe('GE102 (GE)', 'GE_GE_TS'),
      ],
    };

    const reponse = await request(app)
      .post('/api/v2/base/carte')
      .set('Cookie', cookies)
      .send(homonymes);
    expect(reponse.status).toBe(201);

    const base = await Base.findOne({ etablissementId: etablissement.id, anneeScolaire: ANNEE });
    expect([...base.groupes].sort()).toEqual([
      'GE101 (GC)',
      'GE101 (GE)',
      'GE102 (GC)',
      'GE102 (GE)',
      'GE103 (GC)',
      'GE104 (GC)',
    ]);
    // Toutes les données rangées par nom de groupe suivent le MÊME nom.
    expect(new Set(base.affectations.map((a) => a.groupe))).toEqual(
      new Set(['GE101 (GC)', 'GE101 (GE)', 'GE102 (GC)', 'GE102 (GE)', 'GE103 (GC)'])
    );
    expect(Object.fromEntries(base.modulesInactifs)).toEqual({ 'GE104 (GC)': ['M201'] });
    expect(Object.keys(Object.fromEntries(base.groupeFilieres)).sort()).toEqual([...base.groupes].sort());
  });

  it("renseigne l'effectif du groupe depuis les stagiaires inscrits", async () => {
    await Stagiaire.create([
      { etablissementId: etablissement.id, anneeScolaire: ANNEE, matricule: 'S1', groupes: ['DEVOWFS201'] },
      { etablissementId: etablissement.id, anneeScolaire: ANNEE, matricule: 'S2', groupes: ['devowfs201'] },
      { etablissementId: etablissement.id, anneeScolaire: ANNEE, matricule: 'S3', groupes: ['AUTRE'] },
    ]);

    const reponse = await request(app)
      .post('/api/v2/base/carte')
      .set('Cookie', cookies)
      .send(carte);

    expect(reponse.status).toBe(201);
    // La colonne est complétée côté serveur : le navigateur ne connaît pas les
    // inscriptions. La casse ne doit pas séparer deux fois le même groupe.
    const base = await Base.findOne({ etablissementId: etablissement.id, anneeScolaire: ANNEE });
    expect(base.groupes).toEqual(['DEVOWFS201']);
  });

  it('remplace la base précédente plutôt que de s\'y ajouter', async () => {
    await request(app).post('/api/v2/base/carte').set('Cookie', cookies).send(carte);

    const reduite = {
      ...carte,
      groupes: [{ ...carte.groupes[0], modules: [carte.groupes[0].modules[0]] }],
    };
    await request(app).post('/api/v2/base/carte').set('Cookie', cookies).send(reduite);

    const base = await Base.findOne({ etablissementId: etablissement.id, anneeScolaire: ANNEE });
    expect(base.affectations).toHaveLength(1);
  });

  it('refuse une carte sans groupe', async () => {
    const reponse = await request(app)
      .post('/api/v2/base/carte')
      .set('Cookie', cookies)
      .send({ formateurs: [], groupes: [] });

    expect(reponse.status).toBe(400);
  });

  it('refuse un module sans code ni intitulé', async () => {
    const reponse = await request(app)
      .post('/api/v2/base/carte')
      .set('Cookie', cookies)
      .send({
        formateurs: [],
        groupes: [{ ...carte.groupes[0], modules: [{ mhpS1: 10 }] }],
      });

    expect(reponse.status).toBe(400);
  });

  /*
   * Le payload RÉEL du navigateur, et non un payload reconstruit à la main.
   *
   * Les modules de la carte sont bâtis en étalant la réponse de
   * `/repartitions/modules` (`useCarte.js` : `...module`). Cette réponse porte
   * `metier`, `mhpTotale` et `mhdTotale` (repartitions.routes.js:141-153), que
   * les payloads écrits à la main dans ce fichier ne contiennent pas.
   *
   * `moduleSchema` n'est pas `strict()` — contrairement à `carteSchema` et aux
   * objets `groupes` / `formateurs` — donc ces champs sont ignorés sans erreur.
   * Le test fige ce contrat : y ajouter `.strict()` par symétrie avec ses
   * voisins casserait l'enregistrement depuis l'écran, sans qu'aucun autre test
   * ne s'en aperçoive.
   */
  it('accepte un module tel que le référentiel DRIF le fournit', async () => {
    const reponse = await request(app)
      .post('/api/v2/base/carte')
      .set('Cookie', cookies)
      .set('X-Etablissement-Id', String(etablissement._id))
      .send({
        formateurs: [{ nom: 'AHMED CHERKAOUI', matricule: '9863', masseHoraire: 720 }],
        groupes: [
          {
            ...carte.groupes[0],
            modules: [
              {
                code: 'M201',
                nom: 'Programmation',
                mhpS1: 30,
                mhpS2: 30,
                mhsynS1: 0,
                mhsynS2: 0,
                mhasynS1: 0,
                mhasynS2: 0,
                estRegional: false,
                // Les trois champs que le référentiel ajoute :
                metier: 'Développement',
                mhpTotale: 60,
                mhdTotale: 60,
                formateurPresentiel: 'AHMED CHERKAOUI',
                formateurSynchrone: '',
                reference: { mhpS1: 30, mhpS2: 30 },
              },
            ],
          },
        ],
      });

    expect(reponse.status).toBe(201);
  });
  /*
   * L'export ne se contente pas de répondre 200 : le classeur est RELU ici.
   * Un fichier corrompu, une feuille manquante ou un total faux passeraient
   * inaperçus avec une simple vérification de statut.
   */
  it('produit une feuille par tableau de la modale, synthèse en dernier', async () => {
    const reponse = await request(app)
      .post('/api/v2/base/bilan/export')
      .set('Cookie', cookies)
      .send({
        ...carte,
        groupes: [
          {
            ...carte.groupes[0],
            modules: [
              ...carte.groupes[0].modules,
              // Module laissé sans formateur : c'est lui qu'on attend dans la
              // feuille « Besoin détaillé ».
              { code: 'M999', nom: 'Module orphelin', mhpS1: 20, mhpS2: 10 },
            ],
          },
        ],
      })
      .responseType('blob');

    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-disposition']).toContain('Besoin_demande_par_metier');

    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);

    // Les quatre tableaux de la modale, DANS SON ORDRE, puis la synthèse.
    expect(classeur.worksheets.map((f) => f.name)).toEqual([
      'Besoin par métier',
      'Formateurs sous-affectés',
      'Formateurs en surcharge',
      'Demande par métier',
      'Synthèse',
    ]);

    // Mêmes colonnes qu'à l'écran, dans le même ordre.
    expect(classeur.getWorksheet('Besoin par métier').getRow(1).values.slice(1)).toEqual([
      'Métier', 'Modules non couverts', 'Modules', 'Demande (h)', 'Couvert (h)', 'Besoin (h)',
      'Part non couverte (%)',
    ]);
    expect(classeur.getWorksheet('Formateurs sous-affectés').getRow(1).values.slice(1)).toEqual([
      'Formateur', 'Mle', 'Statutaire (h)', 'Affecté S1 (h)', 'Affecté S2 (h)', 'Affecté total (h)',
      'Disponible (h)', 'Charge (%)',
    ]);

    // La synthèse porte les mêmes nombres que la modale.
    const synthese = new Map(
      classeur.getWorksheet('Synthèse').getRows(2, 20).map((l) => [l.getCell(1).value, l.getCell(2).value])
    );
    expect(synthese.get('Offre — masse horaire statutaire (h)')).toBe(720);

    // La ligne de total ferme le tableau, comme le pied à l'écran.
    const besoin = classeur.getWorksheet('Besoin par métier');
    const total = besoin.getRow(besoin.rowCount).values.slice(1);
    expect(total[0]).toBe('Total');
    expect(typeof total[3]).toBe('number');

    // Le résumé sert au message affiché après téléchargement.
    expect(JSON.parse(reponse.headers['x-resume-bilan'])).toMatchObject({
      metiers: expect.any(Number),
      modulesNonCouverts: expect.any(Number),
    });
  });

  it("refuse d'exporter une carte sans aucun groupe", async () => {
    const reponse = await request(app)
      .post('/api/v2/base/bilan/export')
      .set('Cookie', cookies)
      .send({ formateurs: [], groupes: [] });

    expect(reponse.status).toBe(400);
  });
  /*
   * Les formateurs tels que l'IMPORT EXCEL les produit.
   *
   * `lireFormateurs()` rend `{nom, matricule, email, masseHoraire}` — la
   * colonne « Email » fait partie du canevas officiel. L'objet est `strict()` :
   * tant qu'il ignorait `email`, la carte entière était rejetée avec
   * « Unrecognized key(s): 'email' », et l'enregistrement comme l'export
   * échouaient dès que les formateurs venaient d'un fichier — le chemin normal.
   * Les payloads écrits à la main dans ce fichier n'ont jamais porte ce champ.
   */
  it("accepte les formateurs issus de l'import Excel, email compris", async () => {
    const avecEmail = {
      ...carte,
      formateurs: [
        { nom: 'AHMED CHERKAOUI', matricule: '9863', email: 'a.cherkaoui@ofppt.ma', masseHoraire: 720 },
        { nom: 'FATIMA BENALI', matricule: '10241', email: '' },
      ],
    };

    const enregistrement = await request(app)
      .post('/api/v2/base/carte')
      .set('Cookie', cookies)
      .send(avecEmail);
    expect(enregistrement.status).toBe(201);

    const exportation = await request(app)
      .post('/api/v2/base/bilan/export')
      .set('Cookie', cookies)
      .send(avecEmail);
    expect(exportation.status).toBe(200);

    /*
     * L'adresse IMPORTÉE est conservée. `construireBase()` fabrique sinon une
     * adresse déduite « prenom.nom@ofppt.ma » — plausible, jamais vérifiée — et
     * l'écrase à chaque enregistrement. C'est à cette adresse que partiront les
     * identifiants de compte : une adresse inventée les enverrait dans le vide.
     */
    const base = await Base.findOne({ etablissementId: etablissement.id });
    const parNom = new Map(base.formateurs.map((f) => [f.nomComplet, f.email]));

    expect(parNom.get('AHMED CHERKAOUI')).toBe('a.cherkaoui@ofppt.ma');
    // Colonne « Email » laissée vide : l'adresse déduite s'applique toujours.
    expect(parNom.get('FATIMA BENALI')).toBe('fatima.benali@ofppt.ma');
  });

  it("un réenregistrement sans email ne perd pas l'adresse déjà connue", async () => {
    const envoyer = (formateurs) =>
      request(app).post('/api/v2/base/carte').set('Cookie', cookies).send({ ...carte, formateurs });

    await envoyer([
      { nom: 'AHMED CHERKAOUI', matricule: '9863', email: 'a.cherkaoui@ofppt.ma', masseHoraire: 720 },
    ]);

    // Second enregistrement SANS l'adresse — par exemple depuis un écran qui ne
    // la porte pas. Elle doit survivre, comme les masses horaires corrigées.
    await envoyer([{ nom: 'AHMED CHERKAOUI', matricule: '9863', masseHoraire: 720 }]);

    const base = await Base.findOne({ etablissementId: etablissement.id });
    const ahmed = base.formateurs.find((f) => f.nomComplet === 'AHMED CHERKAOUI');
    expect(ahmed.email).toBe('a.cherkaoui@ofppt.ma');
  });
  /*
   * Une ligne PAR MÉTIER, et non un « Non renseigné » fourre-tout.
   *
   * Zod RETIRE les clés non déclarées, meme sans `.strict()`. Tant que
   * `moduleSchema` ignorait `metier`, le champ était supprimé avant le calcul :
   * le classeur sortait avec UNE seule ligne, aux totaux pourtant exacts. Les
   * totaux ne suffisent donc pas à valider cet export — il faut lire les
   * lignes, ce que le test précédent ne faisait pas.
   */
  it('ventile le besoin par métier, sans tout ranger sous « Non renseigné »', async () => {
    const reponse = await request(app)
      .post('/api/v2/base/bilan/export')
      .set('Cookie', cookies)
      .send({
        formateurs: [{ nom: 'AHMED CHERKAOUI', matricule: '9863', masseHoraire: 720 }],
        groupes: [
          {
            ...carte.groupes[0],
            modules: [
              { code: 'M201', nom: 'Programmation', mhpS1: 30, mhpS2: 30, metier: 'Développement' },
              { code: 'M202', nom: 'Réseaux', mhpS1: 20, mhpS2: 20, metier: 'Infrastructure' },
              { code: 'M203', nom: 'Anglais', mhpS1: 10, mhpS2: 10, metier: 'Langues',
                formateurPresentiel: 'AHMED CHERKAOUI' },
            ],
          },
        ],
      })
      .responseType('blob');

    expect(reponse.status).toBe(200);

    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);
    const feuille = classeur.getWorksheet('Besoin par métier');

    const lignes = feuille
      .getRows(2, feuille.rowCount - 1)
      .map((ligne) => ligne.values.slice(1))
      .filter((ligne) => ligne[0] !== 'Total');

    expect(lignes.map((l) => l[0])).toEqual(['Développement', 'Infrastructure', 'Langues']);
    // Développement : 60 h dues, aucune couverte.
    expect(lignes[0].slice(1)).toEqual([1, 1, 60, 0, 60, 100]);
    // Langues : entièrement couvert, donc aucun besoin.
    expect(lignes[2].slice(1)).toEqual([0, 1, 20, 20, 0, 0]);

    // La feuille « Demande par métier » porte les mêmes métiers.
    const demande = classeur.getWorksheet('Demande par métier');
    const metiersDemande = demande
      .getRows(2, demande.rowCount - 1)
      .map((ligne) => ligne.values[1])
      .filter((nom) => nom !== 'Total');
    expect(metiersDemande).toHaveLength(3);
    expect(metiersDemande).not.toContain('Non renseigné');
  });
  /*
   * L'enregistrement de la carte REMPLACE la base de l'année : rien de la
   * précédente ne doit survivre.
   *
   * Le `$set` d'origine remplaçait le contenu de la base, mais laissait les
   * traces d'import e-note — jusqu'à 353 Ko de lignes brutes chacune —
   * documentant une base qui n'existait plus.
   */
  it("supprime la base précédente mais CONSERVE ses traces d'import", async () => {
    // Une base e-note en place, avec sa trace d'import.
    await Base.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      formateurs: [{ nomComplet: 'ANCIEN FORMATEUR', matricule: '11111', masseHoraire: 500 }],
      groupes: ['ANCIEN101'],
      origine: 'enote',
    });
    await EnoteImport.create([
      { etablissementId: etablissement.id, anneeScolaire: ANNEE, nomFichier: 'a.xlsx', lignes: [['x']] },
      { etablissementId: etablissement.id, anneeScolaire: ANNEE, nomFichier: 'b.xlsx', lignes: [['y']] },
    ]);

    const reponse = await request(app)
      .post('/api/v2/base/carte')
      .set('Cookie', cookies)
      .send(carte);

    expect(reponse.status).toBe(201);
    expect(reponse.body.supprime).toEqual({ base: true });
    expect(reponse.body.tracesImportConservees).toBe(2);

    // Une seule base, et plus rien de l'ancienne.
    const bases = await Base.find({ etablissementId: etablissement.id, anneeScolaire: ANNEE });
    expect(bases).toHaveLength(1);
    expect(bases[0].origine).toBe('carte');
    expect(bases[0].groupes).not.toContain('ANCIEN101');
    expect(bases[0].formateurs.map((f) => f.nomComplet)).not.toContain('ANCIEN FORMATEUR');

    /*
     * L'HISTORIQUE des imports survit (décision du 2026-08-16). Une première
     * version l'effaçait ; depuis que la carte s'enregistre automatiquement,
     * cela reviendrait à le perdre à la première pause de saisie.
     */
    expect(await EnoteImport.countDocuments({ etablissementId: etablissement.id })).toBe(2);
  });

  it("ne touche pas à la base d'une AUTRE année scolaire", async () => {
    // La suppression est bornée au couple (établissement, année) : basculer
    // d'année ne doit pas effacer le travail de la précédente.
    await Base.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE - 1,
      groupes: ['ANDERNIER101'],
      origine: 'enote',
    });

    await request(app).post('/api/v2/base/carte').set('Cookie', cookies).send(carte);

    const precedente = await Base.findOne({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE - 1,
    });
    expect(precedente.groupes).toContain('ANDERNIER101');
  });

  it('signale une première carte sans base précédente', async () => {
    const reponse = await request(app)
      .post('/api/v2/base/carte')
      .set('Cookie', cookies)
      .send(carte);

    expect(reponse.body.supprime).toEqual({ base: false });
  });
});



describe('Export complet de la carte', () => {
  // `carte` du describe précédent lui est propre : celui-ci porte la sienne.
  const carte = {
    formateurs: [{ nom: 'AHMED CHERKAOUI', matricule: '9863', masseHoraire: 720 }],
    groupes: [
      {
        nom: 'DEVOWFS201',
        codeFiliere: 'DEVOWFS_S',
        intituleFiliere: 'Développement Full Stack',
        anneeFormation: 2,
        niveau: 'TS',
        secteur: 'Digital',
        typeFormation: 'Diplômante',
        creneau: 'CDJ',
        mode: 'Résidentiel',
        modules: [
          {
            code: 'M201',
            nom: 'Programmation',
            mhpS1: 30,
            mhpS2: 30,
            metier: 'Développement',
            formateurPresentiel: 'AHMED CHERKAOUI',
          },
        ],
      },
    ],
  };

  async function exporter(corps) {
    const reponse = await request(app)
      .post('/api/v2/base/carte/export')
      .set('Cookie', cookies)
      .send(corps ?? carte)
      .responseType('blob');

    expect(reponse.status).toBe(200);

    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);
    return { reponse, classeur };
  }

  it('produit les huit feuilles, la carte e-note en première', async () => {
    const { reponse, classeur } = await exporter();

    expect(classeur.worksheets.map((f) => f.name)).toEqual([
      'AvancementProgramme',
      'Affectations',
      'Groupes',
      'Besoin par métier',
      'Formateurs sous-affectés',
      'Formateurs en surcharge',
      'Demande par métier',
      'Synthèse',
    ]);

    expect(reponse.headers['content-disposition']).toContain('Carte_etablissement');
  });

  /*
   * LE test de cet export : le fichier produit doit pouvoir être RÉIMPORTÉ.
   * On le renvoie tel quel à la route d'import e-note, et on vérifie que la
   * base reconstruite porte les mêmes groupes et les mêmes affectations.
   */
  it("produit un fichier que la route d'import relit", async () => {
    const { reponse } = await exporter();

    const reimport = await request(app)
      .post('/api/v2/base/import')
      .set('Cookie', cookies)
      .attach('fichier', reponse.body, 'carte-exportee.xlsx');

    expect(reimport.status).toBe(201);

    const base = await Base.findOne({ etablissementId: etablissement.id });
    expect(base.groupes).toContain('DEVOWFS201');
    expect(base.affectations.length).toBeGreaterThan(0);
    expect(base.formateurs.map((f) => f.nomComplet)).toContain('AHMED CHERKAOUI');
  });

  it('détaille chaque groupe × module dans « Affectations »', async () => {
    const { classeur } = await exporter();
    const feuille = classeur.getWorksheet('Affectations');

    expect(feuille.getRow(1).values.slice(1)).toEqual([
      'Code filière', 'Filière', 'Année de formation', 'Groupe', 'Mode', 'Effectif',
      'Code module', 'Module', 'EFM régional', 'Module actif',
      'MHP S1', 'MHP S2', 'MHP totale', 'MHSYN S1', 'MHSYN S2', 'MHSYN totale',
      'Formateur présentiel', 'Mle présentiel', 'Formateur synchrone', 'Mle synchrone',
      'Groupes fusionnés',
    ]);

    const premiere = feuille.getRow(2).values.slice(1);
    expect(premiere[3]).toBe('DEVOWFS201');
    // Le matricule suit le formateur : c'est lui l'identifiant stable.
    expect(premiere[16]).toBe('AHMED CHERKAOUI');
    expect(premiere[17]).toBe('9863');
  });

  it('résume chaque groupe dans « Groupes », modules actifs seulement', async () => {
    const { classeur } = await exporter({
      ...carte,
      groupes: [
        {
          ...carte.groupes[0],
          modules: [
            { code: 'M201', nom: 'Programmation', mhpS1: 30, mhpS2: 30,
              formateurPresentiel: 'AHMED CHERKAOUI' },
            // Désactivé : il ne doit compter ni au numérateur ni au dénominateur.
            { code: 'M202', nom: 'Réseaux', mhpS1: 20, mhpS2: 20, actif: false },
          ],
        },
      ],
    });

    const feuille = classeur.getWorksheet('Groupes');
    const ligne = feuille.getRow(2).values.slice(1);

    expect(ligne[3]).toBe('DEVOWFS201');
    expect(ligne[6]).toBe(1);    // modules actifs
    expect(ligne[7]).toBe(1);    // modules affectés
    expect(ligne[8]).toBe(100);  // taux
    expect(ligne[9]).toBe(60);   // MHP totale, sans le module désactivé
  });
});