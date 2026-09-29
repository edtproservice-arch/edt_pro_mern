"""
La frontière refuse-t-elle ce qu'elle doit refuser ?

Ces tests valent autant que ceux du solveur : un problème mal construit qui
passe en silence produit une grille plausible et fausse, et c'est le pire des
deux cas — personne ne va la vérifier.
"""

import unittest

from generateur.contrat import ProblemeInvalide
from generateur.lecture import lire_probleme


def probleme_minimal(**remplacements):
    base = {
        "graine": 1,
        "creneaux": [
            {"id": 0, "jour": "Lundi", "rang": 0},
            {"id": 1, "jour": "Lundi", "rang": 1},
        ],
        "salles": [{"nom": "Salle 1"}],
        "taches": [
            {
                "id": "T1",
                "formateur": "15688",
                "groupes": ["GM101"],
                "seancesRequises": 1,
                "sallesPossibles": ["Salle 1"],
            }
        ],
    }
    base.update(remplacements)
    return base


class TestStructure(unittest.TestCase):
    def test_lit_un_probleme_valide(self):
        probleme = lire_probleme(probleme_minimal())
        self.assertEqual(probleme.graine, 1)
        self.assertEqual(len(probleme.creneaux), 2)
        self.assertEqual(probleme.taches[0].id, "T1")

    def test_refuse_une_cle_inconnue(self):
        """
        Le garde qui rattrape les neuf variantes du « champ oublié » de ce
        projet : une clé en trop est presque toujours une clé mal orthographiée,
        donc un champ manquant qui se présenterait comme une valeur par défaut.
        """
        with self.assertRaises(ProblemeInvalide) as capture:
            lire_probleme(probleme_minimal(occupations=[]))
        self.assertIn("occupations", str(capture.exception))

    def test_refuse_une_cle_manquante(self):
        sans_graine = probleme_minimal()
        del sans_graine["graine"]
        with self.assertRaises(ProblemeInvalide) as capture:
            lire_probleme(sans_graine)
        self.assertIn("graine", str(capture.exception))

    def test_refuse_un_booleen_pour_un_entier(self):
        """`bool` est un `int` en Python : sans garde explicite, true passerait pour 1."""
        with self.assertRaises(ProblemeInvalide):
            lire_probleme(probleme_minimal(graine=True))

    def test_refuse_deux_creneaux_de_meme_id(self):
        with self.assertRaises(ProblemeInvalide) as capture:
            lire_probleme(
                probleme_minimal(
                    creneaux=[
                        {"id": 0, "jour": "Lundi", "rang": 0},
                        {"id": 0, "jour": "Lundi", "rang": 1},
                    ]
                )
            )
        self.assertIn("déjà utilisé", str(capture.exception))

    def test_refuse_une_liste_de_creneaux_vide(self):
        with self.assertRaises(ProblemeInvalide):
            lire_probleme(probleme_minimal(creneaux=[]))


class TestReferencesCroisees(unittest.TestCase):
    """
    Un identifiant qui ne renvoie à rien est le symptôme d'une désynchronisation
    côté Node — donc d'une interdiction qui ne s'appliquerait à aucun créneau.
    """

    def test_refuse_un_creneau_interdit_inconnu(self):
        tache = dict(probleme_minimal()["taches"][0], creneauxInterdits=[99])
        with self.assertRaises(ProblemeInvalide) as capture:
            lire_probleme(probleme_minimal(taches=[tache]))
        self.assertIn("99", str(capture.exception))

    def test_refuse_une_salle_inconnue_dans_une_tache(self):
        tache = dict(probleme_minimal()["taches"][0], sallesPossibles=["Salle 9"])
        with self.assertRaises(ProblemeInvalide) as capture:
            lire_probleme(probleme_minimal(taches=[tache]))
        self.assertIn("Salle 9", str(capture.exception))

    def test_refuse_un_bloc_sur_un_creneau_inconnu(self):
        with self.assertRaises(ProblemeInvalide):
            lire_probleme(probleme_minimal(blocs=[[0, 42]]))

    def test_refuse_un_bloc_qui_repete_le_meme_creneau(self):
        with self.assertRaises(ProblemeInvalide):
            lire_probleme(probleme_minimal(blocs=[[0, 0]]))

    def test_refuse_une_occupation_sur_un_creneau_inconnu(self):
        with self.assertRaises(ProblemeInvalide):
            lire_probleme(
                probleme_minimal(occupation=[{"creneauId": 7, "formateur": "X"}])
            )


