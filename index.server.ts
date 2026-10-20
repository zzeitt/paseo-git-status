import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getGitStatus } from "./server/git-status";
import { gitStatusRpc } from "./shared/git-status";

export default function contribute(server: PluginServerContext) {
  server.handle(gitStatusRpc, getGitStatus);
  return () => {};
}
