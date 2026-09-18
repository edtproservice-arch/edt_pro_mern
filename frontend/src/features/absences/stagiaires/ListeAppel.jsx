import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Clock, CopyPlus, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import Alerte from '@/components/common/Alerte';
import { IndicateurEnregistrement, useEnregistrementAuto } from '@/components/common/enregistrementAuto';
import { cn } from '@/lib/utils';
import { chargerAppel, chargerSeancesDuJour, enregistrerAppel } from './api';
import { adopterVersion, creneauSuivant, marquesCopiees, memesEtats } from './appelOutils';

const ETATS = [
  { type: null, libelle: 'Présent', Icone: Check },
  { type: 'absence', libelle: 'Absent', Icone: UserX },
  { type: 'retard', libelle: 'Retard', Icone: Clock },
];

/** Classes LITTÉRALES : le bouton actif prend la teinte de ce qu'il marque. */
const ACTIF = {
  null: 'border-accent-green bg-accent-green/15 text-accent-green-deep hover:bg-accent-green/20',
  absence: 'border-destructive bg-destructive/10 text-destructive hover:bg-destructive/15',
  retard: 'border-warning bg-warning/15 text-accent-orange-deep hover:bg-warning/20',
};

/** Assez court pour qu'un appel se fasse au fil des clics, assez long pour grouper une rafale. */
const REPOS_APPEL = 600;

/**
 * La liste d'appel d'un cours.
 * `dansPanneau` : le panneau latéral de l'agenda porte déjà le titre et le cadre.
 *
 * ═══ ENREGISTREMENT AUTOMATIQUE ═══ (2026-09-14, demande du porteur) — le bouton
 * « Enregistrer l'appel » disparaît : chaque clic part tout seul après une courte
 * pause, par `useEnregistrementAuto`, le crochet des écrans de réglages (qui ne
 * lance jamais deux écritures à la fois). L'indicateur dit où l'on en est.
 *
 * ⚠️ `reference` EST CE QUE LE SERVEUR A CONFIRMÉ, posé dès la réponse : attendre
 * la relecture laisserait la liste « modifiée » le temps de l'aller-retour, et la
 * minuterie renverrait le même appel une seconde fois.
 * ⚠️ UNE LISTE FERMÉE PENDANT LA PAUSE ENREGISTRE AUSSITÔT : sans cela, fermer le
 * panneau juste après un clic perdrait ce clic, en silence.
 */