class TestIncompatibilites(unittest.TestCase):
    def test_symetrise_la_carte(self):
        """
        Node devrait rendre une carte symétrique — `groupesSeCroisent` l'est.
        Un oubli ne se verrait PAS : la génération poserait deux cours au même
        moment pour la même classe, dans un seul sens de lecture.
        """
        probleme = lire_probleme(
            probleme_minimal(incompatibilites={"GM101": ["ACADA101 (FQ)"]})
        )
        self.assertIn("ACADA101 (FQ)", probleme.incompatibilites["GM101"])
        self.assertIn("GM101", probleme.incompatibilites["ACADA101 (FQ)"])

    def test_ignore_un_groupe_incompatible_avec_lui_meme(self):
        probleme = lire_probleme(probleme_minimal(incompatibilites={"GM101": ["GM101"]}))
        self.assertNotIn("GM101", probleme.incompatibilites.get("GM101", frozenset()))


if __name__ == "__main__":
    unittest.main()
class TestMotifsInterdiction(unittest.TestCase):
    """
    Les étiquettes d'interdiction (2026-09-22).

    ═══ ⚠️ CE QUE CES TESTS GARDENT ═══
    Node colle sur chaque interdiction une étiquette disant d'où elle vient
    (stage, rentrée, formation, consigne du formateur). Python ne l'interprète
    JAMAIS — il la compte et la recopie. Ce qu'il doit en revanche refuser,
    c'est une étiquette qui ne correspond à AUCUNE interdiction : le diagnostic
    rapporterait alors une cause pour un créneau parfaitement libre, et le
    directeur irait corriger un stage qui n'a rien bloqué.
    """

    def tache_avec(self, **extra):
        tache = {
            "id": "T1",
            "formateur": "15688",
            "groupes": ["GM101"],
            "seancesRequises": 1,
            "sallesPossibles": ["Salle 1"],
        }
        tache.update(extra)
        return probleme_minimal(taches=[tache])

    def test_lit_les_motifs_et_les_range_par_etiquette(self):
        probleme = lire_probleme(
            self.tache_avec(
                creneauxInterdits=[0, 1],
                motifsInterdiction={"stage": [0], "a_eviter": [1]},
            )
        )
        self.assertEqual(
            dict(probleme.taches[0].motifs_interdiction),
            {"stage": frozenset({0}), "a_eviter": frozenset({1})},
        )

    def test_ACCEPTE_une_etiquette_inconnue(self):
        """
        ⚠️ ET C'EST VOULU. Tenir ici la liste des motifs valides obligerait ce
        module à connaître les notions métier de Node — la frontière même que
        ce fichier existe pour garder. Le vocabulaire appartient à Node ; un
        motif qu'il n'aurait pas traduit s'affiche tel quel côté écran, ce qui
        se voit, plutôt que de faire échouer une génération entière.
        """
        probleme = lire_probleme(
            self.tache_avec(
                creneauxInterdits=[0],
                motifsInterdiction={"greve_des_transports": [0]},
            )
        )
        self.assertEqual(
            probleme.taches[0].motifs_interdiction,
            (("greve_des_transports", frozenset({0})),),
        )

    def test_REFUSE_un_motif_sur_un_creneau_non_interdit(self):
        with self.assertRaises(ProblemeInvalide) as capture:
            lire_probleme(
                self.tache_avec(creneauxInterdits=[0], motifsInterdiction={"stage": [1]})
            )
        self.assertIn("creneauxInterdits", str(capture.exception))

    def test_reste_FACULTATIF(self):
        # Un appelant d'avant le 2026-09-22 n'envoie pas de motifs : il doit
        # continuer de fonctionner, en perdant seulement le détail.
        probleme = lire_probleme(self.tache_avec(creneauxInterdits=[0]))
        self.assertEqual(probleme.taches[0].motifs_interdiction, ())

    def test_la_tache_reste_HACHABLE(self):
        # ⚠️ `Tache` est `frozen=True` : un dict de motifs l'aurait rendue non
        #    hachable, et le défaut ne serait apparu qu'au premier `set()`.
        probleme = lire_probleme(
            self.tache_avec(creneauxInterdits=[0], motifsInterdiction={"stage": [0]})
        )
        self.assertEqual(len({probleme.taches[0]}), 1)


