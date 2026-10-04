"""
Appel en sous-processus : un problème de chronogramme sur stdin, une
répartition sur stdout.

    echo '{"pas":2.5,...}' | python -m generateur.chronogramme

⚠️ LES MÊMES RÈGLES QUE `generateur.__main__`, qui les explique : stdout ne
   porte QUE du JSON, et les codes de sortie se distinguent — 0 succès,
   1 problème refusé (défaut de construction côté Node), 2 erreur interne.
"""

from __future__ import annotations

import json
import sys

from ..contrat import ProblemeInvalide
from .lecture import ecrire_solution_chronogramme, lire_probleme_chronogramme
from .solveur import resoudre_chronogramme


def main() -> int:
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8")
        except AttributeError:  # pragma: no cover — flux remplacé en test
            pass

    brut = sys.stdin.read()
    if not brut.strip():
        print(json.dumps({"erreur": "ENTREE_VIDE", "message": "aucun problème reçu sur stdin"}))
        return 1

    try:
        probleme = lire_probleme_chronogramme(json.loads(brut))
    except json.JSONDecodeError as erreur:
        print(json.dumps({"erreur": "JSON_INVALIDE", "message": str(erreur)}))
        return 1
    except ProblemeInvalide as erreur:
        print(json.dumps({"erreur": "PROBLEME_INVALIDE", "message": str(erreur)}, ensure_ascii=False))
        return 1

    try:
        solution = resoudre_chronogramme(probleme)
    except Exception as erreur:  # pragma: no cover — filet, jamais un chemin normal
        print(json.dumps({"erreur": "ERREUR_INTERNE", "message": str(erreur)}, ensure_ascii=False))
        return 2

    print(json.dumps(ecrire_solution_chronogramme(solution), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
