import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Base } from '../../src/models/Base.js';
import { EnoteImport } from '../../src/models/EnoteImport.js';
import { Repartition } from '../../src/models/Repartition.js';
import { Chronogramme } from '../../src/models/Chronogramme.js';
import { CalendrierNational } from '../../src/models/CalendrierNational.js';
import { ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';
import {
  ENTETES_ENOTE,
  agregerAvancement,
  semaineDansAnnee,
  totalAvancement,
} from 'shared/domain';

/*
 * ⚠️ LA ROUTE REND LES LIGNES, PAS LES AGRÉGATS — l'écran filtre puis agrège
 * lui-même, avec ces mêmes fonctions de domaine. Les tests les appellent donc
 * aussi : c'est le chemin RÉEL qu'on vérifie, pas une seconde implémentation.
 */
const total = (lignes) => totalAvancement(lignes);
const parAxe = (lignes, axe) => agregerAvancement(lignes, axe);

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Avancement réalisé / prévu (F7) — Phase 7, sous-livraison (a).
 * ← api/data/get_avancement_data.php · get_planned_progress.php
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;
const SEMAINE = '2026-W3';

let etablissement;
let cookies;

beforeEach(async () => {
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
    espaces: ['A12'],
  });

  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [{ matricule: '9863', nomComplet: 'BRAHIM LOURID' }],
    groupes: ['GM101', 'GM102'],
    affectations: [
      { formateur: '9863', groupe: 'GM101', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 },
      { formateur: '9863', groupe: 'GM102', module: 'M101', type: TYPES_COURS.PRESENTIEL, s1Heures: 30 },
      // Une séance SYNCHRONE mutualisée : le libellé fusionné vit dans `groupe`.
      {
        formateur: '9863',
        groupe: 'GM101 GM102',
        module: 'M101',
        type: TYPES_COURS.SYNCHRONE,
        s1Heures: 10,
      },
    ],
  });

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookies = connexion.headers['set-cookie'];
});

const lire = () => request(app).get('/api/v2/avancement').set('Cookie', cookies);
/** Le même écran, rembobiné à une date — ou simplement borné à celle-ci. */
const lireAu = (date) =>
  request(app).get(`/api/v2/avancement?date=${date}`).set('Cookie', cookies);

const poserSeance = (surcharges = {}) =>
  request(app)
    .put(`/api/v2/seances/${SEMAINE}/case`)
    .set('Cookie', cookies)
    .send({
      jour: 'Lundi',
      seance: 'S1',
      periode: 'jour',
      formateurMatricule: '9863',
      groupe: 'GM101',
      module: 'M101',
      salle: 'A12',
      ...surcharges,
    });

/**
 * Rejoue une requête À UNE AUTRE DATE.
 *
 * ⚠️ LA SESSION SE REFAIT SOUS L'HORLOGE FEINTE : l'access token dure quinze
 * minutes, et un cookie obtenu à l'heure RÉELLE est déjà expiré une fois la
 * pendule avancée de deux semaines — la requête revenait en 401, pas en 200.
 *
 * ⚠️ `shouldAdvanceTime` : sans lui, mongodb-memory-server et mongoose voient
 * leurs minuteries gelées, et la requête n'aboutit jamais.
 */
async function auJour(date, requeteur) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(date);
  try {
    const connexion = await request(app)
      .post('/api/v2/auth/connexion')
      .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });

    return await requeteur(connexion.headers['set-cookie']);
  } finally {
    vi.useRealTimers();
  }
}

/** Une ligne e-note, aux 51 colonnes, avec ce qu'on veut y mettre. */
const ligneEnote = (valeurs) => {
  const ligne = Array.from({ length: ENTETES_ENOTE.length }, () => '');
  for (const [index, valeur] of Object.entries(valeurs)) ligne[index] = valeur;
  return ligne;
};

