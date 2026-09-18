import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Landmark, MapPin, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { REGIONS_OFPPT } from 'shared/constants';
import BarreNavigation from '@/components/layout/BarreNavigation';
import SectionsAdmin from '@/features/admin/components/SectionsAdmin';
import { BandeCartes, CarteStat } from '@/components/common/CartesStat';
import Alerte from '@/components/common/Alerte';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  chargerComplexes,
  chargerReseau,
  chargerResume,
  creerEtablissement,
  modifierEtablissement,
  renommerComplexe,
  supprimerComplexe,
  supprimerEtablissement,
} from './api';
import FormulaireEtablissement from './FormulaireEtablissement';

/**
 * Réseau OFPPT — le référentiel région → complexe → établissement.
 * (demande du porteur, 2026-09-02.)
 * ← public/data/etablissements.json, supprimé le même jour.
 *
 * ═══ ⚠️ CE N'EST PAS LA LISTE DES CLIENTS ═══
 * C'est le CATALOGUE du réseau : la liste officielle dans laquelle un directeur
 * DÉSIGNE son établissement au moment de s'inscrire. Un établissement peut donc
 * y figurer sans qu'aucun compte n'existe — c'est même le cas de la plupart.
 * La liste des locataires, elle, se lit dans « Statistiques ».
 *
 * ⚠️ RÉSERVÉE À L'ADMINISTRATEUR : la lecture reste publique (l'inscription se
 * fait sans session), l'écriture non.
 */
const TOUS = '__tous__';

