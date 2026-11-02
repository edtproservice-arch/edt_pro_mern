import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link, Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  CalendarDays,
  ClipboardList,
  FileText,
  Megaphone,
  TrendingUp,
  UserX,
  BatteryFull,
  Bell,
  Check,
  ChevronDown,
  GraduationCap,
  LoaderCircle,
  Mail,
  MonitorDown,
  QrCode,
  School,
  Signal,
  Users,
  Wifi,
} from 'lucide-react';
import { essayerDemo, recupererSession } from '@/features/auth/api';
import { routeApresConnexion } from '@/features/auth/routage';
import { URL_INSTALLEUR_BUREAU } from '@/components/layout/BoutonApplicationBureau';
import { estApplicationTauri } from '@/lib/miseAJourDesktop';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CloudShader } from '@/components/ui/cloud-shader';

/**
 * ═══ LA PAGE D'ACCUEIL PUBLIQUE D'EDT PRO, À LA RACINE (2026-11-01, demande du porteur) ═══
 * Construite sur la STRUCTURE de la page Codex que le porteur a montrée (relevée dans le
 * navigateur : accroche centrée sur un dégradé — titre 52 px graisse 500, sous-titre 17 px,
 * boutons-pilules de 40 px —, fenêtre d'application, « Démarrer » en trois cartes, rangées
 * texte étroit + grand visuel sur dégradé, « partout » en quatre cartes, bandeau final, pied en
 * colonnes), mais en BLANC, BLEU, VERT ET GRIS — et sans rien reprendre de ses textes ni images.
 *
 * ═══ LA DÉMO EST LA VRAIE APPLICATION ═══ « Essayer comme… » crée un bac à sable fictif côté
 * serveur (`backend/src/modules/demo`) et y ouvre une session : le visiteur manipule EDT Pro
 * comme s'il était connecté, sans compte. Effacé après 24 h ; rien n'en sort.
 *
 * ⚠️ `/` EST UNE PAGE PUBLIQUE (`lib/pagesPubliques.js`) : sans cela, la vérification de session
 *    ci-dessous — un 401 pour tout visiteur — le renverrait vers « /connexion?raison=expiration ».
 * ⚠️ PAS DANS LES APPLICATIONS INSTALLÉES (bureau, Android) : elles s'ouvrent sur `/` et
 *    doivent mener droit à la connexion. Un compte connecté file vers son espace.
 * ═══ UN CIEL ANIMÉ (même jour : « le fond de Codex est naturel, réaliste et animé ») ═══ L'accroche
 * et le bandeau final sont posés sur `CloudShader` d'Aceternity (WebGL, 2026-11-02). Boutons, cartes et questions sont les
 * composants shadcn de l'application (`Button`, `Card`, `Collapsible`), arrondis en pilule.
 *
 * ⚠️ TOUJOURS EN CLAIR : couleurs écrites en dur, le thème sombre ne s'y applique pas.
 * ⚠️ AUCUNE AFFILIATION ANNONCÉE : « établissements de formation professionnelle », sans plus.
 */

const CONTACT = 'edtproservice@gmail.com';

/** Un ciel clair et FIGÉ, derrière les visuels des rangées (un seul ciel animé à l'écran suffit). */
function CielFige() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-gradient-to-b from-[#a9cff6] via-[#d9eafc] to-[#f3f8ff]">
      <div className="absolute -left-[10%] top-[8%] h-[45%] w-[55%] rounded-full bg-white/70 blur-[60px]" />
      <div className="absolute -right-[12%] bottom-[5%] h-[40%] w-[50%] rounded-full bg-[#CDCFCE]/60 blur-[70px]" />
      <div className="absolute bottom-[-10%] left-[30%] h-[35%] w-[40%] rounded-full bg-[#489C5A]/15 blur-[80px]" />
    </div>
  );
}

/**
 * Le menu du haut : le style des barres de l'application (administration, formateur, stagiaire —
 * `SectionsAdmin`), demandé par le porteur : entrées blanches sur le ciel, foncées sur la barre
 * blanche, pastille de fond sur la section à l'écran et au survol.
 */
const MENU = [
  ['demo-en-direct', 'Démo'],
  ['fonctionnalites', 'Fonctionnalités'],
  ['partout', 'Partout'],
  ['tarifs', 'Tarifs'],
  ['questions', 'Questions'],
];

/** La section du menu actuellement à l'écran (celle qui croise le haut de la fenêtre). */
function useSectionVue() {
  const [vue, setVue] = useState(null);
  useEffect(() => {
    const observateur = new IntersectionObserver(
      (entrees) => {
        for (const entree of entrees) if (entree.isIntersecting) setVue(entree.target.id);
      },
      { rootMargin: '-80px 0px -60% 0px' }
    );
    for (const [id] of MENU) {
      const section = document.getElementById(id);
      if (section) observateur.observe(section);
    }
    // Revenu en haut de page : aucune section n'est « vue ».
    const enHaut = () => window.scrollY < 200 && setVue(null);
    window.addEventListener('scroll', enHaut, { passive: true });
    return () => {
      observateur.disconnect();
      window.removeEventListener('scroll', enHaut);
    };
  }, []);
  return vue;
}

/**
 * Les tarifs (2026-11-02, demande du porteur) : un essai gratuit d'un mois, puis un abonnement
 * de 6 mois ou d'un an. Les deux passent par l'inscription — l'essai se demande depuis le compte, une fois
 * l'établissement inscrit (`/essai`).
 */