describe('GET /avancement — la face eDTpro', () => {
  it('rend les deux faces et les trois axes', async () => {
    const reponse = await lire();

    expect(reponse.status).toBe(200);
    expect(Object.keys(reponse.body.faces)).toEqual(['edtpro', 'enote']);
    for (const lignes of Object.values(reponse.body.faces)) {
      expect(Array.isArray(lignes)).toBe(true);
      for (const axe of ['formateur', 'groupe', 'module']) {
        expect(Array.isArray(parAxe(lignes, axe))).toBe(true);
      }
    }
  });

  /*
   * ⚠️ LE PRÉVU VIENT DES MASSES AFFECTÉES, et le synchrone mutualisé n'y
   * compte qu'une fois : 30 + 30 en salle, plus 10 à distance pour les DEUX
   * groupes — soit 70, jamais 80.
   */
  it('ne compte le synchrone mutualisé qu’une fois dans le total', async () => {
    const cumul = total((await lire()).body.faces.edtpro);

    expect(cumul.prevuPresentiel).toBe(60);
    expect(cumul.prevuSynchrone).toBe(10);
    expect(cumul.prevu).toBe(70);
  });

  /*
   * ⚠️ CHAQUE GROUPE REÇOIT LA SÉANCE MUTUALISÉE : la somme des groupes dépasse
   * donc le total de l'établissement. C'est voulu, et c'est pourquoi le total
   * ne se calcule jamais sur cet axe.
   */
  it('donne la séance mutualisée à chacun des deux groupes', async () => {
    const groupes = parAxe((await lire()).body.faces.edtpro, 'groupe');

    expect(groupes.map((g) => g.sujet)).toEqual(['GM101', 'GM102']);
    for (const g of groupes) expect(g.prevuSynchrone).toBe(10);
  });

  /*
   * ⚠️ LES AFFECTATIONS PORTENT LE MATRICULE, PAS LE NOM. L'axe formateur
   * afficherait « 9863 » sans la table de correspondance — et l'existant
   * documente ce défaut précis : « la masse horaire planifiée ressortait à zéro
   * pour tous les formateurs ».
   */
  it('nomme le formateur au lieu d’afficher son matricule', async () => {
    const formateurs = parAxe((await lire()).body.faces.edtpro, 'formateur');
    expect(formateurs.map((f) => f.sujet)).toEqual(['BRAHIM LOURID']);
  });

  it('compte les heures posées jusqu’à la date observée', async () => {
    await poserSeance();

    /*
     * ⚠️ LA SÉANCE EST EN 2026-W3, et le réalisé s'arrête par défaut à la
     * SEMAINE EN COURS : on observe donc la fin de la W3 pour la voir comptée.
     * Le test qui suit vérifie l'autre moitié de la règle.
     */
    const modules = parAxe((await lireAu('2026-09-19')).body.faces.edtpro, 'module');
    const m101 = modules.find((m) => m.sujet === 'M101');

    // Une séance de jour vaut 2,5 h.
    expect(m101.realisePresentiel).toBe(2.5);
    expect(m101.taux).toBe(Math.round((2.5 / 70) * 1000) / 10);
  });

  /*
   * ═══ ⚠️⚠️ LE RÉALISÉ S'ARRÊTE À LA SEMAINE EN COURS ═══ (demande du porteur,
   * 2026-09-01.) Sans cette borne, une séance planifiée en juin s'affichait comme
   * déjà faite, et le taux paraissait en avance sur la réalité. « Réalisé » ne
   * peut désigner que ce qui a EU LIEU.
   */
  it('n’avance PAS sur une séance posée sur une semaine À VENIR', async () => {
    await poserSeance();

    /* On se place en S1 : la séance de la W3 est alors dans le futur. */
    const reponse = await auJour(new Date(2026, 8, 2, 12), (jeton) =>
      request(app).get('/api/v2/avancement').set('Cookie', jeton)
    );

    expect(reponse.body.semaineCourante).toBe(1);
    expect(total(reponse.body.faces.edtpro).realise).toBe(0);
  });

  /* ⚠️ ET IL LA COMPTE UNE FOIS LA SEMAINE VENUE — sans quoi la borne ne serait
     pas une borne mais un rejet. */
  it('la compte une fois la semaine atteinte', async () => {
    await poserSeance();

    const reponse = await auJour(new Date(2026, 8, 16, 12), (jeton) =>
      request(app).get('/api/v2/avancement').set('Cookie', jeton)
    );

    expect(reponse.body.semaineCourante).toBe(3);
    expect(total(reponse.body.faces.edtpro).realise).toBe(2.5);
  });

  /*
   * ⚠️ UNE SÉANCE ABSENTE N'AVANCE RIEN : le cours n'a pas eu lieu. La compter
   * ferait croire le programme tenu, et le rattrapage n'apparaîtrait jamais.
   */
  it('n’avance pas sur une séance marquée absente', async () => {
    await poserSeance({ statut: 'absent' });

    expect(total((await lire()).body.faces.edtpro).realise).toBe(0);
  });

  it('rend zéro, et non une erreur, quand rien n’est encore posé', async () => {
    const cumul = total((await lire()).body.faces.edtpro);
    expect(cumul.realise).toBe(0);
    expect(cumul.taux).toBe(0);
  });
});

