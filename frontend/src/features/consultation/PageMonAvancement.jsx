import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Table as TableIcon } from 'lucide-react';
import { ROLES } from 'shared/constants';
import {
  agregerAvancement,
  dimensionComplement,
  referenceDeLAxe,
  totalAvancement,
} from 'shared/domain';
import { MARGE_PAGE } from '@/components/common/apparenceGrille';
import CadreReglage from '@/features/parametres/CadreReglage';
import Alerte from '@/components/common/Alerte';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
/* ⚠️ RENOMMÉE À L'IMPORT : cette page porte DÉJÀ une `Legende`, celle de la
   barre segmentée juste au-dessus. Les deux nomment des couleurs, mais pas les
   mêmes — présentiel/distanciel d'un côté, affecté/réalisé de l'autre. */
import GrapheAvancement, { Legende as LegendeGraphe } from '@/features/avancement/GrapheAvancement';
import TableauAvancement from '@/features/avancement/TableauAvancement';
import { recupererSession } from '@/features/auth/api';
import { nombre } from '@/lib/nombres';
import { chargerAvancementConsultation } from './api';
import { partsAvancement } from './barreAvancement';

/**
 * ⚠️ LES DEUX VUES SONT DÉCLARÉES COMME CHEZ LE DIRECTEUR — mêmes clés, mêmes
 * libellés, mêmes icônes. Un même geste ne peut pas s'appeler autrement d'un
 * écran à l'autre du même produit.
 */
const VUES = [
  { cle: 'graphique', libelle: 'Graphique', Icone: BarChart3 },
  { cle: 'tableau', libelle: 'Tableau', Icone: TableIcon },
];

/**
 * « Mon avancement » — sessions consultatives formateur & stagiaire (F14).
 * ← `avancementFormateur.html`, `avancementStagiaire.html`
 *
 * ═══ ⚠️ RÉUTILISE `agregerAvancement` ET `TableauAvancement` TELS QUELS ═══
 * Le serveur rend déjà les lignes réduites à cette personne (ou ce groupe) —
 * `consultation.service.js` filtre AVANT d'envoyer. L'agrégation par module
 * est la MÊME fonction PURE que la page « Avancement » du directeur : deux
 * calculs auraient divergé au premier ajustement (§4.2 du plan).
 *
 * ⚠️ NI FILTRE NI BASCULE D'AXE ICI. Les données arrivent déjà scopées à une
 * seule personne ou un seul groupe — proposer un panneau de filtres pour n'en
 * retenir qu'une donnerait un écran qui fait semblant d'avoir le choix. La
 * bascule Graphique/Tableau, elle, ne change QUE la forme de l'affichage : elle
 * est donc reprise telle quelle, avec le même composant de graphe.
 */
