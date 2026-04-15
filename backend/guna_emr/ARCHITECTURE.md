# NIRA EMR — Architecture & Documentation

## System Overview

NIRA EMR is a Universal Data → FHIR EMR Converter that accepts any healthcare input
(bookings, symptom interviews, doctor notes, vitals) and converts them into standardized
FHIR R4 resources, stored in HAPI FHIR with an OPD queue managed via Bahmni/OpenMRS.

The platform now also includes a canonical AI-native EMR layer for:
- `AI_PreChart` persistence
- unified `EMR_Record` (SOAP + approval state)
- immutable `doctor_edits_audit`
- OpenMRS clinical sync attempts during doctor approval

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          NIRA EMR SYSTEM                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────┐         ┌──────────────────┐                      │
│  │  PATIENT PORTAL   │         │  DOCTOR PORTAL    │                     │
│  │  React :3002      │         │  React :3003      │                     │
│  │                   │         │                   │                     │
│  │ ┌──────────────┐ │         │ ┌──────────────┐  │                     │
│  │ │ Booking Form │ │         │ │ OPD Queue    │  │                     │
│  │ │ Symptom Chat │ │         │ │ (Sidebar)    │  │                     │
│  │ │ Vitals Form  │ │         │ │              │  │                     │
│  │ └──────┬───────┘ │         │ ├──────────────┤  │                     │
│  │        │         │         │ │ Patient EMR  │  │                     │
│  │        │ POST    │         │ │ View         │  │                     │
│  │        │         │         │ ├──────────────┤  │                     │
│  │        │         │         │ │ Doctor Notes │  │                     │
│  │        │         │         │ │ Input        │  │                     │
│  │        │         │         │ └──────┬───────┘  │                     │
│  └────────┼─────────┘         └────────┼──────────┘                     │
│           │ REST API                   │ REST + Socket.IO               │
│           ▼                            ▼                                │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │              CONVERTER AGENT (Node.js/Express :3001)         │       │
│  │                                                              │       │
│  │  ┌────────────┐   ┌──────────────┐   ┌─────────────────┐   │       │
│  │  │ INPUT      │   │ NLP ENTITY   │   │ FHIR R4         │   │       │
│  │  │ DETECTOR   │──▶│ EXTRACTOR    │──▶│ MAPPER          │   │       │
│  │  │            │   │              │   │                  │   │       │
│  │  │ Booking?   │   │ Symptoms     │   │ Patient         │   │       │
│  │  │ Symptom?   │   │ Vitals (BP,  │   │ Encounter       │   │       │
│  │  │ Dr Notes?  │   │  HR, Temp,   │   │ Observation     │   │       │
│  │  │ Vitals?    │   │  SpO2)       │   │ Condition       │   │       │
│  │  │ Raw Text?  │   │ Diagnoses    │   │ Composition     │   │       │
│  │  └────────────┘   │ Medications  │   │ MedicationReq   │   │       │
│  │                    │ Exam Finds   │   └────────┬────────┘   │       │
│  │                    └──────────────┘            │            │       │
│  │                                                │            │       │
│  │  ┌─────────────────────────┐                   │            │       │
│  │  │ BAHMNI QUEUE SERVICE    │◀──────────────────┘            │       │
│  │  │                         │                                │       │
│  │  │ Token Generation        │   ┌──────────────────────┐    │       │
│  │  │ Status Management       │   │ SOCKET.IO REALTIME   │    │       │
│  │  │ Doctor Assignment       │   │                      │    │       │
│  │  │ Priority Ordering       │   │ queue-update events  │    │       │
│  │  └────────────┬────────────┘   │ doctor notifications │    │       │
│  │               │                └──────────┬───────────┘    │       │
│  └───────────────┼───────────────────────────┼────────────────┘       │
│                  │                           │                         │
│       ┌──────────┼───────────────────────────┼──────────┐              │
│       │          ▼           DATA LAYER      ▼          │              │
│       │                                                  │              │
│       │  ┌──────────────┐  ┌──────────────┐  ┌────────┐│              │
│       │  │ HAPI FHIR R4 │  │ PostgreSQL   │  │ Redis  ││              │
│       │  │ Server :8080 │  │ 15 :5432     │  │ :6379  ││              │
│       │  │              │  │              │  │        ││              │
│       │  │ Patient      │  │ opd_queue    │  │ Pub/Sub││              │
│       │  │ Encounter    │  │ raw_input_log│  │ Cache  ││              │
│       │  │ Observation  │  │              │  │        ││              │
│       │  │ Condition    │  │              │  │        ││              │
│       │  │ Composition  │  │ (Bahmni/     │  │        ││              │
│       │  │ MedRequest   │  │  OpenMRS)    │  │        ││              │
│       │  └──────────────┘  └──────────────┘  └────────┘│              │
│       └─────────────────────────────────────────────────┘              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

