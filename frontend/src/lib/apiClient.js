import { lireAnneeActive } from './anneeActive';
import { lireConnexionId } from './identiteConnexion';
import { queryClient } from './queryClient';

let redirectionEnCours = false;

const BASE_API = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

function urlApi(path) {
  return `${BASE_API}${path}`;
}

/** Redirige vers la page de connexion dès qu'une session est expirée ou invalide. */
export function gererExpirationsession(raison = 'expiration') {
  if (redirectionEnCours) return;
  redirectionEnCours = true;

  try {
    queryClient.clear();
  } catch {
    // ignoré
  }

  if (window.location.pathname !== '/connexion') {
    window.location.href = `/connexion?raison=${raison}`;
  } else {
    redirectionEnCours = false;
  }
}

/**
 * Client HTTP unique de l'application.
 *
 * Remplace les appels `fetch` éparpillés dans les pages PHP/HTML
 * (public/assets/js/ajax-security.js, api-interceptor.js et les ~90 appels
 * inline). Toute requête passe par ici : une seule gestion des erreurs, du
 * rafraîchissement de session et du préfixe d'URL.
 *
 * `/api/v2` → API Express (modules migrés)
 * `/api`    → API PHP existante (modules pas encore migrés)
 */

/*
 * En-têtes de contexte posés sur CHAQUE requête.
 *
 * L'année active voyage par en-tête plutôt que par la session serveur : deux
 * onglets peuvent ainsi consulter deux années différentes, ce que la session
 * PHP interdisait. `resolveTenant` retombe sur l'année de l'établissement quand
 * l'en-tête est absent.
 */
function enTetesContexte() {
  const annee = lireAnneeActive();
  const connexion = lireConnexionId();
  return {
    ...(annee === null ? {} : { 'X-Annee-Scolaire': String(annee) }),
    /*
     * L'onglet se désigne : le serveur l'écarte quand il annonce l'écriture aux
     * autres membres de la salle temps réel (il relit déjà sa propre grille).
     */
    ...(connexion ? { 'X-Connexion-Id': connexion } : {}),
  };
}

/*
 * ═══ ⚠️⚠️ LE RAFRAÎCHISSEMENT TRANSPARENT — ET POURQUOI IL MANQUAIT ═══
 * (2026-09-06, signalé par le porteur : « je travaille dans l'application, je
 * planifie des séances, et soudain la session s'expire ».)
 *
 * L'access token vit **15 minutes** (`ACCESS_TOKEN_TTL`), le refresh **30
 * jours**, et la route `POST /auth/rafraichir` existait depuis la Phase 3 —
 * mais AUCUN appelant ne l'avait jamais appelée : `grep auth/rafraichir` sur
 * tout `frontend/src` ne rendait rien. Le client se contentait de jeter
 * l'utilisateur dehors au premier 401.
 *
 * Conséquence exacte : **exactement quinze minutes après la connexion, la
 * requête suivante déconnectait**, quelle que soit l'activité. Et le
 * déclencheur n'était même pas un geste de l'utilisateur — le BATTEMENT DE
 * CŒUR part tout seul toutes les 30 s : la déconnexion tombait donc au plus
 * tard 30 s après la quinzième minute, en pleine saisie. D'où le « soudain ».
 *
 * ⚠️ REJOUER UNE ÉCRITURE EST SANS DANGER ICI : `authenticate` est le PREMIER
 * intercepteur de chaque route. Une requête refusée en 401 n'a donc jamais
 * atteint son service — rien n'a été écrit, et le rejeu ne peut pas produire de
 * doublon. Ce ne serait pas vrai d'un 500 ou d'un délai dépassé, que l'on ne
 * rejoue justement pas.
 *
 * ⚠️ UNE SEULE TENTATIVE EN VOL, ET CE N'EST PAS UNE OPTIMISATION. Le refresh
 * token TOURNE : `rafraichir()` supprime l'enregistrement présenté et en émet
 * un neuf. Un écran qui lance cinq requêtes les verrait toutes échouer en 401
 * ensemble ; cinq rafraîchissements concurrents, et seul le premier
 * réussirait — les quatre autres présenteraient un jeton déjà supprimé,
 * `REFRESH_INVALIDE`, et déconnecteraient l'utilisateur que le premier venait
 * de sauver. La promesse partagée est donc une CONDITION DE CORRECTION.
 */
let rafraichissementEnCours = null;

const PAUSE_ENTRE_ESSAIS_MS = [400, 1200];

