import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { EtablissementOfppt } from '../../src/models/EtablissementOfppt.js';
import { REGIONS_OFPPT, ROLES, STATUTS_COMPTE } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

/**
 * Réseau OFPPT — le référentiel région → complexe → établissement.
 * ← public/data/etablissements.json
 */
const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';
const BASE = '/api/v2/admin/reseau';
const PUBLIC = '/api/v2/reseau';

const FES = 'Fès-Meknès';
const CASA = 'Casablanca-Settat';

let cookiesAdmin;

async function creerCompte({ email, role }) {
  return User.create({
    nomComplet: `Compte ${email}`,
    email,
    motDePasse: MOT_DE_PASSE,
    role,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });
}

async function connecter(email) {
  const reponse = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: email, motDePasse: MOT_DE_PASSE });
  return reponse.headers['set-cookie'];
}

beforeEach(async () => {
  await creerCompte({ email: 'admin@edtpro.ma', role: ROLES.ADMIN });
  cookiesAdmin = await connecter('admin@edtpro.ma');

  await EtablissementOfppt.create([
    { region: FES, complexe: 'CF Bâtiment', nom: 'ISTA Nargiss' },
    { region: FES, complexe: 'CF Bâtiment', nom: 'Prison Locale Bourkaiz' },
    { region: FES, complexe: 'CF Industriel', nom: 'ISTA Route Imouzzer' },
    { region: CASA, complexe: 'CF NTIC', nom: "ISTA Ben M'Sik" },
  ]);
});

describe('Lecture publique du réseau', () => {
  /*
   * ═══ ⚠️ SANS SESSION, ET C'EST INDISPENSABLE ═══
   * L'inscription d'un directeur se fait AVANT toute session : la cascade
   * région → complexe → établissement doit être servie à un visiteur. Un garde
   * ici rendrait le formulaire d'inscription impossible à remplir.
   */
  it('sert l’arborescence à un visiteur non authentifié', async () => {
    const reponse = await request(app).get(PUBLIC);

    expect(reponse.status).toBe(200);
    expect(Object.keys(reponse.body.reseau).sort()).toEqual([CASA, FES]);
    expect(reponse.body.reseau[FES]['CF Bâtiment']).toEqual([
      'ISTA Nargiss',
      'Prison Locale Bourkaiz',
    ]);
  });

  it('sert les dix régions, même celles qui n’ont aucun établissement', async () => {
    const reponse = await request(app).get(`${PUBLIC}/regions`);

    expect(reponse.status).toBe(200);
    expect(reponse.body.regions).toEqual(REGIONS_OFPPT);
    expect(reponse.body.regions).toHaveLength(10);
  });

  /* ⚠️ La lecture est ouverte ; l'écriture ne l'est pas. */
  it('refuse l’écriture à un visiteur, et à un directeur', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);

    await creerCompte({ email: 'directeur@edtpro.ma', role: ROLES.DIRECTEUR });
    const cookies = await connecter('directeur@edtpro.ma');
    const reponse = await request(app).get(BASE).set('Cookie', cookies);

    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('ROLE_INSUFFISANT');
  });
});

