import { useQuery } from '@tanstack/react-query';
import { CalendarOff } from 'lucide-react';
import { ROLES } from 'shared/constants';
import { Badge } from '@/components/ui/badge';
import CadreReglage from '@/features/parametres/CadreReglage';
import FrisePeriodes from '@/features/parametres/FrisePeriodes';
import { chargerMesPeriodes } from './api';

/**
 * « Mes stages » (stagiaire) et « Mes formations » (formateur) — sessions
 * consultatives (2026-10-10, demande du porteur).
 *
 * Les périodes que la direction a déclarées dans Paramètres → Stages /
 * Formations, restreintes par le SERVEUR au compte connecté
 * (`GET /consultation/periodes`) : un stagiaire voit les stages de ses
 * groupes, un formateur ses formations. Lecture seule.
 *
 * La frise est celle de la direction (`FrisePeriodes`), sans glisser ni
 * corbeille — même lecture de l'année, mêmes vacances et fériés. Sous elle, la
 * liste dit chaque période en clair, avec où l'on en est : passée, en cours,
 * à venir.
 */
export default function PageMesPeriodes() {
  const requete = useQuery({ queryKey: ['mes-periodes'], queryFn: chargerMesPeriodes, retry: false });
  const donnees = requete.data;
  const estStagiaire = donnees?.role === ROLES.STAGIAIRE;
  const titre = donnees ? (estStagiaire ? 'Mes stages' : 'Mes formations') : 'Mes périodes';
  const periodes = donnees?.periodes ?? [];

  const libelleDe = (periode) => (estStagiaire ? periode.groupe : periode.nomFormateur || periode.matriculeFormateur);

  // Le format de la frise : un sujet par ligne, ses périodes avec leur rang.
  const parSujet = new Map();
  periodes.forEach((periode, index) => {
    const libelle = libelleDe(periode);
    if (!parSujet.has(libelle)) parSujet.set(libelle, []);
    parSujet.get(libelle).push({ periode, index });
  });
  const groupes = [...parSujet].map(([libelle, entrees]) => ({ libelle, entrees }));

  const aujourdhui = enTexte(new Date());
  const totalJours = periodes.reduce((total, periode) => total + compter(periode), 0);
  const enCours = periodes.find((p) => p.debut <= aujourdhui && aujourdhui <= p.fin);
  const prochaine = periodes.find((p) => p.debut > aujourdhui);

  return (
    <CadreReglage
      titre={titre}
      chargement={requete.isLoading}
      erreur={requete.isError ? requete.error.message : null}
    >
      {donnees && periodes.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <CalendarOff className="h-4 w-4 shrink-0" />
          <span>
            {estStagiaire
              ? 'Aucun stage n’est déclaré pour votre groupe cette année.'
              : 'Aucune formation n’est déclarée à votre nom cette année.'}
          </span>
        </div>
      )}

      {periodes.length > 0 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Tuile libelle="Périodes" valeur={periodes.length} detail={`${totalJours} jour(s) au total`} />
            <Tuile
              libelle="En cours"
              valeur={enCours ? `${afficher(enCours.debut)} → ${afficher(enCours.fin)}` : '—'}
              detail={enCours ? `encore ${compter({ debut: aujourdhui, fin: enCours.fin })} jour(s)` : 'aucune aujourd’hui'}
            />
            <Tuile
              libelle="Prochaine"
              valeur={prochaine ? `${afficher(prochaine.debut)} → ${afficher(prochaine.fin)}` : '—'}
              detail={prochaine ? `dans ${compter({ debut: aujourdhui, fin: prochaine.debut }) - 1} jour(s)` : 'aucune à venir'}
            />
          </div>

          <FrisePeriodes
            groupes={groupes}
            anneeScolaire={donnees.anneeScolaire}
            calendrierFourni={donnees.calendrier}
            feriesFournis={donnees.joursFeries}
          />

          <ul className="divide-y rounded-lg border">
            {periodes.map((periode, index) => {
              const etat = periode.fin < aujourdhui ? 'passee' : periode.debut > aujourdhui ? 'avenir' : 'encours';
              return (
                <li key={`${periode.debut}-${index}`} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium tabular-nums">
                      Du {afficherLong(periode.debut)} au {afficherLong(periode.fin)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {estStagiaire && groupes.length > 1 ? `${periode.groupe} · ` : ''}
                      {compter(periode)} jour(s)
                    </div>
                  </div>
                  {etat === 'encours' && <Badge>En cours</Badge>}
                  {etat === 'avenir' && (
                    <Badge variant="outline" className="border-primary/40 text-primary">
                      À venir
                    </Badge>
                  )}
                  {etat === 'passee' && (
                    <Badge variant="outline" className="text-muted-foreground">
                      Terminée
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-muted-foreground">
            {estStagiaire
              ? 'Pendant un stage, aucune séance n’est placée à votre groupe. Ces dates sont fixées par la direction.'
              : 'Pendant une formation, aucune séance ne vous est placée. Ces dates sont fixées par la direction.'}
          </p>
        </div>
      )}
    </CadreReglage>
  );
}

function Tuile({ libelle, valeur, detail }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{libelle}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{valeur}</div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

/** « AAAA-MM-JJ » en heure LOCALE. */
function enTexte(date) {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}

const afficher = (jour) =>
  new Date(`${jour}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });

const afficherLong = (jour) =>
  new Date(`${jour}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function compter({ debut, fin }) {
  const ecart = new Date(`${fin}T12:00:00`) - new Date(`${debut}T12:00:00`);
  return Math.round(ecart / 86400000) + 1;
}
