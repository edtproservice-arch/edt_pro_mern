"""
Recherche complète (CP-SAT) et arbitrage entre moteurs — F6 · étape e.

⚠️ CE QUE CES TESTS DOIVENT ATTRAPER. Sans typage statique, ce sont les seuls
   garde-fous (§5bis, règle 4). Deux familles distinctes :

   1. les INVARIANTS — une grille de CP-SAT ne viole jamais plus de règles que
      celle du glouton. Ils sont vérifiés par `verifier_invariants`, la MÊME
      fonction que pour le glouton : une seconde définition finirait par juger
      les deux moteurs différemment.
   2. la NON-RÉGRESSION — `choix.resoudre` ne rend JAMAIS moins de séances que
      le glouton seul. C'est la garantie sur laquelle repose la décision
      « multi-fil + repli » du 2026-09-21 : sans elle, activer CP-SAT pourrait
      coûter des séances (mesuré : sur la S2 réelle il en place 150 contre 153).
"""

import random
import unittest
from unittest import mock
from dataclasses import replace

from generateur import choix, solveur
from generateur.contrat import MOTEUR, MOTEUR_CPSAT, Occupation
from .test_solveur import grille, probleme, tache, verifier_invariants

#: ⚠️ COURT À DESSEIN. CP-SAT épuise son budget dès qu'il ne prouve pas
#:    l'optimalité ; à 20 s (le défaut de production) cette suite durerait des
#:    heures. Les cas sont petits, 2 s y suffisent largement.
BUDGET = 2000


def cpsat(cas):
    from generateur import cpsat as moteur

    return moteur.resoudre(replace(cas, budget_ms=BUDGET))


def cas_aleatoire(rng):
    """Un problème saturé : plus de séances demandées que de place évidente."""
    taches = []
    for i in range(rng.randint(3, 7)):
        taches.append(
            tache(
                f"t{i}",
                f"F{rng.randint(1, 3)}",
                tuple({f"G{rng.randint(1, 3)}" for _ in range(rng.randint(1, 2))}),
                rng.randint(1, 4),
            )
        )
    incompatibilites = {}
    if rng.random() < 0.4:
        # Un groupe FQ et ses constituants : la structure BIPARTIE qui avait
        # fait sur-contraindre le modèle (S38, « optimal » à 103 pour 104).
        incompatibilites = {
            "FQ": frozenset({"G1", "G2"}),
            "G1": frozenset({"FQ"}),
            "G2": frozenset({"FQ"}),
        }
        taches.append(tache("tfq", "F4", ("FQ",), rng.randint(1, 3)))
    return probleme(taches, graine=rng.randint(1, 10**6), incompatibilites=incompatibilites)


class TestInvariants(unittest.TestCase):
    def test_cpsat_ne_viole_jamais_une_regle(self):
        rng = random.Random(7)
        for essai in range(40):
            cas = cas_aleatoire(rng)
            with self.subTest(essai=essai):
                verifier_invariants(cas, cpsat(cas), self)

    def test_deux_constituants_d_un_fq_peuvent_avoir_cours_ensemble(self):
        """
        ⚠️ LE DÉFAUT DU 2026-09-21, FIGÉ. Le modèle indexait sa ressource sur
           les groupes ÉTENDUS : deux tâches sur G1 et G2 se croisaient sur leur
           parent « FQ » et devenaient incompatibles — alors que ce sont deux
           classes distinctes. Il « prouvait » alors des optima inférieurs à ce
           que le glouton atteignait.
        """
        cas = probleme(
            [tache("a", "F1", ("G1",), 4), tache("b", "F2", ("G2",), 4)],
            incompatibilites={"FQ": frozenset({"G1", "G2"}),
                              "G1": frozenset({"FQ"}), "G2": frozenset({"FQ"})},
        )
        solution = cpsat(cas)
        verifier_invariants(cas, solution, self)
        self.assertEqual(
            len(solution.placements), 8,
            "G1 et G2 ne se gênent pas : les 8 séances doivent tenir",
        )

    def test_un_fq_bloque_bien_ses_constituants(self):
        """La contre-épreuve : le croisement réel, lui, doit être respecté."""
        cas = probleme(
            [tache("fq", "F1", ("FQ",), 12), tache("g", "F2", ("G1",), 12)],
            incompatibilites={"FQ": frozenset({"G1"}), "G1": frozenset({"FQ"})},
        )
        solution = cpsat(cas)
        verifier_invariants(cas, solution, self)
        self.assertLessEqual(
            len(solution.placements), 12,
            "12 créneaux, et les deux tâches ne peuvent jamais les partager",
        )


