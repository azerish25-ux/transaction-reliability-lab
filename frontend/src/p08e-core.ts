import type { ApiClient, CommandResponse, Page } from './api.js';
import { WebhookApi, type WebhookEndpoint, type WebhookDelivery, type WebhookDeliveryDetail, type WebhookAttempt } from './webhook-api.js';

export type WebhookCommand = { kind: 'CREATE' }
  | { kind: 'STATE'; endpointId: string; enabled: boolean; expectedVersion: number }
  | { kind: 'ROTATE'; endpointId: string; expectedVersion: number }
  | { kind: 'RETRY'; deliveryId: string; expectedCycle: number; reason: string };
export interface WebhookReceipt {
  commandId: string; kind: WebhookCommand['kind']; endpointId: string; deliveryId: string | null;
  appliedVersion: number | null; appliedCycle: number | null; completedAt: string; replayed: boolean;
}
export interface WebhookCommandResult { command: WebhookReceipt; signingSecret?: string | null; }
export interface SavedWebhookCommand {
  schema: 1; ownerId: string; key: string; command: WebhookCommand;
  state: 'PREPARED' | 'UNCERTAIN'; createdAt: string;
}
export interface WebhookStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const WEBHOOK_PAGE_SIZE = 20;
export function webhookId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError('Invalid webhook reference');
  return value.toLowerCase();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid webhook record');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError('Unexpected webhook fields');
}
function positive(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new TypeError('Invalid webhook version or cycle');
  return value;
}
function count(value: unknown, max = 2_147_483_647): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new TypeError('Invalid webhook count');
  return value;
}
function text(value: unknown, max = 2048): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new TypeError('Invalid webhook text');
  return value;
}
function instant(value: unknown): string {
  const result = text(value, 80);
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result))) throw new TypeError('Invalid webhook timestamp');
  return result;
}
function optionalText(value: unknown, max = 2048): string | undefined { return value == null || value === '' ? undefined : text(value, max); }
function optionalInstant(value: unknown): string | undefined { return value == null ? undefined : instant(value); }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new TypeError('Invalid webhook flag'); return value; }
function secretFree(value: Record<string, unknown>): void {
  if (['signingSecret', 'encryptedSecret', 'secret', 'signature'].some(key => key in value)) throw new TypeError('Sensitive fields in ordinary webhook record');
}
export function normalizeWebhookCommand(input: unknown): WebhookCommand {
  const value = object(input);
  switch (value.kind) {
    case 'CREATE': keys(value, ['kind']); return Object.freeze({ kind: 'CREATE' });
    case 'STATE':
      keys(value, ['kind', 'endpointId', 'enabled', 'expectedVersion']);
      return Object.freeze({ kind: 'STATE', endpointId: webhookId(value.endpointId), enabled: boolean(value.enabled), expectedVersion: positive(value.expectedVersion, Number.MAX_SAFE_INTEGER - 1) });
    case 'ROTATE':
      keys(value, ['kind', 'endpointId', 'expectedVersion']);
      return Object.freeze({ kind: 'ROTATE', endpointId: webhookId(value.endpointId), expectedVersion: positive(value.expectedVersion, Number.MAX_SAFE_INTEGER - 1) });
    case 'RETRY': {
      keys(value, ['kind', 'deliveryId', 'expectedCycle', 'reason']);
      const reason = text(value.reason, 1000).trim();
      if (!reason || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason)) throw new TypeError('Enter a retry reason of 1–500 characters without control characters');
      return Object.freeze({ kind: 'RETRY', deliveryId: webhookId(value.deliveryId), expectedCycle: positive(value.expectedCycle, 2_147_483_646), reason });
    }
    default: throw new TypeError('Invalid webhook command');
  }
}

