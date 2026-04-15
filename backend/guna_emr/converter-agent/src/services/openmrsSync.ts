import axios from "axios";
import type { FhirBundle } from "../types";

function getOpenMrsBaseUrl() {
  return (process.env.OPENMRS_URL || "http://localhost:8081/openmrs").replace(/\/$/, "");
}

function getOpenMrsFhirPath() {
  return process.env.OPENMRS_FHIR_PATH || "/ws/fhir2/R4";
}

function getOpenMrsAuth() {
  const username = process.env.OPENMRS_USERNAME;
  const password = process.env.OPENMRS_PASSWORD;

  if (!username || !password) return undefined;
  return { username, password };
}

export interface OpenMrsSyncResult {
  ok: boolean;
  status: "synced" | "failed";
  message: string;
}

export async function pushBundleToOpenMrs(bundle: FhirBundle): Promise<OpenMrsSyncResult> {
  const baseUrl = getOpenMrsBaseUrl();
  const path = getOpenMrsFhirPath();

  try {
    const response = await axios.post(`${baseUrl}${path}`, bundle, {
      headers: {
        "Content-Type": "application/fhir+json",
      },
      auth: getOpenMrsAuth(),
      timeout: 12000,
    });

    if (response.status >= 200 && response.status < 300) {
      return {
        ok: true,
        status: "synced",
        message: `OpenMRS sync successful (${response.status})`,
      };
    }

    return {
      ok: false,
      status: "failed",
      message: `OpenMRS sync failed (${response.status})`,
    };
  } catch (error: any) {
    return {
      ok: false,
      status: "failed",
      message: `OpenMRS sync failed: ${error?.message || "Unknown error"}`,
    };
  }
}
