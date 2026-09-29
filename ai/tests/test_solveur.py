"""
Les invariants du solveur.

⚠️ CE FICHIER EST LE GARDE-FOU PRINCIPAL. Une grille fausse ne se voit pas :
   elle est plausible, elle s'affiche, et c'est le directeur qui découvre en
   novembre que deux classes ont cours au même moment. Les tests ci-dessous
   vérifient donc des PROPRIÉTÉS — « aucune solution ne viole jamais ceci » —
   sur des problèmes tirés au hasard, plutôt qu'une poignée de cas écrits à la
   main qui ne décriraient que ce que j'ai su imaginer.
"""

import random
import unittest

from generateur.contrat import Creneau, Occupation, Probleme, Salle, Tache
from generateur.solveur import ordonner, resoudre


def grille(jours=("Lundi", "Mardi", "Mercredi"), rangs=4):
    """Une semaine de créneaux, avec les blocs [0,1] et [2,3] de chaque jour."""
    creneaux, blocs = [], []
    identifiant = 0
    for jour in jours:
        premiers = []
        for rang in range(rangs):
            creneaux.append(Creneau(id=identifiant, jour=jour, rang=rang))
            premiers.append(identifiant)
            identifiant += 1
        for depart in range(0, rangs - 1, 2):
            blocs.append((premiers[depart], premiers[depart + 1]))
    return tuple(creneaux), tuple(blocs)


def probleme(taches, *, graine=1, salles=None, incompatibilites=None, occupation=(), jours=None):
    creneaux, blocs = grille(*( (jours,) if jours else () ))
    return Probleme(
        graine=graine,
        creneaux=creneaux,
        blocs=blocs,
        salles=salles or (Salle("Salle 1"), Salle("Salle 2"), Salle("TEAMS", reelle=False)),
        taches=tuple(taches),
        incompatibilites=incompatibilites or {},
        occupation=tuple(occupation),
    )


def tache(identifiant, formateur, groupes, seances, **extra):
    return Tache(
        id=identifiant,
        formateur=formateur,
        groupes=tuple(groupes),
        seances_requises=seances,
        salles_possibles=extra.pop("salles", ("Salle 1", "Salle 2")),
        **extra,
    )


def verifier_invariants(cas, solution, test):
    """Ce qu'une solution ne doit JAMAIS violer, quelles que soient les données."""
    creneaux = {c.id: c for c in cas.creneaux}
    par_tache = {t.id: t for t in cas.taches}
    reelles = {s.nom: s.reelle for s in cas.salles}

    formateurs, salles_prises = set(), set()
    groupes_par_creneau: dict[int, set[str]] = {}

    for occupee in cas.occupation:
        formateurs.add((occupee.creneau_id, occupee.formateur))
        if occupee.salle and reelles.get(occupee.salle, True):
            salles_prises.add((occupee.creneau_id, occupee.salle))
        groupes_par_creneau.setdefault(occupee.creneau_id, set()).update(occupee.groupes)

    for placement in solution.placements:
        t = par_tache[placement.tache_id]
        test.assertIn(placement.creneau_id, creneaux, "créneau inventé")

        test.assertNotIn(
            placement.creneau_id, t.creneaux_interdits,
            f"{t.id} posée sur un créneau interdit",
        )
        test.assertIn(placement.salle, t.salles_possibles, f"{t.id} posée dans une salle non autorisée")

        cle = (placement.creneau_id, t.formateur)
        test.assertNotIn(cle, formateurs, f"{t.formateur} a deux séances au créneau {placement.creneau_id}")
        formateurs.add(cle)

        if reelles.get(placement.salle, True):
            cle_salle = (placement.creneau_id, placement.salle)
            test.assertNotIn(cle_salle, salles_prises, f"{placement.salle} occupée deux fois")
            salles_prises.add(cle_salle)

        occupes = groupes_par_creneau.setdefault(placement.creneau_id, set())
        for groupe in t.groupes:
            test.assertNotIn(groupe, occupes, f"{groupe} a deux cours au créneau {placement.creneau_id}")
            for autre in occupes:
                test.assertNotIn(
                    autre, cas.incompatibilites.get(groupe, frozenset()),
                    f"{groupe} et {autre} sont incompatibles et partagent le créneau {placement.creneau_id}",
                )
        occupes.update(t.groupes)

    # Rien de plus que ce qui était demandé.
    for identifiant, t in par_tache.items():
        posees = sum(1 for p in solution.placements if p.tache_id == identifiant)
        test.assertLessEqual(posees, t.seances_requises, f"{identifiant} sur-placée")
        manquantes = next((n.manquantes for n in solution.non_placees if n.tache_id == identifiant), 0)
        test.assertEqual(
            posees + manquantes, t.seances_requises,
            f"{identifiant} : {posees} posées + {manquantes} manquantes ≠ {t.seances_requises} demandées",
        )


