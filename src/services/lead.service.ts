import { CountryCode, parsePhoneNumberFromString } from "libphonenumber-js/mobile";
import { isValidObjectId } from "mongoose";
import {
  BUDGETS,
  DECISION_MAKERS,
  LOCATIONS,
  PROJECT_TYPES,
  PROPERTY_STATUSES,
  QUALIFYING_BUDGETS,
  START_TIMEFRAMES,
} from "../config/leadOptions";
import { CustomError } from "../errors/customError.error";
import { ILead, ILeadQualification, ILeadUtm, Lead, LEAD_STAGES } from "../models/lead.model";
import { notifyTeam, sendWelcome } from "./leadEmails.service";
import { sendLeadWebhook } from "./webhook.service";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RECENT_DAYS = 14;
const RECENT_MAX = 12;

/** Forma `Lead` del frontapp: nunca más de lo que el navegador necesita. */
export interface PublicLead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneE164: string;
  /** Se pregunta al registrarse: la cualificación ya no la repite. */
  projectType: string;
  stage: ILead["stage"];
  qualified: boolean | null;
  paid: boolean;
}

export interface RecentActivity {
  firstName: string;
  location: string;
  action: "registro" | "cualificacion" | "pago";
  at: string;
}

export function toPublic(lead: ILead): PublicLead {
  return {
    id: String(lead._id),
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phoneE164: lead.phoneE164,
    projectType: lead.qualification?.projectType ?? "",
    stage: lead.stage,
    qualified: lead.qualified ?? null,
    paid: lead.payment?.status === "paid",
  };
}

/**
 * Webhook y correos se esperan ANTES de responder: en Vercel lo que queda
 * después de res.json puede cortarse. Van en paralelo, cada uno con su propio
 * timeout, y ninguno lanza, así que lo peor que pasa es una respuesta algo más lenta.
 */
export async function runSideEffects(tasks: Array<Promise<unknown>>): Promise<void> {
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === "rejected")
      console.error("[lead] efecto secundario falló:", result.reason);
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasOption(options: Record<string, string>, value: string): boolean {
  return Object.prototype.hasOwnProperty.call(options, value);
}

function cleanName(value: unknown, field: string): string {
  const name = str(value).replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) {
    throw new CustomError(`Escribe tu ${field} (entre 2 y 60 caracteres)`, 400);
  }
  return name;
}

function cleanUtm(value: unknown): ILeadUtm {
  const utm = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const pick = (key: string) => str(utm[key]).slice(0, 200);
  return {
    source: pick("source"),
    medium: pick("medium"),
    campaign: pick("campaign"),
    content: pick("content"),
    term: pick("term"),
  };
}

/** Segundos razonables (0 a 6 h): el navegador puede mandar cualquier cosa. */
function cleanSeconds(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 6 * 60 * 60) : 0;
}

function cleanMeta(value: unknown): { seconds: number; device: "" | "mobile" | "desktop" } {
  const meta = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const device = meta.device === "mobile" || meta.device === "desktop" ? meta.device : "";
  return { seconds: cleanSeconds(meta.timeOnPageSeconds), device };
}

