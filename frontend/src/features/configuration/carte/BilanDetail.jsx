import { useEffect, useRef } from 'react';
import { GraduationCap, UserPlus, UserRoundCheck, UserRoundX } from 'lucide-react';
import TableauTriable from '@/components/common/TableauTriable';
import { cn } from '@/lib/utils';

/**
 * Détail de la charge, en quatre sections.
 * ← `renderBilanModal()` de affectation-carte.js:2801-2925
 *
 * ═══ POURQUOI QUATRE SECTIONS ET NON DEUX ONGLETS ═══
 * Ma première version résumait tout en « par métier » / « par formateur ». Elle
 * répondait à « où en suis-je ? » mais pas à la question que le directeur se
 * pose réellement devant cet écran : « à QUI puis-je confier les heures qui
 * restent ? ». Les quatre sections de l'existant se lisent dans cet ordre :
 *   1. ce qu'il reste à couvrir (le besoin),
 *   2. qui a encore des heures (les sous-affectés),
 *   3. qui n'en a plus (les surchargés),
 *   4. la demande dans son ensemble.
 * Elles sont toutes montées en même temps et la modale défile jusqu'à celle
 * qu'on a demandée — on peut donc comparer 1 et 2 en faisant défiler, ce qu'un
 * jeu d'onglets interdit.
 */
export default function BilanDetail({ bilan, section }) {
  const besoinRef = useRef(null);
  const demandeRef = useRef(null);

  // La tuile cliquée décide de la section amenée à l'écran.
  // ← `affBilanOnglet === 'demande' ? sections[dernière] : sections[0]`
  useEffect(() => {
    const cible = section === 'demande' ? demandeRef.current : besoinRef.current;
    cible?.scrollIntoView({ block: 'start' });
  }, [section]);

  const { reconciliation: reconc } = bilan;
  const modulesNonCouverts = bilan.metiers.reduce((somme, m) => somme + m.modulesNonCouverts, 0);
  const modules = bilan.metiers.reduce((somme, m) => somme + m.modules, 0);

  return (
    <div className="min-w-0 space-y-6">
      <Section
        ref={besoinRef}
        icone={<UserRoundCheck className="h-4 w-4 text-accent-teal" />}
        titre="Besoin par métier"
        description="Masse horaire qui n'est encore couverte par aucun formateur, métier par métier. C'est le volume qu'il reste à affecter (ou à recruter)."
      >
        <TableauTriable
          cleLigne={(m) => m.metier}
          vide="Aucun module dans la carte."
          lignes={[...bilan.metiers].sort(
            (a, b) => b.besoin - a.besoin || a.metier.localeCompare(b.metier, 'fr')
          )}
          colonnes={[
            { id: 'metier', entete: 'Métier', enroule: true, tri: (m) => m.metier, rendu: (m) => m.metier },
            {
              id: 'nonCouverts',
              entete: 'Modules non couverts',
              aligne: 'droite',
              tri: (m) => m.modulesNonCouverts,
              rendu: (m) => `${m.modulesNonCouverts} / ${m.modules}`,
            },
            { id: 'demande', entete: 'Demande', aligne: 'droite', tri: (m) => m.demande, rendu: (m) => h(m.demande) },
            { id: 'couvert', entete: 'Couvert', aligne: 'droite', tri: (m) => m.couvert, rendu: (m) => h(m.couvert) },
            {
              id: 'besoin',
              entete: 'Besoin',
              aligne: 'droite',
              tri: (m) => m.besoin,
              rendu: (m) =>
                m.besoin > 0 ? <span className="font-medium text-warning">{h(m.besoin)}</span> : '—',
            },
            {
              id: 'part',
              entete: 'Part non couverte',
              aligne: 'droite',
              tri: (m) => part(m.besoin, m.demande),
              rendu: (m) => `${part(m.besoin, m.demande)} %`,
            },
          ]}
          pied={{
            metier: 'Total',
            nonCouverts: `${modulesNonCouverts} / ${modules}`,
            demande: h(bilan.demande.total),
            couvert: h(bilan.demande.couvert),
            besoin: h(bilan.besoin),
            part: `${bilan.besoinTaux} %`,
          }}
        />
      </Section>

      <Section
        icone={<UserPlus className="h-4 w-4 text-primary" />}
        titre="Formateurs sous-affectés"
        description={
          <>
            Formateurs dont la masse horaire affectée reste inférieure à leur masse statutaire : la
            colonne « Disponible » indique le volume encore mobilisable pour couvrir le besoin
            {bilan.surcharges.length > 0
              ? `. ${bilan.surcharges.length} formateur(s) sont à l'inverse en surcharge : ils figurent dans la section suivante.`
              : '.'}
          </>
        }
      >
        <TableauTriable
          cleLigne={(f) => f.nom}
          vide="Aucun formateur sous-affecté : toutes les capacités déclarées sont utilisées."
          lignes={bilan.sousAffectes}
          colonnes={colonnesFormateur('disponible', 'Disponible')}
          pied={{
            nom: 'Total',
            matricule: `${bilan.sousAffectes.length} formateur(s)`,
            disponible: h(reconc.disponible),
          }}
        />

        {/*
          Sans cette ligne, l'écart entre « X h disponibles » et la tuile
          « Offre » passe pour une erreur de calcul. Elle nomme les trois
          volumes qui s'y soustraient.
        */}
        <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <strong className="text-foreground">{h(reconc.disponible)}</strong> mobilisables
          {' − '}
          <strong className="text-foreground">{h(reconc.surcharge)}</strong> de dépassement
          {reconc.heuresSansCapacite > 0 && (
            <>
              {' − '}
              <strong className="text-foreground">{h(reconc.heuresSansCapacite)}</strong> affectées
              sans capacité déclarée ({reconc.sansCapacite} formateur(s))
            </>
          )}
          {reconc.horsListe > 0 && (
            <>
              {' − '}
              <strong className="text-foreground">{h(reconc.horsListe)}</strong> affectées hors
              liste
            </>
          )}
          {' = '}
          <strong className="text-foreground">{h(reconc.ecartNet)}</strong> d'écart net (tuile
          « Offre »).
        </p>
      </Section>

      <Section
        icone={<UserRoundX className="h-4 w-4 text-destructive" />}
        titre="Formateurs en surcharge"
        description="Formateurs dont la masse horaire affectée dépasse leur masse statutaire. Leurs heures ne sont pas mobilisables : c'est ce qui explique l'écart entre le total ci-dessus et la tuile « Offre »."
      >
        <TableauTriable
          cleLigne={(f) => f.nom}
          vide="Aucun formateur en dépassement."
          lignes={bilan.surcharges}
          colonnes={colonnesFormateur('depassement', 'Dépassement')}
          pied={{
            nom: 'Total',
            matricule: `${bilan.surcharges.length} formateur(s)`,
            depassement: h(reconc.surcharge),
          }}
        />
      </Section>

      <Section
        ref={demandeRef}
        icone={<GraduationCap className="h-4 w-4 text-accent-pink" />}
        titre="Demande par métier"
        description="Heures que les groupes doivent suivre (présentiel + synchrone de chaque module, groupe par groupe), face aux heures déjà couvertes par un formateur."
      >
        <TableauTriable
          cleLigne={(m) => m.metier}
          vide="Aucun module dans la carte."
          lignes={bilan.metiers}
          colonnes={[
            { id: 'metier', entete: 'Métier', enroule: true, tri: (m) => m.metier, rendu: (m) => m.metier },
            { id: 'groupes', entete: 'Groupes', aligne: 'droite', tri: (m) => m.groupes, rendu: (m) => m.groupes },
            { id: 'modules', entete: 'Modules', aligne: 'droite', tri: (m) => m.modules, rendu: (m) => m.modules },
            { id: 'demande', entete: 'Demande', aligne: 'droite', tri: (m) => m.demande, rendu: (m) => h(m.demande) },
            { id: 'couvert', entete: 'Couvert', aligne: 'droite', tri: (m) => m.couvert, rendu: (m) => h(m.couvert) },
            {
              id: 'couverture',
              entete: 'Couverture',
              aligne: 'droite',
              tri: (m) => part(m.couvert, m.demande),
              rendu: (m) => <BadgeTaux couvert={m.couvert} total={m.demande} />,
            },
          ]}
          pied={{
            metier: 'Total',
            demande: h(bilan.demande.total),
            couvert: h(bilan.demande.couvert),
            couverture: <BadgeTaux couvert={bilan.demande.couvert} total={bilan.demande.total} />,
          }}
        />
      </Section>
    </div>
  );
}

