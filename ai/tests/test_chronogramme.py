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

    def test_la_cible_n_est_jamais_depassee_de_plus_de_5_h(self):
        # 2026-10-04, retour du porteur : 160 h à poser en 4 semaines pour une
        # cible de 25 h ne donne PAS 40 h par semaine — on pose ce qui tient
        # (30 h au plus, la marge acceptée), et le reste est signalé.
        charge = probleme([tache(f"M{i}", 40, priorite=1, semaines=[1, 2, 3, 4]) for i in range(4)])
        solution = resoudre(charge)
        charges = par_formateur(solution, charge)["F1"]
        self.assertTrue(all(h <= 30 for h in charges.values()), dict(charges))
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
        # 60 h en six semaines : SUIVANT n'est pas à l'étroit, seule la
        # priorité le départage du retard.
        suivant = tache("SUIVANT", 60, priorite=1, semaines=[5, 6, 7, 8, 9, 10])
        poses = par_tache(resoudre(probleme([retard, suivant])))
        self.assertEqual(poses["RETARD"][5], 20)
        self.assertLessEqual(poses["SUIVANT"][5], 7.5)

    def test_le_rythme_ne_gagne_que_5_h(self):
        # En retard sur l'année, le formateur monte de 5 h au plus.
        charge = probleme([tache(f"M{i}", 100, priorite=i) for i in range(1, 5)])
        charges = par_formateur(resoudre(charge), charge)["F1"]
        self.assertTrue(all(h <= 30 for h in charges.values()))
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
        # 3 × 60 h sur 10 semaines. Le plafond de 30 h ne cède que d'un
        # créneau par formateur qui, sinon, n'aurait rien eu cette semaine
        # (« pas de semaine à vide », 2026-10-04).
        taches = [tache(f"M{i}", 60, formateur=f"F{i}", priorite=i) for i in range(1, 4)]
        charge = probleme(taches)
        solution = resoudre(charge)
        total = defaultdict(float)
        for pose in solution.poses:
            total[pose.semaine] += pose.heures
        charges = par_formateur(solution, charge)
        for semaine, heures in total.items():
            sauves = sum(1 for f in charges.values() if f.get(semaine) == 2.5)
            self.assertLessEqual(heures, 30 + 2.5 * sauves, f"S{semaine}")

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
                        self.assertLessEqual(heures, 25 + 5, f"{formateur} S{semaine}")
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


class TestPasDeSemaineAVide(unittest.TestCase):
    """2026-10-04 : « le formateur ne doit chômer en aucun cas »."""

    def test_un_groupe_plein_ne_laisse_pas_un_formateur_sans_heure(self):
        # F2, prioritaire, remplit G1 jusqu'à son plafond souple chaque
        # semaine : F1 reçoit quand même un créneau.
        plein = tache("PLEIN", 300, formateur="F2", priorite=1, plafond=20)
        # Assez d'heures pour que F1 ait du travail jusqu'à la dernière semaine.
        petit = tache("PETIT", 60, formateur="F1", priorite=6, plafond=10)
        charge = probleme(
            [plein, petit],
            formateurs=[{"id": "F1", "cibles": par_semaine(10)}, {"id": "F2", "cibles": par_semaine(30)}],
        )
        charge["groupes"][0]["plafondsSouples"] = par_semaine(20)
        charge["groupes"][0]["plafondsToleres"] = par_semaine(22.5)
        charges = par_formateur(resoudre(charge), charge)["F1"]
        for semaine in SEMAINES:
            self.assertGreater(charges[semaine], 0, f"S{semaine}")

    def test_une_cible_minuscule_vaut_un_creneau(self):
        # 0,3 h visées chaque semaine (fériés) : 2,5 h plutôt que rien.
        charge = probleme([tache("M", 100, plafond=10)], formateurs=[{"id": "F1", "cibles": par_semaine(0.3)}])
        charges = par_formateur(resoudre(charge), charge)["F1"]
        # Au moins un créneau ; au plus la marge de 5 h (le formateur est très
        # en retard sur l'année : 100 h pour 3 h visées).
        for semaine in SEMAINES:
            self.assertGreaterEqual(charges[semaine], 2.5, f"S{semaine}")
            self.assertLessEqual(charges[semaine], 0.3 + 5, f"S{semaine}")

    def test_sans_retard_une_cible_minuscule_ne_laisse_pas_la_semaine_vide(self):
        # Rien ne presse (2,5 h pour 3 h visées sur l'année) : sans le
        # créneau minimal, les arrondis repousseraient la pose en S5.
        charge = probleme([tache("M", 2.5, plafond=10)], formateurs=[{"id": "F1", "cibles": par_semaine(0.3)}])
        self.assertEqual(par_formateur(resoudre(charge), charge)["F1"][1], 2.5)


