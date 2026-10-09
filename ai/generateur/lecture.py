"""
Frontière JSON : lire un problème, écrire une solution.

C'est ici que le service refuse ce qu'il ne comprend pas. Le plan (§5bis-1)
impose Zod à toutes les frontières côté JS ; Python n'a pas Zod, et le cœur du
solveur ne dépend que de la bibliothèque standard — la validation est donc
écrite à la main, mais elle est aussi stricte.

⚠️ UNE CLÉ INCONNUE EST REFUSÉE, JAMAIS IGNORÉE. Ce projet a payé NEUF FOIS le
   même défaut : un champ que le serveur sélectionne mais que le présentateur
   ne rend pas (`espaces`, `modulesInactifs`, `affectations`, `type`,
   `groupesFq`, `identifiant`, `semaine`, `jour`, `salle`). Le symptôme est
   toujours le même — un écran vide, un calcul faux, et aucune erreur. Ici, une
   faute de frappe dans le JSON de Node s'arrête au premier appel avec le nom
   du champ fautif.

Le JSON parle camelCase (convention JS), les dataclasses parlent snake_case
(convention Python) : la traduction se fait ici, à un seul endroit.
"""

from __future__ import annotations

from typing import Any

from .contrat import (
    MOTEUR,
    MOTEUR_CPSAT,
    Creneau,
    NonPlacee,
    Occupation,
    Placement,
    Probleme,
    ProblemeInvalide,
    Salle,
    Solution,
    Tache,
)


def _exiger_objet(valeur: Any, chemin: str) -> dict:
    if not isinstance(valeur, dict):
        raise ProblemeInvalide(f"{chemin} : objet attendu, reçu {type(valeur).__name__}")
    return valeur


def _exiger_liste(valeur: Any, chemin: str) -> list:
    if not isinstance(valeur, list):
        raise ProblemeInvalide(f"{chemin} : liste attendue, reçu {type(valeur).__name__}")
    return valeur


def _cles(source: dict, chemin: str, connues: set[str], requises: set[str]) -> None:
    """
    Refuse les clés inconnues et signale les manquantes.

    Les deux contrôles sont ici parce qu'ils répondent à la même question : le
    JSON reçu est-il bien celui qu'on attend ? Une clé en trop est presque
    toujours une clé mal orthographiée — donc un champ MANQUANT qui se
    présenterait, sinon, comme une valeur par défaut parfaitement plausible.
    """
    recues = set(source)
    inconnues = recues - connues
    if inconnues:
        raise ProblemeInvalide(
            f"{chemin} : clé(s) inconnue(s) {sorted(inconnues)} — attendu {sorted(connues)}"
        )
    manquantes = requises - recues
    if manquantes:
        raise ProblemeInvalide(f"{chemin} : clé(s) manquante(s) {sorted(manquantes)}")


def _entier(source: dict, cle: str, chemin: str, *, minimum: int | None = None) -> int:
    valeur = source[cle]
    # ⚠️ `bool` est un `int` en Python : sans ce garde, `true` passerait pour 1.
    if isinstance(valeur, bool) or not isinstance(valeur, int):
        raise ProblemeInvalide(f"{chemin}.{cle} : entier attendu, reçu {valeur!r}")
    if minimum is not None and valeur < minimum:
        raise ProblemeInvalide(f"{chemin}.{cle} : doit valoir au moins {minimum}, reçu {valeur}")
    return valeur


def _reel(source: dict, cle: str, chemin: str, defaut: float, *, strictement_positif: bool = False) -> float:
    if cle not in source:
        return defaut
    valeur = source[cle]
    if isinstance(valeur, bool) or not isinstance(valeur, (int, float)):
        raise ProblemeInvalide(f"{chemin}.{cle} : nombre attendu, reçu {valeur!r}")
    if strictement_positif and valeur <= 0:
        raise ProblemeInvalide(f"{chemin}.{cle} : doit être strictement positif, reçu {valeur}")
    return float(valeur)


