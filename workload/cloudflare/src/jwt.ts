const getSigningKey = (e: Env) => `${e.KEY_PREFIX}_keys`;

/*
 * Helpers for converting to and from URL safe Base64 strings. Needed for JWT encoding.
 */
const base64url = {
	stringify: function (a: any) {
		let base64string = btoa(String.fromCharCode.apply(0, a));
		return base64string.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
	},
	parse: function (s: any) {
		s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
		return new Uint8Array(
			// @ts-ignore
			Array.prototype.map.call(atob(s), function (c) {
				return c.charCodeAt(0);
			})
		);
	},
};

/*
 * Helper to get from an ascii string to a literal byte array.
 * Necessary to get ascii string prepped for base 64 encoding
 */
function asciiToUint8Array(str: string) {
	let chars = [];
	for (let i = 0; i < str.length; ++i) {
		chars.push(str.charCodeAt(i));
	}
	return new Uint8Array(chars);
}

/**
 * Helper to get the Access public keys from the certs endpoint
 * @param {*} env
 * @param {*} kid - The key id that signed the token
 * @returns
 */
async function fetchAccessPublicKey(env: any, kid: string) {
	const resp = await fetch(`https://access-testing.cloudflareaccess.com/cdn-cgi/access/certs`);
	const keys: any = await resp.json();
	const jwk = keys.keys.filter((key: any) => key.kid == kid)[0];
	const key = await crypto.subtle.importKey(
		'jwk',
		jwk,
		{
			name: 'RSASSA-PKCS1-v1_5',
			hash: 'SHA-256',
		},
		false,
		['verify']
	);
	return key;
}

/**
 * Get the public key in JWK format
 * @param {*} env
 * @returns
 */
async function loadPublicKey(env: any) {
	// if the JWK values are already in KV then just return that
	const key = await env.CONFIG.get(getSigningKey(env), 'json');
	if (key) {
		return { kid: key.kid, ...key.public };
	}

	// otherwise generate keys and store the Keyset in KV
	const { kid, publicKey } = await generateKeys(env);
	return { kid, ...publicKey };
}

/**
 * Parse a JWT into its respective pieces. Does not do any validation other than form checking.
 * @param {*} token - jwt string
 * @returns
 */
export function parseJWT(token: string) {
	const tokenParts = token.split('.');

	if (tokenParts.length !== 3) {
		throw new Error('token must have 3 parts');
	}

	let enc = new TextDecoder('utf-8');
	return {
		to_be_validated: `${tokenParts[0]}.${tokenParts[1]}`,
		header: JSON.parse(enc.decode(base64url.parse(tokenParts[0]))),
		payload: JSON.parse(enc.decode(base64url.parse(tokenParts[1]))),
		signature: tokenParts[2],
	};
}

/**
 * Validates the provided token using the Access public key set
 *
 * @param env
 * @param token - the token to be validated
 * @returns {object} Returns the payload if valid, or throws an error if not
 */
export async function verifyToken(env: any, token: string) {
	if (env.DEBUG) {
		console.log('incoming JWT', token);
	}

	const jwt = parseJWT(token);
	const key = await fetchAccessPublicKey(env, jwt.header.kid);

	const verified = await crypto.subtle.verify(
		'RSASSA-PKCS1-v1_5',
		key,
		base64url.parse(jwt.signature),
		asciiToUint8Array(jwt.to_be_validated)
	);

	if (!verified) {
		throw new Error('failed to verify token');
	}

	const claims = jwt.payload;
	let now = Math.floor(Date.now() / 1000);
	// Validate expiration
	if (claims.exp < now) {
		throw new Error('expired token');
	}

	return claims;
}

/**
 * Generate a key id for the key set
 * @param {*} publicKey
 * @returns
 */
async function generateKID(publicKey: string) {
	const msgUint8 = new TextEncoder().encode(publicKey);
	const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	return hashHex.substring(0, 64);
}

/**
 * Generate a key pair and stores them into Workers KV for future use
 * @param {*} env
 * @returns
 */
async function generateKeys(env: any) {
	console.log('generating a new signing key pair');
	try {
		const keypair: any = await crypto.subtle.generateKey(
			{
				name: 'RSASSA-PKCS1-v1_5',
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: 'SHA-256',
			},
			true,
			['sign', 'verify']
		);
		const publicKey = await crypto.subtle.exportKey('jwk', keypair.publicKey);
		const privateKey = await crypto.subtle.exportKey('jwk', keypair.privateKey);
		const kid = await generateKID(JSON.stringify(publicKey));
		await env.CONFIG.put(getSigningKey(env), JSON.stringify({ public: publicKey, private: privateKey, kid: kid }));
		return { keypair, publicKey, privateKey, kid };
	} catch (e) {
		console.log('failed to generate keyset', e);
		throw 'failed to generate keyset';
	}
}

/**
 * Load the signing key from KV
 * @param {*} env
 * @returns
 */
async function loadSigningKey(env: any) {
	const keyset = await env.CONFIG.get(getSigningKey(env), 'json');
	if (keyset) {
		const signingKey = await crypto.subtle.importKey(
			'jwk',
			keyset.private,
			{
				name: 'RSASSA-PKCS1-v1_5',
				hash: 'SHA-256',
			},
			false,
			['sign']
		);
		return { kid: keyset.kid, privateKey: signingKey };
	}
	await loadPublicKey(env);
	return loadSigningKey(env);
}

/**
 * Turn a payload into a JWT
 * @param {*} env
 * @param {*} payload
 * @returns
 */
export async function signJWT(env: any, payload: string) {
	const { kid, privateKey } = await loadSigningKey(env);
	const header = {
		alg: 'RS256',
		kid: kid,
	};
	const encHeader = base64url.stringify(asciiToUint8Array(JSON.stringify(header)));
	const encPayload = base64url.stringify(asciiToUint8Array(JSON.stringify(payload)));
	const encoded = `${encHeader}.${encPayload}`;

	const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, asciiToUint8Array(encoded)));
	return `${encoded}.${base64url.stringify(sig)}`;
}
