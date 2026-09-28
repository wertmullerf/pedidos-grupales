import { cn } from 'cn';

/** Logo de texto: nombre de la cadena en mayúsculas, condensado y en negrita, un solo color. */
export function Wordmark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        'font-condensed block leading-none font-extrabold tracking-[-0.01em] text-primary uppercase',
        className,
      )}
    >
      {name}
    </span>
  );
}
