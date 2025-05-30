/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { verifyToken } from './jwt';
import { getCookie } from 'hono/cookie';
import { parse } from 'yaml';

type Bindings = {
	CONFIG: KVNamespace;
	KEY_PREFIX: 'default' | 'james' | 'alex' | 'prod';
};

const getConfigKey = (e: Env) => `${e.KEY_PREFIX}_workload_config`;

export interface Workload {
	provider: string;
	host: string;
	type: string;
}
// Define type for hosts configuration
export interface HostsConfig {
	[workloadName: string]: Workload;
}

// Define type for provider functions
type ProviderFunction = (c: Context<{ Bindings: Bindings }>, config: HostsConfig) => Promise<Response>;

// Define type for providers object
interface ProviderMap {
	[providerName: string]: ProviderFunction;
}

const Providers: ProviderMap = {
	example: async (c: Context<{ Bindings: Bindings }>, config: HostsConfig) => {
		return await forwardRequest(c, config);
	},
};

const getUserAndHistory = async (c: Context<{ Bindings: Bindings }>) => {
	// get the identity from the JWT
	const cf_cookie = getCookie(c, 'CF_Authorization');
	const claims = await verifyToken(c.env, cf_cookie || '');
	return c.json({
		user: claims.email || 'unknown user',
		history: ['insert identity history0 here', 'insert identity history1 here'],
	});
};

const refreshConfig = async (env: Env) => {
	const resp = await fetch('https://raw.githubusercontent.com/co-cddo/zerotrust-cloud-identity/refs/heads/main/shared_config/hosts.yaml');
	if (resp.status != 200) {
		throw new HTTPException(500, { message: 'failed to get config from github' });
	}
	const yamlData = await resp.text();
	const jsonData = await parse(yamlData);
	await env.CONFIG.put(getConfigKey(env), JSON.stringify(jsonData));
	return jsonData;
};

async function forwardRequest(c: Context<{ Bindings: Bindings }>, config: HostsConfig) {
	try {
		const u = new URL(c.req.url);
		// Get the original URL and extract the workload name from the path
		const pathParts = c.req.path.split('/').filter(Boolean);

		if (pathParts.length === 0) {
			return c.text('Invalid request path', { status: 400 });
		}

		const workloadName = pathParts[0];
		// Use the provided configuration
		const workload = config[workloadName];

		if (!workload) {
			return c.text(`Workload ${workloadName} not found`, { status: 404 });
		}

		// Remove the workload name from the path
		const remainingPath = pathParts.slice(1).join('/');

		// Construct the target URL
		let targetUrl = `https://${workload.host}${remainingPath ? '/' + remainingPath : ''}`;

		// Forward query parameters if they exist
		const query = u.searchParams.toString();
		targetUrl = `${targetUrl}?${query}`;

		console.log(`Forwarding request to: ${targetUrl}`);

		const resp = await fetch(targetUrl, {
			method: c.req.method || 'GET',
			headers: {
				...c.req.raw.headers,
				host: workload.host,
			},
			body: ['POST', 'PUT', 'PATCH'].includes(c.req.method?.toUpperCase() || '') ? await c.req.arrayBuffer() : undefined,
		});

		// Forward the response back to the client
		return resp;
	} catch (error) {
		console.error('Error forwarding request:', error);
		return c.text('Error forwarding request to remote host', { status: 500 });
	}
}

async function handleRequest(request: Request<unknown, CfProperties<unknown>>, env: Env, ctx: any) {
	let workloadConfig: HostsConfig | null = await env.CONFIG.get(getConfigKey(env), 'json');
	if (!workloadConfig) {
		workloadConfig = await refreshConfig(env);
	}
	const app = new Hono<{ Bindings: Bindings }>();
	app.use(logger());
	app.onError((err, c) => {
		if (err instanceof HTTPException) {
			return err.getResponse();
		}
		console.log(err);
		return c.json({ message: 'something went wrong', err: err.toString() }, { status: 500 });
	});
	for (const workloadName in workloadConfig) {
		console.log(`Setting up routes for workload: ${workloadName}`);
		const workload = workloadConfig[workloadName];
		const provider = Providers[workload.provider];
		if (provider) {
			app.get(`/${workloadName}`, (c) => provider(c, workloadConfig));
			app.get(`/${workloadName}/*`, (c) => provider(c, workloadConfig));
			app.post(`/${workloadName}/*`, (c) => provider(c, workloadConfig));
			app.put(`/${workloadName}/*`, (c) => provider(c, workloadConfig));
			app.delete(`/${workloadName}/*`, (c) => provider(c, workloadConfig));
			app.patch(`/${workloadName}/*`, (c) => provider(c, workloadConfig));
			console.log(`Routes registered for ${workloadName} with provider: ${workload.provider}`);
		} else {
			console.error(`Provider '${workload.provider}' not found for workload: ${workloadName}`);
		}
	}

	app.get('/config', async (c) => {
		const config = await refreshConfig(c.env);
		return c.json(config);
	});
	app.get('*', (c) => getUserAndHistory(c));
	return app.fetch(request, env);
}

export default {
	fetch: handleRequest,
} satisfies ExportedHandler<Env>;
