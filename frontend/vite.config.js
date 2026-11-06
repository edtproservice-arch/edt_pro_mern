import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

/**
 * ⚠️ AGENT SANS RÉUTILISATION DE CONNEXION.
 *
 * Symptôme : le PREMIER appel après un redémarrage du backend échoue —
 * `[vite] http proxy error: /api/v2/auth/connexion · read ECONNRESET` — et tout
 * refonctionne après un rafraîchissement de la page.
 *
 * Cause : depuis Node 19, l'agent HTTP global garde les connexions ouvertes
 * (`keepAlive: true`). Le proxy de Vite en conserve donc une dans son pool. Or
 * `node --watch` redémarre le backend à chaque fichier modifié, ce qui ferme
 * ses sockets sans que le proxy le sache : il réutilise une connexion morte, et
 * le noyau répond RST. Le rafraîchissement en ouvre une neuve, d'où
 * l'impression que « ça marche la seconde fois ».
 *
 * Un agent qui ne réutilise rien supprime le cas : chaque requête ouvre sa
 * connexion. Sur localhost, la poignée de main coûte quelques dizaines de
 * microsecondes — sans commune mesure avec une connexion refusée à l'écran.
 *
 * ⚠️ Ne concerne QUE le développement. En production, Nginx est le point
 * d'entrée (§5 du plan) et gère ses propres connexions amont.
 */
const agentSansReutilisation = new http.Agent({ keepAlive: false });

/**
 * La version affichée au pied de la page de connexion (2026-11-03, demande du porteur) : le tag
 * qui publie (`GITHUB_REF_NAME`, application de bureau et Android), sinon le dernier tag du
 * dépôt (le site, construit par `deployer.sh`). Inconnue, rien ne s'affiche.
 */
function versionApplication() {
  const tag = process.env.GITHUB_REF_NAME ?? '';
  if (/^v\d+\.\d+\.\d+$/.test(tag)) return tag.slice(1);
  try {
    return execSync('git describe --tags --abbrev=0', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .replace(/^v/, '');
  } catch {
    return '';
  }
}

/**
 * Le proxy de Vite rend une page d'erreur HTML quand il ne joint pas la cible.
 * Or `apiClient` attend du JSON — il lèverait `REPONSE_NON_JSON`, en accusant
 * l'URL alors que le serveur est simplement absent. On répond donc en JSON, au
 * même format que l'API, pour que le message affiché soit le bon.
 */
function repondreEnJson(cible) {
  return (proxy) => {
    proxy.on('error', (erreur, requete, reponse) => {
      if (!reponse || reponse.headersSent || !reponse.writeHead) return;

      reponse.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      reponse.end(
        JSON.stringify({
          success: false,
          code: 'BACKEND_INJOIGNABLE',
          message: `${cible} n’a pas répondu (${erreur.code ?? 'erreur réseau'}). Vérifiez qu’il est démarré.`,
        })
      );
    });
  };
}

export default defineConfig({
  plugins: [react()],
  define: {
    __VERSION_APP__: JSON.stringify(versionApplication()),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    /*
     * ═══ L'APPLICATION ANDROID EN LOCAL (2026-11-06, `npm run android:dev`) ═══
     * Le téléphone charge les pages depuis CE serveur : il doit l'atteindre par le réseau, pas
     * par `localhost` — qui, sur le téléphone, désigne le téléphone. `tauri android dev` donne
     * l'adresse du PC dans `TAURI_DEV_HOST`. Hors de ce cas, rien ne change : `localhost` seul.
     * `strictPort` : un second Vite ne doit pas se glisser sur 5174 pendant que l'application
     * attend 5173.
     */
    host: process.env.TAURI_DEV_HOST || false,
    strictPort: Boolean(process.env.TAURI_DEV_HOST),
    hmr: process.env.TAURI_DEV_HOST
      ? { protocol: 'ws', host: process.env.TAURI_DEV_HOST, port: 1421 }
      : undefined,
    proxy: {
      // Modules déjà migrés → API Express locale
      '/api/v2': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        /*
         * ⚠️ `ws: true` — la collaboration temps réel ouvre une WebSocket sur
         * `/api/v2/temps-reel`. Sans cette option, le proxy ne relaie pas la
         * demande de changement de protocole et la socket échoue en 1006, sans
         * autre message. En production, c'est Nginx qui s'en charge
         * (`Upgrade` / `Connection`).
         */
        ws: true,
        agent: agentSansReutilisation,
        configure: repondreEnJson('L’API Node (port 4000)'),
      },
      // Modules pas encore migrés → API PHP existante (XAMPP)
      // Reproduit en dev le routage Nginx décrit au §5 du plan de migration.
      '/api': {
        target: 'http://localhost/gestion_edt',
        changeOrigin: true,
        agent: agentSansReutilisation,
        configure: repondreEnJson('L’API PHP (XAMPP)'),
      },
    },
  },
});
