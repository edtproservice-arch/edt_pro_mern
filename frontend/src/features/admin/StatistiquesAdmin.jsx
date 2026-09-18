import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Cell,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Building2, Signal, UserX, Users } from 'lucide-react';
import BarreNavigation from '@/components/layout/BarreNavigation';
import Alerte from '@/components/common/Alerte';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import { chargerStatistiques } from './api';
import SectionsAdmin from './components/SectionsAdmin';
import TableauActivite from './components/TableauActivite';
import { BandeCartes, CarteStat } from '@/components/common/CartesStat';
import { COULEURS_ROLE, libelleRole, ORDRE_ROLES } from './components/roles';

/**
 * Statistiques du parc de comptes (F15) — la seconde page de l'administration.
 * (demande du porteur, 2026-09-02.)
 *
 * ═══ ⚠️ ELLE COMPTE TOUT LE MONDE, ET C'EST CE QUI LA DISTINGUE ═══
 * L'écran « Directeurs » n'arbitre que des directeurs, et ses compteurs en
 * tiennent compte depuis le défaut corrigé le même jour. Celui-ci fait
 * l'inverse : il montre le parc ENTIER — les 17 formateurs et le gestionnaire
 * qu'on ne voit nulle part ailleurs.
 *
 * ⚠️ LE CROISEMENT RÔLE × STATUT A ÉTÉ RETIRÉ (2026-09-02, demande du porteur) :
 * il répondait à une question que personne ne posait — « existe-t-il un
 * formateur bloqué ? » — alors que le tableau d'activité, filtrable par rôle ET
 * par état de compte, y répond en deux clics ET nomme les personnes. Un tableau
 * de nombres qui double une liste plus riche n'est qu'une seconde vérité à
 * tenir. Le serveur continue de rendre `parRoleEtStatut` : c'est lui qui
 * garantit, par test, que les marges s'accordent au croisement.
 *
 * ═══ CE QUE LA PAGE REPREND DE `admin_dashboard.html` ═══ (demande du porteur,
 * 2026-09-02 : « voir l'ancienne logique ».) Le panneau `#panel-stats` de
 * l'existant portait quatre chiffres — actifs, désactivés, directeurs en essai,
 * utilisateurs en ligne — deux graphiques (rôles, inscriptions sur douze mois)
 * et un tableau d'activité.
 *
 * ═══ ⚠️ LE BATTEMENT DE CŒUR A DÛ ÊTRE PORTÉ POUR CELA ═══
 * « Utilisateurs en ligne » et « temps passé » n'ont AUCUNE autre source : sans
 * battement, `derniereActivite` ne bouge qu'à la connexion et `tempsPasse` reste
 * à zéro. Les afficher sans lui, c'eût été montrer deux zéros permanents. Le
 * porteur ayant redemandé la page « comme dans l'ancien », `heartbeat.php` est
 * porté (`POST /auth/activite` + `lib/battementCoeur.js`) — la donnée d'abord,
 * l'écran ensuite.
 *
 * ═══ LA DISPOSITION, REVUE LE 2026-09-02 ═══ (demande du porteur.) Trois
 * défauts se voyaient sur la capture, et aucun ne tenait aux données :
 *  1. les quatre cartes étaient HAUTES — icône, nombre et libellé empilés — pour
 *     quatre nombres d'un chiffre ; elles mangeaient le premier écran ;
 *  2. les quatre chiffres suivants FLOTTAIENT sans cadre, juste sous des cartes
 *     qui en avaient un : ils se lisaient comme des orphelins plutôt que comme
 *     une seconde rangée ;
 *  3. les deux graphiques n'avaient NI la même hauteur ni le même habillage —
 *     titre dehors, cadre dedans, et l'anneau dépassait la courbe de soixante
 *     pixels. Deux boîtes côte à côte qui ne s'alignent pas se lisent comme un
 *     défaut d'affichage.
 */
/** La hauteur commune des deux graphiques — c'est elle qui les aligne. */
const HAUTEUR_GRAPHIQUE = 240;

