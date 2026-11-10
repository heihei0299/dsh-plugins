/**
 * Authenticated HTTP API for the MCP & Skill panel.
 *
 * Routes are registered through Connection's exact fetch registry, which sits
 * below the Host/Origin fence and the browser Owner admission check. The
 * handlers therefore never accept a caller identity from the request body.
 *
 * @module @local/dsh-mcp-skill-manager/host/api
 */

import { statSync } from 'node:fs';
import {
  API_CONFIG_PATH,
  API_SKILLS_PATH,
  API_STATE_PATH,
  CONFIG_BODY_LIMIT,
  isRecord
} from '../shared/contract.js';
import {
  discoverServers,
  discoverSkills,
  liveAgentList,
  service,
  workspaceSuggestions
} from './discovery.js';
import { PolicyError, normalizePath, projectForCwd } from './policy.js';

/** Response failure with a stable status and code. */
class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/** Build one JSON response with the policy API's fixed headers. */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff'
    }
  });
}

/** Build one JSON failure response. */
function failure(status, code, message) {
  return json({ error: { code, message } }, status);
}

/** Read and validate one JSON request body. */
async function readJson(request, limit) {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'unsupported-media-type', 'Content-Type must be application/json');
  }
  const declared = Number(request.headers.get('content-length') ?? 'NaN');
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, 'payload-too-large', `Request body exceeds ${limit} bytes`);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > limit) {
    throw new HttpError(413, 'payload-too-large', `Request body exceeds ${limit} bytes`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid-json', 'Request body is not valid JSON');
  }
  if (!isRecord(body)) throw new HttpError(400, 'invalid-body', 'Request body must be a JSON object');
  return body;
}

/** Report whether one configured path currently resolves to a directory. */
function pathState(projectPath) {
  try {
    const info = statSync(projectPath);
    return { exists: true, directory: info.isDirectory() };
  } catch {
    return { exists: false, directory: false };
  }
}

/**
 * Build the three request handlers.
 * @param {{ ctx: object, manager: object, store: object, logger?: object }} options
 */
export function createApi(options) {
  const { ctx, manager, store } = options;
  const logger = options.logger ?? ctx?.logger;

  /** Full panel snapshot. */
  async function state() {
    const { servers, loaderAvailable } = discoverServers(ctx);
    const policy = store.getPolicy();
    const agents = liveAgentList(ctx).map((entry) => {
      const project = projectForCwd(policy, entry.cwd);
      return {
        id: entry.id,
        cwd: entry.cwd,
        projectPath: project?.path ?? null
      };
    });
    const suggestions = await workspaceSuggestions(ctx);
    const seen = new Set(suggestions.map((entry) => entry.path));
    for (const agent of agents) {
      if (seen.has(agent.cwd)) continue;
      seen.add(agent.cwd);
      suggestions.push({ path: agent.cwd, title: agent.cwd });
    }
    const projects = policy.projects.map((project) => ({ ...project, ...pathState(project.path) }));
    const skills = service(ctx, 'skills');
    return json({
      stateFile: store.displayFile,
      config: policy,
      projects,
      servers,
      workspaceSuggestions: suggestions,
      liveAgents: agents,
      loaderAvailable,
      skillsAvailable: typeof skills?.snapshot === 'function',
      configError: store.getError(),
      warnings: [...(store.getWarnings?.() ?? []), ...(store.resolveWarning === undefined ? [] : [{ code: 'config', message: store.resolveWarning }])]
    });
  }

  /** One directory's invocation-neutral skill catalog. */
  async function skills(request) {
    let cwd;
    try {
      const raw = new URL(request.url).searchParams.get('cwd');
      if (raw === null || raw.length === 0) throw new HttpError(400, 'missing-cwd', 'cwd query parameter is required');
      cwd = normalizePath(raw);
    } catch (error) {
      if (error instanceof HttpError) return failure(error.status, error.code, error.message);
      return failure(400, 'invalid-cwd', error instanceof Error ? error.message : 'Invalid cwd');
    }
    if (typeof service(ctx, 'skills')?.snapshot !== 'function') {
      return failure(503, 'skills-unavailable', 'The skill registry is not available in this profile');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('skill discovery timed out')), 10_000);
    timer.unref?.();
    try {
      const result = await discoverSkills(ctx, cwd, controller.signal);
      if (result.unavailable === true) {
        return failure(503, 'skills-unavailable', 'The skill registry is not available in this profile');
      }
      return json({ cwd, ...result });
    } catch (error) {
      if (controller.signal.aborted === true) {
        return failure(504, 'skills-timeout', 'Skill discovery did not finish within 10 seconds');
      }
      logger?.warn?.(`mcp-skill-manager: skill discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      return failure(500, 'skills-failed', 'Skill discovery failed');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Replace the complete policy document. */
  async function config(request) {
    let body;
    try {
      body = await readJson(request, CONFIG_BODY_LIMIT);
    } catch (error) {
      if (error instanceof HttpError) return failure(error.status, error.code, error.message);
      return failure(400, 'invalid-body', 'Request body could not be read');
    }
    const input = isRecord(body.config) ? body.config : body;
    try {
      const result = await manager.savePolicy(input);
      return json({ config: result.policy, warnings: result.warnings });
    } catch (error) {
      if (error instanceof PolicyError) return failure(400, error.code, error.message);
      logger?.warn?.(`mcp-skill-manager: policy save failed: ${error instanceof Error ? error.message : String(error)}`);
      return failure(500, 'save-failed', 'The policy could not be saved');
    }
  }

  return { state, skills, config };
}

/**
 * Register the API routes on the active Connection service.
 *
 * The inject fiber waits for `connection`; the returned disposer removes every
 * route when the plugin unloads or the Connection provider is replaced.
 */
export function registerApi(ctx, api) {
  return ctx.inject(['connection'], (scope) => {
    const fetchRegistry = scope.connection?.fetch;
    if (fetchRegistry?.register === undefined) return;
    const disposers = [
      fetchRegistry.register({
        path: API_STATE_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: () => api.state()
      }),
      fetchRegistry.register({
        path: API_SKILLS_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: (request) => api.skills(request)
      }),
      fetchRegistry.register({
        path: API_CONFIG_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => api.config(request)
      })
    ];
    return async () => {
      await Promise.allSettled(disposers.map((dispose) => dispose?.()));
    };
  });
}
