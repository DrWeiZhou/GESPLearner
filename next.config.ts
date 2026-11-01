import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The desktop build (scripts/desktop/build.ts) writes to its own directory, so it
  // can run while `next dev` is using .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The desktop app runs `<distDir>/standalone/server.js` inside Electron (see desktop/main.ts).
  output: "standalone",
  // The file tracer follows the runtime's dynamic paths (the database folder, the
  // judge's temp files) into the repository. None of that belongs in the shipped
  // server — data/ holds local databases and backups — and the desktop build copies
  // the bundled content (papers, syllabus, migrations) in by itself.
  outputFileTracingExcludes: {
    "/*": ["data/**", "build-desktop/**", "dist-desktop/**", ".next/**", "src/**", "scripts/**", "public/**"],
    "/**/*": ["data/**", "build-desktop/**", "dist-desktop/**", ".next/**", "src/**", "scripts/**", "public/**"],
  },
  // Native canvas binding + pdf.js, used by the admin「更新题库」to render PDF pages.
  serverExternalPackages: ["@napi-rs/canvas", "unpdf"],
  partialPrefetching: true,
  experimental: {
    // The server directory sits inside the installed app, which may be read-only
    // (Program Files, a signed .app bundle). Regenerated pages stay in memory.
    isrFlushToDisk: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
