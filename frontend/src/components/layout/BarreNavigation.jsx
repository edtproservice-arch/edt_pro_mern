import { cloneElement, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LogOut, Mail, PanelLeft, UserRound } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { recupererSession, seDeconnecter } from '@/features/auth/api';
import { compterNonLus } from '@/features/messagerie/api';
import { initiales } from '@/lib/initiales';
import { cn } from '@/lib/utils';
import { EmplacementEnTete } from './enTetePage';

/**
 * Barre de navigation applicative.
 * ← nav de public/admin_dashboard.html:184-199
 *
 * Elle est transversale plutôt que recopiée dans chaque page — les 30 pages HTML
 * embarquaient chacune la leur, avec des variantes.
 *
 * ═══ ⚠️ COLLANTE, PLUS FIXE ═══ (2026-09-02.) `fixed` la sortait du flux, et
 * chaque page devait compenser sa hauteur à la main — `pt-[68px]`, recopié dans
 * trois écrans. Le jour où la barre change de hauteur, les trois deviennent faux
 * ensemble, et rien ne le signale. `sticky` la garde dans le flux.
 *
 * ═══ ⚠️ TROIS ZONES, LES LIENS AU CENTRE ═══ (maquette fournie par le porteur.)
 * Marque à gauche, navigation au milieu, actions à droite.
 *
 * ⚠️ UNE GRILLE `1fr auto 1fr`, PAS UN `justify-between` : avec ce dernier, le
 * bloc du milieu se décale au gré de la largeur des deux extrémités, qui ne sont
 * jamais de même taille. Le piège avait déjà décalé de 76 px la navigation de
 * semaine de la page Édition.
 *
 * @param {string}  titre   Contexte affiché à côté du logo (ex. « Administration »).
 * @param {node}    liens   Navigation entre les pages de l'espace. Sous `md`,
 *   elle passe dans un panneau plein écran — masquée sans recours, on ne
 *   pourrait plus changer de page depuis un téléphone.
 * @param {boolean} [messagerie]  Active le bouton « Mail ». Réservé aux pages
 *   qui ont réellement une boîte à montrer : `/configuration` le laisse à
 *   `false`, un directeur en cours d'inscription n'a rien à y lire.
 * @param {string}  [messagerieUrl='/admin/messagerie']  Où mène ce bouton —
 *   PARAMÉTRÉ (2026-09-03) plutôt que codé en dur : cette barre sert désormais
 *   aussi l'espace formateur/stagiaire, dont la messagerie vit sous
 *   `/app/messagerie`, pas sous `/admin`.
 * @param {string}  [profilUrl]  Quand fourni, ajoute « Mon profil » au menu du
 *   compte, AVANT la déconnexion — l'administrateur n'a pas de page de profil,
 *   d'où l'absence de valeur par défaut plutôt qu'un lien mort.
 */

/**
 * Sa hauteur RÉELLE (68 px de contenu + 1 px de `border-b`), exportée pour
 * qui doit se poser JUSTE en dessous — l'en-tête collant des tableaux de
 * l'administration (`TableauTriable`, `pleinePage`), depuis le 2026-09-03.
 *
 * ⚠️ UNE SEULE MESURE, PARTAGÉE. Elle a déjà été recopiée trois fois en
 * `pt-[68px]` avant de passer collante — le jour où cette barre change de
 * hauteur, une valeur écrite ailleurs devient fausse sans qu'aucune erreur ne
 * le signale.
 */
export const HAUTEUR_BARRE = '69px';

/**
 * La largeur maximale de la barre — donc celle sur laquelle une page servie
 * sous elle doit se caler. (2026-09-06, demande du porteur : « mettre le max
 * width de la page le même max width du navbar ».)
 *
 * ⚠️ EXPORTÉE POUR LA MÊME RAISON QUE `HAUTEUR_BARRE` : c'est la barre qui
 * possède cette mesure. Recopiée dans une coquille ou un cadre, elle
 * divergerait le jour où la barre change de gabarit, et le contenu cesserait de
 * s'aligner sur elle sans qu'aucune erreur ne le signale.
 */
export const LARGEUR_BARRE = 'max-w-7xl';