export default function PageMonAvancement() {
  const requete = useQuery({
    queryKey: ['consultation', 'avancement'],
    queryFn: () => chargerAvancementConsultation(),
    retry: false,
  });

  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const estStagiaire = session.data?.utilisateur?.role === ROLES.STAGIAIRE;

  /*
   * ═══ ⚠️ LA DIMENSION FIGÉE N'EST PAS UN FILTRE, ICI : C'EST LE RÔLE ═══
   * Chez le directeur, `dimensionComplement` descend jusqu'à la première
   * dimension que le PANNEAU DE FILTRES ne fixe pas déjà. Ici il n'y a pas de
   * panneau — c'est la SESSION qui fixe : toutes les lignes d'un formateur sont
   * les siennes, toutes celles d'un stagiaire sont celles de son groupe. Écrire
   * le nom du formateur sur ses dix-sept bâtons répéterait son propre nom d'un
   * bout à l'autre du graphe, exactement le défaut corrigé le 2026-09-02. On
   * passe donc au domaine un filtre SYNTHÉTIQUE qui dit ce que la session fixe,
   * plutôt que de choisir la dimension à la main : la règle reste dans le
   * domaine, à un seul endroit.
   */
  const complement = useMemo(
    () => dimensionComplement('module', estStagiaire ? {} : { formateur: ['moi'] }),
    [estStagiaire]
  );

  /*
   * ═══ LES DEUX FACES, COMME CHEZ LE DIRECTEUR ═══ (2026-09-12, demande du
   * porteur : « afficher l'avancement de eDTpro et e-note, les deux modes ».)
   * « eDTpro » compte les séances réellement tenues dans la grille, « E-note »
   * ce que l'établissement a déclaré dans le système national. Le serveur rendait
   * DÉJÀ les deux, filtrées à la personne — seule la bascule manquait.
   *
   * ⚠️ eDTpro RESTE LA FACE PAR DÉFAUT : c'est celle que la personne fait avancer
   * elle-même, séance après séance ; e-note dépend d'un import qu'elle ne
   * maîtrise pas et qui peut dater de plusieurs jours.
   */
  const [face, setFace] = useState('edtpro');
  const source = requete.data?.source ?? null;
  const termineesAu = requete.data?.seancesTermineesAu ?? null;

  const lignes = requete.data?.faces?.[face] ?? [];

  const parModule = useMemo(() => agregerAvancement(lignes, 'module', complement), [lignes, complement]);
  const total = useMemo(() => totalAvancement(lignes), [lignes]);

  /*
   * ⚠️ LA RÉFÉRENCE EST DEMANDÉE AU DOMAINE, PAS ÉCRITE `null` : l'axe module
   * n'en porte aucune aujourd'hui (`referenceDeLAxe` le dit), mais la coder en
   * dur ferait manquer en silence celle qu'on lui ajouterait un jour.
   */
  const reference = useMemo(
    () => referenceDeLAxe('module', { statutaires: requete.data?.statutaires ?? {}, lignes }),
    [requete.data?.statutaires, lignes]
  );

  /*
   * ═══ ⚠️ LE TABLEAU EST LA VUE PAR DÉFAUT ICI — DIVERGENCE ASSUMÉE AVEC LA
   * PAGE DU DIRECTEUR ═══ (décision du porteur, 2026-09-06.) Là-bas le graphe
   * s'ouvre en premier parce que rien d'autre ne dit où l'on en est ; ici, la
   * BARRE SEGMENTÉE juste au-dessus porte déjà le taux global et sa ventilation
   * — ouvrir sur le graphe redirait la même chose une seconde fois, en repoussant
   * hors de vue les chiffres module par module qu'on vient réellement lire. Le
   * graphe reste à un clic.
   */
  const [vue, setVue] = useState('tableau');

  return (
    <CadreReglage
      titre="Mon avancement"
      chargement={requete.isLoading}
      erreur={requete.isError ? requete.error.message : null}
    >
      {!requete.isLoading && (
        <EnTeteFace
          face={face}
          onFace={setFace}
          source={source}
          termineesAu={termineesAu}
        />
      )}

      {!requete.isLoading && face === 'enote' && !source ? (
        /* ⚠️ PAS DE BOUTON D'IMPORT ICI, contrairement à la page du directeur :
           l'export e-note se dépose par l'établissement, et un formateur ou un
           stagiaire ne peut rien y faire. On dit à qui s'adresser. */
        <Alerte type="avertissement" titre="Aucun fichier e-note importé pour cette année">
          Cette face lit les heures déclarées dans le système national. Elle se
          remplira dès que la direction de l’établissement aura importé son export e-note.
        </Alerte>
      ) : !requete.isLoading && lignes.length === 0 ? (
        <Alerte type="info" titre="Rien à afficher">
          {face === 'enote'
            ? `L’export e-note ne porte aucune ligne ${estStagiaire ? 'pour votre groupe' : 'à votre nom'}.`
            : 'Aucun module ne vous est rattaché pour le moment.'}
        </Alerte>
      ) : (
        !requete.isLoading && (
          <>
            <BarreAvancement total={total} />

            {/*
              ⚠️ LA LÉGENDE À GAUCHE, LA BASCULE À DROITE — la disposition de la
              page du directeur, réduite à une seule rangée puisqu'il n'y a ici
              ni filtre ni chronologie. Ce qui EXPLIQUE ce qu'on voit d'un côté,
              ce qui CHOISIT sa forme de l'autre.
            */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {/* ⚠️ ELLE N'A DE SENS QU'AVEC LE GRAPHE : le tableau nomme ses
                  colonnes lui-même. */}
              {vue === 'graphique' && (
                <LegendeGraphe
                  reference={reference?.libelle ?? null}
                  mention={face === 'edtpro' ? 'des séances terminées' : 'déclaré dans e-note'}
                />
              )}

              <div className="ml-auto">
                <ButtonGroup>
                  {VUES.map(({ cle, libelle, Icone }) => (
                    <Button
                      key={cle}
                      variant={vue === cle ? 'default' : 'outline'}
                      size="sm"
                      aria-pressed={vue === cle}
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => setVue(cle)}
                    >
                      <Icone className="size-3.5" />
                      {libelle}
                    </Button>
                  ))}
                </ButtonGroup>
              </div>
            </div>

            {vue === 'graphique' ? (
              <GrapheAvancement
                lignes={parModule}
                entete="Module"
                axe="module"
                complement={complement}
                intitules={requete.data?.intitules ?? {}}
                reference={reference}
              />
            ) : (
              <TableauAvancement
                lignes={parModule}
                entete="Module"
                axe="module"
                detaille
                /*
                  ⚠️ L'EN-TÊTE COLLE AU CONTENEUR DE LA COQUILLE, pas à la
                  fenêtre : en session, c'est le `div p-6` qui défile, pas la
                  page. On remonte donc de sa marge intérieure — Chrome accroche
                  l'élément au bord du CONTENU, et sans ce décalage l'en-tête
                  s'immobiliserait 24 px trop bas.

                  ⚠️ ET `cartesSous` PASSE À `xl` : ce tableau réclame ~983 px
                  pour ses neuf colonnes, or le collant interdit le défilement
                  interne. En dessous, la table déborderait la page — les cartes
                  prennent le relais.
                */
                collant={`-${MARGE_PAGE}px`}
                cartesSous="xl"
                /*
                  ⚠️ LA COLONNE SUIT LE COMPLÉMENT, elle n'est pas décidée à
                  part : quand celui-ci vaut « groupes » — le cas du formateur —
                  `agregerAvancement` VENTILE déjà le module par groupe, et la
                  colonne « Module » nomme cette ventilation. Une colonne de plus
                  y répéterait ce qui est écrit juste à gauche. Dériver la
                  colonne du complément plutôt que du rôle évite qu'elles
                  divergent le jour où la règle du complément change.
                */
                colonneComplement={complement === 'formateurs' ? 'Formateur' : null}
                intitules={requete.data?.intitules ?? {}}
              />
            )}
          </>
        )
      )}
    </CadreReglage>
  );
}