const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tente de renouveler la session, et dit CE QUI S'EST PASSÉ.
 *
 * ═══ ⚠️ « REFUSÉ » ET « INJOIGNABLE » NE SONT PAS LA MÊME CHOSE (2026-09-19,
 * signalé par le porteur : « même si je travaille, la session expire ») ═══
 * Cette fonction rendait un simple booléen : `false` pour un refus du serveur,
 * mais AUSSI pour une coupure réseau, un délai dépassé ou un 502 le temps d'un
 * redémarrage de l'hébergeur. Et `false` voulait dire « la session est finie » :
 * un raté passager suffisait à déconnecter quelqu'un en pleine saisie. En local
 * le réseau ne coupe jamais, personne ne le voyait ; hébergé, il coupe.
 *
 *   - `ok`            le serveur a renouvelé les cookies ;
 *   - `refuse`        le serveur a DIT non (401/403) : le refresh token est
 *                      absent, expiré ou révoqué — la session est réellement finie ;
 *   - `indisponible`  on n'a PAS obtenu de réponse exploitable (réseau, 5xx) : on
 *                      ne sait pas. On réessaie deux fois, puis on le DIT — sans
 *                      déconnecter.
 */
async function tenterRafraichissement() {
  for (let essai = 0; ; essai += 1) {
    try {
      const reponse = await fetch(urlApi('/api/v2/auth/rafraichir'), {
        method: 'POST',
        credentials: 'include',
      });
      if (reponse.ok) return 'ok';
      if (reponse.status === 401 || reponse.status === 403) return 'refuse';
    } catch {
      // Réseau coupé : traité comme « indisponible », comme un 5xx.
    }

    if (essai >= PAUSE_ENTRE_ESSAIS_MS.length) return 'indisponible';
    await attendre(PAUSE_ENTRE_ESSAIS_MS[essai]);
  }
}

function rafraichirEtat() {
  if (rafraichissementEnCours) return rafraichissementEnCours;

  rafraichissementEnCours = tenterRafraichissement().finally(() => {
    rafraichissementEnCours = null;
  });

  return rafraichissementEnCours;
}

/** Pour les appelants qui n'ont besoin que de savoir si c'est renouvelé. */
export async function rafraichirSession() {
  return (await rafraichirEtat()) === 'ok';
}

/** `'ok'`, `'refuse'` ou `'indisponible'` — pour qui doit distinguer une session finie d'un réseau qui coupe. */
export const etatRafraichissement = rafraichirEtat;

/*
 * ⚠️ LES ROUTES D'AUTHENTIFICATION NE SE REJOUENT PAS. Un mot de passe faux
 * répond 401 : le rafraîchir n'a aucun sens, et rejouer la requête doublerait
 * les tentatives comptées par la limitation de débit. `rafraichir` et
 * `deconnexion` en font partie — se rafraîchir pour se rafraîchir bouclerait.
 */
function accepteRafraichissement(path) {
  return !/\/auth\/(connexion|inscription|verification|mot-de-passe|rafraichir|deconnexion)/.test(
    path
  );
}

/**
 * Joue une requête, et la REJOUE UNE FOIS après un rafraîchissement réussi.
 *
 * ⚠️ UNE SEULE FOIS : si le second essai répond encore 401, c'est que la
 * session est réellement finie. Boucler la ferait marteler le serveur sans
 * jamais rendre la main.
 *
 * ⚠️ SI LE RENOUVELLEMENT EST REFUSÉ, ON REJOUE QUAND MÊME UNE FOIS. Le refresh
 * token tourne : deux onglets qui renouvellent ensemble présentent le même jeton,
 * et le second est refusé alors que le premier vient de poser des cookies
 * neufs — partagés par les deux onglets. Rejouer avec le cookie du moment
 * sauve cet onglet-là ; si c'est encore 401, la session est vraiment finie.
 *
 * ⚠️ ET SI LE SERVEUR NE RÉPOND PAS, ON NE DÉCONNECTE PAS : l'appelant reçoit une
 * erreur ordinaire, la session reste ouverte, et la prochaine requête retentera.
 */
