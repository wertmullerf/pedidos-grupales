import { z } from 'zod';
import type { OrderStatus, Participant } from './domain.js';

// DTOs de la API REST bajo /api/t/:tenantSlug.

export interface TenantInfo {
  slug: string;
  name: string;
  primaryColor: string;
  logoUrl: string | null;
}

export interface Branch {
  id: string;
  name: string;
  address: string;
  isOpen: boolean;
}

export interface MenuItem {
  id: string;
  category: string;
  name: string;
  description: string;
  priceCents: number;
  available: boolean;
}

const ParticipantName = z.string().trim().min(1).max(40);

export const CreateOrderBody = z.object({ branchId: z.uuid(), name: ParticipantName });
export const JoinOrderBody = z.object({ name: ParticipantName, clientOpId: z.uuid().optional() });

/** Respuesta de crear pedido y de unirse: el token identifica al participante en ese pedido. */
export interface JoinResponse {
  code: string;
  participant: Participant;
  token: string;
}

/** Vista pública de un pedido: alcanza para la pantalla de "unirse". */
export interface OrderPreview {
  tenant: { slug: string; name: string };
  branch: { name: string; address: string };
  hostName: string;
  participantCount: number;
  status: OrderStatus;
}

export const ORDER_CODE_LENGTH = 6;