class TestPlafondTolere(unittest.TestCase):
    """« La masse de 30 h par semaine pour les groupes peut être dépassée en
    cas de besoin, mais pas trop » (2026-10-04)."""

    def charge(self):
        # F2 remplit G1 à 30 h ; F1 vise 10 h sur le même groupe.
        plein = tache("PLEIN", 300, formateur="F2", priorite=1, plafond=20)
        autre = tache("AUTRE", 300, formateur="F2", priorite=1, plafond=20)
        autre["cellules"] = ["G1||AUTRE"]
        petit = tache("PETIT", 100, formateur="F1", priorite=6, plafond=10)
        charge = probleme(
            [plein, autre, petit],
            formateurs=[{"id": "F1", "cibles": par_semaine(10)}, {"id": "F2", "cibles": par_semaine(30)}],
        )
        charge["groupes"][0]["plafondsToleres"] = par_semaine(35)
        return charge

    def test_un_formateur_sous_sa_cible_peut_aller_jusqu_au_tolere(self):
        charge = self.charge()
        solution = resoudre(charge)
        self.assertEqual(par_formateur(solution, charge)["F1"][1], 5)
        total = defaultdict(float)
        for pose in solution.poses:
            total[pose.semaine] += pose.heures
        self.assertTrue(all(h <= 35 for h in total.values()), dict(total))

    def test_sans_tolerance_le_souple_tient(self):
        charge = self.charge()
        del charge["groupes"][0]["plafondsToleres"]
        solution = resoudre(charge)
        total = defaultdict(float)
        for pose in solution.poses:
            total[pose.semaine] += pose.heures
        self.assertTrue(all(h <= 30 for h in total.values()), dict(total))

    def test_refuse_un_tolere_hors_bornes(self):
        charge = self.charge()
        charge["groupes"][0]["plafondsToleres"]["1"] = 70
        with self.assertRaisesRegex(ProblemeInvalide, "toléré"):
            lire_probleme_chronogramme(charge)


