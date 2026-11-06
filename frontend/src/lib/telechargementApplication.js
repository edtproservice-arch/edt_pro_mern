import { toast } from 'sonner';
import { estApplicationAndroid, estApplicationDesktop } from './miseAJourDesktop';

/**
 * ═══ LES DOCUMENTS TÉLÉCHARGÉS DANS LES APPLICATIONS (2026-11-06, retour du porteur) ═══
 * « En mobile, les documents ne se téléchargent pas ; en desktop, ni notification ni signe que
 * le document est téléchargé. » Le lien `download` que pose `telecharger` (apiClient) est fait
 * pour un navigateur : la WebView d'Android l'ignore, et celle de Windows enregistre en silence,
 * sans dire où. Dans les applications, c'est donc l'application qui ENREGISTRE le fichier dans
 * Téléchargements, et la page qui l'ANNONCE, avec de quoi l'ouvrir :
 *   · bureau  — la commande `enregistrer_telechargement` (`src-tauri/src/lib.rs`) ;
 *   · Android — le pont `window.EdtproFichiers` (`scripts/preparer-android.mjs`).
 *
 * @param {Blob} tampon
 * @param {string} nom
 * @returns {Promise<boolean>} `false` : pas dans une application — au navigateur de faire.
 */
export async function enregistrerDansLApplication(tampon, nom) {
  if (estApplicationDesktop()) return enregistrerSurLeBureau(tampon, nom);
  if (estApplicationAndroid() && typeof window !== 'undefined' && window.EdtproFichiers) {
    return enregistrerSurAndroid(tampon, nom);
  }
  return false;
}

async function enregistrerSurLeBureau(tampon, nom) {
  const { invoke } = await import('@tauri-apps/api/core');
  let chemin;
  try {
    // En binaire, et le nom dans un en-tête — encodé : les accents n'y passent pas tels quels.
    chemin = await invoke('enregistrer_telechargement', new Uint8Array(await tampon.arrayBuffer()), {
      headers: { 'x-nom': encodeURIComponent(nom) },
    });
  } catch {
    // Une application plus ancienne, sans la commande : le navigateur intégré fait comme avant.
    return false;
  }

  const fichier = String(chemin).split(/[\\/]/).pop();
  const signaler = (action) => (erreur) =>
    toast.error(`${action} impossible`, { description: String(erreur?.message ?? erreur) });
  toast.success('Document téléchargé', {
    description: `${fichier} — dans le dossier Téléchargements.`,
    duration: 10_000,
    action: {
      label: 'Ouvrir',
      onClick: () => invoke('plugin:opener|open_path', { path: chemin }).catch(signaler('Ouverture')),
    },
    cancel: {
      label: 'Dossier',
      onClick: () =>
        invoke('plugin:opener|reveal_item_in_dir', { paths: [chemin] }).catch(signaler('Ouverture du dossier')),
    },
  });
  return true;
}

async function enregistrerSurAndroid(tampon, nom) {
  const mime = tampon.type || 'application/octet-stream';
  const adresse = window.EdtproFichiers.enregistrer(nom, mime, await enBase64(tampon));

  if (!adresse) {
    toast.error('Document non enregistré', {
      description: 'Le téléphone n’a pas permis l’enregistrement dans Téléchargements (Android 10 ou plus récent requis).',
    });
    return true;
  }
  toast.success('Document téléchargé', {
    description: `${nom} — dans Téléchargements (application Fichiers).`,
    duration: 10_000,
    action: { label: 'Ouvrir', onClick: () => window.EdtproFichiers.ouvrir(adresse, mime) },
  });
  return true;
}

/** Le contenu du fichier en base64 — ce que le pont Android sait recevoir d'une page. */
function enBase64(tampon) {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resoudre(String(lecteur.result).split(',')[1] ?? '');
    lecteur.onerror = () => rejeter(lecteur.error);
    lecteur.readAsDataURL(tampon);
  });
}
