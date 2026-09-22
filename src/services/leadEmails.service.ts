import { env } from "../config/env";
import {
  BUDGETS,
  DECISION_MAKERS,
  LOCATIONS,
  PROJECT_TYPES,
  PROPERTY_STATUSES,
  START_TIMEFRAMES,
} from "../config/leadOptions";
import { ILead } from "../models/lead.model";
import { sendEmail } from "./email.service";

const LOGO_URL = "https://construmia.com/logo-construmia.png";
const COPPER = "#aa6936";
const INK = "#1d1b19";
const INK_SOFT = "#4f4a45";
const MUTED = "#8c8074";
const PAPER = "#faf8f4";
const LINE = "#e5ded3";
const FONT = "'Montserrat','Helvetica Neue',Arial,sans-serif";

/** Resend puede tardar: el correo no debe demorar la respuesta al usuario más que esto. */
const EMAIL_TIMEOUT_MS = 6000;

export type TeamNotice = "nuevo" | "cualificacion" | "pago" | "transferencia";

/** Además de LEAD_NOTIFY_EMAIL, estos reciben su propia copia de registros y cualificaciones. */
const EXTRA_NOTIFY: Partial<Record<TeamNotice, string[]>> = {
  nuevo: ["Miguelcoronelcastello@gmail.com", "Nighell.cs@gmail.com"],
  cualificacion: ["Miguelcoronelcastello@gmail.com", "Nighell.cs@gmail.com"],
};

/** Los nombres vienen de un formulario público: nunca entran crudos al HTML. */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function label(options: Record<string, string>, value: string): string {
  return options[value] ?? "";
}

function frontUrl(path: string): string {
  return `${env.FRONTEND_URL.replace(/\/+$/, "")}${path}`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;color:${INK_SOFT};font-size:15px;line-height:1.65">${text}</p>`;
}

function button(label: string, href: string): string {
  return `
  <table cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 24px">
    <tr><td style="background:${COPPER};border-radius:4px">
      <a href="${esc(href)}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-family:${FONT};font-size:15px;font-weight:600;text-decoration:none">${esc(label)}</a>
    </td></tr>
  </table>`;
}

