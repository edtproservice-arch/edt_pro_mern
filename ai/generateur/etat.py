"""
L'état de la grille pendant la génération.

← les `trackers` de `processSingleWeekGeneration` : `formateurSlots`,
`roomSlots`, `groupSlots`, `groupHours`.

Deux différences avec l'ancien, toutes deux voulues :

⚠️ 1. `formateurHours` et `formateurTeamsCount` NE SONT PAS PORTÉS. Ils étaient
      incrémentés à chaque pose, et JAMAIS relus pour refuser quoi que ce soit —
      le quota horaire est explicitement désactivé dans les deux
      `findBestSlots` (« le volume hebdomadaire est déjà décidé dans le
      chronogramme »), et le compteur TEAMS n'est testé nulle part. Ce sont des
      contraintes mortes. Les porter les ferait passer pour vivantes, et le
      premier qui voudrait « réparer » le générateur les rebrancherait — ce qui
      refuserait des séances pourtant planifiées, le défaut que le commentaire
      d'origine dit avoir corrigé.

⚠️ 2. L'OCCUPATION D'UN GROUPE EST UNE LISTE, PAS UNE CHAÎNE. L'ancien a mis
      trois découpages différents en circulation — l'un coupait sur les espaces
      et faisait de « (GC) » un groupe à part entière, l'autre comparait le
      libellé entier et laissait « GM101 » cohabiter avec « GM101 GM102 ». Ici
      Node envoie les membres déjà développés, et l'état ne manipule que des
      noms complets.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .contrat import Creneau, Probleme


def groupes_bloques(groupes: tuple[str, ...], incompatibilites: dict[str, frozenset[str]]) -> frozenset[str]:
    """
    Les noms qu'une tâche rend indisponibles : les siens, plus ceux qui les
    croisent (fusions, groupes FQ).

    ⚠️ LA CARTE EST SYMÉTRIQUE — `lecture.py` s'en assure. On peut donc marquer
       à la pose les SEULS groupes de la tâche, et ne consulter cette union
       qu'au moment de tester : les deux sens se répondent. Marquer aussi les
       incompatibles rendrait l'état illisible (un groupe apparaîtrait occupé
       sans avoir cours) sans rien ajouter.
    """
    bloques = set(groupes)
    for groupe in groupes:
        bloques |= incompatibilites.get(groupe, frozenset())
    return frozenset(bloques)


@dataclass
class Etat:
    """Ce qui est déjà pris. Muté au fil des poses."""

    #: (créneau, formateur)
    formateurs: set[tuple[int, str]] = field(default_factory=set)
    #: (créneau, salle) — les salles non réelles n'y entrent jamais.
    salles: set[tuple[int, str]] = field(default_factory=set)
    #: créneau → groupes qui ont cours
    groupes: dict[int, set[str]] = field(default_factory=dict)
    #: groupe → heures posées cette semaine, pour l'équilibrage
    heures_groupe: dict[str, float] = field(default_factory=dict)
    #: (formateur, jour) — le formateur a-t-il déjà cours ce jour-là ?
    jours_entames: set[tuple[str, str]] = field(default_factory=set)

    # -- lectures ----------------------------------------------------------

    def formateur_libre(self, creneau_id: int, formateur: str) -> bool:
        return (creneau_id, formateur) not in self.formateurs

    def groupes_libres(self, creneau_id: int, bloques: frozenset[str]) -> bool:
        occupes = self.groupes.get(creneau_id)
        if not occupes:
            return True
        return occupes.isdisjoint(bloques)

    def salle_libre(self, creneau_id: int, salle: str, reelle: bool) -> bool:
        """Une salle non réelle (TEAMS) accueille autant de séances qu'on veut."""
        if not reelle:
            return True
        return (creneau_id, salle) not in self.salles

    def jour_entame(self, formateur: str, jour: str) -> bool:
        """← `hasOtherSessions` : sert à regrouper les cours d'une même journée."""
        return (formateur, jour) in self.jours_entames

    # -- écriture ----------------------------------------------------------

    def poser(
        self,
        creneau: Creneau,
        formateur: str,
        groupes: tuple[str, ...],
        salle: str,
        reelle: bool,
    ) -> None:
        self.formateurs.add((creneau.id, formateur))
        self.jours_entames.add((formateur, creneau.jour))
        if reelle:
            self.salles.add((creneau.id, salle))
        occupes = self.groupes.setdefault(creneau.id, set())
        for groupe in groupes:
            occupes.add(groupe)
            # ⚠️ Les heures se comptent PAR GROUPE, pas une fois pour la séance :
            #    une séance à distance mutualisée est reçue par chacun de ses
            #    groupes. C'est déjà ce que faisait `tryPlaceSingle`.
            self.heures_groupe[groupe] = self.heures_groupe.get(groupe, 0.0) + creneau.duree


def etat_initial(probleme: Probleme, reelles: dict[str, bool]) -> Etat:
    """
    Part de ce qui est déjà posé — EFM, rattrapages, saisies préservées.

    ⚠️ SANS CELA, LA GÉNÉRATION ÉCRASERAIT UN EXAMEN PLANIFIÉ. L'ancien
       repartait toujours d'une grille vide ; le MERN verrouille au contraire
       les surveillances d'EFM et les rattrapages dans `poser()`. Un placement
       proposé par-dessus serait refusé à l'écriture, et la séance ressortirait
       « non placée » pour une raison introuvable côté solveur.
    """
    etat = Etat()
    par_id = {c.id: c for c in probleme.creneaux}
    for occupee in probleme.occupation:
        creneau = par_id[occupee.creneau_id]
        salle = occupee.salle or ""
        etat.poser(
            creneau,
            occupee.formateur,
            occupee.groupes,
            salle,
            reelle=bool(salle) and reelles.get(salle, True),
        )
    return etat
