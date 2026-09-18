import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { dureeSeance, libelleSemaine, separerFusion } from 'shared/domain';
import { SEMAINE_PLEINE } from '@/components/common/apparenceGrille';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Ce que porte la semaine affichée, en chiffres et en graphiques.
 * ← les trois `Chart.js` de emploi.html : heures par GROUPE, par FORMATEUR, par
 *   ESPACE (`groupHoursChartCanvas`, `formateurHoursChartCanvas`,
 *   `espacesHoursChartCanvas`, lignes 15816-15895).
 *
 * ═══ ⚠️ RECHARTS, ET NON CHART.JS DEPUIS UN CDN ═══
 * L'existant chargeait Chart.js et `chartjs-plugin-datalabels` depuis un CDN :
 * sans réseau, ou derrière un filtrage, la modale s'ouvrait VIDE. Recharts est
 * empaqueté avec l'application — c'est le choix inscrit au plan (Phase 7), et il
 * rend la CSP stricte de la Phase 11 applicable.
 *
 * ═══ CALCULÉ DANS LA PAGE, PAS DEMANDÉ AU SERVEUR ═══
 * Toutes les séances de la semaine sont DÉJÀ chargées : les redemander en
 * agrégation ferait un aller-retour pour recompter ce qu'on a sous les yeux, et
 * surtout ferait exister deux définitions de « heures posées ». `dureeSeance`
 * fait foi, S5 du soir compris.
 */
