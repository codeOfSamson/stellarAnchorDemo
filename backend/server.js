// Install dependencies:
// npm install express stellar-sdk axios cors body-parser dotenv

const express = require("express");
const axios = require("axios");
const StellarSdk = require("stellar-sdk");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");

require("dotenv").config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configuration - set these in your .env file
const HOME_DOMAIN = process.env.HOME_DOMAIN || "https://testanchor.stellar.org";
const CLIENT_DOMAIN =
  process.env.CLIENT_DOMAIN || "7d857520cafe.ngrok-free.app ";
const CLIENT_SIGNING_KEY = process.env.CLIENT_SIGNING_KEY; // Your server's signing key

if (!CLIENT_SIGNING_KEY) {
  console.warn(
    "WARNING: CLIENT_SIGNING_KEY not set. Client domain signing will fail."
  );
}

// Step 1: Get Challenge from Anchor (Anchor signs it)
app.post("/api/sep10/get-challenge", async (req, res) => {
  try {
    const { account } = req.body;

    if (!account) {
      return res.status(400).json({
        error: "Missing required field: account",
      });
    }

    console.log("=== STEP 1: Getting Challenge from Anchor ===");
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
        error: "WEB_AUTH_ENDPOINT not found in stellar.toml",
      });
    }

    const webAuthEndpoint = webAuthMatch[1];
    console.log(`Web Auth Endpoint: ${webAuthEndpoint}`);

    // Request challenge from anchor with client_domain
    const challengeUrl = `${webAuthEndpoint}?account=${encodeURIComponent(
      account
    )}&client_domain=${encodeURIComponent(CLIENT_DOMAIN)}`;
    console.log(`Requesting challenge: ${challengeUrl}`);

    const challengeResponse = await axios.get(challengeUrl);

    console.log("✓ Challenge received from Anchor (Anchor has signed)");
    console.log(`Network: ${challengeResponse.data.network_passphrase}`);

    // Return anchor-signed transaction to FE
    res.json({
      transaction: challengeResponse.data.transaction,
      network_passphrase: challengeResponse.data.network_passphrase,
      webAuthEndpoint: webAuthEndpoint,
    });
  } catch (error) {
    console.error("Challenge error:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to get challenge from anchor",
      details: error.response?.data || error.message,
    });
  }
});

// Step 2: Removed - User signs CLIENT-SIDE in browser
// The secret key NEVER leaves the frontend for security

// Step 3: BE Signs for client_domain and Submits to Anchor
app.post("/api/sep10/submit", async (req, res) => {
  try {
    const { signedTransaction, networkPassphrase } = req.body;

    if (!signedTransaction || !networkPassphrase) {
      return res.status(400).json({
        error: "Missing required fields: signedTransaction, networkPassphrase",
      });
    }

    console.log("=== STEP 3: Server Signing for client_domain ===");
    console.log(
      "Note: User already signed CLIENT-SIDE (secret never sent to server)"
    );

    if (!CLIENT_SIGNING_KEY) {
      return res.status(500).json({
        error: "CLIENT_SIGNING_KEY not configured on server",
      });
    }

    // Determine network
    let network;
    if (networkPassphrase.includes("Test")) {
      network = StellarSdk.Networks.TESTNET;
    } else if (networkPassphrase.includes("Public")) {
      network = StellarSdk.Networks.PUBLIC;
    } else {
      network = networkPassphrase;
    }

    // Parse the user-signed transaction
    const txn = new StellarSdk.Transaction(signedTransaction, network);

    // Sign with server's client_domain key
    const serverKeypair = StellarSdk.Keypair.fromSecret(CLIENT_SIGNING_KEY);
    txn.sign(serverKeypair);

    const fullySignedXdr = txn.toEnvelope().toXDR("base64");

    console.log("✓ Transaction signed by server (client_domain)");
    console.log(`Server public key: ${serverKeypair.publicKey()}`);
    console.log(`Total signatures: ${txn.signatures.length}`);

    // Get web auth endpoint from TOML
    const tomlUrl = `${HOME_DOMAIN}/.well-known/stellar.toml`;
    const tomlResponse = await axios.get(tomlUrl);
    const tomlText = tomlResponse.data;
    const webAuthMatch = tomlText.match(/WEB_AUTH_ENDPOINT\s*=\s*"([^"]+)"/);

    if (!webAuthMatch) {
      return res.status(400).json({
        error: "WEB_AUTH_ENDPOINT not found in stellar.toml",
      });
    }

    const webAuthEndpoint = webAuthMatch[1];

    // Submit fully-signed transaction to anchor
    console.log("=== STEP 4: Submitting to Anchor for Verification ===");
    console.log(`Submitting to: ${webAuthEndpoint}`);
    console.log("fully signed xdr", fullySignedXdr);

    const tokenResponse = await axios.post(
      webAuthEndpoint,
      {
        transaction: fullySignedXdr,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✓ JWT token received from Anchor");
    console.log("✓ All signatures verified successfully!");

    res.json({
      token: tokenResponse.data.token,
    });
  } catch (error) {
    console.error("Submit error:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to submit transaction",
      details: error.response?.data || error.message,
    });
  }
});

app.get("/.well-known/stellar.toml", (req, res) => {
  res.sendFile("stellar.toml", { root: path.join(__dirname, ".well-known") });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n${"=".repeat(50)}`);
  console.log("SEP-10 Three-Party Auth Server");
  console.log(`${"=".repeat(50)}`);
  console.log(`Port: ${PORT}`);
  console.log(`Home Domain: ${HOME_DOMAIN}`);
  console.log(`Client Domain: ${CLIENT_DOMAIN}`);
  console.log(`Client Key Set: ${CLIENT_SIGNING_KEY ? "Yes" : "No"}`);
  console.log(`${"=".repeat(50)}\n`);
});
