import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp';

/**
 * Saisie du code à 6 chiffres.
 *
 * `InputOTP` de shadcn : une case par chiffre, collage d'un code entier
 * accepté, navigation au clavier, et `inputMode="numeric"` qui fait sortir le
 * pavé numérique sur mobile — les stagiaires consultent majoritairement depuis
 * un téléphone.
 *
 * Composant contrôlé : il reçoit `value` / `onChange` du `FormField` parent.
 *
 * Dimensions ajustées : avec les cases de 40px et le séparateur, le composant
 * mesure 264px et débordait sous 320px de large (mesuré : 297px pour 294px
 * disponibles). Les cases passent donc à 36px et le séparateur disparaît sur
 * les très petits écrans.
 */
export default function ChampCode({ value, onChange, onComplete, ...props }) {
  return (
    <InputOTP
      maxLength={6}
      value={value ?? ''}
      onChange={onChange}
      onComplete={onComplete}
      containerClassName="justify-center"
      {...props}
    >
      <InputOTPGroup>
        <InputOTPSlot index={0} className="h-11 w-9 text-base sm:w-10" />
        <InputOTPSlot index={1} className="h-11 w-9 text-base sm:w-10" />
        <InputOTPSlot index={2} className="h-11 w-9 text-base sm:w-10" />
      </InputOTPGroup>

      <InputOTPSeparator className="hidden sm:flex" />

      <InputOTPGroup>
        <InputOTPSlot index={3} className="h-11 w-9 text-base sm:w-10" />
        <InputOTPSlot index={4} className="h-11 w-9 text-base sm:w-10" />
        <InputOTPSlot index={5} className="h-11 w-9 text-base sm:w-10" />
      </InputOTPGroup>
    </InputOTP>
  );
}