def _texte(source: dict, cle: str, chemin: str) -> str:
    valeur = source[cle]
    if not isinstance(valeur, str) or not valeur.strip():
        raise ProblemeInvalide(f"{chemin}.{cle} : texte non vide attendu, reçu {valeur!r}")
    return valeur


def _textes(valeur: Any, chemin: str) -> tuple[str, ...]:
    liste = _exiger_liste(valeur, chemin)
    for i, element in enumerate(liste):
        if not isinstance(element, str) or not element.strip():
            raise ProblemeInvalide(f"{chemin}[{i}] : texte non vide attendu, reçu {element!r}")
    return tuple(liste)


# --------------------------------------------------------------------------

def _moteur(racine: dict) -> str:
    """
    Quel moteur demander.

    ⚠️ ON REFUSE UN NOM INCONNU, ON NE RETOMBE PAS SUR LE GLOUTON. Un repli
       silencieux ferait passer une faute de frappe côté Node pour une
       génération normale — et le rapport annoncerait « glouton » alors que
       l'appelant croyait lancer une recherche complète.
    """
    valeur = racine.get("moteur", MOTEUR)
    if valeur not in (MOTEUR, MOTEUR_CPSAT):
        raise ProblemeInvalide(
            f"moteur : « {valeur} » inconnu — attendu « {MOTEUR} » ou « {MOTEUR_CPSAT} »"
        )
    return valeur


