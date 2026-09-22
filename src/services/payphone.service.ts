import axios from "axios";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";

const CONFIRM_URL = "https://paymentbox.payphonetodoesposible.com/api/confirm";
const CONFIRM_TIMEOUT_MS = 15000;

export const PAYPHONE_APPROVED = 3;
export const PAYPHONE_CANCELED = 2;

/** Lo que se usa de la respuesta de confirmación; el resto se guarda crudo en la orden. */
export interface PayphoneConfirmation {
  statusCode: number;
  transactionStatus?: string;
  transactionId?: number;
  clientTransactionId?: string;
  /** Centavos. */
  amount?: number;
  message?: string;
  [key: string]: unknown;
}

export function isPayphoneConfigured(): boolean {
  return !!(env.PAYPHONE_TOKEN && env.PAYPHONE_STORE_ID);
}

/**
 * Confirma una transacción de la Cajita. Payphone reversa el cobro si esto no
 * ocurre en los primeros 5 minutos, por eso se llama apenas carga /pay-response.
 */
export async function confirmTransaction(
  id: number,
  clientTransactionId: string,
): Promise<PayphoneConfirmation> {
  if (!isPayphoneConfigured()) {
    throw new CustomError("El pago con tarjeta no está disponible en este momento", 503);
  }

  try {
    const { data } = await axios.post<PayphoneConfirmation>(
      CONFIRM_URL,
      { id, clientTxId: clientTransactionId },
      {
        headers: { Authorization: `Bearer ${env.PAYPHONE_TOKEN}` },
        timeout: CONFIRM_TIMEOUT_MS,
      },
    );
    return data;
  } catch (error) {
    // Payphone responde los errores como { message, errorCode }. Se guardan como
    // detalle para soporte; al usuario le llega un mensaje que pueda entender.
    const details = axios.isAxiosError(error)
      ? { status: error.response?.status, data: error.response?.data, code: error.code }
      : String(error);
    throw new CustomError(
      "No pudimos confirmar tu pago con Payphone. Si se hizo el cobro, escríbenos para revisarlo.",
      502,
      details,
    );
  }
}
