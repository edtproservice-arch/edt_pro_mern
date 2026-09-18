import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { Chronogramme } from '../../src/models/Chronogramme.js';
import { Repartition } from '../../src/models/Repartition.js';
import { CalendrierNational } from '../../src/models/CalendrierNational.js';
import { oublierMemoire } from '../../src/modules/calendrier/joursFeries.service.js';
import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));


/**
 * Chronogramme : planning annuel prévisionnel (F7).
 * ← api/profile/get_chronogramme_data.php + save_chronogramme.php
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;

/** Le formateur dont la vue « par formateur » est l'objet. */
const MATRICULE = '9863';

let etablissement;
let cookies;

beforeEach(async () => {
  /*
   * Les fériés viennent d'une API. Sans ce doublon, la suite dépendrait du
   * réseau et un test rouge ne dirait pas si c'est le code ou la connexion qui
   * a lâché. Le cache VIT DANS LE PROCESSUS : sans `oublierMemoire`, un test
   * servirait la valeur retenue par le précédent.
   */
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
    /*
     * GM102 part en stage, GM101 non. C'est le cœur de cette suite : la vue par
     * formateur porte les deux groupes sur le MÊME tableau.
     */
    stages: [{ groupe: 'GM102', debut: '2026-11-16', fin: '2026-11-21', sujet: 'Stage' }],
    /*
     * SAID AMMARI part en formation ; BRAHIM LOURID non. C'est ce qui permet de
     * vérifier que la formation ferme UNE LIGNE en vue groupe, et non la
     * colonne entière du groupe.
     */
    formations: [
      { matriculeFormateur: '4211', debut: '2027-01-11', fin: '2027-01-15', sujet: 'Pédagogie' },
    ],
  });

  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  await Repartition.create([
    {
      secteur: 'Digital',
      niveauFormation: 'TS',
      typeFormation: 'Diplômante',
      creneau: 'CDJ',
      codeFiliereDrif: 'GM_S',
      intituleFiliere: 'Gestion',
      codeFiliereCarte: 'GM_S',
      filiere: 'Gestion',
      anneeFormation: 1,
      codeModule: 'M101',
      module: 'Algorithmique',
      mhpS1: 30,
      mhpS2: 30,
      mhpTotale: 60,
      efmRegional: false,
      metier: 'développement',
    },
  ]);

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [
      { matricule: MATRICULE, nomComplet: 'BRAHIM LOURID', masseHoraire: 1000 },
      { matricule: '4211', nomComplet: 'SAID AMMARI', masseHoraire: 1000 },
    ],
    groupes: ['GM101', 'GM102'],
    affectations: [
      // Le même module, pour deux groupes : deux LIGNES distinctes.
      {
        formateur: MATRICULE,
        groupe: 'GM101',
        module: 'M101',
        type: TYPES_COURS.PRESENTIEL,
        s1Heures: 30,
        s2Heures: 0,
      },
      {
        formateur: MATRICULE,
        groupe: 'GM102',
        module: 'M101',
        type: TYPES_COURS.PRESENTIEL,
        s1Heures: 30,
        s2Heures: 0,
      },
      // Un module d'un COLLÈGUE, sur GM101 : il ne doit jamais apparaître dans
      // la grille du formateur, ni disparaître de la base quand celle-ci s'écrit.
      {
        formateur: '4211',
        groupe: 'GM101',
        module: 'M102',
        type: TYPES_COURS.PRESENTIEL,
        s1Heures: 20,
        s2Heures: 0,
      },
    ],
  });
});

const parFormateur = () =>
  request(app).get(`/api/v2/chronogrammes/par-formateur/${MATRICULE}`).set('Cookie', cookies);

beforeEach(async () => {
  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookies = connexion.headers['set-cookie'];
});

describe('Liste des formateurs', () => {
  it('rend chaque formateur affecté, son nom et sa masse ANNUELLE', async () => {
    const reponse = await request(app)
      .get('/api/v2/chronogrammes/par-formateur')
      .set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(reponse.body.formateurs).toEqual([
      /*
       * ⚠️ Le NOM, jamais le matricule — et `masseAnnuelle`, jamais
       * `masseHoraire` : le champ de la base porte une capacité d'ANNÉE, et
       * l'avoir pris pour une charge de semaine a fait afficher
       * « masse statutaire 1000 h/semaine » à l'écran.
       */
      expect.objectContaining({ identifiant: MATRICULE, nom: 'BRAHIM LOURID', masseAnnuelle: 1000 }),
      expect.objectContaining({ identifiant: '4211', nom: 'SAID AMMARI' }),
    ]);
  });

  it('ne s’intercale PAS avec la route d’un groupe', async () => {
    /*
     * `/par-formateur` et `/:groupe` se ressemblent : déclarée après, la
     * première serait captée par la seconde, qui chercherait un groupe de ce
     * nom et répondrait 404 sur une route pourtant écrite.
     */
    const groupe = await request(app).get('/api/v2/chronogrammes/GM101').set('Cookie', cookies);
    expect(groupe.status).toBe(200);
    expect(groupe.body.groupe).toBe('GM101');
  });
});