export function validateWebhookEndpoint(input: unknown, ownerId: string, expectedId?: string): WebhookEndpoint {
  const value = object(input); secretFree(value);
  const id = webhookId(value.id);
  if (webhookId(value.ownerId) !== webhookId(ownerId) || (expectedId && id !== webhookId(expectedId)) || value.destinationId !== 'sandbox-receiver') throw new TypeError('Mismatched webhook ownership or destination');
  return { id, ownerId: webhookId(ownerId), destinationId: 'sandbox-receiver', destinationUrl: text(value.destinationUrl),
    enabled: boolean(value.enabled), version: positive(value.version), createdAt: instant(value.createdAt), updatedAt: instant(value.updatedAt), rotatedAt: optionalInstant(value.rotatedAt) };
}
export function validateWebhookDelivery(input: unknown, ownerId: string, expectedEndpoint?: string): WebhookDelivery {
  const value = object(input); secretFree(value);
  if (webhookId(value.ownerId) !== webhookId(ownerId) || (expectedEndpoint && webhookId(value.endpointId) !== webhookId(expectedEndpoint))
      || value.destinationId !== 'sandbox-receiver' || !['PENDING', 'IN_FLIGHT', 'DELIVERED', 'FAILED'].includes(String(value.state))) throw new TypeError('Invalid delivery ownership or state');
  const attempts = count(value.attempts, 8), totalAttempts = count(value.totalAttempts);
  if (value.state === 'DELIVERED' && !value.deliveredAt) throw new TypeError('Inconsistent delivery history');
  return { id: webhookId(value.id), endpointId: webhookId(value.endpointId), ownerId: webhookId(ownerId), destinationId: 'sandbox-receiver',
    eventId: webhookId(value.eventId), eventType: text(value.eventType, 100), state: value.state as WebhookDelivery['state'],
    cycle: positive(value.cycle, 2_147_483_647), attempts, totalAttempts, nextAttemptAt: instant(value.nextAttemptAt),
    createdAt: instant(value.createdAt), updatedAt: instant(value.updatedAt), deliveredAt: optionalInstant(value.deliveredAt), lastError: optionalText(value.lastError, 200) };
}
function validateAttempt(input: unknown): WebhookAttempt {
  const value = object(input); secretFree(value);
  const outcomes = ['DELIVERED', 'RETRY_SCHEDULED', 'PERMANENT_FAILURE', 'EXHAUSTED', 'LEASE_EXPIRED'];
  if (!outcomes.includes(String(value.outcome))) throw new TypeError('Invalid attempt outcome');
  const httpStatus = value.httpStatus == null ? undefined : positive(value.httpStatus, 599);
  if (httpStatus !== undefined && httpStatus < 100) throw new TypeError('Invalid HTTP status');
  return { cycle: positive(value.cycle, 2_147_483_647), attempt: positive(value.attempt, 8), attemptedAt: instant(value.attemptedAt),
    requestTimestamp: value.requestTimestamp == null ? undefined : count(value.requestTimestamp, Number.MAX_SAFE_INTEGER),
    secretKeyVersion: value.secretKeyVersion == null ? undefined : positive(value.secretKeyVersion, 2_147_483_647), httpStatus,
    outcome: value.outcome as WebhookAttempt['outcome'], durationMs: count(value.durationMs), errorCode: optionalText(value.errorCode, 200),
    responseSummary: optionalText(value.responseSummary, 1000), nextAttemptAt: optionalInstant(value.nextAttemptAt) };
}
export function validateWebhookDetail(input: unknown, owner: string, id: string): WebhookDeliveryDetail {
  const value = object(input); secretFree(value);
  const delivery = validateWebhookDelivery(value.delivery, owner);
  if (delivery.id !== webhookId(id) || !Array.isArray(value.attempts)) throw new TypeError('Mismatched webhook detail');
  const attempts = value.attempts.map(validateAttempt);
  const identities = attempts.map(attempt => `${attempt.cycle}:${attempt.attempt}`);
  if (new Set(identities).size !== identities.length) throw new TypeError('Inconsistent attempt identities');
  return { delivery, attempts };
}
function page<T>(input: unknown, validate: (row: unknown) => T, limit: number, offset: number): Page<T> {
  const value = object(input); secretFree(value);
  if (value.limit !== limit || value.offset !== offset || !Array.isArray(value.items) || value.items.length > limit || typeof value.hasMore !== 'boolean') throw new TypeError('Invalid webhook page');
  return { items: value.items.map(validate), limit, offset, hasMore: value.hasMore };
}

