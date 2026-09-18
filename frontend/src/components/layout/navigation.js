import {
  Award,
  BookOpen,
  Briefcase,
  CalendarDays,
  CalendarRange,
  DoorOpen,
  FileText,
  GanttChart,
  GraduationCap,
  House,
  Layers,
  Mail,
  Network,
  PencilRuler,
  Settings,
  TrendingUp,
  UserX,
  Users,
} from 'lucide-react';
import { ROLES } from 'shared/constants';
import { PAGES_PARTAGEABLES, libellePage, urlDePage } from 'shared/domain';

/**
 * Navigation de l'application.
 *
 * ═══ UNE SEULE DÉFINITION ═══
 * Le menu, les routes et les titres de page sortent d'ici. L'existant PHP
 * recopiait sa barre de navigation dans chacune des 30 pages HTML : ajouter une
 * entrée demandait 30 modifications, et certaines pages avaient dérivé.
 *
 * ═══ LES ICÔNES DISENT LE GESTE, PAS LA CATÉGORIE ═══
 * Deux entrées voisines ne doivent jamais porter la même image : « Emploi du
 * temps » et « Calendrier » sont tous deux des calendriers, mais on CONSULTE
 * l'un et on RÈGLE l'autre — d'où une plage horaire d'un côté, un mois de
 * l'autre. Une icône qui se répète oblige à lire l'intitulé, et elle ne sert
 * alors plus à rien.
 *
 * `phase` indique quand l'écran arrive (cf. le plan de migration). Tant qu'il
 * n'existe pas, la route rend un écran d'attente qui le dit — plutôt qu'un lien
 * mort ou une page blanche.
 */
/** Accès de premier niveau, affichés en ligne comme dans Notion. */
export const RACCOURCIS = [
  { titre: 'Accueil', url: '/app', icone: House },
  { titre: 'Messagerie', url: '/app/messagerie', icone: Mail },
];

export const NAVIGATION = [
  {
    /*
     * ⚠️ « EMPLOI » TOUT COURT (2026-08-25, demande du porteur). Le menu tient
     * dans une colonne de 16 rem : « Emploi du temps » y était l'entrée la plus
     * longue, et le mot « emploi » suffit à la désigner sans ambiguïté — aucune
     * autre entrée ne commence par là.
     */
    titre: 'Emploi',
    url: '/app/emploi',
    // Une PLAGE : la grille se lit par semaine, pas par jour.
    icone: CalendarRange,
    phase: 5,
  },
  {
    titre: 'Édition',
    url: '/app/edition',
    // Un outil de tracé : c'est l'écran où l'on CONSTRUIT la grille.
    icone: PencilRuler,
    phase: 5,
  },
  {
    titre: 'Avancement',
    url: '/app/avancement',
    // Une progression, pas une liste : c'est un taux qu'on y suit.
    icone: TrendingUp,
    phase: 7,
  },
  {
    titre: 'Absences',
    url: '/app/absences',
    // Quelqu'un qui MANQUE. Une horloge évoquait un retard, pas une absence.
    icone: UserX,
    phase: 8,
  },
  {
    titre: 'Documents',
    url: '/app/documents',
    icone: FileText,
    phase: 10,
  },
  {
    titre: 'Paramètres',
    url: '/app/parametres',
    icone: Settings,
    /*
     * Les douze panneaux de `profile.html` (F13). Ils sont regroupés ici plutôt
     * qu'étalés dans le menu principal : ce sont des réglages qu'on ouvre
     * quelques fois par an, pas des écrans de travail quotidien.
     *
     * `resume` sert à la page d'accueil des Paramètres (`PageParametres`). Il
     * vit ICI parce que ce fichier est LA définition unique du menu : une
     * entrée ajoutée sans y toucher apparaîtrait dans la barre latérale mais
     * pas sur la page, ou l'inverse.
     */
    sousMenu: [
      // Une porte, pas un bâtiment : le bâtiment désigne l'établissement,
      // affiché juste au-dessus dans le sélecteur.
      { titre: 'Espaces', url: '/app/parametres/espaces', icone: DoorOpen, phase: 4, resume: 'Salles et TEAMS où placer les séances' },
      { titre: 'Calendrier', url: '/app/parametres/calendrier', icone: CalendarDays, phase: 4, resume: 'Jours fériés et périodes de vacances' },
      { titre: 'Formateurs', url: '/app/parametres/formateurs', icone: Users, phase: 4, resume: 'Adresses, matricules et masses horaires' },
      { titre: 'Affectations', url: '/app/parametres/affectations', icone: Network, phase: 4, resume: 'Filières, groupes et qui enseigne quoi' },
      { titre: 'Stages', url: '/app/parametres/stages', icone: Briefcase, phase: 4, resume: 'Périodes en entreprise, par groupe' },
      { titre: 'Formations', url: '/app/parametres/formations', icone: BookOpen, phase: 4, resume: 'Périodes de formation des formateurs' },
      { titre: 'Sessions', url: '/app/parametres/sessions', icone: GraduationCap, phase: 4, resume: 'Comptes formateurs, stagiaires et gestionnaires' },
      // Un diagramme de Gantt : c'est exactement ce qu'est un chronogramme.
      { titre: 'Chronogramme', url: '/app/parametres/chronogramme', icone: GanttChart, phase: 7, resume: 'Planning annuel par groupe' },
      { titre: 'Groupes (FQ)', url: '/app/parametres/groupes-fq', icone: Layers, phase: 4, resume: 'Groupes réels composant un groupe FQ' },
      { titre: 'EFM régional', url: '/app/parametres/efm-regional', icone: Award, phase: 7, resume: 'Modules évalués au niveau régional' },
    ],
  },
];

