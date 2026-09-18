import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Repartition } from '../../src/models/Repartition.js';
/* ⚠️ `COLONNES_REPARTITION`, PAS `COLONNES` : le barillet du domaine exporte
   déjà un `COLONNES` (e-note), et deux noms identiques y sont SILENCIEUSEMENT
   abandonnés — le piège de `calculerCharges`, consigné le 2026-08-21. */
import { COLONNES_REPARTITION as COLONNES } from 'shared/domain';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Référentiel DRIF — écriture (F15, administrateur seul).
 * ← api/admin/upload_repartition.php + database/supprimer_filiere_repartition.php
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const BASE = '/api/v2/admin/repartitions';

const ENTETES = Object.keys(COLONNES);

let cookiesAdmin;

async function creerCompte({ email, role, statut = STATUTS_COMPTE.APPROUVE }) {
  return User.create({
    nomComplet: `Compte ${email}`,
    email,
    motDePasse: MOT_DE_PASSE,
    role,
    statut,
    estVerifie: true,
  });
}

async function connecter(email) {
  const reponse = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: email, motDePasse: MOT_DE_PASSE });
  return reponse.headers['set-cookie'];
}

/** Une ligne de référentiel, telle que le modèle la porte. */
const ligne = (surcharges = {}) => ({
  secteur: 'Aéronautique',
  niveauFormation: 'TS',
  typeFormation: 'Diplômante',
  creneau: 'RES',
  codeFiliereDrif: 'AE_TEST',
  intituleFiliere: 'Filière de test',
  codeFiliereCarte: 'AE_TEST',
  filiere: 'Filière de test',
  anneeFormation: 1,
  codeModule: 'M101',
  module: 'Anglais',
  mhpS1: 30,
  mhpS2: 0,
  efmRegional: false,
  metier: 'construction',
  ...surcharges,
});

