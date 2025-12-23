#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { run } from "@oclif/core";

run(undefined, { root: fileURLToPath(new URL("..", import.meta.url)) })
  .then(() => {
    // noop
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "CLI failure");
    process.exitCode = 1;
  });
