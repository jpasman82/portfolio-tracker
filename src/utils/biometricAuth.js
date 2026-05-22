const CREDENTIAL_KEY = 'bio_cred_id';
const BIOMETRIC_ENABLED_KEY = 'bio_enabled';

export function isBiometricSupported() {
  return !!(window.PublicKeyCredential && navigator.credentials);
}

export async function isPlatformAuthenticatorAvailable() {
  if (!isBiometricSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function generateChallenge() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return array;
}

function b64Encode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function b64Decode(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

export async function registerBiometric(userId, userEmail) {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: generateChallenge(),
      rp: { name: 'Portfolio Manager', id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(userId),
        name: userEmail,
        displayName: userEmail
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 }
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      timeout: 60000
    }
  });

  localStorage.setItem(CREDENTIAL_KEY, b64Encode(credential.rawId));
  localStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');
  return credential;
}

export async function authenticateWithBiometric() {
  const credId = localStorage.getItem(CREDENTIAL_KEY);
  if (!credId) throw new Error('No hay credencial registrada');

  return await navigator.credentials.get({
    publicKey: {
      challenge: generateChallenge(),
      allowCredentials: [{ id: b64Decode(credId), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000
    }
  });
}

export function isBiometricEnabled() {
  return localStorage.getItem(BIOMETRIC_ENABLED_KEY) === 'true';
}

export function clearBiometric() {
  localStorage.removeItem(CREDENTIAL_KEY);
  localStorage.removeItem(BIOMETRIC_ENABLED_KEY);
}
