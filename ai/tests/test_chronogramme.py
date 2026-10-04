"""
La répartition du chronogramme respecte-t-elle ce qu'on lui demande ?

Les règles métier (priorités, cibles, réductions) sont calculées par Node et
testées côté JS : ici on vérifie que le solveur EN FAIT BON USAGE — priorité
servie d'abord, cible visée, plafonds jamais dépassés, échéances tenues.
"""

import json
import random
import subprocess
import sys
import unittest
from collections import defaultdict
from pathlib import Path

from generateur.chronogramme import lire_probleme_chronogramme, resoudre_chronogramme
from generateur.contrat import ProblemeInvalide

SEMAINES = list(range(1, 11))


def par_semaine(valeur, semaines=SEMAINES):
    return {str(s): valeur for s in semaines}


def probleme(taches, *, formateurs=None, groupes=None, cellules=None, semaines=SEMAINES):
    noms_groupes = sorted({g for t in taches for g in t["groupes"]})
    noms_cellules = sorted({c for t in taches for c in t["cellules"]})
    noms_formateurs = sorted({t["formateur"] for t in taches})
    return {
        "pas": 2.5,
        "semaines": semaines,
        "formateurs": formateurs
        or [{"id": f, "cibles": par_semaine(25, semaines)} for f in noms_formateurs],
        "groupes": groupes
        or [
            {"id": g, "plafondsSouples": par_semaine(30, semaines), "plafondsDurs": par_semaine(60, semaines)}
            for g in noms_groupes
        ],
        "cellules": cellules
        or [{"id": c, "plafonds": par_semaine(20, semaines)} for c in noms_cellules],
        "taches": taches,
    }


def tache(identifiant, heures, *, formateur="F1", groupe="G1", priorite=1, semaines=SEMAINES, plafond=20):
    return {
        "id": identifiant,
        "formateur": formateur,
        "groupes": [groupe],
        "cellules": [f"{groupe}||{identifiant}"],
        "priorite": priorite,
        "lots": [{"heures": heures, "plafonds": par_semaine(plafond, semaines)}],
    }


def resoudre(charge):
    return resoudre_chronogramme(lire_probleme_chronogramme(charge))


def par_tache(solution):
    sortie = defaultdict(dict)
    for pose in solution.poses:
        sortie[pose.tache_id][pose.semaine] = pose.heures
    return sortie


def par_formateur(solution, charge):
    formateur_de = {t["id"]: t["formateur"] for t in charge["taches"]}
    sortie = defaultdict(lambda: defaultdict(float))
    for pose in solution.poses:
        sortie[formateur_de[pose.tache_id]][pose.semaine] += pose.heures
    return sortie


class TestLecture(unittest.TestCase):
    def test_refuse_une_cle_inconnue(self):
        charge = probleme([tache("M1", 10)])
        charge["taches"][0]["priorité"] = 1
        with self.assertRaises(ProblemeInvalide):
            lire_probleme_chronogramme(charge)

    def test_refuse_une_semaine_hors_liste(self):
        charge = probleme([tache("M1", 10)])
        charge["taches"][0]["lots"][0]["plafonds"]["99"] = 20
        with self.assertRaisesRegex(ProblemeInvalide, "semaine 99"):
            lire_probleme_chronogramme(charge)

    def test_refuse_un_formateur_inconnu(self):
        charge = probleme([tache("M1", 10)])
        charge["taches"][0]["formateur"] = "FANTOME"
        with self.assertRaisesRegex(ProblemeInvalide, "FANTOME"):
            lire_probleme_chronogramme(charge)

    def test_refuse_un_plafond_souple_au_dessus_du_dur(self):
        charge = probleme([tache("M1", 10)])
        charge["groupes"][0]["plafondsSouples"]["1"] = 70
        with self.assertRaisesRegex(ProblemeInvalide, "plafond souple"):
            lire_probleme_chronogramme(charge)