/** Colonnes communes aux deux tableaux de formateurs. */
function colonnesFormateur(idEcart, enteteEcart) {
  return [
    { id: 'nom', entete: 'Formateur', enroule: true, tri: (f) => f.nom, rendu: (f) => f.nom },
    { id: 'matricule', entete: 'Mle', tri: (f) => f.matricule, rendu: (f) => f.matricule || '—' },
    { id: 'statutaire', entete: 'Statutaire', aligne: 'droite', tri: (f) => f.statutaire, rendu: (f) => h(f.statutaire) },
    { id: 's1', entete: 'Affecté S1', aligne: 'droite', tri: (f) => f.s1, rendu: (f) => h(f.s1) },
    { id: 's2', entete: 'Affecté S2', aligne: 'droite', tri: (f) => f.s2, rendu: (f) => h(f.s2) },
    { id: 'affecte', entete: 'Affecté total', aligne: 'droite', tri: (f) => f.affecte, rendu: (f) => h(f.affecte) },
    {
      id: idEcart,
      entete: enteteEcart,
      aligne: 'droite',
      tri: (f) => f[idEcart],
      rendu: (f) => <strong>{h(f[idEcart])}</strong>,
    },
    {
      id: 'charge',
      entete: 'Charge',
      aligne: 'droite',
      tri: (f) => f.taux,
      rendu: (f) => <BadgeTaux couvert={f.affecte} total={f.statutaire} />,
    },
  ];
}

/**
 * Taux, en quatre états. ← `tauxBadge()` : vide / partiel / ok / over.
 * Le dépassement se distingue de l'atteinte exacte — 100 % est un objectif,
 * 130 % un problème.
 */
function BadgeTaux({ couvert, total }) {
  const taux = part(couvert, total);
  const apparence =
    taux > 100
      ? 'border-destructive/30 bg-destructive/10 text-destructive'
      : taux >= 100
        ? 'border-success/30 bg-success/10 text-success'
        : taux > 0
          ? 'border-warning/30 bg-warning/10 text-warning'
          : 'text-muted-foreground';

  return (
    <span className={cn('rounded-md border px-2 py-0.5 text-xs tabular-nums', apparence)}>
      {taux} %
    </span>
  );
}

const Section = ({ ref, icone, titre, description, children }) => (
  <section ref={ref} className="min-w-0 scroll-mt-2">
    <h4 className="flex items-center gap-2 text-sm font-medium">
      {icone}
      {titre}
    </h4>
    <p className="mb-3 mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    {children}
  </section>
);

function part(valeur, total) {
  return total > 0 ? Math.round((valeur / total) * 100) : 0;
}

function h(valeur) {
  return `${Number(valeur).toLocaleString('fr-FR')} h`;
}
