import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ROLES } from 'shared/constants';
import CoquilleApp from '@/components/layout/CoquilleApp';
import GardeRole from '@/components/layout/GardeRole';
import GardePage from '@/features/partages/GardePage';
import { ENTREES } from '@/components/layout/navigation';
import ModuleAVenir from '@/features/app/ModuleAVenir';
import PageAvancement from '@/features/avancement/PageAvancement';
import ProfilPage from '@/features/profil/ProfilPage';
import PageAffectations from '@/features/parametres/PageAffectations';
import PageCalendrier from '@/features/parametres/PageCalendrier';
import PageEspaces from '@/features/parametres/PageEspaces';
import PageFormateurs from '@/features/parametres/PageFormateurs';
import PageFormations from '@/features/parametres/PageFormations';
import PageEdition from '@/features/edition/PageEdition';
import PageEfmRegional from '@/features/parametres/PageEfmRegional';
import PageGroupesFq from '@/features/parametres/PageGroupesFq';
import PageStages from '@/features/parametres/PageStages';
import PageSessions from '@/features/parametres/PageSessions';
import PageParametres from '@/features/parametres/PageParametres';
import PageDocuments from '@/features/documents/PageDocuments';
import PageChronogramme from '@/features/chronogramme/PageChronogramme';
import PageEmploi from '@/features/emploi/PageEmploi';
import PageAbsences from '@/features/absences/PageAbsences';
import GardeAbsences from '@/features/absences/GardeAbsences';
import PageMessagerie from '@/features/messagerie/PageMessagerie';
import PageMessagerieAdmin from '@/features/messagerie/PageMessagerieAdmin';
import { queryClient } from '@/lib/queryClient';
import { Toaster } from '@/components/ui/sonner';

import LoginPage from '@/features/auth/LoginPage';
import RegisterPage from '@/features/auth/RegisterPage';
import VerificationPage from '@/features/auth/VerificationPage';
import MotDePasseOubliePage from '@/features/auth/MotDePasseOubliePage';
import ReinitialisationPage from '@/features/auth/ReinitialisationPage';
import EssaiPage from '@/features/auth/EssaiPage';
import AdminDashboard from '@/features/admin/AdminDashboard';
import { demarrerBattementCoeur } from '@/lib/battementCoeur';
import StatistiquesAdmin from '@/features/admin/StatistiquesAdmin';
import PageRepartition from '@/features/repartition/PageRepartition';
import PageReseau from '@/features/reseau/PageReseau';
import PageCalendrierNational from '@/features/calendrierNational/PageCalendrierNational';
import ConfigurationPage from '@/features/configuration/ConfigurationPage';
import AccueilRouteur from '@/features/app/AccueilRouteur';
import PageMonEmploi from '@/features/consultation/PageMonEmploi';
import PageMesAffectations from '@/features/consultation/PageMesAffectations';
import PageMonProgramme from '@/features/consultation/PageMonProgramme';
import PageMonAvancement from '@/features/consultation/PageMonAvancement';

/*
 * ═══ GROUPES DE RÔLES — SESSIONS CONSULTATIVES (F14, 2026-09-03) ═══
 * Un seul endroit pour ces quatre listes : les recopier à chaque `<Route>`
 * aurait fini par en désaccorder une, exactement le défaut du §4.2 appliqué
 * aux permissions plutôt qu'au métier.
 *
 * ⚠️ LE GESTIONNAIRE N'EST PAS DANS `TRAVAIL_DIRECTEUR` : lui seul, parmi les
 * quatre rôles applicatifs, n'a droit qu'à « Édition » et « Documents »
 * (demande explicite du porteur) — tout le reste du travail quotidien
 * (Emploi, Avancement, Absences, Paramètres) reste réservé au directeur.
 */
const TRAVAIL_DIRECTEUR = [ROLES.DIRECTEUR];
const TRAVAIL_DIRECTEUR_GESTIONNAIRE = [ROLES.DIRECTEUR, ROLES.GESTIONNAIRE];
const TOUS_LES_ROLES_APPLICATIFS = [
  ROLES.DIRECTEUR,
  ROLES.GESTIONNAIRE,
  ROLES.FORMATEUR,
  ROLES.STAGIAIRE,
];

/**
 * Racine de l'application.
 *
 * Les routes sont ajoutées au fur et à mesure des phases de migration
 * (cf. plan §7 dans ../gestion_edt/CLAUDE.md). Chaque dossier de
 * `src/features/` porte le même nom que son module dans `backend/src/modules/`.
 */
