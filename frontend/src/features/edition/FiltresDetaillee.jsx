import { Check, ChevronsUpDown, GraduationCap, ListFilter, X } from 'lucide-react';
import { JOURS } from 'shared/constants';
import { LIBELLES_NIVEAUX } from 'shared/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

/**
 * Les deux commandes de la vue détaillée : QUI, et QUAND.
 * (demande du porteur, 2026-08-26)
 *
 * ═══ ⚠️ DEUX QUESTIONS DIFFÉRENTES, DEUX COMMANDES ═══
 * « Montre-moi ces trois formateurs-là » et « montre-moi qui travaille le
 * lundi » ne se posent pas de la même façon : la première DÉSIGNE, la seconde
 * INTERROGE. Les mêler dans un seul champ obligerait à taper « Lundi » pour
 * filtrer par jour, et un groupe qui s'appellerait ainsi deviendrait
 * introuvable.
 */

/**
 * Le choix des sujets — un champ qui cherche ET une liste qui se coche.
 *
 * ⚠️ CHERCHER ET CHOISIR DANS LE MÊME ENDROIT. Un champ de recherche seul
 * demande de connaître le nom avant de commencer ; une liste seule oblige à
 * faire défiler dix-sept entrées. Le `Command` de shadcn fait les deux : on
 * ouvre, on voit tout, et on tape pour réduire.
 *
 * ⚠️ AUCUN CHOIX = TOUT LE MONDE, jamais « personne ». C'est la règle déjà posée
 * pour les facettes de `filtrerSujets` : une sélection vide ne filtre rien.
 */
