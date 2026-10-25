import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { nombre } from '@/lib/nombres';

/**
 * ═══ L'ÉVOLUTION PAR SEMAINE ═══ (2026-10-25, demande du porteur) : les
 * absences et les retards de chaque semaine, pour voir si ça s'améliore.
 *
 * ⚠️ TOUTES LES SEMAINES ENTRE LA PREMIÈRE ET LA COURANTE, MÊME VIDES : une
 * semaine sans absence omise rapprocherait deux pics qui ne se touchent pas,
 * et la courbe mentirait sur la tendance.
 *
 * ⚠️ UN GROUPE OU TOUS : la donnée du serveur est par jour ET par groupe, le
 * filtre ne relance aucune requête.
 */
export default function EvolutionHebdomadaire({ parJour }) {
  const [groupe, setGroupe] = useState(TOUS);
  const groupes = useMemo(
    () => [...new Set(parJour.map((ligne) => ligne.groupe).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')),
    [parJour]
  );
  const semaines = useMemo(
    () => parSemaine(groupe === TOUS ? parJour : parJour.filter((ligne) => ligne.groupe === groupe)),
    [parJour, groupe]
  );

  if (parJour.length === 0) return null;

  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-sm font-medium">Évolution par semaine</h2>
          <p className="text-xs text-muted-foreground">Séances manquées et retards, semaine par semaine</p>
        </div>
        <Select value={groupe} onValueChange={setGroupe}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TOUS} className="text-xs">
              Tous les groupes
            </SelectItem>
            {groupes.map((nom) => (
              <SelectItem key={nom} value={nom} className="text-xs">
                {nom}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-3 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={semaines} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
            <XAxis
              dataKey="libelle"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              minTickGap={16}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            />
            <Tooltip content={<Infobulle />} />
            <Area
              type="monotone"
              dataKey="absences"
              name="Absences"
              stroke="hsl(var(--destructive))"
              fill="hsl(var(--destructive))"
              fillOpacity={0.15}
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="retards"
              name="Retards"
              stroke="hsl(var(--warning))"
              fill="hsl(var(--warning))"
              fillOpacity={0.15}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <Legende couleur="bg-destructive" libelle="Séances manquées" />
        <Legende couleur="bg-warning" libelle="Retards" />
        <Tendance semaines={semaines} />
      </div>
    </section>
  );
}

const TOUS = '__tous__';

function Legende({ couleur, libelle }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${couleur}`} />
      {libelle}
    </span>
  );
}

/**
 * La tendance en mots : la dernière semaine COMPLÈTE contre la moyenne des
 * quatre d'avant. La semaine en cours est écartée — à moitié écoulée, elle
 * paraîtrait toujours en baisse.
 */
function Tendance({ semaines }) {
  const completes = semaines.slice(0, -1);
  if (completes.length < 5) return null;
  const derniere = completes.at(-1).absences;
  const moyenne = completes.slice(-5, -1).reduce((somme, s) => somme + s.absences, 0) / 4;
  if (moyenne === 0 && derniere === 0) return null;
  const ecart = moyenne === 0 ? 1 : (derniere - moyenne) / moyenne;
  const texte =
    Math.abs(ecart) < 0.1
      ? 'stable'
      : `${ecart > 0 ? 'en hausse' : 'en baisse'} de ${Math.round(Math.abs(ecart) * 100)} %`;
  return (
    <span className={ecart >= 0.1 ? 'font-medium text-destructive' : ecart <= -0.1 ? 'font-medium text-success' : ''}>
      Semaine dernière : {texte} par rapport aux quatre précédentes
    </span>
  );
}

function Infobulle({ active, payload }) {
  if (!active || !payload?.length) return null;
  const semaine = payload[0].payload;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium">Semaine du {semaine.libelle}</p>
      <p className="text-destructive">{nombre(semaine.absences)} séance(s) manquée(s)</p>
      <p className="text-accent-orange-deep">{nombre(semaine.retards)} retard(s)</p>
    </div>
  );
}

const JOUR_MS = 86_400_000;

/** Le lundi de la semaine d'un jour « AAAA-MM-JJ », en UTC pour échapper aux changements d'heure. */
function lundiDe(date) {
  const jour = new Date(`${date}T00:00:00Z`);
  const decalage = (jour.getUTCDay() + 6) % 7;
  return new Date(jour.getTime() - decalage * JOUR_MS).toISOString().slice(0, 10);
}

function parSemaine(lignes) {
  if (lignes.length === 0) return [];
  const totaux = new Map();
  for (const { date, absences, retards } of lignes) {
    const lundi = lundiDe(date);
    const total = totaux.get(lundi) ?? { absences: 0, retards: 0 };
    total.absences += absences;
    total.retards += retards;
    totaux.set(lundi, total);
  }

  const premier = [...totaux.keys()].sort()[0];
  const dernier = lundiDe(new Date().toISOString().slice(0, 10));
  const semaines = [];
  for (let t = Date.parse(`${premier}T00:00:00Z`); t <= Date.parse(`${dernier}T00:00:00Z`); t += 7 * JOUR_MS) {
    const lundi = new Date(t).toISOString().slice(0, 10);
    const total = totaux.get(lundi) ?? { absences: 0, retards: 0 };
    semaines.push({ lundi, libelle: `${lundi.slice(8, 10)}/${lundi.slice(5, 7)}`, ...total });
  }
  return semaines;
}
