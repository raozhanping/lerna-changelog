const path = require("path");

import ConfigurationError from "./configuration-error";
import fetch from "./fetch";
import { Configuration, RepoOption } from "./configuration";
import { string } from "yargs";

export interface GitHubUserResponse {
  login: string;
  name: string;
  html_url: string;
}

export interface GitHubIssueResponse {
  number: number;
  title: string;
  pull_request?: {
    html_url: string;
  };
  labels: Array<{
    name: string;
  }>;
  user: {
    login: string;
    html_url: string;
  };
}

export interface GitService {
  [_: string]: any;
}

export default class GithubAPI {
  private cacheDir: string | undefined;
  private auth: string;

  constructor(config: Configuration) {
    this.cacheDir = config.cacheDir && path.join(config.rootPath, config.cacheDir, "github");
    this.auth = this.getAuthToken();
    if (!this.auth) {
      throw new ConfigurationError("Must provide GITHUB_AUTH");
    }
  }

  public getBaseIssueUrl(repo: RepoOption): string {
    return this.request("issues", repo);
  }

  public async getIssueData(repo: RepoOption, issue: string): Promise<GitHubIssueResponse> {
    return this.request("issueData", repo, issue);
  }

  public async getUserData(repo: RepoOption, login: string): Promise<GitHubUserResponse> {
    return this.request("userData", repo, login);
  }

  private request(request: string, repo: RepoOption, ...args: any) {
    const service = this.resolveService(repo.type || "github");
    return service[request].apply(null, [repo].concat(args));
  }

  private resolveService(type: "github" | "gitlab"): GitService {
    // FIXME: Use abstract class
    const serviceMap = {
      github: <GitService>{
        issues: (repo: RepoOption) => `https://github.com/${repo.name}/issues`,
        issueData: (repo: RepoOption, issue: string) =>
          this._fetch(`https://api.github.com/repos/${repo.name}/issues/${issue}`),
        userData: (repo: RepoOption, login: string) => this._fetch(`https://api.github.com/users/${login}`),
      },
      gitlab: <GitService>{
        issues: (repo: RepoOption) => `${repo.protocol}://${repo.domain}/${repo.name}/-/issues/`,
        issueData: (repo: RepoOption, issue: string) =>
          this._fetch(
            `${repo.protocol}://${repo.domain}/api/v4/projects/${repo.name?.replace(/\//g, "%2F")}/issues/${issue}`
          ).then(res => ({
            ...res,
            number: res.iid,
            labels: res.labels.map((name: string) => ({ name })),
            user: {
              login: res.author.username,
              html_url: res.author.web_url,
            },
          })),
        userData: (repo: RepoOption, login: string) =>
          this._fetch(`${repo.protocol}://${repo.domain}/api/v4/users?username=${login}`).then(res => {
            const user = res[0];
            if (!user) return { login, name: login, html_for: `${repo.protocol}://${repo.domain}/${login}` };
            return { ...user, login: user.username, html_url: user.web_url };
          }),
      },
    };

    return serviceMap[type];
  }

  private async _fetch(url: string): Promise<any> {
    const res = await fetch(url, {
      cacheManager: this.cacheDir,
      headers: {
        Authorization: `bearer ${this.auth}`,
      },
    });
    const parsedResponse = await res.json();
    if (res.ok) {
      return parsedResponse;
    }
    throw new ConfigurationError(`Fetch error: ${res.statusText}.\n${JSON.stringify(parsedResponse)}`);
  }

  private getAuthToken(): string {
    return process.env.GITHUB_AUTH || "";
  }
}
