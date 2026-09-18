# EDT Pro — réécriture MERN

Réécriture du SaaS **EDT Pro** (gestion d'emplois du temps, OFPPT Maroc) en
MongoDB / Express / React / Node.

L'application PHP/MySQL d'origine reste en production dans `../gestion_edt`,
**intacte**. Elle est migrée module par module (*strangler fig*).

> **Le plan de migration fait foi** : `../gestion_edt/CLAUDE.md`.
> Inventaire de l'existant, modèle de données cible, 11 phases, décisions
> actées. Le lire avant toute contribution.

## Structure

```
gestion_edt_mern/
├── frontend/     React + Vite (JSX)
├── backend/      API Express (ESM)
└── shared/       métier pur + schémas Zod, importé par les deux
```

### Pourquoi un dossier `shared/`

C'est la correction du principal défaut de l'application PHP : la même règle
métier y existe en **trois exemplaires divergents** (normalisation des noms de
formateurs dans `includes/functions.php`, `includes/parse_base_rows.php` et
`public/emploi.html`), ce qui produit les doublons et les formateurs qui
disparaissent.

Ici, une règle est écrite **une fois**, testée, et importée des deux côtés.

## Règle de couches (backend)

```
routes  →  services  →  shared/domain
```

| Couche | A le droit de | N'a **pas** le droit de |
|---|---|---|
| `*.routes.js` | valider (Zod), appeler un service, choisir le code HTTP | toucher Mongoose, porter une règle métier |
| `*.service.js` | Mongoose, transactions, appeler le domaine | connaître `req` / `res` |
| `shared/domain` | calculer, décider, lever des erreurs | importer React, Express ou Mongoose |

Un service qui reçoit `req` en argument est un bug de conception : il redevient
intestable sans serveur HTTP.

## Conventions

- **JavaScript / JSX uniquement** — pas de TypeScript. Les garde-fous qui
  remplacent le typage sont décrits au §5bis du plan (Zod aux frontières,
  Mongoose `strict`, tests obligatoires sur `shared/domain`, ESLint strict).
- Composants shadcn/ui installés **par la CLI**, jamais écrits à la main.
  `components.json` porte `"tsx": false`.
- `frontend/src/features/<x>/` et `backend/src/modules/<x>/` portent le **même
  nom** : chercher une fonctionnalité, c'est ouvrir deux dossiers homonymes.
- Vocabulaire métier en français (formateur, groupe, séance, affectation,
  avancement, chronogramme) ; termes techniques en anglais.
- Toute logique portée depuis PHP est commentée avec son fichier d'origine.
- Aucun fichier au-delà de ~300 lignes.

## Démarrage

```bash
npm install
cp .env.example backend/.env   # puis renseigner les valeurs
npm run dev
```

- Front : http://localhost:5173
- API : http://localhost:4000 (`/api/v2/health` pour vérifier)

En développement, Vite proxifie `/api/v2` vers Express et `/api` vers
l'application PHP sur XAMPP — ce qui reproduit le routage Nginx de production
et permet aux modules migrés et non migrés de cohabiter.

MongoDB doit tourner en **replica set**, même mono-nœud : les transactions
multi-collections en dépendent.

## Bascule développement / production (frontend)

Vite choisit le fichier `.env.*` selon la commande, **pas de bascule manuelle
à faire** :

| Commande | Mode Vite | Fichier lu | `VITE_API_URL` | Comportement |
|---|---|---|---|---|
| `npm run dev --workspace=frontend` | development | `frontend/.env.development` | vide | proxy Vite → `http://localhost:4000` |
| `npm run build --workspace=frontend` | production | `frontend/.env.production` | `https://backend-production-ac98.up.railway.app` | appels directs à l'API Railway, bakés dans le bundle |

Pour tester le build de production en local avant de le déployer (Vercel/Netlify) :

```bash
npm run build --workspace=frontend
npm run preview --workspace=frontend   # sert dist/, toujours pointé vers Railway
```

Côté backend (Railway), il faut whitelister l'origine du frontend déployé —
sinon le navigateur bloque les requêtes en CORS. Variables à définir dans les
réglages du service Railway :

```
HTTP_ORIGINES=https://<votre-projet>.vercel.app
WS_ORIGINES=https://<votre-projet>.vercel.app
COOKIE_SAME_SITE=none
NODE_ENV=production
```

(`COOKIE_SAME_SITE=none` est nécessaire car frontend et API sont sur des
domaines différents ; `secure` sur le cookie est déjà forcé par
`NODE_ENV=production`, voir `backend/src/modules/auth/tokens.js`.) Ajouter
chaque nouveau domaine (custom domain, preview Vercel) à ces deux listes,
séparés par des virgules.

## Tests

```bash
npm test                        # tout
npm test --workspace=shared     # domaine métier (couverture > 90 % exigée)
npm test --workspace=backend    # routes (Supertest)
```