describe('GET /avancement — la face e-note', () => {
  /*
   * ⚠️ LES DEUX FACES PARTAGENT LE PRÉVU et ne diffèrent que par le RÉALISÉ :
   * e-note le DÉCLARE (colonnes 38-39), la grille le COMPTE. Sans ce partage,
   * l'écart entre les deux colonnes de l'écran ne voudrait rien dire.
   */
  it('lit le réalisé DÉCLARÉ dans le fichier importé', async () => {
    await EnoteImport.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      nomFichier: 'enote.xlsx',
      entete: ENTETES_ENOTE,
      lignes: [
        ligneEnote({ 8: 'GM101', 12: 'GM101 GM102', 16: 'M101', 20: 'BRAHIM LOURID', 22: 'BRAHIM LOURID', 35: '30', 36: '10', 38: '12,5', 39: '5' }),
        ligneEnote({ 8: 'GM102', 12: 'GM101 GM102', 16: 'M101', 20: 'BRAHIM LOURID', 22: 'BRAHIM LOURID', 35: '30', 36: '10', 38: '10', 39: '5' }),
      ],
    });

    const lignes = (await lire()).body.faces.enote;
    const modules = parAxe(lignes, 'module');
    const cumul = total(lignes);

    // ⚠️ « 12,5 » à la VIRGULE : `Number()` rendrait NaN et la masse
    // disparaîtrait de l'agrégat sans que rien ne le signale.
    expect(modules[0].realisePresentiel).toBe(22.5);
    // Le synchrone déclaré ne compte qu'une fois, comme le prévu.
    expect(cumul.realiseSynchrone).toBe(5);
    expect(cumul.prevu).toBe(70);
  });

  it('rend une face VIDE quand aucun fichier n’a été importé', async () => {
    const reponse = await lire();

    expect(reponse.body.source).toBeNull();
    expect(reponse.body.faces.enote).toEqual([]);
    // ⚠️ `null` et non `0` : sans prévu, il n'y a pas de taux — « 0 % » se
    // lirait comme un retard alors qu'il n'y a rien à faire.
    expect(total(reponse.body.faces.enote).taux).toBeNull();
  });

  it('écarte les lignes sans groupe ni module', async () => {
    await EnoteImport.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      nomFichier: 'enote.xlsx',
      entete: ENTETES_ENOTE,
      lignes: [ligneEnote({ 35: '999' }), ligneEnote({ 8: 'GM101', 16: 'M101', 35: '30' })],
    });

    // Une ligne de sous-total gonflerait le prévu sans rien réaliser.
    expect(total((await lire()).body.faces.enote).prevu).toBe(30);
  });
});

