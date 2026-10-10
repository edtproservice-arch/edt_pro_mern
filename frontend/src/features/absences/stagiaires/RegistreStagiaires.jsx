import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { File, FileSpreadsheet, FileText, Ticket, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import Alerte from '@/components/common/Alerte';
import TableauTriable from '@/components/common/TableauTriable';
import { MARGE_PAGE } from '@/components/common/apparenceGrille';
import { cn } from '@/lib/utils';
import ListeRepliable from '../ListeRepliable';
import { chargerRegistre, justifierAbsence, supprimerAbsence, telechargerBillets } from './api';
import ListeGroupes from './ListeGroupes';
import { grouperParGroupe } from './regroupementStagiaires';

/**
 * Le registre des absences et retards de l'année (F9).
 *
 * ═══ LES GROUPES EN LISTE, LE TABLEAU DANS CHAQUE GROUPE ═══ (2026-09-14,
 * demande du porteur.) La liste déroulante du groupe disparaît : chaque groupe
 * est une ligne qui se déplie sur le tableau de ses marquages — le même tableau
 * qu'avant, triable, qui passe en cartes sur un écran étroit.
 * ⚠️ `compact` (la fiche d'UN stagiaire) garde le seul tableau : il n'y a qu'un
 * groupe, et le déplier n'apprendrait rien.
 *
 * ⚠️ UN FORMATEUR N'Y VOIT QUE SES SÉANCES, et ne justifie rien : la
 * justification relève de l'encadrement, comme les sanctions qu'elle évite. Le
 * serveur fait la même coupe — l'écran n'en est que le reflet.
 */
export default function RegistreStagiaires({ encadrement, matricule = null, compact = false, groupeInitial = null }) {
  if (compact) return <TableauRegistre filtre={{ matricule }} encadrement={encadrement} compact />;
  if (encadrement) {
    return (
      <ListeGroupes
        detail={(groupe) => <TableauRegistre filtre={{ groupe }} encadrement />}
        groupeInitial={groupeInitial}
      />
    );
  }
  return <RegistreDuFormateur />;
}

/**
 * Le registre d'UN groupe (ou d'un stagiaire), chargé à l'ouverture.
 * ⚠️ PAR GROUPE, la limite de 500 marquages du serveur n'est plus un
 * problème : c'était elle qui obligeait à « filtrer par groupe pour tout voir ».
 */
function TableauRegistre({ filtre, encadrement, compact = false }) {
  const registre = useQuery({
    queryKey: ['absences-stagiaires', 'registre', filtre.groupe ?? null, filtre.matricule ?? null],
    queryFn: () => chargerRegistre(filtre),
    retry: false,
  });

  if (registre.error) return <Alerte type="erreur" titre="Registre indisponible">{registre.error.message}</Alerte>;

  const { absences = [], total = 0 } = registre.data ?? {};

  return (
    <div className="space-y-2">
      {/*
        ⚠️ AUTANT DE BILLETS QUE D'ABSENCES JUSTIFIÉES DANS CETTE LISTE
        (2026-09-29, demande du porteur : « si un seul stagiaire justifié il
        s'affiche une seule billet… si deux stagiaires justifient en même
        temps il s'affiche deux billets ») — un seul geste. Chaque ligne
        justifiée a AUSSI son icône billet (2026-10-01), pour n'en sortir qu'un.
      */}
      {encadrement && !compact && <TelechargerBillets absences={absences} />}
      {!compact && total > absences.length && (
        <p className="text-xs text-muted-foreground">
          {absences.length} marquages les plus récents sur {total}.
        </p>
      )}
      <TableauAbsences absences={absences} encadrement={encadrement} compact={compact} chargement={registre.isLoading} />
    </div>
  );
}

/**
 * Tous les billets de la liste d'un coup — une icône billet dans le coin DROIT,
 * au-dessus des icônes de chaque ligne (2026-10-01, demande du porteur).
 *
 * ⚠️ SEULEMENT À PARTIR DE DEUX ABSENCES JUSTIFIÉES : pour une seule, l'icône
 * de sa ligne télécharge déjà le même billet.
 */
function TelechargerBillets({ absences }) {
  const justifiees = absences.filter((a) => a.justifiee);
  if (justifiees.length < 2) return null;

  return (
    <div className="flex justify-end">
      <MenuBillet ids={justifiees.map((a) => a.id)} libelle={`Télécharger les ${justifiees.length} billets`}>
        <span className="ml-1 text-xs font-medium tabular-nums">{justifiees.length}</span>
      </MenuBillet>
    </div>
  );
}

/** L'icône billet de UNE absence justifiée, sur sa ligne. */
function BilletDeLigne({ absence }) {
  if (!absence.justifiee) return null;
  return <MenuBillet ids={[absence.id]} libelle={`Télécharger le billet de ${absence.nomComplet} du ${absence.date}`} />;
}

/** Une icône billet qui ouvre le choix du format, puis télécharge les billets `ids`. */
function MenuBillet({ ids, libelle, children = null }) {
  const telechargement = useMutation({
    mutationFn: (format) => telechargerBillets({ format, ids }),
    onError: (erreur) => toast.error('Téléchargement impossible', { description: erreur.message }),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={children ? 'sm' : 'icon'}
          className={cn('text-muted-foreground hover:text-foreground', children ? 'h-7 px-2' : 'size-7')}
          disabled={telechargement.isPending}
          aria-label={libelle}
          title={libelle}
        >
          {/* Pendant la préparation, l'indicateur prend la place du ticket (2026-10-10). */}
          {telechargement.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Ticket className="size-3.5" />}
          {children}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => telechargement.mutate('docx')}>
          <FileText className="size-3.5 text-blue-600" />
          Télécharger en Word
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => telechargement.mutate('pdf')}>
          <File className="size-3.5 text-red-600" />
          Télécharger en PDF
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => telechargement.mutate('xlsx')}>
          <FileSpreadsheet className="size-3.5 text-green-600" />
          Télécharger en Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * ⚠️ LE FORMATEUR N'A PAS ACCÈS À LA LISTE DES GROUPES (réservée à
 * l'encadrement) : ses groupes se déduisent de son registre, qui ne porte que
 * ses séances.
 */
function RegistreDuFormateur() {
  const registre = useQuery({
    queryKey: ['absences-stagiaires', 'registre', null, null],
    queryFn: () => chargerRegistre({}),
    retry: false,
  });

  if (registre.isLoading) return <p className="text-sm text-muted-foreground">Chargement…</p>;
  if (registre.error) return <Alerte type="erreur" titre="Registre indisponible">{registre.error.message}</Alerte>;

  const { absences = [], total = 0 } = registre.data ?? {};

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {total > absences.length ? `${absences.length} plus récents sur ${total}` : `${total} marquage(s)`} sur vos
        séances.
      </p>
      <ListeRepliable
        elements={grouperParGroupe(absences)}
        cleDe={(g) => g.groupe}
        texteRecherche={(g) => g.groupe}
        placeholder="Filtrer par groupe…"
        vide="Aucune absence ni aucun retard marqué sur vos séances."
        entete={(g) => ({
          titre: g.groupe,
          droite: <span className="text-muted-foreground">{g.absences.length} marquage(s)</span>,
        })}
        detail={(g) => <TableauAbsences absences={g.absences} encadrement={false} />}
      />
    </div>
  );
}

