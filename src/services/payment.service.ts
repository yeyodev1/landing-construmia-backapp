import { randomBytes } from "crypto";
import { v2 as cloudinary, UploadApiResponse } from "cloudinary";
import { env } from "../config/env";
import { VISIT_PRICE_CENTS, VISIT_REFERENCE } from "../config/leadOptions";
import { CustomError } from "../errors/customError.error";
import { Lead } from "../models/lead.model";
import { IOrder, Order } from "../models/order.model";
import { isCloudinaryConfigured } from "./cloudinary.service";
import { findDocument, PublicLead, runSideEffects, toPublic } from "./lead.service";
import { notifyTeam, sendPaymentConfirmed } from "./leadEmails.service";
import {
  confirmTransaction,
  isPayphoneConfigured,
  PAYPHONE_APPROVED,
  PAYPHONE_CANCELED,
  PayphoneConfirmation,
} from "./payphone.service";
import { sendLeadWebhook } from "./webhook.service";

const RECEIPTS_FOLDER = "construmia/comprobantes";

/** Configuración lista para `new PPaymentButtonBox(...)` en el frontapp. */
export interface PaymentBoxConfig {
  token: string;
  storeId: string;
  clientTransactionId: string;
  amount: number;
  amountWithoutTax: number;
  currency: "USD";
  reference: string;
  email: string;
  phoneNumber: string;
}

export interface PaymentConfirmation {
  status: "paid" | "canceled" | "pending";
  lead: PublicLead | null;
  message: string;
}

const MESSAGES = {
  paid: "Pago confirmado. Ya puedes agendar tu visita técnica.",
  canceled: "El pago no se completó. No se hizo ningún cobro; puedes intentarlo de nuevo.",
  pending: "Payphone todavía no confirma el pago. Vuelve a intentar en unos segundos.",
} as const;

