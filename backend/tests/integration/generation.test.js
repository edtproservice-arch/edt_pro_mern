import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

import { MOTEURS, ROLES, STATUTS_COMPTE, TYPES_COURS } from 'shared/constants';

import { createApp } from '../../src/app.js';
import { AutoGenConfig } from '../../src/models/AutoGenConfig.js';
import { Base } from '../../src/models/Base.js';
import { Chronogramme } from '../../src/models/Chronogramme.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { Seance } from '../../src/models/Seance.js';
import { TraceGeneration } from '../../src/models/TraceGeneration.js';
import { User } from '../../src/models/User.js';
import * as service from '../../src/modules/generation/generation.service.js';
import { chargerCommun } from '../../src/modules/generation/donnees.js';
import { salleAVerifier } from '../../src/modules/espaces/espaces.service.js';

/**
 * Le choix du moteur, de la requête jusqu'au service (Phase 6 · e, 2026-09-22).
 *
 * ═══ ⚠️ CE QUE CE FICHIER GARDE, ET POURQUOI IL EXISTE SEUL ═══
 * La génération elle-même est éprouvée ailleurs : `tests/unit/generation.test.js`
 * pour la construction du problème, `tests/unit/solveur.client.test.js` pour le
 * dialogue avec Python, `ai/tests/` pour la résolution. Il manquait le premier
 * maillon — **la route**.
 *
 * ⚠️ ET C'EST LE MAILLON DONT LA RUPTURE SERAIT INVISIBLE. Si `moteur` n'était
 *    pas déclaré dans le schéma Zod, Zod le RETIRERAIT du corps sans rien dire
 *    (il écarte les clés inconnues), le service reprendrait son défaut, et la
 *    génération resterait au glouton. Le directeur aurait coché « recherche
 *    approfondie », attendu, et reçu la grille rapide — sans un message nulle
 *    part. C'est exactement l'état d'AVANT cette livraison, et rien ne l'aurait
 *    distingué de l'état d'après.
 *
 * ⚠️ LE SERVICE EST SIMULÉ, DÉLIBÉRÉMENT : ce qui est jugé ici est le transport
 *    d'un paramètre, pas la qualité d'une grille. Générer pour de vrai
 *    demanderait une carte, un chronogramme et Python — et ferait dépendre le
 *    verdict de choses que ces tests ne cherchent pas à prouver.
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const ANNEE = 2026;

let cookies;
let generer;

beforeEach(async () => {
  const directeur = await User.create({
    nomComplet: 'Directrice Test',
    email: 'directeur@edtpro.ma',
    motDePasse: MOT_DE_PASSE,
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });

  const etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region: 'Fès-Meknès',
    complexe: 'CF Bâtiment',
    nom: 'ISTA Test',
    anneeScolaire: ANNEE,
  });

  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });
  cookies = connexion.headers['set-cookie'];

  /*
   * ═══ ⚠️ UNE CARTE MINIMALE MAIS RÉELLE, ET ELLE N'EST PAS DÉCORATIVE ═══
   * Sans base ni chronogramme, `chargerCommun` échoue en 404 et la simulation
   * s'arrête AVANT d'avoir rien tenté. Le test « n'écrit rien » passerait alors
   * pour la mauvaise raison : il ne verrait jamais le chemin où une écriture
   * pourrait se glisser. Une mutation l'a montré le 2026-09-22 — elle n'était
   * détectée que parce qu'elle écrivait avant le 404.
   */
  await Base.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    formateurs: [{ matricule: '15688', nomComplet: 'ABDELGHANI LAASAL' }],
    affectations: [
      {
        formateur: '15688',
        groupe: 'GM101',
        module: 'M101',
        type: TYPES_COURS.PRESENTIEL,
        s1Heures: 60,
      },
    ],
  });

  await Chronogramme.create({
    etablissementId: etablissement.id,
    anneeScolaire: ANNEE,
    groupe: 'GM101',
    planning: { M101: [{ semaine: 'S3', heures: 5, type: 'P' }] },
  });

  generer = vi
    .spyOn(service, 'generer')
    .mockResolvedValue({ graine: 1, moteur: MOTEURS.GLOUTON, semaines: [], total: {} });
});

/** Le corps minimal d'une génération : une semaine. */
const corps = (extra = {}) => ({ semaines: ['2026-W3'], ...extra });

