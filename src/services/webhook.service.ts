import axios from "axios";
import { env } from "../config/env";
import {
  BUDGETS,
  DECISION_MAKERS,
  LOCATIONS,
  PROJECT_TYPES,
  PROPERTY_STATUSES,
  START_TIMEFRAMES,
} from "../config/leadOptions";
import { ILead, Lead, LeadStage } from "../models/lead.model";

const WEBHOOK_TIMEOUT_MS = 8000;
/** El log es para diagnóstico: con los últimos envíos alcanza. */
const WEBHOOK_LOG_MAX = 50;

/** Lo mínimo del lead que necesita el payload: sirve un documento, un lean o un objeto de prueba. */
export type WebhookLead = Pick<
  ILead,
  | "firstName"
  | "lastName"
  | "email"
  | "phoneE164"
  | "phoneCountry"
  | "startTimeframe"
  | "commitment"
  | "qualified"
> & {
  _id?: unknown;
  createdAt?: Date;
  metrics?: Partial<ILead["metrics"]>;
  pageUrl?: string;
  utm?: Partial<ILead["utm"]>;
  qualification?: Partial<ILead["qualification"]>;
  payment?: Partial<ILead["payment"]>;
};

/** Todos los campos viajan siempre; lo que aún no se conoce va como string vacío. */
export interface LeadWebhookPayload {
  stage: LeadStage;
  lead_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  phone: string;
  phone_country: string;
  start_timeframe: string;
  start_timeframe_label: string;
  commitment: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  page_url: string;
  created_at: string;
  project_type: string;
  project_type_label: string;
  budget: string;
  budget_label: string;
  property_status: string;
  property_status_label: string;
  location: string;
  location_label: string;
  decision_maker: string;
  decision_maker_label: string;
  qualified: string;
  payment_method: string;
  payment_status: string;
  payment_amount_usd: string;
  payment_transaction_id: string;
  payment_receipt_url: string;
  urgency: string;
  tags: string;
  notes: string;
  time_on_page_seconds: number | "";
  time_on_page_label: string;
  landing_seconds: number | "";
  video_page_seconds: number | "";
  device: string;
  test: string;
}

export interface WebhookResult {
  ok: boolean;
  /** 0 = no hubo respuesta HTTP (sin URL, timeout o error de red). */
  status: number;
  body: unknown;
  skipped: boolean;
}

function label(options: Record<string, string>, value: string | undefined): string {
  return (value && options[value]) || "";
}

/** Qué tan pronto quiere arrancar: es lo que el equipo comercial prioriza. */
const URGENCY: Record<string, string> = {
  inmediato: "muy alta",
  "1-3-meses": "alta",
  "3-6-meses": "media",
  "mas-6-meses": "baja",
  explorando: "muy baja",
};

