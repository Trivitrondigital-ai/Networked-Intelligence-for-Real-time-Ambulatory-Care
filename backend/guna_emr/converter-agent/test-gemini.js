#!/usr/bin/env node

const https = require('https');
const fs = require('fs');

// Load API key from .env file
function loadEnv() {
  const envPath = 'c:\\Users\\Guna\\NIRA\\guna_emr\\.env';
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env file not found at:', envPath);
    return null;
  }
  
  const content = fs.readFileSync(envPath, 'utf8');
  const line = content.split('\n').find(l => l.startsWith('GEMINI_API_KEY='));
  const key = line?.split('=')[1]?.trim();
  
  if (!key) {
    console.error('❌ GEMINI_API_KEY not found in .env');
    return null;
  }
  
  return key;
}

async function testGeminiAPI() {
  const apiKey = loadEnv();
  if (!apiKey) return;
  
  console.log('✅ API Key loaded:', apiKey.substring(0, 20) + '...');
  
  return new Promise((resolve) => {
    const data = JSON.stringify({
      model: 'gemini-1.5-flash',  // Changed from gemini-2.0-flash
      messages: [
        {
          role: 'user',
          content: 'Say hello in one word'
        }
      ],
      max_tokens: 50
    });
    
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: '/v1beta/openai/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': data.length
      },
      timeout: 10000
    };
    
    console.log('\n📡 Calling Gemini API...');
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        console.log(`\n📊 Status: ${res.statusCode}`);
        
        try {
          const response = JSON.parse(body);
          if (res.statusCode === 200) {
            console.log('✅ SUCCESS! Gemini API is working');
            console.log('✅ Response:', response.choices?.[0]?.message?.content || 'No content');
          } else {
            console.log('❌ API Error:', response.error?.message || response);
          }
        } catch (e) {
          console.log('❌ Parse error:', body.substring(0, 200));
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

console.log('🧪 Testing Gemini API Integration\n');
testGeminiAPI();