describe('choix du moteur à la frontière HTTP', () => {
  it('TRANSMET « cpsat » au service quand le directeur le demande', async () => {
    const reponse = await request(app)
      .post('/api/v2/generation')
      .set('Cookie', cookies)
      .send(corps({ moteur: MOTEURS.CPSAT }));

    expect(reponse.status).toBe(200);
    expect(generer).toHaveBeenCalledWith(
      expect.anything(),
      ANNEE,
      expect.objectContaining({ moteur: MOTEURS.CPSAT }),
      expect.anything()
    );
  });

  it('le transmet aussi par le flux, qui est le chemin du front', async () => {
    /*
     * ⚠️ LES DEUX ROUTES, PARCE QUE LE FRONT N'UTILISE QUE LA SECONDE. Tester
     *    la seule route simple laisserait sans garde le chemin que le directeur
     *    emprunte réellement — et c'est le genre d'écart qu'on ne découvre
     *    qu'en production.
     */
    const reponse = await request(app)
      .post('/api/v2/generation/flux')
      .set('Cookie', cookies)
      .send(corps({ moteur: MOTEURS.CPSAT }));

    expect(reponse.status).toBe(200);
    expect(generer).toHaveBeenCalledWith(
      expect.anything(),
      ANNEE,
      expect.objectContaining({ moteur: MOTEURS.CPSAT }),
      expect.anything()
    );
  });

  it('RETOMBE sur le glouton quand rien n’est demandé', async () => {
    // Sept minutes contre une seconde : le défaut ne peut pas être la recherche.
    await request(app).post('/api/v2/generation').set('Cookie', cookies).send(corps());

    expect(generer).toHaveBeenCalledWith(
      expect.anything(),
      ANNEE,
      expect.objectContaining({ moteur: MOTEURS.GLOUTON }),
      expect.anything()
    );
  });

  it('REFUSE un moteur inconnu en 400, sans rien générer', async () => {
    /*
     * ⚠️ REFUSÉ ICI PLUTÔT QUE TROIS COUCHES PLUS BAS. Python le refuse aussi,
     *    mais depuis un sous-processus : le directeur lirait « le problème
     *    envoyé au solveur est invalide » pour une faute de frappe.
     */
    const reponse = await request(app)
      .post('/api/v2/generation')
      .set('Cookie', cookies)
      .send(corps({ moteur: 'cp_sat' }));

    expect(reponse.status).toBe(400);
    expect(generer).not.toHaveBeenCalled();
  });
});

describe('simulation — ce qu’une relance rapporterait', () => {
  it('BORNE à 12 semaines, plus serré que la génération', async () => {
    /*
     * ⚠️ UNE SIMULATION COÛTE QUATRE RÉSOLUTIONS PAR SEMAINE (la base plus
     *    trois hypothèses). Sur une année entière ce serait 180 appels au
     *    solveur pour répondre à une question de curiosité — alors qu'elle ne
     *    sert que sur les semaines INCOMPLÈTES, qui se comptent sur les doigts.
     */
    const reponse = await request(app)
      .post('/api/v2/generation/simulation')
      .set('Cookie', cookies)
      .send({ semaines: Array.from({ length: 13 }, (_, i) => `2026-W${i + 1}`) });

    expect(reponse.status).toBe(400);
  });

  it('reste réservée au directeur, comme la génération', async () => {
    // Elle lit toute la carte et tout le chronogramme de l'établissement.
    const reponse = await request(app)
      .post('/api/v2/generation/simulation')
      .send({ semaines: ['2026-W3'] });

    expect(reponse.status).toBe(401);
  });

  it('N’ÉCRIT RIEN — la propriété à ne jamais perdre', async () => {
    /*
     * ═══ ⚠️ POURQUOI CE TEST EST LE PLUS IMPORTANT DES TROIS ═══
     * Une simulation qui laisserait une trace polluerait le corpus
     * d'entraînement (F6 · d) avec des grilles qui n'ont JAMAIS existé — et le
     * défaut serait invisible pendant des mois, jusqu'à ce qu'un modèle
     * apprenne sur des emplois du temps imaginaires. Si elle écrivait des
     * séances, elle écraserait en plus le travail du directeur sans qu'il ait
     * rien demandé.
     */
    const avant = {
      seances: await Seance.countDocuments(),
      traces: await TraceGeneration.countDocuments(),
      configs: await AutoGenConfig.countDocuments(),
    };

    const reponse = await request(app)
      .post('/api/v2/generation/simulation')
      .set('Cookie', cookies)
      .send({ semaines: ['2026-W3'] });

    /*
     * ⚠️ ON EXIGE QUE LA SIMULATION ABOUTISSE. Si la carte de la fixture
     *    devenait insuffisante, elle échouerait en 404 et le compte d'écritures
     *    serait inchangé — le test passerait sans avoir rien éprouvé. Cette
     *    ligne transforme cette faiblesse silencieuse en échec.
     */
    expect(reponse.status).toBe(200);
    expect(reponse.body.propositions).toHaveLength(3);

    expect({
      seances: await Seance.countDocuments(),
      traces: await TraceGeneration.countDocuments(),
      configs: await AutoGenConfig.countDocuments(),
    }).toEqual(avant);
  });
});

