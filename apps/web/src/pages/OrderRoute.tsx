import type { OrderPreview } from '@pedido/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { api, ApiError } from '../lib/api';
import { clearIdentity, loadIdentity, saveIdentity, type Identity } from '../lib/identity';
import { rejectionMessage } from '../lib/messages';
import { useTenant } from '../lib/tenant';
import { OrderPage } from './OrderPage';
import styles from './OrderRoute.module.css';

export function OrderRoute() {
  const tenant = useTenant();
  const code = (useParams().code ?? '').toUpperCase();
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity(tenant.slug, code));

  if (identity) {
    return (
      <OrderPage
        key={identity.participantId}
        code={code}
        identity={identity}
        onInvalidToken={() => {
          clearIdentity(tenant.slug, code);
          setIdentity(null);
        }}
      />
    );
  }
  return <JoinScreen code={code} onJoined={setIdentity} />;
}

function JoinScreen({ code, onJoined }: { code: string; onJoined: (id: Identity) => void }) {
  const tenant = useTenant();
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .preview(tenant.slug, code)
      .then(setPreview, (e: ApiError) =>
        setLoadError(
          e.code === 'ORDER_NOT_FOUND'
            ? `No encontramos el pedido ${code} en ${tenant.name}`
            : e.message,
        ),
      );
  }, [tenant.slug, tenant.name, code]);

  async function join(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setJoining(true);
    setError(null);
    try {
      const res = await api.joinOrder(tenant.slug, code, name.trim());
      const identity = {
        token: res.token,
        participantId: res.participant.id,
        name: res.participant.name,
      };
      saveIdentity(tenant.slug, code, identity);
      onJoined(identity);
    } catch (err) {
      setError(err instanceof ApiError ? rejectionMessage(err.code) : 'No pudimos sumarte');
      setJoining(false);
    }
  }

  const closed = preview && preview.status !== 'open';

  return (
    <main className={styles.page}>
      <div className={`card ${styles.card}`}>
        <BrandMark tenant={tenant} size={64} />
        {loadError ? (
          <>
            <h1 className={styles.title}>{loadError}</h1>
            <a className="btn btn-secondary" href={`/t/${tenant.slug}`}>
              Armar un pedido nuevo
            </a>
          </>
        ) : !preview ? (
          <div className={styles.loading} aria-busy="true" />
        ) : (
          <>
            <p className={styles.kicker}>Pedido grupal · {code}</p>
            <h1 className={styles.title}>{preview.hostName} te invitó a pedir en grupo</h1>
            <p className={styles.meta}>
              {preview.branch.name} · {preview.participantCount}{' '}
              {preview.participantCount === 1 ? 'persona' : 'personas'} en el pedido
            </p>
            {closed ? (
              <p className={styles.closed}>Este pedido ya se cerró y no admite gente nueva.</p>
            ) : (
              <form className={styles.form} onSubmit={join}>
                <label className="visually-hidden" htmlFor="guest-name">
                  Tu nombre
                </label>
                <input
                  id="guest-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="¿Cómo te llamás?"
                  maxLength={40}
                  autoFocus
                  autoComplete="given-name"
                />
                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}
                <button className="btn btn-primary btn-block" disabled={!name.trim() || joining}>
                  {joining ? 'Sumándote…' : 'Sumarme al pedido'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
