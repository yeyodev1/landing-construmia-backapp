import { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  /** Peticiones permitidas por IP dentro de la ventana. */
  max?: number;
  windowMs?: number;
  message?: string;
}

const MAX_TRACKED_IPS = 5000;

/**
 * Detrás de Vercel req.ip es la del proxy (app.ts no activa "trust proxy"), así
 * que se toma la primera IP de x-forwarded-for, que Vercel sobrescribe con la real.
 */
function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.ip || req.socket.remoteAddress || "desconocida";
}

/**
 * Rate limit en memoria, sin dependencias. Cada llamada crea un contador propio,
 * así un endpoint no gasta el cupo de otro.
 *
 * OJO en Vercel: el estado vive en la instancia de la función. Con varias
 * instancias en paralelo, o tras un cold start, el contador arranca de cero, así
 * que el límite real es "max por instancia". Alcanza para frenar un bot sencillo
 * o un doble clic en bucle; no es una defensa contra un ataque distribuido
 * (para eso: Vercel Firewall o un store compartido como Upstash).
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const max = options.max ?? 10;
  const windowMs = options.windowMs ?? 10 * 60 * 1000;
  const message =
    options.message ?? "Demasiados intentos. Espera unos minutos y vuelve a intentar.";
  const buckets = new Map<string, Bucket>();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();

    // Limpieza perezosa: sin timers, que en serverless no tienen garantía de correr.
    if (buckets.size > MAX_TRACKED_IPS) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      // Si aun así no baja (ráfaga de IPs distintas), se empieza de cero antes que crecer sin techo.
      if (buckets.size > MAX_TRACKED_IPS) buckets.clear();
    }

    const ip = clientIp(req);
    let bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
    }

    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ message });
      return;
    }

    next();
  };
}
