# Medical Terminology & Appointment Booking Enhancements

## Overview

The NIRA healthcare chatbot has been enhanced with **clinical-grade medical terminology** and **integrated appointment booking capabilities**. This makes the intake process more professional while enabling seamless appointment scheduling.

## Features

### 🩺 Medical Terminology Framework

The chatbot now uses standardized medical terminology aligned with clinical best practices:

#### Chief Complaint Assessment
- Focuses on **Chief Complaint (CC)** - primary reason for visit
- Captures **symptom onset** (acute vs chronic)
- Assesses **characterization** (severity, quality, pattern)
- Documents **associated symptoms** and **modifying factors**

#### Vital Sign Collection
- **Temperature** (°C)
- **Heart Rate / Pulse** (bpm)
- **Blood Pressure** (mmHg)
- **Oxygen Saturation** (SpO2 / %)
- **Respiratory Rate** (when needed)

#### Medical Terminology Used
- **Dyspnea** instead of "shortness of breath"
- **Tachycardia** for rapid heart rate
- **Fever / Pyrexia** for elevated temperature
- **Diaphoresis** for sweating
- **Orthopnea** for breathing difficulty when lying flat
- **Altered mental status** instead of "confusion"
- **Syncope / Presyncope** for fainting
- **Hemoptysis** for coughing blood
- **Shock signs** for hemorrhage indicators

### 🏥 Enhanced Triage Protocols

Intelligent triage classification:

```
ROUTINE   - Minor symptoms, stable vitals, no red flags
URGENT    - Moderate symptoms, signs of infection/dehydration, neurological changes
EMERGENCY - Severe chest pain, dyspnea, syncope, stroke signs, hemorrhage, sepsis
```

#### Emergency Red Flags
- **Cardiovascular**: Chest pain/pressure, acute dyspnea, syncope, severe tachycardia (>120), hypotension
- **Respiratory**: Severe dyspnea, SpO2 <90%, stridor
- **Neurological**: Altered mental status, stroke symptoms (FAST exam), severe headache
- **Hemorrhage**: Active bleeding, hemoptysis, GI bleeding
- **Metabolic**: Severe dehydration with shock signs, DKA symptoms
- **Infection**: Fever >103°F with altered mental status, sepsis signs

### 📅 Appointment Booking Integration

Seamless appointment scheduling capabilities:

#### Key Features
- **Intent Detection**: Automatically detects when patient wants to book
- **Preference Extraction**: Captures date, time, and provider preferences
- **Smart Offering**: Offers appointments for routine/urgent cases (not emergencies)
- **Structured Data**: Returns appointment details in response

#### Example Detected Preferences
```json
{
  "appointmentDetails": {
    "date": "tomorrow",
    "time": "morning",
    "doctor": "Dr. Smith",
    "source": "chat"
  }
}
```

#### Keywords Triggering Booking Mode
- "book", "appointment", "schedule", "visit"
- "when can I see", "availability", "available"
- "consult", "doctor's appointment"

## API Response Format

### Enhanced SymptomChatResponse

```typescript
interface SymptomChatResponse {
  // Existing fields
  reply: string;                      // Assistant's clinical response
  summary: string;                    // Clinical summary (Chief Complaint: ..., Vitals: ...)
  readyForSubmission: boolean;        // Ready for provider review
  triageLevel: "routine" | "urgent" | "emergency";
  redFlags: string[];                 // Detected red flags with medical terminology
  suggestedVitals: string[];          // Recommended vital signs to collect

  // NEW FIELDS for appointment booking
  appointmentBookingOffered?: boolean;    // True when appointment offered
  needsAppointment?: boolean;             // True if appointment needed (non-emergency)
  appointmentDetails?: {                  // Extracted appointment preferences
    doctor?: string;
    time?: string;                        // e.g., "morning", "9:30 AM"
    date?: string;                        // e.g., "tomorrow", "2026-04-10"
    source: "chat" | "form" | "auto";
  }
}
```

## Usage Examples

### Example 1: Emergency Route
**Patient**: "I have severe chest pain and can't breathe"

