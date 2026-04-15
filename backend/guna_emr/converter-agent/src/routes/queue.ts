import { Router, Request, Response } from "express";
import * as bahmniQueue from "../services/bahmniQueue";

export const queueRouter = Router();

/**
 * GET /api/queue - Get full OPD queue
 */
queueRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const entries = await bahmniQueue.getFullQueue();
    return res.json({ queue: entries });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/queue/doctor/:name - Get queue for specific doctor
 */
queueRouter.get("/doctor/:name", async (req: Request, res: Response) => {
  try {
    const entries = await bahmniQueue.getQueueForDoctor(req.params.name);
    return res.json({ queue: entries });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/queue/:id/status - Update queue entry status
 */
queueRouter.patch("/:id/status", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;

    if (!["waiting", "in-progress", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const entry = await bahmniQueue.updateQueueStatus(id, status);

    const io = req.app.get("io");
    if (io) io.emit("queue-update", { type: "status-change", entry });

    return res.json(entry);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});