class TestNonRegression(unittest.TestCase):
    def test_le_repli_sauve_une_grille_que_cpsat_rend_vide(self):
        """
        ⚠️⚠️ LE CAS QUI JUSTIFIE TOUT LE REPLI, ET IL N'EST PAS THÉORIQUE.
           Au budget de 5 s retenu d'abord, CP-SAT rendait `UNKNOWN` — donc
           ZÉRO séance — sur les 37 semaines réelles d'un établissement.

        ⚠️ ON SIMULE CETTE SORTIE, ON NE LA PROVOQUE PAS PAR UN BUDGET COURT.
           Une première version donnait 50 ms à CP-SAT sur un gros problème :
           elle passait seule et échouait dans la suite complète, le résultat
           dépendant de la charge de la machine. Un test d'ARBITRAGE doit juger
           l'arbitrage, jamais la vitesse du solveur.

        ⚠️ SANS CE TEST, `TestNonRegression` NE PROUVAIT RIEN : vérifié par
           mutation le 2026-09-21 — désactiver le repli ne faisait alors tomber
           aucun test, car CP-SAT ne régresse jamais sur de petits cas.
        """
        cas = replace(probleme([tache("t", "F", ("G",), 20)]), moteur=MOTEUR_CPSAT)
        base = solveur.resoudre(cas)
        self.assertGreater(len(base.placements), 0, "le glouton doit placer quelque chose")
        self.assertTrue(base.non_placees, "il doit rester à gagner, sinon CP-SAT n'est pas lancé")

        vide = replace(base, placements=(), rapport={**base.rapport, "seancesPlacees": 0})
        with mock.patch("generateur.cpsat.resoudre", return_value=vide):
            retenu = choix.resoudre(cas)

        self.assertEqual(
            len(retenu.placements), len(base.placements),
            "le repli doit rendre la grille du glouton, jamais une grille vide",
        )
        self.assertEqual(retenu.rapport["moteur"], MOTEUR)
        self.assertEqual(retenu.rapport["repli"], choix.PAS_MIEUX)
        verifier_invariants(cas, retenu, self)

    def test_une_panne_du_solveur_ne_perd_pas_la_grille(self):
        """OR-Tools peut lever ; on rend le glouton, et on DIT pourquoi."""
        cas = replace(probleme([tache("t", "F", ("G",), 20)]), moteur=MOTEUR_CPSAT)
        with mock.patch("generateur.cpsat.resoudre", side_effect=RuntimeError("boum")):
            retenu = choix.resoudre(cas)
        self.assertEqual(retenu.rapport["repli"], choix.ERREUR_SOLVEUR)
        self.assertGreater(len(retenu.placements), 0)
        self.assertIn("boum", retenu.rapport["erreurCpsat"])

    def test_choix_ne_fait_jamais_moins_bien_que_le_glouton(self):
        rng = random.Random(11)
        for essai in range(25):
            cas = replace(cas_aleatoire(rng), moteur=MOTEUR_CPSAT, budget_ms=BUDGET)
            with self.subTest(essai=essai):
                seul = solveur.resoudre(cas)
                retenu = choix.resoudre(cas)
                self.assertGreaterEqual(
                    len(retenu.placements), len(seul.placements),
                    "le repli doit empêcher toute régression",
                )
                verifier_invariants(cas, retenu, self)


