import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Check, ChevronDown, CircleHelp, Layers, Link2, Users, X } from 'lucide-react';
import { PAGES_PARTAGEABLES, libellePage, libelleSemaine, urlDePage } from 'shared/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Command as CommandPrimitive } from 'cmdk';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { libelleRole } from '@/features/admin/components/roles';
import BoutonPublier from '@/features/emploi/BoutonPublier';
import { couleurPresence } from '@/features/tempsReel/couleurs';
import { initiales } from '@/lib/initiales';
import { cn } from '@/lib/utils';
import {
  changerAccesGeneral,
  changerDroitMembre,
  chargerPartage,
  inviterSurPage,
  retirerMembre,
} from './api';
import DialoguePagesMembre from './DialoguePagesMembre';
import ListePagesDroits from './ListePagesDroits';

const LIBELLES_DROIT = {
  proprietaire: 'Accès complet',
  modifier: 'Peut modifier',
  consulter: 'Peut consulter',
};

/*
 * Ce que « modifier » et « consulter » veulent dire SUR CETTE PAGE. L'emploi du
 * temps a son vocabulaire (des séances) ; les autres pages, la phrase générale.
 */
const DESCRIPTIONS_DROIT = {
  emploi: {
    modifier: 'Pose, déplace et vide des séances',
    consulter: 'Voit la grille en direct, sans la modifier',
  },
  defaut: {
    modifier: 'Modifie la page, sous les mêmes contrôles que vous',
    consulter: 'La voit en direct, sans la modifier',
  },
};

/** Les droits qu'on peut accorder sur une page — « consulter » seul si elle est en lecture seule. */
const droitsDe = (page) =>
  PAGES_PARTAGEABLES[page]?.droitMax === 'consulter' ? ['consulter'] : ['modifier', 'consulter'];

/** Le sélecteur de droit d'une ligne — « Peut modifier ⌄ », comme Notion. */
function ChoixDroit({ valeur, onChoisir, onRetirer, desactive, page = 'emploi' }) {
  const descriptions = DESCRIPTIONS_DROIT[page] ?? DESCRIPTIONS_DROIT.defaut;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={desactive}>
        <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground">
          {LIBELLES_DROIT[valeur]}
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {droitsDe(page).map((droit) => (
          <DropdownMenuItem key={droit} onClick={() => onChoisir(droit)} className="items-start gap-2">
            <Check className={cn('mt-0.5 size-3.5', valeur !== droit && 'invisible')} />
            <div>
              <div className="text-xs font-medium">{LIBELLES_DROIT[droit]}</div>
              <div className="text-[0.7rem] text-muted-foreground">{descriptions[droit]}</div>
            </div>
          </DropdownMenuItem>
        ))}
        {onRetirer && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onRetirer}
              className="text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              Retirer l’accès
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AvatarPersonne({ id, nom }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold',
        couleurPresence(id).pastille
      )}
    >
      {initiales(nom)}
    </span>
  );
}

/**
 * Le champ d'invitation : les personnes choisies en puces, puis la recherche.
 *
 * ⚠️ PAS D'ADRESSE LIBRE, contrairement à Notion : on n'invite que des comptes
 * de l'établissement — formateurs et gestionnaires. Une adresse tapée à la main
 * serait soit un compte qu'on retrouve ici, soit quelqu'un qui ne peut pas
 * entrer de toute façon. La liste le dit, au lieu de laisser taper pour rien.
 */
