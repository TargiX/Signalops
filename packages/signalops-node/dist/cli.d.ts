#!/usr/bin/env node
type CliEnv = Record<string, string | undefined>;
type CliIo = {
    log: (message?: unknown, ...optionalParams: unknown[]) => void;
    error: (message?: unknown, ...optionalParams: unknown[]) => void;
};
export declare function runSignalOpsCli(argv?: string[], env?: CliEnv, io?: CliIo): Promise<0 | 1>;
export {};
