import mongoose, { Schema, Types } from "mongoose";

export const LEAD_STAGES = ["contacto", "cualificacion", "pago"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const PAYMENT_METHODS = ["", "payphone", "transferencia"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["none", "pending", "paid", "pending_review", "canceled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface ILeadUtm {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
}

export interface ILeadQualification {
  projectType: string;
  budget: string;
  propertyStatus: string;
  location: string;
  decisionMaker: string;
}

export interface ILeadPayment {
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  clientTransactionId: string;
  payphoneId: string;
  /** Banco al que la persona dice haber transferido. */
  bank: string;
  receiptUrl: string;
  paidAt: Date | null;
  raw: unknown;
}

/** Señales de comportamiento que manda el navegador; alimentan las notas del CRM. */
export interface ILeadMetrics {
  /** Segundos en la landing antes de registrarse. */
  landingSeconds: number;
  /** Segundos en la página del video antes de cualificar. */
  videoPageSeconds: number;
  device: "" | "mobile" | "desktop";
}

export interface IWebhookLogEntry {
  stage: LeadStage;
  ok: boolean;
  status: number;
  at: Date;
}

export interface ILead {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  phoneCountry: string;
  phoneDial: string;
  phone: string;
  phoneE164: string;
  startTimeframe: string;
  commitment: boolean;
  utm: ILeadUtm;
  pageUrl: string;
  metrics: ILeadMetrics;
  qualification: ILeadQualification;
  /** null = todavía no responde la cualificación. */
  qualified: boolean | null;
  qualifiedAt: Date | null;
  stage: LeadStage;
  payment: ILeadPayment;
  webhookLog: IWebhookLogEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const text = { type: String, default: "", trim: true };

const leadSchema = new Schema<ILead>(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    phoneCountry: { type: String, required: true, uppercase: true, trim: true },
    phoneDial: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    phoneE164: { type: String, required: true, trim: true },
    startTimeframe: { type: String, required: true },
    commitment: { type: Boolean, required: true },
    utm: { source: text, medium: text, campaign: text, content: text, term: text },
    pageUrl: text,
    metrics: {
      landingSeconds: { type: Number, default: 0 },
      videoPageSeconds: { type: Number, default: 0 },
      device: { type: String, enum: ["", "mobile", "desktop"], default: "" },
    },
    qualification: {
      projectType: text,
      budget: text,
      propertyStatus: text,
      location: text,
      decisionMaker: text,
    },
    qualified: { type: Boolean, default: null },
    qualifiedAt: { type: Date, default: null },
    stage: { type: String, enum: LEAD_STAGES, default: "contacto", index: true },
    payment: {
      method: { type: String, enum: PAYMENT_METHODS, default: "" },
      status: { type: String, enum: PAYMENT_STATUSES, default: "none" },
      amountCents: { type: Number, default: 0 },
      clientTransactionId: text,
      payphoneId: text,
      bank: text,
      receiptUrl: text,
      paidAt: { type: Date, default: null },
      // Respuesta cruda de Payphone: sirve para soporte y conciliación.
      raw: { type: Schema.Types.Mixed, default: null },
    },
    webhookLog: [
      {
        _id: false,
        stage: { type: String, enum: LEAD_STAGES, required: true },
        ok: { type: Boolean, required: true },
        status: { type: Number, default: 0 },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true, minimize: false },
);

leadSchema.index({ createdAt: -1 });
// Los avisos de actividad reciente se ordenan por última modificación.
leadSchema.index({ updatedAt: -1 });

export const Lead =
  (mongoose.models.Lead as mongoose.Model<ILead>) || mongoose.model<ILead>("Lead", leadSchema);