class TestSallesPreferees(unittest.TestCase):
    """
    Les salles déclarées sur l'affectation (2026-09-23).

    ═══ ⚠️ CE QUE CES TESTS GARDENT ═══
    La carte peut dire OÙ un module se donne. Node met ces salles dans
    `sallesPossibles` **et** les répète dans `sallesPreferees` : les deux listes
    disent des choses différentes — ce que le solveur a le droit d'employer, et
    ce qu'il devrait employer. Une préférence hors des possibles ne serait
    jamais choisie : la consigne serait sans effet, et le directeur la croirait
    appliquée. Mieux vaut un refus bruyant qu'un réglage décoratif.
    """

    def tache_avec(self, **extra):
        tache = {
            "id": "T1",
            "formateur": "15688",
            "groupes": ["GM101"],
            "seancesRequises": 1,
            "sallesPossibles": ["Salle 1", "Salle 2"],
        }
        tache.update(extra)
        # ⚠️ DEUX SALLES DÉCLARÉES : avec une seule, « préférer » n'aurait aucun
        #    sens — il n'y a rien d'autre à choisir, et le test passerait quoi
        #    que fasse le solveur.
        return probleme_minimal(
            taches=[tache], salles=[{"nom": "Salle 1"}, {"nom": "Salle 2"}]
        )

    def test_les_lit_en_frozenset(self):
        probleme = lire_probleme(self.tache_avec(sallesPreferees=["Salle 2"]))
        self.assertEqual(probleme.taches[0].salles_preferees, frozenset({"Salle 2"}))

    def test_REFUSE_une_preference_hors_des_possibles(self):
        with self.assertRaises(ProblemeInvalide) as capture:
            lire_probleme(self.tache_avec(sallesPreferees=["Salle 9"]))
        self.assertIn("sallesPossibles", str(capture.exception))

    def test_REFUSE_une_salle_reelle_mais_non_autorisee_pour_CETTE_tache(self):
        # ⚠️ « Salle 1 » existe bien dans l'établissement — c'est justement le
        #    cas piégeux : la préférence semble légitime, mais la tâche n'a pas
        #    le droit d'y aller. Sans ce refus, elle serait ignorée en silence.
        probleme = self.tache_avec(sallesPossibles=["Salle 2"], sallesPreferees=["Salle 1"])
        with self.assertRaises(ProblemeInvalide):
            lire_probleme(probleme)

    def test_reste_FACULTATIF(self):
        # Un appelant d'avant le 2026-09-23 n'en envoie pas : il doit continuer
        # de fonctionner, sans aucune préférence.
        probleme = lire_probleme(self.tache_avec())
        self.assertEqual(probleme.taches[0].salles_preferees, frozenset())

    def test_la_tache_reste_HACHABLE(self):
        probleme = lire_probleme(self.tache_avec(sallesPreferees=["Salle 1"]))
        self.assertEqual(len({probleme.taches[0]}), 1)