describe('Grille par formateur', () => {
  it('rend UNE LIGNE PAR GROUPE pour le même module', async () => {
    const reponse = await parFormateur();

    expect(reponse.status).toBe(200);
    expect(reponse.body.lignes).toHaveLength(2);
    expect(reponse.body.lignes.map((ligne) => ligne.groupe)).toEqual(['GM101', 'GM102']);
    // Chaque ligne porte SA propre masse, pas le cumul des deux groupes.
    expect(reponse.body.lignes[0].masses).toEqual({ presentiel: 30, synchrone: 0 });
    expect(reponse.body.lignes[0].intitule).toBe('Algorithmique');
  });

  it('n’expose PAS les modules des collègues', async () => {
    const reponse = await parFormateur();
    expect(reponse.body.lignes.some((ligne) => ligne.code === 'M102')).toBe(false);
  });

  it('rend les stages PAR GROUPE, et non dans les semaines communes', async () => {
    const reponse = await parFormateur();

    /*
     * ⚠️ C'EST LA RÈGLE CENTRALE DE CETTE VUE. Un stage ne ferme QU'UN groupe :
     * la semaine du 16 novembre est verrouillée pour la ligne de GM102 et
     * ouverte pour celle de GM101. La verrouiller dans les semaines communes
     * ferait croire la semaine fermée pour tout le monde, alors que le
     * formateur y garde ses cours de GM101.
     */
    expect(reponse.body.stagesParGroupe.GM102).toHaveLength(1);
    expect(reponse.body.stagesParGroupe.GM101).toEqual([]);

    /* ⚠️ L'entrée porte `{numero, jours}` depuis le 2026-08-26 : une période se
       saisit en plage libre, et le nombre de jours décide si la semaine se
       ferme ou se réduit seulement. */
    const enStage = reponse.body.stagesParGroupe.GM102[0];
    expect(enStage).toMatchObject({ numero: expect.any(Number), jours: expect.any(Number) });

    const commune = reponse.body.semaines.find((semaine) => semaine.numero === enStage.numero);
    expect(commune.disponible).toBe(true);
    expect(commune.motif).toBeNull();
  });

  it('signale un module assuré à plusieurs sur le même groupe', async () => {
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      {
        $push: {
          affectations: {
            formateur: '4211',
            groupe: 'GM101',
            module: 'M101',
            type: TYPES_COURS.SYNCHRONE,
            s1Heures: 10,
            s2Heures: 0,
          },
        },
      }
    );

    const reponse = await parFormateur();
    const ligne = reponse.body.lignes.find((candidate) => candidate.groupe === 'GM101');

    // Sans ce signalement, l'écart de la ligne se lit comme une erreur de calcul :
    // les cellules sont celles du module, la masse n'est que la part du formateur.
    expect(ligne.partageAvec).toEqual(['SAID AMMARI']);
    expect(reponse.body.lignes.find((c) => c.groupe === 'GM102').partageAvec).toEqual([]);
  });

  it('renvoie le planning COMPLET de chaque groupe, modules des collègues compris', async () => {
    await Chronogramme.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      groupe: 'GM101',
      planning: new Map([
        ['M101', [{ semaine: 'S3', heures: 5, type: 'P' }]],
        ['M102', [{ semaine: 'S4', heures: 2.5, type: 'P' }]],
      ]),
    });

    const reponse = await parFormateur();

    /*
     * ⚠️ CE QUI ÉVITE LA PERTE DE DONNÉES. `PUT /chronogrammes/:groupe` REMPLACE
     * le planning du groupe. Si la vue par formateur ne recevait que les modules
     * de la personne, l'enregistrement effacerait ceux de ses collègues — sans
     * message, et sans que rien ne se voie puisqu'ils ne sont pas à l'écran.
     */
    expect(Object.keys(reponse.body.plannings.GM101).sort()).toEqual(['M101', 'M102']);
    expect(reponse.body.plannings.GM101.M102).toEqual({ 4: { heures: 2.5, type: 'P' } });
  });

  it('refuse un formateur sans aucun module', async () => {
    const reponse = await request(app)
      .get('/api/v2/chronogrammes/par-formateur/INCONNU')
      .set('Cookie', cookies);

    expect(reponse.status).toBe(404);
    // Un message qui NOMME la personne : « introuvable » seul ferait chercher
    // une panne alors que la base n'a simplement pas d'affectation pour elle.
    expect(reponse.body.message).toContain('INCONNU');
  });
});