class TestModuleAnnuel(unittest.TestCase):
    """2026-10-04 : « un intervalle qui ne dépasse pas 2 semaines pour les
    modules annuels » — le S1 servi S2–S4, puis repris en S18, c'est refusé."""

    SEMAINES = list(range(1, 21))

    def annuel(self, ecart=2, priorite=2):
        return {
            "id": "ANNUEL",
            "formateur": "F1",
            "groupes": ["G1"],
            "cellules": ["G1||ANNUEL"],
            "priorite": priorite,
            "lots": [
                # 10 h à étaler sur 12 semaines : servi d'un bloc, il finirait en S4.
                {"heures": 10, "plafonds": par_semaine(10, range(1, 13)), "echeance": 12, "ecartSuivant": ecart},
                {"heures": 40, "plafonds": par_semaine(10, range(13, 21))},
            ],
        }

    def lots(self, taches):
        solution = resoudre(probleme(taches, semaines=self.SEMAINES))
        lots = defaultdict(list)
        for pose in solution.poses:
            if pose.tache_id == "ANNUEL":
                lots[pose.lot].append(pose.semaine)
        return lots

    def autre(self, identifiant="AUTRE", semaines=None, priorite=4):
        return {**tache(identifiant, 400, priorite=priorite, semaines=semaines or self.SEMAINES, plafond=20),
                "cellules": [f"G1||{identifiant}"]}

    def test_le_s1_commence_tard_et_finit_pres_de_son_echeance(self):
        lots = self.lots([self.annuel(), self.autre()])
        premier = sorted(lots[0])
        self.assertGreaterEqual(premier[-1], 12 - 2, premier)
        self.assertEqual(premier, list(range(premier[0], premier[-1] + 1)), premier)
        self.assertEqual(min(lots[1]), 13)

    def test_sans_ecart_le_s1_finit_a_son_echeance(self):
        lots = self.lots([self.annuel(ecart=0), self.autre()])
        premier = sorted(lots[0])
        self.assertEqual(premier[-1], 12)
        self.assertEqual(premier, list(range(premier[0], 13)), premier)
        self.assertEqual(min(lots[1]), 13)

    def test_sans_contrainte_le_s1_finit_tot(self):
        lots = self.lots([self.annuel(ecart=None), self.autre()])
        self.assertLess(max(lots[0]), 10)

    def test_le_s2_prend_le_relais_meme_face_a_des_modules_prioritaires(self):
        # Au S2, deux modules prioritaires prennent tout le budget : le S2 de
        # l'annuel garde au moins un créneau dès sa première semaine.
        taches = [
            self.annuel(priorite=6),
            self.autre("A1", semaines=list(range(13, 21)), priorite=1),
            self.autre("A2", semaines=list(range(13, 21)), priorite=1),
        ]
        lots = self.lots(taches)
        self.assertEqual(min(lots[1]), 13)

    def test_refuse_un_ecart_negatif(self):
        charge = probleme([tache("M", 10)])
        charge["taches"][0]["lots"][0]["ecartSuivant"] = -1
        with self.assertRaisesRegex(ProblemeInvalide, "ecartSuivant"):
            lire_probleme_chronogramme(charge)


class TestGranularite(unittest.TestCase):
    """2026-10-04 : « les séances synchrones doivent être de 5 h »."""

    def test_chaque_semaine_un_multiple_de_la_seance(self):
        s = {**tache("S", 30, plafond=5), "pasTache": 5}
        solution = resoudre(probleme([s]))
        poses = par_tache(solution)["S"]
        self.assertTrue(all(h % 5 == 0 for h in poses.values()), poses)
        self.assertEqual(sum(poses.values()), 30)
        semaines = sorted(poses)
        self.assertEqual(semaines, list(range(semaines[0], semaines[-1] + 1)), "sans creux")

    def test_le_reliquat_forme_une_derniere_seance_plus_courte(self):
        s = {**tache("S", 12.5, plafond=5), "pasTache": 5}
        solution = resoudre(probleme([s]))
        poses = par_tache(solution)["S"]
        self.assertEqual(solution.non_poses, ())
        self.assertEqual([poses[w] for w in sorted(poses)], [5, 5, 2.5])

    def test_un_budget_d_un_seul_pas_ne_pose_pas_une_demi_seance(self):
        s = {**tache("S", 20, plafond=5), "pasTache": 5}
        charge = probleme([s], formateurs=[{"id": "F1", "cibles": par_semaine(2.5)}])
        poses = par_tache(resoudre(charge))["S"]
        self.assertTrue(all(h % 5 == 0 for h in poses.values()), poses)

    def test_la_continuite_reserve_une_seance_entiere(self):
        # Le synchrone avance seul en S1-S2 ; en S3, un module prioritaire
        # s'ouvre et voudrait tout le budget. Le créneau de continuité du
        # synchrone doit être une SÉANCE (5 h), sinon il tombe à zéro.
        s = {**tache("S", 20, priorite=6, plafond=5), "pasTache": 5}
        prioritaire = tache("P", 80, priorite=1, semaines=list(range(3, 11)), plafond=10)
        charge = probleme([s, prioritaire], formateurs=[{"id": "F1", "cibles": par_semaine(10)}])
        poses = par_tache(resoudre(charge))["S"]
        semaines = sorted(poses)
        self.assertEqual(sum(poses.values()), 20, poses)
        self.assertEqual(semaines, list(range(semaines[0], semaines[-1] + 1)), poses)
        self.assertTrue(all(h % 5 == 0 for h in poses.values()), poses)

    def test_refuse_une_granularite_hors_pas(self):
        charge = probleme([{**tache("S", 20), "pasTache": 3}])
        with self.assertRaisesRegex(ProblemeInvalide, "pasTache"):
            lire_probleme_chronogramme(charge)


