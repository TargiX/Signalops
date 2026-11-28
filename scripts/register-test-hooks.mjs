import { registerHooks } from "node:module";

// Plain `node` cannot resolve the bare "next/headers" specifier (Next.js does not
// export it in its package.json exports map), but the physical `next/headers.js`
// file resolves fine. Contract tests that import modules whose graph includes
// supabase-auth.ts need this rewrite to run outside Next.js.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") {
      specifier = "next/headers.js";
    }
    return nextResolve(specifier, context);
  },
});