describe('Formations — la 4e cause d’indisponibilité', () => {
  const semaineDeFormation = (reponse) =>
    reponse.body.semaines.find((s) => s.debut <= '2027-01-11' && s.fin >= '2027-01-11').numero;

  it('VUE GROUPE : ferme la ligne du module, PAS la colonne', async () => {
    const reponse = await request(app).get('/api/v2/chronogrammes/GM101').set('Cookie', cookies);
    const numero = semaineDeFormation(reponse);

    const deAmmari = reponse.body.modules.find((m) => m.code === 'M102');
    const deLourid = reponse.body.modules.find((m) => m.code === 'M101');

    expect(deAmmari.formationSemaines.map((s) => s.numero)).toContain(numero);
    /*
     * ⚠️ LE POINT CENTRAL. Une formation retient une PERSONNE : fermer la
     * colonne du groupe rendrait insaisissables les autres modules, dont les
     * formateurs sont là. La semaine COMMUNE reste donc ouverte.
     */
    expect(deLourid.formationSemaines).toEqual([]);
    expect(reponse.body.semaines.find((s) => s.numero === numero).disponible).toBe(true);
  });

  it('VUE GROUPE : ne ferme un module CO-ENSEIGNÉ que si TOUS sont absents', async () => {
    // Un module assuré à deux reste enseignable quand un seul s'absente ;
    // le verrouiller ferait perdre une semaine de cours qui a bien lieu.
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      {
        $push: {
          affectations: {
            formateur: MATRICULE,
            groupe: 'GM101',
            module: 'M102',
            type: TYPES_COURS.SYNCHRONE,
            s1Heures: 5,
            s2Heures: 0,
          },
        },
      }
    );

    const reponse = await request(app).get('/api/v2/chronogrammes/GM101').set('Cookie', cookies);
    expect(reponse.body.modules.find((m) => m.code === 'M102').formationSemaines).toEqual([]);
  });

  it('VUE FORMATEUR : ferme TOUTE la grille de la personne', async () => {
    const reponse = await request(app)
      .get('/api/v2/chronogrammes/par-formateur/4211')
      .set('Cookie', cookies);
    const numero = semaineDeFormation(reponse);

    /* Le tableau ne porte qu'une personne : ses absences valent pour TOUTES ses
       lignes, quel que soit le groupe. C'est l'inverse exact du stage.
       ⚠️ L'entrée porte `{numero, jours}` — une formation en plage libre peut ne
       retirer que quelques jours. */
    expect(reponse.body.formationSemaines.map((s) => s.numero)).toContain(numero);
  });

  it('VUE FORMATEUR : rien pour qui n’a aucune formation', async () => {
    const reponse = await parFormateur();
    expect(reponse.body.formationSemaines).toEqual([]);
  });
});

