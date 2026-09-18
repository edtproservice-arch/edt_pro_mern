import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import Alerte from '@/components/common/Alerte';
import TableauTriable from '@/components/common/TableauTriable';
import { MARGE_PAGE } from '@/components/common/apparenceGrille';
import { cn } from '@/lib/utils';
import ListeRepliable from '../ListeRepliable';
import { chargerRegistre, justifierAbsence, supprimerAbsence } from './api';
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
export default function RegistreStagiaires({ encadrement, matricule = null, compact = false }) {
  if (compact) return <TableauRegistre filtre={{ matricule }} encadrement={encadrement} compact />;
  if (encadrement) {
    return <ListeGroupes detail={(groupe) => <TableauRegistre filtre={{ groupe }} encadrement />} />;
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
  if (encadrement) liste.push({ id: 'actions', entete: '', rendu: (a) => <Supprimer absence={a} /> });
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
