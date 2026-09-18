import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { libelleAnneeScolaire } from 'shared/domain';
import CadreReglage from '@/features/parametres/CadreReglage';
import Alerte from '@/components/common/Alerte';
import { chargerStatistiquesStagiaires } from './api';
import CartesDocuments from './CartesDocuments';
import CartesEffectifs from './CartesEffectifs';
import DetailEffectifs from './DetailEffectifs';
import ImportKonosys from './ImportKonosys';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { useDroitPage } from '@/features/partages/useDroitPage';

/**
 * Documents — base des stagiaires (F11).
 * ← public/canvas.html
 *
 * ═══ POURQUOI L'IMPORT KONOSYS EST ICI, ET NON DANS « PARAMÈTRES » ═══
 * C'est l'emplacement de l'existant, et il a sa logique : cette base ne sert
 * pas à construire l'emploi du temps — elle sert à IMPRIMER. Badges, listes
 * d'émargement, convocations, cartes de stagiaire en dépendent tous.
 *
 * Elle alimente aussi la création des comptes stagiaires (« Paramètres →
 * Sessions ») et la colonne « Effectif Groupe » de l'export de la carte.
 *
 * ⚠️ Konosys est une source DISTINCTE de l'e-note : celle-ci porte formateurs,
 * groupes et modules, celle-là les personnes inscrites. Les confondre était le
 * plus court chemin vers un import qui écrase l'autre.
 */
/** « Base 2026-2027 : 672 stagiaires, importée le 19 août 2026. » */
function etatBase({ anneeScolaire, total, importeLe }) {
  const annee = Number.isInteger(anneeScolaire) ? libelleAnneeScolaire(anneeScolaire) : '';
  if (!importeLe) return `Aucune base importée pour l’année ${annee}.`;

  const le = new Date(importeLe).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `Base ${annee} : ${total} stagiaire(s), importée le ${le}.`;
}

export default function PageDocuments() {
  // Une seule carte ouverte à la fois : elles montrent le MÊME détail sous des
  // angles différents, en ouvrir plusieurs répéterait le même arbre.
  const [ouvert, setOuvert] = useState(null);

  /*
   * ═══ PARTAGEABLE EN LECTURE (Phase 5bis, étape d4) ═══ Le gestionnaire la
   * consulte par son rôle, un formateur s'il est invité. L'import Konosys reste
   * au DIRECTEUR — il remplace tous les stagiaires et supprime les comptes des
   * absents du fichier. Le bouton était jusqu'ici montré au gestionnaire, pour
   * un envoi que le serveur refusait en 403.
   */
  const { lectureSeule } = useDroitPage('documents');

  const statistiques = useQuery({
    queryKey: ['stagiaires', 'statistiques'],
    queryFn: chargerStatistiquesStagiaires,
    retry: false,
  });

  return (
    <>
    <EnTetePartage page="documents" clesARelire={[['stagiaires']]} />
    <CadreReglage titre="Documents">
      {/*
        En ALERTE plutôt qu'en sous-titre : posée sous le titre de page, cette
        phrase se lisait comme une légende décorative. Elle dit pourtant d'où
        vient la donnée et ce qu'elle alimente — c'est ce qu'il faut avoir en
        tête avant de cliquer « Importer », puisque l'import remplace tout.
      */}
      <Alerte type="info">
        La base des stagiaires, importée depuis Konosys. Elle alimente les documents imprimés et la
        création des comptes. Chaque année scolaire a sa propre base : un nouvel import remplace
        celle de l&apos;année affichée.
        {/*
          Dire QUELLE base on regarde, et de quand elle date : depuis qu'il y en
          a une par année, « 672 stagiaires » ne dit plus à quelle rentrée ils
          appartiennent.
        */}
        {statistiques.data && (
          <span className="mt-1 block font-medium">
            {etatBase(statistiques.data)}
          </span>
        )}
      </Alerte>

      {!lectureSeule && <ImportKonosys statistiques={statistiques.data} />}

      {statistiques.isError ? (
        <Alerte type="erreur" titre="Effectifs non chargés">
          {statistiques.error.message}
        </Alerte>
      ) : (
        <>
          <CartesEffectifs
            statistiques={statistiques.data}
            ouvert={ouvert}
            onBasculer={(cle) => setOuvert(ouvert === cle ? null : cle)}
          />

          {ouvert && <DetailEffectifs statistiques={statistiques.data} />}
        </>
      )}

      <div className="border-t pt-6">
        <CartesDocuments nombreStagiaires={statistiques.data?.total ?? 0} />
      </div>
    </CadreReglage>
    </>
  );
}