export default function BarreNavigation({
  titre,
  liens,
  messagerie = false,
  messagerieUrl = '/admin/messagerie',
  profilUrl,
}) {
  const [panneauOuvert, setPanneauOuvert] = useState(false);

  /*
   * ⚠️ LA REQUÊTE NE PART QUE SI LE BOUTON EST RÉELLEMENT VIVANT. Sur
   * `/configuration`, l'appelant ne passe pas `messagerie` : interroger le
   * compteur quand même harcèlerait le serveur pour un bouton qui reste
   * désactivé.
   */
  const compteur = useQuery({
    queryKey: ['messages', 'non-lus'],
    queryFn: compterNonLus,
    enabled: messagerie,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const nonLus = compteur.data?.nonLus ?? 0;

  return (
    <header className="sticky top-0 z-50 border-b bg-card">
      {/*
        ⚠️ FLEX SUR MOBILE, GRILLE À PARTIR DE `md`. La grille `1fr auto 1fr`
        centre parfaitement les liens — mais sans eux, elle garde ses TROIS
        colonnes : mesuré à 390 px, la piste du milieu occupait 80 px et poussait
        les actions à 155 px du bord au lieu de les coller au coin. Un `flex
        justify-between` n'a pas ce défaut, et la grille ne sert que là où le
        centre existe.
      */}
      <div
        className={cn(
          'mx-auto flex h-[68px] items-center justify-between gap-4 px-4 sm:px-6 md:grid md:grid-cols-[1fr_auto_1fr] lg:px-8',
          LARGEUR_BARRE
        )}
      >
        {/* ── Marque ─────────────────────────────────────────────────────── */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {liens && (
            <Sheet open={panneauOuvert} onOpenChange={setPanneauOuvert} modal={false}>
              <SheetTrigger asChild>
                {/*
                  ⚠️ `PanelLeft`, PAS UN HAMBURGER (maquette fournie) : les trois
                  traits annoncent une LISTE qui se déroule ; ce dessin annonce un
                  PANNEAU qui s'ouvre — et c'est bien ce qui se passe.
                */}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Sections"
                  aria-expanded={panneauOuvert}
                  className="md:hidden"
                >
                  <PanelLeft />
                </Button>
              </SheetTrigger>

              {/*
                ⚠️ LE PANNEAU S'ARRÊTE SOUS LA BARRE, qui reste visible et
                utilisable (demande du porteur, 2026-09-02 — c'est ce que fait la
                référence). D'où `top-[68px]`, `modal={false}` et pas de voile :
                un panneau modal fige le fond et recouvre l'en-tête, or c'est
                depuis l'en-tête qu'on le referme.

                ⚠️ ET PAS DE CROIX DEDANS : le bouton de la barre fait déjà la
                bascule. Deux commandes pour un seul geste, à quelques
                centimètres l'une de l'autre, se contredisent plus qu'elles
                n'aident.

                ⚠️ `onInteractOutside` EMPÊCHÉ : non modal, Radix traite le
                moindre clic extérieur comme un congé — y compris celui sur le
                bouton, qui rouvrirait aussitôt le panneau qu'il vient de fermer.

                ⚠️ IL RESTE CLAIR, là où la référence est noire : l'application
                entière est sur fond blanc, et un seul panneau inversé se lirait
                comme un autre produit.
              */}
              <SheetContent
                side="left"
                overlay={false}
                fermeture={false}
                onInteractOutside={(e) => e.preventDefault()}
                /* ⚠️ `h-auto` : la variante « left » pose `h-full`, qui vaut 100 % de la
                   fenêtre — avec `top-[68px]`, le panneau dépassait de 68 px par le
                   bas (mesuré). Ce sont `top` et `bottom` qui doivent le borner. */
                className="inset-y-auto bottom-0 top-[68px] h-auto w-full border-0 sm:max-w-full"
              >
                <SheetTitle className="sr-only">Sections de l&apos;administration</SheetTitle>
                <div className="px-2 pt-6">
                  {cloneElement(liens, {
                    variante: 'panneau',
                    onNavigation: () => setPanneauOuvert(false),
                  })}
                </div>
              </SheetContent>
            </Sheet>
          )}

          <Link to="/" className="shrink-0">
            <img src="/logo_edtpro.svg" alt="EDT Pro" className="h-9 w-auto" />
          </Link>

          {/*
            ⚠️ LE CONTEXTE NE PARAÎT QU'À PARTIR DE `lg` : entre `md` et `lg`, la
            marque et les trois zones se disputent déjà la largeur, et c'est lui
            qu'on peut perdre — le nom de la page est au centre.
          */}
          {titre && (
            <>
              <span aria-hidden="true" className="hidden h-6 w-px bg-border lg:block" />
              <span className="hidden truncate text-sm font-medium text-muted-foreground lg:block">
                {titre}
              </span>
            </>
          )}
        </div>

        {/* ── Navigation, au centre ──────────────────────────────────────── */}
        <div className="hidden md:block">{liens}</div>

        {/* ── Actions ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-2">
          {/* Ce que la page ajoute à la barre (un formateur invité y voit qui
              d'autre est sur l'emploi du temps). Rien hors d'une coquille. */}
          <EmplacementEnTete />
          {/*
            ═══ ⚠️ LIÉE À `/admin/messagerie` (2026-09-03) ═══ La messagerie
            (F10) est en ligne depuis le 2026-08-25 pour les directeurs ; ce
            bouton restait désactivé parce qu'il n'existait encore aucun
            ENDROIT où l'ouvrir depuis l'espace admin — pas parce que le module
            manquait. `PageMessagerieAdmin` héberge le même écran, hors de la
            coquille du directeur (barre latérale, année scolaire) qu'un
            administrateur n'a pas.

            ⚠️ LE BOUTON RESTE VISIBLE ET DÉSACTIVÉ AILLEURS (`/configuration`) :
            on ne le fait pas disparaître, pour ne pas déplacer les repères —
            seul son état change.
          */}
          {messagerie ? (
            <Button variant="outline" size="icon" className="relative" asChild>
              <Link to={messagerieUrl} aria-label="Messagerie">
                <Mail />
                {nonLus > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-card bg-primary px-1 text-[0.65rem] font-bold text-primary-foreground">
                    {nonLus > 99 ? '99+' : nonLus}
                  </span>
                )}
              </Link>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="icon"
              disabled
              aria-label="Messagerie (indisponible ici)"
              title="Messagerie — non disponible sur cet écran"
            >
              <Mail />
            </Button>
          )}

          <MenuCompte profilUrl={profilUrl} />
        </div>
      </div>
    </header>
  );
}

/**
 * L'avatar et son menu.
 *
 * ═══ ⚠️ LA DÉCONNEXION QUITTE LA BARRE POUR CE MENU ═══ (demande du porteur,
 * 2026-09-02.) C'est l'action la plus destructrice de l'écran — elle fait perdre
 * une saisie — et la plus rare. Elle demande désormais deux gestes, et se trouve
 * là où on la cherche. C'est déjà le choix fait pour la barre latérale de
 * l'application (`MenuUtilisateur`, 2026-08-16) : les deux espaces se rejoignent.
 *
 * ⚠️ LE MENU NOMME LE COMPTE avant de proposer d'en sortir : sur un écran
 * d'administration où l'on peut prendre la place d'un directeur, savoir QUI on
 * est n'est pas une évidence.
 */
function MenuCompte({ profilUrl }) {
  const navigate = useNavigate();

  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const utilisateur = session.data?.utilisateur;

  const deconnexion = useMutation({
    mutationFn: seDeconnecter,
    // Même si l'appel échoue, on renvoie vers la connexion : rester bloqué sur
    // une page dont la session est morte est pire.
    onSettled: () => navigate('/connexion'),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/*
          ⚠️ CARRÉ ARRONDI, PAS UN CERCLE (demande du porteur, 2026-09-02) : c'est
          la forme que porte déjà le menu du compte de la barre latérale
          (`MenuUtilisateur`) — et un rond, à côté de deux boutons carrés, se
          lisait comme un objet d'une autre famille.
        */}
        <Button variant="ghost" size="icon" aria-label="Mon compte">
          <Avatar className="h-8 w-8 rounded-lg">
            <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-semibold text-primary">
              {initiales(utilisateur?.nomComplet)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-semibold">
            {utilisateur?.nomComplet ?? 'Mon compte'}
          </span>
          {utilisateur?.email && (
            <span className="block truncate text-xs text-muted-foreground">
              {utilisateur.email}
            </span>
          )}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/*
          ⚠️ SEULEMENT SI `profilUrl` EST FOURNI (2026-09-03) : l'administrateur
          n'a pas de page de profil, et l'afficher quand même mènerait à un lien
          mort. L'espace formateur/stagiaire, lui, le passe.
        */}
        {profilUrl && (
          <DropdownMenuItem asChild>
            <Link to={profilUrl}>
              <UserRound />
              Mon profil
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem
          onSelect={() => deconnexion.mutate()}
          disabled={deconnexion.isPending}
          /* Rouge DOUX : l'action est irréversible, mais ordinaire — un rouge
             plein attirerait l'œil avant tout le reste de l'écran. */
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <LogOut />
          {deconnexion.isPending ? 'Déconnexion…' : 'Déconnexion'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
