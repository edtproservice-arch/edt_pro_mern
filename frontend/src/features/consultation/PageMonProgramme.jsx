import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Presentation } from 'lucide-react';
import Teams from '@/components/icons/Teams';
import Alerte from '@/components/common/Alerte';
import BadgeRegional from '@/components/common/BadgeRegional';
import BadgeSemestre from '@/components/common/BadgeSemestre';
import { BandeCartes, CarteStat } from '@/components/common/CartesStat';
import TableauTriable from '@/components/common/TableauTriable';
import { MARGE_PAGE } from '@/components/common/apparenceGrille';
import CadreReglage from '@/features/parametres/CadreReglage';
import { nombre } from '@/lib/nombres';
import { chargerProgrammeConsultation } from './api';

/**
 * « Programme » — la table des matières de l'année d'un stagiaire (F14).
 * ← `tableMatieres.html` (1 112 l.), entrée « Programme » du menu stagiaire de
 *   l'existant (2026-09-05, demande du porteur).
 *
 * ═══ ⚠️ CE QUI N'EST PAS REPRIS, ET POURQUOI ═══
 * L'existant ouvrait un TIROIR au clic sur un module — quatre onglets (cours,
 * exercices, TP, résumé) remplis par `search_ofppt.php`, un relais de recherche
 * Google, et par l'API de Wikipédia. Ce relais n'est PAS migré : il appartient
 * à F16 (« Assistant vocal + IA », Phase 6), dont le plan dit que la clé d'API
 * doit passer côté serveur. Le porter ici en aurait fait un second chantier,
 * avec son secret à héberger — la page rend donc ce qu'elle sait rendre
 * aujourd'hui : le programme lui-même.
 */
