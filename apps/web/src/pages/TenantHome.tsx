import type { Branch } from '@pedido/shared';
import { ORDER_CODE_LENGTH } from '@pedido/shared';
import { cn } from 'cn';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wordmark } from '@/components/Wordmark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import { saveIdentity } from '@/lib/identity';
import { rejectionMessage } from '@/lib/messages';
import { useTenant } from '@/lib/tenant';

export function TenantHome() {
  const tenant = useTenant();
  const navigate = useNavigate();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.branches(tenant.slug).then((list) => {
      setBranches(list);
      setBranchId(list.find((b) => b.isOpen)?.id ?? null);
    });
  }, [tenant.slug]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!branchId || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.createOrder(tenant.slug, branchId, name.trim());
      saveIdentity(tenant.slug, res.code, {
        token: res.token,
        participantId: res.participant.id,
        name: res.participant.name,
      });
      navigate(`/t/${tenant.slug}/o/${res.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? rejectionMessage(err.code) : 'No pudimos crear el pedido');
      setCreating(false);
    }
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean.length === ORDER_CODE_LENGTH) navigate(`/t/${tenant.slug}/o/${clean}`);
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 pb-12">
      <header className="pt-12 pb-8">
        <Wordmark name={tenant.name} className="text-[34px]" />
        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
          Pedido grupal: cada uno elige lo suyo desde su celular y todos lo ven al instante.
        </p>
      </header>

      <form onSubmit={create} className="space-y-6">
        <h1 className="text-xl font-bold tracking-tight">Armá un pedido grupal</h1>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-muted-foreground">Sucursal</legend>
          {!branches && <Skeleton className="h-32 rounded-lg" />}
          {branches?.map((b) => (
            <label
              key={b.id}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors',
                branchId === b.id && 'border-foreground',
                !b.isOpen && 'cursor-not-allowed opacity-50',
              )}
            >
              <input
                type="radio"
                name="branch"
                value={b.id}
                checked={branchId === b.id}
                disabled={!b.isOpen}
                onChange={() => setBranchId(b.id)}
                className="size-4 accent-foreground"
              />
              <span className="flex-1">
                <span className="block font-semibold">{b.name}</span>
                <span className="block text-sm text-muted-foreground">{b.address}</span>
              </span>
              {!b.isOpen && <span className="text-xs font-medium">Cerrada</span>}
            </label>
          ))}
        </fieldset>

        <div className="space-y-2">
          <label htmlFor="host-name" className="text-sm font-medium text-muted-foreground">
            Tu nombre
          </label>
          <Input
            id="host-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre"
            maxLength={40}
            autoComplete="given-name"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button size="lg" className="w-full" disabled={!branchId || !name.trim() || creating}>
          {creating ? 'Creando…' : 'Crear pedido grupal'}
        </Button>
      </form>

      <Separator className="my-10" />

      <form onSubmit={join} className="space-y-3">
        <h2 className="text-base font-bold">¿Te pasaron un código?</h2>
        <div className="flex gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC234"
            maxLength={ORDER_CODE_LENGTH}
            aria-label="Código del pedido"
            autoCapitalize="characters"
            className="font-semibold tracking-[0.2em] uppercase"
          />
          <Button
            type="submit"
            size="lg"
            variant="outline"
            disabled={code.trim().length !== ORDER_CODE_LENGTH}
          >
            Unirme
          </Button>
        </div>
      </form>
    </main>
  );
}
