import { toast } from 'sonner';

/**
 * Mise à jour automatique de l'application de bureau (Tauri).
 *
 * L'interface est EMBARQUÉE dans l'exécutable : une installation garde la
 * version compilée tant qu'on ne lui en livre pas une autre. Au démarrage, on
 * interroge donc `latest.json` publié dans les Releases GitHub
 * (`plugins.updater` de `src-tauri/tauri.conf.json`) ; si une version plus
 * récente existe, on propose de l'installer.
 *
 * ⚠️ SEULEMENT DANS TAURI : dans un navigateur, le site est déjà à jour à
 * chaque déploiement, et les plugins n'ont personne à qui parler. Les imports
 * sont dynamiques pour ne pas alourdir la version web.
 *
 * ⚠️ L'ÉCHEC EST AVALÉ (hors ligne, GitHub indisponible, aucune release) :
 * l'application doit démarrer quoi qu'il arrive, la vérification reprendra au
 * prochain lancement.
 */
export const estApplicationDesktop = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function verifierMiseAJourDesktop() {
  if (!estApplicationDesktop()) return;
  let annule = false;

  (async () => {
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const miseAJour = await check();
      if (!miseAJour || annule) return;

      toast.info(`Nouvelle version disponible : ${miseAJour.version}`, {
        description: 'Installez-la maintenant ; l’application redémarrera ensuite.',
        duration: Infinity,
        action: { label: 'Installer', onClick: () => installer(miseAJour) },
      });
    } catch (erreur) {
      console.warn('Vérification de mise à jour impossible :', erreur);
    }
  })();

  return () => {
    annule = true;
  };
}

async function installer(miseAJour) {
  const suivi = toast.loading('Téléchargement de la mise à jour…');
  try {
    let total = 0;
    let recu = 0;
    await miseAJour.downloadAndInstall((evenement) => {
      if (evenement.event === 'Started') total = evenement.data.contentLength ?? 0;
      if (evenement.event === 'Progress' && total) {
        recu += evenement.data.chunkLength;
        toast.loading(`Téléchargement… ${Math.round((recu / total) * 100)} %`, { id: suivi });
      }
    });
    toast.loading('Installation terminée, redémarrage…', { id: suivi });
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (erreur) {
    toast.error('La mise à jour a échoué', { id: suivi, description: String(erreur) });
  }
}
