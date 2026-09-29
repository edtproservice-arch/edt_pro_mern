"""
Tout ce qui se déduit UNE FOIS du problème, avant de placer quoi que ce soit.

Le générateur d'origine recalculait ces regroupements à chaque tâche — et même,
pour la date du jour, à chaque créneau examiné (`new Date(weekInfo.startOfWeek)`
puis `setDate` dans la double boucle). Sur 80 tâches et 24 créneaux, la même
arithmétique était refaite des milliers de fois pour un résultat constant.
"""

from __future__ import annotations

from dataclasses import dataclass

from .contrat import Creneau, Probleme


@dataclass(frozen=True)
class Contexte:
    #: id → créneau
    creneaux: dict[int, Creneau]
    #: jours, dans l'ordre où ils apparaissent dans le problème
    jours: tuple[str, ...]
    #: jour → créneaux, triés par rang
    par_jour: dict[str, tuple[Creneau, ...]]
    #: jour → paires de créneaux formant un bloc
    blocs_par_jour: dict[str, tuple[tuple[Creneau, Creneau], ...]]
    #: id → ids adjacents (même jour, rang ±1)
    voisins: dict[int, tuple[int, ...]]
    #: nom de salle → occupe-t-elle réellement un lieu ?
    reelles: dict[str, bool]


def construire_contexte(probleme: Probleme) -> Contexte:
    creneaux = {c.id: c for c in probleme.creneaux}

    jours: list[str] = []
    par_jour: dict[str, list[Creneau]] = {}
    for creneau in probleme.creneaux:
        if creneau.jour not in par_jour:
            par_jour[creneau.jour] = []
            jours.append(creneau.jour)
        par_jour[creneau.jour].append(creneau)
    for liste in par_jour.values():
        liste.sort(key=lambda c: c.rang)

    # ⚠️ L'ADJACENCE SE LIT SUR LE RANG, PAS SUR L'IDENTIFIANT. Deux créneaux
    #    peuvent porter des ids éloignés et se suivre dans la journée — c'est le
    #    cas dès que Node retire un créneau fermé au milieu d'une semaine.
    #    Comparer les ids ferait manquer le bonus d'enchaînement, ou pire, le
    #    donnerait à deux créneaux séparés par une demi-journée.
    voisins: dict[int, tuple[int, ...]] = {}
    for liste in par_jour.values():
        for i, creneau in enumerate(liste):
            proches: list[int] = []
            if i > 0 and liste[i - 1].rang == creneau.rang - 1:
                proches.append(liste[i - 1].id)
            if i + 1 < len(liste) and liste[i + 1].rang == creneau.rang + 1:
                proches.append(liste[i + 1].id)
            voisins[creneau.id] = tuple(proches)

    # Les blocs arrivent en paires d'ids ; on les range par jour pour les
    # parcourir comme l'ancien le faisait (jour par jour, [S1,S2] puis [S3,S4]).
    blocs_par_jour: dict[str, list[tuple[Creneau, Creneau]]] = {}
    for premier_id, second_id in probleme.blocs:
        premier, second = creneaux[premier_id], creneaux[second_id]
        # ⚠️ Un bloc à cheval sur deux jours n'a pas de sens ; Node ne devrait
        #    pas en produire, mais l'accepter en silence poserait une séance de
        #    5 h répartie sur deux journées.
        if premier.jour != second.jour:
            continue
        blocs_par_jour.setdefault(premier.jour, []).append((premier, second))

    return Contexte(
        creneaux=creneaux,
        jours=tuple(jours),
        par_jour={j: tuple(liste) for j, liste in par_jour.items()},
        blocs_par_jour={j: tuple(liste) for j, liste in blocs_par_jour.items()},
        voisins=voisins,
        reelles={s.nom: s.reelle for s in probleme.salles},
    )
