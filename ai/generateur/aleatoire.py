"""
Tout l'aléatoire du générateur passe par ici, et par une graine.

═══ CE QUE CELA CORRIGE DANS L'ANCIEN ═══

`emploi.html` appelle `Math.random()` à quatre endroits : le mélange des jours,
celui des salles, celui des tâches à priorité égale, et le tirage parmi les
meilleurs créneaux ex æquo. Rien n'était reproductible — deux générations sur
les mêmes données donnaient deux grilles différentes, qu'aucune comparaison ne
pouvait départager. C'est ce que le plan relève en §6 pour `AutoGenConfig.graine`,
un champ déjà modélisé et jusqu'ici jamais alimenté.

Conséquences concrètes de la graine :

  · une génération se REJOUE à l'identique — un directeur qui signale un
    placement étrange peut être reproduit, sans « chez moi ça marche » ;
  · deux versions du solveur se comparent sur la même graine : une différence
    de grille est alors un changement de code, jamais un coup de dé ;
  · le futur modèle s'évalue sur un jeu de problèmes fixé.

⚠️ UNE INSTANCE LOCALE, JAMAIS LE MODULE `random` GLOBAL. Le service répondra
   à plusieurs requêtes — et, en FastAPI, possiblement en parallèle : deux
   générations qui puisent dans le même état global se contamineraient, et la
   reproductibilité promise par la graine tomberait sans que rien ne le signale.
"""

from __future__ import annotations

import random
from typing import Iterable, Sequence, TypeVar

T = TypeVar("T")


def graine_vers_generateur(graine: int) -> random.Random:
    """Un générateur isolé, dont toute la génération dépend."""
    return random.Random(graine)


def melange(sequence: Iterable[T], rng: random.Random) -> list[T]:
    """
    Copie mélangée.

    ⚠️ UNE COPIE, PAS UN MÉLANGE EN PLACE : l'appelant réutilise souvent la
       liste d'origine d'une tâche à l'autre (les jours, les salles). La
       mélanger en place ferait dépendre chaque tâche de l'ordre laissé par la
       précédente — l'ordre resterait déterministe, mais il deviendrait
       impossible à raisonner.

    `random.shuffle` est le même Fisher-Yates descendant que `shuffleArray()`
    de l'ancien ; le réécrire à la main n'apporterait qu'un risque d'erreur.
    """
    copie = list(sequence)
    rng.shuffle(copie)
    return copie


def choisir(sequence: Sequence[T], rng: random.Random) -> T:
    """
    Un élément au hasard.

    ← `bestSlots[Math.floor(Math.random() * bestSlots.length)]`. Le tirage parmi
    les créneaux EX ÆQUO est ce qui donne des grilles variées d'une semaine à
    l'autre : prendre systématiquement le premier collerait tous les cours au
    lundi matin.
    """
    if not sequence:
        raise IndexError("choisir() sur une séquence vide")
    return sequence[rng.randrange(len(sequence))]