function validateContact(body: Record<string, unknown>) {
  const firstName = cleanName(body.firstName, "nombre");
  const lastName = cleanName(body.lastName, "apellido");

  const email = str(body.email).toLowerCase();
  if (email.length > 120 || !EMAIL_REGEX.test(email)) {
    throw new CustomError("Escribe un correo válido", 400);
  }

  const phoneCountry = str(body.phoneCountry).toUpperCase();
  if (!/^[A-Z]{2}$/.test(phoneCountry)) {
    throw new CustomError("Elige el país de tu teléfono", 400);
  }

  // Se acepta con espacios, guiones o el + del prefijo; letras u otros símbolos no son un teléfono.
  const rawPhone = str(body.phone);
  if (!/^\+?[\d\s().-]+$/.test(rawPhone)) {
    throw new CustomError("Escribe tu teléfono solo con números", 400);
  }
  // "0995254965", "995254965", "593995254965" y "+593 99 525 4965" son el mismo número.
  // La metadata "mobile" solo da por válido un celular que exista en el plan de
  // numeración del país: es el que sirve para WhatsApp.
  const parsed = parsePhoneNumberFromString(rawPhone, phoneCountry as CountryCode);
  if (!parsed?.isValid() || !parsed.country) {
    throw new CustomError("Revisa tu teléfono: escribe un celular válido con WhatsApp", 400);
  }

  const startTimeframe = str(body.startTimeframe);
  if (!hasOption(START_TIMEFRAMES, startTimeframe)) {
    throw new CustomError("Elige cuándo quieres arrancar tu proyecto", 400);
  }

  // Se pide primero en el registro; es opcional para no romper formularios viejos.
  const projectType = str(body.projectType);
  if (projectType && !hasOption(PROJECT_TYPES, projectType)) {
    throw new CustomError("Elige el tipo de proyecto", 400);
  }

  if (body.commitment !== true) {
    throw new CustomError(
      "Para continuar necesitas aceptar el compromiso: este proceso es para quien va en serio con su proyecto",
      400,
    );
  }

  return {
    firstName,
    lastName,
    email,
    // El país sale del número: si escribió "+34…" con Ecuador elegido, manda el número.
    phoneCountry: parsed.country,
    phoneDial: `+${parsed.countryCallingCode}`,
    phone: String(parsed.nationalNumber),
    phoneE164: String(parsed.number),
    startTimeframe,
    commitment: true,
    projectType,
  };
}

/** POST /leads — crea el contacto o, si el correo ya existe, lo actualiza. */
export async function createOrUpdate(
  body: unknown,
): Promise<{ lead: PublicLead; created: boolean }> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const contact = validateContact(input);
  const utm = cleanUtm(input.utm);
  const pageUrl = str(input.pageUrl).slice(0, 500);
  const meta = cleanMeta(input.meta);

  const { projectType, ...contactFields } = contact;
  const set: Record<string, unknown> = { ...contactFields };
  if (projectType) set["qualification.projectType"] = projectType;
  if (meta.seconds) set["metrics.landingSeconds"] = meta.seconds;
  if (meta.device) set["metrics.device"] = meta.device;
  // Al volver a registrarse no se pierde la atribución original si ahora llega sin UTM.
  if (Object.values(utm).some(Boolean)) set.utm = utm;
  if (pageUrl) set.pageUrl = pageUrl;

  // Upsert atómico: dos envíos simultáneos del mismo correo no chocan con el índice único.
  const result = await Lead.findOneAndUpdate(
    { email: contact.email },
    { $set: set },
    {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      includeResultMetadata: true,
    },
  );

  const lead = result.value;
  if (!lead) throw new CustomError("No pudimos guardar tu registro. Intenta de nuevo.", 500);
  const created = !result.lastErrorObject?.updatedExisting;

  // Quien repite el formulario ya recibió su bienvenida: solo se refresca el CRM.
  const tasks: Array<Promise<unknown>> = [sendLeadWebhook(lead, "contacto")];
  if (created) tasks.push(sendWelcome(lead), notifyTeam(lead, "nuevo"));
  await runSideEffects(tasks);

  return { lead: toPublic(lead), created };
}

/** Un :id que no es ObjectId es un registro inexistente, no un CastError 500. */
export async function findDocument(id: unknown) {
  const lead = typeof id === "string" && isValidObjectId(id) ? await Lead.findById(id) : null;
  if (!lead) throw new CustomError("No encontramos tu registro", 404);
  return lead;
}

export async function findPublic(id: unknown): Promise<PublicLead> {
  return toPublic(await findDocument(id));
}

function validateQualification(body: Record<string, unknown>): ILeadQualification {
  const fields: Array<[keyof ILeadQualification, Record<string, string>, string]> = [
    ["projectType", PROJECT_TYPES, "Elige el tipo de proyecto"],
    ["budget", BUDGETS, "Elige tu rango de presupuesto"],
    ["propertyStatus", PROPERTY_STATUSES, "Indica la situación de la propiedad"],
    ["location", LOCATIONS, "Elige dónde está tu proyecto"],
    ["decisionMaker", DECISION_MAKERS, "Indica quién toma la decisión"],
  ];

  const answers = {} as ILeadQualification;
  for (const [field, options, message] of fields) {
    const value = str(body[field]);
    if (!hasOption(options, value)) throw new CustomError(message, 400);
    answers[field] = value;
  }
  return answers;
}

