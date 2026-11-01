import "server-only";
import os from "node:os";

/**
 * The OS the server is running on, read at run time.
 *
 * Not `process.platform`: Turbopack replaces it with the *build* machine's value,
 * so a Windows installer built on a Mac would carry `"darwin"` baked in and every
 * `process.platform === "win32"` branch folded away (no .exe names, no static
 * linking, no ASCII temp folder). `os.platform()` is an ordinary call.
 */
export const hostPlatform = (): NodeJS.Platform => os.platform();
export const isWindows = () => hostPlatform() === "win32";
