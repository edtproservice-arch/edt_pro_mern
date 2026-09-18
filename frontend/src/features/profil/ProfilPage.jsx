import { useQuery } from '@tanstack/react-query';
import { ROLES as ROLES_APPLICATIFS } from 'shared/constants';
import { Badge } from '@/components/ui/badge';
import { libelleAnneeScolaire } from 'shared/domain';
import { recupererSession } from '@/features/auth/api';
import { chargerEtablissementCourant } from '@/features/configuration/api';
import DialogueMotDePasse from './DialogueMotDePasse';
import DialogueEditerProfil from './DialogueEditerProfil';
import TableauAppareils from './TableauAppareils';
import { Ligne, Section } from './Reglages';

/*
 * Les rôles sont stockés comme identifiants : ils ne s'affichent pas tels
 * quels.
 *
 * ⚠️ DÉFAUT CORRIGÉ EN PASSANT (2026-09-03) : la clé du directeur était
 * `director` — l'anglais — alors que `ROLES.DIRECTEUR` (shared/constants)
 * vaut `'directeur'`. `ROLES_AFFICHES['directeur']` rendait donc `undefined`,
 * et le repli `?? utilisateur.role` affichait la valeur BRUTE « directeur »
 * au lieu du libellé « Directeur » — la seule des cinq étiquettes qui ne
 * fonctionnait jamais.
 */
const ROLES_AFFICHES = {
  admin: 'Administrateur',
  directeur: 'Directeur',
  gestionnaire: 'Gestionnaire',
  formateur: 'Formateur',
  stagiaire: 'Stagiaire',
};

const STATUTS = {
  approved: { libelle: 'Approuvé', classe: 'border-success/30 text-success' },
  pending: { libelle: 'En attente', classe: 'border-warning/30 text-warning' },
  trial: { libelle: 'Essai', classe: 'border-warning/30 text-warning' },
  blocked: { libelle: 'Bloqué', classe: 'border-destructive/30 text-destructive' },
};

/**
 * Mon compte.
 * ← les panneaux « compte », « mot de passe » et « appareils » de profile.html
 */
export default function ProfilPage() {
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const contexte = useQuery({
    queryKey: ['etablissement-courant'],
    queryFn: chargerEtablissementCourant,
    retry: false,
  });

  if (session.isLoading) {
    return <p className="text-sm text-muted-foreground">Chargement du compte…</p>;
  }

  if (session.isError) {
    return <p className="text-sm text-muted-foreground">Session expirée. Reconnectez-vous.</p>;
  }

  const utilisateur = session.data.utilisateur;
  const etablissement = contexte.data?.etablissement;
  const statut = STATUTS[utilisateur.statut];

  /*
   * ⚠️⚠️ NI L'UN NI L'AUTRE POUR FORMATEUR/STAGIAIRE (2026-09-05, demande du
   * porteur) : leur nom et leur e-mail viennent d'un IMPORT (e-note ou
   * Konosys, cf. Phase 4 du plan) — pas d'une inscription. Le serveur les
   * refuse déjà (403 `PROFIL_NON_MODIFIABLE`) ; offrir le bouton quand même
   * ferait cliquer pour rien. Un bouton qui échoue toujours est un défaut.
   */
  const peutModifierProfil =
    utilisateur.role !== ROLES_APPLICATIFS.FORMATEUR &&
    utilisateur.role !== ROLES_APPLICATIFS.STAGIAIRE;

  return (
    <div className="mx-auto max-w-2xl space-y-10 py-2">
      <header>
        <h1 className="text-2xl font-semibold">Compte</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {/* ⚠️ NE PARLE D'« APPAREILS » QUE SI LA SECTION EXISTE VRAIMENT PLUS
              BAS — sinon la phrase promet une section absente. */}
          Gérez votre profil et vos informations de connexion
          {peutModifierProfil ? ', et vos appareils.' : '.'}
        </p>
      </header>

      <Section
        titre="Profil"
        action={peutModifierProfil ? <DialogueEditerProfil utilisateur={utilisateur} /> : undefined}
      >
        <div className="flex items-center gap-4 py-4">
          {/*
            Une pastille d'initiales, pas une photo : le projet n'en stocke
            aucune, et un rond vide se confondrait avec un chargement.
          */}
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-medium text-primary">
            {initiales(utilisateur.nomComplet)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-medium">{utilisateur.nomComplet}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-normal">
                {ROLES_AFFICHES[utilisateur.role] ?? utilisateur.role}
              </Badge>
              <Badge variant="outline" className={statut?.classe}>
                {statut?.libelle ?? utilisateur.statut}
              </Badge>
            </div>
          </div>
        </div>

        {etablissement && (
          <>
            {/*
              Le nom OFFICIEL en entier, pas l'abrégé : c'est ici qu'on vérifie
              à quel établissement on est rattaché, et l'abrégé — fait pour les
              en-têtes de documents — ne permet pas cette vérification.
            */}
            <Ligne
              titre="Établissement"
              valeur={etablissement.nom}
              description={
                etablissement.nomAbrege ? `Nom abrégé : ${etablissement.nomAbrege}` : undefined
              }
            />
            <Ligne titre="Complexe" valeur={etablissement.complexe} description={etablissement.region} />
            <Ligne
              titre="Année scolaire"
              valeur={
                contexte.data?.anneeScolaire
                  ? libelleAnneeScolaire(contexte.data.anneeScolaire)
                  : '—'
              }
            />
          </>
        )}
      </Section>

      <Section titre="Sécurité du compte">
        <Ligne
          titre="E-mail"
          valeur={utilisateur.email}
          description={
            peutModifierProfil
              ? 'Elle vous identifie à la connexion.'
              : "Elle vous identifie à la connexion — gérée par votre établissement, elle ne se modifie pas ici."
          }
          action={
            peutModifierProfil ? (
              <DialogueEditerProfil utilisateur={utilisateur} libelle="Modifier l'e-mail" />
            ) : undefined
          }
        />

        <Ligne
          titre="Mot de passe"
          description="Le changement déconnecte vos autres appareils."
          action={<DialogueMotDePasse />}
        />
      </Section>

      {/*
        ⚠️ PAS POUR FORMATEUR NI STAGIAIRE (demande du porteur, 2026-09-03) :
        « réutiliser le même composant sans la partie appareil ». Le reste de
        la page — profil, sécurité — leur est identique : ce sont les MÊMES
        sections `Ligne`/`Section` que le directeur, et les diverger aurait été
        deux profils à tenir cohérents.
      */}
      {utilisateur.role !== ROLES_APPLICATIFS.FORMATEUR &&
        utilisateur.role !== ROLES_APPLICATIFS.STAGIAIRE && <TableauAppareils />}
    </div>
  );
}

/** Deux initiales — la première de chacun des deux premiers mots. */
function initiales(nomComplet) {
  const mots = String(nomComplet ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (mots.length === 0) return '?';
  return (mots[0][0] + (mots[1]?.[0] ?? '')).toUpperCase();
}