```
  ANY INPUT                    NLP EXTRACTION              FHIR MAPPING              STORAGE
  ─────────                    ──────────────              ────────────              ───────

  Booking JSON ─────┐
  Symptom Text ─────┤         ┌──────────────┐         ┌──────────────┐
  Doctor Notes ─────┼────────▶│ detectInput  │────────▶│ extractEntit │
  Vitals Struct ────┤         │ Type()       │         │ ies()        │
  Raw Text ─────────┘         └──────────────┘         └──────┬───────┘
                                                              │
                              ┌────────────────────────────────┘
                              ▼
                    ┌──────────────────┐     ┌──────────────┐    ┌──────────┐
                    │ createPatient()  │────▶│ HAPI FHIR    │    │ OPD      │
                    │ createEncounter()│────▶│ Server       │    │ Queue    │
                    │ createObservat() │────▶│ (FHIR R4     │    │          │
                    │ createCondition()│────▶│  Resources)  │    │ Token #  │
                    │ createComposit() │────▶│              │    │ Status   │
                    │ createMedReq()   │────▶│              │    │ Doctor   │
                    └──────────────────┘     └──────────────┘    └──────────┘
                                                                      │
                                                                      ▼
                                                              ┌──────────────┐
                                                              │ Socket.IO    │
                                                              │ Notify       │
                                                              │ Doctor Portal│
                                                              └──────────────┘
```

---

## Component Details

### 1. Patient Portal (React — :3002)

| Component       | Purpose                                         |
|-----------------|--------------------------------------------------|
| BookingForm     | Appointment booking (phone, time, doctor)        |
| SymptomChat     | Free-text symptom interview with vitals          |
| VitalsForm      | Structured vitals entry (BP, HR, temp, SpO2, wt) |
| ResultDisplay   | Shows FHIR resources created + queue token       |

### 2. Doctor Portal (React — :3003)

| Component       | Purpose                                          |
|-----------------|--------------------------------------------------|
| QueueSidebar    | Realtime OPD queue, call/complete/cancel patients |
| PatientEMR      | Full EMR view: vitals, notes, diagnoses, meds    |
| DoctorNotes     | Free-text notes → auto-extracted to FHIR         |

### 3. Converter Agent (Node.js/Express — :3001)

| Module               | File                          | Purpose                                  |
|----------------------|-------------------------------|------------------------------------------|
| Input Detector       | universalConverter.ts         | Auto-detects input type from raw data    |
| NLP Extractor        | nlpExtractor.ts               | Regex-based extraction of medical entities|
| FHIR Mapper          | fhirMapper.ts                 | Creates FHIR R4 compliant resources      |
| HAPI FHIR Client     | hapiFhir.ts                   | CRUD operations to HAPI FHIR server      |
| Queue Service        | bahmniQueue.ts                | OPD queue + token management             |
| Realtime             | index.ts (Socket.IO)          | Push notifications to doctor portal      |

### 4. Data Layer

| Service        | Port  | Purpose                                 |
|----------------|-------|-----------------------------------------|
| HAPI FHIR R4   | 8080  | FHIR resource storage & search          |
| PostgreSQL 15   | 5432  | Queue + raw logs + canonical EMR persistence |
| Redis 7         | 6379  | Pub/sub for realtime, caching           |
| OpenMRS/Bahmni  | 8081  | EMR workflow backbone                   |

### 5. Canonical AI-Native EMR Layer (Advanced)

The converter service now persists structured OPD documentation beyond raw FHIR resources.

**Canonical Tables**

| Table | Purpose |
|-------|---------|
| `ai_precharts` | AI-derived pre-consult chart (`chief_complaint`, HPI, symptoms, extracted entities, confidence) |
| `emr_records` | Unified record (`subjective`, `objective`, `assessment`, `plan`, approval, OpenMRS sync status) |
| `doctor_edits_audit` | Append-only doctor edits for traceability and governance |