export default function App() {
  /*
   * ═══ LE BATTEMENT DE CŒUR EST MONTÉ ICI, UNE SEULE FOIS ═══
   * ← `public/api-interceptor.js`, chargé par chacune des 30 pages HTML — et
   * `profile.html` l'enveloppait une seconde fois, ce qui enregistrait DEUX
   * battements (son propre commentaire le dit). Monté à la racine de
   * l'application, il ne peut plus se dédoubler.
   *
   * ⚠️ IL BAT MÊME SANS SESSION : la route répond 401, l'échec est avalé. Le
   * conditionner à une session connue demanderait de le remonter après chaque
   * connexion, et un oubli le laisserait muet sans que rien ne le signale.
   */
  useEffect(demarrerBattementCoeur, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/connexion" replace />} />

          {/* F1 — authentification */}
          <Route path="/connexion" element={<LoginPage />} />
          <Route path="/inscription" element={<RegisterPage />} />
          <Route path="/verification" element={<VerificationPage />} />
          <Route path="/mot-de-passe-oublie" element={<MotDePasseOubliePage />} />
          <Route path="/reinitialisation" element={<ReinitialisationPage />} />
          <Route path="/essai" element={<EssaiPage />} />

          {/* F15 — administration : deux sections, liées par `SectionsAdmin`. */}
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/statistiques" element={<StatistiquesAdmin />} />
          {/* Référentiel DRIF : national, donc réservé à l'admin (2026-09-02). */}
          <Route path="/admin/repartitions" element={<PageRepartition />} />
          {/* Le catalogue du réseau OFPPT — lecture publique, écriture admin. */}
          <Route path="/admin/reseau" element={<PageReseau />} />
          {/* Vacances du réseau et dates de rentrée — national, donc admin. */}
          <Route path="/admin/calendrier" element={<PageCalendrierNational />} />
          {/*
            La messagerie (F10), hébergée hors de la coquille du directeur — un
            administrateur n'a ni établissement ni année scolaire à y afficher.
          */}
          <Route path="/admin/messagerie" element={<PageMessagerieAdmin />} />

          {/* F3 — configuration initiale de l'établissement (← setup.html) */}
          <Route path="/configuration" element={<ConfigurationPage />} />

          {/*
            Espace applicatif : la coquille monte la navigation UNE fois, les
            écrans ne décrivent que leur contenu. Les modules non encore migrés
            ont leur route et affichent leur phase, plutôt qu'un lien mort.
          */}
          <Route path="/app" element={<CoquilleApp />}>
            <Route index element={<AccueilRouteur />} />
            {/*
              Écrans RÉELS. Ils précèdent la boucle : React Router retient la
              première route qui correspond, et la boucle rendrait sinon
              l'écran d'attente pour ces mêmes chemins.

              ⚠️ CHAQUE ÉCRAN DE TRAVAIL EST GARDÉ PAR RÔLE (2026-09-03). Le
              serveur refuse déjà ce qui n'est pas permis — la garde évite
              seulement qu'un rôle non concerné voie l'écran se monter et
              échouer requête après requête, sans savoir pourquoi.
            */}
            <Route path="profil" element={<ProfilPage />} />
            <Route
              path="messagerie"
              element={
                <GardeRole roles={TOUS_LES_ROLES_APPLICATIFS}>
                  <PageMessagerie />
                </GardeRole>
              }
            />

            {/* ═══ RÉSERVÉS AU DIRECTEUR SEUL ═══ */}
            <Route
              path="parametres"
              element={
                <GardeRole roles={TRAVAIL_DIRECTEUR}>
                  <PageParametres />
                </GardeRole>
              }
            />
            <Route
              path="parametres/espaces"
              element={
                <GardePage page="espaces" requis="consulter">
                  <PageEspaces />
                </GardePage>
              }
            />
            <Route
              path="parametres/calendrier"
              element={
                <GardePage page="calendrier" requis="consulter">
                  <PageCalendrier />
                </GardePage>
              }
            />
            <Route
              path="parametres/formateurs"
              element={
                <GardePage page="formateurs" requis="consulter">
                  <PageFormateurs />
                </GardePage>
              }
            />
            <Route
              path="parametres/affectations"
              element={
                <GardePage page="affectations" requis="consulter">
                  <PageAffectations />
                </GardePage>
              }
            />
            <Route
              path="parametres/stages"
              element={
                <GardePage page="stages" requis="consulter">
                  <PageStages />
                </GardePage>
              }
            />
            <Route
              path="parametres/formations"
              element={
                <GardePage page="formations" requis="consulter">
                  <PageFormations />
                </GardePage>
              }
            />
            <Route
              path="parametres/groupes-fq"
              element={
                <GardePage page="groupesFq" requis="consulter">
                  <PageGroupesFq />
                </GardePage>
              }
            />
            <Route
              path="parametres/efm-regional"
              element={
                <GardePage page="efm" requis="consulter">
                  <PageEfmRegional />
                </GardePage>
              }
            />
            <Route
              path="parametres/sessions"
              element={
                <GardePage page="sessions" requis="consulter">
                  <PageSessions />
                </GardePage>
              }
            />
            <Route
              path="parametres/chronogramme"
              element={
                <GardePage page="chronogramme" requis="consulter">
                  <PageChronogramme />
                </GardePage>
              }
            />
            {/*
              ═══ AVANCEMENT, ABSENCES, CHRONOGRAMME ET EFM SE GARDENT AUSSI PAR
              DROIT (étape d2) ═══ — voir leurs routes plus haut et plus bas.
              ═══ L'EMPLOI DU TEMPS SE GARDE PAR DROIT, PLUS PAR RÔLE ═══
              (Phase 5bis — invitations.) Le directeur y entre en propriétaire ;
              un invité « peut modifier » aussi. Un invité « peut consulter » est
              renvoyé vers la LECTURE (« Édition ») : il a bien accès à la page.
            */}
            <Route
              path="emploi"
              element={
                <GardePage page="emploi" requis="modifier" repli="/app/edition">
                  <PageEmploi />
                </GardePage>
              }
            />
            <Route
              path="avancement"
              element={
                <GardePage page="avancement" requis="consulter">
                  <PageAvancement />
                </GardePage>
              }
            />
            <Route
              path="absences"
              element={
                <GardeAbsences>
                  <PageAbsences />
                </GardeAbsences>
              }
            />

            {/*
              ═══ DIRECTEUR ET GESTIONNAIRE ═══
              Les deux seuls écrans que le porteur ouvre au gestionnaire :
              « il peut accéder seulement les pages édition et document ».
            */}
            {/* Le gestionnaire consulte par son rôle ; un formateur, s'il est invité. */}
            <Route
              path="edition"
              element={
                <GardePage page="emploi" requis="consulter">
                  <PageEdition />
                </GardePage>
              }
            />
            <Route
              path="documents"
              element={
                <GardePage page="documents" requis="consulter">
                  <PageDocuments />
                </GardePage>
              }
            />

            {/*
              ═══ SESSIONS CONSULTATIVES — FORMATEUR & STAGIAIRE (F14) ═══
              ← emploiFormateur.html, emploiStagiaire.html,
                avancementFormateur.html, avancementStagiaire.html,
                affectationFormateur.html
            */}
            <Route
              path="mon-emploi"
              element={
                <GardeRole roles={[ROLES.FORMATEUR, ROLES.STAGIAIRE]}>
                  <PageMonEmploi />
                </GardeRole>
              }
            />
            <Route
              path="mes-affectations"
              element={
                <GardeRole roles={[ROLES.FORMATEUR]}>
                  <PageMesAffectations />
                </GardeRole>
              }
            />
            {/*
              ⚠️ STAGIAIRE SEUL, comme la route serveur : c'est le pendant de
              « Mes affectations » du formateur — la même table, lue par
              l'autre bout. (2026-09-05, ← `tableMatieres.html`.)
            */}
            <Route
              path="mon-programme"
              element={
                <GardeRole roles={[ROLES.STAGIAIRE]}>
                  <PageMonProgramme />
                </GardeRole>
              }
            />
            <Route
              path="mon-avancement"
              element={
                <GardeRole roles={[ROLES.FORMATEUR, ROLES.STAGIAIRE]}>
                  <PageMonAvancement />
                </GardeRole>
              }
            />

            {ENTREES.map((entree) => (
              <Route
                key={entree.url}
                path={entree.url.replace('/app/', '')}
                element={<ModuleAVenir titre={entree.titre} phase={entree.phase} />}
              />
            ))}
          </Route>
        </Routes>

        {/*
          Retours d'action éphémères. Ce qui doit RESTER lisible — le bilan d'un
          import, d'un enregistrement — garde son `Alerte` dans la page : un
          toast disparaît, et une information qu'on doit relire ne peut pas
          dépendre de la vitesse de lecture.
        */}
        <Toaster position="bottom-right" closeButton />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
