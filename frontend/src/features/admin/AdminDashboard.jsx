import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CircleCheck, CircleSlash, Clock } from 'lucide-react';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';
import BarreNavigation from '@/components/layout/BarreNavigation';
import Alerte from '@/components/common/Alerte';
import { Input } from '@/components/ui/input';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import SectionsAdmin from './components/SectionsAdmin';
import { BandeCartes, CarteStat } from '@/components/common/CartesStat';
import { cn } from '@/lib/utils';
import { chargerStatistiques, chargerUtilisateurs } from './api';
import TableauComptes from './components/TableauComptes';

/**
 * Tableau de bord administrateur. ← public/admin_dashboard.html
 *
 * ═══ ⚠️ LES QUATRE NOMBRES NE S'AFFICHENT QU'UNE FOIS ═══
 * Ils ont changé de place deux fois dans la journée, et la règle n'a pas varié :
 * quatre cartes AU-DESSUS d'onglets portant les mêmes nombres, c'était deux fois
 * la même chose. Les cartes ont d'abord été retirées au profit de pastilles sur
 * les onglets ; le porteur ayant redemandé des cartes (2026-09-02), ce sont les
 * PASTILLES qui partent. Ce qui compte, c'est qu'il n'y en ait jamais deux jeux.
 *
 * ⚠️ ET LES ONGLETS MONTENT DANS LA BARRE, en rangée soulignée : ils décident de
 * ce que la page entière montre, ils appartiennent donc à la navigation. Ils
 * restent atteignables sans remonter, la barre étant collante.
 *
 * Remplace l'approbation manuelle en base : jusqu'ici, activer un directeur
 * supposait d'éditer `utilisateurs.status` directement en SQL.
 */
const ONGLETS = [
  { statut: STATUTS_COMPTE.EN_ATTENTE, libelle: 'En attente' },
  { statut: STATUTS_COMPTE.APPROUVE, libelle: 'Approuvés' },
  { statut: STATUTS_COMPTE.REJETE, libelle: 'Rejetés' },
  { statut: STATUTS_COMPTE.BLOQUE, libelle: 'Bloqués' },
];

