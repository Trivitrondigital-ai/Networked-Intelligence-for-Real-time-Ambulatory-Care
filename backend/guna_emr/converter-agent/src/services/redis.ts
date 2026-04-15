import Redis from "ioredis";

let redis: Redis | null = null;

export async function setupRedis() {
  redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // Don't retry if unavailable
    connectTimeout: 3000,
    lazyConnect: true,
  });
  redis.on("error", () => {}); // Suppress errors
  await redis.connect();
  console.log("Redis connected");
}

export function getRedis(): Redis | null {
  return redis;
}
