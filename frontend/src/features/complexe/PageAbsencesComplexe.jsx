import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Alerte from '@/components/common/Alerte';
import CadreReglage from '@/features/parametres/CadreReglage';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';
import { chargerAbsencesComplexe } from './api';
import {
  AXE,
  GrilleTuiles,
  InfoBulle,
  Pastille,
  Section,
  TableauSection,
  Tuile,
  cellule,
  celluleNom,
  pourcent,
  taux,
} from './composants';

/**
 * ═══ ABSENCES EN CHIFFRES (2026-10-27, refaite au style de l'accueil à la
 * demande du porteur) ═══ Formateurs : absences, part rattrapée. Stagiaires :
 * absences PAR STAGIAIRE — « 412 » dans un grand établissement et « 150 » dans un
 * petit ne se comparent pas —, leur évolution semaine par semaine, retards et
 * part justifiée. Sur l'année, et sur les 30 derniers jours.
 *
 * ⚠️ DES TOTAUX, JAMAIS UN NOM (décision du porteur) : le serveur n'en envoie
 * aucun — ni de stagiaire, ni de formateur absent.
 */
const TEINTES = [
  'hsl(var(--accent-purple))',
  'hsl(var(--accent-green))',
  'hsl(var(--accent-pink))',
  'hsl(var(--accent-teal))',
  'hsl(var(--accent-brown))',
  'hsl(var(--accent-cyan))',
];
const teinteDe = (rang) => TEINTES[rang % TEINTES.length];

export default function PageAbsencesComplexe() {
  const requete = useQuery({ queryKey: ['complexe', 'absences'], queryFn: chargerAbsencesComplexe });
  const cartes = useMemo(() => requete.data?.etablissements ?? [], [requete.data]);
  const semaines = useMemo(() => parSemaine(cartes), [cartes]);

  const somme = (lire) => cartes.reduce((s, c) => s + (lire(c) ?? 0), 0);
  const formateurs = somme((c) => c.formateurs.annee);
  const rattrapees = somme((c) => c.formateurs.rattrapees);
  const absences = somme((c) => c.stagiaires.absences);
  const effectif = somme((c) => c.stagiaires.effectif);
  const justifiees = somme((c) => c.stagiaires.justifiees);
  const marques = somme((c) => c.stagiaires.absences + c.stagiaires.retards);

  return (
    <CadreReglage
      large
      titre="Absences en chiffres"
      description="Année en cours — et sur les 30 derniers jours. Aucun nom n’est transmis."
      chargement={requete.isLoading}
      erreur={requete.isError ? requete.error.message : null}
    >
      {cartes.length === 0 ? (
        <Alerte type="info" titre="Aucun établissement autorisé">
          Les absences d&apos;un établissement apparaissent ici dès qu&apos;il vous a ouvert son accès.
        </Alerte>
      ) : (
        <>
          <GrilleTuiles>
            <Tuile
              libelle="Absences par stagiaire"
              valeur={effectif > 0 ? nombre(Math.round((absences / effectif) * 10) / 10) : '—'}
              detail={`${nombre(absences)} séances manquées · ${nombre(effectif)} stagiaires`}
            />
            <Tuile
              libelle="Marques justifiées"
              valeur={pourcent(taux(justifiees, marques))}
              detail="absences et retards"
            />
            <Tuile libelle="Absences formateurs" valeur={nombre(formateurs)} detail="sur l’année" />
            <Tuile
              libelle="Rattrapées"
              valeur={pourcent(taux(rattrapees, formateurs))}
              detail={`${nombre(formateurs - rattrapees)} encore à rattraper`}
              teinte={formateurs - rattrapees > 0 ? 'text-destructive' : null}
            />
          </GrilleTuiles>

          <Section titre="Absences des stagiaires par semaine" precision="Séances manquées, retards exclus">
            {semaines.points.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Aucune absence marquée cette année.</p>
            ) : (
              <>
                <div className="mt-3 h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={semaines.points} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="libelle" tickLine={false} axisLine={false} tick={AXE} minTickGap={16} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={AXE} />
                      <Tooltip content={<InfoBulle suffixe="" />} />
                      {cartes.map((c, rang) => (
                        <Line
                          key={c.id}
                          type="monotone"
                          dataKey={c.id}
                          name={c.nom}
                          stroke={teinteDe(rang)}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs">
                  {cartes.map((c, rang) => (
                    <Pastille key={c.id} couleur={teinteDe(rang)} libelle={c.nom} />
                  ))}
                </div>
              </>
            )}
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section titre="Absences par stagiaire" precision="Pour comparer des établissements de tailles différentes">
              <Barres
                donnees={cartes.map((c, rang) => ({ nom: c.nom, valeur: c.stagiaires.parStagiaire ?? 0, couleur: teinteDe(rang) }))}
                suffixe=" par stagiaire"
              />
            </Section>
            <Section titre="Absences des formateurs" precision="Rattrapées ou non, sur l’année">
              <Barres
                donnees={cartes.map((c) => ({ nom: c.nom, rattrapees: c.formateurs.rattrapees, aRattraper: c.formateurs.aRattraper }))}
                series={[
                  { cle: 'rattrapees', libelle: 'Rattrapées', couleur: 'hsl(var(--success))' },
                  { cle: 'aRattraper', libelle: 'À rattraper', couleur: 'hsl(var(--destructive))' },
                ]}
              />
            </Section>
          </div>

          <Section titre="Par établissement">
            <TableauSection
              colonnes={[
                'Établissement',
                'Stagiaires',
                'Absences',
                'Par stagiaire',
                'Retards',
                'Justifiées',
                '30 derniers jours',
                'Formateurs absents',
                'À rattraper',
              ]}
            >
              {cartes.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className={celluleNom}>{c.nom}</td>
                  <td className={cellule}>{nombre(c.stagiaires.effectif ?? 0)}</td>
                  <td className={cellule}>{nombre(c.stagiaires.absences)}</td>
                  <td className={cn(cellule, 'font-medium')}>
                    {c.stagiaires.parStagiaire === null ? '—' : nombre(c.stagiaires.parStagiaire)}
                  </td>
                  <td className={cellule}>{nombre(c.stagiaires.retards)}</td>
                  <td className={cellule}>
                    {pourcent(taux(c.stagiaires.justifiees, c.stagiaires.absences + c.stagiaires.retards))}
                  </td>
                  <td className={cellule}>{nombre(c.stagiaires.trenteJours)}</td>
                  <td className={cellule}>{nombre(c.formateurs.annee)}</td>
                  <td className={cn(cellule, c.formateurs.aRattraper > 0 && 'font-medium text-destructive')}>
                    {nombre(c.formateurs.aRattraper)}
                  </td>
                </tr>
              ))}
            </TableauSection>
          </Section>
        </>
      )}
    </CadreReglage>
  );
}