export default function PageMonProgramme() {
  const requete = useQuery({
    queryKey: ['consultation', 'programme'],
    queryFn: chargerProgrammeConsultation,
    retry: false,
  });

  const modules = requete.data?.modules ?? [];
  const groupes = requete.data?.groupes ?? [];

  /*
   * ⚠️ LA COLONNE « GROUPE » NE PARAÎT QU'À PARTIR DE DEUX. Un stagiaire
   * n'en a qu'un dans la plupart des cas — et une colonne qui répète la même
   * valeur sur toutes les lignes n'apprend rien. Elle compte en revanche pour
   * celui qui suit AUSSI une formation qualifiante : ses deux programmes se
   * lisent alors dans le même tableau, et rien d'autre ne dirait lequel est
   * lequel.
   */
  const avecGroupe = groupes.length > 1;

  const total = useMemo(() => {
    const presentiel = modules.reduce((somme, ligne) => somme + (ligne.presentiel ?? 0), 0);
    const synchrone = modules.reduce((somme, ligne) => somme + (ligne.synchrone ?? 0), 0);
    const global = presentiel + synchrone;

    return {
      presentiel,
      synchrone,
      global,
      // ⚠️ Une part de zéro heure n'est pas « 0 % », c'est une part qui n'existe
      // pas : la division ferait `NaN`, affiché tel quel.
      part: (valeur) => (global > 0 ? Math.round((valeur / global) * 100) : 0),
    };
  }, [modules]);

  return (
    <CadreReglage
      /* ⚠️ PLUS DE `description` (2026-09-05, demande du porteur) : « les
         modules de votre année, avec leur masse horaire et le formateur » ne
         faisait que redire les en-têtes du tableau, une ligne plus bas. */
      titre="Table des matières"
      chargement={requete.isLoading}
      erreur={requete.isError ? requete.error.message : null}
    >
      {modules.length === 0 ? (
        <Alerte type="info" titre="Aucun module">
          Aucun module n’est encore inscrit au programme de votre groupe pour cette année scolaire.
        </Alerte>
      ) : (
        <div className="space-y-4">
          {/* ⚠️ TROIS CARTES, PAS QUATRE : `BandeCartes` en pose quatre par
              rangée par défaut, ce qui laisserait ici une case vide. */}
          <BandeCartes className="sm:grid-cols-3 lg:grid-cols-3">
            <CarteStat
              Icone={Clock}
              libelle="Masse horaire globale"
              valeur={`${nombre(total.global)} h`}
              teinte="text-primary"
              fond="bg-primary/10"
              detail={`${modules.length} module${modules.length > 1 ? 's' : ''}`}
            />
            <CarteStat
              Icone={Presentation}
              libelle="Présentiel"
              valeur={`${nombre(total.presentiel)} h`}
              teinte="text-accent-teal"
              fond="bg-accent-teal/10"
              detail={`${total.part(total.presentiel)} % du total`}
            />
            <CarteStat
              Icone={Teams}
              libelle="Synchrone"
              valeur={`${nombre(total.synchrone)} h`}
              teinte="text-accent-purple-deep"
              fond="bg-accent-purple/20"
              detail={`${total.part(total.synchrone)} % du total`}
            />
          </BandeCartes>

          {/*
            ═══ ⚠️ `TableauTriable`, PAS UN TABLEAU ÉCRIT ICI ═══ (2026-09-05,
            demande du porteur : « je veux que le tableau soit responsive ».)
            Il apporte les deux choses que cette page réclamait — le TRI par
            colonne, utile sur dix-sept modules, et la bascule en CARTES sur
            écran étroit, celle-là même qui vient d'être posée pour les tableaux
            de l'administration. En écrire une seconde version aurait fait
            diverger les deux au premier ajustement.

            ⚠️ `cartesSous="md"`, PAS `xl` : ce tableau vit dans un cadre de
            896 px et ses six colonnes y tiennent largement. Le seuil de
            l'administration (1280 px) l'aurait mis en cartes sur un portable
            qui l'affiche très bien.

            ⚠️ SANS `pleinePage` : celui-ci pose un en-tête COLLANT, qui
            s'accrocherait au conteneur défilant de la coquille et non à la
            page — et `table-fixed`, dont les largeurs sont calibrées pour un
            tableau pleine largeur.
          */}
          <TableauTriable
            cartesSous="md"
            /* En-tête collant : voir le commentaire de « Mon avancement » — on
               remonte de la marge du conteneur défilant de la coquille. */
            collant={`-${MARGE_PAGE}px`}
            vide="Aucun module au programme."
            cleLigne={(ligne) => `${ligne.groupe}-${ligne.module}`}
            lignes={modules}
            colonnes={[
              ...(avecGroupe
                ? [
                    {
                      id: 'groupe',
                      entete: 'Groupe',
                      tri: (ligne) => ligne.groupe,
                      rendu: (ligne) => <span className="font-medium">{ligne.groupe}</span>,
                    },
                  ]
                : []),
              {
                id: 'module',
                entete: 'Module',
                enroule: true,
                tri: (ligne) => ligne.intitule || ligne.module,
                rendu: (ligne) => (
                  <>
                    {/* Le NOM d'abord, le code en dessous : c'est le nom qu'on
                        vient lire, le code sert à le retrouver ailleurs. */}
                    <div className="font-medium">{ligne.intitule || ligne.module}</div>
                    {ligne.intitule && (
                      <div className="text-xs text-muted-foreground">{ligne.module}</div>
                    )}
                  </>
                ),
              },
              {
                id: 'formateur',
                entete: 'Formateur',
                tri: (ligne) => ligne.formateurPresentiel || ligne.formateurSynchrone || '',
                rendu: (ligne) => <Formateurs ligne={ligne} />,
              },
              {
                id: 'masse',
                entete: 'Masse horaire',
                // ⚠️ ON TRIE SUR LE TOTAL, pas sur le texte affiché : « 90 h »
                // passerait avant « 140 h » en ordre alphabétique.
                tri: (ligne) => (ligne.presentiel ?? 0) + (ligne.synchrone ?? 0),
                rendu: (ligne) => (
                  /* ⚠️ UNE LIGNE PAR NATURE D'HEURES, et seulement si elle en
                     porte : « 0 h Synchrone » sur chaque rangée d'un programme
                     presque entièrement présentiel n'apprend rien et double la
                     hauteur du tableau. */
                  <div className="space-y-0.5">
                    {ligne.presentiel > 0 && (
                      <Masse
                        Icone={Presentation}
                        teinte="text-accent-teal"
                        heures={ligne.presentiel}
                        libelle="Présentiel"
                      />
                    )}
                    {ligne.synchrone > 0 && (
                      <Masse
                        Icone={Teams}
                        teinte="text-accent-purple-deep"
                        heures={ligne.synchrone}
                        libelle="Synchrone"
                      />
                    )}
                    {ligne.presentiel === 0 && ligne.synchrone === 0 && (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                ),
              },
              {
                id: 'statut',
                entete: 'Statut',
                tri: (ligne) => (ligne.estRegional ? 0 : 1),
                // ⚠️ LA MÊME PASTILLE QUE LA CARTE D'AFFECTATIONS, extraite dans
                // `BadgeRegional` — « Local » porte le même cadre : deux valeurs
                // de même nature dans une colonne « Statut ».
                rendu: (ligne) => <BadgeRegional estRegional={ligne.estRegional} />,
              },
              {
                id: 'semestre',
                entete: 'Semestre',
                tri: (ligne) => ligne.semestre ?? '',
                rendu: (ligne) => <BadgeSemestre semestre={ligne.semestre} long />,
              },
            ]}
          />
        </div>
      )}
    </CadreReglage>
  );
}

/**
 * Le ou les formateurs d'un module.
 *
 * ⚠️ DEUX NOMS QUAND ILS DIFFÈRENT, un seul sinon. Un module est souvent assuré
 * par la même personne en salle et à distance — l'écrire deux fois ferait
 * croire à deux intervenants. Mais quand ils diffèrent, n'en montrer qu'un
 * attribuerait à l'un les heures de l'autre : c'est le défaut déjà corrigé sur
 * les feuilles de charge du classeur.
 */
function Formateurs({ ligne }) {
  const presentiel = ligne.formateurPresentiel;
  const synchrone = ligne.formateurSynchrone;

  if (!presentiel && !synchrone) {
    return <span className="text-muted-foreground">Non assigné</span>;
  }

  if (!presentiel || !synchrone || presentiel === synchrone) {
    return <span>{presentiel || synchrone}</span>;
  }

  return (
    <div className="space-y-0.5">
      <span className="flex items-center gap-1.5">
        <Presentation className="size-3.5 shrink-0 text-accent-teal" />
        {presentiel}
      </span>
      <span className="flex items-center gap-1.5">
        <Teams className="size-3.5 shrink-0" />
        {synchrone}
      </span>
    </div>
  );
}

function Masse({ Icone, teinte, heures, libelle }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
      <Icone className={`size-3.5 shrink-0 ${teinte}`} />
      <span className="tabular-nums">{nombre(heures)} h</span>
      <span className="text-muted-foreground">{libelle}</span>
    </span>
  );
}
