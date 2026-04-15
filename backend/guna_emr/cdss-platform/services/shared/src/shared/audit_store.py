from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Optional


class AuditStore:
    def __init__(self, db_path: str) -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self._path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cdss_analysis (
                    encounter_id TEXT PRIMARY KEY,
                    patient_id TEXT NOT NULL,
                    transcript TEXT NOT NULL,
                    reasoning TEXT NOT NULL,
                    confidence_scores TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS doctor_overrides (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    encounter_id TEXT NOT NULL,
                    doctor_id TEXT NOT NULL,
                    approved INTEGER NOT NULL,
                    comments TEXT,
                    original_suggestions TEXT NOT NULL,
                    edited_suggestions TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS precheck_sessions (
                    encounter_id TEXT PRIMARY KEY,
                    patient_id TEXT NOT NULL,
                    questions_json TEXT NOT NULL,
                    confidence_scores TEXT NOT NULL,
                    reasoning TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def save_analysis(self, encounter_id: str, patient_id: str, transcript: str, reasoning: str, confidence_scores: Dict[str, Any], payload: Dict[str, Any]) -> None:
        with self._lock, sqlite3.connect(self._path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO cdss_analysis
                (encounter_id, patient_id, transcript, reasoning, confidence_scores, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    encounter_id,
                    patient_id,
                    transcript,
                    reasoning,
                    json.dumps(confidence_scores),
                    json.dumps(payload),
                ),
            )

    def get_analysis(self, encounter_id: str) -> Optional[Dict[str, Any]]:
        with self._lock, sqlite3.connect(self._path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT encounter_id, reasoning, confidence_scores, payload_json FROM cdss_analysis WHERE encounter_id = ?",
                (encounter_id,),
            ).fetchone()

        if not row:
            return None

        return {
            "encounter_id": row["encounter_id"],
            "reasoning": row["reasoning"],
            "confidence_scores": json.loads(row["confidence_scores"]),
            "payload": json.loads(row["payload_json"]),
        }

    def save_override(self, encounter_id: str, doctor_id: str, approved: bool, comments: str, original_suggestions: Dict[str, Any], edited_suggestions: Dict[str, Any]) -> None:
        with self._lock, sqlite3.connect(self._path) as conn:
            conn.execute(
                """
                INSERT INTO doctor_overrides
                (encounter_id, doctor_id, approved, comments, original_suggestions, edited_suggestions)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    encounter_id,
                    doctor_id,
                    1 if approved else 0,
                    comments,
                    json.dumps(original_suggestions),
                    json.dumps(edited_suggestions),
                ),
            )

    def save_precheck(
        self,
        encounter_id: str,
        patient_id: str,
        questions: Dict[str, Any],
        confidence_scores: Dict[str, Any],
        reasoning: str,
    ) -> None:
        with self._lock, sqlite3.connect(self._path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO precheck_sessions
                (encounter_id, patient_id, questions_json, confidence_scores, reasoning)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    encounter_id,
                    patient_id,
                    json.dumps(questions),
                    json.dumps(confidence_scores),
                    reasoning,
                ),
            )

    def get_precheck(self, encounter_id: str) -> Optional[Dict[str, Any]]:
        with self._lock, sqlite3.connect(self._path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT encounter_id, patient_id, questions_json, confidence_scores, reasoning
                FROM precheck_sessions
                WHERE encounter_id = ?
                """,
                (encounter_id,),
            ).fetchone()

        if not row:
            return None

        return {
            "encounter_id": row["encounter_id"],
            "patient_id": row["patient_id"],
            "questions": json.loads(row["questions_json"]),
            "confidence_scores": json.loads(row["confidence_scores"]),
            "reasoning": row["reasoning"],
        }
