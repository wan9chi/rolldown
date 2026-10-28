use std::borrow::Cow;

use rolldown::{BundlerOptions, InputItem};
use rolldown_common::EmittedChunk;
use rolldown_plugin::{HookBuildStartArgs, HookUsage, Plugin, PluginContext};
use rolldown_testing::{manual_integration_test, test_config::TestMeta};

#[derive(Debug)]
struct EmitOther;

impl Plugin for EmitOther {
  fn name(&self) -> Cow<'static, str> {
    "emit-other".into()
  }

  async fn build_start(
    &self,
    ctx: &PluginContext,
    _args: &HookBuildStartArgs<'_>,
  ) -> Result<(), anyhow::Error> {
    ctx.emit_chunk(EmittedChunk { id: "./other.js".to_string(), ..Default::default() })?;
    Ok(())
  }

  fn register_hook_usage(&self) -> HookUsage {
    HookUsage::BuildStart
  }
}

// Only `other.js` loads `lazy.js`, so the runtime host check by entries accepts the chunk of
// `other.js`. But the host exports the helpers to `lazy.js`, and the `exports-only` signature of
// `other.js` is strict, because `other.js` has exports. An emitted entry is a user-defined entry, so
// it must keep its signature: the runtime goes into its own chunk, as when `other.js` is an `input`
// entry. Before the fix, the emitted entry hosted the runtime and became a facade.
// See https://github.com/rolldown/rolldown/issues/11351
#[tokio::test(flavor = "multi_thread")]
async fn emitted_entry_with_strict_signature_does_not_host_runtime() {
  manual_integration_test!()
    .build(TestMeta::default())
    .run_with_plugins(
      BundlerOptions {
        input: Some(vec![InputItem { name: Some("main".into()), import: "./main.js".into() }]),
        ..Default::default()
      },
      vec![Plugin::new_shared(EmitOther)],
    )
    .await;
}
