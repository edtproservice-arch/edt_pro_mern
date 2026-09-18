import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Eye, LogIn, Search } from 'lucide-react';
import { ROLES } from 'shared/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import TableauTriable from '@/components/common/TableauTriable';
import { HAUTEUR_BARRE } from '@/components/layout/BarreNavigation';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import { routeApresUsurpation } from '@/features/auth/routage';
import { chargerEtablissements, chargerUtilisateurs, connecterEnTantQue } from '../api';
import BoutonCollaborer from './BoutonCollaborer';
import CelluleUtilisateur from './CelluleUtilisateur';
import FicheCompte from './FicheCompte';
import { libelleRole, LIBELLES_ROLE } from './roles';

/**
 * « Activité et Temps Passé par Utilisateur ».
 * ← le tableau du panneau `#panel-stats` de `admin_dashboard.html`, avec sa
 *   barre de sept filtres.
 *
 * ═══ ⚠️ LES FILTRES SONT APPLIQUÉS EN BASE, PAS DANS LE NAVIGATEUR ═══
 * L'existant chargeait les 1 078 comptes à chaque ouverture de l'onglet, puis
 * triait et filtrait en JavaScript. Une pagination y était impossible, et la
 * page grossissait avec le parc.
 *
 * ⚠️ CHAQUE FILTRE ENTRE DANS LA CLÉ DE CACHE : sans cela, changer de rôle
 * resservirait la liste précédente.
 *
 * ═══ IL PORTE LE MÊME HABILLAGE ET LES MÊMES ACTIONS QUE CELUI DES DIRECTEURS
 * ═══ (demande du porteur, 2026-09-02.) Ce sont les mêmes personnes, et une même
 * ligne ne peut pas se présenter de deux façons selon la page où on la regarde.
 */

/*
 * ⚠️ RADIX REFUSE UN `SelectItem` DE VALEUR VIDE — il s'en sert pour « rien de
 * choisi ». L'entrée « tous » porte donc un jeton, traduit en `undefined` à la
 * sortie ; sans lui, on ne pourrait plus revenir à la liste complète.
 */
const TOUS = '__tous__';

const FILTRES = [
  {
    cle: 'role',
    libelle: 'Rôle',
    tous: 'Tous les rôles',
    options: Object.entries(LIBELLES_ROLE).map(([valeur, libelle]) => ({ valeur, libelle })),
  },
  {
    cle: 'activite',
    libelle: 'Activité',
    tous: 'Toutes',
    options: [
      { valeur: 'en_ligne', libelle: 'En ligne' },
      { valeur: 'hors_ligne', libelle: 'Hors ligne' },
    ],
  },
  {
    cle: 'actif',
    libelle: 'Compte',
    tous: 'Tous',
    options: [
      { valeur: 'oui', libelle: 'Actif' },
      { valeur: 'non', libelle: 'Désactivé' },
    ],
  },
  {
    cle: 'connexion',
    libelle: 'Dernière connex.',
    tous: 'Toutes',
    options: [
      { valeur: 'aujourdhui', libelle: "Aujourd'hui" },
      { valeur: '7j', libelle: '7 derniers jours' },
      { valeur: '30j', libelle: '30 derniers jours' },
      { valeur: 'jamais', libelle: 'Jamais connecté' },
    ],
  },
  {
    cle: 'tempsMin',
    libelle: 'Temps passé',
    tous: 'Tous',
    /* En SECONDES, l'unité de `tempsPasse`. */
    options: [
      { valeur: '3600', libelle: 'Plus d’1 h' },
      { valeur: '36000', libelle: 'Plus de 10 h' },
      { valeur: '180000', libelle: 'Plus de 50 h' },
    ],
  },
  {
    cle: 'tri',
    libelle: 'Trier par',
    tous: 'Inscription',
    options: [
      { valeur: 'activite', libelle: 'En ligne d’abord' },
      { valeur: 'temps', libelle: 'Temps passé' },
      { valeur: 'connexion', libelle: 'Dernière connexion' },
    ],
  },
];