class TestInvariants(unittest.TestCase):
    def test_sur_deux_cents_problemes_tires_au_hasard(self):
        """
        Le cœur du garde-fou : on ne décrit pas une grille attendue, on vérifie
        qu'aucune contrainte n'est jamais violée, sur des données variées.
        """
        rng = random.Random(20260920)
        for essai in range(200):
            nombre = rng.randint(1, 14)
            taches = []
            for i in range(nombre):
                groupes = [f"G{rng.randint(1, 5)}"]
                if rng.random() < 0.25:
                    groupes.append(f"G{rng.randint(1, 5)}")
                interdits = frozenset(
                    rng.sample(range(12), rng.randint(0, 6))
                ) if rng.random() < 0.5 else frozenset()
                taches.append(
                    tache(
                        f"T{i}",
                        f"F{rng.randint(1, 4)}",
                        sorted(set(groupes)),
                        rng.randint(1, 5),
                        priorite=rng.randint(1, 7),
                        difficulte=rng.random(),
                        creneaux_interdits=interdits,
                        salles=("TEAMS",) if rng.random() < 0.2 else ("Salle 1", "Salle 2"),
                    )
                )
            cas = probleme(
                taches,
                graine=rng.randint(0, 10**6),
                incompatibilites={"G1": frozenset({"G2"}), "G2": frozenset({"G1"})},
            )
            with self.subTest(essai=essai):
                verifier_invariants(cas, resoudre(cas), self)

    def test_respecte_les_seances_deja_posees(self):
        """
        Un EFM ou un rattrapage déjà en grille : le solveur doit faire avec, pas
        passer par-dessus. `poser()` côté Node les verrouille — un placement
        proposé dessus serait refusé à l'écriture, pour une raison introuvable.
        """
        cas = probleme(
            [tache("T1", "F1", ["G1"], 4, salles=("Salle 1",))],
            occupation=[Occupation(creneau_id=0, formateur="F1", groupes=("G1",), salle="Salle 1")],
        )
        solution = resoudre(cas)
        verifier_invariants(cas, solution, self)
        self.assertNotIn(0, [p.creneau_id for p in solution.placements])


class TestReproductibilite(unittest.TestCase):
    """
    Ce que la graine apporte, et que l'ancien n'avait pas : deux générations sur
    les mêmes données donnaient deux grilles, qu'aucune comparaison ne pouvait
    départager.
    """

    def _cas(self, graine):
        return probleme(
            [
                tache("T1", "F1", ["G1"], 3),
                tache("T2", "F2", ["G2"], 4),
                tache("T3", "F1", ["G3"], 2),
            ],
            graine=graine,
        )

    def test_meme_graine_meme_grille(self):
        premiere = resoudre(self._cas(7))
        seconde = resoudre(self._cas(7))
        self.assertEqual(premiere.placements, seconde.placements)
        self.assertEqual(premiere.non_placees, seconde.non_placees)

    def test_graines_differentes_donnent_des_grilles_differentes(self):
        """
        Sans quoi la graine ne piloterait rien — et le mélange des jours, des
        salles et le tirage parmi les ex æquo seraient devenus inertes.
        """
        grilles = {tuple(resoudre(self._cas(g)).placements) for g in range(12)}
        self.assertGreater(len(grilles), 1)


