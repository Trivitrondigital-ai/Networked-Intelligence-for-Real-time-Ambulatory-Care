-- Initialize databases for NIRA EMR
CREATE DATABASE openmrs;

-- Queue tracking table (supplements FHIR)
CREATE TABLE IF NOT EXISTS opd_queue (
    id SERIAL PRIMARY KEY,
    patient_fhir_id VARCHAR(64) NOT NULL,
    encounter_fhir_id VARCHAR(64),
    doctor_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'waiting',
    priority INTEGER DEFAULT 5,
    token_number INTEGER,
    check_in_time TIMESTAMP DEFAULT NOW(),
    called_time TIMESTAMP,
    completed_time TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_queue_status ON opd_queue(status);
CREATE INDEX idx_queue_doctor ON opd_queue(doctor_name);

-- Sequence for daily token numbers
CREATE SEQUENCE IF NOT EXISTS daily_token_seq START 1;

-- Raw input log for audit
CREATE TABLE IF NOT EXISTS raw_input_log (
    id SERIAL PRIMARY KEY,
    input_type VARCHAR(50) NOT NULL,
    raw_payload JSONB NOT NULL,
    fhir_resources_created JSONB,
    processing_status VARCHAR(50) DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ABHA link/unlink audit trail
CREATE TABLE IF NOT EXISTS patient_abha_links (
    id SERIAL PRIMARY KEY,
    patient_fhir_id VARCHAR(64) NOT NULL,
    local_patient_id VARCHAR(64),
    abha_number VARCHAR(32),
    action VARCHAR(16) NOT NULL,
    linked_by VARCHAR(128),
    payload JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_abha_patient_fhir ON patient_abha_links(patient_fhir_id);
CREATE INDEX IF NOT EXISTS idx_patient_abha_action ON patient_abha_links(action);

-- Canonical AI pre-chart persistence
CREATE TABLE IF NOT EXISTS ai_precharts (
    encounter_id VARCHAR(64) PRIMARY KEY,
    patient_fhir_id VARCHAR(64) NOT NULL,
    chief_complaint TEXT,
    history_of_present_illness TEXT,
    symptoms JSONB NOT NULL DEFAULT '[]'::jsonb,
    duration TEXT,
    severity TEXT,
    extracted_entities JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence_score NUMERIC(5,4),
    raw_transcript TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Unified canonical EMR record with doctor-in-loop approval
CREATE TABLE IF NOT EXISTS emr_records (
    encounter_id VARCHAR(64) PRIMARY KEY,
    patient_fhir_id VARCHAR(64) NOT NULL,
    subjective JSONB NOT NULL DEFAULT '{}'::jsonb,
    objective JSONB NOT NULL DEFAULT '{}'::jsonb,
    assessment JSONB NOT NULL DEFAULT '{}'::jsonb,
    plan JSONB NOT NULL DEFAULT '{}'::jsonb,
    ai_prechart JSONB,
    doctor_edits_log JSONB NOT NULL DEFAULT '[]'::jsonb,
    approved BOOLEAN NOT NULL DEFAULT FALSE,
    approved_at TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 1,
    openmrs_sync_status VARCHAR(16) NOT NULL DEFAULT 'pending',
    openmrs_sync_message TEXT,
    openmrs_last_synced_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emr_records_patient ON emr_records(patient_fhir_id);
CREATE INDEX IF NOT EXISTS idx_emr_records_approved ON emr_records(approved);

-- Immutable doctor edit audit trail
CREATE TABLE IF NOT EXISTS doctor_edits_audit (
    id SERIAL PRIMARY KEY,
    encounter_id VARCHAR(64) NOT NULL,
    edited_by VARCHAR(128),
    section VARCHAR(32) NOT NULL,
    change_summary TEXT NOT NULL,
    before_payload JSONB,
    after_payload JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctor_edits_encounter ON doctor_edits_audit(encounter_id);

-- Demo queue rows for local development (safe to rerun)
DELETE FROM opd_queue WHERE notes LIKE 'seed:%';

INSERT INTO opd_queue (
    patient_fhir_id,
    encounter_fhir_id,
    doctor_name,
    status,
    priority,
    token_number,
    check_in_time,
    notes
)
VALUES
    ('seed-patient-aasha', 'seed-encounter-aasha', 'Dr. Nisha Mehra', 'waiting', 4, 101, NOW() - INTERVAL '35 minutes', 'seed: booked from patient portal'),
    ('seed-patient-priya', 'seed-encounter-priya', 'Dr. Farah Ali', 'waiting', 3, 102, NOW() - INTERVAL '18 minutes', 'seed: awaiting pre-check completion'),
    ('seed-patient-anika', 'seed-encounter-anika', 'Dr. Farah Ali', 'in_consult', 3, 103, NOW() - INTERVAL '9 minutes', 'seed: pre-check done, under consultation'),
    ('seed-patient-rohan', 'seed-encounter-rohan', 'Dr. Arjun Raman', 'completed', 5, 104, NOW() - INTERVAL '2 hours', 'seed: consultation completed today');
