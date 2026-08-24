window.__ModuleLoader__.load({
	id: "dsh-pdf-mineru",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:/mnt/data/yurzi/Workspaces/dsh/dsh-pdf-mineru/src/client/SettingsPage.module.css.mjs
		const css = ".61pybv_section {\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n  max-width: 800px;\n  color: var(--dsw-alias-label-primary);\n  padding-bottom: 32px;\n}\n\n.61pybv_title {\n  margin: 0;\n  font-size: 18px;\n  line-height: 26px;\n  font-weight: 600;\n  color: var(--dsw-alias-label-primary);\n}\n\n.61pybv_intro {\n  margin: 0;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.61pybv_error {\n  margin: 0;\n  padding: 8px 12px;\n  border: 1px solid var(--dsw-alias-state-error-primary);\n  border-radius: 6px;\n  background: var(--dsw-alias-interactive-bg-hover-danger);\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-state-error-primary);\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.61pybv_errorDismiss {\n  flex: none;\n  border: none;\n  background: transparent;\n  color: inherit;\n  font-size: 16px;\n  line-height: 1;\n  cursor: pointer;\n  padding: 0 4px;\n}\n\n.61pybv_loading {\n  font-size: 14px;\n  line-height: 22px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.61pybv_editorGroup {\n  border: 0;\n  border-top: 1px solid var(--dsw-alias-border-l2);\n  padding: 16px 0 0;\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  background: transparent;\n}\n\n.61pybv_groupTitle {\n  margin: 0 0 4px 0;\n  font-size: 14px;\n  line-height: 20px;\n  font-weight: 600;\n  color: var(--dsw-alias-label-primary);\n  border-bottom: 1px solid var(--dsw-alias-border-l3);\n  padding-bottom: 6px;\n}\n\n.61pybv_row {\n  display: flex;\n  gap: 12px;\n  flex-wrap: wrap;\n}\n\n.61pybv_row > .61pybv_field {\n  flex: 1 1 220px;\n}\n\n.61pybv_field {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.61pybv_checkboxField {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  cursor: pointer;\n  user-select: none;\n}\n\n.61pybv_fieldLabel {\n  font-size: 12px;\n  line-height: 18px;\n  font-weight: 500;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.61pybv_checkboxLabel {\n  font-size: 13px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.61pybv_input,\n.61pybv_select {\n  height: 32px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 0 10px;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-layer-1);\n  outline: none;\n}\n\n.61pybv_input:focus,\n.61pybv_select:focus {\n  border-color: var(--dsw-alias-brand-primary);\n}\n\n.61pybv_checkboxGroup {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 12px;\n  margin-top: 4px;\n}\n\n.61pybv_checkboxOption {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 12px;\n  color: var(--dsw-alias-label-primary);\n  cursor: pointer;\n}\n\n.61pybv_actionBar {\n  display: flex;\n  align-items: center;\n  justify-content: flex-start;\n  gap: 12px;\n  padding-top: 8px;\n}\n\n.61pybv_primaryButton {\n  height: 34px;\n  padding: 0 16px;\n  border: none;\n  border-radius: 6px;\n  background: var(--dsw-alias-brand-primary);\n  color: #fff;\n  font-size: 13px;\n  font-weight: 500;\n  cursor: pointer;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n}\n\n.61pybv_primaryButton:hover:not(:disabled) {\n  opacity: 0.9;\n}\n\n.61pybv_primaryButton:disabled {\n  opacity: 0.5;\n  cursor: not-allowed;\n}\n\n.61pybv_secondaryButton {\n  height: 34px;\n  padding: 0 14px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  background: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-primary);\n  font-size: 13px;\n  font-weight: 500;\n  cursor: pointer;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n}\n\n.61pybv_secondaryButton:hover:not(:disabled) {\n  background: var(--dsw-alias-bg-layer-2);\n}\n\n.61pybv_secondaryButton:disabled {\n  opacity: 0.5;\n  cursor: not-allowed;\n}\n\n.61pybv_testResult {\n  padding: 10px 12px;\n  border-radius: 6px;\n  font-size: 12px;\n  line-height: 18px;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.61pybv_testResultHealthy {\n  background: var(--dsw-alias-state-success-bg, rgba(46, 160, 67, 0.1));\n  border: 1px solid var(--dsw-alias-state-success-primary, #2ea043);\n  color: var(--dsw-alias-state-success-primary, #2ea043);\n}\n\n.61pybv_testResultError {\n  background: var(--dsw-alias-state-error-bg, rgba(248, 81, 73, 0.1));\n  border: 1px solid var(--dsw-alias-state-error-primary, #f85149);\n  color: var(--dsw-alias-state-error-primary, #f85149);\n}\n\n.61pybv_testResultTesting {\n  background: var(--dsw-alias-bg-layer-2);\n  border: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.61pybv_testHeader {\n  font-weight: 600;\n}\n\n.61pybv_testDetails {\n  font-family: monospace;\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary);\n}\n";
		const classMap = {
			"section": "61pybv_section",
			"title": "61pybv_title",
			"intro": "61pybv_intro",
			"error": "61pybv_error",
			"errorDismiss": "61pybv_errorDismiss",
			"loading": "61pybv_loading",
			"editorGroup": "61pybv_editorGroup",
			"groupTitle": "61pybv_groupTitle",
			"row": "61pybv_row",
			"field": "61pybv_field",
			"checkboxField": "61pybv_checkboxField",
			"fieldLabel": "61pybv_fieldLabel",
			"checkboxLabel": "61pybv_checkboxLabel",
			"input": "61pybv_input",
			"select": "61pybv_select",
			"checkboxGroup": "61pybv_checkboxGroup",
			"checkboxOption": "61pybv_checkboxOption",
			"actionBar": "61pybv_actionBar",
			"primaryButton": "61pybv_primaryButton",
			"secondaryButton": "61pybv_secondaryButton",
			"testResult": "61pybv_testResult",
			"testResultHealthy": "61pybv_testResultHealthy",
			"testResultError": "61pybv_testResultError",
			"testResultTesting": "61pybv_testResultTesting",
			"testHeader": "61pybv_testHeader",
			"testDetails": "61pybv_testDetails"
		};
		const tagId = "dsh-pdf-mineru/SettingsPage.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-pdf-mineru";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		} else if (typeof document !== "undefined") {
			const existing = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]");
			if (existing) existing.textContent = css;
		}
		//#endregion
		//#region src/client/SettingsPage.tsx
		const ALL_ARTIFACT_KINDS = [
			"markdown",
			"layout",
			"model-output",
			"content-list",
			"images"
		];
		function switchProviderType(provider, nextType) {
			if (provider.type === nextType) return provider;
			if (nextType === "self-hosted-v2") {
				const isMineruCloud = provider.baseURL.includes("mineru.net");
				return {
					id: provider.id,
					type: "self-hosted-v2",
					baseURL: isMineruCloud ? "http://localhost:18000" : provider.baseURL,
					apiKeyEnv: provider.apiKeyEnv,
					modelMap: {
						pipeline: "pipeline",
						vlm: "vlm-engine"
					},
					allowInsecureHttp: true
				};
			}
			return {
				id: provider.id,
				type: "official-v4",
				baseURL: "https://mineru.net/api/v4",
				apiKeyEnv: provider.apiKeyEnv || "MINERU_API_KEY",
				models: ["pipeline", "vlm"],
				configuredVersion: "v4"
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
		function SettingsPage({ rpc, t }) {
			const [config, setConfig] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saved, setSaved] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			const [testState, setTestState] = (0, react.useState)({ status: "idle" });
			const refresh = (0, react.useCallback)(async () => {
				setLoading(true);
				setError(void 0);
				try {
					const result = await callRpc(rpc, "mineru/config.get", {});
					if (result.ok) {
						setConfig(result.value.config);
						setDraft(result.value.config);
					} else setError(result.error.message);
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setLoading(false);
				}
			}, [rpc]);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			const save = (0, react.useCallback)(async () => {
				if (draft === null) return;
				setSaving(true);
				setError(void 0);
				setSaved(false);
				try {
					const result = await callRpc(rpc, "mineru/config.set", { config: draft });
					if (result.ok) {
						setConfig(result.value.config);
						setDraft(result.value.config);
						setSaved(true);
						setTimeout(() => setSaved(false), 2e3);
					} else setError(result.error.message);
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setSaving(false);
				}
			}, [draft, rpc]);
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
			if (loading || draft === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: classMap.section,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					className: classMap.title,
					children: t("page.title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: classMap.loading,
					children: "…"
				})]
			});
			const activeProvider = draft.providers.find((p) => p.id === draft.activeProvider) ?? draft.providers[0];
			const normalizeOfficialDefaults = (config, provider) => {
				if (provider.type !== "official-v4" || config.defaults.parseMethod !== "txt") return config;
				return updateConfigSection(config, "defaults", {
					parseMethod: "auto",
					ocr: false
				});
			};
			const handleActiveTypeChange = (newType) => {
				const updated = switchProviderType(activeProvider, newType);
				setDraft((prev) => {
					if (prev === null) return prev;
					return normalizeOfficialDefaults(patchActiveProvider(prev, updated), updated);
				});
			};
			const toggleArtifact = (kind) => {
				const current = draft.defaults.artifacts;
				let next;
				if (current.includes(kind)) {
					if (kind === "markdown") return;
					next = current.filter((k) => k !== kind);
				} else next = [...current, kind];
				setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "defaults", { artifacts: next }));
			};
			const toggleOfficialModel = (model) => {
				if (activeProvider.type !== "official-v4") return;
				const current = activeProvider.models;
				let next;
				if (current.includes(model)) {
					if (current.length <= 1) return;
					next = current.filter((m) => m !== model);
				} else next = [...current, model];
				setDraft((prev) => prev === null ? prev : patchActiveProvider(prev, { models: next }));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: classMap.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: classMap.title,
						children: t("page.title")
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.error,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: error }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: classMap.errorDismiss,
							onClick: () => setError(void 0),
							children: "×"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.actionBar,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: classMap.primaryButton,
							disabled: saving,
							onClick: () => void save(),
							children: saving ? "…" : saved ? t("action.saved") : t("action.save")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: classMap.secondaryButton,
							disabled: testState.status === "testing",
							onClick: () => void testActiveProvider(),
							children: testState.status === "testing" ? t("action.testing") : t("action.test")
						})]
					}),
					testState.status !== "idle" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: `${classMap.testResult} ${testState.status === "healthy" ? classMap.testResultHealthy : testState.status === "unhealthy" || testState.status === "error" ? classMap.testResultError : classMap.testResultTesting}`,
						children: [
							testState.status === "testing" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("action.testing") }),
							testState.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: classMap.testHeader,
								children: t("test.error")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: testState.error })] }),
							(testState.status === "healthy" || testState.status === "unhealthy") && testState.view && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.testHeader,
								children: [
									testState.status === "healthy" ? t("test.healthy") : t("test.unhealthy"),
									" — ",
									testState.view.provider
								]
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
						className: classMap.editorGroup,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: classMap.groupTitle,
								children: t("section.provider")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.activeProvider")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
										className: classMap.select,
										value: draft.activeProvider,
										onChange: (event) => setDraft((prev) => {
											if (prev === null) return prev;
											const provider = prev.providers.find((candidate) => candidate.id === event.target.value);
											if (provider === void 0) return prev;
											return normalizeOfficialDefaults({
												...prev,
												activeProvider: provider.id
											}, provider);
										}),
										children: draft.providers.map((provider) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
											value: provider.id,
											children: [
												provider.id,
												" (",
												provider.type,
												")"
											]
										}, provider.id))
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.providerType")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: classMap.select,
										value: activeProvider.type,
										onChange: (e) => handleActiveTypeChange(e.target.value),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "self-hosted-v2",
											children: t("provider.type.selfHosted")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "official-v4",
											children: t("provider.type.official")
										})]
									})]
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
										value: activeProvider.baseURL,
										placeholder: t("field.baseURL.placeholder"),
										onChange: (e) => setDraft((prev) => prev === null ? prev : patchActiveProvider(prev, { baseURL: e.target.value }))
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.apiKeyEnv")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										value: activeProvider.apiKeyEnv ?? "",
										placeholder: t("field.apiKeyEnv.placeholder"),
										onChange: (e) => setDraft((prev) => prev === null ? prev : patchActiveProvider(prev, { apiKeyEnv: e.target.value || void 0 }))
									})]
								})]
							}),
							activeProvider.type === "self-hosted-v2" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.modelMap.pipeline")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										value: activeProvider.modelMap.pipeline,
										onChange: (e) => {
											const currentMap = activeProvider.modelMap;
											setDraft((prev) => prev === null ? prev : patchActiveProvider(prev, { modelMap: {
												...currentMap,
												pipeline: e.target.value
											} }));
										}
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.modelMap.vlm")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										value: activeProvider.modelMap.vlm,
										onChange: (e) => {
											const currentMap = activeProvider.modelMap;
											setDraft((prev) => prev === null ? prev : patchActiveProvider(prev, { modelMap: {
												...currentMap,
												vlm: e.target.value
											} }));
										}
									})]
								})]
							})] }),
							activeProvider.type === "official-v4" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
											onChange: () => toggleOfficialModel(m)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(m === "pipeline" ? "model.pipeline" : "model.vlm") })]
									}, m))
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.editorGroup,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: classMap.groupTitle,
								children: t("section.defaults")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.row,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: classMap.field,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: classMap.fieldLabel,
											children: t("field.defaultModel")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											className: classMap.select,
											value: draft.defaults.model,
											onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "defaults", { model: e.target.value })),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "pipeline",
												children: t("model.pipeline")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "vlm",
												children: t("model.vlm")
											})]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: classMap.field,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: classMap.fieldLabel,
											children: t("field.defaultParseMethod")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											className: classMap.select,
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
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap.fieldLabel,
									children: t("field.defaultArtifacts")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: classMap.checkboxGroup,
									children: ALL_ARTIFACT_KINDS.map((kind) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: classMap.checkboxOption,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: draft.defaults.artifacts.includes(kind),
											disabled: kind === "markdown",
											onChange: () => toggleArtifact(kind)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(`artifact.${kind}`) })]
									}, kind))
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.editorGroup,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: classMap.groupTitle,
								children: t("section.storage")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.storageRoot")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										value: draft.storage.storageRoot,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "storage", { storageRoot: e.target.value }))
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.stagingTtlMs")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										value: draft.storage.stagingTtlMs,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "storage", { stagingTtlMs: Number(e.target.value) }))
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.editorGroup,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: classMap.groupTitle,
								children: t("section.polling")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.pollIntervalMs")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										value: draft.polling.pollIntervalMs,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "polling", { pollIntervalMs: Number(e.target.value) }))
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.pollTimeoutMs")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										value: draft.polling.pollTimeoutMs,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "polling", { pollTimeoutMs: Number(e.target.value) }))
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.requestTimeoutMs")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										value: draft.polling.requestTimeoutMs,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "polling", { requestTimeoutMs: Number(e.target.value) }))
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.operationTimeoutMs")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										value: draft.polling.operationTimeoutMs,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "polling", { operationTimeoutMs: Number(e.target.value) }))
									})]
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.editorGroup,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: classMap.groupTitle,
							children: t("section.output")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: classMap.row,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: classMap.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap.fieldLabel,
									children: t("field.maxInlineChars")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: classMap.input,
									type: "number",
									value: draft.output.maxInlineChars,
									onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "output", { maxInlineChars: Number(e.target.value) }))
								})]
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.editorGroup,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: classMap.groupTitle,
								children: t("section.limits")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxFilesPerRequest")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										value: draft.limits.maxFilesPerRequest,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "limits", { maxFilesPerRequest: Number(e.target.value) }))
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxFileBytes")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										value: draft.limits.maxFileBytes,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "limits", { maxFileBytes: Number(e.target.value) }))
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxApiResponseBytes")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										value: draft.limits.maxApiResponseBytes,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "limits", { maxApiResponseBytes: Number(e.target.value) }))
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxZipDownloadBytes")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										value: draft.limits.maxZipDownloadBytes,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "limits", { maxZipDownloadBytes: Number(e.target.value) }))
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxZipEntries")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										value: draft.limits.maxZipEntries,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "limits", { maxZipEntries: Number(e.target.value) }))
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxZipEntryBytes")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										value: draft.limits.maxZipEntryBytes,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "limits", { maxZipEntryBytes: Number(e.target.value) }))
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: classMap.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxZipTotalBytes")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										value: draft.limits.maxZipTotalBytes,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "limits", { maxZipTotalBytes: Number(e.target.value) }))
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.maxZipCompressionRatio")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										value: draft.limits.maxZipCompressionRatio,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "limits", { maxZipCompressionRatio: Number(e.target.value) }))
									})]
								})]
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
			"section.polling": "Polling & Timeouts",
			"section.output": "Output Limits",
			"section.limits": "Security & Payload Limits",
			"field.activeProvider": "Active Provider",
			"field.providerType": "Provider Type",
			"field.baseURL": "API Base URL",
			"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
			"field.apiKeyEnv": "API Key Env Var",
			"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
			"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
			"field.configuredVersion": "Server Protocol / Version",
			"field.modelMap.pipeline": "Pipeline Backend Map",
			"field.modelMap.vlm": "VLM Backend Map",
			"field.officialModels": "Supported Cloud Models",
			"field.defaultModel": "Default Model",
			"field.defaultParseMethod": "Default Parse Method",
			"field.defaultLang": "Default Language",
			"field.defaultFormula": "Enable Formula Extraction",
			"field.defaultTable": "Enable Table Extraction",
			"field.defaultArtifacts": "Default Required Artifacts",
			"field.storageRoot": "Storage Root Directory",
			"field.cacheEnabled": "Enable Global Cache",
			"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
			"field.pollIntervalMs": "Poll Interval (ms)",
			"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
			"field.requestTimeoutMs": "Request Timeout (ms)",
			"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
			"field.maxInlineChars": "Max Inline Markdown Chars",
			"field.maxFilesPerRequest": "Max Files Per Request",
			"field.maxFileBytes": "Max File Bytes",
			"field.maxApiResponseBytes": "Max API Response Bytes",
			"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
			"field.maxZipEntries": "Max ZIP Entries",
			"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
			"field.maxZipTotalBytes": "Max ZIP Total Bytes",
			"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
			"action.save": "Save Configuration",
			"action.saved": "Saved",
			"action.test": "Test Active Provider",
			"action.testing": "Testing…",
			"test.healthy": "Connection Healthy",
			"test.unhealthy": "Service Unhealthy",
			"test.error": "Test Failed",
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
			"section.polling": "轮询与超时控制",
			"section.output": "模型输出限制",
			"section.limits": "安全与资源上限",
			"field.activeProvider": "当前激活的 Provider",
			"field.providerType": "Provider 类型",
			"field.baseURL": "API 服务地址",
			"field.baseURL.placeholder": "https://mineru.net/api/v4 或 http://localhost:18000",
			"field.apiKeyEnv": "API Key 环境变量名",
			"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
			"field.allowInsecureHttp": "允许非加密 HTTP 连接",
			"field.configuredVersion": "服务端协议版本标识",
			"field.modelMap.pipeline": "Pipeline 模型后端映射",
			"field.modelMap.vlm": "VLM 模型后端映射",
			"field.officialModels": "云服务支持模型",
			"field.defaultModel": "默认解析模型",
			"field.defaultParseMethod": "默认解析方式",
			"field.defaultLang": "默认语言",
			"field.defaultFormula": "开启公式解析",
			"field.defaultTable": "开启表格解析",
			"field.defaultArtifacts": "默认必要产物",
			"field.storageRoot": "持久存储根目录",
			"field.cacheEnabled": "启用全局内容寻址缓存",
			"field.stagingTtlMs": "Staging 暂存清理 TTL (ms)",
			"field.pollIntervalMs": "状态轮询间隔 (ms)",
			"field.pollTimeoutMs": "同步等待解析超时 (ms)",
			"field.requestTimeoutMs": "单次网络请求超时 (ms)",
			"field.operationTimeoutMs": "单进程共享操作超时 (ms)",
			"field.maxInlineChars": "Markdown 预览字符上限",
			"field.maxFilesPerRequest": "单次请求最大文件数",
			"field.maxFileBytes": "单个源文件大小上限 (bytes)",
			"field.maxApiResponseBytes": "API 响应体大小上限 (bytes)",
			"field.maxZipDownloadBytes": "ZIP 下载包大小上限 (bytes)",
			"field.maxZipEntries": "ZIP 最大解压条目数",
			"field.maxZipEntryBytes": "ZIP 单条目解压字节上限 (bytes)",
			"field.maxZipTotalBytes": "ZIP 总解压字节上限 (bytes)",
			"field.maxZipCompressionRatio": "ZIP 最大解压压缩比",
			"action.save": "保存配置",
			"action.saved": "已保存",
			"action.test": "测试当前 Provider 连接",
			"action.testing": "测试中…",
			"test.healthy": "连接正常",
			"test.unhealthy": "服务状态异常",
			"test.error": "连接测试失败",
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
		//#region src/client/dictionaries.ts
		const dicts = {
			"ja": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"de": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"fr": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"pt": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"ko": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"ar": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"hi": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"id": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"tr": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"vi": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"th": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"ru": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"it": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"nl": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"sv": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			},
			"pl": {
				"nav": "MinerU",
				"page.title": "MinerU Configuration",
				"page.intro": "Configure MinerU document parsing providers, global content-addressed caching, and execution limits.",
				"section.provider": "Provider Settings",
				"section.defaults": "Parsing Defaults",
				"section.storage": "Storage & Cache",
				"section.polling": "Polling & Timeouts",
				"section.output": "Output Limits",
				"section.limits": "Security & Payload Limits",
				"field.activeProvider": "Active Provider",
				"field.providerType": "Provider Type",
				"field.baseURL": "API Base URL",
				"field.baseURL.placeholder": "https://mineru.net/api/v4 or http://localhost:18000",
				"field.apiKeyEnv": "API Key Env Var",
				"field.apiKeyEnv.placeholder": "MINERU_API_KEY",
				"field.allowInsecureHttp": "Allow Insecure HTTP (Local Only)",
				"field.configuredVersion": "Server Protocol / Version",
				"field.modelMap.pipeline": "Pipeline Backend Map",
				"field.modelMap.vlm": "VLM Backend Map",
				"field.officialModels": "Supported Cloud Models",
				"field.defaultModel": "Default Model",
				"field.defaultParseMethod": "Default Parse Method",
				"field.defaultLang": "Default Language",
				"field.defaultFormula": "Enable Formula Extraction",
				"field.defaultTable": "Enable Table Extraction",
				"field.defaultArtifacts": "Default Required Artifacts",
				"field.storageRoot": "Storage Root Directory",
				"field.cacheEnabled": "Enable Global Cache",
				"field.stagingTtlMs": "Staging Cleanup TTL (ms)",
				"field.pollIntervalMs": "Poll Interval (ms)",
				"field.pollTimeoutMs": "Sync Tool Timeout (ms)",
				"field.requestTimeoutMs": "Request Timeout (ms)",
				"field.operationTimeoutMs": "Shared Operation Timeout (ms)",
				"field.maxInlineChars": "Max Inline Markdown Chars",
				"field.maxFilesPerRequest": "Max Files Per Request",
				"field.maxFileBytes": "Max File Bytes",
				"field.maxApiResponseBytes": "Max API Response Bytes",
				"field.maxZipDownloadBytes": "Max ZIP Download Bytes",
				"field.maxZipEntries": "Max ZIP Entries",
				"field.maxZipEntryBytes": "Max Single ZIP Entry Bytes",
				"field.maxZipTotalBytes": "Max ZIP Total Bytes",
				"field.maxZipCompressionRatio": "Max ZIP Compression Ratio",
				"action.save": "Save Configuration",
				"action.saved": "Saved",
				"action.test": "Test Active Provider",
				"action.testing": "Testing…",
				"test.healthy": "Connection Healthy",
				"test.unhealthy": "Service Unhealthy",
				"test.error": "Test Failed",
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
			}
		};
		//#endregion
		//#region src/client/index.ts
		const inject = [
			"slots",
			"locale",
			"connection"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-pdf-mineru: dictionaries");
			ctx.effect(() => {
				let dispose;
				const sync = () => {
					dispose?.();
					dispose = void 0;
					const store = ctx.get("betterLocale");
					if (store !== void 0) dispose = store.register(NS, dicts);
				};
				sync();
				const unsubscribe = ctx.locale.subscribe(sync);
				return () => {
					unsubscribe();
					dispose?.();
				};
			}, "dsh-pdf-mineru: better-locale override dicts");
			const connection = ctx.connection;
			const t = ctx.locale.bind(NS);
			const settingsInjected = () => ({
				rpc: connection.rpc,
				t
			});
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-pdf-mineru",
				order: 40,
				label: () => t("nav"),
				inject: settingsInjected
			}, SettingsPage));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map