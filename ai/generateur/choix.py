"""
Quel moteur produit la grille — et le filet qui empêche toute régression.

═══ POURQUOI CE MODULE EXISTE ═══

Le plan annonçait que CP-SAT « remplace `solveur.py`, et lui seul ». Les
mesures du 2026-09-21 sur l'année réelle d'un établissement ont montré que ce
remplacement pur et simple est intenable :

  · au budget d'alors (5 s), CP-SAT ne rendait AUCUNE séance — `UNKNOWN` sur
    37 semaines sur 37 ;
  · même à 20 s, il lui arrive de faire MOINS BIEN que le glouton : sur la S2
    réelle il place 150 séances là où le glouton en place 153, et sur la S35
    130 contre 143.

Un moteur qui régresse par moments n'est pas utilisable seul. Le glouton tourne
donc TOUJOURS — il coûte 30 ms par semaine — et CP-SAT ne sert qu'à faire
mieux. C'est la décision du porteur du 2026-09-21 : « multi-fil + repli
glouton ».

⚠️ AUCUNE RÈGLE MÉTIER ICI NON PLUS. Ce module arbitre entre deux solveurs ;
   il ne sait rien des fériés, des groupes FQ ni des masses horaires.
"""

from __future__ import annotations

from dataclasses import replace

from .contrat import MOTEUR, MOTEUR_CPSAT, Probleme, Solution
from . import solveur

#: Motifs de repli, tels qu'ils remontent dans le rapport.
NON_DEMANDE = "non_demande"
RIEN_A_GAGNER = "rien_a_gagner"
ORTOOLS_ABSENT = "ortools_absent"
PAS_MIEUX = "pas_mieux"
ERREUR_SOLVEUR = "erreur_solveur"


def _annoter(solution: Solution, demande: str, repli: str | None) -> Solution:
    """Dit QUI a produit la grille, et pourquoi l'autre n'a pas servi."""
    return replace(
        solution,
        rapport={**solution.rapport, "moteurDemande": demande, "repli": repli},
    )


def resoudre(probleme: Probleme) -> Solution:
    """
    Rend la meilleure grille disponible, jamais une régression.

    Le glouton est calculé dans tous les cas. CP-SAT n'est tenté que s'il est
    demandé ET s'il reste quelque chose à gagner ; sa solution n'est retenue que
    si elle place STRICTEMENT plus de séances.
    """
    base = solveur.resoudre(probleme)

    if probleme.moteur != MOTEUR_CPSAT:
        return _annoter(base, probleme.moteur, NON_DEMANDE)

    # ⚠️ RIEN À GAGNER QUAND TOUT EST PLACÉ. Une semaine complète est optimale
    #    par définition — lancer une recherche de 20 s pour retrouver le même
    #    total coûterait ~9 minutes sur une année de 38 semaines, dont 18 sont
    #    déjà pleines. Seule la FORME pourrait encore s'améliorer, et ce gain-là
    #    ne vaut pas ce prix.
    if not base.non_placees:
        return _annoter(base, MOTEUR_CPSAT, RIEN_A_GAGNER)

    try:
        from . import cpsat
    except ImportError:
        # ⚠️ ON NE CASSE PAS UNE GÉNÉRATION POUR UNE DÉPENDANCE ABSENTE, mais on
        #    ne se tait pas non plus : `repli` le dit, et l'appelant peut
        #    l'afficher. OR-Tools reste facultatif (cf. `cpsat.py`).
        return _annoter(base, MOTEUR_CPSAT, ORTOOLS_ABSENT)

    try:
        candidate = cpsat.resoudre(probleme)
    except Exception as cause:  # noqa: BLE001 — on rend une grille, jamais une panne
        return _annoter(
            replace(base, rapport={**base.rapport, "erreurCpsat": str(cause)[:200]}),
            MOTEUR_CPSAT,
            ERREUR_SOLVEUR,
        )

    # ⚠️ « STRICTEMENT PLUS », PAS « AU MOINS AUTANT ». À total égal, on garde
    #    le glouton : ses scores « donnent à la grille son allure, et les
    #    changer produirait un emploi du temps que l'établissement ne
    #    reconnaîtrait plus » (en-tête de `placement.py`). On ne bouscule cette
    #    allure que contre un gain réel.
    if len(candidate.placements) <= len(base.placements):
        return _annoter(base, MOTEUR_CPSAT, PAS_MIEUX)

    return _annoter(candidate, MOTEUR_CPSAT, None)