class TestRepartition(unittest.TestCase):
    def test_pose_toute_la_masse(self):
        solution = resoudre(probleme([tache("M1", 60)]))
        self.assertEqual(sum(p.heures for p in solution.poses), 60)
        self.assertEqual(solution.non_poses, ())

    def test_la_priorite_est_servie_d_abord(self):
        # Cible 25 h, plafond de case 20 h : le module prioritaire prend 20 h
        # chaque semaine, l'autre le complément.
        charge = probleme([tache("NORMAL", 40, priorite=4), tache("REGIONAL", 40, priorite=1)])
        poses = par_tache(resoudre(charge))
        self.assertEqual(poses["REGIONAL"][1], 20)
        self.assertEqual(poses["NORMAL"][1], 5)
        self.assertEqual(max(poses["REGIONAL"]), 2, "le régional finit en deux semaines")

    def test_la_cible_hebdomadaire_est_visee(self):
        # 250 h pour 10 semaines à 25 h : la cible tombe juste, sans retard.
        charge = probleme([tache(f"M{i}", 62.5, priorite=i) for i in range(1, 5)])
        charges = par_formateur(resoudre(charge), charge)["F1"]
        for semaine in SEMAINES:
            self.assertAlmostEqual(charges[semaine], 25, msg=f"semaine {semaine}")

    def test_une_cible_fractionnaire_est_tenue_en_moyenne(self):
        # 26,3 h ne se pose pas par pas de 2,5 h : la moyenne doit y revenir
        # au lieu de s'arrondir toujours dans le même sens.
        charge = probleme(
            [tache("M1", 100, priorite=1), tache("M2", 100, priorite=2), tache("M3", 62.5, priorite=3)],
            formateurs=[{"id": "F1", "cibles": par_semaine(26.3)}],
        )
        charges = par_formateur(resoudre(charge), charge)["F1"]
        moyenne = sum(charges[s] for s in SEMAINES) / len(SEMAINES)
        self.assertLess(abs(moyenne - 26.3), 1.0)
        self.assertEqual(sum(charges.values()), 262.5)
        # La dernière semaine prend le reliquat : une fin plus légère est admise.
        for semaine in SEMAINES[:-1]:
            self.assertIn(charges[semaine], (25.0, 27.5))

    def test_une_cible_reduite_est_respectee(self):
        cibles = par_semaine(25)
        cibles["3"] = 15  # deux jours fériés
        charge = probleme(
            [tache(f"M{i}", 60, priorite=i) for i in range(1, 4)],
            formateurs=[{"id": "F1", "cibles": cibles}],
        )
        charges = par_formateur(resoudre(charge), charge)["F1"]
        self.assertEqual(charges[3], 15)

    def test_une_cible_nulle_ne_recoit_rien_hors_urgence(self):
        cibles = par_semaine(25)
        cibles["2"] = 0
        charge = probleme([tache("M1", 50)], formateurs=[{"id": "F1", "cibles": cibles}])
        self.assertNotIn(2, par_tache(resoudre(charge))["M1"])

    def test_la_fenetre_est_respectee(self):
        # Un lot de S2 ne pose rien avant sa fenêtre.
        charge = probleme([tache("S2", 40, semaines=[6, 7, 8, 9, 10])])
        poses = par_tache(resoudre(charge))["S2"]
        self.assertTrue(all(s >= 6 for s in poses))

    def test_la_cible_n_est_jamais_depassee_de_plus_d_un_pas(self):
        # 2026-10-04, retour du porteur : 120 h à poser en 4 semaines pour une
        # cible de 25 h ne donne PAS 30 h par semaine — on pose ce qui tient,
        # et le reste est signalé.
        charge = probleme([tache(f"M{i}", 40, priorite=1, semaines=[1, 2, 3, 4]) for i in range(3)])
        solution = resoudre(charge)
        charges = par_formateur(solution, charge)["F1"]
        self.assertTrue(all(h <= 27.5 for h in charges.values()), dict(charges))
        self.assertTrue(solution.non_poses)
        self.assertEqual({n.cause for n in solution.non_poses}, {"cible_formateur"})

    def test_un_lot_en_retard_deborde_apres_son_echeance(self):
        # Échéance en S4, mais 150 h pour une cible de 25 h : le surplus
        # continue après S4 au lieu de surcharger S1-S4.
        lot = tache("S1", 150)
        lot["lots"][0]["echeance"] = 4
        solution = resoudre(probleme([lot]))
        poses = par_tache(solution)["S1"]
        self.assertTrue(all(h <= 25 for h in poses.values()))
        self.assertEqual(sum(poses.values()), 150)
        self.assertGreater(solution.rapport["heuresApresEcheance"], 0)

    def test_le_retard_passe_devant_la_priorite(self):
        # Après S4, le reste du lot en retard est servi avant un lot pourtant
        # plus prioritaire, ouvert à partir de S5.
        retard = tache("RETARD", 150, priorite=6)
        retard["lots"][0]["echeance"] = 4
        suivant = tache("SUIVANT", 100, priorite=1, semaines=[5, 6, 7, 8, 9, 10])
        poses = par_tache(resoudre(probleme([retard, suivant])))
        self.assertEqual(poses["RETARD"][5], 20)
        self.assertLessEqual(poses["SUIVANT"][5], 7.5)

    def test_le_rythme_ne_gagne_qu_un_pas(self):
        # En retard sur l'année, le formateur monte d'un pas au plus.
        charge = probleme([tache(f"M{i}", 100, priorite=i) for i in range(1, 5)])
        charges = par_formateur(resoudre(charge), charge)["F1"]
        self.assertTrue(all(h <= 27.5 for h in charges.values()))
        self.assertGreater(sum(charges.values()), 250, "le retard est rattrapé autant que permis")

    def test_le_plafond_de_case_est_partage(self):
        # Même case pour le présentiel de F1 et le synchrone de F2.
        taches = [
            {**tache("P", 100, formateur="F1"), "cellules": ["G1||M1"]},
            {**tache("S", 100, formateur="F2"), "cellules": ["G1||M1"]},
        ]
        solution = resoudre(probleme(taches))
        total = defaultdict(float)
        for pose in solution.poses:
            total[pose.semaine] += pose.heures
        self.assertTrue(all(h <= 20 for h in total.values()))

    def test_le_plafond_souple_du_groupe_est_respecte(self):
        # 3 × 60 h sur 10 semaines : aucune échéance n'oblige à franchir 30 h.
        taches = [tache(f"M{i}", 60, formateur=f"F{i}", priorite=i) for i in range(1, 4)]
        solution = resoudre(probleme(taches))
        total = defaultdict(float)
        for pose in solution.poses:
            total[pose.semaine] += pose.heures
        self.assertTrue(all(h <= 30 for h in total.values()))

    def test_une_seance_mutualisee_pese_sur_chaque_groupe(self):
        commune = {
            "id": "SYNC",
            "formateur": "F1",
            "groupes": ["G1", "G2"],
            "cellules": ["G1||M1", "G2||M1"],
            "priorite": 1,
            "lots": [{"heures": 40, "plafonds": par_semaine(20)}],
        }
        charge = probleme([commune])
        charge["groupes"][1]["plafondsSouples"] = par_semaine(5)
        poses = par_tache(resoudre(charge))["SYNC"]
        self.assertTrue(all(h <= 5 for h in poses.values()), "le groupe le plus chargé borne la séance")

    def test_les_charges_existantes_comptent(self):
        charge = probleme(
            [tache("M1", 100)],
            formateurs=[{"id": "F1", "cibles": par_semaine(25), "charges": {"1": 20}}],
        )
        self.assertEqual(par_tache(resoudre(charge))["M1"][1], 5)