/** El método es para proyectos integrales desde $30.000 en una propiedad que no sea alquilada. */
function isQualified(answers: ILeadQualification): boolean {
  return (
    QUALIFYING_BUDGETS.includes(answers.budget) &&
    answers.projectType !== "un-ambiente" &&
    answers.propertyStatus !== "alquilada"
  );
}

/** PUT /leads/:id/qualification */
export async function qualify(id: unknown, body: unknown): Promise<PublicLead> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const answers = validateQualification(input);
  const meta = cleanMeta(input.meta);
  const lead = await findDocument(id);

  if (meta.seconds) lead.set("metrics.videoPageSeconds", meta.seconds);
  if (meta.device && !lead.metrics?.device) lead.set("metrics.device", meta.device);

  lead.qualification = answers;
  lead.qualified = isQualified(answers);
  lead.qualifiedAt = new Date();
  // Quien ya pagó por la vía rápida no retrocede de etapa.
  if (lead.stage === "contacto") lead.stage = "cualificacion";
  await lead.save();

  await runSideEffects([sendLeadWebhook(lead, "cualificacion"), notifyTeam(lead, "cualificacion")]);

  return toPublic(lead);
}

function capitalizeFirstName(value: string): string {
  const first = value.trim().split(/\s+/)[0] ?? "";
  return first.charAt(0).toLocaleUpperCase("es") + first.slice(1).toLocaleLowerCase("es");
}

/** Lo más avanzado que hizo el lead, con la fecha de ESE hecho. */
function lastActivity(lead: ILead): { action: RecentActivity["action"]; at: Date } {
  if (lead.payment?.status === "paid" && lead.payment.paidAt) {
    return { action: "pago", at: lead.payment.paidAt };
  }
  if (lead.qualified === true && lead.qualifiedAt) {
    return { action: "cualificacion", at: lead.qualifiedAt };
  }
  return { action: "registro", at: lead.createdAt };
}

/**
 * GET /leads/recent — actividad real para los avisos: solo primer nombre y ciudad.
 * `total` son los registros reales acumulados: el frontapp usa avisos de ejemplo
 * (etiquetados como tales) hasta que haya suficientes reales.
 */
export async function recent(): Promise<{ items: RecentActivity[]; total: number }> {
  const [items, total] = await Promise.all([recentItems(), Lead.estimatedDocumentCount()]);
  return { items, total };
}

async function recentItems(): Promise<RecentActivity[]> {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);

  const leads = await Lead.find({ updatedAt: { $gte: since } })
    .sort({ updatedAt: -1 })
    .limit(RECENT_MAX * 2)
    .select(
      "firstName qualification.location qualified qualifiedAt payment.status payment.paidAt createdAt",
    )
    .lean<ILead[]>();

  return leads
    .map((lead) => ({ lead, activity: lastActivity(lead) }))
    .filter(({ activity }) => activity.at >= since)
    .sort((a, b) => b.activity.at.getTime() - a.activity.at.getTime())
    .slice(0, RECENT_MAX)
    .map(({ lead, activity }) => ({
      firstName: capitalizeFirstName(lead.firstName),
      location: LOCATIONS[lead.qualification?.location as keyof typeof LOCATIONS] ?? "",
      action: activity.action,
      at: activity.at.toISOString(),
    }));
}

/** GET /leads (admin) — lead completo, paginado. */
export async function listAdmin(query: Record<string, unknown>) {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit)) || 20));

  const filter: Record<string, unknown> = {};
  const stage = str(query.stage);
  if (stage) {
    if (!(LEAD_STAGES as readonly string[]).includes(stage)) {
      throw new CustomError(`stage debe ser uno de: ${LEAD_STAGES.join(", ")}`, 400);
    }
    filter.stage = stage;
  }

  const [docs, total] = await Promise.all([
    Lead.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select("-__v")
      .lean<ILead[]>(),
    Lead.countDocuments(filter),
  ]);

  const items = docs.map(({ _id, ...rest }) => ({ id: String(_id), ...rest }));
  return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}
