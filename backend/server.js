// Install dependencies:
// npm install express stellar-sdk axios cors body-parser dotenv

const express = require('express');
const axios = require('axios');
const StellarSdk = require('stellar-sdk');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require("path");
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configuration - set these in your .env file
const HOME_DOMAIN = process.env.HOME_DOMAIN || 'anchor-stage.owlpay.com';
const CLIENT_DOMAIN = process.env.CLIENT_DOMAIN || 'o55xnn-ip-220-133-81-12.tunnelmole.net';
const CLIENT_SIGNING_KEY = process.env.CLIENT_SIGNING_KEY; // Your server's signing key

if (!CLIENT_SIGNING_KEY) {
  console.warn('WARNING: CLIENT_SIGNING_KEY not set. Client domain signing will fail.');
}

app.get("/.well-known/stellar.toml", (req, res) => {
  res.sendFile("stellar.toml", { root: path.join(__dirname, ".well-known") });
});

// Step 1: Get Challenge from Anchor (Anchor signs it)
app.post('/api/sep10/get-challenge', async (req, res) => {
  try {
    const { account } = req.body;

    if (!account) {
      return res.status(400).json({ 
        error: 'Missing required field: account' 
      });
    }

    console.log('=== STEP 1: Getting Challenge from Anchor ===');
    console.log(`Account: ${account}`);
    console.log(`Home Domain: ${HOME_DOMAIN}`);

    // Get the TOML file to find the web auth endpoint
    const tomlUrl = `${HOME_DOMAIN}/.well-known/stellar.toml`;
    console.log(`Fetching TOML from: ${tomlUrl}`);
    
    const tomlResponse = await axios.get(tomlUrl);
    const tomlText = tomlResponse.data;
    
    // Parse WEB_AUTH_ENDPOINT from TOML
    const webAuthMatch = tomlText.match(/WEB_AUTH_ENDPOINT\s*=\s*"([^"]+)"/);
    if (!webAuthMatch) {
      return res.status(400).json({ 
        error: 'WEB_AUTH_ENDPOINT not found in stellar.toml' 
      });
    }
    
    const webAuthEndpoint = webAuthMatch[1];
    console.log(`Web Auth Endpoint: ${webAuthEndpoint}`);

    // Request challenge from anchor with client_domain
    const challengeUrl = `${webAuthEndpoint}?account=${encodeURIComponent(account)}&client_domain=${encodeURIComponent(CLIENT_DOMAIN)}`;
    console.log(`Requesting challenge: ${challengeUrl}`);
    
    const challengeResponse = await axios.get(challengeUrl);
    
    console.log('✓ Challenge received from Anchor (Anchor has signed)');
    console.log(`Network: ${challengeResponse.data.network_passphrase}`);
    
    // Return anchor-signed transaction to FE
    res.json({
      transaction: challengeResponse.data.transaction,
      network_passphrase: challengeResponse.data.network_passphrase,
      webAuthEndpoint: webAuthEndpoint
    });

  } catch (error) {
    console.error('Challenge error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to get challenge from anchor',
      details: error.response?.data || error.message 
    });
  }
});

// Step 2: Removed - User signs CLIENT-SIDE in browser
// The secret key NEVER leaves the frontend for security

// Step 3: BE Signs for client_domain and Submits to Anchor
app.post('/api/sep10/submit', async (req, res) => {
  try {
    const { signedTransaction, networkPassphrase } = req.body;

    if (!signedTransaction || !networkPassphrase) {
      return res.status(400).json({ 
        error: 'Missing required fields: signedTransaction, networkPassphrase' 
      });
    }

    console.log('=== STEP 3: Server Signing for client_domain ===');
    console.log('Note: User already signed CLIENT-SIDE (secret never sent to server)');

    if (!CLIENT_SIGNING_KEY) {
      return res.status(500).json({
        error: 'CLIENT_SIGNING_KEY not configured on server'
      });
    }

    // Determine network
    let network;
    if (networkPassphrase.includes('Test')) {
      network = StellarSdk.Networks.TESTNET;
    } else if (networkPassphrase.includes('Public')) {
      network = StellarSdk.Networks.PUBLIC;
    } else {
      network = networkPassphrase;
    }

    // Parse the user-signed transaction
    const txn = new StellarSdk.Transaction(signedTransaction, network);
    
    // Sign with server's client_domain key
    const serverKeypair = StellarSdk.Keypair.fromSecret(CLIENT_SIGNING_KEY);
    txn.sign(serverKeypair);
    
    const fullySignedXdr = txn.toEnvelope().toXDR('base64');
    
    console.log('✓ Transaction signed by server (client_domain)');
    console.log(`Server public key: ${serverKeypair.publicKey()}`);
    console.log(`Total signatures: ${txn.signatures.length}`);

    // Get web auth endpoint from TOML
    const tomlUrl = `${HOME_DOMAIN}/.well-known/stellar.toml`;
    const tomlResponse = await axios.get(tomlUrl);
    const tomlText = tomlResponse.data;
    const webAuthMatch = tomlText.match(/WEB_AUTH_ENDPOINT\s*=\s*"([^"]+)"/);
    
    if (!webAuthMatch) {
      return res.status(400).json({ 
        error: 'WEB_AUTH_ENDPOINT not found in stellar.toml' 
      });
    }
    
    const webAuthEndpoint = webAuthMatch[1];

    // Submit fully-signed transaction to anchor
    console.log('=== STEP 4: Submitting to Anchor for Verification ===');
    console.log(`Submitting to: ${webAuthEndpoint}`);
    
    const tokenResponse = await axios.post(webAuthEndpoint, {
      transaction: fullySignedXdr
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✓ JWT token received from Anchor');
    console.log('✓ All signatures verified successfully!');
    
    res.json({
      token: tokenResponse.data.token
    });

  } catch (error) {
    console.error('Submit error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to submit transaction',
      details: error.response?.data || error.message 
    });
  }
});



