declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {
		CONFIG: KVNamespace;
		KEY_PREFIX: 'default' | 'james' | 'alex' | 'prod';
	}
}
