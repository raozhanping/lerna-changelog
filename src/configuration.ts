const fs = require("fs");
const path = require("path");
const execa = require("execa");
const hostedGitInfo = require("hosted-git-info");

import ConfigurationError from "./configuration-error";

export interface Configuration {
  repo: RepoOption;
  rootPath: string;
  labels: { [key: string]: string };
  ignoreCommitters: string[];
  cacheDir?: string;
  nextVersion: string | undefined;
  nextVersionFromMetadata?: boolean;
}
export interface RepoOption {
  type: "github" | "gitlab";
  name: String | undefined;
  protocol: "http" | "https";
  domain: String;
}

export interface ConfigLoaderOptions {
  nextVersionFromMetadata?: boolean;
}

export function load(options: ConfigLoaderOptions = {}): Configuration {
  let cwd = process.cwd();
  let rootPath = execa.sync("git", ["rev-parse", "--show-toplevel"], { cwd }).stdout;

  return fromPath(rootPath, options);
}

export function fromPath(rootPath: string, options: ConfigLoaderOptions = {}): Configuration {
  // Step 1: load partial config from `package.json` or `lerna.json`
  let config = fromPackageConfig(rootPath) || fromLernaConfig(rootPath) || {};

  // Step 2: fill partial config with defaults
  let { repo, nextVersion, labels, cacheDir, ignoreCommitters } = config;
  const name = <unknown>repo;
  let repoOption = <RepoOption>{ type: "github", protocol: "https", domain: "github.com", name };

  if (isObject(name)) {
    repoOption = Object.assign(repoOption, name);
  }
  if (isString(name)) {
    repoOption.name = <string>name;
  } else if (!name) {
    repoOption.name = findRepo(rootPath);
    if (!repoOption.name) {
      throw new ConfigurationError('Could not infer "repo.name" from the "package.json" file.');
    }
  }

  if (options.nextVersionFromMetadata || config.nextVersionFromMetadata) {
    nextVersion = findNextVersion(rootPath);

    if (!nextVersion) {
      throw new ConfigurationError('Could not infer "nextVersion" from the "package.json" file.');
    }
  }

  if (!labels) {
    labels = {
      breaking: ":boom: Breaking Change",
      enhancement: ":rocket: Enhancement",
      bug: ":bug: Bug Fix",
      documentation: ":memo: Documentation",
      internal: ":house: Internal",
    };
  }

  if (!ignoreCommitters) {
    ignoreCommitters = [
      "dependabot-bot",
      "dependabot[bot]",
      "greenkeeperio-bot",
      "greenkeeper[bot]",
      "renovate-bot",
      "renovate[bot]",
    ];
  }

  return {
    repo: repoOption,
    nextVersion,
    rootPath,
    labels,
    ignoreCommitters,
    cacheDir,
  };
}

function fromLernaConfig(rootPath: string): Partial<Configuration> | undefined {
  const lernaPath = path.join(rootPath, "lerna.json");
  if (fs.existsSync(lernaPath)) {
    return JSON.parse(fs.readFileSync(lernaPath)).changelog;
  }
}

function fromPackageConfig(rootPath: string): Partial<Configuration> | undefined {
  const pkgPath = path.join(rootPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    return JSON.parse(fs.readFileSync(pkgPath)).changelog;
  }
}

function findRepo(rootPath: string): string | undefined {
  const pkgPath = path.join(rootPath, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath));
  if (!pkg.repository) {
    return;
  }

  return findRepoFromPkg(pkg);
}

function findNextVersion(rootPath: string): string | undefined {
  const pkgPath = path.join(rootPath, "package.json");
  const lernaPath = path.join(rootPath, "lerna.json");

  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath)) : {};
  const lerna = fs.existsSync(lernaPath) ? JSON.parse(fs.readFileSync(lernaPath)) : {};

  return pkg.version ? `v${pkg.version}` : lerna.version ? `v${lerna.version}` : undefined;
}

export function findRepoFromPkg(pkg: any): string | undefined {
  const url = pkg.repository.url || pkg.repository;
  const info = hostedGitInfo.fromUrl(url);
  if (info && info.type === "github") {
    return `${info.user}/${info.project}`;
  }
}

function isObject(o: any) {
  return Object.prototype.toString.call(o) === "[object Object]";
}
function isString(s: any) {
  return typeof s === "string";
}
