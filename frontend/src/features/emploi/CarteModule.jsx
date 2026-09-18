import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Presentation, Star } from 'lucide-react';
import { libelleSemaine } from 'shared/domain';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import BadgeAvancement from '@/components/common/BadgeAvancement';
import BadgeSemestre from '@/components/common/BadgeSemestre';
import { couleurChargeTexte } from '@/components/common/apparenceGrille';
import { cn } from '@/lib/utils';
import Teams from '@/components/icons/Teams';
import { chargerFicheModule } from './api';

/**
 * Ce qu'on ne peut pas lire dans une case de 34 px : le NOM du module, et son
 * avancement semaine par semaine.
 * ← le survol des cellules de emploi.html + `moduleCompletion`
 *
 * ═══ ⚠️ AUCUN COMPOSANT RADIX AU REPOS ═══
 * La grille compte 1 224 cases. Monter une `HoverCard` dans chacune, c'est
 * exactement ce qui avait figé la page Affectations — et le piège est déjà
 * documenté pour le `Select` de la case. Au repos, cette enveloppe n'est qu'un
 * `span` porteur d'un `onMouseEnter` ; la `HoverCard` ne se monte que sur la
 * case réellement survolée, DÉJÀ OUVERTE, et Radix reprend la main pour la
 * fermer — c'est lui qui sait distinguer « la souris part » de « la souris entre
 * dans la carte ».
 *
 * ⚠️ L'ÉTAT EST LOCAL À LA CASE, jamais remonté à la grille : une variable de
 * survol dans `GrilleEmploi` ferait re-rendre les 1 224 cases à chaque
 * déplacement de souris.
 */
export default function CarteModule({ groupe, module, children }) {
  const [ouvert, setOuvert] = useState(false);
  const minuterie = useRef(null);

  /*
   * ⚠️ UN DÉLAI AVANT D'OUVRIR. Sans lui, traverser une ligne de la grille
   * déclencherait une requête par case franchie — et ferait clignoter une carte
   * qu'on ne cherchait pas à lire.
   */
  const armer = () => {
    clearTimeout(minuterie.current);
    minuterie.current = setTimeout(() => setOuvert(true), DELAI_SURVOL);
  };
  const desarmer = () => clearTimeout(minuterie.current);

  useEffect(() => () => clearTimeout(minuterie.current), []);

  if (!ouvert) {
    return (
      <span className={ENVELOPPE} onMouseEnter={armer} onMouseLeave={desarmer}>
        {children}
      </span>
    );
  }

  return (
    <HoverCard open openDelay={0} closeDelay={120} onOpenChange={setOuvert}>
      <HoverCardTrigger asChild>
        <span className={ENVELOPPE}>{children}</span>
      </HoverCardTrigger>

      <HoverCardContent align="start" className="w-80 p-0 text-xs">
        <Contenu groupe={groupe} module={module} />
      </HoverCardContent>
    </HoverCard>
  );
}

/** Assez long pour traverser une ligne sans rien déclencher. */
const DELAI_SURVOL = 320;

/**
 * ⚠️ L'ENVELOPPE HUGE SON CONTENU (`w-fit self-center`), elle ne prend PAS toute
 * la largeur de la case. C'est ce qui fait des badges une CIBLE : une bande
 * pleine largeur rouvrirait la carte en traversant la case par la gauche ou par
 * la droite, là où il n'y a rien à lire.
 */
const ENVELOPPE = 'flex w-fit self-center';

