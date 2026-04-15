# CDSS Platform (AI-assisted, safety-first)

Production-grade hybrid CDSS microservice stack for OPD workflows:

- **Rule-based safety engine** (DDI, allergy, dosage checks)
- **LLM-based reasoning** (Gemini primary, Ollama/Llama fallback)
- **NLP structured extraction** (spaCy + MedCAT hooks)
- **EMR adapter** (OpenMRS)
- **FHIR adapter** (HAPI FHIR)

> This system is **assistive**. It never auto-approves diagnosis or prescriptions.

## Services

- `cdss_service` (port 8010) – orchestration + safety + explainability
- `ai_service` (port 8011) – reasoning and AI precheck questions
- `nlp_service` (port 8012) – transcript entity extraction
- `emr_service` (port 8013) – OpenMRS bridge + CDSS artifact persistence
- `fhir_service` (port 8014) – HAPI FHIR CRUD passthrough
- `shared` – common models, terminology and rule engine

## Primary flow (AI-first precheck, clinician-validated)

1. `POST /cdss/precheck` → AI generates patient-specific precheck questions.
2. Patient answers are captured in UI.
3. `POST /cdss/analyze` with transcript + `precheck_answers`.
4. CDSS runs NLP → AI reasoning → deterministic safety checks.
5. CDSS persists precheck + analysis artifacts to EMR bridge and local audit store.
6. Doctor reviews and validates. `POST /cdss/doctor-override` logs edits/overrides.

## API Endpoints

### CDSS

- `POST /cdss/precheck`
- `GET /cdss/precheck/{encounter_id}`
- `POST /cdss/analyze`
- `POST /cdss/ddi-check`
- `POST /cdss/validate-prescription`
- `GET /cdss/explain/{encounter_id}`
- `POST /cdss/doctor-override`

### EMR

- `GET /emr/patient/{patient_id}`
- `GET /emr/encounter/{encounter_id}`
- `POST /emr/cdss/precheck`
- `POST /emr/cdss/analysis`
- `GET /emr/cdss/{encounter_id}`

### FHIR

- `GET /fhir/{resource_type}/{resource_id}`
- `GET /fhir/search/{resource_type}`
- `POST /fhir/{resource_type}`
- `PUT /fhir/{resource_type}/{resource_id}`

## Run with Docker Compose

From `backend/guna_emr/cdss-platform`:

- `docker compose up --build`

### Gemini setup (recommended)

Configure these in `cdss-platform/.env`:

- `GEMINI_API_KEY` (or `LLM_API_KEY`)
- `LLM_MODEL` (e.g. `gemini-2.5-flash`)
- `LLM_BASE_URL` (default `https://generativelanguage.googleapis.com/v1beta`)

If Gemini is not configured/reachable, `ai_service` automatically falls back to Ollama.

OpenAPI docs:

- CDSS: `http://localhost:8010/docs`
- AI: `http://localhost:8011/docs`
- NLP: `http://localhost:8012/docs`
- EMR: `http://localhost:8013/docs`
- FHIR: `http://localhost:8014/docs`

## Safety constraints enforced

- No auto-approval (`doctor_validation_required=true`, `auto_approved=false`)
- Critical unsafe combinations are blocked
- Explainable deterministic rule IDs on alerts
- Doctor override events are logged for governance/fine-tuning datasets