function rows(items: Array<[string, string]>): string {
  const body = items
    .filter(([, value]) => value)
    .map(
      ([name, value]) => `
      <tr>
        <td style="padding:8px 12px 8px 0;border-bottom:1px solid ${LINE};color:${MUTED};font-size:13px;vertical-align:top;white-space:nowrap">${esc(name)}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${LINE};color:${INK};font-size:14px">${esc(value)}</td>
      </tr>`,
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 24px">${body}</table>`;
}

function layout(title: string, body: string): string {
  return `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${PAPER};padding:32px 12px;font-family:${FONT}">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:560px;background:#ffffff;border:1px solid ${LINE}">
        <tr><td style="padding:28px 32px 20px;border-bottom:3px solid ${COPPER}">
          <img src="${LOGO_URL}" alt="Construmia" height="40" style="display:block;height:40px;width:auto;border:0" />
        </td></tr>
        <tr><td style="padding:32px">
          <h1 style="margin:0 0 20px;color:${INK};font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;font-weight:normal">${title}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:20px 32px;background:${INK};color:#f4efe8;font-size:12px;line-height:1.6">
          Construmia — Construcción y remodelación. Guayaquil, Ecuador.<br />
          <a href="https://construmia.com" style="color:#d9a06b;text-decoration:none">construmia.com</a>
        </td></tr>
      </table>
    </td></tr>
  </table>`;
}

/** sendEmail ya no lanza; acá además se le pone techo de tiempo. */
async function deliver(to: string, subject: string, html: string): Promise<boolean> {
  if (!to) return false;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[email] "${subject}" superó ${EMAIL_TIMEOUT_MS} ms; se sigue sin esperar`);
      resolve(false);
    }, EMAIL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([sendEmail(to, subject, html), timeout]);
  } catch (error) {
    console.error("[email] fallo inesperado:", error);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Bienvenida al lead: lo lleva al video del método. */
export function sendWelcome(lead: ILead): Promise<boolean> {
  const html = layout(
    `${esc(lead.firstName)}, recibimos tu registro`,
    [
      paragraph(
        "Gracias por dar el primer paso. Una buena obra no empieza construyendo: empieza planificando bien.",
      ),
      paragraph(
        "El siguiente paso es ver el video donde te explicamos el método Construmia 380 y cómo trabajamos diseño y construcción bajo un mismo equipo. Al terminar podrás pedir que te atienda un experto.",
      ),
      button("Ver el video", frontUrl("/video")),
      paragraph(
        "Este proceso está pensado para remodelaciones integrales, ampliaciones importantes y la reestructuración de casas antiguas, en proyectos a partir de $30.000.",
      ),
    ].join(""),
  );
  return deliver(lead.email, "Recibimos tu registro en Construmia", html);
}

/** Pago de la visita confirmado: lo lleva a agendar. */
export function sendPaymentConfirmed(lead: ILead): Promise<boolean> {
  const amount = (lead.payment.amountCents / 100).toFixed(2);
  const html = layout(
    `${esc(lead.firstName)}, tu visita técnica está pagada`,
    [
      paragraph(
        `Confirmamos tu pago de $${esc(amount)} por la visita técnica de asesoría, levantamiento y diagnóstico.`,
      ),
      paragraph("Solo falta que elijas el día y la hora de tu visita."),
      button("Agendar mi visita", frontUrl("/agendar")),
      paragraph(
        "Si después decides avanzar con el diseño completo en render 3D ($250), los $50 de la visita se descuentan de ese valor.",
      ),
      rows([
        ["Referencia", lead.payment.payphoneId || lead.payment.clientTransactionId],
        ["Correo", lead.email],
      ]),
    ].join(""),
  );
  return deliver(lead.email, "Pago confirmado: agenda tu visita técnica", html);
}

const NOTICE_TITLES: Record<TeamNotice, string> = {
  nuevo: "Nuevo lead",
  cualificacion: "Cualificación completada",
  pago: "Pago de visita confirmado",
  transferencia: "Transferencia por validar",
};

function qualifiedLabel(lead: ILead): string {
  if (lead.qualified === true) return "Sí califica";
  if (lead.qualified === false) return "No califica";
  return "";
}

/** Aviso interno a LEAD_NOTIFY_EMAIL (y a EXTRA_NOTIFY según el tipo). */
export async function notifyTeam(lead: ILead, kind: TeamNotice): Promise<boolean> {
  const fullName = `${lead.firstName} ${lead.lastName}`.trim();
  const q = lead.qualification;
  const paid = lead.payment.status === "paid" || lead.payment.status === "pending_review";

  const intro: Record<TeamNotice, string> = {
    nuevo: "Se registró un contacto nuevo en el embudo.",
    cualificacion: "Un contacto terminó las preguntas de cualificación.",
    pago: "Se confirmó el pago de una visita técnica con Payphone.",
    transferencia:
      "Un contacto reportó una transferencia. El pago NO está confirmado: revisa el comprobante y valida que el dinero haya llegado antes de agendar.",
  };

  const receipt =
    kind === "transferencia" && lead.payment.receiptUrl
      ? button("Ver comprobante", lead.payment.receiptUrl)
      : "";

  const html = layout(
    esc(`${NOTICE_TITLES[kind]}: ${fullName}`),
    [
      paragraph(esc(intro[kind])),
      receipt,
      rows([
        ["Nombre", fullName],
        ["Correo", lead.email],
        ["Teléfono", lead.phoneE164],
        [
          "Cuándo quiere arrancar",
          label(START_TIMEFRAMES, lead.startTimeframe) || lead.startTimeframe,
        ],
        ["Califica", qualifiedLabel(lead)],
        ["Tipo de proyecto", label(PROJECT_TYPES, q.projectType)],
        ["Presupuesto", label(BUDGETS, q.budget)],
        ["Propiedad", label(PROPERTY_STATUSES, q.propertyStatus)],
        ["Ubicación", label(LOCATIONS, q.location)],
        ["Quién decide", label(DECISION_MAKERS, q.decisionMaker)],
        ["Método de pago", paid ? lead.payment.method : ""],
        ["Banco", paid ? lead.payment.bank : ""],
        ["Monto", paid ? `$${(lead.payment.amountCents / 100).toFixed(2)}` : ""],
        ["Transacción", paid ? lead.payment.payphoneId || lead.payment.clientTransactionId : ""],
        [
          "Campaña",
          [lead.utm.source, lead.utm.medium, lead.utm.campaign].filter(Boolean).join(" / "),
        ],
        ["Página", lead.pageUrl],
      ]),
    ].join(""),
  );

  const subject = `${NOTICE_TITLES[kind]}: ${fullName}`;
  const recipients = [env.LEAD_NOTIFY_EMAIL, ...(EXTRA_NOTIFY[kind] ?? [])];
  // Un envío por destinatario: nadie ve el correo de los demás y un rebote no tumba al resto.
  const results = await Promise.all(recipients.map((to) => deliver(to, subject, html)));
  return results[0];
}