class TestMinimumAvantEnchainement(unittest.TestCase):
    """2026-10-04 : une formatrice aux modules tous annuels restait sous son
    minimum en début de S1, ses modules attendant de finir pile en S17."""

    def charge(self, minimum):
        semaines = list(range(1, 21))
        taches = []
        for n in range(4):
            taches.append({
                "id": f"ANNUEL{n}",
                "formateur": "F1",
                "groupes": ["G1"],
                "cellules": [f"G1||A{n}"],
                "priorite": 5,
                "lots": [
                    {"heures": 20, "plafonds": par_semaine(10, range(1, 13)), "echeance": 12, "ecartSuivant": 0},
                    {"heures": 20, "plafonds": par_semaine(10, range(13, 21))},
                ],
            })
        formateur = {"id": "F1", "cibles": par_semaine(25, semaines)}
        if minimum:
            formateur["minimums"] = par_semaine(minimum, semaines)
        return probleme(taches, semaines=semaines, formateurs=[formateur])

    def test_sous_son_minimum_le_formateur_commence_plus_tot(self):
        charge = self.charge(minimum=25)
        charges = par_formateur(resoudre(charge), charge)["F1"]
        self.assertGreaterEqual(charges[1], 10)

    def test_sans_minimum_l_enchainement_retient(self):
        charge = self.charge(minimum=None)
        charges = par_formateur(resoudre(charge), charge)["F1"]
        self.assertEqual(charges.get(1, 0), 0)


class TestPoseMinimale(unittest.TestCase):
    """2026-10-04 : « pour les modules de 70 h et plus, des séances de 5 h à
    10 h » — jamais 2,5 h seules, sauf la séance qui solde la masse."""

    def charge(self, pose_min):
        # BAS avance seul en S1-S2 ; en S3 HAUT, prioritaire, s'ouvre et prend
        # le budget : BAS n'a plus que son créneau de continuité — 2,5 h.
        bas = tache("BAS", 100, priorite=6, plafond=10)
        if pose_min:
            bas["poseMin"] = pose_min
        haut = tache("HAUT", 60, priorite=1, semaines=[3, 4, 5, 6], plafond=20)
        return probleme([bas, haut], formateurs=[{"id": "F1", "cibles": par_semaine(20)}])

    def poses_par_lot(self, solution):
        lots = defaultdict(list)
        for pose in solution.poses:
            lots[(pose.tache_id, pose.lot)].append((pose.semaine, pose.heures))
        return lots

    def test_chaque_semaine_au_moins_la_pose_minimale(self):
        lots = self.poses_par_lot(resoudre(self.charge(5)))
        for cle, poses in lots.items():
            poses.sort()
            for semaine, heures in poses[:-1]:
                self.assertGreaterEqual(heures, 5, (cle, semaine, poses))

    def test_la_pose_minimale_ne_casse_pas_la_continuite(self):
        # Face au prioritaire, BAS garde une séance de 5 h plutôt que rien.
        poses = par_tache(resoudre(self.charge(5)))["BAS"]
        semaines = sorted(poses)
        self.assertEqual(semaines, list(range(semaines[0], semaines[-1] + 1)), poses)

    def test_sans_pose_minimale_des_semaines_a_2_5_h(self):
        lots = self.poses_par_lot(resoudre(self.charge(None)))
        self.assertTrue(any(h == 2.5 for poses in lots.values() for _, h in sorted(poses)[:-1]))

    def test_la_derniere_pose_peut_solder_plus_court(self):
        t = {**tache("M", 12.5, plafond=10), "poseMin": 5}
        poses = par_tache(resoudre(probleme([t], formateurs=[{"id": "F1", "cibles": par_semaine(5)}])))["M"]
        self.assertEqual([poses[w] for w in sorted(poses)], [5, 5, 2.5])
