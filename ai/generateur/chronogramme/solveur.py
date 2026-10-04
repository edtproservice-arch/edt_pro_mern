"""
Répartition des heures sur les semaines — glouton chronologique.

═══ LA RÈGLE QUI PASSE AVANT TOUT : LA CHARGE HEBDOMADAIRE ═══
(2026-10-04, retour du porteur sur la première version.) Un formateur ne
reçoit JAMAIS plus que sa cible de la semaine, à un pas près. La première
version faisait l'inverse — l'échéance de semestre d'abord — et le tableau de
charge l'a montré : 50 h par semaine tout le S1 pour une cible de 30 h, puis
110 h la semaine d'avant l'échéance. « Une charge faible aux dernières
semaines, c'est acceptable » : on laisse donc la fin d'année s'alléger, et ce
qui ne tient pas avant une échéance déborde APRÈS elle.

═══ L'ALGORITHME, PAR SEMAINE, DANS L'ORDRE ═══
1. **Budget du formateur.** Sa cible, relevée au plus d'UN pas s'il est en
   retard sur l'année (rythme), corrigée du reliquat d'arrondi de la semaine
   précédente — jamais plus de cible + un pas.

2. **Remplissage.** Les lots sont servis dans cet ordre :
     · d'abord ceux qui ont DÉPASSÉ leur échéance (un module du S1 qui n'a pas
       tenu dans le S1 passe devant ceux du S2) ;
     · puis ceux qui ne tiendraient plus dans leurs semaines restantes — un
       module laissé pour la fin ne peut prendre que 20 h par semaine, et
       finirait seul, sous la cible, avec des heures perdues. Chacun ne reçoit
       d'abord que ce minimum, puis le remplissage ordinaire reprend ;
     · puis par priorité (plus petite d'abord) — et, à priorité égale, ceux
       déjà commencés avant ceux qu'on ouvrirait ;
     · puis par échéance.

   ═══ ⚠️ LA CONTINUITÉ D'UN MODULE (2026-10-04, demande du porteur) ═══
   Un lot COMMENCÉ reçoit au moins un pas chaque semaine où il est ouvert,
   AVANT le remplissage : sans cela, un module prioritaire qui s'ouvre en
   cours de route prend tout le budget, et celui qui avançait s'interrompt
   pendant des semaines. Le creux qu'on voit alors dans la grille, c'est
   exactement ce que le porteur a demandé d'éviter.
   Chacun prend ce que permettent le budget de son formateur, son propre
   plafond, celui de la case et le plafond SOUPLE des groupes.

   ⚠️ UNE TÂCHE ENCADRÉE (`encadree_par`) ne se pose qu'entre la première et
      la dernière semaine de ses encadrantes. Trois gestes l'empêchent de
      creuser la grille (2026-10-04, retour du porteur : un présentiel arrêté
      trente semaines en attendant son synchrone) :
        · les encadrantes d'une même tâche DÉMARRENT ENSEMBLE — dès que l'une
          commence, les autres ont droit à la continuité. Sans cela, un
          synchrone partagé par trois groupes attend que leurs trois
          présentiels se trouvent en cours en même temps, ce qui peut ne
          jamais arriver ;
        · une fois possible, l'encadrée passe AVANT ses encadrantes, pour
          finir vite ;
        · les encadrantes gardent assez de pas pour continuer CHAQUE SEMAINE
          jusqu'à la fin de l'encadrée, puis une séance après elle — au lieu
          de s'arrêter, la dernière séance en poche, en l'attendant.

   ⚠️ JAMAIS LE PLAFOND DUR DES GROUPES : 5 h par jour ouvert, c'est la même
      règle que pour le formateur, vue du groupe. Une première écriture le
      franchissait pour remplir le budget du formateur — un groupe à 50 h
      n'est pas plus tenable qu'un formateur à 50 h.

═══ ⚠️ LE RELIQUAT D'ARRONDI ═══
Une cible de 26,3 h ne se pose pas : on pose par pas de 2,5 h. Arrondir chaque
semaine au plus proche donnerait 27,5 h TOUTE l'année. On reporte l'écart
d'une semaine sur la suivante (borné à un pas) : la suite alterne 27,5 / 25 et
la moyenne retombe sur 26,3.

═══ TOUT EST COMPTÉ EN PAS ═══
Les calculs se font en ENTIERS de pas (1 = 2,5 h) : additionner 2,5 + 2,5 +
… en flottants finit par donner 22,499999 et refuser une case pleine.
"""