export default function PageReseau() {
  const queryClient = useQueryClient();

  const [filtres, setFiltres] = useState({});
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(1);

  const [enEdition, setEnEdition] = useState(null);
  const [aSupprimer, setASupprimer] = useState(null);
  const [renommage, setRenommage] = useState(null); // { region, ancien, nouveau }

  const resume = useQuery({ queryKey: ['reseau-resume'], queryFn: chargerResume, retry: false });

  const liste = useQuery({
    queryKey: ['reseau', filtres, recherche, page],
    queryFn: () => chargerReseau({ ...filtres, recherche, page, parPage: 50 }),
    retry: false,
  });

  const complexes = useQuery({
    queryKey: ['reseau-complexes', filtres.region],
    queryFn: () => chargerComplexes(filtres.region),
    staleTime: 60_000,
  });

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['reseau'] });
    queryClient.invalidateQueries({ queryKey: ['reseau-resume'] });
    queryClient.invalidateQueries({ queryKey: ['reseau-complexes'] });
  };

  const enregistrement = useMutation({
    mutationFn: ({ id, corps }) =>
      id ? modifierEtablissement(id, corps) : creerEtablissement(corps),
    onSuccess: () => {
      setEnEdition(null);
      rafraichir();
    },
  });

  const suppression = useMutation({
    mutationFn: (cible) =>
      cible.type === 'etablissement'
        ? supprimerEtablissement(cible.etablissement.id)
        : supprimerComplexe(cible.region, cible.complexe),
    onSuccess: () => {
      setASupprimer(null);
      rafraichir();
    },
  });

  const renommer = useMutation({
    mutationFn: renommerComplexe,
    onSuccess: () => {
      setRenommage(null);
      rafraichir();
    },
  });

  /* ⚠️ Changer un filtre remet la pagination à 1 : filtrer depuis la page 3
     afficherait un vide alors que le résultat tient sur une page. */
  const changer = (cle, valeur) => {
    setPage(1);
    setFiltres((actuels) => {
      const suivants = { ...actuels, [cle]: valeur === TOUS ? undefined : valeur };
      /* Un complexe appartient à SA région : le garder en changeant de région
         donnerait une liste vide sans que rien ne l'explique. */
      if (cle === 'region') suivants.complexe = undefined;
      return suivants;
    });
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

  const etablissements = liste.data?.etablissements ?? [];
  const total = liste.data?.total ?? 0;
  const pages = liste.data?.pages ?? 1;
  const regionsServies = resume.data?.parRegion?.length ?? 0;

  return (
    <>
      <BarreNavigation titre="Administration" liens={<SectionsAdmin />} messagerie />

      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <BandeCartes className="lg:grid-cols-3">
            <CarteStat
              Icone={Landmark}
              libelle="Établissements du réseau"
              valeur={resume.data?.total ?? '—'}
              teinte="text-primary"
              fond="bg-primary/10"
              detail={
                <span className="text-muted-foreground">
                  la liste proposée à l&apos;inscription
                </span>
              }
            />
            <CarteStat
              Icone={Building2}
              libelle="Complexes"
              valeur={resume.data?.complexes ?? '—'}
              teinte="text-accent-teal"
              fond="bg-accent-teal/10"
            />
            {/*
              ⚠️ « SERVIES SUR 10 » PLUTÔT QU'UN SIMPLE COMPTE : huit régions sont
              encore vides, et c'est précisément le travail qui reste. Un « 2 »
              seul ne le dirait pas.
            */}
            <CarteStat
              Icone={MapPin}
              libelle={`Régions servies sur ${REGIONS_OFPPT.length}`}
              valeur={regionsServies || '—'}
              teinte={regionsServies < REGIONS_OFPPT.length ? 'text-warning' : 'text-success'}
              fond={regionsServies < REGIONS_OFPPT.length ? 'bg-warning/10' : 'bg-success/10'}
              detail={
                resume.data ? (
                  <span className="text-muted-foreground">
                    {REGIONS_OFPPT.length - regionsServies} région(s) sans aucun établissement
                  </span>
                ) : null
              }
            />
          </BandeCartes>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Etiquette>Recherche</Etiquette>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={recherche}
                    onChange={(e) => {
                      setPage(1);
                      setRecherche(e.target.value);
                    }}
                    placeholder="Établissement, complexe…"
                    className="h-9 pl-8"
                  />
                </div>
              </div>

              <Facette
                libelle="Région"
                tous="Toutes les régions"
                valeur={filtres.region}
                options={REGIONS_OFPPT}
                onChange={(v) => changer('region', v)}
              />
              <Facette
                libelle="Complexe"
                tous="Tous les complexes"
                valeur={filtres.complexe}
                options={complexes.data?.complexes ?? []}
                onChange={(v) => changer('complexe', v)}
              />
            </div>

            <Button onClick={() => setEnEdition({ etablissement: null })}>
              <Plus />
              Ajouter un établissement
            </Button>
          </div>

          {liste.isLoading ? (
            <EtatVide>
              <IndicateurChargement className="mx-auto" />
            </EtatVide>
          ) : etablissements.length === 0 ? (
            <EtatVide>Aucun établissement ne correspond à ces critères.</EtatVide>
          ) : (
            <>
              {/*
                ═══ ⚠️ EN-TÊTE COLLANT, SANS SCROLLBAR ═══ (2026-09-03, demande
                du porteur.) Même raison que les trois autres tableaux de
                l'administration : `pleinePage` fait tenir les colonnes sans
                défilement horizontal, qui aurait piégé le collant.

                ⚠️ LE TRI NE PORTE QUE SUR LA PAGE AFFICHÉE (50 lignes), pas sur
                les 170 établissements du réseau — la liste est paginée CÔTÉ
                SERVEUR.
              */}
              <TableauTriable
                pleinePage
                collerSous={HAUTEUR_BARRE}
                vide="Aucun établissement ne correspond à ces critères."
                cleLigne={(etablissement) => etablissement.id}
                colonnes={[
                  {
                    id: 'region',
                    entete: 'Région',
                    largeur: 'w-32',
                    tri: (etablissement) => etablissement.region ?? '',
                    rendu: (etablissement) => (
                      <span className="whitespace-nowrap text-sm text-muted-foreground">
                        {etablissement.region}
                      </span>
                    ),
                  },
                  {
                    id: 'complexe',
                    entete: 'Complexe',
                    largeur: 'w-56',
                    tri: (etablissement) => etablissement.complexe ?? '',
                    rendu: (etablissement) => (
                      <span className="block truncate font-medium">{etablissement.complexe}</span>
                    ),
                  },
                  {
                    id: 'etablissement',
                    entete: 'Établissement',
                    tri: (etablissement) => etablissement.nom ?? '',
                    rendu: (etablissement) => (
                      <span className="block truncate">{etablissement.nom}</span>
                    ),
                  },
                  {
                    id: 'actions',
                    entete: '',
                    largeur: 'w-20',
                    aligne: 'droite',
                    rendu: (etablissement) => (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Modifier ${etablissement.nom}`}
                          onClick={() => setEnEdition({ etablissement })}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Supprimer ${etablissement.nom}`}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setASupprimer({ type: 'etablissement', etablissement })}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ),
                  },
                ]}
                lignes={etablissements}
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {etablissements.length} établissement(s) affiché(s) sur {total}
                </p>

                {/*
                  ⚠️ LES ACTIONS DE COMPLEXE NE S'OFFRENT QUE SUR UNE SÉLECTION
                  D'UN SEUL COMPLEXE : proposées en permanence, elles porteraient
                  sur un complexe qu'on ne voit pas forcément à l'écran. Ici on
                  le voit, et la confirmation chiffre ce qu'il contient.
                */}
                {complexeUnique(etablissements) && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setRenommage({
                          region: etablissements[0].region,
                          ancien: etablissements[0].complexe,
                          nouveau: etablissements[0].complexe,
                        })
                      }
                    >
                      <Pencil />
                      Renommer le complexe
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={() =>
                        setASupprimer({
                          type: 'complexe',
                          region: etablissements[0].region,
                          complexe: etablissements[0].complexe,
                          total,
                        })
                      }
                    >
                      <Trash2 />
                      Supprimer le complexe
                    </Button>
                  </div>
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

      <FormulaireEtablissement
        ouvert={Boolean(enEdition)}
        etablissement={enEdition?.etablissement}
        /* On ajoute presque toujours DANS ce qu'on regarde. */
        defauts={enEdition?.etablissement ? null : { region: filtres.region ?? '', complexe: filtres.complexe ?? '' }}
        enCours={enregistrement.isPending}
        erreur={enregistrement.error}
        onFermer={() => {
          enregistrement.reset();
          setEnEdition(null);
        }}
        onEnregistrer={(corps) =>
          enregistrement.mutate({ id: enEdition?.etablissement?.id ?? null, corps })
        }
      />

      <RenommageComplexe
        valeur={renommage}
        onChange={setRenommage}
        enCours={renommer.isPending}
        erreur={renommer.error}
        onConfirmer={() => renommer.mutate(renommage)}
        onFermer={() => {
          renommer.reset();
          setRenommage(null);
        }}
      />

      <ConfirmationAction
        ouvert={Boolean(aSupprimer)}
        onOpenChange={(ouvert) => !ouvert && setASupprimer(null)}
        destructive
        titre={
          aSupprimer?.type === 'etablissement'
            ? 'Retirer cet établissement du réseau ?'
            : 'Retirer ce complexe et tous ses établissements ?'
        }
        description={descriptionSuppression(aSupprimer)}
        libelleConfirmation="Supprimer"
        onConfirmer={() => suppression.mutate(aSupprimer)}
      />
    </>
  );
}