describe('GET /avancement — les champs des filtres', () => {
  /*
   * ⚠️ LE MODE DE FORMATION N'EST PAS SUR L'AFFECTATION, il est propre au
   * GROUPE (`Base.groupeModes`). Sans cette lecture, la facette « Mode de
   * formation » resterait vide sur la face eDTpro — une case qui ne rend jamais
   * rien fait douter du filtre plutôt que des données.
   */
  it('porte le mode, le semestre et le niveau sur la face eDTpro', async () => {
    await Base.updateOne({ etablissementId: etablissement.id }, {
      $set: { groupeModes: { GM101: 'Alterné' } },
    });

    const lignes = (await lire()).body.faces.edtpro;
    const gm101 = lignes.find((l) => l.groupe === 'GM101');

    expect(gm101.mode).toBe('Alterné');
    // 30 h en S1 et rien en S2 → le module est du premier semestre.
    expect(gm101.semestre).toBe('S1');
    // ⚠️ Le niveau se lit dans le NUMÉRO du groupe : « GM101 » est en 1ʳᵉ année.
    expect(gm101.annee).toBe(1);
  });

  it('lit les mêmes champs dans les colonnes du fichier e-note', async () => {
    await EnoteImport.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      nomFichier: 'enote.xlsx',
      entete: ENTETES_ENOTE,
      lignes: [
        ligneEnote({ 8: 'SMP201', 15: 'Résidentiel', 16: 'M101', 23: '15', 27: '15', 35: '30' }),
      ],
    });

    const [ligne] = (await lire()).body.faces.enote;

    expect(ligne.mode).toBe('Résidentiel');
    // Des heures des DEUX côtés : le module est annuel.
    expect(ligne.semestre).toBe('A');
    expect(ligne.annee).toBe(2);
  });
});

describe('GET /avancement — les intitulés de modules', () => {
  /*
   * ⚠️ `Base.affectations` NE GARDE QUE LE CODE : « M101 » n'apprend rien, et le
   * nom lisible ne peut venir que de la RÉPARTITION DRIF. Sans cette résolution,
   * la carte au survol de l'écran n'aurait rien à montrer.
   */
  it('rend le nom lisible depuis la répartition DRIF', async () => {
    await Repartition.create({
      secteur: 'Mécanique',
      codeFiliereDrif: 'GM',
      filiere: 'Génie Mécanique',
      anneeFormation: 1,
      codeModule: 'M101',
      module: 'Métrologie et contrôle',
      niveau: 'TS',
      masseHorairePresentiel: 30,
    });

    expect((await lire()).body.intitules.M101).toBe('Métrologie et contrôle');
  });

  /*
   * ⚠️ UN MODULE HORS RÉFÉRENTIEL N'EST PAS UNE ERREUR : la carte permet d'en
   * saisir. Il n'a simplement pas d'entrée, et l'écran affiche le seul code.
   */
  it('n’invente pas d’intitulé pour un module hors référentiel', async () => {
    expect((await lire()).body.intitules.M101).toBeUndefined();
  });
});

