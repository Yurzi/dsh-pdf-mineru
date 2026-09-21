window.__ModuleLoader__.load({
	id: "dsh-pdf-mineru",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/domain/ids.ts
		const PREFIXED_ID = /^(?:mr|mf|mp|mo)_[A-Za-z0-9][A-Za-z0-9._-]{0,123}$/;
		function assertPrefixedId(value, prefix) {
			if (!value.startsWith(`${prefix}_`) || !PREFIXED_ID.test(value)) throw new TypeError(`invalid ${prefix} identifier`);
			return value;
		}
		const asProviderConfigId = (value) => assertPrefixedId(value, "mp");
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
		const DEFAULT_OUTPUT_CONFIG = {
			maxInlineChars: 12e3,
			maxInlineImages: 6
		};
		const DEFAULT_STORAGE_OPTIONS = {
			cacheEnabled: true,
			retainSources: false,
			stagingTtlMs: 864e5
		};
		//#endregion
		//#region src/client/helpers.ts
		const PROVIDER_TYPES = ["self-hosted-v2", "official-v4"];
		function ensureProviderProfiles(config) {
			const providers = [...config.providers];
			for (const type of PROVIDER_TYPES) {
				if (providers.some((provider) => provider.type === type)) continue;
				const defaults = defaultProviderConfig(type);
				let id = defaults.id;
				for (let suffix = 2; providers.some((provider) => provider.id === id); suffix++) id = asProviderConfigId(defaults.id + "_" + String(suffix));
				providers.push({
					...defaults,
					id
				});
			}
			return providers.length === config.providers.length ? config : {
				...config,
				providers
			};
		}
		function patchActiveProvider(config, patch) {
			const activeId = config.activeProvider;
			const providers = config.providers.map((p) => {
				if (p.id !== activeId) return p;
				return {
					...p,
					...patch
				};
			});
			return {
				...config,
				providers
			};
		}
		function normalizeProviderDefaults(config, provider) {
			if (provider.type !== "official-v4") return config;
			const model = provider.models.includes(config.defaults.model) ? config.defaults.model : provider.models[0];
			if (model === void 0) return config;
			const parseMethod = config.defaults.parseMethod === "txt" ? "auto" : config.defaults.parseMethod;
			if (model === config.defaults.model && parseMethod === config.defaults.parseMethod) return config;
			return {
				...config,
				defaults: {
					...config.defaults,
					model,
					parseMethod,
					ocr: parseMethod === "ocr"
				}
			};
		}
		function activateProvider(config, providerId) {
			const provider = config.providers.find((candidate) => candidate.id === providerId);
			if (provider === void 0 || provider.id === config.activeProvider) return config;
			return normalizeProviderDefaults({
				...config,
				activeProvider: provider.id
			}, provider);
		}
		function updateConfigSection(config, section, patch) {
			const current = config[section];
			if (typeof current === "object" && current !== null && !Array.isArray(current)) return {
				...config,
				[section]: {
					...current,
					...patch
				}
			};
			return {
				...config,
				[section]: patch
			};
		}
		async function callRpc(rpc, endpoint, payload) {
			return rpc.call("/dsh-pdf-mineru-api", endpoint, payload);
		}
		function credentialReference(provider) {
			const reference = provider?.apiKeyEnv?.trim();
			return reference === void 0 || reference.length === 0 ? void 0 : reference;
		}
		async function describeCredential(credentials, reference) {
			const result = await credentials.describe([reference]);
			if (!result.ok) throw new Error(result.error.message);
			return result.value[reference] ?? {
				configured: false,
				writable: true
			};
		}
		async function storeCredential(credentials, reference, value) {
			const secret = value.trim();
			if (secret.length === 0) throw new TypeError("API key must not be empty");
			const result = await credentials.set(reference, secret);
			if (!result.ok) throw new Error(result.error.message);
		}
		async function clearCredential(credentials, reference) {
			const result = await credentials.unset(reference);
			if (!result.ok) throw new Error(result.error.message);
		}
		function resetConfigSection(config, section) {
			switch (section) {
				case "defaults": {
					const active = config.providers.find((p) => p.id === config.activeProvider) ?? config.providers[0];
					const next = {
						...config,
						defaults: { ...DEFAULT_PARSE_DEFAULTS }
					};
					return active !== void 0 ? normalizeProviderDefaults(next, active) : next;
				}
				case "polling": return {
					...config,
					polling: { ...DEFAULT_POLLING_CONFIG }
				};
				case "retry": return {
					...config,
					retry: { ...DEFAULT_RETRY_CONFIG }
				};
				case "output": return {
					...config,
					output: { ...DEFAULT_OUTPUT_CONFIG }
				};
				case "storage": return {
					...config,
					storage: {
						...config.storage,
						cacheEnabled: DEFAULT_STORAGE_OPTIONS.cacheEnabled,
						stagingTtlMs: DEFAULT_STORAGE_OPTIONS.stagingTtlMs,
						retainSources: DEFAULT_STORAGE_OPTIONS.retainSources
					}
				};
				case "providers": {
					const providers = config.providers.map((p) => ({
						...defaultProviderConfig(p.type),
						id: p.id
					}));
					const active = providers.find((p) => p.id === config.activeProvider) ?? providers[0];
					const next = {
						...config,
						providers
					};
					return active !== void 0 ? normalizeProviderDefaults(next, active) : next;
				}
				default: return config;
			}
		}
		function resetToDefaultConfig(current) {
			const selfHosted = defaultProviderConfig("self-hosted-v2");
			const official = defaultProviderConfig("official-v4");
			return {
				schemaVersion: current.schemaVersion,
				activeProvider: selfHosted.id,
				providers: [selfHosted, official],
				defaults: { ...DEFAULT_PARSE_DEFAULTS },
				storage: {
					...current.storage,
					cacheEnabled: DEFAULT_STORAGE_OPTIONS.cacheEnabled,
					stagingTtlMs: DEFAULT_STORAGE_OPTIONS.stagingTtlMs,
					retainSources: DEFAULT_STORAGE_OPTIONS.retainSources
				},
				polling: { ...DEFAULT_POLLING_CONFIG },
				retry: { ...DEFAULT_RETRY_CONFIG },
				output: { ...DEFAULT_OUTPUT_CONFIG },
				limits: current.limits
			};
		}
		//#endregion
		//#region src/client/icons.tsx
		function ChevronIcon({ size = 14, className, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				className,
				...props,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 6l4 4 4-4" })
			});
		}
		function ServerIcon({ size = 16, className, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				className,
				...props,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "2",
						y: "2",
						width: "20",
						height: "8",
						rx: "2",
						ry: "2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "2",
						y: "14",
						width: "20",
						height: "8",
						rx: "2",
						ry: "2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "6",
						y1: "6",
						x2: "6.01",
						y2: "6"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "6",
						y1: "18",
						x2: "6.01",
						y2: "18"
					})
				]
			});
		}
		function SlidersIcon({ size = 16, className, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				className,
				...props,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "4",
						y1: "21",
						x2: "4",
						y2: "14"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "4",
						y1: "10",
						x2: "4",
						y2: "3"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "12",
						y1: "21",
						x2: "12",
						y2: "12"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "12",
						y1: "8",
						x2: "12",
						y2: "3"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "20",
						y1: "21",
						x2: "20",
						y2: "16"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "20",
						y1: "12",
						x2: "20",
						y2: "3"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "1",
						y1: "14",
						x2: "7",
						y2: "14"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "9",
						y1: "8",
						x2: "15",
						y2: "8"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "17",
						y1: "16",
						x2: "23",
						y2: "16"
					})
				]
			});
		}
		function DatabaseIcon({ size = 16, className, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				className,
				...props,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ellipse", {
						cx: "12",
						cy: "5",
						rx: "9",
						ry: "3"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" })
				]
			});
		}
		function ClockIcon({ size = 16, className, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				className,
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "12",
					cy: "12",
					r: "10"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "12 6 12 12 16 14" })]
			});
		}
		function RotateCwIcon({ size = 16, className, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				className,
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "23 4 23 10 17 10" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M20.49 15a9 9 0 1 1-2.12-9.36L23 10" })]
			});
		}
		function FileTextIcon({ size = 16, className, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				className,
				...props,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "14 2 14 8 20 8" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "16",
						y1: "13",
						x2: "8",
						y2: "13"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "16",
						y1: "17",
						x2: "8",
						y2: "17"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "10 9 9 9 8 9" })
				]
			});
		}
		function ShieldCheckIcon({ size = 16, className, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				className,
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "9 12 11 14 15 10" })]
			});
		}
		function WrenchIcon({ size = 16, className, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				className,
				...props,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" })
			});
		}
		function CheckIcon({ size = 14, className, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2.2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				className,
				...props,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "3 8.5 6.5 12 13 4.5" })
			});
		}
		function ActivityIcon({ size = 14, className, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				className,
				...props,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "22 12 18 12 15 21 9 3 6 12 2 12" })
			});
		}
		function RotateCcwIcon({ size = 12, className, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				className,
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "1 4 1 10 7 10" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3.51 15a9 9 0 1 0 2.13-9.36L1 10" })]
			});
		}
		function KeyIcon({ size = 14, className, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				className,
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M21 2l-2 2m-1.5 1.5L16 7l-1.5-1.5M19 4l-4 4m-2 2l-6 6a5 5 0 1 1-7-7l6-6 4 4" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "7.5",
					cy: "16.5",
					r: "1.5"
				})]
			});
		}
		//#endregion
		//#region \0dsh-css:/mnt/data/yurzi/Workspaces/dsh/dsh-pdf-mineru/src/client/SettingsPage.module.css.mjs
		const css = ".dshm_o5Lh3q_section{box-sizing:border-box;width:100%;min-width:0;max-width:840px;color:var(--dsw-alias-label-primary,inherit);flex-direction:column;gap:16px;padding-bottom:40px;display:flex;container-type:inline-size}.dshm_o5Lh3q_headerArea{flex-direction:column;gap:12px;display:flex}.dshm_o5Lh3q_headerTitles{flex-direction:column;gap:4px;display:flex}.dshm_o5Lh3q_title{letter-spacing:-.01em;color:var(--dsw-alias-label-primary,inherit);margin:0;font-size:18px;font-weight:600;line-height:26px}.dshm_o5Lh3q_intro{color:var(--dsw-alias-label-tertiary,#7b818b);margin:0;font-size:13px;line-height:18px}.dshm_o5Lh3q_actionBar{flex-wrap:wrap;align-items:center;gap:10px;padding-top:4px;display:flex}.dshm_o5Lh3q_primaryButton{box-sizing:border-box;background:var(--dsw-alias-button-primary-fill,#111827);height:34px;color:var(--dsw-alias-label-primary-foreground,#fff);cursor:pointer;border:1px solid #0000;border-radius:8px;justify-content:center;align-items:center;gap:6px;padding:0 16px;font-size:13px;font-weight:500;transition:background-color .15s,opacity .15s,transform .1s;display:inline-flex}.dshm_o5Lh3q_primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#2b3544)}.dshm_o5Lh3q_primaryButton:disabled{opacity:.45;cursor:default}.dshm_o5Lh3q_primaryButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:2px}.dshm_o5Lh3q_secondaryButton{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);background:var(--dsw-alias-bg-layer-3,#fff);height:34px;color:var(--dsw-alias-label-secondary,#374151);font:inherit;cursor:pointer;white-space:nowrap;border-radius:8px;justify-content:center;align-items:center;gap:6px;padding:0 14px;font-size:13px;font-weight:500;transition:background-color .15s,border-color .15s,color .15s;display:inline-flex}.dshm_o5Lh3q_secondaryButton:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#edf0f3);border-color:var(--dsw-alias-label-dimmed,#9ca3af);color:var(--dsw-alias-label-primary,inherit)}.dshm_o5Lh3q_secondaryButton:disabled{opacity:.45;cursor:default}.dshm_o5Lh3q_secondaryButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:2px}.dshm_o5Lh3q_dangerButton{box-sizing:border-box;border:1px solid var(--dsw-alias-state-error-primary,#ef4444);height:34px;color:var(--dsw-alias-state-error-primary,#ef4444);font:inherit;cursor:pointer;background:0 0;border-radius:8px;justify-content:center;align-items:center;gap:6px;padding:0 14px;font-size:13px;font-weight:500;transition:background-color .15s,opacity .15s,border-color .15s;display:inline-flex}.dshm_o5Lh3q_dangerButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,#ef44441a);border-color:var(--dsw-alias-state-error-primary,#ef4444)}.dshm_o5Lh3q_dangerButton:disabled{opacity:.45;cursor:default}.dshm_o5Lh3q_dangerButton:focus-visible{outline:2px solid var(--dsw-alias-state-error-primary,#ef4444);outline-offset:2px}.dshm_o5Lh3q_textButton{appearance:none;color:var(--dsw-alias-label-tertiary,#7b818b);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:6px;padding:6px 8px;font-size:12.5px;font-weight:500;transition:color .15s,background-color .15s}.dshm_o5Lh3q_textButton:hover{color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-layer-2,#edf0f3)}.dshm_o5Lh3q_textButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:1px}.dshm_o5Lh3q_resetButton{appearance:none;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);background:var(--dsw-alias-bg-layer-3,#f9fafb);color:var(--dsw-alias-label-secondary,inherit);font:inherit;cursor:pointer;white-space:nowrap;border-radius:6px;align-items:center;gap:4px;padding:3px 8px;font-size:11.5px;transition:background-color .15s,border-color .15s,color .15s;display:inline-flex}.dshm_o5Lh3q_resetButton:hover{background:var(--dsw-alias-bg-layer-2,#edf0f3);border-color:var(--dsw-alias-label-dimmed,#9ca3af);color:var(--dsw-alias-label-primary,inherit)}.dshm_o5Lh3q_resetButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:1px}.dshm_o5Lh3q_resetIcon{color:var(--dsw-alias-label-tertiary,#7b818b);flex:none}.dshm_o5Lh3q_error{border:1px solid var(--dsw-alias-state-error-primary,#ef4444);background:var(--dsw-alias-interactive-bg-hover-danger,#ef444414);color:var(--dsw-alias-state-error-primary,#ef4444);border-radius:8px;justify-content:space-between;align-items:center;gap:10px;margin:0;padding:10px 14px;font-size:12.5px;line-height:18px;display:flex}.dshm_o5Lh3q_errorDismiss{color:inherit;cursor:pointer;background:0 0;border:none;border-radius:4px;flex:none;padding:2px 6px;font-size:18px;line-height:1}.dshm_o5Lh3q_errorDismiss:hover{background:#00000014}.dshm_o5Lh3q_warningNotice{border:1px solid var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#d97706));background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-state-warning-tertiary,#d9770614));color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#d97706));border-radius:8px;justify-content:space-between;align-items:center;gap:10px;margin:0;padding:10px 14px;font-size:12.5px;line-height:18px;display:flex}.dshm_o5Lh3q_noticeDismiss{color:inherit;cursor:pointer;background:0 0;border:none;border-radius:4px;flex:none;padding:2px 6px;font-size:18px;line-height:1}.dshm_o5Lh3q_noticeDismiss:hover{background:#00000014}.dshm_o5Lh3q_loading{color:var(--dsw-alias-label-tertiary,#7b818b);padding:24px 0;font-size:14px;line-height:22px}.dshm_o5Lh3q_testResult{border-radius:8px;flex-direction:column;gap:6px;padding:12px 14px;font-size:12.5px;line-height:18px;display:flex}.dshm_o5Lh3q_testResultHealthy{background:var(--dsw-alias-state-success-tertiary,#10b98114);color:var(--dsw-alias-state-success-primary,#15803d);border:1px solid #10b98166}.dshm_o5Lh3q_testResultError{background:var(--dsw-alias-interactive-bg-hover-danger,#ef44440f);color:var(--dsw-alias-state-error-primary,#b91c1c);border:1px solid #ef444466}.dshm_o5Lh3q_testResultTesting{background:var(--dsw-alias-bg-layer-2,#edf0f3);border:1px solid var(--dsw-alias-border-l2,#d7dbe0);color:var(--dsw-alias-label-secondary,inherit)}.dshm_o5Lh3q_testHeader{align-items:center;gap:8px;font-size:13px;font-weight:600;display:flex}.dshm_o5Lh3q_testDetails{font-family:var(--ds-font-family-code,monospace);color:var(--dsw-alias-label-secondary,inherit);opacity:.9;font-size:11.5px;line-height:1.5}.dshm_o5Lh3q_cardList{flex-direction:column;gap:12px;display:flex}.dshm_o5Lh3q_card{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-3,#fff);box-sizing:border-box;border-radius:12px;list-style:none;transition:border-color .16s,background-color .16s;overflow:hidden}.dshm_o5Lh3q_card:hover{border-color:var(--dsw-alias-label-dimmed,#9ca3af)}.dshm_o5Lh3q_cardOpen{background:var(--dsw-alias-bg-layer-3,#fff);border-color:var(--dsw-alias-border-l2,#d7dbe0)}.dshm_o5Lh3q_cardHeader{user-select:none;background:0 0;justify-content:space-between;align-items:center;gap:10px;padding:14px 16px;display:flex}.dshm_o5Lh3q_cardHeadButton{appearance:none;min-width:0;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:6px;flex:1;justify-content:space-between;align-items:center;gap:12px;padding:0;display:flex}.dshm_o5Lh3q_cardHeadButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:4px}.dshm_o5Lh3q_cardHeadLeft{flex:1;align-items:center;gap:10px;min-width:0;display:flex}.dshm_o5Lh3q_cardIcon{background:var(--dsw-alias-bg-layer-2,#f3f4f6);width:28px;height:28px;color:var(--dsw-alias-label-secondary,#4b5563);border-radius:8px;flex:none;justify-content:center;align-items:center;transition:background-color .15s,color .15s;display:inline-flex}.dshm_o5Lh3q_cardOpen .dshm_o5Lh3q_cardIcon{color:var(--dsw-alias-brand-primary,#4c78ff);background:#4c78ff14}.dshm_o5Lh3q_cardHeadTitles{flex-direction:column;gap:2px;min-width:0;display:flex}.dshm_o5Lh3q_cardTitle{color:var(--dsw-alias-label-primary,inherit);margin:0;font-size:15px;font-weight:600;line-height:1.4}.dshm_o5Lh3q_cardSubtitle{color:var(--dsw-alias-label-tertiary,#7b818b);white-space:nowrap;text-overflow:ellipsis;font-size:13px;line-height:1.45;display:block;overflow:hidden}.dshm_o5Lh3q_cardHeadRight{flex:none;align-items:center;gap:10px;display:flex}.dshm_o5Lh3q_cardHeaderAction{flex:none;align-items:center;display:flex}.dshm_o5Lh3q_chevron{color:var(--dsw-alias-label-tertiary,#7b818b);flex:none;justify-content:center;align-items:center;transition:transform .2s cubic-bezier(.4,0,.2,1);display:inline-flex}.dshm_o5Lh3q_chevronOpen{transform:rotate(180deg)}.dshm_o5Lh3q_cardBody{border-top:1px solid var(--dsw-alias-border-l2,#eee);flex-direction:column;gap:14px;padding:16px;display:flex}.dshm_o5Lh3q_cardBadgeGroup{flex-wrap:wrap;align-items:center;gap:6px;display:flex}.dshm_o5Lh3q_cardBadge{border:1px solid var(--dsw-alias-border-l2,#d7dbe0);color:var(--dsw-alias-label-secondary,inherit);background:var(--dsw-alias-bg-layer-2,#f9fafb);white-space:nowrap;text-overflow:ellipsis;border-radius:999px;flex:none;align-items:center;gap:5px;max-width:220px;padding:2px 8px;font-size:11.5px;line-height:1.5;display:inline-flex;overflow:hidden}.dshm_o5Lh3q_inlineBadge{border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:999px;align-items:center;gap:4px;padding:1px 7px;font-size:11px;line-height:1.4;display:inline-flex}.dshm_o5Lh3q_badgeDot{background:currentColor;border-radius:50%;flex:none;width:6px;height:6px}.dshm_o5Lh3q_badgePulseDot{background:currentColor;border-radius:50%;flex:none;width:7px;height:7px;animation:1.2s ease-in-out infinite dshm_o5Lh3q_badgePulse}@keyframes dshm_o5Lh3q_badgePulse{0%,to{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.85)}}.dshm_o5Lh3q_badgeOk{color:#15803d;background:#22c55e14;border-color:#22c55e73}.dshm_o5Lh3q_badgeWarn{border-color:var(--dsw-alias-state-warn-primary,#f59e0b73);color:var(--dsw-alias-state-warn-primary,#d97706);background:var(--dsw-alias-state-warn-tertiary,#f59e0b14)}.dshm_o5Lh3q_badgeInfo{color:var(--dsw-alias-brand-primary,#4c78ff);background:#4c78ff14;border-color:#4c78ff59}.dshm_o5Lh3q_badgeNeutral{color:var(--dsw-alias-label-tertiary,#7b818b);background:var(--dsw-alias-bg-layer-2,#f9fafb)}.dshm_o5Lh3q_sectionInner{flex-direction:column;gap:14px;display:flex}.dshm_o5Lh3q_row{box-sizing:border-box;flex-wrap:wrap;gap:12px;width:100%;display:flex}.dshm_o5Lh3q_row>.dshm_o5Lh3q_field{flex:240px;min-width:0}.dshm_o5Lh3q_field{box-sizing:border-box;flex-direction:column;gap:5px;width:100%;min-width:0;display:flex}.dshm_o5Lh3q_fieldLabelRow{justify-content:space-between;align-items:center;gap:8px;display:flex}.dshm_o5Lh3q_fieldLabel{color:var(--dsw-alias-label-primary,inherit);font-size:13px;font-weight:500;line-height:18px}.dshm_o5Lh3q_fieldHint{overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary,#7b818b);margin-top:2px;font-size:12px;line-height:17px}.dshm_o5Lh3q_checkboxField{cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary,inherit);align-items:center;gap:8px;font-size:13px;line-height:18px;display:flex}.dshm_o5Lh3q_checkboxLabel{color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:18px}.dshm_o5Lh3q_input,.dshm_o5Lh3q_select{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);background:var(--dsw-alias-bg-layer-3,transparent);width:100%;height:34px;color:var(--dsw-alias-label-primary,inherit);border-radius:8px;outline:none;padding:0 12px;font-size:13px;line-height:20px;transition:border-color .15s,box-shadow .15s}.dshm_o5Lh3q_input:focus,.dshm_o5Lh3q_select:focus{border-color:var(--dsw-alias-brand-primary,#4c78ff);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary,#4c78ff)}.dshm_o5Lh3q_input::placeholder{color:var(--dsw-alias-label-dimmed,#9ca3af)}.dshm_o5Lh3q_input:disabled,.dshm_o5Lh3q_select:disabled{opacity:.55;cursor:default;background:var(--dsw-alias-bg-layer-2,#f9fafb)}.dshm_o5Lh3q_inputWithIcon{align-items:center;width:100%;min-width:0;display:flex;position:relative}.dshm_o5Lh3q_inputIcon{color:var(--dsw-alias-label-tertiary,#7b818b);pointer-events:none;justify-content:center;align-items:center;display:inline-flex;position:absolute;left:10px}.dshm_o5Lh3q_inputPaddedLeft{padding-left:32px}.dshm_o5Lh3q_credentialInputRow{grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;display:grid}.dshm_o5Lh3q_providerPillGroup{flex-wrap:wrap;gap:8px;display:flex}.dshm_o5Lh3q_providerPill{appearance:none;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);cursor:pointer;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-secondary,inherit);font:inherit;border-radius:8px;align-items:center;gap:8px;padding:8px 14px;transition:border-color .15s,background-color .15s;display:inline-flex}.dshm_o5Lh3q_providerPill:hover{border-color:var(--dsw-alias-label-dimmed,#9ca3af)}.dshm_o5Lh3q_providerPillActive{border-color:var(--dsw-alias-brand-primary,#4c78ff);color:var(--dsw-alias-label-primary,inherit);background:#4c78ff14}.dshm_o5Lh3q_providerPillDot{border:1.5px solid var(--dsw-alias-border-l2,#9ca3af);background:0 0;border-radius:50%;flex:none;width:8px;height:8px}.dshm_o5Lh3q_providerRadioPillActive .dshm_o5Lh3q_providerPillDot{border-color:var(--dsw-alias-brand-primary,#4c78ff);background:var(--dsw-alias-brand-primary,#4c78ff)}.dshm_o5Lh3q_providerPillTitle{font-size:13px;font-weight:500}.dshm_o5Lh3q_providerPillBadge{font-size:11px;font-family:var(--ds-font-family-code,monospace);background:var(--dsw-alias-bg-layer-2,#edf0f3);color:var(--dsw-alias-label-tertiary,#7b818b);border-radius:4px;padding:1px 6px}.dshm_o5Lh3q_providerSubgroup{border-top:1px solid var(--dsw-alias-border-l2,#eee);flex-direction:column;gap:14px;padding-top:12px;display:flex}.dshm_o5Lh3q_chipGroup{flex-wrap:wrap;gap:6px;margin-top:2px;display:flex}.dshm_o5Lh3q_chip{box-sizing:border-box;overflow-wrap:anywhere;min-width:0;max-width:100%;height:auto;min-height:24px;font-size:11.5px;line-height:16px;font-family:var(--ds-font-family-code,monospace);border:1px solid var(--dsw-alias-border-l2,#d7dbe0);background:var(--dsw-alias-bg-layer-3,#f9fafb);color:var(--dsw-alias-label-secondary,inherit);cursor:pointer;user-select:none;border-radius:6px;flex-wrap:wrap;align-items:center;gap:4px;padding:2px 8px;transition:background-color .15s,border-color .15s,color .15s;display:inline-flex}.dshm_o5Lh3q_chip:hover{background:var(--dsw-alias-bg-layer-2,#edf0f3);color:var(--dsw-alias-label-primary,inherit);border-color:var(--dsw-alias-label-dimmed,#9ca3af)}.dshm_o5Lh3q_chipActive{border-color:var(--dsw-alias-brand-primary,#4c78ff);color:var(--dsw-alias-brand-primary,#4c78ff);background:#4c78ff14;font-weight:500}.dshm_o5Lh3q_chipBadge{opacity:.85;font-family:system-ui,-apple-system,sans-serif;font-size:10px}.dshm_o5Lh3q_checkboxGroup{flex-wrap:wrap;gap:14px;margin-top:4px;display:flex}.dshm_o5Lh3q_checkboxOption{color:var(--dsw-alias-label-primary,inherit);cursor:pointer;align-items:center;gap:6px;font-size:13px;display:flex}.dshm_o5Lh3q_checkboxField input[type=checkbox],.dshm_o5Lh3q_checkboxOption input[type=checkbox]{cursor:pointer;width:15px;height:15px;accent-color:var(--dsw-alias-brand-primary,#4c78ff);margin:0}.dshm_o5Lh3q_operationToolbar{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.dshm_o5Lh3q_operationError{background:var(--dsw-alias-interactive-bg-hover-danger,#ef444414);border:1px solid var(--dsw-alias-state-error-primary,#ef4444);color:var(--dsw-alias-state-error-primary,#b91c1c);overflow-wrap:anywhere;border-radius:6px;padding:8px 12px;font-size:12px;line-height:18px}.dshm_o5Lh3q_operationResult{border-top:1px solid var(--dsw-alias-border-l2,#eee);flex-direction:column;gap:8px;min-width:0;padding-top:12px;display:flex}.dshm_o5Lh3q_resultTitle{color:var(--dsw-alias-label-primary,inherit);font-size:13px;font-weight:600;line-height:20px}.dshm_o5Lh3q_metricHeaders,.dshm_o5Lh3q_metric{grid-template-columns:minmax(140px,1fr) minmax(90px,auto) minmax(60px,auto);align-items:baseline;gap:10px;display:grid}.dshm_o5Lh3q_metricHeaders{color:var(--dsw-alias-label-tertiary,#7b818b);padding-bottom:4px;font-size:11.5px;line-height:16px}.dshm_o5Lh3q_metrics{gap:6px;margin:0;display:grid}.dshm_o5Lh3q_metric dt,.dshm_o5Lh3q_metric dd{min-width:0;margin:0;font-size:12.5px;line-height:18px}.dshm_o5Lh3q_metric dt{color:var(--dsw-alias-label-secondary,inherit)}.dshm_o5Lh3q_metric dd{color:var(--dsw-alias-label-primary,inherit);text-align:right;font-variant-numeric:tabular-nums}.dshm_o5Lh3q_summaryLine{color:var(--dsw-alias-label-secondary,inherit);flex-wrap:wrap;gap:8px 18px;font-size:12.5px;line-height:18px;display:flex}.dshm_o5Lh3q_tableWrap{border:1px solid var(--dsw-alias-border-l2,#eee);border-radius:8px;width:100%;max-width:100%;overflow-x:auto}.dshm_o5Lh3q_operationTable{border-collapse:collapse;table-layout:fixed;width:100%;min-width:520px;font-size:12px;line-height:18px}.dshm_o5Lh3q_operationTable th,.dshm_o5Lh3q_operationTable td{border-bottom:1px solid var(--dsw-alias-border-l2,#eee);text-align:left;color:var(--dsw-alias-label-secondary,inherit);padding:8px 10px}.dshm_o5Lh3q_operationTable th{background:var(--dsw-alias-bg-layer-2,#f9fafb);color:var(--dsw-alias-label-tertiary,#7b818b);font-size:11.5px;font-weight:600}.dshm_o5Lh3q_operationTable th:first-child,.dshm_o5Lh3q_operationTable td:first-child{width:32px;padding-left:10px}.dshm_o5Lh3q_operationTable th:nth-child(3),.dshm_o5Lh3q_operationTable td:nth-child(3){width:80px}.dshm_o5Lh3q_operationTable th:nth-child(4),.dshm_o5Lh3q_operationTable td:nth-child(4){width:160px}.dshm_o5Lh3q_operationTable code{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,inherit);font-family:var(--ds-font-family-code,monospace);background:var(--dsw-alias-bg-layer-2,#edf0f3);border-radius:4px;padding:1px 5px;font-size:11px;display:block;overflow:hidden}.dshm_o5Lh3q_hiddenVisually{clip:rect(0, 0, 0, 0);white-space:nowrap;border:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}.dshm_o5Lh3q_badgePulse{animation:1.5s ease-in-out infinite dshm_o5Lh3q_badgePulse}.dshm_o5Lh3q_providerRadios{flex-wrap:wrap;gap:8px;display:flex}.dshm_o5Lh3q_providerRadioPill{overflow-wrap:anywhere;appearance:none;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);cursor:pointer;background:var(--dsw-alias-bg-layer-3,#fff);min-width:0;max-width:100%;color:var(--dsw-alias-label-secondary,inherit);font:inherit;user-select:none;border-radius:8px;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 14px;transition:border-color .15s,background-color .15s;display:inline-flex;position:relative}.dshm_o5Lh3q_providerRadioPill:hover{border-color:var(--dsw-alias-label-dimmed,#9ca3af);background:var(--dsw-alias-bg-layer-2,#edf0f3)}.dshm_o5Lh3q_providerRadioPillActive{border-color:var(--dsw-alias-brand-primary,#4c78ff);color:var(--dsw-alias-label-primary,inherit);background:#4c78ff14}.dshm_o5Lh3q_providerRadioPill:focus-within{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:2px}.dshm_o5Lh3q_providerRadioInput{clip:rect(0, 0, 0, 0);white-space:nowrap;border:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}.dshm_o5Lh3q_fieldsetDisabled{border:0;flex-direction:column;gap:12px;width:100%;min-width:0;margin:0;padding:0;display:flex}@media (width<=520px){.dshm_o5Lh3q_section{gap:12px;padding-bottom:24px}.dshm_o5Lh3q_cardHeader{padding:12px 14px}.dshm_o5Lh3q_cardBody{padding:14px}.dshm_o5Lh3q_cardHeadLeft{gap:8px}.dshm_o5Lh3q_cardHeadButton{flex-direction:column;align-items:stretch;gap:8px}.dshm_o5Lh3q_cardHeadLeft{gap:8px;width:100%;min-width:0}.dshm_o5Lh3q_cardIcon{width:24px;height:24px}.dshm_o5Lh3q_cardHeadTitles{width:100%;min-width:0}.dshm_o5Lh3q_cardTitle{white-space:normal;font-size:14.5px}.dshm_o5Lh3q_cardSubtitle{white-space:normal;font-size:12px}.dshm_o5Lh3q_cardHeadRight{justify-content:space-between;align-items:center;gap:8px;width:100%;display:flex}.dshm_o5Lh3q_cardBadgeGroup{flex-wrap:wrap;gap:6px;max-width:calc(100% - 24px);display:flex}.dshm_o5Lh3q_cardBadge{max-width:100%;font-size:11px}.dshm_o5Lh3q_row{flex-flow:column;gap:10px}.dshm_o5Lh3q_row>.dshm_o5Lh3q_field{flex:none;width:100%;min-width:0}.dshm_o5Lh3q_credentialInputRow{grid-template-columns:minmax(0,1fr)}.dshm_o5Lh3q_credentialInputRow>.dshm_o5Lh3q_secondaryButton{justify-self:start}.dshm_o5Lh3q_actionBar{gap:8px}.dshm_o5Lh3q_actionBar>button,.dshm_o5Lh3q_credentialInputRow>button,.dshm_o5Lh3q_operationToolbar>button{white-space:normal;overflow-wrap:anywhere;min-width:0;max-width:100%;height:auto;min-height:34px;padding-inline:10px}.dshm_o5Lh3q_operationToolbar>button{flex:140px}.dshm_o5Lh3q_metricHeaders,.dshm_o5Lh3q_metric{grid-template-columns:minmax(0,1fr) auto auto}.dshm_o5Lh3q_providerRadioPill{box-sizing:border-box;justify-content:flex-start;width:100%}}@container (width<=280px){.dshm_o5Lh3q_cardHeader{flex-direction:column;align-items:stretch;padding:10px 8px}.dshm_o5Lh3q_cardBody{padding:10px 8px}.dshm_o5Lh3q_cardHeadButton{flex-direction:row;align-items:center}.dshm_o5Lh3q_cardHeadLeft,.dshm_o5Lh3q_cardHeadTitles,.dshm_o5Lh3q_cardHeadRight{width:auto}.dshm_o5Lh3q_cardIcon,.dshm_o5Lh3q_cardSubtitle,.dshm_o5Lh3q_cardBadgeGroup,.dshm_o5Lh3q_cardHeadRight>.dshm_o5Lh3q_cardBadge{display:none}.dshm_o5Lh3q_cardTitle,.dshm_o5Lh3q_title,.dshm_o5Lh3q_intro{overflow-wrap:anywhere}.dshm_o5Lh3q_cardHeaderAction{align-self:flex-end}.dshm_o5Lh3q_providerRadioPill{padding:8px}.dshm_o5Lh3q_providerPillBadge{overflow-wrap:anywhere;min-width:0}}@media (prefers-reduced-motion:reduce){.dshm_o5Lh3q_section *,.dshm_o5Lh3q_section :before,.dshm_o5Lh3q_section :after{transition:none!important;animation:none!important}}";
		const classMap = {
			"actionBar": "dshm_o5Lh3q_actionBar",
			"badgeDot": "dshm_o5Lh3q_badgeDot",
			"badgeInfo": "dshm_o5Lh3q_badgeInfo",
			"badgeNeutral": "dshm_o5Lh3q_badgeNeutral",
			"badgeOk": "dshm_o5Lh3q_badgeOk",
			"badgePulse": "dshm_o5Lh3q_badgePulse",
			"badgePulseDot": "dshm_o5Lh3q_badgePulseDot",
			"badgeWarn": "dshm_o5Lh3q_badgeWarn",
			"card": "dshm_o5Lh3q_card",
			"cardBadge": "dshm_o5Lh3q_cardBadge",
			"cardBadgeGroup": "dshm_o5Lh3q_cardBadgeGroup",
			"cardBody": "dshm_o5Lh3q_cardBody",
			"cardHeadButton": "dshm_o5Lh3q_cardHeadButton",
			"cardHeader": "dshm_o5Lh3q_cardHeader",
			"cardHeaderAction": "dshm_o5Lh3q_cardHeaderAction",
			"cardHeadLeft": "dshm_o5Lh3q_cardHeadLeft",
			"cardHeadRight": "dshm_o5Lh3q_cardHeadRight",
			"cardHeadTitles": "dshm_o5Lh3q_cardHeadTitles",
			"cardIcon": "dshm_o5Lh3q_cardIcon",
			"cardList": "dshm_o5Lh3q_cardList",
			"cardOpen": "dshm_o5Lh3q_cardOpen",
			"cardSubtitle": "dshm_o5Lh3q_cardSubtitle",
			"cardTitle": "dshm_o5Lh3q_cardTitle",
			"checkboxField": "dshm_o5Lh3q_checkboxField",
			"checkboxGroup": "dshm_o5Lh3q_checkboxGroup",
			"checkboxLabel": "dshm_o5Lh3q_checkboxLabel",
			"checkboxOption": "dshm_o5Lh3q_checkboxOption",
			"chevron": "dshm_o5Lh3q_chevron",
			"chevronOpen": "dshm_o5Lh3q_chevronOpen",
			"chip": "dshm_o5Lh3q_chip",
			"chipActive": "dshm_o5Lh3q_chipActive",
			"chipBadge": "dshm_o5Lh3q_chipBadge",
			"chipGroup": "dshm_o5Lh3q_chipGroup",
			"credentialInputRow": "dshm_o5Lh3q_credentialInputRow",
			"dangerButton": "dshm_o5Lh3q_dangerButton",
			"error": "dshm_o5Lh3q_error",
			"errorDismiss": "dshm_o5Lh3q_errorDismiss",
			"field": "dshm_o5Lh3q_field",
			"fieldHint": "dshm_o5Lh3q_fieldHint",
			"fieldLabel": "dshm_o5Lh3q_fieldLabel",
			"fieldLabelRow": "dshm_o5Lh3q_fieldLabelRow",
			"fieldsetDisabled": "dshm_o5Lh3q_fieldsetDisabled",
			"headerArea": "dshm_o5Lh3q_headerArea",
			"headerTitles": "dshm_o5Lh3q_headerTitles",
			"hiddenVisually": "dshm_o5Lh3q_hiddenVisually",
			"inlineBadge": "dshm_o5Lh3q_inlineBadge",
			"input": "dshm_o5Lh3q_input",
			"inputIcon": "dshm_o5Lh3q_inputIcon",
			"inputPaddedLeft": "dshm_o5Lh3q_inputPaddedLeft",
			"inputWithIcon": "dshm_o5Lh3q_inputWithIcon",
			"intro": "dshm_o5Lh3q_intro",
			"loading": "dshm_o5Lh3q_loading",
			"metric": "dshm_o5Lh3q_metric",
			"metricHeaders": "dshm_o5Lh3q_metricHeaders",
			"metrics": "dshm_o5Lh3q_metrics",
			"noticeDismiss": "dshm_o5Lh3q_noticeDismiss",
			"operationError": "dshm_o5Lh3q_operationError",
			"operationResult": "dshm_o5Lh3q_operationResult",
			"operationTable": "dshm_o5Lh3q_operationTable",
			"operationToolbar": "dshm_o5Lh3q_operationToolbar",
			"primaryButton": "dshm_o5Lh3q_primaryButton",
			"providerPill": "dshm_o5Lh3q_providerPill",
			"providerPillActive": "dshm_o5Lh3q_providerPillActive",
			"providerPillBadge": "dshm_o5Lh3q_providerPillBadge",
			"providerPillDot": "dshm_o5Lh3q_providerPillDot",
			"providerPillGroup": "dshm_o5Lh3q_providerPillGroup",
			"providerPillTitle": "dshm_o5Lh3q_providerPillTitle",
			"providerRadioInput": "dshm_o5Lh3q_providerRadioInput",
			"providerRadioPill": "dshm_o5Lh3q_providerRadioPill",
			"providerRadioPillActive": "dshm_o5Lh3q_providerRadioPillActive",
			"providerRadios": "dshm_o5Lh3q_providerRadios",
			"providerSubgroup": "dshm_o5Lh3q_providerSubgroup",
			"resetButton": "dshm_o5Lh3q_resetButton",
			"resetIcon": "dshm_o5Lh3q_resetIcon",
			"resultTitle": "dshm_o5Lh3q_resultTitle",
			"row": "dshm_o5Lh3q_row",
			"secondaryButton": "dshm_o5Lh3q_secondaryButton",
			"section": "dshm_o5Lh3q_section",
			"sectionInner": "dshm_o5Lh3q_sectionInner",
			"select": "dshm_o5Lh3q_select",
			"summaryLine": "dshm_o5Lh3q_summaryLine",
			"tableWrap": "dshm_o5Lh3q_tableWrap",
			"testDetails": "dshm_o5Lh3q_testDetails",
			"testHeader": "dshm_o5Lh3q_testHeader",
			"testResult": "dshm_o5Lh3q_testResult",
			"testResultError": "dshm_o5Lh3q_testResultError",
			"testResultHealthy": "dshm_o5Lh3q_testResultHealthy",
			"testResultTesting": "dshm_o5Lh3q_testResultTesting",
			"textButton": "dshm_o5Lh3q_textButton",
			"title": "dshm_o5Lh3q_title",
			"warningNotice": "dshm_o5Lh3q_warningNotice"
		};
		const tagId = "dsh-pdf-mineru/SettingsPage.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]");
			if (tag === null) {
				tag = document.createElement("style");
				tag.dataset.plugin = "dsh-pdf-mineru";
				tag.dataset.pluginCss = tagId;
				document.head.appendChild(tag);
			}
			tag.textContent = css;
		}
		//#endregion
		//#region src/client/sections/ProviderSection.tsx
		function ProviderSection({ draft, setDraft, activeProvider, activeCredentialRef, apiKeyDraft, setApiKeyDraft, credentialStateReady, credentialView, credentialLocked, credentialInputDisabled, credentialPlaceholder, credentialBusy, credentialStatus, credentialError, onClearCredential, onActivateProvider, t }) {
			const toggleOfficialModel = (model) => {
				if (activeProvider.type !== "official-v4") return;
				const current = activeProvider.models;
				let next;
				if (current.includes(model)) {
					if (current.length <= 1 || draft.defaults.model === model) return;
					next = current.filter((m) => m !== model);
				} else next = [...current, model];
				setDraft((prev) => prev === null ? prev : patchActiveProvider(prev, { models: next }));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: classMap.sectionInner,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: classMap.fieldLabel,
							id: "provider-radiogroup-label",
							children: t("field.activeProvider")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: classMap.providerRadios,
							role: "radiogroup",
							"aria-labelledby": "provider-radiogroup-label",
							children: draft.providers.map((provider) => {
								const isActive = provider.id === draft.activeProvider;
								const providerTitle = t(provider.type === "self-hosted-v2" ? "provider.type.selfHosted" : "provider.type.official");
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: `${classMap.providerRadioPill} ${isActive ? classMap.providerRadioPillActive : ""}`,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "radio",
											name: "mineru-active-provider",
											value: provider.id,
											checked: isActive,
											"aria-label": `${providerTitle} — ${provider.id}`,
											className: classMap.providerRadioInput,
											onChange: () => onActivateProvider(provider.id)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: classMap.providerPillDot,
											"aria-hidden": "true"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: classMap.providerPillTitle,
											children: providerTitle
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: classMap.providerPillBadge,
											children: provider.id
										})
									]
								}, provider.id);
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: classMap.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.fieldLabel,
								children: t("field.baseURL")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: classMap.input,
								"aria-label": t("field.baseURL"),
								value: activeProvider.baseURL,
								placeholder: t("field.baseURL.placeholder"),
								onChange: (e) => setDraft((prev) => prev === null ? prev : patchActiveProvider(prev, { baseURL: e.target.value }))
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: classMap.field,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap.fieldLabel,
									children: t("field.apiKeyEnv")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: classMap.input,
									"aria-label": t("field.apiKeyEnv"),
									value: activeProvider.apiKeyEnv ?? "",
									placeholder: t("field.apiKeyEnv.placeholder"),
									onChange: (e) => setDraft((prev) => prev === null ? prev : patchActiveProvider(prev, { apiKeyEnv: e.target.value || void 0 }))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap.fieldHint,
									children: t("field.apiKeyEnv.hint")
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.field,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.fieldLabelRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap.fieldLabel,
									children: t("field.apiKey")
								}), credentialStateReady && credentialView && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: `${classMap.inlineBadge} ${credentialView.configured ? classMap.badgeOk : classMap.badgeWarn}`,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.badgeDot,
										"aria-hidden": "true"
									}), credentialView.configured ? t("badge.configured") : t("badge.notConfigured")]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.credentialInputRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: classMap.inputWithIcon,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.inputIcon,
										"aria-hidden": "true",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(KeyIcon, { size: 14 })
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: `${classMap.input} ${classMap.inputPaddedLeft}`,
										type: "password",
										autoComplete: "off",
										"aria-label": t("field.apiKey"),
										value: apiKeyDraft,
										placeholder: credentialPlaceholder,
										disabled: credentialInputDisabled,
										onChange: (event) => setApiKeyDraft(event.target.value)
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: classMap.secondaryButton,
									disabled: credentialInputDisabled || credentialView?.configured !== true,
									onClick: onClearCredential,
									children: credentialBusy ? t("action.clearingApiKey") : t("action.clearApiKey")
								})]
							}),
							credentialLocked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: classMap.fieldHint,
								role: "status",
								children: t("credential.readOnly")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.fieldHint,
								children: credentialStatus === "loading" ? t("credential.loading") : credentialStatus === "error" ? credentialError : activeCredentialRef === void 0 ? t("credential.referenceRequired") : credentialLocked ? t("credential.readOnly") : credentialView?.configured === true ? [t("credential.configured"), credentialView.source ? ` (${credentialView.source})` : ""].join("") : t("credential.notConfigured")
							})
						]
					}),
					activeProvider.type === "self-hosted-v2" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.providerSubgroup,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: classMap.row,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: classMap.checkboxField,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: activeProvider.allowInsecureHttp,
									onChange: (e) => setDraft((prev) => prev === null ? prev : patchActiveProvider(prev, { allowInsecureHttp: e.target.checked }))
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap.checkboxLabel,
									children: t("field.allowInsecureHttp")
								})]
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.field,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.modelMap.pipeline")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										"aria-label": t("field.modelMap.pipeline"),
										list: "mineru-modelmap-pipeline-options",
										placeholder: t("field.modelMap.pipeline.placeholder"),
										value: activeProvider.modelMap.pipeline,
										onChange: (e) => {
											const currentMap = activeProvider.modelMap;
											setDraft((prev) => prev === null ? prev : patchActiveProvider(prev, { modelMap: {
												...currentMap,
												pipeline: e.target.value
											} }));
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("datalist", {
										id: "mineru-modelmap-pipeline-options",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "pipeline",
											children: t("field.modelMap.opt.pipeline")
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: classMap.chipGroup,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: `${classMap.chip} ${activeProvider.modelMap.pipeline === "pipeline" ? classMap.chipActive : ""}`,
											onClick: () => {
												const currentMap = activeProvider.modelMap;
												setDraft((prev) => prev === null ? prev : patchActiveProvider(prev, { modelMap: {
													...currentMap,
													pipeline: "pipeline"
												} }));
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "pipeline" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: classMap.chipBadge,
												children: [
													"(",
													t("field.modelMap.chip.default"),
													")"
												]
											})]
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldHint,
										children: t("field.modelMap.pipeline.hint")
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.field,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.modelMap.vlm")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										"aria-label": t("field.modelMap.vlm"),
										list: "mineru-modelmap-vlm-options",
										placeholder: t("field.modelMap.vlm.placeholder"),
										value: activeProvider.modelMap.vlm,
										onChange: (e) => {
											const currentMap = activeProvider.modelMap;
											setDraft((prev) => prev === null ? prev : patchActiveProvider(prev, { modelMap: {
												...currentMap,
												vlm: e.target.value
											} }));
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("datalist", {
										id: "mineru-modelmap-vlm-options",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "hybrid-engine",
											children: t("field.modelMap.opt.hybridEngine")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "vlm-engine",
											children: t("field.modelMap.opt.vlmEngine")
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: classMap.chipGroup,
										children: [{
											value: "hybrid-engine",
											badge: t("field.modelMap.chip.recommended")
										}, {
											value: "vlm-engine",
											badge: t("field.modelMap.chip.vlmEngine")
										}].map((opt) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: `${classMap.chip} ${activeProvider.modelMap.vlm === opt.value ? classMap.chipActive : ""}`,
											onClick: () => {
												const currentMap = activeProvider.modelMap;
												setDraft((prev) => prev === null ? prev : patchActiveProvider(prev, { modelMap: {
													...currentMap,
													vlm: opt.value
												} }));
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: opt.value }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: classMap.chipBadge,
												children: [
													"(",
													opt.badge,
													")"
												]
											})]
										}, opt.value))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldHint,
										children: t("field.modelMap.vlm.hint")
									})
								]
							})]
						})]
					}),
					activeProvider.type === "official-v4" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: classMap.providerSubgroup,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.fieldLabel,
								children: t("field.officialModels")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: classMap.checkboxGroup,
								children: ["pipeline", "vlm"].map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.checkboxOption,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: activeProvider.models.includes(m),
										disabled: draft.defaults.model === m,
										onChange: () => toggleOfficialModel(m)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(m === "pipeline" ? "model.pipeline" : "model.vlm") })]
								}, m))
							})]
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/sections/DefaultsSection.tsx
		function DefaultsSection({ draft, setDraft, activeProvider, txtToAutoNotice, onDismissTxtNotice, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: classMap.sectionInner,
				children: [
					txtToAutoNotice && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.warningNotice,
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("notice.officialTxtToAuto") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: classMap.noticeDismiss,
							onClick: onDismissTxtNotice,
							"aria-label": t("action.dismiss"),
							children: "×"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.row,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: classMap.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap.fieldLabel,
									children: t("field.defaultModel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									className: classMap.select,
									"aria-label": t("field.defaultModel"),
									value: draft.defaults.model,
									onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "defaults", { model: e.target.value })),
									children: (activeProvider.type === "official-v4" ? activeProvider.models : ["pipeline", "vlm"]).map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: model,
										children: t(model === "pipeline" ? "model.pipeline" : "model.vlm")
									}, model))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: classMap.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap.fieldLabel,
									children: t("field.defaultParseMethod")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: classMap.select,
									"aria-label": t("field.defaultParseMethod"),
									value: draft.defaults.parseMethod,
									onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "defaults", {
										parseMethod: e.target.value,
										ocr: e.target.value === "ocr"
									})),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "auto",
											children: t("parse.auto")
										}),
										activeProvider.type === "self-hosted-v2" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "txt",
											children: t("parse.txt")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "ocr",
											children: t("parse.ocr")
										})
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: classMap.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap.fieldLabel,
									children: t("field.defaultLang")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: classMap.input,
									"aria-label": t("field.defaultLang"),
									value: draft.defaults.language,
									onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "defaults", { language: e.target.value }))
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: classMap.checkboxField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: draft.defaults.formula,
								onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "defaults", { formula: e.target.checked }))
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.checkboxLabel,
								children: t("field.defaultFormula")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: classMap.checkboxField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: draft.defaults.table,
								onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "defaults", { table: e.target.checked }))
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.checkboxLabel,
								children: t("field.defaultTable")
							})]
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/NumericInput.tsx
		function parseNumericDraft(draft, min, max) {
			const trimmed = draft.trim();
			if (trimmed === "") return { valid: false };
			const parsed = Number(trimmed);
			if (!Number.isSafeInteger(parsed)) return { valid: false };
			if (min !== void 0 && parsed < min) return { valid: false };
			if (max !== void 0 && parsed > max) return { valid: false };
			return {
				valid: true,
				value: parsed
			};
		}
		function clampNumericDraft(draft, fallback, min, max) {
			const trimmed = draft.trim();
			if (trimmed === "") return {
				nextDraft: String(fallback),
				value: fallback,
				changed: false
			};
			const parsed = Number(trimmed);
			if (!Number.isSafeInteger(parsed)) return {
				nextDraft: String(fallback),
				value: fallback,
				changed: false
			};
			let clamped = parsed;
			if (min !== void 0 && clamped < min) clamped = min;
			if (max !== void 0 && clamped > max) clamped = max;
			return {
				nextDraft: String(clamped),
				value: clamped,
				changed: clamped !== fallback
			};
		}
		function NumericInput({ className, id, ariaLabel, value, min, max, step, disabled, placeholder, title, onChange }) {
			const [draft, setDraft] = (0, react.useState)(() => Number.isFinite(value) ? String(value) : "");
			(0, react.useEffect)(() => {
				setDraft(Number.isFinite(value) ? String(value) : "");
			}, [value]);
			const handleChange = (e) => {
				const nextDraft = e.target.value;
				setDraft(nextDraft);
				const result = parseNumericDraft(nextDraft, min, max);
				if (result.valid && result.value !== void 0) onChange(result.value);
			};
			const handleBlur = (_e) => {
				const result = clampNumericDraft(draft, value, min, max);
				setDraft(result.nextDraft);
				if (result.changed) onChange(result.value);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
				type: "number",
				id,
				"aria-label": ariaLabel,
				className,
				value: draft,
				min,
				max,
				step,
				disabled,
				placeholder,
				title,
				onChange: handleChange,
				onBlur: handleBlur
			});
		}
		//#endregion
		//#region src/client/DisclosureCard.tsx
		function DisclosureCard({ id, title, subtitle, icon, badge, open, onToggle, action, toggleTitle, children, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${classMap.card} ${open ? classMap.cardOpen : ""} ${className ?? ""}`,
				"data-card-id": id,
				"data-card-open": open,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: classMap.cardHeader,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: classMap.cardHeadButton,
						"aria-expanded": open,
						"aria-controls": `card-body-${id}`,
						"data-card-toggle": id,
						"data-testid": `card-toggle-${id}`,
						title: toggleTitle,
						onClick: onToggle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap.cardHeadLeft,
							children: [icon && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.cardIcon,
								children: icon
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.cardHeadTitles,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: classMap.cardTitle,
									children: title
								}), subtitle && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap.cardSubtitle,
									children: subtitle
								})]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap.cardHeadRight,
							children: [badge, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `${classMap.chevron} ${open ? classMap.chevronOpen : ""}`,
								"aria-hidden": "true",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronIcon, {})
							})]
						})]
					}), action && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: classMap.cardHeaderAction,
						onClick: (e) => e.stopPropagation(),
						children: action
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					id: `card-body-${id}`,
					className: classMap.cardBody,
					style: { display: open ? void 0 : "none" },
					children
				})]
			});
		}
		//#endregion
		//#region src/client/sections/AdvancedSections.tsx
		function AdvancedSections({ draft, setDraft, cardsOpen, onToggleCard, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(DisclosureCard, {
					id: "storage",
					title: t("section.storage"),
					subtitle: t("section.storage.desc"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DatabaseIcon, { size: 16 }),
					open: cardsOpen.storage ?? false,
					onToggle: () => onToggleCard("storage"),
					toggleTitle: cardsOpen.storage ? t("action.collapse") : t("action.expand"),
					badge: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: `${classMap.cardBadge} ${draft.storage.cacheEnabled ? classMap.badgeOk : classMap.badgeNeutral}`,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: classMap.badgeDot,
							"aria-hidden": "true"
						}), draft.storage.cacheEnabled ? t("badge.cacheOn") : t("badge.cacheOff")]
					}),
					action: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: classMap.resetButton,
						title: t("action.resetSection"),
						onClick: () => setDraft((prev) => prev === null ? prev : resetConfigSection(prev, "storage")),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RotateCcwIcon, {
							size: 11,
							className: classMap.resetIcon
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("action.resetSection") })]
					}),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: classMap.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.fieldLabel,
								children: t("field.storageRoot")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: classMap.input,
								value: draft.storage.storageRoot,
								readOnly: true,
								disabled: true,
								title: "Storage root changes require editing plugin configuration and restarting the plugin."
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: classMap.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.fieldLabel,
								children: t("field.stagingTtlMs")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
								className: classMap.input,
								ariaLabel: t("field.stagingTtlMs"),
								value: draft.storage.stagingTtlMs,
								min: 1,
								onChange: (val) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "storage", { stagingTtlMs: val }))
							})]
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: classMap.row,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: classMap.checkboxField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: draft.storage.cacheEnabled,
								onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "storage", { cacheEnabled: e.target.checked }))
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.checkboxLabel,
								children: t("field.cacheEnabled")
							})]
						})
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(DisclosureCard, {
					id: "polling",
					title: t("section.polling"),
					subtitle: t("section.polling.desc"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ClockIcon, { size: 16 }),
					open: cardsOpen.polling ?? false,
					onToggle: () => onToggleCard("polling"),
					toggleTitle: cardsOpen.polling ? t("action.collapse") : t("action.expand"),
					badge: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: `${classMap.cardBadge} ${classMap.badgeNeutral}`,
						children: [
							draft.polling.pollIntervalMs,
							" ",
							t("unit.ms"),
							" / ",
							Math.round(draft.polling.pollTimeoutMs / 1e3),
							" ",
							t("unit.seconds")
						]
					}),
					action: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: classMap.resetButton,
						title: t("action.resetSection"),
						onClick: () => setDraft((prev) => prev === null ? prev : resetConfigSection(prev, "polling")),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RotateCcwIcon, {
							size: 11,
							className: classMap.resetIcon
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("action.resetSection") })]
					}),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: classMap.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.fieldLabel,
								children: t("field.pollIntervalMs")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
								className: classMap.input,
								ariaLabel: t("field.pollIntervalMs"),
								value: draft.polling.pollIntervalMs,
								min: 100,
								onChange: (val) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "polling", { pollIntervalMs: val }))
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: classMap.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.fieldLabel,
								children: t("field.pollTimeoutMs")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
								className: classMap.input,
								ariaLabel: t("field.pollTimeoutMs"),
								value: draft.polling.pollTimeoutMs,
								min: 1e3,
								onChange: (val) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "polling", { pollTimeoutMs: val }))
							})]
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: classMap.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.fieldLabel,
								children: t("field.requestTimeoutMs")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
								className: classMap.input,
								ariaLabel: t("field.requestTimeoutMs"),
								value: draft.polling.requestTimeoutMs,
								min: 1e3,
								onChange: (val) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "polling", { requestTimeoutMs: val }))
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: classMap.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.fieldLabel,
								children: t("field.operationTimeoutMs")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
								className: classMap.input,
								ariaLabel: t("field.operationTimeoutMs"),
								value: draft.polling.operationTimeoutMs,
								min: 1e3,
								onChange: (val) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "polling", { operationTimeoutMs: val }))
							})]
						})]
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DisclosureCard, {
					id: "retry",
					title: t("section.retry"),
					subtitle: t("section.retry.desc"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RotateCwIcon, { size: 16 }),
					open: cardsOpen.retry ?? false,
					onToggle: () => onToggleCard("retry"),
					toggleTitle: cardsOpen.retry ? t("action.collapse") : t("action.expand"),
					badge: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: `${classMap.cardBadge} ${classMap.badgeNeutral}`,
						children: [
							draft.retry.maxAttempts,
							" ",
							t("unit.attempts")
						]
					}),
					action: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: classMap.resetButton,
						title: t("action.resetSection"),
						onClick: () => setDraft((prev) => prev === null ? prev : resetConfigSection(prev, "retry")),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RotateCcwIcon, {
							size: 11,
							className: classMap.resetIcon
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("action.resetSection") })]
					}),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.row,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: classMap.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap.fieldLabel,
									children: t("field.retryMaxAttempts")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
									className: classMap.input,
									ariaLabel: t("field.retryMaxAttempts"),
									title: t("field.retryMaxAttempts"),
									min: 1,
									max: 10,
									value: draft.retry.maxAttempts,
									onChange: (val) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "retry", { maxAttempts: val }))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: classMap.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap.fieldLabel,
									children: t("field.retryBaseDelayMs")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
									className: classMap.input,
									ariaLabel: t("field.retryBaseDelayMs"),
									min: 1,
									max: 6e4,
									value: draft.retry.baseDelayMs,
									onChange: (val) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "retry", { baseDelayMs: val }))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: classMap.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap.fieldLabel,
									children: t("field.retryMaxDelayMs")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
									className: classMap.input,
									ariaLabel: t("field.retryMaxDelayMs"),
									min: 1,
									max: 3e5,
									value: draft.retry.maxDelayMs,
									onChange: (val) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "retry", { maxDelayMs: val }))
								})]
							})
						]
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DisclosureCard, {
					id: "output",
					title: t("section.output"),
					subtitle: t("section.output.desc"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileTextIcon, { size: 16 }),
					open: cardsOpen.output ?? false,
					onToggle: () => onToggleCard("output"),
					toggleTitle: cardsOpen.output ? t("action.collapse") : t("action.expand"),
					badge: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: `${classMap.cardBadge} ${classMap.badgeNeutral}`,
						children: [
							Math.round(draft.output.maxInlineChars / 1e3),
							"k ",
							t("unit.chars"),
							" · ",
							draft.output.maxInlineImages,
							" ",
							t("unit.images")
						]
					}),
					action: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: classMap.resetButton,
						title: t("action.resetSection"),
						onClick: () => setDraft((prev) => prev === null ? prev : resetConfigSection(prev, "output")),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RotateCcwIcon, {
							size: 11,
							className: classMap.resetIcon
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("action.resetSection") })]
					}),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.row,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: classMap.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.fieldLabel,
								children: t("field.maxInlineChars")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
								className: classMap.input,
								ariaLabel: t("field.maxInlineChars"),
								min: 1024,
								max: 1e6,
								value: draft.output.maxInlineChars,
								onChange: (val) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "output", { maxInlineChars: val }))
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: classMap.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.fieldLabel,
								children: t("field.maxInlineImages")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
								className: classMap.input,
								ariaLabel: t("field.maxInlineImages"),
								title: t("field.maxInlineImages"),
								min: 0,
								max: 100,
								value: draft.output.maxInlineImages,
								onChange: (val) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "output", { maxInlineImages: val }))
							})]
						})]
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(DisclosureCard, {
					id: "limits",
					title: t("section.limits"),
					subtitle: t("section.limits.desc"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ShieldCheckIcon, { size: 16 }),
					open: cardsOpen.limits ?? false,
					onToggle: () => onToggleCard("limits"),
					toggleTitle: cardsOpen.limits ? t("action.collapse") : t("action.expand"),
					badge: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: `${classMap.cardBadge} ${classMap.badgeNeutral}`,
						children: t("badge.readOnly")
					}),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: classMap.fieldHint,
						role: "status",
						style: {
							marginBottom: "8px",
							display: "block"
						},
						children: t("section.limits.restartHint")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
						disabled: true,
						className: classMap.fieldsetDisabled,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: classMap.row,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxFileBytes")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
										className: classMap.input,
										ariaLabel: t("field.maxFileBytes"),
										disabled: true,
										title: t("section.limits.restartHint"),
										min: 1,
										value: draft.limits.maxFileBytes,
										onChange: () => {}
									})]
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: classMap.row,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxApiResponseBytes")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
										className: classMap.input,
										ariaLabel: t("field.maxApiResponseBytes"),
										disabled: true,
										title: t("section.limits.restartHint"),
										min: 1,
										value: draft.limits.maxApiResponseBytes,
										onChange: () => {}
									})]
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: classMap.row,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxZipDownloadBytes")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
										className: classMap.input,
										ariaLabel: t("field.maxZipDownloadBytes"),
										disabled: true,
										title: t("section.limits.restartHint"),
										min: 1,
										value: draft.limits.maxZipDownloadBytes,
										onChange: () => {}
									})]
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: classMap.row,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxZipEntries")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
										className: classMap.input,
										ariaLabel: t("field.maxZipEntries"),
										disabled: true,
										title: t("section.limits.restartHint"),
										min: 1,
										value: draft.limits.maxZipEntries,
										onChange: () => {}
									})]
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: classMap.row,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxZipEntryBytes")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
										className: classMap.input,
										ariaLabel: t("field.maxZipEntryBytes"),
										disabled: true,
										title: t("section.limits.restartHint"),
										min: 1,
										value: draft.limits.maxZipEntryBytes,
										onChange: () => {}
									})]
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: classMap.row,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxZipTotalBytes")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
										className: classMap.input,
										ariaLabel: t("field.maxZipTotalBytes"),
										disabled: true,
										title: t("section.limits.restartHint"),
										min: 1,
										value: draft.limits.maxZipTotalBytes,
										onChange: () => {}
									})]
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: classMap.row,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxZipCompressionRatio")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumericInput, {
										className: classMap.input,
										ariaLabel: t("field.maxZipCompressionRatio"),
										disabled: true,
										title: t("section.limits.restartHint"),
										min: 1,
										value: draft.limits.maxZipCompressionRatio,
										onChange: () => {}
									})]
								})
							})
						]
					})]
				})
			] });
		}
		//#endregion
		//#region src/client/StorageOperations.tsx
		function formatBytes(bytes, saturated = false) {
			if (!Number.isFinite(bytes) || bytes < 0) return "N/A";
			const units = [
				"B",
				"KiB",
				"MiB",
				"GiB",
				"TiB"
			];
			let value = bytes;
			let unit = 0;
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024;
				unit++;
			}
			const precision = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
			return (saturated ? ">= " : "") + value.toFixed(precision) + " " + units[unit];
		}
		async function callMaintenance(rpc, endpoint, payload = {}) {
			const result = await rpc.call("/dsh-pdf-mineru-api", endpoint, payload);
			if (!result.ok) throw new Error(result.error.message);
			return result.value;
		}
		function isPartialArea(area) {
			return area.complete === false || area.truncated === true || area.depthLimitCount > 0;
		}
		function AreaMetric({ label, area }) {
			const partial = isPartialArea(area);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: classMap.metric,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: label }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: formatBytes(area.byteUsage, area.byteUsageSaturated || partial) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [partial ? ">= " : "", area.logicalEntryCount] })
				]
			});
		}
		function StorageOperations({ rpc, open = true, onToggle, t }) {
			const [internalOpen, setInternalOpen] = (0, react.useState)(true);
			const isCardOpen = onToggle !== void 0 ? open : internalOpen;
			const handleToggle = onToggle !== void 0 ? onToggle : () => setInternalOpen((prev) => !prev);
			const [state, setState] = (0, react.useState)({});
			const [selected, setSelected] = (0, react.useState)([]);
			const [confirmingDelete, setConfirmingDelete] = (0, react.useState)(false);
			const [confirmingCacheClear, setConfirmingCacheClear] = (0, react.useState)(false);
			const run = async (action, endpoint, payload, apply) => {
				if (action !== "cache-clear-preview" && action !== "cache-clear-delete") setConfirmingCacheClear(false);
				setState((current) => ({
					...current,
					busy: action,
					error: void 0
				}));
				try {
					const value = await callMaintenance(rpc, endpoint, payload);
					setState((current) => ({
						...current,
						...apply(value),
						busy: void 0,
						error: void 0
					}));
					return value;
				} catch (error) {
					setState((current) => ({
						...current,
						busy: void 0,
						error: error instanceof Error ? error.message : String(error)
					}));
					return;
				}
			};
			const refreshStats = async () => {
				await run("stats", "mineru/storage.stats", {}, (stats) => ({ stats }));
			};
			const scanIntegrity = async () => {
				await run("scan", "mineru/storage.integrity.scan", { diagnostic_limit: 50 }, (scan) => ({ scan }));
			};
			const previewGc = async () => {
				await run("gc", "mineru/storage.gc.preview", {
					candidate_limit: 100,
					diagnostic_limit: 50
				}, (gc) => ({ gc }));
			};
			const clearCache = async () => {
				setConfirmingDelete(false);
				if (!confirmingCacheClear) {
					const preview = await run("cache-clear-preview", "mineru/storage.cache.clear", {
						dry_run: true,
						diagnostic_limit: 50
					}, (cacheClear) => ({ cacheClear }));
					if (preview?.eligible === true && preview.plannedCount > 0 && preview.confirmationToken !== void 0) setConfirmingCacheClear(true);
					return;
				}
				const report = await run("cache-clear-delete", "mineru/storage.cache.clear", {
					dry_run: false,
					confirm: true,
					diagnostic_limit: 50,
					confirmation_token: state.cacheClear?.confirmationToken
				}, (cacheClear) => ({ cacheClear }));
				setConfirmingCacheClear(false);
				if (report !== void 0) await refreshStats();
			};
			const listQuarantine = async () => {
				const report = await run("quarantine", "mineru/storage.quarantine.list", { limit: 100 }, (quarantine) => ({ quarantine }));
				if (report !== void 0) {
					const available = new Set(report.entries.map((entry) => entry.id));
					setSelected((current) => current.filter((id) => available.has(id)));
					setConfirmingDelete(false);
				}
				return report;
			};
			const toggleSelected = (id) => {
				setConfirmingCacheClear(false);
				setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
				setConfirmingDelete(false);
			};
			const toggleAll = () => {
				setConfirmingCacheClear(false);
				const entries = state.quarantine?.entries ?? [];
				setSelected((current) => current.length === entries.length ? [] : entries.map((entry) => entry.id));
				setConfirmingDelete(false);
			};
			const previewCleanup = async () => {
				if (selected.length === 0) return;
				setConfirmingDelete(false);
				await run("cleanup-preview", "mineru/storage.quarantine.cleanup", {
					entry_ids: selected,
					dry_run: true
				}, (cleanup) => ({ cleanup }));
			};
			const deleteSelected = async () => {
				setConfirmingCacheClear(false);
				if (selected.length === 0) return;
				if (!confirmingDelete) {
					setConfirmingDelete(true);
					return;
				}
				const cleanup = await run("cleanup-delete", "mineru/storage.quarantine.cleanup", {
					entry_ids: selected,
					dry_run: false,
					confirm: true
				}, (value) => ({ cleanup: value }));
				setConfirmingDelete(false);
				if (cleanup !== void 0) {
					setSelected([]);
					await Promise.all([listQuarantine(), refreshStats()]);
				}
			};
			const busy = state.busy !== void 0;
			const quarantineEntries = state.quarantine?.entries ?? [];
			const allSelected = quarantineEntries.length > 0 && selected.length === quarantineEntries.length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(DisclosureCard, {
				id: "operations",
				title: t("section.operations"),
				subtitle: t("section.operations.desc"),
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WrenchIcon, { size: 16 }),
				open: isCardOpen,
				onToggle: handleToggle,
				toggleTitle: isCardOpen ? t("action.collapse") : t("action.expand"),
				badge: busy ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: `${classMap.cardBadge} ${classMap.badgeInfo} ${classMap.badgePulse}`,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: classMap.badgeDot,
						"aria-hidden": "true"
					}), t("action.running")]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: `${classMap.cardBadge} ${classMap.badgeNeutral}`,
					children: t("badge.maintenance")
				}),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.operationToolbar,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: classMap.secondaryButton,
								disabled: busy,
								onClick: () => void refreshStats(),
								children: state.busy === "stats" ? t("action.running") : t("action.storageStats")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: classMap.secondaryButton,
								disabled: busy,
								onClick: () => void scanIntegrity(),
								children: state.busy === "scan" ? t("action.running") : t("action.integrityScan")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: classMap.secondaryButton,
								disabled: busy,
								onClick: () => void previewGc(),
								children: state.busy === "gc" ? t("action.running") : t("action.gcPreview")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: confirmingCacheClear ? classMap.dangerButton : classMap.secondaryButton,
								disabled: busy,
								onClick: () => void clearCache(),
								children: state.busy === "cache-clear-preview" || state.busy === "cache-clear-delete" ? t("action.running") : confirmingCacheClear ? t("action.cacheClearConfirm") : t("action.cacheClear")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: classMap.secondaryButton,
								disabled: busy,
								onClick: () => void listQuarantine(),
								children: state.busy === "quarantine" ? t("action.running") : t("action.quarantineList")
							})
						]
					}),
					state.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: classMap.operationError,
						children: state.error
					}),
					state.stats !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.operationResult,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: classMap.resultTitle,
								children: t("action.storageStats")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.metricHeaders,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("ops.bytes") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("ops.entries") })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
								className: classMap.metrics,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AreaMetric, {
										label: t("ops.results"),
										area: state.stats.publishedResults
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AreaMetric, {
										label: t("ops.staging"),
										area: state.stats.staging
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AreaMetric, {
										label: t("ops.quarantine"),
										area: state.stats.quarantine
									})
								]
							}),
							[
								state.stats.publishedResults,
								state.stats.staging,
								state.stats.quarantine
							].some(isPartialArea) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "status",
								className: classMap.fieldHint,
								children: t("ops.statsIncomplete")
							})
						]
					}),
					state.scan !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.operationResult,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap.resultTitle,
							children: [
								t("action.integrityScan"),
								" · ",
								t("ops.readOnly")
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap.summaryLine,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									t("ops.valid"),
									": ",
									state.scan.validCount
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									t("ops.corrupt"),
									": ",
									state.scan.corruptCount
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									t("ops.missing"),
									": ",
									state.scan.missingCount
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									t("ops.unreadable"),
									": ",
									state.scan.unreadableCount
								] })
							]
						})]
					}),
					state.gc !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.operationResult,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: classMap.resultTitle,
							children: t("action.gcPreview")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap.summaryLine,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: state.gc.eligible ? t("ops.gcEligible") : t("ops.gcBlocked") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									t("ops.gcCandidates"),
									": ",
									state.gc.candidateCount
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatBytes(state.gc.candidateBytes, state.gc.candidateBytesSaturated) })
							]
						})]
					}),
					state.cacheClear !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.operationResult,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: classMap.resultTitle,
							children: t("action.cacheClear")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap.summaryLine,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: state.cacheClear.eligible ? t("ops.clearReady") : t("ops.clearBlocked") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									t("ops.cleanupPlanned"),
									": ",
									state.cacheClear.plannedCount
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									t("ops.cleanupDeleted"),
									": ",
									state.cacheClear.deletedCount
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatBytes(state.cacheClear.dryRun ? state.cacheClear.plannedBytes : state.cacheClear.deletedBytes) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									t("ops.activeOperations"),
									": ",
									state.cacheClear.activeOperationCount
								] })
							]
						})]
					}),
					state.quarantine !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.operationResult,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap.resultTitle,
							children: [
								t("ops.quarantine"),
								" · ",
								state.quarantine.totalCount
							]
						}), quarantineEntries.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: classMap.tableWrap,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: classMap.operationTable,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										"aria-label": t("ops.selectAll"),
										checked: allSelected,
										onChange: toggleAll
									}) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "ID" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("ops.bytes") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("ops.modified") })
								] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: quarantineEntries.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										"aria-label": entry.id,
										checked: selected.includes(entry.id),
										onChange: () => toggleSelected(entry.id)
									}) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										title: entry.id,
										children: entry.id
									}) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatBytes(entry.byteUsage, entry.byteUsageSaturated) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: new Date(entry.modifiedAt).toLocaleString() })
								] }, entry.id)) })]
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap.operationToolbar,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: classMap.secondaryButton,
								disabled: busy || selected.length === 0,
								onClick: () => void previewCleanup(),
								children: state.busy === "cleanup-preview" ? t("action.running") : t("action.cleanupPreview")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: confirmingDelete ? classMap.dangerButton : classMap.secondaryButton,
								disabled: busy || selected.length === 0,
								onClick: () => void deleteSelected(),
								children: state.busy === "cleanup-delete" ? t("action.running") : confirmingDelete ? t("action.cleanupConfirm") : t("action.cleanupDelete")
							})]
						})] })]
					}),
					state.cleanup !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: classMap.operationResult,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap.summaryLine,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									t("ops.cleanupPlanned"),
									": ",
									state.cleanup.plannedCount
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									t("ops.cleanupDeleted"),
									": ",
									state.cleanup.deletedCount
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatBytes(state.cleanup.dryRun ? state.cleanup.plannedBytes : state.cleanup.deletedBytes) })
							]
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/SettingsPage.tsx
		function SettingsPage({ rpc, credentials, t }) {
			const [draft, setDraft] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saved, setSaved] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			const [apiKeyDraft, setApiKeyDraft] = (0, react.useState)("");
			const [credentialBusy, setCredentialBusy] = (0, react.useState)(false);
			const [credentialRevision, setCredentialRevision] = (0, react.useState)(0);
			const [credentialState, setCredentialState] = (0, react.useState)({ status: "unavailable" });
			const [txtToAutoNotice, setTxtToAutoNotice] = (0, react.useState)(false);
			const [testState, setTestState] = (0, react.useState)({ status: "idle" });
			const [cardsOpen, setCardsOpen] = (0, react.useState)({
				provider: true,
				defaults: true,
				storage: true,
				polling: false,
				retry: false,
				output: false,
				limits: false,
				operations: true
			});
			const toggleCard = (0, react.useCallback)((cardId) => {
				setCardsOpen((prev) => ({
					...prev,
					[cardId]: !prev[cardId]
				}));
			}, []);
			const allOpen = Object.values(cardsOpen).every(Boolean);
			const toggleAllCards = (0, react.useCallback)(() => {
				if (allOpen) setCardsOpen({
					provider: false,
					defaults: false,
					storage: false,
					polling: false,
					retry: false,
					output: false,
					limits: false,
					operations: false
				});
				else setCardsOpen({
					provider: true,
					defaults: true,
					storage: true,
					polling: true,
					retry: true,
					output: true,
					limits: true,
					operations: true
				});
			}, [allOpen]);
			const refresh = (0, react.useCallback)(async () => {
				setLoading(true);
				setError(void 0);
				try {
					const result = await callRpc(rpc, "mineru/config.get", {});
					if (result.ok) setDraft(ensureProviderProfiles(result.value.config));
					else setError(result.error.message);
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setLoading(false);
				}
			}, [rpc]);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			const activeProviderDraft = draft?.providers.find((p) => p.id === draft.activeProvider) ?? draft?.providers[0];
			const activeCredentialRef = credentialReference(activeProviderDraft);
			(0, react.useEffect)(() => {
				setApiKeyDraft("");
				if (activeCredentialRef === void 0) {
					setCredentialState({ status: "unavailable" });
					return;
				}
				let stale = false;
				setCredentialState({
					status: "loading",
					ref: activeCredentialRef
				});
				describeCredential(credentials, activeCredentialRef).then((view) => {
					if (!stale) setCredentialState({
						status: "ready",
						ref: activeCredentialRef,
						view
					});
				}, (err) => {
					if (!stale) setCredentialState({
						status: "error",
						ref: activeCredentialRef,
						error: err instanceof Error ? err.message : String(err)
					});
				});
				return () => {
					stale = true;
				};
			}, [
				activeCredentialRef,
				credentialRevision,
				credentials
			]);
			const save = (0, react.useCallback)(async () => {
				if (draft === null) return;
				const reference = credentialReference(draft.providers.find((p) => p.id === draft.activeProvider));
				const secret = apiKeyDraft.trim();
				setSaving(true);
				setError(void 0);
				setSaved(false);
				try {
					const result = await callRpc(rpc, "mineru/config.set", { config: draft });
					if (result.ok) {
						setDraft(ensureProviderProfiles(result.value.config));
						if (secret.length > 0) {
							if (reference === void 0) throw new TypeError(t("credential.referenceRequired"));
							await storeCredential(credentials, reference, secret);
							setApiKeyDraft("");
							setCredentialRevision((value) => value + 1);
						}
						setTxtToAutoNotice(false);
						setSaved(true);
						setTimeout(() => setSaved(false), 2e3);
					} else setError(result.error.message);
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setSaving(false);
				}
			}, [
				apiKeyDraft,
				credentials,
				draft,
				rpc,
				t
			]);
			const clearStoredCredential = (0, react.useCallback)(async () => {
				if (activeCredentialRef === void 0) return;
				setCredentialBusy(true);
				setError(void 0);
				setSaved(false);
				try {
					await clearCredential(credentials, activeCredentialRef);
					setApiKeyDraft("");
					setCredentialRevision((value) => value + 1);
					setTestState({ status: "idle" });
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setCredentialBusy(false);
				}
			}, [activeCredentialRef, credentials]);
			const testActiveProvider = (0, react.useCallback)(async () => {
				if (draft === null) return;
				const active = draft.providers.find((p) => p.id === draft.activeProvider);
				if (active === void 0) return;
				setTestState({ status: "testing" });
				try {
					const result = await callRpc(rpc, "mineru/probe", { provider: active });
					if (result.ok) setTestState({
						status: result.value.available ? "healthy" : "unhealthy",
						view: result.value
					});
					else setTestState({
						status: "error",
						error: result.error.message
					});
				} catch (err) {
					setTestState({
						status: "error",
						error: err instanceof Error ? err.message : String(err)
					});
				}
			}, [draft, rpc]);
			const handleActivateProvider = (0, react.useCallback)((providerId) => {
				if (draft === null) return;
				const next = activateProvider(draft, providerId);
				if (draft.defaults.parseMethod === "txt" && next.defaults.parseMethod === "auto") setTxtToAutoNotice(true);
				setDraft(next);
			}, [draft]);
			const handleResetDefaults = (0, react.useCallback)(() => {
				if (draft === null) return;
				const next = resetToDefaultConfig(draft);
				setDraft(next);
				setTxtToAutoNotice(false);
			}, [draft]);
			if (loading) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: classMap.section,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: classMap.headerArea,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: classMap.title,
						children: t("page.title")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: classMap.intro,
						children: t("page.intro")
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: classMap.loading,
					children: "…"
				})]
			});
			if (draft === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: classMap.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.headerArea,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: classMap.title,
							children: t("page.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: classMap.intro,
							children: t("page.intro")
						})]
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.error,
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: error }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: classMap.errorDismiss,
							onClick: () => setError(void 0),
							"aria-label": t("action.dismiss"),
							children: "×"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: classMap.actionBar,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: classMap.secondaryButton,
							onClick: () => void refresh(),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActivityIcon, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("action.retryLoad") })]
						})
					})
				]
			});
			const activeProvider = activeProviderDraft;
			const credentialStateReady = credentialState.status === "ready" && credentialState.ref === activeCredentialRef;
			const credentialView = credentialStateReady ? credentialState.view : void 0;
			const credentialLocked = credentialView?.writable === false;
			const credentialInputDisabled = saving || credentialBusy || activeCredentialRef === void 0 || !credentialStateReady || credentialLocked;
			const credentialPlaceholder = credentialView?.configured === true ? t("credential.placeholderStored") : t("credential.placeholderEmpty");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: classMap.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.headerArea,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap.headerTitles,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								className: classMap.title,
								children: t("page.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: classMap.intro,
								children: t("page.intro")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap.actionBar,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: classMap.primaryButton,
									disabled: saving || credentialBusy,
									onClick: () => void save(),
									children: saving ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "…" }) : saved ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("action.saved") })] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("action.save") })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: classMap.secondaryButton,
									disabled: testState.status === "testing",
									onClick: () => void testActiveProvider(),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActivityIcon, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: testState.status === "testing" ? t("action.testing") : t("action.test") })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: classMap.secondaryButton,
									disabled: saving || credentialBusy,
									onClick: handleResetDefaults,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RotateCcwIcon, { size: 13 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("action.resetDefaults") })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: classMap.textButton,
									onClick: toggleAllCards,
									title: allOpen ? t("action.collapseAll") : t("action.expandAll"),
									children: allOpen ? t("action.collapseAll") : t("action.expandAll")
								})
							]
						})]
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.error,
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: error }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: classMap.errorDismiss,
							onClick: () => setError(void 0),
							"aria-label": t("action.dismiss"),
							children: "×"
						})]
					}),
					testState.status !== "idle" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: `${classMap.testResult} ${testState.status === "healthy" ? classMap.testResultHealthy : testState.status === "unhealthy" || testState.status === "error" ? classMap.testResultError : classMap.testResultTesting}`,
						role: "status",
						children: [
							testState.status === "testing" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.testHeader,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap.badgePulseDot,
									"aria-hidden": "true"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("action.testing") })]
							}),
							testState.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: classMap.testHeader,
								children: t("test.error")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: classMap.testDetails,
								children: testState.error
							})] }),
							(testState.status === "healthy" || testState.status === "unhealthy") && testState.view && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.testHeader,
								children: [testState.status === "healthy" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, { size: 15 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: classMap.badgeDot }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									testState.status === "healthy" ? t("test.healthy") : t("test.unhealthy"),
									" — ",
									testState.view.provider
								] })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.testDetails,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										"Auth: ",
										testState.view.authentication,
										" | Protocol: ",
										testState.view.protocol_version,
										testState.view.server_version ? ` | Server: v${testState.view.server_version}` : ""
									] }),
									testState.view.queue && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										"Queue: ",
										testState.view.queue.processing ?? 0,
										" active, ",
										testState.view.queue.queued ?? 0,
										" queued (max concurrent: ",
										testState.view.queue.max_concurrent ?? "N/A",
										")"
									] }),
									testState.view.diagnostics && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["Diagnostics: ", testState.view.diagnostics] })
								]
							})] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.cardList,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DisclosureCard, {
								id: "provider",
								title: t("section.provider"),
								subtitle: t("section.provider.desc"),
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ServerIcon, { size: 16 }),
								open: cardsOpen.provider ?? true,
								onToggle: () => toggleCard("provider"),
								toggleTitle: cardsOpen.provider ? t("action.collapse") : t("action.expand"),
								badge: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: classMap.cardBadgeGroup,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `${classMap.cardBadge} ${classMap.badgeInfo}`,
										children: t(activeProvider.type === "self-hosted-v2" ? "badge.selfHosted" : "badge.official")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: `${classMap.cardBadge} ${credentialState.status === "loading" ? classMap.badgeNeutral : credentialView?.configured ? classMap.badgeOk : classMap.badgeWarn}`,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: classMap.badgeDot,
											"aria-hidden": "true"
										}), credentialState.status === "loading" ? t("credential.loading") : credentialView?.configured ? t("badge.configured") : t("badge.notConfigured")]
									})]
								}),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderSection, {
									draft,
									setDraft,
									activeProvider,
									activeCredentialRef,
									apiKeyDraft,
									setApiKeyDraft,
									credentialStateReady,
									credentialView,
									credentialLocked,
									credentialInputDisabled,
									credentialPlaceholder,
									credentialBusy,
									credentialStatus: credentialState.status,
									credentialError: credentialState.error,
									onClearCredential: () => void clearStoredCredential(),
									onActivateProvider: handleActivateProvider,
									t
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DisclosureCard, {
								id: "defaults",
								title: t("section.defaults"),
								subtitle: t("section.defaults.desc"),
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SlidersIcon, { size: 16 }),
								open: cardsOpen.defaults ?? true,
								onToggle: () => toggleCard("defaults"),
								toggleTitle: cardsOpen.defaults ? t("action.collapse") : t("action.expand"),
								badge: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: classMap.cardBadgeGroup,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: `${classMap.cardBadge} ${classMap.badgeNeutral}`,
										children: [
											draft.defaults.model.toUpperCase(),
											" · ",
											draft.defaults.parseMethod,
											" · ",
											draft.defaults.language
										]
									})
								}),
								action: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: classMap.resetButton,
									title: t("action.resetSection"),
									onClick: () => setDraft((prev) => prev === null ? prev : resetConfigSection(prev, "defaults")),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RotateCcwIcon, {
										size: 11,
										className: classMap.resetIcon
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("action.resetSection") })]
								}),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DefaultsSection, {
									draft,
									setDraft,
									activeProvider,
									txtToAutoNotice,
									onDismissTxtNotice: () => setTxtToAutoNotice(false),
									t
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdvancedSections, {
								draft,
								setDraft,
								cardsOpen,
								onToggleCard: toggleCard,
								t
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StorageOperations, {
								rpc,
								open: cardsOpen.operations ?? true,
								onToggle: () => toggleCard("operations"),
								t
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const NS = "dsh-pdf-mineru";
		const en = {
			"nav": "MinerU",
			"page.title": "MinerU Configuration",
			"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
			"section.provider": "Provider Settings",
			"section.defaults": "Parsing Defaults",
			"section.storage": "Storage & Cache",
			"section.operations": "Storage Operations",
			"section.polling": "Polling & Timeouts",
			"section.retry": "Retry Policy",
			"section.output": "Output Limits",
			"section.limits": "Security & Payload Limits",
			"section.limits.restartHint": "Security and payload limits are initialized at plugin startup. Changes require restarting the plugin.",
			"section.provider.desc": "Provider profile, service endpoint, protocol version, and credential management",
			"section.defaults.desc": "Default extraction model, parse method, language, and formula/table switches",
			"section.storage.desc": "Content-addressed cache root, global caching toggle, and staging cleanup TTL",
			"section.operations.desc": "Storage statistics, cache verification, garbage collection preview, and quarantine",
			"section.polling.desc": "Status polling interval, sync tool timeout, and operation deadlines",
			"section.retry.desc": "Bounded exponential backoff, maximum attempts, and delay limits",
			"section.output.desc": "Inline model projection character budget and visual attachment limits",
			"section.limits.desc": "System payload limits, safe decompression ratios, and zip bounds (startup configured)",
			"action.retryLoad": "Retry Loading",
			"badge.selfHosted": "Self-hosted (v2)",
			"badge.official": "Official cloud (v4)",
			"action.expandAll": "Expand All",
			"action.collapseAll": "Collapse All",
			"action.expand": "Expand card",
			"action.collapse": "Collapse card",
			"action.dismiss": "Dismiss",
			"unit.attempts": "attempts",
			"unit.chars": "chars",
			"unit.images": "images",
			"unit.ms": "ms",
			"unit.seconds": "s",
			"unit.fileLimit": "file limit",
			"badge.configured": "Configured",
			"badge.notConfigured": "Not Configured",
			"badge.healthy": "Healthy",
			"badge.unhealthy": "Unhealthy",
			"badge.testing": "Testing…",
			"badge.cacheOn": "Cache ON",
			"badge.cacheOff": "Cache OFF",
			"badge.readOnly": "Read-only",
			"badge.maintenance": "Preview & confirm",
			"notice.officialTxtToAuto": "Official v4 provider does not support txt extraction mode; parse method was automatically adjusted to auto.",
			"field.activeProvider": "Active Provider",
			"field.baseURL": "API Base URL",
			"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
			"field.apiKeyEnv": "Credential Reference",
			"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
			"field.apiKeyEnv.hint": "Reference name stored in MinerU configuration. The API key value is kept separately by DeepSeek Harness.",
			"field.apiKey": "API Key",
			"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
			"field.configuredVersion": "Server Protocol / Version",
			"field.modelMap.pipeline": "Pipeline Backend Map",
			"field.modelMap.pipeline.hint": "Backend engine identifier sent to the self-hosted MinerU server for pipeline requests. Default and standard value is pipeline.",
			"field.modelMap.pipeline.placeholder": "pipeline",
			"field.modelMap.vlm": "VLM Backend Map",
			"field.modelMap.vlm.hint": "Backend engine identifier sent to the self-hosted MinerU server for VLM requests. Common choices include hybrid-engine (hybrid layout + VLM, recommended) and vlm-engine (pure local VLM).",
			"field.modelMap.vlm.placeholder": "hybrid-engine or vlm-engine",
			"field.modelMap.chip.default": "default",
			"field.modelMap.chip.recommended": "recommended",
			"field.modelMap.chip.vlmEngine": "pure VLM",
			"field.modelMap.opt.pipeline": "pipeline (Rule & OCR pipeline, fast and deterministic)",
			"field.modelMap.opt.hybridEngine": "hybrid-engine (Layout analysis + VLM hybrid, high accuracy & low hallucination - recommended)",
			"field.modelMap.opt.vlmEngine": "vlm-engine (Pure local VLM inference)",
			"field.officialModels": "Supported Cloud Models",
			"field.defaultModel": "Default Model",
			"field.defaultParseMethod": "Default Parse Method",
			"field.defaultLang": "Default Language",
			"field.defaultFormula": "Enable Formula Extraction",
			"field.defaultTable": "Enable Table Extraction",
			"field.storageRoot": "Storage Root Directory",
			"field.cacheEnabled": "Enable Global Cache",
			"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
			"field.pollIntervalMs": "Poll Interval (ms)",
			"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
			"field.requestTimeoutMs": "Request Timeout (ms)",
			"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
			"field.retryMaxAttempts": "Maximum Attempts",
			"field.retryBaseDelayMs": "Base Retry Delay (ms)",
			"field.retryMaxDelayMs": "Maximum Retry Delay (ms)",
			"field.maxInlineChars": "Max Response Characters",
			"field.maxInlineImages": "Max Inlined Images",
			"field.maxFileBytes": "Max File Bytes",
			"field.maxApiResponseBytes": "Max API Response Bytes",
			"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
			"field.maxZipEntries": "Max ZIP Entries",
			"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
			"field.maxZipTotalBytes": "Max ZIP Total Bytes",
			"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
			"action.save": "Save Configuration",
			"action.saved": "Saved",
			"action.resetDefaults": "Reset to Defaults",
			"action.resetSection": "Reset",
			"action.test": "Test Active Provider",
			"action.testing": "Testing…",
			"action.clearApiKey": "Clear API Key",
			"action.clearingApiKey": "Clearing…",
			"action.storageStats": "Refresh Statistics",
			"action.integrityScan": "Verify Cache",
			"action.gcPreview": "Preview GC",
			"action.cacheClear": "Clear Cache",
			"action.cacheClearConfirm": "Confirm Clear",
			"action.quarantineList": "List Quarantine",
			"action.cleanupPreview": "Preview Cleanup",
			"action.cleanupDelete": "Delete Selected",
			"action.cleanupConfirm": "Confirm Delete",
			"action.running": "Running…",
			"ops.statsIncomplete": "Incomplete storage scan: marked totals are lower bounds, not exact sizes or counts.",
			"ops.bytes": "Bytes",
			"ops.entries": "Entries",
			"ops.results": "Published Results",
			"ops.staging": "Staging",
			"ops.quarantine": "Quarantine",
			"ops.readOnly": "Read-only",
			"ops.valid": "Valid",
			"ops.corrupt": "Corrupt",
			"ops.missing": "Missing",
			"ops.unreadable": "Unreadable",
			"ops.gcEligible": "Complete Preview",
			"ops.gcBlocked": "Blocked Preview",
			"ops.gcCandidates": "Candidates",
			"ops.clearReady": "Ready to Clear",
			"ops.clearBlocked": "Clear Blocked",
			"ops.activeOperations": "Active Operations",
			"ops.selectAll": "Select all quarantine entries",
			"ops.modified": "Modified",
			"ops.cleanupPlanned": "Planned",
			"ops.cleanupDeleted": "Deleted",
			"test.healthy": "Connection Healthy",
			"test.unhealthy": "Service Unhealthy",
			"test.error": "Test Failed",
			"credential.placeholderStored": "Stored; leave blank to keep the current key",
			"credential.placeholderEmpty": "Enter an API key to store on save",
			"credential.loading": "Checking credential status…",
			"credential.configured": "A credential is configured. Saving with this field blank keeps it unchanged.",
			"credential.notConfigured": "No credential is configured. Enter a key and save the configuration to store it.",
			"credential.readOnly": "This credential comes from a read-only source, such as the process environment, and cannot be changed here.",
			"credential.referenceRequired": "Set a credential reference before entering an API key.",
			"provider.type.selfHosted": "Self-Hosted MinerU (v2 API)",
			"provider.type.official": "Official MinerU Cloud (v4 API)",
			"model.pipeline": "Pipeline (Hallucination-free, multi-language)",
			"model.vlm": "VLM (Visual Language Model)",
			"parse.auto": "auto (Automatic detection)",
			"parse.txt": "txt (Fast text only, no OCR)",
			"parse.ocr": "ocr (Force OCR recognition)",
			"artifact.markdown": "Markdown (.md)",
			"artifact.layout": "Layout (.json)",
			"artifact.model-output": "Model Output (.json)",
			"artifact.content-list": "Content List (.json)",
			"artifact.images": "Extracted Images"
		};
		const zh = {
			"nav": "MinerU",
			"page.title": "MinerU 配置",
			"page.intro": "配置 MinerU 文档解析 Provider、全局内容寻址缓存及执行资源上限。",
			"section.provider": "Provider 适配与鉴权",
			"section.defaults": "统一解析默认值",
			"section.storage": "存储与全局缓存",
			"section.operations": "存储运维",
			"section.polling": "轮询与超时控制",
			"section.retry": "网络重试策略",
			"section.output": "模型输出限制",
			"section.limits": "安全与资源上限",
			"section.limits.restartHint": "安全与有效载荷上限在插件启动时初始化并绑定存储仓，修改需要重启插件后生效。",
			"section.provider.desc": "Provider 配置文件、服务端点、协议版本与认证凭据管理",
			"section.defaults.desc": "默认解析模型、提取方式、目标语言与公式表格开关",
			"section.storage.desc": "内容寻址缓存根目录、全局缓存开关与暂存区清理 TTL",
			"section.operations.desc": "存储统计、缓存完整性校验、GC 预览清理与隔离区管理",
			"section.polling.desc": "状态轮询间隔、同步等待超时与单进程共享操作时限",
			"section.retry.desc": "指数退避重试策略、最大尝试次数与延迟上下限",
			"section.output.desc": "单次模型响应字符上限与内联图片配额",
			"section.limits.desc": "系统有效载荷上限、安全解压比与 ZIP 边界保护（启动时绑定）",
			"action.retryLoad": "重新加载",
			"badge.selfHosted": "自托管 (v2)",
			"badge.official": "官方云 (v4)",
			"action.expandAll": "展开全部",
			"action.collapseAll": "折叠全部",
			"action.expand": "展开卡片",
			"action.collapse": "折叠卡片",
			"action.dismiss": "关闭提示",
			"unit.attempts": "次尝试",
			"unit.chars": "字符",
			"unit.images": "张图片",
			"unit.ms": "ms",
			"unit.seconds": "秒",
			"unit.fileLimit": "文件上限",
			"badge.configured": "已配置凭据",
			"badge.notConfigured": "未配置凭据",
			"badge.healthy": "连接正常",
			"badge.unhealthy": "状态异常",
			"badge.testing": "测试中…",
			"badge.cacheOn": "已开启缓存",
			"badge.cacheOff": "已关闭缓存",
			"badge.readOnly": "只读",
			"badge.maintenance": "预览后确认",
			"notice.officialTxtToAuto": "官方 v4 Provider 不支持 txt 纯文本提取模式，解析方式已自动调整为 auto。",
			"field.activeProvider": "当前激活的 Provider",
			"field.baseURL": "API 服务地址",
			"field.baseURL.placeholder": "https://mineru.net/api/v4 或 http://localhost:18000",
			"field.apiKeyEnv": "凭据引用名",
			"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
			"field.apiKeyEnv.hint": "MinerU 配置中仅保存此引用名；API Key 值由 DeepSeek Harness 凭据服务单独保管。",
			"field.apiKey": "API Key",
			"field.allowInsecureHttp": "允许非加密 HTTP 连接",
			"field.configuredVersion": "服务端协议版本标识",
			"field.modelMap.pipeline": "Pipeline 模型后端映射",
			"field.modelMap.pipeline.hint": "自托管 MinerU 服务端在处理 pipeline（规则与 OCR 流水线）解析请求时调用的底层后端标识，默认且通常填写 pipeline。",
			"field.modelMap.pipeline.placeholder": "pipeline",
			"field.modelMap.vlm": "VLM 模型后端映射",
			"field.modelMap.vlm.hint": "自托管 MinerU 服务端在处理 vlm（视觉大模型）解析请求时调用的底层后端标识。常用项包括 hybrid-engine（混合引擎，高精度低幻觉，推荐）和 vlm-engine（纯本地视觉大模型）。",
			"field.modelMap.vlm.placeholder": "hybrid-engine 或 vlm-engine",
			"field.modelMap.chip.default": "默认",
			"field.modelMap.chip.recommended": "推荐",
			"field.modelMap.chip.vlmEngine": "纯 VLM",
			"field.modelMap.opt.pipeline": "pipeline（规则与 OCR 流水线，速度快且无幻觉）",
			"field.modelMap.opt.hybridEngine": "hybrid-engine（版面分析 + VLM 混合引擎，高精度低幻觉，推荐）",
			"field.modelMap.opt.vlmEngine": "vlm-engine（纯本地视觉大模型端到端推理）",
			"field.officialModels": "云服务支持模型",
			"field.defaultModel": "默认解析模型",
			"field.defaultParseMethod": "默认解析方式",
			"field.defaultLang": "默认语言",
			"field.defaultFormula": "开启公式解析",
			"field.defaultTable": "开启表格解析",
			"field.storageRoot": "持久存储根目录",
			"field.cacheEnabled": "启用全局内容寻址缓存",
			"field.stagingTtlMs": "Staging 暂存清理 TTL (ms)",
			"field.pollIntervalMs": "状态轮询间隔 (ms)",
			"field.pollTimeoutMs": "同步等待解析超时 (ms)",
			"field.requestTimeoutMs": "单次网络请求超时 (ms)",
			"field.operationTimeoutMs": "单进程共享操作超时 (ms)",
			"field.retryMaxAttempts": "最大尝试次数",
			"field.retryBaseDelayMs": "基础重试延迟 (ms)",
			"field.retryMaxDelayMs": "最大重试延迟 (ms)",
			"field.maxInlineChars": "单次响应字符预算",
			"field.maxInlineImages": "单次响应内联图片预算",
			"field.maxFileBytes": "单个源文件大小上限 (bytes)",
			"field.maxApiResponseBytes": "API 响应体大小上限 (bytes)",
			"field.maxZipDownloadBytes": "ZIP 下载包大小上限 (bytes)",
			"field.maxZipEntries": "ZIP 最大解压条目数",
			"field.maxZipEntryBytes": "ZIP 单条目解压字节上限 (bytes)",
			"field.maxZipTotalBytes": "ZIP 总解压字节上限 (bytes)",
			"field.maxZipCompressionRatio": "ZIP 最大解压压缩比",
			"action.save": "保存配置",
			"action.saved": "已保存",
			"action.resetDefaults": "恢复默认配置",
			"action.resetSection": "重置",
			"action.test": "测试当前 Provider 连接",
			"action.testing": "测试中…",
			"action.clearApiKey": "清除 API Key",
			"action.clearingApiKey": "清除中…",
			"action.storageStats": "刷新统计",
			"action.integrityScan": "校验缓存",
			"action.gcPreview": "预览 GC",
			"action.cacheClear": "清除缓存",
			"action.cacheClearConfirm": "确认清除",
			"action.quarantineList": "查看隔离区",
			"action.cleanupPreview": "预览清理",
			"action.cleanupDelete": "删除已选项",
			"action.cleanupConfirm": "确认删除",
			"action.running": "执行中…",
			"ops.statsIncomplete": "存储扫描不完整：带标记的数值仅为下界，并非精确大小或条目数。",
			"ops.bytes": "字节数",
			"ops.entries": "条目数",
			"ops.results": "已发布结果",
			"ops.staging": "暂存区",
			"ops.quarantine": "隔离区",
			"ops.readOnly": "只读",
			"ops.valid": "有效",
			"ops.corrupt": "损坏",
			"ops.missing": "缺失",
			"ops.unreadable": "不可读",
			"ops.gcEligible": "预览完整",
			"ops.gcBlocked": "预览受阻",
			"ops.gcCandidates": "候选项",
			"ops.clearReady": "可以清除",
			"ops.clearBlocked": "清除受阻",
			"ops.activeOperations": "活动共享操作",
			"ops.selectAll": "选择全部隔离条目",
			"ops.modified": "修改时间",
			"ops.cleanupPlanned": "计划清理",
			"ops.cleanupDeleted": "已删除",
			"test.healthy": "连接正常",
			"test.unhealthy": "服务状态异常",
			"test.error": "连接测试失败",
			"credential.placeholderStored": "已保存；留空将保留当前 Key",
			"credential.placeholderEmpty": "输入 API Key，保存配置时写入凭据服务",
			"credential.loading": "正在检查凭据状态…",
			"credential.configured": "凭据已配置；API Key 留空保存不会覆盖现有值。",
			"credential.notConfigured": "尚未配置凭据；输入 API Key 并保存配置即可写入。",
			"credential.readOnly": "该凭据来自进程环境变量等只读来源，无法在此修改或清除。",
			"credential.referenceRequired": "请先填写凭据引用名，再输入 API Key。",
			"provider.type.selfHosted": "自托管 MinerU (v2 API)",
			"provider.type.official": "官方云服务 MinerU (v4 API)",
			"model.pipeline": "Pipeline（无幻觉，支持多语言 OCR）",
			"model.vlm": "VLM（视觉大模型）",
			"parse.auto": "auto（自动检测）",
			"parse.txt": "txt（纯文本提取，速度快）",
			"parse.ocr": "ocr（强制文字 OCR）",
			"artifact.markdown": "Markdown 文本 (.md)",
			"artifact.layout": "版面分析 (.json)",
			"artifact.model-output": "模型输出 (.json)",
			"artifact.content-list": "结构化内容块 (.json)",
			"artifact.images": "提取图片"
		};
		//#endregion
		//#region src/client/index.ts
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"remote.credentials"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-pdf-mineru: dictionaries");
			const connection = ctx.get("connection");
			if (connection === void 0) throw new Error("dsh-pdf-mineru: connection service is unavailable");
			const t = ctx.locale.bind(NS);
			const injected = () => ({
				rpc: connection.rpc,
				credentials: ctx.remote.credentials
			});
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: NS,
				order: 40,
				label: () => t("nav"),
				locale: NS,
				inject: injected
			}, SettingsPage));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map