/** Toutes les lignes affichées portent-elles le même complexe ? */
function complexeUnique(lignes) {
  return (
    lignes.length > 0 &&
    lignes.every(
      (l) => l.complexe === lignes[0].complexe && l.region === lignes[0].region
    )
  );
}

/**
 * ⚠️ LA CONFIRMATION DIT CE QUE L'ON PERD, ET CE QUE L'ON NE PERD PAS : retirer
 * un établissement du CATALOGUE ne supprime aucun compte ni aucune donnée — le
 * directeur déjà inscrit garde le sien. Ce qui change, c'est qu'on ne pourra
 * plus le désigner à l'inscription. Sans cette phrase, on croit détruire des
 * emplois du temps.
 */
function descriptionSuppression(cible) {
  if (!cible) return '';

  if (cible.type === 'etablissement') {
    return `« ${cible.etablissement.nom} » sera retiré du complexe ${cible.etablissement.complexe}. Les comptes et les données des directeurs déjà inscrits ne sont PAS touchés : seule la liste proposée à l'inscription change.`;
  }

  return `Le complexe « ${cible.complexe} » et ses ${cible.total} établissement(s) seront retirés du réseau. Les comptes déjà créés ne sont pas touchés, mais ces établissements ne pourront plus être désignés à l'inscription. Cette action est IRRÉVERSIBLE.`;
}

/**
 * Le renommage groupé d'un complexe.
 *
 * ═══ ⚠️ UN `Dialog`, PAS UN `ConfirmationAction` ═══
 * Une boîte de confirmation sert à VALIDER un geste déjà décidé ; ici il faut
 * SAISIR un nom. Y glisser un champ aurait dénaturé le composant partagé — et
 * son bouton d'action se ferme au clic, si bien que la touche Entrée dans le
 * champ aurait renommé sans qu'on l'ait demandé.
 *
 * ⚠️ LE BOUTON RESTE ÉTEINT TANT QUE LE NOM N'A PAS CHANGÉ : le serveur refuse
 * un renommage identique, autant ne pas le proposer.
 */
function RenommageComplexe({ valeur, onChange, enCours, erreur, onConfirmer, onFermer }) {
  const nouveau = (valeur?.nouveau ?? '').trim();
  const utilisable = nouveau !== '' && nouveau !== valeur?.ancien;

  return (
    <Dialog open={Boolean(valeur)} onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Renommer le complexe</DialogTitle>
          <DialogDescription>
            {valeur
              ? `Tous les établissements de « ${valeur.ancien} » suivront, dans la région ${valeur.region}.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {erreur && (
            <Alerte type="erreur" titre="Renommage refusé">
              {erreur.message}
            </Alerte>
          )}
          <Input
            value={valeur?.nouveau ?? ''}
            onChange={(e) => onChange({ ...valeur, nouveau: e.target.value })}
            placeholder="Nouveau nom du complexe"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFermer} disabled={enCours}>
            Annuler
          </Button>
          <Button onClick={onConfirmer} disabled={!utilisable || enCours}>
            {enCours ? 'Renommage…' : 'Renommer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Etiquette({ children }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

function Facette({ libelle, tous, valeur, options, onChange }) {
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
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EtatVide({ children }) {
  return (
    <div className="rounded-lg border py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