function TableauAbsences({ absences, encadrement, compact = false, chargement = false }) {
  return (
    <TableauTriable
      cartesSous="lg"
      collant={compact ? null : `-${MARGE_PAGE}px`}
      colonnes={colonnes({ encadrement, compact })}
      lignes={absences}
      cleLigne={(a) => a.id}
      vide={chargement ? 'Chargement…' : 'Aucune absence ni aucun retard marqué.'}
    />
  );
}

function colonnes({ encadrement, compact }) {
  const liste = [
    {
      id: 'date',
      entete: 'Date',
      tri: (a) => `${a.date}|${a.seance}`,
      rendu: (a) => (
        <span className="whitespace-nowrap text-xs">
          {a.date} <span className="text-muted-foreground">· {a.jour.slice(0, 3)} {a.seance}</span>
        </span>
      ),
    },
  ];
  if (!compact) {
    liste.push({
      id: 'stagiaire',
      entete: 'Stagiaire',
      tri: (a) => a.nomComplet,
      rendu: (a) => (
        <span className="text-xs">
          <span className="font-medium">{a.nomComplet}</span>
          <span className="block text-muted-foreground">
            {a.matricule} · {a.groupe}
          </span>
        </span>
      ),
    });
  }
  liste.push(
    {
      id: 'cours',
      entete: 'Cours',
      tri: (a) => a.module,
      rendu: (a) => <span className="text-xs">{a.module || '—'}</span>,
    },
    {
      id: 'type',
      entete: 'Type',
      aligne: 'centre',
      tri: (a) => a.type,
      rendu: (a) => <BadgeType type={a.type} />,
    },
    {
      id: 'justifiee',
      entete: 'Justifiée',
      aligne: 'centre',
      tri: (a) => (a.justifiee ? 1 : 0),
      rendu: (a) => (encadrement ? <Justification absence={a} /> : <span className="text-xs">{a.justifiee ? 'Oui' : 'Non'}</span>),
    },
    {
      id: 'motif',
      entete: 'Motif',
      rendu: (a) => (encadrement ? <Motif absence={a} /> : <span className="text-xs">{a.motif || '—'}</span>),
    }
  );
  if (encadrement) {
    liste.push({
      id: 'actions',
      entete: '',
      rendu: (a) => (
        <span className="flex items-center justify-end gap-0.5">
          <BilletDeLigne absence={a} />
          <Supprimer absence={a} />
        </span>
      ),
    });
  }
  return liste;
}

