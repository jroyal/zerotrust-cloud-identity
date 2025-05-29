import { env, SELF, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi, Mock, beforeAll, afterEach } from 'vitest';

// Typed Request for Cloudflare Worker
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

// Sample YAML as returned by GitHub
const configYaml = `
workload1:
  provider: example
  host: example.com
  type: web
`;

// Expected parsed configuration object
const parsedConfig = {
	workload1: { provider: 'example', host: 'example.com', type: 'web' },
};

const CONFIG_KEY = 'workload_config';

describe('Cloudflare', () => {
	describe('Config Endpoint', () => {
		beforeAll(() => {
			// Enable outbound request mocking...
			fetchMock.activate();
			// ...and throw errors if an outbound request isn't mocked
			fetchMock.disableNetConnect();
		});

		afterEach(() => fetchMock.assertNoPendingInterceptors());

		it('nonexistent config is loaded and then reloaded', async () => {
			// initial request is missing config so go load it from github
			fetchMock.get('https://raw.githubusercontent.com').intercept({ method: 'GET', path: /.*/ }).reply(200, configYaml);

			// since we called config we go refresh it again anyway
			fetchMock.get('https://raw.githubusercontent.com').intercept({ method: 'GET', path: /.*/ }).reply(200, configYaml);
			const response = await SELF.fetch('https://example.com/config');
			expect(response.status).toBe(200);

			const json = await response.json();
			expect(json).toEqual(parsedConfig);
			expect(await env.CONFIG.get(CONFIG_KEY, 'json')).toEqual(parsedConfig);
		});

		it('GET /config loads existing config then updates', async () => {
			env.CONFIG.put(
				CONFIG_KEY,
				JSON.stringify({
					oldWorkload: { provider: 'example', host: 'example.com', type: 'web' },
				})
			);
			fetchMock.get('https://raw.githubusercontent.com').intercept({ method: 'GET', path: /.*/ }).reply(200, configYaml);
			const response = await SELF.fetch('https://example.com/config');
			expect(response.status).toBe(200);

			const json = await response.json();
			expect(json).toEqual(parsedConfig);
			expect(await env.CONFIG.get(CONFIG_KEY, 'json')).toEqual(parsedConfig);
		});

		it('failed to load from github', async () => {
			env.CONFIG.put(
				CONFIG_KEY,
				JSON.stringify({
					oldWorkload: { provider: 'example', host: 'example.com', type: 'web' },
				})
			);
			fetchMock.get('https://raw.githubusercontent.com').intercept({ method: 'GET', path: /.*/ }).reply(429);
			const response = await SELF.fetch('https://example.com/config');
			expect(response.status).toBe(500);

			const err = await response.text();
			expect(err).toEqual('failed to get config from github');
		});
	});

	// describe('Proxying Workload Requests', () => {
	// 	beforeEach(() => {
	// 		// Reset hostsConfig and stub fetch
	// 		hostsConfig.workload1 = {
	// 			provider: 'example',
	// 			host: 'example.com',
	// 			type: 'web',
	// 		};
	// 		vi.stubGlobal('fetch', vi.fn());
	// 	});

	// 	it('forwards GET requests with query parameters', async () => {
	// 		// Arrange
	// 		const mockResponse = new Response(JSON.stringify({ success: true }), {
	// 			status: 200,
	// 			headers: { 'Content-Type': 'application/json' },
	// 		});
	// 		(fetch as unknown as vi.Mock).mockResolvedValueOnce(mockResponse);

	// 		const ctx = createExecutionContext();
	// 		const request = new IncomingRequest('https://example.com/workload1/path?foo=bar', { method: 'GET' });

	// 		// Act
	// 		const response = await worker.fetch(request, env, ctx);
	// 		await waitOnExecutionContext(ctx);

	// 		// Assert
	// 		expect(fetch).toHaveBeenCalledWith('https://example.com/path?foo=bar', {
	// 			method: 'GET',
	// 			headers: expect.objectContaining({ host: 'example.com' }),
	// 		});
	// 		expect(response.status).toBe(200);
	// 		expect(await response.json()).toEqual({ success: true });
	// 	});

	// 	it('forwards POST requests with JSON body', async () => {
	// 		// Arrange
	// 		const payload = { data: 'test' };
	// 		const mockResponse = new Response(JSON.stringify({ ok: true }), {
	// 			status: 201,
	// 			headers: { 'Content-Type': 'application/json' },
	// 		});
	// 		(fetch as unknown as vi.Mock).mockResolvedValueOnce(mockResponse);

	// 		const ctx = createExecutionContext();
	// 		const request = new IncomingRequest('https://example.com/workload1/path', {
	// 			method: 'POST',
	// 			headers: { 'Content-Type': 'application/json' },
	// 			body: JSON.stringify(payload),
	// 		});

	// 		// Act
	// 		const response = await worker.fetch(request, env, ctx);
	// 		await waitOnExecutionContext(ctx);

	// 		// Assert
	// 		expect(fetch).toHaveBeenCalledWith('https://example.com/path', {
	// 			method: 'POST',
	// 			headers: expect.objectContaining({
	// 				host: 'example.com',
	// 				'Content-Type': 'application/json',
	// 			}),
	// 			body: JSON.stringify(payload),
	// 		});
	// 		expect(response.status).toBe(201);
	// 		expect(await response.json()).toEqual({ ok: true });
	// 	});

	// 	it('forwards DELETE requests without body', async () => {
	// 		// Arrange
	// 		const mockResponse = new Response(null, { status: 204 });
	// 		(fetch as unknown as vi.Mock).mockResolvedValueOnce(mockResponse);

	// 		const ctx = createExecutionContext();
	// 		const request = new IncomingRequest('https://example.com/workload1/path', {
	// 			method: 'DELETE',
	// 		});

	// 		// Act
	// 		const response = await worker.fetch(request, env, ctx);
	// 		await waitOnExecutionContext(ctx);

	// 		// Assert
	// 		expect(fetch).toHaveBeenCalledWith('https://example.com/path', {
	// 			method: 'DELETE',
	// 			headers: expect.objectContaining({ host: 'example.com' }),
	// 		});
	// 		expect(response.status).toBe(204);
	// 	});
	// });

	// describe('Integration Tests', () => {
	// 	it('responds to a real fetch (integration style)', async () => {
	// 		const response = await SELF.fetch('https://example.com/config');
	// 		expect(response.status).toBe(200);
	// 	});
	// });
});
