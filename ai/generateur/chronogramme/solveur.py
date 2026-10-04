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
1. **Budget du formateur.** Sa cible, relevée de `_TOLERANCE` au plus s'il
   est en retard sur l'année (rythme), corrigée du reliquat d'arrondi de la
   semaine précédente.

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

   ⚠️ UN LOT QUI ENCHAÎNE SUR UN AUTRE (`ecart_suivant` — le S1 d'un module
      annuel, pour Node) n'est pas servi d'un bloc : il ne commence pas plus
      tôt qu'il ne faut pour finir à `ecart_suivant` semaines au plus de son
      échéance, puis prend ⌈ reste ÷ semaines restantes ⌉ chaque semaine. Le
      lot suivant a droit à la continuité dès sa première semaine ouverte.
      (2026-10-04, retour du porteur : un module annuel servi S2–S4, puis
      repris en S18 seulement.)

   ⚠️ UNE TÂCHE À GRANULARITÉ (`pas_tache` — le synchrone, 5 h, pour Node)
      pose chaque semaine un multiple de sa granularité : une demande d'un pas
      devient une séance entière, et ce qui ne la remplit pas n'est pas posé —
      SAUF la pose qui solde la masse : le reliquat qui ne fait pas une séance
      entière y forme une séance plus courte (2026-10-04, demande du porteur :
      « planifie le reliquat en une séance plus courte »).

   ⚠️ UNE TÂCHE À POSE MINIMALE (`pose_min` — les longs modules, 5 h, pour
      Node) reçoit chaque semaine 0 ou au moins ce minimum : une demande d'un
      pas (continuité, rythme) est relevée à ce minimum, et une pose plus
      petite n'est faite que si elle solde la masse.

   ⚠️ JAMAIS LE PLAFOND DUR DES GROUPES pour REMPLIR : 5 h par jour ouvert,
      c'est la même règle que pour le formateur, vue du groupe. Une première
      écriture le franchissait pour remplir le budget du formateur — un groupe
      à 50 h n'est pas plus tenable qu'un formateur à 50 h.

3. **En cas de besoin, le plafond TOLÉRÉ des groupes** (2026-10-04,
   demande du porteur : « la masse de 30 h peut être dépassée, mais pas
   trop »). Un formateur encore sous sa cible reprend le remplissage avec ce
   plafond-là — 35 h au lieu de 30 en semaine pleine, pour Node.

   C'est aussi ce passage qui évite la SEMAINE À VIDE (« le formateur ne doit
   chômer en aucun cas ») : il sert d'abord le formateur le moins servi, donc
   celui qui n'a rien eu. Son budget vaut au moins un pas dès qu'il a une
   cible. Le plafond DUR, lui, ne sert plus qu'à valider l'entrée.

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

import bisect
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
#: ou moins » de la règle. Deux créneaux, soit 5 h (2026-10-04, accord du
#: porteur : « accepte plus de 2,5 h au-dessus de la cible »). D'abord un seul :
#: mesuré sur l'année réelle, il laissait 12,5 h non planifiées ; avec deux,
#: 2,5 h. La marge ne sert qu'à un formateur EN RETARD sur l'année (rythme) :
#: celui qui est à jour reste à sa cible.
_TOLERANCE = 2

