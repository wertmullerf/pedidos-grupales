import { totalsByParticipant } from '@pedido/client';
import type { MenuItem, OrderSnapshot } from '@pedido/shared';
import { cn } from 'cn';
import { Check, Share } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { ActivityPanel } from '@/components/order/ActivityPanel';
import { ConnectionStatus } from '@/components/order/ConnectionStatus';
import { FinalSummary } from '@/components/order/FinalSummary';
import { GroupOrder } from '@/components/order/GroupOrder';
import { MenuList } from '@/components/order/MenuList';
import { notifyInfo } from '@/components/order/notify';
import { PeopleRow } from '@/components/order/PeopleRow';
import { SummaryBar } from '@/components/order/SummaryBar';
import { Wordmark } from '@/components/Wordmark';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { DEBUG } from '@/lib/debug';
import type { Identity } from '@/lib/identity';
import { rejectionMessage } from '@/lib/messages';
import { useTenant } from '@/lib/tenant';
import { useOrderLive } from '@/lib/useOrderLive';

type Tab = 'menu' | 'order' | 'activity';

export function OrderPage({
  code,
  identity,
  onInvalidToken,
}: {
  code: string;
  identity: Identity;
  onInvalidToken: () => void;
}) {
  const tenant = useTenant();
  const live = useOrderLive(tenant.slug, identity, onInvalidToken);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [tab, setTab] = useState<Tab>('menu');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.menu(tenant.slug).then(setMenu);
  }, [tenant.slug]);

  const { state, session } = live;
  if (!state) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-5 pt-12" aria-busy="true">
        <Wordmark name={tenant.name} className="text-[22px]" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const me = identity.participantId;
  const isHost = state.order.hostParticipantId === me;
  const status = state.order.status;
  const editable = status === 'open';
  const mine = totalsByParticipant(state).get(me) ?? 0;
  const itemCount = state.items.reduce((n, i) => n + i.quantity, 0);

  if (status === 'submitted') return <SubmittedScreen state={state} me={me} />;

  async function changeStatus(command: 'order:lock' | 'order:unlock' | 'order:submit') {
    setBusy(true);
    const ack = await session.setStatus(command);
    setBusy(false);
    if (!ack.ok) live.notifyError(rejectionMessage(ack.error.code, command));
    else if (command === 'order:lock') setReviewOpen(true);
    else if (command === 'order:unlock') setReviewOpen(false);
  }

  async function share() {
    const url = `${window.location.origin}/t/${tenant.slug}/o/${code}`;
    const text = `Sumate a nuestro pedido de ${tenant.name}: cada uno elige lo suyo.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Pedido grupal ${code}`, text, url });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      notifyInfo('Link copiado');
    } catch {
      notifyInfo(`Compartí este link: ${url}`);
    }
  }

  const tabs: [Tab, string][] = [
    ['menu', 'Menú'],
    ['order', `Pedido · ${itemCount}`],
    ...(DEBUG ? ([['activity', 'Actividad']] as [Tab, string][]) : []),
  ];

  return (
    <div className="min-h-dvh pb-28">
      <header className="sticky top-0 z-20 border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 lg:px-6">
          <Wordmark name={tenant.name} className="text-[21px]" />
          <span className="ml-auto">
            <ConnectionStatus status={live.status} justSynced={live.justSynced} />
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-3 px-4 pt-3 pb-1 lg:px-6">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-[13px] text-muted-foreground">
              Sucursal {state.branch.name} · Sos {identity.name}
            </p>
            <p className="font-semibold">
              Pedido grupal{' '}
              <span className="tracking-[0.08em]" data-testid="order-code">
                {code}
              </span>
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={share}>
            <Share /> Compartir
          </Button>
        </div>
        <PeopleRow state={state} presence={live.presence} me={me} flash={live.flash} />
      </div>

      <div className="sticky top-14 z-10 border-b bg-background lg:hidden">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="px-4">
          <TabsList variant="line" className="h-11 w-full justify-start gap-4">
            {tabs.map(([id, label]) => (
              <TabsTrigger key={id} value={id} className="flex-none px-0 text-[15px]">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <main
        className={cn(
          'mx-auto max-w-6xl px-4 pt-4 lg:grid lg:gap-10 lg:px-6 lg:pt-6',
          DEBUG ? 'lg:grid-cols-[1fr_400px_320px]' : 'lg:grid-cols-[1fr_420px]',
        )}
      >
        <section aria-label="Menú" className={cn(tab !== 'menu' && 'hidden lg:block')}>
          <h2 className="mb-2 hidden text-xl font-bold tracking-tight lg:block">Menú</h2>
          <MenuList
            menu={menu}
            state={state}
            me={me}
            session={session}
            editable={editable}
            onChoosing={live.markChoosing}
          />
        </section>
        <section
          aria-label="Pedido del grupo"
          className={cn(tab !== 'order' && 'hidden lg:block', 'lg:sticky lg:top-20 lg:self-start')}
        >
          <h2 className="mb-4 hidden text-xl font-bold tracking-tight lg:block">
            Pedido del grupo
          </h2>
          <GroupOrder
            state={state}
            me={me}
            session={session}
            editable={editable}
            flash={live.flash}
            onGoToMenu={() => setTab('menu')}
          />
        </section>
        {DEBUG && (
          <aside
            aria-label="Actividad"
            className={cn(
              tab !== 'activity' && 'hidden lg:block',
              'lg:sticky lg:top-20 lg:self-start',
            )}
          >
            <ActivityPanel
              entries={live.activity}
              state={state}
              me={me}
              status={live.status}
              onSimulateDisconnect={() => live.simulateDisconnect()}
            />
          </aside>
        )}
      </main>

      <SummaryBar
        totalCents={state.totalCents}
        mineCents={mine}
        itemCount={itemCount}
        isHost={isHost}
        status={status}
        busy={busy}
        onLock={() => changeStatus('order:lock')}
        onReview={() => setReviewOpen(true)}
        onViewOrder={tab === 'menu' ? () => setTab('order') : undefined}
      />

      <Drawer open={isHost && status === 'locked' && reviewOpen} onOpenChange={setReviewOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Resumen final</DrawerTitle>
            <DrawerDescription>
              Pedido cerrado: nadie más puede cambiar nada. Revisalo antes de enviarlo.
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-5 pb-3">
            <FinalSummary state={state} me={me} />
          </div>
          <DrawerFooter>
            <Button size="lg" onClick={() => changeStatus('order:submit')} disabled={busy}>
              Enviar a sucursal {state.branch.name}
            </Button>
            <Button
              size="lg"
              variant="ghost"
              onClick={() => changeStatus('order:unlock')}
              disabled={busy}
            >
              Reabrir para cambios
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function SubmittedScreen({ state, me }: { state: OrderSnapshot; me: string }) {
  const tenant = useTenant();
  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 pb-12" data-testid="submitted">
      <header className="pt-12 pb-8">
        <Wordmark name={tenant.name} className="text-[22px]" />
      </header>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-6"
      >
        <div className="space-y-3">
          <span className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-6" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">¡Pedido enviado!</h1>
          <p className="text-muted-foreground">
            Ya lo está recibiendo la sucursal {state.branch.name}. Pedido{' '}
            <span className="font-semibold text-foreground">{state.order.code}</span>.
          </p>
        </div>
        <FinalSummary state={state} me={me} />
        <Button variant="outline" className="w-full" asChild>
          <a href={`/t/${tenant.slug}`}>Armar otro pedido</a>
        </Button>
      </motion.div>
    </main>
  );
}