class TestArbitrage(unittest.TestCase):
    def test_sans_demande_le_glouton_suffit(self):
        cas = probleme([tache("t", "F", ("G",), 2)])
        rapport = choix.resoudre(cas).rapport
        self.assertEqual(rapport["moteur"], MOTEUR)
        self.assertEqual(rapport["repli"], choix.NON_DEMANDE)

    def test_rien_a_gagner_quand_tout_est_place(self):
        """⚠️ CP-SAT ne doit même pas être lancé : 18 semaines sur 38 sont dans
        ce cas, et l'y lancer coûterait ~9 minutes par année pour rien."""
        cas = replace(probleme([tache("t", "F", ("G",), 2)]), moteur=MOTEUR_CPSAT)
        rapport = choix.resoudre(cas).rapport
        self.assertEqual(rapport["repli"], choix.RIEN_A_GAGNER)
        self.assertEqual(rapport["moteur"], MOTEUR)

    def test_le_moteur_retenu_est_toujours_nomme(self):
        for demande in (MOTEUR, MOTEUR_CPSAT):
            cas = replace(cas_aleatoire(random.Random(3)),
                          moteur=demande, budget_ms=BUDGET)
            with self.subTest(moteur=demande):
                rapport = choix.resoudre(cas).rapport
                self.assertIn(rapport["moteur"], (MOTEUR, MOTEUR_CPSAT))
                self.assertEqual(rapport["moteurDemande"], demande)


if __name__ == "__main__":
    unittest.main()


class TestSallesDuModule(unittest.TestCase):
    """
    CP-SAT doit rendre la MÊME lecture que le glouton sur la salle du module
    (2026-09-23) : sinon le nombre de séances hors salle affiché au directeur
    dépendrait du moteur retenu — que `choix.py` fait varier d'une semaine à
    l'autre. C'est pourquoi `hors_salle` vit dans `contrat.py`, pas dans un
    moteur.
    """

    def test_suit_la_consigne_quand_la_salle_est_libre(self):
        """
        ⚠️ LES DEUX SALLES SONT ÉPROUVÉES TOUR À TOUR, et ce n'est pas du zèle :
           n'en vérifier qu'une laissait passer la suppression pure et simple de
           la pénalité — mesuré. Sans elle, CP-SAT choisit « Salle 2 » de
           lui-même, par ordre de variables, et le test restait vert sur un
           moteur qui ignorait complètement la consigne. La propriété qui a du
           pouvoir de détection est « QUELLE QUE SOIT la salle préférée, c'est
           celle-là » — jamais « c'est Salle 2 ».
        """
        for preferee in ("Salle 1", "Salle 2"):
            with self.subTest(preferee=preferee):
                cas = probleme([
                    tache("T1", "F1", ["G1"], 3,
                          salles=("Salle 1", "Salle 2"),
                          salles_preferees=frozenset({preferee})),
                ])
                solution = cpsat(cas)
                self.assertEqual(len(solution.placements), 3)
                for placement in solution.placements:
                    self.assertEqual(placement.salle, preferee)

    def test_la_penalite_CEDE_devant_une_seance_non_placee(self):
        """
        ⚠️ LA HIÉRARCHIE DE L'EN-TÊTE, VÉRIFIÉE : `PENALITE_HORS_SALLE` (500)
           doit rester sous le plus petit gain de placement (1 000). Relever la
           pénalité au-dessus ferait préférer une grille incomplète — et ce test
           est le seul endroit où cette inversion se verrait.
        """
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
        solution = cpsat(cas)
        self.assertEqual(len(solution.placements), 2, "la consigne a fait perdre des séances")
        self.assertTrue(all(p.salle == "Salle 1" for p in solution.placements))
