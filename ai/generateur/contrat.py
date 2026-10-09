"""
Le contrat entre Node et le service de génération.

═══ CE QUE CE FICHIER GARANTIT, ET C'EST TOUT L'INTÉRÊT DU SERVICE ═══

Python ne connaît NI l'OFPPT, NI les jours fériés marocains, NI les groupes FQ,
NI la différence entre une séance présentielle et une séance à distance. Il
reçoit des créneaux numérotés, des noms opaques et des interdictions déjà
calculées ; il rend des placements.

Toutes les règles métier vivent dans `shared/src/domain` côté JS, où elles sont
testées et partagées front/back :

  · quels créneaux sont ouverts        → planning/calendrier.js  `disponibilite`
  · quels groupes se croisent          → emploi/conflits.js      `groupesSeCroisent`
  · quelles salles sont autorisées     → emploi/contraintesFormateurs.js
  · quelles séances sont déjà posées   → modules/seances

Les réécrire ici en ferait un cinquième exemplaire — la cause n°1 d'instabilité
du projet (§4.2 du plan de migration), celle qui a coûté toute la Phase 2 à
corriger. Le jour où une règle change côté JS, ce fichier n'a pas à bouger.

⚠️ CONSÉQUENCE POUR QUI AJOUTE UN CHAMP : si le champ décrit une règle
   ADMINISTRATIVE (un férié, un statut, une filière), il n'a pas sa place ici —
   Node doit le traduire en interdiction de créneau ou en incompatibilité. Ce
   fichier n'accepte que des faits abstraits : « ce créneau est interdit »,
   « ces deux noms ne peuvent pas coexister ».

═══ POURQUOI CETTE FORME EST AUSSI CELLE DU FUTUR MODÈLE ═══

Un solveur de contraintes (CP-SAT) et un modèle entraîné travaillent tous deux
sur un problème d'optimisation abstrait. En gardant le métier dehors, le
remplacement de l'heuristique par l'un ou l'autre ne touche que `solveur.py` :
le contrat, lui, ne change pas.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


# ═══ L'IDENTITÉ DU MOTEUR, ET POURQUOI ELLE VOYAGE AVEC LA SOLUTION ═══
# La trace d'une génération (étape d) doit dire QUI a produit la grille :
# sans cela, les sorties du glouton et celles de CP-SAT (étape e) se
# mélangeront dans le même corpus, sans moyen de les séparer — et un modèle
# entraîné dessus apprendrait la moyenne de deux moteurs différents.
#
# ⚠️ À INCRÉMENTER DÈS QUE LE PLACEMENT CHANGE, pas seulement au changement
#    de moteur : deux heuristiques différentes sous le même numéro sont
#    exactement ce que ce champ existe pour empêcher.
MOTEUR = "glouton"

#: Recherche complète par CP-SAT (étape e). ⚠️ LA `VERSION` EST COMMUNE AUX DEUX
#: MOTEURS : elle qualifie le paquet, `moteur` qualifie l'algorithme — c'est le
#: COUPLE qui identifie une sortie dans le corpus, jamais l'un des deux seul.
MOTEUR_CPSAT = "cpsat"

VERSION = "1.0.0"


class ProblemeInvalide(ValueError):
    """
    Entrée refusée.

    ⚠️ ON REFUSE, ON NE DEVINE PAS. Un problème mal formé doit s'arrêter ici
       avec un message qui nomme le champ fautif : accepté en silence, il
       produirait une grille plausible et fausse — une séance posée sur un jour
       férié, ou un groupe avec deux cours au même moment. C'est la règle
       §5bis-2 du plan (« le domaine valide ses propres entrées »), transposée
       de Zod.
    """


# --------------------------------------------------------------------------
# Entrée
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Creneau:
    """
    Un moment où une séance peut se poser.

    ⚠️ LES CRÉNEAUX FERMÉS N'ARRIVENT PAS JUSQU'ICI. Node a déjà retiré ce que
       `disponibilite()` ferme pour tout le monde — fériés, vacances — et ce qui
       ferme un seul groupe ou un seul formateur devient un
       `creneaux_interdits` sur la tâche concernée. Python ne sait donc pas
       qu'un 1er novembre existe.
    """

    id: int
    #: Sert à regrouper (« ce formateur a-t-il déjà cours ce jour-là ? »).
    #: Chaîne opaque : Python ne l'interprète jamais.
    jour: str
    #: Rang dans la journée, pour l'adjacence. Deux créneaux du même jour dont
    #: les rangs se suivent sont voisins.
    rang: int
    #: Durée en heures. ⚠️ PORTÉE PAR LE CRÉNEAU, PAS DÉDUITE D'UN NOM : dans
    #: l'ancien, `getSeanceDuration()` rendait 2 h pour S5 et 2,5 h ailleurs,
    #: et le générateur l'ignorait — il comptait 2,5 h partout.
    duree: float = 2.5
    #: ═══ PÉRIODE — ÉTIQUETTE OPAQUE ═══ (2026-10-09, cours du soir)
    #: « jour » ou « soir » pour Node ; pour Python, une simple étiquette.
    #: Une tâche ne se pose que sur les créneaux de SA période : Node met les
    #: autres dans `creneaux_interdits`. Python ne la lit que pour le
    #: diagnostic, qui ne doit pas expliquer une séance du soir non placée par
    #: les 24 créneaux de jour qu'elle n'a jamais pu prendre.
    periode: str = "jour"


@dataclass(frozen=True)
class Salle:
    """
    Un lieu.

    ⚠️ `reelle=False` REMPLACE LA NOTION DE « SYNCHRONE ». Une salle non réelle
       (TEAMS) n'est jamais occupée : dix séances peuvent s'y tenir au même
       moment. C'est la seule chose que Python ait besoin de savoir, et cela
       retire du service la distinction présentiel/distanciel, qui est métier.
    """

    nom: str
    reelle: bool = True


@dataclass(frozen=True)
class Tache:
    """Un cours à placer : n séances pour un formateur et des groupes."""

    id: str
    #: Identifiant opaque (un matricule côté Node).
    formateur: str
    #: Membres déjà développés par Node : une fusion « GM101 GM102 » arrive ici
    #: en deux noms. Python ne coupe jamais une chaîne de groupe — c'est ce
    #: découpage, fait à trois endroits différents, qui a produit les défauts
    #: de suffixe de l'ancien (« GE101 (GC) » lu comme deux groupes).
    groupes: tuple[str, ...]
    seances_requises: int
    #: Plus petit = traité en premier. Calculé par Node (régional, semestre).
    priorite: int = 7
    #: Départage deux tâches de même priorité : la plus difficile d'abord.
    difficulte: float = 0.0
    #: Créneaux où cette tâche ne peut pas aller (indisponibilité du formateur,
    #: stage du groupe, formation). Déjà résolus par Node.
    creneaux_interdits: frozenset[int] = field(default_factory=frozenset)
    #: ═══ ⚠️ LES MÊMES CRÉNEAUX, RANGÉS PAR ORIGINE — ÉTIQUETTES OPAQUES ═══
    #: `(("stage", {3, 4}), ("a_eviter", {7}))`. Python COMPTE ces étiquettes,
    #: il ne les interprète JAMAIS : c'est la frontière du 2026-09-20, « Python
    #: résout, Node décide ». Écrire ici ce qu'est un stage obligerait ce
    #: module à connaître le métier — exactement ce que le contrat évite.
    #:
    #: ⚠️ UN TUPLE ET NON UN DICT : `Tache` est `frozen=True` et doit rester
    #:    HACHABLE, comme `groupes` et `creneaux_interdits` le sont déjà.
    #:
    #: ⚠️ FACULTATIF : vide, le diagnostic retombe sur `creneau_interdit`, ce
    #:    qu'il rendait avant le 2026-09-22. Un appelant qui ne connaît pas les
    #:    motifs continue donc de fonctionner, en perdant seulement le détail.
    motifs_interdiction: tuple[tuple[str, frozenset[int]], ...] = ()
    #: ═══ ⚠️ CRÉNEAUX « À ÉVITER », QUI NE SONT PAS DES INTERDICTIONS ═══
    #: Ce sont les consignes du formateur (« je préfère ne pas avoir cours le
    #: lundi matin »), que `creneaux_interdits` confondait jusqu'ici avec les
    #: impossibilités dures — stage, formation, avant-rentrée. La distinction
    #: compte : une impossibilité ne se négocie pas, une consigne oui.
    #:
    #: ⚠️ LE SOLVEUR LES ÉVITE TANT QU'IL A MIEUX À FAIRE, puis les emploie
    #:    plutôt que de ne pas placer la séance (décision du porteur,
    #:    2026-09-21). Mesuré sur l'année réelle : les traiter en dur coûtait
    #:    37 séances non placées.
    creneaux_a_eviter: frozenset[int] = field(default_factory=frozenset)
    #: Salles autorisées, déjà résolues (imposée par la carte, attribuées au
    #: formateur, ou toutes celles de l'établissement). Vide = aucune.
    salles_possibles: tuple[str, ...] = ()
    #: ═══ ⚠️ LES SALLES DU MODULE — PRÉFÉRÉES, JAMAIS IMPOSÉES ═══ (2026-09-23)
    #: La carte peut déclarer où un cours doit se donner (« Atelier soudure »).
    #: Node les met dans `salles_possibles` ET les répète ici : le solveur les
    #: choisit tant qu'il peut, puis emploie les autres **plutôt que de ne pas
    #: placer la séance**.
    #:
    #: ⚠️ UN SOUS-ENSEMBLE STRICT DE `salles_possibles`, vérifié à la lecture.
    #:    Une préférence hors des possibles ne serait jamais choisie : la
    #:    consigne serait sans effet et le directeur la croirait appliquée.
    #:
    #: ⚠️ MÊME ARBITRAGE QUE `creneaux_a_eviter`, et pour la même raison : une
    #:    séance non placée n'est pas arbitrée non plus, elle est perdue.
    #:
    #: ⚠️ VIDE = AUCUNE PRÉFÉRENCE, et le comportement est alors identique au
    #:    caractère près à celui d'avant — le cas de toutes les cartes
    #:    existantes, qui n'en déclarent aucune. C'est ce qui rend l'ajout
    #:    vérifiable sur les grilles déjà produites.
    salles_preferees: frozenset[str] = field(default_factory=frozenset)
    #: La période des créneaux où cette tâche peut aller — voir `Creneau.periode`.
    periode: str = "jour"
    #: ═══ CRÉNEAUX DE SECOURS ═══ (2026-10-09, cours du soir)
    #: Employés seulement à défaut de mieux, comme `creneaux_a_eviter`, mais
    #: SANS en être un : ce n'est pas une consigne du formateur, et la séance
    #: n'est donc pas comptée « déconseillée ». Ex. : le samedi soir pour un
    #: cours du soir, la semaine pour un cours de jour du soir (CDS), qui se
    #: donne de préférence le samedi.
    creneaux_secours: frozenset[int] = field(default_factory=frozenset)


def hors_salle(tache: Tache, salle: str) -> bool:
    """
    Cette salle trahit-elle la consigne du module ?

    ═══ ⚠️ ELLE VIT ICI, PAS DANS UN MOTEUR ═══ (2026-09-23)
    Le glouton et CP-SAT doivent en donner la MÊME lecture : le nombre de
    séances hors salle affiché au directeur varierait sinon selon le moteur
    retenu — et `choix.py` le fait varier d'une semaine à l'autre. C'est
    exactement le défaut que la migration corrige (§4.2 : la même règle en
    trois exemplaires, qui divergent).

    ⚠️ AUCUNE PRÉFÉRENCE = AUCUNE TRAHISON. Sans salle déclarée — le cas de
       toutes les cartes existantes — cette fonction rend toujours `False`, et
       les deux moteurs se comportent comme avant, au caractère près.
    """
    return bool(tache.salles_preferees) and salle not in tache.salles_preferees


@dataclass(frozen=True)
class Occupation:
    """
    Une séance DÉJÀ posée, que la génération doit respecter.

    ⚠️ CE CHAMP N'EXISTE PAS DANS L'ANCIEN, et c'est une correction. Le
       générateur d'origine repartait d'une grille vide (`newTimetable = {}`) et
       écrasait la semaine entière. Le MERN a depuis deux choses qu'il ne faut
       jamais écraser : les surveillances d'EFM et les rattrapages, que `poser()`
       verrouille explicitement. Node les envoie ici, le solveur les traite
       comme occupés dès le départ.
    """

    creneau_id: int
    formateur: str
    groupes: tuple[str, ...] = ()
    salle: str | None = None


@dataclass(frozen=True)
class Probleme:
    graine: int
    creneaux: tuple[Creneau, ...]
    salles: tuple[Salle, ...]
    taches: tuple[Tache, ...]
    #: Paires de créneaux pouvant former un bloc de 5 h.
    #: ⚠️ FOURNIES PAR NODE, JAMAIS DÉDUITES : dans l'ancien ce sont [S1,S2] et
    #:    [S3,S4] — mais pas [S2,S3], que la pause déjeuner sépare. « Quelles
    #:    séances s'enchaînent » est une règle d'emploi du temps, pas un fait
    #:    d'optimisation.
    blocs: tuple[tuple[int, int], ...] = ()
    #: nom de groupe → noms qui ne peuvent pas partager son créneau.
    #: Vient de `groupesSeCroisent` : fusions et groupes FQ compris.
    incompatibilites: dict[str, frozenset[str]] = field(default_factory=dict)
    occupation: tuple[Occupation, ...] = ()
    #: Budget de recherche, en millisecondes. N'a de sens que pour un solveur
    #: complet (CP-SAT) : le glouton ne cherche pas, il pose.
    #:
    #: ⚠️ UN PARAMÈTRE DE SOLVEUR, PAS UNE RÈGLE MÉTIER — c'est pourquoi il a sa
    #:    place ici.
    #:
    #: ⚠️⚠️ 20 s, ET CE CHIFFRE EST MESURÉ, PAS CHOISI (2026-09-21). À 5 s, la
    #:    valeur retenue d'abord, CP-SAT ne rend RIEN sur une semaine réelle —
    #:    `UNKNOWN`, aucune séance placée, sur 37 semaines sur 37. À 20 s il
    #:    gagne ~+5 séances par semaine en échec ; à 30 s, ~+5,25. Le palier
    #:    utile est donc entre les deux, et 20 s est le plus grand qui tienne
    #:    dans `GENERATEUR_TIMEOUT_MS` (30 s côté Node) : une semaine coûte
    #:    21-22 s en pratique, construction du modèle comprise. Monter le budget
    #:    SANS monter ce délai ferait tuer le solveur en cours de route.
    budget_ms: int = 20000

    #: Quel moteur employer : `MOTEUR` (glouton) ou `MOTEUR_CPSAT`.
    #:
    #: ⚠️ LE GLOUTON TOURNE DE TOUTE FAÇON — voir `choix.py`. Ce champ dit s'il
    #:    faut TENTER en plus une recherche complète, jamais s'il faut se priver
    #:    d'une grille de repli.
    moteur: str = MOTEUR


# --------------------------------------------------------------------------
# Sortie
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Placement:
    tache_id: str
    creneau_id: int
    salle: str
    #: ═══ ⚠️ LA SÉANCE TOMBE SUR UN CRÉNEAU QUE LE FORMATEUR ÉVITAIT ═══
    #: Depuis que ces créneaux sont des CONSIGNES et non des interdictions
    #: (2026-09-21), le solveur s'y résout en dernier recours plutôt que de
    #: laisser une séance non placée. Mesuré sur l'année réelle : **164
    #: séances** dans ce cas, pour en récupérer 143.
    #:
    #: ⚠️ **SANS CE DRAPEAU, PERSONNE NE LE SAIT.** Le formateur découvrirait
    #:    son cours sur un créneau qu'il avait demandé à garder libre, sans
    #:    explication, et croirait à un défaut. L'arbitrage est assumé ; le
    #:    taire ne l'est pas.
    deconseille: bool = False


@dataclass(frozen=True)
class NonPlacee:
    tache_id: str
    manquantes: int
    #: Cause dominante, en vocabulaire de SOLVEUR (`formateur_occupe`,
    #: `salle_occupee`…). ⚠️ Node la traduit en phrase métier : lui seul sait
    #: qu'un créneau interdit vient d'un stage ou d'une formation.
    cause: str
    #: Nombre de créneaux bloqués par cette cause, sur le total examiné.
    creneaux_bloques: int = 0
    creneaux_examines: int = 0


@dataclass(frozen=True)
class Solution:
    placements: tuple[Placement, ...]
    non_placees: tuple[NonPlacee, ...]
    rapport: dict[str, Any] = field(default_factory=dict)
