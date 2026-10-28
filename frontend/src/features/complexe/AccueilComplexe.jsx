import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Area,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CalendarRange, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Alerte from '@/components/common/Alerte';
import IndicateurChargement from '@/components/ui/indicateur-chargement';
import { recupererSession } from '@/features/auth/api';
import { Salutation } from '@/features/app/AccueilApp';
import { calculerTrajectoire } from '@/features/app/TableauDeBordAccueil';
import { COULEURS_PROGRESSION } from '@/features/avancement/GrapheProgression';
import { definirEtablissementActif, lireEtablissementActif } from '@/lib/etablissementActif';
import { nombre } from '@/lib/nombres';
import { cn } from '@/lib/utils';
import {
  AXE,
  InfoBulle,
  Jauge,
  JaugeTaux,
  Pastille,
  Repere,
  Section,
  TableauSection,
  Tuile,
  cellule,
  celluleNom,
  taux,
} from './composants';
import { chargerAbsencesComplexe, chargerEspacesComplexe, chargerFormateursComplexe, chargerTableauComplexe } from './api';

/**
 * ═══ L'ACCUEIL DU DIRECTEUR DE COMPLEXE (2026-10-27, refonte demandée par le
 * porteur : « ne montre pas des informations utiles et structurées, et le style
 * n'est pas cohérent avec le reste d'EDT Pro ») ═══
 *
 * ⚠️ BÂTI COMME L'ACCUEIL DU DIRECTEUR D'ÉTABLISSEMENT (`TableauDeBordAccueil`) :
 * une colonne centrée, des tuiles simples (libellé, grand chiffre, rouge en
 * alerte) qui OUVRENT leur section au-dessus d'elles — une seule à la fois, la
 * même animation —, puis une section encadrée. Pas de bloc « À traiter »
 * (2026-10-27, demande du porteur) : ce qu'il disait vit dans les sections.
 *
 * ═══ TROIS RANGÉES DE TUILES, QUATRE QUESTIONS ═══ (la proposition validée)
 *   Sommes-nous dans les temps ?           avancement, projection     → la courbe du complexe,
 *                                                                        une ligne par établissement
 *   Les emplois du temps sont-ils prêts ?   publication                → la dernière semaine publiée
 *   Qu'est-ce qui dérape ?                  heures non rattrapées,     → les chiffres par établissement,
 *                                           stagiaires au-delà des       sans aucun nom de stagiaire
 *                                           seuils, modules bientôt terminés
 *   Les ressources sont-elles employées ?   offre, demande, formateurs → les barres par établissement,
 *                                           partagés et salles saturés    les formateurs et les salles
 * Puis « Vos établissements » : un seul tableau, du plus en difficulté au plus avancé.
 *
 * ⚠️ DES CHIFFRES ET DES NOMS DE PERSONNEL, JAMAIS UN NOM DE STAGIAIRE (décision
 * du porteur) — c'est le serveur qui en décide.
 */
