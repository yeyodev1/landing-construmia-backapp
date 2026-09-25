/**
 * Opciones cerradas del embudo. Son el contrato con el frontapp
 * (`src/config/qualification.ts`): si cambia un valor acá, cambia allá.
 * El label viaja en el webhook para que el CRM no tenga que traducir códigos.
 */
export const START_TIMEFRAMES = {
  inmediato: "Lo antes posible (menos de 1 mes)",
  "1-3-meses": "En 1 a 3 meses",
  "3-6-meses": "En 3 a 6 meses",
  "mas-6-meses": "En más de 6 meses",
  explorando: "Solo estoy explorando",
} as const;

export const PROJECT_TYPES = {
  "remodelacion-integral": "Remodelación integral (varios espacios)",
  ampliacion: "Ampliación / obra civil",
  "casa-antigua": "Reestructuración de una casa antigua",
  "construccion-nueva": "Construcción desde cero",
  "un-ambiente": "Un solo ambiente puntual (cocina, baño, cuarto o patio)",
} as const;

/** Si ya arrancó la obra, se pregunta qué servicio busca. */
export const PROJECT_STAGES = {
  nuevo: "Proyecto nuevo",
  "en-curso": "Proyecto en curso",
} as const;

export const SERVICES_NEEDED = {
  "solo-diseno": "Solo el diseño",
  asesoria: "Asesoría profesional",
  supervision: "Supervisión del proyecto",
  todo: "Todo lo anterior",
} as const;

export const BUDGETS = {
  "menos-15k": "Menos de $15.000",
  "15k-30k": "$15.000 a $30.000",
  "30k-60k": "$30.000 a $60.000",
  "60k-100k": "$60.000 a $100.000",
  "mas-100k": "Más de $100.000",
} as const;

export const PROPERTY_STATUSES = {
  propia: "Es mi propiedad",
  "en-compra": "La estoy comprando",
  familiar: "Es de mi familia",
  alquilada: "Es alquilada",
} as const;

export const LOCATIONS = {
  guayaquil: "Guayaquil",
  quito: "Quito",
  cuenca: "Cuenca",
  otra: "Otras ciudades",
} as const;

/** Ya no se ofrecen, pero hay leads guardados con ellas: el CRM y los correos las siguen nombrando. */
export const LOCATION_LABELS: Record<string, string> = {
  ...LOCATIONS,
  samborondon: "Samborondón",
  "via-a-la-costa": "Vía a la Costa",
  "daule-aurora": "Daule / La Aurora",
  "salinas-peninsula": "Salinas / Península",
};

export const DECISION_MAKERS = {
  yo: "Yo decido",
  pareja: "Lo decido con mi pareja",
  "familia-socios": "Lo decidimos entre familia o socios",
} as const;

/** El método es para proyectos desde $30.000 (lo dice el video). */
export const QUALIFYING_BUDGETS: readonly string[] = ["30k-60k", "60k-100k", "mas-100k"];

export type StartTimeframe = keyof typeof START_TIMEFRAMES;
export type ProjectType = keyof typeof PROJECT_TYPES;
export type ProjectStage = keyof typeof PROJECT_STAGES;
export type ServiceNeeded = keyof typeof SERVICES_NEEDED;
export type Budget = keyof typeof BUDGETS;
export type PropertyStatus = keyof typeof PROPERTY_STATUSES;
export type LeadLocation = keyof typeof LOCATIONS;
export type DecisionMaker = keyof typeof DECISION_MAKERS;

/** Visita técnica: $50, sin desglose de IVA. En centavos, como lo exige Payphone. */
export const VISIT_PRICE_CENTS = 5000;
export const VISIT_REFERENCE = "Visita técnica Construmia";