from __future__ import annotations

import math
import time
from collections import defaultdict
from dataclasses import dataclass

from .contrat import (
    MOTEUR,
    VERSION,
    NonPose,
    Pose,
    ProblemeChronogramme,
    SolutionChronogramme,
    Tache,
)

#: Tolérance des conversions heures → pas : 7,5 / 2,5 doit donner 3, pas 2,9999.
_EPS = 1e-6

#: Ce qu'un formateur peut recevoir AU-DESSUS de sa cible, en pas : le « plus
#: ou moins » de la règle. Un seul créneau — au-delà, la semaine n'est plus
#: celle que le directeur a demandée.
_TOLERANCE = 1


def _en_pas(heures: float, pas: float) -> int:
    """Le nombre de pas ENTIERS que contiennent ces heures (arrondi inférieur)."""
    return max(0, math.floor(heures / pas + _EPS))


@dataclass
class _Lot:
    tache: Tache
    index: int
    #: Ce qui était demandé, en pas entiers.
    demande: int
    #: Heures qui ne tombent pas sur un pas — elles ne peuvent pas se poser.
    reliquat: float
    reste: int
    plafonds: dict[int, int]
    #: Rang de la dernière semaine ouverte, et de l'échéance (ou `None`).
    fin: int
    echeance: int | None
    capacite_totale: int = 0
    #: rang → ce que les semaines APRÈS ce rang peuvent encore porter.
    futur: dict[int, int] | None = None
    #: Semaines où il restait des heures et où la cible du formateur, ou au
    #: contraire la place du groupe, a arrêté le lot — pour nommer la cause.
    bloque_formateur: int = 0
    bloque_place: int = 0
    bloque_encadrement: int = 0
    #: A-t-il déjà reçu une pose ? Il a alors droit à la continuité.
    debute: bool = False


