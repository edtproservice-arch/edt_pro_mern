import { useMemo } from 'react';
import { semainesDeLaLigne } from 'shared/domain';
import Alerte from '@/components/common/Alerte';
import GrilleChronogramme from './GrilleChronogramme';

/**
 * Chronogramme vu PAR FORMATEUR.
 * ← le `modeFormateur` de profil-principal.js:5589-5640
 *
 * ═══ POURQUOI CETTE VUE EXISTE ═══
 * Par groupe, on répond à « ce groupe a-t-il toutes ses heures ? ». Par
 * formateur, à « cette personne est-elle chargée régulièrement, ou tout
 * tombe-t-il la même semaine ? ». La seconde question ne se lit pas en ouvrant
 * vingt grilles de groupe l'une après l'autre : il faudrait additionner à la
 * main, colonne par colonne, les lignes d'une même personne.
 *
 * ═══ UNE SEULE GRILLE POUR LES DEUX VUES ═══
 * C'est le choix de l'existant, et il tient : les lignes portent leur propre
 * groupe, la quatrième colonne fixe change de titre, et rien d'autre ne bouge.
 * Un second tableau aurait été deux rendus à garder cohérents — le défaut que
 * le §4.2 du plan relève sur le métier.
 */
export default function VueFormateur({
  requete,
  plannings,
  onChanger,
  lectureSeule = false,
  onOuverture,
  // Repères d'absence et de rattrapage : ceux du serveur, sauf si l'appelant en
  // fournit d'autres (la modale de rattrapage y ajoute son brouillon).
  marques,
}) {
  const donnees = requete?.data;

  /*
   * ═══ LES LIGNES, ET LEURS SEMAINES PROPRES ═══
   *
   * ⚠️ LA CLÉ D'UNE LIGNE EST `groupe||module`, PAS LE CODE DU MODULE. Le même
   * module revient pour plusieurs groupes — « M102 » pour GM101 et GM102 — avec
   * deux plannings distincts. Indexer sur le code les confondrait : poser 5 h
   * sur l'un les poserait sur l'autre.
   *
   * ⚠️ ET LES SEMAINES DIFFÈRENT D'UNE LIGNE À L'AUTRE. Vacances et fériés
   * valent pour l'établissement entier, mais un STAGE ne ferme qu'un groupe :
   * la S12 peut être verrouillée pour la ligne de GM101 et ouverte pour celle
   * de GM102.
   *
   * ⚠️ LA FORMATION, ELLE, VAUT POUR TOUTE LA GRILLE — c'est l'inverse exact du
   * stage. Le tableau ne porte qu'une personne : quand elle est en formation,
   * aucune de ses lignes n'est saisissable, quel que soit le groupe. Les deux
   * portées se croisent sur cet écran, et `semainesDeLaLigne` les applique dans
   * l'ordre des portées.
   */
  const lignes = useMemo(() => {
    if (!donnees) return [];

    return donnees.lignes.map((ligne) => ({
      ...ligne,
      cle: `${ligne.groupe}||${ligne.code}`,
      semaines: semainesDeLaLigne(donnees.semaines, {
        stage: donnees.stagesParGroupe?.[ligne.groupe] ?? [],
        formation: donnees.formationSemaines ?? [],
        /*
         * ⚠️ LA RENTRÉE EST DE LA MÊME FAMILLE QUE LE STAGE ICI : elle vaut
         * pour une ANNÉE DE FORMATION, donc pour certaines lignes seulement.
         * Le formateur a ses 2ᵉ années dès le 7 septembre et rien avec ses
         * 1ʳᵉ avant le 11 — fermer la colonne lui interdirait un cours réel.
         */
        rentree: donnees.rentreesParGroupe?.[ligne.groupe]?.semaines ?? [],
        rentreeLe: donnees.rentreesParGroupe?.[ligne.groupe]?.date ?? null,
      }),
    }));
  }, [donnees]);

  /*
   * L'EN-TÊTE ne porte « stage » que si TOUS les groupes du tableau y sont.
   * ← la règle écrite en toutes lettres dans profil-principal.js:5612.
   *
   * Le marquer dès qu'un seul groupe part ferait croire la semaine fermée pour
   * tout le monde, alors que le formateur y garde ses autres cours. Les lignes,
   * elles, sont verrouillées individuellement ci-dessus.
   */
  const semaines = useMemo(() => {
    if (!donnees) return [];

    const groupes = [...new Set(donnees.lignes.map((ligne) => ligne.groupe))];

    /*
     * ⚠️ DÉFAUT CORRIGÉ AU PASSAGE (2026-09-02) : ce filtre faisait
     * `.includes(semaine.numero)` sur `stagesParGroupe`, devenu une liste
     * d'OBJETS `{numero, jours}` le 2026-08-26. La comparaison était donc
     * TOUJOURS fausse, et l'en-tête ne portait plus jamais « STG » — sans la
     * moindre erreur pour le signaler.
     *
     * ⚠️ ET AVEC DES JOURS, LA RÈGLE SE GÉNÉRALISE : on retient le PLUS PETIT
     * nombre de jours perdus sur l'ensemble des groupes, c'est-à-dire ce qui est
     * vrai pour TOUTES les lignes. Prendre le plus grand ferait porter à la
     * colonne l'absence d'un seul groupe.
     */
    const communs = (parGroupe) =>
      donnees.semaines
        .map((semaine) => ({
          numero: semaine.numero,
          jours: Math.min(
            ...groupes.map(
              (groupe) =>
                (parGroupe?.[groupe] ?? []).find((s) => s.numero === semaine.numero)?.jours ?? 0
            )
          ),
        }))
        .filter((semaine) => Number.isFinite(semaine.jours) && semaine.jours > 0);

    const tousEnStage = groupes.length === 0 ? [] : communs(donnees.stagesParGroupe);
    const tousAvantRentree =
      groupes.length === 0
        ? []
        : communs(
            Object.fromEntries(
              Object.entries(donnees.rentreesParGroupe ?? {}).map(([groupe, gel]) => [
                groupe,
                gel.semaines,
              ])
            )
          );

    /*
     * La FORMATION entre bien dans l'en-tête, elle : elle ferme toutes les
     * lignes du tableau sans exception, donc la colonne entière. C'est la
     * différence avec la vue par groupe, où elle n'en ferme qu'une.
     */
    return semainesDeLaLigne(donnees.semaines, {
      stage: tousEnStage,
      formation: donnees.formationSemaines ?? [],
      // Même règle pour la rentrée : elle n'entre dans l'en-tête que si AUCUN
      // groupe du tableau n'est encore rentré.
      rentree: tousAvantRentree,
    });
  }, [donnees]);

  /**
   * Plannings par groupe → une seule table à plat, indexée par clé de ligne.
   *
   * Seuls les modules DE CE FORMATEUR y entrent : le reste du chronogramme du
   * groupe existe toujours, il n'est simplement pas à l'écran ici.
   */
  const plat = useMemo(() => {
    const table = {};
    for (const ligne of lignes) {
      table[ligne.cle] = plannings?.[ligne.groupe]?.[ligne.code] ?? {};
    }
    return table;
  }, [lignes, plannings]);

  /**
   * Et le chemin inverse, à chaque saisie.
   *
   * ⚠️ C'EST ICI QUE SE JOUE LA PERTE DE DONNÉES. `PUT /chronogrammes/:groupe`
   * REMPLACE le planning du groupe. Si on reconstruisait le planning d'un groupe
   * à partir des seules lignes du formateur, l'enregistrement EFFACERAIT les
   * modules de tous ses collègues — sans un message, et sans que rien ne se voie
   * à l'écran puisqu'ils n'y figurent pas.
   *
   * On repart donc du planning COMPLET du groupe — celui que le serveur a
   * renvoyé — et on ne réécrit QUE les modules de cette personne.
   */
  const repartir = (nouveauPlat) => {
    const suivants = { ...plannings };

    for (const ligne of lignes) {
      const cellules = nouveauPlat[ligne.cle];
      const courant = { ...(suivants[ligne.groupe] ?? {}) };

      if (cellules && Object.keys(cellules).length > 0) courant[ligne.code] = cellules;
      else delete courant[ligne.code];

      suivants[ligne.groupe] = courant;
    }

    return suivants;
  };

  if (requete?.isError) {
    return (
      <Alerte type="erreur" titre="Grille non chargée">
        {requete.error.message}
      </Alerte>
    );
  }

  if (requete?.isLoading || !donnees) {
    return <p className="text-sm text-muted-foreground">Chargement de la grille…</p>;
  }

  if (lignes.length === 0) {
    return (
      <Alerte type="avertissement" titre="Aucun module affecté">
        Cette personne ne porte aucun module cette année. La grille se construit à partir des
        affectations — renseignez-les depuis « Paramètres → Affectations ».
      </Alerte>
    );
  }

  const partages = lignes.filter((ligne) => ligne.partageAvec?.length > 0);

  /*
   * ⚠️ PAS DE LIGNE DE RÉSUMÉ ICI. Elle énumérait les treize groupes et la masse
   * annuelle, en tête de grille — mais l'en-tête du bloc repliable porte déjà
   * « 23 module(s) · 13 groupe(s) », et la colonne « Groupe » nomme chacun sur
   * sa ligne. Trois fois la même information, dont une qui poussait la grille
   * d'une ligne entière vers le bas.
   */
  return (
    <div className="space-y-2">
      {/*
        Une explication qui ne s'affiche QUE dans le cas concerné : sans elle,
        l'écart d'un module co-enseigné se lit comme une erreur de calcul, et on
        cherche le défaut dans la grille plutôt que dans la répartition.
      */}
      {partages.length > 0 && (
        <Alerte type="avertissement" titre="Modules assurés à plusieurs">
          {partages.map((ligne) => `${ligne.code} (${ligne.groupe}) avec ${ligne.partageAvec.join(', ')}`).join(' · ')}
          . Les heures affichées sont celles du chronogramme du groupe, la masse est la part de
          cette personne : l’écart de ces lignes se lit sur la vue par groupe.
        </Alerte>
      )}

      <GrilleChronogramme
        modules={lignes}
        semaines={semaines}
        planning={plat}
        colonne={{ titre: 'Groupe', valeur: (ligne) => ligne.groupe }}
        lectureSeule={lectureSeule}
        onOuverture={onOuverture}
        marques={marques ?? donnees.marques}
        /*
         * ⚠️ PAS DE SEUIL PROPRE AU FORMATEUR. J'avais pris la masse statutaire
         * pour un repère hebdomadaire : elle vaut ~1 000 h, donc annuelle, et le
         * pied de grille se colorait « en deçà » sur les 45 colonnes — l'échelle
         * ne disait plus rien. Les 30 h de la grille restent le seul repère
         * HEBDOMADAIRE vrai des deux côtés : c'est ce qu'une semaine peut
         * physiquement contenir, 6 jours de 5 séances. La comparaison à la masse
         * annuelle, elle, est déjà portée par les colonnes MHP et Écart.
         */
        onChanger={(nouveauPlat, motif) => {
          if (nouveauPlat === null) {
            onChanger(null, motif);
            return;
          }
          onChanger(repartir(nouveauPlat));
        }}
      />
    </div>
  );
}