/** Único por intento y de máximo 50 caracteres, como exige Payphone. */
function newClientTransactionId(leadId: string): string {
  return `cm-${leadId.slice(-8)}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

/** POST /payments — crea el intento de pago de la visita. El monto lo fija el servidor. */
export async function createOrder(leadId: unknown): Promise<PaymentBoxConfig> {
  const lead = await findDocument(leadId);

  if (lead.payment.status === "paid") {
    throw new CustomError("Tu visita técnica ya está pagada. Puedes agendarla.", 409);
  }
  if (!isPayphoneConfigured()) {
    throw new CustomError(
      "El pago con tarjeta no está disponible en este momento. Puedes pagar por transferencia.",
      503,
    );
  }

  const order = await Order.create({
    lead: lead._id,
    clientTransactionId: newClientTransactionId(String(lead._id)),
    amountCents: VISIT_PRICE_CENTS,
  });

  // Un comprobante en revisión no se pisa con un intento de tarjeta sin terminar.
  await Lead.updateOne(
    { _id: lead._id, "payment.status": { $in: ["none", "pending", "canceled"] } },
    {
      $set: {
        "payment.method": "payphone",
        "payment.status": "pending",
        "payment.amountCents": order.amountCents,
        "payment.clientTransactionId": order.clientTransactionId,
      },
    },
  );

  return {
    token: env.PAYPHONE_TOKEN,
    storeId: env.PAYPHONE_STORE_ID,
    clientTransactionId: order.clientTransactionId,
    amount: order.amountCents,
    // La visita no desglosa IVA: Payphone exige que la suma cuadre con amount.
    amountWithoutTax: order.amountCents,
    currency: "USD",
    reference: VISIT_REFERENCE,
    // Datos reales del comprador: Payphone bloquea cuentas con datos quemados.
    email: lead.email,
    phoneNumber: lead.phoneE164,
  };
}

/**
 * Marca el lead como pagado una sola vez. El filtro `status != paid` hace la
 * transición atómica: si dos confirmaciones llegan juntas (o la página se
 * recarga), solo la primera dispara webhook y correos.
 */
async function markLeadPaid(
  order: IOrder,
  data: PayphoneConfirmation | null,
): Promise<PublicLead | null> {
  const lead = await Lead.findOneAndUpdate(
    { _id: order.lead, "payment.status": { $ne: "paid" } },
    {
      $set: {
        "payment.method": "payphone",
        "payment.status": "paid",
        "payment.amountCents": order.amountCents,
        "payment.clientTransactionId": order.clientTransactionId,
        "payment.payphoneId": data?.transactionId ? String(data.transactionId) : "",
        "payment.paidAt": new Date(),
        "payment.raw": data,
        stage: "pago",
      },
    },
    { new: true },
  );
  if (!lead) return publicLeadOf(order.lead);

  await runSideEffects([
    sendLeadWebhook(lead, "pago"),
    sendPaymentConfirmed(lead),
    notifyTeam(lead, "pago"),
  ]);
  return toPublic(lead);
}

async function publicLeadOf(leadId: unknown): Promise<PublicLead | null> {
  const lead = await Lead.findById(leadId);
  return lead ? toPublic(lead) : null;
}

/** POST /payments/confirm — idempotente: recargar /pay-response no duplica nada. */
export async function confirm(
  id: unknown,
  clientTransactionId: unknown,
): Promise<PaymentConfirmation> {
  const payphoneId = Number(id);
  const clientTxId = typeof clientTransactionId === "string" ? clientTransactionId.trim() : "";
  if (
    !Number.isSafeInteger(payphoneId) ||
    payphoneId <= 0 ||
    !clientTxId ||
    clientTxId.length > 50
  ) {
    throw new CustomError("Faltan los datos de la transacción de Payphone", 400);
  }

  const order = await Order.findOne({ clientTransactionId: clientTxId });
  if (!order) throw new CustomError("No encontramos esa orden de pago", 404);

  if (order.status === "paid") {
    // Si un intento anterior cobró pero se cayó antes de marcar el lead, acá se repara.
    const lead = await markLeadPaid(order, order.payphoneResponse as PayphoneConfirmation | null);
    return { status: "paid", lead, message: MESSAGES.paid };
  }
  if (order.status === "canceled") {
    return { status: "canceled", lead: await publicLeadOf(order.lead), message: MESSAGES.canceled };
  }

  const data = await confirmTransaction(payphoneId, clientTxId);

  if (data.statusCode === PAYPHONE_CANCELED) {
    await Order.updateOne(
      { _id: order._id, status: "pending" },
      { $set: { status: "canceled", payphoneResponse: data } },
    );
    await Lead.updateOne(
      { _id: order.lead, "payment.status": "pending", "payment.clientTransactionId": clientTxId },
      { $set: { "payment.status": "canceled" } },
    );
    return { status: "canceled", lead: await publicLeadOf(order.lead), message: MESSAGES.canceled };
  }

  if (data.statusCode !== PAYPHONE_APPROVED) {
    await Order.updateOne(
      { _id: order._id, status: "pending" },
      { $set: { payphoneResponse: data } },
    );
    return { status: "pending", lead: await publicLeadOf(order.lead), message: MESSAGES.pending };
  }

  // Aprobado, pero por otro monto: no se entrega nada y queda el rastro para conciliar.
  if (Number(data.amount) !== order.amountCents) {
    await Order.updateOne({ _id: order._id }, { $set: { payphoneResponse: data } });
    throw new CustomError(
      "El monto cobrado no coincide con el de la visita técnica. Escríbenos para revisarlo.",
      409,
      { esperado: order.amountCents, recibido: data.amount, clientTransactionId: clientTxId },
    );
  }

  await Order.updateOne({ _id: order._id }, { $set: { status: "paid", payphoneResponse: data } });
  const lead = await markLeadPaid(order, data);
  return { status: "paid", lead, message: MESSAGES.paid };
}

/**
 * uploadBuffer de cloudinary.service fuerza resource_type "image" con una
 * transformación de formato, y un PDF no debe reconvertirse. Acá "auto" deja
 * que Cloudinary guarde el archivo tal cual llegó.
 */
async function uploadReceipt(buffer: Buffer, leadId: string): Promise<string> {
  if (!isCloudinaryConfigured()) {
    throw new CustomError(
      "No podemos recibir comprobantes en este momento. Envíalo por WhatsApp.",
      503,
    );
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: RECEIPTS_FOLDER,
        resource_type: "auto",
        public_id: `${leadId}-${Date.now().toString(36)}`,
      },
      (error, result?: UploadApiResponse) => {
        if (error || !result) {
          return reject(
            new CustomError("No pudimos subir tu comprobante. Intenta de nuevo.", 502, error),
          );
        }
        resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

/** POST /payments/transfer — el comprobante queda por validar; NO marca el pago como hecho. */
export async function reportTransfer(
  leadId: unknown,
  bank: unknown,
  file: Express.Multer.File | undefined,
): Promise<PublicLead> {
  const bankName = typeof bank === "string" ? bank.trim().replace(/\s+/g, " ").slice(0, 60) : "";
  if (!bankName) throw new CustomError("Indica a qué banco hiciste la transferencia", 400);

  if (!file?.buffer?.length)
    throw new CustomError("Adjunta la foto o el PDF de tu comprobante", 400);
  if (!file.mimetype.startsWith("image/") && file.mimetype !== "application/pdf") {
    throw new CustomError("El comprobante debe ser una imagen o un PDF", 400);
  }

  const lead = await findDocument(leadId);
  if (lead.payment.status === "paid") {
    throw new CustomError("Tu visita técnica ya está pagada. Puedes agendarla.", 409);
  }

  const receiptUrl = await uploadReceipt(file.buffer, String(lead._id));

  lead.payment.method = "transferencia";
  lead.payment.status = "pending_review";
  lead.payment.amountCents = VISIT_PRICE_CENTS;
  lead.payment.bank = bankName;
  lead.payment.receiptUrl = receiptUrl;
  lead.stage = "pago";
  await lead.save();

  await runSideEffects([sendLeadWebhook(lead, "pago"), notifyTeam(lead, "transferencia")]);

  return toPublic(lead);
}