describe('GET /avancement/achevement — les plages des modules', () => {
  const lireAchevement = () =>
    request(app).get('/api/v2/avancement/achevement').set('Cookie', cookies);

  /*
   * ⚠️ « PRÉVU S1 → S3, POSÉ S3 » : c'est la DÉRIVE qu'aucun taux ne révèle — un
   * module peut être à 100 % et avoir fini deux mois après la date prévue.
   */
  it('rend la plage prévue au chronogramme et celle posée dans la grille', async () => {
    await Chronogramme.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      groupe: 'GM101',
      planning: {
        M101: [
          { semaine: 'S1', heures: 5, type: 'P' },
          { semaine: 'S3', heures: 5, type: 'P' },
        ],
      },
    });
    await poserSeance();

    /* Même borne que les taux : la séance est en W3, on observe sa fin. */
    const { plages } = (
      await request(app)
        .get('/api/v2/avancement/achevement?date=2026-09-19')
        .set('Cookie', cookies)
    ).body;
    const plage = plages['GM101||M101'];

    expect(plage.prevue).toEqual({ debut: 1, fin: 3 });
    // La séance de test est posée en 2026-W3.
    expect(plage.posee).toEqual({ debut: 3, fin: 3 });
    // ⚠️ Du LUNDI de la première au SAMEDI de la dernière — six jours de grille.
    expect(plage.datesPrevues).toEqual({ debut: '2026-08-31', fin: '2026-09-19' });
  });

  /*
   * ⚠️ LES DEUX SOURCES SONT INDÉPENDANTES : un module au chronogramme mais pas
   * encore posé rend `posee: null`. Le taire laisserait croire à un oubli.
   */
  it('rend null du côté manquant plutôt que d’omettre le module', async () => {
    await Chronogramme.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      groupe: 'GM102',
      planning: { M101: [{ semaine: 'S5', heures: 5, type: 'P' }] },
    });

    const plage = (await lireAchevement()).body.plages['GM102||M101'];
    expect(plage.prevue).toEqual({ debut: 5, fin: 5 });
    expect(plage.posee).toBeNull();
    expect(plage.datesPosees).toBeNull();
  });

  /*
   * ⚠️ UNE CELLULE À ZÉRO N'OCCUPE PAS LA SEMAINE : le chronogramme garde la clé
   * d'un module qu'on vient de vider, et la compter étendrait la plage prévue
   * jusqu'à une semaine où rien n'est planifié.
   */
  it('ignore une cellule de chronogramme sans heures', async () => {
    await Chronogramme.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      groupe: 'GM102',
      planning: {
        M101: [
          { semaine: 'S2', heures: 5, type: 'P' },
          { semaine: 'S9', heures: 0, type: 'P' },
        ],
      },
    });

    expect((await lireAchevement()).body.plages['GM102||M101'].prevue).toEqual({
      debut: 2,
      fin: 2,
    });
  });

  /*
   * ⚠️ UNE SÉANCE ABSENTE N'A PAS EU LIEU : la compter ferait commencer le module
   * une semaine trop tôt. Même exclusion que partout ailleurs sur cet écran.
   */
  it('n’ouvre pas la plage sur une séance marquée absente', async () => {
    await poserSeance({ statut: 'absent' });

    const plage = (await lireAchevement()).body.plages['GM101||M101'];
    expect(plage?.posee ?? null).toBeNull();
  });

  /*
   * ═══ ⚠️ LES PLAGES SE REMBOBINENT, LE CHRONOGRAMME NON ═══
   * Le décompte de modules achevés et les plages vivent dans le MÊME bloc de
   * l'écran : sans cette date, un écran ramené à la S1 aurait compté ses modules
   * à cette date tout en montrant une plage posée allant jusqu'à la S3.
   * Le PRÉVISIONNEL, lui, est annuel — le tronquer effacerait ce à quoi on
   * compare le réalisé.
   */
  it('rembobine la plage POSÉE à la date demandée, jamais la prévue', async () => {
    await Chronogramme.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      groupe: 'GM101',
      planning: { M101: [{ semaine: 'S1', heures: 5, type: 'P' }, { semaine: 'S3', heures: 5, type: 'P' }] },
    });
    await poserSeance();

    const { plages } = (
      await request(app)
        .get('/api/v2/avancement/achevement?date=2026-09-13')
        .set('Cookie', cookies)
    ).body;
    const plage = plages['GM101||M101'];

    // La séance est posée le 14 septembre : elle n'existe pas encore le 13.
    expect(plage.posee).toBeNull();
    expect(plage.prevue).toEqual({ debut: 1, fin: 3 });
  });

  it('refuse un visiteur sans session', async () => {
    expect((await request(app).get('/api/v2/avancement/achevement')).status).toBe(401);
  });
});

describe('GET /avancement — la semaine en cours', () => {
  /*
   * ═══ ⚠️ ELLE EST CALCULÉE, PLUS DEVINÉE ═══ (correction du porteur,
   * 2026-09-01.) L'écran la cherchait en repérant le point dont le rythme
   * régional vaut celui d'aujourd'hui. Or ce rythme NE MONTE PAS pendant les
   * vacances : plusieurs semaines partagent la même valeur, et la recherche
   * rendait la PREMIÈRE — une semaine de vacances en cours s'annonçait sous le
   * nom de la semaine précédente.
   */
  it('renvoie le numéro de la semaine scolaire du jour', async () => {
    const { body } = await lire();

    expect(body.semaineCourante).toBe(semaineDansAnnee(ANNEE, new Date()).numero);
  });

  /*
   * ⚠️ BORNÉE À [1, 39], comme le taux régional est borné à 100 : hors de
   * l'année régionale, le repère doit se poser sur une semaine que la courbe
   * PORTE — sinon l'écran perdrait son écart et afficherait 0 % d'avancement.
   */
  it('désigne toujours un point de la courbe', async () => {
    const { body } = await lire();

    expect(body.progression.some((point) => point.numero === body.semaineCourante)).toBe(true);
  });
});