export default function StatistiquesAdmin() {
  const requete = useQuery({
    queryKey: ['admin-stats'],
    queryFn: chargerStatistiques,
    retry: false,
    /*
     * ⚠️ LA CARTE « EN LIGNE » ÉTAIT FIGÉE AU CHARGEMENT, le tableau juste en
     * dessous se rafraîchissant, lui, toutes les 30 s : la pastille qui pulse
     * annonçait donc un nombre mort à côté de pastilles vivantes. Deux nombres
     * qui décrivent la même chose et se contredisent sur le même écran.
     *
     * ⚠️ 30 s, PAS MOINS : c'est le pas du battement de cœur
     * (`battementCoeur.js`), et « en ligne » se juge sur une fenêtre de 75 s
     * côté serveur. On ne peut pas être plus frais que la donnée — sonder plus
     * souvent n'afficherait rien de plus.
     *
     * ⚠️ SEUL « en ligne » EST VOLATIL dans cette réponse ; le parc, les
     * inscriptions par mois et les établissements servis ne bougent qu'à la
     * journée. Si ces cinq agrégations finissaient par coûter, la sortie serait
     * d'isoler le décompte en ligne dans sa propre route — pas d'espacer le
     * sondage, qui rendrait la pastille fausse.
     */
    refetchInterval: 30_000,
  });

  if (requete.isError) {
    return (
      <>
        <BarreNavigation titre="Administration" />
        <main className="flex min-h-screen items-center justify-center bg-background px-4">
          <Alerte type="erreur" titre="Accès refusé" className="max-w-md">
            {requete.error.message} — cet écran est réservé aux administrateurs.
          </Alerte>
        </main>
      </>
    );
  }

  const stats = requete.data?.statistiques;

  return (
    <>
      <BarreNavigation titre="Administration" liens={<SectionsAdmin />} messagerie />

      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          {!stats ? (
            <IndicateurChargement />
          ) : (
            <>
              {/*
                ═══ UNE BANDE DE QUATRE CARTES, SANS ÉCART ═══ (demande du
                porteur, 2026-09-02.) Espacées, ce sont quatre objets qu'on
                compare un à un ; réunies sous une seule bordure, elles forment
                un relevé qu'on parcourt d'un regard. Le dessin est partagé avec
                la page « Directeurs » (`CartesStat`).

                ⚠️ « ACTIFS » ET « DÉSACTIVÉS » NE SONT PAS DEUX MESURES, c'est
                UNE mesure et sa part : leur somme fait le parc. Deux cartes
                côte à côte, dont l'une affiche presque toujours zéro, prenaient
                la moitié de la rangée pour dire ce qu'une seule dit mieux.

                ⚠️ ET LES CHIFFRES DE DIRECTEURS SONT PARTIS SUR LEUR PAGE :
                « en essai » et « en attente » ne concernent qu'un rôle, et cette
                page-ci existe précisément parce qu'elle regarde TOUT le parc.
                Ils vivent désormais là où on agit dessus.
              */}
              <section aria-label="Vue d'ensemble">
                <BandeCartes>
                  <CarteStat
                    Icone={Users}
                    libelle="Comptes"
                    valeur={stats.total}
                    teinte="text-primary"
                    fond="bg-primary/10"
                    detail={<Repartition actifs={stats.actifs} desactives={stats.desactives} />}
                  />

                  {/* ⚠️ LE POINT NE PULSE QUE S'IL Y A QUELQU'UN : une pastille
                      qui clignote à côté d'un zéro annonce une présence qui
                      n'existe pas. */}
                  <CarteStat
                    Icone={Signal}
                    libelle="Utilisateurs en ligne"
                    valeur={stats.enLigne}
                    teinte="text-success"
                    fond="bg-success/10"
                    pulse={stats.enLigne > 0}
                  />

                  <CarteStat
                    Icone={UserX}
                    libelle="Jamais connectés"
                    valeur={stats.jamaisConnectes}
                    teinte="text-muted-foreground"
                    fond="bg-muted"
                  />

                  {/*
                    ⚠️ « QUI PORTENT DES COMPTES », PAS « ÉTABLISSEMENTS » : le
                    nombre brut a été retiré la veille parce qu'il comptait des
                    cartes créées puis abandonnées — sept sur huit ici. Celui-ci
                    dit ceux qui SERVENT, et c'est le même que la liste du filtre
                    propose, à l'entrée près.
                  */}
                  <CarteStat
                    Icone={Building2}
                    libelle="Établissements avec comptes"
                    valeur={stats.etablissementsAvecComptes}
                    teinte="text-accent-teal"
                    fond="bg-accent-teal/10"
                  />
                </BandeCartes>
              </section>

              {/*
                ═══ LES DEUX GRAPHIQUES DE L'EXISTANT, CÔTE À CÔTE ═══
                Répartition par rôle et évolution des inscriptions. Le camembert
                avait été écarté comme redondant avec le tableau croisé ; le
                porteur l'a redemandé, et il porte une chose que le tableau ne
                donne pas : la PROPORTION, lisible sans comparer des nombres.

                ⚠️ MÊME HAUTEUR ET MÊME CADRE POUR LES DEUX : `items-stretch` est
                le défaut d'une grille, mais il ne sert à rien tant que le
                contenu décide de sa propre hauteur. C'est `HAUTEUR_GRAPHIQUE`,
                partagée, qui les aligne réellement.
              */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Panneau titre="Répartition des utilisateurs par rôle">
                  <CamembertRoles parRole={stats.parRole ?? {}} />
                </Panneau>

                <Panneau titre="Évolution des inscriptions">
                  <CourbeInscriptions serie={stats.inscriptionsParMois ?? []} />
                </Panneau>
              </div>

              <section aria-label="Activité" className="space-y-3 pt-2">
                <div>
                  <h2 className="text-sm font-semibold">Activité et temps passé par utilisateur</h2>
                  <p className="text-sm text-muted-foreground">
                    Rafraîchi toutes les 30 secondes, au pas du battement de cœur.
                  </p>
                </div>
                <TableauActivite />
              </section>
            </>
          )}
        </div>
      </main>
    </>
  );
}

/**
 * Le cadre commun des deux graphiques : titre DEDANS, hauteur imposée.
 *
 * ⚠️ LE TITRE ENTRE DANS LE CADRE : posé dehors, il flottait au-dessus d'une
 * boîte à laquelle rien ne le rattachait — et les deux titres ne tombaient pas à
 * la même hauteur quand l'un passait sur deux lignes.
 */
function Panneau({ titre, children }) {
  return (
    <section aria-label={titre} className="rounded-lg border">
      <h2 className="border-b px-4 py-3 text-sm font-semibold">{titre}</h2>
      <div className="p-3">{children}</div>
    </section>
  );
}

/**
 * La courbe des inscriptions sur douze mois.
 * ← le `trendChart` de `admin_dashboard.html` (Chart.js, en ligne).
 *
 * ⚠️ RECHARTS EMPAQUETÉ, PAS CHART.JS DEPUIS UN CDN : l'existant chargeait la
 * bibliothèque au clic — sans réseau ou derrière un filtrage, le graphique
 * restait vide. C'est le choix inscrit au plan (Phase 7), et il rend la CSP
 * stricte de la Phase 11 applicable.
 *
 * ⚠️ `isAnimationActive={false}` : Chrome gèle les trames d'un onglet qui n'est
 * pas à l'écran, et l'aire resterait plate — piège déjà consigné pour les autres
 * graphiques du produit.
 */
function CourbeInscriptions({ serie }) {
  if (serie.every((point) => point.total === 0)) {
    return <Vide hauteur={HAUTEUR_GRAPHIQUE}>Aucune inscription sur les douze derniers mois.</Vide>;
  }

  return (
    <ResponsiveContainer width="100%" height={HAUTEUR_GRAPHIQUE}>
      <AreaChart data={serie} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="degradeInscriptions" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="mois"
          tickFormatter={moisCourt}
          tickLine={false}
          axisLine={{ stroke: 'hsl(var(--border))' }}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
        />
        {/*
          ⚠️ `allowDecimals={false}` : on compte des COMPTES. Sans cela, une
          série qui plafonne à 2 se gradue « 0 · 0,5 · 1 · 1,5 · 2 », et une
          demi-inscription n'existe pas.
        */}
        <YAxis
          width={32}
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
        />
        <Tooltip
          labelFormatter={moisLong}
          formatter={(valeur) => [`${valeur} compte(s)`, 'Inscriptions']}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        {/*
          ⚠️⚠️ `linear`, PAS `monotone` : une courbe lissée INVENTE des valeurs
          entre deux mois. Constaté à l'écran — vingt inscriptions au seul mois
          d'août dessinaient une cloche qui montait dès juillet et redescendait
          en septembre, deux mois où il ne s'est rien passé. Sur des comptes
          mensuels, seuls les points sont vrais ; le segment qui les relie doit
          être droit.
        */}
        <Area
          type="linear"
          dataKey="total"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill="url(#degradeInscriptions)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * ⚠️ LA DATE EST CONSTRUITE AU MILIEU DU MOIS, pas au premier jour : « 2026-09 »
 * lu comme « 2026-09-01T00:00Z » puis rendu en heure locale donne le 31 août à
 * l'ouest de Greenwich, soit le mois PRÉCÉDENT. Le 15 ne bascule jamais.
 */
const dateDuMois = (cle) => {
  const [annee, mois] = String(cle).split('-').map(Number);
  return new Date(annee, mois - 1, 15);
};

const moisCourt = (cle) =>
  dateDuMois(cle).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');

const moisLong = (cle) =>
  dateDuMois(cle).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

/**
 * ⚠️ `DernieresConnexions` A ÉTÉ RETIRÉE (2026-09-02) : le tableau d'activité
 * porte la même colonne, pour TOUS les comptes et avec ses filtres. Deux listes
 * de connexions sur un écran, c'était la redondance qu'on reproche aux cartes.
 */

/**
 * La répartition du parc, sous le libellé de la carte « Comptes ».
 * (demande du porteur, 2026-09-02.)
 *
 * ═══ ⚠️ UNE MESURE ET SA PART, PAS DEUX MESURES ═══ « Actifs » et
 * « désactivés » s'additionnent pour faire le parc : deux cartes de même poids,
 * dont l'une affiche presque toujours zéro, laissaient croire à deux grandeurs
 * indépendantes. Ici le total porte le regard, et les deux parts se lisent
 * dessous — c'est le rapport qui informe.
 *
 * ⚠️ « DÉSACTIVÉS » N'EST EN ROUGE QU'AU-DESSUS DE ZÉRO : un « 0 désactivé » en
 * rouge signale un problème là où il n'y en a pas — c'est même la meilleure des
 * nouvelles.
 *
 * ⚠️ ET RIEN N'EST TRONQUÉ ICI : tronquer un chiffre, c'est le rendre faux
 * (« 1 désa… », signalé par le porteur). Cette ligne se lit entière ou pas du
 * tout.
 */
function Repartition({ actifs, desactives }) {
  return (
    <>
      {/* ⚠️ L'ACCORD SE FAIT : « 1 désactivés » se lit comme une faute de
          l'application, et fait douter du chiffre lui-même. */}
      <span className="font-medium text-success tabular-nums">
        {actifs} actif{actifs > 1 ? 's' : ''}
      </span>
      <span className="text-muted-foreground"> · </span>
      <span
        className={`font-medium tabular-nums ${
          desactives > 0 ? 'text-destructive' : 'text-muted-foreground'
        }`}
      >
        {desactives} désactivé{desactives > 1 ? 's' : ''}
      </span>
    </>
  );
}

/**
 * Le camembert des rôles. ← le `rolesChart` de `admin_dashboard.html`.
 *
 * ⚠️ UN ANNEAU, PAS UN DISQUE : le trou libère le centre, et l'œil compare des
 * arcs plutôt que des pointes — c'est ce que faisait l'existant (`doughnut`).
 *
 * ⚠️ LE TOTAL EST ÉCRIT DANS LE TROU : c'est la place que l'anneau libère, et
 * sans lui il faut additionner quatre parts pour savoir de quel parc on parle.
 */
function CamembertRoles({ parRole }) {
  const parts = ORDRE_ROLES.filter((role) => (parRole[role] ?? 0) > 0).map((role) => ({
    nom: libelleRole(role),
    valeur: parRole[role],
    couleur: COULEURS_ROLE[role],
  }));

  if (parts.length === 0) {
    return <Vide hauteur={HAUTEUR_GRAPHIQUE}>Aucun compte enregistré.</Vide>;
  }

  const total = parts.reduce((somme, part) => somme + part.valeur, 0);

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={HAUTEUR_GRAPHIQUE}>
        <PieChart>
          <Pie
            data={parts}
            dataKey="valeur"
            nameKey="nom"
            cy="42%"
            innerRadius={52}
            outerRadius={80}
            paddingAngle={2}
            isAnimationActive={false}
          >
            {parts.map((part) => (
              <Cell key={part.nom} fill={part.couleur} stroke="hsl(var(--card))" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip
            formatter={(valeur, nom) => [`${valeur} compte(s)`, nom]}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/*
        ⚠️ POSÉ PAR-DESSUS, ET `pointer-events-none` : sans cela, le total
        intercepterait le survol du centre de l'anneau — la zone la plus proche
        des arcs, et celle qu'on traverse pour les atteindre.

        ⚠️ ET IL SUIT LE `cy` DU CAMEMBERT (42 %), pas le centre de la boîte : la
        légende occupe le bas, l'anneau est donc remonté.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center justify-center"
        style={{ height: HAUTEUR_GRAPHIQUE * 0.84 }}
      >
        <span className="text-2xl font-bold leading-none tabular-nums">{total}</span>
        <span className="mt-0.5 text-xs text-muted-foreground">comptes</span>
      </div>
    </div>
  );
}

/**
 * ⚠️ UN VIDE À LA HAUTEUR DU GRAPHIQUE qu'il remplace : une phrase de deux
 * lignes ferait remonter son cadre et désalignerait la paire — le défaut même
 * qu'on vient de corriger.
 */
function Vide({ hauteur, children }) {
  return (
    <div
      className="flex items-center justify-center text-center text-sm text-muted-foreground"
      style={{ height: hauteur }}
    >
      {children}
    </div>
  );
}
