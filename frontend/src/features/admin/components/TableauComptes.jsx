import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Ban, CircleCheck, Clock, Eye, KeyRound, LogIn, MoreVertical, Trash2 } from 'lucide-react';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import TableauTriable from '@/components/common/TableauTriable';
import { HAUTEUR_BARRE } from '@/components/layout/BarreNavigation';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import {
  changerStatut,
  connecterEnTantQue,
  reinitialiserMotDePasseCompte,
  supprimerCompte,
} from '../api';
import BoutonCollaborer from './BoutonCollaborer';
import { routeApresUsurpation } from '@/features/auth/routage';
import { apparenceStatut, formaterDate } from './statutCompte';
import CelluleUtilisateur from './CelluleUtilisateur';
import { libelleRole } from './roles';
import FicheCompte from './FicheCompte';

export default function TableauComptes({ comptes, enChargement, onChangement }) {
  const navigate = useNavigate();
  const [consulte, setConsulte] = useState(null);
  /** Action en attente de confirmation : { type: 'bloquer'|'supprimer', compte }. */
  const [aConfirmer, setAConfirmer] = useState(null);

  const mutationStatut = useMutation({
    mutationFn: ({ id, corps }) => changerStatut(id, corps),
    onSuccess: onChangement,
  });

  const mutationMotDePasse = useMutation({ mutationFn: reinitialiserMotDePasseCompte });

  const mutationSuppression = useMutation({
    mutationFn: supprimerCompte,
    onSuccess: onChangement,
  });

  const mutationConnexion = useMutation({
    mutationFn: connecterEnTantQue,
    // Les cookies d'administrateur viennent d'être remplacés : on quitte
    // l'espace d'administration, auquel cette session n'a plus accès.
    //
    // ⚠️ `routeApresUsurpation`, PAS `routeApresConnexion` (2026-09-06,
    // décision du porteur qui REVIENT sur celle du 2026-08-14) :
    // l'administrateur arrive sur l'ACCUEIL, jamais sur l'assistant de
    // configuration — voir la raison dans `routage.js`.
    //
    // ⚠️⚠️ ET C'ÉTAIT AUSSI UN DÉFAUT : `presenterPourAdmin` ne rend PAS
    // `configurationTerminee`. `routeApresConnexion` lisait donc `undefined`
    // et envoyait vers `/configuration` MÊME UN DIRECTEUR AYANT TOUT
    // TERMINÉ — le symptôme signalé. La redirection ne dépend plus d'un champ
    // que ce présentateur ne garantit pas.
    onSuccess: (reponse) => navigate(routeApresUsurpation(reponse.utilisateur)),
  });

  if (enChargement) return <EtatVide><IndicateurChargement className="mx-auto" /></EtatVide>;
  if (comptes.length === 0) return <EtatVide>Aucun compte dans cet onglet.</EtatVide>;

  const enCours =
    mutationStatut.isPending ||
    mutationMotDePasse.isPending ||
    mutationSuppression.isPending ||
    mutationConnexion.isPending;

  function confirmer() {
    const { type, compte } = aConfirmer;
    if (type === 'supprimer') mutationSuppression.mutate(compte.id);
    else mutationStatut.mutate({ id: compte.id, corps: { statut: STATUTS_COMPTE.BLOQUE } });
    setAConfirmer(null);
  }

  return (
    <>
      {/*
        ═══ ⚠️ EN-TÊTE COLLANT, SANS SCROLLBAR ═══ (2026-09-03, demande du
        porteur : « entête fixe … sans ajouter une scroll bar en tableau … avec
        l'option de triage ».)

        `pleinePage` fait tenir les colonnes dans la largeur de l'écran —
        `table-fixed`, comme la grille d'emploi du temps — au lieu d'un
        défilement horizontal, qui aurait piégé le collant AVANT qu'il
        n'atteigne la vraie page (voir `TableauTriable`).
      */}
      <TableauTriable
        pleinePage
        collerSous={HAUTEUR_BARRE}
        vide="Aucun compte dans cet onglet."
        cleLigne={(compte) => compte.id}
        colonnes={[
          {
            id: 'utilisateur',
            entete: 'Utilisateur',
            tri: (compte) => compte.nomComplet ?? '',
            rendu: (compte) => <CelluleUtilisateur compte={compte} />,
          },
          {
            id: 'role',
            entete: 'Rôle',
            largeur: 'w-28',
            tri: (compte) => libelleRole(compte.role),
            rendu: (compte) => (
              /* ⚠️ LE LIBELLÉ, PAS LA VALEUR BRUTE : cette colonne affichait
                 « directeur » quand les deux autres tableaux écrivaient
                 « Directeur ». */
              <Badge variant="outline" className="font-normal">
                {libelleRole(compte.role)}
              </Badge>
            ),
          },
          {
            id: 'statut',
            entete: 'Statut',
            largeur: 'w-48',
            tri: (compte) => apparenceStatut(compte.statut).libelle,
            rendu: (compte) => {
              const apparence = apparenceStatut(compte.statut);
              const enAttente = compte.statut === STATUTS_COMPTE.EN_ATTENTE;
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={apparence.variant} className="gap-1.5 font-normal">
                    <apparence.Icone className={`h-3.5 w-3.5 ${apparence.couleur}`} />
                    {apparence.libelle}
                  </Badge>
                  {compte.essai?.demande && enAttente && (
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      essai demandé
                    </Badge>
                  )}
                </div>
              );
            },
          },
          {
            id: 'inscription',
            entete: 'Inscription',
            largeur: 'w-28',
            tri: (compte) => new Date(compte.dateInscription ?? 0).getTime(),
            rendu: (compte) => (
              <span className="text-sm text-muted-foreground">
                {formaterDate(compte.dateInscription)}
              </span>
            ),
          },
          {
            id: 'derniereConnexion',
            entete: 'Dernière connexion',
            largeur: 'w-36',
            aligne: 'droite',
            tri: (compte) => new Date(compte.derniereConnexion ?? 0).getTime(),
            rendu: (compte) => (
              <span className="text-sm text-muted-foreground">
                {compte.derniereConnexion ? formaterDate(compte.derniereConnexion) : 'Jamais'}
              </span>
            ),
          },
          {
            id: 'actions',
            entete: '',
            largeur: 'w-72',
            aligne: 'droite',
            rendu: (compte) => {
              const enAttente = compte.statut === STATUTS_COMPTE.EN_ATTENTE;
              const bloque = compte.statut === STATUTS_COMPTE.BLOQUE;
              // Le serveur refuse toute action sensible visant un
              // administrateur (usurpation, blocage, suppression). On ne les
              // propose donc pas : une action offerte qui echoue
              // systematiquement est un defaut.
              const cibleAdmin = compte.role === ROLES.ADMIN;

              return (
                <div className="flex items-center justify-end gap-1">
                  {!cibleAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={enCours}
                      onClick={() => mutationConnexion.mutate(compte.id)}
                    >
                      <LogIn />
                      Se connecter
                    </Button>
                  )}
                  <BoutonCollaborer compte={compte} desactive={enCours} />

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Autres actions">
                        <MoreVertical />
                      </Button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setConsulte(compte)}>
                        <Eye />
                        Voir la fiche
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      {enAttente && (
                        <>
                          <DropdownMenuItem
                            disabled={enCours}
                            onClick={() =>
                              mutationStatut.mutate({
                                id: compte.id,
                                corps: { statut: STATUTS_COMPTE.APPROUVE },
                              })
                            }
                          >
                            <CircleCheck />
                            Approuver
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={enCours}
                            onClick={() =>
                              mutationStatut.mutate({
                                id: compte.id,
                                corps: { statut: STATUTS_COMPTE.APPROUVE, essaiJours: 30 },
                              })
                            }
                          >
                            <Clock />
                            Approuver — essai 30 jours
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}

                      <DropdownMenuItem
                        disabled={enCours}
                        onClick={() => mutationMotDePasse.mutate(compte.id)}
                      >
                        <KeyRound />
                        Réinitialiser le mot de passe
                      </DropdownMenuItem>

                      {!cibleAdmin && (
                        <>
                          <DropdownMenuSeparator />

                          {bloque ? (
                            <DropdownMenuItem
                              disabled={enCours}
                              onClick={() =>
                                mutationStatut.mutate({
                                  id: compte.id,
                                  corps: { statut: STATUTS_COMPTE.APPROUVE },
                                })
                              }
                            >
                              <CircleCheck />
                              Débloquer
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              disabled={enCours}
                              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                              onClick={() => setAConfirmer({ type: 'bloquer', compte })}
                            >
                              <Ban />
                              Bloquer
                            </DropdownMenuItem>
                          )}

                          <DropdownMenuItem
                            disabled={enCours}
                            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                            onClick={() => setAConfirmer({ type: 'supprimer', compte })}
                          >
                            <Trash2 />
                            Supprimer le compte
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            },
          },
        ]}
        lignes={comptes}
      />

      <Messages
        mutations={[mutationStatut, mutationMotDePasse, mutationSuppression, mutationConnexion]}
        succesMotDePasse={mutationMotDePasse.isSuccess}
      />

      <FicheCompte compte={consulte} onOpenChange={(ouvert) => !ouvert && setConsulte(null)} />

      <ConfirmationAction
        ouvert={Boolean(aConfirmer)}
        onOpenChange={(ouvert) => !ouvert && setAConfirmer(null)}
        destructive
        titre={
          aConfirmer?.type === 'supprimer'
            ? 'Supprimer définitivement ce compte ?'
            : 'Bloquer ce compte ?'
        }
        description={
          aConfirmer?.type === 'supprimer'
            ? `${aConfirmer?.compte.nomComplet} (${aConfirmer?.compte.email}) sera supprimé, ainsi que les établissements dont il est propriétaire et toutes leurs données. Cette action est IRRÉVERSIBLE.`
            : `${aConfirmer?.compte.nomComplet} sera déconnecté immédiatement de tous ses appareils et ne pourra plus accéder à l'application. Le blocage est réversible.`
        }
        libelleConfirmation={aConfirmer?.type === 'supprimer' ? 'Supprimer' : 'Bloquer'}
        onConfirmer={confirmer}
      />
    </>
  );
}

function Messages({ mutations, succesMotDePasse }) {
  const enErreur = mutations.find((m) => m.isError);

  if (enErreur) {
    return (
      <p className="mt-2 text-sm text-destructive" role="alert">
        {enErreur.error.message}
      </p>
    );
  }
  if (succesMotDePasse) {
    return (
      <p className="mt-2 text-sm text-muted-foreground">Nouveau mot de passe envoyé par e-mail.</p>
    );
  }
  return null;
}

function EtatVide({ children }) {
  return (
    <div className="rounded-lg border py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
