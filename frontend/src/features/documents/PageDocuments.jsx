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
import { usePartagesAvecMoi } from '@/features/partages/usePartagesAvecMoi';
import { ROLES } from 'shared/constants';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { useDroitPage } from '@/features/partages/useDroitPage';
import { useEtatPartage } from '@/features/guidage/useEtatPartage';

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
  // La carte ouverte, partagée pendant le guidage (2026-10-04).
  useEtatPartage('documents.carte', ouvert, (valeur) => setOuvert(typeof valeur === 'string' ? valeur : null));

  /*
   * ═══ PARTAGEABLE EN LECTURE (Phase 5bis, étape d4) ═══ Le gestionnaire la
   * consulte par son rôle, un formateur s'il est invité. L'import Konosys est
   * au DIRECTEUR et au GESTIONNAIRE (2026-09-23) — il remplace tous les
   * stagiaires et supprime les comptes des absents du fichier : jamais au
   * formateur invité, que la page laisse en lecture.
   */
  const { lectureSeule } = useDroitPage('documents');
  const { role } = usePartagesAvecMoi();
  const peutImporter = !lectureSeule || role === ROLES.GESTIONNAIRE;

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
        L'ÉTAT DE LA BASE ET SON IMPORT SUR UNE MÊME LIGNE (2026-09-23, demande
        du porteur) : l'alerte dit QUELLE base on regarde et de quand elle date,
        le bouton la remplace. La phrase d'explication générale est retirée.
        Le bilan d'un import passe à la ligne, en dernier (`basis-full order-last`).
      */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Le bouton D'ABORD (demande du porteur), l'état de la base à sa suite. */}
        {peutImporter && <ImportKonosys statistiques={statistiques.data} />}

        {statistiques.data && (
          <Alerte type="info" className="min-w-64 flex-1 px-3 py-1.5">
            <span className="font-medium">{etatBase(statistiques.data)}</span>
          </Alerte>
        )}
      </div>

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

      <div className="pt-6">
        <CartesDocuments nombreStagiaires={statistiques.data?.total ?? 0} />
      </div>
    </CadreReglage>
    </>
  );
}