def lire_probleme(source: Any) -> Probleme:
    """
    Construit un `Probleme` depuis le JSON de Node, ou lève `ProblemeInvalide`.
    """
    racine = _exiger_objet(source, "problème")
    _cles(
        racine,
        "problème",
        connues={
            "graine", "creneaux", "salles", "taches",
            "blocs", "incompatibilites", "occupation", "budgetMs", "moteur",
        },
        requises={"graine", "creneaux", "salles", "taches"},
    )

    graine = _entier(racine, "graine", "problème")

    # --- Créneaux ---------------------------------------------------------
    creneaux: list[Creneau] = []
    vus: set[int] = set()
    for i, brut in enumerate(_exiger_liste(racine["creneaux"], "creneaux")):
        chemin = f"creneaux[{i}]"
        objet = _exiger_objet(brut, chemin)
        _cles(
            objet,
            chemin,
            connues={"id", "jour", "rang", "duree", "periode"},
            requises={"id", "jour", "rang"},
        )
        identifiant = _entier(objet, "id", chemin, minimum=0)
        if identifiant in vus:
            raise ProblemeInvalide(f"{chemin}.id : identifiant {identifiant} déjà utilisé")
        vus.add(identifiant)
        creneaux.append(
            Creneau(
                id=identifiant,
                jour=_texte(objet, "jour", chemin),
                rang=_entier(objet, "rang", chemin, minimum=0),
                duree=_reel(objet, "duree", chemin, 2.5, strictement_positif=True),
                periode=_texte(objet, "periode", chemin) if "periode" in objet else "jour",
            )
        )
    if not creneaux:
        # Une semaine entièrement fermée est un cas légitime côté métier, mais
        # c'est à Node de le constater : il sait dire « vacances » là où Python
        # ne verrait qu'une liste vide.
        raise ProblemeInvalide("creneaux : au moins un créneau est attendu")

    # --- Salles -----------------------------------------------------------
    salles: list[Salle] = []
    noms_salles: set[str] = set()
    for i, brut in enumerate(_exiger_liste(racine["salles"], "salles")):
        chemin = f"salles[{i}]"
        objet = _exiger_objet(brut, chemin)
        _cles(objet, chemin, connues={"nom", "reelle"}, requises={"nom"})
        nom = _texte(objet, "nom", chemin)
        if nom in noms_salles:
            raise ProblemeInvalide(f"{chemin}.nom : salle « {nom} » déclarée deux fois")
        noms_salles.add(nom)
        reelle = objet.get("reelle", True)
        if not isinstance(reelle, bool):
            raise ProblemeInvalide(f"{chemin}.reelle : booléen attendu, reçu {reelle!r}")
        salles.append(Salle(nom=nom, reelle=reelle))

    # --- Tâches -----------------------------------------------------------
    taches: list[Tache] = []
    ids_taches: set[str] = set()
    for i, brut in enumerate(_exiger_liste(racine["taches"], "taches")):
        chemin = f"taches[{i}]"
        objet = _exiger_objet(brut, chemin)
        _cles(
            objet,
            chemin,
            connues={
                "id", "formateur", "groupes", "seancesRequises",
                "priorite", "difficulte", "creneauxInterdits", "creneauxAEviter",
                "motifsInterdiction",
                "sallesPossibles", "sallesPreferees",
                "periode", "creneauxSecours",
            },
            requises={"id", "formateur", "groupes", "seancesRequises"},
        )
        identifiant = _texte(objet, "id", chemin)
        if identifiant in ids_taches:
            raise ProblemeInvalide(f"{chemin}.id : tâche « {identifiant} » déclarée deux fois")
        ids_taches.add(identifiant)

        groupes = _textes(objet["groupes"], f"{chemin}.groupes")
        if not groupes:
            raise ProblemeInvalide(f"{chemin}.groupes : au moins un groupe est attendu")

        interdits = set()
        for j, valeur in enumerate(_exiger_liste(objet.get("creneauxInterdits", []), f"{chemin}.creneauxInterdits")):
            if isinstance(valeur, bool) or not isinstance(valeur, int):
                raise ProblemeInvalide(f"{chemin}.creneauxInterdits[{j}] : entier attendu, reçu {valeur!r}")
            if valeur not in vus:
                # Un identifiant inconnu est le symptôme d'une désynchronisation
                # entre la liste des créneaux et celle des interdictions — donc
                # d'une interdiction qui ne s'appliquerait à rien.
                raise ProblemeInvalide(
                    f"{chemin}.creneauxInterdits[{j}] : créneau {valeur} inconnu"
                )
            interdits.add(valeur)

        a_eviter = set()
        for j, valeur in enumerate(
            _exiger_liste(objet.get("creneauxAEviter", []), f"{chemin}.creneauxAEviter")
        ):
            if isinstance(valeur, bool) or not isinstance(valeur, int):
                raise ProblemeInvalide(
                    f"{chemin}.creneauxAEviter[{j}] : entier attendu, reçu {valeur!r}"
                )
            if valeur not in vus:
                raise ProblemeInvalide(f"{chemin}.creneauxAEviter[{j}] : créneau {valeur} inconnu")
            # ⚠️ UN CRÉNEAU DÉJÀ INTERDIT N'EST PAS « À ÉVITER » : l'impossibilité
            #    prime, et le compter deux fois fausserait la pénalité du solveur.
            if valeur not in interdits:
                a_eviter.add(valeur)

        secours = set()
        for j, valeur in enumerate(
            _exiger_liste(objet.get("creneauxSecours", []), f"{chemin}.creneauxSecours")
        ):
            if isinstance(valeur, bool) or not isinstance(valeur, int):
                raise ProblemeInvalide(
                    f"{chemin}.creneauxSecours[{j}] : entier attendu, reçu {valeur!r}"
                )
            if valeur not in vus:
                raise ProblemeInvalide(f"{chemin}.creneauxSecours[{j}] : créneau {valeur} inconnu")
            # Comme pour `creneauxAEviter` : l'interdiction prime.
            if valeur not in interdits:
                secours.add(valeur)

        # ═══ Motifs d'interdiction — ÉTIQUETTES OPAQUES, jamais interprétées ══
        #
        # ⚠️ ON VALIDE LA COHÉRENCE, PAS LE VOCABULAIRE. Refuser un motif
        #    inconnu obligerait ce module à tenir la liste des notions métier de
        #    Node — la frontière que tout ce fichier existe pour garder. En
        #    revanche, un motif qui désigne un créneau NON interdit est une
        #    désynchronisation entre les deux listes : le diagnostic
        #    rapporterait alors une cause pour un créneau parfaitement libre.
        motifs: list[tuple[str, frozenset[int]]] = []
        bruts_motifs = _exiger_objet(
            objet.get("motifsInterdiction", {}), f"{chemin}.motifsInterdiction"
        )
        for motif, liste in bruts_motifs.items():
            if not isinstance(motif, str) or not motif:
                raise ProblemeInvalide(
                    f"{chemin}.motifsInterdiction : nom de motif vide ou non textuel"
                )
            ids = set()
            for j, valeur in enumerate(
                _exiger_liste(liste, f"{chemin}.motifsInterdiction.{motif}")
            ):
                if isinstance(valeur, bool) or not isinstance(valeur, int):
                    raise ProblemeInvalide(
                        f"{chemin}.motifsInterdiction.{motif}[{j}] :"
                        f" entier attendu, reçu {valeur!r}"
                    )
                if valeur not in interdits:
                    raise ProblemeInvalide(
                        f"{chemin}.motifsInterdiction.{motif}[{j}] : le créneau"
                        f" {valeur} n'est pas dans creneauxInterdits"
                    )
                ids.add(valeur)
            if ids:
                motifs.append((motif, frozenset(ids)))

        possibles = _textes(objet.get("sallesPossibles", []), f"{chemin}.sallesPossibles")
        for nom in possibles:
            if nom not in noms_salles:
                raise ProblemeInvalide(f"{chemin}.sallesPossibles : salle « {nom} » inconnue")

        # ═══ Salles préférées — un SOUS-ENSEMBLE des possibles ══════════════
        #
        # ⚠️ ON REFUSE UNE PRÉFÉRENCE HORS DES POSSIBLES. Le solveur ne
        #    choisirait jamais cette salle : la préférence serait donc
        #    silencieusement sans effet, et le directeur croirait sa consigne
        #    appliquée. C'est la même cohérence que celle exigée juste au-dessus
        #    des motifs d'interdiction — une liste qui ne désigne rien.
        preferees = _textes(objet.get("sallesPreferees", []), f"{chemin}.sallesPreferees")
        for nom in preferees:
            if nom not in possibles:
                raise ProblemeInvalide(
                    f"{chemin}.sallesPreferees : « {nom} » ne figure pas dans sallesPossibles"
                )

        taches.append(
            Tache(
                id=identifiant,
                formateur=_texte(objet, "formateur", chemin),
                groupes=groupes,
                seances_requises=_entier(objet, "seancesRequises", chemin, minimum=0),
                priorite=_entier(objet, "priorite", chemin) if "priorite" in objet else 7,
                difficulte=_reel(objet, "difficulte", chemin, 0.0),
                creneaux_interdits=frozenset(interdits),
                creneaux_a_eviter=frozenset(a_eviter),
                motifs_interdiction=tuple(motifs),
                salles_possibles=possibles,
                salles_preferees=frozenset(preferees),
                periode=_texte(objet, "periode", chemin) if "periode" in objet else "jour",
                creneaux_secours=frozenset(secours),
            )
        )

    # --- Blocs ------------------------------------------------------------
    blocs: list[tuple[int, int]] = []
    for i, brut in enumerate(_exiger_liste(racine.get("blocs", []), "blocs")):
        chemin = f"blocs[{i}]"
        paire = _exiger_liste(brut, chemin)
        if len(paire) != 2:
            raise ProblemeInvalide(f"{chemin} : paire de deux créneaux attendue, reçu {len(paire)}")
        for valeur in paire:
            if isinstance(valeur, bool) or not isinstance(valeur, int) or valeur not in vus:
                raise ProblemeInvalide(f"{chemin} : créneau {valeur!r} inconnu")
        if paire[0] == paire[1]:
            raise ProblemeInvalide(f"{chemin} : un bloc ne peut pas répéter le même créneau")
        blocs.append((paire[0], paire[1]))

    # --- Incompatibilités -------------------------------------------------
    #
    # ⚠️ SYMÉTRISÉES ICI, PAR PRÉCAUTION. `groupesSeCroisent` est symétrique
    #    côté JS, et Node devrait donc rendre une carte symétrique. Mais un
    #    oubli ne se verrait PAS : la génération poserait simplement deux cours
    #    au même moment pour la même classe, dans un seul sens de lecture.
    #    Trois lignes suppriment l'hypothèse — elles ne remplacent aucune règle
    #    métier, elles ferment un trou de transport.
    incompatibilites: dict[str, set[str]] = {}
    brut_incompat = _exiger_objet(racine.get("incompatibilites", {}), "incompatibilites")
    for groupe, valeur in brut_incompat.items():
        if not isinstance(groupe, str) or not groupe.strip():
            raise ProblemeInvalide(f"incompatibilites : clé de groupe invalide {groupe!r}")
        autres = _textes(valeur, f"incompatibilites[{groupe}]")
        for autre in autres:
            if autre == groupe:
                continue
            incompatibilites.setdefault(groupe, set()).add(autre)
            incompatibilites.setdefault(autre, set()).add(groupe)

    # --- Occupation existante ---------------------------------------------
    occupation: list[Occupation] = []
    for i, brut in enumerate(_exiger_liste(racine.get("occupation", []), "occupation")):
        chemin = f"occupation[{i}]"
        objet = _exiger_objet(brut, chemin)
        _cles(objet, chemin, connues={"creneauId", "formateur", "groupes", "salle"}, requises={"creneauId", "formateur"})
        creneau_id = _entier(objet, "creneauId", chemin, minimum=0)
        if creneau_id not in vus:
            raise ProblemeInvalide(f"{chemin}.creneauId : créneau {creneau_id} inconnu")
        salle = objet.get("salle")
        if salle is not None:
            if not isinstance(salle, str) or not salle.strip():
                raise ProblemeInvalide(f"{chemin}.salle : texte non vide ou null attendu, reçu {salle!r}")
            if salle not in noms_salles:
                raise ProblemeInvalide(f"{chemin}.salle : salle « {salle} » inconnue")
        occupation.append(
            Occupation(
                creneau_id=creneau_id,
                formateur=_texte(objet, "formateur", chemin),
                groupes=_textes(objet.get("groupes", []), f"{chemin}.groupes"),
                salle=salle,
            )
        )

    return Probleme(
        graine=graine,
        creneaux=tuple(creneaux),
        salles=tuple(salles),
        taches=tuple(taches),
        blocs=tuple(blocs),
        incompatibilites={g: frozenset(a) for g, a in incompatibilites.items()},
        occupation=tuple(occupation),
        budget_ms=_entier(racine, "budgetMs", "budgetMs", minimum=1)
        if "budgetMs" in racine
        else 20000,
        moteur=_moteur(racine),
    )


def ecrire_solution(solution: Solution) -> dict:
    """Rend la solution dans le camelCase attendu par Node."""
    return {
        "placements": [
            {
                "tacheId": p.tache_id,
                "creneauId": p.creneau_id,
                "salle": p.salle,
                "deconseille": p.deconseille,
            }
            for p in solution.placements
        ],
        "nonPlacees": [
            {
                "tacheId": n.tache_id,
                "manquantes": n.manquantes,
                "cause": n.cause,
                "creneauxBloques": n.creneaux_bloques,
                "creneauxExamines": n.creneaux_examines,
            }
            for n in solution.non_placees
        ],
        "rapport": solution.rapport,
    }
