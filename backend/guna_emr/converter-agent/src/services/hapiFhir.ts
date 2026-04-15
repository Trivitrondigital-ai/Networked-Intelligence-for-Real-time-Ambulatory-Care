import axios, { AxiosInstance } from "axios";
import { v4 as uuidv4 } from "uuid";
import type { FhirResource, FhirBundle } from "../types";

// In-memory FHIR store for when HAPI FHIR is unavailable
const memoryStore: Map<string, FhirResource[]> = new Map();

function addToMemory(resource: FhirResource): FhirResource {
  resource.id = resource.id || uuidv4();
  resource.meta = { lastUpdated: new Date().toISOString() };
  const key = resource.resourceType;
  if (!memoryStore.has(key)) memoryStore.set(key, []);
  memoryStore.get(key)!.push(resource);
  return resource;
}

class HapiFhirClient {
  private client: AxiosInstance;
  private online = true;

  constructor() {
    this.client = axios.create({
      baseURL: process.env.HAPI_FHIR_URL || "http://localhost:8080/fhir",
      headers: { "Content-Type": "application/fhir+json" },
      timeout: 5000,
    });
  }

  async createResource<T extends FhirResource>(resource: T): Promise<T> {
    if (this.online) {
      try {
        const { data } = await this.client.post(`/${resource.resourceType}`, resource);
        return data;
      } catch {
        this.online = false;
        console.warn("HAPI FHIR unavailable, using in-memory store");
      }
    }
    return addToMemory(resource) as T;
  }

  async updateResource<T extends FhirResource>(resource: T): Promise<T> {
    if (!resource.id) throw new Error("Resource must have an id to update");
    if (this.online) {
      try {
        const { data } = await this.client.put(`/${resource.resourceType}/${resource.id}`, resource);
        return data;
      } catch { this.online = false; }
    }
    // Update in memory
    const list = memoryStore.get(resource.resourceType) || [];
    const idx = list.findIndex((r) => r.id === resource.id);
    if (idx >= 0) list[idx] = resource;
    else addToMemory(resource);
    return resource;
  }

  async getResource<T extends FhirResource>(resourceType: string, id: string): Promise<T> {
    if (this.online) {
      try {
        const { data } = await this.client.get(`/${resourceType}/${id}`);
        return data;
      } catch { this.online = false; }
    }
    const list = memoryStore.get(resourceType) || [];
    const found = list.find((r) => r.id === id);
    if (found) return found as T;
    throw new Error(`${resourceType}/${id} not found`);
  }

  async searchResource(resourceType: string, params: Record<string, string>): Promise<FhirBundle> {
    if (this.online) {
      try {
        const { data } = await this.client.get(`/${resourceType}`, { params });
        return data;
      } catch { this.online = false; }
    }
    const list = memoryStore.get(resourceType) || [];
    return {
      resourceType: "Bundle",
      type: "searchset",
      entry: list.map((r) => ({ resource: r })),
    } as FhirBundle;
  }

  async submitBundle(bundle: FhirBundle): Promise<FhirBundle> {
    if (this.online) {
      try {
        const { data } = await this.client.post("/", bundle);
        return data;
      } catch { this.online = false; }
    }
    for (const entry of bundle.entry) {
      addToMemory(entry.resource);
    }
    return bundle;
  }

  async findPatientByPhone(phone: string): Promise<FhirResource | null> {
    const bundle = await this.searchResource("Patient", { telecom: phone });
    const entries = (bundle as any).entry;
    if (entries && entries.length > 0) {
      const patient = entries[0].resource;
      if (patient.telecom?.some((t: any) => t.value === phone)) return patient;
    }
    return null;
  }

  getMemoryStore() { return memoryStore; }
}

export const fhirClient = new HapiFhirClient();
