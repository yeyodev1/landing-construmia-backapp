import { Request, Response, NextFunction } from "express";
import * as leadService from "../services/lead.service";

/** POST /api/leads — body: LeadContactPayload. 201 si es nuevo, 200 si el correo ya existía. */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { lead, created } = await leadService.createOrUpdate(req.body);
    res.status(created ? 201 : 200).json({ lead });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/leads/:id/qualification — body: QualificationAnswers */
export async function qualify(req: Request, res: Response, next: NextFunction) {
  try {
    const lead = await leadService.qualify(req.params.id, req.body);
    res.status(200).json({ lead });
  } catch (error) {
    next(error);
  }
}

/** GET /api/leads/recent — actividad real para los avisos del frontapp. */
export async function recent(_req: Request, res: Response, next: NextFunction) {
  try {
    res.set("Cache-Control", "public, max-age=60");
    res.status(200).json(await leadService.recent());
  } catch (error) {
    next(error);
  }
}

/** GET /api/leads/:id */
export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const lead = await leadService.findPublic(req.params.id);
    res.status(200).json({ lead });
  } catch (error) {
    next(error);
  }
}

/** GET /api/leads?page=&limit=&stage= — solo administración. */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await leadService.listAdmin(req.query as Record<string, unknown>);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
