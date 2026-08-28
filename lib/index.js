import { createRequire } from "node:module";
import z from "@deepseek-ai/schemastery";
import { homedir, hostname } from "node:os";
import { basename, dirname, extname, isAbsolute, join, parse, posix, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { PassThrough, Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { TextDecoder } from "node:util";
import { createServer } from "node:net";
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
const PREFIXED_ID = /^(?:mj|mr|mf|mp|mo)_[A-Za-z0-9][A-Za-z0-9._-]{0,123}$/;
const CACHE_KEY = /^[a-f0-9]{64}$/;
function assertSafePathSegment(value, label) {
	if (!SAFE_SEGMENT.test(value) || value === "." || value === "..") throw new TypeError(`${label} must be a safe path segment`);
	return value;
}
function assertPrefixedId(value, prefix) {
	if (!value.startsWith(`${prefix}_`) || !PREFIXED_ID.test(value)) throw new TypeError(`invalid ${prefix} identifier`);
	return value;
}
const asJobId = (value) => assertPrefixedId(value, "mj");
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
function randomId(prefix) {
	return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
const createJobId = () => asJobId(randomId("mj"));
const createOperationId = () => asOperationId(randomId("mo"));
function createFileId(sha256, index = 0) {
	if (!CACHE_KEY.test(sha256)) throw new TypeError("source SHA-256 is invalid");
	return asFileId(`mf_${sha256.slice(0, 28)}_${String(index)}`);
}
function resultIdForCacheKey(cacheKey) {
	return asResultId(`mr_${cacheKey.slice(0, 32)}`);
}
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
	const id = asProviderConfigId("mp_self_hosted");
	return {
		schemaVersion: 1,
		activeProvider: id,
		providers: [{
			id,
			type: "self-hosted-v2",
			baseURL: "http://localhost:18000",
			apiKeyEnv: "MINERU_API_KEY",
			modelMap: {
				pipeline: "pipeline",
				vlm: "vlm-engine"
			},
			allowInsecureHttp: true
		}],
		defaults: {
			model: "pipeline",
			ocr: false,
			parseMethod: "auto",
			language: "ch",
			formula: true,
			table: true,
			artifacts: ["markdown"]
		},
		storage: {
			storageRoot: join(dshHome(), "cache", "pdf-mineru"),
			cacheEnabled: true,
			retainSources: false,
			stagingTtlMs: 864e5
		},
		polling: {
			pollIntervalMs: 2e3,
			pollTimeoutMs: 6e5,
			requestTimeoutMs: 6e4,
			operationTimeoutMs: 36e5
		},
		retry: {
			maxAttempts: 3,
			baseDelayMs: 500,
			maxDelayMs: 1e4
		},
		output: { maxInlineChars: 2e5 },
		limits: {
			maxFilesPerRequest: 1,
			maxFileBytes: 209715200,
			maxApiResponseBytes: 8388608,
			maxZipDownloadBytes: 536870912,
			maxZipEntries: 1e4,
			maxZipEntryBytes: 268435456,
			maxZipTotalBytes: 2147483648,
			maxZipCompressionRatio: 200
		}
	};
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
function artifacts(value, fallback) {
	const input = value === void 0 ? fallback : value;
	const allowed = /* @__PURE__ */ new Set([
		"markdown",
		"layout",
		"model-output",
		"content-list",
		"images"
	]);
	if (!Array.isArray(input) || input.some((item) => typeof item !== "string" || !allowed.has(item))) throw new TypeError("defaults.artifacts contains an unsupported artifact");
	return [.../* @__PURE__ */ new Set(["markdown", ...input])];
}
function parseProvider(value) {
	const input = record(value, "provider");
	const id = asProviderConfigId(text(input.id, "", "provider.id"));
	if (input.type === "official-v4") return {
		id,
		type: "official-v4",
		baseURL: baseUrl(input.baseURL, "https://mineru.net/api/v4", false, "provider.baseURL"),
		apiKeyEnv: credentialRef(input.apiKeyEnv, "MINERU_API_KEY", true),
		models: models(input.models, ["pipeline", "vlm"]),
		configuredVersion: "v4"
	};
	if (input.type !== "self-hosted-v2") throw new TypeError("provider.type is unsupported");
	const allowInsecureHttp = booleanValue(input.allowInsecureHttp, false, "provider.allowInsecureHttp");
	const map = record(input.modelMap, "provider.modelMap");
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
	if (!Array.isArray(input.providers) || input.providers.length === 0) throw new TypeError("providers must be a non-empty array");
	const providers = input.providers.map(parseProvider);
	if (new Set(providers.map((provider) => provider.id)).size !== providers.length) throw new TypeError("provider ids must be unique");
	const activeProvider = asProviderConfigId(text(input.activeProvider, "", "activeProvider"));
	if (!providers.some((provider) => provider.id === activeProvider)) throw new TypeError("activeProvider does not identify a configured provider");
	const defaults = record(input.defaults ?? {}, "defaults");
	const storage = record(input.storage ?? {}, "storage");
	const polling = record(input.polling ?? {}, "polling");
	const retry = record(input.retry ?? {}, "retry");
	const output = record(input.output ?? {}, "output");
	const limits = record(input.limits ?? {}, "limits");
	const model = defaults.model === void 0 ? fallback.defaults.model : defaults.model;
	if (model !== "pipeline" && model !== "vlm") throw new TypeError("defaults.model is invalid");
	const storageRoot = text(storage.storageRoot, fallback.storage.storageRoot, "storage.storageRoot");
	const result = {
		schemaVersion: 1,
		activeProvider,
		providers,
		defaults: {
			model,
			ocr: (() => {
				const method = defaults.parseMethod ?? (defaults.ocr === true ? "ocr" : fallback.defaults.parseMethod);
				if (method !== "auto" && method !== "txt" && method !== "ocr") throw new TypeError("defaults.parseMethod is invalid");
				const ocr = booleanValue(defaults.ocr, method === "ocr", "defaults.ocr");
				if (ocr !== (method === "ocr")) throw new TypeError("defaults.ocr conflicts with defaults.parseMethod");
				return ocr;
			})(),
			parseMethod: (() => {
				const method = defaults.parseMethod ?? (defaults.ocr === true ? "ocr" : fallback.defaults.parseMethod);
				if (method !== "auto" && method !== "txt" && method !== "ocr") throw new TypeError("defaults.parseMethod is invalid");
				return method;
			})(),
			language: text(defaults.language, fallback.defaults.language, "defaults.language"),
			formula: booleanValue(defaults.formula, fallback.defaults.formula, "defaults.formula"),
			table: booleanValue(defaults.table, fallback.defaults.table, "defaults.table"),
			artifacts: artifacts(defaults.artifacts, fallback.defaults.artifacts)
		},
		storage: {
			storageRoot: isAbsolute(storageRoot) ? resolve(storageRoot) : resolve(storageRoot),
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
			maxFilesPerRequest: positive(limits.maxFilesPerRequest, fallback.limits.maxFilesPerRequest, "limits.maxFilesPerRequest"),
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
function migrateConfig(value) {
	const fallback = defaultMinerUConfig();
	if (value === void 0 || value === null) return fallback;
	const input = record(value, "config");
	const allowed = /* @__PURE__ */ new Set([
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
	for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`config contains unsupported property ${key}`);
	return parseCanonical(input, fallback);
}
function providerById(config, id) {
	return config.providers.find((provider) => provider.id === id);
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
//#region node_modules/.pnpm/delayed-stream@1.0.0/node_modules/delayed-stream/lib/delayed_stream.js
var require_delayed_stream = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Stream$2 = __require("stream").Stream;
	var util$4 = __require("util");
	module.exports = DelayedStream;
	function DelayedStream() {
		this.source = null;
		this.dataSize = 0;
		this.maxDataSize = 1048576;
		this.pauseStream = true;
		this._maxDataSizeExceeded = false;
		this._released = false;
		this._bufferedEvents = [];
	}
	util$4.inherits(DelayedStream, Stream$2);
	DelayedStream.create = function(source, options) {
		var delayedStream = new this();
		options = options || {};
		for (var option in options) delayedStream[option] = options[option];
		delayedStream.source = source;
		var realEmit = source.emit;
		source.emit = function() {
			delayedStream._handleEmit(arguments);
			return realEmit.apply(source, arguments);
		};
		source.on("error", function() {});
		if (delayedStream.pauseStream) source.pause();
		return delayedStream;
	};
	Object.defineProperty(DelayedStream.prototype, "readable", {
		configurable: true,
		enumerable: true,
		get: function() {
			return this.source.readable;
		}
	});
	DelayedStream.prototype.setEncoding = function() {
		return this.source.setEncoding.apply(this.source, arguments);
	};
	DelayedStream.prototype.resume = function() {
		if (!this._released) this.release();
		this.source.resume();
	};
	DelayedStream.prototype.pause = function() {
		this.source.pause();
	};
	DelayedStream.prototype.release = function() {
		this._released = true;
		this._bufferedEvents.forEach(function(args) {
			this.emit.apply(this, args);
		}.bind(this));
		this._bufferedEvents = [];
	};
	DelayedStream.prototype.pipe = function() {
		var r = Stream$2.prototype.pipe.apply(this, arguments);
		this.resume();
		return r;
	};
	DelayedStream.prototype._handleEmit = function(args) {
		if (this._released) {
			this.emit.apply(this, args);
			return;
		}
		if (args[0] === "data") {
			this.dataSize += args[1].length;
			this._checkIfMaxDataSizeExceeded();
		}
		this._bufferedEvents.push(args);
	};
	DelayedStream.prototype._checkIfMaxDataSizeExceeded = function() {
		if (this._maxDataSizeExceeded) return;
		if (this.dataSize <= this.maxDataSize) return;
		this._maxDataSizeExceeded = true;
		var message = "DelayedStream#maxDataSize of " + this.maxDataSize + " bytes exceeded.";
		this.emit("error", new Error(message));
	};
}));
//#endregion
//#region node_modules/.pnpm/combined-stream@1.0.8/node_modules/combined-stream/lib/combined_stream.js
var require_combined_stream = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var util$3 = __require("util");
	var Stream$1 = __require("stream").Stream;
	var DelayedStream = require_delayed_stream();
	module.exports = CombinedStream;
	function CombinedStream() {
		this.writable = false;
		this.readable = true;
		this.dataSize = 0;
		this.maxDataSize = 2097152;
		this.pauseStreams = true;
		this._released = false;
		this._streams = [];
		this._currentStream = null;
		this._insideLoop = false;
		this._pendingNext = false;
	}
	util$3.inherits(CombinedStream, Stream$1);
	CombinedStream.create = function(options) {
		var combinedStream = new this();
		options = options || {};
		for (var option in options) combinedStream[option] = options[option];
		return combinedStream;
	};
	CombinedStream.isStreamLike = function(stream) {
		return typeof stream !== "function" && typeof stream !== "string" && typeof stream !== "boolean" && typeof stream !== "number" && !Buffer.isBuffer(stream);
	};
	CombinedStream.prototype.append = function(stream) {
		if (CombinedStream.isStreamLike(stream)) {
			if (!(stream instanceof DelayedStream)) {
				var newStream = DelayedStream.create(stream, {
					maxDataSize: Infinity,
					pauseStream: this.pauseStreams
				});
				stream.on("data", this._checkDataSize.bind(this));
				stream = newStream;
			}
			this._handleErrors(stream);
			if (this.pauseStreams) stream.pause();
		}
		this._streams.push(stream);
		return this;
	};
	CombinedStream.prototype.pipe = function(dest, options) {
		Stream$1.prototype.pipe.call(this, dest, options);
		this.resume();
		return dest;
	};
	CombinedStream.prototype._getNext = function() {
		this._currentStream = null;
		if (this._insideLoop) {
			this._pendingNext = true;
			return;
		}
		this._insideLoop = true;
		try {
			do {
				this._pendingNext = false;
				this._realGetNext();
			} while (this._pendingNext);
		} finally {
			this._insideLoop = false;
		}
	};
	CombinedStream.prototype._realGetNext = function() {
		var stream = this._streams.shift();
		if (typeof stream == "undefined") {
			this.end();
			return;
		}
		if (typeof stream !== "function") {
			this._pipeNext(stream);
			return;
		}
		stream(function(stream) {
			if (CombinedStream.isStreamLike(stream)) {
				stream.on("data", this._checkDataSize.bind(this));
				this._handleErrors(stream);
			}
			this._pipeNext(stream);
		}.bind(this));
	};
	CombinedStream.prototype._pipeNext = function(stream) {
		this._currentStream = stream;
		if (CombinedStream.isStreamLike(stream)) {
			stream.on("end", this._getNext.bind(this));
			stream.pipe(this, { end: false });
			return;
		}
		var value = stream;
		this.write(value);
		this._getNext();
	};
	CombinedStream.prototype._handleErrors = function(stream) {
		var self = this;
		stream.on("error", function(err) {
			self._emitError(err);
		});
	};
	CombinedStream.prototype.write = function(data) {
		this.emit("data", data);
	};
	CombinedStream.prototype.pause = function() {
		if (!this.pauseStreams) return;
		if (this.pauseStreams && this._currentStream && typeof this._currentStream.pause == "function") this._currentStream.pause();
		this.emit("pause");
	};
	CombinedStream.prototype.resume = function() {
		if (!this._released) {
			this._released = true;
			this.writable = true;
			this._getNext();
		}
		if (this.pauseStreams && this._currentStream && typeof this._currentStream.resume == "function") this._currentStream.resume();
		this.emit("resume");
	};
	CombinedStream.prototype.end = function() {
		this._reset();
		this.emit("end");
	};
	CombinedStream.prototype.destroy = function() {
		this._reset();
		this.emit("close");
	};
	CombinedStream.prototype._reset = function() {
		this.writable = false;
		this._streams = [];
		this._currentStream = null;
	};
	CombinedStream.prototype._checkDataSize = function() {
		this._updateDataSize();
		if (this.dataSize <= this.maxDataSize) return;
		var message = "DelayedStream#maxDataSize of " + this.maxDataSize + " bytes exceeded.";
		this._emitError(new Error(message));
	};
	CombinedStream.prototype._updateDataSize = function() {
		this.dataSize = 0;
		var self = this;
		this._streams.forEach(function(stream) {
			if (!stream.dataSize) return;
			self.dataSize += stream.dataSize;
		});
		if (this._currentStream && this._currentStream.dataSize) this.dataSize += this._currentStream.dataSize;
	};
	CombinedStream.prototype._emitError = function(err) {
		this._reset();
		this.emit("error", err);
	};
}));
//#endregion
//#region node_modules/.pnpm/mime-db@1.52.0/node_modules/mime-db/db.json
var require_db = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"application/1d-interleaved-parityfec": { "source": "iana" },
		"application/3gpdash-qoe-report+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/3gpp-ims+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/3gpphal+json": {
			"source": "iana",
			"compressible": true
		},
		"application/3gpphalforms+json": {
			"source": "iana",
			"compressible": true
		},
		"application/a2l": { "source": "iana" },
		"application/ace+cbor": { "source": "iana" },
		"application/activemessage": { "source": "iana" },
		"application/activity+json": {
			"source": "iana",
			"compressible": true
		},
		"application/alto-costmap+json": {
			"source": "iana",
			"compressible": true
		},
		"application/alto-costmapfilter+json": {
			"source": "iana",
			"compressible": true
		},
		"application/alto-directory+json": {
			"source": "iana",
			"compressible": true
		},
		"application/alto-endpointcost+json": {
			"source": "iana",
			"compressible": true
		},
		"application/alto-endpointcostparams+json": {
			"source": "iana",
			"compressible": true
		},
		"application/alto-endpointprop+json": {
			"source": "iana",
			"compressible": true
		},
		"application/alto-endpointpropparams+json": {
			"source": "iana",
			"compressible": true
		},
		"application/alto-error+json": {
			"source": "iana",
			"compressible": true
		},
		"application/alto-networkmap+json": {
			"source": "iana",
			"compressible": true
		},
		"application/alto-networkmapfilter+json": {
			"source": "iana",
			"compressible": true
		},
		"application/alto-updatestreamcontrol+json": {
			"source": "iana",
			"compressible": true
		},
		"application/alto-updatestreamparams+json": {
			"source": "iana",
			"compressible": true
		},
		"application/aml": { "source": "iana" },
		"application/andrew-inset": {
			"source": "iana",
			"extensions": ["ez"]
		},
		"application/applefile": { "source": "iana" },
		"application/applixware": {
			"source": "apache",
			"extensions": ["aw"]
		},
		"application/at+jwt": { "source": "iana" },
		"application/atf": { "source": "iana" },
		"application/atfx": { "source": "iana" },
		"application/atom+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["atom"]
		},
		"application/atomcat+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["atomcat"]
		},
		"application/atomdeleted+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["atomdeleted"]
		},
		"application/atomicmail": { "source": "iana" },
		"application/atomsvc+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["atomsvc"]
		},
		"application/atsc-dwd+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["dwd"]
		},
		"application/atsc-dynamic-event-message": { "source": "iana" },
		"application/atsc-held+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["held"]
		},
		"application/atsc-rdt+json": {
			"source": "iana",
			"compressible": true
		},
		"application/atsc-rsat+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["rsat"]
		},
		"application/atxml": { "source": "iana" },
		"application/auth-policy+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/bacnet-xdd+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/batch-smtp": { "source": "iana" },
		"application/bdoc": {
			"compressible": false,
			"extensions": ["bdoc"]
		},
		"application/beep+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/calendar+json": {
			"source": "iana",
			"compressible": true
		},
		"application/calendar+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xcs"]
		},
		"application/call-completion": { "source": "iana" },
		"application/cals-1840": { "source": "iana" },
		"application/captive+json": {
			"source": "iana",
			"compressible": true
		},
		"application/cbor": { "source": "iana" },
		"application/cbor-seq": { "source": "iana" },
		"application/cccex": { "source": "iana" },
		"application/ccmp+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/ccxml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["ccxml"]
		},
		"application/cdfx+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["cdfx"]
		},
		"application/cdmi-capability": {
			"source": "iana",
			"extensions": ["cdmia"]
		},
		"application/cdmi-container": {
			"source": "iana",
			"extensions": ["cdmic"]
		},
		"application/cdmi-domain": {
			"source": "iana",
			"extensions": ["cdmid"]
		},
		"application/cdmi-object": {
			"source": "iana",
			"extensions": ["cdmio"]
		},
		"application/cdmi-queue": {
			"source": "iana",
			"extensions": ["cdmiq"]
		},
		"application/cdni": { "source": "iana" },
		"application/cea": { "source": "iana" },
		"application/cea-2018+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/cellml+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/cfw": { "source": "iana" },
		"application/city+json": {
			"source": "iana",
			"compressible": true
		},
		"application/clr": { "source": "iana" },
		"application/clue+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/clue_info+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/cms": { "source": "iana" },
		"application/cnrp+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/coap-group+json": {
			"source": "iana",
			"compressible": true
		},
		"application/coap-payload": { "source": "iana" },
		"application/commonground": { "source": "iana" },
		"application/conference-info+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/cose": { "source": "iana" },
		"application/cose-key": { "source": "iana" },
		"application/cose-key-set": { "source": "iana" },
		"application/cpl+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["cpl"]
		},
		"application/csrattrs": { "source": "iana" },
		"application/csta+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/cstadata+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/csvm+json": {
			"source": "iana",
			"compressible": true
		},
		"application/cu-seeme": {
			"source": "apache",
			"extensions": ["cu"]
		},
		"application/cwt": { "source": "iana" },
		"application/cybercash": { "source": "iana" },
		"application/dart": { "compressible": true },
		"application/dash+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["mpd"]
		},
		"application/dash-patch+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["mpp"]
		},
		"application/dashdelta": { "source": "iana" },
		"application/davmount+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["davmount"]
		},
		"application/dca-rft": { "source": "iana" },
		"application/dcd": { "source": "iana" },
		"application/dec-dx": { "source": "iana" },
		"application/dialog-info+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/dicom": { "source": "iana" },
		"application/dicom+json": {
			"source": "iana",
			"compressible": true
		},
		"application/dicom+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/dii": { "source": "iana" },
		"application/dit": { "source": "iana" },
		"application/dns": { "source": "iana" },
		"application/dns+json": {
			"source": "iana",
			"compressible": true
		},
		"application/dns-message": { "source": "iana" },
		"application/docbook+xml": {
			"source": "apache",
			"compressible": true,
			"extensions": ["dbk"]
		},
		"application/dots+cbor": { "source": "iana" },
		"application/dskpp+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/dssc+der": {
			"source": "iana",
			"extensions": ["dssc"]
		},
		"application/dssc+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xdssc"]
		},
		"application/dvcs": { "source": "iana" },
		"application/ecmascript": {
			"source": "iana",
			"compressible": true,
			"extensions": ["es", "ecma"]
		},
		"application/edi-consent": { "source": "iana" },
		"application/edi-x12": {
			"source": "iana",
			"compressible": false
		},
		"application/edifact": {
			"source": "iana",
			"compressible": false
		},
		"application/efi": { "source": "iana" },
		"application/elm+json": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/elm+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/emergencycalldata.cap+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/emergencycalldata.comment+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/emergencycalldata.control+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/emergencycalldata.deviceinfo+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/emergencycalldata.ecall.msd": { "source": "iana" },
		"application/emergencycalldata.providerinfo+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/emergencycalldata.serviceinfo+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/emergencycalldata.subscriberinfo+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/emergencycalldata.veds+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/emma+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["emma"]
		},
		"application/emotionml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["emotionml"]
		},
		"application/encaprtp": { "source": "iana" },
		"application/epp+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/epub+zip": {
			"source": "iana",
			"compressible": false,
			"extensions": ["epub"]
		},
		"application/eshop": { "source": "iana" },
		"application/exi": {
			"source": "iana",
			"extensions": ["exi"]
		},
		"application/expect-ct-report+json": {
			"source": "iana",
			"compressible": true
		},
		"application/express": {
			"source": "iana",
			"extensions": ["exp"]
		},
		"application/fastinfoset": { "source": "iana" },
		"application/fastsoap": { "source": "iana" },
		"application/fdt+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["fdt"]
		},
		"application/fhir+json": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/fhir+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/fido.trusted-apps+json": { "compressible": true },
		"application/fits": { "source": "iana" },
		"application/flexfec": { "source": "iana" },
		"application/font-sfnt": { "source": "iana" },
		"application/font-tdpfr": {
			"source": "iana",
			"extensions": ["pfr"]
		},
		"application/font-woff": {
			"source": "iana",
			"compressible": false
		},
		"application/framework-attributes+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/geo+json": {
			"source": "iana",
			"compressible": true,
			"extensions": ["geojson"]
		},
		"application/geo+json-seq": { "source": "iana" },
		"application/geopackage+sqlite3": { "source": "iana" },
		"application/geoxacml+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/gltf-buffer": { "source": "iana" },
		"application/gml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["gml"]
		},
		"application/gpx+xml": {
			"source": "apache",
			"compressible": true,
			"extensions": ["gpx"]
		},
		"application/gxf": {
			"source": "apache",
			"extensions": ["gxf"]
		},
		"application/gzip": {
			"source": "iana",
			"compressible": false,
			"extensions": ["gz"]
		},
		"application/h224": { "source": "iana" },
		"application/held+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/hjson": { "extensions": ["hjson"] },
		"application/http": { "source": "iana" },
		"application/hyperstudio": {
			"source": "iana",
			"extensions": ["stk"]
		},
		"application/ibe-key-request+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/ibe-pkg-reply+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/ibe-pp-data": { "source": "iana" },
		"application/iges": { "source": "iana" },
		"application/im-iscomposing+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/index": { "source": "iana" },
		"application/index.cmd": { "source": "iana" },
		"application/index.obj": { "source": "iana" },
		"application/index.response": { "source": "iana" },
		"application/index.vnd": { "source": "iana" },
		"application/inkml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["ink", "inkml"]
		},
		"application/iotp": { "source": "iana" },
		"application/ipfix": {
			"source": "iana",
			"extensions": ["ipfix"]
		},
		"application/ipp": { "source": "iana" },
		"application/isup": { "source": "iana" },
		"application/its+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["its"]
		},
		"application/java-archive": {
			"source": "apache",
			"compressible": false,
			"extensions": [
				"jar",
				"war",
				"ear"
			]
		},
		"application/java-serialized-object": {
			"source": "apache",
			"compressible": false,
			"extensions": ["ser"]
		},
		"application/java-vm": {
			"source": "apache",
			"compressible": false,
			"extensions": ["class"]
		},
		"application/javascript": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true,
			"extensions": ["js", "mjs"]
		},
		"application/jf2feed+json": {
			"source": "iana",
			"compressible": true
		},
		"application/jose": { "source": "iana" },
		"application/jose+json": {
			"source": "iana",
			"compressible": true
		},
		"application/jrd+json": {
			"source": "iana",
			"compressible": true
		},
		"application/jscalendar+json": {
			"source": "iana",
			"compressible": true
		},
		"application/json": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true,
			"extensions": ["json", "map"]
		},
		"application/json-patch+json": {
			"source": "iana",
			"compressible": true
		},
		"application/json-seq": { "source": "iana" },
		"application/json5": { "extensions": ["json5"] },
		"application/jsonml+json": {
			"source": "apache",
			"compressible": true,
			"extensions": ["jsonml"]
		},
		"application/jwk+json": {
			"source": "iana",
			"compressible": true
		},
		"application/jwk-set+json": {
			"source": "iana",
			"compressible": true
		},
		"application/jwt": { "source": "iana" },
		"application/kpml-request+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/kpml-response+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/ld+json": {
			"source": "iana",
			"compressible": true,
			"extensions": ["jsonld"]
		},
		"application/lgr+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["lgr"]
		},
		"application/link-format": { "source": "iana" },
		"application/load-control+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/lost+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["lostxml"]
		},
		"application/lostsync+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/lpf+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/lxf": { "source": "iana" },
		"application/mac-binhex40": {
			"source": "iana",
			"extensions": ["hqx"]
		},
		"application/mac-compactpro": {
			"source": "apache",
			"extensions": ["cpt"]
		},
		"application/macwriteii": { "source": "iana" },
		"application/mads+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["mads"]
		},
		"application/manifest+json": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true,
			"extensions": ["webmanifest"]
		},
		"application/marc": {
			"source": "iana",
			"extensions": ["mrc"]
		},
		"application/marcxml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["mrcx"]
		},
		"application/mathematica": {
			"source": "iana",
			"extensions": [
				"ma",
				"nb",
				"mb"
			]
		},
		"application/mathml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["mathml"]
		},
		"application/mathml-content+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mathml-presentation+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mbms-associated-procedure-description+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mbms-deregister+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mbms-envelope+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mbms-msk+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mbms-msk-response+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mbms-protection-description+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mbms-reception-report+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mbms-register+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mbms-register-response+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mbms-schedule+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mbms-user-service-description+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mbox": {
			"source": "iana",
			"extensions": ["mbox"]
		},
		"application/media-policy-dataset+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["mpf"]
		},
		"application/media_control+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mediaservercontrol+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["mscml"]
		},
		"application/merge-patch+json": {
			"source": "iana",
			"compressible": true
		},
		"application/metalink+xml": {
			"source": "apache",
			"compressible": true,
			"extensions": ["metalink"]
		},
		"application/metalink4+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["meta4"]
		},
		"application/mets+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["mets"]
		},
		"application/mf4": { "source": "iana" },
		"application/mikey": { "source": "iana" },
		"application/mipc": { "source": "iana" },
		"application/missing-blocks+cbor-seq": { "source": "iana" },
		"application/mmt-aei+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["maei"]
		},
		"application/mmt-usd+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["musd"]
		},
		"application/mods+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["mods"]
		},
		"application/moss-keys": { "source": "iana" },
		"application/moss-signature": { "source": "iana" },
		"application/mosskey-data": { "source": "iana" },
		"application/mosskey-request": { "source": "iana" },
		"application/mp21": {
			"source": "iana",
			"extensions": ["m21", "mp21"]
		},
		"application/mp4": {
			"source": "iana",
			"extensions": ["mp4s", "m4p"]
		},
		"application/mpeg4-generic": { "source": "iana" },
		"application/mpeg4-iod": { "source": "iana" },
		"application/mpeg4-iod-xmt": { "source": "iana" },
		"application/mrb-consumer+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/mrb-publish+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/msc-ivr+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/msc-mixer+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/msword": {
			"source": "iana",
			"compressible": false,
			"extensions": ["doc", "dot"]
		},
		"application/mud+json": {
			"source": "iana",
			"compressible": true
		},
		"application/multipart-core": { "source": "iana" },
		"application/mxf": {
			"source": "iana",
			"extensions": ["mxf"]
		},
		"application/n-quads": {
			"source": "iana",
			"extensions": ["nq"]
		},
		"application/n-triples": {
			"source": "iana",
			"extensions": ["nt"]
		},
		"application/nasdata": { "source": "iana" },
		"application/news-checkgroups": {
			"source": "iana",
			"charset": "US-ASCII"
		},
		"application/news-groupinfo": {
			"source": "iana",
			"charset": "US-ASCII"
		},
		"application/news-transmission": { "source": "iana" },
		"application/nlsml+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/node": {
			"source": "iana",
			"extensions": ["cjs"]
		},
		"application/nss": { "source": "iana" },
		"application/oauth-authz-req+jwt": { "source": "iana" },
		"application/oblivious-dns-message": { "source": "iana" },
		"application/ocsp-request": { "source": "iana" },
		"application/ocsp-response": { "source": "iana" },
		"application/octet-stream": {
			"source": "iana",
			"compressible": false,
			"extensions": [
				"bin",
				"dms",
				"lrf",
				"mar",
				"so",
				"dist",
				"distz",
				"pkg",
				"bpk",
				"dump",
				"elc",
				"deploy",
				"exe",
				"dll",
				"deb",
				"dmg",
				"iso",
				"img",
				"msi",
				"msp",
				"msm",
				"buffer"
			]
		},
		"application/oda": {
			"source": "iana",
			"extensions": ["oda"]
		},
		"application/odm+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/odx": { "source": "iana" },
		"application/oebps-package+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["opf"]
		},
		"application/ogg": {
			"source": "iana",
			"compressible": false,
			"extensions": ["ogx"]
		},
		"application/omdoc+xml": {
			"source": "apache",
			"compressible": true,
			"extensions": ["omdoc"]
		},
		"application/onenote": {
			"source": "apache",
			"extensions": [
				"onetoc",
				"onetoc2",
				"onetmp",
				"onepkg"
			]
		},
		"application/opc-nodeset+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/oscore": { "source": "iana" },
		"application/oxps": {
			"source": "iana",
			"extensions": ["oxps"]
		},
		"application/p21": { "source": "iana" },
		"application/p21+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/p2p-overlay+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["relo"]
		},
		"application/parityfec": { "source": "iana" },
		"application/passport": { "source": "iana" },
		"application/patch-ops-error+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xer"]
		},
		"application/pdf": {
			"source": "iana",
			"compressible": false,
			"extensions": ["pdf"]
		},
		"application/pdx": { "source": "iana" },
		"application/pem-certificate-chain": { "source": "iana" },
		"application/pgp-encrypted": {
			"source": "iana",
			"compressible": false,
			"extensions": ["pgp"]
		},
		"application/pgp-keys": {
			"source": "iana",
			"extensions": ["asc"]
		},
		"application/pgp-signature": {
			"source": "iana",
			"extensions": ["asc", "sig"]
		},
		"application/pics-rules": {
			"source": "apache",
			"extensions": ["prf"]
		},
		"application/pidf+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/pidf-diff+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/pkcs10": {
			"source": "iana",
			"extensions": ["p10"]
		},
		"application/pkcs12": { "source": "iana" },
		"application/pkcs7-mime": {
			"source": "iana",
			"extensions": ["p7m", "p7c"]
		},
		"application/pkcs7-signature": {
			"source": "iana",
			"extensions": ["p7s"]
		},
		"application/pkcs8": {
			"source": "iana",
			"extensions": ["p8"]
		},
		"application/pkcs8-encrypted": { "source": "iana" },
		"application/pkix-attr-cert": {
			"source": "iana",
			"extensions": ["ac"]
		},
		"application/pkix-cert": {
			"source": "iana",
			"extensions": ["cer"]
		},
		"application/pkix-crl": {
			"source": "iana",
			"extensions": ["crl"]
		},
		"application/pkix-pkipath": {
			"source": "iana",
			"extensions": ["pkipath"]
		},
		"application/pkixcmp": {
			"source": "iana",
			"extensions": ["pki"]
		},
		"application/pls+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["pls"]
		},
		"application/poc-settings+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/postscript": {
			"source": "iana",
			"compressible": true,
			"extensions": [
				"ai",
				"eps",
				"ps"
			]
		},
		"application/ppsp-tracker+json": {
			"source": "iana",
			"compressible": true
		},
		"application/problem+json": {
			"source": "iana",
			"compressible": true
		},
		"application/problem+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/provenance+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["provx"]
		},
		"application/prs.alvestrand.titrax-sheet": { "source": "iana" },
		"application/prs.cww": {
			"source": "iana",
			"extensions": ["cww"]
		},
		"application/prs.cyn": {
			"source": "iana",
			"charset": "7-BIT"
		},
		"application/prs.hpub+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/prs.nprend": { "source": "iana" },
		"application/prs.plucker": { "source": "iana" },
		"application/prs.rdf-xml-crypt": { "source": "iana" },
		"application/prs.xsf+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/pskc+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["pskcxml"]
		},
		"application/pvd+json": {
			"source": "iana",
			"compressible": true
		},
		"application/qsig": { "source": "iana" },
		"application/raml+yaml": {
			"compressible": true,
			"extensions": ["raml"]
		},
		"application/raptorfec": { "source": "iana" },
		"application/rdap+json": {
			"source": "iana",
			"compressible": true
		},
		"application/rdf+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["rdf", "owl"]
		},
		"application/reginfo+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["rif"]
		},
		"application/relax-ng-compact-syntax": {
			"source": "iana",
			"extensions": ["rnc"]
		},
		"application/remote-printing": { "source": "iana" },
		"application/reputon+json": {
			"source": "iana",
			"compressible": true
		},
		"application/resource-lists+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["rl"]
		},
		"application/resource-lists-diff+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["rld"]
		},
		"application/rfc+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/riscos": { "source": "iana" },
		"application/rlmi+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/rls-services+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["rs"]
		},
		"application/route-apd+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["rapd"]
		},
		"application/route-s-tsid+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["sls"]
		},
		"application/route-usd+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["rusd"]
		},
		"application/rpki-ghostbusters": {
			"source": "iana",
			"extensions": ["gbr"]
		},
		"application/rpki-manifest": {
			"source": "iana",
			"extensions": ["mft"]
		},
		"application/rpki-publication": { "source": "iana" },
		"application/rpki-roa": {
			"source": "iana",
			"extensions": ["roa"]
		},
		"application/rpki-updown": { "source": "iana" },
		"application/rsd+xml": {
			"source": "apache",
			"compressible": true,
			"extensions": ["rsd"]
		},
		"application/rss+xml": {
			"source": "apache",
			"compressible": true,
			"extensions": ["rss"]
		},
		"application/rtf": {
			"source": "iana",
			"compressible": true,
			"extensions": ["rtf"]
		},
		"application/rtploopback": { "source": "iana" },
		"application/rtx": { "source": "iana" },
		"application/samlassertion+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/samlmetadata+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/sarif+json": {
			"source": "iana",
			"compressible": true
		},
		"application/sarif-external-properties+json": {
			"source": "iana",
			"compressible": true
		},
		"application/sbe": { "source": "iana" },
		"application/sbml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["sbml"]
		},
		"application/scaip+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/scim+json": {
			"source": "iana",
			"compressible": true
		},
		"application/scvp-cv-request": {
			"source": "iana",
			"extensions": ["scq"]
		},
		"application/scvp-cv-response": {
			"source": "iana",
			"extensions": ["scs"]
		},
		"application/scvp-vp-request": {
			"source": "iana",
			"extensions": ["spq"]
		},
		"application/scvp-vp-response": {
			"source": "iana",
			"extensions": ["spp"]
		},
		"application/sdp": {
			"source": "iana",
			"extensions": ["sdp"]
		},
		"application/secevent+jwt": { "source": "iana" },
		"application/senml+cbor": { "source": "iana" },
		"application/senml+json": {
			"source": "iana",
			"compressible": true
		},
		"application/senml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["senmlx"]
		},
		"application/senml-etch+cbor": { "source": "iana" },
		"application/senml-etch+json": {
			"source": "iana",
			"compressible": true
		},
		"application/senml-exi": { "source": "iana" },
		"application/sensml+cbor": { "source": "iana" },
		"application/sensml+json": {
			"source": "iana",
			"compressible": true
		},
		"application/sensml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["sensmlx"]
		},
		"application/sensml-exi": { "source": "iana" },
		"application/sep+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/sep-exi": { "source": "iana" },
		"application/session-info": { "source": "iana" },
		"application/set-payment": { "source": "iana" },
		"application/set-payment-initiation": {
			"source": "iana",
			"extensions": ["setpay"]
		},
		"application/set-registration": { "source": "iana" },
		"application/set-registration-initiation": {
			"source": "iana",
			"extensions": ["setreg"]
		},
		"application/sgml": { "source": "iana" },
		"application/sgml-open-catalog": { "source": "iana" },
		"application/shf+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["shf"]
		},
		"application/sieve": {
			"source": "iana",
			"extensions": ["siv", "sieve"]
		},
		"application/simple-filter+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/simple-message-summary": { "source": "iana" },
		"application/simplesymbolcontainer": { "source": "iana" },
		"application/sipc": { "source": "iana" },
		"application/slate": { "source": "iana" },
		"application/smil": { "source": "iana" },
		"application/smil+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["smi", "smil"]
		},
		"application/smpte336m": { "source": "iana" },
		"application/soap+fastinfoset": { "source": "iana" },
		"application/soap+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/sparql-query": {
			"source": "iana",
			"extensions": ["rq"]
		},
		"application/sparql-results+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["srx"]
		},
		"application/spdx+json": {
			"source": "iana",
			"compressible": true
		},
		"application/spirits-event+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/sql": { "source": "iana" },
		"application/srgs": {
			"source": "iana",
			"extensions": ["gram"]
		},
		"application/srgs+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["grxml"]
		},
		"application/sru+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["sru"]
		},
		"application/ssdl+xml": {
			"source": "apache",
			"compressible": true,
			"extensions": ["ssdl"]
		},
		"application/ssml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["ssml"]
		},
		"application/stix+json": {
			"source": "iana",
			"compressible": true
		},
		"application/swid+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["swidtag"]
		},
		"application/tamp-apex-update": { "source": "iana" },
		"application/tamp-apex-update-confirm": { "source": "iana" },
		"application/tamp-community-update": { "source": "iana" },
		"application/tamp-community-update-confirm": { "source": "iana" },
		"application/tamp-error": { "source": "iana" },
		"application/tamp-sequence-adjust": { "source": "iana" },
		"application/tamp-sequence-adjust-confirm": { "source": "iana" },
		"application/tamp-status-query": { "source": "iana" },
		"application/tamp-status-response": { "source": "iana" },
		"application/tamp-update": { "source": "iana" },
		"application/tamp-update-confirm": { "source": "iana" },
		"application/tar": { "compressible": true },
		"application/taxii+json": {
			"source": "iana",
			"compressible": true
		},
		"application/td+json": {
			"source": "iana",
			"compressible": true
		},
		"application/tei+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["tei", "teicorpus"]
		},
		"application/tetra_isi": { "source": "iana" },
		"application/thraud+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["tfi"]
		},
		"application/timestamp-query": { "source": "iana" },
		"application/timestamp-reply": { "source": "iana" },
		"application/timestamped-data": {
			"source": "iana",
			"extensions": ["tsd"]
		},
		"application/tlsrpt+gzip": { "source": "iana" },
		"application/tlsrpt+json": {
			"source": "iana",
			"compressible": true
		},
		"application/tnauthlist": { "source": "iana" },
		"application/token-introspection+jwt": { "source": "iana" },
		"application/toml": {
			"compressible": true,
			"extensions": ["toml"]
		},
		"application/trickle-ice-sdpfrag": { "source": "iana" },
		"application/trig": {
			"source": "iana",
			"extensions": ["trig"]
		},
		"application/ttml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["ttml"]
		},
		"application/tve-trigger": { "source": "iana" },
		"application/tzif": { "source": "iana" },
		"application/tzif-leap": { "source": "iana" },
		"application/ubjson": {
			"compressible": false,
			"extensions": ["ubj"]
		},
		"application/ulpfec": { "source": "iana" },
		"application/urc-grpsheet+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/urc-ressheet+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["rsheet"]
		},
		"application/urc-targetdesc+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["td"]
		},
		"application/urc-uisocketdesc+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vcard+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vcard+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vemmi": { "source": "iana" },
		"application/vividence.scriptfile": { "source": "apache" },
		"application/vnd.1000minds.decision-model+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["1km"]
		},
		"application/vnd.3gpp-prose+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp-prose-pc3ch+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp-v2x-local-service-information": { "source": "iana" },
		"application/vnd.3gpp.5gnas": { "source": "iana" },
		"application/vnd.3gpp.access-transfer-events+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.bsf+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.gmop+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.gtpc": { "source": "iana" },
		"application/vnd.3gpp.interworking-data": { "source": "iana" },
		"application/vnd.3gpp.lpp": { "source": "iana" },
		"application/vnd.3gpp.mc-signalling-ear": { "source": "iana" },
		"application/vnd.3gpp.mcdata-affiliation-command+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcdata-info+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcdata-payload": { "source": "iana" },
		"application/vnd.3gpp.mcdata-service-config+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcdata-signalling": { "source": "iana" },
		"application/vnd.3gpp.mcdata-ue-config+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcdata-user-profile+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcptt-affiliation-command+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcptt-floor-request+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcptt-info+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcptt-location-info+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcptt-mbms-usage-info+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcptt-service-config+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcptt-signed+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcptt-ue-config+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcptt-ue-init-config+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcptt-user-profile+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcvideo-affiliation-command+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcvideo-affiliation-info+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcvideo-info+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcvideo-location-info+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcvideo-mbms-usage-info+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcvideo-service-config+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcvideo-transmission-request+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcvideo-ue-config+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mcvideo-user-profile+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.mid-call+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.ngap": { "source": "iana" },
		"application/vnd.3gpp.pfcp": { "source": "iana" },
		"application/vnd.3gpp.pic-bw-large": {
			"source": "iana",
			"extensions": ["plb"]
		},
		"application/vnd.3gpp.pic-bw-small": {
			"source": "iana",
			"extensions": ["psb"]
		},
		"application/vnd.3gpp.pic-bw-var": {
			"source": "iana",
			"extensions": ["pvb"]
		},
		"application/vnd.3gpp.s1ap": { "source": "iana" },
		"application/vnd.3gpp.sms": { "source": "iana" },
		"application/vnd.3gpp.sms+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.srvcc-ext+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.srvcc-info+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.state-and-event-info+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp.ussd+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp2.bcmcsinfo+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.3gpp2.sms": { "source": "iana" },
		"application/vnd.3gpp2.tcap": {
			"source": "iana",
			"extensions": ["tcap"]
		},
		"application/vnd.3lightssoftware.imagescal": { "source": "iana" },
		"application/vnd.3m.post-it-notes": {
			"source": "iana",
			"extensions": ["pwn"]
		},
		"application/vnd.accpac.simply.aso": {
			"source": "iana",
			"extensions": ["aso"]
		},
		"application/vnd.accpac.simply.imp": {
			"source": "iana",
			"extensions": ["imp"]
		},
		"application/vnd.acucobol": {
			"source": "iana",
			"extensions": ["acu"]
		},
		"application/vnd.acucorp": {
			"source": "iana",
			"extensions": ["atc", "acutc"]
		},
		"application/vnd.adobe.air-application-installer-package+zip": {
			"source": "apache",
			"compressible": false,
			"extensions": ["air"]
		},
		"application/vnd.adobe.flash.movie": { "source": "iana" },
		"application/vnd.adobe.formscentral.fcdt": {
			"source": "iana",
			"extensions": ["fcdt"]
		},
		"application/vnd.adobe.fxp": {
			"source": "iana",
			"extensions": ["fxp", "fxpl"]
		},
		"application/vnd.adobe.partial-upload": { "source": "iana" },
		"application/vnd.adobe.xdp+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xdp"]
		},
		"application/vnd.adobe.xfdf": {
			"source": "iana",
			"extensions": ["xfdf"]
		},
		"application/vnd.aether.imp": { "source": "iana" },
		"application/vnd.afpc.afplinedata": { "source": "iana" },
		"application/vnd.afpc.afplinedata-pagedef": { "source": "iana" },
		"application/vnd.afpc.cmoca-cmresource": { "source": "iana" },
		"application/vnd.afpc.foca-charset": { "source": "iana" },
		"application/vnd.afpc.foca-codedfont": { "source": "iana" },
		"application/vnd.afpc.foca-codepage": { "source": "iana" },
		"application/vnd.afpc.modca": { "source": "iana" },
		"application/vnd.afpc.modca-cmtable": { "source": "iana" },
		"application/vnd.afpc.modca-formdef": { "source": "iana" },
		"application/vnd.afpc.modca-mediummap": { "source": "iana" },
		"application/vnd.afpc.modca-objectcontainer": { "source": "iana" },
		"application/vnd.afpc.modca-overlay": { "source": "iana" },
		"application/vnd.afpc.modca-pagesegment": { "source": "iana" },
		"application/vnd.age": {
			"source": "iana",
			"extensions": ["age"]
		},
		"application/vnd.ah-barcode": { "source": "iana" },
		"application/vnd.ahead.space": {
			"source": "iana",
			"extensions": ["ahead"]
		},
		"application/vnd.airzip.filesecure.azf": {
			"source": "iana",
			"extensions": ["azf"]
		},
		"application/vnd.airzip.filesecure.azs": {
			"source": "iana",
			"extensions": ["azs"]
		},
		"application/vnd.amadeus+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.amazon.ebook": {
			"source": "apache",
			"extensions": ["azw"]
		},
		"application/vnd.amazon.mobi8-ebook": { "source": "iana" },
		"application/vnd.americandynamics.acc": {
			"source": "iana",
			"extensions": ["acc"]
		},
		"application/vnd.amiga.ami": {
			"source": "iana",
			"extensions": ["ami"]
		},
		"application/vnd.amundsen.maze+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.android.ota": { "source": "iana" },
		"application/vnd.android.package-archive": {
			"source": "apache",
			"compressible": false,
			"extensions": ["apk"]
		},
		"application/vnd.anki": { "source": "iana" },
		"application/vnd.anser-web-certificate-issue-initiation": {
			"source": "iana",
			"extensions": ["cii"]
		},
		"application/vnd.anser-web-funds-transfer-initiation": {
			"source": "apache",
			"extensions": ["fti"]
		},
		"application/vnd.antix.game-component": {
			"source": "iana",
			"extensions": ["atx"]
		},
		"application/vnd.apache.arrow.file": { "source": "iana" },
		"application/vnd.apache.arrow.stream": { "source": "iana" },
		"application/vnd.apache.thrift.binary": { "source": "iana" },
		"application/vnd.apache.thrift.compact": { "source": "iana" },
		"application/vnd.apache.thrift.json": { "source": "iana" },
		"application/vnd.api+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.aplextor.warrp+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.apothekende.reservation+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.apple.installer+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["mpkg"]
		},
		"application/vnd.apple.keynote": {
			"source": "iana",
			"extensions": ["key"]
		},
		"application/vnd.apple.mpegurl": {
			"source": "iana",
			"extensions": ["m3u8"]
		},
		"application/vnd.apple.numbers": {
			"source": "iana",
			"extensions": ["numbers"]
		},
		"application/vnd.apple.pages": {
			"source": "iana",
			"extensions": ["pages"]
		},
		"application/vnd.apple.pkpass": {
			"compressible": false,
			"extensions": ["pkpass"]
		},
		"application/vnd.arastra.swi": { "source": "iana" },
		"application/vnd.aristanetworks.swi": {
			"source": "iana",
			"extensions": ["swi"]
		},
		"application/vnd.artisan+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.artsquare": { "source": "iana" },
		"application/vnd.astraea-software.iota": {
			"source": "iana",
			"extensions": ["iota"]
		},
		"application/vnd.audiograph": {
			"source": "iana",
			"extensions": ["aep"]
		},
		"application/vnd.autopackage": { "source": "iana" },
		"application/vnd.avalon+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.avistar+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.balsamiq.bmml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["bmml"]
		},
		"application/vnd.balsamiq.bmpr": { "source": "iana" },
		"application/vnd.banana-accounting": { "source": "iana" },
		"application/vnd.bbf.usp.error": { "source": "iana" },
		"application/vnd.bbf.usp.msg": { "source": "iana" },
		"application/vnd.bbf.usp.msg+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.bekitzur-stech+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.bint.med-content": { "source": "iana" },
		"application/vnd.biopax.rdf+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.blink-idb-value-wrapper": { "source": "iana" },
		"application/vnd.blueice.multipass": {
			"source": "iana",
			"extensions": ["mpm"]
		},
		"application/vnd.bluetooth.ep.oob": { "source": "iana" },
		"application/vnd.bluetooth.le.oob": { "source": "iana" },
		"application/vnd.bmi": {
			"source": "iana",
			"extensions": ["bmi"]
		},
		"application/vnd.bpf": { "source": "iana" },
		"application/vnd.bpf3": { "source": "iana" },
		"application/vnd.businessobjects": {
			"source": "iana",
			"extensions": ["rep"]
		},
		"application/vnd.byu.uapi+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.cab-jscript": { "source": "iana" },
		"application/vnd.canon-cpdl": { "source": "iana" },
		"application/vnd.canon-lips": { "source": "iana" },
		"application/vnd.capasystems-pg+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.cendio.thinlinc.clientconf": { "source": "iana" },
		"application/vnd.century-systems.tcp_stream": { "source": "iana" },
		"application/vnd.chemdraw+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["cdxml"]
		},
		"application/vnd.chess-pgn": { "source": "iana" },
		"application/vnd.chipnuts.karaoke-mmd": {
			"source": "iana",
			"extensions": ["mmd"]
		},
		"application/vnd.ciedi": { "source": "iana" },
		"application/vnd.cinderella": {
			"source": "iana",
			"extensions": ["cdy"]
		},
		"application/vnd.cirpack.isdn-ext": { "source": "iana" },
		"application/vnd.citationstyles.style+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["csl"]
		},
		"application/vnd.claymore": {
			"source": "iana",
			"extensions": ["cla"]
		},
		"application/vnd.cloanto.rp9": {
			"source": "iana",
			"extensions": ["rp9"]
		},
		"application/vnd.clonk.c4group": {
			"source": "iana",
			"extensions": [
				"c4g",
				"c4d",
				"c4f",
				"c4p",
				"c4u"
			]
		},
		"application/vnd.cluetrust.cartomobile-config": {
			"source": "iana",
			"extensions": ["c11amc"]
		},
		"application/vnd.cluetrust.cartomobile-config-pkg": {
			"source": "iana",
			"extensions": ["c11amz"]
		},
		"application/vnd.coffeescript": { "source": "iana" },
		"application/vnd.collabio.xodocuments.document": { "source": "iana" },
		"application/vnd.collabio.xodocuments.document-template": { "source": "iana" },
		"application/vnd.collabio.xodocuments.presentation": { "source": "iana" },
		"application/vnd.collabio.xodocuments.presentation-template": { "source": "iana" },
		"application/vnd.collabio.xodocuments.spreadsheet": { "source": "iana" },
		"application/vnd.collabio.xodocuments.spreadsheet-template": { "source": "iana" },
		"application/vnd.collection+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.collection.doc+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.collection.next+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.comicbook+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/vnd.comicbook-rar": { "source": "iana" },
		"application/vnd.commerce-battelle": { "source": "iana" },
		"application/vnd.commonspace": {
			"source": "iana",
			"extensions": ["csp"]
		},
		"application/vnd.contact.cmsg": {
			"source": "iana",
			"extensions": ["cdbcmsg"]
		},
		"application/vnd.coreos.ignition+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.cosmocaller": {
			"source": "iana",
			"extensions": ["cmc"]
		},
		"application/vnd.crick.clicker": {
			"source": "iana",
			"extensions": ["clkx"]
		},
		"application/vnd.crick.clicker.keyboard": {
			"source": "iana",
			"extensions": ["clkk"]
		},
		"application/vnd.crick.clicker.palette": {
			"source": "iana",
			"extensions": ["clkp"]
		},
		"application/vnd.crick.clicker.template": {
			"source": "iana",
			"extensions": ["clkt"]
		},
		"application/vnd.crick.clicker.wordbank": {
			"source": "iana",
			"extensions": ["clkw"]
		},
		"application/vnd.criticaltools.wbs+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["wbs"]
		},
		"application/vnd.cryptii.pipe+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.crypto-shade-file": { "source": "iana" },
		"application/vnd.cryptomator.encrypted": { "source": "iana" },
		"application/vnd.cryptomator.vault": { "source": "iana" },
		"application/vnd.ctc-posml": {
			"source": "iana",
			"extensions": ["pml"]
		},
		"application/vnd.ctct.ws+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.cups-pdf": { "source": "iana" },
		"application/vnd.cups-postscript": { "source": "iana" },
		"application/vnd.cups-ppd": {
			"source": "iana",
			"extensions": ["ppd"]
		},
		"application/vnd.cups-raster": { "source": "iana" },
		"application/vnd.cups-raw": { "source": "iana" },
		"application/vnd.curl": { "source": "iana" },
		"application/vnd.curl.car": {
			"source": "apache",
			"extensions": ["car"]
		},
		"application/vnd.curl.pcurl": {
			"source": "apache",
			"extensions": ["pcurl"]
		},
		"application/vnd.cyan.dean.root+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.cybank": { "source": "iana" },
		"application/vnd.cyclonedx+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.cyclonedx+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.d2l.coursepackage1p0+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/vnd.d3m-dataset": { "source": "iana" },
		"application/vnd.d3m-problem": { "source": "iana" },
		"application/vnd.dart": {
			"source": "iana",
			"compressible": true,
			"extensions": ["dart"]
		},
		"application/vnd.data-vision.rdz": {
			"source": "iana",
			"extensions": ["rdz"]
		},
		"application/vnd.datapackage+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.dataresource+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.dbf": {
			"source": "iana",
			"extensions": ["dbf"]
		},
		"application/vnd.debian.binary-package": { "source": "iana" },
		"application/vnd.dece.data": {
			"source": "iana",
			"extensions": [
				"uvf",
				"uvvf",
				"uvd",
				"uvvd"
			]
		},
		"application/vnd.dece.ttml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["uvt", "uvvt"]
		},
		"application/vnd.dece.unspecified": {
			"source": "iana",
			"extensions": ["uvx", "uvvx"]
		},
		"application/vnd.dece.zip": {
			"source": "iana",
			"extensions": ["uvz", "uvvz"]
		},
		"application/vnd.denovo.fcselayout-link": {
			"source": "iana",
			"extensions": ["fe_launch"]
		},
		"application/vnd.desmume.movie": { "source": "iana" },
		"application/vnd.dir-bi.plate-dl-nosuffix": { "source": "iana" },
		"application/vnd.dm.delegation+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.dna": {
			"source": "iana",
			"extensions": ["dna"]
		},
		"application/vnd.document+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.dolby.mlp": {
			"source": "apache",
			"extensions": ["mlp"]
		},
		"application/vnd.dolby.mobile.1": { "source": "iana" },
		"application/vnd.dolby.mobile.2": { "source": "iana" },
		"application/vnd.doremir.scorecloud-binary-document": { "source": "iana" },
		"application/vnd.dpgraph": {
			"source": "iana",
			"extensions": ["dpg"]
		},
		"application/vnd.dreamfactory": {
			"source": "iana",
			"extensions": ["dfac"]
		},
		"application/vnd.drive+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.ds-keypoint": {
			"source": "apache",
			"extensions": ["kpxx"]
		},
		"application/vnd.dtg.local": { "source": "iana" },
		"application/vnd.dtg.local.flash": { "source": "iana" },
		"application/vnd.dtg.local.html": { "source": "iana" },
		"application/vnd.dvb.ait": {
			"source": "iana",
			"extensions": ["ait"]
		},
		"application/vnd.dvb.dvbisl+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.dvb.dvbj": { "source": "iana" },
		"application/vnd.dvb.esgcontainer": { "source": "iana" },
		"application/vnd.dvb.ipdcdftnotifaccess": { "source": "iana" },
		"application/vnd.dvb.ipdcesgaccess": { "source": "iana" },
		"application/vnd.dvb.ipdcesgaccess2": { "source": "iana" },
		"application/vnd.dvb.ipdcesgpdd": { "source": "iana" },
		"application/vnd.dvb.ipdcroaming": { "source": "iana" },
		"application/vnd.dvb.iptv.alfec-base": { "source": "iana" },
		"application/vnd.dvb.iptv.alfec-enhancement": { "source": "iana" },
		"application/vnd.dvb.notif-aggregate-root+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.dvb.notif-container+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.dvb.notif-generic+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.dvb.notif-ia-msglist+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.dvb.notif-ia-registration-request+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.dvb.notif-ia-registration-response+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.dvb.notif-init+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.dvb.pfr": { "source": "iana" },
		"application/vnd.dvb.service": {
			"source": "iana",
			"extensions": ["svc"]
		},
		"application/vnd.dxr": { "source": "iana" },
		"application/vnd.dynageo": {
			"source": "iana",
			"extensions": ["geo"]
		},
		"application/vnd.dzr": { "source": "iana" },
		"application/vnd.easykaraoke.cdgdownload": { "source": "iana" },
		"application/vnd.ecdis-update": { "source": "iana" },
		"application/vnd.ecip.rlp": { "source": "iana" },
		"application/vnd.eclipse.ditto+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.ecowin.chart": {
			"source": "iana",
			"extensions": ["mag"]
		},
		"application/vnd.ecowin.filerequest": { "source": "iana" },
		"application/vnd.ecowin.fileupdate": { "source": "iana" },
		"application/vnd.ecowin.series": { "source": "iana" },
		"application/vnd.ecowin.seriesrequest": { "source": "iana" },
		"application/vnd.ecowin.seriesupdate": { "source": "iana" },
		"application/vnd.efi.img": { "source": "iana" },
		"application/vnd.efi.iso": { "source": "iana" },
		"application/vnd.emclient.accessrequest+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.enliven": {
			"source": "iana",
			"extensions": ["nml"]
		},
		"application/vnd.enphase.envoy": { "source": "iana" },
		"application/vnd.eprints.data+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.epson.esf": {
			"source": "iana",
			"extensions": ["esf"]
		},
		"application/vnd.epson.msf": {
			"source": "iana",
			"extensions": ["msf"]
		},
		"application/vnd.epson.quickanime": {
			"source": "iana",
			"extensions": ["qam"]
		},
		"application/vnd.epson.salt": {
			"source": "iana",
			"extensions": ["slt"]
		},
		"application/vnd.epson.ssf": {
			"source": "iana",
			"extensions": ["ssf"]
		},
		"application/vnd.ericsson.quickcall": { "source": "iana" },
		"application/vnd.espass-espass+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/vnd.eszigno3+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["es3", "et3"]
		},
		"application/vnd.etsi.aoc+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.asic-e+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/vnd.etsi.asic-s+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/vnd.etsi.cug+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.iptvcommand+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.iptvdiscovery+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.iptvprofile+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.iptvsad-bc+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.iptvsad-cod+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.iptvsad-npvr+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.iptvservice+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.iptvsync+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.iptvueprofile+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.mcid+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.mheg5": { "source": "iana" },
		"application/vnd.etsi.overload-control-policy-dataset+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.pstn+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.sci+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.simservs+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.timestamp-token": { "source": "iana" },
		"application/vnd.etsi.tsl+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.etsi.tsl.der": { "source": "iana" },
		"application/vnd.eu.kasparian.car+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.eudora.data": { "source": "iana" },
		"application/vnd.evolv.ecig.profile": { "source": "iana" },
		"application/vnd.evolv.ecig.settings": { "source": "iana" },
		"application/vnd.evolv.ecig.theme": { "source": "iana" },
		"application/vnd.exstream-empower+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/vnd.exstream-package": { "source": "iana" },
		"application/vnd.ezpix-album": {
			"source": "iana",
			"extensions": ["ez2"]
		},
		"application/vnd.ezpix-package": {
			"source": "iana",
			"extensions": ["ez3"]
		},
		"application/vnd.f-secure.mobile": { "source": "iana" },
		"application/vnd.familysearch.gedcom+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/vnd.fastcopy-disk-image": { "source": "iana" },
		"application/vnd.fdf": {
			"source": "iana",
			"extensions": ["fdf"]
		},
		"application/vnd.fdsn.mseed": {
			"source": "iana",
			"extensions": ["mseed"]
		},
		"application/vnd.fdsn.seed": {
			"source": "iana",
			"extensions": ["seed", "dataless"]
		},
		"application/vnd.ffsns": { "source": "iana" },
		"application/vnd.ficlab.flb+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/vnd.filmit.zfc": { "source": "iana" },
		"application/vnd.fints": { "source": "iana" },
		"application/vnd.firemonkeys.cloudcell": { "source": "iana" },
		"application/vnd.flographit": {
			"source": "iana",
			"extensions": ["gph"]
		},
		"application/vnd.fluxtime.clip": {
			"source": "iana",
			"extensions": ["ftc"]
		},
		"application/vnd.font-fontforge-sfd": { "source": "iana" },
		"application/vnd.framemaker": {
			"source": "iana",
			"extensions": [
				"fm",
				"frame",
				"maker",
				"book"
			]
		},
		"application/vnd.frogans.fnc": {
			"source": "iana",
			"extensions": ["fnc"]
		},
		"application/vnd.frogans.ltf": {
			"source": "iana",
			"extensions": ["ltf"]
		},
		"application/vnd.fsc.weblaunch": {
			"source": "iana",
			"extensions": ["fsc"]
		},
		"application/vnd.fujifilm.fb.docuworks": { "source": "iana" },
		"application/vnd.fujifilm.fb.docuworks.binder": { "source": "iana" },
		"application/vnd.fujifilm.fb.docuworks.container": { "source": "iana" },
		"application/vnd.fujifilm.fb.jfi+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.fujitsu.oasys": {
			"source": "iana",
			"extensions": ["oas"]
		},
		"application/vnd.fujitsu.oasys2": {
			"source": "iana",
			"extensions": ["oa2"]
		},
		"application/vnd.fujitsu.oasys3": {
			"source": "iana",
			"extensions": ["oa3"]
		},
		"application/vnd.fujitsu.oasysgp": {
			"source": "iana",
			"extensions": ["fg5"]
		},
		"application/vnd.fujitsu.oasysprs": {
			"source": "iana",
			"extensions": ["bh2"]
		},
		"application/vnd.fujixerox.art-ex": { "source": "iana" },
		"application/vnd.fujixerox.art4": { "source": "iana" },
		"application/vnd.fujixerox.ddd": {
			"source": "iana",
			"extensions": ["ddd"]
		},
		"application/vnd.fujixerox.docuworks": {
			"source": "iana",
			"extensions": ["xdw"]
		},
		"application/vnd.fujixerox.docuworks.binder": {
			"source": "iana",
			"extensions": ["xbd"]
		},
		"application/vnd.fujixerox.docuworks.container": { "source": "iana" },
		"application/vnd.fujixerox.hbpl": { "source": "iana" },
		"application/vnd.fut-misnet": { "source": "iana" },
		"application/vnd.futoin+cbor": { "source": "iana" },
		"application/vnd.futoin+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.fuzzysheet": {
			"source": "iana",
			"extensions": ["fzs"]
		},
		"application/vnd.genomatix.tuxedo": {
			"source": "iana",
			"extensions": ["txd"]
		},
		"application/vnd.gentics.grd+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.geo+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.geocube+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.geogebra.file": {
			"source": "iana",
			"extensions": ["ggb"]
		},
		"application/vnd.geogebra.slides": { "source": "iana" },
		"application/vnd.geogebra.tool": {
			"source": "iana",
			"extensions": ["ggt"]
		},
		"application/vnd.geometry-explorer": {
			"source": "iana",
			"extensions": ["gex", "gre"]
		},
		"application/vnd.geonext": {
			"source": "iana",
			"extensions": ["gxt"]
		},
		"application/vnd.geoplan": {
			"source": "iana",
			"extensions": ["g2w"]
		},
		"application/vnd.geospace": {
			"source": "iana",
			"extensions": ["g3w"]
		},
		"application/vnd.gerber": { "source": "iana" },
		"application/vnd.globalplatform.card-content-mgt": { "source": "iana" },
		"application/vnd.globalplatform.card-content-mgt-response": { "source": "iana" },
		"application/vnd.gmx": {
			"source": "iana",
			"extensions": ["gmx"]
		},
		"application/vnd.google-apps.document": {
			"compressible": false,
			"extensions": ["gdoc"]
		},
		"application/vnd.google-apps.presentation": {
			"compressible": false,
			"extensions": ["gslides"]
		},
		"application/vnd.google-apps.spreadsheet": {
			"compressible": false,
			"extensions": ["gsheet"]
		},
		"application/vnd.google-earth.kml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["kml"]
		},
		"application/vnd.google-earth.kmz": {
			"source": "iana",
			"compressible": false,
			"extensions": ["kmz"]
		},
		"application/vnd.gov.sk.e-form+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.gov.sk.e-form+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/vnd.gov.sk.xmldatacontainer+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.grafeq": {
			"source": "iana",
			"extensions": ["gqf", "gqs"]
		},
		"application/vnd.gridmp": { "source": "iana" },
		"application/vnd.groove-account": {
			"source": "iana",
			"extensions": ["gac"]
		},
		"application/vnd.groove-help": {
			"source": "iana",
			"extensions": ["ghf"]
		},
		"application/vnd.groove-identity-message": {
			"source": "iana",
			"extensions": ["gim"]
		},
		"application/vnd.groove-injector": {
			"source": "iana",
			"extensions": ["grv"]
		},
		"application/vnd.groove-tool-message": {
			"source": "iana",
			"extensions": ["gtm"]
		},
		"application/vnd.groove-tool-template": {
			"source": "iana",
			"extensions": ["tpl"]
		},
		"application/vnd.groove-vcard": {
			"source": "iana",
			"extensions": ["vcg"]
		},
		"application/vnd.hal+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.hal+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["hal"]
		},
		"application/vnd.handheld-entertainment+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["zmm"]
		},
		"application/vnd.hbci": {
			"source": "iana",
			"extensions": ["hbci"]
		},
		"application/vnd.hc+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.hcl-bireports": { "source": "iana" },
		"application/vnd.hdt": { "source": "iana" },
		"application/vnd.heroku+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.hhe.lesson-player": {
			"source": "iana",
			"extensions": ["les"]
		},
		"application/vnd.hl7cda+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/vnd.hl7v2+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/vnd.hp-hpgl": {
			"source": "iana",
			"extensions": ["hpgl"]
		},
		"application/vnd.hp-hpid": {
			"source": "iana",
			"extensions": ["hpid"]
		},
		"application/vnd.hp-hps": {
			"source": "iana",
			"extensions": ["hps"]
		},
		"application/vnd.hp-jlyt": {
			"source": "iana",
			"extensions": ["jlt"]
		},
		"application/vnd.hp-pcl": {
			"source": "iana",
			"extensions": ["pcl"]
		},
		"application/vnd.hp-pclxl": {
			"source": "iana",
			"extensions": ["pclxl"]
		},
		"application/vnd.httphone": { "source": "iana" },
		"application/vnd.hydrostatix.sof-data": {
			"source": "iana",
			"extensions": ["sfd-hdstx"]
		},
		"application/vnd.hyper+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.hyper-item+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.hyperdrive+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.hzn-3d-crossword": { "source": "iana" },
		"application/vnd.ibm.afplinedata": { "source": "iana" },
		"application/vnd.ibm.electronic-media": { "source": "iana" },
		"application/vnd.ibm.minipay": {
			"source": "iana",
			"extensions": ["mpy"]
		},
		"application/vnd.ibm.modcap": {
			"source": "iana",
			"extensions": [
				"afp",
				"listafp",
				"list3820"
			]
		},
		"application/vnd.ibm.rights-management": {
			"source": "iana",
			"extensions": ["irm"]
		},
		"application/vnd.ibm.secure-container": {
			"source": "iana",
			"extensions": ["sc"]
		},
		"application/vnd.iccprofile": {
			"source": "iana",
			"extensions": ["icc", "icm"]
		},
		"application/vnd.ieee.1905": { "source": "iana" },
		"application/vnd.igloader": {
			"source": "iana",
			"extensions": ["igl"]
		},
		"application/vnd.imagemeter.folder+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/vnd.imagemeter.image+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/vnd.immervision-ivp": {
			"source": "iana",
			"extensions": ["ivp"]
		},
		"application/vnd.immervision-ivu": {
			"source": "iana",
			"extensions": ["ivu"]
		},
		"application/vnd.ims.imsccv1p1": { "source": "iana" },
		"application/vnd.ims.imsccv1p2": { "source": "iana" },
		"application/vnd.ims.imsccv1p3": { "source": "iana" },
		"application/vnd.ims.lis.v2.result+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.ims.lti.v2.toolconsumerprofile+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.ims.lti.v2.toolproxy+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.ims.lti.v2.toolproxy.id+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.ims.lti.v2.toolsettings+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.ims.lti.v2.toolsettings.simple+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.informedcontrol.rms+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.informix-visionary": { "source": "iana" },
		"application/vnd.infotech.project": { "source": "iana" },
		"application/vnd.infotech.project+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.innopath.wamp.notification": { "source": "iana" },
		"application/vnd.insors.igm": {
			"source": "iana",
			"extensions": ["igm"]
		},
		"application/vnd.intercon.formnet": {
			"source": "iana",
			"extensions": ["xpw", "xpx"]
		},
		"application/vnd.intergeo": {
			"source": "iana",
			"extensions": ["i2g"]
		},
		"application/vnd.intertrust.digibox": { "source": "iana" },
		"application/vnd.intertrust.nncp": { "source": "iana" },
		"application/vnd.intu.qbo": {
			"source": "iana",
			"extensions": ["qbo"]
		},
		"application/vnd.intu.qfx": {
			"source": "iana",
			"extensions": ["qfx"]
		},
		"application/vnd.iptc.g2.catalogitem+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.iptc.g2.conceptitem+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.iptc.g2.knowledgeitem+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.iptc.g2.newsitem+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.iptc.g2.newsmessage+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.iptc.g2.packageitem+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.iptc.g2.planningitem+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.ipunplugged.rcprofile": {
			"source": "iana",
			"extensions": ["rcprofile"]
		},
		"application/vnd.irepository.package+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["irp"]
		},
		"application/vnd.is-xpr": {
			"source": "iana",
			"extensions": ["xpr"]
		},
		"application/vnd.isac.fcs": {
			"source": "iana",
			"extensions": ["fcs"]
		},
		"application/vnd.iso11783-10+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/vnd.jam": {
			"source": "iana",
			"extensions": ["jam"]
		},
		"application/vnd.japannet-directory-service": { "source": "iana" },
		"application/vnd.japannet-jpnstore-wakeup": { "source": "iana" },
		"application/vnd.japannet-payment-wakeup": { "source": "iana" },
		"application/vnd.japannet-registration": { "source": "iana" },
		"application/vnd.japannet-registration-wakeup": { "source": "iana" },
		"application/vnd.japannet-setstore-wakeup": { "source": "iana" },
		"application/vnd.japannet-verification": { "source": "iana" },
		"application/vnd.japannet-verification-wakeup": { "source": "iana" },
		"application/vnd.jcp.javame.midlet-rms": {
			"source": "iana",
			"extensions": ["rms"]
		},
		"application/vnd.jisp": {
			"source": "iana",
			"extensions": ["jisp"]
		},
		"application/vnd.joost.joda-archive": {
			"source": "iana",
			"extensions": ["joda"]
		},
		"application/vnd.jsk.isdn-ngn": { "source": "iana" },
		"application/vnd.kahootz": {
			"source": "iana",
			"extensions": ["ktz", "ktr"]
		},
		"application/vnd.kde.karbon": {
			"source": "iana",
			"extensions": ["karbon"]
		},
		"application/vnd.kde.kchart": {
			"source": "iana",
			"extensions": ["chrt"]
		},
		"application/vnd.kde.kformula": {
			"source": "iana",
			"extensions": ["kfo"]
		},
		"application/vnd.kde.kivio": {
			"source": "iana",
			"extensions": ["flw"]
		},
		"application/vnd.kde.kontour": {
			"source": "iana",
			"extensions": ["kon"]
		},
		"application/vnd.kde.kpresenter": {
			"source": "iana",
			"extensions": ["kpr", "kpt"]
		},
		"application/vnd.kde.kspread": {
			"source": "iana",
			"extensions": ["ksp"]
		},
		"application/vnd.kde.kword": {
			"source": "iana",
			"extensions": ["kwd", "kwt"]
		},
		"application/vnd.kenameaapp": {
			"source": "iana",
			"extensions": ["htke"]
		},
		"application/vnd.kidspiration": {
			"source": "iana",
			"extensions": ["kia"]
		},
		"application/vnd.kinar": {
			"source": "iana",
			"extensions": ["kne", "knp"]
		},
		"application/vnd.koan": {
			"source": "iana",
			"extensions": [
				"skp",
				"skd",
				"skt",
				"skm"
			]
		},
		"application/vnd.kodak-descriptor": {
			"source": "iana",
			"extensions": ["sse"]
		},
		"application/vnd.las": { "source": "iana" },
		"application/vnd.las.las+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.las.las+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["lasxml"]
		},
		"application/vnd.laszip": { "source": "iana" },
		"application/vnd.leap+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.liberty-request+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.llamagraphics.life-balance.desktop": {
			"source": "iana",
			"extensions": ["lbd"]
		},
		"application/vnd.llamagraphics.life-balance.exchange+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["lbe"]
		},
		"application/vnd.logipipe.circuit+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/vnd.loom": { "source": "iana" },
		"application/vnd.lotus-1-2-3": {
			"source": "iana",
			"extensions": ["123"]
		},
		"application/vnd.lotus-approach": {
			"source": "iana",
			"extensions": ["apr"]
		},
		"application/vnd.lotus-freelance": {
			"source": "iana",
			"extensions": ["pre"]
		},
		"application/vnd.lotus-notes": {
			"source": "iana",
			"extensions": ["nsf"]
		},
		"application/vnd.lotus-organizer": {
			"source": "iana",
			"extensions": ["org"]
		},
		"application/vnd.lotus-screencam": {
			"source": "iana",
			"extensions": ["scm"]
		},
		"application/vnd.lotus-wordpro": {
			"source": "iana",
			"extensions": ["lwp"]
		},
		"application/vnd.macports.portpkg": {
			"source": "iana",
			"extensions": ["portpkg"]
		},
		"application/vnd.mapbox-vector-tile": {
			"source": "iana",
			"extensions": ["mvt"]
		},
		"application/vnd.marlin.drm.actiontoken+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.marlin.drm.conftoken+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.marlin.drm.license+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.marlin.drm.mdcf": { "source": "iana" },
		"application/vnd.mason+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.maxar.archive.3tz+zip": {
			"source": "iana",
			"compressible": false
		},
		"application/vnd.maxmind.maxmind-db": { "source": "iana" },
		"application/vnd.mcd": {
			"source": "iana",
			"extensions": ["mcd"]
		},
		"application/vnd.medcalcdata": {
			"source": "iana",
			"extensions": ["mc1"]
		},
		"application/vnd.mediastation.cdkey": {
			"source": "iana",
			"extensions": ["cdkey"]
		},
		"application/vnd.meridian-slingshot": { "source": "iana" },
		"application/vnd.mfer": {
			"source": "iana",
			"extensions": ["mwf"]
		},
		"application/vnd.mfmp": {
			"source": "iana",
			"extensions": ["mfm"]
		},
		"application/vnd.micro+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.micrografx.flo": {
			"source": "iana",
			"extensions": ["flo"]
		},
		"application/vnd.micrografx.igx": {
			"source": "iana",
			"extensions": ["igx"]
		},
		"application/vnd.microsoft.portable-executable": { "source": "iana" },
		"application/vnd.microsoft.windows.thumbnail-cache": { "source": "iana" },
		"application/vnd.miele+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.mif": {
			"source": "iana",
			"extensions": ["mif"]
		},
		"application/vnd.minisoft-hp3000-save": { "source": "iana" },
		"application/vnd.mitsubishi.misty-guard.trustweb": { "source": "iana" },
		"application/vnd.mobius.daf": {
			"source": "iana",
			"extensions": ["daf"]
		},
		"application/vnd.mobius.dis": {
			"source": "iana",
			"extensions": ["dis"]
		},
		"application/vnd.mobius.mbk": {
			"source": "iana",
			"extensions": ["mbk"]
		},
		"application/vnd.mobius.mqy": {
			"source": "iana",
			"extensions": ["mqy"]
		},
		"application/vnd.mobius.msl": {
			"source": "iana",
			"extensions": ["msl"]
		},
		"application/vnd.mobius.plc": {
			"source": "iana",
			"extensions": ["plc"]
		},
		"application/vnd.mobius.txf": {
			"source": "iana",
			"extensions": ["txf"]
		},
		"application/vnd.mophun.application": {
			"source": "iana",
			"extensions": ["mpn"]
		},
		"application/vnd.mophun.certificate": {
			"source": "iana",
			"extensions": ["mpc"]
		},
		"application/vnd.motorola.flexsuite": { "source": "iana" },
		"application/vnd.motorola.flexsuite.adsi": { "source": "iana" },
		"application/vnd.motorola.flexsuite.fis": { "source": "iana" },
		"application/vnd.motorola.flexsuite.gotap": { "source": "iana" },
		"application/vnd.motorola.flexsuite.kmr": { "source": "iana" },
		"application/vnd.motorola.flexsuite.ttc": { "source": "iana" },
		"application/vnd.motorola.flexsuite.wem": { "source": "iana" },
		"application/vnd.motorola.iprm": { "source": "iana" },
		"application/vnd.mozilla.xul+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xul"]
		},
		"application/vnd.ms-3mfdocument": { "source": "iana" },
		"application/vnd.ms-artgalry": {
			"source": "iana",
			"extensions": ["cil"]
		},
		"application/vnd.ms-asf": { "source": "iana" },
		"application/vnd.ms-cab-compressed": {
			"source": "iana",
			"extensions": ["cab"]
		},
		"application/vnd.ms-color.iccprofile": { "source": "apache" },
		"application/vnd.ms-excel": {
			"source": "iana",
			"compressible": false,
			"extensions": [
				"xls",
				"xlm",
				"xla",
				"xlc",
				"xlt",
				"xlw"
			]
		},
		"application/vnd.ms-excel.addin.macroenabled.12": {
			"source": "iana",
			"extensions": ["xlam"]
		},
		"application/vnd.ms-excel.sheet.binary.macroenabled.12": {
			"source": "iana",
			"extensions": ["xlsb"]
		},
		"application/vnd.ms-excel.sheet.macroenabled.12": {
			"source": "iana",
			"extensions": ["xlsm"]
		},
		"application/vnd.ms-excel.template.macroenabled.12": {
			"source": "iana",
			"extensions": ["xltm"]
		},
		"application/vnd.ms-fontobject": {
			"source": "iana",
			"compressible": true,
			"extensions": ["eot"]
		},
		"application/vnd.ms-htmlhelp": {
			"source": "iana",
			"extensions": ["chm"]
		},
		"application/vnd.ms-ims": {
			"source": "iana",
			"extensions": ["ims"]
		},
		"application/vnd.ms-lrm": {
			"source": "iana",
			"extensions": ["lrm"]
		},
		"application/vnd.ms-office.activex+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.ms-officetheme": {
			"source": "iana",
			"extensions": ["thmx"]
		},
		"application/vnd.ms-opentype": {
			"source": "apache",
			"compressible": true
		},
		"application/vnd.ms-outlook": {
			"compressible": false,
			"extensions": ["msg"]
		},
		"application/vnd.ms-package.obfuscated-opentype": { "source": "apache" },
		"application/vnd.ms-pki.seccat": {
			"source": "apache",
			"extensions": ["cat"]
		},
		"application/vnd.ms-pki.stl": {
			"source": "apache",
			"extensions": ["stl"]
		},
		"application/vnd.ms-playready.initiator+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.ms-powerpoint": {
			"source": "iana",
			"compressible": false,
			"extensions": [
				"ppt",
				"pps",
				"pot"
			]
		},
		"application/vnd.ms-powerpoint.addin.macroenabled.12": {
			"source": "iana",
			"extensions": ["ppam"]
		},
		"application/vnd.ms-powerpoint.presentation.macroenabled.12": {
			"source": "iana",
			"extensions": ["pptm"]
		},
		"application/vnd.ms-powerpoint.slide.macroenabled.12": {
			"source": "iana",
			"extensions": ["sldm"]
		},
		"application/vnd.ms-powerpoint.slideshow.macroenabled.12": {
			"source": "iana",
			"extensions": ["ppsm"]
		},
		"application/vnd.ms-powerpoint.template.macroenabled.12": {
			"source": "iana",
			"extensions": ["potm"]
		},
		"application/vnd.ms-printdevicecapabilities+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.ms-printing.printticket+xml": {
			"source": "apache",
			"compressible": true
		},
		"application/vnd.ms-printschematicket+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.ms-project": {
			"source": "iana",
			"extensions": ["mpp", "mpt"]
		},
		"application/vnd.ms-tnef": { "source": "iana" },
		"application/vnd.ms-windows.devicepairing": { "source": "iana" },
		"application/vnd.ms-windows.nwprinting.oob": { "source": "iana" },
		"application/vnd.ms-windows.printerpairing": { "source": "iana" },
		"application/vnd.ms-windows.wsd.oob": { "source": "iana" },
		"application/vnd.ms-wmdrm.lic-chlg-req": { "source": "iana" },
		"application/vnd.ms-wmdrm.lic-resp": { "source": "iana" },
		"application/vnd.ms-wmdrm.meter-chlg-req": { "source": "iana" },
		"application/vnd.ms-wmdrm.meter-resp": { "source": "iana" },
		"application/vnd.ms-word.document.macroenabled.12": {
			"source": "iana",
			"extensions": ["docm"]
		},
		"application/vnd.ms-word.template.macroenabled.12": {
			"source": "iana",
			"extensions": ["dotm"]
		},
		"application/vnd.ms-works": {
			"source": "iana",
			"extensions": [
				"wps",
				"wks",
				"wcm",
				"wdb"
			]
		},
		"application/vnd.ms-wpl": {
			"source": "iana",
			"extensions": ["wpl"]
		},
		"application/vnd.ms-xpsdocument": {
			"source": "iana",
			"compressible": false,
			"extensions": ["xps"]
		},
		"application/vnd.msa-disk-image": { "source": "iana" },
		"application/vnd.mseq": {
			"source": "iana",
			"extensions": ["mseq"]
		},
		"application/vnd.msign": { "source": "iana" },
		"application/vnd.multiad.creator": { "source": "iana" },
		"application/vnd.multiad.creator.cif": { "source": "iana" },
		"application/vnd.music-niff": { "source": "iana" },
		"application/vnd.musician": {
			"source": "iana",
			"extensions": ["mus"]
		},
		"application/vnd.muvee.style": {
			"source": "iana",
			"extensions": ["msty"]
		},
		"application/vnd.mynfc": {
			"source": "iana",
			"extensions": ["taglet"]
		},
		"application/vnd.nacamar.ybrid+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.ncd.control": { "source": "iana" },
		"application/vnd.ncd.reference": { "source": "iana" },
		"application/vnd.nearst.inv+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.nebumind.line": { "source": "iana" },
		"application/vnd.nervana": { "source": "iana" },
		"application/vnd.netfpx": { "source": "iana" },
		"application/vnd.neurolanguage.nlu": {
			"source": "iana",
			"extensions": ["nlu"]
		},
		"application/vnd.nimn": { "source": "iana" },
		"application/vnd.nintendo.nitro.rom": { "source": "iana" },
		"application/vnd.nintendo.snes.rom": { "source": "iana" },
		"application/vnd.nitf": {
			"source": "iana",
			"extensions": ["ntf", "nitf"]
		},
		"application/vnd.noblenet-directory": {
			"source": "iana",
			"extensions": ["nnd"]
		},
		"application/vnd.noblenet-sealer": {
			"source": "iana",
			"extensions": ["nns"]
		},
		"application/vnd.noblenet-web": {
			"source": "iana",
			"extensions": ["nnw"]
		},
		"application/vnd.nokia.catalogs": { "source": "iana" },
		"application/vnd.nokia.conml+wbxml": { "source": "iana" },
		"application/vnd.nokia.conml+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.nokia.iptv.config+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.nokia.isds-radio-presets": { "source": "iana" },
		"application/vnd.nokia.landmark+wbxml": { "source": "iana" },
		"application/vnd.nokia.landmark+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.nokia.landmarkcollection+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.nokia.n-gage.ac+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["ac"]
		},
		"application/vnd.nokia.n-gage.data": {
			"source": "iana",
			"extensions": ["ngdat"]
		},
		"application/vnd.nokia.n-gage.symbian.install": {
			"source": "iana",
			"extensions": ["n-gage"]
		},
		"application/vnd.nokia.ncd": { "source": "iana" },
		"application/vnd.nokia.pcd+wbxml": { "source": "iana" },
		"application/vnd.nokia.pcd+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.nokia.radio-preset": {
			"source": "iana",
			"extensions": ["rpst"]
		},
		"application/vnd.nokia.radio-presets": {
			"source": "iana",
			"extensions": ["rpss"]
		},
		"application/vnd.novadigm.edm": {
			"source": "iana",
			"extensions": ["edm"]
		},
		"application/vnd.novadigm.edx": {
			"source": "iana",
			"extensions": ["edx"]
		},
		"application/vnd.novadigm.ext": {
			"source": "iana",
			"extensions": ["ext"]
		},
		"application/vnd.ntt-local.content-share": { "source": "iana" },
		"application/vnd.ntt-local.file-transfer": { "source": "iana" },
		"application/vnd.ntt-local.ogw_remote-access": { "source": "iana" },
		"application/vnd.ntt-local.sip-ta_remote": { "source": "iana" },
		"application/vnd.ntt-local.sip-ta_tcp_stream": { "source": "iana" },
		"application/vnd.oasis.opendocument.chart": {
			"source": "iana",
			"extensions": ["odc"]
		},
		"application/vnd.oasis.opendocument.chart-template": {
			"source": "iana",
			"extensions": ["otc"]
		},
		"application/vnd.oasis.opendocument.database": {
			"source": "iana",
			"extensions": ["odb"]
		},
		"application/vnd.oasis.opendocument.formula": {
			"source": "iana",
			"extensions": ["odf"]
		},
		"application/vnd.oasis.opendocument.formula-template": {
			"source": "iana",
			"extensions": ["odft"]
		},
		"application/vnd.oasis.opendocument.graphics": {
			"source": "iana",
			"compressible": false,
			"extensions": ["odg"]
		},
		"application/vnd.oasis.opendocument.graphics-template": {
			"source": "iana",
			"extensions": ["otg"]
		},
		"application/vnd.oasis.opendocument.image": {
			"source": "iana",
			"extensions": ["odi"]
		},
		"application/vnd.oasis.opendocument.image-template": {
			"source": "iana",
			"extensions": ["oti"]
		},
		"application/vnd.oasis.opendocument.presentation": {
			"source": "iana",
			"compressible": false,
			"extensions": ["odp"]
		},
		"application/vnd.oasis.opendocument.presentation-template": {
			"source": "iana",
			"extensions": ["otp"]
		},
		"application/vnd.oasis.opendocument.spreadsheet": {
			"source": "iana",
			"compressible": false,
			"extensions": ["ods"]
		},
		"application/vnd.oasis.opendocument.spreadsheet-template": {
			"source": "iana",
			"extensions": ["ots"]
		},
		"application/vnd.oasis.opendocument.text": {
			"source": "iana",
			"compressible": false,
			"extensions": ["odt"]
		},
		"application/vnd.oasis.opendocument.text-master": {
			"source": "iana",
			"extensions": ["odm"]
		},
		"application/vnd.oasis.opendocument.text-template": {
			"source": "iana",
			"extensions": ["ott"]
		},
		"application/vnd.oasis.opendocument.text-web": {
			"source": "iana",
			"extensions": ["oth"]
		},
		"application/vnd.obn": { "source": "iana" },
		"application/vnd.ocf+cbor": { "source": "iana" },
		"application/vnd.oci.image.manifest.v1+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oftn.l10n+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oipf.contentaccessdownload+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oipf.contentaccessstreaming+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oipf.cspg-hexbinary": { "source": "iana" },
		"application/vnd.oipf.dae.svg+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oipf.dae.xhtml+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oipf.mippvcontrolmessage+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oipf.pae.gem": { "source": "iana" },
		"application/vnd.oipf.spdiscovery+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oipf.spdlist+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oipf.ueprofile+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oipf.userprofile+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.olpc-sugar": {
			"source": "iana",
			"extensions": ["xo"]
		},
		"application/vnd.oma-scws-config": { "source": "iana" },
		"application/vnd.oma-scws-http-request": { "source": "iana" },
		"application/vnd.oma-scws-http-response": { "source": "iana" },
		"application/vnd.oma.bcast.associated-procedure-parameter+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.bcast.drm-trigger+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.bcast.imd+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.bcast.ltkm": { "source": "iana" },
		"application/vnd.oma.bcast.notification+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.bcast.provisioningtrigger": { "source": "iana" },
		"application/vnd.oma.bcast.sgboot": { "source": "iana" },
		"application/vnd.oma.bcast.sgdd+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.bcast.sgdu": { "source": "iana" },
		"application/vnd.oma.bcast.simple-symbol-container": { "source": "iana" },
		"application/vnd.oma.bcast.smartcard-trigger+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.bcast.sprov+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.bcast.stkm": { "source": "iana" },
		"application/vnd.oma.cab-address-book+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.cab-feature-handler+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.cab-pcc+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.cab-subs-invite+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.cab-user-prefs+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.dcd": { "source": "iana" },
		"application/vnd.oma.dcdc": { "source": "iana" },
		"application/vnd.oma.dd2+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["dd2"]
		},
		"application/vnd.oma.drm.risd+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.group-usage-list+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.lwm2m+cbor": { "source": "iana" },
		"application/vnd.oma.lwm2m+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.lwm2m+tlv": { "source": "iana" },
		"application/vnd.oma.pal+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.poc.detailed-progress-report+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.poc.final-report+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.poc.groups+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.poc.invocation-descriptor+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.poc.optimized-progress-report+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.push": { "source": "iana" },
		"application/vnd.oma.scidm.messages+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oma.xcap-directory+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.omads-email+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/vnd.omads-file+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/vnd.omads-folder+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/vnd.omaloc-supl-init": { "source": "iana" },
		"application/vnd.onepager": { "source": "iana" },
		"application/vnd.onepagertamp": { "source": "iana" },
		"application/vnd.onepagertamx": { "source": "iana" },
		"application/vnd.onepagertat": { "source": "iana" },
		"application/vnd.onepagertatp": { "source": "iana" },
		"application/vnd.onepagertatx": { "source": "iana" },
		"application/vnd.openblox.game+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["obgx"]
		},
		"application/vnd.openblox.game-binary": { "source": "iana" },
		"application/vnd.openeye.oeb": { "source": "iana" },
		"application/vnd.openofficeorg.extension": {
			"source": "apache",
			"extensions": ["oxt"]
		},
		"application/vnd.openstreetmap.data+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["osm"]
		},
		"application/vnd.opentimestamps.ots": { "source": "iana" },
		"application/vnd.openxmlformats-officedocument.custom-properties+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.customxmlproperties+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.drawing+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.drawingml.chart+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.drawingml.chartshapes+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.drawingml.diagramcolors+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.drawingml.diagramdata+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.drawingml.diagramlayout+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.drawingml.diagramstyle+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.extended-properties+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.commentauthors+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.comments+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.handoutmaster+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.notesmaster+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.notesslide+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.presentation": {
			"source": "iana",
			"compressible": false,
			"extensions": ["pptx"]
		},
		"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.presprops+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.slide": {
			"source": "iana",
			"extensions": ["sldx"]
		},
		"application/vnd.openxmlformats-officedocument.presentationml.slide+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.slidelayout+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.slidemaster+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.slideshow": {
			"source": "iana",
			"extensions": ["ppsx"]
		},
		"application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.slideupdateinfo+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.tablestyles+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.tags+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.template": {
			"source": "iana",
			"extensions": ["potx"]
		},
		"application/vnd.openxmlformats-officedocument.presentationml.template.main+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.presentationml.viewprops+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.calcchain+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.dialogsheet+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.externallink+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.pivotcachedefinition+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.pivotcacherecords+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.pivottable+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.querytable+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.revisionheaders+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.revisionlog+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedstrings+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
			"source": "iana",
			"compressible": false,
			"extensions": ["xlsx"]
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheetmetadata+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.tablesinglecells+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.template": {
			"source": "iana",
			"extensions": ["xltx"]
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.usernames+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.volatiledependencies+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.theme+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.themeoverride+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.vmldrawing": { "source": "iana" },
		"application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
			"source": "iana",
			"compressible": false,
			"extensions": ["docx"]
		},
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.wordprocessingml.fonttable+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.wordprocessingml.template": {
			"source": "iana",
			"extensions": ["dotx"]
		},
		"application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-officedocument.wordprocessingml.websettings+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-package.core-properties+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.openxmlformats-package.relationships+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oracle.resource+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.orange.indata": { "source": "iana" },
		"application/vnd.osa.netdeploy": { "source": "iana" },
		"application/vnd.osgeo.mapguide.package": {
			"source": "iana",
			"extensions": ["mgp"]
		},
		"application/vnd.osgi.bundle": { "source": "iana" },
		"application/vnd.osgi.dp": {
			"source": "iana",
			"extensions": ["dp"]
		},
		"application/vnd.osgi.subsystem": {
			"source": "iana",
			"extensions": ["esa"]
		},
		"application/vnd.otps.ct-kip+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.oxli.countgraph": { "source": "iana" },
		"application/vnd.pagerduty+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.palm": {
			"source": "iana",
			"extensions": [
				"pdb",
				"pqa",
				"oprc"
			]
		},
		"application/vnd.panoply": { "source": "iana" },
		"application/vnd.paos.xml": { "source": "iana" },
		"application/vnd.patentdive": { "source": "iana" },
		"application/vnd.patientecommsdoc": { "source": "iana" },
		"application/vnd.pawaafile": {
			"source": "iana",
			"extensions": ["paw"]
		},
		"application/vnd.pcos": { "source": "iana" },
		"application/vnd.pg.format": {
			"source": "iana",
			"extensions": ["str"]
		},
		"application/vnd.pg.osasli": {
			"source": "iana",
			"extensions": ["ei6"]
		},
		"application/vnd.piaccess.application-licence": { "source": "iana" },
		"application/vnd.picsel": {
			"source": "iana",
			"extensions": ["efif"]
		},
		"application/vnd.pmi.widget": {
			"source": "iana",
			"extensions": ["wg"]
		},
		"application/vnd.poc.group-advertisement+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.pocketlearn": {
			"source": "iana",
			"extensions": ["plf"]
		},
		"application/vnd.powerbuilder6": {
			"source": "iana",
			"extensions": ["pbd"]
		},
		"application/vnd.powerbuilder6-s": { "source": "iana" },
		"application/vnd.powerbuilder7": { "source": "iana" },
		"application/vnd.powerbuilder7-s": { "source": "iana" },
		"application/vnd.powerbuilder75": { "source": "iana" },
		"application/vnd.powerbuilder75-s": { "source": "iana" },
		"application/vnd.preminet": { "source": "iana" },
		"application/vnd.previewsystems.box": {
			"source": "iana",
			"extensions": ["box"]
		},
		"application/vnd.proteus.magazine": {
			"source": "iana",
			"extensions": ["mgz"]
		},
		"application/vnd.psfs": { "source": "iana" },
		"application/vnd.publishare-delta-tree": {
			"source": "iana",
			"extensions": ["qps"]
		},
		"application/vnd.pvi.ptid1": {
			"source": "iana",
			"extensions": ["ptid"]
		},
		"application/vnd.pwg-multiplexed": { "source": "iana" },
		"application/vnd.pwg-xhtml-print+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.qualcomm.brew-app-res": { "source": "iana" },
		"application/vnd.quarantainenet": { "source": "iana" },
		"application/vnd.quark.quarkxpress": {
			"source": "iana",
			"extensions": [
				"qxd",
				"qxt",
				"qwd",
				"qwt",
				"qxl",
				"qxb"
			]
		},
		"application/vnd.quobject-quoxdocument": { "source": "iana" },
		"application/vnd.radisys.moml+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.radisys.msml+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.radisys.msml-audit+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.radisys.msml-audit-conf+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.radisys.msml-audit-conn+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.radisys.msml-audit-dialog+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.radisys.msml-audit-stream+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.radisys.msml-conf+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.radisys.msml-dialog+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.radisys.msml-dialog-base+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.radisys.msml-dialog-fax-detect+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.radisys.msml-dialog-fax-sendrecv+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.radisys.msml-dialog-group+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.radisys.msml-dialog-speech+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.radisys.msml-dialog-transform+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.rainstor.data": { "source": "iana" },
		"application/vnd.rapid": { "source": "iana" },
		"application/vnd.rar": {
			"source": "iana",
			"extensions": ["rar"]
		},
		"application/vnd.realvnc.bed": {
			"source": "iana",
			"extensions": ["bed"]
		},
		"application/vnd.recordare.musicxml": {
			"source": "iana",
			"extensions": ["mxl"]
		},
		"application/vnd.recordare.musicxml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["musicxml"]
		},
		"application/vnd.renlearn.rlprint": { "source": "iana" },
		"application/vnd.resilient.logic": { "source": "iana" },
		"application/vnd.restful+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.rig.cryptonote": {
			"source": "iana",
			"extensions": ["cryptonote"]
		},
		"application/vnd.rim.cod": {
			"source": "apache",
			"extensions": ["cod"]
		},
		"application/vnd.rn-realmedia": {
			"source": "apache",
			"extensions": ["rm"]
		},
		"application/vnd.rn-realmedia-vbr": {
			"source": "apache",
			"extensions": ["rmvb"]
		},
		"application/vnd.route66.link66+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["link66"]
		},
		"application/vnd.rs-274x": { "source": "iana" },
		"application/vnd.ruckus.download": { "source": "iana" },
		"application/vnd.s3sms": { "source": "iana" },
		"application/vnd.sailingtracker.track": {
			"source": "iana",
			"extensions": ["st"]
		},
		"application/vnd.sar": { "source": "iana" },
		"application/vnd.sbm.cid": { "source": "iana" },
		"application/vnd.sbm.mid2": { "source": "iana" },
		"application/vnd.scribus": { "source": "iana" },
		"application/vnd.sealed.3df": { "source": "iana" },
		"application/vnd.sealed.csf": { "source": "iana" },
		"application/vnd.sealed.doc": { "source": "iana" },
		"application/vnd.sealed.eml": { "source": "iana" },
		"application/vnd.sealed.mht": { "source": "iana" },
		"application/vnd.sealed.net": { "source": "iana" },
		"application/vnd.sealed.ppt": { "source": "iana" },
		"application/vnd.sealed.tiff": { "source": "iana" },
		"application/vnd.sealed.xls": { "source": "iana" },
		"application/vnd.sealedmedia.softseal.html": { "source": "iana" },
		"application/vnd.sealedmedia.softseal.pdf": { "source": "iana" },
		"application/vnd.seemail": {
			"source": "iana",
			"extensions": ["see"]
		},
		"application/vnd.seis+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.sema": {
			"source": "iana",
			"extensions": ["sema"]
		},
		"application/vnd.semd": {
			"source": "iana",
			"extensions": ["semd"]
		},
		"application/vnd.semf": {
			"source": "iana",
			"extensions": ["semf"]
		},
		"application/vnd.shade-save-file": { "source": "iana" },
		"application/vnd.shana.informed.formdata": {
			"source": "iana",
			"extensions": ["ifm"]
		},
		"application/vnd.shana.informed.formtemplate": {
			"source": "iana",
			"extensions": ["itp"]
		},
		"application/vnd.shana.informed.interchange": {
			"source": "iana",
			"extensions": ["iif"]
		},
		"application/vnd.shana.informed.package": {
			"source": "iana",
			"extensions": ["ipk"]
		},
		"application/vnd.shootproof+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.shopkick+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.shp": { "source": "iana" },
		"application/vnd.shx": { "source": "iana" },
		"application/vnd.sigrok.session": { "source": "iana" },
		"application/vnd.simtech-mindmapper": {
			"source": "iana",
			"extensions": ["twd", "twds"]
		},
		"application/vnd.siren+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.smaf": {
			"source": "iana",
			"extensions": ["mmf"]
		},
		"application/vnd.smart.notebook": { "source": "iana" },
		"application/vnd.smart.teacher": {
			"source": "iana",
			"extensions": ["teacher"]
		},
		"application/vnd.snesdev-page-table": { "source": "iana" },
		"application/vnd.software602.filler.form+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["fo"]
		},
		"application/vnd.software602.filler.form-xml-zip": { "source": "iana" },
		"application/vnd.solent.sdkm+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["sdkm", "sdkd"]
		},
		"application/vnd.spotfire.dxp": {
			"source": "iana",
			"extensions": ["dxp"]
		},
		"application/vnd.spotfire.sfs": {
			"source": "iana",
			"extensions": ["sfs"]
		},
		"application/vnd.sqlite3": { "source": "iana" },
		"application/vnd.sss-cod": { "source": "iana" },
		"application/vnd.sss-dtf": { "source": "iana" },
		"application/vnd.sss-ntf": { "source": "iana" },
		"application/vnd.stardivision.calc": {
			"source": "apache",
			"extensions": ["sdc"]
		},
		"application/vnd.stardivision.draw": {
			"source": "apache",
			"extensions": ["sda"]
		},
		"application/vnd.stardivision.impress": {
			"source": "apache",
			"extensions": ["sdd"]
		},
		"application/vnd.stardivision.math": {
			"source": "apache",
			"extensions": ["smf"]
		},
		"application/vnd.stardivision.writer": {
			"source": "apache",
			"extensions": ["sdw", "vor"]
		},
		"application/vnd.stardivision.writer-global": {
			"source": "apache",
			"extensions": ["sgl"]
		},
		"application/vnd.stepmania.package": {
			"source": "iana",
			"extensions": ["smzip"]
		},
		"application/vnd.stepmania.stepchart": {
			"source": "iana",
			"extensions": ["sm"]
		},
		"application/vnd.street-stream": { "source": "iana" },
		"application/vnd.sun.wadl+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["wadl"]
		},
		"application/vnd.sun.xml.calc": {
			"source": "apache",
			"extensions": ["sxc"]
		},
		"application/vnd.sun.xml.calc.template": {
			"source": "apache",
			"extensions": ["stc"]
		},
		"application/vnd.sun.xml.draw": {
			"source": "apache",
			"extensions": ["sxd"]
		},
		"application/vnd.sun.xml.draw.template": {
			"source": "apache",
			"extensions": ["std"]
		},
		"application/vnd.sun.xml.impress": {
			"source": "apache",
			"extensions": ["sxi"]
		},
		"application/vnd.sun.xml.impress.template": {
			"source": "apache",
			"extensions": ["sti"]
		},
		"application/vnd.sun.xml.math": {
			"source": "apache",
			"extensions": ["sxm"]
		},
		"application/vnd.sun.xml.writer": {
			"source": "apache",
			"extensions": ["sxw"]
		},
		"application/vnd.sun.xml.writer.global": {
			"source": "apache",
			"extensions": ["sxg"]
		},
		"application/vnd.sun.xml.writer.template": {
			"source": "apache",
			"extensions": ["stw"]
		},
		"application/vnd.sus-calendar": {
			"source": "iana",
			"extensions": ["sus", "susp"]
		},
		"application/vnd.svd": {
			"source": "iana",
			"extensions": ["svd"]
		},
		"application/vnd.swiftview-ics": { "source": "iana" },
		"application/vnd.sycle+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.syft+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.symbian.install": {
			"source": "apache",
			"extensions": ["sis", "sisx"]
		},
		"application/vnd.syncml+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true,
			"extensions": ["xsm"]
		},
		"application/vnd.syncml.dm+wbxml": {
			"source": "iana",
			"charset": "UTF-8",
			"extensions": ["bdm"]
		},
		"application/vnd.syncml.dm+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true,
			"extensions": ["xdm"]
		},
		"application/vnd.syncml.dm.notification": { "source": "iana" },
		"application/vnd.syncml.dmddf+wbxml": { "source": "iana" },
		"application/vnd.syncml.dmddf+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true,
			"extensions": ["ddf"]
		},
		"application/vnd.syncml.dmtnds+wbxml": { "source": "iana" },
		"application/vnd.syncml.dmtnds+xml": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true
		},
		"application/vnd.syncml.ds.notification": { "source": "iana" },
		"application/vnd.tableschema+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.tao.intent-module-archive": {
			"source": "iana",
			"extensions": ["tao"]
		},
		"application/vnd.tcpdump.pcap": {
			"source": "iana",
			"extensions": [
				"pcap",
				"cap",
				"dmp"
			]
		},
		"application/vnd.think-cell.ppttc+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.tmd.mediaflex.api+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.tml": { "source": "iana" },
		"application/vnd.tmobile-livetv": {
			"source": "iana",
			"extensions": ["tmo"]
		},
		"application/vnd.tri.onesource": { "source": "iana" },
		"application/vnd.trid.tpt": {
			"source": "iana",
			"extensions": ["tpt"]
		},
		"application/vnd.triscape.mxs": {
			"source": "iana",
			"extensions": ["mxs"]
		},
		"application/vnd.trueapp": {
			"source": "iana",
			"extensions": ["tra"]
		},
		"application/vnd.truedoc": { "source": "iana" },
		"application/vnd.ubisoft.webplayer": { "source": "iana" },
		"application/vnd.ufdl": {
			"source": "iana",
			"extensions": ["ufd", "ufdl"]
		},
		"application/vnd.uiq.theme": {
			"source": "iana",
			"extensions": ["utz"]
		},
		"application/vnd.umajin": {
			"source": "iana",
			"extensions": ["umj"]
		},
		"application/vnd.unity": {
			"source": "iana",
			"extensions": ["unityweb"]
		},
		"application/vnd.uoml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["uoml"]
		},
		"application/vnd.uplanet.alert": { "source": "iana" },
		"application/vnd.uplanet.alert-wbxml": { "source": "iana" },
		"application/vnd.uplanet.bearer-choice": { "source": "iana" },
		"application/vnd.uplanet.bearer-choice-wbxml": { "source": "iana" },
		"application/vnd.uplanet.cacheop": { "source": "iana" },
		"application/vnd.uplanet.cacheop-wbxml": { "source": "iana" },
		"application/vnd.uplanet.channel": { "source": "iana" },
		"application/vnd.uplanet.channel-wbxml": { "source": "iana" },
		"application/vnd.uplanet.list": { "source": "iana" },
		"application/vnd.uplanet.list-wbxml": { "source": "iana" },
		"application/vnd.uplanet.listcmd": { "source": "iana" },
		"application/vnd.uplanet.listcmd-wbxml": { "source": "iana" },
		"application/vnd.uplanet.signal": { "source": "iana" },
		"application/vnd.uri-map": { "source": "iana" },
		"application/vnd.valve.source.material": { "source": "iana" },
		"application/vnd.vcx": {
			"source": "iana",
			"extensions": ["vcx"]
		},
		"application/vnd.vd-study": { "source": "iana" },
		"application/vnd.vectorworks": { "source": "iana" },
		"application/vnd.vel+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.verimatrix.vcas": { "source": "iana" },
		"application/vnd.veritone.aion+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.veryant.thin": { "source": "iana" },
		"application/vnd.ves.encrypted": { "source": "iana" },
		"application/vnd.vidsoft.vidconference": { "source": "iana" },
		"application/vnd.visio": {
			"source": "iana",
			"extensions": [
				"vsd",
				"vst",
				"vss",
				"vsw"
			]
		},
		"application/vnd.visionary": {
			"source": "iana",
			"extensions": ["vis"]
		},
		"application/vnd.vividence.scriptfile": { "source": "iana" },
		"application/vnd.vsf": {
			"source": "iana",
			"extensions": ["vsf"]
		},
		"application/vnd.wap.sic": { "source": "iana" },
		"application/vnd.wap.slc": { "source": "iana" },
		"application/vnd.wap.wbxml": {
			"source": "iana",
			"charset": "UTF-8",
			"extensions": ["wbxml"]
		},
		"application/vnd.wap.wmlc": {
			"source": "iana",
			"extensions": ["wmlc"]
		},
		"application/vnd.wap.wmlscriptc": {
			"source": "iana",
			"extensions": ["wmlsc"]
		},
		"application/vnd.webturbo": {
			"source": "iana",
			"extensions": ["wtb"]
		},
		"application/vnd.wfa.dpp": { "source": "iana" },
		"application/vnd.wfa.p2p": { "source": "iana" },
		"application/vnd.wfa.wsc": { "source": "iana" },
		"application/vnd.windows.devicepairing": { "source": "iana" },
		"application/vnd.wmc": { "source": "iana" },
		"application/vnd.wmf.bootstrap": { "source": "iana" },
		"application/vnd.wolfram.mathematica": { "source": "iana" },
		"application/vnd.wolfram.mathematica.package": { "source": "iana" },
		"application/vnd.wolfram.player": {
			"source": "iana",
			"extensions": ["nbp"]
		},
		"application/vnd.wordperfect": {
			"source": "iana",
			"extensions": ["wpd"]
		},
		"application/vnd.wqd": {
			"source": "iana",
			"extensions": ["wqd"]
		},
		"application/vnd.wrq-hp3000-labelled": { "source": "iana" },
		"application/vnd.wt.stf": {
			"source": "iana",
			"extensions": ["stf"]
		},
		"application/vnd.wv.csp+wbxml": { "source": "iana" },
		"application/vnd.wv.csp+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.wv.ssp+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.xacml+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.xara": {
			"source": "iana",
			"extensions": ["xar"]
		},
		"application/vnd.xfdl": {
			"source": "iana",
			"extensions": ["xfdl"]
		},
		"application/vnd.xfdl.webform": { "source": "iana" },
		"application/vnd.xmi+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/vnd.xmpie.cpkg": { "source": "iana" },
		"application/vnd.xmpie.dpkg": { "source": "iana" },
		"application/vnd.xmpie.plan": { "source": "iana" },
		"application/vnd.xmpie.ppkg": { "source": "iana" },
		"application/vnd.xmpie.xlim": { "source": "iana" },
		"application/vnd.yamaha.hv-dic": {
			"source": "iana",
			"extensions": ["hvd"]
		},
		"application/vnd.yamaha.hv-script": {
			"source": "iana",
			"extensions": ["hvs"]
		},
		"application/vnd.yamaha.hv-voice": {
			"source": "iana",
			"extensions": ["hvp"]
		},
		"application/vnd.yamaha.openscoreformat": {
			"source": "iana",
			"extensions": ["osf"]
		},
		"application/vnd.yamaha.openscoreformat.osfpvg+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["osfpvg"]
		},
		"application/vnd.yamaha.remote-setup": { "source": "iana" },
		"application/vnd.yamaha.smaf-audio": {
			"source": "iana",
			"extensions": ["saf"]
		},
		"application/vnd.yamaha.smaf-phrase": {
			"source": "iana",
			"extensions": ["spf"]
		},
		"application/vnd.yamaha.through-ngn": { "source": "iana" },
		"application/vnd.yamaha.tunnel-udpencap": { "source": "iana" },
		"application/vnd.yaoweme": { "source": "iana" },
		"application/vnd.yellowriver-custom-menu": {
			"source": "iana",
			"extensions": ["cmp"]
		},
		"application/vnd.youtube.yt": { "source": "iana" },
		"application/vnd.zul": {
			"source": "iana",
			"extensions": ["zir", "zirz"]
		},
		"application/vnd.zzazz.deck+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["zaz"]
		},
		"application/voicexml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["vxml"]
		},
		"application/voucher-cms+json": {
			"source": "iana",
			"compressible": true
		},
		"application/vq-rtcpxr": { "source": "iana" },
		"application/wasm": {
			"source": "iana",
			"compressible": true,
			"extensions": ["wasm"]
		},
		"application/watcherinfo+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["wif"]
		},
		"application/webpush-options+json": {
			"source": "iana",
			"compressible": true
		},
		"application/whoispp-query": { "source": "iana" },
		"application/whoispp-response": { "source": "iana" },
		"application/widget": {
			"source": "iana",
			"extensions": ["wgt"]
		},
		"application/winhlp": {
			"source": "apache",
			"extensions": ["hlp"]
		},
		"application/wita": { "source": "iana" },
		"application/wordperfect5.1": { "source": "iana" },
		"application/wsdl+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["wsdl"]
		},
		"application/wspolicy+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["wspolicy"]
		},
		"application/x-7z-compressed": {
			"source": "apache",
			"compressible": false,
			"extensions": ["7z"]
		},
		"application/x-abiword": {
			"source": "apache",
			"extensions": ["abw"]
		},
		"application/x-ace-compressed": {
			"source": "apache",
			"extensions": ["ace"]
		},
		"application/x-amf": { "source": "apache" },
		"application/x-apple-diskimage": {
			"source": "apache",
			"extensions": ["dmg"]
		},
		"application/x-arj": {
			"compressible": false,
			"extensions": ["arj"]
		},
		"application/x-authorware-bin": {
			"source": "apache",
			"extensions": [
				"aab",
				"x32",
				"u32",
				"vox"
			]
		},
		"application/x-authorware-map": {
			"source": "apache",
			"extensions": ["aam"]
		},
		"application/x-authorware-seg": {
			"source": "apache",
			"extensions": ["aas"]
		},
		"application/x-bcpio": {
			"source": "apache",
			"extensions": ["bcpio"]
		},
		"application/x-bdoc": {
			"compressible": false,
			"extensions": ["bdoc"]
		},
		"application/x-bittorrent": {
			"source": "apache",
			"extensions": ["torrent"]
		},
		"application/x-blorb": {
			"source": "apache",
			"extensions": ["blb", "blorb"]
		},
		"application/x-bzip": {
			"source": "apache",
			"compressible": false,
			"extensions": ["bz"]
		},
		"application/x-bzip2": {
			"source": "apache",
			"compressible": false,
			"extensions": ["bz2", "boz"]
		},
		"application/x-cbr": {
			"source": "apache",
			"extensions": [
				"cbr",
				"cba",
				"cbt",
				"cbz",
				"cb7"
			]
		},
		"application/x-cdlink": {
			"source": "apache",
			"extensions": ["vcd"]
		},
		"application/x-cfs-compressed": {
			"source": "apache",
			"extensions": ["cfs"]
		},
		"application/x-chat": {
			"source": "apache",
			"extensions": ["chat"]
		},
		"application/x-chess-pgn": {
			"source": "apache",
			"extensions": ["pgn"]
		},
		"application/x-chrome-extension": { "extensions": ["crx"] },
		"application/x-cocoa": {
			"source": "nginx",
			"extensions": ["cco"]
		},
		"application/x-compress": { "source": "apache" },
		"application/x-conference": {
			"source": "apache",
			"extensions": ["nsc"]
		},
		"application/x-cpio": {
			"source": "apache",
			"extensions": ["cpio"]
		},
		"application/x-csh": {
			"source": "apache",
			"extensions": ["csh"]
		},
		"application/x-deb": { "compressible": false },
		"application/x-debian-package": {
			"source": "apache",
			"extensions": ["deb", "udeb"]
		},
		"application/x-dgc-compressed": {
			"source": "apache",
			"extensions": ["dgc"]
		},
		"application/x-director": {
			"source": "apache",
			"extensions": [
				"dir",
				"dcr",
				"dxr",
				"cst",
				"cct",
				"cxt",
				"w3d",
				"fgd",
				"swa"
			]
		},
		"application/x-doom": {
			"source": "apache",
			"extensions": ["wad"]
		},
		"application/x-dtbncx+xml": {
			"source": "apache",
			"compressible": true,
			"extensions": ["ncx"]
		},
		"application/x-dtbook+xml": {
			"source": "apache",
			"compressible": true,
			"extensions": ["dtb"]
		},
		"application/x-dtbresource+xml": {
			"source": "apache",
			"compressible": true,
			"extensions": ["res"]
		},
		"application/x-dvi": {
			"source": "apache",
			"compressible": false,
			"extensions": ["dvi"]
		},
		"application/x-envoy": {
			"source": "apache",
			"extensions": ["evy"]
		},
		"application/x-eva": {
			"source": "apache",
			"extensions": ["eva"]
		},
		"application/x-font-bdf": {
			"source": "apache",
			"extensions": ["bdf"]
		},
		"application/x-font-dos": { "source": "apache" },
		"application/x-font-framemaker": { "source": "apache" },
		"application/x-font-ghostscript": {
			"source": "apache",
			"extensions": ["gsf"]
		},
		"application/x-font-libgrx": { "source": "apache" },
		"application/x-font-linux-psf": {
			"source": "apache",
			"extensions": ["psf"]
		},
		"application/x-font-pcf": {
			"source": "apache",
			"extensions": ["pcf"]
		},
		"application/x-font-snf": {
			"source": "apache",
			"extensions": ["snf"]
		},
		"application/x-font-speedo": { "source": "apache" },
		"application/x-font-sunos-news": { "source": "apache" },
		"application/x-font-type1": {
			"source": "apache",
			"extensions": [
				"pfa",
				"pfb",
				"pfm",
				"afm"
			]
		},
		"application/x-font-vfont": { "source": "apache" },
		"application/x-freearc": {
			"source": "apache",
			"extensions": ["arc"]
		},
		"application/x-futuresplash": {
			"source": "apache",
			"extensions": ["spl"]
		},
		"application/x-gca-compressed": {
			"source": "apache",
			"extensions": ["gca"]
		},
		"application/x-glulx": {
			"source": "apache",
			"extensions": ["ulx"]
		},
		"application/x-gnumeric": {
			"source": "apache",
			"extensions": ["gnumeric"]
		},
		"application/x-gramps-xml": {
			"source": "apache",
			"extensions": ["gramps"]
		},
		"application/x-gtar": {
			"source": "apache",
			"extensions": ["gtar"]
		},
		"application/x-gzip": { "source": "apache" },
		"application/x-hdf": {
			"source": "apache",
			"extensions": ["hdf"]
		},
		"application/x-httpd-php": {
			"compressible": true,
			"extensions": ["php"]
		},
		"application/x-install-instructions": {
			"source": "apache",
			"extensions": ["install"]
		},
		"application/x-iso9660-image": {
			"source": "apache",
			"extensions": ["iso"]
		},
		"application/x-iwork-keynote-sffkey": { "extensions": ["key"] },
		"application/x-iwork-numbers-sffnumbers": { "extensions": ["numbers"] },
		"application/x-iwork-pages-sffpages": { "extensions": ["pages"] },
		"application/x-java-archive-diff": {
			"source": "nginx",
			"extensions": ["jardiff"]
		},
		"application/x-java-jnlp-file": {
			"source": "apache",
			"compressible": false,
			"extensions": ["jnlp"]
		},
		"application/x-javascript": { "compressible": true },
		"application/x-keepass2": { "extensions": ["kdbx"] },
		"application/x-latex": {
			"source": "apache",
			"compressible": false,
			"extensions": ["latex"]
		},
		"application/x-lua-bytecode": { "extensions": ["luac"] },
		"application/x-lzh-compressed": {
			"source": "apache",
			"extensions": ["lzh", "lha"]
		},
		"application/x-makeself": {
			"source": "nginx",
			"extensions": ["run"]
		},
		"application/x-mie": {
			"source": "apache",
			"extensions": ["mie"]
		},
		"application/x-mobipocket-ebook": {
			"source": "apache",
			"extensions": ["prc", "mobi"]
		},
		"application/x-mpegurl": { "compressible": false },
		"application/x-ms-application": {
			"source": "apache",
			"extensions": ["application"]
		},
		"application/x-ms-shortcut": {
			"source": "apache",
			"extensions": ["lnk"]
		},
		"application/x-ms-wmd": {
			"source": "apache",
			"extensions": ["wmd"]
		},
		"application/x-ms-wmz": {
			"source": "apache",
			"extensions": ["wmz"]
		},
		"application/x-ms-xbap": {
			"source": "apache",
			"extensions": ["xbap"]
		},
		"application/x-msaccess": {
			"source": "apache",
			"extensions": ["mdb"]
		},
		"application/x-msbinder": {
			"source": "apache",
			"extensions": ["obd"]
		},
		"application/x-mscardfile": {
			"source": "apache",
			"extensions": ["crd"]
		},
		"application/x-msclip": {
			"source": "apache",
			"extensions": ["clp"]
		},
		"application/x-msdos-program": { "extensions": ["exe"] },
		"application/x-msdownload": {
			"source": "apache",
			"extensions": [
				"exe",
				"dll",
				"com",
				"bat",
				"msi"
			]
		},
		"application/x-msmediaview": {
			"source": "apache",
			"extensions": [
				"mvb",
				"m13",
				"m14"
			]
		},
		"application/x-msmetafile": {
			"source": "apache",
			"extensions": [
				"wmf",
				"wmz",
				"emf",
				"emz"
			]
		},
		"application/x-msmoney": {
			"source": "apache",
			"extensions": ["mny"]
		},
		"application/x-mspublisher": {
			"source": "apache",
			"extensions": ["pub"]
		},
		"application/x-msschedule": {
			"source": "apache",
			"extensions": ["scd"]
		},
		"application/x-msterminal": {
			"source": "apache",
			"extensions": ["trm"]
		},
		"application/x-mswrite": {
			"source": "apache",
			"extensions": ["wri"]
		},
		"application/x-netcdf": {
			"source": "apache",
			"extensions": ["nc", "cdf"]
		},
		"application/x-ns-proxy-autoconfig": {
			"compressible": true,
			"extensions": ["pac"]
		},
		"application/x-nzb": {
			"source": "apache",
			"extensions": ["nzb"]
		},
		"application/x-perl": {
			"source": "nginx",
			"extensions": ["pl", "pm"]
		},
		"application/x-pilot": {
			"source": "nginx",
			"extensions": ["prc", "pdb"]
		},
		"application/x-pkcs12": {
			"source": "apache",
			"compressible": false,
			"extensions": ["p12", "pfx"]
		},
		"application/x-pkcs7-certificates": {
			"source": "apache",
			"extensions": ["p7b", "spc"]
		},
		"application/x-pkcs7-certreqresp": {
			"source": "apache",
			"extensions": ["p7r"]
		},
		"application/x-pki-message": { "source": "iana" },
		"application/x-rar-compressed": {
			"source": "apache",
			"compressible": false,
			"extensions": ["rar"]
		},
		"application/x-redhat-package-manager": {
			"source": "nginx",
			"extensions": ["rpm"]
		},
		"application/x-research-info-systems": {
			"source": "apache",
			"extensions": ["ris"]
		},
		"application/x-sea": {
			"source": "nginx",
			"extensions": ["sea"]
		},
		"application/x-sh": {
			"source": "apache",
			"compressible": true,
			"extensions": ["sh"]
		},
		"application/x-shar": {
			"source": "apache",
			"extensions": ["shar"]
		},
		"application/x-shockwave-flash": {
			"source": "apache",
			"compressible": false,
			"extensions": ["swf"]
		},
		"application/x-silverlight-app": {
			"source": "apache",
			"extensions": ["xap"]
		},
		"application/x-sql": {
			"source": "apache",
			"extensions": ["sql"]
		},
		"application/x-stuffit": {
			"source": "apache",
			"compressible": false,
			"extensions": ["sit"]
		},
		"application/x-stuffitx": {
			"source": "apache",
			"extensions": ["sitx"]
		},
		"application/x-subrip": {
			"source": "apache",
			"extensions": ["srt"]
		},
		"application/x-sv4cpio": {
			"source": "apache",
			"extensions": ["sv4cpio"]
		},
		"application/x-sv4crc": {
			"source": "apache",
			"extensions": ["sv4crc"]
		},
		"application/x-t3vm-image": {
			"source": "apache",
			"extensions": ["t3"]
		},
		"application/x-tads": {
			"source": "apache",
			"extensions": ["gam"]
		},
		"application/x-tar": {
			"source": "apache",
			"compressible": true,
			"extensions": ["tar"]
		},
		"application/x-tcl": {
			"source": "apache",
			"extensions": ["tcl", "tk"]
		},
		"application/x-tex": {
			"source": "apache",
			"extensions": ["tex"]
		},
		"application/x-tex-tfm": {
			"source": "apache",
			"extensions": ["tfm"]
		},
		"application/x-texinfo": {
			"source": "apache",
			"extensions": ["texinfo", "texi"]
		},
		"application/x-tgif": {
			"source": "apache",
			"extensions": ["obj"]
		},
		"application/x-ustar": {
			"source": "apache",
			"extensions": ["ustar"]
		},
		"application/x-virtualbox-hdd": {
			"compressible": true,
			"extensions": ["hdd"]
		},
		"application/x-virtualbox-ova": {
			"compressible": true,
			"extensions": ["ova"]
		},
		"application/x-virtualbox-ovf": {
			"compressible": true,
			"extensions": ["ovf"]
		},
		"application/x-virtualbox-vbox": {
			"compressible": true,
			"extensions": ["vbox"]
		},
		"application/x-virtualbox-vbox-extpack": {
			"compressible": false,
			"extensions": ["vbox-extpack"]
		},
		"application/x-virtualbox-vdi": {
			"compressible": true,
			"extensions": ["vdi"]
		},
		"application/x-virtualbox-vhd": {
			"compressible": true,
			"extensions": ["vhd"]
		},
		"application/x-virtualbox-vmdk": {
			"compressible": true,
			"extensions": ["vmdk"]
		},
		"application/x-wais-source": {
			"source": "apache",
			"extensions": ["src"]
		},
		"application/x-web-app-manifest+json": {
			"compressible": true,
			"extensions": ["webapp"]
		},
		"application/x-www-form-urlencoded": {
			"source": "iana",
			"compressible": true
		},
		"application/x-x509-ca-cert": {
			"source": "iana",
			"extensions": [
				"der",
				"crt",
				"pem"
			]
		},
		"application/x-x509-ca-ra-cert": { "source": "iana" },
		"application/x-x509-next-ca-cert": { "source": "iana" },
		"application/x-xfig": {
			"source": "apache",
			"extensions": ["fig"]
		},
		"application/x-xliff+xml": {
			"source": "apache",
			"compressible": true,
			"extensions": ["xlf"]
		},
		"application/x-xpinstall": {
			"source": "apache",
			"compressible": false,
			"extensions": ["xpi"]
		},
		"application/x-xz": {
			"source": "apache",
			"extensions": ["xz"]
		},
		"application/x-zmachine": {
			"source": "apache",
			"extensions": [
				"z1",
				"z2",
				"z3",
				"z4",
				"z5",
				"z6",
				"z7",
				"z8"
			]
		},
		"application/x400-bp": { "source": "iana" },
		"application/xacml+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/xaml+xml": {
			"source": "apache",
			"compressible": true,
			"extensions": ["xaml"]
		},
		"application/xcap-att+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xav"]
		},
		"application/xcap-caps+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xca"]
		},
		"application/xcap-diff+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xdf"]
		},
		"application/xcap-el+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xel"]
		},
		"application/xcap-error+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/xcap-ns+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xns"]
		},
		"application/xcon-conference-info+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/xcon-conference-info-diff+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/xenc+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xenc"]
		},
		"application/xhtml+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xhtml", "xht"]
		},
		"application/xhtml-voice+xml": {
			"source": "apache",
			"compressible": true
		},
		"application/xliff+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xlf"]
		},
		"application/xml": {
			"source": "iana",
			"compressible": true,
			"extensions": [
				"xml",
				"xsl",
				"xsd",
				"rng"
			]
		},
		"application/xml-dtd": {
			"source": "iana",
			"compressible": true,
			"extensions": ["dtd"]
		},
		"application/xml-external-parsed-entity": { "source": "iana" },
		"application/xml-patch+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/xmpp+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/xop+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xop"]
		},
		"application/xproc+xml": {
			"source": "apache",
			"compressible": true,
			"extensions": ["xpl"]
		},
		"application/xslt+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xsl", "xslt"]
		},
		"application/xspf+xml": {
			"source": "apache",
			"compressible": true,
			"extensions": ["xspf"]
		},
		"application/xv+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": [
				"mxml",
				"xhvml",
				"xvml",
				"xvm"
			]
		},
		"application/yang": {
			"source": "iana",
			"extensions": ["yang"]
		},
		"application/yang-data+json": {
			"source": "iana",
			"compressible": true
		},
		"application/yang-data+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/yang-patch+json": {
			"source": "iana",
			"compressible": true
		},
		"application/yang-patch+xml": {
			"source": "iana",
			"compressible": true
		},
		"application/yin+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["yin"]
		},
		"application/zip": {
			"source": "iana",
			"compressible": false,
			"extensions": ["zip"]
		},
		"application/zlib": { "source": "iana" },
		"application/zstd": { "source": "iana" },
		"audio/1d-interleaved-parityfec": { "source": "iana" },
		"audio/32kadpcm": { "source": "iana" },
		"audio/3gpp": {
			"source": "iana",
			"compressible": false,
			"extensions": ["3gpp"]
		},
		"audio/3gpp2": { "source": "iana" },
		"audio/aac": { "source": "iana" },
		"audio/ac3": { "source": "iana" },
		"audio/adpcm": {
			"source": "apache",
			"extensions": ["adp"]
		},
		"audio/amr": {
			"source": "iana",
			"extensions": ["amr"]
		},
		"audio/amr-wb": { "source": "iana" },
		"audio/amr-wb+": { "source": "iana" },
		"audio/aptx": { "source": "iana" },
		"audio/asc": { "source": "iana" },
		"audio/atrac-advanced-lossless": { "source": "iana" },
		"audio/atrac-x": { "source": "iana" },
		"audio/atrac3": { "source": "iana" },
		"audio/basic": {
			"source": "iana",
			"compressible": false,
			"extensions": ["au", "snd"]
		},
		"audio/bv16": { "source": "iana" },
		"audio/bv32": { "source": "iana" },
		"audio/clearmode": { "source": "iana" },
		"audio/cn": { "source": "iana" },
		"audio/dat12": { "source": "iana" },
		"audio/dls": { "source": "iana" },
		"audio/dsr-es201108": { "source": "iana" },
		"audio/dsr-es202050": { "source": "iana" },
		"audio/dsr-es202211": { "source": "iana" },
		"audio/dsr-es202212": { "source": "iana" },
		"audio/dv": { "source": "iana" },
		"audio/dvi4": { "source": "iana" },
		"audio/eac3": { "source": "iana" },
		"audio/encaprtp": { "source": "iana" },
		"audio/evrc": { "source": "iana" },
		"audio/evrc-qcp": { "source": "iana" },
		"audio/evrc0": { "source": "iana" },
		"audio/evrc1": { "source": "iana" },
		"audio/evrcb": { "source": "iana" },
		"audio/evrcb0": { "source": "iana" },
		"audio/evrcb1": { "source": "iana" },
		"audio/evrcnw": { "source": "iana" },
		"audio/evrcnw0": { "source": "iana" },
		"audio/evrcnw1": { "source": "iana" },
		"audio/evrcwb": { "source": "iana" },
		"audio/evrcwb0": { "source": "iana" },
		"audio/evrcwb1": { "source": "iana" },
		"audio/evs": { "source": "iana" },
		"audio/flexfec": { "source": "iana" },
		"audio/fwdred": { "source": "iana" },
		"audio/g711-0": { "source": "iana" },
		"audio/g719": { "source": "iana" },
		"audio/g722": { "source": "iana" },
		"audio/g7221": { "source": "iana" },
		"audio/g723": { "source": "iana" },
		"audio/g726-16": { "source": "iana" },
		"audio/g726-24": { "source": "iana" },
		"audio/g726-32": { "source": "iana" },
		"audio/g726-40": { "source": "iana" },
		"audio/g728": { "source": "iana" },
		"audio/g729": { "source": "iana" },
		"audio/g7291": { "source": "iana" },
		"audio/g729d": { "source": "iana" },
		"audio/g729e": { "source": "iana" },
		"audio/gsm": { "source": "iana" },
		"audio/gsm-efr": { "source": "iana" },
		"audio/gsm-hr-08": { "source": "iana" },
		"audio/ilbc": { "source": "iana" },
		"audio/ip-mr_v2.5": { "source": "iana" },
		"audio/isac": { "source": "apache" },
		"audio/l16": { "source": "iana" },
		"audio/l20": { "source": "iana" },
		"audio/l24": {
			"source": "iana",
			"compressible": false
		},
		"audio/l8": { "source": "iana" },
		"audio/lpc": { "source": "iana" },
		"audio/melp": { "source": "iana" },
		"audio/melp1200": { "source": "iana" },
		"audio/melp2400": { "source": "iana" },
		"audio/melp600": { "source": "iana" },
		"audio/mhas": { "source": "iana" },
		"audio/midi": {
			"source": "apache",
			"extensions": [
				"mid",
				"midi",
				"kar",
				"rmi"
			]
		},
		"audio/mobile-xmf": {
			"source": "iana",
			"extensions": ["mxmf"]
		},
		"audio/mp3": {
			"compressible": false,
			"extensions": ["mp3"]
		},
		"audio/mp4": {
			"source": "iana",
			"compressible": false,
			"extensions": ["m4a", "mp4a"]
		},
		"audio/mp4a-latm": { "source": "iana" },
		"audio/mpa": { "source": "iana" },
		"audio/mpa-robust": { "source": "iana" },
		"audio/mpeg": {
			"source": "iana",
			"compressible": false,
			"extensions": [
				"mpga",
				"mp2",
				"mp2a",
				"mp3",
				"m2a",
				"m3a"
			]
		},
		"audio/mpeg4-generic": { "source": "iana" },
		"audio/musepack": { "source": "apache" },
		"audio/ogg": {
			"source": "iana",
			"compressible": false,
			"extensions": [
				"oga",
				"ogg",
				"spx",
				"opus"
			]
		},
		"audio/opus": { "source": "iana" },
		"audio/parityfec": { "source": "iana" },
		"audio/pcma": { "source": "iana" },
		"audio/pcma-wb": { "source": "iana" },
		"audio/pcmu": { "source": "iana" },
		"audio/pcmu-wb": { "source": "iana" },
		"audio/prs.sid": { "source": "iana" },
		"audio/qcelp": { "source": "iana" },
		"audio/raptorfec": { "source": "iana" },
		"audio/red": { "source": "iana" },
		"audio/rtp-enc-aescm128": { "source": "iana" },
		"audio/rtp-midi": { "source": "iana" },
		"audio/rtploopback": { "source": "iana" },
		"audio/rtx": { "source": "iana" },
		"audio/s3m": {
			"source": "apache",
			"extensions": ["s3m"]
		},
		"audio/scip": { "source": "iana" },
		"audio/silk": {
			"source": "apache",
			"extensions": ["sil"]
		},
		"audio/smv": { "source": "iana" },
		"audio/smv-qcp": { "source": "iana" },
		"audio/smv0": { "source": "iana" },
		"audio/sofa": { "source": "iana" },
		"audio/sp-midi": { "source": "iana" },
		"audio/speex": { "source": "iana" },
		"audio/t140c": { "source": "iana" },
		"audio/t38": { "source": "iana" },
		"audio/telephone-event": { "source": "iana" },
		"audio/tetra_acelp": { "source": "iana" },
		"audio/tetra_acelp_bb": { "source": "iana" },
		"audio/tone": { "source": "iana" },
		"audio/tsvcis": { "source": "iana" },
		"audio/uemclip": { "source": "iana" },
		"audio/ulpfec": { "source": "iana" },
		"audio/usac": { "source": "iana" },
		"audio/vdvi": { "source": "iana" },
		"audio/vmr-wb": { "source": "iana" },
		"audio/vnd.3gpp.iufp": { "source": "iana" },
		"audio/vnd.4sb": { "source": "iana" },
		"audio/vnd.audiokoz": { "source": "iana" },
		"audio/vnd.celp": { "source": "iana" },
		"audio/vnd.cisco.nse": { "source": "iana" },
		"audio/vnd.cmles.radio-events": { "source": "iana" },
		"audio/vnd.cns.anp1": { "source": "iana" },
		"audio/vnd.cns.inf1": { "source": "iana" },
		"audio/vnd.dece.audio": {
			"source": "iana",
			"extensions": ["uva", "uvva"]
		},
		"audio/vnd.digital-winds": {
			"source": "iana",
			"extensions": ["eol"]
		},
		"audio/vnd.dlna.adts": { "source": "iana" },
		"audio/vnd.dolby.heaac.1": { "source": "iana" },
		"audio/vnd.dolby.heaac.2": { "source": "iana" },
		"audio/vnd.dolby.mlp": { "source": "iana" },
		"audio/vnd.dolby.mps": { "source": "iana" },
		"audio/vnd.dolby.pl2": { "source": "iana" },
		"audio/vnd.dolby.pl2x": { "source": "iana" },
		"audio/vnd.dolby.pl2z": { "source": "iana" },
		"audio/vnd.dolby.pulse.1": { "source": "iana" },
		"audio/vnd.dra": {
			"source": "iana",
			"extensions": ["dra"]
		},
		"audio/vnd.dts": {
			"source": "iana",
			"extensions": ["dts"]
		},
		"audio/vnd.dts.hd": {
			"source": "iana",
			"extensions": ["dtshd"]
		},
		"audio/vnd.dts.uhd": { "source": "iana" },
		"audio/vnd.dvb.file": { "source": "iana" },
		"audio/vnd.everad.plj": { "source": "iana" },
		"audio/vnd.hns.audio": { "source": "iana" },
		"audio/vnd.lucent.voice": {
			"source": "iana",
			"extensions": ["lvp"]
		},
		"audio/vnd.ms-playready.media.pya": {
			"source": "iana",
			"extensions": ["pya"]
		},
		"audio/vnd.nokia.mobile-xmf": { "source": "iana" },
		"audio/vnd.nortel.vbk": { "source": "iana" },
		"audio/vnd.nuera.ecelp4800": {
			"source": "iana",
			"extensions": ["ecelp4800"]
		},
		"audio/vnd.nuera.ecelp7470": {
			"source": "iana",
			"extensions": ["ecelp7470"]
		},
		"audio/vnd.nuera.ecelp9600": {
			"source": "iana",
			"extensions": ["ecelp9600"]
		},
		"audio/vnd.octel.sbc": { "source": "iana" },
		"audio/vnd.presonus.multitrack": { "source": "iana" },
		"audio/vnd.qcelp": { "source": "iana" },
		"audio/vnd.rhetorex.32kadpcm": { "source": "iana" },
		"audio/vnd.rip": {
			"source": "iana",
			"extensions": ["rip"]
		},
		"audio/vnd.rn-realaudio": { "compressible": false },
		"audio/vnd.sealedmedia.softseal.mpeg": { "source": "iana" },
		"audio/vnd.vmx.cvsd": { "source": "iana" },
		"audio/vnd.wave": { "compressible": false },
		"audio/vorbis": {
			"source": "iana",
			"compressible": false
		},
		"audio/vorbis-config": { "source": "iana" },
		"audio/wav": {
			"compressible": false,
			"extensions": ["wav"]
		},
		"audio/wave": {
			"compressible": false,
			"extensions": ["wav"]
		},
		"audio/webm": {
			"source": "apache",
			"compressible": false,
			"extensions": ["weba"]
		},
		"audio/x-aac": {
			"source": "apache",
			"compressible": false,
			"extensions": ["aac"]
		},
		"audio/x-aiff": {
			"source": "apache",
			"extensions": [
				"aif",
				"aiff",
				"aifc"
			]
		},
		"audio/x-caf": {
			"source": "apache",
			"compressible": false,
			"extensions": ["caf"]
		},
		"audio/x-flac": {
			"source": "apache",
			"extensions": ["flac"]
		},
		"audio/x-m4a": {
			"source": "nginx",
			"extensions": ["m4a"]
		},
		"audio/x-matroska": {
			"source": "apache",
			"extensions": ["mka"]
		},
		"audio/x-mpegurl": {
			"source": "apache",
			"extensions": ["m3u"]
		},
		"audio/x-ms-wax": {
			"source": "apache",
			"extensions": ["wax"]
		},
		"audio/x-ms-wma": {
			"source": "apache",
			"extensions": ["wma"]
		},
		"audio/x-pn-realaudio": {
			"source": "apache",
			"extensions": ["ram", "ra"]
		},
		"audio/x-pn-realaudio-plugin": {
			"source": "apache",
			"extensions": ["rmp"]
		},
		"audio/x-realaudio": {
			"source": "nginx",
			"extensions": ["ra"]
		},
		"audio/x-tta": { "source": "apache" },
		"audio/x-wav": {
			"source": "apache",
			"extensions": ["wav"]
		},
		"audio/xm": {
			"source": "apache",
			"extensions": ["xm"]
		},
		"chemical/x-cdx": {
			"source": "apache",
			"extensions": ["cdx"]
		},
		"chemical/x-cif": {
			"source": "apache",
			"extensions": ["cif"]
		},
		"chemical/x-cmdf": {
			"source": "apache",
			"extensions": ["cmdf"]
		},
		"chemical/x-cml": {
			"source": "apache",
			"extensions": ["cml"]
		},
		"chemical/x-csml": {
			"source": "apache",
			"extensions": ["csml"]
		},
		"chemical/x-pdb": { "source": "apache" },
		"chemical/x-xyz": {
			"source": "apache",
			"extensions": ["xyz"]
		},
		"font/collection": {
			"source": "iana",
			"extensions": ["ttc"]
		},
		"font/otf": {
			"source": "iana",
			"compressible": true,
			"extensions": ["otf"]
		},
		"font/sfnt": { "source": "iana" },
		"font/ttf": {
			"source": "iana",
			"compressible": true,
			"extensions": ["ttf"]
		},
		"font/woff": {
			"source": "iana",
			"extensions": ["woff"]
		},
		"font/woff2": {
			"source": "iana",
			"extensions": ["woff2"]
		},
		"image/aces": {
			"source": "iana",
			"extensions": ["exr"]
		},
		"image/apng": {
			"compressible": false,
			"extensions": ["apng"]
		},
		"image/avci": {
			"source": "iana",
			"extensions": ["avci"]
		},
		"image/avcs": {
			"source": "iana",
			"extensions": ["avcs"]
		},
		"image/avif": {
			"source": "iana",
			"compressible": false,
			"extensions": ["avif"]
		},
		"image/bmp": {
			"source": "iana",
			"compressible": true,
			"extensions": ["bmp"]
		},
		"image/cgm": {
			"source": "iana",
			"extensions": ["cgm"]
		},
		"image/dicom-rle": {
			"source": "iana",
			"extensions": ["drle"]
		},
		"image/emf": {
			"source": "iana",
			"extensions": ["emf"]
		},
		"image/fits": {
			"source": "iana",
			"extensions": ["fits"]
		},
		"image/g3fax": {
			"source": "iana",
			"extensions": ["g3"]
		},
		"image/gif": {
			"source": "iana",
			"compressible": false,
			"extensions": ["gif"]
		},
		"image/heic": {
			"source": "iana",
			"extensions": ["heic"]
		},
		"image/heic-sequence": {
			"source": "iana",
			"extensions": ["heics"]
		},
		"image/heif": {
			"source": "iana",
			"extensions": ["heif"]
		},
		"image/heif-sequence": {
			"source": "iana",
			"extensions": ["heifs"]
		},
		"image/hej2k": {
			"source": "iana",
			"extensions": ["hej2"]
		},
		"image/hsj2": {
			"source": "iana",
			"extensions": ["hsj2"]
		},
		"image/ief": {
			"source": "iana",
			"extensions": ["ief"]
		},
		"image/jls": {
			"source": "iana",
			"extensions": ["jls"]
		},
		"image/jp2": {
			"source": "iana",
			"compressible": false,
			"extensions": ["jp2", "jpg2"]
		},
		"image/jpeg": {
			"source": "iana",
			"compressible": false,
			"extensions": [
				"jpeg",
				"jpg",
				"jpe"
			]
		},
		"image/jph": {
			"source": "iana",
			"extensions": ["jph"]
		},
		"image/jphc": {
			"source": "iana",
			"extensions": ["jhc"]
		},
		"image/jpm": {
			"source": "iana",
			"compressible": false,
			"extensions": ["jpm"]
		},
		"image/jpx": {
			"source": "iana",
			"compressible": false,
			"extensions": ["jpx", "jpf"]
		},
		"image/jxr": {
			"source": "iana",
			"extensions": ["jxr"]
		},
		"image/jxra": {
			"source": "iana",
			"extensions": ["jxra"]
		},
		"image/jxrs": {
			"source": "iana",
			"extensions": ["jxrs"]
		},
		"image/jxs": {
			"source": "iana",
			"extensions": ["jxs"]
		},
		"image/jxsc": {
			"source": "iana",
			"extensions": ["jxsc"]
		},
		"image/jxsi": {
			"source": "iana",
			"extensions": ["jxsi"]
		},
		"image/jxss": {
			"source": "iana",
			"extensions": ["jxss"]
		},
		"image/ktx": {
			"source": "iana",
			"extensions": ["ktx"]
		},
		"image/ktx2": {
			"source": "iana",
			"extensions": ["ktx2"]
		},
		"image/naplps": { "source": "iana" },
		"image/pjpeg": { "compressible": false },
		"image/png": {
			"source": "iana",
			"compressible": false,
			"extensions": ["png"]
		},
		"image/prs.btif": {
			"source": "iana",
			"extensions": ["btif"]
		},
		"image/prs.pti": {
			"source": "iana",
			"extensions": ["pti"]
		},
		"image/pwg-raster": { "source": "iana" },
		"image/sgi": {
			"source": "apache",
			"extensions": ["sgi"]
		},
		"image/svg+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["svg", "svgz"]
		},
		"image/t38": {
			"source": "iana",
			"extensions": ["t38"]
		},
		"image/tiff": {
			"source": "iana",
			"compressible": false,
			"extensions": ["tif", "tiff"]
		},
		"image/tiff-fx": {
			"source": "iana",
			"extensions": ["tfx"]
		},
		"image/vnd.adobe.photoshop": {
			"source": "iana",
			"compressible": true,
			"extensions": ["psd"]
		},
		"image/vnd.airzip.accelerator.azv": {
			"source": "iana",
			"extensions": ["azv"]
		},
		"image/vnd.cns.inf2": { "source": "iana" },
		"image/vnd.dece.graphic": {
			"source": "iana",
			"extensions": [
				"uvi",
				"uvvi",
				"uvg",
				"uvvg"
			]
		},
		"image/vnd.djvu": {
			"source": "iana",
			"extensions": ["djvu", "djv"]
		},
		"image/vnd.dvb.subtitle": {
			"source": "iana",
			"extensions": ["sub"]
		},
		"image/vnd.dwg": {
			"source": "iana",
			"extensions": ["dwg"]
		},
		"image/vnd.dxf": {
			"source": "iana",
			"extensions": ["dxf"]
		},
		"image/vnd.fastbidsheet": {
			"source": "iana",
			"extensions": ["fbs"]
		},
		"image/vnd.fpx": {
			"source": "iana",
			"extensions": ["fpx"]
		},
		"image/vnd.fst": {
			"source": "iana",
			"extensions": ["fst"]
		},
		"image/vnd.fujixerox.edmics-mmr": {
			"source": "iana",
			"extensions": ["mmr"]
		},
		"image/vnd.fujixerox.edmics-rlc": {
			"source": "iana",
			"extensions": ["rlc"]
		},
		"image/vnd.globalgraphics.pgb": { "source": "iana" },
		"image/vnd.microsoft.icon": {
			"source": "iana",
			"compressible": true,
			"extensions": ["ico"]
		},
		"image/vnd.mix": { "source": "iana" },
		"image/vnd.mozilla.apng": { "source": "iana" },
		"image/vnd.ms-dds": {
			"compressible": true,
			"extensions": ["dds"]
		},
		"image/vnd.ms-modi": {
			"source": "iana",
			"extensions": ["mdi"]
		},
		"image/vnd.ms-photo": {
			"source": "apache",
			"extensions": ["wdp"]
		},
		"image/vnd.net-fpx": {
			"source": "iana",
			"extensions": ["npx"]
		},
		"image/vnd.pco.b16": {
			"source": "iana",
			"extensions": ["b16"]
		},
		"image/vnd.radiance": { "source": "iana" },
		"image/vnd.sealed.png": { "source": "iana" },
		"image/vnd.sealedmedia.softseal.gif": { "source": "iana" },
		"image/vnd.sealedmedia.softseal.jpg": { "source": "iana" },
		"image/vnd.svf": { "source": "iana" },
		"image/vnd.tencent.tap": {
			"source": "iana",
			"extensions": ["tap"]
		},
		"image/vnd.valve.source.texture": {
			"source": "iana",
			"extensions": ["vtf"]
		},
		"image/vnd.wap.wbmp": {
			"source": "iana",
			"extensions": ["wbmp"]
		},
		"image/vnd.xiff": {
			"source": "iana",
			"extensions": ["xif"]
		},
		"image/vnd.zbrush.pcx": {
			"source": "iana",
			"extensions": ["pcx"]
		},
		"image/webp": {
			"source": "apache",
			"extensions": ["webp"]
		},
		"image/wmf": {
			"source": "iana",
			"extensions": ["wmf"]
		},
		"image/x-3ds": {
			"source": "apache",
			"extensions": ["3ds"]
		},
		"image/x-cmu-raster": {
			"source": "apache",
			"extensions": ["ras"]
		},
		"image/x-cmx": {
			"source": "apache",
			"extensions": ["cmx"]
		},
		"image/x-freehand": {
			"source": "apache",
			"extensions": [
				"fh",
				"fhc",
				"fh4",
				"fh5",
				"fh7"
			]
		},
		"image/x-icon": {
			"source": "apache",
			"compressible": true,
			"extensions": ["ico"]
		},
		"image/x-jng": {
			"source": "nginx",
			"extensions": ["jng"]
		},
		"image/x-mrsid-image": {
			"source": "apache",
			"extensions": ["sid"]
		},
		"image/x-ms-bmp": {
			"source": "nginx",
			"compressible": true,
			"extensions": ["bmp"]
		},
		"image/x-pcx": {
			"source": "apache",
			"extensions": ["pcx"]
		},
		"image/x-pict": {
			"source": "apache",
			"extensions": ["pic", "pct"]
		},
		"image/x-portable-anymap": {
			"source": "apache",
			"extensions": ["pnm"]
		},
		"image/x-portable-bitmap": {
			"source": "apache",
			"extensions": ["pbm"]
		},
		"image/x-portable-graymap": {
			"source": "apache",
			"extensions": ["pgm"]
		},
		"image/x-portable-pixmap": {
			"source": "apache",
			"extensions": ["ppm"]
		},
		"image/x-rgb": {
			"source": "apache",
			"extensions": ["rgb"]
		},
		"image/x-tga": {
			"source": "apache",
			"extensions": ["tga"]
		},
		"image/x-xbitmap": {
			"source": "apache",
			"extensions": ["xbm"]
		},
		"image/x-xcf": { "compressible": false },
		"image/x-xpixmap": {
			"source": "apache",
			"extensions": ["xpm"]
		},
		"image/x-xwindowdump": {
			"source": "apache",
			"extensions": ["xwd"]
		},
		"message/cpim": { "source": "iana" },
		"message/delivery-status": { "source": "iana" },
		"message/disposition-notification": {
			"source": "iana",
			"extensions": ["disposition-notification"]
		},
		"message/external-body": { "source": "iana" },
		"message/feedback-report": { "source": "iana" },
		"message/global": {
			"source": "iana",
			"extensions": ["u8msg"]
		},
		"message/global-delivery-status": {
			"source": "iana",
			"extensions": ["u8dsn"]
		},
		"message/global-disposition-notification": {
			"source": "iana",
			"extensions": ["u8mdn"]
		},
		"message/global-headers": {
			"source": "iana",
			"extensions": ["u8hdr"]
		},
		"message/http": {
			"source": "iana",
			"compressible": false
		},
		"message/imdn+xml": {
			"source": "iana",
			"compressible": true
		},
		"message/news": { "source": "iana" },
		"message/partial": {
			"source": "iana",
			"compressible": false
		},
		"message/rfc822": {
			"source": "iana",
			"compressible": true,
			"extensions": ["eml", "mime"]
		},
		"message/s-http": { "source": "iana" },
		"message/sip": { "source": "iana" },
		"message/sipfrag": { "source": "iana" },
		"message/tracking-status": { "source": "iana" },
		"message/vnd.si.simp": { "source": "iana" },
		"message/vnd.wfa.wsc": {
			"source": "iana",
			"extensions": ["wsc"]
		},
		"model/3mf": {
			"source": "iana",
			"extensions": ["3mf"]
		},
		"model/e57": { "source": "iana" },
		"model/gltf+json": {
			"source": "iana",
			"compressible": true,
			"extensions": ["gltf"]
		},
		"model/gltf-binary": {
			"source": "iana",
			"compressible": true,
			"extensions": ["glb"]
		},
		"model/iges": {
			"source": "iana",
			"compressible": false,
			"extensions": ["igs", "iges"]
		},
		"model/mesh": {
			"source": "iana",
			"compressible": false,
			"extensions": [
				"msh",
				"mesh",
				"silo"
			]
		},
		"model/mtl": {
			"source": "iana",
			"extensions": ["mtl"]
		},
		"model/obj": {
			"source": "iana",
			"extensions": ["obj"]
		},
		"model/step": { "source": "iana" },
		"model/step+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["stpx"]
		},
		"model/step+zip": {
			"source": "iana",
			"compressible": false,
			"extensions": ["stpz"]
		},
		"model/step-xml+zip": {
			"source": "iana",
			"compressible": false,
			"extensions": ["stpxz"]
		},
		"model/stl": {
			"source": "iana",
			"extensions": ["stl"]
		},
		"model/vnd.collada+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["dae"]
		},
		"model/vnd.dwf": {
			"source": "iana",
			"extensions": ["dwf"]
		},
		"model/vnd.flatland.3dml": { "source": "iana" },
		"model/vnd.gdl": {
			"source": "iana",
			"extensions": ["gdl"]
		},
		"model/vnd.gs-gdl": { "source": "apache" },
		"model/vnd.gs.gdl": { "source": "iana" },
		"model/vnd.gtw": {
			"source": "iana",
			"extensions": ["gtw"]
		},
		"model/vnd.moml+xml": {
			"source": "iana",
			"compressible": true
		},
		"model/vnd.mts": {
			"source": "iana",
			"extensions": ["mts"]
		},
		"model/vnd.opengex": {
			"source": "iana",
			"extensions": ["ogex"]
		},
		"model/vnd.parasolid.transmit.binary": {
			"source": "iana",
			"extensions": ["x_b"]
		},
		"model/vnd.parasolid.transmit.text": {
			"source": "iana",
			"extensions": ["x_t"]
		},
		"model/vnd.pytha.pyox": { "source": "iana" },
		"model/vnd.rosette.annotated-data-model": { "source": "iana" },
		"model/vnd.sap.vds": {
			"source": "iana",
			"extensions": ["vds"]
		},
		"model/vnd.usdz+zip": {
			"source": "iana",
			"compressible": false,
			"extensions": ["usdz"]
		},
		"model/vnd.valve.source.compiled-map": {
			"source": "iana",
			"extensions": ["bsp"]
		},
		"model/vnd.vtu": {
			"source": "iana",
			"extensions": ["vtu"]
		},
		"model/vrml": {
			"source": "iana",
			"compressible": false,
			"extensions": ["wrl", "vrml"]
		},
		"model/x3d+binary": {
			"source": "apache",
			"compressible": false,
			"extensions": ["x3db", "x3dbz"]
		},
		"model/x3d+fastinfoset": {
			"source": "iana",
			"extensions": ["x3db"]
		},
		"model/x3d+vrml": {
			"source": "apache",
			"compressible": false,
			"extensions": ["x3dv", "x3dvz"]
		},
		"model/x3d+xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["x3d", "x3dz"]
		},
		"model/x3d-vrml": {
			"source": "iana",
			"extensions": ["x3dv"]
		},
		"multipart/alternative": {
			"source": "iana",
			"compressible": false
		},
		"multipart/appledouble": { "source": "iana" },
		"multipart/byteranges": { "source": "iana" },
		"multipart/digest": { "source": "iana" },
		"multipart/encrypted": {
			"source": "iana",
			"compressible": false
		},
		"multipart/form-data": {
			"source": "iana",
			"compressible": false
		},
		"multipart/header-set": { "source": "iana" },
		"multipart/mixed": { "source": "iana" },
		"multipart/multilingual": { "source": "iana" },
		"multipart/parallel": { "source": "iana" },
		"multipart/related": {
			"source": "iana",
			"compressible": false
		},
		"multipart/report": { "source": "iana" },
		"multipart/signed": {
			"source": "iana",
			"compressible": false
		},
		"multipart/vnd.bint.med-plus": { "source": "iana" },
		"multipart/voice-message": { "source": "iana" },
		"multipart/x-mixed-replace": { "source": "iana" },
		"text/1d-interleaved-parityfec": { "source": "iana" },
		"text/cache-manifest": {
			"source": "iana",
			"compressible": true,
			"extensions": ["appcache", "manifest"]
		},
		"text/calendar": {
			"source": "iana",
			"extensions": ["ics", "ifb"]
		},
		"text/calender": { "compressible": true },
		"text/cmd": { "compressible": true },
		"text/coffeescript": { "extensions": ["coffee", "litcoffee"] },
		"text/cql": { "source": "iana" },
		"text/cql-expression": { "source": "iana" },
		"text/cql-identifier": { "source": "iana" },
		"text/css": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true,
			"extensions": ["css"]
		},
		"text/csv": {
			"source": "iana",
			"compressible": true,
			"extensions": ["csv"]
		},
		"text/csv-schema": { "source": "iana" },
		"text/directory": { "source": "iana" },
		"text/dns": { "source": "iana" },
		"text/ecmascript": { "source": "iana" },
		"text/encaprtp": { "source": "iana" },
		"text/enriched": { "source": "iana" },
		"text/fhirpath": { "source": "iana" },
		"text/flexfec": { "source": "iana" },
		"text/fwdred": { "source": "iana" },
		"text/gff3": { "source": "iana" },
		"text/grammar-ref-list": { "source": "iana" },
		"text/html": {
			"source": "iana",
			"compressible": true,
			"extensions": [
				"html",
				"htm",
				"shtml"
			]
		},
		"text/jade": { "extensions": ["jade"] },
		"text/javascript": {
			"source": "iana",
			"compressible": true
		},
		"text/jcr-cnd": { "source": "iana" },
		"text/jsx": {
			"compressible": true,
			"extensions": ["jsx"]
		},
		"text/less": {
			"compressible": true,
			"extensions": ["less"]
		},
		"text/markdown": {
			"source": "iana",
			"compressible": true,
			"extensions": ["markdown", "md"]
		},
		"text/mathml": {
			"source": "nginx",
			"extensions": ["mml"]
		},
		"text/mdx": {
			"compressible": true,
			"extensions": ["mdx"]
		},
		"text/mizar": { "source": "iana" },
		"text/n3": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true,
			"extensions": ["n3"]
		},
		"text/parameters": {
			"source": "iana",
			"charset": "UTF-8"
		},
		"text/parityfec": { "source": "iana" },
		"text/plain": {
			"source": "iana",
			"compressible": true,
			"extensions": [
				"txt",
				"text",
				"conf",
				"def",
				"list",
				"log",
				"in",
				"ini"
			]
		},
		"text/provenance-notation": {
			"source": "iana",
			"charset": "UTF-8"
		},
		"text/prs.fallenstein.rst": { "source": "iana" },
		"text/prs.lines.tag": {
			"source": "iana",
			"extensions": ["dsc"]
		},
		"text/prs.prop.logic": { "source": "iana" },
		"text/raptorfec": { "source": "iana" },
		"text/red": { "source": "iana" },
		"text/rfc822-headers": { "source": "iana" },
		"text/richtext": {
			"source": "iana",
			"compressible": true,
			"extensions": ["rtx"]
		},
		"text/rtf": {
			"source": "iana",
			"compressible": true,
			"extensions": ["rtf"]
		},
		"text/rtp-enc-aescm128": { "source": "iana" },
		"text/rtploopback": { "source": "iana" },
		"text/rtx": { "source": "iana" },
		"text/sgml": {
			"source": "iana",
			"extensions": ["sgml", "sgm"]
		},
		"text/shaclc": { "source": "iana" },
		"text/shex": {
			"source": "iana",
			"extensions": ["shex"]
		},
		"text/slim": { "extensions": ["slim", "slm"] },
		"text/spdx": {
			"source": "iana",
			"extensions": ["spdx"]
		},
		"text/strings": { "source": "iana" },
		"text/stylus": { "extensions": ["stylus", "styl"] },
		"text/t140": { "source": "iana" },
		"text/tab-separated-values": {
			"source": "iana",
			"compressible": true,
			"extensions": ["tsv"]
		},
		"text/troff": {
			"source": "iana",
			"extensions": [
				"t",
				"tr",
				"roff",
				"man",
				"me",
				"ms"
			]
		},
		"text/turtle": {
			"source": "iana",
			"charset": "UTF-8",
			"extensions": ["ttl"]
		},
		"text/ulpfec": { "source": "iana" },
		"text/uri-list": {
			"source": "iana",
			"compressible": true,
			"extensions": [
				"uri",
				"uris",
				"urls"
			]
		},
		"text/vcard": {
			"source": "iana",
			"compressible": true,
			"extensions": ["vcard"]
		},
		"text/vnd.a": { "source": "iana" },
		"text/vnd.abc": { "source": "iana" },
		"text/vnd.ascii-art": { "source": "iana" },
		"text/vnd.curl": {
			"source": "iana",
			"extensions": ["curl"]
		},
		"text/vnd.curl.dcurl": {
			"source": "apache",
			"extensions": ["dcurl"]
		},
		"text/vnd.curl.mcurl": {
			"source": "apache",
			"extensions": ["mcurl"]
		},
		"text/vnd.curl.scurl": {
			"source": "apache",
			"extensions": ["scurl"]
		},
		"text/vnd.debian.copyright": {
			"source": "iana",
			"charset": "UTF-8"
		},
		"text/vnd.dmclientscript": { "source": "iana" },
		"text/vnd.dvb.subtitle": {
			"source": "iana",
			"extensions": ["sub"]
		},
		"text/vnd.esmertec.theme-descriptor": {
			"source": "iana",
			"charset": "UTF-8"
		},
		"text/vnd.familysearch.gedcom": {
			"source": "iana",
			"extensions": ["ged"]
		},
		"text/vnd.ficlab.flt": { "source": "iana" },
		"text/vnd.fly": {
			"source": "iana",
			"extensions": ["fly"]
		},
		"text/vnd.fmi.flexstor": {
			"source": "iana",
			"extensions": ["flx"]
		},
		"text/vnd.gml": { "source": "iana" },
		"text/vnd.graphviz": {
			"source": "iana",
			"extensions": ["gv"]
		},
		"text/vnd.hans": { "source": "iana" },
		"text/vnd.hgl": { "source": "iana" },
		"text/vnd.in3d.3dml": {
			"source": "iana",
			"extensions": ["3dml"]
		},
		"text/vnd.in3d.spot": {
			"source": "iana",
			"extensions": ["spot"]
		},
		"text/vnd.iptc.newsml": { "source": "iana" },
		"text/vnd.iptc.nitf": { "source": "iana" },
		"text/vnd.latex-z": { "source": "iana" },
		"text/vnd.motorola.reflex": { "source": "iana" },
		"text/vnd.ms-mediapackage": { "source": "iana" },
		"text/vnd.net2phone.commcenter.command": { "source": "iana" },
		"text/vnd.radisys.msml-basic-layout": { "source": "iana" },
		"text/vnd.senx.warpscript": { "source": "iana" },
		"text/vnd.si.uricatalogue": { "source": "iana" },
		"text/vnd.sosi": { "source": "iana" },
		"text/vnd.sun.j2me.app-descriptor": {
			"source": "iana",
			"charset": "UTF-8",
			"extensions": ["jad"]
		},
		"text/vnd.trolltech.linguist": {
			"source": "iana",
			"charset": "UTF-8"
		},
		"text/vnd.wap.si": { "source": "iana" },
		"text/vnd.wap.sl": { "source": "iana" },
		"text/vnd.wap.wml": {
			"source": "iana",
			"extensions": ["wml"]
		},
		"text/vnd.wap.wmlscript": {
			"source": "iana",
			"extensions": ["wmls"]
		},
		"text/vtt": {
			"source": "iana",
			"charset": "UTF-8",
			"compressible": true,
			"extensions": ["vtt"]
		},
		"text/x-asm": {
			"source": "apache",
			"extensions": ["s", "asm"]
		},
		"text/x-c": {
			"source": "apache",
			"extensions": [
				"c",
				"cc",
				"cxx",
				"cpp",
				"h",
				"hh",
				"dic"
			]
		},
		"text/x-component": {
			"source": "nginx",
			"extensions": ["htc"]
		},
		"text/x-fortran": {
			"source": "apache",
			"extensions": [
				"f",
				"for",
				"f77",
				"f90"
			]
		},
		"text/x-gwt-rpc": { "compressible": true },
		"text/x-handlebars-template": { "extensions": ["hbs"] },
		"text/x-java-source": {
			"source": "apache",
			"extensions": ["java"]
		},
		"text/x-jquery-tmpl": { "compressible": true },
		"text/x-lua": { "extensions": ["lua"] },
		"text/x-markdown": {
			"compressible": true,
			"extensions": ["mkd"]
		},
		"text/x-nfo": {
			"source": "apache",
			"extensions": ["nfo"]
		},
		"text/x-opml": {
			"source": "apache",
			"extensions": ["opml"]
		},
		"text/x-org": {
			"compressible": true,
			"extensions": ["org"]
		},
		"text/x-pascal": {
			"source": "apache",
			"extensions": ["p", "pas"]
		},
		"text/x-processing": {
			"compressible": true,
			"extensions": ["pde"]
		},
		"text/x-sass": { "extensions": ["sass"] },
		"text/x-scss": { "extensions": ["scss"] },
		"text/x-setext": {
			"source": "apache",
			"extensions": ["etx"]
		},
		"text/x-sfv": {
			"source": "apache",
			"extensions": ["sfv"]
		},
		"text/x-suse-ymp": {
			"compressible": true,
			"extensions": ["ymp"]
		},
		"text/x-uuencode": {
			"source": "apache",
			"extensions": ["uu"]
		},
		"text/x-vcalendar": {
			"source": "apache",
			"extensions": ["vcs"]
		},
		"text/x-vcard": {
			"source": "apache",
			"extensions": ["vcf"]
		},
		"text/xml": {
			"source": "iana",
			"compressible": true,
			"extensions": ["xml"]
		},
		"text/xml-external-parsed-entity": { "source": "iana" },
		"text/yaml": {
			"compressible": true,
			"extensions": ["yaml", "yml"]
		},
		"video/1d-interleaved-parityfec": { "source": "iana" },
		"video/3gpp": {
			"source": "iana",
			"extensions": ["3gp", "3gpp"]
		},
		"video/3gpp-tt": { "source": "iana" },
		"video/3gpp2": {
			"source": "iana",
			"extensions": ["3g2"]
		},
		"video/av1": { "source": "iana" },
		"video/bmpeg": { "source": "iana" },
		"video/bt656": { "source": "iana" },
		"video/celb": { "source": "iana" },
		"video/dv": { "source": "iana" },
		"video/encaprtp": { "source": "iana" },
		"video/ffv1": { "source": "iana" },
		"video/flexfec": { "source": "iana" },
		"video/h261": {
			"source": "iana",
			"extensions": ["h261"]
		},
		"video/h263": {
			"source": "iana",
			"extensions": ["h263"]
		},
		"video/h263-1998": { "source": "iana" },
		"video/h263-2000": { "source": "iana" },
		"video/h264": {
			"source": "iana",
			"extensions": ["h264"]
		},
		"video/h264-rcdo": { "source": "iana" },
		"video/h264-svc": { "source": "iana" },
		"video/h265": { "source": "iana" },
		"video/iso.segment": {
			"source": "iana",
			"extensions": ["m4s"]
		},
		"video/jpeg": {
			"source": "iana",
			"extensions": ["jpgv"]
		},
		"video/jpeg2000": { "source": "iana" },
		"video/jpm": {
			"source": "apache",
			"extensions": ["jpm", "jpgm"]
		},
		"video/jxsv": { "source": "iana" },
		"video/mj2": {
			"source": "iana",
			"extensions": ["mj2", "mjp2"]
		},
		"video/mp1s": { "source": "iana" },
		"video/mp2p": { "source": "iana" },
		"video/mp2t": {
			"source": "iana",
			"extensions": ["ts"]
		},
		"video/mp4": {
			"source": "iana",
			"compressible": false,
			"extensions": [
				"mp4",
				"mp4v",
				"mpg4"
			]
		},
		"video/mp4v-es": { "source": "iana" },
		"video/mpeg": {
			"source": "iana",
			"compressible": false,
			"extensions": [
				"mpeg",
				"mpg",
				"mpe",
				"m1v",
				"m2v"
			]
		},
		"video/mpeg4-generic": { "source": "iana" },
		"video/mpv": { "source": "iana" },
		"video/nv": { "source": "iana" },
		"video/ogg": {
			"source": "iana",
			"compressible": false,
			"extensions": ["ogv"]
		},
		"video/parityfec": { "source": "iana" },
		"video/pointer": { "source": "iana" },
		"video/quicktime": {
			"source": "iana",
			"compressible": false,
			"extensions": ["qt", "mov"]
		},
		"video/raptorfec": { "source": "iana" },
		"video/raw": { "source": "iana" },
		"video/rtp-enc-aescm128": { "source": "iana" },
		"video/rtploopback": { "source": "iana" },
		"video/rtx": { "source": "iana" },
		"video/scip": { "source": "iana" },
		"video/smpte291": { "source": "iana" },
		"video/smpte292m": { "source": "iana" },
		"video/ulpfec": { "source": "iana" },
		"video/vc1": { "source": "iana" },
		"video/vc2": { "source": "iana" },
		"video/vnd.cctv": { "source": "iana" },
		"video/vnd.dece.hd": {
			"source": "iana",
			"extensions": ["uvh", "uvvh"]
		},
		"video/vnd.dece.mobile": {
			"source": "iana",
			"extensions": ["uvm", "uvvm"]
		},
		"video/vnd.dece.mp4": { "source": "iana" },
		"video/vnd.dece.pd": {
			"source": "iana",
			"extensions": ["uvp", "uvvp"]
		},
		"video/vnd.dece.sd": {
			"source": "iana",
			"extensions": ["uvs", "uvvs"]
		},
		"video/vnd.dece.video": {
			"source": "iana",
			"extensions": ["uvv", "uvvv"]
		},
		"video/vnd.directv.mpeg": { "source": "iana" },
		"video/vnd.directv.mpeg-tts": { "source": "iana" },
		"video/vnd.dlna.mpeg-tts": { "source": "iana" },
		"video/vnd.dvb.file": {
			"source": "iana",
			"extensions": ["dvb"]
		},
		"video/vnd.fvt": {
			"source": "iana",
			"extensions": ["fvt"]
		},
		"video/vnd.hns.video": { "source": "iana" },
		"video/vnd.iptvforum.1dparityfec-1010": { "source": "iana" },
		"video/vnd.iptvforum.1dparityfec-2005": { "source": "iana" },
		"video/vnd.iptvforum.2dparityfec-1010": { "source": "iana" },
		"video/vnd.iptvforum.2dparityfec-2005": { "source": "iana" },
		"video/vnd.iptvforum.ttsavc": { "source": "iana" },
		"video/vnd.iptvforum.ttsmpeg2": { "source": "iana" },
		"video/vnd.motorola.video": { "source": "iana" },
		"video/vnd.motorola.videop": { "source": "iana" },
		"video/vnd.mpegurl": {
			"source": "iana",
			"extensions": ["mxu", "m4u"]
		},
		"video/vnd.ms-playready.media.pyv": {
			"source": "iana",
			"extensions": ["pyv"]
		},
		"video/vnd.nokia.interleaved-multimedia": { "source": "iana" },
		"video/vnd.nokia.mp4vr": { "source": "iana" },
		"video/vnd.nokia.videovoip": { "source": "iana" },
		"video/vnd.objectvideo": { "source": "iana" },
		"video/vnd.radgamettools.bink": { "source": "iana" },
		"video/vnd.radgamettools.smacker": { "source": "iana" },
		"video/vnd.sealed.mpeg1": { "source": "iana" },
		"video/vnd.sealed.mpeg4": { "source": "iana" },
		"video/vnd.sealed.swf": { "source": "iana" },
		"video/vnd.sealedmedia.softseal.mov": { "source": "iana" },
		"video/vnd.uvvu.mp4": {
			"source": "iana",
			"extensions": ["uvu", "uvvu"]
		},
		"video/vnd.vivo": {
			"source": "iana",
			"extensions": ["viv"]
		},
		"video/vnd.youtube.yt": { "source": "iana" },
		"video/vp8": { "source": "iana" },
		"video/vp9": { "source": "iana" },
		"video/webm": {
			"source": "apache",
			"compressible": false,
			"extensions": ["webm"]
		},
		"video/x-f4v": {
			"source": "apache",
			"extensions": ["f4v"]
		},
		"video/x-fli": {
			"source": "apache",
			"extensions": ["fli"]
		},
		"video/x-flv": {
			"source": "apache",
			"compressible": false,
			"extensions": ["flv"]
		},
		"video/x-m4v": {
			"source": "apache",
			"extensions": ["m4v"]
		},
		"video/x-matroska": {
			"source": "apache",
			"compressible": false,
			"extensions": [
				"mkv",
				"mk3d",
				"mks"
			]
		},
		"video/x-mng": {
			"source": "apache",
			"extensions": ["mng"]
		},
		"video/x-ms-asf": {
			"source": "apache",
			"extensions": ["asf", "asx"]
		},
		"video/x-ms-vob": {
			"source": "apache",
			"extensions": ["vob"]
		},
		"video/x-ms-wm": {
			"source": "apache",
			"extensions": ["wm"]
		},
		"video/x-ms-wmv": {
			"source": "apache",
			"compressible": false,
			"extensions": ["wmv"]
		},
		"video/x-ms-wmx": {
			"source": "apache",
			"extensions": ["wmx"]
		},
		"video/x-ms-wvx": {
			"source": "apache",
			"extensions": ["wvx"]
		},
		"video/x-msvideo": {
			"source": "apache",
			"extensions": ["avi"]
		},
		"video/x-sgi-movie": {
			"source": "apache",
			"extensions": ["movie"]
		},
		"video/x-smv": {
			"source": "apache",
			"extensions": ["smv"]
		},
		"x-conference/x-cooltalk": {
			"source": "apache",
			"extensions": ["ice"]
		},
		"x-shader/x-fragment": { "compressible": true },
		"x-shader/x-vertex": { "compressible": true }
	};
}));
//#endregion
//#region node_modules/.pnpm/mime-db@1.52.0/node_modules/mime-db/index.js
var require_mime_db = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/*!
	* mime-db
	* Copyright(c) 2014 Jonathan Ong
	* Copyright(c) 2015-2022 Douglas Christopher Wilson
	* MIT Licensed
	*/
	/**
	* Module exports.
	*/
	module.exports = require_db();
}));
//#endregion
//#region node_modules/.pnpm/mime-types@2.1.35/node_modules/mime-types/index.js
/*!
* mime-types
* Copyright(c) 2014 Jonathan Ong
* Copyright(c) 2015 Douglas Christopher Wilson
* MIT Licensed
*/
var require_mime_types = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Module dependencies.
	* @private
	*/
	var db = require_mime_db();
	var extname$1 = __require("path").extname;
	/**
	* Module variables.
	* @private
	*/
	var EXTRACT_TYPE_REGEXP = /^\s*([^;\s]*)(?:;|\s|$)/;
	var TEXT_TYPE_REGEXP = /^text\//i;
	/**
	* Module exports.
	* @public
	*/
	exports.charset = charset;
	exports.charsets = { lookup: charset };
	exports.contentType = contentType;
	exports.extension = extension;
	exports.extensions = Object.create(null);
	exports.lookup = lookup;
	exports.types = Object.create(null);
	populateMaps(exports.extensions, exports.types);
	/**
	* Get the default charset for a MIME type.
	*
	* @param {string} type
	* @return {boolean|string}
	*/
	function charset(type) {
		if (!type || typeof type !== "string") return false;
		var match = EXTRACT_TYPE_REGEXP.exec(type);
		var mime = match && db[match[1].toLowerCase()];
		if (mime && mime.charset) return mime.charset;
		if (match && TEXT_TYPE_REGEXP.test(match[1])) return "UTF-8";
		return false;
	}
	/**
	* Create a full Content-Type header given a MIME type or extension.
	*
	* @param {string} str
	* @return {boolean|string}
	*/
	function contentType(str) {
		if (!str || typeof str !== "string") return false;
		var mime = str.indexOf("/") === -1 ? exports.lookup(str) : str;
		if (!mime) return false;
		if (mime.indexOf("charset") === -1) {
			var charset = exports.charset(mime);
			if (charset) mime += "; charset=" + charset.toLowerCase();
		}
		return mime;
	}
	/**
	* Get the default extension for a MIME type.
	*
	* @param {string} type
	* @return {boolean|string}
	*/
	function extension(type) {
		if (!type || typeof type !== "string") return false;
		var match = EXTRACT_TYPE_REGEXP.exec(type);
		var exts = match && exports.extensions[match[1].toLowerCase()];
		if (!exts || !exts.length) return false;
		return exts[0];
	}
	/**
	* Lookup the MIME type for a file path/extension.
	*
	* @param {string} path
	* @return {boolean|string}
	*/
	function lookup(path) {
		if (!path || typeof path !== "string") return false;
		var extension = extname$1("x." + path).toLowerCase().substr(1);
		if (!extension) return false;
		return exports.types[extension] || false;
	}
	/**
	* Populate the extensions and types maps.
	* @private
	*/
	function populateMaps(extensions, types) {
		var preference = [
			"nginx",
			"apache",
			void 0,
			"iana"
		];
		Object.keys(db).forEach(function forEachMimeType(type) {
			var mime = db[type];
			var exts = mime.extensions;
			if (!exts || !exts.length) return;
			extensions[type] = exts;
			for (var i = 0; i < exts.length; i++) {
				var extension = exts[i];
				if (types[extension]) {
					var from = preference.indexOf(db[types[extension]].source);
					var to = preference.indexOf(mime.source);
					if (types[extension] !== "application/octet-stream" && (from > to || from === to && types[extension].substr(0, 12) === "application/")) continue;
				}
				types[extension] = type;
			}
		});
	}
}));
//#endregion
//#region node_modules/.pnpm/asynckit@0.4.0/node_modules/asynckit/lib/defer.js
var require_defer = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = defer;
	/**
	* Runs provided function on next iteration of the event loop
	*
	* @param {function} fn - function to run
	*/
	function defer(fn) {
		var nextTick = typeof setImmediate == "function" ? setImmediate : typeof process == "object" && typeof process.nextTick == "function" ? process.nextTick : null;
		if (nextTick) nextTick(fn);
		else setTimeout(fn, 0);
	}
}));
//#endregion
//#region node_modules/.pnpm/asynckit@0.4.0/node_modules/asynckit/lib/async.js
var require_async = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var defer = require_defer();
	module.exports = async;
	/**
	* Runs provided callback asynchronously
	* even if callback itself is not
	*
	* @param   {function} callback - callback to invoke
	* @returns {function} - augmented callback
	*/
	function async(callback) {
		var isAsync = false;
		defer(function() {
			isAsync = true;
		});
		return function async_callback(err, result) {
			if (isAsync) callback(err, result);
			else defer(function nextTick_callback() {
				callback(err, result);
			});
		};
	}
}));
//#endregion
//#region node_modules/.pnpm/asynckit@0.4.0/node_modules/asynckit/lib/abort.js
var require_abort = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = abort;
	/**
	* Aborts leftover active jobs
	*
	* @param {object} state - current state object
	*/
	function abort(state) {
		Object.keys(state.jobs).forEach(clean.bind(state));
		state.jobs = {};
	}
	/**
	* Cleans up leftover job by invoking abort function for the provided job id
	*
	* @this  state
	* @param {string|number} key - job id to abort
	*/
	function clean(key) {
		if (typeof this.jobs[key] == "function") this.jobs[key]();
	}
}));
//#endregion
//#region node_modules/.pnpm/asynckit@0.4.0/node_modules/asynckit/lib/iterate.js
var require_iterate = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var async = require_async();
	var abort = require_abort();
	module.exports = iterate;
	/**
	* Iterates over each job object
	*
	* @param {array|object} list - array or object (named list) to iterate over
	* @param {function} iterator - iterator to run
	* @param {object} state - current job status
	* @param {function} callback - invoked when all elements processed
	*/
	function iterate(list, iterator, state, callback) {
		var key = state["keyedList"] ? state["keyedList"][state.index] : state.index;
		state.jobs[key] = runJob(iterator, key, list[key], function(error, output) {
			if (!(key in state.jobs)) return;
			delete state.jobs[key];
			if (error) abort(state);
			else state.results[key] = output;
			callback(error, state.results);
		});
	}
	/**
	* Runs iterator over provided job element
	*
	* @param   {function} iterator - iterator to invoke
	* @param   {string|number} key - key/index of the element in the list of jobs
	* @param   {mixed} item - job description
	* @param   {function} callback - invoked after iterator is done with the job
	* @returns {function|mixed} - job abort function or something else
	*/
	function runJob(iterator, key, item, callback) {
		var aborter;
		if (iterator.length == 2) aborter = iterator(item, async(callback));
		else aborter = iterator(item, key, async(callback));
		return aborter;
	}
}));
//#endregion
//#region node_modules/.pnpm/asynckit@0.4.0/node_modules/asynckit/lib/state.js
var require_state = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = state;
	/**
	* Creates initial state object
	* for iteration over list
	*
	* @param   {array|object} list - list to iterate over
	* @param   {function|null} sortMethod - function to use for keys sort,
	*                                     or `null` to keep them as is
	* @returns {object} - initial state object
	*/
	function state(list, sortMethod) {
		var isNamedList = !Array.isArray(list), initState = {
			index: 0,
			keyedList: isNamedList || sortMethod ? Object.keys(list) : null,
			jobs: {},
			results: isNamedList ? {} : [],
			size: isNamedList ? Object.keys(list).length : list.length
		};
		if (sortMethod) initState.keyedList.sort(isNamedList ? sortMethod : function(a, b) {
			return sortMethod(list[a], list[b]);
		});
		return initState;
	}
}));
//#endregion
//#region node_modules/.pnpm/asynckit@0.4.0/node_modules/asynckit/lib/terminator.js
var require_terminator = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var abort = require_abort();
	var async = require_async();
	module.exports = terminator;
	/**
	* Terminates jobs in the attached state context
	*
	* @this  AsyncKitState#
	* @param {function} callback - final callback to invoke after termination
	*/
	function terminator(callback) {
		if (!Object.keys(this.jobs).length) return;
		this.index = this.size;
		abort(this);
		async(callback)(null, this.results);
	}
}));
//#endregion
//#region node_modules/.pnpm/asynckit@0.4.0/node_modules/asynckit/parallel.js
var require_parallel = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var iterate = require_iterate();
	var initState = require_state();
	var terminator = require_terminator();
	module.exports = parallel;
	/**
	* Runs iterator over provided array elements in parallel
	*
	* @param   {array|object} list - array or object (named list) to iterate over
	* @param   {function} iterator - iterator to run
	* @param   {function} callback - invoked when all elements processed
	* @returns {function} - jobs terminator
	*/
	function parallel(list, iterator, callback) {
		var state = initState(list);
		while (state.index < (state["keyedList"] || list).length) {
			iterate(list, iterator, state, function(error, result) {
				if (error) {
					callback(error, result);
					return;
				}
				if (Object.keys(state.jobs).length === 0) {
					callback(null, state.results);
					return;
				}
			});
			state.index++;
		}
		return terminator.bind(state, callback);
	}
}));
//#endregion
//#region node_modules/.pnpm/asynckit@0.4.0/node_modules/asynckit/serialOrdered.js
var require_serialOrdered = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var iterate = require_iterate();
	var initState = require_state();
	var terminator = require_terminator();
	module.exports = serialOrdered;
	module.exports.ascending = ascending;
	module.exports.descending = descending;
	/**
	* Runs iterator over provided sorted array elements in series
	*
	* @param   {array|object} list - array or object (named list) to iterate over
	* @param   {function} iterator - iterator to run
	* @param   {function} sortMethod - custom sort function
	* @param   {function} callback - invoked when all elements processed
	* @returns {function} - jobs terminator
	*/
	function serialOrdered(list, iterator, sortMethod, callback) {
		var state = initState(list, sortMethod);
		iterate(list, iterator, state, function iteratorHandler(error, result) {
			if (error) {
				callback(error, result);
				return;
			}
			state.index++;
			if (state.index < (state["keyedList"] || list).length) {
				iterate(list, iterator, state, iteratorHandler);
				return;
			}
			callback(null, state.results);
		});
		return terminator.bind(state, callback);
	}
	/**
	* sort helper to sort array elements in ascending order
	*
	* @param   {mixed} a - an item to compare
	* @param   {mixed} b - an item to compare
	* @returns {number} - comparison result
	*/
	function ascending(a, b) {
		return a < b ? -1 : a > b ? 1 : 0;
	}
	/**
	* sort helper to sort array elements in descending order
	*
	* @param   {mixed} a - an item to compare
	* @param   {mixed} b - an item to compare
	* @returns {number} - comparison result
	*/
	function descending(a, b) {
		return -1 * ascending(a, b);
	}
}));
//#endregion
//#region node_modules/.pnpm/asynckit@0.4.0/node_modules/asynckit/serial.js
var require_serial = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var serialOrdered = require_serialOrdered();
	module.exports = serial;
	/**
	* Runs iterator over provided array elements in series
	*
	* @param   {array|object} list - array or object (named list) to iterate over
	* @param   {function} iterator - iterator to run
	* @param   {function} callback - invoked when all elements processed
	* @returns {function} - jobs terminator
	*/
	function serial(list, iterator, callback) {
		return serialOrdered(list, iterator, null, callback);
	}
}));
//#endregion
//#region node_modules/.pnpm/asynckit@0.4.0/node_modules/asynckit/index.js
var require_asynckit = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		parallel: require_parallel(),
		serial: require_serial(),
		serialOrdered: require_serialOrdered()
	};
}));
//#endregion
//#region node_modules/.pnpm/es-object-atoms@1.1.2/node_modules/es-object-atoms/index.js
var require_es_object_atoms = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('.')} */
	module.exports = Object;
}));
//#endregion
//#region node_modules/.pnpm/es-errors@1.3.0/node_modules/es-errors/index.js
var require_es_errors = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('.')} */
	module.exports = Error;
}));
//#endregion
//#region node_modules/.pnpm/es-errors@1.3.0/node_modules/es-errors/eval.js
var require_eval = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./eval')} */
	module.exports = EvalError;
}));
//#endregion
//#region node_modules/.pnpm/es-errors@1.3.0/node_modules/es-errors/range.js
var require_range = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./range')} */
	module.exports = RangeError;
}));
//#endregion
//#region node_modules/.pnpm/es-errors@1.3.0/node_modules/es-errors/ref.js
var require_ref = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./ref')} */
	module.exports = ReferenceError;
}));
//#endregion
//#region node_modules/.pnpm/es-errors@1.3.0/node_modules/es-errors/syntax.js
var require_syntax = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./syntax')} */
	module.exports = SyntaxError;
}));
//#endregion
//#region node_modules/.pnpm/es-errors@1.3.0/node_modules/es-errors/type.js
var require_type = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./type')} */
	module.exports = TypeError;
}));
//#endregion
//#region node_modules/.pnpm/es-errors@1.3.0/node_modules/es-errors/uri.js
var require_uri = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./uri')} */
	module.exports = URIError;
}));
//#endregion
//#region node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/abs.js
var require_abs = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./abs')} */
	module.exports = Math.abs;
}));
//#endregion
//#region node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/floor.js
var require_floor = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./floor')} */
	module.exports = Math.floor;
}));
//#endregion
//#region node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/max.js
var require_max = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./max')} */
	module.exports = Math.max;
}));
//#endregion
//#region node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/min.js
var require_min = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./min')} */
	module.exports = Math.min;
}));
//#endregion
//#region node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/pow.js
var require_pow = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./pow')} */
	module.exports = Math.pow;
}));
//#endregion
//#region node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/round.js
var require_round = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./round')} */
	module.exports = Math.round;
}));
//#endregion
//#region node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/isNaN.js
var require_isNaN = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./isNaN')} */
	module.exports = Number.isNaN || function isNaN(a) {
		return a !== a;
	};
}));
//#endregion
//#region node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/sign.js
var require_sign = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var $isNaN = require_isNaN();
	/** @type {import('./sign')} */
	module.exports = function sign(number) {
		if ($isNaN(number) || number === 0) return number;
		return number < 0 ? -1 : 1;
	};
}));
//#endregion
//#region node_modules/.pnpm/gopd@1.2.0/node_modules/gopd/gOPD.js
var require_gOPD = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./gOPD')} */
	module.exports = Object.getOwnPropertyDescriptor;
}));
//#endregion
//#region node_modules/.pnpm/gopd@1.2.0/node_modules/gopd/index.js
var require_gopd = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('.')} */
	var $gOPD = require_gOPD();
	if ($gOPD) try {
		$gOPD([], "length");
	} catch (e) {
		$gOPD = null;
	}
	module.exports = $gOPD;
}));
//#endregion
//#region node_modules/.pnpm/es-define-property@1.0.1/node_modules/es-define-property/index.js
var require_es_define_property = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('.')} */
	var $defineProperty = Object.defineProperty || false;
	if ($defineProperty) try {
		$defineProperty({}, "a", { value: 1 });
	} catch (e) {
		$defineProperty = false;
	}
	module.exports = $defineProperty;
}));
//#endregion
//#region node_modules/.pnpm/has-symbols@1.1.0/node_modules/has-symbols/shams.js
var require_shams$1 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./shams')} */
	module.exports = function hasSymbols() {
		if (typeof Symbol !== "function" || typeof Object.getOwnPropertySymbols !== "function") return false;
		if (typeof Symbol.iterator === "symbol") return true;
		/** @type {{ [k in symbol]?: unknown }} */
		var obj = {};
		var sym = Symbol("test");
		var symObj = Object(sym);
		if (typeof sym === "string") return false;
		if (Object.prototype.toString.call(sym) !== "[object Symbol]") return false;
		if (Object.prototype.toString.call(symObj) !== "[object Symbol]") return false;
		var symVal = 42;
		obj[sym] = symVal;
		for (var _ in obj) return false;
		if (typeof Object.keys === "function" && Object.keys(obj).length !== 0) return false;
		if (typeof Object.getOwnPropertyNames === "function" && Object.getOwnPropertyNames(obj).length !== 0) return false;
		var syms = Object.getOwnPropertySymbols(obj);
		if (syms.length !== 1 || syms[0] !== sym) return false;
		if (!Object.prototype.propertyIsEnumerable.call(obj, sym)) return false;
		if (typeof Object.getOwnPropertyDescriptor === "function") {
			var descriptor = Object.getOwnPropertyDescriptor(obj, sym);
			if (descriptor.value !== symVal || descriptor.enumerable !== true) return false;
		}
		return true;
	};
}));
//#endregion
//#region node_modules/.pnpm/has-symbols@1.1.0/node_modules/has-symbols/index.js
var require_has_symbols = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var origSymbol = typeof Symbol !== "undefined" && Symbol;
	var hasSymbolSham = require_shams$1();
	/** @type {import('.')} */
	module.exports = function hasNativeSymbols() {
		if (typeof origSymbol !== "function") return false;
		if (typeof Symbol !== "function") return false;
		if (typeof origSymbol("foo") !== "symbol") return false;
		if (typeof Symbol("bar") !== "symbol") return false;
		return hasSymbolSham();
	};
}));
//#endregion
//#region node_modules/.pnpm/get-proto@1.0.1/node_modules/get-proto/Reflect.getPrototypeOf.js
var require_Reflect_getPrototypeOf = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./Reflect.getPrototypeOf')} */
	module.exports = typeof Reflect !== "undefined" && Reflect.getPrototypeOf || null;
}));
//#endregion
//#region node_modules/.pnpm/get-proto@1.0.1/node_modules/get-proto/Object.getPrototypeOf.js
var require_Object_getPrototypeOf = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./Object.getPrototypeOf')} */
	module.exports = require_es_object_atoms().getPrototypeOf || null;
}));
//#endregion
//#region node_modules/.pnpm/function-bind@1.1.2/node_modules/function-bind/implementation.js
var require_implementation = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var ERROR_MESSAGE = "Function.prototype.bind called on incompatible ";
	var toStr = Object.prototype.toString;
	var max = Math.max;
	var funcType = "[object Function]";
	var concatty = function concatty(a, b) {
		var arr = [];
		for (var i = 0; i < a.length; i += 1) arr[i] = a[i];
		for (var j = 0; j < b.length; j += 1) arr[j + a.length] = b[j];
		return arr;
	};
	var slicy = function slicy(arrLike, offset) {
		var arr = [];
		for (var i = offset || 0, j = 0; i < arrLike.length; i += 1, j += 1) arr[j] = arrLike[i];
		return arr;
	};
	var joiny = function(arr, joiner) {
		var str = "";
		for (var i = 0; i < arr.length; i += 1) {
			str += arr[i];
			if (i + 1 < arr.length) str += joiner;
		}
		return str;
	};
	module.exports = function bind(that) {
		var target = this;
		if (typeof target !== "function" || toStr.apply(target) !== funcType) throw new TypeError(ERROR_MESSAGE + target);
		var args = slicy(arguments, 1);
		var bound;
		var binder = function() {
			if (this instanceof bound) {
				var result = target.apply(this, concatty(args, arguments));
				if (Object(result) === result) return result;
				return this;
			}
			return target.apply(that, concatty(args, arguments));
		};
		var boundLength = max(0, target.length - args.length);
		var boundArgs = [];
		for (var i = 0; i < boundLength; i++) boundArgs[i] = "$" + i;
		bound = Function("binder", "return function (" + joiny(boundArgs, ",") + "){ return binder.apply(this,arguments); }")(binder);
		if (target.prototype) {
			var Empty = function Empty() {};
			Empty.prototype = target.prototype;
			bound.prototype = new Empty();
			Empty.prototype = null;
		}
		return bound;
	};
}));
//#endregion
//#region node_modules/.pnpm/function-bind@1.1.2/node_modules/function-bind/index.js
var require_function_bind = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var implementation = require_implementation();
	module.exports = Function.prototype.bind || implementation;
}));
//#endregion
//#region node_modules/.pnpm/call-bind-apply-helpers@1.0.2/node_modules/call-bind-apply-helpers/functionCall.js
var require_functionCall = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./functionCall')} */
	module.exports = Function.prototype.call;
}));
//#endregion
//#region node_modules/.pnpm/call-bind-apply-helpers@1.0.2/node_modules/call-bind-apply-helpers/functionApply.js
var require_functionApply = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./functionApply')} */
	module.exports = Function.prototype.apply;
}));
//#endregion
//#region node_modules/.pnpm/call-bind-apply-helpers@1.0.2/node_modules/call-bind-apply-helpers/reflectApply.js
var require_reflectApply = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./reflectApply')} */
	module.exports = typeof Reflect !== "undefined" && Reflect && Reflect.apply;
}));
//#endregion
//#region node_modules/.pnpm/call-bind-apply-helpers@1.0.2/node_modules/call-bind-apply-helpers/actualApply.js
var require_actualApply = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var bind = require_function_bind();
	var $apply = require_functionApply();
	var $call = require_functionCall();
	/** @type {import('./actualApply')} */
	module.exports = require_reflectApply() || bind.call($call, $apply);
}));
//#endregion
//#region node_modules/.pnpm/call-bind-apply-helpers@1.0.2/node_modules/call-bind-apply-helpers/index.js
var require_call_bind_apply_helpers = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var bind = require_function_bind();
	var $TypeError = require_type();
	var $call = require_functionCall();
	var $actualApply = require_actualApply();
	/** @type {(args: [Function, thisArg?: unknown, ...args: unknown[]]) => Function} TODO FIXME, find a way to use import('.') */
	module.exports = function callBindBasic(args) {
		if (args.length < 1 || typeof args[0] !== "function") throw new $TypeError("a function is required");
		return $actualApply(bind, $call, args);
	};
}));
//#endregion
//#region node_modules/.pnpm/dunder-proto@1.0.1/node_modules/dunder-proto/get.js
var require_get = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var callBind = require_call_bind_apply_helpers();
	var gOPD = require_gopd();
	var hasProtoAccessor;
	try {
		hasProtoAccessor = [].__proto__ === Array.prototype;
	} catch (e) {
		if (!e || typeof e !== "object" || !("code" in e) || e.code !== "ERR_PROTO_ACCESS") throw e;
	}
	var desc = !!hasProtoAccessor && gOPD && gOPD(Object.prototype, "__proto__");
	var $Object = Object;
	var $getPrototypeOf = $Object.getPrototypeOf;
	/** @type {import('./get')} */
	module.exports = desc && typeof desc.get === "function" ? callBind([desc.get]) : typeof $getPrototypeOf === "function" ? function getDunder(value) {
		return $getPrototypeOf(value == null ? value : $Object(value));
	} : false;
}));
//#endregion
//#region node_modules/.pnpm/get-proto@1.0.1/node_modules/get-proto/index.js
var require_get_proto = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var reflectGetProto = require_Reflect_getPrototypeOf();
	var originalGetProto = require_Object_getPrototypeOf();
	var getDunderProto = require_get();
	/** @type {import('.')} */
	module.exports = reflectGetProto ? function getProto(O) {
		return reflectGetProto(O);
	} : originalGetProto ? function getProto(O) {
		if (!O || typeof O !== "object" && typeof O !== "function") throw new TypeError("getProto: not an object");
		return originalGetProto(O);
	} : getDunderProto ? function getProto(O) {
		return getDunderProto(O);
	} : null;
}));
//#endregion
//#region node_modules/.pnpm/hasown@2.0.4/node_modules/hasown/index.js
var require_hasown = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var call = Function.prototype.call;
	var $hasOwn = Object.prototype.hasOwnProperty;
	/** @type {import('.')} */
	module.exports = require_function_bind().call(call, $hasOwn);
}));
//#endregion
//#region node_modules/.pnpm/get-intrinsic@1.3.0/node_modules/get-intrinsic/index.js
var require_get_intrinsic = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var undefined;
	var $Object = require_es_object_atoms();
	var $Error = require_es_errors();
	var $EvalError = require_eval();
	var $RangeError = require_range();
	var $ReferenceError = require_ref();
	var $SyntaxError = require_syntax();
	var $TypeError = require_type();
	var $URIError = require_uri();
	var abs = require_abs();
	var floor = require_floor();
	var max = require_max();
	var min = require_min();
	var pow = require_pow();
	var round = require_round();
	var sign = require_sign();
	var $Function = Function;
	var getEvalledConstructor = function(expressionSyntax) {
		try {
			return $Function("\"use strict\"; return (" + expressionSyntax + ").constructor;")();
		} catch (e) {}
	};
	var $gOPD = require_gopd();
	var $defineProperty = require_es_define_property();
	var throwTypeError = function() {
		throw new $TypeError();
	};
	var ThrowTypeError = $gOPD ? function() {
		try {
			arguments.callee;
			return throwTypeError;
		} catch (calleeThrows) {
			try {
				return $gOPD(arguments, "callee").get;
			} catch (gOPDthrows) {
				return throwTypeError;
			}
		}
	}() : throwTypeError;
	var hasSymbols = require_has_symbols()();
	var getProto = require_get_proto();
	var $ObjectGPO = require_Object_getPrototypeOf();
	var $ReflectGPO = require_Reflect_getPrototypeOf();
	var $apply = require_functionApply();
	var $call = require_functionCall();
	var needsEval = {};
	var TypedArray = typeof Uint8Array === "undefined" || !getProto ? undefined : getProto(Uint8Array);
	var INTRINSICS = {
		__proto__: null,
		"%AggregateError%": typeof AggregateError === "undefined" ? undefined : AggregateError,
		"%Array%": Array,
		"%ArrayBuffer%": typeof ArrayBuffer === "undefined" ? undefined : ArrayBuffer,
		"%ArrayIteratorPrototype%": hasSymbols && getProto ? getProto([][Symbol.iterator]()) : undefined,
		"%AsyncFromSyncIteratorPrototype%": undefined,
		"%AsyncFunction%": needsEval,
		"%AsyncGenerator%": needsEval,
		"%AsyncGeneratorFunction%": needsEval,
		"%AsyncIteratorPrototype%": needsEval,
		"%Atomics%": typeof Atomics === "undefined" ? undefined : Atomics,
		"%BigInt%": typeof BigInt === "undefined" ? undefined : BigInt,
		"%BigInt64Array%": typeof BigInt64Array === "undefined" ? undefined : BigInt64Array,
		"%BigUint64Array%": typeof BigUint64Array === "undefined" ? undefined : BigUint64Array,
		"%Boolean%": Boolean,
		"%DataView%": typeof DataView === "undefined" ? undefined : DataView,
		"%Date%": Date,
		"%decodeURI%": decodeURI,
		"%decodeURIComponent%": decodeURIComponent,
		"%encodeURI%": encodeURI,
		"%encodeURIComponent%": encodeURIComponent,
		"%Error%": $Error,
		"%eval%": eval,
		"%EvalError%": $EvalError,
		"%Float16Array%": typeof Float16Array === "undefined" ? undefined : Float16Array,
		"%Float32Array%": typeof Float32Array === "undefined" ? undefined : Float32Array,
		"%Float64Array%": typeof Float64Array === "undefined" ? undefined : Float64Array,
		"%FinalizationRegistry%": typeof FinalizationRegistry === "undefined" ? undefined : FinalizationRegistry,
		"%Function%": $Function,
		"%GeneratorFunction%": needsEval,
		"%Int8Array%": typeof Int8Array === "undefined" ? undefined : Int8Array,
		"%Int16Array%": typeof Int16Array === "undefined" ? undefined : Int16Array,
		"%Int32Array%": typeof Int32Array === "undefined" ? undefined : Int32Array,
		"%isFinite%": isFinite,
		"%isNaN%": isNaN,
		"%IteratorPrototype%": hasSymbols && getProto ? getProto(getProto([][Symbol.iterator]())) : undefined,
		"%JSON%": typeof JSON === "object" ? JSON : undefined,
		"%Map%": typeof Map === "undefined" ? undefined : Map,
		"%MapIteratorPrototype%": typeof Map === "undefined" || !hasSymbols || !getProto ? undefined : getProto((/* @__PURE__ */ new Map())[Symbol.iterator]()),
		"%Math%": Math,
		"%Number%": Number,
		"%Object%": $Object,
		"%Object.getOwnPropertyDescriptor%": $gOPD,
		"%parseFloat%": parseFloat,
		"%parseInt%": parseInt,
		"%Promise%": typeof Promise === "undefined" ? undefined : Promise,
		"%Proxy%": typeof Proxy === "undefined" ? undefined : Proxy,
		"%RangeError%": $RangeError,
		"%ReferenceError%": $ReferenceError,
		"%Reflect%": typeof Reflect === "undefined" ? undefined : Reflect,
		"%RegExp%": RegExp,
		"%Set%": typeof Set === "undefined" ? undefined : Set,
		"%SetIteratorPrototype%": typeof Set === "undefined" || !hasSymbols || !getProto ? undefined : getProto((/* @__PURE__ */ new Set())[Symbol.iterator]()),
		"%SharedArrayBuffer%": typeof SharedArrayBuffer === "undefined" ? undefined : SharedArrayBuffer,
		"%String%": String,
		"%StringIteratorPrototype%": hasSymbols && getProto ? getProto(""[Symbol.iterator]()) : undefined,
		"%Symbol%": hasSymbols ? Symbol : undefined,
		"%SyntaxError%": $SyntaxError,
		"%ThrowTypeError%": ThrowTypeError,
		"%TypedArray%": TypedArray,
		"%TypeError%": $TypeError,
		"%Uint8Array%": typeof Uint8Array === "undefined" ? undefined : Uint8Array,
		"%Uint8ClampedArray%": typeof Uint8ClampedArray === "undefined" ? undefined : Uint8ClampedArray,
		"%Uint16Array%": typeof Uint16Array === "undefined" ? undefined : Uint16Array,
		"%Uint32Array%": typeof Uint32Array === "undefined" ? undefined : Uint32Array,
		"%URIError%": $URIError,
		"%WeakMap%": typeof WeakMap === "undefined" ? undefined : WeakMap,
		"%WeakRef%": typeof WeakRef === "undefined" ? undefined : WeakRef,
		"%WeakSet%": typeof WeakSet === "undefined" ? undefined : WeakSet,
		"%Function.prototype.call%": $call,
		"%Function.prototype.apply%": $apply,
		"%Object.defineProperty%": $defineProperty,
		"%Object.getPrototypeOf%": $ObjectGPO,
		"%Math.abs%": abs,
		"%Math.floor%": floor,
		"%Math.max%": max,
		"%Math.min%": min,
		"%Math.pow%": pow,
		"%Math.round%": round,
		"%Math.sign%": sign,
		"%Reflect.getPrototypeOf%": $ReflectGPO
	};
	if (getProto) try {
		null.error;
	} catch (e) {
		INTRINSICS["%Error.prototype%"] = getProto(getProto(e));
	}
	var doEval = function doEval(name) {
		var value;
		if (name === "%AsyncFunction%") value = getEvalledConstructor("async function () {}");
		else if (name === "%GeneratorFunction%") value = getEvalledConstructor("function* () {}");
		else if (name === "%AsyncGeneratorFunction%") value = getEvalledConstructor("async function* () {}");
		else if (name === "%AsyncGenerator%") {
			var fn = doEval("%AsyncGeneratorFunction%");
			if (fn) value = fn.prototype;
		} else if (name === "%AsyncIteratorPrototype%") {
			var gen = doEval("%AsyncGenerator%");
			if (gen && getProto) value = getProto(gen.prototype);
		}
		INTRINSICS[name] = value;
		return value;
	};
	var LEGACY_ALIASES = {
		__proto__: null,
		"%ArrayBufferPrototype%": ["ArrayBuffer", "prototype"],
		"%ArrayPrototype%": ["Array", "prototype"],
		"%ArrayProto_entries%": [
			"Array",
			"prototype",
			"entries"
		],
		"%ArrayProto_forEach%": [
			"Array",
			"prototype",
			"forEach"
		],
		"%ArrayProto_keys%": [
			"Array",
			"prototype",
			"keys"
		],
		"%ArrayProto_values%": [
			"Array",
			"prototype",
			"values"
		],
		"%AsyncFunctionPrototype%": ["AsyncFunction", "prototype"],
		"%AsyncGenerator%": ["AsyncGeneratorFunction", "prototype"],
		"%AsyncGeneratorPrototype%": [
			"AsyncGeneratorFunction",
			"prototype",
			"prototype"
		],
		"%BooleanPrototype%": ["Boolean", "prototype"],
		"%DataViewPrototype%": ["DataView", "prototype"],
		"%DatePrototype%": ["Date", "prototype"],
		"%ErrorPrototype%": ["Error", "prototype"],
		"%EvalErrorPrototype%": ["EvalError", "prototype"],
		"%Float32ArrayPrototype%": ["Float32Array", "prototype"],
		"%Float64ArrayPrototype%": ["Float64Array", "prototype"],
		"%FunctionPrototype%": ["Function", "prototype"],
		"%Generator%": ["GeneratorFunction", "prototype"],
		"%GeneratorPrototype%": [
			"GeneratorFunction",
			"prototype",
			"prototype"
		],
		"%Int8ArrayPrototype%": ["Int8Array", "prototype"],
		"%Int16ArrayPrototype%": ["Int16Array", "prototype"],
		"%Int32ArrayPrototype%": ["Int32Array", "prototype"],
		"%JSONParse%": ["JSON", "parse"],
		"%JSONStringify%": ["JSON", "stringify"],
		"%MapPrototype%": ["Map", "prototype"],
		"%NumberPrototype%": ["Number", "prototype"],
		"%ObjectPrototype%": ["Object", "prototype"],
		"%ObjProto_toString%": [
			"Object",
			"prototype",
			"toString"
		],
		"%ObjProto_valueOf%": [
			"Object",
			"prototype",
			"valueOf"
		],
		"%PromisePrototype%": ["Promise", "prototype"],
		"%PromiseProto_then%": [
			"Promise",
			"prototype",
			"then"
		],
		"%Promise_all%": ["Promise", "all"],
		"%Promise_reject%": ["Promise", "reject"],
		"%Promise_resolve%": ["Promise", "resolve"],
		"%RangeErrorPrototype%": ["RangeError", "prototype"],
		"%ReferenceErrorPrototype%": ["ReferenceError", "prototype"],
		"%RegExpPrototype%": ["RegExp", "prototype"],
		"%SetPrototype%": ["Set", "prototype"],
		"%SharedArrayBufferPrototype%": ["SharedArrayBuffer", "prototype"],
		"%StringPrototype%": ["String", "prototype"],
		"%SymbolPrototype%": ["Symbol", "prototype"],
		"%SyntaxErrorPrototype%": ["SyntaxError", "prototype"],
		"%TypedArrayPrototype%": ["TypedArray", "prototype"],
		"%TypeErrorPrototype%": ["TypeError", "prototype"],
		"%Uint8ArrayPrototype%": ["Uint8Array", "prototype"],
		"%Uint8ClampedArrayPrototype%": ["Uint8ClampedArray", "prototype"],
		"%Uint16ArrayPrototype%": ["Uint16Array", "prototype"],
		"%Uint32ArrayPrototype%": ["Uint32Array", "prototype"],
		"%URIErrorPrototype%": ["URIError", "prototype"],
		"%WeakMapPrototype%": ["WeakMap", "prototype"],
		"%WeakSetPrototype%": ["WeakSet", "prototype"]
	};
	var bind = require_function_bind();
	var hasOwn = require_hasown();
	var $concat = bind.call($call, Array.prototype.concat);
	var $spliceApply = bind.call($apply, Array.prototype.splice);
	var $replace = bind.call($call, String.prototype.replace);
	var $strSlice = bind.call($call, String.prototype.slice);
	var $exec = bind.call($call, RegExp.prototype.exec);
	var rePropName = /[^%.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|%$))/g;
	var reEscapeChar = /\\(\\)?/g;
	var stringToPath = function stringToPath(string) {
		var first = $strSlice(string, 0, 1);
		var last = $strSlice(string, -1);
		if (first === "%" && last !== "%") throw new $SyntaxError("invalid intrinsic syntax, expected closing `%`");
		else if (last === "%" && first !== "%") throw new $SyntaxError("invalid intrinsic syntax, expected opening `%`");
		var result = [];
		$replace(string, rePropName, function(match, number, quote, subString) {
			result[result.length] = quote ? $replace(subString, reEscapeChar, "$1") : number || match;
		});
		return result;
	};
	var getBaseIntrinsic = function getBaseIntrinsic(name, allowMissing) {
		var intrinsicName = name;
		var alias;
		if (hasOwn(LEGACY_ALIASES, intrinsicName)) {
			alias = LEGACY_ALIASES[intrinsicName];
			intrinsicName = "%" + alias[0] + "%";
		}
		if (hasOwn(INTRINSICS, intrinsicName)) {
			var value = INTRINSICS[intrinsicName];
			if (value === needsEval) value = doEval(intrinsicName);
			if (typeof value === "undefined" && !allowMissing) throw new $TypeError("intrinsic " + name + " exists, but is not available. Please file an issue!");
			return {
				alias,
				name: intrinsicName,
				value
			};
		}
		throw new $SyntaxError("intrinsic " + name + " does not exist!");
	};
	module.exports = function GetIntrinsic(name, allowMissing) {
		if (typeof name !== "string" || name.length === 0) throw new $TypeError("intrinsic name must be a non-empty string");
		if (arguments.length > 1 && typeof allowMissing !== "boolean") throw new $TypeError("\"allowMissing\" argument must be a boolean");
		if ($exec(/^%?[^%]*%?$/, name) === null) throw new $SyntaxError("`%` may not be present anywhere but at the beginning and end of the intrinsic name");
		var parts = stringToPath(name);
		var intrinsicBaseName = parts.length > 0 ? parts[0] : "";
		var intrinsic = getBaseIntrinsic("%" + intrinsicBaseName + "%", allowMissing);
		var intrinsicRealName = intrinsic.name;
		var value = intrinsic.value;
		var skipFurtherCaching = false;
		var alias = intrinsic.alias;
		if (alias) {
			intrinsicBaseName = alias[0];
			$spliceApply(parts, $concat([0, 1], alias));
		}
		for (var i = 1, isOwn = true; i < parts.length; i += 1) {
			var part = parts[i];
			var first = $strSlice(part, 0, 1);
			var last = $strSlice(part, -1);
			if ((first === "\"" || first === "'" || first === "`" || last === "\"" || last === "'" || last === "`") && first !== last) throw new $SyntaxError("property names with quotes must have matching quotes");
			if (part === "constructor" || !isOwn) skipFurtherCaching = true;
			intrinsicBaseName += "." + part;
			intrinsicRealName = "%" + intrinsicBaseName + "%";
			if (hasOwn(INTRINSICS, intrinsicRealName)) value = INTRINSICS[intrinsicRealName];
			else if (value != null) {
				if (!(part in value)) {
					if (!allowMissing) throw new $TypeError("base intrinsic for " + name + " exists, but the property is not available.");
					return;
				}
				if ($gOPD && i + 1 >= parts.length) {
					var desc = $gOPD(value, part);
					isOwn = !!desc;
					if (isOwn && "get" in desc && !("originalValue" in desc.get)) value = desc.get;
					else value = value[part];
				} else {
					isOwn = hasOwn(value, part);
					value = value[part];
				}
				if (isOwn && !skipFurtherCaching) INTRINSICS[intrinsicRealName] = value;
			}
		}
		return value;
	};
}));
//#endregion
//#region node_modules/.pnpm/has-tostringtag@1.0.2/node_modules/has-tostringtag/shams.js
var require_shams = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var hasSymbols = require_shams$1();
	/** @type {import('.')} */
	module.exports = function hasToStringTagShams() {
		return hasSymbols() && !!Symbol.toStringTag;
	};
}));
//#endregion
//#region node_modules/.pnpm/es-set-tostringtag@2.1.0/node_modules/es-set-tostringtag/index.js
var require_es_set_tostringtag = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var $defineProperty = require_get_intrinsic()("%Object.defineProperty%", true);
	var hasToStringTag = require_shams()();
	var hasOwn = require_hasown();
	var $TypeError = require_type();
	var toStringTag = hasToStringTag ? Symbol.toStringTag : null;
	/** @type {import('.')} */
	module.exports = function setToStringTag(object, value) {
		var overrideIfSet = arguments.length > 2 && !!arguments[2] && arguments[2].force;
		var nonConfigurable = arguments.length > 2 && !!arguments[2] && arguments[2].nonConfigurable;
		if (typeof overrideIfSet !== "undefined" && typeof overrideIfSet !== "boolean" || typeof nonConfigurable !== "undefined" && typeof nonConfigurable !== "boolean") throw new $TypeError("if provided, the `overrideIfSet` and `nonConfigurable` options must be booleans");
		if (toStringTag && (overrideIfSet || !hasOwn(object, toStringTag))) {
			if ($defineProperty) $defineProperty(object, toStringTag, {
				configurable: !nonConfigurable,
				enumerable: false,
				value,
				writable: false
			});
			else object[toStringTag] = value;
		}
	};
}));
//#endregion
//#region node_modules/.pnpm/form-data@4.0.6/node_modules/form-data/lib/populate.js
var require_populate = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = function(dst, src) {
		Object.keys(src).forEach(function(prop) {
			dst[prop] = dst[prop] || src[prop];
		});
		return dst;
	};
}));
//#endregion
//#region src/providers/retry.ts
var import_form_data = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
	var CombinedStream = require_combined_stream();
	var util$2 = __require("util");
	var path = __require("path");
	var http = __require("http");
	var https = __require("https");
	var parseUrl = __require("url").parse;
	var fs$2 = __require("fs");
	var Stream = __require("stream").Stream;
	var crypto = __require("crypto");
	var mime = require_mime_types();
	var asynckit = require_asynckit();
	var setToStringTag = require_es_set_tostringtag();
	var hasOwn = require_hasown();
	var populate = require_populate();
	/**
	* Escape CR, LF, and `"` in a multipart `name`/`filename` parameter, so a field
	* name or filename can not break out of its header line to inject headers or
	* smuggle additional parts. Matches the WHATWG HTML multipart/form-data encoding.
	*
	* @param {string} str - the parameter value to escape
	* @returns {string} the escaped value
	*/
	function escapeHeaderParam(str) {
		return String(str).replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/"/g, "%22");
	}
	/**
	* Create readable "multipart/form-data" streams.
	* Can be used to submit forms
	* and file uploads to other web applications.
	*
	* @constructor
	* @param {object} options - Properties to be added/overriden for FormData and CombinedStream
	*/
	function FormData(options) {
		if (!(this instanceof FormData)) return new FormData(options);
		this._overheadLength = 0;
		this._valueLength = 0;
		this._valuesToMeasure = [];
		CombinedStream.call(this);
		options = options || {};
		for (var option in options) this[option] = options[option];
	}
	util$2.inherits(FormData, CombinedStream);
	FormData.LINE_BREAK = "\r\n";
	FormData.DEFAULT_CONTENT_TYPE = "application/octet-stream";
	FormData.prototype.append = function(field, value, options) {
		options = options || {};
		if (typeof options === "string") options = { filename: options };
		var append = CombinedStream.prototype.append.bind(this);
		if (typeof value === "number" || value == null) value = String(value);
		if (Array.isArray(value)) {
			this._error(/* @__PURE__ */ new Error("Arrays are not supported."));
			return;
		}
		var header = this._multiPartHeader(field, value, options);
		var footer = this._multiPartFooter();
		append(header);
		append(value);
		append(footer);
		this._trackLength(header, value, options);
	};
	FormData.prototype._trackLength = function(header, value, options) {
		var valueLength = 0;
		if (options.knownLength != null) valueLength += Number(options.knownLength);
		else if (Buffer.isBuffer(value)) valueLength = value.length;
		else if (typeof value === "string") valueLength = Buffer.byteLength(value);
		this._valueLength += valueLength;
		this._overheadLength += Buffer.byteLength(header) + FormData.LINE_BREAK.length;
		if (!value || !value.path && !(value.readable && hasOwn(value, "httpVersion")) && !(value instanceof Stream)) return;
		if (!options.knownLength) this._valuesToMeasure.push(value);
	};
	FormData.prototype._lengthRetriever = function(value, callback) {
		if (hasOwn(value, "fd")) {
			if (value.end != void 0 && value.end != Infinity && value.start != void 0) callback(null, value.end + 1 - (value.start ? value.start : 0));
			else fs$2.stat(value.path, function(err, stat) {
				if (err) {
					callback(err);
					return;
				}
				callback(null, stat.size - (value.start ? value.start : 0));
			});
		} else if (hasOwn(value, "httpVersion")) callback(null, Number(value.headers["content-length"]));
		else if (hasOwn(value, "httpModule")) {
			value.on("response", function(response) {
				value.pause();
				callback(null, Number(response.headers["content-length"]));
			});
			value.resume();
		} else callback("Unknown stream");
	};
	FormData.prototype._multiPartHeader = function(field, value, options) {
		if (typeof options.header === "string") return options.header;
		var contentDisposition = this._getContentDisposition(value, options);
		var contentType = this._getContentType(value, options);
		var contents = "";
		var headers = {
			"Content-Disposition": ["form-data", "name=\"" + escapeHeaderParam(field) + "\""].concat(contentDisposition || []),
			"Content-Type": [].concat(contentType || [])
		};
		if (typeof options.header === "object") populate(headers, options.header);
		var header;
		for (var prop in headers) if (hasOwn(headers, prop)) {
			header = headers[prop];
			if (header == null) continue;
			if (!Array.isArray(header)) header = [header];
			if (header.length) contents += prop + ": " + header.join("; ") + FormData.LINE_BREAK;
		}
		return "--" + this.getBoundary() + FormData.LINE_BREAK + contents + FormData.LINE_BREAK;
	};
	FormData.prototype._getContentDisposition = function(value, options) {
		var filename;
		if (typeof options.filepath === "string") filename = path.normalize(options.filepath).replace(/\\/g, "/");
		else if (options.filename || value && (value.name || value.path)) filename = path.basename(options.filename || value && (value.name || value.path));
		else if (value && value.readable && hasOwn(value, "httpVersion")) filename = path.basename(value.client._httpMessage.path || "");
		if (filename) return "filename=\"" + escapeHeaderParam(filename) + "\"";
	};
	FormData.prototype._getContentType = function(value, options) {
		var contentType = options.contentType;
		if (!contentType && value && value.name) contentType = mime.lookup(value.name);
		if (!contentType && value && value.path) contentType = mime.lookup(value.path);
		if (!contentType && value && value.readable && hasOwn(value, "httpVersion")) contentType = value.headers["content-type"];
		if (!contentType && (options.filepath || options.filename)) contentType = mime.lookup(options.filepath || options.filename);
		if (!contentType && value && typeof value === "object") contentType = FormData.DEFAULT_CONTENT_TYPE;
		return contentType;
	};
	FormData.prototype._multiPartFooter = function() {
		return function(next) {
			var footer = FormData.LINE_BREAK;
			if (this._streams.length === 0) footer += this._lastBoundary();
			next(footer);
		}.bind(this);
	};
	FormData.prototype._lastBoundary = function() {
		return "--" + this.getBoundary() + "--" + FormData.LINE_BREAK;
	};
	FormData.prototype.getHeaders = function(userHeaders) {
		var header;
		var formHeaders = { "content-type": "multipart/form-data; boundary=" + this.getBoundary() };
		for (header in userHeaders) if (hasOwn(userHeaders, header)) formHeaders[header.toLowerCase()] = userHeaders[header];
		return formHeaders;
	};
	FormData.prototype.setBoundary = function(boundary) {
		if (typeof boundary !== "string") throw new TypeError("FormData boundary must be a string");
		this._boundary = boundary;
	};
	FormData.prototype.getBoundary = function() {
		if (!this._boundary) this._generateBoundary();
		return this._boundary;
	};
	FormData.prototype.getBuffer = function() {
		var dataBuffer = new Buffer.alloc(0);
		var boundary = this.getBoundary();
		for (var i = 0, len = this._streams.length; i < len; i++) if (typeof this._streams[i] !== "function") {
			if (Buffer.isBuffer(this._streams[i])) dataBuffer = Buffer.concat([dataBuffer, this._streams[i]]);
			else dataBuffer = Buffer.concat([dataBuffer, Buffer.from(this._streams[i])]);
			if (typeof this._streams[i] !== "string" || this._streams[i].substring(2, boundary.length + 2) !== boundary) dataBuffer = Buffer.concat([dataBuffer, Buffer.from(FormData.LINE_BREAK)]);
		}
		return Buffer.concat([dataBuffer, Buffer.from(this._lastBoundary())]);
	};
	FormData.prototype._generateBoundary = function() {
		this._boundary = "--------------------------" + crypto.randomBytes(12).toString("hex");
	};
	FormData.prototype.getLengthSync = function() {
		var knownLength = this._overheadLength + this._valueLength;
		if (this._streams.length) knownLength += this._lastBoundary().length;
		if (!this.hasKnownLength()) this._error(/* @__PURE__ */ new Error("Cannot calculate proper length in synchronous way."));
		return knownLength;
	};
	FormData.prototype.hasKnownLength = function() {
		var hasKnownLength = true;
		if (this._valuesToMeasure.length) hasKnownLength = false;
		return hasKnownLength;
	};
	FormData.prototype.getLength = function(cb) {
		var knownLength = this._overheadLength + this._valueLength;
		if (this._streams.length) knownLength += this._lastBoundary().length;
		if (!this._valuesToMeasure.length) {
			process.nextTick(cb.bind(this, null, knownLength));
			return;
		}
		asynckit.parallel(this._valuesToMeasure, this._lengthRetriever, function(err, values) {
			if (err) {
				cb(err);
				return;
			}
			values.forEach(function(length) {
				knownLength += length;
			});
			cb(null, knownLength);
		});
	};
	FormData.prototype.submit = function(params, cb) {
		var request;
		var options;
		var defaults = { method: "post" };
		if (typeof params === "string") {
			params = parseUrl(params);
			options = populate({
				port: params.port,
				path: params.pathname,
				host: params.hostname,
				protocol: params.protocol
			}, defaults);
		} else {
			options = populate(params, defaults);
			if (!options.port) options.port = options.protocol === "https:" ? 443 : 80;
		}
		options.headers = this.getHeaders(params.headers);
		if (options.protocol === "https:") request = https.request(options);
		else request = http.request(options);
		this.getLength(function(err, length) {
			if (err && err !== "Unknown stream") {
				this._error(err);
				return;
			}
			if (length) request.setHeader("Content-Length", length);
			this.pipe(request);
			if (cb) {
				var onResponse;
				var callback = function(error, responce) {
					request.removeListener("error", callback);
					request.removeListener("response", onResponse);
					return cb.call(this, error, responce);
				};
				onResponse = callback.bind(this, null);
				request.on("error", callback);
				request.on("response", onResponse);
			}
		}.bind(this));
		return request;
	};
	FormData.prototype._error = function(err) {
		if (!this.error) {
			this.error = err;
			this.pause();
			this.emit("error", err);
		}
	};
	FormData.prototype.toString = function() {
		return "[object FormData]";
	};
	setToStringTag(FormData.prototype, "FormData");
	module.exports = FormData;
})))(), 1);
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
* Abort-aware delay utility.
* Cleans up its timer listener immediately when aborted or resolved.
*/
async function defaultSleep(ms, signal) {
	if (ms <= 0) return;
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		let timer;
		const onAbort = () => {
			if (timer !== void 0) clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
		};
		timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
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
	constructor(config, options) {
		asProviderConfigId(config.id);
		this.config = config;
		this.retryOptions = options?.retry ?? {};
		this.parsedBaseUrl = validateAndNormalizeBaseURL(config.baseURL, config.allowInsecureHttp);
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
		for (const source of sources) {
			context.signal.throwIfAborted();
			let currentStat;
			try {
				currentStat = await stat(source.path);
			} catch (err) {
				throw new MinerUError(failure("FILE_NOT_FOUND", `Source file missing before upload: ${source.name}`), { cause: err });
			}
			if (currentStat.size !== source.fingerprint.size || currentStat.mtimeMs !== source.fingerprint.mtimeMs || currentStat.dev !== source.fingerprint.device || currentStat.ino !== source.fingerprint.inode) throw new MinerUError(failure("INVALID_REQUEST", `Source file ${source.name} changed before upload`, true));
		}
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
		const form = new import_form_data.default();
		const sourceStreams = sources.map((source) => createReadStream(source.path));
		const onAbort = () => {
			for (const stream of sourceStreams) stream.destroy(new DOMException("Aborted", "AbortError"));
		};
		context.signal.addEventListener("abort", onAbort, { once: true });
		for (const [index, source] of sources.entries()) {
			const stream = sourceStreams[index];
			if (stream === void 0) throw new TypeError("source stream index mismatch");
			form.append("files", stream, {
				filename: source.name,
				knownLength: source.bytes
			});
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
		const formHeaders = form.getHeaders();
		const pass = new PassThrough();
		form.on("error", (err) => pass.destroy(err));
		form.pipe(pass);
		let data;
		try {
			data = await this.requestJson("POST", "/tasks", pass, formHeaders, context, [200, 202], {
				operation: "submit",
				retry: false
			});
		} finally {
			context.signal.removeEventListener("abort", onAbort);
			for (const stream of sourceStreams) stream.destroy();
		}
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
	async requestJson(method, path, bodyStream, headers, context, acceptedStatuses = [200], options) {
		const allowRetry = options?.retry ?? method.toUpperCase() === "GET";
		const operation = options?.operation ?? (path.startsWith("/health") ? "probe" : "api-json");
		const executeOnce = async () => {
			context.signal.throwIfAborted();
			const url = `${this.parsedBaseUrl.origin}${this.parsedBaseUrl.pathname.replace(/\/+$/, "")}${path}`;
			const controller = new AbortController();
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				controller.abort(new DOMException(`Request timed out after ${context.timeoutMs}ms`, "TimeoutError"));
			}, context.timeoutMs);
			const onParentAbort = () => {
				controller.abort(context.signal.reason);
			};
			context.signal.addEventListener("abort", onParentAbort, { once: true });
			try {
				const requestHeaders = { ...headers };
				if (context.credential && context.credential.trim() !== "") requestHeaders["authorization"] = `Bearer ${context.credential}`;
				let response;
				try {
					const body = bodyStream !== void 0 ? Readable.toWeb(bodyStream) : void 0;
					const requestInit = {
						method,
						headers: requestHeaders,
						body,
						signal: controller.signal,
						redirect: "error",
						...body !== void 0 ? { duplex: "half" } : {}
					};
					response = await fetch(url, requestInit);
				} catch (err) {
					if (context.signal.aborted) throw new MinerUError(failure("CANCELLED", "Operation was cancelled", true));
					if (timedOut) {
						const timeoutErr = new MinerUError(failure("PROVIDER_UNAVAILABLE", `Request to MinerU server timed out after ${context.timeoutMs}ms`, true));
						Object.assign(timeoutErr, { httpStatus: 408 });
						throw timeoutErr;
					}
					throw new MinerUError(failure("PROVIDER_UNAVAILABLE", `Failed to connect to MinerU server: ${sanitizeDiagnostic(err instanceof Error ? err.message : String(err))}`, true), { cause: err });
				}
				const status = response.status;
				if (!acceptedStatuses.includes(status)) {
					let errorBody = "";
					try {
						errorBody = await readBoundedResponseText(response, context.limits.maxApiResponseBytes, controller.signal);
					} catch {
						if (response.body) try {
							await response.body.cancel();
						} catch {}
					}
					let parsedError;
					try {
						const parsed = JSON.parse(errorBody);
						if (typeof parsed === "object" && parsed !== null) {
							const json = parsed;
							if (typeof json.detail === "string") parsedError = json.detail;
							else if (typeof json.message === "string") parsedError = json.message;
							else if (typeof json.error === "string") parsedError = json.error;
						}
					} catch {
						parsedError = errorBody.slice(0, 500);
					}
					const diagnostic = parsedError ? `: ${sanitizeDiagnostic(parsedError, [context.credential ?? ""])}` : "";
					const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
					let err;
					if (status === 401 || status === 403) err = new MinerUError(failure("AUTHENTICATION_FAILED", `Authentication failed (${status})${diagnostic}`, false, { provider: "self-hosted-v2" }));
					else if (status === 404) err = new MinerUError(failure("JOB_NOT_FOUND", `Resource not found (${status})${diagnostic}`, false, { provider: "self-hosted-v2" }));
					else if (status === 413) err = new MinerUError(failure("FILE_TOO_LARGE", `Uploaded file is too large (${status})${diagnostic}`, false, { provider: "self-hosted-v2" }));
					else if (status === 429) err = new MinerUError(failure("PROVIDER_RATE_LIMITED", `Provider rate limit exceeded (${status})${diagnostic}`, true, { provider: "self-hosted-v2" }));
					else if (status === 408) err = new MinerUError(failure("PROVIDER_UNAVAILABLE", `MinerU server request timeout (${status})${diagnostic}`, true, { provider: "self-hosted-v2" }));
					else if (status >= 500) err = new MinerUError(failure("PROVIDER_UNAVAILABLE", `MinerU server error (${status})${diagnostic}`, true, { provider: "self-hosted-v2" }));
					else err = new MinerUError(failure("REMOTE_PARSE_FAILED", `MinerU returned unexpected status ${status}${diagnostic}`, false, { provider: "self-hosted-v2" }));
					Object.assign(err, {
						httpStatus: status,
						retryAfterMs
					});
					throw err;
				}
				const contentType = response.headers.get("content-type") ?? "";
				if (!contentType.toLowerCase().includes("application/json")) {
					if (response.body) try {
						await response.body.cancel();
					} catch {}
					throw new MinerUError(failure("REMOTE_PARSE_FAILED", `Expected application/json response, got ${contentType || "unknown"}`));
				}
				const rawText = await readBoundedResponseText(response, context.limits.maxApiResponseBytes, controller.signal);
				try {
					const parsed = JSON.parse(rawText);
					if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new MinerUError(failure("REMOTE_PARSE_FAILED", "MinerU response must be an object", false, { provider: "self-hosted-v2" }));
					return parsed;
				} catch (err) {
					if (err instanceof MinerUError) throw err;
					throw new MinerUError(failure("REMOTE_PARSE_FAILED", `Failed to parse JSON response: ${sanitizeDiagnostic(err instanceof Error ? err.message : String(err))}`), { cause: err });
				}
			} finally {
				clearTimeout(timer);
				context.signal.removeEventListener("abort", onParentAbort);
				if (bodyStream !== void 0 && !bodyStream.destroyed) bodyStream.destroy();
			}
		};
		if (!allowRetry) return await executeOnce();
		return await executeWithRetry({
			provider: "self-hosted-v2",
			operation,
			signal: context.signal,
			retryOptions: mergeRetryOptions(this.retryOptions, context.retry),
			fn: executeOnce
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
	var PassThrough$1 = __require("stream").PassThrough;
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
			var emptyStream = new PassThrough$1();
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
	util.inherits(RefUnrefFilter, PassThrough$1);
	function RefUnrefFilter(context) {
		PassThrough$1.call(this);
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
const MAX_JSON_NESTING_DEPTH = 256;
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
var StreamingJsonValidator = class {
	stack = [];
	rootExpect = "value";
	token;
	fail(message) {
		throw new TypeError(message);
	}
	currentExpectation() {
		const frame = this.stack.at(-1);
		return frame === void 0 ? this.rootExpect === "value" ? "root-value" : "root-end" : frame.expect;
	}
	completeValue() {
		const frame = this.stack.at(-1);
		if (frame === void 0) {
			if (this.rootExpect !== "value") this.fail("JSON contains multiple root values");
			this.rootExpect = "end";
			return;
		}
		if (frame.expect !== "value" && frame.expect !== "value-or-end") this.fail("JSON value appears in an invalid position");
		frame.expect = "comma-or-end";
	}
	startValue(char) {
		if (char === "{" || char === "[") {
			if (this.stack.length >= MAX_JSON_NESTING_DEPTH) this.fail("JSON nesting depth exceeds the validation limit");
			this.stack.push(char === "{" ? {
				kind: "object",
				expect: "key-or-end"
			} : {
				kind: "array",
				expect: "value-or-end"
			});
			return;
		}
		if (char === "\"") {
			this.token = {
				kind: "string",
				purpose: "value",
				escaped: false,
				unicodeRemaining: 0
			};
			return;
		}
		if (char === "t" || char === "f" || char === "n") {
			const value = char === "t" ? "true" : char === "f" ? "false" : "null";
			this.token = {
				kind: "literal",
				value,
				index: 1
			};
			return;
		}
		if (char === "-" || /[0-9]/.test(char)) {
			this.token = {
				kind: "number",
				value: char
			};
			return;
		}
		this.fail("JSON value has an invalid leading character");
	}
	finishNumber() {
		if (this.token?.kind !== "number") return;
		if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(this.token.value)) this.fail("JSON number is malformed");
		this.token = void 0;
		this.completeValue();
	}
	write(text) {
		for (let index = 0; index < text.length; index++) {
			const char = text[index];
			const token = this.token;
			if (token?.kind === "string") {
				if (token.unicodeRemaining > 0) {
					if (!/[0-9A-Fa-f]/.test(char)) this.fail("JSON string has an invalid Unicode escape");
					token.unicodeRemaining--;
					continue;
				}
				if (token.escaped) {
					token.escaped = false;
					if (char === "u") token.unicodeRemaining = 4;
					else if (!/["\\/bfnrt]/.test(char)) this.fail("JSON string has an invalid escape");
					continue;
				}
				if (char === "\\") {
					token.escaped = true;
					continue;
				}
				if (char === "\"") {
					this.token = void 0;
					if (token.purpose === "key") {
						const frame = this.stack.at(-1);
						if (frame?.kind !== "object") this.fail("JSON key appears outside an object");
						frame.expect = "colon";
					} else this.completeValue();
					continue;
				}
				if (char.charCodeAt(0) < 32) this.fail("JSON string contains a control character");
				continue;
			}
			if (token?.kind === "number") {
				if (/[0-9eE+.-]/.test(char)) {
					if (token.value.length >= 128) this.fail("JSON numeric token is unreasonably long");
					token.value += char;
					continue;
				}
				this.finishNumber();
				index--;
				continue;
			}
			if (token?.kind === "literal") {
				if (char !== token.value[token.index]) this.fail("JSON literal is malformed");
				token.index++;
				if (token.index === token.value.length) {
					this.token = void 0;
					this.completeValue();
				}
				continue;
			}
			if (char === " " || char === "	" || char === "\r" || char === "\n") continue;
			const expectation = this.currentExpectation();
			if (expectation === "root-end") this.fail("JSON contains trailing non-whitespace data");
			if (expectation === "colon") {
				if (char !== ":") this.fail("JSON object key is missing a colon");
				this.stack.at(-1).expect = "value";
				continue;
			}
			if (expectation === "key-or-end" || expectation === "key") {
				if (char === "}" && expectation === "key-or-end") {
					this.stack.pop();
					this.completeValue();
					continue;
				}
				if (char !== "\"") this.fail("JSON object key must be a string");
				this.token = {
					kind: "string",
					purpose: "key",
					escaped: false,
					unicodeRemaining: 0
				};
				continue;
			}
			if (expectation === "comma-or-end") {
				const frame = this.stack.at(-1);
				if (frame.kind === "object" && char === "}") {
					this.stack.pop();
					this.completeValue();
					continue;
				}
				if (frame.kind === "array" && char === "]") {
					this.stack.pop();
					this.completeValue();
					continue;
				}
				if (char !== ",") this.fail("JSON collection is missing a comma or closing delimiter");
				frame.expect = frame.kind === "object" ? "key" : "value";
				continue;
			}
			if (expectation === "value-or-end" && char === "]") {
				this.stack.pop();
				this.completeValue();
				continue;
			}
			this.startValue(char);
		}
	}
	finish() {
		if (this.token?.kind === "number") this.finishNumber();
		if (this.token !== void 0 || this.stack.length !== 0 || this.rootExpect !== "end") this.fail("JSON document ended before its value was complete");
	}
};
async function validateJsonFile(path, maxBytes = MAX_JSON_VALIDATION_BYTES, signal) {
	if ((await stat(path)).size > maxBytes) throw new MinerUError(failure("RESULT_TOO_LARGE", "JSON ZIP artifact exceeds validation limit"));
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const validator = new StreamingJsonValidator();
	const stream = createReadStream(path);
	const onAbort = () => {
		stream.destroy(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	let bytes = 0;
	try {
		signal?.throwIfAborted();
		for await (const chunk of stream) {
			signal?.throwIfAborted();
			const buffer = chunk;
			bytes += buffer.byteLength;
			if (bytes > maxBytes) throw new MinerUError(failure("RESULT_TOO_LARGE", "JSON ZIP artifact exceeds validation limit"));
			validator.write(decoder.decode(buffer, { stream: true }));
		}
		validator.write(decoder.decode());
		validator.finish();
	} catch (error) {
		if (error instanceof MinerUError) throw error;
		if (signal?.aborted) throw signal.reason ?? error;
		throw new MinerUError(failure("RESULT_ARCHIVE_INVALID", "Invalid JSON artifact"), { cause: error });
	} finally {
		signal?.removeEventListener("abort", onAbort);
		stream.destroy();
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
	constructor(config, options) {
		asProviderConfigId(config.id);
		this.config = config;
		this.retryOptions = options?.retry ?? {};
		this.parsedBaseUrl = validateAndNormalizeOfficialBaseURL(config.baseURL);
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
		for (const source of sources) {
			context.signal.throwIfAborted();
			let currentStat;
			try {
				currentStat = await stat(source.path);
			} catch (err) {
				throw new MinerUError(failure("FILE_NOT_FOUND", `Source file missing before upload: ${source.name}`), { cause: err });
			}
			if (currentStat.size !== source.fingerprint.size || currentStat.mtimeMs !== source.fingerprint.mtimeMs || currentStat.dev !== source.fingerprint.device || currentStat.ino !== source.fingerprint.inode) throw new MinerUError(failure("INVALID_REQUEST", `Source file ${source.name} changed before upload`, true));
		}
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
		const allowRetry = options?.retry ?? method.toUpperCase() === "GET";
		const operation = options?.operation ?? (path.startsWith("/extract-results/batch/__dsh_probe__") ? "probe" : "api-json");
		const businessValidation = options?.businessValidation ?? "strict";
		const executeOnce = async () => {
			context.signal.throwIfAborted();
			const url = `${this.parsedBaseUrl.origin}${this.parsedBaseUrl.pathname.replace(/\/+$/, "")}${path}`;
			const controller = new AbortController();
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				controller.abort(new DOMException(`Request timed out after ${String(context.timeoutMs)}ms`, "TimeoutError"));
			}, context.timeoutMs);
			const onParentAbort = () => {
				controller.abort(context.signal.reason);
			};
			context.signal.addEventListener("abort", onParentAbort, { once: true });
			try {
				const requestHeaders = { ...headers };
				if (context.credential && context.credential.trim() !== "") requestHeaders["authorization"] = `Bearer ${context.credential}`;
				let response;
				try {
					const requestInit = {
						method,
						headers: requestHeaders,
						body: bodyText,
						signal: controller.signal,
						redirect: "error"
					};
					response = await fetch(url, requestInit);
				} catch (err) {
					if (context.signal.aborted) throw new MinerUError(failure("CANCELLED", "Operation was cancelled", true));
					if (timedOut) {
						const timeoutErr = new MinerUError(failure("PROVIDER_UNAVAILABLE", `Request to MinerU official API timed out after ${String(context.timeoutMs)}ms`, true));
						Object.assign(timeoutErr, { httpStatus: 408 });
						throw timeoutErr;
					}
					throw new MinerUError(failure("PROVIDER_UNAVAILABLE", `Failed to connect to MinerU official API: ${sanitizeDiagnostic(err instanceof Error ? err.message : String(err))}`, true), { cause: err });
				}
				const status = response.status;
				if (!acceptedStatuses.includes(status)) {
					let errorBody = "";
					try {
						errorBody = await readBoundedResponseText(response, context.limits.maxApiResponseBytes, controller.signal);
					} catch {
						if (response.body) try {
							await response.body.cancel();
						} catch {}
					}
					let parsedError;
					try {
						const parsed = JSON.parse(errorBody);
						if (typeof parsed === "object" && parsed !== null) {
							const json = parsed;
							if (typeof json.msg === "string") parsedError = json.msg;
							else if (typeof json.message === "string") parsedError = json.message;
							else if (typeof json.detail === "string") parsedError = json.detail;
						}
					} catch {
						parsedError = errorBody.slice(0, 500);
					}
					const diagnostic = parsedError ? `: ${sanitizeDiagnostic(parsedError, [context.credential ?? ""])}` : "";
					const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
					let err;
					if (status === 401 || status === 403) err = new MinerUError(failure("AUTHENTICATION_FAILED", `Official MinerU authentication failed (${String(status)})${diagnostic}`, false, { provider: "official-v4" }));
					else if (status === 404) err = new MinerUError(failure("JOB_NOT_FOUND", `Official MinerU resource not found (${String(status)})${diagnostic}`, false, { provider: "official-v4" }));
					else if (status === 413) err = new MinerUError(failure("FILE_TOO_LARGE", `File exceeds size limit (${String(status)})${diagnostic}`, false, { provider: "official-v4" }));
					else if (status === 429) err = new MinerUError(failure("PROVIDER_RATE_LIMITED", `Official MinerU rate limit exceeded (${String(status)})${diagnostic}`, true, { provider: "official-v4" }));
					else if (status === 408) err = new MinerUError(failure("PROVIDER_UNAVAILABLE", `Official MinerU request timeout (${String(status)})${diagnostic}`, true, { provider: "official-v4" }));
					else if (status >= 500) err = new MinerUError(failure("PROVIDER_UNAVAILABLE", `Official MinerU server error (${String(status)})${diagnostic}`, true, { provider: "official-v4" }));
					else err = new MinerUError(failure("REMOTE_PARSE_FAILED", `Official MinerU returned status ${String(status)}${diagnostic}`, false, { provider: "official-v4" }));
					Object.assign(err, {
						httpStatus: status,
						retryAfterMs
					});
					throw err;
				}
				const contentType = response.headers.get("content-type") ?? "";
				if (!contentType.toLowerCase().includes("application/json")) {
					if (response.body) try {
						await response.body.cancel();
					} catch {}
					throw new MinerUError(failure("REMOTE_PARSE_FAILED", `Expected application/json response, got "${contentType}"`, false, { provider: "official-v4" }));
				}
				const rawText = await readBoundedResponseText(response, context.limits.maxApiResponseBytes, controller.signal);
				let parsed;
				try {
					parsed = JSON.parse(rawText);
				} catch (err) {
					throw new MinerUError(failure("REMOTE_PARSE_FAILED", `Failed to parse JSON response: ${sanitizeDiagnostic(err instanceof Error ? err.message : String(err))}`, false, { provider: "official-v4" }), { cause: err });
				}
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new MinerUError(failure("REMOTE_PARSE_FAILED", "Official MinerU response must be an object", false, { provider: "official-v4" }));
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
			} finally {
				clearTimeout(timer);
				context.signal.removeEventListener("abort", onParentAbort);
			}
		};
		if (!allowRetry) return await executeOnce();
		return await executeWithRetry({
			provider: "official-v4",
			operation,
			signal: context.signal,
			retryOptions: mergeRetryOptions(this.retryOptions, context.retry),
			fn: executeOnce
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
				let currentStat;
				try {
					currentStat = await stat(source.path);
				} catch (err) {
					throw new MinerUError(failure("FILE_NOT_FOUND", `Source file missing during upload: ${source.name}`), { cause: err });
				}
				if (currentStat.size !== source.fingerprint.size || currentStat.mtimeMs !== source.fingerprint.mtimeMs || currentStat.dev !== source.fingerprint.device || currentStat.ino !== source.fingerprint.inode) throw new MinerUError(failure("INVALID_REQUEST", `Source file ${source.name} modified during upload`, true));
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
//#region src/storage/batch-artifact-router.ts
var BatchArtifactRouter = class {
	transactions = /* @__PURE__ */ new Map();
	temporaryOwner;
	constructor(participants) {
		if (participants.length === 0) throw new TypeError("Batch artifact router requires at least one participant");
		for (const participant of participants) {
			if (this.transactions.has(participant.fileId)) throw new TypeError("Batch artifact router contains duplicate fileId");
			this.transactions.set(participant.fileId, participant.transaction);
		}
		this.temporaryOwner = participants[0].transaction;
	}
	transaction(fileId) {
		const transaction = this.transactions.get(fileId);
		if (transaction === void 0) throw new TypeError("Provider wrote an artifact for an unknown batch fileId");
		return transaction;
	}
	writeArtifact(fileId, kind, input, options) {
		return this.transaction(fileId).writeArtifact(fileId, kind, input, options);
	}
	writeTemporary(name, input, maxBytes) {
		return this.temporaryOwner.writeTemporary(name, input, maxBytes);
	}
	async abortUncommitted(committed = /* @__PURE__ */ new Set()) {
		await Promise.all([...this.transactions].map(async ([fileId, transaction]) => {
			if (!committed.has(fileId)) await transaction.abort().catch(() => void 0);
		}));
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
//#region src/service/batch-coordinator.ts
function combineRequest(participants) {
	const first = participants[0]?.request;
	if (first === void 0 || participants.some((participant) => participant.request.files.length !== 1)) throw new TypeError("Batch participants must each own exactly one request file");
	return {
		...first,
		files: participants.map((participant) => participant.request.files[0])
	};
}
function delay$1(ms, signal) {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const finish = () => {
			signal.removeEventListener("abort", abort);
			resolve();
		};
		const timer = setTimeout(finish, ms);
		const abort = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
		};
		signal.addEventListener("abort", abort, { once: true });
		timer.unref?.();
	});
}
/** Runs one provider batch while each file keeps an independent cache operation. */
var BatchCoordinator = class {
	options;
	controller = new AbortController();
	runPromise;
	constructor(options) {
		this.options = options;
		this.runPromise = this.execute();
		this.runPromise.catch(() => void 0);
	}
	run() {
		return this.runPromise;
	}
	abort(reason) {
		if (!this.controller.signal.aborted) this.controller.abort(reason);
	}
	async execute() {
		const participants = this.options.participants;
		const timer = setTimeout(() => this.abort(new MinerUError(failure("POLL_TIMEOUT", "MinerU batch operation timed out", true))), this.options.timeoutMs);
		timer.unref?.();
		try {
			const request = combineRequest(participants);
			const submission = await this.options.resolved.provider.submit(request, participants.map((participant) => participant.source), await this.options.createContext(this.controller.signal));
			let snapshot = submission;
			while (snapshot.files.some((file) => file.state !== "completed" && file.state !== "failed")) {
				await delay$1(this.options.pollIntervalMs, this.controller.signal);
				snapshot = await this.options.resolved.provider.inspect(submission.ref, await this.options.createContext(this.controller.signal));
			}
			const collection = new Set(snapshot.files.filter((file) => file.state === "completed").map((file) => file.fileId)).size === 0 ? { files: [] } : await this.options.resolved.provider.collect(submission.ref, request, this.options.sink, await this.options.createContext(this.controller.signal));
			const byFile = new Map(collection.files.map((file) => [file.fileId, file]));
			const finalByFile = new Map(snapshot.files.map((file) => [file.fileId, file]));
			await Promise.all(participants.map(async (participant) => {
				const fileId = participant.request.files[0].fileId;
				const final = finalByFile.get(fileId);
				const file = byFile.get(fileId);
				const outcome = final?.state === "failed" ? await participant.failed(new MinerUError(final.failure ?? failure("REMOTE_PARSE_FAILED", "Remote parse failed"))) : file === void 0 ? await participant.failed(/* @__PURE__ */ new TypeError("Provider collection omitted a completed batch participant")) : await participant.collected(file);
				participant.operation.resolve(outcome);
			}));
		} catch (error) {
			await Promise.all(participants.map(async (participant) => {
				if (participant.operation.settledValue !== void 0) return;
				try {
					participant.operation.resolve(await participant.failed(error));
				} catch (failureError) {
					participant.operation.reject(failureError);
				}
			}));
			throw error;
		} finally {
			clearTimeout(timer);
			this.options.unregister();
		}
	}
};
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
function normalizePageRanges(input) {
	const intervals = [];
	for (const token of input.split(",")) {
		const trimmed = token.trim();
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
	intervals.sort((left, right) => left.start - right.start || left.end - right.end);
	const merged = [];
	for (const current of intervals) {
		const previous = merged.at(-1);
		if (previous !== void 0 && current.start <= previous.end + 1) previous.end = Math.max(previous.end, current.end);
		else merged.push({ ...current });
	}
	return merged.map(({ start, end }) => start === end ? String(start) : `${String(start)}-${String(end)}`).join(",");
}
function normalizeArtifactKinds(kinds) {
	const requested = /* @__PURE__ */ new Set(["markdown", ...kinds]);
	return ARTIFACT_KINDS.filter((kind) => requested.has(kind));
}
//#endregion
//#region src/service/cache-key.ts
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
		const target = {};
		for (const rawKey of Object.keys(source).sort()) {
			const key = rawKey.normalize("NFC");
			if (key in target) throw new TypeError("canonical JSON key normalization collision");
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
//#region src/service/request-normalizer.ts
const REQUEST_FIELDS = /* @__PURE__ */ new Set([
	"file_paths",
	"model",
	"ocr",
	"language",
	"formula",
	"table",
	"pages",
	"artifacts"
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
		return normalizePageRanges(input);
	} catch (error) {
		throw new MinerUError(failure("INVALID_REQUEST", error instanceof Error ? error.message : "Invalid page range"), { cause: error });
	}
}
function resolvePaths(input, maxFiles) {
	const paths = input.file_paths ?? [];
	if (paths.length === 0) throw new MinerUError(failure("INVALID_REQUEST", "Exactly one local document path is required"));
	if (paths.length > maxFiles) throw new MinerUError(failure("INVALID_REQUEST", `At most ${String(maxFiles)} file(s) may be submitted`));
	if (paths.some((path) => typeof path !== "string" || path.trim() === "")) throw new MinerUError(failure("INVALID_REQUEST", "File paths must be non-empty strings"));
	return paths;
}
function resolveArtifacts(input, defaults) {
	const artifacts = [...input.artifacts ?? defaults.artifacts];
	for (const artifact of artifacts) if (!ARTIFACT_KINDS.includes(artifact)) throw new MinerUError(failure("INVALID_REQUEST", `Unknown artifact kind: ${String(artifact)}`));
	return normalizeArtifactKinds(artifacts);
}
async function hashFile(path, signal) {
	const hash = createHash("sha256");
	const stream = createReadStream(path);
	const onAbort = () => {
		stream.destroy(new DOMException("Aborted", "AbortError"));
	};
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		signal.throwIfAborted();
		for await (const chunk of stream) {
			signal.throwIfAborted();
			hash.update(chunk);
		}
		return hash.digest("hex");
	} finally {
		signal.removeEventListener("abort", onAbort);
		stream.destroy();
	}
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
	const sha256 = await hashFile(path, signal);
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
		const paths = resolvePaths(input, this.options.maxFiles ?? 1);
		const language = input.language ?? this.options.defaults.language;
		if (language.trim() === "") throw new MinerUError(failure("INVALID_REQUEST", "Language cannot be empty"));
		const model = input.model ?? this.options.defaults.model;
		const parseMethod = input.ocr === void 0 ? this.options.defaults.parseMethod : input.ocr ? "ocr" : "auto";
		const ocr = parseMethod === "ocr";
		const formula = input.formula ?? this.options.defaults.formula;
		const table = input.table ?? this.options.defaults.table;
		const pages = input.pages === void 0 ? void 0 : normalizePages(input.pages);
		const unhashedSources = await Promise.all(paths.map((path) => prepareSource(path, this.options.cwd, this.options.maxFileBytes, signal)));
		const occurrences = /* @__PURE__ */ new Map();
		const sources = unhashedSources.map((source) => {
			const occurrence = occurrences.get(source.sha256) ?? 0;
			occurrences.set(source.sha256, occurrence + 1);
			return {
				...source,
				fileId: createFileId(source.sha256, occurrence)
			};
		});
		return {
			sources,
			request: {
				schemaVersion: 1,
				files: sources.map(({ fileId, name, bytes, sha256 }) => ({
					fileId,
					name,
					bytes,
					sha256
				})),
				semantics: {
					model,
					ocr,
					parseMethod,
					language,
					formula,
					table,
					...pages === void 0 ? {} : { pages }
				},
				requiredArtifacts: resolveArtifacts(input, this.options.defaults)
			}
		};
	}
};
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
	coordinatorDisposers = /* @__PURE__ */ new Set();
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
	registerCoordinator(dispose) {
		if (this.disposed) {
			dispose();
			return () => void 0;
		}
		this.coordinatorDisposers.add(dispose);
		return () => {
			this.coordinatorDisposers.delete(dispose);
		};
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
		for (const dispose of this.coordinatorDisposers) dispose();
		this.coordinatorDisposers.clear();
		for (const operation of [...this.operations.values()]) if (!this.release(operation, error)) operation.abort(error);
	}
	async shutdown() {
		this.dispose();
		await Promise.allSettled([...this.runners]);
	}
};
//#endregion
//#region src/service/mineru-service.ts
const MAX_POLL_TIMEOUT_MS$1 = 864e5;
function delay(ms, signal) {
	if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
	return new Promise((resolve, reject) => {
		const finish = () => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		};
		const timer = setTimeout(finish, ms);
		const onAbort = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		timer.unref?.();
	});
}
function singlePreparedRequest(prepared, index) {
	const file = prepared.request.files[index];
	const source = prepared.sources[index];
	if (file === void 0 || source === void 0) throw new TypeError("Prepared request source mapping is incomplete");
	return {
		request: {
			...prepared.request,
			files: [file]
		},
		sources: [source]
	};
}
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
		const prepared = await new RequestNormalizer({
			defaults: current.defaults,
			cwd: session.header.cwd,
			maxFiles: Math.min(current.limits.maxFilesPerRequest, resolved.provider.capabilities.maxFilesPerSubmission),
			maxFileBytes: Math.min(current.limits.maxFileBytes, resolved.provider.capabilities.maxFileBytes ?? current.limits.maxFileBytes)
		}).normalize(input, signal);
		const maxTotalRequestBytes = current.limits.maxFileBytes * current.limits.maxFilesPerRequest;
		const totalRequestBytes = prepared.request.files.reduce((total, file) => total + file.bytes, 0);
		if (!Number.isSafeInteger(maxTotalRequestBytes) || totalRequestBytes > maxTotalRequestBytes) throw new MinerUError(failure("FILE_TOO_LARGE", "Combined request files exceed the derived total byte limit"));
		validateProviderCapabilities(prepared.request, resolved.provider.capabilities);
		const compatibility = await resolved.provider.compatibilityKey(prepared.request, { configuredVersion: "configuredVersion" in resolved.config ? resolved.config.configuredVersion : void 0 });
		const pending = [];
		try {
			for (let index = 0; index < prepared.request.files.length; index++) {
				const one = singlePreparedRequest(prepared, index);
				const file = one.request.files[0];
				const cacheKey = computeCacheKey(one.request, file, compatibility);
				const hit = current.storage.cacheEnabled ? await this.options.results.get(cacheKey, one.request.requiredArtifacts, signal) : void 0;
				if (hit !== void 0) {
					pending.push({
						prepared: one,
						cacheKey,
						source: "cache",
						resultId: hit.id
					});
					this.diagnostic({
						level: "info",
						phase: "cache-hit",
						provider: resolved.provider.id,
						bytes: file.bytes,
						cacheHit: true
					});
					continue;
				}
				const reservation = this.options.operations.reserve(cacheKey, resolved.config.id, current.polling.operationTimeoutMs);
				pending.push({
					prepared: one,
					cacheKey,
					source: reservation.created ? "provider" : "shared-operation",
					operation: reservation.operation,
					created: reservation.created
				});
			}
		} catch (error) {
			for (const item of pending) if (item.created === true && item.operation !== void 0) this.options.operations.release(item.operation, error);
			throw error;
		}
		const created = pending.filter((item) => item.created === true);
		try {
			const producers = [];
			for (const item of created) {
				const cached = current.storage.cacheEnabled ? await this.options.results.get(item.cacheKey, item.prepared.request.requiredArtifacts, signal) : void 0;
				if (cached === void 0) {
					producers.push(item);
					continue;
				}
				item.source = "cache";
				item.resultId = cached.id;
				this.options.operations.start(item.operation, async () => ({
					state: "completed",
					resultId: cached.id
				}));
			}
			if (producers.length === 1) {
				const item = producers[0];
				this.options.operations.start(item.operation, (operation) => this.runOperation(operation, item.prepared, resolved, compatibility));
			} else if (producers.length > 1) this.startBatch(producers, resolved, compatibility, current);
		} catch (error) {
			for (const item of created) if (item.operation !== void 0) this.options.operations.release(item.operation, error);
			throw error;
		}
		return {
			pending,
			resolved,
			compatibility
		};
	}
	startBatch(items, resolved, compatibility, current) {
		const transactions = /* @__PURE__ */ new Map();
		for (const item of items) {
			const operation = item.operation;
			const fileId = item.prepared.request.files[0].fileId;
			transactions.set(fileId, this.options.results.beginTransaction(operation.id, item.prepared.request, {
				providerId: resolved.provider.id,
				providerConfigId: resolved.config.id,
				compatibilityKey: compatibility
			}));
		}
		const router = new BatchArtifactRouter(items.map((item) => ({
			fileId: item.prepared.request.files[0].fileId,
			transaction: transactions.get(item.prepared.request.files[0].fileId)
		})));
		let unregister = () => void 0;
		const coordinator = new BatchCoordinator({
			participants: items.map((item) => {
				const operation = item.operation;
				const file = item.prepared.request.files[0];
				const transaction = transactions.get(file.fileId);
				const fail = async (error) => {
					await transaction.abort().catch(() => void 0);
					return {
						state: "failed",
						failure: toMinerUFailure(error)
					};
				};
				return {
					request: item.prepared.request,
					source: item.prepared.sources[0],
					operation,
					collected: async (collected) => {
						if (collected.failure !== void 0) return fail(new MinerUError(collected.failure));
						const manifest = transaction.buildManifest(file, collected.artifacts);
						return {
							state: "completed",
							resultId: (await this.options.results.commitTransaction(transaction, manifest, coordinator.controller.signal)).resultId
						};
					},
					failed: fail
				};
			}),
			resolved,
			sink: router,
			pollIntervalMs: current.polling.pollIntervalMs,
			timeoutMs: current.polling.operationTimeoutMs,
			createContext: (signal) => this.callContext(resolved.config, signal, items[0].operation.id),
			unregister: () => unregister()
		});
		unregister = this.options.operations.registerCoordinator(() => coordinator.abort(new MinerUError(failure("CANCELLED", "MinerU plugin disposed", true))));
		for (const item of items) {
			const operation = item.operation;
			this.options.operations.start(operation, async () => {
				await coordinator.run().catch(() => void 0);
				const settled = operation.settledValue;
				if (settled === void 0) throw new MinerUError(failure("REMOTE_PARSE_FAILED", "Batch participant did not settle"));
				return settled;
			});
		}
	}
	async runOperation(operation, prepared, resolved, compatibility) {
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
				await delay(this.config().polling.pollIntervalMs, operation.controller.signal);
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
	async markdownPreview(path, bytes, maxChars) {
		const maxBytes = Math.min(bytes, Math.max(1024, maxChars * 4));
		const handle = await open(path, "r");
		try {
			const buffer = Buffer.alloc(maxBytes);
			const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
			const text = new TextDecoder("utf-8").decode(buffer.subarray(0, bytesRead));
			return {
				text: text.slice(0, maxChars),
				truncated: bytesRead < bytes || text.length > maxChars
			};
		} finally {
			await handle.close();
		}
	}
	fitResult(view, limit) {
		const { markdown_preview: initialPreview, files: _initialFiles, ...base } = view;
		let preview = initialPreview;
		let outputTrimmed = false;
		const files = view.files.map((file) => ({
			...file,
			artifacts: [...file.artifacts]
		}));
		const build = () => ({
			...base,
			preview_truncated: base.preview_truncated || outputTrimmed,
			files,
			...preview === void 0 ? {} : { markdown_preview: preview }
		});
		let candidate = build();
		if (JSON.stringify(candidate).length <= limit) return candidate;
		if (preview !== void 0) {
			const fullPreview = preview;
			let low = 0;
			let high = fullPreview.length;
			while (low < high) {
				const middle = Math.ceil((low + high) / 2);
				preview = fullPreview.slice(0, middle);
				if (JSON.stringify(build()).length <= limit) low = middle;
				else high = middle - 1;
			}
			preview = fullPreview.slice(0, low);
			outputTrimmed = low < fullPreview.length;
			candidate = build();
		}
		while (JSON.stringify(candidate).length > limit && files.some((file) => file.artifacts.length > 0)) {
			const target = files.find((file) => file.artifacts.length > 0);
			if (target === void 0) break;
			target.artifacts = target.artifacts.slice(0, -1);
			target.artifacts_truncated = true;
			candidate = build();
		}
		if (JSON.stringify(candidate).length > limit) throw new MinerUError(failure("RESULT_TOO_LARGE", "Result metadata exceeds configured model output limit"));
		return candidate;
	}
	async projectResult(item, manifest) {
		const limit = this.config().output.maxInlineChars;
		const document = manifest.files[0];
		const markdown = document.artifacts.find((artifact) => artifact.kind === "markdown");
		const preview = markdown === void 0 ? void 0 : await this.markdownPreview(this.options.results.resolveArtifactAbsolutePath(item.cacheKey, markdown.relativePath), markdown.bytes, limit);
		const artifacts = document.artifacts.map((artifact) => ({
			kind: artifact.kind,
			path: this.options.results.resolveArtifactAbsolutePath(item.cacheKey, artifact.relativePath),
			bytes: artifact.bytes
		}));
		return this.fitResult({
			state: "completed",
			source: item.source,
			cache_hit: item.source === "cache",
			result_id: manifest.id,
			files: [{
				file_id: document.fileId,
				name: item.prepared.request.files[0]?.name ?? document.name,
				artifacts
			}],
			...preview === void 0 ? {} : { markdown_preview: preview.text },
			preview_truncated: preview?.truncated ?? false,
			manifest_path: this.options.results.manifestAbsolutePath(item.cacheKey),
			output_limit_chars: limit
		}, limit);
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
	async parseDocument(session, input, signal, pollTimeoutMs) {
		const { pending } = await this.prepare(session, input, signal);
		const wait = this.createWaitSignal(signal, pollTimeoutMs);
		let outcomes;
		try {
			outcomes = await Promise.all(pending.map(async (item) => {
				if (item.resultId !== void 0) return {
					state: "completed",
					resultId: item.resultId
				};
				if (item.operation === void 0) throw new TypeError("Pending parse has no result or shared operation");
				return await item.operation.waitForOutcome(wait.signal);
			}));
		} catch (error) {
			if (signal.aborted) throw signal.reason ?? error;
			if (wait.timedOut()) throw new MinerUError(failure("POLL_TIMEOUT", "Synchronous MinerU wait timed out; retry the same request to rejoin the shared operation", true));
			throw error;
		} finally {
			wait.dispose();
		}
		const views = await Promise.all(outcomes.map(async (outcome, index) => {
			const item = pending[index];
			const file = item.prepared.request.files[0];
			if (outcome.state === "failed" || outcome.resultId === void 0) return {
				state: "failed",
				source: item.source,
				file_id: file.fileId,
				name: file.name,
				failure: outcome.failure ?? failure("REMOTE_PARSE_FAILED", "Remote parse failed")
			};
			const manifest = await this.options.results.get(item.cacheKey, item.prepared.request.requiredArtifacts, signal);
			if (manifest === void 0 || manifest.id !== outcome.resultId) return {
				state: "failed",
				source: item.source,
				file_id: file.fileId,
				name: file.name,
				failure: failure("CACHE_EVICTED", "Published MinerU result is missing or corrupt")
			};
			return await this.projectResult(item, manifest);
		}));
		if (views.length === 1) {
			const view = views[0];
			if (view.state === "failed") throw new MinerUError(view.failure);
			return view;
		}
		const completed = views.filter((view) => view.state === "completed").length;
		return {
			kind: "batch",
			state: completed === views.length ? "completed" : completed === 0 ? "failed" : "partially-completed",
			results: views
		};
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
*   - Safe, deterministic directory layout per ARCHITECTURE.md §12.4
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
* process-lock.ts — Fail-closed single-process storageRoot lock.
*
* Prevents multiple concurrent DSH processes from mutating the same storageRoot.
* Lock authority is a Linux abstract Unix socket, which the OS releases on
* process death. The pathname file is ownership metadata only and can safely be
* replaced after socket acquisition.
*/
function parseLockPayload(raw) {
	const value = JSON.parse(raw);
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("lock payload is not an object");
	const record = value;
	if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || typeof record.ownerToken !== "string" || record.ownerToken.length === 0 || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0 || typeof record.hostname !== "string" || record.hostname.length === 0) throw new TypeError("lock payload is invalid");
	return {
		pid: record.pid,
		ownerToken: record.ownerToken,
		createdAt: record.createdAt,
		hostname: record.hostname
	};
}
var ProcessLock = class {
	paths;
	lockFilePath;
	socketName;
	ownerToken;
	server;
	acquired = false;
	constructor(paths) {
		this.paths = paths;
		this.lockFilePath = paths.processLockFile();
		const rootHash = createHash("sha256").update(paths.root).digest("hex").slice(0, 32);
		this.socketName = `\0dsh-pdf-mineru-${rootHash}`;
		this.ownerToken = `owner_${randomUUID().replace(/-/g, "")}`;
	}
	isHeld() {
		return this.acquired;
	}
	async acquire(signal) {
		if (this.acquired) return;
		signal?.throwIfAborted();
		await mkdir(this.paths.root, {
			recursive: true,
			mode: 448
		});
		await chmod(this.paths.root, 448);
		signal?.throwIfAborted();
		const payload = {
			pid: process.pid,
			ownerToken: this.ownerToken,
			createdAt: Date.now(),
			hostname: hostname()
		};
		if (process.platform !== "linux") {
			let createdMetadata = false;
			try {
				await writeFile(this.lockFilePath, JSON.stringify(payload, null, 2), {
					flag: "wx",
					mode: 384
				});
				createdMetadata = true;
				signal?.throwIfAborted();
				this.acquired = true;
				return;
			} catch (error) {
				if (createdMetadata) await unlink(this.lockFilePath).catch(() => void 0);
				if (error.code === "EEXIST") throwMinerU("STORAGE_LOCKED", "MinerU storage is already locked by another process");
				throw error;
			}
		}
		const server = createServer();
		try {
			await new Promise((resolve, reject) => {
				const onError = (error) => {
					server.removeListener("listening", onListening);
					reject(error);
				};
				const onListening = () => {
					server.removeListener("error", onError);
					resolve();
				};
				server.once("error", onError);
				server.once("listening", onListening);
				server.listen(this.socketName);
			});
			signal?.throwIfAborted();
		} catch (error) {
			await new Promise((resolve) => server.close(() => resolve()));
			if (error.code === "EADDRINUSE") throwMinerU("STORAGE_LOCKED", "MinerU storage is already locked by another process");
			throw error;
		}
		server.unref();
		this.server = server;
		try {
			await writeFile(this.lockFilePath, JSON.stringify(payload, null, 2), {
				flag: "w",
				mode: 384
			});
			await chmod(this.lockFilePath, 384);
			signal?.throwIfAborted();
			this.acquired = true;
		} catch (error) {
			this.server = void 0;
			await unlink(this.lockFilePath).catch(() => void 0);
			await new Promise((resolve) => server.close(() => resolve()));
			throw error;
		}
	}
	async release() {
		if (!this.acquired) return;
		this.acquired = false;
		const server = this.server;
		this.server = void 0;
		if (server !== void 0) await new Promise((resolve) => server.close(() => resolve()));
		try {
			const existing = parseLockPayload(await readFile(this.lockFilePath, "utf8"));
			if (existing.ownerToken === this.ownerToken && existing.pid === process.pid) await unlink(this.lockFilePath);
		} catch {}
	}
};
//#endregion
//#region src/storage/access-gate.ts
var StorageAccessGate = class {
	activeReaders = 0;
	exclusive = false;
	get activeReaderCount() {
		return this.activeReaders;
	}
	async runShared(operation) {
		if (this.exclusive) throwMinerU("STORAGE_LOCKED", "MinerU storage maintenance is in progress");
		this.activeReaders++;
		try {
			return await operation();
		} finally {
			this.activeReaders--;
		}
	}
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
function errnoCode$1(error) {
	return error?.code;
}
function isAbort(error, signal) {
	return signal?.aborted === true || error instanceof Error && error.name === "AbortError";
}
function inspectionFailure(error, fallback) {
	const code = errnoCode$1(error);
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
async function setReadOnlyRecursive(dirPath) {
	try {
		const root = await lstat(dirPath);
		if (root.isSymbolicLink() || !root.isDirectory()) return;
		const items = await readdir(dirPath, { withFileTypes: true });
		for (const item of items) {
			if (item.isSymbolicLink()) continue;
			const full = join(dirPath, item.name);
			const details = await lstat(full);
			if (details.isSymbolicLink()) continue;
			if (details.isDirectory()) {
				await setReadOnlyRecursive(full);
				await chmod(full, 365).catch(() => void 0);
			} else if (details.isFile()) await chmod(full, 256).catch(() => void 0);
		}
		await chmod(dirPath, 320).catch(() => void 0);
	} catch {}
}
async function sha256File(path, signal) {
	const digest = createHash("sha256");
	const stream = createReadStream(path);
	const onAbort = () => {
		stream.destroy(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		signal?.throwIfAborted();
		for await (const chunk of stream) {
			signal?.throwIfAborted();
			digest.update(chunk);
		}
		return digest.digest("hex");
	} finally {
		signal?.removeEventListener("abort", onAbort);
		stream.destroy();
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
function samePublishedContent(left, right) {
	if (left.cacheKey !== right.cacheKey || left.sourceSha256 !== right.sourceSha256) return false;
	const byPath = (manifest) => [...manifest.files[0].artifacts].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
	return canonicalJson(byPath(left)) === canonicalJson(byPath(right));
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
	maxJsonValidationBytes;
	maxManifestBytes;
	maxArtifactBytes;
	constructor(paths, options = {}) {
		this.paths = paths;
		this.maxJsonValidationBytes = options.maxJsonValidationBytes ?? DEFAULT_MAX_JSON_VALIDATION_BYTES;
		this.maxManifestBytes = options.maxManifestBytes ?? DEFAULT_MAX_MANIFEST_BYTES;
		if (!Number.isSafeInteger(this.maxManifestBytes) || this.maxManifestBytes <= 0) throw new TypeError("maxManifestBytes must be a positive safe integer");
		this.maxArtifactBytes = options.maxArtifactBytes;
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
		if (await sha256File(path, signal) !== artifact.sha256) throw new TypeError(`Artifact ${artifact.relativePath} SHA-256 mismatch`);
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
		await mkdir(dirname(targetDir), {
			recursive: true,
			mode: 448
		});
		await chmod(dirname(targetDir), 448);
		const resolveExisting = async () => {
			const existing = await this.get(validated.cacheKey, void 0, signal);
			if (existing === void 0) return void 0;
			if (!samePublishedContent(existing, validated)) {
				await this.quarantine(tx.stagingDir, "conflict");
				throw new MinerUError(failure("CACHE_CONFLICT", `Cache conflict detected for key ${validated.cacheKey}`));
			}
			await tx.abort();
			return existing;
		};
		const before = await resolveExisting();
		if (before !== void 0) return {
			resultId: before.id,
			cacheKey: before.cacheKey,
			manifest: before
		};
		for (let attempt = 0; attempt < 2; attempt++) {
			signal?.throwIfAborted();
			try {
				await rename(tx.stagingDir, targetDir);
				await setReadOnlyRecursive(targetDir);
				return {
					resultId: validated.id,
					cacheKey: validated.cacheKey,
					manifest: validated
				};
			} catch (error) {
				const code = error.code;
				if (code === "EEXIST" || code === "ENOTEMPTY") {
					const raced = await resolveExisting();
					if (raced !== void 0) return {
						resultId: raced.id,
						cacheKey: raced.cacheKey,
						manifest: raced
					};
					continue;
				}
				await this.quarantine(tx.stagingDir, "commit_failed").catch(() => void 0);
				throw error;
			}
		}
		await this.quarantine(tx.stagingDir, "commit_race").catch(() => void 0);
		throw new MinerUError(failure("CACHE_CONFLICT", `Could not atomically publish cache key ${validated.cacheKey}`));
	}
	/**
	* Strictly verifies one published result without moving or modifying it.
	* This is the maintenance-safe counterpart to get(), whose cache-hit path
	* still quarantines invalid entries before returning a miss.
	*/
	async inspectPublished(cacheKey, signal) {
		signal?.throwIfAborted();
		const key = asCacheKey(cacheKey);
		const resultDir = this.paths.resultDir(key);
		try {
			await assertRegularDirectoryWithin(this.paths.resultsDir(), resultDir);
		} catch (error) {
			if (isAbort(error, signal)) throw signal?.reason ?? error;
			if (errnoCode$1(error) === "ENOENT") return {
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
			if (inspection.status === "unreadable") throw new MinerUError(failure("CACHE_CORRUPT", "Published MinerU cache data could not be read"));
			if (inspection.reason !== "absent") await this.quarantine(this.paths.resultDir(key), inspection.status === "missing" ? "missing_manifest" : "corrupt").catch(() => void 0);
			return;
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
		const safeSourcePath = assertQuarantineSourcePath(this.paths, sourcePath);
		const id = `${String(Date.now())}_${reason}_${randomUUID().slice(0, 8)}`;
		const destination = this.paths.quarantineDir(id);
		try {
			const source = await lstat(safeSourcePath);
			if (source.isSymbolicLink() || !source.isDirectory()) throw new TypeError("Only regular directories can be quarantined");
		} catch (error) {
			if (errnoCode$1(error) === "ENOENT") return destination;
			throw new MinerUError(failure("CACHE_CORRUPT", "Failed to isolate corrupt MinerU data safely"));
		}
		await mkdir(this.paths.quarantineDir(), { recursive: true });
		await chmod(safeSourcePath, 493).catch(() => void 0);
		try {
			await rename(safeSourcePath, destination);
			return destination;
		} catch (error) {
			if (error.code === "ENOENT") return destination;
			throw new MinerUError(failure("CACHE_CORRUPT", "Failed to isolate corrupt MinerU data"));
		}
	}
	async cleanupStaging(ttlMs, activeOperationIds = /* @__PURE__ */ new Set(), signal) {
		if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new TypeError("staging TTL must be a positive safe integer");
		let entries;
		try {
			entries = await readdir(this.paths.stagingDir());
		} catch (error) {
			if (error.code === "ENOENT") return 0;
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
				if (error.code !== "ENOENT") throw error;
			}
		}
		return cleaned;
	}
};
//#endregion
//#region src/storage/maintenance-service.ts
/**
* storage-maintenance.ts - Bounded, path-safe maintenance inventory for MinerU storage.
*
* This module is intentionally privileged and storage-local. It never accepts an
* arbitrary filesystem path, never follows symlink entries, and only exposes
* bounded summary data for the loopback RPC and settings UI.
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
const MAX_WALK_DEPTH = 64;
function createUsage() {
	return {
		bytes: 0,
		bytesSaturated: false,
		regularFileCount: 0,
		directoryCount: 0,
		skippedSymlinkCount: 0,
		unexpectedEntryCount: 0,
		unreadableEntryCount: 0,
		depthLimitCount: 0
	};
}
function addBytes(counter, amount) {
	if (!Number.isSafeInteger(amount) || amount < 0 || counter.bytes > Number.MAX_SAFE_INTEGER - amount) {
		counter.bytes = Number.MAX_SAFE_INTEGER;
		counter.bytesSaturated = true;
		return;
	}
	counter.bytes += amount;
}
function addTotal(current, amount, saturated) {
	if (saturated || !Number.isSafeInteger(amount) || amount < 0 || current.value > Number.MAX_SAFE_INTEGER - amount) {
		current.value = Number.MAX_SAFE_INTEGER;
		current.saturated = true;
		return;
	}
	current.value += amount;
}
function boundedLimit(value, fallback, maximum, label) {
	const resolved = value === void 0 ? fallback : value;
	if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) throw new TypeError(label + " must be a positive safe integer no greater than " + String(maximum));
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
function errnoCode(error) {
	return error?.code;
}
function isMissing(error) {
	return errnoCode(error) === "ENOENT";
}
function diagnosticMessage(code) {
	switch (code) {
		case "unexpected-entry": return "Ignored an entry outside the expected storage layout.";
		case "symlink-skipped": return "Skipped a symlink without following it.";
		case "unreadable-entry": return "Could not read a storage entry.";
		case "corrupt-result": return "Published result failed strict manifest or artifact validation.";
		case "missing-result": return "Published result was incomplete or disappeared during validation.";
		case "unsafe-result": return "Published result contained unsafe or unsupported filesystem data.";
		case "malformed-job": return "Persisted job failed strict schema validation.";
		case "inconsistent-job": return "Persisted job contained inconsistent result references.";
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
		return isMissing(error) ? "missing" : "unreadable";
	}
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
async function readSafeDirectory(path) {
	const kind = await classifyNode(path);
	if (kind !== "directory") return { kind: kind === "file" ? "unexpected" : kind };
	try {
		const entries = await readdir(path, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		return {
			kind: "entries",
			entries
		};
	} catch (error) {
		return { kind: isMissing(error) ? "missing" : "unreadable" };
	}
}
async function collectUsage(root, signal) {
	const usage = createUsage();
	const walk = async (path, depth) => {
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
				addBytes(usage, details.size);
			} catch (error) {
				if (!isMissing(error)) usage.unreadableEntryCount++;
			}
			return;
		}
		usage.directoryCount++;
		if (depth >= MAX_WALK_DEPTH) {
			usage.depthLimitCount++;
			return;
		}
		const directory = await readSafeDirectory(path);
		if (directory.kind !== "entries") {
			if (directory.kind === "symlink") usage.skippedSymlinkCount++;
			else if (directory.kind === "unreadable") usage.unreadableEntryCount++;
			else if (directory.kind === "unexpected") usage.unexpectedEntryCount++;
			return;
		}
		for (const entry of directory.entries) {
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
	await walk(root, 0);
	return usage;
}
async function makeTreeWritable(root, signal) {
	const files = [];
	const directories = [];
	const validate = async (path, depth) => {
		signal?.throwIfAborted();
		if (depth > MAX_WALK_DEPTH) return false;
		const kind = await classifyNode(path);
		if (kind === "file") {
			files.push(path);
			return true;
		}
		if (kind !== "directory") return false;
		const directory = await readSafeDirectory(path);
		if (directory.kind !== "entries") return false;
		directories.push(path);
		for (const entry of directory.entries) {
			if (!isSafeSegment(entry.name) || entry.isSymbolicLink()) return false;
			if (!await validate(join(path, entry.name), depth + 1)) return false;
		}
		return true;
	};
	if (!await validate(root, 0)) return false;
	try {
		for (const file of files) {
			signal?.throwIfAborted();
			if (await classifyNode(file) !== "file") throw new TypeError("cache file changed during deletion");
			await chmod(file, 384);
		}
		for (const directory of [...directories].reverse()) {
			signal?.throwIfAborted();
			if (await classifyNode(directory) !== "directory") throw new TypeError("cache directory changed during deletion");
			await chmod(directory, 448);
		}
		return true;
	} catch {
		for (const file of files) await chmod(file, 256).catch(() => void 0);
		for (const directory of directories) await chmod(directory, directory === root ? 320 : 365).catch(() => void 0);
		return false;
	}
}
async function restoreTreeReadOnly(root) {
	if (!await isSafeExistingDirectoryChain(root)) return;
	const restore = async (path, isRoot) => {
		const kind = await classifyNode(path);
		if (kind === "file") {
			await chmod(path, 256).catch(() => void 0);
			return;
		}
		if (kind !== "directory") return;
		const directory = await readSafeDirectory(path);
		if (directory.kind !== "entries") return;
		for (const entry of directory.entries) {
			if (!isSafeSegment(entry.name) || entry.isSymbolicLink()) continue;
			await restore(join(path, entry.name), false);
		}
		await chmod(path, isRoot ? 320 : 365).catch(() => void 0);
	};
	await restore(root, true);
}
function toAreaStatistics(usage, logicalEntryCount) {
	return {
		byteUsage: usage.bytes,
		byteUsageSaturated: usage.bytesSaturated,
		logicalEntryCount,
		regularFileCount: usage.regularFileCount,
		directoryCount: usage.directoryCount,
		skippedSymlinkCount: usage.skippedSymlinkCount,
		unexpectedEntryCount: usage.unexpectedEntryCount,
		unreadableEntryCount: usage.unreadableEntryCount,
		depthLimitCount: usage.depthLimitCount
	};
}
/** Storage maintenance is loopback-only and blocks destructive work while parse operations are active. */
var StorageMaintenanceService = class {
	paths;
	results;
	operations;
	lock;
	accessGate;
	constructor(paths, results, operations, lock, accessGate = new StorageAccessGate()) {
		this.paths = paths;
		this.results = results;
		this.operations = operations;
		this.lock = lock;
		this.accessGate = accessGate;
		if (paths.root !== results.paths.root || paths.root !== lock.paths.root) throw new TypeError("StorageMaintenanceService paths must match its ResultRepository and ProcessLock");
	}
	async getStatistics(signal) {
		this.assertLockHeld();
		const [publishedUsage, stagingUsage, quarantineUsage, publishedCount, stagingCount, quarantineCount] = await Promise.all([
			collectUsage(this.paths.resultsDir(), signal),
			collectUsage(this.paths.stagingDir(), signal),
			collectUsage(this.paths.quarantineDir(), signal),
			this.countPublishedResultDirectories(signal),
			this.countDirectDirectories(this.paths.stagingDir(), (value) => asOperationId(value), signal),
			this.countDirectDirectories(this.paths.quarantineDir(), (value) => assertSafePathSegment(value, "quarantine entry"), signal)
		]);
		return {
			generatedAt: Date.now(),
			publishedResults: toAreaStatistics(publishedUsage, publishedCount),
			staging: toAreaStatistics(stagingUsage, stagingCount),
			quarantine: toAreaStatistics(quarantineUsage, quarantineCount)
		};
	}
	async scanIntegrity(options = {}) {
		this.assertLockHeld();
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
				await this.results.quarantine(resultDir, "maintenance_invalid");
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
		this.assertLockHeld();
		const limit = boundedLimit(options.limit, DEFAULT_QUARANTINE_LIST_LIMIT, MAX_QUARANTINE_LIST_LIMIT, "limit");
		const entries = [];
		const totals = {
			value: 0,
			saturated: false
		};
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
			addTotal(totals, usage.bytes, usage.bytesSaturated);
			if (entries.length < limit) entries.push({
				id: entry.name,
				byteUsage: usage.bytes,
				byteUsageSaturated: usage.bytesSaturated,
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
			totalBytes: totals.value,
			totalBytesSaturated: totals.saturated,
			truncated: totalCount > entries.length,
			skippedSymlinkCount,
			unexpectedEntryCount,
			unreadableEntryCount
		};
	}
	async cleanupQuarantine(options) {
		this.assertLockHeld();
		if (!Array.isArray(options.entryIds)) throw new TypeError("entryIds must be an array");
		if (options.entryIds.length > MAX_QUARANTINE_CLEANUP_ENTRIES) throw new TypeError("entryIds cannot contain more than " + String(MAX_QUARANTINE_CLEANUP_ENTRIES) + " entries");
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
		const plannedTotals = {
			value: 0,
			saturated: false
		};
		const deletedTotals = {
			value: 0,
			saturated: false
		};
		let deletedCount = 0;
		let missingCount = 0;
		let skippedCount = 0;
		for (const entryId of entryIds) {
			options.signal?.throwIfAborted();
			const entryPath = this.paths.quarantineDir(entryId);
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
			if (usage.skippedSymlinkCount > 0 || usage.unexpectedEntryCount > 0 || usage.unreadableEntryCount > 0 || usage.depthLimitCount > 0) {
				skippedCount++;
				continue;
			}
			const entry = {
				id: entryId,
				byteUsage: usage.bytes,
				byteUsageSaturated: usage.bytesSaturated,
				regularFileCount: usage.regularFileCount,
				directoryCount: usage.directoryCount,
				modifiedAt: Math.max(0, Math.floor(details.mtimeMs))
			};
			plannedEntries.push(entry);
			addTotal(plannedTotals, usage.bytes, usage.bytesSaturated);
			if (!dryRun) try {
				if (!await makeTreeWritable(entryPath, options.signal)) {
					skippedCount++;
					continue;
				}
				await rm(entryPath, {
					recursive: true,
					force: false,
					maxRetries: 1
				});
				deletedCount++;
				addTotal(deletedTotals, usage.bytes, usage.bytesSaturated);
			} catch (error) {
				if (isMissing(error)) missingCount++;
				else skippedCount++;
			}
		}
		return {
			generatedAt: Date.now(),
			dryRun,
			requestedCount: entryIds.length,
			plannedCount: plannedEntries.length,
			plannedBytes: plannedTotals.value,
			plannedBytesSaturated: plannedTotals.saturated,
			deletedCount,
			deletedBytes: deletedTotals.value,
			deletedBytesSaturated: deletedTotals.saturated,
			missingCount,
			skippedCount,
			entries: plannedEntries
		};
	}
	async clearCache(options = {}) {
		this.assertLockHeld();
		if (options.dryRun !== false) return await this.clearCacheInternal(options, false, this.accessGate.activeReaderCount);
		const releaseExclusive = this.accessGate.tryAcquireExclusive();
		if (releaseExclusive === void 0) return {
			...await this.clearCacheInternal({
				...options,
				dryRun: true
			}, false, this.accessGate.activeReaderCount),
			dryRun: false,
			eligible: false,
			confirmationToken: void 0
		};
		try {
			return await this.clearCacheInternal(options, true, 0);
		} finally {
			releaseExclusive();
		}
	}
	async clearCacheInternal(options, exclusiveAcquired, activeAccessCount) {
		const resultLimit = boundedLimit(options.resultLimit, DEFAULT_RESULT_SCAN_LIMIT, MAX_RESULT_SCAN_LIMIT, "resultLimit");
		const diagnosticLimit = boundedLimit(options.diagnosticLimit, DEFAULT_DIAGNOSTIC_LIMIT, MAX_DIAGNOSTIC_LIMIT, "diagnosticLimit");
		const dryRun = options.dryRun !== false;
		const diagnostics = createDiagnostics(diagnosticLimit);
		const references = await this.collectJobReferences(options.signal, diagnostics);
		const planned = [];
		const plannedTotals = {
			value: 0,
			saturated: false
		};
		const deletedTotals = {
			value: 0,
			saturated: false
		};
		let unsafeResultCount = 0;
		let deletedCount = 0;
		const deletedCacheKeys = /* @__PURE__ */ new Set();
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
		} else if (references.report.complete && resultsKind === "directory") traversal = await this.visitPublishedResults(resultLimit, options.signal, diagnostics, async (cacheKey, resultDir) => {
			if (!await isSafeExistingDirectoryChain(resultDir, options.signal)) {
				unsafeResultCount++;
				skippedCount++;
				addDiagnostic(diagnostics, "published-results", cacheKey, "unsafe-result");
				return;
			}
			const usage = await collectUsage(resultDir, options.signal);
			if (usage.skippedSymlinkCount > 0 || usage.unexpectedEntryCount > 0 || usage.unreadableEntryCount > 0 || usage.depthLimitCount > 0) {
				unsafeResultCount++;
				skippedCount++;
				addDiagnostic(diagnostics, "published-results", cacheKey, "unsafe-result");
				return;
			}
			planned.push({
				cacheKey,
				resultDir,
				byteUsage: usage.bytes,
				byteUsageSaturated: usage.bytesSaturated
			});
			addTotal(plannedTotals, usage.bytes, usage.bytesSaturated);
		});
		const token = cacheClearConfirmationToken(planned.map((entry) => entry.cacheKey));
		const activeOperationCount = this.operations.activeOperationCount();
		const preflightEligible = references.report.complete && references.activeJobCount === 0 && activeOperationCount === 0 && activeAccessCount === 0 && traversal.complete && !traversal.truncated && unsafeResultCount === 0;
		const tokenMatches = dryRun || typeof options.confirmationToken === "string" && options.confirmationToken === token;
		const eligible = preflightEligible && tokenMatches && (dryRun || exclusiveAcquired);
		if (!dryRun && eligible) for (const entry of planned) {
			options.signal?.throwIfAborted();
			try {
				if (!await isSafeExistingDirectoryChain(entry.resultDir, options.signal) || !await makeTreeWritable(entry.resultDir, options.signal)) {
					skippedCount++;
					continue;
				}
				const revalidated = await collectUsage(entry.resultDir, options.signal);
				if (!(await isSafeExistingDirectoryChain(entry.resultDir, options.signal) && revalidated.skippedSymlinkCount === 0 && revalidated.unexpectedEntryCount === 0 && revalidated.unreadableEntryCount === 0 && revalidated.depthLimitCount === 0)) {
					skippedCount++;
					await restoreTreeReadOnly(entry.resultDir);
					continue;
				}
				await rm(entry.resultDir, {
					recursive: true,
					force: false,
					maxRetries: 1
				});
				deletedCount++;
				deletedCacheKeys.add(entry.cacheKey);
				addTotal(deletedTotals, entry.byteUsage, entry.byteUsageSaturated);
			} catch (error) {
				if (!isMissing(error)) {
					skippedCount++;
					await restoreTreeReadOnly(entry.resultDir);
				}
			}
		}
		return {
			generatedAt: Date.now(),
			dryRun,
			eligible,
			activeJobCount: references.activeJobCount,
			activeOperationCount,
			activeAccessCount,
			...dryRun && preflightEligible && planned.length > 0 ? { confirmationToken: token } : {},
			plannedCount: planned.length,
			plannedBytes: plannedTotals.value,
			plannedBytesSaturated: plannedTotals.saturated,
			deletedCount,
			deletedBytes: deletedTotals.value,
			deletedBytesSaturated: deletedTotals.saturated,
			skippedCount,
			jobScan: references.report,
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
		this.assertLockHeld();
		const resultLimit = boundedLimit(options.resultLimit, DEFAULT_RESULT_SCAN_LIMIT, MAX_RESULT_SCAN_LIMIT, "resultLimit");
		const candidateLimit = boundedLimit(options.candidateLimit, DEFAULT_GC_CANDIDATE_LIMIT, MAX_GC_CANDIDATE_LIMIT, "candidateLimit");
		const diagnosticLimit = boundedLimit(options.diagnosticLimit, DEFAULT_DIAGNOSTIC_LIMIT, MAX_DIAGNOSTIC_LIMIT, "diagnosticLimit");
		const diagnostics = createDiagnostics(diagnosticLimit);
		const references = await this.collectJobReferences(options.signal, diagnostics);
		const candidates = [];
		const candidateTotals = {
			value: 0,
			saturated: false
		};
		let candidateCount = 0;
		let referencedResultCount = 0;
		let invalidResultCount = 0;
		let unsafeResultCount = 0;
		let traversal = {
			scanned: 0,
			truncated: false,
			complete: true
		};
		if (references.report.complete) traversal = await this.visitPublishedResults(resultLimit, options.signal, diagnostics, async (cacheKey, resultDir) => {
			const inspection = await this.results.inspectPublished(cacheKey, options.signal);
			if (inspection.status !== "valid") {
				invalidResultCount++;
				addDiagnostic(diagnostics, "published-results", cacheKey, inspection.status === "missing" ? "missing-result" : inspection.status === "unreadable" ? "unreadable-entry" : "corrupt-result");
				return;
			}
			const usage = await collectUsage(resultDir, options.signal);
			if (usage.skippedSymlinkCount > 0 || usage.unexpectedEntryCount > 0 || usage.unreadableEntryCount > 0 || usage.depthLimitCount > 0) {
				unsafeResultCount++;
				addDiagnostic(diagnostics, "published-results", cacheKey, "unsafe-result");
				return;
			}
			if (references.cacheKeys.has(cacheKey)) {
				referencedResultCount++;
				return;
			}
			candidateCount++;
			addTotal(candidateTotals, usage.bytes, usage.bytesSaturated);
			if (candidates.length < candidateLimit) candidates.push({
				cacheKey,
				resultId: inspection.manifest.id,
				byteUsage: usage.bytes,
				byteUsageSaturated: usage.bytesSaturated
			});
		});
		return {
			generatedAt: Date.now(),
			dryRun: true,
			referencePolicy: "no-plugin-job-retention",
			eligible: references.report.complete && traversal.complete && !traversal.truncated,
			candidateCount,
			candidateBytes: candidateTotals.value,
			candidateBytesSaturated: candidateTotals.saturated,
			candidates,
			candidatesTruncated: candidateCount > candidates.length,
			candidateTotalsComplete: references.report.complete && traversal.complete && !traversal.truncated,
			referencedResultCount,
			invalidResultCount,
			unsafeResultCount,
			jobReferences: references.report,
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
	assertLockHeld() {
		if (!this.lock.isHeld()) throwMinerU("STORAGE_LOCKED", "MinerU storage maintenance requires the active process lock");
	}
	async countPublishedResultDirectories(signal) {
		return (await this.visitPublishedResults(Number.MAX_SAFE_INTEGER, signal, void 0, async () => void 0)).scanned;
	}
	async countDirectDirectories(root, parser, signal) {
		const directory = await readSafeDirectory(root);
		if (directory.kind !== "entries") return 0;
		let count = 0;
		for (const entry of directory.entries) {
			signal?.throwIfAborted();
			if (!isSafeSegment(entry.name) || entry.isSymbolicLink()) continue;
			try {
				parser(entry.name);
			} catch {
				continue;
			}
			if (await classifyNode(join(root, entry.name)) === "directory") count++;
		}
		return count;
	}
	async visitPublishedResults(limit, signal, diagnostics, visitor) {
		const root = await readSafeDirectory(this.paths.resultsDir());
		if (root.kind !== "entries") {
			this.recordDirectoryIssue(diagnostics, "published-results", "results", root.kind);
			return {
				scanned: 0,
				truncated: false,
				complete: root.kind === "missing"
			};
		}
		let scanned = 0;
		let complete = true;
		for (const prefixEntry of root.entries) {
			signal?.throwIfAborted();
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
			const prefix = await readSafeDirectory(prefixPath);
			if (prefix.kind !== "entries") {
				complete = false;
				this.recordDirectoryIssue(diagnostics, "published-results", prefixEntry.name, prefix.kind);
				continue;
			}
			for (const resultEntry of prefix.entries) {
				signal?.throwIfAborted();
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
			truncated: false,
			complete
		};
	}
	recordDirectoryIssue(diagnostics, area, entry, kind) {
		if (kind === "missing") return;
		if (kind === "symlink") addDiagnostic(diagnostics, area, entry, "symlink-skipped");
		else if (kind === "unreadable") addDiagnostic(diagnostics, area, entry, "unreadable-entry");
		else addDiagnostic(diagnostics, area, entry, "unexpected-entry");
	}
	async collectJobReferences(signal, _diagnostics) {
		signal?.throwIfAborted();
		return {
			cacheKeys: /* @__PURE__ */ new Set(),
			activeJobCount: 0,
			report: {
				complete: true,
				sessionJobCount: 0,
				activeJobCount: 0,
				referencedCacheKeyCount: 0
			}
		};
	}
};
//#endregion
//#region src/tools.ts
const failureSchema = {
	type: "object",
	properties: {
		code: { type: "string" },
		message: { type: "string" },
		retryable: { type: "boolean" },
		provider: {
			type: "string",
			enum: ["self-hosted-v2", "official-v4"]
		},
		providerCode: { type: "string" },
		traceId: { type: "string" },
		fileId: { type: "string" }
	},
	additionalProperties: false
};
const resultViewSchema = {
	type: "object",
	properties: {
		state: {
			type: "string",
			enum: ["completed"]
		},
		source: {
			type: "string",
			enum: [
				"cache",
				"shared-operation",
				"provider"
			]
		},
		cache_hit: { type: "boolean" },
		result_id: { type: "string" },
		files: {
			type: "array",
			items: {
				type: "object",
				properties: {
					file_id: { type: "string" },
					name: { type: "string" },
					artifacts: {
						type: "array",
						items: {
							type: "object",
							properties: {
								kind: { type: "string" },
								path: { type: "string" },
								bytes: { type: "integer" }
							},
							additionalProperties: false
						}
					},
					artifacts_truncated: { type: "boolean" }
				},
				additionalProperties: false
			}
		},
		markdown_preview: { type: "string" },
		preview_truncated: { type: "boolean" },
		manifest_path: { type: "string" },
		output_limit_chars: { type: "integer" }
	},
	additionalProperties: false
};
const parseOutputSchema = { oneOf: [resultViewSchema, {
	type: "object",
	properties: {
		kind: {
			type: "string",
			enum: ["batch"]
		},
		state: {
			type: "string",
			enum: [
				"completed",
				"partially-completed",
				"failed"
			]
		},
		results: {
			type: "array",
			items: { oneOf: [resultViewSchema, {
				type: "object",
				properties: {
					state: {
						type: "string",
						enum: ["failed"]
					},
					source: {
						type: "string",
						enum: [
							"cache",
							"shared-operation",
							"provider"
						]
					},
					file_id: { type: "string" },
					name: { type: "string" },
					failure: failureSchema
				},
				additionalProperties: false
			}] }
		}
	},
	additionalProperties: false
}] };
const parseParameters = {
	file_paths: {
		type: "array",
		items: { type: "string" },
		description: "Paths of local documents to parse."
	},
	model: {
		type: "string",
		enum: ["pipeline", "vlm"],
		description: "Parsing model: pipeline or vlm."
	},
	ocr: {
		type: "boolean",
		description: "Force OCR on all pages."
	},
	language: {
		type: "string",
		description: "Language hint code."
	},
	formula: {
		type: "boolean",
		description: "Enable mathematical formula recognition."
	},
	table: {
		type: "boolean",
		description: "Enable table structure recognition."
	},
	pages: {
		type: "string",
		description: "1-based page range string."
	},
	artifacts: {
		type: "array",
		items: {
			type: "string",
			enum: [
				"markdown",
				"layout",
				"model-output",
				"content-list",
				"images"
			]
		},
		description: "Artifacts to extract and retain. Default: markdown."
	}
};
const DEFAULT_RENDER_LIMIT = 16384;
const MAX_POLL_TIMEOUT_MS = 864e5;
function clampRenderText(rendered, limit = DEFAULT_RENDER_LIMIT) {
	if (!Number.isSafeInteger(limit) || limit <= 0) return "";
	if (rendered.length <= limit) return rendered;
	const suffix = "\n\n[Output truncated to limit]";
	if (29 >= limit) return suffix.slice(0, limit);
	return rendered.slice(0, limit - 29) + suffix;
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
function parseInput(args) {
	if (typeof args !== "object" || args === null || Array.isArray(args)) throw new MinerUError(failure("INVALID_REQUEST", "Tool arguments must be an object"));
	const { poll_timeout_ms: rawPollTimeout, ...input } = args;
	const pollTimeoutMs = parsePollTimeout(rawPollTimeout);
	return {
		input,
		...pollTimeoutMs === void 0 ? {} : { pollTimeoutMs }
	};
}
function renderHealth(value) {
	const lines = [
		"**MinerU Health Status**: " + (value.available ? "Available" : "Unavailable"),
		"- Provider: " + value.provider,
		"- Authentication: " + value.authentication,
		"- Protocol Version: " + value.protocol_version
	];
	if (value.server_version !== void 0) lines.push("- Server Version: " + value.server_version);
	if (value.queue !== void 0) {
		const q = value.queue;
		lines.push("- Queue: queued=" + String(q.queued ?? 0) + ", processing=" + String(q.processing ?? 0) + ", completed=" + String(q.completed ?? 0) + ", failed=" + String(q.failed ?? 0));
	}
	if (value.diagnostics !== void 0) lines.push("- Diagnostics: " + value.diagnostics);
	return [{
		type: "text",
		text: clampRenderText(lines.join("\n"))
	}];
}
function renderResult(value) {
	const lines = [
		"**MinerU Parse Result**",
		"- Source: " + value.source,
		"- Cache Hit: " + (value.cache_hit ? "Yes" : "No"),
		"- Result ID: " + value.result_id,
		"- Manifest: " + value.manifest_path
	];
	if (value.files.length > 0) {
		lines.push("\n### Artifact Files:");
		for (const file of value.files) {
			lines.push("- **" + file.name + "**:");
			for (const artifact of file.artifacts) lines.push("  - " + artifact.kind + " (" + String(artifact.bytes) + " bytes): " + artifact.path);
			if (file.artifacts_truncated) lines.push("  - *(Artifact list truncated to output limit)*");
		}
	}
	if (value.markdown_preview !== void 0) {
		lines.push("\n### Markdown Preview:", value.markdown_preview);
		if (value.preview_truncated) lines.push("\n*(Preview truncated to output limit)*");
	}
	return [{
		type: "text",
		text: clampRenderText(lines.join("\n"), value.output_limit_chars)
	}];
}
function renderFailure(value) {
	return "**" + value.name + "**: [" + value.failure.code + "] " + value.failure.message;
}
function renderParseDocument(value) {
	if (!("kind" in value)) return renderResult(value);
	const sections = value.results.map((result) => result.state === "completed" ? renderResult(result)[0]?.text ?? "" : renderFailure(result));
	return [{
		type: "text",
		text: clampRenderText("**MinerU Batch Result**\n- State: " + value.state + "\n- Results: " + String(value.results.length) + "\n\n" + sections.join("\n\n"))
	}];
}
function backgroundLabel(input) {
	const count = Array.isArray(input.file_paths) ? input.file_paths.length : 0;
	return "Parse " + String(count) + " document" + (count === 1 ? "" : "s") + " with MinerU";
}
function nativeSuccessOutcome(value) {
	const output = renderParseDocument(value)[0]?.text ?? JSON.stringify(value);
	if ("kind" in value && value.state === "failed") return {
		status: "failed",
		detail: "batch-failed",
		output
	};
	return {
		status: "completed",
		detail: "kind" in value ? value.state : "completed",
		output
	};
}
function registerTools(ctx, getService, accessGate) {
	const disposers = [];
	const backgroundInvocations = /* @__PURE__ */ new Set();
	const withStorageAccess = async (operation) => {
		return accessGate === void 0 ? await operation() : await accessGate.runShared(operation);
	};
	disposers.push(ctx.tools.register(defineTool({
		name: "mineru_health",
		description: "Check MinerU backend connectivity, authentication status, and queue capacity.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				properties: {
					available: { type: "boolean" },
					provider: {
						type: "string",
						enum: ["self-hosted-v2", "official-v4"]
					},
					authentication: {
						type: "string",
						enum: [
							"valid",
							"invalid",
							"not-configured",
							"unknown"
						]
					},
					protocol_version: { type: "string" },
					server_version: { type: "string" },
					queue: {
						type: "object",
						properties: {
							queued: { type: "integer" },
							processing: { type: "integer" },
							completed: { type: "integer" },
							failed: { type: "integer" },
							max_concurrent: { type: "integer" }
						},
						additionalProperties: false
					},
					diagnostics: { type: "string" }
				},
				additionalProperties: false
			},
			render: (_args, value) => renderHealth(value)
		},
		execute: async (_args, exec) => {
			requireAgent(exec);
			return await getService().probe(exec.signal);
		}
	})));
	disposers.push(ctx.tools.register(defineTool({
		name: "mineru_submit_parse_job",
		description: "Start document parsing as a native DSH background job. Returns a job ID immediately; use job_output to collect the final result and job_kill to cancel it.",
		parameters: parseParameters,
		output: {
			schema: {
				type: "object",
				properties: {
					job_id: { type: "string" },
					state: {
						type: "string",
						enum: ["running"]
					}
				},
				additionalProperties: false
			},
			render: (_args, value) => {
				return [{
					type: "text",
					text: "Started native MinerU background job " + value.job_id + "."
				}];
			}
		},
		execute: async (args, exec) => {
			const agent = requireAgent(exec);
			exec.signal.throwIfAborted();
			const { input } = parseInput(args);
			const jobs = ctx.get("jobs");
			if (jobs === void 0) throw new MinerUError(failure("PROVIDER_UNAVAILABLE", "Native DSH background jobs are unavailable; load the jobs registry and job tools"));
			const controller = new AbortController();
			return {
				job_id: jobs.start({
					kind: "mineru",
					label: backgroundLabel(input),
					owner: agent,
					run: () => {
						const done = withStorageAccess(() => getService().parseDocument(agent.session, input, controller.signal, null)).then((value) => nativeSuccessOutcome(value)).catch((error) => {
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
		name: "mineru_parse_document",
		description: "Parse documents and synchronously return immutable result manifests, previews, and artifact paths. This call does not create a plugin Job.",
		parameters: {
			...parseParameters,
			poll_timeout_ms: {
				type: "integer",
				description: "Maximum synchronous wait in milliseconds. A timeout leaves the shared producer running; retry the same request to rejoin it."
			}
		},
		output: {
			schema: parseOutputSchema,
			render: (_args, value) => renderParseDocument(value)
		},
		execute: async (args, exec) => {
			const agent = requireAgent(exec);
			const { input, pollTimeoutMs } = parseInput(args);
			return await withStorageAccess(() => getService().parseDocument(agent.session, input, exec.signal, pollTimeoutMs));
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
function fail(message, code = "internal") {
	return {
		ok: false,
		error: {
			code,
			message: sanitizeDiagnostic(message)
		}
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
					if (!Object.prototype.hasOwnProperty.call(p, "config") || p.config === void 0 || p.config === null) throw new TypeError("payload.config must be a non-null configuration object");
					return ok({ config: await deps.setConfig(migrateConfig(p.config)) });
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
				default: return fail(`unknown endpoint: ${endpoint}`, "not-found");
			}
		} catch (err) {
			return fail(err instanceof Error ? err.message : String(err), err instanceof TypeError ? "invalid-argument" : "internal");
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
	type: z.string(),
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
	type: z.string(),
	baseURL: z.string(),
	apiKeyEnv: z.string().role("credential-ref"),
	models: z.array(z.union(["pipeline", "vlm"])),
	configuredVersion: z.string()
})]);
const Config = z.object({
	schemaVersion: z.number(),
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
		table: z.boolean(),
		artifacts: z.array(z.union([
			"markdown",
			"layout",
			"model-output",
			"content-list",
			"images"
		]))
	}),
	storage: z.object({
		storageRoot: z.string(),
		cacheEnabled: z.boolean(),
		retainSources: z.boolean(),
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
		maxFilesPerRequest: z.number(),
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
	return migrateConfig({
		...current,
		activeProvider: id,
		providers: [value]
	}).providers[0];
}
async function apply(ctx, entryConfig = {}) {
	let persistedConfig = migrateConfig(entryConfig);
	let fixedStorageRoot;
	let toolDisposer;
	let operations;
	const startup = new AbortController();
	ctx.effect(() => () => startup.abort(), "dsh-pdf-mineru startup cancellation");
	const validateRuntimeConfig = (value) => {
		const next = migrateConfig(value);
		if (fixedStorageRoot !== void 0 && next.storage.storageRoot !== fixedStorageRoot) throw new TypeError("storage.storageRoot cannot change while the MinerU plugin is running");
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
	ctx.effect(() => settingsScope.watch((next) => {
		persistedConfig = validateRuntimeConfig(next);
	}), "dsh-pdf-mineru settings watch");
	const paths = new StoragePaths(fixedStorageRoot);
	const lock = new ProcessLock(paths);
	try {
		await lock.acquire(startup.signal);
		startup.signal.throwIfAborted();
		const operationRegistry = new SharedOperationRegistry();
		operations = operationRegistry;
		const accessGate = new StorageAccessGate();
		const results = new ResultRepository(paths, {
			maxArtifactBytes: persistedConfig.limits.maxZipEntryBytes,
			maxJsonValidationBytes: Math.min(persistedConfig.limits.maxZipEntryBytes, 67108864)
		});
		await results.cleanupStaging(persistedConfig.storage.stagingTtlMs, operationRegistry.activeOperationIds(), startup.signal);
		startup.signal.throwIfAborted();
		const maintenance = new StorageMaintenanceService(paths, results, operationRegistry, lock, accessGate);
		const service = new MinerUService({
			getConfig: runtimeConfig,
			providers: new ProviderRegistry(runtimeConfig),
			results,
			operations: operationRegistry,
			diagnostics: createStructuredDiagnosticSink(ctx.logger),
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
				await lock.release();
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
		await lock.release();
		if (startup.signal.aborted || isInactiveContextError(error)) return async () => void 0;
		throw error;
	}
}
//#endregion
export { ARTIFACT_KINDS, CACHE_KEY_SPEC_VERSION, CANONICAL_PARSE_REQUEST_SCHEMA_VERSION, Config, DEFAULT_RETRY_POLICY, MINERU_RESULT_MANIFEST_SCHEMA_VERSION, MinerUError, MinerUService, OfficialV4Provider, RESULT_SCHEMA_VERSION, SelfHostedV2Provider, StorageMaintenanceService, apply, asCacheKey, asFileId, asJobId, asOperationId, asProviderConfigId, asResultId, asSessionId, assertSafePathSegment, calculateBackoffDelay, createFileId, createJobId, createOperationId, createStructuredDiagnosticSink, defaultMinerUConfig, defaultSleep, emitDiagnostic, executeWithRetry, failure, inject, isRetryableError, isRetryableHttpStatus, mergeRetryOptions, migrateConfig, name, normalizeArtifactKinds, normalizePageRanges, parseRetryAfter, providerById, readBoundedResponseText, resolveRetryPolicy, resultIdForCacheKey, sanitizeDiagnostic, throwMinerU, toMinerUFailure, validateProviderCapabilities };
