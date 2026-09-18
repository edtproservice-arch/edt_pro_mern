import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { NOMBRE_SEMAINES, SEUIL_HEBDOMADAIRE } from 'shared/domain';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Alerte from '@/components/common/Alerte';
import { couleurCharge } from '@/components/common/apparenceGrille';
import { cn } from '@/lib/utils';
import { chargerCharge } from './api';

/**
 * Charge hebdomadaire, en tableau croisé sujet × semaines.
 * ← `ouvrirChargeFormateurs()` + `dessinerTableauCharge()` de profil-principal.js
 *
 * ═══ POURQUOI CE TABLEAU EXISTE ═══
 * La grille répond à « ce groupe a-t-il toutes ses heures ? ». Elle ne répond
 * pas à « qui déborde en S12 ? » — pour le savoir il faudrait cocher les vingt
 * groupes et lire les pieds de grille un à un.
 *
 * ⚠️ ET IL PORTE SUR TOUS LES CHRONOGRAMMES, pas seulement ceux affichés.
 * C'est tout l'intérêt : le calcul se fait côté serveur, sans rien monter.
 *
 * ═══ LE BOUTON CROISE LE MODE ═══
 * En mode groupe on affiche la charge des FORMATEURS, en mode formateur celle
 * des GROUPES. Chaque vue montre déjà ce qu'elle a sous les yeux ; ce tableau
 * apporte l'autre moitié de la réponse.
 */
const MOTS = {
  groupe: {
    cle: 'formateurs',
    bouton: 'Charge formateurs',
    colonne: 'Formateur',
    titre: 'Charge hebdomadaire des formateurs',
    note: 'Masse horaire par semaine. Présentiel cumulé, séance synchrone mutualisée comptée une seule fois.',
    vide: 'Aucune heure planifiée dans les chronogrammes de cette année.',
  },
  formateur: {
    cle: 'groupes',
    bouton: 'Charge groupes',
    colonne: 'Groupe',
    titre: 'Charge hebdomadaire des groupes',
    note: 'Masse horaire reçue par chaque groupe, semaine par semaine. Une séance synchrone mutualisée est comptée pour chacun des groupes qu’elle couvre.',
    vide: 'Aucune heure planifiée dans les chronogrammes de cette année.',
  },
};

