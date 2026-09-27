import { ApiClient, type CommandResponse, type Page } from './api.js';

export interface WebhookEndpoint {
  id: string;
  ownerId: string;
  destinationId: 'sandbox-receiver';
  destinationUrl: string;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  rotatedAt?: string;
}

export interface WebhookEndpointSecret {
  endpoint: WebhookEndpoint;
  signingSecret: string;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  ownerId: string;
  destinationId: 'sandbox-receiver';
  eventId: string;
  eventType: string;
  state: 'PENDING' | 'IN_FLIGHT' | 'DELIVERED' | 'FAILED';
  cycle: number;
  attempts: number;
  totalAttempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  lastError?: string;
}

export interface WebhookAttempt {
  cycle: number;
  attempt: number;
  attemptedAt: string;
  requestTimestamp?: number;
  secretKeyVersion?: number;
  httpStatus?: number;
  outcome: 'DELIVERED' | 'RETRY_SCHEDULED' | 'PERMANENT_FAILURE' | 'EXHAUSTED' | 'LEASE_EXPIRED';
  durationMs: number;
  errorCode?: string;
  responseSummary?: string;
  nextAttemptAt?: string;
}

export interface WebhookDeliveryDetail {
  delivery: WebhookDelivery;
  attempts: WebhookAttempt[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set(['PENDING', 'IN_FLIGHT', 'DELIVERED', 'FAILED']);

function identity(value: string, label: string): string {
  if (!UUID.test(value)) throw new TypeError(`Invalid ${label} identity`);
  return value.toLowerCase();
}

function pagination(limit: number, offset: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset)
      || offset < 0 || offset > 10_000) throw new TypeError('Invalid pagination');
}

function version(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Invalid endpoint version');
  return value;
}

function retryReason(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 500) throw new TypeError('Invalid retry reason');
  return normalized;
}

export class WebhookApi {
  constructor(private readonly api: ApiClient) {}

  createEndpoint(): Promise<CommandResponse<WebhookEndpointSecret>> {
    return this.api.command<WebhookEndpointSecret>('/webhook-endpoints', {
      destinationId: 'sandbox-receiver'
    });
  }

  endpoints(limit = 50, offset = 0): Promise<Page<WebhookEndpoint>> {
    pagination(limit, offset);
    return this.api.get<Page<WebhookEndpoint>>(`/webhook-endpoints?limit=${limit}&offset=${offset}`);
  }

  endpoint(id: string): Promise<WebhookEndpoint> {
    return this.api.get<WebhookEndpoint>(`/webhook-endpoints/${identity(id, 'endpoint')}`);
  }

  setEndpointState(id: string, enabled: boolean, expectedVersion: number):
      Promise<CommandResponse<WebhookEndpoint>> {
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid endpoint state');
    return this.api.command<WebhookEndpoint>(`/webhook-endpoints/${identity(id, 'endpoint')}/state`, {
      enabled,
      expectedVersion: version(expectedVersion)
    });
  }

  rotateSecret(id: string, expectedVersion: number): Promise<CommandResponse<WebhookEndpointSecret>> {
    return this.api.command<WebhookEndpointSecret>(
      `/webhook-endpoints/${identity(id, 'endpoint')}/rotate-secret`,
      { expectedVersion: version(expectedVersion) }
    );
  }

  deliveries(endpointId: string, limit = 50, offset = 0): Promise<Page<WebhookDelivery>> {
    pagination(limit, offset);
    return this.api.get<Page<WebhookDelivery>>(
      `/webhook-endpoints/${identity(endpointId, 'endpoint')}/deliveries?limit=${limit}&offset=${offset}`
    );
  }

  delivery(id: string): Promise<WebhookDeliveryDetail> {
    return this.api.get<WebhookDeliveryDetail>(`/webhook-deliveries/${identity(id, 'delivery')}`);
  }

  retryDelivery(id: string, reason: string): Promise<CommandResponse<WebhookDeliveryDetail>> {
    return this.api.command<WebhookDeliveryDetail>(`/webhook-deliveries/${identity(id, 'delivery')}/retry`, {
      reason: retryReason(reason)
    });
  }

  adminDeliveries(state?: WebhookDelivery['state'], limit = 50, offset = 0):
      Promise<Page<WebhookDelivery>> {
    pagination(limit, offset);
    if (state !== undefined && !STATES.has(state)) throw new TypeError('Invalid delivery state');
    const filter = state === undefined ? '' : `&state=${encodeURIComponent(state)}`;
    return this.api.get<Page<WebhookDelivery>>(
      `/admin/webhook-deliveries?limit=${limit}&offset=${offset}${filter}`
    );
  }

  adminDelivery(id: string): Promise<WebhookDeliveryDetail> {
    return this.api.get<WebhookDeliveryDetail>(`/admin/webhook-deliveries/${identity(id, 'delivery')}`);
  }

  adminRetry(id: string, reason: string): Promise<CommandResponse<WebhookDeliveryDetail>> {
    return this.api.command<WebhookDeliveryDetail>(
      `/admin/webhook-deliveries/${identity(id, 'delivery')}/retry`,
      { reason: retryReason(reason) }
    );
  }
}
