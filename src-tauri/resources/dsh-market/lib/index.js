// src-tauri/resources/dsh-market/src/host/dsh-cli.js
import { spawn } from "node:child_process";
import { existsSync as existsSync3 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname2, isAbsolute as isAbsolute2, join as join3, resolve as resolve2 } from "node:path";

// src-tauri/resources/dsh-market/src/host/log.js
import { homedir } from "node:os";
var MAX_ENTRIES = 200;
var DETAIL_MAX = 600;
var entries = [];
function sanitize(text) {
  return text.replaceAll(homedir(), "~").replace(/[\u0000-\u001f\u007f]/g, "").replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***").replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, "gh*_***").replace(/npm_[A-Za-z0-9]{16,}/g, "npm_***").replace(/bearer\s+\S+/gi, "Bearer ***").replace(/(authorization|token|apikey|api-key|password)(["':=\s]+)\S+/gi, "$1$2***");
}
function logEvent(level, event, detail) {
  entries.push({
    at: (/* @__PURE__ */ new Date()).toISOString(),
    level,
    event,
    detail: sanitize(detail).slice(0, DETAIL_MAX)
  });
  if (entries.length > MAX_ENTRIES)
    entries.splice(0, entries.length - MAX_ENTRIES);
}
function exportLogs(header) {
  const head = Object.entries(header).map(([key, value]) => `${key}: ${sanitize(value)}`);
  const lines = entries.map((e) => `${e.at} [${e.level}] ${e.event}: ${e.detail}`);
  return [
    "# dsh-market log export",
    ...head,
    "",
    ...lines.length > 0 ? lines : ["(no events this session)"],
    ""
  ].join("\n");
}

// src-tauri/resources/dsh-market/src/host/ndjson.js
function emptyProgress() {
  return {
    phase: null,
    done: 0,
    total: null,
    currentPackage: null,
    downloaded: null,
    size: null,
    seen: false,
    error: null,
    errorCode: null,
    ignoredBuilds: []
  };
}
function createProgressTracker() {
  const snap = emptyProgress();
  const seenPackages = /* @__PURE__ */ new Set();
  function dedupe(packageId) {
    if (typeof packageId !== "string" || packageId === "")
      return;
    if (!seenPackages.has(packageId)) {
      seenPackages.add(packageId);
      snap.done += 1;
    }
  }
  function feed(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof event !== "object" || event === null)
      return;
    const msg = event;
    const name2 = msg.name;
    if (typeof name2 !== "string")
      return;
    if (name2 === "pnpm:stage") {
      const stage = msg.stage;
      if (stage === "resolution_started")
        snap.phase = "resolving";
      else if (stage === "resolution_done")
        snap.phase = "downloading";
      else if (stage === "importing_started" || stage === "importing_done")
        snap.phase = "linking";
      snap.seen = true;
      return;
    }
    if (name2 === "pnpm:progress") {
      snap.seen = true;
      const status = msg.status;
      if (status === "resolved") {
        if (snap.phase === null)
          snap.phase = "resolving";
        dedupe(msg.packageId);
      } else if (status === "fetched" || status === "found_in_store") {
        snap.phase = "downloading";
        snap.currentPackage = typeof msg.packageId === "string" ? msg.packageId : snap.currentPackage;
        dedupe(msg.packageId);
      }
      return;
    }
    if (name2 === "pnpm:fetching-progress") {
      snap.seen = true;
      snap.phase = "downloading";
      if (typeof msg.packageId === "string")
        snap.currentPackage = msg.packageId;
      if (typeof msg.size === "number")
        snap.size = msg.size;
      if (typeof msg.downloaded === "number")
        snap.downloaded = msg.downloaded;
      dedupe(msg.packageId);
      return;
    }
    if (name2 === "pnpm:lifecycle") {
      snap.seen = true;
      snap.phase = "building";
      const wd = typeof msg.wd === "string" ? msg.wd : "";
      const dep = typeof msg.depPath === "string" ? msg.depPath : "";
      const base = wd.split(/[\\/]/).filter(Boolean).pop();
      snap.currentPackage = base ?? (dep !== "" ? dep : snap.currentPackage);
      return;
    }
    if (name2 === "pnpm:stats") {
      if (msg.added !== void 0 || msg.removed !== void 0)
        snap.phase = "linking";
      snap.seen = true;
      return;
    }
    if (name2 === "pnpm:ignored-scripts") {
      snap.seen = true;
      if (Array.isArray(msg.packageNames)) {
        for (const pkg of msg.packageNames) {
          const at = typeof pkg === "string" ? pkg.lastIndexOf("@") : -1;
          const bare = at > 0 ? pkg.slice(0, at) : pkg;
          if (typeof bare === "string" && bare !== "" && !snap.ignoredBuilds.includes(bare))
            snap.ignoredBuilds.push(bare);
        }
      }
      return;
    }
    if (name2 === "pnpm" && msg.level === "error") {
      const err = msg.err ?? {};
      const message = typeof err.message === "string" ? err.message : "";
      if (message !== "")
        snap.error = message.slice(0, 2e3);
      if (typeof err.code === "string" && err.code !== "")
        snap.errorCode = err.code;
      return;
    }
  }
  function reset() {
    seenPackages.clear();
    const fresh = emptyProgress();
    Object.assign(snap, fresh);
  }
  return {
    get snapshot() {
      return { ...snap, ignoredBuilds: [...snap.ignoredBuilds] };
    },
    feed,
    reset
  };
}

// src-tauri/resources/dsh-market/src/host/pnpm-compat.js
import { existsSync } from "node:fs";
import { join } from "node:path";
function pluginArgsFor(profileDir2, pluginArgs) {
  if (pluginArgs[0] !== "add" && pluginArgs[0] !== "remove")
    return pluginArgs;
  if (!existsSync(join(profileDir2, "pnpm-workspace.yaml")))
    return pluginArgs;
  return [pluginArgs[0], "-w", ...pluginArgs.slice(1)];
}
function isTransientPnpmFailure(output) {
  return /ERR_PNPM_FETCH_5\d\d|ERR_PNPM_META_FETCH_FAIL|FetchError|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up|network timeout/i.test(output);
}
function isFetchTimeoutFailure(output) {
  return /operation was aborted due to timeout|TimeoutError|error \(23\)/i.test(output);
}
function classifyPnpmFailure(output) {
  if (output.includes("ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF")) {
    return {
      code: "hoist-pattern-diff",
      recoverable: true,
      message: "profile \u7684 node_modules \u662F\u65E7\u7248 pnpm \u521B\u5EFA\u7684\uFF0C\u4E0E\u5F53\u524D pnpm \u7684\u9ED8\u8BA4\u914D\u7F6E\u4E0D\u517C\u5BB9\uFF0C\u9700\u8981\u91CD\u5EFA\u540E\u91CD\u8BD5 / this profile's node_modules was created by a different pnpm major; it must be rebuilt (pnpm install) before changes can be applied"
    };
  }
  if (output.includes("ERR_PNPM_UNEXPECTED_STORE")) {
    const linked = /currently linked from the store at "([^"]+)"/.exec(output)?.[1];
    const wanted = /wants to use the store at "([^"]+)"/.exec(output)?.[1];
    const detail = linked !== void 0 && wanted !== void 0 ? `
  node_modules \u2192 ${linked}
  pnpm \u73B0\u5728\u60F3\u7528 / pnpm now wants \u2192 ${wanted}` : "";
    return {
      code: "unexpected-store",
      recoverable: false,
      message: `\u8FD9\u4E2A profile \u7684 node_modules \u94FE\u63A5\u5230\u7684 pnpm store\uFF0C\u548C\u5F53\u524D pnpm \u9ED8\u8BA4\u4F7F\u7528\u7684 store \u4E0D\u662F\u540C\u4E00\u4E2A\uFF0Cpnpm \u56E0\u6B64\u62D2\u7EDD\u6240\u6709\u5B89\u88C5\u4E0E\u5378\u8F7D\u3002${detail}
\u5728 profile \u76EE\u5F55\u91CC\u6267\u884C\u4E00\u6B21 \`pnpm install --store-dir <\u4E0A\u9762\u7B2C\u4E00\u4E2A\u8DEF\u5F84>\` \u91CD\u65B0\u94FE\u63A5\u5373\u53EF\uFF08dsh \u8FD0\u884C\u65F6\u53EF\u80FD\u5360\u7528\u6587\u4EF6\uFF0C\u5FC5\u8981\u65F6\u5148\u9000\u51FA dsh\uFF09/ this profile's node_modules is linked to a different pnpm store than the one pnpm now resolves, so pnpm refuses every install and uninstall.${detail}
Relink by running \`pnpm install --store-dir <the first path above>\` once in the profile directory (stop dsh first if files are locked)`
    };
  }
  if (output.includes("ERR_PNPM_ADDING_TO_ROOT")) {
    return {
      code: "adding-to-root",
      recoverable: false,
      message: "pnpm \u62D2\u7EDD\u5728 workspace \u6839\u76EE\u5F55\u5B89\u88C5\uFF08\u7F3A\u5C11 -w\uFF09\u3002\u8FD9\u662F\u5E02\u573A\u7684 bug\uFF0C\u8BF7\u5347\u7EA7 dshmarket \u5230\u6700\u65B0\u7248 / pnpm refused to add at a workspace root (missing -w); this is a market bug \u2014 please update dshmarket"
    };
  }
  if (/--workspace-root may only be used inside a workspace/i.test(output)) {
    return {
      code: "not-a-workspace",
      recoverable: false,
      message: "profile \u76EE\u5F55\u4E0D\u662F pnpm workspace\uFF0C\u5374\u4F20\u5165\u4E86 -w\u3002\u8FD9\u662F\u5E02\u573A\u7684 bug\uFF0C\u8BF7\u5347\u7EA7 dshmarket \u5230\u6700\u65B0\u7248 / -w was passed but the profile is not a pnpm workspace; this is a market bug \u2014 please update dshmarket"
    };
  }
  if (output.includes("ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION") || output.includes("ERR_PNPM_NO_MATURE_MATCHING_VERSION")) {
    return {
      code: "release-age-violation",
      recoverable: false,
      message: "\u8FD9\u4E2A profile \u91CC\u6709\u4E00\u4E2A\u521A\u53D1\u5E03\u4E0D\u4E45\u7684\u63D2\u4EF6\u7248\u672C\uFF0Cpnpm \u7684\u5B89\u5168\u7B49\u5F85\u671F\u68C0\u67E5\u56E0\u6B64\u62D2\u7EDD\u4E86\u672C\u6B21\u6539\u52A8\uFF08\u5373\u4F7F\u6539\u7684\u662F\u522B\u7684\u63D2\u4EF6\uFF09\u3002\u5E02\u573A\u5DF2\u81EA\u52A8\u653E\u884C\u91CD\u8BD5\u4E00\u6B21\uFF1B\u82E5\u4ECD\u770B\u5230\u672C\u6761\uFF0C\u8BF7\u5BFC\u51FA\u65E5\u5FD7\u53CD\u9988 / a recently-published plugin version in this profile trips pnpm's fresh-release safety check, blocking any change (even to other plugins); the market retries once with a one-shot bypass \u2014 if you still see this, export the log and report it"
    };
  }
  if (output.includes("ERR_PNPM_IGNORED_BUILDS")) {
    return {
      code: "ignored-builds",
      recoverable: false,
      message: '\u6709\u4F9D\u8D56\u9700\u8981\u6267\u884C\u6784\u5EFA\u811A\u672C\uFF0C\u88AB pnpm \u9ED8\u8BA4\u62E6\u622A\u3002\u70B9\u51FB\u300C\u5141\u8BB8\u6784\u5EFA\u811A\u672C\u5E76\u91CD\u8BD5\u300D\u653E\u884C\u540E\u91CD\u8BD5\u5373\u53EF / a dependency needs to run build scripts, which pnpm blocks by default \u2014 click "Allow build scripts and retry" to approve and retry'
    };
  }
  if (output.includes("ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED")) {
    return {
      code: "git-prepare-not-allowed",
      recoverable: false,
      message: '\u8FD9\u4E2A git \u63D2\u4EF6\u9700\u8981\u5728\u5B89\u88C5\u65F6\u6267\u884C\u6784\u5EFA\u811A\u672C\uFF0C\u88AB pnpm \u9ED8\u8BA4\u62E6\u622A\u3002\u70B9\u51FB\u300C\u5141\u8BB8\u6784\u5EFA\u811A\u672C\u5E76\u91CD\u8BD5\u300D\u653E\u884C\u540E\u91CD\u8BD5\u5373\u53EF / this git-hosted plugin needs to run its build script at install time, which pnpm blocks by default \u2014 click "Allow build scripts and retry" to approve and retry'
    };
  }
  if (output.includes("ERR_PNPM_FETCH_404")) {
    const pkg = /GET\s+\S*\/([^/\s]+):/.exec(output)?.[1].replace(/%2[Ff]/g, "/");
    const zh = pkg === void 0 ? "" : `\uFF08${pkg}\uFF09`;
    const en = pkg === void 0 ? "" : ` (${pkg})`;
    return {
      code: "fetch-404",
      recoverable: false,
      message: `\u6709\u4E00\u4E2A\u4F9D\u8D56\u5728 registry \u4E0A\u4E0D\u5B58\u5728${zh}\uFF0Cpnpm \u56E0\u6B64\u62D2\u7EDD\u4EFB\u4F55\u5B89\u88C5\u64CD\u4F5C\u3002\u5B83\u53EF\u80FD\u662F\u4E4B\u524D\u5931\u8D25\u64CD\u4F5C\u6B8B\u7559\u5728 profile package.json \u91CC\u7684\u5E7D\u7075\u4F9D\u8D56\uFF08\u53EF\u624B\u52A8\u5220\u9664\u8BE5\u884C\uFF09\uFF0C\u4E5F\u53EF\u80FD\u662F\u9700\u8981\u767B\u5F55\u7684\u79C1\u6709\u5305 / a dependency cannot be resolved from the registry${en}; pnpm refuses every install while it is present. It may be a ghost entry left in the profile's package.json by an earlier failed operation (remove that line by hand), or a private package needing registry credentials`
    };
  }
  if (isTransientPnpmFailure(output)) {
    return {
      code: "transient-network",
      recoverable: false,
      message: "\u62C9\u53D6\u4F9D\u8D56\u65F6\u7F51\u7EDC\u4E34\u65F6\u5931\u8D25\uFF08\u4E0D\u4E00\u5B9A\u662F\u4F60\u6B63\u5728\u88C5\u7684\u63D2\u4EF6\u2014\u2014\u5B89\u88C5\u4F1A\u91CD\u653E\u6574\u4E2A\u4F9D\u8D56\u6811\uFF0C\u4EFB\u4F55\u4E00\u4E2A\u65E2\u6709\u4F9D\u8D56\u6296\u52A8\u90FD\u4F1A\u4E2D\u65AD\uFF09\u3002\u5DF2\u81EA\u52A8\u91CD\u8BD5\u4E00\u6B21\u4ECD\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5 / a transient network failure while fetching dependencies (not necessarily the plugin you are installing \u2014 installs replay the whole dependency tree, so any existing dependency can hiccup); one automatic retry failed too \u2014 please try again shortly"
    };
  }
  if (isFetchTimeoutFailure(output)) {
    return {
      code: "fetch-timeout",
      recoverable: false,
      message: "\u4E0B\u8F7D\u8D85\u65F6\uFF1A\u8FD9\u4E2A\u63D2\u4EF6\u7684\u5B89\u88C5\u5305\u8F83\u5927\uFF08github \u6E90\u4F1A\u4E0B\u8F7D\u6574\u4E2A\u4ED3\u5E93\uFF09\u6216\u7F51\u7EDC\u8F83\u6162\uFF0Cpnpm \u9ED8\u8BA4\u7684\u5355\u6B21\u8BF7\u6C42 60 \u79D2\u9650\u5236\u4E0D\u591F\u7528\u3002\u5E02\u573A\u5DF2\u7528\u66F4\u957F\u7684\u8D85\u65F6\u81EA\u52A8\u91CD\u8BD5\u4E00\u6B21\uFF1B\u82E5\u4ECD\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u6216\u68C0\u67E5\u7F51\u7EDC / download timed out: this plugin ships a large tarball (github sources download the whole repository) or your network is slow, and pnpm's default 60-second per-request limit was not enough; the market retries once with a longer timeout \u2014 if it still fails, try again later or check the network"
    };
  }
  if (output.includes("pnpm not found on PATH")) {
    return {
      code: "pnpm-missing",
      recoverable: false,
      message: "\u627E\u4E0D\u5230 pnpm\uFF0C\u8BF7\u5148\u5728\u5E02\u573A\u9875\u9876\u90E8\u4E00\u952E\u5B89\u88C5\u7EC4\u4EF6 / pnpm is not on PATH \u2014 use the one-click setup at the top of the market page"
    };
  }
  return null;
}

// src-tauri/resources/dsh-market/src/host/profile.js
import { existsSync as existsSync2, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, isAbsolute, join as join2, relative, resolve } from "node:path";

// src-tauri/resources/dsh-market/src/host/sources.js
var REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
function validSubpath(subpath) {
  if (!/^[A-Za-z0-9_./-]+$/.test(subpath))
    return false;
  return !subpath.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
}
var NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
function parseSourceUrl(url) {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\/tree\/[^/]+\/(.+?))?\/?$/.exec(url);
  if (m === null || !REPO_RE.test(m[1]))
    return null;
  const subpath = m[2] ?? null;
  if (subpath !== null) {
    if (!validSubpath(subpath))
      return null;
  }
  return { repo: m[1], subpath };
}
function repoFromParts(owner, name2) {
  const repoName = name2.replace(/\.git$/i, "");
  const repo = `${owner}/${repoName}`;
  return REPO_RE.test(repo) ? { repo } : null;
}
function parseGitHubRepository(value) {
  const input = value.trim();
  const shortcut = /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:#.*)?$/i.exec(input);
  if (shortcut !== null)
    return repoFromParts(shortcut[1], shortcut[2]);
  const remote = input.replace(/^git\+/i, "");
  const web = /^(?:https?|git|ssh):\/\/(?:git@)?github\.com[/:]([^/]+)\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(remote);
  const scp = /^git@github\.com:([^/]+)\/([^/?#]+)$/i.exec(remote);
  const match = web ?? scp;
  return match === null ? null : repoFromParts(match[1], match[2]);
}
function parseGitHubRemote(url) {
  const exact = parseGitHubRepository(url);
  if (exact !== null)
    return exact;
  const matches = [...url.matchAll(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?=$|[/?#])/ig)];
  const match = matches.at(-1);
  return match === void 0 ? null : repoFromParts(match[1], match[2]);
}
function githubRepoIdentity(url, directory) {
  const source = parseGitHubRepository(url);
  if (source === null)
    return null;
  const repo = source.repo.toLowerCase();
  if (directory === void 0 || directory === null || directory.trim() === "")
    return repo;
  const subpath = directory.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  return validSubpath(subpath) ? `${repo}#path:/${subpath.toLowerCase()}` : null;
}
function githubRepoIdentities(url, directory) {
  const identity = githubRepoIdentity(url, directory);
  if (identity === null)
    return [];
  const pathAt = identity.indexOf("#path:/");
  return pathAt === -1 ? [identity] : [identity.slice(0, pathAt), identity];
}
function githubRemoteIdentities(url, directory) {
  const source = parseGitHubRemote(url);
  if (source === null)
    return [];
  return githubRepoIdentities(`https://github.com/${source.repo}`, directory);
}
function repoOf(url) {
  return parseSourceUrl(url)?.repo ?? null;
}
function gitAllowBuildsKey(name2, spec) {
  const m = /^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:#.*)?$/.exec(spec);
  if (m === null)
    return null;
  return `${name2}@git+https://github.com/${m[1]}.git`;
}
function installTargetFor(entry) {
  const source = parseSourceUrl(entry.url);
  if (source === null)
    return null;
  if (typeof entry.npm === "string" && NPM_NAME_RE.test(entry.npm))
    return entry.npm;
  return source.subpath !== null ? `github:${source.repo}#path:/${source.subpath}` : `github:${source.repo}`;
}
function findInstalledAlias(entry, installed) {
  const source = parseSourceUrl(entry.url);
  const entryRepoId = source === null ? null : source.subpath === null ? source.repo.toLowerCase() : `${source.repo.toLowerCase()}#path:/${source.subpath.toLowerCase()}`;
  const ids = /* @__PURE__ */ new Set([entry.name.toLowerCase()]);
  if (typeof entry.npm === "string" && entry.npm !== "")
    ids.add(entry.npm.toLowerCase());
  if (entryRepoId !== null)
    ids.add(entryRepoId);
  for (const [name2, spec] of Object.entries(installed)) {
    const dep = /* @__PURE__ */ new Set([name2.toLowerCase()]);
    const scoped = /^@([^/]+)\/(.+)$/.exec(name2);
    if (scoped !== null)
      dep.add(`${scoped[1]}/${scoped[2]}`.toLowerCase());
    const m = /github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:#path:\/([A-Za-z0-9_./-]+))?/i.exec(spec);
    if (m !== null) {
      dep.add(m[1].toLowerCase());
      if (m[2] !== void 0)
        dep.add(`${m[1].toLowerCase()}#path:/${m[2].toLowerCase()}`);
      if (entryRepoId !== null) {
        if (dep.has(entryRepoId))
          return name2;
        continue;
      }
    }
    for (const id of dep)
      if (ids.has(id))
        return name2;
  }
  return null;
}

// src-tauri/resources/dsh-market/src/host/profile.js
function profileDir(profile, explicitDir) {
  if (explicitDir !== void 0)
    return explicitDir;
  const home = process.env.DSH_HOME ?? join2(homedir2(), ".dsh");
  return join2(home, "profiles", profile);
}
var INBOX_BUNDLES = /* @__PURE__ */ new Set([
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@deepseek-ai/dsh-headless"
]);
function readInstalled(profile, explicitDir) {
  try {
    const manifest = JSON.parse(readFileSync(join2(profileDir(profile, explicitDir), "package.json"), "utf8"));
    const installed = {};
    for (const [name2, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (!INBOX_BUNDLES.has(name2))
        installed[name2] = spec;
    }
    return installed;
  } catch {
    return {};
  }
}
function readManifestDeps(profile, explicitDir) {
  try {
    const manifest = JSON.parse(readFileSync(join2(profileDir(profile, explicitDir), "package.json"), "utf8"));
    return { ...manifest.dependencies };
  } catch {
    return {};
  }
}
function restoreManifestDeps(profile, snapshot, explicitDir) {
  const file = join2(profileDir(profile, explicitDir), "package.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const current = manifest.dependencies ?? {};
  const touched = /* @__PURE__ */ new Set();
  for (const name2 of Object.keys(current))
    if (current[name2] !== snapshot[name2])
      touched.add(name2);
  for (const name2 of Object.keys(snapshot))
    if (current[name2] !== snapshot[name2])
      touched.add(name2);
  if (touched.size === 0)
    return [];
  manifest.dependencies = { ...snapshot };
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}
`);
  return [...touched];
}
function readInstalledVersion(profile, name2, explicitDir) {
  try {
    const manifest = JSON.parse(readFileSync(join2(profileDir(profile, explicitDir), "node_modules", name2, "package.json"), "utf8"));
    return manifest.version ?? null;
  } catch {
    return null;
  }
}
function readInstalledPreinstalled(profile, name2, explicitDir) {
  try {
    return existsSync2(join2(profileDir(profile, explicitDir), "node_modules", name2, ".dsh-source-digest"));
  } catch {
    return false;
  }
}
function readInstalledManifest(profile, name2, explicitDir) {
  try {
    return JSON.parse(readFileSync(join2(profileDir(profile, explicitDir), "node_modules", name2, "package.json"), "utf8"));
  } catch {
    return null;
  }
}
var PACKAGE_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
function localSpecDirectory(root, spec) {
  const match = /^(?:link|file):(.+)$/i.exec(spec);
  if (match === null)
    return null;
  let path = match[1];
  try {
    path = decodeURIComponent(path);
  } catch {
  }
  if (path.startsWith("//"))
    return null;
  const candidate = isAbsolute(path) ? path : resolve(root, path);
  try {
    return statSync(candidate).isDirectory() ? realpathSync(candidate) : null;
  } catch {
    return null;
  }
}
function installedPackageDirectory(root, name2) {
  try {
    const candidate = join2(root, "node_modules", name2);
    return statSync(candidate).isDirectory() ? realpathSync(candidate) : null;
  } catch {
    return null;
  }
}
function manifestAt(dir) {
  try {
    const value = JSON.parse(readFileSync(join2(dir, "package.json"), "utf8"));
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}
function manifestRepository(manifest) {
  const repository = manifest?.repository;
  if (typeof repository === "string")
    return { url: repository, directory: null };
  if (typeof repository !== "object" || repository === null)
    return null;
  const value = repository;
  if (typeof value.url !== "string")
    return null;
  return { url: value.url, directory: typeof value.directory === "string" ? value.directory : null };
}
function gitConfigPath(marker, worktreeRoot) {
  try {
    if (statSync(marker).isDirectory()) {
      const direct2 = join2(marker, "config");
      return existsSync2(direct2) ? direct2 : null;
    }
    const pointer = /^gitdir:\s*(.+)$/im.exec(readFileSync(marker, "utf8"));
    if (pointer === null)
      return null;
    const gitDir = resolve(worktreeRoot, pointer[1].trim());
    const direct = join2(gitDir, "config");
    if (existsSync2(direct))
      return direct;
    const commonDir = readFileSync(join2(gitDir, "commondir"), "utf8").trim();
    const common2 = join2(resolve(gitDir, commonDir), "config");
    return existsSync2(common2) ? common2 : null;
  } catch {
    return null;
  }
}
function originFromConfig(file) {
  try {
    let origin = false;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const section = /^\s*\[remote\s+"([^"]+)"\]\s*$/.exec(line);
      if (section !== null) {
        origin = section[1] === "origin";
        continue;
      }
      if (!origin)
        continue;
      const url = /^\s*url\s*=\s*(.+?)\s*$/.exec(line);
      if (url !== null)
        return url[1];
    }
  } catch {
  }
  return null;
}
function gitCheckout(start) {
  let current = start;
  while (true) {
    const marker = join2(current, ".git");
    if (existsSync2(marker)) {
      const config = gitConfigPath(marker, current);
      const origin = config === null ? null : originFromConfig(config);
      return origin === null ? null : { root: current, origin };
    }
    const parent = dirname(current);
    if (parent === current)
      return null;
    current = parent;
  }
}
function checkoutSubpath(root, packageDir) {
  const value = relative(root, packageDir).replaceAll("\\", "/");
  return value === "" || value === "." || value.startsWith("../") ? null : value;
}
function readInstalledRepoEvidence(profile, name2, spec, explicitDir) {
  if (!PACKAGE_NAME_RE.test(name2) || !/^(?:link|file):/i.test(spec))
    return { identities: [], hints: [] };
  const root = profileDir(profile, explicitDir);
  const sourceDir = localSpecDirectory(root, spec);
  const installedDir = installedPackageDirectory(root, name2);
  const manifestDir = installedDir ?? sourceDir;
  const manifest = manifestDir === null ? readInstalledManifest(profile, name2, explicitDir) : manifestAt(manifestDir);
  const repository = manifestRepository(typeof manifest === "object" && manifest !== null ? manifest : null);
  const checkoutDir = sourceDir ?? (installedDir !== null && /^(?:link):/i.test(spec) ? installedDir : null);
  const checkout = checkoutDir === null ? null : gitCheckout(checkoutDir);
  if (repository !== null) {
    const identities = githubRepoIdentities(repository.url, repository.directory);
    if (identities.length > 0)
      return { identities, hints: [] };
  }
  if (checkout !== null) {
    return { identities: [], hints: githubRemoteIdentities(checkout.origin, checkoutSubpath(checkout.root, checkoutDir)) };
  }
  return { identities: [], hints: [] };
}
function hasDshManifest(dir) {
  try {
    const manifest = JSON.parse(readFileSync(join2(dir, "package.json"), "utf8"));
    return manifest.dsh !== void 0;
  } catch {
    return false;
  }
}
function entryArtifactExists(dir) {
  try {
    const manifest = JSON.parse(readFileSync(join2(dir, "package.json"), "utf8"));
    const candidates = [];
    if (typeof manifest.main === "string")
      candidates.push(manifest.main);
    const rootExport = typeof manifest.exports === "string" ? manifest.exports : manifest.exports?.["."];
    if (typeof rootExport === "string")
      candidates.push(rootExport);
    else if (rootExport !== null && typeof rootExport === "object") {
      for (const value of Object.values(rootExport))
        if (typeof value === "string")
          candidates.push(value);
    }
    if (candidates.length === 0)
      candidates.push("index.js");
    return candidates.some((rel) => existsSync2(join2(dir, rel)));
  } catch {
    return false;
  }
}
function bundlePatchTargets(dir) {
  return readBundlePatchRows(dir).names;
}
function bundlePatchInsertedIds(dir) {
  return readBundlePatchRows(dir).insertedIds;
}
function parsePatchRows(text) {
  const names = [];
  const ids = [];
  const insertedIds = [];
  {
    let insertIndent = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, "");
      if (line.trim() === "")
        continue;
      const indent = line.length - line.trimStart().length;
      if (insertIndent !== null && indent <= insertIndent && !/^\s*-?\s*(id|name|config):/u.test(line)) {
        insertIndent = null;
      }
      if (/^\s*-?\s*insert:\s*$/u.test(line)) {
        insertIndent = indent;
        continue;
      }
      const name2 = /^\s*-?\s*name:\s*['"]?([^'"\s]+)/.exec(line);
      if (name2 !== null && !names.includes(name2[1]))
        names.push(name2[1]);
      const id = /^\s*-?\s*id:\s*['"]?([^'"\s]+)/.exec(line);
      if (id !== null) {
        if (!ids.includes(id[1]))
          ids.push(id[1]);
        if (insertIndent !== null && indent > insertIndent) {
          if (!insertedIds.includes(id[1]))
            insertedIds.push(id[1]);
        } else if (indent <= (insertIndent ?? -1)) {
          insertIndent = null;
        }
      }
    }
  }
  return { names, ids, insertedIds };
}
function readBundlePatchRows(dir) {
  const empty = { names: [], ids: [], insertedIds: [] };
  try {
    const manifest = JSON.parse(readFileSync(join2(dir, "package.json"), "utf8"));
    const declared = manifest.dsh?.bundle?.patch;
    if (typeof declared !== "string" || declared === "")
      return empty;
    return parsePatchRows(readFileSync(join2(dir, declared), "utf8"));
  } catch {
    return empty;
  }
}
function readProfileBundles(profileDirectory) {
  try {
    const manifest = JSON.parse(readFileSync(join2(profileDirectory, "package.json"), "utf8"));
    const bundles = manifest.dsh?.profile?.bundles;
    return Array.isArray(bundles) ? bundles.filter((name2) => typeof name2 === "string") : [];
  } catch {
    return [];
  }
}
function writeManifestAtomic(manifestPath, manifest) {
  const temp = `${manifestPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}
`);
  renameSync(temp, manifestPath);
}
function removeProfileBundle(profileDirectory, name2) {
  const manifestPath = join2(profileDirectory, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bundles = manifest.dsh?.profile?.bundles;
  if (!Array.isArray(bundles))
    return false;
  const next = bundles.filter((entry) => typeof entry !== "string" || entry !== name2);
  if (next.length === bundles.length)
    return false;
  manifest.dsh ??= {};
  manifest.dsh.profile ??= {};
  manifest.dsh.profile.bundles = next;
  writeManifestAtomic(manifestPath, manifest);
  return true;
}
function addProfileBundle(profileDirectory, name2) {
  const manifestPath = join2(profileDirectory, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.dsh ??= {};
  manifest.dsh.profile ??= {};
  const existing = manifest.dsh.profile.bundles;
  const bundles = Array.isArray(existing) ? existing.filter((entry) => typeof entry === "string") : [];
  if (bundles.includes(name2))
    return false;
  bundles.push(name2);
  manifest.dsh.profile.bundles = bundles;
  writeManifestAtomic(manifestPath, manifest);
  return true;
}
function conflictingEntryIds(profileDirectory, candidate, installedBundles) {
  const mine = bundlePatchInsertedIds(join2(profileDirectory, "node_modules", candidate));
  if (mine.length === 0)
    return [];
  const conflicts = [];
  for (const bundle of installedBundles) {
    if (bundle === candidate)
      continue;
    const theirs = new Set(bundlePatchInsertedIds(join2(profileDirectory, "node_modules", bundle)));
    for (const id of mine) {
      if (theirs.has(id) && !conflicts.some((hit) => hit.id === id))
        conflicts.push({ id, owner: bundle });
    }
  }
  return conflicts;
}
function hasLoadableEntry(profileDirectory, name2) {
  const dir = join2(profileDirectory, "node_modules", name2);
  if (entryArtifactExists(dir))
    return true;
  const workspaceRoot = dirname(profileDirectory);
  return bundlePatchTargets(dir).filter((target) => target !== name2).some((target) => entryArtifactExists(join2(profileDirectory, "node_modules", target)) || entryArtifactExists(join2(dir, "node_modules", target)) || entryArtifactExists(join2(workspaceRoot, "node_modules", target)));
}
function pluginSubdirs(root) {
  const found = [];
  let level1 = [];
  try {
    level1 = readdirSync(root, { withFileTypes: true }).filter((dirent) => dirent.isDirectory() && /^[A-Za-z0-9_.-]+$/.test(dirent.name) && dirent.name !== "node_modules").map((dirent) => dirent.name);
  } catch {
    return found;
  }
  for (const sub of level1) {
    if (hasDshManifest(join2(root, sub))) {
      found.push(sub);
      continue;
    }
    try {
      for (const inner of readdirSync(join2(root, sub), { withFileTypes: true })) {
        if (!inner.isDirectory() || !/^[A-Za-z0-9_.-]+$/.test(inner.name) || inner.name === "node_modules")
          continue;
        if (hasDshManifest(join2(root, sub, inner.name)))
          found.push(`${sub}/${inner.name}`);
      }
    } catch {
    }
    if (found.length >= 8)
      break;
  }
  return found.slice(0, 8);
}
function quoteYamlKey(key) {
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(key) || /:(\s|$)/.test(key)) {
    return `'${key.replace(/'/g, "''")}'`;
  }
  return key;
}
function setAllowBuilds(profile, packages, explicitDir) {
  const file = join2(profileDir(profile, explicitDir), "pnpm-workspace.yaml");
  let yaml = "";
  try {
    yaml = readFileSync(file, "utf8");
  } catch {
  }
  const blockRe = /allowBuilds:[ \t]*\r?\n((?:[ \t]+[^\r\n]*\r?\n?)*)/g;
  const map2 = {};
  const blockMatches = [...yaml.matchAll(blockRe)];
  const blockMatch = blockMatches[0] ?? null;
  for (const match of blockMatches) {
    for (const line of match[1].split(/\r?\n/)) {
      const m = /^[ \t]+(\S.*?)\s*:\s*(true|false)?\s*$/.exec(line);
      if (m === null || m[1] === "")
        continue;
      let key = m[1];
      if (key.length >= 2 && (key[0] === "'" && key[key.length - 1] === "'" || key[0] === '"' && key[key.length - 1] === '"')) {
        key = key.slice(1, -1);
      }
      map2[key] = m[2] ?? "true";
    }
  }
  const GIT_KEY_RE = /^[A-Za-z0-9@/_.-]+@git\+https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/;
  for (const pkg of packages) {
    if (/^[A-Za-z0-9@/_.-]+$/.test(pkg) || GIT_KEY_RE.test(pkg))
      map2[pkg] = "true";
  }
  const eol = /\r\n/.test(yaml) ? "\r\n" : "\n";
  const block = Object.entries(map2).map(([k, v]) => `  ${quoteYamlKey(k)}: ${v}`).join(eol);
  const blockText = `allowBuilds:${eol}${block}${eol}`;
  let next;
  if (blockMatch === null) {
    next = `${yaml.replace(/\r?\n?$/, eol)}${blockText}`;
  } else {
    let seen = 0;
    next = yaml.replace(blockRe, () => seen++ === 0 ? blockText : "");
  }
  writeFileSync(file, next);
  return Object.keys(map2);
}

// src-tauri/resources/dsh-market/src/host/dsh-cli.js
var extraPathDirs = [];
function nodeExecutable(argv0 = process.argv0, execPath = process.execPath) {
  if (argv0 !== void 0 && argv0 !== "" && isAbsolute2(argv0) && existsSync3(argv0))
    return argv0;
  return execPath;
}
var nodeBinDir = dirname2(nodeExecutable());
function proxyEnvForPnpm(env = process.env) {
  const has = (name2) => {
    const wanted = name2.toLowerCase();
    return Object.keys(env).some((key) => key.toLowerCase() === wanted && (env[key] ?? "").trim() !== "");
  };
  const pick = (...names) => {
    for (const name2 of names) {
      const raw = env[name2];
      if (raw !== void 0 && raw.trim() !== "")
        return raw.trim();
    }
    return null;
  };
  const out = {};
  const https = pick("https_proxy", "HTTPS_PROXY") ?? pick("http_proxy", "HTTP_PROXY");
  const http = pick("http_proxy", "HTTP_PROXY") ?? https;
  if (https !== null && !has("npm_config_https_proxy"))
    out.npm_config_https_proxy = https;
  if (http !== null && !has("npm_config_proxy"))
    out.npm_config_proxy = http;
  const noProxy = pick("no_proxy", "NO_PROXY");
  if (noProxy !== null && !has("npm_config_noproxy"))
    out.npm_config_noproxy = noProxy;
  return out;
}
function spawnEnv() {
  const separator = process.platform === "win32" ? ";" : ":";
  const parts = (process.env.PATH ?? "").split(separator).filter((part) => part !== "");
  const candidates = process.platform === "win32" ? [nodeBinDir, ...extraPathDirs] : ["/opt/homebrew/bin", "/usr/local/bin", join3(homedir3(), ".local", "bin"), nodeBinDir, ...extraPathDirs];
  for (const bin of candidates) {
    if (!parts.includes(bin))
      parts.push(bin);
  }
  return { ...process.env, ...proxyEnvForPnpm(), CI: "true", PATH: parts.join(separator) };
}
var INSTALL_TIMEOUT_MS = Number(process.env.DSH_MARKET_INSTALL_TIMEOUT_MS) || 15 * 60 * 1e3;
var winCmdShim = process.platform === "win32";
var CMD_METACHARS = /[\s"&|<>^()%!]/;
function quoteCmdArg(arg) {
  if (!CMD_METACHARS.test(arg))
    return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}
function cmdCommandLine(argv) {
  return argv.map(quoteCmdArg).join(" ");
}
var COMSPEC = process.env.ComSpec ?? "cmd.exe";
function spawnShim(file, args, options) {
  const { viaShell = false, ...spawnOptions } = options;
  if (!viaShell) {
    return spawn(file, [...args], { ...spawnOptions, shell: false });
  }
  if (process.platform !== "win32") {
    return spawn(file, [...args], { ...spawnOptions, shell: false });
  }
  return spawn(COMSPEC, ["/d", "/s", "/c", `"${cmdCommandLine([file, ...args])}"`], {
    ...spawnOptions,
    shell: false,
    windowsVerbatimArguments: true
  });
}
function dshArgv() {
  const entry = process.argv[1];
  if (entry !== void 0 && /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry)) {
    const abs = resolve2(entry);
    return { file: nodeExecutable(), args: [...process.execArgv, abs], cwd: dirname2(abs), viaShell: false };
  }
  return { file: "dsh", args: [], cwd: void 0, viaShell: winCmdShim };
}
function killChild(child) {
  if (process.platform === "win32" && child.pid !== void 0) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      return;
    } catch {
    }
  }
  child.kill("SIGKILL");
}
var activeChild = null;
var cancelRequested = false;
var activeDesktopOperation = null;
function killTree(child) {
  if (process.platform === "win32" && child.pid !== void 0) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      return;
    } catch {
    }
  }
  const signalTree = (signal) => {
    if (child.pid === void 0)
      return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
      }
    }
  };
  signalTree("SIGTERM");
  const escalate = setTimeout(() => signalTree("SIGKILL"), 5e3);
  escalate.unref?.();
}
function cancelActive() {
  if (activeDesktopOperation !== null) {
    activeDesktopOperation.userCancelled = true;
    progress.cancelling = true;
    activeDesktopOperation.cancel();
    return true;
  }
  if (activeChild === null)
    return false;
  cancelRequested = true;
  progress.cancelling = true;
  killTree(activeChild);
  return true;
}
var pnpmReady = false;
function probePnpm() {
  if (pnpmReady)
    return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    const child = spawnShim("pnpm", ["--version"], { stdio: "ignore", viaShell: winCmdShim, env: spawnEnv() });
    child.on("error", () => resolvePromise(false));
    child.on("close", (code) => {
      pnpmReady = code === 0;
      resolvePromise(pnpmReady);
    });
  });
}
function runQuiet(file, args, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawnShim(file, args, {
      env: spawnEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      viaShell: winCmdShim
    });
    let output = "";
    const timer = setTimeout(() => killChild(child), timeoutMs);
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-8 * 1024);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ code: 127, output: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, output });
    });
  });
}
async function provisionPnpm() {
  const corepack = await runQuiet("corepack", ["enable", "pnpm"], 60 * 1e3);
  logEvent(corepack.code === 0 ? "info" : "warn", "setup-pnpm", `corepack enable: exit=${String(corepack.code)} ${corepack.output.slice(-200)}`);
  if (await probePnpm())
    return { ok: true };
  const npm = await runQuiet("npm", ["install", "-g", "pnpm"], 3 * 60 * 1e3);
  logEvent(npm.code === 0 ? "info" : "error", "setup-pnpm", `npm -g: exit=${String(npm.code)} ${npm.output.slice(-200)}`);
  if (await probePnpm())
    return { ok: true };
  if (npm.code === 0 || corepack.code === 0) {
    const prefix = await runQuiet("npm", ["prefix", "-g"], 30 * 1e3);
    const bin = prefix.code === 0 ? join3(prefix.output.trim().split("\n").pop() ?? "", "bin") : "";
    if (bin !== "" && isAbsolute2(bin) && !extraPathDirs.includes(bin)) {
      extraPathDirs.push(bin);
      logEvent("info", "setup-pnpm", `added npm's global bin to the probe path: ${bin}`);
      if (await probePnpm())
        return { ok: true };
      extraPathDirs.pop();
    }
  }
  const npmFound = toolOnPath("npm");
  if (!npmFound)
    logEvent("warn", "setup-pnpm", `npm is not on any searched path (node lives in ${nodeBinDir})`);
  return { ok: false, hint: provisionHint(corepack.output, npm.output, npmFound) };
}
var EXECUTABLE_SUFFIXES = process.platform === "win32" ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((part) => part !== "") : [""];
function toolOnPath(name2) {
  const separator = process.platform === "win32" ? ";" : ":";
  for (const dir of (spawnEnv().PATH ?? "").split(separator)) {
    if (dir === "")
      continue;
    for (const suffix of EXECUTABLE_SUFFIXES) {
      if (existsSync3(join3(dir, name2 + suffix)))
        return true;
    }
  }
  return false;
}
function provisionHint(corepackOutput, npmOutput, npmFound = true) {
  if (!npmFound || /ENOENT/.test(corepackOutput) && /ENOENT/.test(npmOutput)) {
    return `\u8FD9\u53F0\u673A\u5668\u7684 dsh \u8FDB\u7A0B\u627E\u4E0D\u5230 npm/corepack\uFF08\u56FE\u5F62\u754C\u9762\u6216\u684C\u9762\u7AEF\u542F\u52A8\u65F6\u4E0D\u7EE7\u627F\u7EC8\u7AEF PATH\uFF09\u3002\u5DF2\u5728 Node \u81EA\u5DF1\u7684\u76EE\u5F55\u91CC\u627E\u8FC7\uFF08${nodeBinDir}\uFF09\u4E5F\u6CA1\u6709\u2014\u2014\u591A\u534A\u662F\u5BBF\u4E3B\u5185\u7F6E\u7684 Node \u8FD0\u884C\u65F6\u4E0D\u5E26 npm\u3002\u8BF7\u6539\u4ECE\u7EC8\u7AEF\u542F\u52A8 dsh\uFF0C\u6216\u5355\u72EC\u88C5\u4E00\u4E2A pnpm\uFF1AWindows \u7528 iwr https://get.pnpm.io/install.ps1 -useb | iex\uFF0CmacOS/Linux \u7528 brew install pnpm / This dsh process cannot find npm/corepack (GUI and desktop launches skip your shell PATH). The directory Node itself runs from (${nodeBinDir}) was searched too \u2014 a bundled Node runtime without npm is the usual cause. Start dsh from a terminal, or install pnpm on its own: \`iwr https://get.pnpm.io/install.ps1 -useb | iex\` (Windows) or \`brew install pnpm\` (macOS/Linux)`;
  }
  if (/EEXIST|already exists|--force to overwrite/i.test(npmOutput)) {
    return "pnpm \u7684\u53EF\u6267\u884C\u6587\u4EF6\u5DF2\u5B58\u5728\uFF08\u901A\u5E38\u662F corepack \u5148\u653E\u597D\u4E86\u540C\u540D shim\uFF09\uFF0Cnpm \u62D2\u7EDD\u8986\u76D6\u3002\u5728\u7EC8\u7AEF\u91CC\u6267\u884C\u5176\u4E00\u5373\u53EF\uFF1Acorepack prepare pnpm@latest --activate\uFF08\u63A8\u8350\uFF0C\u76F4\u63A5\u6FC0\u6D3B\u5DF2\u6709 shim\uFF09\u6216 npm i -g pnpm --force / A pnpm executable already exists (usually a corepack shim), so npm refused to overwrite it. Run one of these in a terminal: `corepack prepare pnpm@latest --activate` (preferred \u2014 activates the shim already there) or `npm i -g pnpm --force`";
  }
  if (/EPERM|EACCES|permission denied|as root\/Administrator/i.test(`${corepackOutput}
${npmOutput}`)) {
    return "\u6CA1\u6709\u6743\u9650\u5199\u5165 Node \u7684\u5B89\u88C5\u76EE\u5F55\u3002\u8BF7\u7528\u7BA1\u7406\u5458/sudo \u6267\u884C\u4E00\u6B21 npm i -g pnpm\uFF0C\u6216\u6539\u7528\u65E0\u9700\u5199\u7CFB\u7EDF\u76EE\u5F55\u7684\u5B89\u88C5\u65B9\u5F0F\uFF1AmacOS/Linux \u7528 brew install pnpm\uFF0CWindows \u7528 iwr https://get.pnpm.io/install.ps1 -useb | iex / No permission to write into the Node install directory. Run `npm i -g pnpm` once as Administrator/sudo, or install pnpm without touching system dirs: `brew install pnpm` (macOS/Linux) or `iwr https://get.pnpm.io/install.ps1 -useb | iex` (Windows)";
  }
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|proxy|certificate/i.test(`${corepackOutput}
${npmOutput}`)) {
    return "\u88C5 pnpm \u65F6\u7F51\u7EDC\u5931\u8D25\u3002\u82E5\u4F60\u5728\u53D7\u9650\u7F51\u7EDC\u4E0B\uFF0Ccorepack \u7684 shim \u4E5F\u4E0B\u8F7D\u4E0D\u5230 pnpm \u672C\u4F53\u2014\u2014\u8BF7\u6539\u7528\u5B8C\u6574\u5B89\u88C5\u6216\u6307\u5B9A\u955C\u50CF\uFF1Abrew install pnpm\uFF08macOS/Linux\uFF09\uFF0C\u6216 npm i -g pnpm --registry <\u4F60\u7684\u955C\u50CF> / Network failure while installing pnpm. On a restricted network the corepack shim cannot download pnpm either \u2014 install it fully or point at a mirror: `brew install pnpm`, or `npm i -g pnpm --registry <your mirror>`";
  }
  return void 0;
}
var progress = {
  active: false,
  target: "",
  startedAt: 0,
  lastLine: "",
  phase: null,
  done: 0,
  total: null,
  currentPackage: null,
  downloaded: null,
  size: null,
  ndjson: false,
  error: null,
  cancelling: false
};
var BOOT_ID = `${String(process.pid)}-${String(Date.now())}`;
var TARGET_RE = /^[A-Za-z0-9@:./_#+~^=-]+$/;
var NDJSON_COMMANDS = /* @__PURE__ */ new Set(["add", "remove", "install"]);
function preparePluginArgs(profileDirectory, pluginArgs) {
  let args = pluginArgsFor(profileDirectory, [...pluginArgs]);
  const target = args[args.length - 1] ?? "";
  if (!TARGET_RE.test(target)) {
    return { error: `unsafe plugin target rejected: ${JSON.stringify(target)}` };
  }
  if (NDJSON_COMMANDS.has(args[0]))
    args = [...args, "--reporter=ndjson"];
  return { args, target };
}
function beginProgress(target) {
  progress.active = true;
  progress.target = target;
  progress.startedAt = Date.now();
  progress.lastLine = "";
  progress.phase = null;
  progress.done = 0;
  progress.total = null;
  progress.currentPackage = null;
  progress.downloaded = null;
  progress.size = null;
  progress.ndjson = false;
  progress.error = null;
  progress.cancelling = false;
  return createProgressTracker();
}
function makeProgressFeeder(tracker) {
  let lineBuffer = "";
  return (chunk) => {
    lineBuffer += chunk;
    let nl;
    while ((nl = lineBuffer.indexOf("\n")) !== -1) {
      const line = lineBuffer.slice(0, nl);
      lineBuffer = lineBuffer.slice(nl + 1);
      const trimmed = line.trim();
      if (trimmed === "")
        continue;
      tracker.feed(trimmed);
      if (!trimmed.startsWith("{"))
        progress.lastLine = trimmed.slice(0, 200);
    }
  };
}
function runDshPlugin(profile, pluginArgs) {
  const { file, args, cwd, viaShell } = dshArgv();
  const prepared = preparePluginArgs(profileDir(profile), pluginArgs);
  if ("error" in prepared) {
    logEvent("error", "install", prepared.error);
    return Promise.resolve({ exitCode: 1, timedOut: false, stdout: "", stderr: prepared.error, cancelled: false });
  }
  pluginArgs = prepared.args;
  const tracker = beginProgress(prepared.target);
  const feed = makeProgressFeeder(tracker);
  return new Promise((resolvePromise) => {
    const child = spawnShim(file, [...args, "plugin", "--profile", profile, ...pluginArgs], {
      cwd,
      // pnpm v10 blocks forever on a silent interactive prompt without a TTY
      // (observed on re-add over a pinned git spec); CI mode forces it to act
      // or fail instead of asking.
      env: spawnEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      viaShell,
      // Own process group on POSIX so cancel/timeout can kill the whole
      // tree (dsh wrapper + pnpm grandchild) with one group signal.
      detached: process.platform !== "win32"
    });
    activeChild = child;
    cancelRequested = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, INSTALL_TIMEOUT_MS);
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout = (stdout + text).slice(-256 * 1024);
      feed(text);
      syncProgress(tracker);
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-64 * 1024);
      feed(text);
      syncProgress(tracker);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      progress.active = false;
      progress.cancelling = false;
      if (activeChild === child)
        activeChild = null;
      resolvePromise({ exitCode: 127, timedOut: false, stdout, stderr: `${stderr}
${error.message}`, cancelled: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      progress.active = false;
      progress.cancelling = false;
      if (activeChild === child)
        activeChild = null;
      const failed = code !== 0 || timedOut;
      if (failed)
        progress.error = tracker.snapshot.error;
      const ignoredBuilds = tracker.snapshot.ignoredBuilds;
      const { error: pnpmError, errorCode: pnpmErrorCode } = tracker.snapshot;
      resolvePromise({
        exitCode: code,
        timedOut,
        stdout,
        stderr,
        cancelled: cancelRequested,
        ...pnpmError !== null ? { pnpmError } : {},
        ...pnpmErrorCode !== null ? { pnpmErrorCode } : {},
        ...ignoredBuilds.length > 0 ? { ignoredBuilds } : {}
      });
    });
  });
}
function createDesktopPluginRuntime(service, activeProfileDir, invokingDir = process.cwd(), timeoutMs = INSTALL_TIMEOUT_MS) {
  if (!isAbsolute2(activeProfileDir) || activeProfileDir.includes("\0")) {
    throw new Error("dsh-market: Desktop profile directory must be an absolute path without NUL");
  }
  if (!isAbsolute2(invokingDir) || invokingDir.includes("\0")) {
    throw new Error("dsh-market: Desktop invoking directory must be an absolute path without NUL");
  }
  const owner = Symbol("dsh-market desktop runtime");
  let closed = false;
  const runPlugin = async (_profile, pluginArgs) => {
    if (closed) {
      return {
        exitCode: 127,
        timedOut: false,
        stdout: "",
        stderr: "dsh-market: Desktop package runtime is disposed",
        cancelled: false
      };
    }
    const prepared = preparePluginArgs(activeProfileDir, pluginArgs);
    if ("error" in prepared) {
      logEvent("error", "install", prepared.error);
      return { exitCode: 1, timedOut: false, stdout: "", stderr: prepared.error, cancelled: false };
    }
    const abort = new AbortController();
    let handle;
    try {
      handle = service.runPlugin(prepared.args, invokingDir, abort.signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const busy = /another desktop pnpm operation is already running/i.test(message);
      return {
        exitCode: 127,
        timedOut: false,
        stdout: "",
        stderr: message,
        cancelled: false,
        ...busy ? { busy: true } : {}
      };
    }
    const tracker = beginProgress(prepared.target);
    const feed = makeProgressFeeder(tracker);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const collectStdout = (chunk) => {
      const text = chunk.toString();
      stdout = (stdout + text).slice(-256 * 1024);
      feed(text);
      syncProgress(tracker);
    };
    const collectStderr = (chunk) => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-64 * 1024);
      feed(text);
      syncProgress(tracker);
    };
    handle.stdout.on("data", collectStdout);
    handle.stderr.on("data", collectStderr);
    let active;
    let timer;
    const done = (async () => {
      try {
        const outcome = await handle.done;
        const failed = outcome.exitCode !== 0 || outcome.signal !== null || timedOut;
        if (failed)
          progress.error = tracker.snapshot.error;
        const ignoredBuilds = tracker.snapshot.ignoredBuilds;
        const { error: pnpmError, errorCode: pnpmErrorCode } = tracker.snapshot;
        return {
          exitCode: outcome.exitCode,
          timedOut,
          stdout,
          stderr,
          cancelled: active.userCancelled,
          ...ignoredBuilds.length > 0 ? { ignoredBuilds } : {},
          ...pnpmError !== null ? { pnpmError } : {},
          ...pnpmErrorCode !== null ? { pnpmErrorCode } : {}
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        progress.error = tracker.snapshot.error;
        return {
          exitCode: 127,
          timedOut,
          stdout,
          stderr: `${stderr}${stderr === "" ? "" : "\n"}${message}`,
          cancelled: active.userCancelled
        };
      } finally {
        if (timer !== void 0)
          clearTimeout(timer);
        progress.active = false;
        progress.cancelling = false;
        handle.stdout.off("data", collectStdout);
        handle.stderr.off("data", collectStderr);
        if (activeDesktopOperation === active)
          activeDesktopOperation = null;
      }
    })();
    active = { owner, cancel: () => {
      handle.cancel();
    }, done, userCancelled: false };
    activeDesktopOperation = active;
    timer = setTimeout(() => {
      timedOut = true;
      abort.abort(new Error("dsh-market: Desktop package operation timed out"));
      handle.cancel();
    }, timeoutMs);
    timer.unref?.();
    return done;
  };
  const cancelOwned = (userCancelled) => {
    const active = activeDesktopOperation;
    if (active?.owner !== owner)
      return false;
    if (userCancelled)
      active.userCancelled = true;
    progress.cancelling = true;
    active.cancel();
    return true;
  };
  return {
    runPlugin,
    // The service is backed by Desktop's packaged pnpm; system discovery and
    // global provisioning are neither needed nor allowed in this mode.
    probePnpm: () => Promise.resolve(true),
    provisionPnpm: () => Promise.resolve({ ok: true }),
    cancelActive: () => cancelOwned(true),
    dispose: async () => {
      closed = true;
      const active = activeDesktopOperation;
      if (active?.owner !== owner)
        return;
      cancelOwned(false);
      await active.done.catch(() => {
      });
    }
  };
}
function syncProgress(tracker) {
  const snap = tracker.snapshot;
  progress.phase = snap.phase;
  progress.done = snap.done;
  progress.total = snap.total;
  progress.currentPackage = snap.currentPackage;
  progress.downloaded = snap.downloaded;
  progress.size = snap.size;
  progress.ndjson = snap.seen;
  if (snap.error !== null)
    progress.error = snap.error;
}

