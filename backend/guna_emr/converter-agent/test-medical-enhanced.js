#!/usr/bin/env node

/**
 * Test suite for enhanced medical terminology and appointment booking features
 * Tests the new clinical intake capabilities with medical terminology
 */

const http = require('http');

function makeRequest(data, testName) {
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
          resolve({ testName, json });
        } catch (e) {
          reject({ testName, error: 'Failed to parse response: ' + e.message });
        }
      });
    });

    req.on('error', (e) => {
      reject({ testName, error: e.message });
    });

    req.on('timeout', () => {
      req.destroy();
      reject({ testName, error: 'Request timeout' });
    });

    req.write(jsonString);
    req.end();
  });
}

async function runTests() {
  console.log('\n' + '═'.repeat(80));
  console.log('🏥 MEDICAL TERMINOLOGY & APPOINTMENT BOOKING TEST SUITE');
  console.log('═'.repeat(80) + '\n');

  // Test 1: Emergency scenario with dyspnea and chest pain
  console.log('📋 TEST 1: Emergency Detection with Medical Terminology');
  console.log('─'.repeat(80));
  try {
    const result = await makeRequest({
      messages: [
        { role: 'user', content: 'I have severe chest pain and severe dyspnea, I feel faint' }
      ],
      patientPhone: '+91 9876543210'
    }, 'Emergency Medical');

    console.log('✅ Triage Level:', result.json.triageLevel);
    console.log('✅ Emergency Detected:', result.json.redFlags.length > 0);
    console.log('✅ Red Flags:', result.json.redFlags.join(', '));
    console.log('💬 AI Response Preview:', result.json.reply.substring(0, 100) + '...\n');
  } catch (err) {
    console.log('❌ Error:', err.error, '\n');
  }

  // Test 2: Chief complaint intake with medical terminology
  console.log('📋 TEST 2: Chief Complaint Intake with Medical Terms');
  console.log('─'.repeat(80));
  try {
    const result = await makeRequest({
      messages: [
        { role: 'user', content: 'I have fever and persistent cough for 3 days' },
        { role: 'assistant', content: 'When did this symptom onset occur?' },
        { role: 'user', content: 'Started 3 days ago, I have a temperature of 38.5°C and feel malaise' }
      ],
      patientPhone: '+91 9876543210'
    }, 'Chief Complaint');

    console.log('✅ Triage Level:', result.json.triageLevel);
    console.log('✅ Suggested Vitals:', result.json.suggestedVitals.join(', '));
    console.log('✅ Summary:', result.json.summary);
    console.log('💬 AI Response Preview:', result.json.reply.substring(0, 120) + '...\n');
  } catch (err) {
    console.log('❌ Error:', err.error, '\n');
  }

  // Test 3: Appointment booking intent detection
  console.log('📋 TEST 3: Appointment Booking Intent Detection');
  console.log('─'.repeat(80));
  try {
    const result = await makeRequest({
      messages: [
        { role: 'user', content: 'I have a mild cough for 2 days' },
        { role: 'assistant', content: 'When did this symptom start?' },
        { role: 'user', content: 'Yesterday. I want to book an appointment for tomorrow morning' }
      ],
      patientPhone: '+91 9876543210'
    }, 'Appointment Booking');

    console.log('✅ Appointment Booking Offered:', result.json.appointmentBookingOffered || false);
    console.log('✅ Appointment Details:', result.json.appointmentDetails ? JSON.stringify(result.json.appointmentDetails) : 'None');
    console.log('💬 AI Response:', result.json.reply.substring(0, 120) + '...\n');
  } catch (err) {
    console.log('❌ Error:', err.error, '\n');
  }

  // Test 4: Urgent triage with specific medical conditions
  console.log('📋 TEST 4: Urgent Triage - Moderate Dehydration');
  console.log('─'.repeat(80));
  try {
    const result = await makeRequest({
      messages: [
        { role: 'user', content: 'I have persistent vomiting and diarrhea for 24 hours, feeling weak' },
        { role: 'assistant', content: 'How severe are these symptoms?' },
        { role: 'user', content: 'Moderate - I am dehydrated and have not been able to eat or drink' }
      ],
      patientPhone: '+91 9876543210'
    }, 'Urgent Dehydration');

    console.log('✅ Triage Level:', result.json.triageLevel);
    console.log('✅ Ready for Submission:', result.json.readyForSubmission);
    console.log('✅ Needs Appointment:', result.json.needsAppointment || false);
    console.log('💬 AI Response:', result.json.reply.substring(0, 130) + '...\n');
  } catch (err) {
    console.log('❌ Error:', err.error, '\n');
  }

  // Test 5: Complete history with vitals and appointment request
  console.log('📋 TEST 5: Complete History with Vitals and Appointment Request');
  console.log('─'.repeat(80));
  try {
    const result = await makeRequest({
      messages: [
        { role: 'user', content: 'I have been experiencing headaches' },
        { role: 'assistant', content: 'When did these headaches start?' },
        { role: 'user', content: 'About 1 week ago, mild to moderate severity' },
        { role: 'assistant', content: 'Have you checked your vital signs?' },
        { role: 'user', content: 'Yes, BP is 130/85 mmHg, heart rate is 78 bpm, temperature normal' },
        { role: 'assistant', content: 'Thank you. Ready for submission?' },
        { role: 'user', content: 'Yes, I would like to schedule an appointment with a neurologist for next week' }
      ],
      patientPhone: '+91 9876543210'
    }, 'Complete History');

    console.log('✅ Triage Level:', result.json.triageLevel);
    console.log('✅ Ready for Submission:', result.json.readyForSubmission);
    console.log('✅ Appointment Booking Offered:', result.json.appointmentBookingOffered || false);
    console.log('✅ Appointment Details:', result.json.appointmentDetails ? JSON.stringify(result.json.appointmentDetails) : 'None');
    console.log('✅ Clinical Summary:', result.json.summary);
    console.log('💬 AI Response:', result.json.reply.substring(0, 100) + '...\n');
  } catch (err) {
    console.log('❌ Error:', err.error, '\n');
  }

  // Test 6: Medical terminology in responses
  console.log('📋 TEST 6: Verify Medical Terminology in Responses');
  console.log('─'.repeat(80));
  try {
    const result = await makeRequest({
      messages: [
        { role: 'user', content: 'My heart is racing and I feel dizzy' }
      ],
      patientPhone: '+91 9876543210'
    }, 'Medical Terms');

    const response = result.json.reply.toLowerCase();
    const hasClinicialTerms = response.includes('vital') || response.includes('tachycardia') || response.includes('heart rate') || response.includes('chief complaint');
    
    console.log('✅ Response Contains Clinical Terms:', hasClinicialTerms);
    console.log('✅ Suggested Vitals:', result.json.suggestedVitals.join(', '));
    console.log('💬 Full AI Response:', result.json.reply + '\n');
  } catch (err) {
    console.log('❌ Error:', err.error, '\n');
  }

  console.log('═'.repeat(80));
  console.log('✨ TEST SUITE COMPLETE');
  console.log('═'.repeat(80) + '\n');
}

// Run tests
runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
