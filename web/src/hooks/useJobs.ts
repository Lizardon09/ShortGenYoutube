import { useCallback, useEffect, useRef, useState } from "react";
import type { GitHub } from "../api/github";
import { JOBS_KEY, load, save } from "../lib/storage";
import type { Job } from "../types";

const POLL_MS = 5000;
const RUN_LOOKUP_TIMEOUT_MS = 3 * 60 * 1000;

// Checks one job against GitHub and returns the fields that changed.
async function pollJob(client: GitHub, job: Job): Promise<Partial<Job>> {
  const patch: Partial<Job> = {};
  let runId = job.runId;
  if (!runId) {
    const run = await client.findRun(job.kind, job.id);
    if (!run) {
      if (Date.now() - job.created > RUN_LOOKUP_TIMEOUT_MS) {
        return {
          status: "completed",
          conclusion: "failure",
          finished: Date.now(),
          error: "GitHub never started the workflow. Check the repo's Actions tab.",
        };
      }
      return patch;
    }
    runId = patch.runId = run.id;
    patch.runUrl = run.html_url;
  }

  const runJob = await client.firstJob(runId);
  if (!runJob) return patch;
  const current = runJob.steps?.find((s) => s.status === "in_progress");
  patch.step = current ? current.name : runJob.status === "queued" ? "Waiting for a GitHub runner…" : job.step;

  if (runJob.status !== "completed") return { ...patch, status: runJob.status };
  if (runJob.conclusion !== "success") {
    return {
      ...patch,
      status: "completed",
      conclusion: runJob.conclusion ?? "failure",
      finished: Date.now(),
      error: await client.failureReason(runJob),
    };
  }
  if (job.kind === "short") {
    const asset = await client.shortAsset(job.id);
    if (!asset) return patch; // upload not visible yet; check again next tick
    patch.download = asset.browser_download_url;
    patch.size = asset.size;
  }
  return { ...patch, status: "completed", conclusion: "success", finished: Date.now(), step: "" };
}

export function jobState(job: Job): "running" | "success" | "failure" {
  if (job.status !== "completed") return "running";
  return job.conclusion === "success" ? "success" : "failure";
}

/** Jobs started from this browser, saved across visits and polled while running. */
export function useJobs(client: GitHub | null, onAnalysisReady: (id: string) => void) {
  const [jobs, setJobs] = useState<Job[]>(() => load<Job[]>(JOBS_KEY, []));
  const [, setTick] = useState(0); // re-render every poll so elapsed times stay fresh
  const jobsRef = useRef(jobs);
  const onReadyRef = useRef(onAnalysisReady);
  jobsRef.current = jobs;
  onReadyRef.current = onAnalysisReady;

  useEffect(() => save(JOBS_KEY, jobs.slice(0, 30)), [jobs]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let timer: number | undefined;
    const loop = async () => {
      for (const job of jobsRef.current.filter((j) => j.status !== "completed")) {
        let patch: Partial<Job>;
        try {
          patch = { ...(await pollJob(client, job)), warning: "" };
        } catch (err) {
          patch = { warning: (err as Error).message }; // transient hiccup: keep polling
        }
        if (cancelled) return;
        const readyToOpen = job.kind === "analyze" && job.openWhenDone && patch.conclusion === "success";
        if (readyToOpen) patch.openWhenDone = false;
        setJobs((all) => all.map((j) => (j.id === job.id ? { ...j, ...patch } : j)));
        if (readyToOpen) onReadyRef.current(job.id);
      }
      setTick((t) => t + 1);
      timer = window.setTimeout(loop, POLL_MS);
    };
    loop();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [client]);

  const addJob = useCallback((fields: Pick<Job, "id" | "kind" | "label"> & Partial<Job>) => {
    setJobs((all) => [{ created: Date.now(), status: "queued", step: "Starting the workflow…", ...fields }, ...all]);
  }, []);

  const updateJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((all) => all.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const removeJob = useCallback((id: string) => {
    setJobs((all) => all.filter((j) => j.id !== id));
  }, []);

  return { jobs, addJob, updateJob, removeJob };
}