/**
 * Écrans qui ont une ROUTE mais pas d'entrée de menu.
 *
 * Le profil s'atteint par le menu du compte, en pied de barre. Le lister aussi
 * dans le menu principal offrait deux chemins pour un même écran, sans rien qui
 * dise qu'ils mènent au même endroit.
 */
const HORS_MENU = [{ titre: 'Mon profil', url: '/app/profil', phase: 4 }];

/**
 * ═══ SESSIONS CONSULTATIVES — FORMATEUR & STAGIAIRE (F14) ═══
 * (2026-09-03, demande du porteur.)
 *
 * ⚠️ CE NE SONT PAS LES ROUTES DU DIRECTEUR, RÉDUITES. « Emploi », « Édition »
 * et « Avancement » du directeur ÉCRIVENT et couvrent tout l'établissement —
 * les ouvrir à un formateur exposerait la grille de ses collègues. Ce sont des
 * écrans SÉPARÉS (`/app/mon-emploi`…), scopés à cette seule personne par le
 * serveur (`consultation.service.js`), jamais par un simple filtre d'écran.
 *
 * ⚠️ « AFFECTATIONS » N'EXISTE QUE POUR LE FORMATEUR. Un stagiaire n'est
 * affecté à rien — il est INSCRIT à des groupes. C'est aussi ce que l'existant
 * reflète : il n'y a pas d'« affectationStagiaire.html » à côté
 * d'« affectationFormateur.html ». Il a en revanche « Programme » depuis le
 * 2026-09-05, qui répond à la même question par l'autre bout — voir plus bas.
 *
 * ═══ ⚠️ `titre` EST L'ENTRÉE DE MENU, `titrePage` EST L'EN-TÊTE DE L'ÉCRAN ═══
 * (2026-09-05, demande du porteur : « ajouter les titres pour les pages ».)
 * La barre horizontale de ces sessions tient sur une ligne — « Emploi »,
 * « Avancement » y suffisent — mais une page qui s'ouvre sans titre ne dit pas
 * ce qu'on regarde : la coquille du directeur le tenait de son fil d'Ariane,
 * que ces sessions n'ont pas. Les deux valeurs vivent donc ICI, ensemble, pour
 * la même raison que le reste du menu : une seule définition.
 *
 * Les intitulés sont ceux de l'existant, à la casse près (ce projet écrit ses
 * titres en bas de casse) : `emploiStagiaire.html` titrait « Mon Emploi du
 * Temps », `avancementFormateur.html` « Suivi de l'Avancement »,
 * `affectationFormateur.html` « Mes Affectations », `tableMatieres.html`
 * « Table des Matières ».
 *
 * ⚠️ SEULES LES ENTRÉES QUI PORTENT `titrePage` REÇOIVENT UN EN-TÊTE. « Mon
 * profil » écrit déjà le sien (`<h1>Compte</h1>`) et la messagerie occupe toute
 * la hauteur en trois colonnes : leur en ajouter un poserait un second titre
 * sur l'un, et volerait de la place à l'autre.
 */
