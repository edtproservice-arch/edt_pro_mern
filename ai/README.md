# `ai/` — génération automatique des emplois du temps

Service de **résolution**. Il reçoit un problème de placement, il rend des
placements. C'est tout ce qu'il fait, et c'est tout ce qu'il doit faire.

← portage de `runAutoGeneration` / `processSingleWeekGeneration` de
`public/emploi.html` (PHP legacy, ~1 560 lignes dans le DOM).

---

## Ce que ce service ne sait pas, et ne saura jamais

Il ne connaît **ni l'OFPPT, ni les jours fériés marocains, ni les groupes FQ,
ni la différence entre une séance présentielle et une séance à distance**.

Toutes les règles métier vivent dans `shared/src/domain`, côté JS, où elles
sont testées et partagées front/back :

| Question | Qui répond |
|---|---|
| Ce créneau est-il ouvert ? | `planning/calendrier.js` → `disponibilite` |
| Ces groupes se croisent-ils ? | `emploi/conflits.js` → `groupesSeCroisent` |
| Quelles salles pour ce formateur ? | `emploi/contraintesFormateurs.js` |
| Ce placement est-il légal ? | `modules/seances` → `poser()` |

Les réécrire ici en ferait un **cinquième exemplaire** — la cause n°1
d'instabilité du projet (§4.2 du plan de migration), celle qui a coûté toute la
Phase 2 à corriger. Node construit le problème, Python le résout, Node
revalide avant d'écrire.

**Si vous vous apprêtez à ajouter ici la notion de férié, de filière ou de
semestre : c'est le signe que le calcul doit se faire côté Node**, et arriver
ici sous forme d'interdiction de créneau ou d'incompatibilité.

---

## Lancer

```bash
# CLI — un problème sur stdin, une solution sur stdout
echo '{"graine":1,"creneaux":[...],"salles":[...],"taches":[...]}' | python -m generateur
```

```bash
# Service HTTP (optionnel) — nécessaire seulement quand un modèle entraîné
# devra rester chargé en mémoire entre deux appels
pip install fastapi uvicorn
uvicorn generateur.api:app --port 8100
```

Le cœur ne dépend que de la bibliothèque standard : il s'exécute et se teste
sans rien installer.

```bash
python -m unittest discover -s tests -t .
```

---

## Le contrat

```jsonc
{
  "graine": 4815,                                  // rend la génération rejouable
  "creneaux": [ { "id": 0, "jour": "Lundi", "rang": 0, "duree": 2.5 } ],
  "blocs":    [ [0, 1] ],                          // paires pouvant porter 5 h
  "salles":   [ { "nom": "Salle 1", "reelle": true },
                { "nom": "TEAMS",   "reelle": false } ],
  "taches": [{
    "id": "GM101|M101",
    "formateur": "15688",                          // identifiant opaque
    "groupes": ["GM101"],                          // membres déjà développés
    "seancesRequises": 4,
    "priorite": 1,                                 // plus petit = traité d'abord
    "difficulte": 1.04,                            // départage à priorité égale
    "creneauxInterdits": [3, 7],
    "sallesPossibles": ["Salle 1"]
  }],
  "incompatibilites": { "GM101": ["ACADA101 (FQ)"] },
  "occupation": [ { "creneauId": 2, "formateur": "18494",
                    "groupes": ["GM102"], "salle": "Salle 3" } ]
}
```

```jsonc
{
  "placements": [ { "tacheId": "GM101|M101", "creneauId": 0, "salle": "Salle 1" } ],
  "nonPlacees": [ { "tacheId": "…", "manquantes": 2, "cause": "formateur_occupe",
                    "creneauxBloques": 18, "creneauxExamines": 24 } ],
  "rapport":    { "graine": 4815, "dureeMs": 28.5, "seancesPlacees": 157 }
}
```

Points à ne pas perdre de vue :

- **`reelle: false` remplace la notion de « synchrone ».** Une salle non réelle
  n'est jamais occupée : dix séances peuvent s'y tenir au même moment.
- **`occupation` n'existe pas dans l'ancien**, et c'est une correction : le
  générateur d'origine repartait d'une grille vide et écrasait la semaine. Les
  surveillances d'EFM et les rattrapages, que `poser()` verrouille, arrivent ici
  pour être respectés.
- **`cause` est un code, pas une phrase.** Node la traduit : lui seul sait qu'un
  créneau interdit vient d'un stage, d'une formation ou d'une case cochée.
- **Une clé inconnue est refusée**, jamais ignorée — ce projet a payé neuf fois
  le défaut du champ oublié entre le serveur et son présentateur.

---

## L'algorithme

Glouton, porté à l'identique : tâches par priorité, blocs de 5 h d'abord, puis
séances isolées, abandon dès qu'aucun créneau ne convient. Scores repris tels
quels (`+50` par voisin, `+10` jour entamé, équilibrage par groupe sur 40 h).

Le portage est **littéral par choix** : il sert de garde-fou de fidélité. Une
différence de grille avec l'ancien doit pouvoir s'expliquer, pas se découvrir.

**Ce que le glouton coûte** : il ne revient jamais sur un placement. Une tâche
traitée tôt peut occuper le seul créneau dont une tâche ultérieure avait besoin
— d'où les séances non placées du rapport, et la fenêtre de résolution avec ses
assouplissements côté écran.

Mesuré au volume réel (17 formateurs, 21 groupes, 10 salles, 80 tâches) :
**27 ms par semaine**, 1,2 s pour les 45 semaines de l'année.

---

## La suite

| Étape | Ce qui change |
|---|---|
| **CP-SAT** (OR-Tools) | remplace `solveur.py`, et lui seul. Le contrat ne bouge pas. Gain attendu : moins de séances non placées — pas de la vitesse |
| **Poids appris** | la fonction de score est apprise sur les corrections du directeur, au lieu d'être écrite à la main |

Pour que la seconde étape soit possible, il faut **enregistrer dès maintenant**
le problème soumis, la solution rendue et la grille finalement validée. Sans ce
jeu de données, il n'y aura rien à entraîner. C'est la livraison (d) du plan.

⚠️ Avec ~450 grilles par an (45 semaines × 10 établissements), un modèle de
**préférence** sur des caractéristiques de créneau est réaliste ; du deep
learning ne l'est pas, et un solveur bien pondéré fera mieux.

---

## Fichiers

| | |
|---|---|
| `contrat.py` | les types échangés — **le fichier à lire en premier** |
| `lecture.py` | frontière JSON : valide et refuse |
| `contexte.py` | ce qui se déduit une fois du problème (jours, voisinage, blocs) |
| `etat.py` | ce qui est déjà pris ← les `trackers` de l'ancien |
| `placement.py` | recherche des créneaux et scores ← `findBestSlots*` |
| `diagnostic.py` | pourquoi une séance n'a pas trouvé de place |
| `solveur.py` | la boucle maître — **le seul que CP-SAT remplacera** |
| `__main__.py` · `api.py` | CLI et service HTTP |

Les tests d'invariants (`tests/test_solveur.py`) rejouent **200 problèmes tirés
au hasard** et vérifient qu'aucune contrainte n'est jamais violée. Leur pouvoir
de détection a été vérifié par mutation : casser le contrôle de groupe fait
tomber 150 sous-tests, poser un bloc à moitié en fait tomber 196.