export class WebhookOutcomeUnknown extends Error {
  constructor() { super('Webhook outcome not yet confirmed. Resolve the preserved command; do not issue a replacement or rotate again.'); this.name = 'WebhookOutcomeUnknown'; }
}
export function validateWebhookResult(input: unknown, command: WebhookCommand, key: string, readOnly = false): WebhookCommandResult {
  try {
    const value = object(input), r = object(value.command); secretFree(r);
    if (webhookId(r.commandId) !== webhookId(key) || r.kind !== command.kind || (readOnly && r.replayed !== true)) throw new TypeError('Mismatched command receipt');
    const endpointId = webhookId(r.endpointId), replayed = boolean(r.replayed);
    const appliedVersion = r.appliedVersion == null ? null : positive(r.appliedVersion);
    const appliedCycle = r.appliedCycle == null ? null : positive(r.appliedCycle, 2_147_483_647);
    const deliveryId = r.deliveryId == null ? null : webhookId(r.deliveryId);
    if (command.kind === 'CREATE' && (appliedVersion !== 1 || deliveryId !== null || appliedCycle !== null)) throw new TypeError('Invalid creation receipt');
    if ((command.kind === 'STATE' || command.kind === 'ROTATE') && (endpointId !== command.endpointId || appliedVersion !== command.expectedVersion + 1 || deliveryId !== null || appliedCycle !== null)) throw new TypeError('Invalid versioned receipt');
    if (command.kind === 'RETRY' && (deliveryId !== command.deliveryId || appliedCycle !== command.expectedCycle + 1 || appliedVersion !== null)) throw new TypeError('Invalid retry receipt');
    const secretExpected = !readOnly && !replayed && (command.kind === 'CREATE' || command.kind === 'ROTATE');
    if (secretExpected ? typeof value.signingSecret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.signingSecret) : value.signingSecret != null) throw new TypeError('Invalid one-time secret disclosure');
    return { command: { commandId: webhookId(key), kind: command.kind, endpointId, deliveryId, appliedVersion, appliedCycle,
      completedAt: instant(r.completedAt), replayed }, signingSecret: secretExpected ? value.signingSecret as string : null };
  } catch { throw new WebhookOutcomeUnknown(); }
}
export class P08EApi extends WebhookApi {
  constructor(private readonly transport: ApiClient, private readonly owner: string) { super(transport); webhookId(owner); }
  override async endpoints(limit = WEBHOOK_PAGE_SIZE, offset = 0): Promise<Page<WebhookEndpoint>> {
    return page(await super.endpoints(limit, offset), row => validateWebhookEndpoint(row, this.owner), limit, offset);
  }
  override async endpoint(id: string): Promise<WebhookEndpoint> { return validateWebhookEndpoint(await super.endpoint(id), this.owner, id); }
  override async deliveries(id: string, limit = WEBHOOK_PAGE_SIZE, offset = 0): Promise<Page<WebhookDelivery>> {
    return page(await super.deliveries(id, limit, offset), row => validateWebhookDelivery(row, this.owner, id), limit, offset);
  }
  override async delivery(id: string): Promise<WebhookDeliveryDetail> { return validateWebhookDetail(await super.delivery(id), this.owner, id); }
  async execute(input: WebhookCommand, key: string): Promise<WebhookCommandResult> {
    const command = normalizeWebhookCommand(input), normalizedKey = webhookId(key);
    const response: CommandResponse<unknown> = await this.transport.command('/webhook-commands', command, normalizedKey);
    if (response.status !== 200) throw new WebhookOutcomeUnknown();
    return validateWebhookResult(response.body, command, normalizedKey);
  }
  async resolve(saved: SavedWebhookCommand): Promise<WebhookCommandResult> {
    if (saved.ownerId !== this.owner) throw new TypeError('Saved webhook belongs to another customer');
    return validateWebhookResult(await this.transport.get(`/webhook-commands/${webhookId(saved.key)}`), saved.command, saved.key, true);
  }
}

/** Only whitelisted request metadata survives reload; no response object ever enters storage. */
export class WebhookIntentStore {
  readonly storageKey: string;
  private readonly owner: string;
  constructor(private readonly storage: WebhookStorage, ownerId: string) {
    this.owner = webhookId(ownerId); this.storageKey = `ledgerguard.webhook.intent.v1.${this.owner}`;
  }
  current(): SavedWebhookCommand | undefined {
    const raw = this.storage.getItem(this.storageKey);
    if (raw === null) return undefined;
    const value = object(JSON.parse(raw));
    keys(value, ['schema', 'ownerId', 'key', 'command', 'state', 'createdAt']);
    if (value.schema !== 1 || value.ownerId !== this.owner || !['PREPARED', 'UNCERTAIN'].includes(String(value.state))) throw new TypeError('Saved webhook command cannot be verified; changes are blocked');
    return { schema: 1, ownerId: this.owner, key: webhookId(value.key), command: normalizeWebhookCommand(value.command),
      state: value.state as SavedWebhookCommand['state'], createdAt: instant(value.createdAt) };
  }
  prepare(command: WebhookCommand, key: string): SavedWebhookCommand {
    const normalized = normalizeWebhookCommand(command), existing = this.current();
    if (existing) {
      if (JSON.stringify(existing.command) !== JSON.stringify(normalized)) throw new Error('Resolve the preserved webhook command before issuing another');
      return existing;
    }
    const saved: SavedWebhookCommand = { schema: 1, ownerId: this.owner, key: webhookId(key), command: normalized, state: 'PREPARED', createdAt: new Date().toISOString() };
    this.write(saved); return saved;
  }
  uncertain(key: string): void {
    const saved = this.current();
    if (!saved || saved.key !== webhookId(key)) throw new Error('Preserved webhook command changed; no replacement was sent');
    this.write({ ...saved, state: 'UNCERTAIN' });
  }
  complete(key: string): void {
    const saved = this.current();
    if (saved && saved.key === webhookId(key)) {
      this.storage.removeItem(this.storageKey);
      if (this.storage.getItem(this.storageKey) !== null) throw new Error('Saved webhook command could not be cleared');
    }
  }
  private write(saved: SavedWebhookCommand): void {
    const encoded = JSON.stringify(saved);
    this.storage.setItem(this.storageKey, encoded);
    if (this.storage.getItem(this.storageKey) !== encoded) throw new Error('Webhook command could not be preserved; nothing was sent');
  }
}
export function webhookLabel(command: WebhookCommand): string {
  return command.kind === 'CREATE' ? 'Create subscription' : command.kind === 'ROTATE' ? 'Rotate signing secret'
    : command.kind === 'RETRY' ? 'Request delivery retry' : command.enabled ? 'Enable subscription' : 'Disable subscription';
}
export function webhookResultPath(result: WebhookCommandResult): string {
  return result.command.deliveryId ? `/webhooks/deliveries/${result.command.deliveryId}` : `/webhooks/${result.command.endpointId}`;
}
export function webhookTime(value?: string): string {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) + ' UTC';
}