export const NAVIGATION_FORMATEUR = [
  { titre: 'Emploi', titrePage: 'Mon emploi du temps', url: '/app/mon-emploi', icone: CalendarRange, phase: 10 },
  { titre: 'Affectations', titrePage: 'Mes affectations', url: '/app/mes-affectations', icone: Network, phase: 10 },
  { titre: 'Avancement', titrePage: "Suivi de l'avancement", url: '/app/mon-avancement', icone: TrendingUp, phase: 10 },
];

/**
 * ⚠️ « PROGRAMME » N'EXISTE QUE POUR LE STAGIAIRE (2026-09-05, demande du
 * porteur : « ajouter la page programme chez le stagiaire comme celui dans
 * l'ancien edt pro »). C'est l'entrée `tableMatieres.html` du menu stagiaire de
 * l'existant — et le PENDANT de « Mes affectations » du formateur : la même
 * table `Base.affectations`, lue par l'autre bout (« qu'est-ce qu'on
 * m'enseigne » plutôt que « qu'est-ce que j'enseigne »). Un formateur a déjà sa
 * réponse, d'où deux écrans distincts plutôt qu'un seul partagé.
 *
 * L'icône est un LIVRE OUVERT : les deux autres entrées portent un calendrier
 * et une courbe — on consulte ici un CONTENU, pas un moment ni un taux.
 */
export const NAVIGATION_STAGIAIRE = [
  { titre: 'Emploi', titrePage: 'Mon emploi du temps', url: '/app/mon-emploi', icone: CalendarRange, phase: 10 },
  { titre: 'Programme', titrePage: 'Table des matières', url: '/app/mon-programme', icone: BookOpen, phase: 10 },
  { titre: 'Avancement', titrePage: "Suivi de l'avancement", url: '/app/mon-avancement', icone: TrendingUp, phase: 10 },
];

/**
 * ⚠️ LE GESTIONNAIRE VOIT UN SOUS-ENSEMBLE DU MENU DU DIRECTEUR, PAS UN
 * TROISIÈME MENU (demande du porteur : « c'est la même chose que le
 * directeur, mais il peut accéder seulement aux pages édition et document »).
 * Une liste à part aurait dérivé du menu directeur au premier ajout — deux
 * définitions de « Édition », le §4.2 sous une forme nouvelle. On FILTRE donc
 * `NAVIGATION` par URL, plutôt que de le recopier.
 */
const URLS_GESTIONNAIRE = ['/app/edition', '/app/documents', '/app/absences'];
/*
 * ⚠️ « ABSENCES » S'AJOUTE LE 2026-09-14 (F9) : le gestionnaire — le surveillant
 * général — saisit les absences des STAGIAIRES et leurs sanctions. La page ne lui
 * montre que cet onglet ; le registre des formateurs lui reste fermé.
 */

/**
 * La navigation à monter, pour le rôle donné. C'est LE point d'entrée que la
 * coquille (barre latérale, garde de route, accueil) doit appeler — jamais
 * `NAVIGATION` directement, qui ne vaut que pour le directeur.
 */
