"""
Frontière JSON de la génération du chronogramme.

⚠️ LES MÊMES EXIGENCES QUE `generateur.lecture` — et les mêmes outils, importés
   plutôt que réécrits : une clé inconnue est refusée, un nombre négatif aussi,
   et le message nomme le champ fautif.

Forme reçue (camelCase, comme tout ce qui vient de Node) :

    {
      "pas": 2.5,
      "semaines": [1, 2, …, 45],
      "formateurs": [{ "id": "15688", "cibles": {"1": 25}, "charges": {} }],
      "groupes":    [{ "id": "GM101", "plafondsSouples": {"1": 30},
                       "plafondsDurs": {"1": 60}, "charges": {} }],
      "cellules":   [{ "id": "GM101||M101", "plafonds": {"1": 20}, "charges": {} }],
      "taches": [{ "id": "…", "formateur": "15688", "groupes": ["GM101"],
                   "cellules": ["GM101||M101"], "priorite": 1,
                   "lots": [{ "heures": 60, "plafonds": {"1": 20, "2": 20},
                              "echeance": 17 }] }]
    }

⚠️ LES CLÉS DE SEMAINE SONT DES CHAÎNES — JSON n'en connaît pas d'autres. Elles
   sont converties en entiers ici, et doivent appartenir à `semaines` : une
   semaine inconnue serait silencieusement jamais visitée, et ses heures
   jamais posées.
"""

from __future__ import annotations

from typing import Any

from ..contrat import ProblemeInvalide
from ..lecture import _cles, _exiger_liste, _exiger_objet, _texte, _textes
from .contrat import (
    Cellule,
    Formateur,
    Groupe,
    Lot,
    ProblemeChronogramme,
    SolutionChronogramme,
    Tache,
)


def _nombre(valeur: Any, chemin: str) -> float:
    if isinstance(valeur, bool) or not isinstance(valeur, (int, float)):
        raise ProblemeInvalide(f"{chemin} : nombre attendu, reçu {valeur!r}")
    if valeur < 0:
        raise ProblemeInvalide(f"{chemin} : doit être positif ou nul, reçu {valeur}")
    return float(valeur)


def _par_semaine(source: dict, cle: str, chemin: str, semaines: frozenset[int]) -> dict[int, float]:
    """`{"3": 20}` → `{3: 20.0}`, en refusant une semaine inconnue."""
    if cle not in source:
        return {}
    brut = _exiger_objet(source[cle], f"{chemin}.{cle}")
    sortie: dict[int, float] = {}
    for texte, valeur in brut.items():
        try:
            semaine = int(texte)
        except (TypeError, ValueError):
            raise ProblemeInvalide(f"{chemin}.{cle} : semaine illisible {texte!r}") from None
        if semaine not in semaines:
            raise ProblemeInvalide(f"{chemin}.{cle} : semaine {semaine} absente de `semaines`")
        heures = _nombre(valeur, f"{chemin}.{cle}[{texte}]")
        if heures > 0:
            sortie[semaine] = heures
    return sortie


def _pas_tache(objet: dict, chemin: str, pas: float, cle: str = "pasTache") -> float | None:
    """Une durée de tâche (granularité, pose minimale) : un multiple > 0 du pas."""
    if cle not in objet:
        return None
    valeur = _nombre(objet[cle], f"{chemin}.{cle}")
    multiple = valeur / pas
    if valeur <= 0 or abs(multiple - round(multiple)) > 1e-6:
        raise ProblemeInvalide(f"{chemin}.{cle} : multiple de {pas} h attendu, reçu {valeur}")
    return valeur


def _uniques(identifiants: list[str], chemin: str) -> None:
    vus: set[str] = set()
    for identifiant in identifiants:
        if identifiant in vus:
            raise ProblemeInvalide(f"{chemin} : identifiant en double {identifiant!r}")
        vus.add(identifiant)