// ============================================
// SEP-24 ENDPOINTS
// ============================================

// Helper function to verify JWT token
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  
  const token = authHeader.substring(7);
  req.jwtToken = token;
  next();
};

// SEP-24: Start Deposit or Withdrawal
app.post('/api/sep24/start', verifyToken, async (req, res) => {
  try {
    const { mode, assetCode, amount, account } = req.body;
    
    if (!mode || !assetCode || !account) {
      return res.status(400).json({ 
        error: 'Missing required fields: mode, assetCode, account' 
      });
    }

    console.log(`\n=== SEP-24: Starting ${mode.toUpperCase()} ===`);
    console.log(`Asset: ${assetCode}`);
    console.log(`Amount: ${amount || 'not specified'}`);
    console.log(`Account: ${account}`);

    // Step 1: Get TOML to find TRANSFER_SERVER
    const tomlUrl = `${HOME_DOMAIN}/.well-known/stellar.toml`;
    console.log(`Fetching TOML from: ${tomlUrl}`);
    
    const tomlResponse = await axios.get(tomlUrl);
    const tomlText = tomlResponse.data;
    
    // Parse TRANSFER_SERVER from TOML
    const transferServerMatch = tomlText.match(/TRANSFER_SERVER_SEP0024\s*=\s*"([^"]+)"/);
    if (!transferServerMatch) {
      return res.status(400).json({ 
        error: 'TRANSFER_SERVER not found in stellar.toml' 
      });
    }
    
    const transferServer = transferServerMatch[1];
    console.log(`Transfer Server: ${transferServer}`);

    // Step 2: Get /info endpoint (unauthenticated)
    console.log('Fetching /info endpoint...');
    const infoResponse = await axios.get(`${transferServer}/info`);
    console.log('✓ Info received (unauthenticated)');

    // Step 3: Call deposit or withdraw endpoint (authenticated with JWT)
    const endpoint = mode === 'deposit' ? '/transactions/deposit/interactive' : '/transactions/withdraw/interactive';
    const url = `${transferServer}${endpoint}`;
    
    console.log(`Calling ${endpoint} (authenticated with JWT)...`);
    
    const params = {
      asset_code: assetCode,
      account: account,
    };
    
    if (amount) {
      params.amount = amount;
    }

    const response = await axios.post(url, params, {
      headers: {
        'Authorization': `Bearer ${req.jwtToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✓ Interactive URL received');
    console.log(`Transaction ID: ${response.data.id}`);
    console.log(`URL: ${response.data.url}`);

    res.json({
      id: response.data.id,
      url: response.data.url,
      type: response.data.type
    });

  } catch (error) {
    console.error('SEP-24 start error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: `Failed to start ${req.body.mode}`,
      details: error.response?.data || error.message 
    });
  }
});

// SEP-24: Get Transaction Status
app.post('/api/sep24/transaction', verifyToken, async (req, res) => {
  try {
    const { id } = req.body;
    
    if (!id) {
      return res.status(400).json({ 
        error: 'Missing required field: id' 
      });
    }

    console.log(`\n=== SEP-24: Checking Transaction Status ===`);
    console.log(`Transaction ID: ${id}`);

    // Get TOML to find TRANSFER_SERVER
    const tomlUrl = `${HOME_DOMAIN}/.well-known/stellar.toml`;
    const tomlResponse = await axios.get(tomlUrl);
    const tomlText = tomlResponse.data;

    const transferServerMatch = tomlText.match(/TRANSFER_SERVER_SEP0024\s*=\s*"([^"]+)"/);
    if (!transferServerMatch) {
      return res.status(400).json({ 
        error: 'TRANSFER_SERVER not found in stellar.toml' 
      });
    }
    
    const transferServer = transferServerMatch[1];

    // Call /transaction endpoint (authenticated with JWT)
    console.log('Calling /transaction endpoint (authenticated with JWT)...');
    
    const response = await axios.get(`${transferServer}/transaction`, {
      params: { id: id },
      headers: {
        'Authorization': `Bearer ${req.jwtToken}`
      }
    });

    const transaction = response.data.transaction;
    console.log(`✓ Status: ${transaction.status}`);
    
    if (transaction.message) {
      console.log(`Message: ${transaction.message}`);
    }

    res.json(transaction);

  } catch (error) {
    console.error('Transaction status error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to get transaction status',
      details: error.response?.data || error.message 
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log('SEP-10 Three-Party Auth Server');
  console.log(`${'='.repeat(50)}`);
  console.log(`Port: ${PORT}`);
  console.log(`Home Domain: ${HOME_DOMAIN}`);
  console.log(`Client Domain: ${CLIENT_DOMAIN}`);
  console.log(`Client Key Set: ${CLIENT_SIGNING_KEY ? 'Yes' : 'No'}`);
  console.log(`${'='.repeat(50)}\n`);
});

