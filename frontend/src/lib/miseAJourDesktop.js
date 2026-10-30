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
export const estApplicationDesktop = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

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
 */
export function creerSuiviMiseAJour({ verifier, relancer }) {
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

/** Le suivi de l'application : les plugins Tauri, chargés à la demande. */
export const suiviMiseAJour = creerSuiviMiseAJour({
  verifier: async () => {
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

/** Au démarrage, puis toutes les 6 heures — dans l'application de bureau seulement. */
export function verifierMiseAJourDesktop() {
  if (!estApplicationDesktop()) return undefined;
  suiviMiseAJour.verifier();
  const minuterie = setInterval(() => suiviMiseAJour.verifier(), SIX_HEURES);
  return () => clearInterval(minuterie);
}
