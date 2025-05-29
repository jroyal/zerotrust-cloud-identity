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
import { parse } from 'yaml';

type Bindings = {
	CONFIG: KVNamespace;
};

const WORKLOAD_CONFIG_KEY = 'workload_config';

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
type ProviderFunction = (c: Context<{ Bindings: Bindings }>) => Promise<Response>;

// Define type for providers object
interface ProviderMap {
	[providerName: string]: ProviderFunction;
}

const Providers: ProviderMap = {
	example: async (c: Context<{ Bindings: Bindings }>) => {
		return await forwardRequest(c);
	},
};

const getUserAndHistory = async (c: Context<{ Bindings: Bindings }>) => {
	return c.json({
		user: 'unknown user',
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
	await env.CONFIG.put(WORKLOAD_CONFIG_KEY, JSON.stringify(jsonData));
	return jsonData;
};

async function forwardRequest(c: Context<{ Bindings: Bindings }>) {
	return new Response('heyo');
}

async function handleRequest(request: Request<unknown, CfProperties<unknown>>, env: Env, ctx: any) {
	let workloadConfig: HostsConfig | null = await env.CONFIG.get(WORKLOAD_CONFIG_KEY, 'json');
	if (!workloadConfig) {
		workloadConfig = await refreshConfig(env);
	}
	const app = new Hono<{ Bindings: Bindings }>();
	app.use(logger());
	app.onError((err, c) => {
		if (err instanceof HTTPException) {
			return err.getResponse();
		}
		return c.json({ err: 'something went wrong' }, { status: 500 });
	});
	for (const workloadName in workloadConfig) {
		console.log(`Setting up routes for workload: ${workloadName}`);
		const workload = workloadConfig[workloadName];
		const provider = Providers[workload.provider];
		if (provider) {
			app.get(`/${workloadName}`, provider);
			app.get(`/${workloadName}/*`, provider);
			app.post(`/${workloadName}/*`, provider);
			app.put(`/${workloadName}/*`, provider);
			app.delete(`/${workloadName}/*`, provider);
			app.patch(`/${workloadName}/*`, provider);
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
