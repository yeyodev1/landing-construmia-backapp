import mongoose, { Schema, Types } from "mongoose";

export const ORDER_STATUSES = ["pending", "paid", "canceled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Un intento de pago con la Cajita de Payphone. Cada vez que se monta la Cajita
 * se crea una orden nueva: el formulario vence a los 10 minutos y Payphone no
 * acepta reutilizar un clientTransactionId.
 */
export interface IOrder {
  _id: Types.ObjectId;
  lead: Types.ObjectId;
  clientTransactionId: string;
  amountCents: number;
  status: OrderStatus;
  payphoneResponse: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const orderSchema = new Schema<IOrder>(
  {
    lead: { type: Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    // Payphone admite máximo 50 caracteres.
    clientTransactionId: { type: String, required: true, unique: true, index: true, maxlength: 50 },
    amountCents: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ORDER_STATUSES, default: "pending" },
    payphoneResponse: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

export const Order =
  (mongoose.models.Order as mongoose.Model<IOrder>) || mongoose.model<IOrder>("Order", orderSchema);