function ChampInvitation({ candidats, choisis, onChoisis }) {
  const [recherche, setRecherche] = useState('');
  const [ouvert, setOuvert] = useState(false);
  const parId = useMemo(() => new Map(candidats.map((c) => [c.id, c])), [candidats]);
  const proposables = candidats.filter((c) => !choisis.includes(c.id));

  const choisir = (id) => {
    onChoisis([...choisis, id]);
    // Comme dans Gmail : la recherche se vide, la personne devient une puce.
    setRecherche('');
  };

  return (
    <Command className="relative overflow-visible bg-transparent" shouldFilter>
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1 rounded-md border bg-background px-2 py-1 text-sm',
          'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20'
        )}
      >
        {choisis.map((id) => (
          <Badge key={id} variant="secondary" className="gap-1 rounded-full py-0.5 pl-2 pr-0.5 font-normal">
            {parId.get(id)?.nom ?? id}
            <button
              type="button"
              onClick={() => onChoisis(choisis.filter((autre) => autre !== id))}
              aria-label={`Retirer ${parId.get(id)?.nom ?? ''}`}
              className="rounded-full p-0.5 hover:bg-muted-foreground/20"
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <CommandPrimitive.Input
          value={recherche}
          onValueChange={setRecherche}
          onFocus={() => setOuvert(true)}
          onBlur={() => setTimeout(() => setOuvert(false), 150)}
          onKeyDown={(evenement) => {
            // Retour arrière sur un champ vide retire la dernière puce.
            if (evenement.key === 'Backspace' && !recherche && choisis.length > 0) {
              onChoisis(choisis.slice(0, -1));
            }
          }}
          placeholder={choisis.length === 0 ? 'Formateurs ou gestionnaires, par nom ou adresse…' : ''}
          className="min-w-24 flex-1 bg-transparent py-0.5 outline-none placeholder:text-muted-foreground"
        />
      </div>

      {ouvert && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover shadow-md">
          <CommandList className="max-h-60">
            <CommandEmpty className="px-3 py-4 text-xs text-muted-foreground">
              {proposables.length === 0
                ? 'Tous les formateurs et gestionnaires de l’établissement ont déjà accès.'
                : 'Personne ne correspond. On n’invite que les comptes de l’établissement.'}
            </CommandEmpty>
            <CommandGroup>
              {proposables.map((candidat) => (
                <CommandItem
                  key={candidat.id}
                  // ⚠️ Nom + adresse : deux homonymes ne doivent pas partager la clé de cmdk.
                  value={`${candidat.nom} ${candidat.email}`}
                  keywords={[candidat.nom, candidat.email, libelleRole(candidat.role)]}
                  onMouseDown={(evenement) => evenement.preventDefault()}
                  onSelect={() => choisir(candidat.id)}
                  className="gap-2.5 py-1.5"
                >
                  <AvatarPersonne id={candidat.id} nom={candidat.nom} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{candidat.nom}</div>
                    <div className="truncate text-xs text-muted-foreground">{candidat.email}</div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{libelleRole(candidat.role)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </div>
      )}
    </Command>
  );
}

/**
 * « Pages : Emploi du temps + 2 ▾ » — les pages que l'invitation ouvre, CHACUNE
 * AVEC SON DROIT (étape d, puis 2026-09-13 : « le directeur sélectionne les
 * pages qu'il peut consulter, avec leur permission pour chaque page »).
 *
 * ═══ ⚠️ TOUJOURS VISIBLE, TOUTES LES PAGES LISTÉES (2026-09-12) ═══
 * La première version se masquait tant qu'aucune autre page n'était prête — et
 * le directeur, qui cherchait où choisir ses pages, ne trouvait rien : un choix
 * absent ne se distingue pas d'un choix qui n'existe pas.
 *
 * ═══ UNE CASE À COCHER NE SUFFISAIT PLUS (2026-09-13) ═══ Elle disait « oui ou
 * non » ; le droit, lui, était UN pour toute l'invitation. Chaque page porte
 * désormais « Aucun · Consulter · Modifier » (`ListePagesDroits`, partagée avec
 * « Gérer ses pages ») :
 *   - la page de la boîte ne peut pas passer à « Aucun » — elle est incluse ;
 *   - « Modifier » est éteint sur une page en lecture seule ;
 *   - une page pas encore prête est éteinte tout entière.
 *
 * ⚠️ UN POPOVER, PLUS UN MENU : une ligne porte trois boutons, et un menu
 * déroulant se referme au premier choix.
 */
function ChoixPages({ page, droits, onDroits }) {
  const autres = Object.entries(droits).filter(([cle, droit]) => cle !== page && droit).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs font-normal">
          {libellePage(page)}
          {autres > 0 && <span className="text-muted-foreground">+ {autres} page(s)</span>}
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="max-h-[min(28rem,var(--radix-popover-content-available-height))] w-[26rem] max-w-[calc(100vw-2rem)] overflow-y-auto p-3"
      >
        <p className="mb-2 text-xs text-muted-foreground">
          Les pages que l’invitation ouvre, et ce que la personne pourra y faire.
        </p>
        <ListePagesDroits
          valeurs={droits}
          obligatoire={page}
          onChanger={(cle, droit) => onDroits({ ...droits, [cle]: droit })}
        />
      </PopoverContent>
    </Popover>
  );
}

/** L'invitation de départ : la seule page de la boîte, au plus haut droit qu'elle accepte. */
const droitsDeDepart = (page) => ({ [page]: droitsDe(page)[0] });

/**
 * La boîte « Partager » d'une page — reprise de celle de Notion
 * (Phase 5bis, étape c, maquette fournie par le porteur le 2026-09-12).
 *
 * ═══ CE QUI CORRESPOND À QUOI ═══
 *   - le champ d'invitation → les formateurs et gestionnaires de l'établissement ;
 *   - « Accès complet »     → le directeur, propriétaire par son rôle ;
 *   - le groupe d'équipe    → les gestionnaires, qui CONSULTENT déjà par leur
 *     rôle (écran « Édition ») — la ligne le dit, sans quoi on les croirait
 *     exclus ;
 *   - « Accès général »     → restreint aux invités, ou tout l'établissement ;
 *   - l'onglet « Publier »  → la publication de la semaine, qui existait déjà :
 *     c'est le MÊME bouton (`BoutonPublier`), pas une seconde implémentation.
 *
 * ⚠️ AU DIRECTEUR SEUL : lui seul partage. Le serveur refuse de toute façon.
 */
export default function BoutonPartager({ page = 'emploi', semaine, publication, moi }) {
  const cache = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const [choisis, setChoisis] = useState([]);
  /*
   * Le droit de CHAQUE page de l'invitation — `{ emploi: 'modifier', absences:
   * 'consulter' }`. `null` : la page n'en fait pas partie. Sur une page en
   * lecture seule, le seul droit accordable est « consulter ».
   */
  const [droitsInvitation, setDroitsInvitation] = useState(() => droitsDeDepart(page));
  const pagesInvitation = Object.keys(droitsInvitation).filter((cle) => droitsInvitation[cle]);
  /*
   * L'invité dont on règle toutes les pages (« Gérer ses pages »). ⚠️ Gardé à
   * la fermeture : la boîte de dialogue s'anime en sortant, et son titre ne doit
   * pas devenir « Pages de undefined » pendant ce temps.
   */
  const [membreGere, setMembreGere] = useState(null);
  const [gererOuvert, setGererOuvert] = useState(false);
  // ⚠️ « Publier » n'a de sens que pour l'emploi du temps — une semaine se publie,
  // pas un calendrier ni une liste de salles.
  const avecPublication = page === 'emploi';

  const cle = ['partages', 'page', page];
  const partage = useQuery({
    queryKey: cle,
    queryFn: () => chargerPartage(page),
    // La boîte ne coûte rien tant qu'elle est fermée.
    enabled: ouvert,
    retry: false,
  });

  const appliquer = (reponse) => cache.setQueryData(cle, reponse);
  const surErreur = (erreur) => toast.error('Partage impossible', { description: erreur.message });

  const inviter = useMutation({
    mutationFn: () =>
      inviterSurPage(
        page,
        choisis,
        Object.fromEntries(pagesInvitation.map((cle) => [cle, droitsInvitation[cle]]))
      ),
    onSuccess: (reponse) => {
      appliquer(reponse);
      // Les AUTRES pages ont changé elles aussi : leur boîte se relira à l'ouverture.
      for (const autre of pagesInvitation) cache.invalidateQueries({ queryKey: ['partages', 'page', autre] });
      toast.success(`${choisis.length} personne(s) invitée(s)`, {
        description:
          pagesInvitation.length > 1
            ? `Sur ${pagesInvitation.length} pages. Elles sont prévenues dans leur messagerie, et les pages entrent dans leur menu dès qu’elles acceptent.`
            : 'Elles sont prévenues dans leur messagerie, et la page entre dans leur menu dès qu’elles acceptent.',
      });
      setChoisis([]);
      setDroitsInvitation(droitsDeDepart(page));
    },
    onError: surErreur,
  });
  const changer = useMutation({
    mutationFn: ({ id, droit }) => changerDroitMembre(page, id, droit),
    onSuccess: appliquer,
    onError: surErreur,
  });
  const retirer = useMutation({
    mutationFn: (id) => retirerMembre(page, id),
    onSuccess: (reponse) => {
      appliquer(reponse);
      toast.success('Accès retiré', { description: 'La page s’est refermée chez cette personne.' });
    },
    onError: surErreur,
  });
  const general = useMutation({
    mutationFn: ({ portee, droit }) => changerAccesGeneral(page, portee, droit),
    onSuccess: appliquer,
    onError: surErreur,
  });

  const donnees = partage.data;
  const etendu = donnees?.general?.portee === 'etablissement';

  const copierLien = async () => {
    // La semaine n'a de sens que pour l'emploi du temps.
    const suffixe = page === 'emploi' && semaine ? `?semaine=${encodeURIComponent(semaine)}` : '';
    const lien = `${window.location.origin}${urlDePage(page, 'modifier')}${suffixe}`;
    try {
      await navigator.clipboard.writeText(lien);
      toast.success('Lien copié', {
        description: 'Seules les personnes qui ont accès à la page pourront l’ouvrir.',
      });
    } catch {
      toast.error('Copie impossible', { description: lien });
    }
  };

  return (
    <>
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        {/*
          ⚠️ DISCRET, COMME DANS NOTION : dans la barre du haut, à côté de
          l'étoile et du « … », un bouton encadré pèserait plus que tout le reste
          de la barre. L'immeuble dit que la page appartient à l'établissement.
        */}
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-sm font-normal">
          <Building2 className="size-4" />
          Partager
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[31rem] max-w-[calc(100vw-2rem)] p-0"
        // La boîte reste ouverte derrière « Gérer ses pages » : on y revient après.
        onInteractOutside={(evenement) => gererOuvert && evenement.preventDefault()}
      >
        <Tabs defaultValue="partager">
          <div className="flex items-center justify-between border-b px-4">
            <TabsList className="h-auto gap-4 bg-transparent p-0">
              {[
                ['partager', 'Partager'],
                ...(avecPublication ? [['publier', 'Publier']] : []),
              ].map(([valeur, libelle]) => (
                <TabsTrigger
                  key={valeur}
                  value={valeur}
                  className="rounded-none border-b-2 border-transparent px-0 py-2.5 text-sm text-muted-foreground shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  {libelle}
                </TabsTrigger>
              ))}
            </TabsList>

            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex cursor-help items-center gap-1 text-xs text-muted-foreground">
                    <CircleHelp className="size-3.5" />
                    Comment ça marche
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-72">
                  Une personne invitée reçoit un message ; la page entre dans son menu dès qu’elle
                  accepte. « Peut modifier » agit sous les mêmes contrôles que vous ; « Peut
                  consulter » regarde en direct. Vous pouvez retirer un accès à tout moment : la page
                  se referme aussitôt chez la personne.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <TabsContent value="partager" className="mt-0 space-y-3 p-4">
            {partage.isError ? (
              <p className="text-sm text-destructive">{partage.error.message}</p>
            ) : partage.isLoading || !donnees ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : (
              <>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <ChampInvitation candidats={donnees.candidats} choisis={choisis} onChoisis={setChoisis} />
                  </div>
                  {/* Le droit sur la page de la BOÎTE ; les autres se règlent dans « Pages ». */}
                  {choisis.length > 0 && (
                    <ChoixDroit
                      page={page}
                      valeur={droitsInvitation[page]}
                      onChoisir={(droit) => setDroitsInvitation((avant) => ({ ...avant, [page]: droit }))}
                    />
                  )}
                  <Button
                    size="sm"
                    className="h-9 shrink-0"
                    disabled={choisis.length === 0 || inviter.isPending}
                    onClick={() => inviter.mutate()}
                  >
                    Inviter
                  </Button>
                </div>

                {/* Sous le champ, et TOUJOURS là : c'est ici qu'on choisit ce que l'invitation ouvre. */}
                <div className="-mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Layers className="size-3.5" />
                  Pages :
                  <ChoixPages page={page} droits={droitsInvitation} onDroits={setDroitsInvitation} />
                </div>

                <ul className="space-y-1">
                  {/* Le propriétaire, toujours en tête — sa ligne ne se modifie pas. */}
                  <li className="flex items-center gap-2.5 py-1">
                    <AvatarPersonne id={moi?.id} nom={moi?.nomComplet} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">
                        {moi?.nomComplet} <span className="text-muted-foreground">(Vous)</span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{moi?.email}</div>
                    </div>
                    <span className="px-2 text-xs text-muted-foreground">{LIBELLES_DROIT.proprietaire}</span>
                  </li>

                  {/*
                    ⚠️ LES GESTIONNAIRES CONSULTENT DÉJÀ PAR LEUR RÔLE. Sans cette
                    ligne, on les croirait exclus de la page tant qu'on ne les a
                    pas invités — et on les inviterait « à consulter » pour rien.
                  */}
                  {donnees.gestionnairesParRole > 0 && (
                    <li className="flex items-center gap-2.5 py-1">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Users className="size-4 text-muted-foreground" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">Gestionnaires de l’établissement</div>
                        <div className="truncate text-xs text-muted-foreground">
                          Par leur rôle · {donnees.gestionnairesParRole} personne(s)
                        </div>
                      </div>
                      <span className="px-2 text-xs text-muted-foreground">{LIBELLES_DROIT.consulter}</span>
                    </li>
                  )}

                  {donnees.membres.map((membre) => (
                    <li key={membre.id} className="flex items-center gap-2.5 py-1">
                      <AvatarPersonne id={membre.id} nom={membre.nom} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 truncate text-sm">
                          {membre.nom}
                          {/* Tant que l'invité n'a pas accepté, il n'a aucun accès :
                              la ligne le dit, sans quoi on croirait la page ouverte. */}
                          {membre.statut === 'en_attente' && (
                            <Badge variant="outline" className="h-5 px-1.5 text-[0.65rem] font-normal text-muted-foreground">
                              En attente
                            </Badge>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {libelleRole(membre.role)} · {membre.email}
                        </div>
                      </div>
                      {/*
                        ═══ « GÉRER SES PAGES » (2026-09-13) ═══ Un bouton dans la ligne,
                        pas une entrée du menu de droit : il porte le NOMBRE de pages de
                        la personne — c'est lui qui dit qu'elle en voit d'autres — et une
                        boîte de dialogue ouverte depuis un menu déroulant laisse, chez
                        Radix, le corps de page figé à la fermeture.
                      */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
                        onClick={() => {
                          setMembreGere(membre);
                          setGererOuvert(true);
                        }}
                        aria-label={`Gérer les pages de ${membre.nom}`}
                      >
                        <Layers className="size-3.5" />
                        {membre.pages > 1 ? `${membre.pages} pages` : 'Pages'}
                      </Button>
                      <ChoixDroit
                        page={page}
                        valeur={membre.droit}
                        desactive={changer.isPending || retirer.isPending}
                        onChoisir={(droit) => droit !== membre.droit && changer.mutate({ id: membre.id, droit })}
                        onRetirer={() => retirer.mutate(membre.id)}
                      />
                    </li>
                  ))}
                </ul>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Accès général</p>
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Building2 className="size-4 text-foreground" />
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 min-w-0 flex-1 justify-start gap-1 px-2 text-sm">
                          <span className="truncate">
                            {etendu ? 'Tous les formateurs et gestionnaires de l’établissement' : 'Seules les personnes invitées'}
                          </span>
                          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-80">
                        {[
                          ['restreint', 'Seules les personnes invitées', 'Personne d’autre que vous et vos invités'],
                          ['etablissement', 'Tout l’établissement', 'Tous les formateurs et gestionnaires, sans invitation'],
                        ].map(([portee, titre, detail]) => (
                          <DropdownMenuItem
                            key={portee}
                            className="items-start gap-2"
                            onClick={() => general.mutate({ portee, droit: donnees.general.droit })}
                          >
                            <Check className={cn('mt-0.5 size-3.5', donnees.general.portee !== portee && 'invisible')} />
                            <div>
                              <div className="text-xs font-medium">{titre}</div>
                              <div className="text-[0.7rem] text-muted-foreground">{detail}</div>
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {etendu && (
                      <ChoixDroit
                        page={page}
                        valeur={donnees.general.droit}
                        desactive={general.isPending}
                        onChoisir={(droit) => general.mutate({ portee: 'etablissement', droit })}
                      />
                    )}
                  </div>
                </div>
              </>
            )}

            <div className="flex items-center justify-end border-t pt-3">
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={copierLien}>
                <Link2 className="size-3.5" />
                Copier le lien
              </Button>
            </div>

            {/*
              ⚠️ CE QUI RESTE AU DIRECTEUR EST DIT ICI, là où on accorde le droit
              de modifier : sans cette phrase, on croirait donner les clés de
              toute la page.
            */}
            <p className="rounded-md bg-primary/5 px-3 py-2 text-xs text-primary">
              {avecPublication
                ? 'Publier, importer une semaine, réinitialiser et partager restent réservés au directeur.'
                : 'Partager reste réservé au directeur.'}
            </p>
          </TabsContent>

          {avecPublication && (
          <TabsContent value="publier" className="mt-0 space-y-3 p-4">
            <p className="text-sm">
              La semaine publiée s’ouvre par défaut chez les gestionnaires, les formateurs et les
              stagiaires. Elle ne cache rien : chacun garde accès à toutes les semaines.
            </p>
            <p className="text-xs text-muted-foreground">
              {publication?.semaine
                ? `Semaine publiée actuellement : ${libelleSemaine(publication.semaine)}.`
                : 'Aucune semaine n’est publiée pour cette année.'}
            </p>
            <BoutonPublier semaine={semaine} publication={publication} />
          </TabsContent>
          )}
        </Tabs>
      </PopoverContent>
    </Popover>

    {/*
      ⚠️ HORS DE LA BOÎTE, PAS DEDANS : rendue dans le contenu du popover, elle
      serait démontée avec lui au premier clic qui le referme.
    */}
    <DialoguePagesMembre membre={membreGere} ouvert={gererOuvert} onOuvert={setGererOuvert} />
    </>
  );
}
