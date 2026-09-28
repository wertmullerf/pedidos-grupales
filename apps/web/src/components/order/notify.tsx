import { toast } from 'sonner';
import { Avatar } from './Avatar';

/** Aviso discreto de algo que hizo otra persona, con su avatar. */
export function notifyRemote(text: string, person?: { name: string; color: string }) {
  toast(text, {
    icon: person ? <Avatar name={person.name} color={person.color} size={22} /> : undefined,
    duration: 2200,
  });
}

export function notifyError(text: string) {
  toast.error(text, { duration: 4500 });
}

export function notifyInfo(text: string) {
  toast(text, { duration: 2600 });
}
