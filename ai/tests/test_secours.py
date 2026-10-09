"""
Créneaux de secours et période (2026-10-09, cours du soir).

Un créneau de secours ne sert qu'à défaut de mieux, sans être une consigne du
formateur : la séance n'est donc pas « déconseillée ». La période, elle, ne
sert qu'au diagnostic.
"""

import unittest
from dataclasses import replace

from generateur.contrat import Creneau
from generateur.solveur import resoudre

from .test_solveur import probleme, tache


class CreneauxDeSecours(unittest.TestCase):
    def test_evite_le_secours_tant_qu_il_a_mieux(self):
        # Lundi = secours, Mardi et Mercredi libres : rien ne doit aller le lundi.
        cas = probleme([tache("T", "F1", ["G1"], 4, creneaux_secours=frozenset(range(4)))])
        solution = resoudre(cas)
        self.assertEqual(len(solution.placements), 4)
        self.assertTrue(all(p.creneau_id >= 4 for p in solution.placements))

    def test_emploie_le_secours_plutot_que_de_ne_pas_placer(self):
        # Tout est secours sauf le lundi : 12 séances demandent la semaine entière.
        secours = frozenset(range(4, 12))
        cas = probleme([tache("T", "F1", ["G1"], 12, creneaux_secours=secours)])
        solution = resoudre(cas)
        self.assertEqual(len(solution.placements), 12)
        self.assertEqual(solution.non_placees, ())

    def test_un_secours_n_est_pas_deconseille(self):
        cas = probleme(
            [tache("T", "F1", ["G1"], 12, creneaux_secours=frozenset(range(12)))]
        )
        self.assertFalse(any(p.deconseille for p in resoudre(cas).placements))


class PeriodeDansLeDiagnostic(unittest.TestCase):
    def test_une_seance_du_soir_n_est_pas_expliquee_par_le_jour(self):
        base = probleme([])
        soirs = tuple(
            Creneau(id=100 + i, jour=jour, rang=5, duree=2, periode="soir")
            for i, jour in enumerate(("Lundi", "Mardi"))
        )
        jour = frozenset(c.id for c in base.creneaux)
        # Deux soirées pour trois séances : la troisième manque, faute de SOIRÉE.
        cas = replace(
            base,
            creneaux=base.creneaux + soirs,
            taches=(
                tache("T", "F1", ["G1"], 3, periode="soir", creneaux_interdits=jour),
            ),
        )
        solution = resoudre(cas)
        self.assertEqual(len(solution.placements), 2)
        (non,) = solution.non_placees
        self.assertEqual(non.creneaux_examines, 2)
        self.assertNotEqual(non.cause, "creneau_interdit")


if __name__ == "__main__":
    unittest.main()