**Approval Loop**

1. Patient encounter is created.
2. AI generates/persists `AI_PreChart`.
3. Doctor retrieves canonical EMR draft.
4. Doctor edits + approves.
5. System writes final clinical resources to HAPI FHIR and pushes a FHIR Bundle to OpenMRS FHIR endpoint.
6. Sync status (`synced/failed`) is captured in `emr_records`.

---

## API Reference

### Universal Converter

| Method | Endpoint                    | Input                          | Output                              |
|--------|-----------------------------|--------------------------------|-------------------------------------|
| POST   | `/api/convert`              | Any JSON or text               | Auto-detected → FHIR resources      |
| POST   | `/api/convert/booking`      | `{phone, time, doctor}`        | Patient + Encounter(planned)        |
| POST   | `/api/convert/symptoms`     | `{text, patientPhone?}`        | Patient + Encounter + Obs + Comp    |
| POST   | `/api/convert/doctor-notes` | `{text, patientId, doctorName}`| Composition + Condition + MedReq    |
| POST   | `/api/convert/vitals`       | `{patientId, systolic, ...}`   | Observation resources               |

### Queue Management

| Method | Endpoint                    | Purpose                        |
|--------|-----------------------------|--------------------------------|
| GET    | `/api/queue`                | Full OPD queue                 |
| GET    | `/api/queue/doctor/:name`   | Queue filtered by doctor       |
| PATCH  | `/api/queue/:id/status`     | Update: waiting/in-progress/completed/cancelled |

### FHIR Proxy

| Method | Endpoint                           | Purpose                       |
|--------|------------------------------------|-------------------------------|
| GET    | `/api/fhir/patient/:id`            | Get patient resource          |
| GET    | `/api/fhir/patient/:id/everything` | All resources for a patient   |
| GET    | `/api/fhir/encounter/:id`          | Get encounter                 |
| GET    | `/api/fhir/search/:resourceType`   | Search any FHIR resource type |

### Canonical EMR Workflow APIs (Advanced)

| Method | Endpoint                     | Purpose |
|--------|------------------------------|---------|
| POST   | `/api/encounter/create`      | Create encounter + initialize canonical EMR record |
| POST   | `/api/ai/prechart`           | Persist AI pre-chart + attach to canonical EMR |
| GET    | `/api/emr/:encounterId`      | Fetch canonical EMR record |
| POST   | `/api/emr/approve`           | Doctor approval loop + FHIR write + OpenMRS sync |
| POST   | `/api/prescription/generate` | Generate medication suggestions + DDI checks |

---

## FHIR Resource Mapping

### Input → FHIR Resource Map

```
┌─────────────────┬──────────────────────────────────────────────────┐
│ INPUT TYPE      │ FHIR RESOURCES CREATED                           │
├─────────────────┼──────────────────────────────────────────────────┤
│                 │ Patient (demographics, phone)                    │
│ Booking         │ Encounter (status: planned, doctor assigned)     │
│                 │ Queue Entry (token number)                       │
├─────────────────┼──────────────────────────────────────────────────┤
│                 │ Patient (if new)                                 │
│ Symptom         │ Encounter (status: arrived)                      │
│ Interview       │ Observation (BP, HR, temp — if mentioned)        │
│                 │ Composition (chief complaint, symptoms, duration) │
│                 │ Queue Entry (token number)                       │
├─────────────────┼──────────────────────────────────────────────────┤
│                 │ Composition (exam findings + assessment + plan)  │
│ Doctor Notes    │ Condition (diagnosis with ICD-10 code)           │
│                 │ MedicationRequest (Rx with dosage)               │
│                 │ Observation (if vitals mentioned)                │
├─────────────────┼──────────────────────────────────────────────────┤
│ Vitals          │ Observation (BP panel, HR, temp, SpO2, weight,  │
│ (Structured)    │  respiratory rate — one resource per vital)      │
└─────────────────┴──────────────────────────────────────────────────┘
```

### NLP Entity Extraction

The NLP extractor uses regex patterns to extract:

