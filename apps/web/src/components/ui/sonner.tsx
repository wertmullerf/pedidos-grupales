import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** Notificaciones discretas: blancas, borde fino, sombra gris sutil. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      // Abajo, arriba de la barra de resumen: no tapan el encabezado.
      position="bottom-center"
      gap={8}
      offset={96}
      mobileOffset={{ bottom: 96 }}
      toastOptions={{
        classNames: {
          toast:
            'rounded-lg! border! border-border! bg-background! text-foreground! shadow-md! px-3.5! py-2.5! gap-2.5! text-sm! font-sans!',
          title: 'font-medium!',
          description: 'text-muted-foreground!',
          error: 'border-destructive/30!',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