/**
 * La bascule eDTpro / E-note, et d'où vient ce qu'on lit.
 *
 * ⚠️ LA MÊME BASCULE QUE LA PAGE DU DIRECTEUR — un interrupteur légendé des DEUX
 * côtés, le libellé actif en pleine encre : légendé d'un seul côté, il ne dit
 * pas ce qu'on quitte. Un même geste ne s'apprend pas deux fois.
 *
 * ⚠️ CHAQUE FACE DIT D'OÙ ELLE VIENT : sans cela, « 12 h réalisées » ne se
 * rapporte à aucun moment. eDTpro compte les séances TERMINÉES à l'instant du
 * chargement — et l'écrit ; e-note, le fichier importé et sa date.
 */
function EnTeteFace({ face, onFace, source, termineesAu }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="text-xs text-muted-foreground">
        {face === 'edtpro' ? (
          termineesAu ? (
            <>
              D’après les séances <span className="font-medium text-foreground">terminées</span> au{' '}
              {jourLisible(termineesAu.date)} à {termineesAu.heure.replace(':', 'h')}.
            </>
          ) : (
            'D’après les séances terminées.'
          )
        ) : source ? (
          <>
            D’après <span className="font-medium text-foreground">{source.fichier}</span>, importé le{' '}
            {new Date(source.importeLe).toLocaleDateString('fr-FR', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}
            .
          </>
        ) : null}
      </p>

      <Label className="ml-auto flex cursor-pointer items-center gap-2 text-xs font-normal">
        <span className={face === 'edtpro' ? 'font-medium text-foreground' : 'text-muted-foreground'}>
          eDTpro
        </span>
        <Switch
          checked={face === 'enote'}
          onCheckedChange={(coche) => onFace(coche ? 'enote' : 'edtpro')}
          aria-label="Basculer entre l’avancement eDTpro et l’avancement déclaré dans e-note"
        />
        <span className={face === 'enote' ? 'font-medium text-foreground' : 'text-muted-foreground'}>
          E-note
        </span>
      </Label>
    </div>
  );
}