def lire_probleme_chronogramme(charge: Any) -> ProblemeChronogramme:
    racine = _exiger_objet(charge, "probleme")
    _cles(
        racine,
        "probleme",
        {"pas", "semaines", "formateurs", "groupes", "cellules", "taches"},
        {"pas", "semaines", "formateurs", "groupes", "cellules", "taches"},
    )

    pas = _nombre(racine["pas"], "probleme.pas")
    if pas <= 0:
        raise ProblemeInvalide("probleme.pas : doit être strictement positif")

    liste_semaines = _exiger_liste(racine["semaines"], "probleme.semaines")
    for i, semaine in enumerate(liste_semaines):
        if isinstance(semaine, bool) or not isinstance(semaine, int):
            raise ProblemeInvalide(f"probleme.semaines[{i}] : entier attendu, reçu {semaine!r}")
    if len(set(liste_semaines)) != len(liste_semaines):
        raise ProblemeInvalide("probleme.semaines : semaine en double")
    semaines = frozenset(liste_semaines)

    formateurs = []
    for i, brut in enumerate(_exiger_liste(racine["formateurs"], "probleme.formateurs")):
        chemin = f"probleme.formateurs[{i}]"
        objet = _exiger_objet(brut, chemin)
        _cles(objet, chemin, {"id", "cibles", "minimums", "charges"}, {"id"})
        formateurs.append(
            Formateur(
                id=_texte(objet, "id", chemin),
                cibles=_par_semaine(objet, "cibles", chemin, semaines),
                minimums=_par_semaine(objet, "minimums", chemin, semaines),
                charges=_par_semaine(objet, "charges", chemin, semaines),
            )
        )
    _uniques([f.id for f in formateurs], "probleme.formateurs")

    groupes = []
    for i, brut in enumerate(_exiger_liste(racine["groupes"], "probleme.groupes")):
        chemin = f"probleme.groupes[{i}]"
        objet = _exiger_objet(brut, chemin)
        _cles(objet, chemin, {"id", "plafondsSouples", "plafondsToleres", "plafondsDurs", "charges"}, {"id"})
        souples = _par_semaine(objet, "plafondsSouples", chemin, semaines)
        groupe = Groupe(
            id=_texte(objet, "id", chemin),
            plafonds_souples=souples,
            plafonds_toleres=(
                _par_semaine(objet, "plafondsToleres", chemin, semaines)
                if "plafondsToleres" in objet
                else dict(souples)
            ),
            plafonds_durs=_par_semaine(objet, "plafondsDurs", chemin, semaines),
            charges=_par_semaine(objet, "charges", chemin, semaines),
        )
        # ⚠️ Un plafond souple au-dessus du dur n'a pas de sens : le remplissage
        #    croirait disposer d'une place que la semaine ne contient pas.
        for semaine, souple in groupe.plafonds_souples.items():
            if souple > groupe.plafonds_durs.get(semaine, 0):
                raise ProblemeInvalide(
                    f"{chemin} : plafond souple {souple} > plafond dur en semaine {semaine}"
                )
        # ⚠️ souple ≤ toléré ≤ dur : sinon la tolérance retirerait de la place,
        #    ou en promettrait que la semaine n'a pas.
        for semaine, tolere in groupe.plafonds_toleres.items():
            if tolere < groupe.plafonds_souples.get(semaine, 0) or tolere > groupe.plafonds_durs.get(semaine, 0):
                raise ProblemeInvalide(
                    f"{chemin} : plafond toléré {tolere} hors de [souple, dur] en semaine {semaine}"
                )
        groupes.append(groupe)
    _uniques([g.id for g in groupes], "probleme.groupes")

    cellules = []
    for i, brut in enumerate(_exiger_liste(racine["cellules"], "probleme.cellules")):
        chemin = f"probleme.cellules[{i}]"
        objet = _exiger_objet(brut, chemin)
        _cles(objet, chemin, {"id", "plafonds", "charges"}, {"id"})
        cellules.append(
            Cellule(
                id=_texte(objet, "id", chemin),
                plafonds=_par_semaine(objet, "plafonds", chemin, semaines),
                charges=_par_semaine(objet, "charges", chemin, semaines),
            )
        )
    _uniques([c.id for c in cellules], "probleme.cellules")

    ids_formateurs = {f.id for f in formateurs}
    ids_groupes = {g.id for g in groupes}
    ids_cellules = {c.id for c in cellules}

    taches = []
    for i, brut in enumerate(_exiger_liste(racine["taches"], "probleme.taches")):
        chemin = f"probleme.taches[{i}]"
        objet = _exiger_objet(brut, chemin)
        _cles(
            objet,
            chemin,
            {"id", "formateur", "groupes", "cellules", "priorite", "lots", "encadreePar", "pasTache", "poseMin"},
            {"id", "formateur", "groupes", "cellules", "priorite", "lots"},
        )

        formateur = _texte(objet, "formateur", chemin)
        if formateur not in ids_formateurs:
            raise ProblemeInvalide(f"{chemin}.formateur : {formateur!r} absent de `formateurs`")

        groupes_tache = _textes(objet["groupes"], f"{chemin}.groupes")
        if not groupes_tache:
            raise ProblemeInvalide(f"{chemin}.groupes : au moins un groupe")
        for nom in groupes_tache:
            if nom not in ids_groupes:
                raise ProblemeInvalide(f"{chemin}.groupes : {nom!r} absent de `groupes`")

        cellules_tache = _textes(objet["cellules"], f"{chemin}.cellules")
        for nom in cellules_tache:
            if nom not in ids_cellules:
                raise ProblemeInvalide(f"{chemin}.cellules : {nom!r} absente de `cellules`")

        priorite = objet["priorite"]
        if isinstance(priorite, bool) or not isinstance(priorite, int):
            raise ProblemeInvalide(f"{chemin}.priorite : entier attendu, reçu {priorite!r}")

        lots = []
        for j, brut_lot in enumerate(_exiger_liste(objet["lots"], f"{chemin}.lots")):
            chemin_lot = f"{chemin}.lots[{j}]"
            lot = _exiger_objet(brut_lot, chemin_lot)
            _cles(lot, chemin_lot, {"heures", "plafonds", "echeance", "ecartSuivant"}, {"heures"})
            ecart = lot.get("ecartSuivant")
            if ecart is not None and (isinstance(ecart, bool) or not isinstance(ecart, int) or ecart < 0):
                raise ProblemeInvalide(f"{chemin_lot}.ecartSuivant : entier positif attendu, reçu {ecart!r}")
            echeance = lot.get("echeance")
            if echeance is not None and (
                isinstance(echeance, bool) or not isinstance(echeance, int) or echeance not in semaines
            ):
                raise ProblemeInvalide(f"{chemin_lot}.echeance : semaine de `semaines` attendue, reçu {echeance!r}")
            lots.append(
                Lot(
                    heures=_nombre(lot["heures"], f"{chemin_lot}.heures"),
                    plafonds=_par_semaine(lot, "plafonds", chemin_lot, semaines),
                    echeance=echeance,
                    ecart_suivant=ecart,
                )
            )

        taches.append(
            Tache(
                id=_texte(objet, "id", chemin),
                formateur=formateur,
                groupes=groupes_tache,
                cellules=cellules_tache,
                priorite=priorite,
                lots=tuple(lots),
                encadree_par=_textes(objet.get("encadreePar", []), f"{chemin}.encadreePar"),
                pas_tache=_pas_tache(objet, chemin, pas),
                pose_min=_pas_tache(objet, chemin, pas, cle="poseMin"),
            )
        )
    _uniques([t.id for t in taches], "probleme.taches")

    # ⚠️ Un encadrant inconnu ne serait jamais « commencé » : la tâche ne se
    #    poserait jamais, sans que rien ne dise pourquoi.
    ids_taches = {t.id for t in taches}
    for i, tache in enumerate(taches):
        for encadrant in tache.encadree_par:
            if encadrant not in ids_taches or encadrant == tache.id:
                raise ProblemeInvalide(
                    f"probleme.taches[{i}].encadreePar : {encadrant!r} n'est pas une autre tâche"
                )

    return ProblemeChronogramme(
        pas=pas,
        semaines=tuple(liste_semaines),
        formateurs=tuple(formateurs),
        groupes=tuple(groupes),
        cellules=tuple(cellules),
        taches=tuple(taches),
    )


def ecrire_solution_chronogramme(solution: SolutionChronogramme) -> dict[str, Any]:
    return {
        "poses": [
            {"tacheId": p.tache_id, "lot": p.lot, "semaine": p.semaine, "heures": p.heures}
            for p in solution.poses
        ],
        "nonPoses": [
            {"tacheId": n.tache_id, "lot": n.lot, "heures": n.heures, "cause": n.cause}
            for n in solution.non_poses
        ],
        "rapport": solution.rapport,
    }
