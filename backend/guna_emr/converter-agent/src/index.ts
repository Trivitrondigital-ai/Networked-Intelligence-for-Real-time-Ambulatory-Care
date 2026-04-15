import express from "express";
import cors from "cors";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { loadLocalEnv } from "./services/env";
import { converterRouter } from "./routes/converter";
import { queueRouter } from "./routes/queue";
import { fhirRouter } from "./routes/fhir";
import { emrRouter } from "./routes/emr";
import { setupRedis } from "./services/redis";
import { setupDb } from "./services/db";

loadLocalEnv();

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.text({ type: "text/plain", limit: "10mb" }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "nira-converter-agent" });
});

// Make io available to routes
app.set("io", io);

// Routes
app.use("/api/convert", converterRouter);
app.use("/api/queue", queueRouter);
app.use("/api/fhir", fhirRouter);
app.use("/api", emrRouter);

// Socket.IO for realtime doctor notifications
io.on("connection", (socket) => {
  console.log(`Doctor portal connected: ${socket.id}`);
  socket.on("join-doctor-room", (doctorName: string) => {
    socket.join(`doctor:${doctorName}`);
  });
  socket.on("disconnect", () => {
    console.log(`Disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;

async function main() {
  try {
    await setupDb();
    console.log("DB connected");
  } catch (e: any) {
    console.warn("DB not available, running without persistence:", e.message);
  }
  try {
    await setupRedis();
    console.log("Redis connected");
  } catch (e: any) {
    console.warn("Redis not available, running without pub/sub:", e.message);
  }
  server.listen(PORT, () => {
    console.log(`NIRA Converter Agent running on port ${PORT}`);
  });
}

main().catch(console.error);

export { app, io };
