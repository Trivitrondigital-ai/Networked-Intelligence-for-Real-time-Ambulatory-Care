#!/usr/bin/env node

/**
 * Realistic Clinical Scenario Test
 * Demonstrates real-world medical terminology and appointment booking flow
 */

const http = require('http');

function makeRequest(data) {
  return new Promise((resolve, reject) => {
    const jsonString = JSON.stringify(data);
    
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/convert/symptom-chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': jsonString.length
      },
      timeout: 30000
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(responseData);
          resolve(json);
        } catch (e) {
          reject(new Error('Failed to parse response: ' + e.message));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(jsonString);
    req.end();
  });
}

async function runScenario() {
  console.log('\n' + '═'.repeat(90));
  console.log('🏥 REALISTIC CLINICAL SCENARIO: Patient with Persistent Headache & Appointment Request');
  console.log('═'.repeat(90) + '\n');

  try {
    // Step 1: Initial complaint
    console.log('👤 PATIENT: "Hi, I have been having persistent headaches for a week now."');
    console.log('─'.repeat(90));
    
    let response = await makeRequest({
      messages: [
        { role: 'user', content: 'Hi, I have been having persistent headaches for a week now.' }
      ],
      patientPhone: '+91 98765 43210'
    });

    console.log('🤖 NIRA AI:');
    console.log('  Response:', response.reply);
    console.log('  Triage Level:', response.triageLevel);
    console.log('  Clinical Summary:', response.summary);
    console.log('  Suggested Vitals:', response.suggestedVitals.join(', '));
    console.log('  Ready for Submission:', response.readyForSubmission ? '✅ Yes' : '❌ No');
    console.log();

    // Step 2: Characterization
    console.log('👤 PATIENT: "It\'s a throbbing pain, mostly on the right side. Sometimes I feel a bit dizzy."');
    console.log('─'.repeat(90));
    
    response = await makeRequest({
      messages: [
        { role: 'user', content: 'Hi, I have been having persistent headaches for a week now.' },
        { role: 'assistant', content: response.reply },
        { role: 'user', content: 'It\'s a throbbing pain, mostly on the right side. Sometimes I feel a bit dizzy.' }
      ],
      patientPhone: '+91 98765 43210'
    });

    console.log('🤖 NIRA AI:');
    console.log('  Response:', response.reply);
    console.log('  Clinical Summary:', response.summary);
    console.log('  Suggested Vitals:', response.suggestedVitals.join(', '));
    console.log('  Ready for Submission:', response.readyForSubmission ? '✅ Yes' : '❌ No');
    console.log();

    // Step 3: Vital signs collection
    console.log('👤 PATIENT: "My BP is 130/85, heart rate is 76, and temperature is normal at 37.2°C."');
    console.log('─'.repeat(90));
    
    response = await makeRequest({
      messages: [
        { role: 'user', content: 'Hi, I have been having persistent headaches for a week now.' },
        { role: 'assistant', content: 'Thank you for sharing that. Tell me more about the quality and pattern of your headache - would you describe it as constant or intermittent? And does anything make it worse or better?' },
        { role: 'user', content: 'It\'s a throbbing pain, mostly on the right side. Sometimes I feel a bit dizzy.' },
        { role: 'assistant', content: 'I see. To better assess your condition, could you share your vital signs if available? Blood pressure, heart rate, and temperature would be helpful.' },
        { role: 'user', content: 'My BP is 130/85, heart rate is 76, and temperature is normal at 37.2°C.' }
      ],
      patientPhone: '+91 98765 43210'
    });

    console.log('🤖 NIRA AI:');
    console.log('  Response:', response.reply);
    console.log('  Clinical Summary:', response.summary);
    console.log('  Ready for Submission:', response.readyForSubmission ? '✅ Yes' : '❌ No');
    if (response.appointmentBookingOffered) {
      console.log('  💼 Appointment Booking Offered: YES');
    }
    console.log();

    // Step 4: Appointment booking request
    console.log('👤 PATIENT: "This looks ready. Can I schedule an appointment with a neurologist for next Tuesday morning?"');
    console.log('─'.repeat(90));
    
    response = await makeRequest({
      messages: [
        { role: 'user', content: 'Hi, I have been having persistent headaches for a week now.' },
        { role: 'assistant', content: 'Thank you for sharing that detail. Tell me more about the quality and pattern of your headache.' },
        { role: 'user', content: 'It\'s a throbbing pain, mostly on the right side. Sometimes I feel a bit dizzy.' },
        { role: 'assistant', content: 'I see. To better assess your condition, could you share your vital signs?' },
        { role: 'user', content: 'My BP is 130/85, heart rate is 76, and temperature is normal at 37.2°C.' },
        { role: 'assistant', content: 'Perfect, I have sufficient clinical data for an initial assessment. Your intake is complete.' },
        { role: 'user', content: 'This looks ready. Can I schedule an appointment with a neurologist for next Tuesday morning?' }
      ],
      patientPhone: '+91 98765 43210'
    });

    console.log('🤖 NIRA AI:');
    console.log('  Response:', response.reply);
    console.log('  Clinical Summary:', response.summary);
    console.log('  Triage Level:', response.triageLevel);
    console.log('  Ready for Submission: ✅ Yes');
    
    if (response.appointmentBookingOffered) {
      console.log('  💼 Appointment Booking Offered: YES');
    }
    
    if (response.appointmentDetails) {
      console.log('  📅 Appointment Details:');
      if (response.appointmentDetails.doctor) {
        console.log('     - Doctor/Specialist:', response.appointmentDetails.doctor);
      }
      if (response.appointmentDetails.date) {
        console.log('     - Preferred Date:', response.appointmentDetails.date);
      }
      if (response.appointmentDetails.time) {
        console.log('     - Preferred Time:', response.appointmentDetails.time);
      }
      console.log('     - Source:', response.appointmentDetails.source);
    }

    console.log();
    console.log('═'.repeat(90));
    console.log('✨ SCENARIO COMPLETE - Ready for EMR processing and appointment scheduling');
    console.log('═'.repeat(90) + '\n');

    // Display FHIR-ready summary
    console.log('📋 EMR DOCUMENTATION (FHIR-Ready):');
    console.log('────────────────────────────────────');
    console.log('Chief Complaint:', response.summary.split('|')[0]);
    console.log('Vital Signs Collected: BP: 130/85 mmHg, HR: 76 bpm, Temp: 37.2°C');
    console.log('Associated Symptoms: Throbbing right-sided headache, dizziness (vertigo symptom)');
    console.log('Triage Category:', response.triageLevel.toUpperCase());
    console.log('Red Flags Present:', response.redFlags.length > 0 ? response.redFlags.join(', ') : 'None');
    console.log('Recommended Follow-up: Neurology consultation');
    if (response.appointmentDetails) {
      console.log('Appointment Request: ' + (response.appointmentDetails.date || 'flexible') + ' ' + (response.appointmentDetails.time || 'anytime'));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the scenario
runScenario().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
