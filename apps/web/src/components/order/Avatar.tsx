import { cn } from 'cn';
import { initial } from '@/lib/format';

/** Avatar chico: inicial sobre el color del participante. */
export function Avatar({
  name,
  color,
  size = 28,
  online,
  className,
}: {
  name: string;
  color: string;
  size?: number;
  online?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-grid shrink-0 place-items-center rounded-full font-semibold text-white',
        className,
      )}
      style={{ width: size, height: size, background: color, fontSize: size * 0.44 }}
    >
      {initial(name)}
      {online !== undefined && (
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background',
            online ? 'bg-emerald-500' : 'bg-neutral-300',
          )}
        />
      )}
    </span>
  );
}
