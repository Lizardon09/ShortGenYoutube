// Talks to this repo's GitHub Actions workflows through the GitHub REST API.
//
//   Find moments -> analyze.yml    -> results branch: analyses/<id>/moments.json
//   Make short   -> make-short.yml -> "shorts" release asset: <id>.mp4
//
// Each request gets a unique id baked into the workflow run's name, which is
// how the page finds the run it started.
import type { Analysis, JobKind, Settings } from "../types";

const API = "https://api.github.com";

export const WORKFLOWS: Record<JobKind, { file: string; runPrefix: string }> = {
  analyze: { file: "analyze.yml", runPrefix: "analyze" },
  short: { file: "make-short.yml", runPrefix: "short" },
};

export class GitHubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface RunStep {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface RunJob {
  status: string;
  conclusion: string | null;
  steps?: RunStep[];
  check_run_url: string;
}

interface Run {
  id: number;
  display_title: string;
  html_url: string;
}

interface Asset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface RepoInfo {
  full_name: string;
  default_branch: string;
  private: boolean;
}

export const isConfigured = (s: Settings) => Boolean(s.owner && s.repo && s.token);

export class GitHub {
  private settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  private get repoPath() {
    return `/repos/${this.settings.owner}/${this.settings.repo}`;
  }

  async request<T>(path: string, { method = "GET", body, raw = false }: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<T> {
    const res = await fetch(path.startsWith("http") ? path : API + path, {
      method,
      cache: "no-store",
      headers: {
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        Authorization: `Bearer ${this.settings.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = (await res.json()).message || message;
      } catch {
        // non-JSON error body
      }
      throw new GitHubError(`GitHub said ${res.status}: ${message}`, res.status);
    }
    if (res.status === 204) return null as T;
    return (raw ? res.text() : res.json()) as Promise<T>;
  }

  repo() {
    return this.request<RepoInfo>(this.repoPath);
  }

  async hasWorkflows() {
    try {
      await this.request(`${this.repoPath}/actions/workflows/${WORKFLOWS.analyze.file}`);
      return true;
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return false;
      throw err;
    }
  }

  dispatch(kind: JobKind, inputs: Record<string, string>) {
    return this.request<null>(`${this.repoPath}/actions/workflows/${WORKFLOWS[kind].file}/dispatches`, {
      method: "POST",
      body: { ref: this.settings.branch || "main", inputs },
    });
  }

  async findRun(kind: JobKind, id: string) {
    const wf = WORKFLOWS[kind];
    const data = await this.request<{ workflow_runs: Run[] }>(
      `${this.repoPath}/actions/workflows/${wf.file}/runs?event=workflow_dispatch&per_page=30`,
    );
    return data.workflow_runs.find((r) => r.display_title === `${wf.runPrefix} ${id}`) ?? null;
  }

  async firstJob(runId: number) {
    const data = await this.request<{ jobs: RunJob[] }>(`${this.repoPath}/actions/runs/${runId}/jobs`);
    return data.jobs[0] ?? null;
  }

  // Why a run failed: the failed step, plus any ::error:: lines the scripts printed.
  async failureReason(job: RunJob) {
    const failed = job.steps?.find((s) => s.conclusion === "failure");
    let reason = failed ? `Failed at "${failed.name}".` : `Run ${job.conclusion}.`;
    try {
      const notes = await this.request<{ annotation_level: string; message: string }[]>(`${job.check_run_url}/annotations`);
      const messages = notes
        .filter((a) => a.annotation_level === "failure" && !/exit code \d+/.test(a.message))
        .map((a) => a.message);
      if (messages.length) reason += " " + messages.join(" ");
    } catch {
      // annotations are a nice-to-have
    }
    return reason;
  }

  async shortAsset(id: string) {
    const release = await this.request<{ assets: Asset[] }>(`${this.repoPath}/releases/tags/shorts`);
    return release.assets.find((a) => a.name === `${id}.mp4`) ?? null;
  }

  async analysis(id: string) {
    const text = await this.request<string>(`${this.repoPath}/contents/analyses/${id}/moments.json?ref=results`, { raw: true });
    return JSON.parse(text) as Analysis;
  }

  // Newest first. Empty if nothing has been analyzed yet (no results branch).
  async analysisIds() {
    try {
      const items = await this.request<{ type: string; name: string }[]>(`${this.repoPath}/contents/analyses?ref=results`);
      return items.filter((i) => i.type === "dir").map((i) => i.name).sort().reverse();
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return [];
      throw err;
    }
  }
}
