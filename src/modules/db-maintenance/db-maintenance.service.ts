import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import {
  OrderModel,
  OrderStatusEnum,
} from '@schemas/order.schema';
import {
  StripeProcessedCheckoutModel,
} from '@schemas/stripe-processed-checkout.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Connection, Model } from 'mongoose';
import { StoreAccessService } from '../teams/store-access.service';
import { InjectModel } from '@nestjs/mongoose';
import Stripe = require('stripe');
import {
  DB_CLEARABLE_TABLES,
  DbClearableTableCategory,
  DbClearableTableDef,
  getClearableTable,
  isClearableTableKey,
} from './db-clearable-tables';

export type DbTableListItem = {
  key: string;
  collection: string;
  labelFr: string;
  labelEn: string;
  category: DbClearableTableCategory;
  critical: boolean;
  documentCount: number;
};

export type ClearDbTablesResult = {
  cleared: Array<{ key: string; collection: string; deletedCount: number }>;
};

export type IntegrityTestDefinition = {
  key: string;
  label: string;
  description: string;
};

export type IntegrityTestRunResult = {
  key: string;
  label: string;
  totalEvaluateTimeMs: number;
  successRuns: number;
  totalRuns: number;
  score: number;
  confidence: number;
  summary: string;
  checkedAt: string;
  sampleFailures: Array<{
    orderId: string;
    issues: string[];
  }>;
};

export type SystemHealthCheckDefinition = {
  key: string;
  label: string;
  description: string;
};

export type SystemHealthCheckResult = {
  key: string;
  label: string;
  totalEvaluateTimeMs: number;
  status: 'healthy' | 'degraded' | 'down';
  score: number;
  confidence: number;
  details: string;
  checkedAt: string;
};

