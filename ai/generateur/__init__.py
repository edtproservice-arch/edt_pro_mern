"""
Génération automatique des emplois du temps — service de résolution.

Ce paquet ne dépend QUE de la bibliothèque standard. C'est délibéré : il doit
pouvoir s'exécuter et se tester sans rien installer, sur le poste d'un
développeur comme sur le serveur. FastAPI n'est requis que par `api.py`, et cet
import reste facultatif.

Deux façons de l'appeler, la même fonction derrière :

    echo '{...}' | python -m generateur          # CLI, JSON sur stdin/stdout
    uvicorn generateur.api:app                   # service HTTP (FastAPI)

⚠️ LES DEUX MODES EXISTENT POUR NE PAS FIGER LE DÉPLOIEMENT. Un sous-processus
   suffit aujourd'hui et n'ajoute rien à héberger ; un service HTTP deviendra
   nécessaire quand un modèle entraîné devra rester chargé en mémoire entre deux
   appels. Le choix se fait côté Node, sans toucher au solveur.
"""

from .contrat import (
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
from .lecture import ecrire_solution, lire_probleme
from .choix import resoudre          # le point d'entrée : glouton, ou glouton + CP-SAT

__all__ = [
    "Creneau",
    "NonPlacee",
    "Occupation",
    "Placement",
    "Probleme",
    "ProblemeInvalide",
    "Salle",
    "Solution",
    "Tache",
    "ecrire_solution",
    "lire_probleme",
    "resoudre",
]
