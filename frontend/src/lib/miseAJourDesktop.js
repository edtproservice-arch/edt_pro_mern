import { useSyncExternalStore } from 'react';

/**
 * Mise à jour automatique de l'application de bureau (Tauri).
 *
 * L'interface est EMBARQUÉE dans l'exécutable : une installation garde la
 * version compilée tant qu'on ne lui en livre pas une autre. Au démarrage, on
 * interroge donc `latest.json` publié dans les Releases GitHub
 * (`plugins.updater` de `src-tauri/tauri.conf.json`) ; si une version plus
 * récente existe, on propose de l'installer.
 *
 * ═══ COMME LES GRANDES APPLICATIONS (2026-10-30, demande du porteur) ═══
 * Plus un simple toast, qui disparaissait au premier clic ailleurs : une FENÊTRE
 * s'ouvre au lancement (version actuelle → nouvelle, notes, progression), et une
 * ICÔNE reste dans la barre du haut tant que la mise à jour n'est pas faite —
 * « Plus tard » ne la fait pas oublier. Voir `components/layout/MiseAJourDesktop.jsx`.
 * Une application restée ouverte revérifie toutes les 6 heures.
 *
 * ⚠️ SEULEMENT DANS TAURI : dans un navigateur, le site est déjà à jour à
 * chaque déploiement, et les plugins n'ont personne à qui parler. Les imports
 * sont dynamiques pour ne pas alourdir la version web.
 *
 * ⚠️ L'ÉCHEC DE LA VÉRIFICATION EST AVALÉ (hors ligne, GitHub indisponible, aucune
 * release) : l'application doit démarrer quoi qu'il arrive, la vérification
 * reprendra plus tard. L'échec de l'INSTALLATION, lui, se dit dans la fenêtre.
 */
/** Dans l'application Tauri — bureau OU Android. */
export const estApplicationTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
/** Sur un appareil Android (navigateur ou application). */
export const estAndroid = () => typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent ?? '');
/** L'application de BUREAU : Tauri, hors Android — fenêtre, barre de titre, mise à jour signée. */
export const estApplicationDesktop = () => estApplicationTauri() && !estAndroid();
/** L'application ANDROID (2026-10-30). */
export const estApplicationAndroid = () => estApplicationTauri() && estAndroid();

/*
 * ═══ SUR ANDROID, PAS DE MISE À JOUR SIGNÉE (2026-10-30) ═══ Le plugin `updater` de Tauri
 * n'existe pas sur mobile, et Android n'installe pas seul une APK hors Play Store. L'application
 * lit donc ce petit fichier, publié avec chaque APK (`.github/workflows/application-bureau.yml`),
 * et propose d'ouvrir la nouvelle APK dans le navigateur — l'utilisateur l'installe.
 */
export const MANIFESTE_ANDROID = 'https://edtpro.tech/telechargements/android.json';

