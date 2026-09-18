import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Panneau « Besoin d'aide ? » — qui doit créer un compte, qui ne doit pas.
 * Reprend le contenu de login.html:140-165.
 */
const CONSIGNES = [
  {
    role: 'Directeur',
    texte:
      "Vous devez créer un compte. Après votre inscription, faites-le approuver en nous contactant à edtproservice@gmail.com.",
  },
  {
    role: 'Formateur',
    texte:
      "Ne créez pas de compte. Connectez-vous avec votre matricule ou votre email OFPPT (@ofppt.ma) et le mot de passe fourni par votre directeur.",
  },
  {
    role: 'Stagiaire',
    texte:
      "Ne créez pas de compte. Connectez-vous avec votre CEF ou votre email OFPPT (@ofppt-edu.ma) et le mot de passe fourni par votre directeur.",
  },
  {
    role: 'Gestionnaire',
    texte:
      "Ne créez pas de compte. Connectez-vous avec l'identifiant et le mot de passe fournis par votre directeur.",
  },
];

export default function PanneauAide() {
  const [ouvert, setOuvert] = useState(false);

  if (!ouvert) {
    return (
      <Button
        size="icon"
        onClick={() => setOuvert(true)}
        aria-label="Besoin d'aide ?"
        className="fixed bottom-6 right-6 z-40 h-11 w-11 rounded-full text-lg font-semibold shadow-lg"
      >
        {/*
          ⚠️ UN POINT D'INTERROGATION NU, PAS L'ICÔNE `HelpCircle` (demande du
          porteur, 2026-09-02) : celle-ci dessine son PROPRE cercle, à l'intérieur
          du bouton qui en est déjà un. Deux cercles concentriques pour un seul
          signe — le disque bleu suffit à en faire un bouton.

          ⚠️ `aria-hidden` : le bouton porte déjà son `aria-label`, et sans cela
          un lecteur d'écran annoncerait « Besoin d'aide ? point d'interrogation ».
        */}
        <span aria-hidden="true">?</span>
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-0 right-0 z-50 flex max-h-[85vh] w-full flex-col rounded-b-none rounded-r-none shadow-lg sm:w-80">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b py-4">
        <CardTitle className="text-base">Besoin d&apos;aide&nbsp;?</CardTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOuvert(false)}
          aria-label="Fermer"
          className="h-7 w-7 text-muted-foreground"
        >
          <X />
        </Button>
      </CardHeader>

      <CardContent className="scrollbar-fine space-y-2 overflow-y-auto py-4">
        {CONSIGNES.map(({ role, texte }) => (
          <div key={role} className="rounded-md bg-muted p-3">
            <p className="text-sm font-medium">{role}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{texte}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