const TARIFS = [
  {
    nom: 'Essai gratuit',
    prix: '0 MAD',
    periode: 'pendant 1 mois',
    texte: 'Pour découvrir eDTpro avec votre propre établissement, sans engagement.',
    points: ['Toutes les fonctionnalités', 'Web et application Windows', 'Sans engagement'],
    bouton: 'Commencer l’essai',
  },
  {
    nom: '6 mois',
    prix: '600 MAD',
    periode: 'pour 6 mois',
    texte: 'Pour couvrir un semestre de formation.',
    points: ['Toutes les fonctionnalités', 'Web et application Windows', 'Assistance par e-mail'],
    bouton: 'Inscrire mon établissement',
  },
  {
    nom: 'Annuel',
    prix: '1 000 MAD',
    periode: 'par an',
    texte: 'Pour tenir les emplois du temps de votre établissement toute l’année.',
    points: ['Toutes les fonctionnalités', 'Web et application Windows', 'Assistance par e-mail'],
    bouton: 'Inscrire mon établissement',
    misEnAvant: true,
  },
];

/*
 * ═══ LES PAGES DE L'APPLICATION, QUI DÉFILENT (2026-11-02, demande du porteur : « avec des
 * icônes, et qui changent avec une animation, comme Codex ») ═══ Comme la rangée de logos de
 * Codex : cinq emplacements, et toutes les 2,5 s UN SEUL change — à tour de rôle — en piochant la
 * page suivante. L'animation est celle de `layout-text-flip` d'Aceternity (motion) : la nouvelle
 * arrive d'en haut en sortant d'un flou, l'ancienne s'en va vers le bas.
 * ⚠️ Figée si le visiteur demande moins d'animations.
 */
const FONCTIONS = [
  { Icone: CalendarDays, nom: 'Emploi' },
  { Icone: TrendingUp, nom: 'Avancement' },
  { Icone: ClipboardList, nom: 'Affectations' },
  { Icone: FileText, nom: 'Documents' },
  { Icone: UserX, nom: 'Absences' },
  { Icone: Mail, nom: 'Messagerie' },
  { Icone: Megaphone, nom: 'Annonces' },
];
const EMPLACEMENTS = 5;