export function formatDuration(seconds: number): string {
  if (!seconds) return "";
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (!min) return `${sec} s`;
  return sec ? `${min} min ${sec} s` : `${min} min`;
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Etiquetas en kebab-case: el CRM las usa para segmentar y disparar automatizaciones. */
function buildTags(lead: WebhookLead, stage: LeadStage, urgency: string, paymentStatus: string): string {
  const q = lead.qualification ?? {};
  const tags = ["construmia-landing", `etapa-${stage}`];
  if (lead.startTimeframe) tags.push(`arranque-${lead.startTimeframe}`);
  if (urgency) tags.push(`urgencia-${slug(urgency)}`);
  if (lead.qualified === true) tags.push("califica");
  if (lead.qualified === false) tags.push("no-califica");
  if (q.projectType) tags.push(q.projectType);
  if (q.budget) tags.push(`presupuesto-${q.budget}`);
  if (q.location) tags.push(q.location);
  if (paymentStatus === "pagado") tags.push("visita-pagada");
  if (paymentStatus === "por_validar") tags.push("transferencia-por-validar");
  // Pagó sin pasar por la cualificación: tomó la vía rápida.
  if (paymentStatus && lead.qualified == null) tags.push("via-rapida");
  if (lead.utm?.source) tags.push(`fuente-${slug(lead.utm.source)}`);
  return tags.join(", ");
}

/** Resumen legible para el campo de notas del contacto en el CRM. */
function buildNotes(
  lead: WebhookLead,
  stage: LeadStage,
  urgency: string,
  paymentStatus: string,
): string {
  const q = lead.qualification ?? {};
  const metrics = lead.metrics ?? {};
  const parts: string[] = [];

  const verdict =
    lead.qualified === true ? "CALIFICA." : lead.qualified === false ? "NO CALIFICA." : "";
  parts.push(`${verdict} Registro desde la landing de Construmia.`.trim());

  const timeframe = label(START_TIMEFRAMES, lead.startTimeframe);
  if (timeframe) parts.push(`Quiere arrancar: ${timeframe.toLowerCase()} (urgencia ${urgency}).`);
  parts.push("Aceptó el compromiso de continuar con el proceso.");

  // El tipo de proyecto llega en el registro; el resto, en la cualificación.
  const details = [
    q.projectType && `Proyecto: ${label(PROJECT_TYPES, q.projectType)}.`,
    q.budget && `Inversión: ${label(BUDGETS, q.budget)}.`,
    q.propertyStatus && `Propiedad: ${label(PROPERTY_STATUSES, q.propertyStatus).toLowerCase()}.`,
    q.location && `Ubicación: ${label(LOCATIONS, q.location)}.`,
    q.decisionMaker && `Decisión: ${label(DECISION_MAKERS, q.decisionMaker).toLowerCase()}.`,
  ].filter(Boolean);
  if (details.length) parts.push(details.join(" "));

  if (metrics.landingSeconds) {
    parts.push(`Tiempo en la landing antes de registrarse: ${formatDuration(metrics.landingSeconds)}.`);
  }
  if (metrics.videoPageSeconds) {
    parts.push(`Tiempo en la página del video: ${formatDuration(metrics.videoPageSeconds)}.`);
  }
  if (metrics.device) parts.push(`Dispositivo: ${metrics.device === "mobile" ? "celular" : "computadora"}.`);

  if (paymentStatus === "pagado") parts.push("PAGÓ la visita técnica ($50) con tarjeta: agendar de inmediato.");
  if (paymentStatus === "por_validar") {
    const bank = lead.payment?.bank ? ` a ${lead.payment.bank}` : "";
    parts.push(`Reportó transferencia${bank} por la visita técnica: validar el comprobante.`);
  }
  if (stage === "pago" && lead.qualified == null) parts.push("Tomó la vía rápida sin cualificar.");

  return parts.join(" ");
}

function paymentStatusLabel(status: string | undefined): string {
  if (status === "paid") return "pagado";
  if (status === "pending_review") return "por_validar";
  return "";
}

export function buildPayload(
  lead: WebhookLead,
  stage: LeadStage,
  extra: Partial<LeadWebhookPayload> = {},
): LeadWebhookPayload {
  const q = lead.qualification ?? {};
  const utm = lead.utm ?? {};
  const payment = lead.payment ?? {};
  const paymentStatus = paymentStatusLabel(payment.status);
  // Un intento de Payphone sin terminar no es un pago: el CRM solo ve pagos reales o por validar.
  const hasPayment = paymentStatus !== "";
  const metrics = lead.metrics ?? {};
  const urgency = URGENCY[lead.startTimeframe] ?? "";
  // El tiempo relevante es el de la página donde ocurrió este evento.
  const pageSeconds =
    stage === "contacto" ? metrics.landingSeconds || 0 : metrics.videoPageSeconds || 0;

  return {
    stage,
    lead_id: lead._id ? String(lead._id) : "",
    first_name: lead.firstName,
    last_name: lead.lastName,
    full_name: `${lead.firstName} ${lead.lastName}`.trim(),
    email: lead.email,
    phone: lead.phoneE164,
    phone_country: lead.phoneCountry,
    start_timeframe: lead.startTimeframe,
    start_timeframe_label: label(START_TIMEFRAMES, lead.startTimeframe),
    commitment: lead.commitment ? "si" : "",
    utm_source: utm.source ?? "",
    utm_medium: utm.medium ?? "",
    utm_campaign: utm.campaign ?? "",
    utm_content: utm.content ?? "",
    utm_term: utm.term ?? "",
    page_url: lead.pageUrl ?? "",
    created_at: (lead.createdAt ?? new Date()).toISOString(),
    project_type: q.projectType ?? "",
    project_type_label: label(PROJECT_TYPES, q.projectType),
    budget: q.budget ?? "",
    budget_label: label(BUDGETS, q.budget),
    property_status: q.propertyStatus ?? "",
    property_status_label: label(PROPERTY_STATUSES, q.propertyStatus),
    location: q.location ?? "",
    location_label: label(LOCATIONS, q.location),
    decision_maker: q.decisionMaker ?? "",
    decision_maker_label: label(DECISION_MAKERS, q.decisionMaker),
    qualified: lead.qualified === true ? "si" : lead.qualified === false ? "no" : "",
    payment_method: hasPayment ? (payment.method ?? "") : "",
    payment_status: paymentStatus,
    payment_amount_usd: hasPayment ? ((payment.amountCents ?? 0) / 100).toFixed(2) : "",
    // Una transferencia no tiene id de Payphone aunque antes se haya abierto la Cajita.
    payment_transaction_id:
      hasPayment && payment.method === "payphone"
        ? payment.payphoneId || payment.clientTransactionId || ""
        : "",
    payment_receipt_url: hasPayment ? (payment.receiptUrl ?? "") : "",
    urgency,
    tags: buildTags(lead, stage, urgency, paymentStatus),
    notes: buildNotes(lead, stage, urgency, paymentStatus),
    time_on_page_seconds: pageSeconds || "",
    time_on_page_label: formatDuration(pageSeconds),
    landing_seconds: metrics.landingSeconds || "",
    video_page_seconds: metrics.videoPageSeconds || "",
    device: metrics.device ?? "",
    test: "",
    ...extra,
  };
}

async function logResult(lead: WebhookLead, stage: LeadStage, result: WebhookResult) {
  if (!lead._id) return;
  try {
    // $push atómico: no pisa un save() del lead que corra en paralelo.
    await Lead.updateOne(
      { _id: lead._id },
      {
        $push: {
          webhookLog: {
            $each: [{ stage, ok: result.ok, status: result.status, at: new Date() }],
            $slice: -WEBHOOK_LOG_MAX,
          },
        },
      },
      // El log no es actividad del lead: no debe mover updatedAt.
      { timestamps: false },
    );
  } catch (error) {
    console.error("[webhook] no se pudo registrar el resultado en el lead:", error);
  }
}

/**
 * Envía el lead al webhook único del CRM. Nunca lanza: el CRM caído no puede
 * romper un registro ni un pago. El resultado queda en `lead.webhookLog`.
 */
export async function sendLeadWebhook(
  lead: WebhookLead,
  stage: LeadStage,
  options: { test?: boolean; url?: string } = {},
): Promise<WebhookResult> {
  const url = options.url || env.LEAD_WEBHOOK_URL;
  if (!url) {
    console.warn(`[webhook] LEAD_WEBHOOK_URL no definida — no se envió el stage "${stage}"`);
    return { ok: false, status: 0, body: null, skipped: true };
  }

  let result: WebhookResult;
  try {
    const payload = buildPayload(lead, stage, options.test ? { test: "si" } : {});
    const response = await axios.post(url, payload, {
      timeout: WEBHOOK_TIMEOUT_MS,
      headers: { "Content-Type": "application/json" },
      // Un 4xx/5xx del CRM es un resultado que se registra, no una excepción.
      validateStatus: () => true,
    });
    const ok = response.status >= 200 && response.status < 300;
    if (!ok) console.error(`[webhook] el CRM respondió ${response.status} al stage "${stage}"`);
    result = { ok, status: response.status, body: response.data, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[webhook] falló el envío del stage "${stage}": ${message}`);
    result = { ok: false, status: 0, body: message, skipped: false };
  }

  // Los envíos de prueba no pertenecen a un lead real.
  if (!options.test) await logResult(lead, stage, result);
  return result;
}