function Contenu({ groupe, module }) {
  const fiche = useQuery({
    queryKey: ['emploi', 'module', groupe, module],
    queryFn: () => chargerFicheModule(groupe, module),
    // La fiche ne change qu'en posant des séances : la garder évite de
    // reinterroger le serveur à chaque aller-retour de souris.
    staleTime: 60_000,
    retry: false,
  });

  if (fiche.isLoading) {
    return <p className="p-3 text-muted-foreground">Chargement du module…</p>;
  }
  if (fiche.isError) {
    return <p className="p-3 text-destructive">{fiche.error.message}</p>;
  }

  const { intitule, semestre, estRegional, presentiel, synchrone } = fiche.data;

  return (
    <div>
      <div className="space-y-1 border-b p-3">
        {/* ⚠️ LE NOM D'ABORD, le code ensuite. C'est le nom qu'on vient
            chercher — le code est déjà sous les yeux, dans la case. */}
        <p className="font-medium leading-snug">
          {intitule ?? (
            <span className="text-muted-foreground">
              Intitulé inconnu — ce module n’est pas dans la répartition DRIF
            </span>
          )}
        </p>

        <p className="flex flex-wrap items-center gap-1 text-muted-foreground">
          <span className="font-mono">{module}</span>
          <span>·</span>
          <span>{groupe}</span>
          <BadgeSemestre semestre={semestre} />
          {estRegional && <Star className="size-2.5 shrink-0 fill-warning text-warning" />}
        </p>
      </div>

      {/*
        ═══ ⚠️ DEUX MASSES, DEUX COMPTEURS ═══
        La carte déclare séparément un présentiel et un synchrone, et chacun se
        remplit avec SES séances : les additionner faisait passer un présentiel
        qui déborde pour un module à peine terminé, la masse à distance encore
        intacte absorbant l'écart.
      */}
      {/*
        ⚠️ LES DEUX ICÔNES SONT CELLES DE LA CARTE D'AFFECTATIONS — `Presentation`
        en teal, le logo Teams en violet. C'est là qu'on déclare les deux masses :
        les retrouver ici dit d'un regard de quelle ligne de la carte on parle,
        sans avoir à relire le titre.
      */}
      <Bloc
        titre="En présentiel"
        avancement={presentiel}
        icone={<Presentation className="size-3 text-accent-teal" />}
      />
      <Bloc titre="À distance" avancement={synchrone} icone={<Teams className="size-3" />} />
    </div>
  );
}

/**
 * Un type de séance : sa masse, son avancement, et ses semaines.
 *
 * ⚠️ RIEN N'EST AFFICHÉ quand ni masse ni heure n'existent pour ce type. La
 * plupart des modules n'ont pas de synchrone : lui réserver un bloc vide sur
 * chaque carte ferait chercher ce qui manque là où il n'y a simplement rien.
 */
function Bloc({ titre, avancement, icone }) {
  const { prevu, pose, taux, niveau, semaines } = avancement ?? {};
  if (!prevu && !pose) return null;

  return (
    <div className="border-b last:border-b-0">
      <div className="space-y-1 p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 font-medium">
            {icone}
            {titre}
          </span>
          <BadgeAvancement avancement={{ taux, niveau, pose, prevu }} />
        </div>

        <p className="tabular-nums">
          <span className="font-semibold">{pose} h</span> posées sur{' '}
          {prevu > 0 ? (
            <>
              <span className="font-semibold">{prevu} h</span> prévues
            </>
          ) : (
            /* ⚠️ « 0 h prévues » et « masse non déclarée » ne sont pas la même
               chose : la seconde ne se corrige pas dans l'emploi du temps mais
               dans la carte d'affectations. */
            <span className="text-muted-foreground">une masse non déclarée</span>
          )}
        </p>

        {prevu > 0 && <Jauge taux={taux} />}
      </div>

      {semaines?.length > 0 && (
        <div className="max-h-40 overflow-y-auto border-t">
          <table className="w-full">
            <thead className="sticky top-0 bg-tableau-tete text-[0.65rem] text-tableau-tete-foreground">
              <tr>
                <th className="px-3 py-1 text-left font-medium">Semaine</th>
                <th className="px-2 py-1 text-right font-medium">Heures</th>
                <th className="px-2 py-1 text-right font-medium">Cumul</th>
                <th className="px-3 py-1 text-right font-medium">Taux</th>
              </tr>
            </thead>
            <tbody>
              {semaines.map((entree) => (
                <tr key={entree.semaine} className="border-b last:border-b-0">
                  <td className="px-3 py-1">{libelleSemaine(entree.semaine, { court: true })}</td>
                  <td className={cn('px-2 py-1 text-right tabular-nums', couleurChargeTexte(entree.heures, 20))}>
                    {entree.heures} h
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                    {entree.cumul} h
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">
                    {entree.taux === null ? '—' : `${entree.taux} %`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * La barre d'avancement.
 *
 * ⚠️ BORNÉE À 100 % EN LARGEUR, mais le DÉPASSEMENT se voit : au-delà, la barre
 * passe au rouge. Laisser la largeur croître ferait déborder la carte, et
 * l'arrêter sans rien dire ferait passer 130 % pour un module tout juste
 * terminé.
 */
function Jauge({ taux }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn('h-full rounded-full', taux > 100 ? 'bg-destructive' : 'bg-success')}
        style={{ width: `${Math.min(taux, 100)}%` }}
      />
    </div>
  );
}