/** Classeur DRIF : une feuille « RepartitionHoraire », en-têtes en ligne 1. */
async function classeur(lignes, nomFeuille = 'RepartitionHoraire') {
  const workbook = new ExcelJS.Workbook();
  const feuille = workbook.addWorksheet(nomFeuille);
  feuille.addRow(ENTETES);

  for (const valeurs of lignes) {
    feuille.addRow(
      ENTETES.map((intitule) => {
        const champ = COLONNES[intitule];
        const valeur = valeurs[champ];
        if (champ === 'efmRegional') return valeur ? 'O' : 'N';
        return valeur ?? '';
      })
    );
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

beforeEach(async () => {
  await creerCompte({ email: 'admin@edtpro.ma', role: ROLES.ADMIN });
  cookiesAdmin = await connecter('admin@edtpro.ma');
});

describe('Accès au référentiel DRIF', () => {
  /*
   * ═══ ⚠️ LE RÉFÉRENTIEL EST NATIONAL ═══
   * Une ligne modifiée s'applique aux 1 003 filières que voient TOUS les
   * établissements. L'écriture est donc réservée à l'administrateur (décision
   * du porteur, 2026-09-02) — c'était déjà le choix de l'existant.
   */
  it('refuse un directeur, même approuvé', async () => {
    await creerCompte({ email: 'directeur@edtpro.ma', role: ROLES.DIRECTEUR });
    const cookies = await connecter('directeur@edtpro.ma');

    const reponse = await request(app).get(BASE).set('Cookie', cookies);

    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('ROLE_INSUFFISANT');
  });

  it('refuse un visiteur non authentifié', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  /*
   * ⚠️ LA LECTURE RESTE OUVERTE AUX DIRECTEURS sur l'autre route : leur carte
   * d'établissement ne peut pas se construire sans ce catalogue. Restreindre
   * les deux d'un même geste aurait cassé la Phase 4.
   */
  it('laisse un directeur lire la cascade sur /repartitions', async () => {
    await Repartition.create(ligne());
    await creerCompte({ email: 'lecteur@edtpro.ma', role: ROLES.DIRECTEUR });
    const cookies = await connecter('lecteur@edtpro.ma');

    const reponse = await request(app).get('/api/v2/repartitions/secteurs').set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(reponse.body.secteurs).toContain('Aéronautique');
  });
});

describe('Consultation du référentiel', () => {
  beforeEach(async () => {
    await Repartition.create([
      ligne(),
      ligne({ codeModule: 'M102', module: 'Français' }),
      ligne({ anneeFormation: 2, codeModule: 'M201', module: 'Mécanique' }),
      ligne({
        secteur: 'Digital',
        codeFiliereDrif: 'DI_TEST',
        intituleFiliere: 'Développement',
        codeModule: 'M301',
        module: 'Programmation',
      }),
    ]);
  });

  it('liste, filtre et pagine', async () => {
    const tout = await request(app).get(`${BASE}?parPage=10`).set('Cookie', cookiesAdmin);
    expect(tout.body.total).toBe(4);

    const parSecteur = await request(app)
      .get(`${BASE}?secteur=Digital`)
      .set('Cookie', cookiesAdmin);
    expect(parSecteur.body.total).toBe(1);
    expect(parSecteur.body.lignes[0].codeModule).toBe('M301');

    const parAnnee = await request(app).get(`${BASE}?annee=2`).set('Cookie', cookiesAdmin);
    expect(parAnnee.body.total).toBe(1);
  });

  /*
   * ⚠️ LA RECHERCHE EST ÉCHAPPÉE : un intitulé DRIF contient des parenthèses et
   * des points — « Génie Mécanique (option E.M.) ». Non échappée, l'expression
   * serait invalide ou filtrerait autre chose que ce qui a été tapé.
   */
  it('cherche sans se laisser abuser par les caractères spéciaux', async () => {
    await Repartition.create(
      ligne({ codeModule: 'M999', module: 'Génie (option E.M.)' })
    );

    const reponse = await request(app)
      .get(`${BASE}?recherche=${encodeURIComponent('(option E.M.)')}`)
      .set('Cookie', cookiesAdmin);

    expect(reponse.status).toBe(200);
    expect(reponse.body.total).toBe(1);
    expect(reponse.body.lignes[0].codeModule).toBe('M999');
  });

  /*
   * ═══ LES FILTRES PAR FILIÈRE, CRÉNEAU ET MÉTIER ═══ (demande du porteur,
   * 2026-09-02.)
   *
   * ⚠️ LE MÉTIER EST UNE ÉGALITÉ EXACTE, PAS UNE RECHERCHE : la valeur vient de
   * la liste que le serveur a lui-même publiée. Une expression régulière ferait
   * qu'« Achat » rendrait aussi « Achat/approvisionnement » — deux métiers
   * DISTINCTS du référentiel réel.
   */
  it('filtre par filiere, creneau et metier', async () => {
    await Repartition.create([
      ligne({ codeModule: 'M900', creneau: 'CDS', metier: 'Achat' }),
      ligne({ codeModule: 'M901', metier: 'Achat/approvisionnement' }),
    ]);

    const parFiliere = await request(app)
      .get(`${BASE}?filiere=DI_TEST`)
      .set('Cookie', cookiesAdmin);
    expect(parFiliere.body.total).toBe(1);
    expect(parFiliere.body.lignes[0].codeModule).toBe('M301');

    const parCreneau = await request(app).get(`${BASE}?creneau=CDS`).set('Cookie', cookiesAdmin);
    expect(parCreneau.body.total).toBe(1);
    expect(parCreneau.body.lignes[0].codeModule).toBe('M900');

    const parMetier = await request(app)
      .get(`${BASE}?metier=${encodeURIComponent('Achat')}`)
      .set('Cookie', cookiesAdmin);
    expect(parMetier.body.total).toBe(1);
    expect(parMetier.body.lignes[0].codeModule).toBe('M900');
  });

  /*
   * ═══ ⚠️ FILIÈRE ET MÉTIER SONT DEUX LISTES SŒURS ═══
   * Elles se réduisent au secteur, au niveau, au créneau et à l'année déjà
   * choisis — jamais l'une à l'autre. Se rétrécir mutuellement finirait par ne
   * plus rien proposer, et l'on ne pourrait plus revenir en arrière.
   */
  it('scope les metiers au perimetre, mais pas a la filiere retenue', async () => {
    /* Un métier propre à chaque secteur : c'est ce qui rend le scope
       observable — sans cela, les deux listes se ressembleraient. */
    await Repartition.create([
      ligne({ codeModule: 'M902', metier: 'Aviation' }),
      ligne({ secteur: 'Digital', codeFiliereDrif: 'DI_TEST', codeModule: 'M302', metier: 'Programmation' }),
    ]);

    const tous = await request(app).get(`${BASE}/metiers`).set('Cookie', cookiesAdmin);
    expect(tous.body.metiers).toContain('Aviation');
    expect(tous.body.metiers).toContain('Programmation');

    /* Le secteur RÉDUIT la liste… */
    const parSecteur = await request(app)
      .get(`${BASE}/metiers?secteur=Digital`)
      .set('Cookie', cookiesAdmin);
    expect(parSecteur.body.metiers).toContain('Programmation');
    expect(parSecteur.body.metiers).not.toContain('Aviation');

    /* …mais la filière retenue, NON : on doit pouvoir en changer. */
    const avecFiliere = await request(app)
      .get(`${BASE}/metiers?filiere=AE_TEST`)
      .set('Cookie', cookiesAdmin);
    expect(avecFiliere.body.metiers).toContain('Programmation');
  });

  /* Même règle en sens inverse : la liste des filières ignore le métier retenu,
     et la filière déjà choisie — sinon on ne pourrait plus en changer. */
  it('scope les filieres au perimetre, sans se reduire a elle-meme', async () => {
    const avecFiliere = await request(app)
      .get(`${BASE}/filieres?filiere=AE_TEST`)
      .set('Cookie', cookiesAdmin);

    expect(avecFiliere.body.filieres.map((f) => f.code).sort()).toEqual(['AE_TEST', 'DI_TEST']);

    const parSecteur = await request(app)
      .get(`${BASE}/filieres?secteur=Digital`)
      .set('Cookie', cookiesAdmin);
    expect(parSecteur.body.filieres.map((f) => f.code)).toEqual(['DI_TEST']);
  });

  /* ⚠️ ON NE PROPOSE QUE CE QUI EXISTE — la règle des facettes du produit. */
  it('rend les facettes réellement présentes', async () => {
    const { body } = await request(app).get(`${BASE}/facettes`).set('Cookie', cookiesAdmin);

    expect(body.secteurs).toEqual(['Aéronautique', 'Digital']);
    expect(body.annees).toEqual([1, 2]);
    expect(body.total).toBe(4);
  });

  it('groupe les filières par code, avec leurs années et leurs modules', async () => {
    const { body } = await request(app).get(`${BASE}/filieres`).set('Cookie', cookiesAdmin);

    const test = body.filieres.find((f) => f.code === 'AE_TEST');
    expect(test.modules).toBe(3);
    expect(test.annees).toEqual([
      { annee: 1, modules: 2 },
      { annee: 2, modules: 1 },
    ]);
  });
});

describe('Saisie manuelle', () => {
  it('crée une ligne', async () => {
    const reponse = await request(app).post(BASE).set('Cookie', cookiesAdmin).send(ligne());

    expect(reponse.status).toBe(201);
    expect(reponse.body.ligne.codeModule).toBe('M101');
    expect(await Repartition.countDocuments()).toBe(1);
  });

  /*
   * ═══ ⚠️ L'IDENTITÉ EST (FILIÈRE, ANNÉE, CODE MODULE), SANS L'INTITULÉ ═══
   * L'index unique portait le LIBELLÉ jusqu'au 2026-09-02, si bien qu'un module
   * ressaisi sous un autre nom entrait en double — et apparaissait deux fois
   * dans la cascade de la carte. Le refus est ici EXPLIQUÉ, pas rendu sous la
   * forme brute d'un `E11000 duplicate key`.
   */
  it('refuse un module déjà présent, même sous un autre intitulé', async () => {
    await Repartition.create(ligne());

    const reponse = await request(app)
      .post(BASE)
      .set('Cookie', cookiesAdmin)
      .send(ligne({ module: 'Anglais technique' }));

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('MODULE_EN_DOUBLE');
    expect(await Repartition.countDocuments()).toBe(1);
  });

  it('modifie une masse horaire', async () => {
    const creee = await Repartition.create(ligne());

    const reponse = await request(app)
      .patch(`${BASE}/${creee.id}`)
      .set('Cookie', cookiesAdmin)
      .send({ mhpS1: 45, efmRegional: true });

    expect(reponse.status).toBe(200);
    expect(reponse.body.ligne.mhpS1).toBe(45);
    expect(reponse.body.ligne.efmRegional).toBe(true);
    /* Les champs non envoyés ne bougent pas : la modification est partielle. */
    expect(reponse.body.ligne.module).toBe('Anglais');
  });

  /* ⚠️ Une masse négative ferait RECULER un taux d'avancement. */
  it('refuse une masse horaire négative', async () => {
    const creee = await Repartition.create(ligne());

    const reponse = await request(app)
      .patch(`${BASE}/${creee.id}`)
      .set('Cookie', cookiesAdmin)
      .send({ mhpS1: -5 });

    expect(reponse.status).toBe(400);
  });

  it('refuse une modification qui ferait entrer en collision deux modules', async () => {
    await Repartition.create(ligne());
    const seconde = await Repartition.create(ligne({ codeModule: 'M102', module: 'Français' }));

    const reponse = await request(app)
      .patch(`${BASE}/${seconde.id}`)
      .set('Cookie', cookiesAdmin)
      .send({ codeModule: 'M101' });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('MODULE_EN_DOUBLE');
    /* Rien n'a bougé. */
    expect((await Repartition.findById(seconde.id)).codeModule).toBe('M102');
  });

  it('supprime une ligne', async () => {
    const creee = await Repartition.create(ligne());

    const reponse = await request(app).delete(`${BASE}/${creee.id}`).set('Cookie', cookiesAdmin);

    expect(reponse.status).toBe(200);
    expect(reponse.body.supprimees).toBe(1);
    expect(await Repartition.countDocuments()).toBe(0);
  });
});

describe('Suppression par filière', () => {
  beforeEach(async () => {
    await Repartition.create([
      ligne(),
      ligne({ codeModule: 'M102' }),
      ligne({ anneeFormation: 2, codeModule: 'M201' }),
      ligne({ codeFiliereDrif: 'DI_TEST', codeModule: 'M301' }),
    ]);
  });

  /* ← `supprimer_filiere_repartition.php <CODE> --annee=N --apply` */
  it('ne retire qu’une année quand elle est précisée', async () => {
    const reponse = await request(app)
      .delete(`${BASE}/filieres/AE_TEST?annee=1`)
      .set('Cookie', cookiesAdmin);

    expect(reponse.status).toBe(200);
    expect(reponse.body.supprimees).toBe(2);
    /* La filière survit : son année 2 est intacte. */
    expect(reponse.body.restantes).toBe(1);
    expect(await Repartition.countDocuments({ codeFiliereDrif: 'AE_TEST' })).toBe(1);
  });

  it('retire la filière entière quand aucune année n’est précisée', async () => {
    const reponse = await request(app)
      .delete(`${BASE}/filieres/AE_TEST`)
      .set('Cookie', cookiesAdmin);

    expect(reponse.body.supprimees).toBe(3);
    expect(reponse.body.restantes).toBe(0);
    /* ⚠️ ET RIEN D'AUTRE : une autre filière ne doit jamais être emportée. */
    expect(await Repartition.countDocuments({ codeFiliereDrif: 'DI_TEST' })).toBe(1);
  });

  it('rend 404 sur une filière inconnue plutôt qu’un succès vide', async () => {
    const reponse = await request(app)
      .delete(`${BASE}/filieres/INEXISTANTE`)
      .set('Cookie', cookiesAdmin);

    expect(reponse.status).toBe(404);
  });
});

describe('Import d’un classeur DRIF', () => {
  /*
   * ═══ ⚠️ L'ANALYSE N'ÉCRIT RIEN ═══
   * Un fichier de 13 000 lignes appliqué au premier clic ne laisse aucune
   * chance de se raviser. ← le mode « analyse » de `upload_repartition.php`.
   */
  it('analyse sans rien écrire', async () => {
    const fichier = await classeur([ligne(), ligne({ codeModule: 'M102' })]);

    const reponse = await request(app)
      .post(`${BASE}/import`)
      .set('Cookie', cookiesAdmin)
      .field('mode', 'analyse')
      .attach('fichier', fichier, 'repartition.xlsx');

    expect(reponse.status).toBe(200);
    expect(reponse.body.applique).toBe(false);
    expect(reponse.body.ajouts).toBe(2);
    expect(reponse.body.feuille).toBe('RepartitionHoraire');
    expect(await Repartition.countDocuments()).toBe(0);
  });

  it('ajoute les lignes nouvelles quand on applique', async () => {
    const fichier = await classeur([ligne(), ligne({ codeModule: 'M102' })]);

    const reponse = await request(app)
      .post(`${BASE}/import`)
      .set('Cookie', cookiesAdmin)
      .field('mode', 'appliquer')
      .attach('fichier', fichier, 'repartition.xlsx');

    expect(reponse.body.applique).toBe(true);
    expect(reponse.body.ajouts).toBe(2);
    expect(await Repartition.countDocuments()).toBe(2);
  });

  /*
   * ═══ ⚠️ UNE CORRECTION NE S'APPLIQUE QUE SI ON LA DEMANDE ═══
   * `upload_repartition.php` était strictement additif : une masse corrigée par
   * la DRIF passait inaperçue. Elle est désormais VUE dans tous les cas, et
   * appliquée seulement sur demande explicite.
   */
  it('voit une masse corrigée sans l’appliquer par défaut', async () => {
    await Repartition.create(ligne());
    const fichier = await classeur([ligne({ mhpS1: 45 })]);

    const reponse = await request(app)
      .post(`${BASE}/import`)
      .set('Cookie', cookiesAdmin)
      .field('mode', 'appliquer')
      .attach('fichier', fichier, 'repartition.xlsx');

    expect(reponse.body.ajouts).toBe(0);
    expect(reponse.body.corrections).toBe(1);
    expect(reponse.body.correctionsAppliquees).toBe(0);
    expect((await Repartition.findOne()).mhpS1).toBe(30);
  });

  it('applique la correction quand elle est demandée', async () => {
    await Repartition.create(ligne());
    const fichier = await classeur([ligne({ mhpS1: 45, module: 'Anglais technique' })]);

    const reponse = await request(app)
      .post(`${BASE}/import`)
      .set('Cookie', cookiesAdmin)
      .field('mode', 'appliquer')
      .field('corrections', 'true')
      .attach('fichier', fichier, 'repartition.xlsx');

    expect(reponse.body.correctionsAppliquees).toBe(1);

    /* ⚠️ CORRIGÉE, PAS DÉDOUBLÉE : c'est tout l'objet de l'index aligné. */
    expect(await Repartition.countDocuments()).toBe(1);
    const apres = await Repartition.findOne();
    expect(apres.mhpS1).toBe(45);
    expect(apres.module).toBe('Anglais technique');
  });

  /*
   * ═══ ⚠️⚠️ LE REMPLACEMENT INTÉGRAL ═══ (demande explicite du porteur,
   * 2026-09-02, qui revient sur le choix « ajouter / corriger ».)
   *
   * Il VIDE le référentiel avant d'écrire le fichier. Ce test fige les deux
   * moitiés de la promesse : ce qui reste est EXACTEMENT le contenu du
   * classeur, et le compte annoncé à l'analyse est celui qui se produit.
   */
  it('remplace tout le referentiel par le contenu du classeur', async () => {
    await Repartition.create([
      ligne(),
      ligne({ codeModule: 'M102' }),
      ligne({ codeFiliereDrif: 'DI_TEST', codeModule: 'M301' }),
    ]);

    const fichier = await classeur([ligne({ mhpS1: 45 }), ligne({ codeModule: 'M999' })]);

    /* L'analyse ANNONCE la perte, sans rien écrire. */
    const analyse = await request(app)
      .post(`${BASE}/import`)
      .set('Cookie', cookiesAdmin)
      .field('mode', 'analyse')
      .attach('fichier', fichier, 'r.xlsx');

    expect(analyse.body.totalEnBase).toBe(3);
    expect(analyse.body.apresRemplacement).toBe(2);
    /* M101 est dans le fichier (corrigée) : elle survit. M102 et M301, non. */
    expect(analyse.body.supprimeesSiRemplacement).toBe(2);
    expect(await Repartition.countDocuments()).toBe(3);

    const applique = await request(app)
      .post(`${BASE}/import`)
      .set('Cookie', cookiesAdmin)
      .field('mode', 'remplacer')
      .attach('fichier', fichier, 'r.xlsx');

    expect(applique.body.remplace).toBe(true);
    expect(applique.body.supprimees).toBe(2);
    expect(applique.body.total).toBe(2);

    const restantes = await Repartition.find().sort({ codeModule: 1 });
    expect(restantes.map((l) => l.codeModule)).toEqual(['M101', 'M999']);
    /* La ligne conservée porte la valeur du FICHIER, pas l'ancienne. */
    expect(restantes[0].mhpS1).toBe(45);
    /* Et la filière absente du classeur a bien disparu. */
    expect(await Repartition.countDocuments({ codeFiliereDrif: 'DI_TEST' })).toBe(0);
  });

  /*
   * ⚠️ UNE CLÉ RÉPÉTÉE DANS LE FICHIER NE DOIT PAS FAIRE ÉCHOUER L'INSERTION
   * APRÈS LE VIDAGE : l'index unique la refuserait, et il ne resterait RIEN.
   * Le dédoublonnage garde la dernière, comme l'annonce l'analyse.
   */
  it('remplace sans se laisser arreter par un doublon du fichier', async () => {
    await Repartition.create(ligne({ codeModule: 'M102' }));

    const fichier = await classeur([
      ligne({ mhpS1: 10 }),
      ligne({ mhpS1: 20 }),
    ]);

    const reponse = await request(app)
      .post(`${BASE}/import`)
      .set('Cookie', cookiesAdmin)
      .field('mode', 'remplacer')
      .attach('fichier', fichier, 'r.xlsx');

    expect(reponse.status).toBe(200);
    expect(await Repartition.countDocuments()).toBe(1);
    expect((await Repartition.findOne()).mhpS1).toBe(20);
  });

  /*
   * ═══ ⚠️ UN CLASSEUR PARTIEL NE SUPPRIME JAMAIS RIEN ═══
   * C'est le risque que l'existant avait explicitement retiré : un fichier
   * d'une seule filière ne doit pas effacer les 13 358 autres lignes.
   */
  it('ne retire aucune ligne absente du fichier', async () => {
    await Repartition.create([ligne(), ligne({ codeFiliereDrif: 'DI_TEST', codeModule: 'M301' })]);
    const fichier = await classeur([ligne({ codeModule: 'M102' })]);

    await request(app)
      .post(`${BASE}/import`)
      .set('Cookie', cookiesAdmin)
      .field('mode', 'appliquer')
      .attach('fichier', fichier, 'repartition.xlsx');

    expect(await Repartition.countDocuments()).toBe(3);
    expect(await Repartition.countDocuments({ codeFiliereDrif: 'DI_TEST' })).toBe(1);
  });

  /*
   * ═══ ⚠️ LA FEUILLE DE SYNTHÈSE EST ÉCARTÉE ═══
   * Elle ne porte que des totaux, sans ventilation S1 / S2 : la retenir
   * reviendrait à importer des masses annuelles à la place des masses
   * semestrielles, sans qu'aucun message ne le signale.
   */
  it('choisit la feuille qui porte les colonnes obligatoires', async () => {
    const workbook = new ExcelJS.Workbook();
    const synthese = workbook.addWorksheet('Synthèse');
    synthese.addRow(['Secteur', 'Total']);
    synthese.addRow(['Aéronautique', 120]);

    const donnees = workbook.addWorksheet('Données');
    donnees.addRow(ENTETES);
    donnees.addRow(
      ENTETES.map((intitule) => {
        const valeur = ligne()[COLONNES[intitule]];
        return COLONNES[intitule] === 'efmRegional' ? 'N' : (valeur ?? '');
      })
    );

    const reponse = await request(app)
      .post(`${BASE}/import`)
      .set('Cookie', cookiesAdmin)
      .field('mode', 'analyse')
      .attach('fichier', Buffer.from(await workbook.xlsx.writeBuffer()), 'r.xlsx');

    expect(reponse.body.feuille).toBe('Données');
    expect(reponse.body.ajouts).toBe(1);
  });

  it('refuse un classeur sans colonne obligatoire', async () => {
    const workbook = new ExcelJS.Workbook();
    const feuille = workbook.addWorksheet('Feuille');
    feuille.addRow(['Secteur', 'Autre chose']);
    feuille.addRow(['Aéronautique', 'x']);

    const reponse = await request(app)
      .post(`${BASE}/import`)
      .set('Cookie', cookiesAdmin)
      .attach('fichier', Buffer.from(await workbook.xlsx.writeBuffer()), 'r.xlsx');

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('FEUILLE_INTROUVABLE');
  });

  it('refuse un fichier qui n’est pas un classeur', async () => {
    const reponse = await request(app)
      .post(`${BASE}/import`)
      .set('Cookie', cookiesAdmin)
      .attach('fichier', Buffer.from('nimporte quoi'), 'notes.txt');

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('FORMAT_REFUSE');
  });
});
