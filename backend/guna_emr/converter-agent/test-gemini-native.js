#!/usr/bin/env node

const https = require('https');
const fs = require('fs');

function loadEnv() {
  const envPath = 'c:\\Users\\Guna\\NIRA\\guna_emr\\.env';
  const content = fs.readFileSync(envPath, 'utf8');
  const line = content.split('\n').find(l => l.startsWith('GEMINI_API_KEY='));
  return line?.split('=')[1]?.trim();
}

async function testNativeGeminiAPI() {
  const apiKey = loadEnv();
  if (!apiKey) {
    console.error('❌ API Key not found');
    return;
  }
  
  console.log('✅ API Key loaded:', apiKey.substring(0, 20) + '...');
  
  return new Promise((resolve) => {
    const data = JSON.stringify({
      contents: [{
        parts: [{
          text: 'Say hello in one word'
        }]
      }]
    });
    
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      },
      timeout: 10000
    };
    
    console.log('\n📡 Calling Native Gemini API (generative/generateContent)...');
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        console.log(`📊 Status: ${res.statusCode}`);
        
        try {
          const response = JSON.parse(body);
          if (res.statusCode === 200) {
            console.log('✅ SUCCESS! Gemini API is working');
            const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
            console.log('✅ Response:', text || 'No content');
          } else {
            console.log('❌ API Error:', response.error?.message || JSON.stringify(response, null, 2).substring(0, 400));
          }
        } catch (e) {
          console.log('❌ Parse error:', body.substring(0, 300));
        }
        resolve();
      });
    });
    
    req.on('error', (e) => {
      console.error('❌ Network error:', e.message);
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

console.log('🧪 Testing Native Gemini API\n');
testNativeGeminiAPI();