export default function AccueilComplexe() {
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const tableau = useQuery({ queryKey: ['complexe', 'tableau'], queryFn: chargerTableauComplexe });
  const absences = useQuery({ queryKey: ['complexe', 'absences'], queryFn: chargerAbsencesComplexe });
  // Les mêmes clés que les pages Formateurs et Espaces du complexe : chargées une fois.
  const formateurs = useQuery({ queryKey: ['complexe', 'formateurs'], queryFn: chargerFormateursComplexe });
  const espaces = useQuery({ queryKey: ['complexe', 'espaces'], queryFn: () => chargerEspacesComplexe() });

  // Une seule section ouverte ; recliquer sa tuile la referme — la règle de l'accueil du directeur.
  const [sectionOuverte, setSectionOuverte] = useState(null);
  const basculer = (cle) => setSectionOuverte((avant) => (avant === cle ? null : cle));

  const cartes = useMemo(() => tableau.data?.etablissements ?? [], [tableau.data]);
  const trajectoire = useMemo(() => trajectoireDuComplexe(cartes), [cartes]);
  const ressources = useMemo(
    () => ressourcesPartagees(formateurs.data, espaces.data),
    [formateurs.data, espaces.data]
  );

  // Ouvrir un établissement : il devient l'établissement ACTIF, et tout repart à neuf.
  const ouvrir = (id, url) => {
    definirEtablissementActif(id);
    window.location.assign(url);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-10 py-4">
      {session.data?.utilisateur && <Salutation nom={session.data.utilisateur.nomComplet} />}

      {tableau.isLoading ? (
        <div className="flex justify-center py-16">
          <IndicateurChargement />
        </div>
      ) : tableau.isError ? (
        <Alerte type="erreur" titre="Tableau de bord indisponible">{tableau.error.message}</Alerte>
      ) : cartes.length === 0 ? (
        <section className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm font-medium">Aucun établissement ne vous a encore ouvert son accès</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Chaque directeur d’établissement de votre complexe vous autorise depuis sa page « Sessions ». Dès
            qu’un établissement l’a fait, il apparaît ici.
          </p>
        </section>
      ) : (
        <>
          {/* La section ouverte AU-DESSUS des tuiles, comme chez le directeur : pas à remonter la page. */}
          {sectionOuverte && (
            <div
              key={sectionOuverte}
              className="duration-300 animate-in fade-in-0 zoom-in-95 slide-in-from-top-3 motion-reduce:animate-none"
            >
              {sectionOuverte === 'avancement' && (
                <SectionAvancement cartes={cartes} trajectoire={trajectoire} onOuvrir={ouvrir} />
              )}
              {sectionOuverte === 'publication' && <SectionPublication cartes={cartes} onOuvrir={ouvrir} />}
              {sectionOuverte === 'rattrapage' && <SectionRattrapage absences={absences.data} />}
              {sectionOuverte === 'seuils' && <SectionSeuils cartes={cartes} />}
              {sectionOuverte === 'modules' && <SectionModules cartes={cartes} onOuvrir={ouvrir} />}
              {sectionOuverte === 'affectation' && <SectionAffectation cartes={cartes} />}
              {sectionOuverte === 'ressources' && (
                <SectionRessources ressources={ressources} chargement={formateurs.isLoading || espaces.isLoading} />
              )}
            </div>
          )}
          <Tuiles
            cartes={cartes}
            trajectoire={trajectoire}
            absences={absences.data}
            ressources={ressources}
            sectionOuverte={sectionOuverte}
            onBasculer={basculer}
          />
          <Etablissements cartes={cartes} actif={lireEtablissementActif()} onOuvrir={ouvrir} />
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════ LES CALCULS ═══════════════════════════════ */

/** « 2026-W8 » → 8. */
const numeroSemaine = (valeur) => {
  const correspondance = /W(\d+)$/.exec(String(valeur ?? ''));
  return correspondance ? Number(correspondance[1]) : null;
};

/** L'emploi du temps de la semaine courante est-il publié ? */
const estPubliee = (c) => !c.semaineCourante || (numeroSemaine(c.publication?.semaine) ?? 0) >= c.semaineCourante;

/** Au-delà de cet écart, la saisie e-note est tenue pour en retard sur l'emploi du temps. */
const ECART_ENOTE = 5;

/** Une salle est saturée à partir de ce taux d'occupation des créneaux de jour. */
const SALLE_SATUREE = 90;

const avecDonnees = (cartes) => cartes.filter((c) => !c.erreur && !c.sansBase);

/** Une teinte par établissement, prise dans la palette décorative — jamais le bleu structurel. */
const TEINTES_ETABLISSEMENTS = [
  'hsl(var(--accent-purple))',
  'hsl(var(--accent-green))',
  'hsl(var(--accent-pink))',
  'hsl(var(--accent-teal))',
  'hsl(var(--accent-brown))',
  'hsl(var(--accent-cyan))',
];
const teinteDe = (rang) => TEINTES_ETABLISSEMENTS[rang % TEINTES_ETABLISSEMENTS.length];

/**
 * La courbe du COMPLEXE : chaque semaine, l'avancement des établissements pondéré
 * par leurs heures prévues — un petit établissement ne pèse pas autant qu'un grand.
 * Puis la trajectoire du directeur (`calculerTrajectoire`) : rythme, projection,
 * nécessaire pour finir. Les courbes des établissements y sont jointes, pour le graphe.
 */
function trajectoireDuComplexe(cartes) {
  const valides = avecDonnees(cartes).filter((c) => (c.progression ?? []).length > 0);
  if (valides.length === 0) return null;

  const courante = Math.max(0, ...valides.map((c) => c.semaineCourante ?? 0)) || null;
  const numeros = [...new Set(valides.flatMap((c) => c.progression.map((p) => p.numero)))].sort((a, b) => a - b);
  const progression = numeros.map((numero) => {
    let pondere = 0;
    let poids = 0;
    const regionaux = [];
    let vacances = true;
    for (const c of valides) {
      const point = c.progression.find((p) => p.numero === numero);
      if (!point) continue;
      if (point.avancement !== null && c.edtpro?.prevu > 0) {
        pondere += point.avancement * c.edtpro.prevu;
        poids += c.edtpro.prevu;
      }
      if (point.regional !== null && point.regional !== undefined) regionaux.push(point.regional);
      vacances = vacances && point.vacances;
    }
    return {
      numero,
      libelle: `S${numero}`,
      avancement: poids > 0 ? Math.round((pondere / poids) * 10) / 10 : null,
      regional: regionaux.length ? Math.round((regionaux.reduce((s, r) => s + r, 0) / regionaux.length) * 10) / 10 : null,
      vacances,
    };
  });

  const trajectoire = calculerTrajectoire(progression, courante);
  // Chaque établissement, sur le même axe — jusqu'à la semaine courante seulement.
  const points = trajectoire.points.map((point, rang) => {
    const numero = numeros[rang];
    const parEtablissement = {};
    for (const c of valides) {
      const p = c.progression.find((x) => x.numero === numero);
      parEtablissement[`e_${c.id}`] = courante !== null && numero <= courante ? (p?.avancement ?? null) : null;
    }
    return { ...point, ...parEtablissement };
  });
  return { ...trajectoire, points, etablissements: valides.map((c) => ({ id: c.id, nom: c.nom })) };
}

/**
 * Les ressources que se partagent les établissements : les formateurs MUTUALISÉS
 * au-delà de leur masse statutaire (charge cumulée sur le complexe), et les
 * salles les plus occupées de la semaine en cours.
 */
function ressourcesPartagees(formateurs, espaces) {
  const enSurcharge = (formateurs?.formateurs ?? [])
    .filter((f) => f.mutualise)
    .map((f) => {
      // La masse statutaire est celle de la PERSONNE : la même d'un établissement à l'autre.
      const masse = Math.max(0, ...f.parEtablissement.map((e) => e.masseHoraire));
      return { ...f, masse, depassement: Math.round((f.heuresAffectees - masse) * 10) / 10 };
    })
    .filter((f) => f.masse > 0 && f.depassement > 0)
    .sort((a, b) => b.depassement - a.depassement);

  const salles = (espaces?.etablissements ?? [])
    .flatMap((e) => e.salles.map((s) => ({ ...s, etablissement: e.nom, libelle: `${s.nom} · ${e.nom}` })))
    .sort((a, b) => b.taux - a.taux);

  return {
    mutualises: (formateurs?.formateurs ?? []).filter((f) => f.mutualise).length,
    enSurcharge,
    salles,
    saturees: salles.filter((s) => s.taux >= SALLE_SATUREE).length,
    semaine: espaces?.etablissements?.[0]?.semaine ?? null,
  };
}

/* ════════════════════════════════ LES TUILES ════════════════════════════════ */

function Tuiles({ cartes, trajectoire, absences, ressources, sectionOuverte, onBasculer }) {
  const valides = avecDonnees(cartes);
  const somme = (lire) => valides.reduce((s, c) => s + (lire(c) ?? 0), 0);

  const actuel = trajectoire?.actuel ?? null;
  const regional = trajectoire?.regional ?? null;
  const ecart = trajectoire?.ecart ?? null;
  const groupes = somme((c) => c.groupes?.total);
  const enRetard = somme((c) => (c.groupes?.enRetard ?? 0) + (c.groupes?.critiques ?? 0));

  const publiees = valides.filter(estPubliee).length;
  const aRattraper = (absences?.etablissements ?? []).reduce((s, a) => s + a.formateurs.aRattraper, 0);
  const auDelaSeuils = somme((c) => Object.values(c.vieScolaire?.seuils ?? {}).reduce((s, n) => s + n, 0));
  const risqueAbandon = somme((c) => c.vieScolaire?.risqueAbandon);
  const bientotTermines = somme((c) => c.modules?.tranches?.bientot);

  const offre = { affecte: somme((c) => c.affectation?.offre.affecte), statutaire: somme((c) => c.affectation?.offre.statutaire) };
  const demande = { couvert: somme((c) => c.affectation?.demande.couvert), total: somme((c) => c.affectation?.demande.total) };
  const nonAffectes = somme((c) => c.affectation?.nonAffectes);
  const surcharges = somme((c) => c.affectation?.surcharges.nombre);

  const proprietes = (cle) => ({ onClick: () => onBasculer(cle), ouvert: sectionOuverte === cle });

  return (
    // Trois par rangée, comme l'accueil du directeur : une rangée par famille de questions.
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {/* Sommes-nous dans les temps ? Les emplois du temps sont-ils prêts ? */}
      <Tuile
        {...proprietes('avancement')}
        libelle="Taux d’avancement"
        valeur={actuel === null ? null : `${nombre(actuel)} %`}
        teinte={ecart === null ? null : ecart < 0 ? 'text-destructive' : 'text-success'}
        detail={ecart === null ? null : `${ecart > 0 ? '+' : ''}${nombre(ecart)} pt face au régional · ${enRetard}/${groupes} groupes en retard`}
        extra={
          // Le régional reste neutre : c'est la référence, pas une mesure du complexe.
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Taux régional</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-muted-foreground">
              {regional === null ? '—' : `${nombre(regional)} %`}
            </p>
          </div>
        }
      />
      <Tuile
        {...proprietes('avancement')}
        libelle="Projection en S39"
        valeur={trajectoire?.fin === null || trajectoire?.fin === undefined ? null : `${nombre(trajectoire.fin)} %`}
        teinte={trajectoire?.fin !== null && trajectoire?.fin !== undefined && trajectoire.fin < 100 ? 'text-destructive' : null}
        detail={trajectoire?.fin === null || !trajectoire ? 'Trop tôt pour projeter' : 'au rythme des 4 dernières semaines'}
      />
      <Tuile
        {...proprietes('publication')}
        libelle="Emplois du temps à jour"
        valeur={`${publiees} / ${valides.length}`}
        detail="semaine courante publiée"
        teinte={publiees < valides.length ? 'text-destructive' : null}
      />

      {/* Qu'est-ce qui dérape ? */}
      <Tuile
        {...proprietes('rattrapage')}
        libelle="Absences formateurs à rattraper"
        valeur={absences ? nombre(aRattraper) : null}
        detail="sur l’année, tous établissements"
        teinte={aRattraper > 0 ? 'text-destructive' : null}
      />
      <Tuile
        {...proprietes('seuils')}
        libelle="Stagiaires au-delà des seuils"
        valeur={nombre(auDelaSeuils)}
        detail={`${nombre(risqueAbandon)} absent(s) 3 jours de suite ou plus`}
        teinte={auDelaSeuils > 0 ? 'text-destructive' : null}
      />
      <Tuile
        {...proprietes('modules')}
        libelle="Modules bientôt terminés"
        valeur={nombre(bientotTermines)}
        detail="réalisés à 80 % ou plus — EFM à préparer"
      />

      {/* Les ressources sont-elles bien employées ? */}
      <Tuile
        {...proprietes('affectation')}
        libelle="Offre · affecté / statutaire"
        valeur={`${nombre(offre.affecte)} h / ${nombre(offre.statutaire)} h`}
        petit
        extraBas={<JaugeTaux taux={taux(offre.affecte, offre.statutaire)} />}
        detail={surcharges > 0 ? `${nombre(surcharges)} formateur(s) en dépassement` : null}
      />
      <Tuile
        {...proprietes('affectation')}
        libelle="Demande · couvert / total"
        valeur={`${nombre(demande.couvert)} h / ${nombre(demande.total)} h`}
        petit
        extraBas={<JaugeTaux taux={taux(demande.couvert, demande.total)} />}
        detail={nonAffectes > 0 ? `${nombre(nonAffectes)} module(s) sans formateur` : null}
      />
      <Tuile
        {...proprietes('ressources')}
        libelle="Ressources partagées"
        valeur={`${nombre(ressources.enSurcharge.length)} · ${nombre(ressources.saturees)}`}
        detail={`formateur(s) partagé(s) en surcharge · salle(s) saturée(s)`}
        teinte={ressources.enSurcharge.length > 0 || ressources.saturees > 0 ? 'text-destructive' : null}
      />
    </section>
  );
}

/* ═══════════════════════════════ LES SECTIONS ═══════════════════════════════ */

function BoutonVoir({ onClick }) {
  return (
    <td className="py-2.5 text-right">
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-primary" onClick={onClick}>
        Voir
      </Button>
    </td>
  );
}

/**
 * Sommes-nous dans les temps ? — LA COURBE DU COMPLEXE (la trajectoire du
 * directeur : avancement, projection, régional), une ligne fine par
 * établissement, puis l'écart de chacun au régional.
 */
function SectionAvancement({ cartes, trajectoire, onOuvrir }) {
  const lignes = [...avecDonnees(cartes)].sort((a, b) => ecartAuRegional(a) - ecartAuRegional(b));
  const rangDe = new Map((trajectoire?.etablissements ?? []).map((e, rang) => [e.id, rang]));

  return (
    <Section titre="Trajectoire du complexe" precision="Avancement eDTpro pondéré par les heures prévues">
      {trajectoire && (
        <>
          <p className="mt-0.5 text-xs">
            {trajectoire.rythme === null ? (
              <span className="text-muted-foreground">La projection apparaîtra après les premières semaines de cours.</span>
            ) : (
              <>
                <span className="text-muted-foreground">Rythme actuel : </span>
                <span className="font-medium tabular-nums">{nombre(trajectoire.rythme)} pt / semaine</span>
                <span className="text-muted-foreground"> · nécessaire pour finir : </span>
                <span
                  className={cn(
                    'font-medium tabular-nums',
                    trajectoire.necessaire > trajectoire.rythme ? 'text-destructive' : 'text-success'
                  )}
                >
                  {nombre(trajectoire.necessaire)} pt / semaine
                </span>
              </>
            )}
          </p>
          <div className="mt-3 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trajectoire.points} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                <XAxis dataKey="libelle" tickLine={false} axisLine={false} interval={3} tick={AXE} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={AXE} tickFormatter={(v) => `${v} %`} />
                <Tooltip content={<InfoBulle />} />
                <Area
                  type="monotone"
                  dataKey="avancement"
                  name="Complexe"
                  stroke={COULEURS_PROGRESSION.avancement}
                  fill={COULEURS_PROGRESSION.avancement}
                  fillOpacity={0.12}
                  strokeWidth={2.5}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="projection"
                  name="Projection"
                  stroke={COULEURS_PROGRESSION.avancement}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="regional"
                  name="Rythme régional"
                  stroke={COULEURS_PROGRESSION.regional}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                {trajectoire.etablissements.map((e, rang) => (
                  <Line
                    key={e.id}
                    type="monotone"
                    dataKey={`e_${e.id}`}
                    name={e.nom}
                    stroke={teinteDe(rang)}
                    strokeWidth={1.25}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs">
            <Repere couleur={COULEURS_PROGRESSION.avancement} libelle="Complexe" />
            <Repere couleur={COULEURS_PROGRESSION.avancement} libelle="Projection" pointille />
            <Repere couleur={COULEURS_PROGRESSION.regional} libelle="Rythme régional" />
            {trajectoire.etablissements.map((e, rang) => (
              <Repere key={e.id} couleur={teinteDe(rang)} libelle={e.nom} />
            ))}
          </div>
        </>
      )}

      <TableauSection colonnes={['Établissement', 'eDTpro', 'Écart régional', 'Critiques', 'En retard', 'e-note', '']}>
        {lignes.map((c) => {
          const ecart = ecartAuRegional(c);
          const ecartEnote = c.enote && c.edtpro?.taux !== null ? c.edtpro.taux - (c.enote.taux ?? 0) : null;
          return (
            <tr key={c.id} className="border-b last:border-0">
              <td className={celluleNom}>
                <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: teinteDe(rangDe.get(c.id) ?? 0) }} />
                {c.nom}
              </td>
              <td className={cn(cellule, 'font-semibold')}>{c.edtpro?.taux === null ? '—' : `${nombre(c.edtpro.taux)} %`}</td>
              <td className={cn(cellule, ecart !== Infinity && (ecart < 0 ? 'text-destructive' : 'text-success'))}>
                {ecart === Infinity ? '—' : `${ecart > 0 ? '+' : ''}${nombre(Math.round(ecart * 10) / 10)} pt`}
              </td>
              <td className={cn(cellule, c.groupes?.critiques > 0 && 'font-medium text-destructive')}>{c.groupes?.critiques ?? 0}</td>
              <td className={cn(cellule, c.groupes?.enRetard > 0 && 'text-warning')}>{c.groupes?.enRetard ?? 0}</td>
              <td className={cn(cellule, ecartEnote !== null && ecartEnote > ECART_ENOTE && 'font-medium text-warning')}>
                {c.enote ? `${nombre(c.enote.taux)} %` : 'non importé'}
              </td>
              <BoutonVoir onClick={() => onOuvrir(c.id, '/app/avancement')} />
            </tr>
          );
        })}
      </TableauSection>
      <p className="mt-2 text-[0.65rem] text-muted-foreground">
        Critique : plus de 10 points sous le régional · en retard : entre 2 et 10 · e-note en orange quand la saisie a
        plus de {ECART_ENOTE} points de retard sur l’emploi du temps.
      </p>
    </Section>
  );
}

/** Les emplois du temps sont-ils prêts ? — la dernière semaine publiée de chacun. */
function SectionPublication({ cartes, onOuvrir }) {
  const lignes = [...avecDonnees(cartes)].sort((a, b) => Number(estPubliee(a)) - Number(estPubliee(b)));
  return (
    <Section titre="Publication des emplois du temps" precision="La semaine courante doit être publiée">
      <TableauSection colonnes={['Établissement', 'Semaine courante', 'Dernière publiée', 'Publiée le', '']}>
        {lignes.map((c) => {
          const publiee = numeroSemaine(c.publication?.semaine);
          return (
            <tr key={c.id} className="border-b last:border-0">
              <td className={celluleNom}>{c.nom}</td>
              <td className={cellule}>{c.semaineCourante ? `S${c.semaineCourante}` : '—'}</td>
              <td className={cn(cellule, !estPubliee(c) && 'font-medium text-destructive')}>
                {publiee === null ? 'aucune' : `S${publiee}`}
              </td>
              <td className={cn(cellule, 'text-muted-foreground')}>
                {c.publication?.publieeLe ? new Date(c.publication.publieeLe).toLocaleDateString('fr-FR') : '—'}
              </td>
              <BoutonVoir onClick={() => onOuvrir(c.id, '/app/edition')} />
            </tr>
          );
        })}
      </TableauSection>
    </Section>
  );
}

/** Les familles de la grille d'assiduité, dans l'ordre et les teintes de `BadgeSanction`. */
const PALIERS = [
  { cle: 'mise-en-garde', libelle: 'Mise en garde', couleur: 'hsl(var(--warning))' },
  { cle: 'avertissement', libelle: 'Avertissement', couleur: 'hsl(var(--accent-orange))' },
  { cle: 'blame', libelle: 'Blâme', couleur: 'hsl(var(--destructive) / 0.6)' },
  { cle: 'exclusion', libelle: 'Exclusion', couleur: 'hsl(var(--destructive))' },
];

/** Des barres horizontales empilées, un établissement par barre — le gabarit des trois sections. */
function BarresEmpilees({ donnees, series, hauteurBarre = 44, legende = true, onChoisir }) {
  // ⚠️ UN SEUL BLOC : posé dans une grille (à côté de l'anneau), la légende doit rester sous SES barres.
  return (
    <div className="min-w-0">
      <div className="mt-3" style={{ height: donnees.length * hauteurBarre + 24 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={donnees} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
            <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={AXE} />
            <YAxis type="category" dataKey="nom" width={130} tickLine={false} axisLine={false} tick={AXE} />
            <Tooltip content={<InfoBulle suffixe="" />} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
            {series.map((serie, rang) => (
              <Bar
                key={serie.cle}
                dataKey={serie.cle}
                name={serie.libelle}
                stackId="pile"
                fill={serie.couleur}
                cursor={onChoisir ? 'pointer' : undefined}
                onClick={onChoisir ? () => onChoisir(serie.cle) : undefined}
                barSize={20}
                radius={rang === series.length - 1 ? [0, 4, 4, 0] : undefined}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {legende && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs">
          {series.map((serie) => (
            <Pastille key={serie.cle} couleur={serie.couleur} libelle={serie.libelle} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Les absences de formateurs : rattrapées ou non, établissement par
 * établissement. Une absence non rattrapée, ce sont des heures que les groupes
 * n'auront pas.
 */
function SectionRattrapage({ absences }) {
  if (!absences) {
    return (
      <Section titre="Absences des formateurs">
        <p className="mt-3 text-sm text-muted-foreground">Chargement…</p>
      </Section>
    );
  }
  const lignes = [...absences.etablissements].sort((a, b) => b.formateurs.aRattraper - a.formateurs.aRattraper);
  const donnees = lignes.map((a) => ({ nom: a.nom, rattrapees: a.formateurs.rattrapees, aRattraper: a.formateurs.aRattraper }));
  const total = lignes.reduce((s, a) => s + a.formateurs.annee, 0);
  const rattrapees = lignes.reduce((s, a) => s + a.formateurs.rattrapees, 0);

  return (
    <Section
      titre="Absences des formateurs"
      precision={total > 0 ? `${nombre(taux(rattrapees, total))} % rattrapées sur l’année` : 'Aucune absence cette année'}
    >
      <BarresEmpilees
        donnees={donnees}
        series={[
          { cle: 'rattrapees', libelle: 'Rattrapées', couleur: 'hsl(var(--success))' },
          { cle: 'aRattraper', libelle: 'À rattraper', couleur: 'hsl(var(--destructive))' },
        ]}
      />
      <TableauSection colonnes={['Établissement', 'Absences', 'Rattrapées', 'À rattraper', '30 derniers jours']}>
        {lignes.map((a) => (
          <tr key={a.id} className="border-b last:border-0">
            <td className={celluleNom}>{a.nom}</td>
            <td className={cellule}>{nombre(a.formateurs.annee)}</td>
            <td className={cn(cellule, 'text-success')}>{nombre(a.formateurs.rattrapees)}</td>
            <td className={cn(cellule, a.formateurs.aRattraper > 0 && 'font-medium text-destructive')}>
              {nombre(a.formateurs.aRattraper)}
            </td>
            <td className={cellule}>{nombre(a.formateurs.trenteJours)}</td>
          </tr>
        ))}
      </TableauSection>
    </Section>
  );
}

/**
 * Les stagiaires au-delà des seuils de la grille d'assiduité : l'anneau du
 * complexe par palier, puis chaque établissement en barres empilées, avec ceux
 * absents trois jours de suite ou plus.
 * ⚠️ AUCUN NOM DE STAGIAIRE : des comptes, la décision du porteur.
 */
function SectionSeuils({ cartes }) {
  const lignes = avecDonnees(cartes);
  const donnees = lignes.map((c) => ({ nom: c.nom, ...(c.vieScolaire?.seuils ?? {}) }));
  const parPalier = PALIERS.map((palier) => ({
    ...palier,
    valeur: lignes.reduce((s, c) => s + (c.vieScolaire?.seuils?.[palier.cle] ?? 0), 0),
  }));
  const total = parPalier.reduce((s, p) => s + p.valeur, 0);

  return (
    <Section titre="Stagiaires au-delà des seuils d’assiduité" precision="Absences et retards non justifiés — aucun nom">
      {total === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Aucun stagiaire n’a atteint le premier palier de la grille.</p>
      ) : (
        <div className="mt-3 grid items-center gap-4 sm:grid-cols-[11rem_1fr]">
          {/* L'anneau du complexe : la part de chaque palier, le total au centre. */}
          <div className="relative mx-auto size-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={parPalier.filter((p) => p.valeur > 0)}
                  dataKey="valeur"
                  nameKey="libelle"
                  innerRadius="62%"
                  outerRadius="100%"
                  stroke="none"
                  isAnimationActive={false}
                >
                  {parPalier
                    .filter((p) => p.valeur > 0)
                    .map((p) => (
                      <Cell key={p.cle} fill={p.couleur} />
                    ))}
                </Pie>
                <Tooltip content={<InfoBulleSecteur />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-semibold tabular-nums">{nombre(total)}</span>
              <span className="text-[0.65rem] text-muted-foreground">stagiaires</span>
            </div>
          </div>
          <BarresEmpilees donnees={donnees} series={PALIERS} hauteurBarre={36} />
        </div>
      )}

      <TableauSection colonnes={['Établissement', ...PALIERS.map((p) => p.libelle), 'Absent 3 j de suite']}>
        {lignes.map((c) => (
          <tr key={c.id} className="border-b last:border-0">
            <td className={celluleNom}>{c.nom}</td>
            {PALIERS.map((p) => (
              <td key={p.cle} className={cellule}>
                {nombre(c.vieScolaire?.seuils?.[p.cle] ?? 0)}
              </td>
            ))}
            <td className={cn(cellule, c.vieScolaire?.risqueAbandon > 0 && 'font-medium text-destructive')}>
              {nombre(c.vieScolaire?.risqueAbandon ?? 0)}
            </td>
          </tr>
        ))}
      </TableauSection>
    </Section>
  );
}

function InfoBulleSecteur({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      {name} : <span className="tabular-nums">{nombre(value)}</span>
    </div>
  );
}

/** Les tranches d'avancement d'un module, du moins au plus avancé. */
const TRANCHES = [
  { cle: 'nonCommence', libelle: 'Pas commencé', couleur: 'hsl(var(--muted-foreground) / 0.35)' },
  { cle: 'debut', libelle: 'Moins de 50 %', couleur: 'hsl(var(--accent-sky) / 0.55)' },
  { cle: 'milieu', libelle: '50 à 80 %', couleur: 'hsl(var(--accent-sky))' },
  { cle: 'bientot', libelle: 'Bientôt terminé (80 % et plus)', couleur: 'hsl(var(--accent-orange))' },
  { cle: 'acheve', libelle: 'Achevé', couleur: 'hsl(var(--success))' },
];

/**
 * L'avancement des modules : où en sont TOUS les modules de chaque
 * établissement (une barre empilée par tranche), puis la LISTE des modules de
 * la tranche choisie (2026-10-27, demande du porteur : « je veux lister »).
 *
 * ⚠️ LA TRANCHE SE CHOISIT PAR SES BOUTONS — qui servent aussi de légende — ou
 * en cliquant un segment de barre. Par défaut, « bientôt terminé » (les EFM à
 * préparer), sinon la tranche la plus avancée qui contient un module.
 */
const PREFERENCE_TRANCHES = ['bientot', 'acheve', 'milieu', 'debut', 'nonCommence'];

function SectionModules({ cartes, onOuvrir }) {
  const lignes = avecDonnees(cartes);
  const donnees = lignes.map((c) => ({ nom: c.nom, ...(c.modules?.tranches ?? {}) }));
  const totaux = Object.fromEntries(
    TRANCHES.map((t) => [t.cle, lignes.reduce((s, c) => s + (c.modules?.tranches?.[t.cle] ?? 0), 0)])
  );
  const [choisie, setChoisie] = useState(() => PREFERENCE_TRANCHES.find((cle) => totaux[cle] > 0) ?? 'bientot');
  const [recherche, setRecherche] = useState('');

  const motif = recherche.trim().toLowerCase();
  const modules = lignes
    .flatMap((c) => (c.modules?.liste ?? []).map((m) => ({ ...m, etablissement: c.nom, id: c.id })))
    .filter((m) => m.tranche === choisie)
    .filter((m) => motif === '' || `${m.etablissement} ${m.groupe} ${m.module} ${m.intitule}`.toLowerCase().includes(motif))
    .sort((a, b) => b.taux - a.taux || a.etablissement.localeCompare(b.etablissement, 'fr'));
  const tranche = TRANCHES.find((t) => t.cle === choisie);

  return (
    <Section titre="Avancement des modules" precision="Chaque module de chaque groupe, selon ses heures réalisées">
      <BarresEmpilees donnees={donnees} series={TRANCHES} legende={false} onChoisir={setChoisie} />

      {/* Les tranches : légende ET sélecteur de la liste. */}
      <div className="mt-2 flex flex-wrap justify-center gap-1.5">
        {TRANCHES.map((t) => (
          <Button
            key={t.cle}
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={choisie === t.cle}
            onClick={() => setChoisie(t.cle)}
            className={cn('h-7 gap-1.5 px-2 text-xs', choisie === t.cle && 'border-primary bg-primary/5')}
          >
            <span className="size-2 rounded-full" style={{ background: t.couleur }} />
            {t.libelle}
            <span className="tabular-nums text-muted-foreground">{nombre(totaux[t.cle])}</span>
          </Button>
        ))}
      </div>

      <div className="mt-4 border-t pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium">
            {tranche.libelle}{' '}
            <span className="font-normal text-muted-foreground">
              · {nombre(modules.length)} module(s)
              {choisie === 'bientot' && ' — leur EFM est à préparer'}
            </span>
          </p>
          <Input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Groupe, module, établissement…"
            className="h-8 w-56 text-xs"
          />
        </div>

        {modules.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {motif ? 'Aucun module ne correspond à cette recherche.' : 'Aucun module dans cette tranche.'}
          </p>
        ) : (
          <div className="mt-2 max-h-96 overflow-y-auto rounded-md border scrollbar-fine">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Établissement</th>
                  <th className="py-2 pr-3 font-medium">Groupe</th>
                  <th className="py-2 pr-3 font-medium">Module</th>
                  <th className="py-2 pr-3 text-right font-medium">Heures</th>
                  <th className="py-2 pr-3 text-right font-medium">Taux</th>
                  <th className="py-2 pr-2" />
                </tr>
              </thead>
              <tbody>
                {modules.map((m) => (
                  <tr key={`${m.id}-${m.groupe}-${m.module}`} className="border-b last:border-0">
                    <td className="max-w-40 truncate px-3 py-1.5 text-muted-foreground">{m.etablissement}</td>
                    <td className="py-1.5 pr-3 font-medium">{m.groupe}</td>
                    <td className="max-w-72 truncate py-1.5 pr-3" title={m.intitule || undefined}>
                      {m.module}
                      {m.intitule && <span className="text-muted-foreground"> — {m.intitule}</span>}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {nombre(m.realise)} / {nombre(m.prevu)} h
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium tabular-nums">{nombre(m.taux)} %</td>
                    <td className="py-1.5 pr-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-primary"
                        onClick={() => onOuvrir(m.id, '/app/avancement')}
                      >
                        Voir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}

/**
 * Les ressources sont-elles bien employées ? — l'offre et la demande de la page
 * Affectation en barres, établissement par établissement (100 % = l'équilibre),
 * le tableau, et qui est en dépassement.
 */
function SectionAffectation({ cartes }) {
  const lignes = [...avecDonnees(cartes)].sort(
    (a, b) => (a.affectation?.demande.taux ?? 100) - (b.affectation?.demande.taux ?? 100)
  );
  const enDepassement = lignes.filter((c) => c.affectation?.surcharges.nombre > 0);
  const donnees = lignes.map((c) => ({ nom: c.nom, offre: c.affectation?.offre.taux ?? null, demande: c.affectation?.demande.taux ?? null }));

  return (
    <Section titre="Affectation par établissement" precision="Offre : affecté / statutaire · Demande : couvert / total">
      <div className="mt-3 h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={donnees} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="nom" tickLine={false} axisLine={false} tick={AXE} interval={0} />
            <YAxis tickLine={false} axisLine={false} tick={AXE} tickFormatter={(v) => `${v} %`} />
            <Tooltip content={<InfoBulle />} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
            {/* 100 % : l'équilibre — l'offre au-delà est un dépassement, la demande en deçà un manque. */}
            <ReferenceLine y={100} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
            <Bar dataKey="offre" name="Offre" fill={COULEURS_PROGRESSION.regional} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
              {donnees.map((d) => (
                <Cell key={d.nom} fill={d.offre > 100 ? 'hsl(var(--destructive))' : COULEURS_PROGRESSION.regional} />
              ))}
            </Bar>
            <Bar dataKey="demande" name="Demande" fill={COULEURS_PROGRESSION.avancement} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <TableauSection colonnes={['Établissement', 'Offre', 'Demande', 'Non affectés', 'Dépassements']}>
        {lignes.map((c) => {
          const a = c.affectation;
          return (
            <tr key={c.id} className="border-b last:border-0">
              <td className={celluleNom}>{c.nom}</td>
              <td className={cn(cellule, a?.offre.taux > 100 && 'font-medium text-destructive')}>
                {a ? `${nombre(a.offre.affecte)} / ${nombre(a.offre.statutaire)} h · ${a.offre.taux} %` : '—'}
              </td>
              <td className={cn(cellule, a && a.demande.taux < 100 && 'text-warning')}>
                {a ? `${nombre(a.demande.couvert)} / ${nombre(a.demande.total)} h · ${a.demande.taux} %` : '—'}
              </td>
              <td className={cn(cellule, a?.nonAffectes > 0 && 'font-medium text-warning')}>{a ? nombre(a.nonAffectes) : '—'}</td>
              <td className={cn(cellule, a?.surcharges.nombre > 0 && 'font-medium text-destructive')}>
                {a ? nombre(a.surcharges.nombre) : '—'}
              </td>
            </tr>
          );
        })}
      </TableauSection>

      {/* Qui dépasse sa masse statutaire — des noms de personnel, comme sur la page Affectation. */}
      {enDepassement.length > 0 && (
        <div className="mt-4 space-y-2 border-t pt-3">
          <p className="text-xs font-medium">Formateurs au-delà de leur masse statutaire</p>
          {enDepassement.map((c) => (
            <p key={c.id} className="text-xs">
              <span className="font-medium">{c.nom}</span>
              <span className="text-muted-foreground">
                {' · '}
                {c.affectation.surcharges.noms.map((f) => `${f.nom} (+${nombre(f.depassement)} h)`).join(', ')}
                {c.affectation.surcharges.nombre > c.affectation.surcharges.noms.length &&
                  ` et ${c.affectation.surcharges.nombre - c.affectation.surcharges.noms.length} autre(s)`}
              </span>
            </p>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Au-delà, les salles se lisent dans la page Espaces du complexe. */
const SALLES_MONTREES = 12;

/**
 * Les ressources que se partagent les établissements — les salles les plus
 * occupées de la semaine (barres, rouges dès la saturation), puis les formateurs
 * partagés au-delà de leur masse statutaire, charge cumulée sur le complexe.
 */
function SectionRessources({ ressources, chargement }) {
  if (chargement) {
    return (
      <Section titre="Ressources partagées">
        <p className="mt-3 text-sm text-muted-foreground">Chargement…</p>
      </Section>
    );
  }
  const salles = ressources.salles.slice(0, SALLES_MONTREES);

  return (
    <Section
      titre="Ressources partagées"
      precision={ressources.semaine ? `Occupation des salles en ${ressources.semaine.replace(/^\d+-W/, 'S')}` : null}
    >
      <p className="mt-3 text-xs font-medium">Les {salles.length} salles les plus occupées (créneaux de jour)</p>
      <div className="mt-2" style={{ height: salles.length * 26 + 24 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={salles} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis type="category" dataKey="libelle" width={170} tickLine={false} axisLine={false} tick={{ ...AXE, fontSize: 10 }} />
            <Tooltip content={<InfoBulle />} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
            <ReferenceLine x={SALLE_SATUREE} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
            <Bar
              dataKey="taux"
              name="Occupation"
              barSize={14}
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
              label={{ position: 'right', fontSize: 10, fill: 'hsl(var(--muted-foreground))', formatter: (v) => `${nombre(v)} %` }}
            >
              {salles.map((s) => (
                <Cell key={s.libelle} fill={s.taux >= SALLE_SATUREE ? 'hsl(var(--destructive))' : COULEURS_PROGRESSION.regional} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[0.65rem] text-muted-foreground">Saturée à partir de {SALLE_SATUREE} % des 24 créneaux de jour.</p>

      <div className="mt-4 border-t pt-3">
        <p className="text-xs font-medium">
          Formateurs partagés au-delà de leur masse statutaire{' '}
          <span className="font-normal text-muted-foreground">
            · {nombre(ressources.enSurcharge.length)} sur {nombre(ressources.mutualises)} partagés
          </span>
        </p>
        {ressources.enSurcharge.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Aucun formateur partagé ne dépasse sa masse statutaire.</p>
        ) : (
          <ul className="mt-2 divide-y">
            {ressources.enSurcharge.map((f) => (
              <li key={f.cle} className="flex items-center gap-3 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium">{f.nomComplet}</span>
                <span className="hidden min-w-0 truncate text-muted-foreground sm:block">
                  {f.parEtablissement.map((e) => `${e.etablissement} ${nombre(e.heuresAffectees)} h`).join(' · ')}
                </span>
                <span className="shrink-0 tabular-nums">
                  {nombre(f.heuresAffectees)} / {nombre(f.masse)} h
                </span>
                <span className="w-16 shrink-0 text-right font-medium tabular-nums text-destructive">+{nombre(f.depassement)} h</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

/* ══════════════════════════ JAUGE ET ÉTABLISSEMENTS ══════════════════════════ */

/* ═══════════════════════════ LES ÉTABLISSEMENTS ═══════════════════════════ */

/** L'écart au régional, du plus en difficulté au plus avancé ; sans donnée, en fin de liste. */
const ecartAuRegional = (c) =>
  c.edtpro?.taux !== null && c.edtpro?.taux !== undefined && c.regional !== null && c.regional !== undefined
    ? c.edtpro.taux - c.regional
    : Infinity;

function Etablissements({ cartes, actif, onOuvrir }) {
  const lignes = [...cartes].sort((a, b) => ecartAuRegional(a) - ecartAuRegional(b) || a.nom.localeCompare(b.nom, 'fr'));

  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium">Vos établissements</h2>
        <p className="text-xs text-muted-foreground">Du plus en difficulté au plus avancé, face au rythme régional</p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[46rem] text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Établissement</th>
              <th className="w-44 py-2 pr-3 font-medium">Avancement</th>
              <th className="py-2 pr-3 text-right font-medium">Groupes en retard</th>
              <th className="py-2 pr-3 text-right font-medium">Demande couverte</th>
              <th className="py-2 pr-3 text-right font-medium">Non affectés</th>
              <th className="py-2 pr-3 text-right font-medium">Dépassements</th>
              <th className="py-2 pr-3 text-right font-medium">Publiée</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {lignes.map((c) => (
              <LigneEtablissement key={c.id} carte={c} ouvert={actif === c.id} onOuvrir={onOuvrir} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LigneEtablissement({ carte: c, ouvert, onOuvrir }) {
  const nom = (
    <td className="max-w-56 py-2.5 pr-3">
      <span className="block truncate font-medium" title={c.nom}>
        {c.nom}
      </span>
      {ouvert && <span className="text-[0.65rem] text-primary">Établissement ouvert</span>}
    </td>
  );

  if (c.sansBase || c.erreur) {
    return (
      <tr className="border-b last:border-0">
        {nom}
        <td colSpan={6} className="py-2.5 pr-3 text-muted-foreground">
          {c.sansBase ? 'Aucune base importée pour cette année' : 'Données momentanément indisponibles'}
        </td>
        <td />
      </tr>
    );
  }

  const ecart = ecartAuRegional(c);
  const retard = (c.groupes?.enRetard ?? 0) + (c.groupes?.critiques ?? 0);
  const a = c.affectation;
  const publiee = numeroSemaine(c.publication?.semaine);

  return (
    <tr className="border-b align-middle last:border-0">
      {nom}
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-2">
          <Jauge
            taux={c.edtpro?.taux}
            couleur={ecart === Infinity ? 'bg-muted-foreground/40' : ecart < -10 ? 'bg-destructive' : ecart < -2 ? 'bg-warning' : 'bg-success'}
            className="flex-1"
          />
          <span className="w-12 text-right font-semibold tabular-nums">
            {c.edtpro?.taux === null ? '—' : `${nombre(c.edtpro.taux)} %`}
          </span>
        </div>
        {ecart !== Infinity && (
          <span className={cn('text-[0.65rem] tabular-nums', ecart < 0 ? 'text-destructive' : 'text-success')}>
            {ecart > 0 ? '+' : ''}
            {nombre(Math.round(ecart * 10) / 10)} pt · régional {nombre(c.regional)} %
          </span>
        )}
      </td>
      <td className={cn('py-2.5 pr-3 text-right tabular-nums', retard > 0 && 'font-medium text-destructive')}>
        {retard} / {c.groupes?.total ?? 0}
      </td>
      <td className={cn('py-2.5 pr-3 text-right tabular-nums', a && a.demande.taux < 100 && 'text-warning')}>
        {a ? `${nombre(a.demande.taux)} %` : '—'}
      </td>
      <td className={cn('py-2.5 pr-3 text-right tabular-nums', a?.nonAffectes > 0 && 'font-medium text-warning')}>
        {a ? nombre(a.nonAffectes) : '—'}
      </td>
      <td className={cn('py-2.5 pr-3 text-right tabular-nums', a?.surcharges.nombre > 0 && 'font-medium text-destructive')}>
        {a ? nombre(a.surcharges.nombre) : '—'}
      </td>
      <td
        className={cn(
          'py-2.5 pr-3 text-right tabular-nums',
          c.semaineCourante && (publiee ?? 0) < c.semaineCourante && 'text-warning'
        )}
      >
        {publiee === null ? '—' : `S${publiee}`}
      </td>
      <td className="py-2.5 text-right">
        <span className="inline-flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Ouvrir son emploi du temps"
            aria-label={`Ouvrir l’emploi du temps de ${c.nom}`}
            onClick={() => onOuvrir(c.id, '/app/edition')}
          >
            <CalendarRange className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Ouvrir son avancement"
            aria-label={`Ouvrir l’avancement de ${c.nom}`}
            onClick={() => onOuvrir(c.id, '/app/avancement')}
          >
            <TrendingUp className="size-3.5" />
          </Button>
        </span>
      </td>
    </tr>
  );
}