/**
 * Les raccourcis de tête de barre, pour le rôle donné.
 *
 * ═══ ⚠️ LE GESTIONNAIRE N'A PAS D'ACCUEIL ═══ (2026-09-06, demande du
 * porteur : « en session gestionnaire supprime la page accueil ».)
 *
 * `AccueilApp` est un tableau de bord d'ÉTABLISSEMENT — formateurs, groupes,
 * stagiaires, salles, chronogrammes — c'est-à-dire précisément ce qu'un
 * gestionnaire ne gère pas : il n'a accès qu'à « Édition » et « Documents ».
 * `AccueilRouteur` le renvoyait DÉJÀ vers « Édition » (2026-09-03) : l'entrée du
 * menu ne menait donc nulle part d'autre que là où il est déjà, tout en laissant
 * croire à un écran de plus.
 *
 * ⚠️ LA ROUTE `/app` SURVIT — c'est elle qui redirige. Ce qui disparaît, c'est
 * le LIEN dans le menu : un chemin qu'on ne propose plus, pas un chemin cassé.
 */
export function raccourcisPourRole(role) {
  if (role === ROLES.GESTIONNAIRE) return RACCOURCIS.filter((entree) => entree.url !== '/app');
  return RACCOURCIS;
}

/**
 * ═══ LES PAGES PARTAGÉES S'AJOUTENT AU MENU DU RÔLE ═══
 * (2026-09-12, Phase 5bis — invitations ; plusieurs pages depuis l'étape d.)
 * Un formateur invité doit pouvoir ouvrir ce qu'on lui partage ; un
 * gestionnaire invité à MODIFIER l'emploi du temps doit trouver « Emploi » à
 * côté de son « Édition ».
 *
 * ⚠️ L'ENTRÉE DÉPEND DU DROIT, PAS SEULEMENT DE L'INVITATION : `urlDePage` mène
 * « peut consulter » à l'écran de LECTURE quand la page en a un (Emploi →
 * Édition). Ouvrir la grille de saisie à quelqu'un qui ne peut rien y poser
 * offrirait 1 224 listes déroulantes qui échoueraient toutes au clic.
 *
 * ═══ UNE PAGE : UN LIEN. PLUSIEURS : UNE CARTE AU SURVOL ═══
 * (2026-09-12, demande du porteur : « si le directeur a partagé beaucoup de
 * pages, une carte au survol qui les contient — et pour le gestionnaire ».)
 * Une entrée par page aurait allongé la barre du formateur — ou la barre latérale
 * du gestionnaire — de cinq ou six liens qu'on ne distinguerait plus des siens.
 * L'entrée « Partagé » porte alors `partage: true` et ses pages en `sousMenu`,
 * chacune avec sa `page` : la carte les range par colonne (`grouperPages`).
 *
 * ⚠️ LA MÊME RÈGLE POUR LES DEUX RÔLES, écrite UNE fois : un seuil propre à
 * chaque barre aurait fait qu'à trois pages partagées, l'un voit une carte et
 * l'autre trois liens.
 *
 * `partages` vient de `GET /partages/moi` (voir `usePartagesAvecMoi`). Seules
 * les entrées `partagee` comptent : l'accès du gestionnaire par son RÔLE lui
 * donne déjà « Édition ».
 */
export const ENTREE_PARTAGEE = {
  titre: 'Partagé',
  titrePage: null,
  icone: Users,
  phase: 5,
};

/** À partir de combien de pages elles se rangent dans la carte « Partagé ». */
export const SEUIL_CARTE_PARTAGE = 2;

/** L'entrée du menu du DIRECTEUR qui porte cette adresse — son titre, son icône. */
const entreeDirecteur = (url) =>
  NAVIGATION.flatMap((entree) => (entree.sousMenu ? [entree, ...entree.sousMenu] : [entree])).find(
    (entree) => entree.url === url
  );

