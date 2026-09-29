import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CheckCheck, Clock, CopyPlus, ShieldCheck, UserX } from 'lucide-react';
import { ROLES } from 'shared/constants';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Badge } from '@/components/ui/badge';
import Alerte from '@/components/common/Alerte';
import { IndicateurEnregistrement, useEnregistrementAuto } from '@/components/common/enregistrementAuto';
import { recupererSession } from '@/features/auth/api';
import { cn } from '@/lib/utils';
import { chargerAppel, chargerSeancesDuJour, enregistrerAppel, validerAppel } from './api';
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
export default function ListeAppel({ appel, dansPanneau, onAvertissementFermeture, piedAppel }) {
  const cache = useQueryClient();
  /*
   * ⚠️ LE RÔLE DÉCIDE DU GESTE (2026-09-27, demande du porteur : « chez le
   * formateur, un bouton pour valider l'absence, et annule l'enregistrement
   * automatique » — et « en absence, chez le gestionnaire, je veux un signe
   * que le formateur a marqué l'absence »). Ce composant reste le MÊME pour
   * les deux : l'encadrement continue d'enregistrer au fil des clics — il
   * corrige souvent pour un formateur absent d'esprit ce jour-là — et voit un
   * signe s'il en manque un. Le formateur, LUI, attesté sa propre liste d'un
   * geste explicite plutôt que par un clic qui part tout seul.
   */
  const session = useQuery({ queryKey: ['session'], queryFn: recupererSession, retry: false });
  const estFormateur = session.data?.utilisateur?.role === ROLES.FORMATEUR;
  /*
   * ⚠️ LE GESTIONNAIRE ET LE DIRECTEUR PEUVENT AUSSI VALIDER (2026-09-28,
   * demande du porteur : « peut aussi valider l'absence comme le
   * formateur » puis « si je quitte sans validation, n'accepte pas les
   * modifications ») — le serveur le permettait déjà (`validerAppel` n'est
   * restreint qu'à qui peut faire l'appel de ce cours, jamais au seul
   * formateur, cf. son commentaire).
   *
   * ⚠️⚠️ REVIENT SUR « LEUR ENREGISTREMENT AUTOMATIQUE RESTE » : le porteur a
   * ensuite demandé la MÊME garde pour tous — quitter sans avoir cliqué
   * « Valider » n'écrit plus rien pour personne, gestionnaire et directeur
   * compris. `peutValider` sert donc maintenant aux DEUX choses à la fois :
   * qui voit le bouton, et pour qui l'enregistrement automatique est coupé.
   */
  const peutValider =
    estFormateur ||
    session.data?.utilisateur?.role === ROLES.GESTIONNAIRE ||
    session.data?.utilisateur?.role === ROLES.DIRECTEUR;
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

  /*
   * ⚠️ « VALIDER L'APPEL » DU FORMATEUR — la même écriture que ci-dessus, mais
   * qui pose EN PLUS l'attestation (`validerAppel`, côté serveur). C'est le
   * SEUL départ pour lui : `modifie` force ci-dessous `useEnregistrementAuto`
   * au repos, rien ne part avant ce clic.
   */
  const valider = useMutation({
    mutationFn: (valeurs) => validerAppel(corps(valeurs)),
    onSuccess: (_bilan, valeurs) => {
      referenceActuelle.current = valeurs;
      setReference(valeurs);
      cache.invalidateQueries({ queryKey: ['absences-stagiaires'] });
      toast.success('Appel validé');
    },
    onError: (erreur) => toast.error('Validation impossible', { description: erreur.message }),
  });

  /*
   * ⚠️ JAMAIS POUR QUI PEUT VALIDER (`modifie: peutValider ? false : modifie`,
   * 2026-09-28, revient sur « l'encadrement continue d'enregistrer au fil des
   * clics ») : c'est ce qui fait qu'une fermeture sans « Valider » n'accepte
   * aucune modification, pour le formateur comme pour l'encadrement — ses
   * clics restent dans l'écran, sans repartir tout seuls après la pause.
   */
  const enregistreUneFois = useEnregistrementAuto({
    modifie: peutValider ? false : modifie,
    valeur: etats,
    repos: REPOS_APPEL,
    enCours: enregistrer.isPending,
    onEnregistrer: () => enregistrer.mutate(etats),
  });

  /*
   * Ce qu'il faudrait écrire si la liste se fermait maintenant.
   * ⚠️ PAS POUR QUI PEUT VALIDER (2026-09-28) : fermer le panneau sans avoir
   * cliqué « Valider » abandonne les changements plutôt que de les enregistrer
   * en silence — désormais pour tout le monde, formateur ou encadrement. La
   * liste retrouve son dernier état attesté si on rouvre le même cours sans
   * avoir fermé le navigateur.
   */
  const enAttente = useRef(null);
  enAttente.current = !peutValider && modifie && !enregistrer.isPending ? corps(etats) : null;
  useEffect(
    () => () => {
      if (!enAttente.current) return;
      enregistrerAppel(enAttente.current)
        .then(() => cache.invalidateQueries({ queryKey: ['absences-stagiaires'] }))
        .catch((erreur) => toast.error('Appel non enregistré', { description: erreur.message }));
    },
    [cache]
  );

  /*
   * ⚠️ L'AVERTISSEMENT DE FERMETURE (2026-09-28, demande du porteur : « ajoute
   * l'avertissement de fermeture sans validation ») — prévient `PanneauAppel`,
   * qui intercepte alors la fermeture du panneau (croix, clic extérieur) pour
   * demander confirmation. Vaut pour QUI PEUT valider, dès qu'il a touché la
   * liste et qu'elle n'est pas (ou plus) attestée — même logique que le bouton
   * collé en bas, jamais un second calcul.
   */
  const avertirFermeture = peutValider && touche && !appel.validation;
  useEffect(() => {
    onAvertissementFermeture?.(avertirFermeture);
  }, [avertirFermeture, onAvertissementFermeture]);

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
        {/*
          ⚠️ LE SIGNE DEMANDÉ PAR LE PORTEUR : « je veux un signe que le
          formateur a marqué l'absence ». Visible des DEUX côtés — l'encadrement
          y voit si le formateur a attesté sa liste, le formateur y retrouve sa
          propre attestation. `appel.validation` vaut `null` dès que la liste a
          changé depuis (`enregistrerAppel` l'efface) : le signe ne ment donc
          jamais sur une liste modifiée depuis.
        */}
        <BadgeValidation validation={appel.validation} />
        {/* ⚠️ PAS POUR QUI PEUT VALIDER (2026-09-28) : rien ne part tout seul pour
            lui, l'indicateur d'enregistrement automatique n'aurait donc rien à dire. */}
        {!peutValider && (
          <span className="sm:ml-auto">
            <IndicateurEnregistrement
              modifie={modifie}
              enCours={enregistrer.isPending}
              echec={enregistrer.isError && modifie}
              enregistreUneFois={enregistreUneFois}
            />
          </span>
        )}
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

      {peutValider && (
        <BarreValidation
          appel={appel}
          valider={valider}
          etats={etats}
          dansPanneau={dansPanneau}
          piedAppel={piedAppel}
        />
      )}
    </section>
  );
}