describe('Classeur — export puis import', () => {
  const poser = () =>
    Chronogramme.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      groupe: 'GM101',
      planning: new Map([
        [
          'M101',
          [
            { semaine: 'S6', heures: 5, type: 'P' },
            { semaine: 'S7', heures: 2.5, type: 'P' },
          ],
        ],
        ['M102', [{ semaine: 'S9', heures: 10, type: 'P' }]],
      ]),
    });

  /*
   * ⚠️ `responseType('blob')` EST INDISPENSABLE. Sans lui, Supertest tente de
   * parser la réponse comme du texte : `res.body` revient en objet vide et le
   * classeur est perdu — l'échec ressemble alors à un export cassé alors que la
   * route a répondu correctement.
   */
  const exporter = (corps) =>
    request(app)
      .post('/api/v2/chronogrammes/export')
      .set('Cookie', cookies)
      .responseType('blob')
      .send(corps);

  it('produit un classeur avec un onglet par groupe', async () => {
    await poser();
    const reponse = await exporter({ mode: 'groupe', sujets: ['GM101', 'GM102'] });

    expect(reponse.status).toBe(200);
    expect(reponse.headers['content-type']).toContain('spreadsheetml');

    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body);

    expect(classeur.worksheets.map((f) => f.name)).toEqual(
      expect.arrayContaining(['GM101', 'GM102', 'Charge groupes'])
    );

    const feuille = classeur.getWorksheet('GM101');
    /*
     * ⚠️ B1 EN CLAIR : Excel tronque un nom d'onglet à 31 caractères et en
     * retire `: \ / ? * [ ]`. Sans B1, un groupe au nom long reviendrait sous
     * un nom mutilé que la relecture ne reconnaîtrait pas.
     */
    expect(feuille.getCell('A1').value).toBe('Groupe');
    expect(feuille.getCell('B1').value).toBe('GM101');
    expect(feuille.getCell('A6').value).toBe('Module');
  });

  it('⚠️ ALLER-RETOUR : le classeur relu redonne le MÊME planning', async () => {
    /*
     * LE garde-fou de cette fonctionnalité. Le fichier n'existe que pour être
     * retouché hors ligne puis relu : s'il ne revient pas identique quand on n'y
     * touche pas, il n'est bon à rien. On renvoie donc le classeur PRODUIT à la
     * route d'import et on relit la base — pas des cellules comparées à la main.
     */
    await poser();
    const classeur = await exporter({ mode: 'groupe', sujets: ['GM101'] });

    const retour = await request(app)
      .post('/api/v2/chronogrammes/import')
      .set('Cookie', cookies)
      .attach('fichier', Buffer.from(classeur.body), 'chronogramme.xlsx');

    expect(retour.status).toBe(200);
    // Rien n'a changé dans le fichier : rien ne doit être écrit ni effacé.
    expect(retour.body.ecrites).toBe(0);
    expect(retour.body.effacees).toBe(0);

    const relu = await request(app).get('/api/v2/chronogrammes/GM101').set('Cookie', cookies);
    expect(relu.body.planning).toEqual({
      M101: { 6: { heures: 5, type: 'P' }, 7: { heures: 2.5, type: 'P' } },
      M102: { 9: { heures: 10, type: 'P' } },
    });
  });

  it('APPLIQUE une valeur retouchée dans le fichier', async () => {
    await poser();
    const classeur = await exporter({ mode: 'groupe', sujets: ['GM101'] });

    const livre = new ExcelJS.Workbook();
    await livre.xlsx.load(Buffer.from(classeur.body));
    const feuille = livre.getWorksheet('GM101');

    // Colonne de S10, ligne du module M101 en présentiel (première ligne).
    const colonneS10 = 6 + 10;
    feuille.getCell(7, colonneS10).value = 7.5;

    const retour = await request(app)
      .post('/api/v2/chronogrammes/import')
      .set('Cookie', cookies)
      .attach('fichier', Buffer.from(await livre.xlsx.writeBuffer()), 'retouche.xlsx');

    expect(retour.body.ecrites).toBe(1);
    expect(retour.body.groupes).toEqual(['GM101']);

    const relu = await request(app).get('/api/v2/chronogrammes/GM101').set('Cookie', cookies);
    expect(relu.body.planning.M101[10]).toEqual({ heures: 7.5, type: 'P' });
  });

  it('REFUSE un classeur qui n’en est pas un', async () => {
    const retour = await request(app)
      .post('/api/v2/chronogrammes/import')
      .set('Cookie', cookies)
      .attach('fichier', Buffer.from('ceci n’est pas un classeur'), 'faux.xlsx');

    expect(retour.status).toBe(400);
    expect(retour.body.success).toBe(false);
  });

  it('refuse un export sans aucun sujet', async () => {
    const reponse = await exporter({ mode: 'groupe', sujets: [] });
    expect(reponse.status).toBe(400);
  });
});