class TestNonPoses(unittest.TestCase):
    def test_fenetre_fermee(self):
        charge = probleme([tache("M1", 20)])
        charge["taches"][0]["lots"][0]["plafonds"] = {}
        (non_pose,) = resoudre(charge).non_poses
        self.assertEqual((non_pose.cause, non_pose.heures), ("fenetre_fermee", 20))

    def test_fenetre_trop_courte(self):
        charge = probleme([tache("M1", 50, semaines=[1, 2], plafond=10)])
        (non_pose,) = resoudre(charge).non_poses
        self.assertEqual((non_pose.cause, non_pose.heures), ("fenetre_trop_courte", 30))

    def test_reliquat_hors_pas(self):
        (non_pose,) = resoudre(probleme([tache("M1", 52)])).non_poses
        self.assertEqual((non_pose.cause, non_pose.heures), ("hors_pas", 2))


class TestInvariants(unittest.TestCase):
    """Problèmes tirés au hasard : aucun plafond dur n'est jamais franchi."""

    def test_problemes_aleatoires(self):
        for graine in range(150):
            with self.subTest(graine=graine):
                tirage = random.Random(graine)
                semaines = list(range(1, 21))
                taches = []
                for i in range(tirage.randint(1, 12)):
                    debut = tirage.randint(1, 15)
                    fenetre = [s for s in semaines if s >= debut and tirage.random() > 0.15]
                    taches.append(
                        tache(
                            f"T{i}",
                            tirage.choice([20, 45, 60, 90, 120]),
                            formateur=f"F{tirage.randint(1, 3)}",
                            groupe=f"G{tirage.randint(1, 3)}",
                            priorite=tirage.randint(1, 6),
                            semaines=fenetre,
                            plafond=tirage.choice([10, 20]),
                        )
                    )
                charge = probleme(taches, semaines=semaines)
                solution = resoudre(charge)

                demande = {t["id"]: t["lots"][0]["heures"] for t in charge["taches"]}
                obtenu = defaultdict(float)
                groupe = defaultdict(float)
                for pose in solution.poses:
                    t = next(x for x in charge["taches"] if x["id"] == pose.tache_id)
                    plafond = t["lots"][0]["plafonds"].get(str(pose.semaine), 0)
                    self.assertLessEqual(pose.heures, plafond)
                    self.assertEqual(pose.heures % 2.5, 0)
                    obtenu[pose.tache_id] += pose.heures
                    groupe[(t["groupes"][0], pose.semaine)] += pose.heures
                for (_, _), heures in groupe.items():
                    self.assertLessEqual(heures, 60)
                for formateur, semaines in par_formateur(solution, charge).items():
                    for semaine, heures in semaines.items():
                        self.assertLessEqual(heures, 25 + 2.5, f"{formateur} S{semaine}")
                manquant = defaultdict(float)
                for non_pose in solution.non_poses:
                    manquant[non_pose.tache_id] += non_pose.heures
                for identifiant, heures in demande.items():
                    self.assertAlmostEqual(obtenu[identifiant] + manquant[identifiant], heures)


