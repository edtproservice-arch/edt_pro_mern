"""
Placement par recherche complète (CP-SAT d'OR-Tools) — F6 · étape e.

═══ CE QU'IL APPORTE, ET CE QU'IL N'APPORTE PAS ═══

Mesuré sur l'année réelle d'un établissement, le glouton place 5 387 séances
sur 5 458 (98,70 %). Sur les 71 qu'il rate, **35 se récupèrent par le seul
changement d'ordre** — treize semaines sur vingt tombent à zéro avec une autre
graine, et aucune n'est stable. Le glouton ne revient jamais sur un placement :
c'est exactement ce que cela coûte.

Le gain n'est donc PAS la vitesse — le glouton fait l'année en 12,7 s. C'est :
  1. moins de séances non placées ;
  2. surtout, la PREUVE D'OPTIMALITÉ. Aujourd'hui « 17 non placées » ne dit pas
     s'il faut corriger la carte ou relancer avec une autre graine. CP-SAT sait
     répondre « cette semaine est saturée, il n'y a rien à récupérer ».

⚠️ ET CE N'EST PAS UN SOLVEUR QUI MAXIMISE LE REMPLISSAGE. Les scores du
   glouton « donnent à la grille son allure, et les changer produirait un emploi
   du temps que l'établissement ne reconnaîtrait plus » (en-tête de
   `placement.py`). Un modèle qui ne compterait que les séances placées les
   éparpillerait : 35 séances gagnées contre une grille inutilisable est un
   mauvais marché. L'objectif porte donc AUSSI la forme — blocs de deux séances
   et concentration des journées d'un groupe.

⚠️ AUCUNE RÈGLE MÉTIER ICI, comme dans tout ce paquet : les interdictions, les
   salles possibles et les incompatibilités arrivent déjà résolues par Node.
"""

from __future__ import annotations

import os
import time
from collections import defaultdict

from .contexte import construire_contexte
from .contrat import (
    MOTEUR_CPSAT,
    NonPlacee,
    Placement,
    Probleme,
    Solution,
    VERSION,
    hors_salle,
)
from .diagnostic import diagnostiquer
from .etat import etat_initial, groupes_bloques

# ═══ LES POIDS, ET POURQUOI CEUX-LÀ ═══
#
# ⚠️ L'ÉCHELLE COMPTE PLUS QUE LES VALEURS. Placer une séance doit TOUJOURS
#    l'emporter sur toute considération de forme ou de consigne : le plus petit
#    gain de placement (1 000) dépasse la plus forte pénalité (500) et tous les
#    bonus réunis. Sans cette hiérarchie, le solveur préférerait une jolie
#    grille incomplète — exactement ce qu'on ne veut pas.

#: Gain d'une séance placée, multiplié par (8 − priorité) : un EFM régional du
#: S1 (priorité 1) pèse sept fois un cours de priorité 7.
GAIN_PLACEMENT = 1000

#: Coût d'un placement sur un créneau que le formateur préfère éviter.
#: ⚠️ INFÉRIEUR AU PLUS PETIT GAIN : la consigne cède devant une séance non
#:    placée, jamais l'inverse (décision du porteur, 2026-09-21).
PENALITE_A_EVITER = 500

#: Coût d'un placement dans une salle autre que celle déclarée pour le module.
#: ⚠️ LA MÊME VALEUR QUE `PENALITE_A_EVITER`, et ce n'est pas un raccourci :
#:    le glouton range les deux renoncements dans UNE seule classe de repli
#:    (`_Palmares`). Les départager ici ferait diverger les deux moteurs sur un
#:    arbitrage que personne n'a tranché.
#: ⚠️ INFÉRIEUR AU PLUS PETIT GAIN, pour la même raison : la consigne cède
#:    devant une séance non placée, jamais l'inverse.
PENALITE_HORS_SALLE = 500

#: Deux séances d'affilée pour la même tâche. ← `SCORE_BLOC` du glouton.
BONUS_BLOC = 100

#: Coût de chaque journée où un groupe a cours. Approche les bonus de voisinage
#: et de jour entamé du glouton : à séances égales, on préfère les concentrer.
#: ⚠️ MODESTE À DESSEIN — trop fort, il entasserait six heures sur un jour et
#:    laisserait les autres vides.
COUT_JOUR_OUVERT = 30