async function avecRafraichissement(envoyer, path) {
  const reponse = await envoyer();
  if (reponse.status !== 401 || !accepteRafraichissement(path)) return reponse;

  const etat = await rafraichirEtat();
  if (etat === 'indisponible') {
    throw new ApiError('Le serveur ne répond pas. Vérifiez la connexion et réessayez.', {
      status: 503,
      code: 'SERVEUR_INDISPONIBLE',
    });
  }

  return envoyer();
}

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(method, path, { body, signal, headers = {} } = {}) {
  const response = await avecRafraichissement(
    () =>
      fetch(urlApi(path), {
        method,
        signal,
        credentials: 'include',
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...enTetesContexte(),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    path
  );

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    /* On n'arrive ici en 401 qu'APRÈS un rafraîchissement tenté et échoué :
       la session est alors réellement terminée. */
    if (response.status === 401 && accepteRafraichissement(path)) {
      gererExpirationsession('expiration');
    }

    throw new ApiError(payload?.message ?? 'Erreur réseau', {
      status: response.status,
      code: payload?.code,
      details: payload?.details,
    });
  }

  /*
   * ⚠️ UN 200 QUI N'EST PAS DU JSON N'EST PAS UN SUCCÈS.
   *
   * Vite sert `index.html` en 200 pour tout chemin qu'il ne connaît pas — c'est
   * le repli d'une application à page unique. Une URL d'API mal écrite (un
   * `/api/v2` oublié) recevait donc du HTML avec un statut 200 :
   * `response.json()` échouait, `payload` valait `null`, et l'appelant recevait
   * un succès VIDE. L'écran affichait « aucun résultat » au lieu de dire que la
   * requête n'avait jamais atteint l'API — un mensonge qui envoie chercher le
   * défaut dans la base de données. C'est exactement ce qui s'est produit sur
   * l'écran Sessions le 2026-08-19.
   */
  if (payload === null && response.status !== 204) {
    throw new ApiError(
      `Réponse inattendue du serveur pour ${path} — la requête n’a pas atteint l’API.`,
      { status: response.status, code: 'REPONSE_NON_JSON' }
    );
  }

  return payload;
}

/**
 * Envoi de fichier (multipart).
 *
 * Le `Content-Type` n'est PAS posé à la main : le navigateur doit le générer
 * lui-même pour y inscrire la frontière du multipart. L'imposer casse
 * l'analyse côté serveur.
 */
async function envoyerFichier(path, fichier, champ = 'fichier', champs = {}) {
  const donnees = new FormData();
  donnees.append(champ, fichier, fichier.name);

  /*
   * ⚠️ TOUT CHAMP MULTIPART VOYAGE EN TEXTE : `true` devient « true », et c'est
   * au serveur de le rapporter à cette chaîne. Envoyer un booléen brut le ferait
   * arriver en « [object Object] » ou en « false » — une chaîne non vide, donc
   * vraie pour qui la teste sans précaution.
   */
  for (const [nom, valeur] of Object.entries(champs)) {
    if (valeur !== undefined && valeur !== null) donnees.append(nom, String(valeur));
  }

  /* ⚠️ UN `FormData` SE REJOUE : le corps est reconstruit à chaque `fetch`,
     contrairement à un flux, qu'une seconde lecture trouverait épuisé. */
  const response = await avecRafraichissement(
    () =>
      fetch(urlApi(path), {
        method: 'POST',
        credentials: 'include',
        headers: enTetesContexte(),
        body: donnees,
      }),
    path
  );
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) {
      gererExpirationsession('expiration');
    }
    throw new ApiError(payload?.message ?? 'Erreur réseau', {
      status: response.status,
      code: payload?.code,
      details: payload?.details,
    });
  }

  return payload;
}

/**
 * Récupère un fichier et le remet au navigateur.
 *
 * Le fichier ne peut PAS être obtenu par un simple lien : la route est en POST
 * (elle porte la carte en cours, non encore enregistrée) et demande le cookie
 * de session. On passe donc par `fetch`, puis par une URL d'objet révoquée
 * aussitôt — sans quoi le tampon reste en mémoire tant que l'onglet est ouvert.
 *
 * @returns {Promise<object|null>} le résumé lu dans l'en-tête `X-Resume-...`
 */
async function telecharger(path, body, { nomParDefaut = 'export.xlsx' } = {}) {
  const response = await avecRafraichissement(
    () =>
      fetch(urlApi(path), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...enTetesContexte() },
        body: JSON.stringify(body),
      }),
    path
  );

  if (!response.ok) {
    if (response.status === 401) {
      gererExpirationsession('expiration');
    }
    // L'erreur est en JSON, même quand le succès ne l'est pas.
    const payload = await response.json().catch(() => null);
    throw new ApiError(payload?.message ?? 'Le fichier n’a pas pu être produit', {
      status: response.status,
      code: payload?.code,
    });
  }

  const tampon = await response.blob();
  const url = URL.createObjectURL(tampon);
  const lien = document.createElement('a');

  lien.href = url;
  lien.download = nomDepuisEntete(response.headers.get('Content-Disposition')) ?? nomParDefaut;
  document.body.append(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(url);

  const resume = response.headers.get('X-Resume-Bilan');
  return resume ? JSON.parse(resume) : null;
}

/** `filename*=UTF-8''...` d'abord : c'est lui qui porte les accents. */
function nomDepuisEntete(entete) {
  if (!entete) return null;

  const encode = /filename\*=UTF-8''([^;]+)/i.exec(entete);
  if (encode) return decodeURIComponent(encode[1]);

  return /filename="([^"]+)"/i.exec(entete)?.[1] ?? null;
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  put: (path, body, options) => request('PUT', path, { ...options, body }),
  patch: (path, body, options) => request('PATCH', path, { ...options, body }),
  delete: (path, options) => request('DELETE', path, options),
  televerser: envoyerFichier,
  telecharger,
};