class TestCli(unittest.TestCase):
    def test_aller_retour_en_sous_processus(self):
        charge = probleme([tache("M1", 20)])
        resultat = subprocess.run(
            [sys.executable, "-m", "generateur.chronogramme"],
            input=json.dumps(charge),
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=Path(__file__).resolve().parent.parent,
        )
        self.assertEqual(resultat.returncode, 0, resultat.stderr)
        sortie = json.loads(resultat.stdout)
        self.assertEqual(sum(p["heures"] for p in sortie["poses"]), 20)
        self.assertEqual(sortie["rapport"]["moteur"], "chronogramme-glouton")

    def test_un_probleme_refuse_sort_en_1(self):
        resultat = subprocess.run(
            [sys.executable, "-m", "generateur.chronogramme"],
            input="{}",
            capture_output=True,
            text=True,
            cwd=Path(__file__).resolve().parent.parent,
        )
        self.assertEqual(resultat.returncode, 1)


if __name__ == "__main__":
    unittest.main()


class TestEncadrement(unittest.TestCase):
    """Une tâche encadrée tombe strictement entre la première et la dernière
    semaine de ses encadrantes (le synchrone d'un module, pour Node)."""

    def module(self, formateur_s="F2", heures_p=60, heures_s=20):
        p = {**tache("P", heures_p, formateur="F1"), "cellules": ["G1||M1"]}
        s = {**tache("S", heures_s, formateur=formateur_s), "cellules": ["G1||M1"], "encadreePar": ["P"]}
        return probleme([p, s])

    def verifier(self, charge):
        solution = resoudre(charge)
        poses = par_tache(solution)
        self.assertEqual(solution.non_poses, ())
        debut, fin = min(poses["P"]), max(poses["P"])
        for semaine in poses["S"]:
            self.assertGreater(semaine, debut, "pas de synchrone la première semaine")
            self.assertLess(semaine, fin, "pas de synchrone la dernière semaine")
        return poses

    def test_ni_au_debut_ni_a_la_fin(self):
        self.verifier(self.module())

    def test_meme_formateur(self):
        self.verifier(self.module(formateur_s="F1"))

    def test_le_presentiel_garde_un_pas_pour_finir_apres(self):
        # Le présentiel irait plus vite que le synchrone : il garde sa
        # dernière séance pour après.
        poses = self.verifier(self.module(heures_p=20, heures_s=40))
        self.assertGreater(max(poses["P"]), max(poses["S"]))

    def test_sans_encadrante_aucune_contrainte(self):
        charge = probleme([tache("S", 20)])
        self.assertIn(1, par_tache(resoudre(charge))["S"])

    def test_refuse_une_encadrante_inconnue(self):
        charge = self.module()
        charge["taches"][1]["encadreePar"] = ["FANTOME"]
        with self.assertRaisesRegex(ProblemeInvalide, "FANTOME"):
            lire_probleme_chronogramme(charge)

    def test_sans_presentiel_posable_le_synchrone_est_signale(self):
        charge = self.module()
        charge["taches"][0]["lots"][0]["plafonds"] = {}
        causes = {n.tache_id: n.cause for n in resoudre(charge).non_poses}
        self.assertEqual(causes["S"], "encadrement")


