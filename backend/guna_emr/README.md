# NIRA EMR — Universal Data → FHIR EMR Converter

## Architecture

```
Patient Portal (React :3002) ──┐
                                ├──→ Converter Agent (Node.js :3001)
Doctor Portal (React :3003) ───┘         │
                                         ├── NLP Entity Extractor
                                         ├── FHIR R4 Mapper
                                         ├── HAPI FHIR Server (:8080)
                                         ├── PostgreSQL (:5432)
                                         ├── Redis (:6379) → Socket.IO
                                         └── Bahmni/OpenMRS (:8081)
```

## Quick Start

```bash
# 1. Copy env file
cp .env.example .env

# 2. Start all services
docker-compose up -d

# 3. Access
# Patient Portal: http://localhost:3002
# Doctor Portal:  http://localhost:3003
# HAPI FHIR:     http://localhost:8080
# Converter API:  http://localhost:3001
```

## Dev Mode (without Docker)

```bash
# Terminal 1 — Converter Agent
cd converter-agent && npm install && npm run dev

# Terminal 2 — Patient Portal
cd patient-portal && npm install && npm run dev

# Terminal 3 — Doctor Portal
cd doctor-portal && npm install && npm run dev
```

Requires PostgreSQL, Redis, and HAPI FHIR running locally.

## AI Symptom Chat

The symptom intake supports a guided chatbot flow via Gemini `generateContent` with a dedicated **system instruction** prompt.


If no key is configured, the chatbot falls back to a local intake flow so symptom capture still works offline.

The symptom intake now features a **clinical-grade chatbot** with proper medical terminology and integrated appointment booking.

### Features
- **Medical Terminology**: Uses clinical terminology (dyspnea, tachycardia, fever/pyrexia, SpO2, BP mmHg)
- **Smart Triage**: Classifies as ROUTINE, URGENT, or EMERGENCY with red flag detection
- **Appointment Booking**: Detects booking intent and extracts date/time/provider preferences
- **Systematic History**: Guides through Chief Complaint, vital signs, associated symptoms
- **FHIR-Ready**: Structured data for seamless EMR integration

### Configuration
- Default model: `gemini-3.1-pro` (latest configured model)
- Endpoint: `https://generativelanguage.googleapis.com/v1beta`
- Set `GEMINI_API_KEY` and `LLM_API_KEY` in `guna_emr/.env`
- Optional: set `LLM_SYSTEM_PROMPT` in `guna_emr/.env` to fully override the chatbot system prompt

If no API key configured, falls back to intelligent local triage rules.

### Example Response
```json
{
    "reply": "I've noted your fever and cough. When did this symptom onset occur? ...",
    "summary": "Chief Complaint: Fever, Cough | Duration: 3 days | Temperature: 38.5°C",
    "triageLevel": "routine",
    "readyForSubmission": true,
    "appointmentBookingOffered": true,
    "appointmentDetails": {
        "time": "morning",
        "date": "tomorrow", 
        "source": "chat"
    },
    "redFlags": [],
    "suggestedVitals": ["temperature", "blood pressure"]
}
```

### Appointment Booking Keywords
Patient can trigger booking by saying: "I want to book an appointment", "Schedule for tomorrow morning", "See Dr. Smith next week"

For full documentation on medical enhancements, see [MEDICAL_ENHANCEMENTS.md](./MEDICAL_ENHANCEMENTS.md)

## API Endpoints

### Universal Converter
- `POST /api/convert` — Auto-detect input type, convert to FHIR
- `POST /api/convert/booking` — Booking → Patient + Encounter(planned)
- `POST /api/convert/symptom-chat` — Guided chatbot intake + symptom summary
- `POST /api/convert/symptoms` — Symptom text → Composition + Observations
- `POST /api/convert/doctor-notes` — Doctor notes → Condition + MedicationRequest
- `POST /api/convert/vitals` — Vitals → Observations

### Queue
- `GET /api/queue` — Full OPD queue
- `GET /api/queue/doctor/:name` — Queue for specific doctor
- `PATCH /api/queue/:id/status` — Update queue status

### FHIR Proxy
- `GET /api/fhir/patient/:id` — Get patient
- `GET /api/fhir/patient/:id/everything` — Get all patient resources
- `GET /api/fhir/search/:resourceType?params` — Search FHIR resources

## Input Examples

**Booking:**
```json
{ "phone": "9876543210", "time": "10AM", "doctor": "Dr Rao" }
```

**Symptom Interview:**
```json
{ "text": "I have fever, cough for 3 days, BP 140/90" }
```

**Doctor Notes:**
```json
{ "text": "Exam normal, Dx viral URTI, Rx paracetamol", "patientId": "123", "doctorName": "Dr Rao" }
```

**Vitals:**
```json
{ "patientId": "123", "systolic": 140, "diastolic": 90, "heartRate": 88, "temperature": 101 }
```