describe('Classeur — les DEUX feuilles de charge', () => {
  /** Ouvre le classeur produit et rend ses feuilles. */
  const lire = async (corps) => {
    const reponse = await request(app)
      .post('/api/v2/chronogrammes/export')
      .set('Cookie', cookies)
      .responseType('blob')
      .send(corps);

    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(Buffer.from(reponse.body));
    return classeur;
  };

  it('rend la charge FORMATEURS même en mode groupe', async () => {
    /*
     * ⚠️ LES DEUX BILANS, QUEL QUE SOIT LE MODE. On exporte par groupe pour
     * saisir, mais la question « cette personne est-elle surchargée en S12 ? »
     * se pose sur le même fichier. N'en produire qu'un obligeait à réexporter
     * dans l'autre mode pour y répondre.
     */
    const classeur = await lire({ mode: 'groupe', sujets: ['GM101'] });
    const noms = classeur.worksheets.map((f) => f.name);

    expect(noms).toContain('Charge groupes');
    expect(noms).toContain('Charge formateurs');

    const charge = classeur.getWorksheet('Charge formateurs');
    expect(charge.getCell('A1').value).toBe('Formateur');
    // Les DEUX formateurs de GM101 y figurent, chacun sur sa ligne.
    const sujets = charge.getColumn(1).values.filter(Boolean).slice(1);
    expect(sujets).toEqual(expect.arrayContaining(['BRAHIM LOURID', 'SAID AMMARI']));
  });

  it('rend la charge GROUPES même en mode formateur', async () => {
    const classeur = await lire({ mode: 'formateur', sujets: [MATRICULE] });

    const charge = classeur.getWorksheet('Charge groupes');
    expect(charge.getCell('A1').value).toBe('Groupe');
    // BRAHIM LOURID intervient sur GM101 et GM102 : les deux sont des lignes.
    const sujets = charge.getColumn(1).values.filter(Boolean).slice(1);
    expect(sujets).toEqual(expect.arrayContaining(['GM101', 'GM102']));
  });

  it('rattache chaque cellule à SON formateur, pas à ceux du module voisin', async () => {
    // M101 est à BRAHIM LOURID, M102 à SAID AMMARI. Les confondre attribuerait
    // à l'un les heures de l'autre.
    await Chronogramme.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      groupe: 'GM101',
      planning: new Map([
        ['M101', [{ semaine: 'S5', heures: 5, type: 'P' }]],
        ['M102', [{ semaine: 'S5', heures: 10, type: 'P' }]],
      ]),
    });

    const classeur = await lire({ mode: 'groupe', sujets: ['GM101'] });
    const charge = classeur.getWorksheet('Charge formateurs');

    const rangDe = (nom) =>
      charge.getColumn(1).values.findIndex((valeur) => valeur === nom);

    // Colonne de S5 = 1 (sujet) + 5.
    const brahim = charge.getCell(rangDe('BRAHIM LOURID'), 6).value?.formula ?? '';
    const said = charge.getCell(rangDe('SAID AMMARI'), 6).value?.formula ?? '';

    // Chacun pointe UNE cellule, celle de son propre module : deux lignes
    // distinctes de l'onglet GM101.
    expect(brahim).toMatch(/^SUM\('GM101'!\w+\d+\)$/);
    expect(said).toMatch(/^SUM\('GM101'!\w+\d+\)$/);
    expect(brahim).not.toBe(said);
  });

  it('⚠️ COMPTE UNE SEULE FOIS une séance synchrone mutualisée', async () => {
    /*
     * LA RÈGLE QUI DISTINGUE LES DEUX BILANS. Une séance à distance donnée une
     * fois pour GM101 ET GM102 apparaît sur deux lignes. Le GROUPE reçoit bien
     * ces heures des deux côtés — tout s'additionne. Le FORMATEUR ne la donne
     * qu'une fois : les additionner doublerait sa charge.
     */
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      {
        $push: {
          affectations: {
            $each: [
              {
                formateur: MATRICULE,
                groupe: 'GM101 GM102',
                module: 'M101',
                type: TYPES_COURS.SYNCHRONE,
                s1Heures: 10,
                s2Heures: 0,
              },
              {
                formateur: MATRICULE,
                groupe: 'GM101 GM102',
                module: 'M101',
                type: TYPES_COURS.SYNCHRONE,
                s1Heures: 10,
                s2Heures: 0,
              },
            ],
          },
        },
      }
    );

    const classeur = await lire({ mode: 'groupe', sujets: ['GM101', 'GM102'] });
    const charge = classeur.getWorksheet('Charge formateurs');

    const rang = charge.getColumn(1).values.findIndex((v) => v === 'BRAHIM LOURID');
    const formule = charge.getCell(rang, 6).value?.formula ?? '';

    // Un MAX apparaît : les deux lignes synchrones du même ensemble ne comptent
    // qu'une fois. Une simple somme des quatre cellules serait le défaut.
    expect(formule).toContain('MAX(');

    // Le bilan des GROUPES, lui, additionne : le groupe reçoit bien ces heures.
    const groupes = classeur.getWorksheet('Charge groupes');
    const rangGroupe = groupes.getColumn(1).values.findIndex((v) => v === 'GM101');
    expect(groupes.getCell(rangGroupe, 6).value?.formula ?? '').not.toContain('MAX(');
  });

  /*
   * ═══ ⚠️ ET LA FEUILLE DU FORMATEUR AUSSI ═══
   * (2026-08-26, demande du porteur : « en export Excel formateur, traite aussi
   * le calcul doublant de la masse horaire synchrone ».) Une séance fusionnée
   * occupe une LIGNE PAR GROUPE, chacune portant la masse entière : additionner
   * la colonne doublait la charge synchrone sur la feuille qu'on lit en premier.
   */
  it('⚠️ le TOTAL d’un onglet formateur ne compte le synchrone qu’une fois', async () => {
    // La même séance mutualisée que ci-dessus — chaque test repart d'une base
    // propre, le montage ne se transmet pas.
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      {
        $push: {
          affectations: {
            formateur: MATRICULE,
            groupe: 'GM101 GM102',
            module: 'M101',
            type: TYPES_COURS.SYNCHRONE,
            s1Heures: 10,
            s2Heures: 0,
          },
        },
      }
    );

    const classeur = await lire({ mode: 'formateur', sujets: [MATRICULE] });
    /* ⚠️ L'onglet porte le NOM du formateur — « Valeurs » est la source cachée
       des listes déroulantes, et « Charge … » les deux bilans. */
    const feuille = classeur.getWorksheet('BRAHIM LOURID');
    const rangTotal = feuille.getColumn(1).values.findIndex((v) => v === 'TOTAL');
    expect(rangTotal).toBeGreaterThan(0);

    /* ⚠️ ON REPÈRE LES COLONNES PAR LEUR EN-TÊTE, jamais par un décalage : le
       nombre de colonnes fixes change avec le mode, et un index calculé de tête
       tombe à côté sans rien signaler. */
    const colonneDe = (libelle) => {
      for (let r = 1; r <= 8; r += 1) {
        const ligne = feuille.getRow(r);
        for (let c = 1; c <= feuille.columnCount; c += 1) {
          const v = ligne.getCell(c).value;
          if (typeof v === 'string' && v.replace(/\s+/g, ' ').trim() === libelle) return c;
        }
      }
      return -1;
    };
    const colSyn = colonneDe('MH PREVU (SYN)');
    const colP = colonneDe('MH PREVU (P)');
    expect(colSyn).toBeGreaterThan(0);

    const prevuSyn = feuille.getCell(rangTotal, colSyn).value?.formula ?? '';
    const prevuPresentiel = feuille.getCell(rangTotal, colP).value?.formula ?? '';

    // Le synchrone mutualisé passe par un MAX ; le présentiel, lui, s'additionne.
    expect(prevuSyn).toContain('MAX(');
    expect(prevuPresentiel).not.toContain('MAX(');
    expect(prevuPresentiel).toContain('SUM(');
  });

  it('DIT qu’un bilan ne couvre que les onglets du classeur', async () => {
    /*
     * En mode groupe, la feuille des formateurs ne voit que les groupes
     * exportés : la charge de quelqu'un qui enseigne ailleurs y paraît plus
     * légère. Un total partiel pris pour le total réel enverrait charger
     * davantage une personne déjà pleine.
     */
    const classeur = await lire({ mode: 'groupe', sujets: ['GM101'] });
    const charge = classeur.getWorksheet('Charge formateurs');

    const textes = charge.getColumn(1).values.filter((v) => typeof v === 'string');
    expect(textes.some((t) => t.includes('onglets de ce classeur'))).toBe(true);

    // Le bilan des groupes, lui, est COMPLET en mode groupe : pas de mention.
    const groupes = classeur.getWorksheet('Charge groupes');
    const autres = groupes.getColumn(1).values.filter((v) => typeof v === 'string');
    expect(autres.some((t) => t.includes('onglets de ce classeur'))).toBe(false);
  });

  it('les feuilles de charge restent ÉCARTÉES à la relecture', async () => {
    // Elles n'ont jamais été destinées à revenir : les relire comme des données
    // remplirait le rapport de lignes que personne ne peut corriger.
    await Chronogramme.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      groupe: 'GM101',
      planning: new Map([['M101', [{ semaine: 'S5', heures: 5, type: 'P' }]]]),
    });

    const reponse = await request(app)
      .post('/api/v2/chronogrammes/export')
      .set('Cookie', cookies)
      .responseType('blob')
      .send({ mode: 'groupe', sujets: ['GM101'] });

    const retour = await request(app)
      .post('/api/v2/chronogrammes/import')
      .set('Cookie', cookies)
      .attach('fichier', Buffer.from(reponse.body), 'aller-retour.xlsx');

    expect(retour.status).toBe(200);
    expect(retour.body.ecrites).toBe(0);
    expect(retour.body.rapport.map((f) => f.feuille)).toEqual(['GM101']);
  });
});