function RangeeFonctions() {
  const [etat, setEtat] = useState({ visibles: [0, 1, 2, 3, 4], reserve: [5, 6], tour: 0 });

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const minuteur = setInterval(() => {
      setEtat(({ visibles, reserve, tour }) => {
        const place = tour % EMPLACEMENTS;
        const [nouvelle, ...reste] = reserve;
        const suivants = [...visibles];
        suivants[place] = nouvelle;
        return { visibles: suivants, reserve: [...reste, visibles[place]], tour: tour + 1 };
      });
    }, 2500);
    return () => clearInterval(minuteur);
  }, []);

  return (
    <div className="mx-auto mt-8 grid max-w-4xl grid-cols-3 gap-y-4 sm:grid-cols-5">
      {etat.visibles.map((indice, place) => {
        const { Icone, nom } = FONCTIONS[indice];
        return (
          // Les deux derniers emplacements n'existent qu'à partir de la tablette.
          <div key={place} className={`relative flex h-8 items-center justify-center overflow-hidden ${place >= 3 ? 'hidden sm:flex' : ''}`}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={indice}
                initial={{ y: -28, filter: 'blur(8px)', opacity: 0 }}
                animate={{ y: 0, filter: 'blur(0px)', opacity: 1 }}
                exit={{ y: 28, filter: 'blur(8px)', opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="inline-flex items-center gap-2 whitespace-nowrap text-[15px] font-bold text-slate-800"
              >
                <Icone className="size-[18px] text-[#0071DB]" strokeWidth={2.75} />
                {nom}
              </motion.span>
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Le ciel de l'accroche et du bandeau final : le `CloudShader` d'Aceternity UI, tel quel
 * (demande du porteur, 2026-11-02 : « change le ciel complet par celui-là »). Décoratif.
 */
function Ciel() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <CloudShader />
    </div>
  );
}

/** Les boutons de la page : ceux de shadcn, avec LEUR arrondi (demande du porteur), en 40 px de haut. */
const PILULE = 'h-10 px-5 text-sm font-medium';

/** Le nom de la marque, toujours écrit « eDTpro » et en italique (demande du porteur). */
const Marque = () => <em className="italic">eDTpro</em>;

/** La démo est dessinée à 70 % (« voir la totalité de la page ») ; 720 px affichés au départ. */
const ECHELLE_DEMO = 0.7;
const HAUTEUR_DEMO = Math.round(720 / ECHELLE_DEMO);
const HAUTEUR_DEMO_MAX = 12000; // garde-fou : une page qui grandirait avec son cadre

/**
 * ═══ UNE SEULE BARRE DE DÉFILEMENT (2026-11-01, demande du porteur : « le défilement de la page
 * globale lié à la page démo ») ═══ Le cadre prend la HAUTEUR DE SON CONTENU : l'application n'a
 * plus rien à faire défiler, c'est la page d'accueil qui défile. Toutes les 700 ms, on mesure ce
 * qui déborde encore dans le cadre (même origine) et on l'agrandit d'autant ; à chaque changement
 * de page de l'application, on repart de la hauteur de départ (une page plus courte rétrécit).
 * Sans contenu à faire défiler, la molette passe d'elle-même du cadre à la page.
 */
function CadreDemo({ adresse }) {
  const iframe = useRef(null);
  const [hauteur, setHauteur] = useState(HAUTEUR_DEMO);

  useEffect(() => {
    let chemin = null;
    const minuteur = setInterval(() => {
      const fenetre = iframe.current?.contentWindow;
      const doc = iframe.current?.contentDocument;
      if (!fenetre || !doc?.body) return;
      if (fenetre.location.pathname !== chemin) {
        chemin = fenetre.location.pathname;
        setHauteur(HAUTEUR_DEMO);
        return;
      }
      // Ce qui déborde encore : le document, ou une zone défilante de l'application (la principale
      // fait toute la hauteur ; les petites listes déroulantes sont laissées de côté).
      let deborde = doc.documentElement.scrollHeight - doc.documentElement.clientHeight;
      for (const element of doc.body.querySelectorAll('*')) {
        if (element.clientHeight < 200 || element.scrollHeight - element.clientHeight <= deborde) continue;
        if (/auto|scroll/.test(fenetre.getComputedStyle(element).overflowY)) {
          deborde = element.scrollHeight - element.clientHeight;
        }
      }
      if (deborde > 2) setHauteur((h) => Math.min(h + deborde, HAUTEUR_DEMO_MAX));
    }, 700);
    return () => clearInterval(minuteur);
  }, [adresse]);

  return (
    <div className="overflow-hidden" style={{ height: hauteur * ECHELLE_DEMO }}>
      <iframe
        ref={iframe}
        key={adresse}
        src={adresse}
        title="eDTpro — démo en direct"
        className="block w-[142.857%] origin-top-left scale-[0.7] border-0"
        style={{ height: hauteur }}
      />
    </div>
  );
}

/** Où ouvrir l'application dans la fenêtre, selon le rôle de la session de démo. */
const pageDemo = (utilisateur) =>
  utilisateur.role === 'directeur' ? '/app/emploi' : routeApresConnexion(utilisateur);

/**
 * ═══ LA FENÊTRE DE L'ACCUEIL EST L'APPLICATION ELLE-MÊME (2026-11-01, demande du porteur :
 * « au lieu d'image, doit être fonctionnel ») ═══ Au repos, une capture et le choix du rôle ;
 * au clic, le bac à sable est créé (`essayerDemo`) et la VRAIE application s'ouvre dans la
 * fenêtre (iframe, même origine : la session de démo y est). Une session de démo déjà ouverte
 * s'y affiche d'emblée.
 *
 * ⚠️ LANCÉE D'OFFICE EN DIRECTION (même jour, demande du porteur : « automatique »), mais
 *    seulement quand la fenêtre ARRIVE à l'écran (à 200 px près) et sur grand écran, une fois par visite : chaque
 *    démarrage copie un établissement entier. Les garde-fous restent côté serveur (6 par heure et
 *    par adresse, 300 copies actives au plus) ; s'ils refusent, le choix du rôle reste affiché.
 * ⚠️ SUR TÉLÉPHONE, PAS DE CADRE : l'application s'ouvre en plein écran, une fenêtre de 390 px
 *    dans une page de 390 px ne se manipule pas.
 * ⚠️ PAS DE BARRE DE TITRE (même jour, « pour gagner l'espace ») : la fenêtre n'est que l'application.
 */
function FenetreDemo({ demo, sessionDemo }) {
  const adresse = sessionDemo ? pageDemo(sessionDemo) : null;
  const [role, setRole] = useState('directeur');
  const cadre = useRef(null);
  const lancee = useRef(false);

  useEffect(() => {
    if (adresse || lancee.current || !window.matchMedia('(min-width: 768px)').matches) return undefined;
    const observateur = new IntersectionObserver(([entree]) => {
      if (!entree.isIntersecting || lancee.current) return;
      lancee.current = true;
      observateur.disconnect();
      demo.mutate('directeur');
    }, { rootMargin: '0px 0px 200px 0px' }); // juste sous le bas de l'écran : prête quand on y arrive
    observateur.observe(cadre.current);
    return () => observateur.disconnect();
  }, [adresse, demo]);

  return (
    // Un cadre de VERRE autour de la fenêtre (demande du porteur, 2026-11-02) : translucide, il
    // laisse voir le ciel, comme le téléphone ; la fenêtre elle-même reste blanche.
    <div ref={cadre} className="rounded-[1.25rem] bg-white/25 p-2.5 shadow-2xl shadow-[#0b1f3a]/25 ring-1 ring-inset ring-white/60 backdrop-blur-xl">
      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-black/10">
        {adresse ? (
          // Dézoomée à 70 % : dessinée sur une surface 1/0,7 fois plus large, puis réduite — cliquable.
          // ⚠️ Clé = le COMPTE, pas l'adresse : formateur et stagiaire ouvrent tous deux « /app » ; sans
          //    cela, passer de l'un à l'autre ne rechargeait pas le cadre (il gardait l'ancien compte).
          <CadreDemo key={sessionDemo.id ?? adresse} adresse={adresse} />
        ) : (
          <div className="relative">
            <img src="/accueil/application.webp" alt="L’emploi du temps d’un établissement dans eDTpro" className="block w-full" />
            <div className="absolute inset-0 flex items-center justify-center bg-white/55 p-4 backdrop-blur-[2px]">
              <div className="w-full max-w-lg rounded-xl bg-white/95 p-6 text-center shadow-2xl ring-1 ring-black/5 sm:p-8">
                <p className="text-[22px] font-medium tracking-[-0.02em] text-slate-900 sm:text-[26px]">Essayez <Marque /> ici, en direct</p>
                <p className="mt-2 text-[15px] text-slate-600">
                  La vraie application, dans un établissement fictif. Votre rôle :
                </p>
                {demo.isPending ? (
                  <p className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                    <LoaderCircle className="size-4 animate-spin text-[#0071DB]" /> Préparation de votre établissement de démo…
                  </p>
                ) : (
                <>
                <div role="radiogroup" aria-label="Rôle de la démo" className="mt-5 inline-flex rounded-md bg-slate-100 p-1">
                  {ROLES_DEMO.map(({ role: valeur, titre }) => (
                    <button
                      key={valeur}
                      type="button"
                      role="radio"
                      aria-checked={role === valeur}
                      disabled={demo.isPending}
                      onClick={() => setRole(valeur)}
                      className={`h-8 rounded-sm px-4 text-sm font-medium transition ${
                        role === valeur ? 'bg-white text-slate-900 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      {titre}
                    </button>
                  ))}
                </div>
                <div className="mt-5">
                  <Button className={PILULE} onClick={() => demo.mutate(role)}>
                    Lancer la démo <ArrowUpRight />
                  </Button>
                </div>
                </>
                )}
                {demo.isError && (
                  <p role="alert" className="mt-4 text-sm font-medium text-red-600">
                    {demo.error?.message || 'La démo n’a pas pu démarrer. Réessayez dans un instant.'}
                  </p>
                )}
                <p className="mt-4 text-xs text-slate-500">Sans compte · effacée après 24 h · rien n’en sort</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Une page de l'espace directeur, capturée dans la démo (établissement fictif, 1440 × 900, sans le
 * bandeau « Démo ») — demande du porteur, 2026-11-02 : « un écran de chaque page en session
 * directeur ». Mêmes pages, même ordre de lecture que la barre latérale de l'application.
 */
const PAGES_DIRECTEUR = [
  {
    image: 'accueil',
    titre: 'Le tableau de bord de la direction',
    texte: 'Taux d’avancement, charge des formateurs, absences et retards, groupes en retard : l’état de l’établissement en un coup d’œil.',
  },
  {
    image: 'emploi',
    titre: 'Conçu pour construire la semaine',
    texte: 'Groupes, formateurs, salles, présentiel ou à distance : la direction construit la semaine et la publie. Chacun la reçoit aussitôt, avec une notification.',
  },
  {
    image: 'edition',
    titre: 'Retoucher sans tout refaire',
    texte: 'Par formateur, par groupe ou par salle : chaque séance se corrige dans la grille, et la semaine se télécharge prête à afficher.',
  },
  {
    image: 'avancement',
    titre: 'L’avancement de chaque module',
    texte: 'Heures affectées et heures réalisées, module par module et groupe par groupe : le retard se voit avant de devenir un problème.',
  },
  {
    image: 'absences',
    titre: 'L’appel et les absences',
    texte: 'Les formateurs font l’appel depuis leur séance ; la direction suit les appels non validés, le registre et les notes de discipline.',
  },
  {
    image: 'documents',
    titre: 'Les documents prêts à imprimer',
    texte: 'Examens, absences, diplômes, administration, discipline : les documents se remplissent à partir de la liste de vos stagiaires.',
  },
  {
    image: 'messagerie',
    titre: 'Une messagerie interne',
    texte: 'Écrire aux formateurs et lire leurs réponses, sans quitter l’application ni échanger d’adresses.',
  },
  {
    image: 'annonces',
    titre: 'Des annonces qui se voient',
    texte: 'Une information, importante ou urgente : elle s’affiche dans le bandeau des formateurs et arrive dans leur messagerie.',
  },
];

/**
 * Le téléphone de la rangée « mobile », à la manière de Codex (demande du porteur, 2026-11-02) :
 * grand, contour clair et épais, îlot noir et barre d'état, COUPÉ PAR LE BAS DU PANNEAU — on n'en
 * voit que le haut, comme s'il sortait du cadre. L'écran : « Mon emploi » de la formatrice de
 * la démo (données fictives), réduit à sa barre et à la séance EN COURS — capturé à 390 px de
 * large et à densité ×3, net sur tous les écrans.
 */
function TelephoneCodex({ src, alt }) {
  return (
    // Le cadre est TRANSLUCIDE (verre dépoli) : le ciel du panneau passe à travers, comme chez Codex.
    <div className="-mb-44 mx-auto w-full max-w-[460px] rounded-[4rem] bg-white/25 p-4 shadow-[0_40px_90px_-30px_rgba(11,31,58,0.55)] ring-1 ring-inset ring-white/70 backdrop-blur-xl sm:-mb-56">
      <div className="overflow-hidden rounded-[3rem] bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.6)]">
        <div aria-hidden="true" className="relative flex h-[54px] items-center justify-between px-8 text-[16px] font-semibold text-slate-900">
          <span>9:41</span>
          <span className="absolute left-1/2 top-3 h-[30px] w-[108px] -translate-x-1/2 rounded-full bg-black" />
          <span className="flex items-center gap-1.5">
            <Signal className="size-4" strokeWidth={2.75} />
            <Wifi className="size-4" strokeWidth={2.75} />
            <BatteryFull className="size-5" strokeWidth={2} />
          </span>
        </div>
        <img src={src} alt={alt} width={390} height={489} className="block h-auto w-full" loading="lazy" />
      </div>
    </div>
  );
}

/** Une capture d'écran d'ordinateur, posée comme une fenêtre sur le ciel de la rangée. */
function Capture({ src, alt }) {
  return (
    <div className="overflow-hidden rounded-lg bg-white shadow-2xl shadow-[#0b1f3a]/20 ring-1 ring-black/10">
      <img src={src} alt={alt} width={1440} height={900} className="block h-auto w-full" loading="lazy" />
    </div>
  );
}

/** Une rangée : texte étroit d'un côté, grand visuel sur dégradé de l'autre (en alternance). */
function Rangee({ titre, texte, inverse = false, children }) {
  return (
    <div className={`grid items-center gap-8 md:gap-16 ${inverse ? 'md:grid-cols-[1fr_320px]' : 'md:grid-cols-[320px_1fr]'}`}>
      <div className={inverse ? 'md:order-2' : ''}>
        <h3 className="text-[28px] font-medium leading-tight tracking-[-0.02em] text-slate-900">{titre}</h3>
        <p className="mt-5 text-[17px] leading-7 text-slate-600">{texte}</p>
      </div>
      <div className="relative overflow-hidden rounded-xl bg-[#f4f7fb] px-6 py-10 sm:px-12 sm:py-14">
        <CielFige />
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

const ROLES_DEMO = [
  {
    role: 'directeur',
    Icone: School,
    titre: 'Direction',
    bouton: 'Essayer comme directeur',
    texte: 'Construisez et publiez les emplois du temps, répartissez les modules, suivez l’avancement et les heures de toute l’équipe.',
  },
  {
    role: 'formateur',
    Icone: Users,
    titre: 'Formateur',
    bouton: 'Essayer comme formateur',
    texte: 'Votre emploi du temps de la semaine, vos affectations, l’avancement de vos modules et vos documents prêts à imprimer.',
  },
  {
    role: 'stagiaire',
    Icone: GraduationCap,
    titre: 'Stagiaire',
    bouton: 'Essayer comme stagiaire',
    texte: 'L’emploi du temps de votre groupe, vos absences, les annonces et les messages de l’établissement.',
  },
];

/*
 * ═══ « PARTOUT », À LA MANIÈRE DE CODEX (2026-11-02, demande du porteur) ═══ Chaque carte : un
 * grand visuel sur le ciel de la page — un extrait d'interface, pas une icône —, le titre, puis
 * un bouton pleine largeur. Les visuels réutilisent les captures de la démo (données fictives).
 */
function VisuelWeb() {
  // Comme Codex : la fenêtre déborde à droite et en bas — on n'en voit qu'un coin, en grand.
  return (
    <div className="absolute -bottom-16 -right-40 left-7 top-7 overflow-hidden rounded-tl-lg bg-white shadow-xl ring-1 ring-black/10">
      <img src="/accueil/directeur/emploi.webp" alt="" className="block w-[820px] max-w-none" loading="lazy" />
    </div>
  );
}

function VisuelWindows() {
  return (
    <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 space-y-2.5">
      <div className="rounded-lg bg-white/90 p-3 shadow-xl ring-1 ring-black/10 backdrop-blur">
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <img src="/accueil/marque.png" alt="" className="size-4" /> eDTpro · maintenant
          <Bell className="ml-auto size-3.5" />
        </div>
        <p className="mt-2 text-[13px] font-semibold text-slate-900">Emploi du temps publié</p>
        <p className="text-[12px] text-slate-600">Semaine S9 — 48 séances, à jour pour toute l’équipe.</p>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-2.5 text-[12px] text-slate-700 shadow-lg ring-1 ring-black/5 backdrop-blur">
        Démarrer avec Windows
        <span className="flex h-4 w-7 items-center rounded-full bg-[#0071DB] px-0.5">
          <span className="ml-auto size-3 rounded-full bg-white" />
        </span>
      </div>
    </div>
  );
}

function VisuelAndroid() {
  return (
    <div className="absolute inset-x-8 -bottom-2 top-6 rounded-t-[1.6rem] bg-white/30 p-2 pb-0 ring-1 ring-inset ring-white/70 backdrop-blur-xl">
      <div className="h-full overflow-hidden rounded-t-[1.15rem] bg-white">
        <img src="/accueil/mobile-emploi.webp" alt="" className="block w-full" loading="lazy" />
      </div>
    </div>
  );
}

function VisuelStagiaire() {
  // L'écran de connexion sur téléphone, réduit à ses deux boutons — DESSINÉS ici avec les
  // composants de l'application (nets à toute taille), pas une capture. Décoratif : inerte.
  return (
    <div aria-hidden="true" className="absolute inset-x-8 -bottom-2 top-6 rounded-t-[1.6rem] bg-white/30 p-2 pb-0 ring-1 ring-inset ring-white/70 backdrop-blur-xl">
      <div className="pointer-events-none flex h-full flex-col justify-center gap-3 rounded-t-[1.15rem] bg-white px-5">
        <p className="text-right text-[12px] text-slate-500">Mot de passe oublié ?</p>
        <Button tabIndex={-1} className="h-10 w-full text-[14px]">Se connecter</Button>
        <div className="flex items-center gap-3 text-[12px] text-slate-500">
          <span className="h-px flex-1 bg-slate-200" />
          ou
          <span className="h-px flex-1 bg-slate-200" />
        </div>
        <Button tabIndex={-1} variant="outline" className="h-10 w-full text-[14px]">
          <QrCode /> Scanner ma carte
        </Button>
      </div>
    </div>
  );
}

const PARTOUT = [
  { Visuel: VisuelWeb, titre: 'Sur le web', lien: '/connexion', action: 'Ouvrir eDTpro' },
  { Visuel: VisuelWindows, titre: 'Sur Windows', lien: URL_INSTALLEUR_BUREAU, action: 'Télécharger pour Windows', telecharger: true },
  { Visuel: VisuelAndroid, titre: 'Sur Android', lien: null, action: 'Bientôt sur Google Play' },
  { Visuel: VisuelStagiaire, titre: 'Pour les stagiaires', lien: '/connexion', action: 'Se connecter' },
];

const QUESTIONS = [
  {
    q: 'La démo est-elle vraiment l’application ?',
    r: 'Oui. « Essayer comme… » vous ouvre une copie d’un établissement fictif : vous utilisez eDTpro exactement comme un compte connecté — construire, publier, modifier, écrire. Votre copie est effacée après 24 heures et rien n’en sort : aucun e-mail, aucune notification.',
  },
  {
    q: 'À qui s’adresse eDTpro ?',
    r: 'Aux établissements de formation professionnelle : la direction et les gestionnaires préparent les emplois du temps, les formateurs et les stagiaires les consultent.',
  },
  {
    q: 'Comment inscrire mon établissement ?',
    r: 'Le directeur crée son compte depuis « Inscrire mon établissement ». Une fois la demande validée, il configure son établissement : formateurs, groupes, calendrier et salles.',
  },
  {
    q: 'Les formateurs et les stagiaires doivent-ils s’inscrire ?',
    r: 'Non. Leurs accès sont fournis par leur établissement ; les stagiaires peuvent aussi se connecter en scannant le QR code de leur carte.',
  },
  {
    q: 'Chaque établissement a-t-il son propre espace ?',
    r: 'Oui : chaque établissement travaille dans son propre espace, avec ses comptes, ses groupes et ses emplois du temps.',
  },
];

export default function PageAccueil() {
  const tauri = estApplicationTauri();
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false, enabled: !tauri });
  const [defile, setDefile] = useState(false);
  const sectionVue = useSectionVue();
  useEffect(() => {
    const suivre = () => setDefile(window.scrollY > 8);
    suivre();
    window.addEventListener('scroll', suivre, { passive: true });
    return () => window.removeEventListener('scroll', suivre);
  }, []);

  // « Essayer… » : un bac à sable, puis l'application — dans la fenêtre de l'accueil sur grand
  // écran (la session est mise en cache : la fenêtre l'ouvre), en plein écran sur téléphone.
  const queryClient = useQueryClient();
  const defilerVersLaFenetre = () =>
    document.getElementById('demo-en-direct')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const demo = useMutation({
    mutationFn: essayerDemo,
    onSuccess: (reponse) => {
      if (window.matchMedia('(min-width: 768px)').matches) {
        queryClient.setQueryData(['session'], reponse);
      } else {
        window.location.assign(pageDemo(reponse.utilisateur));
      }
    },
  });
  const utilisateur = session.data?.utilisateur;

  if (tauri) return <Navigate to="/connexion" replace />;
  // ⚠️ Un compte de DÉMO reste sur l'accueil : sa session s'affiche dans la fenêtre.
  if (utilisateur && !utilisateur.demo) return <Navigate to={routeApresConnexion(utilisateur)} replace />;

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased [color-scheme:light]">
      {/* ── Barre du haut : transparente sur l'accroche, blanche ensuite ─────────── */}
      <header className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${defile ? 'bg-white/90 shadow-[0_1px_0_rgba(15,23,42,0.08)] backdrop-blur' : ''}`}>
        <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-10 px-5 sm:px-8">
          <Link to="/" className="shrink-0"><img src="/logo_edtpro.png" alt="eDTpro" className="h-8 w-auto" /></Link>
          <nav aria-label="Sections de la page" className="hidden items-center gap-1 lg:flex">
            {MENU.map(([id, libelle]) => (
              <a
                key={id}
                href={`#${id}`}
                aria-current={sectionVue === id ? 'location' : undefined}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  defile
                    ? `hover:bg-slate-900/[0.06] hover:text-slate-900 ${
                        sectionVue === id ? 'bg-slate-900/[0.06] text-slate-900' : 'text-slate-600'
                      }`
                    : `hover:bg-white/15 hover:text-white ${
                        sectionVue === id ? 'bg-white/15 text-white' : 'text-white'
                      }`
                }`}
              >
                {libelle}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {/* Sur le ciel, blanc translucide ; sur la barre devenue blanche, le gris du bouton secondaire. */}
            <Button asChild variant="secondary" className={`${PILULE} h-9 ${defile ? '' : 'bg-white/70 backdrop-blur hover:bg-white'}`}>
              <Link to="/connexion">Se connecter</Link>
            </Button>
            <Button asChild className={`${PILULE} hidden h-9 sm:inline-flex`}>
              <a href="#demo-en-direct">Essayer la démo <ArrowUpRight /></a>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Accroche ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <Ciel />
        {/* Le ciel se fond dans le blanc de la page, sous la fenêtre d'application. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-b from-transparent to-white" />
        {/* ⚠️ TOUT DANS LE PREMIER ÉCRAN (demande du porteur) : icône, titre, texte ET boutons, sans défiler. */}
        <div className="relative mx-auto max-w-[1100px] px-5 pb-10 pt-24 text-center sm:pt-28 lg:pt-32">
          <div className="mx-auto inline-flex size-[72px] items-center justify-center rounded-[20px] bg-white shadow-[0_20px_50px_-12px_rgba(11,31,58,0.35)] ring-1 ring-black/5">
            <img src="/accueil/marque.png" alt="" className="size-[58px]" />
          </div>
          <h1 className="mx-auto mt-9 max-w-5xl text-[34px] font-medium leading-[1.05] tracking-[-0.03em] text-slate-950 sm:text-[46px] lg:text-[54px]">
            Organisez tout avec <Marque />
          </h1>
          <p className="mx-auto mt-5 max-w-[520px] text-[17px] leading-7 text-slate-800">
            Les emplois du temps, l’avancement des modules, les documents et la messagerie de votre établissement, réunis.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <Button asChild className={PILULE}>
              <a href={URL_INSTALLEUR_BUREAU} download><MonitorDown /> Télécharger pour Windows</a>
            </Button>
            <Button asChild variant="secondary" className={`${PILULE} bg-white/70 backdrop-blur hover:bg-white`}>
              <a href="#demo-en-direct">Essayer la démo</a>
            </Button>
          </div>
          <p className="mt-20 text-[17px] text-slate-800">Pensé pour les établissements de formation professionnelle</p>
          <RangeeFonctions />
        </div>

        {/* La fenêtre : l'application elle-même, à cheval sur la fin du ciel */}
        <div id="demo-en-direct" className="relative mx-auto max-w-[1180px] scroll-mt-24 px-5 pb-28 pt-14 sm:px-8">
          <FenetreDemo demo={demo} sessionDemo={utilisateur?.demo ? utilisateur : null} />
        </div>
      </section>

      {/* ── Démarrer : la démo, par rôle ─────────────────────────────────────── */}
      <section id="demarrer" className="scroll-mt-20 bg-white px-5 py-28 sm:px-8">
        <div className="mx-auto max-w-[1100px]">
          <h2 className="text-center text-[42px] font-medium tracking-[-0.03em]">Démarrer</h2>
          <p className="mt-5 text-center text-[17px] text-slate-700">
            Essayez <Marque /> comme si vous étiez connecté, sans créer de compte.
          </p>
          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {ROLES_DEMO.map(({ role, Icone, titre, bouton, texte }) => {
              const enCours = demo.isPending && demo.variables === role;
              return (
                <Card key={role} className="flex flex-col bg-white text-slate-900 shadow-none">
                  <CardHeader className="space-y-0 p-7 pb-0">
                    <span className="inline-flex size-11 items-center justify-center rounded-lg bg-[#0071DB]/10 text-[#0071DB]">
                      <Icone className="size-5" />
                    </span>
                    <CardTitle className="pt-6 text-[28px] font-medium tracking-[-0.02em]">{titre}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 p-7 pt-3">
                    <CardDescription className="text-[17px] leading-7 text-slate-600">{texte}</CardDescription>
                  </CardContent>
                  <CardFooter className="p-7 pt-3">
                    <Button className={`${PILULE} w-full`} disabled={demo.isPending} onClick={() => demo.mutate(role, { onSuccess: defilerVersLaFenetre })}>
                      {enCours ? <><LoaderCircle className="animate-spin" /> Préparation de la démo…</> : <>{bouton} <ArrowUpRight /></>}
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
          {demo.isError && (
            <p role="alert" className="mt-6 text-center text-sm font-medium text-red-600">
              {demo.error?.message || 'La démo n’a pas pu démarrer. Réessayez dans un instant.'}
            </p>
          )}
          <p className="mt-6 text-center text-sm text-slate-500">
            Données fictives · votre copie est effacée après 24 h · aucun e-mail ni notification n’en sort.
          </p>
        </div>
      </section>

      {/* ── Fonctionnalités : rangées texte + visuel ─────────────────────────── */}
      <section id="fonctionnalites" className="scroll-mt-20 px-5 py-28 sm:px-8">
        <div className="mx-auto max-w-[1320px]">
          <h2 className="mx-auto max-w-3xl text-center text-[42px] font-medium leading-[1.1] tracking-[-0.03em]">
            La façon la plus simple de tenir l’emploi du temps
          </h2>
          <div className="mt-24 space-y-28">
            {PAGES_DIRECTEUR.map(({ image, titre, texte }, i) => (
              <Rangee key={image} inverse={i % 2 === 1} titre={titre} texte={texte}>
                <Capture src={`/accueil/directeur/${image}.webp`} alt={titre} />
              </Rangee>
            ))}
            {/* Un seul écran de téléphone (demande du porteur, 2026-11-02). */}
            <Rangee
              inverse={PAGES_DIRECTEUR.length % 2 === 1}
              titre="Dans la poche de toute l’équipe"
              texte="Formateurs et stagiaires retrouvent leur semaine sur téléphone : séances du jour, groupes, modules et salles."
            >
              <TelephoneCodex src="/accueil/mobile-emploi.webp" alt="L’emploi du temps d’un formateur sur téléphone" />
            </Rangee>
          </div>
        </div>
      </section>

      {/* ── Partout ──────────────────────────────────────────────────────────── */}
      <section id="partout" className="scroll-mt-20 px-5 py-28 sm:px-8">
        <div className="mx-auto max-w-[1320px]">
          <h2 className="text-center text-[42px] font-medium tracking-[-0.03em]"><Marque />, partout où vous êtes</h2>
          <p className="mx-auto mt-5 max-w-xl text-center text-[17px] text-slate-700">
            Le même établissement, à jour sur chaque appareil.
          </p>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PARTOUT.map(({ Visuel, titre, lien, action, telecharger }) => (
              <Card key={titre} className="flex flex-col bg-[#f4f7fb] p-3 text-slate-900 shadow-none">
                <div className="relative h-60 overflow-hidden rounded-lg">
                  <CielFige />
                  <Visuel />
                </div>
                <CardTitle className="px-3 pt-6 text-[24px] font-medium tracking-[-0.02em]">{titre}</CardTitle>
                <div className="mt-auto px-3 pb-3 pt-12">
                  {lien ? (
                    <Button asChild variant="outline" className="h-11 w-full bg-white text-[15px]">
                      {telecharger ? (
                        <a href={lien} download><MonitorDown /> {action}</a>
                      ) : (
                        <Link to={lien}>{action} <ArrowUpRight /></Link>
                      )}
                    </Button>
                  ) : (
                    <Button variant="outline" disabled className="h-11 w-full bg-white text-[15px]">{action}</Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── Tarifs ───────────────────────────────────────────────────────────── */}
      <section id="tarifs" className="scroll-mt-20 px-5 py-28 sm:px-8">
        <div className="mx-auto max-w-[1180px]">
          <h2 className="text-center text-[42px] font-medium tracking-[-0.03em]">Tarifs</h2>
          <p className="mt-4 text-center text-[17px] text-slate-600">Un mois pour essayer, puis l’abonnement qui vous convient.</p>
          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {TARIFS.map(({ nom, prix, periode, texte, points, bouton, misEnAvant }) => (
              <Card key={nom} className={`flex flex-col bg-white text-slate-900 shadow-none ${misEnAvant ? 'border-[#0071DB] ring-1 ring-[#0071DB]' : ''}`}>
                <CardHeader className="space-y-0 p-7 pb-0">
                  <CardTitle className="text-[21px] font-medium">{nom}</CardTitle>
                  <p className="pt-5">
                    <span className="text-[44px] font-medium tracking-[-0.03em]">{prix}</span>
                    <span className="ml-2 text-[15px] text-slate-500">{periode}</span>
                  </p>
                  <CardDescription className="pt-3 text-[15px] leading-6 text-slate-600">{texte}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 p-7 pt-6">
                  <ul className="space-y-3 text-[15px]">
                    {points.map((point) => (
                      <li key={point} className="flex items-center gap-2.5">
                        <Check className="size-4 shrink-0 text-[#489C5A]" /> {point}
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter className="p-7 pt-0">
                  <Button asChild variant={misEnAvant ? 'default' : 'secondary'} className={`${PILULE} w-full`}>
                    <Link to="/inscription">{bouton}</Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── Questions ────────────────────────────────────────────────────────── */}
      <section id="questions" className="scroll-mt-20 px-5 py-28 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-[42px] font-medium tracking-[-0.03em]">Questions fréquentes</h2>
          <div className="mt-12 divide-y divide-slate-200 border-y border-slate-200">
            {QUESTIONS.map(({ q, r }) => (
              <Collapsible key={q} className="group py-6">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 text-left text-[19px] font-medium">
                  {q}
                  <ChevronDown className="size-5 shrink-0 text-slate-400 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="mt-3 text-[17px] leading-7 text-slate-600">{r}</p>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bandeau final ────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-5 py-40 text-center">
        <Ciel />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white to-transparent" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white to-transparent" />
        <div className="relative">
          <h2 className="text-[40px] font-medium leading-tight tracking-[-0.03em] text-slate-950 sm:text-[56px]">Commencez avec <Marque /></h2>
          <p className="mt-5 text-[17px] text-slate-800">Sur le web, sur Windows, et bientôt sur Android.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline" className={`${PILULE} border-0 bg-white hover:bg-white/90`}>
              <a href={URL_INSTALLEUR_BUREAU} download><MonitorDown /> Télécharger pour Windows</a>
            </Button>
            <Button asChild className={PILULE}>
              <a href="#demo-en-direct">Essayer la démo</a>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Pied ─────────────────────────────────────────────────────────────── */}
      <footer className="bg-white px-5 pb-10 pt-20 sm:px-8">
        <div className="mx-auto grid max-w-[1320px] gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Produit', [['Démo', '#demarrer'], ['Fonctionnalités', '#fonctionnalites'], ['Tarifs', '#tarifs'], ['Télécharger pour Windows', URL_INSTALLEUR_BUREAU]]],
            ['Établissements', [['Inscrire mon établissement', '/inscription'], ['Se connecter', '/connexion']]],
            ['Assistance', [['Questions fréquentes', '#questions'], ['Nous écrire', `mailto:${CONTACT}`]]],
            ['Applications', [['Windows', URL_INSTALLEUR_BUREAU], ['Android (bientôt)', '#partout']]],
          ].map(([titre, liens]) => (
            <div key={titre}>
              <p className="text-[15px] text-slate-400">{titre}</p>
              <ul className="mt-4 space-y-3">
                {liens.map(([texte, lien]) => (
                  <li key={texte}>
                    {lien.startsWith('/') ? (
                      <Link to={lien} className="text-[15px] font-medium text-slate-900 hover:text-[#0071DB]">{texte}</Link>
                    ) : (
                      <a href={lien} className="text-[15px] font-medium text-slate-900 hover:text-[#0071DB]">{texte}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {/* Le logo, la mention au centre, l'adresse (demande du porteur). */}
        <div className="mx-auto mt-20 grid max-w-[1320px] items-center gap-4 border-t border-slate-200 pt-8 text-sm text-slate-600 sm:grid-cols-3">
          <img src="/logo_edtpro.png" alt="eDTpro" className="mx-auto h-8 w-auto sm:mx-0" />
          <p className="text-center">© {new Date().getFullYear()} <Marque />. Tous droits réservés.</p>
          <a href={`mailto:${CONTACT}`} className="mx-auto inline-flex items-center gap-2 font-medium text-[#0071DB] hover:underline sm:mx-0 sm:justify-self-end">
            <Mail className="size-4" /> {CONTACT}
          </a>
        </div>
      </footer>
    </div>
  );
}