class TestContinuite(unittest.TestCase):
    """Un module commencé ne s'interrompt pas tant qu'il est ouvert."""

    @staticmethod
    def contigues(semaines):
        rangs = sorted(semaines)
        return rangs == list(range(rangs[0], rangs[-1] + 1))

    def test_un_module_prioritaire_qui_s_ouvre_n_interrompt_pas_l_autre(self):
        # M_BAS avance depuis S1 ; M_HAUT, prioritaire, s'ouvre en S3 et
        # voudrait tout le budget. M_BAS garde au moins un créneau.
        bas = tache("M_BAS", 60, priorite=6, plafond=10)
        haut = tache("M_HAUT", 40, priorite=1, semaines=[3, 4, 5, 6], plafond=20)
        charge = probleme([bas, haut], formateurs=[{"id": "F1", "cibles": par_semaine(20)}])
        poses = par_tache(resoudre(charge))
        self.assertTrue(self.contigues(poses["M_BAS"]), sorted(poses["M_BAS"]))
        self.assertEqual(sum(poses["M_HAUT"].values()), 40)

    def test_a_priorite_egale_on_termine_avant_d_ouvrir(self):
        # Trois modules de même priorité, budget pour un seul à la fois :
        # chacun se déroule d'un bloc, sans être entamé puis abandonné.
        taches = [tache(f"M{i}", 30, priorite=4, plafond=10) for i in range(3)]
        charge = probleme(taches, formateurs=[{"id": "F1", "cibles": par_semaine(10)}])
        poses = par_tache(resoudre(charge))
        for identifiant in ("M0", "M1", "M2"):
            self.assertTrue(self.contigues(poses[identifiant]), (identifiant, sorted(poses[identifiant])))