def resoudre(probleme: Probleme) -> Solution:
    """Place les séances par recherche complète. Même contrat que le glouton."""
    from ortools.sat.python import cp_model  # importé ici : dépendance OPTIONNELLE

    debut = time.perf_counter()
    contexte = construire_contexte(probleme)
    etat = etat_initial(probleme, contexte.reelles)

    modele = cp_model.CpModel()

    creneaux = list(contexte.creneaux.values())
    bloques_par_tache = {
        tache.id: groupes_bloques(tache.groupes, probleme.incompatibilites)
        for tache in probleme.taches
    }

    # ── Variables : x[(tache, créneau, salle)] ───────────────────────────────
    x: dict[tuple[str, int, str], object] = {}
    par_tache: dict[str, list] = defaultdict(list)
    par_tache_creneau: dict[tuple[str, int], list] = defaultdict(list)
    par_formateur: dict[tuple[str, int], list] = defaultdict(list)
    par_groupe: dict[tuple[str, int], list] = defaultdict(list)
    par_salle: dict[tuple[str, int], list] = defaultdict(list)

    for tache in probleme.taches:
        if tache.seances_requises <= 0 or not tache.salles_possibles:
            continue
        for creneau in creneaux:
            if creneau.id in tache.creneaux_interdits:
                continue
            # ⚠️ UNE OCCUPATION EXISTANTE SE TRAITE COMME UNE IMPOSSIBILITÉ, pas
            #    comme une contrainte à modéliser : les EFM et rattrapages sont
            #    déjà posés, le solveur construit sa grille AUTOUR d'eux.
            if not etat.formateur_libre(creneau.id, tache.formateur):
                continue
            if not etat.groupes_libres(creneau.id, bloques_par_tache[tache.id]):
                continue

            for salle in tache.salles_possibles:
                reelle = contexte.reelles.get(salle, True)
                if not etat.salle_libre(creneau.id, salle, reelle):
                    continue
                variable = modele.NewBoolVar(f"x_{tache.id}_{creneau.id}_{salle}")
                x[(tache.id, creneau.id, salle)] = variable
                par_tache[tache.id].append(variable)
                par_tache_creneau[(tache.id, creneau.id)].append(variable)
                par_formateur[(tache.formateur, creneau.id)].append(variable)
                for nom in tache.groupes:
                    par_groupe[(nom, creneau.id)].append(variable)
                if reelle:
                    par_salle[(salle, creneau.id)].append(variable)

    # ── Contraintes ──────────────────────────────────────────────────────────
    for tache in probleme.taches:
        variables = par_tache.get(tache.id)
        if not variables:
            continue
        # On ne pose jamais PLUS que ce que le chronogramme demande.
        modele.Add(sum(variables) <= tache.seances_requises)

    # Une tâche n'occupe qu'une salle à la fois sur un créneau donné.
    for variables in par_tache_creneau.values():
        if len(variables) > 1:
            modele.AddAtMostOne(variables)

    # Un formateur n'est qu'à un endroit.
    for variables in par_formateur.values():
        if len(variables) > 1:
            modele.AddAtMostOne(variables)

    # ═══ ⚠️⚠️ UNE RESSOURCE PAR NOM PROPRE, ET UNE CONTRAINTE PAR ARÊTE ═══
    #
    # La version précédente indexait cette ressource sur `groupes_bloques` —
    # les groupes de la tâche ET ceux qui les croisent. Elle affirmait suivre
    # le glouton ; elle ne le suivait pas. `etat.py` le dit en toutes lettres :
    # on marque à la pose les SEULS groupes de la tâche, et on ne consulte
    # l'union qu'au moment de TESTER, parce que la carte est symétrique.
    #
    # ⚠️ CE QUE L'ANCIENNE VERSION INTERDISAIT À TORT : deux tâches sur GM101 et
    #    GM102 portent toutes deux « ACADA101 (FQ) » dans leur union — elles se
    #    croisaient donc sur le PARENT et devenaient incompatibles, alors que ce
    #    sont deux classes distinctes qui peuvent parfaitement avoir cours en
    #    même temps. C'est très exactement le défaut que la Phase 4 avait
    #    identifié et refusé de reproduire (2026-08-26, page « Groupes (FQ) »).
    #
    # ⚠️ ET IL FAUSSAIT LA PREUVE D'OPTIMALITÉ, c'est-à-dire le seul apport réel
    #    de ce moteur : sur la S38 réelle, il rendait « OPTIMAL à 103 » quand le
    #    glouton en plaçait 104 — un optimum inférieur à une solution connue est
    #    la signature d'un modèle sur-contraint. Corrigé : 109.
    #
    # La structure est BIPARTIE (un FQ ↔ ses constituants), jamais une clique :
    # deux constituants ne se gênent pas entre eux. On pose donc une contrainte
    # par nom propre, puis une par ARÊTE de la carte — et jamais entre deux
    # voisins d'un même parent.
    for variables in par_groupe.values():
        if len(variables) > 1:
            modele.AddAtMostOne(variables)

    aretes_vues: set[tuple[str, str]] = set()
    for nom, voisins in probleme.incompatibilites.items():
        for voisin in voisins:
            arete = (nom, voisin) if nom <= voisin else (voisin, nom)
            if arete in aretes_vues:
                continue
            aretes_vues.add(arete)
            for creneau in creneaux:
                ensemble = (
                    par_groupe.get((nom, creneau.id), [])
                    + par_groupe.get((voisin, creneau.id), [])
                )
                if len(ensemble) > 1:
                    modele.AddAtMostOne(ensemble)

    # Une salle réelle n'accueille qu'une séance. (TEAMS n'est pas une salle.)
    for variables in par_salle.values():
        if len(variables) > 1:
            modele.AddAtMostOne(variables)

    # ── Objectif ─────────────────────────────────────────────────────────────
    termes = []

    for tache in probleme.taches:
        poids = GAIN_PLACEMENT * max(1, 8 - tache.priorite)
        for (tache_id, creneau_id, salle), variable in x.items():
            if tache_id != tache.id:
                continue
            gain = poids
            if creneau_id in tache.creneaux_a_eviter:
                gain -= PENALITE_A_EVITER
            # ⚠️ LES DEUX PÉNALITÉS S'AJOUTENT : une séance à la fois sur un
            #    créneau évité ET hors de sa salle est deux fois un pis-aller.
            #    Le gain (≥ 1 000) reste supérieur, donc elle se pose quand même
            #    plutôt que de rester non placée — la hiérarchie de l'en-tête.
            if hors_salle(tache, salle):
                gain -= PENALITE_HORS_SALLE
            termes.append(gain * variable)

    # Blocs : deux séances d'affilée pour la même tâche.
    for tache in probleme.taches:
        if tache.seances_requises < 2:
            continue
        for premier, second in probleme.blocs:
            gauche = par_tache_creneau.get((tache.id, premier))
            droite = par_tache_creneau.get((tache.id, second))
            if not gauche or not droite:
                continue
            forme = modele.NewBoolVar(f"bloc_{tache.id}_{premier}_{second}")
            # forme ⇒ les deux moitiés sont posées. L'implication suffit : le
            # solveur ne mettra `forme` à 1 que si cela rapporte.
            modele.Add(sum(gauche) >= 1).OnlyEnforceIf(forme)
            modele.Add(sum(droite) >= 1).OnlyEnforceIf(forme)
            termes.append(BONUS_BLOC * forme)

    # Concentration : chaque journée ouverte pour un groupe a un coût.
    jour_du_creneau = {creneau.id: creneau.jour for creneau in creneaux}
    par_groupe_jour: dict[tuple[str, str], list] = defaultdict(list)
    for (nom, creneau_id), variables in par_groupe.items():
        par_groupe_jour[(nom, jour_du_creneau[creneau_id])].extend(variables)

    for (nom, jour), variables in par_groupe_jour.items():
        ouvert = modele.NewBoolVar(f"jour_{nom}_{jour}")
        # ⚠️ L'IMPLICATION VA DANS CE SENS : une séance posée FORCE la journée à
        #    compter. L'inverse serait faux — le solveur mettrait `ouvert` à 0
        #    pour économiser le coût tout en posant des séances.
        for variable in variables:
            modele.AddImplication(variable, ouvert)
        termes.append(-COUT_JOUR_OUVERT * ouvert)

    modele.Maximize(sum(termes))

    # ── Résolution ───────────────────────────────────────────────────────────
    solveur = cp_model.CpSolver()
    solveur.parameters.max_time_in_seconds = max(0.1, probleme.budget_ms / 1000)
    # ═══ ⚠️⚠️ PLUSIEURS FILS — CETTE DÉCISION EN RENVERSE UNE, MESURES À
    #     L'APPUI (2026-09-21, décision du porteur) ═══
    #
    # La version précédente imposait UN SEUL FIL, au motif que « la
    # reproductibilité n'est pas négociable » : CP-SAT en parallèle rend une
    # solution qui dépend de l'ordre d'arrivée des fils, et le dispositif de
    # traces (étape d) repose sur le fait qu'une génération se rejoue.
    #
    # Le raisonnement était juste, la conclusion intenable. Mesuré sur l'année
    # réelle d'un établissement (38 semaines, 5 612 séances demandées) :
    #
    #     1 fil,  5 s  →  AUCUNE séance placée, UNKNOWN sur les 37 semaines
    #     1 fil, 60 s  →  AUCUNE séance placée, UNKNOWN
    #     8 fils, 5 s  →  AUCUNE séance placée, UNKNOWN
    #     8 fils, 20 s →  +41 séances sur le glouton, 15 semaines sur 20
    #                     PROUVÉES optimales
    #
    # Un moteur qui rend une grille VIDE est reproductible, mais il ne sert à
    # rien. Le mono-fil sur le modèle corrigé ne sauve d'ailleurs que 6 semaines
    # sur 20 : sur les 14 autres il rend toujours zéro.
    #
    # ⚠️ CE QUI REMPLACE LA GARANTIE PERDUE : le repli sur le glouton, qui
    #    assure qu'une génération n'est JAMAIS pire que sans ce moteur, et la
    #    trace de l'étape d, qui enregistre la grille RETENUE — donc auditable
    #    même si elle n'est plus rejouable à l'identique.
    #
    # ⚠️ NE PAS « CORRIGER » EN REMETTANT 1. La graine reste posée : elle ne
    #    suffit pas à rendre CP-SAT déterministe en parallèle, mais elle évite
    #    la dérive gratuite d'une exécution à l'autre.
    solveur.parameters.num_workers = min(8, os.cpu_count() or 1)
    solveur.parameters.random_seed = probleme.graine % (2**31)

    statut = solveur.Solve(modele)
    trouve = statut in (cp_model.OPTIMAL, cp_model.FEASIBLE)

    # ── Extraction ───────────────────────────────────────────────────────────
    placements: list[Placement] = []
    poses: dict[str, int] = defaultdict(int)
    # ⚠️ LE MÊME DRAPEAU QUE LE GLOUTON, sur la même définition : les deux
    #    moteurs doivent rapporter la même chose, sinon le compte affiché au
    #    directeur dépendrait du moteur retenu — ce que `choix.py` fait varier
    #    d'une semaine à l'autre.
    a_eviter = {t.id: t.creneaux_a_eviter for t in probleme.taches}

    if trouve:
        for (tache_id, creneau_id, salle), variable in x.items():
            if solveur.Value(variable):
                placements.append(
                    Placement(
                        tache_id=tache_id,
                        creneau_id=creneau_id,
                        salle=salle,
                        deconseille=creneau_id in a_eviter.get(tache_id, ()),
                    )
                )
                poses[tache_id] += 1

    # ⚠️ L'ORDRE DES PLACEMENTS EST FIXÉ, pas laissé au parcours du dictionnaire :
    #    deux exécutions doivent rendre la même liste, pas seulement le même
    #    ensemble — sinon la trace d'une génération rejouée diffère.
    placements.sort(key=lambda p: (p.creneau_id, p.tache_id, p.salle))

    # ── Ce qui n'a pas trouvé de place, et pourquoi ──────────────────────────
    # On rejoue l'état final pour que le diagnostic parle le MÊME vocabulaire
    # que celui du glouton : une cause qui changerait de sens selon le moteur
    # serait pire qu'une absence de cause.
    final = etat_initial(probleme, contexte.reelles)
    index = {tache.id: tache for tache in probleme.taches}
    for placement in placements:
        tache = index[placement.tache_id]
        # ⚠️ `tache.groupes`, JAMAIS `bloques_par_tache` : la carte des
        #    incompatibilités étant symétrique, on marque à la pose les seuls
        #    groupes de la tâche et on ne consulte l'union qu'au test (cf.
        #    `groupes_bloques`). Marquer les incompatibles rendrait l'état plus
        #    occupé qu'il ne l'est, et le diagnostic de CP-SAT divergerait de
        #    celui du glouton — l'inverse de ce que ce rejeu cherche.
        final.poser(
            contexte.creneaux[placement.creneau_id],
            tache.formateur,
            tache.groupes,
            placement.salle,
            contexte.reelles.get(placement.salle, True),
        )

    non_placees: list[NonPlacee] = []
    for tache in probleme.taches:
        manquantes = tache.seances_requises - poses.get(tache.id, 0)
        if manquantes <= 0:
            continue
        cause, bloques, examines = diagnostiquer(
            tache, bloques_par_tache[tache.id], contexte, final
        )
        non_placees.append(
            NonPlacee(
                tache_id=tache.id,
                manquantes=manquantes,
                cause=cause,
                creneaux_bloques=bloques,
                creneaux_examines=examines,
            )
        )

    demandees = sum(tache.seances_requises for tache in probleme.taches)
    return Solution(
        placements=tuple(placements),
        non_placees=tuple(non_placees),
        rapport={
            "moteur": MOTEUR_CPSAT,
            "version": VERSION,
            "graine": probleme.graine,
            "dureeMs": round((time.perf_counter() - debut) * 1000, 2),
            "taches": len(probleme.taches),
            "seancesDemandees": demandees,
            "seancesPlacees": len(placements),
            "creneaux": len(probleme.creneaux),
            # ═══ CE QUE LE GLOUTON NE SAURA JAMAIS DIRE ═══ « OPTIMAL » signifie
            # qu'il n'existe AUCUNE meilleure grille : les séances manquantes
            # sont irrécupérables, et c'est la carte qu'il faut corriger, pas la
            # génération qu'il faut relancer.
            "statut": solveur.StatusName(statut),
            "optimal": statut == cp_model.OPTIMAL,
            "budgetMs": probleme.budget_ms,
        },
    )
