import { initial } from '../../lib/format';
import styles from './order.module.css';

export function Avatar({
  name,
  color,
  size = 36,
  online,
}: {
  name: string;
  color: string;
  size?: number;
  online?: boolean;
}) {
  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}
      aria-hidden
    >
      {initial(name)}
      {online !== undefined && (
        <span className={styles.presenceDot} data-online={online || undefined} />
      )}
    </span>
  );
}