/** « 0.10.0 » plus récente que « 0.9.3 » : comparaison nombre par nombre. */
export function plusRecente(candidate, actuelle) {
  const a = String(candidate ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const b = String(actuelle ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

const SIX_HEURES = 6 * 60 * 60 * 1000;

/** Rien à proposer : l'icône et la fenêtre restent invisibles. */
export const ETAT_INITIAL = Object.freeze({
  etat: 'aucune', // aucune | disponible | telechargement | redemarrage | erreur
  version: null,
  versionActuelle: null,
  notes: '',
  date: null,
  progression: null, // 0 → 100 pendant le téléchargement, null si la taille est inconnue
  erreur: null,
  fenetreOuverte: false,
});

/**
 * Le suivi d'une mise à jour, ses fonctions Tauri INJECTÉES : `verifier` rend la mise à jour
 * disponible (ou `null`), `relancer` redémarre l'application. Ainsi testable hors de Tauri.
 * `mobile` (valeur ou fonction) : Android — « installer » ouvre l'APK dans le navigateur ; pas de
 * redémarrage, la proposition reste dans l'icône jusqu'à ce que la nouvelle version tourne.
 */
export function creerSuiviMiseAJour({ verifier, relancer, mobile = false }) {
  let etat = ETAT_INITIAL;
  let miseAJour = null;
  const abonnes = new Set();

  const changer = (suite) => {
    etat = { ...etat, ...suite };
    for (const abonne of abonnes) abonne();
  };

  return {
    lire: () => etat,
    abonner(abonne) {
      abonnes.add(abonne);
      return () => abonnes.delete(abonne);
    },

    /** Cherche une version plus récente ; trouvée, la fenêtre s'ouvre — une fois par version. */
    async verifier() {
      if (etat.etat === 'telechargement' || etat.etat === 'redemarrage') return;
      try {
        const trouvee = await verifier();
        if (!trouvee) return;
        const nouvelle = trouvee.version !== etat.version;
        miseAJour = trouvee;
        changer({
          etat: etat.etat === 'erreur' && !nouvelle ? 'erreur' : 'disponible',
          version: trouvee.version,
          versionActuelle: trouvee.currentVersion ?? null,
          notes: String(trouvee.body ?? '').trim(),
          date: trouvee.date ?? null,
          // Une NOUVELLE version rouvre la fenêtre ; la même, revue 6 h plus tard, reste dans l'icône.
          fenetreOuverte: nouvelle ? true : etat.fenetreOuverte,
        });
      } catch (erreur) {
        console.warn('Vérification de mise à jour impossible :', erreur);
      }
    },

    ouvrir: () => etat.etat !== 'aucune' && changer({ fenetreOuverte: true }),
    // « Plus tard » : la fenêtre se ferme, l'icône reste. Pas pendant l'installation.
    fermer: () => etat.etat !== 'telechargement' && etat.etat !== 'redemarrage' && changer({ fenetreOuverte: false }),

    /** Télécharge, installe, puis redémarre — la progression se lit dans `etat.progression`. */
    async installer() {
      if (!miseAJour || etat.etat === 'telechargement' || etat.etat === 'redemarrage') return;
      changer({ etat: 'telechargement', progression: null, erreur: null, fenetreOuverte: true });
      try {
        let total = 0;
        let recu = 0;
        if (typeof mobile === 'function' ? mobile() : mobile) {
          await miseAJour.downloadAndInstall();
          changer({ etat: 'disponible', progression: null, fenetreOuverte: false });
          return;
        }
        await miseAJour.downloadAndInstall((evenement) => {
          if (evenement.event === 'Started') total = evenement.data?.contentLength ?? 0;
          if (evenement.event === 'Progress' && total) {
            recu += evenement.data?.chunkLength ?? 0;
            changer({ progression: Math.min(100, Math.round((recu / total) * 100)) });
          }
        });
        changer({ etat: 'redemarrage', progression: 100 });
        await relancer();
      } catch (erreur) {
        changer({ etat: 'erreur', erreur: String(erreur?.message ?? erreur) });
      }
    },
  };
}

/** Android : la version publiée sur edtpro.tech, si elle est plus récente que celle-ci. */
async function verifierAndroid() {
  const reponse = await fetch(MANIFESTE_ANDROID, { cache: 'no-store' });
  if (!reponse.ok) return null;
  const publiee = await reponse.json();
  const { getVersion } = await import('@tauri-apps/api/app');
  const actuelle = await getVersion();
  if (!publiee?.version || !publiee?.url || !plusRecente(publiee.version, actuelle)) return null;
  return {
    version: publiee.version,
    currentVersion: actuelle,
    body: publiee.notes ?? '',
    date: publiee.date ?? null,
    // Le navigateur du téléphone télécharge l'APK ; Android propose ensuite de l'installer.
    downloadAndInstall: async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('plugin:opener|open_url', { url: publiee.url });
    },
  };
}

/** Le suivi de l'application : les plugins Tauri, chargés à la demande. */
export const suiviMiseAJour = creerSuiviMiseAJour({
  mobile: estApplicationAndroid,
  verifier: async () => {
    if (estApplicationAndroid()) return verifierAndroid();
    const { check } = await import('@tauri-apps/plugin-updater');
    return check();
  },
  relancer: async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  },
});

/** L'état de la mise à jour, pour l'icône et la fenêtre. */
export const useMiseAJourDesktop = () => useSyncExternalStore(suiviMiseAJour.abonner, suiviMiseAJour.lire);

/** Au démarrage, puis toutes les 6 heures — dans l'application, bureau ou Android. */
export function verifierMiseAJourDesktop() {
  if (!estApplicationTauri()) return undefined;
  suiviMiseAJour.verifier();
  const minuterie = setInterval(() => suiviMiseAJour.verifier(), SIX_HEURES);
  return () => clearInterval(minuterie);
}
