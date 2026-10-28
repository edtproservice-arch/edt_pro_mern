import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Alerte from '@/components/common/Alerte';
import TableauTriable from '@/components/common/TableauTriable';
import CadreReglage from '@/features/parametres/CadreReglage';
import { COULEURS_PROGRESSION } from '@/features/avancement/GrapheProgression';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';
import { chargerFormateursComplexe } from './api';
import { AXE, GrilleTuiles, InfoBulle, Jauge, Section, Tuile, pourcent, taux } from './composants';

/**
 * ═══ FORMATEURS DU COMPLEXE (2026-10-27, refait au style de l'accueil à la
 * demande du porteur) ═══ Chaque formateur des établissements autorisés : sa
 * masse statutaire et ses heures AFFECTÉES, établissement par établissement. Les
 * PARTAGÉS — ceux qui enseignent dans plusieurs établissements du complexe —
 * sont signalés avec leur charge CUMULÉE : c'est ce qu'aucun directeur
 * d'établissement ne voit seul.
 *
 * ⚠️ LA MASSE STATUTAIRE EST CELLE DE LA PERSONNE : la même d'un établissement à
 * l'autre. La charge d'un partagé se lit donc sur la somme de ses heures face à
 * UNE masse — pas en additionnant ses masses, qui la diviserait par deux.
 */
export default function PageFormateursComplexe() {
  const requete = useQuery({ queryKey: ['complexe', 'formateurs'], queryFn: chargerFormateursComplexe });
  const [recherche, setRecherche] = useState('');
  const [etablissement, setEtablissement] = useState(null);
  const [partagesSeuls, setPartagesSeuls] = useState(false);
  const [depassementSeuls, setDepassementSeuls] = useState(false);

  const tous = useMemo(() => (requete.data?.formateurs ?? []).map(avecCharge), [requete.data]);
  const etablissements = requete.data?.etablissements ?? [];

  const liste = useMemo(() => {
    const motif = recherche.trim().toLowerCase();
    return tous.filter(
      (f) =>
        (!etablissement || f.parEtablissement.some((e) => e.etablissementId === etablissement)) &&
        (!partagesSeuls || f.mutualise) &&
        (!depassementSeuls || f.depassement > 0) &&
        (motif === '' || `${f.nomComplet} ${f.matricule}`.toLowerCase().includes(motif))
    );
  }, [tous, recherche, etablissement, partagesSeuls, depassementSeuls]);

  const partages = tous.filter((f) => f.mutualise).length;
  const enDepassement = tous.filter((f) => f.depassement > 0).length;
  const heures = tous.reduce((s, f) => s + f.heuresAffectees, 0);
  const masses = tous.reduce((s, f) => s + f.masse, 0);

  return (
    <CadreReglage
      large
      titre="Formateurs du complexe"
      chargement={requete.isLoading}
      erreur={requete.isError ? requete.error.message : null}
    >
      <GrilleTuiles>
        <Tuile libelle="Formateurs" valeur={nombre(tous.length)} detail={`${etablissements.length} établissement(s)`} />
        <Tuile
          libelle="Partagés entre établissements"
          valeur={nombre(partages)}
          detail="enseignent dans plusieurs établissements"
        />
        <Tuile
          libelle="Charge moyenne"
          valeur={pourcent(taux(heures, masses))}
          detail={`${nombre(heures)} h affectées / ${nombre(masses)} h statutaires`}
        />
        <Tuile
          libelle="Au-delà de leur masse statutaire"
          valeur={nombre(enDepassement)}
          detail="charge cumulée sur le complexe"
          teinte={enDepassement > 0 ? 'text-destructive' : null}
        />
      </GrilleTuiles>

      <RepartitionCharges formateurs={liste} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Nom ou matricule…"
              className="h-9 pl-8"
            />
          </div>
          <Label className="flex items-center gap-2 text-xs font-normal">
            <Switch checked={partagesSeuls} onCheckedChange={setPartagesSeuls} />
            Partagés seulement
          </Label>
          <Label className="flex items-center gap-2 text-xs font-normal">
            <Switch checked={depassementSeuls} onCheckedChange={setDepassementSeuls} />
            En dépassement seulement
          </Label>
        </div>

        {/* Un établissement à la fois, ou tous — les jetons du filtre d'Avancement. */}
        {etablissements.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {[{ id: null, nom: 'Tous les établissements' }, ...etablissements].map((e) => (
              <Button
                key={e.id ?? 'tous'}
                variant={etablissement === e.id ? 'default' : 'outline'}
                size="sm"
                aria-pressed={etablissement === e.id}
                onClick={() => setEtablissement(e.id)}
                className="h-7 px-2 text-[0.7rem]"
              >
                {e.nom}
              </Button>
            ))}
          </div>
        )}

        {tous.length === 0 ? (
          <Alerte type="info" titre="Aucun formateur">
            Aucun établissement autorisé ne déclare encore de formateurs.
          </Alerte>
        ) : (
          <TableauTriable
            colonnes={COLONNES}
            lignes={liste}
            cleLigne={(f) => f.cle}
            vide="Aucun formateur ne correspond à ce filtre."
          />
        )}
      </section>
    </CadreReglage>
  );
}

