"""
La boucle maître : ordonner les tâches, puis les placer.

← l'étape 5 de `processSingleWeekGeneration`. L'algorithme est GLOUTON et porté
à l'identique : on traite les tâches par ordre de priorité, on pose d'abord les
blocs de 5 h, puis les séances isolées, et on abandonne une tâche dès qu'aucun
créneau ne convient. Il ne revient jamais sur un placement déjà fait.

⚠️ C'EST CETTE ABSENCE DE RETOUR EN ARRIÈRE qui produit les séances non placées
   du rapport : une tâche traitée tôt peut occuper le seul créneau dont une
   tâche ultérieure avait besoin. Un solveur de contraintes (CP-SAT) n'a pas ce
   défaut — c'est la raison de le prévoir, et la raison pour laquelle ce module
   est le SEUL que son arrivée remplacera : le contrat, lui, ne bouge pas.

Le portage est littéral par choix : il sert de garde-fou de fidélité. Une
différence de grille avec l'ancien doit pouvoir s'expliquer, pas se découvrir.
"""

from __future__ import annotations

import random
import time

from .aleatoire import choisir, graine_vers_generateur, melange
from .contexte import construire_contexte
from .contrat import NonPlacee, Placement, Probleme, Solution, Tache, MOTEUR, VERSION
from .diagnostic import diagnostiquer
from .etat import Etat, etat_initial, groupes_bloques
from .placement import meilleurs_blocs, meilleurs_simples


def ordonner(taches: tuple[Tache, ...], rng: random.Random) -> list[Tache]:
    """
    Priorité d'abord, difficulté ensuite.

    ← `prioritizeTasks`. Le niveau de priorité (régional, semestre) est calculé
    par Node ; la difficulté départage deux tâches de même niveau, la plus
    difficile passant devant — elle a moins de créneaux où aller.

    ⚠️ LE MÉLANGE PRÉALABLE N'EST PAS DÉCORATIF. Le tri de Python est stable :
       sans lui, deux tâches de priorité ET de difficulté égales seraient
       toujours traitées dans l'ordre d'arrivée, et la même filière passerait
       systématiquement en premier semaine après semaine.
    """
    return sorted(melange(taches, rng), key=lambda t: (t.priorite, -t.difficulte))


def resoudre(probleme: Probleme) -> Solution:
    """Place ce qui peut l'être, et dit pourquoi pour le reste."""
    debut = time.perf_counter()

    rng = graine_vers_generateur(probleme.graine)
    contexte = construire_contexte(probleme)
    etat: Etat = etat_initial(probleme, contexte.reelles)

    placements: list[Placement] = []
    non_placees: list[NonPlacee] = []
    demandees = 0

    for tache in ordonner(probleme.taches, rng):
        demandees += tache.seances_requises
        if tache.seances_requises <= 0:
            continue

        bloques = groupes_bloques(tache.groupes, probleme.incompatibilites)
        posees = 0

        # --- Blocs de 5 h -------------------------------------------------
        # ⚠️ UNE RECHERCHE COMPLÈTE PAR BLOC, jamais une liste calculée une
        #    fois : chaque pose change l'état, donc les créneaux disponibles et
        #    les scores de tous les suivants.
        for _ in range(tache.seances_requises // 2):
            if tache.seances_requises - posees < 2:
                break
            candidats = meilleurs_blocs(tache, bloques, contexte, etat, rng)
            if not candidats:
                break
            retenu = choisir(candidats, rng)
            for creneau in retenu.creneaux:
                etat.poser(
                    creneau,
                    tache.formateur,
                    tache.groupes,
                    retenu.salle,
                    contexte.reelles.get(retenu.salle, True),
                )
                placements.append(
                    Placement(
                        tache_id=tache.id,
                        creneau_id=creneau.id,
                        salle=retenu.salle,
                        deconseille=creneau.id in tache.creneaux_a_eviter,
                    )
                )
            posees += 2

        # --- Séances isolées de 2,5 h -------------------------------------
        while posees < tache.seances_requises:
            candidats = meilleurs_simples(tache, bloques, contexte, etat, rng)
            if not candidats:
                break
            retenu = choisir(candidats, rng)
            etat.poser(
                retenu.creneau,
                tache.formateur,
                tache.groupes,
                retenu.salle,
                contexte.reelles.get(retenu.salle, True),
            )
            placements.append(
                Placement(
                    tache_id=tache.id,
                    creneau_id=retenu.creneau.id,
                    salle=retenu.salle,
                    deconseille=retenu.creneau.id in tache.creneaux_a_eviter,
                )
            )
            posees += 1

        if posees < tache.seances_requises:
            # ⚠️ DIAGNOSTIC ÉTABLI ICI, sur l'état réel au moment de l'échec.
            #    Après la boucle, d'autres tâches auraient rempli la grille et
            #    la cause rapportée ne serait plus celle qui a bloqué.
            cause, bloqués, examinés = diagnostiquer(tache, bloques, contexte, etat)
            non_placees.append(
                NonPlacee(
                    tache_id=tache.id,
                    manquantes=tache.seances_requises - posees,
                    cause=cause,
                    creneaux_bloques=bloqués,
                    creneaux_examines=examinés,
                )
            )

    return Solution(
        placements=tuple(placements),
        non_placees=tuple(non_placees),
        rapport={
            "moteur": MOTEUR,
            "version": VERSION,
            "graine": probleme.graine,
            "dureeMs": round((time.perf_counter() - debut) * 1000, 2),
            "taches": len(probleme.taches),
            "seancesDemandees": demandees,
            "seancesPlacees": len(placements),
            "creneaux": len(probleme.creneaux),
        },
    )