// src-tauri/resources/dsh-market/src/host/routes.js
import { existsSync as existsSync9, readFileSync as readFileSync9, writeFileSync as writeFileSync6 } from "node:fs";
import { join as join14 } from "node:path";

// src-tauri/resources/dsh-market/src/host/net.js
function configuredProxy() {
  const { http, https } = proxyFromEnv();
  return https ?? http;
}
function proxyFromEnv() {
  const pick = (raw) => raw === void 0 || raw.trim() === "" ? null : raw.trim();
  const https = pick(process.env.https_proxy ?? process.env.HTTPS_PROXY) ?? pick(process.env.npm_config_https_proxy);
  const http = pick(process.env.http_proxy ?? process.env.HTTP_PROXY) ?? pick(process.env.npm_config_proxy);
  return { http, https };
}
async function marketFetch(url, init) {
  return await fetch(url, init);
}

// src-tauri/resources/dsh-market/src/host/registry.js
var REGISTRY_URL = process.env.DSHM_REGISTRY_URL ?? "https://awesome-dsh-plugin.com/plugins.json";
var FETCH_TIMEOUT_MS = 15e3;
var served = null;
async function loadRegistry() {
  const started = Date.now();
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const headers = {};
      if (served?.etag != null)
        headers["if-none-match"] = served.etag;
      else if (served?.modified != null)
        headers["if-modified-since"] = served.modified;
      const res = await marketFetch(REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers });
      if (res.status === 304) {
        if (served === null)
          throw new Error('the catalog answered "not modified" with nothing to revalidate');
        return served.data;
      }
      if (!res.ok)
        throw new Error(`HTTP ${String(res.status)}`);
      const data = await res.json();
      if (!Array.isArray(data.plugins) || data.plugins.length === 0)
        throw new Error("the catalog came back empty");
      served = { etag: res.headers.get("etag"), modified: res.headers.get("last-modified"), data };
      return data;
    } catch (error) {
      last = error;
    }
  }
  throw new Error(describeFetchFailure(last, Date.now() - started));
}
function describeFetchFailure(error, elapsedMs) {
  const reason = error instanceof Error ? error.message : String(error);
  const proxy = configuredProxy();
  const parts = [`${reason} (${String(Math.round(elapsedMs / 1e3))}s, 2 attempts)`];
  if (proxy !== null) {
    parts.push(`tried through the configured proxy ${proxy.replace(/\/\/[^@]*@/u, "//***@")}`);
  }
  return parts.join(" \xB7 ");
}

// src-tauri/resources/dsh-market/src/host/hot.js
import { mkdirSync, readdirSync as readdirSync2, readFileSync as readFileSync2, rmSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join4 } from "node:path";
import { pathToFileURL } from "node:url";

// src-tauri/resources/dsh-market/src/host/channels.js
var DIST_TAG = {
  stable: "latest",
  beta: "beta",
  dev: "dev"
};
var CHANNELS = ["stable", "beta", "dev"];
function asChannel(value) {
  return value === "stable" || value === "beta" || value === "dev" ? value : null;
}
function resolveChannel(setting, version) {
  if (setting !== void 0)
    return setting;
  return version.includes("-") ? "beta" : "stable";
}