/** La masse de la personne, sa charge cumulée et son dépassement. */
function avecCharge(f) {
  const masse = Math.max(0, ...f.parEtablissement.map((e) => e.masseHoraire));
  return {
    ...f,
    masse,
    charge: taux(f.heuresAffectees, masse),
    depassement: masse > 0 ? Math.round((f.heuresAffectees - masse) * 10) / 10 : 0,
  };
}

/** La couleur d'une charge : rouge au-delà de la masse, orange en dessous de la moitié. */
const teinteCharge = (charge) =>
  charge === null ? 'bg-muted-foreground/40' : charge > 100 ? 'bg-destructive' : charge < 50 ? 'bg-warning' : 'bg-success';

const COLONNES = [
  {
    id: 'formateur',
    entete: 'Formateur',
    tri: (f) => f.nomComplet,
    rendu: (f) => (
      <span className="text-xs">
        <span className="flex flex-wrap items-center gap-1.5 font-medium">
          {f.nomComplet}
          {f.mutualise && (
            <Badge variant="outline" className="h-4 px-1 text-[0.6rem] font-normal">
              Partagé
            </Badge>
          )}
        </span>
        {f.matricule && <span className="block text-muted-foreground">{f.matricule}</span>}
      </span>
    ),
  },
  {
    id: 'etablissements',
    entete: 'Heures par établissement',
    tri: (f) => f.parEtablissement.length,
    rendu: (f) => (
      <span className="block space-y-0.5 text-xs">
        {f.parEtablissement.map((e) => (
          <span key={e.etablissementId} className="flex justify-between gap-3">
            <span className="truncate text-muted-foreground">{e.etablissement}</span>
            <span className="shrink-0 tabular-nums">{nombre(e.heuresAffectees)} h</span>
          </span>
        ))}
      </span>
    ),
  },
  {
    id: 'masse',
    entete: 'Masse statutaire',
    aligne: 'droite',
    tri: (f) => f.masse,
    rendu: (f) => <span className="text-xs tabular-nums">{f.masse > 0 ? `${nombre(f.masse)} h` : '—'}</span>,
  },
  {
    id: 'affectees',
    entete: 'Affectées',
    aligne: 'droite',
    tri: (f) => f.heuresAffectees,
    rendu: (f) => <span className="text-xs font-medium tabular-nums">{nombre(f.heuresAffectees)} h</span>,
  },
  {
    id: 'charge',
    entete: 'Charge',
    aligne: 'droite',
    tri: (f) => f.charge ?? -1,
    rendu: (f) => (
      <span className="flex items-center justify-end gap-2">
        <Jauge taux={f.charge} couleur={teinteCharge(f.charge)} className="w-20" />
        <span className={cn('w-12 text-right text-xs tabular-nums', f.charge > 100 && 'font-medium text-destructive')}>
          {pourcent(f.charge)}
        </span>
      </span>
    ),
  },
];

/** Les tranches de charge du graphe — la dernière, au-delà de la masse, en rouge. */
const TRANCHES_CHARGE = [
  { libelle: 'Moins de 50 %', max: 50 },
  { libelle: '50 à 80 %', max: 80 },
  { libelle: '80 à 100 %', max: 100 },
  { libelle: '100 à 110 %', max: 110, depasse: true },
  { libelle: 'Plus de 110 %', max: Infinity, depasse: true },
];

/** Combien de formateurs dans chaque tranche de charge — la liste filtrée, pas tout le complexe. */
function RepartitionCharges({ formateurs }) {
  const avecMasse = formateurs.filter((f) => f.charge !== null);
  if (avecMasse.length === 0) return null;
  const donnees = TRANCHES_CHARGE.map((t, rang) => ({
    ...t,
    valeur: avecMasse.filter((f) => f.charge < t.max && (rang === 0 || f.charge >= TRANCHES_CHARGE[rang - 1].max)).length,
  }));

  return (
    <Section titre="Répartition des charges" precision={`${nombre(avecMasse.length)} formateur(s) avec une masse déclarée`}>
      <div className="mt-3 h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={donnees} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="libelle" tickLine={false} axisLine={false} tick={AXE} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={AXE} />
            <Tooltip content={<InfoBulle suffixe=" formateur(s)" />} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
            <Bar dataKey="valeur" name="Formateurs" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
              {donnees.map((d) => (
                <Cell key={d.libelle} fill={d.depasse ? 'hsl(var(--destructive))' : COULEURS_PROGRESSION.regional} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}
