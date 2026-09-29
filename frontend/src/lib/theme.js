import { useEffect, useSyncExternalStore } from 'react';

/**
 * Le thème de l'interface — clair, sombre, ou celui du système (2026-09-28,
 * demande du porteur : « le mode sombre pour toute la plateforme »).
 *
 * ⚠️ RETENU DANS LE NAVIGATEUR, pas dans le compte : il vaut pour toutes les
 * pages et toutes les sessions ouvertes depuis cet appareil, connexion comprise.
 * ⚠️ `public/theme-init.js` applique le même choix AVANT le premier rendu — même
 * clé, mêmes valeurs — sinon la page s'afficherait claire un instant.
 * ⚠️ CLAIR PAR DÉFAUT : ce que l'application affichait jusqu'ici.
 */
const CLE = 'edtpro.theme';
export const CHOIX_THEME = ['clair', 'sombre', 'systeme'];

const ecouteurs = new Set();

export function lireChoixTheme() {
  try {
    const choix = localStorage.getItem(CLE);
    return CHOIX_THEME.includes(choix) ? choix : 'clair';
  } catch {
    return 'clair';
  }
}

const systemeSombre = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

export const themeEstSombre = (choix) => choix === 'sombre' || (choix === 'systeme' && systemeSombre());

export function appliquerTheme(choix = lireChoixTheme()) {
  document.documentElement.classList.toggle('dark', themeEstSombre(choix));
}

export function definirChoixTheme(choix) {
  try {
    localStorage.setItem(CLE, choix);
  } catch {
    /* sans stockage, le choix ne vaut que pour cette visite */
  }
  appliquerTheme(choix);
  ecouteurs.forEach((ecouteur) => ecouteur());
}

const sabonner = (ecouteur) => {
  ecouteurs.add(ecouteur);
  return () => ecouteurs.delete(ecouteur);
};

/** `{ choix, sombre, definir }` — `sombre` est le thème EFFECTIVEMENT appliqué. */
export function useTheme() {
  const choix = useSyncExternalStore(sabonner, lireChoixTheme, () => 'clair');

  // Le choix « système » suit l'appareil quand celui-ci bascule.
  useEffect(() => {
    if (choix !== 'systeme') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const suivre = () => {
      appliquerTheme('systeme');
      ecouteurs.forEach((ecouteur) => ecouteur());
    };
    media.addEventListener('change', suivre);
    return () => media.removeEventListener('change', suivre);
  }, [choix]);

  return { choix, sombre: themeEstSombre(choix), definir: definirChoixTheme };
}
