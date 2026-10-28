import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Alerte from '@/components/common/Alerte';
import TableauTriable from '@/components/common/TableauTriable';
import CadreReglage from '@/features/parametres/CadreReglage';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';
import { chargerEspacesComplexe } from './api';
import { GrilleTuiles, Jauge, Section, TableauSection, Tuile, cellule, celluleNom, pourcent, taux } from './composants';

/**
 * ═══ OCCUPATION DES ESPACES (2026-10-27, refaite au style de l'accueil à la
 * demande du porteur) ═══ Pour chaque établissement autorisé, une semaine :
 *   — la CARTE DE CHALEUR jours × séances : quelle part de ses salles est prise
 *     à chaque créneau (c'est là qu'on voit le mardi matin saturé) ;
 *   — les ESPACES MUTUALISÉS : une salle prêtée, son occupation RÉELLE par son
 *     propriétaire et ses emprunteurs réunis — ce qu'aucun directeur ne voit seul ;
 *   — toutes les salles, triables, saturées d'abord.
 *
 * ⚠️ ICI LA COULEUR DIT LA SATURATION, PAS LE RETARD : une salle pleine est le
 * signal (rouge), une salle peu remplie est une réserve.
 *
 * ⚠️ LA SEMAINE COURANTE, SINON LA DERNIÈRE REMPLIE (serveur) : un lundi matin,
 * la semaine qui commence n'a souvent pas encore d'emploi du temps. L'écran le dit,
 * et les flèches parcourent les autres semaines.
 */
const SATUREE = 90;

