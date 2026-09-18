import { useState } from 'react';
import { Briefcase, GraduationCap, Presentation } from 'lucide-react';
import { ROLES } from 'shared/constants';
import { cn } from '@/lib/utils';
import CadreReglage from './CadreReglage';
import EnTetePartage from '@/features/partages/EnTetePartage';
import { useDroitPage } from '@/features/partages/useDroitPage';
import CreationEnLot from './sessions/CreationEnLot';
import CreationGestionnaire from './sessions/CreationGestionnaire';
import ListeComptes from './sessions/ListeComptes';

/**
 * Création des comptes de l'établissement (F12).
 * ← le panneau « Gestion des Sessions » de profile.html (#panel-session)
 *   + api/session/*.php (8 endpoints, 799 lignes)
 *
 * ═══ POURQUOI CET ÉCRAN N'EST PAS UN CONFORT ═══
 * Depuis la décision du 2026-08-15 — démarrage sur une base vide, comptes
 * compris — c'est le seul moyen praticable de créer les comptes formateurs et
 * stagiaires. Les 1 078 comptes de l'ancienne base ne sont pas repris.
 *
 * ═══ TROIS RÔLES, TROIS SOURCES DIFFÉRENTES ═══
 * C'est ce qui structure l'écran, et ce que l'existant mélangeait dans un seul
 * formulaire à champs masqués :
 *
 *   FORMATEUR    → lu dans la base e-note / la carte d'établissement
 *   STAGIAIRE    → lu dans l'import Konosys, porté par la page Documents
 *   GESTIONNAIRE → saisi à la main : il ne figure dans aucune base
 */
const ROLES_ECRAN = [
  {
    cle: ROLES.FORMATEUR,
    libelle: 'Formateur',
    icone: Presentation,
    resume: 'Depuis votre base',
  },
  {
    cle: ROLES.STAGIAIRE,
    libelle: 'Stagiaire',
    icone: GraduationCap,
    resume: 'Depuis l’import Konosys',
  },
  {
    cle: ROLES.GESTIONNAIRE,
    libelle: 'Gestionnaire',
    icone: Briefcase,
    resume: 'Saisie manuelle',
  },
];

export default function PageSessions() {
  const [role, setRole] = useState(ROLES.FORMATEUR);

  /*
   * ═══ PARTAGEABLE EN LECTURE SEULE (Phase 5bis, étape d4) ═══ Un invité voit
   * les comptes déjà créés, rôle par rôle ; la création et les actions sur un
   * compte disparaissent — le serveur les refuse de toute façon au directeur
   * près : réinitialiser le mot de passe d'un collègue, c'est prendre son compte.
   */
  const { lectureSeule } = useDroitPage('sessions');

  return (
    <>
    <EnTetePartage page="sessions" clesARelire={[['comptes']]} />
    <CadreReglage titre="Sessions">
      {/*
        Les trois cartes de l'existant (`.user-type-card`) sont conservées : le
        rôle décide de TOUT le reste de l'écran — la source, la liste, les
        champs. Le poser en premier, visuellement, évite le formulaire à champs
        masqués de `#sessionForm`, où l'on ne savait pas ce qui allait s'ouvrir.
      */}
      <div className="grid gap-3 sm:grid-cols-3">
        {ROLES_ECRAN.map(({ cle, libelle, icone: Icone, resume }) => (
          <button
            key={cle}
            type="button"
            onClick={() => setRole(cle)}
            aria-pressed={role === cle}
            className={cn(
              'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
              role === cle ? 'border-primary bg-primary/5' : 'hover:bg-muted'
            )}
          >
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg',
                role === cle ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              )}
            >
              <Icone className="size-4" />
            </span>

            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{libelle}</span>
              <span className="block truncate text-xs text-muted-foreground">{resume}</span>
            </span>
          </button>
        ))}
      </div>

      {!lectureSeule && role === ROLES.FORMATEUR && (
        <CreationEnLot
          role={ROLES.FORMATEUR}
          libelle="Formateur"
          aide="Ils se connectent avec leur MATRICULE, pas leur adresse. Ceux qui ont déjà un compte restent affichés, marqués, et ne peuvent pas être recréés."
        />
      )}

      {!lectureSeule && role === ROLES.STAGIAIRE && (
        <CreationEnLot
          role={ROLES.STAGIAIRE}
          libelle="Stagiaire"
          aide="Ils se connectent avec leur MATRICULE (CEF), pas leur adresse. La liste vient de la base Konosys de l’année affichée — un stagiaire n’y figure qu’une fois, quels que soient ses groupes."
          /*
           * ⚠️ La source des stagiaires n'est PAS l'e-note mais l'import
           * Konosys de la page Documents. Une liste vide doit renvoyer LÀ — et,
           * depuis qu'il y a une base Konosys par année (2026-09-14), vers le
           * sélecteur d'année aussi.
           */
          aideVide="Importez l’export Konosys de cette année depuis la page « Documents », ou changez d’année avec le sélecteur en haut de la barre latérale."
        />
      )}

      {!lectureSeule && role === ROLES.GESTIONNAIRE && <CreationGestionnaire />}

      {/*
        La liste des comptes DÉJÀ créés, sous la création et pour le même rôle.
        « Ai-je déjà créé le compte de X ? » se pose au moment où l'on coche des
        noms : séparer les deux écrans obligerait à naviguer pour y répondre.
        Le séparateur marque le passage de « créer » à « gérer ».
      */}
      {/* En lecture seule, la liste EST la page : pas de séparateur au-dessus de rien. */}
      <div className={cn(!lectureSeule && 'border-t pt-6')}>
        <ListeComptes role={role} lectureSeule={lectureSeule} />
      </div>
    </CadreReglage>
    </>
  );
}
