import { Router, Request, Response, NextFunction } from "express";
import { CustomError } from "../errors/customError.error";
import { rateLimit } from "../middlewares/rateLimit.middleware";
import { uploadMiddleware } from "../middlewares/upload.middleware";
import * as paymentController from "../controllers/payment.controller";

const router = Router();

/** Multer lanza errores sin status (archivo muy pesado, campo inesperado): son un 400, no un 500. */
function receiptUpload(req: Request, res: Response, next: NextFunction) {
  uploadMiddleware.single("receipt")(req, res, (error: unknown) => {
    if (!error) return next();
    const tooLarge = (error as { code?: string }).code === "LIMIT_FILE_SIZE";
    next(
      new CustomError(
        tooLarge
          ? "El comprobante pesa demasiado. Sube un archivo de hasta 10 MB."
          : "No pudimos leer el comprobante. Intenta con otra foto o PDF.",
        400,
      ),
    );
  });
}

router.post("/", rateLimit({ max: 10 }), paymentController.create);
// La página de respuesta se recarga más de lo que uno cree: cupo más amplio.
router.post("/confirm", rateLimit({ max: 30 }), paymentController.confirm);
router.post("/transfer", rateLimit({ max: 10 }), receiptUpload, paymentController.transfer);

export default router;