// src-tauri/resources/dsh-market/src/host/hot.js
var __rewriteRelativeImportExtension = function(path, preserveJsx) {
  if (typeof path === "string" && /^\.\.?\//.test(path)) {
    return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
      return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
    });
  }
  return path;
};
var HOT_DIR = ".dsh-market";
var HOT_MOUNT_TIMEOUT_MS = Number(process.env.DSH_MARKET_HOT_MOUNT_TIMEOUT_MS) || 1e4;
var hotTreeClass;
var shimNames = /* @__PURE__ */ new Set();
async function loadHotTreeClass() {
  if (hotTreeClass !== void 0)
    return hotTreeClass;
  try {
    const specifier = "@deepseek-ai/cordis-plugin-include";
    const mod = await import(__rewriteRelativeImportExtension(specifier));
    const Include = mod.Include;
    if (Include === void 0)
      throw new Error("no Include export");
    class MarketHotTree extends Include {
      /** Runtime-only mount list; the bundle layer owns persistence. */
      write() {
      }
      import(name2, getOuterStack) {
        if (shimNames.has(name2))
          return { name: name2, apply: () => {
          } };
        return super.import(name2, getOuterStack);
      }
    }
    hotTreeClass = MarketHotTree;
  } catch {
    hotTreeClass = null;
  }
  return hotTreeClass;
}
function readPkgDsh(profileDir2, packageName) {
  try {
    const manifest = JSON.parse(readFileSync2(join4(profileDir2, "node_modules", packageName, "package.json"), "utf8"));
    return manifest.dsh ?? {};
  } catch {
    return null;
  }
}
function parseSimplePatch(patchText) {
  const rows = [];
  let pending = null;
  for (const raw of patchText.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (line.trim() === "")
      continue;
    if (/^-\s+insert:\s*$/.test(line))
      continue;
    const id = /^\s+-\s+id:\s*(\S+)\s*$/.exec(line);
    if (id !== null) {
      if (pending !== null)
        return null;
      pending = id[1];
      continue;
    }
    const name2 = /^\s+name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (name2 !== null && pending !== null) {
      rows.push({ id: pending, name: name2[1] });
      pending = null;
      continue;
    }
    return null;
  }
  if (pending !== null || rows.length === 0)
    return null;
  return rows;
}
function cleanHotDir(profileDir2) {
  const dir = join4(profileDir2, HOT_DIR);
  let entries2;
  try {
    entries2 = readdirSync2(dir);
  } catch {
    return;
  }
  for (const name2 of entries2) {
    if (/^hot-\d+\.yml$/.test(name2))
      rmSync(join4(dir, name2), { force: true });
  }
}
function stateFile(profileDir2) {
  return join4(profileDir2, HOT_DIR, "state.json");
}
function uniqueStrings(value) {
  if (!Array.isArray(value))
    return [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const item of value) {
    if (typeof item !== "string" || item === "" || seen.has(item))
      continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
function readMarketState(profileDir2) {
  try {
    const state = JSON.parse(readFileSync2(stateFile(profileDir2), "utf8"));
    const disabled = uniqueStrings(state.disabled !== void 0 ? state.disabled : state.disabledSkins);
    const groups = {};
    if (state.groups !== null && typeof state.groups === "object" && !Array.isArray(state.groups)) {
      for (const [name2, members] of Object.entries(state.groups)) {
        groups[name2] = uniqueStrings(members);
      }
    }
    return {
      disabled: new Set(disabled),
      groups,
      groupOrder: uniqueStrings(state.groupOrder),
      channel: asChannel(state.channel) ?? void 0
    };
  } catch {
    return { disabled: /* @__PURE__ */ new Set(), groups: {}, groupOrder: [] };
  }
}
function writeMarketState(profileDir2, state) {
  mkdirSync(join4(profileDir2, HOT_DIR), { recursive: true, mode: 448 });
  writeFileSync2(stateFile(profileDir2), JSON.stringify({
    disabled: [...state.disabled],
    groups: state.groups,
    groupOrder: state.groupOrder,
    // Omitted while unchosen, so "never picked" survives a round trip and
    // keeps deriving from the running build.
    ...state.channel === void 0 ? {} : { channel: state.channel }
  }));
}
function readDisabled(profileDir2) {
  return readMarketState(profileDir2).disabled;
}
function writeDisabled(profileDir2, disabled) {
  const state = readMarketState(profileDir2);
  state.disabled = new Set(disabled);
  writeMarketState(profileDir2, state);
}
function listHotMounts() {
  return [...hotHandles.keys()];
}
var hotSequence = 0;
var hotHandles = /* @__PURE__ */ new Map();
var ActivationTimeout = class extends Error {
};
function raceActivationTimeout(awaitable) {
  return new Promise((resolve6, reject) => {
    const timer = setTimeout(() => {
      reject(new ActivationTimeout(`activation did not settle within ${HOT_MOUNT_TIMEOUT_MS / 1e3}s \u2014 the plugin may be waiting on a service that never arrives`));
    }, HOT_MOUNT_TIMEOUT_MS);
    Promise.resolve(awaitable).then((value) => {
      clearTimeout(timer);
      resolve6(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
async function hotUnmount(packageName) {
  const handle = hotHandles.get(packageName);
  if (handle === void 0)
    return false;
  hotHandles.delete(packageName);
  shimNames.delete(packageName);
  try {
    await handle.dispose();
    logEvent("info", "hot-unmount", `${packageName}: removed live`);
    return true;
  } catch (error) {
    logEvent("warn", "hot-unmount", `${packageName}: dispose failed \u2014 ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
async function hotMount(ctx, profileDir2, packageName) {
  try {
    const HotTree = await loadHotTreeClass();
    if (HotTree === null) {
      return {
        ok: false,
        reason: "\u5BBF\u4E3B\u4E0D\u652F\u6301\u70ED\u6302\u8F7D(include \u63D2\u4EF6\u4E0D\u53EF\u5BFC\u5165),\u9700\u91CD\u542F / the host cannot hot-mount (include plugin unavailable); restart required"
      };
    }
    let patchText;
    try {
      patchText = readFileSync2(join4(profileDir2, "node_modules", packageName, "cordis.patch.yml"), "utf8");
    } catch {
      patchText = null;
    }
    let rows;
    if (patchText !== null) {
      rows = parseSimplePatch(patchText);
      if (rows === null) {
        return {
          ok: false,
          reason: "bundle patch \u542B\u914D\u7F6E\u884C/\u8868\u8FBE\u5F0F,\u70ED\u6302\u8F7D\u4EC5\u652F\u6301\u7EAF insert,\u91CD\u542F\u540E\u751F\u6548 / the bundle patch contains config/expression rows; hot-mount only supports plain inserts \u2014 it activates on restart"
        };
      }
    } else {
      const dsh = readPkgDsh(profileDir2, packageName);
      if (dsh === null || dsh.client === void 0 || dsh.bundle !== void 0) {
        return {
          ok: false,
          reason: "\u8BE5\u5305\u65E0 bundle patch \u4E14\u672A\u58F0\u660E dsh.client,\u6CA1\u6709\u53EF\u70ED\u6302\u8F7D\u7684\u5185\u5BB9 / no bundle patch and no dsh.client surface \u2014 nothing to hot-mount"
        };
      }
      shimNames.add(packageName);
      rows = [{ id: `client-${packageName.replace(/[^A-Za-z0-9_.-]/g, "-")}`, name: packageName }];
    }
    const dir = join4(profileDir2, HOT_DIR);
    mkdirSync(dir, { recursive: true, mode: 448 });
    hotSequence += 1;
    const file = join4(dir, `hot-${String(hotSequence)}.yml`);
    const yml = rows.map((row) => `- id: 'mkt-${row.id}'
  name: '${row.name}'
`).join("");
    writeFileSync2(file, yml);
    const handle = ctx.plugin(HotTree, { path: pathToFileURL(file).href });
    try {
      await raceActivationTimeout(handle.await());
    } catch (error) {
      if (error instanceof ActivationTimeout) {
        try {
          Promise.resolve(handle.dispose()).catch(() => {
          });
        } catch {
        }
      }
      throw error;
    }
    hotHandles.set(packageName, handle);
    ctx.logger?.info?.(`[dsh-market] hot-mounted ${packageName}`);
    logEvent("info", "hot-mount", `${packageName}: live${shimNames.has(packageName) ? " (client-only shim)" : ""}`);
    return { ok: true, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.logger?.warn(`[dsh-market] hot mount of ${packageName} failed, restart required: ${message}`);
    logEvent("warn", "hot-mount", `${packageName}: fell back to restart \u2014 ${message}`);
    return { ok: false, reason: `\u70ED\u6302\u8F7D\u5931\u8D25,\u91CD\u542F\u540E\u751F\u6548 \u2014 ${message} / hot-mount failed \u2014 restart required: ${message}` };
  }
}
async function mountClientOnlyDeps(ctx, profileDir2) {
  let deps;
  try {
    const manifest = JSON.parse(readFileSync2(join4(profileDir2, "package.json"), "utf8"));
    const bundles = new Set(manifest.dsh?.profile?.bundles ?? []);
    deps = Object.keys(manifest.dependencies ?? {}).filter((name2) => !bundles.has(name2));
  } catch {
    return [];
  }
  const disabled = readDisabled(profileDir2);
  const userManaged = readUserPatchControls(profileDir2);
  const mounted = [];
  for (const name2 of deps) {
    if (hotHandles.has(name2) || disabled.has(name2))
      continue;
    if (patchLayerManages(userManaged, name2))
      continue;
    const dsh = readPkgDsh(profileDir2, name2);
    if (dsh === null || dsh.client === void 0 || dsh.bundle !== void 0)
      continue;
    if ((await hotMount(ctx, profileDir2, name2)).ok)
      mounted.push(name2);
  }
  return mounted;
}
function readUserPatchControls(profileDir2) {
  const ids = /* @__PURE__ */ new Set();
  const names = /* @__PURE__ */ new Set();
  try {
    const text = readFileSync2(join4(profileDir2, "cordis.patch.yml"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const id = /^\s*-?\s*id:\s*['"]?([A-Za-z0-9._/@-]+)/.exec(line);
      if (id !== null)
        ids.add(id[1]);
      const name2 = /^\s*name:\s*['"]?([^'"\s]+)/.exec(line);
      if (name2 !== null)
        names.add(name2[1]);
    }
  } catch {
  }
  return { ids, names };
}
function patchLayerManages(controls, name2) {
  const rowId = name2.replace(/^@/, "").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return controls.ids.has(rowId) || controls.names.has(name2);
}
function purgeMarketState(profileDir2) {
  const dir = join4(profileDir2, HOT_DIR);
  try {
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// src-tauri/resources/dsh-market/src/host/groups.js
var GROUP_NAME_RE = /^[\p{L}\p{N}_ -]{1,40}$/u;
function isGroupName(value) {
  return typeof value === "string" && GROUP_NAME_RE.test(value);
}
function createGroup(state, name2) {
  if (!isGroupName(name2))
    return { ok: false, error: "invalid group name / \u5206\u7EC4\u540D\u79F0\u65E0\u6548" };
  if (state.groups[name2] !== void 0)
    return { ok: false, error: "group already exists / \u5206\u7EC4\u5DF2\u5B58\u5728" };
  state.groups[name2] = [];
  state.groupOrder.push(name2);
  return { ok: true };
}
function renameGroup(state, name2, newName) {
  if (typeof name2 !== "string" || state.groups[name2] === void 0) {
    return { ok: false, error: "group not found / \u5206\u7EC4\u4E0D\u5B58\u5728" };
  }
  if (!isGroupName(newName))
    return { ok: false, error: "invalid group name / \u5206\u7EC4\u540D\u79F0\u65E0\u6548" };
  if (newName !== name2 && state.groups[newName] !== void 0) {
    return { ok: false, error: "group already exists / \u5206\u7EC4\u5DF2\u5B58\u5728" };
  }
  const members = state.groups[name2];
  delete state.groups[name2];
  state.groups[newName] = members;
  const index = state.groupOrder.indexOf(name2);
  if (index !== -1)
    state.groupOrder[index] = newName;
  return { ok: true };
}
function deleteGroup(state, name2) {
  if (typeof name2 !== "string" || state.groups[name2] === void 0) {
    return { ok: false, error: "group not found / \u5206\u7EC4\u4E0D\u5B58\u5728" };
  }
  delete state.groups[name2];
  const index = state.groupOrder.indexOf(name2);
  if (index !== -1)
    state.groupOrder.splice(index, 1);
  return { ok: true };
}
function setGroupMembers(state, name2, members, installed, themes) {
  if (typeof name2 !== "string" || state.groups[name2] === void 0) {
    return { ok: false, error: "group not found / \u5206\u7EC4\u4E0D\u5B58\u5728" };
  }
  if (!Array.isArray(members))
    return { ok: false, error: "members must be an array / \u6210\u5458\u5FC5\u987B\u662F\u6570\u7EC4" };
  const kept = [];
  const seen = /* @__PURE__ */ new Set();
  for (const member of members) {
    if (typeof member !== "string" || member === "" || seen.has(member))
      continue;
    if (member === "dsh-market" || member === "dshmarket")
      continue;
    seen.add(member);
    if (installed.has(member))
      kept.push(member);
  }
  let themeCount = 0;
  for (const member of kept)
    if (themes.has(member))
      themeCount += 1;
  if (themeCount > 1) {
    return { ok: false, error: "a group can contain at most one theme / \u6BCF\u7EC4\u6700\u591A\u4E00\u4E2A\u4E3B\u9898" };
  }
  state.groups[name2] = kept;
  return { ok: true };
}
function removeFromGroups(state, name2) {
  for (const group of Object.keys(state.groups)) {
    const members = state.groups[group];
    if (members.includes(name2))
      state.groups[group] = members.filter((member) => member !== name2);
  }
}

// src-tauri/resources/dsh-market/src/host/diagnostics.js
var DIAGNOSTIC_SCHEMA = "dsh-market/diagnostics/v1";
var KNOWN_SHARED_HOST_PACKAGES = [
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-attachment",
  "@deepseek-ai/dsh-llm",
  "@deepseek-ai/dsh-system-prompt",
  "@deepseek-ai/dsh-tools"
];
var knownSharedHostPackages = new Set(KNOWN_SHARED_HOST_PACKAGES);
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function inspectKnownHostDependencyDeclarations(packageName, manifest) {
  if (!isRecord(manifest) || !isRecord(manifest.dependencies))
    return [];
  const findings = [];
  for (const dependency of Object.keys(manifest.dependencies).sort()) {
    const declaredRange = manifest.dependencies[dependency];
    if (!knownSharedHostPackages.has(dependency) || typeof declaredRange !== "string")
      continue;
    findings.push({
      code: "shared-host-package-dependency",
      severity: "warning",
      subject: { kind: "package", name: packageName },
      evidence: {
        basis: "manifest-declaration",
        dependency,
        declaredRange,
        declaredIn: "dependencies"
      }
    });
  }
  return findings;
}
function diagnosePackageManifests(packages) {
  const sortedPackages = [...packages].sort((a, b) => a.packageName < b.packageName ? -1 : a.packageName > b.packageName ? 1 : 0);
  return {
    schema: DIAGNOSTIC_SCHEMA,
    findings: sortedPackages.flatMap(({ packageName, manifest }) => {
      if (!isRecord(manifest) || manifest.dsh === void 0)
        return [];
      return inspectKnownHostDependencyDeclarations(packageName, manifest);
    })
  };
}

// src-tauri/resources/dsh-market/src/host/check.js
import { existsSync as existsSync5, readdirSync as readdirSync3, readFileSync as readFileSync4 } from "node:fs";
import { createRequire as createRequire2 } from "node:module";
import { homedir as homedir4 } from "node:os";
import { dirname as dirname4, join as join6, resolve as resolve4 } from "node:path";

// src-tauri/resources/dsh-market/script-deps/js-yaml.mjs
/*! js-yaml 4.1.0 https://github.com/nodeca/js-yaml @license MIT */
function isNothing(subject) {
  return typeof subject === "undefined" || subject === null;
}
function isObject(subject) {
  return typeof subject === "object" && subject !== null;
}
function toArray(sequence) {
  if (Array.isArray(sequence)) return sequence;
  else if (isNothing(sequence)) return [];
  return [sequence];
}
function extend(target, source) {
  var index, length, key, sourceKeys;
  if (source) {
    sourceKeys = Object.keys(source);
    for (index = 0, length = sourceKeys.length; index < length; index += 1) {
      key = sourceKeys[index];
      target[key] = source[key];
    }
  }
  return target;
}
function repeat(string, count) {
  var result = "", cycle;
  for (cycle = 0; cycle < count; cycle += 1) {
    result += string;
  }
  return result;
}
function isNegativeZero(number) {
  return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
}
var isNothing_1 = isNothing;
var isObject_1 = isObject;
var toArray_1 = toArray;
var repeat_1 = repeat;
var isNegativeZero_1 = isNegativeZero;
var extend_1 = extend;
var common = {
  isNothing: isNothing_1,
  isObject: isObject_1,
  toArray: toArray_1,
  repeat: repeat_1,
  isNegativeZero: isNegativeZero_1,
  extend: extend_1
};
function formatError(exception2, compact) {
  var where = "", message = exception2.reason || "(unknown reason)";
  if (!exception2.mark) return message;
  if (exception2.mark.name) {
    where += 'in "' + exception2.mark.name + '" ';
  }
  where += "(" + (exception2.mark.line + 1) + ":" + (exception2.mark.column + 1) + ")";
  if (!compact && exception2.mark.snippet) {
    where += "\n\n" + exception2.mark.snippet;
  }
  return message + " " + where;
}
function YAMLException$1(reason, mark) {
  Error.call(this);
  this.name = "YAMLException";
  this.reason = reason;
  this.mark = mark;
  this.message = formatError(this, false);
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor);
  } else {
    this.stack = new Error().stack || "";
  }
}
YAMLException$1.prototype = Object.create(Error.prototype);
YAMLException$1.prototype.constructor = YAMLException$1;
YAMLException$1.prototype.toString = function toString(compact) {
  return this.name + ": " + formatError(this, compact);
};
var exception = YAMLException$1;
function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
  var head = "";
  var tail = "";
  var maxHalfLength = Math.floor(maxLineLength / 2) - 1;
  if (position - lineStart > maxHalfLength) {
    head = " ... ";
    lineStart = position - maxHalfLength + head.length;
  }
  if (lineEnd - position > maxHalfLength) {
    tail = " ...";
    lineEnd = position + maxHalfLength - tail.length;
  }
  return {
    str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
    pos: position - lineStart + head.length
    // relative position
  };
}
function padStart(string, max) {
  return common.repeat(" ", max - string.length) + string;
}
function makeSnippet(mark, options) {
  options = Object.create(options || null);
  if (!mark.buffer) return null;
  if (!options.maxLength) options.maxLength = 79;
  if (typeof options.indent !== "number") options.indent = 1;
  if (typeof options.linesBefore !== "number") options.linesBefore = 3;
  if (typeof options.linesAfter !== "number") options.linesAfter = 2;
  var re = /\r?\n|\r|\0/g;
  var lineStarts = [0];
  var lineEnds = [];
  var match;
  var foundLineNo = -1;
  while (match = re.exec(mark.buffer)) {
    lineEnds.push(match.index);
    lineStarts.push(match.index + match[0].length);
    if (mark.position <= match.index && foundLineNo < 0) {
      foundLineNo = lineStarts.length - 2;
    }
  }
  if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
  var result = "", i, line;
  var lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
  var maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
  for (i = 1; i <= options.linesBefore; i++) {
    if (foundLineNo - i < 0) break;
    line = getLine(
      mark.buffer,
      lineStarts[foundLineNo - i],
      lineEnds[foundLineNo - i],
      mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]),
      maxLineLength
    );
    result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line.str + "\n" + result;
  }
  line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
  result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
  result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
  for (i = 1; i <= options.linesAfter; i++) {
    if (foundLineNo + i >= lineEnds.length) break;
    line = getLine(
      mark.buffer,
      lineStarts[foundLineNo + i],
      lineEnds[foundLineNo + i],
      mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]),
      maxLineLength
    );
    result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line.str + "\n";
  }
  return result.replace(/\n$/, "");
}
var snippet = makeSnippet;
var TYPE_CONSTRUCTOR_OPTIONS = [
  "kind",
  "multi",
  "resolve",
  "construct",
  "instanceOf",
  "predicate",
  "represent",
  "representName",
  "defaultStyle",
  "styleAliases"
];
var YAML_NODE_KINDS = [
  "scalar",
  "sequence",
  "mapping"
];
function compileStyleAliases(map2) {
  var result = {};
  if (map2 !== null) {
    Object.keys(map2).forEach(function(style) {
      map2[style].forEach(function(alias) {
        result[String(alias)] = style;
      });
    });
  }
  return result;
}
function Type$1(tag, options) {
  options = options || {};
  Object.keys(options).forEach(function(name2) {
    if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name2) === -1) {
      throw new exception('Unknown option "' + name2 + '" is met in definition of "' + tag + '" YAML type.');
    }
  });
  this.options = options;
  this.tag = tag;
  this.kind = options["kind"] || null;
  this.resolve = options["resolve"] || function() {
    return true;
  };
  this.construct = options["construct"] || function(data) {
    return data;
  };
  this.instanceOf = options["instanceOf"] || null;
  this.predicate = options["predicate"] || null;
  this.represent = options["represent"] || null;
  this.representName = options["representName"] || null;
  this.defaultStyle = options["defaultStyle"] || null;
  this.multi = options["multi"] || false;
  this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
  if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
    throw new exception('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
  }
}
var type = Type$1;
function compileList(schema2, name2) {
  var result = [];
  schema2[name2].forEach(function(currentType) {
    var newIndex = result.length;
    result.forEach(function(previousType, previousIndex) {
      if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
        newIndex = previousIndex;
      }
    });
    result[newIndex] = currentType;
  });
  return result;
}
function compileMap() {
  var result = {
    scalar: {},
    sequence: {},
    mapping: {},
    fallback: {},
    multi: {
      scalar: [],
      sequence: [],
      mapping: [],
      fallback: []
    }
  }, index, length;
  function collectType(type2) {
    if (type2.multi) {
      result.multi[type2.kind].push(type2);
      result.multi["fallback"].push(type2);
    } else {
      result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
    }
  }
  for (index = 0, length = arguments.length; index < length; index += 1) {
    arguments[index].forEach(collectType);
  }
  return result;
}
function Schema$1(definition) {
  return this.extend(definition);
}
Schema$1.prototype.extend = function extend2(definition) {
  var implicit = [];
  var explicit = [];
  if (definition instanceof type) {
    explicit.push(definition);
  } else if (Array.isArray(definition)) {
    explicit = explicit.concat(definition);
  } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
    if (definition.implicit) implicit = implicit.concat(definition.implicit);
    if (definition.explicit) explicit = explicit.concat(definition.explicit);
  } else {
    throw new exception("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
  }
  implicit.forEach(function(type$1) {
    if (!(type$1 instanceof type)) {
      throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    }
    if (type$1.loadKind && type$1.loadKind !== "scalar") {
      throw new exception("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
    }
    if (type$1.multi) {
      throw new exception("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
    }
  });
  explicit.forEach(function(type$1) {
    if (!(type$1 instanceof type)) {
      throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    }
  });
  var result = Object.create(Schema$1.prototype);
  result.implicit = (this.implicit || []).concat(implicit);
  result.explicit = (this.explicit || []).concat(explicit);
  result.compiledImplicit = compileList(result, "implicit");
  result.compiledExplicit = compileList(result, "explicit");
  result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
  return result;
};
var schema = Schema$1;
var str = new type("tag:yaml.org,2002:str", {
  kind: "scalar",
  construct: function(data) {
    return data !== null ? data : "";
  }
});
var seq = new type("tag:yaml.org,2002:seq", {
  kind: "sequence",
  construct: function(data) {
    return data !== null ? data : [];
  }
});
var map = new type("tag:yaml.org,2002:map", {
  kind: "mapping",
  construct: function(data) {
    return data !== null ? data : {};
  }
});
var failsafe = new schema({
  explicit: [
    str,
    seq,
    map
  ]
});
function resolveYamlNull(data) {
  if (data === null) return true;
  var max = data.length;
  return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
}
function constructYamlNull() {
  return null;
}
function isNull(object) {
  return object === null;
}
var _null = new type("tag:yaml.org,2002:null", {
  kind: "scalar",
  resolve: resolveYamlNull,
  construct: constructYamlNull,
  predicate: isNull,
  represent: {
    canonical: function() {
      return "~";
    },
    lowercase: function() {
      return "null";
    },
    uppercase: function() {
      return "NULL";
    },
    camelcase: function() {
      return "Null";
    },
    empty: function() {
      return "";
    }
  },
  defaultStyle: "lowercase"
});
function resolveYamlBoolean(data) {
  if (data === null) return false;
  var max = data.length;
  return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
}
function constructYamlBoolean(data) {
  return data === "true" || data === "True" || data === "TRUE";
}
function isBoolean(object) {
  return Object.prototype.toString.call(object) === "[object Boolean]";
}
var bool = new type("tag:yaml.org,2002:bool", {
  kind: "scalar",
  resolve: resolveYamlBoolean,
  construct: constructYamlBoolean,
  predicate: isBoolean,
  represent: {
    lowercase: function(object) {
      return object ? "true" : "false";
    },
    uppercase: function(object) {
      return object ? "TRUE" : "FALSE";
    },
    camelcase: function(object) {
      return object ? "True" : "False";
    }
  },
  defaultStyle: "lowercase"
});
function isHexCode(c) {
  return 48 <= c && c <= 57 || 65 <= c && c <= 70 || 97 <= c && c <= 102;
}
function isOctCode(c) {
  return 48 <= c && c <= 55;
}
function isDecCode(c) {
  return 48 <= c && c <= 57;
}
function resolveYamlInteger(data) {
  if (data === null) return false;
  var max = data.length, index = 0, hasDigits = false, ch;
  if (!max) return false;
  ch = data[index];
  if (ch === "-" || ch === "+") {
    ch = data[++index];
  }
  if (ch === "0") {
    if (index + 1 === max) return true;
    ch = data[++index];
    if (ch === "b") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (ch !== "0" && ch !== "1") return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "x") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (!isHexCode(data.charCodeAt(index))) return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "o") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (!isOctCode(data.charCodeAt(index))) return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
  }
  if (ch === "_") return false;
  for (; index < max; index++) {
    ch = data[index];
    if (ch === "_") continue;
    if (!isDecCode(data.charCodeAt(index))) {
      return false;
    }
    hasDigits = true;
  }
  if (!hasDigits || ch === "_") return false;
  return true;
}
function constructYamlInteger(data) {
  var value = data, sign = 1, ch;
  if (value.indexOf("_") !== -1) {
    value = value.replace(/_/g, "");
  }
  ch = value[0];
  if (ch === "-" || ch === "+") {
    if (ch === "-") sign = -1;
    value = value.slice(1);
    ch = value[0];
  }
  if (value === "0") return 0;
  if (ch === "0") {
    if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
    if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
    if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
  }
  return sign * parseInt(value, 10);
}
function isInteger(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common.isNegativeZero(object));
}
var int = new type("tag:yaml.org,2002:int", {
  kind: "scalar",
  resolve: resolveYamlInteger,
  construct: constructYamlInteger,
  predicate: isInteger,
  represent: {
    binary: function(obj) {
      return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
    },
    octal: function(obj) {
      return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
    },
    decimal: function(obj) {
      return obj.toString(10);
    },
    /* eslint-disable max-len */
    hexadecimal: function(obj) {
      return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
    }
  },
  defaultStyle: "decimal",
  styleAliases: {
    binary: [2, "bin"],
    octal: [8, "oct"],
    decimal: [10, "dec"],
    hexadecimal: [16, "hex"]
  }
});
var YAML_FLOAT_PATTERN = new RegExp(
  // 2.5e4, 2.5 and integers
  "^(?:[-+]?(?:[0-9][0-9_]*)(?:\\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
);
function resolveYamlFloat(data) {
  if (data === null) return false;
  if (!YAML_FLOAT_PATTERN.test(data) || // Quick hack to not allow integers end with `_`
  // Probably should update regexp & check speed
  data[data.length - 1] === "_") {
    return false;
  }
  return true;
}
function constructYamlFloat(data) {
  var value, sign;
  value = data.replace(/_/g, "").toLowerCase();
  sign = value[0] === "-" ? -1 : 1;
  if ("+-".indexOf(value[0]) >= 0) {
    value = value.slice(1);
  }
  if (value === ".inf") {
    return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  } else if (value === ".nan") {
    return NaN;
  }
  return sign * parseFloat(value, 10);
}
var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
function representYamlFloat(object, style) {
  var res;
  if (isNaN(object)) {
    switch (style) {
      case "lowercase":
        return ".nan";
      case "uppercase":
        return ".NAN";
      case "camelcase":
        return ".NaN";
    }
  } else if (Number.POSITIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return ".inf";
      case "uppercase":
        return ".INF";
      case "camelcase":
        return ".Inf";
    }
  } else if (Number.NEGATIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return "-.inf";
      case "uppercase":
        return "-.INF";
      case "camelcase":
        return "-.Inf";
    }
  } else if (common.isNegativeZero(object)) {
    return "-0.0";
  }
  res = object.toString(10);
  return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
}
function isFloat(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
}
var float = new type("tag:yaml.org,2002:float", {
  kind: "scalar",
  resolve: resolveYamlFloat,
  construct: constructYamlFloat,
  predicate: isFloat,
  represent: representYamlFloat,
  defaultStyle: "lowercase"
});
var json = failsafe.extend({
  implicit: [
    _null,
    bool,
    int,
    float
  ]
});
var core = json;
var YAML_DATE_REGEXP = new RegExp(
  "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
);
var YAML_TIMESTAMP_REGEXP = new RegExp(
  "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
);
function resolveYamlTimestamp(data) {
  if (data === null) return false;
  if (YAML_DATE_REGEXP.exec(data) !== null) return true;
  if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
  return false;
}
function constructYamlTimestamp(data) {
  var match, year, month, day, hour, minute, second, fraction = 0, delta = null, tz_hour, tz_minute, date;
  match = YAML_DATE_REGEXP.exec(data);
  if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
  if (match === null) throw new Error("Date resolve error");
  year = +match[1];
  month = +match[2] - 1;
  day = +match[3];
  if (!match[4]) {
    return new Date(Date.UTC(year, month, day));
  }
  hour = +match[4];
  minute = +match[5];
  second = +match[6];
  if (match[7]) {
    fraction = match[7].slice(0, 3);
    while (fraction.length < 3) {
      fraction += "0";
    }
    fraction = +fraction;
  }
  if (match[9]) {
    tz_hour = +match[10];
    tz_minute = +(match[11] || 0);
    delta = (tz_hour * 60 + tz_minute) * 6e4;
    if (match[9] === "-") delta = -delta;
  }
  date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
  if (delta) date.setTime(date.getTime() - delta);
  return date;
}
function representYamlTimestamp(object) {
  return object.toISOString();
}
var timestamp = new type("tag:yaml.org,2002:timestamp", {
  kind: "scalar",
  resolve: resolveYamlTimestamp,
  construct: constructYamlTimestamp,
  instanceOf: Date,
  represent: representYamlTimestamp
});
function resolveYamlMerge(data) {
  return data === "<<" || data === null;
}
var merge = new type("tag:yaml.org,2002:merge", {
  kind: "scalar",
  resolve: resolveYamlMerge
});
var BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
function resolveYamlBinary(data) {
  if (data === null) return false;
  var code, idx, bitlen = 0, max = data.length, map2 = BASE64_MAP;
  for (idx = 0; idx < max; idx++) {
    code = map2.indexOf(data.charAt(idx));
    if (code > 64) continue;
    if (code < 0) return false;
    bitlen += 6;
  }
  return bitlen % 8 === 0;
}
function constructYamlBinary(data) {
  var idx, tailbits, input = data.replace(/[\r\n=]/g, ""), max = input.length, map2 = BASE64_MAP, bits = 0, result = [];
  for (idx = 0; idx < max; idx++) {
    if (idx % 4 === 0 && idx) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    }
    bits = bits << 6 | map2.indexOf(input.charAt(idx));
  }
  tailbits = max % 4 * 6;
  if (tailbits === 0) {
    result.push(bits >> 16 & 255);
    result.push(bits >> 8 & 255);
    result.push(bits & 255);
  } else if (tailbits === 18) {
    result.push(bits >> 10 & 255);
    result.push(bits >> 2 & 255);
  } else if (tailbits === 12) {
    result.push(bits >> 4 & 255);
  }
  return new Uint8Array(result);
}
function representYamlBinary(object) {
  var result = "", bits = 0, idx, tail, max = object.length, map2 = BASE64_MAP;
  for (idx = 0; idx < max; idx++) {
    if (idx % 3 === 0 && idx) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    }
    bits = (bits << 8) + object[idx];
  }
  tail = max % 3;
  if (tail === 0) {
    result += map2[bits >> 18 & 63];
    result += map2[bits >> 12 & 63];
    result += map2[bits >> 6 & 63];
    result += map2[bits & 63];
  } else if (tail === 2) {
    result += map2[bits >> 10 & 63];
    result += map2[bits >> 4 & 63];
    result += map2[bits << 2 & 63];
    result += map2[64];
  } else if (tail === 1) {
    result += map2[bits >> 2 & 63];
    result += map2[bits << 4 & 63];
    result += map2[64];
    result += map2[64];
  }
  return result;
}
function isBinary(obj) {
  return Object.prototype.toString.call(obj) === "[object Uint8Array]";
}
var binary = new type("tag:yaml.org,2002:binary", {
  kind: "scalar",
  resolve: resolveYamlBinary,
  construct: constructYamlBinary,
  predicate: isBinary,
  represent: representYamlBinary
});
var _hasOwnProperty$3 = Object.prototype.hasOwnProperty;
var _toString$2 = Object.prototype.toString;
function resolveYamlOmap(data) {
  if (data === null) return true;
  var objectKeys = [], index, length, pair, pairKey, pairHasKey, object = data;
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    pairHasKey = false;
    if (_toString$2.call(pair) !== "[object Object]") return false;
    for (pairKey in pair) {
      if (_hasOwnProperty$3.call(pair, pairKey)) {
        if (!pairHasKey) pairHasKey = true;
        else return false;
      }
    }
    if (!pairHasKey) return false;
    if (objectKeys.indexOf(pairKey) === -1) objectKeys.push(pairKey);
    else return false;
  }
  return true;
}
function constructYamlOmap(data) {
  return data !== null ? data : [];
}
var omap = new type("tag:yaml.org,2002:omap", {
  kind: "sequence",
  resolve: resolveYamlOmap,
  construct: constructYamlOmap
});
var _toString$1 = Object.prototype.toString;
function resolveYamlPairs(data) {
  if (data === null) return true;
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    if (_toString$1.call(pair) !== "[object Object]") return false;
    keys = Object.keys(pair);
    if (keys.length !== 1) return false;
    result[index] = [keys[0], pair[keys[0]]];
  }
  return true;
}
function constructYamlPairs(data) {
  if (data === null) return [];
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    keys = Object.keys(pair);
    result[index] = [keys[0], pair[keys[0]]];
  }
  return result;
}
var pairs = new type("tag:yaml.org,2002:pairs", {
  kind: "sequence",
  resolve: resolveYamlPairs,
  construct: constructYamlPairs
});
var _hasOwnProperty$2 = Object.prototype.hasOwnProperty;
function resolveYamlSet(data) {
  if (data === null) return true;
  var key, object = data;
  for (key in object) {
    if (_hasOwnProperty$2.call(object, key)) {
      if (object[key] !== null) return false;
    }
  }
  return true;
}
function constructYamlSet(data) {
  return data !== null ? data : {};
}
var set = new type("tag:yaml.org,2002:set", {
  kind: "mapping",
  resolve: resolveYamlSet,
  construct: constructYamlSet
});
var _default = core.extend({
  implicit: [
    timestamp,
    merge
  ],
  explicit: [
    binary,
    omap,
    pairs,
    set
  ]
});
var _hasOwnProperty$1 = Object.prototype.hasOwnProperty;
var CONTEXT_FLOW_IN = 1;
var CONTEXT_FLOW_OUT = 2;
var CONTEXT_BLOCK_IN = 3;
var CONTEXT_BLOCK_OUT = 4;
var CHOMPING_CLIP = 1;
var CHOMPING_STRIP = 2;
var CHOMPING_KEEP = 3;
var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
var PATTERN_FLOW_INDICATORS = /[,\[\]\{\}]/;
var PATTERN_TAG_HANDLE = /^(?:!|!!|![a-z\-]+!)$/i;
var PATTERN_TAG_URI = /^(?:!|[^,\[\]\{\}])(?:%[0-9a-f]{2}|[0-9a-z\-#;\/\?:@&=\+\$,_\.!~\*'\(\)\[\]])*$/i;
function _class(obj) {
  return Object.prototype.toString.call(obj);
}
function is_EOL(c) {
  return c === 10 || c === 13;
}
function is_WHITE_SPACE(c) {
  return c === 9 || c === 32;
}
function is_WS_OR_EOL(c) {
  return c === 9 || c === 32 || c === 10 || c === 13;
}
function is_FLOW_INDICATOR(c) {
  return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
}
function fromHexCode(c) {
  var lc;
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  lc = c | 32;
  if (97 <= lc && lc <= 102) {
    return lc - 97 + 10;
  }
  return -1;
}
function escapedHexLen(c) {
  if (c === 120) {
    return 2;
  }
  if (c === 117) {
    return 4;
  }
  if (c === 85) {
    return 8;
  }
  return 0;
}
function fromDecimalCode(c) {
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  return -1;
}
function simpleEscapeSequence(c) {
  return c === 48 ? "\0" : c === 97 ? "\x07" : c === 98 ? "\b" : c === 116 ? "	" : c === 9 ? "	" : c === 110 ? "\n" : c === 118 ? "\v" : c === 102 ? "\f" : c === 114 ? "\r" : c === 101 ? "\x1B" : c === 32 ? " " : c === 34 ? '"' : c === 47 ? "/" : c === 92 ? "\\" : c === 78 ? "\x85" : c === 95 ? "\xA0" : c === 76 ? "\u2028" : c === 80 ? "\u2029" : "";
}
function charFromCodepoint(c) {
  if (c <= 65535) {
    return String.fromCharCode(c);
  }
  return String.fromCharCode(
    (c - 65536 >> 10) + 55296,
    (c - 65536 & 1023) + 56320
  );
}
var simpleEscapeCheck = new Array(256);
var simpleEscapeMap = new Array(256);
for (i = 0; i < 256; i++) {
  simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
  simpleEscapeMap[i] = simpleEscapeSequence(i);
}
var i;
function State$1(input, options) {
  this.input = input;
  this.filename = options["filename"] || null;
  this.schema = options["schema"] || _default;
  this.onWarning = options["onWarning"] || null;
  this.legacy = options["legacy"] || false;
  this.json = options["json"] || false;
  this.listener = options["listener"] || null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.typeMap = this.schema.compiledTypeMap;
  this.length = input.length;
  this.position = 0;
  this.line = 0;
  this.lineStart = 0;
  this.lineIndent = 0;
  this.firstTabInLine = -1;
  this.documents = [];
}
function generateError(state, message) {
  var mark = {
    name: state.filename,
    buffer: state.input.slice(0, -1),
    // omit trailing \0
    position: state.position,
    line: state.line,
    column: state.position - state.lineStart
  };
  mark.snippet = snippet(mark);
  return new exception(message, mark);
}
function throwError(state, message) {
  throw generateError(state, message);
}
function throwWarning(state, message) {
  if (state.onWarning) {
    state.onWarning.call(null, generateError(state, message));
  }
}
var directiveHandlers = {
  YAML: function handleYamlDirective(state, name2, args) {
    var match, major, minor;
    if (state.version !== null) {
      throwError(state, "duplication of %YAML directive");
    }
    if (args.length !== 1) {
      throwError(state, "YAML directive accepts exactly one argument");
    }
    match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
    if (match === null) {
      throwError(state, "ill-formed argument of the YAML directive");
    }
    major = parseInt(match[1], 10);
    minor = parseInt(match[2], 10);
    if (major !== 1) {
      throwError(state, "unacceptable YAML version of the document");
    }
    state.version = args[0];
    state.checkLineBreaks = minor < 2;
    if (minor !== 1 && minor !== 2) {
      throwWarning(state, "unsupported YAML version of the document");
    }
  },
  TAG: function handleTagDirective(state, name2, args) {
    var handle, prefix;
    if (args.length !== 2) {
      throwError(state, "TAG directive accepts exactly two arguments");
    }
    handle = args[0];
    prefix = args[1];
    if (!PATTERN_TAG_HANDLE.test(handle)) {
      throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
    }
    if (_hasOwnProperty$1.call(state.tagMap, handle)) {
      throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
    }
    if (!PATTERN_TAG_URI.test(prefix)) {
      throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
    }
    try {
      prefix = decodeURIComponent(prefix);
    } catch (err) {
      throwError(state, "tag prefix is malformed: " + prefix);
    }
    state.tagMap[handle] = prefix;
  }
};
function captureSegment(state, start, end, checkJson) {
  var _position, _length, _character, _result;
  if (start < end) {
    _result = state.input.slice(start, end);
    if (checkJson) {
      for (_position = 0, _length = _result.length; _position < _length; _position += 1) {
        _character = _result.charCodeAt(_position);
        if (!(_character === 9 || 32 <= _character && _character <= 1114111)) {
          throwError(state, "expected valid JSON character");
        }
      }
    } else if (PATTERN_NON_PRINTABLE.test(_result)) {
      throwError(state, "the stream contains non-printable characters");
    }
    state.result += _result;
  }
}
function mergeMappings(state, destination, source, overridableKeys) {
  var sourceKeys, key, index, quantity;
  if (!common.isObject(source)) {
    throwError(state, "cannot merge mappings; the provided source object is unacceptable");
  }
  sourceKeys = Object.keys(source);
  for (index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
    key = sourceKeys[index];
    if (!_hasOwnProperty$1.call(destination, key)) {
      destination[key] = source[key];
      overridableKeys[key] = true;
    }
  }
}
function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
  var index, quantity;
  if (Array.isArray(keyNode)) {
    keyNode = Array.prototype.slice.call(keyNode);
    for (index = 0, quantity = keyNode.length; index < quantity; index += 1) {
      if (Array.isArray(keyNode[index])) {
        throwError(state, "nested arrays are not supported inside keys");
      }
      if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
        keyNode[index] = "[object Object]";
      }
    }
  }
  if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
    keyNode = "[object Object]";
  }
  keyNode = String(keyNode);
  if (_result === null) {
    _result = {};
  }
  if (keyTag === "tag:yaml.org,2002:merge") {
    if (Array.isArray(valueNode)) {
      for (index = 0, quantity = valueNode.length; index < quantity; index += 1) {
        mergeMappings(state, _result, valueNode[index], overridableKeys);
      }
    } else {
      mergeMappings(state, _result, valueNode, overridableKeys);
    }
  } else {
    if (!state.json && !_hasOwnProperty$1.call(overridableKeys, keyNode) && _hasOwnProperty$1.call(_result, keyNode)) {
      state.line = startLine || state.line;
      state.lineStart = startLineStart || state.lineStart;
      state.position = startPos || state.position;
      throwError(state, "duplicated mapping key");
    }
    if (keyNode === "__proto__") {
      Object.defineProperty(_result, keyNode, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: valueNode
      });
    } else {
      _result[keyNode] = valueNode;
    }
    delete overridableKeys[keyNode];
  }
  return _result;
}
function readLineBreak(state) {
  var ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 10) {
    state.position++;
  } else if (ch === 13) {
    state.position++;
    if (state.input.charCodeAt(state.position) === 10) {
      state.position++;
    }
  } else {
    throwError(state, "a line break is expected");
  }
  state.line += 1;
  state.lineStart = state.position;
  state.firstTabInLine = -1;
}
function skipSeparationSpace(state, allowComments, checkIndent) {
  var lineBreaks = 0, ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    while (is_WHITE_SPACE(ch)) {
      if (ch === 9 && state.firstTabInLine === -1) {
        state.firstTabInLine = state.position;
      }
      ch = state.input.charCodeAt(++state.position);
    }
    if (allowComments && ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (ch !== 10 && ch !== 13 && ch !== 0);
    }
    if (is_EOL(ch)) {
      readLineBreak(state);
      ch = state.input.charCodeAt(state.position);
      lineBreaks++;
      state.lineIndent = 0;
      while (ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
    } else {
      break;
    }
  }
  if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
    throwWarning(state, "deficient indentation");
  }
  return lineBreaks;
}
function testDocumentSeparator(state) {
  var _position = state.position, ch;
  ch = state.input.charCodeAt(_position);
  if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
    _position += 3;
    ch = state.input.charCodeAt(_position);
    if (ch === 0 || is_WS_OR_EOL(ch)) {
      return true;
    }
  }
  return false;
}
function writeFoldedLines(state, count) {
  if (count === 1) {
    state.result += " ";
  } else if (count > 1) {
    state.result += common.repeat("\n", count - 1);
  }
}
function readPlainScalar(state, nodeIndent, withinFlowCollection) {
  var preceding, following, captureStart, captureEnd, hasPendingContent, _line, _lineStart, _lineIndent, _kind = state.kind, _result = state.result, ch;
  ch = state.input.charCodeAt(state.position);
  if (is_WS_OR_EOL(ch) || is_FLOW_INDICATOR(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
    return false;
  }
  if (ch === 63 || ch === 45) {
    following = state.input.charCodeAt(state.position + 1);
    if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
      return false;
    }
  }
  state.kind = "scalar";
  state.result = "";
  captureStart = captureEnd = state.position;
  hasPendingContent = false;
  while (ch !== 0) {
    if (ch === 58) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
        break;
      }
    } else if (ch === 35) {
      preceding = state.input.charCodeAt(state.position - 1);
      if (is_WS_OR_EOL(preceding)) {
        break;
      }
    } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && is_FLOW_INDICATOR(ch)) {
      break;
    } else if (is_EOL(ch)) {
      _line = state.line;
      _lineStart = state.lineStart;
      _lineIndent = state.lineIndent;
      skipSeparationSpace(state, false, -1);
      if (state.lineIndent >= nodeIndent) {
        hasPendingContent = true;
        ch = state.input.charCodeAt(state.position);
        continue;
      } else {
        state.position = captureEnd;
        state.line = _line;
        state.lineStart = _lineStart;
        state.lineIndent = _lineIndent;
        break;
      }
    }
    if (hasPendingContent) {
      captureSegment(state, captureStart, captureEnd, false);
      writeFoldedLines(state, state.line - _line);
      captureStart = captureEnd = state.position;
      hasPendingContent = false;
    }
    if (!is_WHITE_SPACE(ch)) {
      captureEnd = state.position + 1;
    }
    ch = state.input.charCodeAt(++state.position);
  }
  captureSegment(state, captureStart, captureEnd, false);
  if (state.result) {
    return true;
  }
  state.kind = _kind;
  state.result = _result;
  return false;
}
function readSingleQuotedScalar(state, nodeIndent) {
  var ch, captureStart, captureEnd;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 39) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 39) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (ch === 39) {
        captureStart = state.position;
        state.position++;
        captureEnd = state.position;
      } else {
        return true;
      }
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a single quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a single quoted scalar");
}
function readDoubleQuotedScalar(state, nodeIndent) {
  var captureStart, captureEnd, hexLength, hexResult, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 34) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 34) {
      captureSegment(state, captureStart, state.position, true);
      state.position++;
      return true;
    } else if (ch === 92) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (is_EOL(ch)) {
        skipSeparationSpace(state, false, nodeIndent);
      } else if (ch < 256 && simpleEscapeCheck[ch]) {
        state.result += simpleEscapeMap[ch];
        state.position++;
      } else if ((tmp = escapedHexLen(ch)) > 0) {
        hexLength = tmp;
        hexResult = 0;
        for (; hexLength > 0; hexLength--) {
          ch = state.input.charCodeAt(++state.position);
          if ((tmp = fromHexCode(ch)) >= 0) {
            hexResult = (hexResult << 4) + tmp;
          } else {
            throwError(state, "expected hexadecimal character");
          }
        }
        state.result += charFromCodepoint(hexResult);
        state.position++;
      } else {
        throwError(state, "unknown escape sequence");
      }
      captureStart = captureEnd = state.position;
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a double quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a double quoted scalar");
}
function readFlowCollection(state, nodeIndent) {
  var readNext = true, _line, _lineStart, _pos, _tag = state.tag, _result, _anchor = state.anchor, following, terminator, isPair, isExplicitPair, isMapping, overridableKeys = /* @__PURE__ */ Object.create(null), keyNode, keyTag, valueNode, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 91) {
    terminator = 93;
    isMapping = false;
    _result = [];
  } else if (ch === 123) {
    terminator = 125;
    isMapping = true;
    _result = {};
  } else {
    return false;
  }
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(++state.position);
  while (ch !== 0) {
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === terminator) {
      state.position++;
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = isMapping ? "mapping" : "sequence";
      state.result = _result;
      return true;
    } else if (!readNext) {
      throwError(state, "missed comma between flow collection entries");
    } else if (ch === 44) {
      throwError(state, "expected the node content, but found ','");
    }
    keyTag = keyNode = valueNode = null;
    isPair = isExplicitPair = false;
    if (ch === 63) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following)) {
        isPair = isExplicitPair = true;
        state.position++;
        skipSeparationSpace(state, true, nodeIndent);
      }
    }
    _line = state.line;
    _lineStart = state.lineStart;
    _pos = state.position;
    composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
    keyTag = state.tag;
    keyNode = state.result;
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if ((isExplicitPair || state.line === _line) && ch === 58) {
      isPair = true;
      ch = state.input.charCodeAt(++state.position);
      skipSeparationSpace(state, true, nodeIndent);
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      valueNode = state.result;
    }
    if (isMapping) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
    } else if (isPair) {
      _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
    } else {
      _result.push(keyNode);
    }
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === 44) {
      readNext = true;
      ch = state.input.charCodeAt(++state.position);
    } else {
      readNext = false;
    }
  }
  throwError(state, "unexpected end of the stream within a flow collection");
}
function readBlockScalar(state, nodeIndent) {
  var captureStart, folding, chomping = CHOMPING_CLIP, didReadContent = false, detectedIndent = false, textIndent = nodeIndent, emptyLines = 0, atMoreIndented = false, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 124) {
    folding = false;
  } else if (ch === 62) {
    folding = true;
  } else {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  while (ch !== 0) {
    ch = state.input.charCodeAt(++state.position);
    if (ch === 43 || ch === 45) {
      if (CHOMPING_CLIP === chomping) {
        chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
      } else {
        throwError(state, "repeat of a chomping mode identifier");
      }
    } else if ((tmp = fromDecimalCode(ch)) >= 0) {
      if (tmp === 0) {
        throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
      } else if (!detectedIndent) {
        textIndent = nodeIndent + tmp - 1;
        detectedIndent = true;
      } else {
        throwError(state, "repeat of an indentation width identifier");
      }
    } else {
      break;
    }
  }
  if (is_WHITE_SPACE(ch)) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (is_WHITE_SPACE(ch));
    if (ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (!is_EOL(ch) && ch !== 0);
    }
  }
  while (ch !== 0) {
    readLineBreak(state);
    state.lineIndent = 0;
    ch = state.input.charCodeAt(state.position);
    while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
      state.lineIndent++;
      ch = state.input.charCodeAt(++state.position);
    }
    if (!detectedIndent && state.lineIndent > textIndent) {
      textIndent = state.lineIndent;
    }
    if (is_EOL(ch)) {
      emptyLines++;
      continue;
    }
    if (state.lineIndent < textIndent) {
      if (chomping === CHOMPING_KEEP) {
        state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      } else if (chomping === CHOMPING_CLIP) {
        if (didReadContent) {
          state.result += "\n";
        }
      }
      break;
    }
    if (folding) {
      if (is_WHITE_SPACE(ch)) {
        atMoreIndented = true;
        state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      } else if (atMoreIndented) {
        atMoreIndented = false;
        state.result += common.repeat("\n", emptyLines + 1);
      } else if (emptyLines === 0) {
        if (didReadContent) {
          state.result += " ";
        }
      } else {
        state.result += common.repeat("\n", emptyLines);
      }
    } else {
      state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
    }
    didReadContent = true;
    detectedIndent = true;
    emptyLines = 0;
    captureStart = state.position;
    while (!is_EOL(ch) && ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, state.position, false);
  }
  return true;
}
function readBlockSequence(state, nodeIndent) {
  var _line, _tag = state.tag, _anchor = state.anchor, _result = [], following, detected = false, ch;
  if (state.firstTabInLine !== -1) return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    if (ch !== 45) {
      break;
    }
    following = state.input.charCodeAt(state.position + 1);
    if (!is_WS_OR_EOL(following)) {
      break;
    }
    detected = true;
    state.position++;
    if (skipSeparationSpace(state, true, -1)) {
      if (state.lineIndent <= nodeIndent) {
        _result.push(null);
        ch = state.input.charCodeAt(state.position);
        continue;
      }
    }
    _line = state.line;
    composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
    _result.push(state.result);
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a sequence entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "sequence";
    state.result = _result;
    return true;
  }
  return false;
}
function readBlockMapping(state, nodeIndent, flowIndent) {
  var following, allowCompact, _line, _keyLine, _keyLineStart, _keyPos, _tag = state.tag, _anchor = state.anchor, _result = {}, overridableKeys = /* @__PURE__ */ Object.create(null), keyTag = null, keyNode = null, valueNode = null, atExplicitKey = false, detected = false, ch;
  if (state.firstTabInLine !== -1) return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (!atExplicitKey && state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    following = state.input.charCodeAt(state.position + 1);
    _line = state.line;
    if ((ch === 63 || ch === 58) && is_WS_OR_EOL(following)) {
      if (ch === 63) {
        if (atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        detected = true;
        atExplicitKey = true;
        allowCompact = true;
      } else if (atExplicitKey) {
        atExplicitKey = false;
        allowCompact = true;
      } else {
        throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
      }
      state.position += 1;
      ch = following;
    } else {
      _keyLine = state.line;
      _keyLineStart = state.lineStart;
      _keyPos = state.position;
      if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
        break;
      }
      if (state.line === _line) {
        ch = state.input.charCodeAt(state.position);
        while (is_WHITE_SPACE(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (ch === 58) {
          ch = state.input.charCodeAt(++state.position);
          if (!is_WS_OR_EOL(ch)) {
            throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
          }
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = false;
          allowCompact = false;
          keyTag = state.tag;
          keyNode = state.result;
        } else if (detected) {
          throwError(state, "can not read an implicit mapping pair; a colon is missed");
        } else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      } else if (detected) {
        throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
      } else {
        state.tag = _tag;
        state.anchor = _anchor;
        return true;
      }
    }
    if (state.line === _line || state.lineIndent > nodeIndent) {
      if (atExplicitKey) {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
      }
      if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
        if (atExplicitKey) {
          keyNode = state.result;
        } else {
          valueNode = state.result;
        }
      }
      if (!atExplicitKey) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
        keyTag = keyNode = valueNode = null;
      }
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
    }
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a mapping entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (atExplicitKey) {
    storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "mapping";
    state.result = _result;
  }
  return detected;
}
function readTagProperty(state) {
  var _position, isVerbatim = false, isNamed = false, tagHandle, tagName, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 33) return false;
  if (state.tag !== null) {
    throwError(state, "duplication of a tag property");
  }
  ch = state.input.charCodeAt(++state.position);
  if (ch === 60) {
    isVerbatim = true;
    ch = state.input.charCodeAt(++state.position);
  } else if (ch === 33) {
    isNamed = true;
    tagHandle = "!!";
    ch = state.input.charCodeAt(++state.position);
  } else {
    tagHandle = "!";
  }
  _position = state.position;
  if (isVerbatim) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (ch !== 0 && ch !== 62);
    if (state.position < state.length) {
      tagName = state.input.slice(_position, state.position);
      ch = state.input.charCodeAt(++state.position);
    } else {
      throwError(state, "unexpected end of the stream within a verbatim tag");
    }
  } else {
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      if (ch === 33) {
        if (!isNamed) {
          tagHandle = state.input.slice(_position - 1, state.position + 1);
          if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
            throwError(state, "named tag handle cannot contain such characters");
          }
          isNamed = true;
          _position = state.position + 1;
        } else {
          throwError(state, "tag suffix cannot contain exclamation marks");
        }
      }
      ch = state.input.charCodeAt(++state.position);
    }
    tagName = state.input.slice(_position, state.position);
    if (PATTERN_FLOW_INDICATORS.test(tagName)) {
      throwError(state, "tag suffix cannot contain flow indicator characters");
    }
  }
  if (tagName && !PATTERN_TAG_URI.test(tagName)) {
    throwError(state, "tag name cannot contain such characters: " + tagName);
  }
  try {
    tagName = decodeURIComponent(tagName);
  } catch (err) {
    throwError(state, "tag name is malformed: " + tagName);
  }
  if (isVerbatim) {
    state.tag = tagName;
  } else if (_hasOwnProperty$1.call(state.tagMap, tagHandle)) {
    state.tag = state.tagMap[tagHandle] + tagName;
  } else if (tagHandle === "!") {
    state.tag = "!" + tagName;
  } else if (tagHandle === "!!") {
    state.tag = "tag:yaml.org,2002:" + tagName;
  } else {
    throwError(state, 'undeclared tag handle "' + tagHandle + '"');
  }
  return true;
}
function readAnchorProperty(state) {
  var _position, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 38) return false;
  if (state.anchor !== null) {
    throwError(state, "duplication of an anchor property");
  }
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an anchor node must contain at least one character");
  }
  state.anchor = state.input.slice(_position, state.position);
  return true;
}
function readAlias(state) {
  var _position, alias, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 42) return false;
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an alias node must contain at least one character");
  }
  alias = state.input.slice(_position, state.position);
  if (!_hasOwnProperty$1.call(state.anchorMap, alias)) {
    throwError(state, 'unidentified alias "' + alias + '"');
  }
  state.result = state.anchorMap[alias];
  skipSeparationSpace(state, true, -1);
  return true;
}
function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
  var allowBlockStyles, allowBlockScalars, allowBlockCollections, indentStatus = 1, atNewLine = false, hasContent = false, typeIndex, typeQuantity, typeList, type2, flowIndent, blockIndent;
  if (state.listener !== null) {
    state.listener("open", state);
  }
  state.tag = null;
  state.anchor = null;
  state.kind = null;
  state.result = null;
  allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
  if (allowToSeek) {
    if (skipSeparationSpace(state, true, -1)) {
      atNewLine = true;
      if (state.lineIndent > parentIndent) {
        indentStatus = 1;
      } else if (state.lineIndent === parentIndent) {
        indentStatus = 0;
      } else if (state.lineIndent < parentIndent) {
        indentStatus = -1;
      }
    }
  }
  if (indentStatus === 1) {
    while (readTagProperty(state) || readAnchorProperty(state)) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        allowBlockCollections = allowBlockStyles;
        if (state.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      } else {
        allowBlockCollections = false;
      }
    }
  }
  if (allowBlockCollections) {
    allowBlockCollections = atNewLine || allowCompact;
  }
  if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
    if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
      flowIndent = parentIndent;
    } else {
      flowIndent = parentIndent + 1;
    }
    blockIndent = state.position - state.lineStart;
    if (indentStatus === 1) {
      if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
        hasContent = true;
      } else {
        if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
          hasContent = true;
        } else if (readAlias(state)) {
          hasContent = true;
          if (state.tag !== null || state.anchor !== null) {
            throwError(state, "alias node should not have any properties");
          }
        } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
          hasContent = true;
          if (state.tag === null) {
            state.tag = "?";
          }
        }
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
      }
    } else if (indentStatus === 0) {
      hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
    }
  }
  if (state.tag === null) {
    if (state.anchor !== null) {
      state.anchorMap[state.anchor] = state.result;
    }
  } else if (state.tag === "?") {
    if (state.result !== null && state.kind !== "scalar") {
      throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
    }
    for (typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
      type2 = state.implicitTypes[typeIndex];
      if (type2.resolve(state.result)) {
        state.result = type2.construct(state.result);
        state.tag = type2.tag;
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
        break;
      }
    }
  } else if (state.tag !== "!") {
    if (_hasOwnProperty$1.call(state.typeMap[state.kind || "fallback"], state.tag)) {
      type2 = state.typeMap[state.kind || "fallback"][state.tag];
    } else {
      type2 = null;
      typeList = state.typeMap.multi[state.kind || "fallback"];
      for (typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) {
        if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
          type2 = typeList[typeIndex];
          break;
        }
      }
    }
    if (!type2) {
      throwError(state, "unknown tag !<" + state.tag + ">");
    }
    if (state.result !== null && type2.kind !== state.kind) {
      throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type2.kind + '", not "' + state.kind + '"');
    }
    if (!type2.resolve(state.result, state.tag)) {
      throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
    } else {
      state.result = type2.construct(state.result, state.tag);
      if (state.anchor !== null) {
        state.anchorMap[state.anchor] = state.result;
      }
    }
  }
  if (state.listener !== null) {
    state.listener("close", state);
  }
  return state.tag !== null || state.anchor !== null || hasContent;
}
function readDocument(state) {
  var documentStart = state.position, _position, directiveName, directiveArgs, hasDirectives = false, ch;
  state.version = null;
  state.checkLineBreaks = state.legacy;
  state.tagMap = /* @__PURE__ */ Object.create(null);
  state.anchorMap = /* @__PURE__ */ Object.create(null);
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if (state.lineIndent > 0 || ch !== 37) {
      break;
    }
    hasDirectives = true;
    ch = state.input.charCodeAt(++state.position);
    _position = state.position;
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    directiveName = state.input.slice(_position, state.position);
    directiveArgs = [];
    if (directiveName.length < 1) {
      throwError(state, "directive name must not be less than one character in length");
    }
    while (ch !== 0) {
      while (is_WHITE_SPACE(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 0 && !is_EOL(ch));
        break;
      }
      if (is_EOL(ch)) break;
      _position = state.position;
      while (ch !== 0 && !is_WS_OR_EOL(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      directiveArgs.push(state.input.slice(_position, state.position));
    }
    if (ch !== 0) readLineBreak(state);
    if (_hasOwnProperty$1.call(directiveHandlers, directiveName)) {
      directiveHandlers[directiveName](state, directiveName, directiveArgs);
    } else {
      throwWarning(state, 'unknown document directive "' + directiveName + '"');
    }
  }
  skipSeparationSpace(state, true, -1);
  if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
    state.position += 3;
    skipSeparationSpace(state, true, -1);
  } else if (hasDirectives) {
    throwError(state, "directives end mark is expected");
  }
  composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
  skipSeparationSpace(state, true, -1);
  if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
    throwWarning(state, "non-ASCII line breaks are interpreted as content");
  }
  state.documents.push(state.result);
  if (state.position === state.lineStart && testDocumentSeparator(state)) {
    if (state.input.charCodeAt(state.position) === 46) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    }
    return;
  }
  if (state.position < state.length - 1) {
    throwError(state, "end of the stream or a document separator is expected");
  } else {
    return;
  }
}
function loadDocuments(input, options) {
  input = String(input);
  options = options || {};
  if (input.length !== 0) {
    if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
      input += "\n";
    }
    if (input.charCodeAt(0) === 65279) {
      input = input.slice(1);
    }
  }
  var state = new State$1(input, options);
  var nullpos = input.indexOf("\0");
  if (nullpos !== -1) {
    state.position = nullpos;
    throwError(state, "null byte is not allowed in input");
  }
  state.input += "\0";
  while (state.input.charCodeAt(state.position) === 32) {
    state.lineIndent += 1;
    state.position += 1;
  }
  while (state.position < state.length - 1) {
    readDocument(state);
  }
  return state.documents;
}
function loadAll$1(input, iterator, options) {
  if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
    options = iterator;
    iterator = null;
  }
  var documents = loadDocuments(input, options);
  if (typeof iterator !== "function") {
    return documents;
  }
  for (var index = 0, length = documents.length; index < length; index += 1) {
    iterator(documents[index]);
  }
}
function load$1(input, options) {
  var documents = loadDocuments(input, options);
  if (documents.length === 0) {
    return void 0;
  } else if (documents.length === 1) {
    return documents[0];
  }
  throw new exception("expected a single document in the stream, but found more");
}
var loadAll_1 = loadAll$1;
var load_1 = load$1;
var loader = {
  loadAll: loadAll_1,
  load: load_1
};
var _toString = Object.prototype.toString;
var _hasOwnProperty = Object.prototype.hasOwnProperty;
var CHAR_BOM = 65279;
var CHAR_TAB = 9;
var CHAR_LINE_FEED = 10;
var CHAR_CARRIAGE_RETURN = 13;
var CHAR_SPACE = 32;
var CHAR_EXCLAMATION = 33;
var CHAR_DOUBLE_QUOTE = 34;
var CHAR_SHARP = 35;
var CHAR_PERCENT = 37;
var CHAR_AMPERSAND = 38;
var CHAR_SINGLE_QUOTE = 39;
var CHAR_ASTERISK = 42;
var CHAR_COMMA = 44;
var CHAR_MINUS = 45;
var CHAR_COLON = 58;
var CHAR_EQUALS = 61;
var CHAR_GREATER_THAN = 62;
var CHAR_QUESTION = 63;
var CHAR_COMMERCIAL_AT = 64;
var CHAR_LEFT_SQUARE_BRACKET = 91;
var CHAR_RIGHT_SQUARE_BRACKET = 93;
var CHAR_GRAVE_ACCENT = 96;
var CHAR_LEFT_CURLY_BRACKET = 123;
var CHAR_VERTICAL_LINE = 124;
var CHAR_RIGHT_CURLY_BRACKET = 125;
var ESCAPE_SEQUENCES = {};
ESCAPE_SEQUENCES[0] = "\\0";
ESCAPE_SEQUENCES[7] = "\\a";
ESCAPE_SEQUENCES[8] = "\\b";
ESCAPE_SEQUENCES[9] = "\\t";
ESCAPE_SEQUENCES[10] = "\\n";
ESCAPE_SEQUENCES[11] = "\\v";
ESCAPE_SEQUENCES[12] = "\\f";
ESCAPE_SEQUENCES[13] = "\\r";
ESCAPE_SEQUENCES[27] = "\\e";
ESCAPE_SEQUENCES[34] = '\\"';
ESCAPE_SEQUENCES[92] = "\\\\";
ESCAPE_SEQUENCES[133] = "\\N";
ESCAPE_SEQUENCES[160] = "\\_";
ESCAPE_SEQUENCES[8232] = "\\L";
ESCAPE_SEQUENCES[8233] = "\\P";
var DEPRECATED_BOOLEANS_SYNTAX = [
  "y",
  "Y",
  "yes",
  "Yes",
  "YES",
  "on",
  "On",
  "ON",
  "n",
  "N",
  "no",
  "No",
  "NO",
  "off",
  "Off",
  "OFF"
];
var DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
function compileStyleMap(schema2, map2) {
  var result, keys, index, length, tag, style, type2;
  if (map2 === null) return {};
  result = {};
  keys = Object.keys(map2);
  for (index = 0, length = keys.length; index < length; index += 1) {
    tag = keys[index];
    style = String(map2[tag]);
    if (tag.slice(0, 2) === "!!") {
      tag = "tag:yaml.org,2002:" + tag.slice(2);
    }
    type2 = schema2.compiledTypeMap["fallback"][tag];
    if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
      style = type2.styleAliases[style];
    }
    result[tag] = style;
  }
  return result;
}
function encodeHex(character) {
  var string, handle, length;
  string = character.toString(16).toUpperCase();
  if (character <= 255) {
    handle = "x";
    length = 2;
  } else if (character <= 65535) {
    handle = "u";
    length = 4;
  } else if (character <= 4294967295) {
    handle = "U";
    length = 8;
  } else {
    throw new exception("code point within a string may not be greater than 0xFFFFFFFF");
  }
  return "\\" + handle + common.repeat("0", length - string.length) + string;
}
var QUOTING_TYPE_SINGLE = 1;
var QUOTING_TYPE_DOUBLE = 2;
function State(options) {
  this.schema = options["schema"] || _default;
  this.indent = Math.max(1, options["indent"] || 2);
  this.noArrayIndent = options["noArrayIndent"] || false;
  this.skipInvalid = options["skipInvalid"] || false;
  this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
  this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
  this.sortKeys = options["sortKeys"] || false;
  this.lineWidth = options["lineWidth"] || 80;
  this.noRefs = options["noRefs"] || false;
  this.noCompatMode = options["noCompatMode"] || false;
  this.condenseFlow = options["condenseFlow"] || false;
  this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
  this.forceQuotes = options["forceQuotes"] || false;
  this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.explicitTypes = this.schema.compiledExplicit;
  this.tag = null;
  this.result = "";
  this.duplicates = [];
  this.usedDuplicates = null;
}
function indentString(string, spaces) {
  var ind = common.repeat(" ", spaces), position = 0, next = -1, result = "", line, length = string.length;
  while (position < length) {
    next = string.indexOf("\n", position);
    if (next === -1) {
      line = string.slice(position);
      position = length;
    } else {
      line = string.slice(position, next + 1);
      position = next + 1;
    }
    if (line.length && line !== "\n") result += ind;
    result += line;
  }
  return result;
}
function generateNextLine(state, level) {
  return "\n" + common.repeat(" ", state.indent * level);
}
function testImplicitResolving(state, str2) {
  var index, length, type2;
  for (index = 0, length = state.implicitTypes.length; index < length; index += 1) {
    type2 = state.implicitTypes[index];
    if (type2.resolve(str2)) {
      return true;
    }
  }
  return false;
}
function isWhitespace(c) {
  return c === CHAR_SPACE || c === CHAR_TAB;
}
function isPrintable(c) {
  return 32 <= c && c <= 126 || 161 <= c && c <= 55295 && c !== 8232 && c !== 8233 || 57344 <= c && c <= 65533 && c !== CHAR_BOM || 65536 <= c && c <= 1114111;
}
function isNsCharOrWhitespace(c) {
  return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
}
function isPlainSafe(c, prev, inblock) {
  var cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
  var cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
  return (
    // ns-plain-safe
    (inblock ? (
      // c = flow-in
      cIsNsCharOrWhitespace
    ) : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar
  );
}
function isPlainSafeFirst(c) {
  return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
}
function isPlainSafeLast(c) {
  return !isWhitespace(c) && c !== CHAR_COLON;
}
function codePointAt(string, pos) {
  var first = string.charCodeAt(pos), second;
  if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
    second = string.charCodeAt(pos + 1);
    if (second >= 56320 && second <= 57343) {
      return (first - 55296) * 1024 + second - 56320 + 65536;
    }
  }
  return first;
}
function needIndentIndicator(string) {
  var leadingSpaceRe = /^\n* /;
  return leadingSpaceRe.test(string);
}
var STYLE_PLAIN = 1;
var STYLE_SINGLE = 2;
var STYLE_LITERAL = 3;
var STYLE_FOLDED = 4;
var STYLE_DOUBLE = 5;
function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
  var i;
  var char = 0;
  var prevChar = null;
  var hasLineBreak = false;
  var hasFoldableLine = false;
  var shouldTrackWidth = lineWidth !== -1;
  var previousLineBreak = -1;
  var plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
  if (singleLineOnly || forceQuotes) {
    for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
  } else {
    for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      if (char === CHAR_LINE_FEED) {
        hasLineBreak = true;
        if (shouldTrackWidth) {
          hasFoldableLine = hasFoldableLine || // Foldable line = too long, and not more-indented.
          i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
          previousLineBreak = i;
        }
      } else if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
    hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
  }
  if (!hasLineBreak && !hasFoldableLine) {
    if (plain && !forceQuotes && !testAmbiguousType(string)) {
      return STYLE_PLAIN;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  if (indentPerLevel > 9 && needIndentIndicator(string)) {
    return STYLE_DOUBLE;
  }
  if (!forceQuotes) {
    return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
  }
  return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
}
function writeScalar(state, string, level, iskey, inblock) {
  state.dump = (function() {
    if (string.length === 0) {
      return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
    }
    if (!state.noCompatMode) {
      if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
      }
    }
    var indent = state.indent * Math.max(1, level);
    var lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
    var singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
    function testAmbiguity(string2) {
      return testImplicitResolving(state, string2);
    }
    switch (chooseScalarStyle(
      string,
      singleLineOnly,
      state.indent,
      lineWidth,
      testAmbiguity,
      state.quotingType,
      state.forceQuotes && !iskey,
      inblock
    )) {
      case STYLE_PLAIN:
        return string;
      case STYLE_SINGLE:
        return "'" + string.replace(/'/g, "''") + "'";
      case STYLE_LITERAL:
        return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
      case STYLE_FOLDED:
        return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
      case STYLE_DOUBLE:
        return '"' + escapeString(string) + '"';
      default:
        throw new exception("impossible error: invalid scalar style");
    }
  })();
}
function blockHeader(string, indentPerLevel) {
  var indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
  var clip = string[string.length - 1] === "\n";
  var keep = clip && (string[string.length - 2] === "\n" || string === "\n");
  var chomp = keep ? "+" : clip ? "" : "-";
  return indentIndicator + chomp + "\n";
}
function dropEndingNewline(string) {
  return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
}
function foldString(string, width) {
  var lineRe = /(\n+)([^\n]*)/g;
  var result = (function() {
    var nextLF = string.indexOf("\n");
    nextLF = nextLF !== -1 ? nextLF : string.length;
    lineRe.lastIndex = nextLF;
    return foldLine(string.slice(0, nextLF), width);
  })();
  var prevMoreIndented = string[0] === "\n" || string[0] === " ";
  var moreIndented;
  var match;
  while (match = lineRe.exec(string)) {
    var prefix = match[1], line = match[2];
    moreIndented = line[0] === " ";
    result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
    prevMoreIndented = moreIndented;
  }
  return result;
}
function foldLine(line, width) {
  if (line === "" || line[0] === " ") return line;
  var breakRe = / [^ ]/g;
  var match;
  var start = 0, end, curr = 0, next = 0;
  var result = "";
  while (match = breakRe.exec(line)) {
    next = match.index;
    if (next - start > width) {
      end = curr > start ? curr : next;
      result += "\n" + line.slice(start, end);
      start = end + 1;
    }
    curr = next;
  }
  result += "\n";
  if (line.length - start > width && curr > start) {
    result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
  } else {
    result += line.slice(start);
  }
  return result.slice(1);
}
function escapeString(string) {
  var result = "";
  var char = 0;
  var escapeSeq;
  for (var i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
    char = codePointAt(string, i);
    escapeSeq = ESCAPE_SEQUENCES[char];
    if (!escapeSeq && isPrintable(char)) {
      result += string[i];
      if (char >= 65536) result += string[i + 1];
    } else {
      result += escapeSeq || encodeHex(char);
    }
  }
  return result;
}
function writeFlowSequence(state, level, object) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length; index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
      if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = "[" + _result + "]";
}
function writeBlockSequence(state, level, object, compact) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length; index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
      if (!compact || _result !== "") {
        _result += generateNextLine(state, level);
      }
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        _result += "-";
      } else {
        _result += "- ";
      }
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = _result || "[]";
}
function writeFlowMapping(state, level, object) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, pairBuffer;
  for (index = 0, length = objectKeyList.length; index < length; index += 1) {
    pairBuffer = "";
    if (_result !== "") pairBuffer += ", ";
    if (state.condenseFlow) pairBuffer += '"';
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level, objectKey, false, false)) {
      continue;
    }
    if (state.dump.length > 1024) pairBuffer += "? ";
    pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
    if (!writeNode(state, level, objectValue, false, false)) {
      continue;
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = "{" + _result + "}";
}
function writeBlockMapping(state, level, object, compact) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, explicitPair, pairBuffer;
  if (state.sortKeys === true) {
    objectKeyList.sort();
  } else if (typeof state.sortKeys === "function") {
    objectKeyList.sort(state.sortKeys);
  } else if (state.sortKeys) {
    throw new exception("sortKeys must be a boolean or a function");
  }
  for (index = 0, length = objectKeyList.length; index < length; index += 1) {
    pairBuffer = "";
    if (!compact || _result !== "") {
      pairBuffer += generateNextLine(state, level);
    }
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level + 1, objectKey, true, true, true)) {
      continue;
    }
    explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
    if (explicitPair) {
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += "?";
      } else {
        pairBuffer += "? ";
      }
    }
    pairBuffer += state.dump;
    if (explicitPair) {
      pairBuffer += generateNextLine(state, level);
    }
    if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
      continue;
    }
    if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
      pairBuffer += ":";
    } else {
      pairBuffer += ": ";
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = _result || "{}";
}
function detectType(state, object, explicit) {
  var _result, typeList, index, length, type2, style;
  typeList = explicit ? state.explicitTypes : state.implicitTypes;
  for (index = 0, length = typeList.length; index < length; index += 1) {
    type2 = typeList[index];
    if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
      if (explicit) {
        if (type2.multi && type2.representName) {
          state.tag = type2.representName(object);
        } else {
          state.tag = type2.tag;
        }
      } else {
        state.tag = "?";
      }
      if (type2.represent) {
        style = state.styleMap[type2.tag] || type2.defaultStyle;
        if (_toString.call(type2.represent) === "[object Function]") {
          _result = type2.represent(object, style);
        } else if (_hasOwnProperty.call(type2.represent, style)) {
          _result = type2.represent[style](object, style);
        } else {
          throw new exception("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
        }
        state.dump = _result;
      }
      return true;
    }
  }
  return false;
}
function writeNode(state, level, object, block, compact, iskey, isblockseq) {
  state.tag = null;
  state.dump = object;
  if (!detectType(state, object, false)) {
    detectType(state, object, true);
  }
  var type2 = _toString.call(state.dump);
  var inblock = block;
  var tagStr;
  if (block) {
    block = state.flowLevel < 0 || state.flowLevel > level;
  }
  var objectOrArray = type2 === "[object Object]" || type2 === "[object Array]", duplicateIndex, duplicate;
  if (objectOrArray) {
    duplicateIndex = state.duplicates.indexOf(object);
    duplicate = duplicateIndex !== -1;
  }
  if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
    compact = false;
  }
  if (duplicate && state.usedDuplicates[duplicateIndex]) {
    state.dump = "*ref_" + duplicateIndex;
  } else {
    if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
      state.usedDuplicates[duplicateIndex] = true;
    }
    if (type2 === "[object Object]") {
      if (block && Object.keys(state.dump).length !== 0) {
        writeBlockMapping(state, level, state.dump, compact);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowMapping(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object Array]") {
      if (block && state.dump.length !== 0) {
        if (state.noArrayIndent && !isblockseq && level > 0) {
          writeBlockSequence(state, level - 1, state.dump, compact);
        } else {
          writeBlockSequence(state, level, state.dump, compact);
        }
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowSequence(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object String]") {
      if (state.tag !== "?") {
        writeScalar(state, state.dump, level, iskey, inblock);
      }
    } else if (type2 === "[object Undefined]") {
      return false;
    } else {
      if (state.skipInvalid) return false;
      throw new exception("unacceptable kind of an object to dump " + type2);
    }
    if (state.tag !== null && state.tag !== "?") {
      tagStr = encodeURI(
        state.tag[0] === "!" ? state.tag.slice(1) : state.tag
      ).replace(/!/g, "%21");
      if (state.tag[0] === "!") {
        tagStr = "!" + tagStr;
      } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
        tagStr = "!!" + tagStr.slice(18);
      } else {
        tagStr = "!<" + tagStr + ">";
      }
      state.dump = tagStr + " " + state.dump;
    }
  }
  return true;
}
function getDuplicateReferences(object, state) {
  var objects = [], duplicatesIndexes = [], index, length;
  inspectNode(object, objects, duplicatesIndexes);
  for (index = 0, length = duplicatesIndexes.length; index < length; index += 1) {
    state.duplicates.push(objects[duplicatesIndexes[index]]);
  }
  state.usedDuplicates = new Array(length);
}
function inspectNode(object, objects, duplicatesIndexes) {
  var objectKeyList, index, length;
  if (object !== null && typeof object === "object") {
    index = objects.indexOf(object);
    if (index !== -1) {
      if (duplicatesIndexes.indexOf(index) === -1) {
        duplicatesIndexes.push(index);
      }
    } else {
      objects.push(object);
      if (Array.isArray(object)) {
        for (index = 0, length = object.length; index < length; index += 1) {
          inspectNode(object[index], objects, duplicatesIndexes);
        }
      } else {
        objectKeyList = Object.keys(object);
        for (index = 0, length = objectKeyList.length; index < length; index += 1) {
          inspectNode(object[objectKeyList[index]], objects, duplicatesIndexes);
        }
      }
    }
  }
}
function dump$1(input, options) {
  options = options || {};
  var state = new State(options);
  if (!state.noRefs) getDuplicateReferences(input, state);
  var value = input;
  if (state.replacer) {
    value = state.replacer.call({ "": value }, "", value);
  }
  if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
  return "";
}
var dump_1 = dump$1;
var dumper = {
  dump: dump_1
};
function renamed(from, to) {
  return function() {
    throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
  };
}
var Type = type;
var JSON_SCHEMA = json;
var load = loader.load;
var loadAll = loader.loadAll;
var dump = dumper.dump;
var safeLoad = renamed("safeLoad", "load");
var safeLoadAll = renamed("safeLoadAll", "loadAll");
var safeDump = renamed("safeDump", "dump");

// src-tauri/resources/dsh-market/src/host/order.js
import { existsSync as existsSync4, readFileSync as readFileSync3, renameSync as renameSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { createRequire } from "node:module";
import { dirname as dirname3, join as join5, resolve as resolve3 } from "node:path";
var INBOX_BUNDLES2 = /* @__PURE__ */ new Set([
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@deepseek-ai/dsh-headless"
]);
function writeFileAtomic(file, content) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync3(temp, content);
  renameSync2(temp, file);
}
function readBundleStack(profileDir2) {
  try {
    const manifest = JSON.parse(readFileSync3(join5(profileDir2, "package.json"), "utf8"));
    const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles.filter((name2) => typeof name2 === "string") : [];
    return {
      bundles,
      community: bundles.filter((name2) => !INBOX_BUNDLES2.has(name2))
    };
  } catch {
    return { bundles: [], community: [] };
  }
}
function findDshInstallDir(entry = process.argv[1]) {
  if (entry === void 0)
    return null;
  let dir = resolve3(dirname3(entry));
  for (let depth = 0; depth < 10; depth += 1) {
    try {
      const manifest = JSON.parse(readFileSync3(join5(dir, "package.json"), "utf8"));
      if (manifest.name === "@deepseek-ai/dsh")
        return dir;
    } catch {
    }
    const parent = dirname3(dir);
    if (parent === dir)
      return null;
    dir = parent;
  }
  return null;
}
function resolveBundlePackageJson(profileDir2, name2) {
  const dshInstall = findDshInstallDir();
  const anchors = [
    dshInstall !== null ? join5(dshInstall, "package.json") : null,
    join5(profileDir2, "package.json")
  ];
  for (const anchor of anchors) {
    if (anchor === null)
      continue;
    let paths = [];
    try {
      paths = createRequire(anchor).resolve.paths(name2) ?? [];
    } catch {
      continue;
    }
    for (const searchPath of paths) {
      const candidate = join5(searchPath, name2);
      if (existsSync4(join5(candidate, "package.json")))
        return join5(candidate, "package.json");
    }
  }
  return null;
}
function readBundleRules(profileDir2) {
  const { bundles } = readBundleStack(profileDir2);
  const rules = [];
  for (const name2 of bundles) {
    const packageJson = resolveBundlePackageJson(profileDir2, name2);
    if (packageJson === null)
      continue;
    try {
      const manifest = JSON.parse(readFileSync3(packageJson, "utf8"));
      const order = manifest.dsh?.bundle?.order;
      if (order === null || typeof order !== "object" || Array.isArray(order))
        continue;
      const listOf = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
      const rule = {
        name: name2,
        after: listOf(order.after),
        before: listOf(order.before)
      };
      if (rule.after.length > 0 || rule.before.length > 0)
        rules.push(rule);
    } catch {
    }
  }
  return rules;
}
function validateOrder(bundleNames, rules) {
  const position = new Map(bundleNames.map((name2, index) => [name2, index]));
  const conflicts = [];
  for (const rule of rules) {
    const pos = position.get(rule.name);
    if (pos === void 0)
      continue;
    for (const other of rule.after) {
      const otherPos = position.get(other);
      if (otherPos === void 0)
        continue;
      if (otherPos >= pos) {
        conflicts.push({
          name: rule.name,
          reason: `must load after ${other}, but ${other} is currently before/equal (position ${otherPos} vs ${pos})`
        });
      }
    }
    for (const other of rule.before) {
      const otherPos = position.get(other);
      if (otherPos === void 0)
        continue;
      if (otherPos <= pos) {
        conflicts.push({
          name: rule.name,
          reason: `must load before ${other}, but ${other} is currently after/equal (position ${otherPos} vs ${pos})`
        });
      }
    }
  }
  return conflicts;
}
function mergeOrder(bundles, newOrder) {
  const communitySet = new Set(bundles.filter((name2) => !INBOX_BUNDLES2.has(name2)));
  if (new Set(newOrder).size !== newOrder.length) {
    return { ok: false, error: "duplicate bundle names in the new order / \u65B0\u987A\u5E8F\u5305\u542B\u91CD\u590D\u7684 bundle" };
  }
  if (newOrder.length !== communitySet.size) {
    return { ok: false, error: "the new order must contain exactly the current community bundles / \u65B0\u987A\u5E8F\u5FC5\u987B\u6070\u597D\u5305\u542B\u5168\u90E8\u793E\u533A bundle" };
  }
  for (const name2 of newOrder) {
    if (!communitySet.has(name2)) {
      return { ok: false, error: `${name2} is not a reorderable community bundle / ${name2} \u4E0D\u662F\u53EF\u6392\u5E8F\u7684\u793E\u533A bundle` };
    }
  }
  const merged = [...bundles];
  let cursor = 0;
  for (let index = 0; index < merged.length; index += 1) {
    const name2 = merged[index];
    if (name2 === void 0 || INBOX_BUNDLES2.has(name2))
      continue;
    merged[index] = newOrder[cursor];
    cursor += 1;
  }
  return { ok: true, bundles: merged };
}
function suggestOrder(bundleNames, rules) {
  const names = bundleNames.filter((name2) => !INBOX_BUNDLES2.has(name2));
  const inOrder = new Set(names);
  const active = rules.filter((rule) => inOrder.has(rule.name));
  if (active.length === 0)
    return null;
  const position = new Map(names.map((name2, index) => [name2, index]));
  const beforeOf = /* @__PURE__ */ new Map();
  const deps = /* @__PURE__ */ new Map();
  for (const name2 of names) {
    beforeOf.set(name2, /* @__PURE__ */ new Set());
    deps.set(name2, /* @__PURE__ */ new Set());
  }
  const addEdge = (a, b) => {
    if (!inOrder.has(a) || !inOrder.has(b) || a === b)
      return;
    beforeOf.get(a)?.add(b);
    deps.get(b)?.add(a);
  };
  for (const rule of active) {
    for (const other of rule.before)
      addEdge(rule.name, other);
    for (const other of rule.after)
      addEdge(other, rule.name);
  }
  const remaining = /* @__PURE__ */ new Map();
  for (const [name2, depsOf] of deps)
    remaining.set(name2, new Set(depsOf));
  const ready = names.filter((name2) => (remaining.get(name2)?.size ?? 0) === 0);
  const ordered = [];
  while (ready.length > 0) {
    let best = 0;
    for (let i = 1; i < ready.length; i += 1) {
      const a = ready[i];
      const b = ready[best];
      if (a !== void 0 && b !== void 0 && (position.get(a) ?? 0) < (position.get(b) ?? 0))
        best = i;
    }
    const name2 = ready.splice(best, 1)[0];
    if (name2 === void 0)
      break;
    ordered.push(name2);
    for (const dependent of beforeOf.get(name2) ?? []) {
      const depsOf = remaining.get(dependent);
      if (depsOf === void 0)
        continue;
      depsOf.delete(name2);
      if (depsOf.size === 0 && !ordered.includes(dependent) && !ready.includes(dependent))
        ready.push(dependent);
    }
  }
  if (ordered.length < names.length) {
    return { ok: false, cycle: names.filter((name2) => !ordered.includes(name2)) };
  }
  return { ok: true, order: ordered };
}
function applyBundleOrder(profileDir2, newOrder) {
  const { bundles } = readBundleStack(profileDir2);
  const merged = mergeOrder(bundles, newOrder);
  if (!merged.ok)
    return merged;
  try {
    const manifestPath = join5(profileDir2, "package.json");
    const manifest = JSON.parse(readFileSync3(manifestPath, "utf8"));
    manifest.dsh ??= {};
    manifest.dsh.profile ??= {};
    manifest.dsh.profile.bundles = merged.bundles;
    writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}
`);
    return merged;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// src-tauri/resources/dsh-market/src/host/check.js
var jsExpr = new Type("tag:yaml.org,2002:js", {
  kind: "scalar",
  resolve: (data) => typeof data === "string",
  construct: (data) => ({ __jsExpr: String(data) })
});
var entrySchema = JSON_SCHEMA.extend(jsExpr);
function isRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parsePatchFile(path) {
  let text;
  try {
    text = readFileSync4(path, "utf8");
  } catch {
    return null;
  }
  try {
    const value = load(text, { schema: entrySchema });
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function collectInsertIds(rows) {
  const ids = [];
  const walk = (value) => {
    if (!Array.isArray(value))
      return;
    for (const entry of value) {
      if (!isRecord2(entry) || typeof entry.id !== "string")
        continue;
      ids.push(entry.id);
      if (Array.isArray(entry.config))
        walk(entry.config);
    }
  };
  for (const patch of rows) {
    if (!isRecord2(patch) || !Array.isArray(patch.insert))
      continue;
    walk(patch.insert);
  }
  return ids;
}
function corePackageNames(dshInstallDir) {
  const names = /* @__PURE__ */ new Set([
    // Curated fallback seed (used when the install dir cannot be located).
    "@deepseek-ai/dsh",
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-web-app",
    "@deepseek-ai/dsh-headless",
    "@deepseek-ai/dsh-app-boot",
    "@deepseek-ai/dsh-home-paths",
    "@deepseek-ai/dsh-launch-environment",
    "@deepseek-ai/dsh-cmdline",
    "@deepseek-ai/dsh-tools",
    "@deepseek-ai/dsh-llm",
    "@deepseek-ai/dsh-system-prompt",
    "@deepseek-ai/dsh-attachment",
    "@deepseek-ai/dsh-agent",
    "@deepseek-ai/dsh-agent-loop",
    "@deepseek-ai/dsh-session",
    "@deepseek-ai/dsh-subagent",
    "@deepseek-ai/cordis",
    "@deepseek-ai/cordis-plugin-loader",
    "@deepseek-ai/cordis-plugin-include",
    "@deepseek-ai/cordis-plugin-hmr",
    "@deepseek-ai/cordis-plugin-timer",
    "@deepseek-ai/cordis-plugin-group"
  ]);
  if (dshInstallDir === null)
    return names;
  try {
    for (const entry of readdirSync3(join6(dshInstallDir, "node_modules", "@deepseek-ai"), { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink())
        continue;
      if (/^(?:dsh|cordis)/.test(entry.name))
        names.add(`@deepseek-ai/${entry.name}`);
    }
  } catch {
  }
  try {
    const manifest = JSON.parse(readFileSync4(join6(dshInstallDir, "package.json"), "utf8"));
    if (typeof manifest.name === "string")
      names.add(manifest.name);
  } catch {
  }
  return names;
}
function findDshInstallDir2(entry = process.argv[1]) {
  if (entry === void 0)
    return null;
  let dir = resolve4(dirname4(entry));
  for (let depth = 0; depth < 10; depth += 1) {
    try {
      const manifest = JSON.parse(readFileSync4(join6(dir, "package.json"), "utf8"));
      if (manifest.name === "@deepseek-ai/dsh")
        return dir;
    } catch {
    }
    const parent = dirname4(dir);
    if (parent === dir)
      return null;
    dir = parent;
  }
  return null;
}
function readNodeModulesVersion(base, name2) {
  try {
    const manifest = JSON.parse(readFileSync4(join6(base, "node_modules", name2, "package.json"), "utf8"));
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}
function resolveBundleDir(anchorPackageJson, name2) {
  let paths = [];
  try {
    paths = createRequire2(anchorPackageJson).resolve.paths(name2) ?? [];
  } catch {
    return null;
  }
  for (const searchPath of paths) {
    const candidate = join6(searchPath, name2);
    if (existsSync5(join6(candidate, "package.json")))
      return candidate;
  }
  return null;
}
function readProfileVisibleVersion(profileDirectory, name2) {
  const direct = readNodeModulesVersion(profileDirectory, name2);
  if (direct !== null)
    return direct;
  const workspaceRoot = dirname4(profileDirectory);
  if (workspaceRoot === profileDirectory)
    return null;
  return readNodeModulesVersion(workspaceRoot, name2);
}
function installedPackageNames(profileDir2) {
  const names = [];
  const isPkgDir = (entry) => entry.isDirectory() || entry.isSymbolicLink();
  let root;
  try {
    root = readdirSync3(join6(profileDir2, "node_modules"), { withFileTypes: true }).filter((entry) => isPkgDir(entry) && entry.name !== ".bin" && entry.name !== ".pnpm" && entry.name !== ".dsh-plugin-backups").map((entry) => entry.name);
  } catch {
    return names;
  }
  for (const name2 of root) {
    if (!name2.startsWith("@")) {
      names.push(name2);
      continue;
    }
    try {
      for (const scoped of readdirSync3(join6(profileDir2, "node_modules", name2), { withFileTypes: true })) {
        if (isPkgDir(scoped))
          names.push(`${name2}/${scoped.name}`);
      }
    } catch {
    }
  }
  return names;
}
var SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
function parseSemver(value) {
  const m = SEMVER_RE.exec(value.trim());
  if (m === null)
    return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] === void 0 ? [] : m[4].split(".")
  };
}
function comparePre(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === void 0)
      return y === void 0 ? 0 : -1;
    if (y === void 0)
      return 1;
    if (x === y)
      continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn)
      return Number(x) - Number(y) || 0;
    if (xn)
      return -1;
    if (yn)
      return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
function compareSemver(a, b) {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (av === null || bv === null)
    return a < b ? -1 : a > b ? 1 : 0;
  if (av.major !== bv.major)
    return av.major - bv.major || 0;
  if (av.minor !== bv.minor)
    return av.minor - bv.minor || 0;
  if (av.patch !== bv.patch)
    return av.patch - bv.patch || 0;
  if (av.pre.length === 0 && bv.pre.length === 0)
    return 0;
  if (av.pre.length === 0)
    return 1;
  if (bv.pre.length === 0)
    return -1;
  return comparePre(av.pre, bv.pre);
}
function gte(a, b) {
  const cmp = compareSemver(`${a.major}.${a.minor}.${a.patch}${a.pre.length > 0 ? `-${a.pre.join(".")}` : ""}`, `${b.major}.${b.minor}.${b.patch}${b.pre.length > 0 ? `-${b.pre.join(".")}` : ""}`);
  return cmp >= 0;
}
function semverStr(v) {
  return `${v.major}.${v.minor}.${v.patch}${v.pre.length > 0 ? `-${v.pre.join(".")}` : ""}`;
}
function satisfiesRange(version, range) {
  const v = parseSemver(version);
  if (v === null)
    return null;
  const versionHasPre = v.pre.length > 0;
  const single = (part) => {
    const p = part.trim();
    if (p === "" || p === "*" || p === "x" || p === "X")
      return true;
    const m = /^(\^|~|>=|<=|>|<)?(.*)$/.exec(p);
    const op = m?.[1] ?? "";
    const target = (m?.[2] ?? "").trim();
    const tv = parseSemver(target);
    if (tv === null)
      return null;
    const major = tv.major;
    const minor = tv.minor;
    const patch = tv.patch;
    switch (op) {
      case "":
        return compareSemver(version, target) === 0;
      case ">=":
        return gte(v, tv);
      case "<=":
        return gte(tv, v);
      case ">":
        return compareSemver(version, target) > 0;
      case "<":
        return compareSemver(version, target) < 0;
      case "^": {
        const upper = major > 0 ? { major: major + 1, minor: 0, patch: 0, pre: [] } : minor > 0 ? { major: 0, minor: minor + 1, patch: 0, pre: [] } : { major: 0, minor: 0, patch: patch + 1, pre: [] };
        return gte(v, tv) && compareSemver(semverStr(upper), version) > 0;
      }
      case "~": {
        const upper = { major, minor: minor + 1, patch: 0, pre: [] };
        return gte(v, tv) && compareSemver(semverStr(upper), version) > 0;
      }
      default:
        return null;
    }
  };
  const comparator = (part) => {
    const p = part.trim();
    if (p === "" || p === "*" || p === "x" || p === "X")
      return { op: "", target: "" };
    const m = /^(\^|~|>=|<=|>|<)?(.*)$/.exec(p);
    if (m === null)
      return null;
    return { op: m[1] ?? "", target: (m[2] ?? "").trim() };
  };
  const evaluateSet = (set2) => {
    const parts = set2.trim().split(/\s+/).filter((part) => part !== "");
    if (parts.length === 0)
      return true;
    const parsed = parts.map((part) => comparator(part));
    if (parsed.some((part) => part === null))
      return null;
    if (versionHasPre) {
      const admitted = parsed.some((part) => {
        if (part?.target === "")
          return false;
        const tv = parseSemver(part?.target ?? "");
        return tv !== null && tv.pre.length > 0 && v.major === tv.major && v.minor === tv.minor && v.patch === tv.patch;
      });
      if (!admitted)
        return false;
    }
    const results = parsed.map((part) => single(part?.op !== void 0 ? `${part.op}${part.target}` : ""));
    if (results.some((r) => r === null))
      return null;
    return results.every((r) => r === true);
  };
  if (range.includes("||")) {
    const outcomes = range.split("||").map((part) => evaluateSet(part));
    if (outcomes.some((out) => out === true))
      return true;
    return outcomes.every((out) => out === null) ? null : false;
  }
  return evaluateSet(range);
}
function flattenEntries(nodes) {
  const rows = [];
  const walk = (list) => {
    for (const node of list) {
      rows.push({ id: node.id, layer: node.layer, kind: "insert", name: node.name });
      if (node.group === true && Array.isArray(node.config))
        walk(node.config);
    }
  };
  walk(nodes);
  return rows;
}
function composeLayers(layers) {
  const tree = [];
  const orphans = [];
  const overrides = [];
  const entryMap = /* @__PURE__ */ new Map();
  const buildMap = (nodes) => {
    for (const node of nodes) {
      if (node.id !== "")
        entryMap.set(node.id, node);
      if (node.group === true && Array.isArray(node.config))
        buildMap(node.config);
    }
  };
  for (const layer of layers) {
    for (const patch of layer.patches) {
      if (!isRecord2(patch))
        continue;
      const { id, insert, name: name2, ...overridesOf } = patch;
      const hasId = typeof id === "string" ? id !== "" : Boolean(id);
      const lookupKey = hasId ? String(id) : "";
      if (insert) {
        if (!Array.isArray(insert)) {
          orphans.push({ id: lookupKey === "" ? "(anonymous)" : lookupKey, layer: layer.label, reason: "insert is not an array" });
          continue;
        }
        const nodes = insert.filter(isRecord2).map((entry) => {
          if (typeof entry.id !== "string")
            return null;
          return {
            id: entry.id,
            name: typeof entry.name === "string" ? entry.name : void 0,
            layer: layer.label,
            group: entry.group === true,
            config: Array.isArray(entry.config) ? entry.config : void 0
          };
        }).filter((n) => n !== null);
        if (hasId) {
          const target2 = entryMap.get(lookupKey);
          if (target2 === void 0) {
            orphans.push({ id: lookupKey, layer: layer.label, reason: "insert target not found" });
            continue;
          }
          if (target2.group !== true) {
            orphans.push({ id: lookupKey, layer: layer.label, reason: "insert target is not a group" });
            continue;
          }
          if (!Array.isArray(target2.config))
            target2.config = [];
          target2.config = [...target2.config, ...nodes];
        } else {
          tree.push(...nodes);
        }
        buildMap(nodes);
        continue;
      }
      if (!hasId) {
        orphans.push({ id: "(anonymous)", layer: layer.label, reason: "id required for non-insert patch" });
        continue;
      }
      const target = entryMap.get(lookupKey);
      if (target === void 0) {
        orphans.push({ id: lookupKey, layer: layer.label, reason: "patch target not found" });
        continue;
      }
      if (name2 && name2 !== target.name) {
        orphans.push({ id: lookupKey, layer: layer.label, reason: `name mismatch (expected ${String(target.name)}, got ${String(name2)})` });
        continue;
      }
      const priorLayers = [];
      for (const node of flattenEntries(tree)) {
        if (node.id === lookupKey && !priorLayers.includes(node.layer))
          priorLayers.push(node.layer);
      }
      if (priorLayers.some((prior) => prior !== layer.label)) {
        overrides.push({ id: lookupKey, layer: layer.label, overriddenLayers: priorLayers.filter((prior) => prior !== layer.label) });
      }
      for (const [key, value] of Object.entries(overridesOf)) {
        if (key === "id")
          continue;
        target[key] = value;
      }
    }
  }
  const rows = flattenEntries(tree);
  const byId = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const layers2 = byId.get(row.id) ?? [];
    if (!layers2.includes(row.layer))
      layers2.push(row.layer);
    byId.set(row.id, layers2);
  }
  const duplicates = [];
  const counts = /* @__PURE__ */ new Map();
  for (const row of rows)
    counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  for (const [id, count] of counts) {
    if (count < 2)
      continue;
    duplicates.push({ id, layers: byId.get(id) ?? [], count });
  }
  duplicates.sort((a, b) => a.id.localeCompare(b.id));
  return { rows, duplicates, overrides, orphans };
}
function lockfileCoreVersions(profileDir2) {
  const found = /* @__PURE__ */ new Map();
  let text;
  try {
    text = readFileSync4(join6(profileDir2, "pnpm-lock.yaml"), "utf8");
  } catch {
    return /* @__PURE__ */ new Map();
  }
  for (const m of text.matchAll(/(@deepseek-ai\/(?:dsh|cordis)[^@\s'"]*?)@([0-9][^\s:'"()]*)/g)) {
    const name2 = m[1] ?? "";
    const version = m[2] ?? "";
    if (parseSemver(version) === null)
      continue;
    const versions = found.get(name2) ?? /* @__PURE__ */ new Set();
    versions.add(version);
    found.set(name2, versions);
  }
  const out = /* @__PURE__ */ new Map();
  for (const [name2, versions] of found)
    out.set(name2, [...versions].sort(compareSemver));
  return out;
}
function buildBundleLayers(profileDirectory, bundleNames, specs, dshInstallDir) {
  const bundles = bundleNames.map((name2) => {
    const anchors = [
      dshInstallDir !== null ? join6(dshInstallDir, "package.json") : null,
      join6(profileDirectory, "package.json")
    ];
    let directory = null;
    for (const anchor of anchors) {
      if (anchor === null)
        continue;
      directory = resolveBundleDir(anchor, name2);
      if (directory !== null)
        break;
    }
    const layer = {
      name: name2,
      source: specs[name2] ?? "(not a direct dependency)",
      kind: INBOX_BUNDLES2.has(name2) ? "official" : "community",
      directory,
      patchPath: null,
      error: null,
      entries: [],
      parseError: null
    };
    if (directory === null) {
      layer.error = "bundle package is not installed \u2014 the profile will fail to boot";
      return layer;
    }
    let bundleManifest;
    try {
      bundleManifest = JSON.parse(readFileSync4(join6(directory, "package.json"), "utf8"));
    } catch {
      layer.error = "bundle package.json is unreadable";
      return layer;
    }
    const declared = bundleManifest.dsh?.bundle?.patch;
    if (typeof declared !== "string") {
      layer.error = "bundle declares no dsh.bundle.patch \u2014 the profile will fail to boot";
      return layer;
    }
    const patchPath = join6(directory, declared);
    if (!existsSync5(patchPath)) {
      layer.error = `declared patch ${declared} is missing \u2014 the profile will fail to boot`;
      return layer;
    }
    layer.patchPath = patchPath;
    const patches = parsePatchFile(patchPath);
    if (patches === null) {
      layer.parseError = "patch file is not a valid entry list";
      return layer;
    }
    layer.entries = collectInsertIds(patches);
    const order = bundleManifest.dsh?.bundle?.order;
    if (order !== null && typeof order === "object" && !Array.isArray(order)) {
      const listOf = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : void 0;
      const after = listOf(order.after);
      const before = listOf(order.before);
      if (after !== void 0 || before !== void 0) {
        layer.order = { ...before !== void 0 ? { before } : {}, ...after !== void 0 ? { after } : {} };
      }
    }
    return layer;
  });
  const layers = bundles.map((bundle) => ({
    label: bundle.name,
    kind: "bundle",
    patches: bundle.patchPath !== null && bundle.parseError === null ? parsePatchFile(bundle.patchPath) ?? [] : [],
    parseError: bundle.parseError
  }));
  return { bundles, layers };
}
function analyzeProfile(profileDirectory, options = {}) {
  const dshInstall = options.dshInstallDir ?? findDshInstallDir2();
  const home = options.homeDir ?? process.env.DSH_HOME ?? join6(homedir4(), ".dsh");
  const core2 = corePackageNames(dshInstall);
  const manifest = (() => {
    try {
      return JSON.parse(readFileSync4(join6(profileDirectory, "package.json"), "utf8"));
    } catch {
      return null;
    }
  })();
  const bundleNames = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles.filter((name2) => typeof name2 === "string") : [];
  const specs = manifest?.dependencies ?? {};
  const built = buildBundleLayers(profileDirectory, bundleNames, specs, dshInstall);
  const bundles = built.bundles;
  const bundleLayers = built.layers;
  const layers = [...bundleLayers];
  const userPatchPath = join6(profileDirectory, "cordis.patch.yml");
  if (existsSync5(userPatchPath)) {
    const patches = parsePatchFile(userPatchPath);
    layers.push({ label: "user-patch", kind: "user", patches: patches ?? [], parseError: patches === null ? "patch file is not a valid entry list" : null });
  }
  const homePatchPath = join6(home, "cordis.patch.yml");
  if (existsSync5(homePatchPath)) {
    const patches = parsePatchFile(homePatchPath);
    layers.push({ label: "home-patch", kind: "home", patches: patches ?? [], parseError: patches === null ? "patch file is not a valid entry list" : null });
  }
  const composed = composeLayers(layers);
  const peerMismatches = [];
  const seenDeps = /* @__PURE__ */ new Set();
  for (const plugin of installedPackageNames(profileDirectory)) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync4(join6(profileDirectory, "node_modules", plugin, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const pluginDir = join6(profileDirectory, "node_modules", plugin);
    const map2 = pkg.peerDependencies;
    if (map2 === null || typeof map2 !== "object")
      continue;
    for (const [name2, spec] of Object.entries(map2)) {
      if (typeof spec !== "string")
        continue;
      const key = `${plugin}\0${name2}\0peer`;
      if (seenDeps.has(key))
        continue;
      seenDeps.add(key);
      const hoisted = readProfileVisibleVersion(profileDirectory, name2);
      const nested = readNodeModulesVersion(pluginDir, name2);
      const host = dshInstall !== null ? readNodeModulesVersion(dshInstall, name2) : null;
      const resolved = nested ?? hoisted ?? host;
      const satisfied = resolved !== null ? satisfiesRange(resolved, spec) : null;
      peerMismatches.push({
        plugin,
        name: name2,
        range: spec,
        resolved,
        satisfied: satisfied === null ? null : satisfied
      });
    }
  }
  const multiVersion = [];
  for (const [name2, versions] of lockfileCoreVersions(profileDirectory)) {
    if (versions.length < 2)
      continue;
    multiVersion.push({ name: name2, versions, hoisted: readProfileVisibleVersion(profileDirectory, name2) });
  }
  multiVersion.sort((a, b) => a.name.localeCompare(b.name));
  const errors = [];
  const warnings = [];
  for (const bundle of bundles) {
    if (bundle.error !== null)
      errors.push(`bundle ${bundle.name}: ${bundle.error}`);
    if (bundle.parseError !== null)
      errors.push(`bundle ${bundle.name}: ${bundle.parseError}`);
  }
  for (const layer of layers) {
    if (layer.parseError !== null && layer.kind !== "bundle")
      errors.push(`${layer.label}: ${layer.parseError}`);
  }
  for (const dup of composed.duplicates) {
    errors.push(`duplicate loader entry id ${JSON.stringify(dup.id)} (${dup.count} rows: ${dup.layers.join(", ")})`);
  }
  for (const orphan of composed.orphans) {
    warnings.push(`${orphan.layer}: ${orphan.id} \u2014 ${orphan.reason}`);
  }
  for (const mismatch of peerMismatches) {
    if (mismatch.satisfied === false) {
      warnings.push(`${mismatch.plugin} peer range ${mismatch.name}@${mismatch.range} does not match resolved ${String(mismatch.resolved)}`);
    }
  }
  for (const mv of multiVersion) {
    const line = `${mv.name}: ${mv.versions.join(" / ")}${mv.hoisted !== null ? ` (hoisted ${mv.hoisted})` : ""}`;
    if (core2.has(mv.name))
      errors.push(`multiple versions of core package \u2014 ${line}`);
    else
      warnings.push(`multiple versions of ${line}`);
  }
  const orderConflicts = validateOrder(bundleNames, readBundleRules(profileDirectory));
  for (const conflict of orderConflicts) {
    warnings.push(`${conflict.name}: ${conflict.reason}`);
  }
  for (const bundle of bundles) {
    const own = orderConflicts.filter((conflict) => conflict.name === bundle.name);
    if (own.length > 0)
      bundle.order = { ...bundle.order, conflicts: own };
  }
  const suggestedOrder = suggestOrder(bundleNames, readBundleRules(profileDirectory));
  if (suggestedOrder === null) {
  } else if (!suggestedOrder.ok) {
    warnings.push(`ordering constraints contain a cycle: ${suggestedOrder.cycle.join(" -> ")} \u2014 no compliant order exists / \u6392\u5E8F\u7EA6\u675F\u5B58\u5728\u5FAA\u73AF\u4F9D\u8D56\uFF0C\u65E0\u6CD5\u5F97\u51FA\u5408\u89C4\u987A\u5E8F`);
  } else {
    if (orderConflicts.length > 0) {
      warnings.push("current bundle order violates declared rules \u2014 a better order is suggested / \u5F53\u524D bundle \u987A\u5E8F\u8FDD\u53CD\u58F0\u660E\u89C4\u5219\uFF0C\u5DF2\u7ED9\u51FA\u66F4\u4F18\u987A\u5E8F");
    }
  }
  const nameCounts = /* @__PURE__ */ new Map();
  for (const row of composed.rows) {
    if (row.name === void 0)
      continue;
    const layers2 = nameCounts.get(row.name) ?? [];
    if (!layers2.includes(row.layer))
      layers2.push(row.layer);
    nameCounts.set(row.name, layers2);
  }
  const duplicateNames = [];
  for (const [name2, layers2] of nameCounts) {
    if (layers2.length < 2)
      continue;
    const count = composed.rows.filter((row) => row.name === name2).length;
    duplicateNames.push({ name: name2, layers: layers2, count });
  }
  duplicateNames.sort((a, b) => a.name.localeCompare(b.name));
  return {
    profile: profileDirectory,
    scannedAt: Date.now(),
    bundles,
    rows: composed.rows,
    duplicates: composed.duplicates,
    duplicateNames,
    overrides: composed.overrides,
    orphans: composed.orphans,
    peerMismatches,
    multiVersion,
    orderConflicts,
    suggestedOrder,
    summary: {
      ok: errors.length === 0,
      errors,
      warnings
    }
  };
}

// src-tauri/resources/dsh-market/src/host/compatibility.js
var SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
function parseComparator(part) {
  const p = part.trim();
  const m = /^(\^|~|>=|<=|>|<)?(.*)$/.exec(p);
  if (m === null)
    return null;
  const target = (m[2] ?? "").trim();
  if (!SEMVER.test(target))
    return null;
  const raw = m[1] ?? "";
  return { op: raw === "" ? "exact" : raw, target };
}
function nextBound(target, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(target);
  if (m === null)
    return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (kind === "^") {
    if (major > 0)
      return `${major + 1}.0.0-0`;
    if (minor > 0)
      return `0.${minor + 1}.0-0`;
    return `0.0.${patch + 1}-0`;
  }
  return `${major}.${minor + 1}.0-0`;
}
function boundsFor(range) {
  const alternatives = [];
  for (const rawAlternative of range.split("||")) {
    const parts = rawAlternative.trim().split(/\s+/).filter(Boolean);
    const parsed = parts.map(parseComparator);
    if (parsed.some((part) => part === null))
      return null;
    let lower = null;
    let upper = null;
    let explicitUpper = false;
    let exact = null;
    for (const part of parsed) {
      const p = part;
      if (p.op === "exact") {
        exact = p.target;
        continue;
      }
      if (p.op === "^" || p.op === "~") {
        const bound = nextBound(p.target, p.op);
        if (bound === null)
          return null;
        if (lower === null || compareSemver(p.target, lower.target) > 0)
          lower = p;
        if (upper === null || compareSemver(bound, upper.target) < 0)
          upper = { op: "<=", target: bound };
        continue;
      }
      if (p.op === ">=" || p.op === ">") {
        if (lower === null || compareSemver(p.target, lower.target) > 0)
          lower = p;
      } else {
        if (upper === null || compareSemver(p.target, upper.target) < 0)
          upper = p;
        explicitUpper = true;
      }
    }
    alternatives.push({ lower, upper, explicitUpper, exact });
  }
  return alternatives;
}
function belowAllMins(resolved, bounds) {
  return bounds.every((alternative) => {
    if (alternative.exact !== null)
      return compareSemver(resolved, alternative.exact) < 0;
    if (alternative.lower === null)
      return false;
    const lower = alternative.lower;
    return lower.op === ">" ? compareSemver(resolved, lower.target) <= 0 : compareSemver(resolved, lower.target) < 0;
  });
}
function aboveAllMaxes(resolved, bounds) {
  return bounds.every((alternative) => {
    if (alternative.exact !== null)
      return compareSemver(resolved, alternative.exact) > 0;
    if (alternative.upper === null)
      return false;
    const upper = alternative.upper;
    return upper.op === "<" ? compareSemver(resolved, upper.target) >= 0 : compareSemver(resolved, upper.target) > 0;
  });
}
function hasExplicitUpperOrExact(bounds) {
  return bounds.every((alternative) => alternative.exact !== null || alternative.explicitUpper);
}
function classifyPeer(plugin, peer, range, resolved, optional) {
  if (resolved === null)
    return { kind: "none" };
  if (optional) {
    return {
      kind: "warning",
      warning: { plugin, peer, range, resolved, reason: "optional" }
    };
  }
  const bounds = boundsFor(range);
  if (bounds === null)
    return { kind: "none" };
  if (belowAllMins(resolved, bounds)) {
    return {
      kind: "risk",
      risk: { plugin, peer, range, resolved, direction: "belowMin" }
    };
  }
  if (aboveAllMaxes(resolved, bounds)) {
    return hasExplicitUpperOrExact(bounds) ? {
      kind: "risk",
      risk: { plugin, peer, range, resolved, direction: "aboveMax" }
    } : {
      kind: "warning",
      warning: { plugin, peer, range, resolved, reason: "aboveMax" }
    };
  }
  return { kind: "none" };
}
function isOptionalPeer(profileDirectory, plugin, peer) {
  const manifest = readInstalledManifest("web", plugin, profileDirectory);
  return manifest?.peerDependenciesMeta?.[peer]?.optional === true;
}
function assessCompatibility(profileDirectory, options) {
  const report = analyzeProfile(profileDirectory, options);
  const risks = [];
  const warnings = [];
  for (const mismatch of report.peerMismatches) {
    if (mismatch.satisfied !== false)
      continue;
    const optional = isOptionalPeer(profileDirectory, mismatch.plugin, mismatch.name);
    const verdict = classifyPeer(mismatch.plugin, mismatch.name, mismatch.range, mismatch.resolved, optional);
    if (verdict.kind === "risk")
      risks.push(verdict.risk);
    else if (verdict.kind === "warning")
      warnings.push(verdict.warning);
  }
  return { risks, warnings, duplicateNames: report.duplicateNames };
}
function riskId(risk) {
  return `${risk.plugin}\0${risk.peer}\0${risk.direction}`;
}
function introducedRisks(before, after) {
  const seen = new Set(before.risks.map(riskId));
  return after.risks.filter((risk) => !seen.has(riskId(risk)));
}
function introducedDuplicateNames(before, after) {
  const seen = new Set(before.duplicateNames.map((entry) => entry.name));
  return after.duplicateNames.filter((entry) => !seen.has(entry.name));
}
function assessProfile(profile, explicitDir) {
  return assessCompatibility(profileDir(profile, explicitDir));
}

// src-tauri/resources/dsh-market/src/host/agents.js
function runningAgentIds(agents) {
  if (agents === void 0)
    return [];
  let listed;
  try {
    listed = agents.list();
  } catch {
    return [];
  }
  if (!Array.isArray(listed))
    return [];
  const ids = [];
  for (const agent of listed) {
    if (agent === null || typeof agent !== "object" || agent.status !== "running")
      continue;
    const id = typeof agent.id === "string" && agent.id !== "" ? agent.id : "agent";
    if (!ids.includes(id))
      ids.push(id);
  }
  return ids;
}

// src-tauri/resources/dsh-market/src/host/trial.js
import { existsSync as existsSync6, readFileSync as readFileSync5 } from "node:fs";
import { homedir as homedir5 } from "node:os";
import { join as join7 } from "node:path";
function trialValidate(profileDir2, newCommunityOrder, options = {}) {
  const errors = [];
  const warnings = [];
  const current = readBundleStack(profileDir2);
  const merged = mergeOrder(current.bundles, newCommunityOrder);
  if (!merged.ok) {
    return {
      ok: false,
      errors: [{ layer: "(order)", message: merged.error }],
      warnings,
      duplicates: [],
      rows: [],
      diff: { overrides: [], orphans: [], duplicates: [] }
    };
  }
  const candidate = merged.bundles;
  let specs = {};
  try {
    const manifest = JSON.parse(readFileSync5(join7(profileDir2, "package.json"), "utf8"));
    specs = manifest.dependencies ?? {};
  } catch {
  }
  const dshInstall = options.dshInstallDir !== void 0 ? options.dshInstallDir : findDshInstallDir2();
  const patchLayers = [];
  const userPatchPath = join7(profileDir2, "cordis.patch.yml");
  if (existsSync6(userPatchPath)) {
    const patches = parsePatchFile(userPatchPath);
    patchLayers.push({ label: "user-patch", kind: "user", patches: patches ?? [], parseError: null });
    if (patches === null)
      errors.push({ layer: "user-patch", message: "cordis.patch.yml is not a valid entry list / cordis.patch.yml \u4E0D\u662F\u5408\u6CD5\u7684\u6761\u76EE\u5217\u8868" });
  }
  const home = options.homeDir ?? process.env.DSH_HOME ?? join7(homedir5(), ".dsh");
  const homePatchPath = join7(home, "cordis.patch.yml");
  if (existsSync6(homePatchPath)) {
    const patches = parsePatchFile(homePatchPath);
    patchLayers.push({ label: "home-patch", kind: "home", patches: patches ?? [], parseError: null });
    if (patches === null)
      errors.push({ layer: "home-patch", message: "home cordis.patch.yml is not a valid entry list / \u5168\u5C40 cordis.patch.yml \u4E0D\u662F\u5408\u6CD5\u7684\u6761\u76EE\u5217\u8868" });
  }
  const compose = (bundleOrder) => {
    const built = buildBundleLayers(profileDir2, bundleOrder, specs, dshInstall);
    return { built, composed: composeLayers([...built.layers, ...patchLayers]) };
  };
  const currentState = compose(current.bundles);
  const candidateState = compose(candidate);
  const composed = candidateState.composed;
  for (const bundle of candidateState.built.bundles) {
    if (bundle.error !== null)
      errors.push({ layer: bundle.name, message: bundle.error });
    if (bundle.parseError !== null)
      errors.push({ layer: bundle.name, message: bundle.parseError });
  }
  for (const dup of composed.duplicates) {
    errors.push({ layer: dup.layers.join(" / "), message: `duplicate loader entry id ${JSON.stringify(dup.id)} (${dup.count} rows) / \u91CD\u590D\u7684 loader \u6761\u76EE id ${JSON.stringify(dup.id)}` });
  }
  for (const orphan of composed.orphans) {
    warnings.push({ layer: orphan.layer, message: `${orphan.id}: ${orphan.reason}` });
  }
  const currentDupIds = new Set(currentState.composed.duplicates.map((d) => d.id));
  const sameOverride = (a, b) => a.id === b.id && a.layer === b.layer && a.overriddenLayers.join("\0") === b.overriddenLayers.join("\0");
  const diff = {
    overrides: composed.overrides.filter((o) => !currentState.composed.overrides.some((c) => sameOverride(o, c))),
    orphans: composed.orphans.filter((o) => !currentState.composed.orphans.some((c) => c.id === o.id && c.layer === o.layer)),
    duplicates: composed.duplicates.filter((d) => !currentDupIds.has(d.id))
  };
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    duplicates: composed.duplicates,
    rows: composed.rows.map((row) => ({ id: row.id, layer: row.layer })),
    diff
  };
}

// src-tauri/resources/dsh-market/src/host/install.js
import { existsSync as existsSync7 } from "node:fs";
import { join as join9 } from "node:path";

// src-tauri/resources/dsh-market/src/host/store.js
import { readdirSync as readdirSync4, rmSync as rmSync2 } from "node:fs";
import { isAbsolute as isAbsolute3, join as join8 } from "node:path";
var ORPHAN_TMP_RE = /^_tmp_(\d+)_/;
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function cleanOrphanedStoreTmp(storePath) {
  const tmp = join8(storePath, "tmp");
  let entries2;
  try {
    entries2 = readdirSync4(tmp, { withFileTypes: true });
  } catch {
    return [];
  }
  const removed = [];
  for (const entry of entries2) {
    if (!entry.isDirectory())
      continue;
    const m = ORPHAN_TMP_RE.exec(entry.name);
    if (m === null)
      continue;
    const pid = Number(m[1]);
    if (pid > 0 && pidAlive(pid))
      continue;
    try {
      rmSync2(join8(tmp, entry.name), { recursive: true, force: true });
      removed.push(entry.name);
    } catch {
    }
  }
  return removed;
}
async function cleanOrphanedStore(run, profile) {
  let result;
  try {
    result = await run(profile, ["store", "path"]);
  } catch {
    return [];
  }
  if (result.exitCode !== 0 || result.cancelled)
    return [];
  const lines = result.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const storePath = lines[lines.length - 1] ?? "";
  if (storePath === "" || !isAbsolute3(storePath))
    return [];
  const removed = cleanOrphanedStoreTmp(storePath);
  if (removed.length > 0) {
    logEvent("info", "install", `removed ${removed.length} orphaned pnpm store tmp dir(s) under ${storePath}: ${removed.slice(0, 3).join(", ")}${removed.length > 3 ? ", \u2026" : ""}`);
  }
  return removed;
}

// src-tauri/resources/dsh-market/src/host/install.js
var RELEASE_AGE_OVERRIDE = "--config.minimumReleaseAge=0";
var FETCH_TIMEOUT_OVERRIDE = "--config.fetchTimeout=600000";
async function withHoistRecovery(run, profile, pluginArgs) {
  let result = await run(profile, pluginArgs);
  const ok = (r) => r.exitCode === 0 && !r.timedOut && !r.cancelled;
  if (!ok(result) && !result.cancelled) {
    const failure = classifyPnpmFailure(`${result.stderr}
${result.stdout}`);
    if (failure?.code === "hoist-pattern-diff") {
      logEvent("warn", "install", `modules dir was built by a different pnpm major \u2014 rebuilding (pnpm install) and retrying once`);
      const rebuild = await run(profile, ["install", "--no-frozen-lockfile"]);
      if (ok(rebuild))
        result = await run(profile, pluginArgs);
    } else if (failure?.code === "release-age-violation" && (pluginArgs[0] === "add" || pluginArgs[0] === "remove") && !pluginArgs.includes(RELEASE_AGE_OVERRIDE)) {
      logEvent("warn", "install", `a too-young release blocks pnpm's lockfile verification (#39) \u2014 retrying once with ${RELEASE_AGE_OVERRIDE}`);
      result = await run(profile, [pluginArgs[0], RELEASE_AGE_OVERRIDE, ...pluginArgs.slice(1)]);
    } else if (failure?.code === "transient-network" && (pluginArgs[0] === "add" || pluginArgs[0] === "remove")) {
      logEvent("warn", "install", `transient network failure while pnpm replayed the dependency tree (#83) \u2014 retrying once`);
      result = await run(profile, pluginArgs);
    } else if (failure?.code === "fetch-timeout" && (pluginArgs[0] === "add" || pluginArgs[0] === "remove") && !pluginArgs.includes(FETCH_TIMEOUT_OVERRIDE)) {
      logEvent("warn", "install", `pnpm's per-request fetch timeout aborted a large download \u2014 retrying once with ${FETCH_TIMEOUT_OVERRIDE}`);
      result = await run(profile, [pluginArgs[0], FETCH_TIMEOUT_OVERRIDE, ...pluginArgs.slice(1)]);
    }
  }
  if (!ok(result) && !result.cancelled) {
    await cleanOrphanedStore(run, profile);
    const failure = classifyPnpmFailure(`${result.stderr}
${result.stdout}`);
    if (failure !== null) {
      result = { ...result, stderr: `${result.stderr}

${failure.message}` };
    } else if (result.pnpmError !== void 0 && result.pnpmError !== "") {
      const code = result.pnpmErrorCode === void 0 ? "" : `${result.pnpmErrorCode}: `;
      result = { ...result, stderr: `${result.stderr}

${code}${result.pnpmError}` };
    }
  }
  return result;
}
function failureDetail(result, limit = 300) {
  if (result.pnpmError !== void 0 && result.pnpmError !== "") {
    const code = result.pnpmErrorCode === void 0 ? "" : `${result.pnpmErrorCode}: `;
    return `${code}${result.pnpmError}`.slice(0, limit);
  }
  return (result.stderr || result.stdout).slice(-limit);
}
async function retargetCollections(run, profile, before, target, explicitDir) {
  if (!target.startsWith("github:"))
    return true;
  const dir = profileDir(profile, explicitDir);
  const junk = Object.keys(readInstalled(profile, dir)).filter((name2) => {
    if (before.has(name2))
      return false;
    const root = join9(dir, "node_modules", name2);
    if (!existsSync7(join9(root, "package.json")))
      return true;
    return !hasDshManifest(root);
  });
  let allOk = true;
  for (const name2 of junk) {
    const root = join9(dir, "node_modules", name2);
    const candidates = pluginSubdirs(root);
    logEvent("info", "install", `${name2}: collection repo (root declares no dsh manifest); plugins inside: ${candidates.join(", ") || "none"}`);
    await run(profile, ["remove", name2]);
    if (candidates.length === 0) {
      allOk = false;
      continue;
    }
    for (const sub of candidates) {
      const result = await run(profile, ["add", `${target}#path:/${sub}`]);
      if (result.exitCode !== 0 || result.timedOut) {
        allOk = false;
        logEvent("error", "install", `${target}#path:/${sub}: exit=${String(result.exitCode)}${result.timedOut ? " TIMEOUT" : ""} \u2014 ${(result.stderr || result.stdout).slice(-220)}`);
      }
    }
  }
  return allOk;
}
async function validateAddedPlugins(run, profile, before, explicitDir) {
  const dir = profileDir(profile, explicitDir);
  const addedNow = Object.keys(readInstalled(profile, dir)).filter((n) => !before.has(n));
  const keep = [];
  const removedBroken = [];
  const conflicts = [];
  const existingBundles = readProfileBundles(dir).filter((name2) => !addedNow.includes(name2));
  for (const n of addedNow) {
    const packageDir = join9(dir, "node_modules", n);
    if (!hasDshManifest(packageDir) || !hasLoadableEntry(dir, n)) {
      removedBroken.push(n);
      await run(profile, ["remove", n]);
      continue;
    }
    const clash = conflictingEntryIds(dir, n, existingBundles);
    if (clash.length > 0) {
      conflicts.push(...clash.map((hit) => ({ name: n, ...hit })));
      removedBroken.push(n);
      logEvent("error", "install", `${n}: loader entry id conflict with ${clash[0].owner} (${clash.map((hit) => hit.id).join(", ")}) \u2014 removing, it would break the next boot`);
      await run(profile, ["remove", n]);
      continue;
    }
    keep.push(n);
  }
  return { added: addedNow, keep, removedBroken, conflicts };
}
function groupConflictsByOwner(conflicts) {
  const byOwner = /* @__PURE__ */ new Map();
  for (const hit of conflicts) {
    const ids = byOwner.get(hit.owner);
    if (ids === void 0)
      byOwner.set(hit.owner, [hit.id]);
    else if (!ids.includes(hit.id))
      ids.push(hit.id);
  }
  return [...byOwner].map(([owner, ids]) => ({ owner, ids }));
}
function parsePrepareNotAllowed(stdout, stderr) {
  const text = `${stdout}
${stderr}`.replace(/\\"/g, '"');
  const m = /git-hosted package "([^"]+)" needs to execute build scripts/.exec(text);
  if (m === null)
    return null;
  const raw = m[1].trim();
  const at = raw.lastIndexOf("@");
  return at > 0 ? raw.slice(0, at) : raw;
}
function parseIgnoredBuilds(stdout, stderr) {
  const m = /Ignored build scripts:?\s*([^\n]+)/i.exec(`${stdout}
${stderr}`);
  if (m === null)
    return [];
  const found = [];
  for (const chunk of m[1].split(",")) {
    const trimmed = chunk.trim().replace(/\.$/, "");
    if (trimmed === "")
      continue;
    const at = trimmed.lastIndexOf("@");
    const name2 = at > 0 ? trimmed.slice(0, at) : trimmed;
    if (name2 !== "" && !found.includes(name2))
      found.push(name2);
  }
  return found;
}

// src-tauri/resources/dsh-market/src/host/updates.js
var UPDATES_TTL_MS = 30 * 60 * 1e3;
var updatesCache = null;
function invalidateUpdates() {
  updatesCache = null;
}
var EXTRA_TAGS = {
  stable: [],
  beta: [DIST_TAG.beta],
  dev: [DIST_TAG.beta, DIST_TAG.dev]
};

// src-tauri/resources/dsh-market/src/host/themes.js
function createThemeManager(host, profile, disabledThemes, explicitDir) {
  const activeProfileDir = profileDir(profile, explicitDir);
  async function installedThemeNames() {
    const names = /* @__PURE__ */ new Set();
    try {
      const registry = await loadRegistry();
      const themeEntries = registry.plugins.filter((p) => p.category === "theme");
      const themeNames = new Set(themeEntries.map((p) => p.name));
      const themeRepos = new Set(themeEntries.map((p) => repoOf(p.url)).filter((r) => r !== null).map((r) => r.toLowerCase()));
      for (const [name2, spec] of Object.entries(readInstalled(profile, activeProfileDir))) {
        if (themeNames.has(name2)) {
          names.add(name2);
          continue;
        }
        const match = /github:([^#\s]+)/.exec(String(spec).toLowerCase());
        if (match !== null && themeRepos.has(match[1]))
          names.add(name2);
      }
    } catch {
    }
    return names;
  }
  async function setEntryDisabled(name2, disabledFlag) {
    let found = false;
    for (const entry of host.loader.entries()) {
      if (entry.options.name !== name2)
        continue;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await entry.update({ disabled: disabledFlag ? true : null }, false, true);
          found = true;
        } catch (error) {
          logEvent("warn", "toggle", `${name2}: entry update failed \u2014 ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
        const live = entry.fiber !== void 0;
        if (live !== disabledFlag)
          break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
      }
      logEvent("info", "toggle", `${name2} -> ${disabledFlag ? "off" : "on"}: fiber=${String(entry.fiber !== void 0)}`);
    }
    if (!found)
      logEvent("info", "toggle", `${name2}: no loader entry matched`);
    return found;
  }
  async function activateTheme(name2) {
    const themes = await installedThemeNames();
    for (const other of themes) {
      if (other === name2)
        continue;
      if (listHotMounts().includes(other)) {
        await hotUnmount(other);
        disabledThemes.add(other);
      } else if (await setEntryDisabled(other, true)) {
        disabledThemes.add(other);
      }
    }
    disabledThemes.delete(name2);
    writeDisabled(activeProfileDir, disabledThemes);
    if (listHotMounts().includes(name2))
      return true;
    if (await setEntryDisabled(name2, false))
      return true;
    return (await hotMount(host, activeProfileDir, name2)).ok;
  }
  return { installedThemeNames, setEntryDisabled, activateTheme };
}

// src-tauri/resources/dsh-market/src/host/http.js
function sendJson(response, status, payload) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}
function sameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin === void 0 || host === void 0)
    return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
async function readJsonBody(request, maxBytes = 4096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes)
      throw new Error("request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// src-tauri/resources/dsh-market/src/host/restart.js
import { spawn as spawn2 } from "node:child_process";
import { tmpdir } from "node:os";
import { join as join10 } from "node:path";
function detectedSupervisor(env = process.env, ppid = process.ppid) {
  const set2 = (name2) => (env[name2] ?? "") !== "";
  if ((set2("INVOCATION_ID") || set2("JOURNAL_STREAM")) && ppid === 1)
    return "systemd";
  return null;
}
function restartAllowed(config, env = process.env, ppid = process.ppid) {
  if (config.allowRestart !== void 0)
    return config.allowRestart;
  return detectedSupervisor(env, ppid) === null;
}
function servingPort(request) {
  const host = request.headers.host;
  if (host === void 0)
    return null;
  const match = /:(\d{1,5})$/u.exec(host);
  if (match === null)
    return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}
function trustedRestartRequest(request) {
  const address = request.socket.remoteAddress;
  if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1")
    return false;
  if (request.headers.forwarded !== void 0 || request.headers["x-forwarded-for"] !== void 0 || request.headers["x-real-ip"] !== void 0)
    return false;
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin === void 0 || host === void 0)
    return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
  } catch {
    return false;
  }
}
function trustedDownloadRequest(request) {
  const address = request.socket.remoteAddress;
  if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1")
    return false;
  if (request.headers.forwarded !== void 0 || request.headers["x-forwarded-for"] !== void 0 || request.headers["x-real-ip"] !== void 0)
    return false;
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (host === void 0)
    return false;
  if (origin === void 0)
    return true;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
  } catch {
    return false;
  }
}
function restartLaunch() {
  const launch = dshArgv();
  return {
    ...launch,
    args: [...launch.args, ...process.argv.slice(2)],
    cwd: launch.cwd ?? process.cwd()
  };
}
function respawnInvocation(launch, platform = process.platform) {
  if (platform !== "win32") {
    return { file: launch.file, args: launch.args, viaShell: launch.viaShell, detached: true };
  }
  const quote = (part) => `'${part.replace(/'/g, "''")}'`;
  return {
    file: "powershell.exe",
    args: [
      "-NoProfile",
      "-WindowStyle",
      "Hidden",
      "-Command",
      [`& ${quote(launch.file)}`, ...launch.args.map(quote)].join(" ")
    ],
    viaShell: false,
    detached: false
  };
}
function restartHelperSource(spawned, launch, logs, port) {
  return [
    "const { spawn } = require('node:child_process')",
    "const fs = require('node:fs')",
    "const net = require('node:net')",
    `const file = ${JSON.stringify(spawned.file)}`,
    `const args = ${JSON.stringify(spawned.args)}`,
    `const cwd = ${JSON.stringify(launch.cwd)}`,
    `const viaShell = ${JSON.stringify(spawned.viaShell)}`,
    `const detached = ${JSON.stringify(spawned.detached)}`,
    `const logOut = ${JSON.stringify(logs.out)}`,
    `const logErr = ${JSON.stringify(logs.err)}`,
    `const port = ${JSON.stringify(port)}`,
    "const sleep = (ms) => new Promise(r => setTimeout(r, ms))",
    "const note = (line) => { try { fs.appendFileSync(logErr, `[dsh-market] ${line}\n`) } catch {} }",
    // "Free" means nothing accepts a connection. Checked by connecting rather
    // than by binding: binding to test would itself hold the port for the
    // moment the replacement needs it.
    "const listening = () => new Promise((resolve) => {",
    '  const probe = net.connect({ host: "127.0.0.1", port })',
    "  const done = (value) => { probe.destroy(); resolve(value) }",
    '  probe.on("connect", () => done(true))',
    '  probe.on("error", () => done(false))',
    "  setTimeout(() => done(false), 500)",
    "})",
    "const main = async () => {",
    "  if (port) {",
    "    const until = Date.now() + 30000",
    "    while (Date.now() < until && await listening()) await sleep(250)",
    "    if (await listening()) note(`port ${port} was still in use after 30s; starting anyway`)",
    // A released socket can still be in TIME_WAIT for a moment on Windows.
    "    await sleep(300)",
    "  } else {",
    "    await sleep(1500)",
    "  }",
    "  let child",
    "  try {",
    '    const out = fs.openSync(logOut, "a")',
    '    const err = fs.openSync(logErr, "a")',
    '    child = spawn(file, args, { cwd, detached, stdio: ["ignore", out, err], env: process.env, shell: viaShell })',
    // spawn reports a missing or unexecutable file ASYNCHRONOUSLY; the
    // try/catch below only covers the synchronous throw, so without this
    // listener that failure is exactly as silent as the bug being fixed.
    '    child.on("error", (error) => note(`could not start the replacement: ${error && error.message ? error.message : error}`))',
    "    child.unref()",
    "  } catch (error) {",
    "    note(`could not start the replacement: ${error && error.message ? error.message : error}`)",
    "    return",
    "  }",
    // Outliving the spawn matters on Windows: a helper that exits the
    // instant it has spawned can take the replacement with it, because the
    // child is in its process group and has not detached yet. The port path
    // below already lingers while it polls; this is the same guarantee for
    // the path that has no port to poll. CI on windows-latest caught it —
    // locally it passes either way.
    "  if (!port) { await sleep(3000); return }",
    "  const upBy = Date.now() + 20000",
    "  while (Date.now() < upBy && !(await listening())) await sleep(500)",
    "  if (!(await listening())) note(`the replacement did not bind port ${port} within 20s \u2014 see the output log beside this one`)",
    "}",
    "main()"
  ].join("\n");
}
function scheduleRestart(port = null) {
  const launch = restartLaunch();
  const spawned = respawnInvocation(launch);
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logOut = join10(tmpdir(), `dsh-market-restart-${stamp}.out.log`);
  const logErr = join10(tmpdir(), `dsh-market-restart-${stamp}.err.log`);
  const helper = spawn2(nodeExecutable(), ["-e", restartHelperSource(spawned, launch, { out: logOut, err: logErr }, port)], {
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  helper.unref();
  setTimeout(() => process.kill(process.pid, "SIGTERM"), 500);
  return { pid: process.pid, helperPid: helper.pid, logOut, logErr };
}

// src-tauri/resources/dsh-market/src/host/verify.js
import { readFileSync as readFileSync6 } from "node:fs";
import { Script } from "node:vm";
import { join as join11 } from "node:path";
function readBundles(profile, explicitDir) {
  try {
    const manifest = JSON.parse(readFileSync6(join11(profileDir(profile, explicitDir), "package.json"), "utf8"));
    const bundles = manifest.dsh?.profile?.bundles;
    return new Set(Array.isArray(bundles) ? bundles.filter((n) => typeof n === "string") : []);
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function liveIncludes(live, packageName) {
  if (live.has(packageName))
    return true;
  const prefix = `${packageName}/`;
  for (const name2 of live)
    if (name2.startsWith(prefix))
      return true;
  return false;
}
function carriedRowLive(live, profileDirectory, packageName) {
  try {
    return bundlePatchInsertedIds(join11(profileDirectory, "node_modules", packageName)).some((id) => live.has(`#${id}`));
  } catch {
    return false;
  }
}
function readPkgDsh2(profile, name2, explicitDir) {
  try {
    const manifest = JSON.parse(readFileSync6(join11(profileDir(profile, explicitDir), "node_modules", name2, "package.json"), "utf8"));
    return manifest.dsh ?? {};
  } catch {
    return null;
  }
}
function patchTextOf(profile, name2, explicitDir) {
  try {
    return readFileSync6(join11(profileDir(profile, explicitDir), "node_modules", name2, "cordis.patch.yml"), "utf8");
  } catch {
    return null;
  }
}
function verifyActivation(profile, name2, live = new Set(listHotMounts()), explicitDir, isDisabled = false) {
  const activeProfileDir = profileDir(profile, explicitDir);
  const bundles = readBundles(profile, activeProfileDir);
  const inBundles = bundles.has(name2);
  const dsh = readPkgDsh2(profile, name2, activeProfileDir);
  if (dsh === null) {
    return { state: "missing", reasons: ["\u672A\u5B89\u88C5 / not installed"], bundle: inBundles, hot: false };
  }
  if (isDisabled) {
    return {
      state: "disabled",
      reasons: ["\u5DF2\u505C\u7528(\u5E02\u573A\u5F00\u5173\u6216\u8865\u4E01\u5C42),\u91CD\u542F\u540E\u4FDD\u6301\u5173\u95ED / disabled (market toggle or the patch layer) \u2014 stays off across restarts"],
      bundle: inBundles,
      hot: false
    };
  }
  const dir = join11(activeProfileDir, "node_modules", name2);
  const loaderLive = liveIncludes(live, name2) || carriedRowLive(live, activeProfileDir, name2);
  if (!hasDshManifest(dir)) {
    if (loaderLive) {
      return {
        state: "live",
        reasons: ["\u5DF2\u7531 Loader \u52A0\u8F7D(\u8BE5\u5305\u672A\u58F0\u660E dsh \u5143\u6570\u636E,\u7531\u67D0\u4E2A bundle patch \u6309\u540D\u52A0\u8F7D)/ loaded by the loader (no dsh metadata of its own \u2014 a bundle patch loads it by name)"],
        bundle: inBundles,
        hot: true
      };
    }
    return inBundles ? {
      state: "broken",
      reasons: ["\u5DF2\u5217\u5165 profile bundle \u5C42\u4F46\u672A\u58F0\u660E dsh \u5143\u6570\u636E,\u52A0\u8F7D\u4F1A\u5931\u8D25 / listed in the profile bundle layer but declares no dsh metadata \u2014 loading it fails"],
      bundle: true,
      hot: false
    } : {
      state: "inert",
      reasons: ["\u666E\u901A\u4F9D\u8D56(\u672A\u58F0\u660E dsh \u5143\u6570\u636E),\u4E0D\u662F profile \u5C42\u63D2\u4EF6;\u82E5\u5B83\u7531\u67D0\u4E2A bundle patch \u6309\u540D\u52A0\u8F7D,\u542F\u52A8\u540E\u4F1A\u663E\u793A\u4E3A\u5DF2\u52A0\u8F7D / a plain dependency with no dsh metadata \u2014 not a profile-layer plugin; if some bundle patch loads it by name it will read as live once running"],
      bundle: false,
      hot: false
    };
  }
  if (!loaderLive && !hasLoadableEntry(activeProfileDir, name2)) {
    return {
      state: "broken",
      reasons: [
        "\u58F0\u660E\u7684\u5165\u53E3\u4EA7\u7269\u7F3A\u5931(\u6E90\u7801\u68C0\u51FA\u6216\u6784\u5EFA\u88AB\u62E6),\u4E0B\u6B21\u542F\u52A8\u4F1A\u5931\u8D25 / the declared entry artifact is missing (source-only checkout or blocked build) \u2014 the next boot would fail"
      ],
      bundle: inBundles,
      hot: false
    };
  }
  if (loaderLive) {
    const clientOnly = dsh.bundle === void 0 && dsh.client !== void 0;
    return {
      state: "live",
      reasons: [
        clientOnly ? "\u5DF2\u70ED\u52A0\u8F7D(\u7EAF\u5BA2\u6237\u7AEF\u63D2\u4EF6 shim)/ live via the client-only shim" : "\u5DF2\u70ED\u52A0\u8F7D(bundle patch)/ live via its bundle patch"
      ],
      bundle: inBundles,
      hot: true
    };
  }
  if (inBundles) {
    const patch = patchTextOf(profile, name2, activeProfileDir);
    const complex = patch !== null && parseSimplePatch(patch) === null;
    return {
      state: "restart",
      reasons: [
        complex ? "bundle patch \u542B\u914D\u7F6E/\u8868\u8FBE\u5F0F,\u70ED\u6302\u8F7D\u4EC5\u652F\u6301\u7EAF insert;\u91CD\u542F\u540E\u7531 bundle \u5C42\u751F\u6548 / the bundle patch contains config/expression rows; hot-mount only supports plain inserts \u2014 it activates on restart" : "\u5DF2\u8FDB\u5165 profile bundle \u5C42\u4F46\u672C\u6B21\u672A\u80FD\u70ED\u6302\u8F7D;\u91CD\u542F\u540E\u751F\u6548 / in the bundle layer but not hot-mounted this session \u2014 it activates on restart"
      ],
      bundle: true,
      hot: false
    };
  }
  if (dsh.client !== void 0) {
    return {
      state: "inert",
      reasons: [
        "\u672A\u58F0\u660E dsh.bundle,\u4E0D\u4F1A\u8FDB\u5165 profile bundle \u5C42(\u7EAF\u5BA2\u6237\u7AEF\u63D2\u4EF6);\u91CD\u542F\u540E\u7531\u5E02\u573A\u81EA\u52A8\u6302\u8F7D\u751F\u6548 / no dsh.bundle \u2014 client-only plugins never enter the bundle layer; the market shim-mounts them at the next boot"
      ],
      bundle: false,
      hot: false
    };
  }
  return {
    state: "inert",
    reasons: [
      "\u672A\u58F0\u660E dsh.bundle,\u5DF2\u4F5C\u4E3A\u666E\u901A\u4F9D\u8D56\u5B89\u88C5,\u4E0D\u4F1A\u6210\u4E3A profile \u5C42 / no dsh.bundle \u2014 installed as a plain dependency, never a profile-layer plugin"
    ],
    bundle: false,
    hot: false
  };
}
function clientBundlePath(exportsField, depth = 0) {
  if (depth > 4)
    return null;
  if (typeof exportsField === "string") {
    return exportsField.startsWith("./") ? exportsField : null;
  }
  if (exportsField === null || typeof exportsField !== "object" || Array.isArray(exportsField))
    return null;
  const conditions = exportsField;
  for (const key of ["browser", "default"]) {
    if (conditions[key] === void 0)
      continue;
    const resolved = clientBundlePath(conditions[key], depth + 1);
    if (resolved !== null)
      return resolved;
  }
  return null;
}
function checkClientBundle(profile, name2, explicitDir) {
  const root = join11(profileDir(profile, explicitDir), "node_modules", name2);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync6(join11(root, "package.json"), "utf8"));
  } catch {
    return { ok: true, reason: null };
  }
  if (manifest.dsh?.client === void 0)
    return { ok: true, reason: null };
  const exportsField = manifest.exports;
  const relative3 = exportsField !== null && typeof exportsField === "object" && !Array.isArray(exportsField) ? clientBundlePath(exportsField["./client"]) : null;
  if (relative3 === null)
    return { ok: true, reason: null };
  let source;
  try {
    source = readFileSync6(join11(root, relative3), "utf8");
  } catch {
    return { ok: true, reason: null };
  }
  try {
    new Script(source, { filename: relative3 });
    return { ok: true, reason: null };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

// src-tauri/resources/dsh-market/src/host/patch.js
import { readFileSync as readFileSync7, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join12 } from "node:path";
import { fileURLToPath } from "node:url";
var PROTECTED_MODULE_PATTERNS = [
  /^cordis:/u,
  /^@deepseek-ai\/cordis-plugin-/u,
  /^@deepseek-ai\/dsh-host-/u,
  /^@deepseek-ai\/dsh-client-modules$/u,
  /^@deepseek-ai\/dsh-client-connection$/u,
  /^@deepseek-ai\/dsh-client-hmr$/u,
  /^@deepseek-ai\/dsh-client-runtime$/u,
  /^@deepseek-ai\/dsh-client-locale$/u,
  /^@deepseek-ai\/dsh-client-web/u,
  /^@deepseek-ai\/dsh-web-frontend$/u,
  /^@deepseek-ai\/dsh-web-app$/u,
  /^@deepseek-ai\/dsh-settings/u,
  /^@deepseek-ai\/dsh-credentials/u,
  /^@deepseek-ai\/dsh-session/u,
  /^@deepseek-ai\/dsh-storage/u,
  /^@deepseek-ai\/dsh-typert/u,
  /^@deepseek-ai\/dsh-api-remotes$/u,
  /^@deepseek-ai\/dsh-tools$/u,
  /^@deepseek-ai\/dsh-system-prompt$/u,
  /^@deepseek-ai\/dsh-agent/u,
  /^@deepseek-ai\/dsh-llm/u,
  /^@deepseek-ai\/dsh-persona$/u,
  /^@deepseek-ai\/dsh-scope$/u,
  /^@deepseek-ai\/dsh-launch-environment$/u,
  /^@deepseek-ai\/dsh-shell$/u,
  /^@deepseek-ai\/dsh-subprocess/u,
  /^@deepseek-ai\/dsh-fs/u,
  /^@deepseek-ai\/dsh-sandbox/u,
  /^@deepseek-ai\/dsh-jobs/u,
  /^@deepseek-ai\/dsh-skill/u,
  /^@deepseek-ai\/dsh-goal/u,
  /^@deepseek-ai\/dsh-workflow/u,
  /^@deepseek-ai\/dsh-subagent/u,
  /^@deepseek-ai\/dsh-web$/u,
  /^@deepseek-ai\/dsh-workspace/u,
  /^@deepseek-ai\/dsh-user-approval$/u,
  /^@deepseek-ai\/dsh-user-questions$/u,
  /^@deepseek-ai\/dsh-commands$/u,
  /^@deepseek-ai\/dsh-hook/u,
  /^@deepseek-ai\/dsh-spill/u,
  /^@deepseek-ai\/dsh-guard/u,
  /^@deepseek-ai\/dsh-tool-call-timeout-policy$/u,
  /^@deepseek-ai\/dsh-repeat-tool-reminder$/u
];
function isProtectedModule(moduleName) {
  return typeof moduleName === "string" && PROTECTED_MODULE_PATTERNS.some((pattern) => pattern.test(moduleName));
}
function findUserPatchPath(host, profileDir2) {
  for (const entry of host.loader.entries()) {
    const cfg = entry.options?.config;
    if (entry.options?.name !== "cordis:include" || cfg == null || typeof cfg.path !== "string")
      continue;
    if (!cfg.path.includes("cordis.yml"))
      continue;
    let includePath = cfg.path;
    if (includePath.startsWith("file://")) {
      try {
        includePath = fileURLToPath(includePath);
      } catch {
        includePath = includePath.replace(/^file:\/\//u, "");
      }
    }
    return includePath.replace(/cordis\.yml$/u, "cordis.patch.yml");
  }
  return join12(profileDir2, "cordis.patch.yml");
}
var ROW_ID_RE = /^[A-Za-z0-9_.-]+$/u;
function readUserPatchState(patchPath) {
  const disables = [];
  const forced = [];
  const inserts = [];
  let text = "";
  try {
    text = readFileSync7(patchPath, "utf8");
  } catch {
  }
  const lines = text.split(/\r?\n/u);
  let inInsert = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^- insert:\s*$/u.test(line)) {
      inInsert = true;
      continue;
    }
    if (/^- /u.test(line))
      inInsert = false;
    if (inInsert) {
      const insertRow = /^ {4}- id: ([A-Za-z0-9_.-]+)/u.exec(line);
      if (insertRow !== null)
        inserts.push(insertRow[1]);
      continue;
    }
    const disableRow2 = /^- id: ([A-Za-z0-9_.-]+)\s*$/u.exec(line);
    if (disableRow2 === null)
      continue;
    const next = lines[index + 1] ?? "";
    if (/^ {2}disabled: true\s*$/u.test(next))
      disables.push(disableRow2[1]);
    else if (/^ {2}disabled: false\s*$/u.test(next))
      forced.push(disableRow2[1]);
  }
  return { disables, forced, inserts };
}
function includePrefix(host) {
  for (const entry of host.loader.entries()) {
    if (entry.options?.name === "cordis:include" && typeof entry.options.id === "string") {
      return `${entry.options.id}:`;
    }
  }
  return "";
}
function rowIdsForPackage(host, profileDirectory, packageName) {
  const ids = /* @__PURE__ */ new Set();
  const packageDir = join12(profileDirectory, "node_modules", packageName);
  try {
    for (const id of bundlePatchInsertedIds(packageDir))
      ids.add(id);
  } catch {
  }
  try {
    for (const id of parsePatchRows(readFileSync7(join12(packageDir, "cordis.patch.yml"), "utf8")).insertedIds) {
      ids.add(id);
    }
  } catch {
  }
  const prefix = includePrefix(host);
  for (const entry of host.loader.entries()) {
    if (entry.options?.name !== packageName)
      continue;
    let id = entry.options.id ?? "";
    if (id === "")
      continue;
    if (prefix !== "" && id.startsWith(prefix))
      id = id.slice(prefix.length);
    if (/^(?:mkt-|client-)/u.test(id))
      continue;
    ids.add(id);
  }
  return [...ids];
}
function foreignDisableIds(rows) {
  const ids = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row))
      continue;
    const record = row;
    const id = record.id;
    if (typeof id === "string" && record.disabled === true && !ids.includes(id))
      ids.push(id);
  }
  return ids;
}
function carrierDisableIds(profileDirectory, packageName) {
  const packageDir = join12(profileDirectory, "node_modules", packageName);
  const disabled = /* @__PURE__ */ new Set();
  const collectFromFile = (patchPath) => {
    const rows = parsePatchFile(patchPath);
    if (rows === null)
      return;
    for (const id of foreignDisableIds(rows))
      disabled.add(id);
  };
  try {
    const manifest = JSON.parse(readFileSync7(join12(packageDir, "package.json"), "utf8"));
    const declared = manifest.dsh?.bundle?.patch;
    if (typeof declared === "string" && declared !== "")
      collectFromFile(join12(packageDir, declared));
  } catch {
  }
  collectFromFile(join12(packageDir, "cordis.patch.yml"));
  return [...disabled];
}
function packagePatchFlags(host, profileDirectory, names, state) {
  const disabled = [];
  const forced = [];
  for (const name2 of names) {
    const rows = rowIdsForPackage(host, profileDirectory, name2);
    if (rows.some((id) => state.disables.includes(id)))
      disabled.push(name2);
    if (rows.some((id) => state.forced.includes(id)))
      forced.push(name2);
  }
  return { disabled, forced };
}
var writeQueue = Promise.resolve();
function queuedWrite(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(() => void 0, () => void 0);
  return run;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function rowBlock(rowId, disabled) {
  return `- id: ${rowId}
  disabled: ${disabled ? "true" : "false"}
`;
}
function appendPatchEntry(patchPath, block) {
  let text = "";
  try {
    text = readFileSync7(patchPath, "utf8");
  } catch {
  }
  const core2 = text.trim();
  if (core2 === "") {
    writeFileSync4(patchPath, block);
    return { ok: true, reason: null };
  }
  const withoutComments = text.replace(/^[ \t]*#.*$/gmu, "").trim();
  if (withoutComments === "") {
    const next2 = text.endsWith("\n") ? text : `${text}
`;
    writeFileSync4(patchPath, `${next2}${block}`);
    return { ok: true, reason: null };
  }
  if (withoutComments === "[]" || withoutComments === "[ ]") {
    const commented = text.replace(/^[ \t]*\[[ \t]*\][ \t]*(?:#.*)?(?:\r?\n|$)/mu, "# []\n");
    const next2 = commented.endsWith("\n") ? commented : `${commented}
`;
    writeFileSync4(patchPath, `${next2}${block}`);
    return { ok: true, reason: null };
  }
  const lastContentLine = text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#")).pop() ?? "";
  if (/^[[{]/u.test(lastContentLine)) {
    return {
      ok: false,
      reason: "\u8865\u4E01\u5C42\u4EE5\u9876\u5C42\u6D41\u5F0F\u7ED3\u6784\u7ED3\u5C3E,\u4E0D\u652F\u6301\u81EA\u52A8\u8FFD\u52A0;\u8BF7\u5148\u6574\u7406\u4E3A\u6761\u76EE\u5217\u8868 / the patch layer ends in a top-level flow structure; refusing to append \u2014 tidy the file into an entry list first"
    };
  }
  if (parsePatchFile(patchPath) === null) {
    return {
      ok: false,
      reason: "\u8865\u4E01\u5C42\u4E0D\u662F\u5408\u6CD5\u7684\u6761\u76EE\u6570\u7EC4,\u5DF2\u62D2\u7EDD\u8FFD\u52A0\u4EE5\u514D\u7834\u574F;\u8BF7\u5148\u4FEE\u6B63 YAML / the patch layer is not a valid entry list; refused to append \u2014 fix the YAML first"
    };
  }
  const next = text.endsWith("\n") ? text : `${text}
`;
  writeFileSync4(patchPath, `${next}${block}`);
  return { ok: true, reason: null };
}
function disableRow(patchPath, rowId) {
  return queuedWrite(async () => {
    if (!ROW_ID_RE.test(rowId)) {
      return { ok: false, reason: `\u884C id \u542B\u7279\u6B8A\u5B57\u7B26,\u4E0D\u652F\u6301\u5199\u5165\u8865\u4E01\u5C42 / row id ${rowId} cannot be written to the patch layer` };
    }
    const state = readUserPatchState(patchPath);
    if (state.disables.includes(rowId))
      return { ok: true, reason: null };
    const result = appendPatchEntry(patchPath, rowBlock(rowId, true));
    if (result.ok)
      logEvent("info", "patch", `disabled row ${rowId} in ${patchPath}`);
    return result;
  });
}
function enableRow(patchPath, rowId) {
  return queuedWrite(async () => {
    if (!ROW_ID_RE.test(rowId)) {
      return { ok: false, reason: `\u884C id \u542B\u7279\u6B8A\u5B57\u7B26,\u4E0D\u652F\u6301\u5199\u5165\u8865\u4E01\u5C42 / row id ${rowId} cannot be written to the patch layer` };
    }
    const state = readUserPatchState(patchPath);
    const blockRe = new RegExp(`^- id: ['"]?${escapeRegExp(rowId)}['"]?\\r?\\n  disabled: true\\r?\\n`, "mu");
    const text = (() => {
      try {
        return readFileSync7(patchPath, "utf8");
      } catch {
        return "";
      }
    })();
    if (blockRe.test(text)) {
      writeFileSync4(patchPath, withPlaceholderRestored(text.replace(blockRe, "")));
      logEvent("info", "patch", `enabled row ${rowId} in ${patchPath}`);
      return { ok: true, reason: null };
    }
    if (state.forced.includes(rowId))
      return { ok: true, reason: null };
    const result = appendPatchEntry(patchPath, rowBlock(rowId, false));
    if (result.ok)
      logEvent("info", "patch", `force-enabled row ${rowId} in ${patchPath}`);
    return result;
  });
}
function withPlaceholderRestored(text) {
  if (text.replace(/^[ \t]*#.*$/gmu, "").trim() !== "")
    return text;
  const uncommented = text.replace(/^[ \t]*#[ \t]*\[[ \t]*\][ \t]*(?:\r?\n|$)/mu, "[]\n");
  if (uncommented !== text)
    return uncommented;
  return text === "" || text.endsWith("\n") ? `${text}[]
` : `${text}
[]
`;
}
function removeRowBlocks(patchPath, rowIds) {
  let text = "";
  try {
    text = readFileSync7(patchPath, "utf8");
  } catch {
    return;
  }
  let next = text;
  for (const rowId of rowIds) {
    const blockRe = new RegExp(`^- id: ['"]?${escapeRegExp(rowId)}['"]?\\r?\\n  disabled: (?:true|false)\\r?\\n`, "mu");
    next = next.replace(blockRe, "");
  }
  if (next !== text) {
    writeFileSync4(patchPath, withPlaceholderRestored(next));
    logEvent("info", "patch", `removed patch rows for ${rowIds.join(", ")}`);
  }
}

// src-tauri/resources/dsh-market/src/host/backup.js
import { existsSync as existsSync8, lstatSync, mkdirSync as mkdirSync2, readFileSync as readFileSync8, readdirSync as readdirSync5, renameSync as renameSync3, rmSync as rmSync3, writeFileSync as writeFileSync5 } from "node:fs";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { dirname as dirname5, isAbsolute as isAbsolute4, relative as relative2, resolve as resolve5, sep } from "node:path";
var BACKUP_FORMAT = "dsh-profile-backup";
var MAX_BACKUP_BYTES = 2 * 1024 * 1024;
var MAX_FILES = 256;
var SKIP_NAMES = /* @__PURE__ */ new Set(["node_modules", ".dsh-market", ".git", "pnpm-lock.yaml"]);
function profileFiles(root, dir = root) {
  const files = [];
  for (const entry of readdirSync5(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name) || /\.bak\b/.test(entry.name))
      continue;
    const path = resolve5(dir, entry.name);
    if (entry.isSymbolicLink())
      continue;
    if (entry.isDirectory())
      files.push(...profileFiles(root, path));
    else if (entry.isFile())
      files.push(relative2(root, path).split(sep).join("/"));
    if (files.length > MAX_FILES)
      throw new Error(`profile has more than ${MAX_FILES} configuration files`);
  }
  return files;
}
function createProfileBackup(profile, explicitDir, opts) {
  const root = resolve5(explicitDir ?? profileDir(profile));
  const manifestFile = resolve5(root, "package.json");
  if (!existsSync8(manifestFile))
    throw new Error("profile package.json is missing");
  const manifest = JSON.parse(readFileSync8(manifestFile, "utf8"));
  if (opts?.includeDeps !== void 0) {
    const include = new Set(opts.includeDeps);
    if (include.size === 0)
      throw new Error("no plugins selected");
    const dependencies = manifest.dependencies === null || typeof manifest.dependencies !== "object" || Array.isArray(manifest.dependencies) ? {} : manifest.dependencies;
    const filteredDeps = {};
    for (const [name2, spec] of Object.entries(dependencies))
      if (include.has(name2))
        filteredDeps[name2] = spec;
    const dsh = manifest.dsh === null || typeof manifest.dsh !== "object" || Array.isArray(manifest.dsh) ? void 0 : manifest.dsh;
    const profileBlock = dsh?.profile === null || typeof dsh?.profile !== "object" || Array.isArray(dsh?.profile) ? void 0 : dsh.profile;
    const bundles = Array.isArray(profileBlock?.bundles) ? profileBlock.bundles : [];
    const filteredBundles = bundles.filter((name2) => typeof name2 === "string" && include.has(name2));
    if (Object.keys(filteredDeps).length === 0 && filteredBundles.length === 0) {
      throw new Error("none of the selected plugins are in this profile");
    }
    const filteredManifest = { ...manifest };
    filteredManifest.dependencies = filteredDeps;
    if (dsh !== void 0) {
      filteredManifest.dsh = { ...dsh, profile: { ...profileBlock ?? {}, bundles: filteredBundles } };
    }
    const files2 = [{ path: "package.json", json: filteredManifest }];
    if (opts.includeConfig === true) {
      for (const path of profileFiles(root).sort()) {
        if (path === "package.json")
          continue;
        files2.push({ path, lines: readFileSync8(resolve5(root, path), "utf8").split(/\r?\n/) });
      }
    }
    const partial = { format: BACKUP_FORMAT, version: 0.2, createdAt: (/* @__PURE__ */ new Date()).toISOString(), profile, files: files2 };
    if (Buffer.byteLength(JSON.stringify(partial)) > MAX_BACKUP_BYTES)
      throw new Error("profile configuration is too large to back up");
    return partial;
  }
  const files = profileFiles(root).sort().map((path) => {
    const content = readFileSync8(resolve5(root, path), "utf8");
    return path === "package.json" ? { path, json: JSON.parse(content) } : { path, lines: content.split(/\r?\n/) };
  });
  if (!files.some((file) => file.path === "package.json"))
    throw new Error("profile package.json is missing");
  const backup = { format: BACKUP_FORMAT, version: 0.2, createdAt: (/* @__PURE__ */ new Date()).toISOString(), profile, files };
  if (Buffer.byteLength(JSON.stringify(backup)) > MAX_BACKUP_BYTES)
    throw new Error("profile configuration is too large to back up");
  return backup;
}
function validatedBackup(value) {
  if (value === null || typeof value !== "object")
    throw new Error("invalid backup");
  const backup = value;
  if (backup.format !== BACKUP_FORMAT || backup.version !== 0.2 || !Array.isArray(backup.files)) {
    throw new Error("unsupported backup format");
  }
  if (backup.files.length > MAX_FILES)
    throw new Error("invalid backup contents");
  const files = [];
  const paths = /* @__PURE__ */ new Set();
  for (const value2 of backup.files) {
    if (value2 === null || typeof value2 !== "object")
      throw new Error("invalid backup contents");
    const file = value2;
    const path = file.path;
    if (typeof path !== "string")
      throw new Error("invalid backup contents");
    if (path === "" || isAbsolute4(path) || path.split(/[\\/]/).includes(".."))
      throw new Error(`unsafe backup path: ${path}`);
    const normalized = path.replaceAll("\\", "/");
    if (normalized.split("/").some((part) => SKIP_NAMES.has(part)))
      throw new Error(`excluded backup path: ${path}`);
    if (paths.has(normalized))
      throw new Error(`duplicate backup path: ${path}`);
    paths.add(normalized);
    if (path === "package.json") {
      if (file.json === null || typeof file.json !== "object" || Array.isArray(file.json))
        throw new Error("backup package.json is invalid");
      files.push({ path, json: file.json });
    } else {
      if (!Array.isArray(file.lines) || !file.lines.every((line) => typeof line === "string"))
        throw new Error(`invalid file content: ${path}`);
      files.push({ path, lines: file.lines });
    }
  }
  if (!files.some((file) => file.path === "package.json"))
    throw new Error("invalid backup contents");
  if (Buffer.byteLength(JSON.stringify(backup)) > MAX_BACKUP_BYTES)
    throw new Error("backup is too large");
  return { ...backup, files };
}
function restoreProfileBackup(profile, value, explicitDir) {
  const backup = validatedBackup(value);
  const root = resolve5(explicitDir ?? profileDir(profile));
  const previous = /* @__PURE__ */ new Map();
  mkdirSync2(root, { recursive: true });
  const rollback = () => {
    for (const [target, content] of previous) {
      if (content === null)
        rmSync3(target, { force: true });
      else
        writeFileSync5(target, content);
    }
  };
  try {
    for (const file of backup.files) {
      const { path } = file;
      const target = resolve5(root, path);
      if (!target.startsWith(root + sep))
        throw new Error(`unsafe backup path: ${path}`);
      ensureSafeParent(root, dirname5(target), path);
      if (existsSync8(target) && !lstatSync(target).isFile())
        throw new Error(`backup path is not a file: ${path}`);
      previous.set(target, existsSync8(target) ? readFileSync8(target) : null);
      const temp = `${target}.dsh-restore-${String(process.pid)}`;
      writeFileSync5(temp, "json" in file ? `${JSON.stringify(file.json, null, 2)}
` : file.lines.join("\n"), "utf8");
      renameSync3(temp, target);
    }
  } catch (error) {
    rollback();
    throw error;
  }
  return {
    files: previous.size,
    rollback
  };
}
function ensureSafeParent(root, parent, backupPath) {
  const relativeParent = relative2(root, parent);
  if (relativeParent === "")
    return;
  let current = root;
  for (const part of relativeParent.split(sep)) {
    current = resolve5(current, part);
    if (!existsSync8(current)) {
      mkdirSync2(current);
      continue;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error(`unsafe backup path: ${backupPath}`);
  }
}
async function webdavRequest(url, username, password, method, body) {
  const parsed = new URL(url);
  if (parsed.protocol === "http:")
    throw new Error("WebDAV requires an https:// URL");
  if (parsed.protocol !== "https:")
    throw new Error("invalid WebDAV URL");
  if (parsed.username !== "" || parsed.password !== "")
    throw new Error("invalid WebDAV URL");
  const address = await resolvePublicAddress(parsed.hostname);
  const headers = { host: parsed.host };
  if (body !== void 0) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(body));
  }
  if (username !== "")
    headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  return await new Promise((resolveRequest, reject) => {
    const originalHostname = unbracketedHostname(parsed.hostname);
    const request = httpsRequest({
      protocol: "https:",
      hostname: address.address,
      family: address.family,
      port: parsed.port === "" ? 443 : Number(parsed.port),
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers,
      servername: isIP(originalHostname) === 0 ? originalHostname : void 0,
      signal: AbortSignal.timeout(3e4)
    }, (response) => {
      const chunks = [];
      let size = 0;
      const maxBytes = method === "GET" ? MAX_BACKUP_BYTES : 64 * 1024;
      response.once("error", reject);
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.destroy(new Error("WebDAV response is too large"));
        return;
      }
      response.on("data", (chunk) => {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += value.byteLength;
        if (size > maxBytes) {
          response.destroy(new Error("WebDAV response is too large"));
          return;
        }
        chunks.push(value);
      });
      response.once("end", () => resolveRequest({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    request.once("error", reject);
    request.end(body);
  });
}
function webdavParentCollections(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const parts = parsed.pathname.split("/").filter((part) => part !== "");
  parts.pop();
  const collections = [];
  let path = "";
  for (const part of parts) {
    path += `/${part}`;
    collections.push(`${parsed.origin}${path}/`);
  }
  return collections;
}
async function uploadWebdav(url, username, password, backup) {
  for (const collection of webdavParentCollections(url)) {
    try {
      await webdavRequest(collection, username, password, "MKCOL");
    } catch {
    }
  }
  const response = await webdavRequest(url, username, password, "PUT", JSON.stringify(backup));
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.status === 404 ? `WebDAV upload failed: HTTP 404 \u2014 the target folder does not exist and could not be created. Some providers (e.g. Jianguoyun) refuse files at the root: use a path inside a folder, e.g. https://dav.example.com/dsh/backup.json / \u76EE\u6807\u76EE\u5F55\u4E0D\u5B58\u5728\u4E14\u65E0\u6CD5\u81EA\u52A8\u521B\u5EFA\uFF1B\u90E8\u5206\u670D\u52A1\u5546\uFF08\u5982\u575A\u679C\u4E91\uFF09\u4E0D\u5141\u8BB8\u5728\u6839\u76EE\u5F55\u653E\u6587\u4EF6\uFF0C\u8BF7\u4F7F\u7528\u5F62\u5982 https://dav.example.com/dsh/backup.json \u7684\u5B50\u76EE\u5F55\u8DEF\u5F84` : `WebDAV upload failed: HTTP ${response.status}`);
  }
}
function isPublicIpv4(ip) {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224)
    return false;
  if (a === 100 && b >= 64 && b <= 127)
    return false;
  if (a === 169 && b === 254)
    return false;
  if (a === 172 && b >= 16 && b <= 31)
    return false;
  if (a === 192 && (b === 0 || b === 168))
    return false;
  if (a === 198 && (b === 18 || b === 19))
    return false;
  return true;
}
function isPublicHostname(hostname) {
  const lower = unbracketedHostname(hostname).toLowerCase();
  const bare = lower.endsWith(".") ? lower.slice(0, -1) : lower;
  return bare !== "" && bare !== "localhost" && bare !== "metadata.google.internal" && !bare.endsWith(".localhost") && !bare.endsWith(".internal") && !bare.endsWith(".local");
}
function isPublicTarget(hostname) {
  const bare = unbracketedHostname(hostname);
  const family = isIP(bare);
  if (family === 4)
    return isPublicIpv4(bare);
  if (family === 6)
    return isPublicIpv6(bare);
  return isPublicHostname(bare);
}
function isPublicIpv6(ip) {
  const bare = unbracketedHostname(ip);
  if (isIP(bare) !== 6)
    return false;
  const first = Number.parseInt(bare.split(":", 1)[0] || "0", 16);
  return Number.isFinite(first) && first >= 8192 && first <= 16383;
}
function unbracketedHostname(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}
async function resolvePublicAddress(hostname) {
  const bare = unbracketedHostname(hostname);
  const family = isIP(bare);
  if (family === 4 || family === 6) {
    if (!isPublicTarget(bare))
      throw new Error("invalid WebDAV URL");
    return { address: bare, family };
  }
  if (!isPublicHostname(bare))
    throw new Error("invalid WebDAV URL");
  const addresses = await lookup(bare, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicTarget(address))) {
    throw new Error("invalid WebDAV URL");
  }
  const selected = addresses[0];
  if (selected.family !== 4 && selected.family !== 6)
    throw new Error("invalid WebDAV URL");
  return { address: selected.address, family: selected.family };
}
async function downloadWebdav(url, username, password) {
  const response = await webdavRequest(url, username, password, "GET");
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.status === 404 ? "WebDAV download failed: HTTP 404 \u2014 no backup at that path yet. Upload one first, and check the URL points at the backup FILE (\u2026/dsh/backup.json), not its folder / \u8BE5\u8DEF\u5F84\u4E0B\u8FD8\u6CA1\u6709\u5907\u4EFD\u6587\u4EF6\u3002\u8BF7\u5148\u6267\u884C\u4E00\u6B21\u4E0A\u4F20\uFF0C\u5E76\u786E\u8BA4\u5730\u5740\u6307\u5411\u5907\u4EFD\u6587\u4EF6\u672C\u8EAB\uFF08\u2026/dsh/backup.json\uFF09\u800C\u4E0D\u662F\u76EE\u5F55" : `WebDAV download failed: HTTP ${response.status}`);
  }
  const body = JSON.parse(response.body.toString("utf8"));
  validatedBackup(body);
  return body;
}
function unportableDeps(dependencies) {
  if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies))
    return [];
  const found = [];
  for (const [name2, raw] of Object.entries(dependencies)) {
    if (typeof raw !== "string")
      continue;
    const match = /^(?:link|file):(.+)$/i.exec(raw);
    if (match === null)
      continue;
    let path = match[1];
    try {
      path = decodeURIComponent(path);
    } catch {
    }
    if (/^\//.test(path) || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path))
      found.push({ name: name2, spec: raw });
  }
  return found;
}
function mergeRestoreManifest(backupManifest, current, selection) {
  const merged = { ...backupManifest };
  const backupDeps = backupManifest.dependencies === null || typeof backupManifest.dependencies !== "object" || Array.isArray(backupManifest.dependencies) ? {} : backupManifest.dependencies;
  const backupBundles = Array.isArray(backupManifest.dsh?.profile?.bundles) ? backupManifest.dsh.profile.bundles : [];
  const currentDeps = current.dependencies === null || typeof current.dependencies !== "object" || Array.isArray(current.dependencies) ? {} : current.dependencies;
  const currentBundles = Array.isArray(current.dsh?.profile?.bundles) ? current.dsh.profile.bundles : [];
  const deps = { ...currentDeps };
  const sourceDeps = selection !== void 0 ? selection.deps : backupDeps;
  for (const [name2, spec] of Object.entries(sourceDeps))
    deps[name2] = spec;
  merged.dependencies = deps;
  const bundles = /* @__PURE__ */ new Set();
  for (const name2 of currentBundles)
    if (typeof name2 === "string")
      bundles.add(name2);
  const sourceBundles = selection !== void 0 ? selection.bundles : backupBundles;
  for (const name2 of sourceBundles)
    if (typeof name2 === "string")
      bundles.add(name2);
  const currentDsh = current.dsh === null || typeof current.dsh !== "object" || Array.isArray(current.dsh) ? void 0 : current.dsh;
  const currentProfile = currentDsh?.profile === null || typeof currentDsh?.profile !== "object" || Array.isArray(currentDsh?.profile) ? void 0 : currentDsh.profile;
  const backupDsh = merged.dsh === null || typeof merged.dsh !== "object" || Array.isArray(merged.dsh) ? void 0 : merged.dsh;
  const backupProfile = backupDsh?.profile === null || typeof backupDsh?.profile !== "object" || Array.isArray(backupDsh?.profile) ? void 0 : backupDsh.profile;
  const profileMerged = { ...backupProfile ?? {}, ...currentProfile ?? {}, bundles: [...bundles] };
  const dshMerged = { ...backupDsh ?? {}, ...currentDsh ?? {}, profile: profileMerged };
  merged.dsh = dshMerged;
  return merged;
}

// src-tauri/resources/dsh-market/src/host/gist.js
import { spawn as spawn3 } from "node:child_process";
import { request as httpsRequest2 } from "node:https";
import { homedir as homedir6 } from "node:os";
import { join as join13 } from "node:path";
var GIST_FILENAME = "dsh-profile-backup.json";
var GIST_MAX_BYTES = 1024 * 1024;
var GIST_TOKEN_ENV = "DSH_GITHUB_TOKEN";
var GIST_API_HOST = "api.github.com";
var GIST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
var REQUEST_TIMEOUT_MS = 3e4;
var NETWORK_ERROR_CODES = /* @__PURE__ */ new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNABORTED"
]);
var GistError = class extends Error {
  code;
  constructor(message, code = "other") {
    super(message);
    this.name = "GistError";
    this.code = code;
  }
};
function gistErrorCode(error) {
  if (error instanceof GistError)
    return error.code;
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError")
      return "timeout";
    const raw = error.code ?? error.cause?.code;
    if (typeof raw === "string" && NETWORK_ERROR_CODES.has(raw))
      return "network";
  }
  return "other";
}
function parseGistId(input) {
  const trimmed = input.trim();
  if (trimmed === "")
    throw new Error("gist id is required");
  let candidate = trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:" && (url.hostname === "gist.github.com" || url.hostname.endsWith(".gist.github.com"))) {
      const parts = url.pathname.split("/").filter(Boolean);
      candidate = parts[parts.length - 1] ?? "";
    }
  } catch {
  }
  if (!GIST_ID_RE.test(candidate))
    throw new Error("invalid gist id");
  return candidate;
}
async function resolveGistTokenSource(bodyToken) {
  if (typeof bodyToken === "string" && bodyToken.trim() !== "")
    return { token: bodyToken.trim(), source: "token" };
  const configured = process.env[GIST_TOKEN_ENV];
  if (typeof configured === "string" && configured.trim() !== "")
    return { token: configured.trim(), source: "env" };
  const ghToken = await ghAuthToken();
  if (ghToken !== null)
    return { token: ghToken, source: "gh" };
  throw new GistError("GitHub token is required (enter it in the Backup tab, set DSH_GITHUB_TOKEN, or log in with the gh CLI)", "auth");
}
var ghTokenCache = null;
async function ghAuthToken() {
  if (ghTokenCache !== null && Date.now() < ghTokenCache.expires)
    return ghTokenCache.token;
  const token = await fetchGhToken();
  ghTokenCache = { token, expires: Date.now() + (token !== null ? 10 * 6e4 : 3e4) };
  return token;
}
function fetchGhToken() {
  return new Promise((resolve6) => {
    const candidates = ["gh", join13(homedir6(), ".local", "bin", "gh")];
    let settled = false;
    const finish = (value) => {
      if (settled)
        return;
      settled = true;
      resolve6(value);
    };
    const tryNext = (index) => {
      if (index >= candidates.length) {
        finish(null);
        return;
      }
      const command = candidates[index];
      let child = null;
      try {
        child = spawn3(command, ["auth", "token"], {
          stdio: ["ignore", "pipe", "ignore"],
          detached: true,
          windowsHide: true
        });
      } catch {
        tryNext(index + 1);
        return;
      }
      if (child == null) {
        tryNext(index + 1);
        return;
      }
      let out = "";
      child.stdout?.on("data", (chunk) => {
        out += chunk.toString();
      });
      const timer = setTimeout(() => {
        try {
          child?.kill("SIGKILL");
        } catch {
        }
        finish(out.trim() !== "" ? out.trim() : null);
      }, 8e3);
      let errored = false;
      child.on("error", () => {
        if (errored)
          return;
        errored = true;
        clearTimeout(timer);
        if (!settled)
          tryNext(index + 1);
      });
      child.on("close", () => {
        if (errored)
          return;
        clearTimeout(timer);
        finish(out.trim() !== "" ? out.trim() : null);
      });
      child.unref();
    };
    tryNext(0);
  });
}
function classifyRequestError(error) {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new GistError("GitHub request timed out", "timeout");
  }
  const raw = error?.code ?? error?.cause?.code;
  if (typeof raw === "string" && NETWORK_ERROR_CODES.has(raw)) {
    return new GistError(`GitHub is unreachable (${raw})`, "network");
  }
  return error instanceof Error ? error : new GistError(String(error), "other");
}
function gistRequest(token, method, path, body, signal) {
  return new Promise((resolve6, reject) => {
    const headers = {
      authorization: `Bearer ${token}`,
      "user-agent": "dshmarket",
      accept: "application/vnd.github+json"
    };
    if (body !== void 0) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(body));
    }
    const hardCeiling = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const effectiveSignal = signal !== void 0 ? AbortSignal.any([signal, hardCeiling]) : hardCeiling;
    const request = httpsRequest2({
      protocol: "https:",
      hostname: GIST_API_HOST,
      path,
      method,
      headers,
      signal: effectiveSignal
    }, (response) => {
      const chunks = [];
      let size = 0;
      const maxBytes = MAX_BACKUP_BYTES + 16 * 1024;
      response.once("error", reject);
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.destroy(new Error("GitHub response is too large"));
        return;
      }
      response.on("data", (chunk) => {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += value.byteLength;
        if (size > maxBytes) {
          response.destroy(new Error("GitHub response is too large"));
          return;
        }
        chunks.push(value);
      });
      response.once("end", () => resolve6({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("error", (error) => reject(classifyRequestError(error)));
    if (body !== void 0)
      request.end(body);
    else
      request.end();
  });
}
function parseGistError(status, body, action) {
  let message = body;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed.message === "string" && parsed.message !== "")
      message = parsed.message;
  } catch {
  }
  if (status === 401)
    return new GistError("GitHub token is invalid or revoked", "auth");
  if (status === 403)
    return new GistError(`GitHub rejected the ${action} (rate limit or insufficient scope): ${message}`, "rate-limit");
  if (status === 404)
    return new GistError("Gist not found (check the id/URL)", "notfound");
  if (status === 422)
    return new GistError(`GitHub rejected the ${action}: ${message}`, "invalid");
  return new GistError(`GitHub ${action} failed: HTTP ${status} ${message}`, "other");
}
async function sendGistRequest(token, method, path, body, action, signal) {
  const response = await gistRequest(token, method, path, body, signal);
  const ok = method === "POST" ? response.status === 201 : response.status === 200;
  if (!ok)
    throw parseGistError(response.status, response.body, action);
  return response;
}
async function createGist(token, content, signal) {
  const body = JSON.stringify({
    description: "dshmarket profile backup",
    public: false,
    files: { [GIST_FILENAME]: { content } }
  });
  const response = await sendGistRequest(token, "POST", "/gists", body, "Gist creation", signal);
  const data = JSON.parse(response.body);
  if (typeof data.id !== "string" || data.id === "")
    throw new Error("GitHub returned an invalid Gist");
  return { id: data.id, htmlUrl: typeof data.html_url === "string" ? data.html_url : `https://gist.github.com/${data.id}` };
}
async function updateGist(token, gistId, content, signal) {
  const body = JSON.stringify({ files: { [GIST_FILENAME]: { content } } });
  const response = await sendGistRequest(token, "PATCH", `/gists/${gistId}`, body, "Gist update", signal);
  const data = JSON.parse(response.body);
  return { id: typeof data.id === "string" ? data.id : gistId, htmlUrl: typeof data.html_url === "string" ? data.html_url : `https://gist.github.com/${gistId}` };
}
async function readGist(token, gistId, signal) {
  const response = await sendGistRequest(token, "GET", `/gists/${gistId}`, void 0, "Gist read", signal);
  let data;
  try {
    data = JSON.parse(response.body);
  } catch {
    throw new GistError("GitHub returned an unreadable Gist payload", "invalid");
  }
  const file = data.files?.[GIST_FILENAME];
  const content = file !== null && typeof file === "object" && !Array.isArray(file) ? file.content : void 0;
  if (typeof content !== "string")
    throw new GistError(`Gist has no ${GIST_FILENAME} file`, "invalid");
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new GistError("Gist backup is not valid JSON", "invalid");
  }
  try {
    return validatedBackup(parsed);
  } catch (error) {
    throw new GistError(error instanceof Error ? error.message : String(error), "invalid");
  }
}
async function verifyGistToken(token, signal) {
  await sendGistRequest(token, "GET", "/user", void 0, "token verification", signal);
}
function fitsGistLimit(content) {
  return Buffer.byteLength(content) <= GIST_MAX_BYTES;
}

// src-tauri/resources/dsh-market/src/host/routes.js
var PROFILE_RE = /^[A-Za-z0-9_-]+$/;
var cachedVersion = null;
function marketVersion() {
  if (cachedVersion !== null)
    return cachedVersion;
  try {
    const manifest = JSON.parse(readFileSync9(new URL("../package.json", import.meta.url), "utf8"));
    cachedVersion = manifest.version ?? "unknown";
  } catch {
    cachedVersion = "unknown";
  }
  return cachedVersion;
}
function packageHasClientPart(profileDirectory, name2) {
  try {
    const manifest = JSON.parse(readFileSync9(join14(profileDirectory, "node_modules", name2, "package.json"), "utf8"));
    return manifest.dsh?.client !== void 0;
  } catch {
    return false;
  }
}
function blockedBuilds(result) {
  if (Array.isArray(result.ignoredBuilds) && result.ignoredBuilds.length > 0)
    return result.ignoredBuilds;
  const list = parseIgnoredBuilds(result.stdout, result.stderr);
  if (list.length > 0)
    return list;
  const pending = parsePrepareNotAllowed(result.stdout, result.stderr);
  return pending !== null ? [pending] : void 0;
}
function mountMarketRoutes(host, config, commandRuntime, agentsLookup) {
  if (config.profileDirectory === void 0 && !PROFILE_RE.test(config.profile)) {
    const message = `dsh-market: profile name ${JSON.stringify(config.profile)} contains characters outside [A-Za-z0-9_-], so the market's routes were not mounted and every /dsh-market/* request will answer 404. Rename the profile, or pass an explicit profile directory.`;
    host.logger?.warn(`[dsh-market] ${message}`);
    logEvent("error", "mount", message);
    throw new Error(message);
  }
  const activeProfileDir = profileDir(config.profile, config.profileDirectory);
  let agentGuardUnavailableLogged = false;
  const runningAgentsForGuard = () => {
    const service = agentsLookup?.();
    const ids = runningAgentIds(service);
    if (service === void 0 && !agentGuardUnavailableLogged) {
      agentGuardUnavailableLogged = true;
      logEvent("warn", "agent-guard", "host exposes no agents service \u2014 mutations are not guarded while agents run");
    }
    return ids;
  };
  const agentsGuardAvailable = () => {
    const service = agentsLookup?.();
    if (service === void 0)
      return false;
    try {
      return Array.isArray(service.list());
    } catch {
      return false;
    }
  };
  const userPatchPath = findUserPatchPath(host, activeProfileDir);
  const commands = commandRuntime ?? { runPlugin: runDshPlugin, probePnpm, provisionPnpm, cancelActive };
  cleanHotDir(activeProfileDir);
  const marketState = readMarketState(activeProfileDir);
  const disabled = marketState.disabled;
  const groups = marketState.groups;
  const groupOrder = marketState.groupOrder;
  if (marketState.channel !== void 0)
    config.channel = marketState.channel;
  const activeChannel = () => resolveChannel(config.channel, marketVersion());
  const themes = createThemeManager(host, config.profile, disabled, activeProfileDir);
  void mountClientOnlyDeps(host, activeProfileDir).then(async (mounted) => {
    if (mounted.length > 0)
      logEvent("info", "boot", `client-only shims mounted: ${mounted.join(", ")}`);
    for (const name2 of disabled) {
      if (await themes.setEntryDisabled(name2, true))
        logEvent("info", "boot", `plugin kept off: ${name2}`);
    }
  });
  host.on?.("internal/plugin", (fiber) => {
    const name2 = fiber.entry?.options?.name;
    if (name2 !== void 0 && disabled.has(name2))
      void themes.setEntryDisabled(name2, true);
  });
  let installing = false;
  let restarting = false;
  let writing = false;
  let mutationBusy = false;
  let mutationChain = Promise.resolve();
  async function withMutationLock(response, kind, fn) {
    if (mutationBusy) {
      sendJson(response, 409, {
        error: kind === "install" ? "another install is already running" : "another plugin operation is running"
      });
      return null;
    }
    mutationBusy = true;
    if (kind === "install")
      installing = true;
    else
      writing = true;
    try {
      const run = mutationChain.then(async () => fn());
      mutationChain = run.catch(() => void 0);
      return await run;
    } finally {
      mutationBusy = false;
      if (kind === "install")
        installing = false;
      else
        writing = false;
    }
  }
  function changedSince(before) {
    const now = readInstalled(config.profile, activeProfileDir);
    const changed = /* @__PURE__ */ new Set();
    for (const [name2, spec] of Object.entries(now))
      if (before[name2] !== spec)
        changed.add(name2);
    for (const name2 of Object.keys(before))
      if (now[name2] === void 0)
        changed.add(name2);
    return { changed: [...changed], partial: changed.size > 0 };
  }
  async function setPluginEnabled(name2, enabled) {
    const dir = activeProfileDir;
    if (enabled)
      disabled.delete(name2);
    else
      disabled.add(name2);
    let ok;
    let reason;
    if (enabled) {
      if (listHotMounts().includes(name2)) {
        ok = true;
      } else if (await themes.setEntryDisabled(name2, false)) {
        ok = true;
      } else {
        const result = await hotMount(host, dir, name2);
        ok = result.ok;
        reason = result.reason ?? void 0;
      }
    } else {
      ok = await hotUnmount(name2) || await themes.setEntryDisabled(name2, true);
      if (!ok) {
        ok = true;
      }
    }
    writeMarketState(dir, { disabled, groups, groupOrder });
    return { ok, reason };
  }
  function liveNames() {
    const live = new Set(listHotMounts());
    for (const entry of host.loader.entries()) {
      if (entry.fiber === void 0)
        continue;
      if (entry.options.name !== void 0)
        live.add(entry.options.name);
      if (entry.options.id !== void 0 && entry.options.id !== "") {
        live.add(`#${entry.options.id}`);
        const bare = entry.options.id.split(":").pop();
        if (bare !== void 0 && bare !== entry.options.id)
          live.add(`#${bare}`);
      }
    }
    return live;
  }
  async function dropStaleHotMounts() {
    for (const name2 of listHotMounts()) {
      if (existsSync9(join14(activeProfileDir, "node_modules", name2, "package.json")))
        continue;
      await hotUnmount(name2);
      logEvent("warn", "hot-sweep", `${name2}: package removed outside the market \u2014 live mount dropped`);
    }
  }
  const runPlugin = (profile, args) => withHoistRecovery(commands.runPlugin, profile, args);
  async function rollbackUpdateBuild(name2, manifestBefore) {
    const rolledBack = restoreManifestDeps(config.profile, manifestBefore, activeProfileDir);
    if (rolledBack.length === 0)
      return { ok: true, detail: null };
    const reinstall = await runPlugin(config.profile, ["--no-frozen-lockfile", RELEASE_AGE_OVERRIDE, "install"]);
    const ok = reinstall.exitCode === 0 && !reinstall.timedOut && !reinstall.cancelled;
    if (ok)
      logEvent("info", "update", `${name2}: previous build rematerialized (${rolledBack.join(", ")})`);
    return { ok, detail: ok ? null : failureDetail(reinstall) };
  }
  const pendingRollbacks = /* @__PURE__ */ new Map();
  let rollbackSequence = 0;
  function savePendingRollback(record) {
    const id = `rollback-${String(rollbackSequence++)}`;
    pendingRollbacks.set(id, { ...record, id });
    return id;
  }
  async function rollbackGitBuild(name2, manifestBefore, target, beforeCommit) {
    if (beforeCommit === null) {
      return { ok: false, detail: "the previous commit is unknown; nothing to roll back to" };
    }
    restoreManifestDeps(config.profile, manifestBefore, activeProfileDir);
    const add = await runPlugin(config.profile, ["add", RELEASE_AGE_OVERRIDE, `${target}#${beforeCommit}`]);
    if (add.exitCode !== 0 || add.timedOut || add.cancelled) {
      return { ok: false, detail: failureDetail(add) };
    }
    restoreManifestDeps(config.profile, manifestBefore, activeProfileDir);
    logEvent("info", "update-rollback", `${name2}: restored github build at ${beforeCommit}`);
    return { ok: true, detail: null };
  }
  async function removeInstalledPackage(name2) {
    const result = await runPlugin(config.profile, ["remove", name2]);
    if (result.exitCode !== 0 || result.timedOut || result.cancelled) {
      return { ok: false, hot: false, detail: failureDetail(result) };
    }
    const unmounted = await hotUnmount(name2);
    const entryDisabled = await themes.setEntryDisabled(name2, true);
    const hot = unmounted || entryDisabled;
    removeRowBlocks(userPatchPath, rowIdsForPackage(host, activeProfileDir, name2));
    disabled.delete(name2);
    removeFromGroups({ groups, groupOrder }, name2);
    writeMarketState(activeProfileDir, { disabled, groups, groupOrder });
    return { ok: true, hot, detail: null };
  }
  async function restoreBackup(value) {
    if (!await probePnpm())
      throw new Error("pnpm is required to restore plugins");
    const manifestBefore = JSON.parse(readFileSync9(join14(activeProfileDir, "package.json"), "utf8"));
    const restored = restoreProfileBackup(config.profile, value, activeProfileDir);
    try {
      const mergedManifest = mergeRestoreManifest(JSON.parse(readFileSync9(join14(activeProfileDir, "package.json"), "utf8")), manifestBefore);
      writeFileSync6(join14(activeProfileDir, "package.json"), `${JSON.stringify(mergedManifest, null, 2)}
`);
      const unportable = unportableDeps(mergedManifest.dependencies);
      if (unportable.length > 0) {
        logEvent("warn", "restore", `machine-specific dependency paths in the restored manifest \u2014 ${unportable.map((dep) => `${dep.name}: ${dep.spec}`).join("; ")}`);
      }
      const result = await runPlugin(config.profile, ["install"]);
      if (result.exitCode === 0 && !result.timedOut && !result.cancelled) {
        invalidateUpdates();
        return { files: restored.files, errors: [], unportable };
      }
      const manifestFile = join14(activeProfileDir, "package.json");
      const manifest = JSON.parse(readFileSync9(manifestFile, "utf8"));
      const dependencies = Object.entries(manifest.dependencies ?? {});
      const desiredBundles = [...manifest.dsh?.profile?.bundles ?? []];
      const dependencyNames = new Set(dependencies.map(([name2]) => name2));
      manifest.dependencies = {};
      if (Array.isArray(manifest.dsh?.profile?.bundles)) {
        manifest.dsh.profile.bundles = desiredBundles.filter((bundle) => !dependencyNames.has(bundle));
      }
      writeFileSync6(manifestFile, `${JSON.stringify(manifest, null, 2)}
`);
      const errors = [];
      let installed = 0;
      for (const [name2, spec] of dependencies) {
        const target = /^(?:file|link|github|git\+|https?):/.test(spec) ? spec : `${name2}@${spec}`;
        try {
          const item = await runPlugin(config.profile, ["add", target]);
          if (item.exitCode === 0 && !item.timedOut && !item.cancelled && existsSync9(join14(activeProfileDir, "node_modules", name2, "package.json"))) {
            installed += 1;
            if (desiredBundles.includes(name2)) {
              const current2 = JSON.parse(readFileSync9(manifestFile, "utf8"));
              current2.dsh ??= {};
              current2.dsh.profile ??= {};
              current2.dsh.profile.bundles ??= [];
              if (!current2.dsh.profile.bundles.includes(name2))
                current2.dsh.profile.bundles.push(name2);
              writeFileSync6(manifestFile, `${JSON.stringify(current2, null, 2)}
`);
            }
            continue;
          }
          errors.push({ name: name2, error: failureDetail(item).trim() || "pnpm failed" });
        } catch (error) {
          errors.push({ name: name2, error: error instanceof Error ? error.message : String(error) });
        }
        const current = JSON.parse(readFileSync9(manifestFile, "utf8"));
        if (current.dependencies !== void 0)
          delete current.dependencies[name2];
        writeFileSync6(manifestFile, `${JSON.stringify(current, null, 2)}
`);
      }
      if (installed === 0 && dependencies.length > 0) {
        restored.rollback();
      }
      invalidateUpdates();
      return { files: restored.files, errors, unportable: unportableDeps(manifest.dependencies) };
    } catch (error) {
      restored.rollback();
      throw error;
    }
  }
  const disposers = [
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/backup",
      handler: (request, response) => {
        if (request.method !== "GET") {
          response.writeHead(405, { allow: "GET" });
          response.end();
          return;
        }
        if (!trustedDownloadRequest(request)) {
          sendJson(response, 403, { error: "backup export is limited to same-origin loopback requests" });
          return;
        }
        try {
          const data = createProfileBackup(config.profile, activeProfileDir);
          const backup = JSON.stringify(data, null, 2);
          const timestamp2 = new Date(data.createdAt).toLocaleString("sv-SE").replace(/\D/g, "");
          response.writeHead(200, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="dsh-dshmarket-backup-${timestamp2}.json"`
          });
          response.end(backup);
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/restore",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!sameOrigin(request))
          return sendJson(response, 403, { error: "untrusted origin" });
        try {
          const body = await readJsonBody(request, MAX_BACKUP_BYTES + 4096);
          await withMutationLock(response, "install", async () => {
            sendJson(response, 200, { ok: true, ...await restoreBackup(body.backup) });
          });
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/webdav",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!sameOrigin(request))
          return sendJson(response, 403, { error: "untrusted origin" });
        try {
          const body = await readJsonBody(request);
          const url = typeof body.url === "string" ? body.url : "";
          const username = typeof body.username === "string" ? body.username : "";
          const password = typeof body.password === "string" ? body.password : "";
          if (body.action === "backup") {
            await uploadWebdav(url, username, password, createProfileBackup(config.profile, activeProfileDir));
            sendJson(response, 200, { ok: true });
          } else if (body.action === "restore") {
            sendJson(response, 200, { ok: true, backup: await downloadWebdav(url, username, password) });
          } else
            sendJson(response, 400, { error: "invalid WebDAV action" });
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/gist",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!sameOrigin(request))
          return sendJson(response, 403, { error: "untrusted origin" });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new GistError("Gist operation timed out", "timeout")), 25e3);
        try {
          const body = await readJsonBody(request);
          const { token, source } = await resolveGistTokenSource(body.token);
          if (body.action === "export") {
            const gistIdInput = typeof body.gistId === "string" ? body.gistId.trim() : "";
            const includeDeps = Array.isArray(body.includeDeps) ? body.includeDeps.filter((name2) => typeof name2 === "string" && name2 !== "") : void 0;
            const backup = createProfileBackup(config.profile, activeProfileDir, includeDeps !== void 0 ? { includeDeps, includeConfig: body.includeConfig === true } : void 0);
            const content = JSON.stringify(backup, null, 2);
            if (!fitsGistLimit(content))
              throw new Error("backup exceeds the GitHub Gist 1 MB limit");
            const ref = gistIdInput === "" ? await createGist(token, content, controller.signal) : await updateGist(token, parseGistId(gistIdInput), content, controller.signal);
            sendJson(response, 200, { ok: true, gistId: ref.id, gistUrl: ref.htmlUrl });
          } else if (body.action === "import") {
            if (typeof body.gistId !== "string" || body.gistId.trim() === "")
              throw new Error("gist id is required");
            const backup = await readGist(token, parseGistId(body.gistId), controller.signal);
            sendJson(response, 200, { ok: true, backup });
          } else if (body.action === "verify") {
            await verifyGistToken(token, controller.signal);
            sendJson(response, 200, { ok: true, source });
          } else
            sendJson(response, 400, { error: "invalid Gist action" });
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : String(error), code: gistErrorCode(error) });
        } finally {
          clearTimeout(timer);
        }
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/registry",
      handler: async (request, response) => {
        if (request.method !== "GET") {
          response.writeHead(405, { allow: "GET" });
          response.end();
          return;
        }
        try {
          try {
            sendJson(response, 200, { registry: await loadRegistry() });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logEvent("warn", "registry", `catalog fetch failed: ${message}`);
            sendJson(response, 502, { error: message });
          }
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/installed",
      handler: async (request, response) => {
        if (request.method !== "GET") {
          response.writeHead(405, { allow: "GET" });
          response.end();
          return;
        }
        await dropStaleHotMounts();
        const installed = readInstalled(config.profile, activeProfileDir);
        const repoIdentities = {};
        const repoHints = {};
        for (const [name2, spec] of Object.entries(installed)) {
          const evidence = readInstalledRepoEvidence(config.profile, name2, spec, activeProfileDir);
          if (evidence.identities.length > 0)
            repoIdentities[name2] = evidence.identities;
          if (evidence.hints.length > 0)
            repoHints[name2] = evidence.hints;
        }
        const present = Object.keys(installed).filter((name2) => readInstalledVersion(config.profile, name2, activeProfileDir) !== null);
        const preinstalled = Object.keys(installed).filter((name2) => readInstalledPreinstalled(config.profile, name2, activeProfileDir));
        const patch = readUserPatchState(userPatchPath);
        const patchFlags = packagePatchFlags(host, activeProfileDir, Object.keys(installed), patch);
        const activation = {};
        const live = liveNames();
        for (const name2 of Object.keys(installed)) {
          activation[name2] = verifyActivation(config.profile, name2, live, activeProfileDir, disabled.has(name2) || patchFlags.disabled.includes(name2));
        }
        const diagnostics = diagnosePackageManifests(Object.keys(installed).map((packageName) => ({
          packageName,
          manifest: readInstalledManifest(config.profile, packageName, activeProfileDir)
        })));
        sendJson(response, 200, {
          profile: config.profile,
          installed,
          repoIdentities,
          repoHints,
          present,
          preinstalled,
          activation,
          diagnostics,
          live: listHotMounts(),
          disabled: [...disabled],
          groups,
          groupOrder,
          patch: { disables: patch.disables, forced: patch.forced, inserts: patch.inserts },
          patchDisabled: patchFlags.disabled,
          patchForced: patchFlags.forced,
          bundles: readProfileBundles(activeProfileDir).filter((name2) => !INBOX_BUNDLES.has(name2))
        });
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/check",
      handler: (request, response) => {
        if (request.method !== "GET") {
          response.writeHead(405, { allow: "GET" });
          response.end();
          return;
        }
        try {
          const report = analyzeProfile(activeProfileDir);
          sendJson(response, 200, report);
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }),
    // Issue #98 phase 2: reorder the community bundles. Official bundles are
    // fixed; the candidate is trial-validated (dry-run composition replay)
    // before the manifest is written — a broken order is refused and the
    // profile is never touched.
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/bundle-order",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: "untrusted origin" });
          return;
        }
        let backup = null;
        try {
          await withMutationLock(response, "write", async () => {
            const body = await readJsonBody(request);
            if (body === null || typeof body !== "object") {
              sendJson(response, 400, { error: "JSON body is required / \u9700\u8981 JSON body" });
              return;
            }
            if (!Array.isArray(body.order) || !body.order.every((item) => typeof item === "string")) {
              sendJson(response, 400, { error: "order must be an array of bundle names / order \u5FC5\u987B\u662F bundle \u540D\u79F0\u6570\u7EC4" });
              return;
            }
            const order = body.order;
            const stack = readBundleStack(activeProfileDir);
            const merged = mergeOrder(stack.bundles, order);
            if (merged.ok) {
              const conflicts = validateOrder(merged.bundles, readBundleRules(activeProfileDir));
              if (conflicts.length > 0) {
                logEvent("warn", "bundle-order", `rejected by before/after rules: ${conflicts.map((c) => c.reason).join("; ")}`);
                sendJson(response, 422, {
                  error: "the order violates declared before/after rules / \u8BE5\u987A\u5E8F\u8FDD\u53CD\u4E86\u63D2\u4EF6\u58F0\u660E\u7684 before/after \u89C4\u5219",
                  conflicts
                });
                return;
              }
            }
            const trial = trialValidate(activeProfileDir, order);
            if (!trial.ok) {
              const first = trial.errors[0];
              logEvent("warn", "bundle-order", `rejected by trial validation: ${first?.message ?? "unknown"}`);
              sendJson(response, 422, {
                error: `trial validation failed \u2014 ${first?.message ?? "this order would not boot"} / \u8BD5\u542F\u52A8\u6821\u9A8C\u5931\u8D25\uFF1A${first?.message ?? "\u8BE5\u987A\u5E8F\u65E0\u6CD5\u542F\u52A8"}`,
                trial: { errors: trial.errors, warnings: trial.warnings, diff: trial.diff }
              });
              return;
            }
            backup = createProfileBackup(config.profile, activeProfileDir);
            const applied = applyBundleOrder(activeProfileDir, order);
            if (!applied.ok) {
              sendJson(response, 400, { error: applied.error });
              return;
            }
            invalidateUpdates();
            logEvent("info", "bundle-order", "applied new community order");
            sendJson(response, 200, { ok: true, bundles: applied.bundles });
          });
        } catch (error) {
          if (backup !== null) {
            try {
              restoreProfileBackup(config.profile, backup, activeProfileDir);
              logEvent("error", "bundle-order", `write failed \u2014 profile restored from pre-write backup: ${error instanceof Error ? error.message : String(error)}`);
            } catch {
              logEvent("error", "bundle-order", "write failed AND automatic rollback failed");
            }
          }
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/use-skin",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: "untrusted origin" });
          return;
        }
        try {
          const body = await readJsonBody(request);
          const name2 = typeof body.name === "string" ? body.name : "";
          const installed = readInstalled(config.profile, activeProfileDir);
          const themeNames = await themes.installedThemeNames();
          if (installed[name2] === void 0 || !themeNames.has(name2)) {
            sendJson(response, 400, { error: "not an installed theme" });
            return;
          }
          const activated = await themes.activateTheme(name2);
          logEvent(activated ? "info" : "error", "use-skin", `${name2}: ${activated ? "active" : "failed"}`);
          sendJson(response, activated ? 200 : 502, { ok: activated, live: listHotMounts() });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logEvent("error", "use-skin", `route error: ${message}`);
          sendJson(response, 500, { error: message });
        }
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/toggle",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: "untrusted origin" });
          return;
        }
        try {
          const body = await readJsonBody(request);
          const name2 = typeof body.name === "string" ? body.name : "";
          const enabled = body.enabled === true;
          if (name2 === "dsh-market" || name2 === "dshmarket") {
            sendJson(response, 400, { error: "the market cannot be disabled from its own page; use the dsh CLI" });
            return;
          }
          if (readInstalled(config.profile, activeProfileDir)[name2] === void 0) {
            sendJson(response, 400, { error: "plugin is not installed" });
            return;
          }
          if (isProtectedModule(name2)) {
            sendJson(response, 403, {
              error: `${name2} \u5C5E\u4E8E\u5BBF\u4E3B\u57FA\u7840\u8BBE\u65BD,\u7981\u6B62\u5F00\u5173(\u4F1A\u7834\u574F\u70ED\u52A0\u8F7D/\u4F20\u8F93/\u5B58\u50A8\u94FE) / ${name2} is host infrastructure and cannot be toggled (it would break the hot-reload/transport/storage chain)`
            });
            return;
          }
          let ok;
          let reason;
          if (enabled && (await themes.installedThemeNames()).has(name2)) {
            ok = await themes.activateTheme(name2);
            if (!ok)
              reason = "theme activation failed \u2014 restart required / \u4E3B\u9898\u542F\u7528\u5931\u8D25\uFF0C\u9700\u8981\u91CD\u542F";
          } else {
            const result = await setPluginEnabled(name2, enabled);
            ok = result.ok;
            reason = result.reason;
          }
          const patchRows = rowIdsForPackage(host, activeProfileDir, name2);
          const disablesOthers = carrierDisableIds(activeProfileDir, name2);
          const isCarrier = disablesOthers.length > 0;
          let bundleSwitch = { ok: true, reason: null };
          if (isCarrier) {
            try {
              if (enabled)
                addProfileBundle(activeProfileDir, name2);
              else
                removeProfileBundle(activeProfileDir, name2);
              logEvent("info", "toggle", `${name2}: disable-carrier ${enabled ? "re-added to" : "removed from"} dsh.profile.bundles (disables: ${disablesOthers.join(", ")})`);
            } catch (error) {
              bundleSwitch = { ok: false, reason: error instanceof Error ? error.message : String(error) };
              logEvent("warn", "toggle", `${name2}: carrier bundle switch failed \u2014 ${bundleSwitch.reason}`);
            }
          }
          let patchWrite = null;
          if (patchRows.length > 0) {
            for (const rowId of patchRows) {
              const result = enabled ? await enableRow(userPatchPath, rowId) : await disableRow(userPatchPath, rowId);
              if (!result.ok && patchWrite === null)
                patchWrite = result;
            }
            if (patchWrite === null) {
              logEvent("info", "toggle", `${name2}: patch layer ${enabled ? "enabled" : "disabled"} rows ${patchRows.join(", ")}`);
            } else {
              logEvent("warn", "toggle", `${name2}: patch layer write refused \u2014 ${patchWrite.reason}`);
            }
          }
          logEvent(ok ? "info" : "error", "toggle", `${name2}: ${enabled ? "on" : "off"} ok=${String(ok)}`);
          const patchNow = readUserPatchState(userPatchPath);
          const offNow = disabled.has(name2) || patchRows.some((id) => patchNow.disables.includes(id));
          const liveAfter = liveNames().has(name2);
          const restart = isCarrier ? true : enabled ? !liveAfter : liveAfter;
          const refresh = packageHasClientPart(activeProfileDir, name2);
          sendJson(response, ok ? 200 : 502, {
            ok,
            name: name2,
            enabled,
            disabled: [...disabled],
            live: listHotMounts(),
            activation: { [name2]: verifyActivation(config.profile, name2, liveNames(), activeProfileDir, offNow) },
            reason,
            patchRows,
            patchWrite: patchWrite ?? { ok: true, reason: null },
            carrier: disablesOthers,
            bundleSwitch,
            restart,
            refresh
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logEvent("error", "toggle", `route error: ${message}`);
          sendJson(response, 500, { error: message });
        }
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/groups",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: "untrusted origin" });
          return;
        }
        try {
          const body = await readJsonBody(request);
          const action = typeof body.action === "string" ? body.action : "";
          const known = action === "create" || action === "rename" || action === "delete" || action === "set-members" || action === "toggle";
          if (!known) {
            sendJson(response, 400, { ok: false, error: "unknown group action" });
            return;
          }
          const installed = new Set(Object.keys(readInstalled(config.profile, activeProfileDir)));
          const themeNames = await themes.installedThemeNames();
          let ok = true;
          let error;
          let restartMembers = [];
          let refreshMembers = [];
          if (action === "toggle") {
            const name2 = typeof body.name === "string" ? body.name : "";
            const enabled = body.enabled === true;
            if (groups[name2] === void 0) {
              sendJson(response, 400, { ok: false, error: "group not found / \u5206\u7EC4\u4E0D\u5B58\u5728" });
              return;
            }
            const failures = [];
            for (const member of groups[name2]) {
              if (!installed.has(member))
                continue;
              const result = enabled && themeNames.has(member) ? { ok: await themes.activateTheme(member), reason: void 0 } : await setPluginEnabled(member, enabled);
              if (!result.ok)
                failures.push(member);
              const liveAfter = liveNames().has(member);
              if (enabled && !liveAfter || !enabled && liveAfter)
                restartMembers.push(member);
              if (packageHasClientPart(activeProfileDir, member))
                refreshMembers.push(member);
            }
            ok = failures.length === 0;
            if (!ok)
              error = `failed to ${enabled ? "enable" : "disable"}: ${failures.join(", ")}`;
          } else {
            const state = { groups, groupOrder };
            const result = action === "create" ? createGroup(state, body.name) : action === "rename" ? renameGroup(state, body.name, body.newName) : action === "delete" ? deleteGroup(state, body.name) : setGroupMembers(state, body.name, body.members, installed, themeNames);
            ok = result.ok;
            error = result.error;
          }
          if (ok)
            writeMarketState(activeProfileDir, { disabled, groups, groupOrder });
          logEvent(ok ? "info" : "warn", "groups", `${action}${typeof body.name === "string" ? " " + body.name : ""}${ok ? "" : ` \u2014 ${error ?? ""}`}`);
          sendJson(response, ok ? 200 : 400, {
            ok,
            error,
            groups,
            groupOrder,
            disabled: [...disabled],
            restartMembers,
            refreshMembers
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logEvent("error", "groups", `route error: ${message}`);
          sendJson(response, 500, { error: message });
        }
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/status",
      handler: async (request, response) => {
        if (request.method !== "GET") {
          response.writeHead(405, { allow: "GET" });
          response.end();
          return;
        }
        await dropStaleHotMounts();
        sendJson(response, 200, {
          active: progress.active,
          target: progress.target,
          seconds: progress.active ? Math.round((Date.now() - progress.startedAt) / 1e3) : 0,
          lastLine: progress.lastLine,
          phase: progress.phase,
          done: progress.done,
          total: progress.total,
          currentPackage: progress.currentPackage,
          downloaded: progress.downloaded,
          size: progress.size,
          ndjson: progress.ndjson,
          error: progress.error,
          cancelling: progress.cancelling,
          // The route-level operation flag, NOT progress.active: after pnpm
          // exits, install post-processing (retarget, validation, hot-mount)
          // still holds the operation lock for a moment — the exact window
          // where clicking the restart banner used to bounce off a 409 (#91).
          busy: installing,
          pnpm: await commands.probePnpm(),
          boot: BOOT_ID,
          agentGuardAvailable: agentsGuardAvailable(),
          // Shown in the page heading so screenshots carry it (#159).
          version: marketVersion(),
          channel: activeChannel(),
          channels: CHANNELS,
          restart: restartAllowed(config),
          // Named so the UI can say WHY the button is gone. A blank
          // "no restart button" is the state #229 reported as broken.
          supervisor: detectedSupervisor(),
          installed: readInstalled(config.profile, activeProfileDir)
        });
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/logs",
      handler: (request, response) => {
        if (request.method !== "GET") {
          response.writeHead(405, { allow: "GET" });
          response.end();
          return;
        }
        const version = marketVersion();
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": 'attachment; filename="dsh-market-log.txt"'
        });
        response.end(exportLogs({
          "dsh-market": version,
          platform: `${process.platform} ${process.arch}`,
          node: process.version,
          profile: config.profile
        }));
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/updates",
      handler: (request, response) => {
        if (request.method !== "GET") {
          response.writeHead(405, { allow: "GET" });
          response.end();
          return;
        }
        sendJson(response, 200, { updates: {} });
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/update",
      handler: (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        sendJson(response, 400, { error: "\u66F4\u65B0\u529F\u80FD\u5DF2\u7981\u7528 / update disabled" });
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/setup-pnpm",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: "untrusted origin" });
          return;
        }
        try {
          const result = await commands.provisionPnpm();
          sendJson(response, 200, { ok: result.ok, error: result.hint });
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }),
    /**
     * Remove the market itself, from its card on the plugin configuration
     * page. Deliberately NOT the generic uninstall route, which keeps
     * refusing the market: a destructive action on the thing serving the
     * request should be reachable only from the surface built for it, and
     * never as a stray `{ name: "dshmarket" }` on the ordinary path.
     *
     * Removing itself is safe, which is not obvious and was measured before
     * this was written: an already-imported module does not vanish with its
     * files, so the process keeps serving and the response completes
     * normally. The profile boots clean afterwards, with the market's rows
     * gone from `dependencies` and `dsh.profile.bundles`.
     */
    /**
     * Which release channel the market offers ITSELF from.
     *
     * Writable from the card because the settings scope is host-mode only —
     * a browser that is not on loopback never gets one, and the choice would
     * be unreachable there. Same-origin POST, like every other mutation.
     */
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/channel",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: "untrusted origin" });
          return;
        }
        try {
          const body = await readJsonBody(request);
          const wanted = asChannel(body.channel);
          if (wanted === null) {
            sendJson(response, 400, { error: 'channel must be "stable", "beta" or "dev"' });
            return;
          }
          config.channel = wanted;
          marketState.channel = wanted;
          writeMarketState(activeProfileDir, marketState);
          invalidateUpdates();
          logEvent("info", "channel", `release channel set to ${wanted}`);
          sendJson(response, 200, { ok: true, channel: wanted });
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/self-uninstall",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!trustedRestartRequest(request)) {
          sendJson(response, 403, { error: "self-uninstall is limited to same-origin loopback requests" });
          return;
        }
        try {
          await withMutationLock(response, "install", async () => {
            const body = await readJsonBody(request);
            if (body.confirm !== true) {
              sendJson(response, 400, { error: "self-uninstall requires an explicit confirmation" });
              return;
            }
            const installed = readInstalled(config.profile, activeProfileDir);
            const selfName = ["dshmarket", "dsh-market"].find((candidate) => installed[candidate] !== void 0);
            if (selfName === void 0) {
              sendJson(response, 400, { error: "the market is not an installed dependency of this profile" });
              return;
            }
            const result = await runPlugin(config.profile, ["remove", selfName]);
            const ok = result.exitCode === 0 && !result.timedOut && !result.cancelled;
            if (!ok) {
              const said = (result.stderr.trim() || result.stdout.trim()).slice(-800);
              sendJson(response, 502, {
                ok: false,
                error: said === "" ? "removing the market failed" : said,
                timedOut: result.timedOut,
                cancelled: result.cancelled
              });
              return;
            }
            const purge = body.purge === true;
            const restored = [];
            if (purge) {
              for (const name2 of disabled) {
                const ids = rowIdsForPackage(host, activeProfileDir, name2);
                if (ids.length > 0) {
                  removeRowBlocks(userPatchPath, ids);
                  restored.push(name2);
                }
              }
              purgeMarketState(activeProfileDir);
            }
            logEvent("info", "self-uninstall", `removed ${selfName}${purge ? `; purged state, restored ${String(restored.length)} disabled plugin(s)` : "; state kept"}`);
            sendJson(response, 200, {
              ok: true,
              removed: selfName,
              purged: purge,
              restored,
              restart: restartAllowed(config)
            });
            setTimeout(() => {
              void themes.setEntryDisabled(selfName, true).catch(() => {
              });
            }, 0);
          });
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/restart",
      handler: (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!restartAllowed(config)) {
          sendJson(response, 403, { error: "self-restart is disabled for this host" });
          return;
        }
        if (!trustedRestartRequest(request)) {
          sendJson(response, 403, { error: "restart is limited to same-origin loopback requests" });
          return;
        }
        if (writing || installing) {
          sendJson(response, 409, { error: "cannot restart while a plugin operation is running" });
          return;
        }
        if (restarting) {
          sendJson(response, 409, { error: "restart already scheduled" });
          return;
        }
        restarting = true;
        try {
          const result = scheduleRestart(servingPort(request));
          logEvent("info", "restart", `scheduled pid=${String(result.pid)} helper=${String(result.helperPid)}`);
          sendJson(response, 202, { ok: true, boot: BOOT_ID, ...result });
        } catch (error) {
          restarting = false;
          const message = error instanceof Error ? error.message : String(error);
          logEvent("error", "restart", message);
          sendJson(response, 500, { error: message });
        }
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/approve-builds",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: "untrusted origin" });
          return;
        }
        try {
          const stripVersion = (name2) => {
            const at = name2.lastIndexOf("@");
            return at > 0 ? name2.slice(0, at) : name2;
          };
          const PKG_RE = /^(@[A-Za-z0-9-~][A-Za-z0-9._~-]*\/)?[A-Za-z0-9-~][A-Za-z0-9._~-]*$/;
          const body = await readJsonBody(request);
          const requested = (Array.isArray(body.packages) ? body.packages.map(String).map(stripVersion) : []).filter((name2) => PKG_RE.test(name2));
          const installed = requested.filter((name2) => existsSync9(join14(activeProfileDir, "node_modules", name2, "package.json")));
          const specs = readInstalled(config.profile, activeProfileDir);
          const packages = [];
          for (const name2 of requested) {
            if (installed.includes(name2)) {
              packages.push(name2);
              const key2 = gitAllowBuildsKey(name2, String(specs[name2] ?? ""));
              if (key2 !== null)
                packages.push(key2);
              continue;
            }
            if (specs[name2] !== void 0)
              continue;
            let entry;
            try {
              entry = (await loadRegistry()).plugins.find((p) => p.name === name2 || p.npm === name2);
            } catch (error) {
              logEvent("warn", "approve-builds", `catalog unavailable, authorizing ${name2} by name only: ${error instanceof Error ? error.message : String(error)}`);
              packages.push(name2);
              continue;
            }
            const target = entry === void 0 ? null : installTargetFor(entry);
            const key = target === null ? null : gitAllowBuildsKey(name2, target);
            if (key !== null) {
              packages.push(name2, key);
            }
          }
          if (packages.length === 0) {
            sendJson(response, 400, { error: "no installed packages given" });
            return;
          }
          const approved = setAllowBuilds(config.profile, packages, activeProfileDir);
          logEvent("info", "approve-builds", `allowed build scripts: ${approved.join(", ")}`);
          sendJson(response, 200, { ok: true, approved });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logEvent("error", "approve-builds", `route error: ${message}`);
          sendJson(response, 500, { error: message });
        }
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/cancel",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: "untrusted origin" });
          return;
        }
        if (!commands.cancelActive()) {
          sendJson(response, 400, { error: "no operation is running" });
          return;
        }
        logEvent("info", "cancel", `cancelled ${progress.target || "operation"}`);
        sendJson(response, 200, { ok: true, cancelled: true, target: progress.target });
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/uninstall",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: "untrusted origin" });
          return;
        }
        try {
          await withMutationLock(response, "install", async () => {
            const body = await readJsonBody(request);
            const name2 = typeof body.name === "string" ? body.name : "";
            if (name2 === "dsh-market" || name2 === "dshmarket") {
              sendJson(response, 400, { error: "the market cannot uninstall itself; use the dsh CLI" });
              return;
            }
            if (readInstalled(config.profile, activeProfileDir)[name2] === void 0) {
              sendJson(response, 400, { error: "plugin is not installed" });
              return;
            }
            const busyAgents = runningAgentsForGuard();
            if (busyAgents.length > 0) {
              logEvent("warn", "uninstall-blocked", `${name2}: refused while agents are running \u2014 ${busyAgents.join(", ")}`);
              sendJson(response, 409, {
                error: `\u6709 agent \u6B63\u5728\u8FD0\u884C\uFF08${busyAgents.join(", ")}\uFF09\u3002\u5378\u8F7D\u4F1A\u4FEE\u6539\u63D2\u4EF6\u6587\u4EF6\uFF0C\u6B63\u5728\u5DE5\u4F5C\u7684 agent \u53EF\u80FD\u5728\u4E2D\u9014\u62A5\u9519\uFF1B\u8BF7\u7B49\u5B83\u5B8C\u6210\u6216\u53D6\u6D88\u540E\u518D\u5378\u8F7D\u3002 / ${busyAgents.length === 1 ? "An agent is running" : "Agents are running"} (${busyAgents.join(", ")}). Uninstalling changes plugin files, so a working agent can fail mid-turn; wait for it to finish (or cancel it) before uninstalling.`,
                agentsBusy: true,
                runningAgents: busyAgents
              });
              return;
            }
            pendingRollbacks.clear();
            const beforeInstalled = readInstalled(config.profile, activeProfileDir);
            const activation = {
              [name2]: verifyActivation(config.profile, name2, liveNames(), activeProfileDir, disabled.has(name2))
            };
            const result = await runPlugin(config.profile, ["remove", name2]);
            const cancelled = result.cancelled;
            const ok = result.exitCode === 0 && !result.timedOut && !cancelled;
            const cancelDiff = cancelled ? changedSince(beforeInstalled) : null;
            let hot = false;
            if (ok) {
              invalidateUpdates();
              hot = await hotUnmount(name2);
              const entryDisabled = await themes.setEntryDisabled(name2, true);
              hot = hot || entryDisabled;
              removeRowBlocks(userPatchPath, rowIdsForPackage(host, activeProfileDir, name2));
              disabled.delete(name2);
              removeFromGroups({ groups, groupOrder }, name2);
              writeMarketState(activeProfileDir, { disabled, groups, groupOrder });
            }
            logEvent(ok || cancelled ? "info" : "error", "uninstall", `${name2} exit=${String(result.exitCode)}${cancelled ? " CANCELLED" : ""}${ok ? ` live-removed=${String(hot)}` : cancelled ? "" : ` err=${failureDetail(result)}`}`);
            sendJson(response, ok || cancelled ? 200 : result.busy === true ? 409 : 502, {
              ok,
              cancelled: cancelled || void 0,
              busy: result.busy || void 0,
              hot,
              partial: cancelDiff?.partial,
              changed: cancelDiff?.changed,
              // The state of the package that was just removed (captured pre-op).
              activation,
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              installed: readInstalled(config.profile, activeProfileDir)
            });
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          host.logger?.warn(`[dsh-market] uninstall failed: ${message}`);
          logEvent("error", "uninstall", `route error: ${message}`);
          sendJson(response, 500, { error: message });
        }
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/rollback",
      handler: (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        sendJson(response, 400, { error: "\u66F4\u65B0\u529F\u80FD\u5DF2\u7981\u7528 / update disabled" });
      }
    }),
    host.webServer.register({
      kind: "exact",
      path: "/dsh-market/install",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: "untrusted origin" });
          return;
        }
        try {
          await withMutationLock(response, "install", async () => {
            const body = await readJsonBody(request);
            const busyAgents = runningAgentsForGuard();
            if (busyAgents.length > 0) {
              logEvent("warn", "install-blocked", `refused while agents are running \u2014 ${busyAgents.join(", ")}`);
              sendJson(response, 409, {
                error: `\u6709 agent \u6B63\u5728\u8FD0\u884C\uFF08${busyAgents.join(", ")}\uFF09\u3002\u5B89\u88C5\u4F1A\u4FEE\u6539\u63D2\u4EF6\u6587\u4EF6\uFF0C\u6B63\u5728\u5DE5\u4F5C\u7684 agent \u53EF\u80FD\u5728\u4E2D\u9014\u62A5\u9519\uFF1B\u8BF7\u7B49\u5B83\u5B8C\u6210\u6216\u53D6\u6D88\u540E\u518D\u5B89\u88C5\u3002 / ${busyAgents.length === 1 ? "An agent is running" : "Agents are running"} (${busyAgents.join(", ")}). Installing changes plugin files, so a working agent can fail mid-turn; wait for it to finish (or cancel it) before installing.`,
                agentsBusy: true,
                runningAgents: busyAgents
              });
              return;
            }
            const url = typeof body.url === "string" ? body.url : "";
            const registry = await loadRegistry();
            const entry = registry.plugins.find((p) => p.url.toLowerCase() === url.toLowerCase());
            if (entry === void 0) {
              logEvent("warn", "install-rejected", `not in curated registry: ${url.slice(0, 120)}`);
              sendJson(response, 400, { error: "plugin is not in the curated registry" });
              return;
            }
            const target = installTargetFor(entry);
            if (target === null) {
              sendJson(response, 400, { error: "unsupported source url" });
              return;
            }
            const installedNow = readInstalled(config.profile, activeProfileDir);
            const aliasOf = findInstalledAlias(entry, installedNow);
            let retryAlias = null;
            if (aliasOf !== null) {
              const sameSource = aliasOf.toLowerCase() === (entry.npm ?? "").toLowerCase() || String(installedNow[aliasOf] ?? "").replace(/^file:/, "").toLowerCase() === String(target).replace(/^file:/, "").toLowerCase();
              let active = false;
              try {
                const manifest = JSON.parse(readFileSync9(join14(activeProfileDir, "package.json"), "utf8"));
                active = (manifest.dsh?.profile?.bundles ?? []).includes(aliasOf) || liveNames().has(aliasOf);
              } catch {
                active = true;
              }
              if (active || !sameSource) {
                logEvent("warn", "install-rejected", `${entry.name}: same plugin already installed as ${aliasOf}`);
                sendJson(response, 400, { error: `\u5DF2\u4EE5\u300C${aliasOf}\u300D\u5B89\u88C5\u8FC7\u540C\u4E00\u4E2A\u63D2\u4EF6\uFF0C\u65E0\u9700\u91CD\u590D\u5B89\u88C5 / this plugin is already installed as "${aliasOf}"` });
                return;
              }
              retryAlias = aliasOf;
              logEvent("info", "install", `${entry.name}: ${aliasOf} present but inactive (leftover of a failed install) \u2014 retrying`);
            }
            if (aliasOf === null) {
              const clashName = [entry.npm, entry.name].find((n) => typeof n === "string" && n !== "" && installedNow[n] !== void 0);
              if (clashName !== void 0) {
                logEvent("warn", "install-rejected", `${entry.name}: name collision with installed ${clashName} (${installedNow[clashName]}) from a different source`);
                sendJson(response, 400, {
                  error: `\u540C\u540D\u51B2\u7A81\uFF1A\u5DF2\u5B89\u88C5\u7684\u300C${clashName}\u300D\u6765\u81EA\u5176\u4ED6\u6765\u6E90\uFF0C\u4E24\u4E2A\u540C\u540D\u63D2\u4EF6\u65E0\u6CD5\u5171\u5B58\u4E8E\u4E00\u4E2A profile\uFF0C\u8BF7\u5148\u5378\u8F7D\u518D\u5B89\u88C5 / name conflict: an installed plugin already uses the name "${clashName}" but comes from a different source; two plugins with the same name cannot coexist in one profile \u2014 uninstall it first`
                });
                return;
              }
            }
            const beforeSpecs = readInstalled(config.profile, activeProfileDir);
            const before = new Set(Object.keys(beforeSpecs));
            if (retryAlias !== null)
              before.delete(retryAlias);
            pendingRollbacks.clear();
            const compatibilityBefore = assessProfile(config.profile, activeProfileDir);
            const manifestBefore = readManifestDeps(config.profile, activeProfileDir);
            const result = await runPlugin(config.profile, ["add", target]);
            const cancelled = result.cancelled;
            if ((result.exitCode !== 0 || result.timedOut) && !cancelled) {
              const rolledBack = restoreManifestDeps(config.profile, manifestBefore, activeProfileDir);
              if (rolledBack.length > 0)
                logEvent("warn", "install", `${target}: rolled back manifest residue of the failed run: ${rolledBack.join(", ")}`);
            }
            let ok = result.exitCode === 0 && !result.timedOut && !cancelled;
            const cancelDiff = cancelled ? changedSince(beforeSpecs) : null;
            if (ok)
              invalidateUpdates();
            if (ok) {
              ok = await retargetCollections(runPlugin, config.profile, before, target, activeProfileDir);
            }
            let notAPlugin = false;
            let addedNothing = false;
            let removedBroken = [];
            let conflicts = [];
            if (result.exitCode === 0 && !result.timedOut && !cancelled) {
              const validated = await validateAddedPlugins(runPlugin, config.profile, before, activeProfileDir);
              removedBroken = validated.removedBroken;
              conflicts = validated.conflicts;
              if (removedBroken.length > 0) {
                logEvent("warn", "install", `${target}: removed uninstallable pieces (no dsh manifest or missing build artifacts): ${removedBroken.join(", ")}`);
              }
              if (validated.keep.length === 0) {
                ok = false;
                notAPlugin = true;
                addedNothing = validated.added.length === 0;
                logEvent("error", "install", addedNothing ? `${target}: the plugin command reported success but added nothing to the profile` : `${target}: nothing installable survived validation (added: ${validated.added.join(", ")})`);
              } else {
                ok = true;
              }
            }
            const conflictGroups = groupConflictsByOwner(conflicts);
            const installed = readInstalled(config.profile, activeProfileDir);
            let hot = false;
            let activation;
            let compatibility;
            let addedPackages = [];
            if (ok) {
              const added = Object.keys(installed).filter((name2) => !before.has(name2));
              addedPackages = added;
              if (added.length > 0) {
                for (const name2 of added)
                  disabled.delete(name2);
                writeMarketState(activeProfileDir, { disabled, groups, groupOrder });
                hot = true;
                for (const name2 of added) {
                  const live2 = entry.category === "theme" ? await themes.activateTheme(name2) : (await hotMount(host, activeProfileDir, name2)).ok;
                  if (!live2)
                    hot = false;
                }
                activation = {};
                const live = liveNames();
                for (const name2 of added) {
                  activation[name2] = verifyActivation(config.profile, name2, live, activeProfileDir, disabled.has(name2));
                }
              }
            }
            if (ok && addedPackages.length > 0) {
              const after = assessProfile(config.profile, activeProfileDir);
              const risks = introducedRisks(compatibilityBefore, after);
              const shadowed = introducedDuplicateNames(compatibilityBefore, after);
              const brokenBundles = addedPackages.map((pkg) => ({ name: pkg, check: checkClientBundle(config.profile, pkg, activeProfileDir) })).filter((entry2) => !entry2.check.ok).map((entry2) => ({ name: entry2.name, reason: entry2.check.reason ?? "parse failed" }));
              if (risks.length > 0 || shadowed.length > 0 || brokenBundles.length > 0) {
                compatibility = {
                  code: "soft-incompatible",
                  risks,
                  shadowedNames: shadowed.length > 0 ? shadowed : void 0,
                  brokenBundles: brokenBundles.length > 0 ? brokenBundles : void 0,
                  rollbackId: savePendingRollback({ kind: "install", names: addedPackages })
                };
                if (brokenBundles.length > 0) {
                  logEvent("error", "install-bundle", `${brokenBundles.map((entry2) => `${entry2.name}: ${entry2.reason}`).join("; ")}`);
                }
                if (risks.length > 0) {
                  logEvent("warn", "install-compat", `${addedPackages.join(", ")}: introduced host-compatibility risks \u2014 ${risks.map((risk) => `${risk.peer}@${risk.range} vs ${risk.resolved}`).join("; ")}`);
                }
                if (shadowed.length > 0) {
                  logEvent("warn", "install-shadow", `${addedPackages.join(", ")}: introduced cross-layer duplicate loader names \u2014 ${shadowed.map((entry2) => `${entry2.name} (${entry2.layers.join(" + ")})`).join("; ")}`);
                }
              }
            }
            logEvent(ok || cancelled ? "info" : "error", "install", `${target} exit=${String(result.exitCode)}${result.timedOut ? " TIMEOUT" : ""}${cancelled ? " CANCELLED" : ""}${ok ? ` hot=${String(hot)}` : cancelled ? "" : ` err=${failureDetail(result)}`}`);
            const ignoredBuilds = blockedBuilds(result);
            sendJson(response, ok || cancelled ? 200 : result.busy === true ? 409 : 502, {
              ok,
              cancelled: cancelled || void 0,
              busy: result.busy || void 0,
              hot,
              partial: cancelDiff?.partial,
              changed: cancelDiff?.changed,
              activation,
              compatibility,
              ignoredBuilds,
              // Blocked build scripts are expected (pnpm >= 10 blocks them by
              // default): surface the approve-builds banner instead of scaring
              // the user with pnpm's raw stack.
              // A loader-id clash is the most actionable failure of all: the
              // plugin is fine, it just cannot coexist with this profile (#122).
              // The UI renders `conflictGroups`; this string is the fallback
              // for logs and non-UI callers. It attributes each id to the
              // owner that actually declares it — a candidate can clash with
              // several installed plugins at once, and naming only the first
              // owner while listing every id blamed one plugin for another's
              // ids.
              conflictGroups: conflictGroups.length > 0 ? conflictGroups : void 0,
              error: conflictGroups.length > 0 ? `\u300C${conflicts[0].name}\u300D\u4E0E\u5DF2\u5B89\u88C5\u7684 ${conflictGroups.map((group) => `\u300C${group.owner}\u300D\uFF08${group.ids.join("\u3001")}\uFF09`).join("\u3001")} \u5360\u7528\u76F8\u540C\u7684 loader \u6761\u76EE id\uFF0C\u65E0\u6CD5\u5728\u540C\u4E00\u73AF\u5883\u4E2D\u5171\u5B58\u2014\u2014\u4FDD\u7559\u4F1A\u5BFC\u81F4 DeepSeek Harness \u4E0B\u6B21\u542F\u52A8\u5931\u8D25\uFF0C\u56E0\u6B64\u5DF2\u81EA\u52A8\u79FB\u9664\u3002 / "${conflicts[0].name}" declares the same loader entry id(s) as the installed ${conflictGroups.map((group) => `"${group.owner}" (${group.ids.join(", ")})`).join(", ")}; they cannot coexist in one environment \u2014 keeping it would stop DeepSeek Harness from starting, so it was removed.` : addedNothing ? "\u5B89\u88C5\u547D\u4EE4\u62A5\u544A\u6210\u529F\uFF0C\u4F46 profile \u6CA1\u6709\u4EFB\u4F55\u53D8\u5316\u2014\u2014\u63D2\u4EF6\u672C\u8EAB\u6CA1\u95EE\u9898\uFF0C\u662F\u6267\u884C\u5B89\u88C5\u7684\u901A\u9053\u6CA1\u6709\u771F\u6B63\u8FD0\u884C\u3002\u82E5\u4F7F\u7528\u684C\u9762\u7AEF\uFF0C\u8BF7\u6539\u7528\u547D\u4EE4\u884C dsh plugin add \u9A8C\u8BC1\uFF0C\u5E76\u628A\u5BFC\u51FA\u65E5\u5FD7\u9644\u5728 issue \u4E2D / the install command reported success but the profile did not change \u2014 the plugin is not at fault, the channel that should have installed it did not actually run. On a desktop build, verify with `dsh plugin add` from a terminal and attach the exported log" : notAPlugin ? "nothing installable: the plugin(s) need a build step (blocked by default, see allowBuilds) or ship no prebuilt artifacts / \u6CA1\u6709\u53EF\u5B89\u88C5\u7684\u5185\u5BB9\uFF1A\u63D2\u4EF6\u9700\u8981\u6784\u5EFA\u6388\u6743\uFF08allowBuilds\uFF0C\u9ED8\u8BA4\u62E6\u622A\uFF09\u6216\u672A\u9644\u5E26\u6784\u5EFA\u4EA7\u7269\uFF0C\u8BE6\u89C1\u5BFC\u51FA\u65E5\u5FD7" : Array.isArray(ignoredBuilds) && ignoredBuilds.length > 0 ? `\u6784\u5EFA\u811A\u672C\u88AB pnpm \u9ED8\u8BA4\u62E6\u622A\uFF08${ignoredBuilds.join(", ")}\uFF09\uFF0C\u8BF7\u70B9\u51FB\u4E0A\u65B9\u6309\u94AE\u653E\u884C\u540E\u91CD\u8BD5 / build scripts are blocked by pnpm by default (${ignoredBuilds.join(", ")}); click "Allow build scripts and retry" above` : void 0,
              exitCode: result.exitCode,
              timedOut: result.timedOut,
              stdout: result.stdout,
              stderr: result.stderr,
              installed
            });
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          host.logger?.warn(`[dsh-market] install failed: ${message}`);
          logEvent("error", "install", `route error: ${message}`);
          sendJson(response, 500, { error: message });
        }
      }
    })
  ];
  return () => {
    for (const dispose of disposers)
      dispose();
  };
}

// src-tauri/resources/dsh-market/src/host/index.js
var name = "dsh-market";
function argvProfile() {
  const argv = process.argv;
  const flag = argv.indexOf("--profile");
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith("-"))
    return argv[flag + 1];
  return void 0;
}
function agentsLookupOf(ctx) {
  return () => ctx.get("agents");
}
function apply(ctx, config) {
  ctx.inject(["webServer", "loader"], (hostCtx) => {
    const host = hostCtx;
    const desktopProfiles = ctx.get("desktopProfiles");
    if (desktopProfiles === void 0) {
      const resolved = {
        profile: config?.profile ?? argvProfile() ?? "web",
        // Left UNDEFINED when unconfigured, deliberately: `?? true` here
        // would turn "the operator said nothing" into "the operator said
        // yes", and restartAllowed() could no longer tell them apart — which
        // is exactly the distinction supervisor detection needs (#229).
        allowRestart: config?.allowRestart
      };
      host.effect(() => mountMarketRoutes(host, resolved, void 0, agentsLookupOf(ctx)), "dsh-market: http routes");
      return;
    }
    hostCtx.inject(["desktopPnpm"], (desktopCtx) => {
      const current = desktopProfiles.current;
      const service = desktopCtx.desktopPnpm;
      const runtime = createDesktopPluginRuntime(service, current.dir);
      const resolved = {
        profile: current.name,
        profileDirectory: current.dir,
        // Relaunching a raw Electron process would bypass Desktop's launcher
        // lifecycle. The shell remains responsible for restart in this mode.
        allowRestart: false
      };
      const desktopHost = desktopCtx;
      desktopHost.effect(() => {
        const disposeRoutes = mountMarketRoutes(host, resolved, runtime, agentsLookupOf(ctx));
        return async () => {
          disposeRoutes();
          await runtime.dispose();
        };
      }, "dsh-market: Desktop http routes and package operations");
    });
  });
}
export {
  apply,
  name
};
