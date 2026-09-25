import { env } from "../config/env";
import { LeadStage } from "../models/lead.model";
import { buildPayload, sendLeadWebhook, WebhookLead } from "../services/webhook.service";

/**
 * Envía dos mensajes de prueba al webhook del CRM (stage "contacto" y
 * "cualificacion") para mapear los campos allá. No toca la base de datos.
 *
 *   pnpm test:webhook                 → usa LEAD_WEBHOOK_URL
 *   pnpm test:webhook https://...     → usa la URL del argumento
 */
const contacto: WebhookLead = {
  _id: "000000000000000000000000",
  firstName: "Prueba",
  lastName: "Construmia",
  email: "test@construmia.com",
  phoneCountry: "EC",
  phoneE164: "+593900000000",
  startTimeframe: "1-3-meses",
  commitment: true,
  qualified: null,
  qualification: { projectType: "ampliacion" },
  createdAt: new Date(),
  pageUrl: "https://construmia.com/?prueba=1",
  utm: { source: "prueba", medium: "script", campaign: "test-webhook", content: "", term: "" },
  metrics: { landingSeconds: 94, videoPageSeconds: 0, device: "mobile" },
};

const cualificacion: WebhookLead = {
  ...contacto,
  qualified: true,
  qualification: {
    projectType: "remodelacion-integral",
    projectStage: "en-curso",
    serviceNeeded: "supervision",
    budget: "30k-60k",
    propertyStatus: "propia",
    location: "guayaquil",
    decisionMaker: "yo",
  },
  metrics: { landingSeconds: 94, videoPageSeconds: 312, device: "mobile" },
};

async function main() {
  const url = process.argv[2] || env.LEAD_WEBHOOK_URL;
  if (!url) {
    console.error("Falta la URL: define LEAD_WEBHOOK_URL en .env o pásala como argumento.");
    process.exitCode = 1;
    return;
  }

  // No se imprime la URL completa: suele llevar un token en la ruta.
  console.log(`Enviando pruebas a ${new URL(url).host}\n`);

  const messages: Array<[LeadStage, WebhookLead]> = [
    ["contacto", contacto],
    ["cualificacion", cualificacion],
  ];

  for (const [stage, lead] of messages) {
    console.log(`--- stage: ${stage}`);
    console.log("payload:", JSON.stringify(buildPayload(lead, stage, { test: "si" }), null, 2));
    const result = await sendLeadWebhook(lead, stage, { test: true, url });
    console.log("status:", result.status || "sin respuesta");
    console.log(
      "body:",
      typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2),
    );
    console.log(result.ok ? "OK\n" : "FALLO\n");
    if (!result.ok) process.exitCode = 1;
  }
}

main();