/** « 2026-09-12 » → « 12 septembre ». ⚠️ À MIDI : à minuit, un décalage de
 *  fuseau ramènerait la veille. */
function jourLisible(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

/**
 * Le taux d'avancement, en BARRE HORIZONTALE — une seule barre, partagée entre
 * le présentiel et le distanciel. (2026-09-05, demande du porteur : « une seule
 * barre contient le taux d'avancement avec mentionné présentiel et synchrone ».)
 *
 * ═══ ⚠️ UNE BARRE SEGMENTÉE, PAS TROIS BARRES ═══ Trois barres — globale,
 * présentiel, distanciel — obligeraient à comparer trois longueurs pour savoir
 * ce qui reste ; une seule, découpée, montre du même coup le taux ATTEINT et CE
 * QUI L'A FAIT. La longueur totale est le taux global, les deux segments disent
 * d'où viennent ses heures.
 *
 * ⚠️ LES SEGMENTS SE MESURENT SUR LE PRÉVU TOTAL, pas chacun sur le sien : deux
 * pourcentages calculés sur des bases différentes ne s'additionnent pas, et
 * leur somme ne ferait plus le taux global affiché juste à côté.
 *
 * ⚠️ EN CSS, PAS EN `recharts` : une barre unique n'a besoin ni d'axes ni
 * d'échelle, et la bibliothèque traîne ici deux pièges déjà payés — ses trames
 * d'animation gelées dans un panneau masqué, et le débordement horizontal
 * constaté sur « Statistiques ». Une piste et deux segments suffisent.
 *
 * ⚠️ LES COULEURS SONT CELLES DU RESTE DE L'APPLICATION : vert-bleu pour le
 * présentiel, violet pour le distanciel — les mêmes que la grille, le
 * chronogramme et la carte d'affectations.
 */
function BarreAvancement({ total }) {
  /*
   * ⚠️⚠️ ELLE PART DU MÊME `total` QUE LE CHIFFRE ÉCRIT JUSTE AU-DESSUS, et
   * c'est tout l'objet du correctif du 2026-09-06 : elle sommait les LIGNES,
   * éclatées par groupe, si bien qu'une séance synchrone mutualisée y comptait
   * deux fois. La légende annonçait « 160 h » là où l'en-tête comptait 920 h au
   * total — 800 + 160 ne faisant même pas 920. Une seule source, plus de
   * divergence possible.
   */
  const {
    realisePresentiel,
    realiseSynchrone,
    prevuPresentiel,
    prevuSynchrone,
    partPresentiel,
    partSynchrone,
  } = partsAvancement(total);

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">{nombre(total.taux)} %</span>
          <span className="text-xs text-muted-foreground">Taux d’avancement</span>
        </div>
        <span className="text-sm tabular-nums text-muted-foreground">
          {nombre(total.realise)} / {nombre(total.prevu)} h · {total.modules} module(s)
        </span>
      </div>

      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Avancement ${nombre(total.taux)} %, dont ${nombre(realisePresentiel)} h en présentiel et ${nombre(realiseSynchrone)} h à distance`}
      >
        <span
          className="h-full bg-accent-teal transition-[width] duration-500"
          style={{ width: `${partPresentiel}%` }}
        />
        <span
          className="h-full bg-accent-purple-mid transition-[width] duration-500"
          style={{ width: `${partSynchrone}%` }}
        />
      </div>

      {/* ⚠️ LA LÉGENDE PORTE LES HEURES, PAS SEULEMENT LA COULEUR : « 40 % » ne
          dit pas s'il reste trois heures ou trois cents, et c'est le reste à
          faire qui décide de la semaine à venir. */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <Legende
          couleur="bg-accent-teal"
          libelle="Présentiel"
          realise={realisePresentiel}
          prevu={prevuPresentiel}
        />
        <Legende
          couleur="bg-accent-purple-mid"
          libelle="Synchrone"
          realise={realiseSynchrone}
          prevu={prevuSynchrone}
        />
      </div>
    </div>
  );
}

function Legende({ couleur, libelle, realise, prevu }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${couleur}`} />
      <span className="text-muted-foreground">{libelle}</span>
      <span className="tabular-nums">
        {nombre(realise)} / {nombre(prevu)} h
      </span>
    </span>
  );
}
