import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Building2, Info, Loader2, Megaphone, Send, Siren, Trash2, Users } from 'lucide-react';
import { ROLES } from 'shared/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import SelecteurDate from '@/components/common/SelecteurDate';
import CadreReglage from '@/features/parametres/CadreReglage';
import ChoixMultiple from '@/features/parametres/ChoixMultiple';
import { NAVIGATION, NAVIGATION_FORMATEUR, NAVIGATION_STAGIAIRE } from '@/components/layout/navigation';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { chargerContexte } from '@/features/emploi/api';
import { recupererSession } from '@/features/auth/api';
import {
  chargerAnnoncesPubliees,
  chargerChoixAnnonce,
  chargerEtablissementsAnnonce,
  publierAnnonce,
  publierAnnonceAdmin,
  retirerAnnonce,
} from './api';

/**
 * ═══ ANNONCES — ÉCRIRE DANS LE BANDEAU PASSANT ═══ (2026-10-10, demande du
 * porteur.) Une note ou une information courte, avec son degré d'importance :
 * elle défile dans le bandeau de ses destinataires jusqu'à sa date de fin, et
 * part en même temps dans leur messagerie.
 *
 *   - administrateur → directeurs (tous, ou ceux des établissements choisis) ;
 *   - directeur      → formateurs de l'établissement ;
 *   - gestionnaire   → stagiaires de l'établissement.
 *
 * La cible n'est pas un choix de l'écran : le serveur la déduit du rôle. Elle
 * est seulement RAPPELÉE ici, pour qu'on sache qui va lire.
 *
 * @param {boolean} [admin] — l'espace d'administration (`/admin/annonces`).
 */
export const IMPORTANCES = {
  info: {
    libelle: 'Information',
    aide: 'À titre informatif',
    icone: Info,
    classes: 'border-primary/40 bg-primary/10 text-primary',
    choisi: 'border-primary',
    bandeau: 'border-primary/30 bg-primary/10',
  },
  importante: {
    libelle: 'Importante',
    aide: 'À lire sans tarder',
    icone: AlertTriangle,
    classes: 'border-warning/50 bg-warning/20 text-foreground',
    choisi: 'border-warning',
    bandeau: 'border-warning/40 bg-warning/15',
  },
  urgente: {
    libelle: 'Urgente',
    aide: 'Bandeau rouge, en tête',
    icone: Siren,
    classes: 'border-destructive/50 bg-destructive/15 text-destructive',
    choisi: 'border-destructive',
    bandeau: 'border-destructive/40 bg-destructive/10',
  },
};

/*
 * ═══ LES PAGES QU'UNE ANNONCE PEUT OUVRIR (2026-10-10) ═══ Celles du
 * DESTINATAIRE, pas de l'auteur : un formateur ne peut ouvrir ni l'Édition ni
 * les Paramètres, et un lien vers elles le renverrait à son accueil. Les listes
 * viennent de `navigation.js`, la définition unique des menus.
 */
const CIBLE_DE = { [ROLES.ADMIN]: ROLES.DIRECTEUR, [ROLES.DIRECTEUR]: ROLES.FORMATEUR, [ROLES.GESTIONNAIRE]: ROLES.STAGIAIRE };
const MESSAGERIE = { titre: 'Messagerie', url: '/app/messagerie' };
const PAGES_PAR_CIBLE = {
  [ROLES.DIRECTEUR]: [
    { groupe: 'Pages', pages: [MESSAGERIE, ...NAVIGATION.filter((e) => !e.sousMenu)] },
    ...NAVIGATION.filter((e) => e.sousMenu).map((e) => ({ groupe: e.titre, pages: e.sousMenu })),
  ],
  [ROLES.FORMATEUR]: [{ groupe: 'Pages du formateur', pages: [...NAVIGATION_FORMATEUR, MESSAGERIE] }],
  [ROLES.STAGIAIRE]: [{ groupe: 'Pages du stagiaire', pages: [...NAVIGATION_STAGIAIRE, MESSAGERIE] }],
};