| Entity Type    | Patterns Recognized                                    |
|----------------|-------------------------------------------------------|
| Blood Pressure | `BP 140/90`, `140/90 mmHg`, `blood pressure 130/85`   |
| Heart Rate     | `HR 72`, `pulse 80 bpm`, `heart rate 90`              |
| Temperature    | `temp 101`, `fever 102°F`, `temperature 98.6`         |
| SpO2           | `spo2 98%`, `oxygen saturation 95%`, `o2 sat 97`      |
| Weight         | `weight 70 kg`, `wt 65`                               |
| Resp. Rate     | `RR 18`, `respiratory rate 20/min`                     |
| Symptoms       | 40+ common symptoms (fever, cough, headache, etc.)     |
| Duration       | `for 3 days`, `since 2 weeks`, `x 5 days`             |
| Diagnoses      | `Dx viral URTI`, inline: URTI, pneumonia, dengue, etc.|
| Medications    | `Rx paracetamol`, `Tab amoxicillin`, inline: 15+ common meds |
| Exam Findings  | `Exam normal`, `O/E: chest clear`                     |

---

## Deployment

### Docker Compose (Production)

```bash
cd guna_emr
cp .env.example .env    # Set POSTGRES_PASSWORD, LLM_API_KEY (or GEMINI_API_KEY)
docker-compose up -d
```

Services start in dependency order:
PostgreSQL → HAPI FHIR + Redis + OpenMRS → Converter Agent → Portals

### Dev Mode (Local)

```bash
# Terminal 1 — API
cd guna_emr/converter-agent && npm install && npm run dev

# Terminal 2 — Patient UI
cd guna_emr/patient-portal && npm install && npm run dev

# Terminal 3 — Doctor UI
cd guna_emr/doctor-portal && npm install && npm run dev
```

The converter agent gracefully degrades without external services
(PostgreSQL, Redis, HAPI FHIR), using in-memory storage.

---

## Directory Structure

```
guna_emr/
├── docker-compose.yml          # Full stack orchestration
├── .env.example                # Environment variables template
├── README.md                   # Quick start guide
├── ARCHITECTURE.md             # This file
│
├── db/
│   └── init.sql                # PostgreSQL schema (queue + audit + canonical EMR)
│
├── converter-agent/            # Node.js/Express backend
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts            # Express + Socket.IO server
│       ├── types.ts            # FHIR R4 type definitions
│       ├── routes/
│       │   ├── converter.ts    # POST /api/convert/*
│       │   ├── queue.ts        # GET/PATCH /api/queue/*
│       │   ├── fhir.ts         # GET /api/fhir/*
│       │   └── emr.ts          # Canonical EMR workflow APIs
│       └── services/
│           ├── universalConverter.ts  # Orchestrator
│           ├── nlpExtractor.ts        # Regex NLP engine
│           ├── fhirMapper.ts          # FHIR R4 resource builders
│           ├── hapiFhir.ts            # HAPI FHIR client (+ memory fallback)
│           ├── emrPersistence.ts      # AI_PreChart + EMR_Record persistence
│           ├── openmrsSync.ts         # OpenMRS FHIR bundle sync client
│           ├── bahmniQueue.ts         # OPD queue (+ memory fallback)
│           ├── db.ts                  # PostgreSQL connection
│           └── redis.ts               # Redis connection
│
├── patient-portal/             # React patient-facing UI
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── index.css
│       └── components/
│           ├── BookingForm.tsx
│           ├── SymptomChat.tsx
│           ├── VitalsForm.tsx
│           └── ResultDisplay.tsx
│
└── doctor-portal/              # React doctor-facing UI
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx
        ├── main.tsx
        ├── index.css
        └── components/
            ├── QueueSidebar.tsx
            ├── PatientEMR.tsx
            └── DoctorNotes.tsx
```

---

## Tested Scenarios

| # | Input                                              | Result                                              |
|---|----------------------------------------------------|-----------------------------------------------------|
| 1 | `{phone: "9876543210", time: "10AM", doctor: "Dr Rao"}` | Patient + Encounter(planned) + Token #1        |
| 2 | `"I have fever, cough for 3 days, BP 140/90"`      | Patient + Encounter(arrived) + Observation(BP) + Composition + Token #2 |
| 3 | `"Exam normal, Dx viral URTI, Rx paracetamol"`     | Composition(exam+plan) + Condition(URTI) + MedicationRequest(paracetamol) |
| 4 | `{patientId: "x", systolic: 140, diastolic: 90}`   | Observation(BP panel)                               |

All scenarios verified via API on 2026-04-09.
