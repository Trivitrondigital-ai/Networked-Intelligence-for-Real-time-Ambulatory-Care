#!/usr/bin/env node

const https = require('https');
const fs = require('fs');

function loadEnv() {
  const envPath = 'c:\\Users\\Guna\\NIRA\\guna_emr\\.env';
  const content = fs.readFileSync(envPath, 'utf8');
  const line = content.split('\n').find(l => l.startsWith('GEMINI_API_KEY='));
  return line?.split('=')[1]?.trim();
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body: body });
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  const apiKey = loadEnv();
  if (!apiKey) {
    console.error('❌ API Key not found');
    process.exit(1);
  }
  
  console.log('✅ API Key loaded:', apiKey.substring(0, 20) + '...\n');
  
  // Test 1: List available models
  console.log('📋 TEST 1: Listing available models...\n');
  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const listRes = await httpsGet(listUrl);
    
    if (listRes.status === 200 && listRes.body.models) {
      console.log(`✅ Found ${listRes.body.models.length} available models:\n`);
      listRes.body.models.forEach((model, i) => {
        const name = model.name.replace('models/', '');
        const supportedMethods = model.supportedGenerationMethods?.join(', ') || 'N/A';
        console.log(`  ${i + 1}. ${name}`);
        console.log(`     Methods: ${supportedMethods}\n`);
      });
      
      // Find a model that supports generateContent
      const generateModel = listRes.body.models.find(m => 
        m.supportedGenerationMethods?.includes('generateContent')
      );
      
      if (generateModel) {
        const modelName = generateModel.name.replace('models/', '');
        console.log(`🎯 Using model: ${modelName}\n`);
        
        // Test 2: Try a simple message
        console.log('📡 TEST 2: Sending test message to Gemini...\n');
        return testMessage(apiKey, modelName);
      }
    } else {
      console.log('❌ Failed to list models:', listRes.body);
    }
  } catch (e) {
    console.error('❌ Error:', e.message);
  }
}

function testMessage(apiKey, modelName) {
  return new Promise((resolve) => {
    const data = JSON.stringify({
      contents: [{
        parts: [{
          text: 'You are a healthcare intake assistant. Patient says: I have fever and headache for 2 days. Respond in JSON format with: reply (short follow-up question), summary (key findings), readyForSubmission (boolean), triageLevel (routine/urgent/emergency), redFlags (array of warning signs).'
        }]
      }]
    });
    
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      },
      timeout: 15000
    };
    
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        console.log(`📊 Status: ${res.statusCode}`);
        
        try {
          const response = JSON.parse(body);
          if (res.statusCode === 200) {
            console.log('✅ SUCCESS! Gemini API is working\n');
            const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
            console.log('📝 Response:\n', text);
            
            console.log('\n' + '='.repeat(60));
            console.log('✅ API KEY TEST PASSED - Gemini is working!');
            console.log('='.repeat(60));
          } else {
            console.log('❌ API Error:', response.error?.message || body.substring(0, 300));
          }
        } catch (e) {
          console.log('Error parsing response:', body.substring(0, 200));
        }
        resolve();
      });
    });
    
    req.on('error', (e) => {
      console.error('❌ Request error:', e.message);
      resolve();
    });
    
    req.on('timeout', () => {
      console.error('❌ Request timeout');
      req.destroy();
      resolve();
    });
    
    req.write(data);
    req.end();
  });
}

console.log('🧪 GEMINI API KEY TEST\n' + '='.repeat(40) + '\n');
main().catch(console.error);
