from __future__ import annotations

import os
from typing import Any, Dict

import httpx
from fastapi import FastAPI, HTTPException, Query

HAPI_FHIR_URL = os.getenv("HAPI_FHIR_URL", "http://hapi-fhir:8080/fhir")

app = FastAPI(title="FHIR Service", version="1.0.0", description="HAPI FHIR integration adapter")


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "fhir_service"}


@app.get("/fhir/{resource_type}/{resource_id}")
async def get_resource(resource_type: str, resource_id: str) -> Dict[str, Any]:
    url = f"{HAPI_FHIR_URL}/{resource_type}/{resource_id}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url)

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json()


@app.get("/fhir/search/{resource_type}")
async def search_resource(resource_type: str, query: str = Query(default="")) -> Dict[str, Any]:
    url = f"{HAPI_FHIR_URL}/{resource_type}"
    params = {}
    if query:
        # expected form: key=value&key2=value2
        for kv in query.split("&"):
            if "=" in kv:
                k, v = kv.split("=", 1)
                params[k] = v

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, params=params)

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json()


@app.post("/fhir/{resource_type}")
async def create_resource(resource_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{HAPI_FHIR_URL}/{resource_type}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(url, json=payload)

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json()


@app.put("/fhir/{resource_type}/{resource_id}")
async def update_resource(resource_type: str, resource_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{HAPI_FHIR_URL}/{resource_type}/{resource_id}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.put(url, json=payload)

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json()
