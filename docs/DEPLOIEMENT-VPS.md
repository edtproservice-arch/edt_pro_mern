# Déploiement EDT Pro sur un VPS Ubuntu 24.04 (Hostinger)

Ce guide couvre ce que l'application exige **en plus** de Node/MongoDB :

| Besoin | Pourquoi | Où dans le code |
|---|---|---|
| **LibreOffice** (`soffice`) | Conversion Word → PDF de tous les exports PDF | `backend/src/modules/seances/libreOffice.js` |
| **Polices Calibri/Arial/Times** (ou équivalents) | Les canevas `.docx` utilisent Calibri, Calibri Light, Arial, Times New Roman | `*/canevas/*.docx` |
| **Python ≥ 3.10** | Solveur de génération (`python -m generateur`) | `backend/src/modules/generation/solveur.client.js` |
| **OR-Tools** (optionnel mais recommandé) | Moteur CP-SAT (« recherche approfondie ») — sans lui, le solveur retombe sur le moteur de base | `ai/generateur/cpsat.py` |
| **MongoDB en replica set** | Transactions (`?replicaSet=rs0`) | `.env.example` |
| **WebSocket** | Collaboration temps réel sur `/api/v2/temps-reel` | `backend/src/modules/tempsReel/serveur.js` |

> **Taille du VPS** : Mongo + LibreOffice + CP-SAT consomment de la RAM. Prendre **au moins 4 Go**, idéalement **8 Go (KVM 2)**.

Toutes les commandes ci-dessous se lancent en SSH sur le VPS.

---

## 1. Système de base

```bash
apt update && apt upgrade -y
apt install -y curl git build-essential ufw nginx unzip
timedatectl set-timezone Africa/Casablanca

# Utilisateur applicatif (ne pas faire tourner l'app en root)
adduser --disabled-password --gecos "" edtpro
mkdir -p /opt/edtpro && chown edtpro:edtpro /opt/edtpro

# Pare-feu : SSH + web uniquement (Mongo reste invisible de l'extérieur)
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

---

## 2. Node.js 22 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2
node -v   # ≥ 20 exigé par package.json
```

---

## 3. MongoDB 8.0 en replica set mono-nœud

```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" \
  > /etc/apt/sources.list.d/mongodb-org-8.0.list
apt update && apt install -y mongodb-org
```

Éditer `/etc/mongod.conf` :

```yaml
net:
  port: 27017
  bindIp: 127.0.0.1        # JAMAIS 0.0.0.0
replication:
  replSetName: rs0
```

```bash
systemctl enable --now mongod
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
mongosh --eval 'rs.status().ok'   # → 1
```

---

## 4. LibreOffice (sans interface graphique) + polices

```bash
# Writer seul, version « nogui » : pas de serveur X, beaucoup plus léger que « libreoffice »
apt install -y --no-install-recommends libreoffice-writer-nogui default-jre-headless

# Polices
#  - Carlito   = équivalent MÉTRIQUE de Calibri (même largeur de caractères → mise en page identique)
#  - Caladea   = équivalent de Cambria
#  - Liberation = équivalents métriques d'Arial / Times New Roman
apt install -y fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation2 fontconfig

# (Optionnel) vraies polices Microsoft Arial/Times — accepter la licence EULA à l'écran
# apt install -y ttf-mscorefonts-installer

fc-cache -f
```

> ⚠️ **Calibri n'existe pas sous Linux.** Sans `fonts-crosextra-carlito`, LibreOffice
> substitue une police de largeur différente : les tableaux débordent et le texte
> semble « gras » (le problème déjà rencontré avec Aptos, cf. commentaires de
> `exportGlobalDocx.js`). LibreOffice remplace automatiquement Calibri par Carlito.
>
> Pour un rendu **strictement identique** à Word : copier les vraies polices
> (`calibri*.ttf`, `calibril*.ttf` depuis `C:\Windows\Fonts` d'un poste Windows
> sous licence) dans `/usr/local/share/fonts/`, puis `fc-cache -f`.

Vérification :

```bash
soffice --version
fc-match Calibri          # → Carlito (ou Calibri si copiée)
fc-match Arial            # → Liberation Sans (ou Arial)
```

