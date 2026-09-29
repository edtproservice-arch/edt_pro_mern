import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { ArrowUpRight } from 'lucide-react';
import { chargerTableauDeBord } from '@/features/absences/stagiaires/api';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';

/**
 * Les statistiques d'absence et de discipline des stagiaires — tuiles et
 * sections, PARTAGÉES entre l'accueil du gestionnaire et celui du directeur
 * (2026-09-29, demande du porteur : « je veux que ces stats s'affichent aussi
 * en accueil directeur »).
 *
 * ⚠️ ÉCRIT UNE FOIS, POSÉ AUX DEUX ENDROITS — mais PAS de la même façon
 * (2026-09-29, revient sur un premier essai en bloc séparé : « mets ces
 * cartes en haut avec les autres ») : le directeur a déjà six tuiles en tête
 * de son accueil, et les trois d'ici doivent les REJOINDRE dans la même
 * grille, pas ouvrir une septième rangée. `useTableauDeBordAbsences` fait la
 * lecture une fois ; `TuilesAbsencesDiscipline` et `SectionsAbsencesDiscipline`
 * se posent chacune où l'appelant les veut. Le gestionnaire, qui n'a pas
 * d'autres tuiles à rejoindre, garde l'assemblage complet par défaut.
 *
 * ⚠️ UN SEUL ENDPOINT AGRÉGÉ (`tableauDeBord`, `discipline.service.js`), pas
 * une boucle sur chaque groupe : voir son commentaire côté serveur.
 */
export function useTableauDeBordAbsences() {
  return useQuery({
    queryKey: ['absences-stagiaires', 'tableau-bord'],
    queryFn: chargerTableauDeBord,
    retry: false,
  });
}

/**
 * Les trois tuiles SEULES — à poser dans la grille de l'appelant.
 *
 * ⚠️ `onOuvrir` (2026-09-29, demande du porteur : « si je clique sur une des
 * card stats en haut s'affiche la card concernée ») — quand l'appelant le
 * fournit (le directeur), un clic OUVRE la section repliée au lieu de
 * naviguer ; sans lui (le gestionnaire, qui n'a rien d'autre sur sa page), le
 * clic garde son ancien comportement, un lien classique vers « Absences ».
 *
 * ⚠️ TROIS CLÉS, PAS DEUX (2026-09-29, revient sur « Absences » et « Retards »
 * partageant la même clé : « je veux séparer l'absence et retard, ajouter une
 * autre card pour le retard ») — `groupesAbsences` et `groupesRetards` sont
 * maintenant deux agrégations distinctes côté serveur, donc chaque tuile
 * ouvre SA propre liste ; Indisciplines ouvre toujours les deux siennes
 * (`groupesIndisciplines` et les dernières), sous `'discipline'`.
 */
export function TuilesAbsencesDiscipline({ d, chargement, onOuvrir, sectionOuverte }) {
  const retardsNJ = d?.retards.nonJustifies ?? 0;
  const absencesNJ = d?.absences.nonJustifiees ?? 0;
  const ouvrir = (cle) => onOuvrir && (() => onOuvrir(cle));

  return (
    <>
      <Tuile
        libelle="Absences stagiaires"
        valeur={d && `${nombre(d.absences.total)}`}
        detail={d && `dont ${nombre(absencesNJ)} non justifiée(s)`}
        alerte={absencesNJ > 0}
        chargement={chargement}
        vers="/app/absences"
        onClick={ouvrir('absences')}
        ouvert={sectionOuverte === 'absences'}
      />
      <Tuile
        libelle="Retards stagiaires"
        valeur={d && `${nombre(d.retards.total)}`}
        detail={d && `dont ${nombre(retardsNJ)} non justifié(s)`}
        alerte={retardsNJ > 0}
        chargement={chargement}
        vers="/app/absences"
        onClick={ouvrir('retards')}
        ouvert={sectionOuverte === 'retards'}
      />
      <Tuile
        libelle="Indisciplines stagiaires"
        valeur={d && `${nombre(d.indisciplines.total)}`}
        detail="sanctions déclarées cette année"
        alerte={(d?.indisciplines.total ?? 0) > 0}
        chargement={chargement}
        vers="/app/absences"
        onClick={ouvrir('discipline')}
        ouvert={sectionOuverte === 'discipline'}
      />
    </>
  );
}