export default function AdminDashboard() {
  const queryClient = useQueryClient();
  const [statut, setStatut] = useState(STATUTS_COMPTE.EN_ATTENTE);
  const [recherche, setRecherche] = useState('');

  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: chargerStatistiques, retry: false });

  /*
   * ═══ ⚠️⚠️ SEULS LES DIRECTEURS ═══ (défaut signalé par le porteur,
   * 2026-09-02.) La liste rendait TOUS les comptes — formateurs et
   * gestionnaires compris — alors que l'admin n'arbitre que des directeurs :
   * les autres sont créés par un directeur et n'ont pas de demande d'accès à
   * approuver. Le filtre existait côté serveur, l'écran ne le posait pas.
   *
   * ⚠️ ET IL FAIT PARTIE DE LA CLÉ DE CACHE : sans lui, une liste chargée avant
   * cette correction resservirait tout le monde.
   */
  const comptes = useQuery({
    queryKey: ['admin-utilisateurs', ROLES.DIRECTEUR, statut, recherche],
    queryFn: () => chargerUtilisateurs({ role: ROLES.DIRECTEUR, statut, recherche }),
    retry: false,
  });

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-utilisateurs'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
  };

  const parStatut = stats.data?.statistiques.parStatutDirecteurs ?? {};
  const essaisEnAttente = stats.data?.statistiques.essaisEnAttente ?? 0;
  /*
   * ═══ LES CHIFFRES D'ESSAI VIENNENT DE « STATISTIQUES » ═══ (demande du
   * porteur, 2026-09-02.) Ils ne concernent qu'un rôle : sur une page qui compte
   * TOUT le parc ils détonnaient, et c'est ICI qu'on approuve ou prolonge.
   *
   * ⚠️ CHACUN SOUS LA CARTE QUI LE CONCERNE : une demande d'essai attend une
   * décision, elle appartient donc à « En attente » ; un essai EN COURS est
   * déjà accordé, il appartient à « Approuvés ». Les réunir dans une même
   * phrase, comme le faisait la ligne d'information, laissait croire à deux
   * variantes d'un même état.
   */
  const essaisEnCours = stats.data?.statistiques.essaisEnCours ?? 0;

  if (comptes.isError) {
    return (
      <>
        <BarreNavigation titre="Administration" />
        <main className="flex min-h-screen items-center justify-center bg-background px-4">
          <Alerte type="erreur" titre="Accès refusé" className="max-w-md">
            {comptes.error.message} — cet écran est réservé aux administrateurs.
          </Alerte>
        </main>
      </>
    );
  }

  return (
    <>
      <BarreNavigation titre="Administration" liens={<SectionsAdmin />} messagerie />

      <main className="min-h-screen bg-background">
        {/*
          ⚠️ NI TITRE, NI SOUS-TITRE, NI CADRE (demande du porteur, 2026-09-02).
          La rangée de sections dit déjà où l'on est, et « Gestion des
          directeurs » redisait « Administration » de la barre juste au-dessus.
          Le cadre, lui, n'entourait qu'un tableau qui occupe toute la largeur :
          il dessinait une boîte autour de la page entière.
        */}
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/*
            ═══ LA BANDE DE CARTES, LE DESSIN DE LA PAGE « STATISTIQUES » ═══
            (demande du porteur, 2026-09-02.)

            ═══ ⚠️ ET LES PASTILLES DES ONGLETS SONT RETIRÉES ═══
            Les quatre mêmes nombres se seraient affichés DEUX FOIS sur le même
            écran, à quelques centimètres — exactement ce qui avait fait retirer
            les cartes de cette page le matin même. Ce sont les cartes qui les
            portent désormais : elles sont plus lisibles, et le rouge de
            « en attente » y ressort. Les onglets gardent leur libellé et leur
            soulignement, qui disent où l'on est.

            ⚠️ SI LES PASTILLES MANQUENT À L'USAGE, ce sont les CARTES qu'il faut
            retirer, pas ajouter les deux : la duplication est le défaut d'origine.
          */}
          <div className="pt-6">
            <BandeCartes>
              <CarteStat
                Icone={Clock}
                libelle="En attente"
                valeur={parStatut[STATUTS_COMPTE.EN_ATTENTE] ?? 0}
                /* ⚠️ LE SEUL ACCENT FORT DE LA PAGE, et seulement au-dessus de
                   zéro : c'est la seule case qui appelle une ACTION, les trois
                   autres décrivent un état. Un « 0 » en bleu vif annoncerait du
                   travail là où il n'y en a pas. */
                teinte={
                  (parStatut[STATUTS_COMPTE.EN_ATTENTE] ?? 0) > 0
                    ? 'text-primary'
                    : 'text-muted-foreground'
                }
                fond={
                  (parStatut[STATUTS_COMPTE.EN_ATTENTE] ?? 0) > 0 ? 'bg-primary/10' : 'bg-muted'
                }
                detail={
                  essaisEnAttente > 0 ? (
                    <span className="text-muted-foreground">
                      dont {essaisEnAttente} demande(s) d&apos;essai
                    </span>
                  ) : null
                }
              />

              <CarteStat
                Icone={CircleCheck}
                libelle="Approuvés"
                valeur={parStatut[STATUTS_COMPTE.APPROUVE] ?? 0}
                teinte="text-success"
                fond="bg-success/10"
                /* ⚠️ « EN COURS » N'EST PAS « DEMANDÉ » : le premier court et
                   s'achèvera, le second attend la décision qu'on vient prendre
                   ici. Chacun sous la carte qui le concerne. */
                detail={
                  essaisEnCours > 0 ? (
                    <span className="text-muted-foreground">
                      dont {essaisEnCours} en période d&apos;essai
                    </span>
                  ) : null
                }
              />

              <CarteStat
                Icone={CircleSlash}
                libelle="Rejetés"
                valeur={parStatut[STATUTS_COMPTE.REJETE] ?? 0}
                teinte="text-muted-foreground"
                fond="bg-muted"
              />

              <CarteStat
                Icone={Ban}
                libelle="Bloqués"
                valeur={parStatut[STATUTS_COMPTE.BLOQUE] ?? 0}
                teinte={
                  (parStatut[STATUTS_COMPTE.BLOQUE] ?? 0) > 0
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                }
                fond={
                  (parStatut[STATUTS_COMPTE.BLOQUE] ?? 0) > 0 ? 'bg-destructive/10' : 'bg-muted'
                }
              />
            </BandeCartes>
          </div>

          {/*
            ⚠️ LE FILTRE PAR STATUT EST REDESCENDU DANS LA PAGE (2026-09-02) :
            la rangée de la barre navigue désormais entre les PAGES de
            l'administration, et un filtre de liste n'est pas une page. Il garde
            le même dessin souligné — c'est la même grammaire, un cran plus bas.
          */}
          <StatutsListe courant={statut} onChangement={setStatut} />

          <div className="space-y-4 py-6">
            <div className="gap-4 sm:flex sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {comptes.data ? (
                  <>
                    {comptes.data.total} directeur(s) dans cette section
                  </>
                ) : (
                  <IndicateurChargement />
                )}
              </p>
              <Input
                placeholder="Rechercher un nom ou une adresse…"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                className="mt-3 sm:mt-0 sm:max-w-xs"
              />
            </div>

            <TableauComptes
              comptes={comptes.data?.utilisateurs ?? []}
              enChargement={comptes.isLoading}
              onChangement={rafraichir}
            />
          </div>
        </div>
      </main>
    </>
  );
}

/**
 * Le filtre par statut de la liste des directeurs.
 *
 * ═══ ⚠️ SOULIGNÉE, PAS EN PASTILLES ═══ (maquette fournie par le porteur.)
 * Une pastille sur fond gris se lit comme un BOUTON — un objet qu'on presse ;
 * un onglet souligné se lit comme un ENDROIT où l'on est. Or c'est bien de cela
 * qu'il s'agit : la page entière change de contenu.
 *
 * ═══ ⚠️ DES BOUTONS, PAS `Tabs` DE RADIX ═══
 * Radix veut ses `TabsContent` DANS le même `Tabs` que ses déclencheurs, pour
 * relier `aria-controls` à un panneau. Ici les déclencheurs vivent dans
 * l'en-tête et la liste six cents pixels plus bas, dans un autre sous-arbre :
 * le lien serait faux. Des boutons dans un `nav`, avec `aria-current`, disent
 * exactement ce qui se passe — un filtre, pas un panneau à onglets.
 */
function StatutsListe({ courant, onChangement }) {
  return (
    <nav aria-label="Statut des comptes" className="border-b">
      <div>
        {/* `overflow-x-auto` : à quatre sections et leurs compteurs, la rangée
            dépasse la largeur d'un téléphone. */}
        <ul className="-mb-px flex items-center gap-6 overflow-x-auto">
          {ONGLETS.map((onglet) => {
            const actif = onglet.statut === courant;
            return (
              <li key={onglet.statut}>
                <button
                  type="button"
                  onClick={() => onChangement(onglet.statut)}
                  aria-current={actif ? 'true' : undefined}
                  className={cn(
                    'flex items-center gap-2 whitespace-nowrap border-b-2 py-3 text-sm transition-colors',
                    actif
                      ? 'border-foreground font-semibold text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  {onglet.libelle}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