Test de conversion réel, sous l'utilisateur applicatif :

```bash
sudo -u edtpro bash -c 'cd /tmp && cp /opt/edtpro/app/backend/src/modules/seances/canevas/emploiGlobalFormateur.docx t.docx \
  && soffice --headless --convert-to pdf t.docx && ls -l t.pdf && rm t.*'
```

(à lancer après l'étape 6, une fois le code cloné)

---

## 5. Python 3 + OR-Tools (environnement virtuel)

Ubuntu 24.04 fournit Python 3.12 et **interdit `pip install` global** (PEP 668) :
on utilise un venv dans `ai/`.

```bash
apt install -y python3 python3-venv python3-pip
```

(Les commandes suivantes se font après le clonage, étape 6.)

```bash
sudo -u edtpro bash <<'EOF'
cd /opt/edtpro/app/ai
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install ortools          # moteur CP-SAT
# .venv/bin/pip install -e ".[api]"    # seulement si un jour on lance la façade FastAPI
EOF
```

Vérification :

```bash
cd /opt/edtpro/app/ai
.venv/bin/python -c "from ortools.sat.python import cp_model; print('OR-Tools OK')"
.venv/bin/python -m unittest discover -s tests -t .
```

Dans `backend/.env` on pointera **le Python du venv** (chemin absolu) :
`PYTHON_BIN=/opt/edtpro/app/ai/.venv/bin/python`

---

## 6. Code de l'application

```bash
sudo -u edtpro bash <<'EOF'
cd /opt/edtpro
git clone <URL_DU_DEPOT_GIT> app
cd app
npm ci                      # installe les 3 workspaces (shared, backend, frontend)
EOF
```

Puis revenir faire les étapes 4 (test) et 5 (venv) si ce n'est pas fait.

### 6.1 `backend/.env`

```bash
sudo -u edtpro cp /opt/edtpro/app/.env.example /opt/edtpro/app/backend/.env
sudo -u edtpro nano /opt/edtpro/app/backend/.env
chmod 600 /opt/edtpro/app/backend/.env
```

Valeurs de production (frontend et API sur **le même domaine**) :

```ini
NODE_ENV=production
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/gestion_edt?replicaSet=rs0

# node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   (deux fois)
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...

COOKIE_DOMAIN=              # vide = domaine courant (ou .edtpro.ma pour partager avec les sous-domaines)
COOKIE_SAME_SITE=lax        # "none" seulement si l'appli bureau Tauri doit se connecter
HTTP_ORIGINES=https://edtpro.ma
WS_ORIGINES=https://edtpro.ma
# Avec l'appli Tauri Windows : ajouter ,https://tauri.localhost aux deux lignes + COOKIE_SAME_SITE=none

SMTP_HOST=smtp.stackmail.com
SMTP_PORT=465
SMTP_USER=...
SMTP_PASS=...

GEMINI_API_KEY=

PYTHON_BIN=/opt/edtpro/app/ai/.venv/bin/python
GENERATEUR_TIMEOUT_MS=30000
GENERATEUR_BUDGET_CPSAT_MS=20000
```

Initialisation de la base :

```bash
cd /opt/edtpro/app/backend
sudo -u edtpro npm run verifier:db
sudo -u edtpro npm run init:db
sudo -u edtpro npm run creer:admin
```

### 6.2 Build du frontend

⚠️ `frontend/.env.production` pointe aujourd'hui vers **Railway**. Sur le VPS,
l'API est servie par Nginx sur le même domaine → `VITE_API_URL` doit être **vide**.
Un fichier `.env.production.local` (ignoré par git) l'emporte sur `.env.production` :

```bash
cd /opt/edtpro/app
sudo -u edtpro bash -c 'echo "VITE_API_URL=" > frontend/.env.production.local && npm run build'
# → frontend/dist/
```

---

## 7. PM2 (backend)

⚠️ `npm start` lance `node src/server.js` **sans** `--env-file` : il faut le passer à PM2.

⚠️ **Une seule instance (mode fork, pas cluster)** : la file d'attente LibreOffice
et les salons WebSocket vivent dans la mémoire du processus.

`/opt/edtpro/app/ecosystem.config.cjs` :

```js
module.exports = {
  apps: [
    {
      name: 'edtpro-api',
      cwd: '/opt/edtpro/app/backend',
      script: 'src/server.js',
      node_args: '--env-file=.env',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production' },
    },
  ],
};
```

```bash
sudo -u edtpro pm2 start /opt/edtpro/app/ecosystem.config.cjs
sudo -u edtpro pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u edtpro --hp /home/edtpro   # redémarrage auto au boot
curl http://127.0.0.1:4000/api/v2/health
```

---

## 8. Nginx + HTTPS

`/etc/nginx/sites-available/edtpro` :

```nginx
server {
    listen 80;
    server_name edtpro.ma www.edtpro.ma;

    root /opt/edtpro/app/frontend/dist;
    index index.html;

    client_max_body_size 25M;          # imports Excel / e-note

    # WebSocket de collaboration
    location /api/v2/temps-reel {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;       # génération CP-SAT + conversions PDF
    }

    # SPA React
    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
ln -s /etc/nginx/sites-available/edtpro /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Le DNS (enregistrement A → IP du VPS) doit être en place avant :
apt install -y certbot python3-certbot-nginx
certbot --nginx -d edtpro.ma -d www.edtpro.ma
```

> `app.set('trust proxy', 1)` est déjà actif dans `backend/src/app.js` : derrière
> ce Nginx (un seul proxy), le rate-limit voit bien l'IP réelle des utilisateurs.

---

## 9. Vérifications finales

- [ ] `https://edtpro.ma` affiche l'application, connexion OK
- [ ] Un export **PDF** (emploi global, émargement, billet d'absence) se télécharge et le texte n'est pas « gras »
- [ ] Une **génération automatique** avec recherche approfondie rend des séances (sinon : `pm2 logs edtpro-api`, chercher « Python introuvable » / `ortools_absent`)
- [ ] Deux navigateurs ouverts sur le même emploi du temps → les modifications apparaissent en direct (WebSocket)
- [ ] `npm run tester:email` dans `backend/` envoie un mail

---

## 10. Mises à jour

`/opt/edtpro/deployer.sh` :

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/edtpro/app
git pull
npm ci
npm run build
ai/.venv/bin/pip install --quiet --upgrade ortools
pm2 reload edtpro-api
```

```bash
chmod +x /opt/edtpro/deployer.sh
sudo -u edtpro /opt/edtpro/deployer.sh
```

## 11. Sauvegardes MongoDB

```bash
mkdir -p /var/backups/mongo
crontab -e
# Tous les jours à 2 h, conservation 14 jours :
0 2 * * * mongodump --uri="mongodb://127.0.0.1:27017/gestion_edt?replicaSet=rs0" --gzip --archive=/var/backups/mongo/edt-$(date +\%F).gz && find /var/backups/mongo -mtime +14 -delete
```

Activer aussi les **snapshots/sauvegardes hebdomadaires** du VPS dans le panneau Hostinger.

---

## Dépannage rapide

| Symptôme | Cause probable | Correctif |
|---|---|---|
| « LibreOffice (soffice) n'a pas pu convertir » | `soffice` absent ou pas dans le PATH de PM2 | `which soffice` ; réinstaller `libreoffice-writer-nogui` |
| PDF avec texte gras / tableaux décalés | Calibri absente | `fonts-crosextra-carlito` + `fc-cache -f`, ou copier les vraies polices |
| « Python introuvable (« python ») » | `PYTHON_BIN` non renseigné | `PYTHON_BIN=/opt/edtpro/app/ai/.venv/bin/python` puis `pm2 reload` |
| Génération sans CP-SAT (`ortools_absent`) | OR-Tools pas dans le venv | `ai/.venv/bin/pip install ortools` |
| Erreur « Transaction numbers are only allowed on a replica set » | replica set non initialisé | étape 3, `rs.initiate(...)` |
| Déconnecté en boucle | `HTTP_ORIGINES` / `COOKIE_*` incorrects, ou HTTP au lieu de HTTPS | vérifier `.env`, forcer HTTPS |
| Temps réel ne marche pas | Bloc `location /api/v2/temps-reel` manquant, ou `WS_ORIGINES` | étape 8 |