/**
 * Les groupes les plus absents SEULS — pour la tuile Absences.
 *
 * ⚠️ `visible = true` PAR DÉFAUT : le gestionnaire (assemblage complet plus
 * bas) la montre toujours. Le directeur, lui, passe `visible={ouvert}`.
 */
export function SectionGroupesAbsents({ d, chargement, visible = true }) {
  if (!visible) return null;
  return (
    <div className="space-y-4 duration-300 animate-in fade-in-0 zoom-in-95 slide-in-from-top-3 motion-reduce:animate-none">
      <GroupesAbsences groupes={d?.groupesAbsences ?? []} chargement={chargement} />
      <DernieresAbsences lignes={d?.absences.recentes ?? []} chargement={chargement} />
    </div>
  );
}

/** Les groupes les plus en retard SEULS — pour la tuile Retards. */
export function SectionGroupesRetards({ d, chargement, visible = true }) {
  if (!visible) return null;
  return (
    <div className="space-y-4 duration-300 animate-in fade-in-0 zoom-in-95 slide-in-from-top-3 motion-reduce:animate-none">
      <GroupesRetards groupes={d?.groupesRetards ?? []} chargement={chargement} />
      <DernieresRetards lignes={d?.retards.recents ?? []} chargement={chargement} />
    </div>
  );
}

/** Les groupes les plus indisciplinés ET les dernières indisciplines — pour la tuile Indisciplines. */
export function SectionDiscipline({ d, chargement, visible = true }) {
  if (!visible) return null;
  return (
    <div className="space-y-4 duration-300 animate-in fade-in-0 zoom-in-95 slide-in-from-top-3 motion-reduce:animate-none">
      <GroupesIndisciplines groupes={d?.groupesIndisciplines ?? []} chargement={chargement} />
      <DernieresIndisciplines lignes={d?.indisciplines.recentes ?? []} chargement={chargement} />
    </div>
  );
}

/** Les quatre sections ensemble — pour l'appelant qui les montre toujours l'une sous l'autre (sans tuiles repliables). */
export function SectionsAbsencesDiscipline({ d, chargement }) {
  return (
    <div className="space-y-4">
      <SectionGroupesAbsents d={d} chargement={chargement} />
      <SectionGroupesRetards d={d} chargement={chargement} />
      <SectionDiscipline d={d} chargement={chargement} />
    </div>
  );
}

/**
 * L'assemblage complet — tuiles dans leur propre grille, puis SEULE la
 * section de la tuile cliquée.
 *
 * ⚠️ MASQUÉES PAR DÉFAUT, COMME CHEZ LE DIRECTEUR (2026-09-29, demande du
 * porteur : « en session gestionnaire je veux que les cards etre masquer par
 * défaut et s'affiche lorsque je clique sur card stats concerné comme chez le
 * directeur ») — le gestionnaire n'a que ces trois tuiles, mais l'accordéon
 * doit se comporter pareil : rien d'ouvert au chargement, un clic ouvre SA
 * section, un second clic la referme.
 */