@Injectable()
export class DbMaintenanceService {
  private readonly logger = new Logger(DbMaintenanceService.name);
  private readonly stripeFactory = Stripe;
  private readonly integrityTests: IntegrityTestDefinition[] = [
    {
      key: 'order-payment-test',
      label: 'Order Payment Test',
      description:
        'Vérifie toutes les commandes marquées payées: transaction Stripe liée, montants et statut.',
    },
  ];
  private readonly systemHealthChecks: SystemHealthCheckDefinition[] = [
    {
      key: 'mongodb-status',
      label: 'MongoDB status',
      description: 'Vérifie la connectivité MongoDB via ping.',
    },
    {
      key: 'websocket-service-status',
      label: 'Websocket Service status',
      description: 'Vérifie la disponibilité du service WS (/api/health).',
    },
    {
      key: 'api-function-status',
      label: 'API Function Status',
      description: 'Vérifie l’état global de l’API (uptime + ping DB).',
    },
    {
      key: 'stripe-payment-status',
      label: 'Stripe payment Status',
      description: 'Vérifie la connectivité Stripe via balance.retrieve.',
    },
    {
      key: 'map-engine-status',
      label: 'Map Engine Status',
      description: 'Vérifie la disponibilité Mapbox geocoding.',
    },
  ];

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
    private readonly storeAccess: StoreAccessService,
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    @InjectModel(StripeProcessedCheckoutModel.name)
    private readonly processedModel: Model<StripeProcessedCheckoutModel>,
  ) {}

  private assertMaintenanceEnabled(): void {
    const raw = this.config.get<string>('ALLOW_DB_MAINTENANCE');
    const normalized = String(raw ?? '').trim().toLowerCase();
    if (normalized === 'false' || normalized === '0') {
      throw new ForbiddenException('db_maintenance_disabled');
    }
    const nodeEnv = String(this.config.get('NODE_ENV') ?? process.env.NODE_ENV ?? '')
      .trim()
      .toLowerCase();
    if (nodeEnv === 'production' && normalized !== 'true' && normalized !== '1') {
      throw new ForbiddenException('db_maintenance_disabled');
    }
  }

  async assertAdminMaintainer(user: UserModel): Promise<void> {
    await this.assertAdminSettingsPermission(user);
    this.assertMaintenanceEnabled();
  }

  async assertAdminSettingsPermission(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this.storeAccess.assertAdminPermission(user, 'admin.settings');
  }

  async listTables(user: UserModel): Promise<{ tables: DbTableListItem[] }> {
    await this.assertAdminMaintainer(user);
    const db = this.connection.db;
    if (!db) {
      throw new BadRequestException('database_unavailable');
    }

    const tables: DbTableListItem[] = [];
    for (const def of DB_CLEARABLE_TABLES) {
      const documentCount = await this.countCollection(db, def);
      tables.push(this.toListItem(def, documentCount));
    }
    return { tables };
  }

  async clearTables(
    user: UserModel,
    keys: string[],
  ): Promise<ClearDbTablesResult> {
    await this.assertAdminMaintainer(user);

    const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
    if (!unique.length) {
      throw new BadRequestException('no_tables_selected');
    }
    for (const key of unique) {
      if (!isClearableTableKey(key)) {
        throw new BadRequestException(`unknown_table:${key}`);
      }
    }

    const db = this.connection.db;
    if (!db) {
      throw new BadRequestException('database_unavailable');
    }

    const cleared: ClearDbTablesResult['cleared'] = [];
    for (const key of unique) {
      const def = getClearableTable(key)!;
      const res = await db.collection(def.collection).deleteMany({});
      const deletedCount = res.deletedCount ?? 0;
      cleared.push({
        key: def.key,
        collection: def.collection,
        deletedCount,
      });
      this.logger.warn(
        `DB maintenance: ${user.id} cleared ${def.collection} (${deletedCount} doc(s))`,
      );
    }

    return { cleared };
  }

  async listIntegrityTests(
    user: UserModel,
  ): Promise<{ tests: IntegrityTestDefinition[] }> {
    await this.assertAdminSettingsPermission(user);
    return { tests: this.integrityTests };
  }

  async runIntegrityTest(
    user: UserModel,
    key: string,
  ): Promise<{ result: IntegrityTestRunResult }> {
    await this.assertAdminSettingsPermission(user);
    const normalized = String(key || '').trim().toLowerCase();
    switch (normalized) {
      case 'order-payment-test':
        return { result: await this.runOrderPaymentIntegrityTest() };
      default:
        throw new BadRequestException(`unknown_integrity_test:${normalized}`);
    }
  }

  async listSystemHealthChecks(
    user: UserModel,
  ): Promise<{ checks: SystemHealthCheckDefinition[] }> {
    await this.assertAdminSettingsPermission(user);
    return { checks: this.systemHealthChecks };
  }

  async runSystemHealthCheck(
    user: UserModel,
    key: string,
  ): Promise<{ result: SystemHealthCheckResult }> {
    await this.assertAdminSettingsPermission(user);
    const normalized = String(key || '').trim().toLowerCase();
    switch (normalized) {
      case 'mongodb-status':
        return { result: await this.runMongoHealthCheck() };
      case 'websocket-service-status':
        return { result: await this.runWebsocketHealthCheck() };
      case 'api-function-status':
        return { result: await this.runApiFunctionHealthCheck() };
      case 'stripe-payment-status':
        return { result: await this.runStripeHealthCheck() };
      case 'map-engine-status':
        return { result: await this.runMapEngineHealthCheck() };
      default:
        throw new BadRequestException(`unknown_system_health_check:${normalized}`);
    }
  }

  private async runOrderPaymentIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const label = 'Order Payment Test';

    const paidOrders = await this.orderModel
      .find({ status: OrderStatusEnum.PAIED })
      .select([
        '_id',
        'status',
        'stripeParentPaymentId',
        'totalPrice',
        'stripeChargedGoodsCents',
        'stripeChargedShipCents',
      ])
      .lean()
      .exec();

    const totalRuns = paidOrders.length;
    if (!totalRuns) {
      return {
        key: 'order-payment-test',
        label,
        totalEvaluateTimeMs: Date.now() - startedAt,
        successRuns: 0,
        totalRuns: 0,
        score: 100,
        confidence: 100,
        summary: 'Aucune commande marquée payée à vérifier.',
        checkedAt: checkedAtIso,
        sampleFailures: [],
      };
    }

    const paymentIds = [...new Set(
      paidOrders
        .map((o) => String((o as { stripeParentPaymentId?: unknown }).stripeParentPaymentId ?? '').trim())
        .filter((x) => x.length > 0),
    )];

    const processedDocs = await this.processedModel
      .find({ sessionId: { $in: paymentIds } })
      .select(['sessionId', 'orderIds', 'perStoreBreakdown', 'amountTotalCents'])
      .lean()
      .exec();
    const processedByPaymentId = new Map(
      processedDocs.map((d) => [String(d.sessionId), d]),
    );

    const stripeByPaymentId = await this.fetchStripePaymentsById(paymentIds);
    const sampleFailures: IntegrityTestRunResult['sampleFailures'] = [];
    let successRuns = 0;
    let remoteStatusChecked = 0;

    for (const order of paidOrders) {
      const orderId = String(order._id);
      const issues: string[] = [];
      const paymentId = String(
        (order as { stripeParentPaymentId?: unknown }).stripeParentPaymentId ?? '',
      ).trim();

      if (!paymentId) {
        issues.push('missing_stripe_parent_payment_id');
      }

      const expectedOrderCents = Math.round(
        Number((order as { totalPrice?: unknown }).totalPrice ?? 0) * 100,
      );

      if (paymentId) {
        const processed = processedByPaymentId.get(paymentId);
        if (!processed) {
          issues.push('missing_stripe_processed_checkout');
        } else {
          const orderIds = Array.isArray(processed.orderIds)
            ? processed.orderIds.map((x) => String(x))
            : [];
          const inOrderIds = orderIds.includes(orderId);
          const inBreakdown = Array.isArray(processed.perStoreBreakdown)
            ? processed.perStoreBreakdown.some(
                (row) =>
                  String((row as { orderId?: unknown }).orderId ?? '') === orderId,
              )
            : false;
          if (!inOrderIds && !inBreakdown) {
            issues.push('order_not_linked_in_processed_checkout');
          }
          if (
            typeof processed.amountTotalCents === 'number' &&
            processed.amountTotalCents > 0 &&
            expectedOrderCents > processed.amountTotalCents
          ) {
            issues.push('order_amount_exceeds_parent_payment');
          }
        }

        const stripeTx = stripeByPaymentId.get(paymentId);
        if (!stripeTx) {
          issues.push('missing_stripe_transaction');
        } else {
          remoteStatusChecked += 1;
          if (!stripeTx.isPaid) {
            issues.push(`stripe_status_not_paid:${stripeTx.status}`);
          }
          if (
            typeof stripeTx.amountCents === 'number' &&
            stripeTx.amountCents > 0 &&
            expectedOrderCents > stripeTx.amountCents
          ) {
            issues.push('order_amount_exceeds_stripe_amount');
          }
        }
      }

      const chargedGoods = Number(
        (order as { stripeChargedGoodsCents?: unknown }).stripeChargedGoodsCents ?? 0,
      );
      const chargedShip = Number(
        (order as { stripeChargedShipCents?: unknown }).stripeChargedShipCents ?? 0,
      );
      const chargedTotal = chargedGoods + chargedShip;
      if (chargedTotal <= 0) {
        issues.push('missing_charged_amount_fields');
      } else if (Math.abs(chargedTotal - expectedOrderCents) > 1) {
        issues.push('charged_amount_mismatch');
      }

      if (!issues.length) {
        successRuns += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({ orderId, issues });
      }
    }

    const scoreRaw = (successRuns / totalRuns) * 100;
    const score = Number(scoreRaw.toFixed(2));
    const coverage = remoteStatusChecked / totalRuns;
    const failureRate = 1 - successRuns / totalRuns;
    const confidenceRaw = (0.55 * coverage + 0.45 * (1 - failureRate)) * 100;
    const confidence = Math.max(35, Math.min(99, Number(confidenceRaw.toFixed(2))));

    return {
      key: 'order-payment-test',
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary: `${successRuns}/${totalRuns} commandes payées valides`,
      checkedAt: checkedAtIso,
      sampleFailures,
    };
  }

  private stripeClient(): InstanceType<typeof Stripe> | null {
    const sk = String(this.config.get<string>('STRIPE_SECRET_KEY') ?? '').trim();
    if (!sk.startsWith('sk_')) return null;
    return new this.stripeFactory(sk);
  }

  private normalizeHealthResult(input: {
    key: string;
    label: string;
    startedAtMs: number;
    status: SystemHealthCheckResult['status'];
    details: string;
  }): SystemHealthCheckResult {
    const elapsed = Math.max(0, Date.now() - input.startedAtMs);
    let score = 100;
    let confidence = 95;
    if (input.status === 'degraded') {
      score = 65;
      confidence = 80;
    } else if (input.status === 'down') {
      score = 20;
      confidence = 90;
    }
    return {
      key: input.key,
      label: input.label,
      totalEvaluateTimeMs: elapsed,
      status: input.status,
      score,
      confidence,
      details: input.details,
      checkedAt: new Date().toISOString(),
    };
  }

  private async runMongoHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'mongodb-status';
    const label = 'MongoDB status';
    const db = this.connection.db;
    if (!db) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: 'MongoDB indisponible (connexion non initialisée).',
      });
    }
    try {
      const pingRes = (await db.admin().ping()) as { ok?: number };
      const ok = Number(pingRes?.ok ?? 0) === 1;
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: ok ? 'healthy' : 'degraded',
        details: ok ? 'Ping MongoDB OK.' : `Ping MongoDB inattendu: ${JSON.stringify(pingRes)}`,
      });
    } catch (e) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: `Erreur ping MongoDB: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private async runWebsocketHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'websocket-service-status';
    const label = 'Websocket Service status';
    const base =
      String(this.config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL') ?? '').trim() ||
      'http://localhost:8000';
    const url = `${base.replace(/\/$/, '')}/api/health`;
    try {
      const res = await this.fetchWithTimeout(url, 5000);
      if (!res.ok) {
        return this.normalizeHealthResult({
          key,
          label,
          startedAtMs,
          status: 'down',
          details: `WS health HTTP ${res.status}`,
        });
      }
      const body = await res.text();
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'healthy',
        details: body.slice(0, 180) || 'WS health endpoint OK.',
      });
    } catch (e) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: `WS health unreachable: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private async runApiFunctionHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'api-function-status';
    const label = 'API Function Status';
    const db = this.connection.db;
    if (!db) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: 'Connexion DB non initialisée.',
      });
    }
    try {
      await db.admin().ping();
      const uptimeSec = Math.floor(process.uptime());
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'healthy',
        details: `API up. Uptime=${uptimeSec}s, DB ping OK.`,
      });
    } catch (e) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'degraded',
        details: `API up mais DB ping KO: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private async runStripeHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'stripe-payment-status';
    const label = 'Stripe payment Status';
    const stripe = this.stripeClient();
    if (!stripe) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: 'STRIPE_SECRET_KEY non configurée.',
      });
    }
    try {
      const bal = await stripe.balance.retrieve();
      const cur = (bal.available?.[0]?.currency ?? '').toUpperCase();
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'healthy',
        details: `Stripe reachable. Solde disponible entrées=${bal.available?.length ?? 0}${cur ? ` (${cur})` : ''}.`,
      });
    } catch (e) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: `Stripe error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private async runMapEngineHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'map-engine-status';
    const label = 'Map Engine Status';
    const apiUrl = String(this.config.get<string>('MAP_BOX_API_URL') ?? '').trim();
    const token = String(this.config.get<string>('MAPBOX_ACCESS_TOKEN') ?? '').trim();
    if (!apiUrl || !token) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: 'Mapbox URL/token non configurés.',
      });
    }
    try {
      const url = new URL(apiUrl);
      url.searchParams.set('q', 'Montreal')
      url.searchParams.set('limit', '1');
      url.searchParams.set('access_token', token);
      const res = await this.fetchWithTimeout(url.toString(), 7000);
      if (!res.ok) {
        return this.normalizeHealthResult({
          key,
          label,
          startedAtMs,
          status: 'down',
          details: `Map engine HTTP ${res.status}`,
        });
      }
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'healthy',
        details: 'Map engine reachable.',
      });
    } catch (e) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: `Map engine error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private async fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal, method: 'GET' });
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchStripePaymentsById(
    paymentIds: string[],
  ): Promise<Map<string, { status: string; isPaid: boolean; amountCents: number }>> {
    const out = new Map<
      string,
      { status: string; isPaid: boolean; amountCents: number }
    >();
    const stripe = this.stripeClient();
    if (!stripe) return out;

    for (const id of paymentIds) {
      try {
        if (id.startsWith('pi_')) {
          const pi = await stripe.paymentIntents.retrieve(id);
          out.set(id, {
            status: String(pi.status ?? 'unknown'),
            isPaid: pi.status === 'succeeded',
            amountCents:
              typeof pi.amount_received === 'number'
                ? pi.amount_received
                : typeof pi.amount === 'number'
                  ? pi.amount
                  : 0,
          });
          continue;
        }
        if (id.startsWith('cs_')) {
          const session = await stripe.checkout.sessions.retrieve(id);
          out.set(id, {
            status: String(session.payment_status ?? session.status ?? 'unknown'),
            isPaid: session.payment_status === 'paid',
            amountCents:
              typeof session.amount_total === 'number' ? session.amount_total : 0,
          });
        }
      } catch (e) {
        this.logger.warn(
          `Integrity order-payment-test: Stripe lookup failed for ${id}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    return out;
  }

  private toListItem(
    def: DbClearableTableDef,
    documentCount: number,
  ): DbTableListItem {
    return {
      key: def.key,
      collection: def.collection,
      labelFr: def.labelFr,
      labelEn: def.labelEn,
      category: def.category,
      critical: !!def.critical,
      documentCount,
    };
  }

  private async countCollection(
    db: NonNullable<Connection['db']>,
    def: DbClearableTableDef,
  ): Promise<number> {
    try {
      return await db.collection(def.collection).countDocuments();
    } catch {
      return 0;
    }
  }
}
