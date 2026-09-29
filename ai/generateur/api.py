"""
Façade HTTP — FastAPI.

⚠️ CE MODULE EST LE SEUL DU PAQUET À AVOIR UNE DÉPENDANCE EXTERNE, et il est
   facultatif. Le solveur, ses tests et le mode CLI tournent sans rien
   installer ; qui n'utilise pas le service HTTP n'a pas à connaître FastAPI.
   C'est pour cela que l'import est fait ici et nulle part ailleurs.

    pip install fastapi uvicorn
    uvicorn generateur.api:app --port 8100

Pourquoi les deux modes coexistent : le sous-processus (`python -m generateur`)
n'ajoute rien à héberger et suffit aujourd'hui — 20 ms de résolution contre
~200 ms de démarrage de l'interpréteur, dont Node ne verra pas la différence
sur une génération. Le service HTTP deviendra nécessaire le jour où un modèle
entraîné devra rester chargé en mémoire entre deux appels : le recharger à
chaque semaine générée coûterait bien plus que la résolution elle-même.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException

from .contrat import ProblemeInvalide
from .lecture import ecrire_solution, lire_probleme
from .choix import resoudre

app = FastAPI(
    title="EDT Pro — génération",
    version="1.0.0",
    description="Résout un problème de placement. Ne connaît aucune règle métier.",
)


@app.get("/sante")
def sante() -> dict[str, str]:
    """Sonde de vie, pour le superviseur de l'hébergeur."""
    return {"etat": "ok"}


@app.post("/generer")
def generer(charge: dict[str, Any]) -> dict[str, Any]:
    """
    Un problème, une solution.

    ⚠️ UN PROBLÈME REFUSÉ REND 422, PAS 500 : c'est un défaut de construction
       côté Node, pas une panne du solveur. Les distinguer évite de chercher
       une erreur ici quand le JSON envoyé est en cause — et le message nomme
       le champ fautif.
    """
    try:
        probleme = lire_probleme(charge)
    except ProblemeInvalide as erreur:
        raise HTTPException(status_code=422, detail={"erreur": "PROBLEME_INVALIDE", "message": str(erreur)})

    return ecrire_solution(resoudre(probleme))