describe('Charge hebdomadaire — GET /charge', () => {
  const lire = () => request(app).get('/api/v2/chronogrammes/charge').set('Cookie', cookies);

  it('calcule sur TOUS les chronogrammes, sans rien afficher', async () => {
    /*
     * L'ancien calcul lisait les sélecteurs de la page : pour connaître la
     * charge réelle d'une personne, il fallait cocher les vingt groupes et
     * attendre que les grilles se montent — précisément ce qu'on cherche à
     * éviter en ouvrant ce tableau.
     */
    await Chronogramme.create([
      {
        etablissementId: etablissement.id,
        anneeScolaire: ANNEE,
        groupe: 'GM101',
        planning: new Map([['M101', [{ semaine: 'S5', heures: 5, type: 'P' }]]]),
      },
      {
        etablissementId: etablissement.id,
        anneeScolaire: ANNEE,
        groupe: 'GM102',
        planning: new Map([['M101', [{ semaine: 'S5', heures: 5, type: 'P' }]]]),
      },
    ]);

    const reponse = await lire();

    expect(reponse.status).toBe(200);
    expect(reponse.body.groupesLus).toBe(2);
    // BRAHIM LOURID enseigne M101 aux deux groupes : sa charge les cumule.
    expect(reponse.body.formateurs['BRAHIM LOURID'].semaines['5'].total).toBe(10);
    // Chaque groupe, lui, ne reçoit que ses 5 h.
    expect(reponse.body.groupes.GM101.semaines['5'].total).toBe(5);
    expect(reponse.body.groupes.GM102.semaines['5'].total).toBe(5);
  });

  it('⚠️ ne compte QU’UNE FOIS une séance synchrone mutualisée', async () => {
    // Il ne la donne qu'une fois : la compter par groupe ferait croire à une
    // surcharge inexistante, que le générateur ignore.
    await Base.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE },
      {
        $push: {
          affectations: {
            formateur: MATRICULE,
            groupe: 'GM101 GM102',
            module: 'M101',
            type: TYPES_COURS.SYNCHRONE,
            s1Heures: 10,
            s2Heures: 0,
          },
        },
      }
    );

    await Chronogramme.create([
      {
        etablissementId: etablissement.id,
        anneeScolaire: ANNEE,
        groupe: 'GM101',
        planning: new Map([['M101', [{ semaine: 'S5', heures: 10, type: 'S' }]]]),
      },
      {
        etablissementId: etablissement.id,
        anneeScolaire: ANNEE,
        groupe: 'GM102',
        planning: new Map([['M101', [{ semaine: 'S5', heures: 10, type: 'S' }]]]),
      },
    ]);

    const reponse = await lire();

    expect(reponse.body.formateurs['BRAHIM LOURID'].semaines['5'].synchrone).toBe(10);
    // Les deux groupes, eux, reçoivent bien ces heures.
    expect(reponse.body.groupes.GM101.semaines['5'].total).toBe(10);
    expect(reponse.body.groupes.GM102.semaines['5'].total).toBe(10);
  });

  it('ÉCARTE un chronogramme dont le groupe a disparu de la base', async () => {
    /*
     * Un chronogramme survivant à un changement de carte porterait une charge
     * que plus personne n'assure — et la personne à qui elle serait attribuée
     * n'y peut rien.
     */
    await Chronogramme.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      groupe: 'FANTOME101',
      planning: new Map([['M101', [{ semaine: 'S5', heures: 20, type: 'P' }]]]),
    });

    const reponse = await lire();

    expect(reponse.body.groupesIgnores).toEqual(['FANTOME101']);
    expect(reponse.body.groupes.FANTOME101).toBeUndefined();
  });

  it('rend deux objets VIDES quand rien n’est planifié', async () => {
    // État attendu, pas erreur : un directeur qui vient de configurer son
    // établissement n'a encore aucune heure posée.
    const reponse = await lire();

    expect(reponse.status).toBe(200);
    expect(reponse.body.formateurs).toEqual({});
    expect(reponse.body.groupes).toEqual({});
  });

  it('n’est PAS captée par la route d’un groupe', async () => {
    // « charge » et « par-formateur » se ressemblent : déclarée après
    // `/:groupe`, elle chercherait un groupe de ce nom et répondrait 404.
    const reponse = await lire();
    expect(reponse.status).toBe(200);
    expect(reponse.body).toHaveProperty('formateurs');
  });
});