describe('prévisualisation — ce que la carte perdra, dit avant de générer', () => {
  it('rend `semaines` ET `modulesSansAffectation`, sans double enveloppe', async () => {
    /*
     * ═══ ⚠️ LA RUPTURE SILENCIEUSE QUE CE TEST INTERDIT ═══ (2026-09-22)
     * `previsualiser` rendait un TABLEAU, que la route enveloppait dans
     * `{ semaines }`. En lui faisant rendre un objet, on obtenait
     * `semaines.semaines` — et l'écran affichait une liste VIDE sans la
     * moindre erreur, ni côté serveur ni côté navigateur. Le changement de
     * forme n'a fait tomber aucun des 98 tests de la suite : rien ne gardait
     * ce contrat.
     */
    const reponse = await request(app)
      .post('/api/v2/generation/previsualisation')
      .set('Cookie', cookies)
      .send({ semaines: ['2026-W3'] });

    expect(reponse.status).toBe(200);
    expect(Array.isArray(reponse.body.semaines)).toBe(true);
    expect(reponse.body.semaines[0]).toMatchObject({ semaine: '2026-W3' });
    expect(Array.isArray(reponse.body.modulesSansAffectation)).toBe(true);
  });

  it('NOMME le groupe dont le chronogramme a survécu à la carte', async () => {
    /*
     * ⚠️ CES HEURES NE DEVIENNENT JAMAIS UNE TÂCHE : elles disparaissent sans
     *    même apparaître dans les « non placées », puisqu'on n'a jamais essayé
     *    de les poser. Mesuré sur l'année réelle : 39 couples. C'est la carte
     *    qu'il faut corriger, et le savoir AVANT évite de relancer en vain.
     */
    await Chronogramme.create({
      etablissementId: (await Etablissement.findOne()).id,
      anneeScolaire: ANNEE,
      groupe: 'GM102',
      planning: { M999: [{ semaine: 'S3', heures: 5, type: 'P' }] },
    });

    const reponse = await request(app)
      .post('/api/v2/generation/previsualisation')
      .set('Cookie', cookies)
      .send({ semaines: ['2026-W3'] });

    /*
     * ⚠️ CE TEST AFFIRMAIT `modulesSansAffectation` JUSQU'AU 2026-09-22, et
     *    il reposait sur la confusion que le porteur a signalée : **GM102
     *    n'est PAS dans la carte de la fixture**. Ce n'est donc pas une
     *    affectation qui manque, c'est le groupe entier — et la correction
     *    est l'inverse : retirer le chronogramme, pas ajouter un formateur.
     */
    expect(reponse.body.groupesAbsents).toContain('GM102');
    expect(reponse.body.modulesSansAffectation).not.toContain('GM102 · M999');
  });

  it('chiffre ce que le chronogramme RÉCLAME sur la semaine', async () => {
    // 5 h de M101 pour GM101 → 2 séances de 2,5 h.
    const reponse = await request(app)
      .post('/api/v2/generation/previsualisation')
      .set('Cookie', cookies)
      .send({ semaines: ['2026-W3'] });

    expect(reponse.body.semaines[0].demandees).toBe(2);
  });
});

