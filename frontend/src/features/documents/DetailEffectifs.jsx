import { Fragment, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronRight, Columns3, Copy, Download, Search, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { chargerLiensCartes } from '@/features/absences/stagiaires/api';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import Alerte from '@/components/common/Alerte';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { chargerStagiaires } from './api';
import { useEtatPartage } from '@/features/guidage/useEtatPartage';

/**
 * Détail d'un effectif : filière → groupe → stagiaires.
 *
 * ═══ POURQUOI UN ARBRE, ET NON UN TABLEAU FILTRÉ ═══
 * La question posée devant ces chiffres est « ma filière X est-elle bien
 * arrivée, et avec combien de groupes ? ». Un tableau à plat oblige à filtrer
 * pour y répondre, filière par filière. L'arbre montre la composition d'un coup
 * et ne charge la liste nominative que du groupe qu'on ouvre — 995 stagiaires
 * affichés d'emblée, c'est ce que faisait canvas.html.
 *
 * ═══ LA RECHERCHE TROUVE AUSSI UN STAGIAIRE (2026-10-12, demande du porteur) ═══
 * Dès deux caractères, le serveur cherche les stagiaires dont le nom, le prénom,
 * le matricule ou la CIN correspondent — « aya mohamed » mot par mot. Ils
 * s'affichent dans leur propre tableau, au-dessus de l'arbre, avec leur groupe.
 */
export default function DetailEffectifs({ statistiques }) {
  const [filtre, setFiltre] = useState('');
  const [groupeOuvert, setGroupeOuvert] = useState(null);
  const [masquees, setMasquees] = useColonnesMasquees();
  // Le filtre et le groupe déplié, partagés pendant le guidage (2026-10-04).
  useEtatPartage('documents.effectifs', { filtre, groupe: groupeOuvert ?? null }, (valeur) => {
    if (!valeur || typeof valeur !== 'object') return;
    setFiltre(typeof valeur.filtre === 'string' ? valeur.filtre : '');
    setGroupeOuvert(typeof valeur.groupe === 'string' ? valeur.groupe : null);
  });

  const filieres = statistiques?.filieres ?? [];
  const motif = filtre.trim().toLowerCase();

  // Le serveur n'est interrogé qu'après une courte pause de frappe.
  const recherche = useDiffere(motif, 300);
  const trouves = useQuery({
    queryKey: ['stagiaires', 'recherche', recherche],
    queryFn: () => chargerStagiaires({ recherche }),
    enabled: recherche.length >= 2,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const stagiairesTrouves = recherche.length >= 2 ? (trouves.data?.stagiaires ?? []) : [];

  // Le filtre porte sur la filière ET sur ses groupes : chercher « DEV » doit
  // trouver la filière comme le groupe, on ne sait pas lequel l'utilisateur a
  // en tête.
  const visibles = filieres
    .map((filiere) => ({
      ...filiere,
      groupes: filiere.groupes.filter(
        (groupe) =>
          motif === '' ||
          groupe.nom.toLowerCase().includes(motif) ||
          filiere.nom.toLowerCase().includes(motif)
      ),
    }))
    .filter((filiere) => filiere.groupes.length > 0);

  if (filieres.length === 0) {
    return (
      <Alerte type="info" titre="Aucun stagiaire">
        Importez votre export Konosys avec le bouton ci-dessus : c&apos;est lui qui alimente cette
        page et les documents imprimés.
      </Alerte>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filtre}
            onChange={(evenement) => setFiltre(evenement.target.value)}
            placeholder="Filtrer par filière, groupe ou stagiaire…"
            className="h-9 pl-8"
          />
        </div>
        <ChoixColonnes masquees={masquees} onChange={setMasquees} />
      </div>

      {stagiairesTrouves.length > 0 && (
        <section className="rounded-lg border">
          <header className="flex items-baseline justify-between gap-2 border-b px-4 py-2">
            <h3 className="text-sm font-medium">Stagiaires trouvés</h3>
            <span className="text-xs text-muted-foreground">
              {stagiairesTrouves.length} stagiaire(s)
              {stagiairesTrouves.length >= 3000 && ' — affinez la recherche'}
            </span>
          </header>
          <TableauStagiaires liste={stagiairesTrouves} masquees={masquees} />
        </section>
      )}

      {visibles.length === 0 ? (
        stagiairesTrouves.length === 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <UserX className="h-4 w-4 shrink-0" />
            {trouves.isFetching
              ? 'Recherche des stagiaires…'
              : 'Aucune filière, aucun groupe ni aucun stagiaire ne correspond à cette recherche.'}
          </div>
        )
      ) : (
        <div className="divide-y rounded-lg border">
          {visibles.map((filiere) => (
            <section key={filiere.nom} className="p-4">
              <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">{filiere.nom}</h3>
                <span className="text-xs text-muted-foreground">
                  {filiere.groupes.length} groupe(s) · {filiere.inscriptions} inscription(s)
                </span>
              </header>

              <div className="space-y-1">
                {filiere.groupes.map((groupe) => (
                  <Groupe
                    key={groupe.nom}
                    groupe={groupe}
                    masquees={masquees}
                    ouvert={groupeOuvert === groupe.nom}
                    onBasculer={() =>
                      setGroupeOuvert(groupeOuvert === groupe.nom ? null : groupe.nom)
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Une valeur qui ne suit la saisie qu'après `delai` ms sans frappe. */
function useDiffere(valeur, delai) {
  const [differee, setDifferee] = useState(valeur);
  useEffect(() => {
    const minuteur = setTimeout(() => setDifferee(valeur), delai);
    return () => clearTimeout(minuteur);
  }, [valeur, delai]);
  return differee;
}

/* ─── Les colonnes, et celles qu'on masque ───────────────────────────────── */

/**
 * ═══ COLONNES MASQUABLES (2026-10-12, demande du porteur) ═══ Le choix vaut pour
 * TOUS les tableaux de la page — groupes ouverts et stagiaires trouvés — et se
 * retient dans ce navigateur : on le règle une fois.
 */
const CLE_STOCKAGE = 'edtpro.effectifs.colonnesMasquees';

function useColonnesMasquees() {
  const [masquees, setMasquees] = useState(() => {
    try {
      const lues = JSON.parse(localStorage.getItem(CLE_STOCKAGE) ?? '[]');
      return new Set(Array.isArray(lues) ? lues : []);
    } catch {
      return new Set();
    }
  });
  const changer = (suivantes) => {
    setMasquees(suivantes);
    try {
      localStorage.setItem(CLE_STOCKAGE, JSON.stringify([...suivantes]));
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour la visite.
    }
  };
  return [masquees, changer];
}

const nomComplet = (s) => [s.nom, s.prenom].filter(Boolean).join(' ');

/**
 * Les colonnes du tableau, dans l'ordre. `groupe` et `qr` ne s'affichent que
 * selon le tableau : le GROUPE pour les stagiaires trouvés (l'arbre le nomme
 * déjà), le QR pour un groupe ouvert (les liens se chargent par groupe).
 */
const COLONNES = [
  { id: 'qr', entete: 'QR de connexion', classe: 'text-center' },
  { id: 'numero', entete: 'N°', classe: 'w-10 text-right', masquable: false },
  { id: 'matricule', entete: 'Matricule (CEF)', masquable: false },
  { id: 'nom', entete: 'Nom et prénom', masquable: false },
  { id: 'groupe', entete: 'Groupe' },
  { id: 'nomArabe', entete: 'الاسم الكامل', libelle: 'Nom en arabe', classe: 'text-right' },
  { id: 'cin', entete: 'CIN' },
  { id: 'dateNaissance', entete: 'Date de naissance' },
  { id: 'lieuNaissance', entete: 'Lieu de naissance' },
  { id: 'email', entete: 'E-mail' },
  { id: 'niveau', entete: 'Niveau · année' },
  { id: 'niveauScolaire', entete: 'Niveau scolaire' },
  { id: 'autresGroupes', entete: 'Autres groupes' },
  { id: 'site', entete: 'Site' },
  { id: 'dateInscription', entete: 'Date d’inscription' },
];

function ChoixColonnes({ masquees, onChange }) {
  const masquables = COLONNES.filter((colonne) => colonne.masquable !== false);
  const basculer = (id) => {
    const suivantes = new Set(masquees);
    if (suivantes.has(id)) suivantes.delete(id);
    else suivantes.add(id);
    onChange(suivantes);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <Columns3 className="size-4" />
          Colonnes
          {masquees.size > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[0.6rem] tabular-nums">
              {masquees.size} masquée(s)
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs">Colonnes affichées</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {masquables.map((colonne) => (
          <DropdownMenuCheckboxItem
            key={colonne.id}
            checked={!masquees.has(colonne.id)}
            // Le menu reste ouvert : on en décoche souvent plusieurs d'affilée.
            onSelect={(evenement) => evenement.preventDefault()}
            onCheckedChange={() => basculer(colonne.id)}
          >
            {colonne.libelle ?? colonne.entete}
          </DropdownMenuCheckboxItem>
        ))}
        {masquees.size > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(new Set())}>Tout afficher</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Un groupe, dont la liste nominative n'est chargée qu'à l'ouverture. */
function Groupe({ groupe, ouvert, onBasculer, masquees }) {
  const stagiaires = useQuery({
    queryKey: ['stagiaires', 'liste', groupe.nom],
    queryFn: () => chargerStagiaires({ groupe: groupe.nom }),
    // ⚠️ La requête n'est lancée QUE si le groupe est ouvert : monter la page
    // avec 40 groupes déclencherait sinon 40 appels d'un coup, pour un contenu
    // que personne ne regarde.
    enabled: ouvert,
    retry: false,
  });

  const liste = stagiaires.data?.stagiaires ?? [];

  /*
   * ═══ LE QR DE CONNEXION DE CHAQUE STAGIAIRE (2026-10-11, demande du porteur)
   * ═══ Le même que sur sa carte. ⚠️ RÉSERVÉ À L'ENCADREMENT : le serveur répond
   * 403 à un formateur invité sur cette page — la colonne n'apparaît alors pas.
   */
  const liens = useQuery({
    queryKey: ['stagiaires', 'liens-cartes', groupe.nom],
    queryFn: () => chargerLiensCartes(groupe.nom),
    enabled: ouvert,
    retry: false,
  });
  const parMatricule = liens.isSuccess ? new Map(liens.data.liens.map((l) => [l.matricule, l])) : null;

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={onBasculer}
        aria-expanded={ouvert}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
      >
        <ChevronRight
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', ouvert && 'rotate-90')}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{groupe.nom}</span>
        <Badge variant="outline" className="shrink-0 font-normal tabular-nums">
          {groupe.total}
        </Badge>
      </button>

      {ouvert && (
        <div className="border-t">
          {stagiaires.isError ? (
            <p className="px-3 py-2 text-sm text-destructive">{stagiaires.error.message}</p>
          ) : stagiaires.isLoading ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Chargement…</p>
          ) : (
            <TableauStagiaires groupe={groupe.nom} liste={liste} liens={parMatricule} masquees={masquees} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * La liste nominative, en TABLEAU (2026-09-23, demande du porteur : « toutes les
 * données des stagiaires, de manière structurée »). Une colonne par donnée : on
 * compare d'une ligne à l'autre, ce qu'une ligne de texte ne permet pas.
 *
 * `groupe` absent = les stagiaires TROUVÉS par la recherche : la colonne Groupe
 * s'affiche, le QR non (ses liens se chargent groupe par groupe).
 *
 * ⚠️ LE TABLEAU DÉFILE EN LARGEUR, PAS LA PAGE : quinze colonnes ne tiennent pas
 * sur un écran étroit.
 */
function TableauStagiaires({ groupe = null, liste, liens = null, masquees = new Set() }) {
  const [qrOuvert, setQrOuvert] = useState(null);

  if (liste.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">Aucun stagiaire dans ce groupe.</p>;
  }

  const visibles = COLONNES.filter((colonne) => {
    if (masquees.has(colonne.id)) return false;
    if (colonne.id === 'qr') return Boolean(liens);
    if (colonne.id === 'groupe') return !groupe;
    if (colonne.id === 'autresGroupes') return Boolean(groupe);
    return true;
  });

  const cellule = (colonne, stagiaire, rang) => {
    // Le groupe ouvert est déjà dans l'en-tête : on ne liste que les AUTRES (FQ…).
    const autres = (stagiaire.groupes ?? []).filter((g) => g !== groupe);
    switch (colonne.id) {
      case 'qr': {
        const lien = liens?.get(stagiaire.matricule);
        return (
          <TableCell className="text-center">
            {lien ? (
              <button
                type="button"
                onClick={() => setQrOuvert({ stagiaire, ...lien })}
                className="inline-block rounded border bg-white p-0.5 hover:ring-2 hover:ring-primary"
                aria-label={`Afficher le QR de connexion de ${nomComplet(stagiaire)}`}
              >
                <img src={lien.qr} alt="" className="size-9" />
              </button>
            ) : (
              <span className="text-muted-foreground" title="Pas de compte stagiaire : créez-le dans Paramètres → Sessions.">
                —
              </span>
            )}
          </TableCell>
        );
      }
      case 'numero':
        return <TableCell className="text-right tabular-nums text-muted-foreground">{rang + 1}</TableCell>;
      case 'matricule':
        return <TableCell className="whitespace-nowrap tabular-nums">{stagiaire.matricule}</TableCell>;
      case 'nom':
        return <TableCell className="whitespace-nowrap font-medium">{nomComplet(stagiaire) || '—'}</TableCell>;
      case 'groupe':
        return (
          <TableCell className="whitespace-nowrap">
            {(stagiaire.groupes ?? []).join(' · ') || stagiaire.groupePrincipal || '—'}
          </TableCell>
        );
      case 'nomArabe':
        // `dir="rtl"` : sinon chiffres et parenthèses s'inversent.
        return (
          <TableCell dir="rtl" lang="ar" className="whitespace-nowrap text-right">
            {[stagiaire.nomArabe, stagiaire.prenomArabe].filter(Boolean).join(' ') || '—'}
          </TableCell>
        );
      case 'cin':
        return <TableCell className="whitespace-nowrap">{stagiaire.cin || '—'}</TableCell>;
      case 'dateNaissance':
        return <TableCell className="whitespace-nowrap tabular-nums">{stagiaire.dateNaissance || '—'}</TableCell>;
      case 'lieuNaissance':
        return <TableCell className="whitespace-nowrap">{stagiaire.lieuNaissance || '—'}</TableCell>;
      case 'email':
        return (
          <TableCell className="whitespace-nowrap">
            {stagiaire.email ? (
              <a href={`mailto:${stagiaire.email}`} className="hover:underline">
                {stagiaire.email}
              </a>
            ) : (
              '—'
            )}
          </TableCell>
        );
      case 'niveau':
        return (
          <TableCell className="whitespace-nowrap">
            {[stagiaire.niveau, stagiaire.annee].filter(Boolean).join(' · ') || '—'}
          </TableCell>
        );
      case 'niveauScolaire':
        // Le niveau d'études à l'entrée (2026-10-11) — parfois long : il passe à la ligne.
        return <TableCell className="min-w-40 max-w-64">{stagiaire.niveauScolaire || '—'}</TableCell>;
      case 'autresGroupes':
        return (
          <TableCell>
            {groupe && autres.length ? (
              <div className="flex flex-wrap gap-1">
                {autres.map((g) => (
                  <Badge key={g} variant="outline" className="font-normal">
                    {g}
                  </Badge>
                ))}
              </div>
            ) : (
              '—'
            )}
          </TableCell>
        );
      case 'site':
        return <TableCell className="whitespace-nowrap">{stagiaire.site || '—'}</TableCell>;
      case 'dateInscription':
        return <TableCell className="whitespace-nowrap tabular-nums">{stagiaire.dateInscription || '—'}</TableCell>;
      default:
        return null;
    }
  };

  return (
    <div className="overflow-x-auto">
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {visibles.map((colonne) => (
              <TableHead key={colonne.id} className={colonne.classe}>
                {colonne.entete}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {liste.map((stagiaire, rang) => (
            <TableRow key={stagiaire.id}>
              {visibles.map((colonne) => (
                <Fragment key={colonne.id}>{cellule(colonne, stagiaire, rang)}</Fragment>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <DialogueQr qr={qrOuvert} onFermer={() => setQrOuvert(null)} />
    </div>
  );
}


/**
 * Le QR d'un stagiaire, en grand : à scanner depuis l'écran, ou à copier /
 * télécharger. ⚠️ CE LIEN OUVRE SA SESSION : il ne se transmet qu'à lui.
 */
function DialogueQr({ qr, onFermer }) {
  const nom = qr ? [qr.stagiaire.nom, qr.stagiaire.prenom].filter(Boolean).join(' ') : '';
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(qr.lien);
      toast.success('Lien copié');
    } catch {
      toast.error('Copie impossible', { description: 'Sélectionnez le lien et copiez-le à la main.' });
    }
  };

  return (
    <Dialog open={Boolean(qr)} onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{nom}</DialogTitle>
          <DialogDescription>
            QR de connexion directe à la session de ce stagiaire. Ne le transmettez qu&apos;à lui.
          </DialogDescription>
        </DialogHeader>
        {qr && (
          <div className="space-y-3">
            <img src={qr.qr} alt={`QR de connexion de ${nom}`} className="mx-auto size-56 rounded border bg-white p-1" />
            <p className="break-all rounded bg-muted px-2 py-1 font-mono text-[0.7rem] text-muted-foreground">{qr.lien}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={copier}>
                <Copy className="size-3.5" />
                Copier le lien
              </Button>
              <Button asChild size="sm" className="gap-1.5">
                <a href={qr.qr} download={`QR_${qr.stagiaire.matricule}.png`}>
                  <Download className="size-3.5" />
                  Télécharger le QR
                </a>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