export default function PageEspacesComplexe() {
  const [semaine, setSemaine] = useState(null);
  const requete = useQuery({
    queryKey: ['complexe', 'espaces', semaine],
    queryFn: () => chargerEspacesComplexe(semaine),
    placeholderData: keepPreviousData,
  });
  const [etablissement, setEtablissement] = useState(null);
  const [satureesSeules, setSatureesSeules] = useState(false);

  const donnees = requete.data;
  const cartes = donnees?.etablissements ?? [];
  const parSemaine = donnees?.creneauxParSemaine ?? 24;
  const affichee = numeroSemaine(cartes[0]?.semaine);
  const repli = cartes.some((c) => c.repli);

  const salles = useMemo(
    () => cartes.flatMap((c) => c.salles.map((s) => ({ ...s, etablissementId: c.id, etablissement: c.nom }))),
    [cartes]
  );
  const liste = salles.filter(
    (s) => (!etablissement || s.etablissementId === etablissement) && (!satureesSeules || s.taux >= SATUREE)
  );

  const occupes = salles.reduce((s, x) => s + x.creneaux, 0);
  const saturees = salles.filter((s) => s.taux >= SATUREE).length;
  const libres = salles.filter((s) => s.creneaux === 0).length;
  const mutualises = donnees?.mutualises ?? [];

  return (
    <CadreReglage
      large
      titre="Occupation des espaces"
      description={`Créneaux de jour occupés sur ${parSemaine} (6 jours × 4 séances).`}
      chargement={requete.isLoading}
      erreur={requete.isError ? requete.error.message : null}
    >
      {cartes.length === 0 ? (
        <Alerte type="info" titre="Aucun établissement autorisé">
          Les espaces d&apos;un établissement apparaissent ici dès qu&apos;il vous a ouvert son accès.
        </Alerte>
      ) : (
        <>
          {/* La semaine montrée, et de quoi en changer. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Semaine précédente"
              disabled={!affichee || affichee <= 1}
              onClick={() => setSemaine(affichee - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-24 text-center text-sm font-medium tabular-nums">
              {affichee ? `Semaine ${affichee}` : '—'}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Semaine suivante"
              disabled={!affichee || affichee >= 52}
              onClick={() => setSemaine(affichee + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
            {semaine !== null && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSemaine(null)}>
                Revenir à la semaine courante
              </Button>
            )}
            {repli && semaine === null && (
              <span className="text-xs text-muted-foreground">
                La semaine courante (S{numeroSemaine(cartes[0]?.courante)}) n’a pas encore d’emploi du temps : voici la
                dernière remplie.
              </span>
            )}
          </div>

          <GrilleTuiles>
            <Tuile libelle="Salles" valeur={nombre(salles.length)} detail={`${cartes.length} établissement(s)`} />
            <Tuile
              libelle="Occupation moyenne"
              valeur={pourcent(taux(occupes, salles.length * parSemaine))}
              detail="des créneaux de jour"
            />
            <Tuile
              libelle={`Salles saturées (≥ ${SATUREE} %)`}
              valeur={nombre(saturees)}
              detail="candidates à une mutualisation"
              teinte={saturees > 0 ? 'text-destructive' : null}
            />
            <Tuile libelle="Salles inoccupées" valeur={nombre(libres)} detail="aucun créneau cette semaine" />
          </GrilleTuiles>

          <Section titre="Occupation par créneau" precision="Part des salles de l’établissement prises à chaque séance">
            <div className="mt-3 grid gap-5 md:grid-cols-2">
              {cartes.map((c) => (
                <CarteDeChaleur key={c.id} carte={c} jours={donnees.jours} seances={donnees.seances} />
              ))}
            </div>
            <LegendeChaleur />
          </Section>

          <EspacesMutualises mutualises={mutualises} />

          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {cartes.length > 1 &&
                [{ id: null, nom: 'Tous les établissements' }, ...cartes].map((e) => (
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
              <Label className="ml-auto flex items-center gap-2 text-xs font-normal">
                <Switch checked={satureesSeules} onCheckedChange={setSatureesSeules} />
                Saturées seulement
              </Label>
            </div>
            <TableauTriable
              colonnes={colonnesSalles(parSemaine)}
              lignes={liste}
              cleLigne={(s) => `${s.etablissementId}-${s.nom}`}
              vide="Aucune salle ne correspond à ce filtre."
            />
          </section>
        </>
      )}
    </CadreReglage>
  );
}

/** « 2026-W8 » → 8. */
const numeroSemaine = (valeur) => {
  const correspondance = /W(\d+)$/.exec(String(valeur ?? ''));
  return correspondance ? Number(correspondance[1]) : null;
};

const teinteOccupation = (valeur) => (valeur >= SATUREE ? 'bg-destructive' : valeur >= 60 ? 'bg-warning' : 'bg-success');

const colonnesSalles = (parSemaine) => [
  { id: 'salle', entete: 'Salle', tri: (s) => s.nom, rendu: (s) => <span className="text-xs font-medium">{s.nom}</span> },
  {
    id: 'etablissement',
    entete: 'Établissement',
    tri: (s) => s.etablissement,
    rendu: (s) => <span className="text-xs text-muted-foreground">{s.etablissement}</span>,
  },
  {
    id: 'creneaux',
    entete: 'Créneaux',
    aligne: 'droite',
    tri: (s) => s.creneaux,
    rendu: (s) => (
      <span className="text-xs tabular-nums">
        {s.creneaux} / {parSemaine}
      </span>
    ),
  },
  {
    id: 'taux',
    entete: 'Occupation',
    aligne: 'droite',
    tri: (s) => s.taux,
    rendu: (s) => (
      <span className="flex items-center justify-end gap-2">
        <Jauge taux={s.taux} couleur={teinteOccupation(s.taux)} className="w-24" />
        <span className={cn('w-12 text-right text-xs tabular-nums', s.taux >= SATUREE && 'font-medium text-destructive')}>
          {pourcent(s.taux)}
        </span>
      </span>
    ),
  },
];

/**
 * La carte de chaleur d'un établissement : une case par (jour, séance), plus
 * foncée à mesure que ses salles se remplissent. Au survol, le compte exact.
 */
function CarteDeChaleur({ carte, jours, seances }) {
  const total = carte.salles.length;
  return (
    <div>
      <p className="mb-2 flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-medium">{carte.nom}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {total} salle(s) · {pourcent(carte.tauxMoyen)}
        </span>
      </p>
      {total === 0 ? (
        <p className="text-xs text-muted-foreground">Aucun espace déclaré.</p>
      ) : (
        <table className="w-full table-fixed border-separate border-spacing-1 text-[0.65rem]">
          <thead>
            <tr>
              <th className="w-16" />
              {seances.map((s) => (
                <th key={s} className="font-medium text-muted-foreground">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jours.map((jour) => (
              <tr key={jour}>
                <td className="pr-1 text-muted-foreground">{jour.slice(0, 3)}</td>
                {seances.map((seance) => {
                  const prises = carte.grille?.[`${jour}|${seance}`] ?? 0;
                  const part = Math.min(100, Math.round((prises / total) * 100));
                  return (
                    <td
                      key={seance}
                      title={`${jour} ${seance} : ${prises} salle(s) sur ${total} (${part} %)`}
                      className={cn('h-7 rounded text-center tabular-nums', part >= 70 && 'text-white')}
                      style={{ background: couleurChaleur(part) }}
                    >
                      {part > 0 ? `${part}` : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Du gris (vide) au rouge (plein), en passant par l'ambre : la même échelle que les jauges. */
function couleurChaleur(part) {
  if (part === 0) return 'hsl(var(--muted))';
  if (part >= SATUREE) return 'hsl(var(--destructive))';
  if (part >= 60) return `hsl(var(--warning) / ${0.45 + ((part - 60) / 30) * 0.55})`;
  return `hsl(var(--accent-sky) / ${0.2 + (part / 60) * 0.6})`;
}

function LegendeChaleur() {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {[
        ['Libre', 0],
        ['Moins de 60 %', 40],
        ['60 à 90 %', 75],
        [`${SATUREE} % et plus`, 95],
      ].map(([libelle, part]) => (
        <span key={libelle} className="flex items-center gap-1.5">
          <span className="size-3 rounded" style={{ background: couleurChaleur(part) }} />
          {libelle}
        </span>
      ))}
    </div>
  );
}

/**
 * Les salles prêtées entre établissements : chacune, son propriétaire, ses
 * emprunteurs et les créneaux de chacun, puis son occupation RÉELLE — les
 * créneaux de tous réunis.
 */
function EspacesMutualises({ mutualises }) {
  return (
    <Section titre="Espaces mutualisés" precision="Salles prêtées entre établissements — occupation réelle, tous réunis">
      {mutualises.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Aucune salle n’est prêtée entre vos établissements.</p>
      ) : (
        <TableauSection colonnes={['Salle', 'Propriétaire', 'Utilisée par', 'Créneaux réunis', 'Occupation']}>
          {mutualises.map((m) => (
            <tr key={`${m.proprietaire}-${m.espace}`} className="border-b align-top last:border-0">
              <td className={celluleNom}>{m.espace}</td>
              <td className={cellule}>{m.proprietaire}</td>
              <td className={cellule}>
                {m.parEtablissement.map((e) => (
                  <span key={e.nom} className="block">
                    {e.nom}
                    <span className="text-muted-foreground">
                      {' · '}
                      {e.lisible ? `${e.creneaux} créneau(x)` : 'non autorisé'}
                      {e.proprietaire && ' (propriétaire)'}
                    </span>
                  </span>
                ))}
              </td>
              <td className={cellule}>{m.creneaux} / 24</td>
              <td className={cn(cellule, m.taux >= SATUREE && 'font-medium text-destructive')}>{pourcent(m.taux)}</td>
            </tr>
          ))}
        </TableauSection>
      )}
    </Section>
  );
}
