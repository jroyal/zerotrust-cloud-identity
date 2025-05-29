import { env, SELF, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

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

		it('failed to load config from github', async () => {
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

	describe('GetUserAndHistory', () => {
		const defaultUser = {
			user: 'unknown user',
			history: ['insert identity history0 here', 'insert identity history1 here'],
		};
		beforeAll(async () => {
			// Enable outbound request mocking...
			fetchMock.activate();
			// ...and throw errors if an outbound request isn't mocked
			fetchMock.disableNetConnect();
			await env.CONFIG.put(
				CONFIG_KEY,
				JSON.stringify({
					oldWorkload: { provider: 'example', host: 'example.com', type: 'web' },
				})
			);
		});

		afterEach(() => fetchMock.assertNoPendingInterceptors());

		it('should have a catch-all route that returns user and history information', async () => {
			const response = await SELF.fetch('https://example.com/blahblah');
			expect(response.status).toBe(200);
			const json = await response.json();
			expect(json).toEqual(defaultUser);
		});
		it('should return user and history information for the root path', async () => {
			const response = await SELF.fetch('https://example.com/');
			expect(response.status).toBe(200);
			const json = await response.json();
			expect(json).toEqual(defaultUser);
		});
	});

	describe('forwardRequest', () => {
		beforeAll(async () => {
			// Enable outbound request mocking...
			fetchMock.activate();
			// ...and throw errors if an outbound request isn't mocked
			fetchMock.disableNetConnect();
			await env.CONFIG.put(
				CONFIG_KEY,
				JSON.stringify({
					workload1: { provider: 'example', host: 'foo.com', type: 'web' },
				})
			);
		});

		afterEach(() => fetchMock.assertNoPendingInterceptors());

		it('should forward requests to the correct host', async () => {
			fetchMock.get('https://foo.com').intercept({ method: 'GET', path: `path?param=value` }).reply(200);
			const response = await SELF.fetch('https://example.com/workload1/path?param=value', {
				headers: { 'content-type': 'application/json' },
			});
			expect(response.status).toBe(200);
		});

		it('should forward requests without query parameters', async () => {
			fetchMock.get('https://foo.com').intercept({ method: 'GET', path: `/path` }).reply(200);
			const response = await SELF.fetch('https://example.com/workload1/path', {
				headers: { 'content-type': 'application/json' },
			});
			expect(response.status).toBe(200);
		});

		it('should handle requests without a remaining path', async () => {
			fetchMock.get('https://foo.com').intercept({ method: 'GET', path: `/` }).reply(200);
			const response = await SELF.fetch('https://example.com/workload1/', {
				headers: { 'content-type': 'application/json' },
			});
			expect(response.status).toBe(200);
		});

		it('should handle POST requests with body data', async () => {
			const body = JSON.stringify({ data: 'test' });
			fetchMock.get('https://foo.com').intercept({ method: 'POST', path: `/path`, body: body }).reply(200);
			const response = await SELF.fetch('https://example.com/workload1/path', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: body,
			});
			expect(response.status).toBe(200);
		});

		it('should handle PUT requests with body data', async () => {
			const body = JSON.stringify({ data: 'test' });
			fetchMock.get('https://foo.com').intercept({ method: 'PUT', path: `/path`, body: body }).reply(200);
			const response = await SELF.fetch('https://example.com/workload1/path', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: body,
			});
			expect(response.status).toBe(200);
		});

		it('should handle PATCH requests with body data', async () => {
			const body = JSON.stringify({ data: 'test' });
			fetchMock.get('https://foo.com').intercept({ method: 'PATCH', path: `/path`, body: body }).reply(200);
			const response = await SELF.fetch('https://example.com/workload1/path', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: body,
			});
			expect(response.status).toBe(200);
		});

		it('should handle DELETE requests', async () => {
			fetchMock.get('https://foo.com').intercept({ method: 'DELETE', path: `/path` }).reply(204);
			const response = await SELF.fetch('https://example.com/workload1/path', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: undefined,
			});
			expect(response.status).toBe(204);
		});

		it('should handle errors during request forwarding', async () => {
			fetchMock.get('https://foo.com').intercept({ method: 'GET', path: `/path` }).replyWithError(new Error('Network Error'));
			const response = await SELF.fetch('https://example.com/workload1/path', {
				headers: { 'content-type': 'application/json' },
			});
			expect(response.status).toBe(500);
			expect(await response.text()).toBe('Error forwarding request to remote host');
		});

		it('should handle requests with query parameters', async () => {
			const u = new URL('https://example.com/workload1/path');
			u.searchParams.append('param', 'value');
			u.searchParams.append('param2', 'test1');
			u.searchParams.append('param2', 'test2');
			u.searchParams.append('param3', 'true');
			fetchMock
				.get('https://foo.com')
				.intercept({ method: 'GET', path: `path?${u.searchParams.toString()}` })
				.reply(200);
			const response = await SELF.fetch(u, {
				headers: { 'content-type': 'application/json' },
			});
			expect(response.status).toBe(200);
		});
	});
});