/*
 * ═══ ⚠️⚠️ LE RYTHME RÉGIONAL AVANT LA RENTRÉE (2026-09-03, demande du
 * porteur) ═══ Cette année, les 2ᵉ et 3ᵉ années reprennent le 7 septembre
 * (S2) et les 1ʳᵉ le 11 : la S1 (31 août) ne porte donc AUCUN cours nulle
 * part, et le rythme régional attendu doit y être NUL — pas un retard sur un
 * établissement qui n'a pas encore pu ouvrir un seul cours.
 */
describe('GET /avancement — le rythme régional avant la rentrée', () => {
  const RENTREES = [
    { anneeFormation: 1, date: '2026-09-11' },
    { anneeFormation: 2, date: '2026-09-07' },
    { anneeFormation: 3, date: '2026-09-07' },
  ];

  it('rend 0 % à la S1, avant que le premier niveau n’ait sa rentrée', async () => {
    await CalendrierNational.create({ anneeScolaire: ANNEE, vacances: [], rentrees: RENTREES });

    const reponse = await auJour(new Date(2026, 8, 1), (c) =>
      request(app).get('/api/v2/avancement').set('Cookie', c)
    );

    expect(reponse.body.regional.taux).toBe(0);
    expect(reponse.body.regional.passees).toBe(0);
  });

  /* Sans rentrée déclarée, la S1 compte encore comme avant cette révision. */
  it('sans rentrée déclarée, la S1 compte normalement', async () => {
    const reponse = await auJour(new Date(2026, 8, 1), (c) =>
      request(app).get('/api/v2/avancement').set('Cookie', c)
    );

    expect(reponse.body.regional.passees).toBe(1);
  });
});

