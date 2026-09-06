export interface Task {
  id: string;
  title: string;
  description: string;
  dod: string;
  module: string | null;
  tags: string[];
  assigneeMemberId: string | null;
  status: string;
  blockedFrom: string | null;
  conflictWith: string[];
  createdAt: string;
  updatedAt: string;
  deps?: { taskId: string; dependsOnTaskId: string; kind: string }[];
}

function headers(): Record<string, string> {
  const token = localStorage.getItem("st_token") ?? "";
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const data = (await r.json()) as { error?: { message?: string } };
  if (!r.ok) throw new Error(data?.error?.message ?? `HTTP ${r.status}`);
  return data as T;
}

export const api = {
  bootstrapMember: (name: string, role: string) =>
    req<{ member: { id: string; name: string; role: string }; token: string }>("POST", "/api/v1/members", { name, role }),
  listTasks: () => req<Task[]>("GET", "/api/v1/tasks"),
  createTask: (input: { title: string; dod: string; description?: string; module?: string; tags?: string[] }) =>
    req<Task>("POST", "/api/v1/tasks", input),
  transition: (id: string, action: string) =>
    req<Task>("POST", `/api/v1/tasks/${id}/transition`, { action }),
  taskDetail: (id: string) => req<Task>("GET", `/api/v1/tasks/${id}`),
  setDeps: (id: string, deps: { dependsOnTaskId: string; kind?: string }[]) =>
    req<unknown>("PUT", `/api/v1/tasks/${id}/deps`, { deps }),
  listSessions: () =>
    req<{ id: string; memberId: string; adapter: string; taskId: string | null; status: string; branch: string | null; diffSummary: string | null }[]>("GET", "/api/v1/sessions"),
  searchArtifacts: (q: { text?: string; type?: string; tags?: string }) =>
    req<{ path: string; title: string; tags: string[]; snippet: string }[]>(
      "GET",
      `/api/v1/artifacts?${new URLSearchParams(Object.entries(q).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString()}`,
    ),
  readArtifact: (path: string) =>
    req<{ html: string; toc: { level: number; text: string; slug: string }[]; meta: { path: string; title: string; type: string; tags: string[]; owner: string | null; status: string; expiresAt: string | null; typeMismatch: boolean } }>(
      "GET",
      `/api/v1/artifacts/${path}`,
    ),
  artifactHistory: () =>
    req<{ sha: string; date: string; message: string; paths: string[] }[]>("GET", "/api/v1/artifacts/history"),
  digest: (hours = 24) => req<{ markdown: string }>("GET", `/api/v1/digest?hours=${hours}`),
};