function BadgeType({ type }) {
  return (
    <span
      className={cn(
        'rounded-md border px-1.5 py-0.5 text-[0.7rem] font-medium',
        type === 'retard'
          ? 'border-warning/50 bg-warning/10 text-accent-orange-deep'
          : 'border-destructive/40 bg-destructive/10 text-destructive'
      )}
    >
      {type === 'retard' ? 'Retard' : 'Absence'}
    </span>
  );
}

function useEcriture(ecrire, succes) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ecrire,
    onSuccess: () => {
      // La note de discipline dépend de chaque justification : tout se relit.
      cache.invalidateQueries({ queryKey: ['absences-stagiaires'] });
      if (succes) toast.success(succes);
    },
    onError: (erreur) => toast.error('Modification impossible', { description: erreur.message }),
  });
}

function Justification({ absence }) {
  const ecriture = useEcriture((justifiee) => justifierAbsence(absence.id, { justifiee }));
  return (
    <Switch
      checked={absence.justifiee}
      disabled={ecriture.isPending}
      onCheckedChange={(valeur) => ecriture.mutate(valeur)}
      aria-label={`Justifier l’absence de ${absence.nomComplet} du ${absence.date}`}
    />
  );
}

function Motif({ absence }) {
  const [valeur, setValeur] = useState(absence.motif ?? '');
  const ecriture = useEcriture((motif) => justifierAbsence(absence.id, { motif }), 'Motif enregistré');
  return (
    <Input
      value={valeur}
      maxLength={255}
      placeholder="Motif…"
      className="h-7 min-w-32 text-xs"
      onChange={(e) => setValeur(e.target.value)}
      // À la sortie du champ : une écriture par frappe ferait un toast par lettre.
      onBlur={() => valeur.trim() !== (absence.motif ?? '') && ecriture.mutate(valeur.trim())}
    />
  );
}

function Supprimer({ absence }) {
  const ecriture = useEcriture(() => supprimerAbsence(absence.id), 'Marquage retiré');
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-destructive"
      disabled={ecriture.isPending}
      onClick={() => ecriture.mutate()}
      aria-label={`Retirer le marquage de ${absence.nomComplet} du ${absence.date}`}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}