export default function BoutonCharge({ mode }) {
  const [ouvert, setOuvert] = useState(false);
  const mots = MOTS[mode] ?? MOTS.groupe;

  /*
   * La requête ne part QU'À L'OUVERTURE : elle parcourt tous les chronogrammes
   * de l'année, et la lancer au montage de la page ferait payer ce calcul à
   * quelqu'un qui ne le demandera jamais.
   */
  const charge = useQuery({
    queryKey: ['chronogrammes', 'charge'],
    queryFn: chargerCharge,
    enabled: ouvert,
    retry: false,
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={() => setOuvert(true)}
      >
        <Gauge className="size-3.5" />
        {mots.bouton}
      </Button>

      <Dialog open={ouvert} onOpenChange={setOuvert}>
        {/*
          ⚠️ `min-w-0` sur le contenu : `DialogContent` est une GRILLE, et un
          enfant de grille refuse de devenir plus étroit que son contenu. Sans
          lui, `overflow-x-auto` ne retient rien — c'est la modale entière qui
          s'élargit, et l'en-tête sort de l'écran avec le tableau.
        */}
        <DialogContent className="max-h-[85vh] w-[min(96vw,1400px)] max-w-none overflow-hidden">
          <DialogHeader>
            <DialogTitle>{mots.titre}</DialogTitle>
            <DialogDescription>{mots.note}</DialogDescription>
          </DialogHeader>

          <Contenu requete={charge} mots={mots} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function Contenu({ requete, mots }) {
  if (requete.isError) {
    return (
      <Alerte type="erreur" titre="Charge indisponible">
        {requete.error.message}
      </Alerte>
    );
  }

  // La fenêtre s'ouvre TOUT DE SUITE, en attente : calculer d'abord laisserait
  // plusieurs secondes sans réaction après le clic.
  if (requete.isLoading || !requete.data) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Calcul de la charge sur tous les groupes…
      </p>
    );
  }

  const charge = requete.data[mots.cle] ?? {};
  const sujets = Object.keys(charge).sort((a, b) =>
    a.localeCompare(b, 'fr', { numeric: true })
  );

  if (sujets.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{mots.vide}</p>;
  }

  const enAlerte = sujets.filter((sujet) => charge[sujet].depassements > 0);
  const semaines = Array.from({ length: NOMBRE_SEMAINES }, (_, rang) => rang + 1);

  return (
    <div className="min-w-0 space-y-2">
      <Resume
        sujets={sujets}
        enAlerte={enAlerte}
        mots={mots}
        ignores={requete.data.groupesIgnores ?? []}
      />

      <div className="max-h-[60vh] min-w-0 overflow-auto rounded-lg border">
        <table className="w-max border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              {/*
                Le nom ET l'en-tête restent visibles pendant le défilement : avec
                45 colonnes, on perd sinon la ligne qu'on est en train de lire.
              */}
              <th className="sticky left-0 top-0 z-30 w-48 border-b border-r bg-tableau-tete px-3 py-2 text-left">
                {mots.colonne}
              </th>
              {semaines.map((numero) => (
                <th
                  key={numero}
                  className="sticky top-0 z-20 w-12 border-b border-r bg-tableau-tete px-1 py-2 text-center font-medium"
                >
                  S{numero}
                </th>
              ))}
              <th className="sticky right-0 top-0 z-30 w-16 border-b border-l-2 bg-tableau-tete px-2 py-2 text-center">
                Total
              </th>
            </tr>
          </thead>

          <tbody>
            {sujets.map((sujet) => (
              <tr key={sujet}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-r bg-card px-3 py-1.5 text-left font-medium"
                >
                  <span className="line-clamp-1" title={sujet}>
                    {sujet}
                  </span>
                </th>

                {semaines.map((numero) => (
                  <Case key={numero} valeurs={charge[sujet].semaines[numero]} />
                ))}

                <td className="sticky right-0 z-10 border-b border-l-2 bg-card px-2 py-1.5 text-center font-semibold tabular-nums">
                  {charge[sujet].total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Une case du tableau.
 *
 * Le détail présentiel / synchrone passe en infobulle : l'écrire dans la case
 * doublerait la largeur de 45 colonnes pour une information qu'on ne consulte
 * que sur les semaines qui posent question.
 */
function Case({ valeurs }) {
  if (!valeurs) {
    return <td className="border-b border-r px-1 py-1.5 text-center text-muted-foreground">–</td>;
  }

  /*
   * ═══ ⚠️ LA COULEUR VIENT DE `couleurCharge`, LA RÈGLE COMMUNE ═══
   * (2026-09-06, demande du porteur : « les cases plus grandes que zéro et plus
   * petites que 30 doivent être en bleu ».)
   *
   * Ce tableau portait sa PROPRE règle à trois branches, dont la dernière —
   * tout ce qui est sous le seuil — rendait un `text-foreground` noir. Une
   * semaine à 25 h s'y lisait donc comme une semaine sans information, alors
   * que la grille d'emploi du temps et l'en-tête du chronogramme la montrent
   * en BLEU depuis le 2026-08-24 : « gris à 0 h, bleu tant qu'il reste de la
   * place, vert à la semaine pleine, rouge au-delà ».
   *
   * ⚠️ ON APPELLE LA FONCTION, ON NE RECOPIE PAS SES SEUILS : deux listes
   * divergeraient au premier ajustement, et la même charge se lirait bleue
   * ici et noire ailleurs — c'est le §4.2 à l'échelle d'une couleur, et c'est
   * précisément ce qui vient de se produire.
   */
  const deborde = valeurs.total > SEUIL_HEBDOMADAIRE;

  return (
    <td
      title={`${valeurs.presentiel} h présentiel · ${valeurs.synchrone} h synchrone`}
      className={cn(
        'border-b border-r px-1 py-1.5 text-center tabular-nums',
        couleurCharge(valeurs.total, SEUIL_HEBDOMADAIRE),
        deborde && 'font-semibold'
      )}
    >
      {valeurs.total}
    </td>
  );
}

/** Ce que le tableau dit d'un coup d'œil, avant de le parcourir. */
function Resume({ sujets, enAlerte, mots, ignores }) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        {sujets.length} {mots.colonne.toLowerCase()}(s) ·{' '}
        {enAlerte.length === 0 ? (
          <span className="text-success">aucune semaine au-delà de {SEUIL_HEBDOMADAIRE} h</span>
        ) : (
          <span className="text-destructive">
            {enAlerte.length} au-delà de {SEUIL_HEBDOMADAIRE} h : {enAlerte.slice(0, 4).join(', ')}
            {enAlerte.length > 4 && '…'}
          </span>
        )}
      </p>

      {/*
        Un chronogramme dont le groupe a disparu de la base porterait une charge
        que plus personne n'assure. Il est écarté — le taire laisserait chercher
        pourquoi les totaux ne tombent pas juste.
      */}
      {ignores.length > 0 && (
        <p>
          {ignores.length} chronogramme(s) écarté(s), leur groupe n’existant plus dans la base :{' '}
          {ignores.join(', ')}.
        </p>
      )}
    </div>
  );
}