/**
 * Le bouton « Valider l'appel », et ce qui prévient qu'il reste à cliquer.
 *
 * ═══ ⚠️⚠️ EN DEHORS DE LA ZONE QUI DÉFILE, PAS COLLÉ DEDANS (2026-09-28) ═══
 * Revient sur `position: sticky` : posé DANS la liste qui défile, il restait
 * ancré à un point qui n'était pas toujours le vrai bord bas de l'écran — sur
 * certaines hauteurs de panneau, une ligne continuait de glisser sous lui,
 * malgré un fond opaque et des marges négatives déjà corrigées deux fois.
 * `piedAppel` est un nœud posé par `PanneauAppel` HORS de son conteneur qui
 * défile — un vrai pied de panneau, structurellement immobile, où `createPortal`
 * dépose ce bouton : plus aucune ligne ne peut jamais passer dessous, quelle
 * que soit la hauteur de l'écran ou de la liste.
 * ⚠️ SANS `piedAppel` (la carte hors panneau, non défilante) : rendu sur
 * place, comme avant.
 */
function BarreValidation({ appel, valider, etats, dansPanneau, piedAppel }) {
  const contenu = (
    <div
      className={cn(
        'flex items-center justify-end gap-2 border-t bg-background px-4 py-2',
        !piedAppel && (dansPanneau ? '-mx-4 mt-2' : '-mx-2 mt-2 sm:-mx-3'),
        !appel.validation && 'border-warning/60'
      )}
    >
      {!appel.validation && (
        <span className="mr-auto text-xs font-medium text-accent-orange-deep">Liste non validée</span>
      )}
      <Button
        type="button"
        size="sm"
        variant={appel.validation ? 'outline' : 'default'}
        disabled={valider.isPending}
        onClick={() => valider.mutate(etats)}
      >
        <CheckCheck className="size-4" />
        {valider.isPending ? 'Validation…' : "Valider l'appel"}
      </Button>
    </div>
  );

  return piedAppel ? createPortal(contenu, piedAppel) : contenu;
}

/**
 * Le signe demandé par le porteur (2026-09-27) : « en absence chez le
 * gestionnaire je veux un signe que le formateur a marqué l'absence ». Vaut
 * `null` dès que la liste a changé depuis la validation — jamais de faux « validé ».
 */
function BadgeValidation({ validation }) {
  if (!validation) {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        Non validé
      </Badge>
    );
  }
  const date = new Date(validation.valideLe);
  const quand = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <Badge variant="secondary" className="gap-1 border-accent-green bg-accent-green/15 text-accent-green-deep">
      <CheckCheck className="size-3.5" />
      Validé{validation.validateurNom ? ` par ${validation.validateurNom}` : ''}
      {quand && ` le ${quand}`}
    </Badge>
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