/**
 * Des barres horizontales, un établissement par barre : une seule valeur
 * (chaque barre de la teinte de son établissement), ou des séries empilées.
 */
function Barres({ donnees, series = null, suffixe = '' }) {
  return (
    <>
      <div className="mt-3" style={{ height: donnees.length * 40 + 24 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={donnees} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
            <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
            <XAxis type="number" allowDecimals={!series} tickLine={false} axisLine={false} tick={AXE} />
            <YAxis type="category" dataKey="nom" width={120} tickLine={false} axisLine={false} tick={AXE} />
            <Tooltip content={<InfoBulle suffixe={suffixe} />} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
            {series ? (
              series.map((serie) => (
                <Bar key={serie.cle} dataKey={serie.cle} name={serie.libelle} stackId="pile" fill={serie.couleur} barSize={18} isAnimationActive={false} />
              ))
            ) : (
              <Bar dataKey="valeur" name="Absences" barSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false} shape={BarreTeintee} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {series && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs">
          {series.map((serie) => (
            <Pastille key={serie.cle} couleur={serie.couleur} libelle={serie.libelle} />
          ))}
        </div>
      )}
    </>
  );
}

/** Une barre de la teinte de son établissement — la même que sa courbe plus haut. */
function BarreTeintee({ x, y, width, height, payload }) {
  return <rect x={x} y={y} width={Math.max(0, width)} height={height} rx={4} fill={payload.couleur} />;
}

const JOUR_MS = 86_400_000;

/** Le lundi d'un jour « AAAA-MM-JJ », en UTC pour échapper aux changements d'heure. */
function lundiDe(date) {
  const jour = new Date(`${date}T00:00:00Z`);
  return new Date(jour.getTime() - ((jour.getUTCDay() + 6) % 7) * JOUR_MS).toISOString().slice(0, 10);
}

/**
 * Les absences de chaque établissement, semaine par semaine, de la première à la
 * courante — les semaines sans absence gardées à zéro, sans quoi la courbe
 * rapprocherait deux pics qui ne se touchent pas.
 */
function parSemaine(cartes) {
  const parLundi = new Map();
  for (const c of cartes) {
    for (const { date, absences } of c.parJour ?? []) {
      const lundi = lundiDe(date);
      const ligne = parLundi.get(lundi) ?? {};
      ligne[c.id] = (ligne[c.id] ?? 0) + absences;
      parLundi.set(lundi, ligne);
    }
  }
  if (parLundi.size === 0) return { points: [] };

  const premier = [...parLundi.keys()].sort()[0];
  const dernier = lundiDe(new Date().toISOString().slice(0, 10));
  const points = [];
  for (let t = Date.parse(`${premier}T00:00:00Z`); t <= Date.parse(`${dernier}T00:00:00Z`); t += 7 * JOUR_MS) {
    const lundi = new Date(t).toISOString().slice(0, 10);
    const ligne = parLundi.get(lundi) ?? {};
    points.push({
      libelle: `${lundi.slice(8, 10)}/${lundi.slice(5, 7)}`,
      ...Object.fromEntries(cartes.map((c) => [c.id, ligne[c.id] ?? 0])),
    });
  }
  return { points };
}
