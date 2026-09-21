import { Request, Response, NextFunction } from "express";
import * as paymentService from "../services/payment.service";

/** POST /api/payments — body: { leadId }. Devuelve la configuración de la Cajita de Payphone. */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const config = await paymentService.createOrder(req.body?.leadId);
    res.status(201).json(config);
  } catch (error) {
    next(error);
  }
}

/** POST /api/payments/confirm — body: { id, clientTransactionId } */
export async function confirm(req: Request, res: Response, next: NextFunction) {
  try {
    const { id, clientTransactionId } = req.body ?? {};
    const result = await paymentService.confirm(id, clientTransactionId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** POST /api/payments/transfer — multipart: leadId, bank, receipt (imagen o PDF) */
export async function transfer(req: Request, res: Response, next: NextFunction) {
  try {
    const { leadId, bank } = req.body ?? {};
    const lead = await paymentService.reportTransfer(leadId, bank, req.file);
    res.status(200).json({ lead });
  } catch (error) {
    next(error);
  }
}