function entreesPartagees(role, partages) {
  if (role !== ROLES.FORMATEUR && role !== ROLES.GESTIONNAIRE) return [];

  const pages = partages
    .filter((acces) => acces.partagee && PAGES_PARTAGEABLES[acces.page])
    .map((acces) => {
      const url = urlDePage(acces.page, acces.droit);
      const directeur = entreeDirecteur(url);
      return {
        // Le libellé du REGISTRE (« Emploi du temps »), pas celui du menu du
        // directeur (« Emploi ») : dans la carte, la page n'a pas de voisin qui
        // l'explique.
        titre: libellePage(acces.page),
        titrePage: null,
        url,
        icone: directeur?.icone ?? Users,
        phase: 5,
        page: acces.page,
        droit: acces.droit,
        directeur,
      };
    })
    // ⚠️ Le gestionnaire a déjà Édition et Documents par son rôle : ne pas les doubler.
    .filter((entree) => role !== ROLES.GESTIONNAIRE || !URLS_GESTIONNAIRE.includes(entree.url));

  if (pages.length === 0) return [];

  if (pages.length < SEUIL_CARTE_PARTAGE) {
    const { directeur, ...seule } = pages[0];
    // Le formateur : « Partagé », qui mène à la page. Le gestionnaire : l'entrée
    // du directeur telle quelle, sans son sous-menu — elle s'aligne sur les siennes.
    if (role === ROLES.FORMATEUR) return [{ ...ENTREE_PARTAGEE, url: seule.url }];
    const { sousMenu, ...entree } = directeur ?? seule;
    return [entree];
  }

  return [
    {
      ...ENTREE_PARTAGEE,
      url: pages[0].url,
      partage: true,
      sousMenu: pages.map(({ directeur, ...page }) => page),
    },
  ];
}

/**
 * ═══ L'ADMINISTRATEUR EN COLLABORATION (2026-09-14) ═══ — ses seules pages sont
 * celles qui se partagent, où il est invité par défaut. Elles vont DIRECTEMENT
 * dans la barre, sans « Partagé » : il n'y a rien d'autre à côté d'elles.
 */
function entreesCollaboration(partages) {
  return partages
    .filter((acces) => acces.partagee && PAGES_PARTAGEABLES[acces.page])
    .map((acces) => {
      const url = urlDePage(acces.page, acces.droit);
      return {
        titre: libellePage(acces.page),
        titrePage: null,
        url,
        icone: entreeDirecteur(url)?.icone ?? Users,
        phase: 5,
        page: acces.page,
        droit: acces.droit,
      };
    });
}

export function navigationPourRole(role, { partages = [] } = {}) {
  if (role === ROLES.ADMIN) return entreesCollaboration(partages);
  if (role === ROLES.FORMATEUR) return [...NAVIGATION_FORMATEUR, ...entreesPartagees(role, partages)];
  if (role === ROLES.STAGIAIRE) return NAVIGATION_STAGIAIRE;
  if (role === ROLES.GESTIONNAIRE) {
    return [
      ...entreesPartagees(role, partages),
      ...NAVIGATION.filter((entree) => URLS_GESTIONNAIRE.includes(entree.url)),
    ];
  }
  return NAVIGATION;
}

/**
 * Toutes les entrées, sous-menu compris — pour construire les routes ET
 * retrouver le TITRE d'une page (`FilAriane`), quel que soit le rôle qui la
 * consulte. Une entrée listée ici n'est pas pour autant OUVERTE à tous : c'est
 * `navigationPourRole` et les gardes de route qui en décident.
 *
 * ⚠️⚠️ DÉDOUBLONNÉE PAR URL (2026-09-05) : « Emploi » et « Avancement » figurent
 * dans les DEUX menus de session, formateur et stagiaire — la même adresse, le
 * même titre, deux entrées. `App.jsx` en tire une `<Route key={entree.url}>` par
 * élément : sans ce filtre, React recevait deux enfants de MÊME CLÉ (et deux
 * routes pour un seul chemin). Le défaut date du 2026-09-03 et n'avait pas été
 * vu ; l'ajout de « Programme » allongeait la liste sans le corriger.
 */
