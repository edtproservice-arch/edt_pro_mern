import { api } from '@/lib/apiClient';

/**
 * Battement de cœur — ← `public/api-interceptor.js` (bloc 0) de l'existant.
 *
 * Il alimente les deux seuls indicateurs qui n'ont pas d'autre source : le TEMPS
 * PASSÉ par compte et le fait d'être EN LIGNE, tous deux affichés par la page
 * « Statistiques » de l'administration.
 *
 * ═══ ⚠️ SEULEMENT QUAND L'ONGLET EST VISIBLE ═══
 * C'est la règle de l'existant, et elle est juste : un onglet laissé ouvert
 * derrière une autre fenêtre n'est pas du temps passé sur le produit. Sans elle,
 * une nuit de veille compterait huit heures de travail.
 *
 * ⚠️ ET IL REPART À LA REPRISE DE L'ONGLET, pas seulement au prochain tour de
 * minuterie : revenir sur l'onglet doit rallumer le badge « en ligne » tout de
 * suite, pas jusqu'à trente secondes plus tard.
 *
 * ⚠️ LE SERVEUR MESURE LE TEMPS, PAS LE CLIENT : celui-ci ne fait que signaler
 * sa présence. C'est ce qui empêche trois onglets ouverts de compter trois fois
 * le même temps — le défaut de l'existant, qui ajoutait 30 s par appel reçu.
 */
const PAS_MS = 30_000;

/** Un premier battement rapide : le badge s'allume dès l'arrivée sur une page. */
const PREMIER_MS = 5_000;

export function demarrerBattementCoeur() {
  let minuterie = null;

  const battre = () => {
    if (document.visibilityState !== 'visible') return;
    /*
     * ⚠️ L'ÉCHEC EST AVALÉ : une session expirée ou un réseau coupé ne doivent
     * pas remplir la console d'erreurs pour un signal accessoire. Rien de ce que
     * l'utilisateur fait ne dépend de ce battement.
     */
    api.post('/api/v2/auth/activite').catch(() => {});
  };

  const surVisibilite = () => {
    if (document.visibilityState === 'visible') battre();
  };

  const depart = setTimeout(battre, PREMIER_MS);
  minuterie = setInterval(battre, PAS_MS);
  document.addEventListener('visibilitychange', surVisibilite);

  return () => {
    clearTimeout(depart);
    clearInterval(minuterie);
    document.removeEventListener('visibilitychange', surVisibilite);
  };
}