export default function TableauActivite() {
  const navigate = useNavigate();
  const [recherche, setRecherche] = useState('');
  const [filtres, setFiltres] = useState({});
  const [consulte, setConsulte] = useState(null);

  /*
   * ⚠️ CHARGÉE À PART, ET UNE SEULE FOIS : la liste des établissements ne change
   * pas au rythme du tableau, et la remettre dans la réponse de chaque page
   * ferait voyager les mêmes noms toutes les trente secondes.
   */
  const etablissements = useQuery({
    queryKey: ['admin-etablissements'],
    queryFn: chargerEtablissements,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const requete = useQuery({
    queryKey: ['admin-activite', recherche, filtres],
    queryFn: () => chargerUtilisateurs({ ...filtres, recherche, parPage: 50 }),
    retry: false,
    /*
     * ⚠️ « EN LIGNE » SE PÉRIME EN 75 SECONDES : une liste figée annoncerait
     * connectée une personne partie depuis un quart d'heure. On la rafraîchit
     * au pas du battement de cœur.
     */
    refetchInterval: 30_000,
  });

  const mutationConnexion = useMutation({
    mutationFn: connecterEnTantQue,
    // Les cookies d'administrateur viennent d'être remplacés : on quitte
    // l'espace d'administration, auquel cette session n'a plus accès.
    //
    // ⚠️ `routeApresUsurpation`, PAS `routeApresConnexion` (2026-09-06) :
    // l'administrateur arrive sur l'ACCUEIL, jamais sur l'assistant de
    // configuration — voir la raison dans `routage.js`.
    onSuccess: (reponse) => navigate(routeApresUsurpation(reponse.utilisateur)),
  });

  const changer = (cle, valeur) =>
    setFiltres((actuels) => ({ ...actuels, [cle]: valeur === TOUS ? undefined : valeur }));

  const lignes = requete.data?.utilisateurs ?? [];

  return (
    <div className="space-y-4">
      {/* ⚠️ QUATRE PAR RANGÉE, PAS SEPT : le nom d'un établissement fait
          soixante caractères, et une colonne de 150 px n'en montrerait que le
          début — « INSTITUT SPECIALI… », identique pour la moitié du parc. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recherche
          </span>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Nom, email…"
              className="h-9 pl-8"
            />
          </div>
        </div>

        {/*
          ═══ LE FILTRE PAR ÉTABLISSEMENT ═══ (demande du porteur, 2026-09-02.)
          C'est la question qu'on se pose devant ce tableau : « qui travaille
          chez EUX, et depuis quand ne s'y connecte-t-on plus ». Aucun autre
          écran ne la pose — la liste des directeurs ignore l'établissement.

          ⚠️ CHAQUE ENTRÉE DIT COMBIEN DE COMPTES ELLE PORTE : sans ce nombre, on
          choisit un établissement au hasard, on obtient une liste vide, et c'est
          le filtre qu'on soupçonne.

          ⚠️ ET IL DIT QUAND IL N'A RIEN À PROPOSER, au lieu d'ouvrir une liste
          vide : une commande muette se lit comme une panne.
        */}
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Établissement
          </span>
          <Select
            value={filtres.etablissement ?? TOUS}
            onValueChange={(valeur) => changer('etablissement', valeur)}
            disabled={!etablissements.data?.etablissements?.length}
          >
            <SelectTrigger className="h-9">
              <SelectValue className="truncate" />
            </SelectTrigger>
            <SelectContent className="max-w-[min(28rem,90vw)]">
              <SelectItem value={TOUS}>Tous les établissements</SelectItem>
              {(etablissements.data?.etablissements ?? []).map((etablissement) => (
                <SelectItem key={etablissement.id} value={etablissement.id}>
                  {etablissement.nom} ({etablissement.comptes})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {FILTRES.map((filtre) => (
          <div key={filtre.cle} className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {filtre.libelle}
            </span>
            <Select
              value={filtres[filtre.cle] ?? TOUS}
              onValueChange={(valeur) => changer(filtre.cle, valeur)}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TOUS}>{filtre.tous}</SelectItem>
                {filtre.options.map((option) => (
                  <SelectItem key={option.valeur} value={option.valeur}>
                    {option.libelle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      {requete.isLoading ? (
        <EtatVide>
          <IndicateurChargement className="mx-auto" />
        </EtatVide>
      ) : lignes.length === 0 ? (
        <EtatVide>Aucun compte ne correspond à ces filtres.</EtatVide>
      ) : (
        <>
          {/*
            ═══ ⚠️ EN-TÊTE COLLANT, SANS SCROLLBAR ═══ (2026-09-03, demande du
            porteur.) Mêmes raisons que le tableau des directeurs : `pleinePage`
            fait tenir les huit colonnes dans la largeur de l'écran au lieu d'un
            défilement horizontal, qui aurait piégé le collant avant qu'il
            n'atteigne la vraie page.
          */}
          <TableauTriable
            pleinePage
            collerSous={HAUTEUR_BARRE}
            vide="Aucun compte ne correspond à ces filtres."
            cleLigne={(ligne) => ligne.id}
            colonnes={[
              {
                id: 'utilisateur',
                entete: 'Utilisateur',
                tri: (ligne) => ligne.nomComplet ?? '',
                rendu: (ligne) => <CelluleUtilisateur compte={ligne} />,
              },
              {
                id: 'role',
                entete: 'Rôle',
                largeur: 'w-24',
                tri: (ligne) => libelleRole(ligne.role),
                rendu: (ligne) => (
                  <Badge variant="outline" className="font-normal">
                    {libelleRole(ligne.role)}
                  </Badge>
                ),
              },
              {
                id: 'etablissement',
                entete: 'Établissement',
                largeur: 'w-48',
                tri: (ligne) => ligne.etablissements?.[0] ?? '',
                // ⚠️ UN COMPTE PEUT EN AVOIR PLUSIEURS : un directeur en gère
                // parfois deux. Les joindre plutôt que n'en montrer qu'un.
                rendu: (ligne) => (
                  <span className="block truncate text-sm text-muted-foreground">
                    {ligne.etablissements?.length ? ligne.etablissements.join(' · ') : '—'}
                  </span>
                ),
              },
              {
                id: 'derniereConnexion',
                entete: 'Dernière connexion',
                largeur: 'w-32',
                tri: (ligne) => new Date(ligne.derniereConnexion ?? 0).getTime(),
                rendu: (ligne) => (
                  <span className="whitespace-nowrap text-sm text-muted-foreground">
                    {ligne.derniereConnexion
                      ? new Date(ligne.derniereConnexion).toLocaleString('fr-FR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : 'Jamais'}
                  </span>
                ),
              },
              {
                id: 'tempsPasse',
                entete: 'Temps passé',
                largeur: 'w-24',
                aligne: 'droite',
                tri: (ligne) => Number(ligne.tempsPasse) || 0,
                rendu: (ligne) => (
                  <span className="whitespace-nowrap tabular-nums">{duree(ligne.tempsPasse)}</span>
                ),
              },
              {
                id: 'activite',
                entete: 'Activité',
                largeur: 'w-28',
                tri: (ligne) => (ligne.estEnLigne ? 1 : 0),
                rendu: (ligne) => (
                  <Pastille actif={ligne.estEnLigne} oui="En ligne" non="Hors ligne" couleur="bg-success" />
                ),
              },
              {
                id: 'compte',
                entete: 'Compte',
                largeur: 'w-24',
                tri: (ligne) => (ligne.estActif ? 1 : 0),
                rendu: (ligne) => (
                  /*
                    ⚠️ LE POINT PASSE AU ROUGE QUAND LE COMPTE EST DÉSACTIVÉ
                    (demande du porteur, 2026-09-02) — là où « hors ligne »
                    reste gris. Les deux colonnes se ressemblent mais ne disent
                    pas la même chose : ne pas être connecté est un ÉTAT DE
                    FAIT, ordinaire et passager ; être désactivé est une
                    DÉCISION, et elle empêche la personne d'entrer.
                  */
                  <Pastille
                    actif={ligne.estActif}
                    oui="Actif"
                    non="Désactivé"
                    couleur="bg-success"
                    couleurNon="bg-destructive"
                  />
                ),
              },
              {
                id: 'actions',
                entete: '',
                largeur: 'w-72',
                aligne: 'droite',
                rendu: (ligne) => {
                  /*
                    ═══ LES MÊMES ACTIONS QUE L'ÉCRAN « DIRECTEURS » ═══
                    (demande du porteur.) Repérer ici un compte qui n'a jamais
                    ouvert l'application, puis devoir aller le chercher sur une
                    autre page pour agir, c'est perdre le fil au moment précis
                    où on l'a trouvé.

                    ⚠️ MAIS PAS TOUTES : approuver, bloquer et supprimer restent
                    sur « Directeurs ». Ce tableau couvre les cinq rôles, et un
                    formateur n'a rien à faire approuver — il est créé par son
                    directeur.
                  */
                  const cibleAdmin = ligne.role === ROLES.ADMIN;
                  return (
                    <div className="flex items-center justify-end gap-1">
                      {!cibleAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={mutationConnexion.isPending}
                          onClick={() => mutationConnexion.mutate(ligne.id)}
                        >
                          <LogIn />
                          Se connecter
                        </Button>
                      )}
                      <BoutonCollaborer compte={ligne} desactive={mutationConnexion.isPending} />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Consulter la fiche de ${ligne.nomComplet}`}
                        onClick={() => setConsulte(ligne)}
                      >
                        <Eye />
                      </Button>
                    </div>
                  );
                },
              },
            ]}
            lignes={lignes}
          />

          {mutationConnexion.isError && (
            <p className="text-sm text-destructive" role="alert">
              {mutationConnexion.error.message}
            </p>
          )}

          {/*
            ⚠️ ON DIT CE QU'ON MONTRE ET CE QU'ON NE MONTRE PAS : sans cette
            ligne, un parc de mille comptes réduit à cinquante se lirait comme
            un parc de cinquante.
          */}
          <p className="text-xs text-muted-foreground">
            {lignes.length} compte(s) affiché(s) sur {requete.data?.total ?? lignes.length}
            {(requete.data?.total ?? 0) > lignes.length && ' — affinez les filtres pour voir le reste'}
          </p>
        </>
      )}

      <FicheCompte compte={consulte} onOpenChange={(ouvert) => !ouvert && setConsulte(null)} />
    </div>
  );
}

/**
 * ⚠️ UNE PASTILLE, PAS UNE COULEUR SEULE : « en ligne » et « hors ligne » se
 * distinguent par leur MOT autant que par leur point. Un daltonien lit les deux.
 */
function Pastille({ actif, oui, non, couleur, couleurNon = 'bg-muted-foreground/40' }) {
  return (
    <Badge variant="outline" className="gap-1.5 whitespace-nowrap font-normal">
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${actif ? couleur : couleurNon}`}
      />
      {actif ? oui : non}
    </Badge>
  );
}

/* Le même cadre vide que la liste des directeurs — deux pages, un seul dessin. */
function EtatVide({ children }) {
  return (
    <div className="rounded-lg border py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * « 3h 5m 30s » — le format de l'existant.
 *
 * ⚠️ LES HEURES NE SE REMETTENT PAS À ZÉRO : 102 h reste « 102h », pas
 * « 4j 6h ». C'est un cumul d'usage, pas une durée calendaire, et le comparer
 * d'une ligne à l'autre demande la même unité partout.
 */
function duree(secondes) {
  const total = Number(secondes) || 0;
  if (total === 0) return '—';

  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return [h && `${h}h`, (h || m) && `${m}m`, `${s}s`].filter(Boolean).join(' ');
}