describe('Consultation, côté administration', () => {
  it('liste, filtre et cherche', async () => {
    const tout = await request(app).get(BASE).set('Cookie', cookiesAdmin);
    expect(tout.body.total).toBe(4);

    const parRegion = await request(app)
      .get(`${BASE}?region=${encodeURIComponent(CASA)}`)
      .set('Cookie', cookiesAdmin);
    expect(parRegion.body.total).toBe(1);

    const parComplexe = await request(app)
      .get(`${BASE}?complexe=${encodeURIComponent('CF Bâtiment')}`)
      .set('Cookie', cookiesAdmin);
    expect(parComplexe.body.total).toBe(2);
  });

  /*
   * ⚠️ LA RECHERCHE EST ÉCHAPPÉE : un nom d'établissement contient des
   * apostrophes et des parenthèses — « ISTA (NTIC) BEN M'SIK ». Non échappée,
   * l'expression serait invalide ou filtrerait autre chose.
   */
  it('cherche sans se laisser abuser par les caractères spéciaux', async () => {
    await EtablissementOfppt.create({
      region: CASA,
      complexe: 'CF NTIC',
      nom: 'ISTA (NTIC) Sidi Maârouf',
    });

    const reponse = await request(app)
      .get(`${BASE}?recherche=${encodeURIComponent('(NTIC)')}`)
      .set('Cookie', cookiesAdmin);

    expect(reponse.body.total).toBe(1);
    expect(reponse.body.etablissements[0].nom).toBe('ISTA (NTIC) Sidi Maârouf');
  });

  it('résume la couverture par région', async () => {
    const { body } = await request(app).get(`${BASE}/resume`).set('Cookie', cookiesAdmin);

    expect(body.total).toBe(4);
    expect(body.complexes).toBe(3);

    const fes = body.parRegion.find((r) => r.region === FES);
    expect(fes).toEqual({ region: FES, complexes: 2, etablissements: 3 });
  });

  it('rend les complexes d’une région, et eux seuls', async () => {
    const { body } = await request(app)
      .get(`${BASE}/complexes?region=${encodeURIComponent(FES)}`)
      .set('Cookie', cookiesAdmin);

    expect(body.complexes).toEqual(['CF Bâtiment', 'CF Industriel']);
  });
});

describe('Saisie', () => {
  it('ajoute un établissement dans un complexe existant', async () => {
    const reponse = await request(app)
      .post(BASE)
      .set('Cookie', cookiesAdmin)
      .send({ region: FES, complexe: 'CF Bâtiment', nom: 'Nouvel ISTA' });

    expect(reponse.status).toBe(201);
    expect(await EtablissementOfppt.countDocuments({ complexe: 'CF Bâtiment' })).toBe(3);
  });

  /*
   * ═══ LE SECOND CAS DU FLUX DÉCRIT PAR LE PORTEUR ═══
   * Le complexe n'existe pas : il naît avec son premier établissement. Aucune
   * création préalable, aucune entité à part — c'est un champ.
   */
  it('crée le complexe en même temps que son premier établissement', async () => {
    await request(app)
      .post(BASE)
      .set('Cookie', cookiesAdmin)
      .send({ region: 'Souss-Massa', complexe: 'CF Agadir', nom: 'ISTA Agadir' });

    const { body } = await request(app)
      .get(`${BASE}/complexes?region=${encodeURIComponent('Souss-Massa')}`)
      .set('Cookie', cookiesAdmin);

    expect(body.complexes).toEqual(['CF Agadir']);
  });

  it('refuse un établissement déjà présent dans le même complexe', async () => {
    const reponse = await request(app)
      .post(BASE)
      .set('Cookie', cookiesAdmin)
      .send({ region: FES, complexe: 'CF Bâtiment', nom: 'ISTA Nargiss' });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('ETABLISSEMENT_EN_DOUBLE');
    expect(await EtablissementOfppt.countDocuments()).toBe(4);
  });

  /*
   * ⚠️ LA RÉGION FAIT PARTIE DE LA CLÉ : deux régions peuvent porter un complexe
   * de même nom, et deux établissements homonymes dans deux villes sont deux
   * établissements.
   */
  it('accepte le même nom dans une autre région', async () => {
    const reponse = await request(app)
      .post(BASE)
      .set('Cookie', cookiesAdmin)
      .send({ region: CASA, complexe: 'CF Bâtiment', nom: 'ISTA Nargiss' });

    expect(reponse.status).toBe(201);
    expect(await EtablissementOfppt.countDocuments({ nom: 'ISTA Nargiss' })).toBe(2);
  });

  /*
   * ⚠️ LES RÉGIONS SONT FIGÉES (décision du 2026-09-02) : la base doit refuser
   * une région inventée plutôt que de l'accepter et de la voir disparaître de la
   * cascade — un établissement rangé sous « Fes » ne serait proposé nulle part.
   */
  it('refuse une région hors de la liste officielle', async () => {
    const reponse = await request(app)
      .post(BASE)
      .set('Cookie', cookiesAdmin)
      .send({ region: 'Fes', complexe: 'CF Bâtiment', nom: 'ISTA Inventé' });

    expect(reponse.status).toBe(400);
  });

  it('modifie et supprime un établissement', async () => {
    const cible = await EtablissementOfppt.findOne({ nom: 'ISTA Nargiss' });

    const modification = await request(app)
      .patch(`${BASE}/${cible.id}`)
      .set('Cookie', cookiesAdmin)
      .send({ nom: 'ISTA Nargiss Fès' });

    expect(modification.body.etablissement.nom).toBe('ISTA Nargiss Fès');

    const suppression = await request(app)
      .delete(`${BASE}/${cible.id}`)
      .set('Cookie', cookiesAdmin);

    expect(suppression.body.supprimes).toBe(1);
    expect(await EtablissementOfppt.countDocuments()).toBe(3);
  });
});

