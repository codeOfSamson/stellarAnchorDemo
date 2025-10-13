import React, { useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, ArrowRight, ArrowDownToLine, ArrowUpFromLine, Clock } from 'lucide-react';
import * as StellarSdk from '@stellar/stellar-sdk';

export default function StellarSEP10Auth() {
  // SEP-10 State
  const [publicKey, setPublicKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [authToken, setAuthToken] = useState('');
  const [error, setError] = useState('');
  const [challengeTx, setChallengeTx] = useState(null);

  // SEP-24 State
  const [sep24Mode, setSep24Mode] = useState(null); // 'deposit' or 'withdraw'
  const [sep24Loading, setSep24Loading] = useState(false);
  const [sep24Error, setSep24Error] = useState('');
  const [sep24Step, setSep24Step] = useState(0);
  const [assetCode, setAssetCode] = useState('USDC');
  const [amount, setAmount] = useState('');
  const [interactiveUrl, setInteractiveUrl] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [transactionStatus, setTransactionStatus] = useState(null);

  const sep24Steps = [
    'Get Transfer Info',
    'Interactive Flow',
    'Monitor Transaction',
    'Complete'
  ];

  const steps = [
    'Request Challenge',
    'Sign Transaction',
    'Submit & Verify',
    'Complete'
  ];

  const handleGetChallenge = async () => {
    setLoading(true);
    setError('');
    setStep(1);

    try {
      // Step 1: FE tells BE to get challenge from anchor
      const response = await fetch('/api/sep10/get-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: publicKey })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to get challenge');
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
    setError('');
    setStep(3);

    try {
      // Step 2: FE signs the transaction CLIENT-SIDE (NEVER send secret key to server!)
      
      // Determine network
      let network;
      if (challengeTx.network_passphrase.includes('Test')) {
        network = StellarSdk.Networks.TESTNET;
      } else if (challengeTx.network_passphrase.includes('Public')) {
        network = StellarSdk.Networks.PUBLIC;
      } else {
        network = challengeTx.network_passphrase;
      }

      // Parse and sign transaction client-side
      const txn = new StellarSdk.Transaction(challengeTx.transaction, network);
      const keypair = StellarSdk.Keypair.fromSecret(secretKey);
      txn.sign(keypair);
      
      const signedTransaction = txn.toEnvelope().toXDR('base64');

      // Step 3: Send user-signed tx to BE, BE adds client_domain signature
      // and submits to anchor
      const submitResponse = await fetch('/api/sep10/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedTransaction: signedTransaction,
          networkPassphrase: challengeTx.network_passphrase
        })
      });

      if (!submitResponse.ok) {
        const errData = await submitResponse.json();
        throw new Error(errData.error || 'Failed to submit transaction');
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
    setAuthToken('');
    setError('');
    resetSep24();
  };

  const resetSep24 = () => {
    setSep24Mode(null);
    setSep24Step(0);
    setSep24Error('');
    setInteractiveUrl('');
    setTransactionId('');
    setTransactionStatus(null);
    setAmount('');
  };

  const startSep24 = async (mode) => {
    setSep24Mode(mode);
    setSep24Loading(true);
    setSep24Error('');
    setSep24Step(1);

    try {
      // Step 1: Get transfer server info and initiate transaction
      const response = await fetch('/api/sep24/start', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          mode: mode,
          assetCode: assetCode,
          amount: amount,
          account: publicKey
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Failed to start ${mode}`);
      }

      const data = await response.json();
      setInteractiveUrl(data.url);
      setTransactionId(data.id);
      setSep24Step(2);
    } catch (err) {
      setSep24Error(err.message);
      setSep24Step(0);
      setSep24Mode(null);
    } finally {
      setSep24Loading(false);
    }
  };

  const checkTransactionStatus = async () => {
    setSep24Loading(true);
    setSep24Error('');

    try {
      const response = await fetch('/api/sep24/transaction', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          id: transactionId
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to get transaction status');
      }

      const data = await response.json();
      setTransactionStatus(data);
      
      if (data.status === 'completed') {
        setSep24Step(4);
      } else {
        setSep24Step(3);
      }
    } catch (err) {
      setSep24Error(err.message);
    } finally {
      setSep24Loading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-8">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
          <h2 className="text-4xl font-bold text-white mb-2">
            Stellar SEP-10 Authentication
          </h2>
          <p className="text-blue-200 mb-8">
            Three-party signature flow with client_domain
          </p>

          {/* Progress Steps */}
          <div className="mb-8 flex items-center justify-between">
            {steps.map((s, idx) => (
              <React.Fragment key={idx}>
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
                    step > idx ? 'bg-green-500 text-white' :
                    step === idx ? 'bg-blue-500 text-white' :
                    'bg-white/20 text-white/50'
                  }`}>
                    {step > idx ? '✓' : idx + 1}
                  </div>
                  <span className={`text-xs mt-2 ${
                    step >= idx ? 'text-white' : 'text-white/50'
                  }`}>
                    {s}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div className={`flex-1 h-1 mx-2 rounded transition-all ${
                    step > idx ? 'bg-green-500' : 'bg-white/20'
                  }`} />
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
                      Anchor has signed the transaction. Ready for your signature.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 border border-white/20 rounded-lg p-4">
                <p className="text-blue-100 text-sm font-medium mb-2">Transaction XDR (preview):</p>
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
                <p className="text-blue-100 font-medium mb-2">JWT Authentication Token:</p>
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
            <li>2. Frontend signs transaction CLIENT-SIDE (secret never leaves browser)</li>
            <li>3. Backend adds client_domain signature</li>
            <li>4. Anchor verifies all signatures and returns JWT token</li>
          </ol>
        </div>

        {/* SEP-24 Transactions Section */}
        {authToken && (
          <div className="mt-6 bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
            <h2 className="text-3xl font-bold text-white mb-2">
              SEP-24 Transactions
            </h2>
            <p className="text-blue-200 mb-6">
              Deposit and withdraw assets using interactive flow
            </p>

            {!sep24Mode ? (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-blue-100 mb-2">
                    Asset Code
                  </label>
                  <input
                    type="text"
                    value={assetCode}
                    onChange={(e) => setAssetCode(e.target.value.toUpperCase())}
                    placeholder="USDC"
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-blue-100 mb-2">
                    Amount (optional)
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="100"
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => startSep24('deposit')}
                    disabled={sep24Loading || !assetCode}
                    className="py-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold rounded-lg hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center space-x-2"
                  >
                    <ArrowDownToLine className="w-5 h-5" />
                    <span>Deposit</span>
                  </button>

                  <button
                    onClick={() => startSep24('withdraw')}
                    disabled={sep24Loading || !assetCode}
                    className="py-4 bg-gradient-to-r from-orange-500 to-red-600 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center space-x-2"
                  >
                    <ArrowUpFromLine className="w-5 h-5" />
                    <span>Withdraw</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* SEP-24 Progress Steps */}
                <div className="flex items-center justify-between mb-6">
                  {sep24Steps.map((s, idx) => (
                    <React.Fragment key={idx}>
                      <div className="flex flex-col items-center">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
                          sep24Step > idx ? 'bg-green-500 text-white' :
                          sep24Step === idx ? 'bg-blue-500 text-white' :
                          'bg-white/20 text-white/50'
                        }`}>
                          {sep24Step > idx ? '✓' : idx + 1}
                        </div>
                        <span className={`text-xs mt-2 ${
                          sep24Step >= idx ? 'text-white' : 'text-white/50'
                        }`}>
                          {s}
                        </span>
                      </div>
                      {idx < sep24Steps.length - 1 && (
                        <div className={`flex-1 h-1 mx-2 rounded transition-all ${
                          sep24Step > idx ? 'bg-green-500' : 'bg-white/20'
                        }`} />
                      )}
                    </React.Fragment>
                  ))}
                </div>

                {sep24Step === 2 && interactiveUrl && (
                  <div className="space-y-4">
                    <div className="bg-blue-500/20 border border-blue-500/50 rounded-lg p-4">
                      <div className="flex items-start space-x-3">
                        <CheckCircle className="w-5 h-5 text-blue-300 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-white font-medium">Interactive URL Ready</p>
                          <p className="text-blue-200 text-sm mt-1">
                            Complete the {sep24Mode} process in the anchor's interface
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white/5 border border-white/20 rounded-lg p-4">
                      <p className="text-blue-100 text-sm font-medium mb-2">Transaction ID:</p>
                      <div className="bg-black/30 p-3 rounded font-mono text-xs text-white/70 break-all">
                        {transactionId}
                      </div>
                    </div>

                    <a
                      href={interactiveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200 text-center"
                    >
                      Open Interactive Flow →
                    </a>

                    <button
                      onClick={checkTransactionStatus}
                      disabled={sep24Loading}
                      className="w-full py-3 bg-white/10 border border-white/20 text-white font-semibold rounded-lg hover:bg-white/20 transition-all duration-200 flex items-center justify-center space-x-2"
                    >
                      {sep24Loading ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Checking Status...</span>
                        </>
                      ) : (
                        <>
                          <Clock className="w-5 h-5" />
                          <span>Check Transaction Status</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {sep24Step >= 3 && transactionStatus && (
                  <div className="space-y-4">
                    <div className={`rounded-lg p-4 ${
                      transactionStatus.status === 'completed' 
                        ? 'bg-green-500/20 border border-green-500/50'
                        : 'bg-yellow-500/20 border border-yellow-500/50'
                    }`}>
                      <div className="flex items-start space-x-3">
                        {transactionStatus.status === 'completed' ? (
                          <CheckCircle className="w-5 h-5 text-green-300 flex-shrink-0 mt-0.5" />
                        ) : (
                          <Clock className="w-5 h-5 text-yellow-300 flex-shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="text-white font-medium">
                            Status: {transactionStatus.status}
                          </p>
                          {transactionStatus.message && (
                            <p className="text-sm mt-1 opacity-90">
                              {transactionStatus.message}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="bg-white/5 border border-white/20 rounded-lg p-4">
                      <p className="text-blue-100 text-sm font-medium mb-2">Transaction Details:</p>
                      <div className="bg-black/30 p-3 rounded font-mono text-xs text-white/70 space-y-1">
                        <div>ID: {transactionStatus.id}</div>
                        <div>Status: {transactionStatus.status}</div>
                        {transactionStatus.amount_in && (
                          <div>Amount: {transactionStatus.amount_in} {transactionStatus.asset_code}</div>
                        )}
                        {transactionStatus.started_at && (
                          <div>Started: {new Date(transactionStatus.started_at).toLocaleString()}</div>
                        )}
                      </div>
                    </div>

                    {transactionStatus.status !== 'completed' && (
                      <button
                        onClick={checkTransactionStatus}
                        disabled={sep24Loading}
                        className="w-full py-3 bg-white/10 border border-white/20 text-white font-semibold rounded-lg hover:bg-white/20 transition-all duration-200 flex items-center justify-center space-x-2"
                      >
                        {sep24Loading ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>Refreshing...</span>
                          </>
                        ) : (
                          <>
                            <Clock className="w-5 h-5" />
                            <span>Refresh Status</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}

                <button
                  onClick={resetSep24}
                  className="w-full py-3 bg-white/10 border border-white/20 text-white font-semibold rounded-lg hover:bg-white/20 transition-all duration-200"
                >
                  Start New Transaction
                </button>
              </div>
            )}

            {sep24Error && (
              <div className="mt-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg flex items-start space-x-3">
                <AlertCircle className="w-5 h-5 text-red-300 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-white font-medium">Error</p>
                  <p className="text-red-200 text-sm mt-1">{sep24Error}</p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 bg-white/5 backdrop-blur rounded-lg p-4 border border-white/10">
          {!authToken ? (
            <>
       
            </>
          ) : (
            <>
              <p className="text-sm text-blue-200 mb-2">
                <strong>SEP-24 Transaction Flow:</strong>
              </p>
              <ol className="text-xs text-blue-300 space-y-1 ml-4">
                <li>1. Backend calls /info (unauthenticated) and /deposit or /withdraw (with JWT)</li>
                <li>2. Anchor returns interactive URL with short-lived token</li>
                <li>3. User completes KYC/payment in anchor's web interface</li>
                <li>4. Backend polls /transaction endpoint (with JWT) to monitor status</li>
                <li>5. Transaction completes when anchor confirms payment</li>
              </ol>
              <p className="text-xs text-blue-300 mt-3 italic">
                Note: JWT token passed as Authorization header to all authenticated endpoints
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}