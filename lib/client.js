window.__ModuleLoader__.load({
	id: "dsh-pdf-mineru",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:/mnt/data/yurzi/Workspaces/dsh/dsh-pdf-mineru/src/client/SettingsPage.module.css.mjs
		const css = ".dshm_61pybv_section {\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n  max-width: 800px;\n  color: var(--dsw-alias-label-primary);\n  padding-bottom: 32px;\n}\n\n.dshm_61pybv_title {\n  margin: 0;\n  font-size: 18px;\n  line-height: 26px;\n  font-weight: 600;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshm_61pybv_intro {\n  margin: 0;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshm_61pybv_error {\n  margin: 0;\n  padding: 8px 12px;\n  border: 1px solid var(--dsw-alias-state-error-primary);\n  border-radius: 6px;\n  background: var(--dsw-alias-interactive-bg-hover-danger);\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-state-error-primary);\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.dshm_61pybv_errorDismiss {\n  flex: none;\n  border: none;\n  background: transparent;\n  color: inherit;\n  font-size: 16px;\n  line-height: 1;\n  cursor: pointer;\n  padding: 0 4px;\n}\n\n.dshm_61pybv_loading {\n  font-size: 14px;\n  line-height: 22px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshm_61pybv_editorGroup {\n  border: 0;\n  border-top: 1px solid var(--dsw-alias-border-l2);\n  padding: 16px 0 0;\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  background: transparent;\n}\n\n.dshm_61pybv_groupTitle {\n  margin: 0 0 4px 0;\n  font-size: 14px;\n  line-height: 20px;\n  font-weight: 600;\n  color: var(--dsw-alias-label-primary);\n  border-bottom: 1px solid var(--dsw-alias-border-l3);\n  padding-bottom: 6px;\n}\n\n.dshm_61pybv_row {\n  display: flex;\n  gap: 12px;\n  flex-wrap: wrap;\n}\n\n.dshm_61pybv_row > .dshm_61pybv_field {\n  flex: 1 1 220px;\n}\n\n.dshm_61pybv_field {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.dshm_61pybv_checkboxField {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  cursor: pointer;\n  user-select: none;\n}\n\n.dshm_61pybv_fieldLabel {\n  font-size: 12px;\n  line-height: 18px;\n  font-weight: 500;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dshm_61pybv_checkboxLabel {\n  font-size: 13px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshm_61pybv_input,\n.dshm_61pybv_select {\n  box-sizing: border-box;\n  height: 32px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 0 10px;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-layer-1);\n  outline: none;\n}\n\n.dshm_61pybv_input:focus,\n.dshm_61pybv_select:focus {\n  border-color: var(--dsw-alias-brand-primary);\n}\n\n.dshm_61pybv_input::placeholder {\n  color: var(--dsw-alias-label-dimmed);\n}\n\n.dshm_61pybv_input:disabled,\n.dshm_61pybv_select:disabled {\n  opacity: 0.6;\n  cursor: default;\n}\n\n.dshm_61pybv_checkboxGroup {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 12px;\n  margin-top: 4px;\n}\n\n.dshm_61pybv_checkboxOption {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 12px;\n  color: var(--dsw-alias-label-primary);\n  cursor: pointer;\n}\n\n.dshm_61pybv_checkboxField input[type=\"checkbox\"],\n.dshm_61pybv_checkboxOption input[type=\"checkbox\"] {\n  cursor: pointer;\n  accent-color: var(--dsw-alias-state-business-primary);\n}\n\n.dshm_61pybv_actionBar {\n  display: flex;\n  align-items: center;\n  justify-content: flex-start;\n  gap: 12px;\n  padding-top: 8px;\n}\n\n.dshm_61pybv_primaryButton {\n  box-sizing: border-box;\n  height: 34px;\n  padding: 0 16px;\n  border: none;\n  border-radius: 6px;\n  background: var(--dsw-alias-button-primary-fill);\n  color: var(--dsw-alias-label-primary-foreground);\n  font-size: 13px;\n  font-weight: 500;\n  cursor: pointer;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  transition: background-color 0.15s ease, opacity 0.15s ease;\n}\n\n.dshm_61pybv_primaryButton:hover:not(:disabled) {\n  background: var(--dsw-alias-button-primary-hover);\n}\n\n.dshm_61pybv_primaryButton:disabled {\n  opacity: 0.4;\n  cursor: not-allowed;\n}\n\n.dshm_61pybv_primaryButton:focus-visible {\n  box-shadow: 0 0 0 2px var(--dsw-alias-border-l3);\n  outline: none;\n}\n\n.dshm_61pybv_secondaryButton {\n  box-sizing: border-box;\n  height: 34px;\n  padding: 0 14px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  background: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-primary);\n  font-size: 13px;\n  font-weight: 500;\n  cursor: pointer;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  transition: background-color 0.15s ease, opacity 0.15s ease;\n}\n\n.dshm_61pybv_secondaryButton:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover-solid);\n}\n\n.dshm_61pybv_secondaryButton:disabled {\n  opacity: 0.4;\n  cursor: not-allowed;\n}\n\n.dshm_61pybv_secondaryButton:focus-visible {\n  box-shadow: 0 0 0 2px var(--dsw-alias-border-l3);\n  outline: none;\n}\n\n.dshm_61pybv_testResult {\n  padding: 10px 12px;\n  border-radius: 6px;\n  font-size: 12px;\n  line-height: 18px;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.dshm_61pybv_testResultHealthy {\n  background: var(--dsw-alias-state-success-tertiary);\n  border: 1px solid var(--dsw-alias-state-success-primary);\n  color: var(--dsw-alias-state-success-primary);\n}\n\n.dshm_61pybv_testResultError {\n  background: var(--dsw-alias-interactive-bg-hover-danger);\n  border: 1px solid var(--dsw-alias-state-error-primary);\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dshm_61pybv_testResultTesting {\n  background: var(--dsw-alias-bg-layer-2);\n  border: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dshm_61pybv_testHeader {\n  font-weight: 600;\n}\n\n.dshm_61pybv_testDetails {\n  font-family: var(--ds-font-family-code, monospace);\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dshm_61pybv_operationToolbar {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n  align-items: center;\n}\n\n.dshm_61pybv_operationError {\n  padding: 8px 0;\n  border-top: 1px solid var(--dsw-alias-state-error-primary);\n  color: var(--dsw-alias-state-error-primary);\n  font-size: 12px;\n  line-height: 18px;\n  overflow-wrap: anywhere;\n}\n\n.dshm_61pybv_operationResult {\n  border-top: 1px solid var(--dsw-alias-border-l3);\n  padding-top: 10px;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  min-width: 0;\n}\n\n.dshm_61pybv_resultTitle {\n  font-size: 13px;\n  line-height: 20px;\n  font-weight: 600;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshm_61pybv_metricHeaders,\n.dshm_61pybv_metric {\n  display: grid;\n  grid-template-columns: minmax(120px, 1fr) minmax(80px, auto) minmax(54px, auto);\n  gap: 10px;\n  align-items: baseline;\n}\n\n.dshm_61pybv_metricHeaders {\n  padding-bottom: 4px;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n  line-height: 16px;\n}\n\n.dshm_61pybv_metrics {\n  display: grid;\n  gap: 6px;\n  margin: 0;\n}\n\n.dshm_61pybv_metric dt,\n.dshm_61pybv_metric dd {\n  margin: 0;\n  min-width: 0;\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dshm_61pybv_metric dt {\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dshm_61pybv_metric dd {\n  color: var(--dsw-alias-label-primary);\n  text-align: right;\n  font-variant-numeric: tabular-nums;\n}\n\n.dshm_61pybv_summaryLine {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px 16px;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dshm_61pybv_tableWrap {\n  width: 100%;\n  max-width: 100%;\n  overflow-x: auto;\n}\n\n.dshm_61pybv_operationTable {\n  width: 100%;\n  min-width: 520px;\n  border-collapse: collapse;\n  table-layout: fixed;\n  font-size: 11px;\n  line-height: 16px;\n}\n\n.dshm_61pybv_operationTable th,\n.dshm_61pybv_operationTable td {\n  padding: 6px 8px;\n  border-bottom: 1px solid var(--dsw-alias-border-l3);\n  text-align: left;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dshm_61pybv_operationTable th:first-child,\n.dshm_61pybv_operationTable td:first-child {\n  width: 28px;\n  padding-left: 0;\n}\n\n.dshm_61pybv_operationTable th:nth-child(3),\n.dshm_61pybv_operationTable td:nth-child(3) {\n  width: 80px;\n}\n\n.dshm_61pybv_operationTable th:nth-child(4),\n.dshm_61pybv_operationTable td:nth-child(4) {\n  width: 150px;\n}\n\n.dshm_61pybv_operationTable code {\n  display: block;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  color: var(--dsw-alias-label-primary);\n  font-family: var(--ds-font-family-code, monospace);\n  background: var(--dsw-alias-markdown-inline-code);\n  border-radius: 4px;\n  padding: 1px 4px;\n}\n\n.dshm_61pybv_dangerButton {\n  box-sizing: border-box;\n  height: 34px;\n  padding: 0 14px;\n  border: 1px solid var(--dsw-alias-state-error-primary);\n  border-radius: 6px;\n  background: transparent;\n  color: var(--dsw-alias-state-error-primary);\n  font-size: 13px;\n  font-weight: 500;\n  cursor: pointer;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  transition: background-color 0.15s ease, opacity 0.15s ease;\n}\n\n.dshm_61pybv_dangerButton:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover-danger);\n}\n\n.dshm_61pybv_dangerButton:disabled {\n  opacity: 0.4;\n  cursor: not-allowed;\n}\n\n.dshm_61pybv_dangerButton:focus-visible {\n  box-shadow: 0 0 0 2px var(--dsw-alias-state-error-primary);\n  outline: none;\n}\n\n@media (max-width: 520px) {\n  .dshm_61pybv_row {\n    flex-wrap: nowrap;\n  }\n\n  .dshm_61pybv_row > .dshm_61pybv_field {\n    flex: 0 0 auto;\n    width: 100%;\n  }\n\n  .dshm_61pybv_operationToolbar > button {\n    flex: 1 1 150px;\n  }\n\n  .dshm_61pybv_metricHeaders,\n  .dshm_61pybv_metric {\n    grid-template-columns: minmax(0, 1fr) auto auto;\n  }\n}\n";
		const classMap = {
			"section": "dshm_61pybv_section",
			"title": "dshm_61pybv_title",
			"intro": "dshm_61pybv_intro",
			"error": "dshm_61pybv_error",
			"errorDismiss": "dshm_61pybv_errorDismiss",
			"loading": "dshm_61pybv_loading",
			"editorGroup": "dshm_61pybv_editorGroup",
			"groupTitle": "dshm_61pybv_groupTitle",
			"row": "dshm_61pybv_row",
			"field": "dshm_61pybv_field",
			"checkboxField": "dshm_61pybv_checkboxField",
			"fieldLabel": "dshm_61pybv_fieldLabel",
			"checkboxLabel": "dshm_61pybv_checkboxLabel",
			"input": "dshm_61pybv_input",
			"select": "dshm_61pybv_select",
			"checkboxGroup": "dshm_61pybv_checkboxGroup",
			"checkboxOption": "dshm_61pybv_checkboxOption",
			"actionBar": "dshm_61pybv_actionBar",
			"primaryButton": "dshm_61pybv_primaryButton",
			"secondaryButton": "dshm_61pybv_secondaryButton",
			"testResult": "dshm_61pybv_testResult",
			"testResultHealthy": "dshm_61pybv_testResultHealthy",
			"testResultError": "dshm_61pybv_testResultError",
			"testResultTesting": "dshm_61pybv_testResultTesting",
			"testHeader": "dshm_61pybv_testHeader",
			"testDetails": "dshm_61pybv_testDetails",
			"operationToolbar": "dshm_61pybv_operationToolbar",
			"operationError": "dshm_61pybv_operationError",
			"operationResult": "dshm_61pybv_operationResult",
			"resultTitle": "dshm_61pybv_resultTitle",
			"metricHeaders": "dshm_61pybv_metricHeaders",
			"metric": "dshm_61pybv_metric",
			"metrics": "dshm_61pybv_metrics",
			"summaryLine": "dshm_61pybv_summaryLine",
			"tableWrap": "dshm_61pybv_tableWrap",
			"operationTable": "dshm_61pybv_operationTable",
			"dangerButton": "dshm_61pybv_dangerButton"
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
			const run = async (action, endpoint, payload, apply) => {
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
				setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
				setConfirmingDelete(false);
			};
			const toggleAll = () => {
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
										label: t("ops.jobs"),
										area: state.stats.persistedJobs
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
		function SettingsPage({ rpc, t }) {
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
			const save = (0, react.useCallback)(async () => {
				if (draft === null) return;
				setSaving(true);
				setError(void 0);
				setSaved(false);
				try {
					const result = await callRpc(rpc, "mineru/config.set", { config: draft });
					if (result.ok) {
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
			"action.storageStats": "Refresh Statistics",
			"action.integrityScan": "Verify Cache",
			"action.gcPreview": "Preview GC",
			"action.quarantineList": "List Quarantine",
			"action.cleanupPreview": "Preview Cleanup",
			"action.cleanupDelete": "Delete Selected",
			"action.cleanupConfirm": "Confirm Delete",
			"action.running": "Running…",
			"ops.bytes": "Bytes",
			"ops.entries": "Entries",
			"ops.results": "Published Results",
			"ops.jobs": "Persisted Jobs",
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
			"ops.selectAll": "Select all quarantine entries",
			"ops.modified": "Modified",
			"ops.cleanupPlanned": "Planned",
			"ops.cleanupDeleted": "Deleted",
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
			"section.operations": "存储运维",
			"section.polling": "轮询与超时控制",
			"section.retry": "网络重试策略",
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
			"action.storageStats": "刷新统计",
			"action.integrityScan": "校验缓存",
			"action.gcPreview": "预览 GC",
			"action.quarantineList": "查看隔离区",
			"action.cleanupPreview": "预览清理",
			"action.cleanupDelete": "删除已选项",
			"action.cleanupConfirm": "确认删除",
			"action.running": "执行中…",
			"ops.bytes": "字节数",
			"ops.entries": "条目数",
			"ops.results": "已发布结果",
			"ops.jobs": "持久化 Job",
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
			"ops.selectAll": "选择全部隔离条目",
			"ops.modified": "修改时间",
			"ops.cleanupPlanned": "计划清理",
			"ops.cleanupDeleted": "已删除",
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
		/**
		* BetterLocale does not inherit the base locale service's English fallback.
		* Reuse one canonical English dictionary instead of maintaining sixteen
		* byte-for-byte copies that falsely appear to be translations.
		*/
		const dicts = Object.fromEntries([
			"ja",
			"de",
			"fr",
			"pt",
			"ko",
			"ar",
			"hi",
			"id",
			"tr",
			"vi",
			"th",
			"ru",
			"it",
			"nl",
			"sv",
			"pl"
		].map((locale) => [locale, en]));
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