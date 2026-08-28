window.__ModuleLoader__.load({
	id: "dsh-pdf-mineru",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:/mnt/data/yurzi/Workspaces/dsh/dsh-pdf-mineru/src/client/SettingsPage.module.css.mjs
		const css = ".dshm_o5Lh3q_section{max-width:800px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:16px;padding-bottom:32px;display:flex}.dshm_o5Lh3q_title{color:var(--dsw-alias-label-primary);margin:0;font-size:18px;font-weight:600;line-height:26px}.dshm_o5Lh3q_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}.dshm_o5Lh3q_error{border:1px solid var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-radius:6px;justify-content:space-between;align-items:center;gap:8px;margin:0;padding:8px 12px;font-size:12px;line-height:18px;display:flex}.dshm_o5Lh3q_errorDismiss{color:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0 4px;font-size:16px;line-height:1}.dshm_o5Lh3q_loading{color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px}.dshm_o5Lh3q_editorGroup{border:0;border-top:1px solid var(--dsw-alias-border-l2);background:0 0;flex-direction:column;gap:12px;padding:16px 0 0;display:flex}.dshm_o5Lh3q_groupTitle{color:var(--dsw-alias-label-primary);border-bottom:1px solid var(--dsw-alias-border-l3);margin:0 0 4px;padding-bottom:6px;font-size:14px;font-weight:600;line-height:20px}.dshm_o5Lh3q_row{flex-wrap:wrap;gap:12px;display:flex}.dshm_o5Lh3q_row>.dshm_o5Lh3q_field{flex:220px}.dshm_o5Lh3q_field{flex-direction:column;gap:4px;display:flex}.dshm_o5Lh3q_checkboxField{cursor:pointer;user-select:none;align-items:center;gap:8px;display:flex}.dshm_o5Lh3q_fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}.dshm_o5Lh3q_checkboxLabel{color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px}.dshm_o5Lh3q_input,.dshm_o5Lh3q_select{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);height:32px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border-radius:6px;outline:none;padding:0 10px;font-size:13px;line-height:20px}.dshm_o5Lh3q_input:focus,.dshm_o5Lh3q_select:focus{border-color:var(--dsw-alias-brand-primary)}.dshm_o5Lh3q_input::placeholder{color:var(--dsw-alias-label-dimmed)}.dshm_o5Lh3q_input:disabled,.dshm_o5Lh3q_select:disabled{opacity:.6;cursor:default}.dshm_o5Lh3q_fieldHint{color:var(--dsw-alias-label-tertiary);margin-top:2px;font-size:11px;line-height:16px}.dshm_o5Lh3q_credentialInputRow{grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;display:grid}.dshm_o5Lh3q_credentialInputRow>.dshm_o5Lh3q_input{width:100%;min-width:0}@media (width<=520px){.dshm_o5Lh3q_credentialInputRow{grid-template-columns:minmax(0,1fr)}.dshm_o5Lh3q_credentialInputRow>.dshm_o5Lh3q_secondaryButton{justify-self:start}}.dshm_o5Lh3q_chipGroup{flex-wrap:wrap;gap:6px;margin-top:2px;display:flex}.dshm_o5Lh3q_chip{box-sizing:border-box;height:24px;font-size:11px;line-height:16px;font-family:var(--ds-font-family-code,monospace);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none;border-radius:4px;align-items:center;gap:4px;padding:0 8px;transition:background-color .15s,border-color .15s,color .15s;display:inline-flex}.dshm_o5Lh3q_chip:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}.dshm_o5Lh3q_chipActive{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:500}.dshm_o5Lh3q_chipBadge{opacity:.85;font-family:system-ui,-apple-system,sans-serif;font-size:10px}.dshm_o5Lh3q_checkboxGroup{flex-wrap:wrap;gap:12px;margin-top:4px;display:flex}.dshm_o5Lh3q_checkboxOption{color:var(--dsw-alias-label-primary);cursor:pointer;align-items:center;gap:6px;font-size:12px;display:flex}.dshm_o5Lh3q_checkboxField input[type=checkbox],.dshm_o5Lh3q_checkboxOption input[type=checkbox]{cursor:pointer;accent-color:var(--dsw-alias-state-business-primary)}.dshm_o5Lh3q_actionBar{justify-content:flex-start;align-items:center;gap:12px;padding-top:8px;display:flex}.dshm_o5Lh3q_primaryButton{box-sizing:border-box;background:var(--dsw-alias-button-primary-fill);height:34px;color:var(--dsw-alias-label-primary-foreground);cursor:pointer;border:none;border-radius:6px;justify-content:center;align-items:center;padding:0 16px;font-size:13px;font-weight:500;transition:background-color .15s,opacity .15s;display:inline-flex}.dshm_o5Lh3q_primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}.dshm_o5Lh3q_primaryButton:disabled{opacity:.4;cursor:not-allowed}.dshm_o5Lh3q_primaryButton:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}.dshm_o5Lh3q_secondaryButton{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:6px;justify-content:center;align-items:center;padding:0 14px;font-size:13px;font-weight:500;transition:background-color .15s,opacity .15s;display:inline-flex}.dshm_o5Lh3q_secondaryButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}.dshm_o5Lh3q_secondaryButton:disabled{opacity:.4;cursor:not-allowed}.dshm_o5Lh3q_secondaryButton:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}.dshm_o5Lh3q_testResult{border-radius:6px;flex-direction:column;gap:4px;padding:10px 12px;font-size:12px;line-height:18px;display:flex}.dshm_o5Lh3q_testResultHealthy{background:var(--dsw-alias-state-success-tertiary);border:1px solid var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}.dshm_o5Lh3q_testResultError{background:var(--dsw-alias-interactive-bg-hover-danger);border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}.dshm_o5Lh3q_testResultTesting{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}.dshm_o5Lh3q_testHeader{font-weight:600}.dshm_o5Lh3q_testDetails{font-family:var(--ds-font-family-code,monospace);color:var(--dsw-alias-label-secondary);font-size:11px}.dshm_o5Lh3q_operationToolbar{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.dshm_o5Lh3q_operationError{border-top:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;padding:8px 0;font-size:12px;line-height:18px}.dshm_o5Lh3q_operationResult{border-top:1px solid var(--dsw-alias-border-l3);flex-direction:column;gap:8px;min-width:0;padding-top:10px;display:flex}.dshm_o5Lh3q_resultTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}.dshm_o5Lh3q_metricHeaders,.dshm_o5Lh3q_metric{grid-template-columns:minmax(120px,1fr) minmax(80px,auto) minmax(54px,auto);align-items:baseline;gap:10px;display:grid}.dshm_o5Lh3q_metricHeaders{color:var(--dsw-alias-label-tertiary);padding-bottom:4px;font-size:11px;line-height:16px}.dshm_o5Lh3q_metrics{gap:6px;margin:0;display:grid}.dshm_o5Lh3q_metric dt,.dshm_o5Lh3q_metric dd{min-width:0;margin:0;font-size:12px;line-height:18px}.dshm_o5Lh3q_metric dt{color:var(--dsw-alias-label-secondary)}.dshm_o5Lh3q_metric dd{color:var(--dsw-alias-label-primary);text-align:right;font-variant-numeric:tabular-nums}.dshm_o5Lh3q_summaryLine{color:var(--dsw-alias-label-secondary);flex-wrap:wrap;gap:6px 16px;font-size:12px;line-height:18px;display:flex}.dshm_o5Lh3q_tableWrap{width:100%;max-width:100%;overflow-x:auto}.dshm_o5Lh3q_operationTable{border-collapse:collapse;table-layout:fixed;width:100%;min-width:520px;font-size:11px;line-height:16px}.dshm_o5Lh3q_operationTable th,.dshm_o5Lh3q_operationTable td{border-bottom:1px solid var(--dsw-alias-border-l3);text-align:left;color:var(--dsw-alias-label-secondary);padding:6px 8px}.dshm_o5Lh3q_operationTable th:first-child,.dshm_o5Lh3q_operationTable td:first-child{width:28px;padding-left:0}.dshm_o5Lh3q_operationTable th:nth-child(3),.dshm_o5Lh3q_operationTable td:nth-child(3){width:80px}.dshm_o5Lh3q_operationTable th:nth-child(4),.dshm_o5Lh3q_operationTable td:nth-child(4){width:150px}.dshm_o5Lh3q_operationTable code{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code,monospace);background:var(--dsw-alias-markdown-inline-code);border-radius:4px;padding:1px 4px;display:block;overflow:hidden}.dshm_o5Lh3q_dangerButton{box-sizing:border-box;border:1px solid var(--dsw-alias-state-error-primary);height:34px;color:var(--dsw-alias-state-error-primary);cursor:pointer;background:0 0;border-radius:6px;justify-content:center;align-items:center;padding:0 14px;font-size:13px;font-weight:500;transition:background-color .15s,opacity .15s;display:inline-flex}.dshm_o5Lh3q_dangerButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}.dshm_o5Lh3q_dangerButton:disabled{opacity:.4;cursor:not-allowed}.dshm_o5Lh3q_dangerButton:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-state-error-primary);outline:none}@media (width<=520px){.dshm_o5Lh3q_row{flex-wrap:nowrap}.dshm_o5Lh3q_row>.dshm_o5Lh3q_field{flex:none;width:100%}.dshm_o5Lh3q_operationToolbar>button{flex:150px}.dshm_o5Lh3q_metricHeaders,.dshm_o5Lh3q_metric{grid-template-columns:minmax(0,1fr) auto auto}}";
		const classMap = {
			"actionBar": "dshm_o5Lh3q_actionBar",
			"checkboxField": "dshm_o5Lh3q_checkboxField",
			"checkboxGroup": "dshm_o5Lh3q_checkboxGroup",
			"checkboxLabel": "dshm_o5Lh3q_checkboxLabel",
			"checkboxOption": "dshm_o5Lh3q_checkboxOption",
			"chip": "dshm_o5Lh3q_chip",
			"chipActive": "dshm_o5Lh3q_chipActive",
			"chipBadge": "dshm_o5Lh3q_chipBadge",
			"chipGroup": "dshm_o5Lh3q_chipGroup",
			"credentialInputRow": "dshm_o5Lh3q_credentialInputRow",
			"dangerButton": "dshm_o5Lh3q_dangerButton",
			"editorGroup": "dshm_o5Lh3q_editorGroup",
			"error": "dshm_o5Lh3q_error",
			"errorDismiss": "dshm_o5Lh3q_errorDismiss",
			"field": "dshm_o5Lh3q_field",
			"fieldHint": "dshm_o5Lh3q_fieldHint",
			"fieldLabel": "dshm_o5Lh3q_fieldLabel",
			"groupTitle": "dshm_o5Lh3q_groupTitle",
			"input": "dshm_o5Lh3q_input",
			"intro": "dshm_o5Lh3q_intro",
			"loading": "dshm_o5Lh3q_loading",
			"metric": "dshm_o5Lh3q_metric",
			"metricHeaders": "dshm_o5Lh3q_metricHeaders",
			"metrics": "dshm_o5Lh3q_metrics",
			"operationError": "dshm_o5Lh3q_operationError",
			"operationResult": "dshm_o5Lh3q_operationResult",
			"operationTable": "dshm_o5Lh3q_operationTable",
			"operationToolbar": "dshm_o5Lh3q_operationToolbar",
			"primaryButton": "dshm_o5Lh3q_primaryButton",
			"resultTitle": "dshm_o5Lh3q_resultTitle",
			"row": "dshm_o5Lh3q_row",
			"secondaryButton": "dshm_o5Lh3q_secondaryButton",
			"section": "dshm_o5Lh3q_section",
			"select": "dshm_o5Lh3q_select",
			"summaryLine": "dshm_o5Lh3q_summaryLine",
			"tableWrap": "dshm_o5Lh3q_tableWrap",
			"testDetails": "dshm_o5Lh3q_testDetails",
			"testHeader": "dshm_o5Lh3q_testHeader",
			"testResult": "dshm_o5Lh3q_testResult",
			"testResultError": "dshm_o5Lh3q_testResultError",
			"testResultHealthy": "dshm_o5Lh3q_testResultHealthy",
			"testResultTesting": "dshm_o5Lh3q_testResultTesting",
			"title": "dshm_o5Lh3q_title"
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
		function AreaMetric({ label, area }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: classMap.metric,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: label }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: formatBytes(area.byteUsage, area.byteUsageSaturated) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: area.logicalEntryCount })
				]
			});
		}
		function StorageOperations({ rpc, t }) {
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: classMap.editorGroup,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: classMap.groupTitle,
						children: t("section.operations")
					}),
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
									" ",
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
			const [testState, setTestState] = (0, react.useState)({ status: "idle" });
			const refresh = (0, react.useCallback)(async () => {
				setLoading(true);
				setError(void 0);
				try {
					const result = await callRpc(rpc, "mineru/config.get", {});
					if (result.ok) setDraft(result.value.config);
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
						setDraft(result.value.config);
						if (secret.length > 0) {
							if (reference === void 0) throw new TypeError(t("credential.referenceRequired"));
							await storeCredential(credentials, reference, secret);
							setApiKeyDraft("");
							setCredentialRevision((value) => value + 1);
						}
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
			const activeProvider = activeProviderDraft;
			const credentialStateReady = credentialState.status === "ready" && credentialState.ref === activeCredentialRef;
			const credentialView = credentialStateReady ? credentialState.view : void 0;
			const credentialLocked = credentialView?.writable === false;
			const credentialInputDisabled = saving || credentialBusy || activeCredentialRef === void 0 || !credentialStateReady || credentialLocked;
			const credentialPlaceholder = credentialView?.configured === true ? t("credential.placeholderStored") : t("credential.placeholderEmpty");
			const handleActiveTypeChange = (newType) => {
				const updated = switchProviderType(activeProvider, newType);
				setDraft((prev) => {
					if (prev === null) return prev;
					return normalizeProviderDefaults(patchActiveProvider(prev, updated), updated);
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
					if (current.length <= 1 || draft.defaults.model === model) return;
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
							disabled: saving || credentialBusy,
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
											return normalizeProviderDefaults({
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
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: classMap.fieldLabel,
											children: t("field.apiKeyEnv")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: classMap.input,
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.apiKey")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: classMap.credentialInputRow,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: classMap.input,
											type: "password",
											autoComplete: "off",
											"aria-label": t("field.apiKey"),
											value: apiKeyDraft,
											placeholder: credentialPlaceholder,
											disabled: credentialInputDisabled,
											onChange: (event) => setApiKeyDraft(event.target.value)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: classMap.secondaryButton,
											disabled: credentialInputDisabled || credentialView?.configured !== true,
											onClick: () => void clearStoredCredential(),
											children: credentialBusy ? t("action.clearingApiKey") : t("action.clearApiKey")
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldHint,
										children: credentialState.status === "loading" ? t("credential.loading") : credentialState.status === "error" ? credentialState.error : activeCredentialRef === void 0 ? t("credential.referenceRequired") : credentialLocked ? t("credential.readOnly") : credentialView?.configured === true ? [t("credential.configured"), credentialView.source ? ` (${credentialView.source})` : ""].join("") : t("credential.notConfigured")
									})
								]
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
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: classMap.field,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: classMap.fieldLabel,
											children: t("field.modelMap.pipeline")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: classMap.input,
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
											disabled: draft.defaults.model === m,
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
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
											className: classMap.select,
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
										readOnly: true,
										disabled: true,
										title: "Storage root changes require editing plugin configuration and restarting the plugin."
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StorageOperations, {
						rpc,
						t
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
							children: t("section.retry")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap.row,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.retryMaxAttempts")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										min: 1,
										max: 10,
										value: draft.retry.maxAttempts,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "retry", { maxAttempts: Number(e.target.value) }))
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.retryBaseDelayMs")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										min: 1,
										max: 6e4,
										value: draft.retry.baseDelayMs,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "retry", { baseDelayMs: Number(e.target.value) }))
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: classMap.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: classMap.fieldLabel,
										children: t("field.retryMaxDelayMs")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: classMap.input,
										type: "number",
										min: 1,
										max: 3e5,
										value: draft.retry.maxDelayMs,
										onChange: (e) => setDraft((prev) => prev === null ? prev : updateConfigSection(prev, "retry", { maxDelayMs: Number(e.target.value) }))
									})]
								})
							]
						})]
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
			"section.operations": "Storage Operations",
			"section.polling": "Polling & Timeouts",
			"section.retry": "Retry Policy",
			"section.output": "Output Limits",
			"section.limits": "Security & Payload Limits",
			"field.activeProvider": "Active Provider",
			"field.providerType": "Provider Type",
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
			"field.defaultArtifacts": "Default Required Artifacts",
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
			"field.activeProvider": "当前激活的 Provider",
			"field.providerType": "Provider 类型",
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
			"field.defaultArtifacts": "默认必要产物",
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
			if (ctx.slots.spec?.("settings.plugin.item") !== void 0) {
				ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
					name: "settings.plugin.item",
					key: NS,
					locale: NS,
					inject: injected
				}, SettingsPage));
				return;
			}
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