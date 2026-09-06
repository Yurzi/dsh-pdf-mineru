import { createRequire } from "node:module";
import z from "@deepseek-ai/schemastery";
import { homedir, hostname } from "node:os";
import { basename, dirname, extname, isAbsolute, join, parse, posix, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream, openAsBlob } from "node:fs";
import { setTimeout as setTimeout$1 } from "node:timers/promises";
import { link, lstat, mkdir, open, opendir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { TextDecoder } from "node:util";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();
//#endregion
//#region src/domain/ids.ts
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PREFIXED_ID = /^(?:mr|mf|mp|mo)_[A-Za-z0-9][A-Za-z0-9._-]{0,123}$/;
const CACHE_KEY = /^[a-f0-9]{64}$/;
function assertSafePathSegment(value, label) {
	if (!SAFE_SEGMENT.test(value) || value === "." || value === "..") throw new TypeError(`${label} must be a safe path segment`);
	return value;
}
function assertPrefixedId(value, prefix) {
	if (!value.startsWith(`${prefix}_`) || !PREFIXED_ID.test(value)) throw new TypeError(`invalid ${prefix} identifier`);
	return value;
}
const asResultId = (value) => assertPrefixedId(value, "mr");
const asFileId = (value) => assertPrefixedId(value, "mf");
const asProviderConfigId = (value) => assertPrefixedId(value, "mp");
const asOperationId = (value) => assertPrefixedId(value, "mo");
function asSessionId(value) {
	return assertSafePathSegment(value, "sessionId");
}
function asCacheKey(value) {
	if (!CACHE_KEY.test(value)) throw new TypeError("cache key must be a lowercase SHA-256 digest");
	return value;
}
function randomOperationId() {
	return `mo_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}
const createOperationId = () => asOperationId(randomOperationId());
function createFileId(sha256, index = 0) {
	if (!CACHE_KEY.test(sha256)) throw new TypeError("source SHA-256 is invalid");
	return asFileId(`mf_${sha256.slice(0, 28)}_${String(index)}`);
}
function resultIdForCacheKey(cacheKey) {
	return asResultId(`mr_${cacheKey.slice(0, 32)}`);
}
//#endregion
//#region src/config/pure.ts
function defaultProviderConfig(type) {
	if (type === "official-v4") return {
		id: asProviderConfigId("mp_official"),
		type,
		baseURL: "https://mineru.net/api/v4",
		apiKeyEnv: "MINERU_API_KEY",
		models: ["pipeline", "vlm"],
		configuredVersion: "v4"
	};
	return {
		id: asProviderConfigId("mp_self_hosted"),
		type,
		baseURL: "http://localhost:18000",
		apiKeyEnv: "MINERU_API_KEY",
		modelMap: {
			pipeline: "pipeline",
			vlm: "vlm-engine"
		},
		allowInsecureHttp: true
	};
}
function providerById(config, id) {
	return config.providers.find((provider) => provider.id === id);
}
const DEFAULT_PARSE_DEFAULTS = {
	model: "pipeline",
	ocr: false,
	parseMethod: "auto",
	language: "ch",
	formula: true,
	table: true
};
const DEFAULT_POLLING_CONFIG = {
	pollIntervalMs: 2e3,
	pollTimeoutMs: 6e5,
	requestTimeoutMs: 6e4,
	operationTimeoutMs: 36e5
};
const DEFAULT_RETRY_CONFIG = {
	maxAttempts: 3,
	baseDelayMs: 500,
	maxDelayMs: 1e4
};
const DEFAULT_OUTPUT_CONFIG = { maxInlineChars: 2e5 };
const DEFAULT_SECURITY_LIMITS = {
	maxFileBytes: 209715200,
	maxApiResponseBytes: 8388608,
	maxZipDownloadBytes: 536870912,
	maxZipEntries: 1e4,
	maxZipEntryBytes: 268435456,
	maxZipTotalBytes: 2147483648,
	maxZipCompressionRatio: 200
};
const DEFAULT_STORAGE_OPTIONS = {
	cacheEnabled: true,
	retainSources: false,
	stagingTtlMs: 864e5
};
//#endregion
//#region src/config.ts
function dshHome() {
	const env = process.env.DSH_HOME?.trim();
	if (!env) return join(homedir(), ".dsh");
	if (env === "~") return homedir();
	if (env.startsWith("~/") || env.startsWith("~\\")) return resolve(join(homedir(), env.slice(2)));
	return resolve(env);
}
function defaultMinerUConfig() {
	const selfHosted = defaultProviderConfig("self-hosted-v2");
	const official = defaultProviderConfig("official-v4");
	return {
		schemaVersion: 1,
		activeProvider: selfHosted.id,
		providers: [selfHosted, official],
		defaults: { ...DEFAULT_PARSE_DEFAULTS },
		storage: {
			storageRoot: join(dshHome(), "cache", "pdf-mineru"),
			...DEFAULT_STORAGE_OPTIONS
		},
		polling: { ...DEFAULT_POLLING_CONFIG },
		retry: { ...DEFAULT_RETRY_CONFIG },
		output: { ...DEFAULT_OUTPUT_CONFIG },
		limits: { ...DEFAULT_SECURITY_LIMITS }
	};
}
const ALLOWED_TOP_KEYS = /* @__PURE__ */ new Set([
	"schemaVersion",
	"activeProvider",
	"providers",
	"defaults",
	"storage",
	"polling",
	"retry",
	"output",
	"limits"
]);
const ALLOWED_OFFICIAL_PROVIDER_KEYS = /* @__PURE__ */ new Set([
	"id",
	"type",
	"baseURL",
	"apiKeyEnv",
	"models",
	"configuredVersion"
]);
const ALLOWED_SELF_HOSTED_PROVIDER_KEYS = /* @__PURE__ */ new Set([
	"id",
	"type",
	"baseURL",
	"apiKeyEnv",
	"modelMap",
	"configuredVersion",
	"allowInsecureHttp"
]);
const ALLOWED_MODEL_MAP_KEYS = /* @__PURE__ */ new Set(["pipeline", "vlm"]);
const ALLOWED_DEFAULTS_KEYS = /* @__PURE__ */ new Set([
	"model",
	"ocr",
	"parseMethod",
	"language",
	"formula",
	"table"
]);
const ALLOWED_STORAGE_KEYS = /* @__PURE__ */ new Set([
	"storageRoot",
	"cacheEnabled",
	"retainSources",
	"stagingTtlMs"
]);
const ALLOWED_POLLING_KEYS = /* @__PURE__ */ new Set([
	"pollIntervalMs",
	"pollTimeoutMs",
	"requestTimeoutMs",
	"operationTimeoutMs"
]);
const ALLOWED_RETRY_KEYS = /* @__PURE__ */ new Set([
	"maxAttempts",
	"baseDelayMs",
	"maxDelayMs"
]);
const ALLOWED_OUTPUT_KEYS = /* @__PURE__ */ new Set(["maxInlineChars"]);
const ALLOWED_LIMITS_KEYS = /* @__PURE__ */ new Set([
	"maxFileBytes",
	"maxApiResponseBytes",
	"maxZipDownloadBytes",
	"maxZipEntries",
	"maxZipEntryBytes",
	"maxZipTotalBytes",
	"maxZipCompressionRatio"
]);
function assertAllowedKeys(record, allowed, path) {
	for (const key of Object.keys(record)) if (!allowed.has(key)) throw new TypeError(`${path} contains unsupported property ${key}`);
}
function record(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
	return value;
}
function text(value, fallback, label) {
	const result = value === void 0 ? fallback : value;
	if (typeof result !== "string" || result.trim() === "") throw new TypeError(`${label} must be a non-empty string`);
	return result;
}
function positive(value, fallback, label) {
	const result = value === void 0 ? fallback : value;
	if (typeof result !== "number" || !Number.isSafeInteger(result) || result <= 0) throw new TypeError(`${label} must be a positive safe integer`);
	return result;
}
function boundedPositive(value, fallback, label, min, max) {
	const result = positive(value, fallback, label);
	if (result < min || result > max) throw new TypeError(`${label} must be between ${String(min)} and ${String(max)}`);
	return result;
}
function booleanValue(value, fallback, label) {
	const result = value === void 0 ? fallback : value;
	if (typeof result !== "boolean") throw new TypeError(`${label} must be a boolean`);
	return result;
}
function credentialRef(value, fallback, required) {
	const result = value === void 0 ? fallback : value;
	if (result === void 0 && !required) return void 0;
	if (typeof result !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(result)) throw new TypeError("apiKeyEnv must be a valid credential reference");
	return result;
}
function baseUrl(value, fallback, allowHttp, label) {
	const parsed = new URL(text(value, fallback, label));
	if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new TypeError(`${label} must not contain credentials, query, or fragment`);
	if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) throw new TypeError(`${label} must use HTTPS`);
	return parsed.toString().replace(/\/$/, "");
}
function models(value, fallback) {
	const input = value === void 0 ? fallback : value;
	if (!Array.isArray(input) || input.length === 0 || input.some((item) => item !== "pipeline" && item !== "vlm")) throw new TypeError("provider models must contain pipeline and/or vlm");
	return [...new Set(input)];
}
function parseProvider(value) {
	const input = record(value, "provider");
	const id = asProviderConfigId(text(input.id, "", "provider.id"));
	if (input.type === "official-v4") {
		assertAllowedKeys(input, ALLOWED_OFFICIAL_PROVIDER_KEYS, "provider");
		return {
			id,
			type: "official-v4",
			baseURL: baseUrl(input.baseURL, "https://mineru.net/api/v4", false, "provider.baseURL"),
			apiKeyEnv: credentialRef(input.apiKeyEnv, "MINERU_API_KEY", true),
			models: models(input.models, ["pipeline", "vlm"]),
			configuredVersion: "v4"
		};
	}
	if (input.type !== "self-hosted-v2") throw new TypeError("provider.type is unsupported");
	assertAllowedKeys(input, ALLOWED_SELF_HOSTED_PROVIDER_KEYS, "provider");
	const allowInsecureHttp = booleanValue(input.allowInsecureHttp, false, "provider.allowInsecureHttp");
	const map = record(input.modelMap, "provider.modelMap");
	assertAllowedKeys(map, ALLOWED_MODEL_MAP_KEYS, "modelMap");
	const pipeline = text(map.pipeline, "", "modelMap.pipeline");
	const vlm = text(map.vlm, "", "modelMap.vlm");
	if (pipeline === vlm) throw new TypeError("provider modelMap backends must be distinct");
	return {
		id,
		type: "self-hosted-v2",
		baseURL: baseUrl(input.baseURL, "http://localhost:18000", allowInsecureHttp, "provider.baseURL"),
		apiKeyEnv: credentialRef(input.apiKeyEnv, void 0, false),
		modelMap: {
			pipeline,
			vlm
		},
		...input.configuredVersion === void 0 ? {} : { configuredVersion: text(input.configuredVersion, "", "configuredVersion") },
		allowInsecureHttp
	};
}
function parseCanonical(input, fallback) {
	if (input.schemaVersion !== void 0) {
		if (input.schemaVersion !== 1) throw new TypeError(`unsupported schemaVersion: ${String(input.schemaVersion)}`);
	}
	if (!Array.isArray(input.providers) || input.providers.length === 0) throw new TypeError("providers must be a non-empty array");
	const providers = input.providers.map(parseProvider);
	if (new Set(providers.map((provider) => provider.id)).size !== providers.length) throw new TypeError("provider ids must be unique");
	const activeProvider = asProviderConfigId(text(input.activeProvider, "", "activeProvider"));
	if (!providers.some((provider) => provider.id === activeProvider)) throw new TypeError("activeProvider does not identify a configured provider");
	const defaults = record(input.defaults ?? {}, "defaults");
	assertAllowedKeys(defaults, ALLOWED_DEFAULTS_KEYS, "defaults");
	const storage = record(input.storage ?? {}, "storage");
	assertAllowedKeys(storage, ALLOWED_STORAGE_KEYS, "storage");
	const polling = record(input.polling ?? {}, "polling");
	assertAllowedKeys(polling, ALLOWED_POLLING_KEYS, "polling");
	const retry = record(input.retry ?? {}, "retry");
	assertAllowedKeys(retry, ALLOWED_RETRY_KEYS, "retry");
	const output = record(input.output ?? {}, "output");
	assertAllowedKeys(output, ALLOWED_OUTPUT_KEYS, "output");
	const limits = record(input.limits ?? {}, "limits");
	assertAllowedKeys(limits, ALLOWED_LIMITS_KEYS, "limits");
	const model = defaults.model === void 0 ? fallback.defaults.model : defaults.model;
	if (model !== "pipeline" && model !== "vlm") throw new TypeError("defaults.model is invalid");
	let parseMethod;
	if (defaults.parseMethod !== void 0) {
		if (defaults.parseMethod !== "auto" && defaults.parseMethod !== "txt" && defaults.parseMethod !== "ocr") throw new TypeError("defaults.parseMethod is invalid");
		parseMethod = defaults.parseMethod;
	} else if (defaults.ocr === true) parseMethod = "ocr";
	else parseMethod = fallback.defaults.parseMethod;
	const expectedOcr = parseMethod === "ocr";
	if (defaults.ocr !== void 0) {
		if (booleanValue(defaults.ocr, expectedOcr, "defaults.ocr") !== expectedOcr) throw new TypeError("defaults.ocr conflicts with defaults.parseMethod");
	}
	const ocr = expectedOcr;
	const storageRoot = text(storage.storageRoot, fallback.storage.storageRoot, "storage.storageRoot");
	if (storage.retainSources !== void 0 && storage.retainSources !== false) throw new TypeError("storage.retainSources must be false");
	const result = {
		schemaVersion: 1,
		activeProvider,
		providers,
		defaults: {
			model,
			ocr,
			parseMethod,
			language: text(defaults.language, fallback.defaults.language, "defaults.language"),
			formula: booleanValue(defaults.formula, fallback.defaults.formula, "defaults.formula"),
			table: booleanValue(defaults.table, fallback.defaults.table, "defaults.table")
		},
		storage: {
			storageRoot: resolve(storageRoot),
			cacheEnabled: booleanValue(storage.cacheEnabled, fallback.storage.cacheEnabled, "storage.cacheEnabled"),
			retainSources: false,
			stagingTtlMs: positive(storage.stagingTtlMs, fallback.storage.stagingTtlMs, "storage.stagingTtlMs")
		},
		polling: {
			pollIntervalMs: positive(polling.pollIntervalMs, fallback.polling.pollIntervalMs, "polling.pollIntervalMs"),
			pollTimeoutMs: positive(polling.pollTimeoutMs, fallback.polling.pollTimeoutMs, "polling.pollTimeoutMs"),
			requestTimeoutMs: positive(polling.requestTimeoutMs, fallback.polling.requestTimeoutMs, "polling.requestTimeoutMs"),
			operationTimeoutMs: positive(polling.operationTimeoutMs, fallback.polling.operationTimeoutMs, "polling.operationTimeoutMs")
		},
		retry: {
			maxAttempts: boundedPositive(retry.maxAttempts, fallback.retry.maxAttempts, "retry.maxAttempts", 1, 10),
			baseDelayMs: boundedPositive(retry.baseDelayMs, fallback.retry.baseDelayMs, "retry.baseDelayMs", 1, 6e4),
			maxDelayMs: boundedPositive(retry.maxDelayMs, fallback.retry.maxDelayMs, "retry.maxDelayMs", 1, 3e5)
		},
		output: { maxInlineChars: boundedPositive(output.maxInlineChars, fallback.output.maxInlineChars, "output.maxInlineChars", 1024, 1e6) },
		limits: {
			maxFileBytes: positive(limits.maxFileBytes, fallback.limits.maxFileBytes, "limits.maxFileBytes"),
			maxApiResponseBytes: positive(limits.maxApiResponseBytes, fallback.limits.maxApiResponseBytes, "limits.maxApiResponseBytes"),
			maxZipDownloadBytes: positive(limits.maxZipDownloadBytes, fallback.limits.maxZipDownloadBytes, "limits.maxZipDownloadBytes"),
			maxZipEntries: positive(limits.maxZipEntries, fallback.limits.maxZipEntries, "limits.maxZipEntries"),
			maxZipEntryBytes: positive(limits.maxZipEntryBytes, fallback.limits.maxZipEntryBytes, "limits.maxZipEntryBytes"),
			maxZipTotalBytes: positive(limits.maxZipTotalBytes, fallback.limits.maxZipTotalBytes, "limits.maxZipTotalBytes"),
			maxZipCompressionRatio: positive(limits.maxZipCompressionRatio, fallback.limits.maxZipCompressionRatio, "limits.maxZipCompressionRatio")
		}
	};
	const active = providers.find((provider) => provider.id === activeProvider);
	if (active.type === "official-v4") {
		if (!active.models.includes(result.defaults.model)) throw new TypeError("active official provider does not support defaults.model");
		if (result.defaults.parseMethod === "txt") throw new TypeError("official-v4 cannot use txt as defaults.parseMethod");
	}
	if (result.retry.baseDelayMs > result.retry.maxDelayMs) throw new TypeError("retry.baseDelayMs cannot exceed retry.maxDelayMs");
	if (result.limits.maxZipEntryBytes > result.limits.maxZipTotalBytes) throw new TypeError("maxZipEntryBytes cannot exceed maxZipTotalBytes");
	return result;
}
function parseConfig(value) {
	const fallback = defaultMinerUConfig();
	if (value === void 0 || value === null) return fallback;
	const input = record(value, "config");
	assertAllowedKeys(input, ALLOWED_TOP_KEYS, "config");
	return parseCanonical(input, fallback);
}
//#endregion
//#region src/domain/errors.ts
var MinerUError = class extends Error {
	failure;
	constructor(failure, options) {
		super(failure.message, options);
		this.failure = failure;
		this.name = "MinerUError";
	}
};
function sanitizeDiagnostic(input, secrets = []) {
	let sanitized = input;
	for (const secret of secrets) if (secret !== "") sanitized = sanitized.split(secret).join("[REDACTED]");
	return sanitized.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]").replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
		try {
			const url = new URL(raw);
			url.username = "";
			url.password = "";
			url.pathname = url.pathname === "/" ? "/" : "/[REDACTED]";
			url.search = "";
			url.hash = "";
			return url.toString();
		} catch {
			return "[REDACTED_URL]";
		}
	}).slice(0, 2e3);
}
function failure(code, message, retryable = false, details = {}) {
	return {
		code,
		message: sanitizeDiagnostic(message),
		retryable,
		...details
	};
}
function toMinerUFailure(error, fallback = "PROVIDER_UNAVAILABLE") {
	if (error instanceof MinerUError) return error.failure;
	if (error instanceof Error && error.name === "AbortError") return failure("CANCELLED", "MinerU operation was cancelled", true);
	return failure(fallback, error instanceof Error ? error.message : String(error), true);
}
function throwMinerU(code, message, retryable = false) {
	throw new MinerUError(failure(code, message, retryable));
}
//#endregion
//#region src/providers/retry.ts
function mergeRetryOptions(defaults, overrides) {
	return {
		...defaults,
		...overrides ?? {}
	};
}
async function readBoundedResponseText(response, maxBytes, signal) {
	const body = response.body;
	if (body === null) return "";
	const reader = body.getReader();
	const chunks = [];
	let totalBytes = 0;
	try {
		while (true) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			if (done) break;
			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) throw new MinerUError(failure("RESULT_TOO_LARGE", `Response body exceeded limit of ${String(maxBytes)} bytes`));
			chunks.push(value);
		}
		return Buffer.concat(chunks).toString("utf8");
	} catch (error) {
		try {
			await reader.cancel();
		} catch {}
		throw error;
	} finally {
		reader.releaseLock();
	}
}
const DEFAULT_RETRY_POLICY = {
	maxRetries: 2,
	initialDelayMs: 500,
	maxDelayMs: 1e4,
	backoffFactor: 2,
	jitter: true
};
/**
* Parses a standard HTTP Retry-After header value.
* Supports decimal integer seconds (e.g. "120") and HTTP-date strings.
* Returns the delay in milliseconds, or undefined if missing/unparseable.
*/
function parseRetryAfter(header, now = Date.now()) {
	if (!header || typeof header !== "string") return void 0;
	const trimmed = header.trim();
	if (!trimmed) return void 0;
	if (/^\d+$/.test(trimmed)) {
		const seconds = Number(trimmed);
		if (Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= Math.floor(Number.MAX_SAFE_INTEGER / 1e3)) return seconds * 1e3;
	}
	if (/^[-+]?\d+/.test(trimmed) && !/\s/.test(trimmed)) return;
	if (/[A-Za-z]{3}/.test(trimmed)) {
		const parsedDate = Date.parse(trimmed);
		if (!Number.isNaN(parsedDate)) return Math.max(0, parsedDate - now);
	}
}
/**
* Returns true if an HTTP status code is typically transient and safe to retry.
* Matches 408 (Request Timeout), 429 (Too Many Requests), and 5xx server errors.
*/
function isRetryableHttpStatus(status) {
	return status === 408 || status === 429 || status >= 500 && status <= 599;
}
/**
* Determines whether a caught error is retryable.
* Abort/cancellation errors and explicit non-retryable MinerUErrors return false.
*/
function isRetryableError(err, signal) {
	if (signal?.aborted) return false;
	if (err instanceof DOMException && err.name === "AbortError") return false;
	if (err instanceof MinerUError) {
		if (err.failure.code === "CANCELLED") return false;
		return err.failure.retryable;
	}
	if (err instanceof Error) {
		if (err.name === "AbortError" || err.message.toLowerCase().includes("aborted")) return false;
	}
	return false;
}
/**
* Abort-aware delay utility using node:timers/promises.
*/
async function defaultSleep(ms, signal) {
	if (ms <= 0) return;
	try {
		await setTimeout$1(ms, void 0, { signal });
	} catch (error) {
		if (signal.aborted && signal.reason) throw signal.reason;
		throw error;
	}
}
/**
* Calculates exponential backoff delay with optional jitter or Retry-After header.
*/
function calculateBackoffDelay(attempt, policy, retryAfterMs, random = Math.random) {
	if (retryAfterMs !== void 0 && retryAfterMs >= 0) return Math.min(policy.maxDelayMs, retryAfterMs);
	const base = policy.initialDelayMs * Math.pow(policy.backoffFactor, Math.max(0, attempt - 1));
	const clamped = Math.min(policy.maxDelayMs, base);
	if (!policy.jitter) return clamped;
	const jittered = clamped * (.5 + .5 * random());
	return Math.round(jittered);
}
function boundedInteger(value, label, min, max) {
	if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(label + " must be an integer between " + String(min) + " and " + String(max));
	return value;
}
function resolveRetryPolicy(options = {}) {
	const maxRetries = boundedInteger(options.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries, "maxRetries", 0, 9);
	const initialDelayMs = boundedInteger(options.initialDelayMs ?? DEFAULT_RETRY_POLICY.initialDelayMs, "initialDelayMs", 1, 6e4);
	const maxDelayMs = boundedInteger(options.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs, "maxDelayMs", 1, 3e5);
	const backoffFactor = options.backoffFactor ?? DEFAULT_RETRY_POLICY.backoffFactor;
	const jitter = options.jitter ?? DEFAULT_RETRY_POLICY.jitter;
	if (!Number.isFinite(backoffFactor) || backoffFactor < 1 || backoffFactor > 10) throw new TypeError("backoffFactor must be between 1 and 10");
	if (typeof jitter !== "boolean") throw new TypeError("jitter must be a boolean");
	if (initialDelayMs > maxDelayMs) throw new TypeError("initialDelayMs cannot exceed maxDelayMs");
	return {
		maxRetries,
		initialDelayMs,
		maxDelayMs,
		backoffFactor,
		jitter
	};
}
/**
* Reusable bounded, abort-aware retry executor for idempotent provider operations.
*/
async function executeWithRetry(ctx) {
	const policy = resolveRetryPolicy(ctx.retryOptions);
	const sleepFn = ctx.retryOptions?.sleep ?? defaultSleep;
	const randomFn = ctx.retryOptions?.random ?? Math.random;
	const onRetry = ctx.retryOptions?.onRetry;
	let attempt = 1;
	while (true) {
		ctx.signal.throwIfAborted();
		try {
			return await ctx.fn(attempt);
		} catch (err) {
			if (ctx.signal.aborted) throw new MinerUError(failure("CANCELLED", "Operation was cancelled", true), { cause: err });
			if (!isRetryableError(err, ctx.signal) || attempt > policy.maxRetries) throw err;
			let status;
			let retryAfterMs;
			if (typeof err === "object" && err !== null) {
				if ("httpStatus" in err && typeof err.httpStatus === "number") status = err.httpStatus;
				if ("retryAfterMs" in err && typeof err.retryAfterMs === "number") retryAfterMs = err.retryAfterMs;
			}
			const delayMs = calculateBackoffDelay(attempt, policy, retryAfterMs, randomFn);
			const reason = status === void 0 ? "transport" : "http-status";
			if (onRetry) try {
				onRetry({
					provider: ctx.provider,
					operation: ctx.operation,
					attempt,
					maxRetries: policy.maxRetries,
					delayMs,
					reason,
					...status !== void 0 ? { status } : {},
					...retryAfterMs !== void 0 ? { retryAfterMs } : {}
				});
			} catch {}
			try {
				await sleepFn(delayMs, ctx.signal);
			} catch (sleepErr) {
				if (ctx.signal.aborted) throw new MinerUError(failure("CANCELLED", "Operation was cancelled during retry backoff", true), { cause: sleepErr });
				throw sleepErr;
			}
			attempt++;
		}
	}
}
//#endregion
//#region src/providers/provider.ts
function validateProviderCapabilities(request, capabilities) {
	const semantics = request.semantics;
	const unsupported = (message) => {
		throw new MinerUError(failure("UNSUPPORTED_OPTION", message));
	};
	if (!capabilities.models.includes(semantics.model)) unsupported(`Provider does not support model ${semantics.model}`);
	if (!capabilities.parseMethods.includes(semantics.parseMethod)) unsupported(`Provider does not support parse method ${semantics.parseMethod}`);
	if (semantics.ocr && !capabilities.supportsOcr) unsupported("Provider does not support OCR");
	if (semantics.language && !capabilities.supportsLanguage) unsupported("Provider does not support language selection");
	if (!capabilities.supportsFormula && semantics.formula) unsupported("Provider does not support formula parsing");
	if (!capabilities.supportsTable && semantics.table) unsupported("Provider does not support table parsing");
	if (semantics.pages !== void 0 && !capabilities.supportsPageRanges) unsupported("Provider does not support page ranges");
	for (const artifact of request.requiredArtifacts) if (!capabilities.supportedArtifacts.includes(artifact)) unsupported(`Provider does not support artifact ${artifact}`);
	if (request.files.length > capabilities.maxFilesPerSubmission) unsupported(`Provider accepts at most ${String(capabilities.maxFilesPerSubmission)} files per submission`);
	if (capabilities.maxFileBytes !== void 0) {
		for (const file of request.files) if (file.bytes > capabilities.maxFileBytes) throw new MinerUError(failure("FILE_TOO_LARGE", `${file.name} exceeds the provider file-size limit`));
	}
}
//#endregion
//#region src/utils/crypto.ts
/** Stream a file into SHA-256; Node owns cancellation listener cleanup. */
async function computeFileSha256(filePath, signal) {
	signal?.throwIfAborted();
	const digest = createHash("sha256");
	const stream = createReadStream(filePath, { signal });
	try {
		for await (const chunk of stream) digest.update(chunk);
		signal?.throwIfAborted();
		return digest.digest("hex");
	} catch (error) {
		signal?.throwIfAborted();
		throw error;
	} finally {
		stream.destroy();
	}
}
//#endregion
//#region src/domain/request.ts
const CANONICAL_PARSE_REQUEST_SCHEMA_VERSION = 1;
const CACHE_KEY_SPEC_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const ARTIFACT_KINDS = [
	"markdown",
	"layout",
	"model-output",
	"content-list",
	"images"
];
const FOCUS_KINDS = [
	"all",
	"text",
	"table",
	"image",
	"toc",
	"artifacts"
];
function parsePageRangeTokens(input) {
	const intervals = [];
	for (const token of input.split(",")) {
		const trimmed = token.trim();
		if (trimmed === "") continue;
		const match = /^(\d+)(?:-(\d+))?$/.exec(trimmed);
		if (match === null) throw new TypeError(`Invalid page range token: ${trimmed}`);
		const start = Number(match[1]);
		const end = match[2] === void 0 ? start : Number(match[2]);
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > 99999) throw new TypeError(`Invalid page range token: ${trimmed}`);
		intervals.push({
			start,
			end
		});
	}
	if (intervals.length === 0) throw new TypeError("Page range cannot be empty");
	return intervals;
}
function normalizePageRanges(input) {
	const intervals = parsePageRangeTokens(input);
	intervals.sort((left, right) => left.start - right.start || left.end - right.end);
	const merged = [];
	for (const current of intervals) {
		const previous = merged.at(-1);
		if (previous !== void 0 && current.start <= previous.end + 1) previous.end = Math.max(previous.end, current.end);
		else merged.push({ ...current });
	}
	return merged.map(({ start, end }) => start === end ? String(start) : `${String(start)}-${String(end)}`).join(",");
}
function renderPageLabel(pages) {
	const sorted = [...pages].sort((a, b) => a - b);
	const intervals = [];
	for (const p of sorted) {
		const last = intervals.at(-1);
		if (last !== void 0 && p === last.end + 1) last.end = p;
		else intervals.push({
			start: p,
			end: p
		});
	}
	return intervals.map((seg) => seg.start === seg.end ? String(seg.start) : String(seg.start) + "-" + String(seg.end)).join(",");
}
function narrowPageSelection(requested, totalPages) {
	if (requested === void 0) {
		if (totalPages === void 0) return {
			pagesSet: void 0,
			pagesLabel: "",
			outOfRange: [],
			fullyOutOfRange: false
		};
		const maxBound = Math.max(1, totalPages);
		return {
			pagesSet: void 0,
			pagesLabel: maxBound > 1 ? "1-" + String(maxBound) : "1",
			outOfRange: [],
			fullyOutOfRange: false
		};
	}
	if (totalPages === void 0) return {
		pagesSet: new Set(requested),
		pagesLabel: renderPageLabel(requested),
		outOfRange: [],
		fullyOutOfRange: false
	};
	const maxBound = Math.max(1, totalPages);
	const valid = /* @__PURE__ */ new Set();
	const outOfRange = [];
	for (const p of requested) if (p >= 1 && p <= maxBound) valid.add(p);
	else outOfRange.push(p);
	outOfRange.sort((a, b) => a - b);
	if (valid.size === 0) return {
		pagesSet: /* @__PURE__ */ new Set(),
		pagesLabel: "",
		outOfRange,
		fullyOutOfRange: true
	};
	return {
		pagesSet: valid,
		pagesLabel: renderPageLabel(valid),
		outOfRange,
		fullyOutOfRange: false
	};
}
function normalizePageSelection(input) {
	if (input === void 0 || input === null) return void 0;
	if (typeof input === "number") {
		if (!Number.isSafeInteger(input) || input < 1 || input > 99999) throw new TypeError(`Invalid page number: ${String(input)}`);
		return /* @__PURE__ */ new Set([input]);
	}
	if (Array.isArray(input)) {
		if (input.length === 0) throw new TypeError("Page selection cannot be empty");
		const set = /* @__PURE__ */ new Set();
		for (const item of input) if (typeof item === "number") {
			if (!Number.isSafeInteger(item) || item < 1 || item > 99999) throw new TypeError(`Invalid page number: ${String(item)}`);
			set.add(item);
		} else throw new TypeError(`Invalid page selection item: ${String(item)}`);
		return set;
	}
	if (typeof input === "string") {
		if (input.trim() === "") throw new TypeError("Page range cannot be empty");
		const intervals = parsePageRangeTokens(input);
		const set = /* @__PURE__ */ new Set();
		for (const { start, end } of intervals) for (let p = start; p <= end; p++) set.add(p);
		return set;
	}
	throw new TypeError(`Invalid page selection: ${String(input)}`);
}
function parseFocusToken(item) {
	if (typeof item !== "string") throw new TypeError(`Invalid focus option: ${String(item)}`);
	let trimmed = item.trim().toLowerCase();
	if (trimmed === "outline") trimmed = "toc";
	if (trimmed === "artifact") trimmed = "artifacts";
	if (!FOCUS_KINDS.includes(trimmed)) throw new TypeError(`Invalid focus option: ${String(item)}`);
	return trimmed;
}
function normalizeFocusSelection(input) {
	if (input === void 0 || input === null) return /* @__PURE__ */ new Set(["all"]);
	if (typeof input === "string") return /* @__PURE__ */ new Set([parseFocusToken(input)]);
	if (Array.isArray(input)) {
		if (input.length === 0) return /* @__PURE__ */ new Set(["all"]);
		const set = /* @__PURE__ */ new Set();
		for (const item of input) set.add(parseFocusToken(item));
		return set;
	}
	throw new TypeError(`Invalid focus option: ${String(input)}`);
}
function normalizeArtifactKinds(kinds) {
	const requested = /* @__PURE__ */ new Set(["markdown", ...kinds]);
	return ARTIFACT_KINDS.filter((kind) => requested.has(kind));
}
//#endregion
//#region src/service/request-normalizer.ts
const REQUEST_FIELDS = /* @__PURE__ */ new Set([
	"file_path",
	"pages",
	"focus",
	"model",
	"ocr",
	"language",
	"formula",
	"table",
	"artifacts",
	"inline_images",
	"poll_timeout_ms",
	"cursor"
]);
const SUPPORTED_EXTENSIONS = /* @__PURE__ */ new Set([
	".pdf",
	".png",
	".jpg",
	".jpeg",
	".jp2",
	".webp",
	".gif",
	".bmp",
	".tif",
	".tiff",
	".doc",
	".docx",
	".ppt",
	".pptx",
	".xls",
	".xlsx"
]);
function normalizePages(input) {
	try {
		if (typeof input === "string") return normalizePageRanges(input);
		if (typeof input === "number") {
			if (!Number.isSafeInteger(input) || input < 1 || input > 99999) throw new TypeError(`Invalid page number: ${String(input)}`);
			return String(input);
		}
		if (Array.isArray(input)) {
			const selected = normalizePageSelection(input);
			if (!selected || selected.size === 0) throw new TypeError("Page selection cannot be empty");
			const sorted = [...selected].sort((a, b) => a - b);
			const ranges = [];
			let start = sorted[0];
			let end = start;
			for (let i = 1; i < sorted.length; i++) if (sorted[i] === end + 1) end = sorted[i];
			else {
				ranges.push(start === end ? String(start) : `${String(start)}-${String(end)}`);
				start = sorted[i];
				end = start;
			}
			ranges.push(start === end ? String(start) : `${String(start)}-${String(end)}`);
			return ranges.join(",");
		}
		throw new TypeError("Invalid page selection");
	} catch (error) {
		throw new MinerUError(failure("INVALID_REQUEST", error instanceof Error ? error.message : "Invalid page range"), { cause: error });
	}
}
function resolvePath(input) {
	if (typeof input.file_path !== "string" || input.file_path.trim() === "") throw new MinerUError(failure("INVALID_REQUEST", "Exactly one local document path is required"));
	return input.file_path.trim();
}
function resolveArtifacts(input) {
	if (input.artifacts !== void 0) {
		for (const artifact of input.artifacts) if (!ARTIFACT_KINDS.includes(artifact)) throw new MinerUError(failure("INVALID_REQUEST", `Unknown artifact kind: ${String(artifact)}`));
		return normalizeArtifactKinds(input.artifacts);
	}
	return ARTIFACT_KINDS;
}
async function prepareSource(rawPath, cwd, maxFileBytes, signal) {
	const path = resolve(cwd ?? process.cwd(), rawPath);
	let before;
	try {
		before = await stat(path);
	} catch (error) {
		throw new MinerUError(failure("FILE_NOT_FOUND", `Document does not exist: ${basename(path)}`), { cause: error });
	}
	if (!before.isFile()) throw new MinerUError(failure("INVALID_REQUEST", `${basename(path)} is not a regular file`));
	if (!SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase())) throw new MinerUError(failure("UNSUPPORTED_OPTION", `Unsupported document type: ${extname(path) || "(none)"}`));
	if (maxFileBytes !== void 0 && before.size > maxFileBytes) throw new MinerUError(failure("FILE_TOO_LARGE", `${basename(path)} exceeds the configured file-size limit`));
	const sha256 = await computeFileSha256(path, signal);
	const after = await stat(path);
	if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.dev !== after.dev || before.ino !== after.ino) throw new MinerUError(failure("INVALID_REQUEST", `${basename(path)} changed while it was being hashed`, true));
	return {
		fileId: createFileId(sha256),
		name: basename(path),
		bytes: after.size,
		sha256,
		path,
		fingerprint: {
			size: after.size,
			mtimeMs: after.mtimeMs,
			device: after.dev,
			inode: after.ino
		}
	};
}
async function assertSourcesUnchanged(sources, signal) {
	for (const source of sources) {
		signal.throwIfAborted();
		let current;
		try {
			current = await stat(source.path);
		} catch (error) {
			throw new MinerUError(failure("FILE_NOT_FOUND", `${source.name} disappeared after hashing and before upload`), { cause: error });
		}
		const expected = source.fingerprint;
		if (!current.isFile() || current.size !== expected.size || current.mtimeMs !== expected.mtimeMs || current.dev !== expected.device || current.ino !== expected.inode) throw new MinerUError(failure("INVALID_REQUEST", `${source.name} changed after hashing and before upload`, true));
	}
}
var RequestNormalizer = class {
	options;
	constructor(options) {
		this.options = options;
	}
	async normalize(input, signal) {
		signal.throwIfAborted();
		if (typeof input !== "object" || input === null || Array.isArray(input)) throw new MinerUError(failure("INVALID_REQUEST", "Parse request must be an object"));
		for (const key of Object.keys(input)) if (!REQUEST_FIELDS.has(key)) throw new MinerUError(failure("INVALID_REQUEST", `Parse request contains unsupported property ${key}`));
		const path = resolvePath(input);
		const language = input.language ?? this.options.defaults.language;
		if (language.trim() === "") throw new MinerUError(failure("INVALID_REQUEST", "Language cannot be empty"));
		const model = input.model ?? this.options.defaults.model;
		const parseMethod = input.ocr === void 0 ? this.options.defaults.parseMethod : input.ocr ? "ocr" : "auto";
		const ocr = parseMethod === "ocr";
		const formula = input.formula ?? this.options.defaults.formula;
		const table = input.table ?? this.options.defaults.table;
		const pages = input.pages === void 0 ? void 0 : normalizePages(input.pages);
		const unhashedSource = await prepareSource(path, this.options.cwd, this.options.maxFileBytes, signal);
		const fileId = createFileId(unhashedSource.sha256, 0);
		const source = {
			...unhashedSource,
			fileId
		};
		return {
			sources: [source],
			request: {
				schemaVersion: 1,
				files: [{
					fileId,
					name: source.name,
					bytes: source.bytes,
					sha256: source.sha256
				}],
				semantics: {
					model,
					ocr,
					parseMethod,
					language,
					formula,
					table,
					...pages === void 0 ? {} : { pages }
				},
				requiredArtifacts: resolveArtifacts(input)
			}
		};
	}
};
//#endregion
//#region src/providers/http-client.ts
/**
* Resolves a request path against a base URL, preserving pathname prefix if any.
*/
function resolveProviderUrl(baseUrl, path) {
	const parsed = typeof baseUrl === "string" ? new URL(baseUrl) : baseUrl;
	const basePath = parsed.pathname.replace(/\/+$/, "");
	const normalizedPath = path ? path.startsWith("/") ? path : `/${path}` : "";
	return `${parsed.origin}${basePath}${normalizedPath}`;
}
/**
* Extracts human-readable error messages from an API response body.
* Inspects JSON fields detail, message, error, msg (prioritizing msg for official-v4, detail for self-hosted),
* or falls back to truncated raw text for non-JSON bodies.
*/
function extractErrorMessage(bodyText, provider) {
	let parsedError;
	try {
		const parsed = JSON.parse(bodyText);
		if (typeof parsed === "object" && parsed !== null) {
			const json = parsed;
			if (provider === "official-v4") {
				if (typeof json.msg === "string") parsedError = json.msg;
				else if (typeof json.message === "string") parsedError = json.message;
				else if (typeof json.detail === "string") parsedError = json.detail;
				else if (typeof json.error === "string") parsedError = json.error;
			} else if (typeof json.detail === "string") parsedError = json.detail;
			else if (typeof json.message === "string") parsedError = json.message;
			else if (typeof json.error === "string") parsedError = json.error;
			else if (typeof json.msg === "string") parsedError = json.msg;
		}
	} catch {
		parsedError = bodyText.slice(0, 500);
	}
	return parsedError;
}
/**
* Maps HTTP error status codes to typed MinerUError instances with provider-specific diagnostic phrasing.
*/
function createHttpStatusError(provider, status, diagnostic, retryAfterMs) {
	let err;
	if (provider === "official-v4") {
		if (status === 401 || status === 403) err = new MinerUError(failure("AUTHENTICATION_FAILED", `Official MinerU authentication failed (${String(status)})${diagnostic}`, false, { provider }));
		else if (status === 404) err = new MinerUError(failure("JOB_NOT_FOUND", `Official MinerU resource not found (${String(status)})${diagnostic}`, false, { provider }));
		else if (status === 413) err = new MinerUError(failure("FILE_TOO_LARGE", `File exceeds size limit (${String(status)})${diagnostic}`, false, { provider }));
		else if (status === 429) err = new MinerUError(failure("PROVIDER_RATE_LIMITED", `Official MinerU rate limit exceeded (${String(status)})${diagnostic}`, true, { provider }));
		else if (status === 408) err = new MinerUError(failure("PROVIDER_UNAVAILABLE", `Official MinerU request timeout (${String(status)})${diagnostic}`, true, { provider }));
		else if (status >= 500) err = new MinerUError(failure("PROVIDER_UNAVAILABLE", `Official MinerU server error (${String(status)})${diagnostic}`, true, { provider }));
		else err = new MinerUError(failure("REMOTE_PARSE_FAILED", `Official MinerU returned status ${String(status)}${diagnostic}`, false, { provider }));
	} else if (status === 401 || status === 403) err = new MinerUError(failure("AUTHENTICATION_FAILED", `Authentication failed (${String(status)})${diagnostic}`, false, { provider }));
	else if (status === 404) err = new MinerUError(failure("JOB_NOT_FOUND", `Resource not found (${String(status)})${diagnostic}`, false, { provider }));
	else if (status === 413) err = new MinerUError(failure("FILE_TOO_LARGE", `Uploaded file is too large (${String(status)})${diagnostic}`, false, { provider }));
	else if (status === 429) err = new MinerUError(failure("PROVIDER_RATE_LIMITED", `Provider rate limit exceeded (${String(status)})${diagnostic}`, true, { provider }));
	else if (status === 408) err = new MinerUError(failure("PROVIDER_UNAVAILABLE", `MinerU server request timeout (${String(status)})${diagnostic}`, true, { provider }));
	else if (status >= 500) err = new MinerUError(failure("PROVIDER_UNAVAILABLE", `MinerU server error (${String(status)})${diagnostic}`, true, { provider }));
	else err = new MinerUError(failure("REMOTE_PARSE_FAILED", `MinerU returned unexpected status ${String(status)}${diagnostic}`, false, { provider }));
	Object.assign(err, {
		httpStatus: status,
		retryAfterMs
	});
	return err;
}
/**
* Reusable HTTP client for MinerU providers encapsulating request setup, credential injection,
* timeout management, error body extraction, status code mapping, and bounded retries.
*/
var ProviderHttpClient = class {
	baseUrl;
	provider;
	defaultRetry;
	providerLabel;
	constructor(options) {
		this.baseUrl = typeof options.baseURL === "string" ? new URL(options.baseURL) : options.baseURL;
		this.provider = options.provider;
		this.defaultRetry = options.defaultRetry ?? {};
		this.providerLabel = options.providerLabel ?? (options.provider === "official-v4" ? "MinerU official API" : "MinerU server");
	}
	async requestJson(opts) {
		const method = opts.method ?? "GET";
		const reqPath = opts.path;
		const reqBody = opts.body;
		const reqHeaders = opts.headers ?? {};
		const reqContext = opts.context;
		const acceptedStatusesList = opts.acceptedStatuses ?? [200];
		const allowRetry = opts.retry ?? method.toUpperCase() === "GET";
		const operation = opts.operation ?? (reqPath.startsWith("/health") || reqPath.includes("probe") ? "probe" : "api-json");
		const executeOnce = async () => {
			reqContext.signal.throwIfAborted();
			const url = resolveProviderUrl(this.baseUrl, reqPath);
			const controller = new AbortController();
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				controller.abort(new DOMException(`Request timed out after ${String(reqContext.timeoutMs)}ms`, "TimeoutError"));
			}, reqContext.timeoutMs);
			const onParentAbort = () => {
				controller.abort(reqContext.signal.reason);
			};
			reqContext.signal.addEventListener("abort", onParentAbort, { once: true });
			try {
				const requestHeaders = { ...reqHeaders };
				if (reqContext.credential && reqContext.credential.trim() !== "") requestHeaders["authorization"] = `Bearer ${reqContext.credential}`;
				let response;
				try {
					const requestInit = {
						method,
						headers: requestHeaders,
						body: reqBody,
						signal: controller.signal,
						redirect: "error",
						...reqBody !== void 0 ? { duplex: "half" } : {}
					};
					response = await fetch(url, requestInit);
				} catch (err) {
					if (reqContext.signal.aborted) throw new MinerUError(failure("CANCELLED", "Operation was cancelled", true));
					if (timedOut) {
						const timeoutErr = new MinerUError(failure("PROVIDER_UNAVAILABLE", `Request to ${this.providerLabel} timed out after ${String(reqContext.timeoutMs)}ms`, true));
						Object.assign(timeoutErr, { httpStatus: 408 });
						throw timeoutErr;
					}
					const message = err instanceof Error ? err.message : String(err);
					throw new MinerUError(failure("PROVIDER_UNAVAILABLE", `Failed to connect to ${this.providerLabel}: ${sanitizeDiagnostic(message)}`, true), { cause: err });
				}
				const status = response.status;
				if (!acceptedStatusesList.includes(status)) {
					let errorBody = "";
					try {
						errorBody = await readBoundedResponseText(response, reqContext.limits.maxApiResponseBytes, controller.signal);
					} catch {
						if (response.body) try {
							await response.body.cancel();
						} catch {}
					}
					const parsedError = extractErrorMessage(errorBody, this.provider);
					const diagnostic = parsedError ? `: ${sanitizeDiagnostic(parsedError, [reqContext.credential ?? ""])}` : "";
					const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
					throw createHttpStatusError(this.provider, status, diagnostic, retryAfterMs);
				}
				const contentType = response.headers.get("content-type") ?? "";
				if (!contentType.toLowerCase().includes("application/json")) {
					if (response.body) try {
						await response.body.cancel();
					} catch {}
					throw new MinerUError(failure("REMOTE_PARSE_FAILED", this.provider === "official-v4" ? `Expected application/json response, got "${contentType}"` : `Expected application/json response, got ${contentType || "unknown"}`, false, { provider: this.provider }));
				}
				const rawText = await readBoundedResponseText(response, reqContext.limits.maxApiResponseBytes, controller.signal);
				let parsed;
				try {
					parsed = JSON.parse(rawText);
				} catch (err) {
					if (err instanceof MinerUError) throw err;
					throw new MinerUError(failure("REMOTE_PARSE_FAILED", `Failed to parse JSON response: ${sanitizeDiagnostic(err instanceof Error ? err.message : String(err))}`, false, { provider: this.provider }), { cause: err });
				}
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new MinerUError(failure("REMOTE_PARSE_FAILED", this.provider === "official-v4" ? "Official MinerU response must be an object" : "MinerU response must be an object", false, { provider: this.provider }));
				if (opts.validateResponse) {
					const validated = opts.validateResponse(parsed, response);
					if (validated !== void 0) return validated;
				}
				return parsed;
			} finally {
				clearTimeout(timer);
				reqContext.signal.removeEventListener("abort", onParentAbort);
			}
		};
		if (!allowRetry) return await executeOnce();
		return await executeWithRetry({
			provider: this.provider,
			operation,
			signal: reqContext.signal,
			retryOptions: mergeRetryOptions(this.defaultRetry, reqContext.retry),
			fn: executeOnce
		});
	}
};
//#endregion
//#region src/providers/self-hosted-v2.ts
function validateAndNormalizeBaseURL(rawUrl, allowInsecureHttp) {
	if (typeof rawUrl !== "string" || rawUrl.trim() === "") throw new MinerUError(failure("INVALID_REQUEST", "Provider baseURL must be a non-empty string"));
	let parsed;
	try {
		parsed = new URL(rawUrl);
	} catch (err) {
		throw new MinerUError(failure("INVALID_REQUEST", `Invalid provider baseURL: "${sanitizeDiagnostic(rawUrl)}"`), { cause: err });
	}
	if (parsed.protocol === "http:") {
		if (!allowInsecureHttp) throw new MinerUError(failure("INVALID_REQUEST", "Insecure HTTP baseURL is not allowed unless allowInsecureHttp is explicitly enabled"));
	} else if (parsed.protocol !== "https:") throw new MinerUError(failure("INVALID_REQUEST", `Unsupported protocol in baseURL: ${parsed.protocol}`));
	if (parsed.username || parsed.password) throw new MinerUError(failure("INVALID_REQUEST", "Provider baseURL must not contain embedded credentials"));
	if (parsed.search || parsed.hash) throw new MinerUError(failure("INVALID_REQUEST", "Provider baseURL must not contain a query or fragment"));
	return parsed;
}
function mapSelfHostedStatus(rawStatus) {
	if (typeof rawStatus !== "string") throw new MinerUError(failure("REMOTE_PARSE_FAILED", "Missing task status from MinerU server response"));
	switch (rawStatus.toLowerCase()) {
		case "pending":
		case "waiting":
		case "queued": return "queued";
		case "processing":
		case "running":
		case "converting": return "processing";
		case "completed":
		case "done":
		case "success": return "completed";
		case "failed":
		case "error": return "failed";
		default: throw new MinerUError(failure("REMOTE_PARSE_FAILED", `Unknown remote task status: "${sanitizeDiagnostic(rawStatus)}"`));
	}
}
function jsonArtifact(value) {
	if (typeof value !== "string") return JSON.stringify(value);
	try {
		JSON.parse(value);
		return value;
	} catch {
		return JSON.stringify(value);
	}
}
function decodeBase64Image(value, fileId) {
	const compact = value.replace(/\s+/g, "");
	if (compact.length === 0 || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) throw new MinerUError(failure("REMOTE_PARSE_FAILED", "Self-hosted result contains invalid base64 image data", false, {
		provider: "self-hosted-v2",
		fileId
	}));
	return Buffer.from(compact, "base64");
}
function findFileResult(file, results, allFiles) {
	if (Object.prototype.hasOwnProperty.call(results, file.name)) return results[file.name];
	const stem = file.name.replace(/\.[^/.]+$/, "");
	if (Object.prototype.hasOwnProperty.call(results, stem)) {
		if (allFiles.length > 1) {
			if (allFiles.filter((f) => f.name.replace(/\.[^/.]+$/, "") === stem).length === 1) return results[stem];
			return;
		}
		return results[stem];
	}
	if (allFiles.length === 1) {
		const keys = Object.keys(results);
		if (keys.length === 1 && keys[0] !== void 0) return results[keys[0]];
	}
}
var SelfHostedV2Provider = class {
	id = "self-hosted-v2";
	config;
	capabilities;
	parsedBaseUrl;
	retryOptions;
	client;
	constructor(config, options) {
		asProviderConfigId(config.id);
		this.config = config;
		this.retryOptions = options?.retry ?? {};
		this.parsedBaseUrl = validateAndNormalizeBaseURL(config.baseURL, config.allowInsecureHttp);
		this.client = new ProviderHttpClient({
			baseURL: this.parsedBaseUrl,
			provider: "self-hosted-v2",
			defaultRetry: this.retryOptions,
			providerLabel: "MinerU server"
		});
		const supportedModels = ["pipeline", "vlm"].filter((m) => typeof config.modelMap[m] === "string" && config.modelMap[m].trim() !== "");
		this.capabilities = {
			models: supportedModels.length > 0 ? supportedModels : ["pipeline", "vlm"],
			parseMethods: [
				"auto",
				"txt",
				"ocr"
			],
			supportsOcr: true,
			supportsLanguage: true,
			supportsFormula: true,
			supportsTable: true,
			supportsPageRanges: true,
			supportedArtifacts: [
				"markdown",
				"layout",
				"model-output",
				"content-list",
				"images"
			],
			maxFilesPerSubmission: 10
		};
	}
	async compatibilityKey(request, context) {
		const originAndPath = `${this.parsedBaseUrl.origin}${this.parsedBaseUrl.pathname.replace(/\/+$/, "")}`;
		const backend = this.config.modelMap[request.semantics.model];
		return `self-hosted-v2:${createHash("sha256").update(JSON.stringify({
			originAndPath,
			configuredVersion: context.configuredVersion ?? this.config.configuredVersion ?? "v2",
			model: request.semantics.model,
			backend
		}), "utf8").digest("hex").slice(0, 24)}`;
	}
	async probe(context) {
		try {
			const data = await this.requestJson("GET", "/health", void 0, {}, context, [200], {
				operation: "probe",
				retry: true
			});
			const isHealthy = data.status === "healthy";
			const protocolVersion = data.protocol_version !== void 0 ? `v${String(data.protocol_version)}` : "v2";
			const serverVersion = typeof data.version === "string" ? data.version : void 0;
			return {
				available: isHealthy,
				provider: "self-hosted-v2",
				authentication: context.credential && context.credential.trim() !== "" ? "valid" : "not-configured",
				protocolVersion,
				...serverVersion !== void 0 ? { serverVersion } : {},
				queue: {
					queued: typeof data.queued_tasks === "number" ? data.queued_tasks : void 0,
					processing: typeof data.processing_tasks === "number" ? data.processing_tasks : void 0,
					completed: typeof data.completed_tasks === "number" ? data.completed_tasks : void 0,
					failed: typeof data.failed_tasks === "number" ? data.failed_tasks : void 0,
					maxConcurrent: typeof data.max_concurrent_requests === "number" ? data.max_concurrent_requests : void 0
				},
				...isHealthy ? {} : { diagnostics: "Server reported unhealthy status" }
			};
		} catch (error) {
			if (context.signal.aborted) throw new MinerUError(failure("CANCELLED", "Probe operation was cancelled", true));
			const minerUFailure = toMinerUFailure(error);
			return {
				available: false,
				provider: "self-hosted-v2",
				authentication: minerUFailure.code === "AUTHENTICATION_FAILED" ? "invalid" : context.credential && context.credential.trim() !== "" ? "unknown" : "not-configured",
				protocolVersion: "v2",
				diagnostics: sanitizeDiagnostic(minerUFailure.message)
			};
		}
	}
	async submit(request, sources, context) {
		context.signal.throwIfAborted();
		validateProviderCapabilities(request, this.capabilities);
		const backend = this.config.modelMap[request.semantics.model];
		if (typeof backend !== "string" || backend.trim() === "") throw new MinerUError(failure("UNSUPPORTED_OPTION", `Model "${request.semantics.model}" is not configured in provider modelMap`));
		if (sources.length !== request.files.length) throw new MinerUError(failure("INVALID_REQUEST", "Prepared source files count does not match request files count"));
		await assertSourcesUnchanged(sources, context.signal);
		let pageInterval;
		if (request.semantics.pages !== void 0) {
			const intervals = request.semantics.pages.split(",").map((token) => {
				const parts = token.trim().split("-");
				const start = Number(parts[0]);
				return {
					start,
					end: parts[1] !== void 0 ? Number(parts[1]) : start
				};
			});
			if (intervals.length !== 1 || intervals[0] === void 0) throw new MinerUError(failure("UNSUPPORTED_OPTION", "Self-hosted v2 provider only supports a single continuous page range"));
			pageInterval = intervals[0];
		}
		const form = new FormData();
		for (const source of sources) {
			const blob = await openAsBlob(source.path);
			form.append("files", blob, source.name);
		}
		form.append("backend", backend);
		form.append("parse_method", request.semantics.parseMethod);
		form.append("lang_list", request.semantics.language);
		form.append("formula_enable", String(request.semantics.formula));
		form.append("table_enable", String(request.semantics.table));
		if (pageInterval !== void 0) {
			form.append("start_page_id", String(pageInterval.start - 1));
			form.append("end_page_id", String(pageInterval.end - 1));
		}
		const requiredSet = new Set(request.requiredArtifacts);
		form.append("return_md", String(requiredSet.has("markdown")));
		form.append("return_middle_json", String(requiredSet.has("layout")));
		form.append("return_model_output", String(requiredSet.has("model-output")));
		form.append("return_content_list", String(requiredSet.has("content-list")));
		form.append("return_images", String(requiredSet.has("images")));
		const data = await this.requestJson("POST", "/tasks", form, {}, context, [200, 202], {
			operation: "submit",
			retry: false
		});
		if (!data || typeof data.task_id !== "string" || data.task_id.trim() === "") throw new MinerUError(failure("REMOTE_PARSE_FAILED", "MinerU server did not return a valid task_id"));
		const state = mapSelfHostedStatus(data.status);
		const submittedFiles = request.files.map((f) => ({
			dataId: `data_${f.fileId}`,
			fileId: f.fileId,
			name: f.name
		}));
		const ref = {
			provider: "self-hosted-v2",
			taskId: data.task_id,
			files: submittedFiles
		};
		await context.onAccepted?.(ref);
		return {
			ref,
			state,
			files: request.files.map((f) => ({
				fileId: f.fileId,
				state: state === "queued" ? "queued" : state === "processing" ? "processing" : state === "completed" ? "completed" : "failed",
				rawState: data.status,
				failure: state === "failed" ? failure("REMOTE_PARSE_FAILED", sanitizeDiagnostic(data.error ?? "Remote task submission failed", [context.credential ?? ""]), false, {
					provider: "self-hosted-v2",
					fileId: f.fileId
				}) : void 0
			}))
		};
	}
	async inspect(ref, context) {
		context.signal.throwIfAborted();
		if (ref.provider !== "self-hosted-v2") throw new MinerUError(failure("INVALID_REQUEST", `Unsupported provider ref "${ref.provider}" for SelfHostedV2Provider`));
		const data = await this.requestJson("GET", `/tasks/${encodeURIComponent(ref.taskId)}`, void 0, {}, context, [200], {
			operation: "inspect",
			retry: true
		});
		const state = mapSelfHostedStatus(data.status);
		const fileState = state === "queued" ? "queued" : state === "processing" ? "processing" : state === "completed" ? "completed" : "failed";
		const fileFailure = state === "failed" ? failure("REMOTE_PARSE_FAILED", sanitizeDiagnostic(data.error ?? "Remote task failed", [context.credential ?? ""]), false, { provider: "self-hosted-v2" }) : void 0;
		return {
			state,
			files: ref.files.map((f) => ({
				fileId: f.fileId,
				state: fileState,
				rawState: data.status,
				failure: fileFailure ? {
					...fileFailure,
					fileId: f.fileId
				} : void 0
			})),
			rawState: data.status,
			queuedAhead: typeof data.queued_ahead === "number" ? data.queued_ahead : void 0
		};
	}
	async collect(ref, request, sink, context) {
		context.signal.throwIfAborted();
		if (ref.provider !== "self-hosted-v2") throw new MinerUError(failure("INVALID_REQUEST", `Unsupported provider ref "${ref.provider}" for SelfHostedV2Provider`));
		const data = await this.requestJson("GET", `/tasks/${encodeURIComponent(ref.taskId)}/result`, void 0, {}, context, [200], {
			operation: "collect",
			retry: true
		});
		if (!data || typeof data.results !== "object" || data.results === null) throw new MinerUError(failure("REMOTE_PARSE_FAILED", "MinerU server returned empty or invalid results"));
		const collectedFiles = [];
		const requiredSet = new Set(request.requiredArtifacts);
		for (const file of ref.files) {
			const fileResult = findFileResult(file, data.results, ref.files);
			if (!fileResult) {
				collectedFiles.push({
					fileId: file.fileId,
					name: file.name,
					artifacts: [],
					failure: failure("REMOTE_PARSE_FAILED", `No parse result found for file "${file.name}"`, false, {
						provider: "self-hosted-v2",
						fileId: file.fileId
					})
				});
				continue;
			}
			const artifacts = [];
			if (requiredSet.has("markdown") && typeof fileResult.md_content === "string") {
				const artifactRef = await sink.writeArtifact(file.fileId, "markdown", fileResult.md_content, {
					mediaType: "text/markdown; charset=utf-8",
					relativeName: "full.md"
				});
				artifacts.push(artifactRef);
			}
			if (requiredSet.has("layout") && fileResult.middle_json !== null && fileResult.middle_json !== void 0) {
				const content = jsonArtifact(fileResult.middle_json);
				const artifactRef = await sink.writeArtifact(file.fileId, "layout", content, {
					mediaType: "application/json",
					relativeName: "layout.json"
				});
				artifacts.push(artifactRef);
			}
			if (requiredSet.has("model-output") && fileResult.model_output !== null && fileResult.model_output !== void 0) {
				const content = jsonArtifact(fileResult.model_output);
				const artifactRef = await sink.writeArtifact(file.fileId, "model-output", content, {
					mediaType: "application/json",
					relativeName: "model.json"
				});
				artifacts.push(artifactRef);
			}
			if (requiredSet.has("content-list") && fileResult.content_list !== null && fileResult.content_list !== void 0) {
				const content = jsonArtifact(fileResult.content_list);
				const artifactRef = await sink.writeArtifact(file.fileId, "content-list", content, {
					mediaType: "application/json",
					relativeName: "content_list.json"
				});
				artifacts.push(artifactRef);
			}
			if (requiredSet.has("images")) {
				const imagePaths = [];
				for (const [imgName, dataUrl] of Object.entries(fileResult.images ?? {})) {
					if (typeof dataUrl !== "string" || dataUrl.trim() === "") continue;
					let mediaType = "image/png";
					let base64Payload = dataUrl;
					const dataUrlMatch = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl);
					if (dataUrlMatch && dataUrlMatch[1] && dataUrlMatch[2]) {
						mediaType = dataUrlMatch[1];
						base64Payload = dataUrlMatch[2];
					}
					const buffer = decodeBase64Image(base64Payload, file.fileId);
					const cleanName = imgName.split(/[/\\]/).filter(Boolean).filter((s) => s !== "." && s !== "..").join("_").replace(/[^A-Za-z0-9_.-]/g, "_");
					const relativeName = `images/${cleanName === "index.json" ? "source_index.json" : cleanName || "img.png"}`;
					imagePaths.push(relativeName);
					const artifactRef = await sink.writeArtifact(file.fileId, "images", buffer, {
						mediaType,
						relativeName
					});
					artifacts.push(artifactRef);
				}
				artifacts.push(await sink.writeArtifact(file.fileId, "images", JSON.stringify({ images: imagePaths }), {
					mediaType: "application/json",
					relativeName: "images/index.json"
				}));
			}
			const producedKinds = new Set(artifacts.map((artifact) => artifact.kind));
			const missingKinds = request.requiredArtifacts.filter((kind) => !producedKinds.has(kind));
			if (missingKinds.length > 0) collectedFiles.push({
				fileId: file.fileId,
				name: file.name,
				artifacts,
				failure: failure("REMOTE_PARSE_FAILED", `Provider result is missing required artifacts: ${missingKinds.join(", ")}`, false, {
					provider: "self-hosted-v2",
					fileId: file.fileId
				})
			});
			else collectedFiles.push({
				fileId: file.fileId,
				name: file.name,
				artifacts
			});
		}
		return { files: collectedFiles };
	}
	async requestJson(method, path, body, headers, context, acceptedStatuses = [200], options) {
		return await this.client.requestJson({
			method,
			path,
			body,
			headers,
			context,
			acceptedStatuses,
			operation: options?.operation,
			retry: options?.retry
		});
	}
};
//#endregion
//#region node_modules/.pnpm/pend@1.2.0/node_modules/pend/index.js
var require_pend = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = Pend;
	function Pend() {
		this.pending = 0;
		this.max = Infinity;
		this.listeners = [];
		this.waiting = [];
		this.error = null;
	}
	Pend.prototype.go = function(fn) {
		if (this.pending < this.max) pendGo(this, fn);
		else this.waiting.push(fn);
	};
	Pend.prototype.wait = function(cb) {
		if (this.pending === 0) cb(this.error);
		else this.listeners.push(cb);
	};
	Pend.prototype.hold = function() {
		return pendHold(this);
	};
	function pendHold(self) {
		self.pending += 1;
		var called = false;
		return onCb;
		function onCb(err) {
			if (called) throw new Error("callback called twice");
			called = true;
			self.error = self.error || err;
			self.pending -= 1;
			if (self.waiting.length > 0 && self.pending < self.max) pendGo(self, self.waiting.shift());
			else if (self.pending === 0) {
				var listeners = self.listeners;
				self.listeners = [];
				listeners.forEach(cbListener);
			}
		}
		function cbListener(listener) {
			listener(self.error);
		}
	}
	function pendGo(self, fn) {
		fn(pendHold(self));
	}
}));
//#endregion
//#region node_modules/.pnpm/yauzl@3.4.0/node_modules/yauzl/fd-slicer.js
var require_fd_slicer = /* @__PURE__ */ __commonJSMin(((exports) => {
	var fs$1 = __require("fs");
	var util$1 = __require("util");
	var stream = __require("stream");
	var Readable = stream.Readable;
	var PassThrough = stream.PassThrough;
	var Pend = require_pend();
	var EventEmitter$1 = __require("events").EventEmitter;
	exports.BufferSlicer = BufferSlicer;
	exports.FdSlicer = FdSlicer;
	util$1.inherits(FdSlicer, EventEmitter$1);
	function FdSlicer(fd) {
		EventEmitter$1.call(this);
		this.fd = fd;
		this.pend = new Pend();
		this.pend.max = 1;
		this.refCount = 0;
	}
	FdSlicer.prototype.read = function(buffer, offset, length, position, callback) {
		var self = this;
		self.pend.go(function(cb) {
			fs$1.read(self.fd, buffer, offset, length, position, function(err, bytesRead, buffer) {
				cb();
				callback(err, bytesRead, buffer);
			});
		});
	};
	FdSlicer.prototype.createReadStream = function(options) {
		return new ReadStream(this, options);
	};
	FdSlicer.prototype.ref = function() {
		this.refCount += 1;
	};
	FdSlicer.prototype.unref = function() {
		var self = this;
		self.refCount -= 1;
		if (self.refCount < 0) throw new Error("invalid unref");
		if (self.refCount > 0) return;
		fs$1.close(self.fd, onCloseDone);
		function onCloseDone(err) {
			if (err) self.emit("error", err);
			else self.emit("close");
		}
	};
	util$1.inherits(ReadStream, Readable);
	function ReadStream(context, options) {
		options = options || {};
		Readable.call(this, options);
		this.context = context;
		this.context.ref();
		this.start = options.start || 0;
		this.endOffset = options.end;
		this.pos = this.start;
	}
	ReadStream.prototype._read = function(n) {
		var self = this;
		var toRead = Math.min(self._readableState.highWaterMark, n);
		if (self.endOffset != null) toRead = Math.min(toRead, self.endOffset - self.pos);
		if (toRead <= 0) {
			self.push(null);
			this._cleanup();
			return;
		}
		self.context.pend.go(function(cb) {
			var buffer = Buffer.allocUnsafe(toRead);
			fs$1.read(self.context.fd, buffer, 0, toRead, self.pos, function(err, bytesRead) {
				if (err) self.destroy(err);
				else if (bytesRead === 0) {
					self.push(null);
					self._cleanup();
				} else {
					self.pos += bytesRead;
					self.push(buffer.slice(0, bytesRead));
				}
				cb();
			});
		});
	};
	ReadStream.prototype._destroy = function(err, cb) {
		this._cleanup();
		cb(err);
	};
	ReadStream.prototype._cleanup = function() {
		if (this.context != null) {
			this.context.unref();
			this.context = null;
		}
	};
	util$1.inherits(BufferSlicer, EventEmitter$1);
	function BufferSlicer(buffer) {
		EventEmitter$1.call(this);
		this.refCount = 0;
		this.buffer = buffer;
	}
	BufferSlicer.prototype.read = function(buffer, offset, length, position, callback) {
		if (!(0 <= offset && offset <= buffer.length)) throw new RangeError("offset outside buffer: 0 <= " + offset + " <= " + buffer.length);
		if (position < 0) throw new RangeError("position is negative: " + position);
		if (offset + length > buffer.length) length = buffer.length - offset;
		if (position + length > this.buffer.length) length = this.buffer.length - position;
		if (length <= 0) {
			setImmediate(function() {
				callback(null, 0);
			});
			return;
		}
		this.buffer.copy(buffer, offset, position, position + length);
		setImmediate(function() {
			callback(null, length);
		});
	};
	BufferSlicer.prototype.createReadStream = function(options) {
		options = options || {};
		var readStream = new PassThrough(options);
		readStream.start = options.start || 0;
		readStream.endOffset = options.end;
		readStream.pos = readStream.endOffset || this.buffer.length;
		var entireSlice = this.buffer.slice(readStream.start, readStream.pos);
		var maxChunkSize = 65536;
		var offset = 0;
		while (true) {
			var nextOffset = offset + maxChunkSize;
			if (nextOffset >= entireSlice.length) {
				if (offset < entireSlice.length) readStream.write(entireSlice.slice(offset, entireSlice.length));
				break;
			}
			readStream.write(entireSlice.slice(offset, nextOffset));
			offset = nextOffset;
		}
		readStream.end();
		return readStream;
	};
	BufferSlicer.prototype.ref = function() {
		this.refCount += 1;
	};
	BufferSlicer.prototype.unref = function() {
		this.refCount -= 1;
		if (this.refCount < 0) throw new Error("invalid unref");
	};
}));
//#endregion
//#region node_modules/.pnpm/yauzl@3.4.0/node_modules/yauzl/crc32.js
var require_crc32 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const CRC_TABLE = new Int32Array([
		0,
		1996959894,
		3993919788,
		2567524794,
		124634137,
		1886057615,
		3915621685,
		2657392035,
		249268274,
		2044508324,
		3772115230,
		2547177864,
		162941995,
		2125561021,
		3887607047,
		2428444049,
		498536548,
		1789927666,
		4089016648,
		2227061214,
		450548861,
		1843258603,
		4107580753,
		2211677639,
		325883990,
		1684777152,
		4251122042,
		2321926636,
		335633487,
		1661365465,
		4195302755,
		2366115317,
		997073096,
		1281953886,
		3579855332,
		2724688242,
		1006888145,
		1258607687,
		3524101629,
		2768942443,
		901097722,
		1119000684,
		3686517206,
		2898065728,
		853044451,
		1172266101,
		3705015759,
		2882616665,
		651767980,
		1373503546,
		3369554304,
		3218104598,
		565507253,
		1454621731,
		3485111705,
		3099436303,
		671266974,
		1594198024,
		3322730930,
		2970347812,
		795835527,
		1483230225,
		3244367275,
		3060149565,
		1994146192,
		31158534,
		2563907772,
		4023717930,
		1907459465,
		112637215,
		2680153253,
		3904427059,
		2013776290,
		251722036,
		2517215374,
		3775830040,
		2137656763,
		141376813,
		2439277719,
		3865271297,
		1802195444,
		476864866,
		2238001368,
		4066508878,
		1812370925,
		453092731,
		2181625025,
		4111451223,
		1706088902,
		314042704,
		2344532202,
		4240017532,
		1658658271,
		366619977,
		2362670323,
		4224994405,
		1303535960,
		984961486,
		2747007092,
		3569037538,
		1256170817,
		1037604311,
		2765210733,
		3554079995,
		1131014506,
		879679996,
		2909243462,
		3663771856,
		1141124467,
		855842277,
		2852801631,
		3708648649,
		1342533948,
		654459306,
		3188396048,
		3373015174,
		1466479909,
		544179635,
		3110523913,
		3462522015,
		1591671054,
		702138776,
		2966460450,
		3352799412,
		1504918807,
		783551873,
		3082640443,
		3233442989,
		3988292384,
		2596254646,
		62317068,
		1957810842,
		3939845945,
		2647816111,
		81470997,
		1943803523,
		3814918930,
		2489596804,
		225274430,
		2053790376,
		3826175755,
		2466906013,
		167816743,
		2097651377,
		4027552580,
		2265490386,
		503444072,
		1762050814,
		4150417245,
		2154129355,
		426522225,
		1852507879,
		4275313526,
		2312317920,
		282753626,
		1742555852,
		4189708143,
		2394877945,
		397917763,
		1622183637,
		3604390888,
		2714866558,
		953729732,
		1340076626,
		3518719985,
		2797360999,
		1068828381,
		1219638859,
		3624741850,
		2936675148,
		906185462,
		1090812512,
		3747672003,
		2825379669,
		829329135,
		1181335161,
		3412177804,
		3160834842,
		628085408,
		1382605366,
		3423369109,
		3138078467,
		570562233,
		1426400815,
		3317316542,
		2998733608,
		733239954,
		1555261956,
		3268935591,
		3050360625,
		752459403,
		1541320221,
		2607071920,
		3965973030,
		1969922972,
		40735498,
		2617837225,
		3943577151,
		1913087877,
		83908371,
		2512341634,
		3803740692,
		2075208622,
		213261112,
		2463272603,
		3855990285,
		2094854071,
		198958881,
		2262029012,
		4057260610,
		1759359992,
		534414190,
		2176718541,
		4139329115,
		1873836001,
		414664567,
		2282248934,
		4279200368,
		1711684554,
		285281116,
		2405801727,
		4167216745,
		1634467795,
		376229701,
		2685067896,
		3608007406,
		1308918612,
		956543938,
		2808555105,
		3495958263,
		1231636301,
		1047427035,
		2932959818,
		3654703836,
		1088359270,
		936918e3,
		2847714899,
		3736837829,
		1202900863,
		817233897,
		3183342108,
		3401237130,
		1404277552,
		615818150,
		3134207493,
		3453421203,
		1423857449,
		601450431,
		3009837614,
		3294710456,
		1567103746,
		711928724,
		3020668471,
		3272380065,
		1510334235,
		755167117
	]);
	function crc32(buf) {
		let crc = -1;
		for (let x of buf) crc = CRC_TABLE[(crc ^ x) & 255] ^ crc >>> 8;
		return (crc ^ -1) >>> 0;
	}
	module.exports = crc32;
}));
//#endregion
//#region src/providers/safe-zip.ts
var import_yauzl = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports) => {
	var fs = __require("fs");
	var zlib = __require("zlib");
	var fd_slicer = require_fd_slicer();
	var util = __require("util");
	var EventEmitter = __require("events").EventEmitter;
	var Transform$1 = __require("stream").Transform;
	var PassThrough = __require("stream").PassThrough;
	var Writable$1 = __require("stream").Writable;
	const crc32 = typeof zlib.crc32 === "function" ? zlib.crc32 : require_crc32();
	exports.open = open;
	function open(path, options, callback) {
		if (typeof options === "function") {
			callback = options;
			options = null;
		}
		if (options == null) options = {};
		if (options.autoClose == null) options.autoClose = true;
		if (options.lazyEntries == null) options.lazyEntries = false;
		if (options.decodeStrings == null) options.decodeStrings = true;
		if (options.validateEntrySizes == null) options.validateEntrySizes = true;
		if (options.strictFileNames == null) options.strictFileNames = false;
		if (callback == null) callback = defaultCallback;
		fs.open(path, "r", function(err, fd) {
			if (err) return callback(err);
			fromFd(fd, options, function(err, zipfile) {
				if (err) fs.close(fd, defaultCallback);
				callback(err, zipfile);
			});
		});
	}
	function fromFd(fd, options, callback) {
		if (typeof options === "function") {
			callback = options;
			options = null;
		}
		if (options == null) options = {};
		if (options.autoClose == null) options.autoClose = false;
		if (options.lazyEntries == null) options.lazyEntries = false;
		if (options.decodeStrings == null) options.decodeStrings = true;
		if (options.validateEntrySizes == null) options.validateEntrySizes = true;
		if (options.strictFileNames == null) options.strictFileNames = false;
		if (callback == null) callback = defaultCallback;
		fs.fstat(fd, function(err, stats) {
			if (err) return callback(err);
			fromRandomAccessReader(new fd_slicer.FdSlicer(fd), stats.size, options, callback);
		});
	}
	function fromRandomAccessReader(reader, totalSize, options, callback) {
		if (typeof options === "function") {
			callback = options;
			options = null;
		}
		if (options == null) options = {};
		if (options.autoClose == null) options.autoClose = true;
		if (options.lazyEntries == null) options.lazyEntries = false;
		if (options.decodeStrings == null) options.decodeStrings = true;
		var decodeStrings = !!options.decodeStrings;
		if (options.validateEntrySizes == null) options.validateEntrySizes = true;
		if (options.strictFileNames == null) options.strictFileNames = false;
		if (callback == null) callback = defaultCallback;
		if (typeof totalSize !== "number") throw new Error("expected totalSize parameter to be a number");
		if (totalSize > Number.MAX_SAFE_INTEGER) throw new Error("zip file too large. only file sizes up to 2^52 are supported due to JavaScript's Number type being an IEEE 754 double.");
		reader.ref();
		var eocdrWithoutCommentSize = 22;
		var zip64EocdlSize = 20;
		var bufferSize = Math.min(zip64EocdlSize + eocdrWithoutCommentSize + 65535, totalSize);
		var buffer = newBuffer(bufferSize);
		readAndAssertNoEof(reader, buffer, 0, bufferSize, totalSize - buffer.length, function(err) {
			if (err) return callback(err);
			for (var i = bufferSize - eocdrWithoutCommentSize; i >= 0; i -= 1) {
				if (buffer.readUInt32LE(i) !== 101010256) continue;
				var eocdrBuffer = buffer.subarray(i);
				var diskNumber = eocdrBuffer.readUInt16LE(4);
				var entryCount = eocdrBuffer.readUInt16LE(10);
				var centralDirectoryOffset = eocdrBuffer.readUInt32LE(16);
				var commentLength = eocdrBuffer.readUInt16LE(20);
				var expectedCommentLength = eocdrBuffer.length - eocdrWithoutCommentSize;
				if (commentLength !== expectedCommentLength) return callback(/* @__PURE__ */ new Error("Invalid comment length. Expected: " + expectedCommentLength + ". Found: " + commentLength + ". Are there extra bytes at the end of the file? Or is the end of central dir signature `PK☺☻` in the comment?"));
				var comment = decodeStrings ? decodeBuffer(eocdrBuffer.subarray(22), false) : eocdrBuffer.subarray(22);
				if (i - zip64EocdlSize >= 0 && buffer.readUInt32LE(i - zip64EocdlSize) === 117853008) {
					var zip64EocdrOffset = readUInt64LE(buffer.subarray(i - zip64EocdlSize, i - zip64EocdlSize + zip64EocdlSize), 8);
					var zip64EocdrBuffer = newBuffer(56);
					return readAndAssertNoEof(reader, zip64EocdrBuffer, 0, zip64EocdrBuffer.length, zip64EocdrOffset, function(err) {
						if (err) return callback(err);
						if (zip64EocdrBuffer.readUInt32LE(0) !== 101075792) return callback(/* @__PURE__ */ new Error("invalid zip64 end of central directory record signature"));
						diskNumber = zip64EocdrBuffer.readUInt32LE(16);
						if (diskNumber !== 0) return callback(/* @__PURE__ */ new Error("multi-disk zip files are not supported: found disk number: " + diskNumber));
						entryCount = readUInt64LE(zip64EocdrBuffer, 32);
						centralDirectoryOffset = readUInt64LE(zip64EocdrBuffer, 48);
						return callback(null, new ZipFile(reader, centralDirectoryOffset, totalSize, entryCount, comment, options.autoClose, options.lazyEntries, decodeStrings, options.validateEntrySizes, options.strictFileNames));
					});
				}
				if (diskNumber !== 0) return callback(/* @__PURE__ */ new Error("multi-disk zip files are not supported: found disk number: " + diskNumber));
				return callback(null, new ZipFile(reader, centralDirectoryOffset, totalSize, entryCount, comment, options.autoClose, options.lazyEntries, decodeStrings, options.validateEntrySizes, options.strictFileNames));
			}
			callback(/* @__PURE__ */ new Error("End of central directory record signature not found. Either not a zip file, or file is truncated."));
		});
	}
	util.inherits(ZipFile, EventEmitter);
	function ZipFile(reader, centralDirectoryOffset, fileSize, entryCount, comment, autoClose, lazyEntries, decodeStrings, validateEntrySizes, strictFileNames) {
		var self = this;
		EventEmitter.call(self);
		self.reader = reader;
		self.reader.on("error", function(err) {
			emitError(self, err);
		});
		self.reader.once("close", function() {
			self.emit("close");
		});
		self.readEntryCursor = centralDirectoryOffset;
		self.fileSize = fileSize;
		self.entryCount = entryCount;
		self.comment = comment;
		self.entriesRead = 0;
		self.autoClose = !!autoClose;
		self.lazyEntries = !!lazyEntries;
		self.decodeStrings = !!decodeStrings;
		self.validateEntrySizes = !!validateEntrySizes;
		self.strictFileNames = !!strictFileNames;
		self.isOpen = true;
		self.emittedError = false;
		self.hasEachEntryBeenCalled = false;
		if (!self.lazyEntries) self._readEntry();
	}
	ZipFile.prototype.close = function() {
		if (!this.isOpen) return;
		this.isOpen = false;
		this.reader.unref();
	};
	function emitErrorAndAutoClose(self, err) {
		if (self.autoClose) self.close();
		emitError(self, err);
	}
	function emitError(self, err) {
		if (self.emittedError) return;
		self.emittedError = true;
		self.emit("error", err);
	}
	ZipFile.prototype.readEntry = function() {
		if (!this.lazyEntries) throw new Error("readEntry() called without lazyEntries:true");
		this._readEntry();
	};
	ZipFile.prototype._readEntry = function() {
		var self = this;
		if (self.entryCount === self.entriesRead) {
			setImmediate(function() {
				if (self.autoClose) self.close();
				if (self.emittedError) return;
				self.emit("end");
			});
			return;
		}
		if (self.emittedError) return;
		var buffer = newBuffer(46);
		readAndAssertNoEof(self.reader, buffer, 0, buffer.length, self.readEntryCursor, function(err) {
			if (err) return emitErrorAndAutoClose(self, err);
			if (self.emittedError) return;
			var entry = new Entry();
			var signature = buffer.readUInt32LE(0);
			if (signature !== 33639248) return emitErrorAndAutoClose(self, /* @__PURE__ */ new Error("invalid central directory file header signature: 0x" + signature.toString(16)));
			entry.versionMadeBy = buffer.readUInt16LE(4);
			entry.versionNeededToExtract = buffer.readUInt16LE(6);
			entry.generalPurposeBitFlag = buffer.readUInt16LE(8);
			entry.compressionMethod = buffer.readUInt16LE(10);
			entry.lastModFileTime = buffer.readUInt16LE(12);
			entry.lastModFileDate = buffer.readUInt16LE(14);
			entry.crc32 = buffer.readUInt32LE(16);
			entry.compressedSize = buffer.readUInt32LE(20);
			entry.uncompressedSize = buffer.readUInt32LE(24);
			entry.fileNameLength = buffer.readUInt16LE(28);
			entry.extraFieldLength = buffer.readUInt16LE(30);
			entry.fileCommentLength = buffer.readUInt16LE(32);
			entry.internalFileAttributes = buffer.readUInt16LE(36);
			entry.externalFileAttributes = buffer.readUInt32LE(38);
			entry.relativeOffsetOfLocalHeader = buffer.readUInt32LE(42);
			if (entry.generalPurposeBitFlag & 64) return emitErrorAndAutoClose(self, /* @__PURE__ */ new Error("strong encryption is not supported"));
			self.readEntryCursor += 46;
			buffer = newBuffer(entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength);
			readAndAssertNoEof(self.reader, buffer, 0, buffer.length, self.readEntryCursor, function(err) {
				if (err) return emitErrorAndAutoClose(self, err);
				if (self.emittedError) return;
				entry.fileNameRaw = buffer.subarray(0, entry.fileNameLength);
				var fileCommentStart = entry.fileNameLength + entry.extraFieldLength;
				entry.extraFieldRaw = buffer.subarray(entry.fileNameLength, fileCommentStart);
				entry.fileCommentRaw = buffer.subarray(fileCommentStart, fileCommentStart + entry.fileCommentLength);
				try {
					entry.extraFields = parseExtraFields(entry.extraFieldRaw);
				} catch (err) {
					return emitErrorAndAutoClose(self, err);
				}
				if (self.decodeStrings) {
					var isUtf8 = (entry.generalPurposeBitFlag & 2048) !== 0;
					entry.fileComment = decodeBuffer(entry.fileCommentRaw, isUtf8);
					entry.fileName = getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, entry.extraFields, self.strictFileNames);
					var errorMessage = validateFileName(entry.fileName);
					if (errorMessage != null) return emitErrorAndAutoClose(self, new Error(errorMessage));
				} else {
					entry.fileComment = entry.fileCommentRaw;
					entry.fileName = entry.fileNameRaw;
				}
				entry.comment = entry.fileComment;
				self.readEntryCursor += buffer.length;
				self.entriesRead += 1;
				for (var i = 0; i < entry.extraFields.length; i++) {
					var extraField = entry.extraFields[i];
					if (extraField.id !== 1) continue;
					var zip64EiefBuffer = extraField.data;
					var index = 0;
					if (entry.uncompressedSize === 4294967295) {
						if (index + 8 > zip64EiefBuffer.length) return emitErrorAndAutoClose(self, /* @__PURE__ */ new Error("zip64 extended information extra field does not include uncompressed size"));
						entry.uncompressedSize = readUInt64LE(zip64EiefBuffer, index);
						index += 8;
					}
					if (entry.compressedSize === 4294967295) {
						if (index + 8 > zip64EiefBuffer.length) return emitErrorAndAutoClose(self, /* @__PURE__ */ new Error("zip64 extended information extra field does not include compressed size"));
						entry.compressedSize = readUInt64LE(zip64EiefBuffer, index);
						index += 8;
					}
					if (entry.relativeOffsetOfLocalHeader === 4294967295) {
						if (index + 8 > zip64EiefBuffer.length) return emitErrorAndAutoClose(self, /* @__PURE__ */ new Error("zip64 extended information extra field does not include relative header offset"));
						entry.relativeOffsetOfLocalHeader = readUInt64LE(zip64EiefBuffer, index);
						index += 8;
					}
					break;
				}
				if (self.validateEntrySizes && entry.compressionMethod === 0) {
					var expectedCompressedSize = entry.uncompressedSize;
					if (entry.isEncrypted()) expectedCompressedSize += 12;
					if (entry.compressedSize !== expectedCompressedSize) {
						var msg = "compressed/uncompressed size mismatch for stored file: " + entry.compressedSize + " != " + entry.uncompressedSize;
						return emitErrorAndAutoClose(self, new Error(msg));
					}
				}
				self.emit("entry", entry);
				if (!self.lazyEntries) self._readEntry();
			});
		});
	};
	ZipFile.prototype.eachEntry = function() {
		const self = this;
		if (!self.lazyEntries) throw new Error("eachEntry() requires lazyEntries: true");
		if (self.hasEachEntryBeenCalled) throw new Error("eachEntry() must only be called once per ZipFile");
		self.hasEachEntryBeenCalled = true;
		let pendingResolveReject = null;
		self.on("entry", onEntry);
		self.on("end", onEnd);
		self.on("error", onError);
		function cleanup() {
			self.removeListener("entry", onEntry);
			self.removeListener("end", onEnd);
			self.removeListener("error", onError);
			if (self.autoClose) self.close();
		}
		function onEntry(entry) {
			let { resolve } = pendingResolveReject;
			pendingResolveReject = null;
			resolve({ value: entry });
		}
		function onEnd() {
			let { resolve } = pendingResolveReject;
			pendingResolveReject = null;
			cleanup();
			resolve({ done: true });
		}
		function onError(err) {
			let { reject } = pendingResolveReject;
			pendingResolveReject = null;
			cleanup();
			reject(err);
		}
		return {
			[Symbol.asyncIterator]() {
				return this;
			},
			next() {
				const promise = new Promise((resolve, reject) => {
					if (pendingResolveReject != null) throw new Error("next() called before previous Promise was resolved.");
					pendingResolveReject = {
						resolve,
						reject
					};
				});
				self.readEntry();
				return promise;
			},
			return(value) {
				cleanup();
				return Promise.resolve({
					done: true,
					value
				});
			},
			throw(value) {
				cleanup();
				return Promise.reject(value);
			}
		};
	};
	ZipFile.prototype.openReadStream = function(entry, options, callback) {
		var self = this;
		var relativeStart = 0;
		var relativeEnd = entry.compressedSize;
		if (callback == null) {
			callback = options;
			options = null;
		}
		if (options == null) options = {};
		else {
			if (options.decodeFileData === false) {
				if (options.decrypt != null) throw new Error("cannot use options.decrypt when options.decodeFileData === false");
				if (options.decompress != null) throw new Error("cannot use options.decompress when options.decodeFileData === false");
			} else {
				if (options.decrypt != null) {
					if (!entry.isEncrypted()) throw new Error("options.decrypt can only be specified for encrypted entries. See also option decodeFileData.");
					if (options.decrypt !== false) throw new Error("invalid options.decrypt value: " + options.decrypt);
					if (entry.isCompressed()) {
						if (options.decompress !== false) throw new Error("entry is encrypted and compressed, and options.decompress !== false. See also option decodeFileData.");
					}
				}
				if (options.decompress != null) {
					if (!entry.isCompressed()) throw new Error("options.decompress can only be specified for compressed entries. See also option decodeFileData.");
					if (!(options.decompress === false || options.decompress === true)) throw new Error("invalid options.decompress value: " + options.decompress);
					decompress = options.decompress;
				}
			}
			if (options.start != null) {
				relativeStart = options.start;
				if (relativeStart < 0) throw new Error("options.start < 0");
				if (relativeStart > entry.compressedSize) throw new Error("options.start > entry.compressedSize");
			}
			if (options.end != null) {
				relativeEnd = options.end;
				if (relativeEnd < 0) throw new Error("options.end < 0");
				if (relativeEnd > entry.compressedSize) throw new Error("options.end > entry.compressedSize");
				if (relativeEnd < relativeStart) throw new Error("options.end < options.start");
			}
		}
		var rawMode = options.decodeFileData === false || (entry.compressionMethod === 0 || entry.compressionMethod === 8 && options.decompress === false) && (!entry.isEncrypted() || options.decrypt === false);
		if (options.start != null || options.end != null) {
			if (!rawMode) throw new Error("start/end range require options.decodeFileData === false for non-trivial encoded entries.");
		}
		if (!self.isOpen) return callback(/* @__PURE__ */ new Error("closed"));
		if (entry.isEncrypted() && !rawMode) {
			if (options.decrypt !== false) return callback(/* @__PURE__ */ new Error("entry is encrypted, and options.decodeFileData !== false"));
		}
		var decompress;
		if (rawMode) decompress = false;
		else if (entry.compressionMethod === 8) decompress = options.decodeFileData !== true;
		else return callback(/* @__PURE__ */ new Error("unsupported compression method: " + entry.compressionMethod));
		self.readLocalFileHeader(entry, { minimal: true }, function(err, localFileHeader) {
			if (err) return callback(err);
			self.openReadStreamLowLevel(localFileHeader.fileDataStart, entry.compressedSize, relativeStart, relativeEnd, decompress, entry.uncompressedSize, callback);
		});
	};
	ZipFile.prototype.openReadStreamLowLevel = function(fileDataStart, compressedSize, relativeStart, relativeEnd, decompress, uncompressedSize, callback) {
		var self = this;
		fileDataStart + compressedSize;
		var readStream = self.reader.createReadStream({
			start: fileDataStart + relativeStart,
			end: fileDataStart + relativeEnd
		});
		var endpointStream = readStream;
		if (decompress) {
			var destroyed = false;
			var inflateFilter = zlib.createInflateRaw();
			readStream.on("error", function(err) {
				setImmediate(function() {
					if (!destroyed) inflateFilter.emit("error", err);
				});
			});
			readStream.pipe(inflateFilter);
			if (self.validateEntrySizes) {
				endpointStream = new AssertByteCountStream(uncompressedSize);
				inflateFilter.on("error", function(err) {
					setImmediate(function() {
						if (!destroyed) endpointStream.emit("error", err);
					});
				});
				inflateFilter.pipe(endpointStream);
			} else endpointStream = inflateFilter;
			installDestroyFn(endpointStream, function() {
				destroyed = true;
				if (inflateFilter !== endpointStream) inflateFilter.unpipe(endpointStream);
				readStream.unpipe(inflateFilter);
				readStream.destroy();
			});
		}
		callback(null, endpointStream);
	};
	ZipFile.prototype.readLocalFileHeader = function(entry, options, callback) {
		var self = this;
		if (callback == null) {
			callback = options;
			options = null;
		}
		if (options == null) options = {};
		self.reader.ref();
		var buffer = newBuffer(30);
		readAndAssertNoEof(self.reader, buffer, 0, buffer.length, entry.relativeOffsetOfLocalHeader, function(err) {
			try {
				if (err) return callback(err);
				var signature = buffer.readUInt32LE(0);
				if (signature !== 67324752) return callback(/* @__PURE__ */ new Error("invalid local file header signature: 0x" + signature.toString(16)));
				var fileNameLength = buffer.readUInt16LE(26);
				var extraFieldLength = buffer.readUInt16LE(28);
				var fileDataStart = entry.relativeOffsetOfLocalHeader + 30 + fileNameLength + extraFieldLength;
				if (fileDataStart + entry.compressedSize > self.fileSize) return callback(/* @__PURE__ */ new Error("file data overflows file bounds: " + fileDataStart + " + " + entry.compressedSize + " > " + self.fileSize));
				if (options.minimal) return callback(null, { fileDataStart });
				var localFileHeader = new LocalFileHeader();
				localFileHeader.fileDataStart = fileDataStart;
				localFileHeader.versionNeededToExtract = buffer.readUInt16LE(4);
				localFileHeader.generalPurposeBitFlag = buffer.readUInt16LE(6);
				localFileHeader.compressionMethod = buffer.readUInt16LE(8);
				localFileHeader.lastModFileTime = buffer.readUInt16LE(10);
				localFileHeader.lastModFileDate = buffer.readUInt16LE(12);
				localFileHeader.crc32 = buffer.readUInt32LE(14);
				localFileHeader.compressedSize = buffer.readUInt32LE(18);
				localFileHeader.uncompressedSize = buffer.readUInt32LE(22);
				localFileHeader.fileNameLength = fileNameLength;
				localFileHeader.extraFieldLength = extraFieldLength;
				buffer = newBuffer(fileNameLength + extraFieldLength);
				self.reader.ref();
				readAndAssertNoEof(self.reader, buffer, 0, buffer.length, entry.relativeOffsetOfLocalHeader + 30, function(err) {
					try {
						if (err) return callback(err);
						localFileHeader.fileName = buffer.subarray(0, fileNameLength);
						localFileHeader.extraField = buffer.subarray(fileNameLength);
						return callback(null, localFileHeader);
					} finally {
						self.reader.unref();
					}
				});
			} finally {
				self.reader.unref();
			}
		});
	};
	ZipFile.prototype.openReadStreamPromise = function(entry, options) {
		return new Promise((resolve, reject) => {
			this.openReadStream(entry, options, function(err, readStream) {
				if (err) return reject(err);
				resolve(readStream);
			});
		});
	};
	ZipFile.prototype.openReadStreamLowLevelPromise = function(fileDataStart, compressedSize, relativeStart, relativeEnd, decompress, uncompressedSize) {
		return new Promise((resolve, reject) => {
			this.openReadStream(fileDataStart, compressedSize, relativeStart, relativeEnd, decompress, uncompressedSize, function(err, readStream) {
				if (err) return reject(err);
				resolve(readStream);
			});
		});
	};
	ZipFile.prototype.readLocalFileHeaderPromise = function(entry, options) {
		return new Promise((resolve, reject) => {
			this.readLocalFileHeader(entry, options, function(err, localFileHeader) {
				if (err) return reject(err);
				resolve(localFileHeader);
			});
		});
	};
	function Entry() {}
	Entry.prototype.getLastModDate = function(options) {
		if (options == null) options = {};
		if (!options.forceDosFormat) for (var i = 0; i < this.extraFields.length; i++) {
			var extraField = this.extraFields[i];
			if (extraField.id === 21589) {
				var data = extraField.data;
				if (data.length < 5) continue;
				if (!(data[0] & 1)) continue;
				var posixTimestamp = data.readInt32LE(1);
				return /* @__PURE__ */ new Date(posixTimestamp * 1e3);
			} else if (extraField.id === 10) {
				var data = extraField.data;
				if (data.length !== 32) continue;
				if (data.readUInt16LE(4) !== 1) continue;
				if (data.readUInt16LE(6) !== 24) continue;
				var millisecondsSince1970 = (data.readUInt32LE(8) + 4294967296 * data.readInt32LE(12)) / 1e4 - 0xa9730b66800;
				return new Date(millisecondsSince1970);
			}
		}
		return dosDateTimeToDate(this.lastModFileDate, this.lastModFileTime, options.timezone);
	};
	Entry.prototype.canDecodeFileData = function() {
		return !this.isEncrypted() && (this.compressionMethod === 0 || this.compressionMethod === 8);
	};
	Entry.prototype.isEncrypted = function() {
		return (this.generalPurposeBitFlag & 1) !== 0;
	};
	Entry.prototype.isCompressed = function() {
		return this.compressionMethod === 8;
	};
	function LocalFileHeader() {}
	function dosDateTimeToDate(date, time, timezone) {
		var day = date & 31;
		var month = (date >> 5 & 15) - 1;
		var year = (date >> 9 & 127) + 1980;
		var millisecond = 0;
		var second = (time & 31) * 2;
		var minute = time >> 5 & 63;
		var hour = time >> 11 & 31;
		if (timezone == null || timezone === "local") return new Date(year, month, day, hour, minute, second, millisecond);
		else if (timezone === "UTC") return new Date(Date.UTC(year, month, day, hour, minute, second, millisecond));
		else throw new Error("unrecognized options.timezone: " + options.timezone);
	}
	function getFileNameLowLevel(generalPurposeBitFlag, fileNameBuffer, extraFields, strictFileNames) {
		var fileName = null;
		for (var i = 0; i < extraFields.length; i++) {
			var extraField = extraFields[i];
			if (extraField.id === 28789) {
				if (extraField.data.length < 6) continue;
				if (extraField.data.readUInt8(0) !== 1) continue;
				var oldNameCrc32 = extraField.data.readUInt32LE(1);
				if (crc32(fileNameBuffer) !== oldNameCrc32) continue;
				fileName = decodeBuffer(extraField.data.subarray(5), true);
				break;
			}
		}
		if (fileName == null) fileName = decodeBuffer(fileNameBuffer, (generalPurposeBitFlag & 2048) !== 0);
		if (!strictFileNames) fileName = fileName.replace(/\\/g, "/");
		return fileName;
	}
	function validateFileName(fileName) {
		if (fileName.indexOf("\\") !== -1) return "invalid characters in fileName: " + fileName;
		if (/^[a-zA-Z]:/.test(fileName) || /^\//.test(fileName)) return "absolute path: " + fileName;
		if (fileName.split("/").indexOf("..") !== -1) return "invalid relative path: " + fileName;
		return null;
	}
	function parseExtraFields(extraFieldBuffer) {
		var extraFields = [];
		var i = 0;
		while (i < extraFieldBuffer.length - 3) {
			var headerId = extraFieldBuffer.readUInt16LE(i + 0);
			var dataSize = extraFieldBuffer.readUInt16LE(i + 2);
			var dataStart = i + 4;
			var dataEnd = dataStart + dataSize;
			if (dataEnd > extraFieldBuffer.length) throw new Error("extra field length exceeds extra field buffer size");
			var dataBuffer = extraFieldBuffer.subarray(dataStart, dataEnd);
			extraFields.push({
				id: headerId,
				data: dataBuffer
			});
			i = dataEnd;
		}
		return extraFields;
	}
	function readAndAssertNoEof(reader, buffer, offset, length, position, callback) {
		if (length === 0) return setImmediate(function() {
			callback(null, newBuffer(0));
		});
		reader.read(buffer, offset, length, position, function(err, bytesRead) {
			if (err) return callback(err);
			if (bytesRead < length) return callback(/* @__PURE__ */ new Error("unexpected EOF"));
			callback();
		});
	}
	util.inherits(AssertByteCountStream, Transform$1);
	function AssertByteCountStream(byteCount) {
		Transform$1.call(this);
		this.actualByteCount = 0;
		this.expectedByteCount = byteCount;
	}
	AssertByteCountStream.prototype._transform = function(chunk, encoding, cb) {
		this.actualByteCount += chunk.length;
		if (this.actualByteCount > this.expectedByteCount) {
			var msg = "too many bytes in the stream. expected " + this.expectedByteCount + ". got at least " + this.actualByteCount;
			return cb(new Error(msg));
		}
		cb(null, chunk);
	};
	AssertByteCountStream.prototype._flush = function(cb) {
		if (this.actualByteCount < this.expectedByteCount) {
			var msg = "not enough bytes in the stream. expected " + this.expectedByteCount + ". got only " + this.actualByteCount;
			return cb(new Error(msg));
		}
		cb();
	};
	util.inherits(RandomAccessReader, EventEmitter);
	function RandomAccessReader() {
		EventEmitter.call(this);
		this.refCount = 0;
	}
	RandomAccessReader.prototype.ref = function() {
		this.refCount += 1;
	};
	RandomAccessReader.prototype.unref = function() {
		var self = this;
		self.refCount -= 1;
		if (self.refCount > 0) return;
		if (self.refCount < 0) throw new Error("invalid unref");
		self.close(onCloseDone);
		function onCloseDone(err) {
			if (err) return self.emit("error", err);
			self.emit("close");
		}
	};
	RandomAccessReader.prototype.createReadStream = function(options) {
		if (options == null) options = {};
		var start = options.start;
		var end = options.end;
		if (start === end) {
			var emptyStream = new PassThrough();
			setImmediate(function() {
				emptyStream.end();
			});
			return emptyStream;
		}
		var stream = this._readStreamForRange(start, end);
		var destroyed = false;
		var refUnrefFilter = new RefUnrefFilter(this);
		stream.on("error", function(err) {
			setImmediate(function() {
				if (!destroyed) refUnrefFilter.emit("error", err);
			});
		});
		installDestroyFn(refUnrefFilter, function() {
			stream.unpipe(refUnrefFilter);
			refUnrefFilter.unref();
			stream.destroy();
		});
		var byteCounter = new AssertByteCountStream(end - start);
		refUnrefFilter.on("error", function(err) {
			setImmediate(function() {
				if (!destroyed) byteCounter.emit("error", err);
			});
		});
		installDestroyFn(byteCounter, function() {
			destroyed = true;
			refUnrefFilter.unpipe(byteCounter);
			refUnrefFilter.destroy();
		});
		return stream.pipe(refUnrefFilter).pipe(byteCounter);
	};
	RandomAccessReader.prototype._readStreamForRange = function(start, end) {
		throw new Error("not implemented");
	};
	RandomAccessReader.prototype.read = function(buffer, offset, length, position, callback) {
		var readStream = this.createReadStream({
			start: position,
			end: position + length
		});
		var writeStream = new Writable$1();
		var written = 0;
		writeStream._write = function(chunk, encoding, cb) {
			chunk.copy(buffer, offset + written, 0, chunk.length);
			written += chunk.length;
			cb();
		};
		writeStream.on("finish", callback);
		readStream.on("error", function(error) {
			callback(error);
		});
		readStream.pipe(writeStream);
	};
	RandomAccessReader.prototype.close = function(callback) {
		setImmediate(callback);
	};
	util.inherits(RefUnrefFilter, PassThrough);
	function RefUnrefFilter(context) {
		PassThrough.call(this);
		this.context = context;
		this.context.ref();
		this.unreffedYet = false;
	}
	RefUnrefFilter.prototype._flush = function(cb) {
		this.unref();
		cb();
	};
	RefUnrefFilter.prototype.unref = function(cb) {
		if (this.unreffedYet) return;
		this.unreffedYet = true;
		this.context.unref();
	};
	var cp437 = "\0☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xA0";
	function decodeBuffer(buffer, isUtf8) {
		if (isUtf8) return buffer.toString("utf8");
		else {
			var result = "";
			for (var i = 0; i < buffer.length; i++) result += cp437[buffer[i]];
			return result;
		}
	}
	function readUInt64LE(buffer, offset) {
		var lower32 = buffer.readUInt32LE(offset);
		return buffer.readUInt32LE(offset + 4) * 4294967296 + lower32;
	}
	var newBuffer;
	if (typeof Buffer.allocUnsafe === "function") newBuffer = function(len) {
		return Buffer.allocUnsafe(len);
	};
	else newBuffer = function(len) {
		return new Buffer(len);
	};
	function installDestroyFn(stream, fn) {
		if (typeof stream.destroy === "function") stream._destroy = function(err, cb) {
			fn();
			if (cb != null) cb(err);
		};
		else stream.destroy = fn;
	}
	function defaultCallback(err) {
		if (err) throw err;
	}
})))(), 1);
const MAX_JSON_VALIDATION_BYTES = 67108864;
const IMAGE_MIME = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".bmp": "image/bmp",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".tif": "image/tiff",
	".tiff": "image/tiff"
};
function archiveError(message) {
	return new MinerUError(failure("RESULT_ARCHIVE_INVALID", message));
}
function assertNotAborted(signal, action) {
	if (signal.aborted) throw new MinerUError(failure("CANCELLED", `${action} was cancelled`, true));
}
function validateEntrySecurity(entry, limits) {
	if (entry.isEncrypted()) throw archiveError("Encrypted ZIP entries are not supported");
	const type = entry.externalFileAttributes >> 16 & 61440;
	const directory = entry.fileName.endsWith("/");
	if (type === 40960) throw archiveError("Symbolic links inside ZIP archives are prohibited");
	if (type !== 0 && type !== 32768 && !(directory && type === 16384)) throw archiveError("Non-regular ZIP entries are prohibited");
	const name = entry.fileName;
	const raw = entry.fileNameRaw;
	if (name.includes("\0") || raw?.includes(0)) throw archiveError("Entry path contains NUL byte");
	if (name.includes("\\") || raw?.includes(92)) throw archiveError("Entry path contains backslash separator");
	if (/^[A-Za-z]:/.test(name)) throw archiveError("Entry path contains Windows drive prefix");
	if (name.startsWith("/") || name.startsWith("./") || name.startsWith("../")) throw archiveError("Entry path is absolute or begins with traversal prefix");
	for (const segment of name.split("/")) if (segment === "." || segment === "..") throw archiveError("Entry path contains traversal segment");
	if (entry.uncompressedSize > limits.maxZipEntryBytes) throw new MinerUError(failure("RESULT_TOO_LARGE", `ZIP entry ${name} exceeds the entry byte limit`));
	if (entry.uncompressedSize > 0 && entry.compressedSize === 0) throw archiveError(`ZIP entry ${name} has an invalid zero compressed size`);
	if (entry.uncompressedSize > 65536 && entry.uncompressedSize / Math.max(1, entry.compressedSize) > limits.maxZipCompressionRatio) throw archiveError(`ZIP entry ${name} exceeds the compression ratio limit`);
}
function openZip(path) {
	return new Promise((resolve, reject) => {
		import_yauzl.open(path, {
			lazyEntries: true,
			autoClose: false,
			decodeStrings: true,
			strictFileNames: false,
			validateEntrySizes: true
		}, (error, zip) => {
			if (error !== null || zip === void 0) reject(new MinerUError(failure("RESULT_ARCHIVE_INVALID", `Failed to open ZIP: ${error?.message ?? "unknown error"}`), { cause: error ?? void 0 }));
			else resolve(zip);
		});
	});
}
function scanZip(path, limits, signal) {
	assertNotAborted(signal, "ZIP scan");
	return openZip(path).then((zip) => new Promise((resolve, reject) => {
		const entries = [];
		let declaredTotal = 0;
		let settled = false;
		const finish = (error) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			try {
				zip.close();
			} catch {}
			if (error === void 0) resolve(entries);
			else reject(error);
		};
		const onAbort = () => finish(new MinerUError(failure("CANCELLED", "ZIP scan was cancelled", true)));
		signal.addEventListener("abort", onAbort, { once: true });
		zip.on("entry", (entry) => {
			if (settled) return;
			try {
				if (entries.length + 1 > limits.maxZipEntries) throw archiveError("ZIP entries count exceeds configured limit");
				validateEntrySecurity(entry, limits);
				declaredTotal += entry.uncompressedSize;
				if (declaredTotal > limits.maxZipTotalBytes) throw new MinerUError(failure("RESULT_TOO_LARGE", "ZIP declared uncompressed total exceeds configured limit"));
				entries.push({
					fileName: entry.fileName,
					directory: entry.fileName.endsWith("/"),
					compressedBytes: entry.compressedSize,
					uncompressedBytes: entry.uncompressedSize
				});
				zip.readEntry();
			} catch (error) {
				finish(error);
			}
		});
		zip.once("end", () => finish());
		zip.once("error", (error) => finish(archiveError(`ZIP parsing error: ${error.message}`)));
		zip.readEntry();
	}));
}
function classify(subpath) {
	const normalized = posix.normalize(subpath);
	const base = posix.basename(normalized).toLowerCase();
	if (normalized.startsWith("images/")) {
		const extension = extname(base).toLowerCase();
		const mediaType = IMAGE_MIME[extension];
		if (mediaType === void 0) return void 0;
		return {
			kind: "images",
			relativeName: `images/${normalized.slice(7).replaceAll("/", "_").replace(/[^A-Za-z0-9_.-]/g, "_") || "image.bin"}`,
			mediaType,
			json: false
		};
	}
	if (base === "full.md") return {
		kind: "markdown",
		relativeName: "full.md",
		mediaType: "text/markdown; charset=utf-8",
		json: false
	};
	if (base === "layout.json" || base === "middle.json" || base.endsWith("_layout.json")) return {
		kind: "layout",
		relativeName: "layout.json",
		mediaType: "application/json",
		json: true
	};
	if (base === "content_list.json" || base.endsWith("_content_list.json")) return {
		kind: "content-list",
		relativeName: "content_list.json",
		mediaType: "application/json",
		json: true
	};
	if (base === "model.json" || base.endsWith("_model.json")) return {
		kind: "model-output",
		relativeName: "model.json",
		mediaType: "application/json",
		json: true
	};
}
function structuredArchive(entries, files) {
	const prefixes = new Set(files.flatMap((file) => [file.dataId, String(file.fileId)]));
	return entries.some((entry) => prefixes.has(entry.fileName.split("/")[0] ?? ""));
}
function targetsForEntry(name, files, structured) {
	if (structured) {
		const slash = name.indexOf("/");
		if (slash <= 0) return [];
		const prefix = name.slice(0, slash);
		const file = files.find((candidate) => candidate.dataId === prefix || candidate.fileId === prefix);
		return file === void 0 ? [] : [{
			file,
			subpath: name.slice(slash + 1)
		}];
	}
	if (name.includes("/") && !name.startsWith("images/")) return [];
	return files.map((file) => ({
		file,
		subpath: name
	}));
}
function assertUniqueArtifactOutputs(entries, files, requiredArtifacts) {
	const structured = structuredArchive(entries, files);
	const outputs = /* @__PURE__ */ new Set();
	for (const entry of entries) {
		if (entry.directory) continue;
		for (const target of targetsForEntry(entry.fileName, files, structured)) {
			const classification = classify(target.subpath);
			if (classification === void 0 || !requiredArtifacts.includes(classification.kind)) continue;
			const key = `${target.file.fileId}:${classification.relativeName}`;
			if (outputs.has(key)) throw archiveError(`ZIP entries collide on normalized artifact ${classification.relativeName}`);
			outputs.add(key);
		}
	}
}
function openEntryStream(zip, entry) {
	return new Promise((resolve, reject) => {
		zip.openReadStream(entry, (error, stream) => {
			if (error !== null || stream === void 0) reject(archiveError(`Failed to read ZIP entry ${entry.fileName}`));
			else resolve(stream);
		});
	});
}
function extractionTracker(entry, limits, totals) {
	let entryBytes = 0;
	return new Transform({ transform(chunk, _encoding, callback) {
		entryBytes += chunk.byteLength;
		totals.bytes += chunk.byteLength;
		if (entryBytes > limits.maxZipEntryBytes) return callback(new MinerUError(failure("RESULT_TOO_LARGE", "ZIP entry exceeded actual byte limit")));
		if (totals.bytes > limits.maxZipTotalBytes) return callback(new MinerUError(failure("RESULT_TOO_LARGE", "ZIP actual uncompressed total exceeded limit")));
		if (entry.compressedSize > 0 && entryBytes > 65536 && entryBytes / entry.compressedSize > limits.maxZipCompressionRatio) return callback(archiveError("ZIP entry exceeded streaming compression ratio limit"));
		callback(null, chunk);
	} });
}
async function validateJsonFile(path, maxBytes = MAX_JSON_VALIDATION_BYTES, signal) {
	signal?.throwIfAborted();
	if ((await stat(path)).size > maxBytes) throw new MinerUError(failure("RESULT_TOO_LARGE", "JSON ZIP artifact exceeds validation limit"));
	signal?.throwIfAborted();
	let content;
	try {
		content = await readFile(path, "utf8");
	} catch (error) {
		if (signal?.aborted) throw signal.reason ?? error;
		throw error;
	}
	signal?.throwIfAborted();
	try {
		JSON.parse(content);
	} catch (error) {
		if (signal?.aborted) throw signal.reason ?? error;
		throw new MinerUError(failure("RESULT_ARCHIVE_INVALID", "Invalid JSON artifact in archive"), { cause: error });
	}
}
async function consumeZip(options, metadata, onArtifact) {
	const zip = await openZip(options.zipPath);
	const totals = { bytes: 0 };
	const structured = structuredArchive(metadata, options.files);
	let index = 0;
	await new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error) => {
			if (settled) return;
			settled = true;
			options.signal.removeEventListener("abort", onAbort);
			try {
				zip.close();
			} catch {}
			if (error === void 0) resolve();
			else reject(error);
		};
		const onAbort = () => finish(new MinerUError(failure("CANCELLED", "ZIP extraction was cancelled", true)));
		options.signal.addEventListener("abort", onAbort, { once: true });
		zip.on("entry", (entry) => {
			if (settled) return;
			const currentIndex = index++;
			(async () => {
				validateEntrySecurity(entry, options.limits);
				if (entry.fileName.endsWith("/")) return;
				const classified = targetsForEntry(entry.fileName, options.files, structured).map((target) => ({
					target,
					classification: classify(target.subpath)
				})).filter((item) => item.classification !== void 0).filter((item) => options.requiredArtifacts.includes(item.classification.kind));
				const input = await openEntryStream(zip, entry);
				const tracker = extractionTracker(entry, options.limits, totals);
				if (classified.length === 0) {
					await pipeline(input, tracker, new Writable({ write(_chunk, _encoding, callback) {
						callback();
					} }), { signal: options.signal });
					return;
				}
				const tempPath = join(dirname(options.zipPath), `.entry_${String(currentIndex)}_${randomUUID().replaceAll("-", "")}`);
				try {
					await pipeline(input, tracker, createWriteStream(tempPath, {
						flags: "wx",
						mode: 384
					}), { signal: options.signal });
					if (classified.some((item) => item.classification.json)) await validateJsonFile(tempPath, MAX_JSON_VALIDATION_BYTES, options.signal);
					for (const item of classified) await onArtifact(item.target, item.classification, tempPath);
				} finally {
					await rm(tempPath, { force: true });
				}
			})().then(() => {
				if (!settled) zip.readEntry();
			}, finish);
		});
		zip.once("end", () => finish());
		zip.once("error", (error) => finish(archiveError(`ZIP extraction error: ${error.message}`)));
		zip.readEntry();
	});
}
async function extractSafeZip(options) {
	assertNotAborted(options.signal, "ZIP extraction");
	const metadata = await scanZip(options.zipPath, options.limits, options.signal);
	assertUniqueArtifactOutputs(metadata, options.files, options.requiredArtifacts);
	const artifacts = /* @__PURE__ */ new Map();
	const kinds = /* @__PURE__ */ new Map();
	for (const file of options.files) {
		artifacts.set(file.fileId, []);
		kinds.set(file.fileId, /* @__PURE__ */ new Set());
	}
	await consumeZip(options, metadata, async (target, classification, tempPath) => {
		const ref = await options.sink.writeArtifact(target.file.fileId, classification.kind, createReadStream(tempPath), {
			mediaType: classification.mediaType,
			relativeName: classification.relativeName,
			maxBytes: options.limits.maxZipEntryBytes
		});
		artifacts.get(target.file.fileId)?.push(ref);
		kinds.get(target.file.fileId)?.add(classification.kind);
	});
	const results = [];
	for (const file of options.files) {
		options.signal.throwIfAborted();
		const fileArtifacts = artifacts.get(file.fileId) ?? [];
		const fileKinds = kinds.get(file.fileId) ?? /* @__PURE__ */ new Set();
		if (options.requiredArtifacts.includes("images") && !fileKinds.has("images")) {
			fileArtifacts.push(await options.sink.writeArtifact(file.fileId, "images", JSON.stringify({ images: [] }), {
				mediaType: "application/json",
				relativeName: "images/index.json",
				maxBytes: options.limits.maxZipEntryBytes
			}));
			fileKinds.add("images");
		}
		const missing = options.requiredArtifacts.filter((kind) => !fileKinds.has(kind));
		results.push({
			fileId: file.fileId,
			name: file.name,
			artifacts: fileArtifacts,
			...missing.length === 0 ? {} : { failure: failure("REMOTE_PARSE_FAILED", `ZIP is missing required artifacts: ${missing.join(", ")}`, false, {
				provider: "official-v4",
				fileId: file.fileId
			}) }
		});
	}
	return results;
}
//#endregion
//#region src/providers/official-v4.ts
function validateAndNormalizeOfficialBaseURL(rawUrl) {
	if (typeof rawUrl !== "string" || rawUrl.trim() === "") throw new MinerUError(failure("INVALID_REQUEST", "Official v4 baseURL must be a non-empty string"));
	let parsed;
	try {
		parsed = new URL(rawUrl);
	} catch (err) {
		throw new MinerUError(failure("INVALID_REQUEST", `Invalid provider baseURL: "${sanitizeDiagnostic(rawUrl)}"`), { cause: err });
	}
	if (parsed.protocol !== "https:") throw new MinerUError(failure("INVALID_REQUEST", "Official v4 baseURL must use HTTPS"));
	if (parsed.username || parsed.password) throw new MinerUError(failure("INVALID_REQUEST", "Provider baseURL must not contain embedded credentials"));
	if (parsed.search || parsed.hash) throw new MinerUError(failure("INVALID_REQUEST", "Provider baseURL must not contain query parameters or fragments"));
	return parsed;
}
function mapOfficialFileState(rawState) {
	if (typeof rawState !== "string") throw new MinerUError(failure("REMOTE_PARSE_FAILED", "Official result is missing file state"));
	switch (rawState.toLowerCase()) {
		case "waiting-file":
		case "pending":
		case "queued": return "queued";
		case "running":
		case "converting":
		case "processing": return "processing";
		case "done":
		case "completed":
		case "success": return "completed";
		case "failed":
		case "error": return "failed";
		default: throw new MinerUError(failure("REMOTE_PARSE_FAILED", `Unknown official file state: ${sanitizeDiagnostic(rawState)}`, false, { provider: "official-v4" }));
	}
}
function isMissingBatchProbeSentinel(code, message) {
	const normalizedCode = String(code).toUpperCase();
	if (normalizedCode === "BATCH_NOT_FOUND") return true;
	return (normalizedCode === "-500" || normalizedCode === "-60012") && /^task not found or expire(?:d)?[.!]?$/i.test(message.trim());
}
function officialBusinessFailure(code, message, traceId) {
	const providerCode = String(code);
	const normalized = providerCode.toUpperCase();
	const details = {
		provider: "official-v4",
		providerCode,
		...traceId === void 0 ? {} : { traceId }
	};
	if (normalized === "A0202" || normalized === "A0211" || normalized === "401") return new MinerUError(failure("AUTHENTICATION_FAILED", message, false, details));
	if (normalized === "-60018" || normalized === "-60019") return new MinerUError(failure("PROVIDER_QUOTA_EXHAUSTED", message, false, details));
	if (normalized === "-60005") return new MinerUError(failure("FILE_TOO_LARGE", message, false, details));
	if (normalized === "429") return new MinerUError(failure("PROVIDER_RATE_LIMITED", message, true, details));
	return new MinerUError(failure("REMOTE_PARSE_FAILED", message, false, details));
}
function externalHttpsUrl(raw, label) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new MinerUError(failure("REMOTE_PARSE_FAILED", `${label} is not a valid URL`));
	}
	if (url.protocol !== "https:" || url.username || url.password) throw new MinerUError(failure("REMOTE_PARSE_FAILED", `${label} must be an HTTPS URL without embedded credentials`));
	return url.toString();
}
function parseProgress(extractProgress) {
	if (typeof extractProgress === "object" && extractProgress !== null) {
		const obj = extractProgress;
		const extracted = typeof obj["extracted_pages"] === "number" ? obj["extracted_pages"] : void 0;
		const total = typeof obj["total_pages"] === "number" ? obj["total_pages"] : void 0;
		if (extracted !== void 0 && total !== void 0 && Number.isSafeInteger(extracted) && Number.isSafeInteger(total) && extracted >= 0 && total > 0 && extracted <= total) return {
			completed: extracted,
			total
		};
	}
	if (Number.isSafeInteger(extractProgress) && extractProgress >= 0 && extractProgress <= 100) return {
		completed: extractProgress,
		total: 100
	};
}
function indexExtractResults(extractResults, ref) {
	const expected = new Set(ref.files.map((file) => file.dataId));
	if (expected.size !== ref.files.length) throw new MinerUError(failure("REMOTE_PARSE_FAILED", "Official provider reference contains duplicate data_id mappings", false, { provider: "official-v4" }));
	const results = /* @__PURE__ */ new Map();
	for (const item of extractResults) {
		if (typeof item.data_id !== "string" || item.data_id.trim() === "") throw new MinerUError(failure("REMOTE_PARSE_FAILED", "Official result item is missing data_id", false, { provider: "official-v4" }));
		if (!expected.has(item.data_id)) throw new MinerUError(failure("REMOTE_PARSE_FAILED", "Official result contains an unknown data_id", false, { provider: "official-v4" }));
		if (results.has(item.data_id)) throw new MinerUError(failure("REMOTE_PARSE_FAILED", "Official result contains a duplicate data_id", false, { provider: "official-v4" }));
		results.set(item.data_id, item);
	}
	return results;
}
var OfficialV4Provider = class {
	id = "official-v4";
	config;
	capabilities;
	parsedBaseUrl;
	retryOptions;
	client;
	constructor(config, options) {
		asProviderConfigId(config.id);
		this.config = config;
		this.retryOptions = options?.retry ?? {};
		this.parsedBaseUrl = validateAndNormalizeOfficialBaseURL(config.baseURL);
		this.client = new ProviderHttpClient({
			baseURL: this.parsedBaseUrl,
			provider: "official-v4",
			defaultRetry: this.retryOptions,
			providerLabel: "MinerU official API"
		});
		const supportedModels = config.models.length > 0 ? config.models : ["pipeline", "vlm"];
		this.capabilities = {
			models: supportedModels,
			parseMethods: ["auto", "ocr"],
			supportsOcr: true,
			supportsLanguage: true,
			supportsFormula: true,
			supportsTable: true,
			supportsPageRanges: true,
			supportedArtifacts: [
				"markdown",
				"layout",
				"model-output",
				"content-list",
				"images"
			],
			maxFilesPerSubmission: 200,
			maxFileBytes: 209715200,
			maxPagesPerFile: 200
		};
	}
	async compatibilityKey(request, context) {
		const originAndPath = `${this.parsedBaseUrl.origin}${this.parsedBaseUrl.pathname.replace(/\/+$/, "")}`;
		return `official-v4:${createHash("sha256").update(JSON.stringify({
			originAndPath,
			configuredVersion: context.configuredVersion ?? this.config.configuredVersion ?? "v4",
			model: request.semantics.model
		}), "utf8").digest("hex").slice(0, 24)}`;
	}
	async probe(context) {
		if (!context.credential || context.credential.trim() === "") return {
			available: false,
			provider: "official-v4",
			authentication: "not-configured",
			protocolVersion: "v4",
			diagnostics: "API key is not configured"
		};
		try {
			await this.requestJson("GET", "/extract-results/batch/__dsh_probe__", void 0, {}, context, [200, 404], {
				operation: "probe",
				retry: true,
				businessValidation: "probe"
			});
			return {
				available: true,
				provider: "official-v4",
				authentication: "valid",
				protocolVersion: "v4"
			};
		} catch (error) {
			if (context.signal.aborted) throw new MinerUError(failure("CANCELLED", "Probe operation was cancelled", true));
			const minerUFailure = toMinerUFailure(error);
			return {
				available: false,
				provider: "official-v4",
				authentication: minerUFailure.code === "AUTHENTICATION_FAILED" ? "invalid" : "unknown",
				protocolVersion: "v4",
				diagnostics: sanitizeDiagnostic(minerUFailure.message)
			};
		}
	}
	async submit(request, sources, context) {
		context.signal.throwIfAborted();
		validateProviderCapabilities(request, this.capabilities);
		if (sources.length !== request.files.length) throw new MinerUError(failure("INVALID_REQUEST", "Prepared source files count does not match request files count"));
		await assertSourcesUnchanged(sources, context.signal);
		const submittedFiles = request.files.map((f) => ({
			dataId: `data_${f.fileId}`,
			fileId: f.fileId,
			name: f.name
		}));
		const payload = {
			files: request.files.map((file, i) => {
				const sub = submittedFiles[i];
				return {
					name: file.name,
					data_id: sub.dataId,
					is_ocr: request.semantics.ocr,
					enable_formula: request.semantics.formula,
					enable_table: request.semantics.table,
					language: request.semantics.language,
					...request.semantics.pages !== void 0 ? { page_ranges: request.semantics.pages } : {}
				};
			}),
			model_version: request.semantics.model
		};
		const submitResponse = await this.requestJson("POST", "/file-urls/batch", JSON.stringify(payload), { "content-type": "application/json" }, context, [200], {
			operation: "submit",
			retry: false
		});
		if (!submitResponse || typeof submitResponse !== "object") throw new MinerUError(failure("REMOTE_PARSE_FAILED", "MinerU server returned empty or invalid response", false, { provider: "official-v4" }));
		const batchId = submitResponse.data?.batch_id;
		const fileUrls = submitResponse.data?.file_urls;
		if (!batchId || typeof batchId !== "string" || batchId.trim() === "") throw new MinerUError(failure("REMOTE_PARSE_FAILED", "MinerU server did not return a valid batch_id", false, {
			provider: "official-v4",
			traceId: submitResponse.trace_id
		}));
		if (!Array.isArray(fileUrls) || fileUrls.length !== sources.length) throw new MinerUError(failure("REMOTE_PARSE_FAILED", `MinerU returned ${String(fileUrls?.length ?? 0)} upload URLs, expected ${String(sources.length)}`, false, {
			provider: "official-v4",
			traceId: submitResponse.trace_id
		}));
		const ref = {
			provider: "official-v4",
			batchId,
			files: submittedFiles
		};
		await context.onAccepted?.(ref);
		for (let i = 0; i < sources.length; i++) {
			context.signal.throwIfAborted();
			const source = sources[i];
			const uploadUrl = externalHttpsUrl(fileUrls[i], "Official presigned upload URL");
			await this.barePutStream(uploadUrl, source, context);
		}
		return {
			ref,
			state: "processing",
			files: request.files.map((f) => ({
				fileId: f.fileId,
				state: "processing",
				rawState: "running"
			}))
		};
	}
	async inspect(ref, context) {
		context.signal.throwIfAborted();
		if (ref.provider !== "official-v4") throw new MinerUError(failure("INVALID_REQUEST", `Unsupported provider ref "${ref.provider}" for OfficialV4Provider`));
		const data = await this.requestJson("GET", `/extract-results/batch/${encodeURIComponent(ref.batchId)}`, void 0, {}, context, [200], {
			operation: "inspect",
			retry: true
		});
		if (!data || typeof data !== "object") throw new MinerUError(failure("REMOTE_PARSE_FAILED", "MinerU server returned empty status response", false, { provider: "official-v4" }));
		const resultsByDataId = indexExtractResults(Array.isArray(data.data?.extract_result) ? data.data.extract_result : [], ref);
		const fileSnapshots = [];
		let hasNonTerminal = false;
		let allCompleted = true;
		let allFailed = true;
		for (const file of ref.files) {
			const item = resultsByDataId.get(file.dataId);
			if (!item) {
				fileSnapshots.push({
					fileId: file.fileId,
					state: "processing",
					rawState: "pending"
				});
				hasNonTerminal = true;
				allCompleted = false;
				allFailed = false;
				continue;
			}
			const fileState = mapOfficialFileState(item.state);
			const progress = parseProgress(item.extract_progress);
			const fileFailure = fileState === "failed" ? failure("REMOTE_PARSE_FAILED", sanitizeDiagnostic(item.err_msg || "Remote document extraction failed", [context.credential ?? ""]), false, {
				provider: "official-v4",
				fileId: file.fileId,
				traceId: data.trace_id
			}) : void 0;
			fileSnapshots.push({
				fileId: file.fileId,
				state: fileState,
				rawState: item.state,
				...progress !== void 0 ? { progress } : {},
				...fileFailure !== void 0 ? { failure: fileFailure } : {}
			});
			if (fileState !== "completed" && fileState !== "failed") hasNonTerminal = true;
			if (fileState !== "completed") allCompleted = false;
			if (fileState !== "failed") allFailed = false;
		}
		let batchState;
		if (hasNonTerminal) batchState = "processing";
		else if (allCompleted) batchState = "completed";
		else if (allFailed) batchState = "failed";
		else batchState = "partially-completed";
		return {
			state: batchState,
			files: fileSnapshots
		};
	}
	async collect(ref, request, sink, context) {
		context.signal.throwIfAborted();
		if (ref.provider !== "official-v4") throw new MinerUError(failure("INVALID_REQUEST", `Unsupported provider ref "${ref.provider}" for OfficialV4Provider`));
		const data = await this.requestJson("GET", `/extract-results/batch/${encodeURIComponent(ref.batchId)}`, void 0, {}, context, [200], {
			operation: "collect",
			retry: true
		});
		if (!data || typeof data !== "object") throw new MinerUError(failure("REMOTE_PARSE_FAILED", "MinerU server returned empty result response", false, { provider: "official-v4" }));
		const resultsByDataId = indexExtractResults(Array.isArray(data.data?.extract_result) ? data.data.extract_result : [], ref);
		const completedFilesByZipUrl = /* @__PURE__ */ new Map();
		const collectedFiles = [];
		for (const file of ref.files) {
			const item = resultsByDataId.get(file.dataId);
			if (!item) throw new MinerUError(failure("RESULT_NOT_READY", `Result for file "${file.name}" is not ready`, true, {
				provider: "official-v4",
				fileId: file.fileId
			}));
			const fileState = mapOfficialFileState(item.state);
			if (fileState === "failed") {
				collectedFiles.push({
					fileId: file.fileId,
					name: file.name,
					artifacts: [],
					failure: failure("REMOTE_PARSE_FAILED", sanitizeDiagnostic(item.err_msg || "Remote extraction failed", [context.credential ?? ""]), false, {
						provider: "official-v4",
						fileId: file.fileId,
						traceId: data.trace_id
					})
				});
				continue;
			}
			if (fileState !== "completed") throw new MinerUError(failure("RESULT_NOT_READY", `Result for file "${file.name}" is not ready (state: ${item.state})`, true, {
				provider: "official-v4",
				fileId: file.fileId
			}));
			const zipUrl = item.full_zip_url;
			if (!zipUrl || typeof zipUrl !== "string" || zipUrl.trim() === "") throw new MinerUError(failure("REMOTE_PARSE_FAILED", `Completed file "${file.name}" is missing full_zip_url`, false, {
				provider: "official-v4",
				fileId: file.fileId,
				traceId: data.trace_id
			}));
			const safeZipUrl = externalHttpsUrl(zipUrl, "Official result ZIP URL");
			const list = completedFilesByZipUrl.get(safeZipUrl) ?? [];
			list.push(file);
			completedFilesByZipUrl.set(safeZipUrl, list);
		}
		for (const [zipUrl, targetFiles] of completedFilesByZipUrl.entries()) {
			context.signal.throwIfAborted();
			const extracted = await extractSafeZip({
				zipPath: (await this.downloadZipToTemporary(zipUrl, sink, context)).path,
				sink,
				files: targetFiles,
				requiredArtifacts: request.requiredArtifacts,
				limits: context.limits,
				signal: context.signal
			});
			collectedFiles.push(...extracted);
		}
		return { files: collectedFiles };
	}
	async requestJson(method, path, bodyText, headers, context, acceptedStatuses = [200], options) {
		const businessValidation = options?.businessValidation ?? "strict";
		return await this.client.requestJson({
			method,
			path,
			body: bodyText,
			headers,
			context,
			acceptedStatuses,
			operation: options?.operation,
			retry: options?.retry,
			validateResponse: (parsed, response) => {
				if (!("code" in parsed)) throw new MinerUError(failure("REMOTE_PARSE_FAILED", "Official MinerU response is missing its business code", false, { provider: "official-v4" }));
				const envelope = parsed;
				if (envelope.code !== 0) {
					const normalizedCode = String(envelope.code).toUpperCase();
					if (businessValidation === "probe" && isMissingBatchProbeSentinel(envelope.code, envelope.msg)) return parsed;
					const businessError = officialBusinessFailure(envelope.code, sanitizeDiagnostic(envelope.msg || `Official API failed with code ${String(envelope.code)}`, [context.credential ?? ""]), envelope.trace_id);
					if (normalizedCode === "429") Object.assign(businessError, {
						httpStatus: 429,
						retryAfterMs: parseRetryAfter(response.headers.get("retry-after"))
					});
					throw businessError;
				}
				return parsed;
			}
		});
	}
	async barePutStream(uploadUrl, source, context) {
		context.signal.throwIfAborted();
		const safeUploadUrl = externalHttpsUrl(uploadUrl, "Official presigned upload URL");
		await executeWithRetry({
			provider: "official-v4",
			operation: "presigned-put",
			signal: context.signal,
			retryOptions: mergeRetryOptions(this.retryOptions, context.retry),
			fn: async () => {
				context.signal.throwIfAborted();
				await assertSourcesUnchanged([source], context.signal);
				const controller = new AbortController();
				let timedOut = false;
				const timer = setTimeout(() => {
					timedOut = true;
					controller.abort(new DOMException(`Upload timed out after ${String(context.timeoutMs)}ms`, "TimeoutError"));
				}, context.timeoutMs);
				const onParentAbort = () => {
					controller.abort(context.signal.reason);
				};
				context.signal.addEventListener("abort", onParentAbort, { once: true });
				const stream = createReadStream(source.path);
				const onStreamAbort = () => {
					stream.destroy(new DOMException("Aborted", "AbortError"));
				};
				context.signal.addEventListener("abort", onStreamAbort, { once: true });
				try {
					const requestInit = {
						method: "PUT",
						headers: {},
						body: Readable.toWeb(stream),
						signal: controller.signal,
						redirect: "error",
						duplex: "half"
					};
					let response;
					try {
						response = await fetch(safeUploadUrl, requestInit);
					} catch (err) {
						if (context.signal.aborted) throw new MinerUError(failure("CANCELLED", "Upload was cancelled", true));
						if (timedOut) {
							const err = new MinerUError(failure("UPLOAD_FAILED", `Upload timed out after ${String(context.timeoutMs)}ms`, true));
							Object.assign(err, { httpStatus: 408 });
							throw err;
						}
						throw new MinerUError(failure("UPLOAD_FAILED", `Failed to upload file to storage: ${sanitizeDiagnostic(err instanceof Error ? err.message : String(err))}`, true), { cause: err });
					}
					if (response.status !== 200 && response.status !== 204) {
						let errText = "";
						try {
							errText = await readBoundedResponseText(response, 2048, controller.signal);
						} catch {
							if (response.body) try {
								await response.body.cancel();
							} catch {}
						}
						const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
						const retryable = isRetryableHttpStatus(response.status);
						const err = new MinerUError(failure("UPLOAD_FAILED", `Storage upload failed with HTTP status ${String(response.status)}${errText ? `: ${sanitizeDiagnostic(errText)}` : ""}`, retryable));
						Object.assign(err, {
							httpStatus: response.status,
							retryAfterMs: retryAfter
						});
						throw err;
					}
					if (response.body) try {
						await response.body.cancel();
					} catch {}
				} finally {
					clearTimeout(timer);
					context.signal.removeEventListener("abort", onParentAbort);
					context.signal.removeEventListener("abort", onStreamAbort);
					if (!stream.destroyed) stream.destroy();
				}
			}
		});
	}
	async downloadZipToTemporary(cdnUrl, sink, context) {
		context.signal.throwIfAborted();
		const safeCdnUrl = externalHttpsUrl(cdnUrl, "Official result ZIP URL");
		return await executeWithRetry({
			provider: "official-v4",
			operation: "cdn-download",
			signal: context.signal,
			retryOptions: mergeRetryOptions(this.retryOptions, context.retry),
			fn: async () => {
				context.signal.throwIfAborted();
				const controller = new AbortController();
				let timedOut = false;
				const timer = setTimeout(() => {
					timedOut = true;
					controller.abort(new DOMException(`Download timed out after ${String(context.timeoutMs)}ms`, "TimeoutError"));
				}, context.timeoutMs);
				const onParentAbort = () => {
					controller.abort(context.signal.reason);
				};
				context.signal.addEventListener("abort", onParentAbort, { once: true });
				try {
					const requestInit = {
						method: "GET",
						headers: {},
						signal: controller.signal,
						redirect: "error"
					};
					let response;
					try {
						response = await fetch(safeCdnUrl, requestInit);
					} catch (err) {
						if (context.signal.aborted) throw new MinerUError(failure("CANCELLED", "Download was cancelled", true));
						if (timedOut) {
							const err = new MinerUError(failure("RESULT_DOWNLOAD_FAILED", `Download timed out after ${String(context.timeoutMs)}ms`, true));
							Object.assign(err, { httpStatus: 408 });
							throw err;
						}
						throw new MinerUError(failure("RESULT_DOWNLOAD_FAILED", `Failed to download result archive: ${sanitizeDiagnostic(err instanceof Error ? err.message : String(err))}`, true), { cause: err });
					}
					if (response.status !== 200) {
						if (response.body) try {
							await response.body.cancel();
						} catch {}
						const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
						const retryable = isRetryableHttpStatus(response.status);
						const err = new MinerUError(failure("RESULT_DOWNLOAD_FAILED", `Failed to download result archive, HTTP status ${String(response.status)}`, retryable));
						Object.assign(err, {
							httpStatus: response.status,
							retryAfterMs: retryAfter
						});
						throw err;
					}
					const body = response.body;
					if (!body) throw new MinerUError(failure("RESULT_DOWNLOAD_FAILED", "Result archive response body is empty", false));
					const nodeStream = Readable.fromWeb(body);
					const tempName = `mineru_v4_${createHash("sha256").update(safeCdnUrl).digest("hex").slice(0, 16)}.zip`;
					try {
						return await sink.writeTemporary(tempName, nodeStream, context.limits.maxZipDownloadBytes);
					} catch (error) {
						nodeStream.destroy();
						throw error;
					}
				} finally {
					clearTimeout(timer);
					context.signal.removeEventListener("abort", onParentAbort);
				}
			}
		});
	}
};
//#endregion
//#region src/providers/registry.ts
var ProviderRegistry = class {
	getConfig;
	options;
	constructor(getConfig, options) {
		this.getConfig = getConfig;
		this.options = options;
	}
	active() {
		const config = this.getConfig();
		return this.resolve(config.activeProvider);
	}
	resolve(configId) {
		const config = providerById(this.getConfig(), configId);
		if (config === void 0) throw new MinerUError(failure("PROVIDER_CONFIG_MISSING", `MinerU provider config ${configId} is no longer available`));
		return {
			config,
			provider: this.create(config)
		};
	}
	create(config) {
		switch (config.type) {
			case "self-hosted-v2": return new SelfHostedV2Provider(config, this.options);
			case "official-v4": return new OfficialV4Provider(config, this.options);
		}
	}
};
//#endregion
//#region src/observability.ts
function createStructuredDiagnosticSink(logger) {
	return (event) => {
		try {
			logger[event.level]("dsh-pdf-mineru", event);
		} catch {}
	};
}
function emitDiagnostic(sink, event) {
	try {
		sink?.(event);
	} catch {}
}
//#endregion
//#region src/domain/cache-key.ts
function normalizeJson(value) {
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "string") return value.normalize("NFC");
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("canonical JSON cannot contain non-finite numbers");
		return Object.is(value, -0) ? 0 : value;
	}
	if (Array.isArray(value)) return value.map(normalizeJson);
	if (typeof value === "object") {
		const source = value;
		const target = Object.create(null);
		for (const rawKey of Object.keys(source).sort()) {
			const key = rawKey.normalize("NFC");
			if (Object.hasOwn(target, key)) throw new TypeError("canonical JSON key normalization collision");
			const entry = source[rawKey];
			if (entry === void 0) throw new TypeError("canonical JSON cannot contain undefined");
			target[key] = normalizeJson(entry);
		}
		return target;
	}
	throw new TypeError(`unsupported canonical JSON value: ${typeof value}`);
}
function canonicalJson(value) {
	return JSON.stringify(normalizeJson(value));
}
function computeCacheKey(request, file, providerCompatibilityKey, versions = {}) {
	const encoded = canonicalJson({
		cacheKeySchemaVersion: versions.cacheKey ?? 1,
		sourceSha256: file.sha256,
		parseSemantics: request.semantics,
		requiredArtifacts: request.requiredArtifacts,
		providerCompatibilityKey,
		resultSchemaVersion: versions.result ?? 1
	});
	return asCacheKey(createHash("sha256").update(encoded, "utf8").digest("hex"));
}
//#endregion
//#region src/service/shared-operations.ts
function deferred() {
	let resolve;
	let reject;
	return {
		promise: new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		}),
		resolve,
		reject
	};
}
function waitWithSignal(promise, signal) {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
	});
}
/** One process-local producer shared by foreground calls and native DSH jobs. */
var SharedOperation = class {
	cacheKey;
	id = createOperationId();
	controller = new AbortController();
	outcome = deferred();
	settled = false;
	outcomeValue;
	waiters = 0;
	constructor(cacheKey) {
		this.cacheKey = cacheKey;
		this.outcome.promise.catch(() => void 0);
	}
	get settledValue() {
		return this.outcomeValue;
	}
	get waiterCount() {
		return this.waiters;
	}
	resolve(value) {
		if (this.settled) return;
		this.settled = true;
		this.outcomeValue = value;
		this.outcome.resolve(value);
	}
	reject(error) {
		if (this.settled) return;
		this.settled = true;
		this.outcome.reject(error);
	}
	async waitForOutcome(signal) {
		this.waiters++;
		try {
			return await waitWithSignal(this.outcome.promise, signal);
		} finally {
			this.waiters--;
		}
	}
	abort(reason) {
		if (!this.controller.signal.aborted) this.controller.abort(reason);
	}
};
var SharedOperationRegistry = class {
	operations = /* @__PURE__ */ new Map();
	disposed = false;
	operationKeys = /* @__PURE__ */ new WeakMap();
	operationTimeouts = /* @__PURE__ */ new WeakMap();
	started = /* @__PURE__ */ new WeakSet();
	runners = /* @__PURE__ */ new Set();
	reserve(cacheKey, authority, timeoutMs) {
		if (this.disposed) throw new MinerUError(failure("PROVIDER_UNAVAILABLE", "MinerU service is shutting down", true));
		const operationKey = `${cacheKey}:${authority}`;
		const existing = this.operations.get(operationKey);
		if (existing !== void 0) return {
			operation: existing,
			created: false
		};
		const operation = new SharedOperation(cacheKey);
		this.operations.set(operationKey, operation);
		this.operationKeys.set(operation, operationKey);
		this.operationTimeouts.set(operation, timeoutMs);
		return {
			operation,
			created: true
		};
	}
	start(operation, runner) {
		const operationKey = this.operationKeys.get(operation);
		if (operationKey === void 0 || this.operations.get(operationKey) !== operation) throw new TypeError("Shared operation is not reserved in this registry");
		if (this.started.has(operation)) throw new TypeError("Shared operation has already been started");
		this.started.add(operation);
		const timeout = setTimeout(() => {
			operation.abort(new MinerUError(failure("POLL_TIMEOUT", "Shared MinerU operation timed out", true)));
		}, this.operationTimeouts.get(operation) ?? 1);
		timeout.unref?.();
		const running = Promise.resolve().then(() => runner(operation)).then((outcome) => operation.resolve(outcome), (error) => operation.reject(error)).finally(() => {
			clearTimeout(timeout);
			this.runners.delete(running);
			if (this.operations.get(operationKey) === operation) this.operations.delete(operationKey);
		});
		this.runners.add(running);
	}
	release(operation, error) {
		const operationKey = this.operationKeys.get(operation);
		if (operationKey === void 0 || this.operations.get(operationKey) !== operation || this.started.has(operation)) return false;
		this.operations.delete(operationKey);
		operation.reject(error);
		return true;
	}
	acquire(cacheKey, authority, timeoutMs, runner) {
		const reserved = this.reserve(cacheKey, authority, timeoutMs);
		if (reserved.created) this.start(reserved.operation, runner);
		return reserved;
	}
	get(cacheKey, authority) {
		return this.operations.get(`${cacheKey}:${authority}`);
	}
	activeOperationIds() {
		return new Set([...this.operations.values()].map((operation) => operation.id));
	}
	activeOperationCount() {
		return this.operations.size;
	}
	dispose() {
		this.disposed = true;
		const error = new MinerUError(failure("CANCELLED", "MinerU plugin disposed", true));
		for (const operation of [...this.operations.values()]) if (!this.release(operation, error)) operation.abort(error);
	}
	async shutdown() {
		this.dispose();
		await Promise.allSettled([...this.runners]);
	}
};
//#endregion
//#region src/service/result-presenter.ts
function getBlockCategory(type) {
	if (!type) return "text";
	const lower = type.toLowerCase();
	if (lower === "table" || lower.startsWith("table_")) return "table";
	if (lower === "image" || lower === "chart" || lower === "figure" || lower.startsWith("image_")) return "image";
	return "text";
}
function formatCaption(caption) {
	if (typeof caption === "string") return caption.trim();
	if (Array.isArray(caption)) return caption.map((c) => typeof c === "string" ? c.trim() : String(c)).filter(Boolean).join(" ");
	return "";
}
function getRasterMediaType(ext) {
	switch (ext.toLowerCase()) {
		case ".jpg":
		case ".jpeg": return "image/jpeg";
		case ".webp": return "image/webp";
		case ".gif": return "image/gif";
		case ".png": return "image/png";
		default: return;
	}
}
function formatTocMarkdown(headings, options) {
	if (!headings || headings.length === 0) return options?.pageRange ? `*(No headings found in pages: ${options.pageRange})*` : "*(No headings detected in document outline)*";
	const lines = ["# Document Outline", ""];
	for (const heading of headings) {
		const indent = "  ".repeat(Math.max(0, heading.level - 1));
		const location = heading.page !== void 0 ? ` (Page ${String(heading.page)})` : heading.line !== void 0 ? ` (line ${String(heading.line)})` : "";
		lines.push(`${indent}- ${heading.title}${location}`);
	}
	return lines.join("\n");
}
function computeDocumentSummary(contentList, fallbackFullText) {
	const maxPage = contentList.reduce((max, b) => typeof b.page_idx === "number" ? Math.max(max, b.page_idx) : max, -1);
	const page_count = maxPage >= 0 ? maxPage + 1 : void 0;
	const table_count = contentList.filter((b) => getBlockCategory(b.type) === "table").length;
	const image_count = contentList.filter((b) => getBlockCategory(b.type) === "image").length;
	const equation_count = contentList.filter((b) => {
		const t = (b.type ?? "").toLowerCase();
		return t === "equation" || t === "interline_equation" || t === "inline_equation";
	}).length;
	const toc = [];
	for (const b of contentList) {
		const page = typeof b.page_idx === "number" && Number.isSafeInteger(b.page_idx) && b.page_idx >= 0 ? b.page_idx + 1 : void 0;
		if (typeof b.text_level === "number" && b.text_level >= 1 && b.text_level <= 6) {
			const title = String(b.text ?? b.content ?? "").trim().replace(/^#{1,6}\s+/, "");
			if (title) toc.push({
				level: b.text_level,
				title,
				...page === void 0 ? {} : { page }
			});
		} else if (b.type === "title") {
			const title = String(b.text ?? b.content ?? "").trim().replace(/^#{1,6}\s+/, "");
			if (title) toc.push({
				level: 1,
				title,
				...page === void 0 ? {} : { page }
			});
		} else if (typeof b.text === "string" && /^#{1,6}\s+/.test(b.text)) {
			const m = b.text.match(/^(#{1,6})\s+(.+)$/);
			if (m) toc.push({
				level: m[1].length,
				title: m[2].trim(),
				...page === void 0 ? {} : { page }
			});
		}
	}
	if (toc.length === 0 && fallbackFullText) return {
		page_count,
		table_count,
		image_count,
		equation_count,
		toc: extractMarkdownHeadings(fallbackFullText)
	};
	return {
		page_count,
		table_count,
		image_count,
		equation_count,
		toc
	};
}
function extractBlocksMarkdown(contentList, pagesSet, focusSet, imageArtifacts) {
	const orderedImages = [];
	const renderedBlocks = [];
	const isAllFocus = focusSet.has("all") || focusSet.has("text") && focusSet.has("table") && focusSet.has("image");
	for (const block of contentList) {
		const pageNum = typeof block.page_idx === "number" && Number.isSafeInteger(block.page_idx) && block.page_idx >= 0 ? block.page_idx + 1 : void 0;
		if (pagesSet !== void 0 && (pageNum === void 0 || !pagesSet.has(pageNum))) continue;
		const cat = getBlockCategory(block.type);
		if (!isAllFocus && !focusSet.has(cat)) continue;
		if (cat === "image") {
			const rawPath = block.img_path ?? block.image_path ?? block.path;
			const reference = rawPath === void 0 ? void 0 : String(rawPath).replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
			const exact = reference === void 0 ? void 0 : imageArtifacts.filter((a) => {
				const candidate = a.path.replaceAll("\\", "/");
				return candidate === reference || candidate.endsWith("/" + reference);
			});
			const base = reference === void 0 ? void 0 : basename(reference).toLowerCase();
			const byBase = base === void 0 ? [] : imageArtifacts.filter((a) => basename(a.path).toLowerCase() === base);
			const matched = exact?.length === 1 ? exact[0] : exact?.length === 0 && byBase.length === 1 ? byBase[0] : void 0;
			const caption = formatCaption(block.image_caption ?? block.caption);
			let imgName = "image";
			let imgBytes = 0;
			let imgPath = "";
			let mediaType;
			if (matched) {
				imgPath = matched.path;
				imgBytes = matched.bytes;
				imgName = basename(matched.path);
				mediaType = getRasterMediaType(extname(matched.path));
			}
			const imgIdx = orderedImages.length + 1;
			const status = matched === void 0 ? "unavailable" : mediaType === void 0 ? "unsupported" : "available";
			orderedImages.push({
				path: imgPath,
				name: imgName,
				page: pageNum,
				caption,
				media_type: mediaType ?? "application/octet-stream",
				bytes: imgBytes,
				status
			});
			let md = mediaType === void 0 || imgPath === "" ? `> Figure ${String(imgIdx)} (Page ${String(pageNum)}) unavailable` : `> Figure ${String(imgIdx)} (Page ${String(pageNum)})${caption ? `: ${caption}` : `: ${imgName}`}`;
			const footnote = formatCaption(block.image_footnote ?? block.footnote);
			if (footnote) md += `\n> *${footnote}*`;
			renderedBlocks.push(md);
		} else if (cat === "table") {
			const caption = formatCaption(block.table_caption ?? block.caption);
			const body = String(block.table_body ?? block.text ?? block.content ?? "").trim();
			const footnote = formatCaption(block.table_footnote ?? block.footnote);
			let md = "";
			if (caption) md += `**${caption}**\n\n`;
			if (body) md += body;
			if (footnote) md += `\n\n*${footnote}*`;
			if (md.trim()) renderedBlocks.push(md.trim());
		} else {
			const lower = (block.type ?? "").toLowerCase();
			if (lower === "code") {
				const lang = String(block.language ?? "").trim();
				const code = String(block.code ?? block.text ?? block.content ?? "");
				if (code.trim().startsWith("```")) renderedBlocks.push(code.trim());
				else renderedBlocks.push(`\`\`\`${lang}\n${code}\n\`\`\``);
			} else if (lower === "equation" || lower === "interline_equation") {
				const eq = String(block.text ?? block.content ?? "").trim();
				if (eq.startsWith("$$") || eq.startsWith("$")) renderedBlocks.push(eq);
				else renderedBlocks.push(`$$\n${eq}\n$$`);
			} else {
				const text = String(block.text ?? block.content ?? "").trim();
				const level = typeof block.text_level === "number" && block.text_level >= 1 && block.text_level <= 6 ? block.text_level : void 0;
				if (level !== void 0 && !text.startsWith("#")) renderedBlocks.push(`${"#".repeat(level)} ${text}`);
				else if (text) renderedBlocks.push(text);
			}
		}
	}
	return {
		text: renderedBlocks.join("\n\n"),
		orderedImages
	};
}
function fallbackExtractFromMarkdown(fullMarkdownText, imageArtifacts) {
	const orderedImages = [];
	let annotatedText = fullMarkdownText;
	const imgRegex = /!\[(.*?)\]\((.*?)\)/g;
	let match;
	let imgIndex = 0;
	const matches = [];
	while ((match = imgRegex.exec(fullMarkdownText)) !== null) matches.push({
		fullMatch: match[0],
		alt: match[1] ?? "",
		url: match[2] ?? ""
	});
	for (const item of matches) {
		const reference = item.url.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
		const exact = imageArtifacts.filter((a) => {
			const candidate = a.path.replaceAll("\\", "/");
			return candidate === reference || candidate.endsWith("/" + reference);
		});
		const base = basename(reference).toLowerCase();
		const byBase = imageArtifacts.filter((a) => basename(a.path).toLowerCase() === base);
		const matchedArtifact = exact.length === 1 ? exact[0] : exact.length === 0 && byBase.length === 1 ? byBase[0] : void 0;
		const imgPath = matchedArtifact?.path;
		const imgName = matchedArtifact === void 0 ? basename(reference) || "image" : basename(matchedArtifact.path);
		const mediaType = matchedArtifact === void 0 ? void 0 : getRasterMediaType(extname(matchedArtifact.path));
		imgIndex++;
		orderedImages.push({
			path: imgPath ?? "",
			name: imgName,
			caption: item.alt,
			media_type: mediaType ?? "application/octet-stream",
			bytes: matchedArtifact?.bytes ?? 0,
			status: matchedArtifact === void 0 ? "unavailable" : mediaType === void 0 ? "unsupported" : "available"
		});
		const replacement = mediaType === void 0 || imgPath === void 0 ? `> Figure ${String(imgIndex)} unavailable` : `> Figure ${String(imgIndex)}${item.alt ? `: ${item.alt}` : ""}`;
		annotatedText = annotatedText.replace(item.fullMatch, replacement);
	}
	const toc = extractMarkdownHeadings(fullMarkdownText);
	const summary = {
		table_count: (fullMarkdownText.match(/\|[\s-:]+\|/g) ?? []).length,
		image_count: orderedImages.length,
		toc
	};
	return {
		text: annotatedText,
		orderedImages,
		summary
	};
}
function safeStringSlice(str, maxLen) {
	if (str.length <= maxLen) return str;
	let end = maxLen;
	const code = str.charCodeAt(end - 1);
	if (code >= 55296 && code <= 56319) end--;
	return str.slice(0, end);
}
function truncateAtCleanBoundary(fullText, maxChars) {
	if (fullText.length <= maxChars) return {
		text: fullText,
		truncated: false
	};
	if (maxChars <= 0) return {
		text: "",
		truncated: true,
		resumeLine: 1
	};
	const boundedSlice = safeStringSlice(fullText, maxChars);
	const paragraphIndex = boundedSlice.lastIndexOf("\n\n");
	const lineIndex = boundedSlice.lastIndexOf("\n");
	let cutIndex = -1;
	if (paragraphIndex !== -1 && paragraphIndex >= Math.floor(maxChars * .7)) cutIndex = paragraphIndex + 2;
	else if (lineIndex !== -1) cutIndex = lineIndex + 1;
	if (cutIndex > 0) {
		const text = boundedSlice.slice(0, cutIndex);
		let newlineCount = 0;
		for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) newlineCount++;
		return {
			text,
			truncated: true,
			resumeLine: newlineCount + 1
		};
	}
	return {
		text: boundedSlice,
		truncated: true,
		resumeLine: 1
	};
}
const MAX_MARKDOWN_READ_BYTES = 67108864;
async function readMarkdownFile(path, totalBytes, _maxCharsToRead, summaryOnly = false) {
	if (summaryOnly) return {
		text: "",
		isCompleteFile: false
	};
	if (totalBytes > MAX_MARKDOWN_READ_BYTES) throw new MinerUError(failure("RESULT_TOO_LARGE", "Markdown artifact exceeds the bounded reader limit"));
	if (totalBytes === 0) return {
		text: "",
		isCompleteFile: true
	};
	const maxBytes = totalBytes;
	const handle = await open(path, "r");
	try {
		const buffer = Buffer.alloc(maxBytes);
		let bytesRead = 0;
		while (bytesRead < maxBytes) {
			const result = await handle.read(buffer, bytesRead, maxBytes - bytesRead, bytesRead);
			if (result.bytesRead === 0) break;
			bytesRead += result.bytesRead;
		}
		if (bytesRead !== totalBytes) throw new MinerUError(failure("RESULT_DOWNLOAD_FAILED", "Markdown artifact changed while it was being read"));
		return {
			text: new TextDecoder("utf-8").decode(buffer),
			isCompleteFile: true
		};
	} finally {
		await handle.close();
	}
}
function findMarkdownArtifactPath(value) {
	if (value.markdown_path !== void 0) return value.markdown_path;
	for (const file of value.files) {
		if (file.markdown_path !== void 0) return file.markdown_path;
		const md = file.artifacts.find((artifact) => artifact.kind === "markdown");
		if (md !== void 0) return md.path;
	}
}
function extractMarkdownHeadings(fullText) {
	if (!fullText) return [];
	const lines = fullText.split(/\r?\n/);
	const headings = [];
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
		if (match) {
			const title = match[2].trim();
			if (title.length > 0) headings.push({
				level: match[1].length,
				title,
				line: i + 1
			});
		}
	}
	if (headings.length > 25) {
		const highLevel = headings.filter((h) => h.level <= 3);
		return (highLevel.length > 0 ? highLevel : headings).slice(0, 20);
	}
	return headings;
}
function formatResultProse(value) {
	const status = value.content_status ?? (value.markdown_content !== void 0 ? "complete" : "not_requested");
	const lines = [];
	const content = value.markdown_content;
	if (value.files.length > 0) for (let i = 0; i < value.files.length; i++) {
		const file = value.files[i];
		if (lines.length > 0) lines.push("");
		lines.push("# Document: " + file.name);
		if (i === 0 && content !== void 0) lines.push("", content);
		const secondary = file.artifacts.filter((artifact) => artifact.kind !== "markdown");
		if (secondary.length > 0) lines.push("", "Artifacts: " + secondary.map((a) => a.kind + " (" + String(a.bytes) + " bytes): " + a.path).join(", "));
		if (file.artifacts_truncated) lines.push("", "*(Artifact list truncated to output limit)*");
	}
	else if (content !== void 0) lines.push(content);
	if (status === "partial" && value.toc && value.toc.length > 0) {
		lines.push("", "Document Outline:");
		for (const heading of value.toc) {
			const indent = "  ".repeat(Math.max(0, heading.level - 1));
			const location = heading.page !== void 0 ? ` (Page ${String(heading.page)})` : heading.line !== void 0 ? ` (line ${String(heading.line)})` : "";
			lines.push(`${indent}- ${heading.title}${location}`);
		}
		if (value.cursor !== void 0) lines.push("", "Continue with the returned cursor using the same file_path.");
	}
	const totalPages = value.summary?.page_count;
	const pagesLabel = value.pages ?? (totalPages !== void 0 ? totalPages > 1 ? `1-${totalPages}` : "1" : void 0);
	const pagesParts = [];
	if (pagesLabel !== void 0) pagesParts.push(`Pages: ${pagesLabel}`);
	if (totalPages !== void 0) pagesParts.push(`Total Pages: ${String(totalPages)}`);
	const pagesInfo = pagesParts.length > 0 ? pagesParts.join(", ") + ". " : "";
	let footer;
	if (status === "complete") footer = "\n---\n[Status: Content complete. " + pagesInfo + "Full requested document markdown delivered above.]";
	else if (status === "partial") {
		const mdGuidance = value.cursor !== void 0 ? `Continue with read_pdf({ file_path: "<same file_path>", cursor: "${value.cursor}" }); omit pages/focus.` : "Full markdown artifact available in local result storage.";
		footer = "\n---\n[Status: Content partial (truncated to output limit). " + pagesInfo + mdGuidance + "]";
	} else footer = "\n---\n[Status: Markdown content was not requested." + (pagesParts.length > 0 ? " " + pagesParts.join(", ") + "." : "") + "]";
	lines.push(footer);
	if (value.warnings && value.warnings.length > 0) lines.push("", "Warnings:", ...value.warnings.map((warning) => `- ${warning}`));
	if (value.inlined_images && value.inlined_images.length > 0) {
		lines.push("", "**Inlined Visual Figures**:");
		for (let idx = 0; idx < value.inlined_images.length; idx++) {
			const img = value.inlined_images[idx];
			const dim = img.width !== void 0 && img.height !== void 0 ? ` (${String(img.width)}x${String(img.height)})` : "";
			lines.push(`- Figure ${String(img.figure ?? idx + 1)}: ${img.name}${dim}`);
		}
	}
	if (value.ordered_images && value.ordered_images.length > 0) for (let idx = 0; idx < value.ordered_images.length; idx++) {
		const img = value.ordered_images[idx];
		const meta = [img.page !== void 0 ? `Page ${String(img.page)}` : "", img.caption ? `"${img.caption}"` : ""].filter(Boolean).join(", ");
		const metaStr = meta ? ` (${meta})` : "";
		const status = img.status && img.status !== "available" ? ` [${img.status}]` : "";
		lines.push(`Figure ${String(idx + 1)}${metaStr}: ${img.path || "unavailable"}${status}`);
	}
	return lines.join("\n");
}
function formatSingleSummaryProse(value) {
	const fileName = value.files[0]?.name ?? "Document";
	const summary = value.summary;
	const lines = [
		`**MinerU Document Parse Summary** (Source: ${value.source}, Cache: ${value.cache_hit ? "hit" : "miss"})`,
		"",
		`# Document: ${fileName}`
	];
	if (summary?.page_count !== void 0) lines.push(`- **Total Pages**: ${String(summary.page_count)}`);
	if (summary?.table_count !== void 0) lines.push(`- **Tables**: ${String(summary.table_count)}`);
	if (summary?.image_count !== void 0) lines.push(`- **Figures / Images**: ${String(summary.image_count)}`);
	if (summary?.equation_count !== void 0 && summary.equation_count > 0) lines.push(`- **Formulas / Equations**: ${String(summary.equation_count)}`);
	const outline = summary?.toc ?? value.toc;
	if (outline && outline.length > 0) {
		lines.push("", "**Document Outline**:");
		for (const heading of outline) {
			const indent = "  ".repeat(Math.max(0, heading.level - 1));
			const pageInfo = heading.page !== void 0 ? ` (Page ${String(heading.page)})` : heading.line !== void 0 ? ` (line ${String(heading.line)})` : "";
			lines.push(`${indent}- ${heading.title}${pageInfo}`);
		}
	}
	lines.push("", "---", "**Next Steps**: The document has been fully parsed and cached in local storage. Use `read_pdf` to inspect content on demand:", "- Reuse the original file_path for a page selection: `read_pdf({ file_path: \"<same file_path>\", pages: \"1-3\" })`", "- Reuse the original file_path for tables: `read_pdf({ file_path: \"<same file_path>\", focus: \"table\" })`", "- Reuse the original file_path for figures/images: `read_pdf({ file_path: \"<same file_path>\", focus: \"image\" })`", "- Reuse the original file_path for outline / TOC: `read_pdf({ file_path: \"<same file_path>\", focus: \"toc\" })`", "- Reuse the original file_path for complete text: `read_pdf({ file_path: \"<same file_path>\" })`");
	return lines.join("\n");
}
function canonicalFocusList(focus) {
	return [...focus].sort();
}
function parseFocusList(input) {
	if (!Array.isArray(input)) throw new TypeError("cursor focus must be an array");
	const out = [];
	for (const item of input) {
		if (typeof item !== "string") throw new TypeError("cursor focus entries must be strings");
		const token = item.trim().toLowerCase();
		if (!FOCUS_KINDS.includes(token)) throw new TypeError("unknown cursor focus: " + item);
		out.push(token);
	}
	return [...new Set(out)].sort();
}
function parsePagesLabel(input) {
	if (typeof input !== "string") throw new TypeError("cursor pages must be a string");
	if (input === "") return "";
	if (input.length > 1024) throw new TypeError("cursor pages selection is too complex");
	const seen = /* @__PURE__ */ new Set();
	for (const token of input.split(",")) {
		const trimmed = token.trim();
		if (trimmed === "") throw new TypeError("cursor pages selection is malformed");
		const m = /^(\d+)(?:-(\d+))?$/.exec(trimmed);
		if (m === null) throw new TypeError("cursor pages selection is malformed");
		const start = Number(m[1]);
		const end = m[2] === void 0 ? start : Number(m[2]);
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > 99999) throw new TypeError("cursor pages selection is out of range");
		for (let p = start; p <= end; p++) seen.add(p);
	}
	if (seen.size === 0) throw new TypeError("cursor pages selection is malformed");
	return input;
}
function toBase64Url(input) {
	return Buffer.from(input, "utf8").toString("base64url");
}
function fromBase64Url(input) {
	return Buffer.from(input, "base64url").toString("utf8");
}
/** Encode a cursor bound to one result identity, selection, and text offset. */
function encodeReadCursor(payload) {
	if (!Number.isSafeInteger(payload.off) || payload.off < 0) throw new TypeError("cursor offset must be a non-negative safe integer");
	if (payload.rid.trim() === "") throw new TypeError("cursor result identity is required");
	const canonical = {
		v: 1,
		rid: payload.rid,
		pages: payload.pages,
		focus: [...payload.focus].sort(),
		off: payload.off
	};
	const json = JSON.stringify(canonical);
	if (json.length > 1280) throw new MinerUError(failure("INVALID_REQUEST", "Selection is too complex to continue with a cursor; narrow pages or focus"));
	const token = toBase64Url(json);
	if (token.length > 2048) throw new MinerUError(failure("INVALID_REQUEST", "Selection is too complex to continue with a cursor; narrow pages or focus"));
	return token;
}
/** Decode and structurally validate a cursor token. Never throws MinerUError. */
function decodeReadCursor(token) {
	if (typeof token !== "string" || token.trim() === "" || token.length > 2048) throw new TypeError("cursor is malformed or expired; re-read without a cursor");
	let json;
	try {
		json = fromBase64Url(token.trim());
	} catch {
		throw new TypeError("cursor is malformed or expired; re-read without a cursor");
	}
	if (json.length > 1280) throw new TypeError("cursor is malformed or expired; re-read without a cursor");
	let raw;
	try {
		raw = JSON.parse(json);
	} catch {
		throw new TypeError("cursor is malformed or expired; re-read without a cursor");
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new TypeError("cursor is malformed or expired; re-read without a cursor");
	const obj = raw;
	if (Object.keys(obj).sort().join(",") !== "focus,off,pages,rid,v") throw new TypeError("cursor is malformed or expired; re-read without a cursor");
	if (obj.v !== 1) throw new TypeError("cursor is expired; re-read without a cursor");
	if (typeof obj.rid !== "string" || obj.rid.trim() === "") throw new TypeError("cursor is malformed or expired; re-read without a cursor");
	const pages = parsePagesLabel(obj.pages);
	if (pages !== "" && normalizePageRanges(pages) !== pages) throw new TypeError("cursor selection is not canonical; re-read without a cursor");
	const focus = parseFocusList(obj.focus);
	if (typeof obj.off !== "number" || !Number.isSafeInteger(obj.off) || obj.off < 0) throw new TypeError("cursor is malformed or expired; re-read without a cursor");
	return {
		v: 1,
		rid: obj.rid,
		pages,
		focus,
		off: obj.off
	};
}
/** Create a cursor for the remainder of projected text starting at offset. */
function cursorForRemainder(resultId, pagesLabel, focus, offset) {
	return encodeReadCursor({
		v: 1,
		rid: resultId,
		pages: pagesLabel ?? "",
		focus: canonicalFocusList(focus),
		off: offset
	});
}
//#endregion
//#region src/service/mineru-service.ts
const MAX_POLL_TIMEOUT_MS$1 = 864e5;
const MAX_CONTENT_LIST_BYTES = 67108864;
var MinerUService = class {
	options;
	constructor(options) {
		this.options = options;
	}
	config() {
		return this.options.getConfig();
	}
	diagnostic(event) {
		emitDiagnostic(this.options.diagnostics, event);
	}
	async callContext(config, signal, operationId, allowMissingCredential = false) {
		signal.throwIfAborted();
		const reference = config.apiKeyEnv;
		const credential = reference === void 0 ? void 0 : await this.options.resolveCredential(reference, signal);
		signal.throwIfAborted();
		if (config.type === "official-v4" && credential === void 0 && !allowMissingCredential) throw new MinerUError(failure("CREDENTIAL_MISSING", `Credential ${config.apiKeyEnv} is not configured`));
		const current = this.config();
		return {
			signal,
			...credential === void 0 ? {} : { credential },
			timeoutMs: current.polling.requestTimeoutMs,
			retry: {
				maxRetries: current.retry.maxAttempts - 1,
				initialDelayMs: current.retry.baseDelayMs,
				maxDelayMs: current.retry.maxDelayMs,
				onRetry: (event) => {
					this.diagnostic({
						level: "warn",
						phase: "provider-retry",
						provider: event.provider,
						...operationId === void 0 ? {} : { operationId },
						providerOperation: event.operation,
						attempt: event.attempt,
						maxAttempts: event.maxRetries + 1,
						delayMs: event.delayMs,
						reason: event.reason,
						...event.status === void 0 ? {} : { status: event.status }
					});
				}
			},
			limits: {
				maxApiResponseBytes: current.limits.maxApiResponseBytes,
				maxZipDownloadBytes: current.limits.maxZipDownloadBytes,
				maxZipEntries: current.limits.maxZipEntries,
				maxZipEntryBytes: current.limits.maxZipEntryBytes,
				maxZipTotalBytes: current.limits.maxZipTotalBytes,
				maxZipCompressionRatio: current.limits.maxZipCompressionRatio
			}
		};
	}
	async probe(signal, draft) {
		const resolved = draft === void 0 ? this.options.providers.active() : {
			config: draft,
			provider: this.options.providers.create(draft)
		};
		const result = await resolved.provider.probe(await this.callContext(resolved.config, signal, void 0, true));
		return {
			available: result.available,
			provider: result.provider,
			authentication: result.authentication,
			protocol_version: result.protocolVersion,
			...result.serverVersion === void 0 ? {} : { server_version: result.serverVersion },
			...result.queue === void 0 ? {} : { queue: {
				...result.queue.queued === void 0 ? {} : { queued: result.queue.queued },
				...result.queue.processing === void 0 ? {} : { processing: result.queue.processing },
				...result.queue.completed === void 0 ? {} : { completed: result.queue.completed },
				...result.queue.failed === void 0 ? {} : { failed: result.queue.failed },
				...result.queue.maxConcurrent === void 0 ? {} : { max_concurrent: result.queue.maxConcurrent }
			} },
			...result.diagnostics === void 0 ? {} : { diagnostics: result.diagnostics }
		};
	}
	async prepare(session, input, signal) {
		const resolved = this.options.providers.active();
		const current = this.config();
		const normalizer = new RequestNormalizer({
			defaults: current.defaults,
			cwd: session.header.cwd,
			maxFileBytes: Math.min(current.limits.maxFileBytes, resolved.provider.capabilities.maxFileBytes ?? current.limits.maxFileBytes)
		});
		const backendInput = {
			...input,
			artifacts: input.artifacts,
			pages: void 0
		};
		const prepared = await normalizer.normalize(backendInput, signal);
		const file = prepared.request.files[0];
		if (file.bytes > current.limits.maxFileBytes) throw new MinerUError(failure("FILE_TOO_LARGE", `${file.name} exceeds the configured file-size limit`));
		validateProviderCapabilities(prepared.request, resolved.provider.capabilities);
		const compatibility = await resolved.provider.compatibilityKey(prepared.request, { configuredVersion: "configuredVersion" in resolved.config ? resolved.config.configuredVersion : void 0 });
		const markdownRequested = input.artifacts === void 0 || input.artifacts.includes("markdown");
		const cacheKey = computeCacheKey(prepared.request, file, compatibility);
		const hit = current.storage.cacheEnabled ? await this.options.results.get(cacheKey, prepared.request.requiredArtifacts, signal) : void 0;
		if (hit !== void 0) {
			const pending = {
				prepared,
				cacheKey,
				markdownRequested,
				inputPages: input.pages,
				inputFocus: input.focus,
				inputArtifacts: input.artifacts,
				source: "cache",
				resultId: hit.id
			};
			this.diagnostic({
				level: "info",
				phase: "cache-hit",
				provider: resolved.provider.id,
				bytes: file.bytes,
				cacheHit: true
			});
			return {
				pending,
				resolved,
				compatibility
			};
		}
		const reservation = this.options.operations.reserve(cacheKey, resolved.config.id, current.polling.operationTimeoutMs);
		const pending = {
			prepared,
			cacheKey,
			markdownRequested,
			inputPages: input.pages,
			inputFocus: input.focus,
			inputArtifacts: input.artifacts,
			source: reservation.created ? "provider" : "shared-operation",
			operation: reservation.operation,
			created: reservation.created
		};
		if (reservation.created) try {
			const cached = current.storage.cacheEnabled ? await this.options.results.get(cacheKey, prepared.request.requiredArtifacts, signal) : void 0;
			if (cached !== void 0) {
				pending.source = "cache";
				pending.resultId = cached.id;
				this.options.operations.start(reservation.operation, async () => ({
					state: "completed",
					resultId: cached.id
				}));
			} else this.options.operations.start(reservation.operation, (operation) => this.runOperation(operation, prepared, resolved, compatibility));
		} catch (error) {
			this.options.operations.release(reservation.operation, error);
			throw error;
		}
		return {
			pending,
			resolved,
			compatibility
		};
	}
	async runOperation(operation, prepared, resolved, compatibility) {
		const work = () => this.runOperationCore(operation, prepared, resolved, compatibility);
		return this.options.accessGate === void 0 ? await work() : await this.options.accessGate.runProducer(work, operation.controller.signal);
	}
	async runOperationCore(operation, prepared, resolved, compatibility) {
		let transaction;
		const startedAt = Date.now();
		const requestBytes = prepared.request.files.reduce((total, source) => total + source.bytes, 0);
		try {
			const cached = this.config().storage.cacheEnabled ? await this.options.results.get(operation.cacheKey, prepared.request.requiredArtifacts, operation.controller.signal) : void 0;
			if (cached !== void 0) {
				this.diagnostic({
					level: "info",
					phase: "cache-hit",
					provider: resolved.provider.id,
					operationId: operation.id,
					durationMs: Date.now() - startedAt,
					bytes: requestBytes,
					cacheHit: true,
					waiterCount: operation.waiterCount
				});
				return {
					state: "completed",
					resultId: cached.id
				};
			}
			await assertSourcesUnchanged(prepared.sources, operation.controller.signal);
			this.diagnostic({
				level: "info",
				phase: "uploading",
				provider: resolved.provider.id,
				operationId: operation.id,
				bytes: requestBytes,
				waiterCount: operation.waiterCount
			});
			const submission = await resolved.provider.submit(prepared.request, prepared.sources, await this.callContext(resolved.config, operation.controller.signal, operation.id));
			let snapshot = submission;
			const submissionFailure = snapshot.files.find((file) => file.failure)?.failure ?? failure("REMOTE_PARSE_FAILED", "Remote parse failed");
			this.diagnostic({
				level: snapshot.state === "failed" ? "warn" : "info",
				phase: "provider-accepted",
				provider: resolved.provider.id,
				operationId: operation.id,
				bytes: requestBytes,
				waiterCount: operation.waiterCount
			});
			if (snapshot.state === "failed") return {
				state: "failed",
				failure: submissionFailure
			};
			while (snapshot.state !== "completed" && snapshot.state !== "partially-completed") {
				await setTimeout$1(this.config().polling.pollIntervalMs, void 0, { signal: operation.controller.signal });
				snapshot = await resolved.provider.inspect(submission.ref, await this.callContext(resolved.config, operation.controller.signal, operation.id));
				if (snapshot.state === "failed") return {
					state: "failed",
					failure: snapshot.files.find((file) => file.failure)?.failure ?? failure("REMOTE_PARSE_FAILED", "Remote parse failed")
				};
			}
			this.diagnostic({
				level: "info",
				phase: "collecting",
				provider: resolved.provider.id,
				operationId: operation.id,
				durationMs: Date.now() - startedAt,
				bytes: requestBytes,
				waiterCount: operation.waiterCount
			});
			transaction = this.options.results.beginTransaction(operation.id, prepared.request, {
				providerId: resolved.provider.id,
				providerConfigId: resolved.config.id,
				compatibilityKey: compatibility
			}, operation.controller.signal);
			const collection = await resolved.provider.collect(submission.ref, prepared.request, transaction, await this.callContext(resolved.config, operation.controller.signal, operation.id));
			const file = prepared.request.files[0];
			const collected = collection.files.find((candidate) => candidate.fileId === file.fileId);
			if (collected === void 0 || collected.failure !== void 0) {
				await transaction.abort();
				transaction = void 0;
				return {
					state: "failed",
					failure: collected?.failure ?? failure("REMOTE_PARSE_FAILED", "Provider did not collect the requested file")
				};
			}
			const manifest = transaction.buildManifest(file, collected.artifacts);
			const published = await this.options.results.commitTransaction(transaction, manifest, operation.controller.signal);
			transaction = void 0;
			this.diagnostic({
				level: "info",
				phase: "published",
				provider: resolved.provider.id,
				operationId: operation.id,
				durationMs: Date.now() - startedAt,
				bytes: requestBytes,
				cacheHit: false,
				waiterCount: operation.waiterCount
			});
			return {
				state: "completed",
				resultId: published.resultId
			};
		} catch (error) {
			await transaction?.abort().catch(() => void 0);
			const normalized = toMinerUFailure(error);
			this.diagnostic({
				level: normalized.retryable ? "warn" : "error",
				phase: "failed",
				provider: resolved.provider.id,
				operationId: operation.id,
				durationMs: Date.now() - startedAt,
				bytes: requestBytes,
				waiterCount: operation.waiterCount,
				errorCode: normalized.code,
				retryable: normalized.retryable
			});
			return {
				state: "failed",
				failure: normalized
			};
		}
	}
	fitSingleCandidate(candidate, secondaryArtifacts, limit) {
		let view = candidate;
		let overhead = Math.max(JSON.stringify(view).length, formatResultProse(view).length);
		if (overhead <= limit) return view;
		const strippedFiles = view.files.map((f) => ({
			...f,
			artifacts: [],
			...secondaryArtifacts.length > 0 ? { artifacts_truncated: true } : {}
		}));
		view = {
			...view,
			files: strippedFiles
		};
		overhead = Math.max(JSON.stringify(view).length, formatResultProse(view).length);
		if (overhead > limit) throw new MinerUError(failure("RESULT_TOO_LARGE", "Result metadata exceeds configured model output limit"));
		return view;
	}
	async projectSingle(data, limit, cursorOffset = 0, cursorPayload, summaryOnly = false) {
		if (!data.markdownRequested) {
			const baseFiles = [{
				file_id: data.fileId,
				name: data.fileName,
				artifacts: [...data.secondaryArtifacts]
			}];
			const candidate = {
				state: "completed",
				source: data.item.source,
				cache_hit: data.item.source === "cache",
				result_id: data.manifest.id,
				files: baseFiles,
				content_status: "not_requested",
				manifest_path: data.manifestPath,
				output_limit_chars: limit
			};
			return this.fitSingleCandidate(candidate, data.secondaryArtifacts, limit);
		}
		const raw = await readMarkdownFile(data.markdownPath, data.markdownBytes ?? 0, limit, summaryOnly);
		if (!Number.isSafeInteger(cursorOffset) || cursorOffset < 0) throw new MinerUError(failure("INVALID_REQUEST", "Cursor offset is invalid; start over without a cursor"));
		const markdownArtifact = {
			kind: "markdown",
			path: data.markdownPath,
			bytes: data.markdownBytes ?? 0
		};
		const contentListArtifact = data.secondaryArtifacts.find((a) => a.kind === "content-list");
		let contentList;
		if (contentListArtifact) try {
			if (contentListArtifact.bytes > MAX_CONTENT_LIST_BYTES) throw new MinerUError(failure("RESULT_TOO_LARGE", "content-list artifact exceeds the bounded reader limit"));
			const rawJson = await readFile(contentListArtifact.path, "utf8");
			const parsed = JSON.parse(rawJson);
			const candidate = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null && Array.isArray(parsed.list) ? parsed.list : typeof parsed === "object" && parsed !== null && Array.isArray(parsed.content_list) ? parsed.content_list : void 0;
			if (candidate === void 0) throw new TypeError("content-list must be an array or contain list/content_list");
			for (const block of candidate) {
				if (typeof block !== "object" || block === null || Array.isArray(block)) throw new TypeError("content-list contains a malformed block");
				const page = block.page_idx;
				if (page !== void 0 && (!Number.isSafeInteger(page) || page < 0)) throw new TypeError("content-list contains an invalid page_idx");
				const type = block.type;
				if (type !== void 0 && typeof type !== "string") throw new TypeError("content-list contains an invalid type");
			}
			contentList = candidate;
		} catch (error) {
			if (error instanceof MinerUError) throw error;
			throw new MinerUError(failure("INVALID_REQUEST", "Malformed content-list artifact; cannot provide a reliable selection"), { cause: error });
		}
		const rawPagesSet = normalizePageSelection(data.inputPages);
		const focusSet = normalizeFocusSelection(data.inputFocus);
		const artifactsRequested = focusSet.has("artifacts") || data.inputArtifacts !== void 0 && data.inputArtifacts.some((k) => k !== "markdown");
		let docSummary;
		let toc;
		let pagesSet = rawPagesSet;
		let pagesLabel;
		const warnings = [];
		if (contentList && contentList.length > 0) {
			docSummary = computeDocumentSummary(contentList, raw.text);
			toc = docSummary.toc;
			if (rawPagesSet !== void 0 && docSummary.page_count === void 0) throw new MinerUError(failure("INVALID_REQUEST", "[SELECTION_UNAVAILABLE] The content-list has no usable page coordinates; start over without pages"));
			const narrowed = narrowPageSelection(rawPagesSet, docSummary.page_count);
			if (narrowed.fullyOutOfRange) throw new MinerUError(failure("INVALID_REQUEST", "[PAGE_OUT_OF_RANGE] Requested pages are outside the document page range"));
			if (narrowed.outOfRange.length > 0) warnings.push(`Some requested pages are outside the document range: ${narrowed.outOfRange.join(", ")}`);
			pagesSet = narrowed.pagesSet;
			pagesLabel = rawPagesSet === void 0 ? void 0 : narrowed.pagesLabel;
		} else {
			if (rawPagesSet !== void 0 || !focusSet.has("all") && (focusSet.has("text") || focusSet.has("table") || focusSet.has("image"))) throw new MinerUError(failure("INVALID_REQUEST", "[SELECTION_UNAVAILABLE] The result has no usable content-list page/type mapping; start over with a result that includes content-list"));
			docSummary = {
				table_count: 0,
				image_count: 0,
				equation_count: 0
			};
			pagesSet = void 0;
			pagesLabel = void 0;
		}
		if (summaryOnly && contentList === void 0) return {
			state: "completed",
			source: data.item.source,
			cache_hit: data.item.source === "cache",
			result_id: data.manifest.id,
			files: [{
				file_id: data.fileId,
				name: data.fileName,
				artifacts: []
			}],
			content_status: "not_requested",
			manifest_path: data.manifestPath,
			output_limit_chars: limit
		};
		if (focusSet.size === 1 && focusSet.has("artifacts")) {
			const baseFiles = [{
				file_id: data.fileId,
				name: data.fileName,
				artifacts: [markdownArtifact, ...data.secondaryArtifacts],
				markdown_path: data.markdownPath
			}];
			const candidate = {
				state: "completed",
				source: data.item.source,
				cache_hit: data.item.source === "cache",
				result_id: data.manifest.id,
				files: baseFiles,
				content_status: "not_requested",
				markdown_path: data.markdownPath,
				manifest_path: data.manifestPath,
				output_limit_chars: limit,
				...docSummary !== void 0 ? { summary: docSummary } : {},
				pages: pagesLabel
			};
			return this.fitSingleCandidate(candidate, data.secondaryArtifacts, limit);
		}
		if (summaryOnly && contentList !== void 0) return {
			state: "completed",
			source: data.item.source,
			cache_hit: data.item.source === "cache",
			result_id: data.manifest.id,
			files: [{
				file_id: data.fileId,
				name: data.fileName,
				artifacts: []
			}],
			content_status: "not_requested",
			manifest_path: data.manifestPath,
			output_limit_chars: limit,
			...docSummary === void 0 ? {} : { summary: docSummary },
			...pagesLabel === void 0 ? {} : { pages: pagesLabel }
		};
		const imageArtifacts = data.secondaryArtifacts.filter((a) => a.kind === "images");
		let fullSourceText = "";
		let orderedImages = [];
		if (contentList && contentList.length > 0) {
			const extracted = extractBlocksMarkdown(contentList, pagesSet, focusSet, imageArtifacts);
			fullSourceText = extracted.text;
			orderedImages = extracted.orderedImages;
		} else {
			let rawText = raw.text;
			const fallback = fallbackExtractFromMarkdown(rawText, imageArtifacts);
			fullSourceText = fallback.text;
			orderedImages = fallback.orderedImages;
			if (!focusSet.has("all") && !focusSet.has("image")) orderedImages = [];
			docSummary = fallback.summary;
			toc = fallback.summary.toc;
		}
		if (summaryOnly) return {
			state: "completed",
			source: data.item.source,
			cache_hit: data.item.source === "cache",
			result_id: data.manifest.id,
			files: [{
				file_id: data.fileId,
				name: data.fileName,
				artifacts: []
			}],
			content_status: "not_requested",
			manifest_path: data.manifestPath,
			output_limit_chars: limit,
			...docSummary === void 0 ? {} : { summary: docSummary },
			...pagesLabel === void 0 ? {} : { pages: pagesLabel }
		};
		if (focusSet.has("toc")) {
			const filteredToc = pagesSet !== void 0 && toc !== void 0 ? toc.filter((h) => h.page !== void 0 ? pagesSet.has(h.page) : true) : toc;
			const tocMd = formatTocMarkdown(filteredToc, { pageRange: pagesLabel });
			if (!focusSet.has("all") && !focusSet.has("text") && !focusSet.has("table") && !focusSet.has("image")) {
				fullSourceText = tocMd;
				orderedImages = [];
			} else fullSourceText = fullSourceText.trim().length > 0 ? `${tocMd}\n\n---\n\n${fullSourceText}` : tocMd;
			toc = filteredToc;
		}
		const skeleton = {
			state: "completed",
			source: data.item.source,
			cache_hit: data.item.source === "cache",
			result_id: data.manifest.id,
			files: [{
				file_id: data.fileId,
				name: data.fileName,
				artifacts: [markdownArtifact],
				markdown_path: data.markdownPath
			}],
			content_status: "complete",
			markdown_path: data.markdownPath,
			manifest_path: data.manifestPath,
			output_limit_chars: limit,
			markdown_content: "",
			ordered_images: orderedImages,
			summary: docSummary,
			toc,
			pages: pagesLabel
		};
		let overhead = Math.max(JSON.stringify(skeleton).length, formatResultProse(skeleton).length);
		if (fullSourceText.length > Math.max(0, limit - overhead)) overhead += 2304;
		let baseArtifacts = [markdownArtifact];
		let baseArtifactsTruncated = false;
		if (overhead > limit) {
			const strippedSkeleton = {
				...skeleton,
				files: [{
					file_id: data.fileId,
					name: data.fileName,
					artifacts: [],
					artifacts_truncated: true,
					markdown_path: data.markdownPath
				}]
			};
			overhead = Math.max(JSON.stringify(strippedSkeleton).length, formatResultProse(strippedSkeleton).length);
			if (overhead > limit) throw new MinerUError(failure("RESULT_TOO_LARGE", "Result metadata exceeds configured model output limit"));
			baseArtifacts = [];
			baseArtifactsTruncated = true;
		}
		const avail = Math.max(0, limit - overhead);
		const textBudget = Math.floor(avail / 1.05);
		let contentStatus;
		let content;
		let nextCursor;
		let artifactsTruncated = baseArtifactsTruncated;
		const sourceOffset = cursorPayload?.off ?? cursorOffset;
		if (sourceOffset > fullSourceText.length) throw new MinerUError(failure("INVALID_REQUEST", "Cursor does not match the published result; start over without a cursor"));
		if (sourceOffset > 0 && (fullSourceText.charCodeAt(sourceOffset - 1) >= 55296 && fullSourceText.charCodeAt(sourceOffset - 1) <= 56319 || fullSourceText.charCodeAt(sourceOffset) >= 56320 && fullSourceText.charCodeAt(sourceOffset) <= 57343)) throw new MinerUError(failure("INVALID_REQUEST", "Cursor splits a Unicode character; start over without a cursor"));
		const remainingText = fullSourceText.slice(sourceOffset);
		if (remainingText.length <= textBudget) {
			contentStatus = "complete";
			content = remainingText;
		} else {
			contentStatus = "partial";
			const cut = truncateAtCleanBoundary(remainingText, textBudget);
			content = cut.text;
			const nextOffset = sourceOffset + cut.text.length;
			if (nextOffset <= sourceOffset) throw new MinerUError(failure("RESULT_TOO_LARGE", "Output limit cannot make progress through the document"));
			nextCursor = cursorForRemainder(data.manifest.id, pagesLabel, focusSet, nextOffset);
			if (artifactsRequested && data.secondaryArtifacts.length > 0) artifactsTruncated = true;
			if (!toc || toc.length === 0) toc = extractMarkdownHeadings(fullSourceText);
		}
		let finalArtifacts = baseArtifacts;
		if (artifactsRequested && contentStatus === "complete" && !baseArtifactsTruncated && data.secondaryArtifacts.length > 0) {
			const withSecondary = [markdownArtifact, ...data.secondaryArtifacts];
			const testView = {
				state: "completed",
				source: data.item.source,
				cache_hit: data.item.source === "cache",
				result_id: data.manifest.id,
				files: [{
					file_id: data.fileId,
					name: data.fileName,
					artifacts: withSecondary,
					markdown_path: data.markdownPath
				}],
				content_status: contentStatus,
				markdown_path: data.markdownPath,
				manifest_path: data.manifestPath,
				output_limit_chars: limit,
				markdown_content: content,
				ordered_images: orderedImages,
				summary: docSummary
			};
			if (JSON.stringify(testView).length <= limit && formatResultProse(testView).length <= limit) finalArtifacts = withSecondary;
			else artifactsTruncated = true;
		}
		let view = {
			state: "completed",
			source: data.item.source,
			cache_hit: data.item.source === "cache",
			result_id: data.manifest.id,
			files: [{
				file_id: data.fileId,
				name: data.fileName,
				artifacts: finalArtifacts,
				...artifactsTruncated ? { artifacts_truncated: true } : {},
				markdown_path: data.markdownPath
			}],
			content_status: contentStatus,
			markdown_path: data.markdownPath,
			...nextCursor !== void 0 ? { cursor: nextCursor } : {},
			...warnings.length > 0 ? { warnings } : {},
			manifest_path: data.manifestPath,
			output_limit_chars: limit,
			markdown_content: content,
			ordered_images: orderedImages,
			summary: docSummary,
			...contentStatus === "partial" || contentStatus === "complete" ? { toc } : {},
			pages: pagesLabel
		};
		while (JSON.stringify(view).length > limit || formatResultProse(view).length > limit) if (view.files[0]?.artifacts.length && view.files[0].artifacts.length > 0) view = {
			...view,
			files: [{
				...view.files[0],
				artifacts: [],
				...artifactsRequested ? { artifacts_truncated: true } : {}
			}]
		};
		else if (view.summary !== void 0 || view.ordered_images !== void 0 && view.ordered_images.length > 0) view = {
			...view,
			summary: void 0,
			ordered_images: void 0
		};
		else if (view.markdown_content && view.markdown_content.length > 0) {
			const excess = Math.max(JSON.stringify(view).length - limit, formatResultProse(view).length - limit, 10);
			const cut = truncateAtCleanBoundary(remainingText, Math.max(0, view.markdown_content.length - excess));
			const activeToc = view.toc ?? docSummary?.toc ?? extractMarkdownHeadings(fullSourceText);
			view = {
				...view,
				content_status: "partial",
				markdown_content: cut.text,
				toc: activeToc,
				cursor: cursorForRemainder(data.manifest.id, pagesLabel, focusSet, sourceOffset + cut.text.length)
			};
		} else if (view.toc && view.toc.length > 0) {
			const nextToc = view.toc.slice(0, Math.max(0, Math.floor(view.toc.length / 2)));
			view = {
				...view,
				...nextToc.length > 0 ? { toc: nextToc } : { toc: void 0 }
			};
		} else throw new MinerUError(failure("RESULT_TOO_LARGE", "Result metadata exceeds configured model output limit"));
		return view;
	}
	createWaitSignal(signal, pollTimeoutMs) {
		const timeout = pollTimeoutMs === null ? void 0 : pollTimeoutMs ?? this.config().polling.pollTimeoutMs;
		if (timeout !== void 0 && (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > MAX_POLL_TIMEOUT_MS$1)) throw new MinerUError(failure("INVALID_REQUEST", "poll timeout is outside the supported range"));
		const controller = new AbortController();
		let didTimeOut = false;
		const onAbort = () => controller.abort(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) controller.abort(signal.reason);
		const timer = timeout === void 0 ? void 0 : setTimeout(() => {
			didTimeOut = true;
			controller.abort(new MinerUError(failure("POLL_TIMEOUT", "Synchronous MinerU wait timed out", true)));
		}, timeout);
		timer?.unref?.();
		return {
			signal: controller.signal,
			timedOut: () => didTimeOut,
			dispose: () => {
				if (timer !== void 0) clearTimeout(timer);
				signal.removeEventListener("abort", onAbort);
			}
		};
	}
	/** Parse directly to immutable results. No plugin Job is created for this call. */
	async parseDocument(session, input, signal, pollTimeoutMs, summaryOnly = false) {
		let cursorPayload;
		if (input.cursor !== void 0) {
			try {
				cursorPayload = decodeReadCursor(input.cursor);
			} catch (error) {
				throw new MinerUError(failure("INVALID_REQUEST", error instanceof Error ? error.message : "Cursor is malformed; start over without a cursor"), { cause: error });
			}
			if (input.pages !== void 0 || input.focus !== void 0) throw new MinerUError(failure("INVALID_REQUEST", "pages and focus must be omitted when cursor is provided"));
		}
		const effectiveInput = cursorPayload === void 0 ? input : {
			...input,
			pages: cursorPayload.pages === "" ? void 0 : cursorPayload.pages,
			focus: cursorPayload.focus
		};
		const { pending } = await this.prepare(session, effectiveInput, signal);
		const wait = this.createWaitSignal(signal, pollTimeoutMs);
		let outcome;
		try {
			if (pending.resultId !== void 0) outcome = {
				state: "completed",
				resultId: pending.resultId
			};
			else if (pending.operation === void 0) throw new TypeError("Pending parse has no result or shared operation");
			else outcome = await pending.operation.waitForOutcome(wait.signal);
		} catch (error) {
			if (signal.aborted) throw signal.reason ?? error;
			if (wait.timedOut()) throw new MinerUError(failure("POLL_TIMEOUT", "Synchronous MinerU wait timed out; retry the same request to rejoin the shared operation", true));
			throw error;
		} finally {
			wait.dispose();
		}
		if (outcome.state === "failed" || outcome.resultId === void 0) throw new MinerUError(outcome.failure ?? failure("REMOTE_PARSE_FAILED", "Remote parse failed"));
		const manifest = await this.options.results.get(pending.cacheKey, pending.prepared.request.requiredArtifacts, signal);
		if (manifest === void 0 || manifest.id !== outcome.resultId) throw new MinerUError(failure("CACHE_EVICTED", "Published MinerU result is missing or corrupt"));
		if (cursorPayload !== void 0 && cursorPayload.rid !== String(manifest.id)) throw new MinerUError(failure("INVALID_REQUEST", "Cursor result identity does not match the published result; start over without a cursor"));
		const document = manifest.files[0];
		const markdownRequested = pending.markdownRequested;
		const markdownRef = document.artifacts.find((artifact) => artifact.kind === "markdown");
		if (markdownRequested && markdownRef === void 0) throw new MinerUError(failure("REMOTE_PARSE_FAILED", "Extracted markdown artifact is missing from result"));
		const markdownPath = markdownRef !== void 0 ? this.options.results.resolveArtifactAbsolutePath(pending.cacheKey, markdownRef.relativePath) : void 0;
		const manifestPath = this.options.results.manifestAbsolutePath(pending.cacheKey);
		const secondaryArtifacts = document.artifacts.filter((a) => a.kind !== "markdown").map((a) => ({
			kind: a.kind,
			path: this.options.results.resolveArtifactAbsolutePath(pending.cacheKey, a.relativePath),
			bytes: a.bytes
		}));
		const rawItem = {
			state: "completed",
			item: pending,
			manifest,
			fileId: document.fileId,
			fileName: pending.prepared.request.files[0]?.name ?? document.name,
			markdownRequested,
			markdownPath,
			markdownBytes: markdownRef?.bytes,
			manifestPath,
			secondaryArtifacts,
			inputPages: pending.inputPages,
			inputFocus: pending.inputFocus,
			inputArtifacts: pending.inputArtifacts
		};
		const limit = this.config().output.maxInlineChars;
		return await this.projectSingle(rawItem, limit, cursorPayload?.off ?? 0, cursorPayload, summaryOnly);
	}
};
//#endregion
//#region src/domain/result.ts
const MINERU_RESULT_MANIFEST_SCHEMA_VERSION = 1;
//#endregion
//#region src/domain/schemas.ts
/**
* schemas.ts — Strict runtime parsers and validators for persistent domain JSON records.
*
* Enforces:
*   - Pinned schemaVersion validation (unknown versions rejected)
*   - Closed record shapes (additional/unknown properties rejected)
*   - Safe, branded identifier validation
*   - Clean POSIX relative paths for artifact references (rejection of traversal, absolute paths, NUL, backslashes)
*   - Elimination of local source paths, tokens, query parameters, presigned/CDN URLs from persistent records
*/
const VALID_MODELS = /* @__PURE__ */ new Set(["pipeline", "vlm"]);
const VALID_PARSE_METHODS = /* @__PURE__ */ new Set([
	"auto",
	"txt",
	"ocr"
]);
const VALID_PROVIDERS = /* @__PURE__ */ new Set(["self-hosted-v2", "official-v4"]);
const VALID_ARTIFACT_KINDS = new Set(ARTIFACT_KINDS);
const SHA256_HEX = /^[a-f0-9]{64}$/;
const PAGE_RANGES = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const URL_OR_SECRET_PATTERN = /(?:https?:\/\/|Bearer\s+|[?&\0\r\n])/i;
function assertPlainObject(value, label) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
	const proto = Reflect.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) throw new TypeError(`${label} must be a plain object`);
	return value;
}
function assertNoAdditionalProperties(record, allowedKeys, label) {
	const allowed = new Set(allowedKeys);
	for (const key of Object.keys(record)) if (!allowed.has(key)) throw new TypeError(`unknown property "${key}" in ${label}`);
}
function assertNonEmptyString(value, label) {
	if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be a non-empty string`);
	return value;
}
function assertNonNegativeSafeInteger(value, label) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
	return value;
}
function assertSha256(value, label = "SHA-256 digest") {
	if (typeof value !== "string" || !SHA256_HEX.test(value)) throw new TypeError(`${label} must be a 64-character lowercase hexadecimal SHA-256 digest`);
	return value;
}
function assertNoUrlOrSecret(value, label) {
	if (URL_OR_SECRET_PATTERN.test(value)) throw new TypeError(`${label} must not contain URLs, credentials, query parameters, or control characters`);
	return value;
}
function assertSafeFileName(value, label = "file name") {
	assertNonEmptyString(value, label);
	const str = value;
	if (str.length > 255 || /[\u0000-\u001f\u007f]/.test(str)) throw new TypeError(`${label} contains control characters or exceeds 255 characters`);
	if (str.includes("/") || str.includes("\\") || str === "." || str === "..") throw new TypeError(`${label} "${str}" must not contain path separators or traversal segments`);
	return str;
}
function assertSafeArtifactRelativePath(value, label = "artifact relativePath") {
	assertNonEmptyString(value, label);
	const path = value;
	assertNoUrlOrSecret(path, label);
	if (path.startsWith("/") || path.startsWith("\\") || path.startsWith("./") || path.startsWith("../")) throw new TypeError(`${label} "${path}" must be a relative path and cannot start with / or ./ or ../`);
	if (path.includes("\\") || path.includes("//") || path.includes("\0")) throw new TypeError(`${label} "${path}" contains invalid path separators or control characters`);
	const segments = path.split("/");
	for (const seg of segments) if (!seg || seg === "." || seg === ".." || !SAFE_PATH_SEGMENT.test(seg)) throw new TypeError(`${label} "${path}" contains invalid or traversal path segment "${seg}"`);
	return path;
}
function parseArtifactKind(input) {
	if (typeof input !== "string" || !VALID_ARTIFACT_KINDS.has(input)) throw new TypeError(`invalid artifact kind: "${String(input)}"`);
	return input;
}
function parseParseSemantics(input) {
	const obj = assertPlainObject(input, "ParseSemantics");
	assertNoAdditionalProperties(obj, [
		"model",
		"ocr",
		"parseMethod",
		"language",
		"formula",
		"table",
		"pages"
	], "ParseSemantics");
	const model = obj["model"];
	if (typeof model !== "string" || !VALID_MODELS.has(model)) throw new TypeError(`invalid ParseSemantics.model: "${String(model)}"`);
	const ocr = obj["ocr"];
	if (typeof ocr !== "boolean") throw new TypeError("ParseSemantics.ocr must be a boolean");
	const parseMethod = obj["parseMethod"];
	if (typeof parseMethod !== "string" || !VALID_PARSE_METHODS.has(parseMethod)) throw new TypeError(`invalid ParseSemantics.parseMethod: "${String(parseMethod)}"`);
	if (ocr !== (parseMethod === "ocr")) throw new TypeError("ParseSemantics.ocr must agree with ParseSemantics.parseMethod");
	const language = assertNonEmptyString(obj["language"], "ParseSemantics.language");
	assertNoUrlOrSecret(language, "ParseSemantics.language");
	const formula = obj["formula"];
	if (typeof formula !== "boolean") throw new TypeError("ParseSemantics.formula must be a boolean");
	const table = obj["table"];
	if (typeof table !== "boolean") throw new TypeError("ParseSemantics.table must be a boolean");
	let pages;
	if (obj["pages"] !== void 0) {
		const rawPages = assertNonEmptyString(obj["pages"], "ParseSemantics.pages");
		if (!PAGE_RANGES.test(rawPages) || normalizePageRanges(rawPages) !== rawPages) throw new TypeError(`ParseSemantics.pages is not canonical: "${rawPages}"`);
		pages = rawPages;
	}
	return {
		model,
		ocr,
		parseMethod,
		language,
		formula,
		table,
		...pages === void 0 ? {} : { pages }
	};
}
function parseCanonicalSourceFile(input) {
	const obj = assertPlainObject(input, "CanonicalSourceFile");
	assertNoAdditionalProperties(obj, [
		"fileId",
		"name",
		"bytes",
		"sha256"
	], "CanonicalSourceFile");
	return {
		fileId: asFileId(assertNonEmptyString(obj["fileId"], "CanonicalSourceFile.fileId")),
		name: assertSafeFileName(obj["name"], "CanonicalSourceFile.name"),
		bytes: assertNonNegativeSafeInteger(obj["bytes"], "CanonicalSourceFile.bytes"),
		sha256: assertSha256(obj["sha256"], "CanonicalSourceFile.sha256")
	};
}
function parseCanonicalParseRequest(input) {
	const obj = assertPlainObject(input, "CanonicalParseRequest");
	assertNoAdditionalProperties(obj, [
		"schemaVersion",
		"files",
		"semantics",
		"requiredArtifacts"
	], "CanonicalParseRequest");
	if (obj["schemaVersion"] !== 1) throw new TypeError(`invalid CanonicalParseRequest schemaVersion: expected 1, got ${String(obj["schemaVersion"])}`);
	if (!Array.isArray(obj["files"]) || obj["files"].length === 0) throw new TypeError("CanonicalParseRequest.files must be a non-empty array");
	const files = obj["files"].map((f) => parseCanonicalSourceFile(f));
	const semantics = parseParseSemantics(obj["semantics"]);
	if (!Array.isArray(obj["requiredArtifacts"]) || obj["requiredArtifacts"].length === 0) throw new TypeError("CanonicalParseRequest.requiredArtifacts must be a non-empty array");
	const requiredArtifacts = obj["requiredArtifacts"].map((k) => parseArtifactKind(k));
	if (new Set(requiredArtifacts).size !== requiredArtifacts.length) throw new TypeError("CanonicalParseRequest.requiredArtifacts cannot contain duplicates");
	const normalizedArtifacts = normalizeArtifactKinds(requiredArtifacts);
	if (normalizedArtifacts.length !== requiredArtifacts.length || normalizedArtifacts.some((kind, index) => kind !== requiredArtifacts[index])) throw new TypeError("CanonicalParseRequest.requiredArtifacts must be canonical and include markdown");
	return {
		schemaVersion: 1,
		files,
		semantics,
		requiredArtifacts
	};
}
function parseArtifactRef(input) {
	const obj = assertPlainObject(input, "ArtifactRef");
	assertNoAdditionalProperties(obj, [
		"kind",
		"relativePath",
		"mediaType",
		"bytes",
		"sha256"
	], "ArtifactRef");
	const kind = obj["kind"];
	if (typeof kind !== "string" || kind !== "manifest" && !VALID_ARTIFACT_KINDS.has(kind)) throw new TypeError(`invalid ArtifactRef.kind: "${String(kind)}"`);
	return {
		kind,
		relativePath: assertSafeArtifactRelativePath(obj["relativePath"], "ArtifactRef.relativePath"),
		mediaType: assertNoUrlOrSecret(assertNonEmptyString(obj["mediaType"], "ArtifactRef.mediaType"), "ArtifactRef.mediaType"),
		bytes: assertNonNegativeSafeInteger(obj["bytes"], "ArtifactRef.bytes"),
		sha256: assertSha256(obj["sha256"], "ArtifactRef.sha256")
	};
}
function parseParsedDocumentManifest(input) {
	const obj = assertPlainObject(input, "ParsedDocumentManifest");
	assertNoAdditionalProperties(obj, [
		"fileId",
		"name",
		"artifacts"
	], "ParsedDocumentManifest");
	const fileId = asFileId(assertNonEmptyString(obj["fileId"], "ParsedDocumentManifest.fileId"));
	const name = assertSafeFileName(obj["name"], "ParsedDocumentManifest.name");
	if (!Array.isArray(obj["artifacts"]) || obj["artifacts"].length === 0) throw new TypeError("ParsedDocumentManifest.artifacts must be a non-empty array");
	return {
		fileId,
		name,
		artifacts: obj["artifacts"].map((a) => parseArtifactRef(a))
	};
}
function parseResultProducer(input) {
	const obj = assertPlainObject(input, "ResultProducer");
	assertNoAdditionalProperties(obj, [
		"providerId",
		"providerConfigId",
		"compatibilityKey"
	], "ResultProducer");
	const providerId = obj["providerId"];
	if (typeof providerId !== "string" || !VALID_PROVIDERS.has(providerId)) throw new TypeError(`invalid ResultProducer.providerId: "${String(providerId)}"`);
	return {
		providerId,
		providerConfigId: asProviderConfigId(assertNonEmptyString(obj["providerConfigId"], "ResultProducer.providerConfigId")),
		compatibilityKey: assertNoUrlOrSecret(assertNonEmptyString(obj["compatibilityKey"], "ResultProducer.compatibilityKey"), "ResultProducer.compatibilityKey")
	};
}
function parseMinerUResultManifest(input) {
	const obj = assertPlainObject(input, "MinerUResultManifest");
	assertNoAdditionalProperties(obj, [
		"schemaVersion",
		"id",
		"cacheKey",
		"sourceSha256",
		"request",
		"producer",
		"files",
		"createdAt"
	], "MinerUResultManifest");
	if (obj["schemaVersion"] !== 1) throw new TypeError(`invalid MinerUResultManifest schemaVersion: expected 1, got ${String(obj["schemaVersion"])}`);
	const id = asResultId(assertNonEmptyString(obj["id"], "MinerUResultManifest.id"));
	const cacheKey = asCacheKey(assertNonEmptyString(obj["cacheKey"], "MinerUResultManifest.cacheKey"));
	const sourceSha256 = assertSha256(obj["sourceSha256"], "MinerUResultManifest.sourceSha256");
	const request = parseCanonicalParseRequest(obj["request"]);
	const producer = parseResultProducer(obj["producer"]);
	if (!Array.isArray(obj["files"]) || obj["files"].length !== 1) throw new TypeError("MinerUResultManifest.files must be a tuple with exactly one ParsedDocumentManifest");
	return {
		schemaVersion: 1,
		id,
		cacheKey,
		sourceSha256,
		request,
		producer,
		files: [parseParsedDocumentManifest(obj["files"][0])],
		createdAt: assertNonNegativeSafeInteger(obj["createdAt"], "MinerUResultManifest.createdAt")
	};
}
//#endregion
//#region src/storage/paths.ts
/**
* paths.ts — Validated filesystem layout and path derivation for MinerU storage.
*
* Enforces:
*   - Strict identifier validation before path concatenation (prevents path traversal)
*   - Relative POSIX artifact path containment within result/staging roots
*   - Safe, deterministic directory layout documented in ARCHITECTURE.md
*/
function defaultStorageRoot() {
	const configured = process.env.DSH_HOME?.trim();
	const dshHome = !configured ? join(homedir(), ".dsh") : configured === "~" ? homedir() : configured.startsWith("~/") || configured.startsWith("~\\") ? resolve(join(homedir(), configured.slice(2))) : resolve(configured);
	return join(dshHome, "cache", "pdf-mineru");
}
var StoragePaths = class {
	root;
	constructor(root = defaultStorageRoot()) {
		if (!root || typeof root !== "string" || root.trim() === "") throw new TypeError("Storage root path must be a non-empty string");
		this.root = resolve(root);
	}
	resultsDir() {
		return join(this.root, "results", "sha256");
	}
	resultDir(cacheKey) {
		const key = asCacheKey(cacheKey);
		return join(this.resultsDir(), key.slice(0, 2), key);
	}
	manifestFile(cacheKey) {
		return join(this.resultDir(cacheKey), "manifest.json");
	}
	filesDir(cacheKey) {
		return join(this.resultDir(cacheKey), "files");
	}
	fileDir(cacheKey, fileId) {
		const fid = asFileId(fileId);
		return join(this.filesDir(cacheKey), fid);
	}
	stagingDir(operationId) {
		if (operationId === void 0) return join(this.root, "staging");
		const op = asOperationId(operationId);
		return join(this.root, "staging", op);
	}
	stagingFilesDir(operationId) {
		return join(this.stagingDir(operationId), "files");
	}
	stagingFileDir(operationId, fileId) {
		const fid = asFileId(fileId);
		return join(this.stagingFilesDir(operationId), fid);
	}
	stagingTempDir(operationId) {
		return join(this.stagingDir(operationId), "temp");
	}
	stagingManifestFile(operationId) {
		return join(this.stagingDir(operationId), "manifest.json");
	}
	quarantineDir(name) {
		if (name === void 0) return join(this.root, "quarantine");
		const safeName = assertSafePathSegment(name, "quarantine name");
		return join(this.root, "quarantine", safeName);
	}
	processLockFile() {
		return join(this.root, ".process.lock");
	}
	/** v2 bakery lock state directory (<root>/.lock). */
	lockDir() {
		return join(this.root, ".lock");
	}
	/** v2 bakery claim directory (<root>/.lock/claims). */
	lockClaimsDir() {
		return join(this.lockDir(), "claims");
	}
	/** Cross-process storage use records (<root>/.lock/users). */
	lockUsersDir() {
		return join(this.lockDir(), "users");
	}
	resolveArtifactPath(cacheKey, relativePath) {
		assertSafeArtifactRelativePath(relativePath);
		const base = this.resultDir(cacheKey);
		const target = resolve(base, relativePath);
		if (!target.startsWith(base + sep)) throw new TypeError(`artifact relative path "${relativePath}" escapes result directory`);
		return target;
	}
	resolveStagingArtifactPath(operationId, relativePath) {
		assertSafeArtifactRelativePath(relativePath);
		const base = this.stagingDir(operationId);
		const target = resolve(base, relativePath);
		if (!target.startsWith(base + sep)) throw new TypeError(`artifact relative path "${relativePath}" escapes staging directory`);
		return target;
	}
};
//#endregion
//#region src/storage/process-lock.ts
/**
* Scoped local-filesystem Lamport bakery mutex. Requires one host/PID namespace
* and coherent local directory operations (not NFS/distributed locking).
* Each attempt owns a never-reused directory. Reclamation can delete only a
* confirmed-dead owner's unique directory, never a shared/reused lock pathname.
*/
const scopeBrand = Symbol("MinerU mutation scope");
const HOST = createHash("sha256").update(hostname().toLowerCase()).digest("hex");
const OWNER_ID = /^([cu])_([0-9a-f]{64})_([1-9][0-9]{0,9})_([0-9a-f]{32})$/;
const MAX_CLAIMS = 256;
const FENCE = Object.freeze({
	pid: 1,
	ownerToken: "mineru-lock-protocol-v2",
	createdAt: 0,
	hostname: "mineru-lock-protocol-v2:" + HOST
});
function createStorageOwnerId(prefix, pid = process.pid) {
	if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2147483647) throw new TypeError("Invalid storage owner PID");
	return `${prefix}_${HOST}_${pid}_${randomUUID().replaceAll("-", "")}`;
}
function storageOwnerState(id) {
	const match = OWNER_ID.exec(id);
	if (match === null) return "unknown";
	if (match[2] !== HOST) return "foreign";
	const pid = Number(match[3]);
	if (!Number.isSafeInteger(pid) || pid > 2147483647) return "unknown";
	try {
		process.kill(pid, 0);
		return "live";
	} catch (error) {
		return errno(error) === "ESRCH" ? "dead" : "unknown";
	}
}
function errno(error) {
	return error?.code;
}
function locked(message) {
	return new MinerUError(failure("STORAGE_LOCKED", message));
}
/** No symlink is accepted in the configured root or coordination ancestry. */
async function ensureDirectory(path) {
	const absolute = resolve(path);
	const root = parse(absolute).root;
	const parts = [];
	for (let current = absolute; current !== root; current = dirname(current)) parts.push(current);
	for (const current of [root, ...parts.reverse()]) {
		if (current !== root) try {
			await mkdir(current, { mode: 448 });
		} catch (error) {
			if (errno(error) !== "EEXIST") throw locked("Storage coordination directory could not be created");
		}
		const details = await lstat(current);
		if (!details.isDirectory() || details.isSymbolicLink()) throw locked("Storage coordination paths must be real directories, not symlinks");
	}
}
async function readSmallFile(path, maxBytes) {
	let handle;
	try {
		const before = await lstat(path);
		if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw locked("Invalid storage coordination record");
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const current = await handle.stat();
		if (!current.isFile() || current.size > maxBytes || before.ino !== current.ino || before.dev !== current.dev) throw locked("Storage coordination record changed while opening");
		const buffer = Buffer.alloc(maxBytes + 1);
		let total = 0;
		while (total < buffer.length) {
			const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
			if (bytesRead === 0) break;
			total += bytesRead;
		}
		if (total > maxBytes) throw locked("Storage coordination record exceeds its size limit");
		return buffer.subarray(0, total).toString("utf8");
	} catch (error) {
		if (errno(error) === "ENOENT") return void 0;
		if (error instanceof MinerUError) throw error;
		throw locked("Storage coordination record cannot be safely read");
	} finally {
		await handle?.close();
	}
}
var ProcessLock = class {
	paths;
	lockDir;
	claimsDir;
	timeoutMs;
	pollMs;
	queueTail = Promise.resolve();
	activeScope;
	manualLease;
	constructor(paths, options = {}) {
		this.paths = paths;
		this.lockDir = join(paths.root, ".lock");
		this.claimsDir = join(this.lockDir, "claims");
		this.timeoutMs = options.acquireTimeoutMs ?? 5e3;
		this.pollMs = options.pollIntervalMs ?? 15;
		if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 12e4 || !Number.isSafeInteger(this.pollMs) || this.pollMs < 1 || this.pollMs > 5e3) throw new TypeError("Invalid storage lock timeout or poll interval");
	}
	/** Diagnostic only. Never grants another invocation mutation authority. */
	isHeld() {
		return this.activeScope !== void 0;
	}
	get lockFilePath() {
		return this.paths.processLockFile();
	}
	assertScope(scope) {
		if (scope !== this.activeScope || scope === void 0) throw locked("The mutation scope is not active on this storage lock");
	}
	async withLock(operation, signal) {
		const lease = await this.enter(signal);
		try {
			return await operation(lease.scope);
		} finally {
			await lease.release();
		}
	}
	/** Compatibility for explicit test/host owners; never called to borrow a held scope. */
	async acquire(signal) {
		if (this.manualLease !== void 0) throw locked("This owner already holds an explicit storage lock");
		this.manualLease = await this.enter(signal);
	}
	async release() {
		const lease = this.manualLease;
		this.manualLease = void 0;
		await lease?.release();
	}
	async initialize(signal) {
		signal?.throwIfAborted();
		await ensureDirectory(this.paths.root);
		await this.ensureProtocolFence();
		await ensureDirectory(this.claimsDir);
		await ensureDirectory(join(this.lockDir, "users"));
		signal?.throwIfAborted();
	}
	async ensureProtocolFence() {
		const path = this.paths.processLockFile();
		let raw = await readSmallFile(path, 1024);
		if (raw === void 0) {
			const temporary = join(this.paths.root, ".lock-fence-" + randomUUID() + ".tmp");
			try {
				await writeFile(temporary, JSON.stringify(FENCE), {
					flag: "wx",
					mode: 384
				});
				try {
					await link(temporary, path);
				} catch (error) {
					if (errno(error) !== "EEXIST") throw locked("Storage protocol fence requires local filesystem hard-link support");
				}
			} finally {
				await rm(temporary, { force: true });
			}
			raw = await readSmallFile(path, 1024);
		}
		let value;
		try {
			value = JSON.parse(raw ?? "");
		} catch {
			value = void 0;
		}
		const record = value;
		if (record === null || typeof record !== "object" || record.pid !== FENCE.pid || record.ownerToken !== FENCE.ownerToken || record.createdAt !== 0 || record.hostname !== FENCE.hostname) throw locked("Legacy or foreign storage lock: stop all MinerU processes before a coordinated upgrade and manual lock recovery; never remove a live lock");
	}
	async enter(signal) {
		const deadline = performance.now() + this.timeoutMs;
		const releaseQueue = await this.enqueue(deadline, signal);
		let claimPath;
		try {
			await this.initialize(signal);
			this.checkDeadline(deadline, signal);
			const id = createStorageOwnerId("c");
			const candidatePath = join(this.claimsDir, id);
			await mkdir(candidatePath, { mode: 448 });
			claimPath = candidatePath;
			const max = (await this.scanClaims(signal)).reduce((value, claim) => Math.max(value, claim.ticket ?? 0), 0);
			if (max >= Number.MAX_SAFE_INTEGER) throw locked("Storage lock ticket range is exhausted");
			const ticket = max + 1;
			const temporary = join(claimPath, "choosing.tmp");
			await writeFile(temporary, String(ticket), {
				flag: "wx",
				mode: 384
			});
			await rename(temporary, join(claimPath, "ticket"));
			for (;;) {
				this.checkDeadline(deadline, signal);
				if (!(await this.scanClaims(signal)).some((claim) => claim.id !== id && (claim.ticket === void 0 || claim.ticket < ticket || claim.ticket === ticket && claim.id < id))) break;
				try {
					await setTimeout$1(Math.min(this.pollMs, Math.max(1, deadline - performance.now())), void 0, { signal });
				} catch (error) {
					signal?.throwIfAborted();
					throw error;
				}
			}
			const scope = Object.freeze({ [scopeBrand]: true });
			this.activeScope = scope;
			const ownedPath = claimPath;
			let released = false;
			return {
				scope,
				release: async () => {
					if (released) return;
					released = true;
					this.activeScope = void 0;
					try {
						await rm(ownedPath, {
							recursive: true,
							force: true
						});
					} finally {
						releaseQueue();
					}
				}
			};
		} catch (error) {
			try {
				if (claimPath !== void 0) await rm(claimPath, {
					recursive: true,
					force: true
				});
			} finally {
				releaseQueue();
			}
			throw error;
		}
	}
	checkDeadline(deadline, signal) {
		signal?.throwIfAborted();
		if (performance.now() >= deadline) throw locked("Storage lock contention timed out; retry after active work completes");
	}
	async enqueue(deadline, signal) {
		signal?.throwIfAborted();
		let release;
		const slot = new Promise((resolve) => {
			release = resolve;
		});
		const previous = this.queueTail;
		this.queueTail = previous.then(() => slot);
		try {
			await new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					cleanup();
					reject(locked("Storage lock contention timed out in the local queue"));
				}, Math.max(1, deadline - performance.now()));
				const onAbort = () => {
					cleanup();
					reject(signal?.reason);
				};
				const cleanup = () => {
					clearTimeout(timeout);
					signal?.removeEventListener("abort", onAbort);
				};
				signal?.addEventListener("abort", onAbort, { once: true });
				if (signal?.aborted) {
					onAbort();
					return;
				}
				previous.then(() => {
					cleanup();
					resolve();
				});
			});
			this.checkDeadline(deadline, signal);
			return release;
		} catch (error) {
			release();
			throw error;
		}
	}
	async scanClaims(signal) {
		const result = [];
		const directory = await opendir(this.claimsDir);
		let count = 0;
		for await (const entry of directory) {
			signal?.throwIfAborted();
			if (++count > MAX_CLAIMS) throw locked("Storage lock contender limit exceeded");
			if (!entry.name.startsWith("c_") || !entry.isDirectory() || entry.isSymbolicLink()) throw locked("Invalid storage lock claim");
			const state = storageOwnerState(entry.name);
			if (state === "unknown" || state === "foreign") throw locked("Storage lock owner cannot be safely verified on this host");
			const path = join(this.claimsDir, entry.name);
			if (state === "dead") {
				await rm(path, {
					recursive: true,
					force: true
				});
				continue;
			}
			const raw = await readSmallFile(join(path, "ticket"), 32);
			if (raw === void 0) {
				try {
					await lstat(path);
				} catch (error) {
					if (errno(error) === "ENOENT") continue;
					throw error;
				}
				result.push({
					id: entry.name,
					ticket: void 0
				});
			} else {
				const ticket = Number(raw);
				if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(ticket)) throw locked("Invalid storage lock ticket");
				result.push({
					id: entry.name,
					ticket
				});
			}
		}
		return result;
	}
};
//#endregion
//#region src/storage/access-gate.ts
/** In-process reader/exclusive gate with cross-process reader and producer owner records. */
const MAX_USERS = 1024;
function errnoCode$1(error) {
	return error?.code;
}
/** Classify unique owner directories. Foreign and unverifiable owners fail closed. */
async function listUseRecords(paths) {
	const usersDir = join(paths.root, ".lock", "users");
	const records = [];
	try {
		const directory = await opendir(usersDir);
		let count = 0;
		for await (const entry of directory) {
			if (count++ >= MAX_USERS) {
				records.push({
					kind: "unknown",
					id: "lease-scan-limit"
				});
				break;
			}
			const id = entry.name;
			if (entry.isSymbolicLink() || !entry.isDirectory()) {
				records.push({
					kind: "unknown",
					id
				});
				continue;
			}
			const state = storageOwnerState(id);
			if (state === "live") records.push({
				kind: "active",
				record: { id }
			});
			else if (state === "dead") records.push({
				kind: "dead",
				id,
				record: { id }
			});
			else records.push({
				kind: "unknown",
				id
			});
		}
	} catch (error) {
		if (errnoCode$1(error) !== "ENOENT") throw error;
	}
	return records;
}
var StorageAccessGate = class {
	activeReaders = 0;
	exclusive = false;
	paths;
	lock;
	constructor(options) {
		this.paths = options?.paths;
		this.lock = options?.lock;
	}
	get activeReaderCount() {
		return this.activeReaders;
	}
	async runShared(operation, signal) {
		return await this.runUse(operation, signal);
	}
	/** Producer leases use the same owner protocol and cover the full producer lifetime. */
	async runProducer(operation, signal) {
		return await this.runUse(operation, signal);
	}
	async runUse(operation, signal) {
		signal?.throwIfAborted();
		if (this.exclusive) throwMinerU("STORAGE_LOCKED", "MinerU storage maintenance is in progress");
		this.activeReaders++;
		let ownerId;
		try {
			if (this.paths !== void 0 && this.lock !== void 0) {
				await this.lock.initialize(signal);
				ownerId = await this.lock.withLock(async (scope) => {
					this.lock.assertScope(scope);
					if (this.exclusive) throwMinerU("STORAGE_LOCKED", "MinerU storage maintenance is in progress");
					const id = createStorageOwnerId("u");
					await mkdir(join(this.paths.root, ".lock", "users", id), { mode: 448 });
					return id;
				}, signal);
			}
			signal?.throwIfAborted();
			return await operation();
		} finally {
			try {
				if (ownerId !== void 0 && this.paths !== void 0) await rm(join(this.paths.root, ".lock", "users", ownerId), {
					recursive: true,
					force: true
				});
			} finally {
				this.activeReaders--;
			}
		}
	}
	/** Fail fast, then recheck and prune confirmed-dead records under the scoped mutex. */
	async runMaintenance(operation, signal) {
		signal?.throwIfAborted();
		if (this.lock === void 0 || this.paths === void 0) throw new TypeError("Cross-process storage maintenance requires { paths, lock }");
		if (this.exclusive || this.activeReaders > 0) throwMinerU("STORAGE_LOCKED", "MinerU storage is in use by an active reader or producer");
		await this.lock.initialize(signal);
		await this.assertNoActiveRecords(false);
		return await this.lock.withLock(async (scope) => {
			this.lock.assertScope(scope);
			if (this.exclusive || this.activeReaders > 0) throwMinerU("STORAGE_LOCKED", "MinerU storage is in use by an active reader or producer");
			await this.assertNoActiveRecords(true, scope);
			this.exclusive = true;
			try {
				return await operation(scope);
			} finally {
				this.exclusive = false;
			}
		}, signal);
	}
	/** Local-only compatibility API. Destructive cross-process work uses runMaintenance. */
	tryAcquireExclusive() {
		if (this.exclusive || this.activeReaders > 0) return void 0;
		this.exclusive = true;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.exclusive = false;
		};
	}
	async assertNoActiveRecords(pruneDead, scope) {
		const records = await listUseRecords(this.paths);
		if (pruneDead) {
			if (scope === void 0) throw new TypeError("Use-record pruning requires a process lock scope");
			this.lock.assertScope(scope);
			for (const record of records) if (record.kind === "dead" && storageOwnerState(record.id) === "dead") await rm(join(this.paths.root, ".lock", "users", record.id), {
				recursive: true,
				force: true
			});
		}
		if ((pruneDead ? await listUseRecords(this.paths) : records).some((record) => record.kind !== "dead")) throwMinerU("STORAGE_LOCKED", "MinerU storage is in use or its owner cannot be safely verified");
	}
};
//#endregion
//#region src/storage/artifact-sink.ts
/**
* artifact-sink.ts — Staging-backed ArtifactSink implementation for MinerU providers.
*
* Enforces:
*   - Streaming I/O with on-the-fly SHA-256 and byte accounting
*   - Per-artifact byte limit enforcement (throws RESULT_TOO_LARGE on breach)
*   - Clean POSIX relative artifact paths within staging and result boundaries
*   - Automatic temporary file cleanup on stream failure
*/
function toNodeReadable(input) {
	if (typeof input === "string") return Readable.from([Buffer.from(input, "utf8")]);
	if (input instanceof Uint8Array) return Readable.from([input]);
	if (input instanceof Readable) return input;
	if (input !== null && typeof input === "object" && "getReader" in input && typeof input.getReader === "function") return Readable.fromWeb(input);
	throw new TypeError(`Unsupported artifact input type: ${typeof input}`);
}
async function streamToFile(input, destinationPath, maxBytes, signal) {
	signal?.throwIfAborted();
	await mkdir(dirname(destinationPath), { recursive: true });
	const hash = createHash("sha256");
	let totalBytes = 0;
	const source = toNodeReadable(input);
	const temporaryPath = `${destinationPath}.part_${randomUUID().replaceAll("-", "")}`;
	const byteTracker = new Transform({ transform(chunk, _encoding, callback) {
		totalBytes += chunk.length;
		if (maxBytes !== void 0 && totalBytes > maxBytes) {
			callback(/* @__PURE__ */ new Error("ARTIFACT_MAX_BYTES_EXCEEDED"));
			return;
		}
		hash.update(chunk);
		callback(null, chunk);
	} });
	const destination = createWriteStream(temporaryPath, {
		flags: "wx",
		mode: 384
	});
	try {
		await pipeline(source, byteTracker, destination, { signal });
		await link(temporaryPath, destinationPath);
		await unlink(temporaryPath);
		return {
			bytes: totalBytes,
			sha256: hash.digest("hex")
		};
	} catch (err) {
		try {
			await unlink(temporaryPath);
		} catch {}
		if (err instanceof Error && err.message === "ARTIFACT_MAX_BYTES_EXCEEDED") throwMinerU("RESULT_TOO_LARGE", `Artifact output exceeded byte limit of ${String(maxBytes)} bytes`);
		throw err;
	}
}
function defaultArtifactFileName(kind, imageIndex) {
	switch (kind) {
		case "markdown": return "full.md";
		case "layout": return "layout.json";
		case "model-output": return "model.json";
		case "content-list": return "content_list.json";
		case "images": return `images/img_${String(imageIndex)}.png`;
	}
}
var StagingArtifactSink = class {
	paths;
	signal;
	defaultMaxBytes;
	imageCounter = 0;
	operationId;
	constructor(operationId, paths, signal, defaultMaxBytes) {
		this.paths = paths;
		this.signal = signal;
		this.defaultMaxBytes = defaultMaxBytes;
		this.operationId = asOperationId(operationId);
	}
	async writeArtifact(fileId, kind, input, options) {
		const validFileId = asFileId(fileId);
		const validKind = parseArtifactKind(kind);
		let relativeSubPath;
		if (options.relativeName !== void 0 && options.relativeName.trim() !== "") relativeSubPath = assertSafeArtifactRelativePath(options.relativeName, "options.relativeName");
		else relativeSubPath = defaultArtifactFileName(validKind, this.imageCounter++);
		const relativePath = assertSafeArtifactRelativePath(`files/${validFileId}/${relativeSubPath}`, "artifact relativePath");
		const { bytes, sha256 } = await streamToFile(input, this.paths.resolveStagingArtifactPath(this.operationId, relativePath), options.maxBytes ?? this.defaultMaxBytes, this.signal);
		return parseArtifactRef({
			kind: validKind,
			relativePath,
			mediaType: options.mediaType,
			bytes,
			sha256
		});
	}
	async writeTemporary(name, input, maxBytes) {
		const safeName = assertSafeFileName(name, "temporary artifact name");
		const destPath = `${this.paths.stagingTempDir(this.operationId)}/${safeName}`;
		const { bytes, sha256 } = await streamToFile(input, destPath, maxBytes, this.signal);
		return {
			path: destPath,
			bytes,
			sha256
		};
	}
};
//#endregion
//#region src/storage/result-repository.ts
const DEFAULT_MAX_JSON_VALIDATION_BYTES = 67108864;
const DEFAULT_MAX_MANIFEST_BYTES = 16777216;
function errnoCode(error) {
	return error?.code;
}
function isAbort(error, signal) {
	return signal?.aborted === true || error instanceof Error && error.name === "AbortError";
}
function inspectionFailure(error, fallback) {
	const code = errnoCode(error);
	if (code === "ENOENT") return {
		status: "missing",
		reason: "missing-entry"
	};
	if (code === "EACCES" || code === "EPERM" || code === "EIO" || code === "EBUSY") return {
		status: "unreadable",
		reason: "io-error"
	};
	return {
		status: "corrupt",
		reason: fallback
	};
}
function containedSegments(root, candidate) {
	const relativePath = relative(root, candidate);
	if (relativePath === "" || isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(".." + sep)) return;
	return relativePath.split(sep);
}
function assertQuarantineSourcePath(paths, sourcePath) {
	const candidate = resolve(sourcePath);
	const staging = containedSegments(paths.stagingDir(), candidate);
	if (staging?.length === 1) {
		const operationId = asOperationId(staging[0]);
		if (candidate === paths.stagingDir(operationId)) return candidate;
	}
	const published = containedSegments(paths.resultsDir(), candidate);
	if (published?.length === 2 && /^[a-f0-9]{2}$/.test(published[0])) {
		const cacheKey = asCacheKey(published[1]);
		if (published[0] === cacheKey.slice(0, 2) && candidate === paths.resultDir(cacheKey)) return candidate;
	}
	throw new TypeError("Only a complete staging operation or published result directory can be quarantined");
}
async function assertRegularDirectoryWithin(rootDir, directoryPath) {
	const relativePath = relative(rootDir, directoryPath);
	if (relativePath === "" || isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(".." + sep)) throw new TypeError("Result directory escapes its storage root");
	const root = await lstat(rootDir);
	if (root.isSymbolicLink() || !root.isDirectory()) throw new TypeError("Result storage root is not a regular directory");
	let current = rootDir;
	for (const segment of relativePath.split(sep)) {
		if (segment === "") throw new TypeError("Result directory contains an empty segment");
		current = join(current, segment);
		const details = await lstat(current);
		if (details.isSymbolicLink() || !details.isDirectory()) throw new TypeError("Result storage must not contain symlinked directories");
	}
}
/** Refuse symlinked path components before opening a published artifact. */
async function assertRegularFileWithin(rootDir, filePath) {
	const relativePath = relative(rootDir, filePath);
	if (relativePath === "" || isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(".." + sep)) throw new TypeError("Artifact path escapes its result directory");
	const root = await lstat(rootDir);
	if (root.isSymbolicLink() || !root.isDirectory()) throw new TypeError("Result directory is not a regular directory");
	const segments = relativePath.split(sep);
	let current = rootDir;
	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index];
		if (segment === void 0 || segment === "") throw new TypeError("Artifact path contains an empty segment");
		current = join(current, segment);
		const details = await lstat(current);
		if (details.isSymbolicLink()) throw new TypeError("Result data must not contain symlinks");
		if (index === segments.length - 1) {
			if (!details.isFile()) throw new TypeError("Artifact is not a regular file");
		} else if (!details.isDirectory()) throw new TypeError("Artifact parent is not a regular directory");
	}
}
async function readUtf8Bounded(path, maxBytes, label, signal) {
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const stream = createReadStream(path);
	const onAbort = () => {
		stream.destroy(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	let totalBytes = 0;
	let text = "";
	try {
		signal?.throwIfAborted();
		for await (const chunk of stream) {
			signal?.throwIfAborted();
			const buffer = chunk;
			totalBytes += buffer.byteLength;
			if (totalBytes > maxBytes) throw new MinerUError(failure("RESULT_TOO_LARGE", label + " exceeds its validation limit"));
			text += decoder.decode(buffer, { stream: true });
		}
		text += decoder.decode();
		return text;
	} finally {
		signal?.removeEventListener("abort", onAbort);
		stream.destroy();
	}
}
async function validateUtf8(path, signal) {
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const stream = createReadStream(path);
	const onAbort = () => {
		stream.destroy(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		signal?.throwIfAborted();
		for await (const chunk of stream) {
			signal?.throwIfAborted();
			decoder.decode(chunk, { stream: true });
		}
		decoder.decode();
	} finally {
		signal?.removeEventListener("abort", onAbort);
		stream.destroy();
	}
}
function samePublicationSemantics(left, right) {
	const leftSource = left.request.files[0];
	const rightSource = right.request.files[0];
	return left.cacheKey === right.cacheKey && left.sourceSha256 === right.sourceSha256 && leftSource?.sha256 === rightSource?.sha256 && leftSource?.bytes === rightSource?.bytes && left.request.schemaVersion === right.request.schemaVersion && left.producer.compatibilityKey === right.producer.compatibilityKey && canonicalJson(left.request.semantics) === canonicalJson(right.request.semantics) && canonicalJson(left.request.requiredArtifacts) === canonicalJson(right.request.requiredArtifacts);
}
var ResultTransaction = class {
	request;
	producer;
	paths;
	operationId;
	stagingDir;
	sink;
	constructor(operationId, request, producer, paths, signal, maxArtifactBytes) {
		this.request = request;
		this.producer = producer;
		this.paths = paths;
		this.operationId = asOperationId(operationId);
		this.stagingDir = paths.stagingDir(this.operationId);
		this.sink = new StagingArtifactSink(this.operationId, paths, signal, maxArtifactBytes);
	}
	writeArtifact(fileId, kind, input, options) {
		return this.sink.writeArtifact(fileId, kind, input, options);
	}
	writeTemporary(name, input, maxBytes) {
		return this.sink.writeTemporary(name, input, maxBytes);
	}
	buildManifest(file, artifacts) {
		if (this.request.files.length !== 1 || this.request.files[0]?.fileId !== file.fileId) throw new TypeError("Result manifests are single-file and must use the transaction request file");
		const cacheKey = computeCacheKey(this.request, file, this.producer.compatibilityKey);
		return parseMinerUResultManifest({
			schemaVersion: 1,
			id: resultIdForCacheKey(cacheKey),
			cacheKey,
			sourceSha256: file.sha256,
			request: this.request,
			producer: this.producer,
			files: [{
				fileId: file.fileId,
				name: file.name,
				artifacts
			}],
			createdAt: Date.now()
		});
	}
	async abort() {
		await rm(this.stagingDir, {
			recursive: true,
			force: true
		});
	}
};
var ResultRepository = class {
	paths;
	lock;
	maxJsonValidationBytes;
	maxManifestBytes;
	maxArtifactBytes;
	mutationLock;
	constructor(paths, options = {}, lock) {
		this.paths = paths;
		this.lock = lock;
		this.maxJsonValidationBytes = options.maxJsonValidationBytes ?? DEFAULT_MAX_JSON_VALIDATION_BYTES;
		this.maxManifestBytes = options.maxManifestBytes ?? DEFAULT_MAX_MANIFEST_BYTES;
		if (!Number.isSafeInteger(this.maxManifestBytes) || this.maxManifestBytes <= 0) throw new TypeError("maxManifestBytes must be a positive safe integer");
		this.maxArtifactBytes = options.maxArtifactBytes;
		this.mutationLock = lock ?? new ProcessLock(paths);
	}
	beginTransaction(operationId, request, producer, signal) {
		return new ResultTransaction(operationId, request, producer, this.paths, signal, this.maxArtifactBytes);
	}
	assertManifestConsistency(tx, manifest) {
		const source = manifest.request.files[0];
		const document = manifest.files[0];
		if (manifest.request.files.length !== 1 || source === void 0) throw new TypeError("Result manifest request must contain exactly one file");
		if (manifest.sourceSha256 !== source.sha256 || document.fileId !== source.fileId) throw new TypeError("Result manifest source metadata is inconsistent");
		const expectedKey = computeCacheKey(manifest.request, source, manifest.producer.compatibilityKey);
		if (manifest.cacheKey !== expectedKey || manifest.id !== resultIdForCacheKey(expectedKey)) throw new TypeError("Result manifest content-addressed identifiers are inconsistent");
		if (tx !== void 0 && (canonicalJson(tx.request) !== canonicalJson(manifest.request) || canonicalJson(tx.producer) !== canonicalJson(manifest.producer))) throw new TypeError("Result manifest does not belong to its transaction");
		const required = new Set(manifest.request.requiredArtifacts);
		const present = new Set(document.artifacts.map((artifact) => artifact.kind));
		for (const kind of required) if (!present.has(kind)) throw new TypeError(`Result manifest is missing required artifact ${kind}`);
		const paths = /* @__PURE__ */ new Set();
		const prefix = `files/${document.fileId}/`;
		for (const artifact of document.artifacts) {
			if (!artifact.relativePath.startsWith(prefix)) throw new TypeError("Artifact path does not belong to the manifest file");
			if (paths.has(artifact.relativePath)) throw new TypeError("Result manifest contains duplicate artifact paths");
			paths.add(artifact.relativePath);
		}
	}
	async verifyArtifact(rootDir, path, artifact, signal) {
		signal?.throwIfAborted();
		await assertRegularFileWithin(rootDir, path);
		if ((await lstat(path)).size !== artifact.bytes) throw new TypeError(`Artifact ${artifact.relativePath} size mismatch`);
		if (await computeFileSha256(path, signal) !== artifact.sha256) throw new TypeError(`Artifact ${artifact.relativePath} SHA-256 mismatch`);
		if (artifact.kind === "markdown") await validateUtf8(path, signal);
		if (artifact.kind === "layout" || artifact.kind === "model-output" || artifact.kind === "content-list") {
			if (artifact.bytes > this.maxJsonValidationBytes) throw new MinerUError(failure("RESULT_TOO_LARGE", `JSON artifact ${artifact.relativePath} exceeds validation limit`));
			const json = await readUtf8Bounded(path, this.maxJsonValidationBytes, "JSON artifact", signal);
			JSON.parse(json);
		}
	}
	async verifyManifestArtifacts(manifest, rootDir, resolvePath, signal) {
		for (const artifact of manifest.files[0].artifacts) await this.verifyArtifact(rootDir, resolvePath(artifact.relativePath), artifact, signal);
	}
	async assertPublishedTreeContents(rootDir, manifest, signal) {
		const expectedFiles = /* @__PURE__ */ new Set(["manifest.json"]);
		const expectedDirectories = /* @__PURE__ */ new Set();
		for (const artifact of manifest.files[0].artifacts) {
			expectedFiles.add(artifact.relativePath);
			const segments = artifact.relativePath.split("/");
			for (let index = 1; index < segments.length; index++) expectedDirectories.add(segments.slice(0, index).join("/"));
		}
		const walk = async (directory, relativeDirectory) => {
			signal?.throwIfAborted();
			const details = await lstat(directory);
			if (details.isSymbolicLink() || !details.isDirectory()) throw new TypeError("Published result contains an unsafe directory");
			const entries = await readdir(directory, { withFileTypes: true });
			for (const entry of entries) {
				signal?.throwIfAborted();
				assertSafePathSegment(entry.name, "published result entry");
				const relativePath = relativeDirectory === "" ? entry.name : relativeDirectory + "/" + entry.name;
				const path = join(directory, entry.name);
				const child = await lstat(path);
				if (child.isSymbolicLink()) throw new TypeError("Published result contains a symlink");
				if (child.isDirectory()) {
					if (!expectedDirectories.has(relativePath)) throw new TypeError("Published result contains an undeclared directory");
					await walk(path, relativePath);
				} else if (child.isFile()) {
					if (!expectedFiles.has(relativePath)) throw new TypeError("Published result contains an undeclared file");
				} else throw new TypeError("Published result contains an unsupported filesystem entry");
			}
		};
		await walk(rootDir, "");
	}
	async commitTransaction(tx, manifest, signal) {
		signal?.throwIfAborted();
		const validated = parseMinerUResultManifest(manifest);
		this.assertManifestConsistency(tx, validated);
		try {
			await this.verifyManifestArtifacts(validated, tx.stagingDir, (relativePath) => this.paths.resolveStagingArtifactPath(tx.operationId, relativePath), signal);
		} catch (error) {
			await tx.abort();
			if (error instanceof MinerUError) throw error;
			throw new MinerUError(failure("CACHE_CORRUPT", error instanceof Error ? error.message : String(error)));
		}
		const stagingManifestPath = this.paths.stagingManifestFile(tx.operationId);
		const serializedManifest = JSON.stringify(validated, null, 2);
		if (Buffer.byteLength(serializedManifest, "utf8") > this.maxManifestBytes) {
			await tx.abort();
			throw new MinerUError(failure("RESULT_TOO_LARGE", "Result manifest exceeds its publication limit"));
		}
		await writeFile(stagingManifestPath, serializedManifest, {
			encoding: "utf8",
			mode: 384
		});
		await rm(this.paths.stagingTempDir(tx.operationId), {
			recursive: true,
			force: true
		});
		try {
			await this.assertPublishedTreeContents(tx.stagingDir, validated, signal);
		} catch (error) {
			await tx.abort();
			if (error instanceof MinerUError) throw error;
			throw new MinerUError(failure("CACHE_CORRUPT", error instanceof Error ? error.message : String(error)));
		}
		const targetDir = this.paths.resultDir(validated.cacheKey);
		const resolveExisting = async (scope) => {
			const existing = await this.get(validated.cacheKey, void 0, signal);
			if (existing === void 0) return void 0;
			if (!samePublicationSemantics(existing, validated)) {
				await this.quarantineScoped(this.mutationLock, scope, tx.stagingDir, "conflict");
				throw new MinerUError(failure("CACHE_CONFLICT", `Cache conflict detected for key ${validated.cacheKey}`));
			}
			await tx.abort();
			return existing;
		};
		const doCommit = async (scope) => {
			this.mutationLock.assertScope(scope);
			await this.ensureResultParentScoped(scope, validated.cacheKey);
			const before = await resolveExisting(scope);
			if (before !== void 0) {
				await tx.abort().catch(() => void 0);
				return {
					resultId: before.id,
					cacheKey: before.cacheKey,
					manifest: before
				};
			}
			for (let attempt = 0; attempt < 2; attempt++) {
				signal?.throwIfAborted();
				try {
					await rename(tx.stagingDir, targetDir);
					return {
						resultId: validated.id,
						cacheKey: validated.cacheKey,
						manifest: validated
					};
				} catch (error) {
					const code = error.code;
					if (code === "EEXIST" || code === "ENOTEMPTY") {
						const raced = await resolveExisting(scope);
						if (raced !== void 0) {
							await tx.abort().catch(() => void 0);
							return {
								resultId: raced.id,
								cacheKey: raced.cacheKey,
								manifest: raced
							};
						}
						continue;
					}
					await this.quarantineScoped(this.mutationLock, scope, tx.stagingDir, "commit_failed").catch(() => void 0);
					throw error;
				}
			}
			await this.quarantineScoped(this.mutationLock, scope, tx.stagingDir, "commit_race").catch(() => void 0);
			throw new MinerUError(failure("CACHE_CONFLICT", `Could not atomically publish cache key ${validated.cacheKey}`));
		};
		await this.mutationLock.initialize(signal);
		return await this.mutationLock.withLock(doCommit, signal);
	}
	/** Strictly verifies one published result without moving or modifying it. */
	async inspectPublished(cacheKey, signal) {
		signal?.throwIfAborted();
		const key = asCacheKey(cacheKey);
		const resultDir = this.paths.resultDir(key);
		try {
			await assertRegularDirectoryWithin(this.paths.resultsDir(), resultDir);
		} catch (error) {
			if (isAbort(error, signal)) throw signal?.reason ?? error;
			if (errnoCode(error) === "ENOENT") return {
				status: "missing",
				reason: "absent"
			};
			return inspectionFailure(error, "unsafe-entry");
		}
		let raw;
		try {
			const manifestPath = this.paths.manifestFile(key);
			await assertRegularFileWithin(resultDir, manifestPath);
			raw = await readUtf8Bounded(manifestPath, this.maxManifestBytes, "Result manifest", signal);
		} catch (error) {
			if (isAbort(error, signal)) throw signal?.reason ?? error;
			return inspectionFailure(error, "unsafe-entry");
		}
		let manifest;
		try {
			manifest = parseMinerUResultManifest(JSON.parse(raw));
			this.assertManifestConsistency(void 0, manifest);
			if (manifest.cacheKey !== key) throw new TypeError("Manifest cache key does not match its directory");
		} catch (error) {
			if (isAbort(error, signal)) throw signal?.reason ?? error;
			return {
				status: "corrupt",
				reason: "manifest-invalid"
			};
		}
		try {
			await this.verifyManifestArtifacts(manifest, resultDir, (relativePath) => this.paths.resolveArtifactPath(key, relativePath), signal);
			await this.assertPublishedTreeContents(resultDir, manifest, signal);
		} catch (error) {
			if (isAbort(error, signal)) throw signal?.reason ?? error;
			return inspectionFailure(error, "artifact-invalid");
		}
		return {
			status: "valid",
			manifest
		};
	}
	async get(cacheKey, requiredArtifacts, signal) {
		signal?.throwIfAborted();
		const key = asCacheKey(cacheKey);
		const inspection = await this.inspectPublished(key, signal);
		if (inspection.status !== "valid") {
			if (inspection.status === "missing" && inspection.reason === "absent") return void 0;
			throw new MinerUError(failure("CACHE_CORRUPT", "Published MinerU cache data is invalid; run explicit storage integrity maintenance before retrying"));
		}
		const manifest = inspection.manifest;
		if (requiredArtifacts !== void 0) {
			const present = new Set(manifest.files[0].artifacts.map((artifact) => artifact.kind));
			if (requiredArtifacts.some((kind) => !present.has(kind))) return void 0;
		}
		return manifest;
	}
	resolveArtifactAbsolutePath(cacheKey, relativePath) {
		return this.paths.resolveArtifactPath(cacheKey, relativePath);
	}
	manifestAbsolutePath(cacheKey) {
		return this.paths.manifestFile(cacheKey);
	}
	async quarantine(sourcePath, reason = "quarantine") {
		await this.mutationLock.initialize();
		return await this.mutationLock.withLock((scope) => this.quarantineScoped(this.mutationLock, scope, sourcePath, reason));
	}
	/** Mutation helper for callers already holding the exact authority lock. */
	async quarantineScoped(authority, scope, sourcePath, reason = "quarantine") {
		if (authority.paths.root !== this.paths.root) throw new TypeError("Quarantine lock root does not match repository root");
		authority.assertScope(scope);
		const safeSourcePath = assertQuarantineSourcePath(this.paths, sourcePath);
		if (containedSegments(this.paths.resultsDir(), safeSourcePath)?.length === 2) {
			if ((await listUseRecords(this.paths)).some((user) => user.kind !== "dead")) throw new MinerUError(failure("STORAGE_LOCKED", "Published MinerU data is in use by an active or unverifiable reader"));
		}
		const id = `${String(Date.now())}_${reason}_${randomUUID().slice(0, 8)}`;
		const destination = this.paths.quarantineDir(id);
		try {
			await assertRegularDirectoryWithin(this.paths.root, safeSourcePath);
		} catch (error) {
			if (errnoCode(error) === "ENOENT") return destination;
			throw new MinerUError(failure("CACHE_CORRUPT", "Failed to isolate corrupt MinerU data safely"));
		}
		try {
			await mkdir(this.paths.quarantineDir(), { recursive: true });
			const quarantineRoot = await lstat(this.paths.quarantineDir());
			if (quarantineRoot.isSymbolicLink() || !quarantineRoot.isDirectory()) throw new TypeError("Quarantine root is not a regular directory");
			await rename(safeSourcePath, destination);
			return destination;
		} catch (error) {
			if (errnoCode(error) === "ENOENT") return destination;
			throw new MinerUError(failure("CACHE_CORRUPT", "Failed to isolate corrupt MinerU data"));
		}
	}
	async ensureResultParentScoped(scope, cacheKey) {
		this.mutationLock.assertScope(scope);
		const ancestors = [
			join(this.paths.root, "results"),
			this.paths.resultsDir(),
			dirname(this.paths.resultDir(cacheKey))
		];
		for (const ancestor of ancestors) {
			try {
				await mkdir(ancestor, { mode: 448 });
			} catch (error) {
				if (errnoCode(error) !== "EEXIST") throw error;
			}
			const details = await lstat(ancestor);
			if (details.isSymbolicLink() || !details.isDirectory()) throw new MinerUError(failure("CACHE_CORRUPT", "Result publication ancestors must be regular directories"));
		}
	}
	async cleanupStaging(ttlMs, activeOperationIds = /* @__PURE__ */ new Set(), signal) {
		if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new TypeError("staging TTL must be a positive safe integer");
		await this.mutationLock.initialize(signal);
		return await this.mutationLock.withLock(async (scope) => {
			this.mutationLock.assertScope(scope);
			if ((await listUseRecords(this.paths)).some((user) => user.kind !== "dead")) return 0;
			const stagingRoot = this.paths.stagingDir();
			let entries;
			try {
				const root = await lstat(stagingRoot);
				if (root.isSymbolicLink() || !root.isDirectory()) return 0;
				entries = await readdir(stagingRoot);
			} catch (error) {
				if (errnoCode(error) === "ENOENT") return 0;
				throw error;
			}
			let cleaned = 0;
			const now = Date.now();
			for (const entry of entries) {
				signal?.throwIfAborted();
				let operationId;
				try {
					operationId = asOperationId(entry);
				} catch {
					continue;
				}
				if (activeOperationIds.has(operationId)) continue;
				const path = this.paths.stagingDir(operationId);
				try {
					const details = await lstat(path);
					if (!details.isSymbolicLink() && details.isDirectory() && now - details.mtimeMs > ttlMs) {
						await rm(path, {
							recursive: true,
							force: true
						});
						cleaned++;
					}
				} catch (error) {
					if (errnoCode(error) !== "ENOENT") throw error;
				}
			}
			return cleaned;
		}, signal);
	}
};
//#endregion
//#region src/storage/maintenance-service.ts
/**
* storage-maintenance.ts — Streamlined, path-safe maintenance inventory for MinerU storage.
*
* Privileged and storage-local. Never follows symlink entries, strictly stays
* within storageRoot, and exposes summary data for the loopback RPC and settings UI.
*/
const DEFAULT_RESULT_SCAN_LIMIT = 1e4;
const DEFAULT_DIAGNOSTIC_LIMIT = 100;
const DEFAULT_QUARANTINE_LIST_LIMIT = 100;
const DEFAULT_GC_CANDIDATE_LIMIT = 100;
const MAX_RESULT_SCAN_LIMIT = 5e4;
const MAX_DIAGNOSTIC_LIMIT = 1e3;
const MAX_QUARANTINE_LIST_LIMIT = 1e3;
const MAX_GC_CANDIDATE_LIMIT = 1e3;
const MAX_QUARANTINE_CLEANUP_ENTRIES = 100;
const MAX_STATS_ENTRIES = 5e4;
const MAX_STATS_DEPTH = 16;
const MAX_STATS_TIME_MS = 2e3;
function createUsage() {
	return {
		bytes: 0,
		regularFileCount: 0,
		directoryCount: 0,
		skippedSymlinkCount: 0,
		unexpectedEntryCount: 0,
		unreadableEntryCount: 0,
		depthLimitCount: 0,
		truncated: false,
		logicalEntryCount: 0
	};
}
function boundedLimit(value, fallback, maximum, label) {
	const resolved = value === void 0 ? fallback : value;
	if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) throw new TypeError(`${label} must be a positive safe integer no greater than ${maximum}`);
	return resolved;
}
function isSafeSegment(value) {
	try {
		assertSafePathSegment(value, "storage entry");
		return true;
	} catch {
		return false;
	}
}
function sanitizeEntry(value) {
	return isSafeSegment(value) ? value : "unknown";
}
function diagnosticMessage(code) {
	switch (code) {
		case "unexpected-entry": return "Ignored an entry outside the expected storage layout.";
		case "symlink-skipped": return "Skipped a symlink without following it.";
		case "unreadable-entry": return "Could not read a storage entry.";
		case "corrupt-result": return "Published result failed strict manifest or artifact validation.";
		case "missing-result": return "Published result was incomplete or disappeared during validation.";
		case "unsafe-result": return "Published result contained unsafe or unsupported filesystem data.";
		case "quarantine-failed": return "Could not move an invalid result to quarantine.";
	}
}
function createDiagnostics(limit) {
	return {
		limit,
		diagnostics: [],
		truncated: false
	};
}
function addDiagnostic(collector, area, entry, code) {
	if (collector === void 0) return;
	if (collector.diagnostics.length >= collector.limit) {
		collector.truncated = true;
		return;
	}
	collector.diagnostics.push({
		area,
		entry: sanitizeEntry(entry),
		code,
		message: diagnosticMessage(code)
	});
}
async function classifyNode(path) {
	try {
		const details = await lstat(path);
		if (details.isSymbolicLink()) return "symlink";
		if (details.isDirectory()) return "directory";
		if (details.isFile()) return "file";
		return "unexpected";
	} catch (error) {
		return error?.code === "ENOENT" ? "missing" : "unreadable";
	}
}
function isWithinDirectory(target, parentDir) {
	const rel = relative(resolve(parentDir), resolve(target));
	return !rel.startsWith("..") && !isAbsolute(rel);
}
async function isSafeExistingDirectoryChain(target, signal) {
	const absolute = resolve(target);
	const root = parse(absolute).root;
	const segments = absolute.slice(root.length).split(sep).filter(Boolean);
	let current = root;
	for (const segment of segments) {
		signal?.throwIfAborted();
		current = join(current, segment);
		if (await classifyNode(current) !== "directory") return false;
	}
	try {
		return await realpath(absolute) === absolute;
	} catch {
		return false;
	}
}
function cacheClearConfirmationToken(cacheKeys) {
	const ordered = [...cacheKeys].sort();
	return "cache-clear-" + createHash("sha256").update(JSON.stringify(ordered), "utf8").digest("hex");
}
async function isSafeReadableRoot(path, signal) {
	const absolute = resolve(path);
	const filesystemRoot = parse(absolute).root;
	const segments = absolute.slice(filesystemRoot.length).split(sep).filter(Boolean);
	let current = filesystemRoot;
	for (const segment of segments) {
		signal?.throwIfAborted();
		current = join(current, segment);
		try {
			const details = await lstat(current);
			if (details.isSymbolicLink() || !details.isDirectory()) return false;
		} catch (error) {
			if (error?.code === "ENOENT") return true;
			return false;
		}
	}
	return true;
}
async function readSafeDirectory(path, signal) {
	if (!await isSafeReadableRoot(path, signal)) return { kind: "unreadable" };
	const kind = await classifyNode(path);
	if (kind !== "directory") return { kind: kind === "file" ? "unexpected" : kind };
	try {
		const directory = await opendir(path);
		const entries = [];
		for await (const entry of directory) {
			entries.push(entry);
			if (entries.length > MAX_STATS_ENTRIES) break;
		}
		entries.sort((left, right) => left.name.localeCompare(right.name));
		return {
			kind: "entries",
			entries,
			truncated: entries.length > MAX_STATS_ENTRIES
		};
	} catch (error) {
		return { kind: error?.code === "ENOENT" ? "missing" : "unreadable" };
	}
}
async function collectUsage(root, signal, logicalDepth, validateLogical = (value) => assertSafePathSegment(value, "storage entry")) {
	const usage = createUsage();
	if (!await isSafeReadableRoot(root, signal)) {
		usage.unreadableEntryCount++;
		return usage;
	}
	const deadline = Date.now() + MAX_STATS_TIME_MS;
	let visited = 0;
	const walk = async (path, depth = 0) => {
		if (visited >= MAX_STATS_ENTRIES || Date.now() > deadline) {
			usage.truncated = true;
			return;
		}
		if (depth > MAX_STATS_DEPTH) {
			usage.depthLimitCount++;
			usage.truncated = true;
			return;
		}
		visited++;
		signal?.throwIfAborted();
		const kind = await classifyNode(path);
		if (kind === "missing") return;
		if (kind === "symlink") {
			usage.skippedSymlinkCount++;
			return;
		}
		if (kind === "unreadable") {
			usage.unreadableEntryCount++;
			return;
		}
		if (kind === "unexpected") {
			usage.unexpectedEntryCount++;
			return;
		}
		if (kind === "file") {
			try {
				const details = await lstat(path);
				usage.regularFileCount++;
				usage.bytes += details.size;
			} catch (error) {
				if (error?.code !== "ENOENT") usage.unreadableEntryCount++;
			}
			return;
		}
		usage.directoryCount++;
		if (logicalDepth === depth) try {
			validateLogical(basename(path), path);
			usage.logicalEntryCount++;
		} catch {}
		const directory = await readSafeDirectory(path, signal);
		if (directory.kind !== "entries") {
			if (directory.kind === "symlink") usage.skippedSymlinkCount++;
			else if (directory.kind === "unreadable") usage.unreadableEntryCount++;
			else if (directory.kind === "unexpected") usage.unexpectedEntryCount++;
			return;
		}
		if (directory.truncated) usage.truncated = true;
		for (const entry of directory.entries.slice(0, MAX_STATS_ENTRIES)) {
			signal?.throwIfAborted();
			if (!isSafeSegment(entry.name)) {
				usage.unexpectedEntryCount++;
				continue;
			}
			if (entry.isSymbolicLink()) {
				usage.skippedSymlinkCount++;
				continue;
			}
			await walk(join(path, entry.name), depth + 1);
		}
	};
	await walk(root);
	return usage;
}
function toAreaStatistics(usage) {
	return {
		byteUsage: usage.bytes,
		byteUsageSaturated: false,
		logicalEntryCount: usage.logicalEntryCount,
		regularFileCount: usage.regularFileCount,
		directoryCount: usage.directoryCount,
		skippedSymlinkCount: usage.skippedSymlinkCount,
		unexpectedEntryCount: usage.unexpectedEntryCount,
		unreadableEntryCount: usage.unreadableEntryCount,
		depthLimitCount: usage.depthLimitCount,
		truncated: usage.truncated,
		complete: !usage.truncated && usage.depthLimitCount === 0 && usage.skippedSymlinkCount === 0 && usage.unexpectedEntryCount === 0 && usage.unreadableEntryCount === 0
	};
}
/** Storage maintenance is loopback-only and blocks destructive work while parse operations are active. */
var StorageMaintenanceService = class {
	paths;
	results;
	operations;
	lock;
	accessGate;
	constructor(paths, results, operations, lock, accessGate = new StorageAccessGate({
		paths,
		lock
	})) {
		this.paths = paths;
		this.results = results;
		this.operations = operations;
		this.lock = lock;
		this.accessGate = accessGate;
		if (paths.root !== results.paths.root || paths.root !== lock.paths.root) throw new TypeError("StorageMaintenanceService paths must match its ResultRepository and ProcessLock");
	}
	async getStatistics(signal) {
		const [publishedUsage, stagingUsage, quarantineUsage] = await Promise.all([
			collectUsage(this.paths.resultsDir(), signal, 2, (value, path) => {
				const key = asCacheKey(value);
				if (basename(dirname(path)) !== key.slice(0, 2)) throw new TypeError("cache prefix mismatch");
			}),
			collectUsage(this.paths.stagingDir(), signal, 1, (value) => asOperationId(value)),
			collectUsage(this.paths.quarantineDir(), signal, 1)
		]);
		return {
			generatedAt: Date.now(),
			publishedResults: toAreaStatistics(publishedUsage),
			staging: toAreaStatistics(stagingUsage),
			quarantine: toAreaStatistics(quarantineUsage)
		};
	}
	async scanIntegrity(options = {}) {
		if (options.isolateInvalid !== true) return await this.scanIntegrityInternal(options);
		this.assertNoLocalOperations();
		return await this.accessGate.runMaintenance(async (scope) => {
			this.assertNoLocalOperations();
			return await this.scanIntegrityInternal(options, scope);
		}, options.signal);
	}
	async scanIntegrityInternal(options, scope) {
		const resultLimit = boundedLimit(options.resultLimit, DEFAULT_RESULT_SCAN_LIMIT, MAX_RESULT_SCAN_LIMIT, "resultLimit");
		const diagnosticLimit = boundedLimit(options.diagnosticLimit, DEFAULT_DIAGNOSTIC_LIMIT, MAX_DIAGNOSTIC_LIMIT, "diagnosticLimit");
		const isolateInvalid = options.isolateInvalid === true;
		const diagnostics = createDiagnostics(diagnosticLimit);
		let validCount = 0;
		let corruptCount = 0;
		let missingCount = 0;
		let unreadableCount = 0;
		let quarantinedCount = 0;
		const traversal = await this.visitPublishedResults(resultLimit, options.signal, diagnostics, async (cacheKey, resultDir) => {
			const inspection = await this.results.inspectPublished(cacheKey, options.signal);
			if (inspection.status === "valid") {
				validCount++;
				return;
			}
			if (inspection.status === "missing") {
				missingCount++;
				addDiagnostic(diagnostics, "published-results", cacheKey, "missing-result");
			} else if (inspection.status === "unreadable") {
				unreadableCount++;
				addDiagnostic(diagnostics, "published-results", cacheKey, "unreadable-entry");
			} else {
				corruptCount++;
				addDiagnostic(diagnostics, "published-results", cacheKey, inspection.reason === "unsafe-entry" ? "unsafe-result" : "corrupt-result");
			}
			if (isolateInvalid && inspection.status !== "unreadable") try {
				if (scope === void 0) throw new TypeError("Integrity isolation requires maintenance scope");
				await this.results.quarantineScoped(this.lock, scope, resultDir, "maintenance_invalid");
				quarantinedCount++;
			} catch {
				addDiagnostic(diagnostics, "published-results", cacheKey, "quarantine-failed");
			}
		});
		return {
			generatedAt: Date.now(),
			readOnly: !isolateInvalid,
			isolateInvalid,
			validCount,
			corruptCount,
			missingCount,
			unreadableCount,
			quarantinedCount,
			scan: {
				limit: resultLimit,
				scanned: traversal.scanned,
				truncated: traversal.truncated,
				diagnosticsLimit: diagnosticLimit,
				diagnosticsTruncated: diagnostics.truncated
			},
			diagnostics: diagnostics.diagnostics
		};
	}
	async listQuarantine(options = {}) {
		const limit = boundedLimit(options.limit, DEFAULT_QUARANTINE_LIST_LIMIT, MAX_QUARANTINE_LIST_LIMIT, "limit");
		const entries = [];
		let totalBytes = 0;
		let totalCount = 0;
		let skippedSymlinkCount = 0;
		let unexpectedEntryCount = 0;
		let unreadableEntryCount = 0;
		const root = await readSafeDirectory(this.paths.quarantineDir());
		if (root.kind === "entries") for (const entry of root.entries) {
			options.signal?.throwIfAborted();
			if (!isSafeSegment(entry.name)) {
				unexpectedEntryCount++;
				continue;
			}
			if (entry.isSymbolicLink()) {
				skippedSymlinkCount++;
				continue;
			}
			const entryPath = this.paths.quarantineDir(entry.name);
			const kind = await classifyNode(entryPath);
			if (kind === "symlink") {
				skippedSymlinkCount++;
				continue;
			}
			if (kind === "unreadable") {
				unreadableEntryCount++;
				continue;
			}
			if (kind !== "directory") {
				if (kind !== "missing") unexpectedEntryCount++;
				continue;
			}
			const usage = await collectUsage(entryPath, options.signal);
			const details = await lstat(entryPath).catch(() => void 0);
			if (details === void 0 || details.isSymbolicLink() || !details.isDirectory()) {
				unreadableEntryCount++;
				continue;
			}
			totalCount++;
			totalBytes += usage.bytes;
			if (entries.length < limit) entries.push({
				id: entry.name,
				byteUsage: usage.bytes,
				byteUsageSaturated: false,
				regularFileCount: usage.regularFileCount,
				directoryCount: usage.directoryCount,
				modifiedAt: Math.max(0, Math.floor(details.mtimeMs))
			});
		}
		else if (root.kind === "symlink") skippedSymlinkCount++;
		else if (root.kind === "unreadable") unreadableEntryCount++;
		else if (root.kind === "unexpected") unexpectedEntryCount++;
		return {
			generatedAt: Date.now(),
			entries,
			totalCount,
			totalBytes,
			totalBytesSaturated: false,
			truncated: root.kind === "entries" && root.truncated || totalCount > entries.length,
			skippedSymlinkCount,
			unexpectedEntryCount,
			unreadableEntryCount
		};
	}
	async cleanupQuarantine(options) {
		if (options.dryRun !== false) return await this.cleanupQuarantineInternal(options);
		this.assertNoLocalOperations();
		return await this.accessGate.runMaintenance(async () => {
			this.assertNoLocalOperations();
			return await this.cleanupQuarantineInternal(options);
		}, options.signal);
	}
	async cleanupQuarantineInternal(options) {
		if (!Array.isArray(options.entryIds)) throw new TypeError("entryIds must be an array");
		if (options.entryIds.length > MAX_QUARANTINE_CLEANUP_ENTRIES) throw new TypeError(`entryIds cannot contain more than ${MAX_QUARANTINE_CLEANUP_ENTRIES} entries`);
		const entryIds = [];
		const seen = /* @__PURE__ */ new Set();
		for (const entryId of options.entryIds) {
			if (typeof entryId !== "string") throw new TypeError("quarantine entry ID must be a string");
			const safeId = assertSafePathSegment(entryId, "quarantine entry ID");
			if (!seen.has(safeId)) {
				seen.add(safeId);
				entryIds.push(safeId);
			}
		}
		const dryRun = options.dryRun !== false;
		const quarantineRoot = await readSafeDirectory(this.paths.quarantineDir());
		if (quarantineRoot.kind !== "entries") {
			const rootMissing = quarantineRoot.kind === "missing";
			return {
				generatedAt: Date.now(),
				dryRun,
				requestedCount: entryIds.length,
				plannedCount: 0,
				plannedBytes: 0,
				plannedBytesSaturated: false,
				deletedCount: 0,
				deletedBytes: 0,
				deletedBytesSaturated: false,
				missingCount: rootMissing ? entryIds.length : 0,
				skippedCount: rootMissing ? 0 : entryIds.length,
				entries: []
			};
		}
		const plannedEntries = [];
		let plannedBytes = 0;
		let deletedBytes = 0;
		let deletedCount = 0;
		let missingCount = 0;
		let skippedCount = 0;
		for (const entryId of entryIds) {
			options.signal?.throwIfAborted();
			const entryPath = this.paths.quarantineDir(entryId);
			if (!isWithinDirectory(entryPath, this.paths.quarantineDir())) {
				skippedCount++;
				continue;
			}
			const kind = await classifyNode(entryPath);
			if (kind === "missing") {
				missingCount++;
				continue;
			}
			if (kind !== "directory") {
				skippedCount++;
				continue;
			}
			const usage = await collectUsage(entryPath, options.signal);
			const details = await lstat(entryPath).catch(() => void 0);
			if (details === void 0 || details.isSymbolicLink() || !details.isDirectory()) {
				skippedCount++;
				continue;
			}
			if (usage.truncated || usage.depthLimitCount > 0 || usage.skippedSymlinkCount > 0 || usage.unexpectedEntryCount > 0 || usage.unreadableEntryCount > 0) {
				skippedCount++;
				continue;
			}
			const entry = {
				id: entryId,
				byteUsage: usage.bytes,
				byteUsageSaturated: false,
				regularFileCount: usage.regularFileCount,
				directoryCount: usage.directoryCount,
				modifiedAt: Math.max(0, Math.floor(details.mtimeMs))
			};
			plannedEntries.push(entry);
			plannedBytes += usage.bytes;
			if (!dryRun) try {
				if (!await isSafeExistingDirectoryChain(entryPath, options.signal)) {
					skippedCount++;
					continue;
				}
				await rm(entryPath, {
					recursive: true,
					force: true,
					maxRetries: 2
				});
				deletedCount++;
				deletedBytes += usage.bytes;
			} catch (error) {
				if (error?.code === "ENOENT") missingCount++;
				else skippedCount++;
			}
		}
		return {
			generatedAt: Date.now(),
			dryRun,
			requestedCount: entryIds.length,
			plannedCount: plannedEntries.length,
			plannedBytes,
			plannedBytesSaturated: false,
			deletedCount,
			deletedBytes,
			deletedBytesSaturated: false,
			missingCount,
			skippedCount,
			entries: plannedEntries
		};
	}
	async clearCache(options = {}) {
		if (options.dryRun !== false) return await this.clearCacheInternal(options, false, this.accessGate.activeReaderCount);
		this.assertNoLocalOperations();
		return await this.accessGate.runMaintenance(async () => {
			this.assertNoLocalOperations();
			return await this.clearCacheInternal(options, true, 0);
		}, options.signal);
	}
	async clearCacheInternal(options, exclusiveAcquired, activeAccessCount) {
		const resultLimit = boundedLimit(options.resultLimit, DEFAULT_RESULT_SCAN_LIMIT, MAX_RESULT_SCAN_LIMIT, "resultLimit");
		const diagnosticLimit = boundedLimit(options.diagnosticLimit, DEFAULT_DIAGNOSTIC_LIMIT, MAX_DIAGNOSTIC_LIMIT, "diagnosticLimit");
		const dryRun = options.dryRun !== false;
		const diagnostics = createDiagnostics(diagnosticLimit);
		const planned = [];
		let plannedBytes = 0;
		let deletedBytes = 0;
		let unsafeResultCount = 0;
		let deletedCount = 0;
		let skippedCount = 0;
		let traversal = {
			scanned: 0,
			truncated: false,
			complete: true
		};
		const resultsKind = await classifyNode(this.paths.resultsDir());
		if (!(resultsKind === "missing" || resultsKind === "directory" && await isSafeExistingDirectoryChain(this.paths.resultsDir(), options.signal))) {
			traversal = {
				scanned: 0,
				truncated: false,
				complete: false
			};
			addDiagnostic(diagnostics, "published-results", "results", resultsKind === "symlink" ? "symlink-skipped" : "unsafe-result");
		} else if (resultsKind === "directory") traversal = await this.visitPublishedResults(resultLimit, options.signal, diagnostics, async (cacheKey, resultDir) => {
			if (!isWithinDirectory(resultDir, this.paths.resultsDir()) || !await isSafeExistingDirectoryChain(resultDir, options.signal)) {
				unsafeResultCount++;
				skippedCount++;
				addDiagnostic(diagnostics, "published-results", cacheKey, "unsafe-result");
				return;
			}
			const usage = await collectUsage(resultDir, options.signal);
			if (usage.truncated || usage.depthLimitCount > 0 || usage.skippedSymlinkCount > 0 || usage.unexpectedEntryCount > 0 || usage.unreadableEntryCount > 0) {
				unsafeResultCount++;
				skippedCount++;
				addDiagnostic(diagnostics, "published-results", cacheKey, "unsafe-result");
				return;
			}
			planned.push({
				cacheKey,
				resultDir,
				byteUsage: usage.bytes
			});
			plannedBytes += usage.bytes;
		});
		const token = cacheClearConfirmationToken(planned.map((entry) => entry.cacheKey));
		const activeOperationCount = this.operations.activeOperationCount();
		const preflightEligible = activeOperationCount === 0 && activeAccessCount === 0 && traversal.complete && !traversal.truncated && unsafeResultCount === 0;
		const tokenMatches = dryRun || typeof options.confirmationToken === "string" && options.confirmationToken === token;
		const eligible = preflightEligible && tokenMatches && (dryRun || exclusiveAcquired);
		if (!dryRun && eligible) for (const entry of planned) {
			options.signal?.throwIfAborted();
			try {
				if (!await isSafeExistingDirectoryChain(entry.resultDir, options.signal)) {
					skippedCount++;
					continue;
				}
				await rm(entry.resultDir, {
					recursive: true,
					force: true,
					maxRetries: 2
				});
				deletedCount++;
				deletedBytes += entry.byteUsage;
			} catch (error) {
				if (error?.code !== "ENOENT") skippedCount++;
			}
		}
		return {
			generatedAt: Date.now(),
			dryRun,
			eligible,
			activeOperationCount,
			activeAccessCount,
			...dryRun && preflightEligible && planned.length > 0 ? { confirmationToken: token } : {},
			plannedCount: planned.length,
			plannedBytes,
			plannedBytesSaturated: false,
			deletedCount,
			deletedBytes,
			deletedBytesSaturated: false,
			skippedCount,
			scan: {
				limit: resultLimit,
				scanned: traversal.scanned,
				truncated: traversal.truncated,
				diagnosticsLimit: diagnosticLimit,
				diagnosticsTruncated: diagnostics.truncated
			},
			diagnostics: diagnostics.diagnostics
		};
	}
	async gcDryRun(options = {}) {
		const resultLimit = boundedLimit(options.resultLimit, DEFAULT_RESULT_SCAN_LIMIT, MAX_RESULT_SCAN_LIMIT, "resultLimit");
		const candidateLimit = boundedLimit(options.candidateLimit, DEFAULT_GC_CANDIDATE_LIMIT, MAX_GC_CANDIDATE_LIMIT, "candidateLimit");
		const diagnosticLimit = boundedLimit(options.diagnosticLimit, DEFAULT_DIAGNOSTIC_LIMIT, MAX_DIAGNOSTIC_LIMIT, "diagnosticLimit");
		const diagnostics = createDiagnostics(diagnosticLimit);
		const candidates = [];
		let candidateBytes = 0;
		let candidateCount = 0;
		let invalidResultCount = 0;
		let unsafeResultCount = 0;
		let traversal = {
			scanned: 0,
			truncated: false,
			complete: true
		};
		traversal = await this.visitPublishedResults(resultLimit, options.signal, diagnostics, async (cacheKey, resultDir) => {
			const inspection = await this.results.inspectPublished(cacheKey, options.signal);
			if (inspection.status !== "valid") {
				invalidResultCount++;
				addDiagnostic(diagnostics, "published-results", cacheKey, inspection.status === "missing" ? "missing-result" : inspection.status === "unreadable" ? "unreadable-entry" : "corrupt-result");
				return;
			}
			const usage = await collectUsage(resultDir, options.signal);
			if (usage.truncated || usage.depthLimitCount > 0 || usage.skippedSymlinkCount > 0 || usage.unexpectedEntryCount > 0 || usage.unreadableEntryCount > 0) {
				unsafeResultCount++;
				addDiagnostic(diagnostics, "published-results", cacheKey, "unsafe-result");
				return;
			}
			candidateCount++;
			candidateBytes += usage.bytes;
			if (candidates.length < candidateLimit) candidates.push({
				cacheKey,
				resultId: inspection.manifest.id,
				byteUsage: usage.bytes,
				byteUsageSaturated: false
			});
		});
		return {
			generatedAt: Date.now(),
			dryRun: true,
			referencePolicy: "all-published-results",
			eligible: traversal.complete && !traversal.truncated,
			candidateCount,
			candidateBytes,
			candidateBytesSaturated: false,
			candidates,
			candidatesTruncated: candidateCount > candidates.length,
			candidateTotalsComplete: traversal.complete && !traversal.truncated,
			invalidResultCount,
			unsafeResultCount,
			scan: {
				limit: resultLimit,
				scanned: traversal.scanned,
				truncated: traversal.truncated,
				diagnosticsLimit: diagnosticLimit,
				diagnosticsTruncated: diagnostics.truncated
			},
			diagnostics: diagnostics.diagnostics
		};
	}
	assertNoLocalOperations() {
		if (this.operations.activeOperationCount() > 0) throwMinerU("STORAGE_LOCKED", "MinerU storage is in use by an active parse operation");
	}
	async visitPublishedResults(limit, signal, diagnostics, visitor) {
		const root = await readSafeDirectory(this.paths.resultsDir(), signal);
		if (root.kind !== "entries") {
			this.recordDirectoryIssue(diagnostics, "published-results", "results", root.kind);
			return {
				scanned: 0,
				truncated: false,
				complete: root.kind === "missing"
			};
		}
		let scanned = 0;
		let inspected = 0;
		const deadline = Date.now() + MAX_STATS_TIME_MS;
		let complete = !root.truncated;
		let truncated = root.truncated;
		for (const prefixEntry of root.entries) {
			signal?.throwIfAborted();
			if (inspected++ >= MAX_STATS_ENTRIES || Date.now() > deadline) return {
				scanned,
				truncated: true,
				complete: false
			};
			if (!isSafeSegment(prefixEntry.name) || !/^[a-f0-9]{2}$/.test(prefixEntry.name)) {
				complete = false;
				addDiagnostic(diagnostics, "published-results", prefixEntry.name, "unexpected-entry");
				continue;
			}
			if (prefixEntry.isSymbolicLink()) {
				complete = false;
				addDiagnostic(diagnostics, "published-results", prefixEntry.name, "symlink-skipped");
				continue;
			}
			const prefixPath = join(this.paths.resultsDir(), prefixEntry.name);
			const prefix = await readSafeDirectory(prefixPath, signal);
			if (prefix.kind !== "entries") {
				complete = false;
				this.recordDirectoryIssue(diagnostics, "published-results", prefixEntry.name, prefix.kind);
				continue;
			}
			if (prefix.truncated) {
				complete = false;
				truncated = true;
			}
			for (const resultEntry of prefix.entries) {
				signal?.throwIfAborted();
				if (inspected++ >= MAX_STATS_ENTRIES || Date.now() > deadline) return {
					scanned,
					truncated: true,
					complete: false
				};
				if (scanned >= limit) return {
					scanned,
					truncated: true,
					complete: false
				};
				if (!isSafeSegment(resultEntry.name) || resultEntry.isSymbolicLink()) {
					complete = false;
					addDiagnostic(diagnostics, "published-results", resultEntry.name, resultEntry.isSymbolicLink() ? "symlink-skipped" : "unexpected-entry");
					continue;
				}
				let cacheKey;
				try {
					cacheKey = asCacheKey(resultEntry.name);
				} catch {
					complete = false;
					addDiagnostic(diagnostics, "published-results", resultEntry.name, "unexpected-entry");
					continue;
				}
				if (cacheKey.slice(0, 2) !== prefixEntry.name) {
					complete = false;
					addDiagnostic(diagnostics, "published-results", resultEntry.name, "unexpected-entry");
					continue;
				}
				const resultDir = this.paths.resultDir(cacheKey);
				if (resultDir !== join(prefixPath, resultEntry.name)) {
					complete = false;
					addDiagnostic(diagnostics, "published-results", resultEntry.name, "unexpected-entry");
					continue;
				}
				const kind = await classifyNode(resultDir);
				if (kind !== "directory") {
					complete = false;
					this.recordDirectoryIssue(diagnostics, "published-results", cacheKey, kind);
					continue;
				}
				scanned++;
				await visitor(cacheKey, resultDir);
			}
		}
		return {
			scanned,
			truncated,
			complete
		};
	}
	recordDirectoryIssue(diagnostics, area, entry, kind) {
		if (kind === "missing") return;
		if (kind === "symlink") addDiagnostic(diagnostics, area, entry, "symlink-skipped");
		else if (kind === "unreadable") addDiagnostic(diagnostics, area, entry, "unreadable-entry");
		else addDiagnostic(diagnostics, area, entry, "unexpected-entry");
	}
};
//#endregion
//#region src/service/image-policy.ts
/** Total decoded byte budget across one read response. */
const MAX_INLINE_IMAGE_TOTAL_BYTES = 25165824;
/** Map a file extension to a supported raster media type, or undefined when unsupported. */
function mediaTypeForExtension(ext) {
	switch (ext.toLowerCase()) {
		case ".jpg":
		case ".jpeg": return "image/jpeg";
		case ".webp": return "image/webp";
		case ".gif": return "image/gif";
		case ".png": return "image/png";
		default: return;
	}
}
//#endregion
//#region src/tools.ts
/** Model-facing MinerU tools: native background submit and direct parse. */
const artifactViewSchema = {
	type: "object",
	properties: {
		kind: {
			type: "string",
			required: true
		},
		path: {
			type: "string",
			required: true
		},
		bytes: {
			type: "integer",
			required: true
		}
	},
	additionalProperties: false
};
const inlinedImageViewSchema = {
	type: "object",
	properties: {
		attachment_id: {
			type: "string",
			required: true
		},
		name: {
			type: "string",
			required: true
		},
		media_type: {
			type: "string",
			required: true
		},
		width: { type: "integer" },
		height: { type: "integer" },
		bytes: { type: "integer" },
		figure: { type: "integer" }
	},
	additionalProperties: false
};
const imageCandidateViewSchema = {
	type: "object",
	properties: {
		path: {
			type: "string",
			required: true
		},
		name: {
			type: "string",
			required: true
		},
		page: { type: "integer" },
		caption: { type: "string" },
		media_type: {
			type: "string",
			required: true
		},
		bytes: {
			type: "integer",
			required: true
		},
		status: {
			type: "string",
			enum: [
				"available",
				"unavailable",
				"unsupported",
				"failed",
				"omitted"
			]
		}
	},
	additionalProperties: false
};
const documentHeadingSchema = {
	type: "object",
	properties: {
		level: {
			type: "integer",
			required: true
		},
		title: {
			type: "string",
			required: true
		},
		line: { type: "integer" },
		page: { type: "integer" }
	},
	additionalProperties: false
};
const parseOutputSchema = {
	type: "object",
	properties: {
		state: {
			type: "string",
			enum: ["completed"],
			required: true
		},
		source: {
			type: "string",
			enum: [
				"cache",
				"shared-operation",
				"provider"
			],
			required: true
		},
		cache_hit: {
			type: "boolean",
			required: true
		},
		result_id: {
			type: "string",
			required: true
		},
		files: {
			type: "array",
			items: {
				type: "object",
				properties: {
					file_id: {
						type: "string",
						required: true
					},
					name: {
						type: "string",
						required: true
					},
					artifacts: {
						type: "array",
						items: artifactViewSchema,
						required: true
					},
					artifacts_truncated: { type: "boolean" },
					markdown_path: { type: "string" }
				},
				additionalProperties: false
			},
			required: true
		},
		markdown_content: { type: "string" },
		content_status: {
			type: "string",
			enum: [
				"complete",
				"partial",
				"not_requested"
			],
			required: true
		},
		markdown_path: { type: "string" },
		cursor: { type: "string" },
		warnings: {
			type: "array",
			items: { type: "string" }
		},
		manifest_path: {
			type: "string",
			required: true
		},
		output_limit_chars: {
			type: "integer",
			required: true
		},
		inlined_images: {
			type: "array",
			items: inlinedImageViewSchema
		},
		ordered_images: {
			type: "array",
			items: imageCandidateViewSchema
		},
		summary: {
			type: "object",
			properties: {
				page_count: { type: "integer" },
				table_count: { type: "integer" },
				image_count: { type: "integer" },
				equation_count: { type: "integer" },
				toc: {
					type: "array",
					items: documentHeadingSchema
				}
			},
			additionalProperties: false
		},
		toc: {
			type: "array",
			items: documentHeadingSchema
		},
		pages: { type: "string" }
	},
	additionalProperties: false
};
const asyncParseParameters = { file_path: {
	type: "string",
	description: "Path of the local PDF document to parse.",
	required: true
} };
const readPdfParameters = {
	file_path: {
		type: "string",
		description: "Path of the local PDF document to read.",
		required: true
	},
	pages: {
		oneOf: [
			{
				type: "integer",
				description: "Single 1-based page number, e.g. 3"
			},
			{
				type: "string",
				description: "Page range string, e.g. \"1-3, 5\""
			},
			{
				type: "array",
				items: { type: "integer" },
				description: "Array of page numbers, e.g. [1, 2, 5]"
			}
		],
		description: "1-based page numbers to extract. Accepts a single page number (e.g. 3), an array of page numbers (e.g. [1, 2, 5]), or a range string (e.g. \"1-3, 5\")."
	},
	focus: {
		oneOf: [{
			type: "string",
			enum: [
				"all",
				"text",
				"table",
				"image",
				"toc",
				"artifacts"
			],
			description: "Focus content type"
		}, {
			type: "array",
			items: {
				type: "string",
				enum: [
					"all",
					"text",
					"table",
					"image",
					"toc",
					"artifacts"
				]
			},
			description: "Focus content types"
		}],
		description: "Content types to extract: \"all\" (default), \"text\" (paragraphs, headers, code, formulas), \"table\" (tables and captions), \"image\" (charts, figures, and captions), \"toc\" (document outline / table of contents), or \"artifacts\" (secondary artifact files like layout.json, model.json, and extracted images). Accepts a single kind or an array."
	},
	inline_images: {
		type: "boolean",
		description: "Whether to inline visual figures directly as multimodal image blocks. Defaults to true when calling model route supports images."
	},
	poll_timeout_ms: {
		type: "integer",
		description: "Maximum synchronous wait in milliseconds. A timeout leaves the shared producer running; retry the same request to rejoin it."
	},
	cursor: {
		type: "string",
		description: "Opaque continuation cursor returned by a previous partial read. When provided, file_path is required and pages/focus must be omitted."
	}
};
const DEFAULT_RENDER_LIMIT = 2e5;
const MAX_POLL_TIMEOUT_MS = 864e5;
function clampRenderText(rendered, limit = DEFAULT_RENDER_LIMIT) {
	if (!Number.isSafeInteger(limit) || limit <= 0) return "";
	if (rendered.length <= limit) return rendered;
	const suffix = "\n\n[Output truncated to limit]";
	if (29 >= limit) return suffix.slice(0, limit);
	const footerStart = rendered.lastIndexOf("\n---\n");
	if (footerStart >= 0) {
		const footer = rendered.slice(footerStart);
		if (footer.length < limit) return rendered.slice(0, limit - footer.length - 29) + suffix + footer;
	}
	return rendered.slice(0, limit - 29) + suffix;
}
function fitPostImageBudget(value) {
	const limit = value.output_limit_chars;
	let fitted = value;
	const fits = () => JSON.stringify(fitted).length <= limit && formatResultProse(fitted).length <= limit;
	if (fits()) return fitted;
	fitted = {
		...fitted,
		ordered_images: void 0
	};
	if (fits()) return fitted;
	fitted = {
		...fitted,
		summary: void 0,
		toc: void 0
	};
	if (fits()) return fitted;
	throw new MinerUError(failure("RESULT_TOO_LARGE", "Image attachment metadata exceeds the configured output limit"));
}
function parsePollTimeout(value) {
	if (value === void 0) return void 0;
	if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_POLL_TIMEOUT_MS) throw new MinerUError(failure("INVALID_REQUEST", "poll_timeout_ms must be a positive integer no greater than " + String(MAX_POLL_TIMEOUT_MS)));
	return value;
}
function requireAgent(exec) {
	const agent = exec.agent;
	if (agent === void 0) throw new MinerUError(failure("UNAUTHENTICATED_SESSION", "MinerU operations require an authenticated agent session (UNAUTHENTICATED_SESSION)"));
	return agent;
}
const READ_PARAMETER_FIELDS = /* @__PURE__ */ new Set([
	"file_path",
	"pages",
	"focus",
	"inline_images",
	"poll_timeout_ms",
	"cursor"
]);
const ASYNC_PARAMETER_FIELDS = /* @__PURE__ */ new Set(["file_path"]);
function assertAllowedParameters(args, allowed) {
	for (const key of Object.keys(args)) if (!allowed.has(key)) throw new MinerUError(failure("INVALID_REQUEST", `Unsupported parameter: ${key}. Valid parameters: ${[...allowed].join(", ")}`));
}
function extractFilePath(args) {
	if (typeof args.file_path !== "string" || args.file_path.trim() === "") throw new MinerUError(failure("INVALID_REQUEST", "Local document path (file_path) is required"));
	return args.file_path.trim();
}
function parseAsyncInput(args) {
	if (typeof args !== "object" || args === null || Array.isArray(args)) throw new MinerUError(failure("INVALID_REQUEST", "Tool arguments must be an object"));
	const obj = args;
	assertAllowedParameters(obj, ASYNC_PARAMETER_FIELDS);
	return { input: { file_path: extractFilePath(obj) } };
}
function parseReadInput(args) {
	if (typeof args !== "object" || args === null || Array.isArray(args)) throw new MinerUError(failure("INVALID_REQUEST", "Tool arguments must be an object"));
	const obj = args;
	assertAllowedParameters(obj, READ_PARAMETER_FIELDS);
	const filePath = extractFilePath(obj);
	const pollTimeoutMs = parsePollTimeout(obj.poll_timeout_ms);
	let inline_images;
	if (obj.inline_images !== void 0) {
		if (typeof obj.inline_images !== "boolean") throw new MinerUError(failure("INVALID_REQUEST", "inline_images must be a boolean"));
		inline_images = obj.inline_images;
	}
	let cursor;
	if (obj.cursor !== void 0) {
		if (typeof obj.cursor !== "string" || obj.cursor.trim() === "") throw new MinerUError(failure("INVALID_REQUEST", "cursor must be a non-empty string"));
		cursor = obj.cursor.trim();
		if (obj.pages !== void 0 || obj.focus !== void 0) throw new MinerUError(failure("INVALID_REQUEST", "pages and focus must be omitted when cursor is provided"));
	}
	let pages;
	if (obj.pages !== void 0) try {
		normalizePageSelection(obj.pages);
		pages = obj.pages;
	} catch (error) {
		throw new MinerUError(failure("INVALID_REQUEST", error instanceof Error ? error.message : "Invalid page range"), { cause: error });
	}
	let focus;
	if (obj.focus !== void 0) try {
		normalizeFocusSelection(obj.focus);
		focus = obj.focus;
	} catch (error) {
		throw new MinerUError(failure("INVALID_REQUEST", error instanceof Error ? error.message : "Invalid focus"), { cause: error });
	}
	return {
		input: {
			file_path: filePath,
			...pages !== void 0 ? { pages } : {},
			...focus !== void 0 ? { focus } : {},
			...inline_images !== void 0 ? { inline_images } : {},
			...cursor !== void 0 ? { cursor } : {}
		},
		...pollTimeoutMs !== void 0 ? { pollTimeoutMs } : {},
		...inline_images !== void 0 ? { inline_images } : {}
	};
}
function renderResult(value) {
	const limit = typeof value.output_limit_chars === "number" && Number.isSafeInteger(value.output_limit_chars) && value.output_limit_chars > 0 ? value.output_limit_chars : DEFAULT_RENDER_LIMIT;
	return [{
		type: "text",
		text: clampRenderText(formatResultProse(value), limit)
	}, ...(value.inlined_images ?? []).flatMap((img) => {
		return [{
			type: "image",
			attachment: img.attachmentRef ?? {
				attachmentId: img.attachment_id,
				mediaType: img.media_type,
				bytes: img.bytes ?? 0,
				width: img.width ?? 0,
				height: img.height ?? 0,
				...img.name !== void 0 ? { name: img.name } : {}
			}
		}];
	})];
}
function backgroundLabel(input) {
	return "Parse " + (input.file_path ? basename(input.file_path) : "document") + " with MinerU";
}
function nativeSuccessOutcome(value) {
	return {
		status: "completed",
		detail: "completed",
		output: formatSingleSummaryProse(value)
	};
}
async function readImageBounded(path, remainingBytes, signal) {
	signal?.throwIfAborted();
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const details = await handle.stat();
		if (!details.isFile() || details.size > 8388608) throw new Error("image exceeds inline budget");
		if (remainingBytes <= 0 || details.size > remainingBytes) throw new Error("image exceeds remaining inline budget");
		const buffer = Buffer.alloc(details.size);
		let offset = 0;
		while (offset < buffer.length) {
			signal?.throwIfAborted();
			const read = await handle.read(buffer, offset, buffer.length - offset, offset);
			if (read.bytesRead === 0) throw new Error("image changed during read");
			offset += read.bytesRead;
		}
		const finalDetails = await handle.stat();
		if (!finalDetails.isFile() || finalDetails.size !== offset) throw new Error("image changed during read");
		return buffer;
	} finally {
		await handle.close();
	}
}
async function inlineImagesForSingleResult(view, attachments, signal) {
	const declared = view.ordered_images ?? [];
	if (declared.length === 0) return view;
	const statuses = declared.map((img) => ({ ...img }));
	const candidates = [];
	for (let index = 0; index < declared.length; index++) {
		const item = declared[index];
		const mediaType = mediaTypeForExtension(extname(item.name));
		if (index >= 6 || mediaType === void 0 || item.path === "") {
			statuses[index] = {
				...statuses[index],
				status: index >= 6 ? "omitted" : "unsupported"
			};
			continue;
		}
		if (item.bytes > 8388608) {
			statuses[index] = {
				...statuses[index],
				status: "omitted"
			};
			continue;
		}
		candidates.push({
			path: item.path,
			bytes: item.bytes,
			name: item.name,
			mediaType,
			index
		});
	}
	const inlined = [];
	let actualTotalBytes = 0;
	let emittedTotalBytes = 0;
	for (const item of candidates) {
		signal?.throwIfAborted();
		try {
			const imageBytes = await readImageBounded(item.path, MAX_INLINE_IMAGE_TOTAL_BYTES - actualTotalBytes, signal);
			if (imageBytes.length > 8388608 || actualTotalBytes + imageBytes.length > 25165824) {
				statuses[item.index] = {
					...statuses[item.index],
					status: "omitted"
				};
				continue;
			}
			actualTotalBytes += imageBytes.length;
			const ref = await attachments.saveImage({
				data: imageBytes,
				mediaType: item.mediaType,
				name: item.name
			});
			const emittedBytes = ref.bytes ?? imageBytes.length;
			if (!Number.isSafeInteger(emittedBytes) || emittedBytes < 0 || emittedBytes > 8388608 || emittedTotalBytes + emittedBytes > 25165824) {
				statuses[item.index] = {
					...statuses[item.index],
					status: "omitted"
				};
				continue;
			}
			emittedTotalBytes += emittedBytes;
			statuses[item.index] = {
				...statuses[item.index],
				status: "available"
			};
			inlined.push({
				attachment_id: String(ref.attachmentId),
				name: ref.name ?? item.name,
				media_type: ref.mediaType,
				figure: item.index + 1,
				...ref.width !== void 0 ? { width: ref.width } : {},
				...ref.height !== void 0 ? { height: ref.height } : {},
				...ref.bytes !== void 0 ? { bytes: ref.bytes } : {}
			});
		} catch (error) {
			statuses[item.index] = {
				...statuses[item.index],
				status: error instanceof Error && error.message.includes("remaining inline budget") ? "omitted" : "failed"
			};
		}
	}
	return {
		...view,
		ordered_images: statuses,
		...inlined.length > 0 ? { inlined_images: inlined } : {}
	};
}
async function checkCallingModelSupportsImage(exec, ctx) {
	const routed = (exec.agent?.session)?.requestHeader?.()?.config;
	const provider = routed?.provider ?? exec.agent?.options?.provider;
	const model = routed?.model ?? exec.agent?.options?.model;
	const llm = ctx.get("llm");
	if (provider && model && llm && typeof llm.resolveModelInfo === "function") try {
		return (await llm.resolveModelInfo(provider, model, exec.signal))?.inputModalities?.includes("image") ?? false;
	} catch {
		return false;
	}
	return false;
}
function registerTools(ctx, getService, accessGate) {
	const disposers = [];
	const backgroundInvocations = /* @__PURE__ */ new Set();
	const withStorageAccess = async (operation, signal) => {
		return accessGate === void 0 ? await operation() : await accessGate.runShared(operation, signal);
	};
	disposers.push(ctx.tools.register(defineTool({
		name: "async_parse_pdf",
		description: "Submit PDF document parsing as a native background job. Fully parses the PDF to local cache and returns a structured summary (pages, outline, tables, images) upon completion. Use read_pdf to read specific content or pages on demand.",
		parameters: asyncParseParameters,
		output: {
			schema: {
				type: "object",
				properties: {
					job_id: {
						type: "string",
						required: true
					},
					state: {
						type: "string",
						enum: ["running"],
						required: true
					}
				},
				additionalProperties: false
			},
			render: (_args, value) => {
				return [{
					type: "text",
					text: "Started native MinerU background job " + value.job_id + "."
				}];
			},
			presentationMeta: (_args, value) => {
				const output = value;
				return {
					job_id: output.job_id,
					state: output.state
				};
			}
		},
		isConcurrencySafe: () => true,
		execute: async (args, exec) => {
			const agent = requireAgent(exec);
			exec.signal.throwIfAborted();
			const { input } = parseAsyncInput(args);
			const jobs = ctx.get("jobs");
			if (jobs === void 0) throw new MinerUError(failure("PROVIDER_UNAVAILABLE", "Native DSH background jobs are unavailable; load the jobs registry and job tools"));
			const controller = new AbortController();
			return {
				job_id: jobs.start({
					kind: "mineru",
					label: backgroundLabel(input),
					owner: agent,
					run: () => {
						const done = withStorageAccess(() => getService().parseDocument(agent.session, input, controller.signal, null, true), controller.signal).then((value) => nativeSuccessOutcome(value)).catch((error) => {
							if (controller.signal.aborted) return {
								status: "killed",
								detail: "cancelled"
							};
							const normalized = toMinerUFailure(error);
							return {
								status: "failed",
								detail: normalized.code,
								output: "[" + normalized.code + "] " + normalized.message
							};
						});
						const invocation = {
							controller,
							done
						};
						backgroundInvocations.add(invocation);
						done.finally(() => backgroundInvocations.delete(invocation));
						return {
							cancel: (reason) => {
								if (!controller.signal.aborted) controller.abort(new MinerUError(failure("CANCELLED", reason?.trim() || "MinerU background parse cancelled", true)));
							},
							done
						};
					}
				}),
				state: "running"
			};
		}
	})));
	disposers.push(ctx.tools.register(defineTool({
		name: "read_pdf",
		description: "Read and extract structured content from PDF documents synchronously. Supports page selection and content focus. When content_status is complete, full Markdown is provided in markdown_content. When content_status is partial, continue with the returned cursor using the same file_path and no new selection arguments.",
		parameters: readPdfParameters,
		output: {
			schema: parseOutputSchema,
			render: (_args, value) => renderResult(value),
			presentationMeta: (_args, value) => {
				const single = value;
				return {
					result_id: single.result_id,
					source: single.source,
					cache_hit: single.cache_hit,
					manifest_path: single.manifest_path,
					files: single.files.map((f) => ({
						file_id: f.file_id,
						name: f.name,
						artifacts: f.artifacts.map((a) => ({
							kind: a.kind,
							path: a.path,
							bytes: a.bytes
						}))
					})),
					...single.inlined_images !== void 0 ? { inlined_images: single.inlined_images.map((img) => ({
						attachment_id: img.attachment_id,
						name: img.name,
						media_type: img.media_type,
						...img.width !== void 0 ? { width: img.width } : {},
						...img.height !== void 0 ? { height: img.height } : {},
						...img.bytes !== void 0 ? { bytes: img.bytes } : {},
						...img.figure !== void 0 ? { figure: img.figure } : {}
					})) } : {},
					...single.ordered_images !== void 0 ? { ordered_images: single.ordered_images.map((img) => ({
						path: img.path,
						name: img.name,
						media_type: img.media_type,
						bytes: img.bytes,
						...img.page !== void 0 ? { page: img.page } : {},
						...img.caption !== void 0 ? { caption: img.caption } : {},
						...img.status !== void 0 ? { status: img.status } : {}
					})) } : {},
					...single.summary !== void 0 ? { summary: {
						...single.summary.page_count !== void 0 ? { page_count: single.summary.page_count } : {},
						...single.summary.table_count !== void 0 ? { table_count: single.summary.table_count } : {},
						...single.summary.image_count !== void 0 ? { image_count: single.summary.image_count } : {},
						...single.summary.equation_count !== void 0 ? { equation_count: single.summary.equation_count } : {},
						...single.summary.toc !== void 0 ? { toc: single.summary.toc.map((item) => ({
							level: item.level,
							title: item.title,
							...item.line !== void 0 ? { line: item.line } : {},
							...item.page !== void 0 ? { page: item.page } : {}
						})) } : {}
					} } : {},
					...single.toc !== void 0 ? { toc: single.toc.map((item) => ({
						level: item.level,
						title: item.title,
						...item.line !== void 0 ? { line: item.line } : {},
						...item.page !== void 0 ? { page: item.page } : {}
					})) } : {},
					...single.pages !== void 0 ? { pages: single.pages } : {},
					...single.cursor !== void 0 ? { cursor: single.cursor } : {},
					...single.warnings !== void 0 ? { warnings: [...single.warnings] } : {}
				};
			}
		},
		isConcurrencySafe: () => true,
		execute: async (args, exec) => {
			const agent = requireAgent(exec);
			const { input, pollTimeoutMs, inline_images } = parseReadInput(args);
			const supportsImage = await checkCallingModelSupportsImage(exec, ctx);
			const attachments = ctx.get("attachments");
			const focusSet = normalizeFocusSelection(input.focus);
			const focusIncludesImages = focusSet.has("all") || focusSet.has("image");
			const shouldInline = inline_images !== false && focusIncludesImages && supportsImage && attachments !== void 0;
			return await withStorageAccess(async () => {
				const rawResult = await getService().parseDocument(agent.session, input, exec.signal, pollTimeoutMs);
				return fitPostImageBudget(shouldInline && attachments ? await inlineImagesForSingleResult(rawResult, attachments, exec.signal) : rawResult);
			}, exec.signal);
		}
	})));
	return async () => {
		for (const dispose of disposers) dispose();
		const active = [...backgroundInvocations];
		for (const invocation of active) if (!invocation.controller.signal.aborted) invocation.controller.abort(new MinerUError(failure("CANCELLED", "MinerU plugin disposed", true)));
		await Promise.allSettled(active.map((invocation) => invocation.done));
	};
}
//#endregion
//#region src/rpc.ts
const RPC_CHANNEL = "/dsh-pdf-mineru-api";
const MINERU_TO_RPC_ERROR_CODE = {
	INVALID_REQUEST: "mineru/invalid-argument",
	FILE_NOT_FOUND: "mineru/not-found",
	FILE_TOO_LARGE: "mineru/file-too-large",
	UNSUPPORTED_OPTION: "mineru/unsupported-option",
	CREDENTIAL_MISSING: "mineru/credential-missing",
	AUTHENTICATION_FAILED: "mineru/auth-failed",
	PROVIDER_UNAVAILABLE: "mineru/provider-unavailable",
	PROVIDER_CONFIG_MISSING: "mineru/provider-config-missing",
	PROVIDER_RATE_LIMITED: "mineru/provider-rate-limited",
	PROVIDER_QUOTA_EXHAUSTED: "mineru/quota-exhausted",
	UPLOAD_FAILED: "mineru/upload-failed",
	REMOTE_PARSE_FAILED: "mineru/remote-parse-failed",
	RESULT_NOT_READY: "mineru/result-not-ready",
	RESULT_DOWNLOAD_FAILED: "mineru/download-failed",
	RESULT_ARCHIVE_INVALID: "mineru/archive-invalid",
	RESULT_TOO_LARGE: "mineru/result-too-large",
	CACHE_CORRUPT: "mineru/cache-corrupt",
	CACHE_CONFLICT: "mineru/cache-conflict",
	CACHE_EVICTED: "mineru/cache-evicted",
	INTERRUPTED_UPLOAD: "mineru/interrupted-upload",
	POLL_TIMEOUT: "mineru/timeout",
	CANCELLED: "mineru/cancelled",
	UNAUTHENTICATED_SESSION: "mineru/unauthenticated",
	JOB_NOT_FOUND: "mineru/not-found",
	STORAGE_LOCKED: "mineru/storage-locked"
};
function ok(value) {
	return {
		ok: true,
		value
	};
}
function payloadRecord(payload) {
	if (payload === void 0) return {};
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new TypeError("payload must be an object");
	return payload;
}
function optionalLimit(payload, key) {
	const value = payload[key];
	if (value === void 0) return void 0;
	if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(key + " must be a positive safe integer");
	return value;
}
function optionalBoolean(payload, key, fallback) {
	const value = payload[key];
	if (value === void 0) return fallback;
	if (typeof value !== "boolean") throw new TypeError(key + " must be a boolean");
	return value;
}
function fail(message, code = "mineru/internal") {
	return {
		ok: false,
		error: {
			code,
			message: sanitizeDiagnostic(message)
		}
	};
}
function mapRpcError(err) {
	if (err instanceof MinerUError) return {
		code: MINERU_TO_RPC_ERROR_CODE[err.failure.code] ?? "mineru/internal",
		message: sanitizeDiagnostic(err.failure.message)
	};
	if (err instanceof TypeError) return {
		code: "mineru/invalid-argument",
		message: sanitizeDiagnostic(err.message)
	};
	if (err instanceof Error && err.name === "AbortError") return {
		code: "mineru/cancelled",
		message: sanitizeDiagnostic(err.message)
	};
	return {
		code: "mineru/internal",
		message: sanitizeDiagnostic(err instanceof Error ? err.message : String(err))
	};
}
function registerRpc(ctx, deps) {
	ctx.logger?.info("dsh-pdf-mineru: registering RPC channel /dsh-pdf-mineru-api");
	const dispose = ctx.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload, signal) => {
		try {
			switch (endpoint) {
				case "mineru/config.get":
					payloadRecord(payload);
					return ok({ config: deps.getConfig() });
				case "mineru/config.set": {
					const p = payloadRecord(payload);
					if (!Object.hasOwn(p, "config") || p.config === void 0 || p.config === null) throw new TypeError("payload.config must be a non-null configuration object");
					return ok({ config: await deps.setConfig(parseConfig(p.config)) });
				}
				case "mineru/probe": {
					const p = payloadRecord(payload);
					return ok(await deps.probe(p.provider, signal));
				}
				case "mineru/storage.stats": {
					payloadRecord(payload);
					const report = await deps.maintenance.getStatistics(signal);
					ctx.logger?.info("dsh-pdf-mineru", {
						phase: "maintenance",
						operation: "stats"
					});
					return ok(report);
				}
				case "mineru/storage.integrity.scan": {
					const p = payloadRecord(payload);
					const isolateInvalid = optionalBoolean(p, "isolate_invalid", false);
					if (isolateInvalid && p.confirm !== true) throw new TypeError("confirm must be true when isolating invalid results");
					const report = await deps.maintenance.scanIntegrity({
						resultLimit: optionalLimit(p, "result_limit"),
						diagnosticLimit: optionalLimit(p, "diagnostic_limit"),
						isolateInvalid,
						signal
					});
					ctx.logger?.info("dsh-pdf-mineru", {
						phase: "maintenance",
						operation: isolateInvalid ? "integrity-isolate" : "integrity-scan",
						scanned: report.scan.scanned,
						quarantined: report.quarantinedCount
					});
					return ok(report);
				}
				case "mineru/storage.quarantine.list": {
					const p = payloadRecord(payload);
					return ok(await deps.maintenance.listQuarantine({
						limit: optionalLimit(p, "limit"),
						signal
					}));
				}
				case "mineru/storage.quarantine.cleanup": {
					const p = payloadRecord(payload);
					if (!Array.isArray(p.entry_ids) || p.entry_ids.some((entry) => typeof entry !== "string")) throw new TypeError("entry_ids must be an array of strings");
					const dryRun = optionalBoolean(p, "dry_run", true);
					if (!dryRun && p.confirm !== true) throw new TypeError("confirm must be true when deleting quarantine entries");
					const report = await deps.maintenance.cleanupQuarantine({
						entryIds: p.entry_ids,
						dryRun,
						signal
					});
					ctx.logger?.info("dsh-pdf-mineru", {
						phase: "maintenance",
						operation: dryRun ? "quarantine-cleanup-preview" : "quarantine-cleanup",
						requested: report.requestedCount,
						deleted: report.deletedCount,
						bytes: report.deletedBytes
					});
					return ok(report);
				}
				case "mineru/storage.cache.clear": {
					const p = payloadRecord(payload);
					const dryRun = optionalBoolean(p, "dry_run", true);
					if (!dryRun && p.confirm !== true) throw new TypeError("confirm must be true when clearing published cache results");
					if (!dryRun && (typeof p.confirmation_token !== "string" || p.confirmation_token.length === 0)) throw new TypeError("confirmation_token from a cache clear preview is required");
					const report = await deps.maintenance.clearCache({
						resultLimit: optionalLimit(p, "result_limit"),
						diagnosticLimit: optionalLimit(p, "diagnostic_limit"),
						dryRun,
						...typeof p.confirmation_token === "string" ? { confirmationToken: p.confirmation_token } : {},
						signal
					});
					ctx.logger?.info("dsh-pdf-mineru", {
						phase: "maintenance",
						operation: dryRun ? "cache-clear-preview" : "cache-clear",
						eligible: report.eligible,
						planned: report.plannedCount,
						deleted: report.deletedCount,
						bytes: report.deletedBytes
					});
					return ok(report);
				}
				case "mineru/storage.gc.preview": {
					const p = payloadRecord(payload);
					const report = await deps.maintenance.gcDryRun({
						resultLimit: optionalLimit(p, "result_limit"),
						candidateLimit: optionalLimit(p, "candidate_limit"),
						diagnosticLimit: optionalLimit(p, "diagnostic_limit"),
						signal
					});
					ctx.logger?.info("dsh-pdf-mineru", {
						phase: "maintenance",
						operation: "gc-preview",
						eligible: report.eligible,
						candidates: report.candidateCount,
						bytes: report.candidateBytes
					});
					return ok(report);
				}
				default: return fail(`unknown endpoint: ${endpoint}`, "mineru/not-found");
			}
		} catch (err) {
			const { code, message } = mapRpcError(err);
			return {
				ok: false,
				error: {
					code,
					message
				}
			};
		}
	}, { authority: "loopback" });
	return typeof dispose === "function" ? () => dispose() : () => void 0;
}
//#endregion
//#region src/index.ts
const name = "dsh-pdf-mineru";
const inject = [
	"tools",
	"jobs",
	"settings"
];
const ProviderSchema = z.union([z.object({
	id: z.string(),
	type: z.const("self-hosted-v2"),
	baseURL: z.string(),
	apiKeyEnv: z.string().role("credential-ref"),
	modelMap: z.object({
		pipeline: z.string(),
		vlm: z.string()
	}),
	configuredVersion: z.string(),
	allowInsecureHttp: z.boolean()
}), z.object({
	id: z.string(),
	type: z.const("official-v4"),
	baseURL: z.string(),
	apiKeyEnv: z.string().role("credential-ref"),
	models: z.array(z.union(["pipeline", "vlm"])),
	configuredVersion: z.string()
})]);
const Config = z.object({
	schemaVersion: z.const(1),
	activeProvider: z.string(),
	providers: z.array(ProviderSchema),
	defaults: z.object({
		model: z.union(["pipeline", "vlm"]),
		ocr: z.boolean(),
		parseMethod: z.union([
			"auto",
			"txt",
			"ocr"
		]),
		language: z.string(),
		formula: z.boolean(),
		table: z.boolean()
	}),
	storage: z.object({
		storageRoot: z.string(),
		cacheEnabled: z.boolean(),
		retainSources: z.const(false),
		stagingTtlMs: z.number()
	}),
	polling: z.object({
		pollIntervalMs: z.number(),
		pollTimeoutMs: z.number(),
		requestTimeoutMs: z.number(),
		operationTimeoutMs: z.number()
	}),
	retry: z.object({
		maxAttempts: z.number(),
		baseDelayMs: z.number(),
		maxDelayMs: z.number()
	}),
	output: z.object({ maxInlineChars: z.number() }),
	limits: z.object({
		maxFileBytes: z.number(),
		maxApiResponseBytes: z.number(),
		maxZipDownloadBytes: z.number(),
		maxZipEntries: z.number(),
		maxZipEntryBytes: z.number(),
		maxZipTotalBytes: z.number(),
		maxZipCompressionRatio: z.number()
	})
});
function isInactiveContextError(error) {
	if (!(error instanceof Error)) return false;
	return error.code === "INACTIVE_EFFECT" || error.message === "cannot create effect on inactive context";
}
function asObject(value) {
	return value;
}
function parseDraftProvider(value, current) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("provider draft must be an object");
	const id = value.id;
	if (typeof id !== "string") throw new TypeError("provider draft id is required");
	return parseConfig({
		...current,
		activeProvider: id,
		providers: [value]
	}).providers[0];
}
async function apply(ctx, entryConfig = {}) {
	let persistedConfig = parseConfig(entryConfig);
	let fixedStorageRoot;
	let fixedLimits;
	let toolDisposer;
	let operations;
	const startup = new AbortController();
	ctx.effect(() => () => startup.abort(), "dsh-pdf-mineru startup cancellation");
	const validateRuntimeConfig = (value) => {
		const next = parseConfig(value);
		if (fixedStorageRoot !== void 0 && next.storage.storageRoot !== fixedStorageRoot) throw new TypeError("storage.storageRoot cannot change while the MinerU plugin is running");
		if (fixedLimits !== void 0) {
			for (const key of Object.keys(fixedLimits)) if (next.limits[key] !== fixedLimits[key]) throw new TypeError(`limits.${key} requires a MinerU plugin restart`);
		}
		return next;
	};
	const runtimeConfig = () => persistedConfig;
	const settings = ctx.get("settings");
	if (settings === void 0) throw new Error("settings service is unavailable");
	const settingsScope = settings.register("dsh-pdf-mineru", Config, {
		base: asObject(persistedConfig),
		applies: "live",
		validate: (value) => {
			validateRuntimeConfig(value);
		}
	});
	persistedConfig = validateRuntimeConfig(settingsScope.get());
	fixedStorageRoot = persistedConfig.storage.storageRoot;
	fixedLimits = { ...persistedConfig.limits };
	ctx.effect(() => settingsScope.watch((next) => {
		persistedConfig = validateRuntimeConfig(next);
	}), "dsh-pdf-mineru settings watch");
	const paths = new StoragePaths(fixedStorageRoot);
	const lock = new ProcessLock(paths);
	try {
		await lock.initialize(startup.signal);
		startup.signal.throwIfAborted();
		const operationRegistry = new SharedOperationRegistry();
		operations = operationRegistry;
		const accessGate = new StorageAccessGate({
			paths,
			lock
		});
		const results = new ResultRepository(paths, {
			maxArtifactBytes: persistedConfig.limits.maxZipEntryBytes,
			maxJsonValidationBytes: Math.min(persistedConfig.limits.maxZipEntryBytes, 67108864)
		}, lock);
		await results.cleanupStaging(persistedConfig.storage.stagingTtlMs, operationRegistry.activeOperationIds(), startup.signal);
		startup.signal.throwIfAborted();
		const maintenance = new StorageMaintenanceService(paths, results, operationRegistry, lock, accessGate);
		const service = new MinerUService({
			getConfig: runtimeConfig,
			providers: new ProviderRegistry(runtimeConfig),
			results,
			operations: operationRegistry,
			diagnostics: createStructuredDiagnosticSink(ctx.logger),
			accessGate,
			resolveCredential: async (reference, signal) => {
				signal.throwIfAborted();
				const resolved = await ctx.get("credentials")?.resolve(reference);
				signal.throwIfAborted();
				if (resolved?.value) return resolved.value;
				const environment = process.env[reference];
				return environment && environment.length > 0 ? environment : void 0;
			}
		});
		toolDisposer = registerTools(ctx, () => service, accessGate);
		ctx.inject(["connection"], (connectionCtx) => {
			return registerRpc(connectionCtx, {
				getConfig: () => persistedConfig,
				setConfig: async (value) => {
					const next = validateRuntimeConfig(value);
					await settingsScope.replace(asObject(next));
					persistedConfig = next;
					return next;
				},
				probe: async (provider, signal) => service.probe(signal, provider === void 0 ? void 0 : parseDraftProvider(provider, persistedConfig)),
				maintenance
			});
		});
		let disposing;
		const dispose = () => {
			disposing ??= (async () => {
				await toolDisposer?.();
				await operationRegistry.shutdown();
			})();
			return disposing;
		};
		ctx.effect(() => async () => {
			await dispose();
		}, "dsh-pdf-mineru lifecycle");
		return dispose;
	} catch (error) {
		await toolDisposer?.();
		if (operations !== void 0) await operations.shutdown();
		if (startup.signal.aborted || isInactiveContextError(error)) return async () => void 0;
		throw error;
	}
}
//#endregion
export { ARTIFACT_KINDS, CACHE_KEY_SPEC_VERSION, CANONICAL_PARSE_REQUEST_SCHEMA_VERSION, Config, DEFAULT_OUTPUT_CONFIG, DEFAULT_PARSE_DEFAULTS, DEFAULT_POLLING_CONFIG, DEFAULT_RETRY_CONFIG, DEFAULT_RETRY_POLICY, DEFAULT_SECURITY_LIMITS, DEFAULT_STORAGE_OPTIONS, FOCUS_KINDS, MINERU_RESULT_MANIFEST_SCHEMA_VERSION, MinerUError, MinerUService, OfficialV4Provider, ProviderHttpClient, RESULT_SCHEMA_VERSION, SelfHostedV2Provider, StorageMaintenanceService, apply, asCacheKey, asFileId, asOperationId, asProviderConfigId, asResultId, asSessionId, assertSafePathSegment, cacheClearConfirmationToken, calculateBackoffDelay, computeDocumentSummary, createFileId, createHttpStatusError, createOperationId, createStructuredDiagnosticSink, defaultMinerUConfig, defaultProviderConfig, defaultSleep, emitDiagnostic, executeWithRetry, extractBlocksMarkdown, extractErrorMessage, extractMarkdownHeadings, failure, fallbackExtractFromMarkdown, findMarkdownArtifactPath, formatCaption, formatResultProse, formatSingleSummaryProse, formatTocMarkdown, getBlockCategory, getRasterMediaType, inject, isRetryableError, isRetryableHttpStatus, mergeRetryOptions, name, narrowPageSelection, normalizeArtifactKinds, normalizeFocusSelection, normalizePageRanges, normalizePageSelection, parseConfig, parseRetryAfter, providerById, readBoundedResponseText, readMarkdownFile, resolveProviderUrl, resolveRetryPolicy, resultIdForCacheKey, safeStringSlice, sanitizeDiagnostic, throwMinerU, toMinerUFailure, truncateAtCleanBoundary, validateProviderCapabilities };