export const ENTREES = [
  ...RACCOURCIS.filter((entree) => entree.url !== '/app'),
  ...NAVIGATION.flatMap((entree) => (entree.sousMenu ? [entree, ...entree.sousMenu] : [entree])),
  ...NAVIGATION_FORMATEUR,
  ...NAVIGATION_STAGIAIRE,
  ...HORS_MENU,
].filter(
  (entree, rang, toutes) => toutes.findIndex((autre) => autre.url === entree.url) === rang
);

/**
 * Le TITRE que la page rend elle-même, en tête de son cadre (`CadreReglage`).
 *
 * ═══ DEUX CAS ═══
 *   - une entrée qui porte `titrePage` — les écrans des sessions formateur et
 *     stagiaire (« Mon emploi du temps »…) ;
 *   - ═══ (Phase 5bis, étape d2 bis) ═══ une page PARTAGÉE ouverte dans une
 *     coquille SANS fil d'Ariane (`sansFilAriane`) — un formateur invité sur
 *     « Stages » y arrivait sur une page muette, que seule l'entrée « Partagé »
 *     surlignée désignait. Elle prend le libellé du REGISTRE des pages
 *     partageables — celui de l'invitation et de la carte « Partagé » — plutôt
 *     que celui du menu du directeur (« Emploi du temps », pas « Emploi ») : la
 *     page n'a ici aucun voisin qui l'explique.
 *
 * ⚠️ JAMAIS DE TITRE DE PAGE PARTAGÉE CHEZ LE DIRECTEUR NI LE GESTIONNAIRE : leur
 * coquille porte le fil d'Ariane, qui rend déjà le nom en `<h1>`. Un second
 * serait le doublon retiré d'ici le 2026-08-25.
 *
 * ⚠️ L'ADRESSE LA PLUS SPÉCIFIQUE GAGNE, dans les deux listes — sans quoi
 * « /app/parametres/espaces » pourrait répondre « Paramètres ». L'adresse de
 * LECTURE compte aussi : un invité « peut consulter » l'emploi du temps l'ouvre
 * dans « Édition ».
 *
 * @param {string} pathname
 * @param {{ sansFilAriane?: boolean }} [options]
 * @returns {string | null}
 */
const correspondA = (pathname, url) =>
  Boolean(url) && (pathname === url || pathname.startsWith(`${url}/`));

/**
 * La page PARTAGEABLE qu'une adresse affiche — sa clé du registre (`emploi`,
 * `stages`…), ou `null` pour une page qui ne se partage pas (accueil,
 * messagerie, profil, hub des paramètres).
 *
 * ⚠️ L'ADRESSE DE LECTURE COMPTE : « Édition » est l'emploi du temps en lecture.
 * ⚠️ L'ADRESSE ENTIÈRE OU SUIVIE DE « / », la plus spécifique d'abord.
 *
 * Lue par le titre des pages partagées (d2 bis), par « Partager » et par la date
 * de modification de la barre du haut : trois lecteurs, une seule règle.
 */
export function pageDeChemin(pathname) {
  const trouvee = Object.entries(PAGES_PARTAGEABLES)
    .flatMap(([cle, page]) => [page.url, page.urlLecture].filter(Boolean).map((url) => ({ url, cle })))
    .sort((a, b) => b.url.length - a.url.length)
    .find((candidate) => correspondA(pathname, candidate.url));
  return trouvee?.cle ?? null;
}

export function titreDePage(pathname, { sansFilAriane = false } = {}) {
  const entree = [...ENTREES]
    .sort((a, b) => b.url.length - a.url.length)
    .find((candidate) => correspondA(pathname, candidate.url));
  if (entree?.titrePage) return entree.titrePage;
  if (!sansFilAriane) return null;

  const page = pageDeChemin(pathname);
  return page ? PAGES_PARTAGEABLES[page].libelle : null;
}
