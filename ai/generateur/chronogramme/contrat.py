"""
Le contrat de la génération du CHRONOGRAMME (2026-10-04, demande du porteur).

═══ CE QUI EST RÉSOLU ICI ═══
Le chronogramme répartit, pour chaque (formateur, groupe, module, type), une
masse d'heures sur les semaines de l'année. Ce n'est PAS le placement des
séances (`generateur.contrat`) : on ne choisit ni jour, ni créneau, ni salle —
seulement combien d'heures tombent chaque semaine.

═══ ⚠️ LA MÊME FRONTIÈRE QUE LE PLACEMENT : PYTHON NE CONNAÎT AUCUNE RÈGLE ═══
Python ne sait pas ce qu'est un module régional, un semestre, un jour férié,
un stage, une formation, une rentrée, ni pourquoi 25 h ou 360 h. Node a déjà
tout traduit en nombres :

  · l'ordre de priorité (régional / semestre)   → `Tache.priorite`
  · le semestre d'un module                      → les semaines de `Lot.plafonds`
  · masse / 35, plancher de 25 h, seuil de 360 h → `Formateur.cibles`
  · −5 h par jour férié, stage, formation…       → `Formateur.cibles` aussi
  · ce qu'une semaine peut physiquement porter   → plafonds des cellules et groupes

Les règles vivent dans `shared/src/domain/chronogramme/generation.js`. Si vous
vous apprêtez à écrire ici « 17 » (fin du S1) ou « 25 » : c'est le signe que le
calcul doit se faire côté Node.

═══ LES SEMAINES SONT DES ENTIERS OPAQUES ═══
Seul leur ORDRE compte (on remplit dans l'ordre reçu). Que la semaine 1 soit
celle de la rentrée n'est pas l'affaire de ce module.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

#: Identité du moteur, comme `generateur.contrat.MOTEUR` — à incrémenter dès
#: que la répartition change, pour que deux heuristiques ne se confondent pas.
MOTEUR = "chronogramme-glouton"
VERSION = "1.11.0"


# --------------------------------------------------------------------------
# Entrée
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Formateur:
    id: str
    #: Heures VISÉES chaque semaine. Absente = 0 (vacances, formation…).
    #: ═══ ⚠️ UN PLAFOND, À UN PAS PRÈS (2026-10-04, retour du porteur) ═══
    #: La première version la traitait comme une simple cible, dépassée pour
    #: tenir les échéances de semestre : des formateurs à 30 h se sont
    #: retrouvés à 50 h tout le S1, et à 110 h la semaine d'avant l'échéance.
    #: Le porteur tranche : la charge hebdomadaire passe AVANT l'échéance — une
    #: fin d'année plus légère est acceptable, une semaine intenable non.
    cibles: dict[int, float] = field(default_factory=dict)
    #: Ce que le formateur doit AU MOINS recevoir chaque semaine. En dessous,
    #: l'enchaînement des lots (`Lot.ecart_suivant`) cède : un lot peut
    #: commencer plus tôt que son rythme ne le voudrait (2026-10-04 — une
    #: formatrice aux seize modules annuels restait à 5-15 h tout le début du
    #: S1, ses modules attendant de « finir pile » en S17, et perdait des
    #: heures en fin d'année). Absent = aucun minimum.
    minimums: dict[int, float] = field(default_factory=dict)
    #: Heures DÉJÀ portées chaque semaine (mode « compléter ») : elles comptent
    #: dans la cible de la semaine.
    charges: dict[int, float] = field(default_factory=dict)


@dataclass(frozen=True)
class Groupe:
    id: str
    #: Ce que le groupe reçoit au plus en temps normal.
    plafonds_souples: dict[int, float] = field(default_factory=dict)
    #: Ce qu'il peut recevoir « en cas de besoin » — un formateur encore sous
    #: sa cible, ou sans aucune heure (2026-10-04, demande du porteur : « la
    #: masse de 30 h peut être dépassée, mais pas trop »). Absent = souple.
    plafonds_toleres: dict[int, float] | None = None
    #: Ce que la semaine peut physiquement contenir. Jamais dépassé.
    plafonds_durs: dict[int, float] = field(default_factory=dict)
    charges: dict[int, float] = field(default_factory=dict)


@dataclass(frozen=True)
class Cellule:
    """
    Une case de la grille — un module d'un groupe, une semaine.

    ⚠️ PARTAGÉE ENTRE TÂCHES : un module assuré à deux (présentiel par l'un,
       synchrone par l'autre) remplit la MÊME case. Son plafond borne la somme.
    """

    id: str
    plafonds: dict[int, float] = field(default_factory=dict)
    charges: dict[int, float] = field(default_factory=dict)


@dataclass(frozen=True)
class Lot:
    """Des heures à répartir dans une fenêtre de semaines."""

    heures: float
    #: Ce que CETTE tâche peut prendre chaque semaine. Absente = fermée. C'est
    #: ce dictionnaire qui DÉFINIT la fenêtre du lot.
    plafonds: dict[int, float] = field(default_factory=dict)
    #: Dernière semaine SOUHAITÉE (fin de semestre, pour Node). Les heures qui
    #: n'y tiennent pas continuent dans les semaines suivantes de `plafonds`,
    #: servies AVANT tout le reste — mais jamais au-delà de la cible du
    #: formateur. `None` : pas d'échéance.
    echeance: int | None = None
    #: ═══ ENCHAÎNEMENT AVEC LE LOT SUIVANT DE LA MÊME TÂCHE (2026-10-04) ═══
    #: Nombre de semaines ouvertes qu'on tolère entre la fin de ce lot et son
    #: échéance — donc avant que le lot suivant ne prenne le relais. Le lot ne
    #: commence pas plus tôt qu'il ne faut, puis avance à rythme régulier
    #: jusqu'à l'échéance, au lieu d'être servi d'un bloc et de laisser un
    #: trou de plusieurs mois. `None` : pas de contrainte.
    ecart_suivant: int | None = None


@dataclass(frozen=True)
class Tache:
    id: str
    formateur: str
    #: Groupes qui reçoivent ces heures. Plusieurs = séance mutualisée, qui ne
    #: pèse qu'une fois sur le formateur mais sur chacun des groupes.
    groupes: tuple[str, ...]
    cellules: tuple[str, ...]
    #: Plus petit = servi d'abord.
    priorite: int
    lots: tuple[Lot, ...]
    #: ═══ TÂCHES QUI ENCADRENT CELLE-CI (2026-10-04) ═══
    #: Elle ne se pose que STRICTEMENT APRÈS la première semaine de chacune, et
    #: STRICTEMENT AVANT leur dernière. Node s'en sert pour que le synchrone
    #: d'un module ne tombe ni au début ni à la fin de son présentiel — mais
    #: Python n'en sait rien : il compte des semaines, pas des natures de cours.
    encadree_par: tuple[str, ...] = ()
    #: ═══ GRANULARITÉ DE LA TÂCHE, EN HEURES (2026-10-04) ═══
    #: Chaque semaine, elle pose un MULTIPLE de cette durée — Node y met 5 h
    #: pour le synchrone (« les séances synchrones doivent être de 5 h »).
    #: Seule exception : la DERNIÈRE pose, qui solde la masse — le reliquat
    #: qui ne fait pas une séance entière y forme une séance plus courte.
    #: `None` : le pas du problème. Doit en être un multiple.
    pas_tache: float | None = None
    #: ═══ POSE MINIMALE D'UNE SEMAINE, EN HEURES (2026-10-04) ═══
    #: Une semaine où la tâche reçoit quelque chose, elle reçoit AU MOINS
    #: cela — sauf la pose qui solde la masse. Node y met 5 h pour les longs
    #: modules (« de 70 h et plus, des séances de 5 h à 10 h »). `None` : un pas.
    pose_min: float | None = None


@dataclass(frozen=True)
class ProblemeChronogramme:
    #: Granularité des heures posées (2,5 h : un créneau).
    pas: float
    semaines: tuple[int, ...]
    formateurs: tuple[Formateur, ...]
    groupes: tuple[Groupe, ...]
    cellules: tuple[Cellule, ...]
    taches: tuple[Tache, ...]


# --------------------------------------------------------------------------
# Sortie
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Pose:
    tache_id: str
    #: Index du lot dans `Tache.lots` : c'est lui qui dit si l'heure tombe
    #: après l'échéance de son lot.
    lot: int
    semaine: int
    heures: float


@dataclass(frozen=True)
class NonPose:
    tache_id: str
    lot: int
    heures: float
    #: Code de SOLVEUR, traduit par Node :
    #:   `fenetre_fermee`        aucune semaine ouverte dans la fenêtre
    #:   `fenetre_trop_courte`   même seule, la tâche n'y tient pas
    #:   `cible_formateur`       la charge hebdomadaire du formateur est pleine
    #:   `capacite_partagee`     la place du groupe a été prise par d'autres tâches
    #:   `encadrement`           les tâches qui l'encadrent ne lui ont pas laissé de semaine
    #:   `hors_pas`              reliquat inférieur à un pas
    cause: str


@dataclass(frozen=True)
class SolutionChronogramme:
    poses: tuple[Pose, ...]
    non_poses: tuple[NonPose, ...]
    rapport: dict[str, Any] = field(default_factory=dict)
