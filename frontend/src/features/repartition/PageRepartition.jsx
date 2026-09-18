import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Star, Trash2, Upload } from 'lucide-react';
import BarreNavigation from '@/components/layout/BarreNavigation';
import SectionsAdmin from '@/features/admin/components/SectionsAdmin';
import Alerte from '@/components/common/Alerte';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import TableauTriable from '@/components/common/TableauTriable';
import { HAUTEUR_BARRE } from '@/components/layout/BarreNavigation';
import { BandeCartes, CarteStat } from '@/components/common/CartesStat';
import { Building2, Layers, ListTree } from 'lucide-react';
import {
  chargerFacettes,
  chargerFilieres,
  chargerLignes,
  chargerMetiers,
  creerLigne,
  modifierLigne,
  supprimerFiliere,
  supprimerLigne,
} from './api';
import ChoixCherchable from './ChoixCherchable';
import FormulaireLigne from './FormulaireLigne';
import ImportRepartition from './ImportRepartition';

/**
 * Répartition DRIF — le catalogue national des filières et de leurs modules.
 * (demande du porteur, 2026-09-02.)
 * ← api/admin/upload_repartition.php + database/supprimer_filiere_repartition.php
 *
 * ═══ ⚠️ RÉSERVÉE À L'ADMINISTRATEUR ═══
 * Ce référentiel vaut pour TOUS les établissements : une masse horaire corrigée
 * ici change la carte de tout le pays, pas d'un EFP. Les directeurs continuent
 * de le LIRE — leur carte ne se construit pas sans lui — mais ne l'écrivent pas.
 *
 * ═══ ⚠️ 13 359 LIGNES : ON NE LES CHARGE JAMAIS TOUTES ═══
 * `get_repartitions.php` envoyait les 3 Mo au navigateur à chaque ouverture du
 * panneau de la carte, qui filtrait ensuite en JavaScript. Ici la liste est
 * FILTRÉE ET PAGINÉE côté serveur : on descend secteur → niveau → année, ou on
 * cherche un code, et l'écran ne monte que ce qu'il affiche.
 */
const TOUS = '__tous__';

/** Les filtres dont dépendent les listes de filières et de métiers. */
const PERIMETRE = ['secteur', 'niveau', 'creneau', 'annee'];

