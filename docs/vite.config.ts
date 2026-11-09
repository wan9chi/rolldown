// Tasks for `vp run`, which caches them. VitePress also loads this file as its Vite config and
// ignores `run`; nothing is imported, so loading it doesn't load Vite+.
//
// `vp run` doesn't track reads in `.git`, but both outputs depend on git: TypeDoc links each
// declaration to its source at the checked-out commit, and VitePress dates each page
// (`lastUpdated`) from `git log`. A cache hit keeps the links and dates of the run that stored
// the entry; its inputs ensure the linked sources and the pages are unchanged.
export default {
  run: {
    tasks: {
      // The API reference in reference/, from packages/rolldown/src.
      generate: {
        command: 'node .vitepress/scripts/generate-reference.ts',
      },
      build: {
        command: 'vitepress build',
      },
    },
  },
};