#: ═══ LA PART DES SEMAINES FUTURES SUR LAQUELLE UN LOT PEUT COMPTER ═══
#: (2026-10-04, mesuré sur l'année réelle.) Un lot n'était « à l'étroit » que
#: si son reste dépassait TOUTE la capacité de ses semaines restantes — comme
#: s'il devait les avoir toutes. Il les partage pourtant avec les autres
#: modules du formateur : un régional du S2 de 147,5 h, devancé par quatre
#: régionaux annuels, ne démarrait qu'en S25 et perdait 20 h. On ne compte
#: plus que sur les trois quarts.
_PART_DU_FUTUR = 0.75


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
    #: Voir `Lot.ecart_suivant`.
    ecart_suivant: int | None = None
    #: Granularité de la tâche, en pas (1 = pas de contrainte).
    granularite: int = 1
    #: Pose minimale d'une semaine, en pas (1 = pas de contrainte).
    pose_min: int = 1
    #: Rangs triés des semaines ouvertes à ce lot.
    ouvertes: list[int] | None = None


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
    minimums = {f.id: {s: _en_pas(h, pas) for s, h in f.minimums.items()} for f in probleme.formateurs}
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
            granularite = round(tache.pas_tache / pas) if tache.pas_tache else 1
            demande = _en_pas(lot.heures, pas)
            reliquat = round(lot.heures - demande * pas, 4)
            plafonds = {s: _en_pas(h, pas) // granularite * granularite for s, h in lot.plafonds.items()}
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
            lots[-1].granularite = granularite
            lots[-1].pose_min = max(1, round(tache.pose_min / pas)) if tache.pose_min else 1
            lots[-1].ouvertes = sorted(rang[s] for s in plafonds)
            lots[-1].ecart_suivant = lot.ecart_suivant if index < len(tache.lots) - 1 else None

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
        return (
            lot.debute
            or any(s in premiere for s in soeurs.get(lot.tache.id, ()))
            # Le lot SUIVANT d'une tâche déjà commencée : il prend le relais.
            or (lot.index > 0 and lot.tache.id in premiere)
        )

    def rythme_enchaine(lot: _Lot, i: int, deja_semaine: int) -> int | None:
        """
        Ce qu'un lot qui enchaîne sur le suivant peut poser cette semaine, ou
        `None` s'il n'est pas concerné. 0 : trop tôt pour commencer.
        """
        if lot.ecart_suivant is None or lot.echeance is None or i > lot.echeance:
            return None
        restantes = bisect.bisect_right(lot.ouvertes, lot.echeance) - bisect.bisect_left(lot.ouvertes, i)
        if restantes <= 0:
            return None
        reste = lot.reste + deja_semaine
        # Avec une pose minimale, il faut moins de semaines pour solder : on
        # commence d'autant plus tard, pour finir quand même à l'échéance.
        semaines_utiles = math.ceil(reste / lot.pose_min)
        if not lot.debute and restantes > semaines_utiles + lot.ecart_suivant:
            return 0
        return max(0, max(lot.pose_min, math.ceil(reste / restantes)) - deja_semaine)


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
        return max(min(lot.pose_min, propre - 1) - deja_semaine, propre - garde)

    poses: dict[tuple[str, int, int], int] = defaultdict(int)
    apres_echeance = 0
    report = defaultdict(float)

    def place_pour(lot: _Lot, semaine: int, pose_lot: dict, tolere: bool = False) -> int:
        """Ce que la place (tâche, case, groupes) laisse à ce lot, en pas."""
        bornes = [lot.plafonds.get(semaine, 0) - pose_lot.get(id(lot), 0)]
        for nom in lot.tache.cellules:
            bornes.append(
                _en_pas(cellules[nom].plafonds.get(semaine, 0) - charge_cellule[nom][semaine], pas)
            )
        for nom in lot.tache.groupes:
            groupe = groupes[nom]
            plafond = (groupe.plafonds_toleres if tolere else groupe.plafonds_souples).get(semaine, 0)
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
            # de toute façon dépasser sa cible que de `_TOLERANCE`.
            # ⚠️ PAR ÉCHÉANCE, PAS SEULEMENT LA DERNIÈRE (2026-10-04, mesuré
            #    sur l'année réelle) : un formateur dont les 2ᵉ années finissent
            #    en S41 et une 1ʳᵉ année en S42 paraissait à jour en comparant
            #    tout son reste à toute sa capacité jusqu'en S42 — et perdait
            #    12,5 h en fin d'année. On mesure le retard pour chaque date de
            #    fin de ses lots, et l'on retient la plus serrée.
            restants = sorted(
                (l for l in lots_par_formateur[formateur] if l.reste > 0 and l.fin >= i),
                key=lambda l: l.fin,
            )
            rythme = 1.0
            besoin = 0
            for lot in restants:
                besoin += lot.reste
                disponible = cumul[formateur][lot.fin + 1] - cumul[formateur][i]
                if disponible > 0:
                    rythme = max(rythme, besoin / disponible)

            plafond = cible + _TOLERANCE
            desire[formateur] = min(cible * rythme + report[formateur], plafond)
            voulu = min(math.floor(desire[formateur] + 0.5 + _EPS), math.floor(plafond + _EPS))
            budget[formateur] = max(0, math.floor(voulu - deja[formateur].get(semaine, 0.0) + _EPS))
            # ⚠️ Une cible, même minuscule, vaut au moins un pas : le reliquat
            #    d'arrondi ne doit jamais faire une semaine à vide.
            if deja[formateur].get(semaine, 0.0) < 1 - _EPS:
                budget[formateur] = max(budget[formateur], 1)

        # En retard, puis à l'étroit, puis priorité, puis échéance la plus proche.
        def ordre(lot: _Lot):
            en_retard = lot.echeance is not None and i > lot.echeance
            a_l_etroit = lot.reste > _PART_DU_FUTUR * lot.futur[i]
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
        # ⚠️ LA CONTINUITÉ D'ABORD — un pas pour chaque lot en cours (2026-10-04,
        #    le porteur y insiste). Passée après les minimums des lots à
        #    l'étroit, elle se faisait prendre tout le budget par eux, et le
        #    module en cours s'interrompait quand même.
        demandes = [(lot, 1) for lot in tous if en_cours(lot)]
        demandes += [
            (lot, math.ceil(lot.reste - _PART_DU_FUTUR * lot.futur[i]))
            for lot in tous
            if lot.reste > _PART_DU_FUTUR * lot.futur[i]
        ]
        demandes += [(lot, None) for lot in tous]

        def tenter(lot: _Lot, minimum: int | None, tolere: bool = False, libre: bool = False) -> int:
            """Pose ce que ce lot peut prendre ; rend la quantité posée."""
            nonlocal apres_echeance
            if lot.reste <= 0:
                return 0
            if lot.tache.encadree_par and not encadrement_ouvert(lot, i):
                return 0
            formateur = lot.tache.formateur
            restant = budget.get(formateur, 0) - pose_formateur[formateur]
            voulu = lot.reste if minimum is None else min(lot.reste, minimum)
            # `libre` : le formateur est sous son minimum — l'enchaînement cède.
            enchaine = None if libre else rythme_enchaine(lot, i, pose_lot.get(id(lot), 0))
            if enchaine is not None:
                voulu = min(voulu, enchaine)
            k = lot.granularite
            if k > 1:
                # Une demande d'un pas (continuité, rythme) devient une séance.
                voulu = min(lot.reste, -(-voulu // k) * k)
            deja_lot = pose_lot.get(id(lot), 0)
            if lot.pose_min > 1 and voulu > 0 and deja_lot < lot.pose_min:
                # Idem pour la pose minimale de la semaine — jamais pour une
                # demande nulle : l'enchaînement qui retient un lot gagne.
                voulu = min(lot.reste, max(voulu, lot.pose_min - deja_lot))
            limite = retenue(lot, i, posees, pose_tache[lot.tache.id])
            if limite is not None:
                voulu = min(voulu, limite)
            quantite = min(voulu, restant, place_pour(lot, semaine, pose_lot, tolere))
            if k > 1 and quantite < lot.reste:
                # Une séance entière — sauf la pose qui solde la masse.
                quantite = quantite // k * k
            if 0 < deja_lot + quantite < lot.pose_min and quantite < lot.reste:
                # Moins que la pose minimale, sans solder : rien plutôt que trop peu.
                quantite = 0
            if quantite <= 0:
                return 0
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
            return quantite

        for lot, minimum in demandes:
            tenter(lot, minimum)

        # ─── 3. En cas de besoin : le plafond toléré des groupes ───
        # ⚠️ Le plus loin de sa cible d'abord — c'est lui qui « a besoin ».
        #    Dans l'ordre des priorités, le formateur prioritaire, déjà
        #    presque servi, prendrait la tolérance avant celui qui n'a rien.
        def servi(lot: _Lot) -> float:
            prevu = budget.get(lot.tache.formateur, 0)
            return pose_formateur[lot.tache.formateur] / prevu if prevu > 0 else 1.0

        for lot in sorted(tous, key=servi):
            tenter(lot, None, tolere=True)

        # ─── 4. Sous son minimum, l'enchaînement cède ───
        # Un formateur qui n'atteint pas son minimum de la semaine peut ouvrir
        # un lot que l'enchaînement retenait encore : une semaine sous le
        # minimum est perdue pour de bon, un module qui commence plus tôt ne
        # l'est pas.
        for lot in tous:
            formateur = lot.tache.formateur
            manque = (
                minimums[formateur].get(semaine, 0)
                - math.ceil(deja[formateur].get(semaine, 0.0) - _EPS)
                - pose_formateur[formateur]
            )
            if manque > 0:
                tenter(lot, manque, tolere=True, libre=True)

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