def resoudre_chronogramme(probleme: ProblemeChronogramme) -> SolutionChronogramme:
    depart = time.perf_counter()
    pas = probleme.pas
    semaines = probleme.semaines
    rang = {semaine: i for i, semaine in enumerate(semaines)}

    groupes = {g.id: g for g in probleme.groupes}
    cellules = {c.id: c for c in probleme.cellules}

    # ─── Ce qui est déjà pris, en heures (une saisie libre peut ne pas tomber
    #     sur un pas) ───
    charge_groupe = {g.id: defaultdict(float, g.charges) for g in probleme.groupes}
    charge_cellule = {c.id: defaultdict(float, c.charges) for c in probleme.cellules}

    # ─── Cibles, en pas (flottants : une cible n'a pas à tomber juste) ───
    cibles = {f.id: {s: h / pas for s, h in f.cibles.items()} for f in probleme.formateurs}
    deja = {f.id: {s: h / pas for s, h in f.charges.items()} for f in probleme.formateurs}
    # `cumul[f][i]` = Σ des cibles des rangs < i.
    cumul: dict[str, list[float]] = {}
    for f in probleme.formateurs:
        somme = [0.0]
        for semaine in semaines:
            somme.append(somme[-1] + cibles[f.id].get(semaine, 0.0))
        cumul[f.id] = somme

    # ─── Les lots ───
    lots: list[_Lot] = []
    for tache in sorted(probleme.taches, key=lambda t: t.id):
        for index, lot in enumerate(tache.lots):
            demande = _en_pas(lot.heures, pas)
            reliquat = round(lot.heures - demande * pas, 4)
            plafonds = {s: _en_pas(h, pas) for s, h in lot.plafonds.items()}
            plafonds = {s: n for s, n in plafonds.items() if n > 0}
            lots.append(
                _Lot(
                    tache=tache,
                    index=index,
                    demande=demande,
                    reliquat=reliquat if reliquat > _EPS else 0.0,
                    reste=demande,
                    plafonds=plafonds,
                    fin=max((rang[s] for s in plafonds), default=-1),
                    echeance=rang[lot.echeance] if lot.echeance is not None else None,
                    capacite_totale=sum(plafonds.values()),
                )
            )
            apres, futur = 0, {}
            for j in range(len(semaines) - 1, -1, -1):
                futur[j] = apres
                apres += plafonds.get(semaines[j], 0)
            lots[-1].futur = futur

    lots_par_formateur: dict[str, list[_Lot]] = defaultdict(list)
    for lot in lots:
        lots_par_formateur[lot.tache.formateur].append(lot)

    # ─── Encadrement ───
    lots_de: dict[str, list[_Lot]] = defaultdict(list)
    for lot in lots:
        lots_de[lot.tache.id].append(lot)
    encadrees_de: dict[str, list[str]] = defaultdict(list)
    for tache in probleme.taches:
        for encadrant in tache.encadree_par:
            encadrees_de[encadrant].append(tache.id)
    #: tâche → rang de sa première pose.
    premiere: dict[str, int] = {}
    #: tâche → les autres encadrantes des mêmes tâches : elles démarrent ensemble.
    soeurs: dict[str, set[str]] = defaultdict(set)
    for tache in probleme.taches:
        for encadrante in tache.encadree_par:
            soeurs[encadrante].update(e for e in tache.encadree_par if e != encadrante)

    def en_cours(lot: _Lot) -> bool:
        """Commencé, ou une sœur l'est : il a droit à la continuité."""
        return lot.debute or any(s in premiere for s in soeurs.get(lot.tache.id, ()))

    def reste_de(tache_id: str) -> int:
        return sum(l.reste for l in lots_de[tache_id])

    def encadrement_ouvert(lot: _Lot, i: int) -> bool:
        """Strictement après le début, et avant la fin, de chaque encadrante."""
        return all(
            premiere.get(encadrant, i) < i
            and reste_de(encadrant) > 0
            and any(l.reste > 0 and l.fin > i for l in lots_de[encadrant])
            for encadrant in lot.tache.encadree_par
        )

    def retenue(lot: _Lot, i: int, posees: set[str], deja_semaine: int) -> int | None:
        """
        Ce qu'une encadrante peut poser au plus cette semaine.

        Elle garde un pas par pas que l'encadrée doit encore poser (au pire,
        celle-ci n'avance que d'un pas par semaine), plus un pour finir après
        elle — ou un seul si l'encadrée vient de poser ses dernières heures
        cette semaine même.

        ⚠️ MAIS ELLE PEUT TOUJOURS POSER UN PAS PAR SEMAINE, tant qu'elle en
           garde un pour la fin : retenir davantage l'arrêterait — c'est le
           creux qu'on veut éviter — et, avant que l'encadrée ne commence,
           l'empêcherait même de démarrer, donc de lui ouvrir la fenêtre.
        """
        # À sa dernière semaine ouverte, elle ne retient plus rien : garder un
        # pas qu'aucune semaine ne recevra ensuite, ce serait le perdre.
        if i >= lot.fin:
            return None
        garde = 0
        for encadree in encadrees_de.get(lot.tache.id, ()):
            reste = reste_de(encadree)
            if reste > 0 and any(l.fin > i for l in lots_de[encadree]):
                garde = max(garde, reste + 1)
            elif encadree in posees:
                garde = max(garde, 1)
        if garde == 0:
            return None
        # Le pas « de continuité » vaut pour la SEMAINE, pas pour chaque
        # passage : `deja_semaine` est ce que la tâche vient d'y poser.
        propre = reste_de(lot.tache.id)
        return max(min(1, propre - 1) - deja_semaine, propre - garde)

    poses: dict[tuple[str, int, int], int] = defaultdict(int)
    apres_echeance = 0
    report = defaultdict(float)

    def place_pour(lot: _Lot, semaine: int, pose_lot: dict) -> int:
        """Ce que la place (tâche, case, groupes) laisse à ce lot, en pas."""
        bornes = [lot.plafonds.get(semaine, 0) - pose_lot.get(id(lot), 0)]
        for nom in lot.tache.cellules:
            bornes.append(
                _en_pas(cellules[nom].plafonds.get(semaine, 0) - charge_cellule[nom][semaine], pas)
            )
        for nom in lot.tache.groupes:
            plafond = groupes[nom].plafonds_souples.get(semaine, 0)
            bornes.append(_en_pas(plafond - charge_groupe[nom][semaine], pas))
        return max(0, min(bornes))

    for i, semaine in enumerate(semaines):
        actifs = [lot for lot in lots if lot.reste > 0 and lot.plafonds.get(semaine, 0) > 0]
        if not actifs:
            continue

        # ─── 1. Budget de chaque formateur ───
        budget: dict[str, int] = {}
        desire: dict[str, float] = {}
        for formateur in sorted({lot.tache.formateur for lot in actifs}):
            cible = cibles[formateur].get(semaine, 0.0)
            if cible <= 0:
                # ⚠️ Cible nulle (vacances, formation toute la semaine…) : rien,
                #    pas même « pour l'arrondi ».
                budget[formateur] = 0
                continue

            # Rythme : le formateur est-il en retard sur l'ANNÉE ? Il ne peut
            # de toute façon gagner qu'un pas par semaine (voir `_TOLERANCE`).
            restants = [l for l in lots_par_formateur[formateur] if l.reste > 0 and l.fin >= i]
            besoin = sum(l.reste for l in restants)
            horizon = max(l.fin for l in restants)
            disponible = cumul[formateur][horizon + 1] - cumul[formateur][i]
            rythme = max(1.0, besoin / disponible) if disponible > 0 else 1.0

            plafond = cible + _TOLERANCE
            desire[formateur] = min(cible * rythme + report[formateur], plafond)
            voulu = min(math.floor(desire[formateur] + 0.5 + _EPS), math.floor(plafond + _EPS))
            budget[formateur] = max(0, math.floor(voulu - deja[formateur].get(semaine, 0.0) + _EPS))

        # En retard, puis à l'étroit, puis priorité, puis échéance la plus proche.
        def ordre(lot: _Lot):
            en_retard = lot.echeance is not None and i > lot.echeance
            a_l_etroit = lot.reste > lot.futur[i]
            echeance = lot.echeance if lot.echeance is not None else len(semaines)
            return (
                not en_retard,
                not a_l_etroit,
                lot.tache.priorite,
                not lot.debute,
                echeance,
                lot.tache.id,
                lot.index,
            )

        actifs.sort(key=ordre)
        pose_lot: dict[int, int] = {}
        pose_formateur: dict[str, int] = defaultdict(int)

        # ─── 2. Remplissage, en deux temps ───
        # D'abord, à chaque lot à l'étroit, le MINIMUM qu'il ne pourra plus
        # poser plus tard — sans quoi le premier servi prend tout le budget
        # alors qu'il n'avait besoin que d'un créneau, et l'autre perd des
        # heures. Ensuite, le remplissage ordinaire. Le budget borne les deux.
        #
        # ⚠️ Les tâches encadrées passent AVANT les autres : une fois leur
        #    fenêtre ouverte, elles doivent finir vite — leurs encadrantes les
        #    attendent pour poser leur dernière séance.
        #
        # ⚠️ MAIS LES MINIMUMS DE TOUS PASSENT AVANT LE REMPLISSAGE DE QUICONQUE :
        #    quand synchrone et présentiel ont le même formateur, une encadrée
        #    servie en entier d'abord prendrait tout le budget, et le
        #    présentiel — privé de sa continuité — creuserait la grille.
        encadrees = sorted((l for l in actifs if l.tache.encadree_par), key=ordre)
        autres = [l for l in actifs if not l.tache.encadree_par]
        tous = encadrees + autres
        posees: set[str] = set()
        pose_tache: dict[str, int] = defaultdict(int)
        demandes = [(lot, lot.reste - lot.futur[i]) for lot in tous if lot.reste > lot.futur[i]]
        # Continuité : un pas pour chaque lot commencé (ou dont une sœur l'est).
        demandes += [(lot, 1) for lot in tous if en_cours(lot)]
        demandes += [(lot, None) for lot in tous]
        for lot, minimum in demandes:
            if lot.reste <= 0:
                continue
            if lot.tache.encadree_par and not encadrement_ouvert(lot, i):
                continue
            formateur = lot.tache.formateur
            restant = budget.get(formateur, 0) - pose_formateur[formateur]
            voulu = lot.reste if minimum is None else min(lot.reste, minimum)
            limite = retenue(lot, i, posees, pose_tache[lot.tache.id])
            if limite is not None:
                voulu = min(voulu, limite)
            quantite = min(voulu, restant, place_pour(lot, semaine, pose_lot))
            if quantite <= 0:
                continue
            premiere.setdefault(lot.tache.id, i)
            lot.debute = True
            posees.add(lot.tache.id)
            pose_tache[lot.tache.id] += quantite
            heures = quantite * pas
            lot.reste -= quantite
            pose_lot[id(lot)] = pose_lot.get(id(lot), 0) + quantite
            pose_formateur[formateur] += quantite
            for nom in lot.tache.cellules:
                charge_cellule[nom][semaine] += heures
            for nom in lot.tache.groupes:
                charge_groupe[nom][semaine] += heures
            poses[(lot.tache.id, lot.index, semaine)] += quantite
            if lot.echeance is not None and i > lot.echeance:
                apres_echeance += quantite

        # Ce qui a arrêté chaque lot inachevé cette semaine.
        for lot in actifs:
            if lot.reste <= 0:
                continue
            formateur = lot.tache.formateur
            if lot.tache.encadree_par and not encadrement_ouvert(lot, i):
                lot.bloque_encadrement += 1
            elif budget.get(formateur, 0) - pose_formateur[formateur] <= 0:
                lot.bloque_formateur += 1
            else:
                lot.bloque_place += 1

        # ─── Reliquat d'arrondi, borné à un pas ───
        for formateur, voulu in desire.items():
            obtenu = deja[formateur].get(semaine, 0.0) + pose_formateur[formateur]
            report[formateur] = max(-1.0, min(1.0, voulu - obtenu))

    # ─── Ce qui n'a pas trouvé de place ───
    non_poses: list[NonPose] = []
    for lot in lots:
        manquant = round(lot.reste * pas + lot.reliquat, 4)
        if manquant <= _EPS:
            continue
        if lot.reste == 0:
            cause = "hors_pas"
        elif lot.capacite_totale == 0:
            cause = "fenetre_fermee"
        elif lot.capacite_totale < lot.demande:
            cause = "fenetre_trop_courte"
        elif lot.bloque_encadrement > max(lot.bloque_formateur, lot.bloque_place):
            cause = "encadrement"
        elif lot.bloque_formateur >= lot.bloque_place:
            cause = "cible_formateur"
        else:
            cause = "capacite_partagee"
        non_poses.append(NonPose(tache_id=lot.tache.id, lot=lot.index, heures=manquant, cause=cause))

    sortie = tuple(
        Pose(tache_id=tache_id, lot=index, semaine=semaine, heures=round(quantite * pas, 4))
        for (tache_id, index, semaine), quantite in sorted(
            poses.items(), key=lambda e: (e[0][0], e[0][1], rang[e[0][2]])
        )
    )

    return SolutionChronogramme(
        poses=sortie,
        non_poses=tuple(non_poses),
        rapport={
            "moteur": MOTEUR,
            "version": VERSION,
            "dureeMs": round((time.perf_counter() - depart) * 1000, 1),
            "heuresPosees": round(sum(p.heures for p in sortie), 2),
            "heuresNonPosees": round(sum(n.heures for n in non_poses), 2),
            "heuresApresEcheance": round(apres_echeance * pas, 2),
        },
    )
