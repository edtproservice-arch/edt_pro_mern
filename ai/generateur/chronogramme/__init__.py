"""
Génération automatique du CHRONOGRAMME — répartition annuelle des heures.

Distincte du placement des séances (`generateur`) : ici on décide COMBIEN
d'heures chaque module reçoit chaque semaine, pas QUAND dans la semaine.

    echo '{...}' | python -m generateur.chronogramme

⚠️ MÊME RÈGLE QUE LE RESTE DU PAQUET : aucune règle métier, aucune dépendance.
   Voir `contrat.py`.
"""

from .contrat import (
    Cellule,
    Formateur,
    Groupe,
    Lot,
    NonPose,
    Pose,
    ProblemeChronogramme,
    SolutionChronogramme,
    Tache,
)
from .lecture import ecrire_solution_chronogramme, lire_probleme_chronogramme
from .solveur import resoudre_chronogramme

__all__ = [
    "Cellule",
    "Formateur",
    "Groupe",
    "Lot",
    "NonPose",
    "Pose",
    "ProblemeChronogramme",
    "SolutionChronogramme",
    "Tache",
    "ecrire_solution_chronogramme",
    "lire_probleme_chronogramme",
    "resoudre_chronogramme",
]