export default function DialogueStatistiques({ ouvert, onFermer, seances, contexte, semaine }) {
  const stats = useMemo(() => calculer(seances, contexte), [seances, contexte]);

  /*
   * ⚠️ « S1 - 2026 », PAS « 2026-W1 ». `2026-W1` est la valeur STOCKÉE — celle de
   * `emplois_du_temps.valeur_semaine` — et elle n'est lisible que pour qui
   * connaît le format. Un titre se lit dans le vocabulaire de l'école, le même
   * que la barre de navigation et que le chronogramme.
   */
  const titreSemaine = libelleSemaine(semaine);

  return (
    <Dialog open={ouvert} onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Statistiques de la semaine {titreSemaine}</DialogTitle>
          <DialogDescription>
            Ce que porte la grille affichée. Les séances marquées absentes ne comptent pas dans les
            heures : elles n’ont pas été assurées.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tuile valeur={stats.seances} libelle="séances" />
          <Tuile valeur={`${stats.heures} h`} libelle="heures posées" />
          <Tuile valeur={stats.formateurs} libelle="formateurs occupés" />
          <Tuile valeur={stats.absences} libelle="absences" alerte={stats.absences > 0} />
        </div>

        {/*
          ⚠️ LES TROIS GRAPHIQUES DE L'EXISTANT, DANS SON ORDRE. Chacun répond à
          une question différente : les GROUPES disent si une promotion est
          servie, les FORMATEURS qui est chargé, les ESPACES si une salle sature.
          Un seul des trois ne remplacerait pas les deux autres.
        */}
        <Graphique
          titre="Heures par groupe"
          donnees={stats.parGroupe}
          couleur="hsl(var(--primary))"
        />

        <Graphique
          titre="Heures par formateur"
          donnees={stats.parFormateur}
          couleur="hsl(var(--accent-green-deep))"
          /*
           * ⚠️ SEUL CE GRAPHIQUE PORTE UN SEUIL. 30 h est la semaine pleine d'un
           * formateur. Un groupe ou une salle n'ont pas de plafond comparable —
           * y tracer la même ligne ferait croire à une règle qui n'existe pas.
           */
          seuil={SEMAINE_PLEINE}
          /* Le matricule reste accessible dans l'infobulle : c'est lui qui
             identifie la personne partout ailleurs. ← le `tooltip.title` de
             l'existant. */
          sousTitre={(entree) => entree.cle}
        />

        <Graphique
          titre="Occupation des salles"
          donnees={stats.parSalle}
          couleur="hsl(var(--accent-teal))"
          vide="Aucune salle occupée cette semaine."
        />

        {/*
          ⚠️ CE QUI MANQUE EST AUSSI UNE STATISTIQUE, et c'est celle qu'on vient
          chercher : un tableau qui ne montre que le rempli laisse croire la
          semaine terminée.
        */}
        <section className="space-y-1">
          <h3 className="border-b pb-1 text-sm font-medium">
            Sans aucune séance ({stats.sansSeance.length})
          </h3>
          {stats.sansSeance.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              Tous les formateurs ont au moins une séance.
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {stats.sansSeance.join(' · ')}
            </p>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Un histogramme, comme les trois de l'existant : trié du plus chargé au moins
 * chargé, valeurs affichées au sommet des barres.
 *
 * ⚠️ LES ZÉROS SONT ÉCARTÉS DE L'AFFICHAGE. L'existant les gardait — « on
 * s'assure d'inclure tous les groupes/formateurs/espaces, même ceux avec 0 h » —
 * mais sur 39 groupes cela donnait trente barres plates qui écrasaient les
 * autres. Ceux qui n'ont rien sont NOMMÉS à part, sous « Sans aucune séance » :
 * l'information reste, elle change seulement de forme.
 */
function Graphique({ titre, donnees, couleur, seuil, sousTitre, vide }) {
  const avecHeures = donnees.filter((entree) => entree.heures > 0);

  return (
    <section className="space-y-1">
      <h3 className="border-b pb-1 text-sm font-medium">
        {titre}
        {avecHeures.length > 0 && (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {avecHeures.length} — du plus chargé au moins chargé
          </span>
        )}
      </h3>

      {avecHeures.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">{vide ?? 'Rien de posé cette semaine.'}</p>
      ) : (
        /*
          ⚠️ HAUTEUR PROPORTIONNELLE AU NOMBRE DE BARRES, avec un plancher. Une
          hauteur fixe rendait les libellés illisibles dès quinze entrées — c'est
          le défaut que l'existant compensait par une rotation à 45°.
        */
        <ResponsiveContainer width="100%" height={Math.max(180, 26 * avecHeures.length + 40)}>
          <BarChart data={avecHeures} layout="vertical" margin={{ left: 4, right: 44, top: 4 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis type="number" hide />
            {/*
              Barres HORIZONTALES : un nom de formateur fait vingt caractères, et
              en colonnes il fallait le pencher à 45° pour qu'il tienne — ce que
              faisait l'existant. À l'horizontale il se lit droit.
            */}
            {/*
              ⚠️ TICK DESSINÉ À LA MAIN, pour porter le NOM *et* les HEURES.
              Ni `<LabelList>` ni la prop `label` de `<Bar>` ne rendent quoi que
              ce soit en recharts 3 — vérifié dans le SVG produit, aucun nœud
              `recharts-label`. Plutôt que de deviner l'API d'une version, on
              dessine ce dont on a besoin : c'est du SVG, et il est sous contrôle.

              Les valeurs comptent ici : c'est un tableau de bord d'heures, et
              devoir survoler chaque barre pour lire un nombre annulerait
              l'intérêt du graphique.
            */}
            <YAxis
              type="category"
              dataKey="nom"
              width={205}
              tickLine={false}
              axisLine={false}
              tick={<TickSujet donnees={avecHeures} />}
            />
            <Tooltip
              cursor={{ fill: 'hsl(var(--muted))' }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: '1px solid hsl(var(--border))',
                background: 'hsl(var(--card))',
              }}
              formatter={(valeur) => [`${valeur} h`, 'posées']}
              labelFormatter={(nom, charge) => {
                const entree = charge?.[0]?.payload;
                const detail = sousTitre?.(entree ?? {});
                return detail && detail !== nom ? `${nom} — ${detail}` : nom;
              }}
            />
            {/*
              ⚠️ UN SEUL `fill`, PAS UN `<Cell>` PAR BARRE. En recharts 3, mêler
              des `Cell` et un `LabelList` dans le même `Bar` ne rend RIEN — la
              barre se dessine vide, sans erreur en console. Vérifié : le groupe
              `recharts-bar-rectangle` ne contenait qu'un `recharts-inactive-bar`
              sans forme.
            */}
            <Bar
              dataKey="heures"
              fill={couleur}
              radius={[0, 4, 4, 0]}
              maxBarSize={18}
              /*
               * ⚠️ SANS ANIMATION. Recharts anime l'apparition des barres par
               * `requestAnimationFrame` ; dans un onglet ou un panneau qui n'est
               * pas à l'écran, Chrome gèle ces trames — les barres restent à
               * largeur nulle et le graphique paraît VIDE, axes et ligne de
               * seuil dessinés autour du rien. Une modale de statistiques n'a
               * rien à gagner à une animation d'une demi-seconde, et beaucoup à
               * perdre à se rendre dépendante de la visibilité de la page.
               */
              isAnimationActive={false}
            />

            {/*
              Le seuil devient une LIGNE, plus une couleur de barre : elle dit où
              passe la limite, y compris pour celles qui n'y sont pas encore —
              une barre rouge ne renseigne que sur elle-même.
            */}
            {seuil && (
              <ReferenceLine
                x={seuil}
                stroke="hsl(var(--destructive))"
                strokeDasharray="4 4"
                label={{
                  value: `${seuil} h`,
                  position: 'top',
                  fill: 'hsl(var(--destructive))',
                  fontSize: 10,
                }}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      )}

      {seuil && (
        <p className="text-[0.7rem] text-muted-foreground">
          Le trait rouge marque {seuil} h — la semaine pleine d’un formateur.
        </p>
      )}
    </section>
  );
}

/**
 * Le libellé d'une barre : le sujet à gauche, ses heures juste avant la barre.
 *
 * ⚠️ `payload.value` porte le NOM (c'est la clé de l'axe) ; les heures se
 * retrouvent dans le jeu de données, par ce nom. Recharts ne transmet pas la
 * ligne entière au tick.
 */
function TickSujet({ x, y, payload, donnees }) {
  const entree = donnees.find((ligne) => ligne.nom === payload.value);

  return (
    <g transform={`translate(${x},${y})`}>
      <text x={-200} y={0} dy={4} textAnchor="start" fontSize={11} fill="hsl(var(--foreground))">
        {payload.value}
      </text>
      <text
        x={-6}
        y={0}
        dy={4}
        textAnchor="end"
        fontSize={11}
        fontWeight={600}
        fill="hsl(var(--muted-foreground))"
      >
        {entree ? `${entree.heures} h` : ''}
      </text>
    </g>
  );
}

function calculer(seances = [], contexte = {}) {
  const noms = new Map((contexte.formateurs ?? []).map((f) => [f.matricule, f.nom]));
  const parFormateur = new Map();
  const parGroupe = new Map();
  const parSalle = new Map();

  let heures = 0;
  let absences = 0;

  for (const seance of seances) {
    if (seance.statut === 'absent') {
      absences += 1;
      continue;
    }

    const duree = dureeSeance(seance.seance);
    heures += duree;

    ajouter(parFormateur, seance.formateurMatricule, duree);

    /*
     * ⚠️ UNE SÉANCE FUSIONNÉE COMPTE POUR CHACUN DE SES GROUPES : elle est
     * mutualisée pour le formateur, mais chaque groupe reçoit bien ces heures.
     * C'est la même règle que le bilan de charge et que les taux d'avancement.
     *
     * ⚠️⚠️ `separerFusion`, PAS UN DÉCOUPAGE SUR LES ESPACES. Un nom de groupe en
     * contient dès qu'il porte un suffixe : « ACADA101 (FQ) » devenait DEUX
     * barres, « ACADA101 » et « (FQ) », chacune créditée des mêmes heures — vu
     * à l'écran avant correction.
     */
    for (const groupe of separerFusion(seance.groupe)) {
      ajouter(parGroupe, groupe, duree);
    }

    /* Une séance sans salle n'occupe rien, et « TEAMS » n'est pas un local :
       les compter fabriquerait une occupation qui n'existe pas. */
    const salle = String(seance.salle ?? '').trim();
    if (salle && salle.toUpperCase() !== 'TEAMS') ajouter(parSalle, salle, duree);
  }

  const trier = (table, libelle = (cle) => cle) =>
    [...table]
      .map(([cle, valeur]) => ({ cle, nom: libelle(cle), heures: arrondir(valeur) }))
      .sort((a, b) => b.heures - a.heures);

  return {
    seances: seances.length - absences,
    heures: arrondir(heures),
    absences,
    formateurs: parFormateur.size,
    parFormateur: trier(parFormateur, (cle) => noms.get(cle) ?? cle),
    parGroupe: trier(parGroupe),
    parSalle: trier(parSalle),
    sansSeance: (contexte.formateurs ?? [])
      .filter((f) => !parFormateur.has(f.matricule))
      .map((f) => f.nom),
  };
}

const ajouter = (table, cle, duree) => table.set(cle, (table.get(cle) ?? 0) + duree);
const arrondir = (valeur) => Math.round(valeur * 100) / 100;

function Tuile({ valeur, libelle, alerte }) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <span className={cn('block text-xl font-semibold tabular-nums', alerte && 'text-destructive')}>
        {valeur}
      </span>
      <span className="block text-xs text-muted-foreground">{libelle}</span>
    </div>
  );
}