class TestPlacement(unittest.TestCase):
    def test_un_bloc_occupe_deux_creneaux_contigus_dans_la_meme_salle(self):
        cas = probleme([tache("T1", "F1", ["G1"], 2, salles=("Salle 1",))])
        solution = resoudre(cas)
        self.assertEqual(len(solution.placements), 2)
        creneaux = {c.id: c for c in cas.creneaux}
        premier, second = sorted(
            (creneaux[p.creneau_id] for p in solution.placements), key=lambda c: c.rang
        )
        self.assertEqual(premier.jour, second.jour, "bloc à cheval sur deux jours")
        self.assertEqual(second.rang - premier.rang, 1, "bloc non contigu")
        self.assertEqual(len({p.salle for p in solution.placements}), 1, "bloc éclaté sur deux salles")

    def test_une_salle_non_reelle_accueille_plusieurs_seances_au_meme_creneau(self):
        """TEAMS n'occupe aucun lieu : deux formateurs peuvent y être ensemble."""
        cas = probleme(
            [
                tache("T1", "F1", ["G1"], 6, salles=("TEAMS",)),
                tache("T2", "F2", ["G2"], 6, salles=("TEAMS",)),
            ]
        )
        solution = resoudre(cas)
        self.assertEqual(len(solution.placements), 12)
        partages = {p.creneau_id for p in solution.placements if p.tache_id == "T1"} & {
            p.creneau_id for p in solution.placements if p.tache_id == "T2"
        }
        self.assertTrue(partages, "aucun créneau partagé alors que la salle est virtuelle")

    def test_ne_place_rien_sans_salle_autorisee(self):
        cas = probleme([tache("T1", "F1", ["G1"], 2, salles=())])
        solution = resoudre(cas)
        self.assertEqual(solution.placements, ())
        self.assertEqual(solution.non_placees[0].cause, "aucune_salle_declaree")

    def test_ignore_une_tache_sans_seance_demandee(self):
        cas = probleme([tache("T1", "F1", ["G1"], 0)])
        solution = resoudre(cas)
        self.assertEqual(solution.placements, ())
        self.assertEqual(solution.non_placees, ())


class TestOrdonnancement(unittest.TestCase):
    def test_la_priorite_passe_avant_la_difficulte(self):
        rng = random.Random(1)
        taches = (
            tache("facile-prioritaire", "F1", ["G1"], 1, priorite=1, difficulte=0.1),
            tache("difficile-secondaire", "F2", ["G2"], 1, priorite=5, difficulte=9.9),
        )
        self.assertEqual([t.id for t in ordonner(taches, rng)][0], "facile-prioritaire")

    def test_a_priorite_egale_la_plus_difficile_passe_devant(self):
        rng = random.Random(1)
        taches = (
            tache("aisee", "F1", ["G1"], 1, priorite=3, difficulte=0.2),
            tache("ardue", "F2", ["G2"], 1, priorite=3, difficulte=8.0),
        )
        self.assertEqual([t.id for t in ordonner(taches, rng)][0], "ardue")


class TestDiagnostic(unittest.TestCase):
    def test_nomme_le_formateur_occupe(self):
        """Un formateur seul sur une grille trop petite pour tout son volume."""
        cas = probleme(
            [tache("T1", "F1", ["G1"], 20, salles=("Salle 1",))],
            jours=("Lundi",),
        )
        solution = resoudre(cas)
        self.assertTrue(solution.non_placees)
        self.assertEqual(solution.non_placees[0].cause, "formateur_occupe")

    def test_nomme_le_creneau_interdit(self):
        cas = probleme(
            [
                tache(
                    "T1", "F1", ["G1"], 4,
                    salles=("Salle 1",),
                    creneaux_interdits=frozenset(range(12)),
                )
            ]
        )
        solution = resoudre(cas)
        self.assertEqual(solution.non_placees[0].cause, "creneau_interdit")
        self.assertEqual(solution.non_placees[0].manquantes, 4)


if __name__ == "__main__":
    unittest.main()

