"""
Pourquoi une séance n'a-t-elle pas trouvé de place ?

← `diagnostiquerNonPlacement`. Rejoue les contrôles sur TOUS les créneaux de la
semaine et compte ce qui bloque ; la cause la plus fréquente est retenue, parce
que c'est celle sur laquelle il faut agir.

Cela remplaçait, dans l'ancien, une phrase fixe — « Conflits d'emploi du temps
ou quota d'heures atteint » — affichée à l'identique sur toutes les lignes du
rapport sans jamais rien diagnostiquer.

⚠️ ON REND UN CODE, PAS UNE PHRASE. `formateur_occupe` se traduit côté Node,
   qui seul sait qu'un créneau interdit vient d'un stage du groupe, d'une
   formation du formateur ou d'une case cochée dans l'écran des contraintes.
   Écrire la phrase ici obligerait Python à connaître ces notions — exactement
   ce que le contrat existe pour éviter.
"""

from __future__ import annotations

from .contexte import Contexte
from .contrat import Tache
from .etat import Etat

#: Aucune salle n'est autorisée pour cette tâche : rien ne pourra jamais être
#: placé, quel que soit le remplissage de la semaine.
AUCUNE_SALLE_DECLAREE = "aucune_salle_declaree"
CRENEAU_INTERDIT = "creneau_interdit"
FORMATEUR_OCCUPE = "formateur_occupe"
GROUPE_OCCUPE = "groupe_occupe"
SALLE_OCCUPEE = "salle_occupee"
AUCUN_CRENEAU = "aucun_creneau"


def diagnostiquer(
    tache: Tache,
    bloques: frozenset[str],
    contexte: Contexte,
    etat: Etat,
) -> tuple[str, int, int]:
    """
    Rend `(cause, créneaux bloqués par cette cause, créneaux examinés)`.
    """
    if not tache.salles_possibles:
        total = len(contexte.creneaux)
        return AUCUNE_SALLE_DECLAREE, total, total

    causes: dict[str, int] = {
        CRENEAU_INTERDIT: 0,
        FORMATEUR_OCCUPE: 0,
        GROUPE_OCCUPE: 0,
        SALLE_OCCUPEE: 0,
    }
    examines = 0

    def motif_de(creneau_id: int) -> str:
        """
        L'étiquette que Node a collée sur cette interdiction, ou le code
        générique s'il n'en a collé aucune.

        ⚠️ ON NE LIT PAS CE QUE L'ÉTIQUETTE VEUT DIRE — on la recopie. C'est
           toute la frontière : Node sait qu'un créneau fermé vient d'un stage
           ou d'une rentrée, Python sait seulement qu'il est fermé et qu'il
           porte un nom. Les tester ici ferait de ce module un cinquième
           exemplaire des règles métier.

        ⚠️ Balayage linéaire : il y a QUATRE motifs, pas quatre cents. Un index
           inversé coûterait une structure de plus à tenir cohérente pour
           gagner des nanosecondes sur un chemin qui ne s'exécute que pour les
           tâches DÉJÀ non placées.
        """
        for motif, ids in tache.motifs_interdiction:
            if creneau_id in ids:
                return motif
        return CRENEAU_INTERDIT

    for creneau in contexte.creneaux.values():
        examines += 1

        # ⚠️ L'ORDRE COMPTE : chaque refus arrête l'examen de ce créneau, donc
        #    un créneau n'est compté que pour sa PREMIÈRE cause. C'est ce qui
        #    fait ressortir une cause dominante plutôt qu'un cumul illisible.
        #
        # ⚠️ DIVERGENCE ASSUMÉE AVEC L'ANCIEN, ET ELLE EST VOULUE : il testait
        #    l'indisponibilité déclarée du formateur en QUATRIÈME, après les
        #    occupations. Ici les interdictions passent en premier — stage,
        #    formation et case cochée y sont fusionnées par Node. Une
        #    impossibilité structurelle explique mieux qu'une conséquence du
        #    remplissage : « ce groupe est en stage » envoie corriger le
        #    calendrier, « le formateur est occupé » envoie regarder une grille
        #    qui, elle, n'y pouvait rien.
        if creneau.id in tache.creneaux_interdits:
            motif = motif_de(creneau.id)
            causes[motif] = causes.get(motif, 0) + 1
            continue
        if not etat.formateur_libre(creneau.id, tache.formateur):
            causes[FORMATEUR_OCCUPE] += 1
            continue
        if not etat.groupes_libres(creneau.id, bloques):
            causes[GROUPE_OCCUPE] += 1
            continue

        libre = any(
            etat.salle_libre(creneau.id, salle, contexte.reelles.get(salle, True))
            for salle in tache.salles_possibles
        )
        if not libre:
            causes[SALLE_OCCUPEE] += 1

    dominante, maximum = None, 0
    for cause, nombre in causes.items():
        if nombre > maximum:
            dominante, maximum = cause, nombre

    if dominante is None:
        # Tous les créneaux étaient ouverts et une salle était libre : la tâche
        # aurait dû se placer. Le cas ne devrait pas se produire — le signaler
        # vaut mieux que rendre une cause plausible mais fausse.
        return AUCUN_CRENEAU, 0, examines

    return dominante, maximum, examines
