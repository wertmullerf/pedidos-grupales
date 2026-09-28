import type { OrderPreview } from '@pedido/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Wordmark } from '@/components/Wordmark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import { clearIdentity, loadIdentity, saveIdentity, type Identity } from '@/lib/identity';
import { rejectionMessage } from '@/lib/messages';
import { useTenant } from '@/lib/tenant';
import { OrderPage } from './OrderPage';

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
        setLoadError(e.code === 'ORDER_NOT_FOUND' ? `No encontramos el pedido ${code}` : e.message),
      );
  }, [tenant.slug, code]);

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
    <main className="mx-auto min-h-dvh max-w-md px-5 pb-12">
      <header className="pt-12 pb-10">
        <Wordmark name={tenant.name} className="text-[28px]" />
      </header>

      {loadError ? (
        <div className="space-y-5">
          <h1 className="text-xl font-bold">{loadError}</h1>
          <Button variant="outline" asChild>
            <a href={`/t/${tenant.slug}`}>Armar un pedido nuevo</a>
          </Button>
        </div>
      ) : !preview ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Pedido grupal · {code}</p>
            <h1 className="text-2xl leading-tight font-bold tracking-tight">
              {preview.hostName} te invitó a pedir en grupo
            </h1>
            <p className="text-muted-foreground">
              Sucursal {preview.branch.name} · {preview.participantCount}{' '}
              {preview.participantCount === 1 ? 'persona' : 'personas'} en el pedido
            </p>
          </div>

          {closed ? (
            <p className="rounded-lg bg-muted px-4 py-3 text-sm">
              Este pedido ya se cerró y no admite gente nueva.
            </p>
          ) : (
            <form onSubmit={join} className="space-y-3">
              <label htmlFor="guest-name" className="sr-only">
                Tu nombre
              </label>
              <Input
                id="guest-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="¿Cómo te llamás?"
                maxLength={40}
                autoFocus
                autoComplete="given-name"
              />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button size="lg" className="w-full" disabled={!name.trim() || joining}>
                {joining ? 'Sumándote…' : 'Sumarme al pedido'}
              </Button>
            </form>
          )}
        </div>
      )}
    </main>
  );
}
