import { Router } from "express";
import { adminMiddleware } from "../middlewares/admin.middleware";
import { authMiddleware } from "../middlewares/auth.middleware";
import { rateLimit } from "../middlewares/rateLimit.middleware";
import * as leadController from "../controllers/lead.controller";

const router = Router();

router.post("/", rateLimit({ max: 10 }), leadController.create);
router.get("/", authMiddleware, adminMiddleware, leadController.list);

// /recent va antes de /:id: si no, Express lo toma como un id.
router.get("/recent", leadController.recent);
router.get("/:id", leadController.findOne);
router.put("/:id/qualification", rateLimit({ max: 20 }), leadController.qualify);

export default router;