export default function PageRepartition() {
  const queryClient = useQueryClient();

  const [filtres, setFiltres] = useState({});
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(1);

  const [enEdition, setEnEdition] = useState(null); // { ligne } | { ligne: null }
  const [importOuvert, setImportOuvert] = useState(false);
  const [aSupprimer, setASupprimer] = useState(null); // { type: 'ligne'|'filiere', … }

  const facettes = useQuery({
    queryKey: ['repartition-facettes'],
    queryFn: chargerFacettes,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const liste = useQuery({
    queryKey: ['repartition', filtres, recherche, page],
    queryFn: () => chargerLignes({ ...filtres, recherche, page, parPage: 50 }),
    retry: false,
  });

  /*
   * ═══ ⚠️ FILIÈRE ET MÉTIER SONT SCOPÉS, LES QUATRE AUTRES NON ═══
   * Secteur (29), niveau (7), créneau (2) et année (3) sont des listes COURTES :
   * elles se calculent sur tout le référentiel et ne bougent jamais — sinon
   * choisir un secteur ferait disparaître les autres et l'on ne pourrait plus
   * revenir en arrière.
   *
   * Filière (**1 003**) et métier (**364**) sont d'un autre ordre : servies en
   * bloc, ce sont des listes où l'on ne trouve rien. Elles se réduisent donc au
   * secteur, au niveau, au créneau et à l'année déjà choisis — mais JAMAIS l'une
   * à l'autre : deux listes qui se rétrécissent mutuellement finissent par ne
   * plus rien proposer.
   */
  const perimetre = {
    secteur: filtres.secteur,
    niveau: filtres.niveau,
    creneau: filtres.creneau,
    annee: filtres.annee,
  };

  const filieres = useQuery({
    queryKey: ['repartition-filieres', perimetre],
    queryFn: () => chargerFilieres(perimetre),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const metiers = useQuery({
    queryKey: ['repartition-metiers', perimetre],
    queryFn: () => chargerMetiers(perimetre),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['repartition'] });
    queryClient.invalidateQueries({ queryKey: ['repartition-facettes'] });
  };

  const enregistrement = useMutation({
    mutationFn: ({ id, corps }) => (id ? modifierLigne(id, corps) : creerLigne(corps)),
    onSuccess: () => {
      setEnEdition(null);
      rafraichir();
    },
  });

  const suppression = useMutation({
    mutationFn: (cible) =>
      cible.type === 'ligne'
        ? supprimerLigne(cible.ligne.id)
        : supprimerFiliere(cible.code, cible.annee),
    onSuccess: () => {
      setASupprimer(null);
      rafraichir();
    },
  });

  /*
   * ⚠️ CHANGER UN FILTRE REMET LA PAGINATION À 1 : filtrer depuis la page 7
   * afficherait un vide alors que le résultat tient sur une page — le défaut
   * déjà corrigé sur la liste des comptes.
   */
  const changer = (cle, valeur) => {
    setPage(1);
    setFiltres((actuels) => {
      const suivants = { ...actuels, [cle]: valeur === TOUS ? undefined : valeur };

      /*
       * ⚠️ CHANGER UN FILTRE DE PÉRIMÈTRE REMET FILIÈRE ET MÉTIER À ZÉRO : leurs
       * listes se réduisent à ce périmètre, et la valeur retenue peut ne plus y
       * figurer. Gardée, elle donnerait une liste vide en laissant croire qu'il
       * n'y a rien — c'est la règle déjà posée sur la cascade Konosys.
       */
      if (PERIMETRE.includes(cle)) {
        suivants.filiere = undefined;
        suivants.metier = undefined;
      }

      return suivants;
    });
  };

  const chercher = (valeur) => {
    setPage(1);
    setRecherche(valeur);
  };

  if (liste.isError) {
    return (
      <>
        <BarreNavigation titre="Administration" />
        <main className="flex min-h-screen items-center justify-center bg-background px-4">
          <Alerte type="erreur" titre="Accès refusé" className="max-w-md">
            {liste.error.message} — cet écran est réservé aux administrateurs.
          </Alerte>
        </main>
      </>
    );
  }

  const lignes = liste.data?.lignes ?? [];
  const total = liste.data?.total ?? 0;
  const pages = liste.data?.pages ?? 1;

  return (
    <>
      <BarreNavigation titre="Administration" liens={<SectionsAdmin />} messagerie />

      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <BandeCartes className="lg:grid-cols-3">
            <CarteStat
              Icone={ListTree}
              libelle="Lignes du référentiel"
              valeur={facettes.data?.total ?? '—'}
              teinte="text-primary"
              fond="bg-primary/10"
              detail={<span className="text-muted-foreground">un module, une filière, une année</span>}
            />
            <CarteStat
              Icone={Building2}
              libelle="Secteurs"
              valeur={facettes.data?.secteurs.length ?? '—'}
              teinte="text-accent-teal"
              fond="bg-accent-teal/10"
            />
            <CarteStat
              Icone={Layers}
              libelle="Niveaux de formation"
              valeur={facettes.data?.niveaux.length ?? '—'}
              teinte="text-muted-foreground"
              fond="bg-muted"
              detail={
                facettes.data ? (
                  <span className="text-muted-foreground">{facettes.data.niveaux.join(' · ')}</span>
                ) : null
              }
            />
          </BandeCartes>

          <div className="flex flex-wrap items-end justify-between gap-3">
            {/* ⚠️ TROIS PAR RANGÉE : à six commandes, quatre colonnes en
                laisseraient deux seules sur une seconde rangée à moitié vide —
                et la filière, dont le libellé est long, n'aurait pas de place. */}
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <Etiquette>Recherche</Etiquette>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={recherche}
                    onChange={(e) => chercher(e.target.value)}
                    placeholder="Code, module, métier…"
                    className="h-9 pl-8"
                  />
                </div>
              </div>

              <Facette
                libelle="Secteur"
                tous="Tous les secteurs"
                valeur={filtres.secteur}
                options={facettes.data?.secteurs ?? []}
                onChange={(v) => changer('secteur', v)}
              />
              <Facette
                libelle="Niveau"
                tous="Tous les niveaux"
                valeur={filtres.niveau}
                options={facettes.data?.niveaux ?? []}
                onChange={(v) => changer('niveau', v)}
              />
              <Facette
                libelle="Créneau"
                tous="Tous les créneaux"
                valeur={filtres.creneau}
                options={facettes.data?.creneaux ?? []}
                libelleOption={(c) => LIBELLES_CRENEAU[c] ?? c}
                onChange={(v) => changer('creneau', v)}
              />
              <Facette
                libelle="Année"
                tous="Toutes les années"
                valeur={filtres.annee ? String(filtres.annee) : undefined}
                options={(facettes.data?.annees ?? []).map((a) => String(a))}
                libelleOption={(a) => `Année ${a}`}
                onChange={(v) => changer('annee', v)}
              />

              <ChoixCherchable
                libelle="Filière"
                tous="Toutes les filières"
                valeur={filtres.filiere}
                enChargement={filieres.isLoading}
                options={(filieres.data?.filieres ?? []).map((f) => ({
                  valeur: f.code,
                  libelle: f.code,
                  /* L'intitulé sous le code : c'est lui qu'on reconnaît, mais
                     c'est le code qui identifie — un même intitulé porte
                     parfois plusieurs codes (jour / soir, versions). */
                  secondaire: f.intitule,
                }))}
                onChange={(v) => changer('filiere', v)}
              />

              <ChoixCherchable
                libelle="Métier"
                tous="Tous les métiers"
                valeur={filtres.metier}
                enChargement={metiers.isLoading}
                options={(metiers.data?.metiers ?? []).map((m) => ({
                  valeur: m,
                  /*
                   * ⚠️ LE LIBELLÉ EST REMIS SUR UNE LIGNE : certains métiers du
                   * référentiel portent des RETOURS À LA LIGNE et des guillemets
                   * doublés, hérités de l'export DRIF — « "DESSIN DE BATIMENT\n
                   * Economie de Construction" ». Rendus tels quels, ils cassent
                   * la hauteur des entrées de la liste. On n'affiche PAS la
                   * valeur brute, mais on filtre bien dessus.
                   */
                  libelle: surUneLigne(m),
                }))}
                onChange={(v) => changer('metier', v)}
              />
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setImportOuvert(true)}>
                <Upload />
                Importer un classeur
              </Button>
              <Button onClick={() => setEnEdition({ ligne: null })}>
                <Plus />
                Ajouter
              </Button>
            </div>
          </div>

          {liste.isLoading ? (
            <EtatVide>
              <IndicateurChargement className="mx-auto" />
            </EtatVide>
          ) : lignes.length === 0 ? (
            <EtatVide>Aucune ligne ne correspond à ces critères.</EtatVide>
          ) : (
            <>
              {/*
                ═══ ⚠️ EN-TÊTE COLLANT, SANS SCROLLBAR ═══ (2026-09-03, demande
                du porteur.) `pleinePage` fait tenir les huit colonnes dans la
                largeur de l'écran, comme les autres tableaux de
                l'administration.

                ⚠️ LE TRI NE PORTE QUE SUR LA PAGE AFFICHÉE (50 lignes) : la
                liste est paginée CÔTÉ SERVEUR sur les 13 359 lignes du
                référentiel, et un tri qui prétendrait porter sur l'ensemble
                mentirait — la page suivante reviendrait à l'ordre du serveur.
                C'est la même limite, acceptée, que sur « Réseau OFPPT ».
              */}
              <TableauTriable
                pleinePage
                collerSous={HAUTEUR_BARRE}
                vide="Aucune ligne ne correspond à ces critères."
                cleLigne={(ligne) => ligne.id}
                colonnes={[
                  {
                    id: 'filiere',
                    entete: 'Filière',
                    tri: (ligne) => ligne.codeFiliereDrif ?? '',
                    rendu: (ligne) => (
                      <>
                        <div className="truncate font-medium">{ligne.codeFiliereDrif}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {ligne.intituleFiliere || '—'}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {ligne.secteur && (
                            <Badge variant="outline" className="font-normal">
                              {ligne.secteur}
                            </Badge>
                          )}
                          {ligne.niveauFormation && (
                            <Badge variant="outline" className="font-normal">
                              {ligne.niveauFormation}
                            </Badge>
                          )}
                          {ligne.creneau && (
                            <Badge variant="outline" className="font-normal">
                              {ligne.creneau}
                            </Badge>
                          )}
                        </div>
                      </>
                    ),
                  },
                  {
                    id: 'annee',
                    entete: 'Année',
                    largeur: 'w-16',
                    aligne: 'droite',
                    tri: (ligne) => ligne.anneeFormation ?? 0,
                    rendu: (ligne) => <span className="tabular-nums">{ligne.anneeFormation}</span>,
                  },
                  {
                    id: 'module',
                    entete: 'Module',
                    largeur: 'w-48',
                    tri: (ligne) => ligne.codeModule ?? '',
                    rendu: (ligne) => (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{ligne.codeModule}</span>
                          {/* ⚠️ L'ÉTOILE, LA MÊME QU'AILLEURS : l'EFM régional
                              se signale par ce repère dans la grille, le
                              chronogramme et l'avancement. */}
                          {ligne.efmRegional && (
                            <Star
                              className="size-3.5 fill-warning text-warning"
                              aria-label="EFM régional"
                            />
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{ligne.module}</div>
                      </>
                    ),
                  },
                  {
                    id: 'mhpS1',
                    entete: 'MHP S1',
                    largeur: 'w-20',
                    aligne: 'droite',
                    tri: (ligne) => ligne.mhpS1 ?? 0,
                    rendu: (ligne) => <Masse valeur={ligne.mhpS1} />,
                  },
                  {
                    id: 'mhpS2',
                    entete: 'MHP S2',
                    largeur: 'w-20',
                    aligne: 'droite',
                    tri: (ligne) => ligne.mhpS2 ?? 0,
                    rendu: (ligne) => <Masse valeur={ligne.mhpS2} />,
                  },
                  {
                    id: 'synchrone',
                    entete: 'Synchrone',
                    largeur: 'w-24',
                    aligne: 'droite',
                    tri: (ligne) => (ligne.mhsynS1 ?? 0) + (ligne.mhsynS2 ?? 0),
                    rendu: (ligne) => <Masse valeur={ligne.mhsynS1 + ligne.mhsynS2} />,
                  },
                  {
                    id: 'metier',
                    entete: 'Métier',
                    largeur: 'w-40',
                    tri: (ligne) => ligne.metier ?? '',
                    rendu: (ligne) => (
                      <span className="block truncate text-xs text-muted-foreground">
                        {ligne.metier || '—'}
                      </span>
                    ),
                  },
                  {
                    id: 'actions',
                    entete: '',
                    largeur: 'w-20',
                    aligne: 'droite',
                    rendu: (ligne) => (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Modifier ${ligne.codeModule}`}
                          onClick={() => setEnEdition({ ligne })}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Supprimer ${ligne.codeModule}`}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setASupprimer({ type: 'ligne', ligne })}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ),
                  },
                ]}
                lignes={lignes}
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {lignes.length} ligne(s) affichée(s) sur {total}
                </p>

                {/*
                  ⚠️ LA SUPPRESSION D'UNE FILIÈRE NE S'OFFRE QUE SUR UNE
                  SÉLECTION D'UNE SEULE FILIÈRE : proposée en permanence, elle
                  porterait sur une filière qu'on ne voit pas forcément à
                  l'écran. Ici on la voit, et la confirmation la chiffre.
                */}
                {filiereUnique(lignes) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() =>
                      setASupprimer({
                        type: 'filiere',
                        code: lignes[0].codeFiliereDrif,
                        annee: filtres.annee,
                        total,
                      })
                    }
                  >
                    <Trash2 />
                    Supprimer {lignes[0].codeFiliereDrif}
                    {filtres.annee ? ` — année ${filtres.annee}` : ' (toutes années)'}
                  </Button>
                )}

                {pages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Précédent
                    </Button>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      Page {page} sur {pages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= pages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Suivant
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      <FormulaireLigne
        ouvert={Boolean(enEdition)}
        ligne={enEdition?.ligne}
        /* Une ligne ajoutée depuis une sélection hérite de son contexte : on
           ajoute presque toujours un module À une filière qu'on regarde. */
        defauts={enEdition?.ligne ? null : contexteDepuis(lignes, filtres)}
        enCours={enregistrement.isPending}
        erreur={enregistrement.error}
        onFermer={() => {
          enregistrement.reset();
          setEnEdition(null);
        }}
        onEnregistrer={(corps) =>
          enregistrement.mutate({ id: enEdition?.ligne?.id ?? null, corps })
        }
      />

      <ImportRepartition
        ouvert={importOuvert}
        onFermer={() => setImportOuvert(false)}
        onApplique={rafraichir}
      />

      <ConfirmationAction
        ouvert={Boolean(aSupprimer)}
        onOpenChange={(ouvert) => !ouvert && setASupprimer(null)}
        destructive
        titre={
          aSupprimer?.type === 'ligne'
            ? 'Supprimer ce module du référentiel ?'
            : 'Supprimer cette filière du référentiel ?'
        }
        description={descriptionSuppression(aSupprimer)}
        libelleConfirmation="Supprimer"
        onConfirmer={() => suppression.mutate(aSupprimer)}
      />
    </>
  );
}

/** Toutes les lignes affichées portent-elles la même filière ? */
function filiereUnique(lignes) {
  return lignes.length > 0 && lignes.every((l) => l.codeFiliereDrif === lignes[0].codeFiliereDrif);
}

/** Le contexte d'une nouvelle ligne, repris de ce qui est à l'écran. */
function contexteDepuis(lignes, filtres) {
  if (!filiereUnique(lignes)) return { secteur: filtres.secteur ?? '' };

  const modele = lignes[0];
  return {
    secteur: modele.secteur,
    niveauFormation: modele.niveauFormation,
    typeFormation: modele.typeFormation,
    creneau: modele.creneau,
    codeFiliereDrif: modele.codeFiliereDrif,
    intituleFiliere: modele.intituleFiliere,
    codeFiliereCarte: modele.codeFiliereCarte,
    filiere: modele.filiere,
    anneeFormation: filtres.annee ?? modele.anneeFormation,
  };
}

/**
 * ⚠️ LA CONFIRMATION CHIFFRE CE QUI DISPARAÎT — c'est ce que faisait la
 * simulation de `supprimer_filiere_repartition.php`, et c'est la seule chose qui
 * distingue « je retire une année » de « je retire la filière entière ».
 */
function descriptionSuppression(cible) {
  if (!cible) return '';

  if (cible.type === 'ligne') {
    return `${cible.ligne.codeModule} — ${cible.ligne.module} sera retiré de ${cible.ligne.codeFiliereDrif} (année ${cible.ligne.anneeFormation}). Les établissements qui l'ont déjà affecté le conservent sur leur carte, mais il ne sera plus proposé.`;
  }

  const portee = cible.annee ? `l'année ${cible.annee} de ` : '';
  return `${cible.total} ligne(s) de ${portee}${cible.code} seront retirées du référentiel national. Les cartes déjà enregistrées ne sont pas modifiées, mais cette filière ne sera plus proposée aux établissements. Cette action est IRRÉVERSIBLE.`;
}

/**
 * ⚠️ « CDJ » ET « CDS » NE PARLENT QU'À L'HABITUÉ : ce sont les deux seuls
 * créneaux du référentiel — cours de jour, cours du soir. Le sigle reste, le mot
 * l'accompagne.
 */
const LIBELLES_CRENEAU = {
  CDJ: 'CDJ — cours de jour',
  CDS: 'CDS — cours du soir',
};

/**
 * ⚠️ CERTAINS MÉTIERS PORTENT DES RETOURS À LA LIGNE, hérités de l'export DRIF.
 * Affichés tels quels dans une liste, ils en cassent la hauteur ; on les remet
 * donc sur une ligne POUR L'AFFICHAGE, la valeur envoyée au serveur restant
 * l'originale — c'est elle qui est en base.
 */
function surUneLigne(valeur) {
  return String(valeur ?? '').replace(/\s+/g, ' ').trim();
}

function Etiquette({ children }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

/**
 * ⚠️ UNE FACETTE NE PROPOSE QUE CE QUI EXISTE : offrir un niveau que le
 * référentiel ne porte pas donne une case qui ne rend jamais rien, et fait
 * douter du filtre plutôt que des données.
 */
function Facette({ libelle, tous, valeur, options, onChange, libelleOption }) {
  return (
    <div className="space-y-1">
      <Etiquette>{libelle}</Etiquette>
      <Select value={valeur ?? TOUS} onValueChange={onChange} disabled={options.length === 0}>
        <SelectTrigger className="h-9">
          <SelectValue className="truncate" />
        </SelectTrigger>
        <SelectContent className="max-w-[min(28rem,90vw)]">
          <SelectItem value={TOUS}>{tous}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {libelleOption ? libelleOption(option) : option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/* ⚠️ Un zéro en gris : sur une grille de nombres, il ne doit pas se lire aussi
   fort qu'une masse réelle — c'est l'absence, pas une valeur. */
/* ⚠️ ELLE NE REND PLUS UNE `<TableCell>` : `TableauTriable` pose déjà la
   sienne autour de `colonne.rendu(ligne)` — en ajouter une seconde aurait
   imbriqué deux cellules l'une dans l'autre. */
function Masse({ valeur }) {
  return (
    <span className={`tabular-nums ${valeur === 0 ? 'text-muted-foreground' : ''}`}>{valeur}</span>
  );
}

function EtatVide({ children }) {
  return (
    <div className="rounded-lg border py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