/**
 * ═══ LE GEL DES SEMAINES ANTÉRIEURES À LA RENTRÉE ═══
 * (demande du porteur, 2026-09-02 : « figé sur l'emploi ET le chronogramme ».)
 *
 * Repères de 2026-2027 : S1 = lundi 31 août → samedi 5 septembre,
 * S2 = lundi 7 → samedi 12. Les 1ʳᵉ années reprennent le VENDREDI 11.
 */
describe('Rentrée — le chronogramme se gèle avant', () => {
  const poserRentree = () =>
    CalendrierNational.create({
      anneeScolaire: ANNEE,
      vacances: [],
      rentrees: [{ anneeFormation: 1, date: '2026-09-11' }],
    });

  it('ne gèle RIEN tant qu’aucune rentrée n’est paramétrée', async () => {
    const reponse = await request(app)
      .get('/api/v2/chronogrammes/GM101')
      .set('Cookie', cookies)
      .expect(200);

    expect(reponse.body.semaines[0]).toMatchObject({ numero: 1, disponible: true, motif: null });
  });

  it('FERME la semaine entièrement antérieure, et RÉDUIT celle à cheval', async () => {
    await poserRentree();

    const reponse = await request(app)
      .get('/api/v2/chronogrammes/GM101')
      .set('Cookie', cookies)
      .expect(200);

    const s1 = reponse.body.semaines.find((s) => s.numero === 1);
    const s2 = reponse.body.semaines.find((s) => s.numero === 2);

    expect(s1).toMatchObject({ disponible: false, motif: 'rentree', rentree: '2026-09-11' });
    // Vendredi et samedi restent ouverts : fermer la colonne les perdrait.
    expect(s2).toMatchObject({ disponible: true, motif: null, joursRentree: 4 });
    expect(s2.joursDisponibles).toBe(2);
  });

  /*
   * ⚠️ EN VUE PAR FORMATEUR, LA COLONNE COMMUNE N'EST JAMAIS GELÉE : la même
   * personne peut avoir ses 2ᵉ années présentes quand ses 1ʳᵉ ne le sont pas.
   * Le gel descend LIGNE PAR LIGNE, exactement comme le stage.
   */
  it('descend ligne par ligne en vue par formateur', async () => {
    await poserRentree();

    const reponse = await parFormateur().expect(200);

    expect(reponse.body.semaines[0].motif).toBe(null);
    expect(reponse.body.rentreesParGroupe.GM101).toMatchObject({ date: '2026-09-11' });
    expect(reponse.body.rentreesParGroupe.GM101.semaines).toContainEqual({
      numero: 1,
      jours: 6,
    });
    expect(reponse.body.rentreesParGroupe.GM101.semaines).toContainEqual({
      numero: 2,
      jours: 4,
    });
  });

  /*
   * Les vacances du RÉSEAU s'appliquent au chronogramme comme à la grille :
   * les lire d'un seul côté ferait diverger les deux écrans, une semaine
   * fermée ici et ouverte là.
   */
  it('applique les vacances du réseau', async () => {
    await CalendrierNational.create({
      anneeScolaire: ANNEE,
      vacances: [{ nom: 'Toussaint', debut: '2026-10-26', fin: '2026-11-01' }],
      rentrees: [],
    });

    const reponse = await request(app)
      .get('/api/v2/chronogrammes/GM101')
      .set('Cookie', cookies)
      .expect(200);

    const touchee = reponse.body.semaines.find(
      (s) => s.debut <= '2026-10-26' && s.fin >= '2026-10-26'
    );
    expect(touchee.motif).toBe('vacances');
  });

  it('n’applique PAS une période nationale que l’établissement a écartée', async () => {
    await CalendrierNational.create({
      anneeScolaire: ANNEE,
      vacances: [{ nom: 'Toussaint', debut: '2026-10-26', fin: '2026-11-01' }],
      rentrees: [],
    });
    etablissement.calendrier = { vacances: [], vacancesEcartees: ['Toussaint'] };
    await etablissement.save();

    const reponse = await request(app)
      .get('/api/v2/chronogrammes/GM101')
      .set('Cookie', cookies)
      .expect(200);

    const touchee = reponse.body.semaines.find(
      (s) => s.debut <= '2026-10-26' && s.fin >= '2026-10-26'
    );
    expect(touchee.motif).toBe(null);
  });
});
