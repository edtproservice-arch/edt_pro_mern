"""
Appel en sous-processus : un problème sur stdin, une solution sur stdout.

    echo '{"graine":1,...}' | python -m generateur

⚠️ STDOUT NE PORTE QUE DU JSON, jamais un message de trace. Node lit ce flux
   directement : une ligne de journal en tête ferait échouer l'analyse du JSON,
   et l'erreur ressemblerait à un solveur cassé. Tout le reste part sur stderr.

Codes de sortie : 0 succès · 1 problème refusé · 2 erreur interne.
Node les distingue, parce qu'ils n'appellent pas la même réaction — un refus
est un défaut de construction du problème côté Node, une erreur interne est un
défaut du solveur.
"""

from __future__ import annotations

import json
import sys

from .contrat import ProblemeInvalide
from .lecture import ecrire_solution, lire_probleme
from .choix import resoudre


def main(argv: list[str] | None = None) -> int:
    # Windows ouvre stdout en cp1252 : sans cela, un nom de groupe accentué
    # ferait échouer l'écriture du résultat, et seulement pour certains
    # établissements.
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
        charge = json.loads(brut)
    except json.JSONDecodeError as erreur:
        print(json.dumps({"erreur": "JSON_INVALIDE", "message": str(erreur)}))
        return 1

    try:
        probleme = lire_probleme(charge)
    except ProblemeInvalide as erreur:
        print(json.dumps({"erreur": "PROBLEME_INVALIDE", "message": str(erreur)}, ensure_ascii=False))
        return 1

    try:
        solution = resoudre(probleme)
    except Exception as erreur:  # pragma: no cover — filet, jamais un chemin normal
        print(json.dumps({"erreur": "ERREUR_INTERNE", "message": str(erreur)}, ensure_ascii=False))
        return 2

    print(json.dumps(ecrire_solution(solution), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
