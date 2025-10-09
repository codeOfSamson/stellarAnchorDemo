import React, { useState } from "react";
import { AlertCircle, CheckCircle, Loader2, ArrowRight } from "lucide-react";

// Load Stellar SDK from CDN
const loadStellarSDK = () => {
  return new Promise((resolve, reject) => {
    if (window.StellarSdk) {
      resolve(window.StellarSdk);
      return;
    }
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/stellar-sdk/11.2.2/stellar-sdk.min.js";
    script.onload = () => resolve(window.StellarSdk);
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

export default function StellarSEP10Auth() {
  React.useEffect(() => {
    loadStellarSDK().catch((err) =>
      console.error("Failed to load Stellar SDK:", err)
    );
  }, []);
  const [publicKey, setPublicKey] = useState(
    "GA5MGK4QGVM5ZCFLAJEKRKECPMEI44SIP4XBI6JB5MFLQO5NDHU67VWX"
  );
  const [secretKey, setSecretKey] = useState(
    "SB6B7EDOZXKNGSF6HNZ7YQ4G7YZ7ZXVU2X5BQIZ7LLSIDMHHNNETKNKS"
  );
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [authToken, setAuthToken] = useState("");
  const [error, setError] = useState("");
  const [challengeTx, setChallengeTx] = useState(null);

  const steps = [
    "Request Challenge",
    "Sign Transaction",
    "Submit & Verify",
    "Complete",
  ];

  const handleGetChallenge = async () => {
    setLoading(true);
    setError("");
    setStep(1);

    try {
      // Step 1: FE tells BE to get challenge from anchor
      const response = await fetch("/api/sep10/get-challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: publicKey }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to get challenge");
      }

      const data = await response.json();
      setChallengeTx(data);
      setStep(2);
    } catch (err) {
      setError(err.message);
      setStep(0);
    } finally {
      setLoading(false);
    }
  };

  const handleSignAndSubmit = async () => {
    setLoading(true);
    setError("");
    setStep(3);

    try {
      // Step 2: FE signs the transaction CLIENT-SIDE (NEVER send secret key to server!)
      const StellarSdk = window.StellarSdk;

      // Determine network
      let network;
      if (challengeTx.network_passphrase.includes("Test")) {
        network = StellarSdk.Networks.TESTNET;
      } else if (challengeTx.network_passphrase.includes("Public")) {
        network = StellarSdk.Networks.PUBLIC;
      } else {
        network = challengeTx.network_passphrase;
      }

      // Parse and sign transaction client-side
      const txn = new StellarSdk.Transaction(challengeTx.transaction, network);
      const keypair = StellarSdk.Keypair.fromSecret(secretKey);
      txn.sign(keypair);

      const signedTransaction = txn.toEnvelope().toXDR("base64");

      // Step 3: Send user-signed tx to BE, BE adds client_domain signature
      // and submits to anchor
      const submitResponse = await fetch("/api/sep10/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signedTransaction: signedTransaction,
          networkPassphrase: challengeTx.network_passphrase,
        }),
      });

      if (!submitResponse.ok) {
        const errData = await submitResponse.json();
        throw new Error(errData.error || "Failed to submit transaction");
      }

      const { token } = await submitResponse.json();
      setAuthToken(token);
      setStep(4);
    } catch (err) {
      setError(err.message);
      setStep(2);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep(0);
    setChallengeTx(null);
    setAuthToken("");
    setError("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-8">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
          <h1 className="text-4xl font-bold text-white mb-2">
            Stellar SEP-10 Authentication
          </h1>
          <p className="text-blue-200 mb-8">
            Three-party signature flow with client_domain
          </p>

          {/* Progress Steps */}
          <div className="mb-8 flex items-center justify-between">
            {steps.map((s, idx) => (
              <React.Fragment key={idx}>
                <div className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
                      step > idx
                        ? "bg-green-500 text-white"
                        : step === idx
                        ? "bg-blue-500 text-white"
                        : "bg-white/20 text-white/50"
                    }`}
                  >
                    {step > idx ? "✓" : idx + 1}
                  </div>
                  <span
                    className={`text-xs mt-2 ${
                      step >= idx ? "text-white" : "text-white/50"
                    }`}
                  >
                    {s}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={`flex-1 h-1 mx-2 rounded transition-all ${
                      step > idx ? "bg-green-500" : "bg-white/20"
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>

          {step === 0 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-blue-100 mb-2">
                  Stellar Public Key
                </label>
                <input
                  type="text"
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  placeholder="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-blue-100 mb-2">
                  Secret Key
                </label>
                <input
                  type="password"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder="SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono text-sm"
                />
              </div>

              <button
                onClick={handleGetChallenge}
                disabled={loading || !publicKey || !secretKey}
                className="w-full py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center space-x-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Getting Challenge...</span>
                  </>
                ) : (
                  <>
                    <span>Start Authentication</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </div>
          )}

          {step === 2 && challengeTx && (
            <div className="space-y-6">
              <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <CheckCircle className="w-5 h-5 text-green-300 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-white font-medium">Challenge Received</p>
                    <p className="text-green-200 text-sm mt-1">
                      Anchor has signed the transaction. Ready for your
                      signature.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 border border-white/20 rounded-lg p-4">
                <p className="text-blue-100 text-sm font-medium mb-2">
                  Transaction XDR (preview):
                </p>
                <div className="bg-black/30 p-3 rounded font-mono text-xs text-white/70 break-all max-h-32 overflow-auto">
                  {challengeTx.transaction.substring(0, 200)}...
                </div>
              </div>

              <button
                onClick={handleSignAndSubmit}
                disabled={loading}
                className="w-full py-4 bg-gradient-to-r from-green-500 to-blue-600 text-white font-semibold rounded-lg hover:from-green-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center space-x-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Signing & Submitting...</span>
                  </>
                ) : (
                  <>
                    <span>Sign & Submit</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </div>
          )}

          {step === 4 && authToken && (
            <div className="space-y-6">
              <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-6 text-center">
                <CheckCircle className="w-16 h-16 text-green-300 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-white mb-2">
                  Authentication Successful!
                </h2>
                <p className="text-green-200">
                  All signatures verified by anchor
                </p>
              </div>

              <div className="bg-white/5 border border-white/20 rounded-lg p-4">
                <p className="text-blue-100 font-medium mb-2">
                  JWT Authentication Token:
                </p>
                <div className="bg-black/30 p-3 rounded font-mono text-xs text-green-200 break-all max-h-48 overflow-auto">
                  {authToken}
                </div>
              </div>

              <button
                onClick={reset}
                className="w-full py-3 bg-white/10 border border-white/20 text-white font-semibold rounded-lg hover:bg-white/20 transition-all duration-200"
              >
                Authenticate Again
              </button>
            </div>
          )}

          {error && (
            <div className="mt-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-red-300 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-white font-medium">Error</p>
                <p className="text-red-200 text-sm mt-1">{error}</p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 bg-white/5 backdrop-blur rounded-lg p-4 border border-white/10">
          <p className="text-sm text-blue-200 mb-2">
            <strong>Authentication Flow:</strong>
          </p>
          <ol className="text-xs text-blue-300 space-y-1 ml-4">
            <li>1. Backend requests challenge from Anchor (Anchor signs)</li>
            <li>
              2. Frontend signs transaction CLIENT-SIDE (secret never leaves
              browser)
            </li>
            <li>3. Backend adds client_domain signature</li>
            <li>4. Anchor verifies all signatures and returns JWT token</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
