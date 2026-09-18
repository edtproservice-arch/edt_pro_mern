import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Etablissement } from '../../src/models/Etablissement.js';
import { oublierMemoire } from '../../src/modules/meteo/meteo.service.js';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';

vi.mock('../../src/config/mailer.js', () => ({
  envoyerEmail: vi.fn(async () => ({ envoye: true })),
}));

const app = createApp();
const MOT_DE_PASSE = 'MotDePasse2026';

/** Réponse d'Open-Meteo, réduite à ce que le service lit. */
const reponseOpenMeteo = (courant) => ({
  ok: true,
  json: async () => ({ current: courant }),
});

async function connecter({ nom, region }) {
  const directeur = await User.create({
    nomComplet: 'Directeur Test',
    email: 'directeur@edtpro.ma',
    motDePasse: MOT_DE_PASSE,
    role: ROLES.DIRECTEUR,
    statut: STATUTS_COMPTE.APPROUVE,
    estVerifie: true,
  });

  const etablissement = await Etablissement.create({
    proprietaireId: directeur.id,
    region,
    complexe: 'CF Test',
    nom,
    anneeScolaire: 2026,
  });

  directeur.etablissementIds = [etablissement.id];
  await directeur.save();

  const connexion = await request(app)
    .post('/api/v2/auth/connexion')
    .send({ identifiant: 'directeur@edtpro.ma', motDePasse: MOT_DE_PASSE });

  return connexion.headers['set-cookie'];
}

beforeEach(() => {
  /* Le cache vit dans le processus : sans nettoyage, un test sert la valeur
     retenue par le précédent. Même précaution que pour les jours fériés. */
  oublierMemoire();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /meteo', () => {
  it('rend le relevé de la ville lue dans le NOM de l’établissement', async () => {
    const cookies = await connecter({
      nom: 'INSTITUT SPECIALISE DE TECHNOLOGIE APPLIQUEE BEN M’SIK CASABLANCA',
      region: 'Casablanca-Settat',
    });

    const appels = vi.fn(async () =>
      reponseOpenMeteo({ weather_code: 3, temperature_2m: 24.6, is_day: 1 })
    );
    vi.stubGlobal('fetch', appels);

    const { body } = await request(app).get('/api/v2/meteo').set('Cookie', cookies);

    expect(body.meteo).toEqual({
      ville: 'casablanca',
      code: 3,
      estJour: true,
      /* Arrondi : un dixième de degré n'apporte rien à côté d'une icône. */
      temperature: 25,
    });

    // Les coordonnées de Casablanca, et non celles du chef-lieu de région.
    const url = String(appels.mock.calls[0][0]);
    expect(url).toContain('latitude=33.57');
  });

  /*
   * ⚠️ TRENTE MINUTES DE CACHE : la météo d'un lieu ne change pas plus vite, et
   * l'accueil est relu des dizaines de fois par jour.
   */
  it('ne rappelle pas l’API pour un second affichage', async () => {
    const cookies = await connecter({ nom: 'ISTA Fes', region: 'Fès-Meknès' });
    const appels = vi.fn(async () =>
      reponseOpenMeteo({ weather_code: 0, temperature_2m: 18, is_day: 1 })
    );
    vi.stubGlobal('fetch', appels);

    await request(app).get('/api/v2/meteo').set('Cookie', cookies);
    await request(app).get('/api/v2/meteo').set('Cookie', cookies);

    expect(appels).toHaveBeenCalledTimes(1);
  });

  /*
   * ⚠️ UN ÉCHEC NE SE MET PAS EN CACHE : le garder trente minutes ferait durer
   * une panne d'une seconde bien au-delà d'elle-même.
   */
  it('rend null sur un appel en échec, et réessaie ensuite', async () => {
    const cookies = await connecter({ nom: 'ISTA Fes', region: 'Fès-Meknès' });

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    const echec = await request(app).get('/api/v2/meteo').set('Cookie', cookies);
    expect(echec.status).toBe(200);
    expect(echec.body.meteo).toBeNull();

    const apres = vi.fn(async () =>
      reponseOpenMeteo({ weather_code: 61, temperature_2m: 12, is_day: 0 })
    );
    vi.stubGlobal('fetch', apres);
    const reussite = await request(app).get('/api/v2/meteo').set('Cookie', cookies);

    expect(apres).toHaveBeenCalledTimes(1);
    expect(reussite.body.meteo).toMatchObject({ code: 61, estJour: false });
  });

  /*
   * ⚠️ UNE RÉPONSE BIEN FORMÉE MAIS SANS RELEVÉ N'EST PAS UNE RÉUSSITE : le
   * statut HTTP ne suffit pas à la valider, et un code `undefined` s'afficherait
   * en icône « inconnu ».
   */
  it('écarte une réponse sans code météo', async () => {
    const cookies = await connecter({ nom: 'ISTA Fes', region: 'Fès-Meknès' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));

    const { body } = await request(app).get('/api/v2/meteo').set('Cookie', cookies);
    expect(body.meteo).toBeNull();
  });

  /*
   * ⚠️ NI NOM NI RÉGION RECONNUS : on n'appelle même pas l'API. Une météo
   * affichée pour une ville qui n'est pas la bonne est pire qu'une absence.
   */
  it('n’appelle pas l’API quand le lieu est introuvable', async () => {
    const cookies = await connecter({ nom: 'ISTA Quelque Part', region: 'Ailleurs' });
    const appels = vi.fn();
    vi.stubGlobal('fetch', appels);

    const { body } = await request(app).get('/api/v2/meteo').set('Cookie', cookies);

    expect(body.meteo).toBeNull();
    expect(appels).not.toHaveBeenCalled();
  });

  it('refuse un visiteur sans session', async () => {
    expect((await request(app).get('/api/v2/meteo')).status).toBe(401);
  });
});