export function ChoixSujets({ sujets, choisis, libelle, entete, onChanger }) {
  const basculer = (sujet) =>
    onChanger(choisis.includes(sujet) ? choisis.filter((s) => s !== sujet) : [...choisis, sujet]);

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            role="combobox"
            className="h-8 w-64 justify-between text-xs font-normal"
          >
            <span className="truncate">
              {choisis.length === 0
                ? `Tous les ${entete.toLowerCase()}s`
                : choisis.length === 1
                  ? libelle(choisis[0])
                  : `${choisis.length} ${entete.toLowerCase()}s choisis`}
            </span>
            <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-72 p-0" align="start">
          <Command
            /*
              ⚠️ LE FILTRE PORTE SUR LE LIBELLÉ, PAS SUR LA VALEUR. Sur l'axe
              formateur, la valeur est un MATRICULE : taper un nom ne trouverait
              rien. `value` reçoit donc le libellé, et `keywords` la valeur —
              on peut ainsi chercher par l'un ou par l'autre.
            */
            filter={(valeur, recherche) =>
              valeur.toLowerCase().includes(recherche.toLowerCase()) ? 1 : 0
            }
          >
            <CommandInput placeholder={`Rechercher un ${entete.toLowerCase()}…`} className="h-9" />

            <CommandList>
              <CommandEmpty>Aucune correspondance.</CommandEmpty>

              <CommandGroup>
                {sujets.map((sujet) => {
                  const retenu = choisis.includes(sujet);

                  return (
                    <CommandItem
                      key={sujet}
                      value={libelle(sujet)}
                      keywords={[sujet]}
                      onSelect={() => basculer(sujet)}
                      className="text-xs"
                    >
                      <Check className={cn('mr-2 size-3.5', retenu ? 'opacity-100' : 'opacity-0')} />
                      <span className="truncate">{libelle(sujet)}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* ⚠️ « Tout afficher » n'apparaît QUE s'il y a un choix à défaire : un
          bouton toujours là mais sans effet la moitié du temps fait hésiter. */}
      {choisis.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-xs text-muted-foreground"
          onClick={() => onChanger([])}
        >
          <X className="size-3.5" />
          Tout afficher
        </Button>
      )}
    </div>
  );
}

/**
 * Le filtre par filière, niveau et année — l'IDENTITÉ des groupes.
 * ← demande du porteur, 2026-08-26.
 *
 * ═══ ⚠️ IL NE SE CONFOND PAS AVEC « FILTRER » ═══
 * L'autre bouton interroge le PLANNING — « qui a cours le lundi ». Celui-ci
 * interroge la CARTE : à quelle filière, à quel niveau, à quelle année ce groupe
 * appartient. Un groupe sans une seule séance de la semaine reste donc trouvable
 * — c'est même le cas qu'on cherche quand on se demande si une promotion a été
 * oubliée. Les mêler dans un seul panneau ferait croire à une seule question.
 *
 * ⚠️ IL N'EXISTE QUE SUR L'AXE GROUPE : un formateur n'a ni filière ni année, et
 * une salle encore moins.
 */
export function FiltreGroupes({ facettes, valeurs, onChanger }) {
  const actifs = valeurs.filieres.length + valeurs.niveaux.length + valeurs.annees.length;

  const basculer = (cle, valeur) => {
    const liste = valeurs[cle];
    onChanger({
      ...valeurs,
      [cle]: liste.includes(valeur) ? liste.filter((v) => v !== valeur) : [...liste, valeur],
    });
  };

  /* ⚠️ AUCUNE FACETTE À PROPOSER = PAS DE BOUTON. Un panneau qui s'ouvre sur
     trois sections vides fait douter du filtre, alors que ce sont les cartes des
     groupes qui n'ont pas encore de filière. */
  if (facettes.filieres.length === 0 && facettes.niveaux.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <GraduationCap className="size-3.5" />
          Filière
          {actifs > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[0.6rem] tabular-nums">
              {actifs}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-72 p-3" align="start">
        {facettes.niveaux.length > 0 && (
          <>
            <p className="mb-2 text-xs font-semibold">Niveau</p>
            <div className="flex flex-wrap gap-1">
              {facettes.niveaux.map((niveau) => (
                <Button
                  key={niveau}
                  variant={valeurs.niveaux.includes(niveau) ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={valeurs.niveaux.includes(niveau)}
                  /* ⚠️ LE SIGLE SEUL N'EST PARLANT QUE POUR L'HABITUÉ : « TS »,
                     « Q », « BP ». L'infobulle donne le mot entier. */
                  title={LIBELLES_NIVEAUX[niveau] ?? niveau}
                  className="h-7 px-2 text-[0.7rem]"
                  onClick={() => basculer('niveaux', niveau)}
                >
                  {niveau}
                </Button>
              ))}
            </div>
          </>
        )}

        {facettes.annees.length > 0 && (
          <>
            <Separator className="my-3" />
            <p className="mb-2 text-xs font-semibold">Année de formation</p>
            <div className="flex flex-wrap gap-1">
              {facettes.annees.map((annee) => (
                <Button
                  key={annee}
                  variant={valeurs.annees.includes(annee) ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={valeurs.annees.includes(annee)}
                  className="h-7 px-2 text-[0.7rem]"
                  onClick={() => basculer('annees', annee)}
                >
                  {annee === '1' ? '1re' : `${annee}e`} année
                </Button>
              ))}
            </div>
          </>
        )}

        {facettes.filieres.length > 0 && (
          <>
            <Separator className="my-3" />
            <p className="mb-2 text-xs font-semibold">Filière</p>
            {/* ⚠️ EN LISTE VERTICALE, pas en jetons : les libellés DRIF montent à
                60 caractères (« Génie Mécanique option Etudes et Méthodes… ») et
                une rangée de jetons deviendrait illisible. */}
            <div className="max-h-48 space-y-1 overflow-y-auto scrollbar-fine">
              {facettes.filieres.map(({ valeur, libelle }) => (
                <Button
                  key={valeur}
                  variant={valeurs.filieres.includes(valeur) ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={valeurs.filieres.includes(valeur)}
                  className="h-auto w-full justify-start whitespace-normal py-1 text-left text-[0.7rem] leading-snug"
                  onClick={() => basculer('filieres', valeur)}
                >
                  {libelle}
                </Button>
              ))}
            </div>
          </>
        )}

        {actifs > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-7 w-full text-xs text-muted-foreground"
            onClick={() => onChanger({ filieres: [], niveaux: [], annees: [] })}
          >
            Effacer le filtre
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Le filtre par jour et par créneau.
 *
 * ⚠️ IL NE CHOISIT PAS DES CASES, IL CHOISIT DES SUJETS. « Lundi » ne masque pas
 * les autres colonnes du tableau : il ne garde que CEUX QUI ONT COURS ce
 * jour-là. Masquer les colonnes donnerait des emplois du temps amputés, qu'on
 * lirait comme des grilles vides.
 */
export function FiltreSeances({ creneaux, jours, creneauxProposes, onChanger }) {
  const actifs = jours.length + creneaux.length;

  const basculer = (liste, valeur) =>
    liste.includes(valeur) ? liste.filter((v) => v !== valeur) : [...liste, valeur];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <ListFilter className="size-3.5" />
          Filtrer
          {actifs > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[0.6rem] tabular-nums">
              {actifs}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-64 p-3" align="start">
        <p className="mb-2 text-xs font-semibold">Jours</p>
        <div className="flex flex-wrap gap-1">
          {JOURS.map((jour) => (
            <Button
              key={jour}
              variant={jours.includes(jour) ? 'default' : 'outline'}
              size="sm"
              aria-pressed={jours.includes(jour)}
              className="h-7 px-2 text-[0.7rem]"
              onClick={() => onChanger({ jours: basculer(jours, jour), creneaux })}
            >
              {jour.slice(0, 3)}
            </Button>
          ))}
        </div>

        <Separator className="my-3" />

        <p className="mb-2 text-xs font-semibold">Créneaux</p>
        <div className="flex flex-wrap gap-1">
          {creneauxProposes.map((creneau) => (
            <Button
              key={creneau}
              variant={creneaux.includes(creneau) ? 'default' : 'outline'}
              size="sm"
              aria-pressed={creneaux.includes(creneau)}
              className="h-7 px-2 text-[0.7rem]"
              onClick={() => onChanger({ jours, creneaux: basculer(creneaux, creneau) })}
            >
              {creneau}
            </Button>
          ))}
        </div>

        {/*
          ⚠️ CE QUE LE FILTRE FAIT, ÉCRIT EN TOUTES LETTRES. « Lundi » pourrait
          se comprendre comme « ne montre que la colonne du lundi » : la phrase
          lève le doute une fois pour toutes.
        */}
        <p className="mt-3 text-[0.65rem] leading-snug text-muted-foreground">
          Ne garde que ceux qui ont cours sur ces jours et ces créneaux. Rien de coché = tout.
        </p>

        {actifs > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-7 w-full text-xs text-muted-foreground"
            onClick={() => onChanger({ jours: [], creneaux: [] })}
          >
            Effacer le filtre
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