describe('GET /avancement — la chronologie', () => {
  const lirePoints = () =>
    request(app).get('/api/v2/avancement/chronologie').set('Cookie', cookies);

  /*
   * ═══ ⚠️ LES DEUX FACES N'ONT PAS LA MÊME CHRONOLOGIE ═══
   * E-note avance par IMPORTS, la grille par SEMAINES. Offrir la même frise aux
   * deux ferait proposer des dates où l'une ne bouge jamais.
   */
  it('rend les imports pour e-note et les semaines saisies pour eDTpro', async () => {
    await EnoteImport.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      nomFichier: 'enote.xlsx',
      importeLe: new Date('2026-11-12T10:00:00'),
      entete: ENTETES_ENOTE,
      lignes: [ligneEnote({ 8: 'GM101', 16: 'M101', 35: '30' })],
    });
    await poserSeance();

    const { edtpro, enote } = (await lirePoints()).body;

    /*
     * ═══ ⚠️ LA FRISE E-NOTE EST PAR SEMAINE, PLUS PAR JOUR ═══ (demande du
     * porteur, 2026-09-01.) Le 12 novembre 2026 tombe dans la S11 de
     * 2026-2027 ; le point porte donc le SAMEDI de cette semaine, comme la face
     * eDTpro, et le fichier reste nommé dans le détail.
     */
    expect(enote).toEqual([
      {
        date: '2026-11-14',
        libelle: 'S11',
        detail: 'enote.xlsx — déposé le 2026-11-12',
      },
    ]);
    // La séance de test est en 2026-W3 : le point porte la FIN de la semaine.
    expect(edtpro).toEqual([{ date: '2026-09-19', libelle: 'S3', detail: '2026-09-19' }]);
  });

  /*
   * ⚠️ LA FIN DE LA SEMAINE, PAS SON DÉBUT : « l'état à la S3 » veut dire « une
   * fois la S3 faite ». Prendre le lundi retirerait de la vue les séances de la
   * semaine qu'on vient de désigner — vérifié ci-dessous par le rembobinage.
   */
  it('rembobine le réalisé à la date demandée', async () => {
    await poserSeance();

    const avant = await request(app)
      .get('/api/v2/avancement?date=2026-09-13')
      .set('Cookie', cookies);
    const apres = await request(app)
      .get('/api/v2/avancement?date=2026-09-19')
      .set('Cookie', cookies);

    // La séance du 2026-W3 tombe le 14 septembre : invisible au 13, comptée au 19.
    expect(total(avant.body.faces.edtpro).realise).toBe(0);
    expect(total(apres.body.faces.edtpro).realise).toBe(2.5);
    expect(apres.body.observation).toBe('2026-09-19');
  });

  /*
   * ⚠️ LA PROGRESSION GARDE TOUTE L'ANNÉE : c'est une frise, la tronquer
   * effacerait ce qu'on vient y lire. Seul le RÉALISÉ des lignes se rembobine.
   */
  it('ne tronque pas la courbe de progression', async () => {
    const reponse = await request(app)
      .get('/api/v2/avancement?date=2026-09-13')
      .set('Cookie', cookies);

    expect(reponse.body.progression).toHaveLength(39);
  });

  /*
   * ⚠️ « LE PLUS RÉCENT AVANT LA DATE », pas le plus récent : rembobiner doit
   * rendre le fichier qui faisait foi ce jour-là, pas celui importé depuis.
   */
  it('rend l’import qui faisait foi à la date demandée', async () => {
    await EnoteImport.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      nomFichier: 'ancien.xlsx',
      importeLe: new Date('2026-10-01T10:00:00'),
      entete: ENTETES_ENOTE,
      lignes: [ligneEnote({ 8: 'GM101', 16: 'M101', 35: '30', 38: '10' })],
    });
    await EnoteImport.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      nomFichier: 'recent.xlsx',
      importeLe: new Date('2026-12-01T10:00:00'),
      entete: ENTETES_ENOTE,
      lignes: [ligneEnote({ 8: 'GM101', 16: 'M101', 35: '30', 38: '25' })],
    });

    const ancien = await request(app)
      .get('/api/v2/avancement?date=2026-11-01')
      .set('Cookie', cookies);

    expect(ancien.body.source.fichier).toBe('ancien.xlsx');
    expect(total(ancien.body.faces.enote).realise).toBe(10);
  });

  /*
   * ⚠️ UN SEUL POINT PAR SEMAINE, ET C'EST LE PLUS RÉCENT. La règle « une base
   * par semaine » est récente : des données antérieures peuvent porter deux
   * dépôts la même semaine, et c'est le dernier qui fait foi à la fin de
   * celle-ci — exactement ce que le rembobinage ira chercher.
   */
  it('ne garde qu’un point par semaine, le plus récent', async () => {
    for (const [jour, fichier] of [
      ['2026-11-10T10:00:00', 'lundi.xlsx'],
      ['2026-11-12T10:00:00', 'jeudi.xlsx'],
      ['2026-11-19T10:00:00', 'semaine-suivante.xlsx'],
    ]) {
      await EnoteImport.create({
        etablissementId: etablissement.id,
        anneeScolaire: ANNEE,
        nomFichier: fichier,
        importeLe: new Date(jour),
        entete: ENTETES_ENOTE,
        lignes: [ligneEnote({ 8: 'GM101', 16: 'M101', 35: '30' })],
      });
    }

    const { enote } = (await lirePoints()).body;

    expect(enote.map((point) => point.libelle)).toEqual(['S11', 'S12']);
    expect(enote[0].detail).toContain('jeudi.xlsx');
  });

  /*
   * ⚠️ UNE DATE ILLISIBLE EST IGNORÉE, pas refusée : rendre une erreur là où
   * l'état courant fait l'affaire afficherait une page vide pour un paramètre
   * mal formé.
   */
  it('ignore une date illisible plutôt que de refuser', async () => {
    const reponse = await request(app)
      .get('/api/v2/avancement?date=pas-une-date')
      .set('Cookie', cookies);

    expect(reponse.status).toBe(200);
    expect(reponse.body.observation).toBeNull();
  });
});

describe('GET /avancement — accès', () => {
  it('refuse un visiteur sans session', async () => {
    expect((await request(app).get('/api/v2/avancement')).status).toBe(401);
  });

  it('répond 404 quand l’établissement n’a pas de base', async () => {
    await Base.deleteMany({});
    const reponse = await lire();

    expect(reponse.status).toBe(404);
    expect(reponse.body.code).toBe('BASE_ABSENTE');
  });
});