describe('prévisualisation — groupe absent ou module non affecté', () => {
  it('SÉPARE les deux, parce que la correction est l’inverse', async () => {
    /*
     * ═══ ⚠️ LE DÉFAUT SIGNALÉ PAR LE PORTEUR LE 2026-09-22 ═══
     * La modale annonçait « aucun formateur ne leur est affecté dans la carte »
     * pour des groupes qui n'existent PAS dans la carte — une filière entière
     * (GE…) dont seuls les chronogrammes avaient survécu. Le directeur
     * cherchait une affectation introuvable, alors qu'il fallait retirer le
     * chronogramme.
     */
    const etablissement = await Etablissement.findOne();

    // Un chronogramme sur un groupe que la carte ne porte pas du tout.
    await Chronogramme.create({
      etablissementId: etablissement.id,
      anneeScolaire: ANNEE,
      groupe: 'GE101 (GC)',
      planning: { M200: [{ semaine: 'S3', heures: 5, type: 'P' }] },
    });

    /*
     * ⚠️ ON ENRICHIT LE CHRONOGRAMME EXISTANT, on n'en crée pas un second :
     *    l'index `(etablissementId, groupe, anneeScolaire)` est UNIQUE, et
     *    c'est voulu — deux plannings pour un même groupe, c'est la porte
     *    ouverte à ce que l'un efface l'autre.
     */
    await Chronogramme.updateOne(
      { etablissementId: etablissement.id, anneeScolaire: ANNEE, groupe: 'GM101' },
      { $set: { 'planning.M300': [{ semaine: 'S3', heures: 5, type: 'P' }] } }
    );

    const reponse = await request(app)
      .post('/api/v2/generation/previsualisation')
      .set('Cookie', cookies)
      .send({ semaines: ['2026-W3'] });

    expect(reponse.body.groupesAbsents).toContain('GE101 (GC)');
    expect(reponse.body.groupesAbsents).not.toContain('GM101');
    expect(reponse.body.modulesSansAffectation).toContain('GM101 · M300');
    expect(reponse.body.modulesSansAffectation).not.toContain('GE101 (GC) · M200');
  });
});

describe('précharge — elle ne doit pas appauvrir les contrôles', () => {
  it('porte `espacesMutualises`, sans quoi un conflit de salle partagée est SAUTÉ', async () => {
    /*
     * ═══ ⚠️⚠️ LE DÉFAUT SILENCIEUX QUE CE TEST INTERDIT ═══ (2026-09-22)
     * `chargerCommun` ne chargeait que `espaces groupesFq`. Ce document sert de
     * PRÉCHARGE à `poser()`, et `salleAVerifier` lit `espacesMutualises` pour
     * décider s'il faut chercher un conflit chez les autres établissements.
     * Absent, le verdict tombait à `false` et **le contrôle était purement
     * sauté** : la génération pouvait poser un cours dans une salle partagée
     * déjà occupée ailleurs, là où la saisie manuelle l'aurait refusé.
     *
     * ⚠️ Vérifié sur les données réelles : 1 salle sur 16 changeait de verdict.
     *    Aucune erreur, aucun message — juste un contrôle qui ne s'exécutait pas.
     *
     * ⚠️ **UNE PRÉCHARGE TRONQUÉE NE FAIT PAS GAGNER DU TEMPS, ELLE CHANGE LE
     *    RÉSULTAT.** C'est ce que ce test compare : le verdict rendu sur le
     *    document préchargé doit être celui rendu sur le document complet.
     */
    const etablissement = await Etablissement.findOne();
    await Etablissement.updateOne(
      { _id: etablissement.id },
      {
        $set: {
          espaces: ['Atelier FM'],
          espacesMutualises: [
            { espace: 'Atelier FM', etablissementId: new mongoose.Types.ObjectId() },
          ],
        },
      }
    );

    const commun = await chargerCommun(etablissement.id, ANNEE);
    const complet = await Etablissement.findById(etablissement.id)
      .select('espaces espacesMutualises')
      .lean();

    expect(salleAVerifier(commun.etablissement, 'Atelier FM')).toBe(
      salleAVerifier(complet, 'Atelier FM')
    );
    // Et cette salle-là DOIT être vérifiée : sinon le test passerait sur deux faux.
    expect(salleAVerifier(commun.etablissement, 'Atelier FM')).toBe(true);
  });

  it('mémoïse les lectures que `poser()` répétait à chaque séance', async () => {
    /*
     * ⚠️ MESURÉ : 181 séances coûtaient 181 `chargerPieces` et 181
     *    `autresEtablissementsDuFormateur` — jusqu'à quatre requêtes par séance
     *    pour des données identiques. 59,9 s pour une semaine, contre 460 ms
     *    pour toute la résolution Python.
     */
    const etablissement = await Etablissement.findOne();
    const commun = await chargerCommun(etablissement.id, ANNEE);

    // La même promesse, pas deux requêtes.
    expect(commun.prechargePoser.obtenirPieces()).toBe(commun.prechargePoser.obtenirPieces());
    expect(commun.prechargePoser.obtenirAutresEtablissements('15688')).toBe(
      commun.prechargePoser.obtenirAutresEtablissements('15688')
    );
    // Deux matricules différents ne partagent évidemment pas la leur.
    expect(commun.prechargePoser.obtenirAutresEtablissements('15688')).not.toBe(
      commun.prechargePoser.obtenirAutresEtablissements('99999')
    );
  });
});
