"""
Où poser une séance : recherche des meilleurs créneaux et calcul des scores.

← `findBestSlotsForBlock` et `findBestSlotsForSingle`. Les scores sont portés à
l'identique — ce sont eux qui donnent à la grille son allure, et les changer
reviendrait à produire un emploi du temps que l'établissement ne reconnaîtrait
plus.

⚠️ ON COLLECTE TOUS LES EX ÆQUO, PUIS LE SOLVEUR EN TIRE UN. Retenir le premier
   trouvé collerait tous les cours au même jour ; c'est le tirage parmi les
   meilleurs qui répartit la semaine.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from .aleatoire import melange
from .contexte import Contexte
from .contrat import Creneau, Tache, hors_salle
from .etat import Etat

#: Volume hebdomadaire de référence d'un groupe, en heures.
#: ⚠️ NOMBRE MAGIQUE DE L'ANCIEN (`(40 - currentGroupHours) * 10`), porté tel
#:    quel. Il ne plafonne rien : il sert uniquement à faire passer devant les
#:    groupes les moins chargés. Un groupe au-delà de 40 h reçoit un bonus
#:    négatif, donc passe en dernier — il n'est jamais refusé.
VOLUME_REFERENCE_GROUPE = 40.0

SCORE_BLOC = 100
BONUS_BLOC_JOUR_ENTAME = 20
BONUS_VOISIN = 50
BONUS_JOUR_ENTAME = 10


@dataclass(frozen=True)
class CandidatBloc:
    creneaux: tuple[Creneau, Creneau]
    salle: str
    score: float


@dataclass(frozen=True)
class CandidatSimple:
    creneau: Creneau
    salle: str
    score: float


def salles_candidates(tache: Tache, rng: random.Random) -> list[str]:
    """
    Les salles où cette tâche peut aller, dans un ordre mélangé.

    ⚠️ LA RÉSOLUTION EST FAITE PAR NODE. L'ancien décidait ici même : salle
       imposée par la carte d'établissement, sinon salles attribuées au
       formateur, sinon toutes celles de l'établissement — et il ajoutait TEAMS
       pour une séance synchrone. Ces trois règles sont métier ; elles vivent
       désormais dans `contraintesFormateurs.js` et la carte. Python reçoit le
       résultat.
    """
    return melange(tache.salles_possibles, rng)


def _salle_libre_sur(etat: Etat, contexte: Contexte, creneaux: tuple[Creneau, ...], salle: str) -> bool:
    reelle = contexte.reelles.get(salle, True)
    return all(etat.salle_libre(c.id, salle, reelle) for c in creneaux)


def _creneau_ouvert(tache: Tache, etat: Etat, bloques: frozenset[str], creneau: Creneau) -> bool:
    """Les trois refus communs au bloc et à la séance simple, dans l'ordre de l'ancien."""
    if creneau.id in tache.creneaux_interdits:
        return False
    if not etat.formateur_libre(creneau.id, tache.formateur):
        return False
    return etat.groupes_libres(creneau.id, bloques)


class _Palmares:
    """
    Les meilleurs candidats, en DEUX classes : ceux qui respectent les consignes
    — créneaux « à éviter », salle du module — et ceux qui s'y résignent.

    ═══ ⚠️ POURQUOI DEUX CLASSES ET NON UNE PÉNALITÉ ═══ (2026-09-22)
    Une pénalité chiffrée aurait dû être assez grosse pour battre n'importe
    quel écart de score légitime — or `bonus_equilibrage` monte déjà à 400 pour
    un groupe à vide. Il aurait fallu un nombre magique de plus, et surtout il
    se serait MÉLANGÉ aux scores existants : deux candidats également bons
    auraient cessé d'être ex æquo. L'en-tête de ce fichier l'interdit — « les
    scores donnent à la grille son allure, les changer produirait un emploi du
    temps que l'établissement ne reconnaîtrait plus ».

    Ici, les scores ne sont pas touchés : on les compare **à l'intérieur de
    chaque classe**, et la seconde ne sert que si la première est vide.
    C'est mot pour mot la décision du porteur du 2026-09-21 — « le solveur les
    évite tant qu'il a mieux à faire, puis les emploie plutôt que de ne pas
    placer la séance ».

    ⚠️ QUAND AUCUN CRÉNEAU N'EST « À ÉVITER », LA CLASSE DE REPLI RESTE VIDE et
       le résultat est identique au caractère près à celui d'avant. C'est ce
       qui rend ce changement vérifiable sur les grilles existantes.
    """

    __slots__ = ("respectes", "replis", "_record_ok", "_record_repli")

    def __init__(self) -> None:
        self.respectes: list = []
        self.replis: list = []
        self._record_ok = float("-inf")
        self._record_repli = float("-inf")

    def proposer(self, candidat, score: float, se_resigne: bool) -> None:
        if se_resigne:
            if score > self._record_repli:
                self._record_repli, self.replis = score, [candidat]
            elif score == self._record_repli:
                self.replis.append(candidat)
        elif score > self._record_ok:
            self._record_ok, self.respectes = score, [candidat]
        elif score == self._record_ok:
            self.respectes.append(candidat)

    def retenus(self) -> list:
        return self.respectes or self.replis


def meilleurs_blocs(
    tache: Tache,
    bloques: frozenset[str],
    contexte: Contexte,
    etat: Etat,
    rng: random.Random,
) -> list[CandidatBloc]:
    """Deux créneaux qui s'enchaînent, pour une séance de 5 h."""
    palmares = _Palmares()

    for jour in melange(contexte.jours, rng):
        for premier, second in contexte.blocs_par_jour.get(jour, ()):
            paire = (premier, second)
            if not all(_creneau_ouvert(tache, etat, bloques, c) for c in paire):
                continue

            # ⚠️ UN BLOC SE RÉSIGNE DÈS QU'UNE DE SES DEUX HEURES EST « À
            #    ÉVITER » : le formateur subirait la demi-journée entière.
            creneau_subi = any(c.id in tache.creneaux_a_eviter for c in paire)

            for salle in salles_candidates(tache, rng):
                if not _salle_libre_sur(etat, contexte, paire, salle):
                    continue

                score = float(SCORE_BLOC)
                if etat.jour_entame(tache.formateur, jour):
                    score += BONUS_BLOC_JOUR_ENTAME

                palmares.proposer(
                    CandidatBloc(creneaux=paire, salle=salle, score=score),
                    score,
                    # ⚠️ DEUX RENONCEMENTS, UN SEUL RANG (2026-09-23). Un créneau
                    #    déconseillé et une salle hors consigne sont l'un comme
                    #    l'autre un pis-aller ; les hiérarchiser demanderait un
                    #    arbitrage que personne n'a tranché, et le solveur n'y
                    #    gagnerait rien — il ne s'y résout qu'à défaut de mieux.
                    creneau_subi or hors_salle(tache, salle),
                )

                # ⚠️ ON S'ARRÊTE À LA PREMIÈRE SALLE NON RÉELLE (← `if (space ===
                #    'TEAMS') break;`). Toutes les salles d'un même créneau ont
                #    le même score : les énumérer toutes multiplierait les
                #    entrées équivalentes et donnerait à ce créneau autant de
                #    chances d'être tiré qu'il a de salles libres. Pour une
                #    salle non réelle, qui n'est jamais occupée, cela reviendrait
                #    à la faire gagner presque à tous les coups.
                if not contexte.reelles.get(salle, True):
                    break

    return palmares.retenus()


