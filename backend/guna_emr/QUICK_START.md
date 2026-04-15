# 🚀 Quick Start: Medical Terminology & Appointment Booking

## What's New?

Your NIRA chatbot now has:
- 🏥 **Medical Terminology**: Uses clinical terms like "dyspnea" instead of "shortness of breath"
- 📅 **Appointment Booking**: Detects when patients want to book and extracts their preferences
- 🚨 **Smart Triage**: Automatically classifies as ROUTINE, URGENT, or EMERGENCY
- 📊 **Structured Data**: FHIR-ready responses perfect for EMR integration

## Test It Yourself

```bash
# 1. Go to the backend compose directory
cd backend/guna_emr

# 2. Copy the example env file and fill in any real keys you want to use
copy .env.example .env

# 3. Start the full stack
docker compose up --build
```

## API Usage Example

### Request
```bash
curl -X POST http://localhost:3001/api/convert/symptom-chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "I have severe chest pain and can't breathe"}
    ],
    "patientPhone": "+91 9876543210"
  }'
```

### Response
```json
{
  "reply": "⚠️ EMERGENCY: Your symptoms suggest a medical emergency requiring immediate evaluation. Please call 911 or proceed directly to the nearest Emergency Department (ED) immediately.",
  "summary": "Chief Complaint: Severe chest pain, severe dyspnea",
  "triageLevel": "emergency",
  "readyForSubmission": true,
  "redFlags": ["chest pain/pressure", "acute dyspnea"],
  "suggestedVitals": ["temperature", "heart rate", "blood pressure"],
  "appointmentBookingOffered": false,
  "needsAppointment": false,
  "usedFallback": false,
  "model": "gemini-2.5-flash"
}
```

## Appointment Booking Example

### Request
```bash
curl -X POST http://localhost:3001/api/convert/symptom-chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "I have a mild cough. Can I book an appointment for tomorrow morning?"},
      {"role": "assistant", "content": "When did this start?"},
      {"role": "user", "content": "Yesterday. I want to see Dr. Smith tomorrow morning."}
    ],
    "patientPhone": "+91 9876543210"
  }'
```

### Response with Booking
```json
{
  "reply": "Certainly. To proceed with scheduling your appointment...",
  "summary": "Chief Complaint: Cough | Duration: 1 day",
  "triageLevel": "routine",
  "readyForSubmission": true,
  "appointmentBookingOffered": true,
  "appointmentDetails": {
    "date": "tomorrow",
    "time": "morning",
    "doctor": "Smith",
    "source": "chat"
  },
  "suggestedVitals": ["temperature", "heart rate"],
  "redFlags": [],
  "usedFallback": false,
  "model": "gemini-2.5-flash"
}
```

## Frontend Integration

### Display Appointment When Offered
```javascript
if (response.appointmentBookingOffered) {
  // Show appointment booking UI
  const date = response.appointmentDetails?.date || 'flexible';
  const time = response.appointmentDetails?.time || 'anytime';
  const doctor = response.appointmentDetails?.doctor || 'our available doctors';
  
  console.log(`Book appointment: ${date} ${time} with ${doctor}`);
}
```

### Show Emergency Alert
```javascript
if (response.triageLevel === 'emergency') {
  // Display prominent emergency message
  alert('EMERGENCY: Call 911 immediately!');
}
```

### Display Suggested Vitals
```javascript
response.suggestedVitals.forEach(vital => {
  switch(vital) {
    case 'temperature':
      showTemperatureInput();
      break;
    case 'blood pressure':
      showBPInput();
      break;
    case 'SpO2':
      showOxigenSaturationInput();
      break;
    case 'heart rate':
      showHeartRateInput();
      break;
  }
});
```

### Display Clinical Summary
```javascript
const [cc, duration, bp, temp, hr, redFlags] = 
  response.summary.split('|').map(s => s.trim());

console.log(`Chief Complaint: ${cc}`);
console.log(`Duration: ${duration}`);
console.log(`Vitals: ${bp}, ${temp}, ${hr}`);
if (redFlags) console.log(`⚠️ ${redFlags}`);
```

## Medical Terminology Reference

| Patient Says | System Uses |
|---|---|
| Shortness of breath | Dyspnea / Acute dyspnea |
| Can't breathe when lying | Orthopnea |
| Rapid heartbeat | Tachycardia |
| Slow heartbeat | Bradycardia |
| Dizziness | Vertigo / Presyncope |
| Fainting | Syncope |
| Sweating | Diaphoresis |
| Confusion | Altered mental status |
| High fever | Pyrexia |
| Difficulty breathing | Dyspnea / Respiratory distress |
| Coughing blood | Hemoptysis |

## Red Flags That Trigger EMERGENCY

### Cardiovascular
- Chest pain/pressure
- Syncope (fainting)
- Severe tachycardia (>120 bpm)
- Hypotension (<90 systolic)

### Respiratory
- Severe dyspnea (can't speak in full sentences)
- Stridor (high-pitched breathing)
- SpO2 <90%

### Neurological
- Altered mental status
- Stroke symptoms (FAST exam: Face droop, Arm weakness, Speech difficulty)
- Severe headache with focal neurological signs

### Hemorrhage
- Active severe bleeding
- Hemoptysis
- Severe GI bleeding

### Infection
- Fever >103°F with confusion
- Sepsis signs (tachycardia, hypotension)

## Configuration

Set these in your `.env` file:
```bash
# Gemini API
GEMINI_API_KEY=your_key_here
LLM_API_KEY=your_key_here
LLM_MODEL=gemini-2.5-flash
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

Without Gemini API key, the system falls back to clinical rules (still works!)

## Docker layout

The full stack is launched from `backend/guna_emr/docker-compose.yml` and includes:
- PostgreSQL, Redis, HAPI FHIR, and OpenMRS infrastructure
- `converter-agent` on port `3001`
- `patient-portal` on port `3002`
- `doctor-portal` on port `3003`

The portal containers now build from the shared frontend app in `frontend/NIRA-repo`, so there is no separate `patient-portal` or `doctor-portal` source directory to create.

## Troubleshooting

**Q: Appointments not being offered?**
A: Check if `triageLevel === "emergency"` – appointments aren't offered for emergencies!

**Q: Medical terms not showing?**
A: Make sure `usedFallback === false` (using Gemini API)

**Q: Red flags not detected?**
A: Add the symptom/keyword to the `inferRedFlags()` function in `aiChat.ts`

**Q: Date/time not extracted from appointment request?**
A: Update regex patterns in `extractAppointmentDetails()` for your date format

## Documentation

- 📖 Full docs: See [MEDICAL_ENHANCEMENTS.md](./MEDICAL_ENHANCEMENTS.md)
- 🔧 Implementation: See [ENHANCEMENT_SUMMARY.md](./ENHANCEMENT_SUMMARY.md)
- 🏗️ Architecture: See [ARCHITECTURE.md](./ARCHITECTURE.md)

## Support

For questions or issues:
1. Check `MEDICAL_ENHANCEMENTS.md` troubleshooting section
2. Review test files for usage examples
3. Check server logs for error messages

---

**Happy booking! 🎉**