**AI Response**:
```
⚠️ EMERGENCY: Your symptoms suggest a medical emergency requiring immediate evaluation. 
Please call 911 or proceed directly to the nearest Emergency Department (ED) immediately. 
We'll prepare your clinical intake for the ED team.

Triage: EMERGENCY
Red Flags: [chest pain/pressure, acute dyspnea]
```

### Example 2: Appointment Booking
**Patient**: "I have a cough. Can I schedule an appointment tomorrow morning?"

**AI Response** (after history collection):
```
Your clinical intake is complete and ready for provider review. Your symptoms have been 
documented. Would you like to schedule a routine appointment with one of our clinicians?

appointmentBookingOffered: true
appointmentDetails: {
  time: "morning",
  date: "tomorrow",
  source: "chat"
}
```

### Example 3: Systematic History Taking
**Patient**: "I have a headache"

**AI Response**:
```
I'd like to document your initial history properly. What is your chief complaint—
the primary reason for today's visit?

suggestedVitals: ["blood pressure", "temperature"]
```

## Medical Documentation Standards

The system follows these clinical documentation standards:

1. **SOAP Format Compatible**
   - **S**ubjective: Chief complaint, history
   - **O**bjective: Vital signs, observations
   - **A**ssessment: Triage level, red flags
   - **P**lan: Appointment scheduling or ED referral

2. **FHIR Alignment**
   - Structured data ready for EMR integration
   - Coding-friendly for healthcare systems

3. **Legal Compliance**
   - No diagnosis rendering (symptom collection only)
   - Clear documentation trail
   - Emergency protocols clearly stated

## Frontend Integration

To integrate with your frontend:

1. **Display Vital Sign Fields** when `suggestedVitals` contains items:
   ```javascript
   if (response.suggestedVitals.includes("temperature")) {
     // Show temperature input field
   }
   ```

2. **Show Emergency Notice** for emergency triage:
   ```javascript
   if (response.triageLevel === "emergency") {
     // Display prominent 911 recommendation
   }
   ```

3. **Show Appointment Booking** when offered:
   ```javascript
   if (response.appointmentBookingOffered) {
     // Show date/time picker
     // Pre-fill with preferences from appointmentDetails
   }
   ```

4. **Display Red Flags** for clinical context:
   ```javascript
   if (response.redFlags.length > 0) {
     // Display: "Detected issues: asthma, difficulty breathing"
   }
   ```

## Configuration

The enhanced chatbot uses **Gemini 2.5 Flash** by default with these environment variables:

```bash
# Gemini API
GEMINI_API_KEY=your_api_key
LLM_MODEL=gemini-2.5-flash
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta

# Alternative API keys
LLM_API_KEY=same_as_gemini_api_key
```

## Testing

Run the medical terminology test suite:

```bash
cd guna_emr/converter-agent
node test-medical-enhanced.js
```

This tests:
- ✅ Emergency detection
- ✅ Chief complaint intake
- ✅ Appointment booking intent
- ✅ Urgent triage protocols
- ✅ Complete history with vitals
- ✅ Medical terminology usage

## Security & Privacy

- **HIPAA Compliant**: No storage of PHI in logs
- **Encrypted Transport**: HTTPS-only to Gemini API
- **No Diagnosis**: System specifically avoids diagnosis rendering
- **Clear Escalation**: Emergency protocols clearly defined
- **Fallback Mode**: When LLM unavailable, uses clinical fallback rules

## Troubleshooting

### Issue: Appointments not being offered
**Solution**: Check if `triageLevel === "emergency"` (appointments not offered for emergencies)

### Issue: Red flags not detected
**Solution**: Verify red flag keywords are in system prompt and fallback detection

### Issue: Medical terminology not used
**Solution**: Ensure you're using `Gemini 2.5 Flash` and not an older model version

## Future Enhancements

Planned improvements:
- [ ] Integration with doctor availability calendar
- [ ] Multi-language support for medical terminology
- [ ] Voice input with medical speech recognition
- [ ] Historical symptom tracking and patterns
- [ ] Medication interaction checking in appointment flow
- [ ] SMS appointment reminders