def meilleurs_simples(
    tache: Tache,
    bloques: frozenset[str],
    contexte: Contexte,
    etat: Etat,
    rng: random.Random,
) -> list[CandidatSimple]:
    """Un créneau isolé, pour une séance de 2,5 h."""
    palmares = _Palmares()

    # ⚠️ CALCULÉ UNE FOIS, AVANT LA BOUCLE, comme dans l'ancien : la charge du
    #    groupe ne change pas pendant la recherche, seulement à la pose. Le
    #    relire par créneau donnerait le même résultat pour un coût inutile.
    reference = tache.groupes[0]
    bonus_equilibrage = (VOLUME_REFERENCE_GROUPE - etat.heures_groupe.get(reference, 0.0)) * 10

    salles = salles_candidates(tache, rng)

    for jour in melange(contexte.jours, rng):
        jour_entame = etat.jour_entame(tache.formateur, jour)

        for creneau in contexte.par_jour.get(jour, ()):
            if not _creneau_ouvert(tache, etat, bloques, creneau):
                continue

            score = 1 + bonus_equilibrage
            # Un cours qui touche un autre cours du même formateur évite les
            # trous dans sa journée.
            for voisin in contexte.voisins.get(creneau.id, ()):
                if not etat.formateur_libre(voisin, tache.formateur):
                    score += BONUS_VOISIN
            if jour_entame:
                score += BONUS_JOUR_ENTAME

            creneau_subi = creneau.id in tache.creneaux_a_eviter

            for salle in salles:
                if not _salle_libre_sur(etat, contexte, (creneau,), salle):
                    continue
                palmares.proposer(
                    CandidatSimple(creneau=creneau, salle=salle, score=score),
                    score,
                    # Voir `meilleurs_blocs` : les deux renoncements, un seul rang.
                    creneau_subi or hors_salle(tache, salle),
                )

    return palmares.retenus()