describe('Le complexe est un champ, pas une entité', () => {
  /*
   * ═══ ⚠️ LE RENOMMER EST UNE ÉCRITURE GROUPÉE ═══
   * Sans elle, il faudrait rouvrir chaque établissement, et un oubli laisserait
   * deux complexes presque homonymes dans la cascade d'inscription.
   */
  it('renomme un complexe et tous ses établissements', async () => {
    const reponse = await request(app)
      .patch(`${BASE}/complexes`)
      .set('Cookie', cookiesAdmin)
      .send({ region: FES, ancien: 'CF Bâtiment', nouveau: 'CF Bâtiment Fès' });

    expect(reponse.body.modifies).toBe(2);
    expect(await EtablissementOfppt.countDocuments({ complexe: 'CF Bâtiment Fès' })).toBe(2);
    /* ⚠️ ET RIEN D'AUTRE : l'autre complexe de la région n'a pas bougé. */
    expect(await EtablissementOfppt.countDocuments({ complexe: 'CF Industriel' })).toBe(1);
  });

  /*
   * ⚠️ ON REFUSE LA FUSION SILENCIEUSE : renommer vers un nom déjà pris
   * réunirait deux complexes distincts, et l'index unique ferait échouer
   * l'écriture sur les seuls homonymes — la moitié du renommage passerait, et
   * personne ne saurait laquelle.
   */
  it('refuse un renommage qui fusionnerait deux complexes', async () => {
    const reponse = await request(app)
      .patch(`${BASE}/complexes`)
      .set('Cookie', cookiesAdmin)
      .send({ region: FES, ancien: 'CF Bâtiment', nouveau: 'CF Industriel' });

    expect(reponse.status).toBe(400);
    expect(reponse.body.code).toBe('COMPLEXE_EN_DOUBLE');
    expect(await EtablissementOfppt.countDocuments({ complexe: 'CF Bâtiment' })).toBe(2);
  });

  it('supprime un complexe entier, et lui seul', async () => {
    const reponse = await request(app)
      .delete(`${BASE}/complexes?region=${encodeURIComponent(FES)}&complexe=${encodeURIComponent('CF Bâtiment')}`)
      .set('Cookie', cookiesAdmin);

    expect(reponse.body.supprimes).toBe(2);
    expect(await EtablissementOfppt.countDocuments({ region: FES })).toBe(1);
    expect(await EtablissementOfppt.countDocuments({ region: CASA })).toBe(1);
  });

  it('rend 404 sur un complexe inconnu plutôt qu’un succès vide', async () => {
    const reponse = await request(app)
      .delete(`${BASE}/complexes?region=${encodeURIComponent(FES)}&complexe=Inexistant`)
      .set('Cookie', cookiesAdmin);

    expect(reponse.status).toBe(404);
  });
});