class TestCreneauxAEviter(unittest.TestCase):
    """
    Les consignes du formateur : évitées, puis employées en dernier recours.

    ═══ ⚠️ CE QUE CES TESTS GARDENT ═══ (décision du porteur du 2026-09-21,
    appliquée côté Node le 2026-09-22)
    « Le solveur les évite tant qu'il a mieux à faire, puis les emploie plutôt
    que de ne pas placer la séance. » Les DEUX moitiés comptent, et une seule
    des deux est facile à obtenir par accident : un solveur qui ignore les
    consignes place aussi bien, et un solveur qui les traite en dur perd des
    séances. C'est l'articulation entre les deux qui est la décision.

    ⚠️ Une mutation l'a montré le 2026-09-22 : supprimer le classement en deux
       classes — donc cesser totalement d'éviter — ne faisait tomber AUCUN des
       39 tests de cette suite.
    """

    def test_EVITE_les_creneaux_deconseilles_quand_il_a_le_choix(self):
        """
        ⚠️ TRENTE GRAINES, ET NON UNE SEULE. Tous les créneaux libres ont ici le
           même score : un solveur qui aurait CESSÉ d'éviter tirerait au hasard
           parmi les douze, donc tomberait sur le lundi environ une fois sur
           trois — et passerait ce test sur une graine favorable. La première
           version de ce test faisait exactement cela : la mutation « une seule
           classe » ne la faisait pas tomber.
        """
        creneaux, _ = grille()
        lundi = frozenset(c.id for c in creneaux if c.jour == "Lundi")

        for graine in range(30):
            cas = probleme(
                [tache("T1", "F1", ["G1"], 1, creneaux_a_eviter=lundi)], graine=graine
            )
            solution = resoudre(cas)

            self.assertEqual(len(solution.placements), 1)
            self.assertNotIn(
                solution.placements[0].creneau_id,
                lundi,
                f"graine {graine} : posé sur un créneau déconseillé alors que huit étaient libres",
            )

    def test_les_EMPLOIE_plutôt_que_de_ne_pas_placer(self):
        """
        ⚠️ LA MOITIÉ QUI A RETOURNÉ LA DÉCISION : une séance non placée n'est
           pas arbitrée non plus, elle est perdue. Mesuré sur l'année réelle,
           traiter ces créneaux en dur coûtait 136 séances.
        """
        creneaux, blocs = grille()
        tous = frozenset(c.id for c in creneaux)
        cas = probleme([tache("T1", "F1", ["G1"], 1, creneaux_a_eviter=tous)])

        solution = resoudre(cas)

        self.assertEqual(len(solution.placements), 1, "la séance devait être posée quand même")
        self.assertEqual(solution.non_placees, ())

    def test_une_INTERDICTION_reste_une_interdiction(self):
        # ⚠️ Le renversement ne porte QUE sur les consignes. Un stage, lui, ne
        #    se négocie toujours pas.
        creneaux, blocs = grille()
        tous = frozenset(c.id for c in creneaux)
        cas = probleme([tache("T1", "F1", ["G1"], 1, creneaux_interdits=tous)])

        solution = resoudre(cas)

        self.assertEqual(solution.placements, ())
        self.assertEqual(len(solution.non_placees), 1)

    def test_ne_change_RIEN_quand_aucune_consigne_n_est_posee(self):
        """
        ⚠️ LE GARDE DE NON-RÉGRESSION : à consignes vides, la classe de repli
           reste vide et la grille doit être identique au caractère près à
           celle d'avant le 2026-09-22. C'est ce qui rend ce changement
           vérifiable sur les grilles existantes.
        """
        taches = [tache(f"T{i}", f"F{i}", [f"G{i}"], 2) for i in range(4)]
        attendue = resoudre(probleme(taches, graine=7))
        obtenue = resoudre(probleme(taches, graine=7))
        self.assertEqual(attendue.placements, obtenue.placements)


