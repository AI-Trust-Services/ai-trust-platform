/**
 * DEV/THROWAWAY — Hierarchy Solver tester.
 * Route: /systems/:id/hierarchy-test
 * Lets you run the questionnaire + classification pipeline and then try
 * override combinations (riskWinner / labels / answers) side by side.
 */
import { useState } from "react";
import { useParams } from "react-router";
import { api } from "../api/client";
import type { LabelOverrides, ResolveResponse, ResolvedLabel } from "../types";

const RISK_LABELS = ["PROHIBITED", "HIGH_RISK", "TRANSPARENCY"] as const;
const ROLE_LABELS = ["PROVIDER", "DEPLOYER", "IMPORTER", "AUTHORISED_REPRESENTATIVE"] as const;
const ALL_LABELS = [...RISK_LABELS, ...ROLE_LABELS] as const;
type LabelId = (typeof ALL_LABELS)[number];

type Tristate = "unset" | "true" | "false";

function bandColor(band: string | null) {
  if (band === "High") return "text-green-700 font-semibold";
  if (band === "Medium") return "text-yellow-700 font-semibold";
  if (band === "Low") return "text-red-700 font-semibold";
  return "text-gray-400";
}

function ResultTable({ resp }: { resp: ResolveResponse }) {
  const rows: ResolvedLabel[] = [resp.risk, ...resp.roles];
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="bg-gray-100">
          <th className="border px-2 py-1 text-left">Label</th>
          <th className="border px-2 py-1">Result</th>
          <th className="border px-2 py-1">Source</th>
          <th className="border px-2 py-1">Conf</th>
          <th className="border px-2 py-1">Band</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.labelId} className={r.result ? "bg-blue-50" : ""}>
            <td className="border px-2 py-1 font-mono">{r.labelId}</td>
            <td className="border px-2 py-1 text-center">{r.result ? "✓" : "✗"}</td>
            <td className="border px-2 py-1 text-center">{r.source}</td>
            <td className="border px-2 py-1 text-center">
              {r.confidence != null ? r.confidence.toFixed(1) : "—"}
            </td>
            <td className={`border px-2 py-1 text-center ${bandColor(r.confidenceBand)}`}>
              {r.confidenceBand ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Column({ title, resp, error }: { title: string; resp: ResolveResponse | null; error: string | null }) {
  return (
    <div className="flex-1 min-w-0">
      <h3 className="font-semibold mb-2">{title}</h3>
      {error && <div className="bg-red-100 text-red-800 p-2 rounded text-xs mb-2">{error}</div>}
      {resp && (
        <>
          <ResultTable resp={resp} />
          <pre className="mt-2 text-xs bg-gray-50 border rounded p-2 overflow-auto max-h-64">
            {JSON.stringify(resp, null, 2)}
          </pre>
        </>
      )}
      {!resp && !error && <p className="text-gray-400 text-xs">No result yet</p>}
    </div>
  );
}

export default function HierarchySolverTester() {
  const { id } = useParams<{ id: string }>();
  const systemId = id!;

  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const [baseline, setBaseline] = useState<ResolveResponse | null>(null);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [baselineBusy, setBaselineBusy] = useState(false);

  const [overridden, setOverridden] = useState<ResolveResponse | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideBusy, setOverrideBusy] = useState(false);

  // Override state
  const [riskWinner, setRiskWinner] = useState<string>("");
  const [labelStates, setLabelStates] = useState<Record<LabelId, Tristate>>(
    () => Object.fromEntries(ALL_LABELS.map((l) => [l, "unset"])) as Record<LabelId, Tristate>,
  );
  // answers: list of {qid, values} rows
  const [answerRows, setAnswerRows] = useState<Array<{ qid: string; values: string }>>([]);

  function buildOverrides(): LabelOverrides {
    const overrides: LabelOverrides = {};
    if (riskWinner) overrides.riskWinner = riskWinner;

    const labels: Record<string, boolean> = {};
    for (const [lid, state] of Object.entries(labelStates)) {
      if (state !== "unset") labels[lid] = state === "true";
    }
    if (Object.keys(labels).length) overrides.labels = labels;

    const answers: Record<string, string[]> = {};
    for (const row of answerRows) {
      if (row.qid.trim()) {
        answers[row.qid.trim()] = row.values
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
      }
    }
    if (Object.keys(answers).length) overrides.answers = answers;

    return overrides;
  }

  async function runPipeline() {
    setPipelineBusy(true);
    setPipelineError(null);
    setPipelineStatus("Running questionnaire…");
    try {
      const qResult = await api.runQuestionnaire(systemId);
      setPipelineStatus("Running classification…");
      await api.runClassification(systemId, qResult.run_key);
      setPipelineStatus("Pipeline done ✓");
    } catch (e) {
      setPipelineError(String(e));
      setPipelineStatus(null);
    } finally {
      setPipelineBusy(false);
    }
  }

  async function resolveBaseline() {
    setBaselineBusy(true);
    setBaselineError(null);
    try {
      setBaseline(await api.resolveClassification(systemId, {}));
    } catch (e) {
      setBaselineError(String(e));
    } finally {
      setBaselineBusy(false);
    }
  }

  async function resolveWithOverrides() {
    setOverrideBusy(true);
    setOverrideError(null);
    try {
      setOverridden(await api.resolveClassification(systemId, buildOverrides()));
    } catch (e) {
      setOverrideError(String(e));
    } finally {
      setOverrideBusy(false);
    }
  }

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <h1 className="text-lg font-bold mb-1">Hierarchy Solver Tester</h1>
      <p className="text-xs text-gray-500 mb-4">
        System: <span className="font-mono">{systemId}</span> — DEV ONLY, throwaway tool
      </p>

      {/* Pipeline trigger */}
      <section className="mb-4 p-3 border rounded bg-gray-50">
        <h2 className="font-semibold text-sm mb-2">1. Run pipeline (questionnaire → classification)</h2>
        <button
          onClick={runPipeline}
          disabled={pipelineBusy}
          className="px-3 py-1 bg-gray-800 text-white text-sm rounded disabled:opacity-50"
        >
          {pipelineBusy ? "Running…" : "Run pipeline"}
        </button>
        {pipelineStatus && <span className="ml-3 text-xs text-gray-600">{pipelineStatus}</span>}
        {pipelineError && <div className="mt-2 text-xs text-red-700 bg-red-50 p-2 rounded">{pipelineError}</div>}
      </section>

      {/* Baseline */}
      <section className="mb-4 p-3 border rounded bg-gray-50">
        <h2 className="font-semibold text-sm mb-2">2. Resolve baseline (no overrides)</h2>
        <button
          onClick={resolveBaseline}
          disabled={baselineBusy}
          className="px-3 py-1 bg-blue-700 text-white text-sm rounded disabled:opacity-50"
        >
          {baselineBusy ? "Resolving…" : "Resolve baseline"}
        </button>
      </section>

      {/* Override controls */}
      <section className="mb-4 p-3 border rounded bg-gray-50">
        <h2 className="font-semibold text-sm mb-2">3. Set overrides</h2>

        {/* riskWinner */}
        <div className="mb-3">
          <label className="text-xs font-medium block mb-1">riskWinner</label>
          <select
            value={riskWinner}
            onChange={(e) => setRiskWinner(e.target.value)}
            className="text-xs border rounded px-2 py-1"
          >
            <option value="">(not set)</option>
            {RISK_LABELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>

        {/* per-label tristate */}
        <div className="mb-3">
          <label className="text-xs font-medium block mb-1">labels</label>
          <div className="grid grid-cols-2 gap-1">
            {ALL_LABELS.map((lid) => (
              <div key={lid} className="flex items-center gap-2 text-xs">
                <span className="font-mono w-48">{lid}</span>
                <select
                  value={labelStates[lid]}
                  onChange={(e) =>
                    setLabelStates((s) => ({ ...s, [lid]: e.target.value as Tristate }))
                  }
                  className="border rounded px-1 py-0.5 text-xs"
                >
                  <option value="unset">unset</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* answers override rows */}
        <div className="mb-3">
          <label className="text-xs font-medium block mb-1">
            answers (questionId → comma-separated values)
          </label>
          {answerRows.map((row, i) => (
            <div key={i} className="flex gap-2 mb-1">
              <input
                value={row.qid}
                onChange={(e) =>
                  setAnswerRows((rows) => rows.map((r, j) => j === i ? { ...r, qid: e.target.value } : r))
                }
                placeholder="questionId"
                className="border rounded px-2 py-0.5 text-xs font-mono w-56"
              />
              <input
                value={row.values}
                onChange={(e) =>
                  setAnswerRows((rows) => rows.map((r, j) => j === i ? { ...r, values: e.target.value } : r))
                }
                placeholder="val1, val2"
                className="border rounded px-2 py-0.5 text-xs flex-1"
              />
              <button
                onClick={() => setAnswerRows((rows) => rows.filter((_, j) => j !== i))}
                className="text-xs text-red-600 px-1"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() => setAnswerRows((rows) => [...rows, { qid: "", values: "" }])}
            className="text-xs text-blue-700 underline"
          >
            + add row
          </button>
        </div>

        <button
          onClick={resolveWithOverrides}
          disabled={overrideBusy}
          className="px-3 py-1 bg-blue-700 text-white text-sm rounded disabled:opacity-50"
        >
          {overrideBusy ? "Resolving…" : "Resolve with overrides"}
        </button>
      </section>

      {/* Side-by-side results */}
      <section className="flex gap-4">
        <Column title="Baseline" resp={baseline} error={baselineError} />
        <Column title="With overrides" resp={overridden} error={overrideError} />
      </section>
    </div>
  );
}