export default function StatistiquesAbsencesDiscipline() {
  const bord = useTableauDeBordAbsences();
  const [sectionOuverte, setSectionOuverte] = useState(null);
  const basculer = (cle) => setSectionOuverte((actuelle) => (actuelle === cle ? null : cle));

  /*
   * ⚠️ SANS BASE, PAS DE CHIFFRES — MÊME RÈGLE QUE LE RESTE DE L'ACCUEIL : un
   * tableau à zéro laisserait croire un établissement sans absence plutôt
   * qu'une base pas encore importée.
   */
  if (bord.isError) {
    return (
      <section className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm font-medium">Aucune donnée pour le moment</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Les statistiques d’absence et de discipline apparaîtront ici dès la première saisie.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TuilesAbsencesDiscipline
          d={bord.data}
          chargement={bord.isLoading}
          onOuvrir={basculer}
          sectionOuverte={sectionOuverte}
        />
      </section>
      <SectionGroupesAbsents d={bord.data} chargement={bord.isLoading} visible={sectionOuverte === 'absences'} />
      <SectionGroupesRetards d={bord.data} chargement={bord.isLoading} visible={sectionOuverte === 'retards'} />
      <SectionDiscipline d={bord.data} chargement={bord.isLoading} visible={sectionOuverte === 'discipline'} />
    </>
  );
}

function Tuile({ libelle, valeur, detail, alerte, chargement, vers, onClick, ouvert }) {
  const classe = cn(
    'rounded-lg border p-4 text-left transition-colors hover:border-input hover:bg-muted/40',
    ouvert && 'border-primary/40 bg-primary/5'
  );
  const contenu = (
    <>
      <p className="text-xs text-muted-foreground">{libelle}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', alerte && 'text-destructive')}>
        {chargement ? '—' : (valeur ?? '—')}
      </p>
      {detail && !chargement && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </>
  );

  if (onClick) {
    return (
      <button type="button" aria-pressed={ouvert} onClick={onClick} className={classe}>
        {contenu}
      </button>
    );
  }
  return (
    <Link to={vers} className={classe}>
      {contenu}
    </Link>
  );
}

/** Le cadre commun des sections — repris de `TableauDeBordAccueil`. */
function Section({ titre, lien, libelleLien, children }) {
  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium">{titre}</h2>
        {lien && (
          <Link to={lien} className="flex items-center gap-1 text-xs text-primary hover:underline">
            {libelleLien}
            <ArrowUpRight className="size-3" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/*
 * ⚠️ CHAQUE LIGNE MÈNE À SON GROUPE (2026-09-29, demande du porteur : « si je
 * clique envoie directement en groupe en page absence ») — l'onglet
 * Stagiaires lit maintenant `?groupe=…` (et `?onglet=notes` pour les
 * indisciplines) pour déplier directement le bon groupe.
 */
const LIGNE_LIEN =
  '-mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted/40';

/**
 * ⚠️ « BAR CHART — MIXED », PAS UNE LISTE (2026-09-29, demande du porteur,
 * capture d'un graphique en barres horizontales dégradées à l'appui) : une
 * barre par groupe, la plus chargée en haut, la teinte s'éclaircissant vers
 * le bas — exactement le dégradé de l'exemple. Un clic sur une barre mène
 * toujours au groupe (`vers`, câblé sur `/app/absences?groupe=…`).
 */
function GrapheGroupes({ groupes, teinte, suffixe, vers }) {
  const navigate = useNavigate();
  if (groupes.length === 0) return null;

  const donnees = groupes.map((g) => ({ groupe: g.groupe, valeur: g.n, vers: vers(g.groupe) }));
  const hauteur = donnees.length * 40 + 8;

  return (
    <div className="mt-3" style={{ height: hauteur }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={donnees} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="groupe"
            tickLine={false}
            axisLine={false}
            width={92}
            tick={{ fontSize: 11, fill: teinte }}
          />
          <Bar
            dataKey="valeur"
            radius={[0, 6, 6, 0]}
            barSize={22}
            cursor="pointer"
            onClick={(donnee) => donnee?.vers && navigate(donnee.vers)}
            label={{
              position: 'right',
              fontSize: 11,
              fill: 'hsl(var(--muted-foreground))',
              formatter: (valeur) => `${nombre(valeur)} ${suffixe}`,
            }}
          >
            {donnees.map((ligne, index) => (
              <Cell key={ligne.groupe} fill={teinte} fillOpacity={1 - index * (0.5 / Math.max(1, donnees.length - 1))} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const versGroupe = (groupe, onglet) =>
  `/app/absences?groupe=${encodeURIComponent(groupe)}${onglet ? `&onglet=${onglet}` : ''}`;

/** Les groupes qui portent le plus d'absences — pour savoir où regarder d'abord. */
function GroupesAbsences({ groupes, chargement }) {
  if (chargement || groupes.length === 0) return null;

  return (
    <Section titre="Groupes les plus absents" lien="/app/absences" libelleLien="Voir le registre">
      <GrapheGroupes groupes={groupes} teinte="hsl(var(--destructive))" suffixe="fait(s)" vers={versGroupe} />
    </Section>
  );
}

/** Les groupes qui portent le plus de retards — distincts des absences. */
function GroupesRetards({ groupes, chargement }) {
  if (chargement || groupes.length === 0) return null;

  return (
    <Section titre="Groupes les plus en retard" lien="/app/absences" libelleLien="Voir le registre">
      <GrapheGroupes groupes={groupes} teinte="hsl(var(--warning))" suffixe="retard(s)" vers={versGroupe} />
    </Section>
  );
}

/** Les groupes qui portent le plus d'indisciplines. */
function GroupesIndisciplines({ groupes, chargement }) {
  if (chargement || groupes.length === 0) return null;

  return (
    <Section titre="Groupes les plus indisciplinés" lien="/app/absences" libelleLien="Voir le registre">
      <GrapheGroupes
        groupes={groupes}
        teinte="hsl(var(--warning))"
        suffixe="sanction(s)"
        vers={(groupe) => versGroupe(groupe, 'notes')}
      />
    </Section>
  );
}

/**
 * Les dernières absences et les derniers retards marqués, comme les
 * indisciplines (2026-09-29, demande du porteur : « je veux ajouter les
 * Dernières absent et retard comme indisciplines »).
 */
function DernieresAbsences({ lignes, chargement }) {
  return (
    <DernieresLignes
      titre="Dernières absences"
      lignes={lignes}
      chargement={chargement}
      couleurJustifiee="text-success"
    />
  );
}

function DernieresRetards({ lignes, chargement }) {
  return (
    <DernieresLignes
      titre="Derniers retards"
      lignes={lignes}
      chargement={chargement}
      couleurJustifiee="text-success"
    />
  );
}

function DernieresLignes({ titre, lignes, chargement, couleurJustifiee }) {
  if (chargement || lignes.length === 0) return null;

  return (
    <Section titre={titre} lien="/app/absences" libelleLien="Voir le registre">
      <ul className="mt-3 divide-y border-t">
        {lignes.map((ligne) => (
          <li key={`${ligne.matricule}-${ligne.date}`}>
            <span className={LIGNE_LIEN}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{ligne.nom}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {ligne.groupe} · {ligne.module || 'sans module'}
                </span>
              </span>
              <span
                className={cn(
                  'shrink-0 text-xs',
                  ligne.justifiee ? couleurJustifiee : 'text-muted-foreground'
                )}
              >
                {ligne.justifiee ? 'Justifiée' : 'Non justifiée'}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatterDate(ligne.date)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Les dernières indisciplines déclarées, pour retrouver vite un fait récent. */
function DernieresIndisciplines({ lignes, chargement }) {
  if (chargement || lignes.length === 0) return null;

  return (
    <Section titre="Dernières indisciplines" lien="/app/absences" libelleLien="Voir le registre">
      <ul className="mt-3 divide-y border-t">
        {lignes.map((ligne) => (
          <li key={`${ligne.matricule}-${ligne.date}`}>
            <span className={LIGNE_LIEN}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{ligne.nom}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {ligne.groupe} · {ligne.motif}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatterDate(ligne.date)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** « 2026-09-29 » → « 29/09/2026 ». */
function formatterDate(date) {
  const [annee, mois, jour] = String(date ?? '').split('-');
  return annee && mois && jour ? `${jour}/${mois}/${annee}` : '';
}