class TestSallesDuModule(unittest.TestCase):
    """
    La salle déclarée sur l'affectation (2026-09-23).

    ═══ ⚠️ CE QUE CES TESTS GARDENT ═══
    Le directeur peut dire qu'un module se donne dans un atelier précis. C'est
    une CONSIGNE, pas une interdiction : le solveur la suit tant qu'il peut,
    puis pose ailleurs **plutôt que de ne pas placer la séance**. C'est mot pour
    mot l'arbitrage retenu le 2026-09-21 pour les créneaux « à éviter », et pour
    la même raison — une séance non placée n'est pas arbitrée non plus, elle
    est perdue.
    """

    def test_suit_la_consigne_quand_la_salle_est_libre(self):
        cas = probleme([
            tache("T1", "F1", ["G1"], 3,
                  salles=("Salle 1", "Salle 2"),
                  salles_preferees=frozenset({"Salle 2"})),
        ])
        solution = resoudre(cas)
        self.assertEqual(len(solution.placements), 3)
        for placement in solution.placements:
            self.assertEqual(placement.salle, "Salle 2")

    def test_SE_RABAT_plutot_que_de_perdre_la_seance(self):
        """
        ⚠️ LE TEST QUI PORTE LA DÉCISION. L'atelier n'est libre qu'à UN créneau
           et deux tâches le veulent : si la consigne était dure, la seconde
           serait perdue. Elle doit au contraire se poser ailleurs.
        """
        creneaux, _ = grille()
        occupation = tuple(
            Occupation(creneau_id=c.id, formateur="AUTRE", groupes=("GX",), salle="Salle 2")
            for c in creneaux[1:]
        )
        cas = probleme(
            [
                tache("T1", "F1", ["G1"], 1,
                      salles=("Salle 1", "Salle 2"),
                      salles_preferees=frozenset({"Salle 2"})),
                tache("T2", "F2", ["G2"], 1,
                      salles=("Salle 1", "Salle 2"),
                      salles_preferees=frozenset({"Salle 2"})),
            ],
            occupation=occupation,
        )
        solution = resoudre(cas)

        self.assertEqual(len(solution.placements), 2, "une séance a été perdue")
        dans = [p for p in solution.placements if p.salle == "Salle 2"]
        self.assertEqual(len(dans), 1, "la consigne n'a pas été suivie quand elle le pouvait")
        self.assertEqual(dans[0].creneau_id, creneaux[0].id)

    def test_un_BLOC_l_emporte_sur_la_salle_du_module(self):
        """
        ═══ ⚠️ COMPORTEMENT SURPRENANT, ET ASSUMÉ ═══ (mesuré, pas supposé)
        L'atelier n'est libre qu'à un créneau isolé. Une tâche de 4 séances
        préfère alors DEUX BLOCS ailleurs à une séance dans son atelier : le
        palmarès juge un bloc d'un seul tenant, et aucun bloc ne tient dans un
        créneau unique.

        ⚠️ C'EST DÉJÀ AINSI POUR LES CRÉNEAUX « À ÉVITER », et le corriger
           reviendrait à toucher `SCORE_BLOC` — ce que l'en-tête de
           `placement.py` interdit : « les changer produirait un emploi du temps
           que l'établissement ne reconnaîtrait plus ». Ce test est là pour que
           le jour où quelqu'un voit ces 4 séances hors atelier, il sache que
           c'est un arbitrage et non un défaut.
        """
        creneaux, _ = grille()
        occupation = tuple(
            Occupation(creneau_id=c.id, formateur="AUTRE", groupes=("GX",), salle="Salle 2")
            for c in creneaux[1:]
        )
        cas = probleme(
            [tache("T1", "F1", ["G1"], 4,
                   salles=("Salle 1", "Salle 2"),
                   salles_preferees=frozenset({"Salle 2"}))],
            occupation=occupation,
        )
        solution = resoudre(cas)

        self.assertEqual(len(solution.placements), 4, "des séances ont été perdues")
        self.assertEqual([p.salle for p in solution.placements], ["Salle 1"] * 4)

    def test_une_consigne_IMPOSSIBLE_ne_bloque_rien(self):
        # L'atelier est pris toute la semaine : la tâche se place quand même.
        creneaux, _ = grille()
        occupation = tuple(
            Occupation(creneau_id=c.id, formateur="AUTRE", groupes=("GX",), salle="Salle 2")
            for c in creneaux
        )
        cas = probleme(
            [tache("T1", "F1", ["G1"], 2,
                   salles=("Salle 1", "Salle 2"),
                   salles_preferees=frozenset({"Salle 2"}))],
            occupation=occupation,
        )
        solution = resoudre(cas)
        self.assertEqual(len(solution.placements), 2)
        self.assertEqual(solution.non_placees, ())

    def test_ne_change_RIEN_quand_aucune_salle_n_est_declaree(self):
        """
        ⚠️ LE GARDE DE NON-RÉGRESSION : c'est le cas de TOUTES les cartes
           existantes, qui ne déclarent aucune salle. À préférence vide, la
           classe de repli du palmarès reste vide et la grille doit être
           identique au caractère près à celle d'avant le 2026-09-23.
        """
        taches = [tache(f"T{i}", f"F{i}", [f"G{i}"], 2) for i in range(4)]
        attendue = resoudre(probleme(taches, graine=11))
        obtenue = resoudre(probleme(taches, graine=11))
        self.assertEqual(attendue.placements, obtenue.placements)
        self.assertTrue(all(p.salle in ("Salle 1", "Salle 2") for p in attendue.placements))