/** La page liée : « Aucune » par défaut, sinon un clic sur l'annonce y mène. */
function ChoixPageLiee({ cible, valeur, onChange }) {
  const groupes = PAGES_PAR_CIBLE[cible] ?? [];
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-sm">
      <Label htmlFor="lien-annonce">
        Page liée <span className="font-normal text-muted-foreground">(facultatif)</span>
      </Label>
      <Select value={valeur || 'aucune'} onValueChange={(v) => onChange(v === 'aucune' ? '' : v)}>
        <SelectTrigger id="lien-annonce" className="h-9 bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="aucune">Aucune — l’annonce ne mène nulle part</SelectItem>
          {groupes.map(({ groupe, pages }) => (
            <SelectGroup key={groupe}>
              <SelectLabel>{groupe}</SelectLabel>
              {pages.map((page) => (
                <SelectItem key={page.url} value={page.url}>
                  {page.titrePage ?? page.titre}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Un clic sur l’annonce, dans le bandeau ou la messagerie, ouvrira cette page.</p>
    </div>
  );
}

/** « Les directeurs de tout le réseau », « 3 groupe(s) choisi(s) »… */
function resumeDestinataires({ admin, role, estGestionnaire, etablissements, vises }) {
  if (admin) {
    return etablissements.length > 0 ? 'Les directeurs des établissements choisis' : 'Les directeurs de tout le réseau';
  }
  if (vises.length > 0) return estGestionnaire ? `${vises.length} groupe(s) choisi(s)` : `${vises.length} formateur(s) choisi(s)`;
  return role === ROLES.GESTIONNAIRE ? 'Tous les stagiaires' : 'Tous les formateurs';
}

/** La ligne telle qu'elle défilera — même teinte, même icône que le bandeau réel. */
function Apercu({ texte, importance, lienTitre }) {
  const { icone: Icone, bandeau } = IMPORTANCES[importance] ?? IMPORTANCES.info;
  const teinte = { urgente: 'text-destructive', importante: 'text-warning', info: 'text-primary' }[importance];
  return (
    <div className={cn('flex h-8 items-center overflow-hidden rounded-md border text-xs', bandeau)}>
      <span className="flex h-full shrink-0 items-center gap-1.5 border-r border-inherit px-3 font-semibold">
        <Megaphone className={cn('size-3.5', teinte)} />À la une
      </span>
      <span className="flex min-w-0 items-center gap-1.5 px-3">
        <Icone className={cn('size-3.5 shrink-0', teinte)} />
        {importance !== 'info' && (
          <strong className={cn('font-semibold uppercase', teinte)}>{importance === 'urgente' ? 'Urgent' : 'Important'}</strong>
        )}
        <span className={cn('truncate', texte.trim() ? 'font-medium' : 'italic text-muted-foreground')}>
          {texte.trim() ? texte.replace(/\s+/g, ' ') : 'Votre message apparaîtra ici…'}
        </span>
        {lienTitre && (
          <span className={cn('shrink-0 font-semibold underline underline-offset-4', teinte)}>· {lienTitre} ↗</span>
        )}
      </span>
    </div>
  );
}

const CIBLE = {
  [ROLES.ADMIN]: 'les directeurs',
  [ROLES.DIRECTEUR]: 'les formateurs de l’établissement',
  [ROLES.GESTIONNAIRE]: 'les stagiaires de l’établissement',
};

export default function PageAnnonces({ admin = false }) {
  const client = useQueryClient();
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const role = admin ? ROLES.ADMIN : session.data?.utilisateur?.role === ROLES.GESTIONNAIRE ? ROLES.GESTIONNAIRE : ROLES.DIRECTEUR;

  const publiees = useQuery({ queryKey: ['annonces-publiees'], queryFn: chargerAnnoncesPubliees, retry: false });

  const [texte, setTexte] = useState('');
  const [importance, setImportance] = useState('info');
  // Programmer : une date de début (aujourd'hui par défaut) et une date de fin.
  const [debut, setDebut] = useState(() => enTexte(new Date()));
  const [fin, setFin] = useState(() => enTexte(new Date(Date.now() + 7 * 86400000)));
  const [etablissements, setEtablissements] = useState([]);
  // Formateurs (directeur) ou groupes (gestionnaire) visés — VIDE = TOUS, le défaut.
  const [vises, setVises] = useState([]);
  // La page où mène un clic sur l'annonce — facultative.
  const [lien, setLien] = useState('');
  const estGestionnaire = role === ROLES.GESTIONNAIRE;

  const publication = useMutation({
    mutationFn: () => {
      const page = PAGES_PAR_CIBLE[CIBLE_DE[role]].flatMap((g) => g.pages).find((x) => x.url === lien);
      const corps = { texte: texte.trim(), importance, debut, fin, lien, lienTitre: page?.titre ?? '' };
      if (admin) return publierAnnonceAdmin({ ...corps, etablissementIds: etablissements });
      return publierAnnonce({ ...corps, [estGestionnaire ? 'groupes' : 'matricules']: vises });
    },
    onSuccess: (resultat) => {
      toast.success(resultat.programmee ? 'Annonce programmée' : 'Annonce publiée', {
        description: resultat.programmee
          ? `Elle s’affichera le ${afficher(debut)} — la copie en messagerie partira ce jour-là.`
          : `${resultat.remis} destinataire(s) — dans leur bandeau et leur messagerie.`,
      });
      setTexte('');
      setImportance('info');
      setVises([]);
      setLien('');
      setDebut(enTexte(new Date()));
      client.invalidateQueries({ queryKey: ['annonces-publiees'] });
    },
    onError: (erreur) => toast.error('Publication impossible', { description: erreur.message }),
  });

  const retrait = useMutation({
    mutationFn: retirerAnnonce,
    onSuccess: () => {
      toast.success('Annonce retirée du bandeau');
      client.invalidateQueries({ queryKey: ['annonces-publiees'] });
    },
    onError: (erreur) => toast.error('Retrait impossible', { description: erreur.message }),
  });

  const aujourdhui = enTexte(new Date());
  const programmee = debut > aujourdhui;
  const valide = texte.trim().length > 0 && debut >= aujourdhui && fin >= debut;

  return (
    <CadreReglage titre="Annonces" description={`Une note ou une information pour ${CIBLE[role]}, dans leur bandeau et leur messagerie.`}>
      <div className="space-y-6">
        {/*
          ═══ LE FORMULAIRE EN TROIS TEMPS (2026-10-10, demande du porteur :
          « réorganiser cette partie et améliorer le style ») ═══ Le message,
          son importance, puis QUAND et À QUI — chaque champ avec son libellé
          AU-DESSUS (il se collait à gauche de son bouton). Un aperçu montre la
          ligne telle qu'elle défilera dans le bandeau, à sa couleur.
        */}
        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <header className="flex items-center gap-3 border-b bg-muted/30 px-5 py-3">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Megaphone className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Nouvelle annonce</h3>
              <p className="text-xs text-muted-foreground">Pour {CIBLE[role]} — dans leur bandeau et leur messagerie.</p>
            </div>
          </header>

          <div className="space-y-5 p-5">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="texte-annonce">Message</Label>
                <span className={cn('text-xs tabular-nums', texte.length > 450 ? 'text-warning' : 'text-muted-foreground')}>
                  {texte.length} / 500
                </span>
              </div>
              <Textarea
                id="texte-annonce"
                value={texte}
                onChange={(e) => setTexte(e.target.value)}
                maxLength={500}
                rows={3}
                className="resize-none"
                placeholder="Ex. : Réunion pédagogique jeudi à 10 h en salle de conférence."
              />
            </div>

            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-sm font-medium">Degré d’importance</legend>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Degré d’importance">
                {Object.entries(IMPORTANCES).map(([valeur, { libelle, aide, icone: Icone, classes, choisi }]) => {
                  const actif = importance === valeur;
                  return (
                    <button
                      key={valeur}
                      type="button"
                      role="radio"
                      aria-checked={actif}
                      onClick={() => setImportance(valeur)}
                      className={cn(
                        'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors',
                        actif ? cn(classes, choisi) : 'border-border hover:bg-muted/60'
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-md',
                          actif ? 'bg-background/70' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        <Icone className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{libelle}</span>
                        <span className={cn('block text-xs', actif ? 'opacity-80' : 'text-muted-foreground')}>{aide}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="debut-annonce">À partir du</Label>
                {/* Le calendrier shadcn de l'application, pas le sélecteur natif du navigateur. */}
                <SelecteurDate
                  id="debut-annonce"
                  valeur={debut}
                  onChange={(jour) => {
                    setDebut(jour);
                    // La fin suit : elle ne précède jamais le début.
                    if (fin < jour) setFin(jour);
                  }}
                  effacable={false}
                  joursDesactives={{ before: new Date(`${aujourdhui}T00:00:00`) }}
                  aria-label="À partir du"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fin-annonce">Jusqu’au</Label>
                <SelecteurDate
                  id="fin-annonce"
                  valeur={fin}
                  onChange={setFin}
                  effacable={false}
                  joursDesactives={{ before: new Date(`${debut}T00:00:00`) }}
                  aria-label="Jusqu’au"
                />
              </div>

              {admin && <ChoixEtablissements selection={etablissements} onChange={setEtablissements} />}
              {!admin && session.data && (
                <ChoixDestinataires groupes={estGestionnaire} selection={vises} onChange={setVises} />
              )}
            </div>

            <ChoixPageLiee cible={CIBLE_DE[role]} valeur={lien} onChange={setLien} />

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Aperçu dans le bandeau</p>
              <Apercu
                texte={texte}
                importance={importance}
                lienTitre={PAGES_PAR_CIBLE[CIBLE_DE[role]].flatMap((g) => g.pages).find((x) => x.url === lien)?.titre}
              />
            </div>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3">
            <p className="text-xs text-muted-foreground">
              <strong className="font-medium text-foreground">{resumeDestinataires({ admin, role, estGestionnaire, etablissements, vises })}</strong>
              {' '}·{' '}
              {programmee ? `programmée du ${afficher(debut)} au ${afficher(fin)}` : `jusqu’au ${afficher(fin)}`} · copie en
              messagerie {programmee ? 'le jour du début' : 'immédiate'}
            </p>
            <Button onClick={() => publication.mutate()} disabled={!valide || publication.isPending}>
              {publication.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Publier
            </Button>
          </footer>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Mes annonces</h3>
          {(publiees.data?.annonces ?? []).length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <Megaphone className="size-4" />
              Aucune annonce publiée.
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {publiees.data.annonces.map((annonce) => {
                const { libelle, icone: Icone, classes } = IMPORTANCES[annonce.importance] ?? IMPORTANCES.info;
                const etat = annonce.retiree
                  ? 'Retirée'
                  : annonce.fin < aujourdhui
                    ? 'Expirée'
                    : annonce.debut > aujourdhui
                      ? 'Programmée'
                      : 'En cours';
                return (
                  <li key={annonce.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={cn('gap-1', classes)}>
                          <Icone className="size-3" />
                          {libelle}
                        </Badge>
                        <Badge variant={etat === 'En cours' ? 'default' : 'outline'} className={etat === 'En cours' ? '' : 'text-muted-foreground'}>
                          {etat}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          du {afficher(annonce.debut)} au {afficher(annonce.fin)} · {annonce.destinataires} destinataire(s)
                          {annonce.groupes?.length > 0 && ` · ${annonce.groupes.join(', ')}`}
                          {annonce.matricules?.length > 0 && ` · ${annonce.matricules.length} formateur(s) choisi(s)`}
                          {annonce.lien && ` · → ${annonce.lienTitre || annonce.lien}`}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm">{annonce.texte}</p>
                    </div>
                    {(etat === 'En cours' || etat === 'Programmée') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={retrait.isPending}
                        onClick={() => retrait.mutate(annonce.id)}
                        title={
                          etat === 'Programmée'
                            ? 'Annuler — elle ne s’affichera pas et aucun message ne partira'
                            : 'Retirer du bandeau — les messages déjà remis restent'
                        }
                      >
                        <Trash2 className="size-4" />
                        {etat === 'Programmée' ? 'Annuler' : 'Retirer'}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </CadreReglage>
  );
}

/**
 * Le directeur choisit ses formateurs, le gestionnaire ses groupes (2026-10-10,
 * demande du porteur : « par défaut tous les formateurs et tous les groupes »).
 * ⚠️ AUCUNE CASE COCHÉE = TOUS : c'est le défaut, et le libellé le dit. Les
 * groupes portent leur mode — d'où le filtre Alterné / Résidentiel de `ChoixMultiple`.
 */
function ChoixDestinataires({ groupes, selection, onChange }) {
  const choix = useQuery({ queryKey: ['annonces-choix'], queryFn: chargerChoixAnnonce, retry: false });
  // L'identité des groupes (filière, niveau, année) — celle qu'utilisent Édition et Documents.
  const contexte = useQuery({ queryKey: ['emploi', 'contexte'], queryFn: chargerContexte, enabled: groupes, retry: false });
  const nature = groupes ? 'groupe' : 'formateur';

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{groupes ? 'Groupes' : 'Formateurs'}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 w-full justify-start gap-2 bg-card font-normal">
            <Users className="size-4 shrink-0 text-muted-foreground" />
            {selection.length === 0 ? `Tous les ${nature}s` : `${selection.length} ${nature}(s) choisi(s)`}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-2 p-3">
          <ChoixMultiple
            sujets={choix.data?.choix ?? []}
            selection={selection}
            onChange={onChange}
            libelle={groupes ? 'Groupes' : 'Formateurs'}
            identites={groupes ? contexte.data?.groupesIdentites ?? null : null}
          />
          <p className="text-xs text-muted-foreground">Aucune case cochée : tous les {nature}s.</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** L'administrateur vise tout le réseau, ou quelques établissements. */
function ChoixEtablissements({ selection, onChange }) {
  const liste = useQuery({ queryKey: ['annonces-etablissements'], queryFn: chargerEtablissementsAnnonce, retry: false });
  const [filtre, setFiltre] = useState('');
  const tous = liste.data?.etablissements ?? [];
  const recherche = filtre.trim().toLowerCase();
  const visibles = tous.filter((e) => `${e.nom} ${e.detail ?? ''}`.toLowerCase().includes(recherche));

  /* ⚠️ `selection` porte les IDENTIFIANTS envoyés au serveur ; une ligne en
     regroupe plusieurs (un établissement en plusieurs fiches) : elle est cochée
     quand ses fiches le sont toutes, et les coche ou décoche ensemble. */
  const cochee = (e) => e.ids.every((id) => selection.includes(id));
  const basculer = (e) =>
    onChange(cochee(e) ? selection.filter((id) => !e.ids.includes(id)) : [...new Set([...selection, ...e.ids])]);
  const nombre = tous.filter(cochee).length;

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Établissements</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 w-full justify-start gap-2 bg-card font-normal">
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{nombre === 0 ? 'Tout le réseau' : `${nombre} établissement(s)`}</span>
          </Button>
        </PopoverTrigger>
        {/* Plus large, et le nom ENTIER sur plusieurs lignes : les noms OFPPT
            commencent tous par « CENTRE DE FORMATION… » et ne se distinguent qu'à la fin. */}
        <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-2rem)] space-y-2 p-3">
          <Input value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Filtrer…" className="h-8" />
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {visibles.length === 0 && <p className="px-1 py-2 text-sm text-muted-foreground">Aucun établissement.</p>}
            {visibles.map((etablissement) => (
              <label
                key={etablissement.cle}
                className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-muted"
              >
                <Checkbox className="mt-0.5" checked={cochee(etablissement)} onCheckedChange={() => basculer(etablissement)} />
                <span className="min-w-0">
                  <span className="block text-sm leading-snug">{etablissement.nom}</span>
                  {etablissement.detail && (
                    <span className="block text-xs text-muted-foreground">{etablissement.detail}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          {selection.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 w-full text-xs" onClick={() => onChange([])}>
              Revenir à tout le réseau
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function enTexte(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}

const afficher = (jour) =>
  new Date(`${jour}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