class TestSansCreux(unittest.TestCase):
    """Retour du porteur (2026-10-04) : un présentiel arrêté trente semaines en
    attendant le synchrone partagé avec d'autres groupes."""

    def test_synchrone_partage_les_presentiels_ne_s_interrompent_pas(self):
        semaines = list(range(1, 21))

        def t(id_, h, groupes, prio, cellules, formateur="F1", encadree=None):
            d = {"id": id_, "formateur": formateur, "groupes": groupes, "cellules": cellules,
                 "priorite": prio, "lots": [{"heures": h, "plafonds": par_semaine(10, semaines)}]}
            if encadree:
                d["encadreePar"] = encadree
            return d

        taches = [
            t("P1", 30, ["G1"], 1, ["G1||M"]),
            t("P2", 30, ["G2"], 6, ["G2||M"]),
            t("AUTRE", 200, ["G3"], 2, ["G3||X"]),
            t("S", 15, ["G1", "G2"], 1, ["G1||M", "G2||M"], formateur="F2", encadree=["P1", "P2"]),
        ]
        charge = probleme(
            taches,
            semaines=semaines,
            formateurs=[{"id": "F1", "cibles": par_semaine(20, semaines)},
                        {"id": "F2", "cibles": par_semaine(20, semaines)}],
        )
        solution = resoudre(charge)
        poses = par_tache(solution)
        self.assertEqual(solution.non_poses, ())
        for presentiel in ("P1", "P2"):
            rangs = sorted(poses[presentiel])
            self.assertEqual(rangs, list(range(rangs[0], rangs[-1] + 1)), (presentiel, rangs))
            self.assertLess(min(poses[presentiel]), min(poses["S"]))
            self.assertGreater(max(poses[presentiel]), max(poses["S"]))


    def test_les_presentiels_d_un_synchrone_partage_demarrent_ensemble(self):
        # Formateur chargé : sans démarrage commun, P2 (priorité 6) attendrait
        # la fin d'AUTRE — et le synchrone partagé, P2.
        semaines = list(range(1, 31))

        def t(id_, h, groupes, prio, cellules, formateur="F1", encadree=None):
            d = {"id": id_, "formateur": formateur, "groupes": groupes, "cellules": cellules,
                 "priorite": prio, "lots": [{"heures": h, "plafonds": par_semaine(10, semaines)}]}
            if encadree:
                d["encadreePar"] = encadree
            return d

        taches = [
            t("P1", 30, ["G1"], 1, ["G1||M"]),
            t("P2", 30, ["G2"], 6, ["G2||M"]),
            t("AUTRE", 200, ["G3"], 2, ["G3||X"]),
            t("S", 15, ["G1", "G2"], 1, ["G1||M", "G2||M"], formateur="F2", encadree=["P1", "P2"]),
        ]
        charge = probleme(
            taches,
            semaines=semaines,
            formateurs=[{"id": "F1", "cibles": par_semaine(12.5, semaines)},
                        {"id": "F2", "cibles": par_semaine(20, semaines)}],
        )
        poses = par_tache(resoudre(charge))
        self.assertLessEqual(min(poses["P2"]), 2)
        self.assertLessEqual(min(poses["S"]), 4)

    @staticmethod
    def module(heures_p, heures_s, formateur_s, cibles_s, cibles_p=20):
        p = {**tache("P", heures_p, formateur="F1", plafond=10), "cellules": ["G1||M"]}
        s = {**tache("S", heures_s, formateur=formateur_s, plafond=10), "cellules": ["G1||M"],
             "encadreePar": ["P"]}
        formateurs = [{"id": "F1", "cibles": par_semaine(cibles_p)}]
        if formateur_s != "F1":
            formateurs.append({"id": formateur_s, "cibles": par_semaine(cibles_s)})
        return probleme([p, s], formateurs=formateurs)

    def sans_creux(self, charge):
        solution = resoudre(charge)
        poses = par_tache(solution)
        self.assertEqual(solution.non_poses, ())
        rangs = sorted(poses["P"])
        self.assertEqual(rangs, list(range(rangs[0], rangs[-1] + 1)), rangs)
        self.assertGreater(max(poses["P"]), max(poses["S"]))

    def test_un_synchrone_lent_ne_fait_pas_attendre_le_presentiel(self):
        # Le synchrone n'avance que de 2,5 h par semaine (son formateur est
        # pris ailleurs) : le présentiel ralentit pour durer jusqu'à lui, au
        # lieu de finir vite puis d'attendre sa dernière séance.
        self.sans_creux(self.module(30, 15, "F2", cibles_s=2.5))

    def test_meme_formateur_le_synchrone_ne_prive_pas_le_presentiel(self):
        # Budget de 10 h : servi en entier d'abord, le synchrone prendrait la
        # semaine, et le présentiel s'interromprait.
        self.sans_creux(self.module(30, 20, "F1", cibles_s=0, cibles_p=10))
