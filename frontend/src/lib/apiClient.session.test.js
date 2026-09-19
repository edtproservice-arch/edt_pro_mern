import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Le renouvellement de session — ce qui fait, ou non, déconnecter.
 *
 * ⚠️ C'EST LE RETOUR DU PORTEUR : « même si je travaille, la session expire ».
 * Le renouvellement rendait `false` pour un refus du serveur MAIS AUSSI pour une
 * coupure réseau ou un 502 : un raté passager déconnectait quelqu'un en pleine
 * saisie. Hébergé le réseau coupe ; en local jamais.
 */
const reponse = (status, corps = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => corps,
});

let api;
let ApiError;
let expiration;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  expiration = vi.fn();
  // `window` n'existe pas sous Node : sa présence prouve qu'on a voulu rediriger.
  vi.stubGlobal('window', {
    get location() {
      expiration();
      return { pathname: '/emploi', set href(_) {} };
    },
  });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  ({ api, ApiError } = await import('./apiClient.js'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Joue une requête en avançant les minuteurs des pauses entre essais. */
const jouer = async (promesse) => {
  const enCours = promesse.then(
    (valeur) => ({ valeur }),
    (erreur) => ({ erreur })
  );
  await vi.runAllTimersAsync();
  return enCours;
};

describe('renouvellement de session', () => {
  it('⚠️ un serveur INJOIGNABLE ne déconnecte PAS', async () => {
    const fetch = vi.fn(async (url) => {
      if (String(url).includes('/auth/rafraichir')) throw new TypeError('Failed to fetch');
      return reponse(401, { message: 'Non authentifié' });
    });
    vi.stubGlobal('fetch', fetch);

    const { erreur } = await jouer(api.get('/api/v2/seances/contexte'));

    expect(erreur).toBeInstanceOf(ApiError);
    expect(erreur.code).toBe('SERVEUR_INDISPONIBLE');
    expect(expiration).not.toHaveBeenCalled();
    // Trois tentatives de renouvellement, puis on le dit — sans en faire plus.
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/auth/rafraichir'))).toHaveLength(3);
  });

  it('⚠️ un 502 de l’hébergeur pendant le renouvellement ne déconnecte pas non plus', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        String(url).includes('/auth/rafraichir') ? reponse(502) : reponse(401)
      )
    );

    const { erreur } = await jouer(api.get('/api/v2/seances/contexte'));

    expect(erreur.code).toBe('SERVEUR_INDISPONIBLE');
    expect(expiration).not.toHaveBeenCalled();
  });

  it('un raté passager du renouvellement se rattrape à l’essai suivant', async () => {
    let essais = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).includes('/auth/rafraichir')) {
          essais += 1;
          return essais === 1 ? reponse(503) : reponse(200);
        }
        return essais === 0 ? reponse(401) : reponse(200, { ok: true });
      })
    );

    const { valeur } = await jouer(api.get('/api/v2/seances/contexte'));

    expect(valeur).toEqual({ ok: true });
  });

  it('renouvelle et rejoue la requête, sans que l’utilisateur le voie', async () => {
    let renouvelee = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).includes('/auth/rafraichir')) {
          renouvelee = true;
          return reponse(200);
        }
        return renouvelee ? reponse(200, { donnee: 1 }) : reponse(401);
      })
    );

    const { valeur } = await jouer(api.get('/api/v2/seances/contexte'));

    expect(valeur).toEqual({ donnee: 1 });
  });

  it('⚠️ un refus rejoue UNE fois : un autre onglet a peut-être déjà renouvelé le cookie', async () => {
    // Le refresh token tourne : deux onglets qui renouvellent ensemble présentent
    // le même jeton, le second est refusé — alors que le premier a posé des
    // cookies neufs, partagés par les deux.
    let requetes = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).includes('/auth/rafraichir')) return reponse(401);
        requetes += 1;
        return requetes === 1 ? reponse(401) : reponse(200, { donnee: 2 });
      })
    );

    const { valeur } = await jouer(api.get('/api/v2/seances/contexte'));

    expect(valeur).toEqual({ donnee: 2 });
  });

  it('une session réellement finie déconnecte, après UNE seule seconde chance', async () => {
    const fetch = vi.fn(async () => reponse(401, { message: 'Session expirée' }));
    vi.stubGlobal('fetch', fetch);

    const { erreur } = await jouer(api.get('/api/v2/seances/contexte'));

    expect(erreur.status).toBe(401);
    expect(expiration).toHaveBeenCalled();
    // requête, renouvellement, requête rejouée — pas de boucle.
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
