import express, { Application } from "express";
import authRoutes from "./auth.routes";
import healthRoutes from "./health.routes";
import leadRoutes from "./lead.routes";
import paymentRoutes from "./payment.routes";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  router.use("/health", healthRoutes);
  router.use("/auth", authRoutes);
  router.use("/leads", leadRoutes);
  router.use("/payments", paymentRoutes);
}

export default routerApi;