export default function ListeAppel({ appel, dansPanneau }) {
  const cache = useQueryClient();
  const matricules = useMemo(() => appel.stagiaires.map((s) => s.matricule), [appel]);
  const initial = useMemo(
    () => Object.fromEntries(appel.stagiaires.map((s) => [s.matricule, s.marque?.type ?? null])),
    [appel]
  );
  const [etats, setEtats] = useState(initial);
  // Le bouton « Dupliquer » paraît dès la première modification (demande du porteur).
  const [touche, setTouche] = useState(false);
  const [reference, setReference] = useState(initial);
  const referenceActuelle = useRef(initial);

  /*
   * Une relecture du serveur (un collègue a fait l'appel, une duplication vient
   * d'écrire) devient la nouvelle référence ; la liste l'ADOPTE si rien n'y est
   * en cours de saisie — sinon la saisie l'emporte, et c'est elle qui partira.
   */
  useEffect(() => {
    // ⚠️ FIGÉE ICI : le calcul différé ci-dessous s'exécute APRÈS la ligne qui
    // remplace la référence (voir `adopterVersion`).
    const precedente = referenceActuelle.current;
    setEtats((courant) => adopterVersion(courant, precedente, initial, matricules));
    referenceActuelle.current = initial;
    setReference(initial);
  }, [initial, matricules]);

  const fusion = new Set(appel.stagiaires.map((s) => s.groupe)).size > 1;
  const modifie = !memesEtats(etats, reference, matricules);
  const compte = (type) => appel.stagiaires.filter((s) => (etats[s.matricule] ?? null) === type).length;

  const corps = (valeurs) => ({
    date: appel.date,
    seance: appel.cours.seance,
    periode: appel.cours.periode,
    groupe: appel.cours.groupe,
    // ⚠️ TOUTE LA LISTE : un présent qui avait été marqué est ainsi retiré.
    marques: matricules.map((matricule) => ({ matricule, type: valeurs[matricule] ?? null })),
  });

  const enregistrer = useMutation({
    mutationFn: (valeurs) => enregistrerAppel(corps(valeurs)),
    onSuccess: (_bilan, valeurs) => {
      referenceActuelle.current = valeurs;
      setReference(valeurs);
      cache.invalidateQueries({ queryKey: ['absences-stagiaires'] });
    },
    onError: (erreur) => toast.error('Appel non enregistré', { description: erreur.message }),
  });

  const enregistreUneFois = useEnregistrementAuto({
    modifie,
    valeur: etats,
    repos: REPOS_APPEL,
    enCours: enregistrer.isPending,
    onEnregistrer: () => enregistrer.mutate(etats),
  });

  // Ce qu'il faudrait écrire si la liste se fermait maintenant.
  const enAttente = useRef(null);
  enAttente.current = modifie && !enregistrer.isPending ? corps(etats) : null;
  useEffect(
    () => () => {
      if (!enAttente.current) return;
      enregistrerAppel(enAttente.current)
        .then(() => cache.invalidateQueries({ queryKey: ['absences-stagiaires'] }))
        .catch((erreur) => toast.error('Appel non enregistré', { description: erreur.message }));
    },
    [cache]
  );

  if (appel.stagiaires.length === 0) {
    return (
      <Alerte type="avertissement" titre="Personne à appeler">
        Aucun stagiaire de {appel.cours.groupe} dans la base Konosys de l’année — importez-la depuis « Documents ».
      </Alerte>
    );
  }

  const marques = matricules.filter((m) => (etats[m] ?? null) !== null).length;

  return (
    <section className={cn('space-y-3', !dansPanneau && 'rounded-lg border p-2 sm:p-3')}>
      <div className="flex flex-wrap items-center gap-2">
        {!dansPanneau && (
          <h3 className="text-sm font-semibold">
            {appel.jour} {appel.date} · {appel.cours.seance} · {appel.cours.groupe} · {appel.cours.module}
          </h3>
        )}
        <span className="text-xs text-muted-foreground">
          {compte('absence')} absent(s) · {compte('retard')} retard(s) · {compte(null)} présent(s)
        </span>
        <span className="sm:ml-auto">
          <IndicateurEnregistrement
            modifie={modifie}
            enCours={enregistrer.isPending}
            echec={enregistrer.isError && modifie}
            enregistreUneFois={enregistreUneFois}
          />
        </span>
      </div>

      <DupliquerVersSuivant appel={appel} etats={etats} visible={touche || marques > 0} />

      <ul className="divide-y">
        {appel.stagiaires.map((s) => (
          <li key={s.matricule} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            {/* ⚠️ Sur téléphone le nom prend sa ligne : à côté des trois boutons, il se
                réduisait à « BOU… » et le CEF passait sous eux. */}
            <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
              <p className="truncate text-sm font-medium">{s.nom}</p>
              <p className="text-xs text-muted-foreground">
                {s.matricule}
                {fusion && ` · ${s.groupe}`}
                {s.marque?.justifiee && <span className="text-accent-green-deep"> · justifiée</span>}
              </p>
            </div>
            {/* ⚠️ Sous `sm`, les trois boutons se partagent la largeur : posée dans une carte
                de l'agenda, sur téléphone, la liste n'a que ~230 px et « Retard » était coupé. */}
            <ButtonGroup className="w-full sm:w-auto">
              {ETATS.map(({ type, libelle, Icone }) => {
                const actif = (etats[s.matricule] ?? null) === type;
                return (
                  <Button
                    key={libelle}
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={actif}
                    className={cn('h-7 flex-1 gap-1 px-1.5 text-xs sm:flex-none sm:px-2', actif && ACTIF[type])}
                    onClick={() => {
                      setTouche(true);
                      setEtats((avant) => ({ ...avant, [s.matricule]: type }));
                    }}
                  >
                    {/* Icône visible partout (demande du porteur) : dans le panneau, même sur
                        téléphone, chaque bouton a ~110 px — la place que la carte n'avait pas. */}
                    <Icone className="size-3.5" />
                    {libelle}
                  </Button>
                );
              })}
            </ButtonGroup>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * ═══ DUPLIQUER L'APPEL VERS LE CRÉNEAU SUIVANT ═══ (2026-09-14, demandes du
 * porteur : « un bouton dupliquer vers S2 », puis « si je fais un changement, il
 * m'affiche dupliquer — pas forcément un stagiaire absent ».)
 *
 * ⚠️ VISIBLE DÈS LA PREMIÈRE MODIFICATION, ou dès qu'une marque existe : sur une
 * liste où tout le monde est présent et rien n'a été touché, il n'y a rien à
 * dupliquer.
 * ⚠️ L'ÉTAT EST RECOPIÉ TEL QUEL (`marquesCopiees`) — absents, retards ET
 * présents. Une marque déjà posée sur la cible peut donc être remplacée : le
 * message le chiffre.
 * ⚠️ SEULEMENT SI CE GROUPE A COURS AU CRÉNEAU SUIVANT pour cette personne — le
 * formateur n'y voit que SES cours, et un créneau fermé (formateur absent, stage)
 * n'est pas proposé. Le serveur refait le contrôle.
 * ⚠️ LA LISTE DE LA CIBLE EST RELUE AU MOMENT DU CLIC, pas devinée : l'appel ne
 * s'écrit que liste entière.
 */
function DupliquerVersSuivant({ appel, etats, visible }) {
  const cache = useQueryClient();
  const suivant = creneauSuivant(appel.cours.seance);

  const jour = useQuery({
    queryKey: ['absences-stagiaires', 'seances', appel.date, null],
    queryFn: () => chargerSeancesDuJour({ date: appel.date }),
    enabled: Boolean(suivant) && visible,
    retry: false,
  });
  const cible = (jour.data?.seances ?? []).find(
    (s) => s.seance === suivant && s.periode === appel.cours.periode && s.groupe === appel.cours.groupe && !s.ferme
  );

  const dupliquer = useMutation({
    mutationFn: async () => {
      const creneau = { date: appel.date, seance: cible.seance, periode: cible.periode, groupe: cible.groupe };
      const liste = await chargerAppel(creneau);
      const bilan = marquesCopiees(liste.stagiaires, etats);
      if (bilan.changees > 0) await enregistrerAppel({ ...creneau, marques: bilan.marques });
      return bilan;
    },
    onSuccess: ({ changees, remplacees }) => {
      cache.invalidateQueries({ queryKey: ['absences-stagiaires'] });
      if (changees === 0) {
        toast.success(`${suivant} est déjà identique`);
        return;
      }
      toast.success(`Appel dupliqué en ${suivant}`, {
        description: `${changees} changement(s)${remplacees > 0 ? `, dont ${remplacees} marque(s) remplacée(s)` : ''}`,
      });
    },
    onError: (erreur) => toast.error('Duplication impossible', { description: erreur.message }),
  });

  if (!cible || !visible) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 border-primary/40 text-xs text-primary hover:bg-primary/5 hover:text-primary"
      disabled={dupliquer.isPending}
      onClick={() => dupliquer.mutate()}
    >
      <CopyPlus className="size-3.5" />
      {dupliquer.isPending ? 'Duplication…' : `Dupliquer l’appel vers ${suivant}`}
    </Button>
  );
}
